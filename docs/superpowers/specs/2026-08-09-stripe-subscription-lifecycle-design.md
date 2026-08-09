# サブスクリプションのライフサイクル管理(Stripe Webhook拡張・Customer Portal) 設計仕様

**日付:** 2026-08-09
**対象:** Phase F(組織・契約)のサブプロジェクト7 — §18.8(支払方法と状態)続き
**正本:** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md` §18.8。矛盾する場合は正本を優先し、本仕様側の誤りとして扱う。前提: `docs/superpowers/specs/2026-08-09-stripe-checkout-billing-design.md`(実装済み)。

## 背景・位置づけ

Stripe Checkout導線(実装済み)は`checkout.session.completed`のみを処理し、初回申込しか追跡できない——設計仕様に明記された意図的なスコープ外だった。しかし2回目以降の自動課金・支払い失敗・解約はこのままでは`billingRecords`に一切反映されず、契約状態が実態と乖離し続ける。本サブプロジェクトはこのギャップを埋める。

**スコープ判断:**
- Webhookで`invoice.paid`・`invoice.payment_failed`・`customer.subscription.deleted`の3イベントを追加処理する。
- Stripe Customer Portalへの導線(顧客による解約・支払い方法変更のセルフサービス)を追加する。
- Stripe Dashboard側の設定(Customer Portalの有効化・Smart Retriesの有効化)はコードに含まれない、運用作業として扱う。
- Invoicing製品(請求書払い・Hosted Invoice Page)の導入は対象外(将来の別サブプロジェクト)。

## アーキテクチャ

### 顧客ID⇔組織IDの対応付け

`invoice.paid`等の更新系Webhookイベントには`client_reference_id`が含まれない(Checkout Session固有の値のため)。代わりにStripeの`customer`(顧客ID)を手がかりに`orgId`を逆引きする必要があるため、2つの対応関係をFirestoreに保存する:
- `organizations/{orgId}.stripeCustomerId: string | null`(順引き — Customer Portalセッション作成に使う)
- `stripeCustomers/{stripeCustomerId}` → `{orgId: string}`(逆引き — Webhookが顧客IDから組織を特定するために使う。ドキュメントID直接取得なので、クエリ・複合インデックス不要)

どちらも`checkout.session.completed`処理時に初めて書き込む。

### 組織の契約状態

`organizations/{orgId}.subscriptionStatus: 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | null`を追加する。

### Webhookイベントの拡張

- `checkout.session.completed`(既存): 支払い完了処理に加え、`session.customer`を`organizations/{orgId}.stripeCustomerId`と`stripeCustomers/{customerId}`の両方へ書き込む。
- `invoice.paid`(新規): `invoice.customer`から`stripeCustomers/{customerId}`経由で`orgId`を逆引きし、`organizations/{orgId}.subscriptionStatus = 'ACTIVE'`に更新。新規`billingRecords`エントリを`status: 'PAID'`で作成する(既存のPENDINGレコードを使い回さない——毎月の請求は毎回新しいレコードとして記録する)。
- `invoice.payment_failed`(新規): 同様に`orgId`を逆引きし、`subscriptionStatus = 'PAST_DUE'`に更新。`billingRecords`を`status: 'OVERDUE'`で作成する。
- `customer.subscription.deleted`(新規): `orgId`を逆引きし、`subscriptionStatus = 'CANCELED'`に更新(`billingRecords`への追加書き込みはしない)。
- 冪等性: `invoice.paid`/`invoice.payment_failed`はStripeの`invoice.id`を用いて重複処理を防ぐ(同一請求書のイベントが再送されても`billingRecords`に重複エントリを作らない)。

### Customer Portal

新規Callable`createStripeCustomerPortalSessionCallable({orgId, returnUrl})`。認可: owner/adminのみ。`organizations/{orgId}.stripeCustomerId`が未設定なら`failed-precondition`(「まだ決済履歴がありません」)。Stripe SDKで`billingPortal.sessions.create({customer: stripeCustomerId, return_url: returnUrl})`を呼び、`session.url`を返す。

UI: `PlanLimitsPage`に「支払い方法の変更・解約」ボタンを追加(`stripeCustomerId`が存在する場合のみ表示)。クリックでCustomer Portalへリダイレクトする(申し込みボタンと同じ`window.location`遷移パターン)。

## データフロー

```
[Stripe] --checkout.session.completed--> stripeWebhookCallable
  --> billingRecords/{recordId} を 'PAID' に更新(既存の処理)
  --> organizations/{orgId}.stripeCustomerId = session.customer を書き込み
  --> stripeCustomers/{session.customer} = {orgId} を書き込み

[Stripe] --invoice.paid(毎月の自動請求)--> stripeWebhookCallable
  --> stripeCustomers/{invoice.customer} から orgId を逆引き
  --> organizations/{orgId}.subscriptionStatus = 'ACTIVE'
  --> billingRecords に新規エントリ(status:'PAID')を作成(invoice.idで冪等性確認)

[Stripe] --invoice.payment_failed--> stripeWebhookCallable
  --> 同様に orgId を逆引き --> subscriptionStatus = 'PAST_DUE'
  --> billingRecords に新規エントリ(status:'OVERDUE')

[Stripe] --customer.subscription.deleted--> stripeWebhookCallable
  --> orgId を逆引き --> subscriptionStatus = 'CANCELED'

[教師: PlanLimitsPage「支払い方法の変更・解約」] --> createStripeCustomerPortalSessionCallable({orgId, returnUrl})
  --> owner/admin確認 --> stripeCustomerId確認 --> Stripe Customer Portalセッション作成
  --> session.url へ window.location 遷移
```

## エラー処理

- Webhookで`stripeCustomers/{customerId}`が見つからない場合: ログに残して200を返す(不整合をWebhookの5xxで表現しない既存方針を踏襲)。
- `invoice.paid`/`invoice.payment_failed`の冪等性: 同一`invoice.id`に対応する`billingRecords`エントリが既に存在すれば何もしない。
- `createStripeCustomerPortalSessionCallable`: 未認証`unauthenticated`、非owner/admin`permission-denied`、`stripeCustomerId`未設定`failed-precondition`(「まだ決済履歴がありません」)、Stripe API失敗`unavailable`。

## テスト方針

- `handleStripeWebhookEvent`の拡張: `invoice.paid`/`invoice.payment_failed`/`customer.subscription.deleted`それぞれで`subscriptionStatus`が正しく更新されること、`stripeCustomers`逆引きが見つからない場合に何もしないこと、`invoice.id`による冪等性(同じinvoiceで2回呼んでも`billingRecords`が1件のままであること)を検証する。
- `checkout.session.completed`処理の拡張: `stripeCustomerId`の順引き・逆引き両方が書き込まれることを検証する。
- `createStripeCustomerPortalSession`(純粋関数): `stripeCustomerId`未設定時のエラー、正常系でのセッション作成呼び出しを検証する。
- `createStripeCustomerPortalSessionCallable`: 認可・エラー変換を検証する。
- UI: 「支払い方法の変更・解約」ボタンが`stripeCustomerId`存在時のみ表示され、クリックで正しく遷移することを検証する。
