import { getFirestore } from 'firebase-admin/firestore'
import { deriveDowngradeStatus, type DowngradeStatus, type LimitViolation, type PendingPlanChange } from './downgradeEnforcement'

/** lessonRunsのうち、同時授業・市場数を消費し続ける状態。 */
export const ACTIVE_LESSON_RUN_STATUSES = ['DRAFT', 'READY', 'WAITING', 'RUNNING', 'PAUSED', 'INTERRUPTED', 'REFLECTION'] as const

export interface PlanLimits {
  concurrentLessonsAndMarkets: number
  participants: number
  teacherSeats: number
  aiCredits: number
  templateStorage: number
  resultRetentionDays: number
  eventExtraCapacity: number
}

export interface PlanDefinition {
  planId: string
  displayName: string
  limits: PlanLimits
  stripePriceId: string | null
}

export interface PersistedPendingPlanChange {
  planId: string
  effectiveAt: unknown
}

export interface PersistedDowngradeGrace {
  planId: string
  endsAt: unknown
}

export interface DowngradeMetadata {
  pendingPlanChange?: PersistedPendingPlanChange
  downgradeGrace?: PersistedDowngradeGrace
}

export interface PlanLimitsResult extends PlanLimits {
  downgradeStatus: DowngradeStatus
}

export interface GetOrgPlanLimitsDeps {
  getOrgPlanId: (orgId: string) => Promise<string | null>
  getPlanDefinition: (planId: string) => Promise<PlanDefinition | null>
  getDowngradeMetadata?: (orgId: string) => Promise<DowngradeMetadata | null>
  countActiveLessonRuns?: (orgId: string) => Promise<number>
  countActiveTeachers?: (orgId: string) => Promise<number>
  nowMillis?: () => number
}

export interface GetOrgPlanLimitsInput { orgId: string }

const missingPlanError = () => new Error('この組織にはプランが設定されていません')

/** Resolves an organization's plan limits without silently falling back. */
const toMillis = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    const millis = value.toMillis()
    return typeof millis === 'number' && Number.isFinite(millis) ? millis : null
  }
  return null
}

const toPendingPlanChange = (value: PersistedPendingPlanChange | undefined): PendingPlanChange | null => {
  if (!value || typeof value.planId !== 'string') return null
  const effectiveAtMillis = toMillis(value.effectiveAt)
  return effectiveAtMillis == null ? null : { planId: value.planId, effectiveAtMillis }
}

const buildViolations = (limits: PlanLimits, activeLessonRuns: number, activeTeachers: number): LimitViolation[] => {
  const violations: LimitViolation[] = []
  if (activeLessonRuns >= limits.concurrentLessonsAndMarkets) {
    violations.push({ key: 'concurrentLessonsAndMarkets', label: '同時授業・市場数', used: activeLessonRuns, limit: limits.concurrentLessonsAndMarkets })
  }
  if (activeTeachers >= limits.teacherSeats) {
    violations.push({ key: 'teacherSeats', label: '教師席', used: activeTeachers, limit: limits.teacherSeats })
  }
  return violations
}

export const getOrgPlanLimits = async (deps: GetOrgPlanLimitsDeps, input: GetOrgPlanLimitsInput): Promise<PlanLimitsResult> => {
  const planId = await deps.getOrgPlanId(input.orgId)
  if (!planId) throw missingPlanError()
  const definition = await deps.getPlanDefinition(planId)
  if (!definition) throw missingPlanError()

  const [metadata, activeLessonRuns, activeTeachers] = await Promise.all([
    deps.getDowngradeMetadata ? deps.getDowngradeMetadata(input.orgId) : Promise.resolve(null),
    deps.countActiveLessonRuns ? deps.countActiveLessonRuns(input.orgId) : Promise.resolve(0),
    deps.countActiveTeachers ? deps.countActiveTeachers(input.orgId) : Promise.resolve(0),
  ])
  const pendingPlanChange = toPendingPlanChange(metadata?.pendingPlanChange)
  const graceEndsAtMillis = toMillis(metadata?.downgradeGrace?.endsAt)
  const violations = metadata?.downgradeGrace
    ? buildViolations(definition.limits, activeLessonRuns, activeTeachers)
    : []
  const downgradeStatus = deriveDowngradeStatus({
    nowMillis: deps.nowMillis ? deps.nowMillis() : Date.now(),
    graceEndsAtMillis,
    pending: pendingPlanChange,
    violations,
  })

  return { ...definition.limits, downgradeStatus }
}

/** Production wiring: Firestore Admin SDK. */
export const getOrgPlanLimitsWithAdminSdk = (orgId: string): Promise<PlanLimitsResult> => {
  const db = getFirestore()
  return getOrgPlanLimits({
    getOrgPlanId: async (id) => {
      const snap = await db.doc(`organizations/${id}`).get()
      return snap.exists ? (snap.get('planId') as string | undefined) ?? null : null
    },
    getPlanDefinition: async (planId) => {
      const snap = await db.doc(`planDefinitions/${planId}`).get()
      return snap.exists ? (snap.data() as PlanDefinition) : null
    },
    getDowngradeMetadata: async (id) => {
      const snap = await db.doc(`organizations/${id}`).get()
      if (!snap.exists) return null
      const data = snap.data() as { pendingPlanChange?: PersistedPendingPlanChange; downgradeGrace?: PersistedDowngradeGrace }
      return { pendingPlanChange: data.pendingPlanChange, downgradeGrace: data.downgradeGrace }
    },
    countActiveLessonRuns: async (id) => {
      const snap = await db.collection('lessonRuns')
        .where('orgId', '==', id)
        .where('status', 'in', ACTIVE_LESSON_RUN_STATUSES)
        .get()
      return snap.size
    },
    countActiveTeachers: async (id) => {
      const snap = await db.collection(`organizations/${id}/members`)
        .where('status', '==', 'active')
        .where('role', '==', 'teacher')
        .get()
      return snap.size
    },
  }, { orgId })
}

export const getDowngradeStatusWithAdminSdk = async (orgId: string): Promise<DowngradeStatus> =>
  (await getOrgPlanLimitsWithAdminSdk(orgId)).downgradeStatus
