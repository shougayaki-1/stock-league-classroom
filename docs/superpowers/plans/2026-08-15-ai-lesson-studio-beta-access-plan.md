# AI Lesson Studio 限定ベータアクセス Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI Lesson Studio を運営者が明示許可した教師 UID だけに限定し、operator がメール完全一致で許可・取消でき、教師 UI は未許可時にロック表示し、Callable と Security Rules の両方で迂回を防ぐ。

**Architecture:** `aiBetaAccess/{uid}` を現在状態の唯一の正本とし、`status === 'APPROVED'` のみ利用可能とする。operator mutation は DI 可能なサーバーコアで transaction 化し、`aiBetaAccessEvents` と `aiBetaAccessIdempotency` を同時確定する。AI 生成は共通 server gate、資料の直接 Firestore/Storage write は Rules gate、教師 UI は本人 status Callable を用いた UX gate として三層で揃える。

**Tech Stack:** TypeScript 6, Firebase Cloud Functions v2, Firebase Admin Auth/Firestore, Firestore transactions, Firestore/Storage Security Rules, React 19, React Router 7, Material UI 9, Vitest 4, Testing Library, Firebase Rules Unit Testing.

## Global Constraints

- 正本は `docs/superpowers/specs/2026-08-15-ai-lesson-studio-beta-access-design.md` と `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md`。
- Phase 3 の対象は「利用者を運営者許可アカウントに限定するアクセス制御」の完成だけ。AI provider 選定、教師別 quota、申請 workflow、ユーザーディレクトリは追加しない。
- 許可単位は Firebase Auth UID。組織単位許可、学校単位許可、operator 自動許可を作らない。
- operator も通常の AI 利用時は自身の `aiBetaAccess/{uid}.status === 'APPROVED'` が必要。
- grant の対象指定はメールアドレス完全一致のみ。クライアントから UID を指定して grant する API を残さない。
- grant 対象は Admin Auth で解決し、`emailVerified === true` かつ `providerData` に `providerId === 'google.com'` があるユーザーだけ。
- `aiBetaAccess/{uid}` の存在だけでは許可しない。必ず `status === 'APPROVED'` を確認する。
- auth / teacher / operator 判定は dependent Firestore read より前。AI生成は auth → teacher → beta approval → scalar validation → organization → feature flags → quota/kill switch → dependent reads → AI processing の順序を維持する。
- grant/revoke の idempotency read、現在状態変更、append-only event、idempotency result は同一 Firestore transaction に含める。
- same idempotency key + same payload は replay、same key + different payload は `failed-precondition`。
- 状態が変わらない grant/revoke は `changed:false` とし、新しい event を作らない。
- `aiBetaAccessEvents` は revoke 後も削除しない。組織配下の audit log へ移さない。
- `getMyAiBetaAccessCallable` は本人へ `{ approved: boolean }` だけ返し、operator UID・監査情報を返さない。
- `aiBetaAccess` / `aiBetaAccessEvents` / `aiBetaAccessIdempotency` は教師・operator とも client SDK direct read/write を禁止する。
- Firestore `lessonTemplates/{templateId}/materials` と Cloud Storage `orgs/{orgId}/materials/**` の新規 write は beta approval を必須にする。既存 material read は revoke 後も現行 org/materials 条件で維持する。
- `aiEnabled`、`materialsUploadEnabled`、quota、kill switch、org membership、Storage size/type 制約は beta gate と AND 条件で残す。
- UI state は `LOADING | APPROVED | LOCKED | ERROR`。`LOADING` / `ERROR` を APPROVED 扱いしない。
- revoke は現在実行中の1回の Callable を中断しない。次回 AI 操作・新規資料 write から拒否する。既存生成教材・既存資料は削除しない。
- legacy `aiBetaAccess` を全教師へ拡張しない。既存の明示 grant record だけを backfill してから status-only gate を本番反映する。
- backlog は全 verification PASS 後だけ更新する。
- 実装完了時は `git push origin codex/classroom` まで行う。

---

### Task 1: AI beta access の server core と idempotent mutation を実装する

**Files:**
- Create: `functions/src/ai/betaAccess.ts`
- Create: `functions/src/ai/betaAccess.test.ts`
- Existing dependency: `functions/src/lib/idempotency.ts`

**Interfaces:**

```ts
export type AiBetaAccessStatus = 'APPROVED' | 'REVOKED'

export interface AiBetaAccessDoc {
  uid: string
  emailSnapshot: string
  status: AiBetaAccessStatus
  approvedAt: unknown
  approvedByUid: string
  revokedAt?: unknown
  revokedByUid?: string
}

export interface AiBetaAccessEventDoc {
  eventId: string
  action: 'GRANTED' | 'REVOKED'
  actorUid: string
  targetUid: string
  targetEmailSnapshot: string
  reason: string
  idempotencyKey: string
  occurredAt: unknown
}

export interface AiBetaAccessListItem {
  teacherUid: string
  email: string
  approvedByUid: string
  approvedAtMillis: number
}

export interface GrantAiBetaAccessInput {
  email: string
  reason: string
  idempotencyKey: string
  actorUid: string
}

export interface RevokeAiBetaAccessInput {
  teacherUid: string
  reason: string
  idempotencyKey: string
  actorUid: string
}

export interface AiBetaAccessMutationResult {
  changed: boolean
  teacherUid: string
  deduplicated: boolean
}

export class AiBetaTargetNotFoundError extends Error {}
export class AiBetaTargetIneligibleError extends Error {}
export class AiBetaIdempotencyMismatchError extends Error {}

export const getAiBetaAccessApproved: (
  db: FirebaseFirestore.Firestore,
  teacherUid: string,
) => Promise<boolean>

export const assertAiBetaApproved: (
  db: FirebaseFirestore.Firestore,
  teacherUid: string,
) => Promise<void>

export const grantAiBetaAccess: (
  deps: AiBetaAccessDeps,
  input: GrantAiBetaAccessInput,
) => Promise<AiBetaAccessMutationResult>

export const revokeAiBetaAccess: (
  deps: AiBetaAccessDeps,
  input: RevokeAiBetaAccessInput,
) => Promise<AiBetaAccessMutationResult>

export const listApprovedAiBetaAccess: (
  deps: Pick<AiBetaAccessDeps, 'firestore'>,
) => Promise<AiBetaAccessListItem[]>
```

Firestore paths:

```text
aiBetaAccess/{teacherUid}
aiBetaAccessEvents/{idempotencyDocumentId('aiBetaAccess', idempotencyKey)}
aiBetaAccessIdempotency/{idempotencyDocumentId('aiBetaAccess', idempotencyKey)}
```

`AiBetaAccessDeps` は production SDK を直接 mock せず、次の境界を DI する。

```ts
interface AiBetaAccessDeps {
  auth: {
    getUserByEmail(email: string): Promise<{
      uid: string
      email?: string
      emailVerified: boolean
      providerData: Array<{ providerId: string }>
    }>
  }
  firestore: {
    runTransaction<T>(fn: (tx: AiBetaAccessTransaction) => Promise<T>): Promise<T>
    listApproved(): Promise<Array<{ id: string; data: Record<string, unknown> }>>
  }
  now: () => unknown
  deleteField: () => unknown
}
```

- Consumes: existing `requestDigest()` / `idempotencyDocumentId()` helpers。
- Produces: status-only approval helper、email→UID解決、grant/revoke transaction、operator list contract、Task 3 が HttpsError へ map できる domain errors。

- [ ] **Step 1: status gate の failing tests を書く。** absent、legacy statusなし、`REVOKED` は false/reject、`APPROVED` だけ true/pass。

```ts
const makeApprovalDb = (exists: boolean, status?: string) => ({
  doc: () => ({
    get: async () => ({
      exists,
      get: (field: string) => field === 'status' ? status : undefined,
    }),
  }),
}) as unknown as FirebaseFirestore.Firestore

it('does not treat a legacy document as approved', async () => {
  await expect(getAiBetaAccessApproved(makeApprovalDb(true), 'teacher-a')).resolves.toBe(false)
  await expect(assertAiBetaApproved(makeApprovalDb(true), 'teacher-a')).rejects.toMatchObject({ code: 'permission-denied' })
})
```

- [ ] **Step 2: grant success failing test を書く。** `Teacher@Example.JP ` を `teacher@example.jp` に normalize し、Admin Auth で teacher UID を解決して `APPROVED`、GRANTED event、idempotency result を同一 transaction に書く。
- [ ] **Step 3: grant 対象不適格 failing tests を書く。** Auth user-not-found→`AiBetaTargetNotFoundError`、`emailVerified=false` / Google providerなし / resolved emailなし→`AiBetaTargetIneligibleError`、mutation write 0。
- [ ] **Step 4: already APPROVED failing test を書く。** 新しい key でも `changed:false`、event write 0、idempotency result は保存。
- [ ] **Step 5: REVOKED→APPROVED failing test を書く。** `approvedAt/approvedByUid/emailSnapshot` を更新し、`deleteField()` で `revokedAt/revokedByUid` を除去し、GRANTED event を1件作る。
- [ ] **Step 6: revoke failing tests を書く。** APPROVED→REVOKED は既存 `emailSnapshot` を event に使って event 1件、既に REVOKED / absent は `changed:false` で event 0。
- [ ] **Step 7: idempotency failing tests を書く。** same key/same digest は stored result + `deduplicated:true`、same key/different payload は `AiBetaIdempotencyMismatchError`、state/event writes 0。
- [ ] **Step 8: list failing test を書く。** production adapter が `status == 'APPROVED'` + `approvedAt desc` で query し、Timestamp `toMillis()` を `approvedAtMillis` に変換する。
- [ ] **Step 9: failing tests を確認する。**

```bash
npm test --workspace=functions -- src/ai/betaAccess.test.ts
```

Expected: FAIL because `betaAccess.ts` does not exist yet.

- [ ] **Step 10: `betaAccess.ts` を最小実装する。** reason は `trim()` 後1文字以上を core でも要求する。`requestDigest()` は action、normalized target、trimmed reason、actorUid を含める。

```ts
const digest = requestDigest({
  action: 'GRANT',
  email: normalizedEmail,
  teacherUid: target.uid,
  reason: input.reason.trim(),
  actorUid: input.actorUid,
})
```

- [ ] **Step 11: transaction の read/write 順序を固定する。** `aiBetaAccessIdempotency` read → `aiBetaAccess` read → access/event/idempotency writes。event document ID は idempotency document ID と同じ deterministic ID にし、event body の `eventId` にも同じ値を保存する。
- [ ] **Step 12: Admin SDK adapter を同ファイルへ追加する。** `getAuth().getUserByEmail()` と `getFirestore().runTransaction()` を production wiring に閉じ込める。
- [ ] **Step 13: tests/typecheck を PASS させる。**

```bash
npm test --workspace=functions -- src/ai/betaAccess.test.ts
npm run typecheck --workspace=functions
```

- [ ] **Step 14: commit。**

```bash
git add functions/src/ai/betaAccess.ts functions/src/ai/betaAccess.test.ts
git commit -m "feat: add idempotent AI beta access core"
```

---

### Task 2: legacy `aiBetaAccess` backfill を dry-run 可能な one-shot script にする

**Files:**
- Create: `functions/src/ai/migrateLegacyBetaAccess.ts`
- Create: `functions/src/ai/migrateLegacyBetaAccess.test.ts`

**Interfaces:**

```ts
export interface LegacyAiBetaAccessMigrationResult {
  scanned: number
  alreadyMigrated: number
  eligible: number
  migrated: number
  invalidAuthUser: number
}

export const migrateLegacyAiBetaAccess: (
  deps: LegacyAiBetaAccessMigrationDeps,
  options: { dryRun: boolean },
) => Promise<LegacyAiBetaAccessMigrationResult>
```

CLI contract:

```bash
node functions/lib/ai/migrateLegacyBetaAccess.js --dry-run
node functions/lib/ai/migrateLegacyBetaAccess.js --apply
```

- Consumes: Task 1 document/event shape、`idempotencyDocumentId()`、Admin Auth teacher eligibility rule。
- Produces: legacy explicit grants を `APPROVED` へ安全に backfill する release tool。

- [ ] **Step 1: dry-run failing test を書く。** statusなし legacy doc を `eligible` に数えるが write 0。
- [ ] **Step 2: valid legacy record failing test を書く。** `approvedAt` / `approvedByUid` を保持し、`uid` / `emailSnapshot` / `status:'APPROVED'` を補う。
- [ ] **Step 3: migration provenance failing test を書く。** synthetic idempotency key は `migration:legacy-ai-beta:<uid>`。GRANTED event の `actorUid` は既存 `approvedByUid`、`occurredAt` は既存 `approvedAt`、`targetEmailSnapshot` は Auth user email。event/idempotency ID は deterministic にする。
- [ ] **Step 4: rerun failing test を書く。** 既に APPROVED/REVOKED または migration idempotency 済みは duplicate event を作らない。
- [ ] **Step 5: invalid Auth user failing tests を書く。** user-not-found、email未確認、Google providerなし、emailなしは APPROVED にせず `invalidAuthUser` を増やす。
- [ ] **Step 6: failing tests を確認する。**

```bash
npm test --workspace=functions -- src/ai/migrateLegacyBetaAccess.test.ts
```

- [ ] **Step 7: migration core と CLI entrypoint を実装する。** `require.main === module` のときだけ `initializeApp()` し、test import では Firebase app を初期化しない。`--dry-run` / `--apply` 以外の引数は non-zero exit にする。
- [ ] **Step 8: tests/build を PASS させる。**

```bash
npm test --workspace=functions -- src/ai/migrateLegacyBetaAccess.test.ts
npm run build --workspace=functions
```

- [ ] **Step 9: 対象環境でまず dry-run を実行する。** secret を repository や shell history に書かず、既存 deployment credentials / ADC を使う。

```bash
node functions/lib/ai/migrateLegacyBetaAccess.js --dry-run
```

Expected: JSON summary with `scanned`, `eligible`, `alreadyMigrated`, `invalidAuthUser`; no writes.

- [ ] **Step 10: legacy record がある場合だけ `--apply` し、直後の dry-run で `eligible: 0` を確認する。** legacy 0件なら apply 不要。

```bash
node functions/lib/ai/migrateLegacyBetaAccess.js --apply
node functions/lib/ai/migrateLegacyBetaAccess.js --dry-run
```

- [ ] **Step 11: commit。**

```bash
git add functions/src/ai/migrateLegacyBetaAccess.ts functions/src/ai/migrateLegacyBetaAccess.test.ts
git commit -m "feat: add AI beta access legacy backfill"
```

**Release gate:** status-only production gate を deploy する前に dry-run/apply 判定を完了する。target environment credentials が実装担当AIに無い場合は migration code/test を完了し、deploy blocker として明示する。legacy fallback を最終コードへ残して回避しない。

---

### Task 3: AI beta Callables を新契約へ一本化し、全 server AI entrypoint を status gate に接続する

**Files:**
- Modify: `functions/src/ai/onCall.ts`
- Modify: `functions/src/ai/onCall.test.ts`
- Modify: `functions/src/ai/onCall.quotaIntegration.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**

```ts
export interface GetMyAiBetaAccessResult {
  approved: boolean
}

export interface GrantAiBetaAccessRequest {
  email: string
  reason: string
  idempotencyKey: string
}

export interface RevokeAiBetaAccessRequest {
  teacherUid: string
  reason: string
  idempotencyKey: string
}
```

Exports after this task:

```text
generateLessonDraftCallable
generateTeacherGuidanceCallable
getMyAiBetaAccessCallable
listAiBetaAccessCallable
grantAiBetaAccessCallable
revokeAiBetaAccessCallable
```

Domain → HTTPS mapping:

```text
AiBetaTargetNotFoundError      -> not-found
AiBetaTargetIneligibleError    -> failed-precondition
AiBetaIdempotencyMismatchError -> failed-precondition
```

- Consumes: Task 1 core/domain errors。
- Produces: server-authoritative teacher status API、operator list/grant/revoke APIs、strict `APPROVED` AI gate。

- [ ] **Step 1: existing generation tests を status model に変更する。** default approval mock は `status:'APPROVED'`、`REVOKED` と legacy statusなしは `permission-denied`、`orgGet` 0回。
- [ ] **Step 2: operator self-access regression test を追加する。** token に `operator:true` があっても beta 未許可なら `generateLessonDraftCallable` を拒否する。
- [ ] **Step 3: `getMyAiBetaAccessCallable` failing tests を追加する。** unauthenticated / non-teacher reject、APPROVED→`{approved:true}`、absent/REVOKED→`{approved:false}`。
- [ ] **Step 4: `listAiBetaAccessCallable` failing tests を追加する。** non-operator は list core を呼ぶ前に拒否、operator は approved list を返す。
- [ ] **Step 5: grant scalar validation failing tests を追加する。** empty email/reason/idempotencyKey は `invalid-argument` で target Auth lookup 0。
- [ ] **Step 6: grant domain error mapping tests を追加する。** Task 1 の3 domain errors が上記 HTTPS code へ変換される。
- [ ] **Step 7: UID direct grant regression test を追加する。** `{ targetUid:'teacher-b' }` だけの旧 payload は `invalid-argument`。
- [ ] **Step 8: revoke validation/idempotency tests を追加する。** non-operator は core 0、valid operator request は core result を返す。
- [ ] **Step 9: failing tests を確認する。**

```bash
npm test --workspace=functions -- src/ai/onCall.test.ts src/ai/onCall.quotaIntegration.test.ts
```

- [ ] **Step 10: `onCall.ts` の旧 inline existence gate と直接 set/delete grant/revoke を削除し、Task 1 helper/core に一本化する。** generate callables の auth→teacher→beta→validation→org 順序を維持する。
- [ ] **Step 11: `functions/src/index.ts` へ `getMyAiBetaAccessCallable` と `listAiBetaAccessCallable` を export する。** 既存 grant/revoke function 名は保持し payload contract を置換する。
- [ ] **Step 12: current server AI entrypoint inventory を固定する。** `functions/src/index.ts` と `functions/src/ai/` を再確認し、現時点の AI generation entrypoint が lesson draft / teacher guidance の2本であることを review note/test expectation に残す。新しい AI Callable が見つかった場合は同じ helper を通してから task を完了する。
- [ ] **Step 13: targeted tests/typecheck を PASS させる。**

```bash
npm test --workspace=functions -- src/ai/betaAccess.test.ts src/ai/onCall.test.ts src/ai/onCall.quotaIntegration.test.ts
npm run typecheck --workspace=functions
```

- [ ] **Step 14: commit。**

```bash
git add functions/src/ai/onCall.ts functions/src/ai/onCall.test.ts functions/src/ai/onCall.quotaIntegration.test.ts functions/src/index.ts
git commit -m "feat: enforce operator-managed AI beta access"
```

---

### Task 4: Firestore/Storage Rules で access metadata と AI material direct-write を保護する

**Files:**
- Modify: `firestore.rules`
- Modify: `storage.rules`
- Test: `test/firestore.rules.test.ts`
- Test: `test/storage.rules.test.ts`

**Interfaces:**

Firestore helper:

```text
function aiBetaApproved() {
  return teacher()
    && exists(/databases/$(database)/documents/aiBetaAccess/$(request.auth.uid))
    && get(/databases/$(database)/documents/aiBetaAccess/$(request.auth.uid)).data.status == 'APPROVED';
}
```

Storage helper:

```text
function aiBetaApproved() {
  return teacher()
    && firestore.exists(/databases/(default)/documents/aiBetaAccess/$(request.auth.uid))
    && firestore.get(/databases/(default)/documents/aiBetaAccess/$(request.auth.uid)).data.status == 'APPROVED';
}
```

- Consumes: Task 1 status model。
- Produces: direct SDK bypass protection without removing existing material read access。

- [ ] **Step 1: access metadata deny failing tests を変更する。** 現行「本人だけ aiBetaAccess read可」を、teacher本人・other teacher・operatorの全 direct get/list/write deny に置換する。events/idempotency も direct read/write deny。
- [ ] **Step 2: Firestore material create/delete failing tests を追加する。** active member + materials enabled でも beta absent/REVOKED は deny、APPROVED は既存条件内で allow。
- [ ] **Step 3: Firestore material read regression test を追加する。** REVOKED でも active member + materials enabled なら既存 material get/list は成功する。
- [ ] **Step 4: Storage upload failing tests を変更する。** APPROVED seed ありだけ both material paths が成功し、approval absent/REVOKED は deny。
- [ ] **Step 5: Storage existing constraints regression tests を追加する。** APPROVED でも wrong org、unauthenticated、size>10MiB、unsupported contentType は deny。
- [ ] **Step 6: failing rules tests を確認する。**

```bash
npm run test:rules
```

- [ ] **Step 7: `firestore.rules` を実装する。** `aiBetaAccess/{uid}` は `allow read, write: if false`。events/idempotency deny match を追加。materials は `get/list` の既存条件を維持し、`create/delete` に `aiBetaApproved()` を追加する。
- [ ] **Step 8: `storage.rules` を実装する。** 2つの material path の read は変更せず、write 条件へ `aiBetaApproved()` を追加する。
- [ ] **Step 9: rules tests/typecheck を PASS させる。**

```bash
npm run test:rules
npm run typecheck
```

- [ ] **Step 10: commit。**

```bash
git add firestore.rules storage.rules test/firestore.rules.test.ts test/storage.rules.test.ts
git commit -m "feat: gate AI materials with beta access rules"
```

---

### Task 5: client API と `useAiBetaAccess` hook を追加する

**Files:**
- Create: `src/lib/ai/betaAccess.ts`
- Create: `src/lib/ai/betaAccess.test.ts`
- Create: `src/hooks/useAiBetaAccess.ts`
- Create: `src/hooks/useAiBetaAccess.test.tsx`

**Interfaces:**

```ts
export type AiBetaUiState = 'LOADING' | 'APPROVED' | 'LOCKED' | 'ERROR'

export interface AiBetaAccessListItem {
  teacherUid: string
  email: string
  approvedByUid: string
  approvedAtMillis: number
}

export const getMyAiBetaAccess: (
  functions: Functions,
) => Promise<{ approved: boolean }>

export const listAiBetaAccess: (
  functions: Functions,
) => Promise<AiBetaAccessListItem[]>

export const grantAiBetaAccess: (
  functions: Functions,
  input: { email: string; reason: string; idempotencyKey: string },
) => Promise<{ changed: boolean; teacherUid: string }>

export const revokeAiBetaAccess: (
  functions: Functions,
  input: { teacherUid: string; reason: string; idempotencyKey: string },
) => Promise<{ changed: boolean; teacherUid: string }>

export const useAiBetaAccess: (functions: Functions) => AiBetaUiState
```

- Consumes: Task 3 Callable names/contracts。
- Produces: teacher route UX state と operator route client functions。

- [ ] **Step 1: wrapper failing tests を書く。** 4 functions が正しい Callable 名・payload を使い `result.data` を返す。
- [ ] **Step 2: hook failing tests を書く。** initial `LOADING`、approved true→`APPROVED`、false→`LOCKED`、rejection→`ERROR`。
- [ ] **Step 3: unmount/cancellation failing test を書く。** stale Promise completion で state を更新しない。
- [ ] **Step 4: failing tests を確認する。**

```bash
npm test -- src/lib/ai/betaAccess.test.ts src/hooks/useAiBetaAccess.test.tsx
```

- [ ] **Step 5: wrappers と hook を最小実装する。** hook は error 時に access を許可せず `ERROR` に倒す。
- [ ] **Step 6: tests/typecheck を PASS させる。**

```bash
npm test -- src/lib/ai/betaAccess.test.ts src/hooks/useAiBetaAccess.test.tsx
npm run typecheck
```

- [ ] **Step 7: commit。**

```bash
git add src/lib/ai/betaAccess.ts src/lib/ai/betaAccess.test.ts src/hooks/useAiBetaAccess.ts src/hooks/useAiBetaAccess.test.tsx
git commit -m "feat: add AI beta access client state"
```

---

### Task 6: 教師の AI 導線をロック表示し、直接 upload UX も fail-closed にする

**Files:**
- Modify: `src/App.tsx`
- Test: `src/App.test.tsx`
- Modify: `src/components/teacher/templates/TemplateOverviewPage.tsx`
- Test: `src/components/teacher/templates/TemplateOverviewPage.test.tsx`
- Modify: `src/components/teacher/templates/TemplateEditorPage.tsx`
- Test: `src/components/teacher/templates/TemplateEditorPage.test.tsx`
- Modify: `src/components/teacher/templates/materials/MaterialUploadPanel.tsx`
- Test: `src/components/teacher/templates/materials/MaterialUploadPanel.test.tsx`

**Interfaces:**

```ts
// added to TemplateOverviewPageProps and TemplateEditorPageProps
aiBetaState: AiBetaUiState

// added to MaterialUploadPanelProps
disabled: boolean
```

`aiEnabled` と `materialsUploadEnabled` は削除せず別 prop として残す。

- Consumes: Task 5 `useAiBetaAccess()`。
- Produces: 未許可・status取得失敗時にAI mutation不能、ただし限定ベータの存在と既存資料は見える teacher UX。

- [ ] **Step 1: TemplateOverview failing tests を変更する。** `aiEnabled=true` + `LOCKED` でも「AI提案（限定ベータ）」と限定公開案内が見えるが button disabled。`LOADING` / `ERROR` も disabled。`APPROVED` だけ click で `generateLessonDraft` が呼ばれる。
- [ ] **Step 2: organization flag regression test を残す。** `aiEnabled=false` では beta approved でも AI execution UI を有効化しない。
- [ ] **Step 3: Social Studies / Home Economics regression tests を追加する。** APPROVED 時、両 subject mapping が `generateLessonDraft` へ正しく渡る。
- [ ] **Step 4: TemplateEditor failing tests を追加する。** `aiEnabled && materialsUploadEnabled` なら LOCKED でも資料tabと既存資料は見えるが upload と「資料を使ってAI提案を更新」は disabled。APPROVED なら既存挙動。
- [ ] **Step 5: `ERROR` failing test を追加する。** status確認失敗で upload/regenerate を有効化せず、再読込案内を表示する。
- [ ] **Step 6: MaterialUploadPanel failing test を追加する。** `disabled` が label button と hidden file input の両方に反映され、disabled 時に `onUpload` が呼ばれない。
- [ ] **Step 7: App route failing tests を追加する。** `/teacher/templates/new` と `/teacher/templates/:id/edit` が `getMyAiBetaAccessCallable` を呼び、resolve 前は `LOADING` を渡して AI mutation を有効化しない。
- [ ] **Step 8: failing tests を確認する。**

```bash
npm test -- src/components/teacher/templates/TemplateOverviewPage.test.tsx src/components/teacher/templates/TemplateEditorPage.test.tsx src/components/teacher/templates/materials/MaterialUploadPanel.test.tsx src/App.test.tsx
```

- [ ] **Step 9: `TemplateNewRoute` / `TemplateEditRoute` で `useAiBetaAccess(services.functions)` を使い `aiBetaState` を child へ渡す。** org flag reads は現行どおり維持する。
- [ ] **Step 10: LOCKED copy を統一する。**

```text
AI提案（限定ベータ）
現在この機能は限定公開です。
利用には運営者による許可が必要です。
```

ERROR copy:

```text
AIベータの利用状態を確認できません。再読み込みしてもう一度お試しください。
```

- [ ] **Step 11: TemplateEditor の material read は LOCKED でも維持する。** `listMaterials()` effect を beta approval で止めず、upload/regenerate mutation だけ disabled にする。
- [ ] **Step 12: targeted tests/typecheck を PASS させる。**

```bash
npm test -- src/components/teacher/templates/TemplateOverviewPage.test.tsx src/components/teacher/templates/TemplateEditorPage.test.tsx src/components/teacher/templates/materials/MaterialUploadPanel.test.tsx src/App.test.tsx
npm run typecheck
```

- [ ] **Step 13: commit。**

```bash
git add src/App.tsx src/App.test.tsx src/components/teacher/templates/TemplateOverviewPage.tsx src/components/teacher/templates/TemplateOverviewPage.test.tsx src/components/teacher/templates/TemplateEditorPage.tsx src/components/teacher/templates/TemplateEditorPage.test.tsx src/components/teacher/templates/materials/MaterialUploadPanel.tsx src/components/teacher/templates/materials/MaterialUploadPanel.test.tsx
git commit -m "feat: lock AI teacher UI behind beta approval"
```

---

### Task 7: `/operator/ai-beta` 管理画面を追加し、最終 acceptance を閉じる

**Files:**
- Create: `src/components/operator/OperatorAiBetaAccessPage.tsx`
- Create: `src/components/operator/OperatorAiBetaAccessPage.test.tsx`
- Modify: `src/components/operator/OperatorReportsPage.tsx`
- Test: `src/components/operator/OperatorReportsPage.test.tsx`
- Modify: `src/components/operator/OperatorTemplateCertificationsPage.tsx`
- Test: `src/components/operator/OperatorTemplateCertificationsPage.test.tsx`
- Modify: `src/App.tsx`
- Test: `src/App.test.tsx`
- Modify after verification PASS: `docs/superpowers/scope-backlog.md`

**Interfaces:**

```ts
export interface OperatorAiBetaAccessPageProps {
  items: AiBetaAccessListItem[]
  loading: boolean
  mutating: boolean
  accessDenied: boolean
  error?: string
  onGrant: (email: string, reason: string) => Promise<void>
  onRevoke: (teacherUid: string, reason: string) => Promise<void>
  onNavigateToReports: () => void
  onNavigateToCertifications: () => void
}
```

App route container:

```text
load -> listAiBetaAccess(functions)
permission-denied -> accessDenied=true
other failure -> error
onGrant(email, reason) -> grantAiBetaAccess(..., idempotencyKey: crypto.randomUUID()) -> reload
onRevoke(uid, reason) -> revokeAiBetaAccess(..., idempotencyKey: crypto.randomUUID()) -> reload
```

- Consumes: Task 5 client wrapper。
- Produces: operator-only operational UI and Phase 3 acceptance closure。

- [ ] **Step 1: page failing tests を書く。** email/reason both required、grant callback receives trimmed values、approved list shows email/approved timestamp/approvedByUid。
- [ ] **Step 2: revoke dialog failing tests を書く。** button clickだけでは mutationせず、確認dialogで取消理由を入力して確定した時だけ `onRevoke(teacherUid, reason)`。
- [ ] **Step 3: accessDenied failing test を書く。** form/listを操作可能にせず「この画面は運営者のみ利用できます」を表示する。
- [ ] **Step 4: mutation failure failing test を書く。** error を表示し成功扱いしない。
- [ ] **Step 5: App route failing test を追加する。** `/operator/ai-beta` は既存 `TemplateRouteGuard` を通り、最初に `listAiBetaAccessCallable` を呼ぶ。server `permission-denied` は access denied UI。
- [ ] **Step 6: App mutation wiring failing test を追加する。** grant/revoke payload に non-empty UUID idempotency key、trimmed reason、grant email / revoke UID が入る。成功後 list Callable を再実行する。
- [ ] **Step 7: operator navigation failing tests を追加する。** reports/certifications から `/operator/ai-beta` へ移動でき、新画面から両既存画面へ戻れる。
- [ ] **Step 8: failing tests を確認する。**

```bash
npm test -- src/components/operator/OperatorAiBetaAccessPage.test.tsx src/components/operator/OperatorReportsPage.test.tsx src/components/operator/OperatorTemplateCertificationsPage.test.tsx src/App.test.tsx
```

- [ ] **Step 9: pure UI と App route container を実装する。** client route guard は UX のみ。operator authorization は `listAiBetaAccessCallable` / mutation Callables の server claim check を正本にする。
- [ ] **Step 10: targeted UI tests/typecheck を PASS させる。**

```bash
npm test -- src/components/operator/OperatorAiBetaAccessPage.test.tsx src/components/operator/OperatorReportsPage.test.tsx src/components/operator/OperatorTemplateCertificationsPage.test.tsx src/App.test.tsx
npm run typecheck
```

- [ ] **Step 11: cross-layer regression を実行する。**

```bash
npm test --workspace=functions -- src/ai/betaAccess.test.ts src/ai/migrateLegacyBetaAccess.test.ts src/ai/onCall.test.ts src/ai/onCall.quotaIntegration.test.ts
npm test -- src/lib/ai/betaAccess.test.ts src/hooks/useAiBetaAccess.test.tsx src/components/teacher/templates/TemplateOverviewPage.test.tsx src/components/teacher/templates/TemplateEditorPage.test.tsx src/components/teacher/templates/materials/MaterialUploadPanel.test.tsx src/components/operator/OperatorAiBetaAccessPage.test.tsx src/App.test.tsx
npm run test:rules
```

- [ ] **Step 12: bypass inventory を再確認する。** `functions/src/index.ts`、`functions/src/ai/`、`src/lib/ai/`、`firestore.rules`、`storage.rules` を再列挙し、次をすべて満たすまで完了扱いにしない。

```text
all server AI generation entrypoints require APPROVED
AI material direct Firestore write requires APPROVED
AI material direct Storage write requires APPROVED
access metadata direct client read/write is denied
LOCKED/ERROR client state never enables AI mutation
```

- [ ] **Step 13: full repository verification を実行する。**

```bash
npm run verify
```

Expected: lint, root/functions typecheck, unit tests, Firestore/RTDB/Storage rules tests, concurrency tests, all builds PASS.

- [ ] **Step 14: verification PASS 後だけ backlog を更新する。** `docs/superpowers/scope-backlog.md` の Phase 3「利用者を運営者許可アカウントに限定するアクセス制御」を実装済みに変更し、`aiBetaAccess` status gate、operator `/operator/ai-beta`、Rules material gate、監査/idempotency を根拠として短く記載する。他の Phase 3 スコープ外項目は変更しない。
- [ ] **Step 15: final application/docs commit。**

```bash
git add src/components/operator/OperatorAiBetaAccessPage.tsx src/components/operator/OperatorAiBetaAccessPage.test.tsx src/components/operator/OperatorReportsPage.tsx src/components/operator/OperatorReportsPage.test.tsx src/components/operator/OperatorTemplateCertificationsPage.tsx src/components/operator/OperatorTemplateCertificationsPage.test.tsx src/App.tsx src/App.test.tsx docs/superpowers/scope-backlog.md
git commit -m "feat: add operator AI beta access management"
```

- [ ] **Step 16: final branch verification と push。**

```bash
git status --short
git log -7 --oneline
npm run verify
git push origin codex/classroom
```

Expected: `git status --short` is empty before push; verification PASS; push updates `origin/codex/classroom`.

---

## Agent Assignment / Parallelism

推奨は `superpowers:subagent-driven-development`。依存順序は次の通り。

```text
Agent A: Task 1 server core
   ↓
Agent B: Task 2 legacy migration
   ↓ release gate confirmed
Agent C: Task 3 Callables
   ├──────────────┐
   ↓              ↓
Agent D: Task 4 Rules    Agent E: Task 5 client API/hook
                         ↓
                         Agent F: Task 6 teacher UI
                         ↓
                         Agent G: Task 7 operator UI + final verification
```

- Task 4 と Task 5 は Task 3 の API/status contract 確定後なら並列可。
- Task 6 は Task 5 に依存。
- Task 7 は Task 5 に依存し、final verification は Task 4/6 完了後。
- Task 6 と Task 7 は両方 `src/App.tsx` / `src/App.test.tsx` を変更するため並列実装しない。
- Task 2 の target environment backfill が未実行なら application implementation は進められるが、status-only production deploy は blocker 扱いにする。

## Final Acceptance Matrix

| Requirement | Task |
| --- | --- |
| UID単位・operatorも自動許可しない | 1, 3 |
| email完全一致 grant / UID revoke | 1, 3, 7 |
| status-only source of truth | 1, 2, 3 |
| grant/revoke audit + idempotency | 1 |
| legacy explicit grant migration | 2 |
| teacher status Callable | 1, 3, 5 |
| access metadata direct read/write deny | 4 |
| material Firestore/Storage direct write gate | 4 |
| revoke後も既存material read保持 | 4, 6 |
| teacher LOCKED/ERROR fail-closed UX | 5, 6 |
| Social Studies/Home Economics 共通制御 | 6 |
| `/operator/ai-beta` management UI | 7 |
| UID direct grant API removal | 3 |
| existing aiEnabled/materials/quota/kill switch保持 | 3, 4, 6 |
| bypass inventory + full verify | 7 |
| backlog closure only after PASS | 7 |
