import { Alert, Button, Stack } from '@mui/material'
import type { Invitation } from '../../../lib/organizations/invitations'

export interface PendingInvitationsBannerProps {
  invitations: Invitation[]
  onAccept: (invitation: Invitation) => void
  accepting: boolean
}

export function PendingInvitationsBanner({
  invitations,
  onAccept,
  accepting,
}: PendingInvitationsBannerProps) {
  if (invitations.length === 0) return null

  return (
    <Stack spacing={1}>
      {invitations.map((invitation) => (
        <Alert
          key={invitation.id}
          severity="info"
          action={(
            <Button
              color="inherit"
              size="small"
              disabled={accepting}
              onClick={() => onAccept(invitation)}
            >
              参加する
            </Button>
          )}
        >
          組織から招待されています。
        </Alert>
      ))}
    </Stack>
  )
}
