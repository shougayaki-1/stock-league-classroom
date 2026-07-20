import type { PriceRuntimeState, StockPricePhase } from './types'

const JST_OFFSET_MS = 9 * 60 * 60 * 1000
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
    return { id: phase.id || `phase-${index + 1}`, startMinute: clampMinute(phase.startMinute, 0), endMinute: clampMinute(phase.endMinute, 60), direction, changePercent: direction === 'DOWN' ? Math.min(99, percent) : percent }
  })
}
const jstMinute = (nowMillis: number) => new Date(nowMillis + JST_OFFSET_MS).getUTCMinutes()
const jstHourStart = (nowMillis: number) => { const now = new Date(nowMillis + JST_OFFSET_MS); return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()) - JST_OFFSET_MS }
const isActive = (minute: number, phase: StockPricePhase): boolean => { const start = clampMinute(phase.startMinute, 0); const end = clampMinute(phase.endMinute, 60); return start === end || (start < end ? minute >= start && minute < end : minute >= start || minute < end) }
export const getActivePhase = (phases: StockPricePhase[], nowMillis: number): StockPricePhase => phases.find((phase) => isActive(jstMinute(nowMillis), phase)) ?? DEFAULT_PHASES[0]
export const getPhaseWindow = (phase: StockPricePhase, nowMillis: number) => {
  const start = clampMinute(phase.startMinute, 0), end = clampMinute(phase.endMinute, 60), hour = jstHourStart(nowMillis)
  if (start === end) return { startMillis: nowMillis, endMillis: nowMillis + 60 * MINUTE_MS }
  if (start < end) return { startMillis: hour + start * MINUTE_MS, endMillis: hour + end * MINUTE_MS }
  return jstMinute(nowMillis) >= start ? { startMillis: hour + start * MINUTE_MS, endMillis: hour + (end + 60) * MINUTE_MS } : { startMillis: hour - (60 - start) * MINUTE_MS, endMillis: hour + end * MINUTE_MS }
}
export const getPhaseEndPrice = (startPrice: number, phase: StockPricePhase, basePrice = startPrice): number => {
  if (phase.direction === 'FLAT' || phase.changePercent === 0) return clampToBounds(startPrice, basePrice)
  return clampToBounds(applyMeanReversion(startPrice * (1 + (phase.direction === 'DOWN' ? -1 : 1) * phase.changePercent / 100), startPrice, basePrice), basePrice)
}
export const createPhaseRuntime = (currentPrice: number, phase: StockPricePhase, nowMillis: number, basePrice = currentPrice, seed = Math.random() * 1000): PriceRuntimeState => {
  const window = getPhaseWindow(phase, nowMillis), startAtMillis = Math.max(nowMillis, window.startMillis)
  return { mode: 'PHASE', phaseId: phase.id, startPrice: currentPrice, endPrice: getPhaseEndPrice(currentPrice, phase, basePrice), startAtMillis, endAtMillis: Math.max(startAtMillis + MINUTE_MS, window.endMillis), seed }
}
