import { describe, expect, it } from 'vitest'
import { aggregatePriceHistory, overlayNewsMarkers } from './priceHistory'

const point = (stockId: string, batchIndex: number, timestampMillis: number, price: number) =>
  ({ stockId, batchIndex, timestampMillis, price })

describe('aggregatePriceHistory', () => {
  it('groups 3-second points into a 30-second bucket, keeping the LAST price in each bucket', () => {
    const points = [
      point('acme', 0, 0, 1000), point('acme', 1, 3000, 1010), point('acme', 2, 6000, 1005),
      point('acme', 3, 9000, 1020), point('acme', 4, 12000, 1030), // still in bucket 0 (0-29999ms) if 30s
      point('acme', 10, 30000, 1050), // new bucket
    ]
    const result = aggregatePriceHistory(points, 30)
    expect(result).toEqual([
      { stockId: 'acme', bucketStartMillis: 0, price: 1030 },
      { stockId: 'acme', bucketStartMillis: 30000, price: 1050 },
    ])
  })

  it('returns one point per bucket when bucketSeconds equals the batch interval (no aggregation)', () => {
    const points = [point('acme', 0, 0, 1000), point('acme', 1, 3000, 1010)]
    expect(aggregatePriceHistory(points, 3)).toEqual([
      { stockId: 'acme', bucketStartMillis: 0, price: 1000 },
      { stockId: 'acme', bucketStartMillis: 3000, price: 1010 },
    ])
  })
})

describe('overlayNewsMarkers', () => {
  it('attaches newsIds published within a bucket to that bucket\'s point', () => {
    const buckets = [{ stockId: 'acme', bucketStartMillis: 0, price: 1000 }, { stockId: 'acme', bucketStartMillis: 30000, price: 1050 }]
    const news = [{ id: 'news-1', publishedAtMillis: 15000 }, { id: 'news-2', publishedAtMillis: 45000 }]
    const result = overlayNewsMarkers(buckets, news, 30)
    expect(result[0].newsIds).toEqual(['news-1'])
    expect(result[1].newsIds).toEqual(['news-2'])
  })
})
