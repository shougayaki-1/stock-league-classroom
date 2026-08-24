# UI Presentation Boundary Project B — Student Market / Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove backend enum tokens, opaque IDs, revision terminology, and raw backend errors from the student market/research experience while preserving the existing market/research data contracts and introducing a stable semantic conflict contract for Team Notes.

**Architecture:** Project B consumes Project A's fail-closed presentation layer (`marketLabels.ts`, `userFacingError.ts`) at the React render/error boundary instead of duplicating local label dictionaries or echoing transport values. Market/research DTOs remain semantic transport data. Team Notes is the one server-contract exception: revision conflicts become a typed domain error, a stable Callable `aborted` error code, and a client-side semantic mapper so the UI never branches on `Error.message`.

**Tech Stack:** React 19, TypeScript, Material UI, Firebase Functions v2, Firebase Web SDK, Vitest, Testing Library, oxlint.

**Spec:** `docs/superpowers/specs/2026-08-24-ui-presentation-boundary-design.md`

## Global Constraints

- Project B depends on Project A. Do not start implementation until `src/lib/presentation/marketLabels.ts` and `src/lib/presentation/userFacingError.ts` exist on the implementation base branch and Project A has been merged/reviewed.
- Do not recreate or fork Project A's label dictionaries inside student components.
- Student UI must not display opaque runtime/database identifiers, backend enum tokens, revision numbers, raw `Error.message`, idempotency terminology, or implementation-specific backend strings.
- Stock ticker/symbol values remain valid public identifiers and may stay visible.
- Author-entered/public content such as company names, industries, descriptions, products/services, risk factors, news source/body, and economic-indicator `label` remain presentation values and must not be translated as internal enums.
- Unknown/missing transport values must fail closed; never use `LABELS[value] ?? value` or another raw-value fallback in render paths.
- Never use `label ?? internalId` as student-facing copy.
- Never use `error instanceof Error ? error.message : fallback` for student-facing copy.
- Never branch on `error.message`, `message.includes(...)`, or another backend-message literal in user-facing control flow.
- Keep internal IDs/enums for React keys, component state, select values, API payloads, and domain logic where they are not rendered as copy.
- Preserve the existing market/research public DTOs. Project B must not add new market/research projection fields or introduce N+1 lookups for labels.
- Team Notes keeps `revision` internally for optimistic concurrency and request payloads, but does not render it to students.
- Team Notes conflict copy is exactly: `他のメンバーが先に更新しました。最新の内容を確認してもう一度保存してください。`
- Team Notes reset action is exactly: `最新の内容に戻す`.
- The Project B negative invariant is: injecting an unknown enum/status, missing human label, raw backend error, or opaque sentinel ID into a student-facing fixture must never make that raw value appear verbatim in rendered student UI.
- Do not change home-economics, teacher lesson runtime/interventions, template/admin, organization, billing, or operator UI in Project B.

## File Structure

Project B modifies existing files only. Do not add a new presentation barrel file.

### Student market/research presentation consumers

- `src/components/student/CompanyResearchPage.tsx` — consume Project A company-size/growth/financial-strength formatters.
- `src/components/student/CompanyResearchPage.test.tsx` — reverse the existing `STRONG` leakage assertion and add unknown-token negative coverage.
- `src/components/student/NewsListPage.tsx` — consume Project A information category/nature/confidence formatters.
- `src/components/student/NewsListPage.test.tsx` — assert known labels and unknown-token/non-resolved-ID non-leakage.
- `src/components/student/StatisticsMaterialsPage.tsx` — consume Project A economic-indicator formatter while preserving authored `label`.
- `src/components/student/StatisticsMaterialsPage.test.tsx` — assert common formatter copy and unknown-token non-leakage.
- `src/components/student/ResearchDeskPage.tsx` — consume Project A panel formatter and provide safe unsupported-panel content.
- `src/components/student/ResearchDeskPage.test.tsx` — assert unknown panel IDs are never rendered as labels.
- `src/components/student/OrderScreen.tsx` — consume Project A order side/status formatters, remove BUY/SELL token copy, remove stock-ID fallback, and map errors through the common user-facing error helper.
- `src/components/student/OrderScreen.test.tsx` — add enum/stock-ID/raw-error negative coverage.

### Team Notes semantic error boundary

- `functions/src/lessonRuns/teamNotes/saveTeamNote.ts` — emit a typed revision-conflict error instead of the string literal `Revision mismatch`.
- `functions/src/lessonRuns/teamNotes/saveTeamNote.test.ts` — assert the typed conflict error contract.
- `functions/src/lessonRuns/teamNotes/onCall.ts` — translate the typed revision conflict to `HttpsError('aborted', ...)`; stop parsing `Revision mismatch`.
- `functions/src/lessonRuns/teamNotes/onCall.test.ts` — assert the stable Callable error code.
- `src/lib/lessonRuns/teamNotes.ts` — add a client semantic mapper from `functions/aborted` to `REVISION_CONFLICT`.
- `src/lib/lessonRuns/teamNotes.test.ts` — assert code-only classification and prove `Revision mismatch` message text is ignored.
- `src/components/student/TeamNotesPage.tsx` — hide revision, use the semantic mapper, use Project A common error copy, and rename the reset action.
- `src/components/student/TeamNotesPage.test.tsx` — encode the new conflict/error/presentation contract.

---

### Task 1: Move company research metadata behind Project A formatters

**Files:**
- Modify: `src/components/student/CompanyResearchPage.test.tsx`
- Modify: `src/components/student/CompanyResearchPage.tsx`

**Interfaces:**
- Consumes: `formatCompanySize(value)`, `formatCompanyGrowthProfile(value)`, `formatCompanyFinancialStrength(value)` from `src/lib/presentation/marketLabels.ts`.
- Produces: company research UI that never renders `sizeClass`, `growthProfile`, or `financialStrength` transport tokens directly.

- [ ] **Step 1: Rewrite the existing leakage assertion and add fail-closed coverage**

In `src/components/student/CompanyResearchPage.test.tsx`, change the normal-detail test so it asserts human labels and explicitly rejects transport tokens:

```tsx
expect(screen.getByText('大型株')).toBeInTheDocument()
expect(screen.getByText('成長型')).toBeInTheDocument()
expect(screen.getByText('強い')).toBeInTheDocument()
expect(screen.queryByText('LARGE')).not.toBeInTheDocument()
expect(screen.queryByText('GROWTH')).not.toBeInTheDocument()
expect(screen.queryByText('STRONG')).not.toBeInTheDocument()
```

Add a separate test using one deliberately malformed public view:

```tsx
it('never echoes unknown company metadata tokens', () => {
  const raw = 'UNKNOWN_INTERNAL_TOKEN'
  const company: CompanyPublicView = {
    ...companies[0],
    id: 'comp-unknown',
    sizeClass: raw as never,
    growthProfile: raw as never,
    financialStrength: raw as never,
  }

  render(<CompanyResearchPage companies={[company]} />)

  expect(screen.getByText('企業規模を確認できません')).toBeInTheDocument()
  expect(screen.getByText('成長特性を確認できません')).toBeInTheDocument()
  expect(screen.getByText('財務状態を確認できません')).toBeInTheDocument()
  expect(screen.queryByText(raw)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run the component test and verify RED**

Run:

```bash
npm test -- src/components/student/CompanyResearchPage.test.tsx
```

Expected: FAIL because the current component renders raw `GROWTH` / `STRONG` and uses `SIZE_LABELS[value] ?? value`.

- [ ] **Step 3: Replace the local dictionary/direct enum rendering with shared formatters**

Delete the local `SIZE_LABELS` constant. Add:

```ts
import {
  formatCompanyFinancialStrength,
  formatCompanyGrowthProfile,
  formatCompanySize,
} from '../../lib/presentation/marketLabels'
```

Replace the three metadata chips with:

```tsx
<Chip
  label={formatCompanySize(selectedCompany.sizeClass)}
  size="small"
  variant="outlined"
/>
{selectedCompany.growthProfile && (
  <Chip
    label={formatCompanyGrowthProfile(selectedCompany.growthProfile)}
    size="small"
    color="primary"
    variant="outlined"
  />
)}
{selectedCompany.financialStrength && (
  <Chip
    label={formatCompanyFinancialStrength(selectedCompany.financialStrength)}
    size="small"
    color="secondary"
    variant="outlined"
  />
)}
```

Do not transform `company.industry`, `description`, `productsAndServices`, `costDrivers`, or `riskFactors`; those are authored/public content.

- [ ] **Step 4: Run the component test and verify GREEN**

Run:

```bash
npm test -- src/components/student/CompanyResearchPage.test.tsx
```

Expected: PASS, including the raw-token negative assertions.

- [ ] **Step 5: Commit**

```bash
git add src/components/student/CompanyResearchPage.tsx src/components/student/CompanyResearchPage.test.tsx
git commit -m "fix: humanize company research metadata"
```

---

### Task 2: Move news metadata behind Project A formatters

**Files:**
- Modify: `src/components/student/NewsListPage.test.tsx`
- Modify: `src/components/student/NewsListPage.tsx`

**Interfaces:**
- Consumes: `formatInformationCategory(value)`, `formatInformationNature(value)`, `formatInformationConfidence(value)` from `src/lib/presentation/marketLabels.ts`.
- Produces: news cards with human metadata labels and no raw category/nature/confidence echo.

- [ ] **Step 1: Strengthen the NewsListPage tests**

In the existing normal rendering test add:

```tsx
expect(screen.getByText('公式発表')).toBeInTheDocument()
expect(screen.getByText('事実')).toBeInTheDocument()
expect(screen.getByText('確度: 高')).toBeInTheDocument()
expect(screen.queryByText('OFFICIAL_NEWS')).not.toBeInTheDocument()
expect(screen.queryByText('FACT')).not.toBeInTheDocument()
expect(screen.queryByText('HIGH')).not.toBeInTheDocument()
```

Add an unknown-value test. The unresolved company ID is deliberate: the current `companyMap` filtering behavior is safe and should remain silent rather than falling back to the ID.

```tsx
it('fails closed for unknown metadata and unresolved target-company ids', () => {
  const raw = 'UNKNOWN_INTERNAL_TOKEN'
  const opaqueCompanyId = 'opaque-company-id'
  const item: InformationPublicView = {
    ...news[0],
    id: 'news-unknown',
    category: raw as never,
    natureType: raw as never,
    confidenceLevel: raw as never,
    targetCompanyIds: [opaqueCompanyId],
  }

  render(<NewsListPage informationItems={[item]} companies={[]} />)

  expect(screen.getByText('ニュース種別を確認できません')).toBeInTheDocument()
  expect(screen.getByText('情報の性質を確認できません')).toBeInTheDocument()
  expect(screen.getByText('確度を確認できません')).toBeInTheDocument()
  expect(screen.queryByText(raw)).not.toBeInTheDocument()
  expect(screen.queryByText(opaqueCompanyId)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run the NewsListPage test and verify RED**

Run:

```bash
npm test -- src/components/student/NewsListPage.test.tsx
```

Expected: FAIL because the existing local dictionaries fall back to the raw transport values.

- [ ] **Step 3: Remove the three local dictionaries and use Project A formatters**

Add:

```ts
import {
  formatInformationCategory,
  formatInformationConfidence,
  formatInformationNature,
} from '../../lib/presentation/marketLabels'
```

Delete `CATEGORY_LABELS`, `NATURE_LABELS`, and `CONFIDENCE_LABELS`. Replace chip labels with:

```tsx
<Chip
  label={formatInformationCategory(item.category)}
  size="small"
  color="primary"
  variant="outlined"
/>
<Chip
  label={formatInformationNature(item.natureType)}
  size="small"
  variant="outlined"
/>
<Chip
  label={formatInformationConfidence(item.confidenceLevel)}
  size="small"
  color={item.confidenceLevel === 'HIGH' ? 'success' : 'default'}
/>
```

Keep `item.source`, `item.body`, and resolved company `name (symbol)` unchanged. Do not replace an unresolved `targetCompanyId` with the ID.

- [ ] **Step 4: Run the NewsListPage test and verify GREEN**

Run:

```bash
npm test -- src/components/student/NewsListPage.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/student/NewsListPage.tsx src/components/student/NewsListPage.test.tsx
git commit -m "fix: humanize news metadata"
```

---

### Task 3: Use the shared economic-indicator vocabulary

**Files:**
- Modify: `src/components/student/StatisticsMaterialsPage.test.tsx`
- Modify: `src/components/student/StatisticsMaterialsPage.tsx`

**Interfaces:**
- Consumes: `formatEconomicIndicatorKind(value)` from `src/lib/presentation/marketLabels.ts`.
- Produces: statistics cards whose `kind` is presentation-safe while the authored/public `label` remains untouched.

- [ ] **Step 1: Update tests to match the Project A shared vocabulary**

The approved Project A vocabulary maps `FX -> 為替` and `INTEREST_RATE -> 金利`. Extend the existing test:

```tsx
expect(screen.getByText('為替')).toBeInTheDocument()
expect(screen.getByText('金利')).toBeInTheDocument()
expect(screen.queryByText('FX')).not.toBeInTheDocument()
expect(screen.queryByText('INTEREST_RATE')).not.toBeInTheDocument()
```

Add:

```tsx
it('never echoes an unknown economic-indicator kind', () => {
  const raw = 'UNKNOWN_INTERNAL_TOKEN'
  const item: EconomicIndicatorPublicView = {
    ...indicators[0],
    id: 'ind-unknown',
    kind: raw as never,
    label: '教材作者が付けた指標名',
  }

  render(<StatisticsMaterialsPage economicIndicators={[item]} />)

  expect(screen.getByText('統計種別を確認できません')).toBeInTheDocument()
  expect(screen.getByText('教材作者が付けた指標名')).toBeInTheDocument()
  expect(screen.queryByText(raw)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run the statistics test and verify RED**

Run:

```bash
npm test -- src/components/student/StatisticsMaterialsPage.test.tsx
```

Expected: FAIL because the current local map renders `為替相場` rather than the shared `為替`, and it has a raw-value fallback.

- [ ] **Step 3: Replace `KIND_LABELS` with the shared formatter**

Add:

```ts
import { formatEconomicIndicatorKind } from '../../lib/presentation/marketLabels'
```

Delete `KIND_LABELS`. Replace:

```tsx
label={KIND_LABELS[item.kind] ?? item.kind}
```

with:

```tsx
label={formatEconomicIndicatorKind(item.kind)}
```

Do not pass `item.label` through this formatter. `item.label` is the authored/public indicator name.

- [ ] **Step 4: Run the statistics test and verify GREEN**

Run:

```bash
npm test -- src/components/student/StatisticsMaterialsPage.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/student/StatisticsMaterialsPage.tsx src/components/student/StatisticsMaterialsPage.test.tsx
git commit -m "fix: humanize economic indicator kinds"
```

---

### Task 4: Fail closed on Research Desk panel IDs

**Files:**
- Modify: `src/components/student/ResearchDeskPage.test.tsx`
- Modify: `src/components/student/ResearchDeskPage.tsx`

**Interfaces:**
- Consumes: `formatResearchDeskPanel(value)` from `src/lib/presentation/marketLabels.ts`.
- Produces: safe panel labels and a human fallback for a runtime panel value unsupported by the current client.

- [ ] **Step 1: Add an unknown-panel regression test**

Add to `ResearchDeskPage.test.tsx`:

```tsx
it('does not echo an unknown panel id', () => {
  const raw = 'UNKNOWN_INTERNAL_TOKEN'
  const publicView: ResearchDeskPublicView = {
    phaseId: 'p-runtime',
    phaseType: 'MARKET',
    availablePanels: [raw as never],
    companies: [],
    informationItems: [],
    economicIndicators: [],
    updatedAtMillis: 1000,
  }

  render(<ResearchDeskPage publicView={publicView} />)

  expect(screen.getByRole('tab', { name: '機能名を確認できません' })).toBeInTheDocument()
  expect(screen.getByText('この機能は現在利用できません。')).toBeInTheDocument()
  expect(screen.queryByText(raw)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run the ResearchDeskPage test and verify RED**

Run:

```bash
npm test -- src/components/student/ResearchDeskPage.test.tsx
```

Expected: FAIL because the current tab label is `PANEL_LABELS[panelId] ?? panelId`, and there is no unsupported-panel content.

- [ ] **Step 3: Remove the local panel dictionary and use the shared formatter**

Add:

```ts
import { formatResearchDeskPanel } from '../../lib/presentation/marketLabels'
```

Delete `PANEL_LABELS` and change the `Tab` label to:

```tsx
label={formatResearchDeskPanel(panelId)}
```

Keep `panelId` as the internal `value`, React key, and DOM control identifier; those are control-flow values, not displayed copy.

- [ ] **Step 4: Add explicit unsupported-panel content**

Immediately before the return, derive whether the active runtime value is supported:

```ts
const isKnownActivePanel =
  activePanel === 'COMPANIES' ||
  activePanel === 'NEWS' ||
  activePanel === 'STATISTICS' ||
  activePanel === 'TEAM_NOTES' ||
  activePanel === 'ORDERS'
```

After the five known panel content branches inside the tabpanel `Box`, add:

```tsx
{activePanel && !isKnownActivePanel && (
  <Alert severity="info">この機能は現在利用できません。</Alert>
)}
```

Do not cast the unknown value back to a label or interpolate it in this fallback.

- [ ] **Step 5: Run the ResearchDeskPage test and verify GREEN**

Run:

```bash
npm test -- src/components/student/ResearchDeskPage.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/student/ResearchDeskPage.tsx src/components/student/ResearchDeskPage.test.tsx
git commit -m "fix: fail closed on research desk panels"
```

---

### Task 5: Remove enum, stock-ID, and raw-error leakage from OrderScreen

**Files:**
- Modify: `src/components/student/OrderScreen.test.tsx`
- Modify: `src/components/student/OrderScreen.tsx`

**Interfaces:**
- Consumes: `formatOrderSide(value)`, `formatOrderStatus(value)` from `src/lib/presentation/marketLabels.ts`; `describeUserFacingError(error, fallback)` from `src/lib/presentation/userFacingError.ts`.
- Produces: student order entry/history that retains stock IDs and BUY/SELL values internally but renders only human labels and safe errors.

- [ ] **Step 1: Add negative tests for BUY/SELL token copy and malformed order history**

Extend the normal rendering test with:

```tsx
expect(screen.getByRole('button', { name: '買い' })).toBeInTheDocument()
expect(screen.getByRole('button', { name: '売り' })).toBeInTheDocument()
expect(screen.queryByText(/\(BUY\)|\(SELL\)/)).not.toBeInTheDocument()
```

Add a malformed history test:

```tsx
it('fails closed for unknown order metadata and unresolved stock ids', () => {
  const raw = 'UNKNOWN_INTERNAL_TOKEN'
  const opaqueStockId = 'opaque-stock-id'
  const malformedTeamState: LessonRunTeamState = {
    ...teamState,
    myOrders: [
      {
        ...teamState.myOrders[0],
        orderId: 'o-unknown',
        stockId: opaqueStockId,
        side: raw as never,
        status: raw as never,
      },
    ],
  }

  render(
    <OrderScreen
      companies={companies}
      stocks={stocks}
      teamState={malformedTeamState}
      onSubmitOrder={vi.fn()}
    />,
  )

  expect(screen.getByText('銘柄名を確認できません')).toBeInTheDocument()
  expect(screen.getByText('売買区分を確認できません')).toBeInTheDocument()
  expect(screen.getByText(/注文状態を確認できません/)).toBeInTheDocument()
  expect(screen.queryByText(raw)).not.toBeInTheDocument()
  expect(screen.queryByText(opaqueStockId)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Add a raw-error regression test**

Add:

```tsx
it('never renders a raw backend error from order submission', async () => {
  const user = userEvent.setup()
  const raw = 'INTERNAL_BACKEND_DETAIL'
  const onSubmitOrder = vi.fn().mockRejectedValue(new Error(raw))

  render(
    <OrderScreen
      companies={companies}
      stocks={stocks}
      teamState={teamState}
      onSubmitOrder={onSubmitOrder}
    />,
  )

  await user.click(screen.getByRole('button', { name: '買い注文を出す' }))

  expect(screen.getByRole('alert')).toHaveTextContent(
    '注文を送信できませんでした。もう一度お試しください。',
  )
  expect(screen.queryByText(raw)).not.toBeInTheDocument()
})
```

- [ ] **Step 3: Run the OrderScreen test and verify RED**

Run:

```bash
npm test -- src/components/student/OrderScreen.test.tsx
```

Expected: FAIL because the current component renders `(BUY)/(SELL)`, falls back to `order.stockId` and raw `order.status`, and displays `err.message`.

- [ ] **Step 4: Replace local order labels and raw error handling**

Delete the local `ORDER_STATUS_LABELS`. Add:

```ts
import {
  formatOrderSide,
  formatOrderStatus,
} from '../../lib/presentation/marketLabels'
import { describeUserFacingError } from '../../lib/presentation/userFacingError'
```

Change the submit success/error block to:

```ts
const companyLabel = selectedCompany?.name ?? '選択した銘柄'
setSuccessMsg(
  `${companyLabel} の${formatOrderSide(side)}注文（${quantity}株）を送信しました。`,
)
```

and:

```ts
} catch (err: unknown) {
  setErrorMsg(
    describeUserFacingError(
      err,
      '注文を送信できませんでした。もう一度お試しください。',
    ),
  )
}
```

The fallback must never interpolate `activeStockId` or `err.message`.

- [ ] **Step 5: Remove backend tokens from the side selector and history**

Use shared copy in the toggle buttons:

```tsx
<ToggleButton value="BUY" color="primary">
  {formatOrderSide('BUY')}
</ToggleButton>
<ToggleButton value="SELL" color="secondary">
  {formatOrderSide('SELL')}
</ToggleButton>
```

Use shared copy in the submit CTA:

```tsx
{submitting ? '注文送信中...' : `${formatOrderSide(side)}注文を出す`}
```

Replace the order-history stock, side, and status display with:

```tsx
<TableCell>
  {c ? `${c.name} (${c.symbol})` : '銘柄名を確認できません'}
</TableCell>
<TableCell>
  <Chip
    label={formatOrderSide(order.side)}
    size="small"
    color={
      order.side === 'BUY'
        ? 'primary'
        : order.side === 'SELL'
          ? 'secondary'
          : 'default'
    }
  />
</TableCell>
```

and:

```tsx
<Typography variant="body2">
  {formatOrderStatus(order.status)}
  {order.executionPrice !== undefined &&
    ` (約定価格: ${order.executionPrice.toLocaleString()}円)`}
</Typography>
```

Do not change the internal select values, submitted `stockId`, submitted `side`, holding map keys, or React keys.

- [ ] **Step 6: Run the OrderScreen test and verify GREEN**

Run:

```bash
npm test -- src/components/student/OrderScreen.test.tsx
```

Expected: PASS, including the unknown token, opaque stock ID, and raw error negative assertions.

- [ ] **Step 7: Commit**

```bash
git add src/components/student/OrderScreen.tsx src/components/student/OrderScreen.test.tsx
git commit -m "fix: enforce presentation boundary in order screen"
```

---

### Task 6: Establish a stable semantic Team Notes revision-conflict contract

**Files:**
- Modify: `functions/src/lessonRuns/teamNotes/saveTeamNote.test.ts`
- Modify: `functions/src/lessonRuns/teamNotes/saveTeamNote.ts`
- Modify: `functions/src/lessonRuns/teamNotes/onCall.test.ts`
- Modify: `functions/src/lessonRuns/teamNotes/onCall.ts`
- Modify: `src/lib/lessonRuns/teamNotes.test.ts`
- Modify: `src/lib/lessonRuns/teamNotes.ts`

**Interfaces:**
- Produces server domain error: `TeamNoteRevisionConflictError` with readonly `code: 'REVISION_CONFLICT'`.
- Produces Callable contract: a revision conflict becomes Firebase Functions error code `aborted` (observed by the web client as `functions/aborted`).
- Produces client semantic type: `SaveTeamResearchNoteErrorCode = 'REVISION_CONFLICT' | 'UNKNOWN'`.
- Produces client mapper: `mapSaveTeamResearchNoteError(error: unknown): SaveTeamResearchNoteErrorCode`.
- Consumers: Task 7 `TeamNotesPage`.

- [ ] **Step 1: Rewrite the lower-layer conflict test to specify a typed error**

Update the import in `functions/src/lessonRuns/teamNotes/saveTeamNote.test.ts`:

```ts
import {
  saveTeamNote,
  TeamNoteRevisionConflictError,
  type SaveTeamNoteDeps,
} from './saveTeamNote'
```

Replace the current `rejects.toThrow('Revision mismatch')` assertion with:

```ts
await expect(saveTeamNote(deps, {
  lessonRunId: 'run-1',
  teamId: 'team-a',
  text: 'Conflicting update',
  expectedRevision: 1,
  idempotencyKey: 'key-3',
})).rejects.toMatchObject({
  name: 'TeamNoteRevisionConflictError',
  code: 'REVISION_CONFLICT',
})

await expect(
  Promise.reject(new TeamNoteRevisionConflictError()),
).rejects.toBeInstanceOf(TeamNoteRevisionConflictError)
```

Keep the existing assertion that RTDB is not updated.

- [ ] **Step 2: Run the lower-layer test and verify RED**

Run:

```bash
npm --prefix functions test -- src/lessonRuns/teamNotes/saveTeamNote.test.ts
```

Expected: FAIL because `TeamNoteRevisionConflictError` does not exist and `saveTeamNote` still throws `Error('Revision mismatch')`.

- [ ] **Step 3: Add the typed domain error and throw it for revision mismatch**

In `functions/src/lessonRuns/teamNotes/saveTeamNote.ts`, add near the exported types:

```ts
export class TeamNoteRevisionConflictError extends Error {
  readonly code = 'REVISION_CONFLICT' as const

  constructor() {
    super('Team note revision conflict')
    this.name = 'TeamNoteRevisionConflictError'
  }
}
```

Replace only this branch:

```ts
if (currentRevision !== input.expectedRevision) {
  throw new TeamNoteRevisionConflictError()
}
```

Do not alter the persisted numeric `revision`; it remains the optimistic-concurrency mechanism and is not itself a presentation value.

- [ ] **Step 4: Run the lower-layer test and verify GREEN**

Run:

```bash
npm --prefix functions test -- src/lessonRuns/teamNotes/saveTeamNote.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add a failing Callable-boundary conflict test**

In `functions/src/lessonRuns/teamNotes/onCall.test.ts`, import the typed error:

```ts
import { TeamNoteRevisionConflictError } from './saveTeamNote'
```

Add:

```ts
it('translates a revision conflict to the stable aborted callable code', async () => {
  const saveTeamNoteFn = vi.fn().mockRejectedValue(new TeamNoteRevisionConflictError())

  try {
    await handleSaveTeamResearchNote({
      auth: { uid: 'u1' } as never,
      data: defaultRequest,
    }, {
      resolveActorParticipantId: vi.fn().mockResolvedValue('p1'),
      requireTeamMembership: vi.fn().mockResolvedValue(undefined),
      saveTeamNoteFn,
    })
    throw new Error('expected conflict')
  } catch (error) {
    expect(error).toBeInstanceOf(HttpsError)
    expect((error as HttpsError).code).toBe('aborted')
    expect((error as HttpsError).message).not.toContain('Revision mismatch')
  }
})
```

- [ ] **Step 6: Run the Callable test and verify RED**

Run:

```bash
npm --prefix functions test -- src/lessonRuns/teamNotes/onCall.test.ts
```

Expected: FAIL because `translateSaveTeamNoteError` currently recognizes `Revision mismatch` by message and emits `failed-precondition`.

- [ ] **Step 7: Translate the typed domain error to `aborted`**

Change the `saveTeamNote` import in `functions/src/lessonRuns/teamNotes/onCall.ts` to include:

```ts
TeamNoteRevisionConflictError,
```

At the start of `translateSaveTeamNoteError`, after the existing `HttpsError` pass-through, add:

```ts
if (error instanceof TeamNoteRevisionConflictError) {
  return new HttpsError(
    'aborted',
    '他のメンバーが先に更新しました。最新の内容を確認してください。',
  )
}
```

Delete this message-based branch entirely:

```ts
if (error.message === 'Revision mismatch') {
  // ...
}
```

The remaining translations for validation/idempotency errors are outside this Project B conflict-control-flow contract; do not expand this task into a broad server error refactor.

- [ ] **Step 8: Run both server Team Notes tests**

Run:

```bash
npm --prefix functions test -- \
  src/lessonRuns/teamNotes/saveTeamNote.test.ts \
  src/lessonRuns/teamNotes/onCall.test.ts
```

Expected: PASS.

- [ ] **Step 9: Add client mapper tests before implementation**

Extend `src/lib/lessonRuns/teamNotes.test.ts` imports to include the mapper after it is created. Add these tests now so they fail first:

```ts
it('maps functions/aborted to the semantic revision-conflict code', async () => {
  const { mapSaveTeamResearchNoteError } = await import('./teamNotes')

  expect(mapSaveTeamResearchNoteError({ code: 'functions/aborted' })).toBe(
    'REVISION_CONFLICT',
  )
})

it('never classifies by backend message text', async () => {
  const { mapSaveTeamResearchNoteError } = await import('./teamNotes')

  expect(mapSaveTeamResearchNoteError(new Error('Revision mismatch'))).toBe('UNKNOWN')
  expect(mapSaveTeamResearchNoteError({
    code: 'functions/internal',
    message: 'Revision mismatch',
  })).toBe('UNKNOWN')
})
```

- [ ] **Step 10: Run the client wrapper test and verify RED**

Run:

```bash
npm test -- src/lib/lessonRuns/teamNotes.test.ts
```

Expected: FAIL because `mapSaveTeamResearchNoteError` does not exist.

- [ ] **Step 11: Implement the code-only client mapper**

Add to `src/lib/lessonRuns/teamNotes.ts`:

```ts
export type SaveTeamResearchNoteErrorCode =
  | 'REVISION_CONFLICT'
  | 'UNKNOWN'

interface FunctionsLikeError {
  code?: unknown
}

export const mapSaveTeamResearchNoteError = (
  error: unknown,
): SaveTeamResearchNoteErrorCode => {
  const code = (error as FunctionsLikeError | null | undefined)?.code
  return code === 'functions/aborted' ? 'REVISION_CONFLICT' : 'UNKNOWN'
}
```

Do not inspect `message`, `details`, stack traces, or serialized backend text in this mapper. The standard Callable error code is sufficient for this callable-specific contract.

- [ ] **Step 12: Run client and server Team Notes tests**

Run:

```bash
npm test -- src/lib/lessonRuns/teamNotes.test.ts
npm --prefix functions test -- \
  src/lessonRuns/teamNotes/saveTeamNote.test.ts \
  src/lessonRuns/teamNotes/onCall.test.ts
```

Expected: PASS.

- [ ] **Step 13: Typecheck both workspaces**

Run:

```bash
npm run typecheck
npm --prefix functions run typecheck
```

Expected: PASS. If `HttpsError('aborted', ...)` does not typecheck, stop and inspect the installed Firebase Functions error-code type rather than substituting another guessed literal.

- [ ] **Step 14: Commit the semantic conflict contract**

```bash
git add \
  functions/src/lessonRuns/teamNotes/saveTeamNote.ts \
  functions/src/lessonRuns/teamNotes/saveTeamNote.test.ts \
  functions/src/lessonRuns/teamNotes/onCall.ts \
  functions/src/lessonRuns/teamNotes/onCall.test.ts \
  src/lib/lessonRuns/teamNotes.ts \
  src/lib/lessonRuns/teamNotes.test.ts
git commit -m "fix: add semantic team note conflict contract"
```

---

### Task 7: Remove revision and backend-message terminology from TeamNotesPage

**Files:**
- Modify: `src/components/student/TeamNotesPage.test.tsx`
- Modify: `src/components/student/TeamNotesPage.tsx`

**Interfaces:**
- Consumes: `mapSaveTeamResearchNoteError(error)` from Task 6; `describeUserFacingError(error, fallback)` from Project A.
- Produces: student Team Notes UI with hidden revision metadata, semantic conflict handling, safe generic errors, and the approved reset/copy language.

- [ ] **Step 1: Reverse the old message-based conflict test**

Replace the current conflict mock `new Error('Revision mismatch')` with a code-bearing Callable-like failure and assert the exact approved copy:

```tsx
it('handles revision conflict by semantic code without exposing backend details', async () => {
  const user = userEvent.setup()
  const raw = 'INTERNAL_BACKEND_DETAIL'
  const onSaveNote = vi.fn().mockRejectedValue({
    code: 'functions/aborted',
    message: raw,
  })

  render(
    <TeamNotesPage
      note={{ text: 'Initial', revision: 1, updatedAtMillis: 1000 }}
      onSaveNote={onSaveNote}
    />,
  )

  const textarea = screen.getByLabelText('チームノート')
  await user.clear(textarea)
  await user.type(textarea, 'My new text')
  await user.click(screen.getByRole('button', { name: '保存する' }))

  expect(screen.getByText(
    '他のメンバーが先に更新しました。最新の内容を確認してもう一度保存してください。',
  )).toBeInTheDocument()
  expect(textarea).toHaveValue('My new text')
  expect(screen.queryByText(raw)).not.toBeInTheDocument()
  expect(screen.queryByText(/Revision mismatch/i)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Add revision/reset/generic-error presentation tests**

Add:

```tsx
it('keeps revision internal and uses human reset copy', async () => {
  const user = userEvent.setup()
  render(
    <TeamNotesPage
      note={{ text: '最新内容', revision: 42, updatedAtMillis: 1000 }}
      onSaveNote={vi.fn()}
    />,
  )

  expect(screen.queryByText(/リビジョン/i)).not.toBeInTheDocument()
  expect(screen.queryByText(/revision/i)).not.toBeInTheDocument()

  const textarea = screen.getByLabelText('チームノート')
  await user.type(textarea, ' 編集中')
  const reset = screen.getByRole('button', { name: '最新の内容に戻す' })
  expect(reset).toBeInTheDocument()
  await user.click(reset)
  expect(textarea).toHaveValue('最新内容')
})
```

and:

```tsx
it('uses safe generic copy for an unknown save error', async () => {
  const user = userEvent.setup()
  const raw = 'INTERNAL_BACKEND_DETAIL'
  const onSaveNote = vi.fn().mockRejectedValue(new Error(raw))

  render(
    <TeamNotesPage
      note={{ text: 'Initial', revision: 1, updatedAtMillis: 1000 }}
      onSaveNote={onSaveNote}
    />,
  )

  await user.click(screen.getByRole('button', { name: '保存する' }))

  expect(screen.getByRole('alert')).toHaveTextContent(
    'ノートを保存できませんでした。もう一度お試しください。',
  )
  expect(screen.queryByText(raw)).not.toBeInTheDocument()
})
```

Keep the existing assertion that `onSaveNote` receives the numeric expected revision; the value remains an internal concurrency input.

- [ ] **Step 3: Run TeamNotesPage tests and verify RED**

Run:

```bash
npm test -- src/components/student/TeamNotesPage.test.tsx
```

Expected: FAIL because the current page renders `リビジョン`, uses message substring matching, renders unknown `err.message`, and labels the reset action `最新のサーバー内容に戻す`.

- [ ] **Step 4: Import the semantic mapper and common user-facing error helper**

Add:

```ts
import { mapSaveTeamResearchNoteError } from '../../lib/lessonRuns/teamNotes'
import { describeUserFacingError } from '../../lib/presentation/userFacingError'
```

- [ ] **Step 5: Replace message-based save failure handling**

Replace the entire `catch` body with:

```ts
} catch (err: unknown) {
  if (mapSaveTeamResearchNoteError(err) === 'REVISION_CONFLICT') {
    setErrorMsg(
      '他のメンバーが先に更新しました。最新の内容を確認してもう一度保存してください。',
    )
  } else {
    setErrorMsg(
      describeUserFacingError(
        err,
        'ノートを保存できませんでした。もう一度お試しください。',
      ),
    )
  }
}
```

There must be no `err.message`, `message.includes`, `Revision mismatch`, or backend-copy matching in this component.

- [ ] **Step 6: Hide revision and rename the reset action**

Replace:

```tsx
チーム共有ノート (リビジョン: {expectedRevision})
```

with:

```tsx
チーム共有ノート
```

The separate internal declaration `const expectedRevision = note?.revision ?? 0` may be removed if no longer referenced after the heading change; `handleSave` must continue passing `note?.revision ?? 0` to `onSaveNote`.

Replace:

```tsx
最新のサーバー内容に戻す
```

with exactly:

```tsx
最新の内容に戻す
```

- [ ] **Step 7: Run TeamNotesPage and client mapper tests**

Run:

```bash
npm test -- \
  src/components/student/TeamNotesPage.test.tsx \
  src/lib/lessonRuns/teamNotes.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/student/TeamNotesPage.tsx src/components/student/TeamNotesPage.test.tsx
git commit -m "fix: hide team note implementation details"
```

---

### Task 8: Project B integration and regression verification

**Files:**
- Inspect all files changed by Tasks 1-7.
- Do not add production files solely for this task unless a failing verification reveals a Project B regression.

**Interfaces:**
- Consumes: all Project B outputs.
- Produces: verification evidence that student market/research presentation is fail-closed and the Team Notes semantic conflict contract works end to end.

- [ ] **Step 1: Run the focused client suite**

Run:

```bash
npm test -- \
  src/components/student/CompanyResearchPage.test.tsx \
  src/components/student/NewsListPage.test.tsx \
  src/components/student/StatisticsMaterialsPage.test.tsx \
  src/components/student/ResearchDeskPage.test.tsx \
  src/components/student/OrderScreen.test.tsx \
  src/components/student/TeamNotesPage.test.tsx \
  src/lib/lessonRuns/teamNotes.test.ts \
  src/lib/presentation/marketLabels.test.ts \
  src/lib/presentation/userFacingError.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the focused Functions Team Notes suite**

Run:

```bash
npm --prefix functions test -- \
  src/lessonRuns/teamNotes/saveTeamNote.test.ts \
  src/lessonRuns/teamNotes/onCall.test.ts
```

Expected: PASS.

- [ ] **Step 3: Scan Project B render/control-flow paths for forbidden patterns**

Run:

```bash
rg -n "\?\?\s*(selectedCompany\.sizeClass|item\.category|item\.natureType|item\.confidenceLevel|item\.kind|panelId|order\.status|order\.stockId)" \
  src/components/student/CompanyResearchPage.tsx \
  src/components/student/NewsListPage.tsx \
  src/components/student/StatisticsMaterialsPage.tsx \
  src/components/student/ResearchDeskPage.tsx \
  src/components/student/OrderScreen.tsx

rg -n "err instanceof Error|error instanceof Error|\.message\.includes|Revision mismatch|最新のサーバー内容|リビジョン" \
  src/components/student/OrderScreen.tsx \
  src/components/student/TeamNotesPage.tsx \
  src/lib/lessonRuns/teamNotes.ts \
  functions/src/lessonRuns/teamNotes/onCall.ts

rg -n "\(BUY\)|\(SELL\)" src/components/student/OrderScreen.tsx
```

Expected: no matches. A non-user-facing internal use discovered by a broader scan is not automatically a failure; these targeted files should have none of the listed presentation/control-flow patterns after Project B.

- [ ] **Step 4: Verify raw tokens are absent from the changed student tests' rendered expectations**

Run:

```bash
rg -n "getByText\(['\"](LARGE|GROWTH|STRONG|OFFICIAL_NEWS|FACT|HIGH|FX|INTEREST_RATE|BUY|SELL|Revision mismatch)" \
  src/components/student/*.test.tsx
```

Expected: no positive render expectations for these backend tokens. Negative assertions are allowed.

- [ ] **Step 5: Run client lint/typecheck/full tests/build**

Run exactly:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Expected: all PASS.

- [ ] **Step 6: Run Functions verification because Project B changed Callable/server code**

Run exactly:

```bash
npm --prefix functions run verify
```

Expected: Functions lint, typecheck, tests, and build all PASS.

- [ ] **Step 7: Inspect the final diff for scope and whitespace errors**

Run:

```bash
git diff --check
git status --short
git diff --stat
git diff -- \
  src/components/student \
  src/lib/lessonRuns/teamNotes.ts \
  src/lib/lessonRuns/teamNotes.test.ts \
  functions/src/lessonRuns/teamNotes
```

Expected:
- no whitespace errors;
- only the files listed in this plan plus any pre-existing Project A files already present on the base branch;
- no home-economics, teacher lesson runtime/intervention, template/admin, organization/billing, operator, unrelated Functions, or DTO/projection changes.

- [ ] **Step 8: Produce the implementation report**

The report must state:

1. the implementation base SHA and confirm Project A was already present before Task 1;
2. commits created for Tasks 1-7;
3. exact client and Functions verification commands and their fresh results;
4. that `UNKNOWN_INTERNAL_TOKEN`, opaque stock/company IDs, and `INTERNAL_BACKEND_DETAIL` negative assertions pass;
5. that Team Notes conflict classification is `TeamNoteRevisionConflictError` -> `HttpsError('aborted')` -> `functions/aborted` -> `REVISION_CONFLICT`, with no message parsing in the UI;
6. whether any scope deviation occurred.

Do not claim Project B complete if any required verification command fails. Do not continue into Projects C-F.
