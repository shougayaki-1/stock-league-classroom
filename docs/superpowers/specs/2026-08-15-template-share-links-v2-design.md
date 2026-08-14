# 共有リンクv2(templateShares) 設計仕様

**日付:** 2026-08-15
**対象:** Phase 5(組織・ライセンス・決済)の残項目 — 共有リンクv2
**正本:** `docs/superpowers/specs/2026-08-05-lesson-platform-roadmap-design.md` Phase 5節(「共有リンクのv2形式」)。矛盾する場合は正本を優先し、本仕様側の誤りとして扱う。

## 背景・位置づけ

`functions/src/lessonTemplates/onCall.ts`の`duplicateLessonTemplateCallable`(92行目〜)は、複製元テンプレートについて`requireActiveOrgMember(firestore, sourceOrgId, uid)`を必須にしている(107行目)。したがって現状、**自組織以外のテンプレートは閲覧も複製も一切できない**。

ロードマップは「現行の`templateShares`は不変・削除不可で失効手段がないため、学校組織向けには`revokedAt`/`expiresAt`を持つ形式が必要」と記述しているが、調査の結果`templateShares`という名前のコレクションはコードベースに存在せず、`test/firestore.rules.test.ts`の「削除済みレガシーコレクションを拒否する」テストに名前が残っているのみだった(既に廃止済みの旧システムの痕跡)。したがって本機能は「v2への移行」ではなく、実質的な新規実装である。

一方、トークンベースの一時アクセスという概念自体は、`functions/src/lessonRuns/projections/displaySession.ts`の「教室ディスプレイ用セッショントークン」として既にこのコードベースに存在する。32バイトのランダムトークンを発行し、平文は一切永続化せず、SHA-256ハッシュ(`sha256Hex`、同ファイルでexport済み)のみをドキュメントIDとして保存するパターンを流用する。

## スコープ判断(ユーザー承認済み)

- 許可範囲: 閲覧 + 自組織への複製。
- 作成権限: テンプレートの`createdByUid`本人のみ。
- 共有単位: 特定の公開版(`versionId`固定)。元テンプレートが編集されても共有先には影響しない。
- トークン方式: 推測不可能なcapabilityトークン(メールアドレス紐付けではない)。
- 失効権限: 作成者のみ。
- 有効期限: 作成者が日数を選択(1〜90日の範囲)。

## アーキテクチャ

### データモデル

`templateShares/{sha256Hex(token)}`(トップレベルコレクション、`displaySessions`と同様ハッシュをドキュメントIDにする)

```ts
interface TemplateShareDoc {
  templateId: string
  versionId: string
  sourceOrgId: string
  createdByUid: string
  createdAt: unknown
  expiresAtMillis: number
  revokedAt: unknown | null
}
```

### Callable 1: `createTemplateShareCallable`

- 入力: `{ templateId: string; versionId: string; expiresInDays: number }`
- 検証: `expiresInDays`が1〜90の整数であること(範囲外は`invalid-argument`)。
- 認可: `lessonTemplates/{templateId}`を読み、`createdByUid === request.auth.uid`であることを確認(組織メンバーシップとは別の、テンプレート作成者本人チェック。他組織メンバーが勝手に他人の教材を共有できないようにする)。作成者と異なる場合は`permission-denied`。
- 処理: `randomBytes(32).toString('hex')`でトークン生成 → `sha256Hex`でハッシュ化 → `templateShares/{hash}`に`{ templateId, versionId, sourceOrgId: lessonTemplates.orgId, createdByUid, createdAt, expiresAtMillis: now + expiresInDays日, revokedAt: null }`を書き込み。
- 返り値: `{ token: string }`(平文トークンをこの一度だけ返す。以降はハッシュでしか存在しない)。

### Callable 2: `resolveTemplateShareCallable`

- 入力: `{ token: string }`
- 処理: `sha256Hex(token)`で`templateShares`を検索。存在しない・`revokedAt`が設定済み・`expiresAtMillis`を過ぎている、いずれかであれば`HttpsError('not-found', '共有リンクが無効です。')`(トークンの有効性の詳細は教えない、`invitations`と同じ設計思想)。
- 有効な場合: `lessonTemplates/{templateId}/versions/{versionId}`のcontentを読み取り専用で返す(閲覧用途。複製は別Callable)。

### Callable 3: `revokeTemplateShareCallable`

- 入力: `{ templateId: string; versionId: string }`
- 認可・処理: `templateShares`を`templateId == 対象`かつ`versionId == 対象`かつ`createdByUid == request.auth.uid`かつ`revokedAt == null`でクエリし、ヒットした全ドキュメントに`revokedAt`を設定する。呼び出し元が作成者でない場合は該当0件になり、結果的に何も失効されない(冪等・エラーにはしない。他人の共有の存在有無を教えないため)。
- このクエリには`templateShares`コレクションの複合インデックス(`templateId` ASC + `versionId` ASC + `createdByUid` ASC)が必要(`firestore.indexes.json`、`docs/superpowers/specs/2026-08-09-concurrent-lesson-quota-design.md`が導入した既存のインデックス定義ファイルに追記する)。

### `duplicateLessonTemplateCallable`の変更

認可の判断は`onCall.ts`の中で完結させ、`duplicateLessonTemplate.ts`(純粋なトランザクション本体)には手を入れない — 他のCallable(`orgId`の解決等)と同じく「認可はCallable層で解決してから下位層を呼ぶ」構造を踏襲する。`onCall.ts`の`DuplicateLessonTemplateCallableInput`(クライアント向け入力型)にのみ`shareToken?: string`を追加する。

`onCall.ts`側の認可分岐:
- `shareToken`が指定されている場合: `sha256Hex(shareToken)`で`templateShares`を検索し、有効(未失効・未期限切れ)かつ`templateId === request.data.sourceTemplateId`かつ`versionId === request.data.sourceVersionId`であることを確認する。一致しなければ`permission-denied`。一致すれば、既存の`requireActiveOrgMember(firestore, sourceOrgId, uid)`チェックをスキップする。
- `shareToken`が指定されていない場合: 既存の`requireActiveOrgMember`チェックをそのまま行う(後方互換)。
- `targetOrgId`側の`requireActiveOrgMember`チェックは変更なし(常に必須)。

### Firestoreルール

```
match /templateShares/{shareId} { allow read, write: if false; }
```

`aiUsageLog`・`invitations`と同じ、すべてCallable経由の明示的拒否ルール。

## データフロー

```
[教師A: テンプレート作成者] --createTemplateShareCallable(templateId, versionId, expiresInDays)-->
  createdByUid確認 --> トークン生成・ハッシュ保存 --> 平文トークンを返す(URLに埋め込んで教師Bへ渡す、渡し方自体はアプリ外)

[教師B: 別組織] --resolveTemplateShareCallable(token)-->
  ハッシュ照合 --有効--> 版のcontentを返す(閲覧)
  --duplicateLessonTemplateCallable(sourceTemplateId, sourceVersionId, targetOrgId, shareToken)-->
  ハッシュ照合・templateId/versionId一致確認 --> (既存)targetOrgIdメンバーシップ確認 --> (既存)複製処理

[教師A] --revokeTemplateShareCallable(templateId, versionId)--> 該当トークンをrevokedAt設定 --> 以降resolve/duplicateとも not-found
```

## エラー処理

- `expiresInDays`範囲外: `invalid-argument`。
- 作成者以外の共有作成試行(`createTemplateShareCallable`): `permission-denied`。
- 作成者以外の失効試行(`revokeTemplateShareCallable`): エラーにはしない。クエリが`createdByUid`で絞り込まれるため単に0件ヒットで何も起きない(他人の共有の存在有無を教えない)。
- 無効・失効・期限切れトークンでの閲覧・複製: `not-found`(理由の詳細は返さない)。
- `shareToken`のtemplateId/versionId不一致: `permission-denied`(トークンは有効だが対象が違う、複製元の詐称を防ぐ)。

## テスト方針

- `createTemplateShare.test.ts`: 作成者本人は成功しトークンを返す、非作成者(同組織含む)は`permission-denied`、`expiresInDays`が0・91・小数の場合は`invalid-argument`。
- `resolveTemplateShare.test.ts`: 有効なトークンは版contentを返す、失効済み・期限切れ・存在しないトークンはいずれも`not-found`。
- `revokeTemplateShare.test.ts`: 作成者本人は該当ドキュメントの`revokedAt`が設定される、非作成者が呼んでもクエリが0件ヒットで何も変更されない(エラーにもならない)、該当ドキュメントが無い場合も成功。
- `onCall.test.ts`(`duplicateLessonTemplateCallable`): 有効な`shareToken`があれば非メンバーでも`duplicateLessonTemplateWithAdminSdk`が呼ばれる(`requireActiveOrgMember`の`sourceOrgId`呼び出しをスキップ)、`shareToken`のtemplateId/versionIdが要求と食い違えば`permission-denied`、`shareToken`未指定時は既存の自組織メンバーシップ要件が変わらないことを回帰確認。`duplicateLessonTemplate.ts`自体は無変更のため`duplicateLessonTemplate.test.ts`の変更は不要。
- Firestoreルール: `templateShares`への直接クライアント読み書きを拒否する明示ルールのテキストマッチ + emulatorでの実拒否確認(既存の`aiUsageCounters`テストと同じ形式)。
