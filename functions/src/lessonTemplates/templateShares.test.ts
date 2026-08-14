import { describe, expect, it } from 'vitest'
import { createTemplateShare, resolveTemplateShare, revokeTemplateShares } from './templateShares'

interface FakeTx {
  get: (path: string) => Promise<{ exists: boolean; data?: Record<string, unknown> }>
  set: (path: string, data: Record<string, unknown>) => void
}

const makeFakeFirestore = (seed: Record<string, Record<string, unknown>> = {}) => {
  const docs = new Map<string, Record<string, unknown>>(Object.entries(seed))
  return {
    docs,
    runTransaction: async <T>(fn: (tx: FakeTx) => Promise<T>): Promise<T> => fn({
      get: async (path) => (docs.has(path) ? { exists: true, data: docs.get(path) } : { exists: false }),
      set: (path, data) => { docs.set(path, data) },
    }),
  }
}

const hashToken = (token: string): string => `hash-of-${token}`

describe('createTemplateShare', () => {
  it('stores the share keyed by the hashed token and returns the plaintext token once', async () => {
    const fake = makeFakeFirestore()
    const result = await createTemplateShare({
      firestore: fake, hashToken, generateToken: () => 'plain-token-1',
      nowMillis: () => 1_000_000,
    }, { templateId: 'tpl-1', versionId: 'v1', sourceOrgId: 'org-source', createdByUid: 'teacher-a', expiresInDays: 30 })

    expect(result).toEqual({ token: 'plain-token-1' })
    const stored = fake.docs.get('templateShares/hash-of-plain-token-1')
    expect(stored).toMatchObject({
      templateId: 'tpl-1', versionId: 'v1', sourceOrgId: 'org-source', createdByUid: 'teacher-a',
      expiresAtMillis: 1_000_000 + 30 * 24 * 60 * 60 * 1000, revokedAt: null,
    })
  })
})

describe('resolveTemplateShare', () => {
  it('returns share metadata for a valid, unexpired, unrevoked token', async () => {
    const fake = makeFakeFirestore({
      'templateShares/hash-of-tok': {
        templateId: 'tpl-1', versionId: 'v1', sourceOrgId: 'org-source', createdByUid: 'teacher-a',
        expiresAtMillis: 2_000_000, revokedAt: null,
      },
    })
    const result = await resolveTemplateShare({ firestore: fake, hashToken, nowMillis: () => 1_000_000 }, { token: 'tok' })
    expect(result).toEqual({ templateId: 'tpl-1', versionId: 'v1', sourceOrgId: 'org-source', createdByUid: 'teacher-a' })
  })

  it('rejects a token with no matching document', async () => {
    const fake = makeFakeFirestore()
    await expect(resolveTemplateShare({ firestore: fake, hashToken, nowMillis: () => 1_000_000 }, { token: 'missing' }))
      .rejects.toThrow('Template share not found')
  })

  it('rejects a revoked token', async () => {
    const fake = makeFakeFirestore({
      'templateShares/hash-of-tok': {
        templateId: 'tpl-1', versionId: 'v1', sourceOrgId: 'org-source', createdByUid: 'teacher-a',
        expiresAtMillis: 2_000_000, revokedAt: 'sometime',
      },
    })
    await expect(resolveTemplateShare({ firestore: fake, hashToken, nowMillis: () => 1_000_000 }, { token: 'tok' }))
      .rejects.toThrow('Template share not found')
  })

  it('rejects an expired token', async () => {
    const fake = makeFakeFirestore({
      'templateShares/hash-of-tok': {
        templateId: 'tpl-1', versionId: 'v1', sourceOrgId: 'org-source', createdByUid: 'teacher-a',
        expiresAtMillis: 1_000_000, revokedAt: null,
      },
    })
    await expect(resolveTemplateShare({ firestore: fake, hashToken, nowMillis: () => 1_000_001 }, { token: 'tok' }))
      .rejects.toThrow('Template share not found')
  })
})

describe('revokeTemplateShares', () => {
  it('sets revokedAt on every share matching templateId/versionId/createdByUid', async () => {
    const fake = makeFakeFirestore({
      'templateShares/hash-a': { templateId: 'tpl-1', versionId: 'v1', createdByUid: 'teacher-a', revokedAt: null },
      'templateShares/hash-b': { templateId: 'tpl-1', versionId: 'v1', createdByUid: 'teacher-a', revokedAt: null },
    })
    await revokeTemplateShares({
      firestore: fake, hashToken, now: () => 'revoked-at-value',
      queryByCreator: async () => ['templateShares/hash-a', 'templateShares/hash-b'],
    }, { templateId: 'tpl-1', versionId: 'v1', createdByUid: 'teacher-a' })

    expect(fake.docs.get('templateShares/hash-a')).toMatchObject({ revokedAt: 'revoked-at-value' })
    expect(fake.docs.get('templateShares/hash-b')).toMatchObject({ revokedAt: 'revoked-at-value' })
  })

  it('does nothing when the query finds no matching shares', async () => {
    const fake = makeFakeFirestore()
    await expect(revokeTemplateShares({
      firestore: fake, hashToken, queryByCreator: async () => [],
    }, { templateId: 'tpl-1', versionId: 'v1', createdByUid: 'teacher-b' })).resolves.toBeUndefined()
  })
})
