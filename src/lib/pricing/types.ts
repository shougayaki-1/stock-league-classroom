export type PhaseDirection = 'UP' | 'DOWN' | 'FLAT'
export interface StockPricePhase { id: string; startMinute: number; endMinute: number; direction: PhaseDirection; changePercent: number }
export interface PriceRuntimeState { mode: 'PHASE'; phaseId: string; startPrice: number; endPrice: number; startAtMillis: number; endAtMillis: number; seed: number }
