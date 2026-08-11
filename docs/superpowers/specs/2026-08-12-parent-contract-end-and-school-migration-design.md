# 上位契約終了時のデータ保持・学校単独契約移行 設計仕様

**日付:** 2026-08-12  
**対象:** Phase F（組織・契約）のサブプロジェクト11 — §19.4 契約終了  
**正本:** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md` §19.4。本仕様は、§19.4の「上位契約終了後も学校データを保持」「学校単独契約へ移行可能」「即時削除しない」を実装可能な状態遷移に具体化する。§19.3については `2026-08-11-parent-org-quota-allocation-design.md` が優先し、本仕様はその終了時の扱いだけを追加する。Stripeイベントの署名検証・Customer ID逆引き・再送方針は `2026-08-10-stripe-webhook-ordering-and-customer-reuse-design.md` を継承する。

## 背景・スコープ

上位組織は `PARENT_ORG` の契約枠を子学校に配分できる。しかし契約が終了しても、学校のLessonRun、教師、生徒、教材、結果、個別の請求履歴は学校が所有し続ける。親の削除、子学校の自動削除、既存授業の停止は行わない。

本サブプロジェクトは、次を実装する。

- Stripeの上位契約が実際に終了したことを、子学校を変更せず親組織へ記録する。
- 終了済み親契約の共有枠を新規に予約・再配分・学校追加できないようにする。
- 学校自身のStripe契約が有効になった後、学校のowner/adminが明示的に親から独立できるようにする。
- 独立処理で親由来の配分・共有予約だけを安全に掃除し、学校データを保持する。
- 親・学校双方に状態と次の操作を表示する。

対象外:

- 親組織や学校組織、LessonRun、メンバー、教材、生徒データの削除。
- 上位組織契約をアプリ内で新規購入・変更する画面。既存のStripe Dashboard運用を維持する。
- 未実装5軸の利用量計測・配分・移行。
- 請求書払い、振込、手動請求への移行フロー。

## 契約状態とStripe同期

### 保存状態

親組織だけに次を保存する。旧データとの互換性のため、フィールドが無い親組織は `ACTIVE` とみなす。

```ts
type ParentContractState = 'ACTIVE' | 'ENDED'

organizations/{parentOrgId} = {
  parentContractState?: ParentContractState
  parentContractEndedAt?: Timestamp
  parentContractSubscriptionId?: string
  parentContractEventCreatedAtMillis?: number
}
```

学校自身の有効契約確認には、既存の `subscriptionStatus` を単独の正本にしない。`invoice.paid` は配信順序が保証されず、解約後に遅延到着する可能性があるためである。`customer.subscription.updated` から取得するSubscription ID・status・Stripe Eventの作成時刻を組織に保存し、学校移行には **同一IDの最新状態が `active`** であることを要求する。

```ts
organizations/{orgId} = {
  stripeSubscriptionState?: {
    subscriptionId: string
    status: string
    eventCreatedAtMillis: number
  }
}
```

この状態は `customer.subscription.updated` と `customer.subscription.deleted` でのみ更新する。古いStripe Event（`event.created` が保存値以下）は無視する。`customer.subscription.deleted` は対象Subscriptionを `canceled` として保存し、親組織であれば同じ比較条件で `parentContractState: 'ENDED'` と終了日時を設定する。新しい有効なSubscriptionの更新だけが `ENDED` を `ACTIVE` へ戻せる。

`invoice.paid` / `invoice.payment_failed` の既存の請求記録・`subscriptionStatus` 更新は維持するが、親契約終了状態および学校移行可否を変更しない。この分離により、順不同の請求イベントで終了済みの親枠が復活しない。

Customer ID逆引き不能時は、既存仕様どおり更新系イベントでHTTP 503を返しStripeの再送に委ねる。署名検証失敗は400、未知Priceなど再送しても直らない不整合は構造化ログを残して200とする。秘密情報は既存どおり `STRIPE_SECRET_KEY` と `STRIPE_WEBHOOK_SECRET` をSecret Managerから読む。

## 終了中の利用制御

`parentContractState === 'ENDED'` の間、次を拒否する。

- `setSchoolQuotaAllocationCallable` による最低保証の変更。
- `linkSchoolToParentOrgCallable` による学校追加。
- LessonRun作成と教師招待受諾で必要になる、親の共有枠の新規予約。

既存の共有予約、既存LessonRun、既存教師は終了Webhookでは変更しない。進行中LessonRunの状態遷移、完了、閲覧、結果確認、教師解除も許可する。学校は既存の学校プラン上限・ダウングレード制限の範囲で運用を継続できるが、親契約由来の追加共有枠は使えない。

親の利用枠DTOと学校の実効利用枠DTOには `parentContractState` を追加する。終了中の学校画面では親由来の「実効利用可能」を新規利用可能枠として表示せず、親契約終了と単独契約移行が必要なことを表示する。これにより、終了済みの共有枠を使えるように見せない。

## 学校単独契約への移行

### 認可と前提条件

新規 `migrateSchoolFromEndedParentCallable({ schoolOrgId })` は、対象学校のactiveなowner/adminだけが呼べる。親組織の権限は不要である。処理開始時に以下を検証する。

1. 学校が存在し、現在も対象親の直下である。
2. 親が `ENDED` である。
3. 学校の `stripeSubscriptionState.status === 'active'` である。

満たさない場合は `failed-precondition`、学校メンバーでない呼出者は `permission-denied` とする。学校の単独契約は既存の学校向けStripe Checkoutを使って開始し、Checkout完了画面や `invoice.paid` だけでは移行を確定しない。Stripe Subscriptionの最新 `active` 状態がWebhookで保存された後だけ、ボタンを有効にする。

### 再実行可能な移行フロー

親の共有予約は学校ごとの決定的IDであり、終了中には新規作成できない。このため、予約削除と親子解除を分けても競合で予約を取りこぼさない。

```text
[学校 owner/admin]
  -> migrateSchoolFromEndedParentCallable
  -> 親ENDED・学校Subscription active・現在のparentOrgIdを確認
  -> 親のquotaReservationsを schoolOrgId でページングして削除
       （途中失敗時は親子関係を残し、同じCallableの再実行で継続）
  -> Firestore transaction
       -> 学校が同じ親の直下、親がENDED、対象学校の予約数0を全て読む
       -> organizations/{schoolId}.parentOrgId を null に更新
       -> 親のschoolAllocations/{schoolId} を削除
       -> 学校のparentContractMigrations/{parentId} に監査記録を作成
```

予約削除は1トランザクションに無制限の削除を詰め込まない。ページ単位のAdmin SDKバッチ削除を成功ごとに確定し、失敗時は残った予約から再開する。最終トランザクションは予約数0を再確認してから親子関係だけを変える。親が再契約して `ACTIVE` に戻った、学校の親が変わった、または新規予約が再開した場合は解除を中止し、状態を再確認する。

監査記録は移行判断だけに使い、個票を複製しない。

```ts
organizations/{schoolOrgId}/parentContractMigrations/{parentOrgId} = {
  parentOrgId: string
  migratedByUid: string
  migratedAt: Timestamp
  schoolSubscriptionId: string
}
```

この処理で削除するのは親の `schoolAllocations` と `quotaReservations` だけである。学校自身の組織ドキュメント、サブコレクション、Stripe顧客ID・請求履歴、RTDB権限ミラーは維持する。

## UI

`ParentOrgSettingsPage` は終了中の親に契約終了・学校の単独契約移行待ちを表示する。学校追加と配分保存は無効化し、既存の学校・利用状況は表示を維持する。

学校の `PlanLimitsPage` は、親が終了中なら次を表示する。

- 親契約が終了しており、データと既存授業は保持されていること。
- 学校単独のStripe Checkout導線。
- 最新Subscriptionが `active` になるまで無効な移行ボタンと、その理由。
- `active` 後にだけ有効な「単独契約へ移行」ボタン。

学校のowner/adminだけがCheckoutと移行を実行できる。一般教師には状態を表示するが、契約・移行操作は表示しない。移行が成功したら親契約表示を取り除き、既存の学校単独プラン画面へ戻す。

## エラー、整合性、テスト

- 終了済み親での共有予約・学校追加・配分変更は `failed-precondition`。既存授業を止めるエラーにはしない。
- 共有枠不足は従来どおり `resource-exhausted`。
- すべてのFirestoreトランザクションは読み取りを完了してから書き込む。新規Callableは `functions/src/index.ts` からexportする。
- Functionsは `src/` をimportせず、クライアントDTOは手動でミラーする。

テストでは少なくとも次を検証する。

1. 親の `customer.subscription.deleted` が子学校のデータ、親子関係、既存LessonRunを変更せず、終了状態だけを冪等に記録すること。
2. 古い `invoice.paid` や古いSubscriptionイベントで終了状態が巻き戻らないこと。新しい有効Subscriptionだけが復帰させること。
3. 終了中の親で共有予約、学校追加、配分変更を拒否し、既存LessonRunの完了と教師解除を許可すること。
4. 学校契約が未有効、親未終了、権限不足、親変更競合を移行前に拒否すること。
5. 予約削除の途中失敗後に再実行でき、予約0の最終確認後だけ配分削除・親子解除・監査記録作成を行うこと。
6. 親・学校のDTOが終了状態を返すが、親が学校の生徒個票やLessonRun内容を取得しないこと。
7. 親・学校画面で終了案内、権限別操作、移行可能条件、成功後の表示を検証すること。

## 受け入れ条件

- 上位契約終了後も、全ての学校データと進行中LessonRunが保持される。
- 終了した親の共有枠を新規に消費・配分・拡張できない。
- 学校の単独Stripe Subscriptionが最新状態で `active` になった後、学校owner/adminは再実行可能な操作で親から独立できる。
- 独立後、親の配分・予約だけが取り除かれ、学校の教師、生徒、教材、結果、請求履歴、RTDBアクセスは残る。
- 終了状態・移行状態は親と学校の画面で誤解なく確認できる。
