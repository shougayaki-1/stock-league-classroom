# 上位組織の枠配分・共有プール Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**正本:** `docs/superpowers/specs/2026-08-11-parent-org-quota-allocation-design.md`。

**Goal:** 上位組織が2軸の最低保証と共有余剰を安全に子学校へ配分できるようにする。

**Architecture:** 決定的IDの共有予約をFirestoreトランザクションで作成・返却する。学校ごとの保証内利用は予約不要とし、既存のLessonRun・招待処理へ資源別の予約を接続する。

**Tech Stack:** TypeScript、Firebase Functions v2/Admin SDK、Firestore、React/MUI、Vitest。

## Global Constraints

- 対象は同時授業・市場数と教師席のみ。全読み取り後に書き込むFirestoreトランザクションを守る。
- 既存授業・教師・データを停止または削除しない。既存ダウングレード制限と併用時は厳しい方を適用する。
- 新規Callableは`functions/src/index.ts`からexportし、functions/はsrc/をimportしない。

### Task 1: 配分・予約台帳の純粋ロジック

**Files:** Create `functions/src/organizations/parentOrgQuota.ts`, `.test.ts`

- [ ] **Step 1: Write failing tests** — 保証内は予約不要、保証超過は決定的IDで予約、余剰枯渇はエラー、同一対象は二重予約しない、返却を検証する。
- [ ] **Step 2: Verify failure** — `cd functions && npx vitest run src/organizations/parentOrgQuota.test.ts`
- [ ] **Step 3: Implement** — `QuotaResourceKey`、`SchoolQuotaAllocation`、`QuotaReservation`、`reserveSharedQuota`、`releaseSharedQuota`、`validateAllocationChange`を実装する。予約IDは`${resourceKey}:${schoolOrgId}:${targetId}`。
- [ ] **Step 4: Verify pass** — 同コマンドでPASS。
- [ ] **Step 5: Commit** — `git add functions/src/organizations/parentOrgQuota.ts functions/src/organizations/parentOrgQuota.test.ts && git commit -m "feat: 上位組織の共有枠予約台帳を追加する"`

### Task 2: 配分管理Callableと階層整合性

**Files:** Modify `functions/src/organizations/schoolHierarchy.ts`, `onCall.ts`, `index.ts` と各test; Create `parentOrgQuotaOnCall.ts`, `.test.ts`

- [ ] **Step 1: Write failing tests** — owner/adminのみ配分変更可、保証合計超過拒否、予約残存校の解除拒否、個票を返さない利用状況DTOを検証する。
- [ ] **Step 2: Verify failure** — `cd functions && npx vitest run src/organizations/schoolHierarchy.test.ts src/organizations/onCall.test.ts src/organizations/parentOrgQuotaOnCall.test.ts`
- [ ] **Step 3: Implement** — `setSchoolQuotaAllocationCallable`、`getParentOrgQuotaUsageCallable`、`getSchoolEffectiveQuotaCallable`を追加。紐付け時に保証0ドキュメントを作り、解除前に予約数0を確認する。
- [ ] **Step 4: Verify pass** — 同コマンドでPASS。
- [ ] **Step 5: Commit** — 変更したorganizations・index・testを全てaddし、`feat: 上位組織の学校別利用枠配分を追加する`。

### Task 3: LessonRun・教師席の予約返却

**Files:** Modify `functions/src/lessonRuns/createLessonRun.ts`, lifecycle modules, `functions/src/organizations/invitations.ts`, `suspendMember.ts` と各test

- [ ] **Step 1: Write failing tests** — 保証超過の作成/受諾が予約し、terminal遷移/教師解除が返却し、共有枯渇は`resource-exhausted`、ダウングレード制限は優先することを検証する。
- [ ] **Step 2: Verify failure** — 変更対象のFunctionsテストを実行しFAIL確認。
- [ ] **Step 3: Implement** — parentOrgIdを解決し、保証超過時だけTask 1の予約トランザクションを呼ぶ。terminal状態遷移とsuspend後に対応予約を返却する。
- [ ] **Step 4: Verify pass** — 同テストをPASS確認。
- [ ] **Step 5: Commit** — `feat: 学校利用時に上位組織の共有枠を予約する`。

### Task 4: 利用状況UIと全体検証

**Files:** Modify `src/lib/organizations/schoolHierarchy.ts`, `ParentOrgSettingsPage.tsx`, `PlanLimitsPage.tsx` と各test

- [ ] **Step 1: Write failing tests** — 親の総枠/保証/共有利用、学校の実効枠、予約残存時の解除不能理由を検証する。
- [ ] **Step 2: Verify failure** — `npx vitest run src/components/teacher/organizations/ParentOrgSettingsPage.test.tsx src/components/teacher/organizations/PlanLimitsPage.test.tsx`
- [ ] **Step 3: Implement** — owner/admin編集フォームと学校別集約表示を追加。クライアントDTOは手動でミラーする。
- [ ] **Step 4: Verify pass** — 同コマンドでPASS。
- [ ] **Step 5: Run full verification and commit** — `npm run verify`後、UI変更を`feat: 上位組織の枠配分状況を表示する`でcommitする。
