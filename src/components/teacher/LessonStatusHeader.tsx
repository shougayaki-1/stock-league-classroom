import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import { Box, Button, List, ListItem, Stack, Typography } from '@mui/material'
import { MIN_TOUCH_TARGET } from '../lessonInputs/lessonInputA11y'

export interface LessonStatusHeaderAction {
  label: string
  /**
   * Present only when the action IS authorized for this role but is
   * temporarily blocked by lesson state (e.g. "全チームの提出が完了していません").
   * This is the same disabledReason pattern as Task 6's lesson inputs
   * (aria-disabled + adjacent text, never a hidden control) — see
   * lessonInputs/shared.tsx's LessonInputMessages. It is deliberately NOT
   * used for "this role has no authority at all"; that case is represented
   * by the caller passing `nextAction={null}` + `noActionReason` instead,
   * so the button never renders in the first place (authorization-driven
   * omission, distinct from a temporary block — see LessonControlRoom.tsx's
   * top-of-file comment for the same distinction applied to the rest of the
   * screen).
   */
  disabledReason?: string
  onActivate: () => void
}

export interface LessonStatusHeaderProps {
  /** 現在のフェーズ */
  phaseLabel: string
  /**
   * 次にすること — the single most-recommended next action, or null when
   * this teacher's role has no authority to act from this screen at all
   * (see `noActionReason`).
   */
  nextAction: LessonStatusHeaderAction | null
  /** Shown instead of a button when `nextAction` is null for authorization reasons (not shown at all if nextAction is null for some other reason without text supplied). */
  noActionReason?: string
  /** 参加・接続・提出状況 */
  participationSummary: string
  /** 未対応の問題。空配列なら「対応が必要な問題はありません」を表示する。 */
  openIssues: string[]
  /** 教室表示で現在見えている内容 */
  displayPreview: string
}

/**
 * The top-of-viewport status header for the teacher lesson-control screen.
 * Deliberately surfaces exactly ONE call-to-action button (never several
 * competing primary actions) plus 4 read-only summaries, all visible without
 * scrolling — this is Task 11 Step 1's "最上部5項目" requirement.
 */
export function LessonStatusHeader({
  phaseLabel,
  nextAction,
  noActionReason,
  participationSummary,
  openIssues,
  displayPreview,
}: LessonStatusHeaderProps) {
  const disabled = Boolean(nextAction?.disabledReason)
  const describedBy = nextAction?.disabledReason ? 'lesson-status-header-cta-reason' : undefined

  return (
    <Stack component="section" spacing={2} sx={{ width: '100%' }}>
      <Box component="section" aria-labelledby="lesson-status-header-next-action">
        <Typography id="lesson-status-header-next-action" component="h2" variant="subtitle1" sx={{ fontWeight: 700 }}>
          次にすること
        </Typography>
        {nextAction ? (
          <>
            <Button
              variant="contained"
              onClick={() => {
                if (disabled) return
                nextAction.onActivate()
              }}
              aria-disabled={disabled || undefined}
              aria-describedby={describedBy}
              sx={{ minHeight: MIN_TOUCH_TARGET, ...(disabled && { opacity: 0.6 }) }}
            >
              {nextAction.label}
            </Button>
            {nextAction.disabledReason && (
              <Typography id="lesson-status-header-cta-reason" variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
                {nextAction.disabledReason}のため、今は実行できません。
              </Typography>
            )}
          </>
        ) : (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {noActionReason ?? '現在、実行可能な操作はありません'}
          </Typography>
        )}
      </Box>

      <Box component="section" aria-labelledby="lesson-status-header-phase">
        <Typography id="lesson-status-header-phase" component="h2" variant="subtitle1" sx={{ fontWeight: 700 }}>
          現在のフェーズ
        </Typography>
        <Typography variant="body1">{phaseLabel}</Typography>
      </Box>

      <Box component="section" aria-labelledby="lesson-status-header-participation">
        <Typography id="lesson-status-header-participation" component="h2" variant="subtitle1" sx={{ fontWeight: 700 }}>
          参加・接続・提出状況
        </Typography>
        <Typography variant="body1">{participationSummary}</Typography>
      </Box>

      <Box component="section" aria-labelledby="lesson-status-header-issues">
        <Typography id="lesson-status-header-issues" component="h2" variant="subtitle1" sx={{ fontWeight: 700 }}>
          未対応の問題
        </Typography>
        {openIssues.length === 0 ? (
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <CheckCircleIcon fontSize="small" color="success" aria-hidden="true" />
            <Typography variant="body1">対応が必要な問題はありません</Typography>
          </Stack>
        ) : (
          <List aria-label="未対応の問題" dense sx={{ py: 0 }}>
            {openIssues.map((issue, index) => (
              // eslint-disable-next-line react/no-array-index-key -- issue strings are not guaranteed unique
              <ListItem key={index} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0 }}>
                <WarningAmberIcon fontSize="small" color="warning" aria-hidden="true" />
                <Typography variant="body1">{issue}</Typography>
              </ListItem>
            ))}
          </List>
        )}
      </Box>

      <Box component="section" aria-labelledby="lesson-status-header-display">
        <Typography id="lesson-status-header-display" component="h2" variant="subtitle1" sx={{ fontWeight: 700 }}>
          教室表示で現在見えている内容
        </Typography>
        <Typography variant="body1">{displayPreview}</Typography>
      </Box>
    </Stack>
  )
}
