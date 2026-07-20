import { useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { bootstrapFirebase } from '../lib/firebase/bootstrap'
import { isTeacherIdentity } from '../lib/auth/roles'
import { acquireHostLease, armHostLeaseDisconnect, openMarket, publishManualNews, runHostTick } from '../lib/market/hostTrading'
import type { TemplateSpec } from '../lib/templates/types'

const leaseId = () => crypto.randomUUID()
export const HostConsole = ({ marketId }: { marketId: string }) => {
  const services = bootstrapFirebase(); const [user, setUser] = useState<User | null>(services.auth.currentUser)
  const [lease, setLease] = useState(''); const [news, setNews] = useState(''); const [notice, setNotice] = useState(''); const [template, setTemplate] = useState<TemplateSpec | null>(null)
  useEffect(() => onAuthStateChanged(services.auth, setUser), [services.auth])
  useEffect(() => { if (!user || !isTeacherIdentity(user)) return; void getDoc(doc(services.firestore, 'markets', marketId)).then((snapshot) => setTemplate(snapshot.data()?.templateSnapshot as TemplateSpec ?? null)).catch(() => setNotice('市場設定を取得できません。')) }, [marketId, services.firestore, user])
  const stocks = useMemo(() => (template?.companies ?? []).map((company) => ({ id: company.id, basePrice: company.initialPrice })), [template])
  useEffect(() => {
    if (!lease || !user || !template) return
    const tick = () => void runHostTick(services.firestore, services.database, marketId, user.uid, lease, stocks).then((ok) => { if (!ok) { setLease(''); setNotice('ホストリースが失効しました。') } }).catch(() => setNotice('ホスト処理を再試行します。'))
    tick(); const timer = window.setInterval(tick, 1_000); return () => window.clearInterval(timer)
  }, [lease, marketId, services.database, services.firestore, stocks, template, user])
  if (!user || !isTeacherIdentity(user)) return <main><h1>ホストコンソール</h1><p>教師用メールリンクでログインしてください。</p></main>
  const takeLease = async () => { const next = leaseId(); const expiresAtMillis = Date.now() + 15_000; const ok = await acquireHostLease(services.database, marketId, user.uid, next); if (!ok) return setNotice('この市場のホストを取得できません。'); await armHostLeaseDisconnect(services.database, marketId, { ownerUid: user.uid, leaseId: next, expiresAtMillis, paused: false }); setLease(next); setNotice('ホストを取得しました。') }
  return <main><h1>ホストコンソール</h1><p>{notice}</p><button type="button" onClick={() => void takeLease().catch(() => setNotice('ホスト取得に失敗しました。'))}>ホストを取得</button>{lease && <><button type="button" onClick={() => void openMarket(services.database, marketId, user.uid, lease).then(() => setNotice('市場を開始しました。')).catch(() => setNotice('開始できません。'))}>市場を開始</button><label>手動ニュース <input value={news} onChange={(event) => setNews(event.target.value)} /></label><button type="button" onClick={() => void publishManualNews(services.database, marketId, user.uid, lease, news).then(() => { setNews(''); setNotice('ニュースを配信しました。') }).catch(() => setNotice('ニュースを配信できません。'))}>配信</button></>}</main>
}
