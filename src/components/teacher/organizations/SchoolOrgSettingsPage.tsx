import { useState } from 'react'
import { Button, List, ListItem, ListItemText, MenuItem, Stack, TextField, Typography } from '@mui/material'
import type { Invitation } from '../../../lib/organizations/invitations'

const STATUS_LABEL: Record<Invitation['status'], string> = {
  PENDING: '招待中',
  ACCEPTED: '参加済み',
}

export interface SchoolOrgSettingsPageProps {
  orgName: string
  invitations: Invitation[]
  onInvite: (email: string, role: 'admin' | 'teacher') => void
  inviting: boolean
}

export function SchoolOrgSettingsPage({ orgName, invitations, onInvite, inviting }: SchoolOrgSettingsPageProps) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'teacher'>('teacher')

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Typography variant="h5">{orgName}</Typography>
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
    </Stack>
  )
}
