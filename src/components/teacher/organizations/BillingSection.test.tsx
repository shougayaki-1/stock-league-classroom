import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BillingSection } from './BillingSection'
import type { BillingProfileInput } from '../../../lib/billing/invoiceSubscription'

const profile: BillingProfileInput = {
  legalName: '学校法人テスト学園',
  contactName: '山田花子',
  email: 'billing@example.com',
  address: {
    postalCode: '100-0001',
    prefecture: '東京都',
    city: '千代田区',
    line1: '千代田1-1',
    line2: '校舎2階',
  },
}

const renderSection = (overrides: Partial<React.ComponentProps<typeof BillingSection>> = {}) => render(
  <BillingSection
    canManageBilling
    overview={{ profile, paymentMethod: null, invoices: [] }}
    onSaveProfile={vi.fn()}
    onStartInvoiceSubscription={vi.fn()}
    {...overrides}
  />,
)

describe('BillingSection', () => {
  it('shows the editable billing profile fields to an authorized manager', () => {
    renderSection()

    expect(screen.getByRole('heading', { name: '請求・支払い' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '法人名・学校名' })).toHaveValue(profile.legalName)
    expect(screen.getByRole('textbox', { name: '担当者名' })).toHaveValue(profile.contactName)
    expect(screen.getByRole('textbox', { name: '請求先メールアドレス' })).toHaveValue(profile.email)
    expect(screen.getByRole('textbox', { name: '郵便番号' })).toHaveValue(profile.address.postalCode)
    expect(screen.getByRole('textbox', { name: '都道府県' })).toHaveValue(profile.address.prefecture)
    expect(screen.getByRole('textbox', { name: '市区町村' })).toHaveValue(profile.address.city)
    expect(screen.getByRole('textbox', { name: '住所1' })).toHaveValue(profile.address.line1)
    expect(screen.getByRole('textbox', { name: '住所2（任意）' })).toHaveValue(profile.address.line2)
  })

  it('keeps invoice signup disabled until a profile has been saved', async () => {
    renderSection({ overview: { profile: null, paymentMethod: null, invoices: [] } })

    expect(screen.getByRole('button', { name: '請求書払いで申し込む' })).toBeDisabled()
    expect(screen.getByText('請求書払いを申し込むには、先に請求先プロフィールを保存してください。')).toBeInTheDocument()

    await userEvent.type(screen.getByRole('textbox', { name: '法人名・学校名' }), 'テスト学園')
    expect(screen.getByRole('button', { name: '請求書払いで申し込む' })).toBeDisabled()
  })

  it('uses the new invoice label when there is no card subscription', () => {
    renderSection()
    expect(screen.getByRole('button', { name: '請求書払いで申し込む' })).toBeEnabled()
  })

  it('uses the period-end switch label for a card subscription', () => {
    renderSection({ overview: { profile, paymentMethod: 'CARD', invoices: [] } })
    expect(screen.getByRole('button', { name: '次回更新から請求書払いへ切り替える' })).toBeEnabled()
  })

  it('shows the scheduled switch date and hosted Invoice link', () => {
    renderSection({
      overview: {
        profile,
        paymentMethod: 'CARD',
        invoiceSubscription: { status: 'SCHEDULED', currentPeriodEndMillis: Date.UTC(2027, 0, 15) },
        invoices: [{
          id: 'in_1',
          status: 'PENDING',
          paymentMethod: 'INVOICE',
          dueDateMillis: Date.UTC(2027, 1, 14),
          hostedInvoiceUrl: 'https://invoice.stripe.com/i/acct_test/test',
        }],
      },
    })

    expect(screen.getByText(/2027\/1\/15/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '請求書を確認' })).toHaveAttribute('href', 'https://invoice.stripe.com/i/acct_test/test')
  })

  it('renders no profile, action, or hosted Invoice URL for a non-manager', () => {
    renderSection({
      canManageBilling: false,
      overview: {
        profile,
        paymentMethod: 'INVOICE',
        invoices: [{ id: 'in_1', status: 'PENDING', paymentMethod: 'INVOICE', dueDateMillis: Date.UTC(2027, 1, 14), hostedInvoiceUrl: 'https://invoice.stripe.com/private' }],
      },
    })

    expect(screen.queryByRole('heading', { name: '請求・支払い' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '法人名・学校名' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /請求書払い/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '請求書を確認' })).not.toBeInTheDocument()
  })

  it('disables a pending invoice action so duplicate clicks do not submit', () => {
    const onStartInvoiceSubscription = vi.fn()
    renderSection({ startingInvoiceSubscription: true, onStartInvoiceSubscription })

    const button = screen.getByRole('button', { name: '請求書払いで申し込む' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    fireEvent.click(button)
    expect(onStartInvoiceSubscription).not.toHaveBeenCalled()
  })

  it('submits the current profile draft without adding client-only billing data', async () => {
    const onSaveProfile = vi.fn()
    renderSection({ overview: { profile: null, paymentMethod: null, invoices: [] }, onSaveProfile })

    await userEvent.type(screen.getByRole('textbox', { name: '法人名・学校名' }), profile.legalName)
    await userEvent.type(screen.getByRole('textbox', { name: '担当者名' }), profile.contactName)
    await userEvent.type(screen.getByRole('textbox', { name: '請求先メールアドレス' }), profile.email)
    await userEvent.type(screen.getByRole('textbox', { name: '郵便番号' }), profile.address.postalCode)
    await userEvent.type(screen.getByRole('textbox', { name: '都道府県' }), profile.address.prefecture)
    await userEvent.type(screen.getByRole('textbox', { name: '市区町村' }), profile.address.city)
    await userEvent.type(screen.getByRole('textbox', { name: '住所1' }), profile.address.line1)
    await userEvent.click(screen.getByRole('button', { name: '請求先プロフィールを保存' }))

    expect(onSaveProfile).toHaveBeenCalledWith({ ...profile, address: { ...profile.address, line2: undefined } })
  })
})
