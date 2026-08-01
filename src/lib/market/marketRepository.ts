import { collection, doc, getDoc, getDocs, query, runTransaction as runFirestoreTransaction, serverTimestamp, setDoc, updateDoc, where, type Firestore } from 'firebase/firestore'
import { onDisconnect, ref, remove, runTransaction, set, update, type Database } from 'firebase/database'
import type { TemplateSpec } from '../templates/types'
import { participantId, type JoinRequest, type LiveMarketParticipant, type LiveMarketState, type MarketVisibility, type TeamAssignmentMode } from './liveMarketTypes'
import { serverNow } from '../firebase/serverTime'

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
  meta: { ownerUid: input.ownerUid, capacity: MARKET_CAPACITY, visibility: input.visibility, status: 'SETUP' as const, createdAtMillis: serverNow(), startingCash: input.template.startingCash, joinCode: normalizeCode(input.joinCode ?? '') },
  teams: Object.fromEntries(input.template.teams.map((team) => [team.id, { id: team.id, name: team.name }])),
  companies: Object.fromEntries(input.template.companies.map((company) => [company.id, { id: company.id, name: company.name, symbol: company.symbol, basePrice: company.initialPrice, ...(company.pricePhases ? { phases: company.pricePhases } : {}) }])),
  teamPortfolios: Object.fromEntries(input.template.teams.map((team) => [team.id, { cash: input.template.startingCash, holdings: {}, updatedAtMillis: serverNow() }])),
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

/** Normalizes the presented recovery code and drops it unless it is exactly RECOVERY_CODE_LENGTH long. */
export const buildJoinRequestPayload = (
  request: Omit<JoinRequest, 'requestedAtMillis' | 'connected' | 'approvedAtMillis'>,
  atMillis: number,
): JoinRequest => {
  const payload = { ...request, connected: true, requestedAtMillis: atMillis }
  if (payload.recoveryCode) payload.recoveryCode = normalizeCode(payload.recoveryCode)
  if (payload.recoveryCode?.length !== RECOVERY_CODE_LENGTH) delete payload.recoveryCode
  return payload
}

export const requestToJoinMarket = async (
  database: Database,
  marketId: string,
  request: Omit<JoinRequest, 'requestedAtMillis' | 'connected' | 'approvedAtMillis'>,
) => {
  const id = participantId(request.uid, request.sessionId)
  const payload = buildJoinRequestPayload(request, serverNow())
  await set(ref(database, `${root(marketId)}/joinRequests/${id}`), payload)
  await onDisconnect(ref(database, `${root(marketId)}/joinRequests/${id}/connected`)).set(false)
  return id
}

export const markJoinRequestConnected = (database: Database, marketId: string, id: string, connected: boolean) =>
  update(ref(database, `${root(marketId)}/joinRequests/${id}`), { connected, lastSeenAtMillis: serverNow() })

/**
 * While still pending, re-arm an onDisconnect write that can change only the student's
 * own join request presence. Mirrors armApprovedParticipantPresence: an onDisconnect
 * registration does not survive a reconnect, so this must be called again on every
 * reconnection, not just once at request time (requestToJoinMarket arms it the first
 * time; this is what re-arms it afterward).
 */
export const armJoinRequestPresence = async (database: Database, marketId: string, id: string) => {
  await onDisconnect(ref(database, `${root(marketId)}/joinRequests/${id}/connected`)).set(false)
  await markJoinRequestConnected(database, marketId, id, true)
}

/** Once approved, arm an onDisconnect write that can change only the student's own participant presence. */
export const armApprovedParticipantPresence = async (database: Database, marketId: string, id: string) => {
  const connection = ref(database, `${root(marketId)}/participants/${id}/connected`)
  await onDisconnect(connection).set(false)
  await update(ref(database, `${root(marketId)}/participants/${id}`), { connected: true, lastSeenAtMillis: serverNow() })
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

export const RECOVERY_CODE_LENGTH = 4
/** Short enough to read aloud, from the same unambiguous alphabet as join codes. */
export const generateRecoveryCode = (randomValues: Uint32Array = crypto.getRandomValues(new Uint32Array(RECOVERY_CODE_LENGTH))) =>
  Array.from(randomValues, (value) => JOIN_CODE_ALPHABET[value % JOIN_CODE_ALPHABET.length]).join('')

/**
 * Collapses the differences a real student is likely to type by accident — full-width
 * vs half-width characters and spacing, both common on a phone's Japanese IME — while
 * leaving a genuinely different name genuinely different. NFKC folds width/compatibility
 * variants (e.g. the full-width space U+3000 becomes a normal space); stripping all
 * whitespace afterward absorbs an extra or missing space between family and given name
 * (「山田 太郎」 vs 「山田太郎」), which NFKC alone does not touch.
 */
const normalizeForIdentityMatch = (value: string): string => value.normalize('NFKC').replace(/\s+/gu, '')

/** Whether two presented display names identify the same student, tolerant of the input
 * noise above but never of an actually different name. */
export const matchesRecoveryIdentity = (a: string, b: string): boolean => normalizeForIdentityMatch(a) === normalizeForIdentityMatch(b)

/**
 * Resolves which team a pending request's presented recovery code would restore into, or
 * undefined if there is no code, no matching entry, or the identity check fails. Mirrors
 * the exact match `applyApproveJoinRequest` performs, purely so callers can show the
 * teacher what approval is about to do before it happens.
 */
export const resolveRecoveryTeamId = (state: LiveMarketState | null, request: Pick<JoinRequest, 'displayName' | 'recoveryCode'>): string | undefined => {
  const presentedCode = request.recoveryCode ? normalizeCode(request.recoveryCode) : undefined
  const candidate = presentedCode ? state?.recoveryCodes?.[presentedCode] : undefined
  return candidate && matchesRecoveryIdentity(candidate.displayName, request.displayName) ? candidate.teamId : undefined
}

/**
 * Approval, capacity, team assignment and device recovery are one indivisible step.
 *
 * A returning student presents the code they were shown on their old device. Their
 * assets live on the team, so restoring the team restores everything; the personal
 * trade history is re-keyed onto the new participant id and the stale participant
 * is retired so the teacher's list never shows a ghost.
 */
export const applyApproveJoinRequest = (
  raw: LiveMarketState | null,
  id: string,
  mode: TeamAssignmentMode,
  manualTeamId: string | undefined,
  atMillis: number,
  newCode: string,
): LiveMarketState | undefined => {
  if (!raw?.meta || !raw.joinRequests?.[id]) return undefined
  const request = raw.joinRequests[id]
  if (!request.connected) return undefined
  if (raw.participants?.[id]) return raw
  const active = Object.values(raw.participants ?? {}).filter((participant) => participant.connected).length
  if (active >= raw.meta.capacity) return undefined
  // Only honour a presented code when it also names the student it was issued to;
  // a code alone (readable off a neighbour's screen) is not proof of identity.
  const presentedCode = request.recoveryCode ? normalizeCode(request.recoveryCode) : undefined
  const candidate = presentedCode ? raw.recoveryCodes?.[presentedCode] : undefined
  const recovery = candidate && matchesRecoveryIdentity(candidate.displayName, request.displayName) ? candidate : undefined
  const teamId = recovery?.teamId ?? raw.members?.[request.uid]?.teamId ?? chooseTeam(raw, request, mode, manualTeamId)
  if (!teamId || !raw.teams?.[teamId]) return undefined
  // A newly generated code must not silently overwrite someone else's live code.
  if (!recovery && raw.recoveryCodes?.[newCode]) return undefined
  raw.participants ??= {}
  const participant: LiveMarketParticipant = { uid: request.uid, sessionId: request.sessionId, displayName: request.displayName, teamId, connected: true, lastSeenAtMillis: atMillis }
  raw.participants[id] = participant
  raw.members ??= {}
  raw.members[request.uid] = { teamId }
  raw.teamPortfolios ??= {}
  raw.teamPortfolios[teamId] ??= { cash: raw.meta.startingCash, holdings: {}, updatedAtMillis: atMillis }
  const code = recovery && presentedCode ? presentedCode : newCode
  if (recovery && recovery.participantId !== id) {
    const previous = raw.transactions?.[recovery.participantId]
    if (previous) {
      raw.transactions ??= {}
      raw.transactions[id] = { ...previous, ...(raw.transactions[id] ?? {}) }
      delete raw.transactions[recovery.participantId]
    }
    // Retire the old identity exactly as applyRemoveParticipant would, so it keeps no
    // member-level access and its stale join request cannot re-approve into a ping-pong.
    const oldUid = raw.participants[recovery.participantId]?.uid ?? raw.joinRequests[recovery.participantId]?.uid
    if (raw.participants[recovery.participantId]) delete raw.participants[recovery.participantId]
    if (raw.orders?.[recovery.participantId]) delete raw.orders[recovery.participantId]
    if (oldUid && oldUid !== request.uid) delete raw.members[oldUid]
    if (raw.joinRequests[recovery.participantId]) delete raw.joinRequests[recovery.participantId]
  }
  raw.recoveryCodes ??= {}
  raw.recoveryCodes[code] = { participantId: id, teamId, displayName: request.displayName }
  raw.joinRequests[id] = { ...request, approvedAtMillis: atMillis, recoveryCode: code }
  return raw
}

const APPROVE_RETRY_ATTEMPTS = 5

/**
 * Root transaction keeps the cap, request approval, team assignment and recovery indivisible.
 * A fresh code is generated outside the transaction updater (required for RTDB retry safety);
 * on the rare chance it collides with a code already in use, the whole transaction is retried
 * with a newly generated code, up to APPROVE_RETRY_ATTEMPTS times.
 */
export const approveJoinRequest = async (database: Database, marketId: string, id: string, mode: TeamAssignmentMode, manualTeamId?: string): Promise<boolean> => {
  for (let attempt = 0; attempt < APPROVE_RETRY_ATTEMPTS; attempt += 1) {
    const newCode = generateRecoveryCode()
    const result = await runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) =>
      applyApproveJoinRequest(raw, id, mode, manualTeamId, serverNow(), newCode))
    if (result.committed) return true
  }
  return false
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
  (await runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => applyReassignTeam(raw, id, teamId, serverNow()))).committed
