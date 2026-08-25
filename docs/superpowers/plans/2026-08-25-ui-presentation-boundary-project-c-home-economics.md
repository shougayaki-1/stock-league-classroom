# Home Economics Presentation Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every student- and teacher-facing Home Economics screen render human-readable household/profile/state vocabulary without exposing runtime household IDs, logical profile IDs, backend enum tokens, or raw backend error messages, while preserving those IDs internally for mutations, RTDB keys, React keys, and DOM identity.

**Architecture:** Preserve the existing server privacy allow-lists and enrich only the three projections where the client currently lacks semantic profile data: realtime team state, household assignment view, and teacher dashboard rows. Each enrichment carries `profileSummary: { lifeStage, family }`; Japanese copy remains client-side in Project A's `householdLabels.ts`. IDs remain wire/domain identity values but may not be used as presentation fallbacks.

**Tech Stack:** Firebase Cloud Functions v2, TypeScript 6, React 19, Vite 8, Vitest 4, Testing Library, MUI, Firebase Realtime Database/Callable Functions.

**Spec:** `docs/superpowers/specs/2026-08-24-ui-presentation-boundary-design.md`

## Global Constraints

- Baseline is `codex/classroom`; do not target `main`.
- Reuse Project A's `safeLabel`, household formatters, and `describeError`; do not create parallel presentation/error systems.
- A DTO being public/team-safe does not make its values human-readable.
- Student/teacher UI must not render runtime `householdId`, `teamId`, `profileId`, raw UID, backend enum/state token, revision/idempotency metadata, or raw `Error.message` as normal copy.
- IDs remain valid for API payloads, RTDB map keys, React keys, DOM ids, and domain/control logic when they are not rendered as text.
- Never introduce `LABELS[value] ?? value`, `label ?? internalId`, or `error instanceof Error ? error.message : fallback` in user-facing Home Economics code.
- Unknown wire values fail closed to fixed Japanese copy and never echo the input token.
- Do not add N+1 reads. Every server enrichment in this plan uses profile/template data already present at the current builder/publisher call site.
- Keep `householdId` and `profileId` unchanged in submit/update Callable payloads.
- Do not expose `internalRiskFactors`, claim/event probabilities, random seeds, or teacher-private computation logs.
- Do not broaden scope into Projects B, D, E, or F.
- Each task follows RED → verify failure → minimal implementation → verify pass → commit.
- Required regression invariant: injecting an opaque ID, unknown enum token, or backend-secret error string into a fixture must not make that exact raw value appear in rendered student/teacher UI.

---

## File Structure

- `src/lib/presentation/householdLabels.ts`: Japanese labels and composite household-profile formatter.
- `functions/src/homeEconomics/realtimeProjection.ts` + `src/lib/lessonRuns/liveTypes.ts`: server/client hand-synced team-state projection.
- `functions/src/homeEconomics/householdAssignmentRepository.ts` + `src/lib/homeEconomics/householdAssignment.ts`: server/client hand-synced assignment projection.
- `functions/src/homeEconomics/teacherDashboard.ts` + `src/lib/homeEconomics/teacherDashboard.ts`: server/client hand-synced teacher projection.
- `src/components/homeEconomics/*`: student/teacher presentational components.
- `src/components/teacher/HouseholdTeacherDashboard.tsx`: household teacher orchestration and user-facing error boundary.

---

### Task 1: Extend the household presentation vocabulary

**Files:**
- Modify: `src/lib/presentation/householdLabels.ts`
- Modify: `src/lib/presentation/householdLabels.test.ts`

**Interfaces:**
- Consumes: Project A `safeLabel()` and existing household formatters.
- Produces:
  - `formatHouseholdProfileLabel(lifeStage, family): string`
  - `formatHouseholdAssignmentState(value): string`
  - `formatHouseholdAssignmentValidationStatus(value): string`

- [ ] **Step 1: Write the failing tests**

Add these cases to `householdLabels.test.ts`:

```ts
it('formats a household profile from translated stage plus authored family text', () => {
  expect(formatHouseholdProfileLabel('CHILD_REARING', ' 配偶者・子1人 '))
    .toBe('子育て期・配偶者・子1人')
})

it('fails closed when profile semantics are entirely missing', () => {
  expect(formatHouseholdProfileLabel(undefined, undefined))
    .toBe('家庭プロフィールを確認できません')
})

it('never echoes an unknown life-stage token', () => {
  const value = formatHouseholdProfileLabel('UNKNOWN_INTERNAL_STAGE', '単身')
  expect(value).toBe('ライフステージを確認できません・単身')
  expect(value).not.toContain('UNKNOWN_INTERNAL_STAGE')
})

it('fails closed for assignment state and validation status', () => {
  expect(formatHouseholdAssignmentState('BACKEND_ONLY_STATE'))
    .toBe('割り当て状態を確認できません')
  expect(formatHouseholdAssignmentValidationStatus('RAW_VALIDATION_TOKEN'))
    .toBe('検証状況を確認できません')
})
```

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/lib/presentation/householdLabels.test.ts
```

Expected: FAIL because the new APIs do not exist.

- [ ] **Step 3: Add exact assignment types and formatters**

Use a type-only import, not a second handwritten union:

```ts
import type { HouseholdAssignmentView } from '../homeEconomics/householdAssignment'

type HouseholdAssignmentState = HouseholdAssignmentView['state']
type HouseholdAssignmentValidationStatus = HouseholdAssignmentView['validationStatus']

export const HOUSEHOLD_ASSIGNMENT_STATE_LABELS = {
  UNPREPARED: '未準備',
  DRAFT: '編集中',
  STALE: '要再確認',
  FROZEN: 'ロック済み',
} satisfies Record<HouseholdAssignmentState, string>

export const HOUSEHOLD_ASSIGNMENT_VALIDATION_STATUS_LABELS = {
  READY: '準備完了',
  INVALID: '要修正',
} satisfies Record<HouseholdAssignmentValidationStatus, string>

export const formatHouseholdProfileLabel = (
  lifeStage: string | null | undefined,
  family: string | null | undefined,
): string => {
  const familyLabel = family?.trim()
  if (!lifeStage && !familyLabel) return '家庭プロフィールを確認できません'
  const stageLabel = formatHouseholdLifeStage(lifeStage)
  return familyLabel ? `${stageLabel}・${familyLabel}` : stageLabel
}

export const formatHouseholdAssignmentState = (value: string | null | undefined): string =>
  safeLabel(value, HOUSEHOLD_ASSIGNMENT_STATE_LABELS, '割り当て状態を確認できません')

export const formatHouseholdAssignmentValidationStatus = (value: string | null | undefined): string =>
  safeLabel(value, HOUSEHOLD_ASSIGNMENT_VALIDATION_STATUS_LABELS, '検証状況を確認できません')
```

- [ ] **Step 4: Verify GREEN**

```bash
npm test -- src/lib/presentation/householdLabels.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/presentation/householdLabels.ts src/lib/presentation/householdLabels.test.ts
git commit -m "feat: add household presentation formatters"
```

---

### Task 2: Add semantic profile data to realtime household state

**Files:**
- Modify: `functions/src/homeEconomics/realtimeProjection.ts`
- Modify: `functions/src/homeEconomics/realtimeProjection.test.ts`
- Modify: `functions/src/homeEconomics/processRound.ts`
- Modify: `functions/src/homeEconomics/processRound.publishRealtimeState.test.ts`
- Modify: `src/lib/lessonRuns/liveTypes.ts`

**Interfaces:**
- Adds required `profileSummary: { lifeStage: string; family: string }` to server/client `HouseholdStateTeamView`.
- Changes `toHouseholdStateTeamView` to receive the already-resolved `HouseholdProfile` before `HouseholdState`.
- Does not remove `householdId` or any existing state needed for decisions.

- [ ] **Step 1: Write the failing projection test**

In `functions/src/homeEconomics/realtimeProjection.test.ts`, pass a profile fixture with `lifeStage: 'CHILD_REARING'`, `family: '配偶者・子1人'` and assert:

```ts
expect(view.profileSummary).toEqual({
  lifeStage: 'CHILD_REARING',
  family: '配偶者・子1人',
})
expect(JSON.stringify(view)).not.toContain('internalRiskFactors')
```

Keep all existing allow-list/privacy assertions.

- [ ] **Step 2: Verify RED**

```bash
npm test --workspace=functions -- src/homeEconomics/realtimeProjection.test.ts
```

Expected: FAIL because `profileSummary` is absent.

- [ ] **Step 3: Enrich the pure server projection**

Add to `HouseholdStateTeamView`:

```ts
profileSummary: {
  lifeStage: string
  family: string
}
```

Change the helper signature to:

```ts
export const toHouseholdStateTeamView = (
  profile: HouseholdProfile,
  household: HouseholdState,
  visibleConcepts: ConceptCategory[],
  eventDisclosures: EventDisclosureView[],
  shortfallOptions: ShortfallOption[],
): HouseholdStateTeamView => ({
  householdId: household.householdId,
  profileSummary: {
    lifeStage: profile.lifeStage,
    family: profile.family,
  },
  isFictional: true,
  cashYen: household.cashYen,
  assetHoldingsYen: { ...household.assetHoldingsYen },
  activeInsuranceContractYearsRemaining: { ...household.activeInsuranceContracts },
  activeLiabilities: Object.fromEntries(
    Object.entries(household.activeLiabilities).map(([id, state]) => [
      id,
      { remainingPrincipalYen: state.remainingPrincipalYen, remainingYears: state.remainingYears },
    ]),
  ),
  lifeStage: household.lifeStage,
  roundIndex: household.roundIndex,
  goalDelayedRounds: household.goalDelayedRounds,
  visibleConcepts,
  eventDisclosures,
  shortfallOptions,
})
```

Update `toAdvancedHouseholdTeamEntryView()` to call `toHouseholdStateTeamView(profile, household, ...)`.

- [ ] **Step 4: Add the Common publisher RED assertion**

In `processRound.publishRealtimeState.test.ts`, assert the Common team write contains:

```ts
expect(teamUpdate.household.profileSummary).toEqual({
  lifeStage: 'INDEPENDENT',
  family: '単身',
})
```

- [ ] **Step 5: Pass the profile already in memory**

In `publishRealtimeStateWithAdminSdk`, change the Common call to:

```ts
const householdView = toHouseholdStateTeamView(
  input.profile,
  newHousehold,
  visibleConcepts,
  eventDisclosures,
  shortfallOptions,
)
```

Do not add a read: `ProcessRoundDeps.publishRealtimeState` already receives `profile`, resolved from the template snapshot by `processRound()`.

- [ ] **Step 6: Hand-sync the client type**

Add the same required field to `src/lib/lessonRuns/liveTypes.ts`:

```ts
profileSummary: {
  lifeStage: string
  family: string
}
```

Keep the existing advanced entry `.profile` field unchanged for compatibility.

- [ ] **Step 7: Verify**

```bash
npm test --workspace=functions -- src/homeEconomics/realtimeProjection.test.ts src/homeEconomics/processRound.publishRealtimeState.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add functions/src/homeEconomics/realtimeProjection.ts functions/src/homeEconomics/realtimeProjection.test.ts functions/src/homeEconomics/processRound.ts functions/src/homeEconomics/processRound.publishRealtimeState.test.ts src/lib/lessonRuns/liveTypes.ts
git commit -m "feat: project household profile summaries"
```

---

### Task 3: Humanize `HouseholdSummaryCard` without changing decision values

**Files:**
- Modify: `src/components/homeEconomics/HouseholdSummaryCard.tsx`
- Modify: `src/components/homeEconomics/HouseholdSummaryCard.test.tsx`

**Interfaces:**
- Consumes Task 1 household formatters.
- `householdId` remains for DOM/input identity only.
- `profileLabel` becomes required and is the only heading source.
- Asset widgets display Japanese labels but callbacks emit original asset-type values.

- [ ] **Step 1: Write RED presentation tests**

Use a valid known-asset fixture:

```ts
const knownAssets = { DOMESTIC_STOCK: 300000, FOREIGN_STOCK: 100000 }
```

Render a SELL_ASSETS card with:

```tsx
<HouseholdSummaryCard
  householdId="runtime-secret-id"
  profileLabel="子育て期・配偶者・子1人"
  cashYen={1500000}
  lifeStage="CHILD_REARING"
  roundIndex={0}
  visibleConcepts={['ASSET_DIVERSIFICATION']}
  assetHoldingsYen={knownAssets}
  shortfallOptions={[{ type: 'SELL_ASSETS', description: '資産を売却する', resolvesYen: 100000 }]}
  shortfallResolutionValue="SELL_ASSETS"
  onShortfallResolutionAssetTypeChange={onAssetTypeChange}
/>
```

Assert:

```ts
expect(screen.getByText('ライフステージ: 子育て期')).toBeInTheDocument()
expect(screen.getByText('第1ラウンド')).toBeInTheDocument()
expect(screen.getByRole('radio', { name: '国内株式' })).toBeInTheDocument()
expect(document.body.textContent).not.toContain('DOMESTIC_STOCK')
expect(document.body.textContent).not.toContain('runtime-secret-id')
```

Click `国内株式` and assert `onAssetTypeChange` receives `DOMESTIC_STOCK`.

Add a second fixture with `UNKNOWN_BACKEND_ASSET` and assert the raw token is absent while `一部の資産種別を確認できません。` is visible.

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/components/homeEconomics/HouseholdSummaryCard.test.tsx
```

Expected: FAIL on raw life-stage/asset output and the ID fallback.

- [ ] **Step 3: Remove duplicate concept copy**

Delete local `CONCEPT_LABELS`. Render known concepts through `formatHouseholdConcept()`. If `visibleConcepts` contains any unknown value, render one generic `学習項目を確認できません` chip and never the raw value.

- [ ] **Step 4: Build a reversible asset label map**

Use the Project A map to admit only known asset types:

```ts
const isKnownAssetType = (value: string): value is keyof typeof HOUSEHOLD_ASSET_TYPE_LABELS =>
  Object.prototype.hasOwnProperty.call(HOUSEHOLD_ASSET_TYPE_LABELS, value)

const rawAssetTypes = Object.keys(assetHoldingsYen ?? {})
const knownAssetTypes = rawAssetTypes.filter(isKnownAssetType)
const hasUnknownAssetType = rawAssetTypes.some((value) => !isKnownAssetType(value))
const assetLabelByValue = new Map(
  knownAssetTypes.map((value) => [value, formatHouseholdAssetType(value)] as const),
)
const assetValueByLabel = new Map(
  knownAssetTypes.map((value) => [formatHouseholdAssetType(value), value] as const),
)
```

Feed label strings into `RankingInput` / `SingleChoiceInput`. Convert current internal values to labels before passing `value`; convert labels back through `assetValueByLabel` before calling `onAssetAllocationOrderChange` or `onShortfallResolutionAssetTypeChange`. Unknown asset types are not selectable and trigger the generic notice.

- [ ] **Step 5: Remove visible ID fallback and normalize stage/round**

Make `profileLabel: string` required and render:

```tsx
<Typography variant="h6" sx={{ fontWeight: 700 }}>{profileLabel}</Typography>
<Typography variant="body2">ライフステージ: {formatHouseholdLifeStage(lifeStage)}</Typography>
<Typography variant="body2">第{roundIndex + 1}ラウンド</Typography>
```

Keep `householdId` only inside component input ids.

- [ ] **Step 6: Verify GREEN**

```bash
npm test -- src/components/homeEconomics/HouseholdSummaryCard.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/homeEconomics/HouseholdSummaryCard.tsx src/components/homeEconomics/HouseholdSummaryCard.test.tsx
git commit -m "fix: humanize household summary presentation"
```

---

### Task 4: Remove runtime-ID and raw-error fallbacks from `HouseholdTeamScreen`

**Files:**
- Modify: `src/components/homeEconomics/HouseholdTeamScreen.tsx`
- Modify: `src/components/homeEconomics/HouseholdTeamScreen.test.tsx`

**Interfaces:**
- Consumes `formatHouseholdProfileLabel` and Project A `describeError`.
- Consumes Task 2 `profileSummary`.
- Keeps `activeHouseholdId` unchanged at the `submitHouseholdDecision` command boundary.

- [ ] **Step 1: Reverse the existing leakage tests**

For Common state, include:

```ts
profileSummary: { lifeStage: 'INDEPENDENT', family: '単身' }
```

Assert `独立期・単身` is visible and `team-a` is absent from rendered text.

For MULTI state, use valid stages and expect translated tabs:

```ts
expect(tabs.map((tab) => tab.textContent)).toEqual([
  '子育て期・配偶者・子1人',
  '独立期・独身',
  '退職後・配偶者のみ',
])
```

Keep the submit assertion that selecting the second tab sends `householdId: 'case-a'`.

Add an unknown stage `UNKNOWN_INTERNAL_STAGE` and assert `ライフステージを確認できません` is shown but the token is absent.

Configure the Callable mock to reject once with `new Error('backend-secret-message')`, submit, and assert `提出に失敗しました。` is shown while the secret text is absent.

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/components/homeEconomics/HouseholdTeamScreen.test.tsx
```

Expected: FAIL because Common/advanced fallbacks can expose IDs, stage enums are raw, and `Error.message` is shown.

- [ ] **Step 3: Extend the local subscriber subset**

Add to `HouseholdEntryStateNode`:

```ts
profileSummary?: { lifeStage: string; family: string }
```

Keep it optional so old RTDB nodes fail closed rather than crash during rollout.

- [ ] **Step 4: Replace `householdTabLabel` with semantic-only formatting**

```ts
const householdProfileLabel = (id: string): string => {
  const advancedEntry = state?.households?.[id]
  const summary = isAdvanced
    ? (advancedEntry?.state.profileSummary ?? advancedEntry?.profile ?? null)
    : (state?.household?.profileSummary ?? null)

  return formatHouseholdProfileLabel(summary?.lifeStage, summary?.family)
}
```

Never return `id`, `teamId`, `householdId`, or `profileId` from this function.

- [ ] **Step 5: Map submit failures through Project A**

```ts
.catch((error: unknown) => {
  setSubmitStatus('ERROR')
  setErrorMessage(describeError(error, '提出に失敗しました。'))
})
```

Pass `profileLabel={householdProfileLabel(activeHouseholdId)}` to `HouseholdSummaryCard`. Continue sending `householdId: activeHouseholdId` to the Callable.

- [ ] **Step 6: Verify GREEN**

```bash
npm test -- src/components/homeEconomics/HouseholdTeamScreen.test.tsx src/components/homeEconomics/HouseholdSummaryCard.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/homeEconomics/HouseholdTeamScreen.tsx src/components/homeEconomics/HouseholdTeamScreen.test.tsx
git commit -m "fix: hide household runtime details from students"
```

---

### Task 5: Enrich the assignment DTO with profile summaries

**Files:**
- Modify: `functions/src/homeEconomics/householdAssignmentRepository.ts`
- Modify: `functions/src/homeEconomics/householdAssignmentRepository.test.ts`
- Modify: `src/lib/homeEconomics/householdAssignment.ts`
- Modify: `src/lib/homeEconomics/householdAssignment.test.ts`

**Interfaces:**
- Adds `profileSummary: { lifeStage: string; family: string } | null` to every assignment entry.
- Keeps `profileId` and `householdId` unchanged as mutation/identity values.

- [ ] **Step 1: Write RED repository tests**

For a known profile, assert:

```ts
expect(view.teams[0].entries[0]).toMatchObject({
  profileId: 'profile-1',
  profileSummary: { lifeStage: 'INDEPENDENT', family: '単身' },
})
```

For an entry whose `profileId` is absent from `profiles`, assert `profileSummary` is exactly `null`.

- [ ] **Step 2: Verify RED**

```bash
npm test --workspace=functions -- src/homeEconomics/householdAssignmentRepository.test.ts
```

Expected: FAIL because the entry view lacks `profileSummary`.

- [ ] **Step 3: Project summaries from `profiles` already passed to the builder**

Change `buildTeamsView` to accept `profiles: HouseholdProfile[]` and build one lookup map:

```ts
const profileById = new Map(profiles.map((profile) => [profile.householdId, profile] as const))
```

When pushing an entry, add:

```ts
const profile = profileById.get(entry.profileId)
const profileSummary = profile
  ? { lifeStage: profile.lifeStage, family: profile.family }
  : null
```

Return `profileSummary` alongside the existing `householdId`, `profileId`, `displayOrder`, and `assignmentSource`. Change `buildHouseholdAssignmentView()` to call `buildTeamsView(input.entries, input.teamDisplayNames, input.profiles)`.

Do not add a database read: `buildHouseholdAssignmentView` already receives `profiles`.

- [ ] **Step 4: Hand-sync the client DTO**

Add:

```ts
profileSummary: {
  lifeStage: string
  family: string
} | null
```

to each entry in `src/lib/homeEconomics/householdAssignment.ts`, then update `householdAssignment.test.ts` response fixtures/assertions.

- [ ] **Step 5: Verify**

```bash
npm test --workspace=functions -- src/homeEconomics/householdAssignmentRepository.test.ts
npm test -- src/lib/homeEconomics/householdAssignment.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/src/homeEconomics/householdAssignmentRepository.ts functions/src/homeEconomics/householdAssignmentRepository.test.ts src/lib/homeEconomics/householdAssignment.ts src/lib/homeEconomics/householdAssignment.test.ts
git commit -m "feat: enrich household assignment profiles"
```

---

### Task 6: Replace assignment profile IDs with semantic labels in the UI

**Files:**
- Modify: `src/components/homeEconomics/HouseholdAssignmentPanel.tsx`
- Modify: `src/components/homeEconomics/HouseholdAssignmentPanel.test.tsx`

**Interfaces:**
- Consumes Task 1 assignment/profile/course formatters and Task 5 `profileSummary`.
- Keeps `profileId` as `<option value>` / update payload and `householdId` as update identity.

- [ ] **Step 1: Update fixtures and write RED no-ID assertions**

Every assignment entry fixture gains a summary, for example:

```ts
{
  householdId: 'h-a',
  profileId: 'profile-1',
  profileSummary: { lifeStage: 'INDEPENDENT', family: '単身' },
  displayOrder: 0,
  assignmentSource: 'AUTO',
}
```

Assert:
- editable options show `独立期・単身` / `子育て期・配偶者・子1人`;
- frozen/read-only rows show the same labels;
- MULTI move controls use human labels in their accessible names;
- unused-profile warning shows `未使用のプロフィール: 子育て期・配偶者・子1人`;
- `profile-1` and `profile-2` are absent from rendered text.

Keep the existing save contract assertion:

```ts
expect(onUpdate).toHaveBeenCalledWith({
  expectedRevision: 1,
  changes: [{ householdId: 'h-a', profileId: 'profile-2' }],
})
```

Add one entry with `profileSummary: null` and assert `家庭プロフィールを確認できません` is shown while its `profileId` is absent.

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/components/homeEconomics/HouseholdAssignmentPanel.test.tsx
```

Expected: FAIL because the current component renders `profileId` in options/read-only rows/warnings/control names.

- [ ] **Step 3: Replace `knownProfileIds` with an internal summary map**

```ts
const knownProfiles = useMemo(() => {
  const map = new Map<string, HouseholdAssignmentView['teams'][number]['entries'][number]['profileSummary']>()
  for (const team of assignment.teams) {
    for (const entry of team.entries) {
      if (!map.has(entry.profileId)) map.set(entry.profileId, entry.profileSummary)
    }
  }
  return map
}, [assignment])

const profileLabel = (profileId: string): string => {
  const summary = knownProfiles.get(profileId) ?? null
  return formatHouseholdProfileLabel(summary?.lifeStage, summary?.family)
}
```

The helper must never return `profileId`.

- [ ] **Step 4: Humanize every assignment display branch**

Use `profileLabel(profileId)` for `<option>` text, frozen/read-only text, MULTI rows, up/down accessible names, and the unused-profile warning. Use `formatHouseholdCourseFormat`, `formatHouseholdAssignmentState`, and `formatHouseholdAssignmentValidationStatus` instead of local/raw token rendering. Preserve raw IDs only in `value`, keys, local draft state, and update payloads.

- [ ] **Step 5: Verify GREEN**

```bash
npm test -- src/components/homeEconomics/HouseholdAssignmentPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/homeEconomics/HouseholdAssignmentPanel.tsx src/components/homeEconomics/HouseholdAssignmentPanel.test.tsx
git commit -m "fix: humanize household assignment controls"
```

---

### Task 7: Replace teacher-dashboard server display strings with semantic data

**Files:**
- Modify: `functions/src/homeEconomics/teacherDashboard.ts`
- Modify: `functions/src/homeEconomics/teacherDashboard.test.ts`
- Modify: `src/lib/homeEconomics/teacherDashboard.ts`

**Interfaces:**
- Replaces `HouseholdTeacherRow.profileLabel` with `profileSummary: { lifeStage: string; family: string } | null`.
- `normalizeTeamDisplayName` fails closed to `チーム名を確認できません`.
- `BULK_SETTLEMENT_FAILED` warning copy never forwards `bulkItemStatus.errorMessage`.

- [ ] **Step 1: Rewrite the server tests as RED tests**

Change the profile-label test to:

```ts
expect(row.profileSummary).toEqual({
  lifeStage: 'INDEPENDENT',
  family: '単身',
})
```

For unresolved `state.profileId`, assert `row.profileSummary` is `null`.

Change `normalizeTeamDisplayName` fallback tests to:

```ts
expect(normalizeTeamDisplayName('team-secret-id', {})).toBe('チーム名を確認できません')
expect(normalizeTeamDisplayName('team-secret-id', {})).not.toContain('team-secret-id')
```

For bulk failure, pass:

```ts
bulkItemStatus: {
  status: 'FAILED',
  errorCode: 'INTERNAL_FAILURE',
  errorMessage: 'backend-secret-message',
}
```

and assert the matching warning message is exactly:

```ts
'一括決算で処理できない家庭があります。再実行してください。'
```

and does not contain `backend-secret-message`.

- [ ] **Step 2: Verify RED**

```bash
npm test --workspace=functions -- src/homeEconomics/teacherDashboard.test.ts
```

Expected: FAIL on server-composed `profileLabel`, ID team fallback, and raw bulk error forwarding.

- [ ] **Step 3: Project profile semantics, not Japanese copy**

Replace the current server composition with:

```ts
const authoredProfile = content.households.find((profile) => profile.householdId === state.profileId)
const profileSummary = authoredProfile
  ? { lifeStage: authoredProfile.lifeStage, family: authoredProfile.family }
  : null
```

Return `profileSummary` in `HouseholdTeacherRow` and remove `profileLabel` from the interface/output.

- [ ] **Step 4: Fail closed for team name and bulk errors**

Use:

```ts
export const normalizeTeamDisplayName = (_teamId: string, data: Record<string, unknown>): string => {
  const value = data.displayName
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : 'チーム名を確認できません'
}
```

For `bulkItemStatus.status === 'FAILED'`, always emit:

```ts
message: '一括決算で処理できない家庭があります。再実行してください。'
```

Keep `errorCode`/`errorMessage` only in the operational bulk-operation object/logging path; do not copy them into `HouseholdTeacherWarning.message`.

- [ ] **Step 5: Hand-sync the client teacher DTO**

Replace client `profileLabel` with the same nullable `profileSummary` shape in `src/lib/homeEconomics/teacherDashboard.ts`.

- [ ] **Step 6: Verify**

```bash
npm test --workspace=functions -- src/homeEconomics/teacherDashboard.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add functions/src/homeEconomics/teacherDashboard.ts functions/src/homeEconomics/teacherDashboard.test.ts src/lib/homeEconomics/teacherDashboard.ts
git commit -m "fix: separate household teacher data from copy"
```

---

### Task 8: Humanize teacher household UI and sanitize every container error

**Files:**
- Modify: `src/components/homeEconomics/HouseholdTeacherDashboard.tsx`
- Modify: `src/components/homeEconomics/HouseholdTeacherDashboard.test.tsx`
- Modify: `src/components/teacher/HouseholdTeacherDashboard.tsx`
- Modify: `src/components/teacher/HouseholdTeacherDashboard.test.tsx`

**Interfaces:**
- Presentational view consumes Task 7 `profileSummary` and Task 1 `formatHouseholdProfileLabel`.
- Container maps all failures through Project A `describeError(error, fallback)`.
- Callable signatures remain unchanged.

- [ ] **Step 1: Write RED presentational tests**

Update teacher row fixtures to:

```ts
profileSummary: { lifeStage: 'INDEPENDENT', family: '単身' }
```

Assert `独立期・単身` is visible while `INDEPENDENT` and the runtime `householdId` are absent from rendered text. Add a row with `profileSummary: null` and `householdId: 'runtime-secret-household'`; assert `家庭プロフィールを確認できません` appears and the sentinel ID does not.

Keep an interaction assertion that the individual-settlement callback still receives that row's raw `householdId`.

- [ ] **Step 2: Write exact RED container error tests**

Replace the current load-error expectation with:

```ts
vi.mocked(teacherDashboardLib.getHouseholdTeacherDashboard)
  .mockRejectedValue(new Error('backend-secret-message'))

render(<HouseholdTeacherDashboard lessonRunId="run-1" role="PRIMARY" functions={{} as Functions} database={database} />)

await waitFor(() => {
  expect(screen.getByText('ダッシュボードの読み込みエラー')).toBeInTheDocument()
})
expect(screen.getByText('ダッシュボードの取得に失敗しました')).toBeInTheDocument()
expect(document.body.textContent).not.toContain('backend-secret-message')
```

Add this exact batch-action case after loading a valid dashboard:

```ts
vi.mocked(bulkSettlementLib.processHouseholdRoundBatch)
  .mockRejectedValue(new Error('backend-batch-secret'))

fireEvent.click(screen.getByRole('button', { name: '一括決算' }))
fireEvent.click(screen.getByRole('button', { name: '決算を実行' }))

await waitFor(() => {
  expect(screen.getByText('一括決算の実行に失敗しました')).toBeInTheDocument()
})
expect(document.body.textContent).not.toContain('backend-batch-secret')
```

- [ ] **Step 3: Verify RED**

```bash
npm test -- src/components/homeEconomics/HouseholdTeacherDashboard.test.tsx src/components/teacher/HouseholdTeacherDashboard.test.tsx
```

Expected: FAIL because the presentational view expects `profileLabel` and the container currently exposes raw `Error.message`.

- [ ] **Step 4: Format profile summaries in the presentational dashboard**

Replace `row.profileLabel` with:

```ts
formatHouseholdProfileLabel(
  row.profileSummary?.lifeStage,
  row.profileSummary?.family,
)
```

Keep existing human round numbering (`row.roundIndex + 1`) and authored event/warning copy.

- [ ] **Step 5: Replace all raw catch branches in the teacher container**

Import:

```ts
import { describeError } from '../../lib/monitoring/describeError'
```

Use these exact fallbacks:

```ts
// loadDashboard
setError(describeError(err, 'ダッシュボードの取得に失敗しました'))
// process batch
setError(describeError(err, '一括決算の実行に失敗しました'))
// retry batch
setError(describeError(err, '一括決算の再試行に失敗しました'))
// individual settlement
setError(describeError(err, '個別決算の実行に失敗しました'))
// checkpoint save
setError(describeError(err, 'チェックポイントの保存に失敗しました'))
// checkpoint restore
setError(describeError(err, 'チェックポイントの復元に失敗しました'))
// assignment prepare
setError(describeError(err, '割り当ての準備に失敗しました'))
// assignment update
setError(describeError(err, '割り当ての更新に失敗しました'))
// class comparison display
setError(describeError(err, 'クラス比較の教室画面表示に失敗しました'))
```

Do not inspect or substring-match `err.message`.

- [ ] **Step 6: Verify GREEN**

```bash
npm test -- src/components/homeEconomics/HouseholdTeacherDashboard.test.tsx src/components/teacher/HouseholdTeacherDashboard.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/homeEconomics/HouseholdTeacherDashboard.tsx src/components/homeEconomics/HouseholdTeacherDashboard.test.tsx src/components/teacher/HouseholdTeacherDashboard.tsx src/components/teacher/HouseholdTeacherDashboard.test.tsx
git commit -m "fix: hide household teacher implementation details"
```

---

### Task 9: Humanize class comparison without changing its DTO

**Files:**
- Modify: `src/components/homeEconomics/HouseholdClassComparisonView.tsx`
- Modify: `src/components/homeEconomics/HouseholdClassComparisonView.test.tsx`

**Interfaces:**
- Uses existing public `profile.lifeStage` and `profile.family`.
- No server or wire change.
- `profileId` remains React-key identity only.

- [ ] **Step 1: Write RED comparison tests**

Change the primary fixture profile to actual wire vocabulary:

```ts
profile: {
  householdId: 'profile-parent',
  age: 40,
  householdIncomeYen: 5000000,
  annualLivingExpensesYen: 3000000,
  cashSavingsYen: 1000000,
  family: '夫婦+子2人',
  housing: '賃貸',
  lifeGoal: '住宅購入',
  lifeStage: 'CHILD_REARING',
  isFictional: true,
}
```

Assert `子育て期・夫婦+子2人` appears, while `CHILD_REARING` and `profile-parent` do not appear in rendered text.

Add a cloned comparison with `lifeStage: 'UNKNOWN_COMPARISON_STAGE'`; assert `ライフステージを確認できません・夫婦+子2人` appears and the raw sentinel does not.

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/components/homeEconomics/HouseholdClassComparisonView.test.tsx
```

Expected: FAIL because the component renders `profile.lifeStage` directly.

- [ ] **Step 3: Render the composite formatter**

```tsx
<Typography variant="body2" sx={{ fontWeight: 600, minWidth: 96 }}>
  {formatHouseholdProfileLabel(household.profile.lifeStage, household.profile.family)}
</Typography>
```

Keep `key={household.profileId}`; do not render the ID.

- [ ] **Step 4: Verify GREEN**

```bash
npm test -- src/components/homeEconomics/HouseholdClassComparisonView.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/homeEconomics/HouseholdClassComparisonView.tsx src/components/homeEconomics/HouseholdClassComparisonView.test.tsx
git commit -m "fix: humanize household class comparison"
```

---

### Task 10: Project C regression audit and full verification

**Files:**
- Verification only. Modify only files already in Tasks 1-9 if a failure proves a Project C regression.

- [ ] **Step 1: Scan forbidden Home Economics presentation fallbacks**

```bash
rg -n "error instanceof Error \? error\.message|profileLabel \?\? householdId|\?\? entry\.profileId|\?\? profileId|\?\? householdId|\?\? teamId" \
  src/components/homeEconomics \
  src/components/teacher/HouseholdTeacherDashboard.tsx
```

Expected: no user-facing fallback. Inspect any internal match and confirm it is key/value/control logic only.

- [ ] **Step 2: Inspect enum-token matches rather than assuming the scan is clean**

```bash
rg -n "DOMESTIC_STOCK|FOREIGN_STOCK|INVESTMENT_TRUST|CHILD_REARING|INDEPENDENT|MULTI_PERSON_PER_TEAM|ROLE_VARIANT|STAGE_SPLIT|SETTLING|OPEN" \
  src/components/homeEconomics \
  src/components/teacher/HouseholdTeacherDashboard.tsx
```

Expected: tokens may remain in tests and control-flow comparisons; none may be directly rendered as normal user-facing text.

- [ ] **Step 3: Run focused client tests**

```bash
npm test -- \
  src/lib/presentation/householdLabels.test.ts \
  src/lib/homeEconomics/householdAssignment.test.ts \
  src/components/homeEconomics/HouseholdSummaryCard.test.tsx \
  src/components/homeEconomics/HouseholdTeamScreen.test.tsx \
  src/components/homeEconomics/HouseholdAssignmentPanel.test.tsx \
  src/components/homeEconomics/HouseholdTeacherDashboard.test.tsx \
  src/components/teacher/HouseholdTeacherDashboard.test.tsx \
  src/components/homeEconomics/HouseholdClassComparisonView.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run focused Functions tests**

```bash
npm test --workspace=functions -- \
  src/homeEconomics/realtimeProjection.test.ts \
  src/homeEconomics/processRound.publishRealtimeState.test.ts \
  src/homeEconomics/householdAssignmentRepository.test.ts \
  src/homeEconomics/teacherDashboard.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run repository gates**

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run verify --workspace=functions
```

Expected: every command PASS. Do not claim completion if any command fails.

- [ ] **Step 6: Review final scope**

```bash
git status --short
git diff --stat codex/classroom...HEAD
git diff --name-only codex/classroom...HEAD
```

Expected: only files named in Tasks 1-9. No market/research, lesson-intervention, organization/admin, operator, dependency, lockfile, or unrelated formatting changes.

- [ ] **Step 7: Commit only a real Project C verification correction**

If verification changed no file, create no commit. If a Project C regression required a correction, stage only the affected Task 1-9 files and use a commit message naming that exact correction.

---

## Project C Completion Criteria

Project C is complete only when all of these are true:

1. Common and advanced team-state projections carry `profileSummary` with no additional database lookup.
2. Student household tabs/cards never use `teamId`, runtime `householdId`, or `profileId` as display fallbacks.
3. Life-stage, concept, asset, course-format, assignment-state, validation-state, and round-status values shown in UI are human-readable and fail closed.
4. Asset controls show Japanese labels but return original asset-type values to decision callbacks.
5. Assignment controls show semantic labels but preserve original `profileId`/`householdId` in update payloads.
6. Teacher rows carry semantic `profileSummary`, not server-generated `lifeStage・family` copy.
7. Missing team/profile semantics produce fixed Japanese fallback text rather than IDs.
8. Bulk-settlement internal `errorMessage` never becomes teacher warning text.
9. Student and teacher household containers never display raw `Error.message`.
10. Class comparison formats its existing public profile semantics client-side and never renders `profileId`.
11. Sentinel tests prove opaque IDs, unknown enum values, and backend-secret error strings do not appear verbatim.
12. `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run verify --workspace=functions` all pass.

## Explicit Non-Goals

- Do not redesign simulation rules, settlement math, assignments, checkpoints, or comparison scoring.
- Do not remove runtime `householdId` or logical `profileId` from domain/API contracts that require identity.
- Do not remove the existing advanced RTDB `.profile` payload; retaining it alongside `state.profileSummary` is intentional compatibility.
- Do not change Firestore/RTDB authorization rules for this project; the added summary contains only fictional/public semantic fields already available to the same team in advanced mode.
- Do not add Firebase reads to construct labels.
- Do not move Japanese UI copy into Cloud Functions.
- Do not implement Projects B, D, E, or F.
