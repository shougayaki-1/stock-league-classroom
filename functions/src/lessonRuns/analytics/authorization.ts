import { getFirestore } from 'firebase-admin/firestore'
import type { LessonRunRole } from '@stock-league/lesson-runtime-types'
import { canControlLesson } from '../authorization'

/**
 * §Task 15 brief Step 2's個票アクセス境界 (individual-record access
 * boundary). This is a *stricter, orthogonal* axis from
 * `authorization.ts`'s `LessonControlAction` table: `VIEW_RESULTS`
 * (PRIMARY/ASSISTANT/VIEWER) already governs "may this teacher see this
 * run's aggregate class-wide results at all" — that check is reused as-is
 * for `'AGGREGATE'` below. `'INDIVIDUAL'` (per-student raw data — names,
 * per-question survey answers, per-response rationale) is deliberately
 * narrower than `VIEW_RESULTS`: a VIEWER (read-only observer role, e.g. a
 * mentor teacher sitting in) can see the class's aggregate numbers but not
 * any single student's individual answers.
 *
 * Design decision (no single existing pattern covers this combination, so
 * this module composes two existing primitives — `requireActiveOrgMember`'s
 * *shape*, reimplemented here via injectable `getOrgMembership` rather than
 * imported directly, so this module's authorization logic stays testable
 * with plain fixtures instead of a Firestore emulator, matching how
 * `submitSurvey.ts`'s `resolveParticipant` and `participants/onCall.ts`'s
 * `requireLessonControlAuthorization` are both structured):
 *
 *  1. The run must exist.
 *  2. The caller must be an ACTIVE member of the run's own `orgId` — a
 *     member of a different org is rejected outright, before their
 *     `teacherRoles` entry (if any) is even consulted. This closes the
 *     "different org" half of the brief's requirement even for a caller who
 *     coincidentally shares a uid with a `teacherRoles` entry on someone
 *     else's run (defense in depth; in practice uids are globally unique
 *     Firebase Auth uids so this cannot really collide, but the check does
 *     not rely on that).
 *  3. The caller's role is read from *this run's own* `teacherRoles` map
 *     (`LessonRun.teacherRoles`, Task 9's per-run role model) — never from
 *     org-level `owner`/`admin`/`teacher`. This is what makes the "org
 *     owner/admin cannot read individual records of a run they are not
 *     assigned to" requirement hold: `LessonRunRole` and org `role` are two
 *     separate axes, and this function only ever branches on the former.
 *     An owner/admin who is *also* explicitly added to `teacherRoles` (e.g.
 *     they are personally teaching this run) is treated exactly like any
 *     other PRIMARY/ASSISTANT/VIEWER — being an org owner grants no
 *     implicit run access on top of that. This is the safe-by-default
 *     choice the task explicitly asks for when the brief's spec leaves the
 *     owner/admin case open ("既定で個票を読めない" — by default, not
 *     "never, even if explicitly assigned").
 *  4. For `'INDIVIDUAL'`, only `PRIMARY`/`ASSISTANT` pass — `VIEWER` is
 *     excluded even though `canControlLesson('VIEW_RESULTS')` allows it,
 *     which is exactly the narrowing described above.
 */
export type AnalyticsAccessLevel = 'AGGREGATE' | 'INDIVIDUAL'

export interface AnalyticsAccessDeps {
  getRun: (lessonRunId: string) => Promise<{ orgId: string; teacherRoles: Record<string, LessonRunRole> } | undefined>
  getOrgMembership: (orgId: string, uid: string) => Promise<{ role: 'owner' | 'admin' | 'teacher'; status: string } | undefined>
}

export interface AnalyticsAccessResult {
  orgId: string
}

export const requireAnalyticsAccess = async (
  deps: AnalyticsAccessDeps,
  lessonRunId: string,
  uid: string,
  level: AnalyticsAccessLevel,
): Promise<AnalyticsAccessResult> => {
  const run = await deps.getRun(lessonRunId)
  if (!run) throw new Error('LessonRun not found')

  const membership = await deps.getOrgMembership(run.orgId, uid)
  if (!membership || membership.status !== 'active') {
    throw new Error('有効な組織メンバーではありません。')
  }

  const runRole = run.teacherRoles[uid]
  const allowed = level === 'AGGREGATE'
    ? !!runRole && canControlLesson(runRole, 'VIEW_RESULTS')
    : runRole === 'PRIMARY' || runRole === 'ASSISTANT'

  if (!allowed) {
    throw new Error(
      level === 'AGGREGATE'
        ? 'この授業の分析結果を閲覧する権限がありません。'
        : '個票データを閲覧する権限がありません。担当の主担当・補助担当教師のみアクセスできます。',
    )
  }

  return { orgId: run.orgId }
}

/** Production wiring: Firestore Admin SDK, matching every other lessonRuns authorization guard's shape. */
export const requireAnalyticsAccessWithAdminSdk = (
  lessonRunId: string,
  uid: string,
  level: AnalyticsAccessLevel,
): Promise<AnalyticsAccessResult> => {
  const db = getFirestore()
  return requireAnalyticsAccess({
    getRun: async (id) => {
      const snap = await db.doc(`lessonRuns/${id}`).get()
      if (!snap.exists) return undefined
      return { orgId: snap.get('orgId') as string, teacherRoles: (snap.get('teacherRoles') as Record<string, LessonRunRole>) ?? {} }
    },
    getOrgMembership: async (orgId, memberUid) => {
      const snap = await db.doc(`organizations/${orgId}/members/${memberUid}`).get()
      if (!snap.exists) return undefined
      return { role: snap.get('role'), status: snap.get('status') }
    },
  }, lessonRunId, uid, level)
}
