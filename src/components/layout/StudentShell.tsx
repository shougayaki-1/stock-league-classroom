import { Outlet, useLocation } from 'react-router'
import { AppBar, Box, Toolbar, Typography } from '@mui/material'
import { getStudentStepTitle } from './navConfig'

/**
 * Lightweight chrome for student-facing lesson screens: just a header
 * showing the app name and the current step (待機中/プレイ中/結果発表), no
 * side nav — students are mid-lesson and shouldn't be given places to
 * wander off to.
 */
export function StudentShell() {
  const { pathname } = useLocation()
  const stepTitle = getStudentStepTitle(pathname)

  return (
    <Box sx={{ minHeight: '100svh' }}>
      <AppBar position="static" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar sx={{ gap: 1 }}>
          <Typography sx={{ fontWeight: 800, color: 'primary.dark', flexShrink: 0 }}>
            Stock League Classroom
          </Typography>
          <Typography color="text.secondary" sx={{ mx: 1 }} aria-hidden>›</Typography>
          <Typography variant="h6" sx={{ fontSize: '1rem', fontWeight: 700 }}>{stepTitle}</Typography>
        </Toolbar>
      </AppBar>
      <Outlet />
    </Box>
  )
}
