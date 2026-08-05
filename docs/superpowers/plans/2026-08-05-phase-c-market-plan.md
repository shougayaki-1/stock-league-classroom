# Phase C: 社会科完成（常時売買・3秒バッチ市場）Implementation Plan

> **未完成。Task 1〜8 のみ詳細まで記述済み。Task 9〜19 は §「タスク一覧」の1行タイトルのみで、ステップ・コード例・検証方法が書かれていない。** 続きを書く場合は、Task 1〜8 と同じ密度（Files / Interfaces / Step ごとのテストコード / Run / Expected）で Task 9 から埋めること。書き終わったタスクから随時ファイルへ保存し、一度に全部書こうとしないこと（前の試行がこれで2回失敗した）。



> **正本は統合仕様書。** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md`（§12、§27.2、§28、§30-4）と `docs/superpowers/specs/2026-08-05-integrated-spec-resolutions.md`（矛盾解消 A・B・C・D・F）が優先する。本計画と両文書が矛盾する場合は両文書を優先し、本計画側の誤りとして扱う。
>
> **前提: Phase A・Phase B は完了済み。** `orgId`所有、権限3層、`LessonRun`/`LessonEvent`/`LessonCheckpoint`、`restoreGeneration`、決定的PRNG（`packages/deterministic-random`）、`lessonRunPublic`/`lessonRunPrivate`のRTDBパス分離、`functions/`パッケージ、教師画面・生徒画面・教室表示・参加・チーム・フェーズ進行が揃っている。**ただしPhase Bの実装計画ドキュメントは本リポジトリに存在しない**（`docs/superpowers/plans/`にPhase B専用の計画がない）。本計画はチーム帰属の検証手段・生徒の`lessonRunPublic`読み取り許可がPhase Bで提供されている前提で設計するが、正確なルール文字列・RTDBパス名はPhase C着手時にPhase Bの実装成果物（コード）と突き合わせて確認すること。差異があれば本計画のTask 13・Task 7のルール定義を実際の形へ合わせる。
>
> **旧実装（`hostTrading.ts`、`pricingCore.ts`、`liveMarketTypes.ts`等）はPhase Aで削除済みの前提。** 参照する場合は`git log`のみとし、詳細を読み込む必要はない。
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 教師が作成した企業・情報・決算・指標を教材として、生徒が授業時間中いつでも注文でき、サーバーが3秒ごとに区間を締め切って同一価格で約定し、需給・情報・ノイズから次価格を計算し、資金・株を正しく拘束し、市場停止・再開・予想チェックポイント・評価・チャートまでを一貫して提供する、社会科・市場経済シミュレーションの中核機能を実装する。

**Architecture:** 3秒区間の駆動はCloud Tasksの自己連鎖（矛盾解消A）とし、教師のブラウザに依存しない。区間締切のたびにCloud Functionsが起動し、`lessonRuns/{id}/orders`サブコレクション（Firestore）に溜まった`PENDING`注文を検証・相殺・約定し、`LessonEvent`へ追記し、次価格をRTDBの`lessonRunPublic/{lessonRunId}`（生徒が読める）へ書き込み、企業の非公開係数と内部計算ログは`lessonRunPrivate/{lessonRunId}`（教師のみ）へ、チーム別の拘束中資金・保有株・自分の注文状態は新設する`lessonRunTeamState/{lessonRunId}/{teamId}`（そのチームのメンバーのみ）へ書き込む——3つとも祖先を共有しない別々のトップレベルRTDBノードとし、Phase Aが確立したルールカスケード対策（祖先の`.read`は子孫の`.read: false`で取り消せない）を踏襲する。価格計算・需給集計・資金拘束判定・バッチ約定はすべて純粋関数として`functions/src/market/engine/`に実装し、Cloud Tasksハンドラ・Callableはこれらの純粋関数を呼ぶ薄いI/O層にする。乱数はPhase Aの`packages/deterministic-random`（`deriveSeed`/`mulberry32`）のみを使い、`Math.random()`は一切使わない。

企業・情報の型は「誰が読めるか」で2段に分ける。**この境界はJSのimportグラフではなく、Firestore/RTDBのセキュリティルール（どのドキュメント/ノードを誰が読めるか）で強制する**——教師の認証済みブラウザは教材作成のために非公開の影響設定（`impactSensitivities`・`InformationImpact`）を当然読み書きする必要があり、「`src/`からimportしない」という制約では教師UIが成立しない。実際に効くのは、(1) 生の非公開データを含む`LessonTemplate.draft`・`LessonRun.templateSnapshot`（Firestore）が組織メンバー（教師）にしか読めないこと、(2) 生徒が読める唯一の経路であるRTDB`lessonRunPublic`には、サーバー（Functions）が`toPublicView`で機械的に間引いた後のデータしか書き込まれないこと、の2点である。型としては`packages/market-authoring-content`（`SimulatedCompany`・`InformationItem`・`InformationImpact`・`EconomicIndicatorAuthoring`。教師authoring UIとFunctions engineの両方がimportする）と`packages/market-public-content`（`CompanyPublicView`・`InformationPublicView`・`EconomicIndicatorPublicView`。生徒向けUIとFunctionsの両方がimportする）に分ける。**間引き変換関数`toPublicView`自体はFunctions専用**とする——「生徒に何を見せてよいかを決める権限をクライアントコードに持たせない」ことが目的であり、実際に生徒へ届く値を作る唯一の場所をサーバーに固定するための設計判断であって、import境界そのものがセキュリティ境界ではない点に注意。

**Tech Stack:** TypeScript, Firebase Firestore（`lessonRuns/{id}/orders`サブコレクション、トランザクション）, Firebase Realtime Database（`lessonRunPublic`/`lessonRunPrivate`/`lessonRunTeamState`）, Cloud Functions for Firebase v2（`onCall`、Cloud Tasksタスクキュー`onTaskDispatched`系）, `packages/deterministic-random`, Vitest, `@firebase/rules-unit-testing`。

## Global Constraints

- 各タスクは完了時に `npm run verify`（`lint` → `typecheck` → `test` → `test:rules` → `build` → `functions`/`packages/*` の `verify`）を通すこと。
- 乱数は`Math.random()`禁止。`packages/deterministic-random`の`deriveSeed`/`mulberry32`のみを使う（矛盾解消D）。シード導出式は `derive(`${randomSeed}:${restoreGeneration}:${stockId}:${batchIndex}`)` に固定する。
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
| `functions/src/market/submitOrder.ts`, `.test.ts`, `onCall.ts` / `src/lib/market/submitOrder.ts`, `.test.ts` | Create（Task 7） |
| `functions/src/market/cancelOrder.ts`, `.test.ts`, `onCall.ts` / `src/lib/market/cancelOrder.ts`, `.test.ts` | Create（Task 8） |
| `functions/src/market/engine/settleBatch.ts`, `.test.ts` | Create（Task 9。バッチ締切処理の中核純粋関数） |
| `functions/src/market/processBatch.ts`, `.test.ts` | Create（Task 9。Admin SDKラッパー） |
| `functions/src/market/batchScheduler.ts`, `.test.ts`, `taskHandler.ts` | Create（Task 10。Cloud Tasks自己連鎖） |
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

- [ ] **Step 3: `package.json`・`tsconfig.json`を作成する（`packages/deterministic-random`と同一構成）**

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

`tsconfig.json`は`packages/deterministic-random/tsconfig.json`をそのまま複製する。ルート`package.json`の`workspaces`へ`"packages/market-public-content"`を追加し、`functions/package.json`の`dependencies`へ`"@stock-league/market-public-content": "*"`を追加する。

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

統合仕様書 §12.20（概念式）・§12.21（需給影響）・§12.22（市場ノイズ）・§12.23（価格ガード）・§12.24（急変表示）・§12.31（内訳表示）を実装する。純粋関数とし、Cloud Tasksハンドラ（Task 10）から呼ばれる。**乱数は`packages/deterministic-random`のみを使う。**

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

- [ ] **Step 9: `npm run verify`**

- [ ] **Step 10: Commit**

```bash
git add functions/src/market/engine/priceCalculation.ts functions/src/market/engine/priceCalculation.test.ts
git commit -m "feat: add deterministic price calculation engine with guard and breakdown"
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

(以下、各タスクの詳細)
