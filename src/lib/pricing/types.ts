export type PhaseDirection = 'UP' | 'DOWN' | 'FLAT'
/** A phase window measured in minutes elapsed since the market opened. */
export interface StockPricePhase { id: string; startMinute: number; endMinute: number; direction: PhaseDirection; changePercent: number }
export interface PriceRuntimeState { mode: 'PHASE'; phaseId: string; startPrice: number; endPrice: number; startAtMillis: number; endAtMillis: number; seed: number }
