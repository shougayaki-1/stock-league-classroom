import { describe, expect, it } from 'vitest'
import { saveResponseDraft, submitProposal, decideProposal } from './saveResponse'
import { confirmResponse } from './confirmResponse'

// Same "all reads before all writes" fake as saveResponse.test.ts /
// teams/assignTeam.test.ts.
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
}

const setUpTeam = (docs: Map<string, Record<string, unknown>>, overrides: Record<string, unknown> = {}) => {
  docs.set('lessonRuns/run-1/teams/team-a', {
    id: 'team-a', lessonRunId: 'run-1', orgId: 'org-1', displayName: 'A',
    memberParticipantIds: ['p-1', 'p-2', 'p-3'], representativeParticipantId: 'p-1',
    confirmationMode: 'ALL', version: 0, ...overrides,
  })
}

const depsFor = (actorParticipantId: string) => ({
  firestore: undefined as never,
  actorId: `auth-${actorParticipantId}`,
  actorParticipantId,
  now: () => 'fixed-now',
})

describe('confirmResponse', () => {
  it('confirms an APPROVED individual response and records RESPONSE_CONFIRMED', async () => {
    const fake = makeFakeFirestore()
    setUpIndividual(fake.docs)
    const deps = { ...depsFor('p-1'), firestore: fake as never }
    const saved = await saveResponseDraft(deps, { lessonRunId: 'run-1', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1', value: 'yes', idempotencyKey: 'save-1' })
    await submitProposal(deps, { lessonRunId: 'run-1', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1', expectedRevision: saved.revision, idempotencyKey: 'submit-1' })
    await decideProposal(deps, { lessonRunId: 'run-1', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1', decision: 'APPROVE', idempotencyKey: 'decide-1' })
    const confirmed = await confirmResponse(deps, { lessonRunId: 'run-1', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1', idempotencyKey: 'confirm-1' })
    expect(confirmed.status).toBe('CONFIRMED')
    const events = [...fake.docs.keys()].filter((k) => k.includes('/events/'))
    expect(events.map((k) => (fake.docs.get(k) as { type: string }).type)).toContain('RESPONSE_CONFIRMED')
  })

  it('deduplicates a retried confirm with the same idempotencyKey', async () => {
    const fake = makeFakeFirestore()
    setUpIndividual(fake.docs)
    const deps = { ...depsFor('p-1'), firestore: fake as never }
    const saved = await saveResponseDraft(deps, { lessonRunId: 'run-1', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1', value: 'yes', idempotencyKey: 'save-1' })
    await submitProposal(deps, { lessonRunId: 'run-1', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1', expectedRevision: saved.revision, idempotencyKey: 'submit-1' })
    await decideProposal(deps, { lessonRunId: 'run-1', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1', decision: 'APPROVE', idempotencyKey: 'decide-1' })
    const input = { lessonRunId: 'run-1', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1', idempotencyKey: 'confirm-1' }
    const first = await confirmResponse(deps, input)
    const retry = await confirmResponse(deps, input)
    expect(retry.deduplicated).toBe(true)
    expect(retry.status).toBe(first.status)
    const events = [...fake.docs.keys()].filter((k) => k.includes('/events/') && (fake.docs.get(k) as { type: string }).type === 'RESPONSE_CONFIRMED')
    expect(events).toHaveLength(1)
  })

  it('rejects confirming a response that is not yet APPROVED (e.g. still awaiting a decision)', async () => {
    const fake = makeFakeFirestore()
    setUpIndividual(fake.docs)
    const deps = { ...depsFor('p-1'), firestore: fake as never }
    const saved = await saveResponseDraft(deps, { lessonRunId: 'run-1', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1', value: 'yes', idempotencyKey: 'save-1' })
    await submitProposal(deps, { lessonRunId: 'run-1', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1', expectedRevision: saved.revision, idempotencyKey: 'submit-1' })
    await expect(confirmResponse(deps, { lessonRunId: 'run-1', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1', idempotencyKey: 'confirm-1' }))
      .rejects.toThrow('Response has not been approved and cannot be confirmed')
  })

  // ---- Required reject case: 代表者でない確定を拒否 ----
  it('rejects a non-representative confirming a REPRESENTATIVE-mode team response', async () => {
    const fake = makeFakeFirestore()
    setUpTeam(fake.docs, { confirmationMode: 'REPRESENTATIVE', representativeParticipantId: 'p-1' })
    const repDeps = { ...depsFor('p-1'), firestore: fake as never }
    const saved = await saveResponseDraft(repDeps, { lessonRunId: 'run-1', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-1', value: 'yes', idempotencyKey: 'save-1' })
    await submitProposal(repDeps, { lessonRunId: 'run-1', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-1', expectedRevision: saved.revision, idempotencyKey: 'submit-1' })
    await decideProposal(repDeps, { lessonRunId: 'run-1', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-1', decision: 'APPROVE', idempotencyKey: 'decide-1' })

    const nonRepDeps = { ...depsFor('p-2'), firestore: fake as never }
    await expect(confirmResponse(nonRepDeps, {
      lessonRunId: 'run-1', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-1', idempotencyKey: 'confirm-x',
    })).rejects.toThrow('Only the team representative may confirm this response')
  })

  // ---- Required reject case: quorum未達を拒否 ----
  it('rejects confirming while a QUORUM-mode team response has not reached its required approval count', async () => {
    const fake = makeFakeFirestore()
    setUpTeam(fake.docs, { confirmationMode: 'QUORUM', requiredApprovalCount: 3 })
    const p1 = { ...depsFor('p-1'), firestore: fake as never }
    const saved = await saveResponseDraft(p1, { lessonRunId: 'run-1', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-1', value: 'yes', idempotencyKey: 'save-1' })
    await submitProposal(p1, { lessonRunId: 'run-1', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-1', expectedRevision: saved.revision, idempotencyKey: 'submit-1' })
    // Only 1 of the 3 required approvals is registered — status stays PROPOSED.
    await decideProposal(p1, { lessonRunId: 'run-1', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-1', decision: 'APPROVE', idempotencyKey: 'decide-p1' })

    await expect(confirmResponse(p1, {
      lessonRunId: 'run-1', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-1', idempotencyKey: 'confirm-1',
    })).rejects.toThrow('Response has not been approved and cannot be confirmed')
  })
})
