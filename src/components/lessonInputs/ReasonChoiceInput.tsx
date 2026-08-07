import { FormControl, FormControlLabel, FormLabel, Radio, RadioGroup, Stack, TextField, Typography } from '@mui/material'
import type { ReasonChoiceConfig, ReasonChoiceValue } from '@stock-league/lesson-inputs'
import { LessonInputMessages } from './shared'
import { MIN_TOUCH_TARGET, messageIds } from './lessonInputA11y'

const DEFAULT_REASON_MAX_LENGTH = 200

export interface ReasonChoiceInputProps {
  id: string
  label: string
  config: ReasonChoiceConfig
  value: ReasonChoiceValue | undefined
  errors: string[]
  disabledReason?: string
  onChange: (value: ReasonChoiceValue) => void
}

/** 理由選択。選択肢から1つ選び、理由を自由記述する。 */
export function ReasonChoiceInput({ id, label, config, value, errors, disabledReason, onChange }: ReasonChoiceInputProps) {
  const choice = value?.choice ?? ''
  const reason = value?.reason ?? ''
  const disabled = Boolean(disabledReason)
  const describedBy = messageIds(id, errors, disabledReason)
  const reasonId = `${id}-reason`
  const maxLength = config.reasonMaxLength ?? DEFAULT_REASON_MAX_LENGTH
  return (
    <FormControl component="fieldset" disabled={disabled} error={errors.length > 0} sx={{ width: '100%' }}>
      <FormLabel component="legend" sx={{ fontWeight: 700 }}>{label}</FormLabel>
      <RadioGroup value={choice} onChange={(e) => onChange({ choice: e.target.value, reason })}>
        {config.options.map((option) => (
          <FormControlLabel
            key={option}
            value={option}
            control={<Radio sx={{ p: 1.25 }} />}
            label={option}
            sx={{ minHeight: MIN_TOUCH_TARGET }}
          />
        ))}
      </RadioGroup>
      <Stack spacing={0.75} sx={{ mt: 1.5 }}>
        <Typography component="label" htmlFor={reasonId} variant="body2" sx={{ fontWeight: 700 }}>理由</Typography>
        <TextField
          id={reasonId}
          multiline
          minRows={2}
          value={reason}
          onChange={(e) => onChange({ choice, reason: e.target.value })}
          disabled={disabled}
          slotProps={{ htmlInput: { maxLength, 'aria-describedby': describedBy } }}
        />
      </Stack>
      <LessonInputMessages id={id} errors={errors} disabledReason={disabledReason} />
    </FormControl>
  )
}
