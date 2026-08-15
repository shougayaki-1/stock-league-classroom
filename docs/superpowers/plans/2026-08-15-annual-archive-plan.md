# 年度単位のアーカイブ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学校組織の `owner` が年度単位で完了済み・打ち切り済みの `LessonRun` を予約アーカイブでき、処理完了前なら取り消せるようにする。アーカイブ済み授業は既存の `ARCHIVED` 状態へ移し、操作・進捗・取消・失敗を監査可能かつリトライ安全にする。

**Architecture:** `ARCHIVED` は通常授業進行とは別の組織管理操作として扱う。`organizations/{orgId}/annualArchiveJobs/{jobId}` に予約ジョブを作成し、Cloud Scheduler が期限到来ジョブを処理する。対象は指定年度内に終了した `COMPLETED` / `ABORTED` の `LessonRun` のみ。各 run は専用トランザクションで `ARCHIVED` にし、元状態と job ID を保存する。取消要求が処理完了より先に確定した場合は `CANCELLING` とし、その job がアーカイブした run を元の `COMPLETED` / `ABORTED` に戻して `CANCELLED` にする。

**Tech Stack:** TypeScript, Firebase Cloud Functions v2 Callable, Firebase Scheduler, Firestore Admin SDK / transactions, React 19, Vite, Vitest, Testing Library, MUI.

## Global Constraints

- 正本は `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md`。
- 統合仕様では年度アーカイブは予約可能であり、取消対象にも明示的に含まれる。取消可能期間の目安は「処理完了まで」。
- `LessonRunStatus` には既に `ARCHIVED` が存在する。新しい `PENDING_ARCHIVE` 等を `LessonRun.status` に追加しない。
- `functions/src/lessonRuns/phases/stateMachine.ts` の通常授業 lifecycle は変更しない。特に教師用 `transitionPhaseCallable` から `ARCHIVED` へ遷移できるようにしてはならない。
- アーカイブ対象は `status in ['COMPLETED', 'ABORTED']` かつ `endedAt` が対象年度内の run のみ。`DRAFT` / `READY` / `WAITING` / `RUNNING` / `PAUSED` / `INTERRUPTED` / `REFLECTION` は絶対に変更しない。
- 「年度」の開始月は統合仕様で定義されていないため、この実装では日本の学校年度として **4月1日 00:00 JST 以上、翌年4月1日 00:00 JST 未満**を採用する。`academicYear: 2025` は 2025年度を意味する。この境界は1つの helper に集約し、各所で日付計算を複製しない。
- `LessonRun` には `startedAt` / `endedAt` が既に定義されているが、現在の `transitionPhase` はこれらを更新していない。この計画で今後の lifecycle を修正するが、過去データの推測 backfill はしない。`endedAt == null` は年度アーカイブ対象外。
- 組織全体を横断する操作なので **owner のみ**。admin/teacher には許可しない。既存の組織一括エクスポート・保持期間・完全削除と同じ保守的な責任境界を使う。
- 認証・認可順序は `request.auth → teacher claim → scalar input validation → requireActiveOrgMember → owner role → job/lessonRuns reads`。owner 判定前に `annualArchiveJobs` や `lessonRuns` を読まない。
- 年度アーカイブは削除ではなく可逆な状態変更であり、仕様の「重大操作」例に明示されていないため、このタスクでは fresh reauth を新規要求しない。ただし理由入力・影響件数の事前表示・明示確認を要求する。
- `reason` は trim 後1〜500文字。
- 操作は冪等。リトライで二重アーカイブ、二重復元、二重 job 作成を起こさない。
- job 状態は新規に `SCHEDULED | RUNNING | CANCELLING | COMPLETED | CANCELLED | FAILED` を使用する。
- `FAILED` は部分処理済み run をそのまま保持し、scheduler の再試行で残りから再開する。最初からやり直して二重処理しない。
- `CANCELLING` は、当該 job が `ARCHIVED` にした run を全て元状態へ戻す。部分アーカイブ状態のまま `CANCELLED` にしてはならない。
- 完了と取消が競合した場合は job status のトランザクションで勝者を一意にする。`COMPLETED` 確定後の取消は拒否する。
- 各 run に新規 server-managed metadata として `archiveJobId`, `archivedAcademicYear`, `archivedFromStatus`, `archivedAt` を持たせる。取消成功時はこれらを除去する。
- 監査ログは `organizations/{orgId}/auditLog` に置く。run や job の配下だけに監査証跡を閉じ込めない。
- 監査ログに生徒名・外部識別子等の個人情報を複製しない。`jobId`, `academicYear`, 件数, reason, operation status のみ。
- job の実行可能状態への遷移と監査記録は同一 Firestore transaction に含める。「job は実行可能になったが監査ログがない」を許可しない。
- Firestore クライアントからの直接書き込みは追加しない。現行 `lessonRuns` は既に `allow write: if false`。
- `firestore.indexes.json` に年度検索用 index を追加する。現在は `orgId + status` までしかない。
- 生徒データ検索、保持期限、完全削除、一括エクスポートの既存挙動は変更しない。
- 過度な job framework 共通化、汎用 workflow engine、新規 queue abstraction は作らない。

---

### Task 1: `LessonRun.startedAt / endedAt` を lifecycle の正本として更新する

**Files:**
- Modify: `functions/src/lessonRuns/phases/transitionPhase.ts`
- Modify: `functions/src/lessonRuns/phases/transitionPhase.test.ts`
- Test: `functions/src/lessonRuns/phases/transitionPhase.test.ts`

**Interfaces:**

Consumes:
- 既存 `TransitionPhaseDeps.now`
- 既存 `LessonRun.startedAt`
- 既存 `LessonRun.endedAt`
- 既存 status transitions

Produces:
- `RUNNING` 初回遷移時の `startedAt`
- `COMPLETED` / `ABORTED` 遷移時の `endedAt`

- [ ] **Step 1: 失敗テストを書く。**

最低限以下を固定する。

1. `WAITING → RUNNING` で `startedAt` が null の場合だけ現在時刻を保存する。
2. 一度存在する `startedAt` は PAUSED 等から RUNNING に戻っても上書きしない。
3. `REFLECTION → COMPLETED` で `endedAt` を保存する。
4. `WAITING/RUNNING/PAUSED/INTERRUPTED → ABORTED` でも `endedAt` を保存する。
5. その他の遷移では両 timestamp を変更しない。
6. idempotency retry で timestamp が更新されない。

- [ ] **Step 2: failure を確認する。**

```bash
npm test --workspace=functions -- src/lessonRuns/phases/transitionPhase.test.ts
```

- [ ] **Step 3: 最小実装を追加する。**

既存 transaction の read phase / write phase 順序を壊さず、現在の run document を読み終わってから書き込み内容を決定する。

`Timestamp.now()` 相当の production 値と、テスト注入する `now` が同じ経路を通るようにする。

- [ ] **Step 4: tests + typecheck。**

```bash
npm test --workspace=functions -- src/lessonRuns/phases/transitionPhase.test.ts
npm run typecheck --workspace=functions
```

- [ ] **Step 5: commit。**

```bash
git add functions/src/lessonRuns/phases/transitionPhase.ts functions/src/lessonRuns/phases/transitionPhase.test.ts
git commit -m "fix: record lesson run lifecycle timestamps"
```

---

### Task 2: 年度アーカイブの純粋ロジックと run 単位の可逆処理を実装する

**Files:**
- Create: `functions/src/privacy/annualArchive.ts`
- Create: `functions/src/privacy/annualArchive.test.ts`
- Modify: `functions/src/privacy/auditLog.ts`
- Modify: `functions/src/privacy/auditLog.test.ts`
- Modify: `firestore.indexes.json`

**Interfaces:**

Produces:
- `AnnualArchiveJobStatus`
- `AnnualArchiveJob`
- `AnnualArchiveLessonRun`
- `getAcademicYearBounds(academicYear)`
- `archiveLessonRunForJob(...)`
- `rollbackLessonRunArchive(...)`
- transaction-safe org audit helper

`AnnualArchiveJob` は最低限次を持つ。

- `id`
- `orgId`
- `academicYear`
- `periodStart`
- `periodEnd`
- `status`
- `scheduledFor`
- `reason`
- `requestedByUid`
- `createdAt`
- `startedAt?`
- `completedAt?`
- `cancelRequestedAt?`
- `cancelledAt?`
- `archivedCount`
- `restoredCount`
- `lastError?`
- lease 用 `leaseOwner?`, `leaseUntil?`

新規 path:

`organizations/{orgId}/annualArchiveJobs/{jobId}`

- [ ] **Step 1: 年度境界と run 処理の失敗テストを書く。**

固定する条件:

1. `academicYear=2025` の期間が 2025-04-01 JST 以上、2026-04-01 JST 未満。
2. `COMPLETED` はアーカイブ可能。
3. `ABORTED` も可能。
4. その他 status は変更しない。
5. 年度外 `endedAt` は変更しない。
6. `endedAt == null` は変更しない。
7. 成功時 `ARCHIVED` + job metadata を保存する。
8. 同一 job の再試行は no-op/deduplicated。
9. 別 job が既に archive した run は上書きしない。
10. rollback は `archiveJobId` が一致する run だけ元 status へ戻す。
11. rollback retry は冪等。
12. `archivedFromStatus` が `COMPLETED | ABORTED` 以外なら安全側で失敗する。

- [ ] **Step 2: failure を確認する。**

```bash
npm test --workspace=functions -- src/privacy/annualArchive.test.ts src/privacy/auditLog.test.ts
```

- [ ] **Step 3: 最小実装と indexes を追加する。**

年度対象 query 用に `lessonRuns` の `orgId + status + endedAt` index を追加する。

run の archive / rollback は transaction 内で current status と job ownership を再検証する。事前 query の結果だけを信用しない。

- [ ] **Step 4: tests + typecheck。**

```bash
npm test --workspace=functions -- src/privacy/annualArchive.test.ts src/privacy/auditLog.test.ts
npm run typecheck --workspace=functions
```

- [ ] **Step 5: commit。**

```bash
git add functions/src/privacy/annualArchive.ts functions/src/privacy/annualArchive.test.ts functions/src/privacy/auditLog.ts functions/src/privacy/auditLog.test.ts firestore.indexes.json
git commit -m "feat: add reversible annual archive core"
```

---

### Task 3: owner 専用の preview / schedule / cancel / list Callables を追加する

**Files:**
- Modify: `functions/src/privacy/onCall.ts`
- Modify: `functions/src/privacy/onCall.test.ts`
- Modify: `functions/src/index.ts`
- Test: `functions/src/privacy/onCall.test.ts`

**Interfaces:**

Produces:
- `previewAnnualArchiveCallable`
- `scheduleAnnualArchiveCallable`
- `cancelAnnualArchiveCallable`
- `listAnnualArchiveJobsCallable`

Preview request:
- `orgId`
- `academicYear`

Preview response:
- `academicYear`
- `periodStart`
- `periodEnd`
- `eligibleCount`
- `missingEndedAtCount`

Schedule request:
- `orgId`
- `academicYear`
- `scheduledFor`
- `reason`
- `idempotencyKey`

Cancel request:
- `orgId`
- `jobId`
- `reason`
- `idempotencyKey`

- [ ] **Step 1: auth/order の失敗テストを書く。**

最低限:

1. unauthenticated → data reads 0。
2. teacher claim 不成立 → data reads 0。
3. malformed org/year/date/reason → membership read より前に失敗。
4. inactive membership → lessonRuns/job read 0。
5. admin → permission-denied、lessonRuns/job read 0。
6. teacher → permission-denied、lessonRuns/job read 0。
7. owner → preview 成功。
8. owner → schedule 成功。
9. 同じ idempotency key →同じ job。
10. 同じ key + 異なる payload → failed-precondition。
11. schedule の job activation と `SCHEDULE_ANNUAL_ARCHIVE` audit が原子的。
12. cancel は `SCHEDULED`, `RUNNING`, `FAILED` から `CANCELLING` へ進める。
13. `COMPLETED` の cancel は failed-precondition。
14. cancel 状態変更と `CANCEL_ANNUAL_ARCHIVE` audit が原子的。
15. admin/teacher は list も不可。
16. fresh reauth を要求しない。

- [ ] **Step 2: failure を確認する。**

```bash
npm test --workspace=functions -- src/privacy/onCall.test.ts
```

- [ ] **Step 3: Callable を最小実装する。**

すべての callable でこの順序を固定する。

1. authentication
2. teacher claim
3. scalar validation
4. `getFirestore()`
5. `requireActiveOrgMember`
6. `membership.role === 'owner'`
7. archive/job data access

schedule 前に eligible run 数を再計算してもよいが、preview 結果を認可判断に使用しない。

- [ ] **Step 4: tests + typecheck。**

```bash
npm test --workspace=functions -- src/privacy/onCall.test.ts
npm run typecheck --workspace=functions
```

- [ ] **Step 5: commit。**

```bash
git add functions/src/privacy/onCall.ts functions/src/privacy/onCall.test.ts functions/src/index.ts
git commit -m "feat: expose annual archive management callables"
```

---

### Task 4: Scheduler による予約実行・再試行・取消 rollback を実装する

**Files:**
- Create: `functions/src/privacy/annualArchiveScheduled.ts`
- Create: `functions/src/privacy/annualArchiveScheduled.test.ts`
- Modify: `functions/src/index.ts`

既にリポジトリには `firebase-functions/v2/scheduler` を使う scheduled function の実例があるため、新しい scheduler framework は追加しない。

**Interfaces:**

Produces:
- `runDueAnnualArchiveJobs(...)`
- `runAnnualArchiveJob(...)`
- `annualArchiveScheduled`

Scheduler:
- region: `asia-northeast1`
- timezone: `Asia/Tokyo`
- interval: 5分
- 1ページ: 100 runs

- [ ] **Step 1: concurrency / retry の失敗テストを書く。**

最低限:

1. future `SCHEDULED` は処理しない。
2. due `SCHEDULED` は lease を取得し `RUNNING`。
3. 有効 lease の job を別 worker は取らない。
4. expired lease の `RUNNING` は別 worker が再開できる。
5. `FAILED` job は再試行できる。
6. archive 済み run は次回 query から外れ、未処理分だけ進む。
7. 途中 exception → `FAILED`、処理済み run は維持。
8. 再試行 →残りだけ処理。
9. `CANCELLING` →その job の archive 済み run を rollback。
10. rollback の途中失敗 →次回続きから再開。
11. 全 rollback 完了後のみ `CANCELLED`。
12. 全 archive 完了後のみ `COMPLETED`。
13. completion transaction より cancel transaction が先なら `COMPLETED` にできない。
14. completion が先なら後続 cancel は拒否。
15. completion/failure/cancellation result が org audit log に残る。
16. scheduler の SYSTEM actor が生徒情報を audit payload に含めない。

- [ ] **Step 2: failure を確認する。**

```bash
npm test --workspace=functions -- src/privacy/annualArchiveScheduled.test.ts
```

- [ ] **Step 3: worker を実装する。**

対象 run は「同じ query を100件ずつ繰り返す」方式にする。処理済み run は `ARCHIVED` となるため対象 query から自然に消え、cursor を永続化しなくても crash/retry に耐えられる。

取消処理は `archiveJobId == jobId && status == 'ARCHIVED'` の run をページングし、`archivedFromStatus` へ戻す。

- [ ] **Step 4: tests + typecheck。**

```bash
npm test --workspace=functions -- src/privacy/annualArchiveScheduled.test.ts
npm run typecheck --workspace=functions
```

- [ ] **Step 5: commit。**

```bash
git add functions/src/privacy/annualArchiveScheduled.ts functions/src/privacy/annualArchiveScheduled.test.ts functions/src/index.ts
git commit -m "feat: run annual archive jobs on schedule"
```

---

### Task 5: owner 向け年度アーカイブ UI とクライアントを追加する

**Files:**
- Create: `src/lib/privacy/annualArchive.ts`
- Create: `src/lib/privacy/annualArchive.test.ts`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`
- Modify: `src/App.tsx`
- Modify: `docs/superpowers/scope-backlog.md`

現行 `SchoolOrgSettingsPage` は既に owner 判定を持ち、生徒データ検索・保持期間・完全削除・監査ログを同一画面に配置しているため、年度アーカイブもここへ置く。

**Interfaces:**

Client:
- `previewAnnualArchive`
- `scheduleAnnualArchive`
- `cancelAnnualArchive`
- `listAnnualArchiveJobs`

`SchoolOrgSettingsPageProps` には preview、schedule、cancel、job list とそれぞれの loading state を追加する。

- [ ] **Step 1: client と UI の失敗テストを書く。**

UI 条件:

1. owner のみ「年度アーカイブ」を表示。
2. admin/teacher には表示しない。
3. 年度入力後「対象を確認」で preview。
4. 対象期間・対象件数・`endedAt` 欠損除外件数を表示。
5. preview 前には「予約する」を押せない。
6. reason 必須。
7. schedule datetime 必須。
8. `SCHEDULED` →「取消」可能。
9. `RUNNING` →「取消要求」可能。
10. `FAILED` →「取消」可能、再試行中である旨を表示。
11. `CANCELLING` →操作不可、「取消処理中」。
12. `COMPLETED` / `CANCELLED` →取消不可。
13. job status を日本語表示。
14. schedule 完了後 list を再読込。
15. cancel 完了後 list を再読込。

- [ ] **Step 2: failure を確認する。**

```bash
npm test -- src/lib/privacy/annualArchive.test.ts src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx
```

- [ ] **Step 3: thin client + UI wiring を実装する。**

`src/App.tsx` の `SchoolOrgSettingsRoute` が API state を所有する。component 内から Firebase を直接呼ばない。

日時はブラウザの `datetime-local` から ISO instant に変換して callable へ送る。年度境界の計算はクライアントで正本化せず、preview response の `periodStart/periodEnd` を表示する。

- [ ] **Step 4: UI tests + 全体 typecheck。**

```bash
npm test -- src/lib/privacy/annualArchive.test.ts src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx
npm run typecheck
```

- [ ] **Step 5: backlog を完了扱いにする。**

全機能テストが PASS してからだけ、Phase 7 の

`- 年度単位のアーカイブ`

を実装済みに変更する。

- [ ] **Step 6: commit。**

```bash
git add src/lib/privacy/annualArchive.ts src/lib/privacy/annualArchive.test.ts src/components/teacher/organizations/SchoolOrgSettingsPage.tsx src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx src/App.tsx docs/superpowers/scope-backlog.md
git commit -m "feat: add annual archive management UI"
```

---

## Agent assignment

- **Task 1 — Claude Code:** lifecycle transaction/timestamp 変更。既存エンジンへの影響が大きいため厳密レビュー。
- **Task 2 — Claude Code:** archive/rollback の transaction・冪等性・部分失敗。
- **Task 3 — Codex:** Callable 認可順序・監査・idempotency。
- **Task 4 — Codex:** Scheduler lease・retry・cancel/completion race。
- **Task 5 — Antigravity:** client/UI・状態表示・backlog 更新。

Task 1 と Task 2 は独立なので並列実行可能です。Task 3 は Task 2 の型/データモデル確定後、Task 4 は Task 2+3 後、Task 5 は Task 3 の Callable interface 確定後に進めます。

## Final verification

全 Task 完了後、部分テストの報告だけで完了扱いにしません。

```bash
npm run typecheck
npm test
npm run verify
```

すべて PASS 後に branch と差分を確認します。

```bash
git status --short
git branch --show-current
git log -5 --oneline
```

`git branch --show-current` が正確に `codex/classroom` であることを確認してから push します。

```bash
git push origin codex/classroom
```

その後、remote `codex/classroom` に最終コミットが存在することを確認して完了です。
