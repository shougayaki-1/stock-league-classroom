# 上位組織と学校の階層 設計仕様

**日付:** 2026-08-09
**対象:** Phase F(組織・契約)のサブプロジェクト5 — 上位組織と学校の階層
**正本:** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md` §19.1(階層)・§19.2(上位組織の権限、一部)。矛盾する場合は正本を優先し、本仕様側の誤りとして扱う。

## 背景・位置づけ

Phase Fサブプロジェクト1(学校組織の作成・招待)により学校組織が作れるようになった。本サブプロジェクトはその上に、§19.1が定義する「自治体・学校法人 → 学校」の階層構造(上位組織の作成、学校の紐付け・解除、子学校一覧)を作る。

**スコープ判断(ユーザー承認済み):**
- 本サブプロジェクトは**階層の作成・学校の追加/削除・一覧、および紐付け/解除のUI操作**を含む。
- §19.3(枠配分——共有プール・学校ごとの最低保証等)は含めない。プランの土台(Phase Fサブプロジェクト2)との組み合わせが複雑になるため、別サブプロジェクトとする。
- §19.4(契約終了時のデータ保持保証)は含めない。このプロジェクトには組織・学校を削除する機能自体がまだ存在しないため、「削除しても学校データは残す」という保証を実装する対象が現時点で存在しない。
- 上位組織自体のプラン・課金は付与しない(既存の`planId`フィールドは上位組織のドキュメントには設定しない)。

## アーキテクチャ

### 上位組織の作成

新規Callable`createParentOrgCallable`(`functions/src/organizations/onCall.ts`に追加)。`createSchoolOrgCallable`と同じ骨格・同じ認可(認証済み教師なら誰でも呼べる)。`organizations/{orgId}`を`{type: 'parentOrg', name, ownerUid, createdAt}`で作成し、作成者を`role: 'owner'`のメンバーとして追加する(`createSchoolOrg`の二段書き込みパターンをそのまま再利用)。

### 学校の紐付け・解除

`organizations/{orgId}`に`parentOrgId: string | null`フィールドを追加する(学校組織のみが持つ。上位組織自身や個人組織には常に`null`)。

- 新規Callable`linkSchoolToParentOrgCallable({parentOrgId, schoolOrgId})`。**認可: 呼び出し元が両方の組織のowner/adminであることを要求する**(上位組織側だけの一存で他人の学校を勝手に配下へ組み込めないようにするため——招待のような相互合意の仕組みを新設するのは今回のスコープ外と判断し、代わりに「両方を管理する権限を持つ人だけが紐付けできる」という単純だが安全な制約にする)。対象の`schoolOrgId`が`type: 'school'`であること、既に別の`parentOrgId`を持っていないことも確認する。
- 新規Callable`unlinkSchoolFromParentOrgCallable({schoolOrgId})`。認可: 呼び出し元が現在の`parentOrgId`のowner/adminであること。`parentOrgId`を`null`に戻す。

### 一覧表示

新規Callable`listChildSchoolsCallable({parentOrgId})`。認可: `requireActiveOrgMember`で上位組織のアクティブメンバーであれば誰でも呼べる。§19.2「上位組織は学校の生徒個票を標準では見ない」は、そもそも生徒データに一切触れないこのCallableの設計そのものによって構造的に満たされる——能動的なフィルタリングは不要。`organizations`コレクションを`parentOrgId == 対象parentOrgId`でクエリし、`{orgId, name, verificationStatus}`のみ返す(メンバー一覧・生徒データは一切含めない)。

### UI

- `SchoolOrgSettingsPage`(実装済み)に、学校組織の場合のみ「所属する上位組織」欄を追加する。`organizations/{orgId}`ドキュメントを`firestore.rules`の既存`allow get`権限を使い**クライアントから直接Firestore読み取り**する(新規Callableは不要——ルールが既にアクティブメンバーの`get`を許可しているため)。`parentOrgId`があれば上位組織名を表示、`null`なら「なし」と表示する。
- 新規`ParentOrgSettingsPage`: 上位組織名+子学校一覧(name/verificationStatus)を表示し、「学校を追加」フォーム(学校の組織ID入力——両組織を管理する教師が自分の学校のIDを知っている前提。組織名検索機能はスコープ外)と、各子学校行の「解除」ボタンを持つ。

## データフロー

```
[教師: 上位組織を作成] --createParentOrgCallable--> organizations/{orgId}(type:'parentOrg') 作成 + owner権限メンバー追加

[両方の組織を管理する教師: 上位組織設定画面「学校を追加」] --学校orgIdを入力--> linkSchoolToParentOrgCallable({parentOrgId, schoolOrgId})
  --> 両組織のowner/admin確認 --> 対象がtype:'school'かつparentOrgId未設定であることを確認
  --> organizations/{schoolOrgId}.parentOrgId = parentOrgId を書き込み

[上位組織のアクティブメンバー: 上位組織設定画面] --画面表示時--> listChildSchoolsCallable({parentOrgId})
  --> requireActiveOrgMember確認 --> organizations を parentOrgId==X でクエリ --> {orgId, name, verificationStatus}[] を返す

[両組織を管理する教師: 子学校一覧の「解除」ボタン] --> unlinkSchoolFromParentOrgCallable({schoolOrgId})
  --> 現在のparentOrgIdのowner/admin確認 --> organizations/{schoolOrgId}.parentOrgId = null

[学校組織設定画面] --画面表示時--> organizations/{orgId} を直接Firestore読み取り(firestore.rulesの既存allow get)
  --> parentOrgId があれば上位組織名を表示(nullなら「なし」)
```

## エラー処理

- `linkSchoolToParentOrgCallable`: 呼び出し元が上位組織側のowner/adminでない、または学校側のowner/adminでない場合は`permission-denied`。対象が`type: 'school'`でない場合、または既に別の`parentOrgId`を持っている場合は`failed-precondition`(「この学校は既に別の上位組織に所属しています」)。
- `unlinkSchoolFromParentOrgCallable`: 呼び出し元が現在の`parentOrgId`のowner/adminでない場合`permission-denied`。対象校が既に`parentOrgId: null`の場合`failed-precondition`(「この学校はどの上位組織にも所属していません」)。
- `listChildSchoolsCallable`: 未認証・非アクティブメンバー拒否のみ。子学校が0件でも正常系(空配列)。
- `firestore.rules`: `organizations/{orgId}`への直接クライアント書き込みは既存のまま`allow write: if false`を維持する(`parentOrgId`の変更もAdmin SDK専用のCallable経由のみ)。

## テスト方針

- `createParentOrg`(純粋関数): `createSchoolOrg.test.ts`と同様に組織・メンバー・RTDBミラー書き込みを検証する。
- `linkSchoolToParentOrg`/`unlinkSchoolFromParentOrg`(純粋関数): 認可漏れ、対象がschool型でない場合の拒否、既に紐付け済みの場合の拒否、正常系での`parentOrgId`書き込みを検証する。
- `listChildSchools`(純粋関数): `parentOrgId`一致する組織のみ返し、生徒データに触れるフィールドを一切含まないことを検証する。
- 3つのCallable: 認可・エラー変換を`onCall.test.ts`の既存形式で検証する。
- UI: `ParentOrgSettingsPage`(子学校一覧+追加フォーム+解除ボタン)、`SchoolOrgSettingsPage`への「所属する上位組織」表示追加を検証する。
