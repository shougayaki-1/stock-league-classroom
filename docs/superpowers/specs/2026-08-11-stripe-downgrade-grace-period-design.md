# Stripeダウングレード・整理猶予 設計仕様

**日付:** 2026-08-11  
**対象:** Phase F（組織・契約）のサブプロジェクト9 — §18.7 ダウングレード  
**正本:** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md` §18.7。§18.7の抽象要件を実装可能な振る舞いに具体化する本仕様を優先する。Stripe契約状態・Customer Portal・Webhookの前提は `docs/superpowers/specs/2026-08-09-stripe-subscription-lifecycle-design.md` および `docs/superpowers/specs/2026-08-10-stripe-webhook-ordering-and-customer-reuse-design.md` とする。本仕様とそれらが矛盾する場合は、本仕様を優先する。

## 背景・スコープ

統合仕様書 §18.7 は、ダウングレードにおいて「実施中授業を止めない」「猶予期間」「超過データを即削除しない」「読み取り専用状態」「何を整理すべきか表示」を求める。既存実装はプラン定義と、同時授業・市場数の作成時予約、教師席管理、Stripe Checkout・Customer Portal・契約ライフサイクルWebhookを備えるが、下位プランへの移行に伴う超過の扱いは未定義である。

本サブプロジェクトは、**Stripe Customer Portalを唯一のダウングレード申請経路**として、請求期間末のプラン適用、適用後30日間の整理猶予、超過した資源だけを増やす操作の制限、利用者への整理対象表示を実装する。

今回完全対応する資源は次の2軸だけである。

- 同時授業・市場数 (`concurrentLessonsAndMarkets`)
- 教師席 (`teacherSeats`)

`participants`、`aiCredits`、`templateStorage`、`resultRetentionDays`、`eventExtraCapacity` は、後から同一の違反表現へ追加できる境界を作るが、今回の利用量集計・強制対象には含めない。

対象外:

- アプリ内の独自プラン変更UIおよびStripe Subscription Scheduleの直接操作
- 上位組織による枠配分（§19.3）
- 上位組織の契約終了時の保持・単独契約移行（§19.4）
- 超過データ・メンバー・LessonRunの自動削除または自動停止
- 未実装5軸の利用量記録・強制

## Stripe Customer Portalの運用前提

Stripe Dashboard（テストモード）でCustomer Portalの次を有効化する。

- **Switch plan** を有効化する。
- **Manage downgrades** を有効化し、ダウングレードを請求期間末に適用する。
- ダウングレード可能なPriceは同一Stripe Productに属するようにする。

この設定では、Customer Portalが下位プランへの変更をSubscription Scheduleとして予約する。アプリはそのScheduleを作成・変更しない。アプリのStripe APIアクセスは、WebhookでSubscription/Scheduleを検証・同期する読み取りに限る。Portalでの予約取消または上位プランへの再変更も、`customer.subscription.updated`を正本イベントとして同期する。

## アーキテクチャとデータフロー

```text
[owner/admin: Customer Portal]
  -> Stripe Subscription Schedule（期間末への下位Price変更を予約）
  -> customer.subscription.updated
  -> stripeWebhookCallable
       -> customerIdをorgIdへ逆引き
       -> Subscription/Scheduleを読む
       -> organizations/{orgId}.pendingPlanChange を保存

[請求期間末]
  -> Stripeが下位Priceを現在のSubscription itemへ適用
  -> customer.subscription.updated / invoice.paid
  -> stripeWebhookCallable
       -> organizations/{orgId}.planId を下位プランへ確定
       -> organizations/{orgId}.downgradeGrace を { startedAt, endsAt } として保存

[利用枠画面または保護操作]
  -> 現在時刻、downgradeGrace、新planの上限、実利用量から状態を導出
  -> SCHEDULED / NORMAL / GRACE / RESTRICTED と違反一覧を返す
```

既存の `planId` は、下位PriceがStripe Subscriptionの**現在**Priceになった時だけ更新する。予約中は既存プランを有効な契約・利用枠として維持する。これにより、請求期間の途中で旧プランの枠が縮むことはない。

## 組織データ

`organizations/{orgId}` に以下を追加する。日時は既存のFirestore書き込みと同じサーバー時刻形式を用いる。

```ts
pendingPlanChange?: {
  planId: string
  stripeSubscriptionId: string
  stripeScheduleId: string
  effectiveAt: Timestamp
}

downgradeGrace?: {
  planId: string
  startedAt: Timestamp
  endsAt: Timestamp // startedAt の30日後
}
```

`pendingPlanChange` は、Scheduleに将来の下位Priceがある間だけ保存する。予約が取消された、Scheduleが外れた、または現在Priceが上位Priceへ変更された場合は削除する。

`downgradeGrace` は、新しい下位Priceが現行Subscriptionに反映された時に作成する。上位プランへの変更または超過の解消後も履歴用途で保持する必要はないため、状態計算で不要と判定された時点で削除してよい。後述の判定状態そのものをFirestoreへ保存しないため、期限到達だけを処理するcronは不要である。

## Stripe Webhook同期

### `customer.subscription.updated`

Webhookは既存のCustomer ID逆引き (`stripeCustomers/{stripeCustomerId}`) を使用する。逆引き不能または逆引き読取例外では、更新系イベントの既存方針どおり503を返し、Stripeの自動再送に委ねる。

逆引き成功後は以下を行う。

1. Subscriptionの現在Priceを `planDefinitions.stripePriceId` に照合する。
2. SubscriptionにScheduleがある場合はScheduleを取得し、将来フェーズの下位Priceと有効化予定時刻を照合する。
3. 将来の下位Priceが存在し、現在Priceがまだ旧プランなら `pendingPlanChange` を保存する。
4. 現在Priceが**保存済み `pendingPlanChange.planId` と同じ**下位プランのPriceになったら、Firestoreトランザクションで `planId` を更新し、`pendingPlanChange` を削除し、`downgradeGrace` の `startedAt` と30日後の `endsAt` を保存する。予約がないSubscription更新はプラン確定の契機にしない。
5. 予約取消、Schedule消滅、または現在Priceが上位プランに戻ったことを検出したら、対応する `pendingPlanChange` を削除する。

同じWebhookが再送されても、既に同じ `planId` と猶予開始時刻が保存されている場合は再作成せず、`endsAt` を延長しない。全てのFirestoreトランザクションは、読み取りを完了してから書き込む。

未知のPrice、Subscriptionに複数の対象Priceがある、Scheduleの将来フェーズを一意に決められない、といった恒久的な不整合は構造化ログに記録して200を返す。`planId`・猶予情報には変更を加えない。署名検証失敗は既存どおり400とする。

`invoice.paid` は既存の契約状態・請求記録の処理を維持する。プラン確定の正本はPrice/Scheduleを含む `customer.subscription.updated` であり、`invoice.paid` 単独では `planId` を変更しない。これにより、初回Checkout、通常更新、上位プラン変更など、保存済みのダウングレード予約を伴わないイベントが誤って猶予を開始することを防ぐ。

## 利用量・状態導出

利用量と超過は次の共通形で表す。

```ts
type LimitViolation = {
  key: 'concurrentLessonsAndMarkets' | 'teacherSeats'
  label: string
  used: number
  limit: number
}

type DowngradeEnforcementState =
  | 'SCHEDULED'
  | 'NORMAL'
  | 'GRACE'
  | 'RESTRICTED'
```

- 同時授業・市場数の `used` は `ACTIVE_LESSON_RUN_STATUSES` に属するLessonRun数とする。`COMPLETED`、`ABORTED`、`ARCHIVED` は数えない。
- 教師席の `used` は `organizations/{orgId}/members` で `status == 'active'` かつ `role == 'teacher'` の人数とする。`owner` と `admin` は教師席を消費しない。

状態は次の優先順位で導出する。

1. `pendingPlanChange` があれば `SCHEDULED`。
2. 現プランの対象2軸に超過がなければ `NORMAL`。
3. 超過があり、`downgradeGrace.endsAt` より前なら `GRACE`。
4. 超過があり、同時刻以後なら `RESTRICTED`。

この状態は組織全体の案内に用いる。一方、操作可否は**資源軸ごと**に決める。教師席だけが超過していても、同時授業・市場数に余裕がある限り新規LessonRunは許可する。反対の場合も同様である。

## 制限と継続利用

猶予中 (`GRACE`) は、全ての既存操作を許可する。猶予終了後、違反中の資源を増やす操作だけを拒否する。

| 操作 | 対象軸 | `RESTRICTED` 中の扱い |
| --- | --- | --- |
| 新規LessonRun作成 | 同時授業・市場数 | 現在数が新プラン上限以上なら拒否。上限未満なら許可。 |
| 教師招待の受諾（教師ロール） | 教師席 | activeな教師数が新プラン上限以上なら拒否。 |
| 既存LessonRunの開始・中断・再開・完了・閲覧・結果確認・エクスポート | なし | 常に許可。進行中授業を止めない。 |
| 教師の解除、owner/adminの操作 | なし | 常に許可。超過解消を妨げない。 |

招待作成時ではなく、実際に教師席を消費する招待受諾時に教師席を検査する。招待自体は席を消費しないためである。将来、教師ロール変更を実装する場合も、teacherへ昇格する遷移に同じ検査を適用する。

超過したLessonRun、メンバー、教材、結果を自動削除・自動停止・自動非公開にはしない。これは §18.7 の「超過データは即削除しない」と、進行中授業を止めない要件を満たす。

## 利用枠画面

既存 `getOrgPlanLimitsCallable` を拡張し、現在プランの `PlanLimits` と以下のダウングレード状況を返す。認可は既存どおりactiveな組織メンバーに限る。Firestoreに保存する日時はTimestampのままとし、Callableの応答ではクライアント境界にAdmin SDK型を持ち込まないようUnix epochミリ秒へ変換する。

```ts
type DowngradeStatus = {
  state: DowngradeEnforcementState
  pendingPlanChange?: { planId: string; effectiveAtMillis: number }
  graceEndsAtMillis?: number
  violations: LimitViolation[]
}
```

`PlanLimitsPage` は既存の上限表を維持し、次を追加表示する。

- `SCHEDULED`: 変更後プランと有効化予定日時
- `GRACE`: 残日数、各違反の `used / limit`、整理を求める案内
- `RESTRICTED`: 各違反と、増加操作が停止中である説明
- `NORMAL`: 追加の警告を表示しない

既存の「支払い方法の変更・解約」ボタンはCustomer Portalへの唯一の入口として維持する。Stripe Customer Portal内でプラン変更できることを説明し、アプリ内には重複したダウングレード申請UIを作らない。

## エラー処理・認可

- `customer.subscription.updated` のCustomer ID逆引き失敗・読取例外: HTTP 503。Stripeの再送に委ねる。
- Webhookの未知Price・不正または曖昧なSchedule: ログを残してHTTP 200。プランと猶予情報を変更しない。
- 新規LessonRunが同時授業・市場数の違反を増やす: `resource-exhausted` と、既存上限エラーと区別可能な説明を返す。
- 教師招待受諾が教師席の違反を増やす: `resource-exhausted` と、整理が必要な旨の説明を返す。
- 利用枠・状態取得の読取失敗: 通常のエラーとして返し、上限なしへフォールバックしない。
- `getOrgPlanLimitsCallable`、Customer Portal、Webhook、招待受諾の認可境界は既存のowner/admin・active member・教師本人の境界を緩めない。

## テスト方針

### 純粋関数

- 下位Priceの予約検知、請求期間末での確定、予約取消、上位プランへの再変更。
- 30日猶予の開始時刻、終了直前、終了時刻ちょうどの `SCHEDULED` / `NORMAL` / `GRACE` / `RESTRICTED` 導出。
- active LessonRun数とactive teacher数からの違反一覧。
- 同一Webhook再送で猶予終了日時を延長しないこと。

### Webhook・Firestore

- `customer.subscription.updated` がCustomer Portal由来のSubscription Scheduleを同期すること。
- Customer ID逆引き不能時の503、未知Price・不正Schedule時の200、既存イベントのHTTP応答を維持すること。
- プラン確定トランザクションが読み取り後に書き込み、重複イベントにも冪等であること。
- `invoice.paid` が既存の請求・状態処理を続け、単独で `planId` を変えないこと。

### 保護操作・UI

- 猶予中は新規LessonRunと教師招待受諾を許可すること。
- 猶予後は、超過した同時授業・市場数だけがLessonRun作成を拒否し、超過した教師席だけが教師招待受諾を拒否すること。
- 制限状態でも進行中LessonRunの状態遷移・完了・閲覧を妨げないこと。
- `PlanLimitsPage` が予約、猶予期限、違反 `used / limit`、制限理由を表示すること。
- 新規Callableを追加した場合は `functions/src/index.ts` からexportすること。Webhookで使用する全`defineSecret`は `secrets` に列挙され続けること。

## 受け入れ条件

- Customer Portalで下位プランを選ぶと、請求期間末まで旧プランの枠を保った予約状態が表示される。
- 請求期間末に下位プランが有効になると、その時点から30日間だけ整理猶予が始まる。
- 猶予中は超過していても既存運用と同じ操作ができ、データは削除されない。
- 猶予終了後は、超過している資源を増やす操作だけが止まり、進行中LessonRunは完走できる。
- 利用枠画面で、何がどれだけ超過しているかと期限・制限理由を確認できる。
