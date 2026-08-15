import { Button, Checkbox, CircularProgress, FormControlLabel, Stack, Typography } from '@mui/material'
import type { MaterialDocument } from '../../../../lib/ai/materialsRepository'

export interface MaterialUploadPanelProps {
  materials: MaterialDocument[]
  uploading: boolean
  disabled?: boolean
  onUpload: (file: File) => void
  selectedIds: string[]
  onSelectionChange: (ids: string[]) => void
}

export function MaterialUploadPanel({
  materials,
  uploading,
  disabled = false,
  onUpload,
  selectedIds,
  onSelectionChange,
}: MaterialUploadPanelProps) {
  const toggle = (id: string) =>
    onSelectionChange(
      selectedIds.includes(id)
        ? selectedIds.filter((item) => item !== id)
        : [...selectedIds, id],
    )
  const isUploadDisabled = uploading || disabled

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle1">参考資料</Typography>
      {materials.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          まだ資料がアップロードされていません。
        </Typography>
      )}
      {materials.map((material) => (
        <FormControlLabel
          key={material.id}
          control={
            <Checkbox
              checked={selectedIds.includes(material.id)}
              onChange={() => toggle(material.id)}
            />
          }
          label={material.fileName}
        />
      ))}
      <Button
        component="label"
        variant="outlined"
        disabled={isUploadDisabled}
        sx={{ alignSelf: 'flex-start' }}
      >
        資料をアップロード
        {uploading && <CircularProgress size={16} sx={{ ml: 1 }} />}
        <input
          type="file"
          hidden
          disabled={isUploadDisabled}
          aria-label="資料をアップロード"
          accept=".pdf,.txt,text/plain,application/pdf"
          onChange={(event) => {
            if (isUploadDisabled) return
            const file = event.target.files?.[0]
            if (file) onUpload(file)
          }}
        />
      </Button>
    </Stack>
  )
}
