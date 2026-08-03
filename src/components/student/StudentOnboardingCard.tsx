import { Button, Stack, Typography } from '@mui/material'
import { StudentSurfaceCard } from '../ui/StudentUi'

export interface StudentOnboardingCardProps { onDismiss: () => void }

export function StudentOnboardingCard({ onDismiss }: StudentOnboardingCardProps) {
  return (
    <StudentSurfaceCard sx={{ mb: 3 }}>
      <Stack spacing={1.5} sx={{ p: { xs: 2.5, sm: 3 } }}>
        <Typography variant="overline" color="text.secondary">はじめに</Typography>
        <Typography component="h2" variant="h6" sx={{ fontWeight: 800 }}>このチームでの投資について</Typography>
        <Stack component="ul" spacing={0.75} sx={{ pl: 2.5, m: 0 }}>
          <Typography component="li">現金と株は「チーム」で共有します（あなた一人の持ち物ではありません）</Typography>
          <Typography component="li">銘柄を選んで、買う/売るを選択します</Typography>
          <Typography component="li">価格は毎秒動きます。ニュースで大きく動くこともあります</Typography>
          <Typography component="li">終了後にチームの順位と結果が見られます</Typography>
        </Stack>
        <Button variant="contained" onClick={onDismiss} sx={{ alignSelf: 'flex-start' }}>わかった → 取引を始める</Button>
      </Stack>
    </StudentSurfaceCard>
  )
}
