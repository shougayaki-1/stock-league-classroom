import { getFirestore } from 'firebase-admin/firestore'
import type { HomeEconomicsContent, HouseholdProfile } from '@stock-league/household-authoring-content'
import {
  buildInitialHouseholdState,
  getOrInitHouseholdState,
  householdRepositoryWithAdminSdk,
  type HouseholdFirestoreDeps,
  type HouseholdState,
} from '../lessonRuns/households/repository'

export const resolveCommonConditionsProfile = (content: HomeEconomicsContent): HouseholdProfile => {
  if (content.courseFormat !== 'COMMON_CONDITIONS' || content.households.length !== 1) {
    throw new Error(
      'このコース形式では家庭の自動初期化に対応していません（共通条件モードでプロフィールが1件の教材のみ対応）。',
    )
  }
  return content.households[0]
}

export interface PreviewCommonConditionsHouseholdStateInput {
  lessonRunId: string
  teamId: string
  content: HomeEconomicsContent
  nowMillis: number
}

export const previewCommonConditionsHouseholdState = (
  input: PreviewCommonConditionsHouseholdStateInput,
): HouseholdState => {
  const profile = resolveCommonConditionsProfile(input.content)
  return buildInitialHouseholdState({
    lessonRunId: input.lessonRunId,
    teamId: input.teamId,
    householdId: input.teamId,
    startingCashYen: profile.cashSavingsYen,
    startingLifeStage: profile.lifeStage,
    nowMillis: input.nowMillis,
  })
}

export interface EnsureCommonConditionsHouseholdStateInput extends HouseholdFirestoreDeps {
  lessonRunId: string
  teamId: string
  content: HomeEconomicsContent
  now: () => number
}

export const ensureCommonConditionsHouseholdState = (
  input: EnsureCommonConditionsHouseholdStateInput,
): Promise<HouseholdState> => {
  const profile = resolveCommonConditionsProfile(input.content)
  return getOrInitHouseholdState({
    firestore: input.firestore,
    lessonRunId: input.lessonRunId,
    teamId: input.teamId,
    householdId: input.teamId,
    startingCashYen: profile.cashSavingsYen,
    startingLifeStage: profile.lifeStage,
    now: input.now,
  })
}

export const ensureCommonConditionsHouseholdStateWithAdminSdk = async (
  lessonRunId: string,
  teamId: string,
  content?: HomeEconomicsContent,
): Promise<HouseholdState> => {
  let homeEconomics = content
  if (!homeEconomics) {
    const db = getFirestore()
    const runSnap = await db.doc(`lessonRuns/${lessonRunId}`).get()
    if (!runSnap.exists) throw new Error('レッスンランが見つかりません。')
    const templateSnapshot = runSnap.get('templateSnapshot') as { homeEconomics?: HomeEconomicsContent } | undefined
    homeEconomics = templateSnapshot?.homeEconomics
    if (!homeEconomics) throw new Error('LessonRun has no homeEconomics content')
  }

  return ensureCommonConditionsHouseholdState({
    firestore: householdRepositoryWithAdminSdk(),
    lessonRunId,
    teamId,
    content: homeEconomics,
    now: Date.now,
  })
}
