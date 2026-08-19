import { useState } from 'react'
import { Link as RouterLink, Outlet, useLocation } from 'react-router'
import {
  AppBar,
  Box,
  Container,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import MenuIcon from '@mui/icons-material/Menu'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { TEACHER_NAV_SECTIONS, getPageTitle } from './navConfig'

const DRAWER_WIDTH = 232

const NavList = ({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) => (
  <Box role="navigation" aria-label="教師メニュー" sx={{ overflowY: 'auto' }}>
    {TEACHER_NAV_SECTIONS.map((section) => (
      <List
        key={section.label}
        dense
        subheader={<ListSubheader component="div" disableSticky>{section.label}</ListSubheader>}
      >
        {section.items.map((item) => {
          const selected = pathname === item.path || pathname.startsWith(`${item.path}/`)
          const Icon = item.icon
          return (
            <ListItemButton
              key={item.path}
              component={RouterLink}
              to={item.path}
              selected={selected}
              onClick={onNavigate}
              aria-current={selected ? 'page' : undefined}
            >
              <ListItemIcon sx={{ minWidth: 36 }}><Icon fontSize="small" /></ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          )
        })}
      </List>
    ))}
  </Box>
)

/**
 * Shared chrome for teacher / organization-admin / operator screens: a
 * header showing where you are, plus a persistent side nav to the
 * top-level sections. Org-scoped pages (settings, plan-limits, ...) are
 * reached from a page that already has the :orgId, not from the nav itself
 * — see navConfig.tsx's own note.
 */
export function TeacherShell() {
  const { pathname } = useLocation()
  const theme = useTheme()
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'))
  const [mobileOpen, setMobileOpen] = useState(false)
  const pageTitle = getPageTitle(pathname)

  return (
    <Box sx={{ display: 'flex', minHeight: '100svh' }}>
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{ borderBottom: 1, borderColor: 'divider', zIndex: (t) => t.zIndex.drawer + 1 }}
      >
        <Toolbar sx={{ gap: 1 }}>
          {!isDesktop && (
            <IconButton
              edge="start"
              aria-label="メニューを開く"
              onClick={() => setMobileOpen(true)}
            >
              <MenuIcon />
            </IconButton>
          )}
          <Typography component={RouterLink} to="/teacher" sx={{ fontWeight: 800, color: 'primary.dark', textDecoration: 'none', flexShrink: 0 }}>
            Stock League Classroom
          </Typography>
          <ChevronRightIcon fontSize="small" sx={{ color: 'text.secondary' }} aria-hidden />
          <Typography variant="h6" sx={{ fontSize: '1rem', fontWeight: 700 }}>{pageTitle}</Typography>
        </Toolbar>
      </AppBar>

      {isDesktop ? (
        <Drawer
          variant="permanent"
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box', borderRight: 1, borderColor: 'divider' },
          }}
        >
          <Toolbar />
          <NavList pathname={pathname} />
        </Drawer>
      ) : (
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' } }}
        >
          <Toolbar />
          <NavList pathname={pathname} onNavigate={() => setMobileOpen(false)} />
        </Drawer>
      )}

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0 }}>
        <Toolbar />
        <Divider sx={{ display: { md: 'none' } }} />
        <Container maxWidth="lg" sx={{ py: 3 }}>
          <Outlet />
        </Container>
      </Box>
    </Box>
  )
}
