import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { submitHouseholdDecisionCallable } from './onCall'
import { getHouseholdStateWithAdminSdk, saveHouseholdDecision } from '../lessonRuns/households/repository'

const participantGetMock = vi.fn()
const teamGetMock = vi.fn()
const teamDocPaths: string[] = []

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: (path: string) => {
      if (!path.includes('/participantsByAuthUid/')) teamDocPaths.push(path)
      return { get: path.includes('/participantsByAuthUid/') ? participantGetMock : teamGetMock }
    },
  }),
}))

vi.mock('../lessonRuns/households/repository', () => ({
  getHouseholdStateWithAdminSdk: vi.fn(),
  householdRepositoryWithAdminSdk: vi.fn(() => ({})),
  saveHouseholdDecision: vi.fn(),
}))

interface SubmitHouseholdDecisionRequestData {
  lessonRunId: string
  householdId: string
  roundIndex: number
  assetAllocationChangesYen: Record<string, number>
  insurancePurchaseIds: string[]
  insuranceCancelIds: string[]
  shortfallResolutionType: 'REDUCE_EXPENSES' | 'SELL_ASSETS' | 'BORROW' | 'PUBLIC_SUPPORT' | 'DELAY_GOAL' | null
  shortfallResolutionAssetType?: string
  publicSupportApplicationIds: string[]
  idempotencyKey: string
}

const makeRequest = (
  data: Partial<SubmitHouseholdDecisionRequestData> = {}, uid = 'student-a',
): CallableRequest<SubmitHouseholdDecisionRequestData> => ({
  auth: { uid, token: { email_verified: true, firebase: { sign_in_provider: 'anonymous' } } },
  data: {
    lessonRunId: 'run-1', householdId: 'case-b', roundIndex: 3,
    assetAllocationChangesYen: { DOMESTIC_STOCK: 100000 }, insurancePurchaseIds: [], insuranceCancelIds: [],
    shortfallResolutionType: null, publicSupportApplicationIds: [], idempotencyKey: 'key-1',
    ...data,
  },
  rawRequest: {},
} as unknown as CallableRequest<SubmitHouseholdDecisionRequestData>)

const household = {
  householdId: 'case-b', lessonRunId: 'run-1', teamId: 'team-a', cashYen: 500000,
  assetHoldingsYen: {}, activeInsuranceContracts: {}, activeLiabilities: {},
  lifeStage: 'INDEPENDENT', roundIndex: 3, goalDelayedRounds: 0, updatedAtServerMillis: 0,
}

describe('submitHouseholdDecisionCallable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    teamDocPaths.length = 0
    participantGetMock.mockResolvedValue({ exists: true, data: () => ({ participantId: 'p-1' }) })
    teamGetMock.mockResolvedValue({ exists: true, data: () => ({ memberParticipantIds: ['p-1'] }) })
    vi.mocked(getHouseholdStateWithAdminSdk).mockResolvedValue(household)
  })

  it('rejects unauthenticated callers without touching Firestore', async () => {
    const request = { auth: undefined, data: {}, rawRequest: {} } as unknown as CallableRequest<SubmitHouseholdDecisionRequestData>
    await expect(submitHouseholdDecisionCallable.run(request)).rejects.toMatchObject({ code: 'unauthenticated' })
    expect(getHouseholdStateWithAdminSdk).not.toHaveBeenCalled()
  })

  it.each([
    ['lessonRunId', { lessonRunId: '' }],
    ['householdId', { householdId: '' }],
    ['roundIndex', { roundIndex: -1 }],
    ['idempotencyKey', { idempotencyKey: '' }],
    ['shortfallResolutionType', { shortfallResolutionType: 'BOGUS' as never }],
    // #1: SELL_ASSETS without naming which asset must not silently skip the
    // §13.13 consistency check.
    ['shortfallResolutionType SELL_ASSETS missing shortfallResolutionAssetType', { shortfallResolutionType: 'SELL_ASSETS' as const }],
    // #3: assetAllocationChangesYen must be a plain finite-number map, not
    // an array and not containing non-numeric values.
    ['assetAllocationChangesYen as an array', { assetAllocationChangesYen: [100000] as unknown as Record<string, number> }],
    ['assetAllocationChangesYen with a non-numeric value', { assetAllocationChangesYen: { DOMESTIC_STOCK: '100000' } as unknown as Record<string, number> }],
    ['assetAllocationChangesYen with a non-finite value', { assetAllocationChangesYen: { DOMESTIC_STOCK: Infinity } }],
    // #3: string-array fields must contain non-empty strings, not arbitrary
    // elements.
    ['insurancePurchaseIds with a non-string element', { insurancePurchaseIds: [123 as unknown as string] }],
    ['insuranceCancelIds with an empty-string element', { insuranceCancelIds: [''] }],
    ['publicSupportApplicationIds with a non-string element', { publicSupportApplicationIds: [null as unknown as string] }],
  ])('rejects a request with an invalid %s', async (_field, override) => {
    await expect(submitHouseholdDecisionCallable.run(makeRequest(override))).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(getHouseholdStateWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects when the household cannot be found', async () => {
    vi.mocked(getHouseholdStateWithAdminSdk).mockResolvedValue(null)
    await expect(submitHouseholdDecisionCallable.run(makeRequest())).rejects.toMatchObject({ code: 'not-found' })
    expect(saveHouseholdDecision).not.toHaveBeenCalled()
  })

  it('rejects a caller who is not a member of the team that owns this household (never trusting a client-supplied teamId)', async () => {
    teamGetMock.mockResolvedValue({ exists: true, data: () => ({ memberParticipantIds: ['someone-else'] }) })
    await expect(submitHouseholdDecisionCallable.run(makeRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(saveHouseholdDecision).not.toHaveBeenCalled()
  })

  it('resolves team ownership from the household\'s own stored teamId, not from client input', async () => {
    vi.mocked(saveHouseholdDecision).mockResolvedValue({ decisionId: 'dec-1', created: true })
    await submitHouseholdDecisionCallable.run(makeRequest())
    // team-a is the household's OWN teamId (never sent by the client at all —
    // the request payload for this Callable has no `teamId` field). Asserting
    // on the captured `doc(...)` path (not just that `get()` was called at
    // all) proves the correct team document was read.
    expect(teamGetMock).toHaveBeenCalled()
    expect(teamDocPaths).toHaveLength(1)
    expect(teamDocPaths[0]).toMatch(/\/teams\/team-a$/)
  })

  it('is idempotent: a repeated idempotencyKey is forwarded through unchanged and the reported created flag reflects saveDecision\'s own dedup result', async () => {
    vi.mocked(saveHouseholdDecision).mockResolvedValueOnce({ decisionId: 'dec-1', created: true })
    const first = await submitHouseholdDecisionCallable.run(makeRequest())
    expect(first).toEqual({ decisionId: 'dec-1', created: true })

    vi.mocked(saveHouseholdDecision).mockResolvedValueOnce({ decisionId: 'dec-1', created: false })
    const second = await submitHouseholdDecisionCallable.run(makeRequest())
    expect(second).toEqual({ decisionId: 'dec-1', created: false })

    expect(vi.mocked(saveHouseholdDecision).mock.calls[0][0]).toMatchObject({ idempotencyKey: 'key-1', roundIndex: 3 })
    expect(vi.mocked(saveHouseholdDecision).mock.calls[1][0]).toMatchObject({ idempotencyKey: 'key-1', roundIndex: 3 })
  })

  it('happy path: forwards a valid decision and returns the saved decisionId/created', async () => {
    vi.mocked(saveHouseholdDecision).mockResolvedValue({ decisionId: 'dec-42', created: true })
    await expect(submitHouseholdDecisionCallable.run(makeRequest())).resolves.toEqual({ decisionId: 'dec-42', created: true })
    expect(saveHouseholdDecision).toHaveBeenCalledWith(expect.objectContaining({
      lessonRunId: 'run-1', householdId: 'case-b', roundIndex: 3,
      assetAllocationChangesYen: { DOMESTIC_STOCK: 100000 }, idempotencyKey: 'key-1',
    }))
  })

  it('translates the internal-consistency rejection (spec §13.13) into failed-precondition', async () => {
    await expect(submitHouseholdDecisionCallable.run(makeRequest({
      shortfallResolutionType: 'SELL_ASSETS', shortfallResolutionAssetType: 'DOMESTIC_STOCK',
      assetAllocationChangesYen: { DOMESTIC_STOCK: 50000 },
    }))).rejects.toMatchObject({ code: 'failed-precondition' })
    expect(saveHouseholdDecision).not.toHaveBeenCalled()
  })

  it('translates an idempotency key payload mismatch into failed-precondition', async () => {
    vi.mocked(saveHouseholdDecision).mockRejectedValue(new Error('Idempotency key payload mismatch'))
    await expect(submitHouseholdDecisionCallable.run(makeRequest()))
      .rejects.toMatchObject({ code: 'failed-precondition', message: 'Idempotency key payload mismatch' })
  })

  it('accepts a request that omits shortfallResolutionType entirely, normalizing it to null rather than crashing (#2)', async () => {
    vi.mocked(saveHouseholdDecision).mockResolvedValue({ decisionId: 'dec-1', created: true })
    const { shortfallResolutionType: _omit, ...dataWithoutShortfallType } = makeRequest().data
    const request = { ...makeRequest(), data: dataWithoutShortfallType } as unknown as CallableRequest<SubmitHouseholdDecisionRequestData>
    await expect(submitHouseholdDecisionCallable.run(request)).resolves.toEqual({ decisionId: 'dec-1', created: true })
    expect(saveHouseholdDecision).toHaveBeenCalledWith(expect.objectContaining({ shortfallResolutionType: null }))
  })

  it('rejects a request whose roundIndex does not match the household\'s own stored roundIndex (#4)', async () => {
    await expect(submitHouseholdDecisionCallable.run(makeRequest({ roundIndex: household.roundIndex + 1 })))
      .rejects.toMatchObject({ code: 'failed-precondition' })
    expect(saveHouseholdDecision).not.toHaveBeenCalled()
  })
})
