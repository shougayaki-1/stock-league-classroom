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

### 配信中のバージョンを確認する

ビルドにはコミットSHAが埋め込まれます。ログイン不要で確認できます。

```bash
curl -s https://oss-stock-league.web.app/ | grep '<meta name="version"'
```

### 直前のバージョンへ戻す

Hostingのみを即座に戻せます。ルールは戻らないため、ルールを含む変更を戻す場合は該当コミットへ`git checkout`してから`firebase deploy`を実行してください。

```bash
firebase hosting:rollback --project oss-stock-league
```

## 緊急停止

新規の市場作成だけを止めます。**進行中の授業は止まりません。** 画面ではなくセキュリティルールで強制されるため、改変したクライアントからも回避できません。

Firebase Console → Firestore で `serviceStatus/global` を作成し、次のフィールドを設定します。

| フィールド | 型 | 値 |
| --- | --- | --- |
| `acceptingNewMarkets` | boolean | `false` で停止、`true` で再開 |
| `message` | string | 教師の画面に表示する理由 |

Realtime Database側も塞ぐ場合は、ルートに `serviceStatus/acceptingNewMarkets` を `false` で作成します。教師がRTDBへ直接書き込む経路まで塞ぐための二重化です。

ドキュメントが存在しない状態は「稼働中」として扱われます。ルールを先に配信してもサービスが止まることはありません。

## エラー監視

`VITE_SENTRY_DSN` を設定するとSentryへ送信されます。未設定時とエミュレータ利用時は何も送信しません。

生徒が未成年であるため、送信前に次を除去しています。プライバシーポリシーの記載と実装を一致させるためのもので、変更する場合は[プライバシーポリシー](src/components/PublicDocs.tsx)も併せて更新してください。

- ユーザー識別子、Cookie、ブレッドクラム、サーバー名
- エラー本文中の参加コードとメールアドレス
- セッションリプレイとトレーシング（いずれも無効）
