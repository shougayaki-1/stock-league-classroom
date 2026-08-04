import { useEffect, useRef, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { onValue, ref } from 'firebase/database'
import { Alert, Box, Button, Card, CardContent, Container, Divider, Stack, TextField, Typography } from '@mui/material'
import { bootstrapFirebase } from '../../lib/firebase/bootstrap'
import { isTeacherIdentity } from '../../lib/auth/roles'
import { updateMarketCompanies, validateMarketCompanies, type MarketCompanyDraft } from '../../lib/market/hostTrading'
import type { LiveMarketState, MarketStatus } from '../../lib/market/liveMarketTypes'
import type { TemplateSpec } from '../../lib/templates/types'
import { TEMPLATE_LIMITS } from '../../lib/templates/templateValidation'
import { handleFailure } from '../../lib/monitoring/describeError'
import { AdminShell } from './AdminShell'
import { AuthLoadingScreen } from './TeacherShell'
import { PricePhaseEditor } from './PricePhaseEditor'

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`
type Access = 'loading' | 'ready' | 'not-found' | 'forbidden' | 'read-error'

const AccessState = ({ state }: { state: Exclude<Access, 'ready'> }) => {
  const content = state === 'loading'
    ? { title: '市場を確認しています', detail: '市場の設定とアクセス権を読み込んでいます。' }
    : state === 'not-found'
      ? { title: 'この市場は見つかりません', detail: '削除されたか、URLが正しくない可能性があります。' }
      : state === 'forbidden'
        ? { title: 'この市場を編集する権限がありません', detail: '市場を作成した教師アカウントでログインしているか確認してください。' }
        : { title: '市場を読み込めません', detail: '通信状態を確認してから、もう一度お試しください。' }
  return <Container component="main" maxWidth="md" sx={{ py: 8 }}><Stack spacing={2} sx={{ alignItems: 'flex-start', maxWidth: 520 }}>
    <Typography component="h1" variant="h2">{content.title}</Typography>
    <Typography color="text.secondary">{content.detail}</Typography>
    <Button variant="contained" href="/teacher/markets">市場の管理へ戻る</Button>
  </Stack></Container>
}

export const MarketStocksPage = ({ marketId }: { marketId: string }) => {
  const services = bootstrapFirebase()
  const [user, setUser] = useState<User | null>(services.auth.currentUser)
  const [authReady, setAuthReady] = useState(false)
  const [access, setAccess] = useState<Access>('loading')
  const [title, setTitle] = useState('')
  const [status, setStatus] = useState<MarketStatus>('SETUP')
  const [draft, setDraft] = useState<MarketCompanyDraft[]>([])
  const [notice, setNotice] = useState<{ text: string; severity: 'success' | 'error' } | null>(null)
  const [saving, setSaving] = useState(false)
  const seededRef = useRef(false)

  useEffect(() => onAuthStateChanged(services.auth, (next) => { setUser(next); setAuthReady(true) }), [services.auth])

  useEffect(() => {
    if (!authReady || !user || !isTeacherIdentity(user)) return
    let active = true
    setAccess('loading')
    void getDoc(doc(services.firestore, 'markets', marketId)).then((snapshot) => {
      if (!active) return
      if (!snapshot.exists()) { setAccess('not-found'); return }
      const template = snapshot.data()?.templateSnapshot as TemplateSpec | undefined
      setTitle(template?.title ?? '')
      setAccess('ready')
    }).catch((error: unknown) => {
      if (!active) return
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      setAccess(code.includes('permission-denied') ? 'forbidden' : 'read-error')
    })
    return () => { active = false }
  }, [authReady, marketId, services.firestore, user])

  useEffect(() => {
    if (!authReady || !user || !isTeacherIdentity(user) || access !== 'ready') return
    seededRef.current = false
    const statusStop = onValue(ref(services.database, `liveMarkets/${marketId}/meta/status`), (snapshot) => {
      const value = snapshot.val() as MarketStatus | null
      if (value) setStatus(value)
    }, (error) => {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      setAccess(code.includes('permission-denied') ? 'forbidden' : 'read-error')
    })
    const companiesStop = onValue(ref(services.database, `liveMarkets/${marketId}/companies`), (snapshot) => {
      const value = snapshot.val() as LiveMarketState['companies'] | null
      if (!value || seededRef.current) return
      seededRef.current = true
      setDraft(Object.values(value).map((company) => ({ id: company.id, name: company.name, symbol: company.symbol, basePrice: company.basePrice, phases: company.phases })))
    }, (error) => {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      setAccess(code.includes('permission-denied') ? 'forbidden' : 'read-error')
    })
    return () => { statusStop(); companiesStop() }
  }, [access, authReady, marketId, services.database, user])

  if (!authReady) return <AuthLoadingScreen />
  if (!user || !isTeacherIdentity(user)) return <Container component="main" maxWidth="md" sx={{ py: 8 }}><Stack spacing={3} sx={{ alignItems: 'flex-start', maxWidth: 600 }}><Typography component="h1" variant="h2">銘柄を編集する</Typography><Typography color="text.secondary">市場の銘柄を編集するには教師としてログインしてください。</Typography><Button variant="contained" href="/teacher/markets">教師としてログイン</Button></Stack></Container>
  if (access !== 'ready') return <AccessState state={access} />

  const editable = status === 'SETUP' || status === 'PAUSED'
  const updateCompany = (index: number, patch: Partial<MarketCompanyDraft>) => setDraft((current) => current.map((company, companyIndex) => companyIndex === index ? { ...company, ...patch } : company))

  const save = async () => {
    const errors = validateMarketCompanies(draft)
    if (errors.length) { setNotice({ text: errors[0], severity: 'error' }); return }
    setSaving(true)
    try {
      const ok = await updateMarketCompanies(services.database, marketId, user.uid, draft)
      setNotice(ok ? { text: '銘柄を保存しました。', severity: 'success' } : { text: '保存できませんでした。市場が一時停止中か確認してください。', severity: 'error' })
    } catch (error) {
      setNotice({ text: handleFailure(error, '保存できませんでした。'), severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return <AdminShell active="stocks" marketId={marketId} marketTitle={title} marketStatus={status}>
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="overline" color="text.secondary">STOCKS</Typography>
          <Typography component="h1" variant="h2">銘柄を編集する</Typography>
          <Typography color="text.secondary">会社情報と、授業時間内の価格変化を設定します。</Typography>
        </Box>
        {!editable && <Alert severity="info" action={<Button color="inherit" size="small" href={`/teacher/markets/${marketId}/room`}>進行画面を開く</Button>}>編集するには、進行画面で市場を一時停止してください。</Alert>}
        {notice && <Alert severity={notice.severity} role="status">{notice.text}</Alert>}
        <Stack spacing={2}>
          {draft.map((company, companyIndex) => <Card key={company.id} variant="outlined"><CardContent><Stack spacing={2}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField fullWidth label="会社名" disabled={!editable} slotProps={{ htmlInput: { maxLength: TEMPLATE_LIMITS.maxCompanyName } }} value={company.name} onChange={(event) => updateCompany(companyIndex, { name: event.target.value })} />
              <TextField fullWidth label="銘柄コード" disabled={!editable} slotProps={{ htmlInput: { maxLength: TEMPLATE_LIMITS.maxSymbol } }} value={company.symbol} onChange={(event) => updateCompany(companyIndex, { symbol: event.target.value.toUpperCase() })} />
              <TextField fullWidth type="number" label="基準価格（円）" disabled={!editable} slotProps={{ htmlInput: { min: 1, max: TEMPLATE_LIMITS.maxPrice } }} value={company.basePrice} onChange={(event) => updateCompany(companyIndex, { basePrice: Number(event.target.value) })} />
            </Stack>
            <Divider />
            <PricePhaseEditor
              phases={company.phases ?? []}
              disabled={!editable}
              onAddPhase={() => updateCompany(companyIndex, { phases: [...(company.phases ?? []), { id: newId('phase'), startMinute: 0, endMinute: 60, direction: 'FLAT', changePercent: 0 }] })}
              onUpdatePhase={(phaseIndex, patch) => updateCompany(companyIndex, { phases: company.phases?.map((phase, index) => index === phaseIndex ? { ...phase, ...patch } : phase) })}
              onRemovePhase={(phaseIndex) => updateCompany(companyIndex, { phases: company.phases?.filter((_, index) => index !== phaseIndex) })}
            />
          </Stack></CardContent></Card>)}
        </Stack>
        <Button variant="contained" size="large" disabled={!editable || saving} onClick={() => void save()} sx={{ alignSelf: 'flex-start' }}>{saving ? '保存中…' : 'この内容で保存'}</Button>
      </Stack>
    </Container>
  </AdminShell>
}
