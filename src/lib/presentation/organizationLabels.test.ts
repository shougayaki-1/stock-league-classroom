import { describe, expect, it } from 'vitest'
import {
  formatAnnualArchiveJobStatus,
  formatBillingPaymentMethod,
  formatInvitationRole,
  formatInvitationStatus,
  formatInvoiceStatus,
  formatInvoiceSubscriptionStatus,
  formatOrgMemberRole,
  formatOrgMemberStatus,
} from './organizationLabels'

describe('organization presentation labels', () => {
  it('maps organization and billing values to human-readable labels', () => {
    expect(formatOrgMemberRole('owner')).toBe('組織オーナー')
    expect(formatOrgMemberRole('admin')).toBe('管理者')
    expect(formatOrgMemberStatus('suspended')).toBe('利用停止')
    expect(formatInvitationStatus('PENDING')).toBe('招待中')
    expect(formatInvitationRole('teacher')).toBe('教師')
    expect(formatBillingPaymentMethod('BANK_TRANSFER')).toBe('銀行振込')
    expect(formatInvoiceSubscriptionStatus('CREATING')).toBe('申込処理中')
    expect(formatInvoiceStatus('OVERDUE')).toBe('支払期限超過')
    expect(formatAnnualArchiveJobStatus('CANCELLING')).toBe('取消処理中')
  })

  it('never echoes an unknown organization token', () => {
    const raw = 'UNKNOWN_INTERNAL_TOKEN'
    const results = [
      formatOrgMemberRole(raw),
      formatOrgMemberStatus(raw),
      formatInvitationStatus(raw),
      formatInvitationRole(raw),
      formatBillingPaymentMethod(raw),
      formatInvoiceSubscriptionStatus(raw),
      formatInvoiceStatus(raw),
      formatAnnualArchiveJobStatus(raw),
    ]

    for (const result of results) expect(result).not.toContain(raw)
  })
})
