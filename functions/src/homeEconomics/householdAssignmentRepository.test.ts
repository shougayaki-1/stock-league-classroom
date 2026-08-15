import { describe, expect, it } from 'vitest'
import type { HouseholdProfile } from '@stock-league/household-authoring-content'
import {
  getHouseholdAssignmentView,
  prepareHouseholdAssignment,
  updateHouseholdAssignment,
  type HouseholdAssignmentConfig,
  type HouseholdAssignmentFirestoreDeps,
  type HouseholdAssignmentReadDeps,
  type HouseholdAssignmentTx,
} from './householdAssignmentRepository'

/**
 * Fake transaction double required by the brief: `get()` throws once any
 * `set`/`delete` has been called on it, so any repository function that
 * accidentally reads AFTER writing (a Firestore correctness violation)
 * fails the test immediately instead of silently passing against a
 * forgiving fake.
 */
const makeFakeFirestore = (
  initialDocs: Record<string, Record<string, unknown>> = {},
  initialCollections: Record<string, Array<{ id: string; data: Record<string, unknown> }>> = {},
): { firestore: HouseholdAssignmentFirestoreDeps['firestore']; docs: Map<string, Record<string, unknown>>; writes: Array<{ type: 'set' | 'delete'; path: string; data?: unknown }> } => {
  const docs = new Map(Object.entries(initialDocs))
  const collections = new Map(Object.entries(initialCollections))
  const writes: Array<{ type: 'set' | 'delete'; path: string; data?: unknown }> = []

  return {
    docs,
    writes,
    firestore: {
      runTransaction: async <T>(fn: (tx: HouseholdAssignmentTx) => Promise<T>): Promise<T> => {
        let wrote = false
        const tx: HouseholdAssignmentTx = {
          get: async (path: string) => {
            if (wrote) throw new Error('Transaction read after write — all reads must happen before any write')
            const data = docs.get(path)
            return { exists: data !== undefined, data: () => data }
          },
          getCollection: async (path: string) => {
            if (wrote) throw new Error('Transaction read after write — all reads must happen before any write')
            return collections.get(path) ?? []
          },
          set: (path: string, data: Record<string, unknown>) => {
            wrote = true
            docs.set(path, data)
            if (path.includes('/entries/')) {
              const collectionPath = path.slice(0, path.lastIndexOf('/'))
              const id = path.slice(path.lastIndexOf('/') + 1)
              const list = collections.get(collectionPath) ?? []
              const next = list.filter((entry) => entry.id !== id)
              next.push({ id, data })
              collections.set(collectionPath, next)
            }
            writes.push({ type: 'set', path, data })
          },
          delete: (path: string) => {
            wrote = true
            docs.delete(path)
            if (path.includes('/entries/')) {
              const collectionPath = path.slice(0, path.lastIndexOf('/'))
              const id = path.slice(path.lastIndexOf('/') + 1)
              const list = collections.get(collectionPath) ?? []
              collections.set(collectionPath, list.filter((entry) => entry.id !== id))
            }
            writes.push({ type: 'delete', path })
          },
        }
        return fn(tx)
      },
    },
  }
}

const profileA: HouseholdProfile = {
  householdId: 'profile-a', age: 30, householdIncomeYen: 5000000, annualLivingExpensesYen: 3000000,
  cashSavingsYen: 1000000, family: '独身', housing: '賃貸', lifeGoal: '貯蓄', lifeStage: 'INDEPENDENT',
  eventProbabilityOverrides: {}, internalRiskFactors: {},
}
const profileB: HouseholdProfile = {
  householdId: 'profile-b', age: 40, householdIncomeYen: 7000000, annualLivingExpensesYen: 4000000,
  cashSavingsYen: 2000000, family: '配偶者・子1人', housing: '持ち家', lifeGoal: '教育資金', lifeStage: 'CHILD_REARING',
  eventProbabilityOverrides: {}, internalRiskFactors: {},
}

let now = 1000
const nextNow = () => { now += 1; return now }

describe('prepareHouseholdAssignment', () => {
  it('first prepare generates default AUTO entries as DRAFT revision 1', async () => {
    const { firestore, docs } = makeFakeFirestore()
    const result = await prepareHouseholdAssignment({
      firestore, lessonRunId: 'run-1', courseFormat: 'ROLE_VARIANT',
      teamIds: ['team-b', 'team-a'], profiles: [profileA, profileB],
      actorUid: 'teacher-1', idempotencyKey: 'key-1', now: nextNow,
    })

    expect(result.deduplicated).toBe(false)
    expect(result.config.state).toBe('DRAFT')
    expect(result.config.assignmentRevision).toBe(1)
    expect(result.config.validationStatus).toBe('READY')
    expect(result.entries).toHaveLength(2)
    expect(result.entries.every((entry) => entry.assignmentSource === 'AUTO')).toBe(true)
    expect(docs.has('lessonRuns/run-1/householdAssignment/config')).toBe(true)
  })

  it('replays the same result for a repeated idempotencyKey with the same payload', async () => {
    const { firestore } = makeFakeFirestore()
    const input = {
      firestore, lessonRunId: 'run-1', courseFormat: 'ROLE_VARIANT' as const,
      teamIds: ['team-a', 'team-b'], profiles: [profileA, profileB],
      actorUid: 'teacher-1', idempotencyKey: 'key-1', now: nextNow,
    }
    const first = await prepareHouseholdAssignment(input)
    const second = await prepareHouseholdAssignment(input)

    expect(second.deduplicated).toBe(true)
    expect(second.config).toEqual(first.config)
    expect(second.entries).toEqual(first.entries)
  })

  it('rejects a reused idempotencyKey whose payload changed', async () => {
    const { firestore } = makeFakeFirestore()
    await prepareHouseholdAssignment({
      firestore, lessonRunId: 'run-1', courseFormat: 'ROLE_VARIANT',
      teamIds: ['team-a', 'team-b'], profiles: [profileA, profileB],
      actorUid: 'teacher-1', idempotencyKey: 'key-1', now: nextNow,
    })

    await expect(prepareHouseholdAssignment({
      firestore, lessonRunId: 'run-1', courseFormat: 'ROLE_VARIANT',
      teamIds: ['team-a', 'team-b', 'team-c'], profiles: [profileA, profileB],
      actorUid: 'teacher-1', idempotencyKey: 'key-1', now: nextNow,
    })).rejects.toThrow('Idempotency key payload mismatch')
  })

  it('bumps assignmentRevision and preserves valid MANUAL entries on STALE reconciliation', async () => {
    const { firestore, docs } = makeFakeFirestore()
    const prepared = await prepareHouseholdAssignment({
      firestore, lessonRunId: 'run-1', courseFormat: 'ROLE_VARIANT',
      teamIds: ['team-a', 'team-b'], profiles: [profileA, profileB],
      actorUid: 'teacher-1', idempotencyKey: 'key-1', now: nextNow,
    })
    expect(prepared.config.assignmentRevision).toBe(1)

    // Teacher manually overrides team-a's entry.
    const teamAEntry = prepared.entries.find((entry) => entry.teamId === 'team-a')!
    await updateHouseholdAssignment({
      firestore, lessonRunId: 'run-1', courseFormat: 'ROLE_VARIANT',
      teamIds: ['team-a', 'team-b'], profiles: [profileA, profileB],
      expectedRevision: 1,
      changes: [{ householdId: teamAEntry.householdId, profileId: profileB.householdId }],
      actorUid: 'teacher-1', idempotencyKey: 'update-1', now: nextNow,
    })

    // Team set changes — team-b is removed, team-c is added — triggering STALE reconciliation.
    const reconciled = await prepareHouseholdAssignment({
      firestore, lessonRunId: 'run-1', courseFormat: 'ROLE_VARIANT',
      teamIds: ['team-a', 'team-c'], profiles: [profileA, profileB],
      actorUid: 'teacher-1', idempotencyKey: 'key-2', now: nextNow,
    })

    expect(reconciled.config.assignmentRevision).toBe(3) // 1 (prepare) -> 2 (update) -> 3 (reconcile)
    expect(reconciled.config.state).toBe('DRAFT')
    const reconciledTeamA = reconciled.entries.find((entry) => entry.teamId === 'team-a')!
    expect(reconciledTeamA.assignmentSource).toBe('MANUAL')
    expect(reconciledTeamA.profileId).toBe(profileB.householdId)
    expect(reconciled.entries.some((entry) => entry.teamId === 'team-b')).toBe(false)
    expect(reconciled.entries.some((entry) => entry.teamId === 'team-c')).toBe(true)
    // Stale team-b's entry doc should have been removed.
    expect([...docs.keys()].some((path) => path.includes('team-b'))).toBe(false)
  })

  it('rejects preparing a FROZEN assignment', async () => {
    const { firestore, docs } = makeFakeFirestore()
    await prepareHouseholdAssignment({
      firestore, lessonRunId: 'run-1', courseFormat: 'ROLE_VARIANT',
      teamIds: ['team-a'], profiles: [profileA],
      actorUid: 'teacher-1', idempotencyKey: 'key-1', now: nextNow,
    })
    const config = docs.get('lessonRuns/run-1/householdAssignment/config') as unknown as HouseholdAssignmentConfig
    docs.set('lessonRuns/run-1/householdAssignment/config', { ...config, state: 'FROZEN' })

    await expect(prepareHouseholdAssignment({
      firestore, lessonRunId: 'run-1', courseFormat: 'ROLE_VARIANT',
      teamIds: ['team-a', 'team-b'], profiles: [profileA, profileB],
      actorUid: 'teacher-1', idempotencyKey: 'key-2', now: nextNow,
    })).rejects.toThrow('HouseholdAssignment is frozen')
  })
})

describe('updateHouseholdAssignment', () => {
  it('increments assignmentRevision and applies displayOrder/profileId changes', async () => {
    const { firestore } = makeFakeFirestore()
    const prepared = await prepareHouseholdAssignment({
      firestore, lessonRunId: 'run-1', courseFormat: 'ROLE_VARIANT',
      teamIds: ['team-a', 'team-b'], profiles: [profileA, profileB],
      actorUid: 'teacher-1', idempotencyKey: 'key-1', now: nextNow,
    })
    const target = prepared.entries[0]

    const updated = await updateHouseholdAssignment({
      firestore, lessonRunId: 'run-1', courseFormat: 'ROLE_VARIANT',
      teamIds: ['team-a', 'team-b'], profiles: [profileA, profileB],
      expectedRevision: 1,
      changes: [{ householdId: target.householdId, displayOrder: 9 }],
      actorUid: 'teacher-1', idempotencyKey: 'update-1', now: nextNow,
    })

    expect(updated.config.assignmentRevision).toBe(2)
    const changedEntry = updated.entries.find((entry) => entry.householdId === target.householdId)!
    expect(changedEntry.displayOrder).toBe(9)
  })

  it('rejects update when expectedRevision no longer matches', async () => {
    const { firestore } = makeFakeFirestore()
    const prepared = await prepareHouseholdAssignment({
      firestore, lessonRunId: 'run-1', courseFormat: 'ROLE_VARIANT',
      teamIds: ['team-a'], profiles: [profileA],
      actorUid: 'teacher-1', idempotencyKey: 'key-1', now: nextNow,
    })
    const target = prepared.entries[0]

    await expect(updateHouseholdAssignment({
      firestore, lessonRunId: 'run-1', courseFormat: 'ROLE_VARIANT',
      teamIds: ['team-a'], profiles: [profileA],
      expectedRevision: 999,
      changes: [{ householdId: target.householdId, displayOrder: 1 }],
      actorUid: 'teacher-1', idempotencyKey: 'update-1', now: nextNow,
    })).rejects.toThrow('Revision mismatch')
  })

  it('rejects update on a FROZEN assignment', async () => {
    const { firestore, docs } = makeFakeFirestore()
    const prepared = await prepareHouseholdAssignment({
      firestore, lessonRunId: 'run-1', courseFormat: 'ROLE_VARIANT',
      teamIds: ['team-a'], profiles: [profileA],
      actorUid: 'teacher-1', idempotencyKey: 'key-1', now: nextNow,
    })
    const config = docs.get('lessonRuns/run-1/householdAssignment/config') as unknown as HouseholdAssignmentConfig
    docs.set('lessonRuns/run-1/householdAssignment/config', { ...config, state: 'FROZEN' })
    const target = prepared.entries[0]

    await expect(updateHouseholdAssignment({
      firestore, lessonRunId: 'run-1', courseFormat: 'ROLE_VARIANT',
      teamIds: ['team-a'], profiles: [profileA],
      expectedRevision: 1,
      changes: [{ householdId: target.householdId, displayOrder: 1 }],
      actorUid: 'teacher-1', idempotencyKey: 'update-1', now: nextNow,
    })).rejects.toThrow('HouseholdAssignment is frozen')
  })

  it('MULTI_PERSON_PER_TEAM: accepts displayOrder changes but rejects profile reassignment', async () => {
    const { firestore } = makeFakeFirestore()
    const prepared = await prepareHouseholdAssignment({
      firestore, lessonRunId: 'run-1', courseFormat: 'MULTI_PERSON_PER_TEAM',
      teamIds: ['team-a'], profiles: [profileA, profileB],
      actorUid: 'teacher-1', idempotencyKey: 'key-1', now: nextNow,
    })
    expect(prepared.entries).toHaveLength(2)
    const target = prepared.entries[0]

    const updated = await updateHouseholdAssignment({
      firestore, lessonRunId: 'run-1', courseFormat: 'MULTI_PERSON_PER_TEAM',
      teamIds: ['team-a'], profiles: [profileA, profileB],
      expectedRevision: 1,
      changes: [{ householdId: target.householdId, displayOrder: 5 }],
      actorUid: 'teacher-1', idempotencyKey: 'update-1', now: nextNow,
    })
    expect(updated.entries.find((entry) => entry.householdId === target.householdId)!.displayOrder).toBe(5)

    await expect(updateHouseholdAssignment({
      firestore, lessonRunId: 'run-1', courseFormat: 'MULTI_PERSON_PER_TEAM',
      teamIds: ['team-a'], profiles: [profileA, profileB],
      expectedRevision: 2,
      changes: [{ householdId: target.householdId, profileId: 'some-other-profile' }],
      actorUid: 'teacher-1', idempotencyKey: 'update-2', now: nextNow,
    })).rejects.toThrow('MULTI_PERSON_PER_TEAM does not support changing which profile fills a slot')
  })
})

describe('getHouseholdAssignmentView', () => {
  const makeReadDeps = (docs: Map<string, Record<string, unknown>>, collections: Map<string, Array<{ id: string; data: Record<string, unknown> }>>): HouseholdAssignmentReadDeps => ({
    getDoc: async (path) => ({ exists: docs.has(path), data: () => docs.get(path) }),
    getCollection: async (path) => collections.get(path) ?? [],
  })

  it('reports UNPREPARED when no config document exists for an advanced format', async () => {
    const deps = makeReadDeps(new Map(), new Map())
    const view = await getHouseholdAssignmentView({
      lessonRunId: 'run-1', courseFormat: 'ROLE_VARIANT', currentTeamIds: ['team-a'],
      teamDisplayNames: {}, profiles: [profileA], deps,
    })
    expect(view.state).toBe('UNPREPARED')
    expect(view.assignmentRevision).toBeNull()
    expect(view.teams).toEqual([])
  })

  it('reports STALE when the persisted teamSetFingerprint no longer matches the current team set', async () => {
    const { firestore, docs } = makeFakeFirestore()
    await prepareHouseholdAssignment({
      firestore, lessonRunId: 'run-1', courseFormat: 'ROLE_VARIANT',
      teamIds: ['team-a'], profiles: [profileA],
      actorUid: 'teacher-1', idempotencyKey: 'key-1', now: nextNow,
    })
    const collections = new Map<string, Array<{ id: string; data: Record<string, unknown> }>>()
    const entriesPath = 'lessonRuns/run-1/householdAssignment/config/entries'
    const entryDocs: Array<{ id: string; data: Record<string, unknown> }> = []
    for (const [path, data] of docs) {
      if (path.startsWith(`${entriesPath}/`)) entryDocs.push({ id: path.slice(entriesPath.length + 1), data })
    }
    collections.set(entriesPath, entryDocs)
    const deps = makeReadDeps(docs, collections)

    const view = await getHouseholdAssignmentView({
      lessonRunId: 'run-1', courseFormat: 'ROLE_VARIANT', currentTeamIds: ['team-a', 'team-b'],
      teamDisplayNames: {}, profiles: [profileA, profileB], deps,
    })
    expect(view.state).toBe('STALE')
  })

  it('returns an implicit compatibility view for COMMON_CONDITIONS without persisting a document', async () => {
    const deps = makeReadDeps(new Map(), new Map())
    const view = await getHouseholdAssignmentView({
      lessonRunId: 'run-1', courseFormat: 'COMMON_CONDITIONS', currentTeamIds: ['team-b', 'team-a'],
      teamDisplayNames: { 'team-a': 'チームA' }, profiles: [], commonProfile: profileA, deps,
    })
    expect(view.state).toBe('FROZEN')
    expect(view.assignmentRevision).toBeNull()
    expect(view.teams).toHaveLength(2)
    expect(view.teams[0].teamId).toBe('team-a')
    expect(view.teams[0].entries).toEqual([{
      householdId: 'team-a', profileId: profileA.householdId, displayOrder: 0, assignmentSource: 'AUTO',
    }])
  })
})

describe('transaction read/write ordering', () => {
  it('rejects a read after a write on the fake transaction double', async () => {
    const { firestore } = makeFakeFirestore()
    await expect(firestore.runTransaction(async (tx) => {
      tx.set('some/path', { a: 1 })
      await tx.get('some/other-path')
    })).rejects.toThrow('Transaction read after write')
  })

  it('performs all reads before any write in prepareHouseholdAssignment (no ordering violation)', async () => {
    const { firestore } = makeFakeFirestore()
    await expect(prepareHouseholdAssignment({
      firestore, lessonRunId: 'run-1', courseFormat: 'ROLE_VARIANT',
      teamIds: ['team-a'], profiles: [profileA],
      actorUid: 'teacher-1', idempotencyKey: 'key-1', now: nextNow,
    })).resolves.toBeDefined()
  })
})
