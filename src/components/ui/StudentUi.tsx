import { useId, type ChangeEventHandler, type ReactNode } from 'react'
import { Box, Paper, Stack, TextField, Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import { studentSurfaceSx } from './studentUiStyles'

export function StudentPageSurface({ children }: { children: ReactNode }) {
  return <Box component="main" sx={{ minHeight: '100dvh', bgcolor: 'background.default', color: 'text.primary' }}>{children}</Box>
}

export function StudentSurfaceCard({ children, component = 'section', sx }: { children: ReactNode; component?: 'section' | 'aside'; sx?: SxProps<Theme> }) {
  return <Paper component={component} elevation={0} sx={[studentSurfaceSx, ...(Array.isArray(sx) ? sx : [sx])]}>{children}</Paper>
}

interface StudentFieldProps {
  label: string
  value: string | number
  onChange: ChangeEventHandler<HTMLInputElement>
  placeholder?: string
  helperText?: string
  errorText?: string
  disabled?: boolean
  maxLength?: number
  type?: 'text' | 'number'
  inputMode?: 'text' | 'numeric'
  min?: number
  max?: number
  step?: number
  id?: string
}

/** External labels keep the field stable even when legacy page CSS is present. */
export function StudentField({ label, helperText, errorText, maxLength, inputMode, min, max, step, id, ...props }: StudentFieldProps) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const helpId = `${fieldId}-help`
  return <Stack spacing={0.75}>
    <Typography component="label" htmlFor={fieldId} variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>{label}</Typography>
    <TextField
      {...props}
      id={fieldId}
      hiddenLabel
      fullWidth
      error={Boolean(errorText)}
      slotProps={{ htmlInput: { maxLength, inputMode, min, max, step, 'aria-describedby': helperText || errorText ? helpId : undefined } }}
      sx={{ '& .MuiOutlinedInput-root': { minHeight: 52, borderRadius: 2, bgcolor: 'background.paper' }, '& input': { py: 1.5 } }}
    />
    {(errorText || helperText) && <Typography id={helpId} variant="caption" color={errorText ? 'error.main' : 'text.secondary'} sx={{ lineHeight: 1.55 }}>{errorText || helperText}</Typography>}
  </Stack>
}
