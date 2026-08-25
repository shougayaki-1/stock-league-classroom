# Home Economics Presentation Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every student- and teacher-facing Home Economics screen render human-readable household/profile/state vocabulary without exposing runtime household IDs, logical profile IDs, backend enum tokens, or raw backend error messages, while preserving those IDs internally for mutations, RTDB map keys, and React/DOM identity.

**Architecture:** Keep the existing server-side privacy allow-lists, but enrich three wire projections with the semantic data the client currently lacks: `profileSummary: { lifeStage, family }`. The client remains responsible for Japanese copy through Project A's `src/lib/presentation/householdLabels.ts`; server code must not compose Japanese display strings from enum values. Runtime IDs and profile IDs remain in DTOs only where required for commands and identity, and every UI fallback fails closed to generic human copy rather than echoing the internal value.

**Tech Stack:** Firebase Cloud Functions v2, TypeScript 6, React 19, Vite 8, Vitest 4, Testing Library, MUI, Firebase Realtime Database/Callable Functions.

**Spec:** `docs/superpowers/specs/2026-08-24-ui-presentation-boundary-design.md`

## Global Constraints

- Baseline is `codex/classroom`; do not target `main`.
- Project A presentation/error primitives are already available and must be reused rather than duplicated.
- A value being safe in a public/team projection does **not** make it safe to render directly to a human.
- Student/teacher UI must not render runtime `householdId`, `teamId`, `profileId`, raw UID, backend enum/state token, revision/idempotency metadata, or raw `Error.message` as normal UI copy.
- Internal IDs remain valid for API payloads, RTDB map keys, React keys, DOM ids, and domain logic when they are not rendered as user-facing text.
- Never use `LABELS[value] ?? value`, `label ?? internalId`, or `error instanceof Error ? error.message : fallback` in user-facing Home Economics code.
- Unknown wire values must fail closed to fixed generic Japanese copy and must never echo the unknown input.
- Server DTO enrichment is allowed only when the client lacks semantic data needed to form a human label. Do not add N+1 reads; all enrichments in this plan use profile/template data already in memory at the current projection point.
- Do not replace internal IDs with Japanese strings in mutation inputs. `householdId` and `profileId` must continue to reach existing submit/update Callables unchanged.
- Do not expose private household authoring fields such as `internalRiskFactors`, event probabilities, insurance claim probabilities, seeds, or teacher-private computation logs.
- Do not broaden scope into Projects B, D, E, or F.
- Every behavior change follows RED → GREEN → focused test → commit.
- Required invariant: if an opaque household/profile ID, unknown enum token, or backend error string is injected into a fixture, that exact raw value must not appear in rendered student/teacher UI.

---

## File Structure

The implementation intentionally keeps formatting, semantic projection, and UI consumption separate.

- `src/lib/presentation/householdLabels.ts`: single client-side source of Japanese Home Economics labels and composite profile formatting.
- `functions/src/homeEconomics/realtimeProjection.ts`: team-safe realtime household projection; gains semantic `profileSummary` without removing runtime identity.
- `src/lib/lessonRuns/liveTypes.ts`: hand-synced client counterpart of the realtime DTO.
- `functions/src/homeEconomics/householdAssignmentRepository.ts`: assignment wire view; gains semantic profile summary from `profiles` already passed to the builder.
- `src/lib/homeEconomics/householdAssignment.ts`: hand-synced assignment client DTO.
- `functions/src/homeEconomics/teacherDashboard.ts`: teacher DTO; stops manufacturing `profileLabel` and stops forwarding raw bulk error text.
- `src/lib/homeEconomics/teacherDashboard.ts`: hand-synced teacher DTO.
- `src/components/homeEconomics/*`: presentation-only household/assignment/comparison views.
- `src/components/teacher/HouseholdTeacherDashboard.tsx`: orchestration/error container; converts failures through Project A's `describeError`.

---

### Task 1: Extend the household presentation vocabulary with composite profile and assignment formatters

**Files:**
- Modify: `src/lib/presentation/householdLabels.ts`
- Modify: `src/lib/presentation/householdLabels.test.ts`

**Interfaces:**
- Consumes: Project A `safeLabel()` and the existing `formatHouseholdLifeStage()` / `formatHouseholdAssetType()` / `formatHouseholdCourseFormat()` helpers.
- Produces:
  - `formatHouseholdProfileLabel(lifeStage: string | null | undefined, family: string | null | undefined): string`
  - `formatHouseholdAssignmentState(value: string | null | undefined): string`
  - `formatHouseholdAssignmentValidationStatus(value: string | null | undefined): string`
  - exhaustive assignment state/validation label maps.

- [ ] **Step 1: Write failing tests for composite profile formatting and assignment statuses**

Add tests that prove known values become Japanese copy and unknown/internal values never echo:

```ts
it('formats household profile from a translated life stage plus authored family text', () => {
  expect(formatHouseholdProfileLabel('CHILD_REARING', ' 配偶者・子1人 '))
    .toBe('子育て期・配偶者・子1人')
})

it('never echoes an unknown life-stage token from a profile label', () => {
  const result = formatHouseholdProfileLabel('UNKNOWN_INTERNAL_STAGE', '単身')
  expect(result).toBe('ライフステージを確認できません・単身')
  expect(result).not.toContain('UNKNOWN_INTERNAL_STAGE')
})

it('does not require an internal id when family text is unavailable', () => {
  expect(formatHouseholdProfileLabel('INDEPENDENT', '   ')).toBe('独立期')
})

it('fails closed for unknown assignment state and validation status', () => {
  expect(formatHouseholdAssignmentState('BACKEND_ONLY_STATE')).toBe('割り当て状態を確認できません')
  expect(formatHouseholdAssignmentValidationStatus('RAW_VALIDATION_TOKEN')).toBe('検証状況を確認できません')
})
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
npm test -- src/lib/presentation/householdLabels.test.ts
```

Expected: FAIL because the new formatters/maps do not yet exist.

- [ ] **Step 3: Add exhaustive maps and the fail-closed composite formatter**

Use the actual assignment wire unions already present in `src/lib/homeEconomics/householdAssignment.ts` via type-only imports, or equivalent exact local unions if importing would introduce an unwanted runtime dependency:

```ts
export const HOUSEHOLD_ASSIGNMENT_STATE_LABELS = {
  UNPREPARED: '未準備',
  DRAFT: '編集中',
  STALE: '要再確認',
  FROZEN: 'ロック済み',
} satisfies Record<'UNPREPARED' | 'DRAFT' | 'STALE' | 'FROZEN', string>

export const HOUSEHOLD_ASSIGNMENT_VALIDATION_STATUS_LABELS = {
  READY: '準備完了',
  INVALID: '要修正',
} satisfies Record<'READY' | 'INVALID', string>

export const formatHouseholdProfileLabel = (
  lifeStage: string | null | undefined,
  family: string | null | undefined,
): string => {
  const stageLabel = formatHouseholdLifeStage(lifeStage)
  const familyLabel = family?.trim()
  return familyLabel ? `${stageLabel}・${familyLabel}` : stageLabel
}
```

Both assignment formatter functions must call `safeLabel`; neither may use the raw input as a fallback.

- [ ] **Step 4: Run the focused test and confirm GREEN**

```bash
npm test -- src/lib/presentation/householdLabels.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the presentation primitive**

```bash
git add src/lib/presentation/householdLabels.ts src/lib/presentation/householdLabels.test.ts
git commit -m "feat: add household presentation formatters"
```

---

### Task 2: Enrich realtime household state with semantic profile data already available at publish time

**Files:**
- Modify: `functions/src/homeEconomics/realtimeProjection.ts`
- Modify: `functions/src/homeEconomics/realtimeProjection.test.ts`
- Modify: `functions/src/homeEconomics/processRound.ts`
- Modify: `functions/src/homeEconomics/processRound.publishRealtimeState.test.ts`
- Modify: `src/lib/lessonRuns/liveTypes.ts`

**Interfaces:**
- Produces the hand-synced wire field on server and client:

```ts
profileSummary: {
  lifeStage: string
  family: string
}
```

- Changes `toHouseholdStateTeamView` so it receives the already-resolved `HouseholdProfile` in addition to the runtime `HouseholdState`.
- Keeps `householdId`, `assetHoldingsYen`, and other existing state fields intact for command identity/domain behavior.

- [ ] **Step 1: Add RED projection tests for `profileSummary` and private-field exclusion**

In `functions/src/homeEconomics/realtimeProjection.test.ts`, update the fixture to pass a valid authored profile and assert:

```ts
expect(view.profileSummary).toEqual({
  lifeStage: 'CHILD_REARING',
  family: '配偶者・子1人',
})
expect(JSON.stringify(view)).not.toContain('internalRiskFactors')
```

Also keep the existing allow-list/privacy assertions. Do not add the full authored profile to `HouseholdStateTeamView`.

- [ ] **Step 2: Run the realtime projection test and confirm RED**

```bash
npm test --workspace=functions -- src/homeEconomics/realtimeProjection.test.ts
```

Expected: FAIL because `profileSummary` is absent and/or the helper signature has not changed.

- [ ] **Step 3: Change the server projection signature and advanced helper wiring**

Use the profile already passed into `toAdvancedHouseholdTeamEntryView`:

```ts
export interface HouseholdStateTeamView {
  householdId: string
  profileSummary: {
    lifeStage: string
    family: string
  }
  // existing fields unchanged
}

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
  // existing allow-listed fields
})
```

Then update `toAdvancedHouseholdTeamEntryView()` to call `toHouseholdStateTeamView(profile, household, ...)`.

- [ ] **Step 4: Add RED publisher coverage for COMMON_CONDITIONS**

In `functions/src/homeEconomics/processRound.publishRealtimeState.test.ts`, assert that the Common team-state write contains semantic profile data and does not require another read:

```ts
expect(teamUpdate.household.profileSummary).toEqual({
  lifeStage: input.profile.lifeStage,
  family: input.profile.family,
})
```

- [ ] **Step 5: Pass the existing `input.profile` into the Common projection**

The production path already receives `profile` in `ProcessRoundDeps['publishRealtimeState']`; change only the projection call:

```ts
const householdView = toHouseholdStateTeamView(
  input.profile,
  newHousehold,
  visibleConcepts,
  eventDisclosures,
  shortfallOptions,
)
```

Do **not** add a Firestore lookup. `processRound()` already resolved `profile` from the lesson-run template snapshot before `publishRealtimeState()` is called.

- [ ] **Step 6: Hand-sync the client live type**

Add the same required `profileSummary` field to `src/lib/lessonRuns/liveTypes.ts`'s `HouseholdStateTeamView`. Keep the existing advanced entry `.profile` field for compatibility; Project C does not remove or redesign it.

- [ ] **Step 7: Run focused server tests and root typecheck**

```bash
npm test --workspace=functions -- src/homeEconomics/realtimeProjection.test.ts src/homeEconomics/processRound.publishRealtimeState.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit the realtime semantic projection**

```bash
git add functions/src/homeEconomics/realtimeProjection.ts functions/src/homeEconomics/realtimeProjection.test.ts functions/src/homeEconomics/processRound.ts functions/src/homeEconomics/processRound.publishRealtimeState.test.ts src/lib/lessonRuns/liveTypes.ts
git commit -m "feat: project household profile summaries"
```

---

### Task 3: Make `HouseholdSummaryCard` human-readable while preserving internal asset values for decisions

**Files:**
- Modify: `src/components/homeEconomics/HouseholdSummaryCard.tsx`
- Modify: `src/components/homeEconomics/HouseholdSummaryCard.test.tsx`

**Interfaces:**
- Consumes Task 1 `formatHouseholdLifeStage`, `formatHouseholdAssetType`, `formatHouseholdConcept`.
- `householdId` remains an internal prop for DOM/input identity only.
- Make `profileLabel` required user-facing copy; remove the visual `profileLabel ?? householdId` fallback.
- Ranking/choice controls display Japanese asset labels while callbacks continue to emit the original asset-type wire values.

- [ ] **Step 1: Reverse the tests that currently expect raw asset tokens**

Replace raw-token expectations such as `DOMESTIC_STOCK`/`FOREIGN_BOND` with assertions that:

```ts
expect(screen.getByRole('radio', { name: '国内株式' })).toBeInTheDocument()
expect(document.body.textContent).not.toContain('DOMESTIC_STOCK')
```

Add a callback test proving the user-visible label does not change the domain value:

```ts
await user.click(screen.getByRole('radio', { name: '国内株式' }))
expect(onAssetTypeChange).toHaveBeenCalledWith('DOMESTIC_STOCK')
```

Add an unknown sentinel:

```ts
const assetHoldingsYen = {
  DOMESTIC_STOCK: 300000,
  UNKNOWN_BACKEND_ASSET: 100000,
}
render(/* SELL_ASSETS card */)
expect(document.body.textContent).not.toContain('UNKNOWN_BACKEND_ASSET')
expect(screen.getByText('一部の資産種別を確認できません。')).toBeInTheDocument()
```

Also assert `CHILD_REARING` renders as `子育て期` and round index `0` renders as `第1ラウンド`.

- [ ] **Step 2: Run the component test and confirm RED**

```bash
npm test -- src/components/homeEconomics/HouseholdSummaryCard.test.tsx
```

Expected: FAIL on raw life-stage/asset output and current zero-based round copy.

- [ ] **Step 3: Remove duplicate concept copy and use Project A formatters**

Delete the local `CONCEPT_LABELS`. Keep a deterministic concept order, but render each known concept through `formatHouseholdConcept()`; if a wire value is unknown, show at most one fixed `学習項目を確認できません` chip and never the raw token.

- [ ] **Step 4: Translate asset labels without translating mutation values**

Build label/value pairs from known keys in `assetHoldingsYen`:

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

Feed labels to `RankingInput`/`SingleChoiceInput`, translate current values from wire value → label, and translate `onChange` back from label → wire value before invoking `onAssetAllocationOrderChange` / `onShortfallResolutionAssetTypeChange`.

Unknown asset keys must not become selectable raw options. If any exist, render only `一部の資産種別を確認できません。`.

- [ ] **Step 5: Remove visible ID fallback and normalize life-stage/round copy**

Render:

```tsx
<Typography variant="h6">{profileLabel}</Typography>
<Typography variant="body2">ライフステージ: {formatHouseholdLifeStage(lifeStage)}</Typography>
<Typography variant="body2">第{roundIndex + 1}ラウンド</Typography>
```

`householdId` may remain in component input `id` attributes because that value is not rendered as user-facing copy.

- [ ] **Step 6: Run tests and confirm GREEN**

```bash
npm test -- src/components/homeEconomics/HouseholdSummaryCard.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit the summary-card presentation boundary**

```bash
git add src/components/homeEconomics/HouseholdSummaryCard.tsx src/components/homeEconomics/HouseholdSummaryCard.test.tsx
git commit -m "fix: humanize household summary presentation"
```

---

### Task 4: Stop `HouseholdTeamScreen` from falling back to runtime IDs or raw backend errors

**Files:**
- Modify: `src/components/homeEconomics/HouseholdTeamScreen.tsx`
- Modify: `src/components/homeEconomics/HouseholdTeamScreen.test.tsx`

**Interfaces:**
- Consumes Task 1 `formatHouseholdProfileLabel` and Project A `describeError`.
- Consumes Task 2 `HouseholdStateTeamView.profileSummary` semantics.
- Keeps runtime `activeHouseholdId` unchanged for `submitHouseholdDecision()`.

- [ ] **Step 1: Rewrite the leakage assertions as RED tests**

For Common, provide:

```ts
profileSummary: { lifeStage: 'INDEPENDENT', family: '単身' }
```

and assert:

```ts
expect(screen.getByText('独立期・単身')).toBeInTheDocument()
expect(document.body.textContent).not.toContain('team-a')
```

For advanced/MULTI, expect translated tabs such as `子育て期・配偶者・子1人`, while still asserting the Callable receives `householdId: 'case-a'`.

Inject an unknown life-stage sentinel such as `UNKNOWN_INTERNAL_STAGE` and assert the tab/card contains `ライフステージを確認できません` but not the sentinel.

Inject a rejected Callable with `new Error('backend-secret-message')` and assert:

```ts
expect(await screen.findByRole('alert')).toHaveTextContent('提出に失敗しました。')
expect(document.body.textContent).not.toContain('backend-secret-message')
```

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
npm test -- src/components/homeEconomics/HouseholdTeamScreen.test.tsx
```

Expected: FAIL because Common currently falls back to `teamId`, advanced fallback can echo `householdId`, and raw `Error.message` is displayed.

- [ ] **Step 3: Add `profileSummary` to the screen's local RTDB subset type**

```ts
interface HouseholdEntryStateNode {
  householdId: string
  profileSummary?: { lifeStage: string; family: string }
  // existing fields
}
```

Keep it optional in this local subscriber type so an already-running old RTDB node fails closed rather than crashing during rollout.

- [ ] **Step 4: Replace `householdTabLabel(id)` with semantic-only lookup**

Use the state-level summary as the canonical source; the existing advanced `.profile` can be a backward-compatible semantic fallback, but the final fallback must be generic copy:

```ts
const householdProfileLabel = (id: string): string => {
  const advancedEntry = state?.households?.[id]
  const summary = isAdvanced
    ? (advancedEntry?.state.profileSummary ?? advancedEntry?.profile ?? null)
    : (state?.household?.profileSummary ?? null)

  return formatHouseholdProfileLabel(summary?.lifeStage, summary?.family)
}
```

Never return `id`, `teamId`, `householdId`, or `profileId` from this formatter.

- [ ] **Step 5: Replace raw error display with Project A error mapping**

```ts
.catch((error: unknown) => {
  setSubmitStatus('ERROR')
  setErrorMessage(describeError(error, '提出に失敗しました。'))
})
```

- [ ] **Step 6: Pass the semantic profile label to `HouseholdSummaryCard` and retain identity only for commands**

Continue to submit:

```ts
householdId: activeHouseholdId
```

but render only `householdProfileLabel(activeHouseholdId)`.

- [ ] **Step 7: Run tests and confirm GREEN**

```bash
npm test -- src/components/homeEconomics/HouseholdTeamScreen.test.tsx src/components/homeEconomics/HouseholdSummaryCard.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit the student household boundary**

```bash
git add src/components/homeEconomics/HouseholdTeamScreen.tsx src/components/homeEconomics/HouseholdTeamScreen.test.tsx
git commit -m "fix: hide household runtime details from students"
```

---

### Task 5: Enrich the household assignment DTO with semantic profile summaries

**Files:**
- Modify: `functions/src/homeEconomics/householdAssignmentRepository.ts`
- Modify: `functions/src/homeEconomics/householdAssignmentRepository.test.ts`
- Modify: `src/lib/homeEconomics/householdAssignment.ts`
- Modify: `src/lib/homeEconomics/householdAssignment.test.ts`

**Interfaces:**
- Adds to every assignment entry:

```ts
profileSummary: {
  lifeStage: string
  family: string
} | null
```

- Keeps `profileId` as the mutation value and `householdId` as the entry identity.
- `null` means the server could not resolve a referenced profile; the UI must render generic copy, never `profileId`.

- [ ] **Step 1: Add RED repository projection tests**

In `functions/src/homeEconomics/householdAssignmentRepository.test.ts`, assert a known entry is enriched from the already-supplied `profiles` array:

```ts
expect(view.teams[0].entries[0]).toMatchObject({
  profileId: 'profile-1',
  profileSummary: {
    lifeStage: 'INDEPENDENT',
    family: '単身',
  },
})
```

Add an orphan-profile fixture and assert `profileSummary === null`; do not substitute `profileId`.

- [ ] **Step 2: Run the repository test and confirm RED**

```bash
npm test --workspace=functions -- src/homeEconomics/householdAssignmentRepository.test.ts
```

Expected: FAIL because the view does not contain `profileSummary`.

- [ ] **Step 3: Enrich `buildTeamsView` from the `profiles` already in memory**

Change the helper to receive `profiles: HouseholdProfile[]`, build a map once, and project only semantic fields:

```ts
const profileById = new Map(profiles.map((profile) => [profile.householdId, profile] as const))

const profile = profileById.get(entry.profileId)
team.entries.push({
  householdId: entry.householdId,
  profileId: entry.profileId,
  profileSummary: profile
    ? { lifeStage: profile.lifeStage, family: profile.family }
    : null,
  displayOrder: entry.displayOrder,
  assignmentSource: entry.assignmentSource,
})
```

Update `buildHouseholdAssignmentView()` to call `buildTeamsView(input.entries, input.teamDisplayNames, input.profiles)`.

No database lookup is permitted: `buildHouseholdAssignmentView` already receives `profiles`.

- [ ] **Step 4: Hand-sync the client DTO and wrapper tests**

Add the same nullable `profileSummary` field to `src/lib/homeEconomics/householdAssignment.ts` and update `src/lib/homeEconomics/householdAssignment.test.ts` fixtures/response assertions.

- [ ] **Step 5: Run server/client tests and typecheck**

```bash
npm test --workspace=functions -- src/homeEconomics/householdAssignmentRepository.test.ts
npm test -- src/lib/homeEconomics/householdAssignment.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the assignment DTO enrichment**

```bash
git add functions/src/homeEconomics/householdAssignmentRepository.ts functions/src/homeEconomics/householdAssignmentRepository.test.ts src/lib/homeEconomics/householdAssignment.ts src/lib/homeEconomics/householdAssignment.test.ts
git commit -m "feat: enrich household assignment profiles"
```

---

### Task 6: Make `HouseholdAssignmentPanel` display profile semantics instead of profile IDs

**Files:**
- Modify: `src/components/homeEconomics/HouseholdAssignmentPanel.tsx`
- Modify: `src/components/homeEconomics/HouseholdAssignmentPanel.test.tsx`

**Interfaces:**
- Consumes Task 1 `formatHouseholdProfileLabel`, `formatHouseholdCourseFormat`, `formatHouseholdAssignmentState`, and `formatHouseholdAssignmentValidationStatus`.
- Consumes Task 5 `entry.profileSummary`.
- `profileId` remains the `<option value>` and update payload value, but never the visible option text, warning text, read-only text, or accessible move-control name.

- [ ] **Step 1: Update assignment fixtures to include semantic summaries and add RED no-ID assertions**

Use fixtures such as:

```ts
{
  householdId: 'h-a',
  profileId: 'profile-1',
  profileSummary: { lifeStage: 'INDEPENDENT', family: '単身' },
  displayOrder: 0,
  assignmentSource: 'AUTO',
}
```

Assert editable options contain `独立期・単身`, frozen/read-only rows contain the same, and the rendered DOM does not contain `profile-1` or `profile-2`.

Keep the save assertion unchanged at the command boundary:

```ts
expect(onUpdate).toHaveBeenCalledWith({
  expectedRevision: 1,
  changes: [{ householdId: 'h-a', profileId: 'profile-2' }],
})
```

For the unused-profile warning, assert human copy such as `未使用のプロフィール: 子育て期・配偶者・子1人`, not `profile-2`.

Add a missing-summary fixture and assert `家庭プロフィールを確認できません` (or the Task 1 generic profile result) without the raw `profileId`.

- [ ] **Step 2: Run the panel test and confirm RED**

```bash
npm test -- src/components/homeEconomics/HouseholdAssignmentPanel.test.tsx
```

Expected: FAIL because the component currently derives choices from `profileId` and renders profile IDs in several branches.

- [ ] **Step 3: Replace `knownProfileIds` with an internal id → semantic summary map**

Derive choices without losing command identity:

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
  return summary
    ? formatHouseholdProfileLabel(summary.lifeStage, summary.family)
    : '家庭プロフィールを確認できません'
}
```

The `profileId` argument is lookup identity only and must never be returned.

- [ ] **Step 4: Humanize every assignment display branch**

Use formatter output for:
- `<option>` text while preserving `value={profileId}`.
- frozen/read-only profile text.
- MULTI profile rows.
- up/down `aria-label`s.
- unused-profile warning.
- course-format explanatory copy.
- state and validation status chips.

Keep `householdId`, `teamId`, `profileId`, and `assignmentRevision` internal to selection/update logic.

- [ ] **Step 5: Run tests and confirm GREEN**

```bash
npm test -- src/components/homeEconomics/HouseholdAssignmentPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit the assignment presentation**

```bash
git add src/components/homeEconomics/HouseholdAssignmentPanel.tsx src/components/homeEconomics/HouseholdAssignmentPanel.test.tsx
git commit -m "fix: humanize household assignment controls"
```

---

### Task 7: Replace teacher-dashboard server display strings with semantic DTO data and sanitize warning/team fallbacks

**Files:**
- Modify: `functions/src/homeEconomics/teacherDashboard.ts`
- Modify: `functions/src/homeEconomics/teacherDashboard.test.ts`
- Modify: `src/lib/homeEconomics/teacherDashboard.ts`

**Interfaces:**
- Replaces `HouseholdTeacherRow.profileLabel: string` with:

```ts
profileSummary: {
  lifeStage: string
  family: string
} | null
```

- Keeps `lifeStage`, `householdId`, `teamId`, and all existing operational fields for domain/control logic.
- `normalizeTeamDisplayName()` returns fixed human fallback `チーム名を確認できません` when `displayName` is absent instead of `teamId`.
- `BULK_SETTLEMENT_FAILED` warnings never use `bulkItemStatus.errorMessage` as presentation copy.

- [ ] **Step 1: Rewrite the current profile-label/fallback tests as RED tests**

Change the existing expectations from server-generated strings:

```ts
expect(row.profileSummary).toEqual({
  lifeStage: 'INDEPENDENT',
  family: '単身',
})
```

For an unresolved `state.profileId`:

```ts
expect(row.profileSummary).toBeNull()
```

Change `normalizeTeamDisplayName` tests to expect:

```ts
expect(normalizeTeamDisplayName('team-secret-id', {})).toBe('チーム名を確認できません')
expect(normalizeTeamDisplayName('team-secret-id', {})).not.toContain('team-secret-id')
```

Inject a bulk failure:

```ts
bulkItemStatus: {
  status: 'FAILED',
  errorCode: 'INTERNAL_FAILURE',
  errorMessage: 'backend-secret-message',
}
```

and assert the user-facing warning contains fixed recovery copy but not `backend-secret-message`.

- [ ] **Step 2: Run the server test and confirm RED**

```bash
npm test --workspace=functions -- src/homeEconomics/teacherDashboard.test.ts
```

Expected: FAIL on the current `profileLabel`, `teamId` fallback, and raw `errorMessage` forwarding.

- [ ] **Step 3: Project semantic profile data rather than composing display copy server-side**

Replace:

```ts
const profileLabel = authoredProfile ? `${state.lifeStage}・${authoredProfile.family}` : state.lifeStage
```

with:

```ts
const profileSummary = authoredProfile
  ? { lifeStage: authoredProfile.lifeStage, family: authoredProfile.family }
  : null
```

The client, not Functions, owns the Japanese life-stage translation.

- [ ] **Step 4: Sanitize team and bulk-failure presentation fallbacks**

Use:

```ts
export const normalizeTeamDisplayName = (_teamId: string, data: Record<string, unknown>): string => {
  const value = data.displayName
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : 'チーム名を確認できません'
}
```

For bulk failures, keep error details in the operational bulk-operation structure/logging but emit only fixed warning copy from `buildHouseholdTeacherRow`, for example:

```ts
message: '一括決算で処理できない家庭があります。再実行してください。'
```

Do not branch user-facing copy on raw `errorMessage` text.

- [ ] **Step 5: Hand-sync the client teacher DTO**

Replace `profileLabel` with the nullable `profileSummary` shape in `src/lib/homeEconomics/teacherDashboard.ts`.

- [ ] **Step 6: Run focused tests and typecheck**

```bash
npm test --workspace=functions -- src/homeEconomics/teacherDashboard.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit the teacher DTO boundary**

```bash
git add functions/src/homeEconomics/teacherDashboard.ts functions/src/homeEconomics/teacherDashboard.test.ts src/lib/homeEconomics/teacherDashboard.ts
git commit -m "fix: separate household teacher data from copy"
```

---

### Task 8: Humanize teacher household dashboard UI and route every household action error through `describeError`

**Files:**
- Modify: `src/components/homeEconomics/HouseholdTeacherDashboard.tsx`
- Modify: `src/components/homeEconomics/HouseholdTeacherDashboard.test.tsx`
- Modify: `src/components/teacher/HouseholdTeacherDashboard.tsx`
- Modify: `src/components/teacher/HouseholdTeacherDashboard.test.tsx`

**Interfaces:**
- Presentational view consumes Task 7 `row.profileSummary` and Task 1 `formatHouseholdProfileLabel`.
- Container consumes Project A `describeError(error, fallback)` for every load/action failure.
- No Callable signature changes.

- [ ] **Step 1: Add RED presentational tests for profile and ID fail-closed behavior**

Update teacher-row fixtures to contain:

```ts
profileSummary: { lifeStage: 'INDEPENDENT', family: '単身' }
```

Assert the view renders `独立期・単身` and not the raw enum or runtime household ID. Add a `profileSummary: null` fixture with a sentinel `householdId: 'runtime-secret-household'` and assert the UI shows generic profile copy without the sentinel.

Keep `householdId` in callback assertions for individual settlement; the control must still call `onProcessIndividualRound(runtimeId, ...)`.

- [ ] **Step 2: Add RED container tests for raw backend errors**

Replace the current `Network error` visibility expectation with:

```ts
vi.mocked(getHouseholdTeacherDashboard)
  .mockRejectedValue(new Error('backend-secret-message'))

expect(await screen.findByText('ダッシュボードの読み込みエラー')).toBeInTheDocument()
expect(document.body.textContent).toContain('ダッシュボードの取得に失敗しました')
expect(document.body.textContent).not.toContain('backend-secret-message')
```

Add at least one action-path sentinel (for example `processHouseholdRoundBatch`) to prove action failures also pass through the common mapper.

- [ ] **Step 3: Run both teacher dashboard tests and confirm RED**

```bash
npm test -- src/components/homeEconomics/HouseholdTeacherDashboard.test.tsx src/components/teacher/HouseholdTeacherDashboard.test.tsx
```

Expected: FAIL because the presentational component expects `profileLabel` and the container currently displays raw `Error.message`.

- [ ] **Step 4: Format teacher profile summaries on the client**

In the presentational dashboard, replace `row.profileLabel` with:

```ts
formatHouseholdProfileLabel(
  row.profileSummary?.lifeStage,
  row.profileSummary?.family,
)
```

Keep the existing human round numbering (`row.roundIndex + 1`) and authored warning/event text.

- [ ] **Step 5: Replace every raw catch branch in the teacher container**

Import Project A's compatibility API:

```ts
import { describeError } from '../../lib/monitoring/describeError'
```

Convert all current branches of the form:

```ts
setError(err instanceof Error ? err.message : '...')
```

to:

```ts
setError(describeError(err, 'ダッシュボードの取得に失敗しました'))
```

with the existing operation-specific fallback for:
- dashboard load,
- batch settlement,
- retry,
- individual settlement,
- checkpoint save,
- checkpoint restore,
- assignment prepare,
- assignment update,
- classroom comparison display.

Do not parse `err.message` and do not add message-substring branching.

- [ ] **Step 6: Run tests and confirm GREEN**

```bash
npm test -- src/components/homeEconomics/HouseholdTeacherDashboard.test.tsx src/components/teacher/HouseholdTeacherDashboard.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit the teacher presentation/error boundary**

```bash
git add src/components/homeEconomics/HouseholdTeacherDashboard.tsx src/components/homeEconomics/HouseholdTeacherDashboard.test.tsx src/components/teacher/HouseholdTeacherDashboard.tsx src/components/teacher/HouseholdTeacherDashboard.test.tsx
git commit -m "fix: hide household teacher implementation details"
```

---

### Task 9: Humanize the class comparison without changing its privacy-safe DTO

**Files:**
- Modify: `src/components/homeEconomics/HouseholdClassComparisonView.tsx`
- Modify: `src/components/homeEconomics/HouseholdClassComparisonView.test.tsx`

**Interfaces:**
- Consumes existing `HouseholdClassComparisonPublicView.profile.lifeStage` and `.family`.
- Consumes Task 1 `formatHouseholdProfileLabel`.
- No server or DTO change is required because the comparison already carries the semantic public profile.

- [ ] **Step 1: Change comparison fixtures to actual enum-shaped wire data and add RED leakage assertions**

Use:

```ts
profile: {
  ...,
  lifeStage: 'CHILD_REARING',
  family: '夫婦+子2人',
}
```

and expect `子育て期・夫婦+子2人`, not `CHILD_REARING`.

Add an unknown sentinel:

```ts
lifeStage: 'UNKNOWN_COMPARISON_STAGE'
```

and assert the fixed fallback appears while the sentinel and `profileId` are absent from rendered text.

- [ ] **Step 2: Run the comparison test and confirm RED**

```bash
npm test -- src/components/homeEconomics/HouseholdClassComparisonView.test.tsx
```

Expected: FAIL because the component currently renders `profile.lifeStage` directly.

- [ ] **Step 3: Render the composite profile formatter**

Replace the raw life-stage cell with:

```tsx
<Typography variant="body2" sx={{ fontWeight: 600, minWidth: 96 }}>
  {formatHouseholdProfileLabel(household.profile.lifeStage, household.profile.family)}
</Typography>
```

Continue using `profileId` only as a React key.

- [ ] **Step 4: Run the focused test and confirm GREEN**

```bash
npm test -- src/components/homeEconomics/HouseholdClassComparisonView.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the comparison presentation**

```bash
git add src/components/homeEconomics/HouseholdClassComparisonView.tsx src/components/homeEconomics/HouseholdClassComparisonView.test.tsx
git commit -m "fix: humanize household class comparison"
```

---

### Task 10: Run the Project C regression audit and full verification

**Files:**
- Verify only; modify only Project C files if a failure proves a Project C regression.

**Interfaces:**
- Verifies the full presentation invariant across student, assignment, teacher, server projection, and comparison paths.

- [ ] **Step 1: Scan Project C UI files for forbidden user-facing fallbacks**

Run:

```bash
rg -n "error instanceof Error \? error\.message|profileLabel \?\? householdId|\?\? entry\.profileId|\?\? profileId|\?\? householdId|\?\? teamId" \
  src/components/homeEconomics \
  src/components/teacher/HouseholdTeacherDashboard.tsx
```

Expected: no user-facing occurrence. Internal key/value logic is allowed only after manual inspection confirms it is not rendered.

- [ ] **Step 2: Scan for known Home Economics backend tokens in JSX/user copy**

Run:

```bash
rg -n "DOMESTIC_STOCK|FOREIGN_STOCK|INVESTMENT_TRUST|CHILD_REARING|INDEPENDENT|MULTI_PERSON_PER_TEAM|ROLE_VARIANT|STAGE_SPLIT|SETTLING|OPEN" \
  src/components/homeEconomics \
  src/components/teacher/HouseholdTeacherDashboard.tsx
```

Expected: occurrences may remain in comparisons/control flow/test fixtures, but no occurrence may be directly rendered as normal user-facing copy. Inspect every match rather than treating the scan itself as proof.

- [ ] **Step 3: Run all focused Project C client tests**

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

- [ ] **Step 4: Run all focused Project C Functions tests**

```bash
npm test --workspace=functions -- \
  src/homeEconomics/realtimeProjection.test.ts \
  src/homeEconomics/processRound.publishRealtimeState.test.ts \
  src/homeEconomics/householdAssignmentRepository.test.ts \
  src/homeEconomics/teacherDashboard.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run repository verification gates**

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run verify --workspace=functions
```

Expected: all PASS. Do not claim Project C complete if any command fails.

- [ ] **Step 6: Review the final diff for scope**

```bash
git status --short
git diff --stat codex/classroom...HEAD
git diff --name-only codex/classroom...HEAD
```

Expected: only the files named by Tasks 1-9 (plus this plan if the implementation branch includes it). No market/research, lesson-intervention, organization/admin, operator, dependency, lockfile, or unrelated formatting changes.

- [ ] **Step 7: Commit any verification-only test correction, if one was required by a genuine Project C regression**

If no file changed during verification, do not create an empty commit. If a Project C test/code correction was necessary, commit only the affected Project C files with a specific message describing that correction.

---

## Project C Completion Criteria

Project C is complete only when all of the following are true:

1. Common and advanced team-state projections carry semantic profile data without any additional profile lookup.
2. Student household tabs/cards never use `teamId`, runtime `householdId`, or `profileId` as display fallbacks.
3. Life-stage, concept, asset, course-format, assignment-state, validation-state, and round-status values shown in UI use human presentation copy.
4. Asset controls show human labels but still send the original asset-type wire value to submission callbacks.
5. Assignment controls show semantic profile labels but still send the original `profileId`/`householdId` in updates.
6. Teacher rows receive semantic profile data instead of a server-generated `lifeStage・family` string.
7. Missing team/profile semantics fail closed to fixed Japanese copy, never an internal ID.
8. Bulk-settlement internal `errorMessage` is never copied into a teacher warning.
9. Student and teacher household containers never display raw `Error.message`.
10. Class comparison formats its already-public profile semantics client-side and does not show `profileId`.
11. Sentinel tests prove unknown enum values, opaque IDs, and backend-secret error messages do not appear verbatim.
12. `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run verify --workspace=functions` all pass.

## Explicit Non-Goals

- Do not redesign household simulation rules, settlement math, assignments, checkpoints, or final-comparison scoring.
- Do not remove runtime `householdId` or logical `profileId` from domain/API contracts where they are required for identity.
- Do not redesign the advanced RTDB `.profile` payload; retaining it alongside the new state-level `profileSummary` is acceptable for compatibility.
- Do not change Firestore/RTDB authorization rules unless a failing existing rule test proves this narrowly-scoped DTO enrichment requires it; the added profile summary contains only fictional/public semantic fields already available to the same team in advanced mode.
- Do not add new Firebase reads to construct presentation labels.
- Do not move Japanese UI copy into Cloud Functions.
- Do not implement Project D teacher lesson-runtime/intervention work, Project E organization/template work, or Project F operator/audit work.
