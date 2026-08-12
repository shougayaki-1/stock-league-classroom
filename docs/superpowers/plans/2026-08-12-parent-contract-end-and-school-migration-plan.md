# 上位契約終了時のデータ保持・学校単独契約移行 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**正本:** `docs/superpowers/specs/2026-08-12-parent-contract-end-and-school-migration-design.md`。

**Goal:** 上位組織の契約終了後も学校データを保持し、最新の有効な学校Stripe契約を確認したowner/adminが安全に単独組織へ移行できるようにする。

**Architecture:** Stripe Subscriptionイベントを時刻順に同期し、終了状態を親組織へ独立して保存する。終了中は共有枠の新規消費・配分・学校追加を停止し、学校の移行Callableが親由来の予約をページ削除してから短い最終トランザクションで親子関係だけを解除する。

**Tech Stack:** TypeScript、Firebase Functions v2/Admin SDK、Firestore、Stripe SDK、React/MUI、Vitest。

## Global Constraints

- Stripeの正本は署名検証済みWebhook。`invoice.paid` / `invoice.payment_failed` は既存の請求記録を維持するが、終了状態と移行可否を変えない。
- `STRIPE_SECRET_KEY` と `STRIPE_WEBHOOK_SECRET` は既存の `defineSecret` を使い、Webhookの `secrets` 配列から外さない。テストモード以外のキーをコードへ追加しない。
- 全Firestoreトランザクションは全読み取りを終えてから書き込む。Functionsは `src/` をimportしない。クライアントDTOは手動でミラーする。
- 親・学校・LessonRun・メンバー・教材・生徒・請求履歴・RTDBアクセスを削除しない。削除対象は移行済み学校に対応する親の `schoolAllocations` と `quotaReservations` だけである。
- 新規Callableは `functions/src/index.ts` からexportし、学校owner/admin以外に移行操作を許可しない。

### Task 1: Stripe Subscriptionの順序耐性を持つ状態同期

**Files:**
- Create: `functions/src/billing/subscriptionState.ts`
- Create: `functions/src/billing/subscriptionState.test.ts`
- Create: `functions/src/organizations/parentContract.ts`
- Create: `functions/src/organizations/parentContract.test.ts`
- Modify: `functions/src/billing/stripeWebhook.ts`
- Modify: `functions/src/billing/stripeWebhook.test.ts`

**Interfaces:**

```ts
export type StripeSubscriptionState = {
  subscriptionId: string
  status: string
  eventCreatedAtMillis: number
}

export const shouldApplySubscriptionState = (
  existing: StripeSubscriptionState | undefined,
  incoming: StripeSubscriptionState,
): boolean
```

`functions/src/organizations/parentContract.ts` owns the shared type:

```ts
export type ParentContractState = 'ACTIVE' | 'ENDED'
export const parentContractStateFrom = (data: Record<string, unknown> | undefined): ParentContractState =>
  data?.parentContractState === 'ENDED' ? 'ENDED' : 'ACTIVE'
```

`StripeWebhookEvent` の `customer.subscription.updated` / `customer.subscription.deleted` には `stripeSubscriptionId` と `eventCreatedAtMillis` を含める。updatedにはStripe Subscriptionの `status` も含める。Webhook dependencyには次を追加する。

```ts
syncStripeSubscriptionState?: (
  orgId: string,
  state: StripeSubscriptionState,
  parentContractState: ParentContractState | undefined,
) => Promise<void>
```

- [ ] **Step 1: Write the failing pure-state tests**

`subscriptionState.test.ts` で、同じまたは古い `eventCreatedAtMillis` のイベントは無視し、新しいイベントだけを許可するテストを書く。`canceled` は親を `ENDED` にし、より新しい `active` だけが `ACTIVE` へ戻せることを検証する。

```ts
expect(shouldApplySubscriptionState(
  { subscriptionId: 'sub_1', status: 'canceled', eventCreatedAtMillis: 200 },
  { subscriptionId: 'sub_1', status: 'active', eventCreatedAtMillis: 199 },
)).toBe(false)
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm run test --workspace=functions -- src/billing/subscriptionState.test.ts src/organizations/parentContract.test.ts`

Expected: FAIL because `subscriptionState.ts` does not exist.

- [ ] **Step 3: Implement the pure state guard**

Create `subscriptionState.ts`. The comparison must be strict (`incoming.eventCreatedAtMillis > existing.eventCreatedAtMillis`), allowing a different new subscription only when its event is newer. Import `ParentContractState` from the organization helper and export `parentContractStateFor(orgType, status)` that returns `ENDED` only for `orgType === 'parentOrg' && status === 'canceled'`, `ACTIVE` only for parent `active`, and `undefined` otherwise. Create the organization helper with the exact type and parser shown above.

- [ ] **Step 4: Extend webhook extraction and dispatch**

In `stripeWebhook.ts`, pass `stripeEvent.created * 1_000`, Subscription `id`, and `status` from `extractEvent`. In `handleStripeWebhookEvent`, resolve the customer first, then invoke `syncStripeSubscriptionState` for updated/deleted events even when the current Price is unknown; retain existing Price/Schedule plan-change handling after this state sync. Do not call this dependency for invoice events.

Implement production wiring as one transaction that reads `organizations/{orgId}` before writing:

```ts
const existing = organization.get('stripeSubscriptionState') as StripeSubscriptionState | undefined
if (!shouldApplySubscriptionState(existing, incoming)) return
transaction.update(organizationRef, {
  stripeSubscriptionState: incoming,
  ...(parentState === undefined ? {} : {
    parentContractState: parentState,
    parentContractSubscriptionId: incoming.subscriptionId,
    parentContractEventCreatedAtMillis: incoming.eventCreatedAtMillis,
    ...(parentState === 'ENDED' ? { parentContractEndedAt: FieldValue.serverTimestamp() } : {}),
  }),
})
```

For a parent `ACTIVE` update, remove `parentContractEndedAt`. Do not modify child schools in this transaction.

- [ ] **Step 5: Add webhook tests and verify pass**

Add tests that a parent deletion calls the sync dependency with `ENDED`, a newer parent active event calls it with `ACTIVE`, old events leave the stored state unchanged, invoice events never call it, and unresolved customers still produce the existing retry outcome.

Run: `npm run test --workspace=functions -- src/billing/subscriptionState.test.ts src/organizations/parentContract.test.ts src/billing/stripeWebhook.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/src/billing/subscriptionState.ts functions/src/billing/subscriptionState.test.ts functions/src/organizations/parentContract.ts functions/src/organizations/parentContract.test.ts functions/src/billing/stripeWebhook.ts functions/src/billing/stripeWebhook.test.ts
git commit -m "feat: Stripe契約終了状態を順序耐性付きで同期する"
```

### Task 2: 終了済み親の共有枠停止と利用状況DTO

**Files:**
- Modify: `functions/src/organizations/parentContract.ts`
- Modify: `functions/src/organizations/parentContract.test.ts`
- Modify: `functions/src/organizations/parentOrgQuotaOnCall.ts`
- Modify: `functions/src/organizations/parentOrgQuotaOnCall.test.ts`
- Modify: `functions/src/organizations/schoolHierarchy.ts`
- Modify: `functions/src/organizations/schoolHierarchy.test.ts`
- Modify: `functions/src/organizations/onCall.ts`
- Modify: `functions/src/organizations/onCall.test.ts`
- Modify: `functions/src/lessonRuns/createLessonRun.ts`
- Modify: `functions/src/lessonRuns/createLessonRun.test.ts`
- Modify: `functions/src/organizations/invitations.ts`
- Modify: `functions/src/organizations/invitations.test.ts`

**Interfaces:**

```ts
export const assertParentContractAllowsSharedQuota = (state: ParentContractState): void
```

Extend both server quota response shapes with `parentContractState: ParentContractState`. The hand-maintained client DTO update is Task 4.

- [ ] **Step 1: Write failing parent-contract and enforcement tests**

Test that a missing state is `ACTIVE`, `ENDED` throws exactly `親組織の契約が終了しているため共有枠を利用できません`, and that a parent marked `ENDED` rejects allocation changes, school links, LessonRun creation requiring a shared reservation, and teacher invitation acceptance requiring a shared reservation. Also verify a LessonRun within the school’s guarantee remains allowed.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm run test --workspace=functions -- src/organizations/parentContract.test.ts src/organizations/parentOrgQuotaOnCall.test.ts src/organizations/schoolHierarchy.test.ts src/organizations/invitations.test.ts src/lessonRuns/createLessonRun.test.ts`

Expected: FAIL because the parent state helper and checks do not exist.

- [ ] **Step 3: Implement the central state helper and backend guards**

Create `parentContract.ts` with the two exported functions above. Never use client types in this Functions file.

Apply it at the points that consume or change parent capacity:

- In `setSchoolQuotaAllocationCallable`, inspect the parent snapshot in the existing transaction before loading limits and reject `ENDED`.
- In `linkSchoolToParentOrgWithAdminSdk`, read the parent contract state in the existing link transaction and reject before updating `parentOrgId` or creating the zero allocation.
- In `createLessonRun` and `reserveTeacherSeatForInvitation`, read the already-needed parent document before querying allocations/reservations; call the helper only when the operation would need a new shared reservation. Existing guarantee-only use remains governed by the school’s own plan.

Translate the new error at `createLessonRunCallable` and `acceptInvitationCallable` to `failed-precondition`. Preserve the existing `resource-exhausted` mapping for actual shared-pool exhaustion.

- [ ] **Step 4: Add contract state to quota reads**

Have `readParentQuotaState` return `parentContractState` from the parent document. Include it in both `getParentOrgQuotaUsageCallable` and `getSchoolEffectiveQuotaCallable`. Keep the aggregate-only response: no child membership, LessonRun body, or student field may be returned.

- [ ] **Step 5: Run the focused tests to verify pass**

Run: `npm run test --workspace=functions -- src/organizations/parentContract.test.ts src/organizations/parentOrgQuotaOnCall.test.ts src/organizations/schoolHierarchy.test.ts src/organizations/onCall.test.ts src/organizations/invitations.test.ts src/lessonRuns/createLessonRun.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/src/organizations/parentContract.ts functions/src/organizations/parentContract.test.ts functions/src/organizations/parentOrgQuotaOnCall.ts functions/src/organizations/parentOrgQuotaOnCall.test.ts functions/src/organizations/schoolHierarchy.ts functions/src/organizations/schoolHierarchy.test.ts functions/src/organizations/onCall.ts functions/src/organizations/onCall.test.ts functions/src/lessonRuns/createLessonRun.ts functions/src/lessonRuns/createLessonRun.test.ts functions/src/organizations/invitations.ts functions/src/organizations/invitations.test.ts
git commit -m "feat: 終了済み上位契約の共有枠利用を停止する"
```

### Task 3: 再実行可能な学校単独契約移行Callable

**Files:**
- Create: `functions/src/organizations/parentContractMigration.ts`
- Create: `functions/src/organizations/parentContractMigration.test.ts`
- Create: `functions/src/organizations/parentContractMigrationOnCall.ts`
- Create: `functions/src/organizations/parentContractMigrationOnCall.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**

```ts
export interface MigrateSchoolFromEndedParentInput {
  schoolOrgId: string
  actorUid: string
}

export type ParentContractMigrationResult =
  | { status: 'MIGRATED'; parentOrgId: string }
  | { status: 'RETRY_REQUIRED'; deletedReservationCount: number }

export const migrateSchoolFromEndedParent: (
  deps: ParentContractMigrationDeps,
  input: MigrateSchoolFromEndedParentInput,
) => Promise<ParentContractMigrationResult>
```

`ParentContractMigrationDeps` must expose separate operations for: reading migration preconditions, listing one page of reservations for a `parentOrgId`/`schoolOrgId`, deleting that page in an Admin SDK batch, and a `finalizeMigration` Firestore transaction. `finalizeMigration` must re-read parent, school, and reservation count before writing.

- [ ] **Step 1: Write failing pure-flow tests**

Write tests for: not linked, parent not `ENDED`, school Subscription not latest `active`, and stale parent change all fail before deletion; a page deletion failure returns/rejects while the school remains linked; a retry deletes remaining reservations; finalization writes exactly `parentOrgId: null`, deletes only the parent allocation, and creates the audit record.

Use a fake that fails if a transaction reads after its first write. Assert the final transaction order is parent read, school read, reservation count read, then three writes.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm run test --workspace=functions -- src/organizations/parentContractMigration.test.ts`

Expected: FAIL because the migration module does not exist.

- [ ] **Step 3: Implement the migration domain module**

Implement precondition validation with these exact checks:

```ts
parentContractStateFrom(parent) === 'ENDED'
school.parentOrgId === parentOrgId
school.stripeSubscriptionState?.status === 'active'
typeof school.stripeSubscriptionState?.subscriptionId === 'string'
```

Delete at most 400 reservation documents per page. If a full page was deleted, return `RETRY_REQUIRED` without finalizing; this keeps a single Callable invocation bounded. If fewer than 400 were found, call `finalizeMigration`. A retry starts at the first remaining page, so no cursor persistence is needed.

The finalization transaction must reject if parent is no longer `ENDED`, school no longer points to that parent, or `getReservationCount(parentOrgId, schoolOrgId) !== 0`. On success, update `organizations/{schoolOrgId}` with `parentOrgId: null`, delete `organizations/{parentOrgId}/schoolAllocations/{schoolOrgId}`, and set `organizations/{schoolOrgId}/parentContractMigrations/{parentOrgId}` with `parentOrgId`, `migratedByUid`, `migratedAt`, and the checked `schoolSubscriptionId`.

- [ ] **Step 4: Write failing Callable authorization tests**

In `parentContractMigrationOnCall.test.ts`, mock `requireActiveOrgMember`. Verify unauthenticated/invalid input, non-teacher identity, school teacher role, and parent-only membership are rejected; school owner/admin are accepted; exact domain precondition errors become `failed-precondition`.

- [ ] **Step 5: Implement production wiring and Callable export**

Implement `migrateSchoolFromEndedParentCallable` with `{ region: 'asia-northeast1' }`. It must call `requireActiveOrgMember(db, schoolOrgId, auth.uid)` and allow only `owner`/`admin`. Use `BulkWriter` or Firestore write batches only for the 400-document deletion page; use `db.runTransaction` for finalization. Do not give this Callable Stripe secrets.

Export it from `functions/src/index.ts`:

```ts
export { migrateSchoolFromEndedParentCallable } from './organizations/parentContractMigrationOnCall'
```

- [ ] **Step 6: Run focused tests to verify pass**

Run: `npm run test --workspace=functions -- src/organizations/parentContractMigration.test.ts src/organizations/parentContractMigrationOnCall.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add functions/src/organizations/parentContractMigration.ts functions/src/organizations/parentContractMigration.test.ts functions/src/organizations/parentContractMigrationOnCall.ts functions/src/organizations/parentContractMigrationOnCall.test.ts functions/src/index.ts
git commit -m "feat: 学校の単独契約移行を追加する"
```

### Task 4: 親・学校画面の終了案内と移行導線

**Files:**
- Modify: `src/lib/organizations/parentOrgQuota.ts`
- Modify: `src/lib/organizations/parentOrgQuota.test.ts`
- Create: `src/lib/organizations/parentContractMigration.ts`
- Create: `src/lib/organizations/parentContractMigration.test.ts`
- Modify: `src/components/teacher/organizations/ParentOrgSettingsPage.tsx`
- Modify: `src/components/teacher/organizations/ParentOrgSettingsPage.test.tsx`
- Modify: `src/components/teacher/organizations/PlanLimitsPage.tsx`
- Modify: `src/components/teacher/organizations/PlanLimitsPage.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**

```ts
export interface MigrateSchoolFromEndedParentInput { schoolOrgId: string }
export type ParentContractMigrationResult =
  | { status: 'MIGRATED'; parentOrgId: string }
  | { status: 'RETRY_REQUIRED'; deletedReservationCount: number }

export const migrateSchoolFromEndedParent = (
  functions: Functions,
  input: MigrateSchoolFromEndedParentInput,
) => Promise<ParentContractMigrationResult>
```

Add `parentContractState: 'ACTIVE' | 'ENDED'` to the client mirrors of `ParentOrgQuotaUsageResult` and `SchoolEffectiveQuotaResult` exactly as returned by Task 2.

- [ ] **Step 1: Write failing client-wrapper and component tests**

Test that the new client wrapper calls `migrateSchoolFromEndedParentCallable` with `{ schoolOrgId }`. In `ParentOrgSettingsPage`, test that `ENDED` shows the contract-end notice and disables both “追加” and “配分を保存”. In `PlanLimitsPage`, test a non-manager sees the notice only; an owner/admin sees checkout and a disabled migration button until `schoolSubscriptionState.status === 'active'`; and an active state enables the button.

- [ ] **Step 2: Run the focused UI tests to verify they fail**

Run: `npm run test -- src/lib/organizations/parentContractMigration.test.ts src/components/teacher/organizations/ParentOrgSettingsPage.test.tsx src/components/teacher/organizations/PlanLimitsPage.test.tsx`

Expected: FAIL because the wrapper, state DTO fields, and component props do not exist.

- [ ] **Step 3: Implement client DTOs, wrapper, and presentational controls**

Create the wrapper using `httpsCallable` and the exact Callable name. Extend `ParentOrgSettingsPageProps` with `parentContractState`; disable add/allocation interactions only when it is `ENDED`, while preserving school list and aggregate display.

Extend `PlanLimitsPageProps` with:

```ts
parentContractState?: 'ACTIVE' | 'ENDED'
schoolSubscriptionState?: { status: string } | null
canManageContract?: boolean
onMigrateFromEndedParent?: () => void
migratingFromEndedParent?: boolean
```

When ended, show the data-retention explanation and render the migration button with `disabled={schoolSubscriptionState?.status !== 'active' || migratingFromEndedParent}`. Do not expose another school’s state or parent quota values.

- [ ] **Step 4: Wire the routes in `App.tsx`**

In the existing organization document read for `PlanLimitsRoute`, read the school's `stripeSubscriptionState` and retrieve `getSchoolEffectiveQuota` for linked schools. In parallel call the existing `listOrgMembers` wrapper, find `services.auth.currentUser?.uid`, and derive `canManageContract` only from an `owner` or `admin` role; do not infer management rights from document ownership.

Call the migration wrapper only for a linked school in `ENDED` state. On `MIGRATED`, clear cached school quota data and re-read the organization document; on `RETRY_REQUIRED`, keep the link and show a retryable progress message. Reuse the existing checkout flow for school subscription purchase.

- [ ] **Step 5: Run focused tests to verify pass**

Run: `npm run test -- src/lib/organizations/parentOrgQuota.test.ts src/lib/organizations/parentContractMigration.test.ts src/components/teacher/organizations/ParentOrgSettingsPage.test.tsx src/components/teacher/organizations/PlanLimitsPage.test.tsx src/App.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/organizations/parentOrgQuota.ts src/lib/organizations/parentOrgQuota.test.ts src/lib/organizations/parentContractMigration.ts src/lib/organizations/parentContractMigration.test.ts src/components/teacher/organizations/ParentOrgSettingsPage.tsx src/components/teacher/organizations/ParentOrgSettingsPage.test.tsx src/components/teacher/organizations/PlanLimitsPage.tsx src/components/teacher/organizations/PlanLimitsPage.test.tsx src/App.tsx src/App.test.tsx
git commit -m "feat: 上位契約終了時の学校移行導線を表示する"
```

### Task 5: 統合検証と計画どおりの境界確認

**Files:** No production-file changes. Inspect the committed changes from Tasks 1–4.

- [ ] **Step 1: Run all required verification commands**

Run:

```bash
npx tsc -b
npm run test
npm run test:rules
npm run lint
npm run verify --workspace=functions
npm run test:market-concurrency
```

Expected: every command exits 0. Record only pre-existing lint or emulator warnings; do not suppress them in this task.

- [ ] **Step 2: Inspect the implementation against the acceptance conditions**

Confirm from the committed files that: no deletion path targets a school or its data; `customer.subscription.deleted` changes only the parent state; invoice events cannot reactivate it; all shared-reservation entry points check `ENDED`; final migration re-reads state before writes; the new Callable is exported; and client/server DTOs have identical field names.
