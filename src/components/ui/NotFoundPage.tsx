import { Button, Container, Stack, Typography } from '@mui/material'
import HomeOutlined from '@mui/icons-material/HomeOutlined'

export const NotFoundPage = () => <Container component="main" maxWidth="sm" sx={{ minHeight: '100svh', display: 'grid', placeItems: 'center', py: 6 }}>
  <Stack spacing={2.5} sx={{ alignItems: 'flex-start' }}>
    <Typography variant="overline" color="primary" sx={{ fontWeight: 800 }}>404</Typography>
    <Typography component="h1" variant="h2">ページが見つかりません</Typography>
    <Typography color="text.secondary">URLが正しいか確認するか、トップページから目的の画面を開いてください。</Typography>
    <Button variant="contained" size="large" href="/" startIcon={<HomeOutlined />}>トップへ戻る</Button>
  </Stack>
</Container>
