# AI Lesson Studio 限定ベータアクセス設計

- 日付: 2026-08-15
- 対象: Phase 3 AI Lesson Studio ベータ「利用者を運営者許可アカウントに限定するアクセス制御」
- 正本仕様: `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md`
- スコープ台帳: `docs/superpowers/scope-backlog.md`
- 対象ブランチ: `codex/classroom`
- 状態: 設計承認済み

## 1. 背景と現状

Phase 3 のコアインフラ、授業案作成、資料アップロード、スライド生成、利用枠は実装済みである。一方、スコープ台帳には「利用者を運営者許可アカウントに限定するアクセス制御」が未着手項目として残っている。

現行コードには限定公開の一部がすでに存在する。

- `functions/src/ai/onCall.ts` に `aiBetaAccess/{teacherUid}` の存在確認を行う `assertAiBetaApproved` がある。
- `generateLessonDraftCallable` と `generateTeacherGuidanceCallable` は認証・教師判定の後に `assertAiBetaApproved` を呼ぶ。
- 同ファイルに operator 専用の `grantAiBetaAccessCallable` / `revokeAiBetaAccessCallable` があり、現状は `targetUid` を直接受け取って `aiBetaAccess/{uid}` を作成・削除する。
- `functions/src/index.ts` から上記 grant/revoke Callable は export 済みである。
- Firestore Rules では現状、教師本人が `aiBetaAccess/{自分のuid}` を直接 read できる。
- 教師側 UI は `aiEnabled` などの組織フラグを主に見ており、ベータ許可状態を表示条件として統一していない。そのため未許可ユーザーは AI 導線を操作した後、サーバーから `permission-denied` を受けるケースがある。

したがって本設計は「限定公開をゼロから新設する」のではなく、既存のサーバーゲートを正本化し、operator 運用 UI、本人 status API、監査、冪等性、Rules、全 AI 入口への適用を完成させる。

## 2. 決定事項

### 2.1 許可単位

AI ベータ利用権限は教師アカウント単位、すなわち Firebase Auth UID 単位とする。

組織単位の許可、学校単位の一括許可、operator 自動許可は行わない。operator も AI 機能を利用する場合は通常教師と同じ明示的な個人許可を必要とする。

### 2.2 operator の対象指定方法

operator は UID を直接入力しない。`/operator/ai-beta` で教師のメールアドレスを完全一致入力し、サーバー側 Firebase Admin Auth で対象ユーザーを解決して UID を確定する。

部分一致検索、全ユーザーディレクトリ、学校管理者による許可は今回の対象外とする。

### 2.3 教師側 UX

未許可教師に AI 導線を完全非表示にはしない。AI 機能の存在は表示しつつロック状態にし、限定ベータであり運営者許可が必要である旨を示す。

申請ボタンや自動申請ワークフローは今回作らない。

### 2.4 権限の正本

`aiBetaAccess/{uid}` を現在のベータ利用可否の唯一の正本とする。Firebase Auth custom claim には移さない。

理由は、Firestore の現在状態を毎回サーバー側で確認することで revoke を次回操作から即時反映でき、ID token refresh に依存しないためである。

## 3. データモデル

### 3.1 現在状態: `aiBetaAccess/{uid}`

最終モデルは grant 時に作成、revoke 時に削除する方式ではなく、状態を保持する方式とする。これにより取消済み状態を現在レコードでも明示でき、再許可時の遷移を安全に扱える。

```ts
interface AiBetaAccess {
  uid: string
  emailSnapshot: string
  status: 'APPROVED' | 'REVOKED'
  approvedAt: Timestamp
  approvedByUid: string
  revokedAt?: Timestamp
  revokedByUid?: string
}
```

認可判定はドキュメントの存在ではなく、必ず `status === 'APPROVED'` を条件とする。

`emailSnapshot` は operator UI と監査補助用の表示値であり、認可の正本には使用しない。メールアドレス変更後も UID に付与された許可は同一アカウントに継続する。

再 grant 時は `status` を `APPROVED` に戻し、`approvedAt` / `approvedByUid` / `emailSnapshot` を最新値へ更新し、`revokedAt` / `revokedByUid` を除去する。

### 3.2 監査: `aiBetaAccessEvents/{eventId}`

権限変更履歴は現在状態と分離したトップレベルの追記専用コレクションへ保存する。

```ts
type AiBetaAccessEventAction = 'GRANTED' | 'REVOKED'

interface AiBetaAccessEvent {
  eventId: string
  action: AiBetaAccessEventAction
  actorUid: string
  targetUid: string
  targetEmailSnapshot: string
  reason: string
  idempotencyKey: string
  occurredAt: Timestamp
}
```

現在状態を revoke しても event は削除しない。組織単位の `organizations/{orgId}/auditLog` は利用しない。AI ベータ許可は組織ではなくプラットフォーム上の教師 UID に対する権限変更だからである。

### 3.3 冪等性: `aiBetaAccessIdempotency/{key}`

operator mutation はクライアント再送に耐えるため `idempotencyKey` を必須とする。

```ts
interface AiBetaAccessIdempotencyRecord {
  key: string
  action: 'GRANT' | 'REVOKE'
  actorUid: string
  requestDigest: string
  targetUid: string
  changed: boolean
  createdAt: Timestamp
}
```

同一 key + 同一 payload は既存結果を返す。同一 key + 異なる payload は `failed-precondition` とする。

現在状態変更、監査 event 追加、idempotency result 保存は同一 Firestore transaction で確定させ、部分成功を許さない。

## 4. サーバー API

### 4.1 共通認可 helper

現行 `assertAiBetaApproved` は「ドキュメントが存在するか」の確認から、`status === 'APPROVED'` を確認する共通 helper へ変更する。

すべての保護対象 AI Callable は原則次の順序とする。

```text
auth
→ teacher identity
→ AI beta approval
→ scalar request validation
→ organization read
→ organization feature flag
→ quota / kill switch
→ dependent resource reads
→ AI processing
```

未許可ユーザーについて、組織・利用枠・教材などの dependent read より前に拒否する。

### 4.2 `getMyAiBetaAccessCallable`

新規。教師本人が自分のベータ状態を取得する唯一のクライアント API とする。

```ts
interface GetMyAiBetaAccessResult {
  approved: boolean
}
```

処理順:

```text
auth
→ teacher identity
→ aiBetaAccess/{request.auth.uid} read
→ status === APPROVED を boolean 化
→ { approved }
```

operator UID、許可者 UID、監査情報などは教師へ返さない。

### 4.3 `listAiBetaAccessCallable`

新規。operator 専用で現在 `APPROVED` の教師だけを一覧取得する。

```ts
interface AiBetaAccessListItem {
  teacherUid: string
  email: string
  approvedByUid: string
  approvedAtMillis: number
}
```

Firestore Timestamp をクライアント契約へ直接露出させず、表示用には milliseconds を返す。

### 4.4 `grantAiBetaAccessCallable`

既存の `{ targetUid }` 契約は廃止し、次の契約へ置換する。UID 直接 grant 経路は残さない。

```ts
interface GrantAiBetaAccessRequest {
  email: string
  reason: string
  idempotencyKey: string
}

interface GrantAiBetaAccessResult {
  changed: boolean
  teacherUid: string
}
```

処理順:

```text
auth
→ operator identity
→ email / reason / idempotencyKey scalar validation
→ email trim + lowercase normalization
→ Firebase Admin Auth getUserByEmail
→ emailVerified 確認
→ providerData に google.com があることを確認
→ target UID 確定
→ idempotency check
→ Firestore transaction
    → aiBetaAccess/{uid} read
    → 必要なら APPROVED へ遷移
    → 状態が変わる場合だけ GRANTED event 追加
    → idempotency result 保存
→ result
```

既に `APPROVED` の対象を新しい idempotency key で再 grant した場合は `{ changed: false }` とし、新しい `GRANTED` event は作らない。

### 4.5 `revokeAiBetaAccessCallable`

operator 一覧から選択した UID を対象とする。メール再入力は要求しない。

```ts
interface RevokeAiBetaAccessRequest {
  teacherUid: string
  reason: string
  idempotencyKey: string
}

interface RevokeAiBetaAccessResult {
  changed: boolean
  teacherUid: string
}
```

処理順:

```text
auth
→ operator identity
→ teacherUid / reason / idempotencyKey scalar validation
→ idempotency check
→ Firestore transaction
    → aiBetaAccess/{uid} read
    → APPROVED なら REVOKED へ遷移
    → 状態が変わる場合だけ REVOKED event 追加
    → idempotency result 保存
→ result
```

既に `REVOKED` または未作成の対象を revoke した場合は `{ changed: false }` とし、監査 event は重複生成しない。

## 5. operator UI

新規ルート `/operator/ai-beta` を追加する。

既存の通報審査・教材認定と同様に operator 専用画面として分離し、他の operator 業務へ混在させない。

画面は最低限次を持つ。

```text
AIベータアクセス管理

[教師メールアドレス]
[許可理由]
[ベータ利用を許可]

許可済み教師
------------------------------------------------
teacher@example.jp
許可日時: ...
許可者: ...
[利用許可を取り消す]
------------------------------------------------
```

grant の理由は必須とする。revoke は確認 UI を出し、取消理由を必須とする。

成功後は一覧を再取得し、サーバー状態を再表示する。

React 側の route guard は UX 境界に留める。通常教師が URL を直接開いた場合も、`listAiBetaAccessCallable` が operator claim を検証して `permission-denied` とし、画面側は「この画面は運営者のみ利用できます」と表示する。

## 6. 教師 UI

教師画面は `getMyAiBetaAccessCallable` を使い、AI 表示状態を最低限次の4状態として扱う。

```ts
type AiBetaUiState =
  | 'LOADING'
  | 'APPROVED'
  | 'LOCKED'
  | 'ERROR'
```

未許可時は AI 導線を削除せずロック表示する。

表示例:

```text
AI提案（限定ベータ）
現在この機能は限定公開です。
利用には運営者による許可が必要です。
```

クライアント status は UX のためだけに使用する。セキュリティ境界は各 Callable 側の共通 beta approval check である。

`aiEnabled`、`materialsUploadEnabled`、quota、kill switch は既存どおり別条件として残す。

したがって利用可能条件は概念上次の AND になる。

```text
teacher identity
AND aiBetaAccess.status === APPROVED
AND organization.aiEnabled === true
AND feature-specific organization flag
AND quota / kill switch allows execution
```

## 7. revoke の意味

revoke 後は次の AI Callable 呼び出しから拒否する。

- 現在実行中の1回の Callable を途中キャンセルしない。
- 次回 AI 操作は `permission-denied`。
- 画面再取得後は `LOCKED`。
- 既に生成済み・保存済みの LessonTemplate、LessonVersion、生成結果は削除しない。

アクセス取消と教材データ保持を別責務として扱う。

## 8. Firestore Rules

次のトップレベル領域はすべてクライアント直接 read/write を禁止する。

```text
aiBetaAccess
aiBetaAccessEvents
aiBetaAccessIdempotency
```

教師本人も `aiBetaAccess/{自分のuid}` を直接 read しない。operator もクライアント SDK から直接 read/write しない。すべて Admin SDK を使用する Callable 経由に統一する。

Rules テストでは最低限次を確認する。

```text
teacher direct get  -> DENY
operator direct get -> DENY
teacher direct write -> DENY
operator direct write -> DENY
```

## 9. 保護対象 AI 入口

実装時には `functions/src/index.ts` と AI 関連モジュールを再確認し、AI Lesson Studio および AI 向け資料処理に該当する exported Callable を全列挙する。

`generateLessonDraftCallable` と `generateTeacherGuidanceCallable` だけを直して完了とはしない。資料アップロード・資料処理・スライド生成など、別 Callable / 別入口が存在する場合も、保護対象に分類されたものは共通 beta approval check を通す。

「別 URL / 別 Callable から未許可ユーザーが AI 系機能へ到達できる」状態は受け入れ不可とする。

## 10. エラー契約

既存のエラー意味を保ち、ベータ未許可を他の失敗理由と混同しない。

```text
unauthenticated
  サインインしていない

permission-denied
  教師でない
  operator 専用 API を非 operator が呼んだ
  AI ベータ未許可

invalid-argument
  scalar 入力不正

not-found
  grant 対象メールに対応する Auth user が存在しない

failed-precondition
  idempotency key 衝突
  組織で AI 無効
  資料機能が無効
  grant 対象が教師アカウント条件を満たさない

resource-exhausted
  AI 利用枠超過

unavailable
  kill switch
  AI 生成処理失敗
```

## 11. テスト戦略

### 11.1 Callable 認可

- unauthenticated を拒否する。
- 非教師を拒否する。
- AI ベータ未許可教師を dependent read より前に拒否する。
- `APPROVED` の教師を許可する。
- `REVOKED` の教師を拒否する。
- operator も個人許可がなければ通常 AI 利用を拒否する。
- `aiEnabled=false` は個人許可済みでも拒否する。
- feature-specific flag、quota、kill switch の既存挙動を維持する。

### 11.2 grant

- 有効な Google 教師メールを許可できる。
- メール不存在を拒否する。
- email 未確認を拒否する。
- Google provider 条件を満たさない対象を拒否する。
- 非 operator を拒否する。
- UID 直接 grant 契約が残らない。
- 既に APPROVED の対象は `changed: false`。
- REVOKED から再 grant すると APPROVED になり、新しい GRANTED event を1件だけ残す。

### 11.3 revoke

- APPROVED から REVOKED へ遷移する。
- REVOKED 済みの再 revoke は `changed: false`。
- revoke 後の次回 AI Callable を拒否する。
- 既存生成教材は削除しない。

### 11.4 冪等性と監査

- 同一 key + 同一 payload は同じ結果を返す。
- 同一 key + 異なる payload は `failed-precondition`。
- ネットワーク再送で event が二重生成されない。
- 状態変更と event 追加の片方だけが成功しない。
- 状態が変わらない操作では event を追加しない。

### 11.5 UI

- LOADING 中の一時的な AI 有効化をしない。
- APPROVED なら既存 AI 操作が可能。
- LOCKED なら AI 操作を無効化し限定公開案内を表示する。
- ERROR は APPROVED とみなさず、安全側へ倒す。
- `/operator/ai-beta` で grant/list/revoke が動作する。
- 非 operator の直 URL アクセスを server-authoritative に拒否する。

### 11.6 Rules

`aiBetaAccess`、`aiBetaAccessEvents`、`aiBetaAccessIdempotency` の client read/write が教師・operator とも拒否されることを emulator テストする。

## 12. 受け入れ条件

1. 未許可教師は AI 画面でロック表示になる。
2. 未許可教師が Callable を直接呼んでも `permission-denied` になる。
3. URL 直打ちや別 AI 入口で許可を迂回できない。
4. `aiEnabled=true` の組織でも個人許可がなければ利用できない。
5. `aiEnabled=false` なら個人許可済みでも利用できない。
6. operator も個人許可がなければ AI を利用できない。
7. operator はメール完全一致で教師を許可できる。
8. UID 直接 grant 経路が残らない。
9. operator だけが許可済み教師一覧を取得できる。
10. grant/revoke に必須理由と追記専用監査履歴が残る。
11. revoke 後、次回 AI 操作から拒否される。
12. 再送しても状態変更・監査履歴が二重にならない。
13. 教師/operator とも Firestore からアクセス管理データを直接読めない。
14. すべての保護対象 AI Callable に同じベータゲートが適用される。
15. 既存 quota、kill switch、`aiEnabled`、`materialsUploadEnabled` の挙動を壊さない。
16. Social Studies / Home Economics 双方の既存 AI 導線で同じアクセス制御になる。

## 13. 今回の非対象

- ベータ利用申請ワークフロー
- 招待メール送信
- 組織単位・学校単位の一括許可
- 学校管理者による許可
- メール部分一致検索
- 全ユーザーディレクトリ
- 利用期限付き許可
- 教師ごとの AI 利用上限
- AI プロバイダ選定・接続
- AI 生成ジョブの途中キャンセル
- 監査履歴閲覧専用 UI
- revoke 時の既存生成教材削除
- Phase 3 backlog に別項目として残る追加 AI 機能の実装

## 14. 実装時の注意

- 既存 `grantAiBetaAccessCallable` / `revokeAiBetaAccessCallable` は partial implementation であり、そのまま足し算しない。今回の契約へ一本化する。
- 現行 `assertAiBetaApproved` はドキュメント存在だけを見ているため、`REVOKED` レコードを導入する時点で必ず `status === 'APPROVED'` 判定へ同時変更する。片方だけ先行すると revoke 済み教師を誤許可する。
- auth / teacher / operator 判定は dependent read より前に行う。
- client route guard やロック表示をセキュリティ境界にしない。
- grant/revoke の状態変更、event、idempotency result は transaction で一体化する。
- 監査 event は access レコードの内側や組織配下へ置かず、revoke 後も残るトップレベルコレクションにする。
- 実装着手前に exported AI Callable を再列挙し、保護対象一覧をテストへ固定する。
