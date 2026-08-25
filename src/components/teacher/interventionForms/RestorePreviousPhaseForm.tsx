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
 * フェーズ名の一覧から選ぶだけ。候補は `phases`（テンプレートの宣言順、
 * `phases[0]` が最初のフェーズ — `validation.ts`の
 * `lesson.initialPhaseId ?? lesson.phases[0]?.id` と同じ前提）のうち
 * 現在のフェーズより前のものだけに絞る。現在のフェーズ自身と、まだ来て
 * いない後続フェーズは候補に出さない。
 *
 * REFLECTION 到達後は復元できない、というサーバー側の一方通行の制約
 * （functions/src/lessonRuns/interventions.ts の
 * `TERMINAL_OR_POST_RUN_STATUSES` 判定）はここでは再実装しない —
 * Callable 自身がlessonRunの `status` で判定して弾く。このフォームは
 * 「教師が選べるのは実際に過去だったフェーズだけ」という、フェーズの
 * 前後関係についての別の制約だけを担当する。
 */
export function RestorePreviousPhaseForm({ phases, currentPhaseId, onSubmit }: RestorePreviousPhaseFormProps) {
  const currentIndex = currentPhaseId ? phases.findIndex((phase) => phase.id === currentPhaseId) : -1
  const candidates = currentIndex > 0 ? phases.slice(0, currentIndex) : []

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
