import { useState } from 'react'
import type { TeamAssignmentMode } from '../../lib/market/liveMarketTypes'

export interface AdmissionRequest { id: string; displayName: string; requestedTeamId: string | null }
export interface AdmissionParticipant { id: string; displayName: string; teamId: string | null; connected: boolean }

export interface AdmissionPanelProps {
  joinCode: string
  capacity: number
  teams: { id: string; name: string }[]
  requests: AdmissionRequest[]
  participants: AdmissionParticipant[]
  mode: TeamAssignmentMode
  onModeChange: (mode: TeamAssignmentMode) => void
  onApprove: (id: string, manualTeamId?: string) => void
  onReject: (id: string) => void
  onRemove: (id: string) => void
  onReassign: (id: string, teamId: string) => void
  onCopyJoinCode?: () => void
}

export function AdmissionPanel({ joinCode, capacity, teams, requests, participants, mode, onModeChange, onApprove, onReject, onRemove, onReassign, onCopyJoinCode }: AdmissionPanelProps) {
  const [manualTeams, setManualTeams] = useState<Record<string, string>>({})
  const active = participants.filter((participant) => participant.connected).length
  const teamName = (id: string | null) => teams.find((team) => team.id === id)?.name ?? '未割当'
  return (
    <section className="admission-panel">
      <div className="join-code">
        <span>参加コード</span><strong>{joinCode}</strong>
        {onCopyJoinCode && <button type="button" onClick={onCopyJoinCode}>コピー</button>}
      </div>
      <div className="market-meta">
        <span>参加者 <b>{active} / {capacity}</b></span>
        <label>チーム編成
          <select value={mode} onChange={(event) => onModeChange(event.target.value as TeamAssignmentMode)}>
            <option value="random">人数が少ないチームへ自動割当</option>
            <option value="student_choice">生徒の希望を優先</option>
            <option value="manual">手動で割り当て</option>
          </select>
        </label>
      </div>

      <div className="request-list">
        <h3>参加承認待ち <span>{requests.length}</span></h3>
        {requests.length ? (
          <ul>{requests.map((request) => (
            <li key={request.id}>
              <div>
                <strong>{request.displayName}</strong>
                <small>{mode === 'student_choice' && request.requestedTeamId ? `希望: ${teamName(request.requestedTeamId)}` : '参加を待っています'}</small>
              </div>
              {mode === 'manual' && (
                <label>
                  <span className="visually-hidden">{request.displayName} さんの割り当て先</span>
                  <select
                    aria-label={`${request.displayName} さんの割り当て先`}
                    value={manualTeams[request.id] ?? teams[0]?.id ?? ''}
                    onChange={(event) => setManualTeams((current) => ({ ...current, [request.id]: event.target.value }))}
                  >{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select>
                </label>
              )}
              <button type="button" aria-label={`${request.displayName} さんを承認`} onClick={() => onApprove(request.id, mode === 'manual' ? manualTeams[request.id] ?? teams[0]?.id : undefined)}>承認</button>
              <button type="button" className="outline-button" aria-label={`${request.displayName} さんの申請を却下`} onClick={() => onReject(request.id)}>却下</button>
            </li>
          ))}</ul>
        ) : <p className="empty-copy">まだ参加申請はありません。参加コードを生徒に共有してください。</p>}
      </div>

      <div className="participant-list">
        <h3>参加中 <span>{participants.length}</span></h3>
        {participants.length ? (
          <ul>{participants.map((participant) => (
            <li key={participant.id} className={participant.connected ? '' : 'disconnected'}>
              <div>
                <strong>{participant.displayName}</strong>
                <small>{participant.connected ? teamName(participant.teamId) : `${teamName(participant.teamId)}・接続が切れています`}</small>
              </div>
              <label>
                <span className="visually-hidden">{participant.displayName} さんのチーム</span>
                <select
                  aria-label={`${participant.displayName} さんのチーム`}
                  value={participant.teamId ?? ''}
                  onChange={(event) => onReassign(participant.id, event.target.value)}
                >{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select>
              </label>
              <button type="button" className="danger-button" aria-label={`${participant.displayName} さんを退出させる`} onClick={() => onRemove(participant.id)}>退出</button>
            </li>
          ))}</ul>
        ) : <p className="empty-copy">まだ参加者はいません。</p>}
      </div>
    </section>
  )
}
