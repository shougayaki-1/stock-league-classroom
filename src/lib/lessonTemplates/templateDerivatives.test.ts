import { describe, expect, it, vi } from 'vitest'

const collectionMock = vi.fn(() => ({ __kind: 'collection' }))
const whereMock = vi.fn((...args: unknown[]) => ({ __kind: 'where', args }))
const queryMock = vi.fn((...args: unknown[]) => ({ __kind: 'query', args }))
const getDocsMock = vi.fn()

vi.mock('firebase/firestore', () => ({
  collection: collectionMock,
  where: whereMock,
  query: queryMock,
  getDocs: getDocsMock,
}))

const { listTemplateDerivatives } = await import('./templateDerivatives')

describe('listTemplateDerivatives', () => {
  it('queries by sourceTemplateId and visibility in 3 marketplace levels together', async () => {
    getDocsMock.mockResolvedValue({ docs: [] })
    await listTemplateDerivatives({} as never, 'source-1')
    expect(whereMock).toHaveBeenCalledWith('sourceTemplateId', '==', 'source-1')
    expect(whereMock).toHaveBeenCalledWith('visibility', 'in', ['COMMUNITY', 'VERIFIED', 'OFFICIAL'])
  })

  it('maps Firestore docs into CommunityTemplate objects including visibility', async () => {
    getDocsMock.mockResolvedValue({
      docs: [{ id: 't2', data: () => ({ title: '派生教材', description: '説明', subject: 'HOME_ECONOMICS', currentPublishedVersionId: 'v2', visibility: 'OFFICIAL' }) }],
    })
    const result = await listTemplateDerivatives({} as never, 'source-1')
    expect(result).toEqual([{ id: 't2', title: '派生教材', description: '説明', subject: 'HOME_ECONOMICS', currentPublishedVersionId: 'v2', visibility: 'OFFICIAL' }])
  })
})
