import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { PricePhaseEditor } from './PricePhaseEditor'
import type { StockPricePhase } from '../../lib/pricing/types'

const phases = [{ id: 'p1', startMinute: 0, endMinute: 30, direction: 'UP' as const, changePercent: 5 }]

describe('PricePhaseEditor', () => {
  it('renders one row per phase and calls onAddPhase', async () => {
    const onAddPhase = vi.fn()
    render(<PricePhaseEditor phases={phases} onAddPhase={onAddPhase} onUpdatePhase={vi.fn()} onRemovePhase={vi.fn()} />)
    expect(screen.getByDisplayValue('0')).toBeInTheDocument()
    expect(screen.getByDisplayValue('30')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'フェーズを追加' }))
    expect(onAddPhase).toHaveBeenCalled()
  })

  it('reports the changed field on update', async () => {
    // PricePhaseEditor is a controlled component: without the caller feeding the
    // patched value back in as props, React resets the input after every keystroke
    // (standard controlled-input behavior), so a plain vi.fn() mock can't observe
    // incremental typing. This harness re-applies each patch, the same way
    // TemplateWorkspace's updateCompany callback does, so typing behaves as it
    // would in real usage.
    const onUpdatePhase = vi.fn()
    const Harness = () => {
      const [items, setItems] = useState<StockPricePhase[]>(phases)
      return <PricePhaseEditor
        phases={items}
        onAddPhase={vi.fn()}
        onUpdatePhase={(index, patch) => {
          onUpdatePhase(index, patch)
          setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
        }}
        onRemovePhase={vi.fn()}
      />
    }
    render(<Harness />)
    const endField = screen.getByDisplayValue('30')
    await userEvent.clear(endField)
    await userEvent.type(endField, '45')
    expect(onUpdatePhase).toHaveBeenLastCalledWith(0, { endMinute: 45 })
  })

  it('disables every field and hides add/remove when disabled', () => {
    render(<PricePhaseEditor phases={phases} disabled onAddPhase={vi.fn()} onUpdatePhase={vi.fn()} onRemovePhase={vi.fn()} />)
    expect(screen.getByDisplayValue('0')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'フェーズを追加' })).not.toBeInTheDocument()
  })
})
