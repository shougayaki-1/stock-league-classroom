import { Stack, TextField, Typography } from '@mui/material'
import type { NumberConfig } from '@stock-league/lesson-inputs'
import { LessonInputMessages } from './shared'
import { MIN_TOUCH_TARGET, messageIds } from './lessonInputA11y'

export interface NumberInputProps {
  id: string
  label: string
  config: NumberConfig
  value: number | undefined
  errors: string[]
  disabledReason?: string
  onChange: (value: number) => void
}

/** 数値入力。 */
export function NumberInput({ id, label, config, value, errors, disabledReason, onChange }: NumberInputProps) {
  const describedBy = messageIds(id, errors, disabledReason)
  const disabled = Boolean(disabledReason)
  return (
    <Stack spacing={0.75}>
      <Typography component="label" htmlFor={id} variant="body2" sx={{ fontWeight: 700 }}>{label}</Typography>
      <TextField
        id={id}
        type="number"
        value={value === undefined || Number.isNaN(value) ? '' : value}
        onChange={(e) => {
          if (disabled) return
          onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))
        }}
        error={errors.length > 0}
        fullWidth
        slotProps={{
          htmlInput: {
            min: config.min,
            max: config.max,
            inputMode: 'numeric',
            'aria-describedby': describedBy,
            'aria-disabled': disabled || undefined,
          },
        }}
        sx={{ '& .MuiOutlinedInput-root': { minHeight: MIN_TOUCH_TARGET, ...(disabled && { opacity: 0.6 }) } }}
      />
      <LessonInputMessages id={id} errors={errors} disabledReason={disabledReason} />
    </Stack>
  )
}
