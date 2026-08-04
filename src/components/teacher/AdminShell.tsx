import type { ReactNode } from 'react'
import { Box, ButtonBase, Chip, Divider, ListItemButton, ListItemIcon, ListItemText, Paper, Stack, Typography } from '@mui/material'
import { NavLink, Link as RouterLink } from 'react-router'
import type { MarketStatus } from '../../lib/market/liveMarketTypes'
import { MARKET_STATUS_LABEL } from '../../lib/market/marketStatusLabels'

type AdminArea = 'stocks' | 'room'
type AdminIcon = 'stocks' | 'room' | 'screen' | 'switch'

interface AdminShellProps {
  active: AdminArea
  children: ReactNode
  marketId: string
  marketTitle?: string
  marketStatus?: MarketStatus
}

const Icon = ({ name }: { name: AdminIcon }) => {
  const paths = {
    stocks: <><path d="M4 19V9m5 10V5m5 14v-7m5 7V3" /><path d="M2 19h20" /></>,
    room: <><path d="M4 6h16v11H4z" /><path d="M8 21h8M12 17v4" /><path d="m8 12 2.5-2.5L13 12l3-3" /></>,
    screen: <><rect x="3" y="5" width="18" height="13" rx="2" /><path d="M8 21h8M12 18v3" /></>,
    switch: <><path d="M7 16l-4-4 4-4M3 12h18" /></>,
  }
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

const STATUS_COLOR: Record<MarketStatus, 'default' | 'success' | 'warning'> = { SETUP: 'default', OPEN: 'success', PAUSED: 'warning', ENDING: 'warning', ENDED: 'default' }

export const AdminShell = ({ active, children, marketId, marketTitle, marketStatus }: AdminShellProps) => {
  const itemSx = { minHeight: 44, px: 1.5, borderRadius: 2.5, gap: 1.5, color: 'text.secondary', flex: { xs: '1 1 auto', md: 'initial' }, '&.active, &.Mui-selected': { color: 'primary.dark', bgcolor: 'primary.light' }, '&:hover': { bgcolor: 'action.hover', color: 'text.primary' } }
  const iconSx = { minWidth: 0, color: 'inherit', '& svg': { width: 20, height: 20 } }
  const item = (label: string, icon: AdminIcon) => <><ListItemIcon sx={iconSx}><Icon name={icon} /></ListItemIcon><ListItemText primary={label} slotProps={{ primary: { sx: { fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' } } }} /></>
  return <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: { xs: 'column', md: 'row' } }}>
    <Paper component="aside" square elevation={0} sx={{ width: { md: 260 }, flexShrink: 0, p: 2, display: 'flex', flexDirection: { xs: 'row', md: 'column' }, flexWrap: 'wrap', alignItems: { xs: 'center', md: 'stretch' }, gap: 1, borderRight: { md: 1 }, borderBottom: { xs: 1, md: 0 }, borderColor: 'divider', position: { md: 'sticky' }, top: 0, height: { md: '100dvh' } }}>
      <Stack spacing={1.5} sx={{ width: '100%', display: { xs: 'none', md: 'flex' } }}>
        <ButtonBase component={RouterLink} to="/teacher/markets" sx={{ justifyContent: 'flex-start', gap: 1, borderRadius: 2, p: 1, color: 'text.secondary' }}>
          <Icon name="switch" /><Typography variant="body2" sx={{ fontWeight: 700 }}>別の市場を選ぶ</Typography>
        </ButtonBase>
        <Box sx={{ px: 1 }}>
          <Typography variant="subtitle2" noWrap>{marketTitle ?? '市場'}</Typography>
          {marketStatus && <Chip size="small" color={STATUS_COLOR[marketStatus]} label={MARKET_STATUS_LABEL[marketStatus]} sx={{ mt: 0.5 }} />}
        </Box>
        <Divider />
      </Stack>
      <Box component="nav" aria-label="市場メニュー" sx={{ display: 'flex', flexDirection: { xs: 'row', md: 'column' }, gap: 0.5, flexWrap: 'wrap', width: '100%' }}>
        <Typography variant="caption" sx={{ display: { xs: 'none', md: 'block' }, px: 1.5, color: 'text.secondary', fontWeight: 700, letterSpacing: '.02em' }}>市場設定</Typography>
        <ListItemButton component={NavLink} to={`/teacher/markets/${marketId}/stocks`} selected={active === 'stocks'} sx={itemSx}>{item('銘柄', 'stocks')}</ListItemButton>
        <Typography variant="caption" sx={{ display: { xs: 'none', md: 'block' }, px: 1.5, mt: 1, color: 'text.secondary', fontWeight: 700, letterSpacing: '.02em' }}>この市場を進行する</Typography>
        <ListItemButton component={NavLink} to={`/teacher/markets/${marketId}/room`} selected={active === 'room'} sx={itemSx}>{item('進行', 'room')}</ListItemButton>
        <ListItemButton component="a" href={`/markets/${marketId}/signage`} target="_blank" rel="noopener" sx={itemSx}>{item('教室画面', 'screen')}</ListItemButton>
      </Box>
      <Stack sx={{ display: { xs: 'none', md: 'flex' }, mt: 'auto', width: '100%' }} spacing={0.5}>
        <Divider sx={{ mb: 1 }} />
        <ListItemButton component={RouterLink} to="/guide" sx={itemSx}><ListItemText primary="使い方を見る" slotProps={{ primary: { sx: { fontSize: 13, fontWeight: 700 } } }} /></ListItemButton>
      </Stack>
    </Paper>
    <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
  </Box>
}
