import { describe, expect, it } from 'vitest'
import { saveResponseDraft, submitProposal, decideProposal } from './saveResponse'

// Same "all reads before all writes" fake as teams/assignTeam.test.ts — added
// after Task 3's Critical #1 read-after-write bug slipped through an earlier
// fake that didn't enforce this.
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

const setUpIndividual = (docs: Map<string, Record<string, unknown>>) => {
  docs.set('lessonRuns/run-1/participants/p-1', {
    id: 'p-1', lessonRunId: 'run-1', orgId: 'org-1', authUid: 'auth-1',
    identityMode: 'QUICK_JOIN', displayName: 'one', status: 'ACTIVE', sessionVersion: 0,
    joinedAt: 'now', lastSeenAt: 'now',
  })
  docs.set('lessonRuns/run-1/participants/p-2', {
    id: 'p-2', lessonRunId: 'run-1', orgId: 'org-1', authUid: 'auth-2',
    identityMode: 'QUICK_JOIN', displayName: 'two', status: 'ACTIVE', sessionVersion: 0,
    joinedAt: 'now', lastSeenAt: 'now',
  })
}

const setUpTeam = (docs: Map<string, Record<string, unknown>>, overrides: Record<string, unknown> = {}) => {
  docs.set('lessonRuns/run-1/teams/team-a', {
    id: 'team-a', lessonRunId: 'run-1', orgId: 'org-1', displayName: 'A',
    memberParticipantIds: ['p-1', 'p-2', 'p-3'], representativeParticipantId: 'p-1',
    confirmationMode: 'ALL', version: 0, ...overrides,
  })
  docs.set('lessonRuns/run-1/teams/team-b', {
    id: 'team-b', lessonRunId: 'run-1', orgId: 'org-1', displayName: 'B',
    memberParticipantIds: ['p-9'], confirmationMode: 'ALL', version: 0,
  })
}

const depsFor = (actorParticipantId: string) => ({
  firestore: undefined as never,
  actorId: `auth-${actorParticipantId}`,
  actorParticipantId,
  now: () => 'fixed-now',
})

describe('saveResponseDraft', () => {
  it('creates a DRAFT response on first save and records RESPONSE_SAVED', async () => {
    const fake = makeFakeFirestore()
    setUpIndividual(fake.docs)
    const result = await saveResponseDraft({ ...depsFor('p-1'), firestore: fake as never }, {
      lessonRunId: 'run-1', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1',
      value: 'yes', idempotencyKey: 'save-1',
    })
    expect(result).toEqual({ responseId: 'p-1_phase-1_input-1', revision: 1, status: 'DRAFT', deduplicated: false })
    const response = fake.docs.get('lessonRuns/run-1/responses/p-1_phase-1_input-1') as Record<string, unknown>
    expect(response.value).toBe('yes')
    expect(response.approvals).toEqual([])
    const events = [...fake.docs.keys()].filter((k) => k.includes('/events/'))
    expect(events).toHaveLength(1)
  })

  it('overwrites the draft on a second save when expectedRevision matches', async () => {
    const fake = makeFakeFirestore()
    setUpIndividual(fake.docs)
    const deps = { ...depsFor('p-1'), firestore: fake as never }
    await saveResponseDraft(deps, { lessonRunId: 'run-1', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1', value: 'yes', idempotencyKey: 'save-1' })
    const second = await saveResponseDraft(deps, {
      lessonRunId: 'run-1', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1',
      value: 'no', expectedRevision: 1, idempotencyKey: 'save-2',
    })
    expect(second.revision).toBe(2)
    const response = fake.docs.get('lessonRuns/run-1/responses/p-1_phase-1_input-1') as Record<string, unknown>
    expect(response.value).toBe('no')
  })

  it('deduplicates a retried save with the same idempotencyKey', async () => {
    const fake = makeFakeFirestore()
    setUpIndividual(fake.docs)
    const deps = { ...depsFor('p-1'), firestore: fake as never }
    const input = { lessonRunId: 'run-1', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1', value: 'yes', idempotencyKey: 'save-1' }
    const first = await saveResponseDraft(deps, input)
    const retry = await saveResponseDraft(deps, input)
    expect(retry).toEqual({ ...first, deduplicated: true })
    const events = [...fake.docs.keys()].filter((k) => k.includes('/events/'))
    expect(events).toHaveLength(1)
  })

  // ---- Required reject case: 確定後編集を拒否 ----
  it('rejects editing a response that has already been confirmed', async () => {
    const fake = makeFakeFirestore()
    setUpIndividual(fake.docs)
    fake.docs.set('lessonRuns/run-1/responses/p-1_phase-1_input-1', {
      id: 'p-1_phase-1_input-1', lessonRunId: 'run-1', orgId: 'org-1', participantId: 'p-1',
      phaseId: 'phase-1', inputId: 'input-1', value: 'yes', status: 'CONFIRMED', revision: 3,
      rationaleInformationIds: [], approvals: ['p-1'], contextSnapshot: {},
    })
    await expect(saveResponseDraft({ ...depsFor('p-1'), firestore: fake as never }, {
      lessonRunId: 'run-1', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1',
      value: 'no', expectedRevision: 3, idempotencyKey: 'save-x',
    })).rejects.toThrow('Response has already been confirmed and cannot be edited')
  })

  // ---- Required reject case: 別チーム操作を拒否 ----
  it('rejects a participant saving a response that belongs to a team they are not a member of', async () => {
    const fake = makeFakeFirestore()
    setUpTeam(fake.docs)
    await expect(saveResponseDraft({ ...depsFor('p-9'), firestore: fake as never }, {
      lessonRunId: 'run-1', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-1',
      value: 'yes', idempotencyKey: 'save-1',
    })).rejects.toThrow('Participant is not a member of this team')
  })

  // ---- Required reject case: 古いrevisionの上書きを拒否 ----
  it('rejects a save whose expectedRevision is stale', async () => {
    const fake = makeFakeFirestore()
    setUpIndividual(fake.docs)
    const deps = { ...depsFor('p-1'), firestore: fake as never }
    await saveResponseDraft(deps, { lessonRunId: 'run-1', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1', value: 'yes', idempotencyKey: 'save-1' })
    await expect(saveResponseDraft(deps, {
      lessonRunId: 'run-1', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1',
      value: 'no', expectedRevision: 0, idempotencyKey: 'save-2',
    })).rejects.toThrow('Response revision is stale')
  })
})

describe('submitProposal', () => {
  it('transitions DRAFT to PROPOSED and records PROPOSAL_SUBMITTED', async () => {
    const fake = makeFakeFirestore()
    setUpIndividual(fake.docs)
    const deps = { ...depsFor('p-1'), firestore: fake as never }
    const saved = await saveResponseDraft(deps, { lessonRunId: 'run-1', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1', value: 'yes', idempotencyKey: 'save-1' })
    const result = await submitProposal(deps, {
      lessonRunId: 'run-1', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1',
      expectedRevision: saved.revision, idempotencyKey: 'submit-1',
    })
    expect(result.status).toBe('PROPOSED')
    const events = [...fake.docs.keys()].filter((k) => k.includes('/events/'))
    expect(events.map((k) => (fake.docs.get(k) as { type: string }).type)).toContain('PROPOSAL_SUBMITTED')
  })

  it('attaches a resolved contextSnapshot when the deps hook is provided', async () => {
    const fake = makeFakeFirestore()
    setUpIndividual(fake.docs)
    const deps = { ...depsFor('p-1'), firestore: fake as never, resolveContextSnapshot: async () => ({ referencePrice: 123 }) }
    const saved = await saveResponseDraft(deps, { lessonRunId: 'run-1', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1', value: 'yes', idempotencyKey: 'save-1' })
    await submitProposal(deps, {
      lessonRunId: 'run-1', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1',
      expectedRevision: saved.revision, idempotencyKey: 'submit-1',
    })
    const response = fake.docs.get('lessonRuns/run-1/responses/p-1_phase-1_input-1') as Record<string, unknown>
    expect(response.contextSnapshot).toEqual({ referencePrice: 123 })
  })
})

describe('decideProposal — REPRESENTATIVE mode', () => {
  it('the representative approving finalizes APPROVED in a single decision', async () => {
    const fake = makeFakeFirestore()
    setUpTeam(fake.docs, { confirmationMode: 'REPRESENTATIVE', representativeParticipantId: 'p-1' })
    const repDeps = { ...depsFor('p-1'), firestore: fake as never }
    const saved = await saveResponseDraft(repDeps, { lessonRunId: 'run-1', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-1', value: 'yes', idempotencyKey: 'save-1' })
    await submitProposal(repDeps, { lessonRunId: 'run-1', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-1', expectedRevision: saved.revision, idempotencyKey: 'submit-1' })
    const decided = await decideProposal(repDeps, { lessonRunId: 'run-1', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-1', decision: 'APPROVE', idempotencyKey: 'decide-1' })
    expect(decided.status).toBe('APPROVED')
  })
})

describe('decideProposal — ALL mode', () => {
  it('requires every member to approve before the response becomes APPROVED', async () => {
    const fake = makeFakeFirestore()
    setUpTeam(fake.docs, { confirmationMode: 'ALL' })
    const p1 = { ...depsFor('p-1'), firestore: fake as never }
    const saved = await saveResponseDraft(p1, { lessonRunId: 'run-1', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-1', value: 'yes', idempotencyKey: 'save-1' })
    await submitProposal(p1, { lessonRunId: 'run-1', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-1', expectedRevision: saved.revision, idempotencyKey: 'submit-1' })

    const afterP1 = await decideProposal(p1, { lessonRunId: 'run-1', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-1', decision: 'APPROVE', idempotencyKey: 'decide-p1' })
    expect(afterP1.status).toBe('PROPOSED')

    const p2 = { ...depsFor('p-2'), firestore: fake as never }
    const afterP2 = await decideProposal(p2, { lessonRunId: 'run-1', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-1', decision: 'APPROVE', idempotencyKey: 'decide-p2' })
    expect(afterP2.status).toBe('PROPOSED')

    const p3 = { ...depsFor('p-3'), firestore: fake as never }
    const afterP3 = await decideProposal(p3, { lessonRunId: 'run-1', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-1', decision: 'APPROVE', idempotencyKey: 'decide-p3' })
    expect(afterP3.status).toBe('APPROVED')
    expect(afterP3.approvals.sort()).toEqual(['p-1', 'p-2', 'p-3'])
  })

  it('a single reject finalizes REJECTED immediately', async () => {
    const fake = makeFakeFirestore()
    setUpTeam(fake.docs, { confirmationMode: 'ALL' })
    const p1 = { ...depsFor('p-1'), firestore: fake as never }
    const saved = await saveResponseDraft(p1, { lessonRunId: 'run-1', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-1', value: 'yes', idempotencyKey: 'save-1' })
    await submitProposal(p1, { lessonRunId: 'run-1', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-1', expectedRevision: saved.revision, idempotencyKey: 'submit-1' })
    const p2 = { ...depsFor('p-2'), firestore: fake as never }
    const decided = await decideProposal(p2, { lessonRunId: 'run-1', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-1', decision: 'REJECT', idempotencyKey: 'decide-p2' })
    expect(decided.status).toBe('REJECTED')
  })
})

describe('decideProposal — QUORUM mode', () => {
  it('becomes APPROVED once requiredApprovalCount is reached, not before', async () => {
    const fake = makeFakeFirestore()
    setUpTeam(fake.docs, { confirmationMode: 'QUORUM', requiredApprovalCount: 2 })
    const p1 = { ...depsFor('p-1'), firestore: fake as never }
    const saved = await saveResponseDraft(p1, { lessonRunId: 'run-1', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-1', value: 'yes', idempotencyKey: 'save-1' })
    await submitProposal(p1, { lessonRunId: 'run-1', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-1', expectedRevision: saved.revision, idempotencyKey: 'submit-1' })

    const afterP1 = await decideProposal(p1, { lessonRunId: 'run-1', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-1', decision: 'APPROVE', idempotencyKey: 'decide-p1' })
    expect(afterP1.status).toBe('PROPOSED')

    const p2 = { ...depsFor('p-2'), firestore: fake as never }
    const afterP2 = await decideProposal(p2, { lessonRunId: 'run-1', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-1', decision: 'APPROVE', idempotencyKey: 'decide-p2' })
    expect(afterP2.status).toBe('APPROVED')
  })
})
