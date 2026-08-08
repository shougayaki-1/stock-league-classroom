# Phase D: 家庭科完成（生活設計シミュレーション）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **作成中。Task 1〜4のみ詳細まで記述済み。Task 5〜17は §「タスク一覧」の1行タイトルのみで、ステップ・コード例・検証方法が書かれていない。** 続きを書く場合は、Task 1〜4と同じ密度（Files / Interfaces / Step ごとのテストコード / Run / Expected）で Task 5から埋めること。書き終わったタスクから随時ファイルへ保存し、一度に全部書こうとしないこと（Phase C計画で同じ問題が起き、前の試行が2回失敗した実績がある）。

> **正本は統合仕様書。** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md`（§7、§13、§27.4、§28）と `docs/superpowers/specs/2026-08-05-integrated-spec-resolutions.md`（矛盾解消G・H）が優先する。本計画と両文書が矛盾する場合は両文書を優先し、本計画側の誤りとして扱う。

> **前提: Phase A・B・Cは完了済み。** `orgId`所有、権限3層、`LessonRun`/`LessonEvent`/`LessonCheckpoint`、`restoreGeneration`、決定的PRNG（`functions/packages/deterministic-random`）、`lessonRunPublic`/`lessonRunPrivate`/`lessonRunTeamState`のRTDBパス分離、`functions/packages/*`共有パッケージパターン、教師画面・生徒画面・教室表示・参加・チーム・フェーズ進行・入力ウィジェット9種（`@stock-league/lesson-inputs`）・回答state machine・チェックポイント・復帰コードが揃っている。Phase Cの実装計画は`docs/superpowers/plans/2026-08-05-phase-c-market-plan.md`を、共有パッケージ配置・トランザクション規律・レビュー体制の実例として参照する。**Phase Dは市場エンジン（Phase C）に依存しない**（矛盾解消G、後述）——Phase Bのみに依存する。

> **矛盾解消G（家庭科と`MARKET`フェーズの関係、必読）:** 家庭科は`MARKET`フェーズを使わない。資産配分や購入の判断は`DECISION`フェーズで行う。理由は時間の単位が異なるため——社会科の市場は3秒区間の実時間シミュレーションだが、家庭科は1ラウンド＝5年（既定）で資産の収益は年次収益率。`LessonPhase.type`（Phase B `functions/src/lessonRuns/phases/validation.ts`）は既に`'DECISION'`を含み、`HOME_ECONOMICS`教材が`MARKET`フェーズを含む場合は`validateLessonForStart`が`HOME_ECONOMICS_MARKET_FORBIDDEN`で拒否する実装が既にPhase B Task5で完了している——本計画はこのバリデーションの上に構築し、再実装しない。

> **矛盾解消H（`REFLECTION`と市場停止の関係）:** 家庭科には市場という概念自体がないため直接は関係しないが、`REFLECTION`遷移が「授業実施状態を後戻りなしで進める」層であるという整理はPhase Dの各ラウンド終了処理にもそのまま適用される——ラウンド内の一時停止と`REFLECTION`遷移を混同しないこと。

> **社会科（Phase C）との比較で読むと理解しやすい設計判断:**
> - Phase Cの「3秒バッチ」に相当するのが、Phase Dの「ラウンド（既定5年）」。ただし駆動方式は全く異なる——Cは`Cloud Tasksの自己連鎖`だが、Dの各ラウンドは`DECISION`フェーズの提出完了（`SUBMISSION_BASED`）または教師操作（`TEACHER_CONTROLLED`）で進むため、Cloud Tasks・バッチスケジューラは不要。
> - Phase Cの「価格計算エンジン」に相当するのが、Phase Dの「年次計算エンジン」（収入・支出・税・資産収益率・住宅ローン返済）。ただし乱数を使うのはイベント発生判定と資産収益率のノイズ項のみ——`functions/packages/deterministic-random`の`deriveSeed`/`mulberry32`をCと全く同じ規律で使う。
> - Phase Cの「公開/非公開データ分離」の原則はDにも同一に適用される——保険の給付条件詳細や教材作成者用の内部係数（イベント発生確率の内部パラメータ等）を生徒に見せない設計。
> - Phase Cが「チーム」を主語にしていたのに対し、Dは「チームが担当する人物（プロフィール）」が主語になる（§13.3「役割・人物別」「チーム内複数人物」モードがあるため、1チームが複数`HouseholdState`を持ちうる）。

**Goal:** 家庭科・生活設計シミュレーション（統合仕様書§13）を、Phase A/Bの共通授業基盤の上に実装する。生徒はチーム（または人物）ごとに架空プロフィールを担当し、ラウンドごとに収入・支出・資産配分・保険・住宅・イベント対応を`DECISION`フェーズで判断し、年次計算エンジンがその結果を反映、最終的に5観点（生活目標達成・生活安定性・分散・借入負担・振り返り等）で評価される。

**Architecture:** 全ての計算は純粋関数として`functions/src/homeEconomics/engine/`に実装し、Callable/onCallは薄いI/O層にする（Phase Cの`functions/src/market/engine/`と同じ分離方針）。`HouseholdState`を「生徒に見せてよい公開ビュー」と「教材作成者のみが読み書きする非公開authoring型（イベント発生確率、内部係数）」に型レベルで分離する（Phase C Task1の`market-public-content`/`market-authoring-content`パターンをそのまま踏襲）。ラウンド進行はPhase Bの`transitionPhase`（フェーズ遷移）とTask11（本計画）の「ラウンド確定」処理を組み合わせる——Cloud Tasksのような自己連鎖機構は持たず、常に教師操作またはチーム全員の提出完了がトリガーになる。

**Tech Stack:** TypeScript, Firebase Firestore（`lessonRuns/{id}/households/{householdId}`サブコレクション、トランザクション）, Firebase Realtime Database（`lessonRunPublic`/`lessonRunPrivate`/`lessonRunTeamState`の家庭科版フィールド拡張）, Cloud Functions for Firebase v2（`onCall`のみ、Cloud Tasksは使わない）, `functions/packages/deterministic-random`, `@stock-league/lesson-inputs`（既存9ウィジェットを`DECISION`フェーズの判断入力に再利用）, Vitest, `@firebase/rules-unit-testing`。

## Global Constraints

- 各タスクは完了時に `npm run verify`（`lint` → `typecheck` → `test` → `test:rules` → `build` → `functions`/`packages/*` の `verify`）を通すこと。
- 乱数は`Math.random()`禁止。`functions/packages/deterministic-random`の`deriveSeed`/`mulberry32`のみを使う。シード導出式はPhase Cと同じ形式に揃え、`derive([randomSeed, restoreGeneration, householdId, roundIndex])`のように配列引数で呼ぶ（Phase C Task3で確定した`deriveSeed`の実際のシグネチャに合わせること——実装着手時に`functions/packages/deterministic-random/src/index.ts`を確認する）。
- 生徒へ教材作成者専用の内部係数（イベント発生確率パラメータ、保険の内部リスク計算式、他チームのプロフィール）を送らない。型を`packages/household-public-content`相当（生徒向けDTO）と`packages/household-authoring-content`相当（教師/サーバー用）に分け、間引き変換関数はFunctions内の1箇所に固定する（Phase C Task1の設計をそのまま踏襲、詳細はTask1参照）。
- **新規共有npmパッケージは`functions/packages/`配下に配置すること。リポジトリルート直下の`packages/`に置くと、Firebase Functionsのデプロイパッケージング（`functions/`ディレクトリのみが対象）を壊す。** これはPhase A Task1・Phase B Task1/7・Phase C Task1で繰り返し発生した実バグであり、本計画のタスクブリーフのコード例がルート直下`packages/`を指している箇所があれば、実装時に`functions/packages/`へ読み替えること。
- **`functions/`から`src/`への相対パスimportを禁止する。** tscの`rootDir`境界を壊し、Cloud Functionsデプロイバンドルへ`src/`が混入するリスクを生む。Phase C Task2・15・16で繰り返し発見・修正された既知の誤りパターン——共有される型は必ず`functions/packages/*`workspaceパッケージに定義し、`src/`側はそこからre-exportする。
- 冪等性: 判断提出・ラウンド確定・チェックポイント作成のすべてに`idempotencyKey`を要求し、`functions/src/lib/idempotency.ts`の`idempotencyDocumentId`/`requestDigest`パターン（Phase A/B/C全体で一貫）を踏襲する。
- Firestoreトランザクションは全read→全writeの順序を厳守する。このリポジトリ最重要の既知バグパターンで、Phase A/B/Cを通じて複数回のCritical指摘の原因になっている。
- エラー処理規約: 純粋関数/DI層は素の`Error`をthrow、Callable境界（`onCall.ts`）だけが`HttpsError`へ変換する。
- 新規Callableを`onCall.ts`に実装したら、必ず`functions/src/index.ts`からexportすること。過去に4回以上、この export漏れによってCallableがデプロイされない実装済みバグが発生している。
- `LessonInputRenderer`（`@stock-league/lesson-inputs`、Phase B Task6）の既存9ウィジェットを最大限再利用し、家庭科専用の新規入力ウィジェット型を安易に追加しない——資産配分は`RankingInput`/`QuantityInput`、保険選択は`SingleChoiceInput`/`ReasonChoiceInput`等、既存の型で表現できないか先に検討する。
- 本名は本人+自チームのみ、他チームには表示しない（§23.6、Phase B全体で徹底）。担当プロフィールが架空である旨（§13.4「これは授業用の架空プロフィールです」）を生徒画面に必ず表示する。
- 保険は資産と型レベルで分離する（§13.6「資産配分円グラフへ保険を混ぜない」）——`HouseholdState.assets`と`HouseholdState.insuranceContracts`を同一配列にしない。
- 数値・式の版を教材版へ固定する（§13.8「税・社会保険」）——教材publish後に税率式を変更しても進行中の授業へ影響しない、というPhase A/Bのtemplate/version不変性パターンをそのまま踏襲する。

---

## File Structure

| File | Change |
| --- | --- |
| `functions/packages/household-public-content/package.json`, `tsconfig.json`, `src/index.ts`, `src/index.test.ts` | Create（Task 1。生徒公開DTO: `AssetPositionPublicView`、`InsuranceContractPublicView`、`HouseholdProfilePublicView`等） |
| `functions/packages/household-authoring-content/package.json`, `tsconfig.json`, `src/index.ts`, `src/index.test.ts` | Create（Task 1。非公開authoring型: `HouseholdProfile`、`AssetPosition`、`InsuranceProduct`、`LifeEventDefinition`、内部係数を含む） |
| `functions/src/homeEconomics/toPublicView.ts`, `.test.ts` | Create（Task 1。private→public変換関数） |
| `src/lib/lessonTemplates/types.ts` | Modify（Task 2。`LessonContent`に`homeEconomics?: HomeEconomicsContent`を追加） |
| `functions/src/homeEconomics/templateValidation.ts`, `.test.ts` | Create（Task 2。プロフィール7項目必須、税・社会保険式の版固定等の教材バリデーション） |
| `functions/src/homeEconomics/engine/annualCashFlow.ts`, `.test.ts` | Create（Task 3。年単位の収入・支出集計、固定費/変動費区別） |
| `functions/src/homeEconomics/engine/taxAndSocialInsurance.ts`, `.test.ts` | Create（Task 3。簡略税・社会保険式） |
| `functions/src/homeEconomics/engine/assetReturn.ts`, `.test.ts` | Create（Task 4。年次収益率、経済要因（物価・金利・景気）反映、決定的PRNGによるノイズ項） |
| `functions/src/homeEconomics/engine/mortgage.ts`, `.test.ts` | Create（Task 5。元利均等返済） |
| `functions/src/homeEconomics/engine/insurance.ts`, `.test.ts` | Create（Task 6。保険料・給付条件の簡略計算） |
| `functions/src/homeEconomics/engine/lifeEvents.ts`, `.test.ts` | Create（Task 7。イベント発生判定・公開方法・効果適用） |
| `functions/src/homeEconomics/engine/shortfallOptions.ts`, `.test.ts` | Create（Task 8。資金不足時の選択肢提示） |
| `functions/src/homeEconomics/engine/publicSupport.ts`, `.test.ts` | Create（Task 9。公的支援の条件判定・効果） |
| `functions/src/lessonRuns/households/repository.ts`, `.test.ts` | Create（Task 10。`HouseholdState`Firestore正本、チーム/人物単位） |
| `functions/src/homeEconomics/submitDecision.ts`, `.test.ts`, `onCall.ts` / `src/lib/homeEconomics/submitDecision.ts`, `.test.ts` | Create（Task 10。`DECISION`フェーズの判断提出Callable、Phase B `saveResponseDraft`/`submitProposal`パターンを再利用） |
| `functions/src/homeEconomics/engine/settleRound.ts`, `.test.ts` | Create（Task 11。ラウンド確定の中核純粋関数、Task3〜9を統合するオーケストレーター） |
| `functions/src/homeEconomics/processRound.ts`, `.test.ts`, `onCall.ts` | Create（Task 11。Admin SDKラッパー、教師操作またはチーム全員提出完了で発火） |
| `functions/src/homeEconomics/engine/retirement.ts`, `.test.ts` | Create（Task 12。退職後の収入減少・簡略年金・資産取り崩し・長寿リスク） |
| `functions/src/homeEconomics/checkpointRestore.ts`, `.test.ts` | Create（Task 13。人生段階の途中再開、欠席者補完、Phase A `LessonCheckpoint`の家庭科版拡張） |
| `functions/src/homeEconomics/goalPackage.ts`, `.test.ts` | Create（Task 14。目的に関係しない概念の非表示、教材設定による表示絞り込み） |
| `src/lib/lessonRuns/liveTypes.ts` | Modify（Task 15。`LessonRunPublicState`/`LessonRunPrivateState`/`LessonRunTeamState`へ家庭科フィールド追加） |
| `database.rules.json` | Modify（Task 15。既存の3ノードへ家庭科フィールドを追加するのみ、新規ノード不要——Phase Cが確立した3分離パターンを流用） |
| `src/components/homeEconomics/` 配下（教師・生徒画面） | Create（Task 15。Phase B `LessonInputRenderer`/`LessonControlRoom`パターンの家庭科版） |
| `functions/src/homeEconomics/evaluation.ts`, `.test.ts` | Create（Task 16。§13.17の観点別評価、Phase C Task16の5観点評価と同じ自動/ルーブリック分離） |
| `test/household-lifecycle.acceptance.test.ts` | Create（Task 17。§27.4受け入れテスト6項目） |

---

## タスク一覧

1. 資産・保険・イベント・プロフィールの型（公開/非公開分離）
2. `LessonContent`拡張と家庭科教材バリデーション
3. 年次収支エンジン（収入・支出集計、簡略税・社会保険式）
4. 資産の年次収益率計算（経済要因反映、決定的PRNGノイズ）
5. 住宅ローン計算（元利均等返済）
6. 保険モデル（保険料・給付条件）
7. ライフイベントエンジン（発生判定・公開方法・効果適用）
8. 資金不足時の選択肢提示
9. 公的支援モデル
10. `HouseholdState`リポジトリと判断提出Callable（`DECISION`フェーズ）
11. ラウンド確定処理の中核（年次計算エンジンの統合オーケストレーター）
12. 退職後モデル
13. 保存・再開（人生段階途中再開、欠席者補完、チェックポイント）
14. 目標パッケージ（表示の絞り込み）
15. RTDBライブスキーマ拡張と教師・生徒画面
16. 家庭科の評価（観点別、自動/ルーブリック分離）
17. §27.4受け入れテストとPhase D完了条件の確定

---

## 実装順とレビューゲート

1. Task 1〜2: Phase E（Guided Lesson Builder）も依存する型・教材バリデーション契約。ここを先にレビューし、後続で名前を変えない。
2. Task 3〜9: 年次計算エンジン群。各エンジンは独立した純粋関数で、Task11のオーケストレーターが後から統合する（Phase Cの価格計算・需給集計・資金拘束と同じ分解方針）。安全性レビュー（決定的PRNG・公開非公開分離）を必須にする。
3. Task 10〜11: `DECISION`フェーズの判断提出とラウンド確定。end-to-endの生活設計フローをここで初めて通す。
4. Task 12〜14: 退職後・保存再開・目標パッケージ。ラウンドをまたぐ長期状態管理。
5. Task 15: 画面。§23の横断要件（本名非表示・架空プロフィール明示等）を検証する。
6. Task 16〜17: 評価・受け入れテスト・完了条件確定。

---

### Task 1: 資産・保険・イベント・プロフィールの型（公開/非公開分離）

統合仕様書 §13.4（コアプロフィール）・§13.5（資産）・§13.6（保険）・§13.9（住宅・ローン）・§13.12（イベント）を実装する。**生徒に見せる情報と教材作成者用の非公開の内部係数（イベント発生確率、保険の内部リスク計算パラメータ）を型で分離する**——Phase C Task1が確立した`market-public-content`/`market-authoring-content`の2パッケージ分離パターンをそのまま踏襲する。

- `packages/household-public-content`（`@stock-league/household-public-content`）: 生徒向けDTO。クライアント`src/`（生徒UI）とFunctions`functions/`（間引き変換の出力先）の両方が依存する。
- `packages/household-authoring-content`（`@stock-league/household-authoring-content`）: 非公開authoring型。クライアント`src/`（教師の教材作成UI）とFunctions`functions/`（年次計算エンジンの入力）の両方が依存する。

`toPublicView.ts`（間引き変換関数そのもの）は`functions/`にだけ置く——「生徒に何を見せるかを決めるロジック」をサーバー側に固定する設計判断（Phase C Task1と同じ理由）。

**Files:**
- Create: `functions/packages/household-public-content/package.json`, `tsconfig.json`, `src/index.ts`, `src/index.test.ts`
- Create: `functions/packages/household-authoring-content/package.json`, `tsconfig.json`, `src/index.ts`, `src/index.test.ts`
- Modify: ルート`package.json`（`workspaces`に両パッケージを追加）, `functions/package.json`・`package.json`（依存に追加）
- Create: `functions/src/homeEconomics/toPublicView.ts`, `.test.ts`

**Interfaces:**
- Consumes: なし（Phase A/Bの型のみ利用）
- Produces: `HouseholdProfilePublicView`、`AssetPositionPublicView`、`InsuranceContractPublicView`、`HouseholdProfile`、`AssetPosition`、`InsuranceProduct`、`LifeEventDefinition`、`Liability`、`toHouseholdProfilePublicView(profile)`、`toAssetPositionsPublicView(assets)`、`toInsuranceContractsPublicView(contracts)`

- [ ] **Step 1: 公開DTOの失敗するテストを書く**

`functions/packages/household-public-content/src/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { AssetPositionPublicView, HouseholdProfilePublicView } from './index'

describe('HouseholdProfilePublicView', () => {
  it('carries only the 7 core profile fields (spec §13.4), never authoring-only internals', () => {
    const view: HouseholdProfilePublicView = {
      householdId: 'case-b', age: 32, householdIncomeYen: 6000000,
      annualLivingExpensesYen: 3000000, cashSavingsYen: 2000000,
      family: '配偶者・子2人', housing: '賃貸マンション',
      lifeGoal: '住宅購入と教育資金', lifeStage: 'CHILD_REARING',
      isFictional: true,
    }
    expect(Object.keys(view)).not.toContain('eventProbabilityOverrides')
    expect(Object.keys(view)).not.toContain('internalRiskFactors')
  })
})

describe('AssetPositionPublicView', () => {
  it('never carries the internal expected-return/volatility coefficients', () => {
    const view: AssetPositionPublicView = {
      assetType: 'DOMESTIC_STOCK', valueYen: 500000,
    }
    expect(Object.keys(view)).not.toContain('expectedReturnPercent')
    expect(Object.keys(view)).not.toContain('volatilityPercent')
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions/packages/household-public-content && npx vitest run src/index.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: `package.json`・`tsconfig.json`を作成する（`@stock-league/market-public-content`と同じ共有パッケージ構成）**

`functions/packages/household-public-content/package.json`（`functions/packages/market-public-content/package.json`を実際に読んで完全に同じ形式に揃えること——`name`/`main`/`types`/`scripts`の`build`/`test`/`verify`/`check:dist`が既存パッケージと一致していること）:

```json
{
  "name": "@stock-league/household-public-content",
  "version": "0.0.1",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "check:dist": "test -f dist/index.js || (echo 'dist/ missing — run npm run build' && exit 1)",
    "verify": "npm run test && npm run build && npm run check:dist"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`tsconfig.json`は`functions/packages/market-public-content/tsconfig.json`をそのままコピーし、`rootDir`/`outDir`のみ確認する。

- [ ] **Step 4: 公開DTOを実装する**

`functions/packages/household-public-content/src/index.ts`:

```ts
export type LifeStage = 'STUDENT' | 'INDEPENDENT' | 'FAMILY_FORMATION' | 'CHILD_REARING' | 'PRE_RETIREMENT' | 'RETIRED'

/**
 * Student-facing profile view (spec §13.4's 7 core fields). `isFictional`
 * must always be `true` and is rendered in the UI as "これは授業用の架空
 * プロフィールです" (spec §13.4) — never a real student's own data.
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
  lifeStage: LifeStage
  isFictional: true
}

export type AssetType = 'CASH' | 'SAVINGS_DEPOSIT' | 'BOND' | 'DOMESTIC_STOCK' | 'FOREIGN_STOCK' | 'INVESTMENT_TRUST'

/** Never carries expected-return/volatility coefficients — those are authoring-only (spec §13.15 "教師には計算式より影響の強さを見せる"). */
export interface AssetPositionPublicView {
  assetType: AssetType
  valueYen: number
}

/**
 * Spec §13.6: insurance is deliberately NOT part of the asset-allocation
 * pie chart — kept as a fully separate type from AssetPositionPublicView,
 * never merged into the same array or UI component.
 */
export interface InsuranceContractPublicView {
  id: string
  productName: string
  premiumYenPerYear: number
  coveredRisk: string
  benefitDescription: string
  contractYearsRemaining: number
}

export interface LiabilityPublicView {
  id: string
  kind: 'MORTGAGE' | 'OTHER_LOAN'
  remainingPrincipalYen: number
  annualInterestRatePercent: number
  remainingYears: number
}
```

- [ ] **Step 5: テストを通す**

Run: `cd functions/packages/household-public-content && npx vitest run src/index.test.ts`
Expected: PASS

- [ ] **Step 6: 非公開authoring型の失敗するテストを書く**

`functions/packages/household-authoring-content/src/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { HouseholdProfile, LifeEventDefinition } from './index'

describe('HouseholdProfile (authoring)', () => {
  it('carries the internal fields the public view must never receive', () => {
    const profile: HouseholdProfile = {
      householdId: 'case-b', age: 32, householdIncomeYen: 6000000,
      annualLivingExpensesYen: 3000000, cashSavingsYen: 2000000,
      family: '配偶者・子2人', housing: '賃貸マンション',
      lifeGoal: '住宅購入と教育資金', lifeStage: 'CHILD_REARING',
      eventProbabilityOverrides: { JOB_LOSS: 0.05 },
      internalRiskFactors: { healthRisk: 0.1 },
    }
    expect(profile.eventProbabilityOverrides.JOB_LOSS).toBe(0.05)
  })
})

describe('LifeEventDefinition', () => {
  it('has a disclosure mode distinct from its actual trigger probability (spec §13.12)', () => {
    const event: LifeEventDefinition = {
      id: 'job-loss', label: '失業', disclosureMode: 'HIDDEN',
      triggerProbability: 0.05, effectDescription: '収入が一時的に0になる',
    }
    expect(event.disclosureMode).toBe('HIDDEN')
    expect(event.triggerProbability).toBe(0.05)
  })
})
```

- [ ] **Step 7: 失敗を確認する**

Run: `cd functions/packages/household-authoring-content && npx vitest run src/index.test.ts`
Expected: FAIL — module not found

- [ ] **Step 8: `package.json`・`tsconfig.json`を作成する**

Step3と同じ構成で`functions/packages/household-authoring-content/package.json`を作成する（`name`のみ`@stock-league/household-authoring-content`に変更）。`@stock-league/household-public-content`への依存を追加する（`AssetType`/`LifeStage`等の共有enum型を再利用するため。依存は一方向——`household-authoring-content`が`household-public-content`を参照してよいが逆は禁止。Phase C Task1の`market-authoring-content`→`market-public-content`依存と同じ方向）。

- [ ] **Step 9: 非公開authoring型を実装する**

`functions/packages/household-authoring-content/src/index.ts`:

```ts
import type { AssetType, LifeStage } from '@stock-league/household-public-content'

/**
 * Teacher-authoring / server-internal type. Imported by BOTH `src/`
 * (teacher's own material-authoring UI legitimately edits
 * eventProbabilityOverrides/internalRiskFactors — the teacher is the
 * author of these values) and `functions/` (the engine's input). What
 * must never happen is a STUDENT receiving this data — that is enforced
 * by Firestore rules (teacher read-only) and by
 * `functions/src/homeEconomics/toPublicView.ts` being the only producer
 * of what lands in the student-readable RTDB path, not by import
 * restrictions. See `functions/src/market/toPublicView.ts` (Phase C
 * Task1) for the identical architecture note.
 */
export interface HouseholdProfile {
  householdId: string
  age: number
  householdIncomeYen: number
  annualLivingExpensesYen: number
  cashSavingsYen: number
  family: string
  housing: string
  lifeGoal: string
  lifeStage: LifeStage
  /** Hidden. Never sent to students. Keyed by life-event id. */
  eventProbabilityOverrides: Record<string, number>
  /** Hidden. Never sent to students. */
  internalRiskFactors: Record<string, number>
}

export interface AssetPosition {
  assetType: AssetType
  valueYen: number
  /** Hidden. Drives assetReturn.ts (Task 4). Never sent to students — spec §13.15 "教師には計算式より影響の強さを見せる". */
  expectedReturnPercent: number
  /** Hidden. Drives the noise term in assetReturn.ts. Never sent to students. */
  volatilityPercent: number
}

export interface InsuranceProduct {
  id: string
  productName: string
  premiumYenPerYear: number
  coveredRisk: string
  benefitDescription: string
  benefitAmountYen: number
  contractYears: number
  /** Hidden. Internal claim-probability model. Never sent to students. */
  internalClaimProbability: number
}

export type LifeEventDisclosureMode = 'ANNOUNCED' | 'PARTIALLY_ANNOUNCED' | 'HIDDEN'

/**
 * Spec §13.12: `disclosureMode` controls what students see BEFORE the
 * event fires (full announcement / partial hint / nothing). It is
 * deliberately independent of whether the event is deterministic or
 * probabilistic — `triggerProbability` (hidden, spec §13.15's "influence
 * strength shown to teachers instead of raw coefficients") drives when it
 * fires, `disclosureMode` drives what students are told about it in
 * advance. These are never conflated into one field.
 */
export interface LifeEventDefinition {
  id: string
  label: string
  disclosureMode: LifeEventDisclosureMode
  /** Hidden. Never sent to students in this raw form. */
  triggerProbability: number
  effectDescription: string
}

export interface Liability {
  id: string
  kind: 'MORTGAGE' | 'OTHER_LOAN'
  principalYen: number
  remainingPrincipalYen: number
  annualInterestRatePercent: number
  remainingYears: number
}
```

- [ ] **Step 10: テストを通す**

Run: `cd functions/packages/household-authoring-content && npx vitest run src/index.test.ts`
Expected: PASS

- [ ] **Step 11: `toPublicView`の失敗するテストを書く（禁止情報のregressionテスト）**

`functions/src/homeEconomics/toPublicView.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { AssetPosition, HouseholdProfile, InsuranceProduct } from '@stock-league/household-authoring-content'
import { toAssetPositionsPublicView, toHouseholdProfilePublicView, toInsuranceContractsPublicView } from './toPublicView'

const profile: HouseholdProfile = {
  householdId: 'case-b', age: 32, householdIncomeYen: 6000000,
  annualLivingExpensesYen: 3000000, cashSavingsYen: 2000000,
  family: '配偶者・子2人', housing: '賃貸マンション',
  lifeGoal: '住宅購入と教育資金', lifeStage: 'CHILD_REARING',
  eventProbabilityOverrides: { JOB_LOSS: 0.42 },
  internalRiskFactors: { healthRisk: 0.99 },
}

describe('toHouseholdProfilePublicView', () => {
  it('never leaks eventProbabilityOverrides or internalRiskFactors', () => {
    const view = toHouseholdProfilePublicView(profile)
    expect(JSON.stringify(view)).not.toContain('0.42')
    expect(JSON.stringify(view)).not.toContain('0.99')
    expect(view.isFictional).toBe(true)
  })
})

describe('toAssetPositionsPublicView', () => {
  it('never leaks expectedReturnPercent or volatilityPercent', () => {
    const assets: AssetPosition[] = [{ assetType: 'DOMESTIC_STOCK', valueYen: 500000, expectedReturnPercent: 5, volatilityPercent: 15 }]
    const views = toAssetPositionsPublicView(assets)
    expect(JSON.stringify(views)).not.toContain('expectedReturnPercent')
    expect(JSON.stringify(views)).not.toContain('volatilityPercent')
  })
})

describe('toInsuranceContractsPublicView', () => {
  it('never leaks internalClaimProbability, and keeps insurance out of the asset shape', () => {
    const contracts: InsuranceProduct[] = [{
      id: 'ins-1', productName: '医療保険A', premiumYenPerYear: 60000,
      coveredRisk: '病気・入院', benefitDescription: '入院日額1万円',
      benefitAmountYen: 10000, contractYears: 10, internalClaimProbability: 0.03,
    }]
    const views = toInsuranceContractsPublicView(contracts)
    expect(JSON.stringify(views)).not.toContain('internalClaimProbability')
    expect(Object.keys(views[0])).not.toContain('assetType')
  })
})
```

- [ ] **Step 12: 失敗を確認する**

Run: `cd functions && npx vitest run src/homeEconomics/toPublicView.test.ts`
Expected: FAIL — module not found

- [ ] **Step 13: `toPublicView.ts`を実装する（allow-list方式、spread禁止）**

`functions/src/homeEconomics/toPublicView.ts`:

```ts
import type { AssetPositionPublicView, HouseholdProfilePublicView, InsuranceContractPublicView } from '@stock-league/household-public-content'
import type { AssetPosition, HouseholdProfile, InsuranceProduct } from '@stock-league/household-authoring-content'

/**
 * The sole place that decides what students may see about their household
 * profile, assets, and insurance. Fixed here (server-side, Functions)
 * rather than as an import-boundary rule — see
 * `functions/src/market/toPublicView.ts` (Phase C Task1) for the
 * identical architecture note. Every field is listed explicitly
 * (allow-list) — never `{...source}` — so a future field added to the
 * authoring type is excluded by default.
 */
export const toHouseholdProfilePublicView = (profile: HouseholdProfile): HouseholdProfilePublicView => ({
  householdId: profile.householdId, age: profile.age,
  householdIncomeYen: profile.householdIncomeYen,
  annualLivingExpensesYen: profile.annualLivingExpensesYen,
  cashSavingsYen: profile.cashSavingsYen,
  family: profile.family, housing: profile.housing,
  lifeGoal: profile.lifeGoal, lifeStage: profile.lifeStage,
  isFictional: true,
})

export const toAssetPositionsPublicView = (assets: AssetPosition[]): AssetPositionPublicView[] =>
  assets.map((asset) => ({ assetType: asset.assetType, valueYen: asset.valueYen }))

export const toInsuranceContractsPublicView = (contracts: InsuranceProduct[]): InsuranceContractPublicView[] =>
  contracts.map((contract) => ({
    id: contract.id, productName: contract.productName,
    premiumYenPerYear: contract.premiumYenPerYear, coveredRisk: contract.coveredRisk,
    benefitDescription: contract.benefitDescription, contractYearsRemaining: contract.contractYears,
  }))
```

- [ ] **Step 14: テストを通す**

Run: `cd functions && npx vitest run src/homeEconomics/toPublicView.test.ts`
Expected: PASS

- [ ] **Step 15: `npm run verify`**

- [ ] **Step 16: Commit**

```bash
git add functions/packages/household-public-content functions/packages/household-authoring-content \
  functions/src/homeEconomics/toPublicView.ts functions/src/homeEconomics/toPublicView.test.ts \
  package.json functions/package.json
git commit -m "feat: split household profile/asset/insurance/event types into public and authoring packages"
```

---

### Task 2: `LessonContent`拡張と家庭科教材バリデーション

統合仕様書 §13.1〜§13.4、§13.7〜§13.10、§13.12、§13.17を集約する教材内容を`LessonContent`（Phase A/B、`src/lib/lessonTemplates/types.ts`）へ追加する。現在の`LessonContent`は`{ schemaVersion, title, description, subject, socialStudiesMarket? }`（Phase C Task2が拡張済み）——本タスクはこれに`homeEconomics?: HomeEconomicsContent`を並列で追加する。数値既定値をコードへ散在させない（§30-10）ため、既定値はこの型のフィールドのデフォルトとして1箇所に集約する。

**Files:**
- Modify: `src/lib/lessonTemplates/types.ts`（`LessonContent`に`homeEconomics?: HomeEconomicsContent`を追加）
- Create: `functions/src/homeEconomics/templateValidation.ts`, `.test.ts`
- Modify: `functions/src/lessonRuns/createLessonRun.ts`（`LessonRun`作成時に家庭科教材のバリデーションを実行）

**Interfaces:**
- Consumes: `HouseholdProfile`・`AssetPosition`・`InsuranceProduct`・`LifeEventDefinition`・`Liability`（Task 1、`@stock-league/household-authoring-content`）、`LessonContent`（Phase A/B/C）、`createLessonRun`（Phase A Task 7、Phase C Task2で一度拡張済み）
- Produces: `HomeEconomicsContent`型、`validateHomeEconomicsContent(content): { valid: true } | { valid: false; errors: string[] }`

**重要（Phase C Task2の既知の設計上の注意点を踏襲）:** `HomeEconomicsContent`型自体は`src/lib/lessonTemplates/types.ts`に直接定義せず、Task1で作成した共有パッケージ`@stock-league/household-authoring-content`側に定義し、`src/lib/lessonTemplates/types.ts`はそこからre-exportする。理由はPhase C Task2で実際に発生した不具合と同じ——`functions/src/homeEconomics/templateValidation.ts`が`src/lib/lessonTemplates/types.ts`を直接importするとtscの`rootDir`境界を壊しCloud Functionsデプロイバンドルへ`src/`が混入する。

- [ ] **Step 1: `HomeEconomicsContent`型を定義する失敗するテストを書く**

`functions/packages/household-authoring-content/src/index.test.ts`に追記する:

```ts
describe('HomeEconomicsContent defaults', () => {
  it('encodes every §28-equivalent default value as a field default, not scattered in code', () => {
    const content: HomeEconomicsContent = {
      households: [{
        householdId: 'case-b', age: 32, householdIncomeYen: 6000000,
        annualLivingExpensesYen: 3000000, cashSavingsYen: 2000000,
        family: '配偶者・子2人', housing: '賃貸マンション',
        lifeGoal: '住宅購入と教育資金', lifeStage: 'CHILD_REARING',
        eventProbabilityOverrides: {}, internalRiskFactors: {},
      }],
      assets: [], insuranceProducts: [], lifeEvents: [], liabilities: [],
      roundYears: 5, courseFormat: 'COMMON_CONDITIONS',
      taxAndSocialInsuranceModelVersion: 1,
      economicFactors: { inflationPercent: 1, interestRatePercent: 1, marketReturnPercent: 3 },
      goalPackage: 'EMERGENCY_FUND',
      evaluationWeights: {
        lifeGoalAchievement: 0.2, emergencyFundAdequacy: 0.15, stability: 0.2,
        diversification: 0.15, borrowingBurden: 0.15, reflection: 0.15,
      },
    }
    expect(content.roundYears).toBe(5)
    expect(content.taxAndSocialInsuranceModelVersion).toBe(1)
  })

  it('LessonContent.homeEconomics is optional so SOCIAL_STUDIES content is unaffected', () => {
    const content: LessonContent = { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES' }
    expect(content.homeEconomics).toBeUndefined()
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions/packages/household-authoring-content && npx vitest run src/index.test.ts`
Expected: FAIL — `HomeEconomicsContent`が存在しない

- [ ] **Step 3: `HomeEconomicsContent`を`household-authoring-content`パッケージへ追加する**

`functions/packages/household-authoring-content/src/index.ts`へ追記:

```ts
/** Spec §13.1: standard is 5 years/round, 1 year/round is optional (§13.1). */
export type RoundYears = 1 | 5

/** Spec §13.3: lesson format — which mode students experience. */
export type CourseFormat = 'COMMON_CONDITIONS' | 'ROLE_VARIANT' | 'STAGE_SPLIT' | 'MULTI_PERSON_PER_TEAM'

export interface EconomicFactors {
  /** Spec §13.11. Reflected into living expenses (annualCashFlow.ts, Task 3). */
  inflationPercent: number
  /** Spec §13.11. Reflected into deposits/borrowing. */
  interestRatePercent: number
  /** Spec §13.11. Baseline for assetReturn.ts (Task 4). */
  marketReturnPercent: number
}

/** Spec §13.16: which concepts are shown/hidden per teacher-selected goal focus. */
export type GoalPackage = 'EMERGENCY_FUND' | 'HOME_PURCHASE' | 'EDUCATION_FUND' | 'RETIREMENT_PREP' | 'RISK_DIVERSIFICATION' | 'INSURANCE_AND_PREPAREDNESS' | 'OVERALL_BALANCE'

export interface HomeEconomicsEvaluationWeights {
  lifeGoalAchievement: number
  emergencyFundAdequacy: number
  stability: number
  diversification: number
  borrowingBurden: number
  reflection: number
}

/**
 * All spec §28-equivalent default values for home economics live here as
 * field defaults, not scattered across engine code (spec §30-10) — same
 * pattern as `SocialStudiesMarketContent` (Phase C Task2).
 */
export interface HomeEconomicsContent {
  households: HouseholdProfile[]
  assets: AssetPosition[]
  insuranceProducts: InsuranceProduct[]
  lifeEvents: LifeEventDefinition[]
  liabilities: Liability[]
  /** §13.1. Default 5. */
  roundYears: RoundYears
  /** §13.3. */
  courseFormat: CourseFormat
  /** §13.8: "数値・式の版を教材版へ固定する" — this integer is the version tag templateValidation/annualCashFlow pin their tax/social-insurance formula to. Default 1. */
  taxAndSocialInsuranceModelVersion: number
  economicFactors: EconomicFactors
  /** §13.16. */
  goalPackage: GoalPackage
  /** §13.33-equivalent (§13.17). Must sum to 1; validated by `validateHomeEconomicsContent`. */
  evaluationWeights: HomeEconomicsEvaluationWeights
}
```

- [ ] **Step 4: `src/lib/lessonTemplates/types.ts`を拡張する**

```ts
import type { HomeEconomicsContent } from '@stock-league/household-authoring-content'

export type { HomeEconomicsContent } from '@stock-league/household-authoring-content'

export interface LessonContent {
  schemaVersion: 1
  title: string
  description: string
  subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS'
  socialStudiesMarket?: SocialStudiesMarketContent
  /** Only present when subject === 'HOME_ECONOMICS'. Optional so existing SOCIAL_STUDIES drafts keep compiling. */
  homeEconomics?: HomeEconomicsContent
}
```

- [ ] **Step 5: テストを通す**

Run: `cd functions/packages/household-authoring-content && npx vitest run src/index.test.ts && cd ../../.. && npx vitest run src/lib/lessonTemplates/types.test.ts`
Expected: PASS

- [ ] **Step 6: `validateHomeEconomicsContent`の失敗するテストを書く**

`functions/src/homeEconomics/templateValidation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { HomeEconomicsContent } from '@stock-league/household-authoring-content'
import { validateHomeEconomicsContent } from './templateValidation'

const baseContent = (overrides: Partial<HomeEconomicsContent> = {}): HomeEconomicsContent => ({
  households: [{
    householdId: 'case-b', age: 32, householdIncomeYen: 6000000,
    annualLivingExpensesYen: 3000000, cashSavingsYen: 2000000,
    family: '配偶者・子2人', housing: '賃貸マンション',
    lifeGoal: '住宅購入と教育資金', lifeStage: 'CHILD_REARING',
    eventProbabilityOverrides: {}, internalRiskFactors: {},
  }],
  assets: [], insuranceProducts: [], lifeEvents: [], liabilities: [],
  roundYears: 5, courseFormat: 'COMMON_CONDITIONS',
  taxAndSocialInsuranceModelVersion: 1,
  economicFactors: { inflationPercent: 1, interestRatePercent: 1, marketReturnPercent: 3 },
  goalPackage: 'EMERGENCY_FUND',
  evaluationWeights: {
    lifeGoalAchievement: 0.2, emergencyFundAdequacy: 0.15, stability: 0.2,
    diversification: 0.15, borrowingBurden: 0.15, reflection: 0.15,
  },
  ...overrides,
})

describe('validateHomeEconomicsContent', () => {
  it('accepts a well-formed minimal content', () => {
    expect(validateHomeEconomicsContent(baseContent())).toEqual({ valid: true })
  })

  it('rejects zero households (spec §13.2: at least one profile must exist)', () => {
    const result = validateHomeEconomicsContent(baseContent({ households: [] }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors).toContain('担当プロフィールが1件も設定されていません。')
  })

  it('rejects duplicate householdId values', () => {
    const dup = baseContent().households[0]
    const result = validateHomeEconomicsContent(baseContent({ households: [dup, { ...dup }] }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors).toContain(`プロフィールIDが重複しています: ${dup.householdId}`)
  })

  it('rejects evaluation weights that do not sum to 1 (spec §13.17)', () => {
    const result = validateHomeEconomicsContent(baseContent({
      evaluationWeights: {
        lifeGoalAchievement: 0.5, emergencyFundAdequacy: 0.5, stability: 0.5,
        diversification: 0, borrowingBurden: 0, reflection: 0,
      },
    }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors).toContain('評価の重みの合計が1になっていません。')
  })

  it('rejects a life event referencing an unknown disclosure mode target (referential integrity, mirrors Task 2 in Phase C)', () => {
    const result = validateHomeEconomicsContent(baseContent({
      lifeEvents: [{ id: 'job-loss', label: '失業', disclosureMode: 'HIDDEN', triggerProbability: 1.5, effectDescription: 'x' }],
    }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors).toContain('イベント job-loss の発生確率は0〜1の範囲にしてください。')
  })
})
```

- [ ] **Step 7: 失敗を確認する**

Run: `cd functions && npx vitest run src/homeEconomics/templateValidation.test.ts`
Expected: FAIL — module not found

- [ ] **Step 8: `validateHomeEconomicsContent`を実装する**

`functions/src/homeEconomics/templateValidation.ts`:

```ts
import type { HomeEconomicsContent } from '@stock-league/household-authoring-content'

export type ValidationResult = { valid: true } | { valid: false; errors: string[] }

export const validateHomeEconomicsContent = (content: HomeEconomicsContent): ValidationResult => {
  const errors: string[] = []

  if (content.households.length === 0) errors.push('担当プロフィールが1件も設定されていません。')

  const idCounts = new Map<string, number>()
  for (const household of content.households) {
    idCounts.set(household.householdId, (idCounts.get(household.householdId) ?? 0) + 1)
  }
  for (const [id, count] of idCounts) {
    if (count > 1) errors.push(`プロフィールIDが重複しています: ${id}`)
  }

  const weights = content.evaluationWeights
  const weightSum = weights.lifeGoalAchievement + weights.emergencyFundAdequacy + weights.stability
    + weights.diversification + weights.borrowingBurden + weights.reflection
  if (Math.abs(weightSum - 1) > 0.001) errors.push('評価の重みの合計が1になっていません。')

  for (const event of content.lifeEvents) {
    if (event.triggerProbability < 0 || event.triggerProbability > 1) {
      errors.push(`イベント ${event.id} の発生確率は0〜1の範囲にしてください。`)
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors }
}
```

- [ ] **Step 9: テストを通す**

Run: `cd functions && npx vitest run src/homeEconomics/templateValidation.test.ts`
Expected: PASS

- [ ] **Step 10: `createLessonRun`へバリデーションを結線する失敗するテストを書く**

`functions/src/lessonRuns/createLessonRun.test.ts`に追記する（Phase C Task2の対応するテストと同じ形）:

```ts
it('rejects creating a HOME_ECONOMICS run whose templateSnapshot has zero households', async () => {
  // ...既存のfakeFirestoreセットアップを再利用し、
  // template.currentPublishedVersionId が指す version.content を
  // { subject: 'HOME_ECONOMICS', homeEconomics: { households: [], ... } } にした上で
  await expect(createLessonRun(deps)).rejects.toThrow('担当プロフィールが1件も設定されていません。')
})
```

- [ ] **Step 11: `createLessonRun`を修正する**

`functions/src/lessonRuns/createLessonRun.ts`のバリデーション分岐を拡張する（既存のSOCIAL_STUDIES分岐と並列に追加、read-after-write順序を変えないようトランザクションのREAD PHASE内に留める）:

```ts
import { validateHomeEconomicsContent } from '../homeEconomics/templateValidation'

// ...(既存のトランザクション内、SOCIAL_STUDIES検証のすぐ後に追加)
const contentWithHomeEconomics = version.content as { subject: string; homeEconomics?: unknown }
if (contentWithHomeEconomics.subject === 'HOME_ECONOMICS' && contentWithHomeEconomics.homeEconomics) {
  const result = validateHomeEconomicsContent(
    contentWithHomeEconomics.homeEconomics as Parameters<typeof validateHomeEconomicsContent>[0],
  )
  if (!result.valid) throw new Error(result.errors[0])
}
```

**既知の限界（Phase C Task2で発見された同型の注意点をそのまま継承）:** このガードは`content.subject === 'HOME_ECONOMICS' && content.homeEconomics`という条件のため、`homeEconomics`が未設定のままpublishされたHOME_ECONOMICS教材はバリデーションを素通りし、市場設定を一切持たないLessonRunが作成されてしまう。教材publish時点（Phase A Task6 `publishLessonVersion`）で`subject`に応じた必須フィールドを強制する仕組みは依然として存在しない——本計画のTask17（受け入れテスト）で改めてこの既知の限界を確認し、埋めるかどうかを判断する。

- [ ] **Step 12: テストを通す**

Run: `cd functions && npx vitest run src/lessonRuns/createLessonRun.test.ts`
Expected: PASS

- [ ] **Step 13: `npm run verify`**

- [ ] **Step 14: Commit**

```bash
git add functions/packages/household-authoring-content/src/index.ts functions/packages/household-authoring-content/src/index.test.ts \
  src/lib/lessonTemplates/types.ts functions/src/homeEconomics/templateValidation.ts functions/src/homeEconomics/templateValidation.test.ts \
  functions/src/lessonRuns/createLessonRun.ts functions/src/lessonRuns/createLessonRun.test.ts
git commit -m "feat: add HomeEconomicsContent and validate it at LessonRun creation"
```

---

### Task 3: 年次収支エンジン（収入・支出集計、簡略税・社会保険式）

統合仕様書 §13.7（収入・支出）・§13.8（税・社会保険）を実装する。純粋関数とし、Task11のラウンド確定処理から呼ばれる。**固定費と変動費を区別可能にする**（§13.7）ことと、**税・社会保険は教材版へ固定した簡略式を使う**（§13.8「数値・式の版を教材版へ固定する」）ことがこのタスクの中核。

**Files:**
- Create: `functions/src/homeEconomics/engine/annualCashFlow.ts`, `.test.ts`
- Create: `functions/src/homeEconomics/engine/taxAndSocialInsurance.ts`, `.test.ts`

**Interfaces:**
- Consumes: `HouseholdProfile`（Task1）、`EconomicFactors`（Task2、`HomeEconomicsContent.economicFactors`）
- Produces: `computeAnnualCashFlow(input): AnnualCashFlowResult`、`computeTaxAndSocialInsurance(input, modelVersion): TaxResult`

- [ ] **Step 1: 税・社会保険簡略式（バージョン固定）の失敗するテストを書く**

`functions/src/homeEconomics/engine/taxAndSocialInsurance.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { computeTaxAndSocialInsurance } from './taxAndSocialInsurance'

describe('computeTaxAndSocialInsurance', () => {
  it('applies model version 1\'s simplified flat-rate formula (spec §13.8 — pinned to template version, not live tax law)', () => {
    const result = computeTaxAndSocialInsurance({ grossIncomeYen: 6000000 }, 1)
    // Model v1: 20% combined tax+social-insurance rate — PROVISIONAL, see
    // TAX_MODEL_V1_RATE_PERCENT below. Exact value is not from live tax law.
    expect(result.netIncomeYen).toBe(4800000)
    expect(result.taxAndInsuranceYen).toBe(1200000)
  })

  it('throws for an unknown model version rather than silently falling back (spec §13.8: pinned, never live-recomputed)', () => {
    expect(() => computeTaxAndSocialInsurance({ grossIncomeYen: 6000000 }, 99)).toThrow('Unknown tax and social insurance model version: 99')
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/homeEconomics/engine/taxAndSocialInsurance.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: `computeTaxAndSocialInsurance`を実装する**

`functions/src/homeEconomics/engine/taxAndSocialInsurance.ts`:

```ts
/**
 * PROVISIONAL — spec §13.8 requires an educational simplified formula
 * "実際の税率へ依存し過ぎない", not real tax law, and requires the exact
 * rate to be pinned per template version rather than recomputed live.
 * This flat 20% combined rate for model version 1 is a starting value to
 * be adjusted during pilot runs — see Task 17's PROVISIONAL constants
 * roundup.
 */
const TAX_MODEL_V1_RATE_PERCENT = 20

export interface TaxAndSocialInsuranceInput {
  grossIncomeYen: number
}
export interface TaxResult {
  netIncomeYen: number
  taxAndInsuranceYen: number
}

/**
 * Spec §13.8: "数値・式の版を教材版へ固定する" — the model version comes
 * from `HomeEconomicsContent.taxAndSocialInsuranceModelVersion` (Task 2),
 * captured in the LessonRun's immutable `templateSnapshot` at creation
 * time (Phase A's template/version pattern). A lesson already running
 * must never have its tax formula change underneath it because a teacher
 * edited the draft — callers always pass the SNAPSHOT's model version,
 * never a live lookup.
 */
export const computeTaxAndSocialInsurance = (input: TaxAndSocialInsuranceInput, modelVersion: number): TaxResult => {
  if (modelVersion !== 1) throw new Error(`Unknown tax and social insurance model version: ${modelVersion}`)
  const taxAndInsuranceYen = Math.round(input.grossIncomeYen * (TAX_MODEL_V1_RATE_PERCENT / 100))
  return { netIncomeYen: input.grossIncomeYen - taxAndInsuranceYen, taxAndInsuranceYen }
}
```

- [ ] **Step 4: テストを通す**

Run: `cd functions && npx vitest run src/homeEconomics/engine/taxAndSocialInsurance.test.ts`
Expected: PASS

- [ ] **Step 5: 年次収支集計の失敗するテストを書く（固定費/変動費区別、物価反映）**

`functions/src/homeEconomics/engine/annualCashFlow.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { computeAnnualCashFlow } from './annualCashFlow'

describe('computeAnnualCashFlow', () => {
  it('nets income (after tax) against fixed + variable expenses, separately reported (spec §13.7)', () => {
    const result = computeAnnualCashFlow({
      netIncomeYen: 4800000,
      fixedExpensesYen: 2000000,
      variableExpensesYen: 800000,
      inflationPercent: 0,
    })
    expect(result.totalExpensesYen).toBe(2800000)
    expect(result.netCashFlowYen).toBe(2000000)
    expect(result.fixedExpensesYen).toBe(2000000)
    expect(result.variableExpensesYen).toBe(800000)
  })

  it('applies inflation to variable expenses but the caller decides fixed-expense treatment (spec §13.11: 物価は生活費へ反映)', () => {
    const result = computeAnnualCashFlow({
      netIncomeYen: 4800000, fixedExpensesYen: 2000000, variableExpensesYen: 800000, inflationPercent: 10,
    })
    // Inflation compounds onto variable (living) expenses only — fixed
    // costs (e.g. a fixed-rate mortgage payment) are NOT inflation-adjusted
    // here; that distinction is what "固定費と変動費を区別可能" (§13.7) is for.
    expect(result.variableExpensesYen).toBe(880000)
    expect(result.fixedExpensesYen).toBe(2000000)
  })
})
```

- [ ] **Step 6: 失敗を確認する**

Run: `cd functions && npx vitest run src/homeEconomics/engine/annualCashFlow.test.ts`
Expected: FAIL — module not found

- [ ] **Step 7: `computeAnnualCashFlow`を実装する**

`functions/src/homeEconomics/engine/annualCashFlow.ts`:

```ts
export interface AnnualCashFlowInput {
  netIncomeYen: number
  fixedExpensesYen: number
  variableExpensesYen: number
  /** Spec §13.11: applied to variable (living-cost) expenses only. */
  inflationPercent: number
}
export interface AnnualCashFlowResult {
  fixedExpensesYen: number
  variableExpensesYen: number
  totalExpensesYen: number
  netCashFlowYen: number
}

export const computeAnnualCashFlow = (input: AnnualCashFlowInput): AnnualCashFlowResult => {
  const variableExpensesYen = Math.round(input.variableExpensesYen * (1 + input.inflationPercent / 100))
  const totalExpensesYen = input.fixedExpensesYen + variableExpensesYen
  return {
    fixedExpensesYen: input.fixedExpensesYen,
    variableExpensesYen,
    totalExpensesYen,
    netCashFlowYen: input.netIncomeYen - totalExpensesYen,
  }
}
```

- [ ] **Step 8: テストを通す**

Run: `cd functions && npx vitest run src/homeEconomics/engine/annualCashFlow.test.ts`
Expected: PASS

- [ ] **Step 9: `npm run verify`**

- [ ] **Step 10: Commit**

```bash
git add functions/src/homeEconomics/engine/annualCashFlow.ts functions/src/homeEconomics/engine/annualCashFlow.test.ts \
  functions/src/homeEconomics/engine/taxAndSocialInsurance.ts functions/src/homeEconomics/engine/taxAndSocialInsurance.test.ts
git commit -m "feat: add annual cash-flow and tax/social-insurance simplified engines"
```

---

### Task 4: 資産の年次収益率計算（経済要因反映、決定的PRNGノイズ）

統合仕様書 §13.5（資産）・§13.11（経済要因）・§13.15（年次収益率）を実装する。純粋関数とし、`Task11`のラウンド確定処理から呼ばれる。**乱数は`functions/packages/deterministic-random`のみを使う。**

`AssetPosition.expectedReturnPercent`（Task1、教材作成者が設定する非公開の期待収益率）を`EconomicFactors.marketReturnPercent`（Task2、教材の市場想定）で補正し、決定的PRNGによるノイズ項を加える。Phase C Task3の`calculateNextPrice`と同じ構造（決定論的な基礎値＋ノイズ）だが、時間の単位が3秒バッチではなくラウンド（年）である点が異なる。

**Files:**
- Create: `functions/src/homeEconomics/engine/assetReturn.ts`, `.test.ts`

**Interfaces:**
- Consumes: `AssetPosition`（Task1）、`EconomicFactors`（Task2）、`deriveSeed`/`mulberry32`（Phase A、`@stock-league/deterministic-random`）
- Produces: `computeAssetReturn(input): AssetReturnResult`

- [ ] **Step 1: 決定的収益率計算の失敗するテストを書く**

`functions/src/homeEconomics/engine/assetReturn.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { computeAssetReturn } from './assetReturn'

const baseInput = {
  assetType: 'DOMESTIC_STOCK' as const, valueYen: 1000000,
  expectedReturnPercent: 5, volatilityPercent: 15,
  marketReturnPercent: 3, householdId: 'case-b', roundIndex: 2,
  randomSeed: 'seed-abc', restoreGeneration: 0,
}

describe('computeAssetReturn', () => {
  it('is deterministic — same inputs always produce the same nextValueYen', () => {
    expect(computeAssetReturn(baseInput)).toEqual(computeAssetReturn(baseInput))
  })

  it('a different roundIndex produces a different result — the noise term is not constant across rounds', () => {
    const round2 = computeAssetReturn(baseInput)
    const round3 = computeAssetReturn({ ...baseInput, roundIndex: 3 })
    expect(round2.nextValueYen).not.toBe(round3.nextValueYen)
  })

  it('CASH never carries a noise term — zero volatility is exact, not approximate (spec §13.5)', () => {
    const result = computeAssetReturn({ ...baseInput, assetType: 'CASH', expectedReturnPercent: 0, volatilityPercent: 0 })
    expect(result.nextValueYen).toBe(baseInput.valueYen)
    expect(result.returnPercent).toBe(0)
  })

  it('never returns a negative value even with a large negative noise draw', () => {
    const result = computeAssetReturn({ ...baseInput, expectedReturnPercent: -50, volatilityPercent: 200 })
    expect(result.nextValueYen).toBeGreaterThanOrEqual(0)
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/homeEconomics/engine/assetReturn.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: `computeAssetReturn`を実装する**

`functions/src/homeEconomics/engine/assetReturn.ts`:

```ts
import { deriveSeed, mulberry32 } from '@stock-league/deterministic-random'
import type { AssetType } from '@stock-league/household-public-content'

export interface AssetReturnInput {
  assetType: AssetType
  valueYen: number
  /** Hidden from students (Task 1) — the teacher-authored base expectation. */
  expectedReturnPercent: number
  /** Hidden from students (Task 1) — drives the noise term's magnitude. */
  volatilityPercent: number
  /** Spec §13.11 — HomeEconomicsContent.economicFactors.marketReturnPercent (Task 2), added to expectedReturnPercent as the economic-environment adjustment. */
  marketReturnPercent: number
  householdId: string
  roundIndex: number
  randomSeed: string
  restoreGeneration: number
}
export interface AssetReturnResult {
  returnPercent: number
  nextValueYen: number
}

/**
 * Spec §13.5/§13.15: each asset's next value = current value × (1 +
 * expectedReturn + marketReturn + noise). Noise is deterministic PRNG,
 * scaled by volatilityPercent — an asset with 0 volatility (e.g. CASH)
 * gets exactly 0 noise, never an approximately-zero draw. Never goes
 * negative — a household's asset value floors at 0 (assets don't go
 * short in this simulation).
 */
export const computeAssetReturn = (input: AssetReturnInput): AssetReturnResult => {
  let noisePercent = 0
  if (input.volatilityPercent !== 0) {
    const seed = deriveSeed([input.randomSeed, input.restoreGeneration, input.householdId, input.assetType, input.roundIndex])
    const rand = mulberry32(seed)()
    noisePercent = (rand * 2 - 1) * input.volatilityPercent
  }
  const returnPercent = input.expectedReturnPercent + input.marketReturnPercent + noisePercent
  const nextValueYen = Math.max(0, Math.round(input.valueYen * (1 + returnPercent / 100)))
  return { returnPercent, nextValueYen }
}
```

- [ ] **Step 4: テストを通す**

Run: `cd functions && npx vitest run src/homeEconomics/engine/assetReturn.test.ts`
Expected: PASS

- [ ] **Step 5: `npm run verify`**

- [ ] **Step 6: Commit**

```bash
git add functions/src/homeEconomics/engine/assetReturn.ts functions/src/homeEconomics/engine/assetReturn.test.ts
git commit -m "feat: add deterministic annual asset-return engine"
```

---

### Task 5: 住宅ローン計算（元利均等返済）

統合仕様書 §13.9を実装する。純粋関数。**元利均等返済（毎年の返済額が一定、内訳の元金/利息の比率だけが年ごとに変わる）を基本とする**（§13.9「元利均等返済を基本とする」）。1ラウンドが5年（既定）の場合、そのラウンド内で5年分の返済が同時に進行するため、`roundYears`年分をまとめて計算する。

**Files:**
- Create: `functions/src/homeEconomics/engine/mortgage.ts`, `.test.ts`

**Interfaces:**
- Consumes: `Liability`（Task1、`kind: 'MORTGAGE'`のもの）
- Produces: `computeAnnualMortgagePayment(input): number`、`applyMortgageRound(input): MortgageRoundResult`

- [ ] **Step 1: 単年の元利均等返済額計算の失敗するテストを書く**

`functions/src/homeEconomics/engine/mortgage.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyMortgageRound, computeAnnualMortgagePayment } from './mortgage'

describe('computeAnnualMortgagePayment', () => {
  it('computes the level annual payment for an equal-principal-and-interest mortgage (spec §13.9)', () => {
    // 30,000,000円、年利2%、返済期間20年 — 教育用の簡略年次複利モデル。
    // r=0.02, n=20 の資本回収係数(A/P)はおよそ0.0612なので、支払額は
    // 30,000,000 * 0.0612 ≒ 1,836,000円前後になるはず——手計算での複利誤差を
    // 考慮し、厳密な一致ではなく妥当な範囲で検証する。総返済額(20年分)が
    // 元本を上回る(利息が発生している)ことも合わせて確認する。
    const payment = computeAnnualMortgagePayment({ principalYen: 30000000, annualInterestRatePercent: 2, remainingYears: 20 })
    expect(payment).toBeGreaterThan(1800000)
    expect(payment).toBeLessThan(1900000)
    expect(payment * 20).toBeGreaterThan(30000000)
  })

  it('a zero-interest loan divides principal evenly across the remaining years', () => {
    const payment = computeAnnualMortgagePayment({ principalYen: 20000000, annualInterestRatePercent: 0, remainingYears: 20 })
    expect(payment).toBe(1000000)
  })
})

describe('applyMortgageRound', () => {
  it('advances 5 years of level payments, splitting each year\'s payment into principal/interest, and reduces remainingYears', () => {
    const result = applyMortgageRound({
      remainingPrincipalYen: 30000000, annualInterestRatePercent: 2, remainingYears: 20, roundYears: 5,
    })
    expect(result.newRemainingYears).toBe(15)
    expect(result.newRemainingPrincipalYen).toBeLessThan(30000000)
    expect(result.totalPaymentYen).toBeGreaterThan(1800000 * 5)
    expect(result.totalPaymentYen).toBeLessThan(1900000 * 5)
    expect(result.principalPaidYen + result.interestPaidYen).toBeCloseTo(result.totalPaymentYen, 0)
  })

  it('pays off the loan early and stops — a round longer than the remaining term never goes negative', () => {
    const result = applyMortgageRound({
      remainingPrincipalYen: 1000000, annualInterestRatePercent: 2, remainingYears: 2, roundYears: 5,
    })
    expect(result.newRemainingYears).toBe(0)
    expect(result.newRemainingPrincipalYen).toBe(0)
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/homeEconomics/engine/mortgage.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`functions/src/homeEconomics/engine/mortgage.ts`:

```ts
export interface AnnualMortgagePaymentInput {
  principalYen: number
  annualInterestRatePercent: number
  remainingYears: number
}

/** Spec §13.9: level annual payment, equal-principal-and-interest ("元利均等返済"). */
export const computeAnnualMortgagePayment = (input: AnnualMortgagePaymentInput): number => {
  const r = input.annualInterestRatePercent / 100
  if (r === 0) return Math.round(input.principalYen / input.remainingYears)
  const factor = (1 + r) ** input.remainingYears
  return Math.round((input.principalYen * r * factor) / (factor - 1))
}

export interface MortgageRoundInput {
  remainingPrincipalYen: number
  annualInterestRatePercent: number
  remainingYears: number
  roundYears: number
}
export interface MortgageRoundResult {
  totalPaymentYen: number
  principalPaidYen: number
  interestPaidYen: number
  newRemainingPrincipalYen: number
  newRemainingYears: number
}

/**
 * Advances `roundYears` years of level payments in one call — a round
 * (5 years by default, spec §13.1) covers multiple payment years at once.
 * Stops early (never goes negative) if the loan pays off before
 * `roundYears` elapses.
 */
export const applyMortgageRound = (input: MortgageRoundInput): MortgageRoundResult => {
  let remainingPrincipalYen = input.remainingPrincipalYen
  let remainingYears = input.remainingYears
  let totalPaymentYen = 0
  let interestPaidYen = 0

  const yearsToRun = Math.min(input.roundYears, input.remainingYears)
  for (let year = 0; year < yearsToRun; year += 1) {
    if (remainingPrincipalYen <= 0) break
    const payment = computeAnnualMortgagePayment({
      principalYen: remainingPrincipalYen, annualInterestRatePercent: input.annualInterestRatePercent, remainingYears,
    })
    const interestThisYear = Math.round(remainingPrincipalYen * (input.annualInterestRatePercent / 100))
    const principalThisYear = Math.min(remainingPrincipalYen, payment - interestThisYear)
    remainingPrincipalYen -= principalThisYear
    remainingYears -= 1
    totalPaymentYen += interestThisYear + principalThisYear
    interestPaidYen += interestThisYear
  }

  return {
    totalPaymentYen,
    principalPaidYen: totalPaymentYen - interestPaidYen,
    interestPaidYen,
    newRemainingPrincipalYen: Math.max(0, remainingPrincipalYen),
    newRemainingYears: Math.max(0, remainingYears),
  }
}
```

- [ ] **Step 4: テストを通す**

Run: `cd functions && npx vitest run src/homeEconomics/engine/mortgage.test.ts`
Expected: PASS

- [ ] **Step 5: `npm run verify`**

- [ ] **Step 6: Commit**

```bash
git add functions/src/homeEconomics/engine/mortgage.ts functions/src/homeEconomics/engine/mortgage.test.ts
git commit -m "feat: add equal-principal-and-interest mortgage amortization engine"
```

---
