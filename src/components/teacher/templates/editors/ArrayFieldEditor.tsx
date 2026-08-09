import DeleteIcon from '@mui/icons-material/Delete'
import { Button, IconButton, Stack, TextField, Typography } from '@mui/material'

export interface ArrayItemFieldConfig<T extends object> { key: Extract<keyof T, string>; label: string; type: 'text' | 'number' }
export interface ArrayFieldEditorProps<T extends object> { items: T[]; fields: ArrayItemFieldConfig<T>[]; itemLabel: string; onChange: (items: T[]) => void; createEmptyItem: () => T; getItemKey?: (item: T, index: number) => string }

export function ArrayFieldEditor<T extends object>({ items, fields, itemLabel, onChange, createEmptyItem, getItemKey = (_, index) => String(index) }: ArrayFieldEditorProps<T>) {
  const update = (index: number, key: Extract<keyof T, string>, value: string | number) => onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item) as T[])
  return <Stack spacing={2}>{items.map((item, index) => {
    const nameField = fields.find((field) => field.type === 'text')
    const rowLabel = nameField ? String(item[nameField.key] || itemLabel) : itemLabel
    return <Stack key={getItemKey(item, index)} direction="row" spacing={1} sx={{ alignItems: 'flex-start', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}><Stack spacing={1} sx={{ flex: 1 }}>{fields.map((field) => <TextField key={field.key} label={field.label} type={field.type} value={String(item[field.key] ?? '')} onChange={(event) => update(index, field.key, field.type === 'number' ? Number(event.target.value) : event.target.value)} size="small" fullWidth />)}</Stack><IconButton aria-label={`${rowLabel}を削除`} onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}><DeleteIcon /></IconButton></Stack>
  })}{items.length === 0 && <Typography variant="body2" color="text.secondary">まだ{itemLabel}がありません。</Typography>}<Button variant="outlined" onClick={() => onChange([...items, createEmptyItem()])} sx={{ alignSelf: 'flex-start' }}>{itemLabel}を追加</Button></Stack>
}
