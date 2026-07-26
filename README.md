# Stock League Classroom

授業用のリアルタイム株式市場シミュレーターです。教師が市場テンプレートを作成し、生徒は匿名認証でチーム共有口座へ参加します。

## ローカル開発

1. Node.js 22、Java 21、Firebase CLIを用意します。
2. `.env.example` を `.env.local` にコピーし、Firebase Web Appの値を設定します。
3. `VITE_USE_EMULATORS=true` にして `firebase emulators:start` を起動します。
4. 別ターミナルで `npm ci && npm run dev` を実行します。

通常テストは `npm test`、Firestore/RTDBルールテストは `npm run test:rules`、全検証は `npm run verify` です。

## Firebase本番設定

- AuthenticationでGoogleと匿名プロバイダを有効化し、Hostingの公開ドメインを承認済みドメインへ追加します。
- reCAPTCHA EnterpriseのWebキーをApp Checkへ登録し、`VITE_FIREBASE_APP_CHECK_SITE_KEY`を本番ビルドへ設定します。
- App Checkメトリクスで正規リクエストを確認後、Authentication、Firestore、Realtime Databaseのenforcementを有効化します。
- Google Cloud ConsoleでFirebase Web APIキーに本番ドメインのHTTPリファラ制限を設定します。
- `.firebaserc` の対象が意図した本番プロジェクトであることを確認します。

`VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN` はローカル専用です。本番ビルドに設定すると起動時に失敗します。

## デプロイ

`firebase deploy` を実行します。Hostingのpredeployが`npm run build`を実行し、SPA rewriteによって各画面の直接リロードにも対応します。

公開前に、教師ログイン、テンプレート作成、市場作成、生徒参加、承認、複数端末での売買、順位更新、signage、終了結果、削除を実端末で確認してください。
