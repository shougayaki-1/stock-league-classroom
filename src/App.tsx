import { TemplateRoutes } from './components/TemplateRoutes'
import { StudentMarketJoin, TeacherMarketDashboard } from './components/MarketDashboard'
import { HostConsole } from './components/HostConsole'
import { StudentMarketPage } from './components/student/StudentMarketPage'
import { SignagePage } from './components/signage/SignagePage'
import { AboutPage, ContactPage, GuidePage, PrivacyPage, TermsPage } from './components/PublicDocs'
import { BrowserRouter, Link as RouterLink, Navigate, Route, Routes, useLocation, useParams } from 'react-router'
import { Box, Button, CssBaseline, Link, Stack, ThemeProvider, Typography } from '@mui/material'
import { appTheme } from './theme/theme'
import { NotFoundPage } from './components/ui/NotFoundPage'
import { TeacherShell } from './components/teacher/TeacherShell'

/** Static public documents, keyed by path. */
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

const LandingPage = () => <main className="landing-page">
  <Box component="header" className="landing-nav">
    <Link component={RouterLink} className="brand" to="/" underline="none" color="inherit" aria-label="Stock League Classroom ホーム" sx={{ minHeight: 48, display: 'inline-flex', alignItems: 'center' }}>Stock League <span>Classroom</span></Link>
    <Stack component="nav" direction="row" aria-label="主要ナビゲーション" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
      <Link href="#how-it-works" color="inherit" sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', px: 1 }}>使い方</Link>
      <Link href="#features" color="inherit" sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', px: 1 }}>特徴</Link>
      <Button component={RouterLink} className="nav-cta" to="/teacher/markets" variant="contained" sx={{ ...landingCtaSx, minHeight: 44 }}>先生はこちら</Button>
    </Stack>
  </Box>

  <section className="landing-hero" aria-labelledby="hero-title">
    <div className="hero-copy">
      <p className="eyebrow">金融教育を、教室でリアルタイムに。</p>
      <h1 id="hero-title">株式市場を、<br /><em>自分たちの教室に。</em></h1>
      <p className="hero-lede">Stock League Classroom は、チームで考え、ニュースに反応し、投資の仕組みを体験できる授業用シミュレーターです。</p>
      <Stack className="hero-actions" direction={{ xs: 'column', sm: 'row' }} sx={{ alignItems: { xs: 'stretch', sm: 'center' }, gap: 1.5 }}><Button component={RouterLink} to="/teacher/markets" variant="contained" size="large" sx={landingCtaSx}>授業をはじめる <span aria-hidden="true">→</span></Button><Button component={RouterLink} to="/join" variant="outlined" size="large" sx={{ borderColor: 'var(--landing-border)', color: 'var(--landing-text)' }}>生徒として参加</Button></Stack>
      <p className="hero-note">アカウント不要で、生徒は参加コードからすぐに参加できます。</p>
    </div>
    <div className="market-card" aria-label="市場のライブ表示イメージ">
      <div className="market-card-head"><span className="live-dot" />LIVE MARKET <span className="round">ROUND 2</span></div>
      <div className="market-value"><span>教室総資産</span><strong>¥ 1,284,500</strong><b>+ 8.4%</b></div>
      <div className="market-chart" aria-hidden="true"><svg viewBox="0 0 360 130" preserveAspectRatio="none"><path d="M0,100 C25,106 40,74 62,86 S90,48 116,67 S145,78 164,48 S203,59 226,30 S251,52 274,34 S311,40 360,6" /><path className="area" d="M0,100 C25,106 40,74 62,86 S90,48 116,67 S145,78 164,48 S203,59 226,30 S251,52 274,34 S311,40 360,6 V130 H0Z" /></svg></div>
      <div className="market-row"><span>東都テクノロジー</span><strong>1,240</strong><b>+4.2%</b></div>
      <div className="market-row"><span>みらい食品</span><strong>860</strong><b>+1.8%</b></div>
      <div className="news-pill">速報　新製品の発表で期待が高まる</div>
    </div>
  </section>

  <section className="steps" id="how-it-works" aria-labelledby="steps-title">
    <div><p className="section-kicker">HOW IT WORKS</p><h2 id="steps-title">考える。選ぶ。<br />振り返る。</h2></div>
    <ol><li><span>01</span><h3>先生が市場をつくる</h3><p>テンプレートを選び、授業に合わせた市場と参加コードを発行します。</p></li><li><span>02</span><h3>生徒がチームで参加</h3><p>参加コードを入力して、個人またはチームで投資戦略を考えます。</p></li><li><span>03</span><h3>ニュースと価格が動く</h3><p>教室のスクリーンを見ながら、変化の理由を読み解きます。</p></li></ol>
  </section>

  <section className="feature-section" id="features" aria-labelledby="features-title"><div className="feature-intro"><p className="section-kicker">BUILT FOR THE CLASSROOM</p><h2 id="features-title">知識だけで終わらない、<br />判断する金融教育へ。</h2></div><div className="feature-grid"><article><span>◎</span><h3>リアルタイムの市場体験</h3><p>価格、ニュース、ランキングが同時に動き、意思決定の結果がすぐに見えます。</p></article><article><span>◫</span><h3>授業に合わせた設計</h3><p>学年やテーマに合うテンプレートから、市場シナリオを組み立てられます。</p></article><article><span>↗</span><h3>振り返りまで一つに</h3><p>終了後も結果と取引履歴を確認し、なぜそう判断したかを言語化できます。</p></article></div></section>

  <section className="landing-closing"><p>今日のニュースが、明日の判断を変える。</p><h2>さあ、教室に市場をひらこう。</h2><Button component={RouterLink} to="/teacher/markets" variant="contained" size="large" sx={{ backgroundColor: 'var(--landing-closing-cta)', color: 'var(--landing-closing-on-cta)', '&:hover': { backgroundColor: 'var(--landing-closing-cta-hover)' } }}>先生として市場を作成 <span aria-hidden="true">→</span></Button></section>
  <Box component="footer"><Typography component="span" variant="body2">© 2026 Stock League Classroom</Typography><Stack component="nav" direction="row" aria-label="サービス情報" sx={{ flexWrap: 'wrap', gap: { xs: 0.5, sm: 1.5 } }}>{[['/about', 'サービス概要'], ['/guide', '操作マニュアル'], ['/terms', '利用規約'], ['/privacy', 'プライバシーポリシー'], ['/contact', '問い合わせ'], ['/join', '生徒の参加はこちら']].map(([to, label]) => <Link component={RouterLink} to={to} color="inherit" key={to} sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', px: 0.5 }}>{label}</Link>)}</Stack></Box>
</main>

const TemplateShareRoute = () => <TemplateRoutes shareId={useParams().shareId ?? ''} />
const StudentPlayRoute = () => <StudentMarketPage marketId={useParams().marketId ?? ''} />
const SignageRoute = () => <SignagePage marketId={useParams().marketId ?? ''} />
const RoomRoute = () => {
  const marketId = useParams().marketId ?? ''
  return <TeacherShell active="room" marketId={marketId}><HostConsole marketId={marketId} /></TeacherShell>
}
/** Keeps old links (bookmarks, printed handouts) working after the host console was renamed to the control room. */
const HostRouteRedirect = () => {
  const marketId = useParams().marketId ?? ''
  const { search, hash } = useLocation()
  return <Navigate replace to={`/teacher/markets/${marketId}/room${search}${hash}`} />
}

/** Keeps shared links canonical, including links copied with a trailing slash. */
const TrailingSlashRedirect = () => {
  const { pathname, search, hash } = useLocation()
  if (pathname === '/' || !pathname.endsWith('/')) return null
  return <Navigate replace to={`${pathname.replace(/\/+$/, '')}${search}${hash}`} />
}

const AppRoutes = () => <><TrailingSlashRedirect /><Routes>
  <Route path="/" element={<LandingPage />} />
  {Object.entries(docPages).map(([path, Page]) => <Route path={path} element={<Page />} key={path} />)}
  <Route path="/templates" element={<TemplateRoutes />} />
  <Route path="/templates/share/:shareId" element={<TemplateShareRoute />} />
  <Route path="/teacher/markets" element={<TeacherMarketDashboard />} />
  <Route path="/teacher/markets/:marketId/room" element={<RoomRoute />} />
  <Route path="/teacher/markets/:marketId/host" element={<HostRouteRedirect />} />
  <Route path="/join" element={<StudentMarketJoin />} />
  <Route path="/markets/:marketId/play" element={<StudentPlayRoute />} />
  <Route path="/markets/:marketId/signage" element={<SignageRoute />} />
  <Route path="*" element={<NotFoundPage />} />
</Routes></>

export default function App() {
  return <ThemeProvider theme={appTheme}>
    <CssBaseline />
    <BrowserRouter><AppRoutes /></BrowserRouter>
  </ThemeProvider>
}
