import { List, ListItemButton, ListItemText, Stack, Typography } from '@mui/material'
import { MIN_TOUCH_TARGET } from '../../lessonInputs/lessonInputA11y'
import type { InterventionImpactScope } from '../../../lib/lessonRuns/interventions'
import { readPhaseLabel, type PhaseWithDisplayConfig } from '../../../lib/lessonRuns/phaseLabel'

export interface RestorePreviousPhaseFormProps {
  phases: PhaseWithDisplayConfig[]
  currentPhaseId: string | null
  onSubmit: (detail: Record<string, unknown>, impactScope: InterventionImpactScope) => void
}

const UNKNOWN_PHASE_LABEL = 'フェーズ名を確認できません'

/**
 * 前フェーズへ復元する専用フォーム。フェーズIDの手入力は無く、教師は
 * フェーズ名の一覧から選ぶだけ。候補は `phases` の宣言順（配列上の位置）
 * では決めない — フェーズgrpahは分岐しうるため、配列上早いフェーズが
 * 必ずしも現在のフェーズの実際の前段とは限らない。代わりに、実際の
 * graphで現在のフェーズへ直接つながるフェーズ（`nextPhaseIds` に
 * currentPhaseId を含むフェーズ）だけを直前候補として絞る。現在のフェーズ
 * 自身と、無関係な分岐・まだ来ていない後続フェーズは候補に出さない。
 *
 * REFLECTION 到達後は復元できない、というサーバー側の一方通行の制約
 * （functions/src/lessonRuns/interventions.ts の
 * `TERMINAL_OR_POST_RUN_STATUSES` 判定）はここでは再実装しない —
 * Callable 自身がlessonRunの `status` で判定して弾く。このフォームは
 * 「教師が選べるのは実際に過去だったフェーズだけ」という、フェーズの
 * 前後関係についての別の制約だけを担当する。
 */
export function RestorePreviousPhaseForm({ phases, currentPhaseId, onSubmit }: RestorePreviousPhaseFormProps) {
  const candidates = currentPhaseId
    ? phases.filter((phase) => phase.nextPhaseIds?.includes(currentPhaseId))
    : []

  if (candidates.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        戻せる前のフェーズがありません。
      </Typography>
    )
  }

  return (
    <Stack spacing={1}>
      <Typography variant="body2" color="text.secondary">どのフェーズへ戻しますか？</Typography>
      <List>
        {candidates.map((phase) => {
          const label = readPhaseLabel(phase) ?? UNKNOWN_PHASE_LABEL
          return (
            <ListItemButton
              key={phase.id}
              sx={{ minHeight: MIN_TOUCH_TARGET }}
              onClick={() => onSubmit({ targetPhaseId: phase.id }, { level: 'LESSON' })}
            >
              <ListItemText primary={label} />
            </ListItemButton>
          )
        })}
      </List>
    </Stack>
  )
}
