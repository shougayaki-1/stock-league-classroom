import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc, updateDoc, type Firestore } from 'firebase/firestore'
import { onDisconnect, ref, runTransaction, set, update, type Database } from 'firebase/database'
import type { TemplateSpec } from '../templates/types'
import { participantId, type JoinRequest, type LiveMarketParticipant, type LiveMarketState, type MarketVisibility, type TeamAssignmentMode } from './liveMarketTypes'

export const MARKET_CAPACITY = 80
export interface MarketRecord { id: string; ownerUid: string; templateSnapshot: TemplateSpec; capacity: number; visibility: MarketVisibility; createdAt: unknown }
export interface CreateMarketInput { ownerUid: string; template: TemplateSpec; visibility: MarketVisibility; joinCode: string; teams: Array<{ id: string; name: string }> }
export class MarketCreationError extends Error {
  readonly marketId: string
  constructor(marketId: string, cause: unknown) { super('Market creation needs recovery'); this.marketId = marketId; this.cause = cause }
}

const root = (marketId: string) => `liveMarkets/${marketId}`
const normalizeCode = (code: string) => code.trim().toUpperCase()

const initialLiveState = (input: CreateMarketInput) => ({
  meta: { ownerUid: input.ownerUid, capacity: MARKET_CAPACITY, visibility: input.visibility, status: 'SETUP' as const, createdAtMillis: Date.now(), startingCash: input.template.startingCash },
  teams: Object.fromEntries(input.teams.map((team) => [team.id, { id: team.id, name: team.name }])),
  companies: Object.fromEntries(input.template.companies.map((company) => [company.id, { id: company.id, basePrice: company.initialPrice, ...(company.pricePhases ? { phases: company.pricePhases } : {}) }])),
})

/** Idempotently completes a CREATING market after any Firestore/RTDB partial failure. */
export const recoverMarketCreation = async (firestore: Firestore, database: Database, marketId: string, input: CreateMarketInput): Promise<string> => {
  const marketRef = doc(firestore, 'markets', marketId)
  const market = await getDoc(marketRef)
  if (!market.exists() || market.data().ownerUid !== input.ownerUid) throw new Error('Market recovery is not authorized')
  const codeRef = doc(firestore, 'marketJoinCodes', normalizeCode(input.joinCode))
  const existingCode = await getDoc(codeRef)
  if (existingCode.exists() && existingCode.data().marketId !== marketId) throw new Error('Join code is already in use')
  if (!existingCode.exists()) await setDoc(codeRef, { marketId, ownerUid: input.ownerUid, createdAt: serverTimestamp() })
  const expected = initialLiveState(input)
  await runTransaction(ref(database, root(marketId)), (current: LiveMarketState | null) => {
    if (!current) return expected
    if (current.meta.ownerUid !== input.ownerUid || current.meta.capacity !== MARKET_CAPACITY || current.meta.visibility !== input.visibility) return
    return current
  })
  await updateDoc(marketRef, { creationStatus: 'READY', initializedAt: serverTimestamp() })
  return marketId
}

/** Persists a recoverable CREATING record before crossing Firestore and RTDB boundaries. */
export const createMarket = async (firestore: Firestore, database: Database, input: CreateMarketInput): Promise<string> => {
  const marketRef = await addDoc(collection(firestore, 'markets'), {
    ownerUid: input.ownerUid, templateSnapshot: structuredClone(input.template), capacity: MARKET_CAPACITY,
    visibility: input.visibility, creationStatus: 'CREATING', createdAt: serverTimestamp(),
  })
  try { return await recoverMarketCreation(firestore, database, marketRef.id, input) }
  catch (error) { throw new MarketCreationError(marketRef.id, error) }
}

/** This is deliberately a direct lookup; join-code collections are never queried. */
export const resolveJoinCode = async (firestore: Firestore, joinCode: string): Promise<string | undefined> => {
  const result = await getDoc(doc(firestore, 'marketJoinCodes', normalizeCode(joinCode)))
  return result.exists() ? String(result.data().marketId) : undefined
}

export const requestToJoinMarket = async (database: Database, marketId: string, request: Omit<JoinRequest, 'requestedAtMillis' | 'connected'>) => {
  const id = participantId(request.uid, request.sessionId)
  await set(ref(database, `${root(marketId)}/joinRequests/${id}`), { ...request, connected: true, requestedAtMillis: Date.now() })
  await onDisconnect(ref(database, `${root(marketId)}/joinRequests/${id}/connected`)).set(false)
  return id
}

export const markJoinRequestConnected = (database: Database, marketId: string, id: string, connected: boolean) =>
  update(ref(database, `${root(marketId)}/joinRequests/${id}`), { connected, lastSeenAtMillis: Date.now() })

/** Once approved, arm an onDisconnect write that can change only the student's own participant presence. */
export const armApprovedParticipantPresence = async (database: Database, marketId: string, id: string) => {
  const connection = ref(database, `${root(marketId)}/participants/${id}/connected`)
  await onDisconnect(connection).set(false)
  await update(ref(database, `${root(marketId)}/participants/${id}`), { connected: true, lastSeenAtMillis: Date.now() })
}

const chooseTeam = (state: LiveMarketState, request: JoinRequest, mode: TeamAssignmentMode, manualTeamId?: string) => {
  const teamIds = Object.keys(state.teams ?? {})
  if (!teamIds.length) return null
  if (mode === 'manual') return manualTeamId && teamIds.includes(manualTeamId) ? manualTeamId : null
  if (mode === 'student_choice' && request.requestedTeamId && teamIds.includes(request.requestedTeamId)) return request.requestedTeamId
  const counts = Object.fromEntries(teamIds.map((id) => [id, 0])) as Record<string, number>
  Object.values(state.participants ?? {}).filter((item) => item.connected).forEach((item) => {
    if (item.teamId && item.teamId in counts) counts[item.teamId] += 1
  })
  return teamIds.reduce((best, id) => counts[id] < counts[best] ? id : best, teamIds[0])
}

/** Root transaction keeps the cap, request approval, and team assignment indivisible. */
export const approveJoinRequest = async (database: Database, marketId: string, id: string, mode: TeamAssignmentMode, manualTeamId?: string) => {
  const result = await runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => {
    if (!raw?.meta || !raw.joinRequests?.[id]) return
    const request = raw.joinRequests[id]
    if (!request.connected) return
    raw.participants ??= {}
    if (raw.participants[id]) return raw
    const active = Object.values(raw.participants).filter((participant) => participant.connected).length
    if (active >= raw.meta.capacity) return
    const teamId = chooseTeam(raw, request, mode, manualTeamId)
    const participant: LiveMarketParticipant = { uid: request.uid, sessionId: request.sessionId, displayName: request.displayName, teamId, connected: true, lastSeenAtMillis: Date.now() }
    raw.participants[id] = participant
    raw.portfolios ??= {}
    raw.portfolios[id] ??= { cash: raw.meta.startingCash, holdings: {}, updatedAtMillis: Date.now() }
    raw.joinRequests[id] = { ...request, approvedAtMillis: Date.now() }
    return raw
  })
  return result.committed
}
