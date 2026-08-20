import type { InformationItem, SimulatedCompany } from '@stock-league/market-authoring-content'
import type { HouseholdProfile, LifeEventDefinition } from '@stock-league/household-authoring-content'
import type { LessonContent } from './types'
import type { GuidedBuilderTier, WizardAnswers } from './guidedBuilderTypes'

const tiers: Record<GuidedBuilderTier, { companies: (n: number) => number; events: number }> = {
  EASY: { companies: (n) => Math.max(2, Math.min(3, n)), events: 1 },
  STANDARD: { companies: (n) => Math.max(3, Math.min(8, n)), events: 2 },
  ADVANCED: { companies: (n) => Math.max(6, Math.min(12, n + 3)), events: 4 },
}
const companyNames = ['あおぞらベーカリー', 'みらい電機', 'つばさ物流', 'はるか食品', 'green energy社', 'そよかぜ通信', 'kirara小売', '大地農業']
const company = (index: number): SimulatedCompany => ({ id: `company-${index + 1}`, name: companyNames[index % companyNames.length], symbol: `C${index + 1}`, industry: '未設定', description: '', productsAndServices: [], costDrivers: [], sizeClass: 'MEDIUM', financialStrength: 'STANDARD', growthProfile: 'STABLE', riskFactors: [], initialPrice: 1000, minimumPriceGuard: { type: 'PERCENT_OF_INITIAL', minimumPercent: 30 }, impactSensitivities: {} })
const marketWeights = { operationResult: .3, predictionAccuracy: .2, informationUsage: .2, riskManagement: .15, reflection: .15 }
const homeWeights = { lifeGoalAchievement: .2, emergencyFundAdequacy: .15, stability: .2, diversification: .15, borrowingBurden: .15, reflection: .15 }
const eventPool: Omit<LifeEventDefinition, 'triggerProbability'>[] = [
  { id: 'job-loss', label: '失業', disclosureMode: 'HIDDEN', effectDescription: '収入が一時的に減る', incomeEffectYen: -1500000, expenseEffectYen: 0, cashEffectYen: 0 },
  { id: 'illness', label: '病気', disclosureMode: 'HIDDEN', effectDescription: '医療費が発生する', incomeEffectYen: 0, expenseEffectYen: 300000, cashEffectYen: 0 },
  { id: 'childbirth', label: '出産', disclosureMode: 'ANNOUNCED', effectDescription: '一時費用が発生する', incomeEffectYen: 0, expenseEffectYen: 0, cashEffectYen: -500000 },
  { id: 'promotion', label: '昇進', disclosureMode: 'ANNOUNCED', effectDescription: '収入が増える', incomeEffectYen: 500000, expenseEffectYen: 0, cashEffectYen: 0 },
]

/**
 * 中核フェーズ以外（導入・結果・振り返り）に見込む合計分数。各5分の想定。
 *
 * 暫定値である。このリポジトリの既存の扱い（validation.ts の
 * `PROVISIONAL_MAX_TOTAL_DURATION_SECONDS`）と同じく、試運転で実際の授業
 * 進行を見てから調整する前提で名前付き定数にしている。
 *
 * 社会科ではこの定数を使わない。ウィザードが `alwaysOnMarketMinutes`
 * （市場を動かす分数）を直接聞いており、教師の明示的な回答を捨てて導出値
 * に置き換えるのは改悪になるため。
 */
export const NON_CORE_PHASE_ALLOWANCE_MINUTES = 15

/** 中核フェーズの下限。教師が極端に短い授業時間を入れても0分や負にしない。 */
export const MIN_CORE_ACTIVITY_MINUTES = 5

const resolveCoreActivityMinutes = (answers: WizardAnswers): number => {
  const raw = answers.goal === 'MARKET_AND_INVESTING'
    ? answers.alwaysOnMarketMinutes
    : answers.lessonDurationMinutes - NON_CORE_PHASE_ALLOWANCE_MINUTES
  return Math.max(MIN_CORE_ACTIVITY_MINUTES, Math.round(raw))
}

export function buildDraftFromAnswers(answers: WizardAnswers, tier: GuidedBuilderTier): LessonContent {
  const coreActivityMinutes = resolveCoreActivityMinutes(answers)
  if (answers.goal === 'MARKET_AND_INVESTING') {
    const informationItems: InformationItem[] = []
    return { schemaVersion: 1, title: answers.theme || '新しい社会科教材', description: answers.mainObjective, subject: 'SOCIAL_STUDIES', coreActivityMinutes, socialStudiesMarket: { companies: Array.from({ length: tiers[tier].companies(answers.companyCount) }, (_, index) => company(index)), informationItems, economicIndicators: [], batchIntervalSeconds: 3, priceSensitivityPreset: answers.infoVsDemandWeight, marketNoiseEnabled: tier !== 'EASY', resumeConfirmationSeconds: 30, companyDifficultyTier: answers.difficulty, indicatorDifficultyTier: answers.difficulty, tradingFeeYen: 0, dividendEnabled: false, stockSplitEnabled: false, bankruptcyEnabled: tier === 'ADVANCED', dividendTriggerBatchIndexes: [], stockSplitTriggerBatchIndexes: [], dividendPerShareYen: 0, stockSplitRatio: 1, predictionEvaluationTarget: { type: 'AFTER_BATCHES', count: 20 }, evaluationWeights: marketWeights } }
  }
  const household: HouseholdProfile = { householdId: 'case-a', age: 32, householdIncomeYen: 5000000, annualLivingExpensesYen: 2800000, cashSavingsYen: 1500000, family: '配偶者・子1人', housing: '賃貸マンション', lifeGoal: answers.mainObjective || '安定した生活設計', lifeStage: answers.lifeStageFocus, eventProbabilityOverrides: {}, internalRiskFactors: {} }
  const triggerProbability = tier === 'EASY' ? 0.1 : tier === 'STANDARD' ? 0.2 : 0.3
  const lifeEvents = eventPool.slice(0, tiers[tier].events).map((event) => ({ ...event, disclosureMode: answers.eventDisclosure === 'HIDDEN' ? 'HIDDEN' : event.disclosureMode, triggerProbability }))
  return { schemaVersion: 1, title: answers.theme || '新しい家庭科教材', description: answers.mainObjective, subject: 'HOME_ECONOMICS', coreActivityMinutes, homeEconomics: { households: [household], assets: [], insuranceProducts: [], lifeEvents, liabilities: [], publicSupportPrograms: [], roundYears: answers.roundYears, courseFormat: answers.courseFormat, taxAndSocialInsuranceModelVersion: 1, economicFactors: { inflationPercent: 1, interestRatePercent: 1, marketReturnPercent: 3 }, borrowingAllowed: tier !== 'EASY', goalPackage: 'OVERALL_BALANCE', evaluationWeights: homeWeights } }
}
