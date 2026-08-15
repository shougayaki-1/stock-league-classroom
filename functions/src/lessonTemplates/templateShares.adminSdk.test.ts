import { beforeEach, describe, expect, it, vi } from 'vitest'

type DocumentData = Record<string, unknown>
const documents = new Map<string, DocumentData>()
const queryResults = new Map<string, string[]>()

/** Identity ref carrying only its path — mirrors adminSdkFirestore()'s usage, where db.doc(path) is only ever passed straight into tx.get/tx.set, never called standalone. */
const doc = (path: string) => ({ path })

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc,
    collection: (path: string) => ({
      where: () => ({
        where: () => ({
          where: () => ({
            get: async () => {
              const paths = queryResults.get(path) ?? []
              return { docs: paths.map((p) => ({ ref: { path: p } })) }
            },
          }),
        }),
      }),
    }),
    runTransaction: async (fn: (tx: { get: (ref: { path: string } | string) => Promise<{ exists: boolean; data: () => DocumentData | undefined }>; set: (ref: { path: string } | string, data: DocumentData) => void }) => Promise<unknown>) => fn({
      get: async (ref) => {
        const path = typeof ref === 'string' ? ref : ref.path
        return documents.has(path) ? { exists: true, data: () => documents.get(path) } : { exists: false, data: () => undefined }
      },
      set: (ref, data) => { documents.set(typeof ref === 'string' ? ref : ref.path, data) },
    }),
  }),
}))

import { createTemplateShareWithAdminSdk, resolveTemplateShareWithAdminSdk, revokeTemplateSharesWithAdminSdk } from './templateShares'

describe('createTemplateShareWithAdminSdk / resolveTemplateShareWithAdminSdk', () => {
  beforeEach(() => { documents.clear(); queryResults.clear() })

  it('creates a share and resolves it back by the returned token', async () => {
    documents.set('lessonTemplates/tpl-1', { orgId: 'org-source' })
    const { token } = await createTemplateShareWithAdminSdk({
      templateId: 'tpl-1', versionId: 'v1', sourceOrgId: 'org-source', createdByUid: 'teacher-a', expiresInDays: 30,
    })
    const resolved = await resolveTemplateShareWithAdminSdk({ token })
    expect(resolved).toEqual({ templateId: 'tpl-1', versionId: 'v1', sourceOrgId: 'org-source', createdByUid: 'teacher-a' })
  })

  it('fails to resolve an unknown token', async () => {
    await expect(resolveTemplateShareWithAdminSdk({ token: 'never-issued' })).rejects.toThrow('Template share not found')
  })
})

describe('revokeTemplateSharesWithAdminSdk', () => {
  beforeEach(() => { documents.clear(); queryResults.clear() })

  it('revokes every share document the creator-scoped query returns', async () => {
    documents.set('templateShares/hash-a', { templateId: 'tpl-1', versionId: 'v1', createdByUid: 'teacher-a', revokedAt: null })
    queryResults.set('templateShares', ['templateShares/hash-a'])

    await revokeTemplateSharesWithAdminSdk({ templateId: 'tpl-1', versionId: 'v1', createdByUid: 'teacher-a' })

    expect(documents.get('templateShares/hash-a')).toMatchObject({ revokedAt: expect.anything() })
  })
})
