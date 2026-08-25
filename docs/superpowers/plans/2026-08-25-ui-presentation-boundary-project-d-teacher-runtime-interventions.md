# Teacher Runtime + Intervention Scenarios — Project D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (preferred) or `superpowers:executing-plans`. Follow every task RED → verify failure → minimal GREEN → focused verification → commit.

**Goal:** Remove internal phase/status/participant/team/input/Auth-UID values from normal teacher-facing lesson runtime UI and replace the remaining raw-ID intervention entry points with purpose-built entity-selection workflows, while preserving IDs internally for Firestore identity and Callable payloads.

**Architecture:** Reuse Project A presentation formatters and the existing teacher-readable Firestore participant/team/response collections. Do not invent a broad new server DTO. `LessonControlRoom` receives the already-loaded template phase graph from `App.tsx`, subscribes to teacher-only team/response records, and passes semantic entities into `InterventionPanel`. The five intervention scenarios are: existing `CorrectStateForm` (hardened), new `ProxyConfirmForm`, `ChangeRepresentativeForm`, `ReconnectParticipantForm`, and `RestorePreviousPhaseForm`. Reconnect must use the existing recovery-code handshake; a teacher must never type or see a student's Auth UID.

**Specs:**
- `docs/superpowers/specs/2026-08-24-ui-presentation-boundary-design.md`
- `docs/superpowers/specs/2026-08-19-classroom-display-wiring-and-interventions-design.md`

**Baseline note:** This plan was authored from `codex/classroom` at `d40b0700828cc230413c344b6d9853bb9029576f` while Project C was still on its approved feature branch. **Do not implement Project D until Project C has been merged into `codex/classroom`.** At implementation start, fetch and use the then-current `origin/codex/classroom`; never reset it back to `d40b070...`.

---

## Global constraints

- Target branch is `codex/classroom`, never `main`.
- Implementation must start from the latest `origin/codex/classroom` after Project C integration.
- Reuse `src/lib/presentation/lessonLabels.ts` and `src/lib/monitoring/describeError.ts`; do not create parallel status/error dictionaries.
- Normal teacher UI must not render `currentPhaseId`, `participantId`, `teamId`, `inputId`, `authUid`, `newAuthUid`, raw backend enum tokens, or raw `Error.message`.
- IDs remain valid internally for React keys, Firestore lookup/subscriptions, impact scopes, and Callable payloads.
- Never use `label ?? internalId`, `LABELS[value] ?? value`, or `error instanceof Error ? error.message : ...` on user-facing paths.
- Unknown/missing semantic labels fail closed to fixed Japanese copy.
- Existing authorization-driven omission remains unchanged: unauthorized intervention types are not rendered.
- Existing teacher-readable Firestore rules for `participants`, `teams`, and `responses` are the source of truth. Do not weaken Firestore/RTDB rules.
- Do not add N+1 reads or one read per participant/response.
- Do not expand into organization/template/operator Presentation Boundary work (Projects E/F).
- Do not redesign Home Economics Project C while doing this work.

Required regression invariant:

> If fixtures contain `UNKNOWN_INTERNAL_PHASE`, `participant-secret-id`, `team-secret-id`, `input-secret-id`, `uid-secret-value`, or `backend-secret-message`, none of those exact raw values may appear in normal teacher-rendered text.

---

## Task 1 — Teacher runtime presentation vocabulary in `LessonControlRoom`

**Files:**
- Modify: `src/components/teacher/LessonControlRoom.tsx`
- Modify: `src/components/teacher/LessonControlRoom.test.tsx`

**Existing issue:**

```ts
const phaseLabel = publicState?.currentPhaseLabel
  ?? publicState?.currentPhaseId
  ?? (status === 'DRAFT' || status === 'READY' ? '未開始' : status)
```

This violates the Presentation Boundary by falling back to `currentPhaseId` and then raw status.

### RED

Add tests that:

1. emit `{ status: 'RUNNING', currentPhaseId: 'UNKNOWN_INTERNAL_PHASE', currentPhaseLabel: null }`;
2. expect `フェーズ名を確認できません`;
3. assert the DOM does not contain `UNKNOWN_INTERNAL_PHASE` or raw `RUNNING` as the phase label;
4. emit a valid `currentPhaseLabel: '取引'` and preserve that label;
5. exercise display mode formatting through Project A rather than a local map.

Run:

```bash
npm test -- src/components/teacher/LessonControlRoom.test.tsx
```

Verify RED against the current raw-ID fallback test.

### GREEN

- Import `formatCurrentPhaseLabel` and `formatLessonDisplayMode` from `src/lib/presentation/lessonLabels.ts`.
- Replace the raw phase fallback with:

```ts
const phaseLabel = formatCurrentPhaseLabel(publicState?.currentPhaseLabel, status)
```

- Remove the local `DISPLAY_MODE_LABEL` table and use `formatLessonDisplayMode(displayState.mode)`.
- Keep `currentPhaseId` internally for `onAdvancePhase`, result generation, timer intervention detail, etc.; do not render it.
- Reverse/delete the old test that explicitly expected `market` to be visible when the label was absent.

Run the focused test and commit:

```bash
git add src/components/teacher/LessonControlRoom.tsx src/components/teacher/LessonControlRoom.test.tsx
git commit -m "fix: fail closed on teacher runtime labels"
```

---

## Task 2 — Preparation screen status presentation

**Files:**
- Modify: `src/components/teacher/LessonPreparationPage.tsx`
- Modify: `src/components/teacher/LessonPreparationPage.test.tsx`

**Existing issues:**
- copy contains `入室待機状態（WAITING）`;
- participant list uses `participant.status === 'ACTIVE' ? '参加中' : participant.status`.

### RED

Add tests that:

- `WAITING` does not appear in visible preparation copy;
- participant status `TEMPORARILY_DISCONNECTED` renders as `一時切断`;
- an injected casted status `UNKNOWN_PARTICIPANT_STATUS` renders `参加状態を確認できません` and the raw token is absent.

Run:

```bash
npm test -- src/components/teacher/LessonPreparationPage.test.tsx
```

### GREEN

- import and use `formatParticipantStatus`;
- replace `（WAITING）` with product copy such as `生徒の入室待機状態`;
- do not change transition payloads (`targetStatus: 'WAITING'` remains internal).

Commit:

```bash
git add src/components/teacher/LessonPreparationPage.tsx src/components/teacher/LessonPreparationPage.test.tsx
git commit -m "fix: humanize lesson preparation statuses"
```

---

## Task 3 — Teacher-only entity projections for intervention selection

**Files:**
- Create: `src/lib/lessonRuns/teams.ts`
- Create: `src/lib/lessonRuns/teams.test.ts`
- Create: `src/lib/lessonRuns/teacherResponses.ts`
- Create: `src/lib/lessonRuns/teacherResponses.test.ts`
- Modify: `src/components/teacher/LessonControlRoom.tsx`
- Modify: `src/components/teacher/LessonControlRoom.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

### Contract

Create a client mirror of the existing teacher-readable team record:

```ts
export interface LessonTeamView {
  id: string
  displayName: string
  memberParticipantIds: string[]
  representativeParticipantId?: string
  confirmationMode: 'REPRESENTATIVE' | 'ALL' | 'QUORUM'
}
```

Create the minimum teacher response projection needed for proxy-confirm selection:

```ts
export interface TeacherResponseView {
  id: string
  participantId?: string
  teamId?: string
  phaseId: string
  inputId: string
  status: 'DRAFT' | 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'CONFIRMED'
}
```

Use collection-level `onSnapshot` subscriptions, matching `subscribeLessonParticipants`; do not query each entity individually.

`subscribeTeacherResponses` may deliver all response records and let the control room derive `status === 'APPROVED'`, or query APPROVED if the SDK/index path is already straightforward. Do not add a Functions callable merely to rename IDs.

### RED

Tests must prove:
- team and response collection subscriptions use `lessonRuns/{runId}/teams` and `lessonRuns/{runId}/responses`;
- IDs survive in returned objects as internal identity;
- no presentation fallback is performed in these repository modules.

Update `TeacherAccess` / `LessonControlRoomProps` so the already-loaded phase graph can be passed from `TeacherControlRoute`:

```ts
phases?: PhaseWithDisplayConfig[]
```

`LessonControlRoom` subscribes once to teams and teacher responses and passes the resulting entities downstream.

Run focused tests, then commit:

```bash
git add src/lib/lessonRuns/teams.ts src/lib/lessonRuns/teams.test.ts \
  src/lib/lessonRuns/teacherResponses.ts src/lib/lessonRuns/teacherResponses.test.ts \
  src/components/teacher/LessonControlRoom.tsx src/components/teacher/LessonControlRoom.test.tsx \
  src/App.tsx src/App.test.tsx
git commit -m "feat: provide semantic intervention target data"
```

---

## Task 4 — Harden the existing `CorrectStateForm` as intervention scenario 1/5

**Files:**
- Modify: `src/components/teacher/interventionForms/CorrectStateForm.tsx`
- Modify: `src/components/teacher/interventionForms/interventionForms.test.tsx`

The form already selects participants/teams by human name. Project D should preserve it as the reference interaction and make its fail-closed behavior explicit.

### RED

Add tests with:

```ts
{ id: 'participant-secret-id', displayName: '' }
{ teamId: 'team-secret-id', displayName: '   ' }
```

Assert:
- the raw IDs never render;
- missing names render fixed copy (`生徒名を確認できません` / `チーム名を確認できません`);
- after selecting a valid named entity, the submitted detail still contains the internal target ID.

### GREEN

Normalize option labels locally without ever using ID fallback. Keep server detail shape unchanged:

```ts
{ target, targetId, displayName }
```

Commit:

```bash
git add src/components/teacher/interventionForms/CorrectStateForm.tsx src/components/teacher/interventionForms/interventionForms.test.tsx
git commit -m "fix: fail closed in state correction targets"
```

---

## Task 5 — `ProxyConfirmForm` as intervention scenario 2/5

**Files:**
- Create: `src/components/teacher/interventionForms/ProxyConfirmForm.tsx`
- Modify: `src/components/teacher/interventionForms/interventionForms.test.tsx`
- Modify: `src/components/teacher/InterventionPanel.tsx`
- Modify: `src/components/teacher/InterventionPanel.test.tsx`

### Behavior

The teacher must select an APPROVED response as an entity, never type `phaseId`, `inputId`, or participant ID.

Props should provide:
- approved `TeacherResponseView[]`;
- participants with `id`, `displayName`, `teamId`, `status`;
- `LessonTeamView[]`;
- phase options from the template graph.

For each response, build human copy from:
- phase label (`readPhaseLabel` + fixed `フェーズ名を確認できません` fallback);
- participant/team display name with fixed generic fallback;
- `回答`/ordinal when multiple responses would otherwise share the same visible label.

Never render `response.id`, `phaseId`, `inputId`, participant ID, or team ID.

For an individual response, the on-behalf participant is fixed to `response.participantId`.

For a team response:
- `REPRESENTATIVE`: use the team's current `representativeParticipantId`;
- `ALL` / `QUORUM`: show a member selector by participant display name and submit the selected member internally.

The form must return both the internal detail and the correct impact scope:

```ts
{
  detail: { phaseId, inputId, onBehalfOfParticipantId },
  impactScope: { level: 'PARTICIPANT', participantId } | { level: 'TEAM', teamId },
}
```

### RED sentinel test

Use `phaseId: 'UNKNOWN_INTERNAL_PHASE'`, `inputId: 'input-secret-id'`, participant/team sentinel IDs and assert none are rendered; human/generic labels are rendered instead. On submit, assert IDs still reach `onSubmit`.

Remove the old `InterventionPanel.test.tsx` test that types `フェーズID`, `入力ID`, and `対象参加者ID`.

Commit:

```bash
git add src/components/teacher/interventionForms/ProxyConfirmForm.tsx \
  src/components/teacher/interventionForms/interventionForms.test.tsx \
  src/components/teacher/InterventionPanel.tsx src/components/teacher/InterventionPanel.test.tsx
git commit -m "feat: add entity based proxy confirmation"
```

---

## Task 6 — `ChangeRepresentativeForm` as intervention scenario 3/5

**Files:**
- Create: `src/components/teacher/interventionForms/ChangeRepresentativeForm.tsx`
- Modify: `src/components/teacher/interventionForms/interventionForms.test.tsx`
- Modify: `src/components/teacher/InterventionPanel.tsx`
- Modify: `src/components/teacher/InterventionPanel.test.tsx`

### Behavior

Two-step entity selection:
1. choose team by `displayName`;
2. choose a member of that team by participant `displayName`.

Do not show `teamId` or participant ID. Prefer excluding the current representative from selectable replacement options; if no replacement exists, show a human explanation and no submit action.

Submit:

```ts
{
  detail: { teamId, newRepresentativeParticipantId },
  impactScope: { level: 'TEAM', teamId },
}
```

Sentinel tests must prove `team-secret-id` / `participant-secret-id` do not render while the same IDs remain in the callback payload.

Commit with focused tests.

---

## Task 7 — Recovery-code reconnect as intervention scenario 4/5

**Files:**
- Create: `src/components/teacher/interventionForms/ReconnectParticipantForm.tsx`
- Create: `src/components/teacher/interventionForms/ReconnectParticipantForm.test.tsx`
- Create: `src/components/student/ParticipantRecoveryPage.tsx`
- Create: `src/components/student/ParticipantRecoveryPage.test.tsx`
- Modify: `src/components/teacher/InterventionPanel.tsx`
- Modify: `src/components/teacher/InterventionPanel.test.tsx`
- Modify: `src/components/teacher/LessonControlRoom.tsx`
- Modify: `src/components/teacher/LessonControlRoom.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

### Architectural rule

Do **not** ask the teacher for `newAuthUid`. Do not expose Auth UID anywhere.

Use the existing safe handshake:

- teacher: `issueRecoveryCode(functions, { lessonRunId, participantId, idempotencyKey })`;
- student/new device: `recoverParticipant(functions, { lessonRunId, code, idempotencyKey })`, where the Callable derives the new Auth UID from authenticated request context.

Do not route normal teacher UI through the current generic `RECONNECT_PARTICIPANT` detail contract requiring `newAuthUid`.

### Teacher form

- show only participants in reconnect-relevant statuses (`TEMPORARILY_DISCONNECTED`, `MIGRATING_DEVICE`, `ABSENT` unless product tests establish a narrower existing policy);
- label with participant display name + `formatParticipantStatus`;
- after issuance, show the recovery code (this is a deliberate user-facing bearer code, like a join code) and a human instruction;
- provide a `再接続ページを開く/コピー` link whose URL may internally carry `lessonRunId`, but never render the raw run ID as normal copy;
- classify failures using existing `mapRecoveryError` or `describeError`; never raw `Error.message`.

### Student recovery page

Add an unguarded recovery route carrying the run identity in the route, e.g.:

```text
/lessons/:runId/recover
```

The page:
- ensures a student auth UID exists using the existing anonymous-auth helper before redeeming;
- asks only for the recovery code;
- calls `recoverParticipant`;
- after success navigates to `/lessons/:runId/waiting` (the membership mirror written by recovery is then the normal access boundary);
- maps recovery failures to fixed Japanese copy;
- never displays `runId`, old/new Auth UID, participant ID, or backend error text.

### RED

Tests must inject `uid-secret-value`, `participant-secret-id`, and `backend-secret-message` and assert none render. Also prove the teacher request payload contains only `lessonRunId`, `participantId`, `idempotencyKey` — no `newAuthUid`.

This task intentionally uses the dedicated recovery Callable rather than changing the generic intervention server contract; the latter may remain for internal/backward compatibility but is no longer reachable through normal teacher UI.

Commit after focused tests.

---

## Task 8 — `RestorePreviousPhaseForm` as intervention scenario 5/5

**Files:**
- Create: `src/components/teacher/interventionForms/RestorePreviousPhaseForm.tsx`
- Modify: `src/components/teacher/interventionForms/interventionForms.test.tsx`
- Modify: `src/components/teacher/InterventionPanel.tsx`
- Modify: `src/components/teacher/InterventionPanel.test.tsx`

### Behavior

Do not allow a teacher to type `targetPhaseId`.

From the phase graph passed by `App.tsx`, derive direct predecessor candidates:

```ts
phase.nextPhaseIds?.includes(currentPhaseId)
```

Render only human phase labels. Use `readPhaseLabel`; if the authored label is missing, display fixed `フェーズ名を確認できません`, never the phase ID.

Submit:

```ts
{
  detail: { targetPhaseId },
  impactScope: { level: 'LESSON' },
}
```

If there is no predecessor, show a fixed explanation and no executable submit button.

Keep the existing server guard that refuses restoration after REFLECTION/terminal statuses; do not weaken it.

Sentinel test: `targetPhaseId: 'UNKNOWN_INTERNAL_PHASE'` must never be visible but must remain the internal callback value.

Commit after focused tests.

---

## Task 9 — Remove generic raw-ID fields from `InterventionPanel` and forward semantic impact scopes

**Files:**
- Modify: `src/components/teacher/InterventionPanel.tsx`
- Modify: `src/components/teacher/InterventionPanel.test.tsx`
- Modify: `src/components/teacher/LessonControlRoom.tsx`
- Modify: `src/components/teacher/LessonControlRoom.test.tsx`

### RED

Assert that normal PRIMARY teacher intervention UI contains none of:

- `フェーズID`
- `入力ID`
- `参加者ID`
- `チームID`
- `認証UID`
- `新しい認証UID`

and contains no generic detail `TextField` generated from an ID field catalog.

### GREEN

- Delete `DetailFieldSpec` and raw-ID field arrays for the four migrated scenarios.
- Render all five purpose-built scenario forms explicitly.
- Update `InterventionApplyInput` to carry `impactScope` where the form knows it.
- `LessonControlRoom.handleApplyIntervention` must forward that scope rather than hard-code `{ level: 'LESSON' }` for every type.
- Types whose scope is inherently lesson-wide may default to LESSON in the panel.
- Add local user-facing intervention error state. Await/catch `applyTeacherIntervention` and render `describeError(error, '介入操作を実行できませんでした。')`.
- Do not close the panel on failed apply; allow retry.
- Keep authorization visibility unchanged.

Commit after focused tests.

---

## Task 10 — App/runtime integration regression

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: affected route tests only if required by the recovery route / phase-prop wiring

Verify end-to-end wiring:

- `TeacherControlRoute` passes `access.phases` into `LessonControlRoom`;
- phase IDs remain in transition callbacks but never become option text;
- recovery route is reachable without teacher auth and uses student authentication/recovery flow;
- after successful recovery, navigation uses the normal waiting/play route and never exposes UID or participant ID;
- Project C household control rendering still works after Project D props/subscriptions are added.

Add an App-level regression with sentinel phase/team/participant IDs where practical. The rendered UI must contain human/generic labels only.

Commit:

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "test: wire teacher intervention presentation boundary"
```

---

## Task 11 — Project D regression audit and full verification

Run the focused suites first:

```bash
npm test -- \
  src/components/teacher/LessonControlRoom.test.tsx \
  src/components/teacher/LessonPreparationPage.test.tsx \
  src/components/teacher/InterventionPanel.test.tsx \
  src/components/teacher/interventionForms/interventionForms.test.tsx \
  src/components/teacher/interventionForms/ReconnectParticipantForm.test.tsx \
  src/components/student/ParticipantRecoveryPage.test.tsx \
  src/lib/lessonRuns/teams.test.ts \
  src/lib/lessonRuns/teacherResponses.test.ts \
  src/App.test.tsx
```

Presentation scan:

```bash
rg -n "currentPhaseLabel\s*\?\?\s*.*currentPhaseId|label\s*\?\?\s*.*Id|participant\.status\s*===.*: participant\.status|newAuthUid|フェーズID|入力ID|参加者ID|チームID|認証UID|error\.message" \
  src/components/teacher src/components/student src/lib/lessonRuns
```

Interpret matches. Domain types, internal payloads, tests, or the recovery client result type may legitimately contain IDs/`newAuthUid`; the failure condition is a user-facing render/control-flow dependency that exposes them.

Run full verification:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm --prefix functions run verify
git diff --check
```

If practical, also run:

```bash
npm run verify
```

If emulator-dependent checks are blocked by the known Java/proxy sandbox problem, report that exact environmental limitation; do not claim PASS and do not change production code merely to appease the environment.

Final diff audit:

```bash
git status --short
git diff --stat origin/codex/classroom...HEAD
git diff --name-only origin/codex/classroom...HEAD
git log --oneline origin/codex/classroom..HEAD
```

Do not include Project E/F files or unrelated refactors.

---

## Completion criteria

Project D is complete only when all of the following are true:

1. `LessonControlRoom` never falls back from phase label to phase ID/raw status.
2. `LessonPreparationPage` contains no raw WAITING/participant-status presentation.
3. Normal intervention UI has no raw ID/Auth-UID entry fields.
4. `CorrectStateForm`, `ProxyConfirmForm`, `ChangeRepresentativeForm`, `ReconnectParticipantForm`, and `RestorePreviousPhaseForm` are entity-first workflows.
5. Proxy confirmation preserves internal `phaseId`/`inputId`/participant/team identity in payloads but never displays them.
6. Representative changes preserve `teamId`/participant ID in payloads but present team/member names.
7. Reconnect requires only choosing a participant and relaying a recovery code; teacher never types or sees `newAuthUid`.
8. Previous-phase restore uses authored/fail-closed phase labels and never phase IDs.
9. Intervention impact scopes are no longer unconditionally LESSON when the operation targets a participant/team.
10. Unknown/sentinel IDs/enums/backend errors do not appear verbatim in rendered teacher UI.
11. Existing authorization gates and server restore/reflection safety rules remain intact.
12. Full non-environment-blocked verification passes.
