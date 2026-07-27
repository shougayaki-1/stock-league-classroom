import { Component, type ErrorInfo, type ReactNode } from 'react'
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
      return <main className="workspace-gate"><div><p className="portal-eyebrow">CONNECTION ERROR</p><h1>アプリを開始できませんでした</h1><p>ページを再読み込みしてください。解決しない場合は、先生に接続状況を確認してください。</p><button className="portal-button" type="button" onClick={() => window.location.reload()}>再読み込み</button></div></main>
    }
    return this.props.children
  }
}

export const ConfigurationError = () => (
  <main className="workspace-gate"><div><p className="portal-eyebrow">CONFIGURATION ERROR</p><h1>公開設定が完了していません</h1><p>FirebaseまたはApp Checkの設定を管理者が確認してください。</p></div></main>
)
