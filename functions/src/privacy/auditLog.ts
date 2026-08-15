import { FieldValue } from 'firebase-admin/firestore'

export interface AuditLogEntryInput {
  orgId: string
  actorUid: string
  action: string
  result: 'SUCCESS' | 'FAILURE'
  reason?: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}

/**
 * Spec §21.6: 誰が・いつ・何を・どの組織へ・変更前後・理由・結果を記録する
 * 追記専用の監査ログ。update/delete用のAPIは意図的に用意しない
 * (firestore.rules側でもクライアント直接書き込みを一律拒否する)。
 */
export const recordAuditLogEntry = async (db: FirebaseFirestore.Firestore, entry: AuditLogEntryInput): Promise<void> => {
  const { orgId, actorUid, action, result, reason, before, after } = entry
  const doc: Record<string, unknown> = { orgId, actorUid, action, result, occurredAt: FieldValue.serverTimestamp() }
  if (reason !== undefined) doc.reason = reason
  if (before !== undefined) doc.before = before
  if (after !== undefined) doc.after = after
  await db.collection(`organizations/${orgId}/auditLog`).add(doc)
}

export interface OrgDeletionAuditLogEntryInput {
  orgId: string
  actorUid: string
  result: 'SUCCESS' | 'FAILURE'
  reason?: string
}

/**
 * organizations/{orgId}/auditLog とは別の、トップレベルの
 * orgDeletionAuditLog コレクションに記録する。理由: 組織削除そのものを
 * 記録する監査ログを削除対象の組織のサブコレクションに置くと、組織を
 * 削除した瞬間に監査証跡ごと消えてしまい、spec §21.6の「監査ログは
 * 改変不可」という要件を満たせない。
 */
export const recordOrgDeletionAuditLogEntry = async (db: FirebaseFirestore.Firestore, entry: OrgDeletionAuditLogEntryInput): Promise<void> => {
  const doc: Record<string, unknown> = { orgId: entry.orgId, actorUid: entry.actorUid, result: entry.result, occurredAt: FieldValue.serverTimestamp() }
  if (entry.reason !== undefined) doc.reason = entry.reason
  await db.collection('orgDeletionAuditLog').add(doc)
}

/**
 * Transaction-safe version of recordAuditLogEntry for atomicity with state transitions.
 */
export const recordAuditLogInTransaction = (
  tx: FirebaseFirestore.Transaction | { set: (ref: FirebaseFirestore.DocumentReference | string, data: Record<string, unknown>) => void },
  db: FirebaseFirestore.Firestore | { collection: (path: string) => { doc: () => FirebaseFirestore.DocumentReference | string } },
  entry: AuditLogEntryInput,
): void => {
  const { orgId, actorUid, action, result, reason, before, after } = entry
  const docRef = (db as FirebaseFirestore.Firestore).collection(`organizations/${orgId}/auditLog`).doc()
  const doc: Record<string, unknown> = { orgId, actorUid, action, result, occurredAt: FieldValue.serverTimestamp() }
  if (reason !== undefined) doc.reason = reason
  if (before !== undefined) doc.before = before
  if (after !== undefined) doc.after = after
  tx.set(docRef as never, doc)
}


