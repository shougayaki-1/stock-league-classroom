import { useState } from 'react'
import { Button, Chip, List, ListItem, ListItemText, Rating, Stack, TextField, Typography } from '@mui/material'
import type { CommunityTemplate } from '../../../lib/lessonTemplates/communityTemplates'
import type { TemplateReview } from '../../../lib/lessonTemplates/templateReviews'

const VISIBILITY_LABELS: Record<string, string> = {
  COMMUNITY: '通常公開',
  VERIFIED: '認証済み',
  OFFICIAL: '公式',
}

const VISIBILITY_COLORS: Record<string, 'default' | 'primary' | 'secondary'> = {
  COMMUNITY: 'default',
  VERIFIED: 'primary',
  OFFICIAL: 'secondary',
}

export interface CommunityTemplateDetailPageProps {
  template: CommunityTemplate & { reviewCount: number; averageClarityRating: number; averageEaseOfImplementationRating: number; averageStudentResponseRating: number }
  reviews: TemplateReview[]
  loading: boolean
  eligible: boolean
  onSubmitReview: (input: { clarityRating: number; easeOfImplementationRating: number; studentResponseRating: number; comment: string }) => void
}

export function CommunityTemplateDetailPage({ template, reviews, eligible, onSubmitReview }: CommunityTemplateDetailPageProps) {
  const [clarityRating, setClarityRating] = useState(5)
  const [easeOfImplementationRating, setEaseOfImplementationRating] = useState(5)
  const [studentResponseRating, setStudentResponseRating] = useState(5)
  const [comment, setComment] = useState('')
  return <Stack spacing={2} sx={{ p: 2 }}>
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Typography variant="h5">{template.title}</Typography>
      <Chip
        label={VISIBILITY_LABELS[template.visibility ?? 'COMMUNITY'] ?? '通常公開'}
        color={VISIBILITY_COLORS[template.visibility ?? 'COMMUNITY'] ?? 'default'}
        size="small"
      />
    </Stack>
    <Typography color="text.secondary">{template.description}</Typography>
    <Typography variant="body2">評価({template.reviewCount ?? 0}件): 分かりやすさ {(template.averageClarityRating ?? 0).toFixed(1)} / 実施のしやすさ {(template.averageEaseOfImplementationRating ?? 0).toFixed(1)} / 生徒の反応 {(template.averageStudentResponseRating ?? 0).toFixed(1)}</Typography>
    {eligible && <Stack spacing={1}>
      <Typography variant="subtitle2">レビューを投稿</Typography>
      <Rating value={clarityRating} onChange={(_event, value) => setClarityRating(value ?? 5)} />
      <Rating value={easeOfImplementationRating} onChange={(_event, value) => setEaseOfImplementationRating(value ?? 5)} />
      <Rating value={studentResponseRating} onChange={(_event, value) => setStudentResponseRating(value ?? 5)} />
      <TextField label="コメント(任意)" value={comment} onChange={(event) => setComment(event.target.value)} multiline minRows={2} />
      <Button variant="contained" onClick={() => onSubmitReview({ clarityRating, easeOfImplementationRating, studentResponseRating, comment })} sx={{ alignSelf: 'flex-start' }}>レビューを送信</Button>
    </Stack>}
    <List>{reviews.map((review, index) => <ListItem key={index}><ListItemText primary={`分かりやすさ${review.clarityRating} / 実施のしやすさ${review.easeOfImplementationRating} / 生徒の反応${review.studentResponseRating}`} secondary={review.comment} /></ListItem>)}</List>
  </Stack>
}
