import { useEffect, useState } from 'react'
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth'
import { onValue, ref } from 'firebase/database'
import { bootstrapFirebase } from '../../lib/firebase/bootstrap'
import type { SignageData } from '../../lib/market/liveMarketTypes'
import { normalizeSignageData } from '../../lib/market/signageData'
import { SignageScreen } from './SignageScreen'
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material'

export const SignagePage = ({ marketId }: { marketId: string }) => {
  const services = bootstrapFirebase()
  const [data, setData] = useState<SignageData>()
  const [error, setError] = useState('')
  useEffect(() => {
    let stop: (() => void) | undefined
    let disposed = false
    let authResolved = false
    const unsubscribeAuth = onAuthStateChanged(services.auth, (currentUser) => {
      if (authResolved) return
      authResolved = true
      void (async () => {
        try {
          // Auth persistence is asynchronous. Waiting for this callback is
          // important: signing in anonymously while a teacher session is still
          // being restored would replace that teacher session in the same tab.
          if (!currentUser) await signInAnonymously(services.auth)
          if (disposed) return
          stop = onValue(ref(services.database, `liveMarkets/${marketId}/signage`), (snapshot) => {
            if (disposed) return
            const next = normalizeSignageData(snapshot.val())
            setData(next)
            setError(next ? '' : '教室画面のデータがまだ準備できていません。コントロールルームで市場を開始または再開してください。')
          }, () => setError('この市場の教室画面を表示する権限がありません。市場の公開範囲も確認してください。'))
        } catch {
          if (!disposed) setError('教室画面へ接続できませんでした。')
        }
      })()
    })
    return () => { disposed = true; unsubscribeAuth(); stop?.() }
  }, [marketId, services.auth, services.database])
  if (error) return <Box component="main" sx={{ minHeight: '100svh', display: 'grid', placeItems: 'center', p: 3 }}><Paper sx={{ p: 4, maxWidth: 560 }}><Stack spacing={2}><Typography variant="overline" color="error.main">CLASSROOM SCREEN</Typography><Typography variant="h1">教室画面を表示できません</Typography><Alert severity="error">{error}</Alert><Button variant="contained" type="button" onClick={() => window.location.reload()}>再読み込み</Button></Stack></Paper></Box>
  if (!data) return <Box component="main" sx={{ minHeight: '100svh', display: 'grid', placeItems: 'center', p: 3 }}><Stack spacing={2} sx={{ alignItems: 'center' }}><CircularProgress /><Typography variant="h2">市場を準備しています…</Typography><Typography color="text.secondary">ホストが開始すると価格と順位が表示されます。</Typography></Stack></Box>
  return <SignageScreen data={data} joinUrl={`${window.location.origin}/join?code=${encodeURIComponent(data.joinCode)}`} />
}
