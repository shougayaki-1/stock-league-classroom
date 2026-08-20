export interface LessonRunPublicTeamSummary {
  teamId: string
  displayName: string
}

/**
 * A single broadcast-safe notification surfaced on the shared
 * `lessonRunPublic/{lessonRunId}` node (Phase B/Task10). Deliberately
 * carries no actor identity and no event payload — `lessonRunPublic` is one
 * node shared by every participant in the run (see database.rules.json),
 * so anything placed here is visible to the entire class at once. Only
 * `severity`/`type`/`occurredAtMillis` are safe at that broadcast
 * granularity; per-participant-addressed content has no home on this node
 * (see functions/src/lessonRuns/notifications.ts's `classifyNotification`
 * for how `severity` is derived from the underlying lesson-event type).
 */
export interface LessonRunPublicNotification {
  id: string
  type: string
  severity: 'IMPORTANT' | 'NORMAL' | 'REFERENCE'
  occurredAtMillis: number
}

/**
 * Fields safe to send to every participant in a lessonRun. Phase A defines
 * only the envelope; Phase B (Task10) adds the phase-timer/public-task/
 * notification fields below.
 *
 * INVARIANT (spec §26-1): this type must never gain a field that reveals
 * future prices, non-public coefficients, or a random seed. If a field here
 * would let a participant compute or look up such a value, it belongs in
 * LessonRunPrivateState instead — never as an optional/hidden field on this
 * type, because RTDB has no field-level rules: the whole node's `.read`
 * grant applies to everything under it.
 *
 * Every producer of this shape (functions/src/lessonRuns/projections/
 * publicProjection.ts's `toLessonRunPublicState`) MUST build the output
 * object by listing each field explicitly (an allow-list) rather than
 * spreading an internal/private source object — see that file's JSDoc for
 * why deny-list stripping is rejected as a design here.
 */
/**
 * The market's public breakdown of a single price move (spec §12.31 —
 * "その他要因" display). Deliberately mirrors LessonRunPrivateState's
 * per-stock `computationLog` shape but strips every internal coefficient
 * (price-sensitivity preset, raw noise term): only the three
 * participant-facing percentages plus their total survive here.
 */
export interface PriceBreakdownPublicView {
  informationPercent: number
  demandPercent: number
  /** Internal coefficients are never included — this is the "その他要因" figure itself. */
  otherPercent: number
  total: number
}

/** A single stock's participant-facing market state, broadcast on `lessonRunPublic/{lessonRunId}`. */
export interface StockPublicState {
  currentPrice: number
  previousPrice: number
  guardApplied: boolean
  suddenChangeWarning: boolean
  breakdown: PriceBreakdownPublicView
  /** Contradiction-resolution C: gross volume before netting, not the net demand value. */
  displayedVolumeShares: number
}

import type {
  CompanyPublicView,
  EconomicIndicatorPublicView,
  InformationPublicView,
  ResearchDeskPanelId,
  ResearchDeskPublicView,
} from '@stock-league/market-public-content'

export type {
  CompanyPublicView,
  EconomicIndicatorPublicView,
  InformationPublicView,
  ResearchDeskPanelId,
  ResearchDeskPublicView,
}

export interface LessonRunPublicState {
  status: string
  currentPhaseId: string | null
  /** 現在フェーズの日本語名。内部IDを画面に出さないための表示用。ラベル未設定のフェーズでは null。 */
  currentPhaseLabel: string | null
  updatedAtMillis: number
  /** Required by database.rules.json's teacher-read branch (`data.child('orgId')`); not sensitive on its own — every lessonRunPublic/lessonRunPrivate/lessonRunTeamState node already carries it. */
  orgId: string
  /** Seconds remaining in the current phase, or null when no phase/timer is active. Never derived from a value that would let a participant back-compute a future price schedule — only a plain countdown. */
  remainingPhaseSeconds: number | null
  /** The current phase's teacher-authored, already-public prompt/task text. Never the private phase-transition/pricing plan. */
  publicTask: string | null
  /** Broadcast-safe notifications only — see LessonRunPublicNotification's JSDoc. */
  notifications: LessonRunPublicNotification[]
  /** Lesson title, safe for every participant (see functions/src/lessonRuns/projections/publicProjection.ts's toLessonRunPublicState — kept in sync by hand). */
  title: string
  /** Allow-listed per-team summary — teamId/displayName only. A student resolves their own team's displayName by matching against their own membership mirror's teamId. */
  teams: LessonRunPublicTeamSummary[]
  marketPaused: boolean
  /** Server-written value. Clients render only a countdown to this timestamp and never advance
   * their own timer (contradiction-resolution A, mandatory item 1) — never recompute batch cadence client-side. */
  nextBatchAtMillis: number | null
  /** Present only while a teacher-initiated resume is in its confirmation window (spec §12.26). */
  resumeScheduledAtMillis?: number
  stocks: Record<string, StockPublicState>
  /**
   * Only present for HOME_ECONOMICS lessonRuns — mutually exclusive with
   * the market fields above (a LessonRun's `subject` never changes after
   * creation). Class-wide, teacher-authored economic assumptions
   * (inflation/interest/market-return) written by
   * `functions/src/homeEconomics/processRound.ts`'s
   * `publishRealtimeStateWithAdminSdk` — safe for every participant,
   * never the per-household calculation log (that lives on
   * `LessonRunPrivateState.householdComputationLog` instead).
   */
  economicFactors?: { inflationPercent: number; interestRatePercent: number; marketReturnPercent: number }
  /** Student Research Desk projection (Phase 2). */
  researchDesk?: ResearchDeskPublicView
  /**
   * Task 12: the class-wide, privacy-safe final comparison, present the
   * moment an advanced (ROLE_VARIANT/STAGE_SPLIT/MULTI_PERSON_PER_TEAM)
   * Home Economics lesson transitions RUNNING -> REFLECTION. Absent before
   * that (and always absent for a market lesson / COMMON_CONDITIONS, which
   * has no per-team comparison to publish). Hand-synced with
   * `functions/src/homeEconomics/statusTransition.ts`'s `afterStatusTransition`
   * REFLECTION branch, which is the sole writer of this field — see
   * `HouseholdClassComparisonPublicView`'s own JSDoc below for the
   * cross-boundary hand-sync discipline (same as `HouseholdProfilePublicView`
   * above).
   */
  householdClassComparison?: HouseholdClassComparisonPublicView
}

/**
 * Client counterpart of `@stock-league/household-public-content`'s
 * `HouseholdClassComparisonHouseholdView` — hand-synced across the
 * `functions/`-only package boundary the same way `HouseholdProfilePublicView`
 * above is (`src/` cannot import that package; see its JSDoc). `profileId`
 * is the LOGICAL template profile id — never a runtime householdId, never
 * any participant identity, never a risk/probability/seed field. Keep
 * field-for-field identical to the server-side allow-list.
 */
export interface HouseholdClassComparisonHouseholdView {
  profileId: string
  profile: HouseholdProfilePublicView
  cashYen: number
  totalAssetsYen: number
  totalLiabilitiesYen: number
  goalDelayedRounds: number
  lifeGoalAchievementScore: number
}

export interface HouseholdClassComparisonTeamView {
  teamDisplayName: string
  households: HouseholdClassComparisonHouseholdView[]
}

/** Client counterpart of `@stock-league/household-public-content`'s `HouseholdClassComparisonPublicView`. Same hand-sync discipline as its sibling types above. */
export interface HouseholdClassComparisonPublicView {
  courseFormat: 'ROLE_VARIANT' | 'STAGE_SPLIT' | 'MULTI_PERSON_PER_TEAM'
  finalRoundCount: number
  publishedAtMillis: number
  teams: HouseholdClassComparisonTeamView[]
}

/**
 * `lessonRunDisplay/{lessonRunId}`'s mode: which screen the classroom
 * projector should render. Unlike the other four modes (derived purely from
 * `LessonRun.status` by `deriveDisplayMode` — see
 * `functions/src/lessonRuns/projections/displayProjection.ts`),
 * `HOUSEHOLD_COMPARISON` (Task 13) is never status-derived: it is written
 * exclusively by `showHouseholdComparisonOnDisplayCallable`
 * (`functions/src/homeEconomics/onCall.ts`) when a teacher explicitly
 * chooses "教室画面に表示" for the class comparison. See that Callable's
 * own JSDoc for the accepted race with `setDisplayState`'s generic
 * whole-node `.set()` publish (a subsequent phase-lifecycle/teacher-guidance
 * publish reverts the projector back to the status-derived mode).
 */
export type LessonRunDisplayMode = 'START' | 'LIVE' | 'END' | 'EXPLANATION' | 'HOUSEHOLD_COMPARISON'

/**
 * A single team's projector-safe summary. Never member identities, never
 * individual responses, never who has/hasn't submitted yet — those live only
 * in Firestore (system of record) and in the per-team
 * `lessonRunTeamState/{lessonRunId}/{teamId}` RTDB node, which is scoped to
 * that team's own members plus teachers, not the whole-class display.
 */
export interface LessonRunDisplayTeamSummary {
  teamId: string
  displayName: string
  /** A single already-public aggregate figure/label (e.g. a rank or score), or null when nothing is publishable yet. Never raw per-member data. */
  publicAggregateLabel: string | null
}

/**
 * Fields safe to project onto an unauthenticated classroom screen
 * (Phase B/Task10). Reached only via `lessonRunDisplay/{lessonRunId}`
 * (database.rules.json) after a one-time session-token exchange for a
 * Firebase custom token scoped to this run via the `displayRunId` claim —
 * see functions/src/lessonRuns/projections/displaySession.ts. `orgId` is
 * the only authorization-adjacent field carried here (required by the
 * teacher-read branch of the RTDB rule, same as LessonRunPublicState); no
 * other membership/role/session information belongs on this type.
 *
 * Same allow-list-construction requirement as LessonRunPublicState — see
 * functions/src/lessonRuns/projections/displayProjection.ts's
 * `toLessonRunDisplayState`.
 */
export interface LessonRunDisplayState {
  orgId: string
  mode: LessonRunDisplayMode
  title: string
  /** 現在フェーズの日本語名。内部IDを画面に出さないための表示用。ラベル未設定のフェーズでは null。 */
  currentPhaseLabel: string | null
  goal: string | null
  teams: LessonRunDisplayTeamSummary[]
  /** Teacher-authored guidance text meant for the whole class to see on the projector (e.g. "スマホを置いて前を見てください"). Never internal teacher-only notes. */
  teacherGuidance: string | null
  joinCode: string | null
  updatedAtMillis: number
  /**
   * Present only while `mode === 'HOUSEHOLD_COMPARISON'`. Written exclusively
   * by `showHouseholdComparisonOnDisplayCallable`, which reads this EXACT
   * already-privacy-safe object back from
   * `lessonRuns/{lessonRunId}/householdFinalComparison/result` server-side
   * and republishes it verbatim — never accepts one from client input. See
   * `LessonRunDisplayMode`'s own JSDoc above for the field's lifecycle.
   */
  householdClassComparison?: HouseholdClassComparisonPublicView
}

/**
 * Fields that must never reach a participant: future price plans, seeds,
 * non-public coefficients (spec §26-1). This type's data must live at a
 * SEPARATE top-level RTDB path from LessonRunPublicState — see
 * database.rules.json's `lessonRunPrivate` node. Do not nest this under
 * `lessonRunPublic/{lessonRunId}`; RTDB's read cascade means a broad grant
 * on an ancestor cannot be revoked by a `.read: false` on a descendant, so
 * nesting private data under a publicly-readable node reintroduces exactly
 * the vulnerability this split exists to close (see the "旧実装の廃止範囲"
 * section of this plan and Phase 0's findings on `prices/{id}/runtime` and
 * `companies/{id}/phases`).
 */
export interface LessonRunPrivateState {
  randomSeed: string
  restoreGeneration: number
  updatedAtMillis: number
  /** Used to reconcile Task 10's idempotency key against what has actually been published. Internal state, never surfaced on a teacher screen. */
  lastProcessedBatchId: string | null
  /** Spec §12.31 — "教師・教材作成者は詳細設定と計算ログを確認できる". Same
   * shape as the public breakdown but with the internal coefficients
   * (raw noise term, the active price-sensitivity preset) included. This
   * is the full computation log; it must never be sent to students —
   * see this type's own top-level JSDoc for why it cannot live under
   * `lessonRunPublic`. */
  computationLog: Record<string, { informationImpactPercent: number; demandImpactPercent: number; noisePercent: number; priceSensitivityPreset: string }>
  /**
   * Only present for HOME_ECONOMICS lessonRuns — mutually exclusive with
   * `computationLog` above (a LessonRun's `subject` never changes after
   * creation). Teacher-only per-household round breakdown, written by
   * `functions/src/homeEconomics/processRound.ts`'s
   * `publishRealtimeStateWithAdminSdk`, keyed by householdId so settling
   * one household's round never clobbers another's already-published
   * entry. Includes `internalRiskFactors` (`HouseholdProfile`, Task 1) and
   * `internalClaimProbability` (per contracted insurance product, keyed by
   * insurance product id) — both must never be mirrored onto
   * `LessonRunPublicState` or `HouseholdStateTeamView` (see this file's
   * top-level JSDoc on why private data cannot live under a publicly
   * readable node).
   */
  householdComputationLog?: Record<string, {
    roundIndex: number
    occurredEventIds: string[]
    incomeYen: number
    expensesYen: number
    netCashFlowYen: number
    shortfallYen: number
    insuranceBenefitsYen: number
    internalRiskFactors: Record<string, number>
    internalClaimProbability: Record<string, number>
  }>
}

/** A single order as visible to the team that placed it (never another team's orders). */
export interface MyOrderView {
  orderId: string
  stockId: string
  side: 'BUY' | 'SELL'
  quantity: number
  status: 'PENDING' | 'CANCELLED' | 'PROCESSING' | 'FILLED' | 'REJECTED'
  referencePrice: number
  executionPrice?: number
}

/**
 * Home-economics counterpart of `LessonRunTeamState` below — one household's
 * team-broadcast-safe view (spec §26-1/§13.4/§23.6). Hand-duplicated from
 * `functions/src/homeEconomics/realtimeProjection.ts`'s server-side type of
 * the same name — `functions/` code cannot import across the functions/src
 * rootDir boundary into `src/` (see that file's own JSDoc, which cites
 * `functions/src/lessonRuns/projections/publicProjection.ts` as the
 * precedent for this hand-sync discipline). Keep both in sync by hand.
 */
export interface HouseholdStateTeamView {
  householdId: string
  isFictional: true
  cashYen: number
  assetHoldingsYen: Record<string, number>
  activeInsuranceContractYearsRemaining: Record<string, number>
  activeLiabilities: Record<string, { remainingPrincipalYen: number; remainingYears: number }>
  lifeStage: string
  roundIndex: number
  goalDelayedRounds: number
  visibleConcepts: string[]
  eventDisclosures: { eventId: string; label: string | null; effectDescription: string | null; revealed: boolean }[]
  shortfallOptions: { type: string; description: string; resolvesYen: number }[]
}

export interface TeamResearchNoteView {
  text: string
  revision: number
  updatedAtMillis: number
}

/**
 * Client counterpart of `functions/src/homeEconomics/toPublicView.ts`'s
 * `toHouseholdProfilePublicView`'s output shape (originally defined in
 * `@stock-league/household-public-content`, a `functions/`-only package —
 * `src/` cannot import across the functions/src rootDir boundary, same
 * constraint `HouseholdStateTeamView` above already documents). Hand-synced;
 * keep field-for-field identical to that server-side allow-list.
 */
export interface HouseholdProfilePublicView {
  householdId: string
  age: number
  householdIncomeYen: number
  annualLivingExpensesYen: number
  cashSavingsYen: number
  family: string
  housing: string
  lifeGoal: string
  lifeStage: string
  isFictional: true
}

/**
 * Advanced-format (ROLE_VARIANT/STAGE_SPLIT/MULTI_PERSON_PER_TEAM)
 * counterpart of `HouseholdStateTeamView` above — one household's entry
 * within an `AdvancedHouseholdTeamStateView`. Hand-duplicated from
 * `functions/src/homeEconomics/realtimeProjection.ts`'s server-side type of
 * the same name (Task 9) — see that file's JSDoc for why.
 */
export interface AdvancedHouseholdTeamEntryView {
  householdId: string
  profile: HouseholdProfilePublicView
  state: HouseholdStateTeamView
  /** Which round this household has an on-record submitted decision for, or `null` when it has not yet submitted for its CURRENT round (`state.roundIndex`). */
  submittedRoundIndex: number | null
}

/**
 * Advanced-format counterpart of `LessonRunTeamState.household` — a team
 * running ROLE_VARIANT/STAGE_SPLIT/MULTI_PERSON_PER_TEAM can host more than
 * one runtime household on the SAME team, so this carries a `households`
 * map (keyed by runtime householdId) plus display order and the
 * team-agnostic course-format/round-sync fields, instead of a single
 * `household` field. Hand-duplicated from
 * `functions/src/homeEconomics/realtimeProjection.ts`'s server-side type of
 * the same name (Task 9) — see that file's JSDoc for why.
 */
export interface AdvancedHouseholdTeamStateView {
  courseFormat: 'ROLE_VARIANT' | 'STAGE_SPLIT' | 'MULTI_PERSON_PER_TEAM'
  synchronizedRoundIndex: number
  roundStatus: 'OPEN' | 'SETTLING'
  households: Record<string, AdvancedHouseholdTeamEntryView>
  householdOrder: string[]
}

/**
 * Third visibility class alongside LessonRunPublicState (every participant)
 * and LessonRunPrivateState (teachers only): a team's own cash, holdings,
 * locked funds/shares, and order state must reach that team's members in
 * real time, but must never reach other teams. Lives at the separate
 * top-level `lessonRunTeamState/{lessonRunId}/{teamId}` RTDB path — see
 * database.rules.json's asymmetric read rule (own team OR org-member
 * teacher oversight) and this file's LessonRunPrivateState JSDoc for why
 * a nested path would defeat the isolation RTDB's read cascade requires.
 */
/**
 * `LessonRunTeamState` (below) intersects with this so an advanced-format
 * lessonRun's `lessonRunTeamState/{lessonRunId}/{teamId}` node's
 * `courseFormat`/`synchronizedRoundIndex`/`roundStatus`/`households`/
 * `householdOrder` fields are written FLAT on the node itself — not nested
 * under a wrapper key — matching exactly what
 * `functions/src/homeEconomics/processRound.ts`'s
 * `publishRealtimeStateWithAdminSdk` and
 * `functions/src/homeEconomics/statusTransition.ts`'s
 * `afterStatusTransition` actually write (Task 9).
 */
export interface LessonRunTeamState extends Partial<AdvancedHouseholdTeamStateView> {
  cash: number
  holdings: Record<string, number>
  lockedBuyValue: number
  lockedSellQuantity: Record<string, number>
  myOrders: MyOrderView[]
  updatedAtMillis: number
  /**
   * Only present for HOME_ECONOMICS lessonRuns using COMMON_CONDITIONS —
   * mutually exclusive with the market fields above (a LessonRun's
   * `subject` never changes after creation) AND with the
   * `AdvancedHouseholdTeamStateView` fields inherited above (a lessonRun's
   * courseFormat never changes after creation either).
   */
  household?: HouseholdStateTeamView
  /** Team Research Desk notes mirror. Scoped to this team only. */
  researchNote?: TeamResearchNoteView
}
