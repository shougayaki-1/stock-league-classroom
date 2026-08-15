# 通報と審査(運営者向け) 設計仕様

**日付:** 2026-08-15
**対象:** Phase 6(テンプレートマーケットプレイス)サブプロジェクト4 — 通報と審査(運営者向けの最低限の審査画面)
**正本:** `docs/superpowers/specs/2026-08-05-lesson-platform-roadmap-design.md` Phase 6節、`docs/superpowers/specs/2026-08-05-integrated-platform-spec.md` §17.6(削除)・§17.7(審査)。矛盾する場合は正本を優先し、本仕様側の誤りとして扱う。

## 背景・位置づけ

`firestore.rules`は`operator()`ヘルパー(`teacher() && request.auth.token.operator == true`、10行目)を既に持ち、`serviceStatus`の書き込み制御に使われているが、**この`operator`カスタムクレームを付与する仕組みがコードのどこにも存在しない**。運営者ロール自体がまだ実質的に機能していない状態からの実装となる。

## スコープ判断(ユーザー承認済み)

- 今回の審査機能は「通報確認」「非公開化」の2つに絞る。「公式認証の付与(VERIFIED)」「投稿者の利用停止」「審査履歴の高度な検索」は将来のサブプロジェクトとして別途扱う。
- `operator`クレームの付与用Callableを今回作る。ただし最初の1人目のoperatorはFirebaseコンソール/Admin SDKスクリプトでの手動付与が必要(鶏卵問題、回避不能なブートストラップ手順)。
- 通報理由は§17.7の10項目チェックリストをそのまま構造化せず、簡易enum(`PERSONAL_INFO`/`COPYRIGHT`/`INAPPROPRIATE`/`MISINFORMATION`/`OTHER`)+自由記述`details`に簡略化する。10項目は運営者が審査時に参照する基準として扱う(データ構造化しない)。

## アーキテクチャ

### データモデル

`templateReports/{reportId}`(トップレベルコレクション)

```ts
interface TemplateReportDoc {
  templateId: string
  versionId: string
  reportedByUid: string
  reason: 'PERSONAL_INFO' | 'COPYRIGHT' | 'INAPPROPRIATE' | 'MISINFORMATION' | 'OTHER'
  details: string | null
  status: 'PENDING' | 'RESOLVED'
  resolution: 'UNPUBLISHED' | 'DISMISSED' | null
  resolvedByUid: string | null
  resolvedAt: unknown | null
  createdAt: unknown
}
```

タイトル等は非正規化しない(`listPendingTemplateReportsCallable`がAdmin SDKで都度対象テンプレートを読み、権限バイパスの心配なく補完できるため)。

### Callable 1: `reportTemplateCallable`

- 入力: `{ templateId: string; versionId: string; reason: TemplateReportDoc['reason']; details?: string }`
- 認可: 署名済み教師(`isCallerTeacher`)であれば誰でも可。組織メンバーシップは問わない。
- 検証: 対象`lessonTemplates/{templateId}`が存在し`visibility === 'COMMUNITY'`であること(`not-found`。非公開教材の存在を通報経由で探れないようにする)。`createdByUid === request.auth.uid`の場合は`permission-denied`(自作教材は通報不可)。
- 処理: `templateReports`に`status: 'PENDING'`で新規作成。

### Callable 2: `listPendingTemplateReportsCallable`

- 入力: なし
- 認可: `operator`クレーム保持者のみ(`request.auth.token.operator === true`、`permission-denied`)。
- 処理: `templateReports`を`status == 'PENDING'`でクエリし、各`report`について対象`lessonTemplates/{templateId}`の`title`をAdmin SDKで読み取り補完して返す。

### Callable 3: `resolveTemplateReportCallable`

- 入力: `{ reportId: string; action: 'UNPUBLISH' | 'DISMISS' }`
- 認可: `operator`のみ。
- 検証: `templateReports/{reportId}`が存在し`status === 'PENDING'`であること(`not-found`)。
- 処理: `action === 'UNPUBLISH'`の場合、対象`lessonTemplates/{templateId}`を`{ visibility: 'PRIVATE' }`に更新(既存の`unpublishTemplateFromCommunityCallable`と同じ書き込みだが、作成者本人ではなく`operator`が主体)。いずれの場合も`templateReports/{reportId}`を`{ status: 'RESOLVED', resolution: action === 'UNPUBLISH' ? 'UNPUBLISHED' : 'DISMISSED', resolvedByUid: request.auth.uid, resolvedAt: FieldValue.serverTimestamp() }`に更新。

### Callable 4: `grantOperatorCallable`

- 入力: `{ targetUid: string }`
- 認可: `operator`のみ。
- 処理: `getAuth().setCustomUserClaims(targetUid, { operator: true })`(既存の`displaySession.ts`が`getAuth()`を同じ`firebase-admin/auth`から使っているパターンを踏襲)。

### UI

- `CommunityTemplatesPage`(既存、サブプロジェクト2)に「通報」ボタンを追加し、`reportTemplateCallable`を呼ぶ簡易フォーム(理由選択+任意の自由記述)を開く。
- 新規ルート`/operator/reports`: `listPendingTemplateReportsCallable`を呼び一覧表示。各行に「非公開化」「却下」ボタン(`resolveTemplateReportCallable`を呼ぶ)。事前の権限チェック画面は作らず、Callableが`permission-denied`を返した場合にアクセス拒否メッセージを表示する(`TemplateRouteGuard`のような事前フェッチ式ガードは今回は使わない、実装を簡素に保つ)。

### Firestoreルール

```
match /templateReports/{reportId} { allow read, write: if false; }
```

`aiUsageLog`・`templateShares`と同じ、すべてCallable経由の明示的拒否ルール。

## エラー処理

- 非公開教材への通報: `not-found`。
- 自作教材への通報: `permission-denied`。
- `operator`以外による審査系Callable呼び出し(`listPendingTemplateReportsCallable`/`resolveTemplateReportCallable`/`grantOperatorCallable`): `permission-denied`。
- 存在しない、または既に`RESOLVED`済みの通報への`resolveTemplateReportCallable`: `not-found`。

## テスト方針

- `reportTemplate.test.ts`: COMMUNITY教材への通報成功、非公開教材への通報は`not-found`、自作教材への通報は`permission-denied`。
- `listPendingTemplateReports.test.ts`: `operator`以外は`permission-denied`、`PENDING`のみ返しタイトルが補完されることを検証。
- `resolveTemplateReport.test.ts`: `operator`以外は`permission-denied`、`UNPUBLISH`で対象テンプレートの`visibility`が`PRIVATE`に戻ることと通報が`RESOLVED`になることを検証、`DISMISS`は`visibility`を変更しないことを検証、存在しない/解決済みの通報は`not-found`。
- `grantOperator.test.ts`: `operator`以外は`permission-denied`、`operator`本人は成功し`setCustomUserClaims`が正しい引数で呼ばれることを検証。
- Firestoreルール(emulator): `templateReports`への直接クライアント読み書き拒否。
- UI: `CommunityTemplatesPage`の通報ボタン操作、`/operator/reports`の一覧表示・非公開化/却下ボタン操作。
