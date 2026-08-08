import { Stack, TextField, Typography } from '@mui/material'
import type { ShortTextConfig } from '@stock-league/lesson-inputs'
import { LessonInputMessages } from './shared'
import { MIN_TOUCH_TARGET, messageIds } from './lessonInputA11y'

export interface ShortTextInputProps {
  id: string
  label: string
  config: ShortTextConfig
  value: string | undefined
  errors: string[]
  disabledReason?: string
  onChange: (value: string) => void
}

/** 短い自由記述。文字数上限を明示し、残り文字数を併記する。 */
export function ShortTextInput({ id, label, config, value, errors, disabledReason, onChange }: ShortTextInputProps) {
  const describedBy = messageIds(id, errors, disabledReason)
  const disabled = Boolean(disabledReason)
  const text = value ?? ''
  return (
    <Stack spacing={0.75}>
      <Typography component="label" htmlFor={id} variant="body2" sx={{ fontWeight: 700 }}>{label}</Typography>
      <TextField
        id={id}
        multiline
        minRows={2}
        value={text}
        onChange={(e) => {
          if (disabled) return
          onChange(e.target.value)
        }}
        error={errors.length > 0}
        slotProps={{
          htmlInput: {
            maxLength: config.maxLength,
            'aria-describedby': describedBy,
            'aria-disabled': disabled || undefined,
          },
        }}
        sx={{ '& .MuiOutlinedInput-root': { minHeight: MIN_TOUCH_TARGET, ...(disabled && { opacity: 0.6 }) } }}
      />
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>{text.length} / {config.maxLength}</Typography>
      <LessonInputMessages id={id} errors={errors} disabledReason={disabledReason} />
    </Stack>
  )
}
