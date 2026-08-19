import { describe, expect, it, vi } from 'vitest'
import { joinLessonRun } from './joinLessonRun'

const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    // `written` is scoped per-transaction (reset on every `runTransaction`
    // call, not shared across calls): it reproduces Firestore Admin SDK's
    // real "all reads before all writes" constraint within a single
    // transaction (see transaction.js's READ_AFTER_WRITE_ERROR_MSG) — once
    // `set` has run once, any further `get` in the *same* transaction must
    // throw, exactly like production. Without this guard the fake let
    // Critical #1's read-after-write bug slip through every test.
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

const setUpLessonRun = (docs: Map<string, Record<string, unknown>>, overrides: Record<string, unknown> = {}) => {
  docs.set('lessonJoinCodes/ABCDEF', { code: 'ABCDEF', lessonRunId: 'run-1', status: 'ACTIVE' })
  docs.set('lessonRuns/run-1', { orgId: 'org-1', status: 'READY', ...overrides })
}

const baseInput = (overrides: Record<string, unknown> = {}) => ({
  joinCode: 'ABCDEF',
  identityMode: 'QUICK_JOIN' as const,
  displayName: 'たろう',
  idempotencyKey: 'join-1',
  ...overrides,
})

const makeDeps = (fake: ReturnType<typeof makeFakeFirestore>, overrides: Record<string, unknown> = {}) => {
  let seq = 0
  return {
    firestore: fake as never,
    authUid: 'student-a',
    generateParticipantId: () => `participant-${(seq += 1)}`,
    syncMembership: vi.fn().mockResolvedValue(undefined),
    now: () => 'fixed-now',
    ...overrides,
  }
}

describe('joinLessonRun', () => {
  it('creates a new participant, appends PARTICIPANT_JOINED once, and syncs the RTDB mirror after commit', async () => {
    const fake = makeFakeFirestore()
    setUpLessonRun(fake.docs)
    const deps = makeDeps(fake)

    const result = await joinLessonRun(deps, baseInput())

    expect(result.deduplicated).toBe(false)
    expect(result.lessonRunId).toBe('run-1')
    expect(result.duplicateIdentifierWarning).toBe(false)
    const participant = fake.docs.get(`lessonRuns/run-1/participants/${result.participantId}`)
    expect(participant).toMatchObject({ authUid: 'student-a', status: 'ACTIVE', sessionVersion: 0, orgId: 'org-1' })
    const events = [...fake.docs.keys()].filter((k) => k.includes('/events/'))
    expect(events).toHaveLength(1)
    expect(deps.syncMembership).toHaveBeenCalledTimes(1)
    expect(deps.syncMembership).toHaveBeenCalledWith(expect.objectContaining({
      lessonRunId: 'run-1', authUid: 'student-a', participantId: result.participantId, sessionVersion: 0,
    }))
  })

  it('deduplicates the same join request and warns on duplicate external identifiers', async () => {
    const fake = makeFakeFirestore()
    setUpLessonRun(fake.docs)
    const deps = makeDeps(fake)

    const first = await joinLessonRun(deps, baseInput({ idempotencyKey: 'join-1' }))
    const retry = await joinLessonRun(deps, baseInput({ idempotencyKey: 'join-1' }))

    expect(retry.participantId).toBe(first.participantId)
    expect(retry.deduplicated).toBe(true)
    const events = [...fake.docs.keys()].filter((k) => k.includes('/events/'))
    expect(events).toHaveLength(1)
    // syncMembership still runs on a deduplicated replay (idempotent RTDB heal), but appendEvent must not run twice.
    expect(deps.syncMembership).toHaveBeenCalledTimes(2)
  })

  it('rejects a retried idempotencyKey whose payload differs from the original', async () => {
    const fake = makeFakeFirestore()
    setUpLessonRun(fake.docs)
    const deps = makeDeps(fake)
    await joinLessonRun(deps, baseInput({ idempotencyKey: 'join-1', displayName: 'A' }))
    await expect(joinLessonRun(deps, baseInput({ idempotencyKey: 'join-1', displayName: 'B' })))
      .rejects.toThrow('Idempotency key payload mismatch')
  })

  it('warns (but does not fail) when a second participant reuses an externalIdentifier already claimed in this run', async () => {
    const fake = makeFakeFirestore()
    setUpLessonRun(fake.docs)
    const deps = makeDeps(fake)
    const first = await joinLessonRun(deps, baseInput({ idempotencyKey: 'join-1', externalIdentifier: '15' }))
    const second = await joinLessonRun({ ...deps, authUid: 'student-b' }, baseInput({ idempotencyKey: 'join-2', externalIdentifier: '15' }))

    expect(first.duplicateIdentifierWarning).toBe(false)
    expect(second.duplicateIdentifierWarning).toBe(true)
    expect(second.participantId).not.toBe(first.participantId)
  })

  it('rejects joining via an inactive (invalidated) join code', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonJoinCodes/ABCDEF', { code: 'ABCDEF', lessonRunId: 'run-1', status: 'INVALIDATED' })
    fake.docs.set('lessonRuns/run-1', { orgId: 'org-1', status: 'READY' })
    const deps = makeDeps(fake)
    await expect(joinLessonRun(deps, baseInput())).rejects.toThrow('Join code is not active')
  })

  it('rejects a join code pointing at a lesson run that is not READY/WAITING', async () => {
    const fake = makeFakeFirestore()
    setUpLessonRun(fake.docs, { status: 'ENDED' })
    const deps = makeDeps(fake)
    await expect(joinLessonRun(deps, baseInput())).rejects.toThrow('LessonRun is not accepting participants')
  })

  it('rejects an unknown join code', async () => {
    const fake = makeFakeFirestore()
    setUpLessonRun(fake.docs)
    const deps = makeDeps(fake)
    await expect(joinLessonRun(deps, baseInput({ joinCode: 'ZZZZZZ' }))).rejects.toThrow('Join code not found')
  })

  it('enforces maxParticipants for brand-new participants only', async () => {
    const fake = makeFakeFirestore()
    setUpLessonRun(fake.docs, { maxParticipants: 1 })
    const deps = makeDeps(fake)
    await joinLessonRun(deps, baseInput({ idempotencyKey: 'join-1' }))
    await expect(joinLessonRun({ ...deps, authUid: 'student-b' }, baseInput({ idempotencyKey: 'join-2' })))
      .rejects.toThrow('LessonRun has reached its maximum number of participants')
  })

  it('treats a reconnect (same authUid rejoining) as reusing the same participant and bumping sessionVersion, not consuming a new maxParticipants slot', async () => {
    const fake = makeFakeFirestore()
    setUpLessonRun(fake.docs, { maxParticipants: 1 })
    const deps = makeDeps(fake)
    const first = await joinLessonRun(deps, baseInput({ idempotencyKey: 'join-1' }))
    const second = await joinLessonRun(deps, baseInput({ idempotencyKey: 'join-2' }))

    expect(second.participantId).toBe(first.participantId)
    expect(second.deduplicated).toBe(false)
    const participant = fake.docs.get(`lessonRuns/run-1/participants/${first.participantId}`)
    expect(participant).toMatchObject({ sessionVersion: 1 })
  })

  it('rejects a rejoin attempt from a participant who has been suspended', async () => {
    const fake = makeFakeFirestore()
    setUpLessonRun(fake.docs)
    const deps = makeDeps(fake)
    const first = await joinLessonRun(deps, baseInput({ idempotencyKey: 'join-1' }))
    fake.docs.set(`lessonRuns/run-1/participants/${first.participantId}`, {
      ...fake.docs.get(`lessonRuns/run-1/participants/${first.participantId}`),
      status: 'SUSPENDED',
    })
    await expect(joinLessonRun(deps, baseInput({ idempotencyKey: 'join-2' })))
      .rejects.toThrow('Participant has been suspended from this lesson')
  })

  it('does not call syncMembership when the Firestore transaction fails', async () => {
    const fake = makeFakeFirestore()
    // No lessonJoinCodes doc set up, so the transaction throws before commit.
    fake.docs.set('lessonRuns/run-1', { orgId: 'org-1', status: 'READY' })
    const deps = makeDeps(fake)
    await expect(joinLessonRun(deps, baseInput())).rejects.toThrow('Join code not found')
    expect(deps.syncMembership).not.toHaveBeenCalled()
  })

  // Important #1: appendLessonEventInTransaction scopes its own idempotency
  // dedup doc by lessonRunId only, not by authUid. Before the fix, two
  // different students sending the same client-generated idempotencyKey
  // string (a realistic scenario if a naive client just uses a fixed value
  // like 'join-1') would collide on that single doc: the second student's
  // request digest (which embeds their own authUid/displayName) would not
  // match the first's, throwing 'Idempotency key payload mismatch' and
  // permanently blocking that student from joining with that key.
  it('allows two different students to join using the exact same idempotencyKey string without colliding on PARTICIPANT_JOINED event dedup', async () => {
    const fake = makeFakeFirestore()
    setUpLessonRun(fake.docs)
    const deps = makeDeps(fake)

    const studentA = await joinLessonRun(deps, baseInput({ idempotencyKey: 'join-1', displayName: 'Aさん' }))
    const studentB = await joinLessonRun(
      { ...deps, authUid: 'student-b' },
      baseInput({ idempotencyKey: 'join-1', displayName: 'Bさん' }),
    )

    expect(studentA.deduplicated).toBe(false)
    expect(studentB.deduplicated).toBe(false)
    expect(studentB.participantId).not.toBe(studentA.participantId)
    const events = [...fake.docs.keys()].filter((k) => k.includes('/events/'))
    expect(events).toHaveLength(2)
  })

  // Important #2: reconnecting must not let a student silently regain
  // operate rights after a teacher has demoted them to OBSERVER — only
  // transient statuses (TEMPORARILY_DISCONNECTED/ABSENT/MIGRATING_DEVICE)
  // should be healed back to ACTIVE by a reconnect.
  it('preserves OBSERVER status across a reconnect instead of resetting it to ACTIVE', async () => {
    const fake = makeFakeFirestore()
    setUpLessonRun(fake.docs)
    const deps = makeDeps(fake)
    const first = await joinLessonRun(deps, baseInput({ idempotencyKey: 'join-1' }))
    fake.docs.set(`lessonRuns/run-1/participants/${first.participantId}`, {
      ...fake.docs.get(`lessonRuns/run-1/participants/${first.participantId}`),
      status: 'OBSERVER',
    })

    const rejoin = await joinLessonRun(deps, baseInput({ idempotencyKey: 'join-2' }))

    expect(rejoin.participantId).toBe(first.participantId)
    const participant = fake.docs.get(`lessonRuns/run-1/participants/${first.participantId}`)
    expect(participant).toMatchObject({ status: 'OBSERVER', sessionVersion: 1 })
    expect(deps.syncMembership).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'OBSERVER' }))
  })

  it('resets a TEMPORARILY_DISCONNECTED participant back to ACTIVE on reconnect', async () => {
    const fake = makeFakeFirestore()
    setUpLessonRun(fake.docs)
    const deps = makeDeps(fake)
    const first = await joinLessonRun(deps, baseInput({ idempotencyKey: 'join-1' }))
    fake.docs.set(`lessonRuns/run-1/participants/${first.participantId}`, {
      ...fake.docs.get(`lessonRuns/run-1/participants/${first.participantId}`),
      status: 'TEMPORARILY_DISCONNECTED',
    })

    await joinLessonRun(deps, baseInput({ idempotencyKey: 'join-2' }))

    const participant = fake.docs.get(`lessonRuns/run-1/participants/${first.participantId}`)
    expect(participant).toMatchObject({ status: 'ACTIVE' })
  })

  // Task 3: advanced-format (ROLE_VARIANT/STAGE_SPLIT/MULTI_PERSON_PER_TEAM)
  // Home Economics lessons pre-pin every household to a pre-existing team
  // at freeze time, so a late arrival must join one of THOSE teams — never
  // get a fresh unassigned join, and never trigger creation of a new team.
  describe('advanced Home Economics late join (RUNNING + FROZEN assignment)', () => {
    const setUpAdvancedFrozenRun = (docs: Map<string, Record<string, unknown>>, overrides: Record<string, unknown> = {}) => {
      docs.set('lessonJoinCodes/ABCDEF', { code: 'ABCDEF', lessonRunId: 'run-1', status: 'ACTIVE' })
      docs.set('lessonRuns/run-1', {
        orgId: 'org-1', status: 'RUNNING', subject: 'HOME_ECONOMICS',
        templateSnapshot: { homeEconomics: { courseFormat: 'ROLE_VARIANT' } },
        ...overrides,
      })
      docs.set('lessonRuns/run-1/householdAssignment/config', { state: 'FROZEN' })
      docs.set('lessonRuns/run-1/meta/teamsIndex', { teamIds: ['team-a', 'team-b'] })
      docs.set('lessonRuns/run-1/teams/team-a', {
        id: 'team-a', lessonRunId: 'run-1', orgId: 'org-1', displayName: 'A', confirmationMode: 'ALL',
        memberParticipantIds: ['existing-1', 'existing-2'], version: 1,
      })
      docs.set('lessonRuns/run-1/teams/team-b', {
        id: 'team-b', lessonRunId: 'run-1', orgId: 'org-1', displayName: 'B', confirmationMode: 'ALL',
        memberParticipantIds: ['existing-3'], version: 1,
      })
    }

    it('rejects an ordinary (non-advanced / non-frozen) RUNNING join exactly as before', async () => {
      const fake = makeFakeFirestore()
      setUpLessonRun(fake.docs, { status: 'RUNNING' })
      const deps = makeDeps(fake)
      await expect(joinLessonRun(deps, baseInput())).rejects.toThrow('LessonRun is not accepting participants')
    })

    it('rejects a RUNNING join for an advanced-format lesson whose assignment is not FROZEN yet', async () => {
      const fake = makeFakeFirestore()
      setUpAdvancedFrozenRun(fake.docs)
      fake.docs.set('lessonRuns/run-1/householdAssignment/config', { state: 'DRAFT' })
      const deps = makeDeps(fake)
      await expect(joinLessonRun(deps, baseInput())).rejects.toThrow('LessonRun is not accepting participants')
    })

    it('rejects a RUNNING join for a FROZEN advanced-format lesson that has no teams yet', async () => {
      const fake = makeFakeFirestore()
      setUpAdvancedFrozenRun(fake.docs)
      fake.docs.set('lessonRuns/run-1/meta/teamsIndex', { teamIds: [] })
      const deps = makeDeps(fake)
      await expect(joinLessonRun(deps, baseInput())).rejects.toThrow('LessonRun is not accepting participants')
    })

    it('rejects a RUNNING join for COMMON_CONDITIONS (not one of the 3 advanced formats) even if somehow FROZEN', async () => {
      const fake = makeFakeFirestore()
      setUpAdvancedFrozenRun(fake.docs, { templateSnapshot: { homeEconomics: { courseFormat: 'COMMON_CONDITIONS' } } })
      const deps = makeDeps(fake)
      await expect(joinLessonRun(deps, baseInput())).rejects.toThrow('LessonRun is not accepting participants')
    })

    it('allows a new participant to late-join into the least-full existing team, tagged LATE_JOIN, and never creates a new team', async () => {
      const fake = makeFakeFirestore()
      setUpAdvancedFrozenRun(fake.docs)
      const deps = makeDeps(fake)

      const result = await joinLessonRun(deps, baseInput())

      expect(result.teamId).toBe('team-b') // team-b has 1 member, team-a has 2 — balanced pick
      const participant = fake.docs.get(`lessonRuns/run-1/participants/${result.participantId}`)
      expect(participant).toMatchObject({ status: 'LATE_JOIN', teamId: 'team-b' })
      const teamB = fake.docs.get('lessonRuns/run-1/teams/team-b') as { memberParticipantIds: string[]; version: number }
      expect(teamB.memberParticipantIds).toContain(result.participantId)
      expect(teamB.version).toBe(2)
      const teamA = fake.docs.get('lessonRuns/run-1/teams/team-a') as { memberParticipantIds: string[] }
      expect(teamA.memberParticipantIds).not.toContain(result.participantId)
      expect(fake.docs.has('lessonRuns/run-1/teams/new-team')).toBe(false)
      expect(deps.syncMembership).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'team-b', status: 'LATE_JOIN' }))
    })

    it('is idempotent: replaying the same late-join idempotencyKey does not double-append the participant to the team', async () => {
      const fake = makeFakeFirestore()
      setUpAdvancedFrozenRun(fake.docs)
      const deps = makeDeps(fake)

      const first = await joinLessonRun(deps, baseInput({ idempotencyKey: 'late-1' }))
      const second = await joinLessonRun(deps, baseInput({ idempotencyKey: 'late-1' }))

      expect(second.deduplicated).toBe(true)
      expect(second.participantId).toBe(first.participantId)
      const teamB = fake.docs.get('lessonRuns/run-1/teams/team-b') as { memberParticipantIds: string[] }
      expect(teamB.memberParticipantIds.filter((id) => id === first.participantId)).toHaveLength(1)
    })

    // Regression test (task-3 review finding): the RUNNING+advanced+FROZEN
    // gate above (`lateJoinTeamIds`) only decides whether the transaction is
    // allowed to proceed past the READY/WAITING check — it does NOT bypass
    // the separate `authIndexSnap.exists` branch that follows. An EXISTING
    // participant (one who already has a `participantsByAuthUid` index
    // entry — e.g. they joined earlier while the run was READY/WAITING, or
    // reconnected before) hitting this gate while RUNNING must fall through
    // to the ordinary reconnect logic: reuse their real `existing.teamId`,
    // bump `sessionVersion`, and never touch any team doc or run the
    // new-participant `assignBalancedTeam` assignment meant only for a
    // genuinely new latecomer. `lateJoinTeam` (the only local that drives a
    // team-doc write) is set exclusively inside the `else` (new-participant)
    // branch, so a reconnect can never double-append to a team roster or
    // have its real prior team silently reassigned to the "least full"
    // team — this test proves that end-to-end.
    it('lets an EXISTING participant reconnect during RUNNING for an advanced-format FROZEN lesson through the ordinary reconnect path, not the new-participant team-assignment path', async () => {
      const fake = makeFakeFirestore()
      setUpAdvancedFrozenRun(fake.docs)
      // Simulate student-a already being a participant on team-a (e.g. they
      // joined before the lesson went RUNNING) who is now reconnecting.
      fake.docs.set('lessonRuns/run-1/participants/existing-1', {
        id: 'existing-1', lessonRunId: 'run-1', orgId: 'org-1', authUid: 'student-a',
        identityMode: 'QUICK_JOIN', displayName: 'たろう', teamId: 'team-a',
        status: 'TEMPORARILY_DISCONNECTED', sessionVersion: 0, joinedAt: 'fixed-now', lastSeenAt: 'fixed-now',
      })
      fake.docs.set('lessonRuns/run-1/participantsByAuthUid/student-a', { participantId: 'existing-1' })
      const deps = makeDeps(fake)

      const result = await joinLessonRun(deps, baseInput({ idempotencyKey: 'reconnect-1' }))

      expect(result.participantId).toBe('existing-1')
      // Preserves the real prior team — must NOT be reassigned via
      // assignBalancedTeam to team-b (the least-full team, which is what a
      // brand-new joiner would get).
      expect(result.teamId).toBe('team-a')
      expect(result.deduplicated).toBe(false)
      const participant = fake.docs.get('lessonRuns/run-1/participants/existing-1')
      expect(participant).toMatchObject({ status: 'ACTIVE', sessionVersion: 1, teamId: 'team-a' })
      const teamA = fake.docs.get('lessonRuns/run-1/teams/team-a') as { memberParticipantIds: string[]; version: number }
      expect(teamA.memberParticipantIds).toEqual(['existing-1', 'existing-2']) // unchanged: no double-append
      expect(teamA.version).toBe(1) // unchanged: reconnect never rewrites the team doc
      const teamB = fake.docs.get('lessonRuns/run-1/teams/team-b') as { memberParticipantIds: string[] }
      expect(teamB.memberParticipantIds).toEqual(['existing-3']) // untouched
      expect(deps.syncMembership).toHaveBeenCalledWith(
        expect.objectContaining({ teamId: 'team-a', status: 'ACTIVE', sessionVersion: 1 }),
      )
    })

    it('参加成立後に教室表示を発行する', async () => {
      const fake = makeFakeFirestore()
      setUpLessonRun(fake.docs)
      const published: string[] = []
      const deps = makeDeps(fake, {
        publishLessonProjection: async (id: string) => { published.push(id) },
      })

      await joinLessonRun(deps, baseInput())

      expect(published).toEqual(['run-1'])
    })
  })
})
