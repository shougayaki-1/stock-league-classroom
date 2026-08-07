import { Typography } from '@mui/material'

/**
 * エラーは role="alert" で即時読み上げる(§23.3 重要度の高い即時フィードバック)。
 * disabledReason はボタン等を隠さず、隣接テキストとして操作不能理由を示す(§23.4)。
 */
export function LessonInputMessages({ id, errors, disabledReason }: { id: string; errors: string[]; disabledReason?: string }) {
  return (
    <>
      {errors.length > 0 && (
        <Typography id={`${id}-error`} role="alert" variant="caption" sx={{ display: 'block', mt: 0.5, color: 'error.main', fontWeight: 700 }}>
          {errors[0]}
        </Typography>
      )}
      {disabledReason && (
        <Typography id={`${id}-disabled-reason`} variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
          {disabledReason}のため操作できません。
        </Typography>
      )}
    </>
  )
}
