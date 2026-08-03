import { useState } from 'react'
import { Box, Button, Collapse, Typography } from '@mui/material'

export interface RecoveryCodeDisclosureProps { code: string }

export function RecoveryCodeDisclosure({ code }: RecoveryCodeDisclosureProps) {
  const [open, setOpen] = useState(false)
  return (
    <Box>
      <Button size="small" variant="text" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {open ? '閉じる' : '別の端末で続きから参加したいときは'}
      </Button>
      <Collapse in={open} unmountOnExit>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          参加画面でこの復帰コードを入力すると、別の端末から同じチームで続きから参加できます。
        </Typography>
        <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: '.12em', mt: 0.5 }}>{code || '—'}</Typography>
      </Collapse>
    </Box>
  )
}
