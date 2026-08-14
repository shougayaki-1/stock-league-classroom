# 公開範囲の拡張(COMMUNITY公開) 設計仕様

**日付:** 2026-08-15
**対象:** Phase 6(テンプレートマーケットプレイス)サブプロジェクト1 — 公開範囲の拡張
**正本:** `docs/superpowers/specs/2026-08-05-lesson-platform-roadmap-design.md` Phase 6節、`docs/superpowers/specs/2026-08-05-integrated-platform-spec.md` §17.1(公開範囲)。矛盾する場合は正本を優先し、本仕様側の誤りとして扱う。

## 背景・位置づけ

統合仕様書§17.1は公開範囲として「非公開・リンク限定・組織内・コミュニティ公開・認証済み・公式」の6区分を定義しているが、コードベースを調査した結果`lessonTemplates.visibility`は`'PRIVATE'`しか使われておらず、しかも**この値自体が現状Firestoreルールの読み取り判定に一切使われていない**(`firestore.rules:91-93`の`allow get/list`は`activeMember(resource.data.orgId)`のみで判定し、`visibility`は単なるメタデータ)。

Phase 6は6区分すべてを一度に実装するには大きすぎるため、以下のように役割分担する。

- 「リンク限定」は`docs/superpowers/specs/2026-08-15-template-share-links-v2-design.md`で実装済みの`templateShares`が既に担っており、新しい仕組みは不要。
- 「組織内」は現状の`activeMember(orgId)`判定が既に実質的にこれを提供している。
- 「認証済み」「公式」は「人手審査」「運営側作成」を前提とするため、Phase 6の別サブプロジェクト(通報と審査)で扱う。
- 本サブプロジェクトが新規に実装するのは**「コミュニティ公開」の1区分のみ**。

## スコープ判断(ユーザー承認済み)

- 追加する値は`COMMUNITY`のみ。`VERIFIED`/`OFFICIAL`は将来の審査機能サブプロジェクトで扱う。
- 公開操作を行えるのはテンプレートの`createdByUid`本人のみ(共有リンクv2と同じ方針)。
- 読み取りアクセスはFirestoreルールの緩和で実現する(`planDefinitions`と同じ「広く読み取り可・書き込みはCallable限定」の既存パターンを踏襲)。マーケットプレイスの検索・一覧(将来のサブプロジェクト2)がFirestoreクエリで自然に実装できることを優先する。
- 統合仕様書§17.3が言及する「外部派生禁止の学校は一般公開不可」という組織側トグルは、対応する`organizations`フィールドがまだ存在しないため、今回のスコープには含めない(全組織がコミュニティ公開可能な状態とする)。

## アーキテクチャ

### Callable 1: `publishTemplateToCommunityCallable`

- 入力: `{ templateId: string }`
- 認可: `lessonTemplates/{templateId}`を読み、`createdByUid === request.auth.uid`を確認(`permission-denied`)。
- 検証: `currentPublishedVersionId`が`null`でないこと(下書きのみの未公開テンプレートは公開不可、`failed-precondition`)。
- 処理: `lessonTemplates/{templateId}`を`{ visibility: 'COMMUNITY' }`で更新(Admin SDK、クライアント直接更新は既存ルールにより不可能)。

### Callable 2: `unpublishTemplateFromCommunityCallable`

- 入力: `{ templateId: string }`
- 認可: 同上(`createdByUid`本人のみ)。
- 処理: `lessonTemplates/{templateId}`を`{ visibility: 'PRIVATE' }`に戻す。

### `duplicateLessonTemplateCallable`の変更

既存の`shareToken`分岐(共有リンクv2で追加済み)と並列に、ソーステンプレートの`visibility === 'COMMUNITY'`の場合も`requireActiveOrgMember(sourceOrgId)`をスキップする条件を追加する。

```
if (shareTokenが有効) { sourceOrgIdメンバーシップをスキップ }
else if (sourceTemplateSnap.visibility === 'COMMUNITY') { sourceOrgIdメンバーシップをスキップ }
else { 既存の requireActiveOrgMember(sourceOrgId) }
```

targetOrgId側の`requireActiveOrgMember`は変更なし(常に必須)。

### Firestoreルール

`lessonTemplates/{templateId}`(`firestore.rules:91-93`)

```
allow get: if teacher() && (activeMember(resource.data.orgId) || resource.data.visibility == 'COMMUNITY');
allow list: if teacher() && (activeMember(resource.data.orgId) || resource.data.visibility == 'COMMUNITY');
```

`lessonTemplates/{templateId}/versions/{versionId}`(`firestore.rules:110-112`)

```
allow get, list: if teacher() && (
  activeMember(get(/databases/$(database)/documents/lessonTemplates/$(templateId)).data.orgId)
  || (
    get(/databases/$(database)/documents/lessonTemplates/$(templateId)).data.visibility == 'COMMUNITY'
    && versionId == get(/databases/$(database)/documents/lessonTemplates/$(templateId)).data.currentPublishedVersionId
  )
);
```

コミュニティ公開でも、公開中の版(`currentPublishedVersionId`)以外(下書き履歴・過去版)は非メンバーに公開しない。

## データフロー

```
[教師A: 作成者] --publishTemplateToCommunityCallable(templateId)-->
  createdByUid確認 --> currentPublishedVersionId存在確認 --> visibility: 'COMMUNITY'に更新

[教師B: 別組織] --Firestore直接クエリ(visibility == 'COMMUNITY')--> 一覧取得(将来のサブプロジェクト2)
  --lessonTemplates/{id}/versions/{currentPublishedVersionId} を直接読み取り(閲覧)
  --duplicateLessonTemplateCallable(sourceTemplateId, sourceVersionId, targetOrgId)-->
  visibility== 'COMMUNITY'確認 --> (既存)targetOrgIdメンバーシップ確認 --> (既存)複製処理

[教師A] --unpublishTemplateFromCommunityCallable(templateId)--> visibility: 'PRIVATE'に戻す
```

## エラー処理

- 作成者以外の公開・非公開試行: `permission-denied`。
- `currentPublishedVersionId`未設定での公開試行: `failed-precondition`。

## テスト方針

- `publishTemplateToCommunity.test.ts`: 作成者本人は成功、非作成者は`permission-denied`、`currentPublishedVersionId`未設定は`failed-precondition`。
- `unpublishTemplateFromCommunity.test.ts`: 作成者本人は成功、非作成者は`permission-denied`。
- `duplicateLessonTemplateCallable`: `visibility === 'COMMUNITY'`のソーステンプレートは非メンバーでも複製できる(`shareToken`分岐とは独立に成立することを確認)、`PRIVATE`のままなら従来通り拒否。
- Firestoreルール(emulator): `COMMUNITY`テンプレートは非メンバーでも`get`/`list`可、`PRIVATE`は従来通り拒否。`COMMUNITY`テンプレートの`currentPublishedVersionId`と一致する版は非メンバーでも読める、一致しない版(過去版・下書き履歴)は拒否。
