# 招待失効+ロール変更 設計仕様

**日付:** 2026-08-15
**対象:** Phase 7(エンタープライズ管理者機能)サブプロジェクト1 — メンバーとライセンスの管理の残り2項目
**正本:** `docs/superpowers/specs/2026-08-05-lesson-platform-roadmap-design.md` Phase 7節。矛盾する場合は正本を優先し、本仕様側の誤りとして扱う。

## 背景・位置づけ

Phase 7の「メンバーとライセンスの管理」は、招待発行(`createInvitationWithAdminSdk`)・メンバー一覧(`listOrgMembersWithAdminSdk`)・メンバー削除/停止(`suspendOrgMemberWithAdminSdk`)・ライセンス上限表示(`getOrgPlanLimits`)がPhase 5の過程で既に実装済みだった。残るのは「招待の失効」と「ロール変更」の2つで、いずれも既存の設計が土台を用意している。

- 招待には秘密トークンを持たせない設計(メールアドレス一致が資格情報、`invitations.ts`冒頭コメント)。したがって「トークン失効」は`Invitation.status`を`PENDING`以外に変更するだけで完結する。
- `functions/src/organizations/membershipSync.ts`の`syncOrganizationMembershipChange`は「grant/suspend/role-changeの全経路が通る単一関数」として既に設計されており、コード内コメントに「将来role-changeを実装するタスクはこれを直接呼ぶこと」と明記されている。ロール変更専用の新しい同期ロジックを作る必要はない。

## アーキテクチャ

### 招待失効: `revokeInvitationCallable`

- 入力: `{ orgId: string; invitationId: string }`
- 認可: `requireActiveOrgMember`で対象`orgId`のアクティブメンバーであることを確認し、`role`が`owner`または`admin`であること(`suspendOrgMemberCallable`と同じパターン、`functions/src/organizations/onCall.ts:109-117`)。
- 検証: `organizations/{orgId}/invitations/{invitationId}`が存在し`status === 'PENDING'`であること。それ以外(`ACCEPTED`または既に`REVOKED`)は`failed-precondition`。
- 処理: `status`を`'REVOKED'`に更新。`Invitation`型(`functions/src/organizations/invitations.ts:15-23`)の`status`ユニオンに`'REVOKED'`を追加する。
- 副作用の確認: `listMyInvitationsWithAdminSdk`(同ファイル430-448行目)は`where('status', '==', 'PENDING')`でフィルタしているため、失効後は招待先の一覧から自動的に消える。`acceptInvitation`(146-201行目)は既に`invitation.status !== 'PENDING'`で例外を投げるため、失効済み招待の承諾試行は追加の変更なしで自動的に拒否される。

### ロール変更: `changeOrgMemberRoleCallable`

- 入力: `{ orgId: string; uid: string; newRole: 'owner' | 'admin' | 'teacher' }`
- 認可: `requireActiveOrgMember`で対象`orgId`のアクティブメンバーであることを確認し`role`が`owner`または`admin`。**現在の役割・新しい役割のいずれかが`owner`である場合(昇格・降格とも)は呼び出し元が`owner`であることを追加で要求**(`permission-denied`)。
- 検証:
  - 対象メンバーが存在し`status === 'active'`であること(`suspended`なら`failed-precondition`、先に復帰させる必要があるという運用判断。復帰機能自体は今回のスコープ外)。
  - 対象が現在`owner`で、かつ組織内のアクティブな`owner`が1人しかいない場合、`newRole !== 'owner'`への変更は拒否(`suspendOrgMember`の`countActiveOwners`チェックをそのまま再利用、`failed-precondition`、メッセージは既存の「組織には少なくとも1人のownerが必要です」を再利用)。
- 処理: `syncOrganizationMembershipChange`(`membershipSync.ts:37-44`)を`{ orgId, uid, role: newRole, status: 'active', membershipVersion: 現在値+1, revokedAtSeconds: 0 }`で呼ぶ。`updateFirestoreMembership`・RTDBミラーの`markMirrorPending`→`commitMirrorSynced`は既存関数がそのまま処理する(`suspendOrgMemberWithAdminSdk`の配線と同型のAdmin SDK配線を新規に書く)。

### UI

- `src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`は既に`invitations: Invitation[]`をpropsで受け取り一覧表示している(4・17・30・65-69行目)。各招待行に「失効」ボタンを追加し、`onRevokeInvitation(invitationId)`propを呼ぶ。
- 同ページの既存メンバー一覧(`members`)の各行に、ロール変更セレクト(owner/admin/teacher)を追加する。`owner`選択肢は、閲覧者(`viewerUid`の役割)が`owner`の場合のみ表示する(admin閲覧時は`owner`への変更・`owner`からの変更ができないため選択肢自体を隠す)。

## エラー処理

- owner/admin以外による失効・ロール変更呼び出し: `permission-denied`。
- adminによるowner関連(昇格・降格)のロール変更試行: `permission-denied`。
- 最後のownerを降格させる試行: `failed-precondition`。
- `PENDING`でない招待の失効試行: `failed-precondition`。
- `suspended`メンバーへのロール変更試行: `failed-precondition`。

## テスト方針

- `revokeInvitation`(純粋ロジック+AdminSdk配線): owner/admin以外は`permission-denied`、`PENDING`以外(`ACCEPTED`/`REVOKED`)は`failed-precondition`、成功時は`status`が`REVOKED`になることを検証。
- `changeOrgMemberRole`: 非owner/admin拒否、adminによるowner関連変更拒否、最後のowner降格拒否、`suspended`メンバー拒否、成功時に`membershipVersion`がインクリメントされ`syncOrganizationMembershipChange`が正しい`MembershipChange`で呼ばれることを検証(`suspendOrgMember.test.ts`の既存テストパターンを踏襲)。
- UI: `SchoolOrgSettingsPage`の失効ボタン・ロール変更セレクトの操作、`owner`選択肢の表示条件(閲覧者の役割による)を検証。
