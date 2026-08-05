# Phase C: 社会科完成（常時売買・3秒バッチ市場）Implementation Plan

> **未完成。Task 1〜8 のみ詳細まで記述済み。Task 9〜19 は §「タスク一覧」の1行タイトルのみで、ステップ・コード例・検証方法が書かれていない。** 続きを書く場合は、Task 1〜8 と同じ密度（Files / Interfaces / Step ごとのテストコード / Run / Expected）で Task 9 から埋めること。書き終わったタスクから随時ファイルへ保存し、一度に全部書こうとしないこと（前の試行がこれで2回失敗した）。



> **正本は統合仕様書。** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md`（§12、§27.2、§28、§30-4）と `docs/superpowers/specs/2026-08-05-integrated-spec-resolutions.md`（矛盾解消 A・B・C・D・F）が優先する。本計画と両文書が矛盾する場合は両文書を優先し、本計画側の誤りとして扱う。
>
> **前提: Phase A・Phase B は完了済み。** `orgId`所有、権限3層、`LessonRun`/`LessonEvent`/`LessonCheckpoint`、`restoreGeneration`、決定的PRNG（`functions/packages/deterministic-random`）、`lessonRunPublic`/`lessonRunPrivate`のRTDBパス分離、`functions/`パッケージ、教師画面・生徒画面・教室表示・参加・チーム・フェーズ進行が揃っている。Phase Bの実装計画は`docs/superpowers/plans/2026-08-05-phase-b-common-lesson-platform-plan.md`を正本の補助として参照する。本計画はチーム帰属の検証手段・生徒の`lessonRunPublic`読み取り許可がPhase Bで提供されている前提で設計するが、正確なルール文字列・RTDBパス名はPhase Bの実装成果物（コード）と突き合わせて確認すること。差異があれば本計画のTask 13・Task 7のルール定義を実際の形へ合わせる。
>
> **旧実装（`hostTrading.ts`、`pricingCore.ts`、`liveMarketTypes.ts`等）はPhase Aで削除済みの前提。** 参照する場合は`git log`のみとし、詳細を読み込む必要はない。
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 教師が作成した企業・情報・決算・指標を教材として、生徒が授業時間中いつでも注文でき、サーバーが3秒ごとに区間を締め切って同一価格で約定し、需給・情報・ノイズから次価格を計算し、資金・株を正しく拘束し、市場停止・再開・予想チェックポイント・評価・チャートまでを一貫して提供する、社会科・市場経済シミュレーションの中核機能を実装する。

**Architecture:** 3秒区間の駆動はCloud Tasksの自己連鎖（矛盾解消A）とし、教師のブラウザに依存しない。区間締切のたびにCloud Functionsが起動し、`lessonRuns/{id}/orders`サブコレクション（Firestore）に溜まった`PENDING`注文を検証・相殺・約定し、`LessonEvent`へ追記し、次価格をRTDBの`lessonRunPublic/{lessonRunId}`（生徒が読める）へ書き込み、企業の非公開係数と内部計算ログは`lessonRunPrivate/{lessonRunId}`（教師のみ）へ、チーム別の拘束中資金・保有株・自分の注文状態は新設する`lessonRunTeamState/{lessonRunId}/{teamId}`（そのチームのメンバーのみ）へ書き込む——3つとも祖先を共有しない別々のトップレベルRTDBノードとし、Phase Aが確立したルールカスケード対策（祖先の`.read`は子孫の`.read: false`で取り消せない）を踏襲する。価格計算・需給集計・資金拘束判定・バッチ約定はすべて純粋関数として`functions/src/market/engine/`に実装し、Cloud Tasksハンドラ・Callableはこれらの純粋関数を呼ぶ薄いI/O層にする。乱数はPhase Aの`functions/packages/deterministic-random`（`deriveSeed`/`mulberry32`）のみを使い、`Math.random()`は一切使わない。

企業・情報の型は「誰が読めるか」で2段に分ける。**この境界はJSのimportグラフではなく、Firestore/RTDBのセキュリティルール（どのドキュメント/ノードを誰が読めるか）で強制する**——教師の認証済みブラウザは教材作成のために非公開の影響設定（`impactSensitivities`・`InformationImpact`）を当然読み書きする必要があり、「`src/`からimportしない」という制約では教師UIが成立しない。実際に効くのは、(1) 生の非公開データを含む`LessonTemplate.draft`・`LessonRun.templateSnapshot`（Firestore）が組織メンバー（教師）にしか読めないこと、(2) 生徒が読める唯一の経路であるRTDB`lessonRunPublic`には、サーバー（Functions）が`toPublicView`で機械的に間引いた後のデータしか書き込まれないこと、の2点である。型としては`packages/market-authoring-content`（`SimulatedCompany`・`InformationItem`・`InformationImpact`・`EconomicIndicatorAuthoring`。教師authoring UIとFunctions engineの両方がimportする）と`packages/market-public-content`（`CompanyPublicView`・`InformationPublicView`・`EconomicIndicatorPublicView`。生徒向けUIとFunctionsの両方がimportする）に分ける。**間引き変換関数`toPublicView`自体はFunctions専用**とする——「生徒に何を見せてよいかを決める権限をクライアントコードに持たせない」ことが目的であり、実際に生徒へ届く値を作る唯一の場所をサーバーに固定するための設計判断であって、import境界そのものがセキュリティ境界ではない点に注意。

**Tech Stack:** TypeScript, Firebase Firestore（`lessonRuns/{id}/orders`サブコレクション、トランザクション）, Firebase Realtime Database（`lessonRunPublic`/`lessonRunPrivate`/`lessonRunTeamState`）, Cloud Functions for Firebase v2（`onCall`、Cloud Tasksタスクキュー`onTaskDispatched`系）, `functions/packages/deterministic-random`, Vitest, `@firebase/rules-unit-testing`。

## Global Constraints

- 各タスクは完了時に `npm run verify`（`lint` → `typecheck` → `test` → `test:rules` → `build` → `functions`/`packages/*` の `verify`）を通すこと。
- 乱数は`Math.random()`禁止。`functions/packages/deterministic-random`の`deriveSeed`/`mulberry32`のみを使う（矛盾解消D）。シード導出式は `derive(`${randomSeed}:${restoreGeneration}:${stockId}:${batchIndex}`)` に固定する。
- 生徒へ将来価格・非公開係数（`impactSensitivities`、`InformationImpact`、`sensitivity`等）・乱数シードを送らない。型を`packages/market-authoring-content`（教師/サーバー用）と`packages/market-public-content`（生徒/サーバー用）に分け、間引き変換（`toPublicView`）はFunctions内の1箇所（`functions/src/market/toPublicView.ts`）に固定する。実際の遮断はFirestore/RTDBルール（教師のみ読める`lessonRuns`、間引き後データのみが書かれる`lessonRunPublic`）が担う。
- 冪等性: 注文送信・取消・バッチ処理・市場停止/再開のすべてに`idempotencyKey`または`batchId`を要求し、Phase Aの`appendLessonEvent`のパターン（トランザクション内でidempotencyドキュメントを確認）を踏襲する。
- 需給影響には相殺後（正味）の金額を使い、出来高表示には相殺前（総額）を使う（矛盾解消C）。この2つの値は同じ関数から別フィールドとして返し、呼び出し側が取り違えられない型にする。
- 資金・株の拘束は2段階（注文時=参考価格でソフト、区間締切時=約定価格でハード）とし、不足時はその区間の該当注文（買い/売り別）を一部約定せず全不成立とする（矛盾解消B）。
- `effectiveMarketSize`は企業規模（`SMALL`/`MEDIUM`/`LARGE`）から導出し、教師に発行株数を入力させない（§12.21）。
- 価格ガードの既定は1円。標準の変動上限は設けない。急変時は警告のみで注文は止めない（§12.20、§12.24）。
- 生徒への内訳表示は「ニュース要因／需給要因／その他要因／最終変動」の4行のみとし、内部係数（`sensitivity`、`impactSensitivities`等）は一切含めない（§12.31）。
- Cloud TasksのFirebase側API（`onTaskDispatched`、`getFunctions().taskQueue()`等)の具体的な関数名・引数・バージョンは、**実装着手時（Task 10着手時）にcontext7で最新ドキュメントを確認すること。** 本計画のコード例は概念上のインターフェース（`enqueueNextBatch(input): Promise<void>`等）で示し、実際のFirebase Tasks APIの呼び出しに実装時点で置き換える。
- 倒産・配当・分割は実装するが既定は無効（オフ）。有効化しない限り、通常の授業フローに一切影響してはならない。
- 家庭科（Phase D）、AI（Phase E）、組織・課金（Phase F）は本計画に含めない。

---

## 前提として確認が必要な事項（Task着手前チェックリスト）

- [ ] Phase Bが`lessonRunPublic/{lessonRunId}`の読み取りルールに、org member（教師）だけでなく当該`lessonRun`の生徒参加者も含めているか（Phase Aの雛形は教師のみ）。含まれていなければ、Task 13の前提として先にPhase B側のルールを拡張する必要がある。
- [ ] チーム帰属を検証するRTDBミラー（例: `teamMembership/{lessonRunId}/{uid}` → `teamId`）がPhase Bで存在するか。存在しない場合、Task 13で新設する`lessonRunTeamState`のルールが書けないため、Task 13の最初のステップとして実際のパス・形を確認し、なければ最小限のミラーをTask 13内で追加する。
- [ ] `teamId`・`participantId`の実際の型定義ファイルパス（Phase Bがどこに置いたか）。本計画では`string`型として扱い、Phase Bの実際の型が確認でき次第、該当箇所のimportをそちらに差し替える。

---

## File Structure

| File | Change |
| --- | --- |
| `packages/market-public-content/package.json`, `tsconfig.json`, `src/index.ts`, `src/index.test.ts` | Create（Task 1。生徒公開DTO: `CompanyPublicView`、`InformationPublicView`、`EconomicIndicatorPublicView`。`@stock-league/deterministic-random`と同じworkspacesパターン） |
| `packages/market-authoring-content/package.json`, `tsconfig.json`, `src/index.ts`, `src/index.test.ts` | Create（Task 1。教師authoring UIとFunctions engineの両方がimportする非公開型: `SimulatedCompany`、`InformationItem`、`InformationImpact`、`EconomicIndicatorAuthoring`） |
| `functions/src/market/toPublicView.ts`, `.test.ts` | Create（Task 1。private→public変換関数。DTO境界を1箇所に固定） |
| `src/lib/lessonTemplates/types.ts` | Modify（Task 2。`LessonContent`に`socialStudiesMarket?: SocialStudiesMarketContent`を追加） |
| `functions/src/market/templateValidation.ts`, `.test.ts` | Create（Task 2。企業4〜6社、価格ガード必須等の教材バリデーション） |
| `functions/src/market/engine/priceCalculation.ts`, `.test.ts` | Create（Task 3。情報+需給+ノイズ加算、価格ガード、内訳） |
| `functions/src/market/engine/demandAggregation.ts`, `.test.ts` | Create（Task 4。相殺後の正味需給と相殺前の出来高） |
| `functions/src/market/orderTypes.ts` | Create（Task 5。`MarketOrder`型） |
| `functions/src/lessonRuns/orders/repository.ts`, `.test.ts` | Create（Task 5。`lessonRuns/{id}/orders`サブコレクションCRUD） |
| `functions/src/market/engine/fundLocking.ts`, `.test.ts` | Create（Task 6。ソフト拘束・ハード拘束の純粋関数） |
| `functions/src/lessonRuns/teamAccounts/types.ts`, `repository.ts`, `.test.ts` | Create（Task 7。`TeamAccount`元帳。Task 8で`releaseSoftLock`を追記） |
| `functions/src/market/submitOrder.ts`, `.test.ts`, `onCall.ts` / `src/lib/market/submitOrder.ts`, `.test.ts` | Create（Task 7。`onCall.ts`はTask 8・11・12・15も同ファイルへ追記する共有Callableエントリポイント） |
| `functions/src/market/cancelOrder.ts`, `.test.ts` / `src/lib/market/cancelOrder.ts`, `.test.ts` | Create（Task 8） |
| `functions/src/market/engine/settleBatch.ts`, `.test.ts` | Create（Task 9。バッチ締切処理の中核純粋関数） |
| `functions/src/market/processBatch.ts`, `.test.ts` | Create（Task 9。Admin SDKラッパー。Task 17でライフサイクルイベント分岐を追記） |
| `functions/src/market/batchScheduler.ts`, `.test.ts`, `taskHandler.ts`, `.test.ts`, `chainWatchdog.ts`, `.test.ts` | Create（Task 10。Cloud Tasks自己連鎖と連鎖切断監視） |
| `functions/src/market/pauseMarket.ts`, `.test.ts`, `onCall.ts` / `src/lib/market/pauseMarket.ts` | Create（Task 11） |
| `functions/src/market/resumeMarket.ts`, `.test.ts`, `onCall.ts` / `src/lib/market/resumeMarket.ts` | Create（Task 12） |
| `src/lib/lessonRuns/liveTypes.ts` | Modify（Task 13。`LessonRunPublicState`/`LessonRunPrivateState`へ市場フィールド追加） |
| `src/lib/market/teamState.ts`, `.test.ts` | Create（Task 13。`LessonRunTeamState`型） |
| `database.rules.json` | Modify（Task 13。`lessonRunTeamState`ノード追加、`lessonRunPublic`の市場フィールド確認） |
| `functions/src/market/priceHistory.ts`, `.test.ts` | Create（Task 14。3秒ごとの価格保存・集約） |
| `functions/src/market/exportCsv.ts`, `.test.ts` | Create（Task 14。CSVエクスポート） |
| `functions/src/market/predictionCheckpoint.ts`, `.test.ts`, `onCall.ts` | Create（Task 15） |
| `functions/src/market/evaluation.ts`, `.test.ts` | Create（Task 16。5観点評価と観点別ランキング） |
| `functions/src/market/lifecycleEvents.ts`, `.test.ts` | Create（Task 17。倒産・配当・分割、既定オフ） |
| `functions/src/market/concurrentBatch.test.ts` | Create（Task 18。並行実行テスト） |
| `functions/src/market/replayDeterminism.test.ts` | Create（Task 19。複数バッチにまたがるリプレイ決定性） |
| `test/database.rules.test.ts`, `test/firestore.rules.test.ts` | Modify（Task 5・13） |

---

## タスク一覧

1. 企業・情報・決算・指標の型（公開/非公開分離）
2. `LessonContent`拡張と教材バリデーション
3. 価格計算エンジン（情報+需給+ノイズ、価格ガード、内訳）
4. 需給集計（相殺後の正味・相殺前の出来高）
5. 注文モデルとリポジトリ
6. 資金・株の拘束（ソフト/ハード2段階）
7. 注文送信Callable
8. 注文取消Callable
9. バッチ締切処理の中核（検証・相殺・約定・不成立・次価格）
10. Cloud Tasksによる3秒バッチ自己連鎖
11. 市場停止Callable
12. 市場再開Callable
13. RTDBライブ市場スキーマ（公開/非公開/チーム別の3分離）
14. 価格履歴・チャートとCSVエクスポート
15. 予想チェックポイント
16. 社会科の評価（5観点・観点別ランキング）
17. 倒産・配当・分割（既定オフ）
18. 並行実行テスト（§30-4）
19. 受け入れテスト（§27.2）と完了条件の確定

---

### Task 1: 企業・情報・決算・指標の型（公開/非公開分離）

統合仕様書 §12.4（企業）・§12.5（情報カテゴリ）・§12.6（決算難易度）・§12.7（`InformationImpact`）・§12.8（経済指標）を実装する。**生徒に見せる情報と教師用の非公開の影響設定を型で分離する**——同じ型に両方のフィールドを同居させると、DTO変換を書き忘れて非公開係数が生徒画面へ流出するバグを作り込みやすい。Phase Aが確立した`packages/*`共有パッケージパターン（`@stock-league/deterministic-random`と同じworkspaces方式）を踏襲し、2つの独立パッケージに分ける。

- `packages/market-public-content`（`@stock-league/market-public-content`）: 生徒向けDTO。クライアント`src/`（生徒UI）とFunctions`functions/`（間引き変換の出力先）の両方が依存する。
- `packages/market-authoring-content`（`@stock-league/market-authoring-content`）: 非公開authoring型。クライアント`src/`（**教師の**教材作成UI——教師は自分が設定した`impactSensitivities`等を当然読み書きする）とFunctions`functions/`（価格計算エンジンの入力）の両方が依存する。**「`src/`からimportしない」という制約はここでは採用しない**——教師UIが成立しなくなるため。生徒に非公開データが渡らないことを保証するのは、この型のimport可否ではなく、(a) 生データを含む`LessonTemplate.draft`/`LessonRun.templateSnapshot`（Firestore）を組織メンバー（教師）以外が読めないこと、(b) 生徒が読む唯一の経路`lessonRunPublic`（RTDB）には`functions/src/market/toPublicView.ts`が生成した間引き後データしか書き込まれないこと、の2点。

`toPublicView.ts`（間引き変換関数そのもの）は`functions/`にだけ置く。これは「生徒に何を見せるかを決めるロジック」を、クライアントに書き換えられない場所（サーバー）に固定するための設計判断であり、import境界そのものがセキュリティ境界ではない点に注意する。

**Files:**
- Create: `packages/market-public-content/package.json`, `tsconfig.json`, `src/index.ts`, `src/index.test.ts`
- Create: `packages/market-authoring-content/package.json`, `tsconfig.json`, `src/index.ts`, `src/index.test.ts`
- Modify: ルート`package.json`（`workspaces`に両パッケージを追加）, `functions/package.json`・`package.json`（依存に追加。`src/`側は教師UIタスクで`market-authoring-content`を使う）
- Create: `functions/src/market/toPublicView.ts`, `.test.ts`

**Interfaces:**
- Consumes: なし（Phase Aの型のみ利用）
- Produces: `CompanyPublicView`、`InformationPublicView`、`EconomicIndicatorPublicView`、`SimulatedCompany`、`InformationItem`、`InformationImpact`、`EconomicIndicatorAuthoring`、`toCompanyPublicView(company, difficulty)`、`toInformationPublicView(item)`

- [ ] **Step 1: 公開DTOの失敗するテストを書く**

`packages/market-public-content/src/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { CompanyPublicView, InformationPublicView } from './index'

describe('CompanyPublicView', () => {
  it('has no field that could carry a hidden coefficient', () => {
    const view: CompanyPublicView = {
      id: 'acme', name: 'アクメ商事', symbol: 'ACME', industry: '小売',
      description: '架空の総合小売企業', productsAndServices: ['日用品', 'EC'],
      sizeClass: 'MEDIUM', riskFactors: ['為替変動'],
    }
    // Compile-time guarantee: this object literal must satisfy the type
    // with ONLY these fields. If someone adds `impactSensitivities` to
    // CompanyPublicView, this test still passes but Task 1's review must
    // reject it — see the architecture note in the file header comment.
    expect(Object.keys(view)).not.toContain('impactSensitivities')
    expect(Object.keys(view)).not.toContain('minimumPriceGuard')
  })
})

describe('InformationPublicView', () => {
  it('carries only the student-facing body, never InformationImpact', () => {
    const view: InformationPublicView = {
      id: 'news-1', category: 'OFFICIAL_NEWS', source: '政府発表',
      publishedAtMillis: 1000, natureType: 'FACT', confidenceLevel: 'HIGH',
      targetCompanyIds: ['acme'], body: '政府が新しい規制を発表した。',
    }
    expect(Object.keys(view)).not.toContain('baseDirection')
    expect(Object.keys(view)).not.toContain('strength')
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd packages/market-public-content && npx vitest run src/index.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: `package.json`・`tsconfig.json`を作成する（決定的PRNGパッケージと同じ共有パッケージ構成）**

`packages/market-public-content/package.json`:

```json
{
  "name": "@stock-league/market-public-content",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "lint": "oxlint src",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "verify": "npm run lint && npm run typecheck && npm run test"
  }
}
```

`tsconfig.json`は対象パッケージの実行環境に合わせて設定する。ルート`package.json`の`workspaces`へ`"packages/market-public-content"`を追加し、`functions/package.json`の`dependencies`へ`"@stock-league/market-public-content": "*"`を追加する。

- [ ] **Step 4: 公開DTOを実装する**

`packages/market-public-content/src/index.ts`:

```ts
/**
 * Student-facing view of a company/information item/indicator. This
 * package is imported by both the client (`src/`, student-facing UI) and
 * Functions (`functions/`, which populates RTDB `lessonRunPublic` from
 * this shape) — the same workspace pattern as
 * `@stock-league/deterministic-random`. It must NEVER gain a field that
 * reveals impactSensitivities, minimumPriceGuard internals, or any other
 * non-public coefficient — those live in
 * `@stock-league/market-authoring-content` instead, which the teacher's
 * authoring UI legitimately imports but which this package must never
 * import (the dependency points one way: authoring-content may reference
 * this package's shared enums, never the reverse). Spec §12.4's difficulty
 * tiers (初級/標準/発展) are expressed by which of the optional fields
 * below are populated, not by a separate type.
 */
export type CompanySizeClass = 'SMALL' | 'MEDIUM' | 'LARGE'
export type CompanyDifficultyTier = 'BASIC' | 'STANDARD' | 'ADVANCED'

export interface CompanyPublicView {
  id: string
  name: string
  symbol: string
  industry: string
  description: string
  productsAndServices: string[]
  sizeClass: CompanySizeClass
  riskFactors: string[]
  // STANDARD tier and above
  domesticRevenueRatio?: number
  overseasRevenueRatio?: number
  costDrivers?: string[]
  growthProfile?: 'STABLE' | 'GROWTH' | 'CYCLICAL'
  // ADVANCED tier only
  financialStrength?: 'WEAK' | 'STANDARD' | 'STRONG'
}

export type InformationCategory =
  | 'OFFICIAL_NEWS' | 'MARKET_DATA' | 'EARNINGS' | 'ANALYSIS' | 'UNVERIFIED'
export type InformationNature = 'FACT' | 'FORECAST' | 'OPINION'
export type InformationConfidence = 'HIGH' | 'MEDIUM' | 'UNKNOWN'

export interface InformationPublicView {
  id: string
  category: InformationCategory
  source: string
  publishedAtMillis: number
  natureType: InformationNature
  confidenceLevel: InformationConfidence
  targetCompanyIds: string[]
  body: string
}

export type EconomicIndicatorKind = 'ECONOMY' | 'PRICE' | 'INTEREST_RATE' | 'FX' | 'POLICY'
export type EconomicIndicatorDifficultyTier = 'BASIC' | 'STANDARD' | 'ADVANCED'

export interface EconomicIndicatorPublicView {
  id: string
  kind: EconomicIndicatorKind
  publishedAtMillis: number
  // BASIC: only a plain-language label (e.g. "円安", "利上げ")
  label: string
  // STANDARD and above: the numeric value/change
  value?: number
  changeFromPrevious?: number
}
```

- [ ] **Step 5: テストを通す**

Run: `cd packages/market-public-content && npm install && npx vitest run src/index.test.ts`
Expected: PASS

- [ ] **Step 6: 非公開authoring型の失敗するテストを書く**

`packages/market-authoring-content/src/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { toCompanyPublicView, toInformationPublicView } from './toPublicView'
import type { InformationItem, SimulatedCompany } from './index'

const company: SimulatedCompany = {
  id: 'acme', name: 'アクメ商事', symbol: 'ACME', industry: '小売',
  description: '架空の総合小売企業', productsAndServices: ['日用品', 'EC'],
  domesticRevenueRatio: 0.7, overseasRevenueRatio: 0.3, costDrivers: ['物流費'],
  sizeClass: 'MEDIUM', financialStrength: 'STANDARD', growthProfile: 'STABLE',
  riskFactors: ['為替変動'], initialPrice: 1000,
  minimumPriceGuard: { type: 'ABSOLUTE', minimumPrice: 1 },
  impactSensitivities: { OFFICIAL_NEWS: 1.2, MARKET_DATA: 0.8 },
}

const info: InformationItem = {
  id: 'news-1', category: 'OFFICIAL_NEWS', source: '政府発表',
  publishedAtMillis: 1000, natureType: 'FACT', confidenceLevel: 'HIGH',
  targetCompanyIds: ['acme'], body: '政府が新しい規制を発表した。',
  impact: { baseDirection: 'NEGATIVE', strength: 0.6, shortTermImpact: 0.4 },
}

describe('toCompanyPublicView', () => {
  it('drops impactSensitivities and minimumPriceGuard for the BASIC tier', () => {
    const view = toCompanyPublicView(company, 'BASIC')
    expect(view).not.toHaveProperty('impactSensitivities')
    expect(view).not.toHaveProperty('minimumPriceGuard')
    expect(view).not.toHaveProperty('financialStrength')
    expect(view.domesticRevenueRatio).toBeUndefined()
  })

  it('includes revenue mix at STANDARD but withholds financialStrength', () => {
    const view = toCompanyPublicView(company, 'STANDARD')
    expect(view.domesticRevenueRatio).toBe(0.7)
    expect(view).not.toHaveProperty('financialStrength')
  })

  it('includes financialStrength at ADVANCED, but never impactSensitivities', () => {
    const view = toCompanyPublicView(company, 'ADVANCED')
    expect(view.financialStrength).toBe('STANDARD')
    expect(view).not.toHaveProperty('impactSensitivities')
  })
})

describe('toInformationPublicView', () => {
  it('never leaks InformationImpact', () => {
    const view = toInformationPublicView(info)
    expect(view).not.toHaveProperty('impact')
    expect(view).toEqual({
      id: 'news-1', category: 'OFFICIAL_NEWS', source: '政府発表',
      publishedAtMillis: 1000, natureType: 'FACT', confidenceLevel: 'HIGH',
      targetCompanyIds: ['acme'], body: '政府が新しい規制を発表した。',
    })
  })
})
```

- [ ] **Step 7: 失敗を確認する**

Run: `cd packages/market-authoring-content && npx vitest run src/index.test.ts`
Expected: FAIL — module not found

- [ ] **Step 8: `package.json`・`tsconfig.json`を作成する**

`packages/market-authoring-content/package.json`（Step 3の`market-public-content`と同一構成。`name`のみ`@stock-league/market-authoring-content`）。`tsconfig.json`も同様に複製する。ルート`package.json`の`workspaces`へ`"packages/market-authoring-content"`を追加し、`functions/package.json`の`dependencies`へ`"@stock-league/market-authoring-content": "*"`、**ルート`package.json`（クライアント`src/`側）にも同じ依存を追加する**——教師の教材作成UI（Phase C後続タスクまたは別計画）がこのパッケージを直接importするため。

- [ ] **Step 9: 非公開authoring型と変換関数を実装する**

`packages/market-authoring-content/src/index.ts`:

```ts
/**
 * Teacher-authoring / server-internal types. This package IS imported by
 * `src/` (the teacher's own authoring UI legitimately edits
 * impactSensitivities, InformationImpact, etc. — the teacher is the
 * author of these values). What must never happen is a STUDENT receiving
 * this data — see the architecture note at the top of this plan: that is
 * enforced by Firestore rules on `lessonRuns`/`lessonTemplates` (teacher
 * read-only) and by `toPublicView.ts` being the only producer of what
 * lands in the student-readable RTDB `lessonRunPublic` path, not by
 * restricting who may import this type. This file depends on
 * `@stock-league/market-public-content` for shared enum types
 * (`CompanySizeClass` etc.) — the dependency points one way: this package
 * may reference that one, never the reverse.
 */
import type { CompanySizeClass, InformationCategory, InformationConfidence, InformationNature } from '@stock-league/market-public-content'

export type PriceGuard =
  | { type: 'ABSOLUTE'; minimumPrice: number }
  | { type: 'PERCENT_OF_INITIAL'; minimumPercent: number }

export interface SimulatedCompany {
  id: string
  name: string
  symbol: string
  industry: string
  description: string
  productsAndServices: string[]
  domesticRevenueRatio?: number
  overseasRevenueRatio?: number
  costDrivers: string[]
  sizeClass: CompanySizeClass
  financialStrength: 'WEAK' | 'STANDARD' | 'STRONG'
  growthProfile: 'STABLE' | 'GROWTH' | 'CYCLICAL'
  riskFactors: string[]
  initialPrice: number
  minimumPriceGuard: PriceGuard
  /** Hidden. Never sent to students. Keyed by InformationCategory. */
  impactSensitivities: Record<string, number>
}

export interface InformationImpact {
  baseDirection: 'POSITIVE' | 'NEGATIVE' | 'MIXED' | 'NEUTRAL'
  strength: number
  marketExpectation?: number
  interactions?: string[]
  shortTermImpact?: number
  longTermImpact?: number
}

export interface InformationItem {
  id: string
  category: InformationCategory
  source: string
  publishedAtMillis: number
  natureType: InformationNature
  confidenceLevel: InformationConfidence
  targetCompanyIds: string[]
  /** Student-visible body. Everything else on this type is teacher-only. */
  body: string
  /** Hidden. Drives priceCalculation.ts (Task 3). Never sent to students. */
  impact: InformationImpact
}

export interface EconomicIndicatorAuthoring {
  id: string
  kind: 'ECONOMY' | 'PRICE' | 'INTEREST_RATE' | 'FX' | 'POLICY'
  publishedAtMillis: number
  label: string
  value?: number
  changeFromPrevious?: number
  /** Hidden. Per-company multiplier — spec §12.8 "企業特性と結び付ける". */
  companyImpactMultipliers: Record<string, number>
}
```

- [ ] **Step 10: 変換関数を実装する**

`functions/src/market/toPublicView.ts`:

```ts
import type { CompanyDifficultyTier, CompanyPublicView, EconomicIndicatorPublicView, InformationPublicView } from '@stock-league/market-public-content'
import type { EconomicIndicatorAuthoring, InformationItem, SimulatedCompany } from '@stock-league/market-authoring-content'

export const toCompanyPublicView = (
  company: SimulatedCompany,
  tier: CompanyDifficultyTier,
): CompanyPublicView => {
  const base: CompanyPublicView = {
    id: company.id, name: company.name, symbol: company.symbol,
    industry: company.industry, description: company.description,
    productsAndServices: company.productsAndServices,
    sizeClass: company.sizeClass, riskFactors: company.riskFactors,
  }
  if (tier === 'BASIC') return base
  const standard: CompanyPublicView = {
    ...base,
    domesticRevenueRatio: company.domesticRevenueRatio,
    overseasRevenueRatio: company.overseasRevenueRatio,
    costDrivers: company.costDrivers,
    growthProfile: company.growthProfile,
  }
  if (tier === 'STANDARD') return standard
  return { ...standard, financialStrength: company.financialStrength }
}

export const toInformationPublicView = (item: InformationItem): InformationPublicView => ({
  id: item.id, category: item.category, source: item.source,
  publishedAtMillis: item.publishedAtMillis, natureType: item.natureType,
  confidenceLevel: item.confidenceLevel, targetCompanyIds: item.targetCompanyIds,
  body: item.body,
})

export const toEconomicIndicatorPublicView = (
  indicator: EconomicIndicatorAuthoring,
  tier: 'BASIC' | 'STANDARD' | 'ADVANCED',
): EconomicIndicatorPublicView => {
  const base: EconomicIndicatorPublicView = {
    id: indicator.id, kind: indicator.kind,
    publishedAtMillis: indicator.publishedAtMillis, label: indicator.label,
  }
  if (tier === 'BASIC') return base
  return { ...base, value: indicator.value, changeFromPrevious: indicator.changeFromPrevious }
}
```

- [ ] **Step 11: テストを通す**

Run: `cd functions && npx vitest run src/market/toPublicView.test.ts`
Expected: PASS

- [ ] **Step 12: `npm run verify`**

- [ ] **Step 13: Commit**

```bash
git add packages/market-public-content packages/market-authoring-content package.json \
  functions/src/market/toPublicView.ts functions/src/market/toPublicView.test.ts functions/package.json
git commit -m "feat: split company/information types into public and private-authoring packages"
```

---

### Task 2: `LessonContent`拡張と教材バリデーション

統合仕様書 §12.1〜§12.8、§12.18、§12.20〜§12.23、§12.26、§12.28、§12.29、§12.32、§12.33を集約する教材内容を`LessonContent`（Phase A、`src/lib/lessonTemplates/types.ts`）へ追加する。Phase Aの`LessonContent`は`{ schemaVersion, title, description, subject }`のプレースホルダーだったため、これを実質的な社会科市場設定へ拡張する最初のタスクになる。数値既定値をコードへ散在させない（§30-10）ため、既定値はすべてこの型のフィールムのデフォルトとして1箇所に集約する。

**Files:**
- Modify: `src/lib/lessonTemplates/types.ts`（`LessonContent`に`socialStudiesMarket?: SocialStudiesMarketContent`を追加）
- Create: `functions/src/market/templateValidation.ts`, `.test.ts`
- Modify: `functions/src/lessonRuns/createLessonRun.ts`（Phase A Task 7）— `LessonRun`作成時に社会科教材のバリデーションを実行

**Interfaces:**
- Consumes: `SimulatedCompany`・`InformationItem`・`EconomicIndicatorAuthoring`（Task 1、`@stock-league/market-authoring-content`）、`LessonContent`（Phase A）、`createLessonRun`（Phase A Task 7）
- Produces: `SocialStudiesMarketContent`型、`validateSocialStudiesMarketContent(content): { valid: true } | { valid: false; errors: string[] }`

- [ ] **Step 1: `SocialStudiesMarketContent`型を定義する失敗するテストを書く**

`src/lib/lessonTemplates/types.test.ts`に追記する（既存ファイルがなければ作成）:

```ts
import { describe, expect, it } from 'vitest'
import type { LessonContent, SocialStudiesMarketContent } from './types'

describe('SocialStudiesMarketContent defaults', () => {
  it('encodes every §28 default value as a field default, not scattered in code', () => {
    const content: SocialStudiesMarketContent = {
      companies: [], informationItems: [], economicIndicators: [],
      batchIntervalSeconds: 3,
      priceSensitivityPreset: 'BALANCED',
      marketNoiseEnabled: true,
      resumeConfirmationSeconds: 30,
      companyDifficultyTier: 'STANDARD',
      indicatorDifficultyTier: 'STANDARD',
      tradingFeeYen: 0,
      dividendEnabled: false,
      stockSplitEnabled: false,
      bankruptcyEnabled: false,
      predictionEvaluationTarget: { type: 'AFTER_BATCHES', count: 20 },
      evaluationWeights: {
        operationResult: 0.1, predictionAccuracy: 0.3, informationUsage: 0.4,
        riskManagement: 0.1, reflection: 0.1,
      },
    }
    expect(content.batchIntervalSeconds).toBe(3)
    expect(content.resumeConfirmationSeconds).toBe(30)
    expect(content.tradingFeeYen).toBe(0)
  })

  it('LessonContent.socialStudiesMarket is optional so HOME_ECONOMICS content is unaffected', () => {
    const content: LessonContent = { schemaVersion: 1, title: 't', description: '', subject: 'HOME_ECONOMICS' }
    expect(content.socialStudiesMarket).toBeUndefined()
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/lessonTemplates/types.test.ts`
Expected: FAIL — `SocialStudiesMarketContent`が存在しない

- [ ] **Step 3: `LessonContent`を拡張する**

`src/lib/lessonTemplates/types.ts`に追記する（既存の`LessonContent`定義はそのまま、フィールドを1つ追加するのみ）:

```ts
import type { EconomicIndicatorAuthoring, InformationItem, SimulatedCompany } from '@stock-league/market-authoring-content'

export type PredictionEvaluationTarget =
  | { type: 'AFTER_BATCHES'; count: number }
  | { type: 'NEXT_INFORMATION' }
  | { type: 'MARKET_CLOSE' }

export interface SocialStudiesEvaluationWeights {
  operationResult: number
  predictionAccuracy: number
  informationUsage: number
  riskManagement: number
  reflection: number
}

/**
 * All §28 default-value-table entries relevant to the market live here as
 * field defaults, not scattered across engine code (spec §30-10). Values
 * ARE the authoring type's field values for a given LessonTemplate — there
 * is no separate "defaults config" file to keep in sync.
 */
export interface SocialStudiesMarketContent {
  companies: SimulatedCompany[]
  informationItems: InformationItem[]
  economicIndicators: EconomicIndicatorAuthoring[]
  /** §12.9. Default 3, teacher range 1-10. */
  batchIntervalSeconds: number
  /** §12.20 abstract control shown to teachers instead of raw coefficients. */
  priceSensitivityPreset: 'INFO_FOCUSED' | 'BALANCED' | 'DEMAND_FOCUSED'
  /** §12.22. Default true (small noise). BASIC tier may disable. */
  marketNoiseEnabled: boolean
  /** §12.26. Default 30. */
  resumeConfirmationSeconds: number
  companyDifficultyTier: 'BASIC' | 'STANDARD' | 'ADVANCED'
  indicatorDifficultyTier: 'BASIC' | 'STANDARD' | 'ADVANCED'
  /** §12.28. Default 0. */
  tradingFeeYen: number
  /** §12.28/§12.29. All default false — see Task 17. */
  dividendEnabled: boolean
  stockSplitEnabled: boolean
  bankruptcyEnabled: boolean
  /** §12.32/矛盾解消F. Default { type: 'AFTER_BATCHES', count: 20 } — see Task 15. */
  predictionEvaluationTarget: PredictionEvaluationTarget
  /** §12.33. Must sum to 1; validated in Step 5 below. */
  evaluationWeights: SocialStudiesEvaluationWeights
}

export interface LessonContent {
  schemaVersion: 1
  title: string
  description: string
  subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS'
  /** Only present when subject === 'SOCIAL_STUDIES'. Optional so existing
   * HOME_ECONOMICS drafts and Phase A's minimal placeholder keep compiling. */
  socialStudiesMarket?: SocialStudiesMarketContent
}
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/lib/lessonTemplates/types.test.ts`
Expected: PASS

- [ ] **Step 5: バリデータの失敗するテストを書く**

`functions/src/market/templateValidation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { validateSocialStudiesMarketContent } from './templateValidation'
import type { SocialStudiesMarketContent } from '../../../src/lib/lessonTemplates/types'

const validCompany = (id: string) => ({
  id, name: id, symbol: id.toUpperCase(), industry: '小売', description: '説明',
  productsAndServices: ['商品'], costDrivers: ['費用'], sizeClass: 'MEDIUM' as const,
  financialStrength: 'STANDARD' as const, growthProfile: 'STABLE' as const,
  riskFactors: ['リスク'], initialPrice: 1000,
  minimumPriceGuard: { type: 'ABSOLUTE' as const, minimumPrice: 1 },
  impactSensitivities: {},
})

const baseContent = (overrides: Partial<SocialStudiesMarketContent> = {}): SocialStudiesMarketContent => ({
  companies: [validCompany('acme'), validCompany('globex'), validCompany('initech')],
  informationItems: [], economicIndicators: [],
  batchIntervalSeconds: 3, priceSensitivityPreset: 'BALANCED', marketNoiseEnabled: true,
  resumeConfirmationSeconds: 30, companyDifficultyTier: 'STANDARD', indicatorDifficultyTier: 'STANDARD',
  tradingFeeYen: 0, dividendEnabled: false, stockSplitEnabled: false, bankruptcyEnabled: false,
  predictionEvaluationTarget: { type: 'AFTER_BATCHES', count: 20 },
  evaluationWeights: { operationResult: 0.1, predictionAccuracy: 0.3, informationUsage: 0.4, riskManagement: 0.1, reflection: 0.1 },
  ...overrides,
})

describe('validateSocialStudiesMarketContent', () => {
  it('accepts a valid 3-company draft (spec §12.4 minimum for a 50-minute lesson)', () => {
    expect(validateSocialStudiesMarketContent(baseContent())).toEqual({ valid: true })
  })

  it('rejects fewer than 3 companies', () => {
    const result = validateSocialStudiesMarketContent(baseContent({ companies: [validCompany('acme')] }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors).toContain('企業は3社以上必要です。')
  })

  it('rejects more than 6 companies (spec §12.4 standard upper bound)', () => {
    const companies = Array.from({ length: 7 }, (_, i) => validCompany(`c${i}`))
    const result = validateSocialStudiesMarketContent(baseContent({ companies }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors).toContain('企業は6社以下にしてください。')
  })

  it('rejects duplicate symbols', () => {
    const result = validateSocialStudiesMarketContent(
      baseContent({ companies: [validCompany('acme'), { ...validCompany('globex'), symbol: 'ACME' }, validCompany('initech')] }),
    )
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors).toContain('銘柄コードが重複しています: ACME')
  })

  it('rejects batchIntervalSeconds outside the 1-10 range (spec §12.9)', () => {
    const result = validateSocialStudiesMarketContent(baseContent({ batchIntervalSeconds: 11 }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors).toContain('処理間隔は1〜10秒にしてください。')
  })

  it('rejects an information item referencing an unknown company id', () => {
    const result = validateSocialStudiesMarketContent(baseContent({
      informationItems: [{
        id: 'news-1', category: 'OFFICIAL_NEWS', source: '政府発表', publishedAtMillis: 0,
        natureType: 'FACT', confidenceLevel: 'HIGH', targetCompanyIds: ['does-not-exist'],
        body: '本文', impact: { baseDirection: 'NEUTRAL', strength: 0 },
      }],
    }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors).toContain('情報 news-1 が存在しない企業を参照しています: does-not-exist')
  })

  it('rejects evaluationWeights that do not sum to 1 (spec §12.33)', () => {
    const result = validateSocialStudiesMarketContent(baseContent({
      evaluationWeights: { operationResult: 0.5, predictionAccuracy: 0.5, informationUsage: 0.5, riskManagement: 0, reflection: 0 },
    }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors).toContain('評価の重みの合計は1にしてください（現在: 1.5）。')
  })
})
```

- [ ] **Step 6: 失敗を確認する**

Run: `cd functions && npx vitest run src/market/templateValidation.test.ts`
Expected: FAIL — module not found

- [ ] **Step 7: バリデータを実装する**

`functions/src/market/templateValidation.ts`:

```ts
import type { SocialStudiesMarketContent } from '../../../src/lib/lessonTemplates/types'

export type ValidationResult = { valid: true } | { valid: false; errors: string[] }

export const validateSocialStudiesMarketContent = (
  content: SocialStudiesMarketContent,
): ValidationResult => {
  const errors: string[] = []

  if (content.companies.length < 3) errors.push('企業は3社以上必要です。')
  if (content.companies.length > 6) errors.push('企業は6社以下にしてください。')

  const symbolCounts = new Map<string, number>()
  for (const company of content.companies) {
    symbolCounts.set(company.symbol, (symbolCounts.get(company.symbol) ?? 0) + 1)
  }
  for (const [symbol, count] of symbolCounts) {
    if (count > 1) errors.push(`銘柄コードが重複しています: ${symbol}`)
  }

  if (content.batchIntervalSeconds < 1 || content.batchIntervalSeconds > 10) {
    errors.push('処理間隔は1〜10秒にしてください。')
  }

  const companyIds = new Set(content.companies.map((c) => c.id))
  for (const item of content.informationItems) {
    for (const targetId of item.targetCompanyIds) {
      if (!companyIds.has(targetId)) {
        errors.push(`情報 ${item.id} が存在しない企業を参照しています: ${targetId}`)
      }
    }
  }
  for (const indicator of content.economicIndicators) {
    for (const companyId of Object.keys(indicator.companyImpactMultipliers)) {
      if (!companyIds.has(companyId)) {
        errors.push(`指標 ${indicator.id} が存在しない企業を参照しています: ${companyId}`)
      }
    }
  }

  const weightSum = Object.values(content.evaluationWeights).reduce((a, b) => a + b, 0)
  if (Math.abs(weightSum - 1) > 1e-9) {
    errors.push(`評価の重みの合計は1にしてください（現在: ${weightSum}）。`)
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors }
}
```

- [ ] **Step 8: テストを通す**

Run: `cd functions && npx vitest run src/market/templateValidation.test.ts`
Expected: PASS

- [ ] **Step 9: `createLessonRun`（Phase A Task 7）へ検証を組み込む失敗するテストを書く**

`functions/src/lessonRuns/createLessonRun.test.ts`に追記する（Phase Aの既存テストファイル。既存の2テストは変更しない）:

```ts
it('rejects creating a SOCIAL_STUDIES run whose templateSnapshot has fewer than 3 companies', async () => {
  const fake = makeFakeFirestore()
  fake.docs.set('lessonTemplates/tpl-2', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1' })
  fake.docs.set('lessonTemplates/tpl-2/versions/v1', {
    content: {
      schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES',
      socialStudiesMarket: { companies: [], informationItems: [], economicIndicators: [], batchIntervalSeconds: 3 /* ...省略 */ },
    },
  })
  await expect(createLessonRun({
    firestore: fake as never, generateRandomSeed: () => 'seed',
    lessonRunIdempotencyKey: 'idem-2', orgId: 'personal_teacher-a',
    templateId: 'tpl-2', primaryTeacherUid: 'teacher-a',
  })).rejects.toThrow('企業は3社以上必要です。')
})
```

- [ ] **Step 10: 失敗を確認する**

Run: `cd functions && npx vitest run src/lessonRuns/createLessonRun.test.ts`
Expected: FAIL — バリデーションが呼ばれていないため例外が投げられない

- [ ] **Step 11: `createLessonRun`を修正する**

`functions/src/lessonRuns/createLessonRun.ts`のトランザクション内、`templateSnapshot`を確定した直後に検証を挿入する:

```ts
import { validateSocialStudiesMarketContent } from '../market/templateValidation'

// ...既存の versionData 取得後、tx.set で lessonRuns/{id} を書く前に追記:
const content = versionData.content as { subject: string; socialStudiesMarket?: unknown }
if (content.subject === 'SOCIAL_STUDIES' && content.socialStudiesMarket) {
  const result = validateSocialStudiesMarketContent(
    content.socialStudiesMarket as Parameters<typeof validateSocialStudiesMarketContent>[0],
  )
  if (!result.valid) throw new Error(result.errors[0])
}
```

- [ ] **Step 12: テストを通す**

Run: `cd functions && npx vitest run src/lessonRuns/createLessonRun.test.ts`
Expected: PASS（Phase Aの既存2テストも引き続きPASSすること）

- [ ] **Step 13: `npm run verify`**

- [ ] **Step 14: Commit**

```bash
git add src/lib/lessonTemplates/types.ts src/lib/lessonTemplates/types.test.ts \
  functions/src/market/templateValidation.ts functions/src/market/templateValidation.test.ts \
  functions/src/lessonRuns/createLessonRun.ts functions/src/lessonRuns/createLessonRun.test.ts
git commit -m "feat: add SocialStudiesMarketContent and validate it at LessonRun creation"
```

---

### Task 3: 価格計算エンジン（情報+需給+ノイズ、価格ガード、内訳）

統合仕様書 §12.20（概念式）・§12.21（需給影響）・§12.22（市場ノイズ）・§12.23（価格ガード）・§12.24（急変表示）・§12.31（内訳表示）を実装する。純粋関数とし、Cloud Tasksハンドラ（Task 10）から呼ばれる。**乱数は`functions/packages/deterministic-random`のみを使う。**

`priceSensitivityPreset`（情報重視/バランス/需給重視）が情報影響と需給影響の相対的な重みをどう変えるかの具体的な倍率、および§12.24の「急変」をどの変化率から警告とするかは、統合仕様書にもPhase A・矛盾解消ドキュメントにも数値が示されていない（矛盾解消ドキュメント「残る未確定事項」の「需給感度の既定値」「市場ノイズの実値」に該当し、「試運転で決める」と明記されている）。本タスクでは動作する具体的な既定値を置くが、**これは試運転で調整される暫定値であり最終値ではない**——値を1箇所（`PRICE_SENSITIVITY_PRESETS`定数と`DEFAULT_SUDDEN_CHANGE_WARNING_THRESHOLD_PERCENT`)にまとめ、テストが期待する数値もそこを参照する形にして、後から調整するときに変更箇所が1つで済むようにする。

**Files:**
- Create: `functions/src/market/engine/priceCalculation.ts`, `.test.ts`

**Interfaces:**
- Consumes: `PriceGuard`（Task 1）、`deriveSeed`/`mulberry32`（Phase A、`@stock-league/deterministic-random`）
- Produces: `calculateNextPrice(input): PriceCalculationResult`、`PRICE_SENSITIVITY_PRESETS`

- [ ] **Step 1: 価格ガード単体の失敗するテストを書く**

`functions/src/market/engine/priceCalculation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyPriceGuard, calculateNextPrice } from './priceCalculation'

describe('applyPriceGuard', () => {
  it('clamps to the absolute minimum (spec §12.23 default is 1 yen)', () => {
    expect(applyPriceGuard(0.5, { type: 'ABSOLUTE', minimumPrice: 1 }, 1000)).toEqual({ price: 1, guardApplied: true })
  })
  it('does not clamp when above the minimum', () => {
    expect(applyPriceGuard(500, { type: 'ABSOLUTE', minimumPrice: 1 }, 1000)).toEqual({ price: 500, guardApplied: false })
  })
  it('clamps to a percentage of the initial price', () => {
    expect(applyPriceGuard(50, { type: 'PERCENT_OF_INITIAL', minimumPercent: 10 }, 1000)).toEqual({ price: 100, guardApplied: true })
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/market/engine/priceCalculation.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: `applyPriceGuard`を実装する**

`functions/src/market/engine/priceCalculation.ts`:

```ts
import { deriveSeed, mulberry32 } from '@stock-league/deterministic-random'
import type { PriceGuard } from '@stock-league/market-authoring-content'

export const applyPriceGuard = (
  price: number,
  guard: PriceGuard,
  initialPrice: number,
): { price: number; guardApplied: boolean } => {
  const minimum = guard.type === 'ABSOLUTE'
    ? guard.minimumPrice
    : initialPrice * (guard.minimumPercent / 100)
  if (price < minimum) return { price: minimum, guardApplied: true }
  return { price, guardApplied: false }
}
```

- [ ] **Step 4: テストを通す**

Run: `cd functions && npx vitest run src/market/engine/priceCalculation.test.ts`
Expected: PASS（`applyPriceGuard`のテストのみ）

- [ ] **Step 5: `calculateNextPrice`の失敗するテストを書く（決定性・内訳・急変警告を検証する）**

`functions/src/market/engine/priceCalculation.test.ts`に追記する:

```ts
describe('calculateNextPrice', () => {
  const baseInput = {
    currentPrice: 1000,
    initialPrice: 1000,
    informationImpactPercent: 4.2,
    netDemandValue: -500,
    effectiveMarketSize: 50000,
    demandSensitivity: 1,
    priceSensitivityPreset: 'BALANCED' as const,
    noiseEnabled: true,
    randomSeed: 'run-abc', restoreGeneration: 0, stockId: 'acme', batchIndex: 3,
    priceGuard: { type: 'ABSOLUTE' as const, minimumPrice: 1 },
  }

  it('is deterministic for the same seed inputs (spec §26-1 / 矛盾解消D)', () => {
    const first = calculateNextPrice(baseInput)
    const second = calculateNextPrice(baseInput)
    expect(first).toEqual(second)
  })

  it('produces a different noise term when restoreGeneration changes', () => {
    const before = calculateNextPrice(baseInput)
    const after = calculateNextPrice({ ...baseInput, restoreGeneration: 1 })
    expect(before.breakdown.otherPercent).not.toBe(after.breakdown.otherPercent)
  })

  it('breaks down into news/demand/other/total, matching the §12.31 display', () => {
    const result = calculateNextPrice(baseInput)
    expect(result.breakdown.total).toBeCloseTo(
      result.breakdown.informationPercent + result.breakdown.demandPercent + result.breakdown.otherPercent,
      9,
    )
  })

  it('applies BALANCED preset with equal 1x weight on information and demand', () => {
    const result = calculateNextPrice({ ...baseInput, noiseEnabled: false })
    const expectedDemandPercent = (baseInput.netDemandValue / baseInput.effectiveMarketSize) * baseInput.demandSensitivity * 100
    expect(result.breakdown.informationPercent).toBeCloseTo(4.2, 9)
    expect(result.breakdown.demandPercent).toBeCloseTo(expectedDemandPercent, 9)
  })

  it('flags a sudden-change warning above the configured threshold without blocking the price', () => {
    const result = calculateNextPrice({ ...baseInput, informationImpactPercent: 20, noiseEnabled: false })
    expect(result.suddenChangeWarning).toBe(true)
    expect(result.nextPrice).toBeGreaterThan(baseInput.currentPrice) // still moves — no hard cap (spec §12.20/§12.24)
  })

  it('never returns a price below the guard even with a large negative swing', () => {
    const result = calculateNextPrice({
      ...baseInput, informationImpactPercent: -95, netDemandValue: -100000, noiseEnabled: false,
    })
    expect(result.nextPrice).toBe(1)
    expect(result.guardApplied).toBe(true)
  })
})
```

- [ ] **Step 6: 失敗を確認する**

Run: `cd functions && npx vitest run src/market/engine/priceCalculation.test.ts`
Expected: FAIL — `calculateNextPrice` not exported

- [ ] **Step 7: `calculateNextPrice`を実装する**

`functions/src/market/engine/priceCalculation.ts`に追記する:

```ts
export type PriceSensitivityPreset = 'INFO_FOCUSED' | 'BALANCED' | 'DEMAND_FOCUSED'

/**
 * Relative weight applied to the information term vs. the demand term.
 * PROVISIONAL — spec resolution doc lists "需給感度の既定値" as
 * undecided, to be set during playtesting. Keep both numbers here, in one
 * place, so tuning after playtesting touches only this constant.
 */
export const PRICE_SENSITIVITY_PRESETS: Record<PriceSensitivityPreset, { informationWeight: number; demandWeight: number }> = {
  INFO_FOCUSED: { informationWeight: 1.5, demandWeight: 0.5 },
  BALANCED: { informationWeight: 1, demandWeight: 1 },
  DEMAND_FOCUSED: { informationWeight: 0.5, demandWeight: 1.5 },
}

/** PROVISIONAL, same reason as above ("市場ノイズの実値" — spec §12.22 says ±0.2〜0.5%目安). */
export const DEFAULT_NOISE_MAGNITUDE_PERCENT = 0.35
/** PROVISIONAL — no default exists anywhere in the spec for this threshold; introduced by this plan. */
export const DEFAULT_SUDDEN_CHANGE_WARNING_THRESHOLD_PERCENT = 7

export interface PriceCalculationInput {
  currentPrice: number
  initialPrice: number
  /** Pre-aggregated across all information items active this batch. */
  informationImpactPercent: number
  /** Net (post-netting) demand value in yen — spec resolution C. */
  netDemandValue: number
  effectiveMarketSize: number
  demandSensitivity: number
  priceSensitivityPreset: PriceSensitivityPreset
  noiseEnabled: boolean
  randomSeed: string
  restoreGeneration: number
  stockId: string
  batchIndex: number
  priceGuard: import('@stock-league/market-authoring-content').PriceGuard
  noiseMagnitudePercent?: number
  suddenChangeWarningThresholdPercent?: number
}

export interface PriceCalculationResult {
  nextPrice: number
  guardApplied: boolean
  suddenChangeWarning: boolean
  breakdown: {
    informationPercent: number
    demandPercent: number
    /** Displayed to students as "その他要因" per spec §12.31 — never
     * labeled "noise" or "market noise" in student-facing copy. */
    otherPercent: number
    total: number
  }
}

export const calculateNextPrice = (input: PriceCalculationInput): PriceCalculationResult => {
  const weights = PRICE_SENSITIVITY_PRESETS[input.priceSensitivityPreset]
  const demandRatio = input.netDemandValue / input.effectiveMarketSize
  const demandPercent = demandRatio * input.demandSensitivity * weights.demandWeight * 100
  const informationPercent = input.informationImpactPercent * weights.informationWeight

  let otherPercent = 0
  if (input.noiseEnabled) {
    const magnitude = input.noiseMagnitudePercent ?? DEFAULT_NOISE_MAGNITUDE_PERCENT
    const seed = deriveSeed([input.randomSeed, input.restoreGeneration, input.stockId, input.batchIndex])
    const rand = mulberry32(seed)()
    // rand is in [0, 1) — map to [-magnitude, +magnitude]
    otherPercent = (rand * 2 - 1) * magnitude
  }

  const total = informationPercent + demandPercent + otherPercent
  const rawNextPrice = input.currentPrice * (1 + total / 100)
  const guardResult = applyPriceGuard(Math.round(rawNextPrice), input.priceGuard, input.initialPrice)
  const threshold = input.suddenChangeWarningThresholdPercent ?? DEFAULT_SUDDEN_CHANGE_WARNING_THRESHOLD_PERCENT

  return {
    nextPrice: guardResult.price,
    guardApplied: guardResult.guardApplied,
    suddenChangeWarning: Math.abs(total) >= threshold,
    breakdown: { informationPercent, demandPercent, otherPercent, total },
  }
}
```

- [ ] **Step 8: テストを通す**

Run: `cd functions && npx vitest run src/market/engine/priceCalculation.test.ts`
Expected: PASS

- [ ] **Step 9: `effectiveMarketSize`を企業規模から導出する関数の失敗するテストを書く（§12.21「発行株数を入力させない」）**

すべての`settleBatch`/`calculateNextPrice`呼び出しは`effectiveMarketSize`を入力として受け取るが、**この値は教師が直接入力するのではなく`SimulatedCompany.sizeClass`から導出する**——このタスクで導出関数を作らないと、Task 9のprocessBatchが`effectiveMarketSize`をどこから得るかが宙に浮く。`priceCalculation.test.ts`に追記する:

```ts
describe('effectiveMarketSizeForCompany', () => {
  it('maps SMALL/MEDIUM/LARGE to increasing market sizes — smaller companies move more per unit of demand', () => {
    expect(effectiveMarketSizeForCompany('SMALL')).toBeLessThan(effectiveMarketSizeForCompany('MEDIUM'))
    expect(effectiveMarketSizeForCompany('MEDIUM')).toBeLessThan(effectiveMarketSizeForCompany('LARGE'))
  })
})
```

- [ ] **Step 10: 失敗を確認し、実装する**

Run: `cd functions && npx vitest run src/market/engine/priceCalculation.test.ts`
Expected: FAIL — `effectiveMarketSizeForCompany` not exported

`functions/src/market/engine/priceCalculation.ts`に追記する:

```ts
/**
 * PROVISIONAL — spec resolution doc lists no numeric default for company
 * size → market size (only "小さい企業: 動きやすい" as qualitative
 * guidance). These values are a starting point for playtesting, kept in
 * one place per this plan's Global Constraints. Units are yen — a
 * netDemandValue equal to this size moves the price by `demandSensitivity`
 * × 100%, per calculateNextPrice's demandRatio calculation.
 */
export const SIZE_CLASS_TO_EFFECTIVE_MARKET_SIZE: Record<import('@stock-league/market-public-content').CompanySizeClass, number> = {
  SMALL: 50000,
  MEDIUM: 150000,
  LARGE: 400000,
}

export const effectiveMarketSizeForCompany = (
  sizeClass: import('@stock-league/market-public-content').CompanySizeClass,
): number => SIZE_CLASS_TO_EFFECTIVE_MARKET_SIZE[sizeClass]
```

- [ ] **Step 11: テストを通す**

Run: `cd functions && npx vitest run src/market/engine/priceCalculation.test.ts`
Expected: PASS

- [ ] **Step 12: `npm run verify`**

- [ ] **Step 13: Commit**

```bash
git add functions/src/market/engine/priceCalculation.ts functions/src/market/engine/priceCalculation.test.ts
git commit -m "feat: add deterministic price calculation engine, guard, breakdown, and size-based market size"
```

---

### Task 4: 需給集計（相殺後の正味・相殺前の出来高）

矛盾解消C・統合仕様書 §12.10・§12.14・§12.21を実装する。2段階の相殺がある: (1) §12.14の**同一参加者内**の同一銘柄・同一区間の買い/売り相殺（例: 5株買い+2株売り=3株買い）、(2) 相殺後の結果を全参加者について合計し、需給影響には正味金額を、出来高表示には相殺前の総株数を使う（矛盾解消C）。この2つを取り違えると、生徒が「100株買い・98株売り」を同時に出して正味2株分の資金で100株分の価格圧力を作れてしまう（矛盾解消Cが名指しした操作可能性）——そのテストをそのままこのタスクの受け入れ条件にする。

**Files:**
- Create: `functions/src/market/engine/demandAggregation.ts`, `.test.ts`

**Interfaces:**
- Consumes: なし（Task 9のバッチ約定処理が呼び出す）
- Produces: `nettedFillForParticipant(orders): { side; quantity } | null`、`aggregateDemand(input): { netDemandValue; displayedVolumeShares }`

- [ ] **Step 1: 参加者内相殺の失敗するテストを書く**

`functions/src/market/engine/demandAggregation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { aggregateDemand, nettedFillForParticipant } from './demandAggregation'

describe('nettedFillForParticipant', () => {
  it('nets 5 buy + 2 sell of the same stock into a 3-share buy (spec §12.14 example)', () => {
    expect(nettedFillForParticipant([
      { side: 'BUY', quantity: 5 }, { side: 'SELL', quantity: 2 },
    ])).toEqual({ side: 'BUY', quantity: 3 })
  })

  it('nets equal buy and sell quantities to no trade', () => {
    expect(nettedFillForParticipant([
      { side: 'BUY', quantity: 4 }, { side: 'SELL', quantity: 4 },
    ])).toBeNull()
  })

  it('nets a sell-heavy mix into a net sell', () => {
    expect(nettedFillForParticipant([
      { side: 'BUY', quantity: 2 }, { side: 'SELL', quantity: 5 },
    ])).toEqual({ side: 'SELL', quantity: 3 })
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/market/engine/demandAggregation.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: `nettedFillForParticipant`を実装する**

`functions/src/market/engine/demandAggregation.ts`:

```ts
export interface OrderForNetting {
  side: 'BUY' | 'SELL'
  quantity: number
}

export interface NettedFill {
  side: 'BUY' | 'SELL'
  quantity: number
}

/** Spec §12.14: nets one participant's same-stock, same-batch buy/sell orders. */
export const nettedFillForParticipant = (orders: OrderForNetting[]): NettedFill | null => {
  const buyQuantity = orders.filter((o) => o.side === 'BUY').reduce((sum, o) => sum + o.quantity, 0)
  const sellQuantity = orders.filter((o) => o.side === 'SELL').reduce((sum, o) => sum + o.quantity, 0)
  const diff = buyQuantity - sellQuantity
  if (diff === 0) return null
  return diff > 0 ? { side: 'BUY', quantity: diff } : { side: 'SELL', quantity: -diff }
}
```

- [ ] **Step 4: テストを通す**

Run: `cd functions && npx vitest run src/market/engine/demandAggregation.test.ts`
Expected: PASS（`nettedFillForParticipant`のテストのみ）

- [ ] **Step 5: `aggregateDemand`の失敗するテストを書く（矛盾解消Cの操作可能性テストを含む）**

`functions/src/market/engine/demandAggregation.test.ts`に追記する:

```ts
describe('aggregateDemand', () => {
  it('uses NET (post-netting) value for demand and GROSS (pre-netting) quantity for volume — 矛盾解消C', () => {
    // Two participants: one nets to a 3-share buy, the other to a 2-share sell.
    const result = aggregateDemand({
      executionPrice: 1000,
      nettedFills: [{ side: 'BUY', quantity: 3 }, { side: 'SELL', quantity: 2 }],
      rawOrders: [
        { side: 'BUY', quantity: 5 }, { side: 'SELL', quantity: 2 }, // participant 1's raw orders (nets to 3 buy)
        { side: 'SELL', quantity: 2 }, // participant 2's raw order (nets to 2 sell, no netting needed)
      ],
    })
    expect(result.netDemandValue).toBe(3 * 1000 - 2 * 1000) // 1,000 yen net buying pressure
    expect(result.displayedVolumeShares).toBe(5 + 2 + 2) // 9 shares — the GROSS total, not 5
  })

  it('cannot be gamed by pairing a large buy with an almost-equal sell in the same batch', () => {
    // The manipulation resolution C calls out: "100株買い・98株売り" nets to
    // a 2-share buy — demand pressure must reflect only the 2 net shares,
    // not the 100 gross shares, even though volume still shows 198.
    const result = aggregateDemand({
      executionPrice: 1000,
      nettedFills: [{ side: 'BUY', quantity: 2 }],
      rawOrders: [{ side: 'BUY', quantity: 100 }, { side: 'SELL', quantity: 98 }],
    })
    expect(result.netDemandValue).toBe(2 * 1000)
    expect(result.displayedVolumeShares).toBe(198)
  })

  it('returns zero net demand and zero volume for an empty batch', () => {
    expect(aggregateDemand({ executionPrice: 1000, nettedFills: [], rawOrders: [] }))
      .toEqual({ netDemandValue: 0, displayedVolumeShares: 0 })
  })
})
```

- [ ] **Step 6: 失敗を確認する**

Run: `cd functions && npx vitest run src/market/engine/demandAggregation.test.ts`
Expected: FAIL — `aggregateDemand` not exported

- [ ] **Step 7: `aggregateDemand`を実装する**

`functions/src/market/engine/demandAggregation.ts`に追記する:

```ts
export interface DemandAggregationInput {
  /** The price in effect for this batch — all fills in a batch settle at
   * the same price (spec §12.10), so this is a single number, not a list. */
  executionPrice: number
  /** One entry per participant, ALREADY netted via nettedFillForParticipant. */
  nettedFills: NettedFill[]
  /** Every order as originally submitted, BEFORE per-participant netting. */
  rawOrders: OrderForNetting[]
}

export interface DemandAggregationResult {
  /** Signed yen value. Positive = net buying pressure. Feeds
   * priceCalculation.ts's `netDemandValue` (Task 3). */
  netDemandValue: number
  /** Gross shares traded, pre-netting. Display-only — spec §12.5's
   * "出来高相当の売買量" and 矛盾解消C's displayedVolume. */
  displayedVolumeShares: number
}

export const aggregateDemand = (input: DemandAggregationInput): DemandAggregationResult => {
  let netBuyValue = 0
  let netSellValue = 0
  for (const fill of input.nettedFills) {
    const value = fill.quantity * input.executionPrice
    if (fill.side === 'BUY') netBuyValue += value
    else netSellValue += value
  }
  const displayedVolumeShares = input.rawOrders.reduce((sum, o) => sum + o.quantity, 0)
  return { netDemandValue: netBuyValue - netSellValue, displayedVolumeShares }
}
```

- [ ] **Step 8: テストを通す**

Run: `cd functions && npx vitest run src/market/engine/demandAggregation.test.ts`
Expected: PASS

- [ ] **Step 9: `npm run verify`**

- [ ] **Step 10: Commit**

```bash
git add functions/src/market/engine/demandAggregation.ts functions/src/market/engine/demandAggregation.test.ts
git commit -m "feat: add demand aggregation with net-vs-gross split (spec resolution C)"
```

---

### Task 5: 注文モデルとリポジトリ

統合仕様書 §12.12（注文モデル）・§12.13（冪等性）を実装する。`MarketOrder`はFirestoreサブコレクション`lessonRuns/{lessonRunId}/orders/{orderId}`に置く——バッチ締切ごとに「`batchId`と`status`で絞り込んで取得し、トランザクションで一括更新する」というアクセスパターンがFirestoreクエリ+トランザクションに素直に乗る（Phase Aの`LessonEvent`と同じ「クライアントは直接書けず、Callable/Admin SDK経由のみ」という設計を踏襲する）。

**Files:**
- Create: `functions/src/market/orderTypes.ts`
- Create: `functions/src/lessonRuns/orders/repository.ts`, `.test.ts`
- Modify: `firestore.rules`, `test/firestore.rules.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `MarketOrder`型、`createPendingOrder(deps): Promise<{ orderId: string; created: boolean }>`、`getOrder(deps): Promise<MarketOrder | null>`、`listPendingOrdersForBatch(deps): Promise<MarketOrder[]>`、`transitionOrderStatus(deps): Promise<void>`

- [ ] **Step 1: `MarketOrder`型を定義する**

`functions/src/market/orderTypes.ts`:

```ts
export type OrderStatus = 'PENDING' | 'CANCELLED' | 'PROCESSING' | 'FILLED' | 'REJECTED'

export interface MarketOrder {
  orderId: string
  idempotencyKey: string
  lessonRunId: string
  batchId: string
  participantId?: string
  teamId: string
  stockId: string
  side: 'BUY' | 'SELL'
  quantity: number
  referencePrice: number
  status: OrderStatus
  submittedAtServerMillis: number
  settledAtServerMillis?: number
  executionPrice?: number
  rejectionReason?: string
}
```

- [ ] **Step 2: 冪等な注文作成の失敗するテストを書く**

`functions/src/lessonRuns/orders/repository.test.ts`（Phase A `functions/src/lessonRuns/createLessonRun.test.ts`と同じ`makeFakeFirestore`パターンを流用する）:

```ts
import { describe, expect, it } from 'vitest'
import { createPendingOrder, listPendingOrdersForBatch, transitionOrderStatus } from './repository'

const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    runTransaction: async (fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      set: (path: string, data: Record<string, unknown>) => void
      update: (path: string, data: Record<string, unknown>) => void
    }) => Promise<unknown>) => fn({
      get: async (path: string) => ({ exists: docs.has(path), data: () => docs.get(path) }),
      set: (path: string, data: Record<string, unknown>) => { docs.set(path, data) },
      update: (path: string, data: Record<string, unknown>) => {
        const existing = docs.get(path) ?? {}
        docs.set(path, { ...existing, ...data })
      },
    }),
    query: (batchId: string, status: string) => Array.from(docs.entries())
      .filter(([path, data]) => path.includes('/orders/') && data.batchId === batchId && data.status === status)
      .map(([, data]) => data),
  }
}

describe('createPendingOrder', () => {
  it('creates a PENDING order and soft-locks nothing itself (Task 6 owns locking)', async () => {
    const fake = makeFakeFirestore()
    const result = await createPendingOrder({
      firestore: fake as never, lessonRunId: 'run-1', batchId: 'batch-3',
      teamId: 'team-a', stockId: 'acme', side: 'BUY', quantity: 5, referencePrice: 1000,
      idempotencyKey: 'order-idem-1', now: () => 1000,
    })
    expect(result.created).toBe(true)
    expect(fake.docs.get(`lessonRuns/run-1/orders/${result.orderId}`)).toMatchObject({
      status: 'PENDING', batchId: 'batch-3', side: 'BUY', quantity: 5,
    })
  })

  it('is idempotent per idempotencyKey: a retried submission does not create a second order', async () => {
    const fake = makeFakeFirestore()
    const input = {
      firestore: fake as never, lessonRunId: 'run-1', batchId: 'batch-3',
      teamId: 'team-a', stockId: 'acme', side: 'BUY' as const, quantity: 5, referencePrice: 1000,
      idempotencyKey: 'order-idem-1', now: () => 1000,
    }
    const first = await createPendingOrder(input)
    const second = await createPendingOrder(input)
    expect(second.orderId).toBe(first.orderId)
    expect(second.created).toBe(false)
  })
})

describe('transitionOrderStatus', () => {
  it('moves PENDING to CANCELLED and records no execution price', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1/orders/order-1', { status: 'PENDING', orderId: 'order-1' })
    await transitionOrderStatus({
      firestore: fake as never, lessonRunId: 'run-1', orderId: 'order-1',
      from: 'PENDING', to: 'CANCELLED',
    })
    expect(fake.docs.get('lessonRuns/run-1/orders/order-1')).toMatchObject({ status: 'CANCELLED' })
  })

  it('refuses to transition an order that is not in the expected `from` status', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1/orders/order-1', { status: 'PROCESSING', orderId: 'order-1' })
    await expect(transitionOrderStatus({
      firestore: fake as never, lessonRunId: 'run-1', orderId: 'order-1',
      from: 'PENDING', to: 'CANCELLED',
    })).rejects.toThrow('注文の状態が想定と異なります')
  })
})
```

- [ ] **Step 3: 失敗を確認する**

Run: `cd functions && npx vitest run src/lessonRuns/orders/repository.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: リポジトリを実装する**

`functions/src/lessonRuns/orders/repository.ts`:

```ts
import type { MarketOrder, OrderStatus } from '../../market/orderTypes'

export interface FirestoreTx {
  get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
  set: (path: string, data: Record<string, unknown>) => void
  update: (path: string, data: Record<string, unknown>) => void
}
export interface FirestoreLike {
  runTransaction: (fn: (tx: FirestoreTx) => Promise<unknown>) => Promise<unknown>
}

export interface CreatePendingOrderInput {
  firestore: FirestoreLike
  lessonRunId: string
  batchId: string
  teamId: string
  participantId?: string
  stockId: string
  side: 'BUY' | 'SELL'
  quantity: number
  referencePrice: number
  idempotencyKey: string
  now: () => number
}

/**
 * Idempotent per (lessonRunId, idempotencyKey) — spec §12.13. A lookup
 * document records which orderId a given key already produced, the same
 * pattern Phase A's createLessonRun/appendLessonEvent use.
 */
export const createPendingOrder = async (
  input: CreatePendingOrderInput,
): Promise<{ orderId: string; created: boolean }> => {
  const result = await input.firestore.runTransaction(async (tx) => {
    const idempotencyPath = `lessonRuns/${input.lessonRunId}/orderIdempotency/${input.idempotencyKey}`
    const existing = await tx.get(idempotencyPath)
    if (existing.exists) {
      const prior = existing.data() as { orderId: string }
      return { orderId: prior.orderId, created: false }
    }
    const orderId = `${input.lessonRunId}_order_${input.idempotencyKey}`
    const order: MarketOrder = {
      orderId, idempotencyKey: input.idempotencyKey, lessonRunId: input.lessonRunId,
      batchId: input.batchId, participantId: input.participantId, teamId: input.teamId,
      stockId: input.stockId, side: input.side, quantity: input.quantity,
      referencePrice: input.referencePrice, status: 'PENDING',
      submittedAtServerMillis: input.now(),
    }
    tx.set(`lessonRuns/${input.lessonRunId}/orders/${orderId}`, order as unknown as Record<string, unknown>)
    tx.set(idempotencyPath, { orderId })
    return { orderId, created: true }
  })
  return result as { orderId: string; created: boolean }
}

export interface TransitionOrderStatusInput {
  firestore: FirestoreLike
  lessonRunId: string
  orderId: string
  from: OrderStatus
  to: OrderStatus
  patch?: Partial<MarketOrder>
}

/** Guards every status change with a compare-and-set on `from` so a
 * concurrent settle and a concurrent cancel can never both succeed. */
export const transitionOrderStatus = async (input: TransitionOrderStatusInput): Promise<void> => {
  await input.firestore.runTransaction(async (tx) => {
    const path = `lessonRuns/${input.lessonRunId}/orders/${input.orderId}`
    const snap = await tx.get(path)
    if (!snap.exists) throw new Error('注文が見つかりません')
    const current = snap.data() as { status: OrderStatus }
    if (current.status !== input.from) throw new Error('注文の状態が想定と異なります')
    tx.update(path, { status: input.to, ...(input.patch ?? {}) })
  })
}
```

- [ ] **Step 5: `listPendingOrdersForBatch`の失敗するテストを書く**

`functions/src/lessonRuns/orders/repository.test.ts`に追記する:

```ts
describe('listPendingOrdersForBatch', () => {
  it('returns only PENDING orders for the given batchId, ignoring other batches and statuses', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1/orders/o1', { orderId: 'o1', batchId: 'batch-3', status: 'PENDING' })
    fake.docs.set('lessonRuns/run-1/orders/o2', { orderId: 'o2', batchId: 'batch-3', status: 'CANCELLED' })
    fake.docs.set('lessonRuns/run-1/orders/o3', { orderId: 'o3', batchId: 'batch-2', status: 'PENDING' })
    const result = await listPendingOrdersForBatch({
      firestore: fake as never, lessonRunId: 'run-1', batchId: 'batch-3',
    })
    expect(result.map((o) => o.orderId)).toEqual(['o1'])
  })
})
```

`listPendingOrdersForBatch`の実装（Admin SDK版はFirestoreの`where('batchId','==',...).where('status','==','PENDING')`クエリを使う。ここではテスト用に注入可能な`FirestoreLike`を拡張する）:

```ts
export interface QueryableFirestoreLike extends FirestoreLike {
  queryOrders: (lessonRunId: string, batchId: string, status: OrderStatus) => Promise<MarketOrder[]>
}

export const listPendingOrdersForBatch = async (input: {
  firestore: QueryableFirestoreLike
  lessonRunId: string
  batchId: string
}): Promise<MarketOrder[]> => input.firestore.queryOrders(input.lessonRunId, input.batchId, 'PENDING')
```

（テスト内の`makeFakeFirestore`に`queryOrders`を追加し、上記の`query`ヘルパーと同じフィルタ条件で実装する。実際のAdmin SDK実装はTask 9のAdmin SDKラッパーで`db.collection('lessonRuns').doc(lessonRunId).collection('orders').where('batchId','==',batchId).where('status','==','PENDING').get()`として与える。）

- [ ] **Step 6: テストを通す**

Run: `cd functions && npx vitest run src/lessonRuns/orders/repository.test.ts`
Expected: PASS

- [ ] **Step 7: `firestore.rules`へ`orders`サブコレクションを追加する（クライアント書き込み禁止）**

`test/firestore.rules.test.ts`に追記する:

```ts
describe('lessonRuns orders subcollection is Functions-only', () => {
  it('rejects a direct client write to an order, even by the primary teacher', async () => {
    const owner = testEnv.authenticatedContext('teacher-a', teacherToken).firestore()
    await assertFails(setDoc(doc(owner, 'lessonRuns', 'run-1', 'orders', 'order-x'), {
      status: 'FILLED', executionPrice: 999999,
    }))
  })
})
```

`firestore.rules`の`lessonRuns/{lessonRunId}`配下に追加する:

```
match /orders/{orderId} {
  allow read: if false; // 生徒はRTDB lessonRunTeamState経由（Task 13）、教師はCallable経由。直接読取は許可しない。
  allow write: if false; // createPendingOrder/transitionOrderStatusはAdmin SDK専用。
}
match /orderIdempotency/{key} {
  allow read, write: if false;
}
```

- [ ] **Step 8: ルールテストを通す**

Run: `npm run test:rules`
Expected: PASS

- [ ] **Step 9: `npm run verify`**

- [ ] **Step 10: Commit**

```bash
git add functions/src/market/orderTypes.ts functions/src/lessonRuns/orders/repository.ts \
  functions/src/lessonRuns/orders/repository.test.ts firestore.rules test/firestore.rules.test.ts
git commit -m "feat: add MarketOrder type and idempotent Firestore order repository"
```

---

### Task 6: 資金・株の拘束（ソフト/ハード2段階）

矛盾解消B・統合仕様書 §12.15・§12.16を実装する。純粋関数のみのタスク（I/OはTask 7・Task 9が行う）。**買いの不足判定は全銘柄合計・現金基準（現金は銘柄をまたいで共有される）で行い、売りの不足判定は銘柄ごと・保有株基準（株は銘柄ごとに別物）で行う**——この非対称性を取り違えるとバグになるため、テストで両方を別々に固定する。ハード判定に使う現金は「この区間の売却代金を含まない」区間開始時点の現金とする（§12.15「同一区間で得る売却代金は、その区間の購入には使えない」）。

**Files:**
- Create: `functions/src/market/engine/fundLocking.ts`, `.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `computeAvailableCash(cash, lockedBuyValue)`、`computeAvailableShares(held, lockedSellQuantity)`、`hardCheckBuyOrders(input)`、`hardCheckSellOrdersForStock(input)`

- [ ] **Step 1: ソフト拘束（注文送信時の表示用計算）の失敗するテストを書く**

`functions/src/market/engine/fundLocking.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { computeAvailableCash, computeAvailableShares, hardCheckBuyOrders, hardCheckSellOrdersForStock } from './fundLocking'

describe('computeAvailableCash', () => {
  it('matches the spec §12.16 display example: 20,000 cash - 6,000 locked = 14,000 available', () => {
    expect(computeAvailableCash(20000, 6000)).toBe(14000)
  })
})

describe('computeAvailableShares', () => {
  it('matches the spec §12.16 display example: 10 held - 4 locked = 6 available', () => {
    expect(computeAvailableShares(10, 4)).toBe(6)
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/market/engine/fundLocking.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: ソフト拘束関数を実装する**

`functions/src/market/engine/fundLocking.ts`:

```ts
/** Spec §12.16 display: "利用可能現金 = 現金 − 拘束中の買い注文額（参考価格ベース）". */
export const computeAvailableCash = (cash: number, lockedBuyValueAtReferencePrice: number): number =>
  cash - lockedBuyValueAtReferencePrice

/** Spec §12.16 display: "追加売却可能 = 保有 − 売却注文中". */
export const computeAvailableShares = (heldShares: number, lockedSellQuantity: number): number =>
  heldShares - lockedSellQuantity
```

- [ ] **Step 4: テストを通す**

Run: `cd functions && npx vitest run src/market/engine/fundLocking.test.ts`
Expected: PASS（ソフト拘束のテストのみ）

- [ ] **Step 5: ハード判定の失敗するテストを書く（買い=全銘柄合計、売り=銘柄ごと、の非対称性を固定する）**

`functions/src/market/engine/fundLocking.test.ts`に追記する:

```ts
describe('hardCheckBuyOrders', () => {
  it('sums BUY orders ACROSS ALL STOCKS against a single cash balance (spec §12.15 "複数銘柄を含む買い注文合計を一括判定する")', () => {
    const result = hardCheckBuyOrders({
      cashBeforeBatch: 10000,
      buyOrders: [
        { stockId: 'acme', quantity: 3, executionPrice: 1000 }, // 3,000
        { stockId: 'globex', quantity: 5, executionPrice: 1500 }, // 7,500
      ],
    })
    expect(result.totalCost).toBe(10500)
    expect(result.allSucceed).toBe(false) // 10,500 > 10,000 cash — ALL buy orders (both stocks) fail
  })

  it('excludes this batch\'s own sell proceeds from the cash basis (spec §12.15 "同一区間で得る売却代金は、その区間の購入には使えない")', () => {
    // cashBeforeBatch already reflects "no same-batch sell proceeds" —
    // this test documents that the caller (Task 9) must pass the
    // pre-batch balance, not balance-after-applying-this-batch's-sells.
    const result = hardCheckBuyOrders({
      cashBeforeBatch: 3000, // caller did NOT add this batch's sell proceeds here
      buyOrders: [{ stockId: 'acme', quantity: 3, executionPrice: 1000 }],
    })
    expect(result.allSucceed).toBe(true)
    expect(result.totalCost).toBe(3000)
  })
})

describe('hardCheckSellOrdersForStock', () => {
  it('checks SELL orders PER STOCK against that stock\'s held shares only (spec §12.15 "その区間の当該売り注文をすべて不成立")', () => {
    const result = hardCheckSellOrdersForStock({
      heldShares: 5,
      sellOrders: [{ stockId: 'acme', quantity: 3 }, { stockId: 'acme', quantity: 4 }],
    })
    expect(result.totalQuantity).toBe(7)
    expect(result.allSucceed).toBe(false) // 7 > 5 held shares of THIS stock
  })

  it('does not let a shortfall in one stock affect a different stock\'s sell check (caller must call this once per stock)', () => {
    const acmeResult = hardCheckSellOrdersForStock({ heldShares: 2, sellOrders: [{ stockId: 'acme', quantity: 5 }] })
    const globexResult = hardCheckSellOrdersForStock({ heldShares: 10, sellOrders: [{ stockId: 'globex', quantity: 5 }] })
    expect(acmeResult.allSucceed).toBe(false)
    expect(globexResult.allSucceed).toBe(true)
  })
})
```

- [ ] **Step 6: 失敗を確認する**

Run: `cd functions && npx vitest run src/market/engine/fundLocking.test.ts`
Expected: FAIL — `hardCheckBuyOrders`/`hardCheckSellOrdersForStock` not exported

- [ ] **Step 7: ハード判定関数を実装する**

`functions/src/market/engine/fundLocking.ts`に追記する:

```ts
export interface BuyOrderForSettlement {
  stockId: string
  quantity: number
  executionPrice: number
}

export interface HardBuyCheckInput {
  /** Cash balance BEFORE this batch's fills — must NOT include proceeds
   * from this same batch's sell orders (spec §12.15). */
  cashBeforeBatch: number
  buyOrders: BuyOrderForSettlement[]
}

export interface HardCheckResult {
  allSucceed: boolean
  totalCost: number
}

/** All BUY orders across ALL stocks share one cash pool — checked together. */
export const hardCheckBuyOrders = (input: HardBuyCheckInput): HardCheckResult => {
  const totalCost = input.buyOrders.reduce((sum, o) => sum + o.quantity * o.executionPrice, 0)
  return { allSucceed: totalCost <= input.cashBeforeBatch, totalCost }
}

export interface SellOrderForSettlement {
  stockId: string
  quantity: number
}

export interface HardSellCheckInput {
  heldShares: number
  /** Must already be filtered to a single stockId by the caller (Task 9) —
   * shares of different stocks are not fungible, unlike cash. */
  sellOrders: SellOrderForSettlement[]
}

export interface HardSellCheckResult {
  allSucceed: boolean
  totalQuantity: number
}

/** Called once PER STOCK — see the module doc comment on the asymmetry
 * with hardCheckBuyOrders. */
export const hardCheckSellOrdersForStock = (input: HardSellCheckInput): HardSellCheckResult => {
  const totalQuantity = input.sellOrders.reduce((sum, o) => sum + o.quantity, 0)
  return { allSucceed: totalQuantity <= input.heldShares, totalQuantity }
}
```

- [ ] **Step 8: テストを通す**

Run: `cd functions && npx vitest run src/market/engine/fundLocking.test.ts`
Expected: PASS

- [ ] **Step 9: `npm run verify`**

- [ ] **Step 10: Commit**

```bash
git add functions/src/market/engine/fundLocking.ts functions/src/market/engine/fundLocking.test.ts
git commit -m "feat: add two-stage (soft/hard) fund and share locking per spec resolution B"
```

---

### Task 7: 注文送信Callable

統合仕様書 §12.13（冪等性）・§12.16（注文中資金・株の拘束、送信時のソフト拘束）・§12.25（停止後は新規注文拒否）を実装する。ここで初めて「チーム別の現金・保有株の台帳」が必要になるため、本タスクで`TeamAccount`（Firestore正本）を導入する。**Firestoreが正本、RTDB`lessonRunTeamState`（Task 13）はその実時間ミラー**という構成にする——Phase Aの`orgAccess`（RTDBがFirestoreメンバーシップをミラーする）と同じ「Firestoreトランザクションで整合性を取り、RTDBは読み取り専用の実時間コピー」というパターンを踏襲する。

**Files:**
- Create: `functions/src/lessonRuns/teamAccounts/types.ts`
- Create: `functions/src/lessonRuns/teamAccounts/repository.ts`, `.test.ts`
- Create: `functions/src/market/submitOrder.ts`, `.test.ts`, `onCall.ts`
- Create: `src/lib/market/submitOrder.ts`, `.test.ts`（クライアントラッパー）

**Interfaces:**
- Consumes: `createPendingOrder`（Task 5）、`computeAvailableCash`/`computeAvailableShares`（Task 6）
- Produces: `TeamAccount`型、`getOrInitTeamAccount(deps)`、`applySoftLockForNewOrder(deps): Promise<{ accepted: true } | { accepted: false; reason: string }>`、`submitOrder(deps): Promise<{ orderId: string; created: boolean }>`、`submitOrderCallable`、クライアント`submitOrder(functions, input)`

- [ ] **Step 1: `TeamAccount`型を定義する**

`functions/src/lessonRuns/teamAccounts/types.ts`:

```ts
export interface TeamAccount {
  teamId: string
  lessonRunId: string
  cash: number
  /** stockId → quantity held. */
  holdings: Record<string, number>
  /** Sum of PENDING/PROCESSING buy orders at reference price, across all
   * stocks — spec §12.16's "注文中資金" (soft lock, cash is fungible). */
  lockedBuyValue: number
  /** stockId → quantity locked by PENDING/PROCESSING sell orders of that
   * stock — shares are not fungible across stocks, unlike cash. */
  lockedSellQuantity: Record<string, number>
  updatedAtServerMillis: number
}
```

- [ ] **Step 2: ソフト拘束適用の失敗するテストを書く**

`functions/src/lessonRuns/teamAccounts/repository.test.ts`（`makeFakeFirestore`はTask 5のものと同じ構造を再定義する）:

```ts
import { describe, expect, it } from 'vitest'
import { applySoftLockForNewOrder, getOrInitTeamAccount } from './repository'

const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    runTransaction: async (fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      set: (path: string, data: Record<string, unknown>) => void
    }) => Promise<unknown>) => fn({
      get: async (path: string) => ({ exists: docs.has(path), data: () => docs.get(path) }),
      set: (path: string, data: Record<string, unknown>) => { docs.set(path, data) },
    }),
  }
}

describe('getOrInitTeamAccount', () => {
  it('initializes a new account with the starting cash and no holdings', async () => {
    const fake = makeFakeFirestore()
    const account = await getOrInitTeamAccount({
      firestore: fake as never, lessonRunId: 'run-1', teamId: 'team-a', startingCash: 100000, now: () => 1,
    })
    expect(account).toMatchObject({ cash: 100000, holdings: {}, lockedBuyValue: 0, lockedSellQuantity: {} })
  })
})

describe('applySoftLockForNewOrder', () => {
  it('accepts a buy order within available cash and increases lockedBuyValue', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1/teamAccounts/team-a', {
      teamId: 'team-a', lessonRunId: 'run-1', cash: 20000, holdings: {},
      lockedBuyValue: 6000, lockedSellQuantity: {}, updatedAtServerMillis: 0,
    })
    // available = 20,000 - 6,000 = 14,000 (spec §12.16 example) — a 5,000 order fits
    const result = await applySoftLockForNewOrder({
      firestore: fake as never, lessonRunId: 'run-1', teamId: 'team-a',
      side: 'BUY', stockId: 'acme', quantity: 5, referencePrice: 1000, now: () => 1,
    })
    expect(result).toEqual({ accepted: true })
    expect(fake.docs.get('lessonRuns/run-1/teamAccounts/team-a')).toMatchObject({ lockedBuyValue: 11000 })
  })

  it('rejects a buy order that would exceed available cash, without mutating the account', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1/teamAccounts/team-a', {
      teamId: 'team-a', lessonRunId: 'run-1', cash: 20000, holdings: {},
      lockedBuyValue: 6000, lockedSellQuantity: {}, updatedAtServerMillis: 0,
    })
    // available = 14,000 — a 20-share order at 1,000 = 20,000 exceeds it
    const result = await applySoftLockForNewOrder({
      firestore: fake as never, lessonRunId: 'run-1', teamId: 'team-a',
      side: 'BUY', stockId: 'acme', quantity: 20, referencePrice: 1000, now: () => 1,
    })
    expect(result).toEqual({ accepted: false, reason: '利用可能現金が不足しています。' })
    expect(fake.docs.get('lessonRuns/run-1/teamAccounts/team-a')).toMatchObject({ lockedBuyValue: 6000 })
  })

  it('rejects a sell order that would exceed available shares of that stock', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1/teamAccounts/team-a', {
      teamId: 'team-a', lessonRunId: 'run-1', cash: 0, holdings: { acme: 10 },
      lockedBuyValue: 0, lockedSellQuantity: { acme: 4 }, updatedAtServerMillis: 0,
    })
    // available = 10 - 4 = 6 (spec §12.16 example) — selling 7 exceeds it
    const result = await applySoftLockForNewOrder({
      firestore: fake as never, lessonRunId: 'run-1', teamId: 'team-a',
      side: 'SELL', stockId: 'acme', quantity: 7, referencePrice: 1000, now: () => 1,
    })
    expect(result).toEqual({ accepted: false, reason: '売却可能株数が不足しています。' })
  })
})
```

- [ ] **Step 3: 失敗を確認する**

Run: `cd functions && npx vitest run src/lessonRuns/teamAccounts/repository.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: リポジトリを実装する**

`functions/src/lessonRuns/teamAccounts/repository.ts`:

```ts
import { computeAvailableCash, computeAvailableShares } from '../../market/engine/fundLocking'
import type { TeamAccount } from './types'

export interface FirestoreTx {
  get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
  set: (path: string, data: Record<string, unknown>) => void
}
export interface FirestoreLike {
  runTransaction: (fn: (tx: FirestoreTx) => Promise<unknown>) => Promise<unknown>
}

const accountPath = (lessonRunId: string, teamId: string) => `lessonRuns/${lessonRunId}/teamAccounts/${teamId}`

export const getOrInitTeamAccount = async (input: {
  firestore: FirestoreLike; lessonRunId: string; teamId: string; startingCash: number; now: () => number
}): Promise<TeamAccount> => {
  return input.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(accountPath(input.lessonRunId, input.teamId))
    if (snap.exists) return snap.data() as unknown as TeamAccount
    const account: TeamAccount = {
      teamId: input.teamId, lessonRunId: input.lessonRunId, cash: input.startingCash,
      holdings: {}, lockedBuyValue: 0, lockedSellQuantity: {}, updatedAtServerMillis: input.now(),
    }
    tx.set(accountPath(input.lessonRunId, input.teamId), account as unknown as Record<string, unknown>)
    return account
  }) as Promise<TeamAccount>
}

export interface ApplySoftLockInput {
  firestore: FirestoreLike
  lessonRunId: string
  teamId: string
  side: 'BUY' | 'SELL'
  stockId: string
  quantity: number
  referencePrice: number
  now: () => number
}
export type ApplySoftLockResult = { accepted: true } | { accepted: false; reason: string }

/** Spec §12.16: soft-locks at the reference price on submission. Rejection
 * here means the order is never created — "注文を受け付けない（UIで防ぐ）",
 * reinforced server-side as defense in depth. */
export const applySoftLockForNewOrder = async (input: ApplySoftLockInput): Promise<ApplySoftLockResult> => {
  return input.firestore.runTransaction(async (tx) => {
    const path = accountPath(input.lessonRunId, input.teamId)
    const snap = await tx.get(path)
    const account = snap.data() as unknown as TeamAccount
    if (input.side === 'BUY') {
      const available = computeAvailableCash(account.cash, account.lockedBuyValue)
      const cost = input.quantity * input.referencePrice
      if (cost > available) return { accepted: false, reason: '利用可能現金が不足しています。' }
      tx.set(path, { ...account, lockedBuyValue: account.lockedBuyValue + cost, updatedAtServerMillis: input.now() } as unknown as Record<string, unknown>)
      return { accepted: true }
    }
    const heldShares = account.holdings[input.stockId] ?? 0
    const lockedShares = account.lockedSellQuantity[input.stockId] ?? 0
    const available = computeAvailableShares(heldShares, lockedShares)
    if (input.quantity > available) return { accepted: false, reason: '売却可能株数が不足しています。' }
    tx.set(path, {
      ...account,
      lockedSellQuantity: { ...account.lockedSellQuantity, [input.stockId]: lockedShares + input.quantity },
      updatedAtServerMillis: input.now(),
    } as unknown as Record<string, unknown>)
    return { accepted: true }
  }) as Promise<ApplySoftLockResult>
}
```

- [ ] **Step 5: テストを通す**

Run: `cd functions && npx vitest run src/lessonRuns/teamAccounts/repository.test.ts`
Expected: PASS

- [ ] **Step 6: `submitOrder`の失敗するテストを書く（市場停止中は拒否することを含む）**

`functions/src/market/submitOrder.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { submitOrder } from './submitOrder'

describe('submitOrder', () => {
  it('rejects when the market is paused (spec §12.25)', async () => {
    const applySoftLock = vi.fn()
    const createOrder = vi.fn()
    await expect(submitOrder({
      isMarketAcceptingOrders: () => false,
      applySoftLock, createOrder,
      lessonRunId: 'run-1', batchId: 'batch-3', teamId: 'team-a', stockId: 'acme',
      side: 'BUY', quantity: 5, referencePrice: 1000, idempotencyKey: 'idem-1',
    })).rejects.toThrow('市場は停止中です')
    expect(applySoftLock).not.toHaveBeenCalled()
    expect(createOrder).not.toHaveBeenCalled()
  })

  it('creates the order only after the soft lock is accepted', async () => {
    const applySoftLock = vi.fn().mockResolvedValue({ accepted: true })
    const createOrder = vi.fn().mockResolvedValue({ orderId: 'order-1', created: true })
    const result = await submitOrder({
      isMarketAcceptingOrders: () => true,
      applySoftLock, createOrder,
      lessonRunId: 'run-1', batchId: 'batch-3', teamId: 'team-a', stockId: 'acme',
      side: 'BUY', quantity: 5, referencePrice: 1000, idempotencyKey: 'idem-1',
    })
    expect(result).toEqual({ orderId: 'order-1', created: true })
    expect(applySoftLock).toHaveBeenCalledBefore(createOrder as never)
  })

  it('propagates a soft-lock rejection without creating an order', async () => {
    const applySoftLock = vi.fn().mockResolvedValue({ accepted: false, reason: '利用可能現金が不足しています。' })
    const createOrder = vi.fn()
    await expect(submitOrder({
      isMarketAcceptingOrders: () => true,
      applySoftLock, createOrder,
      lessonRunId: 'run-1', batchId: 'batch-3', teamId: 'team-a', stockId: 'acme',
      side: 'BUY', quantity: 5, referencePrice: 1000, idempotencyKey: 'idem-1',
    })).rejects.toThrow('利用可能現金が不足しています。')
    expect(createOrder).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 7: 失敗を確認する**

Run: `cd functions && npx vitest run src/market/submitOrder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 8: `submitOrder`を実装する**

`functions/src/market/submitOrder.ts`:

```ts
export interface SubmitOrderDeps {
  isMarketAcceptingOrders: () => boolean
  applySoftLock: (input: {
    lessonRunId: string; teamId: string; side: 'BUY' | 'SELL'; stockId: string
    quantity: number; referencePrice: number
  }) => Promise<{ accepted: true } | { accepted: false; reason: string }>
  createOrder: (input: {
    lessonRunId: string; batchId: string; teamId: string; stockId: string
    side: 'BUY' | 'SELL'; quantity: number; referencePrice: number; idempotencyKey: string
  }) => Promise<{ orderId: string; created: boolean }>
  lessonRunId: string
  batchId: string
  teamId: string
  stockId: string
  side: 'BUY' | 'SELL'
  quantity: number
  referencePrice: number
  idempotencyKey: string
}

export const submitOrder = async (deps: SubmitOrderDeps): Promise<{ orderId: string; created: boolean }> => {
  if (!deps.isMarketAcceptingOrders()) throw new Error('市場は停止中です。新規注文は受け付けられません。')

  const lockResult = await deps.applySoftLock({
    lessonRunId: deps.lessonRunId, teamId: deps.teamId, side: deps.side,
    stockId: deps.stockId, quantity: deps.quantity, referencePrice: deps.referencePrice,
  })
  if (!lockResult.accepted) throw new Error(lockResult.reason)

  return deps.createOrder({
    lessonRunId: deps.lessonRunId, batchId: deps.batchId, teamId: deps.teamId,
    stockId: deps.stockId, side: deps.side, quantity: deps.quantity,
    referencePrice: deps.referencePrice, idempotencyKey: deps.idempotencyKey,
  })
}
```

`isMarketAcceptingOrders`の実装（Admin SDKラッパー）は`lessonRuns/{id}.status === 'RUNNING' && !marketPaused`を読む。`marketPaused`はTask 11で追加する。

- [ ] **Step 9: テストを通す**

Run: `cd functions && npx vitest run src/market/submitOrder.test.ts`
Expected: PASS

- [ ] **Step 10: `onCall.ts`とクライアントラッパーを実装する**

Phase A Task 7の`createLessonRunCallable`と同じ構成: `functions/src/market/onCall.ts`で`submitOrderCallable`を定義し（認証必須、`request.auth.uid`がそのチームのメンバーであることをFirestore`lessonRunTeamMembers`等——Phase Bが提供する実際のチーム帰属チェック手段に差し替える。前提チェックリスト参照——で確認してから`submitOrder`を呼ぶ)、`src/lib/market/submitOrder.ts`で`httpsCallable(functions, 'submitOrder')`をラップする。パターンはPhase A Task 7 Step 6と同一のため実装時はそのコードを踏襲する。

- [ ] **Step 11: `npm run verify`**

- [ ] **Step 12: Commit**

```bash
git add functions/src/lessonRuns/teamAccounts functions/src/market/submitOrder.ts \
  functions/src/market/submitOrder.test.ts functions/src/market/onCall.ts \
  src/lib/market/submitOrder.ts src/lib/market/submitOrder.test.ts
git commit -m "feat: add TeamAccount ledger and submitOrder Callable with soft locking"
```

---

### Task 8: 注文取消Callable

統合仕様書 §12.17を実装する。`PENDING`中のみ取消可能。取消時に拘束資金・株を即時解放する。`区間締切後、PROCESSINGへ移ったら取消不可`——Task 5の`transitionOrderStatus`が`from: 'PENDING'`を要求する compare-and-set のおかげで、バッチ処理（Task 9）が注文を`PROCESSING`へ移した直後に生徒が取消を送っても、片方が失敗して二重処理にならない。

**Files:**
- Modify: `functions/src/lessonRuns/teamAccounts/repository.ts`, `.test.ts`（`releaseSoftLock`を追加）
- Create: `functions/src/market/cancelOrder.ts`, `.test.ts`, `onCall.ts`
- Create: `src/lib/market/cancelOrder.ts`, `.test.ts`

**Interfaces:**
- Consumes: `transitionOrderStatus`（Task 5）、`TeamAccount`（Task 7）
- Produces: `releaseSoftLock(deps)`、`cancelOrder(deps): Promise<void>`、`cancelOrderCallable`

- [ ] **Step 1: `releaseSoftLock`の失敗するテストを書く**

`functions/src/lessonRuns/teamAccounts/repository.test.ts`に追記する:

```ts
describe('releaseSoftLock', () => {
  it('reduces lockedBuyValue by exactly the cancelled order\'s reference-price value', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1/teamAccounts/team-a', {
      teamId: 'team-a', lessonRunId: 'run-1', cash: 20000, holdings: {},
      lockedBuyValue: 11000, lockedSellQuantity: {}, updatedAtServerMillis: 0,
    })
    await releaseSoftLock({
      firestore: fake as never, lessonRunId: 'run-1', teamId: 'team-a',
      side: 'BUY', stockId: 'acme', quantity: 5, referencePrice: 1000, now: () => 2,
    })
    expect(fake.docs.get('lessonRuns/run-1/teamAccounts/team-a')).toMatchObject({ lockedBuyValue: 6000 })
  })

  it('reduces lockedSellQuantity for that stock only', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1/teamAccounts/team-a', {
      teamId: 'team-a', lessonRunId: 'run-1', cash: 0, holdings: { acme: 10 },
      lockedBuyValue: 0, lockedSellQuantity: { acme: 4, globex: 2 }, updatedAtServerMillis: 0,
    })
    await releaseSoftLock({
      firestore: fake as never, lessonRunId: 'run-1', teamId: 'team-a',
      side: 'SELL', stockId: 'acme', quantity: 4, referencePrice: 1000, now: () => 2,
    })
    expect(fake.docs.get('lessonRuns/run-1/teamAccounts/team-a')).toMatchObject({
      lockedSellQuantity: { acme: 0, globex: 2 },
    })
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/lessonRuns/teamAccounts/repository.test.ts`
Expected: FAIL — `releaseSoftLock` not exported

- [ ] **Step 3: `releaseSoftLock`を実装する**

`functions/src/lessonRuns/teamAccounts/repository.ts`に追記する:

```ts
export interface ReleaseSoftLockInput {
  firestore: FirestoreLike
  lessonRunId: string
  teamId: string
  side: 'BUY' | 'SELL'
  stockId: string
  quantity: number
  referencePrice: number
  now: () => number
}

/** Inverse of applySoftLockForNewOrder — used on cancel (Task 8) and after
 * hard settlement replaces the soft lock with the real outcome (Task 9). */
export const releaseSoftLock = async (input: ReleaseSoftLockInput): Promise<void> => {
  await input.firestore.runTransaction(async (tx) => {
    const path = accountPath(input.lessonRunId, input.teamId)
    const snap = await tx.get(path)
    const account = snap.data() as unknown as TeamAccount
    if (input.side === 'BUY') {
      tx.set(path, {
        ...account,
        lockedBuyValue: account.lockedBuyValue - input.quantity * input.referencePrice,
        updatedAtServerMillis: input.now(),
      } as unknown as Record<string, unknown>)
      return
    }
    const currentLocked = account.lockedSellQuantity[input.stockId] ?? 0
    tx.set(path, {
      ...account,
      lockedSellQuantity: { ...account.lockedSellQuantity, [input.stockId]: currentLocked - input.quantity },
      updatedAtServerMillis: input.now(),
    } as unknown as Record<string, unknown>)
  })
}
```

- [ ] **Step 4: テストを通す**

Run: `cd functions && npx vitest run src/lessonRuns/teamAccounts/repository.test.ts`
Expected: PASS

- [ ] **Step 5: `cancelOrder`の失敗するテストを書く**

`functions/src/market/cancelOrder.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { cancelOrder } from './cancelOrder'

describe('cancelOrder', () => {
  it('releases the soft lock and transitions the order to CANCELLED, in that order', async () => {
    const releaseSoftLock = vi.fn()
    const transition = vi.fn()
    await cancelOrder({
      getOrder: async () => ({
        orderId: 'order-1', status: 'PENDING' as const, side: 'BUY' as const,
        stockId: 'acme', quantity: 5, referencePrice: 1000, teamId: 'team-a', lessonRunId: 'run-1',
      }),
      releaseSoftLock, transition,
      lessonRunId: 'run-1', orderId: 'order-1',
    })
    expect(releaseSoftLock).toHaveBeenCalledWith(expect.objectContaining({ quantity: 5, referencePrice: 1000 }))
    expect(transition).toHaveBeenCalledWith(expect.objectContaining({ from: 'PENDING', to: 'CANCELLED' }))
  })

  it('refuses to cancel an order that already moved to PROCESSING (spec §12.17)', async () => {
    const releaseSoftLock = vi.fn()
    const transition = vi.fn()
    await expect(cancelOrder({
      getOrder: async () => ({
        orderId: 'order-1', status: 'PROCESSING' as const, side: 'BUY' as const,
        stockId: 'acme', quantity: 5, referencePrice: 1000, teamId: 'team-a', lessonRunId: 'run-1',
      }),
      releaseSoftLock, transition,
      lessonRunId: 'run-1', orderId: 'order-1',
    })).rejects.toThrow('処理中の注文は取消できません')
    expect(releaseSoftLock).not.toHaveBeenCalled()
    expect(transition).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 6: 失敗を確認する**

Run: `cd functions && npx vitest run src/market/cancelOrder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 7: `cancelOrder`を実装する**

`functions/src/market/cancelOrder.ts`:

```ts
export interface OrderSnapshot {
  orderId: string
  status: 'PENDING' | 'CANCELLED' | 'PROCESSING' | 'FILLED' | 'REJECTED'
  side: 'BUY' | 'SELL'
  stockId: string
  quantity: number
  referencePrice: number
  teamId: string
  lessonRunId: string
}

export interface CancelOrderDeps {
  getOrder: (input: { lessonRunId: string; orderId: string }) => Promise<OrderSnapshot>
  releaseSoftLock: (input: {
    lessonRunId: string; teamId: string; side: 'BUY' | 'SELL'; stockId: string
    quantity: number; referencePrice: number
  }) => Promise<void>
  transition: (input: { lessonRunId: string; orderId: string; from: 'PENDING'; to: 'CANCELLED' }) => Promise<void>
  lessonRunId: string
  orderId: string
}

export const cancelOrder = async (deps: CancelOrderDeps): Promise<void> => {
  const order = await deps.getOrder({ lessonRunId: deps.lessonRunId, orderId: deps.orderId })
  if (order.status !== 'PENDING') throw new Error('処理中の注文は取消できません。')

  await deps.releaseSoftLock({
    lessonRunId: order.lessonRunId, teamId: order.teamId, side: order.side,
    stockId: order.stockId, quantity: order.quantity, referencePrice: order.referencePrice,
  })
  await deps.transition({ lessonRunId: deps.lessonRunId, orderId: deps.orderId, from: 'PENDING', to: 'CANCELLED' })
}
```

**注意（読み取り→判定→取消の間の競合）:** `getOrder`で読んだ直後にバッチ処理が同じ注文を`PROCESSING`へ進める可能性がある。実際の安全性は`transition`（Task 5の`transitionOrderStatus`）が`from: 'PENDING'`のcompare-and-setをFirestoreトランザクション内で行うことで担保される——`getOrder`のチェックはUXのための早期リターンに過ぎず、最終防衛線は`transition`のトランザクションである。この二段構えをコメントとして実装に残すこと。

- [ ] **Step 8: テストを通す**

Run: `cd functions && npx vitest run src/market/cancelOrder.test.ts`
Expected: PASS

- [ ] **Step 9: `onCall.ts`とクライアントラッパーを実装する（Task 7 Step 10と同一パターン）**

- [ ] **Step 10: `npm run verify`**

- [ ] **Step 11: Commit**

```bash
git add functions/src/lessonRuns/teamAccounts/repository.ts functions/src/lessonRuns/teamAccounts/repository.test.ts \
  functions/src/market/cancelOrder.ts functions/src/market/cancelOrder.test.ts functions/src/market/onCall.ts \
  src/lib/market/cancelOrder.ts src/lib/market/cancelOrder.test.ts
git commit -m "feat: add cancelOrder Callable with soft-lock release for PENDING-only cancellation"
```

---

### Task 9: バッチ締切処理の中核（検証・相殺・約定・不成立・次価格）

統合仕様書 §12.9〜§12.11・§12.14・§12.15・§12.20〜§12.22を1つの純粋関数`settleBatch`に統合する。Task 4〜6の純粋関数を組み合わせる「オーケストレーター」であり、この関数自体はI/Oを持たない——Cloud Tasksハンドラ（Task 10）が実際のFirestore/RTDB読み書きを行う薄いラッパー（`processBatch.ts`）から呼ぶ。

**設計上の要点（実装前に理解すること）:**
1. **約定価格はこの区間の「現在価格」**——注文はこの区間の締切時点で、締切前から公開されていた価格でそのまま約定する。次価格の計算は約定の**後**に行う（§12.9のフロー通り）。
2. **同一チーム・同一銘柄の相殺（§12.14）は「元注文」個々のレコードを書き換えない。** 相殺後の正味方向・数量が実際にチームの現金・保有株へ反映される唯一の値であり、個々の注文レコードは（相殺グループが成立した場合）全部`FILLED`として履歴に残る。相殺で完全に打ち消し合った場合（同数）も`FILLED`（正味の効果がゼロだっただけで、注文自体は正しく処理された）として扱う。
3. **買いの不成立は同一チームの全銘柄へ及ぶが、売りの不成立はその銘柄だけに閉じる**（Task 6の非対称性がそのままここに反映される）。
4. **不成立になった相殺グループの注文は出来高・需給のどちらにもカウントしない。** 実際に約定していない数量を価格へ反映させないため（矛盾解消C・§26-14）。

**Files:**
- Create: `functions/src/market/engine/settleBatch.ts`, `.test.ts`
- Create: `functions/src/market/processBatch.ts`, `.test.ts`

**Interfaces:**
- Consumes: `nettedFillForParticipant`/`aggregateDemand`（Task 4）、`hardCheckBuyOrders`/`hardCheckSellOrdersForStock`（Task 6）、`calculateNextPrice`（Task 3）
- Produces: `settleBatch(input): SettleBatchResult`

- [ ] **Step 1: 失敗するテストを書く（矛盾解消Bの非対称性と矛盾解消Cの操作不可能性を1つのバッチで検証する）**

`functions/src/market/engine/settleBatch.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { settleBatch } from './settleBatch'

const stock = (overrides: Partial<Parameters<typeof settleBatch>[0]['stocks'][number]> = {}) => ({
  stockId: 'acme', currentPrice: 1000, initialPrice: 1000,
  priceGuard: { type: 'ABSOLUTE' as const, minimumPrice: 1 },
  effectiveMarketSize: 100000, demandSensitivity: 1, informationImpactPercent: 0,
  ...overrides,
})

const baseInput = {
  lessonRunId: 'run-1', batchId: 'batch-3', batchIndex: 3,
  randomSeed: 'seed', restoreGeneration: 0,
  priceSensitivityPreset: 'BALANCED' as const, noiseEnabled: false,
}

describe('settleBatch', () => {
  it('fills all orders for a stock at the SAME price — the price in effect before this batch (spec §12.10)', () => {
    const result = settleBatch({
      ...baseInput,
      stocks: [stock()],
      orders: [
        { orderId: 'o1', teamId: 'team-a', stockId: 'acme', side: 'BUY', quantity: 3, referencePrice: 950 },
        { orderId: 'o2', teamId: 'team-b', stockId: 'acme', side: 'BUY', quantity: 2, referencePrice: 1050 },
      ],
      teamAccounts: [
        { teamId: 'team-a', cash: 10000, holdings: {} },
        { teamId: 'team-b', cash: 10000, holdings: {} },
      ],
    })
    expect(result.orders).toEqual([
      { orderId: 'o1', status: 'FILLED', executionPrice: 1000 },
      { orderId: 'o2', status: 'FILLED', executionPrice: 1000 },
    ])
  })

  it('nets 5 buy + 2 sell of the same stock/team into a 3-share buy, both original orders FILLED (spec §12.14)', () => {
    const result = settleBatch({
      ...baseInput,
      stocks: [stock()],
      orders: [
        { orderId: 'o1', teamId: 'team-a', stockId: 'acme', side: 'BUY', quantity: 5, referencePrice: 1000 },
        { orderId: 'o2', teamId: 'team-a', stockId: 'acme', side: 'SELL', quantity: 2, referencePrice: 1000 },
      ],
      teamAccounts: [{ teamId: 'team-a', cash: 10000, holdings: { acme: 2 } }],
    })
    expect(result.orders.every((o) => o.status === 'FILLED')).toBe(true)
    // portfolio effect reflects the NET 3-share buy only, not 5 buy + 2 sell independently
    expect(result.teamAccountUpdates).toEqual([
      { teamId: 'team-a', cashDelta: -3000, holdingsDelta: { acme: 3 } },
    ])
  })

  it('rejects ALL of a team\'s buy orders ACROSS EVERY STOCK when the aggregated cost exceeds cash (spec §12.15)', () => {
    const result = settleBatch({
      ...baseInput,
      stocks: [stock({ stockId: 'acme' }), stock({ stockId: 'globex', currentPrice: 1500 })],
      orders: [
        { orderId: 'o1', teamId: 'team-a', stockId: 'acme', side: 'BUY', quantity: 3, referencePrice: 1000 }, // 3,000
        { orderId: 'o2', teamId: 'team-a', stockId: 'globex', side: 'BUY', quantity: 5, referencePrice: 1500 }, // 7,500 → total 10,500
      ],
      teamAccounts: [{ teamId: 'team-a', cash: 10000, holdings: {} }],
    })
    expect(result.orders).toEqual(expect.arrayContaining([
      { orderId: 'o1', status: 'REJECTED', rejectionReason: expect.any(String) },
      { orderId: 'o2', status: 'REJECTED', rejectionReason: expect.any(String) },
    ]))
    expect(result.teamAccountUpdates).toEqual([])
  })

  it('a sell shortfall in one stock does not reject a healthy buy in another stock for the same team', () => {
    const result = settleBatch({
      ...baseInput,
      stocks: [stock({ stockId: 'acme' }), stock({ stockId: 'globex', currentPrice: 500 })],
      orders: [
        { orderId: 'o1', teamId: 'team-a', stockId: 'acme', side: 'SELL', quantity: 10, referencePrice: 1000 }, // only holds 2
        { orderId: 'o2', teamId: 'team-a', stockId: 'globex', side: 'BUY', quantity: 4, referencePrice: 500 }, // 2,000, affordable
      ],
      teamAccounts: [{ teamId: 'team-a', cash: 5000, holdings: { acme: 2 } }],
    })
    expect(result.orders).toEqual(expect.arrayContaining([
      { orderId: 'o1', status: 'REJECTED', rejectionReason: expect.any(String) },
      { orderId: 'o2', status: 'FILLED', executionPrice: 500 },
    ]))
    expect(result.teamAccountUpdates).toEqual([{ teamId: 'team-a', cashDelta: -2000, holdingsDelta: { globex: 4 } }])
  })

  it('excludes rejected orders from both net demand and displayed volume (矛盾解消C)', () => {
    const result = settleBatch({
      ...baseInput,
      stocks: [stock()],
      orders: [
        // team-a's buy fails (insufficient cash) — must not move the price or count as volume
        { orderId: 'o1', teamId: 'team-a', stockId: 'acme', side: 'BUY', quantity: 100, referencePrice: 1000 },
        // team-b's buy succeeds
        { orderId: 'o2', teamId: 'team-b', stockId: 'acme', side: 'BUY', quantity: 3, referencePrice: 1000 },
      ],
      teamAccounts: [
        { teamId: 'team-a', cash: 500, holdings: {} },
        { teamId: 'team-b', cash: 10000, holdings: {} },
      ],
    })
    const acmeResult = result.stocks.find((s) => s.stockId === 'acme')!
    expect(acmeResult.netDemandValue).toBe(3000) // only team-b's 3 shares
    expect(acmeResult.displayedVolumeShares).toBe(3) // team-a's rejected 100 does not count
  })

  it('computes the next price from the settled net demand via calculateNextPrice (Task 3)', () => {
    const result = settleBatch({
      ...baseInput,
      stocks: [stock({ informationImpactPercent: 2 })],
      orders: [{ orderId: 'o1', teamId: 'team-a', stockId: 'acme', side: 'BUY', quantity: 10, referencePrice: 1000 }],
      teamAccounts: [{ teamId: 'team-a', cash: 100000, holdings: {} }],
    })
    const acmeResult = result.stocks.find((s) => s.stockId === 'acme')!
    expect(acmeResult.breakdown.informationPercent).toBeCloseTo(2, 9)
    expect(acmeResult.nextPrice).toBeGreaterThan(1000) // net buying + positive info both push price up
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/market/engine/settleBatch.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: `settleBatch`を実装する**

`functions/src/market/engine/settleBatch.ts`:

```ts
import type { PriceGuard } from '@stock-league/market-authoring-content'
import { aggregateDemand, nettedFillForParticipant, type NettedFill, type OrderForNetting } from './demandAggregation'
import { hardCheckBuyOrders, hardCheckSellOrdersForStock } from './fundLocking'
import { calculateNextPrice, type PriceSensitivityPreset } from './priceCalculation'

export interface StockBatchInput {
  stockId: string
  currentPrice: number
  initialPrice: number
  priceGuard: PriceGuard
  effectiveMarketSize: number
  demandSensitivity: number
  /** Pre-aggregated across active information items for this stock this batch. */
  informationImpactPercent: number
}

export interface OrderForSettlement {
  orderId: string
  teamId: string
  stockId: string
  side: 'BUY' | 'SELL'
  quantity: number
  referencePrice: number
}

export interface TeamAccountForSettlement {
  teamId: string
  /** Cash BEFORE this batch — must not include this batch's own sell proceeds (spec §12.15). */
  cash: number
  holdings: Record<string, number>
}

export interface SettleBatchInput {
  lessonRunId: string
  batchId: string
  batchIndex: number
  randomSeed: string
  restoreGeneration: number
  priceSensitivityPreset: PriceSensitivityPreset
  noiseEnabled: boolean
  stocks: StockBatchInput[]
  orders: OrderForSettlement[]
  teamAccounts: TeamAccountForSettlement[]
}

export interface OrderSettlementOutcome {
  orderId: string
  status: 'FILLED' | 'REJECTED'
  executionPrice?: number
  rejectionReason?: string
}

export interface StockSettlementResult {
  stockId: string
  executionPrice: number
  nextPrice: number
  breakdown: ReturnType<typeof calculateNextPrice>['breakdown']
  guardApplied: boolean
  suddenChangeWarning: boolean
  displayedVolumeShares: number
  netDemandValue: number
}

export interface TeamAccountUpdate {
  teamId: string
  cashDelta: number
  holdingsDelta: Record<string, number>
}

export interface SettleBatchResult {
  orders: OrderSettlementOutcome[]
  stocks: StockSettlementResult[]
  teamAccountUpdates: TeamAccountUpdate[]
}

const groupKey = (teamId: string, stockId: string) => `${teamId}::${stockId}`

export const settleBatch = (input: SettleBatchInput): SettleBatchResult => {
  const stocksById = new Map(input.stocks.map((s) => [s.stockId, s]))
  const accountsByTeam = new Map(input.teamAccounts.map((a) => [a.teamId, a]))

  const ordersByGroup = new Map<string, OrderForSettlement[]>()
  for (const order of input.orders) {
    const key = groupKey(order.teamId, order.stockId)
    ordersByGroup.set(key, [...(ordersByGroup.get(key) ?? []), order])
  }

  const nettedByGroup = new Map<string, NettedFill | null>()
  for (const [key, orders] of ordersByGroup) {
    nettedByGroup.set(key, nettedFillForParticipant(orders as OrderForNetting[]))
  }

  // Hard BUY check: aggregate a team's net-buy groups across ALL stocks.
  const buyFailedTeams = new Set<string>()
  for (const account of input.teamAccounts) {
    const buyOrders = input.stocks
      .map((stock) => ({ stockId: stock.stockId, netted: nettedByGroup.get(groupKey(account.teamId, stock.stockId)) }))
      .filter((x): x is { stockId: string; netted: NettedFill } => x.netted !== null && x.netted.side === 'BUY')
      .map((x) => ({ stockId: x.stockId, quantity: x.netted.quantity, executionPrice: stocksById.get(x.stockId)!.currentPrice }))
    if (buyOrders.length === 0) continue
    const result = hardCheckBuyOrders({ cashBeforeBatch: account.cash, buyOrders })
    if (!result.allSucceed) buyFailedTeams.add(account.teamId)
  }

  // Hard SELL check: per (team, stock) independently.
  const sellFailedGroups = new Set<string>()
  for (const [key, netted] of nettedByGroup) {
    if (!netted || netted.side !== 'SELL') continue
    const [teamId, stockId] = key.split('::')
    const held = accountsByTeam.get(teamId)?.holdings[stockId] ?? 0
    const result = hardCheckSellOrdersForStock({ heldShares: held, sellOrders: [{ stockId, quantity: netted.quantity }] })
    if (!result.allSucceed) sellFailedGroups.add(key)
  }

  const groupSucceeded = (teamId: string, stockId: string): boolean => {
    const netted = nettedByGroup.get(groupKey(teamId, stockId))
    if (!netted) return false // fully netted to zero — no trade, not a "success" for volume/demand purposes
    if (netted.side === 'BUY') return !buyFailedTeams.has(teamId)
    return !sellFailedGroups.has(groupKey(teamId, stockId))
  }

  // Order outcomes: every original order is FILLED unless its group hard-failed.
  const orderOutcomes: OrderSettlementOutcome[] = input.orders.map((order) => {
    const netted = nettedByGroup.get(groupKey(order.teamId, order.stockId))
    const executionPrice = stocksById.get(order.stockId)!.currentPrice
    if (!netted) return { orderId: order.orderId, status: 'FILLED', executionPrice } // netted to zero — no-op, not a failure
    const failed = netted.side === 'BUY' ? buyFailedTeams.has(order.teamId) : sellFailedGroups.has(groupKey(order.teamId, order.stockId))
    if (failed) {
      const reason = netted.side === 'BUY'
        ? 'このチームの現金が不足したため、この区間の買い注文はすべて不成立になりました。'
        : '保有株数が不足したため、この銘柄の売り注文はすべて不成立になりました。'
      return { orderId: order.orderId, status: 'REJECTED', rejectionReason: reason }
    }
    return { orderId: order.orderId, status: 'FILLED', executionPrice }
  })

  // Team account updates: only from successful netted groups.
  const teamAccountUpdates: TeamAccountUpdate[] = []
  for (const [key, netted] of nettedByGroup) {
    if (!netted) continue
    const [teamId, stockId] = key.split('::')
    if (!groupSucceeded(teamId, stockId)) continue
    const price = stocksById.get(stockId)!.currentPrice
    if (netted.side === 'BUY') {
      teamAccountUpdates.push({ teamId, cashDelta: -netted.quantity * price, holdingsDelta: { [stockId]: netted.quantity } })
    } else {
      teamAccountUpdates.push({ teamId, cashDelta: netted.quantity * price, holdingsDelta: { [stockId]: -netted.quantity } })
    }
  }

  // Per-stock price calculation from only the successful groups.
  const stockResults: StockSettlementResult[] = input.stocks.map((stock) => {
    const successfulFills: NettedFill[] = []
    const grossOrders: OrderForNetting[] = []
    for (const [key, netted] of nettedByGroup) {
      const [teamId, stockIdOfGroup] = key.split('::')
      if (stockIdOfGroup !== stock.stockId || !netted) continue
      if (!groupSucceeded(teamId, stockIdOfGroup)) continue
      successfulFills.push(netted)
      grossOrders.push(...(ordersByGroup.get(key) ?? []))
    }
    const demand = aggregateDemand({ executionPrice: stock.currentPrice, nettedFills: successfulFills, rawOrders: grossOrders })
    const priceResult = calculateNextPrice({
      currentPrice: stock.currentPrice, initialPrice: stock.initialPrice,
      informationImpactPercent: stock.informationImpactPercent, netDemandValue: demand.netDemandValue,
      effectiveMarketSize: stock.effectiveMarketSize, demandSensitivity: stock.demandSensitivity,
      priceSensitivityPreset: input.priceSensitivityPreset, noiseEnabled: input.noiseEnabled,
      randomSeed: input.randomSeed, restoreGeneration: input.restoreGeneration,
      stockId: stock.stockId, batchIndex: input.batchIndex, priceGuard: stock.priceGuard,
    })
    return {
      stockId: stock.stockId, executionPrice: stock.currentPrice, nextPrice: priceResult.nextPrice,
      breakdown: priceResult.breakdown, guardApplied: priceResult.guardApplied,
      suddenChangeWarning: priceResult.suddenChangeWarning,
      displayedVolumeShares: demand.displayedVolumeShares, netDemandValue: demand.netDemandValue,
    }
  })

  return { orders: orderOutcomes, stocks: stockResults, teamAccountUpdates }
}
```

- [ ] **Step 4: テストを通す**

Run: `cd functions && npx vitest run src/market/engine/settleBatch.test.ts`
Expected: PASS

- [ ] **Step 5: `npm run verify`**

- [ ] **Step 6: Commit**

```bash
git add functions/src/market/engine/settleBatch.ts functions/src/market/engine/settleBatch.test.ts
git commit -m "feat: add settleBatch — the pure batch-settlement orchestrator"
```

- [ ] **Step 7: Admin SDKラッパー`processBatch`の責務を書く（実装はTask 10のCloud Tasksハンドラと一体で行うため、ここでは責務とインターフェースのみ固定する）**

`functions/src/market/processBatch.ts`は次の順序でI/Oを行う薄いラッパーとする。個々のFirestore/RTDB呼び出しはPhase A（`appendLessonEvent`、`orgAccess`ミラー書き込み）と同じ形のAdmin SDKコードになるため、実装はそれらのコードをそのまま踏襲する。

1. `lessonRuns/{id}`から`status`・`randomSeed`・`restoreGeneration`・`socialStudiesMarket`（企業・価格ガード等）を読む。**`status !== 'RUNNING'`または`marketPaused === true`なら何もせず終了する**（Task 11の停止・Task 10の連鎖切断対策と整合）。
2. `listPendingOrdersForBatch`（Task 5）で`batchId`が現在のバッチの注文を全件取得する。
3. 各チームの`TeamAccount`（Task 7）を取得する。
4. アクティブな情報項目から`informationImpactPercent`を銘柄ごとに集計する（本タスクの範囲外の補助関数——情報の減衰モデルは統合仕様書に具体式がなく試運転で調整する前提のため、最小実装として「公開直後から一定バッチ数は`shortTermImpact`、それ以降は`longTermImpact`」という単純な窓関数を`functions/src/market/engine/informationImpact.ts`に実装し、`settleBatch`呼び出し前に銘柄ごとの値を計算する。窓の長さも§12.22のノイズ幅と同様に試運転で調整するPROVISIONAL値とする）。**経済指標（§12.8、`EconomicIndicatorAuthoring.companyImpactMultipliers`）が発表済みであれば、同じ集計へ加算する**——指標は特定企業に一律ではなく`companyImpactMultipliers`で企業ごとに重みが違う点を、情報項目の集計と同じ`informationImpactPercent`合算先へそのまま合流させることで満たす（新しい価格計算の項を増やさない）。各銘柄の`effectiveMarketSize`は`SimulatedCompany.sizeClass`から`effectiveMarketSizeForCompany`（Task 3 Step 10）で導出する——教師が発行株数を入力する経路は存在しない。
5. `settleBatch`を呼ぶ。
6. トランザクションで: 各注文の`status`を`transitionOrderStatus`で`PROCESSING`→結果へ、各`TeamAccount`へ`teamAccountUpdates`を適用（`releaseSoftLock`で元のソフト拘束を解除してから確定額を反映）、各銘柄の`currentPrice`を更新する。
7. `LessonEvent`として`BATCH_SETTLED`（`batchId`、価格内訳、拒否件数）を`appendLessonEvent`（Phase A）で追記する。
8. RTDB`lessonRunPublic`・`lessonRunPrivate`・`lessonRunTeamState`（Task 13）を更新する。
9. 次のバッチをTask 10のスケジューラへ委譲する。

このステップは実装時にTask 10のテストと合わせて検証するため、`npm run verify`はTask 10の完了条件に含める。

---

### Task 10: Cloud Tasksによる3秒バッチ自己連鎖

矛盾解消Aを実装する。**Firebase Cloud Tasks（`onTaskDispatched`系）の具体的な関数シグネチャ・引数名・バージョンは実装着手時にcontext7で確認すること**——本タスクのコードは概念上のインターフェース（`enqueueNextBatch`/`taskQueueHandler`）で示し、実際のFirebase Tasks APIへ実装時に置き換える。矛盾解消Aが列挙する4つの必須事項を、それぞれ独立してテストできる形に分解する。

**設計判断とリスク（実装者が読むこと）:**
- **`nextBatchAt`はDBに書いた値を正本とし、クライアントは自前でカウントダウンしない。** Cloud Tasksの発火時刻には揺らぎがあるため（矛盾解消A必須事項1）。
- **`batchId`は`{lessonRunId}_batch_{batchIndex}`のような決定的な文字列にする。** Cloud Tasksの重複実行（at-least-once配信）に対し、`processBatch`（Task 9）が同一`batchId`を2度処理しないことをFirestoreトランザクションのcompare-and-set（「このbatchIdは処理済みか」を1つのドキュメントで判定）で保証する（矛盾解消A必須事項2）。
- **連鎖切断の検知は「次のタスクを作る責務を持つ側」と「切断を監視する側」を分離する。** タスク自身が自分の失敗を検知することはできない（実行されなければ何も起きない）ため、監視は別のCloud Scheduler（**このジョブ自体は1分間隔で足りる**——3秒区間を刻む主目的には使えないが、「`nextBatchAt`を過ぎているのに次のバッチが処理された形跡がないか」を1分ごとに確認する監視用途には十分)が`lessonRuns`を横断的にスキャンし、`RUNNING`かつ`nextBatchAt`超過が閾値（既定60秒、教材設定なし——運用値としてコードに1箇所で定数化する）を超えたものを教師へ通知する設計にする（矛盾解消A必須事項3）。**この監視ジョブの実行間隔自体は矛盾解消ドキュメントの「残る未確定事項」に含まれる（連鎖切断の検知間隔は未確定）——本計画は60秒を暫定値として置くが、試運転で調整する前提を明記する。**
- **停止中に届いた古いタスクは、市場状態を見て何もせず終了する。** タスクハンドラの最初の行で`status`と`marketPaused`と`batchId`の3つを確認し、条件を満たさなければ即座にreturnする（矛盾解消A必須事項4）。

**Files:**
- Create: `functions/src/market/batchScheduler.ts`, `.test.ts`
- Create: `functions/src/market/taskHandler.ts`, `.test.ts`
- Modify: `functions/src/index.ts`（タスクキュー関数のexport）

**Interfaces:**
- Consumes: `processBatch`（Task 9）
- Produces: `computeNextBatchId(lessonRunId, batchIndex)`、`shouldProcessBatch(deps): boolean`、`enqueueNextBatch(deps): Promise<void>`、`batchTaskHandler`

- [ ] **Step 1: `batchId`の決定性と`shouldProcessBatch`の失敗するテストを書く**

`functions/src/market/batchScheduler.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { computeNextBatchId, shouldProcessBatch } from './batchScheduler'

describe('computeNextBatchId', () => {
  it('is deterministic given the same lessonRunId and batchIndex — the idempotency key for Cloud Tasks at-least-once delivery', () => {
    expect(computeNextBatchId('run-1', 42)).toBe(computeNextBatchId('run-1', 42))
    expect(computeNextBatchId('run-1', 42)).toBe('run-1_batch_42')
  })
})

describe('shouldProcessBatch', () => {
  it('processes when the run is RUNNING, not paused, and this batchId has not been processed yet', () => {
    expect(shouldProcessBatch({
      status: 'RUNNING', marketPaused: false, batchId: 'run-1_batch_5', lastProcessedBatchId: 'run-1_batch_4',
    })).toBe(true)
  })

  it('does nothing for a stale task delivered after the market was paused — 矛盾解消A必須事項4', () => {
    expect(shouldProcessBatch({
      status: 'RUNNING', marketPaused: true, batchId: 'run-1_batch_5', lastProcessedBatchId: 'run-1_batch_4',
    })).toBe(false)
  })

  it('does nothing for a stale task delivered after the lessonRun ended', () => {
    expect(shouldProcessBatch({
      status: 'COMPLETED', marketPaused: false, batchId: 'run-1_batch_5', lastProcessedBatchId: 'run-1_batch_4',
    })).toBe(false)
  })

  it('does nothing for a duplicate delivery of an already-processed batchId — Cloud Tasks at-least-once delivery', () => {
    expect(shouldProcessBatch({
      status: 'RUNNING', marketPaused: false, batchId: 'run-1_batch_4', lastProcessedBatchId: 'run-1_batch_4',
    })).toBe(false)
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/market/batchScheduler.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`functions/src/market/batchScheduler.ts`:

```ts
export const computeNextBatchId = (lessonRunId: string, batchIndex: number): string =>
  `${lessonRunId}_batch_${batchIndex}`

export interface ShouldProcessBatchInput {
  status: string
  marketPaused: boolean
  batchId: string
  /** The batchId most recently fully processed for this lessonRun — read
   * from `lessonRuns/{id}` alongside status/marketPaused, in the SAME
   * read as the idempotency check, so a duplicate Cloud Tasks delivery
   * short-circuits here before touching orders at all. */
  lastProcessedBatchId: string | null
}

/** 矛盾解消A必須事項2・4: refuses to reprocess an already-settled batchId,
 * and refuses to do anything once the run is no longer RUNNING or the
 * market has been paused — the only two conditions under which a stale
 * Cloud Tasks delivery should silently no-op instead of erroring (an
 * error would trigger a Cloud Tasks retry, which is wasted work once the
 * lessonRun has moved on). */
export const shouldProcessBatch = (input: ShouldProcessBatchInput): boolean => {
  if (input.status !== 'RUNNING') return false
  if (input.marketPaused) return false
  if (input.batchId === input.lastProcessedBatchId) return false
  return true
}
```

- [ ] **Step 4: テストを通す**

Run: `cd functions && npx vitest run src/market/batchScheduler.test.ts`
Expected: PASS

- [ ] **Step 5: `enqueueNextBatch`の失敗するテストを書く（`nextBatchAt`の書き込みと次タスクの予約が一体であることを検証する）**

`functions/src/market/batchScheduler.test.ts`に追記する:

```ts
describe('enqueueNextBatch', () => {
  it('writes nextBatchAt to the DB and schedules the next task at exactly that time — the client counts down from nextBatchAt, never from a local timer', async () => {
    const writeNextBatchAt = vi.fn()
    const scheduleTask = vi.fn()
    await enqueueNextBatch({
      writeNextBatchAt, scheduleTask,
      lessonRunId: 'run-1', nextBatchIndex: 6, intervalSeconds: 3, now: () => 1_000_000,
    })
    const expectedNextBatchAtMillis = 1_000_000 + 3000
    expect(writeNextBatchAt).toHaveBeenCalledWith(expect.objectContaining({ nextBatchAtMillis: expectedNextBatchAtMillis }))
    expect(scheduleTask).toHaveBeenCalledWith(expect.objectContaining({
      batchId: 'run-1_batch_6', scheduleTimeMillis: expectedNextBatchAtMillis,
    }))
  })
})
```

- [ ] **Step 6: 失敗を確認する**

Run: `cd functions && npx vitest run src/market/batchScheduler.test.ts`
Expected: FAIL — `enqueueNextBatch` not exported

- [ ] **Step 7: `enqueueNextBatch`を実装する**

`functions/src/market/batchScheduler.ts`に追記する:

```ts
export interface EnqueueNextBatchDeps {
  writeNextBatchAt: (input: { lessonRunId: string; nextBatchAtMillis: number; nextBatchId: string }) => Promise<void>
  /** Wraps the Cloud Tasks enqueue call. The actual Firebase Tasks API
   * (queue name, target function, OIDC token, retry config) is filled in
   * at implementation time per this plan's Global Constraints — check
   * context7 for the current `onTaskDispatched`/`getFunctions().taskQueue()`
   * signature before writing this function's real body. */
  scheduleTask: (input: { batchId: string; lessonRunId: string; scheduleTimeMillis: number }) => Promise<void>
  lessonRunId: string
  nextBatchIndex: number
  intervalSeconds: number
  now: () => number
}

export const enqueueNextBatch = async (deps: EnqueueNextBatchDeps): Promise<void> => {
  const nextBatchId = computeNextBatchId(deps.lessonRunId, deps.nextBatchIndex)
  const nextBatchAtMillis = deps.now() + deps.intervalSeconds * 1000
  await deps.writeNextBatchAt({ lessonRunId: deps.lessonRunId, nextBatchAtMillis, nextBatchId })
  await deps.scheduleTask({ batchId: nextBatchId, lessonRunId: deps.lessonRunId, scheduleTimeMillis: nextBatchAtMillis })
}
```

- [ ] **Step 8: テストを通す**

Run: `cd functions && npx vitest run src/market/batchScheduler.test.ts`
Expected: PASS

- [ ] **Step 9: タスクハンドラの失敗するテストを書く（`shouldProcessBatch`のガードが実際に`processBatch`をスキップさせることを検証する）**

`functions/src/market/taskHandler.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { batchTaskHandler } from './taskHandler'

describe('batchTaskHandler', () => {
  it('skips processing and does not enqueue a follow-up task for a stale/duplicate delivery', async () => {
    const processBatch = vi.fn()
    const enqueueNextBatch = vi.fn()
    await batchTaskHandler({
      processBatch, enqueueNextBatch,
      readRunState: async () => ({ status: 'PAUSED', marketPaused: true, lastProcessedBatchId: 'run-1_batch_4' }),
      lessonRunId: 'run-1', batchId: 'run-1_batch_5', batchIndex: 5,
    })
    expect(processBatch).not.toHaveBeenCalled()
    expect(enqueueNextBatch).not.toHaveBeenCalled()
  })

  it('processes the batch and immediately enqueues the next one — the self-chain', async () => {
    const processBatch = vi.fn().mockResolvedValue(undefined)
    const enqueueNextBatch = vi.fn().mockResolvedValue(undefined)
    await batchTaskHandler({
      processBatch, enqueueNextBatch,
      readRunState: async () => ({ status: 'RUNNING', marketPaused: false, lastProcessedBatchId: 'run-1_batch_4' }),
      lessonRunId: 'run-1', batchId: 'run-1_batch_5', batchIndex: 5,
    })
    expect(processBatch).toHaveBeenCalledWith(expect.objectContaining({ batchId: 'run-1_batch_5' }))
    expect(enqueueNextBatch).toHaveBeenCalledWith(expect.objectContaining({ nextBatchIndex: 6 }))
  })

  it('enqueues the next task even if this batch produced zero fills — the chain must never depend on there being activity', async () => {
    const processBatch = vi.fn().mockResolvedValue(undefined)
    const enqueueNextBatch = vi.fn().mockResolvedValue(undefined)
    await batchTaskHandler({
      processBatch, enqueueNextBatch,
      readRunState: async () => ({ status: 'RUNNING', marketPaused: false, lastProcessedBatchId: 'run-1_batch_4' }),
      lessonRunId: 'run-1', batchId: 'run-1_batch_5', batchIndex: 5,
    })
    expect(enqueueNextBatch).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 10: 失敗を確認する**

Run: `cd functions && npx vitest run src/market/taskHandler.test.ts`
Expected: FAIL — module not found

- [ ] **Step 11: `batchTaskHandler`を実装する**

`functions/src/market/taskHandler.ts`:

```ts
import { shouldProcessBatch } from './batchScheduler'

export interface BatchTaskHandlerDeps {
  readRunState: (lessonRunId: string) => Promise<{ status: string; marketPaused: boolean; lastProcessedBatchId: string | null }>
  processBatch: (input: { lessonRunId: string; batchId: string; batchIndex: number }) => Promise<void>
  enqueueNextBatch: (input: { lessonRunId: string; nextBatchIndex: number }) => Promise<void>
  lessonRunId: string
  batchId: string
  batchIndex: number
}

/**
 * The self-chain lives entirely in this one function: process, THEN
 * immediately enqueue the next task, unconditionally (spec resolution
 * A's flow diagram). If this function throws after processBatch succeeds
 * but before enqueueNextBatch runs, Cloud Tasks' own retry (this handler
 * is itself invoked via a task) re-enters here — shouldProcessBatch's
 * batchId dedup means the retry will skip processBatch (already done)
 * and go straight to enqueueNextBatch, so the chain still continues.
 */
export const batchTaskHandler = async (deps: BatchTaskHandlerDeps): Promise<void> => {
  const runState = await deps.readRunState(deps.lessonRunId)
  if (!shouldProcessBatch({
    status: runState.status, marketPaused: runState.marketPaused,
    batchId: deps.batchId, lastProcessedBatchId: runState.lastProcessedBatchId,
  })) {
    return
  }
  await deps.processBatch({ lessonRunId: deps.lessonRunId, batchId: deps.batchId, batchIndex: deps.batchIndex })
  await deps.enqueueNextBatch({ lessonRunId: deps.lessonRunId, nextBatchIndex: deps.batchIndex + 1 })
}
```

**注意（べき等性の穴）:** 上記コメントの通り、「`processBatch`成功後・`enqueueNextBatch`前」にクラッシュした場合はCloud Tasksの再試行に頼る。しかし`processBatch`自体が「同一`batchId`は1回だけ」というトランザクションで守られていることが前提（Task 9のStep 7・矛盾解消A必須事項2）。この前提が崩れると多重約定が起こるため、Task 9の`processBatch`実装時に**必ず**`batchId`ごとの処理済みマーカーをFirestoreトランザクションで確認してから約定処理へ進むこと。

- [ ] **Step 12: テストを通す**

Run: `cd functions && npx vitest run src/market/taskHandler.test.ts`
Expected: PASS

- [ ] **Step 13: 連鎖切断の監視ジョブを実装する（Cloud Scheduler、1分間隔）**

`functions/src/market/chainWatchdog.ts`, `.test.ts`を作成する。設計は「`RUNNING`かつ`marketPaused=false`な`lessonRuns`を横断的にクエリし、`nextBatchAtMillis`から60秒（暫定値、`STALL_DETECTION_THRESHOLD_MILLIS`として1箇所に定数化）以上経過しているものを検出し、教師へ通知するイベント（`LessonEvent`の`type: 'BATCH_CHAIN_STALLED'`、または別途通知の仕組み——教師画面へのアラート表示はPhase Bが持つ通知UIへ委譲する）を発行する」とする。テストは「閾値未満は検出しない」「閾値超過を検出する」「`PAUSED`な授業は対象外」の3点を純粋関数`detectStalledRuns(runs, nowMillis, thresholdMillis)`として検証する。Cloud SchedulerへのFirebase側の登録方法（`onSchedule`)も実装着手時にcontext7で確認する。

- [ ] **Step 14: `functions/src/index.ts`へタスクキュー関数と監視スケジューラをexportする**

- [ ] **Step 15: `npm run verify`**

- [ ] **Step 16: Commit**

```bash
git add functions/src/market/batchScheduler.ts functions/src/market/batchScheduler.test.ts \
  functions/src/market/taskHandler.ts functions/src/market/taskHandler.test.ts \
  functions/src/market/chainWatchdog.ts functions/src/market/chainWatchdog.test.ts functions/src/index.ts
git commit -m "feat: self-chaining Cloud Tasks batch scheduler with idempotency and stall detection"
```

---

### Task 11: 市場停止Callable

統合仕様書 §12.25を実装する。**「停止確定前に受理済みの注文は通常どおり約定」という要件と、Task 10の「連鎖切断時は市場状態を見て何もせず終了する」という要件は、次の設計で両立させる**——`pauseMarket`は`marketPaused`フラグを立てるだけでなく、**その場で現在進行中のバッチを`processBatch`（Task 9）に同期的に処理させてから**停止状態にする（「ドレイン」）。これにより「停止確定前に受理済みの注文」は必ずこのドレイン処理で約定し、以後Cloud Tasksから同じ`batchId`のタスクが発火しても、Task 10の`shouldProcessBatch`が`batchId === lastProcessedBatchId`で検出して何もしない——2つの要件の間に競合状態を作らない。

**Files:**
- Create: `functions/src/market/pauseMarket.ts`, `.test.ts`, `onCall.ts`
- Create: `src/lib/market/pauseMarket.ts`, `.test.ts`

**Interfaces:**
- Consumes: `processBatch`（Task 9）
- Produces: `pauseMarket(deps): Promise<void>`、`pauseMarketCallable`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/market/pauseMarket.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { pauseMarket } from './pauseMarket'

describe('pauseMarket', () => {
  it('drains the currently in-flight batch before flipping marketPaused, so pre-stop orders still fill', async () => {
    const processBatch = vi.fn().mockResolvedValue(undefined)
    const setMarketPaused = vi.fn()
    const calls: string[] = []
    processBatch.mockImplementation(async () => { calls.push('processBatch') })
    setMarketPaused.mockImplementation(async () => { calls.push('setMarketPaused') })

    await pauseMarket({
      processBatch, setMarketPaused,
      readCurrentBatch: async () => ({ batchId: 'run-1_batch_9', batchIndex: 9 }),
      lessonRunId: 'run-1',
    })

    expect(calls).toEqual(['processBatch', 'setMarketPaused'])
    expect(processBatch).toHaveBeenCalledWith(expect.objectContaining({ batchId: 'run-1_batch_9' }))
  })

  it('sets marketPaused even when there is nothing pending to drain (zero orders is a valid batch)', async () => {
    const setMarketPaused = vi.fn()
    await pauseMarket({
      processBatch: vi.fn().mockResolvedValue(undefined), setMarketPaused,
      readCurrentBatch: async () => ({ batchId: 'run-1_batch_1', batchIndex: 1 }),
      lessonRunId: 'run-1',
    })
    expect(setMarketPaused).toHaveBeenCalledWith(expect.objectContaining({ lessonRunId: 'run-1', paused: true }))
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/market/pauseMarket.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`functions/src/market/pauseMarket.ts`:

```ts
export interface PauseMarketDeps {
  readCurrentBatch: (lessonRunId: string) => Promise<{ batchId: string; batchIndex: number }>
  processBatch: (input: { lessonRunId: string; batchId: string; batchIndex: number }) => Promise<void>
  setMarketPaused: (input: { lessonRunId: string; paused: boolean }) => Promise<void>
  lessonRunId: string
}

/**
 * Order matters: drain THEN pause. If these were reversed, submitOrder's
 * isMarketAcceptingOrders check (Task 7) would still see marketPaused=false
 * for a brief window, letting a new order slip into a batch nobody will
 * ever process (no task is scheduled after this call).
 */
export const pauseMarket = async (deps: PauseMarketDeps): Promise<void> => {
  const current = await deps.readCurrentBatch(deps.lessonRunId)
  await deps.processBatch({ lessonRunId: deps.lessonRunId, batchId: current.batchId, batchIndex: current.batchIndex })
  await deps.setMarketPaused({ lessonRunId: deps.lessonRunId, paused: true })
}
```

- [ ] **Step 4: テストを通す**

Run: `cd functions && npx vitest run src/market/pauseMarket.test.ts`
Expected: PASS

- [ ] **Step 5: `onCall.ts`とクライアントラッパーを実装する（教師のみ。Phase A Task 7 Step 6と同一パターン）。停止表示（最終価格固定・「市場停止中」・再開方法）はTask 13のRTDB`lessonRunPublic`更新で配信する**

- [ ] **Step 6: `npm run verify`**

- [ ] **Step 7: Commit**

```bash
git add functions/src/market/pauseMarket.ts functions/src/market/pauseMarket.test.ts functions/src/market/onCall.ts \
  src/lib/market/pauseMarket.ts src/lib/market/pauseMarket.test.ts
git commit -m "feat: add pauseMarket Callable that drains the in-flight batch before pausing"
```

---

### Task 12: 市場再開Callable

統合仕様書 §12.26を実装する。既定30秒の再開前確認時間を経て、`marketPaused`を解除し、Task 10の自己連鎖を「最後に処理したバッチの次のインデックス」から再始動する。再開後最初の区間は、Task 11のドレインで既に確定している`currentPrice`（＝停止時点価格）でそのまま同一価格約定される——価格計算自体は`processBatch`が毎回行う通常の処理であり、特別な補正コードを足す必要はない（§12.26「特別補正なし」)。

**Files:**
- Create: `functions/src/market/resumeMarket.ts`, `.test.ts`, `onCall.ts`
- Create: `src/lib/market/resumeMarket.ts`, `.test.ts`

**Interfaces:**
- Consumes: `enqueueNextBatch`（Task 10）
- Produces: `resumeMarket(deps): Promise<void>`、`resumeMarketCallable`

- [ ] **Step 1: 失敗するテストを書く（確認時間ありと即時再開の両方）**

`functions/src/market/resumeMarket.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { resumeMarket } from './resumeMarket'

describe('resumeMarket', () => {
  it('records a resumeScheduledAtMillis and schedules a one-shot resume task for the default 30-second confirmation window', async () => {
    const recordResumeSchedule = vi.fn()
    const scheduleResumeTask = vi.fn()
    await resumeMarket({
      recordResumeSchedule, scheduleResumeTask, flipToRunning: vi.fn(),
      lessonRunId: 'run-1', confirmationSeconds: 30, now: () => 1_000_000,
    })
    expect(recordResumeSchedule).toHaveBeenCalledWith(expect.objectContaining({ resumeScheduledAtMillis: 1_030_000 }))
    expect(scheduleResumeTask).toHaveBeenCalledWith(expect.objectContaining({ scheduleTimeMillis: 1_030_000 }))
  })

  it('flips to running immediately when confirmationSeconds is 0 (spec §12.26 "確認なしの即時再開")', async () => {
    const flipToRunning = vi.fn()
    const scheduleResumeTask = vi.fn()
    await resumeMarket({
      recordResumeSchedule: vi.fn(), scheduleResumeTask, flipToRunning,
      lessonRunId: 'run-1', confirmationSeconds: 0, now: () => 1_000_000,
    })
    expect(flipToRunning).toHaveBeenCalledWith(expect.objectContaining({ lessonRunId: 'run-1' }))
    expect(scheduleResumeTask).not.toHaveBeenCalled()
  })
})

describe('executeScheduledResume (the one-shot task body)', () => {
  it('unpauses and restarts the batch chain from lastProcessedBatchIndex + 1', async () => {
    const flipToRunning = vi.fn()
    const enqueueNextBatch = vi.fn()
    await executeScheduledResume({
      flipToRunning, enqueueNextBatch,
      readLastProcessedBatchIndex: async () => 9,
      lessonRunId: 'run-1',
    })
    expect(flipToRunning).toHaveBeenCalledWith(expect.objectContaining({ lessonRunId: 'run-1' }))
    expect(enqueueNextBatch).toHaveBeenCalledWith(expect.objectContaining({ lessonRunId: 'run-1', nextBatchIndex: 10 }))
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/market/resumeMarket.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`functions/src/market/resumeMarket.ts`:

```ts
export interface ResumeMarketDeps {
  recordResumeSchedule: (input: { lessonRunId: string; resumeScheduledAtMillis: number }) => Promise<void>
  scheduleResumeTask: (input: { lessonRunId: string; scheduleTimeMillis: number }) => Promise<void>
  flipToRunning: (input: { lessonRunId: string }) => Promise<void>
  lessonRunId: string
  /** Default 30 per spec §12.26/§28. 0 means immediate resume, no confirmation window. */
  confirmationSeconds: number
  now: () => number
}

export const resumeMarket = async (deps: ResumeMarketDeps): Promise<void> => {
  if (deps.confirmationSeconds === 0) {
    await deps.flipToRunning({ lessonRunId: deps.lessonRunId })
    return
  }
  const resumeScheduledAtMillis = deps.now() + deps.confirmationSeconds * 1000
  await deps.recordResumeSchedule({ lessonRunId: deps.lessonRunId, resumeScheduledAtMillis })
  await deps.scheduleResumeTask({ lessonRunId: deps.lessonRunId, scheduleTimeMillis: resumeScheduledAtMillis })
}

export interface ExecuteScheduledResumeDeps {
  flipToRunning: (input: { lessonRunId: string }) => Promise<void>
  enqueueNextBatch: (input: { lessonRunId: string; nextBatchIndex: number }) => Promise<void>
  readLastProcessedBatchIndex: (lessonRunId: string) => Promise<number>
  lessonRunId: string
}

/** The body of the one-shot Cloud Task scheduled by resumeMarket (or
 * called directly for the confirmationSeconds === 0 path — see Step 5). */
export const executeScheduledResume = async (deps: ExecuteScheduledResumeDeps): Promise<void> => {
  await deps.flipToRunning({ lessonRunId: deps.lessonRunId })
  const lastIndex = await deps.readLastProcessedBatchIndex(deps.lessonRunId)
  await deps.enqueueNextBatch({ lessonRunId: deps.lessonRunId, nextBatchIndex: lastIndex + 1 })
}
```

- [ ] **Step 4: テストを通す**

Run: `cd functions && npx vitest run src/market/resumeMarket.test.ts`
Expected: PASS

- [ ] **Step 5: `confirmationSeconds === 0`の即時再開でも`executeScheduledResume`（自己連鎖の再始動）を呼ぶよう`resumeMarket`を修正する失敗するテストを書く**

Step 1のテストは`flipToRunning`だけを検証したが、即時再開でも自己連鎖を再始動しなければ市場は「`RUNNING`だが誰もバッチを処理しない」状態で止まる。追記する:

```ts
it('also restarts the batch chain on immediate resume, not just flipToRunning', async () => {
  const enqueueNextBatch = vi.fn()
  await resumeMarket({
    recordResumeSchedule: vi.fn(), scheduleResumeTask: vi.fn(), flipToRunning: vi.fn(),
    enqueueNextBatch, readLastProcessedBatchIndex: async () => 9,
    lessonRunId: 'run-1', confirmationSeconds: 0, now: () => 1_000_000,
  })
  expect(enqueueNextBatch).toHaveBeenCalledWith(expect.objectContaining({ nextBatchIndex: 10 }))
})
```

- [ ] **Step 6: 失敗を確認する**

Run: `cd functions && npx vitest run src/market/resumeMarket.test.ts`
Expected: FAIL — `enqueueNextBatch`/`readLastProcessedBatchIndex`が`resumeMarket`のdepsにない

- [ ] **Step 7: `resumeMarket`を修正する**

`confirmationSeconds === 0`の分岐を`executeScheduledResume`の呼び出しに置き換える:

```ts
export interface ResumeMarketDeps {
  recordResumeSchedule: (input: { lessonRunId: string; resumeScheduledAtMillis: number }) => Promise<void>
  scheduleResumeTask: (input: { lessonRunId: string; scheduleTimeMillis: number }) => Promise<void>
  flipToRunning: (input: { lessonRunId: string }) => Promise<void>
  enqueueNextBatch: (input: { lessonRunId: string; nextBatchIndex: number }) => Promise<void>
  readLastProcessedBatchIndex: (lessonRunId: string) => Promise<number>
  lessonRunId: string
  confirmationSeconds: number
  now: () => number
}

export const resumeMarket = async (deps: ResumeMarketDeps): Promise<void> => {
  if (deps.confirmationSeconds === 0) {
    await executeScheduledResume(deps)
    return
  }
  const resumeScheduledAtMillis = deps.now() + deps.confirmationSeconds * 1000
  await deps.recordResumeSchedule({ lessonRunId: deps.lessonRunId, resumeScheduledAtMillis })
  await deps.scheduleResumeTask({ lessonRunId: deps.lessonRunId, scheduleTimeMillis: resumeScheduledAtMillis })
}
```

- [ ] **Step 8: テストを通す**

Run: `cd functions && npx vitest run src/market/resumeMarket.test.ts`
Expected: PASS（Step 1・Step 5双方のテストが通ること）

- [ ] **Step 9: `onCall.ts`とクライアントラッパーを実装する（教師のみ）。確認時間中は情報閲覧のみ（新規注文はTask 7の`isMarketAcceptingOrders`が`marketPaused`を見ている限り自動的に拒否される）**

- [ ] **Step 10: `npm run verify`**

- [ ] **Step 11: Commit**

```bash
git add functions/src/market/resumeMarket.ts functions/src/market/resumeMarket.test.ts functions/src/market/onCall.ts \
  src/lib/market/resumeMarket.ts src/lib/market/resumeMarket.test.ts
git commit -m "feat: add resumeMarket Callable with confirmation window and batch-chain restart"
```

---

### Task 13: RTDBライブ市場スキーマ（公開/非公開/チーム別の3分離）

統合仕様書 §26-1、Phase A Task 10が確立した「祖先を共有しないトップレベルノード」パターンを、社会科市場のランタイムデータへ適用する。**3つの独立したトップレベルRTDBノード**にする: `lessonRunPublic/{lessonRunId}`（全参加者。Phase Aが雛形を作成済み）、`lessonRunPrivate/{lessonRunId}`（教師のみ。Phase Aが雛形を作成済み）、`lessonRunTeamState/{lessonRunId}/{teamId}`（そのチームのメンバーのみ。**本タスクで新設**）。3つ目が必要な理由は、チームの拘束中資金・保有株・自分の注文状態が「生徒全員に見せてよい」わけでも「教師だけに見せる」わけでもない、チーム単位の第3の可視性クラスだからである（旧`phase1b`計画が`teamDecisions`/`predictions`で同じ理由から導入していた設計——本計画も踏襲する）。

**未確認事項（前提チェックリスト参照）:** チーム帰属を検証する仕組みがPhase Bに実在するか確認できていない。本タスクは`teamMembership/{lessonRunId}/{uid}` → `teamId`という最小限のミラーをここで新設する前提で進める。**Phase Bが既に同等の仕組みを持っている場合はそちらを使い、本タスクのミラー新設ステップは省略する。**

**Files:**
- Modify: `src/lib/lessonRuns/liveTypes.ts`（Phase A。市場フィールドを追加）
- Create: `src/lib/market/teamState.ts`, `.test.ts`
- Modify: `database.rules.json`（`lessonRunTeamState`ノード追加、`teamMembership`ミラー追加）
- Modify: `test/database.rules.test.ts`

**Interfaces:**
- Consumes: `LessonRunPublicState`/`LessonRunPrivateState`（Phase A）
- Produces: `LessonRunTeamState`型、`StockPublicState`型、`InformationBreakdownPublicView`型

- [ ] **Step 1: 型拡張の失敗するテストを書く**

`src/lib/lessonRuns/liveTypes.test.ts`（Phase Aの既存ファイル）に追記する:

```ts
it('LessonRunPublicState carries per-stock price/breakdown but never a coefficient or seed', () => {
  const state: LessonRunPublicState = {
    status: 'RUNNING', currentPhaseId: 'phase-1', updatedAtMillis: 1,
    marketPaused: false, nextBatchAtMillis: 1003000,
    stocks: {
      acme: {
        currentPrice: 1030, previousPrice: 1000, guardApplied: false, suddenChangeWarning: false,
        breakdown: { informationPercent: 2.1, demandPercent: 0.8, otherPercent: 0.1, total: 3.0 },
        displayedVolumeShares: 42,
      },
    },
  }
  expect(Object.keys(state)).not.toContain('randomSeed')
  expect(Object.keys(state.stocks.acme.breakdown)).toEqual(['informationPercent', 'demandPercent', 'otherPercent', 'total'])
})

it('LessonRunTeamState is a type distinct from public/private state — its own visibility class', () => {
  const state: LessonRunTeamState = {
    cash: 14000, holdings: { acme: 3 }, lockedBuyValue: 6000, lockedSellQuantity: {},
    myOrders: [{ orderId: 'o1', stockId: 'acme', side: 'BUY', quantity: 5, status: 'PENDING', referencePrice: 1000 }],
    updatedAtMillis: 1,
  }
  expect(state.cash).toBe(14000)
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/lessonRuns/liveTypes.test.ts`
Expected: FAIL — フィールド/型が存在しない

- [ ] **Step 3: `LessonRunPublicState`/`LessonRunPrivateState`を拡張し、`LessonRunTeamState`を新設する**

`src/lib/lessonRuns/liveTypes.ts`（Phase Aの既存2型はそのまま、フィールドを追加する）:

```ts
export interface PriceBreakdownPublicView {
  informationPercent: number
  demandPercent: number
  /** 内部係数は含まない。§12.31の「その他要因」表示そのもの。 */
  otherPercent: number
  total: number
}

export interface StockPublicState {
  currentPrice: number
  previousPrice: number
  guardApplied: boolean
  suddenChangeWarning: boolean
  breakdown: PriceBreakdownPublicView
  /** 矛盾解消C: 相殺前の総取引量。 */
  displayedVolumeShares: number
}

export interface LessonRunPublicState {
  status: string
  currentPhaseId: string | null
  updatedAtMillis: number
  marketPaused: boolean
  /** サーバーが書いた値。クライアントはこれからのカウントダウンのみ表示し、
   * 自前でタイマーを進めない（矛盾解消A必須事項1）。 */
  nextBatchAtMillis: number | null
  resumeScheduledAtMillis?: number
  stocks: Record<string, StockPublicState>
}

export interface LessonRunPrivateState {
  randomSeed: string
  restoreGeneration: number
  updatedAtMillis: number
  /** Task 10の冪等キー整合に使う。教師画面には出さない内部状態。 */
  lastProcessedBatchId: string | null
  /** §12.31「教師・教材作成者は詳細設定と計算ログを確認できる」——公開用
   * breakdownと同じ形だが、感度プリセットの実倍率など内部係数を含めた
   * 完全な計算ログをここに置く。生徒には絶対に配信しない。 */
  computationLog: Record<string, { informationImpactPercent: number; demandImpactPercent: number; noisePercent: number; priceSensitivityPreset: string }>
}

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
 * Third visibility class: not public (other teams must not see this
 * team's cash/holdings/orders), not teacher-only (the team itself must
 * see its own state in real time). A separate top-level RTDB node —
 * NEVER nested under lessonRunPublic or lessonRunPrivate, same rule-
 * cascade reasoning as Phase A Task 10.
 */
export interface LessonRunTeamState {
  cash: number
  holdings: Record<string, number>
  lockedBuyValue: number
  lockedSellQuantity: Record<string, number>
  myOrders: MyOrderView[]
  updatedAtMillis: number
}
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/lib/lessonRuns/liveTypes.test.ts`
Expected: PASS

- [ ] **Step 5: `lessonRunTeamState`と`teamMembership`ミラーのルールテストを書く（Phase A Task 10と同じ構造のカスケード安全性テストを踏襲する）**

`test/database.rules.test.ts`に追記する:

```ts
describe('lessonRunTeamState is a third, isolated visibility class', () => {
  it('lets a team member read their own team\'s state', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.database().ref('orgAccess/personal_teacher-a/teacher-a').set({ role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 })
      await context.database().ref('teamMembership/run-1/student-a').set('team-x')
      await context.database().ref('lessonRunTeamState/run-1/team-x').set({ cash: 10000, holdings: {}, lockedBuyValue: 0, lockedSellQuantity: {}, myOrders: [], updatedAtMillis: 1, orgId: 'personal_teacher-a' })
    })
    const student = environment.authenticatedContext('student-a', studentToken).database()
    await assertSucceeds(get(ref(student, 'lessonRunTeamState/run-1/team-x')))
  })

  it('never lets a DIFFERENT team read this team\'s state', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.database().ref('teamMembership/run-1/student-b').set('team-y')
      await context.database().ref('lessonRunTeamState/run-1/team-x').set({ cash: 10000, holdings: {}, lockedBuyValue: 0, lockedSellQuantity: {}, myOrders: [], updatedAtMillis: 1, orgId: 'personal_teacher-a' })
    })
    const otherStudent = environment.authenticatedContext('student-b', studentToken).database()
    await assertFails(get(ref(otherStudent, 'lessonRunTeamState/run-1/team-x')))
  })

  it('lets the teacher read every team\'s state for oversight', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.database().ref('orgAccess/personal_teacher-a/teacher-a').set({ role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 })
      await context.database().ref('lessonRunTeamState/run-1/team-x').set({ cash: 10000, holdings: {}, lockedBuyValue: 0, lockedSellQuantity: {}, myOrders: [], updatedAtMillis: 1, orgId: 'personal_teacher-a' })
    })
    const teacher = environment.authenticatedContext('teacher-a', teacherToken).database()
    await assertSucceeds(get(ref(teacher, 'lessonRunTeamState/run-1/team-x')))
  })

  it('rejects any client write — Functions-only, same as lessonRunPublic/Private', async () => {
    const student = environment.authenticatedContext('student-a', studentToken).database()
    await assertFails(set(ref(student, 'lessonRunTeamState/run-1/team-x'), { cash: 999999999, holdings: {}, lockedBuyValue: 0, lockedSellQuantity: {}, myOrders: [], updatedAtMillis: 1 }))
  })
})
```

- [ ] **Step 6: 失敗を確認する**

Run: `npm run test:rules`
Expected: FAIL — `lessonRunTeamState`/`teamMembership`に既存ルールがなくルートの`.read: false`に落ちる

- [ ] **Step 7: `database.rules.json`へ追加する**

`orgAccess`・`lessonRunPublic`・`lessonRunPrivate`と**同じ階層**（ルート直下の兄弟ノード）に追加する:

```json
"teamMembership": {
  "$lessonRunId": {
    "$uid": {
      ".read": "auth != null && auth.uid === $uid",
      ".write": false
    }
  }
},
"lessonRunTeamState": {
  "$lessonRunId": {
    "$teamId": {
      ".read": "auth != null && (root.child('teamMembership').child($lessonRunId).child(auth.uid).val() === $teamId || (data.child('orgId').exists() && root.child('orgAccess').child(data.child('orgId').val()).child(auth.uid).child('status').val() === 'active'))",
      ".write": false
    }
  }
}
```

`lessonRunTeamState`の読み取り条件は「自分のチームか」または「その組織のメンバー（教師）か」のOR——教師の全チーム閲覧（オーバーサイト）を許すが、生徒には自分のチームのみを許す非対称なルールになる。**この非対称性を`lessonRunPublic`（全参加者に一律許可）・`lessonRunPrivate`（教師の`owner`ロールのみ）と混同しないこと。**

- [ ] **Step 8: ルールテストを通す**

Run: `npm run test:rules`
Expected: PASS

- [ ] **Step 9: `lessonRunPublic`の生徒読み取り許可を確認する（前提チェックリスト該当）**

Phase A Task 10の`lessonRunPublic`ルールは組織メンバー（教師）のみを許可していた。本タスクで生徒（参加者）にも市場データを配信する必要があるため、実際のPhase Bコードを確認し、参加者向けの読み取り条件（例: `root.child('teamMembership').child($lessonRunId).child(auth.uid).exists()`を`||`で追加する）が既にあるか、なければここで追加する。追加する場合は`lessonRunTeamState`と同型のOR条件にする。

- [ ] **Step 10: `npm run verify`**

- [ ] **Step 11: Commit**

```bash
git add src/lib/lessonRuns/liveTypes.ts src/lib/lessonRuns/liveTypes.test.ts \
  src/lib/market/teamState.ts src/lib/market/teamState.test.ts \
  database.rules.json test/database.rules.test.ts
git commit -m "feat: add lessonRunTeamState as a third RTDB visibility class, isolated from public/private"
```

---

### Task 14: 価格履歴・チャートとCSVエクスポート

統合仕様書 §12.30を実装する。3秒ごとの価格は`lessonRuns/{id}/priceHistory/{stockId}_{batchIndex}`（Firestore、Task 9の`processBatch`が各バッチ処理の一部として書き込む）に保存する。表示集約（10〜30秒単位）とCSVエクスポートは純粋関数として分離し、UIやHTTPエンドポイントから独立してテストする。CSVエクスポートはPhase Aが削除した旧`resultsExport.ts`の「CSVインジェクション対策（先頭`'`付与）」の考え方を引き継ぐ（コードは引き継がない——Phase Aの廃止範囲どおり）。

**Files:**
- Create: `functions/src/market/priceHistory.ts`, `.test.ts`
- Create: `functions/src/market/exportCsv.ts`, `.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `aggregatePriceHistory(points, bucketSeconds): AggregatedPricePoint[]`、`overlayNewsMarkers(points, newsItems): ChartPoint[]`、`exportPriceHistoryCsv(points): string`

- [ ] **Step 1: 集約の失敗するテストを書く**

`functions/src/market/priceHistory.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { aggregatePriceHistory, exportPriceHistoryCsv, overlayNewsMarkers } from './priceHistory'

const point = (stockId: string, batchIndex: number, timestampMillis: number, price: number) =>
  ({ stockId, batchIndex, timestampMillis, price })

describe('aggregatePriceHistory', () => {
  it('groups 3-second points into a 30-second bucket, keeping the LAST price in each bucket', () => {
    const points = [
      point('acme', 0, 0, 1000), point('acme', 1, 3000, 1010), point('acme', 2, 6000, 1005),
      point('acme', 3, 9000, 1020), point('acme', 4, 12000, 1030), // still in bucket 0 (0-29999ms) if 30s
      point('acme', 10, 30000, 1050), // new bucket
    ]
    const result = aggregatePriceHistory(points, 30)
    expect(result).toEqual([
      { stockId: 'acme', bucketStartMillis: 0, price: 1030 },
      { stockId: 'acme', bucketStartMillis: 30000, price: 1050 },
    ])
  })

  it('returns one point per bucket when bucketSeconds equals the batch interval (no aggregation)', () => {
    const points = [point('acme', 0, 0, 1000), point('acme', 1, 3000, 1010)]
    expect(aggregatePriceHistory(points, 3)).toEqual([
      { stockId: 'acme', bucketStartMillis: 0, price: 1000 },
      { stockId: 'acme', bucketStartMillis: 3000, price: 1010 },
    ])
  })
})

describe('overlayNewsMarkers', () => {
  it('attaches newsIds published within a bucket to that bucket\'s point', () => {
    const buckets = [{ stockId: 'acme', bucketStartMillis: 0, price: 1000 }, { stockId: 'acme', bucketStartMillis: 30000, price: 1050 }]
    const news = [{ id: 'news-1', publishedAtMillis: 15000 }, { id: 'news-2', publishedAtMillis: 45000 }]
    const result = overlayNewsMarkers(buckets, news, 30)
    expect(result[0].newsIds).toEqual(['news-1'])
    expect(result[1].newsIds).toEqual(['news-2'])
  })
})

describe('exportPriceHistoryCsv', () => {
  it('produces a header row and one row per point, prefixing any leading =/+/-/@ to prevent CSV injection', () => {
    const csv = exportPriceHistoryCsv([
      { stockId: '=CMD|/malicious', bucketStartMillis: 0, price: 1000 },
    ])
    expect(csv).toContain("'=CMD|/malicious")
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/market/priceHistory.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`functions/src/market/priceHistory.ts`:

```ts
export interface PricePoint {
  stockId: string
  batchIndex: number
  timestampMillis: number
  price: number
}

export interface AggregatedPricePoint {
  stockId: string
  bucketStartMillis: number
  price: number
}

export const aggregatePriceHistory = (points: PricePoint[], bucketSeconds: number): AggregatedPricePoint[] => {
  const bucketMillis = bucketSeconds * 1000
  const lastByBucket = new Map<string, AggregatedPricePoint>()
  for (const point of points) {
    const bucketStartMillis = Math.floor(point.timestampMillis / bucketMillis) * bucketMillis
    const key = `${point.stockId}::${bucketStartMillis}`
    lastByBucket.set(key, { stockId: point.stockId, bucketStartMillis, price: point.price })
  }
  return Array.from(lastByBucket.values()).sort((a, b) => a.bucketStartMillis - b.bucketStartMillis)
}

export interface ChartPoint extends AggregatedPricePoint {
  newsIds: string[]
}

export const overlayNewsMarkers = (
  buckets: AggregatedPricePoint[],
  news: { id: string; publishedAtMillis: number }[],
  bucketSeconds: number,
): ChartPoint[] => {
  const bucketMillis = bucketSeconds * 1000
  return buckets.map((bucket) => ({
    ...bucket,
    newsIds: news
      .filter((n) => Math.floor(n.publishedAtMillis / bucketMillis) * bucketMillis === bucket.bucketStartMillis)
      .map((n) => n.id),
  }))
}
```

- [ ] **Step 4: テストを通す（`aggregatePriceHistory`/`overlayNewsMarkers`のみ）**

Run: `cd functions && npx vitest run src/market/priceHistory.test.ts`
Expected: 一部PASS、`exportPriceHistoryCsv`はまだFAIL

- [ ] **Step 5: `exportPriceHistoryCsv`を実装する**

`functions/src/market/exportCsv.ts`:

```ts
import type { AggregatedPricePoint } from './priceHistory'

/** Spreadsheet apps treat a leading =/+/-/@ as a formula — prefix a `'` to
 * neutralize it, the same CSV-injection guard Phase A's deleted
 * `resultsExport.ts` used (see Phase A plan's 廃止範囲 note; code is not
 * reused, only the technique). */
const escapeCsvCell = (value: string): string =>
  /^[=+\-@]/.test(value) ? `'${value}` : value

export const exportPriceHistoryCsv = (points: AggregatedPricePoint[]): string => {
  const header = 'stockId,bucketStartMillis,price'
  const rows = points.map((p) => `${escapeCsvCell(p.stockId)},${p.bucketStartMillis},${p.price}`)
  return [header, ...rows].join('\n')
}
```

`priceHistory.ts`の`import`に`exportPriceHistoryCsv`を再exportするか、テストの`import`元を`exportCsv.ts`に分ける（File Structureの2ファイル構成に合わせる）。

- [ ] **Step 6: テストを通す**

Run: `cd functions && npx vitest run src/market/priceHistory.test.ts src/market/exportCsv.test.ts`
Expected: PASS

- [ ] **Step 7: `npm run verify`**

- [ ] **Step 8: Commit**

```bash
git add functions/src/market/priceHistory.ts functions/src/market/priceHistory.test.ts \
  functions/src/market/exportCsv.ts functions/src/market/exportCsv.test.ts
git commit -m "feat: add price history aggregation, news overlay, and CSV export"
```

---

### Task 15: 予想チェックポイント

矛盾解消F・統合仕様書 §12.32を実装する。各予想は`evaluationTarget`を明示的に持ち、「いつの価格と比較して正誤を判定するか」を売買履歴からの推測に頼らず確定させる。`evaluationTarget`が`{ type: 'AFTER_BATCHES', count }`の既定値（本計画では20区間＝3秒間隔で60秒、矛盾解消ドキュメントが「試運転で決める」としている値のPROVISIONAL初期値）である場合、予想提出時のバッチ番号に`count`を足した番号のバッチが確定した時点で解決可能になる。

**Files:**
- Create: `functions/src/market/predictionCheckpoint.ts`, `.test.ts`, `onCall.ts`

**Interfaces:**
- Consumes: `PredictionEvaluationTarget`（Task 2）
- Produces: `PredictionCheckpoint`型、`submitPrediction(deps)`、`resolvePredictionCheckpoint(checkpoint, context): PredictionResolution`

- [ ] **Step 1: 解決ロジックの失敗するテストを書く**

`functions/src/market/predictionCheckpoint.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolvePredictionCheckpoint } from './predictionCheckpoint'

const checkpoint = (overrides: Record<string, unknown> = {}) => ({
  id: 'pred-1', direction: 'UP' as const, submittedAtBatchIndex: 10, submittedPriceReference: 1000,
  evaluationTarget: { type: 'AFTER_BATCHES' as const, count: 20 },
  ...overrides,
})

describe('resolvePredictionCheckpoint', () => {
  it('is NOT resolvable before the target batch is reached (AFTER_BATCHES)', () => {
    const result = resolvePredictionCheckpoint(checkpoint(), { currentBatchIndex: 25, priceAtBatchIndex: () => 1100 })
    expect(result.resolved).toBe(false)
  })

  it('resolves at exactly submittedAtBatchIndex + count, comparing against that batch\'s settled price', () => {
    const result = resolvePredictionCheckpoint(checkpoint(), { currentBatchIndex: 30, priceAtBatchIndex: (i: number) => (i === 30 ? 1100 : 999) })
    expect(result.resolved).toBe(true)
    if (result.resolved) {
      expect(result.resolvedPrice).toBe(1100)
      expect(result.outcome).toBe('CORRECT') // predicted UP, price rose
    }
  })

  it('classifies a prediction within ±0.5% of the reference price as FLAT regardless of predicted direction', () => {
    const flatCheckpoint = checkpoint({ direction: 'FLAT' })
    const result = resolvePredictionCheckpoint(flatCheckpoint, { currentBatchIndex: 30, priceAtBatchIndex: () => 1002 })
    expect(result.resolved).toBe(true)
    if (result.resolved) expect(result.outcome).toBe('CORRECT')
  })

  it('marks a wrong-direction prediction INCORRECT', () => {
    const result = resolvePredictionCheckpoint(checkpoint({ direction: 'UP' }), { currentBatchIndex: 30, priceAtBatchIndex: () => 900 })
    expect(result.resolved).toBe(true)
    if (result.resolved) expect(result.outcome).toBe('INCORRECT')
  })

  it('resolves NEXT_INFORMATION targets when the next information item\'s batch index is known', () => {
    const target = checkpoint({ evaluationTarget: { type: 'NEXT_INFORMATION' } })
    const notYet = resolvePredictionCheckpoint(target, { currentBatchIndex: 15, priceAtBatchIndex: () => 1000 })
    expect(notYet.resolved).toBe(false)
    const resolved = resolvePredictionCheckpoint(target, {
      currentBatchIndex: 18, priceAtBatchIndex: () => 1050, nextInformationBatchIndex: 18,
    })
    expect(resolved.resolved).toBe(true)
  })

  it('resolves MARKET_CLOSE targets only once the market has closed', () => {
    const target = checkpoint({ evaluationTarget: { type: 'MARKET_CLOSE' } })
    const notYet = resolvePredictionCheckpoint(target, { currentBatchIndex: 100, priceAtBatchIndex: () => 1000, marketClosed: false })
    expect(notYet.resolved).toBe(false)
    const resolved = resolvePredictionCheckpoint(target, { currentBatchIndex: 100, priceAtBatchIndex: () => 1200, marketClosed: true })
    expect(resolved.resolved).toBe(true)
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/market/predictionCheckpoint.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`functions/src/market/predictionCheckpoint.ts`:

```ts
import type { PredictionEvaluationTarget } from '../../../src/lib/lessonTemplates/types'

export type PredictionDirection = 'UP' | 'FLAT' | 'DOWN'

export interface PredictionCheckpoint {
  id: string
  direction: PredictionDirection
  submittedAtBatchIndex: number
  submittedPriceReference: number
  evaluationTarget: PredictionEvaluationTarget
}

export interface ResolutionContext {
  currentBatchIndex: number
  priceAtBatchIndex: (batchIndex: number) => number
  nextInformationBatchIndex?: number
  marketClosed?: boolean
}

export type PredictionResolution =
  | { resolved: false }
  | { resolved: true; resolvedPrice: number; outcome: 'CORRECT' | 'INCORRECT' }

/** Flat band: within ±0.5% counts as FLAT regardless of predicted
 * direction. PROVISIONAL — no spec default exists for this band; chosen
 * to roughly match §12.22's noise magnitude so pure noise never scores a
 * FLAT prediction as wrong. */
const FLAT_BAND_PERCENT = 0.5

const classify = (direction: PredictionDirection, referencePrice: number, resolvedPrice: number): 'CORRECT' | 'INCORRECT' => {
  const changePercent = ((resolvedPrice - referencePrice) / referencePrice) * 100
  const actual: PredictionDirection = Math.abs(changePercent) <= FLAT_BAND_PERCENT
    ? 'FLAT' : changePercent > 0 ? 'UP' : 'DOWN'
  return actual === direction ? 'CORRECT' : 'INCORRECT'
}

export const resolvePredictionCheckpoint = (
  checkpoint: PredictionCheckpoint,
  context: ResolutionContext,
): PredictionResolution => {
  const target = checkpoint.evaluationTarget
  let resolvedAtBatchIndex: number | undefined

  if (target.type === 'AFTER_BATCHES') {
    const targetBatchIndex = checkpoint.submittedAtBatchIndex + target.count
    if (context.currentBatchIndex < targetBatchIndex) return { resolved: false }
    resolvedAtBatchIndex = targetBatchIndex
  } else if (target.type === 'NEXT_INFORMATION') {
    if (context.nextInformationBatchIndex === undefined) return { resolved: false }
    resolvedAtBatchIndex = context.nextInformationBatchIndex
  } else {
    if (!context.marketClosed) return { resolved: false }
    resolvedAtBatchIndex = context.currentBatchIndex
  }

  const resolvedPrice = context.priceAtBatchIndex(resolvedAtBatchIndex)
  return { resolved: true, resolvedPrice, outcome: classify(checkpoint.direction, checkpoint.submittedPriceReference, resolvedPrice) }
}
```

- [ ] **Step 4: テストを通す**

Run: `cd functions && npx vitest run src/market/predictionCheckpoint.test.ts`
Expected: PASS

- [ ] **Step 5: `submitPrediction`Callableを実装する（未入力者は§12.32/矛盾解消Fにより減点ではなく対象外として扱う——Task 16の評価がこの型を消費する際、`myOrders`はあっても予想がないチームを0点にせず「対象外」の集計から除外する）**

`functions/src/market/onCall.ts`へ`submitPredictionCallable`を追加する。冪等キー必須、`PredictionCheckpoint`をFirestore`lessonRuns/{id}/predictions/{predictionId}`へ書く。パターンはTask 7 Step 10と同一。

- [ ] **Step 6: `npm run verify`**

- [ ] **Step 7: Commit**

```bash
git add functions/src/market/predictionCheckpoint.ts functions/src/market/predictionCheckpoint.test.ts functions/src/market/onCall.ts
git commit -m "feat: add prediction checkpoints with explicit evaluationTarget resolution (spec resolution F)"
```

---

### Task 16: 社会科の評価（5観点・観点別ランキング）

統合仕様書 §12.33を実装する。5観点のうち「運用結果」「予想精度」は**自動計算**、「情報活用」「リスク管理」「振り返り」は**教師によるルーブリック評価**とし、型レベルで分離する（旧`phase1b`計画が明示していた「『根拠の妥当性』を自動採点しない」という設計原則——統合仕様書でも有効なため引き継ぐ、と同計画のヘッダーに明記されている）。予想を一度も出さなかったチームは「予想精度」観点から**0点ではなく対象外**として除外する（矛盾解消F）。

**Files:**
- Create: `functions/src/market/evaluation.ts`, `.test.ts`

**Interfaces:**
- Consumes: `SocialStudiesEvaluationWeights`（Task 2）、`PredictionResolution`（Task 15）
- Produces: `computeOperationResultScore`、`computePredictionAccuracyScore`、`computeWeightedTotalScore`、`rankByCriterion`

- [ ] **Step 1: 自動計算スコアの失敗するテストを書く**

`functions/src/market/evaluation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { computeOperationResultScore, computePredictionAccuracyScore, computeWeightedTotalScore, rankByCriterion } from './evaluation'

describe('computeOperationResultScore', () => {
  it('scores a 10% return as a 10-point gain over the 100-point baseline (starting cash = 100)', () => {
    expect(computeOperationResultScore({ finalAssetValue: 110000, startingCash: 100000 })).toBeCloseTo(110, 9)
  })
})

describe('computePredictionAccuracyScore', () => {
  it('returns the percentage of resolved predictions that were correct', () => {
    expect(computePredictionAccuracyScore([{ outcome: 'CORRECT' }, { outcome: 'CORRECT' }, { outcome: 'INCORRECT' }])).toBeCloseTo(200 / 3, 6)
  })

  it('returns null (not zero) for a team that never submitted a resolved prediction (矛盾解消F)', () => {
    expect(computePredictionAccuracyScore([])).toBeNull()
  })
})

describe('computeWeightedTotalScore', () => {
  const weights = { operationResult: 0.1, predictionAccuracy: 0.3, informationUsage: 0.4, riskManagement: 0.1, reflection: 0.1 }

  it('combines all 5 scores when every one is present', () => {
    const total = computeWeightedTotalScore(
      { operationResult: 100, predictionAccuracy: 80, informationUsage: 90, riskManagement: 70, reflection: 60 },
      weights,
    )
    expect(total).toBeCloseTo(100 * 0.1 + 80 * 0.3 + 90 * 0.4 + 70 * 0.1 + 60 * 0.1, 9)
  })

  it('renormalizes the remaining weights when predictionAccuracy is null (team never predicted)', () => {
    const total = computeWeightedTotalScore(
      { operationResult: 100, predictionAccuracy: null, informationUsage: 90, riskManagement: 70, reflection: 60 },
      weights,
    )
    const remainingWeightSum = 0.1 + 0.4 + 0.1 + 0.1 // 0.7
    const expected = (100 * 0.1 + 90 * 0.4 + 70 * 0.1 + 60 * 0.1) / remainingWeightSum
    expect(total).toBeCloseTo(expected, 9)
  })
})

describe('rankByCriterion', () => {
  it('sorts teams descending by the given criterion, excluding teams with a null score for it', () => {
    const teams = [
      { teamId: 'a', predictionAccuracy: 80 },
      { teamId: 'b', predictionAccuracy: null },
      { teamId: 'c', predictionAccuracy: 95 },
    ]
    const ranked = rankByCriterion(teams, 'predictionAccuracy')
    expect(ranked.map((r) => r.teamId)).toEqual(['c', 'a'])
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/market/evaluation.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`functions/src/market/evaluation.ts`:

```ts
import type { SocialStudiesEvaluationWeights } from '../../../src/lib/lessonTemplates/types'

export const computeOperationResultScore = (input: { finalAssetValue: number; startingCash: number }): number =>
  (input.finalAssetValue / input.startingCash) * 100

export const computePredictionAccuracyScore = (resolutions: { outcome: 'CORRECT' | 'INCORRECT' }[]): number | null => {
  if (resolutions.length === 0) return null
  const correct = resolutions.filter((r) => r.outcome === 'CORRECT').length
  return (correct / resolutions.length) * 100
}

export interface CriterionScores {
  operationResult: number | null
  predictionAccuracy: number | null
  informationUsage: number | null
  riskManagement: number | null
  reflection: number | null
}

/** Renormalizes weights across only the non-null criteria, so a team that
 * skipped predictions (矛盾解消F: excluded, not zeroed) is scored on the
 * remaining criteria's relative weight, not penalized for the gap. */
export const computeWeightedTotalScore = (
  scores: CriterionScores,
  weights: SocialStudiesEvaluationWeights,
): number | null => {
  const entries = (Object.keys(scores) as (keyof CriterionScores)[])
    .map((key) => ({ score: scores[key], weight: weights[key] }))
    .filter((e): e is { score: number; weight: number } => e.score !== null)
  if (entries.length === 0) return null
  const weightSum = entries.reduce((sum, e) => sum + e.weight, 0)
  const weightedSum = entries.reduce((sum, e) => sum + e.score * e.weight, 0)
  return weightedSum / weightSum
}

export const rankByCriterion = <T extends { teamId: string }>(
  teams: T[],
  criterion: keyof T,
): T[] =>
  teams
    .filter((t) => t[criterion] !== null && t[criterion] !== undefined)
    .sort((a, b) => (b[criterion] as unknown as number) - (a[criterion] as unknown as number))
```

- [ ] **Step 4: テストを通す**

Run: `cd functions && npx vitest run src/market/evaluation.test.ts`
Expected: PASS

- [ ] **Step 5: `npm run verify`**

- [ ] **Step 6: Commit**

```bash
git add functions/src/market/evaluation.ts functions/src/market/evaluation.test.ts
git commit -m "feat: add 5-criteria evaluation with auto/rubric split and per-criterion ranking"
```

---

### Task 17: 倒産・配当・分割（既定オフ）

統合仕様書 §12.28・§12.29を実装する。**3機能とも`SocialStudiesMarketContent`のフラグ（Task 2、既定`false`）で無効化されており、無効時は通常の授業フローに一切影響してはならない。** 純粋関数として実装し、`processBatch`（Task 9）は各フラグが`true`のときだけこれらを呼ぶ薄い分岐を持つ（`settleBatch`自体は変更しない——倒産・配当・分割はバッチ約定とは別のタイミングで発生するイベントであり、`settleBatch`の中核ロジックに混ぜ込まない）。

**Files:**
- Create: `functions/src/market/lifecycleEvents.ts`, `.test.ts`

**Interfaces:**
- Consumes: `PriceGuard`（Task 1）
- Produces: `applyBankruptcy(stock)`、`applyDividend(teamHoldingsForStock, dividendPerShare)`、`applyStockSplit(price, holdings, splitRatio)`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/market/lifecycleEvents.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyBankruptcy, applyDividend, applyStockSplit } from './lifecycleEvents'

describe('applyBankruptcy', () => {
  it('sets the price to exactly 0, ignoring the price guard (spec §12.23 "倒産イベントだけガードを無視")', () => {
    const result = applyBankruptcy({ currentPrice: 500, priceGuard: { type: 'ABSOLUTE', minimumPrice: 100 } })
    expect(result.newPrice).toBe(0)
    expect(result.tradingHalted).toBe(true)
  })
})

describe('applyDividend', () => {
  it('pays cash proportional to holdings, at the configured per-share amount', () => {
    expect(applyDividend({ heldShares: 10, dividendPerShare: 20 })).toBe(200)
  })
  it('pays nothing for zero holdings', () => {
    expect(applyDividend({ heldShares: 0, dividendPerShare: 20 })).toBe(0)
  })
})

describe('applyStockSplit', () => {
  it('divides price and multiplies holdings by the split ratio (e.g. a 1:2 split)', () => {
    const result = applyStockSplit({ price: 2000, heldShares: 10, splitRatio: 2 })
    expect(result).toEqual({ newPrice: 1000, newHeldShares: 20 })
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/market/lifecycleEvents.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`functions/src/market/lifecycleEvents.ts`:

```ts
import type { PriceGuard } from '@stock-league/market-authoring-content'

export const applyBankruptcy = (input: { currentPrice: number; priceGuard: PriceGuard }): { newPrice: number; tradingHalted: boolean } => {
  // Deliberately ignores input.priceGuard — spec §12.23's sole exception.
  return { newPrice: 0, tradingHalted: true }
}

export const applyDividend = (input: { heldShares: number; dividendPerShare: number }): number =>
  input.heldShares * input.dividendPerShare

export const applyStockSplit = (input: { price: number; heldShares: number; splitRatio: number }): { newPrice: number; newHeldShares: number } => ({
  newPrice: input.price / input.splitRatio,
  newHeldShares: input.heldShares * input.splitRatio,
})
```

- [ ] **Step 4: テストを通す**

Run: `cd functions && npx vitest run src/market/lifecycleEvents.test.ts`
Expected: PASS

- [ ] **Step 5: `processBatch`（Task 9 Step 7）へフラグ分岐を追記する失敗するテストを書く（`bankruptcyEnabled`等が`false`のとき一切呼ばれないことを検証する）**

`functions/src/market/processBatch.test.ts`に追記する（Task 9で作成済みのテストファイル）:

```ts
it('never calls applyBankruptcy/applyDividend/applyStockSplit when all three flags are false (default)', async () => {
  const applyBankruptcy = vi.fn()
  const applyDividend = vi.fn()
  const applyStockSplit = vi.fn()
  await processBatch({
    /* ...Task 9で確立した他の依存関係... */
    applyBankruptcy, applyDividend, applyStockSplit,
    socialStudiesMarket: { bankruptcyEnabled: false, dividendEnabled: false, stockSplitEnabled: false /* ...省略 */ },
  })
  expect(applyBankruptcy).not.toHaveBeenCalled()
  expect(applyDividend).not.toHaveBeenCalled()
  expect(applyStockSplit).not.toHaveBeenCalled()
})
```

- [ ] **Step 6: `processBatch`にフラグ分岐を実装する**

`processBatch`（Task 9 Step 7の責務リストのStep 6の直後）に「有効なライフサイクルイベントがあれば適用する」を追加する。倒産は教師の明示操作（別Callable、本タスクの範囲では純粋関数のみを提供し、Callable自体はTask 11のパターンを踏襲して実装時に追加する）、配当・分割は教材設定の`triggerBatchIndexes: number[]`（`SocialStudiesMarketContent`に追加。既定は空配列＝発生しない）で指定されたバッチでのみ発火させる。

- [ ] **Step 7: `npm run verify`**

- [ ] **Step 8: Commit**

```bash
git add functions/src/market/lifecycleEvents.ts functions/src/market/lifecycleEvents.test.ts functions/src/market/processBatch.ts functions/src/market/processBatch.test.ts
git commit -m "feat: add opt-in bankruptcy/dividend/stock-split lifecycle events, default disabled"
```

---

### Task 18: 並行実行テスト（§30-4）

統合仕様書 §30-4「注文・約定・価格更新は、単体テストだけでなく並行実行テストを作る」を実装する。Task 1〜17までの純粋関数テストはすべて同期的で、真の競合状態（同時書き込みによる取りこぼし）を検出できない。本タスクは**Firestore Emulatorに対して実際に並行リクエストを送る**統合テストとし、`npm run test:rules`とは別に`npm run test`（Vitest、Emulator接続）で実行する。

**Files:**
- Create: `functions/src/market/concurrentBatch.test.ts`

**Interfaces:**
- Consumes: `applySoftLockForNewOrder`（Task 7）、`createPendingOrder`（Task 5）、`settleBatch`（Task 9）

- [ ] **Step 1: 同時ソフト拘束が現金超過を許さないことの失敗するテストを書く（最も直接的な二重支出テスト）**

`functions/src/market/concurrentBatch.test.ts`（Firestore Emulatorが起動している前提。`firebase emulators:exec`または既存の`npm run test`のEmulator起動設定に合わせる）:

```ts
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { beforeAll, describe, expect, it } from 'vitest'
import { applySoftLockForNewOrder, getOrInitTeamAccount } from '../lessonRuns/teamAccounts/repository'

let db: FirebaseFirestore.Firestore

beforeAll(() => {
  initializeApp({ projectId: 'demo-concurrent-test' })
  db = getFirestore()
})

describe('concurrent order submission (spec §30-4)', () => {
  it('never lets the sum of concurrently-accepted buy orders exceed the team\'s cash, even when 20 requests race', async () => {
    const lessonRunId = 'run-concurrent-1'
    const teamId = 'team-a'
    await getOrInitTeamAccount({ firestore: db, lessonRunId, teamId, startingCash: 10000, now: () => Date.now() })

    // 20 concurrent 1,000-yen orders against 10,000 cash — at most 10 may
    // legitimately succeed. If the transaction has a race, more than 10
    // will succeed and total locked value will exceed 10,000.
    const results = await Promise.all(
      Array.from({ length: 20 }, () => applySoftLockForNewOrder({
        firestore: db, lessonRunId, teamId, side: 'BUY', stockId: 'acme',
        quantity: 1, referencePrice: 1000, now: () => Date.now(),
      })),
    )

    const acceptedCount = results.filter((r) => r.accepted).length
    expect(acceptedCount).toBeLessThanOrEqual(10)

    const finalAccount = await db.doc(`lessonRuns/${lessonRunId}/teamAccounts/${teamId}`).get()
    expect((finalAccount.data() as { lockedBuyValue: number }).lockedBuyValue).toBeLessThanOrEqual(10000)
  })

  it('assigns every concurrently-submitted order a unique orderId even under simultaneous idempotencyKeys from different teams', async () => {
    const lessonRunId = 'run-concurrent-2'
    const { createPendingOrder } = await import('../lessonRuns/orders/repository')
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => createPendingOrder({
        firestore: db, lessonRunId, batchId: 'batch-1', teamId: `team-${i}`,
        stockId: 'acme', side: 'BUY', quantity: 1, referencePrice: 1000,
        idempotencyKey: `idem-${i}`, now: () => Date.now(),
      })),
    )
    const orderIds = results.map((r) => r.orderId)
    expect(new Set(orderIds).size).toBe(orderIds.length)
  })
})

describe('multiple teams settling in the same batch (spec §27.2 "同一区間の全注文が同価格")', () => {
  it('produces one uniform execution price for all teams\' orders in the same batch, regardless of submission order', async () => {
    // Exercises the same settleBatch (Task 9) already covered by unit
    // tests, but here the ORDERS are submitted concurrently via
    // createPendingOrder against the emulator first, then read back and
    // fed into settleBatch — closing the loop between "concurrent writes
    // land correctly" and "settlement reads them all consistently".
    const lessonRunId = 'run-concurrent-3'
    const { createPendingOrder, listPendingOrdersForBatch } = await import('../lessonRuns/orders/repository')
    await Promise.all(
      Array.from({ length: 5 }, (_, i) => createPendingOrder({
        firestore: db, lessonRunId, batchId: 'batch-1', teamId: `team-${i}`,
        stockId: 'acme', side: 'BUY', quantity: 1, referencePrice: 1000 + i,
        idempotencyKey: `race-${i}`, now: () => Date.now(),
      })),
    )
    const orders = await listPendingOrdersForBatch({ firestore: db as never, lessonRunId, batchId: 'batch-1' })
    expect(orders).toHaveLength(5)
    // executionPrice is determined by settleBatch from the stock's
    // currentPrice, NOT from any individual order's referencePrice — this
    // assertion documents that submission order/timing cannot influence it.
    const referencePrices = new Set(orders.map((o) => o.referencePrice))
    expect(referencePrices.size).toBeGreaterThan(1) // orders WERE submitted with different reference prices
    // ...settleBatch (Task 9) applied to these orders would fill all 5 at
    // the single stock.currentPrice, already proven by Task 9's unit tests;
    // this test's job is only to prove concurrent writes didn't corrupt or
    // drop any of the 5 orders before settlement reads them.
  })
})
```

- [ ] **Step 2: Emulatorを起動してテストを実行し、失敗を確認する**

Run: `firebase emulators:exec --only firestore "cd functions && npx vitest run src/market/concurrentBatch.test.ts"`
Expected: FAIL — `db`が空のプロジェクトを指しているためドキュメントが見つからない、または対象モジュールが未実装

- [ ] **Step 3: Task 5・7で実装済みの`createPendingOrder`/`applySoftLockForNewOrder`/`listPendingOrdersForBatch`をAdmin SDKの`Firestore`インスタンスへ直接バインドできることを確認する**

Task 5・7では`FirestoreLike`という最小インターフェース（`runTransaction`のみ）を定義した。Admin SDKの`Firestore`インスタンスはこのインターフェースを満たすため、追加のアダプタなしにそのまま渡せる。もし型が合わない場合は`FirestoreLike`のシグネチャをAdmin SDKの実際の型に合わせて調整する（このタスクで初めてAdmin SDKと接続するため、ここで初めて型の食い違いが顕在化する可能性が高い）。

- [ ] **Step 4: テストを通す**

Run: `firebase emulators:exec --only firestore "cd functions && npx vitest run src/market/concurrentBatch.test.ts"`
Expected: PASS

- [ ] **Step 5: `package.json`の`verify`スクリプトに、Emulator経由の並行実行テストを含める**

Global Constraintsの`npm run verify`が`test`ステップの一部として本テストも実行するよう、`functions/package.json`の`test`スクリプトが`concurrentBatch.test.ts`を含む対象に含まれていることを確認する（除外設定があれば外す）。

- [ ] **Step 6: `npm run verify`**

- [ ] **Step 7: Commit**

```bash
git add functions/src/market/concurrentBatch.test.ts functions/package.json
git commit -m "test: add Firestore-emulator concurrency tests for order submission and batch settlement (spec §30-4)"
```

---

### Task 19: 受け入れテスト（§27.2）と完了条件の確定

統合仕様書 §27.2の市場受け入れテスト11項目を、Task 1〜18で書いたテストへ1つずつ対応付ける。**2項目（6・11）は既存タスクのテストだけではカバーできていないため、本タスクで新しいテストを追加して埋める。**

**Files:**
- Modify: `functions/src/lessonRuns/orders/repository.test.ts`（項目6）
- Create: `functions/src/market/replayDeterminism.test.ts`（項目11）

**§27.2の11項目と対応するテストの対応表:**

| # | 受け入れ項目 | 対応するテスト |
| --- | --- | --- |
| 1 | 同一区間の全注文が同価格 | Task 9 `settleBatch.test.ts`「fills all orders for a stock at the SAME price」 |
| 2 | 二重送信が1回だけ約定 | Task 5「is idempotent per idempotencyKey」＋ Task 10「does nothing for a duplicate delivery of an already-processed batchId」 |
| 3 | 処理中取消不可 | Task 8「refuses to cancel an order that already moved to PROCESSING」 |
| 4 | 資金不足の買い注文が全不成立 | Task 9「rejects ALL of a team's buy orders ACROSS EVERY STOCK」 |
| 5 | 同一区間売却代金が購入に使われない | Task 6「excludes this batch's own sell proceeds from the cash basis」（`cashBeforeBatch`が呼び出し側の責務であることを明示） |
| 6 | 参考価格と約定価格が履歴に残る | **未カバー。Step 1で追加する。** |
| 7 | 価格ガードを下回らない | Task 3「never returns a price below the guard even with a large negative swing」 |
| 8 | 倒産時だけ0円になる | Task 17「sets the price to exactly 0, ignoring the price guard」＋ Task 3のガードテスト（通常経路では0円に到達しないことの対照） |
| 9 | 停止後注文が受理されない | Task 7「rejects when the market is paused」 |
| 10 | 再開確認時間後に同時受付 | Task 12「records a resumeScheduledAtMillis...」＋「unpauses and restarts the batch chain」（`marketPaused`が単一の書き込みで全員へ同時に反映される設計） |
| 11 | リプレイで同じイベント列を再現できる | Task 3「is deterministic for the same seed inputs」が単一バッチの決定性を示すのみ。**複数バッチにまたがる決定性は未カバー。Step 3で追加する。** |

- [ ] **Step 1: 項目6（参考価格と約定価格が履歴に残る）の失敗するテストを書く**

`functions/src/lessonRuns/orders/repository.test.ts`に追記する:

```ts
describe('order history retains both reference price and execution price (spec §12.11/§27.2 item 6)', () => {
  it('keeps referencePrice unchanged and adds executionPrice when transitioning to FILLED', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1/orders/order-1', {
      orderId: 'order-1', status: 'PROCESSING', referencePrice: 1000,
    })
    await transitionOrderStatus({
      firestore: fake as never, lessonRunId: 'run-1', orderId: 'order-1',
      from: 'PROCESSING', to: 'FILLED', patch: { executionPrice: 1030 },
    })
    const stored = fake.docs.get('lessonRuns/run-1/orders/order-1')
    expect(stored).toMatchObject({ referencePrice: 1000, executionPrice: 1030, status: 'FILLED' })
  })
})
```

- [ ] **Step 2: 失敗を確認し、実装を確認する**

Run: `cd functions && npx vitest run src/lessonRuns/orders/repository.test.ts`
Expected: `transitionOrderStatus`はTask 5で`patch`引数を既に受け取る設計になっているため、このテストは追加のプロダクションコード変更なしにPASSするはずである。FAILする場合はTask 5の`transitionOrderStatus`実装が`patch`を`tx.update`へ渡していない不具合であり、その場で修正する。

- [ ] **Step 3: 項目11（複数バッチにまたがるリプレイ決定性）の失敗するテストを書く**

`functions/src/market/replayDeterminism.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { settleBatch, type SettleBatchInput } from './engine/settleBatch'

describe('multi-batch replay determinism (spec §27.2 item 11 / 矛盾解消D)', () => {
  it('re-running the same sequence of batches with the same randomSeed+restoreGeneration reproduces identical prices and outcomes', () => {
    const runSequence = (): unknown[] => {
      let currentPrice = 1000
      const results: unknown[] = []
      for (let batchIndex = 0; batchIndex < 5; batchIndex += 1) {
        const input: SettleBatchInput = {
          lessonRunId: 'run-1', batchId: `run-1_batch_${batchIndex}`, batchIndex,
          randomSeed: 'replay-seed', restoreGeneration: 0,
          priceSensitivityPreset: 'BALANCED', noiseEnabled: true,
          stocks: [{
            stockId: 'acme', currentPrice, initialPrice: 1000,
            priceGuard: { type: 'ABSOLUTE', minimumPrice: 1 },
            effectiveMarketSize: 100000, demandSensitivity: 1, informationImpactPercent: 0,
          }],
          orders: [{ orderId: `o${batchIndex}`, teamId: 'team-a', stockId: 'acme', side: 'BUY', quantity: 1, referencePrice: currentPrice }],
          teamAccounts: [{ teamId: 'team-a', cash: 1000000, holdings: {} }],
        }
        const result = settleBatch(input)
        currentPrice = result.stocks[0].nextPrice
        results.push(result)
      }
      return results
    }

    expect(runSequence()).toEqual(runSequence())
  })

  it('a DIFFERENT restoreGeneration produces a different sequence — replay after a checkpoint restore is not a silent no-op (矛盾解消E/D)', () => {
    const runWithGeneration = (restoreGeneration: number) => settleBatch({
      lessonRunId: 'run-1', batchId: 'run-1_batch_0', batchIndex: 0,
      randomSeed: 'replay-seed', restoreGeneration,
      priceSensitivityPreset: 'BALANCED', noiseEnabled: true,
      stocks: [{
        stockId: 'acme', currentPrice: 1000, initialPrice: 1000,
        priceGuard: { type: 'ABSOLUTE', minimumPrice: 1 },
        effectiveMarketSize: 100000, demandSensitivity: 1, informationImpactPercent: 0,
      }],
      orders: [], teamAccounts: [],
    })
    expect(runWithGeneration(0).stocks[0].nextPrice).not.toBe(runWithGeneration(1).stocks[0].nextPrice)
  })
})
```

- [ ] **Step 4: 失敗を確認し、テストを通す**

Run: `cd functions && npx vitest run src/market/replayDeterminism.test.ts`
Expected: `settleBatch`・`calculateNextPrice`はTask 3・9で既に決定的に実装されているため、実装済みコードのままPASSするはずである。FAILする場合は`Date.now()`や`Math.random()`がどこかに紛れ込んでいる可能性が高く、その箇所を洗い出して修正する。

- [ ] **Step 5: Phase C全体の完了条件を確認する**

以下すべてを満たすことをPhase C完了の条件とする:

1. `npm run verify`（`lint` → `typecheck` → `test` → `test:rules` → `build` → `functions`/`packages/*`の`verify`）が全ワークスペースでPASSする。
2. 上表の§27.2 11項目すべてに対応するテストが存在し、PASSする。
3. Task 18の並行実行テスト（Firestore Emulator）がPASSする。
4. 生徒向けに配信されるデータ（`lessonRunPublic`・`lessonRunTeamState`のRTDB書き込み内容、および`toPublicView`の出力）を目視確認し、`impactSensitivities`・`InformationImpact`・`randomSeed`・将来バッチの価格のいずれも含まれていないことを確認する（Task 1・13の型テストは構造を保証するが、実際のAdmin SDK書き込みコードが型を無視して余分なフィールドを書いていないかは目視確認が必要）。
5. 本計画内でPROVISIONAL（試運転で調整する暫定値）と明記した定数——`PRICE_SENSITIVITY_PRESETS`（Task 3）、`DEFAULT_NOISE_MAGNITUDE_PERCENT`（Task 3）、`DEFAULT_SUDDEN_CHANGE_WARNING_THRESHOLD_PERCENT`（Task 3）、`SHORT_TERM_WINDOW_BATCHES`（Task 9 Step 7）、`FLAT_BAND_PERCENT`（Task 15）、`STALL_DETECTION_THRESHOLD_MILLIS`（Task 10）——を1箇所の一覧（教師向け「詳細設定」画面、または`functions/src/market/engine/tuningConstants.ts`のような単一ファイル）にまとめ、後続の試運転フェーズで参照できるようにする。この一覧化自体をタスクの完了条件に含める。
6. Task 13 Step 9の前提チェックリスト（`lessonRunPublic`の生徒読み取り許可、`teamMembership`ミラーの実在確認）が解消されている。

- [ ] **Step 6: `npm run verify`**

- [ ] **Step 7: Commit**

```bash
git add functions/src/lessonRuns/orders/repository.test.ts functions/src/market/replayDeterminism.test.ts
git commit -m "test: close the two §27.2 acceptance-test gaps (order history, multi-batch replay determinism)"
```
