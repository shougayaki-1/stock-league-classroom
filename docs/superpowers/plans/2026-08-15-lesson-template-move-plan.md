# 教材の移動（組織間所有権移転） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Goal

`LessonTemplate` を複製せず、同一 `templateId`・同一 version ID を維持したまま、所有組織を source organization から target organization へ完全に移転できるようにする。

移転は以下の性質を持つ。

- 所有権の正本は `LessonTemplate.orgId`
- caller は source / target 両方の active `owner`
- `createdByUid` は作成者 provenance として保持
- 過去の `LessonRun` は移動しない
- reviews / reports / lineage は保持
- COMMUNITY 公開は解除
- 既存共有リンクは失効
- 移動先では組織内承認をやり直す
- raw material file も target organization 配下へ移す
- Cloud Storage を跨ぐため、失敗時は rollback ではなく retry-to-completion
- 完了するまでテンプレートを移動中としてロック
- operation は idempotent / resumable / auditable

統合仕様では組織所有を `orgId` で表現するため、旧 `ownerUid` を移転先 owner へ付け替える設計にはしない。`createdByUid` も変更しない。

## Architecture

通常の教材複製処理は使用しない。既存 `duplicateLessonTemplate` は immutable version から新しい DRAFT template ID を生成する処理であり、所有権移転とは意味が異なる。

移動専用の server-side operation を追加する。

```text
lessonTemplateMoveOperations/{operationId}
```

operation は次の状態を持つ。

```text
PENDING
  ↓
RUNNING
  ↓
COMPLETED

RUNNING
  ↓
FAILED
  ↓ retry
RUNNING
```

`FAILED` は終端ではない。scheduler または明示的な再実行によって同じ phase から再開する。

内部 phase は次を基本とする。

```text
STAGING_MATERIALS
MIGRATING_VERSIONS
COMMITTING_OWNERSHIP
FINALIZING_MATERIALS
FINALIZING_FIRESTORE
```

テンプレートには実行中だけ、

```ts
moveOperationId?: string
```

を保持する。

これは移動の排他ロックであり、移動中は publish・share・community 公開・承認・material mutation など所有権依存操作を拒否する。

Cloud Storage は Firestore transaction に参加できないため、raw file は次の順序で扱う。

```text
source storage
  ↓ copy
server-only staging
  ↓ ownership commit
target storage
  ↓ Firestore storagePath update
source delete
  ↓
staging delete
```

source object は target object の存在を確認するまで削除しない。

## Tech Stack

- TypeScript
- Firebase Functions v2 Callable
- Firebase Functions v2 Scheduler
- Cloud Firestore transactions
- Firebase Admin SDK
- Cloud Storage Admin SDK
- Firebase Storage Rules
- React 19
- Vite
- Vitest
- Testing Library
- Material UI

## Global Constraints

1. 正本は `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md`。
2. `templateId` は変更しない。
3. `LessonVersion.id` は変更しない。
4. `LessonTemplate.orgId` とすべての既存 `LessonVersion.orgId` を target org に変更する。
5. `createdByUid`、`createdAt`、`sourceTemplateId`、`sourceVersionId` は変更しない。
6. legacy `ownerUid` を新しい所有権モデルとして使用しない。
7. `templateReviews`、`templateReports` は移動・削除・再作成しない。
8. 既存 `LessonRun` は source organization の履歴として一切変更しない。
9. COMMUNITY 教材は移動時に `PRIVATE` へ戻す。
10. `publishedToCommunityAt` はクリアする。
11. 移動先では `approvalStatus = 'PENDING'` とし、`reviewedByUid` / `reviewedAt` をクリアする。既存コード上、組織別承認ポリシーの明確な永続フィールドがないため、このタスクでは安全側で再承認を必須とする。
12. 移動前の share token はすべて無効として扱う。
13. share token を全件列挙して revoke することだけに依存せず、resolve 時にも現在の `template.orgId` と share の `sourceOrgId` が一致することを検証する。
14. caller は source / target 両組織の active `owner` でなければならない。
15. `admin` / `teacher` は不可。
16. 異なる人物同士の owner 間 transfer-request / accept workflow は今回実装しない。
17. Callable の認可順序は必ず次の通り。

```text
request.auth
→ teacher claim
→ scalar input validation
→ source org membership read
→ source owner check
→ target org membership read
→ target owner check
→ template / version / material / share / operation reads
```

18. source / target membership の確認前に `lessonTemplates/{templateId}` を読まない。存在有無を情報漏洩させない。
19. `sourceOrgId !== targetOrgId` を要求する。
20. `reason.trim().length` は 1–500。
21. impact preview を実行していない状態から UI で直接 move を開始させない。
22. confirmation text は target organization ID と完全一致させる。
23. fresh reauthentication は要求しない。
24. idempotency key を必須とする。
25. 同一 idempotency key + 同一 payload は同じ operation を返す。
26. 同一 idempotency key + 異なる payload は `failed-precondition`。
27. ownership commit 後は rollback しない。失敗時は target ownership の完成まで retry する。
28. `COMPLETED` は version・material Firestore metadata・raw Storage object の移転が全部完了してからのみ設定する。
29. transaction と Storage 処理の再試行は副作用を重複させない。
30. target object 作成前に source object を削除しない。
31. legacy material document に信頼できる `storagePath` がない場合はパスを推測しない。
32. legacy untracked material が1件でもあれば preview の `canMove=false` とし、移転を拒否する。
33. 今後の material upload は raw Storage path を Firestore に永続化する。
34. raw path に `templateId` を含め、template 単位で Storage objects を列挙できるようにする。
35. staging path は client から読み書き不可。
36. source / target の組織 audit log に操作履歴を残す。
37. audit log に教材本文・material filename・raw storage path・レビュー内容を保存しない。
38. `reason` 以外の不要な個人情報を audit に書かない。
39. audit と重要な Firestore state transition は既存の transaction-safe audit helper を使い、同じ transaction に含める。
40. client から `orgId` を直接書き換える Rules を追加しない。所有権変更は Admin SDK のみ。
41. `moveOperationId` があるテンプレートに対する通常 mutation を server / Rules 双方で可能な範囲で拒否する。
42. 汎用 workflow engine は作らない。
43. template library 全体を `createdByUid` → `orgId` に作り替える作業は今回に含めない。
44. ただし `TemplateEditorRoute` が `personalOrgId(user.uid)` を固定で渡している既存前提は、この機能を成立させるため修正する。
45. backlog は全 integration verification 完了後にのみ「実装済み」へ変更する。

# Task 1: Material Storage を移転可能な形式にする

### Files

Create:
- なし

Modify:
- `src/lib/ai/materialsRepository.ts`
- `storage.rules`

Test:
- `src/lib/ai/materialsRepository.test.ts`
- 既存 Storage Rules emulator test suite

### Interfaces

Consumes:

```ts
uploadMaterial({
  db,
  storage,
  orgId,
  templateId,
  file,
})
```

Produces:

新規 raw object path:

```text
orgs/{orgId}/materials/{templateId}/{storageId}/{fileName}
```

material document に追加:

```ts
storagePath: string
```

既存 document との互換性のため、読み取り型では当面、

```ts
storagePath?: string
```

として扱う。

### TDD

各チェックボックスは 2–5 分程度の単位で実施する。

- [ ] `materialsRepository.test.ts` に「raw path が orgId と templateId を含む」失敗テストを追加する。
- [ ] material Firestore document に実際の `storagePath` が保存されることを検証する失敗テストを追加する。
- [ ] upload failure 時に存在しない path を document に保存しない既存保証を維持するテストを確認・追加する。
- [ ] legacy document の `storagePath` 不在を許容する読み取りテストを追加する。

失敗確認:

```bash
npm test -- src/lib/ai/materialsRepository.test.ts
```

- [ ] テストが期待した理由で失敗することを確認する。
- [ ] `materialsRepository.ts` の raw path を template-scoped path に変更する。
- [ ] upload 成功後に正確な `storagePath` を material document へ保存する。
- [ ] Storage Rules に新 path を許可する。
- [ ] legacy `/orgs/{orgId}/materials/{storageId}/{fileName}` rule は既存ファイル互換のため削除しない。
- [ ] server-only staging namespace は client deny のままとする。

合格確認:

```bash
npm test -- src/lib/ai/materialsRepository.test.ts
npm run typecheck
```

- [ ] Storage Rules emulator suite も通す。
- [ ] unrelated AI material behavior が変わっていないことを確認する。

Commit:

```bash
git add src/lib/ai/materialsRepository.ts src/lib/ai/materialsRepository.test.ts storage.rules
git commit -m "fix: make lesson material storage transferable"
```

# Task 2: Share / Community / Publish を組織所有モデルに合わせて強化する

### Files

Modify:
- `functions/src/lessonTemplates/templateShares.ts`
- `functions/src/lessonTemplates/onCall.ts`
- `src/lib/lessonTemplates/communityTemplates.ts`

Test:
- `functions/src/lessonTemplates/templateShares.test.ts`
- `functions/src/lessonTemplates/templateShares.adminSdk.test.ts`
- `functions/src/lessonTemplates/onCall.test.ts`
- `src/lib/lessonTemplates/communityTemplates.test.ts`

### Interfaces

既存 share resolution に current template ownership check を追加する。

論理条件:

```text
share.revokedAt == null
AND not expired
AND currentTemplate.orgId == share.sourceOrgId
AND currentTemplate.moveOperationId == null
```

community/share mutation は client が `orgId` を送る場合でも、その値を認可済み organization context として利用し、stored template と一致することを server で検証する。

移動中は少なくとも以下を拒否する。

```text
publishLessonVersion
duplicateLessonTemplate
createTemplateShare
revokeTemplateShare
publishTemplateToCommunity
unpublishTemplateFromCommunity
reviewTemplateApproval
```

### TDD

- [ ] old share token が template transfer 後に resolve できない失敗テストを追加する。
- [ ] `moveOperationId` がある template share が resolve できないテストを追加する。
- [ ] 移動中の publish が拒否されるテストを追加する。
- [ ] 移動中の duplicate が拒否されるテストを追加する。
- [ ] 移動中の community publish/unpublish が拒否されるテストを追加する。
- [ ] source の旧 creator が target org membership を持たなければ community/share mutation できないテストを追加する。
- [ ] target org の正当な manager/owner に必要な管理操作が許可されることをテストする。
- [ ] template read より前に必要な organization authorization が行われるケースでは、その順序を spy で固定する。

失敗確認:

```bash
npm test --workspace=functions -- src/lessonTemplates/templateShares.test.ts src/lessonTemplates/templateShares.adminSdk.test.ts src/lessonTemplates/onCall.test.ts
npm test -- src/lib/lessonTemplates/communityTemplates.test.ts
```

- [ ] 期待した permission / failed-precondition failure を確認する。
- [ ] `resolveTemplateShare` の current ownership validation を実装する。
- [ ] share/community mutation の organization authorization を実装する。
- [ ] `moveOperationId` guard を既存 mutation entrypoint に追加する。
- [ ] `createdByUid` を所有権判定そのものには使用しないよう既存 creator-only 部分を必要最小限修正する。
- [ ] provenance 用 `createdByUid` は変更しない。

合格確認:

```bash
npm test --workspace=functions -- src/lessonTemplates/templateShares.test.ts src/lessonTemplates/templateShares.adminSdk.test.ts src/lessonTemplates/onCall.test.ts
npm test -- src/lib/lessonTemplates/communityTemplates.test.ts
npm run typecheck
```

Commit:

```bash
git add functions/src/lessonTemplates/templateShares.ts functions/src/lessonTemplates/templateShares.test.ts functions/src/lessonTemplates/templateShares.adminSdk.test.ts functions/src/lessonTemplates/onCall.ts functions/src/lessonTemplates/onCall.test.ts src/lib/lessonTemplates/communityTemplates.ts src/lib/lessonTemplates/communityTemplates.test.ts
git commit -m "fix: enforce organization ownership for template sharing"
```

# Task 3: Resumable LessonTemplate Move Core を実装する

### Files

Create:
- `functions/src/lessonTemplates/moveLessonTemplate.ts`
- `functions/src/lessonTemplates/moveLessonTemplate.test.ts`

Modify:
- `firestore.rules`

Test:
- `functions/src/lessonTemplates/moveLessonTemplate.test.ts`
- 既存 Firestore Rules emulator suite

### Interfaces

Create:

```ts
type LessonTemplateMoveStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'FAILED'
  | 'COMPLETED'
```

```ts
type LessonTemplateMovePhase =
  | 'STAGING_MATERIALS'
  | 'MIGRATING_VERSIONS'
  | 'COMMITTING_OWNERSHIP'
  | 'FINALIZING_MATERIALS'
  | 'FINALIZING_FIRESTORE'
```

```ts
interface LessonTemplateMoveOperation {
  id: string
  templateId: string
  sourceOrgId: string
  targetOrgId: string
  requestedByUid: string
  reason: string
  requestDigest: string
  status: LessonTemplateMoveStatus
  phase: LessonTemplateMovePhase
  versionCount: number
  materialCount: number
  legacyMaterialCount: number
  createdAt: unknown
  updatedAt: unknown
  completedAt?: unknown
  lastError?: string
  leaseOwner?: string
  leaseUntil?: unknown
}
```

Preview result:

```ts
interface LessonTemplateMovePreview {
  templateId: string
  sourceOrgId: string
  targetOrgId: string
  versionCount: number
  materialCount: number
  legacyMaterialCount: number
  canMove: boolean
  willUnpublishCommunity: boolean
  willResetApproval: true
  historicalLessonRunsRemain: true
}
```

Core functions:

```ts
previewLessonTemplateMove(...)
createLessonTemplateMoveOperation(...)
runLessonTemplateMoveOperation(...)
```

必要に応じて phase ごとの private helper へ分けるが、汎用 workflow abstraction は作らない。

### Operation creation

- operation path は top-level `lessonTemplateMoveOperations/{operationId}`。
- operation ID は idempotency helper を用いて deterministic に生成する。
- `requestDigest` に最低限以下を含める。

```text
templateId
sourceOrgId
targetOrgId
requestedByUid
reason
```

- operation 作成 transaction で template を再確認する。
- `template.orgId === sourceOrgId`
- `moveOperationId` が未設定であること。
- preview blocker がないこと。
- `template.moveOperationId = operationId`
- operation = `PENDING`
- source / target audit に request event を記録する。

### Material staging

新形式の source prefix:

```text
orgs/{sourceOrgId}/materials/{templateId}/
```

staging:

```text
templateMoveStaging/{operationId}/
```

- source object はこの段階では削除しない。
- object copy は存在チェック込みで idempotent。
- Firestore material doc に `storagePath` がなければ operation 開始前に blocker。
- path が sourceOrgId/templateId の expected prefix 外なら blocker。
- filename から legacy raw path を推測しない。
- Storage prefix を列挙することで、upload 後 Firestore write 前にクラッシュした orphan object も staging 対象にする。

### Version migration

- `lessonTemplates/{templateId}/versions/*` の全 document を処理する。
- `orgId === sourceOrgId` → `targetOrgId`。
- 既に `targetOrgId` なら retry として成功扱い。
- 第三の orgId の場合は failure。
- 100件程度の bounded batch で処理し、cursor/progress を operation に保持してよい。
- normal publish は lock により禁止されているため migration 中に新 version が増えないようにする。

### Ownership commit

1 transaction で、

```text
operation re-read
template re-read
moveOperationId match
source org match
all known versions migrated
```

を検証してから、

```ts
{
  orgId: targetOrgId,
  visibility: 'PRIVATE',
  publishedToCommunityAt: null,
  approvalStatus: 'PENDING',
  reviewedByUid: null,
  reviewedAt: null,
}
```

へ変更する。

保持するもの:

```text
templateId
createdByUid
createdAt
draft
currentPublishedVersionId
sourceTemplateId
sourceVersionId
sourceTemplateTitle
review aggregates
```

同じ transaction で既存 transaction-safe audit helper を使用し、

```text
source: MOVE_LESSON_TEMPLATE_OUT
target: MOVE_LESSON_TEMPLATE_IN
```

を記録する。

### Material finalization

staging object から、

```text
orgs/{targetOrgId}/materials/{templateId}/{storageId}/{fileName}
```

へ copy。

ルール:

```text
target exists → success
target missing + staging exists → copy
source delete → target existence confirmation after
staging delete → target existence confirmation after
```

material Firestore docs の `storagePath` も target path に変更。

### Completion

最後に、

- 全 version の `orgId === targetOrgId`
- 全 tracked material の `storagePath` が target prefix
- source prefix に未処理 object が残っていない
- operation ownership が一致

を確認後、

```text
template.moveOperationId delete
operation.status = COMPLETED
operation.completedAt set
```

とする。

### TDD

- [ ] legacy material がある preview は `canMove=false` になるテストを書く。
- [ ] material 0件の template は移動可能なテストを書く。
- [ ] source==target を拒否するテストを書く。
- [ ] operation creation が template lock と audit を同一 transaction で書くテストを書く。
- [ ] 同一 idempotency replay が同じ operation を返すテストを書く。
- [ ] payload mismatch が失敗するテストを書く。
- [ ] source Storage object が staging に copy されても source が削除されないテストを書く。
- [ ] staging retry が二重 object を生成しないテストを書く。
- [ ] version が target org へ移るテストを書く。
- [ ] already-migrated version を retry success とするテストを書く。
- [ ] unexpected third-org version を失敗させるテストを書く。
- [ ] ownership commit が同じ template ID を保持するテストを書く。
- [ ] `createdByUid` が変わらないテストを書く。
- [ ] lineage が変わらないテストを書く。
- [ ] COMMUNITY が PRIVATE へ戻るテストを書く。
- [ ] approval が PENDING へ戻るテストを書く。
- [ ] review/report/lessonRun collection に write が発生しないテストを書く。
- [ ] target raw object 作成前に source delete が起きないテストを書く。
- [ ] target object が既にある retry を成功扱いするテストを書く。
- [ ] material `storagePath` が target prefix になるテストを書く。
- [ ] finalization 完了前には `moveOperationId` が消えないテストを書く。
- [ ] COMPLETE 後にのみ lock が消えるテストを書く。
- [ ] audit payload に title/content/filename/storagePath が含まれないテストを書く。

失敗確認:

```bash
npm test --workspace=functions -- src/lessonTemplates/moveLessonTemplate.test.ts
```

- [ ] 期待した failure を確認する。
- [ ] pure core を最小実装する。
- [ ] Admin Firestore / Storage dependency wiring を追加する。
- [ ] Firestore Rules で client による `orgId` 移転を引き続き拒否する。
- [ ] `moveOperationId` 中の template/material client mutation を必要範囲で拒否する。

合格確認:

```bash
npm test --workspace=functions -- src/lessonTemplates/moveLessonTemplate.test.ts
npm run typecheck --workspace=functions
```

- [ ] Rules emulator suite を実行する。

Commit:

```bash
git add functions/src/lessonTemplates/moveLessonTemplate.ts functions/src/lessonTemplates/moveLessonTemplate.test.ts firestore.rules
git commit -m "feat: add resumable lesson template move core"
```

# Task 4: Owner-only Callables と Scheduled Reconciler を追加する

### Files

Create:
- `functions/src/lessonTemplates/moveLessonTemplateScheduled.ts`
- `functions/src/lessonTemplates/moveLessonTemplateScheduled.test.ts`

Modify:
- `functions/src/lessonTemplates/onCall.ts`
- `functions/src/lessonTemplates/onCall.test.ts`
- `functions/src/index.ts`

Test:
- `functions/src/lessonTemplates/onCall.test.ts`
- `functions/src/lessonTemplates/moveLessonTemplateScheduled.test.ts`

### Interfaces

Export:

```ts
previewLessonTemplateMoveCallable
moveLessonTemplateCallable
getLessonTemplateMoveOperationCallable
lessonTemplateMoveScheduled
```

Preview input:

```ts
{
  templateId: string
  sourceOrgId: string
  targetOrgId: string
}
```

Move input:

```ts
{
  templateId: string
  sourceOrgId: string
  targetOrgId: string
  reason: string
  confirmationText: string
  idempotencyKey: string
}
```

Move output:

```ts
{
  operationId: string
  status: LessonTemplateMoveStatus
  alreadyRequested: boolean
}
```

Operation status input:

```ts
{
  operationId: string
  sourceOrgId: string
  targetOrgId: string
}
```

Status outputには raw paths・reason・教材本文を含めず、

```ts
{
  operationId: string
  status: LessonTemplateMoveStatus
  phase: LessonTemplateMovePhase
  versionCount: number
  materialCount: number
  lastError?: string
}
```

程度に限定する。

### Authorization tests

preview / move / get すべてについて、

- [ ] unauthenticated は Firestore read 0件。
- [ ] teacher claim failure は Firestore read 0件。
- [ ] malformed scalar input は membership read 0件。
- [ ] source inactive member は template read 0件。
- [ ] source admin は template read 0件。
- [ ] source teacher は template read 0件。
- [ ] source owner + target inactive は template read 0件。
- [ ] source owner + target admin は template read 0件。
- [ ] source owner + target teacher は template read 0件。
- [ ] source / target 両方 owner の場合のみ template read に進む。
- [ ] template stored org が sourceOrgId と異なる場合は安全に拒否。
- [ ] `confirmationText !== targetOrgId` は拒否。
- [ ] reason 0文字、501文字を拒否。
- [ ] same-org move を拒否。
- [ ] legacy material blocker がある場合 move を作成しない。
- [ ] idempotent replay を確認。
- [ ] payload mismatch を確認。
- [ ] fresh reauth を要求していないことを確認。

失敗確認:

```bash
npm test --workspace=functions -- src/lessonTemplates/onCall.test.ts
```

### Scheduler

既存 annual archive の lease/retry pattern と同程度の単純な専用 worker とする。汎用 scheduler framework は作らない。

設定:

```text
region: asia-northeast1
timezone: Asia/Tokyo
schedule: every 5 minutes
```

対象:

```text
PENDING
FAILED
expired-lease RUNNING
```

- [ ] PENDING operation を claim する失敗テスト。
- [ ] valid RUNNING lease を二重 claim しないテスト。
- [ ] expired RUNNING lease を再開するテスト。
- [ ] FAILED を再実行するテスト。
- [ ] phase progress を維持するテスト。
- [ ] same phase retry が二重 Storage side effect を生成しないテスト。
- [ ] exception 時に FAILED + `lastError` を記録するテスト。
- [ ] completed job は対象外になるテスト。
- [ ] ownership commit 後の failure も rollback せず finalization へ再開するテスト。

失敗確認:

```bash
npm test --workspace=functions -- src/lessonTemplates/moveLessonTemplateScheduled.test.ts
```

- [ ] Callables を実装する。
- [ ] Scheduler を実装する。
- [ ] `functions/src/index.ts` から export する。

合格確認:

```bash
npm test --workspace=functions -- src/lessonTemplates/onCall.test.ts src/lessonTemplates/moveLessonTemplateScheduled.test.ts
npm run typecheck --workspace=functions
```

Commit:

```bash
git add functions/src/lessonTemplates/onCall.ts functions/src/lessonTemplates/onCall.test.ts functions/src/lessonTemplates/moveLessonTemplateScheduled.ts functions/src/lessonTemplates/moveLessonTemplateScheduled.test.ts functions/src/index.ts
git commit -m "feat: expose lesson template move workflow"
```

# Task 5: Client API・Editor UI・実際の org context を接続する

### Files

Create:
- `src/lib/lessonTemplates/moveLessonTemplate.ts`
- `src/lib/lessonTemplates/moveLessonTemplate.test.ts`

Modify:
- `src/lib/lessonTemplates/types.ts`
- `src/components/teacher/templates/TemplateEditorPage.tsx`
- `src/components/teacher/templates/TemplateEditorPage.test.tsx`
- `src/App.tsx`
- `src/App.test.tsx`

Test:
- `src/lib/lessonTemplates/moveLessonTemplate.test.ts`
- `src/components/teacher/templates/TemplateEditorPage.test.tsx`
- `src/App.test.tsx`

### Client interfaces

```ts
previewLessonTemplateMove(...)
moveLessonTemplate(...)
getLessonTemplateMoveOperation(...)
```

thin `httpsCallable` wrappers とし、ビジネスルールを client 側へ複製しない。

`LessonTemplate` client type に、

```ts
moveOperationId?: string
```

を追加する。

legacy `ownerUid` の大規模 cleanup は今回行わない。

### App org context fix

現在の editor route が `personalOrgId(user.uid)` を前提にする箇所を修正する。

template document をロード後、

```text
actual stored template.orgId
```

を `TemplateEditorPage`、material、AI、publish 等の org context として使用する。

移動完了後も URL は同じ、

```text
/templates/{templateId}
```

のまま維持し、template を reload して新しい `orgId` を採用する。

### UI

Editor の管理領域に「別の組織へ移動」を追加する。

フロー:

```text
targetOrgId 入力
↓
影響を確認
↓
preview callable
↓
影響範囲表示
↓
reason
↓
targetOrgId 確認入力
↓
移動開始
↓
operation status
↓
COMPLETED
↓
同じ template URL を reload
```

preview 表示項目:

- source org
- target org
- version count
- material count
- COMMUNITY 公開が解除される
- 組織内承認がリセットされる
- 過去の LessonRun は source organization に残る
- review/report は維持される
- legacy material blocker 件数

`legacyMaterialCount > 0` の場合、安全に所有権を移転できない旨を表示し、最終 submit を disable。

`moveOperationId` がある間は少なくとも、

- draft save
- publish
- community publish
- share creation/revocation
- material upload/delete
- approval action
- 再度の move

を UI でも disable。

server authorization が最終防御であり、UI disable に依存しない。

### TDD

- [ ] client wrapper の callable name/input/output mapping failure test を追加。
- [ ] preview 前は最終 move button が有効にならないテストを追加。
- [ ] preview の version/material impact が表示されるテストを追加。
- [ ] COMMUNITY reset warning を表示するテストを追加。
- [ ] approval reset warning を表示するテストを追加。
- [ ] historical LessonRun が移動しない旨を表示するテストを追加。
- [ ] legacy blocker で submit disable になるテストを追加。
- [ ] reason 未入力で submit disable。
- [ ] confirmation targetOrgId 不一致で submit disable。
- [ ] RUNNING phase/status を表示。
- [ ] FAILED は再試行中/再開可能な状態として表示。
- [ ] COMPLETED 後に template を reload するテスト。
- [ ] `moveOperationId` 中の編集系 controls disable をテスト。
- [ ] `App.tsx` が personal org 固定ではなく loaded template の orgId を editor へ渡すテスト。

失敗確認:

```bash
npm test -- src/lib/lessonTemplates/moveLessonTemplate.test.ts src/components/teacher/templates/TemplateEditorPage.test.tsx src/App.test.tsx
```

- [ ] 期待した理由で失敗することを確認。
- [ ] client wrapper を実装。
- [ ] editor move UI を実装。
- [ ] actual template org context を App へ反映。
- [ ] status polling は operation RUNNING/FAILED のときだけ行い、COMPLETED で停止。
- [ ] browser storage へ reason / operation data を永続化しない。

合格確認:

```bash
npm test -- src/lib/lessonTemplates/moveLessonTemplate.test.ts src/components/teacher/templates/TemplateEditorPage.test.tsx src/App.test.tsx
npm run typecheck
```

Commit:

```bash
git add src/lib/lessonTemplates/moveLessonTemplate.ts src/lib/lessonTemplates/moveLessonTemplate.test.ts src/lib/lessonTemplates/types.ts src/components/teacher/templates/TemplateEditorPage.tsx src/components/teacher/templates/TemplateEditorPage.test.tsx src/App.tsx src/App.test.tsx
git commit -m "feat: add lesson template move management UI"
```

# Task 6: Backlog 更新と統合検証

### Files

Modify:
- `docs/superpowers/scope-backlog.md`

Test:
- repository-wide verification only

### Interfaces

Consumes:

```text
Tasks 1–5 fully passing and pushed-ready implementation
```

Produces:

```text
Phase 5「教材の移動」= 実装済み
```

### TDD / Verification

この Task では実装コードを追加しない。

- [ ] source owner だが target owner でないケースが拒否される。
- [ ] target owner だが source owner でないケースが拒否される。
- [ ] same template ID が transfer 後も利用される。
- [ ] version IDs が維持される。
- [ ] all version orgIds が target。
- [ ] target org で editor が actual org context を使う。
- [ ] source org から client access できなくなる。
- [ ] old share token が resolve 不能。
- [ ] COMMUNITY が PRIVATE。
- [ ] approval が PENDING。
- [ ] reviews が残る。
- [ ] reports が残る。
- [ ] historical LessonRuns が変わらない。
- [ ] material raw files が target Storage prefix に存在。
- [ ] source material objects が successful finalization 後に削除される。
- [ ] staging が cleanup される。
- [ ] partial Storage failure から retry で COMPLETED になる。
- [ ] operation 完了前に template lock が消えない。
- [ ] source / target audit 両方に履歴が存在。
- [ ] audit に content / filename / storage path がない。
- [ ] legacy material を含む教材は move operation を開始できない。
- [ ] backlog を「実装済み」にするのはここまで全部 PASS した後だけ。

Repository verification:

```bash
npm run typecheck
npm test
npm run verify
```

すべて PASS すること。

その後、

```bash
git status --short
git branch --show-current
git log -5 --oneline
```

確認事項:

```text
branch == codex/classroom
working tree に意図しない変更なし
Tasks 1–5 の commit が存在
```

backlog 更新:

```bash
git add docs/superpowers/scope-backlog.md
git commit -m "docs: mark lesson template move implemented"
```

最後にもう一度、

```bash
npm run typecheck
npm test
npm run verify
```

を PASS させる。

## Agent Assignment

| Task | Agent | 理由 |
|---|---|---|
| Task 1 | Claude Code | Storage path と既存 upload semantics の変更が中心 |
| Task 2 | Codex | 既存 Callable / authorization 境界の局所修正 |
| Task 3 | Claude Code | Firestore transaction + Storage retry + ownership commit の整合性が最重要 |
| Task 4 | Codex | Callable authorization と既存 scheduler pattern への適合 |
| Task 5 | Antigravity | React UI、状態表示、editor route 接続 |
| Task 6 | Codex | 仕様との突合・統合検証・backlog 更新 |

Task 1 と Task 2 は独立しているため並行実行可能。

依存関係は、

```text
Task 1 ─┐
        ├→ Task 3 → Task 4 → Task 5 → Task 6
Task 2 ─┘
```

を基本とする。

Task 3 は Task 1 の `storagePath` 契約確定後に進める。Task 5 は Task 4 の Callable contract を確定してから接続する。

## Final Push

全検証 PASS 後のみ実行する。

```bash
git status --short
git branch --show-current
git log -5 --oneline
```

`codex/classroom` であることを確認して、

```bash
git push origin codex/classroom
```

まで実行する。

ローカル commit で終了しない。remote `codex/classroom` の HEAD が最終 commit と一致することまで確認する。
