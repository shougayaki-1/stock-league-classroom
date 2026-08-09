import { getFirestore } from 'firebase-admin/firestore'

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
}

export interface GetOrgPlanLimitsDeps {
  getOrgPlanId: (orgId: string) => Promise<string | null>
  getPlanDefinition: (planId: string) => Promise<PlanDefinition | null>
}

export interface GetOrgPlanLimitsInput { orgId: string }

const missingPlanError = () => new Error('この組織にはプランが設定されていません')

/** Resolves an organization's plan limits without silently falling back. */
export const getOrgPlanLimits = async (deps: GetOrgPlanLimitsDeps, input: GetOrgPlanLimitsInput): Promise<PlanLimits> => {
  const planId = await deps.getOrgPlanId(input.orgId)
  if (!planId) throw missingPlanError()
  const definition = await deps.getPlanDefinition(planId)
  if (!definition) throw missingPlanError()
  return definition.limits
}

/** Production wiring: Firestore Admin SDK. */
export const getOrgPlanLimitsWithAdminSdk = (orgId: string): Promise<PlanLimits> => {
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
  }, { orgId })
}
