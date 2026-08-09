# AI Lesson Studio コアインフラ＋授業案作成 設計仕様

**日付:** 2026-08-09
**対象:** Phase E(AI・教材作成強化)のサブプロジェクト3 — AI Lesson Studioの最初の切り出し
**正本:** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md` §15（AI Lesson Studio）。矛盾する場合は正本を優先し、本仕様側の誤りとして扱う。

## 背景・スコープ判断

統合仕様書§15「AI Lesson Studio」は、5つの生成機能（授業案作成・ニュース決算企業設定案・説明文/スライド案・振り返り設問・授業後要約）・PII送信フィルタ・組織単位の7項目トグル（§15.4）・利用枠/原価管理の9項目（§15.5）を1節にまとめているが、これらは互いにかなり独立しており、Phase E自体を分解したのと同じ理由で1つの仕様書には収まらないと判断した（ユーザー承認済み）。

**本仕様のスコープ（v1）:**
- AI呼び出しの共通基盤（プロバイダ非依存インターフェース、組織単位のAI ON/OFFトグル、最小限の利用ログ）
- 5機能のうち「授業案作成」のみ、Guided Lesson Builderウィザードへの統合

**スコープに含めない（明示的な将来課題）:**
- ニュース・決算・企業設定案、説明文・スライド案、振り返り設問、授業後要約の4機能（同じコアインフラの上に構築する別仕様として後日）
- §15.4の7項目トグルのうちAI以外の6項目（ファイルアップロード・マーケットプレイス・外部派生・リンク共有・自由記述・詳細な生徒データ保存 — これらはAI機能に限らない学校管理者機能全体であり、Phase F（組織・契約）寄りの別スコープ）
- §15.5の利用枠ハード上限・原価ログの集計・組織共通クレジット・教師ごとの上限・緊急停止（v1は将来の集計基盤となる利用ログの記録のみ行い、実際の上限判定・強制停止は行わない）
- 実際のAIプロバイダ実装（Anthropic Claude API・Google Vertex AI等）— **プロバイダは未選定**（ユーザー確認済み）。v1はプロバイダ非依存のインターフェースと、呼び出すと明確なエラーを返す`UnconfiguredLlmProvider`のみを実装する。実プロバイダの選定・APIキー発行・実装は別途の判断・作業とする。

## アーキテクチャ

### `LlmProvider`抽象化

`functions/src/ai/llmProvider.ts`（新規）:

```ts
export interface LlmProvider {
  generateText(prompt: string): Promise<string>
}
```

v1では`UnconfiguredLlmProvider`（呼ぶと`Error('AI provider is not configured.')`を投げる実装）のみを提供する。これにより統合仕様書§15.2「AI障害や学校ポリシーで停止されても授業作成・実施可能であること」を、実装上「AI未設定でも他の全機能（Guided Builderの固定3案含む）は無傷」という形で満たす。実プロバイダ選定後は、この1ファイルの実装を差し替えるだけで済む設計とする——呼び出し側（授業案作成機能）はインターフェースにのみ依存し、具象実装を知らない。

### 組織単位のAI ON/OFFトグル

`organizations/{orgId}`ドキュメントへ`aiEnabled: boolean`フィールドを追加する（既定値`false`——AIは opt-in）。AI機能を呼ぶ前に必ずこのフラグを確認する。統合仕様書§15.4が挙げる7項目のトグルのうち、AI機能に関わるこの1項目のみを本仕様で実装する。

### 最小限の利用ログ

`organizations/{orgId}/aiUsageLog/{logId}`（新規Firestoreサブコレクション）に、呼び出しごとに`orgId`・`teacherUid`・`feature`（例: `'LESSON_DRAFT'`）・`createdAt`・`succeeded: boolean`を記録する。統合仕様書§15.5の「利用量・原価ログ」の土台として、集計・上限判定を伴わない記録のみをv1で行う。

### 授業案作成機能

**UI統合:** Guided Lesson Builderウィザードの3案生成ステップ（`TemplateOverviewPage`）へ「AI提案」カードを追加する（固定の簡易/標準/発展案と並べて表示）。教師が選択すると、その時点までのウィザード回答（テーマ・学習目標・難易度等の教師自身の入力——生徒の個人情報を一切含まない）をプロンプト文字列へ整形し、`generateLessonDraftCallable`を呼ぶ。

**Callable:** `functions/src/ai/onCall.ts`（新規）の`generateLessonDraftCallable`。認可は`isCallerTeacher`（既存、`functions/src/organizations/onCall.ts`）＋組織の`aiEnabled`確認。`LlmProvider.generateText`の出力をパースし、`LessonContent`ドラフトとして返す。

**教師確認の必須化:** AIの出力は`generateLessonDraftCallable`のレスポンスとして返るのみで、Firestoreへは一切書き込まない。既存の§14.4確認ページ（`TemplateOverviewPage`が選択後に遷移する確認画面）をAI案・固定案の区別なく必ず経由させ、教師が「この内容で作成」を押すまで`createLessonTemplate`は呼ばれない。統合仕様書§15.1「AIは授業を即時公開せず、教師確認を必須にする」を、新しい確認ゲートを作らず既存フローの再利用で満たす。

### PII送信境界

本機能の入力（ウィザード回答）は教師自身のテキストのみであり、統合仕様書§15.3が禁止する生徒個人情報（氏名・メール・個人回答・個人売買履歴・家庭科の個別状態・アクセスログ・端末情報）を構造上含まない。ただし将来のニュース案・振り返り要約等の機能は生徒データに触れうるため、`functions/src/ai/piiFilter.ts`（新規）に許可/禁止フィールドを検証する純粋関数を用意し、本機能もこれを経由させる（現時点では常に「禁止フィールドなし」判定になるが、将来機能が同じ関門を通ることを構造的に強制する）。

## データフロー

```
[TemplateOverviewPage: 3案ステップ] --「AI提案」選択--> generateLessonDraftCallable
  --> aiEnabled確認 --> ウィザード回答をプロンプト化 --> piiFilter通過確認 --> LlmProvider.generateText
  --> 利用ログ記録 --> パース --> AI案をLessonContentドラフトとして返す（Firestore書き込みなし）
--> [§14.4確認ページ]（既存、AI案も固定3案と同じ扱いで表示） --教師が確認--> createLessonTemplate
```

## エラー処理

- `aiEnabled`が`false`の場合: 「AI提案」カード自体を表示しない（教師に無効な選択肢を見せない）。
- `UnconfiguredLlmProvider`呼び出し時（実プロバイダ未設定）: 「AI機能は現在利用できません」と表示し、固定3案のみを見せる（ウィザードは完結可能）。
- AI応答のパース失敗・タイムアウト: エラーメッセージを表示し、固定3案へフォールバックする（例外を投げてウィザード全体を止めない）。

## テスト方針

- `piiFilter.ts`: 許可フィールドのみが通過し、禁止フィールド（生徒氏名等のキー名）を含むオブジェクトが拒否されることを検証する純粋関数テスト。
- `generateLessonDraftCallable`: `aiEnabled=false`の組織からの呼び出しが拒否されること、`UnconfiguredLlmProvider`利用時に明確なエラーが返ること、成功時に利用ログが記録されることを検証する（実プロバイダは`LlmProvider`インターフェースのモックで代替）。
- `TemplateOverviewPage`: 「AI提案」カード選択→ローディング表示→AI案が確認ページへ渡ること、エラー時に固定3案へフォールバックすることを検証する。
