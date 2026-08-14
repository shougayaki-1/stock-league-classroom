import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PlanLimitsPage } from './PlanLimitsPage'
import type { SchoolEffectiveQuotaResult } from '../../../lib/organizations/parentOrgQuota'

const limits = {
  concurrentLessonsAndMarkets: 1, participants: 40, teacherSeats: 1, aiCredits: 0, templateStorage: 5, resultRetentionDays: 30, eventExtraCapacity: 0,
  downgradeStatus: { state: 'NORMAL' as const, violations: [] },
}

const effectiveQuota: SchoolEffectiveQuotaResult = {
  schoolOrgId: 'school-1',
  parentOrgId: 'parent-1',
  parentContractState: 'ACTIVE',
  concurrentLessonsAndMarkets: { guaranteed: 2, usage: 3, sharedReserved: 1, effectiveAvailable: 4 },
  teacherSeats: { guaranteed: 2, usage: 1, sharedReserved: 0, effectiveAvailable: 3 },
}

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

  it('shows a manage-billing button when onManageBilling is provided', () => {
    const onManageBilling = vi.fn()
    render(<PlanLimitsPage data={limits} error={undefined} onManageBilling={onManageBilling} managingBilling={false} />)
    fireEvent.click(screen.getByRole('button', { name: '支払い方法の変更・解約' }))
    expect(onManageBilling).toHaveBeenCalled()
  })

  it('hides the manage-billing button when onManageBilling is not provided', () => {
    render(<PlanLimitsPage data={limits} error={undefined} onManageBilling={undefined} managingBilling={false} />)
    expect(screen.queryByRole('button', { name: '支払い方法の変更・解約' })).not.toBeInTheDocument()
  })

  it('shows a scheduled plan change and its effective date', () => {
    render(<PlanLimitsPage data={{ ...limits, downgradeStatus: {
      state: 'SCHEDULED', pendingPlanChange: { planId: 'SCHOOL', effectiveAtMillis: Date.UTC(2026, 7, 31) }, violations: [],
    } }} error={undefined} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/変更予定/)
    expect(screen.getByRole('alert')).toHaveTextContent('SCHOOL')
  })

  it('shows each restricted violation and explains that new creation is stopped', () => {
    render(<PlanLimitsPage data={{ ...limits, downgradeStatus: {
      state: 'RESTRICTED',
      violations: [
        { key: 'concurrentLessonsAndMarkets', label: '同時授業・市場数', used: 2, limit: 1 },
        { key: 'teacherSeats', label: '教師席', used: 3, limit: 1 },
      ],
    } }} error={undefined} />)
    expect(screen.getByRole('alert')).toHaveTextContent('同時授業・市場数: 2 / 1')
    expect(screen.getByRole('alert')).toHaveTextContent('教師席: 3 / 1')
    expect(screen.getByRole('alert')).toHaveTextContent(/新規作成を停止中/)
  })

  it('shows only the current school effective quota when supplied', () => {
    render(<PlanLimitsPage data={limits} error={undefined} schoolEffectiveQuota={effectiveQuota} />)

    expect(screen.getByText('学校の実効利用枠')).toBeInTheDocument()
    expect(screen.getByText('同時授業・市場数: 保証 2 / 使用中 3 / 共有予約 1 / 実効利用可能 4')).toBeInTheDocument()
    expect(screen.getByText('教師席: 保証 2 / 使用中 1 / 共有予約 0 / 実効利用可能 3')).toBeInTheDocument()
    expect(screen.queryByText('上位組織の利用枠')).not.toBeInTheDocument()
  })

  it('renders the optional billing section after the plan-limit status', () => {
    render(<PlanLimitsPage
      data={{ ...limits, downgradeStatus: { state: 'GRACE', graceEndsAtMillis: Date.now() + 86_400_000, violations: [] } }}
      error={undefined}
      billingSection={<section aria-label="billing-section">billing</section>}
    />)

    const status = screen.getByRole('alert')
    const billingSection = screen.getByRole('region', { name: 'billing-section' })
    expect(status.compareDocumentPosition(billingSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('only enables ended-parent migration for a manager with an active school subscription', () => {
    const onMigrateFromEndedParent = vi.fn()
    const { rerender } = render(<PlanLimitsPage data={limits} error={undefined} parentContractState="ENDED" canManageContract onMigrateFromEndedParent={onMigrateFromEndedParent} schoolSubscriptionState={{ status: 'canceled' }} />)
    expect(screen.getByText(/学校データは保持されます/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '学校を単独契約へ移行する' })).toBeDisabled()
    rerender(<PlanLimitsPage data={limits} error={undefined} parentContractState="ENDED" canManageContract onMigrateFromEndedParent={onMigrateFromEndedParent} schoolSubscriptionState={{ status: 'active' }} />)
    fireEvent.click(screen.getByRole('button', { name: '学校を単独契約へ移行する' }))
    expect(onMigrateFromEndedParent).toHaveBeenCalled()
  })
})

it('shows checkout only when supplied', () => { const onCheckout = vi.fn(); const { rerender } = render(<PlanLimitsPage data={limits} error={undefined} onCheckout={onCheckout} checkingOut={false} />); fireEvent.click(screen.getByRole('button', { name: 'このプランで申し込む' })); expect(onCheckout).toHaveBeenCalled(); rerender(<PlanLimitsPage data={limits} error={undefined} onCheckout={undefined} checkingOut={false} />); expect(screen.queryByRole('button', { name: 'このプランで申し込む' })).not.toBeInTheDocument() })
