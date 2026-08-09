import { useState } from 'react'
import { Link } from 'react-router'
import { Button, List, ListItem, ListItemText, MenuItem, Stack, TextField, Typography } from '@mui/material'
import type { Invitation } from '../../../lib/organizations/invitations'
import type { OrgMember } from '../../../lib/organizations/orgMembers'

const STATUS_LABEL: Record<Invitation['status'], string> = {
  PENDING: '招待中',
  ACCEPTED: '参加済み',
}
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
}

export function SchoolOrgSettingsPage({
  orgName, orgId, invitations, onInvite, inviting, members, viewerUid, canManageMembers, onSuspendMember, suspending, teacherSeatLimit,
}: SchoolOrgSettingsPageProps) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'teacher'>('teacher')
  const activeSeatCount = members.filter((member) => member.status === 'active' && SEAT_ROLES.includes(member.role)).length

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Typography variant="h5">{orgName}</Typography>
      <Link to={`/teacher/organizations/${orgId}/plan-limits`}>利用枠を確認</Link>
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
        {invitations.length === 0 ? (
          <Typography variant="body2" color="text.secondary">まだ招待がありません。</Typography>
        ) : (
          <List>
            {invitations.map((invitation) => (
              <ListItem key={invitation.id}>
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
          {members.map((member) => (
            <ListItem
              key={member.uid}
              secondaryAction={canManageMembers && member.uid !== viewerUid && member.status === 'active' ? (
                <Button size="small" disabled={suspending} onClick={() => onSuspendMember(member.uid)}>解除</Button>
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
