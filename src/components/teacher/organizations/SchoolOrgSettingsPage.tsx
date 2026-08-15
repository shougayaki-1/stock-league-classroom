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
import type {
  AnnualArchiveJob,
  AnnualArchiveJobStatus,
  PreviewAnnualArchiveResult,
} from '../../../lib/privacy/annualArchive'

const STATUS_LABEL: Record<Invitation['status'], string> = { PENDING: '招待中', ACCEPTED: '参加済み', REVOKED: '失効済み' }
const ROLE_LABEL: Record<OrgMember['role'], string> = { owner: 'owner', admin: '管理者', teacher: '教師' }
const SEAT_ROLES: OrgMember['role'][] = ['owner', 'admin', 'teacher']

const ARCHIVE_JOB_STATUS_LABEL: Record<AnnualArchiveJobStatus, string> = {
  SCHEDULED: '予約中',
  RUNNING: '処理中',
  CANCELLING: '取消処理中',
  COMPLETED: '完了',
  CANCELLED: '取消済み',
  FAILED: '失敗（再試行中）',
}

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
  annualArchiveJobs?: AnnualArchiveJob[]
  loadingAnnualArchiveJobs?: boolean
  onPreviewAnnualArchive?: (academicYear: number) => void
  previewingAnnualArchive?: boolean
  annualArchivePreview?: PreviewAnnualArchiveResult
  onScheduleAnnualArchive?: (input: { academicYear: number; scheduledFor: string; reason: string }) => void
  schedulingAnnualArchive?: boolean
  onCancelAnnualArchive?: (input: { jobId: string; reason: string }) => void
  cancellingAnnualArchive?: boolean
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

function AnnualArchiveSection({
  jobs = [],
  loadingJobs,
  onPreview,
  previewing,
  preview,
  onSchedule,
  scheduling,
  onCancel,
  cancelling,
}: {
  jobs?: AnnualArchiveJob[]
  loadingJobs?: boolean
  onPreview?: (academicYear: number) => void
  previewing?: boolean
  preview?: PreviewAnnualArchiveResult
  onSchedule?: (input: { academicYear: number; scheduledFor: string; reason: string }) => void
  scheduling?: boolean
  onCancel?: (input: { jobId: string; reason: string }) => void
  cancelling?: boolean
}) {
  const [academicYear, setAcademicYear] = useState<number>(2025)
  const [scheduledFor, setScheduledFor] = useState('')
  const [reason, setReason] = useState('')
  const [cancelJobId, setCancelJobId] = useState<string | null>(null)
  const [cancelReason, setCancelReason] = useState('')

  const handlePreview = (event: React.FormEvent) => {
    event.preventDefault()
    if (onPreview && !Number.isNaN(academicYear)) {
      onPreview(academicYear)
    }
  }

  const handleSchedule = (event: React.FormEvent) => {
    event.preventDefault()
    if (
      onSchedule &&
      preview &&
      scheduledFor &&
      reason.trim().length > 0 &&
      !scheduling
    ) {
      onSchedule({
        academicYear: preview.academicYear,
        scheduledFor,
        reason: reason.trim(),
      })
    }
  }

  const handleCancelSubmit = (jobId: string) => {
    if (onCancel && cancelReason.trim().length > 0 && !cancelling) {
      onCancel({
        jobId,
        reason: cancelReason.trim(),
      })
      setCancelJobId(null)
      setCancelReason('')
    }
  }

  const canSchedule =
    !!preview &&
    scheduledFor.length > 0 &&
    reason.trim().length > 0 &&
    !scheduling

  return (
    <section>
      <Typography variant="h6" component="h3">年度アーカイブ</Typography>
      <Typography variant="body2" color="text.secondary">
        指定した年度に終了した授業（完了・中断）をアーカイブします。
      </Typography>

      <form onSubmit={handlePreview} style={{ marginTop: 8 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <TextField
            label="対象年度"
            type="number"
            value={academicYear}
            onChange={(e) => setAcademicYear(Number(e.target.value))}
            size="small"
            sx={{ width: 120 }}
            disabled={previewing}
          />
          <Button
            type="submit"
            variant="outlined"
            size="small"
            disabled={previewing || Number.isNaN(academicYear)}
          >
            {previewing ? '確認中…' : '対象を確認'}
          </Button>
        </Stack>
      </form>

      {preview && (
        <Stack spacing={1} sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
          <Typography variant="subtitle2">確認結果 ({preview.academicYear}年度)</Typography>
          <Typography variant="body2">
            対象期間: {preview.periodStart} 〜 {preview.periodEnd}
          </Typography>
          <Typography variant="body2">
            アーカイブ対象件数: {preview.eligibleCount}件
          </Typography>
          <Typography variant="body2" color="text.secondary">
            終了日時未記録で除外される件数: {preview.missingEndedAtCount}件
          </Typography>

          <form onSubmit={handleSchedule} style={{ marginTop: 8 }}>
            <Stack spacing={2} sx={{ maxWidth: 500 }}>
              <TextField
                label="実行予定日時"
                type="datetime-local"
                slotProps={{ inputLabel: { shrink: true } }}
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
                size="small"
                disabled={scheduling}
              />
              <TextField
                label="予約理由"
                placeholder="予約理由を入力してください（必須）"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                size="small"
                multiline
                rows={2}
                disabled={scheduling}
              />
              <Button
                type="submit"
                variant="contained"
                disabled={!canSchedule}
                sx={{ alignSelf: 'flex-start' }}
              >
                {scheduling ? '予約中…' : '予約する'}
              </Button>
            </Stack>
          </form>
        </Stack>
      )}

      <Stack spacing={1} sx={{ mt: 3 }}>
        <Typography variant="subtitle1">アーカイブ予約ジョブ一覧</Typography>
        {loadingJobs ? (
          <Typography variant="body2">読み込み中…</Typography>
        ) : jobs.length === 0 ? (
          <Typography variant="body2" color="text.secondary">予約されたジョブはありません。</Typography>
        ) : (
          <List>
            {jobs.map((job) => {
              const canCancel = job.status === 'SCHEDULED' || job.status === 'RUNNING' || job.status === 'FAILED'
              const cancelLabel = job.status === 'RUNNING' ? '取消要求' : '取消'

              return (
                <ListItem
                  key={job.id}
                  sx={{ borderBottom: 1, borderColor: 'divider', flexDirection: 'column', alignItems: 'flex-start' }}
                >
                  <Stack direction="row" spacing={2} sx={{ width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
                    <ListItemText
                      primary={`${job.academicYear}年度アーカイブ — 状態: ${ARCHIVE_JOB_STATUS_LABEL[job.status] ?? job.status}`}
                      secondary={`予定日時: ${job.scheduledFor} / アーカイブ済み: ${job.archivedCount}件 / 復元済み: ${job.restoredCount}件 / 理由: ${job.reason}`}
                    />
                    {canCancel && (
                      <Button
                        size="small"
                        color="error"
                        variant="outlined"
                        disabled={cancelling}
                        onClick={() => setCancelJobId(cancelJobId === job.id ? null : job.id)}
                      >
                        {cancelLabel}
                      </Button>
                    )}
                    {job.status === 'CANCELLING' && (
                      <Typography variant="body2" color="text.secondary">取消処理中</Typography>
                    )}
                  </Stack>

                  {cancelJobId === job.id && (
                    <Stack direction="row" spacing={1} sx={{ mt: 1, width: '100%', alignItems: 'center' }}>
                      <TextField
                        size="small"
                        label="取消理由"
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                        placeholder="取消理由を入力（必須）"
                        sx={{ flexGrow: 1 }}
                      />
                      <Button
                        size="small"
                        variant="contained"
                        color="error"
                        disabled={cancelling || cancelReason.trim().length === 0}
                        onClick={() => handleCancelSubmit(job.id)}
                      >
                        {cancelling ? '処理中…' : '確定'}
                      </Button>
                      <Button size="small" variant="text" onClick={() => setCancelJobId(null)}>
                        閉じる
                      </Button>
                    </Stack>
                  )}
                </ListItem>
              )
            })}
          </List>
        )}
      </Stack>
    </section>
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
  annualArchiveJobs = [], loadingAnnualArchiveJobs = false,
  onPreviewAnnualArchive, previewingAnnualArchive = false,
  annualArchivePreview,
  onScheduleAnnualArchive, schedulingAnnualArchive = false,
  onCancelAnnualArchive, cancellingAnnualArchive = false,
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
        <AnnualArchiveSection
          jobs={annualArchiveJobs}
          loadingJobs={loadingAnnualArchiveJobs}
          onPreview={onPreviewAnnualArchive}
          previewing={previewingAnnualArchive}
          preview={annualArchivePreview}
          onSchedule={onScheduleAnnualArchive}
          scheduling={schedulingAnnualArchive}
          onCancel={onCancelAnnualArchive}
          cancelling={cancellingAnnualArchive}
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
