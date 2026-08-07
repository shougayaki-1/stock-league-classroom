import { FormControl, FormControlLabel, FormLabel, Radio, RadioGroup } from '@mui/material'
import type { AgreeDisagreeConfig } from '@stock-league/lesson-inputs'
import { LessonInputMessages } from './shared'
import { MIN_TOUCH_TARGET, messageIds } from './lessonInputA11y'

const DEFAULT_OPTIONS = ['賛成', '反対']

export interface AgreeDisagreeInputProps {
  id: string
  label: string
  config: AgreeDisagreeConfig
  value: string | undefined
  errors: string[]
  disabledReason?: string
  onChange: (value: string) => void
}

/** 賛成・反対(または段階的な賛否)。 */
export function AgreeDisagreeInput({ id, label, config, value, errors, disabledReason, onChange }: AgreeDisagreeInputProps) {
  const options = config.options ?? DEFAULT_OPTIONS
  const describedBy = messageIds(id, errors, disabledReason)
  return (
    <FormControl component="fieldset" disabled={Boolean(disabledReason)} error={errors.length > 0} sx={{ width: '100%' }}>
      <FormLabel component="legend" sx={{ fontWeight: 700 }}>{label}</FormLabel>
      <RadioGroup row aria-describedby={describedBy} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <FormControlLabel
            key={option}
            value={option}
            control={<Radio sx={{ p: 1.25 }} />}
            label={option}
            sx={{ minHeight: MIN_TOUCH_TARGET }}
          />
        ))}
      </RadioGroup>
      <LessonInputMessages id={id} errors={errors} disabledReason={disabledReason} />
    </FormControl>
  )
}
