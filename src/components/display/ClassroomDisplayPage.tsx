import { useEffect, useRef, useState } from 'react'
import { Alert, CircularProgress, Stack } from '@mui/material'
import type { Auth, UserCredential } from 'firebase/auth'
import type { Functions } from 'firebase/functions'
import type { Database } from 'firebase/database'
import { StartSlide } from './StartSlide'
import { LiveSlide } from './LiveSlide'
import { EndSlide } from './EndSlide'
import { ExplanationSlide } from './ExplanationSlide'
import { signInForClassroomDisplay, type ExchangeDisplaySessionTokenInput } from '../../lib/lessonRuns/displaySession'
import { subscribeDisplayRun } from '../../lib/lessonRuns/liveRepository'
import type { LessonRunDisplayState } from '../../lib/lessonRuns/liveTypes'

type ConnectionStatus = 'CONNECTING' | 'CONNECTED' | 'ERROR'

export interface ClassroomDisplayPageProps {
  auth: Auth
  functions: Functions
  database: Database
  lessonRunId: string
  /**
   * 表示セッションの平文token(表示URLのクエリパラメータ等、呼び出し側が
   * 教師の認証状態を経由せず抽出して渡すことを想定 — この画面自体は教師の
   * セッション/state を props で一切受け取らない設計、ブリーフStep3)。
   */
  token: string
  /** 参加用URL/参加コード。教師のセッション状態ではなく、公開情報(生徒に配布される前提)として渡されることを想定。省略時はStartSlideがQRを描画しない。 */
  joinUrl?: string
  joinCode?: string
  /** テスト用に差し替え可能。既定は本物のtoken交換+サインイン。 */
  signIn?: (auth: Auth, functions: Functions, input: ExchangeDisplaySessionTokenInput) => Promise<UserCredential>
  /** テスト用に差し替え可能。既定は本物のRTDB購読。 */
  subscribe?: typeof subscribeDisplayRun
}

const CONNECTION_ERROR_MESSAGE = 'この教室表示を表示できません。URLの有効期限が切れているか、既に使用されている可能性があります。先生に新しい表示用URLの発行を依頼してください。'

/**
 * 専用教室表示ページ(Task13)。教師の認証状態やFirestore上のフルstateを
 * props として直接受け取らず、表示URLの token だけを起点に
 * (1) `exchangeDisplaySessionTokenCallable` でFirebase custom tokenに交換
 * → (2) `signInWithCustomToken` でサインイン → (3) `lessonRunDisplay/
 * {lessonRunId}`(RTDB)だけを購読、という経路のみでデータを取得する。
 *
 * `LessonRunDisplayState`から取り出すのは mode/title/goal/teams/
 * teacherGuidance のみで、各Slideコンポーネントへは明示的な分割代入で
 * 渡す(スプレッドしない) — サーバー側 `toLessonRunDisplayState`
 * (displayProjection.ts)と同じallow-list方式をUI層でも徹底し、万が一
 * RTDBノードに想定外のフィールドが混入していても画面に出さない
 * (禁止情報regressionテスト参照)。
 */
export function ClassroomDisplayPage({
  auth, functions, database, lessonRunId, token, joinUrl, joinCode,
  signIn = signInForClassroomDisplay,
  subscribe = subscribeDisplayRun,
}: ClassroomDisplayPageProps) {
  const [status, setStatus] = useState<ConnectionStatus>('CONNECTING')
  const [state, setState] = useState<LessonRunDisplayState | null>(null)
  // 直前のLIVE/ENDモードを保持する(ExplanationSlideへ渡す) — サーバーの
  // deriveDisplayMode(displayProjection.ts)はstatusからmodeへの純粋関数な
  // ため、EXPLANATION自体にはどちらから遷移したかの情報が残らない。
  const lastNonExplanationModeRef = useRef<'LIVE' | 'END' | null>(null)

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined

    signIn(auth, functions, { lessonRunId, token })
      .then(() => {
        if (cancelled) return
        unsubscribe = subscribe(
          database,
          lessonRunId,
          (nextState) => {
            if (cancelled) return
            setState(nextState)
            setStatus('CONNECTED')
          },
          () => {
            if (cancelled) return
            setStatus('ERROR')
          },
        )
      })
      .catch(() => {
        if (cancelled) return
        setStatus('ERROR')
      })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonRunId, token])

  if (status === 'ERROR') {
    return (
      <Stack sx={{ width: '100%', height: '100%', p: 4, alignItems: 'center', justifyContent: 'center' }}>
        <Alert severity="error">{CONNECTION_ERROR_MESSAGE}</Alert>
      </Stack>
    )
  }

  if (status === 'CONNECTING' || !state) {
    return (
      <Stack sx={{ width: '100%', height: '100%', p: 4, alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Stack>
    )
  }

  const { mode, title, goal, teams, teacherGuidance } = state
  if (mode === 'LIVE' || mode === 'END') lastNonExplanationModeRef.current = mode

  switch (mode) {
    case 'START':
      return <StartSlide title={title} goal={goal} joinUrl={joinUrl} joinCode={joinCode} />
    case 'LIVE':
      return <LiveSlide title={title} teams={teams} teacherGuidance={teacherGuidance} />
    case 'END':
      return <EndSlide title={title} teams={teams} teacherGuidance={teacherGuidance} />
    case 'EXPLANATION':
      return <ExplanationSlide title={title} teams={teams} teacherGuidance={teacherGuidance} previousMode={lastNonExplanationModeRef.current} />
    default:
      return <StartSlide title={title} goal={goal} joinUrl={joinUrl} joinCode={joinCode} />
  }
}
