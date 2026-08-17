# 本番展開レディネス チェックリスト（検証済み）

`codex/classroom` ブランチについて他AIから持ち込まれた分析を、実コードで裏取りした上で整理したもの。
検証日: 2026-08-17。検証方法: `grep`/`Read` による該当ファイルの直接確認。

## 検証結果サマリ

指摘されたP0項目のうち、コードで直接確認できるものは**すべて事実と一致**した。
誇張や事実誤認は見つからなかった（今回サンプル検証した範囲では）。P1/P2の一部（運用体制・監視・QA計画など）はコードでは検証不能な「まだ決めていないこと」なので、指摘の妥当性は認めるが「事実確認」の対象外。

## P0（検証済み・事実確認OK）

### 1. 生徒/教師の主要導線が未結線
[src/App.tsx:1293-1297](src/App.tsx:1293) で `/lessons/:runId/waiting`, `/results`, `/teacher/lessons/:runId/analytics` は
`StudentLessonRoute` / `TeacherAnalyticsRoute` 経由で **`DeferredDataNotice`**（[src/App.tsx:232](src/App.tsx:232)）を返すのみ。実画面には未結線。

`/lessons/:runId/play`（[src/App.tsx:1220-1244](src/App.tsx:1220)）は家庭科モード（`household`/`households` フィールド検出）のときだけ `HouseholdTeamScreen` を描画し、市場モードは同じく `DeferredDataNotice` に落ちる。コード自身のコメントにも「Task 13で市場側は別タスク」の旨が明記されている。

→ **確認: 事実**

### 2. `/teacher` ホームルートが存在しない
`AppRoutes` 内に `/teacher` という完全一致のルートは無い（`/teacher/templates`, `/teacher/organizations/...` 等の深いパスのみ）。
一方 [src/App.tsx:823](src/App.tsx:823) で `purgeSchoolOrg` 成功後に `navigate('/teacher')` を呼んでおり、**実際に壊れたナビゲーション**になっている。

→ **確認: 事実。具体的なbroken navigationあり**

### 3. `createLessonRun` クライアントラッパーがUIから未使用
[src/lib/lessonRuns/createLessonRun.ts:20](src/lib/lessonRuns/createLessonRun.ts:20) に定義はあるが、`src/App.tsx` を含むアプリ側コードから import/呼び出しされている箇所がゼロ（テストファイル以外でヒットなし）。

→ **確認: 事実**

### 4. Feature Flagが本番デフォルトOFF、`.env.example`に未記載
[src/lib/features/lessonPlatformV2.ts:13](src/lib/features/lessonPlatformV2.ts:13) で `VITE_FEATURE_LESSON_PLATFORM_V2 === 'true'` のみ有効。
`.env.example` を確認したが `VITE_FEATURE_LESSON_PLATFORM_V2` の記載なし。

→ **確認: 事実**

### 5. `deploy.yml` が Functions / Storage Rules をデプロイしていない
[.github/workflows/deploy.yml:56](.github/workflows/deploy.yml:56):
```
npx firebase-tools deploy --only hosting,firestore:rules,database --project oss-stock-league --non-interactive
```
`functions` と `storage` が対象外。Functions側は `createLessonRunCallable` 等、市場処理を含む多数の処理を担っており、これらが本番に反映されない構成。

→ **確認: 事実**

### 6. ビルド時のFirebase環境変数が不足
同ワークフローのbuildステップで渡している変数は `VITE_COMMIT_SHA` と `VITE_FIREBASE_APP_CHECK_SITE_KEY` のみ。`VITE_FEATURE_LESSON_PLATFORM_V2` や `VITE_SENTRY_DSN` も渡っていない。

→ **確認: 事実**

### 7. GitHub Actions経由の本番デプロイが未設定
[README.md:37](README.md:37):
> `FIREBASE_SERVICE_ACCOUNT`シークレットと`production` Environmentが未設定のため、現時点では実行できません。当面はローカルからの`firebase deploy`を使ってください。

README自身がこの制約を明記。ワークフローのコードは`secrets.FIREBASE_SERVICE_ACCOUNT`と`environment: production`を前提にしているが、実際にGitHub側で設定されているかはコードから検証不能（外部設定）。README記載を信頼する限り未設定。

→ **確認: 事実（README記載どおり）**

### 8. AIプロバイダが未設定
[functions/src/ai/llmProvider.ts:1-3](functions/src/ai/llmProvider.ts:1):
```ts
/** Provider-independent contract. A concrete provider is intentionally not selected in v1. */
export const unconfiguredLlmProvider: LlmProvider = { generateText: () => Promise.reject(new Error('AI provider is not configured.')) }
```
呼ぶと必ず reject する実装。`generateLessonDraftCallable`/`generateTeacherGuidanceCallable`（[functions/src/ai/onCall.ts:55,82](functions/src/ai/onCall.ts:55)）はこれを使用。

→ **確認: 事実**

### 9. LP/Privacy/Terms が実装（Stripe課金等）と矛盾
[src/components/PublicDocs.tsx:40](src/components/PublicDocs.tsx:40):
> 本サービスは無償で提供しています。料金の請求や支払い情報の入力を求めることはありません。

[src/components/PublicDocs.tsx:75](src/components/PublicDocs.tsx:75):
> 現在は、生徒の授業データを取得していません。

一方 `src/App.tsx:1147,1154` に `createStripeCheckoutSession` / `createStripeCustomerPortalSession` の実装があり、学校プラン課金・Customer Portal連携が既に存在する。公開文書と実装が完全に矛盾している。

→ **確認: 事実**

### 10. App Checkがcallable関数で未強制
`functions/src` 内の `onCall(...)` 呼び出し20箇所を検索したが、`enforceAppCheck` の指定は **0件**。クライアント側App Check初期化はあるが、サーバー側で強制していない。

→ **確認: 事実**

## 検証しなかった/検証不能な項目

以下は運用体制・組織判断・未実施のQA計画など、コードの有無では判定できない項目。指摘自体は合理的だが「事実確認」の対象外として区別する:

- 課金・予算承認状況（`PENDING_EXTERNAL_APPROVAL`）— GCP/Firebaseコンソール側の状態で、リポジトリ外
- 負荷試験・E2E・Chromebook/iPad実機QAの実施有無 — 「まだやっていない」という指摘で、これも妥当（Playwright/Cypress系パッケージがpackage.jsonに無いことは確認可能だが今回は未実施）
- 監視・障害通知・バックアップ体制 — 運用ドキュメント/契約の話でコード外
- 用語統一・日時表示・アクセシビリティ等のP1/P2大半 — 定性的なUI品質判断でコード確認になじまない

## 結論

**指摘の中核（P0の技術的事実）は正確**。特に以下6点が最優先で着手対象:

1. 教師ログイン/ホーム導線の完成（`/teacher` ルート新設含む）
2. LessonRun作成〜生徒waiting/play/results/analytics の結線
3. `deploy.yml` に `functions`, `storage` を追加
4. Feature Flag運用方針の決定（`.env.example`更新含む）
5. LP/Privacy/Terms を実装（Stripe課金あり）に合わせて全面改訂、または課金機能側を非表示にして文書と一致させる
6. AI機能をβ非表示にするか、プロバイダを本実装するかの意思決定

次のアクションとして、上記6点のうちどれから着手するか決めていただければ、実装計画（`writing-plans`スキル）に進みます。
