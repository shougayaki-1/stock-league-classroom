import { httpsCallable, type Functions } from 'firebase/functions'

export interface CanReviewTemplateInput { templateId: string; versionId: string }
export const canReviewTemplate = async (functions: Functions, input: CanReviewTemplateInput): Promise<{ eligible: boolean }> =>
  (await httpsCallable<CanReviewTemplateInput, { eligible: boolean }>(functions, 'canReviewTemplateCallable')(input)).data

export interface SubmitTemplateReviewInput {
  templateId: string; versionId: string
  clarityRating: number; easeOfImplementationRating: number; studentResponseRating: number
  comment?: string
}
export const submitTemplateReview = async (functions: Functions, input: SubmitTemplateReviewInput): Promise<{ submitted: true }> =>
  (await httpsCallable<SubmitTemplateReviewInput, { submitted: true }>(functions, 'submitTemplateReviewCallable')(input)).data

export interface TemplateReview {
  templateId: string; versionId: string; reviewedByUid: string
  clarityRating: number; easeOfImplementationRating: number; studentResponseRating: number
  comment: string | null
}
export interface ListTemplateReviewsInput { templateId: string; versionId: string }
export const listTemplateReviews = async (functions: Functions, input: ListTemplateReviewsInput): Promise<TemplateReview[]> =>
  (await httpsCallable<ListTemplateReviewsInput, TemplateReview[]>(functions, 'listTemplateReviewsCallable')(input)).data
