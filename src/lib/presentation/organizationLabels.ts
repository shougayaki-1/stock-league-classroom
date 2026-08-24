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
