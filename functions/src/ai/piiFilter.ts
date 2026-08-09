/** §15.3 fields which must never be sent to an LLM. */
export const FORBIDDEN_AI_INPUT_KEYS = ['studentName', 'email', 'individualResponse', 'personalTradeHistory', 'householdIndividualState', 'accessLog', 'deviceInfo'] as const
export const assertNoForbiddenFields = (input: Record<string, unknown>): void => {
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if ((FORBIDDEN_AI_INPUT_KEYS as readonly string[]).includes(key)) throw new Error(`AI input contains a forbidden field: ${key}`)
      walk(child)
    }
  }
  walk(input)
}
