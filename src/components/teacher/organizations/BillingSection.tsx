import { useEffect, useState } from 'react'
import { Alert, Button, Divider, Link, Stack, TextField, Typography } from '@mui/material'
import type { BillingOverview, BillingProfileInput } from '../../../lib/billing/invoiceSubscription'

export interface BillingSectionProps {
  canManageBilling: boolean
  overview: BillingOverview | undefined
  onSaveProfile: (profile: BillingProfileInput) => void
  onStartInvoiceSubscription: () => void
  savingProfile?: boolean
  startingInvoiceSubscription?: boolean
  error?: string
}

const emptyProfile = (): BillingProfileInput => ({
  legalName: '',
  contactName: '',
  email: '',
  address: { postalCode: '', prefecture: '', city: '', line1: '', line2: '' },
})

const isComplete = (profile: BillingProfileInput): boolean => [
  profile.legalName,
  profile.contactName,
  profile.email,
  profile.address.postalCode,
  profile.address.prefecture,
  profile.address.city,
  profile.address.line1,
].every((value) => value.trim().length > 0)

const formatDate = (millis: number): string => new Date(millis).toLocaleDateString('ja-JP')

const paymentMethodLabels: Record<NonNullable<BillingOverview['paymentMethod']>, string> = {
  CARD: 'カード',
  INVOICE: '請求書',
  BANK_TRANSFER: '銀行振込',
  MANUAL: '手動登録',
}

export function BillingSection({
  canManageBilling,
  overview,
  onSaveProfile,
  onStartInvoiceSubscription,
  savingProfile = false,
  startingInvoiceSubscription = false,
  error,
}: BillingSectionProps) {
  const [draft, setDraft] = useState<BillingProfileInput>(() => overview?.profile ?? emptyProfile())

  useEffect(() => {
    setDraft(overview?.profile ?? emptyProfile())
  }, [overview?.profile])

  if (!canManageBilling) return null

  const setTopLevel = (key: 'legalName' | 'contactName' | 'email', value: string) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }
  const setAddress = (key: keyof BillingProfileInput['address'], value: string) => {
    setDraft((current) => ({ ...current, address: { ...current.address, [key]: value } }))
  }
  const submitProfile = () => {
    onSaveProfile({
      ...draft,
      address: {
        ...draft.address,
        line2: draft.address.line2 || undefined,
      },
    })
  }

  const signupDisabled = overview?.profile == null || startingInvoiceSubscription || overview.invoiceSubscription != null
  const signupLabel = overview?.paymentMethod === 'CARD'
    ? '次回更新から請求書払いへ切り替える'
    : '請求書払いで申し込む'

  return (
    <Stack component="section" spacing={2} aria-labelledby="billing-heading">
      <Typography id="billing-heading" variant="h5">請求・支払い</Typography>
      {error && <Alert severity="error">{error}</Alert>}
      <Typography variant="subtitle1">請求先プロフィール</Typography>
      <Stack spacing={2}>
        <TextField required label="法人名・学校名" value={draft.legalName} onChange={(event) => setTopLevel('legalName', event.target.value)} />
        <TextField required label="担当者名" value={draft.contactName} onChange={(event) => setTopLevel('contactName', event.target.value)} />
        <TextField required type="email" label="請求先メールアドレス" value={draft.email} onChange={(event) => setTopLevel('email', event.target.value)} />
        <TextField required label="郵便番号" value={draft.address.postalCode} onChange={(event) => setAddress('postalCode', event.target.value)} />
        <TextField required label="都道府県" value={draft.address.prefecture} onChange={(event) => setAddress('prefecture', event.target.value)} />
        <TextField required label="市区町村" value={draft.address.city} onChange={(event) => setAddress('city', event.target.value)} />
        <TextField required label="住所1" value={draft.address.line1} onChange={(event) => setAddress('line1', event.target.value)} />
        <TextField label="住所2（任意）" value={draft.address.line2 ?? ''} onChange={(event) => setAddress('line2', event.target.value)} />
        <Button variant="outlined" disabled={savingProfile || !isComplete(draft)} onClick={submitProfile} sx={{ alignSelf: 'flex-start' }}>
          請求先プロフィールを保存
        </Button>
      </Stack>

      <Divider />
      <Typography variant="body1">
        現在の請求方法: {overview?.paymentMethod ? paymentMethodLabels[overview.paymentMethod] : '未登録'}
      </Typography>
      {overview?.invoiceSubscription?.status === 'SCHEDULED' && overview.invoiceSubscription.currentPeriodEndMillis != null && (
        <Alert severity="info">次回更新日（{formatDate(overview.invoiceSubscription.currentPeriodEndMillis)}）から請求書払いへ切替予定です。</Alert>
      )}
      {overview?.invoiceSubscription?.status === 'CREATING' && (
        <Alert severity="info">請求書払いの申込を処理しています。完了までカード申込は利用できません。</Alert>
      )}
      {overview?.profile == null && (
        <Typography variant="body2">請求書払いを申し込むには、先に請求先プロフィールを保存してください。</Typography>
      )}
      {overview?.invoiceSubscription == null && (
        <Button variant="contained" disabled={signupDisabled} onClick={onStartInvoiceSubscription} sx={{ alignSelf: 'flex-start' }}>
          {signupLabel}
        </Button>
      )}

      {overview && overview.invoices.length > 0 && (
        <Stack spacing={1}>
          <Typography variant="subtitle1">請求書履歴</Typography>
          {overview.invoices.map((invoice) => (
            <Stack key={invoice.id} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
              <Typography variant="body2">{invoice.status} / 支払期限 {formatDate(invoice.dueDateMillis)}</Typography>
              {invoice.hostedInvoiceUrl && (
                <Link href={invoice.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer">請求書を確認</Link>
              )}
            </Stack>
          ))}
        </Stack>
      )}
    </Stack>
  )
}
