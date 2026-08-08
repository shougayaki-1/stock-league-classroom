import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallableRequest } from 'firebase-functions/v2/https'
import {
  processRoundCallable,
  restoreHouseholdCheckpointCallable,
  submitHouseholdDecisionCallable,
  writeHouseholdCheckpointCallable,
} from './onCall'
import {
  getHouseholdStateWithAdminSdk,
  householdRepositoryWithAdminSdk,
  saveHouseholdDecision,
} from '../lessonRuns/households/repository'
import { requireActiveOrgMember } from '../organizations/authorization'
import { restoreCheckpointWithAdminSdk, writeCheckpointWithAdminSdk } from '../lessonRuns/checkpoint'
import { processRoundWithAdminSdk } from './processRound'

const participantGetMock = vi.fn()
const teamGetMock = vi.fn()
const lessonRunGetMock = vi.fn()
const checkpointGetMock = vi.fn()
const teamDocPaths: string[] = []

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: (path: string) => {
      if (/^lessonRuns\/[^/]+$/.test(path)) return { get: lessonRunGetMock }
      if (path.includes('/checkpoints/')) return { get: checkpointGetMock }
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

vi.mock('../lessonRuns/checkpoint', () => ({
  writeCheckpointWithAdminSdk: vi.fn(),
  restoreCheckpointWithAdminSdk: vi.fn(),
}))

vi.mock('../organizations/authorization', () => ({ requireActiveOrgMember: vi.fn() }))
vi.mock('./processRound', () => ({ processRoundWithAdminSdk: vi.fn() }))

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
  voluntaryDrawdownRequestedYen?: number
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
    // Task 11/12 integration gap fix: voluntaryDrawdownRequestedYen must be
    // a non-negative finite number when present — this money-conservation-
    // critical field must never carry a negative/NaN/Infinity value into
    // settleRound's drawdown math.
    ['voluntaryDrawdownRequestedYen negative', { voluntaryDrawdownRequestedYen: -1 }],
    ['voluntaryDrawdownRequestedYen non-finite', { voluntaryDrawdownRequestedYen: Infinity }],
    ['voluntaryDrawdownRequestedYen NaN', { voluntaryDrawdownRequestedYen: NaN }],
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

  it('forwards voluntaryDrawdownRequestedYen through to saveDecision when present (Task 11/12 integration gap fix)', async () => {
    vi.mocked(saveHouseholdDecision).mockResolvedValue({ decisionId: 'dec-1', created: true })
    await submitHouseholdDecisionCallable.run(makeRequest({ voluntaryDrawdownRequestedYen: 300000 }))
    expect(saveHouseholdDecision).toHaveBeenCalledWith(expect.objectContaining({ voluntaryDrawdownRequestedYen: 300000 }))
  })

  it('omits voluntaryDrawdownRequestedYen from saveDecision when not provided, rather than forwarding undefined', async () => {
    vi.mocked(saveHouseholdDecision).mockResolvedValue({ decisionId: 'dec-1', created: true })
    await submitHouseholdDecisionCallable.run(makeRequest())
    const call = vi.mocked(saveHouseholdDecision).mock.calls[0][0]
    expect('voluntaryDrawdownRequestedYen' in call).toBe(false)
  })
})

interface ProcessRoundRequestData {
  lessonRunId: string
  householdId: string
  forceSettle?: boolean
}

const makeProcessRoundRequest = (
  data: Partial<ProcessRoundRequestData> = {}, uid = 'teacher-a',
): CallableRequest<ProcessRoundRequestData> => ({
  auth: { uid, token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } },
  data: { lessonRunId: 'run-1', householdId: 'case-b', ...data },
  rawRequest: {},
} as unknown as CallableRequest<ProcessRoundRequestData>)

const makeLessonRunSnap = (exists: boolean, fields: Record<string, unknown> = {}) => ({
  exists,
  get: (field: string) => fields[field],
})

describe('processRoundCallable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthenticated callers without touching Firestore', async () => {
    const request = { auth: undefined, data: {}, rawRequest: {} } as unknown as CallableRequest<ProcessRoundRequestData>
    await expect(processRoundCallable.run(request)).rejects.toMatchObject({ code: 'unauthenticated' })
    expect(lessonRunGetMock).not.toHaveBeenCalled()
  })

  it.each([
    ['lessonRunId', { lessonRunId: '' }],
    ['householdId', { householdId: '' }],
  ])('rejects a request with an invalid %s', async (_field, override) => {
    await expect(processRoundCallable.run(makeProcessRoundRequest(override))).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(lessonRunGetMock).not.toHaveBeenCalled()
  })

  it('rejects when the LessonRun does not exist', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(false))
    await expect(processRoundCallable.run(makeProcessRoundRequest())).rejects.toMatchObject({ code: 'not-found' })
    expect(processRoundWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects a caller with no teacher role on this run', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: {} }))
    await expect(processRoundCallable.run(makeProcessRoundRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(requireActiveOrgMember).not.toHaveBeenCalled()
    expect(processRoundWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects an ASSISTANT-role teacher (PROCESS_ROUND is PRIMARY-only, never trusting a client-asserted role)', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'ASSISTANT' } }))
    await expect(processRoundCallable.run(makeProcessRoundRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(processRoundWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects a VIEWER-role teacher (PROCESS_ROUND is PRIMARY-only)', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'VIEWER' } }))
    await expect(processRoundCallable.run(makeProcessRoundRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(processRoundWithAdminSdk).not.toHaveBeenCalled()
  })

  it('proceeds for a PRIMARY-role teacher who is an active org member (happy path)', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    const result = {
      newHouseholdState: { householdId: 'case-b' }, occurredEventIds: [], incomeYen: 0, expensesYen: 0,
      netCashFlowYen: 0, shortfallYen: 0, insuranceBenefitsYen: 0,
    }
    vi.mocked(processRoundWithAdminSdk).mockResolvedValue(result as never)

    await expect(processRoundCallable.run(makeProcessRoundRequest())).resolves.toEqual(result)

    expect(requireActiveOrgMember).toHaveBeenCalledWith(expect.anything(), 'org-1', 'teacher-a')
    expect(processRoundWithAdminSdk).toHaveBeenCalledWith({
      lessonRunId: 'run-1', householdId: 'case-b', actorId: 'teacher-a', forceSettle: false,
    })
  })

  it('translates "HouseholdState not found" into not-found', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(processRoundWithAdminSdk).mockRejectedValue(new Error('HouseholdState not found'))
    await expect(processRoundCallable.run(makeProcessRoundRequest())).rejects.toMatchObject({ code: 'not-found' })
  })

  // Task 11 review round 2 — brief §Step 6 submission gate.
  it('rejects a non-boolean forceSettle', async () => {
    await expect(processRoundCallable.run(makeProcessRoundRequest({ forceSettle: 'yes' as unknown as boolean })))
      .rejects.toMatchObject({ code: 'invalid-argument' })
    expect(lessonRunGetMock).not.toHaveBeenCalled()
  })

  it('translates "HouseholdDecision not submitted for this round" into failed-precondition', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(processRoundWithAdminSdk).mockRejectedValue(new Error('HouseholdDecision not submitted for this round'))
    await expect(processRoundCallable.run(makeProcessRoundRequest())).rejects.toMatchObject({ code: 'failed-precondition' })
  })

  it('forwards forceSettle: true through to processRoundWithAdminSdk when the teacher explicitly opts in', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    const result = {
      newHouseholdState: { householdId: 'case-b' }, occurredEventIds: [], incomeYen: 0, expensesYen: 0,
      netCashFlowYen: 0, shortfallYen: 0, insuranceBenefitsYen: 0,
    }
    vi.mocked(processRoundWithAdminSdk).mockResolvedValue(result as never)

    await expect(processRoundCallable.run(makeProcessRoundRequest({ forceSettle: true }))).resolves.toEqual(result)
    expect(processRoundWithAdminSdk).toHaveBeenCalledWith({
      lessonRunId: 'run-1', householdId: 'case-b', actorId: 'teacher-a', forceSettle: true,
    })
  })
})

interface WriteHouseholdCheckpointRequestData {
  lessonRunId: string
  phaseId: string
  sequence: number
  householdIds: string[]
  idempotencyKey: string
}

const makeWriteCheckpointRequest = (
  data: Partial<WriteHouseholdCheckpointRequestData> = {}, uid = 'teacher-a',
): CallableRequest<WriteHouseholdCheckpointRequestData> => ({
  auth: { uid, token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } },
  data: {
    lessonRunId: 'run-1', phaseId: 'phase-1', sequence: 3, householdIds: ['case-b'], idempotencyKey: 'key-1',
    ...data,
  },
  rawRequest: {},
} as unknown as CallableRequest<WriteHouseholdCheckpointRequestData>)

describe('writeHouseholdCheckpointCallable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getHouseholdStateWithAdminSdk).mockResolvedValue(household)
  })

  it('rejects unauthenticated callers without touching Firestore', async () => {
    const request = { auth: undefined, data: {}, rawRequest: {} } as unknown as CallableRequest<WriteHouseholdCheckpointRequestData>
    await expect(writeHouseholdCheckpointCallable.run(request)).rejects.toMatchObject({ code: 'unauthenticated' })
    expect(lessonRunGetMock).not.toHaveBeenCalled()
  })

  it.each([
    ['lessonRunId', { lessonRunId: '' }],
    ['phaseId', { phaseId: '' }],
    ['sequence', { sequence: -1 }],
    ['householdIds empty', { householdIds: [] }],
    ['householdIds with a non-string element', { householdIds: [123 as unknown as string] }],
    ['idempotencyKey', { idempotencyKey: '' }],
  ])('rejects a request with an invalid %s', async (_field, override) => {
    await expect(writeHouseholdCheckpointCallable.run(makeWriteCheckpointRequest(override))).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(lessonRunGetMock).not.toHaveBeenCalled()
  })

  it('rejects a caller with no teacher role on this run', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: {} }))
    await expect(writeHouseholdCheckpointCallable.run(makeWriteCheckpointRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(requireActiveOrgMember).not.toHaveBeenCalled()
    expect(writeCheckpointWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects a VIEWER-role teacher (never trusting a client-asserted role)', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'VIEWER' } }))
    await expect(writeHouseholdCheckpointCallable.run(makeWriteCheckpointRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(writeCheckpointWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects when a named household cannot be found', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(getHouseholdStateWithAdminSdk).mockResolvedValue(null)
    await expect(writeHouseholdCheckpointCallable.run(makeWriteCheckpointRequest())).rejects.toMatchObject({ code: 'not-found' })
    expect(writeCheckpointWithAdminSdk).not.toHaveBeenCalled()
  })

  it('happy path: an ASSISTANT-role teacher who is an active org member builds a snapshot from every named household and writes it via writeCheckpointWithAdminSdk', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'ASSISTANT' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(writeCheckpointWithAdminSdk).mockResolvedValue({ checkpointId: 'cp-1', deduplicated: false })

    const result = await writeHouseholdCheckpointCallable.run(makeWriteCheckpointRequest())

    expect(result).toEqual({ checkpointId: 'cp-1', deduplicated: false })
    expect(requireActiveOrgMember).toHaveBeenCalledWith(expect.anything(), 'org-1', 'teacher-a')
    expect(writeCheckpointWithAdminSdk).toHaveBeenCalledWith({
      lessonRunId: 'run-1', phaseId: 'phase-1', sequence: 3,
      snapshot: { schemaVersion: 1, households: [household] },
      createdBy: 'TEACHER', idempotencyKey: 'key-1',
    })
  })

  it('translates an idempotency key payload mismatch into failed-precondition', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(writeCheckpointWithAdminSdk).mockRejectedValue(new Error('Idempotency key payload mismatch'))
    await expect(writeHouseholdCheckpointCallable.run(makeWriteCheckpointRequest()))
      .rejects.toMatchObject({ code: 'failed-precondition', message: 'Idempotency key payload mismatch' })
  })
})

interface RestoreHouseholdCheckpointRequestData {
  lessonRunId: string
  checkpointId: string
  reason: string
  idempotencyKey: string
}

const makeRestoreCheckpointRequest = (
  data: Partial<RestoreHouseholdCheckpointRequestData> = {}, uid = 'teacher-a',
): CallableRequest<RestoreHouseholdCheckpointRequestData> => ({
  auth: { uid, token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } },
  data: { lessonRunId: 'run-1', checkpointId: 'cp-1', reason: 'undo mistaken settlement', idempotencyKey: 'key-1', ...data },
  rawRequest: {},
} as unknown as CallableRequest<RestoreHouseholdCheckpointRequestData>)

describe('restoreHouseholdCheckpointCallable', () => {
  const snapshotSetCalls: Array<{ path: string; data: unknown }> = []
  const runTransactionMock = vi.fn(async (fn: (tx: { set: (path: string, data: unknown) => void }) => Promise<void>) => {
    await fn({ set: (path, data) => snapshotSetCalls.push({ path, data }) })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    snapshotSetCalls.length = 0
    vi.mocked(householdRepositoryWithAdminSdk).mockReturnValue({ runTransaction: runTransactionMock as never })
  })

  it('rejects unauthenticated callers without touching Firestore', async () => {
    const request = { auth: undefined, data: {}, rawRequest: {} } as unknown as CallableRequest<RestoreHouseholdCheckpointRequestData>
    await expect(restoreHouseholdCheckpointCallable.run(request)).rejects.toMatchObject({ code: 'unauthenticated' })
    expect(lessonRunGetMock).not.toHaveBeenCalled()
  })

  it.each([
    ['lessonRunId', { lessonRunId: '' }],
    ['checkpointId', { checkpointId: '' }],
    ['reason', { reason: '  ' }],
    ['idempotencyKey', { idempotencyKey: '' }],
  ])('rejects a request with an invalid %s', async (_field, override) => {
    await expect(restoreHouseholdCheckpointCallable.run(makeRestoreCheckpointRequest(override))).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(lessonRunGetMock).not.toHaveBeenCalled()
  })

  it('rejects a caller with no teacher role on this run, never calling restoreCheckpointWithAdminSdk', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: {} }))
    await expect(restoreHouseholdCheckpointCallable.run(makeRestoreCheckpointRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(requireActiveOrgMember).not.toHaveBeenCalled()
    expect(restoreCheckpointWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects a VIEWER-role teacher (never trusting a client-asserted role)', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'VIEWER' } }))
    await expect(restoreHouseholdCheckpointCallable.run(makeRestoreCheckpointRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(restoreCheckpointWithAdminSdk).not.toHaveBeenCalled()
  })

  it('happy path: an ASSISTANT-role teacher who is an active org member restores the checkpoint and writes every household back to Firestore', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'ASSISTANT' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(restoreCheckpointWithAdminSdk).mockResolvedValue({ newRestoreGeneration: 2, eventId: 'evt-1', deduplicated: false })
    checkpointGetMock.mockResolvedValue({
      exists: true,
      get: (field: string) => (field === 'snapshot' ? { schemaVersion: 1, households: [household] } : undefined),
    })

    const result = await restoreHouseholdCheckpointCallable.run(makeRestoreCheckpointRequest())

    expect(result).toEqual({ newRestoreGeneration: 2, eventId: 'evt-1', deduplicated: false, restoredHouseholdIds: ['case-b'] })
    expect(restoreCheckpointWithAdminSdk).toHaveBeenCalledWith({
      lessonRunId: 'run-1', checkpointId: 'cp-1', reason: 'undo mistaken settlement', actorId: 'teacher-a', idempotencyKey: 'key-1',
    })
    // Proves restore genuinely persists the restored HouseholdState back to
    // Firestore — not just returning it to the caller unpersisted.
    expect(snapshotSetCalls).toEqual([{ path: 'lessonRuns/run-1/households/case-b', data: household }])
  })

  it('translates "Checkpoint not found" from restoreCheckpointWithAdminSdk into not-found, writing nothing back', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(restoreCheckpointWithAdminSdk).mockRejectedValue(new Error('Checkpoint not found'))
    await expect(restoreHouseholdCheckpointCallable.run(makeRestoreCheckpointRequest())).rejects.toMatchObject({ code: 'not-found' })
    expect(snapshotSetCalls).toHaveLength(0)
  })

  it('translates an idempotency key payload mismatch into failed-precondition', async () => {
    lessonRunGetMock.mockResolvedValue(makeLessonRunSnap(true, { orgId: 'org-1', teacherRoles: { 'teacher-a': 'PRIMARY' } }))
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(restoreCheckpointWithAdminSdk).mockRejectedValue(new Error('Idempotency key payload mismatch'))
    await expect(restoreHouseholdCheckpointCallable.run(makeRestoreCheckpointRequest()))
      .rejects.toMatchObject({ code: 'failed-precondition', message: 'Idempotency key payload mismatch' })
  })
})
