import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'

// Same module-boundary mock as transitionPhase.test.ts: `httpsCallable(functions, name)`
// reaches into the real Functions instance's internals, so a plain fake
// `functions` object throws at runtime.
const callable = vi.fn()
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callable) }))

const { httpsCallable } = await import('firebase/functions')
const { saveResponseDraft, submitProposal, decideProposal, confirmResponse } = await import('./responses')

describe('saveResponseDraft (client)', () => {
  it('calls saveResponseDraftCallable with the given input', async () => {
    callable.mockResolvedValue({ data: { responseId: 'p-1_phase-1_input-1', revision: 1, status: 'DRAFT', deduplicated: false } })
    const functions = {} as Functions
    const result = await saveResponseDraft(functions, {
      lessonRunId: 'run-1', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1',
      value: 'yes', idempotencyKey: 'save-1',
    })
    expect(result).toEqual({ responseId: 'p-1_phase-1_input-1', revision: 1, status: 'DRAFT', deduplicated: false })
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'saveResponseDraftCallable')
    expect(callable).toHaveBeenCalledWith({
      lessonRunId: 'run-1', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1',
      value: 'yes', idempotencyKey: 'save-1',
    })
  })
})

describe('submitProposal (client)', () => {
  it('calls submitProposalCallable with the given input', async () => {
    callable.mockResolvedValue({ data: { responseId: 'p-1_phase-1_input-1', revision: 2, status: 'PROPOSED', deduplicated: false } })
    const functions = {} as Functions
    const result = await submitProposal(functions, {
      lessonRunId: 'run-1', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-1',
      expectedRevision: 1, idempotencyKey: 'submit-1',
    })
    expect(result.status).toBe('PROPOSED')
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'submitProposalCallable')
    expect(callable).toHaveBeenCalledWith({
      lessonRunId: 'run-1', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-1',
      expectedRevision: 1, idempotencyKey: 'submit-1',
    })
  })
})

describe('decideProposal (client)', () => {
  it('calls decideProposalCallable with the given decision', async () => {
    callable.mockResolvedValue({ data: { responseId: 'p-1_phase-1_input-1', status: 'APPROVED', approvals: ['p-1'], deduplicated: false } })
    const functions = {} as Functions
    const result = await decideProposal(functions, {
      lessonRunId: 'run-1', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-1',
      decision: 'APPROVE', idempotencyKey: 'decide-1',
    })
    expect(result.approvals).toEqual(['p-1'])
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'decideProposalCallable')
    expect(callable).toHaveBeenCalledWith({
      lessonRunId: 'run-1', teamId: 'team-a', phaseId: 'phase-1', inputId: 'input-1',
      decision: 'APPROVE', idempotencyKey: 'decide-1',
    })
  })
})

describe('confirmResponse (client)', () => {
  it('calls confirmResponseCallable with the given input', async () => {
    callable.mockResolvedValue({ data: { responseId: 'p-1_phase-1_input-1', status: 'CONFIRMED', confirmedAt: 'now', deduplicated: false } })
    const functions = {} as Functions
    const result = await confirmResponse(functions, {
      lessonRunId: 'run-1', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1',
      idempotencyKey: 'confirm-1',
    })
    expect(result.status).toBe('CONFIRMED')
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'confirmResponseCallable')
    expect(callable).toHaveBeenCalledWith({
      lessonRunId: 'run-1', participantId: 'p-1', phaseId: 'phase-1', inputId: 'input-1',
      idempotencyKey: 'confirm-1',
    })
  })
})
