# VERIFIED / OFFICIAL 教材認定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** operator が current published LessonVersion を VERIFIED または OFFICIAL として認定でき、一般教師の marketplace では3公開区分を一貫して閲覧・複製・通報できるようにする。

**Architecture:** `LessonVersion` の immutable document は変更せず、current certification metadata と append-only event を top-level Firestore collection に保存し、`lessonTemplates.visibility` を現在公開中 version の区分 summary として使う。operator-only Callable が idempotent transaction で認定を変更し、新 version publish 時は VERIFIED/OFFICIAL を COMMUNITY へ自動降格する。

**Tech Stack:** TypeScript 6, Firebase Functions v2, Firestore transactions, Firebase Admin Auth, React 19, Material UI 9, Vitest, Testing Library.

## Global Constraints

- 正本は `docs/superpowers/specs/2026-08-15-template-certification-design.md` と `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md`。
- `LessonVersion` document の content/metadata は認定付与で変更しない。
- marketplace 公開区分は `COMMUNITY | VERIFIED | OFFICIAL`。
- VERIFIED は一般教師作成教材にも operator が付与できる。
- OFFICIAL は `createdByUid` が operator custom claim を持つ教材だけ。
- certification 対象 versionId は必ず `currentPublishedVersionId` と一致する。
- operator auth → scalar validation 完了前に template/version を読まない。
- certification transaction は reads をすべて writes より前に行う。
- same idempotency key + same payload は replay、same key + different payload は `failed-precondition`。
- requested visibility が既に current visibility と同じ場合は `changed:false` とし、新しい certification event は作らない。
- new version publish は VERIFIED/OFFICIAL を COMMUNITY に戻し、旧 version certification document/event を削除しない。
- direct client write で VERIFIED/OFFICIAL を付与できる Rules 変更をしない。
- VERIFIED/OFFICIAL も複製・派生閲覧・通報・operator UNPUBLISH の対象。
- backlog は全 verification PASS 後のみ更新する。

---

### Task 1: Marketplace visibility contract を3公開区分へ統一する

**Files:**
- Create: `functions/src/lessonTemplates/marketplaceVisibility.ts`
- Create: `functions/src/lessonTemplates/marketplaceVisibility.test.ts`
- Create: `src/lib/lessonTemplates/marketplaceVisibility.ts`
- Create: `src/lib/lessonTemplates/marketplaceVisibility.test.ts`
- Modify: `src/lib/lessonTemplates/types.ts`
- Modify: `src/lib/lessonTemplates/communityTemplates.ts`
- Modify: `src/lib/lessonTemplates/communityTemplates.test.ts`
- Modify: `src/lib/lessonTemplates/templateDerivatives.ts`
- Modify: `src/lib/lessonTemplates/templateDerivatives.test.ts`
- Modify: `firestore.rules`
- Modify: existing Firestore rules test file covering `lessonTemplates` public reads.

**Interfaces:**

```ts
export type MarketplaceVisibility = 'COMMUNITY' | 'VERIFIED' | 'OFFICIAL'

export const MARKETPLACE_VISIBILITIES: readonly MarketplaceVisibility[] = [
  'COMMUNITY',
  'VERIFIED',
  'OFFICIAL',
]

export const isMarketplaceVisibility = (value: unknown): value is MarketplaceVisibility =>
  value === 'COMMUNITY' || value === 'VERIFIED' || value === 'OFFICIAL'
```

- Consumes: existing `LessonTemplate.visibility`, community queries, derivative queries.
- Produces: server/client equivalent public visibility helper; `CommunityTemplate.visibility`.

- [ ] **Step 1: helper failing tests を書く。**3公開区分 true、PRIVATE/LINK/ORGANIZATION/undefined false。
- [ ] **Step 2: `LessonTemplate.visibility` が `PRIVATE | LINK | ORGANIZATION | COMMUNITY | VERIFIED | OFFICIAL` を受ける type-level compile expectation を追加する。** existing `'PUBLIC'` literal は削除する。
- [ ] **Step 3: marketplace list failing tests を変更する。** Firestore query が `where('visibility', 'in', ['COMMUNITY','VERIFIED','OFFICIAL'])` を使い、result に visibility を返すことを検証する。
- [ ] **Step 4: derivative list failing tests を変更する。** sourceTemplateId + visibility `in` の3区分だけを対象とする。
- [ ] **Step 5: Firestore Rules emulator failing tests を追加する。** teacher が VERIFIED/OFFICIAL current template/version を get/list でき、PRIVATE は他組織から読めないことを検証する。
- [ ] **Step 6: failing tests を確認する。**

```bash
npm test --workspace=functions -- src/lessonTemplates/marketplaceVisibility.test.ts
npm test -- src/lib/lessonTemplates/marketplaceVisibility.test.ts src/lib/lessonTemplates/communityTemplates.test.ts src/lib/lessonTemplates/templateDerivatives.test.ts
npm run test:rules
```

- [ ] **Step 7: server/client helper と type を実装する。** functions と client は rootDir が別なので無理な cross-import を作らない。
- [ ] **Step 8: list/derivative queries を3区分対応へ変更する。** existing `firestore.indexes.json` の visibility + subject + publishedToCommunityAt indexes を利用し、新規 index は emulator が必要性を示さない限り追加しない。
- [ ] **Step 9: Firestore Rules に `marketplaceVisible(resource.data)` helper を追加し get/list/version current read に使う。** client write rules は変更しない。
- [ ] **Step 10: tests/typecheck を PASS させる。**

```bash
npm test --workspace=functions -- src/lessonTemplates/marketplaceVisibility.test.ts
npm test -- src/lib/lessonTemplates/marketplaceVisibility.test.ts src/lib/lessonTemplates/communityTemplates.test.ts src/lib/lessonTemplates/templateDerivatives.test.ts
npm run test:rules
npm run typecheck
```

- [ ] **Step 11: commit。**

```bash
git add functions/src/lessonTemplates/marketplaceVisibility.ts functions/src/lessonTemplates/marketplaceVisibility.test.ts src/lib/lessonTemplates/marketplaceVisibility.ts src/lib/lessonTemplates/marketplaceVisibility.test.ts src/lib/lessonTemplates/types.ts src/lib/lessonTemplates/communityTemplates.ts src/lib/lessonTemplates/communityTemplates.test.ts src/lib/lessonTemplates/templateDerivatives.ts src/lib/lessonTemplates/templateDerivatives.test.ts firestore.rules
git commit -m "feat: add certified marketplace visibility levels"
```

---

### Task 2: Idempotent certification core を実装する

**Files:**
- Create: `functions/src/lessonTemplates/templateCertification.ts`
- Create: `functions/src/lessonTemplates/templateCertification.test.ts`

**Interfaces:**

```ts
export type TemplateCertificationLevel = 'COMMUNITY' | 'VERIFIED' | 'OFFICIAL'

export interface SetTemplateCertificationInput {
  templateId: string
  versionId: string
  level: TemplateCertificationLevel
  reason: string
  idempotencyKey: string
  actorUid: string
}

export interface SetTemplateCertificationResult {
  visibility: TemplateCertificationLevel
  changed: boolean
  deduplicated: boolean
}
```

Firestore paths:

```text
templateVersionCertifications/{templateId}__{versionId}
templateCertificationEvents/{idempotencyDocumentId(templateId, idempotencyKey)}
templateCertificationIdempotency/{idempotencyDocumentId(templateId, idempotencyKey)}
```

- Consumes: Task 1 `isMarketplaceVisibility`, existing `idempotencyDocumentId` / `requestDigest` helpers.
- Produces: pure/DI `setTemplateCertification()` and Admin SDK wiring that updates template + certification + event atomically.

- [ ] **Step 1: success failing test。** COMMUNITY current version → VERIFIED で template visibility、certification doc、event、idempotency doc の4 writes が同一 transaction に入ることを検証する。
- [ ] **Step 2: current version mismatch failing test。** versionId が currentPublishedVersionId と違えば writes 0。
- [ ] **Step 3: non-public failing test。** PRIVATE/LINK/ORGANIZATION から直接 VERIFIED/OFFICIAL にできない。
- [ ] **Step 4: VERIFIED→OFFICIAL、OFFICIAL→VERIFIED、VERIFIED/OFFICIAL→COMMUNITY を検証する。** previousVisibility/nextVisibility event が正しい。
- [ ] **Step 5: same state request は `changed:false` で event write 0、idempotency result は保存する test を追加する。**
- [ ] **Step 6: same key same payload replay は `deduplicated:true`、same key different payload は error の test を追加する。**
- [ ] **Step 7: reason trim 1〜500 を core boundary でも守る test を追加する。**
- [ ] **Step 8: failing tests を確認する。**

```bash
npm test --workspace=functions -- src/lessonTemplates/templateCertification.test.ts
```

- [ ] **Step 9: transaction を最小実装する。** idempotency→template→version の reads を完了後に writes へ進む。
- [ ] **Step 10: version document は validation read のみで `set/update` しない。** test spy で version path write 0を固定する。
- [ ] **Step 11: metadata の `level` は VERIFIED/OFFICIAL、COMMUNITY revoke では null と revoked fields を書く。**
- [ ] **Step 12: tests/typecheck を PASS させる。**

```bash
npm test --workspace=functions -- src/lessonTemplates/templateCertification.test.ts
npm run typecheck --workspace=functions
```

- [ ] **Step 13: commit。**

```bash
git add functions/src/lessonTemplates/templateCertification.ts functions/src/lessonTemplates/templateCertification.test.ts
git commit -m "feat: add template certification core"
```

---

### Task 3: operator-only certification Callables と Rules deny を追加する

**Files:**
- Modify: `functions/src/lessonTemplates/onCall.ts`
- Modify: `functions/src/lessonTemplates/onCall.test.ts`
- Modify: `functions/src/index.ts`
- Modify: `firestore.rules`
- Modify: existing Firestore rules test file.

**Interfaces:**

```ts
export interface CertificationCandidate {
  templateId: string
  title: string
  currentPublishedVersionId: string
  visibility: 'COMMUNITY' | 'VERIFIED' | 'OFFICIAL'
  createdByUid: string
}
```

Exports:

```text
listTemplateCertificationCandidatesCallable
setTemplateCertificationCallable
```

- Consumes: Task 2 core; existing `isCallerOperator()` pattern in `onCall.ts`; Admin Auth `getUser()` for OFFICIAL creator verification.
- Produces: operator-only list and mutation APIs.

- [ ] **Step 1: authorization-order failing tests を追加する。** unauthenticated / non-operator では template/version Firestore read count 0。
- [ ] **Step 2: scalar validation failing tests を追加する。** empty templateId/versionId/idempotencyKey、invalid level、reason 0/501 chars は target reads 0。
- [ ] **Step 3: VERIFIED success test を追加する。** creator が一般教師でも成功。
- [ ] **Step 4: OFFICIAL success test を追加する。** `getAuth().getUser(createdByUid).customClaims.operator === true` の場合だけ core が呼ばれる。
- [ ] **Step 5: OFFICIAL ineligible test を追加する。** creator が operator でなければ `failed-precondition`、core writes 0。
- [ ] **Step 6: candidate list が3公開区分だけを最大50件、`publishedToCommunityAt desc` で返す test を追加する。** content/version body は返さない。
- [ ] **Step 7: failing tests を確認する。**

```bash
npm test --workspace=functions -- src/lessonTemplates/onCall.test.ts src/lessonTemplates/templateCertification.test.ts
```

- [ ] **Step 8: Callable validation/auth を実装する。** order は auth→operator→scalar validation→template→version→OFFICIAL creator auth→core。
- [ ] **Step 9: `functions/src/index.ts` から2 Callables を export する。**
- [ ] **Step 10: Firestore Rules で `templateVersionCertifications` / `templateCertificationEvents` / `templateCertificationIdempotency` direct read/write を false にする。**
- [ ] **Step 11: rules tests を追加して一般教師/operator client SDK の直接 write が両方拒否されることを固定する。** Admin SDK Callable のみが writer。
- [ ] **Step 12: targeted tests/rules/typecheck を PASS させる。**

```bash
npm test --workspace=functions -- src/lessonTemplates/onCall.test.ts src/lessonTemplates/templateCertification.test.ts
npm run test:rules
npm run typecheck --workspace=functions
```

- [ ] **Step 13: commit。**

```bash
git add functions/src/lessonTemplates/onCall.ts functions/src/lessonTemplates/onCall.test.ts functions/src/index.ts firestore.rules
git commit -m "feat: expose operator template certification"
```

---

### Task 4: 新 version publish で認定を自動継承しない

**Files:**
- Modify: `functions/src/lessonTemplates/publishLessonVersion.ts`
- Modify: `functions/src/lessonTemplates/publishLessonVersion.test.ts`

**Interfaces:**
- Consumes: existing `LessonTemplate.visibility`.
- Produces: new version publish transaction の conditional visibility reset。

- [ ] **Step 1: VERIFIED template publish failing test。** new version は作られるが template visibility が COMMUNITY になる。
- [ ] **Step 2: OFFICIAL template publish failing test。**同様に COMMUNITY になる。
- [ ] **Step 3: PRIVATE/LINK/ORGANIZATION/COMMUNITY publish は existing visibility を変更しない regression tests を追加する。**
- [ ] **Step 4: old `templateVersionCertifications/{oldVersion}` path に delete/write がない test を追加する。** certification history は保持。
- [ ] **Step 5: idempotent publish replay で visibility reset/event が二重発生しないことを確認する。** publish は certification event を新規作成しない。
- [ ] **Step 6: failing tests を確認する。**

```bash
npm test --workspace=functions -- src/lessonTemplates/publishLessonVersion.test.ts
```

- [ ] **Step 7: template update payload に conditional visibility を追加する。** current visibility が VERIFIED/OFFICIAL のときだけ COMMUNITY を merge write する。
- [ ] **Step 8: tests/typecheck を PASS させる。**

```bash
npm test --workspace=functions -- src/lessonTemplates/publishLessonVersion.test.ts
npm run typecheck --workspace=functions
```

- [ ] **Step 9: commit。**

```bash
git add functions/src/lessonTemplates/publishLessonVersion.ts functions/src/lessonTemplates/publishLessonVersion.test.ts
git commit -m "fix: reset certification on new lesson version"
```

---

### Task 5: 既存 community/share/report semantics を3公開区分対応へ変更する

**Files:**
- Modify: `functions/src/lessonTemplates/onCall.ts`
- Modify: `functions/src/lessonTemplates/onCall.test.ts`
- Modify: `functions/src/lessonTemplates/templateShares.ts` only if its current-public validation is centralized there after the Phase 5 move implementation; otherwise no change.

**Interfaces:**
- Consumes: Task 1 `isMarketplaceVisibility()`.
- Produces: duplicate/report/unpublish behavior that treats COMMUNITY/VERIFIED/OFFICIAL consistently.

- [ ] **Step 1: duplicate failing tests。** shareToken なしでも VERIFIED/OFFICIAL source は source-org membership bypass の公開教材として複製可能。
- [ ] **Step 2: report failing tests。** VERIFIED/OFFICIAL を通報可能、PRIVATE は引き続き `not-found`。
- [ ] **Step 3: operator report `UNPUBLISH` failing test。** VERIFIED/OFFICIAL から PRIVATE になる。
- [ ] **Step 4: creator unpublish failing test。** VERIFIED/OFFICIAL も PRIVATE へ戻せる。
- [ ] **Step 5: `publishTemplateToCommunityCallable` が既に VERIFIED/OFFICIAL の教材を暗黙に COMMUNITY へ downgrade しない test を追加する。**同状態は `failed-precondition` または明示 no-op とし、実装時に1つへ固定する。推奨は `failed-precondition`。
- [ ] **Step 6: failing tests を確認する。**

```bash
npm test --workspace=functions -- src/lessonTemplates/onCall.test.ts
```

- [ ] **Step 7: literal COMMUNITY 判定を Task 1 helper へ置換する。** private/link/org semantics は変えない。
- [ ] **Step 8: VERIFIED/OFFICIAL の downgrade は certification Callable または explicit unpublish だけで行う。**
- [ ] **Step 9: tests/typecheck を PASS させる。**

```bash
npm test --workspace=functions -- src/lessonTemplates/onCall.test.ts
npm run typecheck --workspace=functions
```

- [ ] **Step 10: commit。**

```bash
git add functions/src/lessonTemplates/onCall.ts functions/src/lessonTemplates/onCall.test.ts
git commit -m "fix: support certified templates across marketplace actions"
```

---

### Task 6: Operator certification workspace を追加する

**Files:**
- Create: `src/lib/lessonTemplates/templateCertification.ts`
- Create: `src/lib/lessonTemplates/templateCertification.test.ts`
- Create: `src/components/operator/OperatorTemplateCertificationsPage.tsx`
- Create: `src/components/operator/OperatorTemplateCertificationsPage.test.tsx`
- Modify: `src/components/operator/OperatorReportsPage.tsx`
- Modify: `src/components/operator/OperatorReportsPage.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**

```ts
export interface SetTemplateCertificationRequest {
  templateId: string
  versionId: string
  level: 'COMMUNITY' | 'VERIFIED' | 'OFFICIAL'
  reason: string
  idempotencyKey: string
}
```

Client exports:

```text
listTemplateCertificationCandidates(functions)
setTemplateCertification(functions, input)
```

- Consumes: Task 3 Callables.
- Produces: `/operator/certifications` UI and discoverable navigation from `/operator/reports`.

- [ ] **Step 1: client wrappers failing tests を書く。** exact callable names/input/output mapping を検証する。
- [ ] **Step 2: operator page access-denied/loading/list failing tests を書く。** list callable permission error は「運営者のみ利用できます」に変換する。
- [ ] **Step 3: certification action failing tests を書く。** reason 未入力は disabled、VERIFIED/OFFICIAL/COMMUNITY の action が exact currentVersionId と stable idempotencyKey を送る。
- [ ] **Step 4: action success 後に candidate list を reload して visibility が更新されることを検証する。**
- [ ] **Step 5: `OperatorReportsPage` から「教材認定」へ遷移できる navigation test を追加する。**
- [ ] **Step 6: App route `/operator/certifications` failing test を追加する。** existing `TemplateRouteGuard` は teacher login UX guard として維持し、operator enforcement は Callable に依存する。
- [ ] **Step 7: failing tests を確認する。**

```bash
npm test -- src/lib/lessonTemplates/templateCertification.test.ts src/components/operator/OperatorTemplateCertificationsPage.test.tsx src/components/operator/OperatorReportsPage.test.tsx src/App.test.tsx
```

- [ ] **Step 8: wrappers/page/route/navigation を実装する。**新しい operator-wide framework は作らない。
- [ ] **Step 9: failed-precondition の OFFICIAL 不適格エラーを対象行へ表示し、他候補の操作は継続できるようにする。**
- [ ] **Step 10: tests/typecheck を PASS させる。**

```bash
npm test -- src/lib/lessonTemplates/templateCertification.test.ts src/components/operator/OperatorTemplateCertificationsPage.test.tsx src/components/operator/OperatorReportsPage.test.tsx src/App.test.tsx
npm run typecheck
```

- [ ] **Step 11: commit。**

```bash
git add src/lib/lessonTemplates/templateCertification.ts src/lib/lessonTemplates/templateCertification.test.ts src/components/operator/OperatorTemplateCertificationsPage.tsx src/components/operator/OperatorTemplateCertificationsPage.test.tsx src/components/operator/OperatorReportsPage.tsx src/components/operator/OperatorReportsPage.test.tsx src/App.tsx src/App.test.tsx
git commit -m "feat: add operator template certification workspace"
```

---

### Task 7: Teacher marketplace に VERIFIED/OFFICIAL badge を表示する

**Files:**
- Modify: `src/components/teacher/templates/CommunityTemplatesPage.tsx`
- Modify: `src/components/teacher/templates/CommunityTemplatesPage.test.tsx`
- Modify: `src/components/teacher/templates/CommunityTemplateDetailPage.tsx`
- Modify: `src/components/teacher/templates/CommunityTemplateDetailPage.test.tsx`
- Modify: `src/lib/lessonTemplates/communityTemplates.ts`

**Interfaces:**
- Consumes: `CommunityTemplate.visibility` from Task 1.
- Produces: read-only labels `通常公開` / `認証済み` / `公式`.

- [ ] **Step 1: marketplace list failing tests を追加する。** VERIFIED は「認証済み」、OFFICIAL は「公式」、COMMUNITY は通常公開として区別できる。
- [ ] **Step 2: detail page failing tests を追加する。** current visibility badge を表示し、一般教師向け grant button が存在しないことを検証する。
- [ ] **Step 3: derivative cards/list が visibility を保持する test を追加する。**
- [ ] **Step 4: failing tests を確認する。**

```bash
npm test -- src/components/teacher/templates/CommunityTemplatesPage.test.tsx src/components/teacher/templates/CommunityTemplateDetailPage.test.tsx src/lib/lessonTemplates/communityTemplates.test.ts
```

- [ ] **Step 5: MUI `Chip` 等の既存 component だけで badge を実装する。**新 design system は作らない。
- [ ] **Step 6:一般教師 UI に certification mutation controls を追加しない。**
- [ ] **Step 7: tests/typecheck を PASS させる。**

```bash
npm test -- src/components/teacher/templates/CommunityTemplatesPage.test.tsx src/components/teacher/templates/CommunityTemplateDetailPage.test.tsx src/lib/lessonTemplates/communityTemplates.test.ts
npm run typecheck
```

- [ ] **Step 8: commit。**

```bash
git add src/components/teacher/templates/CommunityTemplatesPage.tsx src/components/teacher/templates/CommunityTemplatesPage.test.tsx src/components/teacher/templates/CommunityTemplateDetailPage.tsx src/components/teacher/templates/CommunityTemplateDetailPage.test.tsx src/lib/lessonTemplates/communityTemplates.ts
git commit -m "feat: show certified marketplace badges"
```

---

### Task 8: Security regression・backlog・full verification

**Files:**
- Modify: `docs/superpowers/scope-backlog.md`
- Test: existing `functions/src/lessonTemplates/*.test.ts`, marketplace UI tests, Firestore Rules emulator tests.

**Interfaces:**
- Consumes: Tasks 1–7.
- Produces: Phase 6 VERIFIED/OFFICIAL acceptance evidence and backlog completion mark.

- [ ] **Step 1: authorization ordering を最終確認する。** non-operator certification request は template/version reads 0。
- [ ] **Step 2: OFFICIAL 資格を最終確認する。**一般教師 creator → failed-precondition、operator creator → success。
- [ ] **Step 3: immutable version regression を確認する。** certification action の changed Firestore paths に `lessonTemplates/{id}/versions/{versionId}` が存在しない。
- [ ] **Step 4: marketplace regression を確認する。** COMMUNITY/VERIFIED/OFFICIAL が list/detail/duplicate/report で同じ公開境界、PRIVATE は非公開。
- [ ] **Step 5: new-version reset を確認する。** VERIFIED/OFFICIAL の次 version は COMMUNITY、旧 certification metadata は残る。
- [ ] **Step 6: idempotency regression を確認する。** retry で event duplicate 0。
- [ ] **Step 7: full verification を実行する。**

```bash
npm run verify
```

Expected: exit code 0。failure が1件でもあれば backlog を更新しない。

- [ ] **Step 8: PASS 後のみ Phase 6 の「VERIFIED/OFFICIAL」を実装済みに更新する。**
- [ ] **Step 9: backlog commit。**

```bash
git add docs/superpowers/scope-backlog.md
git commit -m "docs: mark template certification implemented"
```

- [ ] **Step 10: backlog commit 後に full verification を再実行する。**

```bash
npm run verify
```

- [ ] **Step 11: branch/working tree を確認する。**

```bash
git status --short
git branch --show-current
git log -8 --oneline
```

Expected: branch = `codex/classroom`、意図しない変更なし。

- [ ] **Step 12: remote へ push する。**

```bash
git push origin codex/classroom
```

## Agent Assignment

- Task 1: **Codex** — Rules と marketplace visibility の横断整合。
- Task 2: **Claude Code** — idempotent Firestore transaction と certification history。
- Task 3: **Codex** — operator authorization ordering / Callable boundary / Rules deny。
- Task 4: **Claude Code** — immutable version publish と certification reset。
- Task 5: **Codex** —既存 marketplace action の公開区分対応。
- Task 6: **Antigravity** — operator React workspace。
- Task 7: **Antigravity** — marketplace badge UI。
- Task 8: **Codex** — security regression と full verification。

Task 1 と Task 2 は interface (`MarketplaceVisibility`) を先に固定すれば並行可能。Task 4 は Task 2 と独立して着手可能。Task 6/7 は backend/client contracts 確定後に進める。本計画は Phase 2 Research Desk 計画とデータ・ファイル依存がなく、別 agent group で完全に並行実行可能。
