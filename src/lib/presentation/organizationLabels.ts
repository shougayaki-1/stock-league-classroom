import type { BillingOverview } from '../billing/invoiceSubscription'
import type { Invitation } from '../organizations/invitations'
import type { OrgMember } from '../organizations/orgMembers'
import type { AnnualArchiveJobStatus } from '../privacy/annualArchive'
import { safeLabel } from './safeLabel'

type BillingPaymentMethod = NonNullable<BillingOverview['paymentMethod']>
type InvoiceSubscriptionStatus = NonNullable<BillingOverview['invoiceSubscription']>['status']
type InvoiceStatus = BillingOverview['invoices'][number]['status']

export const ORG_MEMBER_ROLE_LABELS = {
  owner: '組織オーナー',
  admin: '管理者',
  teacher: '教師',
} satisfies Record<OrgMember['role'], string>

export const ORG_MEMBER_STATUS_LABELS = {
  active: '有効',
  suspended: '利用停止',
} satisfies Record<OrgMember['status'], string>

export const INVITATION_STATUS_LABELS = {
  PENDING: '招待中',
  ACCEPTED: '参加済み',
  REVOKED: '失効済み',
} satisfies Record<Invitation['status'], string>

export const INVITATION_ROLE_LABELS = {
  admin: '管理者',
  teacher: '教師',
} satisfies Record<Invitation['role'], string>

export const BILLING_PAYMENT_METHOD_LABELS = {
  CARD: 'カード',
  INVOICE: '請求書',
  BANK_TRANSFER: '銀行振込',
  MANUAL: '手動登録',
} satisfies Record<BillingPaymentMethod, string>

export const INVOICE_SUBSCRIPTION_STATUS_LABELS = {
  CREATING: '申込処理中',
  ACTIVE: '請求書払い',
  SCHEDULED: '切替予定',
} satisfies Record<InvoiceSubscriptionStatus, string>

export const INVOICE_STATUS_LABELS = {
  DRAFT: '作成中',
  PENDING: '支払待ち',
  PAID: '支払済み',
  OVERDUE: '支払期限超過',
  CANCELLED: '取消済み',
} satisfies Record<InvoiceStatus, string>

export const ANNUAL_ARCHIVE_JOB_STATUS_LABELS = {
  SCHEDULED: '予約中',
  RUNNING: '処理中',
  CANCELLING: '取消処理中',
  COMPLETED: '完了',
  CANCELLED: '取消済み',
  FAILED: '失敗（再試行可能）',
} satisfies Record<AnnualArchiveJobStatus, string>

export const formatOrgMemberRole = (value: string | null | undefined): string =>
  safeLabel(value, ORG_MEMBER_ROLE_LABELS, '権限を確認できません')
export const formatOrgMemberStatus = (value: string | null | undefined): string =>
  safeLabel(value, ORG_MEMBER_STATUS_LABELS, 'メンバー状態を確認できません')
export const formatInvitationStatus = (value: string | null | undefined): string =>
  safeLabel(value, INVITATION_STATUS_LABELS, '招待状態を確認できません')
export const formatInvitationRole = (value: string | null | undefined): string =>
  safeLabel(value, INVITATION_ROLE_LABELS, '招待権限を確認できません')
export const formatBillingPaymentMethod = (value: string | null | undefined): string =>
  safeLabel(value, BILLING_PAYMENT_METHOD_LABELS, '支払方法を確認できません')
export const formatInvoiceSubscriptionStatus = (value: string | null | undefined): string =>
  safeLabel(value, INVOICE_SUBSCRIPTION_STATUS_LABELS, '請求設定を確認できません')
export const formatInvoiceStatus = (value: string | null | undefined): string =>
  safeLabel(value, INVOICE_STATUS_LABELS, '請求状態を確認できません')
export const formatAnnualArchiveJobStatus = (value: string | null | undefined): string =>
  safeLabel(value, ANNUAL_ARCHIVE_JOB_STATUS_LABELS, '処理状態を確認できません')

export const ORG_VERIFICATION_STATUS_LABELS = {
  PENDING: '確認中',
  VERIFIED: '確認済み',
  REJECTED: '確認できませんでした',
} as const satisfies Record<string, string>

export const PLAN_ID_LABELS = {
  FREE: '無料プラン',
  SCHOOL: '学校プラン',
  PARENT_ORG: '法人プラン',
} as const satisfies Record<string, string>

export const TEMPLATE_MOVE_STATUS_LABELS = {
  PENDING: '移動待ち',
  RUNNING: '移動処理中',
  FAILED: '移動処理に失敗しました',
  COMPLETED: '移動完了',
} as const satisfies Record<string, string>

export const TEMPLATE_MOVE_PHASE_LABELS = {
  STAGING_MATERIALS: '教材準備中',
  MIGRATING_VERSIONS: 'バージョン移行中',
  COMMITTING_OWNERSHIP: '所有権切替中',
  FINALIZING_MATERIALS: '教材の最終処理中',
  FINALIZING_FIRESTORE: 'データの最終処理中',
} as const satisfies Record<string, string>

export const AUDIT_ACTION_LABELS = {
  EXPORT_ORG_STUDENT_DATA: '生徒データのエクスポート',
  SEARCH_ORG_STUDENT_DATA: '生徒データの検索',
  REQUEST_MOVE_LESSON_TEMPLATE: '教材の移動申請',
  MOVE_LESSON_TEMPLATE_OUT: '教材の移動（送出）',
  MOVE_LESSON_TEMPLATE_IN: '教材の移動（受入）',
  SCHEDULE_ANNUAL_ARCHIVE: '年次アーカイブの予約',
  CANCEL_ANNUAL_ARCHIVE: '年次アーカイブの取消',
  CANCEL_ANNUAL_ARCHIVE_COMPLETED: '年次アーカイブ取消の完了',
  COMPLETE_ANNUAL_ARCHIVE: '年次アーカイブの完了',
  FAIL_ANNUAL_ARCHIVE: '年次アーカイブの失敗',
} as const satisfies Record<string, string>

export const AUDIT_RESULT_LABELS = {
  SUCCESS: '成功',
  FAILURE: '失敗',
} as const satisfies Record<string, string>

export const formatOrganizationVerificationStatus = (value: string | null | undefined): string =>
  safeLabel(value, ORG_VERIFICATION_STATUS_LABELS, '確認状態を確認できません')
export const formatPlanId = (value: string | null | undefined): string =>
  safeLabel(value, PLAN_ID_LABELS, 'プランを確認できません')
export const formatTemplateMoveStatus = (value: string | null | undefined): string =>
  safeLabel(value, TEMPLATE_MOVE_STATUS_LABELS, '移動状態を確認できません')
export const formatTemplateMovePhase = (value: string | null | undefined): string =>
  safeLabel(value, TEMPLATE_MOVE_PHASE_LABELS, '処理内容を確認できません')
export const formatAuditAction = (value: string | null | undefined): string =>
  safeLabel(value, AUDIT_ACTION_LABELS, '操作内容を確認できません')
export const formatAuditResult = (value: string | null | undefined): string =>
  safeLabel(value, AUDIT_RESULT_LABELS, '結果を確認できません')

export type OrganizationChoiceNameInput = {
  orgId: string
  name: string | null
  type: 'personal' | 'school' | 'parentOrg'
  role: 'owner' | 'admin' | 'teacher'
}

export const formatOrganizationChoiceName = (choice: OrganizationChoiceNameInput): string => {
  const trimmed = choice.name?.trim()
  if (trimmed) return trimmed
  if (choice.type === 'personal') return '個人用'
  return '組織名を確認できません'
}
