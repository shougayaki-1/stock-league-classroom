# 支払方法・契約期間・課金状態(Stripe Checkout導線) 設計仕様

**日付:** 2026-08-09
**対象:** Phase F(組織・契約)のサブプロジェクト6 — §18.8(支払方法と状態、Stripe Checkout導線部分)
**正本:** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md` §18.8(支払方法と状態)。矛盾する場合は正本を優先し、本仕様側の誤りとして扱う。

## 背景・位置づけ

§18.8は`PaymentMethod`/`BillingStatus`のデータモデルと、「初期運用ではカードと手動登録を中心に」という方針を定める。決済事業者は従来未選定だったが、ユーザーの判断によりStripeを採用することとした。本サブプロジェクトはStripeのホスト型決済ページ(Checkout)への導線と、支払い完了を検知するWebhookのみを実装する。

**スコープ判断(ユーザー承認済み):**
- Stripe Checkout(ホスト型)へのリダイレクトと、支払い完了Webhookの受信のみを実装する。
- 対応する支払い方法は`CARD`(Stripe経由)のみ。`INVOICE`(請求書)・`BANK_TRANSFER`(銀行振込)・`MANUAL`(手動登録)は対象外。
- サブスクリプションの自動更新・解約・支払い失敗時のリトライ(`invoice.payment_failed`等、`checkout.session.completed`以外のWebhookイベント)は対象外。
- 契約期間(§18.5、月額/年額/イベント短期等)のデータモデルは対象外。
- 教師向けの請求履歴閲覧UI(`billingRecords`一覧画面)は対象外——申し込みボタンとStripeへのリダイレクトのみを作る。
- **実装はStripeのテストモードAPIキーを前提とする。**本番キーへの切り替えはデプロイ時の運用作業とし、コードには一切関与させない。

## アーキテクチャ

### 新規依存関係

`functions/package.json`に`stripe`(公式Node SDK)を追加する。このプロジェクト初の外部決済SDK。

### 秘密情報の管理

Firebase Functions v2の`defineSecret`(Google Secret Manager連携、コードへのハードコード禁止)で`STRIPE_SECRET_KEY`・`STRIPE_WEBHOOK_SECRET`を定義する。

### プランとStripe価格の紐付け

`planDefinitions/{planId}`(既存、Phase Fサブプロジェクト2)に`stripePriceId: string | null`フィールドを追加する。Stripeダッシュボード側で作成した価格IDを、Firebase Console側で各プランドキュメントへ手動投入する(既存の「手動運用」の割り切りをそのまま踏襲)。

### チェックアウトセッションの作成

新規Callable`createStripeCheckoutSessionCallable({orgId, planId})`。

- 認可: `requireActiveOrgMember`確認後、owner/adminのみ。
- `planDefinitions/{planId}.stripePriceId`が未設定なら`failed-precondition`。
- `organizations/{orgId}/billingRecords/{recordId}`を`status: 'PENDING', paymentMethod: 'CARD', planId, createdAt`で作成する(Stripe側のセッション作成前に、追跡対象のレコードをこちらで先に確保しておく)。
- Stripe SDKで`checkout.sessions.create({mode: 'subscription', line_items: [{price: stripePriceId, quantity: 1}], client_reference_id: \`${orgId}:${recordId}\`, success_url, cancel_url})`を呼び、返ってきた`session.url`をクライアントへ返す。クライアントはそのURLへ`window.location`で遷移する(Stripeのホスト型ページ——このアプリのサーバーはカード情報に一切触れない)。

### Webhookでの支払い完了処理

新規HTTPエンドポイント`stripeWebhookCallable`(`onRequest`——このプロジェクト初のHTTP関数。`onCall`はJSONを自動パースしてしまい、Stripeの署名検証に必要な生のリクエストボディへアクセスできないため)。

- `stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret)`で署名を検証する(検証失敗時は400を返し、一切のFirestore書き込みを行わない)。
- `checkout.session.completed`イベントのみ処理する。`client_reference_id`から`orgId`・`recordId`を復元し、`organizations/{orgId}/billingRecords/{recordId}`を`status: 'PAID', paidAt, stripeSessionId`で更新する。
- 冪等性: Stripeは同一イベントを複数回送信することがあるため、`billingRecords/{recordId}.status === 'PAID'`が既に成立していれば何もせず200を返す。

## データフロー

```
[教師: プラン選択画面] --「このプランで申し込む」--> createStripeCheckoutSessionCallable({orgId, planId})
  --> requireActiveOrgMember + owner/admin確認
  --> planDefinitions/{planId}.stripePriceId を確認(未設定ならfailed-precondition)
  --> organizations/{orgId}/billingRecords/{recordId} を status:'PENDING' で作成
  --> Stripe Checkout Session を作成(client_reference_id: `${orgId}:${recordId}`)
  --> session.url をクライアントへ返す

[クライアント] --window.location = session.url--> Stripeのホスト型決済ページ

[Stripe] --支払い完了--> stripeWebhookCallable(onRequest) へ checkout.session.completed イベントをPOST
  --> 署名検証(stripe.webhooks.constructEvent) --> 失敗時は400、Firestoreへは一切触れない
  --> client_reference_id から orgId・recordId を復元
  --> organizations/{orgId}/billingRecords/{recordId} が既にPAIDなら何もせず200(冪等)
  --> そうでなければ status:'PAID', paidAt, stripeSessionId を書き込み --> 200を返す
```

## エラー処理

- `createStripeCheckoutSessionCallable`: 未認証`unauthenticated`、非owner/admin`permission-denied`、`stripePriceId`未設定`failed-precondition`(「このプランはまだ決済に対応していません」)。Stripe API呼び出し自体が失敗した場合は`unavailable`(「決済セッションの作成に失敗しました。時間をおいて再試行してください」)。
- `stripeWebhookCallable`: 署名検証失敗は400を返すのみ(詳細をレスポンスに含めない)。未対応のイベント種別は200を返して無視する。`client_reference_id`の形式が不正、または対応する`billingRecords`ドキュメントが存在しない場合はログに残して200を返す(Stripe側の再送ループを避けるため)。
- クライアント側: `createStripeCheckoutSessionCallable`が失敗した場合、「決済ページを開けませんでした。時間をおいて再試行してください」を表示する。

## テスト方針

- `buildStripeCheckoutSession`(純粋関数、Stripe SDK呼び出しをdeps注入): `stripePriceId`未設定時のエラー、`billingRecords`が先に作成されること、`client_reference_id`の形式を検証する。
- `handleStripeWebhookEvent`(純粋関数、署名検証済みの`event`オブジェクトを受け取る想定): `checkout.session.completed`での`billingRecords`更新、既にPAIDな場合に何もしないこと(冪等性)、未知のイベント種別で何もしないことを検証する。
- `createStripeCheckoutSessionCallable`/`stripeWebhookCallable`: 認可・署名検証・エラー変換を検証する(Stripe SDK・`defineSecret`はモック化する)。
- UI: 「このプランで申し込む」ボタンがCallable呼び出し後に`window.location`相当の遷移を行うことを検証する。
