import { describe, expect, it, vi } from 'vitest'

const collectionMock = vi.fn(() => ({ __kind: 'collection' }))
const whereMock = vi.fn((...args: unknown[]) => ({ __kind: 'where', args }))
const orderByMock = vi.fn((...args: unknown[]) => ({ __kind: 'orderBy', args }))
const limitMock = vi.fn((...args: unknown[]) => ({ __kind: 'limit', args }))
const queryMock = vi.fn((...args: unknown[]) => ({ __kind: 'query', args }))
const getDocsMock = vi.fn()

vi.mock('firebase/firestore', () => ({
  collection: collectionMock,
  where: whereMock,
  orderBy: orderByMock,
  limit: limitMock,
  query: queryMock,
  getDocs: getDocsMock,
}))

const { listCommunityTemplates } = await import('./communityTemplates')

describe('listCommunityTemplates', () => {
  it('queries by visibility in 3 marketplace levels and orders by publishedToCommunityAt when no subject filter is given', async () => {
    getDocsMock.mockResolvedValue({ docs: [] })
    await listCommunityTemplates({} as never)
    expect(whereMock).toHaveBeenCalledTimes(1)
    expect(whereMock).toHaveBeenCalledWith('visibility', 'in', ['COMMUNITY', 'VERIFIED', 'OFFICIAL'])
    expect(orderByMock).toHaveBeenCalledWith('publishedToCommunityAt', 'desc')
    expect(limitMock).toHaveBeenCalledWith(50)
  })

  it('adds a subject filter when requested', async () => {
    getDocsMock.mockResolvedValue({ docs: [] })
    await listCommunityTemplates({} as never, { subject: 'HOME_ECONOMICS' })
    expect(whereMock).toHaveBeenCalledWith('visibility', 'in', ['COMMUNITY', 'VERIFIED', 'OFFICIAL'])
    expect(whereMock).toHaveBeenCalledWith('subject', '==', 'HOME_ECONOMICS')
  })

  it('maps Firestore docs into CommunityTemplate objects including visibility', async () => {
    getDocsMock.mockResolvedValue({
      docs: [{ id: 't1', data: () => ({ title: 'タイトル', description: '説明', subject: 'SOCIAL_STUDIES', currentPublishedVersionId: 'v1', visibility: 'VERIFIED' }) }],
    })
    const result = await listCommunityTemplates({} as never)
    expect(result).toEqual([{ id: 't1', title: 'タイトル', description: '説明', subject: 'SOCIAL_STUDIES', currentPublishedVersionId: 'v1', visibility: 'VERIFIED' }])
  })
})
