import { httpsCallable, type Functions } from 'firebase/functions'
import type { MarketplaceVisibility } from './marketplaceVisibility'

export interface CertificationCandidate {
  templateId: string
  title: string
  currentPublishedVersionId: string
  visibility: MarketplaceVisibility
  createdByUid: string
}

export interface SetTemplateCertificationRequest {
  templateId: string
  versionId: string
  level: MarketplaceVisibility
  reason: string
  idempotencyKey: string
}

export interface SetTemplateCertificationResult {
  visibility: MarketplaceVisibility
  changed: boolean
  deduplicated: boolean
}

export const listTemplateCertificationCandidates = async (
  functions: Functions,
): Promise<CertificationCandidate[]> => {
  const callable = httpsCallable<Record<string, never>, CertificationCandidate[]>(
    functions,
    'listTemplateCertificationCandidatesCallable',
  )
  const result = await callable({})
  return result.data
}

export const setTemplateCertification = async (
  functions: Functions,
  input: SetTemplateCertificationRequest,
): Promise<SetTemplateCertificationResult> => {
  const callable = httpsCallable<SetTemplateCertificationRequest, SetTemplateCertificationResult>(
    functions,
    'setTemplateCertificationCallable',
  )
  const result = await callable(input)
  return result.data
}
