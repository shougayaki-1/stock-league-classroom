import { FormControl, FormLabel, Stack, TextField, Typography } from '@mui/material'
import type { AllocationConfig } from '@stock-league/lesson-inputs'
import { LessonInputMessages } from './shared'
import { MIN_TOUCH_TARGET, messageIds } from './lessonInputA11y'

export interface AllocationInputProps {
  id: string
  label: string
  config: AllocationConfig
  value: Record<string, number> | undefined
  errors: string[]
  disabledReason?: string
  onChange: (value: Record<string, number>) => void
}

/** 金額配分。項目ごとに数値入力し、合計と目標値を並べて表示する。 */
export function AllocationInput({ id, label, config, value, errors, disabledReason, onChange }: AllocationInputProps) {
  const current = value ?? {}
  const describedBy = messageIds(id, errors, disabledReason)
  const disabled = Boolean(disabledReason)
  const sum = config.items.reduce((total, item) => total + (current[item] ?? 0), 0)
  const isBalanced = sum === config.total
  const handleItemChange = (item: string, amount: number) => {
    if (disabled) return
    onChange({ ...current, [item]: amount })
  }
  return (
    <FormControl component="fieldset" error={errors.length > 0} sx={{ width: '100%' }}>
      <FormLabel component="legend" sx={{ fontWeight: 700, ...(disabled && { color: 'text.disabled' }) }}>{label}</FormLabel>
      <Stack spacing={1.5} sx={{ mt: 1 }}>
        {config.items.map((item) => {
          const itemId = `${id}-${item}`
          return (
            <Stack key={item} direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Typography component="label" htmlFor={itemId} sx={{ minWidth: 88 }}>{item}</Typography>
              <TextField
                id={itemId}
                type="number"
                value={current[item] ?? ''}
                onChange={(e) => handleItemChange(item, e.target.value === '' ? 0 : Number(e.target.value))}
                fullWidth
                slotProps={{
                  htmlInput: {
                    min: 0,
                    inputMode: 'numeric',
                    'aria-describedby': describedBy,
                    'aria-disabled': disabled || undefined,
                  },
                }}
                sx={{ '& .MuiOutlinedInput-root': { minHeight: MIN_TOUCH_TARGET, ...(disabled && { opacity: 0.6 }) } }}
              />
            </Stack>
          )
        })}
      </Stack>
      <Typography variant="caption" sx={{ mt: 1, fontWeight: isBalanced ? 700 : 400 }}>
        合計 {sum} / {config.total}{isBalanced ? '（一致）' : ''}
      </Typography>
      <LessonInputMessages id={id} errors={errors} disabledReason={disabledReason} />
    </FormControl>
  )
}
