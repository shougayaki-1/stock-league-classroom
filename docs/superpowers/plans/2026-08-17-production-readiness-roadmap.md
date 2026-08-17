# 本番展開レディネス ロードマップ

**位置づけ:** これは実行可能な単一の実装計画ではなく、[docs/production-readiness-checklist.md](../../production-readiness-checklist.md) で検証した課題を、独立してリリース可能な単位（フェーズ）に分割した俯瞰図。各フェーズは着手時に `superpowers:writing-plans` で個別の詳細実装計画（タスク単位・TDD・完全なコード付き）に展開する。

## フェーズ分割の考え方

`writing-plans` スキルのScope Checkに従い、フロントエンド配線・バックエンド新規実装・インフラ/CI・法務文書という性質の異なるサブシステムを1つの計画にまとめない。また各フェーズ内でも「独立してテスト可能な最小単位」でさらに分割する（例: Phase 1 は 1a, 1b, 1c... に分かれる）。

## Phase 1 — 教師導線基盤（完了）

**ゴール:** 教師が実際に「教材を選ぶ→授業を開始する→Control Roomに入る」を1つの導線として完走できるようにする。バックエンド（`createLessonRunCallable`）は既に完成しているため、このフェーズはフロントエンド配線のみ。

- Phase 1a: `/teacher` ホームルート新設 + 既存の壊れた `navigate('/teacher')`（[src/App.tsx:823](../../../src/App.tsx:823)）の修正（完了）
- Phase 1b: 教材編集画面から `createLessonRun` を呼ぶ「授業を開始」導線（`StartLessonDialog`）（完了）

→ 詳細計画: [2026-08-17-phase1-teacher-lesson-start.md](2026-08-17-phase1-teacher-lesson-start.md)

## Phase 2 — 生徒導線: 参加者情報の伝搬 + 待機画面（完了）

**ゴール:** 生徒が参加コードで参加した後の `/lessons/:runId/waiting` を、`LessonWaitingPage` に接続。授業タイトル・自チーム名・自分の表示名を実データで表示し、教師が授業を開始（`status` が `RUNNING`）した瞬間に自動的に `/lessons/:runId/play` へ遷移させる。（完了）

- Phase 2a: Join結果（`displayName`）を `location.state` で `/waiting` へ伝搬、`participantId` も membership mirror から取得可能に拡張（完了）
- Phase 2b: バックエンドの `LessonRunPublicState` に `title`/`teams` を投影し、フロントエンド型を同期（完了）
- Phase 2c: `StudentWaitingRoute` を新設して `LessonWaitingPage` に接続、`status === 'RUNNING'` での自動遷移を実装（完了）

> **Phase 2完了時点の既知の制約（次フェーズへの引き継ぎ）:**
> - `displayName` はページリロード/再接続で失われる（`location.state` 頼み）。恒久対応にはサーバー側での永続化とRTDB投影が必要 — Phase 18の「再接続UX」で扱う
> - `teamMemberNames`（自チームメンバー名一覧）と `recoveryCode`（復帰コード自己確認）はまだ生徒が読める経路が無く、`LessonWaitingPage` には渡していない

→ 詳細計画: [2026-08-17-phase2-student-waiting.md](2026-08-17-phase2-student-waiting.md)

## Phase 3 — 市場モードの授業中画面（play）（完了）

**ゴール:** `/lessons/:runId/play` を、市場モード（家庭科モード以外）の生徒に対しても `DeferredDataNotice` から実際の取引画面へ接続。既存の `OrderScreen`/`CompanyResearchPage`/`NewsListPage` をタブ切り替えで表示し、`status` が `REFLECTION`/`COMPLETED` に進んだら自動的に `/lessons/:runId/results` へ遷移する。（完了）

- Phase 3a: `MarketPlayScreen` プレゼンテーション部品を新設し、`availablePanels` でタブ（取引/企業情報/ニュース）をゲート（完了）
- Phase 3b: `StudentPlayRoute` を市場データ（RTDB `lessonRunTeamState` / `lessonRunPublic`）および `submitOrder` に接続、`REFLECTION`/`COMPLETED` への自動遷移を実装（完了）

→ 詳細計画: [2026-08-17-phase3-market-play.md](2026-08-17-phase3-market-play.md)

## Phase 4 — 結果表示（完了）

**ゴール:** 教師が Control Room から「結果を生成する」を実行できるようにし、生徒が `/lessons/:runId/results` で自分自身（または自チーム）の結果を閲覧できるようにする。（完了）

- Phase 4a（バックエンド）: `GENERATE_RESULTS` 操作権限の追加、教師用 `generateLessonResultCallable`、生徒用 `getMyLessonResultCallable`（アイデンティティフィルタリング済み）を実装（完了）
- Phase 4b（フロントエンド）: クライアントラッパー作成、`LessonControlRoom` に「結果を生成する」ボタンを配線、`/lessons/:runId/results` を `StudentResultsRoute` 経由で `LessonResultsPage` に実データ接続（完了）

→ 詳細計画: [2026-08-17-phase4-results.md](2026-08-17-phase4-results.md)

## Phase 5 — 教師分析画面（完了）

**ゴール:** `TeacherAnalyticsRoute` の `DeferredDataNotice` を外し、教師が過去/開催中の授業分析を `LessonAnalyticsPage` で閲覧できるようにする。（完了）

- Phase 5a（バックエンド）: `buildLessonAnalytics` にFirestoreの `events`/`responses`/`surveys` を実際にクエリして渡す `getLessonAnalyticsCallable` を新設。教師権限チェックを追加（完了）
- Phase 5b（フロントエンド）: クライアントラッパー新設 + `TeacherAnalyticsRoute` を `LessonAnalyticsPage` に接続（`LessonAnalyticsAggregateView` と `LessonAnalytics` の型差分を吸収する変換層 `adaptAnalyticsForView` を実装）（完了）

→ 詳細計画: [2026-08-17-phase5-teacher-analytics.md](2026-08-17-phase5-teacher-analytics.md)

## Phase 6 — Control Roomからの開始/進行操作（完了）

**ゴール:** 教師が Control Room から「授業を開始」「次のフェーズへ進む」を実際に実行できるようにする。（完了）

- Phase 6a（バックエンド）: 教材作成UIが `phases` を生成しない制約への暫定措置として、LessonRun作成時に教材の `subject` から固定4フェーズ（`TEACHER_CONTROLLED`）のグラフを自動生成して `templateSnapshot` に保存する `buildDefaultPhases` を実装（完了）
- Phase 6b（フロントエンド）: `LessonControlRoom` の `onAdvancePhase` に `currentPhaseId` を渡すよう拡張し、`TeacherControlRoute` に `onStartLesson`/`onAdvancePhase` を接続（完了）

> **Phase 6完了時点の既知の制約（次フェーズへの引き継ぎ）:**
> - フェーズグラフは教材作成UIで編集されたものではなく、LessonRun作成時に自動生成される固定4フェーズ（社会科: intro → market → result → reflection、家庭科: intro → decision → result → reflection）の暫定実装。将来教材作成UIにフェーズエディタが追加されたら置き換える想定。

→ 詳細計画: [2026-08-17-phase6-lesson-start-advance.md](2026-08-17-phase6-lesson-start-advance.md)

## Phase 7 — インフラ/CD

- `deploy.yml` に `functions`, `storage` を追加
- ビルド時のFirebase設定用環境変数（API key等7項目）をワークフローに追加
- `VITE_FEATURE_LESSON_PLATFORM_V2`, `VITE_SENTRY_DSN` をワークフローに追加
- GitHub `production` Environment・`FIREBASE_SERVICE_ACCOUNT` の設定（リポジトリ外の作業、ユーザー確認必須）
- App Check enforcement（`enforceAppCheck: true`）を主要callableに追加するかどうかの判断

## Phase 8 — 公開文書の整合

- LP/About/Privacy/Terms/Guide をPhase 1-6の実装状況に合わせて改訂
- 料金表示とStripe実装の整合（現在「無償」表記と矛盾）
- AI機能: プロバイダを実装するか、UIごとβ非表示にするかの意思決定

## 進め方

ユーザーの希望どおり「フェーズごとに切り出して実装」を行う。各フェーズ着手時に:
1. 対象フェーズの詳細実装計画を `writing-plans` で作成（今回のPhase 1のように、実ファイル調査済みの正確なコードで）
2. `subagent-driven-development` または `executing-plans` で実行
3. フェーズ完了後、次フェーズの計画に進む

依存関係の注意: Phase 3〜6はそれぞれ独立にPhase 1完了後に着手可能（Phase 1のCreate-Lesson導線がないとテスト用のrunIdを手に入れる手段がないため、実質的にPhase 1が前提）。Phase 7/8はコード変更を伴わない/薄いため、他フェーズと並行して進められる。
