import { useEffect, useMemo, useState } from 'react'
import { onValue, ref } from 'firebase/database'
import { bootstrapFirebase } from '../../lib/firebase/bootstrap'
import { getOrCreateStudentUid } from '../../lib/auth/studentAuth'
import { submitOrder } from '../../lib/market/hostTrading'
import { armApprovedParticipantPresence } from '../../lib/market/marketRepository'
import { describeStudentPhase } from '../../lib/market/marketStatusLabels'
import type { LiveMarketMetadata, LiveMarketParticipant, LiveMarketTeam, LivePrice, OrderResult, Portfolio, TeamLeaderboardEntry } from '../../lib/market/liveMarketTypes'
import { clearActiveStudentSession, readActiveStudentSession } from '../../lib/students/studentSession'
import { useDatabaseConnected, useDatabaseOffline, useReleaseIdleConnection } from '../../lib/firebase/connectionState'
import { handleFailure } from '../../lib/monitoring/describeError'
import { TradePanel } from './TradePanel'
import { ResultsView } from './ResultsView'
import { RecoveryCodeDisclosure } from './RecoveryCodeDisclosure'
import { StudentOnboardingCard } from './StudentOnboardingCard'
import { Alert, Box, Button, Chip, Container, Divider, Paper, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { StudentPageSurface, StudentSurfaceCard } from '../ui/StudentUi'
import { studentPrimaryActionSx } from '../ui/studentUiStyles'

interface LiveCompany { id: string; name: string; symbol: string; basePrice: number }

// The host tick runs once a second and the host lease TTL is 15 seconds, so a
// healthy fill normally arrives within a couple of seconds. 20 seconds gives
// enough headroom to survive a lease handoff (up to 15s for another host to
// take over, plus a tick) without stranding a student behind disabled buttons
// for the rest of the lesson.
const ORDER_RESULT_TIMEOUT_MS = 20000

export const StudentMarketPage = ({ marketId }: { marketId: string }) => {
  const services = bootstrapFirebase()
  const active = useMemo(() => readActiveStudentSession(), [])
  const [uid, setUid] = useState('')
  const [showOnboarding, setShowOnboarding] = useState(false)
  const onboardingKey = uid ? `stock-league:student-onboarding:${uid}` : ''
  useEffect(() => {
    if (!onboardingKey) return
    setShowOnboarding(window.localStorage.getItem(onboardingKey) !== 'done')
  }, [onboardingKey])
  const dismissOnboarding = () => { if (onboardingKey) window.localStorage.setItem(onboardingKey, 'done'); setShowOnboarding(false) }
  const [participant, setParticipant] = useState<LiveMarketParticipant>()
  const [meta, setMeta] = useState<LiveMarketMetadata>()
  const [teams, setTeams] = useState<Record<string, LiveMarketTeam>>({})
  const [companies, setCompanies] = useState<Record<string, LiveCompany>>({})
  const [prices, setPrices] = useState<Record<string, LivePrice>>({})
  const [portfolio, setPortfolio] = useState<Portfolio>()
  const [transactions, setTransactions] = useState<Record<string, OrderResult>>({})
  const [leaderboard, setLeaderboard] = useState<Record<string, TeamLeaderboardEntry>>({})
  const [selectedStockId, setSelectedStockId] = useState('')
  const [pendingOrderId, setPendingOrderId] = useState('')
  const [timedOutOrderId, setTimedOutOrderId] = useState('')
  const [notice, setNotice] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const sessionValid = active?.marketId === marketId
  const participantKey = uid && sessionValid ? `${uid}_${active.sessionId}` : ''
  // Reads meta directly: the connection must be released even after the
  // listeners above have stopped delivering.
  const suspended = useReleaseIdleConnection(services.database, { finished: meta?.status === 'ENDED' })
  const offline = useDatabaseOffline(services.database, { suspended })
  const connected = useDatabaseConnected(services.database)

  useEffect(() => { void getOrCreateStudentUid(services.auth).then(setUid).catch((error) => setNotice(handleFailure(error, '匿名ログインを開始できませんでした。'))) }, [services.auth])
  useEffect(() => {
    if (!participantKey) return
    const subscriptions = [
      onValue(ref(services.database, `liveMarkets/${marketId}/participants/${participantKey}`), (snapshot) => setParticipant(snapshot.val() as LiveMarketParticipant | undefined)),
      onValue(ref(services.database, `liveMarkets/${marketId}/meta`), (snapshot) => setMeta(snapshot.val() as LiveMarketMetadata | undefined)),
      onValue(ref(services.database, `liveMarkets/${marketId}/teams`), (snapshot) => setTeams(snapshot.val() ?? {})),
      onValue(ref(services.database, `liveMarkets/${marketId}/companies`), (snapshot) => setCompanies(snapshot.val() ?? {})),
      onValue(ref(services.database, `liveMarkets/${marketId}/prices`), (snapshot) => setPrices(snapshot.val() ?? {})),
      onValue(ref(services.database, `liveMarkets/${marketId}/transactions/${participantKey}`), (snapshot) => {
        const next = snapshot.val() ?? {}
        setTransactions(next)
        if (pendingOrderId && next[pendingOrderId]) setPendingOrderId('')
        if (timedOutOrderId && next[timedOutOrderId]) { setTimedOutOrderId(''); setNotice('') }
      }),
      onValue(ref(services.database, `liveMarkets/${marketId}/teamLeaderboard`), (snapshot) => setLeaderboard(snapshot.val() ?? {})),
    ]
    return () => subscriptions.forEach((stop) => stop())
  }, [marketId, participantKey, pendingOrderId, timedOutOrderId, services.database])
  // A submitted order is confirmed by the matching transaction arriving over
  // the listener above. If the host tab is backgrounded, its lease expires
  // mid-processing, or the listener drops, that confirmation may never come.
  // Without a timeout the buy/sell buttons stay disabled for the rest of the
  // lesson, so give up waiting after ORDER_RESULT_TIMEOUT_MS and let the
  // student try again. Cleared automatically (by the effect re-running) when
  // pendingOrderId changes — including when the result arrives in time — and
  // on unmount.
  useEffect(() => {
    if (!pendingOrderId) return
    const timer = window.setTimeout(() => {
      setPendingOrderId('')
      setTimedOutOrderId(pendingOrderId)
      setNotice('注文の結果が届きませんでした。もう一度注文してください。')
    }, ORDER_RESULT_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [pendingOrderId])
  // Shown for the whole lesson: it is the only way back in from a different
  // device, and a student who has lost their tab cannot be told it afterwards.
  // Gated on uid too: every approved join lands here via a hard page reload, so
  // anonymous auth has not resolved yet at mount and the rules-required `auth != null`
  // would deny a listener subscribed before then (denials are not retried).
  useEffect(() => {
    if (!sessionValid || !active?.requestId || !uid) return
    return onValue(ref(services.database, `liveMarkets/${marketId}/joinRequests/${active.requestId}/recoveryCode`), (snapshot) => setRecoveryCode(String(snapshot.val() ?? '')))
  }, [active?.requestId, marketId, services.database, sessionValid, uid])
  // Re-armed on every reconnection, not just on mount: the server runs our
  // onDisconnect the moment the socket drops, so a single network blip would
  // otherwise leave the student marked absent for the rest of the lesson —
  // vanished from the teacher's list while still sitting at their desk.
  useEffect(() => {
    if (!participantKey || !connected) return
    void armApprovedParticipantPresence(services.database, marketId, participantKey).catch((error) => setNotice(handleFailure(error, '参加状態を復元できませんでした。')))
  }, [connected, marketId, participantKey, services.database])
  useEffect(() => {
    if (!participant?.teamId) return
    return onValue(ref(services.database, `liveMarkets/${marketId}/teamPortfolios/${participant.teamId}`), (snapshot) => setPortfolio(snapshot.val() as Portfolio | undefined))
  }, [marketId, participant?.teamId, services.database])
  useEffect(() => {
    if (!selectedStockId) setSelectedStockId(Object.keys(companies)[0] ?? '')
  }, [companies, selectedStockId])

  const studentMessage = (title: string, message: string, severity?: 'error' | 'info') => <StudentPageSurface><Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', p: 3 }}><StudentSurfaceCard sx={{ width: 'min(100%, 480px)' }}><Stack spacing={2} sx={{ p: { xs: 3, sm: 4 } }}><Typography variant="h1">{title}</Typography><Typography color="text.secondary">{message}</Typography>{severity && <Alert severity={severity}>{severity === 'error' ? '売買した内容は保存されています。つながり次第、続きから再開できます。' : notice || '承認済みの参加情報を確認しています。'}</Alert>}<Button href="/join" variant="contained" onClick={title === '参加情報が見つかりません' ? clearActiveStudentSession : undefined} sx={studentPrimaryActionSx}>参加画面へ</Button></Stack></StudentSurfaceCard></Box></StudentPageSurface>
  if (!sessionValid) return studentMessage('参加情報が見つかりません', '参加コードを使って、もう一度市場へ参加してください。')
  if (offline) return studentMessage('市場につながりません', '通信が切れているか、教室の同時利用が上限に達しています。数十秒待つと自動で復帰することがあります。復帰しない場合は先生に知らせてください。', 'error')
  if (!participant) return studentMessage('市場へ接続しています…', notice || '承認済みの参加情報を確認しています。', 'info')

  const selected = companies[selectedStockId]
  const latestResult = Object.values(transactions).sort((a, b) => b.processedAtMillis - a.processedAtMillis)[0] ?? null
  const teamResult = participant.teamId ? leaderboard[participant.teamId] : undefined
  const placeOrder = async (side: 'BUY' | 'SELL', quantity: number) => {
    if (!selected || pendingOrderId || !Number.isInteger(quantity) || quantity < 1 || quantity > 100000) return setNotice('数量は1〜100000の整数で入力してください。')
    const orderId = crypto.randomUUID()
    setTimedOutOrderId('')
    setPendingOrderId(orderId)
    setNotice('注文を送信しました。約定を待っています。')
    const result = await submitOrder(services.database, marketId, participantKey, { orderId, stockId: selected.id, side, quantity, submittedAtMillis: Date.now() })
    if (!result.committed) { setPendingOrderId(''); setNotice('注文を送信できませんでした。前の注文が処理中か、市場が終了しています。') }
  }

  if (meta?.status === 'ENDED') return <ResultsView
    teamName={teams[participant.teamId ?? '']?.name ?? '所属チーム'}
    finalValuation={teamResult?.valuation ?? 0}
    rank={teamResult?.rank ?? null}
    transactions={Object.values(transactions)}
    companyNames={Object.fromEntries(Object.values(companies).map((company) => [company.id, company.name]))}
    holdings={portfolio?.holdings ?? {}}
    prices={Object.fromEntries(Object.entries(prices).map(([stockId, value]) => [stockId, value.price]))}
    onLeave={clearActiveStudentSession}
  />

  // A matched recovery keeps the presented code as-is (see applyApproveJoinRequest);
  // a mismatch gets a freshly issued one instead. Comparing the two is the only signal
  // available to the student under the RTDB rules — they cannot read any other
  // participant's record, so they cannot be told which team the code pointed to.
  const recoveryMismatch = Boolean(active?.presentedRecoveryCode) && recoveryCode !== '' && recoveryCode !== active?.presentedRecoveryCode
  return <StudentPageSurface>
    <Paper component="header" square elevation={0} sx={{ position: 'sticky', top: 0, zIndex: 10, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}><Container maxWidth="lg"><Stack direction="row" sx={{ minHeight: 72, alignItems: 'center', justifyContent: 'space-between' }}><Box><Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1 }}>STUDENT MARKET</Typography><Typography sx={{ fontWeight: 800 }}>{participant.displayName}</Typography></Box><Box sx={{ textAlign: 'right' }}><Typography variant="caption" color="text.secondary">チーム総資産</Typography><Typography variant="h5" sx={{ fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>¥{(teamResult?.valuation ?? portfolio?.cash ?? 0).toLocaleString()}</Typography></Box></Stack></Container></Paper>
    <Container maxWidth="lg" sx={{ py: { xs: 2.5, md: 4 }, pb: { xs: 12, md: 5 } }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 1 }}><StudentSurfaceCard sx={{ flex: 1 }}><Stack direction="row" spacing={3} sx={{ p: 2.5, alignItems: 'center' }}><Box><Typography variant="caption" color="text.secondary">現金</Typography><Typography variant="h5" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>¥{(portfolio?.cash ?? 0).toLocaleString()}</Typography></Box></Stack></StudentSurfaceCard><Chip label={`${teams[participant.teamId ?? '']?.name ?? 'チーム'} ・ ${describeStudentPhase(meta?.status)}`} variant="outlined" sx={{ alignSelf: { md: 'center' } }} /></Stack>
      <Box sx={{ mb: 3 }}><RecoveryCodeDisclosure code={recoveryCode} /></Box>
      <Stack spacing={2} sx={{ mb: 3 }}>{recoveryMismatch && <Alert severity="warning"><strong>前回の続きに戻れませんでした。</strong> 入力した復帰コードか表示名が前回と違っていたため、新しく参加しています。</Alert>}{notice && <Alert severity="info" role="status">{notice}</Alert>}</Stack>
      {showOnboarding && <StudentOnboardingCard onDismiss={dismissOnboarding} />}
      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={3} sx={{ alignItems: 'flex-start' }}>
      <StudentSurfaceCard sx={{ flex: 1, width: '100%' }}><Box sx={{ p: { xs: 2.5, sm: 3 } }}><Typography variant="overline" color="text.secondary">MARKET BOARD</Typography><Typography variant="h2" sx={{ mb: 2, mt: .5 }}>銘柄を選ぶ</Typography><ToggleButtonGroup exclusive value={selectedStockId} onChange={(_, next: string | null) => next && setSelectedStockId(next)} aria-label="銘柄を選ぶ" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, '& .MuiToggleButtonGroup-grouped': { minHeight: 60, border: 1, borderColor: 'divider !important', borderRadius: '12px !important', px: 2, py: 1, textTransform: 'none', '&.Mui-selected': { bgcolor: 'action.selected', color: 'text.primary', boxShadow: 'inset 0 -3px 0 currentColor' } } }}>{Object.values(companies).map((company) => <ToggleButton value={company.id} key={company.id} aria-label={`${company.name}を選ぶ`}><Stack sx={{ alignItems: 'flex-start' }}><Typography sx={{ fontWeight: 800 }}>{company.symbol}</Typography><Typography variant="caption">¥{(prices[company.id]?.price ?? company.basePrice).toLocaleString()}</Typography></Stack></ToggleButton>)}</ToggleButtonGroup>
        {selected && <TradePanel
          stockName={`${selected.name} (${selected.symbol})`}
          currentPrice={prices[selected.id]?.price ?? selected.basePrice}
          cash={portfolio?.cash ?? 0}
          holding={portfolio?.holdings?.[selected.id] ?? 0}
          onSubmitOrder={(side, quantity) => void placeOrder(side, quantity).catch((error) => { setPendingOrderId(''); setNotice(handleFailure(error, '注文処理でエラーが発生しました。')) })}
          latestResult={latestResult}
          disabled={meta?.status !== 'OPEN'}
          pending={Boolean(pendingOrderId)}
        />}</Box></StudentSurfaceCard>
      <StudentSurfaceCard component="aside" sx={{ width: { xs: '100%', lg: 340 }, flexShrink: 0 }}><Box sx={{ p: 3 }}><Typography variant="overline" color="text.secondary">YOUR PORTFOLIO</Typography><Typography variant="h2" sx={{ mt: .5 }}>チーム資産</Typography><Stack component="ul" spacing={1} sx={{ mt: 2, pl: 2 }}>{Object.entries(portfolio?.holdings ?? {}).map(([stockId, quantity]) => <Typography component="li" key={stockId}>{companies[stockId]?.symbol ?? stockId}: {quantity}株</Typography>)}</Stack><Divider sx={{ my: 3 }} /><Typography variant="overline" color="text.secondary">LEADERBOARD</Typography><Typography variant="h2" sx={{ mt: .5 }}>チーム順位</Typography><Stack component="ol" spacing={1.25} sx={{ mt: 2, pl: 3 }}>{Object.values(leaderboard).sort((a, b) => a.rank - b.rank).map((entry) => <Typography component="li" key={entry.teamId}><strong>{entry.rank}位 {entry.name}</strong>　¥{entry.valuation.toLocaleString()}</Typography>)}</Stack></Box></StudentSurfaceCard>
      </Stack>
    </Container>
  </StudentPageSurface>
}
