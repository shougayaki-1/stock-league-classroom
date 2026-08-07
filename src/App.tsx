import { useEffect, useMemo, useState } from 'react'
import { BrowserRouter, Link as RouterLink, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { Box, Button, CircularProgress, CssBaseline, Link, Stack, ThemeProvider, Typography } from '@mui/material'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { onValue, ref } from 'firebase/database'
import { appTheme } from './theme/theme'
import { AboutPage, ContactPage, GuidePage, PrivacyPage, TermsPage } from './components/PublicDocs'
import { NotFoundPage } from './components/ui/NotFoundPage'
import { bootstrapFirebase, type FirebaseServices } from './lib/firebase/bootstrap'
import { isLessonPlatformV2Enabled as isLessonPlatformV2EnabledDefault } from './lib/features/lessonPlatformV2'
import { getOrCreateStudentUid } from './lib/auth/studentAuth'
import type { LessonRunRole } from './lib/lessonRuns/authorization'
import { LessonJoinPage } from './components/student/LessonJoinPage'
import { LessonControlRoom } from './components/teacher/LessonControlRoom'
import { ClassroomDisplayPage } from './components/display/ClassroomDisplayPage'

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

// ---------------------------------------------------------------------------
// Phase B lesson platform routes (Task 17)
//
// This is the first task to introduce authenticated teacher/student routes,
// so the guard + Feature Flag machinery below is designed from scratch here
// — kept intentionally small (route/guard/flag only), per this task's brief.
//
// Client-side guards below are a UX convenience only ("don't show a
// spinning-forever UI to someone with no access"), never the actual
// authorization boundary. The real enforcement is server-side: Firestore's
// `lessonRuns/{lessonRunId}` `get` rule (teacher() && activeMember(orgId))
// and RTDB's `lessonRunMembership/{lessonRunId}/{uid}` `.read` rule (own uid
// only). A guard bug here can at worst show a broken loading state to an
// unauthorized user — it can never grant access to data the Rules would
// otherwise deny, because every read a guard or a guarded screen performs
// still goes through those same Rules.
// ---------------------------------------------------------------------------

type AccessStatus = 'LOADING' | 'DENIED' | 'GRANTED'
interface TeacherAccess { status: AccessStatus; role?: LessonRunRole }
interface StudentAccess { status: AccessStatus; teamId?: string }

/**
 * Resolves whether the signed-in user is a teacher assigned a role on this
 * specific lessonRun. Reads `lessonRuns/{runId}` directly — Firestore's own
 * rule (`teacher() && activeMember(resource.data.orgId)`) already enforces
 * org membership, so this guard does not duplicate that check; it only adds
 * the run-specific `teacherRoles` lookup that the rule does not express
 * (LessonControlRoom's `role` prop needs a role, not just "is an org
 * member" — see LessonControlRoom.tsx's own prop JSDoc for why no client
 * wrapper for this existed before this task).
 */
function useTeacherLessonAccess(runId: string, services: FirebaseServices): TeacherAccess {
  const [access, setAccess] = useState<TeacherAccess>({ status: 'LOADING' })
  useEffect(() => {
    let cancelled = false
    setAccess({ status: 'LOADING' })
    const unsubscribeAuth = onAuthStateChanged(services.auth, (user) => {
      if (!user) {
        if (!cancelled) setAccess({ status: 'DENIED' })
        return
      }
      getDoc(doc(services.firestore, 'lessonRuns', runId))
        .then((snapshot) => {
          if (cancelled) return
          if (!snapshot.exists()) {
            setAccess({ status: 'DENIED' })
            return
          }
          const data = snapshot.data() as { teacherRoles?: Record<string, LessonRunRole> }
          const role = data.teacherRoles?.[user.uid]
          setAccess(role ? { status: 'GRANTED', role } : { status: 'DENIED' })
        })
        // A permission-denied error (not an active org member) or a
        // not-found error is treated identically: no access.
        .catch(() => { if (!cancelled) setAccess({ status: 'DENIED' }) })
    })
    return () => { cancelled = true; unsubscribeAuth() }
  }, [runId, services])
  return access
}

/**
 * Resolves whether the (possibly newly anonymous-signed-in) current user is
 * an ACTIVE participant of this lessonRun, via the
 * `lessonRunMembership/{runId}/{uid}` RTDB mirror (Task 2) — the same node
 * `database.rules.json` already scopes to "own uid only", so a student can
 * never use this to probe another participant's membership.
 */
function useStudentLessonAccess(runId: string, services: FirebaseServices): StudentAccess {
  const [access, setAccess] = useState<StudentAccess>({ status: 'LOADING' })
  useEffect(() => {
    let cancelled = false
    let detach: (() => void) | undefined
    setAccess({ status: 'LOADING' })
    getOrCreateStudentUid(services.auth)
      .then((uid) => {
        if (cancelled) return
        const membershipRef = ref(services.database, `lessonRunMembership/${runId}/${uid}`)
        detach = onValue(
          membershipRef,
          (snapshot: { val: () => unknown }) => {
            if (cancelled) return
            const value = snapshot.val() as { access?: string; teamId?: string } | null
            setAccess(value?.access === 'ACTIVE' ? { status: 'GRANTED', teamId: value.teamId } : { status: 'DENIED' })
          },
          () => { if (!cancelled) setAccess({ status: 'DENIED' }) },
        )
      })
      .catch(() => { if (!cancelled) setAccess({ status: 'DENIED' }) })
    return () => { cancelled = true; detach?.() }
  }, [runId, services])
  return access
}

const GuardLoading = () => (
  <Stack sx={{ width: '100%', p: 4, alignItems: 'center', justifyContent: 'center' }}>
    <CircularProgress aria-label="読み込み中" />
  </Stack>
)

/**
 * Placeholder for routes whose guard is real but whose data wiring is not:
 * `LessonAnalyticsPage`(Task15)/`LessonWaitingPage`/`LessonPlayPage`/
 * `LessonResultsPage`(Task12/14) all require fully-resolved data (an
 * analytics aggregate, a lesson title, a participant's own display name...)
 * that no client wrapper in this repo currently produces — confirmed absent
 * for analytics (task-15-report.md: "Callable は追加していない") and for
 * the student screens (`LessonRunPublicState` carries no title/displayName
 * field; task-12-report.md notes no結線コンテナ exists yet). Rendering
 * those components with fabricated placeholder data would be more
 * misleading than this notice, so this task stops at "route exists, guard
 * enforced" and defers the data wiring to a future task, per this task's
 * brief allowing exactly that scope cut.
 */
const DeferredDataNotice = ({ heading }: { heading: string }) => (
  <Stack sx={{ width: '100%', maxWidth: 480, p: 4 }} spacing={1}>
    <Typography variant="h6" component="h1">{heading}</Typography>
    <Typography variant="body2">アクセス権限を確認しました。この画面のデータ表示は別タスクで実装予定です。</Typography>
  </Stack>
)

function TeacherControlRoute({ services }: { services: FirebaseServices }) {
  const { runId } = useParams<{ runId: string }>()
  const access = useTeacherLessonAccess(runId ?? '', services)
  if (access.status === 'LOADING') return <GuardLoading />
  if (access.status === 'DENIED') return <Navigate replace to="/about" />
  return <LessonControlRoom
    lessonRunId={runId ?? ''}
    role={access.role ?? 'VIEWER'}
    functions={services.functions}
    firestore={services.firestore}
    database={services.database}
  />
}

function TeacherAnalyticsRoute({ services }: { services: FirebaseServices }) {
  const { runId } = useParams<{ runId: string }>()
  const access = useTeacherLessonAccess(runId ?? '', services)
  if (access.status === 'LOADING') return <GuardLoading />
  if (access.status === 'DENIED') return <Navigate replace to="/about" />
  return <DeferredDataNotice heading="授業分析" />
}

function StudentLessonRoute({ services, heading }: { services: FirebaseServices; heading: string }) {
  const { runId } = useParams<{ runId: string }>()
  const access = useStudentLessonAccess(runId ?? '', services)
  if (access.status === 'LOADING') return <GuardLoading />
  if (access.status === 'DENIED') return <Navigate replace to="/join" />
  return <DeferredDataNotice heading={heading} />
}

function JoinRoute({ services }: { services: FirebaseServices }) {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    getOrCreateStudentUid(services.auth)
      .then(() => { if (!cancelled) setReady(true) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [services])
  if (failed) return <Stack sx={{ width: '100%', maxWidth: 480, p: 4 }}><Typography role="alert">ログインを確認できませんでした。もう一度お試しください。</Typography></Stack>
  if (!ready) return <GuardLoading />
  return <LessonJoinPage
    functions={services.functions}
    onJoined={(result) => navigate(`/lessons/${result.lessonRunId}/waiting`)}
  />
}

/**
 * `ClassroomDisplayPage`(Task13) is already self-contained: it takes the
 * plaintext `token` and does the token-exchange + sign-in + RTDB
 * subscription itself. This route's only job is extracting `runId` (path)
 * and `token` (query string) from the URL — `token` is a query param rather
 * than part of the path because it is a one-time secret, not a resource
 * identifier, and keeping it out of the path keeps it out of any path-based
 * access logging.
 */
function DisplayRoute({ services }: { services: FirebaseServices }) {
  const { runId } = useParams<{ runId: string }>()
  const [searchParams] = useSearchParams()
  return <ClassroomDisplayPage
    auth={services.auth}
    functions={services.functions}
    database={services.database}
    lessonRunId={runId ?? ''}
    token={searchParams.get('token') ?? ''}
  />
}

interface AppRoutesProps { enabled: boolean; services?: FirebaseServices }

const AppRoutes = ({ enabled, services }: AppRoutesProps) => <><TrailingSlashRedirect /><Routes>
  <Route path="/" element={<LandingPage />} />
  {Object.entries(docPages).map(([path, Page]) => <Route path={path} element={<Page />} key={path} />)}
  <Route path="/join" element={enabled && services ? <JoinRoute services={services} /> : <Navigate replace to="/about" />} />
  <Route path="/lessons/:runId/waiting" element={enabled && services ? <StudentLessonRoute services={services} heading="開始をお待ちください" /> : <Navigate replace to="/about" />} />
  <Route path="/lessons/:runId/play" element={enabled && services ? <StudentLessonRoute services={services} heading="授業中" /> : <Navigate replace to="/about" />} />
  <Route path="/lessons/:runId/results" element={enabled && services ? <StudentLessonRoute services={services} heading="結果" /> : <Navigate replace to="/about" />} />
  <Route path="/teacher/lessons/:runId/control" element={enabled && services ? <TeacherControlRoute services={services} /> : <Navigate replace to="/about" />} />
  <Route path="/teacher/lessons/:runId/analytics" element={enabled && services ? <TeacherAnalyticsRoute services={services} /> : <Navigate replace to="/about" />} />
  <Route path="/display/:runId" element={enabled && services ? <DisplayRoute services={services} /> : <Navigate replace to="/about" />} />
  <Route path="*" element={<NotFoundPage />} />
</Routes></>

export interface AppProps {
  /** Test-only override; production always reads `isLessonPlatformV2Enabled()`. */
  isLessonPlatformV2Enabled?: boolean
  /**
   * Test-only override for the Firebase services powering the guarded
   * lesson routes. Production leaves this as `bootstrapFirebase` (already
   * idempotent — see bootstrap.ts), called lazily only when the flag is on,
   * so public-doc routes never touch Firebase (see App.test.tsx's "without
   * Firebase" tests, unaffected by this task).
   */
  getServices?: () => FirebaseServices
}

export default function App({ isLessonPlatformV2Enabled: enabledOverride, getServices = bootstrapFirebase }: AppProps = {}) {
  const enabled = enabledOverride ?? isLessonPlatformV2EnabledDefault()
  const services = useMemo(() => (enabled ? getServices() : undefined), [enabled, getServices])
  return <ThemeProvider theme={appTheme}>
    <CssBaseline />
    <BrowserRouter><AppRoutes enabled={enabled} services={services} /></BrowserRouter>
  </ThemeProvider>
}
