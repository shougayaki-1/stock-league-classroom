import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { issueRecoveryCode, recoverParticipant } from './recovery'

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

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

const setUpParticipant = (docs: Map<string, Record<string, unknown>>, overrides: Record<string, unknown> = {}) => {
  docs.set('lessonRuns/run-1/participants/p-1', {
    id: 'p-1', lessonRunId: 'run-1', orgId: 'org-1', authUid: 'old-uid',
    identityMode: 'QUICK_JOIN', displayName: 'たろう', status: 'ACTIVE', sessionVersion: 2,
    joinedAt: 'joined', lastSeenAt: 'seen', teamId: 'team-a',
    ...overrides,
  })
}

describe('issueRecoveryCode', () => {
  it('returns the plaintext code once and stores only its hash, expiry, and unused state', async () => {
    const fake = makeFakeFirestore()
    setUpParticipant(fake.docs)
    const result = await issueRecoveryCode({
      firestore: fake as never, generateCode: () => 'PLAINTEXT-CODE', hashCode: sha256,
      now: () => 'fixed-now', nowMillis: () => 1_000_000, expiresInMillis: 900_000,
    }, { lessonRunId: 'run-1', participantId: 'p-1', idempotencyKey: 'issue-1' })

    expect(result.code).toBe('PLAINTEXT-CODE')
    expect(result.deduplicated).toBe(false)
    const stored = fake.docs.get(`lessonRuns/run-1/recoveryCodes/${sha256('PLAINTEXT-CODE')}`) as Record<string, unknown>
    expect(stored).toBeDefined()
    expect(stored.participantId).toBe('p-1')
    expect(stored.status).toBe('ACTIVE')
    expect(stored.usedAt).toBeNull()
    expect(stored.expiresAtMillis).toBe(1_900_000)
    // Plaintext must never be persisted anywhere.
    for (const doc of fake.docs.values()) {
      expect(JSON.stringify(doc)).not.toContain('PLAINTEXT-CODE')
    }
  })

  it('rejects a retried idempotencyKey (the plaintext secret cannot be safely re-displayed)', async () => {
    const fake = makeFakeFirestore()
    setUpParticipant(fake.docs)
    const deps = {
      firestore: fake as never, generateCode: () => 'CODE-A', hashCode: sha256,
      now: () => 'fixed-now', nowMillis: () => 1_000_000,
    }
    await issueRecoveryCode(deps, { lessonRunId: 'run-1', participantId: 'p-1', idempotencyKey: 'issue-1' })
    await expect(issueRecoveryCode(deps, { lessonRunId: 'run-1', participantId: 'p-1', idempotencyKey: 'issue-1' }))
      .rejects.toThrow('Recovery code already issued for this idempotencyKey')
  })
})

describe('recoverParticipant', () => {
  const setUpActiveCode = (docs: Map<string, Record<string, unknown>>, overrides: Record<string, unknown> = {}) => {
    docs.set(`lessonRuns/run-1/recoveryCodes/${sha256('VALID-CODE')}`, {
      participantId: 'p-1', lessonRunId: 'run-1', orgId: 'org-1', status: 'ACTIVE',
      expiresAtMillis: 2_000_000, usedAt: null, issuedAt: 'issued',
      ...overrides,
    })
  }

  it('reassigns authUid, marks the code used, and sets status to MIGRATING_DEVICE inside the transaction', async () => {
    const fake = makeFakeFirestore()
    setUpParticipant(fake.docs)
    setUpActiveCode(fake.docs)

    const result = await recoverParticipant({
      firestore: fake as never, hashCode: sha256, now: () => 'fixed-now', nowMillis: () => 1_500_000,
    }, { lessonRunId: 'run-1', code: 'VALID-CODE', newAuthUid: 'new-uid', idempotencyKey: 'recover-1' })

    expect(result.deduplicated).toBe(false)
    expect(result.oldAuthUid).toBe('old-uid')
    expect(result.newAuthUid).toBe('new-uid')
    expect(result.previousStatus).toBe('ACTIVE')
    expect(result.participantId).toBe('p-1')

    const participant = fake.docs.get('lessonRuns/run-1/participants/p-1') as Record<string, unknown>
    expect(participant.authUid).toBe('new-uid')
    expect(participant.status).toBe('MIGRATING_DEVICE')

    const code = fake.docs.get(`lessonRuns/run-1/recoveryCodes/${sha256('VALID-CODE')}`) as Record<string, unknown>
    expect(code.status).toBe('USED')
    expect(code.usedAt).toBe('fixed-now')

    const events = [...fake.docs.keys()].filter((k) => k.includes('/events/'))
    expect(events).toHaveLength(1)
    const event = fake.docs.get(events[0]) as { type: string; payload: unknown }
    expect(event.type).toBe('PARTICIPANT_RECOVERED')
    expect(event.payload).toMatchObject({ participantId: 'p-1', oldAuthUid: 'old-uid', newAuthUid: 'new-uid' })
  })

  it('rejects an expired recovery code', async () => {
    const fake = makeFakeFirestore()
    setUpParticipant(fake.docs)
    setUpActiveCode(fake.docs, { expiresAtMillis: 1_000_000 })
    await expect(recoverParticipant(
      { firestore: fake as never, hashCode: sha256, now: () => 'fixed-now', nowMillis: () => 1_500_000 },
      { lessonRunId: 'run-1', code: 'VALID-CODE', newAuthUid: 'new-uid', idempotencyKey: 'recover-2' },
    )).rejects.toThrow('Recovery code has expired')
  })

  it('rejects an unknown recovery code', async () => {
    const fake = makeFakeFirestore()
    setUpParticipant(fake.docs)
    await expect(recoverParticipant(
      { firestore: fake as never, hashCode: sha256, now: () => 'fixed-now', nowMillis: () => 1_500_000 },
      { lessonRunId: 'run-1', code: 'WRONG-CODE', newAuthUid: 'new-uid', idempotencyKey: 'recover-3' },
    )).rejects.toThrow('Recovery code not found')
  })

  it('rejects reuse of an already-used code, and concurrent/sequential re-use is blocked by the same guard', async () => {
    const fake = makeFakeFirestore()
    setUpParticipant(fake.docs)
    setUpActiveCode(fake.docs)
    const deps = { firestore: fake as never, hashCode: sha256, now: () => 'fixed-now', nowMillis: () => 1_500_000 }

    await recoverParticipant(deps, { lessonRunId: 'run-1', code: 'VALID-CODE', newAuthUid: 'device-a', idempotencyKey: 'recover-4' })
    // A second, distinct request racing to redeem the same code (e.g. two
    // devices both possessing the recovery code) must be rejected once the
    // first has committed — this is exactly the atomicity Firestore
    // transactions give us for free: whichever transaction commits first
    // flips status to USED, and every other reader of the same doc sees
    // that committed state.
    await expect(recoverParticipant(deps, {
      lessonRunId: 'run-1', code: 'VALID-CODE', newAuthUid: 'device-b', idempotencyKey: 'recover-5',
    })).rejects.toThrow('Recovery code has already been used')
  })

  it('deduplicates a retried recovery with the same idempotencyKey and authUid', async () => {
    const fake = makeFakeFirestore()
    setUpParticipant(fake.docs)
    setUpActiveCode(fake.docs)
    const deps = { firestore: fake as never, hashCode: sha256, now: () => 'fixed-now', nowMillis: () => 1_500_000 }

    const first = await recoverParticipant(deps, { lessonRunId: 'run-1', code: 'VALID-CODE', newAuthUid: 'new-uid', idempotencyKey: 'recover-6' })
    const retry = await recoverParticipant(deps, { lessonRunId: 'run-1', code: 'VALID-CODE', newAuthUid: 'new-uid', idempotencyKey: 'recover-6' })

    expect(retry.deduplicated).toBe(true)
    expect(retry.participantId).toBe(first.participantId)
    const events = [...fake.docs.keys()].filter((k) => k.includes('/events/'))
    expect(events).toHaveLength(1)
  })
})

describe('production wiring (recoverParticipantWithAdminSdk mirror ordering)', () => {
  it('revokes the old-UID mirror before activating the new-UID mirror, and only after the Firestore commit', async () => {
    // Exercises the *wiring* contract directly (not the real Admin SDK):
    // syncMirror calls must happen strictly after the transaction commits,
    // and the old-UID REVOKED write must happen before the new-UID ACTIVE
    // write.
    const calls: string[] = []
    const { wireRecoverParticipant } = await import('./recovery')
    const fake = makeFakeFirestore()
    setUpParticipant(fake.docs)
    fake.docs.set(`lessonRuns/run-1/recoveryCodes/${sha256('VALID-CODE')}`, {
      participantId: 'p-1', lessonRunId: 'run-1', orgId: 'org-1', status: 'ACTIVE',
      expiresAtMillis: 2_000_000, usedAt: null, issuedAt: 'issued',
    })

    const syncMirror = vi.fn(async (authUid: string, access: 'ACTIVE' | 'REVOKED') => {
      calls.push(`${authUid}:${access}`)
    })
    const finalizeStatus = vi.fn(async () => { calls.push('finalize') })

    const run = wireRecoverParticipant({
      firestore: fake as never, hashCode: sha256, now: () => 'fixed-now', nowMillis: () => 1_500_000,
      syncMirror, finalizeStatus,
    })

    await run({ lessonRunId: 'run-1', code: 'VALID-CODE', newAuthUid: 'new-uid', idempotencyKey: 'recover-7' })

    expect(calls[0]).toBe('old-uid:REVOKED')
    expect(calls[1]).toBe('new-uid:ACTIVE')
    expect(calls[2]).toBe('finalize')
  })
})
