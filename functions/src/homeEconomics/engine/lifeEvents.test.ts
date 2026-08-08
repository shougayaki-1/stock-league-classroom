import { describe, expect, it } from 'vitest'
import type { LifeEventDefinition } from '@stock-league/household-authoring-content'
import { applyEventEffects, buildEventDisclosureView, determineOccurredEvents } from './lifeEvents'

const jobLoss: LifeEventDefinition = {
  id: 'job-loss', label: '失業', disclosureMode: 'HIDDEN', triggerProbability: 0.5,
  effectDescription: '収入が一時的に0になる', incomeEffectYen: -3000000, expenseEffectYen: 0, cashEffectYen: 0,
}
const marriage: LifeEventDefinition = {
  id: 'marriage', label: '結婚', disclosureMode: 'ANNOUNCED', triggerProbability: 0,
  effectDescription: '一時的な費用が発生する', incomeEffectYen: 0, expenseEffectYen: 0, cashEffectYen: -1000000,
}

describe('determineOccurredEvents', () => {
  it('is deterministic — same inputs always produce the same occurred-event set', () => {
    const input = { events: [jobLoss], eventProbabilityOverrides: {}, householdId: 'case-b', roundIndex: 3, randomSeed: 'seed-x', restoreGeneration: 0 }
    expect(determineOccurredEvents(input)).toEqual(determineOccurredEvents(input))
  })

  it('triggerProbability 0 never fires, triggerProbability 1 always fires — boundary cases are exact, not probabilistic', () => {
    const never: LifeEventDefinition = { ...jobLoss, triggerProbability: 0 }
    const always: LifeEventDefinition = { ...jobLoss, triggerProbability: 1 }
    expect(determineOccurredEvents({ events: [never], eventProbabilityOverrides: {}, householdId: 'h', roundIndex: 1, randomSeed: 's', restoreGeneration: 0 })).toEqual([])
    expect(determineOccurredEvents({ events: [always], eventProbabilityOverrides: {}, householdId: 'h', roundIndex: 1, randomSeed: 's', restoreGeneration: 0 })).toEqual(['job-loss'])
  })

  it('a per-household eventProbabilityOverrides entry replaces the event definition\'s own triggerProbability', () => {
    const result = determineOccurredEvents({
      events: [jobLoss], eventProbabilityOverrides: { 'job-loss': 1 },
      householdId: 'h', roundIndex: 1, randomSeed: 's', restoreGeneration: 0,
    })
    expect(result).toEqual(['job-loss'])
  })
})

describe('buildEventDisclosureView', () => {
  it('ANNOUNCED events show label and effectDescription in advance, before they occur', () => {
    const views = buildEventDisclosureView([marriage], [], 5)
    expect(views).toEqual([{ eventId: 'marriage', label: '結婚', effectDescription: '一時的な費用が発生する', revealed: true }])
  })

  it('HIDDEN events show nothing until they actually occur this round', () => {
    const notYet = buildEventDisclosureView([jobLoss], [], 5)
    expect(notYet).toEqual([{ eventId: 'job-loss', label: null, effectDescription: null, revealed: false }])
    const occurred = buildEventDisclosureView([jobLoss], ['job-loss'], 5)
    expect(occurred).toEqual([{ eventId: 'job-loss', label: '失業', effectDescription: '収入が一時的に0になる', revealed: true }])
  })
})

describe('applyEventEffects', () => {
  it('sums income/expense/cash effects across every event that actually occurred', () => {
    const totals = applyEventEffects([jobLoss, marriage], ['job-loss', 'marriage'])
    expect(totals).toEqual({ incomeEffectYen: -3000000, expenseEffectYen: 0, cashEffectYen: -1000000 })
  })

  it('an event NOT in occurredEventIds contributes nothing', () => {
    const totals = applyEventEffects([jobLoss], [])
    expect(totals).toEqual({ incomeEffectYen: 0, expenseEffectYen: 0, cashEffectYen: 0 })
  })
})
