import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getLessonTemplateMoveOperation,
  moveLessonTemplate,
  previewLessonTemplateMove,
} from './moveLessonTemplate'

const callableMock = vi.fn()
const httpsCallableMock = vi.fn(() => callableMock)

vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: Parameters<typeof httpsCallableMock>) => httpsCallableMock(...args),
}))

describe('moveLessonTemplate client wrappers', () => {
  const fakeFunctions = {} as never

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls previewLessonTemplateMoveCallable and returns result', async () => {
    const previewData = {
      templateId: 'tpl-1',
      sourceOrgId: 'org-source',
      targetOrgId: 'org-target',
      versionCount: 2,
      materialCount: 1,
      legacyMaterialCount: 0,
      canMove: true,
      willUnpublishCommunity: true,
      willResetApproval: true,
      historicalLessonRunsRemain: true,
    }
    callableMock.mockResolvedValueOnce({ data: previewData })

    const res = await previewLessonTemplateMove(fakeFunctions, {
      templateId: 'tpl-1',
      sourceOrgId: 'org-source',
      targetOrgId: 'org-target',
    })

    expect(httpsCallableMock).toHaveBeenCalledWith(fakeFunctions, 'previewLessonTemplateMoveCallable')
    expect(callableMock).toHaveBeenCalledWith({
      templateId: 'tpl-1',
      sourceOrgId: 'org-source',
      targetOrgId: 'org-target',
    })
    expect(res).toEqual(previewData)
  })

  it('calls moveLessonTemplateCallable and returns result', async () => {
    const moveData = {
      operationId: 'op-123',
      status: 'PENDING',
      alreadyRequested: false,
    }
    callableMock.mockResolvedValueOnce({ data: moveData })

    const input = {
      templateId: 'tpl-1',
      sourceOrgId: 'org-source',
      targetOrgId: 'org-target',
      reason: '理由',
      confirmationText: 'org-target',
      idempotencyKey: 'idem-1',
    }
    const res = await moveLessonTemplate(fakeFunctions, input)

    expect(httpsCallableMock).toHaveBeenCalledWith(fakeFunctions, 'moveLessonTemplateCallable')
    expect(callableMock).toHaveBeenCalledWith(input)
    expect(res).toEqual(moveData)
  })

  it('calls getLessonTemplateMoveOperationCallable and returns status', async () => {
    const statusData = {
      operationId: 'op-123',
      status: 'RUNNING',
      phase: 'MIGRATING_VERSIONS',
      versionCount: 2,
      materialCount: 1,
    }
    callableMock.mockResolvedValueOnce({ data: statusData })

    const res = await getLessonTemplateMoveOperation(fakeFunctions, {
      operationId: 'op-123',
      sourceOrgId: 'org-source',
      targetOrgId: 'org-target',
    })

    expect(httpsCallableMock).toHaveBeenCalledWith(fakeFunctions, 'getLessonTemplateMoveOperationCallable')
    expect(callableMock).toHaveBeenCalledWith({
      operationId: 'op-123',
      sourceOrgId: 'org-source',
      targetOrgId: 'org-target',
    })
    expect(res).toEqual(statusData)
  })
})
