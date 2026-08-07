import { Stack, TextField, Typography } from '@mui/material'
import type { QuantityConfig } from '@stock-league/lesson-inputs'
import { LessonInputMessages } from './shared'
import { MIN_TOUCH_TARGET, messageIds } from './lessonInputA11y'

export interface QuantityInputProps {
  id: string
  label: string
  config: QuantityConfig
  value: number | undefined
  errors: string[]
  disabledReason?: string
  onChange: (value: number) => void
}

/** 株数・個数入力(0以上の整数)。 */
export function QuantityInput({ id, label, config, value, errors, disabledReason, onChange }: QuantityInputProps) {
  const describedBy = messageIds(id, errors, disabledReason)
  return (
    <Stack spacing={0.75}>
      <Typography component="label" htmlFor={id} variant="body2" sx={{ fontWeight: 700 }}>{label}</Typography>
      <TextField
        id={id}
        type="number"
        value={value === undefined || Number.isNaN(value) ? '' : value}
        onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
        disabled={Boolean(disabledReason)}
        error={errors.length > 0}
        fullWidth
        slotProps={{ htmlInput: { min: config.min ?? 0, max: config.max, step: 1, inputMode: 'numeric', 'aria-describedby': describedBy } }}
        sx={{ '& .MuiOutlinedInput-root': { minHeight: MIN_TOUCH_TARGET } }}
      />
      <LessonInputMessages id={id} errors={errors} disabledReason={disabledReason} />
    </Stack>
  )
}
