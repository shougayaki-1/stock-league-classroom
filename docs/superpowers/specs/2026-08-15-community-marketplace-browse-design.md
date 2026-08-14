# マーケットプレイス検索・閲覧 設計仕様

**日付:** 2026-08-15
**対象:** Phase 6(テンプレートマーケットプレイス)サブプロジェクト2 — 組織を越えた公開・検索・複製のうち「検索・閲覧」
**正本:** `docs/superpowers/specs/2026-08-05-lesson-platform-roadmap-design.md` Phase 6節、`docs/superpowers/specs/2026-08-15-template-community-visibility-design.md`(サブプロジェクト1、`visibility: 'COMMUNITY'`の読み取り許可はここで実装済み)。矛盾する場合は正本を優先し、本仕様側の誤りとして扱う。

## 背景・位置づけ

サブプロジェクト1により、`visibility === 'COMMUNITY'`のテンプレートは組織外の教師でも`get`/`list`できるようになったが、それを実際に一覧・検索するクエリとUIはまだ存在しない。また、`lessonTemplates`ドキュメントには`title`/`description`/`subject`のような一覧表示に必要な情報が直接持たれておらず(`draft`または`versions/{id}.content`の中にのみ存在)、一覧取得のたびに版を個別取得するN+1問題が発生する。

## スコープ判断(ユーザー承認済み)

- 検索は科目(`SOCIAL_STUDIES`/`HOME_ECONOMICS`)フィルタ+公開日時の新着順ソートのみ。全文検索エンジン(Algolia等)は導入しない。
- 一覧表示用に`title`/`description`/`subject`を`lessonTemplates`ドキュメント直下へ非正規化保存する。
- ブラウジングUI(一覧画面+複製ボタン)も本サブプロジェクトに含める。

## アーキテクチャ

### データモデルの変更

**`publishLessonVersion.ts`(既存、`functions/src/lessonTemplates/publishLessonVersion.ts`)**

`tx.set(templatePath, { currentPublishedVersionId: versionId, status: 'READY', updatedAt: now }, { merge: true })`に、公開する`draft`(=`LessonContent`)から`title`/`description`/`subject`を複製して追加する。

```ts
tx.set(templatePath, {
  currentPublishedVersionId: versionId, status: 'READY', updatedAt: now,
  title: (templateSnap.data.draft as { title: string }).title,
  description: (templateSnap.data.draft as { description: string }).description,
  subject: (templateSnap.data.draft as { subject: string }).subject,
}, { merge: true })
```

**`publishTemplateToCommunityCallable`(既存、サブプロジェクト1で実装済み)**

`visibility: 'COMMUNITY'`への更新と同時に`publishedToCommunityAt: FieldValue.serverTimestamp()`を設定する。`updatedAt`は下書き自動保存(`saveDraft`)のたびにも更新されるため、「コミュニティ公開日時」の代わりには使えない — 一覧の並び順は専用フィールドで管理する。

```ts
await getFirestore().doc(`lessonTemplates/${request.data.templateId}`).update({
  visibility: 'COMMUNITY', publishedToCommunityAt: FieldValue.serverTimestamp(),
})
```

`unpublishTemplateFromCommunityCallable`は`publishedToCommunityAt`を変更しない(非公開→再公開時に新しい日時へ更新されるのは`publishTemplateToCommunityCallable`側でのみ)。

### クライアント側

**`src/lib/lessonTemplates/communityTemplates.ts`(新規)**

```ts
export interface CommunityTemplate {
  id: string; title: string; description: string; subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS'
  currentPublishedVersionId: string
}
export interface ListCommunityTemplatesInput { subject?: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS' }

export const listCommunityTemplates = async (firestore: Firestore, input: ListCommunityTemplatesInput = {}): Promise<CommunityTemplate[]>
```

`where('visibility', '==', 'COMMUNITY')`に加え、`input.subject`が指定されていれば`where('subject', '==', input.subject)`、常に`orderBy('publishedToCommunityAt', 'desc')` + `limit(50)`(v1はカーソルページネーションなし、`docs/superpowers/specs/...`に将来課題として明記)。

**新規ルート `/teacher/marketplace`**

`TemplateListRoute`(`src/App.tsx:251`)と同じ構造で新設する。

```
CommunityMarketplaceRoute(services)
  --useEffect: listCommunityTemplates(firestore, { subject: selectedSubject })-->
  --CommunityTemplatesPage(templates, loading, selectedSubject, onSubjectChange, onDuplicate)
```

`onDuplicate(template)`は`duplicateLessonTemplate(functions, { sourceTemplateId: template.id, sourceVersionId: template.currentPublishedVersionId, targetOrgId: personalOrgId(uid), confirmedOverrides: {}, idempotencyKey: crypto.randomUUID() })`を呼ぶ(既存のclient libをそのまま利用、変更不要)。組織選択UIは持たない(他の既存ルートと同じ簡素さを踏襲、`personalOrgId(uid)`固定)。

**`CommunityTemplatesPage`(新規、表示専用コンポーネント)**

科目フィルタ(タブまたはトグルボタン)、一覧(タイトル・説明・「自組織へ複製」ボタン)、空状態・エラー状態の表示。

### Firestore複合インデックス

```json
{
  "collectionGroup": "lessonTemplates", "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "visibility", "order": "ASCENDING" },
    { "fieldPath": "publishedToCommunityAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "lessonTemplates", "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "visibility", "order": "ASCENDING" },
    { "fieldPath": "subject", "order": "ASCENDING" },
    { "fieldPath": "publishedToCommunityAt", "order": "DESCENDING" }
  ]
}
```

## エラー処理

- 一覧取得失敗: `TemplateListRoute`と同じ「再読み込み」ボタン付きエラー表示。
- 複製失敗: `TemplateOverviewPage`等と同じ`describeError`パターンでメッセージ表示。

## テスト方針

- `publishLessonVersion.test.ts`: `title`/`description`/`subject`が`lessonTemplates`ドキュメントに複製されることを検証。
- `onCall.test.ts`(`publishTemplateToCommunityCallable`): `publishedToCommunityAt`が更新呼び出しに含まれることを検証。
- `communityTemplates.test.ts`: `subject`未指定時は`visibility`のみでクエリ、指定時は`subject`条件も追加されることをFirestore SDKのモックで検証。
- `CommunityTemplatesPage.test.tsx`: 科目フィルタ切り替え、複製ボタン押下時に`duplicateLessonTemplate`が正しい引数(`sourceTemplateId`/`sourceVersionId`/`targetOrgId`)で呼ばれることを検証。
- Firestoreルール(emulator): 既存のサブプロジェクト1のテストで`COMMUNITY`テンプレートの`get`/`list`許可は検証済みのため、本サブプロジェクトでの追加ルールテストは不要(クエリ・インデックスの追加のみ)。

## 将来課題

- カーソルベースのページネーション(`limit(50)`超過時)。
- 全文検索(必要になった場合は外部検索サービスの追加を別サブプロジェクトとして検討)。
