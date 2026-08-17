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

## Phase 3 — 市場モードの授業中画面（play）

家庭科モード（`HouseholdTeamScreen`）は既に動作している。市場モードは `StudentPlayRoute` が `DeferredDataNotice` に落ちたままなので、それを実データに接続する。

- Phase 3a: `subscribePublicRun`（`researchDesk.companies`/`informationItems`）+ `subscribeOwnTeamState<LessonRunTeamState>` を束ねる `MarketPlayRoute` コンテナを新設し、`OrderScreen`/`NewsListPage`/`CompanyResearchPage` をタブ切り替えで表示
- Phase 3b: Phase 2b の自動遷移フックを拡張し、`status` が `REFLECTION`/`COMPLETED` になったら `/lessons/:runId/results` へ自動遷移

## Phase 4 — 結果表示（バックエンド新規実装が必要）

**重要な発見:** `LessonResult` はFirestore `lessonRuns/{runId}/results/{resultId}` に保存されるが、`firestore.rules` で生徒の読み取りは明示的に禁止されている（教師のみ `get`/`list` 可）。生徒が自分の結果を読むための経路が**存在しない**。これはフロントエンド配線ではなく、バックエンドの新規設計が要る。

- Phase 4a（バックエンド）: 生徒が自分の結果だけを取得できる新しい Callable（例: `getMyLessonResultCallable`）を設計・実装。既存の `buildAndPersistLessonResult` パイプラインの出力を、呼び出し元の `participantId`/`teamId` でフィルタして返す
- Phase 4b（フロントエンド）: 上記Callableのクライアントラッパーを作成し、`StudentLessonRoute`（results用）を `LessonResultsPage` に接続

## Phase 5 — 教師分析画面（バックエンド新規実装が必要）

**重要な発見:** `functions/src/lessonRuns/analytics/buildAnalytics.ts` は純粋関数として存在するが、`onCall` でラップされておらず `functions/src/index.ts` からもexportされていない。クライアントラッパーも存在しない。`TeacherAnalyticsRoute` の `DeferredDataNotice` を外すには、Callable自体を新規実装する必要がある。

- Phase 5a（バックエンド）: `buildLessonAnalytics` にFirestoreの `events`/`responses`/`surveys` を実際にクエリして渡す `onCall` を新設。教師権限チェックを追加
- Phase 5b（フロントエンド）: クライアントラッパー新設 + `TeacherAnalyticsRoute` を `LessonAnalyticsPage` に接続（`LessonAnalyticsAggregateView` と `LessonAnalytics` の型差分を吸収する変換層が必要）

## Phase 6 — Control Roomからの開始/進行操作

**重要な発見:** `LessonControlRoom` は表示専用に近く、`TeacherControlRoute` は `onStartLesson`/`onAdvancePhase` を一切渡していない。介入・終了系Callableは配線済みだが、フェーズ進行の主導線が欠けている。

- Phase 6a: フェーズグラフ（どのフェーズからどのフェーズへ遷移できるか）を教材の `LessonContent` から解決するロジックを設計
- Phase 6b: `TeacherControlRoute` に `onStartLesson`/`onAdvancePhase` を配線

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
