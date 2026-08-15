import { useCallback, useEffect, useMemo, useState } from 'react'
import { BrowserRouter, Link as RouterLink, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { Alert, Box, Button, CircularProgress, CssBaseline, Link, Stack, TextField, ThemeProvider, Typography } from '@mui/material'
import { onAuthStateChanged } from 'firebase/auth'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
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
import type { LessonContent, LessonTemplate } from './lib/lessonTemplates/types'
import type { LearningGoal, WizardAnswers } from './lib/lessonTemplates/guidedBuilderTypes'
import { createLessonTemplate, saveDraft } from './lib/lessonTemplates/repository'
import { publishLessonVersion } from './lib/lessonTemplates/publishLessonVersion'
import { personalOrgId } from './lib/org/personalOrgId'
import { TemplateListPage } from './components/teacher/templates/TemplateListPage'
import { GuidedBuilderWizard } from './components/teacher/templates/GuidedBuilderWizard'
import { TemplateOverviewPage } from './components/teacher/templates/TemplateOverviewPage'
import { TemplateEditorPage } from './components/teacher/templates/TemplateEditorPage'
import { CommunityTemplatesPage } from './components/teacher/templates/CommunityTemplatesPage'
import { listTemplateDerivatives } from './lib/lessonTemplates/templateDerivatives'
import { listCommunityTemplates, type CommunityTemplate } from './lib/lessonTemplates/communityTemplates'
import { duplicateLessonTemplate } from './lib/lessonTemplates/duplicateLessonTemplate'
import { SocialStudiesQuestionStep } from './components/teacher/templates/wizardSteps/socialStudies/QuestionSteps'
import { HomeEconomicsQuestionStep } from './components/teacher/templates/wizardSteps/homeEconomics/QuestionSteps'
import { getTuningConstants, type TuningConstantsResponse } from './lib/platformConfig/getTuningConstants'
import { TuningDashboardPage } from './components/teacher/tuning/TuningDashboardPage'
import { SchoolOrgSettingsPage } from './components/teacher/organizations/SchoolOrgSettingsPage'
import { PlanLimitsPage } from './components/teacher/organizations/PlanLimitsPage'
import { BillingSection } from './components/teacher/organizations/BillingSection'
import { PendingInvitationsBanner } from './components/teacher/organizations/PendingInvitationsBanner'
import { createSchoolOrg } from './lib/organizations/schoolOrg'
import { acceptInvitation, createInvitation, listMyInvitations, type Invitation } from './lib/organizations/invitations'
import { getOrgPlanLimits, type PlanLimitsResult } from './lib/organizations/planLimits'
import { getParentOrgQuotaUsage, getSchoolEffectiveQuota, setSchoolQuotaAllocation, type ParentOrgQuotaUsageResult, type SchoolEffectiveQuotaResult } from './lib/organizations/parentOrgQuota'
import { createStripeCheckoutSession } from './lib/billing/stripeCheckout'
import { createStripeCustomerPortalSession } from './lib/billing/stripeCustomerPortal'
import { getBillingOverview, saveBillingProfile, startInvoiceSubscription, type BillingOverview, type BillingProfileInput } from './lib/billing/invoiceSubscription'
import { ParentOrgSettingsPage } from './components/teacher/organizations/ParentOrgSettingsPage'
import { createParentOrg } from './lib/organizations/parentOrg'
import { linkSchoolToParentOrg, listChildSchools, unlinkSchoolFromParentOrg, type ChildSchool } from './lib/organizations/schoolHierarchy'
import { listOrgMembers, suspendOrgMember, type OrgMember } from './lib/organizations/orgMembers'
import { migrateSchoolFromEndedParent } from './lib/organizations/parentContractMigration'

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

function useTemplateAccess(services: FirebaseServices): AccessStatus {
  const [status, setStatus] = useState<AccessStatus>('LOADING')
  useEffect(() => {
    let cancelled = false
    return onAuthStateChanged(services.auth, (user) => {
      if (!user || !user.emailVerified || !user.providerData.some((provider) => provider.providerId === 'google.com')) {
        if (!cancelled) setStatus('DENIED')
        return
      }
      getDoc(doc(services.firestore, 'organizations', personalOrgId(user.uid), 'members', user.uid))
        .then((snapshot) => { if (!cancelled) setStatus(snapshot.exists() && snapshot.data()?.status === 'active' ? 'GRANTED' : 'DENIED') })
        .catch(() => { if (!cancelled) setStatus('DENIED') })
    })
  }, [services])
  return status
}

function TemplateRouteGuard({ services, children }: { services: FirebaseServices; children: React.JSX.Element }) {
  const access = useTemplateAccess(services)
  if (access === 'LOADING') return <GuardLoading />
  return access === 'GRANTED' ? children : <Navigate replace to="/about" />
}

function TemplateListRoute({ services }: { services: FirebaseServices }) {
  const [templates, setTemplates] = useState<LessonTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [accepting, setAccepting] = useState(false)
  const [invitationError, setInvitationError] = useState<'load' | 'accept'>()
  const navigate = useNavigate()
  const loadInvitations = useCallback(async () => {
    setInvitationError(undefined)
    try {
      setInvitations(await listMyInvitations(services.functions))
    } catch {
      setInvitationError('load')
    }
  }, [services])
  useEffect(() => {
    void loadInvitations()
  }, [loadInvitations])
  useEffect(() => {
    const uid = services.auth.currentUser?.uid
    if (!uid) { setLoading(false); return }
    getDocs(query(collection(services.firestore, 'lessonTemplates'), where('orgId', '==', personalOrgId(uid))))
      .then((snapshot) => setTemplates(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as LessonTemplate)))
      .finally(() => setLoading(false))
  }, [services])
  return (
    <Stack spacing={2}>
      {invitationError && (
        <Alert
          severity="error"
          action={invitationError === 'load' ? (
            <Button color="inherit" size="small" onClick={() => { void loadInvitations() }}>再読み込み</Button>
          ) : undefined}
        >
          {invitationError === 'load'
            ? '招待一覧を読み込めませんでした。もう一度お試しください。'
            : '招待への参加に失敗しました。もう一度お試しください。'}
        </Alert>
      )}
      <PendingInvitationsBanner
        invitations={invitations}
        accepting={accepting}
        onAccept={(invitation) => {
          setAccepting(true)
          setInvitationError(undefined)
          void acceptInvitation(services.functions, { orgId: invitation.orgId, invitationId: invitation.id })
            .then(() => setInvitations((prev) => prev.filter((item) => item.id !== invitation.id)))
            .catch(() => setInvitationError('accept'))
            .finally(() => setAccepting(false))
        }}
      />
      <TemplateListPage templates={templates} loading={loading} onCreateNew={() => navigate('/teacher/templates/new')} onOpen={(id) => navigate(`/teacher/templates/${id}/edit`)} />
    </Stack>
  )
}

function CommunityMarketplaceRoute({ services }: { services: FirebaseServices }) {
  const [templates, setTemplates] = useState<CommunityTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [subject, setSubject] = useState<'SOCIAL_STUDIES' | 'HOME_ECONOMICS' | undefined>(undefined)
  useEffect(() => {
    setLoading(true)
    listCommunityTemplates(services.firestore, { subject }).then(setTemplates).finally(() => setLoading(false))
  }, [services, subject])
  const uid = services.auth.currentUser?.uid
  return <CommunityTemplatesPage
    templates={templates} loading={loading} subject={subject} onSubjectChange={setSubject}
    onDuplicate={(template) => {
      if (!uid) return
      void duplicateLessonTemplate(services.functions, {
        sourceTemplateId: template.id, sourceVersionId: template.currentPublishedVersionId,
        targetOrgId: personalOrgId(uid), confirmedOverrides: {}, idempotencyKey: crypto.randomUUID(),
      })
    }}
  />
}

function TemplateNewRoute({ services }: { services: FirebaseServices }) {
  const navigate = useNavigate()
  const [completed, setCompleted] = useState<{ goal: LearningGoal; answers: Record<string, unknown> }>()
  const [creating, setCreating] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(false)
  useEffect(() => {
    const uid = services.auth.currentUser?.uid
    if (!uid) return
    let cancelled = false
    getDoc(doc(services.firestore, 'organizations', personalOrgId(uid)))
      .then((snapshot) => { if (!cancelled) setAiEnabled(snapshot.exists() && snapshot.data()?.aiEnabled === true) })
      .catch(() => { if (!cancelled) setAiEnabled(false) })
    return () => { cancelled = true }
  }, [services])
  if (!completed) return <GuidedBuilderWizard socialStudiesSteps={[SocialStudiesQuestionStep]} homeEconomicsSteps={[HomeEconomicsQuestionStep]} onComplete={(goal, answers) => setCompleted({ goal, answers })} />
  return <TemplateOverviewPage answers={{ goal: completed.goal, ...completed.answers } as WizardAnswers} creating={creating} functions={services.functions} aiEnabled={aiEnabled} onCreate={async (draft) => {
    const uid = services.auth.currentUser?.uid
    if (!uid) return
    setCreating(true)
    try { navigate(`/teacher/templates/${await createLessonTemplate(services.firestore, uid, draft)}/edit`) } finally { setCreating(false) }
  }} />
}

function TemplateEditRoute({ services }: { services: FirebaseServices }) {
  const { templateId } = useParams<{ templateId: string }>()
  const [draft, setDraft] = useState<LessonContent>()
  const [sourceTemplateTitle, setSourceTemplateTitle] = useState<string>()
  const [derivatives, setDerivatives] = useState<CommunityTemplate[]>([])
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(false)
  const [materialsUploadEnabled, setMaterialsUploadEnabled] = useState(false)
  const uid = services.auth.currentUser?.uid
  useEffect(() => { if (templateId) getDoc(doc(services.firestore, 'lessonTemplates', templateId)).then((snapshot) => { if (snapshot.exists()) { const data = snapshot.data() as LessonTemplate; setDraft(data.draft); setSourceTemplateTitle(data.sourceTemplateTitle) } }) }, [services, templateId])
  useEffect(() => { if (templateId) listTemplateDerivatives(services.firestore, templateId).then(setDerivatives).catch(() => setDerivatives([])) }, [services, templateId])
  useEffect(() => { if (uid) getDoc(doc(services.firestore, 'organizations', personalOrgId(uid))).then((snapshot) => { setAiEnabled(snapshot.exists() && snapshot.data()?.aiEnabled === true); setMaterialsUploadEnabled(snapshot.exists() && snapshot.data()?.materialsUploadEnabled === true) }).catch(() => { setAiEnabled(false); setMaterialsUploadEnabled(false) }) }, [services, uid])
  if (!templateId || !draft) return <GuardLoading />
  return <TemplateEditorPage draft={draft} templateId={templateId} orgId={personalOrgId(uid ?? '')} storage={services.storage} firestore={services.firestore} functions={services.functions} aiEnabled={aiEnabled} materialsUploadEnabled={materialsUploadEnabled} saving={saving} publishing={publishing} sourceTemplateTitle={sourceTemplateTitle} derivatives={derivatives} onSaveDraft={async (content) => { setSaving(true); try { await saveDraft(services.firestore, templateId, content); setDraft(content) } finally { setSaving(false) } }} onPublish={async () => { setPublishing(true); try { await publishLessonVersion(services.functions, { templateId, idempotencyKey: crypto.randomUUID() }) } finally { setPublishing(false) } }} />
}

function SchoolOrgNewRoute({ services }: { services: FirebaseServices }) {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()
  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography variant="h5" component="h1">学校組織を作成</Typography>
      <TextField label="組織名" value={name} onChange={(e) => setName(e.target.value)} />
      <Button
        variant="contained"
        disabled={creating || !name}
        sx={{ alignSelf: 'flex-start' }}
        onClick={async () => {
          setCreating(true)
          try {
            const { orgId } = await createSchoolOrg(services.functions, { name })
            navigate(`/teacher/organizations/${orgId}/settings`)
          } finally {
            setCreating(false)
          }
        }}
      >
        作成する
      </Button>
    </Stack>
  )
}

function SchoolOrgSettingsRoute({ services }: { services: FirebaseServices }) {
  const { orgId } = useParams<{ orgId: string }>()
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [inviting, setInviting] = useState(false)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [teacherSeatLimit, setTeacherSeatLimit] = useState<number>()
  const [suspending, setSuspending] = useState(false)
  const [parentOrgId, setParentOrgId] = useState<string | null>(null)
  const uid = services.auth.currentUser?.uid

  const loadMembers = useCallback(() => {
    if (!orgId) return
    void listOrgMembers(services.functions, { orgId }).then(setMembers).catch(() => setMembers([]))
  }, [orgId, services.functions])

  useEffect(() => { loadMembers() }, [loadMembers])
  useEffect(() => {
    if (!orgId) return
    void getOrgPlanLimits(services.functions, { orgId })
      .then((limits) => setTeacherSeatLimit(limits.teacherSeats))
      .catch(() => setTeacherSeatLimit(undefined))
  }, [orgId, services.functions])
  useEffect(() => {
    if (!orgId) return
    void getDoc(doc(services.firestore, 'organizations', orgId)).then((snapshot) => setParentOrgId(snapshot.exists() ? ((snapshot.data().parentOrgId as string | undefined) ?? null) : null))
  }, [orgId, services.firestore])

  if (!orgId || !uid) return <GuardLoading />
  const viewerMembership = members.find((member) => member.uid === uid)
  const canManageMembers = viewerMembership?.role === 'owner' || viewerMembership?.role === 'admin'

  return (
    <SchoolOrgSettingsPage
      orgName={orgId}
      orgId={orgId}
      invitations={invitations}
      inviting={inviting}
      members={members}
      viewerUid={uid}
      canManageMembers={canManageMembers}
      suspending={suspending}
      teacherSeatLimit={teacherSeatLimit}
      parentOrgName={parentOrgId}
      onSuspendMember={(targetUid) => {
        setSuspending(true)
        void suspendOrgMember(services.functions, { orgId, uid: targetUid })
          .then(loadMembers)
          .finally(() => setSuspending(false))
      }}
      onInvite={async (email, role) => {
        setInviting(true)
        try {
          const { invitationId } = await createInvitation(services.functions, { orgId, email, role })
          setInvitations((prev) => [...prev, { id: invitationId, orgId, email, role, status: 'PENDING', invitedByUid: '', createdAt: null }])
        } finally {
          setInviting(false)
        }
      }}
    />
  )
}

function ParentOrgNewRoute({ services }: { services: FirebaseServices }) {
  const [name, setName] = useState(''); const [creating, setCreating] = useState(false); const navigate = useNavigate()
  return <Stack spacing={2} sx={{ p: 2 }}><Typography variant="h5" component="h1">上位組織を作成</Typography><TextField label="組織名" value={name} onChange={(e) => setName(e.target.value)} /><Button variant="contained" disabled={creating || !name} sx={{ alignSelf: 'flex-start' }} onClick={async () => { setCreating(true); try { const { orgId } = await createParentOrg(services.functions, { name }); navigate(`/teacher/organizations/${orgId}/parent-settings`) } finally { setCreating(false) } }}>作成する</Button></Stack>
}
function ParentOrgSettingsRoute({ services }: { services: FirebaseServices }) {
  const { orgId } = useParams<{ orgId: string }>()
  const [childSchools, setChildSchools] = useState<ChildSchool[]>([])
  const [quotaUsage, setQuotaUsage] = useState<ParentOrgQuotaUsageResult>()
  const [members, setMembers] = useState<OrgMember[]>([])
  const [linking, setLinking] = useState(false)
  const [unlinking, setUnlinking] = useState(false)
  const [settingAllocation, setSettingAllocation] = useState(false)
  const uid = services.auth.currentUser?.uid

  const loadChildren = useCallback(() => {
    if (!orgId) return
    void listChildSchools(services.functions, { parentOrgId: orgId }).then(setChildSchools).catch(() => setChildSchools([]))
    void getParentOrgQuotaUsage(services.functions, { parentOrgId: orgId }).then((usage) => {
      if (usage && typeof usage === 'object' && Array.isArray(usage.schools)) setQuotaUsage(usage)
      else setQuotaUsage(undefined)
    }).catch(() => setQuotaUsage(undefined))
    void listOrgMembers(services.functions, { orgId }).then((value) => setMembers(Array.isArray(value) ? value : [])).catch(() => setMembers([]))
  }, [orgId, services.functions])

  useEffect(() => { loadChildren() }, [loadChildren])
  if (!orgId || !uid) return <GuardLoading />
  const viewerMembership = members.find((member) => member.uid === uid)
  const canManageAllocations = viewerMembership?.role === 'owner' || viewerMembership?.role === 'admin'

  return <ParentOrgSettingsPage
    orgName={orgId}
    childSchools={childSchools}
    quotaUsage={quotaUsage}
    canEditAllocations={canManageAllocations}
    settingAllocation={settingAllocation}
    onSetSchoolQuotaAllocation={(input) => {
      setSettingAllocation(true)
      void setSchoolQuotaAllocation(services.functions, input).then(loadChildren).finally(() => setSettingAllocation(false))
    }}
    linking={linking}
    unlinking={unlinking}
    onLinkSchool={(schoolOrgId) => { setLinking(true); void linkSchoolToParentOrg(services.functions, { parentOrgId: orgId, schoolOrgId }).then(loadChildren).finally(() => setLinking(false)) }}
    onUnlinkSchool={(schoolOrgId) => { setUnlinking(true); void unlinkSchoolFromParentOrg(services.functions, { schoolOrgId }).then(loadChildren).finally(() => setUnlinking(false)) }}
  />
}

function PlanLimitsRoute({ services }: { services: FirebaseServices }) {
  const { orgId } = useParams<{ orgId: string }>()
  const [data, setData] = useState<PlanLimitsResult>()
  const [schoolEffectiveQuota, setSchoolEffectiveQuota] = useState<SchoolEffectiveQuotaResult>()
  const [orgType, setOrgType] = useState<string>()
  const [organizationStateOrgId, setOrganizationStateOrgId] = useState<string>()
  const [error, setError] = useState<string>()
  const [checkingOut, setCheckingOut] = useState(false)
  const [managingBilling, setManagingBilling] = useState(false)
  const [stripeCustomerId, setStripeCustomerId] = useState<string | null>(null)
  const [parentContractState, setParentContractState] = useState<'ACTIVE' | 'ENDED'>()
  const [schoolSubscriptionState, setSchoolSubscriptionState] = useState<{ status: string } | null>()
  const [canManageContract, setCanManageContract] = useState(false)
  const [billingManagerOrgId, setBillingManagerOrgId] = useState<string>()
  const [migratingFromEndedParent, setMigratingFromEndedParent] = useState(false)
  const [migrationMessage, setMigrationMessage] = useState<string>()
  const [organizationReload, setOrganizationReload] = useState(0)
  const [planReload, setPlanReload] = useState(0)
  const [billingReload, setBillingReload] = useState(0)
  const [billingOverview, setBillingOverview] = useState<BillingOverview>()
  const [billingOverviewLoaded, setBillingOverviewLoaded] = useState(false)
  const [billingError, setBillingError] = useState<string>()
  const [savingBillingProfile, setSavingBillingProfile] = useState(false)
  const [startingInvoiceBilling, setStartingInvoiceBilling] = useState(false)
  useEffect(() => {
    let cancelled = false
    if (!orgId) return
    setError(undefined)
    getOrgPlanLimits(services.functions, { orgId })
      .then((limits) => { if (!cancelled) setData(limits) })
      .catch(() => { if (!cancelled) setError('failed') })
    return () => { cancelled = true }
  }, [services, orgId, planReload])
  useEffect(() => {
    let cancelled = false
    setStripeCustomerId(null)
    setSchoolEffectiveQuota(undefined)
    setOrgType(undefined)
    setOrganizationStateOrgId(undefined)
    setParentContractState(undefined)
    setSchoolSubscriptionState(undefined)
    setCanManageContract(false)
    setBillingManagerOrgId(undefined)
    if (!orgId) return () => { cancelled = true }
    void getDoc(doc(services.firestore, 'organizations', orgId)).then((snapshot) => {
      if (cancelled || !snapshot.exists()) return
      const organization = snapshot.data()
      const type = organization.type as string | undefined
      setOrgType(type)
      setOrganizationStateOrgId(orgId)
      if (type !== 'parentOrg') {
        setStripeCustomerId((organization.stripeCustomerId as string | undefined) ?? null)
        const subscription = organization.stripeSubscriptionState
        setSchoolSubscriptionState(subscription && typeof subscription === 'object' && typeof (subscription as { status?: unknown }).status === 'string'
          ? { status: (subscription as { status: string }).status }
          : null)
      }
      if (type === 'school') {
        void listOrgMembers(services.functions, { orgId }).then((members) => {
          if (!cancelled) {
            const membership = members.find((member) => member.uid === services.auth.currentUser?.uid)
            const canManage = membership?.status === 'active' && (membership.role === 'owner' || membership.role === 'admin')
            setCanManageContract(canManage)
            setBillingManagerOrgId(canManage ? orgId : undefined)
          }
        }).catch(() => {
          if (!cancelled) {
            setCanManageContract(false)
            setBillingManagerOrgId(undefined)
          }
        })
        if (typeof organization.parentOrgId === 'string' && organization.parentOrgId.length > 0) {
          void getSchoolEffectiveQuota(services.functions, { schoolOrgId: orgId }).then((quota) => {
            if (!cancelled) {
              setSchoolEffectiveQuota(quota)
              setParentContractState(quota.parentContractState)
            }
          }).catch(() => {
            if (!cancelled) setSchoolEffectiveQuota(undefined)
          })
        }
      }
    }).catch(() => {
      if (!cancelled) setStripeCustomerId(null)
    })
    return () => { cancelled = true }
  }, [services, orgId, organizationReload])
  const currentOrgType = organizationStateOrgId === orgId ? orgType : undefined
  const canManageCurrentOrg = billingManagerOrgId === orgId && canManageContract
  useEffect(() => {
    let cancelled = false
    setBillingOverview(undefined)
    setBillingOverviewLoaded(false)
    setBillingError(undefined)
    if (!orgId || currentOrgType !== 'school' || !canManageCurrentOrg) return () => { cancelled = true }
    void getBillingOverview(services.functions, { orgId }).then((overview) => {
      if (!cancelled) {
        setBillingOverview(overview)
        setBillingOverviewLoaded(true)
      }
    }).catch(() => {
      if (!cancelled) {
        setBillingError('請求情報を読み込めませんでした。もう一度お試しください。')
        setBillingOverviewLoaded(true)
      }
    })
    return () => { cancelled = true }
  }, [services, orgId, currentOrgType, canManageCurrentOrg, billingReload])
  const refreshBillingAndPlan = () => {
    setBillingReload((value) => value + 1)
    setPlanReload((value) => value + 1)
  }
  const onSaveBillingProfile = (orgId && currentOrgType === 'school' && canManageCurrentOrg) ? (profile: BillingProfileInput) => {
    if (savingBillingProfile) return
    setSavingBillingProfile(true)
    setBillingError(undefined)
    void saveBillingProfile(services.functions, { orgId, profile })
      .then(refreshBillingAndPlan)
      .catch(() => setBillingError('請求先プロフィールの保存に失敗しました。もう一度お試しください。'))
      .finally(() => setSavingBillingProfile(false))
  } : undefined
  const onStartInvoiceBilling = (orgId && currentOrgType === 'school' && canManageCurrentOrg) ? () => {
    if (startingInvoiceBilling) return
    setStartingInvoiceBilling(true)
    setBillingError(undefined)
    void startInvoiceSubscription(services.functions, { orgId })
      .then(refreshBillingAndPlan)
      .catch(() => setBillingError('請求書払いの申込に失敗しました。もう一度お試しください。'))
      .finally(() => setStartingInvoiceBilling(false))
  } : undefined
  const canStartCardCheckout = currentOrgType === 'school'
    ? canManageCurrentOrg && billingOverviewLoaded && billingOverview?.invoiceSubscription == null
    : currentOrgType !== 'parentOrg'
  const onCheckout = (orgId && canStartCardCheckout) ? () => { setCheckingOut(true); void createStripeCheckoutSession(services.functions, { orgId, planId: 'SCHOOL', successUrl: `${window.location.origin}/teacher/organizations/${orgId}/plan-limits`, cancelUrl: `${window.location.origin}/teacher/organizations/${orgId}/plan-limits` }).then(({ url }) => window.location.assign(url)).finally(() => setCheckingOut(false)) } : undefined
  const hasPersonalCardSubscription = currentOrgType === 'personal'
    && orgId === personalOrgId(services.auth.currentUser?.uid ?? '')
    && schoolSubscriptionState?.status === 'active'
  const hasSchoolCardSubscription = currentOrgType === 'school'
    && canManageCurrentOrg
    && billingOverview?.paymentMethod === 'CARD'
  const onManageBilling = (orgId && stripeCustomerId && (hasPersonalCardSubscription || hasSchoolCardSubscription)) ? () => { setManagingBilling(true); void createStripeCustomerPortalSession(services.functions, { orgId, returnUrl: `${window.location.origin}/teacher/organizations/${orgId}/plan-limits` }).then(({ url }) => window.location.assign(url)).finally(() => setManagingBilling(false)) } : undefined
  const onMigrateFromEndedParent = (orgId && currentOrgType === 'school' && parentContractState === 'ENDED') ? () => {
    setMigratingFromEndedParent(true)
    setMigrationMessage(undefined)
    void migrateSchoolFromEndedParent(services.functions, { schoolOrgId: orgId }).then((result) => {
      if (result.status === 'RETRY_REQUIRED') setMigrationMessage(`共有枠の予約を${result.deletedReservationCount}件整理しました。もう一度実行してください。`)
      else {
        setSchoolEffectiveQuota(undefined)
        setMigrationMessage('学校を単独契約へ移行しました。')
        setOrganizationReload((value) => value + 1)
      }
    }).catch(() => setMigrationMessage('移行に失敗しました。状態を確認してもう一度実行してください。')).finally(() => setMigratingFromEndedParent(false))
  } : undefined
  const billingSection = currentOrgType === 'school' && canManageCurrentOrg && billingOverviewLoaded && onSaveBillingProfile && onStartInvoiceBilling
    ? <BillingSection
      canManageBilling
      overview={billingOverview}
      onSaveProfile={onSaveBillingProfile}
      onStartInvoiceSubscription={onStartInvoiceBilling}
      savingProfile={savingBillingProfile}
      startingInvoiceSubscription={startingInvoiceBilling}
      error={billingError}
    />
    : undefined
  return <PlanLimitsPage data={data} error={error} billingSection={billingSection} schoolEffectiveQuota={schoolEffectiveQuota} parentContractState={parentContractState} schoolSubscriptionState={schoolSubscriptionState} canManageContract={canManageCurrentOrg} onMigrateFromEndedParent={onMigrateFromEndedParent} migratingFromEndedParent={migratingFromEndedParent} migrationMessage={migrationMessage} onCheckout={onCheckout} checkingOut={checkingOut} onManageBilling={onManageBilling} managingBilling={managingBilling} />
}

function TuningDashboardRoute({ services }: { services: FirebaseServices }) {
  const [data, setData] = useState<TuningConstantsResponse>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let cancelled = false
    getTuningConstants(services.functions)
      .then((response) => { if (!cancelled) setData(response) })
      .catch(() => { if (!cancelled) setError('failed') })
    return () => { cancelled = true }
  }, [services])
  return <TuningDashboardPage data={data} error={error} />
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
  <Route path="/teacher/templates" element={enabled && services ? <TemplateRouteGuard services={services}><TemplateListRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
  <Route path="/teacher/templates/new" element={enabled && services ? <TemplateRouteGuard services={services}><TemplateNewRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
  <Route path="/teacher/templates/:templateId/edit" element={enabled && services ? <TemplateRouteGuard services={services}><TemplateEditRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
  <Route path="/teacher/marketplace" element={enabled && services ? <TemplateRouteGuard services={services}><CommunityMarketplaceRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
  <Route path="/teacher/organizations/new" element={enabled && services ? <TemplateRouteGuard services={services}><SchoolOrgNewRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
  <Route path="/teacher/organizations/new-parent" element={enabled && services ? <TemplateRouteGuard services={services}><ParentOrgNewRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
  <Route path="/teacher/organizations/:orgId/settings" element={enabled && services ? <TemplateRouteGuard services={services}><SchoolOrgSettingsRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
  <Route path="/teacher/organizations/:orgId/plan-limits" element={enabled && services ? <TemplateRouteGuard services={services}><PlanLimitsRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
  <Route path="/teacher/organizations/:orgId/parent-settings" element={enabled && services ? <TemplateRouteGuard services={services}><ParentOrgSettingsRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
  <Route path="/teacher/tuning" element={enabled && services ? <TemplateRouteGuard services={services}><TuningDashboardRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
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
