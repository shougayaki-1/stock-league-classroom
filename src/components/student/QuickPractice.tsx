import { useEffect, useRef, useState } from 'react'
import { Button, Chip, Stack, Typography } from '@mui/material'
import { MIN_TOUCH_TARGET } from '../lessonInputs/lessonInputA11y'

const PRACTICE_DURATION_SECONDS = 30
const PRACTICE_OPTIONS = ['A', 'B'] as const

export interface QuickPracticeProps {
  /** カウントダウン秒数。既定30秒(ブリーフの「30秒操作練習」)。 */
  durationSeconds?: number
  /** カウントダウンが0になった時に一度だけ呼ばれる。 */
  onFinished?: () => void
}

/**
 * 待機画面(`WAITING`)専用の操作練習コンポーネント(§Task12 ブリーフ Step2)。
 *
 * 【設計上の重要な境界】このコンポーネントは選択肢の状態を純粋にローカル
 * state(`useState`)だけで完結させ、`saveResponseDraft`/`submitProposal`
 * など本番の回答保存Callable(Task7, ../../lib/lessonRuns/responses.ts)を
 * 一切importしない。ここでの操作は「操作に慣れるための練習」であり、本番の
 * `LessonResponse`ドキュメントとは完全に無関係 — ブリーフの「WAITING以外では
 * 練習回答を本番回答へ保存しない」という要求を、そもそも保存経路を持たない
 * ことで満たす(誤って呼んでしまう余地自体を設計上なくす)。
 */
export function QuickPractice({ durationSeconds = PRACTICE_DURATION_SECONDS, onFinished }: QuickPracticeProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [remainingSeconds, setRemainingSeconds] = useState(durationSeconds)
  const [finished, setFinished] = useState(false)
  const onFinishedRef = useRef(onFinished)
  onFinishedRef.current = onFinished

  useEffect(() => {
    if (finished) return
    const timer = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          setFinished(true)
          onFinishedRef.current?.()
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
    // durationSeconds is only read once at mount — the countdown always
    // starts from the initial value, matching a one-shot 30-second practice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished])

  return (
    <Stack spacing={1} sx={{ width: '100%' }} aria-label="操作練習">
      <Chip
        label="練習用(この回答は保存されません)"
        color="info"
        variant="outlined"
        sx={{ alignSelf: 'flex-start', fontWeight: 700 }}
      />
      <Typography variant="body2">
        本番が始まる前に、ボタンを押す練習をしてみましょう。
      </Typography>
      <Stack direction="row" spacing={1}>
        {PRACTICE_OPTIONS.map((option) => (
          <Button
            key={option}
            variant={selected === option ? 'contained' : 'outlined'}
            aria-pressed={selected === option}
            onClick={() => setSelected(option)}
            sx={{ minHeight: MIN_TOUCH_TARGET, minWidth: MIN_TOUCH_TARGET }}
          >
            {option}
          </Button>
        ))}
      </Stack>
      {selected && <Typography variant="body2">選択しました: {selected}</Typography>}
      {!finished && <Typography variant="caption">残り {remainingSeconds} 秒</Typography>}
      <Typography role="status" aria-live="polite" variant="caption" sx={{ color: 'text.secondary' }}>
        {finished ? '練習が終了しました。本番はこの後始まります。' : ''}
      </Typography>
    </Stack>
  )
}
