import { useEffect, useMemo, useState } from 'react'
import { onValue, ref } from 'firebase/database'
import { bootstrapFirebase } from '../../lib/firebase/bootstrap'
import { getOrCreateStudentUid } from '../../lib/auth/studentAuth'
import { submitOrder } from '../../lib/market/hostTrading'
import { armApprovedParticipantPresence } from '../../lib/market/marketRepository'
import type { LiveMarketMetadata, LiveMarketParticipant, LiveMarketTeam, LivePrice, OrderResult, Portfolio, TeamLeaderboardEntry } from '../../lib/market/liveMarketTypes'
import { clearActiveStudentSession, readActiveStudentSession } from '../../lib/students/studentSession'
import { useDatabaseConnected, useDatabaseOffline, useReleaseIdleConnection } from '../../lib/firebase/connectionState'
import { handleFailure } from '../../lib/monitoring/describeError'
import { TradePanel } from './TradePanel'
import { ResultsView } from './ResultsView'

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

  if (!sessionValid) return <main className="student-page"><section className="student-card"><h1>参加情報が見つかりません</h1><p>参加コードを使って、もう一度市場へ参加してください。</p><a className="portal-button" href="/join" onClick={() => clearActiveStudentSession()}>参加画面へ</a></section></main>
  if (offline) return <main className="student-page"><section className="student-card"><div className="student-icon">!</div><h1>市場につながりません</h1><p>通信が切れているか、教室の同時利用が上限に達しています。数十秒待つと自動で復帰することがあります。復帰しない場合は先生に知らせてください。</p><p className="student-message error" role="alert">売買した内容は保存されています。つながり次第、続きから再開できます。</p></section></main>
  if (!participant) return <main className="student-page"><section className="student-card"><h1>市場へ接続しています…</h1><p>{notice || '承認済みの参加情報を確認しています。'}</p><a href="/join">参加画面へ戻る</a></section></main>

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

  return <main className="student-market-page">
    <header className="teacher-header"><a className="portal-brand" href="/">Stock League <span>Classroom</span></a><span>{teams[participant.teamId ?? '']?.name}</span></header>
    <section className="student-market-summary"><div><p className="portal-eyebrow">{meta?.status ?? 'CONNECTING'}</p><h1>{participant.displayName}さんのチーム口座</h1></div><div><span>現金</span><strong>¥{(portfolio?.cash ?? 0).toLocaleString()}</strong></div><div className="recovery-code"><span>復帰コード</span><strong>{recoveryCode || '—'}</strong><small>端末を替えるときに使います</small></div></section>
    {notice && <p className="form-notice" role="status">{notice}</p>}
    <section className="student-trading-grid">
      <div className="host-main-card"><h2>銘柄を選ぶ</h2><div className="stock-tabs" role="group" aria-label="銘柄を選ぶ">{Object.values(companies).map((company) => <button type="button" aria-pressed={selectedStockId === company.id} className={selectedStockId === company.id ? 'active' : ''} key={company.id} onClick={() => setSelectedStockId(company.id)}>{company.symbol}<small>{prices[company.id]?.price ?? company.basePrice}円</small></button>)}</div>
        {selected && <TradePanel
          stockName={`${selected.name} (${selected.symbol})`}
          currentPrice={prices[selected.id]?.price ?? selected.basePrice}
          cash={portfolio?.cash ?? 0}
          holding={portfolio?.holdings?.[selected.id] ?? 0}
          onSubmitOrder={(side, quantity) => void placeOrder(side, quantity).catch((error) => { setPendingOrderId(''); setNotice(handleFailure(error, '注文処理でエラーが発生しました。')) })}
          latestResult={latestResult}
          disabled={meta?.status !== 'OPEN'}
          pending={Boolean(pendingOrderId)}
        />}
      </div>
      <aside className="news-card"><h2>チーム資産</h2><p>現金 ¥{(portfolio?.cash ?? 0).toLocaleString()}</p><ul>{Object.entries(portfolio?.holdings ?? {}).map(([stockId, quantity]) => <li key={stockId}>{companies[stockId]?.symbol ?? stockId}: {quantity}株</li>)}</ul><h2>チーム順位</h2><ol>{Object.values(leaderboard).sort((a, b) => a.rank - b.rank).map((entry) => <li key={entry.teamId}><b>{entry.rank}位 {entry.name}</b> ¥{entry.valuation.toLocaleString()}</li>)}</ol></aside>
    </section>
  </main>
}
