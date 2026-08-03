import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { onValue, ref, type Unsubscribe } from 'firebase/database'
import { bootstrapFirebase } from '../lib/firebase/bootstrap'
import { signInTeacherWithGoogle } from '../lib/auth/teacherAuth'
import { getOrCreateStudentUid } from '../lib/auth/studentAuth'
import { isTeacherIdentity } from '../lib/auth/roles'
import { armJoinRequestPresence, createMarket, listOwnedMarkets, RECOVERY_CODE_LENGTH, requestToJoinMarket, resolveJoinCode, type MarketRecord } from '../lib/market/marketRepository'
import type { LiveMarketState, MarketVisibility } from '../lib/market/liveMarketTypes'
import { listOfficialTemplates, listPersonalTemplates } from '../lib/templates/templateRepository'
import { officialTemplateSeeds } from '../lib/templates/officialSeeds'
import { readServiceStatus, type ServiceStatus } from '../lib/service/serviceStatus'
import type { PersonalTemplate, TemplateSpec } from '../lib/templates/types'
import { deleteMarketCompletely } from '../lib/teacher/marketDeletion'
import { buildTeamCsv, buildTransactionCsv, downloadCsv, fetchMarketResults } from '../lib/teacher/resultsExport'
import { getStudentSessionId, readActiveStudentSession, saveActiveStudentSession } from '../lib/students/studentSession'
import { useDatabaseConnected } from '../lib/firebase/connectionState'
import { handleFailure } from '../lib/monitoring/describeError'
import { AppVersion } from './AppVersion'
import { AuthLoadingScreen, SetupProgress, TeacherShell } from './teacher/TeacherShell'
import { OnboardingWizard } from './teacher/OnboardingWizard'
import { Alert, Box, Button, Card, CardActionArea, CardContent, Chip, FormControl, FormControlLabel, MenuItem, Paper, Radio, RadioGroup, Stack, TextField, Typography } from '@mui/material'
import PlayCircleOutlined from '@mui/icons-material/PlayCircleOutlined'
import Google from '@mui/icons-material/Google'
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded'
import { StudentField, StudentPageSurface, StudentSurfaceCard } from './ui/StudentUi'
import { studentPrimaryActionSx } from './ui/studentUiStyles'

const googleSignInErrorMessage = (error: unknown): string => {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
  if (code === 'auth/operation-not-allowed') return 'Google ログインが有効ではありません。Firebase Authentication の Google プロバイダを有効にしてください。'
  if (code === 'auth/popup-blocked') return 'ログイン用ポップアップがブロックされました。ブラウザでこのサイトのポップアップを許可してください。'
  if (code === 'auth/unauthorized-domain') return 'この公開URLが承認済みドメインに登録されていません。Authentication の設定を確認してください。'
  return `Google ログインを完了できませんでした${code ? `（${code}）` : ''}。もう一度お試しください。`
}

export const TeacherMarketDashboard = () => {
  const services = bootstrapFirebase()
  const [user, setUser] = useState<User | null>(services.auth.currentUser), [authNotice, setAuthNotice] = useState('')
  const [authReady, setAuthReady] = useState(false)
  const [templates, setTemplates] = useState<PersonalTemplate[]>([]), [official, setOfficial] = useState(officialTemplateSeeds), [selectedId, setSelectedId] = useState('official:school-festival'), [visibility, setVisibility] = useState<MarketVisibility>('private')
  const [markets, setMarkets] = useState<MarketRecord[]>([])
  const [marketId, setMarketId] = useState(() => new URLSearchParams(window.location.search).get('market') ?? ''), [state, setState] = useState<LiveMarketState | null>(null), [notice, setNotice] = useState(''), [creating, setCreating] = useState(false)
  const [status, setStatus] = useState<ServiceStatus>({ acceptingNewMarkets: true, message: '' })
  const [showOnboarding, setShowOnboarding] = useState(false)
  useEffect(() => onAuthStateChanged(services.auth, (next) => { setUser(next); setAuthReady(true) }), [services.auth])
  // The stop is enforced by the rules; this read only explains the refusal.
  useEffect(() => { void readServiceStatus(services.firestore).then(setStatus) }, [services.firestore])
  const teacher = Boolean(user && isTeacherIdentity(user))
  const refreshOwned = useCallback(async (uid: string) => {
    const [items, published, owned] = await Promise.all([listPersonalTemplates(services.firestore, uid), listOfficialTemplates(services.firestore), listOwnedMarkets(services.firestore, uid)])
    setTemplates(items)
    if (published.length) setOfficial(published.map(({ id, title, description, startingCash, teams, companies }) => ({ id, spec: { title, description, startingCash, teams, companies } })))
    setMarkets(owned)
  }, [services.firestore])
  useEffect(() => { if (!teacher || !user) return; void refreshOwned(user.uid).catch((error) => setNotice(handleFailure(error, 'テンプレートまたは市場を読み込めませんでした。'))) }, [refreshOwned, teacher, user])
  useEffect(() => { if (!marketId) return; const stop: Unsubscribe = onValue(ref(services.database, `liveMarkets/${marketId}`), (snapshot) => setState(snapshot.val() as LiveMarketState | null)); return () => stop() }, [services.database, marketId])
  // The active market must survive a reload: the teacher loses the ability to admit
  // latecomers otherwise, and there is no other way back to this panel.
  useEffect(() => {
    const url = new URL(window.location.href)
    if (marketId) url.searchParams.set('market', marketId)
    else url.searchParams.delete('market')
    window.history.replaceState(null, '', url)
  }, [marketId])
  useEffect(() => {
    if (!teacher || !user) return
    const key = `stock-league:onboarding:${user.uid}`
    if (window.localStorage.getItem(key) !== 'done') setShowOnboarding(true)
  }, [teacher, user])
  const closeOnboarding = () => { if (user) window.localStorage.setItem(`stock-league:onboarding:${user.uid}`, 'done'); setShowOnboarding(false) }
  const selected: TemplateSpec | undefined = useMemo(() => selectedId.startsWith('official:')
    ? official.find((item) => item.id === selectedId.slice(9))?.spec
    : templates.find((item) => item.id === selectedId.slice(9)), [official, selectedId, templates])
  const activeCount = Object.values(state?.participants ?? {}).filter((participant) => participant.connected).length
  const signInWithGoogle = async () => { try { await signInTeacherWithGoogle(services.auth); setAuthNotice('Google アカウントでログインしました。') } catch (error) { setAuthNotice(googleSignInErrorMessage(error)) } }
  const create = async () => { if (!selected || !user) return setNotice('先にテンプレートを作成してください。'); setCreating(true); try { const result = await createMarket(services.firestore, services.database, { ownerUid: user.uid, template: selected, visibility }); setMarketId(result.marketId); await refreshOwned(user.uid); setNotice('市場を作成しました。参加コードを生徒に共有してください。') } catch (error) { setNotice(error instanceof Error && error.message.startsWith('参加コード') ? error.message : handleFailure(error, '市場を作成できませんでした。接続と権限を確認してください。')) } finally { setCreating(false) } }
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
    if (marketId === market.id) { setMarketId(''); setState(null) }
    await refreshOwned(user.uid)
    setNotice('市場を削除しました。')
  }
  if (!authReady) return <AuthLoadingScreen />
  if (!teacher || !user) return <Box component="main" className="portal-page" sx={{ display: 'grid', gridTemplateColumns: { md: 'minmax(0, 1fr) minmax(18rem, 0.75fr)' }, minHeight: '100dvh' }}><Stack component="section" className="portal-auth" spacing={3} sx={{ justifyContent: 'center', px: { xs: 3, sm: 6 }, py: 6 }}><Button component="a" href="/" variant="text" color="inherit" sx={{ alignSelf: 'flex-start' }}>← Stock League Classroom</Button><Typography variant="overline" color="primary">TEACHER PORTAL</Typography><Typography component="h1" variant="h2">授業の市場を、<br />ここから準備。</Typography><Typography color="text.secondary">Google アカウントでログインすると、テンプレートの編集、市場の作成、参加状況の管理ができます。</Typography><Button variant="contained" size="large" onClick={() => void signInWithGoogle()} startIcon={<Google />} endIcon={<ArrowForwardRounded />} sx={{ alignSelf: 'flex-start', gap: 0.5 }}>Googleでログイン</Button>{authNotice && <Alert severity="info" role="status">{authNotice}</Alert>}<Typography variant="body2" color="text.secondary">教師用の Google アカウントを選択してください。</Typography></Stack><Stack component="aside" className="portal-aside" spacing={3} sx={{ justifyContent: 'center', px: { xs: 3, sm: 6 }, py: 6 }}><Typography variant="overline">CLASSROOM MARKET</Typography><Typography component="h2" variant="h4">準備から振り返りまで、<br />一つの教室で。</Typography><Box component="ul" sx={{ display: 'grid', gap: 1, m: 0, pl: 3 }}><li>授業テーマに合うテンプレート</li><li>生徒の参加をその場で承認</li><li>市場の進行をリアルタイムで管理</li></Box></Stack></Box>
  const hasMarkets = markets.length > 0
  const marketStep = marketId ? (state?.meta?.status === 'OPEN' || state?.meta?.status === 'ENDING' || state?.meta?.status === 'ENDED' ? 3 : 2) : hasMarkets ? 0 : 1
  return <TeacherShell active="markets" email={user.email} marketId={marketId} onShowGuide={() => setShowOnboarding(true)}><Box component="main" className="teacher-page">
    <Stack component="header" className="teacher-header" direction="row" spacing={2} sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Typography className="mobile-page-title" variant="h6">市場の管理</Typography><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Button className="header-help" variant="text" onClick={() => setShowOnboarding(true)}>使い方</Button><Chip className="teacher-avatar" label={(user.email ?? 'T').slice(0, 1).toUpperCase()} aria-label="教師アカウント" /><AppVersion /></Stack></Stack>
    <section className="teacher-hero"><div><p className="portal-eyebrow">TEACHER PORTAL</p><h1>{hasMarkets ? <>今日の授業を、<br /><em>市場にしよう。</em></> : <>授業の準備を、<br /><em>ここから。</em></>}</h1><p>{hasMarkets ? '作成済みの市場を選んで、参加受付や進行を始めます。' : 'テンプレートを選び、市場を作成して授業の入口を準備しましょう。'}</p></div><div className="teacher-stats"><div><span>選べるテンプレート</span><strong>{official.length + templates.length}</strong></div><div><span>市場の定員</span><strong>80 <small>人</small></strong></div><div><span>現在の参加者</span><strong>{activeCount}</strong></div></div></section>
    <div className="teacher-progress-wrap"><SetupProgress steps={[{ label: 'テンプレート選択', detail: '授業内容を選ぶ' }, { label: '市場を作成', detail: '公開範囲を確認' }, { label: '参加を受付', detail: 'コードを共有' }, { label: '市場を進行', detail: '開始から結果まで' }]} current={marketStep} label="授業の進め方" /></div>
    {hasMarkets && <Box component="section" className="market-picker-card" sx={{ maxWidth: 1280, mx: 'auto', mb: 3, px: { xs: 2, sm: 4 } }}><Paper elevation={0} sx={{ p: { xs: 2, sm: 3 } }}><Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}><Box><Typography className="section-kicker" variant="overline" color="primary">YOUR MARKETS</Typography><Typography variant="h5">管理する市場を選択</Typography><Typography color="text.secondary">一覧から市場を選ぶと、参加受付・進行・教室画面を開けます。</Typography></Box><Button variant="contained" onClick={() => { setNotice('下の市場作成フォームから、新しい授業用市場を作成できます。'); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }) }}>市場を新規作成</Button></Stack><Box component="ul" className="market-picker-list" sx={{ mt: 2 }}>{markets.map((market) => <Box component="li" key={market.id} className={market.id === marketId ? 'selected' : ''}><Button fullWidth variant="text" onClick={() => { setMarketId(market.id); setState(null) }} sx={{ justifyContent: 'space-between', textAlign: 'left', py: 1.5, px: 1.75 }}><Box><Typography sx={{ fontWeight: 800 }}>{market.templateSnapshot.title}</Typography><Typography variant="body2" color="text.secondary">参加コード {market.joinCode} ・ {market.creationStatus}</Typography></Box><ArrowForwardRounded fontSize="small" /></Button></Box>)}</Box></Paper></Box>}
    <Box component="section" className="teacher-workspace"><Paper component="section" className="create-market-card" elevation={0} sx={{ p: { xs: 2, sm: 3 } }}><Stack className="card-heading" direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between' }}><Box><Typography className="section-kicker" variant="overline" color="primary">NEW MARKET</Typography><Typography variant="h5">1. テンプレートを選ぶ</Typography></Box><Button component="a" href="/templates" variant="text">自分で編集 →</Button></Stack>{notice && <Alert severity="info" role="status" sx={{ mt: 2 }}>{notice}</Alert>}{!status.acceptingNewMarkets && <Alert severity="warning" role="alert" sx={{ mt: 2 }}><strong>現在、新しい市場の作成を停止しています。</strong><br />{status.message || 'メンテナンスのため一時的に受付を止めています。進行中の市場はそのままご利用いただけます。'}</Alert>}<FormControl component="fieldset" fullWidth sx={{ mt: 3 }}><Typography component="legend" variant="subtitle1">使うテンプレート</Typography><RadioGroup name="template" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><Box className="template-option-grid" sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { sm: 'repeat(2, minmax(0, 1fr))' }, mt: 1 }}>{official.map((item, index) => { const value = `official:${item.id}`; return <Card key={value} variant="outlined" sx={{ borderColor: selectedId === value ? 'primary.main' : 'divider' }}><CardActionArea component="label"><CardContent><FormControlLabel value={value} control={<Radio />} label={<Stack><Typography variant="subtitle1">{index + 1}. {item.spec.title}</Typography><Typography variant="body2" color="text.secondary">{item.spec.companies.length}銘柄 ・ ¥{item.spec.startingCash.toLocaleString()}</Typography></Stack>} sx={{ m: 0, width: '100%' }} /></CardContent></CardActionArea></Card> })}{templates.map((item) => { const value = `personal:${item.id}`; return <Card key={value} variant="outlined" sx={{ borderColor: selectedId === value ? 'primary.main' : 'divider' }}><CardActionArea component="label"><CardContent><FormControlLabel value={value} control={<Radio />} label={<Stack><Typography variant="subtitle1">自分のテンプレート: {item.title}</Typography><Typography variant="body2" color="text.secondary">{item.companies.length}銘柄 ・ ¥{item.startingCash.toLocaleString()}</Typography></Stack>} sx={{ m: 0, width: '100%' }} /></CardContent></CardActionArea></Card> })}</Box></RadioGroup></FormControl><Stack className="market-create-footer" direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', mt: 3 }}><Box><Typography variant="subtitle1">{selected?.title ?? 'テンプレートを選択してください'}</Typography><Typography variant="body2" color="text.secondary">{selected?.description}</Typography></Box><TextField select label="公開範囲" value={visibility} onChange={(event) => setVisibility(event.target.value as MarketVisibility)} sx={{ minWidth: { sm: 220 } }}><MenuItem value="private">参加者のみ</MenuItem><MenuItem value="ranking_only">順位のみ公開</MenuItem><MenuItem value="public">価格・ニュース・順位を公開</MenuItem></TextField></Stack><Button variant="contained" size="large" type="button" disabled={!selected || creating || !status.acceptingNewMarkets} onClick={() => void create()} sx={{ mt: 3 }}>{creating ? '市場を準備中…' : !status.acceptingNewMarkets ? '受付を停止しています' : 'この内容で市場を作成'}　→</Button></Paper>{marketId && <Paper component="section" className="active-market-card" elevation={0} sx={{ mt: 3, p: { xs: 2, sm: 3 } }}><Stack className="active-head" direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}><Box><Typography className="section-kicker" variant="overline" color="primary">ACTIVE MARKET</Typography><Typography variant="h5">2. 参加受付・進行はコントロールルームで</Typography><Typography color="text.secondary" sx={{ mt: 1 }}>参加コードの共有、参加申請の承認、市場の開始・終了、ニュース配信は、すべてコントロールルームにまとまっています。</Typography></Box><Button variant="contained" size="large" href={`/teacher/markets/${marketId}/room`} startIcon={<PlayCircleOutlined />}>コントロールルームを開く</Button></Stack></Paper>}<section className="template-section market-history"><div className="template-section-head"><div><p className="section-kicker">MARKET HISTORY</p><h2>作成済み市場</h2></div><span>{markets.length} 件</span></div>{markets.length ? <ul className="template-list">{markets.map((market) => <li key={market.id}><div><strong>{market.templateSnapshot.title}</strong><p>参加コード {market.joinCode} ・ {market.creationStatus}</p></div><Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}><Button size="small" variant="outlined" type="button" onClick={() => { setMarketId(market.id); setState(null) }}>選択</Button><Button size="small" variant="contained" href={`/teacher/markets/${market.id}/room`}>コントロールルームを開く</Button><Button size="small" variant="outlined" href={`/markets/${market.id}/signage`}>教室画面</Button><Button size="small" variant="outlined" type="button" onClick={() => void exportResults(market).catch((error) => setNotice(handleFailure(error, '結果を読み込めませんでした。')))}>結果をCSVで保存</Button><Button size="small" color="error" variant="outlined" type="button" onClick={() => void removeMarket(market).catch((error) => setNotice(handleFailure(error, '市場を削除できませんでした。一部だけ削除された可能性があります。もう一度削除を実行してください。')))}>削除</Button></Stack></li>)}</ul> : <p className="empty-copy">まだ市場はありません。</p>}</section></Box>
    <OnboardingWizard open={showOnboarding} onClose={closeOnboarding} />
  </Box></TeacherShell>
}

export const StudentMarketJoin = () => {
  const services = bootstrapFirebase()
  const [joinCode, setJoinCode] = useState(() => new URLSearchParams(window.location.search).get('code')?.toUpperCase() ?? ''), [displayName, setDisplayName] = useState(''), [recoveryCode, setRecoveryCode] = useState(''), [marketId, setMarketId] = useState(''), [requestId, setRequestId] = useState('')
  const [status, setStatus] = useState<'entry' | 'requesting' | 'waiting' | 'approved' | 'error'>('entry'), [message, setMessage] = useState('参加コードを入力して、先生の市場に参加しましょう。')
  const activeSession = readActiveStudentSession()
  const presentedRecoveryCodeRef = useRef('')
  const connected = useDatabaseConnected(services.database)
  useEffect(() => { if (!marketId || !requestId) return; const stop = onValue(ref(services.database, `liveMarkets/${marketId}/joinRequests/${requestId}`), (snapshot) => { if (snapshot.val()?.approvedAtMillis) { const active = { marketId, requestId, sessionId: getStudentSessionId(), ...(presentedRecoveryCodeRef.current ? { presentedRecoveryCode: presentedRecoveryCodeRef.current } : {}) }; saveActiveStudentSession(active); setStatus('approved'); setMessage('参加が承認されました。市場画面へ移動します。'); window.location.assign(`/markets/${marketId}/play`) } }); return () => stop() }, [marketId, requestId, services.database])
  // The onDisconnect handler armed at request time does not survive a reconnect, so a
  // waiting student whose screen locks twice would flip connected back to true once but
  // then never again — vanishing from the teacher's admission panel on the second drop.
  // Re-arming on every reconnection, exactly as StudentMarketPage's matching effect does
  // for approved participants via armApprovedParticipantPresence, closes that gap too.
  useEffect(() => { if (status !== 'waiting' || !marketId || !requestId || !connected) return; void armJoinRequestPresence(services.database, marketId, requestId).catch((error) => setMessage(handleFailure(error, '接続状態を更新できませんでした。'))) }, [connected, marketId, requestId, services.database, status])
  const join = async () => { if (!joinCode.trim() || !displayName.trim()) { setStatus('error'); return setMessage('参加コードと表示名を入力してください。') }; const normalizedRecoveryCode = recoveryCode.trim().toUpperCase(); if (normalizedRecoveryCode && normalizedRecoveryCode.length !== RECOVERY_CODE_LENGTH) { setStatus('error'); return setMessage(`復帰コードを確認してください。${RECOVERY_CODE_LENGTH}文字で入力してください。`) }; setStatus('requesting'); try { const uid = await getOrCreateStudentUid(services.auth); const resolved = await resolveJoinCode(services.firestore, joinCode); if (!resolved) throw new Error('NOT_FOUND'); presentedRecoveryCodeRef.current = normalizedRecoveryCode; const id = await requestToJoinMarket(services.database, resolved, { uid, sessionId: getStudentSessionId(), displayName: displayName.trim(), requestedTeamId: null, ...(normalizedRecoveryCode ? { recoveryCode: normalizedRecoveryCode } : {}) }); setMarketId(resolved); setRequestId(id); setStatus('waiting'); setMessage('参加を申請しました。先生の承認をお待ちください。') } catch (error) { setStatus('error'); setMessage(error instanceof Error && error.message === 'NOT_FOUND' ? '市場が見つかりません。参加コードを確認してください。' : handleFailure(error, 'この市場は参加受付を終了しているか、接続できません。')) } }
  const joining = status === 'waiting' || status === 'requesting'
  return <StudentPageSurface><Box sx={{ px: { xs: 2, sm: 4 }, py: 3 }}><Stack component="header" direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: { xs: 3, sm: 5 }, maxWidth: 1040, mx: 'auto' }}><Button component="a" href="/" color="inherit" sx={{ minHeight: 48, px: 1, fontWeight: 800 }}>Stock League Classroom</Button><Typography variant="overline" color="text.secondary">STUDENT ENTRY</Typography></Stack><Box sx={{ maxWidth: 460, mx: 'auto' }}><StudentSurfaceCard><Stack spacing={2.25} sx={{ p: { xs: 3, sm: 4 } }}><Typography variant="overline" color="text.secondary">JOIN A MARKET</Typography><Typography component="h1" variant="h4" sx={{ fontWeight: 800 }}>市場に参加</Typography><Typography color="text.secondary">先生から受け取った参加コードと、教室で使う表示名を入力してください。</Typography>{activeSession && <Button component="a" href={`/markets/${activeSession.marketId}/play`} color="inherit" variant="text" sx={{ alignSelf: 'flex-start', px: 0 }}>前回の市場へ戻る →</Button>}{status === 'approved' ? <Alert severity="success"><Typography variant="h6">参加準備ができました</Typography>{message}</Alert> : <><StudentField label="参加コード" value={joinCode} maxLength={6} placeholder="例: A1B2C3" onChange={(event) => setJoinCode(event.target.value.toUpperCase())} disabled={joining} /><StudentField label="表示名（本名は入力しないでください）" value={displayName} maxLength={20} placeholder="例: ナナシ" onChange={(event) => setDisplayName(event.target.value)} disabled={joining} /><StudentField label="復帰コード（任意）" value={recoveryCode} maxLength={4} placeholder="例: A1B2" helperText="前の端末に表示された4文字です。初参加なら空欄で構いません。使う場合は、表示名も前回と同じ文字で入力してください。" onChange={(event) => setRecoveryCode(event.target.value.toUpperCase())} disabled={joining} /><Button variant="contained" size="large" type="button" fullWidth onClick={() => void join()} disabled={joining} sx={studentPrimaryActionSx}>{status === 'requesting' ? '市場を確認中…' : status === 'waiting' ? '先生の承認を待っています' : '参加を申請する'}　→</Button><Alert severity={status === 'error' ? 'error' : 'info'} role="status">{message}</Alert></>}</Stack></StudentSurfaceCard><Typography component="footer" variant="body2" color="text.secondary" align="center" sx={{ display: 'block', mt: 3 }}>投資はシミュレーションです。実際のお金は使用しません。</Typography></Box></Box></StudentPageSurface>
}
