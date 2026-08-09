# Webhook順序問題・顧客再利用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**正本:** `docs/superpowers/specs/2026-08-10-stripe-webhook-ordering-and-customer-reuse-design.md`(設計仕様)。矛盾する場合は仕様書を優先する。

**Goal:** 更新系Webhookが顧客IDを逆引きできない場合にStripeの自動再送(503)を活用し、再申込時に既存のStripe顧客レコードを再利用する。

**Architecture:** `handleStripeWebhookEvent`の戻り値を`{status: 'ok' | 'retry'}`に変更し、`stripeWebhookCallable`がそれに応じてHTTPステータスを切り替える。`createStripeCheckoutSession`は既存の`stripeCustomerId`をStripeセッション作成時に渡すよう拡張する。

**Tech Stack:** TypeScript, Firebase Cloud Functions v2 (`onRequest`/`onCall`), Stripe Node SDK, Firebase Admin SDK (Firestore), Vitest。

## Global Constraints

- 本計画は**Phase Fサブプロジェクト7(サブスクリプションのライフサイクル管理)の完了を前提とする**(`handleStripeWebhookEvent`・`createFirestoreInvoiceLifecycleApplier`・`resolveOrgIdForStripeCustomer`が既に存在する、2026-08-10時点で実装済み)。
- 503を返すのは`invoice.paid`/`invoice.payment_failed`/`customer.subscription.deleted`で顧客IDが解決できない場合のみ。`checkout.session.completed`の`client_reference_id`形式異常や未知のイベント型は引き続き200を返す(恒久的な不整合を再送しても無駄なため)。
- アプリ側で独自の再送回数上限・キューは実装しない(Stripeの3日間の再送に委ねる)。
- 既存`stripeCustomerId`の読み取り失敗時は、決済導線を止めず新規顧客作成へフォールバックする。
- 各タスクの実装後、そのタスクが変更したファイルのテストを実行してから次のタスクに進む。全タスク完了後、`npm run verify`を実行し、通過することを確認してからコミットする。

---

## File Structure

| File | Change |
| --- | --- |
| `functions/src/billing/stripeWebhook.ts`, `.test.ts` | Modify（Task 1） |
| `functions/src/billing/stripeCheckout.ts`, `.test.ts` | Modify（Task 2） |

---

### Task 1: Webhook顧客解決失敗時の503返却

**Files:**
- Modify: `functions/src/billing/stripeWebhook.ts`
- Modify: `functions/src/billing/stripeWebhook.test.ts`

**Interfaces:**
- Consumes: なし。
- Produces: `handleStripeWebhookEvent`の戻り値が`Promise<{status: 'ok' | 'retry'}>`になる。`stripeWebhookCallable`がこれに応じて200/503を返す。

**設計メモ:** 既存テストの`'logs a reverse lookup exception and does not let it escape'`は`.resolves.toBeUndefined()`を検証しているが、戻り値の型変更により`.resolves.toEqual({status: 'retry'})`へ書き換える必要がある(顧客IDの逆引き例外は一時的なインフラ障害の可能性が高く、`retry`シグナルを返すのが正しい——恒久的なデータ不整合と区別する仕様の趣旨に沿う)。他の既存テストは戻り値を検証していないため無変更で通過する。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/billing/stripeWebhook.test.ts`の`'logs a reverse lookup exception and does not let it escape'`テストを以下に置き換える:

```ts
  it('returns a retry outcome when the reverse lookup throws, without letting the exception escape', async () => {
    const logStripeCustomerLookupError = vi.fn()
    const lookupError = new Error('Firestore unavailable')
    await expect(handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(),
      getOrgIdForStripeCustomer: async () => { throw lookupError }, setSubscriptionStatus: vi.fn(), applyInvoiceLifecycle: vi.fn(),
      logStripeCustomerLookupError,
    }, { type: 'invoice.paid', invoiceId: 'in_1', stripeCustomerId: 'cus_1' })).resolves.toEqual({ status: 'retry' })
    expect(logStripeCustomerLookupError).toHaveBeenCalledWith('cus_1', lookupError)
  })
```

`describe('handleStripeWebhookEvent — subscription lifecycle', ...)`ブロックの末尾に以下を追記する:

```ts
  it('returns a retry outcome for invoice.paid when the customer cannot be resolved', async () => {
    const result = await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(),
      getOrgIdForStripeCustomer: async () => null, setSubscriptionStatus: vi.fn(), applyInvoiceLifecycle: vi.fn(),
    }, { type: 'invoice.paid', invoiceId: 'in_1', stripeCustomerId: 'cus_unknown' })
    expect(result).toEqual({ status: 'retry' })
  })

  it('returns a retry outcome for customer.subscription.deleted when the customer cannot be resolved', async () => {
    const result = await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(),
      getOrgIdForStripeCustomer: async () => null, setSubscriptionStatus: vi.fn(), applyInvoiceLifecycle: vi.fn(),
    }, { type: 'customer.subscription.deleted', stripeCustomerId: 'cus_unknown' })
    expect(result).toEqual({ status: 'retry' })
  })

  it('returns an ok outcome for a successfully processed invoice.paid event', async () => {
    const result = await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(),
      getOrgIdForStripeCustomer: async () => 'org-1', setSubscriptionStatus: vi.fn(), applyInvoiceLifecycle: vi.fn(),
    }, { type: 'invoice.paid', invoiceId: 'in_1', stripeCustomerId: 'cus_1' })
    expect(result).toEqual({ status: 'ok' })
  })

  it('returns an ok outcome for a malformed checkout.session.completed event (a permanent, non-retriable mismatch)', async () => {
    const result = await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(),
    }, { type: 'checkout.session.completed', clientReferenceId: 'bad', stripeSessionId: 's' })
    expect(result).toEqual({ status: 'ok' })
  })

  it('returns an ok outcome for an unrecognized event type', async () => {
    const result = await handleStripeWebhookEvent({ getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn() }, { type: 'customer.updated' })
    expect(result).toEqual({ status: 'ok' })
  })
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/billing/stripeWebhook.test.ts`
Expected: FAIL（`handleStripeWebhookEvent`が`undefined`を返しており、`{status: 'ok'|'retry'}`ではない）

- [ ] **Step 3: 実装する**

`functions/src/billing/stripeWebhook.ts`の`handleStripeWebhookEvent`関数を以下に置き換える:

```ts
export type StripeWebhookOutcome = { status: 'ok' } | { status: 'retry' }

/**
 * Handles the 4 subscription-lifecycle events this app cares about.
 * checkout.session.completed uses billingRecords.status for idempotency
 * (the record already exists, created by createStripeCheckoutSession);
 * invoice.paid/invoice.payment_failed atomically apply the organization and
 * deterministic invoice-record transition, using Stripe's invoice id as the
 * billingRecords document id and deduplication key.
 *
 * Returns `{status: 'retry'}` ONLY when a Stripe customer id could not be
 * resolved to an organization for the 3 update events — this is treated as
 * a transient condition (the reverse index may simply not exist yet because
 * checkout.session.completed hasn't been delivered — Stripe does not
 * guarantee webhook delivery order — or a lookup itself failed), and the
 * caller (stripeWebhookCallable) turns this into an HTTP 503 so Stripe's
 * own retry-with-backoff (up to 3 days) gives the reverse index time to
 * catch up. Every other skip (malformed clientReferenceId, unrecognized
 * event type, missing required fields) returns `{status: 'ok'}` because
 * those are permanent mismatches that retrying would never fix.
 */
export const handleStripeWebhookEvent = async (deps: HandleStripeWebhookEventDeps, event: StripeWebhookEvent): Promise<StripeWebhookOutcome> => {
  switch (event.type) {
    case 'checkout.session.completed': {
      if (!event.clientReferenceId || !event.stripeSessionId) return { status: 'ok' }
      const parsed = parseClientReferenceId(event.clientReferenceId)
      if (!parsed) return { status: 'ok' }
      const record = await deps.getBillingRecord(parsed.orgId, parsed.recordId)
      if (record && record.status !== 'PAID') await deps.markBillingRecordPaid(parsed.orgId, parsed.recordId, event.stripeSessionId)
      if (event.stripeCustomerId && deps.linkStripeCustomer) await deps.linkStripeCustomer(parsed.orgId, event.stripeCustomerId)
      return { status: 'ok' }
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      if (!event.invoiceId || !event.stripeCustomerId || !deps.getOrgIdForStripeCustomer || !deps.applyInvoiceLifecycle) return { status: 'ok' }
      const orgId = await resolveOrgIdForStripeCustomer(deps, event.stripeCustomerId)
      if (!orgId) return { status: 'retry' }
      const status = event.type === 'invoice.paid' ? 'ACTIVE' : 'PAST_DUE'
      const recordStatus = event.type === 'invoice.paid' ? 'PAID' : 'OVERDUE'
      await deps.applyInvoiceLifecycle(orgId, event.invoiceId, status, recordStatus)
      return { status: 'ok' }
    }
    case 'customer.subscription.deleted': {
      if (!event.stripeCustomerId || !deps.getOrgIdForStripeCustomer || !deps.setSubscriptionStatus) return { status: 'ok' }
      const orgId = await resolveOrgIdForStripeCustomer(deps, event.stripeCustomerId)
      if (!orgId) return { status: 'retry' }
      await deps.setSubscriptionStatus(orgId, 'CANCELED')
      return { status: 'ok' }
    }
    default:
      return { status: 'ok' }
  }
}
```

（`parseClientReferenceId`・`resolveOrgIdForStripeCustomer`・`HandleStripeWebhookEventDeps`・`StripeWebhookEvent`・`createFirestoreInvoiceLifecycleApplier`・`extractEvent`は既存のまま変更しない。）

`stripeWebhookCallable`内、`await handleStripeWebhookEvent(...)`の呼び出しと末尾の`response.status(200).send('ok')`を以下に置き換える:

```ts
  const outcome = await handleStripeWebhookEvent({
    // ...(既存のdepsオブジェクトはそのまま)
  }, extractEvent(stripeEvent))

  if (outcome.status === 'retry') {
    response.status(503).send('retry')
    return
  }
  response.status(200).send('ok')
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/billing/stripeWebhook.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add functions/src/billing/stripeWebhook.ts functions/src/billing/stripeWebhook.test.ts
git commit -m "feat: 更新系Webhookで顧客IDが解決できない場合に503を返しStripeの自動再送に委ねる"
```

---

### Task 2: Checkout Session作成時の既存Stripe顧客の再利用

**Files:**
- Modify: `functions/src/billing/stripeCheckout.ts`
- Modify: `functions/src/billing/stripeCheckout.test.ts`

**Interfaces:**
- Consumes: なし。
- Produces: `createStripeCheckoutSession`のdepsに`getExistingStripeCustomerId?: (orgId: string) => Promise<string | null>`を追加し、`createCheckoutSession`の入力に`customerId?: string`を追加する。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/billing/stripeCheckout.test.ts`に以下のテストを追記する:

```ts
  it('reuses an existing Stripe customer id when the organization already has one', async () => {
    const session = vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/s' })
    await createStripeCheckoutSession({
      getPlanDefinition: async () => ({ stripePriceId: 'price_1' }),
      createBillingRecord: vi.fn().mockResolvedValue('record-1'),
      createCheckoutSession: session,
      getExistingStripeCustomerId: async (orgId) => { expect(orgId).toBe('org-1'); return 'cus_existing' },
    }, { orgId: 'org-1', planId: 'SCHOOL', successUrl: 'https://x/s', cancelUrl: 'https://x/c' })
    expect(session).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cus_existing' }))
  })

  it('omits customerId when the organization has no existing Stripe customer', async () => {
    const session = vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/s' })
    await createStripeCheckoutSession({
      getPlanDefinition: async () => ({ stripePriceId: 'price_1' }),
      createBillingRecord: vi.fn().mockResolvedValue('record-1'),
      createCheckoutSession: session,
      getExistingStripeCustomerId: async () => null,
    }, { orgId: 'org-1', planId: 'SCHOOL', successUrl: 'https://x/s', cancelUrl: 'https://x/c' })
    expect(session).toHaveBeenCalledWith(expect.objectContaining({ customerId: undefined }))
  })

  it('falls back to creating a new customer when reading the existing id fails', async () => {
    const session = vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/s' })
    await createStripeCheckoutSession({
      getPlanDefinition: async () => ({ stripePriceId: 'price_1' }),
      createBillingRecord: vi.fn().mockResolvedValue('record-1'),
      createCheckoutSession: session,
      getExistingStripeCustomerId: async () => { throw new Error('Firestore unavailable') },
    }, { orgId: 'org-1', planId: 'SCHOOL', successUrl: 'https://x/s', cancelUrl: 'https://x/c' })
    expect(session).toHaveBeenCalledWith(expect.objectContaining({ customerId: undefined }))
  })
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/billing/stripeCheckout.test.ts`
Expected: FAIL（`getExistingStripeCustomerId`が未使用で、`customerId`が渡されない）

- [ ] **Step 3: 実装する**

`functions/src/billing/stripeCheckout.ts`を以下の内容に置き換える:

```ts
import { getFirestore } from 'firebase-admin/firestore'
import Stripe from 'stripe'
import { defineSecret } from 'firebase-functions/params'
import type { PlanDefinition } from '../organizations/planLimits'

export const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY')

export interface CreateStripeCheckoutSessionInput { orgId: string; planId: string; successUrl: string; cancelUrl: string }

export interface CreateStripeCheckoutSessionDeps {
  getPlanDefinition: (id: string) => Promise<Pick<PlanDefinition, 'stripePriceId'> | null>
  createBillingRecord: (orgId: string, data: { status: 'PENDING'; paymentMethod: 'CARD'; planId: string; createdAt: unknown }) => Promise<string>
  createCheckoutSession: (input: { priceId: string; clientReferenceId: string; successUrl: string; cancelUrl: string; customerId?: string }) => Promise<{ url: string }>
  /** Optional so existing test fixtures that don't care about customer reuse keep compiling; production wiring always supplies it. */
  getExistingStripeCustomerId?: (orgId: string) => Promise<string | null>
  now?: () => unknown
}

/**
 * Reuses the organization's existing Stripe customer (if any) instead of
 * letting Stripe create a new one on every re-subscription — otherwise a
 * canceled-then-resubscribed organization accumulates duplicate Stripe
 * customer records. A failure reading the existing id falls back to
 * creating a new customer rather than blocking checkout entirely (a
 * duplicate customer record is a lesser harm than a broken checkout flow).
 */
export const createStripeCheckoutSession = async (
  deps: CreateStripeCheckoutSessionDeps,
  input: CreateStripeCheckoutSessionInput,
): Promise<{ url: string }> => {
  const plan = await deps.getPlanDefinition(input.planId)
  if (!plan?.stripePriceId) throw new Error('このプランはまだ決済に対応していません')
  const recordId = await deps.createBillingRecord(input.orgId, {
    status: 'PENDING', paymentMethod: 'CARD', planId: input.planId, createdAt: deps.now ? deps.now() : new Date().toISOString(),
  })
  const existingCustomerId = deps.getExistingStripeCustomerId
    ? await deps.getExistingStripeCustomerId(input.orgId).catch(() => null)
    : null
  return deps.createCheckoutSession({
    priceId: plan.stripePriceId,
    clientReferenceId: `${input.orgId}:${recordId}`,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    customerId: existingCustomerId ?? undefined,
  })
}

/** Production wiring: Firestore Admin SDK + Stripe SDK. */
export const createStripeCheckoutSessionWithAdminSdk = (input: CreateStripeCheckoutSessionInput): Promise<{ url: string }> => {
  const db = getFirestore()
  const stripe = new Stripe(stripeSecretKey.value())
  return createStripeCheckoutSession({
    getPlanDefinition: async (id) => {
      const snap = await db.doc(`planDefinitions/${id}`).get()
      return snap.exists ? (snap.data() as PlanDefinition) : null
    },
    createBillingRecord: async (orgId, data) => (await db.collection(`organizations/${orgId}/billingRecords`).add(data)).id,
    getExistingStripeCustomerId: async (orgId) => {
      const snap = await db.doc(`organizations/${orgId}`).get()
      return snap.exists ? (snap.get('stripeCustomerId') as string | undefined) ?? null : null
    },
    createCheckoutSession: async ({ priceId, clientReferenceId, successUrl, cancelUrl, customerId }) => {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: clientReferenceId,
        success_url: successUrl,
        cancel_url: cancelUrl,
        ...(customerId ? { customer: customerId } : {}),
      })
      if (!session.url) throw new Error('Stripe did not return a checkout session url')
      return { url: session.url }
    },
  }, input)
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/billing/stripeCheckout.test.ts`
Expected: PASS（新しいテスト・既存の2テストいずれも通過する——既存テストは`getExistingStripeCustomerId`を渡さないため、`existingCustomerId`は`null`のまま`createCheckoutSession`が`customerId: undefined`込みで呼ばれるが、既存のアサーションは`toHaveBeenCalledWith`で完全一致を見ているため、これらのテストも合わせて更新が必要——既存の2テストの`expect(session).toHaveBeenCalledWith({ priceId: ..., clientReferenceId: ..., successUrl: ..., cancelUrl: ... })`を`expect(session).toHaveBeenCalledWith({ priceId: ..., clientReferenceId: ..., successUrl: ..., cancelUrl: ..., customerId: undefined })`に更新すること)。

- [ ] **Step 5: コミット**

```bash
git add functions/src/billing/stripeCheckout.ts functions/src/billing/stripeCheckout.test.ts
git commit -m "feat: Checkout Session作成時に既存のStripe顧客を再利用する"
```

---

### 全体検証

- [ ] **Step 1: モノレポ全体を検証する**

Run: `npm run verify`
Expected: 全ワークスペースのlint/typecheck/test/buildが通過する
