import { httpsCallable, type Functions } from 'firebase/functions'

// Duplicated (not imported) from CommunityTemplatesPage.tsx's TemplateReportReason on purpose:
// a lib module should not depend on a component module's types. Both are the
// same 5-literal union, so values from either side remain structurally assignable.
export type TemplateReportReason = 'PERSONAL_INFO' | 'COPYRIGHT' | 'INAPPROPRIATE' | 'MISINFORMATION' | 'OTHER'

export interface ReportTemplateInput { templateId: string; versionId: string; reason: TemplateReportReason; details?: string }
export interface ReportTemplateResult { reportId: string }

export const reportTemplate = async (functions: Functions, input: ReportTemplateInput): Promise<ReportTemplateResult> => {
  const call = httpsCallable<ReportTemplateInput, ReportTemplateResult>(functions, 'reportTemplateCallable')
  const result = await call(input)
  return result.data
}
