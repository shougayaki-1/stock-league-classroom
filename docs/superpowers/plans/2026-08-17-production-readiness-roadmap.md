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

## Phase 7 — インフラ/CD（一部完了・一部方針変更）

**方針転換:** プライベートリポジトリでGitHub Actionsの実行分数がコストに直結する懸念から、「Actionsを自動発火させない」方針に転換した。当初想定していた「`deploy.yml`をActions経由の本番デプロイパイプラインとして整備する」路線は取らず、ローカルデプロイを正式な運用として維持する。

- [x] `.github/workflows/ci.yml` の自動発火（push/pull_request）を停止し `workflow_dispatch`（手動）のみに変更。代わりに `npm run verify` をpush前にローカル実行する運用をREADMEに明記（完了）
- [x] `.env.example` に `VITE_FEATURE_LESSON_PLATFORM_V2=false` を追加（`VITE_SENTRY_DSN` は元から存在）（完了）
- [x] Blazeプラン — ユーザー確認済み、設定済み（完了）
- [ ] `deploy.yml` に `functions`/`storage` を追加、GitHub `production` Environment・`FIREBASE_SERVICE_ACCOUNT` の設定 — **意図的にスキップ**。ファイルは残すが手を入れず、ローカルデプロイ（README記載の `firebase deploy` 手順）を正式な運用として継続する
- [ ] App Check enforcement（`enforceAppCheck: true`）— **意図的に見送り**。Firebase ConsoleのApp Checkメトリクスで正規リクエストの状況を確認してから判断すべき項目で、今回のスコープ外とした。Cloud Functions側（callableへの `enforceAppCheck: true` 追加）は判断確定後にコード変更として対応可能
- [ ] 予算アラート — 未確認（Blaze自体は設定済みだが、アラート設定の有無は別途要確認）

## Phase 8 — 公開文書の整合（完了）

**方針:** 授業機能をベータ公開として案内する。料金は構造（個人無償/学校有償）のみ公開し、実際の金額は問い合わせ窓口に誘導する（金額はまだ未確定のため）。AI機能は「準備中」と明記する。

- [x] About/Terms/Privacy/Guide/Contact を、Phase 1-6で実際に動く機能（教材作成→授業開始→生徒参加→売買/家計シミュレーション→結果→分析）を前提にベータ公開として全面改訂（完了）
- [x] Privacy: 実際に取得しているデータ（匿名UID・表示名・チーム・回答・アンケート・監査ログ・Stripe課金データ）と、学校ごとに設定可能な30日〜10年の保存期間を明記（完了）
- [x] 料金: 個人無償/学校有償の構造を公開し、金額は問い合わせ窓口へ誘導（完了）
- [x] AI機能: 「準備中」と明記（完了）
- [x] ランディングページ: 「準備中」表現をベータ公開表現に更新、教師ログイン・生徒参加の実導線をCTAに追加（完了）

> **Phase 8着手中に発覚し、あわせて修正した欠落（本来Phase 1の範囲）:**
> `signInTeacherWithGoogle()`（教師のGoogleログイン開始関数）が実装済みなのにアプリのどこからも呼ばれておらず、未ログインで `/teacher` にアクセスすると `/about` へリダイレクトされるだけでログインを開始する手段が存在しなかった。ランディングページにログインCTAを追加し、`AppRoutes` に `getTeacherGoogleRedirectResult` によるリダイレクト完了後の `/teacher` への自動遷移を実装して解消した（完了）。

→ 関連コミット: `content: rewrite public docs for beta lesson-platform launch`, `feat: wire the teacher Google login entry point that was never triggered anywhere`

## 進め方

ユーザーの希望どおり「フェーズごとに切り出して実装」を行う。各フェーズ着手時に:
1. 対象フェーズの詳細実装計画を `writing-plans` で作成（今回のPhase 1のように、実ファイル調査済みの正確なコードで）
2. `subagent-driven-development` または `executing-plans` で実行
3. フェーズ完了後、次フェーズの計画に進む

依存関係の注意: Phase 3〜6はそれぞれ独立にPhase 1完了後に着手可能（Phase 1のCreate-Lesson導線がないとテスト用のrunIdを手に入れる手段がないため、実質的にPhase 1が前提）。Phase 7/8はコード変更を伴わない/薄いため、他フェーズと並行して進められる。
