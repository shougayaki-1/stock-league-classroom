# Tuning Mode Reference Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**正本:** `docs/superpowers/specs/2026-08-09-tuning-mode-reference-dashboard-design.md`（設計仕様）。矛盾する場合は仕様書を優先する。

**Goal:** Phase C/Dで集約済みの9個のPROVISIONAL調整値（社会科6個・家庭科3個）を、全教師が閲覧できる読み取り専用ダッシュボードで確認できるようにする。

**Architecture:** `functions/`→`src/`のrootDir境界制約により、既存の`tuningConstants.ts`（2ファイル）をクライアントへ直接importできないため、値をJSON化して返す薄いCallableを新設する。値のライブ編集は行わない（v1のスコープ外、設計仕様に明記）。

**Tech Stack:** TypeScript, React, MUI, react-router, Firebase Cloud Functions v2 (`onCall`), Vitest, React Testing Library。

## Global Constraints

- 本計画は**読み取り専用**。`getTuningConstantsCallable`はいかなるFirestore/RTDBへの書き込みも行わない。
- Callableのテストは、期待値をハードコードするのではなく`tuningConstants.ts`（およびその再エクスポート元の各エンジンファイル）から実際にimportした値と比較する — 将来値が変わってもテストが自動的に追従するようにする（設計仕様のテスト方針節を参照）。
- 認可は`requireActiveOrgMember`（既存、`functions/src/organizations/authorization.ts`）と`isCallerTeacher`（既存、`functions/src/organizations/onCall.ts`）をそのまま再利用する。新しい認可ロジックは書かない。
- 新規Callableは`functions/src/index.ts`からexportする（この既知の抜け漏れパターンを再発させない）。
- 画面のルーティングは、Guided Lesson Builderで実装済みの`TemplateRouteGuard`（`src/App.tsx`）をそのまま再利用する。新しいガードコンポーネントを作らない。
- 日本語UI文言を用いる（既存コンポーネントの慣例）。

---

## File Structure

| File | Change |
| --- | --- |
| `functions/src/platformConfig/tuningConstantsResponse.ts`, `.test.ts` | Create（Task 1。既存の2つの`tuningConstants.ts`を集約する純粋関数） |
| `functions/src/platformConfig/onCall.ts`, `.test.ts` | Create（Task 2。`getTuningConstantsCallable`） |
| `functions/src/index.ts` | Modify（Task 2。export追加） |
| `src/lib/platformConfig/getTuningConstants.ts`, `.test.ts` | Create（Task 3。クライアントラッパー） |
| `src/components/teacher/tuning/TuningDashboardPage.tsx`, `.test.tsx` | Create（Task 4） |
| `src/App.tsx`, `.test.tsx` | Modify（Task 5。ルート追加） |

---

## タスク一覧

1. Callableのレスポンス構築ロジック（純粋関数）
2. `getTuningConstantsCallable`（Callable本体・認可・index.ts export）
3. クライアント側Callableラッパー
4. 参照ダッシュボード画面
5. ルーティング配線

---

### Task 1: Callableのレスポンス構築ロジック（純粋関数）

社会科・家庭科の`tuningConstants.ts`が再エクスポートしている9個の値を、設計仕様が定義する`TuningConstantsResponse`形状へ詰める純粋関数を実装する。計算・変換ロジックは持たない。

**Files:**
- Create: `functions/src/platformConfig/tuningConstantsResponse.ts`, `.test.ts`

**Interfaces:**
- Consumes: `PRICE_SENSITIVITY_PRESETS`・`DEFAULT_NOISE_MAGNITUDE_PERCENT`・`DEFAULT_SUDDEN_CHANGE_WARNING_THRESHOLD_PERCENT`（既存、`functions/src/market/engine/priceCalculation.ts`）、`SHORT_TERM_WINDOW_BATCHES`（既存、`functions/src/market/engine/informationImpact.ts`）、`FLAT_BAND_PERCENT`（既存、`functions/src/market/predictionCheckpoint.ts`）、`STALL_DETECTION_THRESHOLD_MILLIS`（既存、`functions/src/market/chainWatchdog.ts`）、`TAX_MODEL_V1_RATE_PERCENT`（既存、`functions/src/homeEconomics/engine/taxAndSocialInsurance.ts`）、`EMERGENCY_FUND_TARGET_MONTHS`（既存、`functions/src/homeEconomics/evaluation.ts`）、`PENSION_REPLACEMENT_RATE_PERCENT_PROVISIONAL_DEFAULT`（既存、`functions/src/homeEconomics/engine/retirement.ts`）
- Produces: `TuningConstantsResponse`型、`buildTuningConstantsResponse(): TuningConstantsResponse`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/platformConfig/tuningConstantsResponse.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildTuningConstantsResponse } from './tuningConstantsResponse'
import { DEFAULT_NOISE_MAGNITUDE_PERCENT, DEFAULT_SUDDEN_CHANGE_WARNING_THRESHOLD_PERCENT, PRICE_SENSITIVITY_PRESETS } from '../market/engine/priceCalculation'
import { SHORT_TERM_WINDOW_BATCHES } from '../market/engine/informationImpact'
import { FLAT_BAND_PERCENT } from '../market/predictionCheckpoint'
import { STALL_DETECTION_THRESHOLD_MILLIS } from '../market/chainWatchdog'
import { TAX_MODEL_V1_RATE_PERCENT } from '../homeEconomics/engine/taxAndSocialInsurance'
import { EMERGENCY_FUND_TARGET_MONTHS } from '../homeEconomics/evaluation'
import { PENSION_REPLACEMENT_RATE_PERCENT_PROVISIONAL_DEFAULT } from '../homeEconomics/engine/retirement'

describe('buildTuningConstantsResponse', () => {
  it('matches the actual current values of every tuning constant, not a hardcoded snapshot', () => {
    const response = buildTuningConstantsResponse()
    expect(response.socialStudies.priceSensitivityPresets).toEqual(PRICE_SENSITIVITY_PRESETS)
    expect(response.socialStudies.defaultNoiseMagnitudePercent).toBe(DEFAULT_NOISE_MAGNITUDE_PERCENT)
    expect(response.socialStudies.defaultSuddenChangeWarningThresholdPercent).toBe(DEFAULT_SUDDEN_CHANGE_WARNING_THRESHOLD_PERCENT)
    expect(response.socialStudies.shortTermWindowBatches).toBe(SHORT_TERM_WINDOW_BATCHES)
    expect(response.socialStudies.flatBandPercent).toBe(FLAT_BAND_PERCENT)
    expect(response.socialStudies.stallDetectionThresholdMillis).toBe(STALL_DETECTION_THRESHOLD_MILLIS)
    expect(response.homeEconomics.taxModelV1RatePercent).toBe(TAX_MODEL_V1_RATE_PERCENT)
    expect(response.homeEconomics.emergencyFundTargetMonths).toBe(EMERGENCY_FUND_TARGET_MONTHS)
    expect(response.homeEconomics.pensionReplacementRatePercentProvisionalDefault).toBe(PENSION_REPLACEMENT_RATE_PERCENT_PROVISIONAL_DEFAULT)
  })

  it('returns a plain JSON-serializable object (no functions, no undefined values)', () => {
    const response = buildTuningConstantsResponse()
    expect(() => JSON.stringify(response)).not.toThrow()
    expect(JSON.parse(JSON.stringify(response))).toEqual(response)
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/platformConfig/tuningConstantsResponse.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`functions/src/platformConfig/tuningConstantsResponse.ts`:

```ts
import { DEFAULT_NOISE_MAGNITUDE_PERCENT, DEFAULT_SUDDEN_CHANGE_WARNING_THRESHOLD_PERCENT, PRICE_SENSITIVITY_PRESETS } from '../market/engine/priceCalculation'
import { SHORT_TERM_WINDOW_BATCHES } from '../market/engine/informationImpact'
import { FLAT_BAND_PERCENT } from '../market/predictionCheckpoint'
import { STALL_DETECTION_THRESHOLD_MILLIS } from '../market/chainWatchdog'
import { TAX_MODEL_V1_RATE_PERCENT } from '../homeEconomics/engine/taxAndSocialInsurance'
import { EMERGENCY_FUND_TARGET_MONTHS } from '../homeEconomics/evaluation'
import { PENSION_REPLACEMENT_RATE_PERCENT_PROVISIONAL_DEFAULT } from '../homeEconomics/engine/retirement'

export interface TuningConstantsResponse {
  socialStudies: {
    priceSensitivityPresets: Record<'INFO_FOCUSED' | 'BALANCED' | 'DEMAND_FOCUSED', { informationWeight: number; demandWeight: number }>
    defaultNoiseMagnitudePercent: number
    defaultSuddenChangeWarningThresholdPercent: number
    shortTermWindowBatches: number
    flatBandPercent: number
    stallDetectionThresholdMillis: number
  }
  homeEconomics: {
    taxModelV1RatePercent: number
    emergencyFundTargetMonths: number
    pensionReplacementRatePercentProvisionalDefault: number
  }
}

/**
 * Read-only reference dashboard's data source (design spec: docs/superpowers/specs/2026-08-09-tuning-mode-reference-dashboard-design.md).
 * Does not compute or transform anything — only re-shapes the existing
 * single-source-of-truth constants already consolidated by Phase C/D's
 * `tuningConstants.ts` files into one response object. Editing a value
 * still requires editing the source file this function imports from and
 * redeploying — this function has no write path.
 */
export const buildTuningConstantsResponse = (): TuningConstantsResponse => ({
  socialStudies: {
    priceSensitivityPresets: PRICE_SENSITIVITY_PRESETS,
    defaultNoiseMagnitudePercent: DEFAULT_NOISE_MAGNITUDE_PERCENT,
    defaultSuddenChangeWarningThresholdPercent: DEFAULT_SUDDEN_CHANGE_WARNING_THRESHOLD_PERCENT,
    shortTermWindowBatches: SHORT_TERM_WINDOW_BATCHES,
    flatBandPercent: FLAT_BAND_PERCENT,
    stallDetectionThresholdMillis: STALL_DETECTION_THRESHOLD_MILLIS,
  },
  homeEconomics: {
    taxModelV1RatePercent: TAX_MODEL_V1_RATE_PERCENT,
    emergencyFundTargetMonths: EMERGENCY_FUND_TARGET_MONTHS,
    pensionReplacementRatePercentProvisionalDefault: PENSION_REPLACEMENT_RATE_PERCENT_PROVISIONAL_DEFAULT,
  },
})
```

- [ ] **Step 4: テストを通す**

Run: `cd functions && npx vitest run src/platformConfig/tuningConstantsResponse.test.ts`
Expected: PASS

- [ ] **Step 5: `npm run typecheck`（functionsワークスペース）**

- [ ] **Step 6: Commit**

```bash
git add functions/src/platformConfig/tuningConstantsResponse.ts functions/src/platformConfig/tuningConstantsResponse.test.ts
git commit -m "feat: add tuning-constants response builder, single-sourced from Phase C/D's tuningConstants.ts files"
```

---

### Task 2: `getTuningConstantsCallable`（Callable本体・認可・index.ts export）

Task 1の`buildTuningConstantsResponse`を、教師のみ・アクティブな組織メンバーのみが呼べるCallableとして公開する。認可は既存の`isCallerTeacher`・`requireActiveOrgMember`をそのまま使う（レッスン単位の権限は不要）。

**Files:**
- Create: `functions/src/platformConfig/onCall.ts`, `.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: `buildTuningConstantsResponse`（Task 1）、`isCallerTeacher`（既存、`functions/src/organizations/onCall.ts`）、`requireActiveOrgMember`（既存、`functions/src/organizations/authorization.ts`）、`personalOrgId`（既存、`functions/src/lib/personalOrgId.ts`）
- Produces: `getTuningConstantsCallable`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/platformConfig/onCall.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { getTuningConstantsCallable } from './onCall'
import { requireActiveOrgMember } from '../organizations/authorization'

vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({}) }))
vi.mock('../organizations/authorization', () => ({ requireActiveOrgMember: vi.fn() }))

const authenticatedRequest = (): CallableRequest => ({
  auth: { uid: 'teacher-1', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } },
} as CallableRequest)

describe('getTuningConstantsCallable', () => {
  it('rejects an unauthenticated caller', async () => {
    await expect(getTuningConstantsCallable.run({ auth: undefined } as CallableRequest)).rejects.toMatchObject({ code: 'unauthenticated' })
  })

  it('rejects a non-teacher (non-Google, or unverified email) caller', async () => {
    const request = { auth: { uid: 'student-1', token: { email_verified: true, firebase: { sign_in_provider: 'anonymous' } } } } as CallableRequest
    await expect(getTuningConstantsCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('rejects a teacher who is not an active org member, without ever building a response', async () => {
    vi.mocked(requireActiveOrgMember).mockRejectedValueOnce(new Error('permission-denied'))
    await expect(getTuningConstantsCallable.run(authenticatedRequest())).rejects.toThrow()
  })

  it('returns the tuning-constants response for an authorized teacher', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    const result = await getTuningConstantsCallable.run(authenticatedRequest())
    expect(result.homeEconomics.taxModelV1RatePercent).toBeTypeOf('number')
    expect(result.socialStudies.priceSensitivityPresets).toBeDefined()
  })

  it('calls requireActiveOrgMember with the caller\'s own personal orgId, never a client-supplied one', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    await getTuningConstantsCallable.run(authenticatedRequest())
    expect(requireActiveOrgMember).toHaveBeenCalledWith(expect.anything(), 'personal_teacher-1', 'teacher-1')
  })
})
```

（`onCall(...).run(request)`＋`.rejects.toMatchObject({ code: '...' })`は`functions/src/homeEconomics/onCall.test.ts`で確認済みの既存呼び出し慣例そのもの。）

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/platformConfig/onCall.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`functions/src/platformConfig/onCall.ts`:

```ts
import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { isCallerTeacher } from '../organizations/onCall'
import { requireActiveOrgMember } from '../organizations/authorization'
import { personalOrgId } from '../lib/personalOrgId'
import { buildTuningConstantsResponse } from './tuningConstantsResponse'

/**
 * Read-only reference dashboard's Callable (design spec: docs/superpowers/specs/2026-08-09-tuning-mode-reference-dashboard-design.md).
 * No `lessonRunId` — this is cross-cutting reference data, not scoped to
 * any single lesson run, so authorization is "active org member" only
 * (same as ensurePersonalOrgCallable), not a per-run teacherRoles check.
 */
export const getTuningConstantsCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  await requireActiveOrgMember(getFirestore(), personalOrgId(request.auth.uid), request.auth.uid)
  return buildTuningConstantsResponse()
})
```

- [ ] **Step 4: テストを通す**

Run: `cd functions && npx vitest run src/platformConfig/onCall.test.ts`
Expected: PASS

- [ ] **Step 5: `functions/src/index.ts`へexportを追加する**

`functions/src/index.ts`の既存export群の末尾へ追加する:

```ts
export { getTuningConstantsCallable } from './platformConfig/onCall'
```

- [ ] **Step 6: `npm run verify --workspace=functions`**

- [ ] **Step 7: Commit**

```bash
git add functions/src/platformConfig/onCall.ts functions/src/platformConfig/onCall.test.ts functions/src/index.ts
git commit -m "feat: add getTuningConstantsCallable, teacher-only read-only reference data"
```

---

### Task 3: クライアント側Callableラッパー

`src/lib/lessonTemplates/publishLessonVersion.ts`と同じ薄いCallable呼び出しパターンで、`getTuningConstantsCallable`を呼ぶクライアント関数を実装する。

**Files:**
- Create: `src/lib/platformConfig/getTuningConstants.ts`, `.test.ts`

**Interfaces:**
- Consumes: なし（Firebase Functions SDKの`httpsCallable`のみ）
- Produces: `TuningConstantsResponse`型（サーバー側と同じ形状をクライアント側で再定義——`functions/`→`src/`のimport境界制約により共有できないため、Guided Lesson Builder計画の`HouseholdStateTeamView`と同じ「手動で同期させる」パターンを踏襲する）、`getTuningConstants(functions: Functions): Promise<TuningConstantsResponse>`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/platformConfig/getTuningConstants.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { getTuningConstants } from './getTuningConstants'

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

describe('getTuningConstants', () => {
  it('calls the getTuningConstantsCallable Callable and returns its data', async () => {
    const mockResponse = { data: { socialStudies: { priceSensitivityPresets: {}, defaultNoiseMagnitudePercent: 0.35, defaultSuddenChangeWarningThresholdPercent: 7, shortTermWindowBatches: 10, flatBandPercent: 0.5, stallDetectionThresholdMillis: 60000 }, homeEconomics: { taxModelV1RatePercent: 20, emergencyFundTargetMonths: 6, pensionReplacementRatePercentProvisionalDefault: 50 } } }
    const callMock = vi.fn().mockResolvedValue(mockResponse)
    vi.mocked(httpsCallable).mockReturnValue(callMock as never)

    const result = await getTuningConstants({} as never)

    expect(httpsCallable).toHaveBeenCalledWith({}, 'getTuningConstantsCallable')
    expect(result).toEqual(mockResponse.data)
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/platformConfig/getTuningConstants.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`src/lib/platformConfig/getTuningConstants.ts`:

```ts
import { httpsCallable, type Functions } from 'firebase/functions'

/**
 * Client-side mirror of functions/src/platformConfig/tuningConstantsResponse.ts's
 * `TuningConstantsResponse` — kept in sync by hand, same as
 * `HouseholdStateTeamView` (Guided Lesson Builder plan), because `functions/`
 * cannot be imported by `src/`.
 */
export interface TuningConstantsResponse {
  socialStudies: {
    priceSensitivityPresets: Record<'INFO_FOCUSED' | 'BALANCED' | 'DEMAND_FOCUSED', { informationWeight: number; demandWeight: number }>
    defaultNoiseMagnitudePercent: number
    defaultSuddenChangeWarningThresholdPercent: number
    shortTermWindowBatches: number
    flatBandPercent: number
    stallDetectionThresholdMillis: number
  }
  homeEconomics: {
    taxModelV1RatePercent: number
    emergencyFundTargetMonths: number
    pensionReplacementRatePercentProvisionalDefault: number
  }
}

export const getTuningConstants = async (functions: Functions): Promise<TuningConstantsResponse> => {
  const call = httpsCallable<void, TuningConstantsResponse>(functions, 'getTuningConstantsCallable')
  const result = await call()
  return result.data
}
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/lib/platformConfig/getTuningConstants.test.ts`
Expected: PASS

- [ ] **Step 5: `npm run typecheck`**

- [ ] **Step 6: Commit**

```bash
git add src/lib/platformConfig/getTuningConstants.ts src/lib/platformConfig/getTuningConstants.test.ts
git commit -m "feat: add client wrapper for getTuningConstantsCallable"
```

---

### Task 4: 参照ダッシュボード画面

タブ「社会科」「家庭科」で切り替える読み取り専用テーブルを実装する。各行は「項目名」「現在値」「意味」「定義場所」の4列。

**Files:**
- Create: `src/components/teacher/tuning/TuningDashboardPage.tsx`, `.test.tsx`

**Interfaces:**
- Consumes: `TuningConstantsResponse`（Task 3）
- Produces: `TuningDashboardPageProps`型、`TuningDashboardPage`コンポーネント

- [ ] **Step 1: 失敗するテストを書く**

`src/components/teacher/tuning/TuningDashboardPage.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TuningDashboardPage } from './TuningDashboardPage'
import type { TuningConstantsResponse } from '../../../lib/platformConfig/getTuningConstants'

const data: TuningConstantsResponse = {
  socialStudies: {
    priceSensitivityPresets: { INFO_FOCUSED: { informationWeight: 0.7, demandWeight: 0.3 }, BALANCED: { informationWeight: 0.5, demandWeight: 0.5 }, DEMAND_FOCUSED: { informationWeight: 0.3, demandWeight: 0.7 } },
    defaultNoiseMagnitudePercent: 0.35, defaultSuddenChangeWarningThresholdPercent: 7,
    shortTermWindowBatches: 10, flatBandPercent: 0.5, stallDetectionThresholdMillis: 60000,
  },
  homeEconomics: { taxModelV1RatePercent: 20, emergencyFundTargetMonths: 6, pensionReplacementRatePercentProvisionalDefault: 50 },
}

describe('TuningDashboardPage', () => {
  it('shows a loading state when data is not yet available', () => {
    render(<TuningDashboardPage data={undefined} error={undefined} />)
    expect(screen.getByLabelText('読み込み中')).toBeInTheDocument()
  })

  it('shows an error message when loading failed', () => {
    render(<TuningDashboardPage data={undefined} error="失敗しました" />)
    expect(screen.getByText('読み込みに失敗しました')).toBeInTheDocument()
  })

  it('renders social-studies values by default', () => {
    render(<TuningDashboardPage data={data} error={undefined} />)
    expect(screen.getByText('0.35')).toBeInTheDocument()
  })

  it('switches to home-economics values when that tab is selected', () => {
    render(<TuningDashboardPage data={data} error={undefined} />)
    fireEvent.click(screen.getByRole('tab', { name: '家庭科' }))
    expect(screen.getByText('20')).toBeInTheDocument()
  })

  it('always shows the read-only notice', () => {
    render(<TuningDashboardPage data={data} error={undefined} />)
    expect(screen.getByText(/変更するにはソースコードの編集と再デプロイが必要です/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/components/teacher/tuning/TuningDashboardPage.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`src/components/teacher/tuning/TuningDashboardPage.tsx`:

```tsx
import { useState } from 'react'
import { Alert, CircularProgress, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, Typography } from '@mui/material'
import type { TuningConstantsResponse } from '../../../lib/platformConfig/getTuningConstants'

export interface TuningDashboardPageProps {
  data: TuningConstantsResponse | undefined
  error: string | undefined
}

interface Row { label: string; value: string; meaning: string; definedIn: string }

const buildSocialStudiesRows = (data: TuningConstantsResponse): Row[] => [
  { label: '需給感度プリセット', value: JSON.stringify(data.socialStudies.priceSensitivityPresets), meaning: '情報と需給、それぞれの価格への影響度の重み', definedIn: 'functions/src/market/engine/priceCalculation.ts' },
  { label: '市場ノイズ幅（%）', value: String(data.socialStudies.defaultNoiseMagnitudePercent), meaning: '1区間ごとに価格へ加わるランダムな変動幅', definedIn: 'functions/src/market/engine/priceCalculation.ts' },
  { label: '急変警告のしきい値（%）', value: String(data.socialStudies.defaultSuddenChangeWarningThresholdPercent), meaning: 'この変化率を超えると「急変」警告が出る', definedIn: 'functions/src/market/engine/priceCalculation.ts' },
  { label: '情報の短期影響区間数', value: String(data.socialStudies.shortTermWindowBatches), meaning: 'ニュース公開後、影響が大きい状態が続く区間数', definedIn: 'functions/src/market/engine/informationImpact.ts' },
  { label: '横ばい判定幅（%）', value: String(data.socialStudies.flatBandPercent), meaning: 'この範囲内の価格変化は予想の正誤判定で「横ばい」扱い', definedIn: 'functions/src/market/predictionCheckpoint.ts' },
  { label: '連鎖切断検知の待機時間（ミリ秒）', value: String(data.socialStudies.stallDetectionThresholdMillis), meaning: 'この時間を過ぎても次の区間が処理されないと停止とみなす', definedIn: 'functions/src/market/chainWatchdog.ts' },
]

const buildHomeEconomicsRows = (data: TuningConstantsResponse): Row[] => [
  { label: '税・社会保険の合算税率（%）', value: String(data.homeEconomics.taxModelV1RatePercent), meaning: '簡略化した税・社会保険モデルv1の一律税率', definedIn: 'functions/src/homeEconomics/engine/taxAndSocialInsurance.ts' },
  { label: '緊急予備資金の目標月数', value: String(data.homeEconomics.emergencyFundTargetMonths), meaning: '生活費の何か月分の現金保有で満点評価とするか', definedIn: 'functions/src/homeEconomics/evaluation.ts' },
  { label: '年金の所得代替率（%）', value: String(data.homeEconomics.pensionReplacementRatePercentProvisionalDefault), meaning: '退職前収入に対する年金給付の既定割合', definedIn: 'functions/src/homeEconomics/engine/retirement.ts' },
]

/** §25 Phase E「試運転」のv1: 読み取り専用の参照ダッシュボード（design spec参照）。 */
export function TuningDashboardPage({ data, error }: TuningDashboardPageProps) {
  const [tab, setTab] = useState(0)

  if (error) return <Alert severity="error">読み込みに失敗しました</Alert>
  if (!data) return <CircularProgress aria-label="読み込み中" />

  const rows = tab === 0 ? buildSocialStudiesRows(data) : buildHomeEconomicsRows(data)

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography variant="h5">試運転用パラメータ一覧</Typography>
      <Alert severity="info">これらの値はコードで固定されており、変更するにはソースコードの編集と再デプロイが必要です。</Alert>
      <Tabs value={tab} onChange={(_, v) => setTab(v)}>
        <Tab label="社会科" />
        <Tab label="家庭科" />
      </Tabs>
      <Table size="small">
        <TableHead>
          <TableRow><TableCell>項目</TableCell><TableCell>現在値</TableCell><TableCell>意味</TableCell><TableCell>定義場所</TableCell></TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.label}>
              <TableCell>{row.label}</TableCell>
              <TableCell>{row.value}</TableCell>
              <TableCell>{row.meaning}</TableCell>
              <TableCell><code>{row.definedIn}</code></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Stack>
  )
}
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/components/teacher/tuning/TuningDashboardPage.test.tsx`
Expected: PASS

- [ ] **Step 5: `npm run typecheck`**

- [ ] **Step 6: Commit**

```bash
git add src/components/teacher/tuning/TuningDashboardPage.tsx src/components/teacher/tuning/TuningDashboardPage.test.tsx
git commit -m "feat: add read-only tuning-constants dashboard page"
```

---

### Task 5: ルーティング配線

`/teacher/tuning`ルートを追加し、Guided Lesson Builderで実装済みの`TemplateRouteGuard`で保護する。マウント時に`getTuningConstants`を1回呼び、結果を`TuningDashboardPage`へ渡すルートコンポーネントを実装する。

**Files:**
- Modify: `src/App.tsx`, `.test.tsx`

**Interfaces:**
- Consumes: `TemplateRouteGuard`（既存、Guided Lesson Builderプラン）、`getTuningConstants`（Task 3）、`TuningDashboardPage`（Task 4）
- Produces: なし（ルート定義の追加のみ）

- [ ] **Step 1: 失敗するテストを書く**

`src/App.test.tsx`に追記する（既存の`/teacher/templates`ルートガードテストの並びに合わせる。実際のテストファイルを先に読み、既存の`enabled`/`services`モックパターン・`TemplateRouteGuard`のテストの書き方に揃えること）:

```tsx
it('routes /teacher/tuning through TemplateRouteGuard and renders the dashboard once authorized', () => {
  // 既存の /teacher/templates ルートのテスト（TemplateRouteGuard 経由）と同じ
  // レンダリング手順・モックパターンを流用し、/teacher/tuning へナビゲートして
  // TuningDashboardPage の要素（例: "試運転用パラメータ一覧" という見出し）が
  // 現れることを確認する。
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/App.test.tsx`
Expected: FAIL — ルートが存在しない

- [ ] **Step 3: `App.tsx`にルートコンポーネントを実装する**

`src/App.tsx`の既存の`TemplateListRoute`等の定義の直後に追加する:

```tsx
function TuningDashboardRoute({ services }: { services: FirebaseServices }) {
  const [data, setData] = useState<TuningConstantsResponse>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    getTuningConstants(services.functions)
      .then(setData)
      .catch(() => setError('failed'))
  }, [services])
  return <TuningDashboardPage data={data} error={error} />
}
```

必要なimportを`App.tsx`先頭へ追加する:

```tsx
import { getTuningConstants, type TuningConstantsResponse } from './lib/platformConfig/getTuningConstants'
import { TuningDashboardPage } from './components/teacher/tuning/TuningDashboardPage'
```

`AppRoutes`内、`/teacher/templates`系ルートの直後へ追加する（`TemplateRouteGuard`で包む点は既存の3ルートと同じ）:

```tsx
<Route path="/teacher/tuning" element={enabled && services ? <TemplateRouteGuard services={services}><TuningDashboardRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/App.test.tsx`
Expected: PASS

- [ ] **Step 5: `npm run verify`（全ワークスペース）**

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: wire /teacher/tuning route into the app"
```
