import type { PriceRuntimeState, StockPricePhase } from './types'

const MINUTE_MS = 60 * 1000
export const DEFAULT_PHASES: StockPricePhase[] = [{ id: 'default-flat', startMinute: 0, endMinute: 60, direction: 'FLAT', changePercent: 0 }]
export const MIN_PRICE_RATIO = 0.01
export const MAX_PRICE_RATIO = 100
export const clampToBounds = (price: number, basePrice: number): number => {
  const safeBase = Number.isFinite(basePrice) && basePrice > 0 ? basePrice : price
  const floor = Math.max(1, Math.round(safeBase * MIN_PRICE_RATIO)), ceiling = Math.max(floor, Math.round(safeBase * MAX_PRICE_RATIO))
  return Math.min(ceiling, Math.max(floor, Math.max(1, Math.round(price))))
}
export const applyMeanReversion = (target: number, startPrice: number, basePrice: number): number => {
  if (!Number.isFinite(basePrice) || basePrice <= 0) return target
  const strength = Math.min(0.9, 0.1 + Math.abs(startPrice - basePrice) / basePrice * 0.5)
  return target + (basePrice - target) * strength
}
export const clampMinute = (value: number, fallback: number): number => Number.isFinite(value) ? Math.min(60, Math.max(0, Math.round(value))) : fallback
export const normalizePhases = (phases?: StockPricePhase[] | null): StockPricePhase[] => {
  if (!Array.isArray(phases) || phases.length === 0) return DEFAULT_PHASES
  return phases.map((phase, index) => {
    const direction = ['UP', 'DOWN', 'FLAT'].includes(phase.direction) ? phase.direction : 'FLAT'
    const percent = Number.isFinite(phase.changePercent) ? Math.max(0, Math.abs(phase.changePercent)) : 0
    const startMinute = clampMinute(phase.startMinute, 0)
    const endMinute = Math.max(startMinute + 1, clampMinute(phase.endMinute, 60))
    return { id: phase.id || `phase-${index + 1}`, startMinute, endMinute: Math.min(60, endMinute), direction, changePercent: direction === 'DOWN' ? Math.min(99, percent) : percent }
  }).sort((a, b) => a.startMinute - b.startMinute)
}
export const elapsedMarketMinute = (openedAtMillis: number, atMillis: number): number => Math.max(0, (atMillis - openedAtMillis) / MINUTE_MS)
export const getActivePhase = (phases: StockPricePhase[], elapsedMinute: number): StockPricePhase => {
  const normalized = normalizePhases(phases)
  return normalized.find((phase) => elapsedMinute >= phase.startMinute && elapsedMinute < phase.endMinute) ?? DEFAULT_PHASES[0]
}
export const getPhaseWindow = (phase: StockPricePhase, openedAtMillis: number) => ({
  startMillis: openedAtMillis + clampMinute(phase.startMinute, 0) * MINUTE_MS,
  endMillis: openedAtMillis + clampMinute(phase.endMinute, 60) * MINUTE_MS,
})
export const getPhaseEndPrice = (startPrice: number, phase: StockPricePhase, basePrice = startPrice): number => {
  if (phase.direction === 'FLAT' || phase.changePercent === 0) return clampToBounds(startPrice, basePrice)
  return clampToBounds(applyMeanReversion(startPrice * (1 + (phase.direction === 'DOWN' ? -1 : 1) * phase.changePercent / 100), startPrice, basePrice), basePrice)
}
export const createPhaseRuntime = (currentPrice: number, phase: StockPricePhase, openedAtMillis: number, nowMillis: number, basePrice = currentPrice, seed = Math.random() * 1000): PriceRuntimeState => {
  const window = getPhaseWindow(phase, openedAtMillis), startAtMillis = Math.max(nowMillis, window.startMillis)
  return { mode: 'PHASE', phaseId: phase.id, startPrice: currentPrice, endPrice: getPhaseEndPrice(currentPrice, phase, basePrice), startAtMillis, endAtMillis: Math.max(startAtMillis + MINUTE_MS, window.endMillis), seed }
}
