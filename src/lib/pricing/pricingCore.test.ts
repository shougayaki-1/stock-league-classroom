import { describe, expect, it } from 'vitest'
import { applyMeanReversion, clampMinute, clampToBounds, createPhaseRuntime, getActivePhase, getPhaseEndPrice, normalizePhases } from './pricingCore'
import type { StockPricePhase } from './types'
describe('pricing core', () => {
  it('bounds and rounds values', () => { expect(clampToBounds(1, 1000)).toBe(10); expect(clampToBounds(999999, 1000)).toBe(100000); expect(clampToBounds(1234.6, 1000)).toBe(1235) })
  it('reverts toward a valid base', () => { expect(applyMeanReversion(1100, 1000, 1000)).toBeGreaterThan(1000); expect(applyMeanReversion(1100, 1000, 0)).toBe(1100) })
  it('normalizes minutes and phases', () => { expect(clampMinute(-1, 0)).toBe(0); expect(clampMinute(NaN, 15)).toBe(15); expect(normalizePhases(null)[0].id).toBe('default-flat'); expect(normalizePhases([{ id: 'x', startMinute: 0, endMinute: 1, direction: 'DOWN', changePercent: 150 }])[0].changePercent).toBe(99) })
  it('selects active JST phase', () => { const p: StockPricePhase[] = [{ id: 'a', startMinute: 0, endMinute: 30, direction: 'FLAT', changePercent: 0 }, { id: 'b', startMinute: 30, endMinute: 60, direction: 'UP', changePercent: 5 }]; expect(getActivePhase(p, Date.UTC(2026, 0, 1, 0, 40) - 9 * 60 * 60 * 1000).id).toBe('b') })
  it('creates Firebase-independent runtime', () => { const p: StockPricePhase = { id: 'f', startMinute: 0, endMinute: 60, direction: 'FLAT', changePercent: 0 }; expect(getPhaseEndPrice(1000, p)).toBe(1000); const runtime = createPhaseRuntime(1000, p, Date.now(), 1000, 42); expect(runtime.endAtMillis).toBeGreaterThan(runtime.startAtMillis); expect(runtime.seed).toBe(42) })
})
