# 派生関係の記録(表示+逆引き) 設計仕様

**日付:** 2026-08-15
**対象:** Phase 6(テンプレートマーケットプレイス)サブプロジェクト3 — 派生関係の記録
**正本:** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md` §17.3(派生許諾)、`docs/superpowers/specs/2026-08-15-community-marketplace-browse-design.md`(サブプロジェクト2、`visibility=='COMMUNITY'`の読み取り許可・`title`非正規化はここで実装済み)。矛盾する場合は正本を優先し、本仕様側の誤りとして扱う。

## 背景・位置づけ

統合仕様書§17.3は「すべての公開教材の派生元・版を記録する」「単なるコピーも内部的には派生として記録する」と定めているが、調査の結果`functions/src/lessonTemplates/duplicateLessonTemplate.ts`は**既に**すべての複製時に`sourceTemplateId`/`sourceVersionId`を新テンプレートへ記録しており、この要件自体は既に満たされている。

未実装なのは以下2点のみ。

1. この記録が**どこにも表示されていない**(教師がUIで派生関係を確認する手段がない)。
2. **逆引き**(自分の教材が誰にどれだけ複製されたか)を見る手段がない。

## スコープ判断(ユーザー承認済み)

- 派生元の表示 + 逆引き一覧の両方を実装する。データモデルの大きな変更は不要。
- 逆引き一覧は**COMMUNITY公開済みの派生教材のみ**を対象とする。非公開(PRIVATE)のままの複製先は表示しない — 他組織が内部で何を複製したかを元の作成者が覗き見できてしまうプライバシー上の懸念を避けるため。この制約により、既存のFirestoreルール(`visibility=='COMMUNITY'`なら読み取り可)がそのまま使え、ルール変更が不要になる。

## アーキテクチャ

### `duplicateLessonTemplate.ts`の変更

複製処理は既に複製元テンプレートの`orgId`を読んでいる(認可用)。これに加え、複製元テンプレートの`title`(サブプロジェクト2で`lessonTemplates`直下に非正規化済み)を読み取り、新テンプレートに`sourceTemplateTitle`として保存する。

```ts
tx.set(templatePath, {
  ...(既存フィールド),
  sourceTemplateId: input.sourceTemplateId,
  sourceVersionId: input.sourceVersionId,
  sourceTemplateTitle: sourceTemplateSnap.data.title ?? null,
})
```

複製元テンプレート自体の`title`を読む(バージョンではなくテンプレート本体のドキュメント)。複製時点のタイトルをスナップショットとして保存するため、複製元が後で非公開化・削除・改題されても表示は壊れない。

### `src/lib/lessonTemplates/templateDerivatives.ts`(新規)

```ts
export const listTemplateDerivatives = async (firestore: Firestore, sourceTemplateId: string): Promise<CommunityTemplate[]>
```

`where('sourceTemplateId', '==', sourceTemplateId)` + `where('visibility', '==', 'COMMUNITY')`。返り値はサブプロジェクト2の`CommunityTemplate`型を再利用する。既存のFirestoreルール(`visibility=='COMMUNITY'`なら`activeMember`でなくても`get`/`list`可)がそのまま適用されるため、ルール変更は不要。

### UI: `TemplateEditorPage`(既存)の拡張

1. **派生元の表示**: `sourceTemplateId`/`sourceTemplateTitle`が設定されている場合、「この教材は『(sourceTemplateTitle)』から派生しています」を表示する。
2. **派生教材一覧**: `listTemplateDerivatives(firestore, templateId)`の結果を「この教材から派生した公開教材」として一覧表示する。0件の場合はセクション自体を表示しない。

`TemplateEditorPageProps`に以下を追加する。

```ts
sourceTemplateId?: string
sourceTemplateTitle?: string
derivatives: CommunityTemplate[]
```

`derivatives`の取得(Firestoreクエリ呼び出し)は呼び出し元の`TemplateEditRoute`(`src/App.tsx`)が担い、`TemplateEditorPage`自体は表示専用に保つ(既存のprops経由でのデータ受け渡しパターンを踏襲)。

## エラー処理

- 複製元テンプレートが複製時点で読み取れない状況は、既存の`duplicateLessonTemplateCallable`の認可チェック(組織メンバーシップ・共有リンク・COMMUNITY公開のいずれか)で既に防がれているため、新規のエラーケースはない。
- `listTemplateDerivatives`の取得失敗時は空配列として扱い、派生教材一覧セクションを非表示にする(致命的エラーにしない、既存機能への影響を最小化)。

## テスト方針

- `duplicateLessonTemplate.test.ts`: `sourceTemplateTitle`が複製元テンプレートの`title`から複製されることを検証。`title`が存在しない(古いデータ等)場合は`null`になることを検証。
- `templateDerivatives.test.ts`: クエリが`sourceTemplateId`+`visibility=='COMMUNITY'`の2条件で組み立てられることを検証。
- `TemplateEditorPage.test.tsx`: `sourceTemplateTitle`指定時の派生元表示、`derivatives`が空の場合にセクション非表示、`derivatives`がある場合に一覧表示されることを検証。
