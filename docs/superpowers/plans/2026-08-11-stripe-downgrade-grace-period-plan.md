# Stripeダウングレード・整理猶予 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**正本:** `docs/superpowers/specs/2026-08-11-stripe-downgrade-grace-period-design.md`。矛盾する場合は仕様書を優先する。

**Goal:** Customer Portal経由の期間末ダウングレードを同期し、30日間の整理猶予と資源軸ごとの超過制限を提供する。

**Architecture:** WebhookはSubscription/Scheduleを読み、予約または確定したプラン変更だけを冪等同期する。利用枠状態は保存せず、現プラン・猶予・LessonRun数・教師数から導出し、制限は作成と教師招待受諾だけに挿入する。

**Tech Stack:** TypeScript、Firebase Cloud Functions v2、Firebase Admin SDK、Stripe Node SDK、React/MUI、Vitest。

## Global Constraints

- Customer Portalが唯一の変更経路。DashboardでSwitch plan/Manage downgradesを有効化し、対象Priceを同一Productに置く。
- 保存済み予約と一致する下位Priceが現在Priceになった時だけ`planId`を更新する。猶予は確定から30日で、データ・LessonRunを削除または停止しない。
- Firestoreは全読み取り後に書き込む。functions/はsrc/をimportせず、クライアントDTOは手動同期する。
- `customer.subscription.updated`のCustomer逆引き失敗は503、未知Price・不正Scheduleはログと200。Webhookの`secrets`列挙を維持する。
- 各タスク後に変更ファイルのテストを実行する。最後に`npm run verify`を実行してからコミットする。

---

## File Structure

| File | Change |
| --- | --- |
| `functions/src/organizations/downgradeEnforcement.ts`, `.test.ts` | Create: 違反、状態、資源別可否の純粋ロジック |
| `functions/src/organizations/planLimits.ts`, `.test.ts` | Modify: 利用量と状態DTOを返す |
| `functions/src/organizations/invitations.ts`, `.test.ts` | Modify: 教師招待受諾の教師席検査 |
| `functions/src/lessonRuns/createLessonRun.ts`, `.test.ts` | Modify: 猶予後のRun上限検査 |
| `functions/src/billing/stripeWebhook.ts`, `.test.ts` | Modify: Subscription更新の予約・確定同期 |
| `functions/src/organizations/onCall.ts`, `.test.ts` | Modify: DTO/エラーをCallableへ接続 |
| `src/lib/organizations/planLimits.ts`, `.test.ts` | Modify: クライアントDTOの手動ミラー |
| `src/components/teacher/organizations/PlanLimitsPage.tsx`, `.test.tsx` | Modify: 予約・猶予・制限理由を表示 |

### Task 1: 違反・猶予状態の純粋ロジック

**Files:** Create `functions/src/organizations/downgradeEnforcement.ts`, `functions/src/organizations/downgradeEnforcement.test.ts`

**Interfaces:** Produces `LimitViolation`, `DowngradeStatus`, `deriveDowngradeStatus`, `canIncreaseLimitedResource`.

- [ ] **Step 1: Write the failing test**

```ts
expect(deriveDowngradeStatus({ nowMillis: 199, graceEndsAtMillis: 200, pending: null, violations: [runViolation] }).state).toBe('GRACE')
expect(deriveDowngradeStatus({ nowMillis: 200, graceEndsAtMillis: 200, pending: null, violations: [runViolation] }).state).toBe('RESTRICTED')
expect(canIncreaseLimitedResource(restrictedTeacherStatus, 'teacherSeats')).toBe(false)
expect(canIncreaseLimitedResource(restrictedTeacherStatus, 'concurrentLessonsAndMarkets')).toBe(true)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npx vitest run src/organizations/downgradeEnforcement.test.ts`
Expected: FAIL because the module is absent.

- [ ] **Step 3: Write minimal implementation**

```ts
export type LimitKey = 'concurrentLessonsAndMarkets' | 'teacherSeats'
export interface LimitViolation { key: LimitKey; label: string; used: number; limit: number }
export interface DowngradeStatus { state: 'SCHEDULED' | 'NORMAL' | 'GRACE' | 'RESTRICTED'; pendingPlanChange?: { planId: string; effectiveAtMillis: number }; graceEndsAtMillis?: number; violations: LimitViolation[] }
export const canIncreaseLimitedResource = (status: DowngradeStatus, key: LimitKey) => status.state !== 'RESTRICTED' || !status.violations.some((x) => x.key === key)
```

`deriveDowngradeStatus` must prioritize `SCHEDULED`, then `NORMAL` for no violations, then `GRACE` while `nowMillis < graceEndsAtMillis`, otherwise `RESTRICTED`. Use exact labels `同時授業・市場数` and `教師席`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && npx vitest run src/organizations/downgradeEnforcement.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add functions/src/organizations/downgradeEnforcement.ts functions/src/organizations/downgradeEnforcement.test.ts && git commit -m "feat: ダウングレード時の利用枠違反を判定する"`

### Task 2: 利用枠DTOと資源別の操作制限

**Files:** Modify `functions/src/organizations/planLimits.ts`, `.test.ts`, `functions/src/organizations/invitations.ts`, `.test.ts`, `functions/src/lessonRuns/createLessonRun.ts`, `.test.ts`, `functions/src/organizations/onCall.ts`, `.test.ts`

**Interfaces:** Consumes Task 1. Produces `PlanLimits & { downgradeStatus: DowngradeStatus }` and two `resource-exhausted` errors.

- [ ] **Step 1: Write failing tests**

```ts
await expect(getOrgPlanLimits(deps, { orgId: 'org-1' })).resolves.toMatchObject({ downgradeStatus: { state: 'RESTRICTED', violations: [{ key: 'concurrentLessonsAndMarkets', used: 2, limit: 1 }, { key: 'teacherSeats', used: 3, limit: 1 }] } })
await expect(createLessonRun(restrictedDeps)).rejects.toThrow('同時授業・市場数を整理する必要があります')
await expect(acceptInvitation(restrictedTeacherDeps, teacherInput)).rejects.toThrow('教師席を整理する必要があります')
await expect(acceptInvitation(restrictedAdminDeps, adminInput)).resolves.toEqual({ status: 'ACCEPTED' })
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd functions && npx vitest run src/organizations/planLimits.test.ts src/organizations/invitations.test.ts src/lessonRuns/createLessonRun.test.ts src/organizations/onCall.test.ts`
Expected: FAIL because no status DTO or post-grace guard exists.

- [ ] **Step 3: Write minimal implementation**

Add `getDowngradeMetadata`, `countActiveLessonRuns`, `countActiveTeachers`, and `nowMillis` dependencies to plan-limit resolution. Count only `ACTIVE_LESSON_RUN_STATUSES`, and only active `teacher` members; convert persisted Timestamp to milliseconds only in the returned DTO. Inject `getDowngradeStatus(orgId)` into `createLessonRun` and reject only when `canIncreaseLimitedResource(status, 'concurrentLessonsAndMarkets')` is false. Inject it into `acceptInvitation` and check only a new inactive recipient accepting a `teacher` invitation before `syncMembership`; preserve admin and already-active paths. Translate both errors to `HttpsError('resource-exhausted', message)`.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd functions && npx vitest run src/organizations/planLimits.test.ts src/organizations/invitations.test.ts src/lessonRuns/createLessonRun.test.ts src/organizations/onCall.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add functions/src/organizations/planLimits.ts functions/src/organizations/planLimits.test.ts functions/src/organizations/invitations.ts functions/src/organizations/invitations.test.ts functions/src/lessonRuns/createLessonRun.ts functions/src/lessonRuns/createLessonRun.test.ts functions/src/organizations/onCall.ts functions/src/organizations/onCall.test.ts && git commit -m "feat: 猶予終了後の利用枠超過を操作別に制限する"`

### Task 3: Stripe予約・確定Webhook同期

**Files:** Modify `functions/src/billing/stripeWebhook.ts`, `functions/src/billing/stripeWebhook.test.ts`

**Interfaces:** Adds `{ type: 'customer.subscription.updated'; stripeCustomerId?: string; stripeSubscriptionId?: string; currentPriceId?: string; stripeScheduleId?: string }`.

- [ ] **Step 1: Write failing tests**

```ts
await handleStripeWebhookEvent(deps, subscriptionUpdated({ currentPriceId: 'price_pro', stripeScheduleId: 'sub_sched_1' }))
expect(syncSubscriptionPlanChange).toHaveBeenCalledWith('org-1', expect.objectContaining({ kind: 'SCHEDULE', planId: 'SCHOOL', effectiveAtMillis: 2000 }))
await expect(handleStripeWebhookEvent(unresolvedDeps, subscriptionUpdated({ currentPriceId: 'price_school' }))).resolves.toEqual({ status: 'retry' })
await expect(handleStripeWebhookEvent(unknownPriceDeps, subscriptionUpdated({ currentPriceId: 'price_unknown' }))).resolves.toEqual({ status: 'ok' })
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd functions && npx vitest run src/billing/stripeWebhook.test.ts`
Expected: FAIL because the event and synchronization dependencies are absent.

- [ ] **Step 3: Write minimal implementation**

Inject `getPlanIdForStripePrice`, `getScheduledPlanChange`, `syncSubscriptionPlanChange`, and `clearPendingPlanChange`; keep Stripe Schedule retrieval in production wiring, not the pure handler. A future Price maps to `SCHEDULE`; a current Price maps to `APPLY` only if it equals the persisted pending plan. The Firestore transaction reads organization before writing `planId`, deleting pending data, and setting one 30-day grace. Repeated events must not extend the grace. Null/unknown/ambiguous Schedule logs and returns `ok`; unresolved customer returns `retry`. Keep `secrets: [stripeWebhookSecret, stripeSecretKey]`.

- [ ] **Step 4: Run test to verify pass**

Run: `cd functions && npx vitest run src/billing/stripeWebhook.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add functions/src/billing/stripeWebhook.ts functions/src/billing/stripeWebhook.test.ts && git commit -m "feat: Customer Portalのダウングレード予約をWebhookで同期する"`

### Task 4: クライアントDTOと利用枠画面

**Files:** Modify `src/lib/organizations/planLimits.ts`, `.test.ts`, `src/components/teacher/organizations/PlanLimitsPage.tsx`, `.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
render(<PlanLimitsPage data={{ ...limits, downgradeStatus: scheduled }} error={undefined} />)
expect(screen.getByText(/変更予定/)).toBeInTheDocument()
render(<PlanLimitsPage data={{ ...limits, downgradeStatus: restricted }} error={undefined} />)
expect(screen.getByText('同時授業・市場数: 2 / 1')).toBeInTheDocument()
expect(screen.getByText(/新規作成を停止中/)).toBeInTheDocument()
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run src/lib/organizations/planLimits.test.ts src/components/teacher/organizations/PlanLimitsPage.test.tsx`
Expected: FAIL because the client DTO and panel do not exist.

- [ ] **Step 3: Write minimal implementation**

Mirror the server DTO exactly with millisecond date fields; do not import server types. Render MUI `Alert` only for `SCHEDULED`, `GRACE`, and `RESTRICTED`, use `new Date(millis).toLocaleDateString('ja-JP')`, and show every violation as `label: used / limit`. Preserve the seven-row table and Customer Portal button.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/lib/organizations/planLimits.test.ts src/components/teacher/organizations/PlanLimitsPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add src/lib/organizations/planLimits.ts src/lib/organizations/planLimits.test.ts src/components/teacher/organizations/PlanLimitsPage.tsx src/components/teacher/organizations/PlanLimitsPage.test.tsx && git commit -m "feat: 利用枠画面にダウングレード整理状況を表示する"`

### Task 5: 将来拡張メモと全体検証

**Files:** Modify `docs/superpowers/plans/2026-08-05-master-plan-phase-a-to-h.md`

- [ ] **Step 1: Verify the deferred-axis memo**

Run: `rg -n "Phase Fの将来拡張メモ|aiCredits|templateStorage|resultRetentionDays" docs/superpowers/plans/2026-08-05-master-plan-phase-a-to-h.md`
Expected: all five deferred axes and their integration points are listed.

- [ ] **Step 2: Run complete verification**

Run: `npm run verify`
Expected: all root, rules, market-concurrency, functions, package lint/typecheck/test/build commands PASS. Emulator tests require local-port permission.

- [ ] **Step 3: Commit the future-extension memo**

Run: `git add docs/superpowers/plans/2026-08-05-master-plan-phase-a-to-h.md && git commit -m "docs: Phase Fの未実装利用枠軸を記録する"`
