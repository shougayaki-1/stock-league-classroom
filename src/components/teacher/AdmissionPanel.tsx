import { useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Chip, FormControl, InputLabel, MenuItem, NativeSelect, Select, Stack, Typography } from '@mui/material'
import type { TeamAssignmentMode } from '../../lib/market/liveMarketTypes'

export interface AdmissionRequest { id: string; displayName: string; requestedTeamId: string | null; recoveryTeamId?: string }
export interface AdmissionParticipant { id: string; displayName: string; teamId: string | null; connected: boolean }

export interface AdmissionPanelProps {
  joinCode: string; capacity: number; teams: { id: string; name: string }[]; requests: AdmissionRequest[]; participants: AdmissionParticipant[]; mode: TeamAssignmentMode
  autoApprove?: boolean; onAutoApproveChange?: (enabled: boolean) => void; onModeChange: (mode: TeamAssignmentMode) => void; onApprove: (id: string, manualTeamId?: string) => void; onApproveAll?: () => void; onReject: (id: string) => void; onRemove: (id: string) => void; onReassign: (id: string, teamId: string) => void; onCopyJoinCode?: () => void; joinUrl?: string; onCopyJoinUrl?: () => void
}

const assignmentOptions: { value: TeamAssignmentMode; label: string }[] = [
  { value: 'random', label: '人数が少ないチームへ自動割当' },
  { value: 'student_choice', label: '生徒の希望を優先' },
  { value: 'manual', label: '手動で割り当て' },
]

function TeamSelect({ label, value, teams, onChange }: { label: string; value: string; teams: { id: string; name: string }[]; onChange: (value: string) => void }) {
  const id = `team-select-${label.replaceAll(/[^a-zA-Z0-9]/g, '-')}`
  return <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 180 } }}><InputLabel shrink htmlFor={id}>{label}</InputLabel><NativeSelect id={id} value={value} onChange={(event) => onChange(event.target.value)} inputProps={{ 'aria-label': label }}>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</NativeSelect></FormControl>
}

export function AdmissionPanel({ joinCode, capacity, teams, requests, participants, mode, autoApprove = false, onAutoApproveChange, onModeChange, onApprove, onApproveAll, onReject, onRemove, onReassign, onCopyJoinCode, joinUrl, onCopyJoinUrl }: AdmissionPanelProps) {
  const [manualTeams, setManualTeams] = useState<Record<string, string>>({})
  const [prevRequests, setPrevRequests] = useState(requests)
  if (requests !== prevRequests) {
    const currentIds = new Set(requests.map((request) => request.id))
    const disappearedIds = prevRequests.map((request) => request.id).filter((id) => !currentIds.has(id))
    if (disappearedIds.length) setManualTeams((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !disappearedIds.includes(id))))
    setPrevRequests(requests)
  }
  const active = participants.filter((participant) => participant.connected).length
  const teamName = (id: string | null) => teams.find((team) => team.id === id)?.name ?? '未割当'
  const requestDescription = (request: AdmissionRequest) => request.recoveryTeamId
    ? `${teamName(request.recoveryTeamId)}の続きに復帰します（元の参加者と入れ替わります）`
    : mode === 'student_choice' && request.requestedTeamId ? `希望: ${teamName(request.requestedTeamId)}` : '参加を待っています'

  return <Stack component="section" className="admission-panel" spacing={3}>
    <Card sx={{ bgcolor: 'action.hover' }}><CardContent><Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}><Box><Typography variant="overline" color="text.secondary">参加コード</Typography><Typography variant="h3" component="p" sx={{ color: 'text.primary', letterSpacing: '.12em' }}>{joinCode}</Typography></Box><Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>{onCopyJoinCode && <Button variant="outlined" onClick={onCopyJoinCode}>コードをコピー</Button>}{onCopyJoinUrl && <Button variant="contained" onClick={onCopyJoinUrl}>マジックリンクをコピー</Button>}</Stack></Stack>{joinUrl && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, wordBreak: 'break-all' }}>生徒用リンク: {joinUrl}</Typography>}</CardContent></Card>
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}><Typography color="text.secondary">参加者 <Box component="strong" sx={{ color: 'text.primary' }}>{active} / {capacity}</Box></Typography><Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ width: { xs: '100%', md: 'auto' } }}><FormControl sx={{ minWidth: { xs: '100%', md: 280 } }}><InputLabel id="assignment-mode-label">チーム編成</InputLabel><Select labelId="assignment-mode-label" label="チーム編成" value={mode} onChange={(event) => onModeChange(event.target.value as TeamAssignmentMode)}>{assignmentOptions.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}</Select></FormControl>{onAutoApproveChange && <Button variant={autoApprove ? 'contained' : 'outlined'} onClick={() => onAutoApproveChange(!autoApprove)}>{autoApprove ? '自動承認 ON' : '自動承認 OFF'}</Button>}</Stack></Stack>

    <Box component="section" className="request-list" aria-labelledby="admission-requests-heading"><Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5, justifyContent: 'space-between' }}><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Typography id="admission-requests-heading" component="h3" variant="h3">参加承認待ち</Typography><Chip size="small" color="primary" label={requests.length} /></Stack>{onApproveAll && requests.length > 0 && <Button size="small" variant="contained" onClick={onApproveAll}>一括承認</Button>}</Stack>{requests.length ? <Stack component="ul" spacing={1.25} sx={{ p: 0, m: 0, listStyle: 'none' }}>{requests.map((request) => <Card component="li" key={request.id} variant="outlined"><CardContent sx={{ '&:last-child': { pb: 2 } }}><Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}><Box sx={{ flex: 1 }}><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Typography component="strong" sx={{ fontWeight: 700 }}>{request.displayName}</Typography>{request.recoveryTeamId && <Chip size="small" color="secondary" label="復帰申請" />}</Stack><Typography variant="body2" color="text.secondary">{requestDescription(request)}</Typography></Box>{mode === 'manual' && <TeamSelect label={`${request.displayName} さんの割り当て先`} value={manualTeams[request.id] ?? teams[0]?.id ?? ''} teams={teams} onChange={(value) => setManualTeams((current) => ({ ...current, [request.id]: value }))} />}<Stack direction="row" spacing={1}><Button variant="contained" aria-label={`${request.displayName} さんを承認`} onClick={() => onApprove(request.id, mode === 'manual' ? manualTeams[request.id] ?? teams[0]?.id : undefined)}>承認</Button><Button variant="outlined" aria-label={`${request.displayName} さんの申請を却下`} onClick={() => onReject(request.id)}>却下</Button></Stack></Stack></CardContent></Card>)}</Stack> : <Alert severity="info">まだ参加申請はありません。参加コードを生徒に共有してください。</Alert>}</Box>
    <Box component="section" className="participant-list" aria-labelledby="participants-heading"><Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5 }}><Typography id="participants-heading" component="h3" variant="h3">参加中</Typography><Chip size="small" label={participants.length} /></Stack>{participants.length ? <Stack component="ul" spacing={1.25} sx={{ p: 0, m: 0, listStyle: 'none' }}>{participants.map((participant) => <Card component="li" key={participant.id} variant="outlined" className={participant.connected ? '' : 'disconnected'}><CardContent sx={{ '&:last-child': { pb: 2 } }}><Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}><Box sx={{ flex: 1 }}><Typography component="strong" sx={{ fontWeight: 700 }}>{participant.displayName}</Typography><Typography variant="body2" color="text.secondary">{participant.connected ? teamName(participant.teamId) : `${teamName(participant.teamId)}・接続が切れています`}</Typography></Box><TeamSelect label={`${participant.displayName} さんのチーム`} value={participant.teamId ?? ''} teams={teams} onChange={(value) => onReassign(participant.id, value)} /><Button color="error" variant="outlined" aria-label={`${participant.displayName} さんを退出させる`} onClick={() => onRemove(participant.id)}>退出</Button></Stack></CardContent></Card>)}</Stack> : <Alert severity="info">まだ参加者はいません。</Alert>}</Box>
  </Stack>
}
