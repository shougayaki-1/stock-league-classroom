import { describe, expect, it } from 'vitest'
import {
  createLessonTemplateMoveOperation,
  previewLessonTemplateMove,
  runLessonTemplateMoveOperation,
  type LessonTemplateMoveDeps,
} from './moveLessonTemplate'

interface FakeDoc {
  exists: boolean
  id: string
  path: string
  data: () => Record<string, unknown> | undefined
}

interface FakeQuery {
  where: (field: string, op: string, val: unknown) => FakeQuery
  limit?: (n: number) => FakeQuery
  get: () => Promise<{ empty: boolean; docs: FakeDoc[] }>
}

const createFakeDb = (seed: Record<string, Record<string, unknown>> = {}) => {
  const store = new Map<string, Record<string, unknown>>()
  for (const [k, v] of Object.entries(seed)) {
    store.set(k, JSON.parse(JSON.stringify(v)))
  }

  const queryCollection = (prefix: string, filterField?: string, filterVal?: unknown): FakeQuery => ({
    where: (f, _op, v) => queryCollection(prefix, f, v),
    limit: () => queryCollection(prefix, filterField, filterVal),
    get: async () => {
      const docs: FakeDoc[] = []
      for (const [path, data] of store.entries()) {
        const parts = path.split('/')
        // direct child of collection prefix
        if (path.startsWith(prefix) && parts.length === prefix.split('/').length + 1) {
          if (!filterField || data[filterField] === filterVal) {
            docs.push({
              exists: true,
              id: parts[parts.length - 1],
              path,
              data: () => data,
            })
          }
        }
      }
      return { empty: docs.length === 0, docs }
    },
  })

  return {
    store,
    doc: (path: string) => ({
      id: path.split('/').pop()!,
      path,
      get: async (): Promise<FakeDoc> => {
        const data = store.get(path)
        return data ? { exists: true, id: path.split('/').pop()!, path, data: () => data } : { exists: false, id: path.split('/').pop()!, path, data: () => undefined }
      },
      set: async (data: Record<string, unknown>) => {
        store.set(path, data)
      },
    }),
    collection: (path: string) => ({
      doc: (id?: string) => {
        const docId = id ?? `gen-${Math.random().toString(36).slice(2)}`
        const fullPath = `${path}/${docId}`
        return {
          id: docId,
          path: fullPath,
          get: async (): Promise<FakeDoc> => {
            const data = store.get(fullPath)
            return data ? { exists: true, id: docId, path: fullPath, data: () => data } : { exists: false, id: docId, path: fullPath, data: () => undefined }
          },
          set: async (data: Record<string, unknown>) => {
            store.set(fullPath, data)
          },
        }
      },
      where: (f: string, op: string, v: unknown) => queryCollection(path).where(f, op, v),
      get: async () => queryCollection(path).get(),
    }),
    runTransaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
      const tx = {
        get: async (pathOrRef: any) => {
          const p = typeof pathOrRef === 'string' ? pathOrRef : pathOrRef.path
          const data = store.get(p)
          return data ? { exists: true, id: p.split('/').pop()!, path: p, data: () => data } : { exists: false, id: p.split('/').pop()!, path: p, data: () => undefined }
        },
        set: (pathOrRef: any, data: Record<string, unknown>) => {
          const p = typeof pathOrRef === 'string' ? pathOrRef : pathOrRef.path
          store.set(p, JSON.parse(JSON.stringify(data)))
        },
        update: (pathOrRef: any, updates: Record<string, unknown>) => {
          const p = typeof pathOrRef === 'string' ? pathOrRef : pathOrRef.path
          const existing = store.get(p) ?? {}
          for (const [k, v] of Object.entries(updates)) {
            if (v === '__DELETE__') {
              delete (existing as any)[k]
            } else {
              (existing as any)[k] = v
            }
          }
          store.set(p, existing)
        },
      }
      return fn(tx)
    },
  }
}

const createFakeStorage = (initialObjects: string[] = []) => {
  const objects = new Set<string>(initialObjects)
  return {
    objects,
    exists: async (path: string) => objects.has(path),
    copy: async (src: string, dest: string) => {
      if (!objects.has(src)) throw new Error(`Source object not found: ${src}`)
      objects.add(dest)
    },
    delete: async (path: string) => {
      objects.delete(path)
    },
    listPrefix: async (prefix: string) => {
      return Array.from(objects).filter((o) => o.startsWith(prefix))
    },
  }
}

describe('previewLessonTemplateMove', () => {
  it('returns canMove=false when template has legacy untracked material without valid storagePath', async () => {
    const db = createFakeDb({
      'lessonTemplates/tpl-1': { orgId: 'org-source', visibility: 'COMMUNITY' },
      'lessonTemplates/tpl-1/versions/v1': { orgId: 'org-source' },
      'lessonTemplates/tpl-1/materials/mat-legacy': { fileName: 'legacy.pdf', text: 'raw' },
    })
    const preview = await previewLessonTemplateMove({ db: db as any }, {
      templateId: 'tpl-1',
      sourceOrgId: 'org-source',
      targetOrgId: 'org-target',
    })

    expect(preview.canMove).toBe(false)
    expect(preview.legacyMaterialCount).toBe(1)
    expect(preview.materialCount).toBe(1)
    expect(preview.versionCount).toBe(1)
    expect(preview.willUnpublishCommunity).toBe(true)
    expect(preview.willResetApproval).toBe(true)
    expect(preview.historicalLessonRunsRemain).toBe(true)
  })

  it('allows moving template with 0 materials', async () => {
    const db = createFakeDb({
      'lessonTemplates/tpl-1': { orgId: 'org-source', visibility: 'PRIVATE' },
      'lessonTemplates/tpl-1/versions/v1': { orgId: 'org-source' },
    })
    const preview = await previewLessonTemplateMove({ db: db as any }, {
      templateId: 'tpl-1',
      sourceOrgId: 'org-source',
      targetOrgId: 'org-target',
    })

    expect(preview.canMove).toBe(true)
    expect(preview.materialCount).toBe(0)
    expect(preview.legacyMaterialCount).toBe(0)
    expect(preview.versionCount).toBe(1)
    expect(preview.willUnpublishCommunity).toBe(false)
  })

  it('allows moving template with tracked materials having correct storagePath', async () => {
    const db = createFakeDb({
      'lessonTemplates/tpl-1': { orgId: 'org-source', visibility: 'PRIVATE' },
      'lessonTemplates/tpl-1/materials/mat-1': {
        fileName: 'guide.pdf',
        text: 'content',
        storagePath: 'orgs/org-source/materials/tpl-1/s-1/guide.pdf',
      },
    })
    const preview = await previewLessonTemplateMove({ db: db as any }, {
      templateId: 'tpl-1',
      sourceOrgId: 'org-source',
      targetOrgId: 'org-target',
    })

    expect(preview.canMove).toBe(true)
    expect(preview.materialCount).toBe(1)
    expect(preview.legacyMaterialCount).toBe(0)
  })

  it('rejects preview if sourceOrgId === targetOrgId', async () => {
    const db = createFakeDb({
      'lessonTemplates/tpl-1': { orgId: 'org-source' },
    })
    await expect(previewLessonTemplateMove({ db: db as any }, {
      templateId: 'tpl-1',
      sourceOrgId: 'org-source',
      targetOrgId: 'org-source',
    })).rejects.toThrow('異なる組織を指定してください。')
  })
})

describe('createLessonTemplateMoveOperation', () => {
  it('creates PENDING operation, sets template moveOperationId, and records audit in same transaction', async () => {
    const db = createFakeDb({
      'lessonTemplates/tpl-1': { orgId: 'org-source', title: '秘密教材', visibility: 'COMMUNITY' },
      'lessonTemplates/tpl-1/versions/v1': { orgId: 'org-source' },
      'lessonTemplates/tpl-1/materials/mat-1': {
        fileName: 'doc.pdf',
        storagePath: 'orgs/org-source/materials/tpl-1/s-1/doc.pdf',
      },
    })

    const result = await createLessonTemplateMoveOperation({
      db: db as any,
      now: () => '2026-08-15T12:00:00.000Z',
    }, {
      templateId: 'tpl-1',
      sourceOrgId: 'org-source',
      targetOrgId: 'org-target',
      requestedByUid: 'owner-uid',
      reason: '転籍に伴う所有権移転',
      idempotencyKey: 'idem-key-1',
    })

    expect(result.alreadyRequested).toBe(false)
    expect(result.operation.status).toBe('PENDING')
    expect(result.operation.phase).toBe('STAGING_MATERIALS')
    expect(result.operation.templateId).toBe('tpl-1')

    // Template locked with moveOperationId
    const tpl = db.store.get('lessonTemplates/tpl-1')!
    expect(tpl.moveOperationId).toBe(result.operation.id)

    // Audit logs recorded without secret text/filename/storagePath
    const sourceAudits = Array.from(db.store.entries()).filter(([k]) => k.startsWith('organizations/org-source/auditLog/'))
    const targetAudits = Array.from(db.store.entries()).filter(([k]) => k.startsWith('organizations/org-target/auditLog/'))
    expect(sourceAudits.length).toBe(1)
    expect(targetAudits.length).toBe(1)

    const auditPayload = sourceAudits[0][1]
    expect(auditPayload).toMatchObject({
      action: 'REQUEST_MOVE_LESSON_TEMPLATE',
      result: 'SUCCESS',
      reason: '転籍に伴う所有権移転',
    })
    expect(JSON.stringify(auditPayload)).not.toContain('秘密教材')
    expect(JSON.stringify(auditPayload)).not.toContain('doc.pdf')
    expect(JSON.stringify(auditPayload)).not.toContain('orgs/org-source')
  })

  it('replays same operation for identical idempotency key and payload', async () => {
    const db = createFakeDb({
      'lessonTemplates/tpl-1': { orgId: 'org-source' },
    })

    const input = {
      templateId: 'tpl-1',
      sourceOrgId: 'org-source',
      targetOrgId: 'org-target',
      requestedByUid: 'owner-uid',
      reason: '転籍に伴う所有権移転',
      idempotencyKey: 'idem-key-1',
    }

    const first = await createLessonTemplateMoveOperation({ db: db as any }, input)
    const second = await createLessonTemplateMoveOperation({ db: db as any }, input)

    expect(second.alreadyRequested).toBe(true)
    expect(second.operation.id).toBe(first.operation.id)
  })

  it('throws failed-precondition on idempotency key payload mismatch', async () => {
    const db = createFakeDb({
      'lessonTemplates/tpl-1': { orgId: 'org-source' },
    })

    await createLessonTemplateMoveOperation({ db: db as any }, {
      templateId: 'tpl-1',
      sourceOrgId: 'org-source',
      targetOrgId: 'org-target',
      requestedByUid: 'owner-uid',
      reason: '転籍に伴う所有権移転',
      idempotencyKey: 'idem-key-1',
    })

    await expect(createLessonTemplateMoveOperation({ db: db as any }, {
      templateId: 'tpl-1',
      sourceOrgId: 'org-source',
      targetOrgId: 'org-target',
      requestedByUid: 'owner-uid',
      reason: '別の理由に変更',
      idempotencyKey: 'idem-key-1',
    })).rejects.toThrow('Idempotency key payload mismatch')
  })
})

describe('runLessonTemplateMoveOperation', () => {
  it('executes full move workflow through all phases to completion', async () => {
    const rawPath = 'orgs/org-source/materials/tpl-1/s-1/guide.pdf'
    const storage = createFakeStorage([rawPath])
    const db = createFakeDb({
      'lessonTemplates/tpl-1': {
        orgId: 'org-source',
        createdByUid: 'creator-uid',
        createdAt: '2026-01-01T00:00:00.000Z',
        title: '教材タイトル',
        visibility: 'COMMUNITY',
        publishedToCommunityAt: '2026-02-01T00:00:00.000Z',
        approvalStatus: 'APPROVED',
        reviewedByUid: 'approver-uid',
        reviewedAt: '2026-02-01T00:00:00.000Z',
        sourceTemplateId: 'orig-tmpl',
        sourceVersionId: 'orig-v1',
      },
      'lessonTemplates/tpl-1/versions/v1': {
        orgId: 'org-source',
        content: { title: 'v1' },
      },
      'lessonTemplates/tpl-1/materials/mat-1': {
        fileName: 'guide.pdf',
        storagePath: rawPath,
      },
      'lessonRuns/run-old': {
        orgId: 'org-source',
        templateId: 'tpl-1',
      },
      'templateReviews/rev-1': {
        templateId: 'tpl-1',
        rating: 5,
      },
    })

    const opResult = await createLessonTemplateMoveOperation({ db: db as any }, {
      templateId: 'tpl-1',
      sourceOrgId: 'org-source',
      targetOrgId: 'org-target',
      requestedByUid: 'owner-uid',
      reason: '組織移転',
      idempotencyKey: 'key-full-run',
    })

    const deps: LessonTemplateMoveDeps = {
      db: db as any,
      storage: storage as any,
      now: () => '2026-08-15T12:00:00.000Z',
    }

    const runResult = await runLessonTemplateMoveOperation(deps, opResult.operation.id)
    expect(runResult.status).toBe('COMPLETED')

    // 1. Same template ID retained
    const tpl = db.store.get('lessonTemplates/tpl-1')!
    expect(tpl.orgId).toBe('org-target')
    expect(tpl.createdByUid).toBe('creator-uid')
    expect(tpl.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(tpl.sourceTemplateId).toBe('orig-tmpl')
    expect(tpl.sourceVersionId).toBe('orig-v1')
    expect(tpl.visibility).toBe('PRIVATE')
    expect(tpl.publishedToCommunityAt).toBeNull()
    expect(tpl.approvalStatus).toBe('PENDING')
    expect(tpl.reviewedByUid).toBeNull()
    expect(tpl.reviewedAt).toBeNull()
    expect(tpl.moveOperationId).toBeUndefined() // Lock cleared on complete

    // 2. Version orgId updated
    const version = db.store.get('lessonTemplates/tpl-1/versions/v1')!
    expect(version.orgId).toBe('org-target')

    // 3. Material storagePath updated
    const mat = db.store.get('lessonTemplates/tpl-1/materials/mat-1')!
    const targetRawPath = 'orgs/org-target/materials/tpl-1/s-1/guide.pdf'
    expect(mat.storagePath).toBe(targetRawPath)

    // 4. Storage object transferred and clean
    expect(storage.objects.has(targetRawPath)).toBe(true)
    expect(storage.objects.has(rawPath)).toBe(false)
    expect(Array.from(storage.objects).some((o) => o.startsWith('templateMoveStaging/'))).toBe(false)

    // 5. Historical lesson runs and reviews untouched
    const run = db.store.get('lessonRuns/run-old')!
    expect(run.orgId).toBe('org-source')
    const rev = db.store.get('templateReviews/rev-1')!
    expect(rev.templateId).toBe('tpl-1')

    // 6. Audit recorded on commit
    const sourceCommitAudit = Array.from(db.store.entries()).find(([k, v]) => k.startsWith('organizations/org-source/auditLog/') && (v as any).action === 'MOVE_LESSON_TEMPLATE_OUT')
    const targetCommitAudit = Array.from(db.store.entries()).find(([k, v]) => k.startsWith('organizations/org-target/auditLog/') && (v as any).action === 'MOVE_LESSON_TEMPLATE_IN')
    expect(sourceCommitAudit).toBeDefined()
    expect(targetCommitAudit).toBeDefined()
  })

  it('resumes from failure without duplicating storage operations or resetting ownership commit', async () => {
    const rawPath = 'orgs/org-source/materials/tpl-1/s-1/guide.pdf'
    const storage = createFakeStorage([rawPath])
    const db = createFakeDb({
      'lessonTemplates/tpl-1': {
        orgId: 'org-source',
        createdByUid: 'creator-uid',
      },
      'lessonTemplates/tpl-1/versions/v1': {
        orgId: 'org-source',
      },
      'lessonTemplates/tpl-1/materials/mat-1': {
        fileName: 'guide.pdf',
        storagePath: rawPath,
      },
    })

    const opResult = await createLessonTemplateMoveOperation({ db: db as any }, {
      templateId: 'tpl-1',
      sourceOrgId: 'org-source',
      targetOrgId: 'org-target',
      requestedByUid: 'owner-uid',
      reason: '再試行テスト',
      idempotencyKey: 'key-retry',
    })

    // Simulate failure during FINALIZING_MATERIALS
    let copyCount = 0
    const originalCopy = storage.copy.bind(storage)
    storage.copy = async (src, dest) => {
      copyCount++
      if (dest.startsWith('orgs/org-target') && copyCount === 2) {
        throw new Error('Simulated Storage Network Error')
      }
      return originalCopy(src, dest)
    }

    const deps: LessonTemplateMoveDeps = {
      db: db as any,
      storage: storage as any,
    }

    const firstRun = await runLessonTemplateMoveOperation(deps, opResult.operation.id)
    expect(firstRun.status).toBe('FAILED')

    // Template ownership committed, lock remains
    const opSnap = db.store.get(`lessonTemplateMoveOperations/${opResult.operation.id}`)!
    expect(opSnap.status).toBe('FAILED')
    expect(opSnap.phase).toBe('FINALIZING_MATERIALS')
    const tplDuringFail = db.store.get('lessonTemplates/tpl-1')!
    expect(tplDuringFail.orgId).toBe('org-target')
    expect(tplDuringFail.moveOperationId).toBe(opResult.operation.id)

    // Restore normal storage behavior and retry
    storage.copy = originalCopy
    const retryRun = await runLessonTemplateMoveOperation(deps, opResult.operation.id)
    expect(retryRun.status).toBe('COMPLETED')

    const tplDone = db.store.get('lessonTemplates/tpl-1')!
    expect(tplDone.orgId).toBe('org-target')
    expect(tplDone.moveOperationId).toBeUndefined()
  })

  it('fails if version belongs to unexpected third organization', async () => {
    const db = createFakeDb({
      'lessonTemplates/tpl-1': { orgId: 'org-source' },
      'lessonTemplates/tpl-1/versions/v-rogue': { orgId: 'org-rogue-third-party' },
    })

    const opResult = await createLessonTemplateMoveOperation({ db: db as any }, {
      templateId: 'tpl-1',
      sourceOrgId: 'org-source',
      targetOrgId: 'org-target',
      requestedByUid: 'owner-uid',
      reason: '不正テスト',
      idempotencyKey: 'key-rogue',
    })

    const deps: LessonTemplateMoveDeps = {
      db: db as any,
      storage: createFakeStorage() as any,
    }

    const res = await runLessonTemplateMoveOperation(deps, opResult.operation.id)
    expect(res.status).toBe('FAILED')
    const op = db.store.get(`lessonTemplateMoveOperations/${opResult.operation.id}`)!
    expect(op.lastError).toContain('unexpected third organization')
  })

  it('fails finalization instead of rewriting storagePath when the raw object is missing at source, staging, and target', async () => {
    const rawPath = 'orgs/org-source/materials/tpl-1/s-1/guide.pdf'
    // storage has no objects at all: the material doc claims a storagePath, but the
    // underlying file was already lost (e.g. deleted out-of-band before the move ran).
    const storage = createFakeStorage([])
    const db = createFakeDb({
      'lessonTemplates/tpl-1': { orgId: 'org-source', createdByUid: 'creator-uid' },
      'lessonTemplates/tpl-1/versions/v1': { orgId: 'org-source' },
      'lessonTemplates/tpl-1/materials/mat-1': { fileName: 'guide.pdf', storagePath: rawPath },
    })

    const opResult = await createLessonTemplateMoveOperation({ db: db as any }, {
      templateId: 'tpl-1',
      sourceOrgId: 'org-source',
      targetOrgId: 'org-target',
      requestedByUid: 'owner-uid',
      reason: '欠損オブジェクトのテスト',
      idempotencyKey: 'key-missing-object',
    })

    const deps: LessonTemplateMoveDeps = {
      db: db as any,
      storage: storage as any,
      now: () => '2026-08-15T12:00:00.000Z',
    }

    const res = await runLessonTemplateMoveOperation(deps, opResult.operation.id)
    expect(res.status).toBe('FAILED')
    const op = db.store.get(`lessonTemplateMoveOperations/${opResult.operation.id}`)!
    expect(op.lastError).toContain('missing at source, staging, and target')

    // The Firestore pointer must NOT be silently rewritten to a target path that has no backing object.
    const mat = db.store.get('lessonTemplates/tpl-1/materials/mat-1')!
    expect(mat.storagePath).toBe(rawPath)
  })
})
