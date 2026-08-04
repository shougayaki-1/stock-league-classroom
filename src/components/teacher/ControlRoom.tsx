import { useEffect, useMemo, useRef, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { onValue, ref } from 'firebase/database'
import { useSearchParams } from 'react-router'
import { bootstrapFirebase } from '../../lib/firebase/bootstrap'
import { isTeacherIdentity } from '../../lib/auth/roles'
import { acquireHostLease, armHostLeaseDisconnect, openMarket, pauseMarket, publishManualNews, requestMarketEnding, runHostTick } from '../../lib/market/hostTrading'
import { serverNow } from '../../lib/firebase/serverTime'
import { AdmissionPanel } from './AdmissionPanel'
import { PhaseBand } from './PhaseBand'
import { HostStatusPanel } from './HostStatusPanel'
import { MarketControlPanel } from './MarketControlPanel'
import { NewsPublishPanel } from './NewsPublishPanel'
import { SignageLinkPanel } from './SignageLinkPanel'
import { approveJoinRequest, reassignParticipantTeam, rejectJoinRequest, removeParticipant, resolveRecoveryTeamId, setAutoApprove } from '../../lib/market/marketRepository'
import type { LiveMarketState, TeamAssignmentMode } from '../../lib/market/liveMarketTypes'
import type { TemplateSpec } from '../../lib/templates/types'
import { useDatabaseOffline } from '../../lib/firebase/connectionState'
import { useHostInterruption, useUnloadWarning, useWakeLock } from '../../lib/host/hostContinuity'
import { handleFailure } from '../../lib/monitoring/describeError'
import { AuthLoadingScreen } from './TeacherShell'
import { AdminShell } from './AdminShell'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Link,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material'

type MarketAccess = 'loading' | 'ready' | 'not-found' | 'forbidden' | 'read-error'
type ControlRoomTab = 'admission' | 'control' | 'news' | 'signage'
const TAB_ORDER: ControlRoomTab[] = ['admission', 'control', 'news', 'signage']
const TAB_LABEL: Record<ControlRoomTab, string> = { admission: '参加受付', control: '進行操作', news: 'ニュース配信', signage: '教室画面' }
const isControlRoomTab = (value: string | null): value is ControlRoomTab => TAB_ORDER.includes(value as ControlRoomTab)

const MarketAccessState = ({ state }: { state: Exclude<MarketAccess, 'ready'> }) => {
  const content = state === 'loading'
    ? { title: '市場を確認しています', detail: '市場の設定とアクセス権を読み込んでいます。' }
    : state === 'not-found'
      ? { title: 'この市場は見つかりません', detail: '削除されたか、URLが正しくない可能性があります。' }
      : state === 'forbidden'
        ? { title: 'この市場を進行する権限がありません', detail: '市場を作成した教師アカウントでログインしているか確認してください。' }
        : { title: '市場を読み込めません', detail: '通信状態を確認してから、もう一度お試しください。' }
  return <Container component="main" maxWidth="md" sx={{ py: 8 }}><Stack spacing={2} sx={{ alignItems: 'flex-start', maxWidth: 520 }}>
    {state === 'loading' && <CircularProgress aria-label="市場を読み込んでいます" />}
    <Typography component="h1" variant="h2">{content.title}</Typography>
    <Typography color="text.secondary">{content.detail}</Typography>
    {state !== 'loading' && <Alert severity={state === 'read-error' ? 'warning' : 'info'}>{content.detail}</Alert>}
    {state !== 'loading' && <Button variant="contained" href="/teacher/markets">市場の管理へ戻る</Button>}
  </Stack></Container>
}

const leaseId = () => crypto.randomUUID()

export const ControlRoom = ({ marketId }: { marketId: string }) => {
  const services = bootstrapFirebase(); const [user, setUser] = useState<User | null>(services.auth.currentUser)
  const [authReady, setAuthReady] = useState(false)
  const [marketAccess, setMarketAccess] = useState<MarketAccess>('loading')
  const [lease, setLease] = useState(''); const [notice, setNotice] = useState(''); const [template, setTemplate] = useState<TemplateSpec | null>(null)
  const [live, setLive] = useState<LiveMarketState | null>(null)
  const [mode, setMode] = useState<TeamAssignmentMode>('random')
  const [nowMillis, setNowMillis] = useState(() => serverNow())
  const [lastTickAtMillis, setLastTickAtMillis] = useState<number>()
  const [hostingSinceMillis, setHostingSinceMillis] = useState<number>()
  const [endingConfirm, setEndingConfirm] = useState(false); const [ending, setEnding] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const liveRef = useRef<LiveMarketState | null>(null)
  const autoApproving = useRef(false)
  useEffect(() => { liveRef.current = live }, [live])
  useEffect(() => { const timer = window.setInterval(() => setNowMillis(serverNow()), 1_000); return () => window.clearInterval(timer) }, [])
  const interruption = useHostInterruption(Boolean(lease))
  useWakeLock(Boolean(lease))
  useUnloadWarning(Boolean(lease))
  const offline = useDatabaseOffline(services.database)
  useEffect(() => onAuthStateChanged(services.auth, (next) => { setUser(next); setAuthReady(true) }), [services.auth])
  useEffect(() => {
    if (!authReady || !user || !isTeacherIdentity(user)) return
    let active = true
    setMarketAccess('loading')
    void getDoc(doc(services.firestore, 'markets', marketId)).then((snapshot) => {
      if (!active) return
      if (!snapshot.exists()) { setMarketAccess('not-found'); return }
      const nextTemplate = snapshot.data()?.templateSnapshot as TemplateSpec | undefined
      if (!nextTemplate) { setMarketAccess('read-error'); return }
      setTemplate(nextTemplate)
      setMarketAccess('ready')
    }).catch((error: unknown) => {
      if (!active) return
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      setMarketAccess(code.includes('permission-denied') ? 'forbidden' : 'read-error')
    })
    return () => { active = false }
  }, [authReady, marketId, services.firestore, user])
  useEffect(() => {
    if (!authReady || !user || !isTeacherIdentity(user) || marketAccess !== 'ready') return
    return onValue(ref(services.database, `liveMarkets/${marketId}`),
      (snapshot) => {
        const value = snapshot.val() as LiveMarketState | null
        if (!value) { setMarketAccess('read-error'); return }
        setLive(value)
      },
      (error) => {
        const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
        setMarketAccess(code.includes('permission-denied') ? 'forbidden' : 'read-error')
      })
  }, [authReady, marketAccess, marketId, services.database, user])
  // `live` gets a brand-new object reference on every RTDB snapshot, including ticks that only
  // touched unrelated fields (prices, teamLeaderboard, ...). Memoizing on live?.companies identity
  // would recompute — and therefore restart the tick-loop effect below that depends on `stocks` —
  // every second even when the company list hasn't actually changed, so this memoizes on a
  // content-based key via a ref instead of useMemo's identity-based dependency array.
  const companiesKey = JSON.stringify(live?.companies ?? {})
  const stocksCache = useRef<{ key: string; stocks: { id: string; basePrice: number; phases?: import('../../lib/pricing/types').StockPricePhase[] }[] }>({ key: '', stocks: [] })
  if (stocksCache.current.key !== companiesKey) {
    stocksCache.current = { key: companiesKey, stocks: Object.values(live?.companies ?? {}).map((company) => ({ id: company.id, basePrice: company.basePrice, phases: company.phases })) }
  }
  const stocks = stocksCache.current.stocks
  const pendingRequests = useMemo(() => Object.entries(live?.joinRequests ?? {}).filter(([id, request]) => request.connected && !live?.participants?.[id]).map(([id, request]) => ({ id, displayName: request.displayName, requestedTeamId: request.requestedTeamId, recoveryTeamId: resolveRecoveryTeamId(live, request) })), [live])
  const autoApprove = Boolean(live?.meta?.autoApprove)
  useEffect(() => {
    if (!autoApprove || !pendingRequests.length || autoApproving.current || !user) return
    autoApproving.current = true
    void Promise.all(pendingRequests.map((request) => approveJoinRequest(services.database, marketId, request.id, mode)))
      .then((results) => setNotice(`${results.filter(Boolean).length}人を自動承認しました。`))
      .catch((error) => setNotice(handleFailure(error, '自動承認に失敗しました。')))
      .finally(() => { autoApproving.current = false })
  }, [autoApprove, marketId, mode, pendingRequests, services.database, user])
  useEffect(() => {
    if (!lease || !user || !template) return
    const tick = () => void runHostTick(services.firestore, services.database, marketId, user.uid, lease, stocks)
      .then((ok) => { if (ok) setLastTickAtMillis(serverNow()); else { setLease(''); setLastTickAtMillis(undefined); setHostingSinceMillis(undefined); setNotice(liveRef.current?.meta?.status === 'ENDED' ? '市場を終了しました。必要なときに再開できます。' : 'ホスト処理が終了しました。もう一度「ホストを取得する」を押してください。') } })
      .catch((error) => setNotice(handleFailure(error, 'ホスト処理を再試行しています。')))
    tick(); const timer = window.setInterval(tick, 1_000); return () => window.clearInterval(timer)
  }, [lease, marketId, services.database, services.firestore, stocks, template, user])
  if (!authReady) return <AuthLoadingScreen />
  if (!user || !isTeacherIdentity(user)) return <Container component="main" maxWidth="md" sx={{ py: 8 }}><Stack spacing={3} sx={{ alignItems: 'flex-start', maxWidth: 600 }}><Link href="/teacher/markets" underline="hover">← Stock League Classroom</Link><Box><Typography variant="overline" color="text.secondary">CONTROL ROOM</Typography><Typography component="h1" variant="h2" sx={{ mt: 1 }}>市場を進行する</Typography><Typography color="text.secondary" sx={{ mt: 1 }}>市場を開始・終了したり、授業中のニュースを配信するには教師としてログインしてください。</Typography></Box><Button variant="contained" href="/teacher/markets">教師としてログイン</Button></Stack></Container>
  if (marketAccess !== 'ready') return <MarketAccessState state={marketAccess} />
  const takeLease = async () => { const next = leaseId(); const expiresAtMillis = serverNow() + 15_000; const ok = await acquireHostLease(services.database, marketId, user.uid, next); if (!ok) return setNotice('この市場のホストを取得できません。'); await armHostLeaseDisconnect(services.database, marketId, { ownerUid: user.uid, leaseId: next, expiresAtMillis, paused: false }); setLease(next); setLastTickAtMillis(undefined); setHostingSinceMillis(serverNow()); setNotice('ホストを取得しました。') }
  const participants = Object.entries(live?.participants ?? {}).map(([id, participant]) => ({ id, displayName: participant.displayName, teamId: participant.teamId, connected: participant.connected }))
  const marketStatus = live?.meta?.status ?? 'SETUP'
  const defaultTab: ControlRoomTab = marketStatus === 'SETUP' ? 'admission' : 'control'
  const requestedTab = searchParams.get('tab')
  const activeTab: ControlRoomTab = isControlRoomTab(requestedTab) ? requestedTab : defaultTab
  const selectTab = (tab: ControlRoomTab) => setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set('tab', tab); return next }, { replace: true })
  return <AdminShell active="room" marketId={marketId} marketTitle={template?.title} marketStatus={marketStatus} stocksNavGuardMessage={lease && marketStatus === 'OPEN' ? '市場は現在進行中です。銘柄を編集する画面に移動すると、進行が一時的に止まります（戻ってきたらもう一度ホストを取得してください）。移動しますか？' : undefined}>
    <Container maxWidth="xl" sx={{ py: { xs: 4, md: 6 } }}>
      <Stack spacing={4}>
        <Stack component="section" direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
          <Box><Typography variant="overline" color="text.secondary">CONTROL ROOM</Typography><Typography component="h1" variant="h2">市場のコントロールルーム</Typography><Typography color="text.secondary">市場ID: <Box component="code">{marketId}</Box></Typography></Box>
          <Chip color={lease ? 'success' : 'default'} variant={lease ? 'filled' : 'outlined'} label={lease ? 'ホスト接続中' : 'ホスト未接続'} />
        </Stack>
        <PhaseBand
          status={marketStatus}
          openedAtMillis={live?.meta?.openedAtMillis}
          nowMillis={nowMillis}
          participantCount={participants.filter((participant) => participant.connected).length}
          capacity={live?.meta?.capacity ?? 80}
          pendingOrderCount={Object.values(live?.orders ?? {}).filter((entry) => entry.pending).length}
        />
        <Stack spacing={2} aria-live="polite">
          {offline && <Alert severity="error"><Typography component="strong" sx={{ fontWeight: 700 }}>サーバーに接続できていません。市場の進行が止まっています。</Typography><br />価格の更新と生徒の売買は処理されていません。通信を確認してください。</Alert>}
          {interruption.message && <Alert severity="warning" action={<Button color="inherit" size="small" onClick={interruption.dismiss}>確認しました</Button>}><Typography component="strong" sx={{ fontWeight: 700 }}>{interruption.message}のあいだ、市場の進行が止まっていた可能性があります。</Typography><br />授業中はこのタブを前面に置いたままにしてください。</Alert>}
          {lease && <Alert severity="info">このタブを閉じたり、別のアプリで隠したり、パソコンをスリープさせると市場が止まります。授業のあいだは開いたままにしてください。</Alert>}
          {notice && <Alert severity="info">{notice}</Alert>}
        </Stack>
        <Box>
          <Tabs value={activeTab} onChange={(_, value: ControlRoomTab) => selectTab(value)} aria-label="コントロールルームのタブ" sx={{ borderBottom: 1, borderColor: 'divider' }}>
            {TAB_ORDER.map((tab) => <Tab key={tab} value={tab} label={TAB_LABEL[tab]} id={`control-room-tab-${tab}`} aria-controls={`control-room-panel-${tab}`} />)}
          </Tabs>
          <Box role="tabpanel" id={`control-room-panel-${activeTab}`} aria-labelledby={`control-room-tab-${activeTab}`} sx={{ pt: 3 }}>
            {activeTab === 'admission' && <AdmissionPanel
              joinCode={live?.meta?.joinCode ?? ''}
              capacity={live?.meta?.capacity ?? 80}
              teams={Object.values(live?.teams ?? {}).map((team) => ({ id: team.id, name: team.name }))}
              requests={pendingRequests}
              participants={participants}
              mode={mode}
              autoApprove={autoApprove}
              onAutoApproveChange={(enabled) => void setAutoApprove(services.database, marketId, enabled).then(() => setNotice(enabled ? '参加申請の自動承認を有効にしました。' : '参加申請の自動承認を無効にしました。')).catch((error) => setNotice(handleFailure(error, '自動承認モードを変更できませんでした。')))}
              onModeChange={setMode}
              onApproveAll={() => void Promise.all(pendingRequests.map((request) => approveJoinRequest(services.database, marketId, request.id, mode))).then((results) => setNotice(`${results.filter(Boolean).length}人を一括承認しました。`)).catch((error) => setNotice(handleFailure(error, '一括承認に失敗しました。')))}
              onCopyJoinCode={() => void navigator.clipboard.writeText(live?.meta?.joinCode ?? '').then(() => setNotice('参加コードをコピーしました。'))}
              joinUrl={`${window.location.origin}/join?code=${encodeURIComponent(live?.meta?.joinCode ?? '')}`}
              onCopyJoinUrl={() => void navigator.clipboard.writeText(`${window.location.origin}/join?code=${encodeURIComponent(live?.meta?.joinCode ?? '')}`).then(() => setNotice('生徒用マジックリンクをコピーしました。'))}
              onApprove={(id, manualTeamId) => void approveJoinRequest(services.database, marketId, id, mode, manualTeamId).then((ok) => setNotice(ok ? '参加を承認しました。' : '承認できませんでした。')).catch((error) => setNotice(handleFailure(error, '参加を承認できませんでした。')))}
              onReject={(id) => void rejectJoinRequest(services.database, marketId, id).then(() => setNotice('申請を却下しました。')).catch((error) => setNotice(handleFailure(error, '申請を却下できませんでした。')))}
              onRemove={(id) => { if (window.confirm('この生徒を市場から退出させますか？チームの資産はそのまま残ります。')) void removeParticipant(services.database, marketId, id).then(() => setNotice('退出させました。')).catch((error) => setNotice(handleFailure(error, '退出させられませんでした。'))) }}
              onReassign={(id, teamId) => void reassignParticipantTeam(services.database, marketId, id, teamId).then((ok) => setNotice(ok ? 'チームを変更しました。' : 'チームを変更できませんでした。')).catch((error) => setNotice(handleFailure(error, 'チームを変更できませんでした。')))}
            />}
            {activeTab === 'control' && <Stack direction={{ xs: 'column', lg: 'row' }} spacing={3} sx={{ alignItems: 'stretch' }}>
              <Box sx={{ flex: 1 }}><MarketControlPanel
                lease={lease}
                marketStatus={marketStatus}
                endingConfirm={endingConfirm}
                ending={ending}
                onTakeLease={() => void takeLease().catch((error) => setNotice(handleFailure(error, 'ホストを取得できませんでした。')))}
                onOpenMarket={() => void openMarket(services.database, marketId, user.uid, lease).then(() => setNotice('市場を開始しました。')).catch((error) => setNotice(handleFailure(error, '開始できません。準備中の市場か確認してください。')))}
                onPauseMarket={() => void pauseMarket(services.database, marketId, user.uid, lease).then((ok) => setNotice(ok ? '市場を一時停止しました。「銘柄」メニューから内容を編集できます。' : '一時停止できませんでした。')).catch((error) => setNotice(handleFailure(error, '一時停止できませんでした。')))}
                onRequestEnd={() => setEndingConfirm(true)}
                onCancelEnd={() => setEndingConfirm(false)}
                onConfirmEnd={() => { setEnding(true); void requestMarketEnding(services.database, marketId, user.uid, lease).then((result) => { setNotice(result.committed ? '終了処理を開始しました。完了後も市場を再開できます。' : '市場を終了できません。市場が取引中で、この端末がホストであることを確認してください。'); setEnding(false); setEndingConfirm(!result.committed) }).catch((error) => { setNotice(handleFailure(error, '市場を終了できません。もう一度お試しください。')); setEnding(false) }) }}
              /></Box>
              <Box sx={{ flex: 1 }}><HostStatusPanel
                prices={Object.values(live?.companies ?? {}).map((company) => ({ stockId: company.id, name: company.name, symbol: company.symbol, price: live?.prices?.[company.id]?.price ?? company.basePrice, basePrice: company.basePrice }))}
                lastTickAtMillis={lastTickAtMillis}
                hostingSinceMillis={hostingSinceMillis}
                nowMillis={nowMillis}
              /></Box>
            </Stack>}
            {activeTab === 'news' && <NewsPublishPanel
              disabled={!lease}
              onPublish={(body, impactPercent) => publishManualNews(services.database, marketId, user.uid, lease, body, impactPercent)
                .then(() => setNotice('ニュースを配信しました。'))
                .catch((error) => { setNotice(handleFailure(error, 'ニュースを配信できません。市場が取引中か確認してください。')); throw error })}
            />}
            {activeTab === 'signage' && <SignageLinkPanel marketId={marketId} />}
          </Box>
        </Box>
      </Stack>
    </Container>
  </AdminShell>
}
