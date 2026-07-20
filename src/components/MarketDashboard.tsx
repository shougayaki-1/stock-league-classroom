import { useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { onValue, ref, type Unsubscribe } from 'firebase/database'
import { bootstrapFirebase } from '../lib/firebase/bootstrap'
import { isTeacherIdentity } from '../lib/auth/roles'
import { approveJoinRequest, createMarket, resolveJoinCode } from '../lib/market/marketRepository'
import type { JoinRequest, LiveMarketState, MarketVisibility, TeamAssignmentMode } from '../lib/market/liveMarketTypes'
import { listPersonalTemplates } from '../lib/templates/templateRepository'
import type { PersonalTemplate } from '../lib/templates/types'

const code = () => Math.random().toString(36).slice(2, 8).toUpperCase()
const teams = [{ id: 'red', name: '赤チーム' }, { id: 'blue', name: '青チーム' }]

export const TeacherMarketDashboard = () => {
  const services = bootstrapFirebase()
  const [user, setUser] = useState<User | null>(services.auth.currentUser)
  const [templates, setTemplates] = useState<PersonalTemplate[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [visibility, setVisibility] = useState<MarketVisibility>('private')
  const [marketId, setMarketId] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [state, setState] = useState<LiveMarketState | null>(null)
  const [notice, setNotice] = useState('')
  const [mode, setMode] = useState<TeamAssignmentMode>('random')
  useEffect(() => onAuthStateChanged(services.auth, setUser), [services.auth])
  const teacher = Boolean(user && isTeacherIdentity(user))
  useEffect(() => {
    if (!teacher || !user) return
    void listPersonalTemplates(services.firestore, user.uid).then((items) => { setTemplates(items); setSelectedId(items[0]?.id ?? '') }).catch(() => setNotice('テンプレートを読み込めませんでした。'))
  }, [services.firestore, teacher, user])
  useEffect(() => {
    if (!marketId) return
    let stop: Unsubscribe | undefined
    stop = onValue(ref(services.database, `liveMarkets/${marketId}`), (snapshot) => setState(snapshot.val() as LiveMarketState | null))
    return () => stop?.()
  }, [services.database, marketId])
  const selected = useMemo(() => templates.find((item) => item.id === selectedId), [selectedId, templates])
  if (!teacher || !user) return <main><h1>教師ダッシュボード</h1><p>市場を作成するには教師用メールリンクでログインしてください。</p></main>
  const create = async () => {
    if (!selected) return setNotice('先にテンプレートを作成してください。')
    const nextCode = code()
    const id = await createMarket(services.firestore, services.database, { ownerUid: user.uid, template: selected, visibility, joinCode: nextCode, teams })
    setMarketId(id); setJoinCode(nextCode); setNotice('市場を作成しました。')
  }
  const requests = Object.entries(state?.joinRequests ?? {}).filter(([, request]) => request.connected && !state?.participants?.[request.uid + '_' + request.sessionId])
  return <main>
    <h1>教師ダッシュボード</h1>{notice && <p role="status">{notice}</p>}
    <label>テンプレート <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{templates.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    <label>公開範囲 <select value={visibility} onChange={(event) => setVisibility(event.target.value as MarketVisibility)}><option value="private">非公開</option><option value="ranking_only">順位のみ</option><option value="public">公開</option></select></label>
    <button type="button" onClick={() => void create().catch(() => setNotice('市場を作成できませんでした。'))}>市場を作成</button>
    {marketId && <section aria-labelledby="active-market"><h2 id="active-market">進行中の市場</h2><p>参加コード: <strong>{joinCode}</strong></p><p>定員: {state?.meta.capacity ?? 80}人 / 接続中: {Object.values(state?.participants ?? {}).filter((item) => item.connected).length}人</p>
      <label>チーム割当 <select value={mode} onChange={(event) => setMode(event.target.value as TeamAssignmentMode)}><option value="random">最少人数へ自動割当</option><option value="student_choice">生徒の希望を優先</option><option value="manual">手動</option></select></label>
      <h3>参加承認待ち</h3><ul>{requests.map(([id, request]) => <JoinRequestRow key={id} id={id} request={request} mode={mode} marketId={marketId} onApprove={() => approveJoinRequest(services.database, marketId, id, mode).then((ok) => setNotice(ok ? '参加を承認しました。' : '承認できませんでした。'))} />)}</ul>
    </section>}
  </main>
}

const JoinRequestRow = ({ id, request, mode, marketId, onApprove }: { id: string; request: JoinRequest; mode: TeamAssignmentMode; marketId: string; onApprove: () => Promise<void> }) => <li>{request.displayName} {mode === 'student_choice' && request.requestedTeamId ? `（希望: ${request.requestedTeamId}）` : ''}<button type="button" data-market-id={marketId} data-request-id={id} onClick={() => void onApprove()}>承認</button></li>

export const StudentMarketJoin = () => {
  const services = bootstrapFirebase()
  const [joinCode, setJoinCode] = useState('')
  const [result, setResult] = useState('')
  return <main><h1>市場に参加</h1><label>参加コード <input value={joinCode} onChange={(event) => setJoinCode(event.target.value)} /></label><button type="button" onClick={() => void resolveJoinCode(services.firestore, joinCode).then((id) => setResult(id ? `市場を見つけました: ${id}` : '市場が見つかりません。')).catch(() => setResult('参加コードを確認できません。'))}>確認</button>{result && <p role="status">{result}</p>}</main>
}
