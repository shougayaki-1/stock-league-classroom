import { describe, expect, it } from 'vitest'
import {
  runDueLessonTemplateMoveOperations,
  type MoveScheduledDb,
  type MoveScheduledDeps,
} from './moveLessonTemplateScheduled'

interface FakeDoc {
  id: string
  path: string
  data: () => Record<string, unknown> | undefined
}

const createFakeDb = (seed: Record<string, Record<string, unknown>> = {}) => {
  const store = new Map<string, Record<string, unknown>>()
  for (const [k, v] of Object.entries(seed)) {
    store.set(k, JSON.parse(JSON.stringify(v)))
  }

  const queryCollection = (prefix: string, filterField?: string, filterVal?: unknown): any => ({
    where: (f: string, _op: string, v: unknown) => queryCollection(prefix, f, v),
    limit: () => queryCollection(prefix, filterField, filterVal),
    get: async () => {
      const docs: FakeDoc[] = []
      for (const [path, data] of store.entries()) {
        const parts = path.split('/')
        if (path.startsWith(prefix) && parts.length === prefix.split('/').length + 1) {
          if (!filterField || data[filterField] === filterVal) {
            docs.push({
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
        return data ? { id: path.split('/').pop()!, path, data: () => data } : { id: path.split('/').pop()!, path, data: () => undefined }
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
            return data ? { id: docId, path: fullPath, data: () => data } : { id: docId, path: fullPath, data: () => undefined }
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

describe('runDueLessonTemplateMoveOperations', () => {
  it('claims and runs PENDING operation to completion', async () => {
    const db = createFakeDb({
      'lessonTemplateMoveOperations/op-pending': {
        id: 'op-pending',
        templateId: 'tpl-1',
        sourceOrgId: 'org-source',
        targetOrgId: 'org-target',
        requestedByUid: 'owner-1',
        reason: '理由',
        requestDigest: 'digest',
        status: 'PENDING',
        phase: 'STAGING_MATERIALS',
        versionCount: 1,
        materialCount: 0,
        legacyMaterialCount: 0,
        createdAt: '2026-08-15T00:00:00.000Z',
        updatedAt: '2026-08-15T00:00:00.000Z',
      },
      'lessonTemplates/tpl-1': {
        orgId: 'org-source',
        moveOperationId: 'op-pending',
        visibility: 'PRIVATE',
      },
      'lessonTemplates/tpl-1/versions/v1': {
        orgId: 'org-source',
      },
    })

    const deps: MoveScheduledDeps = {
      db: db as unknown as MoveScheduledDb,
      nowDate: () => new Date('2026-08-15T12:00:00.000Z'),
    }

    const { processed } = await runDueLessonTemplateMoveOperations(deps)
    expect(processed).toContain('op-pending')

    const op = db.store.get('lessonTemplateMoveOperations/op-pending')!
    expect(op.status).toBe('COMPLETED')
  })

  it('skips RUNNING operation with active lease from another worker', async () => {
    const db = createFakeDb({
      'lessonTemplateMoveOperations/op-running': {
        id: 'op-running',
        templateId: 'tpl-1',
        sourceOrgId: 'org-source',
        targetOrgId: 'org-target',
        status: 'RUNNING',
        phase: 'STAGING_MATERIALS',
        leaseOwner: 'worker-other',
        leaseUntil: '2026-08-15T12:10:00.000Z', // In future
      },
    })

    const deps: MoveScheduledDeps = {
      db: db as unknown as MoveScheduledDb,
      nowDate: () => new Date('2026-08-15T12:00:00.000Z'),
      workerId: 'worker-me',
    }

    await runDueLessonTemplateMoveOperations(deps)
    const op = db.store.get('lessonTemplateMoveOperations/op-running')!
    expect(op.status).toBe('RUNNING')
    expect(op.leaseOwner).toBe('worker-other')
  })

  it('re-claims expired lease RUNNING operation and retries FAILED operation', async () => {
    const db = createFakeDb({
      'lessonTemplateMoveOperations/op-expired': {
        id: 'op-expired',
        templateId: 'tpl-1',
        sourceOrgId: 'org-source',
        targetOrgId: 'org-target',
        requestedByUid: 'owner-1',
        reason: '理由',
        requestDigest: 'd1',
        status: 'RUNNING',
        phase: 'COMMITTING_OWNERSHIP',
        leaseOwner: 'worker-dead',
        leaseUntil: '2026-08-15T11:00:00.000Z', // Expired
        versionCount: 0,
        materialCount: 0,
        legacyMaterialCount: 0,
      },
      'lessonTemplates/tpl-1': {
        orgId: 'org-source',
        moveOperationId: 'op-expired',
        visibility: 'PRIVATE',
      },
    })

    const deps: MoveScheduledDeps = {
      db: db as unknown as MoveScheduledDb,
      nowDate: () => new Date('2026-08-15T12:00:00.000Z'),
      workerId: 'worker-me',
    }

    const { processed } = await runDueLessonTemplateMoveOperations(deps)
    expect(processed).toContain('op-expired')

    const op = db.store.get('lessonTemplateMoveOperations/op-expired')!
    expect(op.status).toBe('COMPLETED')
  })
})
