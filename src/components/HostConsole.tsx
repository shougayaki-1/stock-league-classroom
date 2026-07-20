import { useEffect, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { bootstrapFirebase } from '../lib/firebase/bootstrap'
import { isTeacherIdentity } from '../lib/auth/roles'
import { acquireHostLease, armHostLeaseDisconnect, openMarket, publishManualNews } from '../lib/market/hostTrading'

const leaseId = () => crypto.randomUUID()
export const HostConsole = ({ marketId }: { marketId: string }) => {
  const services = bootstrapFirebase(); const [user, setUser] = useState<User | null>(services.auth.currentUser)
  const [lease, setLease] = useState(''); const [news, setNews] = useState(''); const [notice, setNotice] = useState('')
  useEffect(() => onAuthStateChanged(services.auth, setUser), [services.auth])
  if (!user || !isTeacherIdentity(user)) return <main><h1>ホストコンソール</h1><p>教師用メールリンクでログインしてください。</p></main>
  const takeLease = async () => { const next = leaseId(); const ok = await acquireHostLease(services.database, marketId, user.uid, next); if (!ok) return setNotice('この市場のホストを取得できません。'); await armHostLeaseDisconnect(services.database, marketId, { ownerUid: user.uid, leaseId: next, expiresAtMillis: Date.now() + 15_000, paused: false }); setLease(next); setNotice('ホストを取得しました。') }
  return <main><h1>ホストコンソール</h1><p>{notice}</p><button type="button" onClick={() => void takeLease().catch(() => setNotice('ホスト取得に失敗しました。'))}>ホストを取得</button>{lease && <><button type="button" onClick={() => void openMarket(services.database, marketId, user.uid, lease).then(() => setNotice('市場を開始しました。')).catch(() => setNotice('開始できません。'))}>市場を開始</button><label>手動ニュース <input value={news} onChange={(event) => setNews(event.target.value)} /></label><button type="button" onClick={() => void publishManualNews(services.database, marketId, user.uid, lease, news).then(() => { setNews(''); setNotice('ニュースを配信しました。') }).catch(() => setNotice('ニュースを配信できません。'))}>配信</button></>}</main>
}
