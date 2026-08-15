# 組織内教材承認フロー 設計仕様

**日付:** 2026-08-15
**対象:** Phase 7(エンタープライズ管理者機能)サブプロジェクト3 — 組織内教材承認フロー
**正本:** `docs/superpowers/specs/2026-08-05-lesson-platform-roadmap-design.md` Phase 7節。矛盾する場合は正本を優先し、本仕様側の誤りとして扱う。

## 背景・位置づけ

調査の結果、組織内には「承認」の概念が一切存在しなかった。`lessonTemplates`の`visibility`は`PRIVATE`(同一組織内なら誰でも閲覧・利用可)/`COMMUNITY`(組織外にも公開)の2値のみで、Firestoreルール(`firestore.rules:95-134`)は`activeMember(orgId)`のみを条件にしており、`owner`/`admin`/`teacher`のロールを一切参照していない。`createLessonRun`(`functions/src/lessonRuns/createLessonRun.ts:82-83`)も`template.orgId`の一致と`currentPublishedVersionId`の存在のみをチェックしており、`status: 'READY'`になった時点で組織内の誰でも即座に授業実施へ使える。Phase 6の`templateReports`(通報・審査)は`isCallerOperator`(プラットフォーム全体のオペレーター権限)によるCOMMUNITY公開後の事後審査であり、本サブプロジェクトが対象とする「組織内・事前承認」とは主体も目的も異なる。

## スコープ判断(ユーザー承認済み)

- 承認がゲートするのは「作成者以外による授業実施(lessonRun作成)」のみ。既存の読み取り公開範囲(同一組織メンバーなら閲覧可)は変更しない。
- 承認者は組織の`owner`または`admin`(`requireActiveOrgMember`+`requireManager`パターン、`changeOrgMemberRoleCallable`等と同型)。
- 承認ステータスは`publishLessonVersion`(初回公開・再公開いずれも)のタイミングで自動的に`PENDING`になる。教師が明示的に「承認申請」する追加アクションは無い。
- 既にstatusが`READY`で`approvalStatus`フィールドを持たない既存テンプレートは、未設定を`APPROVED`相当として扱う(マイグレーション不要、既存の授業運用を止めない)。
- 既に`APPROVED`なテンプレートの作成者が内容を更新して再度publishした場合、`approvalStatus`は再び`PENDING`に戻る(内容が変わった以上、毎回再承認が必要という判断)。

## アーキテクチャ

### データモデル

`lessonTemplates`ドキュメントに以下を追加する。

```ts
approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' // 未設定はAPPROVED相当として扱う
reviewedByUid?: string
reviewedAt?: unknown
```

### `publishLessonVersion`の変更

`functions/src/lessonTemplates/publishLessonVersion.ts:80-84`の`tx.set(templatePath, { currentPublishedVersionId: versionId, status: 'READY', updatedAt: now, title: ..., description: ..., subject: ... }, { merge: true })`に`approvalStatus: 'PENDING'`を追加する。初回公開・再公開の区別はしない(`previousVersionId`の有無に関わらず常に`PENDING`にする)。

### Callable 1: `listPendingTemplateApprovalsCallable`

- 入力: `{ orgId: string }`
- 認可: `requireActiveOrgMember`で対象`orgId`のアクティブメンバーであることを確認し、`role`が`owner`または`admin`(ローカル`requireManager(membership, message)`ヘルパーを`functions/src/lessonTemplates/onCall.ts`内に複製する。`organizations/onCall.ts:150`と同型、モジュールを跨いだ共有はしない)。
- 処理: `lessonTemplates`を`orgId == 入力orgId`かつ`approvalStatus == 'PENDING'`で問い合わせ、一覧(`id`, `title`, `createdByUid`, `updatedAt`)を返す。

### Callable 2: `reviewTemplateApprovalCallable`

- 入力: `{ orgId: string; templateId: string; decision: 'APPROVED' | 'REJECTED' }`
- 認可: 上記と同じ(`owner`/`admin`)。
- 検証: `lessonTemplates/{templateId}`が存在し`orgId`が一致し`approvalStatus === 'PENDING'`であること。それ以外(`APPROVED`/`REJECTED`/未設定)は`failed-precondition`。
- 処理: `approvalStatus`を`decision`に更新し、`reviewedByUid`(呼び出し元uid)・`reviewedAt`(サーバータイムスタンプ)を記録。

### `createLessonRun`の変更

`functions/src/lessonRuns/createLessonRun.ts:80-83`の型キャストを拡張して`createdByUid`/`approvalStatus`を読み取れるようにし、既存の2つのチェックの直後に追加する。

```ts
const template = templateSnap.data() as { orgId: string; currentPublishedVersionId: string | null; createdByUid: string; approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' }
if (template.orgId !== deps.orgId) throw new Error('Template does not belong to this organization')
if (!template.currentPublishedVersionId) throw new Error('Template has no published version to snapshot')
if (template.createdByUid !== deps.primaryTeacherUid && (template.approvalStatus === 'PENDING' || template.approvalStatus === 'REJECTED')) {
  throw new Error('Template is not approved for use by other teachers')
}
```

作成者本人(`primaryTeacherUid === template.createdByUid`)は`approvalStatus`に関わらず常に実施可能。`functions/src/lessonRuns/onCall.ts:43-44`のエラー変換テーブルに`['Template is not approved for use by other teachers', 'failed-precondition']`を追加する。

### Firestore複合インデックス

```json
{ "collectionGroup": "lessonTemplates", "queryScope": "COLLECTION", "fields": [
  { "fieldPath": "orgId", "order": "ASCENDING" },
  { "fieldPath": "approvalStatus", "order": "ASCENDING" }
]}
```

### UI

- `SchoolOrgSettingsPage.tsx`に「承認待ちテンプレートを確認」リンクを追加。閲覧者が`owner`/`admin`のときのみ表示(既存の`viewerRole`導出ロジックを再利用)。
- 新規ルート`/teacher/organizations/:orgId/template-approvals`、新規ページ`TemplateApprovalsPage.tsx`(`UsageDashboardPage`と同型のCallable取得パターン)。一覧に「承認」「却下」ボタンを表示し、それぞれ`reviewTemplateApprovalCallable`を呼ぶ。
- テンプレート一覧・編集画面に`approvalStatus`のバッジ表示を追加(`PENDING`=「承認待ち」、`REJECTED`=「却下」、`APPROVED`または未設定=バッジ非表示)。作成者が自分のテンプレートの状態を把握できるようにする。

## エラー処理

- owner/admin以外による承認一覧取得・承認/却下操作: `permission-denied`。
- `PENDING`でないテンプレートへの`reviewTemplateApprovalCallable`呼び出し: `failed-precondition`。
- 未承認(`PENDING`/`REJECTED`)テンプレートを作成者以外が`createLessonRun`で使おうとした場合: `failed-precondition`。

## テスト方針

- `publishLessonVersion`: 初回公開・再公開のいずれでも`approvalStatus`が`PENDING`になることを検証。
- `listPendingTemplateApprovalsCallable`/`reviewTemplateApprovalCallable`: 非owner/admin拒否、`PENDING`以外への操作拒否、成功時の状態遷移と`reviewedByUid`/`reviewedAt`記録を検証。
- `createLessonRun`: (a)作成者本人は`approvalStatus`が`PENDING`/`REJECTED`でも実施できる、(b)他教師は`PENDING`/`REJECTED`で拒否される、(c)`APPROVED`は誰でも実施できる、(d)`approvalStatus`未設定(既存データ)は誰でも実施できる、の4パターンを検証。
- Firestoreルール(emulator): 既存の`update`許可フィールド一覧(`draft`/`updatedAt`のみ)に`approvalStatus`が含まれていない=クライアントから直接変更できないことを確認する回帰テスト。
- UI: 承認待ち一覧表示、承認/却下操作、owner/admin以外へのリンク非表示、テンプレート一覧でのバッジ表示。
