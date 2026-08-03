import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { onValue, ref, type Unsubscribe } from 'firebase/database'
import { bootstrapFirebase } from '../lib/firebase/bootstrap'
import { signInTeacherWithGoogle } from '../lib/auth/teacherAuth'
import { getOrCreateStudentUid } from '../lib/auth/studentAuth'
import { isTeacherIdentity } from '../lib/auth/roles'
import { AdmissionPanel } from './teacher/AdmissionPanel'
import { approveJoinRequest, armJoinRequestPresence, createMarket, listOwnedMarkets, RECOVERY_CODE_LENGTH, reassignParticipantTeam, rejectJoinRequest, removeParticipant, requestToJoinMarket, resolveJoinCode, resolveRecoveryTeamId, type MarketRecord } from '../lib/market/marketRepository'
import type { LiveMarketState, MarketVisibility, TeamAssignmentMode } from '../lib/market/liveMarketTypes'
import { listPersonalTemplates } from '../lib/templates/templateRepository'
import { readServiceStatus, type ServiceStatus } from '../lib/service/serviceStatus'
import type { PersonalTemplate } from '../lib/templates/types'
import { deleteMarketCompletely } from '../lib/teacher/marketDeletion'
import { buildTeamCsv, buildTransactionCsv, downloadCsv, fetchMarketResults } from '../lib/teacher/resultsExport'
import { getStudentSessionId, readActiveStudentSession, saveActiveStudentSession } from '../lib/students/studentSession'
import { useDatabaseConnected } from '../lib/firebase/connectionState'
import { handleFailure } from '../lib/monitoring/describeError'
import { AppVersion } from './AppVersion'

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
  const [templates, setTemplates] = useState<PersonalTemplate[]>([]), [selectedId, setSelectedId] = useState(''), [visibility, setVisibility] = useState<MarketVisibility>('private')
  const [markets, setMarkets] = useState<MarketRecord[]>([])
  const [marketId, setMarketId] = useState(() => new URLSearchParams(window.location.search).get('market') ?? ''), [joinCode, setJoinCode] = useState(''), [state, setState] = useState<LiveMarketState | null>(null), [notice, setNotice] = useState(''), [mode, setMode] = useState<TeamAssignmentMode>('random'), [creating, setCreating] = useState(false)
  const [status, setStatus] = useState<ServiceStatus>({ acceptingNewMarkets: true, message: '' })
  useEffect(() => onAuthStateChanged(services.auth, setUser), [services.auth])
  // The stop is enforced by the rules; this read only explains the refusal.
  useEffect(() => { void readServiceStatus(services.firestore).then(setStatus) }, [services.firestore])
  const teacher = Boolean(user && isTeacherIdentity(user))
  const refreshOwned = useCallback(async (uid: string) => {
    const [items, owned] = await Promise.all([listPersonalTemplates(services.firestore, uid), listOwnedMarkets(services.firestore, uid)])
    setTemplates(items); setSelectedId((current) => current || items[0]?.id || ''); setMarkets(owned)
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
  useEffect(() => { if (state?.meta?.joinCode) setJoinCode(state.meta.joinCode) }, [state?.meta?.joinCode])
  const selected = useMemo(() => templates.find((item) => item.id === selectedId), [selectedId, templates])
  const requests = Object.entries(state?.joinRequests ?? {})
    .filter(([id, request]) => request.connected && !state?.participants?.[id])
    .map(([id, request]) => ({ id, displayName: request.displayName, requestedTeamId: request.requestedTeamId, recoveryTeamId: resolveRecoveryTeamId(state, request) }))
  const participants = Object.entries(state?.participants ?? {})
    .map(([id, participant]) => ({ id, displayName: participant.displayName, teamId: participant.teamId, connected: participant.connected }))
  const activeCount = participants.filter((participant) => participant.connected).length
  const teamOptions = Object.values(state?.teams ?? {}).map((team) => ({ id: team.id, name: team.name }))
  const signInWithGoogle = async () => { try { await signInTeacherWithGoogle(services.auth); setAuthNotice('Google アカウントでログインしました。') } catch (error) { setAuthNotice(googleSignInErrorMessage(error)) } }
  const create = async () => { if (!selected || !user) return setNotice('先にテンプレートを作成してください。'); setCreating(true); try { const result = await createMarket(services.firestore, services.database, { ownerUid: user.uid, template: selected, visibility }); setMarketId(result.marketId); setJoinCode(result.joinCode); await refreshOwned(user.uid); setNotice('市場を作成しました。参加コードを生徒に共有してください。') } catch (error) { setNotice(error instanceof Error && error.message.startsWith('参加コード') ? error.message : handleFailure(error, '市場を作成できませんでした。接続と権限を確認してください。')) } finally { setCreating(false) } }
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
    if (marketId === market.id) { setMarketId(''); setJoinCode(''); setState(null) }
    await refreshOwned(user.uid)
    setNotice('市場を削除しました。')
  }
  if (!teacher || !user) return <main className="portal-page"><section className="portal-auth"><a className="portal-brand" href="/">← Stock League Classroom</a><p className="portal-eyebrow">TEACHER PORTAL</p><h1>授業の市場を、<br />ここから準備。</h1><p>Google アカウントでログインすると、テンプレートの編集、市場の作成、参加状況の管理ができます。</p><button className="portal-button google-sign-in" type="button" onClick={() => void signInWithGoogle()}><b>G</b> Google でログイン <span>→</span></button>{authNotice && <p className="form-notice" role="status">{authNotice}</p>}<p className="portal-help">教師用の Google アカウントを選択してください。</p></section><aside className="portal-aside"><p>CLASSROOM MARKET</p><strong>準備から振り返りまで、<br />一つの教室で。</strong><ul><li>授業テーマに合うテンプレート</li><li>生徒の参加をその場で承認</li><li>市場の進行をリアルタイムで管理</li></ul></aside></main>
  return <main className="teacher-page"><header className="teacher-header"><a className="portal-brand" href="/">Stock League <span>Classroom</span></a><div><a href="/templates">テンプレートを管理</a><span className="teacher-avatar">{(user.email ?? 'T').slice(0, 1).toUpperCase()}</span><AppVersion /></div></header><section className="teacher-hero"><div><p className="portal-eyebrow">TEACHER PORTAL</p><h1>今日の授業を、<br /><em>市場にしよう。</em></h1><p>テンプレートを選んで市場を作成し、参加コードを生徒へ共有します。</p></div><div className="teacher-stats"><div><span>作成済みテンプレート</span><strong>{templates.length}</strong></div><div><span>市場の定員</span><strong>80 <small>人</small></strong></div><div><span>現在の参加者</span><strong>{activeCount}</strong></div></div></section><section className="teacher-workspace"><div className="create-market-card"><div className="card-heading"><div><p className="section-kicker">NEW MARKET</p><h2>市場を作成</h2></div><a href="/templates">テンプレートを編集 →</a></div>{notice && <p className="form-notice" role="status">{notice}</p>}{!status.acceptingNewMarkets && <p className="form-notice stopped" role="alert"><strong>現在、新しい市場の作成を停止しています。</strong>{status.message || 'メンテナンスのため一時的に受付を止めています。進行中の市場はそのままご利用いただけます。'}</p>}<div className="field-grid"><label>使うテンプレート<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">選択してください</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label>公開範囲<select value={visibility} onChange={(event) => setVisibility(event.target.value as MarketVisibility)}><option value="private">参加者のみ</option><option value="ranking_only">順位のみ公開</option><option value="public">価格・ニュース・順位を公開</option></select></label></div>{templates.length === 0 && <div className="empty-panel"><strong>まずはテンプレートを作成しましょう。</strong><p>会社や初期資金を設定すると、授業に合った市場を作れます。</p><a className="inline-link" href="/templates">テンプレートを作成 →</a></div>}<button className="portal-button" type="button" disabled={!selected || creating || !status.acceptingNewMarkets} onClick={() => void create()}>{creating ? '市場を準備中…' : !status.acceptingNewMarkets ? '受付を停止しています' : '参加コードを発行して市場を作成'} <span>→</span></button></div>{marketId && <section className="active-market-card"><div className="active-head"><div><p className="section-kicker">ACTIVE MARKET</p><h2>生徒の参加を待っています</h2></div><div><a className="host-link" href={`/teacher/markets/${marketId}/host`}>ホスト画面 →</a> <a className="host-link" href={`/markets/${marketId}/signage`}>教室画面 →</a></div></div><AdmissionPanel
          joinCode={joinCode}
          capacity={state?.meta?.capacity ?? 80}
          teams={teamOptions}
          requests={requests}
          participants={participants}
          mode={mode}
          onModeChange={setMode}
          onCopyJoinCode={() => void navigator.clipboard.writeText(joinCode).then(() => setNotice('参加コードをコピーしました。'))}
          onApprove={(id, manualTeamId) => void approveJoinRequest(services.database, marketId, id, mode, manualTeamId).then((ok) => setNotice(ok ? '参加を承認しました。' : '承認できませんでした。定員か、生徒の接続を確認してください。')).catch((error) => setNotice(handleFailure(error, '参加を承認できませんでした。')))}
          onReject={(id) => void rejectJoinRequest(services.database, marketId, id).then(() => setNotice('申請を却下しました。')).catch((error) => setNotice(handleFailure(error, '申請を却下できませんでした。')))}
          onRemove={(id) => { if (window.confirm('この生徒を市場から退出させますか？チームの資産はそのまま残ります。')) void removeParticipant(services.database, marketId, id).then(() => setNotice('退出させました。')).catch((error) => setNotice(handleFailure(error, '退出させられませんでした。'))) }}
          onReassign={(id, teamId) => void reassignParticipantTeam(services.database, marketId, id, teamId).then((ok) => setNotice(ok ? 'チームを変更しました。' : 'チームを変更できませんでした。')).catch((error) => setNotice(handleFailure(error, 'チームを変更できませんでした。')))}
        /></section>}<section className="template-section"><div className="template-section-head"><div><p className="section-kicker">MARKET HISTORY</p><h2>作成済み市場</h2></div><span>{markets.length} 件</span></div>{markets.length ? <ul className="template-list">{markets.map((market) => <li key={market.id}><div><strong>{market.templateSnapshot.title}</strong><p>参加コード {market.joinCode} ・ {market.creationStatus}</p></div><div className="template-actions"><button type="button" onClick={() => { setMarketId(market.id); setJoinCode(market.joinCode); setState(null) }}>参加を承認</button><a href={`/teacher/markets/${market.id}/host`}>ホスト</a><a href={`/markets/${market.id}/signage`}>教室画面</a><button type="button" onClick={() => void exportResults(market).catch((error) => setNotice(handleFailure(error, '結果を読み込めませんでした。')))}>結果をCSVで保存</button><button className="danger-button" onClick={() => void removeMarket(market).catch((error) => setNotice(handleFailure(error, '市場を削除できませんでした。一部だけ削除された可能性があります。もう一度削除を実行してください。')))}>削除</button></div></li>)}</ul> : <p className="empty-copy">まだ市場はありません。</p>}</section></section></main>
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
  return <main className="student-page"><header><a className="portal-brand" href="/">Stock League <span>Classroom</span></a><span>STUDENT ENTRY</span></header><section className="student-card"><div className="student-icon">↗</div><p className="portal-eyebrow">JOIN A MARKET</p><h1>市場に参加</h1><p>先生から受け取った参加コードを入力してください。</p>{activeSession && <a className="inline-link" href={`/markets/${activeSession.marketId}/play`}>前回の市場へ戻る →</a>}{status === 'approved' ? <div className="approved-state"><span>✓</span><h2>参加準備ができました</h2><p>{message}</p></div> : <><label>参加コード<input value={joinCode} maxLength={6} placeholder="例: A1B2C3" onChange={(event) => setJoinCode(event.target.value.toUpperCase())} disabled={status === 'waiting' || status === 'requesting'} /></label><label>表示名<input value={displayName} maxLength={20} placeholder="例: 山田 太郎" onChange={(event) => setDisplayName(event.target.value)} disabled={status === 'waiting' || status === 'requesting'} /></label><label>復帰コード（前に使っていた端末で見た4文字。初めての人は空のまま）<input value={recoveryCode} maxLength={4} placeholder="例: A1B2" onChange={(event) => setRecoveryCode(event.target.value.toUpperCase())} disabled={status === 'waiting' || status === 'requesting'} /><small>復帰コードを入力するときは、表示名を前回と完全に同じ文字で入力してください。</small></label><button className="portal-button" type="button" onClick={() => void join()} disabled={status === 'waiting' || status === 'requesting'}>{status === 'requesting' ? '市場を確認中…' : status === 'waiting' ? '先生の承認を待っています' : '参加を申請する'} <span>→</span></button><p className={`student-message ${status}`} role="status">{message}</p></>}</section><footer>投資はシミュレーションです。実際のお金は使用しません。</footer></main>
}
