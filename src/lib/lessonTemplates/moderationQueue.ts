import { httpsCallable, type Functions } from 'firebase/functions'

export interface PendingTemplateReport {
  id: string
  templateId: string
  versionId: string
  reportedByUid: string
  reason: 'PERSONAL_INFO' | 'COPYRIGHT' | 'INAPPROPRIATE' | 'MISINFORMATION' | 'OTHER'
  details: string | null
  createdAt: unknown
  templateTitle: string | null
}

export const listPendingTemplateReports = async (functions: Functions): Promise<PendingTemplateReport[]> =>
  (await httpsCallable<Record<string, never>, PendingTemplateReport[]>(functions, 'listPendingTemplateReportsCallable')({})).data

export interface ResolveTemplateReportInput { reportId: string; action: 'UNPUBLISH' | 'DISMISS' }
export interface ResolveTemplateReportResult { resolved: true }

export const resolveTemplateReport = async (functions: Functions, input: ResolveTemplateReportInput): Promise<ResolveTemplateReportResult> =>
  (await httpsCallable<ResolveTemplateReportInput, ResolveTemplateReportResult>(functions, 'resolveTemplateReportCallable')(input)).data
