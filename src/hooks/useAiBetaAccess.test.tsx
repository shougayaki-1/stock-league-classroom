import type { Functions } from 'firebase/functions'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as betaAccessApi from '../lib/ai/betaAccess'
import { useAiBetaAccess } from './useAiBetaAccess'

vi.mock('../lib/ai/betaAccess', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/ai/betaAccess')>()
  return {
    ...actual,
    getMyAiBetaAccess: vi.fn(),
  }
})

describe('useAiBetaAccess', () => {
  const dummyFunctions = {} as unknown as Functions

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts in LOADING and transitions to APPROVED when getMyAiBetaAccess returns approved: true', async () => {
    let resolvePromise: (value: { approved: boolean }) => void
    const pendingPromise = new Promise<{ approved: boolean }>((resolve) => {
      resolvePromise = resolve
    })
    vi.mocked(betaAccessApi.getMyAiBetaAccess).mockReturnValueOnce(pendingPromise)

    const { result } = renderHook(() => useAiBetaAccess(dummyFunctions))

    expect(result.current).toBe('LOADING')

    resolvePromise!({ approved: true })

    await waitFor(() => {
      expect(result.current).toBe('APPROVED')
    })
  })

  it('transitions to LOCKED when getMyAiBetaAccess returns approved: false', async () => {
    vi.mocked(betaAccessApi.getMyAiBetaAccess).mockResolvedValueOnce({ approved: false })

    const { result } = renderHook(() => useAiBetaAccess(dummyFunctions))

    expect(result.current).toBe('LOADING')

    await waitFor(() => {
      expect(result.current).toBe('LOCKED')
    })
  })

  it('transitions to ERROR when getMyAiBetaAccess rejects', async () => {
    vi.mocked(betaAccessApi.getMyAiBetaAccess).mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() => useAiBetaAccess(dummyFunctions))

    expect(result.current).toBe('LOADING')

    await waitFor(() => {
      expect(result.current).toBe('ERROR')
    })
  })

  it('does not update state after unmount', async () => {
    let resolvePromise: (value: { approved: boolean }) => void
    const pendingPromise = new Promise<{ approved: boolean }>((resolve) => {
      resolvePromise = resolve
    })
    vi.mocked(betaAccessApi.getMyAiBetaAccess).mockReturnValueOnce(pendingPromise)

    const { result, unmount } = renderHook(() => useAiBetaAccess(dummyFunctions))
    expect(result.current).toBe('LOADING')

    unmount()

    resolvePromise!({ approved: true })
    // No act warning or state mutation after unmount
    expect(result.current).toBe('LOADING')
  })
})
