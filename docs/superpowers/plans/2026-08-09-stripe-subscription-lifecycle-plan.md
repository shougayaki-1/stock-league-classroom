# サブスクリプションのライフサイクル管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**正本:** `docs/superpowers/specs/2026-08-09-stripe-subscription-lifecycle-design.md`(設計仕様)。矛盾する場合は仕様書を優先する。

**Goal:** `invoice.paid`・`invoice.payment_failed`・`customer.subscription.deleted`のWebhookを処理して組織の`subscriptionStatus`と`billingRecords`を継続的に更新し、教師がStripe Customer Portalで支払い方法変更・解約をセルフサービスできるようにする。

**Architecture:** 既存の`handleStripeWebhookEvent`(`functions/src/billing/stripeWebhook.ts`)を拡張し、Stripe顧客ID⇔組織IDの順引き/逆引きインデックス(`organizations/{orgId}.stripeCustomerId`・`stripeCustomers/{customerId}`)を導入する。Customer Portalは既存の`createStripeCheckoutSessionCallable`と対になる新規Callableとして追加する。

**Tech Stack:** TypeScript, React, MUI, Firebase Cloud Functions v2 (`onCall`/`onRequest`), Stripe Node SDK, Firebase Admin SDK (Firestore), Vitest, React Testing Library。

## Global Constraints

- 本計画は**Phase Fサブプロジェクト6(Stripe Checkout導線)の完了を前提とする**(`functions/src/billing/stripeCheckout.ts`・`stripeWebhook.ts`・`onCall.ts`が既に存在し、`stripeWebhookCallable`の`secrets`に`stripeWebhookSecret`・`stripeSecretKey`の両方が宣言済み、2026-08-09時点で実装済み)。
- `invoice.paid`/`invoice.payment_failed`の冪等性はStripeの`invoice.id`で判定する(既存の`checkout.session.completed`は`billingRecords`の`status`で判定しており、方式が異なる——請求書は毎回新しいレコードを作るため、同じレコードのstatus変化では判定できない)。
- Webhookで顧客IDの逆引きに失敗した場合(`stripeCustomers/{customerId}`が存在しない)は、ログに残して200を返す(既存の「不整合はWebhookの5xxで表現しない」方針を踏襲)。
- Customer Portalの認可は`createStripeCheckoutSessionCallable`と同じ(owner/adminのみ)。
- 新規Callableは`functions/src/index.ts`からexportする。
- 日本語UI文言を用いる。
- 各タスクの実装後、そのタスクが変更したファイルのテストを実行してから次のタスクに進む。全タスク完了後、`npm run verify`を実行し、通過することを確認してからコミットする。

---

## File Structure

| File | Change |
| --- | --- |
| `functions/src/billing/stripeWebhook.ts`, `.test.ts` | Modify（Task 1） |
| `functions/src/billing/stripeCustomerPortal.ts`, `.test.ts` | Create（Task 2） |
| `functions/src/billing/onCall.ts`, `.test.ts` | Modify（Task 3。Callable追加） |
| `functions/src/index.ts` | Modify（Task 3。export追加） |
| `src/lib/billing/stripeCustomerPortal.ts`, `.test.ts` | Create（Task 4） |
| `src/components/teacher/organizations/PlanLimitsPage.tsx`, `.test.tsx` | Modify（Task 5） |
| `src/App.tsx`, `.test.tsx` | Modify（Task 5） |

---

### Task 1: `handleStripeWebhookEvent`の拡張(3イベント追加+顧客IDインデックス)

**Files:**
- Modify: `functions/src/billing/stripeWebhook.ts`
- Modify: `functions/src/billing/stripeWebhook.test.ts`

**Interfaces:**
- Consumes: なし。
- Produces: `StripeWebhookEvent`型の拡張(判別可能なユニオン型)、`HandleStripeWebhookEventDeps`の拡張、`handleStripeWebhookEvent`が`invoice.paid`/`invoice.payment_failed`/`customer.subscription.deleted`を処理するようになる。`stripeWebhookCallable`(onRequest)が3イベントすべてを`handleStripeWebhookEvent`へ正しく振り分ける。

**設計メモ:** 既存の2つのテスト(`'ignores unrelated and malformed events'`・`'marks a pending record paid and is idempotent'`)は、`stripeCustomerId`/`invoiceId`を含まない入力を使っているため、本タスクの変更後もそのまま(無変更で)通過する——`invoice.payment_failed`等の新しい分岐は`event.stripeCustomerId`が無ければ即returnするため、既存テストが渡す不完全な`deps`(新しいメソッドを持たない)でも呼ばれずに済む。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/billing/stripeWebhook.test.ts`に以下のテストを追記する(既存の2つのテストは変更しない):

```ts
describe('handleStripeWebhookEvent — subscription lifecycle', () => {
  it('links the Stripe customer id on checkout.session.completed', async () => {
    const linkStripeCustomer = vi.fn()
    await handleStripeWebhookEvent({
      getBillingRecord: async () => ({ status: 'PENDING' }), markBillingRecordPaid: vi.fn(), linkStripeCustomer,
      getOrgIdForStripeCustomer: vi.fn(), setSubscriptionStatus: vi.fn(), hasBillingRecordForInvoice: vi.fn(), createBillingRecordForInvoice: vi.fn(),
    }, { type: 'checkout.session.completed', clientReferenceId: 'org-1:record-1', stripeSessionId: 's', stripeCustomerId: 'cus_1' })
    expect(linkStripeCustomer).toHaveBeenCalledWith('org-1', 'cus_1')
  })

  it('marks the subscription ACTIVE and records a new PAID billing record on invoice.paid', async () => {
    const setSubscriptionStatus = vi.fn()
    const createBillingRecordForInvoice = vi.fn()
    await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(), linkStripeCustomer: vi.fn(),
      getOrgIdForStripeCustomer: async (id) => { expect(id).toBe('cus_1'); return 'org-1' },
      setSubscriptionStatus, hasBillingRecordForInvoice: async () => false, createBillingRecordForInvoice,
    }, { type: 'invoice.paid', invoiceId: 'in_1', stripeCustomerId: 'cus_1' })
    expect(setSubscriptionStatus).toHaveBeenCalledWith('org-1', 'ACTIVE')
    expect(createBillingRecordForInvoice).toHaveBeenCalledWith('org-1', 'in_1', 'PAID')
  })

  it('is idempotent per invoice id on invoice.paid', async () => {
    const setSubscriptionStatus = vi.fn()
    const createBillingRecordForInvoice = vi.fn()
    await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(), linkStripeCustomer: vi.fn(),
      getOrgIdForStripeCustomer: async () => 'org-1', setSubscriptionStatus, hasBillingRecordForInvoice: async () => true, createBillingRecordForInvoice,
    }, { type: 'invoice.paid', invoiceId: 'in_1', stripeCustomerId: 'cus_1' })
    expect(setSubscriptionStatus).not.toHaveBeenCalled()
    expect(createBillingRecordForInvoice).not.toHaveBeenCalled()
  })

  it('marks the subscription PAST_DUE and records OVERDUE on invoice.payment_failed', async () => {
    const setSubscriptionStatus = vi.fn()
    const createBillingRecordForInvoice = vi.fn()
    await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(), linkStripeCustomer: vi.fn(),
      getOrgIdForStripeCustomer: async () => 'org-1', setSubscriptionStatus, hasBillingRecordForInvoice: async () => false, createBillingRecordForInvoice,
    }, { type: 'invoice.payment_failed', invoiceId: 'in_2', stripeCustomerId: 'cus_1' })
    expect(setSubscriptionStatus).toHaveBeenCalledWith('org-1', 'PAST_DUE')
    expect(createBillingRecordForInvoice).toHaveBeenCalledWith('org-1', 'in_2', 'OVERDUE')
  })

  it('marks the subscription CANCELED on customer.subscription.deleted', async () => {
    const setSubscriptionStatus = vi.fn()
    await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(), linkStripeCustomer: vi.fn(),
      getOrgIdForStripeCustomer: async () => 'org-1', setSubscriptionStatus, hasBillingRecordForInvoice: vi.fn(), createBillingRecordForInvoice: vi.fn(),
    }, { type: 'customer.subscription.deleted', stripeCustomerId: 'cus_1' })
    expect(setSubscriptionStatus).toHaveBeenCalledWith('org-1', 'CANCELED')
  })

  it('does nothing when the Stripe customer id cannot be resolved to an organization', async () => {
    const setSubscriptionStatus = vi.fn()
    await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(), linkStripeCustomer: vi.fn(),
      getOrgIdForStripeCustomer: async () => null, setSubscriptionStatus, hasBillingRecordForInvoice: vi.fn(), createBillingRecordForInvoice: vi.fn(),
    }, { type: 'invoice.paid', invoiceId: 'in_1', stripeCustomerId: 'cus_unknown' })
    expect(setSubscriptionStatus).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/billing/stripeWebhook.test.ts`
Expected: FAIL（新しいdepsメソッド・イベント型が存在しない）

- [ ] **Step 3: 実装する**

`functions/src/billing/stripeWebhook.ts`を以下の内容に置き換える:

```ts
import { getFirestore } from 'firebase-admin/firestore'
import { onRequest } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import Stripe from 'stripe'
import { stripeSecretKey } from './stripeCheckout'

export const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET')

export type StripeWebhookEvent =
  | { type: 'checkout.session.completed'; clientReferenceId?: string; stripeSessionId?: string; stripeCustomerId?: string }
  | { type: 'invoice.paid' | 'invoice.payment_failed'; invoiceId?: string; stripeCustomerId?: string }
  | { type: 'customer.subscription.deleted'; stripeCustomerId?: string }
  | { type: string }

export interface HandleStripeWebhookEventDeps {
  getBillingRecord: (orgId: string, recordId: string) => Promise<{ status: string } | null>
  markBillingRecordPaid: (orgId: string, recordId: string, stripeSessionId: string) => Promise<void>
  linkStripeCustomer: (orgId: string, stripeCustomerId: string) => Promise<void>
  getOrgIdForStripeCustomer: (stripeCustomerId: string) => Promise<string | null>
  setSubscriptionStatus: (orgId: string, status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED') => Promise<void>
  hasBillingRecordForInvoice: (orgId: string, invoiceId: string) => Promise<boolean>
  createBillingRecordForInvoice: (orgId: string, invoiceId: string, status: 'PAID' | 'OVERDUE') => Promise<void>
}

const parseClientReferenceId = (value: string): { orgId: string; recordId: string } | null => {
  const separatorIndex = value.indexOf(':')
  if (separatorIndex < 1 || separatorIndex === value.length - 1) return null
  return { orgId: value.slice(0, separatorIndex), recordId: value.slice(separatorIndex + 1) }
}

/**
 * Handles the 4 subscription-lifecycle events this app cares about.
 * checkout.session.completed uses billingRecords.status for idempotency
 * (the record already exists, created by createStripeCheckoutSession);
 * invoice.paid/invoice.payment_failed use Stripe's own invoice id instead,
 * since each billing cycle creates a brand-new billingRecords entry rather
 * than reusing one (see this task's design note in the plan).
 */
export const handleStripeWebhookEvent = async (deps: HandleStripeWebhookEventDeps, event: StripeWebhookEvent): Promise<void> => {
  switch (event.type) {
    case 'checkout.session.completed': {
      if (!event.clientReferenceId || !event.stripeSessionId) return
      const parsed = parseClientReferenceId(event.clientReferenceId)
      if (!parsed) return
      const record = await deps.getBillingRecord(parsed.orgId, parsed.recordId)
      if (record && record.status !== 'PAID') await deps.markBillingRecordPaid(parsed.orgId, parsed.recordId, event.stripeSessionId)
      if (event.stripeCustomerId) await deps.linkStripeCustomer(parsed.orgId, event.stripeCustomerId)
      return
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      if (!event.invoiceId || !event.stripeCustomerId) return
      const orgId = await deps.getOrgIdForStripeCustomer(event.stripeCustomerId)
      if (!orgId) return
      if (await deps.hasBillingRecordForInvoice(orgId, event.invoiceId)) return
      const status = event.type === 'invoice.paid' ? 'ACTIVE' : 'PAST_DUE'
      const recordStatus = event.type === 'invoice.paid' ? 'PAID' : 'OVERDUE'
      await deps.setSubscriptionStatus(orgId, status)
      await deps.createBillingRecordForInvoice(orgId, event.invoiceId, recordStatus)
      return
    }
    case 'customer.subscription.deleted': {
      if (!event.stripeCustomerId) return
      const orgId = await deps.getOrgIdForStripeCustomer(event.stripeCustomerId)
      if (!orgId) return
      await deps.setSubscriptionStatus(orgId, 'CANCELED')
      return
    }
    default:
      return
  }
}

const extractEvent = (stripeEvent: Stripe.Event): StripeWebhookEvent => {
  switch (stripeEvent.type) {
    case 'checkout.session.completed': {
      const session = stripeEvent.data.object as Stripe.Checkout.Session
      return {
        type: 'checkout.session.completed',
        clientReferenceId: session.client_reference_id ?? undefined,
        stripeSessionId: session.id,
        stripeCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
      }
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const invoice = stripeEvent.data.object as Stripe.Invoice
      return {
        type: stripeEvent.type,
        invoiceId: invoice.id,
        stripeCustomerId: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id,
      }
    }
    case 'customer.subscription.deleted': {
      const subscription = stripeEvent.data.object as Stripe.Subscription
      return {
        type: 'customer.subscription.deleted',
        stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id,
      }
    }
    default:
      return { type: stripeEvent.type }
  }
}

/** Production wiring: verifies the Stripe signature, then dispatches to handleStripeWebhookEvent. */
export const stripeWebhookCallable = onRequest({ region: 'asia-northeast1', secrets: [stripeWebhookSecret, stripeSecretKey] }, async (request, response) => {
  const signature = request.headers['stripe-signature']
  if (typeof signature !== 'string') { response.status(400).send('Missing signature'); return }

  let stripeEvent: Stripe.Event
  try {
    stripeEvent = new Stripe(stripeSecretKey.value()).webhooks.constructEvent(request.rawBody, signature, stripeWebhookSecret.value())
  } catch {
    response.status(400).send('Invalid signature')
    return
  }

  const db = getFirestore()
  await handleStripeWebhookEvent({
    getBillingRecord: async (orgId, recordId) => {
      const snap = await db.doc(`organizations/${orgId}/billingRecords/${recordId}`).get()
      return snap.exists ? (snap.data() as { status: string }) : null
    },
    markBillingRecordPaid: async (orgId, recordId, stripeSessionId) => {
      await db.doc(`organizations/${orgId}/billingRecords/${recordId}`).update({ status: 'PAID', paidAt: new Date().toISOString(), stripeSessionId })
    },
    linkStripeCustomer: async (orgId, stripeCustomerId) => {
      await db.doc(`organizations/${orgId}`).update({ stripeCustomerId })
      await db.doc(`stripeCustomers/${stripeCustomerId}`).set({ orgId })
    },
    getOrgIdForStripeCustomer: async (stripeCustomerId) => {
      const snap = await db.doc(`stripeCustomers/${stripeCustomerId}`).get()
      return snap.exists ? (snap.get('orgId') as string) : null
    },
    setSubscriptionStatus: async (orgId, status) => { await db.doc(`organizations/${orgId}`).update({ subscriptionStatus: status }) },
    hasBillingRecordForInvoice: async (orgId, invoiceId) => {
      const snap = await db.collection(`organizations/${orgId}/billingRecords`).where('stripeInvoiceId', '==', invoiceId).limit(1).get()
      return !snap.empty
    },
    createBillingRecordForInvoice: async (orgId, invoiceId, status) => {
      await db.collection(`organizations/${orgId}/billingRecords`).add({
        status, paymentMethod: 'CARD', stripeInvoiceId: invoiceId, createdAt: new Date().toISOString(),
      })
    },
  }, extractEvent(stripeEvent))

  response.status(200).send('ok')
})
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/billing/stripeWebhook.test.ts`
Expected: PASS（新しいテスト・既存の2テストいずれも通過する）

- [ ] **Step 5: コミット**

```bash
git add functions/src/billing/stripeWebhook.ts functions/src/billing/stripeWebhook.test.ts
git commit -m "feat: invoice.paid/invoice.payment_failed/customer.subscription.deletedのWebhook処理を追加"
```

---

### Task 2: `createStripeCustomerPortalSession`（純粋関数）

**Files:**
- Create: `functions/src/billing/stripeCustomerPortal.ts`
- Test: `functions/src/billing/stripeCustomerPortal.test.ts`

**Interfaces:**
- Consumes: `stripeSecretKey`（既存、`functions/src/billing/stripeCheckout.ts`）。
- Produces: `createStripeCustomerPortalSession(deps, input): Promise<{url: string}>`、`createStripeCustomerPortalSessionWithAdminSdk(input): Promise<{url: string}>`。Task 3で消費される。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// functions/src/billing/stripeCustomerPortal.test.ts
import { describe, expect, it, vi } from 'vitest'
import { createStripeCustomerPortalSession } from './stripeCustomerPortal'

describe('createStripeCustomerPortalSession', () => {
  it('rejects an organization with no stripeCustomerId', async () => {
    await expect(createStripeCustomerPortalSession({
      getStripeCustomerId: async () => null, createPortalSession: vi.fn(),
    }, { orgId: 'org-1', returnUrl: 'https://x/return' })).rejects.toThrow('まだ決済履歴がありません')
  })

  it('creates a portal session for the organization\'s Stripe customer', async () => {
    const createPortalSession = vi.fn().mockResolvedValue({ url: 'https://billing.stripe.com/p/x' })
    const result = await createStripeCustomerPortalSession({
      getStripeCustomerId: async (orgId) => { expect(orgId).toBe('org-1'); return 'cus_1' }, createPortalSession,
    }, { orgId: 'org-1', returnUrl: 'https://x/return' })
    expect(createPortalSession).toHaveBeenCalledWith({ customerId: 'cus_1', returnUrl: 'https://x/return' })
    expect(result).toEqual({ url: 'https://billing.stripe.com/p/x' })
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/billing/stripeCustomerPortal.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装する**

```ts
// functions/src/billing/stripeCustomerPortal.ts
import { getFirestore } from 'firebase-admin/firestore'
import Stripe from 'stripe'
import { stripeSecretKey } from './stripeCheckout'

export interface CreateStripeCustomerPortalSessionDeps {
  getStripeCustomerId: (orgId: string) => Promise<string | null>
  createPortalSession: (input: { customerId: string; returnUrl: string }) => Promise<{ url: string }>
}
export interface CreateStripeCustomerPortalSessionInput { orgId: string; returnUrl: string }

export const createStripeCustomerPortalSession = async (
  deps: CreateStripeCustomerPortalSessionDeps,
  input: CreateStripeCustomerPortalSessionInput,
): Promise<{ url: string }> => {
  const customerId = await deps.getStripeCustomerId(input.orgId)
  if (!customerId) throw new Error('まだ決済履歴がありません')
  return deps.createPortalSession({ customerId, returnUrl: input.returnUrl })
}

/** Production wiring: Firestore Admin SDK + Stripe SDK. */
export const createStripeCustomerPortalSessionWithAdminSdk = (input: CreateStripeCustomerPortalSessionInput): Promise<{ url: string }> => {
  const db = getFirestore()
  const stripe = new Stripe(stripeSecretKey.value())
  return createStripeCustomerPortalSession({
    getStripeCustomerId: async (orgId) => {
      const snap = await db.doc(`organizations/${orgId}`).get()
      return snap.exists ? (snap.get('stripeCustomerId') as string | undefined) ?? null : null
    },
    createPortalSession: async ({ customerId, returnUrl }) => {
      const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl })
      return { url: session.url }
    },
  }, input)
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/billing/stripeCustomerPortal.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add functions/src/billing/stripeCustomerPortal.ts functions/src/billing/stripeCustomerPortal.test.ts
git commit -m "feat: Stripe Customer Portalセッション作成ロジックを追加"
```

---

### Task 3: `createStripeCustomerPortalSessionCallable`

**Files:**
- Modify: `functions/src/billing/onCall.ts`
- Modify: `functions/src/billing/onCall.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: `createStripeCustomerPortalSessionWithAdminSdk`（Task 2）、`requireActiveOrgMember`（既存）。
- Produces: `createStripeCustomerPortalSessionCallable`。入力`{orgId, returnUrl}`、出力`{url: string}`。Task 4で消費される。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/billing/onCall.test.ts`の`import`・`vi.mock`群に追記する:

```ts
import { createStripeCustomerPortalSessionCallable } from './onCall'
import { createStripeCustomerPortalSessionWithAdminSdk } from './stripeCustomerPortal'

vi.mock('./stripeCustomerPortal', () => ({ createStripeCustomerPortalSessionWithAdminSdk: vi.fn() }))
```

ファイル末尾に追記する:

```ts
describe('createStripeCustomerPortalSessionCallable', () => {
  beforeEach(() => vi.clearAllMocks())
  const portalRequest = { auth, data: { orgId: 'org-1', returnUrl: 'https://x/return' } } as unknown as CallableRequest

  it('rejects a non-manager', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    await expect(createStripeCustomerPortalSessionCallable.run(portalRequest)).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('creates a portal session for an owner', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    vi.mocked(createStripeCustomerPortalSessionWithAdminSdk).mockResolvedValueOnce({ url: 'https://billing.stripe.com/p/x' })
    await expect(createStripeCustomerPortalSessionCallable.run(portalRequest)).resolves.toEqual({ url: 'https://billing.stripe.com/p/x' })
  })

  it('translates a missing stripeCustomerId into failed-precondition', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    vi.mocked(createStripeCustomerPortalSessionWithAdminSdk).mockRejectedValueOnce(new Error('まだ決済履歴がありません'))
    await expect(createStripeCustomerPortalSessionCallable.run(portalRequest)).rejects.toMatchObject({ code: 'failed-precondition' })
  })
})
```

（この`onCall.test.ts`の`auth`定数は既存のものをそのまま使う。）

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/billing/onCall.test.ts`
Expected: FAIL（`createStripeCustomerPortalSessionCallable`が存在しない）

- [ ] **Step 3: 実装する**

`functions/src/billing/onCall.ts`の`import`群に追記する:

```ts
import { createStripeCustomerPortalSessionWithAdminSdk } from './stripeCustomerPortal'
```

ファイル末尾に追記する:

```ts
interface CreateStripeCustomerPortalSessionRequest { orgId?: unknown; returnUrl?: unknown }

export const createStripeCustomerPortalSessionCallable = onCall({ region: 'asia-northeast1', secrets: [stripeSecretKey] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as CreateStripeCustomerPortalSessionRequest
  if (typeof data.orgId !== 'string' || typeof data.returnUrl !== 'string') throw new HttpsError('invalid-argument', '入力内容が不正です。')
  const membership = await requireActiveOrgMember(getFirestore(), data.orgId, request.auth.uid)
  if (membership.role !== 'owner' && membership.role !== 'admin') {
    throw new HttpsError('permission-denied', 'owner または admin のみ支払い設定を変更できます。')
  }
  try {
    return await createStripeCustomerPortalSessionWithAdminSdk({ orgId: data.orgId, returnUrl: data.returnUrl })
  } catch (error) {
    if (error instanceof Error && error.message === 'まだ決済履歴がありません') throw new HttpsError('failed-precondition', error.message)
    throw new HttpsError('unavailable', 'ポータルセッションの作成に失敗しました。時間をおいて再試行してください。')
  }
})
```

`functions/src/index.ts`に以下を追記する:

```ts
export { createStripeCustomerPortalSessionCallable } from './billing/onCall'
```

（既存の`export { createStripeCheckoutSessionCallable } from './billing/onCall'`とは別行のまま残してよい、あるいは1つのexportブロックへまとめてもよい。）

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/billing/onCall.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add functions/src/billing/onCall.ts functions/src/billing/onCall.test.ts functions/src/index.ts
git commit -m "feat: createStripeCustomerPortalSessionCallableを追加"
```

---

### Task 4: クライアントラッパー

**Files:**
- Create: `src/lib/billing/stripeCustomerPortal.ts`
- Test: `src/lib/billing/stripeCustomerPortal.test.ts`

**Interfaces:**
- Produces: `createStripeCustomerPortalSession(functions, {orgId, returnUrl}): Promise<{url: string}>`。Task 5で消費される。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/billing/stripeCustomerPortal.test.ts
import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { createStripeCustomerPortalSession } from './stripeCustomerPortal'
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

describe('createStripeCustomerPortalSession', () => {
  it('calls createStripeCustomerPortalSessionCallable with the input', async () => {
    const call = vi.fn().mockResolvedValue({ data: { url: 'https://billing.stripe.com/p/x' } })
    vi.mocked(httpsCallable).mockReturnValue(call as never)
    const input = { orgId: 'org-1', returnUrl: 'https://x/return' }
    await expect(createStripeCustomerPortalSession({} as never, input)).resolves.toEqual({ url: 'https://billing.stripe.com/p/x' })
    expect(httpsCallable).toHaveBeenCalledWith({}, 'createStripeCustomerPortalSessionCallable')
    expect(call).toHaveBeenCalledWith(input)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/lib/billing/stripeCustomerPortal.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装する**

```ts
// src/lib/billing/stripeCustomerPortal.ts
import { httpsCallable, type Functions } from 'firebase/functions'

export interface CreateStripeCustomerPortalSessionInput { orgId: string; returnUrl: string }
export interface CreateStripeCustomerPortalSessionResult { url: string }

export const createStripeCustomerPortalSession = async (
  functions: Functions, input: CreateStripeCustomerPortalSessionInput,
): Promise<CreateStripeCustomerPortalSessionResult> =>
  (await httpsCallable<CreateStripeCustomerPortalSessionInput, CreateStripeCustomerPortalSessionResult>(functions, 'createStripeCustomerPortalSessionCallable')(input)).data
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/lib/billing/stripeCustomerPortal.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/billing/stripeCustomerPortal.ts src/lib/billing/stripeCustomerPortal.test.ts
git commit -m "feat: Stripe Customer Portalのクライアントラッパーを追加"
```

---

### Task 5: `PlanLimitsPage`への「支払い方法の変更・解約」ボタン統合

**Files:**
- Modify: `src/components/teacher/organizations/PlanLimitsPage.tsx`
- Modify: `src/components/teacher/organizations/PlanLimitsPage.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: `createStripeCustomerPortalSession`（Task 4）。
- Produces: `PlanLimitsPageProps`に`onManageBilling: (() => void) | undefined`・`managingBilling: boolean`を追加する(`onManageBilling`が`undefined`ならボタンを表示しない——`stripeCustomerId`が無い組織〈まだ一度も決済していない〉ではボタンを出さない、という判断を呼び出し元に委ねる。既存の`onCheckout`/`checkingOut`と同じ設計)。

- [ ] **Step 1: 失敗するテストを書く**

`src/components/teacher/organizations/PlanLimitsPage.test.tsx`に以下を追記する:

```tsx
it('shows a manage-billing button when onManageBilling is provided', () => {
  const onManageBilling = vi.fn()
  render(<PlanLimitsPage data={limits} error={undefined} onManageBilling={onManageBilling} managingBilling={false} />)
  fireEvent.click(screen.getByRole('button', { name: '支払い方法の変更・解約' }))
  expect(onManageBilling).toHaveBeenCalled()
})

it('hides the manage-billing button when onManageBilling is not provided', () => {
  render(<PlanLimitsPage data={limits} error={undefined} onManageBilling={undefined} managingBilling={false} />)
  expect(screen.queryByRole('button', { name: '支払い方法の変更・解約' })).not.toBeInTheDocument()
})
```

`src/App.test.tsx`の`describe('Stripe checkout route', ...)`ブロックの末尾に以下を追記する:

```tsx
it('opens the Stripe customer portal and redirects the browser to the returned url', async () => {
  window.history.pushState({}, '', '/teacher/organizations/org-1/plan-limits')
  getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ status: 'active' }) })
  httpsCallableMock.mockImplementation((_functions: unknown, name: string) =>
    name === 'createStripeCustomerPortalSessionCallable'
      ? vi.fn().mockResolvedValue({ data: { url: 'https://billing.stripe.com/p/x' } })
      : callableMock)
  const assignMock = vi.fn()
  vi.stubGlobal('location', { ...window.location, assign: assignMock })
  render(<App isLessonPlatformV2Enabled getServices={getServices} />)
  authStateCallback?.({ uid: 'teacher-uid', emailVerified: true, providerData: [{ providerId: 'google.com' }] })
  await userEvent.click(await screen.findByRole('button', { name: '支払い方法の変更・解約' }))
  await waitFor(() => expect(assignMock).toHaveBeenCalledWith('https://billing.stripe.com/p/x'))
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/components/teacher/organizations/PlanLimitsPage.test.tsx src/App.test.tsx`
Expected: FAIL

- [ ] **Step 3: 実装する**

`src/components/teacher/organizations/PlanLimitsPage.tsx`の`PlanLimitsPageProps`に`onManageBilling?: () => void`・`managingBilling?: boolean`を追加し、`export function PlanLimitsPage({ data, error, onCheckout, checkingOut, onManageBilling, managingBilling }: PlanLimitsPageProps)`に変更する。既存の申込ボタンの直後に以下を追加する:

```tsx
      {onManageBilling && (
        <Button variant="outlined" disabled={managingBilling} onClick={onManageBilling} sx={{ alignSelf: 'flex-start' }}>
          支払い方法の変更・解約
        </Button>
      )}
```

`src/App.tsx`の`import`に`createStripeCustomerPortalSession`（`./lib/billing/stripeCustomerPortal`）を追加し、`PlanLimitsRoute`に`managingBilling`のstateと`handleManageBilling`を追加する(既存の`data`/`error`/`checkingOut`のstate・`useEffect`・`handleCheckout`はそのまま残す):

```tsx
  const [managingBilling, setManagingBilling] = useState(false)
  const handleManageBilling = orgId ? () => {
    setManagingBilling(true)
    void createStripeCustomerPortalSession(services.functions, {
      orgId, returnUrl: `${window.location.origin}/teacher/organizations/${orgId}/plan-limits`,
    })
      .then(({ url }) => { window.location.assign(url) })
      .finally(() => setManagingBilling(false))
  } : undefined
```

`return`文の`<PlanLimitsPage .../>`呼び出しに`onManageBilling={handleManageBilling}`・`managingBilling={managingBilling}`を追加する。

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/components/teacher/organizations/PlanLimitsPage.test.tsx src/App.test.tsx`
Expected: PASS

- [ ] **Step 5: モノレポ全体を検証する**

Run: `npm run verify`
Expected: 全ワークスペースのlint/typecheck/test/buildが通過する

- [ ] **Step 6: コミット**

```bash
git add src/components/teacher/organizations/PlanLimitsPage.tsx src/components/teacher/organizations/PlanLimitsPage.test.tsx src/App.tsx src/App.test.tsx
git commit -m "feat: 利用枠画面にStripe Customer Portalへの導線を統合"
```
