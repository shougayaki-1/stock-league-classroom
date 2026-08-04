# Phase 1.4〜1.6: ラウンド進行エンジンと予想・振り返り Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ラウンドモードの授業を1コマ通しで実施できるようにする — 教師が「次へ」で8フェーズ（導入／情報収集／個人予想／チーム相談／売買／変動／解説／振り返り）を進行し、締切時に全チームを同一条件で一括約定し、ニュースと需給を銘柄別に価格へ反映し、生徒の予想と判断理由を記録して振り返りグラフとルーブリックで評価できる状態にする。クラシックモードの `placeContinuousOrder()` サーバー化も本計画に含む。

**Architecture:** 既存の `liveMarkets/{marketId}` RTDBツリーをラウンドモード用に拡張する（新規のFirestoreコレクションは作らない）。価格・約定の権威はCloud Functions（Callable）に置く — ラウンドの進行 (`advancePhase`) と一括約定 (`settleRound`) は教師のブラウザではなくサーバーが実行し、将来のニュース・需給パラメータは `privateEngineState` ノードに置いて **全クライアント（教師のブラウザを含む）から `.read: false`** にする。これにより「先読み脆弱性は原理的に発生しない」という設計目標と「教師のタブが背面・スリープでも影響を受けない」という設計目標の両方を満たす。チームの注文案（`TeamRoundDecision`）自体は秘匿すべき情報を含まないため、既存の `applyPauseMarket` / `applyApproveJoinRequest` と同じ「純粋関数 + RTDB `runTransaction`」パターンで教師・生徒のブラウザから直接編集する。約定の中核計算（検証・ニュース影響・需給影響・価格合成）は `src/lib/pricing`/`src/lib/market` 配下の純粋関数として実装し、Cloud Functionsとクライアント（プレビュー用の即時バリデーション）の双方から同じ関数を呼ぶ。これは Phase 1.3 が確立した「`pricingCore` をクライアントとFunctionsで共有する」仕組みをそのまま踏襲する。

**Tech Stack:** TypeScript, React + MUI（既存コンポーネント資産）, Firebase Realtime Database（`runTransaction`）, Firebase Cloud Functions v2 (`onCall`), Firebase Admin SDK, Vitest, `@firebase/rules-unit-testing`（`npm run test:rules`）。

## Global Constraints

- 前提として1.1〜1.3が完了しているものとして計画する。全ドキュメントに `orgId` / `createdByUid` がある。`LessonTemplate v2` のスキーマと版管理がある。`functions/` パッケージがあり、`src/lib/pricing/pricingCore.ts` がクライアントとCloud Functionsで共有されている。**これらの実際のファイルパス・型名は `docs/superpowers/plans/2026-08-05-phase1a-org-schema-functions-plan.md` の実施結果で確定する。** 本計画のTaskで参照する `functions/src/...` のパスと `LessonTemplate v2` のスキーマファイルパスは執筆時点で存在しないため妥当な推定であり、**Task 1 の最初のステップとして実際のパスと突き合わせ、食い違っていれば以降のTaskのimportパスを合わせて調整すること。**
- 対象は社会科のラウンド制授業（Phase 4の家庭科モード、Phase 2のResearch Desk / Guided Lesson Builder、Phase 5の組織UI・課金は対象外）。
- 各Taskの完了条件に `npm run verify`（`lint` → `typecheck` → `test` → `test:rules` → `build`）が通ることを含める。個別のユニットテストで確認した後、Taskの最後に必ず1回 `npm run verify` を実行する。
- **約定価格は売買フェーズ中に公開されていた価格。需給は次ラウンドの開始価格へのみ反映する。** 板寄せ方式・需給反映後の即時約定は採用しない（設計で明示的に不採用と決定済み）。
- **需給計算の入力は検証後の約定予定数量のみ。** 未検証の注文を需給計算に混ぜてはならない（順序を守らないと所持金超過の買い注文で価格を釣り上げる操作が成立する）。
- 価格変化の合成は「変化率を加算してから ±20% で丸める」。上下限は既存の `NEWS_IMPACT_LIMIT`（`src/lib/market/hostTrading.ts:225`、値は20）を再利用し、重複定義しない。
- `TeamRoundDecision` は編集すると `submitted` が `false` に戻る。`settleRound` は `submitted === true` のチームのみを約定する。
- クラシックモードの `placeContinuousOrder()` はサーバーが価格を再計算しない。`hostLease` の有効性と `prices/{stockId}.updatedAtMillis` の鮮度を確認し、最後に公開された価格をそのまま使う。
- `settlementPriceHistory` が振り返りグラフの正本。`revealAnimation` の途中価格を履歴として保存・表示してはならない（設計で明示的に警告されている混同）。
- 個人単位の削除・CSVエクスポートは無料機能。操作主体は教師（生徒は匿名認証でセッションを失うと本人確認ができないため）。
- 「根拠の妥当性」をシステムが自動採点しない。評価指標は自動計算とルーブリック（教師評価）を型レベルで分離する。

---

## 前提として使う既存コードの重要な事実（実装前に必ず踏まえること）

`hostTrading.ts` を全文読んで判明した、設計ドキュメントには書かれていない事実。ラウンドモードを既存のクラシックモード基盤の上に増築するにあたり、次の3点が特に重要:

1. **現行の注文フローは「生徒がRTDBへ直接書く → ホストのブラウザが `runHostTick` の中で1秒ごとに拾って約定する」という、教師のブラウザが約定エンジンそのものである設計になっている。** `submitOrder`（`hostTrading.ts:147`）は生徒の参加者IDでRTDBへ直接 `orders/{participantId}/pending` を書き込むだけで、約定は関与しない。実際の約定は `processPendingOrder`（`hostTrading.ts:164`）が担い、これは `runHostTick`（`hostTrading.ts:292`）が `ownsLiveLease` を確認した上で毎秒回している。`placeContinuousOrder()` をCloud Functionsの `onCall` にする、というPhase 1.4の要件は、この「ホストのブラウザが約定を実行する」という前提を「生徒の注文送信を起点にサーバーが即時約定する」という前提へ丸ごと置き換える。**単に新しい関数を足すのではなく、既存の `submitOrder` → `processPendingOrder` の経路をサーバー実行へ切り替える設計変更である。** `database.rules.json` の `orders/$participantId/pending` の `.write` ルール（生徒本人が直接書ける）もこの新経路では意味が変わる — 生徒はもう「注文を置くだけ」ではなく「Callableを呼ぶ」に変わるため、既存の直接書き込みルールをどう扱うか（廃止するか、Callable経由の書き込みと共存させるか）をTask 6で明示的に決める。
2. **`applyNewsImpact` は全銘柄へ同じ%を機械的に適用する設計であり、`stockId` ごとの分岐が一切ない。** `hostTrading.ts:232` の実装は `Object.entries(state.prices)` を単純にループし、渡された1つの `impactPercent` を全銘柄の `runtime.startPrice` / `runtime.endPrice` に掛けている。Phase 1.5の「銘柄別ニュース」は、この関数のシグネチャ自体を `impactPercent: number` から `Record<stockId, number>` へ変える必要がある、書き換えというより置き換えに近い変更である。
3. **`runHostTick` は「価格を書く → 全 `orders` をループして約定する → leaderboardを書く」の3段を1秒ごとに直列実行しており、これはクラシックモード専用のループである。** ラウンドモードはこのループに一切乗らない（`advancePhase`/`settleRound` というイベント駆動のCallableに置き換える）ため、`ControlRoom.tsx` は現状「1つの `lease`/`runHostTick` の仕組みで両モードを進行する」前提で書かれているが、ラウンドモードの市場では `runHostTick` のインターバルを起動してはならない。Task 8で `ControlRoom.tsx` を `live.meta.mode`（新設）で分岐させる必要があり、これを見落とすとラウンドモードの市場でも1秒ごとにクラシックモード用の `publishPrices`/`processPendingOrder` が走り、`prices` ノードを汚染する。

---

## File Structure

| File | 変更 |
| --- | --- |
| `src/lib/market/roundTypes.ts` | 新規。`RoundPhaseName`, `LessonRound`, `TeamRoundDecision`, `PlannedOrder`, `ValidatedOrder`, `PublicRoundQuote`, `RevealAnimation`, `SettlementBreakdown`, `SettlementPriceEntry`, `ScheduledNewsImpact` |
| `src/lib/market/roundEngine.ts` | 新規。フェーズ状態機械、注文検証、ニュース・需給の合成、`settleRoundPure`。クライアントとFunctionsの双方から呼ぶ純粋関数のみを置く |
| `src/lib/market/roundEngine.test.ts` | 新規 |
| `src/lib/market/roundTrading.ts` | 新規。`TeamRoundDecision` のRTDB `runTransaction` ラッパー（編集・確定） |
| `src/lib/market/roundTrading.test.ts` | 新規 |
| `src/lib/market/predictionTypes.ts` | 新規。`PersonalPrediction` |
| `src/lib/market/predictionTrading.ts` | 新規。個人予想のRTDB読み書き |
| `src/lib/market/predictionTrading.test.ts` | 新規 |
| `src/lib/market/liveMarketTypes.ts` | 変更。`LiveMarketMetadata.mode: 'CLASSIC' \| 'ROUND'` を追加 |
| `functions/src/round/settleRound.ts` | 新規。`onCall` ラッパー。冪等キー・Admin SDK永続化 |
| `functions/src/round/settleRound.test.ts` | 新規 |
| `functions/src/round/advancePhase.ts` | 新規。`onCall`。フェーズ進行・ラウンド開始 |
| `functions/src/round/advancePhase.test.ts` | 新規 |
| `functions/src/round/placeContinuousOrder.ts` | 新規。`onCall`。クラシックモード即時約定 |
| `functions/src/round/placeContinuousOrder.test.ts` | 新規 |
| `functions/src/index.ts` | 変更。3つの `onCall` をexport |
| `database.rules.json` | 変更。`rounds`, `publicQuote`, `settlementPriceHistory`, `privateEngineState` ノードを追加 |
| `test/database.rules.test.ts` | 変更。新ノードの読み書きマトリクスを追加 |
| `src/lib/templates/types.ts`（実パスはTask 1で確定） | 変更。`market.marketDepthWeight`, `market.sensitivity`, `market.maxDemandImpact`, `market.demandLinkedPricing` を追加 |
| `src/components/teacher/ControlRoom.tsx` | 変更。`live.meta.mode` で `runHostTick` ループとラウンドモードUIを分岐 |
| `src/components/teacher/RoundControlPanel.tsx` | 新規。フェーズ表示・「次へ」ボタン |
| `src/components/teacher/RoundControlPanel.test.tsx` | 新規 |
| `src/components/teacher/NewsPublishPanel.tsx` | 変更。銘柄選択・遅延ラウンド指定を追加 |
| `src/components/teacher/NewsPublishPanel.test.tsx` | 変更 |
| `src/components/teacher/RoundResultsPanel.tsx` | 新規。ニュース/需給の内訳・出来高表示 |
| `src/components/teacher/RoundResultsPanel.test.tsx` | 新規 |
| `src/components/teacher/ParticipantResultsPanel.tsx` | 新規。個人単位の削除・匿名化・エクスポートUI |
| `src/components/teacher/ParticipantResultsPanel.test.tsx` | 新規 |
| `src/components/student/TeamOrderPanel.tsx` | 新規。ラウンドモードのチーム注文案編集（`TradePanel` はクラシックモード用として残す） |
| `src/components/student/TeamOrderPanel.test.tsx` | 新規 |
| `src/components/student/PredictionForm.tsx` | 新規。個人予想入力 |
| `src/components/student/PredictionForm.test.tsx` | 新規 |
| `src/components/student/TeamPredictionComparison.tsx` | 新規 |
| `src/components/student/TeamPredictionComparison.test.tsx` | 新規 |
| `src/components/student/PriceNewsChart.tsx` | 新規。`settlementPriceHistory` のみを描画 |
| `src/components/student/PriceNewsChart.test.tsx` | 新規 |
| `src/components/student/ResultsView.tsx` | 変更。`PriceNewsChart` と評価指標の表示を追加 |
| `src/components/student/StudentMarketPage.tsx` | 変更。`meta.mode === 'ROUND'` で `TeamOrderPanel`/`PredictionForm` を出す分岐 |
| `src/lib/teacher/resultsExport.ts` | 変更。予想・判断理由・自動計算指標をCSVへ追加 |
| `src/lib/teacher/resultsExport.test.ts` | 変更 |
| `src/lib/teacher/participantDeletion.ts` | 新規。個人単位の削除・匿名化 |
| `src/lib/teacher/participantDeletion.test.ts` | 新規 |

---

## タスク一覧

## 1.4 ラウンド進行と一括約定

### Task 1: ラウンド・フェーズの型とフェーズ状態機械（純粋関数）

**Files:**
- Create: `src/lib/market/roundTypes.ts`
- Create: `src/lib/market/roundEngine.ts`
- Test: `src/lib/market/roundEngine.test.ts`

**Interfaces:**
- Produces: `RoundPhaseName`, `ROUND_PHASE_ORDER`, `ROUND_PHASE_LABEL`, `nextRoundPhase(current: RoundPhaseName): RoundPhaseName | 'ROUND_COMPLETE'`, `LessonRound`
- Consumes: なし（このTaskは他Taskの基盤）

**最初のステップ:** `docs/superpowers/plans/2026-08-05-phase1a-org-schema-functions-plan.md` を読み、`functions/` パッケージの実際のディレクトリ構成と `pricingCore` の共有方法（相対import・パスエイリアス・シンボリックリンクのいずれか）を確認する。本計画のTask 4以降が仮定している「`functions/src/round/*.ts` から `src/lib/market/roundEngine.ts` を直接importする」という前提が成立しない場合、以降のTaskのimport文をその場で実際の仕組みに合わせて書き換える。

- [ ] **Step 1: 型を書く**

`src/lib/market/roundTypes.ts`:

```ts
export type RoundPhaseName = 'INTRO' | 'RESEARCH' | 'PREDICTION' | 'TEAM_DISCUSSION' | 'TRADING' | 'REVEAL' | 'EXPLANATION' | 'REFLECTION'

export const ROUND_PHASE_ORDER: RoundPhaseName[] = ['INTRO', 'RESEARCH', 'PREDICTION', 'TEAM_DISCUSSION', 'TRADING', 'REVEAL', 'EXPLANATION', 'REFLECTION']

export const ROUND_PHASE_LABEL: Record<RoundPhaseName, string> = {
  INTRO: '導入', RESEARCH: '情報収集', PREDICTION: '個人予想', TEAM_DISCUSSION: 'チーム相談',
  TRADING: '売買', REVEAL: '変動', EXPLANATION: '解説', REFLECTION: '振り返り',
}

/** liveMarkets/{marketId}/rounds/{roundIndex}. Contains no future price or news information —
 * safe to expose in full to every participant, unlike privateEngineState. */
export interface LessonRound {
  roundIndex: number
  phase: RoundPhaseName
  phaseStartedAtMillis: number
  /** Only set while phase === 'TRADING'. */
  tradingClosesAtMillis?: number
  /** Idempotency key for settleRound, set once settlement begins. */
  settlementId?: string
  status: 'ACTIVE' | 'SETTLING' | 'SETTLED'
}

export interface PlannedOrder { stockId: string; side: 'BUY' | 'SELL'; quantity: number }

/** liveMarkets/{marketId}/rounds/{roundIndex}/teamDecisions/{teamId}. Field names use this
 * codebase's `AtMillis` convention rather than the design doc's `updatedAt`/`submittedAt`,
 * for consistency with every other timestamp field in liveMarketTypes.ts. */
export interface TeamRoundDecision {
  revision: number
  orders: PlannedOrder[]
  reason: string
  referencedDocumentIds: string[]
  updatedByParticipantId: string
  updatedAtMillis: number
  submitted: boolean
  submittedAtMillis?: number
}

export interface ValidatedOrder { stockId: string; side: 'BUY' | 'SELL'; quantity: number; valueAtQuote: number }

/** Public trading-phase quote. Deliberately excludes targetPrice/endPrice/seed — see design doc §3. */
export interface PublicRoundQuote { roundId: string; currentPrice: number; tradingClosesAt: number }

/** Display-only interpolation for the REVEAL phase. Never read as settlement history. */
export interface RevealAnimation { startPrice: number; endPrice: number; startAtMillis: number; endAtMillis: number; seed: number }

export interface SettlementBreakdown { newsPercent: number; demandPercent: number; appliedPercent: number }

/** liveMarkets/{marketId}/settlementPriceHistory/{stockId}/{roundIndex}. The source of truth
 * for the reflection graph — never populated from revealAnimation's interpolated values. */
export interface SettlementPriceEntry { price: number; breakdown: SettlementBreakdown; volume: number }

/** LessonTemplate v2 event schedule entry, resolved against the round it was published in. */
export interface ScheduledNewsImpact { assetId: string; roundOffset: number; percent: number; publishedRoundIndex: number }
```

- [ ] **Step 2: フェーズ遷移の失敗するテストを書く**

`src/lib/market/roundEngine.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { nextRoundPhase, ROUND_PHASE_ORDER } from './roundEngine'

describe('round phase progression', () => {
  it('advances through all eight phases in the documented order', () => {
    expect(ROUND_PHASE_ORDER).toEqual(['INTRO', 'RESEARCH', 'PREDICTION', 'TEAM_DISCUSSION', 'TRADING', 'REVEAL', 'EXPLANATION', 'REFLECTION'])
    expect(nextRoundPhase('INTRO')).toBe('RESEARCH')
    expect(nextRoundPhase('TRADING')).toBe('REVEAL')
  })

  it('signals round completion after REFLECTION instead of wrapping around', () => {
    expect(nextRoundPhase('REFLECTION')).toBe('ROUND_COMPLETE')
  })
})
```

- [ ] **Step 3: テストを実行し失敗を確認する**

Run: `npm test -- roundEngine`
Expected: FAIL — `nextRoundPhase` is not defined.

- [ ] **Step 4: 実装する**

`src/lib/market/roundEngine.ts`:

```ts
import type { RoundPhaseName } from './roundTypes'
export { ROUND_PHASE_ORDER, ROUND_PHASE_LABEL } from './roundTypes'
import { ROUND_PHASE_ORDER } from './roundTypes'

export const nextRoundPhase = (current: RoundPhaseName): RoundPhaseName | 'ROUND_COMPLETE' => {
  const index = ROUND_PHASE_ORDER.indexOf(current)
  return index === ROUND_PHASE_ORDER.length - 1 ? 'ROUND_COMPLETE' : ROUND_PHASE_ORDER[index + 1]
}
```

- [ ] **Step 5: テストを実行し成功を確認する**

Run: `npm test -- roundEngine`
Expected: PASS

- [ ] **Step 6: `npm run verify` を実行する**

- [ ] **Step 7: コミット**

```bash
git add src/lib/market/roundTypes.ts src/lib/market/roundEngine.ts src/lib/market/roundEngine.test.ts
git commit -m "feat: add round phase state machine and round-mode types"
```

---

### Task 2: チーム注文案の編集・確定（`revision` 楽観的並行制御）

**Files:**
- Modify: `src/lib/market/roundTrading.ts`（新規）
- Test: `src/lib/market/roundTrading.test.ts`

**Interfaces:**
- Consumes: `TeamRoundDecision`, `PlannedOrder`（Task 1）
- Produces: `applyEditTeamDecision(raw, teamId, roundIndex, edit, participantId, atMillis): LessonRound_tree | undefined`（純粋）, `editTeamDecision(database, marketId, roundIndex, teamId, edit, baseRevision, participantId): Promise<{committed: boolean}>`, `submitTeamDecision(...)`, `applySubmitTeamDecision(...)`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, expect, it } from 'vitest'
import { applyEditTeamDecision, applySubmitTeamDecision } from './roundTrading'

const empty = () => ({ revision: 0, orders: [], reason: '', referencedDocumentIds: [], updatedByParticipantId: '', updatedAtMillis: 0, submitted: false })

describe('team round decision editing', () => {
  it('increments revision and resets submitted on every edit', () => {
    const current = { ...empty(), revision: 3, submitted: true, submittedAtMillis: 500 }
    const next = applyEditTeamDecision(current, 3, { orders: [{ stockId: 'acme', side: 'BUY', quantity: 5 }], reason: '好決算', referencedDocumentIds: ['doc1'] }, 'p1', 1_000)
    expect(next).toEqual({ revision: 4, orders: [{ stockId: 'acme', side: 'BUY', quantity: 5 }], reason: '好決算', referencedDocumentIds: ['doc1'], updatedByParticipantId: 'p1', updatedAtMillis: 1_000, submitted: false })
  })

  it('rejects an edit against a stale revision, forcing a reload', () => {
    expect(applyEditTeamDecision({ ...empty(), revision: 8 }, 7, { orders: [], reason: '', referencedDocumentIds: [] }, 'p1', 1_000)).toBeUndefined()
  })

  it('creates a fresh decision when none exists yet, starting at revision 1', () => {
    const next = applyEditTeamDecision(null, 0, { orders: [], reason: '', referencedDocumentIds: [] }, 'p1', 1_000)
    expect(next?.revision).toBe(1)
  })

  it('submit flips submitted to true without touching orders, and also enforces the revision check', () => {
    const current = { ...empty(), revision: 4, orders: [{ stockId: 'acme', side: 'BUY' as const, quantity: 5 }] }
    expect(applySubmitTeamDecision(current, 4, 'p1', 2_000)).toEqual({ ...current, revision: 5, submitted: true, submittedAtMillis: 2_000, updatedByParticipantId: 'p1', updatedAtMillis: 2_000 })
    expect(applySubmitTeamDecision(current, 3, 'p1', 2_000)).toBeUndefined()
  })
})
```

- [ ] **Step 2: 実行して失敗を確認する**

Run: `npm test -- roundTrading`
Expected: FAIL — module not found.

- [ ] **Step 3: 実装する**

```ts
import { ref, runTransaction, type Database } from 'firebase/database'
import type { PlannedOrder, TeamRoundDecision } from './roundTypes'

const decisionPath = (marketId: string, roundIndex: number, teamId: string) =>
  `liveMarkets/${marketId}/rounds/${roundIndex}/teamDecisions/${teamId}`

export interface TeamDecisionEdit { orders: PlannedOrder[]; reason: string; referencedDocumentIds: string[] }

/** Editing always resets submitted to false — this is the single place that invariant is
 * enforced, so no caller can accidentally leave a stale "submitted" draft settleable. */
export const applyEditTeamDecision = (
  current: TeamRoundDecision | null,
  baseRevision: number,
  edit: TeamDecisionEdit,
  participantId: string,
  atMillis: number,
): TeamRoundDecision | undefined => {
  if (current && current.revision !== baseRevision) return undefined
  return { revision: baseRevision + 1, orders: edit.orders, reason: edit.reason, referencedDocumentIds: edit.referencedDocumentIds, updatedByParticipantId: participantId, updatedAtMillis: atMillis, submitted: false }
}

/** Never touches orders/reason — only flips submitted, so a "確定" click can never silently
 * change what was actually decided. */
export const applySubmitTeamDecision = (
  current: TeamRoundDecision | null,
  baseRevision: number,
  participantId: string,
  atMillis: number,
): TeamRoundDecision | undefined => {
  if (!current || current.revision !== baseRevision) return undefined
  return { ...current, revision: baseRevision + 1, submitted: true, submittedAtMillis: atMillis, updatedByParticipantId: participantId, updatedAtMillis: atMillis }
}

export const editTeamDecision = async (database: Database, marketId: string, roundIndex: number, teamId: string, edit: TeamDecisionEdit, baseRevision: number, participantId: string, atMillis = Date.now()) =>
  (await runTransaction(ref(database, decisionPath(marketId, roundIndex, teamId)), (current: TeamRoundDecision | null) => applyEditTeamDecision(current, baseRevision, edit, participantId, atMillis))).committed

export const submitTeamDecision = async (database: Database, marketId: string, roundIndex: number, teamId: string, baseRevision: number, participantId: string, atMillis = Date.now()) =>
  (await runTransaction(ref(database, decisionPath(marketId, roundIndex, teamId)), (current: TeamRoundDecision | null) => applySubmitTeamDecision(current, baseRevision, participantId, atMillis))).committed
```

- [ ] **Step 4: テストを実行し成功を確認する**

Run: `npm test -- roundTrading`
Expected: PASS

- [ ] **Step 5: `npm run verify` を実行する**

- [ ] **Step 6: コミット**

```bash
git add src/lib/market/roundTrading.ts src/lib/market/roundTrading.test.ts
git commit -m "feat: add optimistic-concurrency editing for team round decisions"
```

---

### Task 3: 注文検証と一括約定の中核計算（純粋関数）

これがラウンドモードの心臓部。**検証を需給計算より先に行う** ことをテストで固定する。ニュース・需給の実計算は Task 11/12（1.5）で追加されるが、このTaskの時点で `settleRoundPure` は `newsPercentByStock` / `demandPercentByStock` を**既に計算済みのマップとして受け取る**シグネチャにしておく（両方 `{}` を渡せば1.5未実装でも動く）。これによりTask 11/12は呼び出し側だけを差し替えればよく、`settleRoundPure` 自体の再設計が不要になる。

**Files:**
- Modify: `src/lib/market/roundEngine.ts`
- Modify: `src/lib/market/roundEngine.test.ts`

**Interfaces:**
- Consumes: `NEWS_IMPACT_LIMIT` from `src/lib/market/hostTrading.ts`（重複定義しない）, `clampToBounds` from `src/lib/pricing/pricingCore.ts`, `Portfolio`, `OrderResult` from `src/lib/market/liveMarketTypes.ts`
- Produces: `netOrdersByStock`, `validateTeamOrders`, `composeChangePercent`, `settleRoundPure`, `SettleRoundInput`, `SettleRoundOutput`

- [ ] **Step 1: 注文の正味化と検証の失敗するテストを書く**

```ts
import { netOrdersByStock, validateTeamOrders, composeChangePercent, settleRoundPure } from './roundEngine'
import type { Portfolio } from './liveMarketTypes'

describe('netting a team\'s planned orders per stock', () => {
  it('collapses opposing orders on the same stock into one net order', () => {
    expect(netOrdersByStock([{ stockId: 'acme', side: 'BUY', quantity: 10 }, { stockId: 'acme', side: 'SELL', quantity: 4 }]))
      .toEqual([{ stockId: 'acme', side: 'BUY', quantity: 6 }])
  })
  it('drops a stock whose net quantity is exactly zero', () => {
    expect(netOrdersByStock([{ stockId: 'acme', side: 'BUY', quantity: 5 }, { stockId: 'acme', side: 'SELL', quantity: 5 }])).toEqual([])
  })
})

describe('validating a team\'s net orders against their shared portfolio', () => {
  const portfolio: Portfolio = { cash: 1000, holdings: { acme: 3 }, updatedAtMillis: 0 }
  it('caps a sell to held quantity', () => {
    expect(validateTeamOrders([{ stockId: 'acme', side: 'SELL', quantity: 10 }], portfolio, { acme: 100 }))
      .toEqual([{ stockId: 'acme', side: 'SELL', quantity: 3, valueAtQuote: 300 }])
  })
  it('lets a sell\'s proceeds fund a buy in the same round', () => {
    const result = validateTeamOrders(
      [{ stockId: 'acme', side: 'SELL', quantity: 3 }, { stockId: 'globex', side: 'BUY', quantity: 20 }],
      { cash: 0, holdings: { acme: 3 }, updatedAtMillis: 0 }, { acme: 100, globex: 50 },
    )
    expect(result).toEqual([{ stockId: 'acme', side: 'SELL', quantity: 3, valueAtQuote: 300 }, { stockId: 'globex', side: 'BUY', quantity: 6, valueAtQuote: 300 }])
  })
  it('processes buys in ascending stockId order so the cutoff is deterministic', () => {
    const result = validateTeamOrders(
      [{ stockId: 'zeta', side: 'BUY', quantity: 5 }, { stockId: 'alpha', side: 'BUY', quantity: 5 }],
      { cash: 500, holdings: {}, updatedAtMillis: 0 }, { alpha: 100, zeta: 100 },
    )
    expect(result.map((o) => o.stockId)).toEqual(['alpha', 'zeta'])
    expect(result.find((o) => o.stockId === 'zeta')?.quantity).toBe(0 + 0) // fully exhausted after alpha
  })
})

describe('composing news and demand impact', () => {
  it('adds percentages then clamps to the shared ±20 limit', () => {
    expect(composeChangePercent(15, 10)).toBe(20)
    expect(composeChangePercent(-15, -10)).toBe(-20)
    expect(composeChangePercent(3, -1)).toBe(2)
  })
})
```

- [ ] **Step 2: 実行して失敗を確認する**

Run: `npm test -- roundEngine`
Expected: FAIL

- [ ] **Step 3: 実装する**

`src/lib/market/roundEngine.ts` に追記:

```ts
import { NEWS_IMPACT_LIMIT } from './hostTrading'
import { clampToBounds } from '../pricing/pricingCore'
import type { OrderResult, Portfolio } from './liveMarketTypes'
import type { PlannedOrder, ScheduledNewsImpact, SettlementBreakdown, TeamRoundDecision, ValidatedOrder } from './roundTypes'

export const netOrdersByStock = (orders: PlannedOrder[]): PlannedOrder[] => {
  const net = new Map<string, number>()
  for (const order of orders) net.set(order.stockId, (net.get(order.stockId) ?? 0) + (order.side === 'BUY' ? order.quantity : -order.quantity))
  return [...net.entries()].filter(([, quantity]) => quantity !== 0)
    .map(([stockId, quantity]) => ({ stockId, side: quantity > 0 ? 'BUY' as const : 'SELL' as const, quantity: Math.abs(Math.floor(quantity)) }))
}

/**
 * Sells are capped to held quantity and their proceeds fund this same round's buys
 * (design doc §4: "売却代金は同じラウンドの買付資金として使用できる"). Buys are then processed
 * in ascending stockId order, each capped to remaining buying power — a deterministic
 * tie-break so a team cannot influence which of their own orders gets cut by choosing
 * an unpredictable submission order. This must run before any demand calculation: only
 * the quantities this function returns are allowed to move the price.
 */
export const validateTeamOrders = (orders: PlannedOrder[], portfolio: Portfolio, publicPrice: Record<string, number>): ValidatedOrder[] => {
  const netted = netOrdersByStock(orders)
  const sells = netted.filter((order) => order.side === 'SELL')
    .map((order) => ({ ...order, quantity: Math.min(order.quantity, portfolio.holdings?.[order.stockId] ?? 0) }))
    .filter((order) => order.quantity > 0)
  const sellProceeds = sells.reduce((sum, order) => sum + order.quantity * (publicPrice[order.stockId] ?? 0), 0)
  let buyingPower = portfolio.cash + sellProceeds
  const buys: ValidatedOrder[] = []
  for (const order of netted.filter((o) => o.side === 'BUY').sort((a, b) => a.stockId.localeCompare(b.stockId))) {
    const price = publicPrice[order.stockId]
    if (!price || price <= 0) continue
    const affordable = Math.min(order.quantity, Math.floor(buyingPower / price))
    buyingPower -= affordable * price
    buys.push({ stockId: order.stockId, side: 'BUY', quantity: affordable, valueAtQuote: affordable * price })
  }
  return [...sells.map((order) => ({ ...order, valueAtQuote: order.quantity * (publicPrice[order.stockId] ?? 0) })), ...buys]
}

export const composeChangePercent = (...percents: number[]): number =>
  Math.max(-NEWS_IMPACT_LIMIT, Math.min(NEWS_IMPACT_LIMIT, percents.reduce((sum, value) => sum + value, 0)))

export interface SettleRoundInput {
  roundIndex: number
  /** The price shown throughout the just-closed TRADING phase — the fill price for every order. */
  publicPrice: Record<string, number>
  basePrice: Record<string, number>
  teamDecisions: Record<string, TeamRoundDecision>
  teamPortfolios: Record<string, Portfolio>
  /** Already resolved for this round — {} disables the news component entirely. */
  newsPercentByStock: Record<string, number>
  /** Already resolved for this round — {} disables the demand component entirely
   * (this is how a template's demandLinkedPricing=false flag is honored: the caller
   * simply never computes this map). */
  demandPercentByStock: Record<string, number>
  volumeByStock: Record<string, number>
}
export interface SettleRoundOutput {
  fills: OrderResult[]
  teamPortfolios: Record<string, Portfolio>
  nextOpeningPrice: Record<string, number>
  breakdown: Record<string, SettlementBreakdown>
}

/** Steps 3–7 of settleRound (design doc §4's 9-step list); steps 1–2 (status check,
 * idempotency) belong to the Cloud Function wrapper, and step 8/9 (persist) is the
 * wrapper writing this function's output. Only submitted decisions are settled. */
export const settleRoundPure = (input: SettleRoundInput, atMillis: number): SettleRoundOutput => {
  const submittedTeams = Object.entries(input.teamDecisions).filter(([, decision]) => decision.submitted)
  const validatedByTeam: Record<string, ValidatedOrder[]> = {}
  for (const [teamId, decision] of submittedTeams) {
    validatedByTeam[teamId] = validateTeamOrders(decision.orders, input.teamPortfolios[teamId] ?? { cash: 0, holdings: {}, updatedAtMillis: atMillis }, input.publicPrice)
  }

  const stockIds = new Set([...Object.keys(input.publicPrice), ...Object.keys(input.newsPercentByStock), ...Object.keys(input.demandPercentByStock)])
  const breakdown: Record<string, SettlementBreakdown> = {}
  const nextOpeningPrice: Record<string, number> = {}
  for (const stockId of stockIds) {
    const newsPercent = input.newsPercentByStock[stockId] ?? 0
    const demandPercent = input.demandPercentByStock[stockId] ?? 0
    const appliedPercent = composeChangePercent(newsPercent, demandPercent)
    breakdown[stockId] = { newsPercent, demandPercent, appliedPercent }
    const current = input.publicPrice[stockId] ?? input.basePrice[stockId] ?? 0
    nextOpeningPrice[stockId] = clampToBounds(current * (1 + appliedPercent / 100), input.basePrice[stockId] ?? current)
  }

  const fills: OrderResult[] = []
  const nextPortfolios: Record<string, Portfolio> = structuredClone(input.teamPortfolios)
  for (const [teamId, decision] of submittedTeams) {
    const portfolio = nextPortfolios[teamId] ?? { cash: 0, holdings: {}, updatedAtMillis: atMillis }
    portfolio.holdings ??= {}
    for (const order of validatedByTeam[teamId]) {
      const price = input.publicPrice[order.stockId]
      if (order.side === 'BUY') { portfolio.cash -= order.quantity * price; portfolio.holdings[order.stockId] = (portfolio.holdings[order.stockId] ?? 0) + order.quantity }
      else { portfolio.cash += order.quantity * price; portfolio.holdings[order.stockId] = Math.max(0, (portfolio.holdings[order.stockId] ?? 0) - order.quantity) }
      fills.push({ orderId: `${teamId}-${order.stockId}-r${input.roundIndex}`, participantId: decision.updatedByParticipantId, teamId, stockId: order.stockId, side: order.side, requestedQuantity: order.quantity, filledQuantity: order.quantity, price, processedAtMillis: atMillis })
    }
    portfolio.updatedAtMillis = atMillis
    nextPortfolios[teamId] = portfolio
  }

  return { fills, teamPortfolios: nextPortfolios, nextOpeningPrice, breakdown }
}
```

- [ ] **Step 4: テストを実行し成功を確認する**

Run: `npm test -- roundEngine`
Expected: PASS

- [ ] **Step 5: 検証順序を固定する回帰テストを追加する**

```ts
describe('settleRoundPure order of operations', () => {
  it('never lets an unvalidated buy influence another stock\'s price — demand must derive only from validated fills', () => {
    // A team requests far more than they can afford; the settlement must use the
    // validated (affordable) quantity, not the requested one, anywhere downstream.
    const output = settleRoundPure({
      roundIndex: 0,
      publicPrice: { acme: 100 },
      basePrice: { acme: 100 },
      teamDecisions: { red: { revision: 1, orders: [{ stockId: 'acme', side: 'BUY', quantity: 10_000 }], reason: '', referencedDocumentIds: [], updatedByParticipantId: 'p1', updatedAtMillis: 0, submitted: true } },
      teamPortfolios: { red: { cash: 500, holdings: {}, updatedAtMillis: 0 } },
      newsPercentByStock: {}, demandPercentByStock: {}, volumeByStock: {},
    }, 1_000)
    expect(output.fills[0].filledQuantity).toBe(5) // floor(500 / 100), not 10,000
    expect(output.teamPortfolios.red.cash).toBe(0)
  })

  it('excludes unsubmitted teams from fills entirely', () => {
    const output = settleRoundPure({
      roundIndex: 0, publicPrice: { acme: 100 }, basePrice: { acme: 100 },
      teamDecisions: { red: { revision: 1, orders: [{ stockId: 'acme', side: 'BUY', quantity: 1 }], reason: '', referencedDocumentIds: [], updatedByParticipantId: 'p1', updatedAtMillis: 0, submitted: false } },
      teamPortfolios: { red: { cash: 500, holdings: {}, updatedAtMillis: 0 } },
      newsPercentByStock: {}, demandPercentByStock: {}, volumeByStock: {},
    }, 1_000)
    expect(output.fills).toEqual([])
  })
})
```

Run: `npm test -- roundEngine` → PASS.

- [ ] **Step 6: `npm run verify` を実行する**

- [ ] **Step 7: コミット**

```bash
git add src/lib/market/roundEngine.ts src/lib/market/roundEngine.test.ts
git commit -m "feat: implement order validation and batch settlement core"
```

---

### Task 4: `settleRound` Callable（Cloud Functions）

冪等性と永続化を担う薄いラッパー。既存の `finalizeEnding`（`hostTrading.ts:261`）の「チェックポイントIDを先に書いて二重実行を防ぐ→計算→チェックポイント一致を確認して書き込む」という2段階トランザクションパターンをそのまま踏襲する。

**Files:**
- Create: `functions/src/round/settleRound.ts`
- Test: `functions/src/round/settleRound.test.ts`

**Interfaces:**
- Consumes: `settleRoundPure`, `SettleRoundInput`（Task 3）, `LessonRound`, `TeamRoundDecision`（Task 1）
- Produces: `settleRound` (`onCall` handler), `settleRoundAdmin(database, marketId, roundIndex): Promise<SettleRoundOutput | { alreadySettled: true }>`（テスト容易性のためAdmin SDK操作をハンドラから分離）

- [ ] **Step 1: 冪等性の失敗するテストを書く**

`functions/src/round/settleRound.test.ts`（Admin SDKのRTDBエミュレータ、または `runTransaction` をモックした純粋な呼び出しテストのいずれかで検証。設定は `docs/superpowers/plans/2026-08-05-phase1a-org-schema-functions-plan.md` が確立したFunctionsのテスト方式に合わせる）:

```ts
import { describe, expect, it, vi } from 'vitest'
import { settleRoundAdmin } from './settleRound'

describe('settleRound idempotency', () => {
  it('does not re-settle a round whose status is already SETTLED', async () => {
    const database = {
      // Minimal fake matching the subset of the Admin RTDB API settleRoundAdmin uses.
      ref: vi.fn(() => ({
        transaction: vi.fn(async (updater: (current: unknown) => unknown) => {
          const result = updater({ roundIndex: 0, phase: 'TRADING', phaseStartedAtMillis: 0, status: 'SETTLED', settlementId: 'existing' })
          return { committed: false, snapshot: { val: () => result } }
        }),
      })),
    }
    const result = await settleRoundAdmin(database as never, 'market-a', 0)
    expect(result).toEqual({ alreadySettled: true })
  })
})
```

- [ ] **Step 2: 実行して失敗を確認する**

Run: `npm test -- settleRound` (in `functions/`, per whatever script Phase 1.3 wired up — confirm the exact command against `functions/package.json`)
Expected: FAIL — module not found.

- [ ] **Step 3: 実装する**

```ts
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getDatabase, type Database as AdminDatabase } from 'firebase-admin/database'
import { settleRoundPure, type SettleRoundInput } from '../../../src/lib/market/roundEngine' // adjust per Task 1's Step 0 path confirmation
import type { LessonRound, TeamRoundDecision } from '../../../src/lib/market/roundTypes'
import type { LiveMarketState } from '../../../src/lib/market/liveMarketTypes'

/**
 * Two-phase transaction, mirroring hostTrading.ts's finalizeEnding: first claim the
 * settlement with a fresh settlementId (so a retried/duplicate call sees SETTLING or
 * SETTLED and backs off), then compute off-transaction, then persist gated on that
 * exact settlementId still being current.
 */
export const settleRoundAdmin = async (database: AdminDatabase, marketId: string, roundIndex: number) => {
  const roundRef = database.ref(`liveMarkets/${marketId}/rounds/${roundIndex}`)
  const settlementId = `settlement-${marketId}-${roundIndex}-${Date.now()}`
  let claimed = ''
  const entered = await roundRef.transaction((current: LessonRound | null) => {
    if (!current) return current
    if (current.status === 'SETTLED') return current
    if (current.status === 'SETTLING') return undefined // another call is already in flight — abort
    return { ...current, status: 'SETTLING', settlementId }
  })
  const enteredRound = entered.snapshot.val() as LessonRound | null
  if (!entered.committed || enteredRound?.status === 'SETTLED') return { alreadySettled: true } as const
  claimed = settlementId

  const marketRef = database.ref(`liveMarkets/${marketId}`)
  const snapshot = (await marketRef.get()).val() as LiveMarketState & { rounds?: Record<number, LessonRound & { teamDecisions?: Record<string, TeamRoundDecision> }> }
  const round = snapshot.rounds?.[roundIndex]
  if (!round) throw new HttpsError('not-found', 'Round does not exist')

  const input: SettleRoundInput = {
    roundIndex,
    publicPrice: Object.fromEntries(Object.entries(snapshot.publicQuote ?? {}).map(([stockId, quote]: [string, { currentPrice: number }]) => [stockId, quote.currentPrice])),
    basePrice: Object.fromEntries(Object.values(snapshot.companies ?? {}).map((company) => [company.id, company.basePrice])),
    teamDecisions: round.teamDecisions ?? {},
    teamPortfolios: snapshot.teamPortfolios ?? {},
    // {} until Task 12 wires the real resolvers in — 1.5 lands after 1.4.
    newsPercentByStock: {},
    demandPercentByStock: {},
    volumeByStock: {},
  }
  const output = settleRoundPure(input, Date.now())

  const persisted = await roundRef.transaction((current: LessonRound | null) => {
    if (!current || current.settlementId !== claimed) return current // a newer claim already won
    return { ...current, status: 'SETTLED' }
  })
  if (!persisted.committed) throw new HttpsError('aborted', 'Settlement was superseded')

  await Promise.all([
    marketRef.child('teamPortfolios').update(output.teamPortfolios),
    ...Object.entries(output.nextOpeningPrice).map(([stockId, price]) =>
      marketRef.child(`settlementPriceHistory/${stockId}/${roundIndex}`).set({ price, breakdown: output.breakdown[stockId], volume: input.volumeByStock[stockId] ?? 0 })),
    ...output.fills.map((fill) => marketRef.child(`transactions/${fill.participantId}/${fill.orderId}`).set(fill)),
  ])
  return output
}

export const settleRound = onCall(async (request) => {
  const marketId = String(request.data?.marketId ?? '')
  const roundIndex = Number(request.data?.roundIndex ?? -1)
  if (!marketId || roundIndex < 0) throw new HttpsError('invalid-argument', 'marketId and roundIndex are required')
  const database = getDatabase()
  const marketSnapshot = await database.ref(`liveMarkets/${marketId}/meta/ownerUid`).get()
  if (marketSnapshot.val() !== request.auth?.uid) throw new HttpsError('permission-denied', 'Only the market owner can settle a round')
  return settleRoundAdmin(database, marketId, roundIndex)
})
```

- [ ] **Step 4: テストを実行し成功を確認する**

Run: `npm test -- settleRound`
Expected: PASS

- [ ] **Step 5: `npm run verify` を実行する**（`functions/` にも同等のverifyスクリプトがあるか、Phase 1.3の成果物を確認して両方通す）

- [ ] **Step 6: コミット**

```bash
git add functions/src/round/settleRound.ts functions/src/round/settleRound.test.ts
git commit -m "feat: add settleRound callable with idempotent two-phase persistence"
```

---

### Task 5: `advancePhase` Callable（フェーズ進行とラウンド開始）

**Files:**
- Create: `functions/src/round/advancePhase.ts`
- Test: `functions/src/round/advancePhase.test.ts`

**Interfaces:**
- Consumes: `nextRoundPhase`, `ROUND_PHASE_ORDER`（Task 1）, `settleRoundAdmin`（Task 4）
- Produces: `advancePhase` (`onCall`)

- [ ] **Step 1: フェーズ遷移の失敗するテストを書く**

```ts
import { describe, expect, it, vi } from 'vitest'
import { computeAdvanceResult } from './advancePhase'

describe('advancing a round phase', () => {
  it('entering TRADING publishes a public quote with a trading-closes deadline', () => {
    const result = computeAdvanceResult({ roundIndex: 0, phase: 'TEAM_DISCUSSION', phaseStartedAtMillis: 0, status: 'ACTIVE' }, { openingPrice: { acme: 500 }, tradingWindowMillis: 120_000 }, 10_000)
    expect(result.round.phase).toBe('TRADING')
    expect(result.publicQuote?.acme).toEqual({ roundId: '0', currentPrice: 500, tradingClosesAt: 130_000 })
  })

  it('leaving TRADING requires settlement to have already run — it does not settle inline', () => {
    const result = computeAdvanceResult({ roundIndex: 0, phase: 'TRADING', phaseStartedAtMillis: 0, status: 'SETTLED' }, { openingPrice: {}, tradingWindowMillis: 0 }, 10_000)
    expect(result.round.phase).toBe('REVEAL')
  })

  it('refuses to leave TRADING before settlement has completed', () => {
    expect(() => computeAdvanceResult({ roundIndex: 0, phase: 'TRADING', phaseStartedAtMillis: 0, status: 'ACTIVE' }, { openingPrice: {}, tradingWindowMillis: 0 }, 10_000)).toThrow()
  })

  it('REFLECTION advances into a fresh next round at INTRO', () => {
    const result = computeAdvanceResult({ roundIndex: 2, phase: 'REFLECTION', phaseStartedAtMillis: 0, status: 'SETTLED' }, { openingPrice: {}, tradingWindowMillis: 0 }, 10_000)
    expect(result.round).toEqual({ roundIndex: 3, phase: 'INTRO', phaseStartedAtMillis: 10_000, status: 'ACTIVE' })
  })
})
```

- [ ] **Step 2: 実行して失敗を確認する**

Run: `npm test -- advancePhase`
Expected: FAIL

- [ ] **Step 3: 実装する**

```ts
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getDatabase } from 'firebase-admin/database'
import { nextRoundPhase } from '../../../src/lib/market/roundEngine'
import type { LessonRound, PublicRoundQuote } from '../../../src/lib/market/roundTypes'
import { settleRoundAdmin } from './settleRound'

export interface AdvanceContext { openingPrice: Record<string, number>; tradingWindowMillis: number }

export const computeAdvanceResult = (round: LessonRound, context: AdvanceContext, atMillis: number): { round: LessonRound; publicQuote?: Record<string, PublicRoundQuote> } => {
  if (round.phase === 'TRADING' && round.status !== 'SETTLED') {
    throw new Error('Round must be settled (via settleRound) before leaving the TRADING phase')
  }
  const next = nextRoundPhase(round.phase)
  if (next === 'ROUND_COMPLETE') {
    return { round: { roundIndex: round.roundIndex + 1, phase: 'INTRO', phaseStartedAtMillis: atMillis, status: 'ACTIVE' } }
  }
  const advanced: LessonRound = { ...round, phase: next, phaseStartedAtMillis: atMillis, status: 'ACTIVE' }
  if (next === 'TRADING') {
    advanced.tradingClosesAtMillis = atMillis + context.tradingWindowMillis
    const publicQuote = Object.fromEntries(Object.entries(context.openingPrice).map(([stockId, price]) => [stockId, { roundId: String(round.roundIndex), currentPrice: price, tradingClosesAt: advanced.tradingClosesAtMillis! }]))
    return { round: advanced, publicQuote }
  }
  return { round: advanced }
}

export const advancePhase = onCall(async (request) => {
  const marketId = String(request.data?.marketId ?? '')
  if (!marketId) throw new HttpsError('invalid-argument', 'marketId is required')
  const database = getDatabase()
  const marketRef = database.ref(`liveMarkets/${marketId}`)
  const [ownerUid, roundIndexSnapshot] = await Promise.all([
    marketRef.child('meta/ownerUid').get().then((s) => s.val()),
    marketRef.child('meta/currentRoundIndex').get().then((s) => Number(s.val() ?? 0)),
  ])
  if (ownerUid !== request.auth?.uid) throw new HttpsError('permission-denied', 'Only the market owner can advance a round')

  const round = (await marketRef.child(`rounds/${roundIndexSnapshot}`).get()).val() as LessonRound
  if (round.phase === 'TRADING' && round.status !== 'SETTLED') await settleRoundAdmin(database, marketId, round.roundIndex)
  const resettled = (await marketRef.child(`rounds/${roundIndexSnapshot}`).get()).val() as LessonRound

  // TODO(Task 12, 1.5): replace with the round's actual per-stock opening price computed by settleRound.
  const openingPrice = Object.fromEntries(Object.entries((await marketRef.child('companies').get()).val() ?? {}).map(([id, company]: [string, { basePrice: number }]) => [id, company.basePrice]))
  const { round: nextRound, publicQuote } = computeAdvanceResult(resettled, { openingPrice, tradingWindowMillis: 5 * 60_000 }, Date.now())

  await Promise.all([
    marketRef.child(`rounds/${nextRound.roundIndex}`).set(nextRound),
    marketRef.child('meta/currentRoundIndex').set(nextRound.roundIndex),
    publicQuote ? marketRef.child('publicQuote').update(publicQuote) : Promise.resolve(),
  ])
  return { round: nextRound }
})
```

*(この`openingPrice`のプレースホルダはTask 12で「直前ラウンドの`nextOpeningPrice`を読む」実装に差し替える。Task 5の時点ではラウンド0はテンプレートの`basePrice`から、ラウンド1以降は本来`settlementPriceHistory`から取るべきだが、そのつなぎ込みは1.5の完了後まで確定しないため、ここでは意図的に単純化している。)*

- [ ] **Step 4: テストを実行し成功を確認する**

Run: `npm test -- advancePhase`
Expected: PASS

- [ ] **Step 5: `npm run verify` を実行する**

- [ ] **Step 6: コミット**

```bash
git add functions/src/round/advancePhase.ts functions/src/round/advancePhase.test.ts
git commit -m "feat: add advancePhase callable driving the round state machine"
```

---

### Task 6: `placeContinuousOrder` Callable（クラシックモード即時約定のサーバー化）

**重要な設計判断（前提として使う既存コードの重要な事実 #1 を参照）:** 現行の `submitOrder`（生徒がRTDBへ直接書く）+ `processPendingOrder`（ホストが1秒ごとに拾う）という経路を、この Callable に**置き換える**。生徒のクライアントは今後 `submitOrder` を呼ばず、直接 `placeContinuousOrder` を呼ぶ。RTDBの `orders/{participantId}/pending` パスと関連ルールはクラシックモードでは不要になる（Task 7でルールを整理する）。

**Files:**
- Create: `functions/src/round/placeContinuousOrder.ts`
- Test: `functions/src/round/placeContinuousOrder.test.ts`

**Interfaces:**
- Consumes: `calculateOrderFill`（`src/lib/market/hostTrading.ts:151`、既存の「ホスト価格が勝つ、資金・保有不足では減額されるが拒否はしない」というポリシーをそのまま流用）
- Produces: `placeContinuousOrder` (`onCall`), `PRICE_FRESHNESS_WINDOW_MILLIS`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, expect, it, vi } from 'vitest'
import { isPriceStale, PRICE_FRESHNESS_WINDOW_MILLIS } from './placeContinuousOrder'

describe('classic-mode order freshness gate', () => {
  it('rejects an order once the last published price is older than the freshness window', () => {
    expect(isPriceStale(10_000, 10_000 + PRICE_FRESHNESS_WINDOW_MILLIS + 1)).toBe(true)
    expect(isPriceStale(10_000, 10_000 + PRICE_FRESHNESS_WINDOW_MILLIS - 1)).toBe(false)
  })
})
```

- [ ] **Step 2: 実行して失敗を確認する**

Run: `npm test -- placeContinuousOrder`
Expected: FAIL

- [ ] **Step 3: 実装する**

```ts
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getDatabase } from 'firebase-admin/database'
import { calculateOrderFill } from '../../../src/lib/market/hostTrading'
import type { LiveMarketState, PendingOrder } from '../../../src/lib/market/liveMarketTypes'

/** The host tick that keeps prices fresh runs once a second; anything older than a
 * few ticks' worth of slack means the host tab is backgrounded, asleep, or the lease
 * has lapsed, and no order should fill against a price nobody is actually updating. */
export const PRICE_FRESHNESS_WINDOW_MILLIS = 5_000

export const isPriceStale = (updatedAtMillis: number, nowMillis: number) => nowMillis - updatedAtMillis > PRICE_FRESHNESS_WINDOW_MILLIS

export const placeContinuousOrder = onCall(async (request) => {
  const marketId = String(request.data?.marketId ?? '')
  const order = request.data?.order as PendingOrder | undefined
  const uid = request.auth?.uid
  if (!marketId || !order || !uid) throw new HttpsError('invalid-argument', 'marketId, order and auth are required')

  const database = getDatabase()
  const marketRef = database.ref(`liveMarkets/${marketId}`)
  const snapshot = (await marketRef.get()).val() as LiveMarketState | null
  if (!snapshot || snapshot.meta.status !== 'OPEN') throw new HttpsError('failed-precondition', 'Market is not open')

  const lease = snapshot.hostLease
  if (!lease || lease.paused || lease.expiresAtMillis <= Date.now()) throw new HttpsError('failed-precondition', 'No active host — the price feed is not running')

  const priceEntry = snapshot.prices?.[order.stockId]
  if (!priceEntry || priceEntry.price <= 0 || isPriceStale(priceEntry.updatedAtMillis, Date.now())) throw new HttpsError('failed-precondition', 'Published price is stale')

  const participant = Object.entries(snapshot.participants ?? {}).find(([, value]) => value.uid === uid)
  if (!participant) throw new HttpsError('permission-denied', 'Not a participant in this market')
  const [participantId, participantValue] = participant
  const teamId = participantValue.teamId
  if (!teamId) throw new HttpsError('failed-precondition', 'Participant has no team')

  const portfolio = snapshot.teamPortfolios?.[teamId] ?? { cash: snapshot.meta.startingCash, holdings: {}, updatedAtMillis: Date.now() }
  const result = calculateOrderFill(order, priceEntry.price, portfolio, Date.now(), participantId, teamId)

  const nextCash = order.side === 'BUY' ? portfolio.cash - result.filledQuantity * priceEntry.price : portfolio.cash + result.filledQuantity * priceEntry.price
  const nextHeld = order.side === 'BUY'
    ? (portfolio.holdings?.[order.stockId] ?? 0) + result.filledQuantity
    : Math.max(0, (portfolio.holdings?.[order.stockId] ?? 0) - result.filledQuantity)

  await Promise.all([
    marketRef.child(`teamPortfolios/${teamId}`).update({ cash: nextCash, [`holdings/${order.stockId}`]: nextHeld, updatedAtMillis: Date.now() }),
    marketRef.child(`transactions/${participantId}/${order.orderId}`).set(result),
  ])
  return result
})
```

- [ ] **Step 4: テストを実行し成功を確認する**

Run: `npm test -- placeContinuousOrder`
Expected: PASS

- [ ] **Step 5: `npm run verify` を実行する**

- [ ] **Step 6: コミット**

```bash
git add functions/src/round/placeContinuousOrder.ts functions/src/round/placeContinuousOrder.test.ts
git commit -m "feat: move classic-mode order execution to a server callable"
```

---

### Task 7: RTDBルールの追加とルールテスト

**Files:**
- Modify: `database.rules.json`
- Modify: `test/database.rules.test.ts`

**Interfaces:**
- Consumes: 既存の `liveMarkets/{marketId}` ルール構造

- [ ] **Step 1: 失敗するルールテストを書く**

`test/database.rules.test.ts` に追記（既存の `seed`/`approveStudent` ヘルパーを再利用）:

```ts
describe('round-mode nodes', () => {
  it('lets a team member read the public quote and settlement history, but never privateEngineState', async () => {
    await approveStudent()
    const student = environment.authenticatedContext('student-a', { firebase: { sign_in_provider: 'anonymous' as const } }).database()
    await assertSucceeds(student.ref(`liveMarkets/${market}/publicQuote/acme`).get())
    await assertSucceeds(student.ref(`liveMarkets/${market}/settlementPriceHistory/acme/0`).get())
    await assertFails(student.ref(`liveMarkets/${market}/privateEngineState`).get())
  })

  it('denies privateEngineState reads even to the market owner\'s client SDK — only Admin SDK (Cloud Functions) may read it', async () => {
    const teacher = environment.authenticatedContext('teacher-a', teacherToken).database()
    await assertFails(teacher.ref(`liveMarkets/${market}/privateEngineState`).get())
  })

  it('lets only a team\'s own members write their teamDecisions, incrementing revision by exactly 1', async () => {
    await approveStudent('student-a', 'red')
    const student = environment.authenticatedContext('student-a', { firebase: { sign_in_provider: 'anonymous' as const } }).database()
    await assertSucceeds(student.ref(`liveMarkets/${market}/rounds/0/teamDecisions/red`).set({ revision: 1, orders: [], reason: '', referencedDocumentIds: [], updatedByParticipantId: 'student-a_session', updatedAtMillis: 1, submitted: false }))
    await assertFails(student.ref(`liveMarkets/${market}/rounds/0/teamDecisions/red`).set({ revision: 3, orders: [], reason: '', referencedDocumentIds: [], updatedByParticipantId: 'student-a_session', updatedAtMillis: 1, submitted: false }))
  })

  it('denies a student writing another team\'s decision', async () => {
    await approveStudent('student-a', 'red')
    const student = environment.authenticatedContext('student-a', { firebase: { sign_in_provider: 'anonymous' as const } }).database()
    await assertFails(student.ref(`liveMarkets/${market}/rounds/0/teamDecisions/blue`).set({ revision: 1, orders: [], reason: '', referencedDocumentIds: [], updatedByParticipantId: 'student-a_session', updatedAtMillis: 1, submitted: false }))
  })
})
```

- [ ] **Step 2: 実行して失敗を確認する**

Run: `npm run test:rules -- -t "round-mode nodes"`
Expected: FAIL — nodes not yet defined, everything denied by default `.write: false`/`.read: false`.

- [ ] **Step 3: ルールを追加する**

`database.rules.json` の `liveMarkets/$marketId` 配下に追記:

```json
"rounds": {
  "$roundIndex": {
    ".read": "auth != null && (data.parent().parent().child('meta/ownerUid').val() === auth.uid || data.parent().parent().child('members').child(auth.uid).exists())",
    "teamDecisions": {
      "$teamId": {
        ".read": "auth != null && (root.child('liveMarkets').child($marketId).child('meta/ownerUid').val() === auth.uid || root.child('liveMarkets').child($marketId).child('members').child(auth.uid).child('teamId').val() === $teamId)",
        ".write": "auth != null && root.child('liveMarkets').child($marketId).child('members').child(auth.uid).child('teamId').val() === $teamId",
        ".validate": "newData.hasChildren(['revision','orders','reason','referencedDocumentIds','updatedByParticipantId','updatedAtMillis','submitted']) && newData.child('revision').val() === (data.exists() ? data.child('revision').val() + 1 : 1)"
      }
    }
  }
},
"publicQuote": {
  "$stockId": {
    ".read": "auth != null && (root.child('liveMarkets').child($marketId).child('meta/ownerUid').val() === auth.uid || root.child('liveMarkets').child($marketId).child('members').child(auth.uid).exists())"
  }
},
"settlementPriceHistory": {
  "$stockId": {
    "$roundIndex": {
      ".read": "auth != null && (root.child('liveMarkets').child($marketId).child('meta/ownerUid').val() === auth.uid || root.child('liveMarkets').child($marketId).child('members').child(auth.uid).exists())"
    }
  }
},
"privateEngineState": {
  ".read": false,
  ".write": false
}
```

（`rounds/$roundIndex` そのものへの直接 `.write` は与えない — フェーズ遷移は `advancePhase` Callableのみが行い、Admin SDKはルールを迂回するため、この省略は「クライアントは書けない」ことを意味する。`teamDecisions` の `.write` は生徒からの直接書き込みを許すが、`submitted` を `false` へ戻す不変条件はクライアント側の `applyEditTeamDecision`（Task 2）に委ねる — 既存コードベースの `participants`/`joinRequests` と同じ信頼モデル。）

- [ ] **Step 4: テストを実行し成功を確認する**

Run: `npm run test:rules`
Expected: PASS（既存のルールテストも含めて全て通ること）

- [ ] **Step 5: `npm run verify` を実行する**

- [ ] **Step 6: コミット**

```bash
git add database.rules.json test/database.rules.test.ts
git commit -m "feat: add RTDB rules for round-mode public/private nodes"
```

---

### Task 8: 教師向け進行UI（`RoundControlPanel`）と `ControlRoom` の分岐

**Files:**
- Create: `src/components/teacher/RoundControlPanel.tsx`
- Test: `src/components/teacher/RoundControlPanel.test.tsx`
- Modify: `src/components/teacher/ControlRoom.tsx`
- Modify: `src/lib/market/liveMarketTypes.ts`（`LiveMarketMetadata.mode` 追加）

**Interfaces:**
- Consumes: `ROUND_PHASE_LABEL`, `LessonRound`（Task 1）, `httpsCallable` for `advancePhase`（Task 5）

- [ ] **Step 1: `liveMarketTypes.ts` に `mode` を追加する**

`LiveMarketMetadata` に1行追加:

```ts
  /** New markets always set this explicitly; absence means a market created before Phase 1.4 — treat as CLASSIC. */
  mode?: 'CLASSIC' | 'ROUND'
```

- [ ] **Step 2: `RoundControlPanel` の失敗するテストを書く**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RoundControlPanel } from './RoundControlPanel'

describe('RoundControlPanel', () => {
  it('shows the current phase label and calls onAdvance when 次へ is pressed', () => {
    const onAdvance = vi.fn()
    render(<RoundControlPanel phase="TEAM_DISCUSSION" roundIndex={2} advancing={false} onAdvance={onAdvance} />)
    expect(screen.getByText(/チーム相談/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    expect(onAdvance).toHaveBeenCalled()
  })

  it('disables the button while an advance is in flight, so a double-click cannot skip a phase', () => {
    render(<RoundControlPanel phase="TRADING" roundIndex={0} advancing onAdvance={vi.fn()} />)
    expect(screen.getByRole('button', { name: '次へ' })).toBeDisabled()
  })
})
```

- [ ] **Step 3: 実行して失敗を確認する**

Run: `npm test -- RoundControlPanel`
Expected: FAIL

- [ ] **Step 4: 実装する**

```tsx
import { Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material'
import { ROUND_PHASE_LABEL, type RoundPhaseName } from '../../lib/market/roundEngine'

interface RoundControlPanelProps { phase: RoundPhaseName; roundIndex: number; advancing: boolean; onAdvance: () => void }

export function RoundControlPanel({ phase, roundIndex, advancing, onAdvance }: RoundControlPanelProps) {
  return (
    <Card component="section">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="overline" color="text.secondary">ROUND {roundIndex + 1}</Typography>
          <Chip label={ROUND_PHASE_LABEL[phase]} color="primary" sx={{ alignSelf: 'flex-start', fontSize: '1rem', px: 1 }} />
          <Typography color="text.secondary">タイマーによる自動進行はありません。クラス全体の準備ができたら次へ進めてください。</Typography>
          <Button variant="contained" size="large" disabled={advancing} onClick={onAdvance}>次へ</Button>
        </Stack>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 5: テストを実行し成功を確認する**

Run: `npm test -- RoundControlPanel`
Expected: PASS

- [ ] **Step 6: `ControlRoom.tsx` を分岐させる**

`ControlRoom.tsx` の `runHostTick` を起動するuseEffect（142行目付近）を次のように変更し、ラウンドモードでは既存のクラシックモード用ティックループを一切起動しないようにする:

```tsx
useEffect(() => {
  if (!lease || !user || !template || live?.meta?.mode === 'ROUND') return
  // ...既存のクラシックモード用ティックループはそのまま
}, [lease, marketId, services.database, services.firestore, stocks, template, user, live?.meta?.mode])
```

`activeTab === 'control'` のブロックに `live?.meta?.mode === 'ROUND'` の分岐を追加し、`RoundControlPanel` と `httpsCallable(functions, 'advancePhase')` を配線する（既存の `MarketControlPanel`/`HostStatusPanel` はクラシックモード側にそのまま残す）。

- [ ] **Step 7: `npm run verify` を実行する**

- [ ] **Step 8: コミット**

```bash
git add src/components/teacher/RoundControlPanel.tsx src/components/teacher/RoundControlPanel.test.tsx src/components/teacher/ControlRoom.tsx src/lib/market/liveMarketTypes.ts
git commit -m "feat: add round-mode progression UI and branch ControlRoom's tick loop"
```

---

### Task 9: 生徒向けチーム注文UI（`TeamOrderPanel`）

`TradePanel`（クラシックモード、個人が即座に注文して即座に約定する前提のUI）とは別コンポーネントにする — ラウンドモードは「チームで下書きを編集し、確定し、締切を待つ」という全く違う操作フローのため、条件分岐で無理に共用すると両モードとも読みにくくなる。

**Files:**
- Create: `src/components/student/TeamOrderPanel.tsx`
- Test: `src/components/student/TeamOrderPanel.test.tsx`

**Interfaces:**
- Consumes: `TeamRoundDecision`, `PlannedOrder`（Task 1）, `editTeamDecision`, `submitTeamDecision`（Task 2）

- [ ] **Step 1: 失敗するテストを書く**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TeamOrderPanel } from './TeamOrderPanel'

const decision = { revision: 3, orders: [], reason: '', referencedDocumentIds: [], updatedByParticipantId: '', updatedAtMillis: 0, submitted: false }

describe('TeamOrderPanel', () => {
  it('shows submitted status and lets the team add an order with a rationale', () => {
    const onEdit = vi.fn()
    render(<TeamOrderPanel decision={decision} companies={[{ id: 'acme', name: 'Acme', symbol: 'AC' }]} currentPrice={{ acme: 500 }} onEdit={onEdit} onSubmit={vi.fn()} submitting={false} />)
    fireEvent.change(screen.getByLabelText('数量'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('判断理由'), { target: { value: '好決算のニュースを見たため' } })
    fireEvent.click(screen.getByRole('button', { name: '買い注文を追加' }))
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ orders: [{ stockId: 'acme', side: 'BUY', quantity: 3 }], reason: '好決算のニュースを見たため' }))
  })

  it('shows an unsubmitted warning distinct from a submitted state', () => {
    render(<TeamOrderPanel decision={decision} companies={[]} currentPrice={{}} onEdit={vi.fn()} onSubmit={vi.fn()} submitting={false} />)
    expect(screen.getByText(/まだチームの回答として確定していません/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 実行して失敗を確認する**

Run: `npm test -- TeamOrderPanel`
Expected: FAIL

- [ ] **Step 3: 実装する**

```tsx
import { useState } from 'react'
import { Alert, Button, Chip, Stack, TextField, Typography } from '@mui/material'
import { StudentField } from '../ui/StudentUi'
import type { PlannedOrder, TeamRoundDecision } from '../../lib/market/roundTypes'

interface TeamOrderPanelProps {
  decision: TeamRoundDecision
  companies: { id: string; name: string; symbol: string }[]
  currentPrice: Record<string, number>
  onEdit: (edit: { orders: PlannedOrder[]; reason: string; referencedDocumentIds: string[] }) => void
  onSubmit: () => void
  submitting: boolean
}

export function TeamOrderPanel({ decision, companies, currentPrice, onEdit, onSubmit, submitting }: TeamOrderPanelProps) {
  const [stockId, setStockId] = useState(companies[0]?.id ?? '')
  const [quantity, setQuantity] = useState<number | string>('')
  const [reason, setReason] = useState(decision.reason)

  const addOrder = (side: 'BUY' | 'SELL') => {
    const parsed = Math.floor(Number(quantity))
    if (!stockId || !Number.isInteger(parsed) || parsed < 1) return
    onEdit({ orders: [...decision.orders, { stockId, side, quantity: parsed }], reason, referencedDocumentIds: decision.referencedDocumentIds })
    setQuantity('')
  }

  return (
    <Stack spacing={2}>
      <Chip label={decision.submitted ? 'チームの回答として確定済み' : '下書き'} color={decision.submitted ? 'success' : 'default'} sx={{ alignSelf: 'flex-start' }} />
      {!decision.submitted && <Alert severity="info">まだチームの回答として確定していません。締切までに「この内容で確定する」を押してください。</Alert>}
      <TextField select label="銘柄" value={stockId} onChange={(event) => setStockId(event.target.value)} SelectProps={{ native: true }}>
        {companies.map((company) => <option key={company.id} value={company.id}>{company.name} (¥{currentPrice[company.id]?.toLocaleString() ?? '-'})</option>)}
      </TextField>
      <StudentField id="quantity" label="数量" type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="numeric" min={1} max={100000} step={1} />
      <TextField label="判断理由" value={reason} onChange={(event) => setReason(event.target.value)} multiline minRows={2} />
      <Stack direction="row" spacing={1}>
        <Button variant="contained" color="success" onClick={() => addOrder('BUY')}>買い注文を追加</Button>
        <Button variant="outlined" color="error" onClick={() => addOrder('SELL')}>売り注文を追加</Button>
      </Stack>
      <Stack component="ul" spacing={0.5}>
        {decision.orders.map((order, index) => <Typography component="li" key={`${order.stockId}-${index}`}>{order.side === 'BUY' ? '買い' : '売り'} {order.stockId} {order.quantity}株</Typography>)}
      </Stack>
      <Button variant="contained" size="large" disabled={submitting || decision.orders.length === 0} onClick={onSubmit}>この内容で確定する</Button>
    </Stack>
  )
}
```

- [ ] **Step 4: テストを実行し成功を確認する**

Run: `npm test -- TeamOrderPanel`
Expected: PASS

- [ ] **Step 5: `StudentMarketPage.tsx` を `meta.mode` で分岐させる**

`meta?.mode === 'ROUND'` のとき `TradePanel` の代わりに `TeamOrderPanel` を出し、`editTeamDecision`/`submitTeamDecision`（Task 2）を配線する。既存のクラシックモード分岐（`meta?.status === 'ENDED'` 以降の全ロジック）はそのまま残す。

- [ ] **Step 6: `npm run verify` を実行する**

- [ ] **Step 7: コミット**

```bash
git add src/components/student/TeamOrderPanel.tsx src/components/student/TeamOrderPanel.test.tsx src/components/student/StudentMarketPage.tsx
git commit -m "feat: add round-mode team order drafting UI"
```

---

## 1.5 銘柄別ニュースと需給連動

**依存関係の注記（`docs/superpowers/plans/2026-08-05-master-roadmap-plan.md` 「1.5と1.6の関係」節に基づく）:** Task 10〜14 は Task 1〜9（1.4本体）の完了後にのみ着手できる。Task 15〜21（1.6）とは互いに独立で並行してよいが、Task 18（振り返りグラフのニュース重ね合わせ）だけは Task 11 が完了してからでないと意味のある表示にならない。

### Task 10: テンプレートへ `marketDepthWeight` / `sensitivity` / `demandLinkedPricing` を追加

**Files:**
- Modify: `LessonTemplate v2` のスキーマファイル（実パスはTask 1のStep 0で確定した1.2の成果物に合わせる。以下は暫定的に `src/lib/templates/types.ts` を仮定して書く）
- Test: 同ファイルに対応する `*.test.ts`

**Interfaces:**
- Produces: `market.marketDepthWeight: number`（既定値 `1.0`）, `market.sensitivity: number`, `market.maxDemandImpact: number`, `market.demandLinkedPricing: boolean`（既定値 `false`）

- [ ] **Step 1: 失敗するテストを書く**

テンプレートのデフォルト値生成関数（1.2が作った `normalizeTemplate` 相当）に対して:

```ts
it('defaults demandLinkedPricing to false and marketDepthWeight to 1.0 for a template that predates Phase 1.5', () => {
  const normalized = normalizeTemplateV2({ /* ...v2の最小構成... */ } as never)
  expect(normalized.market.demandLinkedPricing).toBe(false)
  expect(normalized.market.marketDepthWeight).toBe(1.0)
})
```

*(実際のテスト対象関数名・既存フィールドは1.2の成果物を見てから埋める — ここでの目的は「新フィールドが未設定の既存テンプレートでも安全な既定値にフォールバックする」という契約を先に固定すること。)*

- [ ] **Step 2: 実行して失敗を確認する**

- [ ] **Step 3: 型とデフォルト値を追加する**

```ts
export interface TemplateMarketConfig {
  // ...既存フィールド...
  /** liquidityScale = 全チームの初期資金合計 × marketDepthWeight。既定値1.0で
   * 「全チームが全資金を1銘柄へ投じるとdemandRatioが概ね1.0になる」という設計の基準を満たす。 */
  marketDepthWeight: number
  /** demandImpactPercent = clamp(demandRatio * sensitivity, -maxDemandImpact, maxDemandImpact) */
  sensitivity: number
  maxDemandImpact: number
  demandLinkedPricing: boolean
}
```

- [ ] **Step 4: テストを実行し成功を確認する**

- [ ] **Step 5: `npm run verify` を実行する**

- [ ] **Step 6: コミット**

```bash
git commit -m "feat: add demand-linked pricing fields to LessonTemplate v2"
```

---

### Task 11: 銘柄別ニュース影響と遅延スケジュール（純粋関数）

**Files:**
- Modify: `src/lib/market/roundEngine.ts`
- Modify: `src/lib/market/roundEngine.test.ts`

**Interfaces:**
- Consumes: `ScheduledNewsImpact`（Task 1）
- Produces: `resolveNewsImpactsForRound(schedule, roundIndex): Record<stockId, number>`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { resolveNewsImpactsForRound } from './roundEngine'

describe('resolving delayed per-stock news impacts', () => {
  it('fires an impact only in the exact round its roundOffset resolves to', () => {
    const schedule = [
      { assetId: 'rail', roundOffset: 2, percent: -3, publishedRoundIndex: 1 },
      { assetId: 'rail', roundOffset: 3, percent: -2, publishedRoundIndex: 1 },
    ]
    expect(resolveNewsImpactsForRound(schedule, 3)).toEqual({ rail: -3 })
    expect(resolveNewsImpactsForRound(schedule, 4)).toEqual({ rail: -2 })
    expect(resolveNewsImpactsForRound(schedule, 5)).toEqual({})
  })

  it('sums multiple impacts on the same stock landing in the same round', () => {
    const schedule = [
      { assetId: 'acme', roundOffset: 1, percent: 5, publishedRoundIndex: 0 },
      { assetId: 'acme', roundOffset: 0, percent: -2, publishedRoundIndex: 1 },
    ]
    expect(resolveNewsImpactsForRound(schedule, 1)).toEqual({ acme: 3 })
  })

  it('never lets an event fire before its publishedRoundIndex', () => {
    expect(resolveNewsImpactsForRound([{ assetId: 'acme', roundOffset: 0, percent: 10, publishedRoundIndex: 5 }], 4)).toEqual({})
  })
})
```

- [ ] **Step 2: 実行して失敗を確認する**

Run: `npm test -- roundEngine`
Expected: FAIL

- [ ] **Step 3: 実装する**

`roundEngine.ts` に追記:

```ts
/** roundOffset is relative to when the news was published (or scheduled by the template),
 * not relative to the lesson start — this is what lets the same template author "this news
 * hits 2 rounds after it's revealed" regardless of which round it happens to be revealed in. */
export const resolveNewsImpactsForRound = (schedule: ScheduledNewsImpact[], roundIndex: number): Record<string, number> => {
  const totals: Record<string, number> = {}
  for (const impact of schedule) {
    if (impact.publishedRoundIndex + impact.roundOffset === roundIndex) totals[impact.assetId] = (totals[impact.assetId] ?? 0) + impact.percent
  }
  return totals
}
```

- [ ] **Step 4: テストを実行し成功を確認する**

- [ ] **Step 5: `settleRoundAdmin`（Task 4, `functions/src/round/settleRound.ts`）を書き換え、`newsPercentByStock: {}` を実際の解決結果へ差し替える**

```ts
// settleRoundAdmin 内、SettleRoundInput の組み立て箇所を変更
const newsSchedule = ((await marketRef.child('privateEngineState/newsSchedule').get()).val() ?? []) as ScheduledNewsImpact[]
const input: SettleRoundInput = {
  // ...
  newsPercentByStock: resolveNewsImpactsForRound(newsSchedule, roundIndex),
  // ...
}
```

- [ ] **Step 6: `npm run verify` を実行する**

- [ ] **Step 7: コミット**

```bash
git add src/lib/market/roundEngine.ts src/lib/market/roundEngine.test.ts functions/src/round/settleRound.ts
git commit -m "feat: resolve per-stock delayed news impact schedules in settlement"
```

---

### Task 12: 需給連動（金額ベース）の実装と `settleRound` への統合

**Files:**
- Modify: `src/lib/market/roundEngine.ts`
- Modify: `src/lib/market/roundEngine.test.ts`
- Modify: `functions/src/round/settleRound.ts`

**Interfaces:**
- Produces: `computeDemandImpact(validatedOrdersByTeam, liquidityScale, sensitivity, maxDemandImpact): { demandPercentByStock, volumeByStock }`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { computeDemandImpact } from './roundEngine'

describe('money-based demand impact', () => {
  it('nets buy and sell value per stock across all teams, and clamps to maxDemandImpact', () => {
    const result = computeDemandImpact(
      { red: [{ stockId: 'acme', side: 'BUY', quantity: 10, valueAtQuote: 1000 }], blue: [{ stockId: 'acme', side: 'SELL', quantity: 2, valueAtQuote: 200 }] },
      1000, // liquidityScale
      50,   // sensitivity
      15,   // maxDemandImpact
    )
    // netDemandValue = 800, demandRatio = 0.8, raw = 0.8 * 50 = 40 -> clamped to 15
    expect(result.demandPercentByStock.acme).toBe(15)
    expect(result.volumeByStock.acme).toBe(12)
  })

  it('is zero for a stock nobody traded', () => {
    expect(computeDemandImpact({}, 1000, 50, 15)).toEqual({ demandPercentByStock: {}, volumeByStock: {} })
  })
})
```

- [ ] **Step 2: 実行して失敗を確認する**

- [ ] **Step 3: 実装する**

```ts
export const computeDemandImpact = (
  validatedOrdersByTeam: Record<string, ValidatedOrder[]>,
  liquidityScale: number,
  sensitivity: number,
  maxDemandImpact: number,
): { demandPercentByStock: Record<string, number>; volumeByStock: Record<string, number> } => {
  const netDemandValueByStock: Record<string, number> = {}
  const volumeByStock: Record<string, number> = {}
  for (const orders of Object.values(validatedOrdersByTeam)) {
    for (const order of orders) {
      netDemandValueByStock[order.stockId] = (netDemandValueByStock[order.stockId] ?? 0) + (order.side === 'BUY' ? order.valueAtQuote : -order.valueAtQuote)
      volumeByStock[order.stockId] = (volumeByStock[order.stockId] ?? 0) + order.quantity
    }
  }
  const demandPercentByStock: Record<string, number> = {}
  for (const [stockId, netValue] of Object.entries(netDemandValueByStock)) {
    const ratio = liquidityScale > 0 ? netValue / liquidityScale : 0
    demandPercentByStock[stockId] = Math.max(-maxDemandImpact, Math.min(maxDemandImpact, ratio * sensitivity))
  }
  return { demandPercentByStock, volumeByStock }
}
```

- [ ] **Step 4: テストを実行し成功を確認する**

- [ ] **Step 5: `settleRoundPure` を変更し、検証済み注文から `demandPercentByStock`/`volumeByStock` を計算して使うようにする（テンプレートの `demandLinkedPricing` がfalseなら計算をスキップする）**

`settleRoundPure` のシグネチャに `demandLinkedPricing: boolean; liquidityScale: number; sensitivity: number; maxDemandImpact: number` を追加し、`demandPercentByStock`/`volumeByStock` を外部入力ではなく内部で `validatedByTeam` から計算するよう書き換える（Task 3時点の「外から渡す」設計は、需給が検証済み注文にのみ依存するという制約をこの関数の外に置いてしまっていたため、ここで関数内へ引き上げる）:

```ts
export interface SettleRoundInput {
  // ...
  demandLinkedPricing: boolean
  liquidityScale: number
  sensitivity: number
  maxDemandImpact: number
  // demandPercentByStock, volumeByStock を削除 — settleRoundPure内部で計算する
}

export const settleRoundPure = (input: SettleRoundInput, atMillis: number): SettleRoundOutput => {
  // ...validatedByTeam の計算はそのまま...
  const { demandPercentByStock, volumeByStock } = input.demandLinkedPricing
    ? computeDemandImpact(validatedByTeam, input.liquidityScale, input.sensitivity, input.maxDemandImpact)
    : { demandPercentByStock: {}, volumeByStock: {} }
  // ...breakdown/nextOpeningPriceの計算で input.demandPercentByStock の代わりに demandPercentByStock を使う...
}
```

Task 3・Task 11 で書いたテストのうち `demandPercentByStock`/`volumeByStock` を直接渡していたものを、`demandLinkedPricing: false`（または相当のtrue+liquidityScale等の指定）に書き換える。

- [ ] **Step 6: `settleRoundAdmin`（`functions/src/round/settleRound.ts`）を更新し、テンプレートから読んだ `marketDepthWeight`/`sensitivity`/`maxDemandImpact`/`demandLinkedPricing` を渡す**

```ts
const templateMarket = ((await marketRef.child('templateSnapshot/market').get()).val() ?? {}) as { marketDepthWeight?: number; sensitivity?: number; maxDemandImpact?: number; demandLinkedPricing?: boolean }
const startingCashTotal = Object.values(snapshot.teamPortfolios ?? {}).reduce((sum, p) => sum + p.cash, 0) // 概算。厳密には各チームの初期資金合計を別途保持する方がよい — Task 12実装時に確認する
const input: SettleRoundInput = {
  // ...
  demandLinkedPricing: templateMarket.demandLinkedPricing ?? false,
  liquidityScale: startingCashTotal * (templateMarket.marketDepthWeight ?? 1.0),
  sensitivity: templateMarket.sensitivity ?? 1,
  maxDemandImpact: templateMarket.maxDemandImpact ?? 10,
}
```

**注記:** `liquidityScale = 全チームの初期資金合計 × marketDepthWeight` の「初期資金合計」は、現在の `teamPortfolios.cash`（既に売買で変動した後の値）ではなく、**市場作成時点の初期資金**（`meta.startingCash × チーム数`、または各チームの初期値を別途保持したもの）を使うべきである。`snapshot.teamPortfolios` から合計するのは近似であり、ラウンドが進むほど本来の意図からずれる。実装時に `meta.startingCash * Object.keys(snapshot.teams ?? {}).length` へ置き換えることを検討し、置き換えた場合はコメントで根拠を残す。

- [ ] **Step 7: `npm run verify` を実行する**

- [ ] **Step 8: コミット**

```bash
git add src/lib/market/roundEngine.ts src/lib/market/roundEngine.test.ts functions/src/round/settleRound.ts
git commit -m "feat: implement money-based demand-linked pricing in settlement"
```

---

### Task 13: 教師向けニュース配信UIの銘柄別・遅延対応

**Files:**
- Modify: `src/components/teacher/NewsPublishPanel.tsx`
- Modify: `src/components/teacher/NewsPublishPanel.test.tsx`

**Interfaces:**
- Consumes: `ScheduledNewsImpact`（Task 1）

- [ ] **Step 1: 失敗するテストを書く**

既存の `NewsPublishPanel.test.tsx` に追記（既存のクラシックモード用テストは残す。ラウンドモードでは `onPublish` の第2引数が銘柄別の影響配列になる）:

```tsx
it('lets a teacher target specific stocks with a delayed impact, in round mode', () => {
  const onPublish = vi.fn().mockResolvedValue(undefined)
  render(<NewsPublishPanel disabled={false} mode="ROUND" companies={[{ id: 'acme', name: 'Acme' }]} onPublish={onPublish} />)
  fireEvent.change(screen.getByLabelText('ニュース本文'), { target: { value: '好決算' } })
  fireEvent.mouseDown(screen.getByLabelText('対象銘柄'))
  fireEvent.click(screen.getByText('Acme'))
  fireEvent.change(screen.getByLabelText('影響（%）'), { target: { value: '5' } })
  fireEvent.change(screen.getByLabelText('発生ラウンド数（0=今すぐ）'), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: '配信する' }))
  expect(onPublish).toHaveBeenCalledWith('好決算', [{ assetId: 'acme', roundOffset: 2, percent: 5 }])
})
```

- [ ] **Step 2: 実行して失敗を確認する**

Run: `npm test -- NewsPublishPanel`
Expected: FAIL

- [ ] **Step 3: 実装する**

`NewsPublishPanel` に `mode: 'CLASSIC' | 'ROUND'` propを追加。`mode === 'ROUND'` のとき既存の単一 `impactPercent` セレクトの代わりに、銘柄マルチセレクト・影響%入力・遅延ラウンド数入力を出し、`onPublish(body, impacts: { assetId: string; roundOffset: number; percent: number }[])` を呼ぶ。`mode === 'CLASSIC'`（既定値）では既存の `IMPACT_OPTIONS` セレクトをそのまま残し、既存の呼び出し元（`ControlRoom.tsx` のクラシックモード分岐）は変更不要にする。

- [ ] **Step 4: テストを実行し成功を確認する**

- [ ] **Step 5: `ControlRoom.tsx` のラウンドモード分岐から呼び出す `onPublish` を、`privateEngineState/newsSchedule` へ追記するCallable（または直接のAdmin書き込みが必要なため、新規Callable `publishRoundNews` を `functions/src/round/`に追加）へ配線する**

*(この配線はTask 5で追加した `advancePhase` と同様のパターン。`publishRoundNews` は本Task内で新規作成し、`marketRef.child('privateEngineState/newsSchedule').push(...)` する薄いCallableとする。生徒に見せてよい見出しテキストのみ `liveMarkets/{marketId}/rounds/{roundIndex}/publicNews` へ即時公開し、`impacts` 配列は `privateEngineState` 側にのみ置く。)*

- [ ] **Step 6: `npm run verify` を実行する**

- [ ] **Step 7: コミット**

```bash
git add src/components/teacher/NewsPublishPanel.tsx src/components/teacher/NewsPublishPanel.test.tsx functions/src/round/publishRoundNews.ts src/components/teacher/ControlRoom.tsx
git commit -m "feat: support per-stock delayed news impacts in round mode"
```

---

### Task 14: 内訳・出来高の表示（`RoundResultsPanel`）

**Files:**
- Create: `src/components/teacher/RoundResultsPanel.tsx`
- Test: `src/components/teacher/RoundResultsPanel.test.tsx`

**Interfaces:**
- Consumes: `SettlementPriceEntry`, `SettlementBreakdown`（Task 1）

- [ ] **Step 1: 失敗するテストを書く**

```tsx
it('shows the news/demand/final breakdown and volume for each stock', () => {
  render(<RoundResultsPanel entries={{ acme: { price: 470, breakdown: { newsPercent: -10, demandPercent: 4, appliedPercent: -6 }, volume: 340 } }} companyNames={{ acme: 'Acme' }} />)
  expect(screen.getByText('Acme')).toBeInTheDocument()
  expect(screen.getByText('ニュースの影響')).toBeInTheDocument()
  expect(screen.getByText('-10%')).toBeInTheDocument()
  expect(screen.getByText('生徒の需要')).toBeInTheDocument()
  expect(screen.getByText('+4%')).toBeInTheDocument()
  expect(screen.getByText('出来高 340株')).toBeInTheDocument()
})
```

- [ ] **Step 2〜4:** 失敗確認 → 実装 → 成功確認（既存の `ResultsView.tsx`/`HostStatusPanel.tsx` と同じMUI `Table`ベースの表示スタイルに合わせる）。

- [ ] **Step 5: `npm run verify` を実行する**

- [ ] **Step 6: コミット**

```bash
git add src/components/teacher/RoundResultsPanel.tsx src/components/teacher/RoundResultsPanel.test.tsx
git commit -m "feat: show news/demand breakdown and volume after settlement"
```

---

## 1.6 予想・判断理由の記録と振り返り

Task 15〜17, 19〜21 は1.5と並行して着手できる。Task 18のみ Task 11 の完了後に着手する。

### Task 15: 個人予想の型とRTDB読み書き

**Files:**
- Create: `src/lib/market/predictionTypes.ts`
- Create: `src/lib/market/predictionTrading.ts`
- Test: `src/lib/market/predictionTrading.test.ts`

**Interfaces:**
- Produces: `PersonalPrediction`, `savePrediction`, `applySavePrediction`

- [ ] **Step 1: 型を書く**

```ts
// src/lib/market/predictionTypes.ts
/** liveMarkets/{marketId}/rounds/{roundIndex}/predictions/{teamId}/{participantId}/{stockId}.
 * Keyed by teamId first so the RTDB rule for "teammates may read each other's predictions"
 * can match the same members/$uid/teamId pattern teamPortfolios already uses. */
export interface PersonalPrediction {
  direction: 'UP' | 'FLAT' | 'DOWN'
  confidence: 1 | 2 | 3 | 4 | 5
  rationale: string
  /** Advanced/optional per design doc §Phase1.6 — a standard lesson never asks for this. */
  percentChange?: number
  submittedAtMillis: number
}
```

- [ ] **Step 2: 失敗するテストを書く**

```ts
// src/lib/market/predictionTrading.test.ts
import { describe, expect, it } from 'vitest'
import { applySavePrediction } from './predictionTrading'

describe('saving a personal prediction', () => {
  it('accepts a direction, confidence and rationale, timestamping it', () => {
    const saved = applySavePrediction({ direction: 'UP', confidence: 4, rationale: '好決算が出たため' }, 1_000)
    expect(saved).toEqual({ direction: 'UP', confidence: 4, rationale: '好決算が出たため', submittedAtMillis: 1_000 })
  })
  it('rejects a rationale over 400 characters, matching this app\'s other free-text limits', () => {
    expect(() => applySavePrediction({ direction: 'UP', confidence: 4, rationale: 'あ'.repeat(401) }, 1_000)).toThrow()
  })
})
```

- [ ] **Step 3: 実行して失敗を確認する**

Run: `npm test -- predictionTrading`
Expected: FAIL

- [ ] **Step 4: 実装する**

```ts
// src/lib/market/predictionTrading.ts
import { ref, set, type Database } from 'firebase/database'
import type { PersonalPrediction } from './predictionTypes'

export const applySavePrediction = (input: Pick<PersonalPrediction, 'direction' | 'confidence' | 'rationale' | 'percentChange'>, atMillis: number): PersonalPrediction => {
  if (input.rationale.length > 400) throw new Error('根拠は400文字以内で入力してください。')
  return { ...input, submittedAtMillis: atMillis }
}

export const savePrediction = async (database: Database, marketId: string, roundIndex: number, teamId: string, participantId: string, stockId: string, input: Pick<PersonalPrediction, 'direction' | 'confidence' | 'rationale' | 'percentChange'>, atMillis = Date.now()) =>
  set(ref(database, `liveMarkets/${marketId}/rounds/${roundIndex}/predictions/${teamId}/${participantId}/${stockId}`), applySavePrediction(input, atMillis))
```

- [ ] **Step 5: テストを実行し成功を確認する**

- [ ] **Step 6: RTDBルールを追加する（`database.rules.json`、Task 7と同じファイル）**

```json
"predictions": {
  "$teamId": {
    "$participantId": {
      ".read": "auth != null && (root.child('liveMarkets').child($marketId).child('meta/ownerUid').val() === auth.uid || root.child('liveMarkets').child($marketId).child('members').child(auth.uid).child('teamId').val() === $teamId)",
      ".write": "auth != null && root.child('liveMarkets').child($marketId).child('participants').child($participantId).child('uid').val() === auth.uid"
    }
  }
}
```

（`rounds/$roundIndex` 配下、`teamDecisions` と同階層に追加。チームメイトは読めるが、書けるのは本人のみ。）

- [ ] **Step 7: `npm run verify` を実行する**

- [ ] **Step 8: コミット**

```bash
git add src/lib/market/predictionTypes.ts src/lib/market/predictionTrading.ts src/lib/market/predictionTrading.test.ts database.rules.json
git commit -m "feat: add personal prediction storage with teammate-visible, self-write rules"
```

---

### Task 16: 個人予想入力フォーム（`PredictionForm`）

**Files:**
- Create: `src/components/student/PredictionForm.tsx`
- Test: `src/components/student/PredictionForm.test.tsx`

- [ ] **Step 1: 失敗するテストを書く**

```tsx
it('submits direction, confidence and rationale as the standard three fields', () => {
  const onSubmit = vi.fn()
  render(<PredictionForm stockName="Acme" onSubmit={onSubmit} />)
  fireEvent.click(screen.getByRole('radio', { name: '上昇すると思う' }))
  fireEvent.click(screen.getByRole('radio', { name: '確信度4' }))
  fireEvent.change(screen.getByLabelText('そう考えた理由'), { target: { value: '新商品のニュースを見たから' } })
  fireEvent.click(screen.getByRole('button', { name: '予想を記録する' }))
  expect(onSubmit).toHaveBeenCalledWith({ direction: 'UP', confidence: 4, rationale: '新商品のニュースを見たから' })
})
```

- [ ] **Step 2〜4:** 失敗確認 → 実装（`TradePanel.tsx`/`StudentField` と同じMUIコンポーネントを使い、`ToggleButtonGroup` で方向、`Rating` またはトグルで確信度、`TextField multiline` で根拠を取る）→ 成功確認。

- [ ] **Step 5: `npm run verify` を実行する**

- [ ] **Step 6: コミット**

```bash
git add src/components/student/PredictionForm.tsx src/components/student/PredictionForm.test.tsx
git commit -m "feat: add personal prediction input form"
```

---

### Task 17: チーム内予想比較画面（記名／匿名）

**Files:**
- Create: `src/components/student/TeamPredictionComparison.tsx`
- Test: `src/components/student/TeamPredictionComparison.test.tsx`

**Interfaces:**
- Consumes: `PersonalPrediction`（Task 15）

- [ ] **Step 1: 失敗するテストを書く**

```tsx
it('shows each teammate\'s name when anonymize is off', () => {
  render(<TeamPredictionComparison anonymize={false} predictions={[{ participantId: 'p1', displayName: '田中', direction: 'UP', confidence: 4, rationale: '好材料', submittedAtMillis: 1 }]} />)
  expect(screen.getByText('田中')).toBeInTheDocument()
})

it('replaces names with a stable per-round anonymous label when anonymize is on', () => {
  render(<TeamPredictionComparison anonymize predictions={[{ participantId: 'p1', displayName: '田中', direction: 'UP', confidence: 4, rationale: '好材料', submittedAtMillis: 1 }, { participantId: 'p2', displayName: '鈴木', direction: 'DOWN', confidence: 2, rationale: '', submittedAtMillis: 2 }]} />)
  expect(screen.queryByText('田中')).not.toBeInTheDocument()
  expect(screen.getByText('生徒A')).toBeInTheDocument()
  expect(screen.getByText('生徒B')).toBeInTheDocument()
})
```

- [ ] **Step 2〜4:** 失敗確認 → 実装（`anonymize` propに応じて `displayName` を `生徒A`/`生徒B`... に置き換える。並び順は `participantId` の安定ソートで固定し、匿名化してもラベルが再読み込みごとに入れ替わらないようにする）→ 成功確認。

- [ ] **Step 5: `npm run verify` を実行する**

- [ ] **Step 6: コミット**

```bash
git add src/components/student/TeamPredictionComparison.tsx src/components/student/TeamPredictionComparison.test.tsx
git commit -m "feat: add team prediction comparison with teacher-controlled anonymization"
```

---

### Task 18: 振り返りグラフ（`settlementPriceHistory` 限定）

**依存:** Task 11（1.5の遅延ニュース解決）完了後に着手。

**Files:**
- Create: `src/components/student/PriceNewsChart.tsx`
- Test: `src/components/student/PriceNewsChart.test.tsx`

**Interfaces:**
- Consumes: `SettlementPriceEntry`（Task 1）— **`RevealAnimation` は一切importしない。この型がコンポーネントの入力に現れないこと自体が、混同を防ぐ設計上のガード。**

- [ ] **Step 1: 失敗するテストを書く**

```tsx
it('plots only settlementPriceHistory entries, one point per round, with the news breakdown annotated', () => {
  render(<PriceNewsChart stockName="Acme" history={{ 0: { price: 500, breakdown: { newsPercent: 0, demandPercent: 0, appliedPercent: 0 }, volume: 0 }, 1: { price: 470, breakdown: { newsPercent: -10, demandPercent: 4, appliedPercent: -6 }, volume: 340 } }} />)
  expect(screen.getByRole('img', { name: /Acme の価格推移/ })).toBeInTheDocument()
  expect(screen.getByText('ラウンド2: ニュース -10%')).toBeInTheDocument()
})

it('never accepts a prop shaped like RevealAnimation, by construction — this test documents that PriceNewsChartProps has no such field', () => {
  // Compile-time guard: PriceNewsChartProps intentionally has no `revealAnimation` key.
  // If a future edit adds one, this test's type assertion below fails to typecheck.
  type Props = React.ComponentProps<typeof PriceNewsChart>
  const check: 'revealAnimation' extends keyof Props ? never : true = true
  expect(check).toBe(true)
})
```

- [ ] **Step 2〜4:** 失敗確認 → 実装（SVGまたは軽量な折れ線チャートを自前で描画する — 既存コードベースに他のチャートライブラリ依存が無いため、新規に重い依存を足さず `<svg>` で十分。各点にニュース内訳をツールチップまたは注記テキストとして表示）→ 成功確認。

- [ ] **Step 5: `ResultsView.tsx` に `PriceNewsChart` を組み込む**

- [ ] **Step 6: `npm run verify` を実行する**

- [ ] **Step 7: コミット**

```bash
git add src/components/student/PriceNewsChart.tsx src/components/student/PriceNewsChart.test.tsx src/components/student/ResultsView.tsx
git commit -m "feat: add reflection price/news chart sourced only from settlementPriceHistory"
```

---

### Task 19: 評価指標の分離表示（自動計算 vs ルーブリック）

**Files:**
- Modify: `src/components/student/ResultsView.tsx`（または新規 `src/components/teacher/AssessmentPanel.tsx` — 教師の採点画面として作る場合はそちらに実装する）
- Create: `src/lib/market/assessmentMetrics.ts`
- Test: `src/lib/market/assessmentMetrics.test.ts`

**Interfaces:**
- Produces: `computeAutomaticMetrics(predictions, orders, roundHistory): AutomaticMetrics`（設計の表の左列のみ。「根拠の論理性」「反対方向の影響も考慮したか」等の右列（ルーブリック）は**この関数の戻り値に含めない** — 型で分離することが目的）

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { computeAutomaticMetrics } from './assessmentMetrics'

describe('automatic assessment metrics', () => {
  it('computes only the metrics the design doc lists as automatic — never a rubric field', () => {
    const metrics = computeAutomaticMetrics({ predictions: [], orders: [], settlementHistory: {} })
    expect(Object.keys(metrics)).toEqual(['predictionAccuracyRate', 'referencedDocumentCount', 'comparedMultipleSourcesCount', 'decisionChangeCount', 'predictionAndActionConsistent'])
    // Compile-time guard: AutomaticMetrics must not have a key resembling a rubric judgment.
    expect(Object.keys(metrics)).not.toContain('rationaleQuality')
  })
})
```

- [ ] **Step 2〜4:** 失敗確認 → 実装（設計の表「自動計算」列5項目をそのまま関数化。それぞれの計算式は次の通り: `predictionAccuracyRate` = 予想方向と実際の確定価格変化の方向が一致した割合、`referencedDocumentCount` = `TeamRoundDecision.referencedDocumentIds` の延べ数、`comparedMultipleSourcesCount` = 複数の資料IDを参照したラウンド数、`decisionChangeCount` = 同ラウンド内で `TeamRoundDecision` が編集され直した回数（`revision` の増分から推定）、`predictionAndActionConsistent` = 予想方向と実際に出した注文の売買方向が一致しているか）→ 成功確認。
- [ ] **Step 5: `AutomaticMetrics` 型に「根拠の妥当性」に類する項目を追加しないことをコードコメントで明記する**（設計の「自動採点は教育上不適切」という判断根拠を型定義の直上に残す）。
- [ ] **Step 6: `npm run verify` を実行する**
- [ ] **Step 7: コミット**

```bash
git add src/lib/market/assessmentMetrics.ts src/lib/market/assessmentMetrics.test.ts src/components/student/ResultsView.tsx
git commit -m "feat: compute automatic assessment metrics, deliberately excluding rubric judgments"
```

---

### Task 20: 個人単位の結果削除・匿名化ロジック

**Files:**
- Create: `src/lib/teacher/participantDeletion.ts`
- Test: `src/lib/teacher/participantDeletion.test.ts`

これは既存の `deleteMarketCompletely`（`src/lib/teacher/marketDeletion.ts`、市場ごと丸ごと削除）とは別のもの — 個人1名分の結果だけを扱う。**未成年データの扱いについての具体案はTask末尾を参照。**

**Interfaces:**
- Consumes: `ExportedParticipantResult`（`src/lib/teacher/resultsExport.ts`）
- Produces: `deleteParticipantResult(firestore, marketId, participantId): Promise<void>`, `anonymizeParticipantResult(firestore, marketId, participantId): Promise<void>`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, expect, it, vi } from 'vitest'
import { anonymizeParticipantResult, deleteParticipantResult } from './participantDeletion'

describe('per-participant result deletion and anonymization', () => {
  it('deletes only the named participant\'s result doc, leaving teams and other participants untouched', async () => {
    const deleteDoc = vi.fn()
    const doc = vi.fn((_db, ...path) => path.join('/'))
    await deleteParticipantResult({ deleteDoc, doc } as never, 'market-a', 'p1')
    expect(deleteDoc).toHaveBeenCalledWith('marketResults/market-a/participants/p1')
  })

  it('anonymization overwrites displayName only, keeping predictions/transactions/rationale for pedagogical review', async () => {
    const updateDoc = vi.fn()
    const doc = vi.fn((_db, ...path) => path.join('/'))
    await anonymizeParticipantResult({ updateDoc, doc } as never, 'market-a', 'p1')
    expect(updateDoc).toHaveBeenCalledWith('marketResults/market-a/participants/p1', { displayName: '(匿名化済み)' })
  })
})
```

- [ ] **Step 2: 実行して失敗を確認する**

- [ ] **Step 3: 実装する**

```ts
import { deleteDoc, doc, updateDoc, type Firestore } from 'firebase/firestore'

/** Distinct from deleteMarketCompletely: removes exactly one participant's result doc.
 * Firestore security rules already restrict this path's delete to the market's owner
 * (firestore.rules:102), so no extra ownership check is needed here. */
export const deleteParticipantResult = async (firestore: Firestore, marketId: string, participantId: string) =>
  deleteDoc(doc(firestore, 'marketResults', marketId, 'participants', participantId))

/** Severs the name-to-data link while preserving predictions, transactions and rationale
 * for the teacher's rubric review — deleting those would also destroy the pedagogical
 * record the reflection features exist to produce. */
export const anonymizeParticipantResult = async (firestore: Firestore, marketId: string, participantId: string) =>
  updateDoc(doc(firestore, 'marketResults', marketId, 'participants', participantId), { displayName: '(匿名化済み)' })
```

- [ ] **Step 4: テストを実行し成功を確認する**

- [ ] **Step 5: `finalizeEnding`（`hostTrading.ts:261`）が書き込む `marketResults/{marketId}/participants/{participantId}` へ、予想・判断理由も含めるよう拡張する**

`finalizeEnding` の `participantWrites` に、`snapshot.rounds` から集めた `predictions`/`teamDecisions.reason` を含める（実装時、ラウンド数分ループしてマージする）。

- [ ] **Step 6: `npm run verify` を実行する**

- [ ] **Step 7: コミット**

```bash
git add src/lib/teacher/participantDeletion.ts src/lib/teacher/participantDeletion.test.ts src/lib/market/hostTrading.ts
git commit -m "feat: add per-participant result deletion and name anonymization"
```

**未成年データの扱い（設計ドキュメントが「Phase 1.6で決定」としていた事項の具体案）:**

1. **保存範囲:** 個人予想は `participantId` にひも付けて保存し（`displayName` はそこから引かない — 既存の `LiveMarketParticipant.displayName` を参照する形を踏襲）、新たな個人情報項目（メールアドレス・学籍番号等）は追加しない。根拠テキスト (`rationale`) は生徒の自由記述であり、生徒自身が実名等を書き込む可能性は排除できないため、削除経路（本Task）を必ず用意することで対応する。
2. **保持先とタイミング:** ラウンド中はRTDB（`liveMarkets/{marketId}/rounds/*/predictions`）に一時的に存在し、`finalizeEnding` で `marketResults/{marketId}/participants/{participantId}` へ確定コピーされる — 既存の取引履歴・ポートフォリオの確定と全く同じ経路に相乗りさせる（新しい削除・エクスポート基盤を別途作らない）。
3. **匿名化:** `anonymizeParticipantResult` で `displayName` のみを上書きする。予想・判断理由・取引履歴はルーブリック評価のために残す。匿名化は「氏名だけ消す」不可逆操作として提供し、完全削除（`deleteParticipantResult`）とは別の操作として教師に両方提示する。
4. **チーム内比較画面の記名/匿名（Task 17）は表示上の切り替えであり、保存データそのものは変えない。** 教師が「今回は匿名で見せたい」と決めた場合でも、後でルーブリック採点する際は記名で見られる必要があるため。
5. **削除の実行主体:** 設計ドキュメントの決定（`design.md:556` 付近）通り、生徒本人はセッションを失うと本人確認ができないため、削除・エクスポート・匿名化はすべて教師（`ownerUid`）のみが実行できる。生徒本人からの削除要求は教師を経由する運用とする。
6. **保持期間:** Phase 1では自動失効を実装しない（組織単位の保持ポリシーはPhase 7の範囲）。教師が手動で削除するまで残る。これは「正式提供の前に学校の情報管理規程・契約・プライバシーポリシーへの適合を確認する」という設計ドキュメントの留保（`design.md:558`）の範囲内であり、**本計画の実装だけでは正式な学校導入の要件を満たしたことにはならない** — 実運用前に法務・学校側との確認が必要である旨をTeacherGuide等に明記することを推奨する（本計画の範囲外だが、次のフェーズ着手前に必ず対応すること）。

---

### Task 21: CSVエクスポートの拡張と削除・匿名化UI

**Files:**
- Modify: `src/lib/teacher/resultsExport.ts`
- Modify: `src/lib/teacher/resultsExport.test.ts`
- Create: `src/components/teacher/ParticipantResultsPanel.tsx`
- Test: `src/components/teacher/ParticipantResultsPanel.test.tsx`

**Interfaces:**
- Consumes: `deleteParticipantResult`, `anonymizeParticipantResult`（Task 20）, `computeAutomaticMetrics`（Task 19）

- [ ] **Step 1: 失敗するテストを書く（CSV拡張）**

```ts
it('includes each participant\'s prediction direction, confidence and rationale alongside existing transaction fields', () => {
  const csv = buildTransactionCsv(
    [{ participantId: 'p1', displayName: '田中', teamId: 'red', transactions: {}, predictions: { acme: { direction: 'UP', confidence: 4, rationale: '好決算', submittedAtMillis: 1 } } }] as never,
    { acme: 'Acme' },
  )
  expect(csv).toContain('予想方向')
  expect(csv).toContain('上昇')
  expect(csv).toContain('好決算')
})
```

- [ ] **Step 2〜4:** 失敗確認 → `ExportedParticipantResult` に `predictions?: Record<string, PersonalPrediction>` を追加し、`buildTransactionCsv`（または新規 `buildPredictionCsv`）に列を追加 → 成功確認（既存の `RISKY_LEADING_CHAR`/`escapeField` エスケープを予想の `rationale` にも必ず通す — 自由記述はCSVインジェクションの標的になり得る）。

- [ ] **Step 5: `ParticipantResultsPanel` の失敗するテストを書く**

```tsx
it('lets a teacher delete or anonymize a single participant\'s result, with a confirmation for delete', () => {
  const onDelete = vi.fn()
  const onAnonymize = vi.fn()
  render(<ParticipantResultsPanel participants={[{ participantId: 'p1', displayName: '田中', teamId: 'red' }]} onDelete={onDelete} onAnonymize={onAnonymize} />)
  fireEvent.click(screen.getByRole('button', { name: '匿名化' }))
  expect(onAnonymize).toHaveBeenCalledWith('p1')
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: '削除' }))
  expect(onDelete).toHaveBeenCalledWith('p1')
})
```

- [ ] **Step 6〜8:** 失敗確認 → 実装（既存の `ControlRoom.tsx` の `onRemove`（195行目、`window.confirm` を使うパターン）に倣い、削除には確認ダイアログを必須にする。匿名化は不可逆だが破壊的ではない（データは残る）ため確認なしでよい）→ 成功確認。

- [ ] **Step 9: `npm run verify` を実行する**

- [ ] **Step 10: コミット**

```bash
git add src/lib/teacher/resultsExport.ts src/lib/teacher/resultsExport.test.ts src/components/teacher/ParticipantResultsPanel.tsx src/components/teacher/ParticipantResultsPanel.test.tsx
git commit -m "feat: export predictions in CSV and add per-participant delete/anonymize UI"
```

---

## Phase 1.4〜1.6 の完了条件

設計ドキュメントには1.4〜1.6個別の完了条件がチェックリストとして書かれていない（`docs/superpowers/plans/2026-08-05-master-roadmap-plan.md` 「2. 各フェーズの完了条件」節で確認済み）。以下は本計画が定義する、測定可能な完了条件。

### 1.4 完了条件

- [ ] 8フェーズ（導入／情報収集／個人予想／チーム相談／売買／変動／解説／振り返り）の状態遷移が実装され、`advancePhase` Callableのテストで全遷移がカバーされている
- [ ] タイマーによる自動進行が標準で無効であることをテストで確認している（`advancePhase` は教師の明示的な呼び出しでのみ進む）
- [ ] `TeamRoundDecision` の編集で `submitted` が必ず `false` へ戻ることがテストで確認されている
- [ ] `revision` が一致しない編集・確定が拒否されることがテストで確認されている
- [ ] `settleRound` が二重実行されても副作用が1回分にとどまることが冪等性テストで確認されている
- [ ] `settleRound` が未検証の注文を需給計算（1.5統合後）に混入させないことが回帰テストで固定されている（Task 3 Step 5）
- [ ] `placeContinuousOrder` が `hostLease` 無効時・価格陳腐化時に注文を拒否することがテストで確認されている
- [ ] `npm run verify` が通る
- [ ] エミュレータ上で、教師役1名・チーム2つ以上が1ラウンドを最初から最後まで進行できることを手動またはE2Eで確認している（教師の「次へ」→生徒のチーム注文編集・確定→締切→約定→次ラウンドの開始価格反映）

### 1.5 完了条件

- [ ] `resolveNewsImpactsForRound` が銘柄ごとに異なる影響・遅延ラウンドを正しく解決することがテストで確認されている
- [ ] `computeDemandImpact` が金額ベースで需給を計算し、`maxDemandImpact` でクランプされることがテストで確認されている
- [ ] `demandLinkedPricing` フラグがオフのとき、需給の影響が常に0になることがテストで確認されている
- [ ] 変化率の内訳（ニュース／需給／最終）が `settlementPriceHistory` に保存され、教師・生徒双方の画面に表示される
- [ ] 出来高が生徒に表示される
- [ ] `npm run verify` が通る

### 1.6 完了条件

- [ ] 個人予想（方向・確信度・根拠）の入力・保存・チーム内比較（記名／匿名切り替え）が一通り動作する
- [ ] 振り返りグラフが `settlementPriceHistory` のみを描画し、`RevealAnimation` の値を一切参照しないことが型レベル・テストレベルの両方で固定されている（Task 18 Step 1の2つ目のテスト）
- [ ] 自動計算指標（`computeAutomaticMetrics`）とルーブリック指標が型レベルで分離されており、「根拠の妥当性」に類する項目が自動計算指標に含まれていないことをコードレビューで確認している
- [ ] 個人単位の削除・匿名化・CSVエクスポートが実装され、Firestoreルールテストで「市場の作成者（教師）のみが実行できる」ことが確認されている
- [ ] 未成年データの扱い（保存範囲・匿名化・削除方法）について、本計画のTask 20末尾の具体案が実装へ反映されている
- [ ] `npm run verify` が通る

### Phase 1全体（「社会科のラウンド制授業が実施可能」の検証、design.md:1007）

- [ ] 1.1〜1.6の全タスクが完了している
- [ ] 既存の公式テンプレート3種（学園祭・宇宙都市・地域再生）のうち少なくとも1つ、またはラウンドモード用の新規デモテンプレートで、`marketDepthWeight`/`sensitivity`/`demandLinkedPricing` を含む実際の銘柄構成に対して `settleRound` が破綻なく完走する
- [ ] エミュレータまたはstaging環境で、教師役1名・チーム2つ以上・生徒複数名が8フェーズ×複数ラウンドを通しで実行できることを確認している（Phase 0bで整備したstaging Blazeプロジェクトを再利用できる）
- [ ] 生徒が売買フェーズ以外で将来価格・将来ニュースを取得できないことを、RTDBルールテスト（`privateEngineState` への読み取り拒否）と手動のDevTools確認の両方で確認している — 「先読み脆弱性は原理的に発生しない」という設計目標（design.md:299）の検証
- [ ] クラシックモードの `placeContinuousOrder()` サーバー化により、既存の生徒発注フロー（`submitOrder`）が置き換わったことに伴う回帰がないこと（既存の `StudentMarketPage.test.tsx` 等のクラシックモードテストが全て通る）
