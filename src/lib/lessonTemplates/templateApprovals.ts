import { httpsCallable, type Functions } from 'firebase/functions'

export interface PendingTemplateApproval {
  id: string
  title: string
  createdByUid: string
  updatedAt: unknown
}

export interface ListPendingTemplateApprovalsInput { orgId: string }

export const listPendingTemplateApprovals = async (functions: Functions, input: ListPendingTemplateApprovalsInput): Promise<PendingTemplateApproval[]> =>
  (await httpsCallable<ListPendingTemplateApprovalsInput, PendingTemplateApproval[]>(functions, 'listPendingTemplateApprovalsCallable')(input)).data

export interface ReviewTemplateApprovalInput { orgId: string; templateId: string; decision: 'APPROVED' | 'REJECTED' }

export const reviewTemplateApproval = async (functions: Functions, input: ReviewTemplateApprovalInput): Promise<void> => {
  await httpsCallable<ReviewTemplateApprovalInput, { approvalStatus: string }>(functions, 'reviewTemplateApprovalCallable')(input)
}
