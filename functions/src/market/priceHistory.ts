/**
 * §12.30 price history aggregation and news-marker overlay. Pure functions
 * only — Firestore reads/writes (`lessonRuns/{id}/priceHistory/{stockId}_{batchIndex}`)
 * and any wiring from `processBatch.ts` into this collection are out of
 * scope for Task 14; see task-14-report.md.
 */

export interface PricePoint {
  stockId: string
  batchIndex: number
  timestampMillis: number
  price: number
}

export interface AggregatedPricePoint {
  stockId: string
  bucketStartMillis: number
  price: number
}

/**
 * Buckets 3-second raw price points into `bucketSeconds`-wide windows,
 * keeping the LAST price observed in each bucket (spec §12.30 "表示は
 * 10〜30秒単位へ集約可能"). Input order is not assumed to be sorted by
 * timestamp; a later point for the same bucket always overwrites an
 * earlier one, and the result is sorted by `bucketStartMillis` ascending.
 */
export const aggregatePriceHistory = (points: PricePoint[], bucketSeconds: number): AggregatedPricePoint[] => {
  const bucketMillis = bucketSeconds * 1000
  const lastByBucket = new Map<string, AggregatedPricePoint>()
  for (const point of points) {
    const bucketStartMillis = Math.floor(point.timestampMillis / bucketMillis) * bucketMillis
    const key = `${point.stockId}::${bucketStartMillis}`
    lastByBucket.set(key, { stockId: point.stockId, bucketStartMillis, price: point.price })
  }
  return Array.from(lastByBucket.values()).sort((a, b) => a.bucketStartMillis - b.bucketStartMillis)
}

export interface ChartPoint extends AggregatedPricePoint {
  newsIds: string[]
}

/**
 * Attaches news/economic-indicator publish events to the bucket whose
 * window contains their `publishedAtMillis` (spec §12.30 "ニュース・決算
 * 公開時刻をチャートへ表示"). A news item whose publish time falls outside
 * every existing bucket's window is silently dropped from the result —
 * chart overlay only needs to annotate buckets that already exist.
 */
export const overlayNewsMarkers = (
  buckets: AggregatedPricePoint[],
  news: { id: string; publishedAtMillis: number }[],
  bucketSeconds: number,
): ChartPoint[] => {
  const bucketMillis = bucketSeconds * 1000
  return buckets.map((bucket) => ({
    ...bucket,
    newsIds: news
      .filter((n) => Math.floor(n.publishedAtMillis / bucketMillis) * bucketMillis === bucket.bucketStartMillis)
      .map((n) => n.id),
  }))
}
