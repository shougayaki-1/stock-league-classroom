# VERIFIED / OFFICIAL 教材認定 設計仕様

**日付:** 2026-08-15
**対象:** Phase 6「テンプレートマーケットプレイス」— VERIFIED / OFFICIAL 公開区分
**正本:** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md`
**関連:** `docs/superpowers/specs/2026-08-15-template-report-moderation-design.md`, `docs/superpowers/scope-backlog.md`

## 背景

Phase 6 の検索・閲覧、COMMUNITY 公開、派生、通報、レビューは実装済みで、未着手として残る本体は公開区分 `VERIFIED` / `OFFICIAL` である。既存の運営審査は `operator` custom claim を使い、`/operator/reports` で通報確認・非公開化を行っている。認定機能はこの運営境界の上に追加する。

`LessonVersion` は `immutable: true` の不変版であるため、認定付与のために version document 自体を書き換えない。

## 区分定義（ユーザー承認済み）

- `COMMUNITY`: 一般教師が公開した教材。
- `VERIFIED`: 現在公開中の version を operator が審査し、認証済みとした教材。
- `OFFICIAL`: operator アカウントが作成・管理する運営公式教材の現在公開中 version。

`OFFICIAL` は任意の一般教師教材へ付ける「VERIFIED の上位バッジ」ではない。一般教師が作成した教材は VERIFIED までは可能だが OFFICIAL にはできない。

## Visibility model

既存 `visibility` を公開区分として拡張する。

```ts
export type LessonTemplateVisibility =
  | 'PRIVATE'
  | 'LINK'
  | 'ORGANIZATION'
  | 'COMMUNITY'
  | 'VERIFIED'
  | 'OFFICIAL'
```

マーケットプレイスで公開扱いとなるのは `COMMUNITY | VERIFIED | OFFICIAL` の3区分。

`VERIFIED` / `OFFICIAL` は template 全履歴の永久属性ではなく、`currentPublishedVersionId` が指す version の現在の公開認定状態を表す。

## Version 単位の認定 metadata

version document は変更せず、認定 metadata を独立 collection に保持する。

```text
templateVersionCertifications/{templateId}__{versionId}
```

```ts
export interface TemplateVersionCertificationDoc {
  templateId: string
  versionId: string
  level: 'VERIFIED' | 'OFFICIAL' | null
  grantedByUid: string | null
  grantedAt: unknown | null
  revokedByUid: string | null
  revokedAt: unknown | null
  reason: string | null
  updatedAt: unknown
}
```

認定操作履歴は append-only の独立 collection に残す。

```text
templateCertificationEvents/{eventId}
```

```ts
export interface TemplateCertificationEventDoc {
  templateId: string
  versionId: string
  previousVisibility: 'COMMUNITY' | 'VERIFIED' | 'OFFICIAL'
  nextVisibility: 'COMMUNITY' | 'VERIFIED' | 'OFFICIAL'
  actorUid: string
  reason: string
  createdAt: unknown
}
```

これらは client から直接 read/write させず Callable 経由とする。

## 認定操作

operator-only Callable を1つの操作契約に集約する。

```ts
export interface SetTemplateCertificationInput {
  templateId: string
  versionId: string
  level: 'COMMUNITY' | 'VERIFIED' | 'OFFICIAL'
  reason: string
  idempotencyKey: string
}
```

意味:

- `COMMUNITY`: 現在の VERIFIED/OFFICIAL を解除し、一般公開へ戻す。
- `VERIFIED`: 現在版へ認証済みを付与する。
- `OFFICIAL`: operator 作成教材の現在版へ公式を付与する。

認可順序は必ず次とする。

```text
request.auth
→ operator claim
→ scalar input validation
→ template read
→ version read
→ OFFICIAL の creator/operator 検証
→ transaction
```

operator 権限確認より前に template/version を読まない。

## OFFICIAL 資格

OFFICIAL 付与時は `lessonTemplates/{templateId}.createdByUid` のユーザーを Admin Auth で取得し、`customClaims.operator === true` を確認する。これにより「operator 自身が作成・管理する公式教材」という定義を server-side で強制する。

一般教師が作成した教材へ OFFICIAL を要求した場合は `failed-precondition`。

VERIFIED は creator が operator である必要はない。

## Current version 限定

認定操作対象 `versionId` は必ず `template.currentPublishedVersionId` と一致しなければならない。古い version に新規の認定を付与しない。

過去に認定されていた version の `templateVersionCertifications` / event は履歴として残す。

## 新 version 公開時の降格

認定は version 単位なので、新しい version publish で自動継承しない。

`publishLessonVersion` が新 version を作る transaction で、現在の template visibility が `VERIFIED` または `OFFICIAL` の場合のみ `COMMUNITY` へ戻す。

```text
VERIFIED(v3) → publish v4 → COMMUNITY(v4)
OFFICIAL(v3) → publish v4 → COMMUNITY(v4)
```

`PRIVATE` / `LINK` / `ORGANIZATION` / `COMMUNITY` は publish によって勝手に変更しない。

新 version publish は旧 certification document/event を削除しない。

## Idempotency / atomicity

認定変更は Firestore transaction で、次を同時に行う。

1. idempotency document 読み取り
2. template/version 再読取
3. current version / current visibility の検証
4. template.visibility 更新
5. current certification metadata 更新
6. certification event 追加
7. idempotency result 保存

同じ idempotency key + 同じ payload は同じ結果を返す。同じ key + 異なる payload は `failed-precondition`。

認定状態だけ変わり event がない、または event だけ残り visibility が変わらない部分成功を許さない。

## Marketplace semantics

公開教材判定を literal `visibility === 'COMMUNITY'` に散らさず、共有 helper または明示的な public visibility set に集約する。

```ts
export const MARKETPLACE_VISIBILITIES = ['COMMUNITY', 'VERIFIED', 'OFFICIAL'] as const
```

次を3区分対応へ変更する。

- Firestore lessonTemplates get/list rules
- marketplace 一覧 query
- marketplace detail
- duplicate / derivative の公開判定
- report 対象判定
- unpublish
- 公開 badge 表示

`UNPUBLISH` は VERIFIED/OFFICIAL でも `PRIVATE` へ戻す。通報による operator 非公開化でも同様。

## Operator UI

既存 `/operator/reports` を含む operator workspace を拡張し、小さな `/operator/certifications` 画面を追加する。巨大な新管理システムは作らない。

画面は現在公開中の `COMMUNITY | VERIFIED | OFFICIAL` 教材を一覧し、current version と現在区分を表示する。

operator は対象を選び、理由を入力して次を実行できる。

- VERIFIED にする
- OFFICIAL にする
- COMMUNITY に戻す

OFFICIAL 不適格な教材は UI でもボタンを無効化できるが、最終判定は Callable。

## Teacher marketplace UI

一般教師側は公開区分を読み取り専用 badge として表示する。

- COMMUNITY: 通常公開
- VERIFIED: 認証済み
- OFFICIAL: 公式

教師自身が VERIFIED/OFFICIAL を直接付与する操作は作らない。

## Firestore Rules

`templateVersionCertifications` / `templateCertificationEvents` / certification idempotency collection は client direct access を拒否する。

lessonTemplates の public read 条件は `COMMUNITY | VERIFIED | OFFICIAL` を許可する。

client update で visibility を変更できるようにはしない。既存同様、publish/community/certification の server-side Callable が状態変更を担う。

## セキュリティ不変条件

1. operator 判定より前に対象 template/version を読まない。
2. certification は current published version にだけ付与できる。
3. version document の immutable content を変更しない。
4. OFFICIAL は operator 作成教材だけ。
5. 一般教師は certification metadata を直接書けない。
6. new version は旧 version の認定を継承しない。
7. VERIFIED/OFFICIAL も通報・非公開化できる。
8. idempotent retry で event が重複しない。

## 今回扱わないもの

- 投稿者アカウントの利用停止
- 高度な審査履歴検索 UI
- §17.7 チェックリスト10項目の構造化
- 外部審査機関や電子署名
- operator organization の新しい組織種別
- OFFICIAL 教材専用 authoring UI
- marketplace 全文検索 / Algolia
