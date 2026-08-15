import { describe, expect, it } from 'vitest'
import {
  migrateLegacyAiBetaAccess,
  type LegacyAiBetaAccessMigrationDeps,
} from './migrateLegacyBetaAccess'

describe('migrateLegacyAiBetaAccess', () => {
  const createMockDeps = (params: {
    docs: Array<{ id: string; data: Record<string, unknown> }>
    users: Record<
      string,
      {
        uid: string
        email?: string
        emailVerified: boolean
        providerData: Array<{ providerId: string }>
      }
    >
  }) => {
    const writes: Array<{ path: string; data: unknown }> = []
    const deps: LegacyAiBetaAccessMigrationDeps = {
      auth: {
        getUser: async (uid: string) => {
          const user = params.users[uid]
          if (!user) {
            const err = new Error('User not found')
            ;(err as any).code = 'auth/user-not-found'
            throw err
          }
          return user
        },
      },
      firestore: {
        listAll: async () => params.docs,
        runTransaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
          const tx = {
            get: async (path: string) => {
              const docMatch = params.docs.find((d) => `aiBetaAccess/${d.id}` === path)
              return {
                exists: !!docMatch,
                data: () => docMatch?.data,
                get: (f: string) => docMatch?.data[f],
              }
            },
            set: (path: string, data: unknown) => {
              writes.push({ path, data })
            },
          }
          return fn(tx)
        },
      },
      now: () => 'SERVER_TIMESTAMP',
    }
    return { deps, writes }
  }

  it('scans legacy documents and counts eligible in dry-run without performing writes', async () => {
    const { deps, writes } = createMockDeps({
      docs: [
        {
          id: 'teacher-1',
          data: {
            approvedAt: 'OLD_TIMESTAMP',
            approvedByUid: 'op-1',
          },
        },
      ],
      users: {
        'teacher-1': {
          uid: 'teacher-1',
          email: 'teacher1@example.jp',
          emailVerified: true,
          providerData: [{ providerId: 'google.com' }],
        },
      },
    })

    const result = await migrateLegacyAiBetaAccess(deps, { dryRun: true })

    expect(result).toEqual({
      scanned: 1,
      alreadyMigrated: 0,
      eligible: 1,
      migrated: 0,
      invalidAuthUser: 0,
    })
    expect(writes).toHaveLength(0)
  })

  it('migrates eligible legacy document when apply is true', async () => {
    const { deps, writes } = createMockDeps({
      docs: [
        {
          id: 'teacher-1',
          data: {
            approvedAt: 'OLD_TIMESTAMP',
            approvedByUid: 'op-1',
          },
        },
      ],
      users: {
        'teacher-1': {
          uid: 'teacher-1',
          email: 'teacher1@example.jp',
          emailVerified: true,
          providerData: [{ providerId: 'google.com' }],
        },
      },
    })

    const result = await migrateLegacyAiBetaAccess(deps, { dryRun: false })

    expect(result).toEqual({
      scanned: 1,
      alreadyMigrated: 0,
      eligible: 1,
      migrated: 1,
      invalidAuthUser: 0,
    })

    expect(writes).toHaveLength(3)

    const accessWrite = writes.find((w) => w.path === 'aiBetaAccess/teacher-1')
    expect(accessWrite?.data).toEqual({
      uid: 'teacher-1',
      emailSnapshot: 'teacher1@example.jp',
      status: 'APPROVED',
      approvedAt: 'OLD_TIMESTAMP',
      approvedByUid: 'op-1',
    })

    const eventWrite = writes.find((w) => w.path.startsWith('aiBetaAccessEvents/'))
    expect(eventWrite?.data).toMatchObject({
      action: 'GRANTED',
      actorUid: 'op-1',
      targetUid: 'teacher-1',
      targetEmailSnapshot: 'teacher1@example.jp',
      reason: 'Legacy AI beta access migration',
      idempotencyKey: 'migration:legacy-ai-beta:teacher-1',
      occurredAt: 'OLD_TIMESTAMP',
    })

    const idempotencyWrite = writes.find((w) => w.path.startsWith('aiBetaAccessIdempotency/'))
    expect(idempotencyWrite?.data).toMatchObject({
      result: {
        changed: true,
        teacherUid: 'teacher-1',
      },
    })
  })

  it('skips already migrated records', async () => {
    const { deps, writes } = createMockDeps({
      docs: [
        {
          id: 'teacher-1',
          data: {
            status: 'APPROVED',
            emailSnapshot: 'teacher1@example.jp',
            approvedAt: 'OLD_TIMESTAMP',
            approvedByUid: 'op-1',
          },
        },
        {
          id: 'teacher-2',
          data: {
            status: 'REVOKED',
            emailSnapshot: 'teacher2@example.jp',
          },
        },
      ],
      users: {},
    })

    const result = await migrateLegacyAiBetaAccess(deps, { dryRun: false })

    expect(result).toEqual({
      scanned: 2,
      alreadyMigrated: 2,
      eligible: 0,
      migrated: 0,
      invalidAuthUser: 0,
    })
    expect(writes).toHaveLength(0)
  })

  it('marks invalid auth user when user does not exist or lacks verified google provider', async () => {
    const { deps, writes } = createMockDeps({
      docs: [
        {
          id: 'teacher-missing',
          data: { approvedAt: 'T1' },
        },
        {
          id: 'teacher-unverified',
          data: { approvedAt: 'T2' },
        },
        {
          id: 'teacher-no-google',
          data: { approvedAt: 'T3' },
        },
      ],
      users: {
        'teacher-unverified': {
          uid: 'teacher-unverified',
          email: 't2@example.com',
          emailVerified: false,
          providerData: [{ providerId: 'google.com' }],
        },
        'teacher-no-google': {
          uid: 'teacher-no-google',
          email: 't3@example.com',
          emailVerified: true,
          providerData: [{ providerId: 'password' }],
        },
      },
    })

    const result = await migrateLegacyAiBetaAccess(deps, { dryRun: false })

    expect(result).toEqual({
      scanned: 3,
      alreadyMigrated: 0,
      eligible: 0,
      migrated: 0,
      invalidAuthUser: 3,
    })
    expect(writes).toHaveLength(0)
  })
})
