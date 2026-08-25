# Project E — Template / Organization Admin Presentation Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove opaque organization/member/runtime identifiers, raw backend enums, and raw backend errors from normal teacher/school-admin template and organization-management UI while preserving internal IDs in routing, authorization, API payloads, audit storage, and React keys.

**Architecture:** Extend the existing client-side `organizationLabels.ts` presentation layer for roles/statuses/plan/move/audit copy. Add one server-backed organization-choice projection for cases where the client currently has only opaque org IDs, and selectively enrich member/audit/student-search DTOs where human-readable identity is not otherwise available. Keep security authorization server-side and keep IDs in domain/API contracts; only presentation and input affordances change.

**Tech Stack:** React 19, TypeScript, MUI, Vite, Vitest, Testing Library, Firebase Functions v2, Firestore/Admin SDK, Firebase Admin Auth.

**Spec:** `docs/superpowers/specs/2026-08-24-ui-presentation-boundary-design.md`

## Implementation Base

This plan was written while `codex/classroom` was still at the Project D review base (`c39cf8ac56dca17b0226e5d8e90dcd125ea6220f`). Project D is approved but not yet merged at plan-writing time and also changes `src/App.tsx` / `src/App.test.tsx`.

**Do not implement Project E from this planning branch or from the old SHA.** Before implementation:

```bash
git fetch origin
git switch codex/classroom
git pull --ff-only origin codex/classroom
```

Verify Project D has been integrated, then create the Project E feature branch from the latest `origin/codex/classroom`. Do not reset the branch back to `c39cf8ac...`.

## Global Constraints

- Student/teacher/school-admin normal UI must not render opaque `orgId`, UID/Auth UID, backend enum/status token, raw operation phase, or raw `Error.message`.
- Internal IDs remain valid for route params, Firestore paths, authorization, React keys, callback arguments, Callable payloads, and audit storage when they are not rendered.
- Never use `LABELS[value] ?? value`, `label ?? internalId`, or `error instanceof Error ? error.message : fallback` in user-facing render/control paths.
- Unknown wire values fail closed to fixed Japanese copy and never echo the input string.
- Reuse `src/lib/presentation/organizationLabels.ts` and `src/lib/monitoring/describeError.ts`; do not create page-local duplicate label maps unless the value is truly page-specific author copy.
- Client code must not perform per-ID name lookups. Where semantic data is missing, enrich an existing response or use the organization-choice API below.
- Persistent audit logs must retain raw actor UID/action/internal metadata for investigation; Project E only changes the school-admin read projection/presentation.
- Operator pages and operator technical-info separation remain Project F.
- Project D behavior must not be regressed when resolving `App.tsx` / `App.test.tsx` conflicts.
- Every task follows RED -> confirm failure -> minimal GREEN -> focused PASS -> commit.

---

### Task 1: Expand organization presentation vocabulary

**Files:**
- Modify: `src/lib/presentation/organizationLabels.ts`
- Modify: `src/lib/presentation/organizationLabels.test.ts`

**Interfaces:**
- Consumes: existing `safeLabel`, member/invitation/billing/archive label maps.
- Produces:

```ts
export const formatOrganizationVerificationStatus: (value: string | null | undefined) => string
export const formatPlanId: (value: string | null | undefined) => string
export const formatTemplateMoveStatus: (value: string | null | undefined) => string
export const formatTemplateMovePhase: (value: string | null | undefined) => string
export const formatAuditAction: (value: string | null | undefined) => string
export const formatAuditResult: (value: string | null | undefined) => string
```

`formatTemplateMoveStatus` should map `PENDING/RUNNING/FAILED/COMPLETED`; `formatTemplateMovePhase` should map the existing five phases from `functions/src/lessonTemplates/moveLessonTemplate.ts`. Verification should at minimum map the currently persisted `PENDING` and any already-supported verified/rejected states found in the current branch; all unrecognized strings use a fixed fallback. Plan IDs should map known product plans used by the repository (for example `FREE`, `SCHOOL`, `PARENT_ORG`) and fail closed otherwise.

Audit action mapping is presentation-only. Map known school-admin-visible actions already emitted by the repository, including at minimum `EXPORT_ORG_STUDENT_DATA` and `REQUEST_MOVE_LESSON_TEMPLATE`; unknown action strings render `操作内容を確認できません`.

- [ ] **Step 1: Write failing formatter tests**

Add tests that inject `UNKNOWN_INTERNAL_STATUS`, `INTERNAL_MOVE_PHASE`, `secret-plan-id`, and `RAW_AUDIT_ACTION` and assert none are returned verbatim.

- [ ] **Step 2: Run RED**

```bash
npm test -- src/lib/presentation/organizationLabels.test.ts
```

Expected: FAIL because the new formatters do not exist.

- [ ] **Step 3: Implement exhaustive/safe mappings**

Use `satisfies Record<Union, string>` where the client has a closed union and `safeLabel` for wire `string` values. Never return the input value as fallback.

- [ ] **Step 4: Run focused PASS**

```bash
npm test -- src/lib/presentation/organizationLabels.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/presentation/organizationLabels.ts src/lib/presentation/organizationLabels.test.ts
git commit -m "feat: expand organization presentation labels"
```

---

### Task 2: Add one human-readable organization-choice projection

**Files:**
- Create: `functions/src/organizations/organizationChoices.ts`
- Create: `functions/src/organizations/organizationChoices.test.ts`
- Modify: `functions/src/organizations/onCall.ts`
- Modify: `functions/src/organizations/onCall.test.ts`
- Modify: `functions/src/index.ts`
- Create: `src/lib/organizations/organizationChoices.ts`
- Create: `src/lib/organizations/organizationChoices.test.ts`

**Interfaces:**

```ts
export type OrganizationChoice = {
  orgId: string
  name: string
  type: 'personal' | 'school' | 'parentOrg'
  role: 'owner' | 'admin' | 'teacher'
  verificationStatus?: string
  parentOrgId?: string | null
}

export const listMyOrganizationChoices = (
  functions: Functions,
): Promise<OrganizationChoice[]>
```

Server callable name:

```ts
listMyOrganizationChoicesCallable
```

Security contract:
- authenticated verified teacher only;
- return only organizations where `organizations/{orgId}/members/{callerUid}` exists with `status === 'active'`;
- never accept a UID from client input;
- return only the fields above.

Production read pattern must be **one organizations query plus one batched membership lookup**, not one client/server request per organization. Use Admin SDK `getAll(...memberRefs)` (or an equivalent single batched read) after obtaining organization documents, then filter in memory. Do not expose organizations for which the caller lacks active membership.

This projection is used by two UIs:
- template move: filter to `role === 'owner'`, because the existing move Callable already requires owner on source and target;
- parent-org school linking: filter to `type === 'school'`, `role` owner/admin, and no existing `parentOrgId`.

- [ ] **Step 1: RED pure projection tests**

Use fixtures containing owned/admin/teacher/suspended/unrelated organizations. Assert only active memberships are returned and names/types/roles are preserved while unrelated orgs are omitted.

- [ ] **Step 2: RED callable/client-wrapper tests**

Assert no UID argument is accepted/sent by the client wrapper and unauthenticated/non-teacher callers are rejected.

- [ ] **Step 3: Implement server helper + callable + export + client wrapper**

Keep authorization in the Callable boundary and projection logic independently testable.

- [ ] **Step 4: Focused verification**

```bash
npm test -- src/lib/organizations/organizationChoices.test.ts
npm --prefix functions test -- src/organizations/organizationChoices.test.ts src/organizations/onCall.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add functions/src/organizations/organizationChoices.ts \
  functions/src/organizations/organizationChoices.test.ts \
  functions/src/organizations/onCall.ts functions/src/organizations/onCall.test.ts \
  functions/src/index.ts \
  src/lib/organizations/organizationChoices.ts src/lib/organizations/organizationChoices.test.ts
git commit -m "feat: add organization choice projection"
```

---

### Task 3: Replace template-move org ID entry and raw progress/error presentation

**Files:**
- Modify: `src/components/teacher/templates/TemplateEditorPage.tsx`
- Modify: `src/components/teacher/templates/TemplateEditorPage.test.tsx`
- Modify: `src/lib/lessonTemplates/moveLessonTemplate.ts`
- Modify: `functions/src/lessonTemplates/onCall.ts`
- Modify: `functions/src/lessonTemplates/onCall.test.ts`

**Interfaces:**

Add to `TemplateEditorPageProps`:

```ts
organizationChoices: OrganizationChoice[]
```

Only choices with `role === 'owner'` and `orgId !== current orgId` are valid move targets.

Keep `targetOrgId` as internal state/value but render the target `name` in a select/list. Do not render `orgId` as option text, placeholder, helper text, or confirmation copy.

Change the move confirmation UI from “re-enter target organization ID” to the fixed human phrase:

```text
移動する
```

Keep the existing `confirmationText` field for compatibility within the client/server call shape, but change the Callable validation from `confirmationText === targetOrgId` to `confirmationText === '移動する'`. Authorization remains unchanged: the existing server still requires owner membership on both source and target organizations.

Presentation requirements:
- replace `所有者 (owner)` with Japanese-only copy;
- `COMMUNITY 公開` -> `コミュニティ公開`;
- map move `status` and `phase` through Task 1 formatters;
- never render `moveOpStatus.lastError`; when status is failed, show a fixed action-oriented message such as `移動処理で問題が発生しました。状態を確認してもう一度お試しください。`;
- `upload`, preview, and move failures must use `describeError`, never raw `Error.message`.

- [ ] **Step 1: Rewrite existing move test to RED**

Replace the test that types `移転先組織ID` and the org ID confirmation with an organization-name selection. Include sentinel target ID `org-secret-target` and assert it never appears in rendered text while preview/move callbacks still receive it.

- [ ] **Step 2: Add raw status/error leak tests**

Inject unknown move status/phase via cast and `lastError: 'backend-secret-message'`; assert raw strings are absent.

- [ ] **Step 3: Add server RED for fixed confirmation phrase**

Old `confirmationText: targetOrgId` must fail; `confirmationText: '移動する'` must pass input validation/authorization.

- [ ] **Step 4: Implement minimal UI/server change**

Do not weaken owner checks or move-operation idempotency.

- [ ] **Step 5: Focused verification**

```bash
npm test -- src/components/teacher/templates/TemplateEditorPage.test.tsx
npm --prefix functions test -- src/lessonTemplates/onCall.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/components/teacher/templates/TemplateEditorPage.tsx \
  src/components/teacher/templates/TemplateEditorPage.test.tsx \
  src/lib/lessonTemplates/moveLessonTemplate.ts \
  functions/src/lessonTemplates/onCall.ts functions/src/lessonTemplates/onCall.test.ts
git commit -m "fix: humanize template move workflow"
```

---

### Task 4: Enrich member identity and remove UID/role/status presentation from school settings

**Files:**
- Modify: `functions/src/organizations/orgMembers.ts`
- Modify: `functions/src/organizations/orgMembers.test.ts`
- Modify: `src/lib/organizations/orgMembers.ts`
- Modify: `src/lib/organizations/orgMembers.test.ts`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`

**Interfaces:**

Extend member view additively:

```ts
export interface OrgMember {
  uid: string
  email: string | null
  displayName?: string | null
  role: 'owner' | 'admin' | 'teacher'
  status: 'active' | 'suspended'
  membershipVersion: number
}
```

`listOrgMembersWithAdminSdk` already does one Admin Auth `getUsers` batch. Extend that same batch resolution to return `displayName`; do not add one Auth request per member.

School UI identity priority:

```ts
displayName?.trim() || email?.trim() || 'メンバー名を確認できません'
```

Never fall back to UID.

Use Task 1 / existing Project A formatters for member role, member status, invitation role/status. Role selects keep the internal values `owner/admin/teacher`, but option text and field labels use Japanese labels and the human member name/email. The accessible label must not contain UID.

- [ ] **Step 1: RED member projection test**

Assert the server/client result carries displayName from the existing batch Auth lookup.

- [ ] **Step 2: RED school settings sentinel test**

Render a member `{ uid: 'uid-secret-value', email: null, displayName: null }` and unknown-cast role/status. Assert the UID/raw enum strings are absent and generic safe labels are present.

- [ ] **Step 3: Implement identity and formatter use**

Use UID only for `key`, permission comparisons, `onSuspendMember`, and `onChangeRole` payloads.

- [ ] **Step 4: Focused verification**

```bash
npm test -- src/lib/organizations/orgMembers.test.ts src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx
npm --prefix functions test -- src/organizations/orgMembers.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add functions/src/organizations/orgMembers.ts functions/src/organizations/orgMembers.test.ts \
  src/lib/organizations/orgMembers.ts src/lib/organizations/orgMembers.test.ts \
  src/components/teacher/organizations/SchoolOrgSettingsPage.tsx \
  src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx
git commit -m "fix: present school members by human identity"
```

---

### Task 5: Use real organization names and human confirmation in school/parent routes

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`
- Modify: `src/components/teacher/organizations/ParentOrgSettingsPage.tsx`
- Modify: `src/components/teacher/organizations/ParentOrgSettingsPage.test.tsx`

**Behavior:**

`SchoolOrgSettingsRoute` already reads `organizations/{orgId}`. Capture its `name` in the same read instead of passing `orgName={orgId}`. If it has `parentOrgId`, fetch that one parent organization document and pass its `name`; on failure/missing name use `組織名を確認できません`, never the parent ID.

`ParentOrgSettingsRoute` should read the current parent organization document once and pass its `name`; do not pass `orgName={orgId}`.

Change `ConfirmDeleteOrgForm` to require the visible organization name rather than org ID:

```text
確認のため組織名「〇〇」を入力してください
```

The callback still performs `purgeSchoolOrg({ orgId })`; only the user confirmation value changes.

- [ ] **Step 1: RED route tests**

Use `school-secret-id` / `parent-secret-id` route params with organization docs named `青葉高校` / `東日本教育法人`. Assert headings and parent text use names and raw IDs are absent from rendered text.

- [ ] **Step 2: RED deletion confirmation test**

Typing the org ID must not enable deletion; typing the visible org name must enable it. Callback identity remains internal.

- [ ] **Step 3: Implement route metadata + confirmation**

No new Callable is needed for the current org name; reuse the existing Firestore reads.

- [ ] **Step 4: Focused verification**

```bash
npm test -- src/App.test.tsx src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx src/components/teacher/organizations/ParentOrgSettingsPage.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.test.tsx \
  src/components/teacher/organizations/SchoolOrgSettingsPage.tsx \
  src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx \
  src/components/teacher/organizations/ParentOrgSettingsPage.tsx \
  src/components/teacher/organizations/ParentOrgSettingsPage.test.tsx
git commit -m "fix: present organization names instead of ids"
```

---

### Task 6: Replace parent-org “school organization ID” entry with entity selection

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/components/teacher/organizations/ParentOrgSettingsPage.tsx`
- Modify: `src/components/teacher/organizations/ParentOrgSettingsPage.test.tsx`

**Interfaces:**

Add to `ParentOrgSettingsPageProps`:

```ts
organizationChoices: OrganizationChoice[]
```

Candidate schools:

```ts
organizationChoices.filter((choice) =>
  choice.type === 'school'
  && (choice.role === 'owner' || choice.role === 'admin')
  && !choice.parentOrgId
)
```

Exclude schools already represented in `childSchools` and the current parent org.

Render school `name` as option text and keep `orgId` only as the option value/callback argument. Replace explanatory `owner/admin` tokens with Japanese copy. Existing `onLinkSchool(schoolOrgId)` contract stays unchanged.

Existing child-school `verificationStatus` must pass through `formatOrganizationVerificationStatus`; unknown values use fixed fallback.

`ParentOrgSettingsRoute` should call `listMyOrganizationChoices` once and pass the result. Do not fetch a school name after selection.

- [ ] **Step 1: RED selector test**

Fixture candidates should include:
- `school-secret-owned` / `青葉高校` / owner / unlinked;
- `school-secret-admin` / `若葉中学校` / admin / unlinked;
- teacher-only and already-linked schools.

Assert only the owner/admin unlinked school names are selectable, raw IDs are absent, and choosing `青葉高校` calls `onLinkSchool('school-secret-owned')`.

- [ ] **Step 2: RED unknown verification test**

`verificationStatus: 'INTERNAL_VERIFY_STATE'` must not render verbatim.

- [ ] **Step 3: Implement entity selection and App wiring**

Reuse Task 2 data; do not add a second school-choice API.

- [ ] **Step 4: Focused verification and commit**

```bash
npm test -- src/components/teacher/organizations/ParentOrgSettingsPage.test.tsx src/App.test.tsx
git add src/App.tsx src/App.test.tsx src/components/teacher/organizations/ParentOrgSettingsPage.tsx src/components/teacher/organizations/ParentOrgSettingsPage.test.tsx
git commit -m "fix: select schools by name in parent settings"
```

---

### Task 7: Make school-admin student search presentation-ready

**Files:**
- Modify: `functions/src/privacy/searchOrgStudentData.ts`
- Modify: `functions/src/privacy/searchOrgStudentData.test.ts`
- Modify: `src/lib/privacy/orgStudentDataSearch.ts`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`

**Interfaces:**

Extend each search match additively:

```ts
lessonTitle?: string
```

`searchOrgStudentData` already has each eligible lesson-run record before participant lookup. Copy a human lesson title from that run record into matches there; do not issue an extra lesson-run read per match.

Presentation:
- primary: participant display name or `生徒名を確認できません`;
- secondary: lesson title or `授業名を確認できません`, external identifier if present, and `formatParticipantStatus(status)`;
- never render `lessonRunId`, `participantId`, `authUid`, `teamId`, raw identityMode, or raw status.

IDs may remain in the DTO and React keys.

- [ ] **Step 1: RED server DTO test**

Assert a run fixture titled `株式学習A` yields matches with `lessonTitle: '株式学習A'` without an additional run lookup dependency.

- [ ] **Step 2: RED UI sentinel test**

Inject `lesson-secret-id`, `participant-secret-id`, `uid-secret-value`, `team-secret-id`, `UNKNOWN_PARTICIPANT_STATUS`. Assert none render; title/name/fixed status copy do.

- [ ] **Step 3: Implement additive enrichment + presentation**

- [ ] **Step 4: Focused verification and commit**

```bash
npm test -- src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx
npm --prefix functions test -- src/privacy/searchOrgStudentData.test.ts
git add functions/src/privacy/searchOrgStudentData.ts functions/src/privacy/searchOrgStudentData.test.ts \
  src/lib/privacy/orgStudentDataSearch.ts \
  src/components/teacher/organizations/SchoolOrgSettingsPage.tsx \
  src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx
git commit -m "fix: humanize school student-data search results"
```

---

### Task 8: Enrich school-admin audit log actor identity and action presentation

**Files:**
- Modify: `functions/src/privacy/onCall.ts`
- Modify: `functions/src/privacy/onCall.test.ts`
- Modify: `src/lib/privacy/orgAuditLog.ts`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`

**Interfaces:**

Extend read projection only:

```ts
export interface OrgAuditLogEntry {
  id: string
  actorUid: string
  actorDisplayName?: string | null
  actorEmail?: string | null
  action: string
  result: 'SUCCESS' | 'FAILURE'
  occurredAt: string | null
  reason?: string
}
```

Do **not** change persisted audit docs.

`listOrgAuditLogCallable` should collect unique actor UIDs from the already-read entries and resolve them with one Admin Auth `getUsers` batch. Missing users yield null identity fields. No per-entry Auth lookup.

UI actor priority:

```ts
actorDisplayName?.trim() || actorEmail?.trim() || '実行者を確認できません'
```

Map action/result through Task 1 formatters. Never show `actorUid` as the main or fallback identity.

- [ ] **Step 1: RED callable test for batch actor enrichment**

Use two entries by the same UID plus one unknown UID and verify one batch resolution produces additive displayName/email fields without removing raw actorUid from the DTO.

- [ ] **Step 2: RED UI sentinel test**

Inject `uid-secret-value`, `RAW_AUDIT_ACTION`, and unknown result cast. Assert no raw values render.

- [ ] **Step 3: Implement enrichment and safe display**

- [ ] **Step 4: Focused verification and commit**

```bash
npm test -- src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx
npm --prefix functions test -- src/privacy/onCall.test.ts
git add functions/src/privacy/onCall.ts functions/src/privacy/onCall.test.ts \
  src/lib/privacy/orgAuditLog.ts \
  src/components/teacher/organizations/SchoolOrgSettingsPage.tsx \
  src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx
git commit -m "fix: present audit logs with human actor identity"
```

---

### Task 9: Apply shared presentation formatters to archive, billing, and plan-limit UI

**Files:**
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`
- Modify: `src/components/teacher/organizations/BillingSection.tsx`
- Modify: `src/components/teacher/organizations/BillingSection.test.tsx`
- Modify: `src/components/teacher/organizations/PlanLimitsPage.tsx`
- Modify: `src/components/teacher/organizations/PlanLimitsPage.test.tsx`

**Behavior:**

School archive:
- remove the page-local archive status map;
- use `formatAnnualArchiveJobStatus(job.status)`;
- delete `?? job.status` fallback.

Billing:
- remove duplicate local payment-method labels;
- use `formatBillingPaymentMethod`;
- render invoice status through `formatInvoiceStatus`, never `invoice.status` directly;
- invoice subscription status may remain in internal conditional logic but must not be printed raw.

Plan limits:
- do not render `pendingPlanChange.planId` directly;
- use `formatPlanId`;
- downgrade `state` remains internal control flow only;
- existing user-facing billing/migration errors are fixed copy and may remain.

- [ ] **Step 1: RED unknown-value tests**

Inject `INTERNAL_ARCHIVE_STATUS`, `INTERNAL_INVOICE_STATUS`, and `secret-plan-id` by cast. Assert none render.

- [ ] **Step 2: Implement shared formatter use**

- [ ] **Step 3: Focused verification and commit**

```bash
npm test -- src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx \
  src/components/teacher/organizations/BillingSection.test.tsx \
  src/components/teacher/organizations/PlanLimitsPage.test.tsx
git add src/components/teacher/organizations/SchoolOrgSettingsPage.tsx \
  src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx \
  src/components/teacher/organizations/BillingSection.tsx \
  src/components/teacher/organizations/BillingSection.test.tsx \
  src/components/teacher/organizations/PlanLimitsPage.tsx \
  src/components/teacher/organizations/PlanLimitsPage.test.tsx
git commit -m "fix: humanize organization billing and archive states"
```

---

### Task 10: Wire organization choices into template editing and run App-level regression

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Behavior:**

`TemplateEditRoute` loads `listMyOrganizationChoices(services.functions)` once and passes choices into `TemplateEditorPage`. On failure, pass `[]`; the editor shows a fixed message such as `移動できる組織を確認できません` rather than falling back to an org-ID text box.

`ParentOrgSettingsRoute` uses the same wrapper as Task 6. If both routes need loading/error state, keep that route-local; do not introduce an app-wide organization store in this project.

App-level regressions must verify:
- template editor receives human org choices and does not surface `org-secret-target`;
- parent school-link flow uses school name and callback ID internally;
- school/parent settings heading is organization name, not route ID;
- Project D teacher control/recovery routes still render after the `App.tsx` merge conflict resolution.

- [ ] **Step 1: RED App tests**
- [ ] **Step 2: Implement minimal wiring**
- [ ] **Step 3: Run App test suite**

```bash
npm test -- src/App.test.tsx
```

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "test: wire organization presentation choices"
```

---

### Task 11: Project E regression audit and full verification

**Files:**
- Modify only tests/files required by a failure directly caused by Project E.

- [ ] **Step 1: Run focused Project E suites**

```bash
npm test -- \
  src/lib/presentation/organizationLabels.test.ts \
  src/lib/organizations/organizationChoices.test.ts \
  src/lib/organizations/orgMembers.test.ts \
  src/components/teacher/templates/TemplateEditorPage.test.tsx \
  src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx \
  src/components/teacher/organizations/ParentOrgSettingsPage.test.tsx \
  src/components/teacher/organizations/BillingSection.test.tsx \
  src/components/teacher/organizations/PlanLimitsPage.test.tsx \
  src/App.test.tsx

npm --prefix functions test -- \
  src/organizations/organizationChoices.test.ts \
  src/organizations/orgMembers.test.ts \
  src/organizations/onCall.test.ts \
  src/privacy/searchOrgStudentData.test.ts \
  src/privacy/onCall.test.ts \
  src/lessonTemplates/onCall.test.ts
```

- [ ] **Step 2: Presentation scan**

```bash
rg -n "error instanceof Error \? error\.message|\?\?\s*(orgId|.*Uid|.*Id|.*status|.*phase)|組織ID|owner\)|ownerまたはadmin|actorUid|invoice\.status|verificationStatus|lastError" \
  src/components/teacher/templates \
  src/components/teacher/organizations \
  src/lib/presentation \
  src/App.tsx
```

Interpret matches. IDs/statuses in callbacks, route building, tests, DTO types, or internal comparisons are allowed. A match is a failure only if raw internal data reaches normal teacher/school-admin text or an opaque-ID input.

- [ ] **Step 3: Sentinel invariant**

Across Project E tests inject at least:

```text
org-secret-id
uid-secret-value
UNKNOWN_MEMBER_STATUS
INTERNAL_VERIFY_STATE
INTERNAL_MOVE_PHASE
backend-secret-message
RAW_AUDIT_ACTION
secret-plan-id
```

Assert none appear verbatim in rendered teacher/school-admin text. Where identity is required for a command, assert the same org/member IDs still reach callbacks/Callable payloads.

- [ ] **Step 4: Full verification**

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm --prefix functions run verify
git diff --check
```

If practical, also run root `npm run verify`. If an emulator-dependent check is blocked only by the known Java/proxy environment issue, report the limitation exactly and do not claim PASS.

- [ ] **Step 5: Final diff audit**

```bash
git status --short
git diff --stat origin/codex/classroom...HEAD
git diff --name-only origin/codex/classroom...HEAD
git log --oneline origin/codex/classroom..HEAD
```

No Project F operator changes and no unrelated refactors.

---

## Completion Criteria

Project E is complete only when all of the following are true:

1. Template move target is selected by organization name; no organization-ID text entry exists.
2. Template move progress never renders raw status/phase/`lastError`, and upload/preview/move errors never render raw backend messages.
3. School and parent settings use organization names rather than route IDs as headings/labels.
4. School deletion confirmation uses human organization name, not org ID.
5. Member rows and role controls use displayName/email/generic fallback; UID is never a normal display fallback.
6. Member/invitation/verification/archive/billing/plan statuses are presentation-formatted and unknown values fail closed.
7. Parent-org school linking selects a managed school by name and keeps schoolOrgId only as internal callback identity.
8. School-admin student search does not render lessonRunId/participantId/authUid/teamId/raw status; it uses lesson title and safe participant status.
9. Audit log primary display uses human actor identity and Japanese action/result copy; raw actor UID/action remain only in the underlying DTO/audit storage.
10. No client N+1 ID-to-name lookups are introduced; organization choices and actor/member identity are server/batch resolved.
11. Project D `App.tsx` behavior remains intact after integration.
12. Full non-environment-blocked verification passes and sentinel raw-value regressions are covered.

## Explicitly Out of Scope

- Operator pages / technical-info presentation: Project F.
- Repository-wide cleanup outside template/organization/admin UI: Project F.
- Redesign of billing products/pricing or Stripe contract semantics.
- Rewriting Firestore organization schema or removing internal IDs from APIs/audit logs.
- Household/market/lesson-runtime Presentation Boundary work already owned by Projects B/C/D.
