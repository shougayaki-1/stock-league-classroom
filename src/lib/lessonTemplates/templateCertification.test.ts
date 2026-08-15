import { describe, expect, it, vi } from 'vitest'
import {
  listTemplateCertificationCandidates,
  setTemplateCertification,
  type CertificationCandidate,
  type SetTemplateCertificationRequest,
  type SetTemplateCertificationResult,
} from './templateCertification'

const httpsCallableMock = vi.fn()

vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: unknown[]) => httpsCallableMock(...args),
}))

describe('client templateCertification wrappers', () => {
  it('calls listTemplateCertificationCandidatesCallable and returns candidate list', async () => {
    const candidates: CertificationCandidate[] = [
      {
        templateId: 'tpl-1',
        title: '教材1',
        currentPublishedVersionId: 'v1',
        visibility: 'COMMUNITY',
        createdByUid: 'teacher-1',
      },
    ]
    const callableFn = vi.fn().mockResolvedValue({ data: candidates })
    httpsCallableMock.mockReturnValue(callableFn)

    const result = await listTemplateCertificationCandidates({} as never)
    expect(httpsCallableMock).toHaveBeenCalledWith({}, 'listTemplateCertificationCandidatesCallable')
    expect(callableFn).toHaveBeenCalledWith({})
    expect(result).toEqual(candidates)
  })

  it('calls setTemplateCertificationCallable with input and returns result', async () => {
    const input: SetTemplateCertificationRequest = {
      templateId: 'tpl-1',
      versionId: 'v1',
      level: 'VERIFIED',
      reason: '内容認証',
      idempotencyKey: 'idemp-1',
    }
    const expectedResult: SetTemplateCertificationResult = {
      visibility: 'VERIFIED',
      changed: true,
      deduplicated: false,
    }
    const callableFn = vi.fn().mockResolvedValue({ data: expectedResult })
    httpsCallableMock.mockReturnValue(callableFn)

    const result = await setTemplateCertification({} as never, input)
    expect(httpsCallableMock).toHaveBeenCalledWith({}, 'setTemplateCertificationCallable')
    expect(callableFn).toHaveBeenCalledWith(input)
    expect(result).toEqual(expectedResult)
  })
})
