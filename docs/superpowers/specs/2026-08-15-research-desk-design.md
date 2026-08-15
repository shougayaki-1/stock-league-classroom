# Research Desk 設計仕様

**日付:** 2026-08-15
**対象:** Phase 2「授業運用の質」— 生徒側 Research Desk
**正本:** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md`
**関連:** `docs/superpowers/scope-backlog.md`

## 背景

Phase 2 で未着手なのは、生徒が授業フェーズに応じて企業・ニュース・統計・チームノート・注文を扱う Research Desk である。現行の `src/components/student/LessonPlayPage.tsx` は現在課題・公開情報・回答入力を受け取る薄い shell で、`src/App.tsx` の `/lessons/:runId/play` はアクセス確認後も `DeferredDataNotice` を表示するだけで実データに結線されていない。

市場側には `@stock-league/market-public-content` の `CompanyPublicView` / `InformationPublicView` / `EconomicIndicatorPublicView` と、`functions/src/market/toPublicView.ts` の allow-list 変換が既に存在する。Research Desk はこの公開契約を再利用し、`market-authoring-content` の内部係数や未来情報を生徒クライアントへ渡さない。

## スコープ判断（ユーザー承認済み）

Research Desk は次の5画面を持つ。

1. 企業ページ
2. ニュース一覧
3. 統計資料
4. チームノート
5. 注文画面

`LessonPlayPage` に5機能を直接詰め込まず、Research Desk を独立した student workspace として構成する。既存の現在課題・残り時間・チーム状態は Research Desk の外側または共通ヘッダーで扱い、各パネルは公開済みデータだけを受け取る。

## 公開データ境界

Research Desk の企業・ニュース・統計は `lessonRunPublic/{lessonRunId}` に server-only projection として載せる。クライアントが `LessonTemplate` / `LessonVersion` / authoring content を直接読む経路は作らない。

公開 projection は `functions/src/market/toPublicView.ts` を唯一の authoring→student 変換境界として使う。

```ts
export type ResearchDeskPanelId =
  | 'COMPANIES'
  | 'NEWS'
  | 'STATISTICS'
  | 'TEAM_NOTES'
  | 'ORDERS'

export interface ResearchDeskPublicView {
  phaseId: string | null
  phaseType: string | null
  availablePanels: ResearchDeskPanelId[]
  companies: CompanyPublicView[]
  informationItems: InformationPublicView[]
  economicIndicators: EconomicIndicatorPublicView[]
  updatedAtMillis: number
}
```

`informationItems` と `economicIndicators` は projection 作成時点で `publishedAtMillis <= nowMillis` のものだけを含める。未来に公開予定の項目は body を空にして先送りするのではなく、項目自体を projection に含めない。これにより DevTools や RTDB の直接参照でも先読みできない。

企業情報も、現在フェーズで企業パネルが利用不可なら配列自体を空にする。画面非表示だけに依存しない。

## フェーズ別表示

サーバーが `availablePanels` を決定する。生徒クライアントは独自にフェーズ→権限表を再実装せず、この capability を描画に使う。

| Phase type | 利用可能パネル |
|---|---|
| INTRO | なし |
| INFORMATION | COMPANIES, NEWS, STATISTICS |
| PREDICTION | COMPANIES, NEWS, STATISTICS, TEAM_NOTES |
| DISCUSSION | COMPANIES, NEWS, STATISTICS, TEAM_NOTES |
| MARKET | COMPANIES, NEWS, STATISTICS, TEAM_NOTES, ORDERS |
| DECISION | COMPANIES, NEWS, STATISTICS, TEAM_NOTES |
| RESULT | COMPANIES, NEWS, STATISTICS, TEAM_NOTES |
| REFLECTION | COMPANIES, NEWS, STATISTICS, TEAM_NOTES |
| CUSTOM | なし |

`CUSTOM` では市場操作を暗黙に有効化しない。将来 custom phase に Research Desk capability を持たせる場合は別の明示設定を追加する。

## Projection の更新タイミング

`functions/src/market/researchDeskProjection.ts` を新設し、Research Desk が所有する RTDB フィールドだけを `update()` する。

更新は最低限次の2経路から行う。

- `transitionPhase` の Firestore commit 後
- `processBatch` の settlement commit 後

これによりフェーズ切替直後、最初の約定前でも企業・ニュース・統計が出る。MARKET 中は既存の数秒単位 batch 更新に合わせて `publishedAtMillis` の公開境界も更新される。

Research Desk publisher は `lessonRunPublic` 全体へ `.set()` しない。Phase B の `publicTask` 等や市場側 `stocks` 等の sibling field を消さないため、Research Desk 所有キーだけを `update()` する。

## チームノート

チームノートは全クラス公開ではなく team-scoped data とする。

Firestore system of record:

```text
lessonRuns/{lessonRunId}/teamNotes/{teamId}
```

RTDB mirror:

```text
lessonRunTeamState/{lessonRunId}/{teamId}/researchNote
```

保存は Callable 経由のみ。caller の participantId をリクエストから信用せず、既存 response/order Callable と同様 `participantsByAuthUid/{authUid}` から server-side で解決し、`teams/{teamId}.memberParticipantIds` に含まれることを検証する。

ノートは1チーム1文書とし、`text`、`revision`、`updatedAt` を持つ。`expectedRevision` を使う optimistic concurrency と `idempotencyKey` を使う。同じキー・同じ payload は再送成功、同じキー・異なる payload は `failed-precondition` とする。

ノート本文は `lessonRunPublic` や他チームの RTDB node には絶対に複製しない。

## 注文画面

注文エンジンを新設しない。既存 `submitOrderCallable`、`lessonRunTeamState` の `cash` / `holdings` / `lockedBuyValue` / `lockedSellQuantity` / `myOrders`、`lessonRunPublic.stocks` を UI に結線する。

ただし UI のパネル非表示だけでは注文制御にならないため、`submitOrderCallable` 側も現在の `LessonRun.currentPhaseId` から phase type を確認し、`MARKET` 以外では新規注文を拒否する。`status === RUNNING`、`marketPaused !== true` の既存条件も維持する。

現行 Callable は client input として `batchId` と `referencePrice` を受け取るが、Research Desk 実装時にこの2値を client-trusted input から外す。

```ts
export interface SubmitOrderInput {
  lessonRunId: string
  teamId: string
  stockId: string
  side: 'BUY' | 'SELL'
  quantity: number
  idempotencyKey: string
}
```

server は認証・team membership 検証後、`lessonRuns/{lessonRunId}.nextBatchId` を注文の `batchId` として解決し、`lessonRuns/{lessonRunId}/stocks/{stockId}.currentPrice` を `referencePrice` として解決する。`nextBatchId` がない場合、MARKET phase でない場合、または stock が存在しない場合は注文を作成しない。

これにより Research Desk のためだけに internal batch ID を student-readable RTDB へ追加せず、client が stale/future batch ID や偽の低価格を送って soft lock を弱める経路も作らない。

注文入力の identity/team scope は既存どおり server-side で再検証する。

## Student route

`src/App.tsx` の `StudentLessonRoute` は既存 `lessonRunMembership` guard を維持したまま、アクセス許可後に次を購読する。

- `lessonRunPublic/{lessonRunId}`
- `lessonRunTeamState/{lessonRunId}/{teamId}`

`/lessons/:runId/play` は `DeferredDataNotice` ではなく Research Desk workspace を表示する。waiting/results の全面改修はこのスコープに含めない。

## エラー・再接続

- RTDB public/team subscription の一方が未取得でも、取得済み部分は描画し、操作系パネルは必要な state が揃うまで disabled にする。
- team note の revision conflict は入力を破棄せず「他のメンバーが更新しました」と表示して server 最新値を再取得する。
- order submission 中は同一送信を disabled にし、同じ論理送信の retry では同じ idempotency key を再利用する。
- `marketPaused` または MARKET 以外では注文 UI を disabled にするが、server rejection を最終境界とする。

## セキュリティ不変条件

1. `market-authoring-content` の `impactSensitivities`、`InformationImpact`、内部係数、seed、未来価格を student projection に含めない。
2. future `InformationItem` / `EconomicIndicator` は object 自体を student-readable RTDB に置かない。
3. 他チームの note / cash / holdings / orders を student に渡さない。
4. team identity を client input だけで信用しない。
5. MARKET 以外から Callable を直接叩いても新規注文できない。
6. `batchId` と `referencePrice` を client input として信用しない。
7. Research Desk publisher は RTDB sibling fields を上書きしない。
8. client-side visibility は UX であり認可境界ではない。

## 今回扱わないもの

- 学生画面全体のビジュアル全面刷新
- サイネージ埋め込み化
- 情報照会端末の復活
- 緊急暴落/急騰 UI
- 新しいニュース authoring UI
- 外部ニュース API 連携
- CUSTOM phase の capability authoring
- チームノートのコメント履歴・スレッド化
