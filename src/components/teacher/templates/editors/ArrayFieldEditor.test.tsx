import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ArrayFieldEditor } from './ArrayFieldEditor'

const fields = [{ key: 'name' as const, label: '名称', type: 'text' as const }, { key: 'amount' as const, label: '金額', type: 'number' as const }]

describe('ArrayFieldEditor', () => {
  it('adds, edits and removes items immutably', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ArrayFieldEditor items={[]} fields={fields} itemLabel="企業" onChange={onChange} createEmptyItem={() => ({ id: 'new', name: '', amount: 0 })} />)
    fireEvent.click(screen.getByRole('button', { name: '企業を追加' }))
    expect(onChange).toHaveBeenLastCalledWith([{ id: 'new', name: '', amount: 0 }])
    rerender(<ArrayFieldEditor items={[{ id: 'a', name: '企業A', amount: 1000 }]} fields={fields} itemLabel="企業" onChange={onChange} createEmptyItem={() => ({ id: 'new', name: '', amount: 0 })} />)
    fireEvent.change(screen.getByDisplayValue('企業A'), { target: { value: '企業B' } })
    expect(onChange).toHaveBeenLastCalledWith([{ id: 'a', name: '企業B', amount: 1000 }])
    fireEvent.click(screen.getByRole('button', { name: '企業Aを削除' }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })
})
