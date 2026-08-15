import { getFirestore } from 'firebase-admin/firestore'
import { getDatabase } from 'firebase-admin/database'
import type {
  CompanyPublicView,
  EconomicIndicatorPublicView,
  InformationPublicView,
  ResearchDeskPanelId,
  ResearchDeskPublicView,
} from '@stock-league/market-public-content'
import type { SocialStudiesMarketContent } from '@stock-league/market-authoring-content'
import {
  toCompanyPublicView,
  toEconomicIndicatorPublicView,
  toInformationPublicView,
} from './toPublicView'

export type { ResearchDeskPanelId, ResearchDeskPublicView }

const PHASE_PANELS: Record<string, ResearchDeskPanelId[]> = {
  INTRO: [],
  INFORMATION: ['COMPANIES', 'NEWS', 'STATISTICS'],
  PREDICTION: ['COMPANIES', 'NEWS', 'STATISTICS', 'TEAM_NOTES'],
  DISCUSSION: ['COMPANIES', 'NEWS', 'STATISTICS', 'TEAM_NOTES'],
  MARKET: ['COMPANIES', 'NEWS', 'STATISTICS', 'TEAM_NOTES', 'ORDERS'],
  DECISION: ['COMPANIES', 'NEWS', 'STATISTICS', 'TEAM_NOTES'],
  RESULT: ['COMPANIES', 'NEWS', 'STATISTICS', 'TEAM_NOTES'],
  REFLECTION: ['COMPANIES', 'NEWS', 'STATISTICS', 'TEAM_NOTES'],
  CUSTOM: [],
}

export interface BuildResearchDeskPublicViewInput {
  phaseId: string | null
  phases?: Array<{ id: string; phaseType: string }>
  socialStudiesMarket?: SocialStudiesMarketContent | null
  nowMillis: number
}

/**
 * Builds the server-side projection of Research Desk data for students.
 * SECURITY-CRITICAL (spec §12.4, §26-1):
 * - Hidden authoring fields (impactSensitivities, minimumPriceGuard, companyImpactMultipliers, etc.) are stripped.
 * - Future InformationItem and EconomicIndicator (publishedAtMillis > nowMillis) are filtered out completely.
 * - Panel capabilities are determined strictly by the current phase type.
 */
export const buildResearchDeskPublicView = (
  input: BuildResearchDeskPublicViewInput,
): ResearchDeskPublicView => {
  const currentPhase = input.phaseId && input.phases
    ? input.phases.find((p) => p.id === input.phaseId)
    : undefined

  const phaseType = currentPhase?.phaseType ?? null
  const availablePanels: ResearchDeskPanelId[] = phaseType && PHASE_PANELS[phaseType]
    ? [...PHASE_PANELS[phaseType]]
    : []

  const market = input.socialStudiesMarket

  const companies: CompanyPublicView[] = (availablePanels.includes('COMPANIES') && market?.companies)
    ? market.companies.map((c) => toCompanyPublicView(c, market.companyDifficultyTier ?? 'BASIC'))
    : []

  const informationItems: InformationPublicView[] = (availablePanels.includes('NEWS') && market?.informationItems)
    ? market.informationItems
        .filter((item) => item.publishedAtMillis <= input.nowMillis)
        .map((item) => toInformationPublicView(item))
    : []

  const economicIndicators: EconomicIndicatorPublicView[] = (availablePanels.includes('STATISTICS') && market?.economicIndicators)
    ? market.economicIndicators
        .filter((ind) => ind.publishedAtMillis <= input.nowMillis)
        .map((ind) => toEconomicIndicatorPublicView(ind, market.indicatorDifficultyTier ?? 'BASIC'))
    : []

  return {
    phaseId: input.phaseId,
    phaseType,
    availablePanels,
    companies,
    informationItems,
    economicIndicators,
    updatedAtMillis: input.nowMillis,
  }
}

export interface PublishResearchDeskProjectionDeps {
  getLessonRun: (lessonRunId: string) => Promise<{
    currentPhaseId?: string | null
    templateSnapshot?: {
      phases?: Array<{ id: string; phaseType: string }>
      socialStudiesMarket?: SocialStudiesMarketContent | null
    }
  } | null>
  updateLessonRunPublic: (lessonRunId: string, data: { researchDesk: ResearchDeskPublicView }) => Promise<void>
  now?: () => number
}

export const publishResearchDeskProjection = async (
  deps: PublishResearchDeskProjectionDeps,
  lessonRunId: string,
): Promise<void> => {
  const run = await deps.getLessonRun(lessonRunId)
  if (!run) return

  const nowMillis = deps.now ? deps.now() : Date.now()
  const view = buildResearchDeskPublicView({
    phaseId: run.currentPhaseId ?? null,
    phases: run.templateSnapshot?.phases,
    socialStudiesMarket: run.templateSnapshot?.socialStudiesMarket,
    nowMillis,
  })

  await deps.updateLessonRunPublic(lessonRunId, { researchDesk: view })
}

export const publishResearchDeskProjectionWithAdminSdk = async (
  lessonRunId: string,
): Promise<void> => {
  const db = getFirestore()
  const rtdb = getDatabase()

  await publishResearchDeskProjection({
    getLessonRun: async (id) => {
      const snap = await db.doc(`lessonRuns/${id}`).get()
      if (!snap.exists) return null
      return snap.data() as {
        currentPhaseId?: string | null
        templateSnapshot?: {
          phases?: Array<{ id: string; phaseType: string }>
          socialStudiesMarket?: SocialStudiesMarketContent | null
        }
      }
    },
    updateLessonRunPublic: async (id, data) => {
      await rtdb.ref(`lessonRunPublic/${id}`).update(data)
    },
  }, lessonRunId)
}
