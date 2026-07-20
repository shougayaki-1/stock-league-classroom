import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore'
import { onDisconnect, ref, runTransaction, set, update, type Database } from 'firebase/database'
import type { TemplateSpec } from '../templates/types'
import { participantId, type JoinRequest, type LiveMarketParticipant, type LiveMarketState, type MarketVisibility, type TeamAssignmentMode } from './liveMarketTypes'

export const MARKET_CAPACITY = 80
export interface MarketRecord { id: string; ownerUid: string; templateSnapshot: TemplateSpec; capacity: number; visibility: MarketVisibility; createdAt: unknown }
export interface CreateMarketInput { ownerUid: string; template: TemplateSpec; visibility: MarketVisibility; joinCode: string; teams: Array<{ id: string; name: string }> }

const root = (marketId: string) => `liveMarkets/${marketId}`
const normalizeCode = (code: string) => code.trim().toUpperCase()

/** Creates immutable market metadata. The caller must be a signed-in teacher; Rules enforce ownership. */
export const createMarket = async (firestore: Firestore, database: Database, input: CreateMarketInput): Promise<string> => {
  const marketRef = await addDoc(collection(firestore, 'markets'), {
    ownerUid: input.ownerUid, templateSnapshot: structuredClone(input.template), capacity: MARKET_CAPACITY,
    visibility: input.visibility, createdAt: serverTimestamp(),
  })
  const code = normalizeCode(input.joinCode)
  await setDoc(doc(firestore, 'marketJoinCodes', code), { marketId: marketRef.id, ownerUid: input.ownerUid, createdAt: serverTimestamp() })
  const teams = Object.fromEntries(input.teams.map((team) => [team.id, { id: team.id, name: team.name }]))
  await set(ref(database, root(marketRef.id)), { meta: { ownerUid: input.ownerUid, capacity: MARKET_CAPACITY, visibility: input.visibility, status: 'SETUP', createdAtMillis: Date.now() }, teams })
  return marketRef.id
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
    raw.joinRequests[id] = { ...request, approvedAtMillis: Date.now() }
    return raw
  })
  return result.committed
}
