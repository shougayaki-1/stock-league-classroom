import { useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { bootstrapFirebase } from '../lib/firebase/bootstrap'
import { isTeacherIdentity } from '../lib/auth/roles'
import { acquireHostLease, armHostLeaseDisconnect, openMarket, publishManualNews, requestMarketEnding, runHostTick } from '../lib/market/hostTrading'
import type { TemplateSpec } from '../lib/templates/types'
import { useDatabaseOffline } from '../lib/firebase/connectionState'

const leaseId = () => crypto.randomUUID()
export const HostConsole = ({ marketId }: { marketId: string }) => {
  const services = bootstrapFirebase(); const [user, setUser] = useState<User | null>(services.auth.currentUser)
  const [lease, setLease] = useState(''); const [news, setNews] = useState(''); const [notice, setNotice] = useState(''); const [template, setTemplate] = useState<TemplateSpec | null>(null)
  const offline = useDatabaseOffline(services.database)
  useEffect(() => onAuthStateChanged(services.auth, setUser), [services.auth])
  useEffect(() => { if (!user || !isTeacherIdentity(user)) return; void getDoc(doc(services.firestore, 'markets', marketId)).then((snapshot) => setTemplate(snapshot.data()?.templateSnapshot as TemplateSpec ?? null)).catch(() => setNotice('市場設定を取得できません。')) }, [marketId, services.firestore, user])
  const stocks = useMemo(() => (template?.companies ?? []).map((company) => ({ id: company.id, basePrice: company.initialPrice, phases: company.pricePhases })), [template])
  useEffect(() => {
    if (!lease || !user || !template) return
    const tick = () => void runHostTick(services.firestore, services.database, marketId, user.uid, lease, stocks).then((ok) => { if (!ok) { setLease(''); setNotice('ホストリースが失効しました。') } }).catch(() => setNotice('ホスト処理を再試行します。'))
    tick(); const timer = window.setInterval(tick, 1_000); return () => window.clearInterval(timer)
  }, [lease, marketId, services.database, services.firestore, stocks, template, user])
  if (!user || !isTeacherIdentity(user)) return <main className="workspace-gate"><a className="portal-brand" href="/teacher/markets">← Stock League Classroom</a><div><p className="portal-eyebrow">HOST CONSOLE</p><h1>市場を進行する</h1><p>市場を開始・終了したり、授業中のニュースを配信するには教師としてログインしてください。</p><a className="portal-button" href="/teacher/markets">教師としてログイン <span>→</span></a></div></main>
  const takeLease = async () => { const next = leaseId(); const expiresAtMillis = Date.now() + 15_000; const ok = await acquireHostLease(services.database, marketId, user.uid, next); if (!ok) return setNotice('この市場のホストを取得できません。'); await armHostLeaseDisconnect(services.database, marketId, { ownerUid: user.uid, leaseId: next, expiresAtMillis, paused: false }); setLease(next); setNotice('ホストを取得しました。') }
  return <main className="host-page"><header className="teacher-header"><a className="portal-brand" href="/teacher/markets">Stock League <span>Classroom</span></a><a href="/teacher/markets">← 市場の管理へ</a></header><section className="host-hero"><div><p className="portal-eyebrow">HOST CONSOLE</p><h1>市場の進行を、<em>コントロール。</em></h1><p>市場ID: <code>{marketId}</code></p></div><div className={`host-status ${lease ? 'connected' : ''}`}><span>{lease ? '●' : '○'}</span>{lease ? 'ホスト接続中' : 'ホスト未接続'}</div></section><section className="host-workspace">{offline && <p className="form-notice stopped" role="alert"><strong>サーバーに接続できていません。市場の進行が止まっています。</strong>価格の更新と生徒の売買は処理されていません。通信を確認してください。同時利用が上限に達している場合、しばらく待つと復帰します。</p>}{notice && <p className="form-notice host-notice" role="status">{notice}</p>}<div className="host-main-card"><p className="section-kicker">MARKET CONTROL</p><h2>{lease ? '市場を進行できます' : 'この端末で市場を管理する'}</h2><p>{lease ? '市場の開始・終了やニュース配信を行えます。画面を閉じるとホスト権限は自動的に解放されます。' : '最初にホスト権限を取得してください。ほかの端末が操作中の場合は取得できません。'}</p>{!lease ? <button className="portal-button" type="button" onClick={() => void takeLease().catch(() => setNotice('ホスト取得に失敗しました。'))}>ホストを取得する <span>→</span></button> : <div className="host-controls"><button className="portal-button" type="button" onClick={() => void openMarket(services.database, marketId, user.uid, lease).then(() => setNotice('市場を開始しました。')).catch(() => setNotice('開始できません。'))}>市場を開始</button><button className="outline-button" type="button" onClick={() => { if (window.confirm('市場を終了し、結果を確定しますか？')) void requestMarketEnding(services.database, marketId, user.uid, lease).then((result) => setNotice(result.committed ? '終了処理を開始しました。完了まで再試行します。' : '終了処理を開始できません。')) }}>市場を終了</button></div>}</div><aside className="news-card"><p className="section-kicker">MANUAL NEWS</p><h2>ニュースを配信</h2><p>授業中の出来事を市場へ届けます。</p><label>ニュース本文<textarea value={news} rows={4} placeholder="例: 新商品の発表で期待が高まる" onChange={(event) => setNews(event.target.value)} disabled={!lease} /></label><button className="portal-button" type="button" disabled={!lease || !news.trim()} onClick={() => void publishManualNews(services.database, marketId, user.uid, lease, news).then(() => { setNews(''); setNotice('ニュースを配信しました。') }).catch(() => setNotice('ニュースを配信できません。'))}>配信する <span>→</span></button></aside></section></main>
}
