import { describe, expect, it, vi } from 'vitest'
import {
  applyTeacherIntervention,
  canApplyIntervention,
  interventionPermissions,
  lessonInterventionTypes,
  transferPrimaryTeacher,
  type LessonInterventionType,
} from './interventions'

// Same "all reads before all writes" fake as teams/assignTeam.test.ts /
// phases/transitionPhase.test.ts / responses/confirmResponse.test.ts — added
// after Task 3's Critical #1 production incident so a read-after-write
// ordering bug fails a test instead of only failing in production.
const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    runTransaction: async <T>(fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      set: (path: string, data: Record<string, unknown>) => void
    }) => Promise<T>) => {
      let written = false
      return fn({
        get: async (path: string) => {
          if (written) throw new Error('Firestore transactions require all reads to be executed before all writes.')
          return { exists: docs.has(path), data: () => docs.get(path) }
        },
        set: (path: string, data: Record<string, unknown>) => { written = true; docs.set(path, data) },
      })
    },
  }
}

const setUpRun = (docs: Map<string, Record<string, unknown>>, overrides: Record<string, unknown> = {}) => {
  docs.set('lessonRuns/run-1', {
    id: 'run-1', orgId: 'org-1', status: 'RUNNING', currentPhaseId: 'phase-2',
    teacherRoles: { 'teacher-primary': 'PRIMARY', 'teacher-assist': 'ASSISTANT' },
    primaryTeacherUid: 'teacher-primary',
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// Step 1: primary-teacher handoff
// ---------------------------------------------------------------------------

describe('transferPrimaryTeacher', () => {
  it('lets the primary teacher hand off to an active assistant: old PRIMARY -> ASSISTANT, new ASSISTANT -> PRIMARY', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs)

    const result = await transferPrimaryTeacher({ firestore: fake as never, now: () => 'fixed-now' }, {
      lessonRunId: 'run-1', callerUid: 'teacher-primary', newPrimaryTeacherUid: 'teacher-assist',
      reason: '体調不良のため交代', idempotencyKey: 'transfer-1',
    })

    expect(result.deduplicated).toBe(false)
    expect(result.previousPrimaryTeacherUid).toBe('teacher-primary')
    expect(result.newPrimaryTeacherUid).toBe('teacher-assist')
    const run = fake.docs.get('lessonRuns/run-1') as { teacherRoles: Record<string, string>; primaryTeacherUid: string }
    expect(run.teacherRoles['teacher-primary']).toBe('ASSISTANT')
    expect(run.teacherRoles['teacher-assist']).toBe('PRIMARY')
    expect(run.primaryTeacherUid).toBe('teacher-assist')
    const eventKey = [...fake.docs.keys()].find((k) => k.includes('/events/'))
    const event = fake.docs.get(eventKey as string) as { type: string }
    expect(event.type).toBe('PRIMARY_TEACHER_TRANSFERRED')
  })

  it('rejects a caller who is not the primary teacher (ASSISTANT cannot transfer)', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs)

    await expect(transferPrimaryTeacher({ firestore: fake as never, now: () => 'fixed-now' }, {
      lessonRunId: 'run-1', callerUid: 'teacher-assist', newPrimaryTeacherUid: 'teacher-primary',
      reason: '不正な移譲', idempotencyKey: 'transfer-2',
    })).rejects.toThrow('Only the primary teacher may transfer the primary role')
  })

  it('rejects a viewer attempting to transfer', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs, { teacherRoles: { 'teacher-primary': 'PRIMARY', 'teacher-view': 'VIEWER' } })

    await expect(transferPrimaryTeacher({ firestore: fake as never, now: () => 'fixed-now' }, {
      lessonRunId: 'run-1', callerUid: 'teacher-view', newPrimaryTeacherUid: 'teacher-primary',
      reason: '不正な移譲', idempotencyKey: 'transfer-3',
    })).rejects.toThrow('Only the primary teacher may transfer the primary role')
  })

  it('rejects handing off to someone who is not currently an active assistant on this run', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs)

    await expect(transferPrimaryTeacher({ firestore: fake as never, now: () => 'fixed-now' }, {
      lessonRunId: 'run-1', callerUid: 'teacher-primary', newPrimaryTeacherUid: 'teacher-stranger',
      reason: '不明な相手', idempotencyKey: 'transfer-4',
    })).rejects.toThrow('The new primary teacher must currently be an active assistant on this run')
  })

  it('does not reference any device/host-lease concept — a bare LessonRun doc with no session/device state is sufficient', async () => {
    // Regression check for §6.5 "授業のホストは端末に固定しない": the fake
    // Firestore above holds nothing beyond the LessonRun doc itself (no
    // device/session/lease collection exists anywhere), and the transfer
    // still succeeds purely from `teacherRoles` — proving this function has
    // no notion of a "host device" to consult.
    const fake = makeFakeFirestore()
    setUpRun(fake.docs)
    expect([...fake.docs.keys()]).toEqual(['lessonRuns/run-1'])

    await transferPrimaryTeacher({ firestore: fake as never, now: () => 'fixed-now' }, {
      lessonRunId: 'run-1', callerUid: 'teacher-primary', newPrimaryTeacherUid: 'teacher-assist',
      reason: '端末非依存の確認', idempotencyKey: 'transfer-5',
    })
    // Still nothing beyond the run doc + its own event/idempotency subpaths.
    const paths = [...fake.docs.keys()]
    expect(paths.every((p) => p.startsWith('lessonRuns/run-1'))).toBe(true)
  })

  it('deduplicates a retried transfer with the same idempotencyKey', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs)
    const deps = { firestore: fake as never, now: () => 'fixed-now' }
    const input = {
      lessonRunId: 'run-1', callerUid: 'teacher-primary', newPrimaryTeacherUid: 'teacher-assist',
      reason: '交代', idempotencyKey: 'transfer-6',
    }
    const first = await transferPrimaryTeacher(deps, input)
    const retry = await transferPrimaryTeacher(deps, input)
    expect(retry.deduplicated).toBe(true)
    expect(retry.newPrimaryTeacherUid).toBe(first.newPrimaryTeacherUid)
    const events = [...fake.docs.keys()].filter((k) => k.includes('/events/'))
    expect(events).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Step 2: table-driven permission + required-payload coverage for the 9
// intervention types
// ---------------------------------------------------------------------------

describe('canApplyIntervention', () => {
  it('exhaustively covers every non-EXTEND_TIME LessonInterventionType with no gaps against interventionPermissions', () => {
    const allRoles = ['PRIMARY', 'ASSISTANT', 'VIEWER'] as const
    for (const type of lessonInterventionTypes) {
      if (type === 'EXTEND_TIME') continue // handled by its own test below (delegates to canControlLesson)
      for (const role of allRoles) {
        expect(canApplyIntervention(role, type)).toBe(interventionPermissions[type].includes(role))
      }
    }
  })

  // EXTEND_TIME is deliberately NOT reimplemented in interventionPermissions
  // — it must delegate to authorization.ts's existing canControlLesson
  // table (PRIMARY + ASSISTANT), per the task brief's instruction not to
  // reinvent an already-defined permission.
  it('EXTEND_TIME reuses the existing LessonControlAction table (PRIMARY + ASSISTANT, not VIEWER)', () => {
    expect(canApplyIntervention('PRIMARY', 'EXTEND_TIME')).toBe(true)
    expect(canApplyIntervention('ASSISTANT', 'EXTEND_TIME')).toBe(true)
    expect(canApplyIntervention('VIEWER', 'EXTEND_TIME')).toBe(false)
  })

  it.each(['CORRECT_STATE', 'RESTORE_PREVIOUS_PHASE', 'EMERGENCY_STOP'] as const)(
    '%s is PRIMARY-only',
    (type) => {
      expect(canApplyIntervention('PRIMARY', type)).toBe(true)
      expect(canApplyIntervention('ASSISTANT', type)).toBe(false)
      expect(canApplyIntervention('VIEWER', type)).toBe(false)
    },
  )

  it.each([
    'PROXY_CONFIRM', 'CHANGE_REPRESENTATIVE', 'RECONNECT_PARTICIPANT', 'SWITCH_DISPLAY_SLIDE', 'HIDE_INFORMATION',
  ] as const)('%s is allowed for PRIMARY and ASSISTANT but not VIEWER', (type) => {
    expect(canApplyIntervention('PRIMARY', type)).toBe(true)
    expect(canApplyIntervention('ASSISTANT', type)).toBe(true)
    expect(canApplyIntervention('VIEWER', type)).toBe(false)
  })
})

const baseEnvelope = {
  lessonRunId: 'run-1',
  reason: '生徒Aの端末トラブル対応',
  before: { note: 'before-snapshot' },
  after: { note: 'after-snapshot' },
  impactScope: { level: 'PARTICIPANT', participantId: 'p-1' } as const,
  idempotencyKey: 'intervention-1',
}

const REQUIRED_DETAIL: Record<LessonInterventionType, Record<string, unknown>> = {
  EXTEND_TIME: { phaseId: 'phase-2', additionalSeconds: 60 },
  PROXY_CONFIRM: { phaseId: 'phase-2', inputId: 'input-1', onBehalfOfParticipantId: 'p-1' },
  CHANGE_REPRESENTATIVE: { teamId: 'team-a', newRepresentativeParticipantId: 'p-2' },
  RECONNECT_PARTICIPANT: { participantId: 'p-1', newAuthUid: 'auth-new' },
  SWITCH_DISPLAY_SLIDE: { slideId: 'slide-3' },
  CORRECT_STATE: { targetPath: 'lessonRuns/run-1/teams/team-a' },
  RESTORE_PREVIOUS_PHASE: { targetPhaseId: 'phase-1' },
  EMERGENCY_STOP: {},
  HIDE_INFORMATION: { informationId: 'info-1' },
}

const makeDelegates = () => ({
  rotateRepresentative: vi.fn().mockResolvedValue({ teamId: 'team-a', newRepresentativeParticipantId: 'p-2', deduplicated: false }),
  confirmResponse: vi.fn().mockResolvedValue({ responseId: 'r-1', status: 'CONFIRMED', deduplicated: false }),
  reconnectParticipant: vi.fn().mockResolvedValue({ participantId: 'p-1', newAuthUid: 'auth-new', deduplicated: false }),
  transitionPhase: vi.fn().mockResolvedValue({ status: 'RUNNING', currentPhaseId: 'phase-1', deduplicated: false }),
  stopNewOperations: vi.fn().mockResolvedValue(undefined),
})

describe('applyTeacherIntervention: table-driven required-payload validation', () => {
  it.each(lessonInterventionTypes)('rejects %s when a required detail field is missing', async (type) => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs)
    const requiredKeys = Object.keys(REQUIRED_DETAIL[type])
    if (requiredKeys.length === 0) return // EMERGENCY_STOP has no required detail fields
    const incompleteDetail = { ...REQUIRED_DETAIL[type] }
    delete incompleteDetail[requiredKeys[0]]

    await expect(applyTeacherIntervention({
      firestore: fake as never,
      actorId: 'teacher-primary',
      now: () => 'fixed-now',
      loadRunContext: async () => ({ orgId: 'org-1', status: 'RUNNING' }),
      delegates: makeDelegates(),
    }, { ...baseEnvelope, type, detail: incompleteDetail })).rejects.toThrow(/required/i)
  })

  it.each(lessonInterventionTypes)('accepts %s with a fully-populated detail payload', async (type) => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs)
    const delegates = makeDelegates()

    const result = await applyTeacherIntervention({
      firestore: fake as never,
      actorId: 'teacher-primary',
      now: () => 'fixed-now',
      loadRunContext: async () => ({ orgId: 'org-1', status: 'RUNNING' }),
      delegates,
    }, { ...baseEnvelope, type, detail: REQUIRED_DETAIL[type], idempotencyKey: `accept-${type}` })

    expect(result.deduplicated).toBe(false)
    expect(result.type).toBe(type)
  })
})

// ---------------------------------------------------------------------------
// Step 3: intervention semantics — event shape, existing-function reuse,
// proxy-confirm audit trail, REFLECTION guard for RESTORE_PREVIOUS_PHASE
// ---------------------------------------------------------------------------

describe('applyTeacherIntervention', () => {
  it('appends a single TEACHER_INTERVENTION_APPLIED event carrying reason/before/after/impactScope/detail', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs)
    const delegates = makeDelegates()

    await applyTeacherIntervention({
      firestore: fake as never, actorId: 'teacher-primary', now: () => 'fixed-now',
      loadRunContext: async () => ({ orgId: 'org-1', status: 'RUNNING' }),
      delegates,
    }, { ...baseEnvelope, type: 'SWITCH_DISPLAY_SLIDE', detail: REQUIRED_DETAIL.SWITCH_DISPLAY_SLIDE, idempotencyKey: 'ev-1' })

    const eventKey = [...fake.docs.keys()].find((k) => k.includes('/events/'))
    const event = fake.docs.get(eventKey as string) as { type: string; actorType: string; actorId: string; payload: Record<string, unknown> }
    expect(event.type).toBe('TEACHER_INTERVENTION_APPLIED')
    expect(event.actorType).toBe('TEACHER')
    expect(event.actorId).toBe('teacher-primary')
    expect(event.payload).toMatchObject({
      interventionType: 'SWITCH_DISPLAY_SLIDE',
      reason: baseEnvelope.reason,
      before: baseEnvelope.before,
      after: baseEnvelope.after,
      impactScope: baseEnvelope.impactScope,
      detail: REQUIRED_DETAIL.SWITCH_DISPLAY_SLIDE,
    })
  })

  it('CHANGE_REPRESENTATIVE delegates to rotateRepresentative instead of reimplementing the rotation', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs)
    const delegates = makeDelegates()

    await applyTeacherIntervention({
      firestore: fake as never, actorId: 'teacher-primary', now: () => 'fixed-now',
      loadRunContext: async () => ({ orgId: 'org-1', status: 'RUNNING' }),
      delegates,
    }, { ...baseEnvelope, type: 'CHANGE_REPRESENTATIVE', detail: REQUIRED_DETAIL.CHANGE_REPRESENTATIVE })

    expect(delegates.rotateRepresentative).toHaveBeenCalledTimes(1)
    expect(delegates.rotateRepresentative).toHaveBeenCalledWith(expect.objectContaining({
      lessonRunId: 'run-1', teamId: 'team-a', newRepresentativeParticipantId: 'p-2', reason: baseEnvelope.reason,
    }))
  })

  it('PROXY_CONFIRM delegates to confirmResponse with actorType TEACHER and records the proxy target', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs)
    const delegates = makeDelegates()

    await applyTeacherIntervention({
      firestore: fake as never, actorId: 'teacher-primary', now: () => 'fixed-now',
      loadRunContext: async () => ({ orgId: 'org-1', status: 'RUNNING' }),
      delegates,
    }, { ...baseEnvelope, type: 'PROXY_CONFIRM', detail: REQUIRED_DETAIL.PROXY_CONFIRM })

    expect(delegates.confirmResponse).toHaveBeenCalledTimes(1)
    expect(delegates.confirmResponse).toHaveBeenCalledWith(expect.objectContaining({
      lessonRunId: 'run-1', phaseId: 'phase-2', inputId: 'input-1',
      participantId: 'p-1', actorParticipantId: 'p-1', actorType: 'TEACHER', proxyForParticipantId: 'p-1',
    }))
  })

  it('RECONNECT_PARTICIPANT delegates to the recovery flow instead of re-pointing authUid directly', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs)
    const delegates = makeDelegates()

    await applyTeacherIntervention({
      firestore: fake as never, actorId: 'teacher-primary', now: () => 'fixed-now',
      loadRunContext: async () => ({ orgId: 'org-1', status: 'RUNNING' }),
      delegates,
    }, { ...baseEnvelope, type: 'RECONNECT_PARTICIPANT', detail: REQUIRED_DETAIL.RECONNECT_PARTICIPANT })

    expect(delegates.reconnectParticipant).toHaveBeenCalledTimes(1)
    expect(delegates.reconnectParticipant).toHaveBeenCalledWith(expect.objectContaining({
      lessonRunId: 'run-1', participantId: 'p-1', newAuthUid: 'auth-new',
    }))
  })

  it('RESTORE_PREVIOUS_PHASE delegates to transitionPhase with targetPhaseId only (status untouched)', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs)
    const delegates = makeDelegates()

    await applyTeacherIntervention({
      firestore: fake as never, actorId: 'teacher-primary', now: () => 'fixed-now',
      loadRunContext: async () => ({ orgId: 'org-1', status: 'RUNNING' }),
      delegates,
    }, { ...baseEnvelope, type: 'RESTORE_PREVIOUS_PHASE', detail: REQUIRED_DETAIL.RESTORE_PREVIOUS_PHASE })

    expect(delegates.transitionPhase).toHaveBeenCalledTimes(1)
    const call = delegates.transitionPhase.mock.calls[0][0]
    expect(call.targetPhaseId).toBe('phase-1')
    expect(call.targetStatus).toBeUndefined()
  })

  it('rejects RESTORE_PREVIOUS_PHASE once the run has reached REFLECTION (one-way door)', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs, { status: 'REFLECTION' })
    const delegates = makeDelegates()

    await expect(applyTeacherIntervention({
      firestore: fake as never, actorId: 'teacher-primary', now: () => 'fixed-now',
      loadRunContext: async () => ({ orgId: 'org-1', status: 'REFLECTION' }),
      delegates,
    }, { ...baseEnvelope, type: 'RESTORE_PREVIOUS_PHASE', detail: REQUIRED_DETAIL.RESTORE_PREVIOUS_PHASE }))
      .rejects.toThrow('REFLECTION')
    expect(delegates.transitionPhase).not.toHaveBeenCalled()
  })

  it('EMERGENCY_STOP calls the SubjectLifecycleAdapter stop hook', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs)
    const delegates = makeDelegates()

    await applyTeacherIntervention({
      firestore: fake as never, actorId: 'teacher-primary', now: () => 'fixed-now',
      loadRunContext: async () => ({ orgId: 'org-1', status: 'RUNNING' }),
      delegates,
    }, { ...baseEnvelope, type: 'EMERGENCY_STOP', detail: {} })

    expect(delegates.stopNewOperations).toHaveBeenCalledWith('run-1')
  })

  it('deduplicates a retried intervention with the same idempotencyKey', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs)
    const delegates = makeDelegates()
    const deps = {
      firestore: fake as never, actorId: 'teacher-primary', now: () => 'fixed-now',
      loadRunContext: async () => ({ orgId: 'org-1', status: 'RUNNING' as const }),
      delegates,
    }
    const input = { ...baseEnvelope, type: 'SWITCH_DISPLAY_SLIDE' as const, detail: REQUIRED_DETAIL.SWITCH_DISPLAY_SLIDE, idempotencyKey: 'dedupe-1' }
    const first = await applyTeacherIntervention(deps, input)
    const retry = await applyTeacherIntervention(deps, input)
    expect(retry.deduplicated).toBe(true)
    expect(retry.eventId).toBe(first.eventId)
    const events = [...fake.docs.keys()].filter((k) => k.includes('/events/'))
    expect(events).toHaveLength(1)
  })
})
