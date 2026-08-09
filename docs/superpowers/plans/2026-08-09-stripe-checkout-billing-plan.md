# Stripe Checkout導線 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**正本:** `docs/superpowers/specs/2026-08-09-stripe-checkout-billing-design.md`(設計仕様)。矛盾する場合は仕様書を優先する。

**Goal:** 教師がプランをStripeのホスト型Checkoutページで申し込め、支払い完了をWebhookで検知して`billingRecords`へ記録できるようにする。

**Architecture:** 新規`functions/src/billing/`ディレクトリに、チェックアウトセッション作成とWebhook処理の純粋関数+Admin SDK配線+Callableを置く。秘密情報は`firebase-functions/params`の`defineSecret`で管理し、コードにハードコードしない。

**Tech Stack:** TypeScript, React, MUI, Firebase Cloud Functions v2 (`onCall`/`onRequest`), Stripe Node SDK, Firebase Admin SDK (Firestore), Vitest, React Testing Library。

## Global Constraints

- 本計画は**Phase Fサブプロジェクト2(プラン・利用枠の土台)の完了を前提とする**(`planDefinitions/{planId}`が既に存在する、2026-08-09時点で実装済み)。
- 対応する支払い方法は`CARD`(Stripe経由)のみ。他の支払い方法・契約期間データモデルは対象外。
- 実装はStripeのテストモードAPIキーを前提とする。秘密情報(`STRIPE_SECRET_KEY`・`STRIPE_WEBHOOK_SECRET`)は`defineSecret`経由でのみ参照し、コードにハードコードしない。
- Webhookエンドポイント(`stripeWebhookCallable`)は`onRequest`で実装する(`onCall`はJSONを自動パースし、署名検証に必要な生のリクエストボディへアクセスできないため)。
- `success_url`/`cancel_url`はクライアントが`window.location.origin`から組み立てて渡す(サーバー側にアプリのドメインをハードコードしない)。
- 新規Callableは`functions/src/index.ts`からexportする。
- 日本語UI文言を用いる。
- 各タスクの実装後、そのタスクが変更したファイルのテストを実行してから次のタスクに進む。全タスク完了後、`npm run verify`を実行し、通過することを確認してからコミットする(`npm run verify`はStripeのテストモードAPIキーを必要としない——本番接続を伴うテストは書かない)。

---

## File Structure

| File | Change |
| --- | --- |
| `functions/package.json` | Modify（Task 1。`stripe`依存追加） |
| `functions/src/organizations/planLimits.ts` | Modify（Task 1。`stripePriceId`フィールド追加） |
| `functions/src/billing/stripeCheckout.ts`, `.test.ts` | Create（Task 1） |
| `functions/src/billing/stripeWebhook.ts`, `.test.ts` | Create（Task 2） |
| `functions/src/billing/onCall.ts`, `.test.ts` | Create（Task 3） |
| `functions/src/index.ts` | Modify（Task 3。export追加） |
| `src/lib/billing/stripeCheckout.ts`, `.test.ts` | Create（Task 4） |
| `src/components/teacher/organizations/PlanLimitsPage.tsx`, `.test.tsx` | Modify（Task 5） |
| `src/App.tsx`, `.test.tsx` | Modify（Task 5） |

---

### Task 1: `createStripeCheckoutSession`（純粋関数 — チェックアウトセッション作成）

**Files:**
- Modify: `functions/package.json`
- Modify: `functions/src/organizations/planLimits.ts`
- Create: `functions/src/billing/stripeCheckout.ts`
- Test: `functions/src/billing/stripeCheckout.test.ts`

**Interfaces:**
- Consumes: `PlanDefinition`型（既存、`functions/src/organizations/planLimits.ts`、`stripePriceId`フィールドを追加する）。
- Produces: `createStripeCheckoutSession(deps, input): Promise<{url: string}>`、`createStripeCheckoutSessionWithAdminSdk(input): Promise<{url: string}>`。Task 3で消費される。

- [ ] **Step 1: 失敗するテストを書く**

まず`functions/package.json`の`dependencies`に`"stripe": "^17.0.0"`を追加する。

`functions/src/organizations/planLimits.ts`の`PlanDefinition`インターフェースに`stripePriceId: string | null`を追加する:

```ts
export interface PlanDefinition {
  planId: string
  displayName: string
  limits: PlanLimits
  stripePriceId: string | null
}
```

```ts
// functions/src/billing/stripeCheckout.test.ts
import { describe, expect, it, vi } from 'vitest'
import { createStripeCheckoutSession } from './stripeCheckout'

describe('createStripeCheckoutSession', () => {
  it('rejects a plan with no stripePriceId', async () => {
    await expect(createStripeCheckoutSession({
      getPlanDefinition: async () => ({ stripePriceId: null }),
      createBillingRecord: vi.fn(),
      createCheckoutSession: vi.fn(),
    }, { orgId: 'org-1', planId: 'FREE', successUrl: 'https://example.com/success', cancelUrl: 'https://example.com/cancel' }))
      .rejects.toThrow('このプランはまだ決済に対応していません')
  })

  it('creates a PENDING billing record before creating the Stripe session, and returns the session url', async () => {
    const createBillingRecord = vi.fn(async () => 'record-1')
    const createCheckoutSession = vi.fn(async () => ({ url: 'https://checkout.stripe.com/session-1' }))
    const result = await createStripeCheckoutSession({
      getPlanDefinition: async (planId) => { expect(planId).toBe('SCHOOL'); return { stripePriceId: 'price_123' } },
      createBillingRecord,
      createCheckoutSession,
      now: () => 'now',
    }, { orgId: 'org-1', planId: 'SCHOOL', successUrl: 'https://example.com/success', cancelUrl: 'https://example.com/cancel' })

    expect(createBillingRecord).toHaveBeenCalledWith('org-1', { status: 'PENDING', paymentMethod: 'CARD', planId: 'SCHOOL', createdAt: 'now' })
    expect(createCheckoutSession).toHaveBeenCalledWith({
      priceId: 'price_123', clientReferenceId: 'org-1:record-1', successUrl: 'https://example.com/success', cancelUrl: 'https://example.com/cancel',
    })
    expect(result).toEqual({ url: 'https://checkout.stripe.com/session-1' })
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/billing/stripeCheckout.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装する**

```ts
// functions/src/billing/stripeCheckout.ts
import { getFirestore } from 'firebase-admin/firestore'
import Stripe from 'stripe'
import { defineSecret } from 'firebase-functions/params'
import type { PlanDefinition } from '../organizations/planLimits'

export const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY')

export interface CreateStripeCheckoutSessionDeps {
  getPlanDefinition: (planId: string) => Promise<Pick<PlanDefinition, 'stripePriceId'> | null>
  createBillingRecord: (orgId: string, data: { status: 'PENDING'; paymentMethod: 'CARD'; planId: string; createdAt: unknown }) => Promise<string>
  createCheckoutSession: (input: { priceId: string; clientReferenceId: string; successUrl: string; cancelUrl: string }) => Promise<{ url: string }>
  now?: () => unknown
}
export interface CreateStripeCheckoutSessionInput { orgId: string; planId: string; successUrl: string; cancelUrl: string }

/**
 * billingRecordsを先に作成してからStripeセッションを作るのは、
 * client_reference_idにこちら側の追跡IDを埋め込むため——Webhookは
 * この値だけを頼りにorgId/recordIdへ書き戻す(設計仕様のデータフロー参照)。
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
  const session = await deps.createCheckoutSession({
    priceId: plan.stripePriceId, clientReferenceId: `${input.orgId}:${recordId}`, successUrl: input.successUrl, cancelUrl: input.cancelUrl,
  })
  return { url: session.url }
}

/** Production wiring: Firestore Admin SDK + Stripe SDK. */
export const createStripeCheckoutSessionWithAdminSdk = (input: CreateStripeCheckoutSessionInput): Promise<{ url: string }> => {
  const db = getFirestore()
  const stripe = new Stripe(stripeSecretKey.value())
  return createStripeCheckoutSession({
    getPlanDefinition: async (planId) => {
      const snap = await db.doc(`planDefinitions/${planId}`).get()
      return snap.exists ? (snap.data() as PlanDefinition) : null
    },
    createBillingRecord: async (orgId, data) => {
      const ref = await db.collection(`organizations/${orgId}/billingRecords`).add(data)
      return ref.id
    },
    createCheckoutSession: async ({ priceId, clientReferenceId, successUrl, cancelUrl }) => {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: clientReferenceId,
        success_url: successUrl,
        cancel_url: cancelUrl,
      })
      if (!session.url) throw new Error('Stripe did not return a checkout session url')
      return { url: session.url }
    },
  }, input)
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npm install && npx vitest run src/billing/stripeCheckout.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add functions/package.json functions/package-lock.json functions/src/organizations/planLimits.ts functions/src/billing/stripeCheckout.ts functions/src/billing/stripeCheckout.test.ts
git commit -m "feat: Stripeチェックアウトセッション作成ロジックを追加"
```

---

### Task 2: `handleStripeWebhookEvent`（純粋関数 — Webhookイベント処理）

**Files:**
- Create: `functions/src/billing/stripeWebhook.ts`
- Test: `functions/src/billing/stripeWebhook.test.ts`

**Interfaces:**
- Consumes: なし。
- Produces: `StripeWebhookEvent`型、`handleStripeWebhookEvent(deps, event): Promise<void>`、`stripeWebhookCallable`（`onRequest`ハンドラ、署名検証込み）。Task 3のexport一覧に含まれる。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// functions/src/billing/stripeWebhook.test.ts
import { describe, expect, it, vi } from 'vitest'
import { handleStripeWebhookEvent } from './stripeWebhook'

describe('handleStripeWebhookEvent', () => {
  it('ignores event types other than checkout.session.completed', async () => {
    const markBillingRecordPaid = vi.fn()
    await handleStripeWebhookEvent({ getBillingRecord: vi.fn(), markBillingRecordPaid }, { type: 'invoice.payment_failed' })
    expect(markBillingRecordPaid).not.toHaveBeenCalled()
  })

  it('ignores a malformed clientReferenceId', async () => {
    const markBillingRecordPaid = vi.fn()
    await handleStripeWebhookEvent({ getBillingRecord: vi.fn(), markBillingRecordPaid },
      { type: 'checkout.session.completed', clientReferenceId: 'no-separator', stripeSessionId: 'sess_1' })
    expect(markBillingRecordPaid).not.toHaveBeenCalled()
  })

  it('marks a PENDING billing record as PAID', async () => {
    const markBillingRecordPaid = vi.fn()
    await handleStripeWebhookEvent({
      getBillingRecord: async (orgId, recordId) => { expect(orgId).toBe('org-1'); expect(recordId).toBe('record-1'); return { status: 'PENDING' } },
      markBillingRecordPaid,
    }, { type: 'checkout.session.completed', clientReferenceId: 'org-1:record-1', stripeSessionId: 'sess_1' })
    expect(markBillingRecordPaid).toHaveBeenCalledWith('org-1', 'record-1', 'sess_1')
  })

  it('is idempotent: does nothing when the billing record is already PAID', async () => {
    const markBillingRecordPaid = vi.fn()
    await handleStripeWebhookEvent({
      getBillingRecord: async () => ({ status: 'PAID' }),
      markBillingRecordPaid,
    }, { type: 'checkout.session.completed', clientReferenceId: 'org-1:record-1', stripeSessionId: 'sess_1' })
    expect(markBillingRecordPaid).not.toHaveBeenCalled()
  })

  it('does nothing when the billing record does not exist', async () => {
    const markBillingRecordPaid = vi.fn()
    await handleStripeWebhookEvent({
      getBillingRecord: async () => null,
      markBillingRecordPaid,
    }, { type: 'checkout.session.completed', clientReferenceId: 'org-1:record-1', stripeSessionId: 'sess_1' })
    expect(markBillingRecordPaid).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/billing/stripeWebhook.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装する**

```ts
// functions/src/billing/stripeWebhook.ts
import { getFirestore } from 'firebase-admin/firestore'
import { onRequest } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import Stripe from 'stripe'

export const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET')

export interface StripeWebhookEvent { type: string; clientReferenceId?: string; stripeSessionId?: string }

export interface HandleStripeWebhookEventDeps {
  getBillingRecord: (orgId: string, recordId: string) => Promise<{ status: string } | null>
  markBillingRecordPaid: (orgId: string, recordId: string, stripeSessionId: string) => Promise<void>
}

const parseClientReferenceId = (value: string): { orgId: string; recordId: string } | null => {
  const separatorIndex = value.indexOf(':')
  if (separatorIndex < 0) return null
  return { orgId: value.slice(0, separatorIndex), recordId: value.slice(separatorIndex + 1) }
}

/**
 * 未知のイベント種別・不正なclientReferenceId・存在しないbillingRecordは
 * すべて「何もしない」で正常終了する——Stripeの再送ループを避けるため、
 * Webhook層は原則200を返す設計(設計仕様のエラー処理節を参照)。
 */
export const handleStripeWebhookEvent = async (deps: HandleStripeWebhookEventDeps, event: StripeWebhookEvent): Promise<void> => {
  if (event.type !== 'checkout.session.completed' || !event.clientReferenceId || !event.stripeSessionId) return
  const parsed = parseClientReferenceId(event.clientReferenceId)
  if (!parsed) return
  const record = await deps.getBillingRecord(parsed.orgId, parsed.recordId)
  if (!record || record.status === 'PAID') return
  await deps.markBillingRecordPaid(parsed.orgId, parsed.recordId, event.stripeSessionId)
}

/**
 * Production wiring: verifies the Stripe signature against the raw request
 * body (available as `request.rawBody` on Firebase Functions v2's onRequest
 * — never JSON.parse(request.body), which would defeat signature
 * verification). onCall cannot be used here because it parses JSON before
 * handler code ever sees the request (see this module's design note).
 */
export const stripeWebhookCallable = onRequest({ region: 'asia-northeast1', secrets: [stripeWebhookSecret] }, async (request, response) => {
  const signature = request.headers['stripe-signature']
  if (typeof signature !== 'string') { response.status(400).send('Missing signature'); return }

  let stripeEvent: Stripe.Event
  try {
    const stripe = new Stripe(stripeWebhookSecret.value())
    stripeEvent = stripe.webhooks.constructEvent(request.rawBody, signature, stripeWebhookSecret.value())
  } catch {
    response.status(400).send('Invalid signature')
    return
  }

  const db = getFirestore()
  const session = stripeEvent.data.object as Stripe.Checkout.Session
  await handleStripeWebhookEvent({
    getBillingRecord: async (orgId, recordId) => {
      const snap = await db.doc(`organizations/${orgId}/billingRecords/${recordId}`).get()
      return snap.exists ? (snap.data() as { status: string }) : null
    },
    markBillingRecordPaid: async (orgId, recordId, stripeSessionId) => {
      await db.doc(`organizations/${orgId}/billingRecords/${recordId}`).update({ status: 'PAID', paidAt: new Date().toISOString(), stripeSessionId })
    },
  }, { type: stripeEvent.type, clientReferenceId: session.client_reference_id ?? undefined, stripeSessionId: session.id })

  response.status(200).send('ok')
})
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/billing/stripeWebhook.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add functions/src/billing/stripeWebhook.ts functions/src/billing/stripeWebhook.test.ts
git commit -m "feat: Stripe Webhookの支払い完了処理(署名検証込み)を追加"
```

---

### Task 3: `createStripeCheckoutSessionCallable`

**Files:**
- Create: `functions/src/billing/onCall.ts`
- Test: `functions/src/billing/onCall.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: `createStripeCheckoutSessionWithAdminSdk`（Task 1）、`stripeSecretKey`（Task 1）、`requireActiveOrgMember`（既存）。
- Produces: `createStripeCheckoutSessionCallable`。入力`{orgId, planId, successUrl, cancelUrl}`、出力`{url: string}`。Task 4で消費される。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// functions/src/billing/onCall.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { createStripeCheckoutSessionCallable } from './onCall'
import { requireActiveOrgMember } from '../organizations/authorization'
import { createStripeCheckoutSessionWithAdminSdk } from './stripeCheckout'

vi.mock('../organizations/authorization', () => ({ requireActiveOrgMember: vi.fn() }))
// stripeSecretKey (defineSecret's return value) is NOT mocked — onCall.ts only
// passes it into the `secrets: [...]` option array, it never calls `.value()`
// in this module, so the real SecretParam object is safe to use as-is in tests.
vi.mock('./stripeCheckout', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./stripeCheckout')>()),
  createStripeCheckoutSessionWithAdminSdk: vi.fn(),
}))
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({}) }))

const teacher = { uid: 'teacher-1', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } } as unknown as CallableRequest['auth']
const request = (data: Record<string, unknown>) => ({ auth: teacher, data } as unknown as CallableRequest)

describe('createStripeCheckoutSessionCallable', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects a caller who is not owner/admin', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    await expect(createStripeCheckoutSessionCallable.run(request({
      orgId: 'org-1', planId: 'SCHOOL', successUrl: 'https://x/success', cancelUrl: 'https://x/cancel',
    }))).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('creates a checkout session for an owner', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    vi.mocked(createStripeCheckoutSessionWithAdminSdk).mockResolvedValueOnce({ url: 'https://checkout.stripe.com/x' })
    await expect(createStripeCheckoutSessionCallable.run(request({
      orgId: 'org-1', planId: 'SCHOOL', successUrl: 'https://x/success', cancelUrl: 'https://x/cancel',
    }))).resolves.toEqual({ url: 'https://checkout.stripe.com/x' })
  })

  it('translates a missing stripePriceId into failed-precondition', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    vi.mocked(createStripeCheckoutSessionWithAdminSdk).mockRejectedValueOnce(new Error('このプランはまだ決済に対応していません'))
    await expect(createStripeCheckoutSessionCallable.run(request({
      orgId: 'org-1', planId: 'FREE', successUrl: 'https://x/success', cancelUrl: 'https://x/cancel',
    }))).rejects.toMatchObject({ code: 'failed-precondition' })
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/billing/onCall.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装する**

```ts
// functions/src/billing/onCall.ts
import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { isCallerTeacher } from '../organizations/onCall'
import { requireActiveOrgMember } from '../organizations/authorization'
import { createStripeCheckoutSessionWithAdminSdk, stripeSecretKey } from './stripeCheckout'

interface CreateStripeCheckoutSessionRequest { orgId?: unknown; planId?: unknown; successUrl?: unknown; cancelUrl?: unknown }

export const createStripeCheckoutSessionCallable = onCall({ region: 'asia-northeast1', secrets: [stripeSecretKey] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as CreateStripeCheckoutSessionRequest
  if (typeof data.orgId !== 'string' || typeof data.planId !== 'string' || typeof data.successUrl !== 'string' || typeof data.cancelUrl !== 'string') {
    throw new HttpsError('invalid-argument', '入力内容が不正です。')
  }
  const membership = await requireActiveOrgMember(getFirestore(), data.orgId, request.auth.uid)
  if (membership.role !== 'owner' && membership.role !== 'admin') {
    throw new HttpsError('permission-denied', 'owner または admin のみ決済を開始できます。')
  }
  try {
    return await createStripeCheckoutSessionWithAdminSdk({
      orgId: data.orgId, planId: data.planId, successUrl: data.successUrl, cancelUrl: data.cancelUrl,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'このプランはまだ決済に対応していません') throw new HttpsError('failed-precondition', error.message)
    throw new HttpsError('unavailable', '決済セッションの作成に失敗しました。時間をおいて再試行してください。')
  }
})
```

`functions/src/index.ts`に以下を追記する:

```ts
export { createStripeCheckoutSessionCallable } from './billing/onCall'
export { stripeWebhookCallable } from './billing/stripeWebhook'
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/billing/onCall.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add functions/src/billing/onCall.ts functions/src/billing/onCall.test.ts functions/src/index.ts
git commit -m "feat: createStripeCheckoutSessionCallableを追加しbilling配下のCallableをexport"
```

---

### Task 4: クライアントラッパー

**Files:**
- Create: `src/lib/billing/stripeCheckout.ts`
- Test: `src/lib/billing/stripeCheckout.test.ts`

**Interfaces:**
- Produces: `createStripeCheckoutSession(functions, {orgId, planId, successUrl, cancelUrl}): Promise<{url: string}>`。Task 5で消費される。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/billing/stripeCheckout.test.ts
import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { createStripeCheckoutSession } from './stripeCheckout'
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

describe('createStripeCheckoutSession', () => {
  it('calls createStripeCheckoutSessionCallable with the input', async () => {
    const call = vi.fn().mockResolvedValue({ data: { url: 'https://checkout.stripe.com/x' } })
    vi.mocked(httpsCallable).mockReturnValue(call as never)
    const input = { orgId: 'org-1', planId: 'SCHOOL', successUrl: 'https://x/success', cancelUrl: 'https://x/cancel' }
    await expect(createStripeCheckoutSession({} as never, input)).resolves.toEqual({ url: 'https://checkout.stripe.com/x' })
    expect(httpsCallable).toHaveBeenCalledWith({}, 'createStripeCheckoutSessionCallable')
    expect(call).toHaveBeenCalledWith(input)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/lib/billing/stripeCheckout.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装する**

```ts
// src/lib/billing/stripeCheckout.ts
import { httpsCallable, type Functions } from 'firebase/functions'

export interface CreateStripeCheckoutSessionInput { orgId: string; planId: string; successUrl: string; cancelUrl: string }
export interface CreateStripeCheckoutSessionResult { url: string }

export const createStripeCheckoutSession = async (
  functions: Functions, input: CreateStripeCheckoutSessionInput,
): Promise<CreateStripeCheckoutSessionResult> =>
  (await httpsCallable<CreateStripeCheckoutSessionInput, CreateStripeCheckoutSessionResult>(functions, 'createStripeCheckoutSessionCallable')(input)).data
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/lib/billing/stripeCheckout.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/billing/stripeCheckout.ts src/lib/billing/stripeCheckout.test.ts
git commit -m "feat: Stripeチェックアウトのクライアントラッパーを追加"
```

---

### Task 5: `PlanLimitsPage`への申し込みボタン統合

**Files:**
- Modify: `src/components/teacher/organizations/PlanLimitsPage.tsx`
- Modify: `src/components/teacher/organizations/PlanLimitsPage.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: `createStripeCheckoutSession`（Task 4）。
- Produces: `PlanLimitsPageProps`に`onCheckout: (() => void) | undefined`・`checkingOut: boolean`を追加する(`onCheckout`が`undefined`ならボタン自体を表示しない——`stripePriceId`が未設定のプランでは申し込みボタンを出さない、という判断を呼び出し元に委ねる)。

- [ ] **Step 1: 失敗するテストを書く**

`src/components/teacher/organizations/PlanLimitsPage.test.tsx`に以下を追記する(既存のテスト・importパターンをそのまま使う):

```tsx
it('shows a checkout button when onCheckout is provided', () => {
  const onCheckout = vi.fn()
  render(<PlanLimitsPage data={limits} error={undefined} onCheckout={onCheckout} checkingOut={false} />)
  fireEvent.click(screen.getByRole('button', { name: 'このプランで申し込む' }))
  expect(onCheckout).toHaveBeenCalled()
})

it('hides the checkout button when onCheckout is not provided', () => {
  render(<PlanLimitsPage data={limits} error={undefined} onCheckout={undefined} checkingOut={false} />)
  expect(screen.queryByRole('button', { name: 'このプランで申し込む' })).not.toBeInTheDocument()
})
```

（`fireEvent`が既存のimportに含まれていなければ`@testing-library/react`から追加する。`limits`は既存テストファイルの定数をそのまま使う。）

`src/App.test.tsx`の`describe('School org creation and invitation routes', ...)`ブロック内、`plan-limits`ルートのテストの末尾に以下を追記する:

```tsx
it('starts a Stripe checkout and redirects the browser to the returned url', async () => {
  window.history.pushState({}, '', '/teacher/organizations/org-1/plan-limits')
  getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ status: 'active' }) })
  httpsCallableMock.mockImplementation((_functions: unknown, name: string) => {
    if (name === 'createStripeCheckoutSessionCallable') return vi.fn().mockResolvedValue({ data: { url: 'https://checkout.stripe.com/x' } })
    return callableMock
  })
  const assignMock = vi.fn()
  vi.stubGlobal('location', { ...window.location, assign: assignMock })
  render(<App isLessonPlatformV2Enabled getServices={getServices} />)
  authStateCallback?.({ uid: 'teacher-uid', emailVerified: true, providerData: [{ providerId: 'google.com' }] })
  await userEvent.click(await screen.findByRole('button', { name: 'このプランで申し込む' }))
  await waitFor(() => expect(assignMock).toHaveBeenCalledWith('https://checkout.stripe.com/x'))
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/components/teacher/organizations/PlanLimitsPage.test.tsx src/App.test.tsx`
Expected: FAIL

- [ ] **Step 3: 実装する**

`src/components/teacher/organizations/PlanLimitsPage.tsx`の`PlanLimitsPageProps`に`onCheckout?: () => void`・`checkingOut?: boolean`を追加し、`export function PlanLimitsPage({ data, error, onCheckout, checkingOut }: PlanLimitsPageProps)`に変更する。`<Table>`の直後に以下を追加する:

```tsx
      {onCheckout && (
        <Button variant="contained" disabled={checkingOut} onClick={onCheckout} sx={{ alignSelf: 'flex-start' }}>
          このプランで申し込む
        </Button>
      )}
```

（`Button`が既存のimportに含まれていなければ`@mui/material`から追加する。）

`src/App.tsx`の`import`に`createStripeCheckoutSession`（`./lib/billing/stripeCheckout`）を追加し、`PlanLimitsRoute`を以下のように書き換える:

```tsx
function PlanLimitsRoute({ services }: { services: FirebaseServices }) {
  const { orgId } = useParams<{ orgId: string }>()
  const [data, setData] = useState<PlanLimits>()
  const [error, setError] = useState<string>()
  const [checkingOut, setCheckingOut] = useState(false)
  useEffect(() => {
    let cancelled = false
    if (!orgId) return
    getOrgPlanLimits(services.functions, { orgId })
      .then((limits) => { if (!cancelled) setData(limits) })
      .catch(() => { if (!cancelled) setError('failed') })
    return () => { cancelled = true }
  }, [services, orgId])
  const handleCheckout = orgId ? () => {
    setCheckingOut(true)
    void createStripeCheckoutSession(services.functions, {
      orgId,
      planId: 'SCHOOL',
      successUrl: `${window.location.origin}/teacher/organizations/${orgId}/plan-limits`,
      cancelUrl: `${window.location.origin}/teacher/organizations/${orgId}/plan-limits`,
    })
      .then(({ url }) => { window.location.assign(url) })
      .finally(() => setCheckingOut(false))
  } : undefined
  return <PlanLimitsPage data={data} error={error} onCheckout={handleCheckout} checkingOut={checkingOut} />
}
```

（`planId: 'SCHOOL'`を固定値にしているのは、教師がどのプランに申し込むかを選ぶUIが本サブプロジェクトの範囲外のため——`PlanLimitsPage`は現在の組織の利用枠を表示する画面であり、複数プランからの選択導線は将来のタスクとする。既存の`useEffect`はそのまま残し、`handleCheckout`と`checkingOut`のstate、`return`文の変更のみを行う。）

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/components/teacher/organizations/PlanLimitsPage.test.tsx src/App.test.tsx`
Expected: PASS

- [ ] **Step 5: モノレポ全体を検証する**

Run: `npm run verify`
Expected: 全ワークスペースのlint/typecheck/test/buildが通過する

- [ ] **Step 6: コミット**

```bash
git add src/components/teacher/organizations/PlanLimitsPage.tsx src/components/teacher/organizations/PlanLimitsPage.test.tsx src/App.tsx src/App.test.tsx
git commit -m "feat: 利用枠画面にStripeチェックアウトへの申し込みボタンを統合"
```
