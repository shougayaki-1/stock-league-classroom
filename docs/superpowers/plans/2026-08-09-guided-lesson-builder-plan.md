# Guided Lesson Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**正本:** `docs/superpowers/specs/2026-08-09-guided-lesson-builder-design.md`（設計仕様）。矛盾する場合は仕様書を優先する。

**Goal:** 教師が学習目標を選ぶだけでAIを使わずに社会科市場教材・家庭科生活設計教材を作成できる、Guided Builderウィザードとフルエディタを実装する。

**Architecture:** 科目非依存の共有ウィザードエンジン・共有エディタシェルを作り、科目固有ロジック（質問セット・3案プリセットテーブル・配列フィールド設定）をプラグインとして差し込む。配列編集（企業一覧・担当プロフィール一覧等）は1つの汎用`ArrayFieldEditor`をフィールド設定で駆動することで、科目ごとの重複実装を避ける。新規Callable・新規Firestoreルールは不要（既存の`createLessonTemplate`/`saveDraft`/`publishLessonVersion`とルールをそのまま使う）。

**Tech Stack:** TypeScript, React, MUI, react-router, Firebase Firestore（`lessonTemplates`コレクション）, Vitest, React Testing Library, `@stock-league/lesson-inputs`（既存ウィジェット）, `@stock-league/market-authoring-content`/`@stock-league/household-authoring-content`（既存の教材コンテンツ型）。

## Global Constraints

- 新規の入力ウィジェット型（`@stock-league/lesson-inputs`への追加）は行わない。既存の`SingleChoiceInput`/`NumberInput`/`ShortTextInput`をそのまま再利用する。
- 新規Callable・新規Firestoreセキュリティルールは追加しない。既存の`createLessonTemplate`/`saveDraft`（クライアント直接Firestore書き込み、`firestore.rules:56-82`で許可済み）と`publishLessonVersionCallable`（既存）をそのまま使う。
- 保険の内部リスク係数（`internalClaimProbability`）・イベント発生確率（`triggerProbability`）・企業の影響感度（`impactSensitivities`）・世帯のイベント確率上書き（`eventProbabilityOverrides`）・世帯の内部リスク係数（`internalRiskFactors`）はUIから編集不可とする。新規作成時は安全なデフォルト値（0または空オブジェクト）で埋める。
- Guided Builderウィザードの回答はFirestoreへ自動保存しない。`createLessonTemplate`が呼ばれる（§14.4確認ページでの確定操作）まではローカルstateのみで保持する。
- 3案生成は完全にルールベース（固定プリセットテーブルの参照のみ）とし、AI・LLM呼び出しは一切行わない。
- 各コンポーネントファイルは1つの明確な責務を持つ。配列編集ロジックは`ArrayFieldEditor`に集約し、科目固有コンポーネントへ複製しない。
- 日本語UI文言を用いる（このリポジトリの既存コンポーネントの慣例）。
- **スコープ外として明示的に据え置く項目:** 設計仕様のエラー処理節が挙げる「下書き保存失敗時のトースト表示」は、`TemplateEditorPage`の保存コールバックが同期的な`onChange`関数として設計されているため本計画には含めない（`onSaveDraft`/`onPublish`の失敗検知・表示は、実際にFirestore書き込みへ接続するTask 11のルートコンポーネント側かUIポリッシュの別タスクで対応する）。ウィザード離脱時の警告表示（ブラウザの標準的な離脱確認に委ねる）も同様に本計画のタスクには含めない。

---

## File Structure

| File | Change |
| --- | --- |
| `src/lib/lessonTemplates/guidedBuilderTypes.ts` | Create（Task 1。`LearningGoal`・`WizardAnswers`・`GuidedBuilderTier`型） |
| `src/lib/lessonTemplates/guidedBuilderPresets.ts`, `.test.ts` | Create（Task 1。固定プリセットテーブルと`buildDraftFromAnswers`純粋関数） |
| `src/components/teacher/templates/editors/ArrayFieldEditor.tsx`, `.test.tsx` | Create（Task 2。汎用配列CRUDコンポーネント） |
| `src/components/teacher/templates/editors/socialStudies/fieldConfigs.ts` | Create（Task 3。企業・ニュース項目のフィールド設定） |
| `src/components/teacher/templates/editors/homeEconomics/fieldConfigs.ts` | Create（Task 3。担当プロフィール・資産・保険・イベント定義のフィールド設定） |
| `src/components/teacher/templates/TemplateEditorPage.tsx`, `.test.tsx` | Create（Task 4。共通シェル: タブ・保存・版発行） |
| `src/components/teacher/templates/wizardSteps/LearningGoalSelectStep.tsx`, `.test.tsx` | Create（Task 5） |
| `src/components/teacher/templates/GuidedBuilderWizard.tsx`, `.test.tsx` | Create（Task 6。汎用ステップエンジン） |
| `src/components/teacher/templates/wizardSteps/socialStudies/QuestionSteps.tsx`, `.test.tsx` | Create（Task 7） |
| `src/components/teacher/templates/wizardSteps/homeEconomics/QuestionSteps.tsx`, `.test.tsx` | Create（Task 8） |
| `src/components/teacher/templates/TemplateOverviewPage.tsx`, `.test.tsx` | Create（Task 9。§14.4最終確認・3案比較） |
| `src/components/teacher/templates/TemplateListPage.tsx`, `.test.tsx` | Create（Task 10） |
| `src/App.tsx` | Modify（Task 11。ルート3件追加） |
| `test/guided-lesson-builder.acceptance.test.tsx` | Create（Task 12。受け入れテスト） |

---

## タスク一覧

1. ウィザード型・3案生成プリセットテーブル
2. 汎用配列フィールドエディタ
3. 科目別フィールド設定（社会科・家庭科）
4. フルエディタ共通シェル
5. 学習目標選択ステップ
6. ウィザード汎用ステップエンジン
7. 社会科質問ステップ
8. 家庭科質問ステップ
9. §14.4最終確認ページ（3案比較・選択・確定）
10. 教師ホーム画面（教材一覧）
11. ルーティング配線
12. 受け入れテスト

---

### Task 1: ウィザード型・3案生成プリセットテーブル

統合仕様書§14.1〜14.3を実装する。純粋関数。ウィザードの回答（学習目標・共通項目・科目別項目）から「簡易案/標準案/発展案」の3つの`LessonContent`ドラフトを、固定プリセットテーブルの参照だけで生成する。AIは使わない。

**Files:**
- Create: `src/lib/lessonTemplates/guidedBuilderTypes.ts`
- Create: `src/lib/lessonTemplates/guidedBuilderPresets.ts`, `.test.ts`

**Interfaces:**
- Consumes: `LessonContent`・`SocialStudiesMarketContent`・`HomeEconomicsContent`（既存、`src/lib/lessonTemplates/types.ts`）
- Produces: `LearningGoal`型、`WizardAnswers`型、`GuidedBuilderTier`型、`buildDraftFromAnswers(answers: WizardAnswers, tier: GuidedBuilderTier): LessonContent`

- [ ] **Step 1: 型を定義する**

`src/lib/lessonTemplates/guidedBuilderTypes.ts`:

```ts
/** §14 Step1: 学習目標のフレーミングによる科目選択。UIのカード選択がこの値へ直接マップされる。 */
export type LearningGoal = 'MARKET_AND_INVESTING' | 'LIFE_PLANNING'

export type GuidedBuilderTier = 'EASY' | 'STANDARD' | 'ADVANCED'

/** §14.1 共通質問項目。 */
export interface CommonWizardAnswers {
  mainObjective: string
  lessonDurationMinutes: number
  studentCount: number
  deviceEnvironment: 'ONE_PER_STUDENT' | 'SHARED' | 'MIXED'
  teamMode: 'INDIVIDUAL' | 'TEAM'
  readingDepth: 'LIGHT' | 'STANDARD' | 'DEEP'
  theme: string
  difficulty: 'BASIC' | 'STANDARD' | 'ADVANCED'
}

/** §14.2 社会科の追加質問項目。 */
export interface SocialStudiesWizardAnswers {
  companyCount: number
  useEarnings: boolean
  useUncertainty: boolean
  infoVsDemandWeight: 'INFO_FOCUSED' | 'BALANCED' | 'DEMAND_FOCUSED'
  alwaysOnMarketMinutes: number
  predictionCheckpoints: number
  evaluationFocus: 'OPERATION_RESULT' | 'PREDICTION_ACCURACY' | 'INFORMATION_USAGE' | 'RISK_MANAGEMENT'
}

/** §14.3 家庭科の追加質問項目。 */
export interface HomeEconomicsWizardAnswers {
  lifeStageFocus: 'STUDENT' | 'INDEPENDENT' | 'FAMILY_FORMATION' | 'CHILD_REARING' | 'PRE_RETIREMENT' | 'RETIRED'
  courseFormat: 'COMMON_CONDITIONS' | 'ROLE_VARIANT'
  roundYears: 1 | 5
  coveredConcepts: Array<'ASSETS' | 'INSURANCE' | 'HOUSING'>
  eventDisclosure: 'ANNOUNCED' | 'PARTIALLY_ANNOUNCED' | 'HIDDEN'
  evaluationFocus: 'LIFE_GOAL_ACHIEVEMENT' | 'STABILITY' | 'DIVERSIFICATION' | 'BORROWING_BURDEN'
}

/**
 * Flat, not nested under `common`/`subject` — `GuidedBuilderWizard` (Task 6)
 * accumulates every step's onChange into ONE object via shallow merge, so
 * whatever shape this type has is what every step component and every
 * consumer (TemplateOverviewPage, App.tsx's TemplateNewRoute) must produce
 * and read directly. A nested `{ common: {...}, subject: {...} }` shape
 * would require the wizard engine to know about that nesting — it
 * deliberately does not (see Task 6's WizardStepComponent contract).
 */
export type WizardAnswers =
  | ({ goal: 'MARKET_AND_INVESTING' } & CommonWizardAnswers & SocialStudiesWizardAnswers)
  | ({ goal: 'LIFE_PLANNING' } & CommonWizardAnswers & HomeEconomicsWizardAnswers)
```

- [ ] **Step 2: 失敗するテストを書く（社会科3案生成）**

`src/lib/lessonTemplates/guidedBuilderPresets.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { WizardAnswers } from './guidedBuilderTypes'
import { buildDraftFromAnswers } from './guidedBuilderPresets'

const socialStudiesAnswers: WizardAnswers = {
  goal: 'MARKET_AND_INVESTING',
  mainObjective: '需給と価格の関係を理解する', lessonDurationMinutes: 50, studentCount: 30,
  deviceEnvironment: 'ONE_PER_STUDENT', teamMode: 'TEAM', readingDepth: 'STANDARD',
  theme: '身近な企業', difficulty: 'STANDARD',
  companyCount: 5, useEarnings: true, useUncertainty: false, infoVsDemandWeight: 'BALANCED',
  alwaysOnMarketMinutes: 20, predictionCheckpoints: 2, evaluationFocus: 'OPERATION_RESULT',
}

describe('buildDraftFromAnswers (SOCIAL_STUDIES)', () => {
  it('EASY tier produces fewer companies than ADVANCED for the same answers', () => {
    const easy = buildDraftFromAnswers(socialStudiesAnswers, 'EASY')
    const advanced = buildDraftFromAnswers(socialStudiesAnswers, 'ADVANCED')
    expect(easy.subject).toBe('SOCIAL_STUDIES')
    expect(easy.socialStudiesMarket?.companies.length).toBeLessThan(advanced.socialStudiesMarket!.companies.length)
  })

  it('STANDARD tier company count matches the answered companyCount, capped by the preset band', () => {
    const draft = buildDraftFromAnswers(socialStudiesAnswers, 'STANDARD')
    expect(draft.socialStudiesMarket?.companies.length).toBe(5)
  })

  it('never leaks impactSensitivities as non-zero — presets seed them at a safe default', () => {
    const draft = buildDraftFromAnswers(socialStudiesAnswers, 'STANDARD')
    for (const company of draft.socialStudiesMarket?.companies ?? []) {
      expect(Object.values(company.impactSensitivities)).toEqual([])
    }
  })

  it('evaluationWeights always sum to 1 regardless of tier', () => {
    for (const tier of ['EASY', 'STANDARD', 'ADVANCED'] as const) {
      const draft = buildDraftFromAnswers(socialStudiesAnswers, tier)
      const w = draft.socialStudiesMarket!.evaluationWeights
      const sum = w.operationResult + w.predictionAccuracy + w.informationUsage + w.riskManagement + w.reflection
      expect(sum).toBeCloseTo(1, 9)
    }
  })
})

const homeEconomicsAnswers: WizardAnswers = {
  goal: 'LIFE_PLANNING',
  mainObjective: '生涯設計の視点を持つ', lessonDurationMinutes: 50, studentCount: 30,
  deviceEnvironment: 'ONE_PER_STUDENT', teamMode: 'INDIVIDUAL', readingDepth: 'STANDARD',
  theme: '子育て世帯', difficulty: 'STANDARD',
  lifeStageFocus: 'CHILD_REARING', courseFormat: 'COMMON_CONDITIONS', roundYears: 5,
  coveredConcepts: ['ASSETS', 'INSURANCE'], eventDisclosure: 'PARTIALLY_ANNOUNCED',
  evaluationFocus: 'STABILITY',
}

describe('buildDraftFromAnswers (HOME_ECONOMICS)', () => {
  it('COMMON_CONDITIONS answers always produce exactly one household profile', () => {
    const draft = buildDraftFromAnswers(homeEconomicsAnswers, 'STANDARD')
    expect(draft.subject).toBe('HOME_ECONOMICS')
    expect(draft.homeEconomics?.households.length).toBe(1)
    expect(draft.homeEconomics?.courseFormat).toBe('COMMON_CONDITIONS')
  })

  it('ADVANCED tier includes more life events than EASY', () => {
    const easy = buildDraftFromAnswers(homeEconomicsAnswers, 'EASY')
    const advanced = buildDraftFromAnswers(homeEconomicsAnswers, 'ADVANCED')
    expect(easy.homeEconomics!.lifeEvents.length).toBeLessThan(advanced.homeEconomics!.lifeEvents.length)
  })

  it('evaluationWeights always sum to 1 regardless of tier', () => {
    for (const tier of ['EASY', 'STANDARD', 'ADVANCED'] as const) {
      const draft = buildDraftFromAnswers(homeEconomicsAnswers, tier)
      const w = draft.homeEconomics!.evaluationWeights
      const sum = w.lifeGoalAchievement + w.emergencyFundAdequacy + w.stability + w.diversification + w.borrowingBurden + w.reflection
      expect(sum).toBeCloseTo(1, 9)
    }
  })
})
```

- [ ] **Step 3: 失敗を確認する**

Run: `npx vitest run src/lib/lessonTemplates/guidedBuilderPresets.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: 実装する**

`src/lib/lessonTemplates/guidedBuilderPresets.ts`:

```ts
import type { SimulatedCompany, InformationItem } from '@stock-league/market-authoring-content'
import type { HouseholdProfile, LifeEventDefinition } from '@stock-league/household-authoring-content'
import type { LessonContent } from './types'
import type { GuidedBuilderTier, WizardAnswers } from './guidedBuilderTypes'

const COMPANY_NAME_POOL = ['あおぞらベーカリー', 'みらい電機', 'つばさ物流', 'はるか食品', 'green energy社', 'そよかぜ通信', 'kirara小売', '大地農業']

const buildCompany = (index: number): SimulatedCompany => ({
  id: `company-${index + 1}`,
  name: COMPANY_NAME_POOL[index % COMPANY_NAME_POOL.length],
  symbol: `C${index + 1}`,
  industry: '未設定', description: '', productsAndServices: [], costDrivers: [],
  sizeClass: 'MID', financialStrength: 'STANDARD', growthProfile: 'STABLE', riskFactors: [],
  initialPrice: 1000, minimumPriceGuard: { type: 'PERCENT_OF_INITIAL', minimumPercent: 30 },
  impactSensitivities: {},
})

/**
 * §14.1's companyCount answer is a target; the tier clamps it to a band so
 * "EASY" never accidentally produces an overwhelming number of companies
 * even if the teacher answered a large companyCount, and "ADVANCED" always
 * has at least a meaningfully larger count than EASY for the same answers.
 */
const COMPANY_COUNT_BAND: Record<GuidedBuilderTier, (answered: number) => number> = {
  EASY: (answered) => Math.max(2, Math.min(3, answered)),
  STANDARD: (answered) => Math.max(3, Math.min(8, answered)),
  ADVANCED: (answered) => Math.max(6, Math.min(12, answered + 3)),
}

const SOCIAL_STUDIES_EVALUATION_WEIGHTS = {
  operationResult: 0.3, predictionAccuracy: 0.2, informationUsage: 0.2, riskManagement: 0.15, reflection: 0.15,
}

const buildSocialStudiesContent = (
  answers: Extract<WizardAnswers, { goal: 'MARKET_AND_INVESTING' }>,
  tier: GuidedBuilderTier,
): LessonContent => {
  const companyCount = COMPANY_COUNT_BAND[tier](answers.companyCount)
  const companies: SimulatedCompany[] = Array.from({ length: companyCount }, (_, i) => buildCompany(i))
  const informationItems: InformationItem[] = []
  return {
    schemaVersion: 1, title: answers.theme || '新しい社会科教材', description: answers.mainObjective,
    subject: 'SOCIAL_STUDIES',
    socialStudiesMarket: {
      companies, informationItems, economicIndicators: [],
      batchIntervalSeconds: 3, priceSensitivityPreset: answers.infoVsDemandWeight,
      marketNoiseEnabled: tier !== 'EASY', resumeConfirmationSeconds: 30,
      companyDifficultyTier: answers.difficulty, indicatorDifficultyTier: answers.difficulty,
      tradingFeeYen: 0, dividendEnabled: false, stockSplitEnabled: false, bankruptcyEnabled: tier === 'ADVANCED',
      dividendTriggerBatchIndexes: [], stockSplitTriggerBatchIndexes: [],
      dividendPerShareYen: 0, stockSplitRatio: 1,
      predictionEvaluationTarget: { type: 'AFTER_BATCHES', count: 20 },
      evaluationWeights: SOCIAL_STUDIES_EVALUATION_WEIGHTS,
    },
  }
}

const LIFE_EVENT_POOL: Omit<LifeEventDefinition, 'triggerProbability'>[] = [
  { id: 'job-loss', label: '失業', disclosureMode: 'HIDDEN', effectDescription: '収入が一時的に減る', incomeEffectYen: -1500000, expenseEffectYen: 0, cashEffectYen: 0 },
  { id: 'illness', label: '病気', disclosureMode: 'HIDDEN', effectDescription: '医療費が発生する', incomeEffectYen: 0, expenseEffectYen: 300000, cashEffectYen: 0 },
  { id: 'childbirth', label: '出産', disclosureMode: 'ANNOUNCED', effectDescription: '一時的な費用が発生する', incomeEffectYen: 0, expenseEffectYen: 0, cashEffectYen: -500000 },
  { id: 'promotion', label: '昇進', disclosureMode: 'ANNOUNCED', effectDescription: '収入が増える', incomeEffectYen: 500000, expenseEffectYen: 0, cashEffectYen: 0 },
]

const LIFE_EVENT_COUNT_BAND: Record<GuidedBuilderTier, number> = { EASY: 1, STANDARD: 2, ADVANCED: 4 }

const HOME_ECONOMICS_EVALUATION_WEIGHTS = {
  lifeGoalAchievement: 0.2, emergencyFundAdequacy: 0.15, stability: 0.2, diversification: 0.15, borrowingBurden: 0.15, reflection: 0.15,
}

const buildHouseholdProfile = (answers: Extract<WizardAnswers, { goal: 'LIFE_PLANNING' }>): HouseholdProfile => ({
  householdId: 'case-a', age: 32, householdIncomeYen: 5000000, annualLivingExpensesYen: 2800000, cashSavingsYen: 1500000,
  family: '配偶者・子1人', housing: '賃貸マンション', lifeGoal: answers.mainObjective || '安定した生活設計',
  lifeStage: answers.lifeStageFocus, eventProbabilityOverrides: {}, internalRiskFactors: {},
})

const buildHomeEconomicsContent = (
  answers: Extract<WizardAnswers, { goal: 'LIFE_PLANNING' }>,
  tier: GuidedBuilderTier,
): LessonContent => {
  const eventCount = LIFE_EVENT_COUNT_BAND[tier]
  const lifeEvents: LifeEventDefinition[] = LIFE_EVENT_POOL.slice(0, eventCount).map((event) => ({
    ...event, disclosureMode: answers.eventDisclosure === 'HIDDEN' ? 'HIDDEN' : event.disclosureMode,
    triggerProbability: tier === 'EASY' ? 0.1 : tier === 'STANDARD' ? 0.2 : 0.3,
  }))
  return {
    schemaVersion: 1, title: answers.theme || '新しい家庭科教材', description: answers.mainObjective,
    subject: 'HOME_ECONOMICS',
    homeEconomics: {
      households: [buildHouseholdProfile(answers)],
      assets: [], insuranceProducts: [], lifeEvents, liabilities: [], publicSupportPrograms: [],
      roundYears: answers.roundYears, courseFormat: answers.courseFormat,
      taxAndSocialInsuranceModelVersion: 1,
      economicFactors: { inflationPercent: 1, interestRatePercent: 1, marketReturnPercent: 3 },
      borrowingAllowed: tier !== 'EASY', goalPackage: 'OVERALL_BALANCE',
      evaluationWeights: HOME_ECONOMICS_EVALUATION_WEIGHTS,
    },
  }
}

export const buildDraftFromAnswers = (answers: WizardAnswers, tier: GuidedBuilderTier): LessonContent =>
  answers.goal === 'MARKET_AND_INVESTING' ? buildSocialStudiesContent(answers, tier) : buildHomeEconomicsContent(answers, tier)
```

- [ ] **Step 5: テストを通す**

Run: `npx vitest run src/lib/lessonTemplates/guidedBuilderPresets.test.ts`
Expected: PASS

- [ ] **Step 6: `npm run typecheck`**

- [ ] **Step 7: Commit**

```bash
git add src/lib/lessonTemplates/guidedBuilderTypes.ts src/lib/lessonTemplates/guidedBuilderPresets.ts src/lib/lessonTemplates/guidedBuilderPresets.test.ts
git commit -m "feat: add Guided Builder wizard answer types and rule-based 3-tier draft generation"
```

---

### Task 2: 汎用配列フィールドエディタ

フルエディタの「主要な一覧」タブが科目を問わず再利用する、汎用の配列CRUDコンポーネントを実装する。追加・削除・スカラーフィールドのインライン編集を提供し、どのフィールドを表示するかは呼び出し側が渡す設定（`ArrayFieldConfig`）で決まる。

**Files:**
- Create: `src/components/teacher/templates/editors/ArrayFieldEditor.tsx`, `.test.tsx`

**Interfaces:**
- Consumes: なし（`@stock-league/lesson-inputs`型は使わず、素の`TextField`/`NumberInput`を使う）
- Produces: `ArrayItemFieldConfig`型、`ArrayFieldEditorProps<T>`型、`ArrayFieldEditor<T>`コンポーネント

- [ ] **Step 1: 失敗するテストを書く**

`src/components/teacher/templates/editors/ArrayFieldEditor.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ArrayFieldEditor } from './ArrayFieldEditor'

interface TestItem { id: string; name: string; amount: number }

const fields = [
  { key: 'name' as const, label: '名称', type: 'text' as const },
  { key: 'amount' as const, label: '金額', type: 'number' as const },
]

describe('ArrayFieldEditor', () => {
  it('renders one row per item with its field values', () => {
    render(<ArrayFieldEditor
      items={[{ id: 'a', name: '企業A', amount: 1000 }]}
      fields={fields} itemLabel="企業" onChange={() => {}}
      createEmptyItem={() => ({ id: 'new', name: '', amount: 0 })}
    />)
    expect(screen.getByDisplayValue('企業A')).toBeInTheDocument()
    expect(screen.getByDisplayValue('1000')).toBeInTheDocument()
  })

  it('calls onChange with an added item when "追加" is clicked', () => {
    const onChange = vi.fn()
    render(<ArrayFieldEditor
      items={[]} fields={fields} itemLabel="企業" onChange={onChange}
      createEmptyItem={() => ({ id: 'new-1', name: '', amount: 0 })}
    />)
    fireEvent.click(screen.getByRole('button', { name: '企業を追加' }))
    expect(onChange).toHaveBeenCalledWith([{ id: 'new-1', name: '', amount: 0 }])
  })

  it('calls onChange with the item removed when its delete button is clicked', () => {
    const onChange = vi.fn()
    render(<ArrayFieldEditor
      items={[{ id: 'a', name: '企業A', amount: 1000 }]} fields={fields} itemLabel="企業" onChange={onChange}
      createEmptyItem={() => ({ id: 'new', name: '', amount: 0 })}
    />)
    fireEvent.click(screen.getByRole('button', { name: '企業Aを削除' }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('calls onChange with an updated field value when an input changes', () => {
    const onChange = vi.fn()
    render(<ArrayFieldEditor
      items={[{ id: 'a', name: '企業A', amount: 1000 }]} fields={fields} itemLabel="企業" onChange={onChange}
      createEmptyItem={() => ({ id: 'new', name: '', amount: 0 })}
    />)
    fireEvent.change(screen.getByDisplayValue('企業A'), { target: { value: '企業B' } })
    expect(onChange).toHaveBeenCalledWith([{ id: 'a', name: '企業B', amount: 1000 }])
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/components/teacher/templates/editors/ArrayFieldEditor.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`src/components/teacher/templates/editors/ArrayFieldEditor.tsx`:

```tsx
import { Button, IconButton, Stack, TextField, Typography } from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'

export interface ArrayItemFieldConfig<T> {
  key: keyof T
  label: string
  type: 'text' | 'number'
}

export interface ArrayFieldEditorProps<T extends { id: string }> {
  items: T[]
  fields: ArrayItemFieldConfig<T>[]
  /** Human-readable noun used in button/aria labels, e.g. "企業" or "担当プロフィール". */
  itemLabel: string
  onChange: (items: T[]) => void
  createEmptyItem: () => T
}

/**
 * Generic scalar-field list editor shared by every subject's "主要な一覧"
 * tab (spec: docs/superpowers/specs/2026-08-09-guided-lesson-builder-design.md).
 * Only ever edits the fields named in `fields` — hidden/internal fields on
 * `T` (risk coefficients, probabilities) are never read or written here,
 * so a caller cannot accidentally expose them by omission.
 */
export function ArrayFieldEditor<T extends { id: string }>({ items, fields, itemLabel, onChange, createEmptyItem }: ArrayFieldEditorProps<T>) {
  const updateField = (index: number, key: keyof T, value: string | number) => {
    const next = items.map((item, i) => (i === index ? { ...item, [key]: value } : item))
    onChange(next)
  }
  const removeItem = (index: number) => onChange(items.filter((_, i) => i !== index))
  const addItem = () => onChange([...items, createEmptyItem()])

  return (
    <Stack spacing={2}>
      {items.map((item, index) => {
        const nameLike = fields.find((f) => f.type === 'text')
        const rowLabel = nameLike ? String(item[nameLike.key]) : String(index + 1)
        return (
          <Stack key={item.id} direction="row" spacing={1} alignItems="flex-start" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
            <Stack spacing={1} sx={{ flex: 1 }}>
              {fields.map((field) => (
                <TextField
                  key={String(field.key)}
                  label={field.label}
                  type={field.type === 'number' ? 'number' : 'text'}
                  value={item[field.key] as string | number}
                  onChange={(e) => updateField(index, field.key, field.type === 'number' ? Number(e.target.value) : e.target.value)}
                  size="small"
                  fullWidth
                />
              ))}
            </Stack>
            <IconButton aria-label={`${rowLabel || itemLabel}を削除`} onClick={() => removeItem(index)}>
              <DeleteIcon />
            </IconButton>
          </Stack>
        )
      })}
      {items.length === 0 && <Typography variant="body2" color="text.secondary">まだ{itemLabel}がありません。</Typography>}
      <Button variant="outlined" onClick={addItem} sx={{ alignSelf: 'flex-start' }}>{itemLabel}を追加</Button>
    </Stack>
  )
}
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/components/teacher/templates/editors/ArrayFieldEditor.test.tsx`
Expected: PASS

- [ ] **Step 5: `npm run typecheck`**

- [ ] **Step 6: Commit**

```bash
git add src/components/teacher/templates/editors/ArrayFieldEditor.tsx src/components/teacher/templates/editors/ArrayFieldEditor.test.tsx
git commit -m "feat: add generic ArrayFieldEditor shared by every subject's main-list tab"
```

---

### Task 3: 科目別フィールド設定（社会科・家庭科）

Task 2の`ArrayFieldEditor`を各科目の配列型（企業、ニュース項目、担当プロフィール、資産、保険、イベント定義）へ適用するためのフィールド設定と、新規行の初期値生成関数を定義する。内部専用フィールド（`impactSensitivities`・`internalRiskFactors`・`internalClaimProbability`・`triggerProbability`・`eventProbabilityOverrides`）は`fields`配列に含めない（＝UIから編集不可）ことを、このタスクの純粋関数テストで直接検証する。

**Files:**
- Create: `src/components/teacher/templates/editors/socialStudies/fieldConfigs.ts`, `.test.ts`
- Create: `src/components/teacher/templates/editors/homeEconomics/fieldConfigs.ts`, `.test.ts`

**Interfaces:**
- Consumes: `ArrayItemFieldConfig`（Task 2）、`SimulatedCompany`/`InformationItem`（`@stock-league/market-authoring-content`）、`HouseholdProfile`/`AssetPosition`/`InsuranceProduct`/`LifeEventDefinition`（`@stock-league/household-authoring-content`）
- Produces: `companyFields`・`createEmptyCompany`、`householdProfileFields`・`createEmptyHouseholdProfile`、`assetFields`・`createEmptyAsset`、`insuranceProductFields`・`createEmptyInsuranceProduct`、`lifeEventFields`・`createEmptyLifeEvent`

- [ ] **Step 1: 失敗するテストを書く（社会科側）**

`src/components/teacher/templates/editors/socialStudies/fieldConfigs.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { companyFields, createEmptyCompany } from './fieldConfigs'

describe('companyFields', () => {
  it('never exposes impactSensitivities as an editable field', () => {
    expect(companyFields.map((f) => f.key)).not.toContain('impactSensitivities')
  })

  it('exposes the primary scalar fields', () => {
    expect(companyFields.map((f) => f.key)).toEqual(expect.arrayContaining(['name', 'symbol', 'industry', 'initialPrice']))
  })
})

describe('createEmptyCompany', () => {
  it('produces a company with a fresh unique id and safe internal defaults', () => {
    const a = createEmptyCompany()
    const b = createEmptyCompany()
    expect(a.id).not.toBe(b.id)
    expect(a.impactSensitivities).toEqual({})
    expect(a.minimumPriceGuard).toEqual({ type: 'PERCENT_OF_INITIAL', minimumPercent: 30 })
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/components/teacher/templates/editors/socialStudies/fieldConfigs.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する（社会科）**

`src/components/teacher/templates/editors/socialStudies/fieldConfigs.ts`:

```ts
import type { SimulatedCompany, InformationItem } from '@stock-league/market-authoring-content'
import type { ArrayItemFieldConfig } from '../ArrayFieldEditor'

export const companyFields: ArrayItemFieldConfig<SimulatedCompany>[] = [
  { key: 'name', label: '企業名', type: 'text' },
  { key: 'symbol', label: '銘柄コード', type: 'text' },
  { key: 'industry', label: '業種', type: 'text' },
  { key: 'initialPrice', label: '初期株価（円）', type: 'number' },
]

export const createEmptyCompany = (): SimulatedCompany => ({
  id: `company-${crypto.randomUUID()}`, name: '', symbol: '', industry: '', description: '',
  productsAndServices: [], costDrivers: [], sizeClass: 'MID', financialStrength: 'STANDARD',
  growthProfile: 'STABLE', riskFactors: [], initialPrice: 1000,
  minimumPriceGuard: { type: 'PERCENT_OF_INITIAL', minimumPercent: 30 }, impactSensitivities: {},
})

export const informationItemFields: ArrayItemFieldConfig<InformationItem>[] = [
  { key: 'source', label: '出典', type: 'text' },
  { key: 'body', label: '本文', type: 'text' },
]

export const createEmptyInformationItem = (): InformationItem => ({
  id: `info-${crypto.randomUUID()}`, category: 'COMPANY', source: '', publishedAtMillis: Date.now(),
  natureType: 'FACTUAL', confidenceLevel: 'CONFIRMED', targetCompanyIds: [], body: '',
  impact: { baseDirection: 'NEUTRAL', strength: 0 },
})
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/components/teacher/templates/editors/socialStudies/fieldConfigs.test.ts`
Expected: PASS

- [ ] **Step 5: 失敗するテストを書く（家庭科側）**

`src/components/teacher/templates/editors/homeEconomics/fieldConfigs.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { householdProfileFields, createEmptyHouseholdProfile, insuranceProductFields, createEmptyInsuranceProduct, lifeEventFields, createEmptyLifeEvent } from './fieldConfigs'

describe('householdProfileFields', () => {
  it('never exposes internalRiskFactors or eventProbabilityOverrides', () => {
    const keys = householdProfileFields.map((f) => f.key)
    expect(keys).not.toContain('internalRiskFactors')
    expect(keys).not.toContain('eventProbabilityOverrides')
  })
})

describe('insuranceProductFields', () => {
  it('never exposes internalClaimProbability', () => {
    expect(insuranceProductFields.map((f) => f.key)).not.toContain('internalClaimProbability')
  })
})

describe('lifeEventFields', () => {
  it('never exposes triggerProbability', () => {
    expect(lifeEventFields.map((f) => f.key)).not.toContain('triggerProbability')
  })
})

describe('createEmptyHouseholdProfile', () => {
  it('produces a profile with a fresh unique id and safe internal defaults', () => {
    const a = createEmptyHouseholdProfile()
    expect(a.internalRiskFactors).toEqual({})
    expect(a.eventProbabilityOverrides).toEqual({})
  })
})

describe('createEmptyInsuranceProduct', () => {
  it('seeds internalClaimProbability at 0', () => {
    expect(createEmptyInsuranceProduct().internalClaimProbability).toBe(0)
  })
})

describe('createEmptyLifeEvent', () => {
  it('seeds triggerProbability at 0 and disclosureMode at ANNOUNCED', () => {
    const event = createEmptyLifeEvent()
    expect(event.triggerProbability).toBe(0)
    expect(event.disclosureMode).toBe('ANNOUNCED')
  })
})
```

- [ ] **Step 6: 失敗を確認する**

Run: `npx vitest run src/components/teacher/templates/editors/homeEconomics/fieldConfigs.test.ts`
Expected: FAIL — module not found

- [ ] **Step 7: 実装する（家庭科）**

`src/components/teacher/templates/editors/homeEconomics/fieldConfigs.ts`:

```ts
import type { AssetPosition, HouseholdProfile, InsuranceProduct, LifeEventDefinition } from '@stock-league/household-authoring-content'
import type { ArrayItemFieldConfig } from '../ArrayFieldEditor'

export const householdProfileFields: ArrayItemFieldConfig<HouseholdProfile>[] = [
  { key: 'family', label: '家族構成', type: 'text' },
  { key: 'housing', label: '住居', type: 'text' },
  { key: 'lifeGoal', label: '生活目標', type: 'text' },
  { key: 'age', label: '年齢', type: 'number' },
  { key: 'householdIncomeYen', label: '世帯収入（円）', type: 'number' },
  { key: 'annualLivingExpensesYen', label: '年間生活費（円）', type: 'number' },
  { key: 'cashSavingsYen', label: '初期貯蓄（円）', type: 'number' },
]

export const createEmptyHouseholdProfile = (): HouseholdProfile => ({
  householdId: `case-${crypto.randomUUID()}`, age: 30, householdIncomeYen: 5000000,
  annualLivingExpensesYen: 2800000, cashSavingsYen: 1000000, family: '', housing: '',
  lifeGoal: '', lifeStage: 'INDEPENDENT', eventProbabilityOverrides: {}, internalRiskFactors: {},
})

export const assetFields: ArrayItemFieldConfig<AssetPosition>[] = [
  { key: 'assetType', label: '資産の種類', type: 'text' },
  { key: 'valueYen', label: '評価額（円）', type: 'number' },
]

export const createEmptyAsset = (): AssetPosition => ({
  assetType: 'DOMESTIC_STOCK', valueYen: 0, expectedReturnPercent: 3, volatilityPercent: 10,
})

export const insuranceProductFields: ArrayItemFieldConfig<InsuranceProduct>[] = [
  { key: 'productName', label: '商品名', type: 'text' },
  { key: 'coveredRisk', label: '対象リスク', type: 'text' },
  { key: 'benefitDescription', label: '給付内容', type: 'text' },
  { key: 'premiumYenPerYear', label: '年間保険料（円）', type: 'number' },
  { key: 'benefitAmountYen', label: '給付額（円）', type: 'number' },
  { key: 'contractYears', label: '契約年数', type: 'number' },
]

export const createEmptyInsuranceProduct = (): InsuranceProduct => ({
  id: `ins-${crypto.randomUUID()}`, productName: '', premiumYenPerYear: 0, coveredRisk: '',
  benefitDescription: '', benefitAmountYen: 0, contractYears: 10, coveredEventIds: [],
  internalClaimProbability: 0,
})

export const lifeEventFields: ArrayItemFieldConfig<LifeEventDefinition>[] = [
  { key: 'label', label: 'イベント名', type: 'text' },
  { key: 'effectDescription', label: '効果の説明', type: 'text' },
  { key: 'incomeEffectYen', label: '収入への影響（円）', type: 'number' },
  { key: 'expenseEffectYen', label: '支出への影響（円）', type: 'number' },
  { key: 'cashEffectYen', label: '現金への影響（円）', type: 'number' },
]

export const createEmptyLifeEvent = (): LifeEventDefinition => ({
  id: `event-${crypto.randomUUID()}`, label: '', disclosureMode: 'ANNOUNCED', triggerProbability: 0,
  effectDescription: '', incomeEffectYen: 0, expenseEffectYen: 0, cashEffectYen: 0,
})
```

- [ ] **Step 8: テストを通す**

Run: `npx vitest run src/components/teacher/templates/editors/homeEconomics/fieldConfigs.test.ts`
Expected: PASS

- [ ] **Step 9: `npm run typecheck`**

- [ ] **Step 10: Commit**

```bash
git add src/components/teacher/templates/editors/socialStudies/fieldConfigs.ts src/components/teacher/templates/editors/socialStudies/fieldConfigs.test.ts \
  src/components/teacher/templates/editors/homeEconomics/fieldConfigs.ts src/components/teacher/templates/editors/homeEconomics/fieldConfigs.test.ts
git commit -m "feat: add per-subject ArrayFieldEditor field configs, excluding internal-only fields by construction"
```

---

### Task 4: フルエディタ共通シェル

`TemplateEditorPage`を実装する。タイトル・説明文の編集、タブ切り替え（基本情報／主要な一覧／評価の重み）、下書き保存、版発行を担う。「主要な一覧」タブの中身はTask 2・3の`ArrayFieldEditor`＋フィールド設定を`subject`で出し分けて描画する。

**Files:**
- Create: `src/components/teacher/templates/TemplateEditorPage.tsx`, `.test.tsx`

**Interfaces:**
- Consumes: `LessonContent`・`saveDraft`・`publishLessonVersion`（既存、`src/lib/lessonTemplates/`）、`ArrayFieldEditor`（Task 2）、社会科/家庭科の`fieldConfigs`（Task 3）
- Produces: `TemplateEditorPageProps`型、`TemplateEditorPage`コンポーネント

- [ ] **Step 1: 失敗するテストを書く**

`src/components/teacher/templates/TemplateEditorPage.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TemplateEditorPage } from './TemplateEditorPage'
import type { LessonContent } from '../../../lib/lessonTemplates/types'

const homeEconomicsDraft: LessonContent = {
  schemaVersion: 1, title: '初期タイトル', description: '初期説明', subject: 'HOME_ECONOMICS',
  homeEconomics: {
    households: [], assets: [], insuranceProducts: [], lifeEvents: [], liabilities: [], publicSupportPrograms: [],
    roundYears: 5, courseFormat: 'COMMON_CONDITIONS', taxAndSocialInsuranceModelVersion: 1,
    economicFactors: { inflationPercent: 1, interestRatePercent: 1, marketReturnPercent: 3 },
    borrowingAllowed: false, goalPackage: 'OVERALL_BALANCE',
    evaluationWeights: { lifeGoalAchievement: 0.2, emergencyFundAdequacy: 0.15, stability: 0.2, diversification: 0.15, borrowingBurden: 0.15, reflection: 0.15 },
  },
}

describe('TemplateEditorPage', () => {
  it('renders the current title and description', () => {
    render(<TemplateEditorPage draft={homeEconomicsDraft} onSaveDraft={vi.fn()} onPublish={vi.fn()} saving={false} publishing={false} />)
    expect(screen.getByDisplayValue('初期タイトル')).toBeInTheDocument()
  })

  it('calls onSaveDraft with the edited content when "下書き保存" is clicked', async () => {
    const onSaveDraft = vi.fn()
    render(<TemplateEditorPage draft={homeEconomicsDraft} onSaveDraft={onSaveDraft} onPublish={vi.fn()} saving={false} publishing={false} />)
    fireEvent.change(screen.getByDisplayValue('初期タイトル'), { target: { value: '変更後タイトル' } })
    fireEvent.click(screen.getByRole('button', { name: '下書き保存' }))
    await waitFor(() => expect(onSaveDraft).toHaveBeenCalledWith(expect.objectContaining({ title: '変更後タイトル' })))
  })

  it('switches to the main-list tab and adds a household profile via ArrayFieldEditor', () => {
    const onSaveDraft = vi.fn()
    render(<TemplateEditorPage draft={homeEconomicsDraft} onSaveDraft={onSaveDraft} onPublish={vi.fn()} saving={false} publishing={false} />)
    fireEvent.click(screen.getByRole('tab', { name: '主要な一覧' }))
    fireEvent.click(screen.getByRole('button', { name: '担当プロフィールを追加' }))
    fireEvent.click(screen.getByRole('button', { name: '下書き保存' }))
    expect(onSaveDraft).toHaveBeenCalledWith(expect.objectContaining({
      homeEconomics: expect.objectContaining({ households: expect.arrayContaining([expect.anything()]) }),
    }))
  })

  it('calls onPublish when "この内容で版を発行する" is confirmed', () => {
    const onPublish = vi.fn()
    render(<TemplateEditorPage draft={homeEconomicsDraft} onSaveDraft={vi.fn()} onPublish={onPublish} saving={false} publishing={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'この内容で版を発行する' }))
    fireEvent.click(screen.getByRole('button', { name: '発行する' }))
    expect(onPublish).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/components/teacher/templates/TemplateEditorPage.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`src/components/teacher/templates/TemplateEditorPage.tsx`:

```tsx
import { useState } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Stack, Tab, Tabs, TextField, Typography } from '@mui/material'
import type { LessonContent } from '../../../lib/lessonTemplates/types'
import { ArrayFieldEditor } from './editors/ArrayFieldEditor'
import { companyFields, createEmptyCompany } from './editors/socialStudies/fieldConfigs'
import { householdProfileFields, createEmptyHouseholdProfile } from './editors/homeEconomics/fieldConfigs'

export interface TemplateEditorPageProps {
  draft: LessonContent
  onSaveDraft: (content: LessonContent) => void
  onPublish: () => void
  saving: boolean
  publishing: boolean
}

/**
 * Common shell for both subjects, per the design spec's "共有エディタシェル"
 * decision. Only the main-list tab's contents branch on `subject` — the
 * tab structure, title/description fields, and save/publish buttons never
 * do, so a future subject only needs a new fieldConfigs module, not a new
 * shell.
 */
export function TemplateEditorPage({ draft, onSaveDraft, onPublish, saving, publishing }: TemplateEditorPageProps) {
  const [content, setContent] = useState(draft)
  const [tab, setTab] = useState(0)
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <TextField
        label="タイトル" value={content.title}
        onChange={(e) => setContent({ ...content, title: e.target.value })} fullWidth
      />
      <Tabs value={tab} onChange={(_, v) => setTab(v)}>
        <Tab label="基本情報" />
        <Tab label="主要な一覧" />
        <Tab label="評価の重み" />
      </Tabs>

      {tab === 0 && (
        <TextField
          label="説明" value={content.description} multiline minRows={2}
          onChange={(e) => setContent({ ...content, description: e.target.value })} fullWidth
        />
      )}

      {tab === 1 && content.subject === 'SOCIAL_STUDIES' && content.socialStudiesMarket && (
        <ArrayFieldEditor
          items={content.socialStudiesMarket.companies} fields={companyFields} itemLabel="企業"
          createEmptyItem={createEmptyCompany}
          onChange={(companies) => setContent({
            ...content, socialStudiesMarket: { ...content.socialStudiesMarket!, companies },
          })}
        />
      )}

      {tab === 1 && content.subject === 'HOME_ECONOMICS' && content.homeEconomics && (
        <ArrayFieldEditor
          items={content.homeEconomics.households} fields={householdProfileFields} itemLabel="担当プロフィール"
          createEmptyItem={createEmptyHouseholdProfile}
          onChange={(households) => setContent({
            ...content, homeEconomics: { ...content.homeEconomics!, households },
          })}
        />
      )}

      {tab === 2 && <Typography variant="body2" color="text.secondary">評価の重みの編集は今後の拡張で対応します。</Typography>}

      <Box>
        <Button variant="outlined" onClick={() => onSaveDraft(content)} disabled={saving} sx={{ mr: 1 }}>下書き保存</Button>
        <Button variant="contained" onClick={() => setConfirmOpen(true)} disabled={publishing}>この内容で版を発行する</Button>
      </Box>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>版を発行しますか？</DialogTitle>
        <DialogContent>
          <DialogContentText>版を発行すると、この内容は不変になります。以降の編集は新しい下書きとして扱われます。</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>キャンセル</Button>
          <Button variant="contained" onClick={() => { setConfirmOpen(false); onPublish() }}>発行する</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/components/teacher/templates/TemplateEditorPage.test.tsx`
Expected: PASS

- [ ] **Step 5: `npm run typecheck`**

- [ ] **Step 6: Commit**

```bash
git add src/components/teacher/templates/TemplateEditorPage.tsx src/components/teacher/templates/TemplateEditorPage.test.tsx
git commit -m "feat: add TemplateEditorPage shell wiring ArrayFieldEditor into a per-subject main-list tab"
```

---

### Task 5: 学習目標選択ステップ

ウィザードのStep 1。「市場のしくみ・投資判断を学ばせたい」／「将来に向けた資産形成・生活設計を学ばせたい」の2枚のカードを提示し、`LearningGoal`を選ばせる。

**Files:**
- Create: `src/components/teacher/templates/wizardSteps/LearningGoalSelectStep.tsx`, `.test.tsx`

**Interfaces:**
- Consumes: `LearningGoal`型（Task 1）
- Produces: `LearningGoalSelectStepProps`型、`LearningGoalSelectStep`コンポーネント

- [ ] **Step 1: 失敗するテストを書く**

`src/components/teacher/templates/wizardSteps/LearningGoalSelectStep.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LearningGoalSelectStep } from './LearningGoalSelectStep'

describe('LearningGoalSelectStep', () => {
  it('renders both learning-goal cards', () => {
    render(<LearningGoalSelectStep onSelect={vi.fn()} />)
    expect(screen.getByText('市場のしくみ・投資判断を学ばせたい')).toBeInTheDocument()
    expect(screen.getByText('将来に向けた資産形成・生活設計を学ばせたい')).toBeInTheDocument()
  })

  it('calls onSelect with MARKET_AND_INVESTING when that card is clicked', () => {
    const onSelect = vi.fn()
    render(<LearningGoalSelectStep onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: /市場のしくみ・投資判断を学ばせたい/ }))
    expect(onSelect).toHaveBeenCalledWith('MARKET_AND_INVESTING')
  })

  it('calls onSelect with LIFE_PLANNING when that card is clicked', () => {
    const onSelect = vi.fn()
    render(<LearningGoalSelectStep onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: /将来に向けた資産形成・生活設計を学ばせたい/ }))
    expect(onSelect).toHaveBeenCalledWith('LIFE_PLANNING')
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/components/teacher/templates/wizardSteps/LearningGoalSelectStep.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`src/components/teacher/templates/wizardSteps/LearningGoalSelectStep.tsx`:

```tsx
import { Card, CardActionArea, CardContent, Chip, Stack, Typography } from '@mui/material'
import type { LearningGoal } from '../../../../lib/lessonTemplates/guidedBuilderTypes'

export interface LearningGoalSelectStepProps {
  onSelect: (goal: LearningGoal) => void
}

const CARDS: { goal: LearningGoal; title: string; description: string; subjectLabel: string }[] = [
  {
    goal: 'MARKET_AND_INVESTING', title: '市場のしくみ・投資判断を学ばせたい',
    description: '企業の業績・ニュース・需給を見て売買を判断するシミュレーションです。',
    subjectLabel: '社会科',
  },
  {
    goal: 'LIFE_PLANNING', title: '将来に向けた資産形成・生活設計を学ばせたい',
    description: '家計のプロフィールを担当し、保険・住宅・資産配分・ライフイベントに対応するシミュレーションです。',
    subjectLabel: '家庭科',
  },
]

/** §14 Step1: 学習目標のフレーミングによる科目選択（design spec参照）。 */
export function LearningGoalSelectStep({ onSelect }: LearningGoalSelectStepProps) {
  return (
    <Stack spacing={2}>
      <Typography variant="h6">今回の授業で何を学ばせたいですか？</Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        {CARDS.map((card) => (
          <Card key={card.goal} sx={{ flex: 1 }}>
            <CardActionArea onClick={() => onSelect(card.goal)} aria-label={card.title} sx={{ p: 2, height: '100%' }}>
              <CardContent>
                <Chip label={card.subjectLabel} size="small" sx={{ mb: 1 }} />
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{card.title}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{card.description}</Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Stack>
    </Stack>
  )
}
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/components/teacher/templates/wizardSteps/LearningGoalSelectStep.test.tsx`
Expected: PASS

- [ ] **Step 5: `npm run typecheck`**

- [ ] **Step 6: Commit**

```bash
git add src/components/teacher/templates/wizardSteps/LearningGoalSelectStep.tsx src/components/teacher/templates/wizardSteps/LearningGoalSelectStep.test.tsx
git commit -m "feat: add learning-goal-framed subject selection step"
```

---

### Task 6: ウィザード汎用ステップエンジン

科目非依存のステップ進行エンジン`GuidedBuilderWizard`を実装する。Task 5の学習目標選択ステップを最初に描画し、選択された`goal`に応じて渡された`socialStudiesSteps`/`homeEconomicsSteps`（Task 7・8で実装、本タスクではモックで代替）へ進む。「戻る」で前のステップの回答を保持したまま戻れる。全ステップ完了後に`onComplete(answers)`を呼ぶ。

**Files:**
- Create: `src/components/teacher/templates/GuidedBuilderWizard.tsx`, `.test.tsx`

**Interfaces:**
- Consumes: `LearningGoalSelectStep`（Task 5）、`WizardAnswers`・`LearningGoal`（Task 1）
- Produces: `WizardStepComponent`型（各質問ステップコンポーネントが満たすべき共通インターフェース）、`GuidedBuilderWizardProps`型、`GuidedBuilderWizard`コンポーネント

- [ ] **Step 1: 失敗するテストを書く**

`src/components/teacher/templates/GuidedBuilderWizard.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GuidedBuilderWizard } from './GuidedBuilderWizard'
import type { WizardStepComponent } from './GuidedBuilderWizard'

const FakeStep: WizardStepComponent<{ value: string }> = ({ value, onChange, onNext, onBack }) => (
  <div>
    <input aria-label="fake-field" value={value ?? ''} onChange={(e) => onChange({ value: e.target.value })} />
    <button onClick={onBack}>戻る</button>
    <button onClick={onNext} disabled={!value}>次へ</button>
  </div>
)

describe('GuidedBuilderWizard', () => {
  it('starts on the learning-goal step', () => {
    render(<GuidedBuilderWizard socialStudiesSteps={[FakeStep]} homeEconomicsSteps={[FakeStep]} onComplete={vi.fn()} />)
    expect(screen.getByText('今回の授業で何を学ばせたいですか？')).toBeInTheDocument()
  })

  it('advances to the subject-specific steps after a goal is chosen, and back returns to goal selection', () => {
    render(<GuidedBuilderWizard socialStudiesSteps={[FakeStep]} homeEconomicsSteps={[FakeStep]} onComplete={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /市場のしくみ・投資判断を学ばせたい/ }))
    expect(screen.getByLabelText('fake-field')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '戻る' }))
    expect(screen.getByText('今回の授業で何を学ばせたいですか？')).toBeInTheDocument()
  })

  it('calls onComplete with the goal and collected step values once the last step advances', () => {
    const onComplete = vi.fn()
    render(<GuidedBuilderWizard socialStudiesSteps={[FakeStep]} homeEconomicsSteps={[FakeStep]} onComplete={onComplete} />)
    fireEvent.click(screen.getByRole('button', { name: /市場のしくみ・投資判断を学ばせたい/ }))
    fireEvent.change(screen.getByLabelText('fake-field'), { target: { value: 'answered' } })
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    expect(onComplete).toHaveBeenCalledWith('MARKET_AND_INVESTING', { value: 'answered' })
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/components/teacher/templates/GuidedBuilderWizard.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`src/components/teacher/templates/GuidedBuilderWizard.tsx`:

```tsx
import { useState, type ComponentType } from 'react'
import type { LearningGoal } from '../../../lib/lessonTemplates/guidedBuilderTypes'
import { LearningGoalSelectStep } from './wizardSteps/LearningGoalSelectStep'

export interface WizardStepProps<T> {
  value: T | undefined
  onChange: (value: T) => void
  onNext: () => void
  onBack: () => void
}

export type WizardStepComponent<T> = ComponentType<WizardStepProps<T>>

export interface GuidedBuilderWizardProps {
  socialStudiesSteps: WizardStepComponent<unknown>[]
  homeEconomicsSteps: WizardStepComponent<unknown>[]
  onComplete: (goal: LearningGoal, answers: unknown) => void
}

/**
 * Subject-agnostic step engine (design spec's "共有ウィザードエンジン").
 * Step 0 is always the learning-goal card selection; steps 1..N come from
 * whichever step array matches the chosen goal. Answers accumulate into a
 * single object via shallow merge — each subject's step array is
 * responsible for shaping that object into its own answer type before
 * calling onComplete.
 */
export function GuidedBuilderWizard({ socialStudiesSteps, homeEconomicsSteps, onComplete }: GuidedBuilderWizardProps) {
  const [goal, setGoal] = useState<LearningGoal | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, unknown>>({})

  if (goal === null) {
    return <LearningGoalSelectStep onSelect={(g) => { setGoal(g); setStepIndex(0) }} />
  }

  const steps = goal === 'MARKET_AND_INVESTING' ? socialStudiesSteps : homeEconomicsSteps
  const Step = steps[stepIndex]

  const handleNext = () => {
    if (stepIndex + 1 < steps.length) {
      setStepIndex(stepIndex + 1)
    } else {
      onComplete(goal, answers)
    }
  }

  const handleBack = () => {
    if (stepIndex === 0) {
      setGoal(null)
    } else {
      setStepIndex(stepIndex - 1)
    }
  }

  return (
    <Step
      value={answers}
      onChange={(value) => setAnswers({ ...answers, ...(value as Record<string, unknown>) })}
      onNext={handleNext}
      onBack={handleBack}
    />
  )
}
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/components/teacher/templates/GuidedBuilderWizard.test.tsx`
Expected: PASS

- [ ] **Step 5: `npm run typecheck`**

- [ ] **Step 6: Commit**

```bash
git add src/components/teacher/templates/GuidedBuilderWizard.tsx src/components/teacher/templates/GuidedBuilderWizard.test.tsx
git commit -m "feat: add subject-agnostic Guided Builder step engine"
```

---

### Task 7: 社会科質問ステップ

§14.1共通項目＋§14.2社会科追加項目を、Task 6の`WizardStepComponent`インターフェースへ準拠する1つのステップコンポーネントとして実装する（1画面にまとめる — 質問数が多くないため、ステップをさらに分割する必要はない）。既存の`SingleChoiceInput`/`NumberInput`（`@stock-league/lesson-inputs`）を再利用する。

**Files:**
- Create: `src/components/teacher/templates/wizardSteps/socialStudies/QuestionSteps.tsx`, `.test.tsx`

**Interfaces:**
- Consumes: `WizardStepComponent`（Task 6）、`SocialStudiesWizardAnswers`・`CommonWizardAnswers`（Task 1）、`SingleChoiceInput`/`NumberInput`/`ShortTextInput`（既存、`src/components/lessonInputs/`）
- Produces: `SocialStudiesQuestionStep`コンポーネント（`WizardStepComponent<CommonWizardAnswers & SocialStudiesWizardAnswers>`）

- [ ] **Step 1: 失敗するテストを書く**

`src/components/teacher/templates/wizardSteps/socialStudies/QuestionSteps.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SocialStudiesQuestionStep } from './QuestionSteps'

describe('SocialStudiesQuestionStep', () => {
  it('renders the company-count number input', () => {
    render(<SocialStudiesQuestionStep value={undefined} onChange={vi.fn()} onNext={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByLabelText('企業数')).toBeInTheDocument()
  })

  it('calls onChange with an updated companyCount when the number input changes', () => {
    const onChange = vi.fn()
    render(<SocialStudiesQuestionStep value={undefined} onChange={onChange} onNext={vi.fn()} onBack={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('企業数'), { target: { value: '6' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ companyCount: 6 }))
  })

  it('calls onBack when the back button is clicked', () => {
    const onBack = vi.fn()
    render(<SocialStudiesQuestionStep value={undefined} onChange={vi.fn()} onNext={vi.fn()} onBack={onBack} />)
    fireEvent.click(screen.getByRole('button', { name: '戻る' }))
    expect(onBack).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/components/teacher/templates/wizardSteps/socialStudies/QuestionSteps.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`src/components/teacher/templates/wizardSteps/socialStudies/QuestionSteps.tsx`:

```tsx
import { Button, Stack, TextField, Typography } from '@mui/material'
import { NumberInput } from '../../../lessonInputs/NumberInput'
import { SingleChoiceInput } from '../../../lessonInputs/SingleChoiceInput'
import type { WizardStepProps } from '../../GuidedBuilderWizard'
import type { CommonWizardAnswers, SocialStudiesWizardAnswers } from '../../../../../lib/lessonTemplates/guidedBuilderTypes'

type Answers = Partial<CommonWizardAnswers & SocialStudiesWizardAnswers>

/** §14.1共通項目 + §14.2社会科追加項目。1画面にまとめる（design spec参照）。 */
export function SocialStudiesQuestionStep({ value, onChange, onNext, onBack }: WizardStepProps<Answers>) {
  const answers = value ?? {}
  const set = (patch: Partial<Answers>) => onChange({ ...answers, ...patch })

  return (
    <Stack spacing={2}>
      <Typography variant="h6">授業の内容を教えてください（社会科）</Typography>
      <TextField label="テーマ" value={answers.theme ?? ''} onChange={(e) => set({ theme: e.target.value })} fullWidth />
      <NumberInput
        id="lesson-duration" label="授業時間（分）" config={{ type: 'NUMBER', min: 10, max: 200 }}
        value={answers.lessonDurationMinutes} errors={[]} onChange={(v) => set({ lessonDurationMinutes: v })}
      />
      <NumberInput
        id="company-count" label="企業数" config={{ type: 'NUMBER', min: 1, max: 20 }}
        value={answers.companyCount} errors={[]} onChange={(v) => set({ companyCount: v })}
      />
      <SingleChoiceInput
        id="difficulty" label="難易度" config={{ type: 'SINGLE_CHOICE', options: ['BASIC', 'STANDARD', 'ADVANCED'] }}
        value={answers.difficulty} errors={[]} onChange={(v) => set({ difficulty: v as Answers['difficulty'] })}
      />
      <SingleChoiceInput
        id="info-vs-demand" label="情報と需給、どちらを重視しますか" config={{ type: 'SINGLE_CHOICE', options: ['INFO_FOCUSED', 'BALANCED', 'DEMAND_FOCUSED'] }}
        value={answers.infoVsDemandWeight} errors={[]} onChange={(v) => set({ infoVsDemandWeight: v as Answers['infoVsDemandWeight'] })}
      />
      <Stack direction="row" spacing={1}>
        <Button onClick={onBack}>戻る</Button>
        <Button variant="contained" onClick={onNext}>次へ</Button>
      </Stack>
    </Stack>
  )
}
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/components/teacher/templates/wizardSteps/socialStudies/QuestionSteps.test.tsx`
Expected: PASS

- [ ] **Step 5: `npm run typecheck`**

- [ ] **Step 6: Commit**

```bash
git add src/components/teacher/templates/wizardSteps/socialStudies/QuestionSteps.tsx src/components/teacher/templates/wizardSteps/socialStudies/QuestionSteps.test.tsx
git commit -m "feat: add social-studies Guided Builder question step"
```

---

### Task 8: 家庭科質問ステップ

§14.1共通項目＋§14.3家庭科追加項目を、Task 7と同じ構造で実装する。

**Files:**
- Create: `src/components/teacher/templates/wizardSteps/homeEconomics/QuestionSteps.tsx`, `.test.tsx`

**Interfaces:**
- Consumes: `WizardStepComponent`（Task 6）、`CommonWizardAnswers`・`HomeEconomicsWizardAnswers`（Task 1）、`SingleChoiceInput`/`NumberInput`（既存）
- Produces: `HomeEconomicsQuestionStep`コンポーネント（`WizardStepComponent<CommonWizardAnswers & HomeEconomicsWizardAnswers>`）

- [ ] **Step 1: 失敗するテストを書く**

`src/components/teacher/templates/wizardSteps/homeEconomics/QuestionSteps.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HomeEconomicsQuestionStep } from './QuestionSteps'

describe('HomeEconomicsQuestionStep', () => {
  it('renders the course-format choice', () => {
    render(<HomeEconomicsQuestionStep value={undefined} onChange={vi.fn()} onNext={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByText('共通条件か人物比較か')).toBeInTheDocument()
  })

  it('calls onChange with an updated courseFormat when a choice is selected', () => {
    const onChange = vi.fn()
    render(<HomeEconomicsQuestionStep value={undefined} onChange={onChange} onNext={vi.fn()} onBack={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('COMMON_CONDITIONS'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ courseFormat: 'COMMON_CONDITIONS' }))
  })

  it('calls onNext when the next button is clicked', () => {
    const onNext = vi.fn()
    render(<HomeEconomicsQuestionStep value={undefined} onChange={vi.fn()} onNext={onNext} onBack={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    expect(onNext).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/components/teacher/templates/wizardSteps/homeEconomics/QuestionSteps.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`src/components/teacher/templates/wizardSteps/homeEconomics/QuestionSteps.tsx`:

```tsx
import { Button, Stack, TextField, Typography } from '@mui/material'
import { NumberInput } from '../../../lessonInputs/NumberInput'
import { SingleChoiceInput } from '../../../lessonInputs/SingleChoiceInput'
import type { WizardStepProps } from '../../GuidedBuilderWizard'
import type { CommonWizardAnswers, HomeEconomicsWizardAnswers } from '../../../../../lib/lessonTemplates/guidedBuilderTypes'

type Answers = Partial<CommonWizardAnswers & HomeEconomicsWizardAnswers>

/** §14.1共通項目 + §14.3家庭科追加項目。1画面にまとめる（design spec参照）。 */
export function HomeEconomicsQuestionStep({ value, onChange, onNext, onBack }: WizardStepProps<Answers>) {
  const answers = value ?? {}
  const set = (patch: Partial<Answers>) => onChange({ ...answers, ...patch })

  return (
    <Stack spacing={2}>
      <Typography variant="h6">授業の内容を教えてください（家庭科）</Typography>
      <TextField label="テーマ" value={answers.theme ?? ''} onChange={(e) => set({ theme: e.target.value })} fullWidth />
      <NumberInput
        id="lesson-duration" label="授業時間（分）" config={{ type: 'NUMBER', min: 10, max: 200 }}
        value={answers.lessonDurationMinutes} errors={[]} onChange={(v) => set({ lessonDurationMinutes: v })}
      />
      <SingleChoiceInput
        id="course-format" label="共通条件か人物比較か" config={{ type: 'SINGLE_CHOICE', options: ['COMMON_CONDITIONS', 'ROLE_VARIANT'] }}
        value={answers.courseFormat} errors={[]} onChange={(v) => set({ courseFormat: v as Answers['courseFormat'] })}
      />
      <SingleChoiceInput
        id="round-years" label="1ラウンドの期間" config={{ type: 'SINGLE_CHOICE', options: ['1', '5'] }}
        value={answers.roundYears ? String(answers.roundYears) : undefined} errors={[]}
        onChange={(v) => set({ roundYears: Number(v) as Answers['roundYears'] })}
      />
      <SingleChoiceInput
        id="event-disclosure" label="イベントの公開方法" config={{ type: 'SINGLE_CHOICE', options: ['ANNOUNCED', 'PARTIALLY_ANNOUNCED', 'HIDDEN'] }}
        value={answers.eventDisclosure} errors={[]} onChange={(v) => set({ eventDisclosure: v as Answers['eventDisclosure'] })}
      />
      <Stack direction="row" spacing={1}>
        <Button onClick={onBack}>戻る</Button>
        <Button variant="contained" onClick={onNext}>次へ</Button>
      </Stack>
    </Stack>
  )
}
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/components/teacher/templates/wizardSteps/homeEconomics/QuestionSteps.test.tsx`
Expected: PASS

- [ ] **Step 5: `npm run typecheck`**

- [ ] **Step 6: Commit**

```bash
git add src/components/teacher/templates/wizardSteps/homeEconomics/QuestionSteps.tsx src/components/teacher/templates/wizardSteps/homeEconomics/QuestionSteps.test.tsx
git commit -m "feat: add home-economics Guided Builder question step"
```

---

### Task 9: §14.4最終確認ページ（3案比較・選択・確定）

`GuidedBuilderWizard`が`onComplete`で渡す`(goal, answers)`を受け取り、Task 1の`buildDraftFromAnswers`で3案（簡易/標準/発展）を生成してカード比較表示する。選択後、タイトル・説明文のインライン編集を経て「この内容で作成」（`createLessonTemplate`を呼び、`onCreated(templateId)`でフルエディタへ遷移させる）を提供する。

**Files:**
- Create: `src/components/teacher/templates/TemplateOverviewPage.tsx`, `.test.tsx`

**Interfaces:**
- Consumes: `WizardAnswers`（Task 1）、`buildDraftFromAnswers`（Task 1）、`createLessonTemplate`（既存、`src/lib/lessonTemplates/repository.ts`）
- Produces: `TemplateOverviewPageProps`型、`TemplateOverviewPage`コンポーネント

- [ ] **Step 1: 失敗するテストを書く**

`src/components/teacher/templates/TemplateOverviewPage.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TemplateOverviewPage } from './TemplateOverviewPage'
import type { WizardAnswers } from '../../../lib/lessonTemplates/guidedBuilderTypes'

const answers: WizardAnswers = {
  goal: 'MARKET_AND_INVESTING',
  mainObjective: '需給を学ぶ', lessonDurationMinutes: 50, studentCount: 30, deviceEnvironment: 'ONE_PER_STUDENT', teamMode: 'TEAM', readingDepth: 'STANDARD', theme: 'テストテーマ', difficulty: 'STANDARD',
  companyCount: 5, useEarnings: true, useUncertainty: false, infoVsDemandWeight: 'BALANCED', alwaysOnMarketMinutes: 20, predictionCheckpoints: 2, evaluationFocus: 'OPERATION_RESULT',
}

describe('TemplateOverviewPage', () => {
  it('renders three tier cards to compare', () => {
    render(<TemplateOverviewPage answers={answers} onCreate={vi.fn()} creating={false} />)
    expect(screen.getByRole('button', { name: /簡易案/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /標準案/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /発展案/ })).toBeInTheDocument()
  })

  it('shows the §14.4 confirmation summary and create button once a tier is chosen', () => {
    render(<TemplateOverviewPage answers={answers} onCreate={vi.fn()} creating={false} />)
    fireEvent.click(screen.getByRole('button', { name: /標準案/ }))
    expect(screen.getByRole('button', { name: 'この内容で作成' })).toBeInTheDocument()
  })

  it('calls onCreate with the chosen tier draft when confirmed', async () => {
    const onCreate = vi.fn()
    render(<TemplateOverviewPage answers={answers} onCreate={onCreate} creating={false} />)
    fireEvent.click(screen.getByRole('button', { name: /標準案/ }))
    fireEvent.click(screen.getByRole('button', { name: 'この内容で作成' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ subject: 'SOCIAL_STUDIES' })))
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/components/teacher/templates/TemplateOverviewPage.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`src/components/teacher/templates/TemplateOverviewPage.tsx`:

```tsx
import { useMemo, useState } from 'react'
import { Button, Card, CardActionArea, CardContent, Stack, Typography } from '@mui/material'
import type { WizardAnswers } from '../../../lib/lessonTemplates/guidedBuilderTypes'
import type { GuidedBuilderTier } from '../../../lib/lessonTemplates/guidedBuilderTypes'
import { buildDraftFromAnswers } from '../../../lib/lessonTemplates/guidedBuilderPresets'
import type { LessonContent } from '../../../lib/lessonTemplates/types'

export interface TemplateOverviewPageProps {
  answers: WizardAnswers
  onCreate: (draft: LessonContent) => void
  creating: boolean
}

const TIER_LABELS: Record<GuidedBuilderTier, string> = { EASY: '簡易案', STANDARD: '標準案', ADVANCED: '発展案' }

/** §14.4最終確認ページ。3案比較 → 選択 → 確定。 */
export function TemplateOverviewPage({ answers, onCreate, creating }: TemplateOverviewPageProps) {
  const drafts = useMemo(() => {
    const tiers: GuidedBuilderTier[] = ['EASY', 'STANDARD', 'ADVANCED']
    return tiers.map((tier) => ({ tier, draft: buildDraftFromAnswers(answers, tier) }))
  }, [answers])

  const [chosen, setChosen] = useState<LessonContent | null>(null)

  if (!chosen) {
    return (
      <Stack spacing={2}>
        <Typography variant="h6">3つの案から選んでください</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          {drafts.map(({ tier, draft }) => (
            <Card key={tier} sx={{ flex: 1 }}>
              <CardActionArea onClick={() => setChosen(draft)} aria-label={`${TIER_LABELS[tier]}を選ぶ`} sx={{ p: 2, height: '100%' }}>
                <CardContent>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{TIER_LABELS[tier]}</Typography>
                  <Typography variant="body2" color="text.secondary">{draft.title}</Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Stack>
      </Stack>
    )
  }

  return (
    <Stack spacing={2}>
      <Typography variant="h6">授業概要</Typography>
      <Typography variant="body1"><strong>目標:</strong> {chosen.description}</Typography>
      <Typography variant="body1"><strong>タイトル:</strong> {chosen.title}</Typography>
      <Button variant="contained" onClick={() => onCreate(chosen)} disabled={creating}>この内容で作成</Button>
      <Button onClick={() => setChosen(null)}>案の選択に戻る</Button>
    </Stack>
  )
}
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/components/teacher/templates/TemplateOverviewPage.test.tsx`
Expected: PASS

- [ ] **Step 5: `npm run typecheck`**

- [ ] **Step 6: Commit**

```bash
git add src/components/teacher/templates/TemplateOverviewPage.tsx src/components/teacher/templates/TemplateOverviewPage.test.tsx
git commit -m "feat: add §14.4 tier comparison and final confirmation page"
```

---

### Task 10: 教師ホーム画面（教材一覧）

`TemplateListPage`を実装する。ログイン教師の`orgId`に属する`lessonTemplates`を一覧表示し（`firestore.rules`の`allow list: if teacher() && activeMember(resource.data.orgId)`が既に許可済み）、「新規作成」ボタンから`/teacher/templates/new`へ遷移する。既存テンプレートをクリックすると`/teacher/templates/:templateId/edit`へ遷移する。

**Files:**
- Create: `src/components/teacher/templates/TemplateListPage.tsx`, `.test.tsx`

**Interfaces:**
- Consumes: `LessonTemplate`型（既存、`src/lib/lessonTemplates/types.ts`）
- Produces: `TemplateListPageProps`型、`TemplateListPage`コンポーネント

- [ ] **Step 1: 失敗するテストを書く**

`src/components/teacher/templates/TemplateListPage.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TemplateListPage } from './TemplateListPage'
import type { LessonTemplate } from '../../../lib/lessonTemplates/types'

const templates: LessonTemplate[] = [{
  id: 'tpl-1', orgId: 'org-1', createdByUid: 'uid-1',
  draft: { schemaVersion: 1, title: '既存の教材', description: '', subject: 'SOCIAL_STUDIES' },
  currentPublishedVersionId: null, status: 'DRAFT', visibility: 'PRIVATE',
  createdAt: { toMillis: () => 0 } as never, updatedAt: { toMillis: () => 0 } as never,
}]

describe('TemplateListPage', () => {
  it('renders each template title', () => {
    render(<TemplateListPage templates={templates} loading={false} onCreateNew={vi.fn()} onOpen={vi.fn()} />)
    expect(screen.getByText('既存の教材')).toBeInTheDocument()
  })

  it('shows an empty-state message when there are no templates yet', () => {
    render(<TemplateListPage templates={[]} loading={false} onCreateNew={vi.fn()} onOpen={vi.fn()} />)
    expect(screen.getByText('まだ教材がありません。')).toBeInTheDocument()
  })

  it('calls onCreateNew when the create button is clicked', () => {
    const onCreateNew = vi.fn()
    render(<TemplateListPage templates={[]} loading={false} onCreateNew={onCreateNew} onOpen={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '新規作成' }))
    expect(onCreateNew).toHaveBeenCalledOnce()
  })

  it('calls onOpen with the template id when a template row is clicked', () => {
    const onOpen = vi.fn()
    render(<TemplateListPage templates={templates} loading={false} onCreateNew={vi.fn()} onOpen={onOpen} />)
    fireEvent.click(screen.getByText('既存の教材'))
    expect(onOpen).toHaveBeenCalledWith('tpl-1')
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/components/teacher/templates/TemplateListPage.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`src/components/teacher/templates/TemplateListPage.tsx`:

```tsx
import { Button, CircularProgress, List, ListItemButton, ListItemText, Stack, Typography } from '@mui/material'
import type { LessonTemplate } from '../../../lib/lessonTemplates/types'

export interface TemplateListPageProps {
  templates: LessonTemplate[]
  loading: boolean
  onCreateNew: () => void
  onOpen: (templateId: string) => void
}

export function TemplateListPage({ templates, loading, onCreateNew, onOpen }: TemplateListPageProps) {
  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5">教材一覧</Typography>
        <Button variant="contained" onClick={onCreateNew}>新規作成</Button>
      </Stack>
      {loading && <CircularProgress aria-label="読み込み中" />}
      {!loading && templates.length === 0 && <Typography variant="body2" color="text.secondary">まだ教材がありません。</Typography>}
      {!loading && templates.length > 0 && (
        <List>
          {templates.map((template) => (
            <ListItemButton key={template.id} onClick={() => onOpen(template.id)}>
              <ListItemText primary={template.draft.title} secondary={template.status} />
            </ListItemButton>
          ))}
        </List>
      )}
    </Stack>
  )
}
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/components/teacher/templates/TemplateListPage.test.tsx`
Expected: PASS

- [ ] **Step 5: `npm run typecheck`**

- [ ] **Step 6: Commit**

```bash
git add src/components/teacher/templates/TemplateListPage.tsx src/components/teacher/templates/TemplateListPage.test.tsx
git commit -m "feat: add teacher template list / entry-point page"
```

---

### Task 11: ルーティング配線

`src/App.tsx`へ3ルート（`/teacher/templates`、`/teacher/templates/new`、`/teacher/templates/:templateId/edit`）を追加し、Task 1〜10のコンポーネントをFirestore/Functionsへ接続するルートコンポーネントを実装する。既存の`TeacherControlRoute`等と同じ認可パターン（`useTeacherLessonAccess`相当のorg所属確認）に倣うが、テンプレート一覧・作成はlessonRunに紐付かないため、`activeMember`確認のみのシンプルな認可にする。

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `TemplateListPage`（Task 10）、`GuidedBuilderWizard`（Task 6）、`TemplateOverviewPage`（Task 9）、`TemplateEditorPage`（Task 4）、`SocialStudiesQuestionStep`（Task 7）、`HomeEconomicsQuestionStep`（Task 8）、`createLessonTemplate`/`saveDraft`（既存）、`publishLessonVersion`（既存）
- Produces: なし（ルート定義の追加のみ）

- [ ] **Step 1: 失敗するテストを書く**

`src/App.test.tsx`に追記する（既存のルートガードテストの並びに合わせる。実際のテストファイルを先に読み、既存の`enabled`/`services`モックパターンに揃えること）:

```tsx
it('routes /teacher/templates to the template list route', () => {
  // 既存の /teacher/lessons/:runId/control のテストと同じレンダリング手順で
  // /teacher/templates へナビゲートし、教材一覧のページ要素が現れることを確認する。
  // 既存テストの services モック・MemoryRouter セットアップを流用すること。
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/App.test.tsx`
Expected: FAIL — ルートが存在しない

- [ ] **Step 3: `App.tsx`にルートコンポーネントを実装する**

`src/App.tsx`の既存の`TeacherControlRoute`等の定義に倣い、以下を追加する（既存のimport文・`useTeacherLessonAccess`相当のフック・`GuardLoading`を使う。関数コンポーネントの配置は既存の`TeacherControlRoute`関数の直後に追加する）:

```tsx
function TemplateListRoute({ services }: { services: FirebaseServices }) {
  const [templates, setTemplates] = useState<LessonTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  useEffect(() => {
    const uid = services.auth.currentUser?.uid
    if (!uid) return
    const q = query(collection(services.firestore, 'lessonTemplates'), where('orgId', '==', personalOrgId(uid)))
    getDocs(q).then((snap) => {
      setTemplates(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LessonTemplate))
      setLoading(false)
    })
  }, [services])
  return <TemplateListPage
    templates={templates} loading={loading}
    onCreateNew={() => navigate('/teacher/templates/new')}
    onOpen={(id) => navigate(`/teacher/templates/${id}/edit`)}
  />
}

function TemplateNewRoute({ services }: { services: FirebaseServices }) {
  const navigate = useNavigate()
  const [answers, setAnswers] = useState<{ goal: LearningGoal; answers: unknown } | null>(null)
  const [creating, setCreating] = useState(false)
  if (!answers) {
    return <GuidedBuilderWizard
      socialStudiesSteps={[SocialStudiesQuestionStep]}
      homeEconomicsSteps={[HomeEconomicsQuestionStep]}
      onComplete={(goal, stepAnswers) => setAnswers({ goal, answers: stepAnswers })}
    />
  }
  return <TemplateOverviewPage
    answers={{ goal: answers.goal, ...(answers.answers as object) } as WizardAnswers}
    creating={creating}
    onCreate={async (draft) => {
      setCreating(true)
      const uid = services.auth.currentUser!.uid
      const templateId = await createLessonTemplate(services.firestore, uid, draft)
      navigate(`/teacher/templates/${templateId}/edit`)
    }}
  />
}

function TemplateEditRoute({ services }: { services: FirebaseServices }) {
  const { templateId } = useParams<{ templateId: string }>()
  const [draft, setDraft] = useState<LessonContent | null>(null)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  useEffect(() => {
    if (!templateId) return
    getDoc(doc(services.firestore, 'lessonTemplates', templateId)).then((snap) => {
      const data = snap.data() as LessonTemplate | undefined
      if (data) setDraft(data.draft)
    })
  }, [services, templateId])
  if (!draft || !templateId) return <GuardLoading />
  return <TemplateEditorPage
    draft={draft} saving={saving} publishing={publishing}
    onSaveDraft={async (content) => {
      setSaving(true)
      await saveDraft(services.firestore, templateId, content)
      setDraft(content)
      setSaving(false)
    }}
    onPublish={async () => {
      setPublishing(true)
      await publishLessonVersion(services.functions, { templateId, idempotencyKey: crypto.randomUUID() })
      setPublishing(false)
    }}
  />
}
```

必要なimportを`App.tsx`先頭へ追加する（既存のimport群に合わせて整理する）:

```tsx
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import type { LessonContent, LessonTemplate } from './lib/lessonTemplates/types'
import type { LearningGoal, WizardAnswers } from './lib/lessonTemplates/guidedBuilderTypes'
import { createLessonTemplate, saveDraft } from './lib/lessonTemplates/repository'
import { publishLessonVersion } from './lib/lessonTemplates/publishLessonVersion'
import { personalOrgId } from './lib/org/personalOrgId'
import { TemplateListPage } from './components/teacher/templates/TemplateListPage'
import { GuidedBuilderWizard } from './components/teacher/templates/GuidedBuilderWizard'
import { TemplateOverviewPage } from './components/teacher/templates/TemplateOverviewPage'
import { TemplateEditorPage } from './components/teacher/templates/TemplateEditorPage'
import { SocialStudiesQuestionStep } from './components/teacher/templates/wizardSteps/socialStudies/QuestionSteps'
import { HomeEconomicsQuestionStep } from './components/teacher/templates/wizardSteps/homeEconomics/QuestionSteps'
```

`AppRoutes`内の既存ルート一覧（`<Route path="/teacher/lessons/:runId/control" .../>`の付近）へ以下を追加する:

```tsx
<Route path="/teacher/templates" element={enabled && services ? <TemplateListRoute services={services} /> : <Navigate replace to="/about" />} />
<Route path="/teacher/templates/new" element={enabled && services ? <TemplateNewRoute services={services} /> : <Navigate replace to="/about" />} />
<Route path="/teacher/templates/:templateId/edit" element={enabled && services ? <TemplateEditRoute services={services} /> : <Navigate replace to="/about" />} />
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/App.test.tsx`
Expected: PASS

- [ ] **Step 5: `npm run typecheck && npm run lint`**

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: wire Guided Lesson Builder routes into the app"
```

---

### Task 12: 受け入れテスト

「ウィザードで3案から選択→確認→作成→フルエディタで担当プロフィールを1件追加→版発行」という一連のフローを1本のコンポーネントテストで通す。Phase Dの`test/household-lifecycle.acceptance.test.ts`と同様、実際のFirestore/Functionsへは接続せず、Task 1〜10で実装した純粋関数・コンポーネントを直接組み合わせて検証する（emulator非依存）。

**Files:**
- Create: `test/guided-lesson-builder.acceptance.test.tsx`

**Interfaces:**
- Consumes: `buildDraftFromAnswers`（Task 1）、`ArrayFieldEditor`（Task 2）、`householdProfileFields`/`createEmptyHouseholdProfile`（Task 3）、`TemplateEditorPage`（Task 4）、`GuidedBuilderWizard`（Task 6）、`HomeEconomicsQuestionStep`（Task 8）、`TemplateOverviewPage`（Task 9）
- Produces: なし（テストファイルのみ）

- [ ] **Step 1: 失敗するテストを書く**

`test/guided-lesson-builder.acceptance.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GuidedBuilderWizard } from '../src/components/teacher/templates/GuidedBuilderWizard'
import { SocialStudiesQuestionStep } from '../src/components/teacher/templates/wizardSteps/socialStudies/QuestionSteps'
import { HomeEconomicsQuestionStep } from '../src/components/teacher/templates/wizardSteps/homeEconomics/QuestionSteps'
import { TemplateOverviewPage } from '../src/components/teacher/templates/TemplateOverviewPage'
import { TemplateEditorPage } from '../src/components/teacher/templates/TemplateEditorPage'
import type { LessonContent } from '../src/lib/lessonTemplates/types'
import type { WizardAnswers } from '../src/lib/lessonTemplates/guidedBuilderTypes'

describe('Guided Lesson Builder acceptance flow (home economics)', () => {
  it('wizard → 3-tier overview → household added in the full editor, ending with a publishable LessonContent', () => {
    let completedAnswers: { goal: string; answers: unknown } | null = null
    const { unmount } = render(<GuidedBuilderWizard
      socialStudiesSteps={[SocialStudiesQuestionStep]}
      homeEconomicsSteps={[HomeEconomicsQuestionStep]}
      onComplete={(goal, answers) => { completedAnswers = { goal, answers } }}
    />)

    fireEvent.click(screen.getByRole('button', { name: /将来に向けた資産形成・生活設計を学ばせたい/ }))
    fireEvent.change(screen.getByLabelText('授業時間（分）'), { target: { value: '50' } })
    fireEvent.click(screen.getByLabelText('COMMON_CONDITIONS'))
    fireEvent.click(screen.getByLabelText('5'))
    fireEvent.click(screen.getByLabelText('ANNOUNCED'))
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    unmount()

    expect(completedAnswers).not.toBeNull()
    const wizardAnswers = { goal: completedAnswers!.goal, ...(completedAnswers!.answers as object) } as WizardAnswers

    let created: LessonContent | null = null
    const { unmount: unmountOverview } = render(<TemplateOverviewPage
      answers={wizardAnswers} creating={false}
      onCreate={(draft) => { created = draft }}
    />)
    fireEvent.click(screen.getByRole('button', { name: /標準案/ }))
    fireEvent.click(screen.getByRole('button', { name: 'この内容で作成' }))
    unmountOverview()

    expect(created).not.toBeNull()
    expect(created!.subject).toBe('HOME_ECONOMICS')
    expect(created!.homeEconomics!.courseFormat).toBe('COMMON_CONDITIONS')

    let saved: LessonContent | null = null
    render(<TemplateEditorPage
      draft={created!} saving={false} publishing={false}
      onSaveDraft={(content) => { saved = content }}
      onPublish={vi.fn()}
    />)
    fireEvent.click(screen.getByRole('tab', { name: '主要な一覧' }))
    fireEvent.click(screen.getByRole('button', { name: '担当プロフィールを追加' }))
    fireEvent.click(screen.getByRole('button', { name: '下書き保存' }))

    expect(saved).not.toBeNull()
    expect(saved!.homeEconomics!.households.length).toBe(1)
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run test/guided-lesson-builder.acceptance.test.tsx`
Expected: FAIL（Task 1〜10が未実装の場合）または本タスク時点ではPASS（全タスク完了後に実行する想定のため、Task 1〜11がすべて完了していれば最初からPASSしてよい — その場合はStep 2を「実装済みであることの確認」として扱い、そのままStep 3へ進む）

- [ ] **Step 3: テストを通す**

Run: `npx vitest run test/guided-lesson-builder.acceptance.test.tsx`
Expected: PASS

- [ ] **Step 4: `npm run verify`（全ワークスペース）**

- [ ] **Step 5: Commit**

```bash
git add test/guided-lesson-builder.acceptance.test.tsx
git commit -m "test: add Guided Lesson Builder end-to-end acceptance test"
```
