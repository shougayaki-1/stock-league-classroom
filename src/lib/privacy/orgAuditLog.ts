import { httpsCallable, type Functions } from 'firebase/functions'

export interface OrgAuditLogEntry {
  id: string
  actorUid: string
  action: string
  result: 'SUCCESS' | 'FAILURE'
  occurredAt: string | null
  reason?: string
}

export interface ListOrgAuditLogInput { orgId: string }
export interface ListOrgAuditLogResult { entries: OrgAuditLogEntry[] }

export const listOrgAuditLog = async (functions: Functions, input: ListOrgAuditLogInput): Promise<ListOrgAuditLogResult> =>
  (await httpsCallable<ListOrgAuditLogInput, ListOrgAuditLogResult>(functions, 'listOrgAuditLogCallable')(input)).data
