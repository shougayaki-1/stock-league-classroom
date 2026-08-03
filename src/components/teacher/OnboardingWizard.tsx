import { useState } from 'react'
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined'
import NavigateNext from '@mui/icons-material/NavigateNext'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, ListItemIcon, ListItemText, MobileStepper, Stack, Typography } from '@mui/material'

const steps = [
  { title: '授業を始める前に', body: '市場を作成する前に、授業で扱うテーマと公開範囲を確認します。', tasks: ['テンプレートを選ぶ', '必要ならテンプレートを編集する'] },
  { title: '参加コードを共有する', body: '市場を作成すると、参加コードが発行されます。生徒の申請を確認してから承認します。', tasks: ['参加コードを教室に表示する', '参加申請を承認する'] },
  { title: '市場を進行する', body: '全員が参加したら市場を開始します。授業中はニュース配信、終了後は結果の保存ができます。', tasks: ['市場を進行する', '必要に応じて教室画面を開く'] },
]

/** A short, task-based orientation. MUI Dialog handles focus trapping and Escape close. */
export const OnboardingWizard = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const [step, setStep] = useState(0)
  const current = steps[step]
  const handleClose = () => { setStep(0); onClose() }

  return <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm" aria-describedby="onboarding-description">
    <DialogTitle>{current.title}</DialogTitle>
    <DialogContent dividers>
      <Stack spacing={2}>
        <Typography id="onboarding-description" color="text.secondary">{current.body}</Typography>
        <List disablePadding aria-label={`${step + 1}番目の準備項目`}>
          {current.tasks.map((task) => <ListItem key={task} disableGutters>
            <ListItemIcon sx={{ minWidth: 36 }}><CheckCircleOutlined color="primary" /></ListItemIcon>
            <ListItemText primary={task} />
          </ListItem>)}
        </List>
        <MobileStepper variant="dots" steps={steps.length} position="static" activeStep={step} backButton={<span />} nextButton={<span />} aria-label={`${steps.length}項目中 ${step + 1}項目目`} />
      </Stack>
    </DialogContent>
    <DialogActions>
      <Button onClick={handleClose}>閉じる</Button>
      {step > 0 && <Button onClick={() => setStep((value) => value - 1)}>戻る</Button>}
      {step < steps.length - 1
        ? <Button variant="contained" onClick={() => setStep((value) => value + 1)} endIcon={<NavigateNext />}>次へ</Button>
        : <Button variant="contained" onClick={handleClose} endIcon={<CheckCircleOutlined />}>市場を準備する</Button>}
    </DialogActions>
  </Dialog>
}
