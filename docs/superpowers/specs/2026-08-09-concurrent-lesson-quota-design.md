# 作成時の利用枠確保(同時授業・市場数) 設計仕様

**日付:** 2026-08-09
**対象:** Phase F(組織・契約)のサブプロジェクト4 — §18.9 作成時の利用枠確保
**正本:** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md` §18.9(作成時の利用枠確保)・§18.3(プラン、制限軸の定義)。矛盾する場合は正本を優先し、本仕様側の誤りとして扱う。

## 背景・位置づけ

Phase Fサブプロジェクト2(プラン・利用枠の土台)により、組織ごとの`planId`と`planDefinitions/{planId}.limits`(7つの制限軸)が参照できるようになったが、実際にどれか1つでも上限を強制する仕組みはまだ存在しない。本サブプロジェクトは、§18.9が名指しする「市場・授業作成」に対応する**同時授業・市場数(`concurrentLessonsAndMarkets`)の1軸のみ**を、実際の作成時に強制する。

**スコープ判断(ユーザー承認済み):**
- 他の6つの制限軸(参加人数・教師席・AIクレジット・テンプレート保存・結果保持・イベント追加枠)の強制は**含めない**。各軸はチェックすべきタイミング(トリガー)が異なる——教師席は招待受諾時、AIクレジットはAI呼び出しのたび、参加人数は生徒参加時、テンプレート保存はテンプレート作成時、結果保持は削除バッチ、イベント追加枠はイベントモード自体が別サブプロジェクト——ため、1つの変更に無関係な複数のサブシステムを同時に含めることを避け、それぞれ独立したサブプロジェクトとして後で扱う。
- 仕様書は「仮確保→作成→確定/失敗時返却」という明示的な3段階パターンを想定しているが、調査の結果`createLessonRun`(`functions/src/lessonRuns/createLessonRun.ts`)はすでに1つのFirestoreトランザクション内で完結しており、処理中に失敗すれば自動的に何も書き込まれずロールバックされる。したがって、既存のトランザクション内で件数を確認するだけで「仮確保→作成→失敗時に返却」と同等の効果が得られ、別段階の返却処理・冪等キーの追加導入は不要と判断した(`createLessonRun`は既に`lessonRunIdempotency`ドキュメントによる冪等性を持つ)。

## アーキテクチャ

### 同時授業・市場数の確認

`functions/src/lessonRuns/createLessonRun.ts`の既存トランザクション内、`tx.set()`で新規`lessonRuns/{id}`ドキュメントを作成する直前に、以下の読み取りと確認を追加する(すべて既存の「読み取り→書き込み」の順序規律の範囲内):

1. `organizations/{orgId}`を読み、`planId`を取得する。
2. `planDefinitions/{planId}`を読み、`limits.concurrentLessonsAndMarkets`を取得する。
3. `lessonRuns`コレクションを`orgId == 対象orgId`かつ`status in ['DRAFT', 'READY', 'WAITING', 'RUNNING', 'PAUSED', 'INTERRUPTED', 'REFLECTION']`(終了していない状態)でクエリし、件数を数える。
4. 件数が上限以上なら`Error('この組織の同時授業・市場数の上限に達しています')`をトランザクション内でthrowする。トランザクション全体が自動的に何も書き込まずにロールバックされる。

`COMPLETED`/`ABORTED`/`ARCHIVED`は終了済みステータスとしてカウントに含めない(`functions/src/lessonRuns/interventions.ts`の`TERMINAL_OR_POST_RUN_STATUSES`とは目的が異なる——あちらはフェーズ復元の可否判定、こちらは「まだ市場・教室資源を使用中か」の判定であり、`REFLECTION`はまだ使用中とみなす点で異なる)。

### Firestore複合インデックス

新規Firestore複合インデックス(`lessonRuns`コレクション、`orgId` ASC + `status` ASC)が必要になる。このプロジェクトには`firestore.indexes.json`がまだ存在しないため、新規作成し`firebase.json`から参照する(このプロジェクト初のFirestore複合インデックス定義)。Firestoreエミュレータは複合インデックス未定義でもクエリを実行できてしまうため、`firestore.indexes.json`の存在と内容自体をテストで検証することはできない——本番デプロイ前提のドキュメントとして扱う。

### 対象外の判断

`planId`未設定、または`planDefinitions/{planId}`が存在しない組織は、`getOrgPlanLimits`(Phase Fサブプロジェクト2)と同じ方針で明示的にエラーとする——無制限扱いにはしない。

## データフロー

```
[教師: 授業を作成] --createLessonRunCallable--> createLessonRun のトランザクション開始
  --(既存)冪等性キー確認 --> (既存)テンプレート・公開版の読み取り・検証
  --(新規)organizations/{orgId} を読み、planId を取得
  --(新規)planDefinitions/{planId} を読み、limits.concurrentLessonsAndMarkets を取得
  --(新規)lessonRuns を orgId==X かつ status in [終了していない状態] でクエリし件数を取得
  --件数 >= 上限 --> Error(トランザクション全体がロールバック、何も作成されない)
  --件数 < 上限 --> (既存)lessonRuns/{id} を作成 --> トランザクション確定
```

## エラー処理

- 上限到達時: `createLessonRun`が`Error('この組織の同時授業・市場数の上限に達しています')`をthrowする。`functions/src/lessonRuns/onCall.ts`の`createLessonRunCallable`はこのメッセージを`HttpsError('resource-exhausted', ...)`へ変換する。
- `planId`未設定、または`planDefinitions/{planId}`が存在しない組織: `getOrgPlanLimits`と同じ方針で明示的にエラーとする(`Error('この組織にはプランが設定されていません')`を再利用し、`createLessonRunCallable`側で`failed-precondition`へ変換する)。
- クライアント側: `resource-exhausted`エラーを受け取った場合、「同時に実施できる授業・市場の上限に達しています。既存の授業を終了してから作成してください」を表示する。

## テスト方針

- `createLessonRun`: 上限未満なら作成が成功すること、上限到達時はエラーになり`lessonRuns`ドキュメントが作成されないこと(トランザクションのロールバック——テスト用の`FirestoreTx`フェイクで、エラー後に該当パスへの`tx.set`が呼ばれていないことを検証する)、`planId`未設定/`planDefinitions`不在時のエラーを検証する。終了済みステータス(`COMPLETED`/`ABORTED`/`ARCHIVED`)の既存`lessonRuns`はカウントに含まれないことを検証する。
- `createLessonRunCallable`: `resource-exhausted`・`failed-precondition`への変換を検証する(既存の`onCall.test.ts`のテスト形式)。
- `firestore.indexes.json`: 新規作成し、`lessonRuns`コレクションの`orgId` ASC + `status` ASC複合インデックスを定義する(テスト対象外、デプロイ前提のドキュメントとして扱う)。
