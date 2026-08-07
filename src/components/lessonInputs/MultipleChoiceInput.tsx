import { Checkbox, FormControl, FormControlLabel, FormGroup, FormLabel } from '@mui/material'
import type { MultipleChoiceConfig } from '@stock-league/lesson-inputs'
import { LessonInputMessages } from './shared'
import { MIN_TOUCH_TARGET, messageIds } from './lessonInputA11y'

export interface MultipleChoiceInputProps {
  id: string
  label: string
  config: MultipleChoiceConfig
  value: string[] | undefined
  errors: string[]
  disabledReason?: string
  onChange: (value: string[]) => void
}

/** 複数選択。選択状態はチェックマークの有無で示すため色だけに依存しない。 */
export function MultipleChoiceInput({ id, label, config, value, errors, disabledReason, onChange }: MultipleChoiceInputProps) {
  const selected = value ?? []
  const describedBy = messageIds(id, errors, disabledReason)
  const disabled = Boolean(disabledReason)
  const toggle = (option: string, checked: boolean) => {
    if (disabled) return
    onChange(checked ? [...selected, option] : selected.filter((v) => v !== option))
  }
  return (
    <FormControl component="fieldset" error={errors.length > 0} sx={{ width: '100%' }}>
      <FormLabel component="legend" sx={{ fontWeight: 700, ...(disabled && { color: 'text.disabled' }) }}>{label}</FormLabel>
      <FormGroup>
        {config.options.map((option) => (
          <FormControlLabel
            key={option}
            control={
              <Checkbox
                checked={selected.includes(option)}
                onChange={(e) => toggle(option, e.target.checked)}
                sx={{ p: 1.25, ...(disabled && { opacity: 0.6 }) }}
                slotProps={{ input: { 'aria-describedby': describedBy, 'aria-disabled': disabled || undefined } }}
              />
            }
            label={option}
            sx={{ minHeight: MIN_TOUCH_TARGET }}
          />
        ))}
      </FormGroup>
      <LessonInputMessages id={id} errors={errors} disabledReason={disabledReason} />
    </FormControl>
  )
}
