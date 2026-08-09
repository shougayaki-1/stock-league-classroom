# 教師席の割当・解除 設計仕様

**日付:** 2026-08-09
**対象:** Phase F(組織・契約)のサブプロジェクト3 — 教師席の割当・解除
**正本:** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md` §18.6(教師席・追加オプション)。矛盾する場合は正本を優先し、本仕様側の誤りとして扱う。

## 背景・位置づけ

Phase Fサブプロジェクト1(学校組織の作成・招待)・2(プラン・利用枠の土台)が完了し、複数人が所属する組織と、その組織が持つ`teacherSeats`上限の参照ができるようになった。しかし現状、組織のメンバー一覧を見るCallableも、メンバーを解除(suspend)するCallableも存在しない——`functions/src/organizations/membershipSync.ts`の`syncOrganizationMembershipChange`は「suspend、役割変更、昇格/降格フローはPhase B以降の対象」と明記した上で用意されていた、未使用のまま残っていた関数である。本サブプロジェクトはこれを使い、教師席の「一覧表示」と「解除」を実装する。

**スコープ判断(ユーザー承認済み):**
- 本サブプロジェクトは**一覧表示+解除のみ**を扱う。招待受諾時に`teacherSeats`上限を実際に強制(超過時に拒否)することは含まない——他の制限軸(同時授業・市場数、AIクレジット等)の強制とまとめて、§18.9(作成時の利用枠確保)を実装する別サブプロジェクトで一貫して行う。
- 教師席を消費するのは**owner/admin/teacherロールを持つアクティブなメンバー全員**(仕様書がロールごとの区別を設けていないため、最も単純で予測しやすい解釈)。

## アーキテクチャ

### メンバー一覧の取得

新規Callable`listOrgMembersCallable`(`functions/src/organizations/onCall.ts`に追加)。

- 認可: `requireActiveOrgMember`で対象組織のアクティブメンバーであることを確認すれば誰でも呼べる(閲覧は制限しない)。
- 処理: `organizations/{orgId}/members`サブコレクションを取得し、各メンバーの`uid`をFirebase Admin Auth(`getAuth().getUsers([...])`)でメールアドレスへ解決して返す。

```ts
interface OrgMember { uid: string; email: string | null; role: 'owner' | 'admin' | 'teacher'; status: 'active' | 'suspended'; membershipVersion: number }
```

### メンバーの解除(教師席の解放)

新規Callable`suspendOrgMemberCallable`。

- 認可: `requireActiveOrgMember`で確認したうえで、role が`'owner'`または`'admin'`であること(`createInvitationCallable`と同じ認可)。
- 入力: `{orgId: string, uid: string}`。
- 安全装置: 対象がその組織で**唯一のアクティブなowner**である場合は拒否する(`failed-precondition`、「組織には少なくとも1人のownerが必要です」)——組織が誰にも管理されない状態を防ぐ。
- 処理: 対象メンバーの現在の`membershipVersion`を読み、`syncOrganizationMembershipChange`(既存)を`{role: 現在のrole, status: 'suspended', membershipVersion: 現在値+1}`で呼ぶ。役割はそのまま、`status`のみ変更する——`acceptInvitation`の「新規追加」時は`membershipVersion: 1`固定だったが、既存メンバーの状態変更はバージョンを進める。

### UI

`SchoolOrgSettingsPage`(実装済み)にメンバー一覧セクションを追加する。

- 各アクティブメンバーに、呼び出し元がowner/adminの場合のみ「解除」ボタンを表示する。組織作成者自身の行には解除ボタンを出さない(自分自身の解除は許可するが、UIからの誤操作を避けるため——サーバー側の唯一owner保護と二重の安全策)。
- 見出し付近に「教師席: 使用中 X / 上限 Y」を表示する(実装済みの`getOrgPlanLimits`の`teacherSeats`と、メンバー一覧のアクティブ数〈owner/admin/teacher〉を突き合わせて計算する。表示のみで、上限超過を防ぐ機能ではない)。

## データフロー

```
[教師: 組織設定画面] --画面表示時--> listOrgMembersCallable({orgId})
  --> requireActiveOrgMember確認 --> organizations/{orgId}/members を取得
  --> Admin Authでuid→emailを解決 --> メンバー一覧(role/status/email)を返す
  --> 同時にgetOrgPlanLimits({orgId})でteacherSeats上限も取得し、「使用中X/上限Y」を表示

[owner/admin: メンバー一覧の「解除」ボタン] --> suspendOrgMemberCallable({orgId, uid})
  --> requireActiveOrgMember + owner/admin確認
  --> 対象が唯一のアクティブownerでないことを確認
  --> 対象の現在のmembershipVersionを読む
  --> syncOrganizationMembershipChange({role: 現在のrole, status: 'suspended', membershipVersion: 現在値+1})
  --> 画面のメンバー一覧を再取得して更新
```

## エラー処理

- `listOrgMembersCallable`: 未認証は`unauthenticated`。非アクティブメンバーは`requireActiveOrgMember`が`permission-denied`。Admin Authでの解決に失敗したuid(退会済みFirebaseユーザー等)は`email: null`として返す(一覧取得自体は失敗させない)。
- `suspendOrgMemberCallable`: 呼び出し元がowner/adminでない場合`permission-denied`。対象メンバーが存在しない/既に`suspended`の場合は`failed-precondition`(「このメンバーは既に解除されています」)。対象が唯一のアクティブownerの場合は`failed-precondition`(「組織には少なくとも1人のownerが必要です」)。
- UI: 解除処理中はボタンを無効化し、失敗時はエラーメッセージを表示して一覧の状態は変更しない(楽観的更新はしない——`suspendOrgMemberCallable`の応答を待ってから一覧を再取得する)。

## テスト方針

- `listOrgMembersCallable`: 未認証・非アクティブメンバー拒否、メンバー一覧+メールアドレス解決を検証する(`getAuth().getUsers`はモック化)。
- `suspendOrgMemberCallable`: owner/admin以外からの拒否、唯一のアクティブowner保護(拒否されること)、2人目のownerがいる場合はownerでも解除できること、`syncOrganizationMembershipChange`が正しい引数(`membershipVersion`が現在値+1)で呼ばれることを検証する(`syncOrganizationMembershipChange`はモック化)。
- `firestore.rules`: `organizations/{orgId}/members/{uid}`への直接クライアント書き込みが引き続き拒否されること(既存ルールの回帰確認)。
- UI: メンバー一覧が表示され、「使用中X/上限Y」が正しく計算されること、「解除」ボタンがowner/adminにのみ表示され、クリックで`suspendOrgMemberCallable`が正しい引数で呼ばれることを検証する。
