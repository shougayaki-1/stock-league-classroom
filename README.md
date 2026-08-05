# Stock League Classroom

教室向けの授業シミュレーターを開発するリポジトリです。現在は Phase A（安全化と新基盤）の段階であり、公開ページのみを提供しています。旧実装の運用機能は廃止済みです。

正本の要件と実装順は、[統合仕様書](docs/superpowers/specs/2026-08-05-integrated-platform-spec.md) を参照してください。Phase Aの作業計画は [Phase A実装計画](docs/superpowers/plans/2026-08-05-phase-a-foundation-plan.md)、以降の共通授業基盤は [Phase B実装計画](docs/superpowers/plans/2026-08-05-phase-b-common-lesson-platform-plan.md) に記載しています。

## 現在の提供範囲

- 公開ページ: サービス概要、操作方針、利用規約、プライバシーポリシー、お問い合わせ
- 開発基盤: React/Vite、Firebase Hosting、Firestore/Realtime Database Rules、テスト環境
- 準備中: 授業教材、授業実施、参加、教室表示、売買・結果。これらは教師ブラウザではなくサーバーが権威を持つ設計で段階的に提供します。

## ローカル開発

1. Node.js 22、Java 21、Firebase CLIを用意します。
2. `.env.example` を `.env.local` にコピーし、Firebase Web Appの値を設定します。
3. `VITE_USE_EMULATORS=true` にして `firebase emulators:start` を起動します。
4. 別ターミナルで `npm ci && npm run dev` を実行します。

通常テストは `npm test`、Firestore/RTDB Rulesテストは `npm run test:rules`、全検証は `npm run verify` です。

## Firebase本番設定

- [x] AuthenticationでGoogleと匿名プロバイダを有効化し、Hostingの公開ドメインを承認済みドメインへ追加
- [x] reCAPTCHA Enterpriseのスコアベース・ドメイン限定Webキーを作成し、App Checkへ登録
- [x] `VITE_FIREBASE_APP_CHECK_SITE_KEY`を本番ビルドへ設定（`.env.local`、GitHub Actions repository variable）
- [x] Google Cloud ConsoleでFirebase Web APIキーに本番ドメインのHTTPリファラ制限を設定
- [x] `.firebaserc` の対象が意図した本番プロジェクト（`oss-stock-league`）であることを確認
- [ ] App Checkメトリクスで正規リクエストを確認後、将来利用するAuthentication、Firestore、Realtime Databaseのenforcementを有効化

`VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN` はローカル専用です。本番ビルドに設定すると起動時に失敗します。

## デプロイ

`firebase deploy` を実行します。Hostingのpredeployが`npm run build`を実行し、SPA rewriteによって公開ページの直接リロードにも対応します。

`.github/workflows/deploy.yml`によるCI経由のデプロイは、`FIREBASE_SERVICE_ACCOUNT`シークレットと`production` Environmentが未設定のため、現時点では実行できません。当面はローカルからの`firebase deploy`を使ってください。

### 配信中のバージョンを確認する

ビルドにはコミットSHAが埋め込まれます。ログイン不要で確認できます。

```bash
curl -s https://oss-stock-league.web.app/ | grep '<meta name="version"'
```

## エラー監視

`VITE_SENTRY_DSN` を設定するとSentryへ技術的なエラー情報を送信します。未設定時とエミュレータ利用時は何も送信しません。個人を識別しうる情報を送らない方針は [プライバシーポリシー](src/components/PublicDocs.tsx) と合わせて更新してください。
