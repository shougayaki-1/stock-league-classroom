import { FormControl, FormControlLabel, FormLabel, Radio, RadioGroup } from '@mui/material'
import type { SingleChoiceConfig } from '@stock-league/lesson-inputs'
import { LessonInputMessages } from './shared'
import { MIN_TOUCH_TARGET, messageIds } from './lessonInputA11y'

export interface SingleChoiceInputProps {
  id: string
  label: string
  config: SingleChoiceConfig
  value: string | undefined
  errors: string[]
  disabledReason?: string
  onChange: (value: string) => void
}

/** 単一選択。選択状態はラジオボタンの形(塗りつぶし有無)で示すため色だけに依存しない。 */
export function SingleChoiceInput({ id, label, config, value, errors, disabledReason, onChange }: SingleChoiceInputProps) {
  const describedBy = messageIds(id, errors, disabledReason)
  const disabled = Boolean(disabledReason)
  return (
    <FormControl component="fieldset" error={errors.length > 0} sx={{ width: '100%' }}>
      <FormLabel component="legend" sx={{ fontWeight: 700, ...(disabled && { color: 'text.disabled' }) }}>{label}</FormLabel>
      <RadioGroup
        value={value ?? ''}
        onChange={(e) => {
          if (disabled) return
          onChange(e.target.value)
        }}
      >
        {config.options.map((option) => (
          <FormControlLabel
            key={option}
            value={option}
            control={
              <Radio
                sx={{ p: 1.25, ...(disabled && { opacity: 0.6 }) }}
                slotProps={{ input: { 'aria-describedby': describedBy, 'aria-disabled': disabled || undefined } }}
              />
            }
            label={option}
            sx={{ minHeight: MIN_TOUCH_TARGET }}
          />
        ))}
      </RadioGroup>
      <LessonInputMessages id={id} errors={errors} disabledReason={disabledReason} />
    </FormControl>
  )
}
