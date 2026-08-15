import { useState } from 'react'
import { Link } from 'react-router'
import { Button, List, ListItem, ListItemText, MenuItem, Stack, TextField, Typography } from '@mui/material'
import type { Invitation } from '../../../lib/organizations/invitations'
import type { OrgMember } from '../../../lib/organizations/orgMembers'
import type { OrgAuditLogEntry } from '../../../lib/privacy/orgAuditLog'
import type {
  OrgStudentDataSearchResult,
  OrgStudentSearchField,
} from '../../../lib/privacy/orgStudentDataSearch'

const STATUS_LABEL: Record<Invitation['status'], string> = { PENDING: '招待中', ACCEPTED: '参加済み', REVOKED: '失効済み' }
const ROLE_LABEL: Record<OrgMember['role'], string> = { owner: 'owner', admin: '管理者', teacher: '教師' }
const SEAT_ROLES: OrgMember['role'][] = ['owner', 'admin', 'teacher']

export interface SchoolOrgSettingsPageProps {
  orgName: string
  orgId: string
  invitations: Invitation[]
  onInvite: (email: string, role: 'admin' | 'teacher') => void
  inviting: boolean
  members: OrgMember[]
  viewerUid: string
  canManageMembers: boolean
  onSuspendMember: (uid: string) => void
  suspending: boolean
  teacherSeatLimit: number | undefined
  parentOrgName?: string | null
  onRevokeInvitation: (invitationId: string) => void
  onChangeRole: (uid: string, newRole: 'owner' | 'admin' | 'teacher') => void
  onExportStudentData: () => void
  exportingStudentData: boolean
  auditLogEntries?: OrgAuditLogEntry[]
  loadingAuditLog?: boolean
  studentDataRetentionDays?: number | null
  settingRetentionPolicy?: boolean
  onSetStudentDataRetentionDays?: (days: number) => void
  purgingOrg?: boolean
  onPurgeOrg?: () => void
  onSearchStudentData?: (input: { field: OrgStudentSearchField; query: string; reason: string }) => void
  searchingStudentData?: boolean
  studentDataSearchResult?: OrgStudentDataSearchResult
  onClearStudentDataSearch?: () => void
}

function ConfirmDeleteOrgForm({ orgId, purging, onConfirm }: { orgId: string; purging: boolean; onConfirm?: () => void }) {
  const [typed, setTyped] = useState('')
  return (
    <div>
      <label>
        確認のため組織ID({orgId})を入力してください
        <input value={typed} onChange={(event) => setTyped(event.target.value)} disabled={purging} />
      </label>
      <button type="button" disabled={typed !== orgId || purging} onClick={onConfirm}>
        {purging ? '削除中…' : '完全に削除する'}
      </button>
    </div>
  )
}

function StudentDataSearchSection({
  onSearch,
  searching,
  result,
  onClear,
}: {
  onSearch?: (input: { field: OrgStudentSearchField; query: string; reason: string }) => void
  searching?: boolean
  result?: OrgStudentDataSearchResult
  onClear?: () => void
}) {
  const [field, setField] = useState<OrgStudentSearchField>('displayName')
  const [query, setQuery] = useState('')
  const [reason, setReason] = useState('')

  const canSubmit = !searching && query.trim().length > 0 && reason.trim().length > 0

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!canSubmit || !onSearch) return
    onSearch({ field, query: query.trim(), reason: reason.trim() })
  }

  return (
    <section>
      <Typography variant="h6" component="h3">生徒データ検索</Typography>
      <Typography variant="body2" color="text.secondary">
        生徒名または外部識別子（完全一致）で授業内の生徒参加者データを検索します。
      </Typography>
      <form onSubmit={handleSubmit}>
        <Stack spacing={2} sx={{ mt: 1, maxWidth: 500 }}>
          <TextField
            select
            slotProps={{ select: { native: true } }}
            label="検索項目"
            value={field}
            onChange={(e) => setField(e.target.value as OrgStudentSearchField)}
            size="small"
          >
            <option value="displayName">生徒名</option>
            <option value="externalIdentifier">外部識別子</option>
          </TextField>
          <TextField
            label="検索値"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            size="small"
            placeholder={field === 'displayName' ? '生徒名（完全一致）' : '外部識別子（完全一致）'}
            disabled={searching}
          />
          <TextField
            label="閲覧理由"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            size="small"
            placeholder="閲覧理由を入力してください（必須）"
            multiline
            rows={2}
            disabled={searching}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={!canSubmit}
            sx={{ alignSelf: 'flex-start' }}
          >
            {searching ? '検索中…' : '検索'}
          </Button>
        </Stack>
      </form>

      {result && (
        <Stack spacing={1} sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
          <Typography variant="body2" color="text.secondary">
            この個票は10分後に自動的に閉じられます。
          </Typography>
          {result.truncated && (
            <Typography variant="body2" color="warning.main">
              検索結果が50件を超えているため、先頭50件のみ表示しています。
            </Typography>
          )}
          {result.matches.length === 0 ? (
            <Typography variant="body2">該当する生徒データは見つかりませんでした。</Typography>
          ) : (
            <List>
              {result.matches.map((m) => (
                <ListItem key={`${m.lessonRunId}-${m.participantId}`}>
                  <ListItemText
                    primary={m.displayName ?? '(名前なし)'}
                    secondary={
                      <span>
                        授業ID: {m.lessonRunId}
                        {m.externalIdentifier ? ` / 識別子: ${m.externalIdentifier}` : ''}
                        {m.status ? ` / 状態: ${m.status}` : ''}
                      </span>
                    }
                  />
                </ListItem>
              ))}
            </List>
          )}
          <Button variant="outlined" size="small" onClick={onClear} sx={{ alignSelf: 'flex-start' }}>
            閉じる
          </Button>
        </Stack>
      )}
    </section>
  )
}

export function SchoolOrgSettingsPage({
  orgName, orgId, invitations, onInvite, inviting, members, viewerUid, canManageMembers, onSuspendMember, suspending, teacherSeatLimit, parentOrgName, onRevokeInvitation, onChangeRole, onExportStudentData, exportingStudentData, auditLogEntries, loadingAuditLog,
  studentDataRetentionDays = null, settingRetentionPolicy = false, onSetStudentDataRetentionDays,
  purgingOrg = false, onPurgeOrg,
  onSearchStudentData, searchingStudentData = false, studentDataSearchResult, onClearStudentDataSearch,
}: SchoolOrgSettingsPageProps) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'teacher'>('teacher')
  const safeMembers = Array.isArray(members) ? members : []
  const safeInvitations = Array.isArray(invitations) ? invitations : []
  const activeSeatCount = safeMembers.filter((member) => member.status === 'active' && SEAT_ROLES.includes(member.role)).length
  const viewerRole = safeMembers.find((member) => member.uid === viewerUid)?.role
  const isOwner = viewerRole === 'owner'


  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Typography variant="h5">{orgName}</Typography>
      <Link to={`/teacher/organizations/${orgId}/plan-limits`}>利用枠を確認</Link>
      <Link to={`/teacher/organizations/${orgId}/usage-dashboard`}>利用状況ダッシュボードを見る</Link>
      {(viewerRole === 'owner' || viewerRole === 'admin') && <Link to={`/teacher/organizations/${orgId}/template-approvals`}>承認待ちテンプレートを確認</Link>}
      {viewerRole === 'owner' && <Button variant="outlined" disabled={exportingStudentData} onClick={onExportStudentData}>生徒データを一括エクスポート</Button>}
      {(viewerRole === 'owner' || viewerRole === 'admin') && (
        <StudentDataSearchSection
          onSearch={onSearchStudentData}
          searching={searchingStudentData}
          result={studentDataSearchResult}
          onClear={onClearStudentDataSearch}
        />
      )}
      {isOwner && (
        <section>
          <h3>生徒データの保持期間</h3>
          <p>現在の設定: {studentDataRetentionDays !== null ? `${studentDataRetentionDays}日` : '未設定'}</p>
          <form onSubmit={(event) => {
            event.preventDefault()
            const input = new FormData(event.currentTarget).get('retentionDays')
            const days = Number(input)
            if (Number.isInteger(days) && days >= 30 && days <= 3650 && onSetStudentDataRetentionDays) onSetStudentDataRetentionDays(days)
          }}>
            <label>
              保持日数(30〜3650)
              <input name="retentionDays" type="number" min={30} max={3650} defaultValue={studentDataRetentionDays ?? 365} disabled={settingRetentionPolicy} />
            </label>
            <button type="submit" disabled={settingRetentionPolicy}>{settingRetentionPolicy ? '保存中…' : '保存'}</button>
          </form>
        </section>
      )}
      {isOwner && (
        <section>
          <h3>組織の完全削除</h3>
          <p>この操作は取り消せません。組織のすべてのデータ(授業・教材・メンバー)が完全に削除されます。</p>
          <ConfirmDeleteOrgForm orgId={orgId} purging={purgingOrg} onConfirm={onPurgeOrg} />
        </section>
      )}
      {(viewerRole === 'owner' || viewerRole === 'admin') && (
        <section>
          <h3>監査ログ</h3>
          {loadingAuditLog ? (
            <p>読み込み中…</p>
          ) : (
            <ul>
              {(auditLogEntries ?? []).map((entry) => (
                <li key={entry.id}>
                  {entry.occurredAt ?? '(日時不明)'} — {entry.actorUid} — {entry.action} — {entry.result === 'SUCCESS' ? '成功' : '失敗'}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <Typography variant="body2">所属する上位組織: {parentOrgName ?? 'なし'}</Typography>
      <Stack spacing={2}>
        <Typography variant="subtitle1">教師を招待</Typography>
        <TextField label="招待するメールアドレス" value={email} onChange={(event) => setEmail(event.target.value)} />
        <TextField
          select
          label="役割"
          value={role}
          onChange={(event) => setRole(event.target.value as 'admin' | 'teacher')}
          sx={{ maxWidth: 200 }}
        >
          <MenuItem value="teacher">教師</MenuItem>
          <MenuItem value="admin">管理者</MenuItem>
        </TextField>
        <Button
          variant="contained"
          disabled={inviting || !email}
          onClick={() => onInvite(email, role)}
          sx={{ alignSelf: 'flex-start' }}
        >
          招待を送る
        </Button>
      </Stack>
      <Stack spacing={1}>
        <Typography variant="subtitle1">招待一覧</Typography>
        {safeInvitations.length === 0 ? (
          <Typography variant="body2" color="text.secondary">まだ招待がありません。</Typography>
        ) : (
          <List>
            {safeInvitations.map((invitation) => (
              <ListItem
                key={invitation.id}
                secondaryAction={canManageMembers && invitation.status === 'PENDING' ? (
                  <Button size="small" onClick={() => onRevokeInvitation(invitation.id)}>失効</Button>
                ) : undefined}
              >
                <ListItemText primary={invitation.email} secondary={STATUS_LABEL[invitation.status]} />
              </ListItem>
            ))}
          </List>
        )}
      </Stack>
      <Stack spacing={1}>
        <Typography variant="subtitle1">
          教師席: 使用中 {activeSeatCount} / 上限 {teacherSeatLimit ?? '?'}
        </Typography>
        <List>
          {safeMembers.map((member) => (
            <ListItem
              key={member.uid}
              secondaryAction={canManageMembers && member.uid !== viewerUid && member.status === 'active' ? (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <TextField
                    select
                    slotProps={{ select: { native: true } }}
                    size="small"
                    label={`${member.uid}のロール`}
                    value={member.role}
                    onChange={(event) => onChangeRole(member.uid, event.target.value as 'owner' | 'admin' | 'teacher')}
                    sx={{ minWidth: 120 }}
                  >
                    {(viewerRole === 'owner' ? (['owner', 'admin', 'teacher'] as const) : (['admin', 'teacher'] as const))
                      .filter((_roleOption) => viewerRole === 'owner' || member.role !== 'owner')
                      .map((roleOption) => <option key={roleOption} value={roleOption}>{roleOption}</option>)}
                  </TextField>
                  <Button size="small" disabled={suspending} onClick={() => onSuspendMember(member.uid)}>解除</Button>
                </Stack>
              ) : undefined}
            >
              <ListItemText
                primary={member.email ?? member.uid}
                secondary={`${ROLE_LABEL[member.role]} / ${member.status === 'active' ? '有効' : '解除済み'}`}
              />
            </ListItem>
          ))}
        </List>
      </Stack>

    </Stack>
  )
}
