import { describe, expect, it, vi } from 'vitest'
import {
  AiBetaIdempotencyMismatchError,
  AiBetaTargetIneligibleError,
  AiBetaTargetNotFoundError,
  assertAiBetaApproved,
  getAiBetaAccessApproved,
  grantAiBetaAccess,
  listApprovedAiBetaAccess,
  revokeAiBetaAccess,
  type AiBetaAccessDeps,
} from './betaAccess'

const makeApprovalDb = (exists: boolean, status?: string) =>
  ({
    doc: () => ({
      get: async () => ({
        exists,
        get: (field: string) => (field === 'status' ? status : undefined),
      }),
    }),
  }) as unknown as FirebaseFirestore.Firestore

describe('AI beta access core', () => {
  describe('approval status check', () => {
    it('does not treat an absent document as approved', async () => {
      await expect(getAiBetaAccessApproved(makeApprovalDb(false), 'teacher-a')).resolves.toBe(false)
      await expect(assertAiBetaApproved(makeApprovalDb(false), 'teacher-a')).rejects.toMatchObject({
        code: 'permission-denied',
      })
    })

    it('does not treat a legacy document without status as approved', async () => {
      await expect(getAiBetaAccessApproved(makeApprovalDb(true), 'teacher-a')).resolves.toBe(false)
      await expect(assertAiBetaApproved(makeApprovalDb(true), 'teacher-a')).rejects.toMatchObject({
        code: 'permission-denied',
      })
    })

    it('does not treat a REVOKED document as approved', async () => {
      await expect(getAiBetaAccessApproved(makeApprovalDb(true, 'REVOKED'), 'teacher-a')).resolves.toBe(false)
      await expect(assertAiBetaApproved(makeApprovalDb(true, 'REVOKED'), 'teacher-a')).rejects.toMatchObject({
        code: 'permission-denied',
      })
    })

    it('treats an APPROVED document as approved', async () => {
      await expect(getAiBetaAccessApproved(makeApprovalDb(true, 'APPROVED'), 'teacher-a')).resolves.toBe(true)
      await expect(assertAiBetaApproved(makeApprovalDb(true, 'APPROVED'), 'teacher-a')).resolves.toBeUndefined()
    })
  })

  describe('grantAiBetaAccess', () => {
    const createMockDeps = (initialData: {
      user?: { uid: string; email?: string; emailVerified: boolean; providerData: Array<{ providerId: string }> } | null
      currentAccess?: Record<string, unknown> | null
      idempotency?: Record<string, unknown> | null
    }): { deps: AiBetaAccessDeps; writes: Array<{ path: string; data: unknown; options?: unknown }> } => {
      const writes: Array<{ path: string; data: unknown; options?: unknown }> = []
      const deps: AiBetaAccessDeps = {
        auth: {
          getUserByEmail: async (_email: string) => {
            if (initialData.user === null || !initialData.user) {
              const err = new Error('User not found')
              ;(err as unknown as { code: string }).code = 'auth/user-not-found'
              throw err
            }
            return initialData.user
          },
        },
        firestore: {
          runTransaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
            const tx = {
              get: async (path: string) => {
                if (path.startsWith('aiBetaAccessIdempotency/')) {
                  return {
                    exists: initialData.idempotency != null,
                    data: () => initialData.idempotency,
                    get: (f: string) => initialData.idempotency?.[f],
                  }
                }
                if (path.startsWith('aiBetaAccess/')) {
                  return {
                    exists: initialData.currentAccess != null,
                    data: () => initialData.currentAccess,
                    get: (f: string) => initialData.currentAccess?.[f],
                  }
                }
                return { exists: false, data: () => undefined, get: () => undefined }
              },
              set: (path: string, data: unknown, options?: unknown) => {
                writes.push({ path, data, options })
              },
            }
            return fn(tx)
          },
          listApproved: async () => [],
        },
        now: () => 'SERVER_TIMESTAMP',
        deleteField: () => 'DELETE_FIELD',
      }
      return { deps, writes }
    }

    it('grants access to a valid verified Google provider user and records event & idempotency', async () => {
      const { deps, writes } = createMockDeps({
        user: {
          uid: 'teacher-123',
          email: 'teacher@example.jp',
          emailVerified: true,
          providerData: [{ providerId: 'google.com' }],
        },
        currentAccess: null,
      })

      const result = await grantAiBetaAccess(deps, {
        email: ' Teacher@Example.JP ',
        reason: '  Trial program  ',
        idempotencyKey: 'key-1',
        actorUid: 'operator-1',
      })

      expect(result).toEqual({
        changed: true,
        teacherUid: 'teacher-123',
        deduplicated: false,
      })
      expect(writes).toHaveLength(3)

      const accessWrite = writes.find((w) => w.path === 'aiBetaAccess/teacher-123')
      expect(accessWrite?.data).toEqual({
        uid: 'teacher-123',
        emailSnapshot: 'teacher@example.jp',
        status: 'APPROVED',
        approvedAt: 'SERVER_TIMESTAMP',
        approvedByUid: 'operator-1',
        revokedAt: 'DELETE_FIELD',
        revokedByUid: 'DELETE_FIELD',
      })

      const eventWrite = writes.find((w) => w.path.startsWith('aiBetaAccessEvents/'))
      expect(eventWrite?.data).toMatchObject({
        action: 'GRANTED',
        actorUid: 'operator-1',
        targetUid: 'teacher-123',
        targetEmailSnapshot: 'teacher@example.jp',
        reason: 'Trial program',
        idempotencyKey: 'key-1',
        occurredAt: 'SERVER_TIMESTAMP',
      })

      const idempotencyWrite = writes.find((w) => w.path.startsWith('aiBetaAccessIdempotency/'))
      expect(idempotencyWrite?.data).toMatchObject({
        result: {
          changed: true,
          teacherUid: 'teacher-123',
        },
      })
    })

    it('throws AiBetaTargetNotFoundError when auth user does not exist', async () => {
      const { deps, writes } = createMockDeps({ user: null })
      await expect(
        grantAiBetaAccess(deps, {
          email: 'missing@example.com',
          reason: 'test',
          idempotencyKey: 'key-1',
          actorUid: 'operator-1',
        }),
      ).rejects.toThrow(AiBetaTargetNotFoundError)
      expect(writes).toHaveLength(0)
    })

    it('throws AiBetaTargetIneligibleError when email is not verified', async () => {
      const { deps, writes } = createMockDeps({
        user: {
          uid: 'teacher-1',
          email: 'teacher@example.com',
          emailVerified: false,
          providerData: [{ providerId: 'google.com' }],
        },
      })
      await expect(
        grantAiBetaAccess(deps, {
          email: 'teacher@example.com',
          reason: 'test',
          idempotencyKey: 'key-1',
          actorUid: 'operator-1',
        }),
      ).rejects.toThrow(AiBetaTargetIneligibleError)
      expect(writes).toHaveLength(0)
    })

    it('throws AiBetaTargetIneligibleError when user has no google.com provider', async () => {
      const { deps, writes } = createMockDeps({
        user: {
          uid: 'teacher-1',
          email: 'teacher@example.com',
          emailVerified: true,
          providerData: [{ providerId: 'password' }],
        },
      })
      await expect(
        grantAiBetaAccess(deps, {
          email: 'teacher@example.com',
          reason: 'test',
          idempotencyKey: 'key-1',
          actorUid: 'operator-1',
        }),
      ).rejects.toThrow(AiBetaTargetIneligibleError)
      expect(writes).toHaveLength(0)
    })

    it('returns changed:false and does not create an event when target is already APPROVED', async () => {
      const { deps, writes } = createMockDeps({
        user: {
          uid: 'teacher-1',
          email: 'teacher@example.com',
          emailVerified: true,
          providerData: [{ providerId: 'google.com' }],
        },
        currentAccess: {
          status: 'APPROVED',
          emailSnapshot: 'teacher@example.com',
        },
      })

      const result = await grantAiBetaAccess(deps, {
        email: 'teacher@example.com',
        reason: 'already approved',
        idempotencyKey: 'new-key',
        actorUid: 'operator-1',
      })

      expect(result).toEqual({
        changed: false,
        teacherUid: 'teacher-1',
        deduplicated: false,
      })
      // Should only write idempotency record, no access or event writes
      expect(writes).toHaveLength(1)
      expect(writes[0].path).toMatch(/^aiBetaAccessIdempotency\//)
    })

    it('updates REVOKED to APPROVED and removes revoked fields', async () => {
      const { deps, writes } = createMockDeps({
        user: {
          uid: 'teacher-1',
          email: 'teacher@example.com',
          emailVerified: true,
          providerData: [{ providerId: 'google.com' }],
        },
        currentAccess: {
          status: 'REVOKED',
          revokedAt: 'SOME_OLD_TIME',
          revokedByUid: 'op-old',
        },
      })

      const result = await grantAiBetaAccess(deps, {
        email: 'teacher@example.com',
        reason: 're-approving',
        idempotencyKey: 'key-reapprove',
        actorUid: 'operator-2',
      })

      expect(result).toEqual({
        changed: true,
        teacherUid: 'teacher-1',
        deduplicated: false,
      })
      expect(writes).toHaveLength(3)
      const accessWrite = writes.find((w) => w.path === 'aiBetaAccess/teacher-1')
      expect(accessWrite?.data).toEqual({
        uid: 'teacher-1',
        emailSnapshot: 'teacher@example.com',
        status: 'APPROVED',
        approvedAt: 'SERVER_TIMESTAMP',
        approvedByUid: 'operator-2',
        revokedAt: 'DELETE_FIELD',
        revokedByUid: 'DELETE_FIELD',
      })
    })
  })

  describe('revokeAiBetaAccess', () => {
    const createMockDeps = (initialData: {
      currentAccess?: Record<string, unknown> | null
      idempotency?: Record<string, unknown> | null
    }): { deps: AiBetaAccessDeps; writes: Array<{ path: string; data: unknown; options?: unknown }> } => {
      const writes: Array<{ path: string; data: unknown; options?: unknown }> = []
      const deps: AiBetaAccessDeps = {
        auth: {
          getUserByEmail: async () => ({ uid: '', emailVerified: true, providerData: [] }),
        },
        firestore: {
          runTransaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
            const tx = {
              get: async (path: string) => {
                if (path.startsWith('aiBetaAccessIdempotency/')) {
                  return {
                    exists: initialData.idempotency != null,
                    data: () => initialData.idempotency,
                    get: (f: string) => initialData.idempotency?.[f],
                  }
                }
                if (path.startsWith('aiBetaAccess/')) {
                  return {
                    exists: initialData.currentAccess != null,
                    data: () => initialData.currentAccess,
                    get: (f: string) => initialData.currentAccess?.[f],
                  }
                }
                return { exists: false, data: () => undefined, get: () => undefined }
              },
              set: (path: string, data: unknown, options?: unknown) => {
                writes.push({ path, data, options })
              },
            }
            return fn(tx)
          },
          listApproved: async () => [],
        },
        now: () => 'SERVER_TIMESTAMP',
        deleteField: () => 'DELETE_FIELD',
      }
      return { deps, writes }
    }

    it('revokes an APPROVED user and creates REVOKED event and idempotency record', async () => {
      const { deps, writes } = createMockDeps({
        currentAccess: {
          status: 'APPROVED',
          emailSnapshot: 'teacher@example.jp',
          approvedAt: 'TIME_1',
          approvedByUid: 'op-1',
        },
      })

      const result = await revokeAiBetaAccess(deps, {
        teacherUid: 'teacher-123',
        reason: 'Terminated beta',
        idempotencyKey: 'revoke-key-1',
        actorUid: 'operator-99',
      })

      expect(result).toEqual({
        changed: true,
        teacherUid: 'teacher-123',
        deduplicated: false,
      })
      expect(writes).toHaveLength(3)

      const accessWrite = writes.find((w) => w.path === 'aiBetaAccess/teacher-123')
      expect(accessWrite?.data).toMatchObject({
        status: 'REVOKED',
        revokedAt: 'SERVER_TIMESTAMP',
        revokedByUid: 'operator-99',
      })

      const eventWrite = writes.find((w) => w.path.startsWith('aiBetaAccessEvents/'))
      expect(eventWrite?.data).toMatchObject({
        action: 'REVOKED',
        actorUid: 'operator-99',
        targetUid: 'teacher-123',
        targetEmailSnapshot: 'teacher@example.jp',
        reason: 'Terminated beta',
        idempotencyKey: 'revoke-key-1',
      })
    })

    it('returns changed:false when user is already REVOKED or absent', async () => {
      const { deps, writes } = createMockDeps({
        currentAccess: {
          status: 'REVOKED',
        },
      })

      const result = await revokeAiBetaAccess(deps, {
        teacherUid: 'teacher-123',
        reason: 'Terminated beta',
        idempotencyKey: 'revoke-key-2',
        actorUid: 'operator-99',
      })

      expect(result).toEqual({
        changed: false,
        teacherUid: 'teacher-123',
        deduplicated: false,
      })
      expect(writes).toHaveLength(1)
      expect(writes[0].path).toMatch(/^aiBetaAccessIdempotency\//)
    })
  })

  describe('idempotency behavior', () => {
    it('returns stored result with deduplicated:true on exact same payload replay', async () => {
      const { requestDigest } = await import('../lib/idempotency')
      const digest = requestDigest({
        action: 'GRANT',
        email: 'teacher@example.com',
        teacherUid: 'teacher-1',
        reason: 'test',
        actorUid: 'operator-1',
      })

      const deps: AiBetaAccessDeps = {
        auth: {
          getUserByEmail: async () => ({
            uid: 'teacher-1',
            email: 'teacher@example.com',
            emailVerified: true,
            providerData: [{ providerId: 'google.com' }],
          }),
        },
        firestore: {
          runTransaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
            const tx = {
              get: async () => ({
                exists: true,
                data: () => ({
                  digest,
                  result: { changed: true, teacherUid: 'teacher-1' },
                }),
                get: (f: string) =>
                  f === 'digest'
                    ? digest
                    : { changed: true, teacherUid: 'teacher-1' },
              }),
              set: vi.fn(),
            }
            return fn(tx)
          },
          listApproved: async () => [],
        },
        now: () => 'SERVER_TIMESTAMP',
        deleteField: () => 'DELETE_FIELD',
      }

      const res = await grantAiBetaAccess(deps, {
        email: 'teacher@example.com',
        reason: 'test',
        idempotencyKey: 'some-key',
        actorUid: 'operator-1',
      })

      expect(res).toEqual({
        changed: true,
        teacherUid: 'teacher-1',
        deduplicated: true,
      })
    })

    it('throws AiBetaIdempotencyMismatchError when idempotency key is reused with different payload', async () => {
      const writes: any[] = []
      const deps: AiBetaAccessDeps = {
        auth: {
          getUserByEmail: async () => ({
            uid: 'teacher-1',
            email: 'teacher@example.com',
            emailVerified: true,
            providerData: [{ providerId: 'google.com' }],
          }),
        },
        firestore: {
          runTransaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
            const tx = {
              get: async () => ({
                exists: true,
                data: () => ({
                  digest: 'different-digest',
                  result: { changed: true, teacherUid: 'teacher-1' },
                }),
                get: (f: string) => (f === 'digest' ? 'different-digest' : { changed: true, teacherUid: 'teacher-1' }),
              }),
              set: (path: string, data: unknown) => {
                writes.push({ path, data })
              },
            }
            return fn(tx)
          },
          listApproved: async () => [],
        },
        now: () => 'SERVER_TIMESTAMP',
        deleteField: () => 'DELETE_FIELD',
      }

      await expect(
        grantAiBetaAccess(deps, {
          email: 'teacher@example.com',
          reason: 'test',
          idempotencyKey: 'some-key',
          actorUid: 'operator-1',
        }),
      ).rejects.toThrow(AiBetaIdempotencyMismatchError)
      expect(writes).toHaveLength(0)
    })
  })

  describe('listApprovedAiBetaAccess', () => {
    it('queries approved items and maps Timestamp to millis', async () => {
      const deps = {
        firestore: {
          runTransaction: vi.fn(),
          listApproved: async () => [
            {
              id: 'teacher-1',
              data: {
                emailSnapshot: 'teacher1@example.com',
                approvedByUid: 'op-1',
                approvedAt: { toMillis: () => 1700000000000 },
              },
            },
            {
              id: 'teacher-2',
              data: {
                emailSnapshot: 'teacher2@example.com',
                approvedByUid: 'op-2',
                approvedAt: 1700000050000,
              },
            },
          ],
        },
      }

      const items = await listApprovedAiBetaAccess(deps)
      expect(items).toEqual([
        {
          teacherUid: 'teacher-1',
          email: 'teacher1@example.com',
          approvedByUid: 'op-1',
          approvedAtMillis: 1700000000000,
        },
        {
          teacherUid: 'teacher-2',
          email: 'teacher2@example.com',
          approvedByUid: 'op-2',
          approvedAtMillis: 1700000050000,
        },
      ])
    })
  })
})
