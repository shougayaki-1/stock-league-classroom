import { describe, expect, it } from 'vitest'
import { buildDraftFromAnswers } from './guidedBuilderPresets'
import type { WizardAnswers } from './guidedBuilderTypes'

const market: WizardAnswers = { goal: 'MARKET_AND_INVESTING', mainObjective: '需給を理解する', lessonDurationMinutes: 50, studentCount: 30, deviceEnvironment: 'ONE_PER_STUDENT', teamMode: 'TEAM', readingDepth: 'STANDARD', theme: '身近な企業', difficulty: 'STANDARD', companyCount: 5, useEarnings: true, useUncertainty: false, infoVsDemandWeight: 'BALANCED', alwaysOnMarketMinutes: 20, predictionCheckpoints: 2, evaluationFocus: 'OPERATION_RESULT' }
const life: WizardAnswers = { goal: 'LIFE_PLANNING', mainObjective: '生涯設計を考える', lessonDurationMinutes: 50, studentCount: 30, deviceEnvironment: 'ONE_PER_STUDENT', teamMode: 'INDIVIDUAL', readingDepth: 'STANDARD', theme: '子育て世帯', difficulty: 'STANDARD', lifeStageFocus: 'CHILD_REARING', courseFormat: 'COMMON_CONDITIONS', roundYears: 5, coveredConcepts: ['ASSETS'], eventDisclosure: 'ANNOUNCED', evaluationFocus: 'STABILITY' }

describe('buildDraftFromAnswers', () => {
  it('creates safely-initialized social-studies tiers with increasing company counts', () => {
    const easy = buildDraftFromAnswers(market, 'EASY')
    const advanced = buildDraftFromAnswers(market, 'ADVANCED')
    expect(easy.socialStudiesMarket!.companies).toHaveLength(3)
    expect(advanced.socialStudiesMarket!.companies.length).toBeGreaterThan(3)
    expect(easy.socialStudiesMarket!.companies.every((company) => Object.keys(company.impactSensitivities).length === 0)).toBe(true)
  })

  it('creates a single safe household and tier-scaled events', () => {
    const easy = buildDraftFromAnswers(life, 'EASY')
    const advanced = buildDraftFromAnswers(life, 'ADVANCED')
    expect(easy.homeEconomics!.households).toHaveLength(1)
    expect(easy.homeEconomics!.households[0].internalRiskFactors).toEqual({})
    expect(easy.homeEconomics!.lifeEvents.every((event) => event.triggerProbability === 0.1)).toBe(true)
    expect(advanced.homeEconomics!.lifeEvents.every((event) => event.triggerProbability === 0.3)).toBe(true)
    expect(advanced.homeEconomics!.lifeEvents.length).toBeGreaterThan(easy.homeEconomics!.lifeEvents.length)
  })
})

describe('coreActivityMinutes', () => {
  it('社会科は alwaysOnMarketMinutes をそのまま使う', () => {
    expect(buildDraftFromAnswers(market, 'STANDARD').coreActivityMinutes).toBe(20)
  })

  it('家庭科は授業時間から他フェーズ分を引く', () => {
    expect(buildDraftFromAnswers(life, 'STANDARD').coreActivityMinutes).toBe(50 - 15)
  })

  it('短い授業時間でも下限を下回らない', () => {
    const short: WizardAnswers = { ...life, lessonDurationMinutes: 10 }
    expect(buildDraftFromAnswers(short, 'STANDARD').coreActivityMinutes).toBe(5)
  })

  it('社会科の市場分数が0でも下限を下回らない', () => {
    const short: WizardAnswers = { ...market, alwaysOnMarketMinutes: 0 }
    expect(buildDraftFromAnswers(short, 'STANDARD').coreActivityMinutes).toBe(5)
  })
})
