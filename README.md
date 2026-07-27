# Stock League Classroom

授業用のリアルタイム株式市場シミュレーターです。教師が市場テンプレートを作成し、生徒は匿名認証でチーム共有口座へ参加します。

## ローカル開発

1. Node.js 22、Java 21、Firebase CLIを用意します。
2. `.env.example` を `.env.local` にコピーし、Firebase Web Appの値を設定します。
3. `VITE_USE_EMULATORS=true` にして `firebase emulators:start` を起動します。
4. 別ターミナルで `npm ci && npm run dev` を実行します。

通常テストは `npm test`、Firestore/RTDBルールテストは `npm run test:rules`、全検証は `npm run verify` です。

## Firebase本番設定

- [x] AuthenticationでGoogleと匿名プロバイダを有効化し、Hostingの公開ドメインを承認済みドメインへ追加
- [x] reCAPTCHA Enterpriseのスコアベース・ドメイン限定Webキーを作成し、App Checkへ登録
- [x] `VITE_FIREBASE_APP_CHECK_SITE_KEY`を本番ビルドへ設定（`.env.local`、GitHub Actions repository variable）
- [x] Google Cloud ConsoleでFirebase Web APIキーに本番ドメインのHTTPリファラ制限を設定
- [x] `.firebaserc` の対象が意図した本番プロジェクト（`oss-stock-league`）であることを確認
- [ ] **App Checkメトリクスで正規リクエストを確認後、Authentication、Firestore、Realtime Databaseのenforcementを有効化**

`VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN` はローカル専用です。本番ビルドに設定すると起動時に失敗します。

### App Check enforcementを有効化する前に

現在、本番ビルドはApp Checkトークンを生成していますが、**バックエンド側のenforcementはまだ無効**です。理由は、設定ミスがあった場合にenforcementを先に有効化すると、正規の教師・生徒のリクエストが全て拒否されるためです。

Firebase Console → App Check → APIs で、Firestore・Realtime Database・Authenticationそれぞれについて「検証済み」と「不明」の比率を数日分観察し、検証済みが十分な割合になってから、各APIの「適用を開始」を押してください。不明なリクエストが多い場合は、リファラ制限やドメイン設定を先に見直してください。

## デプロイ

`firebase deploy` を実行します。Hostingのpredeployが`npm run build`を実行し、SPA rewriteによって各画面の直接リロードにも対応します。ビルド時に`VITE_FIREBASE_APP_CHECK_SITE_KEY`が`.env.local`から読み込まれます。

`.github/workflows/deploy.yml`によるCI経由のデプロイは、`FIREBASE_SERVICE_ACCOUNT`シークレットと`production` Environmentが未設定のため、現時点では実行できません。当面はローカルからの`firebase deploy`を使ってください。

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

## 同時利用の制約（Sparkプラン）

Realtime Databaseの無料プランは**同時接続100**が上限です。満席の1教室で83接続（生徒80＋教師の管理画面とホスト画面＋教室画面）を使うため、**実質的に同時開催できる教室は1つ**です。

現在、教師になれる人に制限はありません（メール確認済みのGoogleアカウントであれば誰でも市場を作れます）。第三者の教室と接続枠を共有する構成であることを理解したうえで運用してください。

上限に達したときの挙動:

- 生徒・ホストの画面は`.info/connected`を監視し、12秒以上つながらない場合に理由を表示します
- 売買済みの内容はサーバー側に保存されており、復帰後に続きから再開できます
- 進行中の授業を優先したい場合は、[緊急停止](#緊急停止)で新規の市場作成だけを止められます

同時接続数はFirebase Console → Realtime Database → 使用状況で確認できます。恒常的に複数教室を開催する必要が生じた場合は、Blazeプランへの移行が必要です（移行後の上限は20万接続）。
