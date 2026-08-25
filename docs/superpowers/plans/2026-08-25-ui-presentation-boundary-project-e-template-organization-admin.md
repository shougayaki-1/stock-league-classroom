# Project E — Template / Organization Admin Presentation Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Every task follows RED → confirm failure → minimal GREEN → focused PASS → commit.

**Goal:** Remove opaque organization/member/runtime identifiers, raw backend enums, and raw backend errors from normal teacher/school-admin template and organization-management UI while preserving internal IDs in routing, authorization, API payloads, audit storage, and React keys.

**Architecture:** Extend the existing client-side `organizationLabels.ts` presentation layer for roles/statuses/plan/move/audit copy. Add one server-backed organization-choice projection for cases where the client currently has only opaque org IDs, and selectively enrich member/audit/student-search DTOs where human-readable identity is otherwise unavailable. Keep security authorization server-side. Do not generate Japanese presentation copy on the server merely to compensate for missing client formatting.

**Tech Stack:** React 19, TypeScript, MUI, Vite, Vitest, Testing Library, Firebase Functions v2, Firestore/Admin SDK, Firebase Admin Auth.

**Spec:** `docs/superpowers/specs/2026-08-24-ui-presentation-boundary-design.md`

## Implementation Base

This plan was written while `codex/classroom` was still at the Project D review base:

```text
c39cf8ac56dca17b0226e5d8e90dcd125ea6220f
```

Project D is approved but was not yet merged when this plan was authored, and Project D also changes `src/App.tsx` / `src/App.test.tsx`.

**Do not implement Project E from this planning branch or from the old SHA.** Before implementation:

```bash
git fetch origin
git switch codex/classroom
git pull --ff-only origin codex/classroom
git rev-parse origin/codex/classroom
```

Verify Project D has been integrated, then create the Project E feature branch from the latest `origin/codex/classroom`. Never reset `codex/classroom` back to `c39cf8ac...`.

## Global Constraints

- Normal teacher/school-admin UI must not render opaque `orgId`, UID/Auth UID, backend enum/status token, raw operation phase, or raw `Error.message`.
- Internal IDs remain valid for route params, Firestore paths, authorization, React keys, callback arguments, Callable payloads, and audit storage when they are not rendered.
- Never use `LABELS[value] ?? value`, `label ?? internalId`, or `error instanceof Error ? error.message : fallback` in user-facing render/control paths.
- Unknown wire values fail closed to fixed Japanese copy and never echo the raw input.
- Reuse `src/lib/presentation/organizationLabels.ts`, `src/lib/presentation/lessonLabels.ts`, and `src/lib/monitoring/describeError.ts` rather than creating page-local duplicate mappings.
- Client code must not perform per-row/per-ID name lookups. Where semantic data is missing, enrich an existing response or use the organization-choice API below.
- Persistent audit logs retain raw actor UID/action/internal metadata for investigation; Project E changes only the school-admin read projection/presentation.
- Operator pages and operator technical-info separation remain Project F.
- Project D behavior must not regress while resolving `App.tsx` / `App.test.tsx` changes.
- Personal organizations currently do **not** persist a `name`. Server DTOs must represent that fact honestly (`name: string | null`); the client may present a semantic fallback such as `個人用` based on organization type. Do not manufacture Japanese display copy in the server DTO.

---

## Task 1 — Expand organization presentation vocabulary

**Files**
- Modify: `src/lib/presentation/organizationLabels.ts`
- Modify: `src/lib/presentation/organizationLabels.test.ts`

Add safe formatters for values currently printed raw in Project E:

```ts
formatOrganizationVerificationStatus(value)
formatPlanId(value)
formatTemplateMoveStatus(value)
formatTemplateMovePhase(value)
formatAuditAction(value)
formatAuditResult(value)
formatOrganizationChoiceName(choice)
```

`formatOrganizationChoiceName` rules:
- non-empty persisted `name` → that authored/stored name;
- `type === 'personal'` with no name → `個人用`;
- other missing/blank names → `組織名を確認できません`;
- never return `orgId`.

Known move statuses: `PENDING`, `RUNNING`, `FAILED`, `COMPLETED`.

Known move phases are the five existing server phases:
- `STAGING_MATERIALS`
- `MIGRATING_VERSIONS`
- `COMMITTING_OWNERSHIP`
- `FINALIZING_MATERIALS`
- `FINALIZING_FIRESTORE`

Verification mapping must cover persisted statuses present in the latest branch (at minimum current `PENDING`, plus any verified/rejected states already supported elsewhere). Known product plan IDs used by the repository (for example `FREE`, `SCHOOL`, `PARENT_ORG`) get human labels; unknown values fail closed.

Audit action mapping is presentation-only. Cover known school-admin-visible actions already emitted in the repository, including at minimum `EXPORT_ORG_STUDENT_DATA` and `REQUEST_MOVE_LESSON_TEMPLATE`. Unknown action → `操作内容を確認できません`.

### RED

Inject:

```text
UNKNOWN_INTERNAL_STATUS
INTERNAL_MOVE_PHASE
secret-plan-id
RAW_AUDIT_ACTION
org-secret-id
```

Assert no formatter returns those values verbatim.

### Verify

```bash
npm test -- src/lib/presentation/organizationLabels.test.ts
```

### Commit

```bash
git add src/lib/presentation/organizationLabels.ts src/lib/presentation/organizationLabels.test.ts
git commit -m "feat: expand organization presentation labels"
```

---

## Task 2 — Add one human-readable organization-choice projection

**Files**
- Create: `functions/src/organizations/organizationChoices.ts`
- Create: `functions/src/organizations/organizationChoices.test.ts`
- Modify: `functions/src/organizations/onCall.ts`
- Modify: `functions/src/organizations/onCall.test.ts`
- Modify: `functions/src/index.ts`
- Create: `src/lib/organizations/organizationChoices.ts`
- Create: `src/lib/organizations/organizationChoices.test.ts`

**Contract**

```ts
export type OrganizationChoice = {
  orgId: string
  name: string | null
  type: 'personal' | 'school' | 'parentOrg'
  role: 'owner' | 'admin' | 'teacher'
  verificationStatus?: string
  parentOrgId?: string | null
}

export const listMyOrganizationChoices = (
  functions: Functions,
): Promise<OrganizationChoice[]>
```

Callable:

```text
listMyOrganizationChoicesCallable
```

Security:
- authenticated verified teacher only;
- caller UID comes only from `request.auth.uid`;
- only organizations where the caller's member doc exists and is `status === 'active'` are returned;
- return only the fields above.

### Read strategy

The current schema has no canonical UID → organizations index. Do **not** invent a partially maintained inverse index in this project.

Use a bounded server-side organization read plus batched/chunked `getAll` membership-document reads; filter by caller UID/status in memory and then project organization semantics. This is intentionally a server-side compatibility bridge for the current schema and avoids client N+1 requests. Keep the membership lookup batched/chunked rather than issuing one awaited read per organization.

If the implementation environment exposes a correct existing indexed membership query in the latest branch, prefer it, but do not alter authorization semantics or add a new index that cannot be kept in sync by every membership mutation path.

### Uses

Template move:
- `role === 'owner'`;
- exclude current source org.

Parent-org school linking:
- `type === 'school'`;
- role owner/admin;
- no current `parentOrgId`;
- exclude already-linked children.

### RED

Fixtures must include:
- active owner/admin/teacher memberships;
- suspended membership;
- unrelated org;
- personal org with `name: null`.

Assert only active memberships are returned; raw IDs remain DTO identity but are not synthesized into names.

Client wrapper must send no UID argument.

### Verify

```bash
npm test -- src/lib/organizations/organizationChoices.test.ts
npm --prefix functions test -- src/organizations/organizationChoices.test.ts src/organizations/onCall.test.ts
```

### Commit

```bash
git add functions/src/organizations/organizationChoices.ts \
  functions/src/organizations/organizationChoices.test.ts \
  functions/src/organizations/onCall.ts functions/src/organizations/onCall.test.ts \
  functions/src/index.ts \
  src/lib/organizations/organizationChoices.ts src/lib/organizations/organizationChoices.test.ts
git commit -m "feat: add organization choice projection"
```

---

## Task 3 — Humanize the template-move workflow

**Files**
- Modify: `src/components/teacher/templates/TemplateEditorPage.tsx`
- Modify: `src/components/teacher/templates/TemplateEditorPage.test.tsx`
- Modify: `src/lib/lessonTemplates/moveLessonTemplate.ts`
- Modify: `functions/src/lessonTemplates/onCall.ts`
- Modify: `functions/src/lessonTemplates/onCall.test.ts`

Add:

```ts
organizationChoices: OrganizationChoice[]
```

to `TemplateEditorPageProps`.

Only choices where `role === 'owner'` and `orgId !== current orgId` may be move targets. Keep `targetOrgId` as internal state/value but show `formatOrganizationChoiceName(choice)` in the select/list. Never show org ID as option text, placeholder, helper text, or fallback.

If no usable target exists, show fixed copy such as:

```text
移動できる組織がありません。
```

Do not fall back to an org-ID text field.

### Confirmation contract

Replace “re-enter target organization ID” with a human confirmation phrase:

```text
移動する
```

Keep the existing `confirmationText` request field for compatibility, but change server validation from:

```ts
confirmationText === targetOrgId
```

to:

```ts
confirmationText === '移動する'
```

Existing server authorization still requires owner membership on both source and target. Do not weaken it.

### Presentation fixes

- `所有者 (owner)` → Japanese-only copy.
- `COMMUNITY 公開` → `コミュニティ公開`.
- move `status` and `phase` through Task 1 formatters.
- never render `moveOpStatus.lastError`; failed status gets fixed action-oriented copy.
- upload/preview/move failures use `describeError`; never raw `Error.message`.

### RED

Use target choice:

```ts
{ orgId: 'org-secret-target', name: '青葉高校', type: 'school', role: 'owner' }
```

Assert:
- teacher selects `青葉高校`;
- `org-secret-target` is absent from visible text;
- preview/move payloads still contain `targetOrgId: 'org-secret-target'`;
- old org-ID confirmation fails server validation;
- `confirmationText: '移動する'` passes validation/authorization;
- unknown move status/phase and `lastError: 'backend-secret-message'` never render.

### Verify

```bash
npm test -- src/components/teacher/templates/TemplateEditorPage.test.tsx
npm --prefix functions test -- src/lessonTemplates/onCall.test.ts
```

### Commit

```bash
git add src/components/teacher/templates/TemplateEditorPage.tsx \
  src/components/teacher/templates/TemplateEditorPage.test.tsx \
  src/lib/lessonTemplates/moveLessonTemplate.ts \
  functions/src/lessonTemplates/onCall.ts functions/src/lessonTemplates/onCall.test.ts
git commit -m "fix: humanize template move workflow"
```

---

## Task 4 — Enrich member identity and remove UID/role/status presentation

**Files**
- Modify: `functions/src/organizations/orgMembers.ts`
- Modify: `functions/src/organizations/orgMembers.test.ts`
- Modify: `src/lib/organizations/orgMembers.ts`
- Modify: `src/lib/organizations/orgMembers.test.ts`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`

Extend member read view additively:

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

`listOrgMembersWithAdminSdk` already resolves users with one Admin Auth `getUsers` batch. Extend that same batch resolution to return display name; no per-member Auth requests.

UI identity priority:

```ts
displayName?.trim()
  || email?.trim()
  || 'メンバー名を確認できません'
```

Never fall back to UID.

Use shared formatters for member role/status and invitation role/status. Role selects keep internal values `owner/admin/teacher`; option text and accessible labels are human Japanese and based on member display identity, never UID.

### RED

Render:

```ts
{
  uid: 'uid-secret-value',
  email: null,
  displayName: null,
  role: 'UNKNOWN_ROLE' as never,
  status: 'UNKNOWN_MEMBER_STATUS' as never,
}
```

Assert raw UID/enum strings are absent while fixed fallback labels appear. Separately prove UID still reaches `onSuspendMember` / `onChangeRole` payloads when a valid fixture is operated on.

### Verify

```bash
npm test -- src/lib/organizations/orgMembers.test.ts src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx
npm --prefix functions test -- src/organizations/orgMembers.test.ts
```

### Commit

```bash
git add functions/src/organizations/orgMembers.ts functions/src/organizations/orgMembers.test.ts \
  src/lib/organizations/orgMembers.ts src/lib/organizations/orgMembers.test.ts \
  src/components/teacher/organizations/SchoolOrgSettingsPage.tsx \
  src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx
git commit -m "fix: present school members by human identity"
```

---

## Task 5 — Use real organization names and human deletion confirmation

**Files**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`
- Modify: `src/components/teacher/organizations/ParentOrgSettingsPage.tsx`
- Modify: `src/components/teacher/organizations/ParentOrgSettingsPage.test.tsx`

`SchoolOrgSettingsRoute` already reads `organizations/{orgId}`. Capture `name` in that same read instead of passing `orgName={orgId}`. If the document lacks a usable name, pass fixed `組織名を確認できません` rather than the route ID.

If a school has `parentOrgId`, one direct parent-org document read is acceptable because it is one relationship lookup, not a row-by-row N+1. Pass the parent's persisted name; missing/error → fixed generic copy, never `parentOrgId`.

`ParentOrgSettingsRoute` reads its current organization document once and passes its persisted name; missing → fixed generic copy.

### Delete confirmation

Change `ConfirmDeleteOrgForm` from org-ID confirmation to visible organization-name confirmation:

```text
確認のため組織名「青葉高校」を入力してください
```

Typing the org ID must not enable deletion. Typing the displayed organization name enables the callback. The actual purge callback still uses internal `orgId`.

### RED

Route fixtures:

```text
school-secret-id -> 青葉高校
parent-secret-id -> 東日本教育法人
```

Assert raw route IDs are absent from headings/normal text.

### Verify

```bash
npm test -- src/App.test.tsx \
  src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx \
  src/components/teacher/organizations/ParentOrgSettingsPage.test.tsx
```

### Commit

```bash
git add src/App.tsx src/App.test.tsx \
  src/components/teacher/organizations/SchoolOrgSettingsPage.tsx \
  src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx \
  src/components/teacher/organizations/ParentOrgSettingsPage.tsx \
  src/components/teacher/organizations/ParentOrgSettingsPage.test.tsx
git commit -m "fix: present organization names instead of ids"
```

---

## Task 6 — Replace parent-org school ID entry with entity selection

**Files**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/components/teacher/organizations/ParentOrgSettingsPage.tsx`
- Modify: `src/components/teacher/organizations/ParentOrgSettingsPage.test.tsx`

Add:

```ts
organizationChoices: OrganizationChoice[]
```

to `ParentOrgSettingsPageProps`.

Candidate schools:

```ts
organizationChoices.filter((choice) =>
  choice.type === 'school'
  && (choice.role === 'owner' || choice.role === 'admin')
  && !choice.parentOrgId
)
```

Also exclude schools already present in `childSchools`.

Render `formatOrganizationChoiceName(choice)` only; keep `orgId` as option value/callback identity. Replace explanatory `owner/admin` tokens with Japanese copy.

Existing child-school `verificationStatus` must pass through `formatOrganizationVerificationStatus`; unknown values fail closed.

`ParentOrgSettingsRoute` calls `listMyOrganizationChoices` once and passes the result. Do not fetch a school name after selection.

### RED

Fixtures:
- `school-secret-owned` / `青葉高校` / owner / unlinked;
- `school-secret-admin` / `若葉中学校` / admin / unlinked;
- teacher-only school;
- already-linked school.

Assert only eligible names are selectable, raw IDs are absent, and selecting `青葉高校` calls:

```ts
onLinkSchool('school-secret-owned')
```

Inject `verificationStatus: 'INTERNAL_VERIFY_STATE'`; raw value must not render.

### Verify

```bash
npm test -- src/components/teacher/organizations/ParentOrgSettingsPage.test.tsx src/App.test.tsx
```

### Commit

```bash
git add src/App.tsx src/App.test.tsx \
  src/components/teacher/organizations/ParentOrgSettingsPage.tsx \
  src/components/teacher/organizations/ParentOrgSettingsPage.test.tsx
git commit -m "fix: select schools by name in parent settings"
```

---

## Task 7 — Make school-admin student search presentation-ready

**Files**
- Modify: `functions/src/privacy/searchOrgStudentData.ts`
- Modify: `functions/src/privacy/searchOrgStudentData.test.ts`
- Modify: `src/lib/privacy/orgStudentDataSearch.ts`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`

Extend each search match additively:

```ts
lessonTitle?: string
```

`searchOrgStudentData` already has each eligible lesson-run record before participant lookup. Copy a human lesson title from that run into each match. Do not add a second lesson-run lookup per participant/match.

Presentation:
- primary: display name or `生徒名を確認できません`;
- secondary: lesson title or `授業名を確認できません`, external identifier if present, and `formatParticipantStatus(status)`;
- never render `lessonRunId`, `participantId`, `authUid`, `teamId`, raw `identityMode`, or raw status.

IDs remain in DTO/internal keys.

### RED

Server fixture run title `株式学習A` must yield `lessonTitle: '株式学習A'` without extra run-lookup dependency.

UI fixture injects:

```text
lesson-secret-id
participant-secret-id
uid-secret-value
team-secret-id
UNKNOWN_PARTICIPANT_STATUS
```

None may render verbatim.

### Verify

```bash
npm test -- src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx
npm --prefix functions test -- src/privacy/searchOrgStudentData.test.ts
```

### Commit

```bash
git add functions/src/privacy/searchOrgStudentData.ts functions/src/privacy/searchOrgStudentData.test.ts \
  src/lib/privacy/orgStudentDataSearch.ts \
  src/components/teacher/organizations/SchoolOrgSettingsPage.tsx \
  src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx
git commit -m "fix: humanize school student-data search results"
```

---

## Task 8 — Enrich audit-log actor identity and action presentation

**Files**
- Modify: `functions/src/privacy/onCall.ts`
- Modify: `functions/src/privacy/onCall.test.ts`
- Modify: `src/lib/privacy/orgAuditLog.ts`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`

Extend the **read projection only**:

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

Do not alter persisted audit documents.

`listOrgAuditLogCallable` collects unique actor UIDs from already-read entries and resolves them with one Admin Auth `getUsers` batch. Multiple entries by the same actor must not cause duplicate Auth lookups. Missing/deleted users yield null identity fields.

UI identity priority:

```ts
actorDisplayName?.trim()
  || actorEmail?.trim()
  || '実行者を確認できません'
```

Map action/result through Task 1 formatters. Never display `actorUid` as normal identity/fallback.

### RED

Use two entries from one UID plus one unknown UID. Verify one batched identity resolution and additive actor fields. UI injects `uid-secret-value`, `RAW_AUDIT_ACTION`, and unknown result cast; raw values do not render.

### Verify

```bash
npm test -- src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx
npm --prefix functions test -- src/privacy/onCall.test.ts
```

### Commit

```bash
git add functions/src/privacy/onCall.ts functions/src/privacy/onCall.test.ts \
  src/lib/privacy/orgAuditLog.ts \
  src/components/teacher/organizations/SchoolOrgSettingsPage.tsx \
  src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx
git commit -m "fix: present audit logs with human actor identity"
```

---

## Task 9 — Apply shared presentation formatters to archive, billing, and plan limits

**Files**
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`
- Modify: `src/components/teacher/organizations/BillingSection.tsx`
- Modify: `src/components/teacher/organizations/BillingSection.test.tsx`
- Modify: `src/components/teacher/organizations/PlanLimitsPage.tsx`
- Modify: `src/components/teacher/organizations/PlanLimitsPage.test.tsx`

School archive:
- remove duplicate page-local archive status map;
- use `formatAnnualArchiveJobStatus(job.status)`;
- remove `?? job.status` fail-open fallback.

Billing:
- remove duplicate local payment method labels;
- use `formatBillingPaymentMethod`;
- invoice rows use `formatInvoiceStatus(invoice.status)`, never raw status;
- invoice-subscription status may remain internal conditional logic but is never printed raw.

Plan limits:
- scheduled downgrade uses `formatPlanId(pendingPlanChange.planId)`;
- downgrade `state` remains internal control flow only.

### RED

Inject via cast:

```text
INTERNAL_ARCHIVE_STATUS
INTERNAL_INVOICE_STATUS
secret-plan-id
```

None may render.

### Verify

```bash
npm test -- \
  src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx \
  src/components/teacher/organizations/BillingSection.test.tsx \
  src/components/teacher/organizations/PlanLimitsPage.test.tsx
```

### Commit

```bash
git add src/components/teacher/organizations/SchoolOrgSettingsPage.tsx \
  src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx \
  src/components/teacher/organizations/BillingSection.tsx \
  src/components/teacher/organizations/BillingSection.test.tsx \
  src/components/teacher/organizations/PlanLimitsPage.tsx \
  src/components/teacher/organizations/PlanLimitsPage.test.tsx
git commit -m "fix: humanize organization billing and archive states"
```

---

## Task 10 — Wire organization choices into App routes and protect Project D integration

**Files**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

`TemplateEditRoute` loads `listMyOrganizationChoices(services.functions)` once and passes choices to `TemplateEditorPage`. On failure, pass an empty list / explicit error state and show fixed UI copy such as `移動できる組織を確認できません`; never restore an org-ID text box.

`ParentOrgSettingsRoute` uses the same wrapper for school linking. Route-local loading/error state is sufficient; do not create an app-wide organization store.

App-level regressions verify:
- template editor receives human org choices and does not surface `org-secret-target`;
- parent school link uses school name and preserves callback ID internally;
- school/parent settings headings use organization names, not route IDs;
- Project D teacher control and recovery routes still render after integrating latest `App.tsx` changes.

### Verify

```bash
npm test -- src/App.test.tsx
```

### Commit

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "test: wire organization presentation choices"
```

---

## Task 11 — Project E regression audit and full verification

Run focused suites first:

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

Presentation scan:

```bash
rg -n "error instanceof Error \? error\.message|\?\?\s*(orgId|.*Uid|.*Id|.*status|.*phase)|組織ID|owner\)|ownerまたはadmin|actorUid|invoice\.status|verificationStatus|lastError" \
  src/components/teacher/templates \
  src/components/teacher/organizations \
  src/lib/presentation \
  src/App.tsx
```

Interpret matches. IDs/statuses in callbacks, routes, DTO types, tests, authorization, or internal comparisons are allowed. A failure is a raw internal value reaching normal teacher/school-admin text or an opaque-ID input.

### Sentinel invariant

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

Assert none appears verbatim in rendered teacher/school-admin text. Where identity is needed for commands, separately assert the same IDs still reach callback/Callable payloads.

### Full verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm --prefix functions run verify
git diff --check
```

If practical, also run root `npm run verify`. If emulator-dependent verification is blocked by the known Java/proxy environment issue, report that limitation exactly; do not claim PASS and do not change production code merely to accommodate the environment.

Final diff audit:

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

1. Template move target is selected by human organization label; no organization-ID text entry exists.
2. Template move progress never renders raw status/phase/`lastError`, and upload/preview/move errors never render raw backend messages.
3. School and parent settings use organization names or fixed semantic fallbacks rather than route IDs.
4. School deletion confirmation uses visible organization name, not org ID.
5. Member rows and role controls use displayName/email/generic fallback; UID is never a normal display fallback.
6. Member/invitation/verification/archive/billing/plan statuses are presentation-formatted and unknown values fail closed.
7. Parent-org school linking selects a managed school by name and keeps `schoolOrgId` only as internal callback identity.
8. School-admin student search does not render lessonRunId/participantId/authUid/teamId/raw status; it uses lesson title and safe participant status.
9. Audit-log primary display uses human actor identity and Japanese action/result copy; raw actor UID/action remain only in underlying DTO/audit storage.
10. No client N+1 ID-to-name lookups are introduced; organization choices and actor/member identity are server/batch resolved.
11. Project D `App.tsx` behavior remains intact after integration.
12. Full non-environment-blocked verification passes and sentinel raw-value regressions are covered.

## Explicitly Out of Scope

- Operator pages / technical-info presentation: Project F.
- Repository-wide cleanup outside template/organization/admin UI: Project F.
- Billing product/pricing or Stripe contract redesign.
- Rewriting the organization schema or removing internal IDs from APIs/audit logs.
- Building a new long-lived UID → organization membership index/backfill migration; Project E uses the current schema with server-side batched reads.
- Household/market/lesson-runtime Presentation Boundary work already owned by Projects B/C/D.
