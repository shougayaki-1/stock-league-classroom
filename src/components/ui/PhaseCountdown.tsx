import { useEffect, useState } from 'react'
import { Chip } from '@mui/material'

export interface PhaseCountdownProps {
  /** 現在フェーズの終了時刻（エポックミリ秒）。制限時間の無いフェーズでは null。 */
  endsAtMillis: number | null | undefined
  /** テスト用に差し替え可能。既定は `Date.now`。 */
  now?: () => number
}

const formatRemaining = (remainingSeconds: number): string => {
  const minutes = Math.floor(remainingSeconds / 60)
  const seconds = remainingSeconds % 60
  return `残り ${minutes}:${String(seconds).padStart(2, '0')}`
}

/**
 * フェーズの残り時間。サーバは終了時刻だけを渡し、この部品が毎秒描き直す
 * （`LessonRunPublicState.currentPhaseEndsAtMillis` の規約 — publish は状態
 * 遷移のときにしか起きないため、サーバ側で残り秒数を計算して渡すとフェーズ
 * の間ずっと固定されて古くなる）。
 *
 * フェーズは満了しても自動では進まない（`defaultPhases.ts` 参照）ため、
 * 超過状態は異常ではなく正常に起こりうる。負の数を出さず「時間終了」と
 * 表示して、教師が進めるまでそのまま待つ。
 *
 * 端末の時計とサーバの時計のずれの分だけ誤差が出るが、授業運用上その精度で
 * 足りるため補正しない。
 */
export function PhaseCountdown({ endsAtMillis, now = Date.now }: PhaseCountdownProps) {
  // 値は使わない。1秒ごとに再描画を起こすためだけの state。
  const [, forceTick] = useState(0)

  useEffect(() => {
    if (endsAtMillis == null) return
    const timer = setInterval(() => forceTick((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [endsAtMillis])

  if (endsAtMillis == null) return null

  // `now` は描画時にだけ呼ぶ。effect の依存に入れないので、呼び出し側が
  // インラインの関数を渡しても effect が張り直されない。
  const remainingSeconds = Math.floor((endsAtMillis - now()) / 1000)

  return remainingSeconds > 0
    ? <Chip label={formatRemaining(remainingSeconds)} color={remainingSeconds <= 60 ? 'warning' : 'default'} />
    : <Chip label="時間終了" color="error" />
}
