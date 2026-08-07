import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Exercises `recoverParticipantWithAdminSdk`'s actual production wiring —
 * specifically the exact `participant.status`/`accessOverride` payload it
 * hands to `syncLessonRunMembershipWithAdminSdk` for the old-UID mirror
 * write. `recovery.test.ts`'s "production wiring" describe block only
 * verifies *call order* via a caller-supplied fake `syncMirror`; it never
 * inspects what `recoverParticipantWithAdminSdk`'s own closure actually
 * constructs. This file closes that gap (see task-4-report.md Critical #1):
 * before the fix, this closure passed `status: 'SUSPENDED'` for the old UID
 * regardless of the participant's real status — a fabricated value that got
 * written permanently into the RTDB mirror. `syncLessonRunMembershipWithAdminSdk`
 * itself is mocked (its own correctness is `membershipMirror.test.ts`'s
 * job); this file only asserts what `recovery.ts` passes to it.
 */
const { docs, fakeDb, syncMock } = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>()
  const syncMock = vi.fn(async () => ({}))
  const fakeDb = {
    doc: (path: string) => ({
      path,
      get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
      update: async (data: Record<string, unknown>) => {
        docs.set(path, { ...(docs.get(path) ?? {}), ...data })
      },
    }),
    runTransaction: async (fn: (tx: {
      get: (docRef: { path: string }) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      set: (docRef: { path: string }, data: Record<string, unknown>) => void
    }) => Promise<unknown>) => fn({
      get: async (docRef: { path: string }) => ({ exists: docs.has(docRef.path), data: () => docs.get(docRef.path) }),
      set: (docRef: { path: string }, data: Record<string, unknown>) => { docs.set(docRef.path, data) },
    }),
  }
  return { docs, fakeDb, syncMock }
})

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => fakeDb,
  FieldValue: { serverTimestamp: () => 'server-ts' },
}))
vi.mock('./membershipMirror', () => ({ syncLessonRunMembershipWithAdminSdk: syncMock }))

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

beforeEach(() => {
  docs.clear()
  syncMock.mockClear()
})

describe('recoverParticipantWithAdminSdk (production wiring, RTDB mirror payload)', () => {
  it('syncs the old-UID mirror with the true participant status (MIGRATING_DEVICE, not a fabricated SUSPENDED) and accessOverride REVOKED, and the new-UID mirror with accessOverride ACTIVE', async () => {
    docs.set('lessonRuns/run-1/participants/p-1', {
      id: 'p-1', lessonRunId: 'run-1', orgId: 'org-1', authUid: 'old-uid',
      identityMode: 'QUICK_JOIN', displayName: 'たろう', status: 'ACTIVE', sessionVersion: 2,
      joinedAt: 'joined', lastSeenAt: 'seen', teamId: 'team-a',
    })
    docs.set(`lessonRuns/run-1/recoveryCodes/${sha256('VALID-CODE')}`, {
      participantId: 'p-1', lessonRunId: 'run-1', orgId: 'org-1', status: 'ACTIVE',
      expiresAtMillis: Date.now() + 1_000_000, usedAt: null, issuedAt: 'issued',
    })

    const { recoverParticipantWithAdminSdk } = await import('./recovery')
    await recoverParticipantWithAdminSdk({
      lessonRunId: 'run-1', code: 'VALID-CODE', newAuthUid: 'new-uid', idempotencyKey: 'recover-payload-1',
    })

    expect(syncMock).toHaveBeenCalledTimes(3)
    const calls = syncMock.mock.calls as unknown as [Record<string, unknown>][]
    const [oldCall, newCall, finalizeCall] = calls

    expect(oldCall[0]).toMatchObject({
      participant: expect.objectContaining({ authUid: 'old-uid', status: 'MIGRATING_DEVICE' }),
      accessOverride: 'REVOKED',
    })
    expect((oldCall[0].participant as Record<string, unknown>).status).not.toBe('SUSPENDED')

    expect(newCall[0]).toMatchObject({
      participant: expect.objectContaining({ authUid: 'new-uid', status: 'MIGRATING_DEVICE' }),
      accessOverride: 'ACTIVE',
    })

    // finalizeStatus's re-sync of the new-UID mirror restores the
    // pre-recovery status (ACTIVE here) and does not need an accessOverride
    // — its access should be derived normally.
    expect(finalizeCall[0]).toMatchObject({
      participant: expect.objectContaining({ authUid: 'new-uid', status: 'ACTIVE' }),
    })
    expect(finalizeCall[0]).not.toHaveProperty('accessOverride')
  })
})
