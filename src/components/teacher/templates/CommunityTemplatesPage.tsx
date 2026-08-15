import { Button, CircularProgress, List, ListItem, ListItemText, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import type { CommunityTemplate } from '../../../lib/lessonTemplates/communityTemplates'

export interface CommunityTemplatesPageProps {
  templates: CommunityTemplate[]
  loading: boolean
  subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS' | undefined
  onSubjectChange: (subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS' | undefined) => void
  onDuplicate: (template: CommunityTemplate) => void
}

export function CommunityTemplatesPage({ templates, loading, subject, onSubjectChange, onDuplicate }: CommunityTemplatesPageProps) {
  return <Stack spacing={2} sx={{ p: 2 }}>
    <Typography variant="h5">教材マーケットプレイス</Typography>
    <ToggleButtonGroup exclusive value={subject ?? null} onChange={(_event, value) => onSubjectChange(value ?? undefined)}>
      <ToggleButton value="SOCIAL_STUDIES">公民</ToggleButton>
      <ToggleButton value="HOME_ECONOMICS">家庭科</ToggleButton>
    </ToggleButtonGroup>
    {loading ? <CircularProgress aria-label="読み込み中" /> : templates.length
      ? <List>{templates.map((template) => <ListItem key={template.id} secondaryAction={<Button variant="outlined" onClick={() => onDuplicate(template)}>自組織へ複製</Button>}><ListItemText primary={template.title} secondary={template.description} /></ListItem>)}</List>
      : <Typography color="text.secondary">公開されている教材がまだありません。</Typography>}
  </Stack>
}
