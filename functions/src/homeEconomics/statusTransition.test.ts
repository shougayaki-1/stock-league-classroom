import { describe, expect, it } from 'vitest'
import type { HouseholdProfile } from '@stock-league/household-authoring-content'
import { prepareStatusTransition, afterStatusTransition, type HouseholdRuntimeControl } from './statusTransition'
import type { FirestoreTx } from '../lessonRuns/phases/transitionPhase'
import type { HouseholdAssignmentConfig } from './householdAssignmentRepository'
import type { HouseholdAssignmentEntry } from './householdAssignment'

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

/**
 * `set` throws unconditionally: `prepareStatusTransition` must be a pure
 * read-only analysis that returns writes for its caller to apply, never
 * calling `tx.set` itself (per the brief and `transitionPhase.ts`'s
 * `TransitionPhaseDeps.prepareStatusTransition` JSDoc) — any test that
 * accidentally exercises a write path fails loudly instead of silently
 * passing.
 */
const makeFakeTx = (
  docs: Record<string, Record<string, unknown>>,
  collections: Record<string, Array<{ id: string; data: Record<string, unknown> }>> = {},
): FirestoreTx => ({
  get: async (path: string) => ({ exists: path in docs, data: () => docs[path] }),
  getCollection: async (path: string) => collections[path] ?? [],
  set: () => { throw new Error('prepareStatusTransition must not call tx.set itself') },
})

const teamSetFingerprintOf = async (teamIds: string[]): Promise<string> => {
  const { teamSetFingerprint } = await import('./householdAssignment')
  return teamSetFingerprint(teamIds)
}

const buildRun = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  subject: 'HOME_ECONOMICS',
  startedAt: null,
  templateSnapshot: {
    homeEconomics: {
      courseFormat: 'ROLE_VARIANT',
      households: [profileA, profileB],
    },
  },
  ...overrides,
})

const entry = (
  teamId: string, profileId: string, slotKey: string, displayOrder: number,
): HouseholdAssignmentEntry => ({
  householdId: `${teamId}:${slotKey}`, teamId, profileId, slotKey, displayOrder, assignmentSource: 'AUTO',
})

describe('prepareStatusTransition', () => {
  it('returns null for a non-RUNNING target status', async () => {
    const tx = makeFakeTx({})
    const result = await prepareStatusTransition(tx, {
      lessonRunId: 'run-1', run: buildRun(), targetStatus: 'PAUSED', actorId: 'teacher-1', nowValue: 'now',
    })
    expect(result).toBeNull()
  })

  it('returns null for a Social Studies lesson (subject !== HOME_ECONOMICS)', async () => {
    const tx = makeFakeTx({})
    const result = await prepareStatusTransition(tx, {
      lessonRunId: 'run-1',
      run: buildRun({ subject: 'SOCIAL_STUDIES' }),
      targetStatus: 'RUNNING', actorId: 'teacher-1', nowValue: 'now',
    })
    expect(result).toBeNull()
  })

  it('returns null for COMMON_CONDITIONS Home Economics (no per-team assignment to freeze)', async () => {
    const tx = makeFakeTx({})
    const result = await prepareStatusTransition(tx, {
      lessonRunId: 'run-1',
      run: buildRun({ templateSnapshot: { homeEconomics: { courseFormat: 'COMMON_CONDITIONS', households: [profileA] } } }),
      targetStatus: 'RUNNING', actorId: 'teacher-1', nowValue: 'now',
    })
    expect(result).toBeNull()
  })

  // Regression: PAUSED -> RUNNING (a resume) must never re-freeze or reset
  // the runtime control — this is exactly the `startedAt != null` signal
  // transitionPhase.ts itself uses to decide "is this the first RUNNING
  // start".
  it('returns null when run.startedAt is already set (PAUSED -> RUNNING resume, not a first start)', async () => {
    const tx = makeFakeTx({})
    const result = await prepareStatusTransition(tx, {
      lessonRunId: 'run-1',
      run: buildRun({ startedAt: '2026-08-15T09:00:00Z' }),
      targetStatus: 'RUNNING', actorId: 'teacher-1', nowValue: 'now',
    })
    expect(result).toBeNull()
  })

  it('throws when no HouseholdAssignmentConfig has ever been prepared', async () => {
    const tx = makeFakeTx({})
    await expect(prepareStatusTransition(tx, {
      lessonRunId: 'run-1', run: buildRun(), targetStatus: 'RUNNING', actorId: 'teacher-1', nowValue: 'now',
    })).rejects.toThrow('HouseholdAssignment has not been prepared')
  })

  it('throws when the config is stale (team set changed since it was last prepared)', async () => {
    const fingerprint = await teamSetFingerprintOf(['team-a'])
    const config: HouseholdAssignmentConfig = {
      courseFormat: 'ROLE_VARIANT', state: 'DRAFT', validationStatus: 'READY', assignmentRevision: 1,
      teamSetFingerprint: fingerprint, entryIds: ['team-a:profile-a'], entriesDigest: 'digest',
      lastEditedByUid: 'teacher-1', lastEditedAtServerMillis: 1,
    }
    const tx = makeFakeTx(
      {
        'lessonRuns/run-1/householdAssignment/config': config as unknown as Record<string, unknown>,
        'lessonRuns/run-1/meta/teamsIndex': { teamIds: ['team-a', 'team-b'] },
      },
      { 'lessonRuns/run-1/householdAssignment/config/entries': [] },
    )
    await expect(prepareStatusTransition(tx, {
      lessonRunId: 'run-1', run: buildRun(), targetStatus: 'RUNNING', actorId: 'teacher-1', nowValue: 'now',
    })).rejects.toThrow('HouseholdAssignment is stale')
  })

  it('throws when validation is not READY (e.g. entry count mismatch)', async () => {
    const fingerprint = await teamSetFingerprintOf(['team-a', 'team-b'])
    const config: HouseholdAssignmentConfig = {
      courseFormat: 'ROLE_VARIANT', state: 'DRAFT', validationStatus: 'READY', assignmentRevision: 1,
      teamSetFingerprint: fingerprint, entryIds: ['team-a:profile-a'], entriesDigest: 'digest',
      lastEditedByUid: 'teacher-1', lastEditedAtServerMillis: 1,
    }
    const tx = makeFakeTx(
      {
        'lessonRuns/run-1/householdAssignment/config': config as unknown as Record<string, unknown>,
        'lessonRuns/run-1/meta/teamsIndex': { teamIds: ['team-a', 'team-b'] },
      },
      {
        'lessonRuns/run-1/householdAssignment/config/entries': [
          { id: 'team-a:profile-a', data: entry('team-a', 'profile-a', 'profile-a', 0) as unknown as Record<string, unknown> },
        ],
      },
    )
    await expect(prepareStatusTransition(tx, {
      lessonRunId: 'run-1', run: buildRun(), targetStatus: 'RUNNING', actorId: 'teacher-1', nowValue: 'now',
    })).rejects.toThrow('HouseholdAssignment is not ready to start')
  })

  it('throws when an entry references a team that no longer exists', async () => {
    const fingerprint = await teamSetFingerprintOf(['team-a'])
    const config: HouseholdAssignmentConfig = {
      courseFormat: 'ROLE_VARIANT', state: 'DRAFT', validationStatus: 'READY', assignmentRevision: 1,
      teamSetFingerprint: fingerprint, entryIds: ['ghost-team:profile-a'], entriesDigest: 'digest',
      lastEditedByUid: 'teacher-1', lastEditedAtServerMillis: 1,
    }
    const tx = makeFakeTx(
      {
        'lessonRuns/run-1/householdAssignment/config': config as unknown as Record<string, unknown>,
        'lessonRuns/run-1/meta/teamsIndex': { teamIds: ['team-a'] },
      },
      {
        'lessonRuns/run-1/householdAssignment/config/entries': [
          { id: 'ghost-team:profile-a', data: entry('ghost-team', 'profile-a', 'profile-a', 0) as unknown as Record<string, unknown> },
        ],
      },
    )
    await expect(prepareStatusTransition(tx, {
      lessonRunId: 'run-1',
      run: buildRun({ templateSnapshot: { homeEconomics: { courseFormat: 'ROLE_VARIANT', households: [profileA] } } }),
      targetStatus: 'RUNNING', actorId: 'teacher-1', nowValue: 'now',
    })).rejects.toThrow('references a team that no longer exists')
  })

  it('throws for STAGE_SPLIT when a lifeStage has no covering entry', async () => {
    const teamIds = ['team-a', 'team-b']
    const fingerprint = await teamSetFingerprintOf(teamIds)
    const config: HouseholdAssignmentConfig = {
      courseFormat: 'STAGE_SPLIT', state: 'DRAFT', validationStatus: 'READY', assignmentRevision: 1,
      teamSetFingerprint: fingerprint, entryIds: ['team-a:profile-a', 'team-b:profile-a'], entriesDigest: 'digest',
      lastEditedByUid: 'teacher-1', lastEditedAtServerMillis: 1,
    }
    // Both teams manually reassigned to profile-a (INDEPENDENT) — profile-b's
    // CHILD_REARING stage ends up with zero covering entries, even though
    // the plain entry-count check alone would still pass.
    const tx = makeFakeTx(
      {
        'lessonRuns/run-1/householdAssignment/config': config as unknown as Record<string, unknown>,
        'lessonRuns/run-1/meta/teamsIndex': { teamIds },
      },
      {
        'lessonRuns/run-1/householdAssignment/config/entries': [
          { id: 'team-a:profile-a', data: entry('team-a', 'profile-a', 'profile-a', 0) as unknown as Record<string, unknown> },
          { id: 'team-b:profile-a', data: entry('team-b', 'profile-a', 'profile-a', 1) as unknown as Record<string, unknown> },
        ],
      },
    )
    await expect(prepareStatusTransition(tx, {
      lessonRunId: 'run-1',
      run: buildRun({ templateSnapshot: { homeEconomics: { courseFormat: 'STAGE_SPLIT', households: [profileA, profileB] } } }),
      targetStatus: 'RUNNING', actorId: 'teacher-1', nowValue: 'now',
    })).rejects.toThrow('missing coverage for lifeStage')
  })

  it('throws for MULTI_PERSON_PER_TEAM when a team does not have the exact full profile set', async () => {
    const teamIds = ['team-a', 'team-b']
    const fingerprint = await teamSetFingerprintOf(teamIds)
    const config: HouseholdAssignmentConfig = {
      courseFormat: 'MULTI_PERSON_PER_TEAM', state: 'DRAFT', validationStatus: 'READY', assignmentRevision: 1,
      teamSetFingerprint: fingerprint,
      entryIds: ['team-a:0:profile-a', 'team-a:1:profile-b', 'team-b:0:profile-a', 'team-b:1:profile-a'],
      entriesDigest: 'digest', lastEditedByUid: 'teacher-1', lastEditedAtServerMillis: 1,
    }
    const tx = makeFakeTx(
      {
        'lessonRuns/run-1/householdAssignment/config': config as unknown as Record<string, unknown>,
        'lessonRuns/run-1/meta/teamsIndex': { teamIds },
      },
      {
        'lessonRuns/run-1/householdAssignment/config/entries': [
          { id: 'team-a:0:profile-a', data: entry('team-a', 'profile-a', '0:profile-a', 0) as unknown as Record<string, unknown> },
          { id: 'team-a:1:profile-b', data: entry('team-a', 'profile-b', '1:profile-b', 1) as unknown as Record<string, unknown> },
          // team-b is missing profile-b and has profile-a twice instead —
          // same total entry count, so the plain count check alone passes.
          { id: 'team-b:0:profile-a', data: entry('team-b', 'profile-a', '0:profile-a', 2) as unknown as Record<string, unknown> },
          { id: 'team-b:1:profile-a-dup', data: entry('team-b', 'profile-a', '1:profile-a-dup', 3) as unknown as Record<string, unknown> },
        ],
      },
    )
    await expect(prepareStatusTransition(tx, {
      lessonRunId: 'run-1',
      run: buildRun({ templateSnapshot: { homeEconomics: { courseFormat: 'MULTI_PERSON_PER_TEAM', households: [profileA, profileB] } } }),
      targetStatus: 'RUNNING', actorId: 'teacher-1', nowValue: 'now',
    })).rejects.toThrow('does not have the full profile set')
  })

  it('returns FROZEN config write + initial HouseholdRuntimeControl write on success, without calling tx.set itself', async () => {
    const teamIds = ['team-a', 'team-b']
    const fingerprint = await teamSetFingerprintOf(teamIds)
    const config: HouseholdAssignmentConfig = {
      courseFormat: 'ROLE_VARIANT', state: 'DRAFT', validationStatus: 'READY', assignmentRevision: 3,
      teamSetFingerprint: fingerprint, entryIds: ['team-a:profile-a', 'team-b:profile-b'], entriesDigest: 'digest',
      lastEditedByUid: 'teacher-1', lastEditedAtServerMillis: 1,
    }
    const tx = makeFakeTx(
      {
        'lessonRuns/run-1/householdAssignment/config': config as unknown as Record<string, unknown>,
        'lessonRuns/run-1/meta/teamsIndex': { teamIds },
      },
      {
        'lessonRuns/run-1/householdAssignment/config/entries': [
          { id: 'team-a:profile-a', data: entry('team-a', 'profile-a', 'profile-a', 0) as unknown as Record<string, unknown> },
          { id: 'team-b:profile-b', data: entry('team-b', 'profile-b', 'profile-b', 0) as unknown as Record<string, unknown> },
        ],
      },
    )

    const result = await prepareStatusTransition(tx, {
      lessonRunId: 'run-1', run: buildRun(), targetStatus: 'RUNNING', actorId: 'teacher-9', nowValue: 'now',
    })

    expect(result).not.toBeNull()
    expect(result!.writes).toHaveLength(2)

    const configWrite = result!.writes.find((write) => write.path === 'lessonRuns/run-1/householdAssignment/config')
    expect(configWrite?.data).toMatchObject({
      state: 'FROZEN', frozenByUid: 'teacher-9', assignmentRevision: 3, courseFormat: 'ROLE_VARIANT',
    })
    expect(typeof configWrite?.data.frozenAtServerMillis).toBe('number')

    const controlWrite = result!.writes.find((write) => write.path === 'lessonRuns/run-1/householdRuntime/control')
    expect(controlWrite?.data).toMatchObject({
      courseFormat: 'ROLE_VARIANT', assignmentRevision: 3, synchronizedRoundIndex: 0,
      roundStatus: 'OPEN', activeOperationId: null,
    } satisfies Partial<HouseholdRuntimeControl>)
    expect(typeof controlWrite?.data.updatedAtServerMillis).toBe('number')
  })

  it('returns null (no-op) if the assignment is already FROZEN, rather than re-freezing', async () => {
    const teamIds = ['team-a']
    const fingerprint = await teamSetFingerprintOf(teamIds)
    const config: HouseholdAssignmentConfig = {
      courseFormat: 'ROLE_VARIANT', state: 'FROZEN', validationStatus: 'READY', assignmentRevision: 1,
      teamSetFingerprint: fingerprint, entryIds: ['team-a:profile-a'], entriesDigest: 'digest',
      lastEditedByUid: 'teacher-1', lastEditedAtServerMillis: 1, frozenByUid: 'teacher-1', frozenAtServerMillis: 1,
    }
    const tx = makeFakeTx(
      {
        'lessonRuns/run-1/householdAssignment/config': config as unknown as Record<string, unknown>,
        'lessonRuns/run-1/meta/teamsIndex': { teamIds },
      },
      {
        'lessonRuns/run-1/householdAssignment/config/entries': [
          { id: 'team-a:profile-a', data: entry('team-a', 'profile-a', 'profile-a', 0) as unknown as Record<string, unknown> },
        ],
      },
    )
    const result = await prepareStatusTransition(tx, {
      lessonRunId: 'run-1',
      run: buildRun({ templateSnapshot: { homeEconomics: { courseFormat: 'ROLE_VARIANT', households: [profileA] } } }),
      targetStatus: 'RUNNING', actorId: 'teacher-1', nowValue: 'now',
    })
    expect(result).toBeNull()
  })
})

describe('afterStatusTransition', () => {
  it('resolves without throwing (this task only wires the hook; real post-commit projection is a later task)', async () => {
    await expect(afterStatusTransition({ lessonRunId: 'run-1', targetStatus: 'RUNNING', deduplicated: false })).resolves.toBeUndefined()
    await expect(afterStatusTransition({ lessonRunId: 'run-1', targetStatus: 'RUNNING', deduplicated: true })).resolves.toBeUndefined()
  })
})
