import { collection, doc, getDoc, getDocs, query, runTransaction as runFirestoreTransaction, serverTimestamp, setDoc, updateDoc, where, type Firestore } from 'firebase/firestore'
import { onDisconnect, ref, remove, runTransaction, set, update, type Database } from 'firebase/database'
import type { TemplateSpec } from '../templates/types'
import { participantId, type JoinRequest, type LiveMarketParticipant, type LiveMarketState, type MarketVisibility, type TeamAssignmentMode } from './liveMarketTypes'

export const MARKET_CAPACITY = 80
export const JOIN_CODE_LENGTH = 6
const JOIN_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
export interface MarketRecord { id: string; ownerUid: string; templateSnapshot: TemplateSpec; capacity: number; visibility: MarketVisibility; joinCode: string; creationStatus: 'CREATING' | 'READY'; createdAt: unknown }
export interface CreateMarketInput { ownerUid: string; template: TemplateSpec; visibility: MarketVisibility; joinCode?: string }
export interface MarketCreationResult { marketId: string; joinCode: string }
export class MarketCreationError extends Error {
  readonly marketId: string
  readonly joinCode: string
  constructor(marketId: string, joinCode: string, cause: unknown) { super('Market creation needs recovery'); this.marketId = marketId; this.joinCode = joinCode; this.cause = cause }
}

const root = (marketId: string) => `liveMarkets/${marketId}`
const normalizeCode = (code: string) => code.trim().toUpperCase()
export const generateJoinCode = (randomValues: Uint32Array = crypto.getRandomValues(new Uint32Array(JOIN_CODE_LENGTH))) =>
  Array.from(randomValues, (value) => JOIN_CODE_ALPHABET[value % JOIN_CODE_ALPHABET.length]).join('')

export const initialLiveState = (input: CreateMarketInput) => ({
  meta: { ownerUid: input.ownerUid, capacity: MARKET_CAPACITY, visibility: input.visibility, status: 'SETUP' as const, createdAtMillis: Date.now(), startingCash: input.template.startingCash, joinCode: normalizeCode(input.joinCode ?? '') },
  teams: Object.fromEntries(input.template.teams.map((team) => [team.id, { id: team.id, name: team.name }])),
  companies: Object.fromEntries(input.template.companies.map((company) => [company.id, { id: company.id, name: company.name, symbol: company.symbol, basePrice: company.initialPrice, ...(company.pricePhases ? { phases: company.pricePhases } : {}) }])),
  teamPortfolios: Object.fromEntries(input.template.teams.map((team) => [team.id, { cash: input.template.startingCash, holdings: {}, updatedAtMillis: Date.now() }])),
})

/** Idempotently completes a CREATING market after any Firestore/RTDB partial failure. */
export const recoverMarketCreation = async (firestore: Firestore, database: Database, marketId: string, input: CreateMarketInput): Promise<MarketCreationResult> => {
  const marketRef = doc(firestore, 'markets', marketId)
  const market = await getDoc(marketRef)
  if (!market.exists() || market.data().ownerUid !== input.ownerUid) throw new Error('Market recovery is not authorized')
  const joinCode = normalizeCode(String(market.data().joinCode ?? input.joinCode ?? ''))
  if (!joinCode) throw new Error('Market join code is missing')
  const codeRef = doc(firestore, 'marketJoinCodes', joinCode)
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
  return { marketId, joinCode }
}

/** Persists a recoverable CREATING record before crossing Firestore and RTDB boundaries. */
export const createMarket = async (firestore: Firestore, database: Database, input: CreateMarketInput): Promise<MarketCreationResult> => {
  const marketRef = doc(collection(firestore, 'markets'))
  let joinCode = ''
  let reserved = false
  for (let attempt = 0; attempt < 10 && !reserved; attempt += 1) {
    joinCode = normalizeCode(input.joinCode ?? generateJoinCode())
    const codeRef = doc(firestore, 'marketJoinCodes', joinCode)
    reserved = await runFirestoreTransaction(firestore, async (transaction) => {
      if ((await transaction.get(codeRef)).exists()) return false
      transaction.set(marketRef, {
        ownerUid: input.ownerUid, templateSnapshot: structuredClone(input.template), capacity: MARKET_CAPACITY,
        visibility: input.visibility, joinCode, creationStatus: 'CREATING', createdAt: serverTimestamp(),
      })
      transaction.set(codeRef, { marketId: marketRef.id, ownerUid: input.ownerUid, createdAt: serverTimestamp() })
      return true
    })
    if (input.joinCode && !reserved) break
  }
  if (!reserved) throw new Error('参加コードを確保できませんでした。もう一度お試しください。')
  try { return await recoverMarketCreation(firestore, database, marketRef.id, { ...input, joinCode }) }
  catch (error) { throw new MarketCreationError(marketRef.id, joinCode, error) }
}

export const listOwnedMarkets = async (firestore: Firestore, ownerUid: string): Promise<MarketRecord[]> => {
  const result = await getDocs(query(collection(firestore, 'markets'), where('ownerUid', '==', ownerUid)))
  return result.docs.map((item) => ({ id: item.id, ...item.data() } as MarketRecord))
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
    const existingMembership = raw.members?.[request.uid]
    const teamId = existingMembership?.teamId ?? chooseTeam(raw, request, mode, manualTeamId)
    if (!teamId) return
    const participant: LiveMarketParticipant = { uid: request.uid, sessionId: request.sessionId, displayName: request.displayName, teamId, connected: true, lastSeenAtMillis: Date.now() }
    raw.participants[id] = participant
    raw.members ??= {}
    raw.members[request.uid] = { teamId }
    raw.teamPortfolios ??= {}
    raw.teamPortfolios[teamId] ??= { cash: raw.meta.startingCash, holdings: {}, updatedAtMillis: Date.now() }
    raw.joinRequests[id] = { ...request, approvedAtMillis: Date.now() }
    return raw
  })
  return result.committed
}

/**
 * Team portfolios are shared, so a removed member never takes assets with them.
 * Membership is dropped too: the student may rejoin and be assigned freshly.
 */
export const applyRemoveParticipant = (raw: LiveMarketState | null, id: string): LiveMarketState | undefined => {
  const participant = raw?.participants?.[id]
  if (!raw || !participant) return undefined
  delete raw.participants![id]
  if (raw.orders?.[id]) delete raw.orders[id]
  if (raw.joinRequests?.[id]) delete raw.joinRequests[id]
  if (raw.members?.[participant.uid]) delete raw.members[participant.uid]
  for (const [code, entry] of Object.entries(raw.recoveryCodes ?? {})) {
    if (entry.participantId === id) delete raw.recoveryCodes![code]
  }
  return raw
}

export const applyReassignTeam = (raw: LiveMarketState | null, id: string, teamId: string, atMillis: number): LiveMarketState | undefined => {
  const participant = raw?.participants?.[id]
  if (!raw || !participant || !raw.teams?.[teamId] || participant.teamId === teamId) return undefined
  participant.teamId = teamId
  raw.members ??= {}
  raw.members[participant.uid] = { teamId }
  raw.teamPortfolios ??= {}
  raw.teamPortfolios[teamId] ??= { cash: raw.meta.startingCash, holdings: {}, updatedAtMillis: atMillis }
  for (const entry of Object.values(raw.recoveryCodes ?? {})) {
    if (entry.participantId === id) entry.teamId = teamId
  }
  return raw
}

/** A rejected request is removed outright; the student sees the waiting screen time out. */
export const rejectJoinRequest = (database: Database, marketId: string, id: string) =>
  remove(ref(database, `${root(marketId)}/joinRequests/${id}`))

export const removeParticipant = async (database: Database, marketId: string, id: string) =>
  (await runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => applyRemoveParticipant(raw, id))).committed

export const reassignParticipantTeam = async (database: Database, marketId: string, id: string, teamId: string) =>
  (await runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => applyReassignTeam(raw, id, teamId, Date.now()))).committed
