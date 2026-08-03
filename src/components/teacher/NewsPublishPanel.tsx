import { useState } from 'react'
import { Button, Card, CardContent, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material'

export interface NewsPublishPanelProps {
  disabled: boolean
  onPublish: (body: string, impactPercent: number) => Promise<void>
}

const IMPACT_OPTIONS = [
  { value: 0, label: '影響なし（お知らせだけ）' },
  { value: 5, label: 'やや上昇（+5%）' },
  { value: 10, label: '大きく上昇（+10%）' },
  { value: -5, label: 'やや下落（-5%）' },
  { value: -10, label: '大きく下落（-10%）' },
]

export function NewsPublishPanel({ disabled, onPublish }: NewsPublishPanelProps) {
  const [news, setNews] = useState('')
  const [impact, setImpact] = useState(0)
  const send = () => { void onPublish(news, impact).then(() => { setNews(''); setImpact(0) }, () => {}) }
  return (
    <Card component="aside">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="overline" color="text.secondary">MANUAL NEWS</Typography>
          <Typography component="h2" variant="h4">ニュースを配信</Typography>
          <Typography color="text.secondary">授業中の出来事を市場へ届けます。</Typography>
          <TextField label="ニュース本文" value={news} multiline minRows={4} placeholder="例: 新商品の発表で期待が高まる" onChange={(event) => setNews(event.target.value)} disabled={disabled} fullWidth />
          <FormControl fullWidth disabled={disabled}>
            <InputLabel id="news-impact-label">相場への影響</InputLabel>
            <Select labelId="news-impact-label" label="相場への影響" value={impact} onChange={(event) => setImpact(Number(event.target.value))}>
              {IMPACT_OPTIONS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
            </Select>
          </FormControl>
          <Button variant="contained" disabled={disabled || !news.trim()} onClick={send}>配信する</Button>
        </Stack>
      </CardContent>
    </Card>
  )
}
