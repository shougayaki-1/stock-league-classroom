import { Button, Card, CardActionArea, CardContent, Stack, Typography } from '@mui/material'

export interface TeacherHomePageProps {
  onOpenTemplates: () => void
  onOpenMarketplace: () => void
}

export function TeacherHomePage({ onOpenTemplates, onOpenMarketplace }: TeacherHomePageProps) {
  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography variant="h5" component="h1">教師ホーム</Typography>
      <Card variant="outlined">
        <CardActionArea onClick={onOpenTemplates} sx={{ p: 2 }}>
          <CardContent sx={{ p: 0 }}>
            <Typography variant="h6" component="h2">教材</Typography>
            <Typography color="text.secondary">教材を作成・編集し、授業を開始します。</Typography>
          </CardContent>
        </CardActionArea>
        <Stack sx={{ p: 2, pt: 0 }}>
          <Button variant="contained" onClick={onOpenTemplates} sx={{ alignSelf: 'flex-start' }}>教材を管理する</Button>
        </Stack>
      </Card>
      <Card variant="outlined">
        <CardActionArea onClick={onOpenMarketplace} sx={{ p: 2 }}>
          <CardContent sx={{ p: 0 }}>
            <Typography variant="h6" component="h2">コミュニティ教材</Typography>
            <Typography color="text.secondary">他の教師が公開した教材を探します。</Typography>
          </CardContent>
        </CardActionArea>
        <Stack sx={{ p: 2, pt: 0 }}>
          <Button variant="outlined" onClick={onOpenMarketplace} sx={{ alignSelf: 'flex-start' }}>コミュニティ教材を見る</Button>
        </Stack>
      </Card>
    </Stack>
  )
}
