# Webhook順序問題・顧客再利用 設計仕様

**日付:** 2026-08-10
**対象:** Phase F(組織・契約)のサブプロジェクト8 — §18.8続き(Stripe統合の堅牢化)
**正本:** `docs/superpowers/specs/2026-08-09-stripe-subscription-lifecycle-design.md`(実装済み)。矛盾する場合は本仕様を優先する(本仕様は前提仕様の既知の欠落を埋めるもの)。

## 背景・位置づけ

サブスクリプションのライフサイクル管理(実装済み)の最終レビューで、計画外だが本番影響の大きい2件のギャップが見つかった:

1. **Webhook順序問題**: Stripeはイベント配信順序を保証しない。新規サブスクリプションの`invoice.paid`が`checkout.session.completed`より先に届くと、顧客ID逆引きインデックス(`stripeCustomers/{customerId}`)がまだ存在せず、初回の支払い確定を検知できない。
2. **再申込時の別Customer作成**: `createStripeCheckoutSession`は常に新規Stripe顧客を作成させており、既に`stripeCustomerId`を持つ組織(解約後の再申込等)が再度申し込むと、Stripe側に重複した顧客レコードが生まれる。

## アーキテクチャ

### Webhook順序問題への対処

`invoice.paid`/`invoice.payment_failed`/`customer.subscription.deleted`で顧客ID逆引きが失敗した場合、**200ではなく503を返す**。Stripeは失敗したWebhook配信を最大3日間、指数バックオフで自動再送する仕様があるため、`checkout.session.completed`が追いつくのを待てる。

これは既存の「原則200を返す」方針の**例外**である。「顧客IDが解決できない」は一時的な状態(数秒〜数分後には解決される見込みがある)であり、`checkout.session.completed`の`client_reference_id`形式異常のような恒久的な不整合とは性質が異なるため区別する。無限リトライを防ぐためのアプリ側の独自の上限管理は行わない(Stripeの3日間の再送上限に委ねる)。

### 再申込時の顧客再利用

`createStripeCheckoutSession`は、Stripeセッション作成前に`organizations/{orgId}.stripeCustomerId`を読む。既存IDがあれば`checkout.sessions.create({customer: 既存ID, ...})`で明示的に渡し、Stripe側の顧客レコードを再利用する。既存IDが無ければ`customer`パラメータを省略し、従来通りStripeに新規顧客を作らせる。

既存`stripeCustomerId`の読み取り自体が失敗した場合(Firestore側の一時的な障害等)は、決済導線自体を止めずに新規顧客作成へフォールバックする(顧客レコードの重複より、決済導線が止まることの方が悪影響が大きいと判断)。

## データフロー

```
[Stripe] --invoice.paid/invoice.payment_failed/customer.subscription.deleted--> stripeWebhookCallable
  --> stripeCustomers/{customerId} を逆引き
  --> 見つからない --> 503を返す(Stripeが自動的に再送、最大3日間)
  --> 見つかる --> 既存処理(subscriptionStatus更新・billingRecords書き込み)

[教師: 再度「このプランで申し込む」] --> createStripeCheckoutSessionCallable({orgId, planId, ...})
  --> organizations/{orgId}.stripeCustomerId を読む
  --> 既存IDがあればcheckout.sessions.create({customer: 既存ID, ...})
  --> 既存IDが無ければ従来通り(Stripeが新規顧客を作成、その後checkout.session.completedで顧客IDを紐付け)
```

## エラー処理

- Webhookで顧客ID逆引きに失敗した場合(`invoice.paid`/`invoice.payment_failed`/`customer.subscription.deleted`のみ): `response.status(503).send(...)`。署名検証失敗(400)・`checkout.session.completed`の`client_reference_id`形式異常(200、恒久的な不整合のため再送しても無駄)とは明確に区別する。
- `createStripeCheckoutSessionCallable`: 既存`stripeCustomerId`の読み取り自体が失敗した場合は、決済自体を止めずに新規顧客作成にフォールバックする。

## テスト方針

- `stripeWebhookCallable`: `getOrgIdForStripeCustomer`が`null`を返した時に`invoice.paid`/`invoice.payment_failed`/`customer.subscription.deleted`で503を返すこと、`checkout.session.completed`の形式異常時は引き続き200を返すことを検証する。
- `createStripeCheckoutSession`(純粋関数): 既存`stripeCustomerId`がある場合に`customer`パラメータ付きでセッションが作られること、無い場合は省略されることを検証する。
