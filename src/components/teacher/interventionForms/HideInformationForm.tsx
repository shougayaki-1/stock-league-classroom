import { Button, List, ListItem, ListItemText, Stack, Typography } from '@mui/material'
import { MIN_TOUCH_TARGET } from '../../lessonInputs/lessonInputA11y'

export interface HideInformationFormProps {
  informationItems: Array<{ id: string; body: string }>
  hiddenInformationIds: string[]
  onSubmit: (detail: Record<string, unknown>) => void
}

/**
 * 情報の非表示化の専用フォーム。公開済みのニュースを一覧から選ばせるので、
 * 教師は情報IDを知る必要がない。非表示にしたものは同じ一覧から元に戻せる。
 */
export function HideInformationForm({ informationItems, hiddenInformationIds, onSubmit }: HideInformationFormProps) {
  if (informationItems.length === 0) {
    return <Typography variant="body2" color="text.secondary">まだ公開されたニュースがありません。</Typography>
  }

  return (
    <Stack spacing={1}>
      <Typography variant="body2" color="text.secondary">生徒に公開中のニュースを一時的に隠せます。</Typography>
      <List>
        {informationItems.map((item) => {
          const hidden = hiddenInformationIds.includes(item.id)
          return (
            <ListItem
              key={item.id}
              secondaryAction={
                <Button
                  variant="outlined"
                  sx={{ minHeight: MIN_TOUCH_TARGET }}
                  onClick={() => onSubmit({ informationId: item.id, hidden: !hidden })}
                >
                  {hidden ? `「${item.body}」を元に戻す` : `「${item.body}」を非表示にする`}
                </Button>
              }
            >
              <ListItemText primary={item.body} secondary={hidden ? '非表示中' : '公開中'} />
            </ListItem>
          )
        })}
      </List>
    </Stack>
  )
}
