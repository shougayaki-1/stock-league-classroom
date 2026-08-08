import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import { FormControl, FormLabel, IconButton, List, ListItem, Typography } from '@mui/material'
import type { RankingConfig } from '@stock-league/lesson-inputs'
import { LessonInputMessages } from './shared'
import { MIN_TOUCH_TARGET, messageIds } from './lessonInputA11y'

export interface RankingInputProps {
  id: string
  label: string
  config: RankingConfig
  value: string[] | undefined
  errors: string[]
  disabledReason?: string
  onChange: (value: string[]) => void
}

/**
 * 順位付け。ドラッグ&ドロップはキーボード操作が難しいため、
 * 「上へ/下へ」ボタンによる並び替えにして常に有効な順列を保つ。
 */
export function RankingInput({ id, label, config, value, errors, disabledReason, onChange }: RankingInputProps) {
  const order = value && value.length === config.items.length && new Set(value).size === config.items.length ? value : config.items
  const disabled = Boolean(disabledReason)
  const describedBy = messageIds(id, errors, disabledReason)
  const move = (index: number, delta: number) => {
    if (disabled) return
    const target = index + delta
    if (target < 0 || target >= order.length) return
    const next = [...order]
    const temp = next[index]
    next[index] = next[target]
    next[target] = temp
    onChange(next)
  }
  return (
    <FormControl component="fieldset" error={errors.length > 0} sx={{ width: '100%' }}>
      <FormLabel component="legend" sx={{ fontWeight: 700, ...(disabled && { color: 'text.disabled' }) }}>{label}</FormLabel>
      <List sx={{ width: '100%' }}>
        {order.map((item, index) => {
          const atTop = index === 0
          const atBottom = index === order.length - 1
          return (
            <ListItem key={item} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 0 }}>
              <Typography sx={{ minWidth: 28, fontWeight: 700 }}>{index + 1}</Typography>
              <Typography sx={{ flex: 1 }}>{item}</Typography>
              <IconButton
                aria-label={`${item}を上へ移動`}
                aria-describedby={describedBy}
                onClick={() => move(index, -1)}
                // 境界(先頭のため移動不可)はネイティブ disabled のままでよいが、
                // disabledReason による無効化はキーボードユーザーに理由を伝えるため
                // aria-disabled + フォーカス可能のパターンを維持する(no-op は move() 内で処理)。
                disabled={!disabled && atTop}
                aria-disabled={disabled ? true : undefined}
                sx={{ minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET, ...(disabled && { opacity: 0.6 }) }}
              >
                <ArrowUpwardIcon fontSize="small" />
              </IconButton>
              <IconButton
                aria-label={`${item}を下へ移動`}
                aria-describedby={describedBy}
                onClick={() => move(index, 1)}
                disabled={!disabled && atBottom}
                aria-disabled={disabled ? true : undefined}
                sx={{ minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET, ...(disabled && { opacity: 0.6 }) }}
              >
                <ArrowDownwardIcon fontSize="small" />
              </IconButton>
            </ListItem>
          )
        })}
      </List>
      <LessonInputMessages id={id} errors={errors} disabledReason={disabledReason} />
    </FormControl>
  )
}
