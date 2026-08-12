# 年額請求書サブスクリプション・請求先プロフィール 設計仕様

**日付:** 2026-08-12
**対象:** Phase F（組織・契約）のサブプロジェクト12 — §18.8 支払方法と状態（Stripe Invoicing）
**正本:** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md` §18.8。本仕様は、同節の「初期運用ではカードと手動登録を中心にしても、データモデルは請求書・振込へ対応する」を、標準年額学校プランのStripe請求書払いとして具体化する。既存のStripe Checkout・Subscription Lifecycle・Webhook順序耐性仕様と矛盾する場合は、本仕様ではなくそれぞれの正本と明示された後続仕様を優先する。

## 背景・スコープ

既存実装はStripe Checkoutによるカード年額サブスクリプション、Customer Portal、請求記録、Webhookによる契約状態同期を提供する。一方、学校・法人では請求書を受け取って30日以内に支払う年額契約が必要になる。

本サブプロジェクトは、学校組織のowner/adminが請求先プロフィールを登録し、標準年額学校プランの`send_invoice`型Stripe Subscriptionを申し込めるようにする。請求書の支払期限は30日で固定する。Stripeが支払い事実・請求書状態の正本であり、アプリ内で学校が支払済みを自己申告したり、Firestoreの請求状態を直接書き換えたりする経路は作らない。

### ユーザー承認済みの判断

- 年額の請求書送付型サブスクリプションを使う。
- 支払期限は30日で固定する。
- カード年額契約からの切替は次回更新日から行い、即時停止・日割り・返金はしない。
- 請求先プロフィールは組織owner/adminがアプリから登録・更新する。
- 請求書を発行した時点で利用を開始し、未払いが期限後にStripeで`PAST_DUE`となった状態は既存の契約状態・利用枠制限へ接続する。

### 対象外

- 個別見積・値引き・営業承認フロー（Stripe Quotes）。
- 税計算の有効化、税率・適格請求書制度の実装。
- 返金、Credit Note、複数通貨、独自督促メール、会計ソフト連携。
- `MANUAL`の支払済み確定UIまたは学校利用者による請求状態更新。
- 子学校の請求情報を上位組織へ共有する機能。

`BANK_TRANSFER`と`MANUAL`は既存の`PaymentMethod`互換の値として保持する。今回、`BANK_TRANSFER`はStripe Invoicingで設定された銀行振込がStripeの`invoice.paid`として確定した場合にのみ保存する。`MANUAL`は将来の運営管理機能まで記録・確定操作を追加しない。

## データモデル

### 組織の請求先プロフィール

`organizations/{orgId}` に次を保存する。profileは学校組織だけに許可し、読み取り・更新は同じ組織のowner/adminだけに限定する。

```ts
type BillingProfile = {
  legalName: string
  contactName: string
  email: string
  address: {
    postalCode: string
    prefecture: string
    city: string
    line1: string
    line2?: string
  }
  updatedAt: Timestamp
  updatedByUid: string
}
```

Stripe Customer IDは既存の`stripeCustomerId`を再利用する。プロフィール保存ではCustomerがなければ作成し、あれば更新する。組織ドキュメントにカード番号、銀行口座、Stripe Secret Key、Hosted Invoice URLを保存しない。

### 請求記録と申込状態

既存の`organizations/{orgId}/billingRecords/{recordId}`を拡張し、カード記録との後方互換性を保つ。

```ts
type InvoiceBillingRecord = {
  paymentMethod: 'INVOICE' | 'BANK_TRANSFER'
  status: 'DRAFT' | 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELLED'
  planId: 'SCHOOL'
  stripeCustomerId: string
  stripeSubscriptionId: string
  stripeInvoiceId: string
  dueDateMillis: number
  hostedInvoiceUrl?: string
  createdAt: Timestamp
  finalizedAt?: Timestamp
  sentAt?: Timestamp
  paidAt?: Timestamp
  cancelledAt?: Timestamp
}

`hostedInvoiceUrl`はFirestoreへ永続化せず、owner/adminが`getBillingOverviewCallable`を呼んだ時だけStripeから取得して返す。これにより、一般teacher、上位組織、他組織へ請求書の支払いURLを露出しない。

`organizations/{orgId}.invoiceSubscriptionRequest` は短命の冪等マーカーとして用いる。

```ts
type InvoiceSubscriptionRequest = {
  idempotencyKey: string
  status: 'CREATING' | 'ACTIVE' | 'SCHEDULED'
  requestedByUid: string
  requestedAt: Timestamp
  stripeSubscriptionId?: string
  stripeScheduleId?: string
}
```

Stripe APIの成功後にSubscriptionまたはSchedule IDを保存する。API再送は同じidempotency keyを使って既存のStripeオブジェクトを復元し、二重契約を作らない。

## 契約フロー

### 新規の請求書払い

1. owner/adminが完全な`BillingProfile`を保存する。
2. `startInvoiceSubscriptionCallable`がトランザクションで、学校種別、active membership、プロフィール、既存の処理中マーカー、既存の請求書契約を全て読み取る。
3. 書き込み前に不正状態を拒否し、問題なければ`CREATING`マーカーを確保する。
4. FunctionがStripe Customerをプロフィールと同期し、年額SCHOOL Price、`collection_method: 'send_invoice'`、`days_until_due: 30`のSubscriptionを冪等キー付きで作成する。請求書はStripeがfinalize・sendする。
5. 成功時にSubscription IDを記録し、StripeのSubscription作成状態を契約状態の正本とする。請求書発行時点で学校は利用可能である。

### カード年額契約からの切替

activeなカードSubscriptionがある場合、新しいSubscriptionを即時作成しない。Functionは既存Subscriptionの現在期間終了時から、年額SCHOOL Priceを維持した`send_invoice`・30日支払期限のフェーズへ切り替わるStripe Subscription Scheduleを作成または更新する。

現在期間中のカード契約、利用枠、現在の請求は変更しない。Schedule IDを`invoiceSubscriptionRequest.status: 'SCHEDULED'`として保存する。現在期間より前の請求、返金、日割り計算、契約の即時停止は行わない。既に同じ切替が予約済みなら、その予約を返し、二重作成しない。

### Webhook同期

`invoice.finalized`、`invoice.sent`、`invoice.paid`、`invoice.payment_failed`、`invoice.voided`を既存の署名検証済みWebhookへ追加する。各イベントはInvoice IDを請求記録のキーとして冪等に反映する。

| Stripe状態/イベント | billingRecords.status | 契約への影響 |
| --- | --- | --- |
| `invoice.finalized` | `PENDING` | 利用を維持する |
| `invoice.sent` | `PENDING` | 利用を維持する |
| `invoice.paid` | `PAID` | `subscriptionStatus: 'ACTIVE'` |
| `invoice.payment_failed` または期限後未払い | `OVERDUE` | `subscriptionStatus: 'PAST_DUE'` |
| `invoice.voided` | `CANCELLED` | Invoiceのみ取消。Subscription状態は対応するSubscriptionイベントを正本とする |

既存の`stripeSubscriptionState.eventCreatedAtMillis`の厳密な順序ガードを維持する。Invoiceイベント単独でplanIdや親契約状態を変更しない。Webhookが遅延・再送・順不同でも、新しいSubscription状態を古いイベントで戻さない。

## API・認可・UI

### Callable

```ts
saveBillingProfileCallable({ orgId, profile }): Promise<{ stripeCustomerId: string }>
startInvoiceSubscriptionCallable({ orgId }): Promise<{
  status: 'ACTIVE' | 'SCHEDULED'
  stripeSubscriptionId?: string
  stripeScheduleId?: string
}>
getBillingOverviewCallable({ orgId }): Promise<{
  profile: Omit<BillingProfile, 'updatedByUid'>
  paymentMethod: 'CARD' | 'INVOICE' | 'BANK_TRANSFER' | 'MANUAL' | null
  invoiceSubscription?: { status: 'ACTIVE' | 'SCHEDULED'; currentPeriodEndMillis?: number }
  invoices: Array<{
    id: string
    status: InvoiceBillingRecord['status']
    paymentMethod: InvoiceBillingRecord['paymentMethod']
    dueDateMillis: number
    hostedInvoiceUrl?: string
  }>
}>
```

3つのCallableは全て`asia-northeast1`に配置する。`saveBillingProfileCallable`と`startInvoiceSubscriptionCallable`はverified Google教師であり、対象学校のowner/adminだけを許可する。`getBillingOverviewCallable`も請求先・Hosted Invoice URLを返すため、同じowner/adminだけを許可する。teacher、上位組織メンバー、他組織メンバーは拒否する。

Stripe Secretを使うCallableは、既存の`STRIPE_SECRET_KEY`を`defineSecret`から参照し、各Functionの`secrets`オプションへ明示的に列挙する。clientはStripe APIを直接呼ばない。

### 画面

既存の利用枠画面にowner/admin専用の「請求・支払い」セクションを追加する。

- 請求先プロフィールの登録・更新フォーム。
- プロフィール未登録時は請求書払いの申込を無効化し、必要項目を示す。
- 新規時は「請求書払いで申し込む」、カード契約中は「次回更新から請求書払いへ切り替える」を表示する。
- 現在の請求方法、次回更新への切替予定、請求書履歴、owner/adminだけにHosted Invoice URLを表示する。
- 一般teacherには請求セクション、プロフィール、請求書URLを表示しない。

既存のCustomer Portalはカード契約の支払い方法変更・解約の入口として保持する。請求書払い中にカードPortalで矛盾する操作を誘導するUIは追加しない。

## エラー・整合性

- BillingProfileの必須値不足は`invalid-argument`で拒否する。
- 学校以外、owner/admin以外、他組織は`permission-denied`で拒否する。
- 処理中、請求書契約中、または切替予約済みは`failed-precondition`で既存申込の状態を返す。
- Stripe API失敗時は`CREATING`マーカーを失敗状態にせず、同じ冪等キーで再試行可能な状態を維持する。StripeにIDが確定している場合はそれを保存して成功として返す。
- Firestoreトランザクションは全読み取りを終えてからマーカー・監査情報を書き込む。
- Stripe CustomerとSubscriptionの作成・更新ではIdempotency-Keyを必ず指定する。

## テストと受け入れ条件

- owner/adminだけがプロフィール保存、請求書申込、請求概要取得をできる。teacher・上位組織・他組織は拒否される。
- プロフィール必須値不足、既存処理中、請求書契約中、切替予約済みを拒否する。
- 新規申込は年額SCHOOL Price、`send_invoice`、30日、冪等キーでStripe Subscriptionを作成する。
- カード契約中の申込は現在契約を変えず、次回更新のScheduleだけを作る。
- Invoice Webhookのfinalized/sent/paid/failed/voided、重複、順不同を正しく請求記録へ同期する。
- 画面はowner/adminにだけプロフィール・申込・請求書URLを表示し、一般teacherには表示しない。
- `npx tsc -b`、`npm run test`、`npm run test:rules`、`npm run lint`、`npm run verify --workspace=functions`、`npm run test:market-concurrency`を実行する。
