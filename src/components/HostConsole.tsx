import { useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { onValue, ref } from 'firebase/database'
import { bootstrapFirebase } from '../lib/firebase/bootstrap'
import { isTeacherIdentity } from '../lib/auth/roles'
import { acquireHostLease, armHostLeaseDisconnect, openMarket, publishManualNews, requestMarketEnding, runHostTick } from '../lib/market/hostTrading'
import { serverNow } from '../lib/firebase/serverTime'
import { AdmissionPanel } from './teacher/AdmissionPanel'
import { HostStatusPanel } from './teacher/HostStatusPanel'
import { approveJoinRequest, reassignParticipantTeam, rejectJoinRequest, removeParticipant } from '../lib/market/marketRepository'
import type { LiveMarketState, TeamAssignmentMode } from '../lib/market/liveMarketTypes'
import type { TemplateSpec } from '../lib/templates/types'
import { useDatabaseOffline } from '../lib/firebase/connectionState'
import { useHostInterruption, useUnloadWarning, useWakeLock } from '../lib/host/hostContinuity'
import { handleFailure } from '../lib/monitoring/describeError'
import { AppVersion } from './AppVersion'

const leaseId = () => crypto.randomUUID()
export const HostConsole = ({ marketId }: { marketId: string }) => {
  const services = bootstrapFirebase(); const [user, setUser] = useState<User | null>(services.auth.currentUser)
  const [lease, setLease] = useState(''); const [news, setNews] = useState(''); const [impact, setImpact] = useState(0); const [notice, setNotice] = useState(''); const [template, setTemplate] = useState<TemplateSpec | null>(null)
  const [live, setLive] = useState<LiveMarketState | null>(null)
  const [mode, setMode] = useState<TeamAssignmentMode>('random')
  const [nowMillis, setNowMillis] = useState(() => Date.now())
  const [lastTickAtMillis, setLastTickAtMillis] = useState<number>()
  const [hostingSinceMillis, setHostingSinceMillis] = useState<number>()
  const [endingConfirm, setEndingConfirm] = useState(false); const [ending, setEnding] = useState(false)
  useEffect(() => { const timer = window.setInterval(() => setNowMillis(Date.now()), 1_000); return () => window.clearInterval(timer) }, [])
  const interruption = useHostInterruption(Boolean(lease))
  useWakeLock(Boolean(lease))
  useUnloadWarning(Boolean(lease))
  useEffect(() => onValue(ref(services.database, `liveMarkets/${marketId}`), (snapshot) => setLive(snapshot.val() as LiveMarketState | null)), [marketId, services.database])
  const offline = useDatabaseOffline(services.database)
  useEffect(() => onAuthStateChanged(services.auth, setUser), [services.auth])
  useEffect(() => { if (!user || !isTeacherIdentity(user)) return; void getDoc(doc(services.firestore, 'markets', marketId)).then((snapshot) => setTemplate(snapshot.data()?.templateSnapshot as TemplateSpec ?? null)).catch((error) => setNotice(handleFailure(error, '市場設定を取得できません。'))) }, [marketId, services.firestore, user])
  const stocks = useMemo(() => (template?.companies ?? []).map((company) => ({ id: company.id, basePrice: company.initialPrice, phases: company.pricePhases })), [template])
  useEffect(() => {
    if (!lease || !user || !template) return
    const tick = () => void runHostTick(services.firestore, services.database, marketId, user.uid, lease, stocks)
      .then((ok) => { if (ok) setLastTickAtMillis(Date.now()); else { setLease(''); setLastTickAtMillis(undefined); setHostingSinceMillis(undefined); setNotice('ホストリースが失効しました。もう一度「ホストを取得する」を押してください。') } })
      .catch((error) => setNotice(handleFailure(error, 'ホスト処理を再試行しています。')))
    tick(); const timer = window.setInterval(tick, 1_000); return () => window.clearInterval(timer)
  }, [lease, marketId, services.database, services.firestore, stocks, template, user])
  if (!user || !isTeacherIdentity(user)) return <main className="workspace-gate"><a className="portal-brand" href="/teacher/markets">← Stock League Classroom</a><div><p className="portal-eyebrow">HOST CONSOLE</p><h1>市場を進行する</h1><p>市場を開始・終了したり、授業中のニュースを配信するには教師としてログインしてください。</p><a className="portal-button" href="/teacher/markets">教師としてログイン <span>→</span></a></div></main>
  const takeLease = async () => { const next = leaseId(); const expiresAtMillis = serverNow() + 15_000; const ok = await acquireHostLease(services.database, marketId, user.uid, next); if (!ok) return setNotice('この市場のホストを取得できません。'); await armHostLeaseDisconnect(services.database, marketId, { ownerUid: user.uid, leaseId: next, expiresAtMillis, paused: false }); setLease(next); setLastTickAtMillis(undefined); setHostingSinceMillis(Date.now()); setNotice('ホストを取得しました。') }
  return <main className="host-page"><header className="teacher-header"><a className="portal-brand" href="/teacher/markets">Stock League <span>Classroom</span></a><a href="/teacher/markets">← 市場の管理へ</a><AppVersion /></header><section className="host-hero"><div><p className="portal-eyebrow">HOST CONSOLE</p><h1>市場の進行を、<em>コントロール。</em></h1><p>市場ID: <code>{marketId}</code></p></div><div className={`host-status ${lease ? 'connected' : ''}`}><span>{lease ? '●' : '○'}</span>{lease ? 'ホスト接続中' : 'ホスト未接続'}</div></section><section className="host-workspace">{offline && <p className="form-notice stopped" role="alert"><strong>サーバーに接続できていません。市場の進行が止まっています。</strong>価格の更新と生徒の売買は処理されていません。通信を確認してください。同時利用が上限に達している場合、しばらく待つと復帰します。</p>}{lease && interruption.message && <p className="form-notice stopped" role="alert"><strong>{interruption.message}のあいだ、市場の進行が止まっていた可能性があります。</strong>このタブが裏に回っている間、価格の更新と生徒の売買は処理されません。授業中はこのタブを前面に置いたままにしてください。<button type="button" className="outline-button" onClick={interruption.dismiss}>確認しました</button></p>}{lease && <p className="form-notice" role="status">このタブを閉じたり、別のアプリで隠したり、パソコンをスリープさせると市場が止まります。授業のあいだは開いたままにしてください。</p>}{notice && <p className="form-notice host-notice" role="status">{notice}</p>}<HostStatusPanel status={live?.meta?.status ?? 'SETUP'} openedAtMillis={live?.meta?.openedAtMillis} nowMillis={nowMillis} participantCount={Object.values(live?.participants ?? {}).filter((participant) => participant.connected).length} capacity={live?.meta?.capacity ?? 80} pendingOrderCount={Object.values(live?.orders ?? {}).filter((entry) => entry.pending).length} prices={(template?.companies ?? []).map((company) => ({ stockId: company.id, name: company.name, symbol: company.symbol, price: live?.prices?.[company.id]?.price ?? company.initialPrice, basePrice: company.initialPrice }))} lastTickAtMillis={lastTickAtMillis} hostingSinceMillis={hostingSinceMillis} /><div className="host-main-card"><p className="section-kicker">MARKET CONTROL</p><h2>{lease ? '市場を進行できます' : 'この端末で市場を管理する'}</h2><p>{lease ? '市場の開始・終了やニュース配信を行えます。画面を閉じるとホスト権限は自動的に解放されます。' : '最初にホスト権限を取得してください。ほかの端末が操作中の場合は取得できません。'}</p>{!lease ? <button className="portal-button" type="button" onClick={() => void takeLease().catch((error) => setNotice(handleFailure(error, 'ホストを取得できませんでした。')))}>ホストを取得する <span>→</span></button> : <div className="host-controls"><button className="portal-button" type="button" onClick={() => void openMarket(services.database, marketId, user.uid, lease).then(() => setNotice('市場を開始しました。')).catch((error) => setNotice(handleFailure(error, '開始できません。準備中の市場か確認してください。')))}>市場を開始</button>{!endingConfirm ? <button className="outline-button" type="button" onClick={() => setEndingConfirm(true)}>市場を終了</button> : <div className="ending-confirm" role="group" aria-label="市場終了の確認"><p><strong>市場を終了すると、結果が確定して元に戻せません。</strong>生徒はこれ以上売買できなくなります。</p><button className="danger-button" type="button" disabled={ending} onClick={() => { setEnding(true); void requestMarketEnding(services.database, marketId, user.uid, lease).then((result) => { setNotice(result.committed ? '終了処理を開始しました。完了まで再試行します。' : '終了処理を開始できません。市場が取引中で、この端末がホストであることを確認してください。'); setEnding(false); setEndingConfirm(!result.committed) }).catch((error) => { setNotice(handleFailure(error, '終了処理を開始できません。もう一度お試しください。')); setEnding(false) }) }}>{ending ? '処理中…' : '終了して結果を確定する'}</button><button className="outline-button" type="button" disabled={ending} onClick={() => setEndingConfirm(false)}>やめる</button></div>}</div>}</div><aside className="news-card"><p className="section-kicker">MANUAL NEWS</p><h2>ニュースを配信</h2><p>授業中の出来事を市場へ届けます。</p><label>ニュース本文<textarea value={news} rows={4} placeholder="例: 新商品の発表で期待が高まる" onChange={(event) => setNews(event.target.value)} disabled={!lease} /></label><label>相場への影響<select value={impact} onChange={(event) => setImpact(Number(event.target.value))} disabled={!lease}><option value={0}>影響なし（お知らせだけ）</option><option value={5}>やや上昇（+5%）</option><option value={10}>大きく上昇（+10%）</option><option value={-5}>やや下落（-5%）</option><option value={-10}>大きく下落（-10%）</option></select></label><button className="portal-button" type="button" disabled={!lease || !news.trim()} onClick={() => void publishManualNews(services.database, marketId, user.uid, lease, news, impact).then(() => { setNews(''); setImpact(0); setNotice('ニュースを配信しました。') }).catch((error) => setNotice(handleFailure(error, 'ニュースを配信できません。市場が取引中か確認してください。')))}>配信する <span>→</span></button></aside><AdmissionPanel
      joinCode={live?.meta?.joinCode ?? ''}
      capacity={live?.meta?.capacity ?? 80}
      teams={Object.values(live?.teams ?? {}).map((team) => ({ id: team.id, name: team.name }))}
      requests={Object.entries(live?.joinRequests ?? {}).filter(([id, request]) => request.connected && !live?.participants?.[id]).map(([id, request]) => ({ id, displayName: request.displayName, requestedTeamId: request.requestedTeamId }))}
      participants={Object.entries(live?.participants ?? {}).map(([id, participant]) => ({ id, displayName: participant.displayName, teamId: participant.teamId, connected: participant.connected }))}
      mode={mode}
      onModeChange={setMode}
      onCopyJoinCode={() => void navigator.clipboard.writeText(live?.meta?.joinCode ?? '').then(() => setNotice('参加コードをコピーしました。'))}
      onApprove={(id, manualTeamId) => void approveJoinRequest(services.database, marketId, id, mode, manualTeamId).then((ok) => setNotice(ok ? '参加を承認しました。' : '承認できませんでした。')).catch((error) => setNotice(handleFailure(error, '参加を承認できませんでした。')))}
      onReject={(id) => void rejectJoinRequest(services.database, marketId, id).then(() => setNotice('申請を却下しました。')).catch((error) => setNotice(handleFailure(error, '申請を却下できませんでした。')))}
      onRemove={(id) => { if (window.confirm('この生徒を市場から退出させますか？チームの資産はそのまま残ります。')) void removeParticipant(services.database, marketId, id).then(() => setNotice('退出させました。')).catch((error) => setNotice(handleFailure(error, '退出させられませんでした。'))) }}
      onReassign={(id, teamId) => void reassignParticipantTeam(services.database, marketId, id, teamId).then((ok) => setNotice(ok ? 'チームを変更しました。' : 'チームを変更できませんでした。')).catch((error) => setNotice(handleFailure(error, 'チームを変更できませんでした。')))}
    /></section></main>
}
