import { describe, expect, it } from 'vitest'
import {
  formatAnnualArchiveJobStatus,
  formatAuditAction,
  formatAuditResult,
  formatBillingPaymentMethod,
  formatInvitationRole,
  formatInvitationStatus,
  formatInvoiceStatus,
  formatInvoiceSubscriptionStatus,
  formatOrganizationChoiceName,
  formatOrganizationVerificationStatus,
  formatOrgMemberRole,
  formatOrgMemberStatus,
  formatPlanId,
  formatTemplateMovePhase,
  formatTemplateMoveStatus,
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

  it('maps organization verification status, plan id, move status/phase and audit action/result', () => {
    expect(formatOrganizationVerificationStatus('PENDING')).toBe('確認中')
    expect(formatOrganizationVerificationStatus('VERIFIED')).toBe('確認済み')
    expect(formatOrganizationVerificationStatus('REJECTED')).toBe('確認できませんでした')

    expect(formatPlanId('FREE')).toBe('無料プラン')
    expect(formatPlanId('SCHOOL')).toBe('学校プラン')
    expect(formatPlanId('PARENT_ORG')).toBe('法人プラン')

    expect(formatTemplateMoveStatus('PENDING')).toBe('移動待ち')
    expect(formatTemplateMoveStatus('RUNNING')).toBe('移動処理中')
    expect(formatTemplateMoveStatus('FAILED')).toBe('移動処理に失敗しました')
    expect(formatTemplateMoveStatus('COMPLETED')).toBe('移動完了')

    expect(formatTemplateMovePhase('STAGING_MATERIALS')).toBe('教材準備中')
    expect(formatTemplateMovePhase('MIGRATING_VERSIONS')).toBe('バージョン移行中')
    expect(formatTemplateMovePhase('COMMITTING_OWNERSHIP')).toBe('所有権切替中')
    expect(formatTemplateMovePhase('FINALIZING_MATERIALS')).toBe('教材の最終処理中')
    expect(formatTemplateMovePhase('FINALIZING_FIRESTORE')).toBe('データの最終処理中')

    expect(formatAuditAction('EXPORT_ORG_STUDENT_DATA')).toBe('生徒データのエクスポート')
    expect(formatAuditAction('REQUEST_MOVE_LESSON_TEMPLATE')).toBe('教材の移動申請')
    expect(formatAuditResult('SUCCESS')).toBe('成功')
    expect(formatAuditResult('FAILURE')).toBe('失敗')
  })

  it('never echoes unknown internal tokens injected into the new formatters', () => {
    const unknownStatus = 'UNKNOWN_INTERNAL_STATUS'
    const unknownPhase = 'INTERNAL_MOVE_PHASE'
    const unknownPlan = 'secret-plan-id'
    const unknownAction = 'RAW_AUDIT_ACTION'
    const unknownOrgId = 'org-secret-id'

    expect(formatOrganizationVerificationStatus(unknownStatus)).not.toContain(unknownStatus)
    expect(formatPlanId(unknownPlan)).not.toContain(unknownPlan)
    expect(formatTemplateMoveStatus(unknownStatus)).not.toContain(unknownStatus)
    expect(formatTemplateMovePhase(unknownPhase)).not.toContain(unknownPhase)
    expect(formatAuditAction(unknownAction)).not.toContain(unknownAction)
    expect(formatAuditResult(unknownStatus)).not.toContain(unknownStatus)

    expect(
      formatOrganizationChoiceName({ orgId: unknownOrgId, name: null, type: 'school', role: 'owner' }),
    ).not.toContain(unknownOrgId)
  })

  it('formats organization choice names per type/name rules', () => {
    expect(
      formatOrganizationChoiceName({ orgId: 'org-1', name: '青葉高校', type: 'school', role: 'owner' }),
    ).toBe('青葉高校')
    expect(
      formatOrganizationChoiceName({ orgId: 'org-2', name: null, type: 'personal', role: 'owner' }),
    ).toBe('個人用')
    expect(
      formatOrganizationChoiceName({ orgId: 'org-3', name: null, type: 'school', role: 'admin' }),
    ).toBe('組織名を確認できません')
    expect(
      formatOrganizationChoiceName({ orgId: 'org-4', name: '  ', type: 'parentOrg', role: 'admin' }),
    ).toBe('組織名を確認できません')
  })
})
