# レビュー(評価・コメント) 設計仕様

**日付:** 2026-08-15
**対象:** Phase 6(テンプレートマーケットプレイス)サブプロジェクト5 — レビュー
**正本:** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md` §17.5(レビュー)。矛盾する場合は正本を優先し、本仕様側の誤りとして扱う。

## 背景・位置づけ

§17.5は「実際に授業で使用した教師だけレビュー可能」「観点別評価」「コメント・Q&Aはレビューと分離」「認証は版単位」を定める。調査の結果、レビュー資格判定には既存アーキテクチャ上の制約がある。

`duplicateLessonTemplateCallable`は`visibility === 'COMMUNITY'`のテンプレートを組織外の教師が複製できるが、`createLessonRunCallable`の認可は組織メンバーシップのみで、共有リンク/COMMUNITY公開のバイパスを持たない。したがって組織外の教師がマーケットプレイス教材を実際に授業で使うには**必ず自組織へ複製してから**実施する。この場合`lessonRuns.templateId`はマーケットプレイス上の元テンプレートIDではなく、複製先(コピー)のテンプレートIDになる。レビュー資格判定はこの2段階(直接実施/複製経由)を考慮する必要がある(ユーザー承認済み、複製経由を含める)。

## スコープ判断(ユーザー承認済み)

- レビュー資格: `primaryTeacherUid`が対象版で`status === 'COMPLETED'`のlessonRunを持つこと(共同教師`teacherRoles`は対象外、将来拡張)。
- 観点別評価は3軸: 内容の分かりやすさ・実施のしやすさ・生徒の反応(各1〜5)。
- コメント・Q&Aの独立スレッド機能は対象外。レビュー自体に1件の自由記述コメント欄を含める(§17.5の「コメント・質問はレビューと分離」は、レビュー以外の独立コメント機能を指すため、今回のスコープには影響しない)。

## アーキテクチャ

### データモデル

`templateReviews/{versionId}_{uid}`(決定的ドキュメントID。1教師につき1版1レビュー、再送信は上書き)

```ts
interface TemplateReviewDoc {
  templateId: string
  versionId: string
  reviewedByUid: string
  clarityRating: number // 1-5
  easeOfImplementationRating: number // 1-5
  studentResponseRating: number // 1-5
  comment: string | null
  createdAt: unknown
  updatedAt: unknown
}
```

`lessonTemplates`ドキュメントに集計フィールドを追加(レビュー投稿のたびに再計算・上書き)。

```ts
reviewCount: number
averageClarityRating: number
averageEaseOfImplementationRating: number
averageStudentResponseRating: number
```

### レビュー資格判定(共通ロジック)

1. **直接実施**: `lessonRuns`を`templateId == 元templateId`かつ`primaryTeacherUid == uid`かつ`status == 'COMPLETED'`で検索し、結果のいずれかが`templateVersionId == 元versionId`であれば資格あり。
2. **複製経由**: 1で資格が無ければ、`lessonTemplates`を`sourceTemplateId == 元templateId`かつ`sourceVersionId == 元versionId`かつ`createdByUid == uid`で検索(自分が作った複製)。各複製の`templateId`について`lessonRuns`を`templateId == 複製ID`かつ`primaryTeacherUid == uid`かつ`status == 'COMPLETED'`で検索し、1件でもあれば資格あり。

このロジックは`canReviewTemplateCallable`と`submitTemplateReviewCallable`の両方が同じ形で使う(クライアント側の事前チェックはUX目的のみで、書き込み時に必ずサーバー側で再検証する)。

### Callable 1: `canReviewTemplateCallable`

- 入力: `{ templateId: string; versionId: string }`
- 認可: 署名済み教師なら誰でも可。
- 処理: 上記判定を行い`{ eligible: boolean }`を返す。

### Callable 2: `submitTemplateReviewCallable`

- 入力: `{ templateId: string; versionId: string; clarityRating: number; easeOfImplementationRating: number; studentResponseRating: number; comment?: string }`
- 検証: 各`*Rating`が1〜5の整数であること(`invalid-argument`)。
- 認可: 資格判定を再実行し、資格が無ければ`permission-denied`。
- 処理: `templateReviews/{versionId}_{uid}`をupsert。同じ処理の中で該当`templateId`+`versionId`の全レビューを読み直し、平均値・件数を計算して`lessonTemplates`の集計フィールドを更新する。

### Callable 3: `listTemplateReviewsCallable`

- 入力: `{ templateId: string; versionId: string }`
- 認可: 署名済み教師なら誰でも可(コミュニティ公開教材の情報であり非公開情報を含まない)。
- 処理: 対象版のレビュー一覧(コメント含む)を返す。

### Firestoreルール・複合インデックス

```
match /templateReviews/{reviewId} { allow read, write: if false; }
```

複合インデックス2件を追加する。

```json
{ "collectionGroup": "lessonRuns", "queryScope": "COLLECTION", "fields": [
  { "fieldPath": "templateId", "order": "ASCENDING" },
  { "fieldPath": "primaryTeacherUid", "order": "ASCENDING" },
  { "fieldPath": "status", "order": "ASCENDING" }
]},
{ "collectionGroup": "lessonTemplates", "queryScope": "COLLECTION", "fields": [
  { "fieldPath": "sourceTemplateId", "order": "ASCENDING" },
  { "fieldPath": "sourceVersionId", "order": "ASCENDING" },
  { "fieldPath": "createdByUid", "order": "ASCENDING" }
]}
```

### UI

- 新規ルート`/teacher/marketplace/:templateId`(詳細ページ、今回新設。現状`CommunityTemplatesPage`の各行はクリックしても遷移先が無い): 説明・集計評価(3軸平均+件数)・レビュー一覧を表示。`canReviewTemplateCallable`が`eligible: true`を返した場合のみ、3軸の星評価+コメント入力フォームを表示し`submitTemplateReviewCallable`を呼ぶ。
- `CommunityTemplatesPage`の各行タイトルを詳細ページへのリンクにする。

## エラー処理

- 評価値が1〜5の整数でない: `invalid-argument`。
- 資格なしでの`submitTemplateReviewCallable`呼び出し: `permission-denied`。

## テスト方針

- レビュー資格判定: 直接実施で資格あり、複製経由(1段階)で資格あり、いずれも無し(未実施・進行中のみ)で資格なし、を検証。
- `submitTemplateReviewCallable`: 評価値の範囲外は`invalid-argument`、資格なしは`permission-denied`、同一教師の再送信で既存レビューが上書きされること、`lessonTemplates`の集計フィールドが正しく再計算されることを検証。
- `listTemplateReviewsCallable`: 一覧取得を検証。
- Firestoreルール(emulator): `templateReviews`への直接クライアント読み書き拒否。
- UI: 資格なし時にフォーム非表示、資格あり時に送信できること、集計表示、`CommunityTemplatesPage`からの遷移。
