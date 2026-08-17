import { useCallback, useEffect, useMemo, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { Alert, Button, CircularProgress, CssBaseline, Stack, TextField, ThemeProvider, Typography } from '@mui/material'
import { onAuthStateChanged } from 'firebase/auth'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { onValue, ref } from 'firebase/database'
import { appTheme } from './theme/theme'
import { AboutPage, ContactPage, GuidePage, PrivacyPage, TermsPage } from './components/PublicDocs'
import { LandingPage } from './components/LandingPage'
import { NotFoundPage } from './components/ui/NotFoundPage'
import { bootstrapFirebase, type FirebaseServices } from './lib/firebase/bootstrap'
import { isLessonPlatformV2Enabled as isLessonPlatformV2EnabledDefault } from './lib/features/lessonPlatformV2'
import { getOrCreateStudentUid } from './lib/auth/studentAuth'
import type { LessonRunRole } from './lib/lessonRuns/authorization'
import { LessonJoinPage } from './components/student/LessonJoinPage'
import { LessonControlRoom } from './components/teacher/LessonControlRoom'
import { TeacherHomePage } from './components/teacher/TeacherHomePage'
import { ClassroomDisplayPage } from './components/display/ClassroomDisplayPage'
import { HouseholdTeamScreen } from './components/homeEconomics/HouseholdTeamScreen'
import { subscribeOwnTeamState } from './lib/lessonRuns/liveRepository'
import type { LessonContent, LessonTemplate } from './lib/lessonTemplates/types'
import type { LearningGoal, WizardAnswers } from './lib/lessonTemplates/guidedBuilderTypes'
import { createLessonTemplate, saveDraft } from './lib/lessonTemplates/repository'
import { publishLessonVersion } from './lib/lessonTemplates/publishLessonVersion'
import { useAiBetaAccess } from './hooks/useAiBetaAccess'
import { personalOrgId } from './lib/org/personalOrgId'
import { TemplateListPage } from './components/teacher/templates/TemplateListPage'
import { GuidedBuilderWizard } from './components/teacher/templates/GuidedBuilderWizard'
import { TemplateOverviewPage } from './components/teacher/templates/TemplateOverviewPage'
import { TemplateEditorPage } from './components/teacher/templates/TemplateEditorPage'
import { StartLessonDialog } from './components/teacher/templates/StartLessonDialog'
import { createLessonRun } from './lib/lessonRuns/createLessonRun'
import { describeError } from './lib/monitoring/describeError'
import { CommunityTemplatesPage } from './components/teacher/templates/CommunityTemplatesPage'
import { OperatorReportsPage } from './components/operator/OperatorReportsPage'
import { OperatorTemplateCertificationsPage } from './components/operator/OperatorTemplateCertificationsPage'
import { OperatorAiBetaAccessPage } from './components/operator/OperatorAiBetaAccessPage'
import {
  grantAiBetaAccess,
  listAiBetaAccess,
  revokeAiBetaAccess,
  type AiBetaAccessListItem,
} from './lib/ai/betaAccess'
import { CommunityTemplateDetailPage, type CommunityTemplateDetailPageProps } from './components/teacher/templates/CommunityTemplateDetailPage'
import { canReviewTemplate, listTemplateReviews as listTemplateReviewsClient, submitTemplateReview as submitTemplateReviewClient, type TemplateReview } from './lib/lessonTemplates/templateReviews'
import { listPendingTemplateReports, resolveTemplateReport, type PendingTemplateReport } from './lib/lessonTemplates/moderationQueue'
import { listTemplateCertificationCandidates, setTemplateCertification, type CertificationCandidate } from './lib/lessonTemplates/templateCertification'
import { listTemplateDerivatives } from './lib/lessonTemplates/templateDerivatives'
import { listCommunityTemplates, type CommunityTemplate } from './lib/lessonTemplates/communityTemplates'
import { duplicateLessonTemplate } from './lib/lessonTemplates/duplicateLessonTemplate'
import { reportTemplate } from './lib/lessonTemplates/reportTemplate'
import { SocialStudiesQuestionStep } from './components/teacher/templates/wizardSteps/socialStudies/QuestionSteps'
import { HomeEconomicsQuestionStep } from './components/teacher/templates/wizardSteps/homeEconomics/QuestionSteps'
import { getTuningConstants, type TuningConstantsResponse } from './lib/platformConfig/getTuningConstants'
import { TuningDashboardPage } from './components/teacher/tuning/TuningDashboardPage'
import { SchoolOrgSettingsPage } from './components/teacher/organizations/SchoolOrgSettingsPage'
import { PlanLimitsPage } from './components/teacher/organizations/PlanLimitsPage'
import { UsageDashboardPage } from './components/teacher/organizations/UsageDashboardPage'
import { exportOrgStudentData, downloadAsJsonFile } from './lib/privacy/orgStudentDataExport'
import { searchOrgStudentData, type OrgStudentDataSearchResult, type OrgStudentSearchField } from './lib/privacy/orgStudentDataSearch'
import { listOrgAuditLog, type OrgAuditLogEntry } from './lib/privacy/orgAuditLog'
import { purgeSchoolOrg } from './lib/privacy/purgeSchoolOrg'
import {
  cancelAnnualArchive,
  listAnnualArchiveJobs,
  previewAnnualArchive,
  scheduleAnnualArchive,
  type AnnualArchiveJob,
  type PreviewAnnualArchiveResult,
} from './lib/privacy/annualArchive'
import { TemplateApprovalsPage } from './components/teacher/organizations/TemplateApprovalsPage'
import { listPendingTemplateApprovals, reviewTemplateApproval, type PendingTemplateApproval } from './lib/lessonTemplates/templateApprovals'
import { BillingSection } from './components/teacher/organizations/BillingSection'
import { PendingInvitationsBanner } from './components/teacher/organizations/PendingInvitationsBanner'
import { createSchoolOrg } from './lib/organizations/schoolOrg'
import { acceptInvitation, createInvitation, listMyInvitations, listOrgInvitations, revokeInvitation, type Invitation } from './lib/organizations/invitations'
import { setStudentDataRetentionDays } from './lib/organizations/studentDataRetentionPolicy'
import { getOrgPlanLimits, type PlanLimitsResult } from './lib/organizations/planLimits'
import { getOrgUsageDashboard, type OrgUsageDashboard } from './lib/organizations/usageDashboard'
import { getParentOrgQuotaUsage, getSchoolEffectiveQuota, setSchoolQuotaAllocation, type ParentOrgQuotaUsageResult, type SchoolEffectiveQuotaResult } from './lib/organizations/parentOrgQuota'
import { createStripeCheckoutSession } from './lib/billing/stripeCheckout'
import { createStripeCustomerPortalSession } from './lib/billing/stripeCustomerPortal'
import { getBillingOverview, saveBillingProfile, startInvoiceSubscription, type BillingOverview, type BillingProfileInput } from './lib/billing/invoiceSubscription'
import { ParentOrgSettingsPage } from './components/teacher/organizations/ParentOrgSettingsPage'
import { createParentOrg } from './lib/organizations/parentOrg'
import { linkSchoolToParentOrg, listChildSchools, unlinkSchoolFromParentOrg, type ChildSchool } from './lib/organizations/schoolHierarchy'
import { changeOrgMemberRole, listOrgMembers, suspendOrgMember, type OrgMember } from './lib/organizations/orgMembers'

import { migrateSchoolFromEndedParent } from './lib/organizations/parentContractMigration'

const docPages: Record<string, () => React.JSX.Element> = {
  '/about': AboutPage,
  '/guide': GuidePage,
  '/terms': TermsPage,
  '/privacy': PrivacyPage,
  '/contact': ContactPage,
}


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
interface TeacherAccess {
  status: AccessStatus
  role?: LessonRunRole
  subject?: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS'
  homeEconomicsCourseFormat?: string
}
interface StudentAccess { status: AccessStatus; teamId?: string; participantId?: string }

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
          const data = snapshot.data() as {
            teacherRoles?: Record<string, LessonRunRole>
            subject?: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS'
            templateSnapshot?: { homeEconomics?: { courseFormat?: string } }
          }
          const role = data.teacherRoles?.[user.uid]
          const subject = data.subject
          const homeEconomicsCourseFormat = data.templateSnapshot?.homeEconomics?.courseFormat
          setAccess(
            role
              ? { status: 'GRANTED', role, subject, homeEconomicsCourseFormat }
              : { status: 'DENIED' },
          )
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
            const value = snapshot.val() as { access?: string; teamId?: string; participantId?: string } | null
            setAccess(value?.access === 'ACTIVE' ? { status: 'GRANTED', teamId: value.teamId, participantId: value.participantId } : { status: 'DENIED' })
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
    subject={access.subject}
    homeEconomicsCourseFormat={access.homeEconomicsCourseFormat}
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

function TeacherHomeRoute(_props: { services: FirebaseServices }) {
  const navigate = useNavigate()
  return <TeacherHomePage onOpenTemplates={() => navigate('/teacher/templates')} onOpenMarketplace={() => navigate('/teacher/marketplace')} />
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
  const navigate = useNavigate()
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
    onReport={(template, reason, details) => {
      void reportTemplate(services.functions, { templateId: template.id, versionId: template.currentPublishedVersionId, reason, details: details || undefined })
    }}
    onOpenDetail={(template) => navigate(`/teacher/marketplace/${template.id}`)}
  />
}

function CommunityTemplateDetailRoute({ services }: { services: FirebaseServices }) {
  const { templateId } = useParams<{ templateId: string }>()
  const [template, setTemplate] = useState<CommunityTemplateDetailPageProps['template']>()
  const [reviews, setReviews] = useState<TemplateReview[]>([])
  const [eligible, setEligible] = useState(false)
  const [loading, setLoading] = useState(true)
  const load = () => {
    if (!templateId) return
    setLoading(true)
    getDoc(doc(services.firestore, 'lessonTemplates', templateId)).then((snapshot) => {
      if (!snapshot.exists()) return
      const data = snapshot.data() as CommunityTemplateDetailPageProps['template']
      setTemplate(data)
      void listTemplateReviewsClient(services.functions, { templateId, versionId: data.currentPublishedVersionId }).then(setReviews)
      void canReviewTemplate(services.functions, { templateId, versionId: data.currentPublishedVersionId }).then((result) => setEligible(result.eligible))
    }).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [services, templateId])
  if (!template) return <GuardLoading />
  return <CommunityTemplateDetailPage
    template={template} reviews={reviews} loading={loading} eligible={eligible}
    onSubmitReview={(input) => {
      if (!templateId) return
      void submitTemplateReviewClient(services.functions, { templateId, versionId: template.currentPublishedVersionId, ...input }).then(load)
    }}
  />
}

function OperatorReportsRoute({ services }: { services: FirebaseServices }) {
  const navigate = useNavigate()
  const [reports, setReports] = useState<PendingTemplateReport[]>([])
  const [loading, setLoading] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)
  const load = () => {
    setLoading(true)
    listPendingTemplateReports(services.functions)
      .then((result) => { setReports(result); setAccessDenied(false) })
      .catch(() => setAccessDenied(true))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [services])
  return <OperatorReportsPage
    reports={reports} loading={loading} accessDenied={accessDenied}
    onUnpublish={(report) => { void resolveTemplateReport(services.functions, { reportId: report.id, action: 'UNPUBLISH' }).then(load) }}
    onDismiss={(report) => { void resolveTemplateReport(services.functions, { reportId: report.id, action: 'DISMISS' }).then(load) }}
    onNavigateToCertifications={() => navigate('/operator/certifications')}
    onNavigateToAiBeta={() => navigate('/operator/ai-beta')}
  />
}

function OperatorCertificationsRoute({ services }: { services: FirebaseServices }) {
  const navigate = useNavigate()
  const [candidates, setCandidates] = useState<CertificationCandidate[]>([])
  const [loading, setLoading] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)

  const load = () => {
    setLoading(true)
    listTemplateCertificationCandidates(services.functions)
      .then((result) => {
        setCandidates(result)
        setAccessDenied(false)
      })
      .catch(() => setAccessDenied(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [services])

  const handleSetCertification = async (
    candidate: CertificationCandidate,
    level: 'COMMUNITY' | 'VERIFIED' | 'OFFICIAL',
    reason: string,
  ) => {
    await setTemplateCertification(services.functions, {
      templateId: candidate.templateId,
      versionId: candidate.currentPublishedVersionId,
      level,
      reason,
      idempotencyKey: crypto.randomUUID(),
    })
    load()
  }

  return (
    <OperatorTemplateCertificationsPage
      candidates={candidates}
      loading={loading}
      accessDenied={accessDenied}
      onSetCertification={handleSetCertification}
      onNavigateToReports={() => navigate('/operator/reports')}
      onNavigateToAiBeta={() => navigate('/operator/ai-beta')}
    />
  )
}

function OperatorAiBetaAccessRoute({ services }: { services: FirebaseServices }) {
  const navigate = useNavigate()
  const [items, setItems] = useState<AiBetaAccessListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [mutating, setMutating] = useState(false)
  const [accessDenied, setAccessDenied] = useState(false)
  const [error, setError] = useState<string>()

  const load = () => {
    setLoading(true)
    setError(undefined)
    listAiBetaAccess(services.functions)
      .then((result) => {
        setItems(result)
        setAccessDenied(false)
      })
      .catch((err: any) => {
        if (
          err?.code === 'permission-denied' ||
          err?.message?.includes('permission-denied') ||
          err?.message?.includes('運営者')
        ) {
          setAccessDenied(true)
        } else {
          setError(err instanceof Error ? err.message : 'アクセス情報の取得に失敗しました。')
        }
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [services])

  const handleGrant = async (email: string, reason: string) => {
    setMutating(true)
    try {
      await grantAiBetaAccess(services.functions, {
        email,
        reason,
        idempotencyKey: crypto.randomUUID(),
      })
      load()
    } finally {
      setMutating(false)
    }
  }

  const handleRevoke = async (teacherUid: string, reason: string) => {
    setMutating(true)
    try {
      await revokeAiBetaAccess(services.functions, {
        teacherUid,
        reason,
        idempotencyKey: crypto.randomUUID(),
      })
      load()
    } finally {
      setMutating(false)
    }
  }

  return (
    <OperatorAiBetaAccessPage
      items={items}
      loading={loading}
      mutating={mutating}
      accessDenied={accessDenied}
      error={error}
      onGrant={handleGrant}
      onRevoke={handleRevoke}
      onNavigateToReports={() => navigate('/operator/reports')}
      onNavigateToCertifications={() => navigate('/operator/certifications')}
    />
  )
}

function TemplateNewRoute({ services }: { services: FirebaseServices }) {
  const navigate = useNavigate()
  const aiBetaState = useAiBetaAccess(services.functions)
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
  return <TemplateOverviewPage answers={{ goal: completed.goal, ...completed.answers } as WizardAnswers} creating={creating} functions={services.functions} aiEnabled={aiEnabled} aiBetaState={aiBetaState} onCreate={async (draft) => {
    const uid = services.auth.currentUser?.uid
    if (!uid) return
    setCreating(true)
    try { navigate(`/teacher/templates/${await createLessonTemplate(services.firestore, uid, draft)}/edit`) } finally { setCreating(false) }
  }} />
}

function TemplateEditRoute({ services }: { services: FirebaseServices }) {
  const { templateId } = useParams<{ templateId: string }>()
  const aiBetaState = useAiBetaAccess(services.functions)
  const [template, setTemplate] = useState<LessonTemplate>()
  const [draft, setDraft] = useState<LessonContent>()
  const [sourceTemplateTitle, setSourceTemplateTitle] = useState<string>()
  const [derivatives, setDerivatives] = useState<CommunityTemplate[]>([])
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [startDialogOpen, setStartDialogOpen] = useState(false)
  const [startingLesson, setStartingLesson] = useState(false)
  const [startLessonError, setStartLessonError] = useState<string>()
  const [aiEnabled, setAiEnabled] = useState(false)
  const [materialsUploadEnabled, setMaterialsUploadEnabled] = useState(false)
  const navigate = useNavigate()
  const uid = services.auth.currentUser?.uid

  const loadTemplate = useCallback(() => {
    if (!templateId) return
    getDoc(doc(services.firestore, 'lessonTemplates', templateId)).then((snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as LessonTemplate
        setTemplate(data)
        setDraft(data.draft)
        setSourceTemplateTitle(data.sourceTemplateTitle)
      }
    })
  }, [services, templateId])

  useEffect(() => { loadTemplate() }, [loadTemplate])
  useEffect(() => { if (templateId) listTemplateDerivatives(services.firestore, templateId).then(setDerivatives).catch(() => setDerivatives([])) }, [services, templateId])

  const targetOrgId = template?.orgId || (uid ? personalOrgId(uid) : '')
  useEffect(() => {
    if (!targetOrgId) return
    let cancelled = false
    getDoc(doc(services.firestore, 'organizations', targetOrgId)).then((snapshot) => {
      if (!cancelled) {
        setAiEnabled(snapshot.exists() && snapshot.data()?.aiEnabled === true)
        setMaterialsUploadEnabled(snapshot.exists() && snapshot.data()?.materialsUploadEnabled === true)
      }
    }).catch(() => {
      if (!cancelled) {
        setAiEnabled(false)
        setMaterialsUploadEnabled(false)
      }
    })
    return () => { cancelled = true }
  }, [services, targetOrgId])

  const handleStartLesson = async (expectedParticipants: number) => {
    if (!templateId) return
    setStartingLesson(true)
    setStartLessonError(undefined)
    try {
      const { lessonRunId } = await createLessonRun(services.functions, {
        templateId,
        lessonRunIdempotencyKey: crypto.randomUUID(),
        expectedParticipants,
      })
      navigate(`/teacher/lessons/${lessonRunId}/control`)
    } catch (error) {
      setStartLessonError(describeError(error, '授業の開始に失敗しました。もう一度お試しください。'))
    } finally {
      setStartingLesson(false)
    }
  }

  if (!templateId || !draft || !template) return <GuardLoading />
  return (
    <>
      <TemplateEditorPage
        draft={draft}
        templateId={templateId}
        orgId={template.orgId}
        storage={services.storage}
        firestore={services.firestore}
        functions={services.functions}
        aiEnabled={aiEnabled}
        materialsUploadEnabled={materialsUploadEnabled}
        aiBetaState={aiBetaState}
        saving={saving}
        publishing={publishing}
        sourceTemplateTitle={sourceTemplateTitle}
        derivatives={derivatives}
        moveOperationId={template.moveOperationId}
        onReloadTemplate={loadTemplate}
        onSaveDraft={async (content) => {
          setSaving(true)
          try {
            await saveDraft(services.firestore, templateId, content)
            setDraft(content)
          } finally {
            setSaving(false)
          }
        }}
        onPublish={async () => {
          setPublishing(true)
          try {
            await publishLessonVersion(services.functions, { templateId, idempotencyKey: crypto.randomUUID() })
            await loadTemplate()
          } finally {
            setPublishing(false)
          }
        }}
      />
      {template.currentPublishedVersionId && (
        <Button variant="contained" color="secondary" onClick={() => setStartDialogOpen(true)} sx={{ m: 2 }}>
          この教材で授業を開始
        </Button>
      )}
      <StartLessonDialog
        open={startDialogOpen}
        onClose={() => setStartDialogOpen(false)}
        onStart={(expectedParticipants) => { void handleStartLesson(expectedParticipants) }}
        starting={startingLesson}
        error={startLessonError}
      />
    </>
  )
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
  const [exportingStudentData, setExportingStudentData] = useState(false)
  const [auditLogEntries, setAuditLogEntries] = useState<OrgAuditLogEntry[]>([])
  const [loadingAuditLog, setLoadingAuditLog] = useState(false)
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [inviting, setInviting] = useState(false)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [teacherSeatLimit, setTeacherSeatLimit] = useState<number>()
  const [suspending, setSuspending] = useState(false)
  const [parentOrgId, setParentOrgId] = useState<string | null>(null)
  const [studentDataRetentionDays, setStudentDataRetentionDaysState] = useState<number | null>(null)
  const [settingRetentionPolicy, setSettingRetentionPolicy] = useState(false)
  const [searchingStudentData, setSearchingStudentData] = useState(false)
  const [studentDataSearchResult, setStudentDataSearchResult] = useState<OrgStudentDataSearchResult | undefined>(undefined)
  const [purgingOrg, setPurgingOrg] = useState(false)
  const [annualArchiveJobs, setAnnualArchiveJobs] = useState<AnnualArchiveJob[]>([])
  const [loadingAnnualArchiveJobs, setLoadingAnnualArchiveJobs] = useState(false)
  const [annualArchivePreview, setAnnualArchivePreview] = useState<PreviewAnnualArchiveResult | undefined>(undefined)
  const [previewingAnnualArchive, setPreviewingAnnualArchive] = useState(false)
  const [schedulingAnnualArchive, setSchedulingAnnualArchive] = useState(false)
  const [cancellingAnnualArchive, setCancellingAnnualArchive] = useState(false)
  const navigate = useNavigate()
  const uid = services.auth.currentUser?.uid

  const loadMembers = useCallback(() => {
    if (!orgId) return
    void listOrgMembers(services.functions, { orgId })
      .then((data) => { if (Array.isArray(data)) setMembers(data) })
      .catch(() => setMembers([]))
  }, [orgId, services.functions])

  const loadInvitations = useCallback(() => {
    if (!orgId) return
    void listOrgInvitations(services.functions, orgId)
      .then((data) => { if (Array.isArray(data)) setInvitations(data) })
      .catch(() => setInvitations([]))
  }, [orgId, services.functions])
  useEffect(() => { loadInvitations() }, [loadInvitations])

  const loadAnnualArchiveJobs = useCallback(() => {
    if (!orgId) return
    setLoadingAnnualArchiveJobs(true)
    void listAnnualArchiveJobs(services.functions, { orgId })
      .then((result) => {
        if (result && Array.isArray(result.jobs)) {
          setAnnualArchiveJobs(result.jobs)
        } else {
          setAnnualArchiveJobs([])
        }
      })
      .catch(() => setAnnualArchiveJobs([]))
      .finally(() => setLoadingAnnualArchiveJobs(false))
  }, [orgId, services.functions])
  useEffect(() => { loadAnnualArchiveJobs() }, [loadAnnualArchiveJobs])

  useEffect(() => { loadMembers() }, [loadMembers])
  useEffect(() => {
    if (!orgId) return
    void getOrgPlanLimits(services.functions, { orgId })
      .then((limits) => setTeacherSeatLimit(limits.teacherSeats))
      .catch(() => setTeacherSeatLimit(undefined))
  }, [orgId, services.functions])
  useEffect(() => {
    if (!orgId) return
    void getDoc(doc(services.firestore, 'organizations', orgId)).then((snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data()
        setParentOrgId((data.parentOrgId as string | undefined) ?? null)
        const policyDays = typeof data.studentDataRetentionPolicy?.retentionDays === 'number'
          ? data.studentDataRetentionPolicy.retentionDays
          : null
        setStudentDataRetentionDaysState(policyDays)
      } else {
        setParentOrgId(null)
        setStudentDataRetentionDaysState(null)
      }
    })
  }, [orgId, services.firestore])
  useEffect(() => {
    if (!orgId) return
    setLoadingAuditLog(true)
    void listOrgAuditLog(services.functions, { orgId })
      .then((result) => {
        if (result && Array.isArray(result.entries)) {
          setAuditLogEntries(result.entries)
        } else {
          setAuditLogEntries([])
        }
      })
      .catch(() => setAuditLogEntries([]))
      .finally(() => setLoadingAuditLog(false))
  }, [services, orgId])

  useEffect(() => {
    setStudentDataSearchResult(undefined)
  }, [orgId])

  useEffect(() => {
    if (!studentDataSearchResult) return
    const timeoutMs = Math.max(0, new Date(studentDataSearchResult.expiresAt).getTime() - Date.now())
    const timer = setTimeout(() => {
      setStudentDataSearchResult(undefined)
    }, timeoutMs)
    return () => clearTimeout(timer)
  }, [studentDataSearchResult])

  if (!orgId || !uid) return <GuardLoading />
  const viewerMembership = members.find((member) => member.uid === uid)
  const canManageMembers = viewerMembership?.role === 'owner' || viewerMembership?.role === 'admin'

  const onExportStudentData = () => {
    setExportingStudentData(true)
    void exportOrgStudentData(services.functions, { orgId })
      .then((data) => downloadAsJsonFile(data, `student-data-${orgId}.json`))
      .finally(() => setExportingStudentData(false))
  }

  const onSearchStudentData = (input: { field: OrgStudentSearchField; query: string; reason: string }) => {
    setSearchingStudentData(true)
    setStudentDataSearchResult(undefined)
    void searchOrgStudentData(services.functions, { orgId, ...input })
      .then((result) => setStudentDataSearchResult(result))
      .catch(() => setStudentDataSearchResult(undefined))
      .finally(() => setSearchingStudentData(false))
  }

  const onClearStudentDataSearch = () => {
    setStudentDataSearchResult(undefined)
  }

  const onSetStudentDataRetentionDays = (days: number) => {
    if (!orgId) return
    setSettingRetentionPolicy(true)
    void setStudentDataRetentionDays(services.functions, { orgId, retentionDays: days })
      .then(() => setStudentDataRetentionDaysState(days))
      .finally(() => setSettingRetentionPolicy(false))
  }

  const onPurgeOrg = () => {
    if (!orgId) return
    setPurgingOrg(true)
    void purgeSchoolOrg(services.functions, { orgId })
      .then(() => navigate('/teacher'))
      .finally(() => setPurgingOrg(false))
  }

  const onPreviewAnnualArchive = (academicYear: number) => {
    if (!orgId) return
    setPreviewingAnnualArchive(true)
    void previewAnnualArchive(services.functions, { orgId, academicYear })
      .then((res) => setAnnualArchivePreview(res))
      .catch(() => setAnnualArchivePreview(undefined))
      .finally(() => setPreviewingAnnualArchive(false))
  }

  const onScheduleAnnualArchive = (input: { academicYear: number; scheduledFor: string; reason: string }) => {
    if (!orgId) return
    setSchedulingAnnualArchive(true)
    const isoScheduledFor = new Date(input.scheduledFor).toISOString()
    void scheduleAnnualArchive(services.functions, {
      orgId,
      academicYear: input.academicYear,
      scheduledFor: isoScheduledFor,
      reason: input.reason,
      idempotencyKey: crypto.randomUUID(),
    })
      .then(() => {
        setAnnualArchivePreview(undefined)
        loadAnnualArchiveJobs()
      })
      .finally(() => setSchedulingAnnualArchive(false))
  }

  const onCancelAnnualArchive = (input: { jobId: string; reason: string }) => {
    if (!orgId) return
    setCancellingAnnualArchive(true)
    void cancelAnnualArchive(services.functions, {
      orgId,
      jobId: input.jobId,
      reason: input.reason,
      idempotencyKey: crypto.randomUUID(),
    })
      .then(() => {
        loadAnnualArchiveJobs()
      })
      .finally(() => setCancellingAnnualArchive(false))
  }

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
      studentDataRetentionDays={studentDataRetentionDays}
      settingRetentionPolicy={settingRetentionPolicy}
      onSetStudentDataRetentionDays={onSetStudentDataRetentionDays}
      purgingOrg={purgingOrg}
      onPurgeOrg={onPurgeOrg}
      onSearchStudentData={onSearchStudentData}
      searchingStudentData={searchingStudentData}
      studentDataSearchResult={studentDataSearchResult}
      onClearStudentDataSearch={onClearStudentDataSearch}
      annualArchiveJobs={annualArchiveJobs}
      loadingAnnualArchiveJobs={loadingAnnualArchiveJobs}
      onPreviewAnnualArchive={onPreviewAnnualArchive}
      previewingAnnualArchive={previewingAnnualArchive}
      annualArchivePreview={annualArchivePreview}
      onScheduleAnnualArchive={onScheduleAnnualArchive}
      schedulingAnnualArchive={schedulingAnnualArchive}
      onCancelAnnualArchive={onCancelAnnualArchive}
      cancellingAnnualArchive={cancellingAnnualArchive}
      onSuspendMember={(targetUid) => {
        setSuspending(true)
        void suspendOrgMember(services.functions, { orgId, uid: targetUid })
          .then(loadMembers)
          .finally(() => setSuspending(false))
      }}
      onRevokeInvitation={(invitationId) => {
        void revokeInvitation(services.functions, { orgId, invitationId }).then(loadInvitations)
      }}
      onChangeRole={(uid, newRole) => {
        void changeOrgMemberRole(services.functions, { orgId, uid, newRole }).then(loadMembers)
      }}
      onInvite={async (email, role) => {
        setInviting(true)
        try {
          const { invitationId } = await createInvitation(services.functions, { orgId, email, role })
          setInvitations((prev) => [...prev, { id: invitationId, orgId, email, role, status: 'PENDING', invitedByUid: '', createdAt: null }])
          await loadInvitations()
        } finally {
          setInviting(false)
        }
      }}
      onExportStudentData={onExportStudentData}
      exportingStudentData={exportingStudentData}
      auditLogEntries={auditLogEntries}
      loadingAuditLog={loadingAuditLog}
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

function UsageDashboardRoute({ services }: { services: FirebaseServices }) {
  const { orgId } = useParams<{ orgId: string }>()
  const [data, setData] = useState<OrgUsageDashboard>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let cancelled = false
    if (!orgId) return
    setError(undefined)
    getOrgUsageDashboard(services.functions, { orgId })
      .then((result) => { if (!cancelled) setData(result) })
      .catch(() => { if (!cancelled) setError('failed') })
    return () => { cancelled = true }
  }, [services, orgId])
  return <UsageDashboardPage data={data} error={error} />
}

function TemplateApprovalsRoute({ services }: { services: FirebaseServices }) {
  const { orgId } = useParams<{ orgId: string }>()
  const [data, setData] = useState<PendingTemplateApproval[]>()
  const [error, setError] = useState<string>()
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let cancelled = false
    if (!orgId) return
    setError(undefined)
    listPendingTemplateApprovals(services.functions, { orgId })
      .then((result) => { if (!cancelled) setData(result) })
      .catch(() => { if (!cancelled) setError('failed') })
    return () => { cancelled = true }
  }, [services, orgId, reload])
  if (!orgId) return null
  const decide = (templateId: string, decision: 'APPROVED' | 'REJECTED') => {
    void reviewTemplateApproval(services.functions, { orgId, templateId, decision }).then(() => setReload((n) => n + 1))
  }
  return <TemplateApprovalsPage data={data} error={error} onApprove={(id) => decide(id, 'APPROVED')} onReject={(id) => decide(id, 'REJECTED')} />
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

type HouseholdModeStatus = 'LOADING' | 'YES' | 'NO'

/**
 * `/lessons/:runId/play` only (Task 13) — every other student route
 * (`/waiting`, `/results`) keeps `StudentLessonRoute`'s
 * `DeferredDataNotice` fallback unchanged; only the "授業中" screen needs to
 * decide whether to render `HouseholdTeamScreen`.
 *
 * Detects "is this a household-mode lessonRun" by SHAPE, not by a
 * routing-only field: subscribes to this team's own
 * `lessonRunTeamState/{runId}/{teamId}` node (the exact node
 * `HouseholdTeamScreen` itself subscribes to) and checks whether it carries
 * EITHER `.household` (Common/legacy) or `.households` (advanced, Task 9) —
 * never a `subject`/`courseFormat` field added solely for this decision, per
 * this task's brief ("detect by shape, not by a routing-only flag" is this
 * codebase's established convention — see e.g. how `HouseholdTeamScreen`
 * itself branches Common vs advanced by which field is present, not by a
 * separate flag). A market lessonRun's team-state node has neither field, so
 * it falls through to the unchanged `DeferredDataNotice` fallback.
 */
function StudentPlayRoute({ services, heading }: { services: FirebaseServices; heading: string }) {
  const { runId } = useParams<{ runId: string }>()
  const access = useStudentLessonAccess(runId ?? '', services)
  const [householdMode, setHouseholdMode] = useState<HouseholdModeStatus>('LOADING')

  useEffect(() => {
    if (access.status !== 'GRANTED' || !access.teamId || !runId) return
    setHouseholdMode('LOADING')
    return subscribeOwnTeamState<{ household?: unknown; households?: unknown }>(
      services.database,
      runId,
      access.teamId,
      (state) => setHouseholdMode(state && (state.household !== undefined || state.households !== undefined) ? 'YES' : 'NO'),
    )
  }, [access.status, access.teamId, runId, services])

  if (access.status === 'LOADING') return <GuardLoading />
  if (access.status === 'DENIED') return <Navigate replace to="/join" />
  if (householdMode === 'LOADING') return <GuardLoading />
  if (householdMode === 'YES' && runId && access.teamId) {
    return <HouseholdTeamScreen lessonRunId={runId} teamId={access.teamId} database={services.database} functions={services.functions} />
  }
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
    onJoined={(result, displayName) => navigate(`/lessons/${result.lessonRunId}/waiting`, { state: { displayName } })}
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
  <Route path="/lessons/:runId/play" element={enabled && services ? <StudentPlayRoute services={services} heading="授業中" /> : <Navigate replace to="/about" />} />
  <Route path="/lessons/:runId/results" element={enabled && services ? <StudentLessonRoute services={services} heading="結果" /> : <Navigate replace to="/about" />} />
  <Route path="/teacher/lessons/:runId/control" element={enabled && services ? <TeacherControlRoute services={services} /> : <Navigate replace to="/about" />} />
  <Route path="/teacher/lessons/:runId/analytics" element={enabled && services ? <TeacherAnalyticsRoute services={services} /> : <Navigate replace to="/about" />} />
  <Route path="/teacher" element={enabled && services ? <TemplateRouteGuard services={services}><TeacherHomeRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
  <Route path="/teacher/templates" element={enabled && services ? <TemplateRouteGuard services={services}><TemplateListRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
  <Route path="/teacher/templates/new" element={enabled && services ? <TemplateRouteGuard services={services}><TemplateNewRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
  <Route path="/teacher/templates/:templateId/edit" element={enabled && services ? <TemplateRouteGuard services={services}><TemplateEditRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
  <Route path="/teacher/marketplace" element={enabled && services ? <TemplateRouteGuard services={services}><CommunityMarketplaceRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
  <Route path="/teacher/marketplace/:templateId" element={enabled && services ? <TemplateRouteGuard services={services}><CommunityTemplateDetailRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
  <Route path="/operator/reports" element={enabled && services ? <TemplateRouteGuard services={services}><OperatorReportsRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
  <Route path="/operator/certifications" element={enabled && services ? <TemplateRouteGuard services={services}><OperatorCertificationsRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
  <Route path="/operator/ai-beta" element={enabled && services ? <TemplateRouteGuard services={services}><OperatorAiBetaAccessRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
  <Route path="/teacher/organizations/new" element={enabled && services ? <TemplateRouteGuard services={services}><SchoolOrgNewRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
  <Route path="/teacher/organizations/new-parent" element={enabled && services ? <TemplateRouteGuard services={services}><ParentOrgNewRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
  <Route path="/teacher/organizations/:orgId/settings" element={enabled && services ? <TemplateRouteGuard services={services}><SchoolOrgSettingsRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
  <Route path="/teacher/organizations/:orgId/plan-limits" element={enabled && services ? <TemplateRouteGuard services={services}><PlanLimitsRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
  <Route path="/teacher/organizations/:orgId/usage-dashboard" element={enabled && services ? <TemplateRouteGuard services={services}><UsageDashboardRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
  <Route path="/teacher/organizations/:orgId/template-approvals" element={enabled && services ? <TemplateRouteGuard services={services}><TemplateApprovalsRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
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
