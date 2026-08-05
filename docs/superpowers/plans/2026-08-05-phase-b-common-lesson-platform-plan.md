# Phase B: 共通授業基盤 Implementation Plan

> **正本は統合仕様書。** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md`（§5、§8〜§11、§16.2、§23、§25、§27.3、§31）と `docs/superpowers/specs/2026-08-05-integrated-spec-resolutions.md`（G・H）が優先する。本計画と両文書が矛盾する場合は両文書を優先し、本計画側の誤りとして扱う。
>
> **前提: Phase A は完了済み。** `orgId` 所有、Firestore メンバーシップと RTDB `orgAccess`、`LessonTemplate` / `LessonVersion` / `LessonRun`、追記専用 `LessonEvent`、`LessonCheckpoint` と `restoreGeneration`、`lessonRunPublic` / `lessonRunPrivate`、Functions ワークスペース、決定的 PRNG が存在する。Phase A 実装と本計画のパスやシグネチャに差がある場合は、正本の不変条件を維持したまま本計画を実装時に更新する。
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 教師・生徒・教室表示の3画面、参加・復帰・チーム、授業フェーズ、共通入力、保存・復旧・介入、結果・アンケート・分析、教材複製を、社会科と家庭科が共有できる安全な授業実行基盤として実装する。

**Architecture:** Firestore を授業・参加者・回答・結果・イベントの正本、RTDB を授業中の最小限の読み取りモデルと権限ミラーにする。生徒は Firestore の `lessonRuns` を直接読まず、独立したトップレベルの `lessonRunPublic` と自チームだけ読める `lessonRunTeamState` を購読する。すべての重要操作は Cloud Functions Callable で認可・冪等化し、`LessonEvent` とチェックポイントを通じて復旧可能にする。教室表示は教師画面のミラーではなく、サーバーが許可リスト方式で生成する `lessonRunDisplay` 専用モデルだけを読む。

**Tech Stack:** TypeScript, React 19, React Router 7, MUI 9, Firebase Auth / Firestore / Realtime Database, Cloud Functions for Firebase v2 Callable, Firebase Admin SDK, npm workspaces, Vitest, React Testing Library, `@firebase/rules-unit-testing`。

## Global Constraints

- 各タスク完了時に `npm run verify` を通す。対象テストだけの成功で完了にしない。
- 実装は TDD とし、失敗するテスト、最小実装、対象テスト、全体検証、コミットの順で進める。
- 生徒は `lessonRuns/{runId}`、`lessonRunPrivate/{runId}`、他チームの `lessonRunTeamState` を読めない。RTDB の祖先 `.read` は子孫で取り消せないため、可視性クラスは必ず独立したトップレベルパスに置く。
- RTDB の参加・チーム権限ミラーは Admin SDK だけが更新し、クライアント書き込みは常に拒否する。ミラー欠落または `REVOKED` は拒否側へ倒す。端末移行時は旧 UID を先に `REVOKED` にし、古い `sessionVersion` の操作を Callable でも拒否する。
- 重要操作（参加、復帰、フェーズ遷移、回答確定、介入、終了、複製）は `idempotencyKey` を必須にし、同じキーを二度適用しない。
- `LessonRun.templateSnapshot` と `templateVersionId` は授業開始後も変更しない。教材の編集は進行中・過去の授業へ反映しない。
- `HOME_ECONOMICS` の教材に `MARKET` フェーズがあれば開始前チェックをエラーにする（矛盾解消 G）。
- `REFLECTION` は戻さない授業状態であり、遷移時に市場を停止する。`RUNNING` のまま市場だけ停止している状態は許可する（矛盾解消 H）。
- 乱数が必要な処理は `@stock-league/deterministic-random` のみを使い、`Math.random()` を使わない。
- 画面追加時は §23.3〜§23.6 を完了条件に含める。重要通知だけ音を出し、色だけで状態を表さず、キーボード・読み上げ・文字拡大・アニメーション低減を検証する。
- 表示名は教師画面では本名、生徒画面では自分とチームメンバー、他チームと教室表示では標準でチーム名とする。本名の教室表示は教師の明示設定がある場合だけ許可する。
- UI 文言は日本語。授業で使わない機能は無効表示ではなく非表示にする。高度な設定は授業中の主要画面へ混在させない。
- 社会科市場の企業・価格・注文・約定・需給（Phase C）、家庭科シミュレーション（Phase D）、AI（Phase E）、学校組織・課金（Phase F）は実装しない。
- 実際の生徒データを使う試運転前に、法務・学校規程・プライバシーポリシーの確認を外部完了条件として満たす。これは自動テストでは代替できない。

---

## Phase C 冒頭の3点への確定回答

### 1. `lessonRunPublic` の読み取り許可

**含める。** `lessonRunPublic/{lessonRunId}` は、当該組織の有効な教師に加え、`lessonRunMembership/{lessonRunId}/{auth.uid}.access == 'ACTIVE'` の生徒参加者が読める。未認証、別授業、停止・失効済み、ミラー欠落は拒否する。生徒を含めなければ Phase B の待機・フェーズ・入力画面も Phase C の市場表示も成立しない。

### 2. チーム帰属を検証する RTDB ミラー

Phase B で次を作る。Firestore の参加者ドキュメントが正本であり、Callable のトランザクション成功後に Admin SDK がミラーを更新する。

```ts
interface LessonRunMembershipMirror {
  orgId: string
  participantId: ParticipantId
  teamId?: TeamId
  access: 'ACTIVE' | 'REVOKED'
  participantStatus: ParticipantStatus
  membershipVersion: number
  sessionVersion: number
  updatedAtMillis: number
}
```

```text
lessonRunMembership/{lessonRunId}/{uid}
```

`lessonRunTeamState/{lessonRunId}/{teamId}` の `.read` は、教師の `orgAccess` または `lessonRunMembership/.../teamId == $teamId && access == 'ACTIVE'` のどちらかだけを許可する。Phase C 計画 Task 13 の暫定 `teamMembership` は、この確定パスへ読み替える。

### 3. `teamId`・`participantId` の型定義パス

Phase B の Task 1 で `packages/lesson-runtime-types/src/index.ts` に `ParticipantId` と `TeamId` を定義し、クライアントと Functions の双方が `@stock-league/lesson-runtime-types` から import する。`src/` や `functions/` に別名のローカル型を作らない。

---

## File Structure

| File | Change |
| --- | --- |
| `packages/lesson-runtime-types/package.json`, `tsconfig.json`, `src/index.ts`, `.test.ts` | Create。参加者・チーム・フェーズ・入力・回答・通知の共有型 |
| `functions/src/lessonRuns/authorization.ts`, `.test.ts` | Create。教師ロール、参加者、チーム帰属の認可 |
| `functions/src/lessonRuns/membershipMirror.ts`, `.test.ts` | Create。Firestore 正本から RTDB ミラーを同期 |
| `database.rules.json`, `test/database.rules.test.ts` | Modify。`lessonRunMembership`、参加者向け public read、team state、display の分離ルール |
| `firestore.rules`, `test/firestore.rules.test.ts` | Modify。参加者・チーム・回答・結果のクライアント直接アクセスを拒否 |
| `functions/src/lessonRuns/joinCodes.ts`, `.test.ts` | Create。短い参加コードの衝突回避・失効 |
| `functions/src/lessonRuns/participants/repository.ts`, `.test.ts` | Create。参加者正本 |
| `functions/src/lessonRuns/joinLessonRun.ts`, `.test.ts`, `participants/onCall.ts` | Create。学校アカウント・簡単参加・チーム端末参加 |
| `src/lib/lessonRuns/joinLessonRun.ts`, `.test.ts` | Create。参加 Callable ラッパー |
| `functions/src/lessonRuns/recovery.ts`, `.test.ts` / `src/lib/lessonRuns/recovery.ts`, `.test.ts` | Create。復帰コードと端末移行 |
| `functions/src/lessonRuns/teams/repository.ts`, `.test.ts`, `assignTeam.ts`, `.test.ts` | Create。チーム・代表者・偏り検出 |
| `functions/src/lessonRuns/phases/stateMachine.ts`, `.test.ts`, `validation.ts`, `.test.ts` | Create。フェーズ進行と開始前チェック |
| `functions/src/lessonRuns/phases/transitionPhase.ts`, `.test.ts` / `src/lib/lessonRuns/transitionPhase.ts`, `.test.ts` | Create。冪等な状態・フェーズ遷移 |
| `packages/lesson-inputs/package.json`, `tsconfig.json`, `src/index.ts`, `.test.ts` | Create。共通入力定義と純粋バリデーション |
| `src/components/lessonInputs/*` | Create。共通入力部品と共通アクセシビリティ |
| `functions/src/lessonRuns/responses/saveResponse.ts`, `.test.ts`, `confirmResponse.ts`, `.test.ts`, `onCall.ts` | Create。自動保存・提案・承認・確定 |
| `src/lib/lessonRuns/responses.ts`, `.test.ts`, `src/hooks/useLessonResponseDraft.ts`, `.test.tsx` | Create。回答保存クライアント |
| `functions/src/lessonRuns/recoveryLifecycle.ts`, `.test.ts` | Create。中断・再開・打切り・通常終了 |
| `functions/src/lessonRuns/interventions.ts`, `.test.ts` / `src/lib/lessonRuns/interventions.ts`, `.test.ts` | Create。教師引継ぎと介入 |
| `functions/src/lessonRuns/projections/publicProjection.ts`, `.test.ts`, `displayProjection.ts`, `.test.ts` | Create。生徒・教室表示の許可リスト変換 |
| `src/lib/lessonRuns/liveRepository.ts`, `.test.ts` | Create。RTDB 購読 |
| `src/components/teacher/LessonControlRoom.tsx` と子コンポーネント | Create。教師授業画面 |
| `src/components/student/LessonJoinPage.tsx`, `LessonWaitingPage.tsx`, `LessonPlayPage.tsx` | Create。生徒参加・待機・実施画面 |
| `src/components/display/ClassroomDisplayPage.tsx` と表示部品 | Create。専用教室表示 |
| `functions/src/lessonRuns/results/buildResults.ts`, `.test.ts` | Create。結果と判断因果列 |
| `functions/src/lessonRuns/surveys/*`, `src/components/student/LessonReflectionPage.tsx` | Create。アンケートと振り返り |
| `functions/src/lessonRuns/analytics/buildAnalytics.ts`, `.test.ts`, `src/components/teacher/LessonAnalyticsPage.tsx` | Create。教師分析 |
| `functions/src/lessonTemplates/duplicateLessonTemplate.ts`, `.test.ts`, `onCall.ts` | Create。複製 |
| `src/App.tsx`, `src/App.test.tsx` | Modify。Phase B ルートと `lessonPlatformV2` フラグ |
| `test/lesson-platform.rules.test.ts`, `test/lesson-lifecycle.acceptance.test.ts` | Create。Rules と §27.3 の受け入れテスト |

---

## Task 1: 共有ランタイム型と認可契約

**Files:**
- Create: `packages/lesson-runtime-types/package.json`, `tsconfig.json`, `src/index.ts`, `src/index.test.ts`
- Create: `functions/src/lessonRuns/authorization.ts`, `.test.ts`
- Modify: root `package.json`, `functions/package.json`

**Interfaces:**
- Consumes: Phase A の `LessonRunStatus`, `LessonPhase`, `orgAccess`
- Produces: `ParticipantId`, `TeamId`, `ParticipantStatus`, `LessonRunMembershipMirror`, `LessonRunRole`, `canParticipantOperate`, `canControlLesson`

- [ ] **Step 1: 共有型の失敗するテストを書く**

```ts
import { describe, expect, it } from 'vitest'
import { activeParticipantStatuses, canParticipantOperate } from './index'

describe('participant access', () => {
  it('allows active and late participants but denies suspended participants', () => {
    expect(activeParticipantStatuses).toContain('ACTIVE')
    expect(canParticipantOperate('LATE_JOIN')).toBe(true)
    expect(canParticipantOperate('OBSERVER')).toBe(false)
    expect(canParticipantOperate('SUSPENDED')).toBe(false)
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm --workspace @stock-league/lesson-runtime-types test`
Expected: FAIL — workspace または `./index` が存在しない。

- [ ] **Step 3: 型とアクセス判定を実装する**

```ts
export type ParticipantId = string
export type TeamId = string
export type ParticipantStatus =
  | 'ACTIVE' | 'TEMPORARILY_DISCONNECTED' | 'ABSENT' | 'OBSERVER'
  | 'LATE_JOIN' | 'MIGRATING_DEVICE' | 'SUSPENDED'
export type LessonRunRole = 'PRIMARY' | 'ASSISTANT' | 'VIEWER'
export interface LessonRunMembershipMirror {
  orgId: string
  participantId: ParticipantId
  teamId?: TeamId
  access: 'ACTIVE' | 'REVOKED'
  participantStatus: ParticipantStatus
  membershipVersion: number
  sessionVersion: number
  updatedAtMillis: number
}
export const activeParticipantStatuses: ParticipantStatus[] = [
  'ACTIVE', 'TEMPORARILY_DISCONNECTED', 'LATE_JOIN', 'MIGRATING_DEVICE', 'OBSERVER',
]
export const canParticipantOperate = (status: ParticipantStatus): boolean =>
  status === 'ACTIVE' || status === 'LATE_JOIN'
```

- [ ] **Step 4: Functions 認可ヘルパーのテストと実装を追加する**

```ts
expect(canControlLesson('PRIMARY', 'TRANSITION_PHASE')).toBe(true)
expect(canControlLesson('ASSISTANT', 'EXTEND_TIME')).toBe(true)
expect(canControlLesson('ASSISTANT', 'END_LESSON')).toBe(false)
expect(canControlLesson('VIEWER', 'PUBLISH_NOTICE')).toBe(false)
```

`canControlLesson(role, action)` は §6.5 の主担当・補助担当・閲覧担当の表を全列挙した `Record<LessonControlAction, LessonRunRole[]>` から判定する。

- [ ] **Step 5: 対象テストと全体検証を実行する**

Run: `npm --workspace @stock-league/lesson-runtime-types test && cd functions && npx vitest run src/lessonRuns/authorization.test.ts && cd .. && npm run verify`
Expected: PASS。

- [ ] **Step 6: コミットする**

```bash
git add package.json functions/package.json packages/lesson-runtime-types functions/src/lessonRuns/authorization.ts functions/src/lessonRuns/authorization.test.ts
git commit -m "feat: 授業参加者とチームの共有型を追加"
```

---

## Task 2: 参加者正本・RTDB 権限ミラー・Rules

**Files:**
- Create: `functions/src/lessonRuns/participants/repository.ts`, `.test.ts`
- Create: `functions/src/lessonRuns/membershipMirror.ts`, `.test.ts`
- Modify: `database.rules.json`, `firestore.rules`, `test/database.rules.test.ts`, `test/firestore.rules.test.ts`

**Interfaces:**
- Consumes: Task 1 の共有型、Phase A の `orgAccess`
- Produces: `LessonParticipant`, `upsertParticipant`, `syncLessonRunMembership`, RTDB 読み取り契約

- [ ] **Step 1: Rules Emulator の失敗するテストを書く**

```ts
it('lets an active participant read public and only their team state', async () => {
  await seedMembership('run-1', 'student-a', { access: 'ACTIVE', teamId: 'team-a' })
  await assertSucceeds(get(ref(studentA, 'lessonRunPublic/run-1')))
  await assertSucceeds(get(ref(studentA, 'lessonRunTeamState/run-1/team-a')))
  await assertFails(get(ref(studentA, 'lessonRunTeamState/run-1/team-b')))
  await assertFails(get(ref(studentA, 'lessonRunPrivate/run-1')))
})

it('fails closed when the membership mirror is absent or revoked', async () => {
  await assertFails(get(ref(unknownStudent, 'lessonRunPublic/run-1')))
  await seedMembership('run-1', 'student-b', { access: 'REVOKED', teamId: 'team-b' })
  await assertFails(get(ref(studentB, 'lessonRunPublic/run-1')))
})
```

- [ ] **Step 2: Rules テストの失敗を確認する**

Run: `npm run test:rules -- --runInBand`
Expected: FAIL — `lessonRunMembership` と参加者向け条件がない。

- [ ] **Step 3: 正本とミラー同期を実装する**

```ts
export interface LessonParticipant {
  id: ParticipantId
  lessonRunId: string
  orgId: string
  authUid: string
  identityMode: 'SCHOOL_ACCOUNT' | 'QUICK_JOIN' | 'TEAM_DEVICE'
  displayName: string
  externalIdentifier?: string
  teamId?: TeamId
  status: ParticipantStatus
  sessionVersion: number
  joinedAt: Timestamp
  lastSeenAt: Timestamp
}
```

`syncLessonRunMembership` は参加者正本を受け、`lessonRunMembership/{runId}/{authUid}` を Admin SDK の `set()` で丸ごと置換する。停止時は削除せず `access: 'REVOKED'` と版を残し、監査可能にする。

- [ ] **Step 4: 独立トップレベルの Rules を実装する**

```json
"lessonRunMembership": { "$runId": { "$uid": { ".read": "$uid === auth.uid", ".write": false } } },
"lessonRunPublic": { "$runId": {
  ".read": "auth != null && ((root.child('lessonRunMembership').child($runId).child(auth.uid).child('access').val() === 'ACTIVE') || (data.child('orgId').exists() && root.child('orgAccess').child(data.child('orgId').val()).child(auth.uid).child('status').val() === 'active'))",
  ".write": false
} },
"lessonRunTeamState": { "$runId": { "$teamId": {
  ".read": "auth != null && ((root.child('lessonRunMembership').child($runId).child(auth.uid).child('access').val() === 'ACTIVE' && root.child('lessonRunMembership').child($runId).child(auth.uid).child('teamId').val() === $teamId) || (data.child('orgId').exists() && root.child('orgAccess').child(data.child('orgId').val()).child(auth.uid).child('status').val() === 'active'))",
  ".write": false
} } }
```

親ノードへ `.read` を置かない。`lessonRunPrivate` は Phase A の教師限定条件を維持する。

- [ ] **Step 5: Firestore Rules でクライアント直接書き込みを拒否する**

`lessonRuns/{runId}/participants`、`teams`、`responses`、`results` はクライアントの write を常に拒否し、組織メンバーの read のみ許可する。生徒用データは RTDB projection または Callable 経由に限定する。

- [ ] **Step 6: テストと全体検証を実行する**

Run: `cd functions && npx vitest run src/lessonRuns/participants/repository.test.ts src/lessonRuns/membershipMirror.test.ts && cd .. && npm run verify`
Expected: PASS。祖先許可を子で拒否する構造が存在しない。

- [ ] **Step 7: コミットする**

```bash
git add functions/src/lessonRuns/participants functions/src/lessonRuns/membershipMirror.ts functions/src/lessonRuns/membershipMirror.test.ts database.rules.json firestore.rules test/database.rules.test.ts test/firestore.rules.test.ts
git commit -m "feat: 授業参加者の権限ミラーを追加"
```

---

## Task 3: 参加コードと冪等な参加

**Files:**
- Create: `functions/src/lessonRuns/joinCodes.ts`, `.test.ts`
- Create: `functions/src/lessonRuns/joinLessonRun.ts`, `.test.ts`, `participants/onCall.ts`
- Create: `src/lib/lessonRuns/joinLessonRun.ts`, `.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: Task 2 の `upsertParticipant`, `syncLessonRunMembership`
- Produces: `issueJoinCode`, `joinLessonRun`, `joinLessonRunCallable`

- [ ] **Step 1: 参加の失敗するテストを書く**

```ts
it('deduplicates the same join request and warns on duplicate external identifiers', async () => {
  const first = await joinLessonRun(deps, input({ idempotencyKey: 'join-1' }))
  const retry = await joinLessonRun(deps, input({ idempotencyKey: 'join-1' }))
  expect(retry.participantId).toBe(first.participantId)
  expect(retry.deduplicated).toBe(true)
  expect(deps.appendEvent).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/lessonRuns/joinLessonRun.test.ts`
Expected: FAIL — module がない。

- [ ] **Step 3: 参加コードを実装する**

参加コードは紛らわしい `0/O/1/I` を除く大文字英数字6桁、`lessonJoinCodes/{code}` を Firestore トランザクションで確保する。`READY` または `WAITING` の授業だけ発行し、終了・失効時に無効化する。乱数は決定的 PRNG を使い、衝突時は attempt を seed に追加する。

- [ ] **Step 4: 参加 Callable を実装する**

```ts
interface JoinLessonRunInput {
  joinCode: string
  identityMode: 'SCHOOL_ACCOUNT' | 'QUICK_JOIN' | 'TEAM_DEVICE'
  displayName: string
  externalIdentifier?: string
  idempotencyKey: string
}
interface JoinLessonRunResult {
  lessonRunId: string
  participantId: ParticipantId
  teamId?: TeamId
  duplicateIdentifierWarning: boolean
  deduplicated: boolean
}
```

Callable は Auth 必須、`maxParticipants`、授業状態、同一 UID の同時セッションを検証し、参加者正本・`PARTICIPANT_JOINED` イベント・RTDB ミラーを順に作る。Firestore commit 前に RTDB を書かない。

- [ ] **Step 5: クライアントラッパーを実装し、テストする**

`httpsCallable<JoinLessonRunInput, JoinLessonRunResult>` を使い、Functions のエラーコードを日本語 UI 用の `JoinLessonErrorCode` へ変換する。

- [ ] **Step 6: 全体検証とコミット**

Run: `npm run verify`
Expected: PASS。

```bash
git add functions/src/lessonRuns/joinCodes.ts functions/src/lessonRuns/joinCodes.test.ts functions/src/lessonRuns/joinLessonRun.ts functions/src/lessonRuns/joinLessonRun.test.ts functions/src/lessonRuns/participants/onCall.ts functions/src/index.ts src/lib/lessonRuns/joinLessonRun.ts src/lib/lessonRuns/joinLessonRun.test.ts
git commit -m "feat: 参加コードと冪等な授業参加を追加"
```

---

## Task 4: チーム編成・代表者・別端末復帰

**Files:**
- Create: `functions/src/lessonRuns/teams/repository.ts`, `.test.ts`, `assignTeam.ts`, `.test.ts`
- Create: `functions/src/lessonRuns/recovery.ts`, `.test.ts`
- Create: `src/lib/lessonRuns/recovery.ts`, `.test.ts`
- Modify: `functions/src/lessonRuns/participants/onCall.ts`

**Interfaces:**
- Produces: `LessonTeam`, `assignParticipantToTeam`, `rotateRepresentative`, `issueRecoveryCode`, `recoverParticipant`

- [ ] **Step 1: チーム偏りと代表権限の失敗するテストを書く**

```ts
expect(assignBalancedTeam([{ id: 'a', size: 3 }, { id: 'b', size: 2 }])).toBe('b')
expect(canConfirmTeamResponse(team, 'participant-1')).toBe(true)
expect(canConfirmTeamResponse(team, 'participant-2')).toBe(false)
```

- [ ] **Step 2: 復帰の失敗するテストを書く**

期限内の一回限り復帰コードで `authUid` を新 UID へ付け替え、旧 UID のミラーを `REVOKED`、新 UID を `ACTIVE` にすること、再利用と同時操作を拒否することを検証する。

- [ ] **Step 3: チーム正本を実装する**

```ts
interface LessonTeam {
  id: TeamId
  lessonRunId: string
  orgId: string
  displayName: string
  memberParticipantIds: ParticipantId[]
  representativeParticipantId?: ParticipantId
  confirmationMode: 'REPRESENTATIVE' | 'ALL' | 'QUORUM'
  requiredApprovalCount?: number
  version: number
}
```

代表交代・自動交代は `TEAM_REPRESENTATIVE_CHANGED` イベントへ変更前後と理由を記録する。

- [ ] **Step 4: 復帰コードを実装する**

コードの平文は発行時だけ返し、Firestore には SHA-256 hash、期限、使用済み時刻を保存する。復帰トランザクション中は状態を `MIGRATING_DEVICE` にし、ミラー切替完了後に元状態へ戻す。

- [ ] **Step 5: テスト・全体検証・コミット**

Run: `cd functions && npx vitest run src/lessonRuns/teams src/lessonRuns/recovery.test.ts && cd .. && npm run verify`
Expected: PASS。

```bash
git add functions/src/lessonRuns/teams functions/src/lessonRuns/recovery.ts functions/src/lessonRuns/recovery.test.ts functions/src/lessonRuns/participants/onCall.ts src/lib/lessonRuns/recovery.ts src/lib/lessonRuns/recovery.test.ts
git commit -m "feat: チーム編成と端末復帰を追加"
```

---

## Task 5: 開始前チェックとフェーズ状態機械

**Files:**
- Create: `functions/src/lessonRuns/phases/validation.ts`, `.test.ts`, `stateMachine.ts`, `.test.ts`
- Create: `functions/src/lessonRuns/phases/transitionPhase.ts`, `.test.ts`, `onCall.ts`
- Create: `src/lib/lessonRuns/transitionPhase.ts`, `.test.ts`

**Interfaces:**
- Produces: `validateLessonForStart`, `canTransitionRun`, `transitionPhase`

- [ ] **Step 1: 開始前チェックの失敗するテストを書く**

```ts
expect(validateLessonForStart(homeLessonWithMarket)).toContainEqual(expect.objectContaining({ severity: 'ERROR', code: 'HOME_ECONOMICS_MARKET_FORBIDDEN' }))
expect(validateLessonForStart(lessonWithoutTerminalPhase)).toContainEqual(expect.objectContaining({ severity: 'ERROR', code: 'NO_TERMINAL_PHASE' }))
expect(validateLessonForStart(overlongLesson)).toContainEqual(expect.objectContaining({ severity: 'WARNING', code: 'DURATION_EXCEEDED' }))
```

- [ ] **Step 2: 状態遷移表の失敗するテストを書く**

`DRAFT→READY→WAITING→RUNNING→REFLECTION→COMPLETED`、`RUNNING↔PAUSED`、`RUNNING/PAUSED→INTERRUPTED`、`INTERRUPTED→WAITING`、任意の実施中状態から `ABORTED` を許可し、`REFLECTION→RUNNING` と `COMPLETED→RUNNING` を拒否する。

- [ ] **Step 3: バリデーションと純粋状態機械を実装する**

`progression` が `TIMED` なら正の `durationSeconds`、`SUBMISSION_BASED` なら 0〜1 の `requiredCompletionRatio`、全フェーズ ID 一意、結果・振り返りへ到達可能、生徒公開情報があることを検証する。

- [ ] **Step 4: 冪等な遷移 Callable を実装する**

```ts
interface TransitionPhaseInput {
  lessonRunId: string
  targetStatus?: LessonRunStatus
  targetPhaseId?: string
  reason: string
  idempotencyKey: string
}
```

遷移はトランザクションで `LessonRun` を更新し、`LESSON_STATUS_CHANGED` / `PHASE_CHANGED` を追記し、主要フェーズ境界ではチェックポイントを作る。`REFLECTION` 遷移前に subject adapter の `stopActiveOperations()` を完了させる。

- [ ] **Step 5: テスト・全体検証・コミット**

Run: `cd functions && npx vitest run src/lessonRuns/phases && cd .. && npm run verify`
Expected: PASS。

```bash
git add functions/src/lessonRuns/phases src/lib/lessonRuns/transitionPhase.ts src/lib/lessonRuns/transitionPhase.test.ts functions/src/index.ts
git commit -m "feat: 授業フェーズの状態機械を追加"
```

---

## Task 6: 共通入力スキーマとアクセシブルな入力部品

**Files:**
- Create: `packages/lesson-inputs/*`
- Create: `src/components/lessonInputs/LessonInputRenderer.tsx`, `.test.tsx` と種類別部品

**Interfaces:**
- Produces: `LessonInputConfig`, `LessonInputValue`, `validateLessonInput`, `LessonInputRenderer`

- [ ] **Step 1: discriminated union と検証の失敗するテストを書く**

```ts
expect(validateLessonInput({ type: 'SINGLE_CHOICE', options: ['a', 'b'] }, 'a')).toEqual([])
expect(validateLessonInput({ type: 'NUMBER', min: 0, max: 10 }, 11)).toEqual(['10以下で入力してください。'])
expect(validateLessonInput({ type: 'ALLOCATION', total: 100, items: ['a', 'b'] }, { a: 60, b: 30 })).toEqual(['合計を100にしてください。'])
```

- [ ] **Step 2: 入力型を実装する**

値 widget は `SINGLE_CHOICE`, `MULTIPLE_CHOICE`, `NUMBER`, `QUANTITY`, `ALLOCATION`, `RANKING`, `AGREE_DISAGREE`, `REASON_CHOICE`, `SHORT_TEXT` の union にする。仕様上の個人/チームは `responseScope: 'INDIVIDUAL' | 'TEAM'`、提案/承認/確定は `interactionMode: 'DIRECT' | 'PROPOSAL_APPROVAL' | 'CONFIRMATION'` として表現し、表示 widget との直積爆発を避けながら §10 の全項目を表現する。

- [ ] **Step 3: Renderer の RTL テストを書く**

全 widget が label と説明を関連付け、エラーを `role="alert"` で読み上げ、44px 以上の操作領域、キーボード操作、色以外の選択状態を持つことを代表ケースで検証する。

- [ ] **Step 4: Renderer を実装する**

```tsx
<LessonInputRenderer
  config={config}
  value={value}
  disabledReason={disabledReason}
  onChange={setValue}
/>
```

`disabledReason` がある場合はボタンを隠さず、操作不能理由を隣接テキストで示す。授業に無関係な widget は Renderer の分岐で描画しない。

- [ ] **Step 5: テスト・全体検証・コミット**

Run: `npm --workspace @stock-league/lesson-inputs test && npx vitest run src/components/lessonInputs && npm run verify`
Expected: PASS。

```bash
git add package.json packages/lesson-inputs src/components/lessonInputs
git commit -m "feat: 共通授業入力コンポーネントを追加"
```

---

## Task 7: 回答の自動保存・提案・承認・確定

**Files:**
- Create: `functions/src/lessonRuns/responses/saveResponse.ts`, `.test.ts`, `confirmResponse.ts`, `.test.ts`, `onCall.ts`
- Create: `src/lib/lessonRuns/responses.ts`, `.test.ts`
- Create: `src/hooks/useLessonResponseDraft.ts`, `.test.tsx`

**Interfaces:**
- Produces: `saveResponseDraft`, `confirmResponse`, `submitProposal`, `decideProposal`, `useLessonResponseDraft`

- [ ] **Step 1: 回答状態機械の失敗するテストを書く**

`DRAFT→PROPOSED→APPROVED/REJECTED→CONFIRMED` を検証し、確定後編集、別チーム操作、代表者でない確定、quorum 未達、古い `revision` の上書きを拒否する。

- [ ] **Step 2: 自動保存 hook の fake timer テストを書く**

変更後500msで一度だけ保存、通信失敗時にローカル draft を保持、再接続時に `revision` を比較、unmount 前 flush を検証する。

- [ ] **Step 3: サーバー処理を実装する**

```ts
interface LessonResponse {
  id: string
  participantId?: ParticipantId
  teamId?: TeamId
  phaseId: string
  inputId: string
  value: LessonInputValue
  status: 'DRAFT' | 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'CONFIRMED'
  revision: number
  rationaleInformationIds: string[]
  confirmedAt?: Timestamp
}
```

保存・確定は Callable のみ。各操作を冪等化し、`RESPONSE_SAVED`, `PROPOSAL_SUBMITTED`, `PROPOSAL_DECIDED`, `RESPONSE_CONFIRMED` を追記する。

- [ ] **Step 4: hook とクライアントラッパーを実装する**

提案時の参考価格等は Phase C adapter が optional context として追加できるが、Phase B は汎用 `contextSnapshot: Record<string, JsonValue>` の許可リストを subject adapter に委ねる。

- [ ] **Step 5: テスト・全体検証・コミット**

Run: `cd functions && npx vitest run src/lessonRuns/responses && cd .. && npx vitest run src/hooks/useLessonResponseDraft.test.tsx src/lib/lessonRuns/responses.test.ts && npm run verify`
Expected: PASS。

```bash
git add functions/src/lessonRuns/responses src/lib/lessonRuns/responses.ts src/lib/lessonRuns/responses.test.ts src/hooks/useLessonResponseDraft.ts src/hooks/useLessonResponseDraft.test.tsx
git commit -m "feat: 回答の自動保存とチーム確定を追加"
```

---

## Task 8: 中断・チェックポイント復旧・終了処理

**Files:**
- Create: `functions/src/lessonRuns/recoveryLifecycle.ts`, `.test.ts`, `lifecycle/onCall.ts`
- Create: `src/lib/lessonRuns/lifecycle.ts`, `.test.ts`

**Interfaces:**
- Produces: `interruptLesson`, `resumeLesson`, `completeLesson`, `abortLesson`

- [ ] **Step 1: 終了順序の失敗するテストを書く**

通常終了が `stopNewOperations → drainAcceptedOperations → buildFinalResults → writeCheckpoint → REFLECTION` の順、途中終了がチェックポイントと再開地点を保存、打切りが未実施フェーズを評価対象外にすることを mock の呼出順で検証する。

- [ ] **Step 2: 復旧世代の失敗するテストを書く**

チェックポイント復元で `restoreGeneration` が増え、古い世代の非同期処理を無視し、元イベントを削除しないことを検証する。

- [ ] **Step 3: ライフサイクル処理を実装する**

`interruptLesson` は理由、暫定結果、再開 phase/checkpoint を保存する。`resumeLesson` は `INTERRUPTED→WAITING` とし、教師が接続・チームを再確認してから `RUNNING` に進める。`abortLesson` は理由と評価対象フェーズを固定する。

- [ ] **Step 4: 安全停止 adapter を定義する**

```ts
interface SubjectLifecycleAdapter {
  stopNewOperations(runId: string): Promise<void>
  drainAcceptedOperations(runId: string): Promise<void>
  buildSubjectSnapshot(runId: string): Promise<Record<string, unknown>>
}
```

Phase B では no-op 共通 adapter を実装し、Phase C/D が教科別処理を登録する。

- [ ] **Step 5: テスト・全体検証・コミット**

Run: `cd functions && npx vitest run src/lessonRuns/recoveryLifecycle.test.ts && cd .. && npm run verify`
Expected: PASS。

```bash
git add functions/src/lessonRuns/recoveryLifecycle.ts functions/src/lessonRuns/recoveryLifecycle.test.ts functions/src/lessonRuns/lifecycle src/lib/lessonRuns/lifecycle.ts src/lib/lessonRuns/lifecycle.test.ts
git commit -m "feat: 授業の中断復旧と終了処理を追加"
```

---

## Task 9: 教師権限引継ぎと介入ログ

**Files:**
- Create: `functions/src/lessonRuns/interventions.ts`, `.test.ts`, `interventions/onCall.ts`
- Create: `src/lib/lessonRuns/interventions.ts`, `.test.ts`

**Interfaces:**
- Produces: `transferPrimaryTeacher`, `applyTeacherIntervention`

- [ ] **Step 1: 権限引継ぎの失敗するテストを書く**

主担当だけが有効な補助担当へ主担当を移譲でき、旧主担当は `ASSISTANT`、新主担当は `PRIMARY` となり、端末やホスト lease に依存しないことを検証する。

- [ ] **Step 2: 介入の表駆動テストを書く**

`EXTEND_TIME`, `PROXY_CONFIRM`, `CHANGE_REPRESENTATIVE`, `RECONNECT_PARTICIPANT`, `SWITCH_DISPLAY_SLIDE`, `CORRECT_STATE`, `RESTORE_PREVIOUS_PHASE`, `EMERGENCY_STOP`, `HIDE_INFORMATION` ごとに許可ロールと必須 payload を検証する。

- [ ] **Step 3: 介入処理を実装する**

すべて `reason`、`before`、`after`、`impactScope`、`actorId`、`idempotencyKey` を必須にし、`TEACHER_INTERVENTION_APPLIED` を追記する。代理確定は対象生徒に代理操作であることを結果履歴へ残す。

- [ ] **Step 4: テスト・全体検証・コミット**

Run: `cd functions && npx vitest run src/lessonRuns/interventions.test.ts && cd .. && npm run verify`
Expected: PASS。

```bash
git add functions/src/lessonRuns/interventions.ts functions/src/lessonRuns/interventions.test.ts functions/src/lessonRuns/interventions src/lib/lessonRuns/interventions.ts src/lib/lessonRuns/interventions.test.ts
git commit -m "feat: 教師引継ぎと介入監査を追加"
```

---

## Task 10: 公開・チーム・教室表示 projection と通知

**Files:**
- Create: `functions/src/lessonRuns/projections/publicProjection.ts`, `.test.ts`, `displayProjection.ts`, `.test.ts`
- Create: `functions/src/lessonRuns/notifications.ts`, `.test.ts`
- Create: `src/lib/lessonRuns/liveRepository.ts`, `.test.ts`
- Modify: `database.rules.json`, `test/database.rules.test.ts`

**Interfaces:**
- Produces: `toLessonRunPublicState`, `toLessonRunDisplayState`, `publishLessonProjection`, `classifyNotification`

- [ ] **Step 1: 禁止情報の失敗するテストを書く**

```ts
const display = toLessonRunDisplayState(privateRunFixture)
expect(JSON.stringify(display)).not.toContain('randomSeed')
expect(JSON.stringify(display)).not.toContain('future')
expect(JSON.stringify(display)).not.toContain('individualResponses')
expect(JSON.stringify(display)).not.toContain('unsubmittedParticipantIds')
```

- [ ] **Step 2: projection 型を実装する**

`LessonRunPublicState` は status、現在 phase、残り時間、公開課題、参加者自身が必要な通知だけを含む。`LessonRunDisplayState` は `START|LIVE|END|EXPLANATION` mode、タイトル、目標、公開集計、チーム名、教師案内だけを含み、`orgId` 以外の認可情報を含めない。

- [ ] **Step 3: `lessonRunDisplay` Rules を追加する**

```text
lessonRunDisplay/{lessonRunId}
```

教室表示 URL は十分長い一時 session token を使用し、Firestore の session 正本には hash だけを保存する。表示ページは session token を Callable で一度だけ Firebase custom token へ交換し、RTDB Rules は `auth.token.displayRunId == $runId` の当該 run だけを許可する。教師は `orgAccess` で読む。公開 URL の無認証 read は許可しない。

- [ ] **Step 4: 通知分類と履歴を実装する**

`IMPORTANT|NORMAL|REFERENCE` をイベント種別から決定し、音は `IMPORTANT` のみ既定 true。通知は履歴へ残し、株価更新等の高頻度イベントは Phase C が `REFERENCE` として集約可能にする。

- [ ] **Step 5: RTDB 購読を実装する**

`subscribePublicRun`, `subscribeOwnTeamState`, `subscribeDisplayRun` は unsubscribe を返し、auth/membership 変更時に古い listener を確実に解除する。

- [ ] **Step 6: テスト・全体検証・コミット**

Run: `cd functions && npx vitest run src/lessonRuns/projections src/lessonRuns/notifications.test.ts && cd .. && npm run verify`
Expected: PASS。

```bash
git add functions/src/lessonRuns/projections functions/src/lessonRuns/notifications.ts functions/src/lessonRuns/notifications.test.ts src/lib/lessonRuns/liveRepository.ts src/lib/lessonRuns/liveRepository.test.ts database.rules.json test/database.rules.test.ts
git commit -m "feat: 授業の安全な公開モデルを追加"
```

---

## Task 11: 教師の授業進行画面

**Files:**
- Create: `src/components/teacher/LessonControlRoom.tsx`
- Create: `src/components/teacher/LessonStatusHeader.tsx`, `.test.tsx`
- Create: `src/components/teacher/ParticipantMonitor.tsx`, `.test.tsx`
- Create: `src/components/teacher/InterventionPanel.tsx`, `.test.tsx`

**Interfaces:**
- Consumes: Tasks 5, 8, 9, 10
- Produces: 教師の共通授業画面

- [ ] **Step 1: 最上部5項目の RTL テストを書く**

「次にすること」「現在のフェーズ」「参加・接続・提出状況」「未対応の問題」「教室表示で現在見えている内容」が初期 viewport に表示されることを検証する。

- [ ] **Step 2: 参加者モニターの RTL テストを書く**

参加済み、未参加、重複、切断、チーム人数の偏りを文字と icon で表示し、色だけに依存しないこと、本名を教師だけに表示することを検証する。

- [ ] **Step 3: 小さな表示部品を実装する**

`LessonStatusHeader` は CTA を一つに絞り、不可理由を併記する。`ParticipantMonitor` は live projection ではなく教師向け Firestore/Functions query を使う。高度な設定は折りたたみの別 panel に置く。

- [ ] **Step 4: `LessonControlRoom` を配線する**

主担当・補助・閲覧担当で操作を表示分岐し、disabled にするだけでなく認可不能な危険操作は非表示にする。接続切断時は安全停止の案内と復旧選択肢を表示する。

- [ ] **Step 5: アクセシビリティと全体検証**

Run: `npx vitest run src/components/teacher && npm run verify`
Expected: PASS。キーボードだけでフェーズ進行・介入 drawer・教室表示切替を操作できる。

- [ ] **Step 6: コミットする**

```bash
git add src/components/teacher/LessonControlRoom.tsx src/components/teacher/LessonStatusHeader.tsx src/components/teacher/LessonStatusHeader.test.tsx src/components/teacher/ParticipantMonitor.tsx src/components/teacher/ParticipantMonitor.test.tsx src/components/teacher/InterventionPanel.tsx src/components/teacher/InterventionPanel.test.tsx
git commit -m "feat: 教師の授業進行画面を追加"
```

---

## Task 12: 生徒の参加・待機・授業画面

**Files:**
- Create: `src/components/student/LessonJoinPage.tsx`, `.test.tsx`
- Create: `src/components/student/LessonWaitingPage.tsx`, `.test.tsx`
- Create: `src/components/student/LessonPlayPage.tsx`, `.test.tsx`
- Create: `src/components/student/QuickPractice.tsx`, `.test.tsx`

**Interfaces:**
- Consumes: Tasks 3, 4, 6, 7, 10
- Produces: 生徒の共通授業フロー

- [ ] **Step 1: 参加画面の RTL テストを書く**

QR deep link / 参加コード、学校アカウント、簡単参加、チーム端末を選択でき、同じ識別番号の警告を教師にだけ送って生徒の本名等を他生徒へ表示しないことを検証する。

- [ ] **Step 2: 待機画面の RTL テストを書く**

チーム、表示名、授業タイトル、開始案内、30秒操作練習、復帰情報の保存確認を表示する。`WAITING` 以外では練習回答を本番回答へ保存しない。

- [ ] **Step 3: 授業画面の RTL テストを書く**

現在課題、公開情報、自分/チーム状態、残り時間、確定状況、短いヘルプだけを表示し、未使用機能や教師情報を表示しないことを検証する。

- [ ] **Step 4: 3画面を実装する**

`LessonPlayPage` は phase の `displayConfig` と `inputConfig` を `LessonInputRenderer` へ渡す薄い shell とする。困りごとボタンは匿名集計イベント `STUDENT_HELP_REQUESTED` を送る。

- [ ] **Step 5: レスポンシブ・アクセシビリティ検証**

320px、768px、1280px相当で主要操作が隠れないこと、文字200%、reduced motion、screen reader label、タッチ領域をテストする。

- [ ] **Step 6: 全体検証とコミット**

Run: `npx vitest run src/components/student && npm run verify`
Expected: PASS。

```bash
git add src/components/student/LessonJoinPage.tsx src/components/student/LessonJoinPage.test.tsx src/components/student/LessonWaitingPage.tsx src/components/student/LessonWaitingPage.test.tsx src/components/student/LessonPlayPage.tsx src/components/student/LessonPlayPage.test.tsx src/components/student/QuickPractice.tsx src/components/student/QuickPractice.test.tsx
git commit -m "feat: 生徒の参加待機と授業画面を追加"
```

---

## Task 13: 専用教室表示

**Files:**
- Create: `src/components/display/ClassroomDisplayPage.tsx`
- Create: `src/components/display/StartSlide.tsx`, `LiveSlide.tsx`, `EndSlide.tsx`, `ExplanationSlide.tsx`, 対応テスト
- Create: `src/lib/lessonRuns/displaySession.ts`, `.test.ts`

**Interfaces:**
- Consumes: Task 10 の display projection
- Produces: 専用 URL / window の教室表示

- [ ] **Step 1: モード別表示テストを書く**

開始はタイトル・目標・流れ・ルール・操作・QR/参加コード、授業中はフェーズ・残り時間・公開情報・匿名集計・案内、終了は結果・観点別ランキング・出来事・因果・振り返り問いを表示する。

- [ ] **Step 2: 禁止情報 regression テストを書く**

fixture に本名、未提出者、個人回答、未来情報、正解、内部係数、seed、教師設定、個人評価を混ぜても DOM に出ないことを全モードで検証する。

- [ ] **Step 3: 表示部品を実装する**

教室表示は教師 state を props で受けず、display token で `lessonRunDisplay` だけを購読する。説明スライドから戻る際は直前 mode を復元する。

- [ ] **Step 4: 表示 session を実装する**

教師が token を発行・失効でき、表示端末の custom token は `displayRunId` だけを claim に持つ。URL に教師 auth token や生データを含めない。

- [ ] **Step 5: テスト・全体検証・コミット**

Run: `npx vitest run src/components/display src/lib/lessonRuns/displaySession.test.ts && npm run verify`
Expected: PASS。

```bash
git add src/components/display src/lib/lessonRuns/displaySession.ts src/lib/lessonRuns/displaySession.test.ts
git commit -m "feat: 安全な専用教室表示を追加"
```

---

## Task 14: 結果・振り返り・アンケート

**Files:**
- Create: `functions/src/lessonRuns/results/buildResults.ts`, `.test.ts`
- Create: `functions/src/lessonRuns/surveys/schema.ts`, `.test.ts`, `submitSurvey.ts`, `.test.ts`, `onCall.ts`
- Create: `src/components/student/LessonResultsPage.tsx`, `.test.tsx`
- Create: `src/components/student/LessonReflectionPage.tsx`, `.test.tsx`

**Interfaces:**
- Produces: `LessonResult`, `DecisionExplanation`, `LessonSurveyResponse`

- [ ] **Step 1: 因果列生成の失敗するテストを書く**

```ts
expect(buildDecisionExplanation(events)).toEqual({
  whatHappened: expect.any(String),
  whyItHappened: expect.any(String),
  alternative: expect.any(String),
  nextAction: expect.any(String),
})
```

根拠がイベントにない場合は推測せず「記録された根拠がありません」とする。

- [ ] **Step 2: アンケート schema のテストを書く**

理解度、重視情報、判断変更、結果との差、改善点、分かりやすさ、自由記述1問の上限を検証し、2〜5分を超える必須設問数を拒否する。

- [ ] **Step 3: 結果と survey 保存を実装する**

`LessonSurveyResponse` は必ず `lessonRunId`, `resultId`, `participantId` を持ち、同一参加者は revision 付き upsert とする。欠席者の「結果資料とアンケートのみ」アクセスは membership を限定再発行して提供する。

- [ ] **Step 4: 生徒 UI を実装する**

振り返り方式 `CHOICE_ONLY|SHORT_TEXT|TEAM_DISCUSSION|INDIVIDUAL_THEN_TEAM|POST_LESSON_SURVEY` を Renderer へマッピングする。外部課題 URL と結果 URL を表示できるが、Classroom 自動投稿は実装しない。

- [ ] **Step 5: テスト・全体検証・コミット**

Run: `cd functions && npx vitest run src/lessonRuns/results src/lessonRuns/surveys && cd .. && npx vitest run src/components/student/LessonResultsPage.test.tsx src/components/student/LessonReflectionPage.test.tsx && npm run verify`
Expected: PASS。

```bash
git add functions/src/lessonRuns/results functions/src/lessonRuns/surveys src/components/student/LessonResultsPage.tsx src/components/student/LessonResultsPage.test.tsx src/components/student/LessonReflectionPage.tsx src/components/student/LessonReflectionPage.test.tsx
git commit -m "feat: 授業結果と振り返りアンケートを追加"
```

---

## Task 15: 教師向け分析と CSV

**Files:**
- Create: `functions/src/lessonRuns/analytics/buildAnalytics.ts`, `.test.ts`, `exportAnalyticsCsv.ts`, `.test.ts`
- Create: `src/components/teacher/LessonAnalyticsPage.tsx`, `.test.tsx`

**Interfaces:**
- Produces: `LessonAnalytics`, `buildLessonAnalytics`, `exportAnalyticsCsv`

- [ ] **Step 1: 3問に答える集計テストを書く**

利用情報割合、判断変更箇所、理解困難箇所、予想精度、理解度、操作つまずき人数を event/response/survey fixture から算出する。未入力を0点と混同せず `null` とする。

- [ ] **Step 2: 個票アクセス境界のテストを書く**

教師は自組織・担当授業の個票、補助教師は割当授業、上位組織管理者と別組織は既定で個票を読めないことを Functions 認可テストで確認する。

- [ ] **Step 3: CSV injection テストと実装を追加する**

`=`, `+`, `-`, `@`, tab, CR で始まるセルへ先頭 `'` を付け、UTF-8 BOM、固定列順、匿名/本名表示設定を検証する。

- [ ] **Step 4: 分析 UI を実装する**

最上部に「根拠」「変更」「理解困難」の3カードを置き、クラス→チーム→個人の drill-down とする。ランキングだけでなく母数・未回答数を併記する。

- [ ] **Step 5: テスト・全体検証・コミット**

Run: `cd functions && npx vitest run src/lessonRuns/analytics && cd .. && npx vitest run src/components/teacher/LessonAnalyticsPage.test.tsx && npm run verify`
Expected: PASS。

```bash
git add functions/src/lessonRuns/analytics src/components/teacher/LessonAnalyticsPage.tsx src/components/teacher/LessonAnalyticsPage.test.tsx
git commit -m "feat: 教師向け授業分析を追加"
```

---

## Task 16: 教材複製

**Files:**
- Create: `functions/src/lessonTemplates/duplicateLessonTemplate.ts`, `.test.ts`, `onCall.ts`
- Create: `src/lib/lessonTemplates/duplicateLessonTemplate.ts`, `.test.ts`

**Interfaces:**
- Produces: `duplicateLessonTemplate`

- [ ] **Step 1: 引継ぎ・リセット・確認項目の失敗するテストを書く**

目標、企業/人物、情報/イベント、フェーズ、評価、説明スライドをコピーし、参加者、チーム、判断/売買、状態、順位、介入をコピーしない。日時、公開時刻、制限時間、クラス、欠席対応、通知は明示された `confirmedOverrides` だけをコピーする。

- [ ] **Step 2: lineage と組織所有のテストを書く**

複製先組織が owner になり、`sourceTemplateId` / `sourceVersionId` を lineage に記録し、元 draft と新 draft が参照共有されない deep clone であることを検証する。

- [ ] **Step 3: 冪等 Callable を実装する**

```ts
interface DuplicateLessonTemplateInput {
  sourceTemplateId: string
  sourceVersionId: string
  targetOrgId: string
  confirmedOverrides: Partial<ScheduleSensitiveSettings>
  idempotencyKey: string
}
```

対象組織への教材作成権限をサーバーで検証する。

- [ ] **Step 4: テスト・全体検証・コミット**

Run: `cd functions && npx vitest run src/lessonTemplates/duplicateLessonTemplate.test.ts && cd .. && npm run verify`
Expected: PASS。

```bash
git add functions/src/lessonTemplates/duplicateLessonTemplate.ts functions/src/lessonTemplates/duplicateLessonTemplate.test.ts functions/src/lessonTemplates/onCall.ts src/lib/lessonTemplates/duplicateLessonTemplate.ts src/lib/lessonTemplates/duplicateLessonTemplate.test.ts
git commit -m "feat: 教材版の安全な複製を追加"
```

---

## Task 17: ルーティング・Feature Flag・統合フロー

**Files:**
- Modify: `src/App.tsx`, `src/App.test.tsx`
- Create: `src/lib/features/lessonPlatformV2.ts`, `.test.ts`
- Create: `test/lesson-platform.rules.test.ts`

**Interfaces:**
- Consumes: Tasks 11〜15 のページ
- Produces: Phase B の内部テスト用 route set

- [ ] **Step 1: route の失敗するテストを書く**

```text
/teacher/lessons/:runId/control
/teacher/lessons/:runId/analytics
/join
/lessons/:runId/waiting
/lessons/:runId/play
/lessons/:runId/results
/display/:displaySessionId
```

flag off では教師/生徒 CTA と全 route を非表示または `/about` へ戻し、内部テスト以外に未完成機能を露出しない。

- [ ] **Step 2: route と認証 guard を実装する**

教師 route は org membership、生徒 route は `lessonRunMembership`、display route は display custom token を検証する。URL の runId だけを認可根拠にしない。

- [ ] **Step 3: Rules 統合テストを書く**

教師、生徒、別チーム、別組織、停止済みメンバー、display session の6主体で全トップレベルパスを表形式テストする。

- [ ] **Step 4: 全体検証とコミット**

Run: `npm run verify`
Expected: lint、typecheck、unit、Rules Emulator、build、全 workspace verify が PASS。

```bash
git add src/App.tsx src/App.test.tsx src/lib/features/lessonPlatformV2.ts src/lib/features/lessonPlatformV2.test.ts test/lesson-platform.rules.test.ts
git commit -m "feat: 共通授業基盤のルートを統合"
```

---

## Task 18: §27.3 受け入れテストと Phase B 完了判定

**Files:**
- Create: `test/lesson-lifecycle.acceptance.test.ts`
- Modify: `docs/superpowers/plans/2026-08-05-phase-c-market-plan.md`（前提3点を Phase B の確定契約へ更新）

**Interfaces:**
- Consumes: Tasks 1〜17
- Produces: Phase B 完了の自動検証と Phase C の解消済み前提

- [ ] **Step 1: 教材版固定テストを書く**

授業作成後に元 template draft と新 published version を変更しても、`LessonRun.templateSnapshot` と進行中の phase/input が変わらないことを検証する。

- [ ] **Step 2: 引継ぎ・端末復帰テストを書く**

主担当端末の切断後に補助担当へ移譲して進行でき、生徒が復帰コードで別端末へ移り、旧端末操作が拒否されることを検証する。

- [ ] **Step 3: 欠席・途中参加・中断再開テストを書く**

欠席者を評価対象外にしてもチーム集計が壊れず、途中参加者が標準状態または既存チーム状態を受け取り、中断チェックポイントから同じ `restoreGeneration` 契約で再開できることを検証する。

- [ ] **Step 4: 教室表示とアンケートのテストを書く**

禁止情報が display projection と DOM に出ず、survey が `lessonRunId`, `resultId`, `participantId` で結果へ紐付くことを検証する。

- [ ] **Step 5: §31 授業 UX 固定チェックを実施する**

- [ ] 教師画面、生徒画面、教室表示、開始/終了スライド
- [ ] 待機、参加/復帰、欠席、チーム権限
- [ ] 通知、ヘルプ、アクセシビリティ、表示名
- [ ] 安全停止、終了処理、アンケート、分析

Run: `npx vitest run test/lesson-lifecycle.acceptance.test.ts && npm run verify`
Expected: PASS。

- [ ] **Step 6: Phase C 計画の前提を更新する**

冒頭の3チェックを次へ更新する。

```markdown
- [x] `lessonRunPublic` は `lessonRunMembership/.../access == 'ACTIVE'` の生徒参加者を許可する（Phase B Task 2）。
- [x] チーム帰属は `lessonRunMembership/{lessonRunId}/{uid}.teamId` で検証する（Phase B Task 2）。
- [x] `ParticipantId` / `TeamId` は `@stock-league/lesson-runtime-types` から import する（Phase B Task 1）。
```

Task 13 内の `teamMembership` 例も `lessonRunMembership` へ機械的に揃える。

- [ ] **Step 7: 外部完了条件を記録する**

実生徒での試運転前に法務・学校規程・保存データ一覧・保護者案内・削除手続きを確認済みであることをリリースチェックへ記録する。未完なら Phase B のコード完成と実運用許可を区別し、Feature Flag を有効化しない。

- [ ] **Step 8: 最終コミット**

```bash
git add test/lesson-lifecycle.acceptance.test.ts docs/superpowers/plans/2026-08-05-phase-c-market-plan.md
git commit -m "test: 共通授業基盤の受け入れ条件を固定"
```

---

## 実装順とレビューゲート

1. Task 1〜2: Phase C も依存する型・可視性契約。ここを先にレビューし、後続で名前を変えない。
2. Task 3〜5: 参加・チーム・フェーズ。待機から授業開始までを end-to-end で通す。
3. Task 6〜7: 入力と回答。教科別機能を載せられる拡張点を固定する。
4. Task 8〜10: 復旧・介入・projection。安全性レビューを必須にする。
5. Task 11〜13: 3画面。§23 の横断要件を画面ごとに検証する。
6. Task 14〜16: 結果・分析・複製。授業後の業務を完成させる。
7. Task 17〜18: 統合・受け入れ・Phase C 契約更新。

## 完了条件

- §27.3 の7項目が `test/lesson-lifecycle.acceptance.test.ts` で自動検証される。
- §31「授業UX」の全項目が Task 18 の対応先を持ち、未実装項目がない。
- Rules Emulator で教師、生徒、別チーム、別組織、停止済みメンバー、教室表示を検証済み。
- `lessonRunPublic` / `lessonRunPrivate` / `lessonRunTeamState` / `lessonRunDisplay` は独立トップレベルであり、親許可による漏洩がない。
- Phase C 冒頭の3前提が解消され、型と Rules の実在パスに読み替え済み。
- `npm run verify` が成功する。
- 法務・学校規程確認が終わるまで `lessonPlatformV2` は内部テスト限定のままにする。

## Self-Review

- **仕様網羅:** §5 は Tasks 11〜13、§8 は Tasks 5・8、§9 は Tasks 1〜4、§10 は Tasks 6〜7、§11 は Tasks 14〜15、§16.2 は Task 16、§23 は Tasks 9〜13・18、§27.3 は Task 18 に対応する。
- **矛盾解消 G/H:** 家庭科 `MARKET` 禁止は Task 5、`REFLECTION` 遷移時の市場停止は Tasks 5・8 に明示した。
- **Phase C の3前提:** 冒頭で確定回答し、Tasks 1・2 で実装、Task 18 で Phase C 計画を更新する。
- **型一貫性:** `ParticipantId` / `TeamId` / `ParticipantStatus` / `LessonRunMembershipMirror` は Task 1 の共有パッケージを唯一の定義元にする。
- **プレースホルダー:** 未確定の係数や「後で実装」は置いていない。教科固有処理は署名済み adapter と Phase C/D の明示スコープとして分離した。
