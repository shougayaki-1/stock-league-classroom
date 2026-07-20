import { describe, expect, it } from 'vitest'
import { calculateOrderFill } from './hostTrading'

describe('trading fill policy', () => {
  it('reduces buy and sell quantities to available cash or holdings', () => {
    expect(calculateOrderFill({ orderId: 'a', stockId: 'x', side: 'BUY', quantity: 10, submittedAtMillis: 1 }, 30, { cash: 95, holdings: {}, updatedAtMillis: 1 }, 2).filledQuantity).toBe(3)
    expect(calculateOrderFill({ orderId: 'b', stockId: 'x', side: 'SELL', quantity: 10, submittedAtMillis: 1 }, 30, { cash: 0, holdings: { x: 2 }, updatedAtMillis: 1 }, 2).filledQuantity).toBe(2)
  })
})
