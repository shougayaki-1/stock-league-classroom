# UI Presentation Boundary Project A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a fail-closed UI presentation contract for labels and common errors, and remove implementation terminology from the app-wide fatal error UI without yet migrating the domain screens owned by Projects B-E.

**Architecture:** Add a small `src/lib/presentation/` layer with one generic safe-label primitive plus domain-specific exhaustive label maps for lesson runtime, market/research, home economics, and organization/billing values. Move common user-facing error classification/copy into that presentation layer while preserving `src/lib/monitoring/describeError.ts` as the reporting/throttling compatibility surface. `AppErrorBoundary` becomes the first production consumer whose tests assert both the intended Japanese copy and the absence of technical strings.

**Tech Stack:** TypeScript 6, React 19, Vite 8, Vitest 4, Testing Library, MUI 9, existing Firebase client wrappers.

**Spec:** `docs/superpowers/specs/2026-08-24-ui-presentation-boundary-design.md`

## Global Constraints

- Work on `codex/classroom`, not `main`.
- Do not modify Firestore/RTDB schemas, Functions DTOs, callable contracts, or server behavior in Project A.
- Do not migrate `OrderScreen`, `NewsListPage`, `ResearchDeskPage`, `CompanyResearchPage`, household screens, teacher lesson runtime screens, intervention forms, template/admin screens, or operator screens in this plan. Those are Projects B-F.
- A value being safe to transport is not sufficient reason to render it. Presentation helpers must never return an unknown raw enum/token as fallback.
- Do not add any helper equivalent to `LABELS[value] ?? value`, `label ?? internalId`, or `error instanceof Error ? error.message : fallback` for user-facing output.
- All safe formatter functions that accept runtime `string` values must return a fixed human-readable fallback when the value is unknown, empty, `null`, or `undefined`.
- Strong union maps must use `satisfies Record<UnionType, string>` so a future union member creates a compile-time failure until a label is added.
- Human-authored text such as company names, family descriptions, lesson titles, and phase labels is not translated by these enum helpers.
- Do not add a new runtime dependency.
- Preserve `describeError(error, fallback)` and `handleFailure(error, fallback, nowMillis?)` signatures so existing call sites keep compiling.
- Preserve `handleFailure` telemetry throttling behavior and `ERROR_REPORT_COOLDOWN_MILLIS = 60_000`.
- Raw errors remain reportable through existing monitoring; only the user-facing string is normalized.
- Product vocabulary remains `フェーズ`, `ラウンド`, `チェックポイント`, `教室表示`, `教材`, and `版`.
- Project A tests must explicitly prove that sentinel values such as `UNKNOWN_INTERNAL_TOKEN` are not echoed by presentation helpers or app-wide error UI.

---

## File Structure

Create these focused files:

- `src/lib/presentation/safeLabel.ts` — generic fail-closed lookup primitive only.
- `src/lib/presentation/safeLabel.test.ts` — primitive behavior and unknown-token non-echo tests.
- `src/lib/presentation/lessonLabels.ts` — lesson run status, display mode, teacher role, participant status, and safe current-phase-label formatting.
- `src/lib/presentation/lessonLabels.test.ts` — exhaustive expected copy and unknown-token tests.
- `src/lib/presentation/marketLabels.ts` — market/research enum labels used later by Project B.
- `src/lib/presentation/marketLabels.test.ts` — market/research mapping and unknown-token tests.
- `src/lib/presentation/householdLabels.ts` — home-economics semantic enum labels used later by Project C.
- `src/lib/presentation/householdLabels.test.ts` — home-economics mapping and unknown-token tests.
- `src/lib/presentation/organizationLabels.ts` — organization membership/invitation, billing, and annual archive status labels used later by Project E.
- `src/lib/presentation/organizationLabels.test.ts` — organization/billing mapping and unknown-token tests.
- `src/lib/presentation/userFacingError.ts` — common Firebase-like error-code classification and generic user-facing copy; never parses `Error.message`.
- `src/lib/presentation/userFacingError.test.ts` — classification, copy, and raw-message non-echo tests.

Modify these existing files:

- `src/lib/monitoring/describeError.ts` — delegate user copy to `userFacingError.ts`, preserve reporting/throttling API.
- `src/lib/monitoring/describeError.test.ts` — update copy expectations and add raw-message non-echo coverage while preserving throttling tests.
- `src/components/AppErrorBoundary.tsx` — remove English technical labels and Firebase/App Check wording.
- `src/components/AppErrorBoundary.test.tsx` — assert generic UI and absence of implementation terminology.

Do not create a barrel `src/lib/presentation/index.ts` in this project. Projects B-E should import the exact domain module they need; this keeps dependencies explicit and avoids turning presentation into an all-domain grab bag.

---

### Task 1: Add the fail-closed label primitive

**Files:**
- Create: `src/lib/presentation/safeLabel.ts`
- Create: `src/lib/presentation/safeLabel.test.ts`

**Interfaces:**
- Consumes: none.
- Produces: `safeLabel(value, labels, fallback): string`, used by Tasks 2-5.

- [ ] **Step 1: Write the failing primitive tests**

Create `src/lib/presentation/safeLabel.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { safeLabel } from './safeLabel'

const LABELS = {
  ACTIVE: '有効',
  DISABLED: '無効',
} satisfies Record<'ACTIVE' | 'DISABLED', string>

describe('safeLabel', () => {
  it('returns the mapped presentation value for a known token', () => {
    expect(safeLabel('ACTIVE', LABELS, '状態を確認できません')).toBe('有効')
  })

  it('does not echo an unknown internal token', () => {
    const raw = 'UNKNOWN_INTERNAL_TOKEN'
    const result = safeLabel(raw, LABELS, '状態を確認できません')

    expect(result).toBe('状態を確認できません')
    expect(result).not.toContain(raw)
  })

  it.each([undefined, null, ''])('uses the fallback for missing value %s', (value) => {
    expect(safeLabel(value, LABELS, '状態を確認できません')).toBe('状態を確認できません')
  })
})
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run:

```bash
npm test -- src/lib/presentation/safeLabel.test.ts
```

Expected: FAIL because `./safeLabel` does not exist yet.

- [ ] **Step 3: Implement the primitive**

Create `src/lib/presentation/safeLabel.ts`:

```ts
/**
 * Presentation-boundary lookup for runtime strings.
 * Unknown/missing values are deliberately fail-closed: the raw input is
 * never returned to the caller as display copy.
 */
export const safeLabel = <T extends Readonly<Record<string, string>>>(
  value: string | null | undefined,
  labels: T,
  fallback: string,
): string => {
  if (!value || !Object.prototype.hasOwnProperty.call(labels, value)) return fallback
  return labels[value as keyof T]
}
```

- [ ] **Step 4: Run the primitive test**

Run:

```bash
npm test -- src/lib/presentation/safeLabel.test.ts
```

Expected: PASS, 3 test cases including the table-driven missing-value cases.

- [ ] **Step 5: Typecheck the new generic**

Run:

```bash
npm run typecheck
```

Expected: PASS. In particular, `safeLabel` must return `string` without an unsafe index error under TypeScript 6.

- [ ] **Step 6: Commit**

```bash
git add src/lib/presentation/safeLabel.ts src/lib/presentation/safeLabel.test.ts
git commit -m "feat: add fail-closed presentation label helper"
```

---

### Task 2: Establish lesson-runtime presentation vocabulary

**Files:**
- Create: `src/lib/presentation/lessonLabels.ts`
- Create: `src/lib/presentation/lessonLabels.test.ts`

**Interfaces:**
- Consumes: `safeLabel` from Task 1; `LessonRunStatus` from `src/lib/lessonRuns/types.ts`; `LessonRunDisplayMode` from `src/lib/lessonRuns/liveTypes.ts`; `LessonRunRole` from `src/lib/lessonRuns/authorization.ts`; `LessonParticipantView['status']` from `src/lib/lessonRuns/participants.ts`.
- Produces: exhaustive maps `LESSON_RUN_STATUS_LABELS`, `LESSON_DISPLAY_MODE_LABELS`, `LESSON_RUN_ROLE_LABELS`, `PARTICIPANT_STATUS_LABELS`; safe formatters `formatLessonRunStatus`, `formatLessonDisplayMode`, `formatLessonRunRole`, `formatParticipantStatus`, `formatCurrentPhaseLabel`.

- [ ] **Step 1: Write failing lesson-label tests**

Create `src/lib/presentation/lessonLabels.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  formatCurrentPhaseLabel,
  formatLessonDisplayMode,
  formatLessonRunRole,
  formatLessonRunStatus,
  formatParticipantStatus,
} from './lessonLabels'

describe('lesson presentation labels', () => {
  it('maps lesson runtime values to product language', () => {
    expect(formatLessonRunStatus('DRAFT')).toBe('下書き')
    expect(formatLessonRunStatus('WAITING')).toBe('参加待ち')
    expect(formatLessonRunStatus('RUNNING')).toBe('授業中')
    expect(formatLessonRunStatus('REFLECTION')).toBe('振り返り')
    expect(formatLessonRunStatus('COMPLETED')).toBe('終了')
    expect(formatLessonDisplayMode('LIVE')).toBe('授業中の画面')
    expect(formatLessonRunRole('PRIMARY')).toBe('主担当')
    expect(formatParticipantStatus('MIGRATING_DEVICE')).toBe('端末移行中')
  })

  it('never echoes unknown runtime tokens', () => {
    const raw = 'UNKNOWN_INTERNAL_TOKEN'

    expect(formatLessonRunStatus(raw)).toBe('授業状態を確認できません')
    expect(formatLessonDisplayMode(raw)).toBe('教室表示の状態を確認できません')
    expect(formatLessonRunRole(raw)).toBe('担当権限を確認できません')
    expect(formatParticipantStatus(raw)).toBe('参加状態を確認できません')
    expect(formatLessonRunStatus(raw)).not.toContain(raw)
  })

  it('uses authored phase text but never falls back to a phase id or raw status', () => {
    expect(formatCurrentPhaseLabel('  取引  ', 'RUNNING')).toBe('取引')
    expect(formatCurrentPhaseLabel(null, 'DRAFT')).toBe('未開始')
    expect(formatCurrentPhaseLabel(undefined, 'READY')).toBe('未開始')
    expect(formatCurrentPhaseLabel('', 'WAITING')).toBe('未開始')
    expect(formatCurrentPhaseLabel(null, 'RUNNING')).toBe('フェーズ名を確認できません')
    expect(formatCurrentPhaseLabel(null, 'phase-market-opaque')).toBe('フェーズ名を確認できません')
  })
})
```

- [ ] **Step 2: Run the lesson-label test and verify it fails**

Run:

```bash
npm test -- src/lib/presentation/lessonLabels.test.ts
```

Expected: FAIL because `./lessonLabels` does not exist.

- [ ] **Step 3: Implement exhaustive lesson maps and safe formatters**

Create `src/lib/presentation/lessonLabels.ts`:

```ts
import type { LessonRunRole } from '../lessonRuns/authorization'
import type { LessonRunDisplayMode } from '../lessonRuns/liveTypes'
import type { LessonParticipantView } from '../lessonRuns/participants'
import type { LessonRunStatus } from '../lessonRuns/types'
import { safeLabel } from './safeLabel'

export const LESSON_RUN_STATUS_LABELS = {
  DRAFT: '下書き',
  READY: '開始準備完了',
  WAITING: '参加待ち',
  RUNNING: '授業中',
  PAUSED: '一時停止',
  INTERRUPTED: '中断中',
  REFLECTION: '振り返り',
  COMPLETED: '終了',
  ABORTED: '中止',
  ARCHIVED: 'アーカイブ済み',
} satisfies Record<LessonRunStatus, string>

export const LESSON_DISPLAY_MODE_LABELS = {
  START: '開始待機の画面',
  LIVE: '授業中の画面',
  END: '終了の画面',
  EXPLANATION: '解説の画面',
  HOUSEHOLD_COMPARISON: 'クラス比較の画面',
} satisfies Record<LessonRunDisplayMode, string>

export const LESSON_RUN_ROLE_LABELS = {
  PRIMARY: '主担当',
  ASSISTANT: '補助担当',
  VIEWER: '閲覧担当',
} satisfies Record<LessonRunRole, string>

export const PARTICIPANT_STATUS_LABELS = {
  ACTIVE: '参加中',
  TEMPORARILY_DISCONNECTED: '一時切断',
  ABSENT: '欠席',
  OBSERVER: '見学',
  LATE_JOIN: '途中参加',
  MIGRATING_DEVICE: '端末移行中',
  SUSPENDED: '参加停止',
} satisfies Record<LessonParticipantView['status'], string>

export const formatLessonRunStatus = (value: string | null | undefined): string =>
  safeLabel(value, LESSON_RUN_STATUS_LABELS, '授業状態を確認できません')

export const formatLessonDisplayMode = (value: string | null | undefined): string =>
  safeLabel(value, LESSON_DISPLAY_MODE_LABELS, '教室表示の状態を確認できません')

export const formatLessonRunRole = (value: string | null | undefined): string =>
  safeLabel(value, LESSON_RUN_ROLE_LABELS, '担当権限を確認できません')

export const formatParticipantStatus = (value: string | null | undefined): string =>
  safeLabel(value, PARTICIPANT_STATUS_LABELS, '参加状態を確認できません')

const PRE_START_STATUSES = new Set<LessonRunStatus>(['DRAFT', 'READY', 'WAITING'])

export const formatCurrentPhaseLabel = (
  currentPhaseLabel: string | null | undefined,
  status: string | null | undefined,
): string => {
  const label = currentPhaseLabel?.trim()
  if (label) return label
  if (status && PRE_START_STATUSES.has(status as LessonRunStatus)) return '未開始'
  return 'フェーズ名を確認できません'
}
```

Important: `formatCurrentPhaseLabel` intentionally has no `currentPhaseId` parameter. A caller therefore cannot accidentally reintroduce `currentPhaseLabel ?? currentPhaseId` through this shared interface.

- [ ] **Step 4: Run lesson-label tests**

Run:

```bash
npm test -- src/lib/presentation/lessonLabels.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck exhaustive maps**

Run:

```bash
npm run typecheck
```

Expected: PASS. If any existing union has a member omitted from the maps, fix the map rather than weakening it to `Record<string, string>`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/presentation/lessonLabels.ts src/lib/presentation/lessonLabels.test.ts
git commit -m "feat: define lesson presentation vocabulary"
```

---

### Task 3: Establish market/research presentation vocabulary

**Files:**
- Create: `src/lib/presentation/marketLabels.ts`
- Create: `src/lib/presentation/marketLabels.test.ts`

**Interfaces:**
- Consumes: `safeLabel`; public market types from `@stock-league/market-public-content`; `MyOrderView` from `src/lib/lessonRuns/liveTypes.ts`.
- Produces: exhaustive market/research maps and safe formatters used by Project B.

- [ ] **Step 1: Write failing market-label tests**

Create `src/lib/presentation/marketLabels.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  formatCompanyFinancialStrength,
  formatCompanyGrowthProfile,
  formatCompanySize,
  formatEconomicIndicatorKind,
  formatInformationCategory,
  formatInformationConfidence,
  formatInformationNature,
  formatOrderSide,
  formatOrderStatus,
  formatResearchDeskPanel,
} from './marketLabels'

describe('market presentation labels', () => {
  it('maps the existing market/research semantic values', () => {
    expect(formatCompanySize('LARGE')).toBe('大型株')
    expect(formatCompanyGrowthProfile('GROWTH')).toBe('成長型')
    expect(formatCompanyFinancialStrength('STRONG')).toBe('強い')
    expect(formatInformationCategory('OFFICIAL_NEWS')).toBe('公式発表')
    expect(formatInformationNature('FORECAST')).toBe('予測')
    expect(formatInformationConfidence('HIGH')).toBe('確度: 高')
    expect(formatEconomicIndicatorKind('FX')).toBe('為替')
    expect(formatResearchDeskPanel('TEAM_NOTES')).toBe('チームノート')
    expect(formatOrderSide('BUY')).toBe('買い')
    expect(formatOrderStatus('FILLED')).toBe('約定済み')
  })

  it('never echoes an unknown market token', () => {
    const raw = 'UNKNOWN_INTERNAL_TOKEN'
    const results = [
      formatCompanySize(raw),
      formatCompanyGrowthProfile(raw),
      formatCompanyFinancialStrength(raw),
      formatInformationCategory(raw),
      formatInformationNature(raw),
      formatInformationConfidence(raw),
      formatEconomicIndicatorKind(raw),
      formatResearchDeskPanel(raw),
      formatOrderSide(raw),
      formatOrderStatus(raw),
    ]

    for (const result of results) expect(result).not.toContain(raw)
  })
})
```

- [ ] **Step 2: Run the market-label test and verify it fails**

Run:

```bash
npm test -- src/lib/presentation/marketLabels.test.ts
```

Expected: FAIL because `./marketLabels` does not exist.

- [ ] **Step 3: Implement market/research maps and formatters**

Create `src/lib/presentation/marketLabels.ts`:

```ts
import type {
  CompanyPublicView,
  CompanySizeClass,
  EconomicIndicatorKind,
  InformationCategory,
  InformationConfidence,
  InformationNature,
  ResearchDeskPanelId,
} from '@stock-league/market-public-content'
import type { MyOrderView } from '../lessonRuns/liveTypes'
import { safeLabel } from './safeLabel'

type CompanyGrowthProfile = NonNullable<CompanyPublicView['growthProfile']>
type CompanyFinancialStrength = NonNullable<CompanyPublicView['financialStrength']>
type OrderSide = MyOrderView['side']
type OrderStatus = MyOrderView['status']

export const COMPANY_SIZE_LABELS = {
  SMALL: '小型株',
  MEDIUM: '中型株',
  LARGE: '大型株',
} satisfies Record<CompanySizeClass, string>

export const COMPANY_GROWTH_PROFILE_LABELS = {
  STABLE: '安定型',
  GROWTH: '成長型',
  CYCLICAL: '景気循環型',
} satisfies Record<CompanyGrowthProfile, string>

export const COMPANY_FINANCIAL_STRENGTH_LABELS = {
  WEAK: 'やや弱い',
  STANDARD: '標準',
  STRONG: '強い',
} satisfies Record<CompanyFinancialStrength, string>

export const INFORMATION_CATEGORY_LABELS = {
  OFFICIAL_NEWS: '公式発表',
  MARKET_DATA: '市況データ',
  EARNINGS: '決算情報',
  ANALYSIS: 'アナリスト分析',
  UNVERIFIED: '未確認情報',
} satisfies Record<InformationCategory, string>

export const INFORMATION_NATURE_LABELS = {
  FACT: '事実',
  FORECAST: '予測',
  OPINION: '意見',
} satisfies Record<InformationNature, string>

export const INFORMATION_CONFIDENCE_LABELS = {
  HIGH: '確度: 高',
  MEDIUM: '確度: 中',
  UNKNOWN: '確度: 不明',
} satisfies Record<InformationConfidence, string>

export const ECONOMIC_INDICATOR_KIND_LABELS = {
  ECONOMY: '景気',
  PRICE: '物価',
  INTEREST_RATE: '金利',
  FX: '為替',
  POLICY: '政策',
} satisfies Record<EconomicIndicatorKind, string>

export const RESEARCH_DESK_PANEL_LABELS = {
  COMPANIES: '企業情報',
  NEWS: 'ニュース',
  STATISTICS: '統計資料',
  TEAM_NOTES: 'チームノート',
  ORDERS: '注文',
} satisfies Record<ResearchDeskPanelId, string>

export const ORDER_SIDE_LABELS = {
  BUY: '買い',
  SELL: '売り',
} satisfies Record<OrderSide, string>

export const ORDER_STATUS_LABELS = {
  PENDING: '受付済み（次バッチ待ち）',
  CANCELLED: '取消済み',
  PROCESSING: '処理中',
  FILLED: '約定済み',
  REJECTED: '不成立・却下',
} satisfies Record<OrderStatus, string>

export const formatCompanySize = (value: string | null | undefined): string =>
  safeLabel(value, COMPANY_SIZE_LABELS, '企業規模を確認できません')
export const formatCompanyGrowthProfile = (value: string | null | undefined): string =>
  safeLabel(value, COMPANY_GROWTH_PROFILE_LABELS, '成長特性を確認できません')
export const formatCompanyFinancialStrength = (value: string | null | undefined): string =>
  safeLabel(value, COMPANY_FINANCIAL_STRENGTH_LABELS, '財務状態を確認できません')
export const formatInformationCategory = (value: string | null | undefined): string =>
  safeLabel(value, INFORMATION_CATEGORY_LABELS, 'ニュース種別を確認できません')
export const formatInformationNature = (value: string | null | undefined): string =>
  safeLabel(value, INFORMATION_NATURE_LABELS, '情報の性質を確認できません')
export const formatInformationConfidence = (value: string | null | undefined): string =>
  safeLabel(value, INFORMATION_CONFIDENCE_LABELS, '確度を確認できません')
export const formatEconomicIndicatorKind = (value: string | null | undefined): string =>
  safeLabel(value, ECONOMIC_INDICATOR_KIND_LABELS, '統計種別を確認できません')
export const formatResearchDeskPanel = (value: string | null | undefined): string =>
  safeLabel(value, RESEARCH_DESK_PANEL_LABELS, '機能名を確認できません')
export const formatOrderSide = (value: string | null | undefined): string =>
  safeLabel(value, ORDER_SIDE_LABELS, '売買区分を確認できません')
export const formatOrderStatus = (value: string | null | undefined): string =>
  safeLabel(value, ORDER_STATUS_LABELS, '注文状態を確認できません')
```

- [ ] **Step 4: Run market-label tests**

Run:

```bash
npm test -- src/lib/presentation/marketLabels.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck package-derived unions**

Run:

```bash
npm run typecheck
```

Expected: PASS. Keep `CompanyGrowthProfile` and `CompanyFinancialStrength` derived from `CompanyPublicView`; do not replace them with hand-written `string` maps.

- [ ] **Step 6: Commit**

```bash
git add src/lib/presentation/marketLabels.ts src/lib/presentation/marketLabels.test.ts
git commit -m "feat: define market presentation vocabulary"
```

---

### Task 4: Establish home-economics presentation vocabulary

**Files:**
- Create: `src/lib/presentation/householdLabels.ts`
- Create: `src/lib/presentation/householdLabels.test.ts`

**Interfaces:**
- Consumes: `safeLabel`; type-only `HouseholdProfile`, `AssetPosition`, `CourseFormat`, `GoalPackage`, `Liability` from `@stock-league/household-authoring-content`; `AdvancedHouseholdTeamStateView` from `src/lib/lessonRuns/liveTypes.ts`.
- Produces: fail-closed labels for life stage, asset type, course format, liabilities, goal packages, visible concepts, and household round state. Project C will compose these primitives into profile labels and will handle DTO changes; Project A does not compose runtime household entities.

- [ ] **Step 1: Write failing household-label tests**

Create `src/lib/presentation/householdLabels.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  formatHouseholdAssetType,
  formatHouseholdConcept,
  formatHouseholdCourseFormat,
  formatHouseholdGoalPackage,
  formatHouseholdLiabilityKind,
  formatHouseholdLifeStage,
  formatHouseholdRoundStatus,
} from './householdLabels'

describe('home economics presentation labels', () => {
  it('maps semantic household values to Japanese product language', () => {
    expect(formatHouseholdLifeStage('CHILD_REARING')).toBe('子育て期')
    expect(formatHouseholdAssetType('DOMESTIC_STOCK')).toBe('国内株式')
    expect(formatHouseholdCourseFormat('COMMON_CONDITIONS')).toBe('共通条件')
    expect(formatHouseholdLiabilityKind('MORTGAGE')).toBe('住宅ローン')
    expect(formatHouseholdGoalPackage('RETIREMENT_PREP')).toBe('退職準備')
    expect(formatHouseholdConcept('ASSET_DIVERSIFICATION')).toBe('資産分散')
    expect(formatHouseholdRoundStatus('SETTLING')).toBe('集計中')
  })

  it('never echoes an unknown household token', () => {
    const raw = 'UNKNOWN_INTERNAL_TOKEN'
    const results = [
      formatHouseholdLifeStage(raw),
      formatHouseholdAssetType(raw),
      formatHouseholdCourseFormat(raw),
      formatHouseholdLiabilityKind(raw),
      formatHouseholdGoalPackage(raw),
      formatHouseholdConcept(raw),
      formatHouseholdRoundStatus(raw),
    ]

    for (const result of results) expect(result).not.toContain(raw)
  })
})
```

- [ ] **Step 2: Run the household-label test and verify it fails**

Run:

```bash
npm test -- src/lib/presentation/householdLabels.test.ts
```

Expected: FAIL because `./householdLabels` does not exist.

- [ ] **Step 3: Implement household maps and formatters**

Create `src/lib/presentation/householdLabels.ts`:

```ts
import type {
  AssetPosition,
  CourseFormat,
  GoalPackage,
  HouseholdProfile,
  Liability,
} from '@stock-league/household-authoring-content'
import type { AdvancedHouseholdTeamStateView } from '../lessonRuns/liveTypes'
import { safeLabel } from './safeLabel'

type HouseholdLifeStage = HouseholdProfile['lifeStage']
type HouseholdAssetType = AssetPosition['assetType']
type HouseholdLiabilityKind = Liability['kind']
type HouseholdRoundStatus = AdvancedHouseholdTeamStateView['roundStatus']

export type HouseholdConcept =
  | 'INSURANCE'
  | 'HOUSING'
  | 'ASSET_DIVERSIFICATION'
  | 'RETIREMENT_PLANNING'
  | 'EMERGENCY_FUND'
  | 'EDUCATION_FUND'
  | 'RISK_MANAGEMENT'

export const HOUSEHOLD_LIFE_STAGE_LABELS = {
  STUDENT: '学生期',
  INDEPENDENT: '独立期',
  FAMILY_FORMATION: '家族形成期',
  CHILD_REARING: '子育て期',
  PRE_RETIREMENT: '退職準備期',
  RETIRED: '退職後',
} satisfies Record<HouseholdLifeStage, string>

export const HOUSEHOLD_ASSET_TYPE_LABELS = {
  CASH: '現金',
  SAVINGS_DEPOSIT: '預貯金',
  BOND: '債券',
  DOMESTIC_STOCK: '国内株式',
  FOREIGN_STOCK: '外国株式',
  INVESTMENT_TRUST: '投資信託',
} satisfies Record<HouseholdAssetType, string>

export const HOUSEHOLD_COURSE_FORMAT_LABELS = {
  COMMON_CONDITIONS: '共通条件',
  ROLE_VARIANT: '役割別',
  STAGE_SPLIT: 'ライフステージ別',
  MULTI_PERSON_PER_TEAM: 'チーム内複数世帯',
} satisfies Record<CourseFormat, string>

export const HOUSEHOLD_LIABILITY_KIND_LABELS = {
  MORTGAGE: '住宅ローン',
  OTHER_LOAN: 'その他の借入',
} satisfies Record<HouseholdLiabilityKind, string>

export const HOUSEHOLD_GOAL_PACKAGE_LABELS = {
  EMERGENCY_FUND: '緊急資金',
  HOME_PURCHASE: '住宅購入',
  EDUCATION_FUND: '教育資金',
  RETIREMENT_PREP: '退職準備',
  RISK_DIVERSIFICATION: 'リスク分散',
  INSURANCE_AND_PREPAREDNESS: '保険と備え',
  OVERALL_BALANCE: '総合バランス',
} satisfies Record<GoalPackage, string>

export const HOUSEHOLD_CONCEPT_LABELS = {
  INSURANCE: '保険',
  HOUSING: '住宅ローン',
  ASSET_DIVERSIFICATION: '資産分散',
  RETIREMENT_PLANNING: '老後資金',
  EMERGENCY_FUND: '緊急資金',
  EDUCATION_FUND: '教育資金',
  RISK_MANAGEMENT: 'リスク管理',
} satisfies Record<HouseholdConcept, string>

export const HOUSEHOLD_ROUND_STATUS_LABELS = {
  OPEN: '受付中',
  SETTLING: '集計中',
} satisfies Record<HouseholdRoundStatus, string>

export const formatHouseholdLifeStage = (value: string | null | undefined): string =>
  safeLabel(value, HOUSEHOLD_LIFE_STAGE_LABELS, 'ライフステージを確認できません')
export const formatHouseholdAssetType = (value: string | null | undefined): string =>
  safeLabel(value, HOUSEHOLD_ASSET_TYPE_LABELS, '資産種別を確認できません')
export const formatHouseholdCourseFormat = (value: string | null | undefined): string =>
  safeLabel(value, HOUSEHOLD_COURSE_FORMAT_LABELS, '授業形式を確認できません')
export const formatHouseholdLiabilityKind = (value: string | null | undefined): string =>
  safeLabel(value, HOUSEHOLD_LIABILITY_KIND_LABELS, '借入種別を確認できません')
export const formatHouseholdGoalPackage = (value: string | null | undefined): string =>
  safeLabel(value, HOUSEHOLD_GOAL_PACKAGE_LABELS, '学習目標を確認できません')
export const formatHouseholdConcept = (value: string | null | undefined): string =>
  safeLabel(value, HOUSEHOLD_CONCEPT_LABELS, '学習項目を確認できません')
export const formatHouseholdRoundStatus = (value: string | null | undefined): string =>
  safeLabel(value, HOUSEHOLD_ROUND_STATUS_LABELS, 'ラウンド状態を確認できません')
```

The type-only import from `@stock-league/household-authoring-content` is deliberate: the client already imports that package in `src/lib/lessonTemplates/types.ts`, and these imports are erased at runtime. Do not import or expose authoring-only data values in rendered UI.

- [ ] **Step 4: Run household-label tests**

Run:

```bash
npm test -- src/lib/presentation/householdLabels.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck household package-derived types**

Run:

```bash
npm run typecheck
```

Expected: PASS. Do not weaken `HouseholdLifeStage`, `HouseholdAssetType`, `CourseFormat`, `GoalPackage`, or `HouseholdLiabilityKind` to `string` to silence missing-label errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/presentation/householdLabels.ts src/lib/presentation/householdLabels.test.ts
git commit -m "feat: define household presentation vocabulary"
```

---

### Task 5: Establish organization, billing, and archive presentation vocabulary

**Files:**
- Create: `src/lib/presentation/organizationLabels.ts`
- Create: `src/lib/presentation/organizationLabels.test.ts`

**Interfaces:**
- Consumes: `safeLabel`; `OrgMember`; `Invitation`; `BillingOverview`; `AnnualArchiveJobStatus`.
- Produces: exhaustive role/status/payment/invoice/archive maps and safe formatters used by Project E.

- [ ] **Step 1: Write failing organization-label tests**

Create `src/lib/presentation/organizationLabels.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  formatAnnualArchiveJobStatus,
  formatBillingPaymentMethod,
  formatInvitationRole,
  formatInvitationStatus,
  formatInvoiceStatus,
  formatInvoiceSubscriptionStatus,
  formatOrgMemberRole,
  formatOrgMemberStatus,
} from './organizationLabels'

describe('organization presentation labels', () => {
  it('maps organization and billing values to human-readable labels', () => {
    expect(formatOrgMemberRole('owner')).toBe('組織オーナー')
    expect(formatOrgMemberRole('admin')).toBe('管理者')
    expect(formatOrgMemberStatus('suspended')).toBe('利用停止')
    expect(formatInvitationStatus('PENDING')).toBe('招待中')
    expect(formatInvitationRole('teacher')).toBe('教師')
    expect(formatBillingPaymentMethod('BANK_TRANSFER')).toBe('銀行振込')
    expect(formatInvoiceSubscriptionStatus('CREATING')).toBe('申込処理中')
    expect(formatInvoiceStatus('OVERDUE')).toBe('支払期限超過')
    expect(formatAnnualArchiveJobStatus('CANCELLING')).toBe('取消処理中')
  })

  it('never echoes an unknown organization token', () => {
    const raw = 'UNKNOWN_INTERNAL_TOKEN'
    const results = [
      formatOrgMemberRole(raw),
      formatOrgMemberStatus(raw),
      formatInvitationStatus(raw),
      formatInvitationRole(raw),
      formatBillingPaymentMethod(raw),
      formatInvoiceSubscriptionStatus(raw),
      formatInvoiceStatus(raw),
      formatAnnualArchiveJobStatus(raw),
    ]

    for (const result of results) expect(result).not.toContain(raw)
  })
})
```

- [ ] **Step 2: Run the organization-label test and verify it fails**

Run:

```bash
npm test -- src/lib/presentation/organizationLabels.test.ts
```

Expected: FAIL because `./organizationLabels` does not exist.

- [ ] **Step 3: Implement organization/billing/archive maps and formatters**

Create `src/lib/presentation/organizationLabels.ts`:

```ts
import type { BillingOverview } from '../billing/invoiceSubscription'
import type { Invitation } from '../organizations/invitations'
import type { OrgMember } from '../organizations/orgMembers'
import type { AnnualArchiveJobStatus } from '../privacy/annualArchive'
import { safeLabel } from './safeLabel'

type BillingPaymentMethod = NonNullable<BillingOverview['paymentMethod']>
type InvoiceSubscriptionStatus = NonNullable<BillingOverview['invoiceSubscription']>['status']
type InvoiceStatus = BillingOverview['invoices'][number]['status']

export const ORG_MEMBER_ROLE_LABELS = {
  owner: '組織オーナー',
  admin: '管理者',
  teacher: '教師',
} satisfies Record<OrgMember['role'], string>

export const ORG_MEMBER_STATUS_LABELS = {
  active: '有効',
  suspended: '利用停止',
} satisfies Record<OrgMember['status'], string>

export const INVITATION_STATUS_LABELS = {
  PENDING: '招待中',
  ACCEPTED: '参加済み',
  REVOKED: '失効済み',
} satisfies Record<Invitation['status'], string>

export const INVITATION_ROLE_LABELS = {
  admin: '管理者',
  teacher: '教師',
} satisfies Record<Invitation['role'], string>

export const BILLING_PAYMENT_METHOD_LABELS = {
  CARD: 'カード',
  INVOICE: '請求書',
  BANK_TRANSFER: '銀行振込',
  MANUAL: '手動登録',
} satisfies Record<BillingPaymentMethod, string>

export const INVOICE_SUBSCRIPTION_STATUS_LABELS = {
  CREATING: '申込処理中',
  ACTIVE: '請求書払い',
  SCHEDULED: '切替予定',
} satisfies Record<InvoiceSubscriptionStatus, string>

export const INVOICE_STATUS_LABELS = {
  DRAFT: '作成中',
  PENDING: '支払待ち',
  PAID: '支払済み',
  OVERDUE: '支払期限超過',
  CANCELLED: '取消済み',
} satisfies Record<InvoiceStatus, string>

export const ANNUAL_ARCHIVE_JOB_STATUS_LABELS = {
  SCHEDULED: '予約中',
  RUNNING: '処理中',
  CANCELLING: '取消処理中',
  COMPLETED: '完了',
  CANCELLED: '取消済み',
  FAILED: '失敗（再試行可能）',
} satisfies Record<AnnualArchiveJobStatus, string>

export const formatOrgMemberRole = (value: string | null | undefined): string =>
  safeLabel(value, ORG_MEMBER_ROLE_LABELS, '権限を確認できません')
export const formatOrgMemberStatus = (value: string | null | undefined): string =>
  safeLabel(value, ORG_MEMBER_STATUS_LABELS, 'メンバー状態を確認できません')
export const formatInvitationStatus = (value: string | null | undefined): string =>
  safeLabel(value, INVITATION_STATUS_LABELS, '招待状態を確認できません')
export const formatInvitationRole = (value: string | null | undefined): string =>
  safeLabel(value, INVITATION_ROLE_LABELS, '招待権限を確認できません')
export const formatBillingPaymentMethod = (value: string | null | undefined): string =>
  safeLabel(value, BILLING_PAYMENT_METHOD_LABELS, '支払方法を確認できません')
export const formatInvoiceSubscriptionStatus = (value: string | null | undefined): string =>
  safeLabel(value, INVOICE_SUBSCRIPTION_STATUS_LABELS, '請求設定を確認できません')
export const formatInvoiceStatus = (value: string | null | undefined): string =>
  safeLabel(value, INVOICE_STATUS_LABELS, '請求状態を確認できません')
export const formatAnnualArchiveJobStatus = (value: string | null | undefined): string =>
  safeLabel(value, ANNUAL_ARCHIVE_JOB_STATUS_LABELS, '処理状態を確認できません')
```

Do not add `ChildSchool.verificationStatus` to this file yet. Its client type is currently only `string`; Project E must first trace the server-side contract and then add a guarded map from confirmed values rather than guessing a union in Project A.

- [ ] **Step 4: Run organization-label tests**

Run:

```bash
npm test -- src/lib/presentation/organizationLabels.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck the organization maps**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/presentation/organizationLabels.ts src/lib/presentation/organizationLabels.test.ts
git commit -m "feat: define organization presentation vocabulary"
```

---

### Task 6: Separate common user-facing error copy from monitoring

**Files:**
- Create: `src/lib/presentation/userFacingError.ts`
- Create: `src/lib/presentation/userFacingError.test.ts`
- Modify: `src/lib/monitoring/describeError.ts`
- Modify: `src/lib/monitoring/describeError.test.ts`

**Interfaces:**
- Consumes: thrown values whose only stable common signal is optional `.code`.
- Produces: `CommonUserFacingErrorCode`, `classifyCommonUserFacingError(error)`, `describeUserFacingError(error, fallback)`; preserves existing `describeError` and `handleFailure` external signatures through `src/lib/monitoring/describeError.ts`.

- [ ] **Step 1: Write failing presentation-error tests**

Create `src/lib/presentation/userFacingError.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  classifyCommonUserFacingError,
  describeUserFacingError,
} from './userFacingError'

describe('common user-facing errors', () => {
  it('classifies stable error codes without reading the backend message', () => {
    expect(classifyCommonUserFacingError({ code: 'functions/unauthenticated' })).toBe('AUTHENTICATION')
    expect(classifyCommonUserFacingError({ code: 'permission-denied' })).toBe('PERMISSION')
    expect(classifyCommonUserFacingError({ code: 'functions/unavailable' })).toBe('NETWORK')
    expect(classifyCommonUserFacingError({ code: 'deadline-exceeded' })).toBe('NETWORK')
    expect(classifyCommonUserFacingError({ code: 'resource-exhausted' })).toBe('QUOTA')
    expect(classifyCommonUserFacingError(new Error('Revision mismatch'))).toBe('UNKNOWN')
  })

  it('returns action-oriented generic copy for known common categories', () => {
    expect(describeUserFacingError({ code: 'functions/unauthenticated' }, '失敗しました。')).toContain('ログイン状態')
    expect(describeUserFacingError({ code: 'permission-denied' }, '失敗しました。')).toContain('権限')
    expect(describeUserFacingError({ code: 'unavailable' }, '失敗しました。')).toContain('通信')
    expect(describeUserFacingError({ code: 'resource-exhausted' }, '失敗しました。')).toContain('利用上限')
  })

  it('uses only the caller fallback for unknown errors and never echoes Error.message', () => {
    const raw = 'Revision mismatch: internal revision=42'
    const result = describeUserFacingError(new Error(raw), '保存できませんでした。もう一度お試しください。')

    expect(result).toBe('保存できませんでした。もう一度お試しください。')
    expect(result).not.toContain(raw)
    expect(result).not.toContain('Revision mismatch')
  })
})
```

- [ ] **Step 2: Add a failing non-echo assertion to the existing monitoring tests**

In `src/lib/monitoring/describeError.test.ts`, keep the existing throttling tests and replace the teacher/market-specific permission assertion with generic wording. Add this test inside the existing `describe('describeError', ...)` block:

```ts
it('never exposes the raw message for an unclassified error', () => {
  const raw = 'backend collection lessonRuns/private-path failed'
  const result = describeError(new Error(raw), '操作に失敗しました。')

  expect(result).toBe('操作に失敗しました。')
  expect(result).not.toContain(raw)
})
```

Update the first permission test to:

```ts
it('explains a permission failure without teacher/market-specific assumptions', () => {
  expect(describeError({ code: 'permission-denied' }, '失敗しました。')).toContain('権限')
  expect(describeError({ code: 'PERMISSION_DENIED' }, '失敗しました。')).not.toContain('市場')
})
```

Do not delete the `handleFailure` cooldown tests.

- [ ] **Step 3: Run both error test files and verify failure**

Run:

```bash
npm test -- src/lib/presentation/userFacingError.test.ts src/lib/monitoring/describeError.test.ts
```

Expected: FAIL because `userFacingError.ts` does not exist and the current permission copy still contains teacher/market-specific wording.

- [ ] **Step 4: Implement common error classification and copy**

Create `src/lib/presentation/userFacingError.ts`:

```ts
export type CommonUserFacingErrorCode =
  | 'AUTHENTICATION'
  | 'PERMISSION'
  | 'NETWORK'
  | 'QUOTA'
  | 'UNKNOWN'

const errorCodeOf = (error: unknown): string =>
  typeof error === 'object' && error && 'code' in error
    ? String((error as { code: unknown }).code).toLowerCase()
    : ''

export const classifyCommonUserFacingError = (error: unknown): CommonUserFacingErrorCode => {
  const code = errorCodeOf(error)
  if (code.includes('unauthenticated')) return 'AUTHENTICATION'
  if (code.includes('permission')) return 'PERMISSION'
  if (code.includes('unavailable') || code.includes('network') || code.includes('deadline')) return 'NETWORK'
  if (code.includes('resource-exhausted') || code.includes('quota')) return 'QUOTA'
  return 'UNKNOWN'
}

const COMMON_ERROR_MESSAGES = {
  AUTHENTICATION: 'ログイン状態を確認して、もう一度お試しください。',
  PERMISSION: 'この操作を実行する権限がありません。必要な権限があるか確認してください。',
  NETWORK: '通信が不安定です。ネットワークを確認して、もう一度お試しください。',
  QUOTA: '現在、利用上限に達しています。時間をおいて、もう一度お試しください。',
} satisfies Record<Exclude<CommonUserFacingErrorCode, 'UNKNOWN'>, string>

export const describeUserFacingError = (error: unknown, fallback: string): string => {
  const code = classifyCommonUserFacingError(error)
  return code === 'UNKNOWN' ? fallback : COMMON_ERROR_MESSAGES[code]
}
```

Do not inspect `error.message`, `error.details`, serialized stack traces, or arbitrary backend strings in this common mapper.

- [ ] **Step 5: Refactor monitoring compatibility surface to delegate presentation copy**

Update `src/lib/monitoring/describeError.ts` so its user-copy path delegates to the new helper while its reporting logic remains local:

```ts
import { describeUserFacingError } from '../presentation/userFacingError'
import { reportError } from './errorReporting'

const codeOf = (error: unknown): string =>
  typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code).toLowerCase() : ''

export const describeError = (error: unknown, fallback: string): string =>
  describeUserFacingError(error, fallback)

export const ERROR_REPORT_COOLDOWN_MILLIS = 60_000

const lastReportedAtMillis = new Map<string, number>()
const throttleKey = (error: unknown, fallback: string): string => `${codeOf(error)}|${fallback}`

export const handleFailure = (error: unknown, fallback: string, nowMillis: () => number = Date.now): string => {
  const key = throttleKey(error, fallback)
  const now = nowMillis()
  const last = lastReportedAtMillis.get(key)
  if (last === undefined || now - last >= ERROR_REPORT_COOLDOWN_MILLIS) {
    lastReportedAtMillis.set(key, now)
    reportError(error)
  }
  return describeUserFacingError(error, fallback)
}
```

Retain the existing explanatory JSDoc around cooldown/throttling where it is still accurate. Remove only the old teacher/market-specific `describeError` JSDoc and wording.

- [ ] **Step 6: Run both error test files**

Run:

```bash
npm test -- src/lib/presentation/userFacingError.test.ts src/lib/monitoring/describeError.test.ts
```

Expected: PASS, including all pre-existing `handleFailure` throttling tests.

- [ ] **Step 7: Typecheck the compatibility refactor**

Run:

```bash
npm run typecheck
```

Expected: PASS without changing any existing consumer import from `src/lib/monitoring/describeError.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/presentation/userFacingError.ts src/lib/presentation/userFacingError.test.ts src/lib/monitoring/describeError.ts src/lib/monitoring/describeError.test.ts
git commit -m "refactor: separate user-facing error copy from monitoring"
```

---

### Task 7: Remove implementation terminology from the app-wide fatal error UI

**Files:**
- Modify: `src/components/AppErrorBoundary.tsx`
- Modify: `src/components/AppErrorBoundary.test.tsx`

**Interfaces:**
- Consumes: existing `reportError(error)` monitoring behavior.
- Produces: fatal/configuration error UI that contains only actionable user language and no `CONNECTION ERROR`, `CONFIGURATION ERROR`, `Firebase`, or `App Check` text.

- [ ] **Step 1: Rewrite tests first to encode the new negative invariant**

Replace the current configuration-copy assertion in `src/components/AppErrorBoundary.test.tsx` and strengthen both tests:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary, ConfigurationError } from './AppErrorBoundary'

describe('application error states', () => {
  it('configuration error uses generic user-facing copy with no implementation terminology', () => {
    render(<ConfigurationError />)

    expect(screen.getByRole('heading', { name: '利用を開始できません' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('必要な設定を確認できませんでした。管理者に連絡してください。')
    expect(screen.queryByText(/Firebase/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/App Check/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/CONFIGURATION ERROR/i)).not.toBeInTheDocument()
  })

  it('offers a reload action after an unhandled error without exposing technical labels', () => {
    const Broken = () => { throw new Error('backend-secret-message') }
    const originalError = console.error
    console.error = vi.fn()

    try {
      render(<AppErrorBoundary><Broken /></AppErrorBoundary>)
      expect(screen.getByRole('heading', { name: 'アプリを開始できませんでした' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '再読み込み' })).toHaveAttribute('type', 'button')
      expect(screen.queryByText(/CONNECTION ERROR/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/backend-secret-message/i)).not.toBeInTheDocument()
    } finally {
      console.error = originalError
    }
  })
})
```

The `try/finally` is required so a failed assertion does not leave `console.error` mocked for later tests.

- [ ] **Step 2: Run the AppErrorBoundary test and verify it fails against current copy**

Run:

```bash
npm test -- src/components/AppErrorBoundary.test.tsx
```

Expected: FAIL because the current component still renders `CONFIGURATION ERROR`, `Firebase`, `App Check`, and `CONNECTION ERROR`.

- [ ] **Step 3: Simplify `ErrorState` and replace technical copy**

Update `src/components/AppErrorBoundary.tsx` to remove the `label` prop entirely:

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Alert, Box, Button, Card, CardContent, Stack, Typography } from '@mui/material'
import { reportError } from '../lib/monitoring/errorReporting'

interface Props { children: ReactNode }
interface State { failed: boolean }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error(error, info)
    reportError(error)
  }

  render() {
    if (this.state.failed) {
      return (
        <ErrorState
          title="アプリを開始できませんでした"
          message="ページを再読み込みしてください。解決しない場合は、先生または管理者に連絡してください。"
          action
        />
      )
    }
    return this.props.children
  }
}

export const ConfigurationError = () => (
  <ErrorState
    title="利用を開始できません"
    message="必要な設定を確認できませんでした。管理者に連絡してください。"
  />
)

const ErrorState = ({
  title,
  message,
  action = false,
}: {
  title: string
  message: string
  action?: boolean
}) => (
  <Box component="main" sx={{ minHeight: '100svh', display: 'grid', placeItems: 'center', p: 3 }}>
    <Card sx={{ width: 'min(100%, 520px)' }}>
      <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
        <Stack spacing={2}>
          <Typography variant="h1">{title}</Typography>
          <Alert severity="error">{message}</Alert>
          {action && (
            <Button type="button" variant="contained" size="large" onClick={() => window.location.reload()}>
              再読み込み
            </Button>
          )}
        </Stack>
      </CardContent>
    </Card>
  </Box>
)
```

Do not surface the caught `Error.message` anywhere in this component. `componentDidCatch` continues to report the full `Error` through monitoring.

- [ ] **Step 4: Run the AppErrorBoundary test**

Run:

```bash
npm test -- src/components/AppErrorBoundary.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run the Project A focused test set**

Run:

```bash
npm test -- \
  src/lib/presentation/safeLabel.test.ts \
  src/lib/presentation/lessonLabels.test.ts \
  src/lib/presentation/marketLabels.test.ts \
  src/lib/presentation/householdLabels.test.ts \
  src/lib/presentation/organizationLabels.test.ts \
  src/lib/presentation/userFacingError.test.ts \
  src/lib/monitoring/describeError.test.ts \
  src/components/AppErrorBoundary.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/AppErrorBoundary.tsx src/components/AppErrorBoundary.test.tsx
git commit -m "fix: hide implementation details from fatal error UI"
```

---

### Task 8: Project A integration verification

**Files:**
- No new production file expected.
- Inspect all files created/modified in Tasks 1-7.

**Interfaces:**
- Consumes: all Project A outputs.
- Produces: a verified foundation that Projects B-E can import without further contract changes.

- [ ] **Step 1: Confirm no technical fatal-error strings remain**

Run:

```bash
rg -n "CONNECTION ERROR|CONFIGURATION ERROR|Firebase|App Check" src/components/AppErrorBoundary.tsx src/components/AppErrorBoundary.test.tsx
```

Expected: matches are allowed only in the test file's negative assertions; `src/components/AppErrorBoundary.tsx` itself must have zero matches.

Then run the production-only check:

```bash
rg -n "CONNECTION ERROR|CONFIGURATION ERROR|Firebase|App Check" src/components/AppErrorBoundary.tsx
```

Expected: no output, exit status 1 from `rg` because no matches exist.

- [ ] **Step 2: Confirm the presentation modules do not echo the lookup value**

Run:

```bash
rg -n "\?\?\s*(value|status|role|mode|type)|return\s+value\b" src/lib/presentation
```

Expected: no production-code match that returns an unknown input as display fallback. If a test fixture line happens to match, inspect it manually; do not weaken the production invariant.

- [ ] **Step 3: Run all Project A focused tests again**

Run:

```bash
npm test -- \
  src/lib/presentation/safeLabel.test.ts \
  src/lib/presentation/lessonLabels.test.ts \
  src/lib/presentation/marketLabels.test.ts \
  src/lib/presentation/householdLabels.test.ts \
  src/lib/presentation/organizationLabels.test.ts \
  src/lib/presentation/userFacingError.test.ts \
  src/lib/monitoring/describeError.test.ts \
  src/components/AppErrorBoundary.test.tsx
```

Expected: PASS with zero failed tests.

- [ ] **Step 4: Run repository-wide client verification relevant to this UI-only project**

Run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Expected: all four commands exit 0. Do not claim Project A complete if any command fails; record the exact failure and distinguish a pre-existing repository failure from a Project A regression before proceeding.

- [ ] **Step 5: Inspect the diff for Project A scope creep**

Run:

```bash
git diff --stat HEAD~7..HEAD
git diff HEAD~7..HEAD -- src/lib/presentation src/lib/monitoring/describeError.ts src/lib/monitoring/describeError.test.ts src/components/AppErrorBoundary.tsx src/components/AppErrorBoundary.test.tsx
```

Expected: only the files listed in this plan are changed by Project A commits. If the branch contains unrelated intervening commits, replace `HEAD~7` with the commit immediately before Task 1 and inspect the same paths.

- [ ] **Step 6: Record handoff contract for Projects B-E in the implementation report**

The implementation report must state these exact reusable interfaces:

```text
safeLabel(value, labels, fallback)
formatLessonRunStatus
formatLessonDisplayMode
formatLessonRunRole
formatParticipantStatus
formatCurrentPhaseLabel
formatCompanySize
formatCompanyGrowthProfile
formatCompanyFinancialStrength
formatInformationCategory
formatInformationNature
formatInformationConfidence
formatEconomicIndicatorKind
formatResearchDeskPanel
formatOrderSide
formatOrderStatus
formatHouseholdLifeStage
formatHouseholdAssetType
formatHouseholdCourseFormat
formatHouseholdLiabilityKind
formatHouseholdGoalPackage
formatHouseholdConcept
formatHouseholdRoundStatus
formatOrgMemberRole
formatOrgMemberStatus
formatInvitationStatus
formatInvitationRole
formatBillingPaymentMethod
formatInvoiceSubscriptionStatus
formatInvoiceStatus
formatAnnualArchiveJobStatus
classifyCommonUserFacingError
describeUserFacingError
describeError (compatibility API retained)
handleFailure (compatibility API retained)
```

Also state that Projects B-E must not copy these maps back into components; they import the relevant presentation module.

---

## Self-Review Checklist

Before handing this plan to an implementation agent, verify the following against `docs/superpowers/specs/2026-08-24-ui-presentation-boundary-design.md`:

1. **Presentation boundary:** Tasks 1-5 create domain-specific fail-closed presentation vocabulary instead of server-rendered Japanese DTO strings.
2. **Unknown values:** Every formatter test includes an unknown sentinel and proves the sentinel is not returned.
3. **Strong unions:** Known enum maps use `satisfies Record<Union, string>`; only runtime formatter inputs stay `string | null | undefined`.
4. **Error boundary:** Task 6 separates common user copy from monitoring and never reads `Error.message` for UI copy.
5. **Telemetry:** `handleFailure` still reports full errors and preserves its 60-second throttling behavior.
6. **Fatal UI:** Task 7 removes `CONNECTION ERROR`, `CONFIGURATION ERROR`, `Firebase`, and `App Check` from production UI while preserving reload/reporting behavior.
7. **Scope:** No student market screen, household screen/DTO, teacher intervention screen, template/admin screen, or operator screen is migrated in Project A.
8. **Future work:** Project B consumes `marketLabels`; Project C consumes/extends `householdLabels`; Project D consumes `lessonLabels`; Project E consumes/extends `organizationLabels`; Project F performs the repo-wide forbidden-pattern audit.
9. **No guessed contract:** `ChildSchool.verificationStatus` is intentionally deferred because its current client type is plain `string`; Project E must trace confirmed server values before mapping it.
10. **No new dependency:** all code uses current TypeScript/React/Vitest infrastructure.

## Completion Criteria

Project A is complete only when all of the following are true:

- All six `src/lib/presentation/*.test.ts` files pass.
- Existing `src/lib/monitoring/describeError.test.ts` passes with its throttling behavior intact.
- `src/components/AppErrorBoundary.test.tsx` passes and explicitly rejects technical labels/raw thrown text.
- `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` all exit 0.
- No production formatter returns the unknown raw value as fallback.
- No server, DTO, route, or domain screen outside the explicit Project A scope was changed.
- The implementation report lists the reusable interfaces above so Projects B-E can begin in parallel after review.
