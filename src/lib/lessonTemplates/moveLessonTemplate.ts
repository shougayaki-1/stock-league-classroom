import { httpsCallable, type Functions } from 'firebase/functions'

export interface PreviewLessonTemplateMoveInput {
  templateId: string
  sourceOrgId: string
  targetOrgId: string
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

export interface MoveLessonTemplateInput {
  templateId: string
  sourceOrgId: string
  targetOrgId: string
  reason: string
  confirmationText: string
  idempotencyKey: string
}

export interface MoveLessonTemplateResult {
  operationId: string
  status: 'PENDING' | 'RUNNING' | 'FAILED' | 'COMPLETED'
  alreadyRequested: boolean
}

export interface GetLessonTemplateMoveOperationInput {
  operationId: string
  sourceOrgId: string
  targetOrgId: string
}

export interface LessonTemplateMoveOperationStatus {
  operationId: string
  status: 'PENDING' | 'RUNNING' | 'FAILED' | 'COMPLETED'
  phase: string
  versionCount: number
  materialCount: number
  lastError?: string
}

export const previewLessonTemplateMove = async (
  functions: Functions,
  input: PreviewLessonTemplateMoveInput,
): Promise<LessonTemplateMovePreview> => {
  const callable = httpsCallable<PreviewLessonTemplateMoveInput, LessonTemplateMovePreview>(
    functions,
    'previewLessonTemplateMoveCallable',
  )
  const result = await callable(input)
  return result.data
}

export const moveLessonTemplate = async (
  functions: Functions,
  input: MoveLessonTemplateInput,
): Promise<MoveLessonTemplateResult> => {
  const callable = httpsCallable<MoveLessonTemplateInput, MoveLessonTemplateResult>(
    functions,
    'moveLessonTemplateCallable',
  )
  const result = await callable(input)
  return result.data
}

export const getLessonTemplateMoveOperation = async (
  functions: Functions,
  input: GetLessonTemplateMoveOperationInput,
): Promise<LessonTemplateMoveOperationStatus> => {
  const callable = httpsCallable<GetLessonTemplateMoveOperationInput, LessonTemplateMoveOperationStatus>(
    functions,
    'getLessonTemplateMoveOperationCallable',
  )
  const result = await callable(input)
  return result.data
}
