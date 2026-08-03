import PresentToAllOutlined from '@mui/icons-material/PresentToAllOutlined'
import { Button, Card, CardContent, Stack, Typography } from '@mui/material'

export interface SignageLinkPanelProps { marketId: string }

export function SignageLinkPanel({ marketId }: SignageLinkPanelProps) {
  return (
    <Card component="section">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="overline" color="text.secondary">CLASSROOM SCREEN</Typography>
          <Typography component="h2" variant="h4">教室画面を表示する</Typography>
          <Typography color="text.secondary">プロジェクターやテレビにつないだ端末で開くと、価格・ニュース・順位が自動更新されます。この画面はコントロールルームとは別のタブで開いてください。</Typography>
          <Button component="a" href={`/markets/${marketId}/signage`} target="_blank" rel="noopener" variant="contained" startIcon={<PresentToAllOutlined />} sx={{ alignSelf: 'flex-start' }}>教室画面を別タブで開く</Button>
        </Stack>
      </CardContent>
    </Card>
  )
}
