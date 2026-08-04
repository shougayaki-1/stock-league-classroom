import { useCallback, useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { onValue, ref, type Unsubscribe } from 'firebase/database'
import { useNavigate } from 'react-router'
import { bootstrapFirebase } from '../../lib/firebase/bootstrap'
import { getTeacherGoogleRedirectResult, signInTeacherWithGoogle } from '../../lib/auth/teacherAuth'
import { isTeacherIdentity } from '../../lib/auth/roles'
import { createMarket, listOwnedMarkets, type MarketRecord } from '../../lib/market/marketRepository'
import type { LiveMarketState, MarketVisibility } from '../../lib/market/liveMarketTypes'
import { MARKET_STATUS_LABEL } from '../../lib/market/marketStatusLabels'
import { listOfficialTemplates, listPersonalTemplates } from '../../lib/templates/templateRepository'
import { officialTemplateSeeds } from '../../lib/templates/officialSeeds'
import { readServiceStatus, type ServiceStatus } from '../../lib/service/serviceStatus'
import type { PersonalTemplate, TemplateSpec } from '../../lib/templates/types'
import { deleteMarketCompletely } from '../../lib/teacher/marketDeletion'
import { buildTeamCsv, buildTransactionCsv, downloadCsv, fetchMarketResults } from '../../lib/teacher/resultsExport'
import { handleFailure } from '../../lib/monitoring/describeError'
import { AppVersion } from '../AppVersion'
import { AuthLoadingScreen } from './TeacherShell'
import { OnboardingWizard } from './OnboardingWizard'
import { Alert, Box, Button, Card, CardActionArea, CardContent, Chip, FormControl, FormControlLabel, MenuItem, Paper, Radio, RadioGroup, Stack, TextField, Typography } from '@mui/material'
import Google from '@mui/icons-material/Google'
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded'

const googleSignInErrorMessage = (error: unknown): string => {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
  if (code === 'auth/operation-not-allowed') return 'Google ログインが有効ではありません。Firebase Authentication の Google プロバイダを有効にしてください。'
  if (code === 'auth/unauthorized-domain') return 'この公開URLが承認済みドメインに登録されていません。Authentication の設定を確認してください。'
  return `Google ログインを完了できませんでした${code ? `（${code}）` : ''}。もう一度お試しください。`
}

export const WorkspacePicker = () => {
  const services = bootstrapFirebase()
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(services.auth.currentUser), [authNotice, setAuthNotice] = useState('')
  const [authReady, setAuthReady] = useState(false)
  const [templates, setTemplates] = useState<PersonalTemplate[]>([]), [official, setOfficial] = useState(officialTemplateSeeds), [selectedId, setSelectedId] = useState('official:school-festival'), [visibility, setVisibility] = useState<MarketVisibility>('private')
  const [markets, setMarkets] = useState<MarketRecord[]>([])
  const [marketMeta, setMarketMeta] = useState<Record<string, LiveMarketState['meta'] | undefined>>({})
  const [marketParticipants, setMarketParticipants] = useState<Record<string, LiveMarketState['participants']>>({})
  const [notice, setNotice] = useState(''), [creating, setCreating] = useState(false)
  const [status, setStatus] = useState<ServiceStatus>({ acceptingNewMarkets: true, message: '' })
  const [showOnboarding, setShowOnboarding] = useState(false)
  useEffect(() => onAuthStateChanged(services.auth, (next) => { setUser(next); setAuthReady(true) }), [services.auth])
  useEffect(() => {
    let cancelled = false
    void getTeacherGoogleRedirectResult(services.auth)
      .then((result) => { if (!cancelled && result) setAuthNotice('Google アカウントでログインしました。') })
      .catch((error) => { if (!cancelled) setAuthNotice(googleSignInErrorMessage(error)) })
    return () => { cancelled = true }
  }, [services.auth])
  useEffect(() => { void readServiceStatus(services.firestore).then(setStatus) }, [services.firestore])
  const teacher = Boolean(user && isTeacherIdentity(user))
  const refreshOwned = useCallback(async (uid: string) => {
    const [items, published, owned] = await Promise.all([listPersonalTemplates(services.firestore, uid), listOfficialTemplates(services.firestore), listOwnedMarkets(services.firestore, uid)])
    setTemplates(items)
    if (published.length) setOfficial(published.map(({ id, title, description, startingCash, teams, companies }) => ({ id, spec: { title, description, startingCash, teams, companies } })))
    setMarkets(owned)
  }, [services.firestore])
  useEffect(() => { if (!teacher || !user) return; void refreshOwned(user.uid).catch((error) => setNotice(handleFailure(error, 'テンプレートまたは市場を読み込めませんでした。'))) }, [refreshOwned, teacher, user])
  useEffect(() => {
    const stops: Unsubscribe[] = markets.flatMap((market) => [
      onValue(ref(services.database, `liveMarkets/${market.id}/meta`), (snapshot) => {
        setMarketMeta((current) => ({ ...current, [market.id]: snapshot.val() as LiveMarketState['meta'] | undefined }))
      }),
      onValue(ref(services.database, `liveMarkets/${market.id}/participants`), (snapshot) => {
        setMarketParticipants((current) => ({ ...current, [market.id]: snapshot.val() as LiveMarketState['participants'] }))
      }),
    ])
    return () => stops.forEach((stop) => stop())
  }, [markets, services.database])
  useEffect(() => {
    if (!teacher || !user) return
    const key = `stock-league:onboarding:${user.uid}`
    if (window.localStorage.getItem(key) !== 'done') setShowOnboarding(true)
  }, [teacher, user])
  const closeOnboarding = () => { if (user) window.localStorage.setItem(`stock-league:onboarding:${user.uid}`, 'done'); setShowOnboarding(false) }
  const selected: TemplateSpec | undefined = useMemo(() => selectedId.startsWith('official:')
    ? official.find((item) => item.id === selectedId.slice(9))?.spec
    : templates.find((item) => item.id === selectedId.slice(9)), [official, selectedId, templates])
  const signInWithGoogle = async () => {
    setAuthNotice('Google ログイン画面へ移動します。選択後、この画面に戻ります。')
    try { await signInTeacherWithGoogle(services.auth) } catch (error) { setAuthNotice(googleSignInErrorMessage(error)) }
  }
  const create = async () => {
    if (!selected || !user) return setNotice('先にテンプレートを選んでください。')
    setCreating(true)
    try {
      const result = await createMarket(services.firestore, services.database, { ownerUid: user.uid, template: selected, visibility })
      navigate(`/teacher/markets/${result.marketId}/room`)
    } catch (error) {
      setNotice(error instanceof Error && error.message.startsWith('参加コード') ? error.message : handleFailure(error, '市場を作成できませんでした。接続と権限を確認してください。'))
    } finally {
      setCreating(false)
    }
  }
  const exportResults = async (market: MarketRecord) => {
    const companyNames = Object.fromEntries(market.templateSnapshot.companies.map((company) => [company.id, company.name]))
    const { teams, participants } = await fetchMarketResults(services.firestore, market.id)
    if (!teams.length && !participants.length) return setNotice('この市場にはまだ確定した結果がありません。市場を終了してからお試しください。')
    const stamp = market.templateSnapshot.title.replace(/[^\p{L}\p{N}]+/gu, '_')
    downloadCsv(`${stamp}_チーム結果.csv`, buildTeamCsv(teams, companyNames))
    downloadCsv(`${stamp}_取引履歴.csv`, buildTransactionCsv(participants, companyNames))
    setNotice('結果を CSV で保存しました。')
  }
  const removeMarket = async (market: MarketRecord) => {
    if (!user || !window.confirm(`市場「${market.templateSnapshot.title}」を削除しますか？結果・取引履歴・参加コードがすべて消え、元に戻せません。必要なら先に「結果をCSVで保存」してください。`)) return
    await deleteMarketCompletely(services.firestore, services.database, market.id)
    await refreshOwned(user.uid)
    setNotice('市場を削除しました。')
  }
  if (!authReady) return <AuthLoadingScreen />
  if (!teacher || !user) return <Box component="main" sx={{ display: 'grid', gridTemplateColumns: { md: 'minmax(0, 1fr) minmax(18rem, 0.75fr)' }, minHeight: '100dvh' }}>
    <Stack component="section" spacing={3} sx={{ justifyContent: 'center', px: { xs: 3, sm: 6 }, py: 6 }}>
      <Button component="a" href="/" variant="text" color="inherit" sx={{ alignSelf: 'flex-start' }}>← Stock League Classroom</Button>
      <Typography variant="overline" color="primary">TEACHER PORTAL</Typography>
      <Typography component="h1" variant="h2">授業の市場を、<br />ここから準備。</Typography>
      <Typography color="text.secondary">Google アカウントでログインすると、テンプレートの編集、市場の作成、参加状況の管理ができます。</Typography>
      <Button variant="contained" size="large" onClick={() => void signInWithGoogle()} startIcon={<Google />} endIcon={<ArrowForwardRounded />} sx={{ alignSelf: 'flex-start', gap: 0.5 }}>Googleでログイン</Button>
      {authNotice && <Alert severity="info" role="status">{authNotice}</Alert>}
    </Stack>
    <Stack component="aside" spacing={3} sx={{ justifyContent: 'center', px: { xs: 3, sm: 6 }, py: 6, color: 'primary.contrastText', bgcolor: 'primary.main', display: { xs: 'none', md: 'flex' } }}>
      <Typography variant="overline" sx={{ opacity: 0.85 }}>CLASSROOM MARKET</Typography>
      <Typography component="h2" variant="h4">準備から振り返りまで、<br />一つの教室で。</Typography>
      <Box component="ul" sx={{ display: 'grid', gap: 1, m: 0, pl: 3 }}><li>授業テーマに合うテンプレート</li><li>生徒の参加をその場で承認</li><li>市場の進行をリアルタイムで管理</li></Box>
    </Stack>
  </Box>
  const hasMarkets = markets.length > 0
  return <Box component="main" sx={{ minHeight: '100dvh', bgcolor: 'background.default' }}>
    <Stack component="header" direction="row" spacing={2} sx={{ justifyContent: 'space-between', alignItems: 'center', px: { xs: 2, sm: 4 }, py: 2, borderBottom: 1, borderColor: 'divider' }}>
      <Typography variant="h6" sx={{ fontWeight: 800 }}>Stock League Classroom</Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Button variant="text" onClick={() => setShowOnboarding(true)}>使い方</Button>
        <Chip label={(user.email ?? 'T').slice(0, 1).toUpperCase()} aria-label="教師アカウント" />
        <AppVersion />
      </Stack>
    </Stack>
    <Box sx={{ maxWidth: 1200, mx: 'auto', px: { xs: 2, sm: 4 }, py: { xs: 3, sm: 5 } }}>
      <Stack spacing={4}>
        {notice && <Alert severity="info" role="status" onClose={() => setNotice('')}>{notice}</Alert>}
        <Box>
          <Typography variant="overline" color="primary">WORKSPACES</Typography>
          <Typography component="h1" variant="h4" sx={{ fontWeight: 800 }}>{hasMarkets ? '授業を選ぶ' : '最初の授業を作りましょう'}</Typography>
          <Typography color="text.secondary">{hasMarkets ? '作成済みの市場をクリックすると、その市場のコントロールルームに入ります。' : 'テンプレートを選んで、最初の市場を作成してください。'}</Typography>
        </Box>
        {hasMarkets && <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' } }}>
          {markets.map((market) => {
            const activeCount = Object.values(marketParticipants[market.id] ?? {}).filter((participant) => participant.connected).length
            const marketStatus = marketMeta[market.id]?.status ?? 'SETUP'
            return <Card key={market.id} variant="outlined">
              <CardActionArea component="a" href={`/teacher/markets/${market.id}/room`}>
                <CardContent>
                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Typography component="h2" variant="h6" sx={{ fontWeight: 800 }}>{market.templateSnapshot.title}</Typography>
                    <Chip size="small" label={MARKET_STATUS_LABEL[marketStatus]} color={marketStatus === 'OPEN' ? 'success' : marketStatus === 'PAUSED' ? 'warning' : 'default'} />
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>参加コード {market.joinCode} ・ 参加者 {activeCount} 人</Typography>
                </CardContent>
              </CardActionArea>
              <Stack direction="row" spacing={1} sx={{ px: 2, pb: 2, flexWrap: 'wrap' }}>
                <Button size="small" variant="outlined" href={`/markets/${market.id}/signage`} target="_blank" rel="noopener">教室画面</Button>
                <Button size="small" variant="outlined" type="button" onClick={() => void exportResults(market).catch((error) => setNotice(handleFailure(error, '結果を読み込めませんでした。')))}>結果をCSVで保存</Button>
                <Button size="small" color="error" variant="outlined" type="button" onClick={() => void removeMarket(market).catch((error) => setNotice(handleFailure(error, '市場を削除できませんでした。一部だけ削除された可能性があります。もう一度削除を実行してください。')))}>削除</Button>
              </Stack>
            </Card>
          })}
        </Box>}
        <Paper component="section" variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', mb: 2 }}>
            <Box>
              <Typography variant="overline" color="primary">NEW WORKSPACE</Typography>
              <Typography component="h2" variant="h5" sx={{ fontWeight: 800 }}>＋ 新しい授業を作る</Typography>
            </Box>
            <Button component="a" href="/templates" variant="text">自分で編集 →</Button>
          </Stack>
          {!status.acceptingNewMarkets && <Alert severity="warning" role="alert" sx={{ mb: 2 }}><strong>現在、新しい市場の作成を停止しています。</strong><br />{status.message || 'メンテナンスのため一時的に受付を止めています。進行中の市場はそのままご利用いただけます。'}</Alert>}
          <FormControl component="fieldset" fullWidth>
            <Typography component="legend" variant="subtitle1">使うテンプレート</Typography>
            <RadioGroup name="template" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { sm: 'repeat(2, minmax(0, 1fr))' }, mt: 1 }}>
                {official.map((item, index) => { const value = `official:${item.id}`; return <Card key={value} variant="outlined" sx={{ borderColor: selectedId === value ? 'primary.main' : 'divider' }}>
                  <CardActionArea component="label"><CardContent><FormControlLabel value={value} control={<Radio />} label={<Stack><Typography variant="subtitle1">{index + 1}. {item.spec.title}</Typography><Typography variant="body2" color="text.secondary">{item.spec.companies.length}銘柄 ・ ¥{item.spec.startingCash.toLocaleString()}</Typography></Stack>} sx={{ m: 0, width: '100%' }} /></CardContent></CardActionArea>
                </Card> })}
                {templates.map((item) => { const value = `personal:${item.id}`; return <Card key={value} variant="outlined" sx={{ borderColor: selectedId === value ? 'primary.main' : 'divider' }}>
                  <CardActionArea component="label"><CardContent><FormControlLabel value={value} control={<Radio />} label={<Stack><Typography variant="subtitle1">自分のテンプレート: {item.title}</Typography><Typography variant="body2" color="text.secondary">{item.companies.length}銘柄 ・ ¥{item.startingCash.toLocaleString()}</Typography></Stack>} sx={{ m: 0, width: '100%' }} /></CardContent></CardActionArea>
                </Card> })}
              </Box>
            </RadioGroup>
          </FormControl>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', mt: 3 }}>
            <Box><Typography variant="subtitle1">{selected?.title ?? 'テンプレートを選択してください'}</Typography><Typography variant="body2" color="text.secondary">{selected?.description}</Typography></Box>
            <TextField select label="公開範囲" value={visibility} onChange={(event) => setVisibility(event.target.value as MarketVisibility)} sx={{ minWidth: { sm: 220 } }}>
              <MenuItem value="private">参加者のみ</MenuItem><MenuItem value="ranking_only">順位のみ公開</MenuItem><MenuItem value="public">価格・ニュース・順位を公開</MenuItem>
            </TextField>
          </Stack>
          <Button variant="contained" size="large" type="button" disabled={!selected || creating || !status.acceptingNewMarkets} onClick={() => void create()} sx={{ mt: 3 }}>{creating ? '市場を準備中…' : !status.acceptingNewMarkets ? '受付を停止しています' : 'この内容で市場を作成'}　→</Button>
        </Paper>
      </Stack>
    </Box>
    <OnboardingWizard open={showOnboarding} onClose={closeOnboarding} />
  </Box>
}
