import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Alert, Box, Button, Card, CardContent, Stack, Typography } from '@mui/material'
import { reportError } from '../lib/monitoring/errorReporting'

interface Props { children: ReactNode }
interface State { failed: boolean }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error(error, info)
    reportError(error)
  }

  render() {
    if (this.state.failed) {
      return (
        <ErrorState
          title="アプリを開始できませんでした"
          message="ページを再読み込みしてください。解決しない場合は、先生または管理者に連絡してください。"
          action
        />
      )
    }
    return this.props.children
  }
}

export const ConfigurationError = () => (
  <ErrorState
    title="利用を開始できません"
    message="必要な設定を確認できませんでした。管理者に連絡してください。"
  />
)

const ErrorState = ({
  title,
  message,
  action = false,
}: {
  title: string
  message: string
  action?: boolean
}) => (
  <Box component="main" sx={{ minHeight: '100svh', display: 'grid', placeItems: 'center', p: 3 }}>
    <Card sx={{ width: 'min(100%, 520px)' }}>
      <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
        <Stack spacing={2}>
          <Typography variant="h1">{title}</Typography>
          <Alert severity="error">{message}</Alert>
          {action && (
            <Button type="button" variant="contained" size="large" onClick={() => window.location.reload()}>
              再読み込み
            </Button>
          )}
        </Stack>
      </CardContent>
    </Card>
  </Box>
)
