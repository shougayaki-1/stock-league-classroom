import { useEffect, useState, type ReactNode } from 'react'
import { Alert, Box, Button, Card, CardContent, CircularProgress, Container, Stack, Typography } from '@mui/material'
import type { Firestore } from 'firebase/firestore'
import { duplicatePersonalTemplate, getTemplateShare } from '../lib/templates/templateRepository'
import type { TemplateShare } from '../lib/templates/types'

const ShareLayout = ({ children }: { children: ReactNode }) => <Container component="main" maxWidth="sm" sx={{ py: { xs: 4, md: 8 } }}><Stack spacing={3}><Button component="a" href="/templates" variant="text" sx={{ alignSelf: 'flex-start' }}>テンプレート一覧へ戻る</Button>{children}</Stack></Container>

export const TemplateSharePage = ({ shareId, db, ownerUid }: { shareId: string; db?: Firestore; ownerUid?: string }) => {
  const [share, setShare] = useState<TemplateShare>()
  const [error, setError] = useState<string>()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!db || !ownerUid) return
    void getTemplateShare(db, shareId).then((value) => {
      if (!value) setError('共有テンプレートが見つかりません。リンクを確認してください。')
      else setShare(value)
    }).catch(() => setError('共有テンプレートを読み込めません。教師アカウントでログインしているか確認してください。'))
  }, [db, ownerUid, shareId])
  if (!db || !ownerUid) return <Container component="main" maxWidth="sm" sx={{ py: { xs: 4, md: 8 } }}><Card variant="outlined"><CardContent><Stack spacing={2}><Typography variant="overline" color="text.secondary">共有テンプレート</Typography><Typography component="h1" variant="h1">共有テンプレートを受け取る</Typography><Typography color="text.secondary">この共有リンクを開くには、Googleアカウントでログインしてください。</Typography><Button component="a" href="/teacher/markets" variant="contained" sx={{ alignSelf: 'flex-start' }}>教師としてログイン</Button></Stack></CardContent></Card></Container>
  if (error) return <ShareLayout><Card variant="outlined"><CardContent><Stack spacing={2}><Typography variant="overline" color="text.secondary">共有テンプレート</Typography><Typography component="h1" variant="h2">共有テンプレート</Typography><Alert severity="error">{error}</Alert></Stack></CardContent></Card></ShareLayout>
  if (!share) return <ShareLayout><Card variant="outlined"><CardContent><Stack spacing={2} sx={{ alignItems: 'flex-start' }}><CircularProgress aria-label="共有テンプレートを読み込み中" /><Box><Typography component="h1" variant="h2">読み込んでいます…</Typography><Typography color="text.secondary">共有テンプレートを確認しています。</Typography></Box></Stack></CardContent></Card></ShareLayout>
  const duplicate = async () => { await duplicatePersonalTemplate(db, ownerUid, share.snapshot); setCopied(true) }
  return <ShareLayout><Card variant="outlined"><CardContent><Stack spacing={2.5}><Typography variant="overline" color="text.secondary">共有テンプレート</Typography><Box><Typography component="h1" variant="h2">{share.snapshot.title}</Typography><Typography color="text.secondary">{share.snapshot.description}</Typography></Box><Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}><Box><Typography variant="caption" color="text.secondary">初期資金</Typography><Typography sx={{ fontWeight: 700 }}>¥{share.snapshot.startingCash.toLocaleString()}</Typography></Box><Box><Typography variant="caption" color="text.secondary">会社数</Typography><Typography sx={{ fontWeight: 700 }}>{share.snapshot.companies.length} 社</Typography></Box></Stack><Button variant="contained" onClick={() => void duplicate()} disabled={copied}>{copied ? '自分用に複製しました' : '自分用に複製する'}</Button></Stack></CardContent></Card></ShareLayout>
}
