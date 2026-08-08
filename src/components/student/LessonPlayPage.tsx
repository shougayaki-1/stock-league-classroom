import { useState } from 'react'
import { Alert, Button, Chip, Divider, List, ListItem, Stack, Typography } from '@mui/material'
import type { Functions } from 'firebase/functions'
import type { LessonInputField, LessonInputValue } from '@stock-league/lesson-inputs'
import { LessonInputRenderer, type LessonInputRendererProps } from '../lessonInputs/LessonInputRenderer'
import { MIN_TOUCH_TARGET } from '../lessonInputs/lessonInputA11y'
import { useLessonResponseDraft, type UseLessonResponseDraftInput, type UseLessonResponseDraftResult } from '../../hooks/useLessonResponseDraft'
import { requestLessonHelp as requestLessonHelpDefault, type RequestLessonHelpInput, type RequestLessonHelpResult } from '../../lib/lessonRuns/helpRequests'
import type { LessonResponseStatus } from '../../lib/lessonRuns/responses'

/**
 * この画面が要求する「生徒公開情報」の形。`functions/src/lessonRuns/
 * phases/validation.ts`の`LessonPhase.displayConfig`は(Phase Bのバリデータが
 * 「設定されていること」しか見ないため)`unknown`型のままだが、このTaskは
 * その中身を実際に描画する必要があるため、ここでこの画面が期待する具体的な
 * 形を定義する(バリデータ側のJSDocが言う「§7.5の生徒公開情報」の実体)。
 */
export interface LessonPhaseDisplayConfig {
  /** フェーズの見出し。 */
  title?: string
  /** 生徒への課題文・指示文(現在課題)。 */
  taskDescription: string
  /** 公開情報(ニュース・決算等、§23.3の「参考」カテゴリに相当)。 */
  publicInfo?: string[]
}

const RESPONSE_STATUS_LABELS: Record<LessonResponseStatus, string> = {
  DRAFT: '下書き保存済み',
  PROPOSED: '提案中(チームの承認待ち)',
  APPROVED: '承認済み(確定待ち)',
  REJECTED: '却下されました。修正してください。',
  CONFIRMED: '確定しました',
}

const generateIdempotencyKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `key-${Date.now()}-${Math.random()}`

export interface LessonPlayPageProps {
  functions: Functions
  lessonRunId: string
  phaseId: string
  inputId: string
  participantId?: string
  teamId?: string
  /** 自分の表示名(§23.6: 生徒画面は自分の名前のみ表示可)。 */
  displayName: string
  /** 自チーム名。他チームの情報を渡す経路はこのpropsに存在しない(§23.6)。 */
  teamName?: string
  /** 自チームメンバーの表示名のみ。他チームのメンバー名を渡す経路は存在しない。 */
  teamMemberNames?: string[]
  /** 現在のフェーズの生徒公開情報(現在課題・公開情報)。 */
  displayConfig: LessonPhaseDisplayConfig
  /** 現在のフェーズの回答方式。フェーズに回答がない場合(INFO等)は省略できる。 */
  inputConfig?: LessonInputField
  initialValue?: LessonInputValue
  initialRevision?: number
  /** `lessonRunPublic`(Task10)由来の残り秒数。 */
  remainingSeconds: number | null
  /** 確定状況。呼び出し側がTask7/8の状態から渡す(このコンポーネント自体は
   * proposal/approve/confirmのCallableを直接呼ばない — 薄いshellとして
   * displayConfig/inputConfigをRendererへ渡すことに専念する)。 */
  responseStatus?: LessonResponseStatus
  /** テスト用に差し替え可能。既定は本物の`saveResponseDraft`(Task7)。 */
  saveResponseDraft?: UseLessonResponseDraftInput['saveResponseDraft']
  /** テスト用に差し替え可能。既定は本物の`requestLessonHelp`ラッパー。 */
  requestHelp?: (functions: Functions, input: RequestLessonHelpInput) => Promise<RequestLessonHelpResult>
  /** テスト用フック差し替え(内部実装の一部を検証しやすくするためのみ)。 */
  useResponseDraft?: (input: UseLessonResponseDraftInput) => UseLessonResponseDraftResult
}

/**
 * 生徒の授業画面(Task12)。phaseの`displayConfig`/`inputConfig`を
 * `LessonInputRenderer`(Task6)へ渡すだけの薄いshellとし、回答の自動保存は
 * `useLessonResponseDraft`(Task7)にそのまま委譲する。現在課題・公開情報・
 * 自分/チーム状態・残り時間・確定状況・短いヘルプ(困りごとボタン)だけを
 * 表示し、教師専用情報や未使用機能(他チーム情報・介入操作等)は一切表示
 * しない — そもそもそれらのpropsが存在しない設計。
 */
export function LessonPlayPage({
  functions, lessonRunId, phaseId, inputId, participantId, teamId,
  displayName, teamName, teamMemberNames,
  displayConfig, inputConfig, initialValue, initialRevision,
  remainingSeconds, responseStatus,
  saveResponseDraft,
  requestHelp = requestLessonHelpDefault,
  useResponseDraft = useLessonResponseDraft,
}: LessonPlayPageProps) {
  const draft = useResponseDraft({
    functions, lessonRunId, participantId, teamId, phaseId, inputId,
    initialValue: initialValue ?? '',
    initialRevision,
    saveResponseDraft,
  })

  const [helpStatus, setHelpStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  const handleRequestHelp = async () => {
    setHelpStatus('sending')
    try {
      // 匿名集計(ブリーフStep4): 他の生徒には一切伝わらない — 送るのは
      // lessonRunId とidempotencyKeyだけで、本人の名前/参加者IDはクライアント
      // からは送らない(actorIdはCallableがサーバー側で認証情報から解決する
      // 設計、他のCallableと同じパターン。helpRequests.tsのJSDoc参照)。
      await requestHelp(functions, { lessonRunId, idempotencyKey: generateIdempotencyKey() })
      setHelpStatus('sent')
    } catch {
      setHelpStatus('error')
    }
  }

  return (
    <Stack spacing={2} sx={{ width: '100%', maxWidth: 560, p: 2 }}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
        <Chip label={displayName} />
        {teamName && <Chip label={teamName} color="primary" variant="outlined" />}
        {remainingSeconds !== null && <Chip label={`残り ${remainingSeconds} 秒`} color={remainingSeconds <= 10 ? 'error' : 'default'} />}
      </Stack>

      {teamMemberNames && teamMemberNames.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          {teamMemberNames.map((name) => <Chip key={name} label={name} size="small" variant="outlined" />)}
        </Stack>
      )}

      {displayConfig.title && <Typography variant="h6" component="h1">{displayConfig.title}</Typography>}
      <Typography variant="body1">{displayConfig.taskDescription}</Typography>

      {displayConfig.publicInfo && displayConfig.publicInfo.length > 0 && (
        <Stack spacing={0.5}>
          <Typography variant="subtitle2">公開情報</Typography>
          <List dense sx={{ py: 0 }}>
            {displayConfig.publicInfo.map((info) => (
              <ListItem key={info} sx={{ py: 0.25 }}>
                <Typography variant="body2">{info}</Typography>
              </ListItem>
            ))}
          </List>
        </Stack>
      )}

      {inputConfig && (
        // inputConfig はテンプレートデータ由来の union(LessonInputField)で、
        // このshell自体はwidget種類ごとの分岐(switch)を持たない —
        // その分岐はLessonInputRenderer.tsxが既に持っている(Task6)。ここで
        // 呼び出す際に union のまま渡すため1箇所だけ型アサーションが必要
        // (LessonInputRenderer.tsx内の各caseが同じ理由で行っているキャストと
        // 同種)。
        <LessonInputRenderer
          {...({
            id: inputId,
            config: inputConfig.config,
            value: draft.value,
            onChange: (value: LessonInputValue) => draft.setValue(value),
            responseScope: inputConfig.responseScope,
          } as LessonInputRendererProps)}
        />
      )}

      {responseStatus && <Alert severity="info">{RESPONSE_STATUS_LABELS[responseStatus]}</Alert>}
      {draft.status === 'error' && <Alert severity="warning">保存に失敗しました。通信を確認してください(入力内容は保持されています)。</Alert>}

      <Divider />

      <Stack spacing={0.5}>
        <Button
          variant="outlined"
          onClick={() => void handleRequestHelp()}
          disabled={helpStatus === 'sending'}
          sx={{ minHeight: MIN_TOUCH_TARGET, alignSelf: 'flex-start' }}
          aria-label="困っていることを先生に伝える"
        >
          困っている
        </Button>
        <Typography variant="caption" role="status" aria-live="polite">
          {helpStatus === 'sent' && '先生に伝えました。'}
          {helpStatus === 'error' && '送信できませんでした。先生に直接伝えてください。'}
        </Typography>
      </Stack>
    </Stack>
  )
}
