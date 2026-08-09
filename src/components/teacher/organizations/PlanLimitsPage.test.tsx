import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PlanLimitsPage } from './PlanLimitsPage'

const limits = { concurrentLessonsAndMarkets: 1, participants: 40, teacherSeats: 1, aiCredits: 0, templateStorage: 5, resultRetentionDays: 30, eventExtraCapacity: 0 }

describe('PlanLimitsPage', () => {
  it('shows a loading state when data is undefined', () => {
    render(<PlanLimitsPage data={undefined} error={undefined} />)
    expect(screen.getByLabelText('読み込み中')).toBeInTheDocument()
  })

  it('shows an error message', () => {
    render(<PlanLimitsPage data={undefined} error="failed" />)
    expect(screen.getByRole('alert')).toHaveTextContent('読み込みに失敗しました')
  })

  it('lists all seven limit axes', () => {
    render(<PlanLimitsPage data={limits} error={undefined} />)
    expect(screen.getByText('40')).toBeInTheDocument()
    expect(screen.getByText('同時授業・市場数')).toBeInTheDocument()
    expect(screen.getByText('参加人数')).toBeInTheDocument()
    expect(screen.getByText('教師席')).toBeInTheDocument()
    expect(screen.getByText('AIクレジット')).toBeInTheDocument()
    expect(screen.getByText('テンプレート保存')).toBeInTheDocument()
    expect(screen.getByText('結果保持（日数）')).toBeInTheDocument()
    expect(screen.getByText('イベント追加枠')).toBeInTheDocument()
  })
})

it('shows checkout only when supplied', () => { const onCheckout = vi.fn(); const { rerender } = render(<PlanLimitsPage data={limits} error={undefined} onCheckout={onCheckout} checkingOut={false} />); fireEvent.click(screen.getByRole('button', { name: 'このプランで申し込む' })); expect(onCheckout).toHaveBeenCalled(); rerender(<PlanLimitsPage data={limits} error={undefined} onCheckout={undefined} checkingOut={false} />); expect(screen.queryByRole('button', { name: 'このプランで申し込む' })).not.toBeInTheDocument() })
