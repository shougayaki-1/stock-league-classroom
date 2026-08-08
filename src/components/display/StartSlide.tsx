import { Chip, Divider, List, ListItem, ListItemText, Stack, Typography } from '@mui/material'
import { QRCodeSVG } from 'qrcode.react'

/**
 * Generic, non-lesson-specific onboarding copy (this task's brief Step 1:
 * "流れ・ルール・操作方法"). Deliberately hardcoded here rather than sourced
 * from `LessonRunDisplayState` — that projection intentionally carries only
 * the allow-listed fields listed in displayProjection.ts (title/goal/teams/
 * teacherGuidance), and adding a "flow/rules/operation" field to it is out
 * of this task's scope. This copy is safe by construction: it never varies
 * per lesson/teacher/student, so there is nothing here that could leak
 * anything the classroom-screen ban list (real names, unsubmitted lists,
 * individual answers, future info, correct answers, internal coefficients,
 * seeds, teacher-only settings, individual evaluations) covers.
 */
const FLOW_STEPS = [
  '① 先生の合図で参加コード（またはQRコード）を使って参加します',
  '② チームに分かれて、画面の指示に従って進めます',
  '③ 授業が始まったら、フェーズごとに課題に取り組みます',
  '④ 最後に結果を振り返ります',
]

const RULES = [
  '静かに集中して取り組みましょう',
  '自分やチームの画面以外は操作しません',
  '困ったときは先生に声をかけてください',
]

const OPERATION_STEPS = [
  '端末の画面をタップ/クリックして操作します',
  '入力した内容は自動的に保存されます',
  '残り時間が表示されている間は変更できます',
]

export interface StartSlideProps {
  title: string
  goal: string | null
  /** 参加用URL。教師のセッション状態からではなく、表示URL自身のクエリパラメータ等、公開情報として渡されることを想定(参加コード自体は生徒に配布される前提の非秘匿情報)。省略時はQRコードを描画しない。 */
  joinUrl?: string
  /** 参加コード文字列(QRの代替として文字でも表示する)。 */
  joinCode?: string
}

/** 開始画面(START mode)。タイトル・目標・流れ・ルール・操作方法・QR/参加コードのみを表示する。 */
export function StartSlide({ title, goal, joinUrl, joinCode }: StartSlideProps) {
  return (
    <Stack spacing={3} sx={{ width: '100%', maxWidth: 960, p: 4 }}>
      <Typography variant="h3" component="h1">{title}</Typography>
      {goal && (
        <Typography variant="h5" component="p" data-testid="start-slide-goal">{goal}</Typography>
      )}

      <Divider />

      <Stack direction="row" spacing={4} sx={{ flexWrap: 'wrap' }}>
        <Stack spacing={1} sx={{ minWidth: 260 }}>
          <Typography variant="h6">授業の流れ</Typography>
          <List dense>
            {FLOW_STEPS.map((step) => <ListItem key={step}><ListItemText primary={step} /></ListItem>)}
          </List>
        </Stack>

        <Stack spacing={1} sx={{ minWidth: 260 }}>
          <Typography variant="h6">ルール</Typography>
          <List dense>
            {RULES.map((rule) => <ListItem key={rule}><ListItemText primary={rule} /></ListItem>)}
          </List>
        </Stack>

        <Stack spacing={1} sx={{ minWidth: 260 }}>
          <Typography variant="h6">操作方法</Typography>
          <List dense>
            {OPERATION_STEPS.map((step) => <ListItem key={step}><ListItemText primary={step} /></ListItem>)}
          </List>
        </Stack>
      </Stack>

      {joinUrl && (
        <Stack spacing={1} sx={{ alignItems: 'center' }}>
          <QRCodeSVG value={joinUrl} size={200} title="参加用QRコード" />
          {joinCode && <Chip label={joinCode} sx={{ fontSize: '1.5rem', p: 2 }} />}
        </Stack>
      )}
    </Stack>
  )
}
