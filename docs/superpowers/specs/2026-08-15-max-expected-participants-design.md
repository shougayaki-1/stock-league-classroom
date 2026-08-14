# maxParticipants/expectedParticipants分離 設計仕様

**日付:** 2026-08-15
**対象:** Phase 5(組織・ライセンス・決済)の残項目 — 定員の扱いの変更
**正本:** `docs/superpowers/specs/2026-08-05-lesson-platform-roadmap-design.md` Phase 5節(「定員の扱いを変更する」)、`docs/superpowers/specs/2026-08-05-integrated-platform-spec.md` §7.4(`LessonRun`型定義)。矛盾する場合は正本を優先し、本仕様側の誤りとして扱う。

## 背景・位置づけ

ロードマップは「現在は`capacity == 80`という固定値だが、サービス上限と授業ごとの想定人数を分離する」と記述しているが、実装を調査した結果、この固定値自体がコードベースに存在しないことが判明した。

- `functions/src/lessonRuns/joinLessonRun.ts`は`LessonRun.maxParticipants`(オプション)を参照して定員判定を行うロジックを持つが、`functions/src/lessonRuns/createLessonRun.ts`がLessonRunドキュメントを作成する際にこのフィールドを一度も書き込んでいない。したがって現状、`maxParticipants`は常に`undefined`であり、参加人数の上限は実質的に一切強制されていない。
- `expectedParticipants`という概念はコードベースに存在しない。近い概念として、テンプレート作成ウィザード(`src/lib/lessonTemplates/guidedBuilderTypes.ts`)に`studentCount`があるが、これはテンプレート内容(チーム編成等)の生成にのみ使われる設計時の入力であり、テンプレートにもLessonRunにも永続化されない。
- `createLessonRunCallable`(`functions/src/lessonRuns/onCall.ts`)を呼び出す既存UI画面は現時点で存在しない(`grep`で該当コンポーネントなし)。したがって本変更は既存UIに影響しない。

## スコープ判断(ユーザー承認済み)

- `expectedParticipants`は**授業開始時**(`createLessonRunCallable`呼び出し時)に教師が入力する。統合仕様書§7.4の`LessonRun`型定義(`expectedParticipants?: number; maxParticipants?: number`)と一致する置き場所。
- テンプレート設計時の`studentCount`とは別概念として扱い、`studentCount`の永続化やテンプレートスキーマの変更は行わない。
- `expectedParticipants`が`maxParticipants`(80)を超える入力は**作成を拒否**する(`invalid-argument`)。クランプ(自動80への切り下げ)は行わない。

## アーキテクチャ

### 定数

`functions/src/lessonRuns/createLessonRun.ts`に以下を追加する。

```ts
/** 全プラン共通のサービス上限。プランで変えるのは同時開催数(concurrentLessonsAndMarkets)であり、これではない。 */
export const MAX_PARTICIPANTS = 80
```

### `createLessonRunCallable`の入力検証

`functions/src/lessonRuns/onCall.ts`の`CreateLessonRunRequest`に`expectedParticipants: number`を追加し、既存の`templateId`/`lessonRunIdempotencyKey`必須チェックと同じ場所で以下を検証する。

- `expectedParticipants`が整数でない、1未満、または`MAX_PARTICIPANTS`(80)を超える場合は`invalid-argument`。

### `createLessonRun`(トランザクション)

`CreateLessonRunDeps`に`expectedParticipants: number`を追加し、`tx.set('lessonRuns/{id}', ...)`の書き込みフィールドに以下を追加する。

```ts
maxParticipants: MAX_PARTICIPANTS,
expectedParticipants: deps.expectedParticipants,
```

バリデーション自体はCallable層(`onCall.ts`)で完結させ、`createLessonRun`本体・トランザクションには入力チェックのロジックを持ち込まない(既存の「トランザクションは信頼済み入力のみを扱う」構造を踏襲)。

### `joinLessonRun.ts`

変更不要。既存の「`typeof run.maxParticipants === 'number'`なら上限チェックする」ロジックが、今回`maxParticipants`が実際に`80`で書き込まれるようになることで、初めて意図通り機能するようになる。

### クライアント側

`src/lib/lessonRuns/createLessonRun.ts`の`CreateLessonRunInput`に`expectedParticipants: number`を追加する。呼び出し元UIは現時点で存在しないため、他の変更は不要。

## データフロー

```
[教師: 授業を開始(templateId, expectedParticipants, lessonRunIdempotencyKey)]
  --createLessonRunCallable-->
  --(新規)expectedParticipants の範囲検証(1〜80の整数)
      --範囲外 --> invalid-argument
  --(既存)templateId・lessonRunIdempotencyKey 必須チェック --> テンプレート・組織メンバーシップ確認
  --createLessonRunWithAdminSdk --> createLessonRun のトランザクション
  --(既存)冪等性キー確認・テンプレート検証・利用枠確認
  --(新規)lessonRuns/{id} に maxParticipants: 80, expectedParticipants: 入力値 を含めて作成
```

## エラー処理

- `expectedParticipants`が範囲外: `HttpsError('invalid-argument', '想定人数は1〜80の範囲で指定してください。')`。
- それ以外の既存エラー処理(冪等性・テンプレート未存在・利用枠超過等)は変更なし。

## テスト方針

- `functions/src/lessonRuns/createLessonRun.test.ts`: `expectedParticipants`を指定して作成した場合、`lessonRuns/{id}`に`maxParticipants: 80`と指定した`expectedParticipants`が書き込まれることを検証する。
- `functions/src/lessonRuns/onCall.test.ts`: `expectedParticipants`が`0`・`81`・小数・未指定の場合に`invalid-argument`になること、`1`と`80`(境界値)は通ることを検証する。
- `functions/src/lessonRuns/joinLessonRun.test.ts`: 既存の`maxParticipants`関連テスト(136行目・145行目)はフィクスチャで直接`maxParticipants`を指定しているため変更不要。回帰確認のみ行う。
