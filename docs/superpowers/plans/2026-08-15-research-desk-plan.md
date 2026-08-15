# Research Desk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生徒が授業フェーズに応じて企業・ニュース・統計・チームノート・注文を安全に扱える Research Desk を `/lessons/:runId/play` に実装する。

**Architecture:** 企業・ニュース・統計は `LessonRun.templateSnapshot.socialStudiesMarket` から Functions が `toPublicView.ts` の allow-list 変換を通して `lessonRunPublic` に投影する。チームノートは Firestore を system of record、`lessonRunTeamState` を team-scoped RTDB mirror とし、注文は既存エンジンを再利用しつつ batchId/referencePrice を server-side 解決へ変更する。

**Tech Stack:** TypeScript 6, React 19, Material UI 9, Firebase Functions v2, Firestore, Realtime Database, Vitest, Testing Library.

## Global Constraints

- 正本は `docs/superpowers/specs/2026-08-15-research-desk-design.md` と `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md`。
- student が `LessonTemplate` / `LessonVersion` / `@stock-league/market-authoring-content` を直接読む経路を作らない。
- `impactSensitivities`、`InformationImpact`、seed、内部係数、未来価格を student-readable RTDB に含めない。
- `publishedAtMillis > nowMillis` の InformationItem / EconomicIndicator は object 自体を projection に含めない。
- phase capability は server が `availablePanels` として決め、client は独自の権限表を持たない。
- `CUSTOM` phase で注文を暗黙に有効化しない。
- Research Desk の RTDB writer は `.set()` で sibling fields を消さず、所有キーだけ `update()` する。
- team note は他チームの RTDB path と `lessonRunPublic` に複製しない。
- participant/team scope は server-side で再検証し、client input の participant identity を信用しない。
- `submitOrderCallable` は MARKET phase + RUNNING + not paused を server-side で必須にする。
- `batchId` と `referencePrice` は client input から削除し、server が `nextBatchId` / current stock price から解決する。
- client disable は UX のみ。最終認可・状態検証は Functions。
- transaction は全 reads を writes より前に行う。
- backlog は全 integration verification PASS 後のみ更新する。

---

### Task 1: Research Desk public contract と server projection

**Files:**
- Modify: `functions/packages/market-public-content/src/index.ts`
- Create: `functions/src/market/researchDeskProjection.ts`
- Create: `functions/src/market/researchDeskProjection.test.ts`
- Modify: `src/lib/lessonRuns/liveTypes.ts`

**Interfaces:**
- Consumes: `toCompanyPublicView`, `toInformationPublicView`, `toEconomicIndicatorPublicView` from `functions/src/market/toPublicView.ts`.
- Produces: `ResearchDeskPanelId`, `ResearchDeskPublicView`, `buildResearchDeskPublicView()`, `publishResearchDeskProjectionWithAdminSdk()`.

```ts
export type ResearchDeskPanelId = 'COMPANIES' | 'NEWS' | 'STATISTICS' | 'TEAM_NOTES' | 'ORDERS'

export interface ResearchDeskPublicView {
  phaseId: string | null
  phaseType: string | null
  availablePanels: ResearchDeskPanelId[]
  companies: CompanyPublicView[]
  informationItems: InformationPublicView[]
  economicIndicators: EconomicIndicatorPublicView[]
  updatedAtMillis: number
}
```

- [ ] **Step 1: failing tests を追加する。** `INTRO` は全配列空、`INFORMATION` は企業/公開済みニュース/公開済み統計のみ、`MARKET` は5 panel、`CUSTOM` は0 panel を検証する。
- [ ] **Step 2: future information が projection に存在しない failing test を追加する。** `publishedAtMillis === nowMillis + 1` の item/indicator が output に含まれないことを検証する。
- [ ] **Step 3: hidden authoring fields を output に入れない failing test を追加する。** company `impactSensitivities` と information `impact` が serialized output に存在しないことを検証する。
- [ ] **Step 4: テストが期待理由で FAIL することを確認する。**

```bash
npm test --workspace=functions -- src/market/researchDeskProjection.test.ts
```

- [ ] **Step 5: public package に `ResearchDeskPanelId` / `ResearchDeskPublicView` を追加する。** client/server が同じ public shape を参照する。
- [ ] **Step 6: `buildResearchDeskPublicView()` を最小実装する。** current phase を `templateSnapshot.phases` から解決し、phase table と `publishedAtMillis <= nowMillis` を適用する。
- [ ] **Step 7: Admin SDK publisher を実装する。** `lessonRuns/{id}` の `currentPhaseId` と `templateSnapshot.socialStudiesMarket` を読み、`lessonRunPublic/{id}` の `researchDesk` キーだけを `update()` する。
- [ ] **Step 8: client `LessonRunPublicState` に `researchDesk?: ResearchDeskPublicView` を追加する。** server/client hand-sync の既存規約を維持する。
- [ ] **Step 9: targeted tests と typecheck を PASS させる。**

```bash
npm test --workspace=functions -- src/market/researchDeskProjection.test.ts
npm run typecheck
```

- [ ] **Step 10: commit。**

```bash
git add functions/packages/market-public-content/src/index.ts functions/src/market/researchDeskProjection.ts functions/src/market/researchDeskProjection.test.ts src/lib/lessonRuns/liveTypes.ts
git commit -m "feat: add Research Desk public projection"
```

---

### Task 2: フェーズ遷移と市場バッチから projection を更新する

**Files:**
- Modify: `functions/src/lessonRuns/phases/transitionPhase.ts`
- Modify: `functions/src/lessonRuns/phases/transitionPhase.test.ts`
- Modify: `functions/src/market/processBatch.ts`
- Modify: `functions/src/market/processBatch.test.ts`

**Interfaces:**
- Consumes: `publishResearchDeskProjectionWithAdminSdk(lessonRunId: string): Promise<void>` from Task 1.
- Produces: phase transition/batch settlement 後に current Research Desk projection が更新される副作用順序。

- [ ] **Step 1: phase transaction commit 前には publisher が呼ばれない failing test を追加する。** transaction failure 時 publisher call count = 0。
- [ ] **Step 2: phase transition commit 後に publisher が1回呼ばれる failing test を追加する。** idempotent replay でも安全に再投影できることを確認する。
- [ ] **Step 3: processBatch の Firestore settlement commit 後に Research Desk publisher が呼ばれる failing test を追加する。** settlement failure 時は呼ばれない。
- [ ] **Step 4: 既存 `publishRealtimeState` と Research Desk publisher の双方が1回ずつ呼ばれることを検証する。**
- [ ] **Step 5: failing tests を確認する。**

```bash
npm test --workspace=functions -- src/lessonRuns/phases/transitionPhase.test.ts src/market/processBatch.test.ts
```

- [ ] **Step 6: `TransitionPhaseDeps` に `publishResearchDeskProjection` を追加し、Firestore commit と checkpoint 処理後に呼ぶ。** production wiring は Task 1 publisher を注入する。
- [ ] **Step 7: `ProcessBatchDeps` に `publishResearchDeskProjection` を追加し、`commitSettlement` 後・RTDB market projection と同じ post-commit side-effect phase で呼ぶ。**
- [ ] **Step 8: targeted tests を PASS させる。**

```bash
npm test --workspace=functions -- src/lessonRuns/phases/transitionPhase.test.ts src/market/processBatch.test.ts
npm run typecheck --workspace=functions
```

- [ ] **Step 9: commit。**

```bash
git add functions/src/lessonRuns/phases/transitionPhase.ts functions/src/lessonRuns/phases/transitionPhase.test.ts functions/src/market/processBatch.ts functions/src/market/processBatch.test.ts
git commit -m "feat: refresh Research Desk with lesson state"
```

---

### Task 3: Team-scoped Research Note を追加する

**Files:**
- Create: `functions/src/lessonRuns/teamNotes/saveTeamNote.ts`
- Create: `functions/src/lessonRuns/teamNotes/saveTeamNote.test.ts`
- Create: `functions/src/lessonRuns/teamNotes/onCall.ts`
- Create: `functions/src/lessonRuns/teamNotes/onCall.test.ts`
- Modify: `functions/src/index.ts`
- Modify: `firestore.rules`
- Modify: `src/lib/lessonRuns/liveTypes.ts`
- Create: `src/lib/lessonRuns/teamNotes.ts`
- Create: `src/lib/lessonRuns/teamNotes.test.ts`

**Interfaces:**

```ts
export interface SaveTeamResearchNoteInput {
  lessonRunId: string
  teamId: string
  text: string
  expectedRevision: number
  idempotencyKey: string
}

export interface SaveTeamResearchNoteResult {
  revision: number
  deduplicated: boolean
}

export interface TeamResearchNoteView {
  text: string
  revision: number
  updatedAtMillis: number
}
```

- Consumes: existing `participantsByAuthUid/{uid}` and `teams/{teamId}.memberParticipantIds` identity pattern.
- Produces: `saveTeamResearchNoteCallable`, Firestore `teamNotes/{teamId}`, RTDB `researchNote`, client wrapper.

- [ ] **Step 1: pure save failing tests を作る。** initial revision 0→1、expectedRevision mismatch、same key same payload replay、same key different payload mismatch を検証する。
- [ ] **Step 2: callable authorization failing tests を作る。** unauthenticated、participant index 不在、別チーム teamId を拒否し、拒否時に note write が0件であることを検証する。
- [ ] **Step 3: success 時のみ Firestore commit 後に caller team の RTDB path を更新し、他チーム path を更新しないテストを追加する。**
- [ ] **Step 4: `text` の trim 後 0文字と 5001文字を `invalid-argument` にする failing test を追加する。** 上限は5000文字。
- [ ] **Step 5: failing tests を確認する。**

```bash
npm test --workspace=functions -- src/lessonRuns/teamNotes/saveTeamNote.test.ts src/lessonRuns/teamNotes/onCall.test.ts
```

- [ ] **Step 6: Firestore transaction を実装する。** idempotency doc、existing note、team membership に必要な reads をすべて write 前に完了する。
- [ ] **Step 7: callable で auth uid→participantId→team membership を解決する。** participantId は request field にしない。
- [ ] **Step 8: transaction commit 後に `lessonRunTeamState/{runId}/{teamId}/researchNote` を `update()` する。**
- [ ] **Step 9: `firestore.rules` に `lessonRuns/{id}/teamNotes/{teamId}` の direct client read/write deny を明示する。**
- [ ] **Step 10: `functions/src/index.ts` から `saveTeamResearchNoteCallable` を export する。**
- [ ] **Step 11: client wrapper と live type を追加する。**
- [ ] **Step 12: targeted tests + rules を PASS させる。**

```bash
npm test --workspace=functions -- src/lessonRuns/teamNotes/saveTeamNote.test.ts src/lessonRuns/teamNotes/onCall.test.ts
npm test -- src/lib/lessonRuns/teamNotes.test.ts
npm run test:rules
npm run typecheck
```

- [ ] **Step 13: commit。**

```bash
git add functions/src/lessonRuns/teamNotes functions/src/index.ts firestore.rules src/lib/lessonRuns/liveTypes.ts src/lib/lessonRuns/teamNotes.ts src/lib/lessonRuns/teamNotes.test.ts
git commit -m "feat: add team Research Desk notes"
```

---

### Task 4: 注文 API を Research Desk 用に server-authoritative 化する

**Files:**
- Modify: `functions/src/market/onCall.ts`
- Modify: `functions/src/market/onCall.test.ts`
- Modify: `src/lib/market/submitOrder.ts`
- Modify: `src/lib/market/submitOrder.test.ts`

**Interfaces:**

```ts
export interface SubmitOrderInput {
  lessonRunId: string
  teamId: string
  stockId: string
  side: 'BUY' | 'SELL'
  quantity: number
  idempotencyKey: string
}
```

- Consumes: `lessonRuns/{lessonRunId}.nextBatchId`, `currentPhaseId`, `templateSnapshot.phases`, `stocks/{stockId}.currentPrice`.
- Produces: existing `submitOrderCallable` with server-derived batchId/referencePrice; result shape remains `{ orderId, created }`.

- [ ] **Step 1: request から `batchId` / `referencePrice` を削除した client/server type failing tests を書く。**
- [ ] **Step 2: RUNNING でも current phase が MARKET でない場合に `failed-precondition` となり `createPendingOrder` が呼ばれないテストを追加する。**
- [ ] **Step 3: `marketPaused === true`、`nextBatchId` 不在、stock 不在をそれぞれ拒否するテストを追加する。**
- [ ] **Step 4: client が価格を指定できず、stored `currentPrice` が soft lock と persisted order の referencePrice に使われるテストを追加する。**
- [ ] **Step 5: stored `nextBatchId` が createOrder の batchId に使われるテストを追加する。**
- [ ] **Step 6: failing tests を確認する。**

```bash
npm test --workspace=functions -- src/market/onCall.test.ts
npm test -- src/lib/market/submitOrder.test.ts
```

- [ ] **Step 7: callable の validation を新 input shape へ変更する。**
- [ ] **Step 8: participant/team membership 検証後、run と current phase を検証し、stock currentPrice と nextBatchId を server-side で解決する。**
- [ ] **Step 9: existing `submitOrder()` pure layer へ server-resolved 値を渡す。** pure settlement logic は変更しない。
- [ ] **Step 10: client wrapper を同じ public input shape へ変更する。**
- [ ] **Step 11: targeted tests と typecheck を PASS させる。**

```bash
npm test --workspace=functions -- src/market/onCall.test.ts
npm test -- src/lib/market/submitOrder.test.ts
npm run typecheck
```

- [ ] **Step 12: commit。**

```bash
git add functions/src/market/onCall.ts functions/src/market/onCall.test.ts src/lib/market/submitOrder.ts src/lib/market/submitOrder.test.ts
git commit -m "fix: make student order context server authoritative"
```

---

### Task 5: 5つの student Research Desk screen を実装する

**Files:**
- Create: `src/components/student/ResearchDeskPage.tsx`
- Create: `src/components/student/ResearchDeskPage.test.tsx`
- Create: `src/components/student/CompanyResearchPage.tsx`
- Create: `src/components/student/CompanyResearchPage.test.tsx`
- Create: `src/components/student/NewsListPage.tsx`
- Create: `src/components/student/NewsListPage.test.tsx`
- Create: `src/components/student/StatisticsMaterialsPage.tsx`
- Create: `src/components/student/StatisticsMaterialsPage.test.tsx`
- Create: `src/components/student/TeamNotesPage.tsx`
- Create: `src/components/student/TeamNotesPage.test.tsx`
- Create: `src/components/student/OrderScreen.tsx`
- Create: `src/components/student/OrderScreen.test.tsx`

**Interfaces:**
- Consumes: `ResearchDeskPublicView`, `LessonRunTeamState`, `saveTeamResearchNote()`, `submitOrder()`.
- Produces: one workspace that renders only `availablePanels` and never derives hidden capabilities locally.

- [ ] **Step 1: `ResearchDeskPage` failing tests を作る。** `availablePanels=[]` でパネルなし、INFORMATION capability で3画面、MARKET capability で5画面が選択可能になることを検証する。
- [ ] **Step 2: Company page tests。** public view の name/symbol/industry/description/products/risk と tier-dependent optional fields のみ表示する。
- [ ] **Step 3: News list tests。** source/category/nature/confidence/body/target company を表示し、渡されていない未来 item を推測表示しない。
- [ ] **Step 4: Statistics page tests。** label/kind と存在する場合だけ value/changeFromPrevious を表示する。
- [ ] **Step 5: TeamNotes page tests。** debounce ではなく明示保存、saving disable、revision conflict で local text を保持し警告を表示する。
- [ ] **Step 6: OrderScreen tests。** public stock price、cash/holdings/locks を表示し、paused または required state 不足では submit disabled、送信 input に batchId/referencePrice が存在しないことを検証する。
- [ ] **Step 7: failing tests を確認する。**

```bash
npm test -- src/components/student/ResearchDeskPage.test.tsx src/components/student/CompanyResearchPage.test.tsx src/components/student/NewsListPage.test.tsx src/components/student/StatisticsMaterialsPage.test.tsx src/components/student/TeamNotesPage.test.tsx src/components/student/OrderScreen.test.tsx
```

- [ ] **Step 8: 5画面を最小実装する。** MUI の既存 touch target / typography convention を使い、新しい design system は作らない。
- [ ] **Step 9: ResearchDeskPage が `availablePanels` のみから navigation を作るよう実装する。** phase type を client で再マップしない。
- [ ] **Step 10: order submit 中は同じ logical request の idempotencyKey を保持し、完了後に次の操作用 key を生成する。**
- [ ] **Step 11: targeted tests を PASS させる。**

```bash
npm test -- src/components/student/ResearchDeskPage.test.tsx src/components/student/CompanyResearchPage.test.tsx src/components/student/NewsListPage.test.tsx src/components/student/StatisticsMaterialsPage.test.tsx src/components/student/TeamNotesPage.test.tsx src/components/student/OrderScreen.test.tsx
npm run typecheck
```

- [ ] **Step 12: commit。**

```bash
git add src/components/student/ResearchDeskPage.tsx src/components/student/ResearchDeskPage.test.tsx src/components/student/CompanyResearchPage.tsx src/components/student/CompanyResearchPage.test.tsx src/components/student/NewsListPage.tsx src/components/student/NewsListPage.test.tsx src/components/student/StatisticsMaterialsPage.tsx src/components/student/StatisticsMaterialsPage.test.tsx src/components/student/TeamNotesPage.tsx src/components/student/TeamNotesPage.test.tsx src/components/student/OrderScreen.tsx src/components/student/OrderScreen.test.tsx
git commit -m "feat: add student Research Desk screens"
```

---

### Task 6: `/lessons/:runId/play` を realtime state へ結線する

**Files:**
- Create: `src/lib/lessonRuns/researchDeskRealtime.ts`
- Create: `src/lib/lessonRuns/researchDeskRealtime.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: existing `useStudentLessonAccess()` result `teamId`, RTDB `lessonRunPublic` / `lessonRunTeamState`.
- Produces: `/lessons/:runId/play` → `ResearchDeskPage` realtime container.

- [ ] **Step 1: public/team subscription wrapper failing tests を書く。** exact RTDB paths、unsubscribe、null snapshot を検証する。
- [ ] **Step 2: App route failing test を書く。** access GRANTED 後に `DeferredDataNotice` ではなく Research Desk が表示されることを確認する。
- [ ] **Step 3: waiting/results routes はこの task で Research Desk に置換されないことを固定する test を追加する。**
- [ ] **Step 4: public state のみ到着時は read-only panels を描画でき、team state 未到着時は team note/order controls disabled になる test を追加する。**
- [ ] **Step 5: failing tests を確認する。**

```bash
npm test -- src/lib/lessonRuns/researchDeskRealtime.test.ts src/App.test.tsx
```

- [ ] **Step 6: `researchDeskRealtime.ts` を実装する。** subscriptions は caller が unsubscribe できる API にする。
- [ ] **Step 7: `StudentLessonRoute` を play route 用 container と waiting/results placeholder に分ける。** existing membership guard は変更しない。
- [ ] **Step 8: `teamId` は guard が server-written membership mirror から得た値だけを使用する。** URL/query parameter から受け取らない。
- [ ] **Step 9: tests/typecheck を PASS させる。**

```bash
npm test -- src/lib/lessonRuns/researchDeskRealtime.test.ts src/App.test.tsx
npm run typecheck
```

- [ ] **Step 10: commit。**

```bash
git add src/lib/lessonRuns/researchDeskRealtime.ts src/lib/lessonRuns/researchDeskRealtime.test.ts src/App.tsx src/App.test.tsx
git commit -m "feat: wire Research Desk student route"
```

---

### Task 7: Security regression・Rules・backlog 統合検証

**Files:**
- Modify: `database.rules.test.ts` or the repository's existing RTDB rules test file that asserts `lessonRunPublic` / `lessonRunTeamState` isolation.
- Modify: `firestore.rules.test.ts` or the repository's existing Firestore rules test file for `lessonRuns` subcollections.
- Modify: `docs/superpowers/scope-backlog.md`

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: Phase 2 Research Desk acceptance evidence and backlog completion mark.

- [ ] **Step 1: RTDB emulator test を追加する。** participant A が自 team state note を読めるが team B note は読めない。
- [ ] **Step 2: future information leak regression を server projection test でもう一度固定する。** authoring object 全体を spread してもテストが通らない形にする。
- [ ] **Step 3: Firestore emulator test で student/client が `teamNotes` を直接 read/write できないことを固定する。**
- [ ] **Step 4: Callable direct invocation test で MARKET 以外の order が0 write で拒否されることを確認する。**
- [ ] **Step 5: full verification を実行する。**

```bash
npm run verify
```

Expected: exit code 0。1件でも failure があれば backlog を更新しない。

- [ ] **Step 6: PASS 後のみ `docs/superpowers/scope-backlog.md` の Phase 2 Research Desk を実装済みに更新する。**
- [ ] **Step 7: backlog だけを commit する。**

```bash
git add docs/superpowers/scope-backlog.md
git commit -m "docs: mark Research Desk implemented"
```

- [ ] **Step 8: backlog commit 後に full verification を再実行する。**

```bash
npm run verify
```

- [ ] **Step 9: branch と working tree を確認する。**

```bash
git status --short
git branch --show-current
git log -7 --oneline
```

Expected: branch = `codex/classroom`、意図しない変更なし。

- [ ] **Step 10: remote へ push し、local commit で停止しない。**

```bash
git push origin codex/classroom
```

## Agent Assignment

- Task 1: **Codex** — security-critical public projection と既存 public-content package の整合。
- Task 2: **Claude Code** — phase/batch side-effect ordering と既存 DI test の更新。
- Task 3: **Codex** — team scope、idempotency、Firestore→RTDB ordering。
- Task 4: **Claude Code** — order authorization/state hardening。
- Task 5: **Antigravity** — student React UI 5画面。
- Task 6: **Antigravity** — route/subscription integration。
- Task 7: **Codex** — security regression と全体検証。

Task 3 と Task 4 は Task 1 完了を待たず並行可能。Task 5 は Task 1/3/4 の public interfaces が確定後、Task 6 は Task 5 後。Phase 6 の VERIFIED/OFFICIAL 実装計画とは依存関係がなく、別 agent group で同時実行可能。
