export interface ActiveStudentSession {
  marketId: string
  requestId: string
  sessionId: string
  /** The recovery code this device presented at join time, if any — kept only so the
   * student can later be told whether it actually matched (see StudentMarketPage). */
  presentedRecoveryCode?: string
}

const SESSION_ID_KEY = 'stock-league-session-id'
const ACTIVE_SESSION_KEY = 'stock-league-active-market'

export const getStudentSessionId = (): string => {
  const existing = window.localStorage.getItem(SESSION_ID_KEY)
  if (existing) return existing
  const created = crypto.randomUUID()
  window.localStorage.setItem(SESSION_ID_KEY, created)
  return created
}

export const saveActiveStudentSession = (session: ActiveStudentSession) =>
  window.localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(session))

export const readActiveStudentSession = (): ActiveStudentSession | undefined => {
  try {
    const value = JSON.parse(window.localStorage.getItem(ACTIVE_SESSION_KEY) ?? '')
    return value && typeof value.marketId === 'string' && typeof value.requestId === 'string' && typeof value.sessionId === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

export const clearActiveStudentSession = () => window.localStorage.removeItem(ACTIVE_SESSION_KEY)
