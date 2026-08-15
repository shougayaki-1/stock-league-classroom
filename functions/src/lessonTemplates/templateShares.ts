import { createHash, randomBytes } from 'node:crypto'
import { getFirestore } from 'firebase-admin/firestore'

/** displaySession.ts/recovery.ts と同じ設計: 32バイトのランダムトークン、平文は永続化しない。 */
export const generateTemplateShareToken = (): string => randomBytes(32).toString('hex')

export const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex')

interface TemplateShareTx {
  get: (path: string) => Promise<{ exists: boolean; data?: Record<string, unknown> }>
  set: (path: string, data: Record<string, unknown>) => void
}

export interface TemplateShareFirestoreDeps {
  firestore: { runTransaction: <T>(fn: (tx: TemplateShareTx) => Promise<T>) => Promise<T> }
  hashToken: (token: string) => string
  now?: () => unknown
  nowMillis?: () => number
}

export interface CreateTemplateShareDeps extends TemplateShareFirestoreDeps {
  generateToken: () => string
}
export interface CreateTemplateShareInput {
  templateId: string; versionId: string; sourceOrgId: string; createdByUid: string; expiresInDays: number
}
export interface CreateTemplateShareResult { token: string }

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000

export const createTemplateShare = async (
  deps: CreateTemplateShareDeps,
  input: CreateTemplateShareInput,
): Promise<CreateTemplateShareResult> => {
  const nowMillisValue = deps.nowMillis ? deps.nowMillis() : Date.now()
  return deps.firestore.runTransaction(async (tx) => {
    const token = deps.generateToken()
    const tokenHash = deps.hashToken(token)
    tx.set(`templateShares/${tokenHash}`, {
      templateId: input.templateId, versionId: input.versionId, sourceOrgId: input.sourceOrgId,
      createdByUid: input.createdByUid, createdAt: deps.now ? deps.now() : new Date().toISOString(),
      expiresAtMillis: nowMillisValue + input.expiresInDays * MILLIS_PER_DAY, revokedAt: null,
    })
    return { token }
  })
}

export interface ResolveTemplateShareInput { token: string }
export interface ResolveTemplateShareResult {
  templateId: string; versionId: string; sourceOrgId: string; createdByUid: string
}

export const resolveTemplateShare = async (
  deps: TemplateShareFirestoreDeps,
  input: ResolveTemplateShareInput,
): Promise<ResolveTemplateShareResult> => {
  const nowMillisValue = deps.nowMillis ? deps.nowMillis() : Date.now()
  const tokenHash = deps.hashToken(input.token)
  return deps.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(`templateShares/${tokenHash}`)
    if (!snap.exists || !snap.data) throw new Error('Template share not found')
    const share = snap.data as {
      templateId: string; versionId: string; sourceOrgId: string; createdByUid: string
      expiresAtMillis: number; revokedAt: unknown
    }
    if (share.revokedAt !== null) throw new Error('Template share not found')
    if (nowMillisValue > share.expiresAtMillis) throw new Error('Template share not found')

    const templateSnap = await tx.get(`lessonTemplates/${share.templateId}`)
    if (!templateSnap.exists || !templateSnap.data) throw new Error('Template share not found')
    const template = templateSnap.data as { orgId: string; moveOperationId?: string }
    if (template.orgId !== share.sourceOrgId) throw new Error('Template share not found')
    if (template.moveOperationId) throw new Error('Template share not found')

    return { templateId: share.templateId, versionId: share.versionId, sourceOrgId: share.sourceOrgId, createdByUid: share.createdByUid }
  })
}

export interface RevokeTemplateSharesDeps extends TemplateShareFirestoreDeps {
  queryByCreator: (templateId: string, versionId: string, createdByUid: string) => Promise<string[]>
}
export interface RevokeTemplateSharesInput { templateId: string; versionId: string; createdByUid: string }

export const revokeTemplateShares = async (deps: RevokeTemplateSharesDeps, input: RevokeTemplateSharesInput): Promise<void> => {
  const paths = await deps.queryByCreator(input.templateId, input.versionId, input.createdByUid)
  if (paths.length === 0) return
  const revokedAt = deps.now ? deps.now() : new Date().toISOString()
  await deps.firestore.runTransaction(async (tx) => {
    for (const path of paths) {
      const snap = await tx.get(path)
      if (snap.exists && snap.data) tx.set(path, { ...snap.data, revokedAt })
    }
  })
}

const adminSdkFirestore = () => {
  const db = getFirestore()
  return {
    runTransaction: <T>(fn: (tx: TemplateShareTx) => Promise<T>) => db.runTransaction((tx) => fn({
      get: async (path: string) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: snap.data() } },
      set: (path: string, data: Record<string, unknown>) => { tx.set(db.doc(path), data) },
    })),
  }
}

/** Production wiring: Firestore Admin SDK + crypto. */
export const createTemplateShareWithAdminSdk = (input: CreateTemplateShareInput): Promise<CreateTemplateShareResult> =>
  createTemplateShare({
    firestore: adminSdkFirestore(), generateToken: generateTemplateShareToken, hashToken: sha256Hex,
    now: () => new Date().toISOString(), nowMillis: () => Date.now(),
  }, input)

export const resolveTemplateShareWithAdminSdk = (input: ResolveTemplateShareInput): Promise<ResolveTemplateShareResult> =>
  resolveTemplateShare({
    firestore: adminSdkFirestore(), hashToken: sha256Hex, nowMillis: () => Date.now(),
  }, input)

export const revokeTemplateSharesWithAdminSdk = (input: RevokeTemplateSharesInput): Promise<void> => {
  const db = getFirestore()
  return revokeTemplateShares({
    firestore: adminSdkFirestore(), hashToken: sha256Hex, now: () => new Date().toISOString(),
    queryByCreator: async (templateId, versionId, createdByUid) => {
      const snap = await db.collection('templateShares')
        .where('templateId', '==', templateId)
        .where('versionId', '==', versionId)
        .where('createdByUid', '==', createdByUid)
        .get()
      return snap.docs.map((document) => document.ref.path)
    },
  }, input)
}
