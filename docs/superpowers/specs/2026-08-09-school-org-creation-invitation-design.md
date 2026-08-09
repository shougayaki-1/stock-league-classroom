# 学校組織の作成・招待 設計仕様

**日付:** 2026-08-09
**対象:** Phase F(組織・契約)のサブプロジェクト1(最初) — 学校組織の作成・招待
**正本:** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md` §18.1(組織種別)・§18.2(招待)。矛盾する場合は正本を優先し、本仕様側の誤りとして扱う。

## 背景・位置づけ

Phase F(組織・契約)は§18-19だけで組織種別・招待・プラン/利用枠・教師席・ダウングレード・支払/契約期間・上位組織階層・イベントモードと独立した塊が多く、1つの仕様には収まらない。調査の結果、現状は「個人組織(所有者1人のみ)」しか実装されておらず、複数人が所属する組織そのものが存在しないことが判明した。本サブプロジェクトはPhase Fの最初の塊として、複数人が所属する組織の土台(学校組織の作成+個別招待)を作る。以降のPhase Fサブプロジェクト(教師席、プラン・利用枠、上位組織階層等)はすべてこの土台に依存する。

**スコープ判断(ユーザー承認済み):**
- 招待方式は仕様書の4種類(個別招待・共通リンク・コード、ドメイン認証、ドメインなし利用者の管理者確認)のうち、**個別招待のみ**を実装する。共通リンク・コード、ドメイン認証は別サブプロジェクトとする。
- 学校組織の「仮登録」→「認証済み」の状態遷移は**自動化しない**。組織作成時は常に`verificationStatus: 'PENDING'`で作成され、「認証済み」への遷移は本サブプロジェクトの範囲外(Firebase Console等での手動運用に委ねる — `organizations/{orgId}.aiEnabled`と同じ割り切り)。
- 招待は**秘密トークン・リンクを発行しない**。招待された本人のGoogle認証済みメールアドレス自体が受諾の資格情報になる(メール送信基盤を持たないこのプロジェクトの既存方針=AIプロバイダ未選定と同じ「外部依存を増やさない」判断に合わせる)。

## アーキテクチャ

### 組織作成

新規Callable `createSchoolOrgCallable`(`functions/src/organizations/onCall.ts`に追加)。

- 認可: `ensurePersonalOrgCallable`と同一パターン。認証済み・`isCallerTeacher`確認済みの教師であれば誰でも呼べる(誰が学校組織を作れるかに追加制限はない)。
- 入力: `{name: string}`(空文字列は`invalid-argument`)。
- 処理: `ensurePersonalOrg`と同じFirestore+RTDBミラーの二段書き込みパターンを再利用し、新規`orgId`(ランダム生成)で`organizations/{orgId}`を`{type: 'school', name, verificationStatus: 'PENDING', ownerUid: uid, createdAt}`として作成、呼び出し元を`organizations/{orgId}/members/{uid}`に`{role: 'owner', status: 'active', membershipVersion: 1}`として追加し、RTDBミラー(`orgAccess`/`orgAccessMeta`)を書き込む。
- 個人組織のような「1人1つ」制約はない。呼ぶたびに新しい学校組織が作られるのが正しい動作であり、`ensurePersonalOrg`のような冪等性チェックは不要。

### 招待の発行

新規Callable `createInvitationCallable`(同ファイル)。

- 認可: `requireActiveOrgMember`で対象`orgId`のアクティブメンバーであることを確認したうえで、role が`'owner'`または`'admin'`であることを確認(`'teacher'`は招待できない)。
- 入力: `{orgId: string, email: string, role: 'admin' | 'teacher'}`。
- 処理: `email`を小文字正規化し、`organizations/{orgId}/invitations`に既存の同一`(email, status: 'PENDING')`の招待がないか確認する。あれば新規作成せずその招待を返す(重複招待の防止)。なければ`organizations/{orgId}/invitations/{invitationId}`に`{email, role, status: 'PENDING', invitedByUid, createdAt}`を作成する。

### 招待の一覧取得

新規Callable `listMyInvitationsCallable`(同ファイル)。

- 認可: 認証済み教師であること(組織メンバーである必要はない — まだメンバーでないからこそ招待を確認する)。
- 処理: `invitations`コレクショングループに対し、`email == caller.token.email(小文字化)`かつ`status == 'PENDING'`の招待を検索して返す。クライアントへの直接クエリ権限は付与しない(全データアクセスをAdmin SDK経由に統一する既存方針を踏襲)。

### 招待の受諾

新規Callable `acceptInvitationCallable`(同ファイル)。

- 認可: 認証済み教師であること。
- 入力: `{orgId: string, invitationId: string}`。
- 処理: 招待ドキュメントを読み、`status === 'PENDING'`かつ`invitation.email === caller.token.email(小文字化)`を確認する。いずれかを満たさない場合はエラー。対象組織に既にアクティブなメンバーとして存在する場合は、役割の意図しない上書きを避けるため`syncOrganizationMembershipChange`を呼ばず「既にメンバーです」を返す。それ以外の場合は`syncOrganizationMembershipChange`(既存・未使用のまま用意されていた関数、`functions/src/organizations/membershipSync.ts`)を`{orgId, uid, role: invitation.role, status: 'active', membershipVersion: 1, revokedAtSeconds: 0}`で呼び、メンバー追加とRTDBミラー同期を行う。最後に招待ドキュメントを`status: 'ACCEPTED'`に更新する。

### UI

- 学校組織の設定画面(新規、`src/components/teacher/organizations/`。既存の`TemplateRouteGuard`と同じ`useXxxAccess`ガードパターンで、対象組織のowner/adminのみアクセス可能): 組織名表示、招待メールアドレス+役割の入力フォーム、既存招待一覧(ステータス表示)。
- 教師のホーム画面: 「参加待ちの招待」バナー/一覧を追加し、`listMyInvitationsCallable`の結果から「参加する」ボタンで`acceptInvitationCallable`を呼ぶ。

## データフロー

```
[owner/admin: 学校組織作成画面] --組織名を入力--> createSchoolOrgCallable
  --> organizations/{orgId}(type:'school', verificationStatus:'PENDING') 作成
  --> organizations/{orgId}/members/{uid}(role:'owner', status:'active') 作成 + RTDBミラー書き込み

[owner/admin: 招待管理画面] --メールアドレス+役割(admin/teacher)を入力--> createInvitationCallable
  --> organizations/{orgId}/invitations/{invitationId}(status:'PENDING') 作成

[招待された教師: ホーム画面] --自動表示--> listMyInvitationsCallable(自分のtoken.emailと一致するPENDING招待を検索)
  --「参加する」ボタン--> acceptInvitationCallable
    --> invitation.email === caller.token.email(大小無視) を確認
    --> syncOrganizationMembershipChange(role: invitation.role, status:'active', membershipVersion:1)
    --> invitation.status を 'ACCEPTED' に更新
```

## エラー処理

- `createSchoolOrgCallable`: 組織名が空の場合`invalid-argument`。
- `createInvitationCallable`: 呼び出し元がowner/adminでない場合`permission-denied`。同一`(orgId, email)`のPENDING招待が既に存在する場合は新規作成せず既存の招待を返す。無効なメール形式(`@`を含まない等の最小限の形式チェック)は`invalid-argument`。
- `acceptInvitationCallable`: 招待が存在しない/`PENDING`でない場合は`failed-precondition`。`caller.token.email`が招待の`email`と一致しない場合は`permission-denied`(「あなた宛の招待ではありません」)。既に組織のアクティブメンバーの場合は`syncOrganizationMembershipChange`を呼ばず「既にメンバーです」を返す(役割の意図しない格下げ/格上げを防ぐ)。
- `listMyInvitationsCallable`: 認証エラーのみ。空配列を返すのは正常系(招待なし)。

## テスト方針

- `createSchoolOrgCallable`: `ensurePersonalOrgCallable.test.ts`と同じモック構成で、`type: 'school'`・`verificationStatus: 'PENDING'`での作成、メンバー`role: 'owner'`の付与、RTDBミラー書き込みを検証する。
- `createInvitationCallable`: owner/admin以外(role: 'teacher')からの呼び出し拒否、`requireActiveOrgMember`との連携、重複招待時に既存招待を返すことを検証する。
- `acceptInvitationCallable`: メール不一致拒否、`PENDING`以外の招待拒否、`syncOrganizationMembershipChange`が正しい引数(`role`は招待から、`status:'active'`)で呼ばれることを検証する(`syncOrganizationMembershipChange`自体は既存のテスト済み関数なのでモック化する)。既にアクティブメンバーの場合に`syncOrganizationMembershipChange`が呼ばれないことも検証する。
- `listMyInvitationsCallable`: 自分のメールアドレスに一致する`PENDING`招待のみ返すことを検証する。
- `firestore.rules`: `organizations/{orgId}/invitations/{invitationId}`への直接クライアント読み書きを禁止する(Callable経由のみ)ルールテストを追加する。
