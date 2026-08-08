import { deriveSeed, mulberry32 } from '@stock-league/deterministic-random'
import type { LifeEventDefinition } from '@stock-league/household-authoring-content'

export interface DetermineOccurredEventsInput {
  events: LifeEventDefinition[]
  /** Task 1's HouseholdProfile.eventProbabilityOverrides — keyed by event id, overrides the definition's own triggerProbability for this household only. */
  eventProbabilityOverrides: Record<string, number>
  householdId: string
  roundIndex: number
  randomSeed: string
  restoreGeneration: number
}

/**
 * Spec §13.12. Boundary probabilities (0, 1) are exact, not approximate —
 * a rand draw in [0,1) is always < 1 and never < 0, so this holds without
 * special-casing.
 */
export const determineOccurredEvents = (input: DetermineOccurredEventsInput): string[] => {
  const occurred: string[] = []
  for (const event of input.events) {
    const probability = input.eventProbabilityOverrides[event.id] ?? event.triggerProbability
    if (probability <= 0) continue
    if (probability >= 1) { occurred.push(event.id); continue }
    const seed = deriveSeed([input.randomSeed, input.restoreGeneration, input.householdId, event.id, input.roundIndex])
    const rand = mulberry32(seed)()
    if (rand < probability) occurred.push(event.id)
  }
  return occurred
}

export interface EventDisclosureView {
  eventId: string
  label: string | null
  effectDescription: string | null
  revealed: boolean
}

/**
 * Spec §13.12: ANNOUNCED events reveal their label/effect ahead of time
 * (before `occurredEventIds` even contains them — this is the "advance
 * notice" the disclosure mode promises). HIDDEN events reveal nothing
 * until `occurredEventIds` actually contains them. PARTIALLY_ANNOUNCED
 * is intentionally out of this task's scope for the exact partial-hint
 * text — Task 15 (screens) decides how a partial hint renders; this
 * function treats PARTIALLY_ANNOUNCED the same as HIDDEN for whether the
 * full label/effect is revealed (a future task may split this further).
 */
export const buildEventDisclosureView = (
  events: LifeEventDefinition[],
  occurredEventIds: string[],
  _upcomingRoundIndex: number,
): EventDisclosureView[] =>
  events.map((event) => {
    const occurred = occurredEventIds.includes(event.id)
    const revealed = event.disclosureMode === 'ANNOUNCED' || occurred
    return {
      eventId: event.id,
      label: revealed ? event.label : null,
      effectDescription: revealed ? event.effectDescription : null,
      revealed,
    }
  })

export interface EventEffectTotals {
  incomeEffectYen: number
  expenseEffectYen: number
  cashEffectYen: number
}

export const applyEventEffects = (events: LifeEventDefinition[], occurredEventIds: string[]): EventEffectTotals => {
  const occurred = events.filter((event) => occurredEventIds.includes(event.id))
  return {
    incomeEffectYen: occurred.reduce((sum, e) => sum + e.incomeEffectYen, 0),
    expenseEffectYen: occurred.reduce((sum, e) => sum + e.expenseEffectYen, 0),
    cashEffectYen: occurred.reduce((sum, e) => sum + e.cashEffectYen, 0),
  }
}
