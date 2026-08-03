import type { ReactNode } from 'react'
import { Avatar, Box, ButtonBase, Divider, ListItemButton, ListItemIcon, ListItemText, Paper, Stack, Typography } from '@mui/material'
import { NavLink, Link as RouterLink } from 'react-router'

type TeacherArea = 'markets' | 'templates' | 'host'
type SidebarIcon = TeacherArea | 'guide' | 'home' | 'terminal' | 'scenario' | 'mc' | 'people' | 'screen' | 'settings'

interface TeacherShellProps {
  active: TeacherArea
  children: ReactNode
  email?: string | null
  marketId?: string
  onShowGuide?: () => void
}

const Icon = ({ name }: { name: SidebarIcon }) => {
  const paths = {
    home: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v10h13V10M9 20v-6h6v6" /></>,
    markets: <><path d="M4 19V9m5 10V5m5 14v-7m5 7V3" /><path d="M2 19h20" /></>,
    templates: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    host: <><path d="M4 6h16v11H4z" /><path d="M8 21h8M12 17v4" /><path d="m8 12 2.5-2.5L13 12l3-3" /></>,
    guide: <><circle cx="12" cy="12" r="9" /><path d="M9.7 9a2.4 2.4 0 0 1 4.6 1c0 1.7-2.3 2-2.3 3.5M12 17h.01" /></>,
    terminal: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8 9 2 2-2 2m4 0h3" /></>,
    scenario: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 8h8M8 12h5M8 16h8" /></>,
    mc: <><path d="M12 4v16M8 8a4 4 0 0 1 8 0M5 12a7 7 0 0 1 14 0" /></>,
    people: <><circle cx="9" cy="9" r="3" /><circle cx="17" cy="10" r="2.5" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M15 16a4 4 0 0 1 5.5 3" /></>,
    screen: <><rect x="3" y="5" width="18" height="13" rx="2" /><path d="M8 21h8M12 18v3" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-2.5V20a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1-1.8-1.8.1-.1A1.7 1.7 0 0 0 8 15a1.7 1.7 0 0 0-1.6-1H6v-2.5h.2A1.7 1.7 0 0 0 8 10a1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.8-1.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h2.5V5a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.8 1.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2V13h-.2a1.7 1.7 0 0 0-1.5 2Z" /></>,
  }
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

export const TeacherShell = ({ active, children, email, marketId, onShowGuide }: TeacherShellProps) => {
  const itemSx = { minHeight: 44, px: 1.5, borderRadius: 2.5, gap: 1.5, color: 'text.secondary', '&.active, &.Mui-selected': { color: 'primary.dark', bgcolor: 'primary.light' }, '&:hover': { bgcolor: 'action.hover', color: 'text.primary' }, '&.Mui-disabled': { opacity: 0.46 } }
  const iconSx = { minWidth: 0, color: 'inherit', '& svg': { width: 20, height: 20 } }
  const item = (label: string, icon: SidebarIcon) => <><ListItemIcon sx={iconSx}><Icon name={icon} /></ListItemIcon><ListItemText primary={label} slotProps={{ primary: { sx: { fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' } } }} /></>
  const disabledItem = (label: string, icon: SidebarIcon) => <ListItemButton component="button" type="button" disabled sx={itemSx}>{item(label, icon)}</ListItemButton>
  return <Box className="teacher-shell">
    <Paper component="aside" className="teacher-sidebar" square elevation={0} sx={{ bgcolor: 'background.paper', color: 'text.primary', borderColor: 'divider' }}>
      <ButtonBase component={RouterLink} to="/" className="sidebar-brand" aria-label="Stock League Classroom ホーム" sx={{ justifyContent: 'flex-start', minHeight: 56 }}><Avatar variant="rounded" sx={{ width: 32, height: 32, bgcolor: 'transparent', color: 'primary.main', fontSize: 25, fontWeight: 800 }}>▦</Avatar><Box component="strong">株価にドキリ！<Box component="small" sx={{ display: 'block', color: 'text.secondary' }}>Stock League Classroom</Box></Box></ButtonBase>
      <Divider sx={{ my: 1.5 }} />
      <Box component="nav" aria-label="教師メニュー" sx={{ display: 'grid', gap: 0.5 }}>
        <Typography className="sidebar-group-label" variant="caption">端末オペレーション</Typography>
        {disabledItem('情報照会端末 ↗', 'terminal')}
        <Typography className="sidebar-group-label" variant="caption">市場・シナリオ制御</Typography>
        <ListItemButton component={NavLink} to="/teacher/markets" selected={active === 'markets'} className={active === 'markets' ? 'active' : ''} sx={itemSx}>{item('市場の管理', 'markets')}</ListItemButton>
        {marketId ? <ListItemButton component={NavLink} to={`/teacher/markets/${marketId}/host`} sx={itemSx}>{item('シナリオ・ニュース予約', 'scenario')}</ListItemButton> : disabledItem('シナリオ・ニュース予約', 'scenario')}
        {marketId ? <ListItemButton component={NavLink} to={`/teacher/markets/${marketId}/host`} selected={active === 'host'} className={active === 'host' ? 'active' : ''} sx={itemSx}>{item('MCコントロール', 'mc')}</ListItemButton> : disabledItem('MCコントロール', 'mc')}
        {marketId
          ? <ListItemButton component={NavLink} to={`/teacher/markets/${marketId}/host`} selected={active === 'host'} className={active === 'host' ? 'active' : ''} sx={itemSx}>{item('市場を進行', 'host')}</ListItemButton>
          : <ListItemButton component="button" type="button" disabled title="市場を選択すると進行画面を開けます" aria-describedby="host-navigation-help" sx={itemSx}>{item('市場を進行', 'host')}</ListItemButton>}
        {!marketId && <span id="host-navigation-help" className="visually-hidden">先に作成済み市場を選択してください。</span>}
        <Typography className="sidebar-group-label" variant="caption">エージェント管理</Typography>
        {marketId ? <ListItemButton component={NavLink} to={`/teacher/markets/${marketId}/host`} sx={itemSx}>{item('ID発行・ステータス', 'people')}</ListItemButton> : disabledItem('ID発行・ステータス', 'people')}
        {marketId ? <ListItemButton component={NavLink} to={`/teacher/markets/${marketId}/host`} sx={itemSx}>{item('参加承認・参加者', 'people')}</ListItemButton> : disabledItem('参加承認・参加者', 'people')}
        <Typography className="sidebar-group-label" variant="caption">サイネージ制御</Typography>
        {marketId ? <ListItemButton component={NavLink} to={`/markets/${marketId}/signage`} sx={itemSx}>{item('教室画面管理', 'screen')}</ListItemButton> : disabledItem('教室画面管理', 'screen')}
        <ListItemButton component={NavLink} to="/templates" selected={active === 'templates'} className={active === 'templates' ? 'active' : ''} sx={itemSx}>{item('テンプレート', 'templates')}</ListItemButton>
        <Typography className="sidebar-group-label" variant="caption">システム設定</Typography>
        {onShowGuide ? <ListItemButton onClick={onShowGuide} sx={itemSx}>{item('使い方を見る', 'guide')}</ListItemButton> : <ListItemButton component={RouterLink} to="/guide" sx={itemSx}>{item('使い方を見る', 'guide')}</ListItemButton>}
      </Box>
      <Stack className="sidebar-bottom" spacing={0.5}>
        <Divider sx={{ mb: 1 }} />
        <ListItemButton component={RouterLink} to="/" sx={itemSx}>{item('トップへ戻る', 'home')}</ListItemButton>
        {email && <Stack className="sidebar-account" direction="row" spacing={1.25} sx={{ alignItems: 'center', mt: 1.5, px: 1 }}><Avatar sx={{ width: 32, height: 32, bgcolor: 'secondary.main', fontSize: 13 }}>{email.slice(0, 1).toUpperCase()}</Avatar><Box sx={{ minWidth: 0 }}><Typography variant="caption" sx={{ display: 'block', fontWeight: 700 }}>教師アカウント</Typography><Typography variant="caption" color="text.secondary" noWrap>{email}</Typography></Box></Stack>}
      </Stack>
    </Paper>
    <Box className="teacher-shell-content">{children}</Box>
  </Box>
}

export interface ProgressStep { label: string; detail?: string }
export const SetupProgress = ({ steps, current, label = '進行状況' }: { steps: ProgressStep[]; current: number; label?: string }) => <section className="setup-progress" aria-label={label}>
  <div className="progress-caption"><span>{label}</span><strong>{Math.min(current + 1, steps.length)} / {steps.length}</strong></div>
  <ol>{steps.map((step, index) => {
    const state = index < current ? 'complete' : index === current ? 'current' : ''
    return <li className={state} key={step.label} aria-current={index === current ? 'step' : undefined}>
      <span className="progress-dot">{index < current ? '✓' : index + 1}</span>
      <div><strong>{step.label}</strong>{step.detail && <small>{step.detail}</small>}</div>
    </li>
  })}</ol>
</section>

export const AuthLoadingScreen = () => <main className="auth-loading" aria-busy="true" aria-label="ログイン状態を確認しています">
  <div className="auth-loading-mark">SL</div><div className="auth-loading-line" /><p>教室を準備しています</p>
</main>
