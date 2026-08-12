# 年額請求書サブスクリプション・請求先プロフィール Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**正本:** `docs/superpowers/specs/2026-08-12-stripe-invoicing-annual-subscription-design.md`。統合仕様書 §18.8 が上位の正本である。

**Goal:** 学校owner/adminが請求先プロフィールを使い、30日支払期限の年額Stripe請求書サブスクリプションを新規申込または次回更新から予約できるようにする。

**Architecture:** Functionsの純粋ドメイン層が検証・冪等申込を担い、Admin SDK adapterがFirestoreとStripe Customer/Subscription/Scheduleを接続する。署名検証済みWebhookがInvoice ID単位で請求状態を同期する。クライアントはCallable DTOを手動でミラーし、学校owner/adminだけに請求UIを表示する。

**Tech Stack:** TypeScript、Firebase Functions v2/Admin SDK、Firestore transactions、Stripe Node SDK、Stripe Invoicing/Billing、React、MUI、Vitest。

## Global Constraints

- Functionsは`src/`をimportしない。クライアントDTOは手動で二重管理する。
- Firestore transactionでは全読み取りを終えてから書き込む。
- 新規Callableは必ず`functions/src/index.ts`からexportする。
- `stripeSecretKey`を使うCallableは必ず`secrets: [stripeSecretKey]`を指定する。Webhookは既存の`stripeWebhookSecret`と`stripeSecretKey`を両方列挙したままにする。
- Stripe APIはテストモードの`STRIPE_SECRET_KEY`だけを`defineSecret`経由で読む。カード情報・口座・秘密鍵は保存しない。
- Stripe Customer/Subscription/Scheduleの書き込みには、予約済み申込IDから導出したidempotency keyを必ず渡す。
- 新規請求書払いは年額SCHOOL Price、`collection_method: 'send_invoice'`、`days_until_due: 30`で固定する。請求書発行時点で利用可能にし、支払確定はWebhookだけが行う。
- カード契約からの切替は次回更新日からだけにする。即時解約、返金、日割り、Quote、税、Credit Note、手動PAID更新は実装しない。
- `MANUAL`は既存の値として残すが、今回のCallable/UIから作成・確定しない。銀行振込はStripeのInvoice支払い詳細で確認できた時だけ`BANK_TRANSFER`として保存する。

### Task 1: 請求先プロフィールとStripe Customer同期

**Files:**
- Create: `functions/src/billing/billingProfile.ts`
- Create: `functions/src/billing/billingProfile.test.ts`
- Create: `functions/src/billing/billingProfileAdmin.ts`
- Create: `functions/src/billing/billingProfileAdmin.test.ts`

**Interfaces:**

```ts
export type BillingProfileInput = {
  legalName: string
  contactName: string
  email: string
  address: { postalCode: string; prefecture: string; city: string; line1: string; line2?: string }
}
export type BillingProfile = BillingProfileInput & { updatedAt: unknown; updatedByUid: string }
export const validateBillingProfile = (input: unknown): BillingProfileInput
export const saveBillingProfile: (
  deps: BillingProfileDeps,
  input: { orgId: string; profile: BillingProfileInput; actorUid: string },
) => Promise<{ stripeCustomerId: string }>
```

- [ ] **Step 1: Write the failing domain tests**

In `billingProfile.test.ts`, test that blank/whitespace legal name, contact name, email, postal code, prefecture, city, line1, and an email without `@` throw `請求先プロフィールの入力内容が不正です`. Test blank line2 is omitted. A school must use idempotency key `billing-profile:school-1` and persist Stripe’s returned Customer ID. A non-school must throw `請求書払いは学校組織のみ利用できます` before Stripe is called.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm run test --workspace=functions -- src/billing/billingProfile.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure profile domain**

Implement trimming without mutating the Callable payload. Read the organization first, require `type === 'school'`, pass a string existing Customer ID or null to the injected Stripe port, then persist validated profile, actor UID, returned Customer ID, and server timestamp through the adapter.

- [ ] **Step 4: Write failing Admin adapter tests**

Use a Firestore fake that throws on reads after writes. Assert one transaction reads `organizations/school-1` before updating only `billingProfile` and `stripeCustomerId`. Assert an existing customer calls `customers.update`; a missing ID calls `customers.create`; both set name, email, address, and the fixed idempotency key.

- [ ] **Step 5: Implement adapter, verify, and commit**

Create `saveBillingProfileWithAdminSdk` in `billingProfileAdmin.ts`, using `Stripe(stripeSecretKey.value())` and `FieldValue.serverTimestamp()`. It must not save card number, bank account, secret, or Hosted Invoice URL.

Run: `npm run test --workspace=functions -- src/billing/billingProfile.test.ts src/billing/billingProfileAdmin.test.ts`

Expected: PASS.

```bash
git add functions/src/billing/billingProfile.ts functions/src/billing/billingProfile.test.ts functions/src/billing/billingProfileAdmin.ts functions/src/billing/billingProfileAdmin.test.ts
git commit -m "feat: 請求先プロフィールをStripe Customerへ同期する"
```

### Task 2: 年額請求書Subscriptionの冪等な新規作成・次回更新予約

**Files:**
- Create: `functions/src/billing/invoiceSubscription.ts`
- Create: `functions/src/billing/invoiceSubscription.test.ts`
- Create: `functions/src/billing/invoiceSubscriptionAdmin.ts`
- Create: `functions/src/billing/invoiceSubscriptionAdmin.test.ts`

**Interfaces:**

```ts
export type InvoiceSubscriptionRequest = {
  idempotencyKey: string
  status: 'CREATING' | 'ACTIVE' | 'SCHEDULED'
  requestedByUid: string
  stripeSubscriptionId?: string
  stripeScheduleId?: string
  currentPeriodEndMillis?: number
}
export type StartInvoiceSubscriptionResult =
  | { status: 'ACTIVE'; stripeSubscriptionId: string }
  | { status: 'SCHEDULED'; stripeScheduleId: string; currentPeriodEndMillis: number }
export type InvoiceSubscriptionReservation =
  | { kind: 'EXISTING'; request: InvoiceSubscriptionRequest }
  | {
    kind: 'CREATE'
    requestId: string
    customerId: string
    priceId: string
    currentCardSubscription?: { stripeSubscriptionId: string; currentPeriodEndMillis: number }
  }
export interface InvoiceSubscriptionDeps {
  reserveRequest: (orgId: string, actorUid: string) => Promise<InvoiceSubscriptionReservation>
  createSendInvoiceSubscription: (input: { customerId: string; priceId: string; collectionMethod: 'send_invoice'; daysUntilDue: 30; idempotencyKey: string }) => Promise<{ stripeSubscriptionId: string }>
  scheduleSendInvoiceAtPeriodEnd: (input: { stripeSubscriptionId: string; customerId: string; priceId: string; startDateMillis: number; collectionMethod: 'send_invoice'; daysUntilDue: 30; idempotencyKey: string }) => Promise<{ stripeScheduleId: string }>
  finalizeActive: (orgId: string, requestId: string, stripeSubscriptionId: string) => Promise<void>
  finalizeScheduled: (orgId: string, requestId: string, stripeScheduleId: string, currentPeriodEndMillis: number) => Promise<void>
}
export type BillingOverview = {
  profile: BillingProfileInput | null
  paymentMethod: 'CARD' | 'INVOICE' | 'BANK_TRANSFER' | 'MANUAL' | null
  invoiceSubscription?: { status: 'ACTIVE' | 'SCHEDULED'; currentPeriodEndMillis?: number }
  invoices: Array<{ id: string; status: 'DRAFT' | 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELLED'; paymentMethod: 'INVOICE' | 'BANK_TRANSFER'; dueDateMillis: number; hostedInvoiceUrl?: string }>
}
export const startInvoiceSubscription: (
  deps: InvoiceSubscriptionDeps,
  input: { orgId: string; actorUid: string },
) => Promise<StartInvoiceSubscriptionResult>
```

- [ ] **Step 1: Write the failing coordinator tests**

Test these preconditions before Stripe: school type, complete billingProfile, string Customer ID, and `planDefinitions/SCHOOL.stripePriceId`. ACTIVE/SCHEDULED markers return saved IDs without Stripe; CREATING throws `請求書払いの申込を処理中です`. A current card Subscription with finite period end selects schedule; no card Subscription selects create.

Assert the new-subscription port receives exactly the customer, SCHOOL Price, `send_invoice`, 30 days, and stable request idempotency key. Assert the schedule port also receives current Subscription ID and period-end milliseconds.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm run test --workspace=functions -- src/billing/invoiceSubscription.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure coordinator**

Separate transaction-backed precondition/reservation, create, schedule, ACTIVE finalization, and SCHEDULED finalization ports. Allocate request ID inside reservation and construct the idempotency key from organization ID and that request ID. Preserve CREATING if Stripe fails so retry keeps the same key.

- [ ] **Step 4: Write failing Admin adapter tests**

Use a transaction fake that asserts reservation reads organization, `planDefinitions/SCHOOL`, and request marker before writing it. With no card Subscription assert `subscriptions.create` receives:

```ts
{
  customer: 'cus_1',
  items: [{ price: 'price_school', quantity: 1 }],
  collection_method: 'send_invoice',
  days_until_due: 30,
  metadata: { orgId: 'school-1', billingMode: 'invoice' },
}
```

Seed current period end `1800000000` and assert schedule input uses milliseconds. Assert no adapter path cancels, refunds, or updates the active card Subscription before its end. Assert all Stripe writes get the reservation idempotency key.

- [ ] **Step 5: Implement adapter, verify, and commit**

After reservation, retrieve the current Stripe Subscription and create a future Subscription Schedule at its period end with SCHOOL Price, send_invoice, and 30 days. Finalization transactions re-read the marker before changing CREATING to ACTIVE/SCHEDULED; the same saved Stripe ID is a no-op.

Run: `npm run test --workspace=functions -- src/billing/invoiceSubscription.test.ts src/billing/invoiceSubscriptionAdmin.test.ts`

Expected: PASS.

```bash
git add functions/src/billing/invoiceSubscription.ts functions/src/billing/invoiceSubscription.test.ts functions/src/billing/invoiceSubscriptionAdmin.ts functions/src/billing/invoiceSubscriptionAdmin.test.ts
git commit -m "feat: 年額請求書サブスクリプションを予約する"
```

### Task 3: Billing Callables・認可・export

**Files:**
- Modify: `functions/src/billing/onCall.ts`
- Modify: `functions/src/billing/onCall.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**

```ts
saveBillingProfileCallable({ orgId: string; profile: BillingProfileInput }): Promise<{ stripeCustomerId: string }>
startInvoiceSubscriptionCallable({ orgId: string }): Promise<StartInvoiceSubscriptionResult>
getBillingOverviewCallable({ orgId: string }): Promise<BillingOverview>
```

- [ ] **Step 1: Write failing Callable authorization tests**

Mock active membership and the three Admin adapters. Assert unauthenticated is unauthenticated; unverified/non-Google and teacher are permission-denied; owner/admin pass actor UID; missing payload is invalid-argument; incomplete profile, duplicate request, and missing price are failed-precondition; Stripe outage is unavailable. Inspect callable options to assert every new handler lists stripeSecretKey.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm run test --workspace=functions -- src/billing/onCall.test.ts`

Expected: FAIL because the Callables and adapter imports do not exist.

- [ ] **Step 3: Implement Callables and overview reader**

Add three `onCall` handlers in billing/onCall with asia-northeast1 and stripeSecretKey. Reuse isCallerTeacher and requireActiveOrgMember, explicitly allowing owner/admin only. Add `getBillingOverviewWithAdminSdk`: read only this organization’s summary and billingRecords, retrieve current Invoice URLs on the server, and return no raw Stripe object or updatedByUid.

- [ ] **Step 4: Export, verify, and commit**

Export all three from functions/index.ts.

Run: `npm run test --workspace=functions -- src/billing/onCall.test.ts src/billing/billingProfile.test.ts src/billing/invoiceSubscription.test.ts`

Expected: PASS.

```bash
git add functions/src/billing/onCall.ts functions/src/billing/onCall.test.ts functions/src/billing/invoiceSubscriptionAdmin.ts functions/src/index.ts
git commit -m "feat: 請求書払いの認可済みCallableを追加する"
```

### Task 4: Stripe Invoice Webhookの状態・支払方法同期

**Files:**
- Modify: `functions/src/billing/stripeWebhook.ts`
- Modify: `functions/src/billing/stripeWebhook.test.ts`

**Interfaces:**

```ts
type StripeInvoiceLifecycleEvent = {
  type: 'invoice.finalized' | 'invoice.sent' | 'invoice.paid' | 'invoice.payment_failed' | 'invoice.voided'
  invoiceId: string
  stripeCustomerId: string
  stripeSubscriptionId?: string
  dueDateMillis?: number
  paymentMethod: 'INVOICE' | 'BANK_TRANSFER'
  eventCreatedAtMillis: number
}
syncInvoiceBillingRecord: (orgId: string, event: StripeInvoiceLifecycleEvent) => Promise<void>
```

- [ ] **Step 1: Write failing webhook tests**

Assert finalized/sent produce one PENDING `billingRecords/{invoiceId}`; paid becomes PAID; failed becomes OVERDUE; voided becomes CANCELLED. Equal/older event time cannot regress terminal records. BANK_TRANSFER is used only when Stripe invoice payment detail identifies bank transfer. Assert invoice events do not call subscription-state sync, do not change planId, and do not mutate parent-contract fields.

- [ ] **Step 2: Run focused test to verify it fails**

Run: `npm run test --workspace=functions -- src/billing/stripeWebhook.test.ts`

Expected: FAIL because Invoice lifecycle metadata and synchronizer do not exist.

- [ ] **Step 3: Implement ordered invoice synchronization**

Extend event extraction and handler for finalized/sent/paid/failed/voided. Preserve existing CARD invoice paid/failure behavior; add `syncInvoiceBillingRecord` for invoice-mode events. Its transaction reads organization and billing record before writing; compares lastStripeEventCreatedAtMillis; saves Invoice/Subscription IDs, due date, payment method, lifecycle times, and accepted event time; and changes subscriptionStatus only for accepted paid/failed events. voided never cancels a Subscription.

- [ ] **Step 4: Verify and commit**

Run: `npm run test --workspace=functions -- src/billing/stripeWebhook.test.ts`

Expected: PASS.

```bash
git add functions/src/billing/stripeWebhook.ts functions/src/billing/stripeWebhook.test.ts
git commit -m "feat: Stripe請求書の状態を冪等同期する"
```

### Task 5: クライアントDTO・請求画面・利用枠ルート

**Files:**
- Create: `src/lib/billing/invoiceSubscription.ts`
- Create: `src/lib/billing/invoiceSubscription.test.ts`
- Create: `src/components/teacher/organizations/BillingSection.tsx`
- Create: `src/components/teacher/organizations/BillingSection.test.tsx`
- Modify: `src/components/teacher/organizations/PlanLimitsPage.tsx`
- Modify: `src/components/teacher/organizations/PlanLimitsPage.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**

```ts
export type BillingProfileInput = {
  legalName: string; contactName: string; email: string
  address: { postalCode: string; prefecture: string; city: string; line1: string; line2?: string }
}
export type BillingOverview = {
  profile: BillingProfileInput | null
  paymentMethod: 'CARD' | 'INVOICE' | 'BANK_TRANSFER' | 'MANUAL' | null
  invoiceSubscription?: { status: 'ACTIVE' | 'SCHEDULED'; currentPeriodEndMillis?: number }
  invoices: Array<{ id: string; status: 'DRAFT' | 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELLED'; paymentMethod: 'INVOICE' | 'BANK_TRANSFER'; dueDateMillis: number; hostedInvoiceUrl?: string }>
}
export const saveBillingProfile: (functions: Functions, input: { orgId: string; profile: BillingProfileInput }) => Promise<{ stripeCustomerId: string }>
export const startInvoiceSubscription: (functions: Functions, input: { orgId: string }) => Promise<StartInvoiceSubscriptionResult>
export const getBillingOverview: (functions: Functions, input: { orgId: string }) => Promise<BillingOverview>
```

- [ ] **Step 1: Write failing wrapper tests**

Mock httpsCallable and assert exact Callable names, exact input, and data unwrapping. Include a SCHEDULED result with currentPeriodEndMillis.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm run test -- src/lib/billing/invoiceSubscription.test.ts`

Expected: FAIL because the client module does not exist.

- [ ] **Step 3: Implement wrappers**

Mirror three Callable DTOs with no Admin/Stripe imports. Do not expose updatedByUid, raw BillingRecord, or unneeded Stripe IDs.

- [ ] **Step 4: Write failing BillingSection tests**

Test owner/admin sees profile fields, disabled request without profile, new label `請求書払いで申し込む`, card label `次回更新から請求書払いへ切り替える`, scheduled date, and Invoice link. Test canManageBilling false renders none of profile, action, or Hosted Invoice URL. Test pending action disables a duplicate click.

- [ ] **Step 5: Implement section and route**

Create presentational MUI BillingSection owning profile draft state. Add optional billingSection to PlanLimitsPage after plan-limit status. In App reuse listOrgMembers/current UID to derive canManageBilling only from owner/admin. Fetch overview only for an authorized school manager. Wire save/start loading/error and refresh overview plus plan data after success. Preserve Checkout and Customer Portal flows.

- [ ] **Step 6: Verify focused UI tests and commit**

Run: `npm run test -- src/lib/billing/invoiceSubscription.test.ts src/components/teacher/organizations/BillingSection.test.tsx src/components/teacher/organizations/PlanLimitsPage.test.tsx src/App.test.tsx`

Expected: PASS.

```bash
git add src/lib/billing/invoiceSubscription.ts src/lib/billing/invoiceSubscription.test.ts src/components/teacher/organizations/BillingSection.tsx src/components/teacher/organizations/BillingSection.test.tsx src/components/teacher/organizations/PlanLimitsPage.tsx src/components/teacher/organizations/PlanLimitsPage.test.tsx src/App.tsx src/App.test.tsx
git commit -m "feat: 年額請求書払いの申込画面を追加する"
```

### Task 6: 統合検証と境界確認

**Files:** No production-file changes.

- [ ] **Step 1: Run mandatory verification**

```bash
npx tsc -b
npm run test
npm run test:rules
npm run lint
npm run verify --workspace=functions
npm run test:market-concurrency
```

Expected: every command exits 0. Record pre-existing lint and emulator warnings without suppressing them.

- [ ] **Step 2: Inspect acceptance boundaries**

Confirm all new Callables are exported; every secret-using Callable lists stripeSecretKey; no Function imports src; no client marks payment PAID; Invoice URL is never returned to teacher/parent-org; transaction reads precede writes; new Subscription is send_invoice/30 days; card Subscription is not canceled or modified before period end; and Invoice events cannot alter planId or parent-contract state.

- [ ] **Step 3: Do not commit unrelated files**

Do not commit emulator logs, .claude, Stripe secrets, or unrelated worktree changes.
