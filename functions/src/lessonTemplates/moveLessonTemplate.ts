import { createHash } from 'node:crypto'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { recordAuditLogInTransaction } from '../privacy/auditLog'

export type LessonTemplateMoveStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'FAILED'
  | 'COMPLETED'

export type LessonTemplateMovePhase =
  | 'STAGING_MATERIALS'
  | 'MIGRATING_VERSIONS'
  | 'COMMITTING_OWNERSHIP'
  | 'FINALIZING_MATERIALS'
  | 'FINALIZING_FIRESTORE'

export interface LessonTemplateMoveOperation {
  id: string
  templateId: string
  sourceOrgId: string
  targetOrgId: string
  requestedByUid: string
  reason: string
  requestDigest: string
  status: LessonTemplateMoveStatus
  phase: LessonTemplateMovePhase
  versionCount: number
  materialCount: number
  legacyMaterialCount: number
  createdAt: unknown
  updatedAt: unknown
  completedAt?: unknown
  lastError?: string | null
  leaseOwner?: string | null
  leaseUntil?: unknown
}

export interface LessonTemplateMovePreview {
  templateId: string
  sourceOrgId: string
  targetOrgId: string
  versionCount: number
  materialCount: number
  legacyMaterialCount: number
  canMove: boolean
  willUnpublishCommunity: boolean
  willResetApproval: true
  historicalLessonRunsRemain: true
}

export interface MoveDbDocSnap {
  exists: boolean
  id: string
  path: string
  data: () => Record<string, unknown> | undefined
}

export interface MoveDbQuery {
  where: (field: string, op: string, val: unknown) => MoveDbQuery
  limit?: (n: number) => MoveDbQuery
  get: () => Promise<{ empty: boolean; docs: MoveDbDocSnap[] }>
}

export interface MoveDbTx {
  get: (pathOrRef: string | { path: string }) => Promise<MoveDbDocSnap>
  set: (pathOrRef: string | { path: string }, data: Record<string, unknown>) => void
  update?: (pathOrRef: string | { path: string }, updates: Record<string, unknown>) => void
}

export interface MoveDb {
  doc: (path: string) => { id: string; path: string; get: () => Promise<MoveDbDocSnap>; set: (data: Record<string, unknown>) => Promise<void> }
  collection: (path: string) => {
    doc: (id?: string) => { id: string; path: string; get: () => Promise<MoveDbDocSnap>; set: (data: Record<string, unknown>) => Promise<void> }
    where: (field: string, op: string, val: unknown) => MoveDbQuery
    get: () => Promise<{ empty: boolean; docs: MoveDbDocSnap[] }>
  }
  runTransaction: <T>(fn: (tx: MoveDbTx) => Promise<T>) => Promise<T>
}

export interface MoveStorage {
  exists: (path: string) => Promise<boolean>
  copy: (srcPath: string, destPath: string) => Promise<void>
  delete: (path: string) => Promise<void>
  listPrefix?: (prefix: string) => Promise<string[]>
}

export interface LessonTemplateMoveDeps {
  db: MoveDb
  storage?: MoveStorage
  now?: () => string
  nowDate?: () => Date
}

export const sha256Hex = (value: string): string =>
  createHash('sha256').update(value).digest('hex')

export const computeRequestDigest = (payload: {
  templateId: string
  sourceOrgId: string
  targetOrgId: string
  requestedByUid: string
  reason: string
}): string => {
  return sha256Hex(JSON.stringify({
    templateId: payload.templateId,
    sourceOrgId: payload.sourceOrgId,
    targetOrgId: payload.targetOrgId,
    requestedByUid: payload.requestedByUid,
    reason: payload.reason.trim(),
  }))
}

export interface PreviewLessonTemplateMoveInput {
  templateId: string
  sourceOrgId: string
  targetOrgId: string
}

export const previewLessonTemplateMove = async (
  deps: LessonTemplateMoveDeps,
  input: PreviewLessonTemplateMoveInput,
): Promise<LessonTemplateMovePreview> => {
  if (input.sourceOrgId === input.targetOrgId) {
    throw new Error('異なる組織を指定してください。')
  }

  const templateSnap = await deps.db.doc(`lessonTemplates/${input.templateId}`).get()
  if (!templateSnap.exists) {
    throw new Error('Lesson template not found')
  }
  const templateData = templateSnap.data() as { orgId: string; visibility?: string; moveOperationId?: string }
  if (templateData.orgId !== input.sourceOrgId) {
    throw new Error('Lesson template does not belong to the source organization')
  }

  // Count versions
  const versionsSnap = await deps.db.collection(`lessonTemplates/${input.templateId}/versions`).get()
  const versionCount = versionsSnap.docs.length

  // Inspect materials
  const materialsSnap = await deps.db.collection(`lessonTemplates/${input.templateId}/materials`).get()
  const materialCount = materialsSnap.docs.length
  let legacyMaterialCount = 0

  const expectedPrefix = `orgs/${input.sourceOrgId}/materials/${input.templateId}/`
  for (const doc of materialsSnap.docs) {
    const data = doc.data() as { storagePath?: string }
    if (!data.storagePath || !data.storagePath.startsWith(expectedPrefix)) {
      legacyMaterialCount++
    }
  }

  const canMove = legacyMaterialCount === 0 && !templateData.moveOperationId

  return {
    templateId: input.templateId,
    sourceOrgId: input.sourceOrgId,
    targetOrgId: input.targetOrgId,
    versionCount,
    materialCount,
    legacyMaterialCount,
    canMove,
    willUnpublishCommunity: templateData.visibility === 'COMMUNITY',
    willResetApproval: true,
    historicalLessonRunsRemain: true,
  }
}

export interface CreateLessonTemplateMoveOperationInput {
  templateId: string
  sourceOrgId: string
  targetOrgId: string
  requestedByUid: string
  reason: string
  idempotencyKey: string
}

export const createLessonTemplateMoveOperation = async (
  deps: LessonTemplateMoveDeps,
  input: CreateLessonTemplateMoveOperationInput,
): Promise<{ operation: LessonTemplateMoveOperation; alreadyRequested: boolean }> => {
  if (input.sourceOrgId === input.targetOrgId) {
    throw new Error('異なる組織を指定してください。')
  }
  const trimmedReason = input.reason.trim()
  if (trimmedReason.length === 0 || trimmedReason.length > 500) {
    throw new Error('理由は1文字以上500文字以下で入力してください。')
  }

  const operationId = sha256Hex(`move:${input.idempotencyKey}`).slice(0, 32)
  const operationPath = `lessonTemplateMoveOperations/${operationId}`
  const requestDigest = computeRequestDigest({
    templateId: input.templateId,
    sourceOrgId: input.sourceOrgId,
    targetOrgId: input.targetOrgId,
    requestedByUid: input.requestedByUid,
    reason: trimmedReason,
  })

  const nowIso = deps.now ? deps.now() : new Date().toISOString()

  return deps.db.runTransaction(async (tx) => {
    const opSnap = await tx.get(operationPath)
    if (opSnap.exists) {
      const existingOp = opSnap.data() as unknown as LessonTemplateMoveOperation
      if (existingOp.requestDigest === requestDigest) {
        return { operation: existingOp, alreadyRequested: true }
      }
      throw new Error('Idempotency key payload mismatch')
    }

    const templatePath = `lessonTemplates/${input.templateId}`
    const templateSnap = await tx.get(templatePath)
    if (!templateSnap.exists) {
      throw new Error('Lesson template not found')
    }
    const templateData = templateSnap.data() as { orgId: string; moveOperationId?: string }
    if (templateData.orgId !== input.sourceOrgId) {
      throw new Error('Lesson template does not belong to the source organization')
    }
    if (templateData.moveOperationId) {
      throw new Error('Lesson template is currently being moved')
    }

    // Check preview blockers
    const versionsSnap = await deps.db.collection(`lessonTemplates/${input.templateId}/versions`).get()
    const materialsSnap = await deps.db.collection(`lessonTemplates/${input.templateId}/materials`).get()
    const expectedPrefix = `orgs/${input.sourceOrgId}/materials/${input.templateId}/`
    let legacyCount = 0
    for (const doc of materialsSnap.docs) {
      const data = doc.data() as { storagePath?: string }
      if (!data.storagePath || !data.storagePath.startsWith(expectedPrefix)) {
        legacyCount++
      }
    }
    if (legacyCount > 0) {
      throw new Error('Legacy untracked materials cannot be transferred')
    }

    const operation: LessonTemplateMoveOperation = {
      id: operationId,
      templateId: input.templateId,
      sourceOrgId: input.sourceOrgId,
      targetOrgId: input.targetOrgId,
      requestedByUid: input.requestedByUid,
      reason: trimmedReason,
      requestDigest,
      status: 'PENDING',
      phase: 'STAGING_MATERIALS',
      versionCount: versionsSnap.docs.length,
      materialCount: materialsSnap.docs.length,
      legacyMaterialCount: legacyCount,
      createdAt: nowIso,
      updatedAt: nowIso,
    }

    // Set operation doc
    tx.set(operationPath, operation as unknown as Record<string, unknown>)

    // Lock template
    tx.set(templatePath, {
      ...templateData,
      moveOperationId: operationId,
      updatedAt: nowIso,
    })

    // Record source & target audit
    recordAuditLogInTransaction(tx, deps.db as never, {
      orgId: input.sourceOrgId,
      actorUid: input.requestedByUid,
      action: 'REQUEST_MOVE_LESSON_TEMPLATE',
      result: 'SUCCESS',
      reason: trimmedReason,
      after: {
        operationId,
        templateId: input.templateId,
        targetOrgId: input.targetOrgId,
      },
    })
    recordAuditLogInTransaction(tx, deps.db as never, {
      orgId: input.targetOrgId,
      actorUid: input.requestedByUid,
      action: 'REQUEST_MOVE_LESSON_TEMPLATE',
      result: 'SUCCESS',
      reason: trimmedReason,
      after: {
        operationId,
        templateId: input.templateId,
        sourceOrgId: input.sourceOrgId,
      },
    })

    return { operation, alreadyRequested: false }
  })
}

export const LEASE_DURATION_MS = 5 * 60 * 1000

export const runLessonTemplateMoveOperation = async (
  deps: LessonTemplateMoveDeps,
  operationId: string,
  workerId?: string,
): Promise<{ status: LessonTemplateMoveStatus; phase: LessonTemplateMovePhase }> => {
  const now = deps.nowDate ? deps.nowDate() : new Date()
  const nowIso = deps.now ? deps.now() : now.toISOString()
  const effectiveWorkerId = workerId ?? `worker-${Math.random().toString(36).slice(2)}`
  const leaseUntilIso = new Date(now.getTime() + LEASE_DURATION_MS).toISOString()

  // 1. Acquire Lease & Transition to RUNNING
  const opPath = `lessonTemplateMoveOperations/${operationId}`
  const acquired = await deps.db.runTransaction(async (tx) => {
    const snap = await tx.get(opPath)
    if (!snap.exists) throw new Error('Operation not found')
    const op = snap.data() as unknown as LessonTemplateMoveOperation
    if (op.status === 'COMPLETED') {
      return { op, alreadyDone: true }
    }

    const isLeaseActive = op.leaseUntil && new Date(op.leaseUntil as string).getTime() > now.getTime() && op.leaseOwner !== effectiveWorkerId
    if (op.status === 'RUNNING' && isLeaseActive) {
      return null // busy by another worker
    }

    const updated: LessonTemplateMoveOperation = {
      ...op,
      status: 'RUNNING',
      leaseOwner: effectiveWorkerId,
      leaseUntil: leaseUntilIso,
      updatedAt: nowIso,
    }
    tx.set(opPath, updated as unknown as Record<string, unknown>)
    return { op: updated, alreadyDone: false }
  })

  if (!acquired) {
    return { status: 'RUNNING', phase: 'STAGING_MATERIALS' }
  }
  if (acquired.alreadyDone) {
    return { status: 'COMPLETED', phase: 'FINALIZING_FIRESTORE' }
  }

  let op = acquired.op
  const templateId = op.templateId
  const sourceOrgId = op.sourceOrgId
  const targetOrgId = op.targetOrgId

  try {
    // -------------------------------------------------------------
    // Phase 1: STAGING_MATERIALS
    // -------------------------------------------------------------
    if (op.phase === 'STAGING_MATERIALS') {
      if (deps.storage) {
        const materialsSnap = await deps.db.collection(`lessonTemplates/${templateId}/materials`).get()
        const expectedPrefix = `orgs/${sourceOrgId}/materials/${templateId}/`
        for (const doc of materialsSnap.docs) {
          const matData = doc.data() as { storagePath: string }
          if (!matData.storagePath || !matData.storagePath.startsWith(expectedPrefix)) {
            throw new Error(`Untracked or invalid material storagePath: ${matData.storagePath}`)
          }
          const relativeSuffix = matData.storagePath.slice(expectedPrefix.length)
          const stagingPath = `templateMoveStaging/${operationId}/${relativeSuffix}`

          const existsInStaging = await deps.storage.exists(stagingPath)
          if (!existsInStaging) {
            const existsInSource = await deps.storage.exists(matData.storagePath)
            if (existsInSource) {
              await deps.storage.copy(matData.storagePath, stagingPath)
            }
          }
        }
      }

      await deps.db.runTransaction(async (tx) => {
        const curSnap = await tx.get(opPath)
        const curOp = curSnap.data() as unknown as LessonTemplateMoveOperation
        tx.set(opPath, { ...curOp, phase: 'MIGRATING_VERSIONS', updatedAt: nowIso } as unknown as Record<string, unknown>)
      })
      op.phase = 'MIGRATING_VERSIONS'
    }

    // -------------------------------------------------------------
    // Phase 2: MIGRATING_VERSIONS
    // -------------------------------------------------------------
    if (op.phase === 'MIGRATING_VERSIONS') {
      const versionsSnap = await deps.db.collection(`lessonTemplates/${templateId}/versions`).get()
      for (const vDoc of versionsSnap.docs) {
        await deps.db.runTransaction(async (tx) => {
          const snap = await tx.get(vDoc.path)
          if (!snap.exists) return
          const vData = snap.data() as { orgId: string }
          if (vData.orgId === targetOrgId) {
            // already migrated
            return
          }
          if (vData.orgId !== sourceOrgId) {
            throw new Error(`Version ${vDoc.id} belongs to unexpected third organization: ${vData.orgId}`)
          }
          tx.set(vDoc.path, { ...vData, orgId: targetOrgId })
        })
      }

      await deps.db.runTransaction(async (tx) => {
        const curSnap = await tx.get(opPath)
        const curOp = curSnap.data() as unknown as LessonTemplateMoveOperation
        tx.set(opPath, { ...curOp, phase: 'COMMITTING_OWNERSHIP', updatedAt: nowIso } as unknown as Record<string, unknown>)
      })
      op.phase = 'COMMITTING_OWNERSHIP'
    }

    // -------------------------------------------------------------
    // Phase 3: COMMITTING_OWNERSHIP
    // -------------------------------------------------------------
    if (op.phase === 'COMMITTING_OWNERSHIP') {
      await deps.db.runTransaction(async (tx) => {
        const tplPath = `lessonTemplates/${templateId}`
        const tplSnap = await tx.get(tplPath)
        if (!tplSnap.exists) throw new Error('Lesson template not found')
        const tplData = tplSnap.data() as Record<string, unknown>

        if (tplData.orgId === targetOrgId) {
          // already committed
        } else {
          if (tplData.orgId !== sourceOrgId) {
            throw new Error(`Template belongs to unexpected organization: ${String(tplData.orgId)}`)
          }
          if (tplData.moveOperationId !== operationId) {
            throw new Error('Template lock mismatch')
          }

          const updatedTemplate = {
            ...tplData,
            orgId: targetOrgId,
            visibility: 'PRIVATE',
            publishedToCommunityAt: null,
            approvalStatus: 'PENDING',
            reviewedByUid: null,
            reviewedAt: null,
            updatedAt: nowIso,
          }
          tx.set(tplPath, updatedTemplate)

          // Record audit entries
          recordAuditLogInTransaction(tx, deps.db as never, {
            orgId: sourceOrgId,
            actorUid: op.requestedByUid,
            action: 'MOVE_LESSON_TEMPLATE_OUT',
            result: 'SUCCESS',
            reason: op.reason,
            after: {
              templateId,
              targetOrgId,
            },
          })
          recordAuditLogInTransaction(tx, deps.db as never, {
            orgId: targetOrgId,
            actorUid: op.requestedByUid,
            action: 'MOVE_LESSON_TEMPLATE_IN',
            result: 'SUCCESS',
            reason: op.reason,
            after: {
              templateId,
              sourceOrgId,
            },
          })
        }

        const curSnap = await tx.get(opPath)
        const curOp = curSnap.data() as unknown as LessonTemplateMoveOperation
        tx.set(opPath, { ...curOp, phase: 'FINALIZING_MATERIALS', updatedAt: nowIso } as unknown as Record<string, unknown>)
      })
      op.phase = 'FINALIZING_MATERIALS'
    }

    // -------------------------------------------------------------
    // Phase 4: FINALIZING_MATERIALS
    // -------------------------------------------------------------
    if (op.phase === 'FINALIZING_MATERIALS') {
      const materialsSnap = await deps.db.collection(`lessonTemplates/${templateId}/materials`).get()
      const expectedSourcePrefix = `orgs/${sourceOrgId}/materials/${templateId}/`
      const expectedTargetPrefix = `orgs/${targetOrgId}/materials/${templateId}/`

      for (const doc of materialsSnap.docs) {
        const matData = doc.data() as { storagePath: string }
        let relativeSuffix = ''
        let sourceRawPath = ''

        if (matData.storagePath.startsWith(expectedTargetPrefix)) {
          relativeSuffix = matData.storagePath.slice(expectedTargetPrefix.length)
          sourceRawPath = `${expectedSourcePrefix}${relativeSuffix}`
        } else if (matData.storagePath.startsWith(expectedSourcePrefix)) {
          relativeSuffix = matData.storagePath.slice(expectedSourcePrefix.length)
          sourceRawPath = matData.storagePath
        } else {
          throw new Error(`Invalid storagePath during finalization: ${matData.storagePath}`)
        }

        const targetRawPath = `${expectedTargetPrefix}${relativeSuffix}`
        const stagingPath = `templateMoveStaging/${operationId}/${relativeSuffix}`

        if (deps.storage) {
          const targetExists = await deps.storage.exists(targetRawPath)
          if (!targetExists) {
            const stagingExists = await deps.storage.exists(stagingPath)
            if (stagingExists) {
              await deps.storage.copy(stagingPath, targetRawPath)
            } else {
              const srcExists = await deps.storage.exists(sourceRawPath)
              if (srcExists) {
                await deps.storage.copy(sourceRawPath, targetRawPath)
              }
            }
          }

          // Verify target exists before removing source and staging
          const targetConfirmed = await deps.storage.exists(targetRawPath)
          if (targetConfirmed) {
            if (await deps.storage.exists(sourceRawPath)) {
              await deps.storage.delete(sourceRawPath)
            }
            if (await deps.storage.exists(stagingPath)) {
              await deps.storage.delete(stagingPath)
            }
          }
        }

        // Update Firestore material document storagePath to target
        if (matData.storagePath !== targetRawPath) {
          await deps.db.runTransaction(async (tx) => {
            const mSnap = await tx.get(doc.path)
            if (mSnap.exists) {
              tx.set(doc.path, { ...(mSnap.data() as object), storagePath: targetRawPath })
            }
          })
        }
      }

      await deps.db.runTransaction(async (tx) => {
        const curSnap = await tx.get(opPath)
        const curOp = curSnap.data() as unknown as LessonTemplateMoveOperation
        tx.set(opPath, { ...curOp, phase: 'FINALIZING_FIRESTORE', updatedAt: nowIso } as unknown as Record<string, unknown>)
      })
      op.phase = 'FINALIZING_FIRESTORE'
    }

    // -------------------------------------------------------------
    // Phase 5: FINALIZING_FIRESTORE (Completion)
    // -------------------------------------------------------------
    if (op.phase === 'FINALIZING_FIRESTORE') {
      await deps.db.runTransaction(async (tx) => {
        const tplPath = `lessonTemplates/${templateId}`
        const tplSnap = await tx.get(tplPath)
        if (tplSnap.exists) {
          const tplData = tplSnap.data() as Record<string, unknown>
          if (tx.update) {
            tx.update(tplPath, { moveOperationId: '__DELETE__' })
          } else {
            const updated = { ...tplData }
            delete updated.moveOperationId
            tx.set(tplPath, updated)
          }
        }

        const curSnap = await tx.get(opPath)
        const curOp = curSnap.data() as unknown as LessonTemplateMoveOperation
        const completedOp: LessonTemplateMoveOperation = {
          ...curOp,
          status: 'COMPLETED',
          completedAt: nowIso,
          leaseOwner: null,
          leaseUntil: null,
          updatedAt: nowIso,
        }
        tx.set(opPath, completedOp as unknown as Record<string, unknown>)
      })

      return { status: 'COMPLETED', phase: 'FINALIZING_FIRESTORE' }
    }

    return { status: op.status, phase: op.phase }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    await deps.db.runTransaction(async (tx) => {
      const snap = await tx.get(opPath)
      if (snap.exists) {
        const latest = snap.data() as unknown as LessonTemplateMoveOperation
        tx.set(opPath, {
          ...latest,
          status: 'FAILED',
          lastError: errMsg,
          leaseOwner: null,
          leaseUntil: null,
          updatedAt: nowIso,
        } as unknown as Record<string, unknown>)
      }
    })
    return { status: 'FAILED', phase: op.phase }
  }
}

/**
 * Production wiring for Admin SDK Storage
 */
export const createAdminSdkMoveStorage = (): MoveStorage => {
  const bucket = getStorage().bucket()
  return {
    exists: async (path: string) => {
      const [exists] = await bucket.file(path).exists()
      return exists
    },
    copy: async (srcPath: string, destPath: string) => {
      await bucket.file(srcPath).copy(bucket.file(destPath))
    },
    delete: async (path: string) => {
      await bucket.file(path).delete({ ignoreNotFound: true })
    },
    listPrefix: async (prefix: string) => {
      const [files] = await bucket.getFiles({ prefix })
      return files.map((f) => f.name)
    },
  }
}

/**
 * Production wiring for Firestore MoveDb
 */
export const createAdminSdkMoveDb = (): MoveDb => {
  const db = getFirestore()
  return {
    doc: (path: string) => {
      const d = db.doc(path)
      return {
        id: d.id,
        path: d.path,
        get: async () => {
          const snap = await d.get()
          return { exists: snap.exists, id: snap.id, path: snap.ref.path, data: () => snap.data() }
        },
        set: async (data) => {
          await d.set(data)
        },
      }
    },
    collection: (path: string) => {
      const c = db.collection(path)
      return {
        doc: (id?: string) => {
          const d = id ? c.doc(id) : c.doc()
          return {
            id: d.id,
            path: d.path,
            get: async () => {
              const snap = await d.get()
              return { exists: snap.exists, id: snap.id, path: snap.ref.path, data: () => snap.data() }
            },
            set: async (data) => {
              await d.set(data)
            },
          }
        },
        where: (f, op, v) => {
          const q = c.where(f, op as FirebaseFirestore.WhereFilterOp, v)
          return {
            where: (f2, op2, v2) => q.where(f2, op2 as FirebaseFirestore.WhereFilterOp, v2) as unknown as MoveDbQuery,
            get: async () => {
              const snap = await q.get()
              return {
                empty: snap.empty,
                docs: snap.docs.map((d) => ({
                  exists: d.exists,
                  id: d.id,
                  path: d.ref.path,
                  data: () => d.data(),
                })),
              }
            },
          }
        },
        get: async () => {
          const snap = await c.get()
          return {
            empty: snap.empty,
            docs: snap.docs.map((d) => ({
              exists: d.exists,
              id: d.id,
              path: d.ref.path,
              data: () => d.data(),
            })),
          }
        },
      }
    },
    runTransaction: async <T>(fn: (tx: MoveDbTx) => Promise<T>): Promise<T> => {
      return db.runTransaction(async (tx) => {
        return fn({
          get: async (pathOrRef) => {
            const p = typeof pathOrRef === 'string' ? pathOrRef : pathOrRef.path
            const snap = await tx.get(db.doc(p))
            return { exists: snap.exists, id: snap.id, path: snap.ref.path, data: () => snap.data() }
          },
          set: (pathOrRef, data) => {
            const p = typeof pathOrRef === 'string' ? pathOrRef : pathOrRef.path
            tx.set(db.doc(p), data)
          },
          update: (pathOrRef, updates) => {
            const p = typeof pathOrRef === 'string' ? pathOrRef : pathOrRef.path
            const docUpdates: Record<string, unknown> = {}
            for (const [k, v] of Object.entries(updates)) {
              if (v === '__DELETE__') {
                docUpdates[k] = FieldValue.delete()
              } else {
                docUpdates[k] = v
              }
            }
            tx.update(db.doc(p), docUpdates)
          },
        })
      })
    },
  }
}
