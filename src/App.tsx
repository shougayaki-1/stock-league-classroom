import { BrowserRouter, Link as RouterLink, Navigate, Route, Routes, useLocation } from 'react-router'
import { Box, Button, CssBaseline, Link, Stack, ThemeProvider, Typography } from '@mui/material'
import { appTheme } from './theme/theme'
import { AboutPage, ContactPage, GuidePage, PrivacyPage, TermsPage } from './components/PublicDocs'
import { NotFoundPage } from './components/ui/NotFoundPage'

const docPages: Record<string, () => React.JSX.Element> = {
  '/about': AboutPage,
  '/guide': GuidePage,
  '/terms': TermsPage,
  '/privacy': PrivacyPage,
  '/contact': ContactPage,
}

const landingCtaSx = {
  backgroundColor: 'var(--landing-cta)',
  color: 'var(--landing-on-cta)',
  '&:hover': { backgroundColor: 'var(--landing-cta-hover)' },
}

/**
 * The lesson product is not wired up during Phase A. Every CTA stays within
 * the public surface until the new lesson routes arrive in later phases.
 */
const LandingPage = () => <main className="landing-page">
  <Box component="header" className="landing-nav">
    <Link component={RouterLink} className="brand" to="/" underline="none" color="inherit" aria-label="Stock League Classroom ホーム" sx={{ minHeight: 48, display: 'inline-flex', alignItems: 'center' }}>Stock League <span>Classroom</span></Link>
    <Stack component="nav" direction="row" aria-label="主要ナビゲーション" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
      <Link component={RouterLink} to="/guide" color="inherit" sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', px: 1 }}>使い方</Link>
      <Link component={RouterLink} to="/about" color="inherit" sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', px: 1 }}>特徴</Link>
      <Button component={RouterLink} className="nav-cta" to="/about" variant="contained" sx={{ ...landingCtaSx, minHeight: 44 }}>詳しく見る</Button>
    </Stack>
  </Box>
  <section className="landing-closing"><p>準備を進めています。</p><h2>まもなく教室に市場をひらけます。</h2><Button component={RouterLink} to="/about" variant="contained" size="large" sx={{ backgroundColor: 'var(--landing-closing-cta)', color: 'var(--landing-closing-on-cta)', '&:hover': { backgroundColor: 'var(--landing-closing-cta-hover)' } }}>サービス概要を見る <span aria-hidden="true">→</span></Button></section>
  <Box component="footer"><Typography component="span" variant="body2">© 2026 Stock League Classroom</Typography><Stack component="nav" direction="row" aria-label="サービス情報" sx={{ flexWrap: 'wrap', gap: { xs: 0.5, sm: 1.5 } }}>{[['/about', 'サービス概要'], ['/guide', '操作マニュアル'], ['/terms', '利用規約'], ['/privacy', 'プライバシーポリシー'], ['/contact', '問い合わせ']].map(([to, label]) => <Link component={RouterLink} to={to} color="inherit" key={to} sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', px: 0.5 }}>{label}</Link>)}</Stack></Box>
</main>

const TrailingSlashRedirect = () => {
  const { pathname, search, hash } = useLocation()
  if (pathname === '/' || !pathname.endsWith('/')) return null
  return <Navigate replace to={`${pathname.replace(/\/+$/, '')}${search}${hash}`} />
}

const AppRoutes = () => <><TrailingSlashRedirect /><Routes>
  <Route path="/" element={<LandingPage />} />
  {Object.entries(docPages).map(([path, Page]) => <Route path={path} element={<Page />} key={path} />)}
  <Route path="*" element={<NotFoundPage />} />
</Routes></>

export default function App() {
  return <ThemeProvider theme={appTheme}>
    <CssBaseline />
    <BrowserRouter><AppRoutes /></BrowserRouter>
  </ThemeProvider>
}
