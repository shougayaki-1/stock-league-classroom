import { Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import type { StockPricePhase } from '../../lib/pricing/types'

export interface PricePhaseEditorProps {
  phases: StockPricePhase[]
  disabled?: boolean
  onAddPhase: () => void
  onUpdatePhase: (index: number, patch: Partial<StockPricePhase>) => void
  onRemovePhase: (index: number) => void
}

const editorFieldSx = { '& .MuiInputBase-root': { bgcolor: 'background.paper' } }
const PhaseNumberField = ({ label, value, min, max, disabled, onChange }: { label: string; value: number; min: number; max: number; disabled?: boolean; onChange: (value: number) => void }) =>
  <TextField sx={editorFieldSx} label={label} type="number" disabled={disabled} slotProps={{ htmlInput: { min, max } }} value={value} onChange={(event) => onChange(Number(event.target.value))} />

export const PricePhaseEditor = ({ phases, disabled, onAddPhase, onUpdatePhase, onRemovePhase }: PricePhaseEditorProps) => <Stack spacing={1.5}>
  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
    <Stack>
      <Typography component="h3" variant="subtitle1">価格フェーズ</Typography>
      <Typography variant="body2" color="text.secondary">開始から何分後に、何%動くかを設定します。</Typography>
    </Stack>
    {!disabled && <Button variant="outlined" size="small" onClick={onAddPhase}>フェーズを追加</Button>}
  </Stack>
  {phases.map((phase, index) => <Paper key={phase.id} variant="outlined" sx={{ p: 2 }}>
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' }, flexWrap: 'wrap' }}>
      <PhaseNumberField label="開始（分）" min={0} max={59} disabled={disabled} value={phase.startMinute} onChange={(value) => onUpdatePhase(index, { startMinute: value })} />
      <PhaseNumberField label="終了（分）" min={1} max={60} disabled={disabled} value={phase.endMinute} onChange={(value) => onUpdatePhase(index, { endMinute: value })} />
      <TextField select sx={{ ...editorFieldSx, minWidth: 130 }} label="方向" disabled={disabled} value={phase.direction} onChange={(event) => onUpdatePhase(index, { direction: event.target.value as StockPricePhase['direction'] })}>
        <MenuItem value="UP">上昇</MenuItem><MenuItem value="DOWN">下落</MenuItem><MenuItem value="FLAT">横ばい</MenuItem>
      </TextField>
      <PhaseNumberField label="変化率（%）" min={0} max={99} disabled={disabled} value={phase.changePercent} onChange={(value) => onUpdatePhase(index, { changePercent: value })} />
      {!disabled && <Button color="error" variant="text" disabled={phases.length <= 1} onClick={() => onRemovePhase(index)}>削除</Button>}
    </Stack>
  </Paper>)}
</Stack>
