# AI利用枠の本運用 設計仕様

**日付:** 2026-08-14
**対象:** Phase 5(組織・ライセンス・決済)の残項目 — §15.5 利用枠
**正本:** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md` §15.4(組織制御)・§15.5(利用枠)、`docs/superpowers/specs/2026-08-05-lesson-platform-roadmap-design.md` Phase 5節。矛盾する場合は正本を優先し、本仕様側の誤りとして扱う。

## 背景・位置づけ

Phase 5のStripe決済基盤(Checkout・サブスクリプションライフサイクル・年額請求書払い等)が完成し、残る明記項目のうち「AI利用枠の本運用」に着手する。現状を棚卸しした結果:

- `functions/src/ai/onCall.ts`の`generateLessonDraftCallable`/`generateTeacherGuidanceCallable`は、組織の`aiEnabled`フラグ確認と`organizations/{orgId}/aiUsageLog`への呼び出しログ記録(`succeeded`フラグ付き)のみを行っており、**回数・量を制限する仕組みが一切存在しない**。
- `PlanLimits.aiCredits`(`functions/src/organizations/planLimits.ts`)はフィールドとして定義されているが、コードベース全体で参照箇所がゼロ(未使用)。
- `functions/src/ai/llmProvider.ts`の`unconfiguredLlmProvider`は常に`reject`するスタブであり、実際のLLMプロバイダは未接続。したがって現時点でAI機能は本番稼働しておらず、これは「発生中のコスト超過を止める」対応ではなく、**本番投入前に利用枠の仕組みを整備する**対応である。

## スコープ判断(ユーザー承認済み)

- **LLMプロバイダ接続自体はスコープ外。** `unconfiguredLlmProvider`はそのままとし、本設計は「利用量をどう計測し、どう上限を強制し、超過時に何が起きるか」のみを対象とする。
- **計測単位は呼び出し回数。** トークン数は正確な指標だが、プロバイダ未接続のため現時点で計測手段がない。既存`aiUsageLog`の設計(`succeeded`フラグのみで量は記録しない)とも整合する。
- **上限の粒度は組織単位のみ。** 教師ごとの個別上限(§15.5に記載あり)は本設計に含めない。個人契約では教師1人=組織1つのため実質的にカバーされており、学校組織向けの教師別上限は将来の拡張として別途扱う。
- **上限超過時は専用エラーでブロックする。** プロバイダ障害時のフォールバック(§15.2)とは区別し、教師が「なぜ使えないか」を正しく理解できるようにする。
- **緊急停止(グローバルキルスイッチ)を含める。**
- **失敗呼び出しは枠を消費しない。** コストが発生するのは成功呼び出しのみと仮定する。

## アーキテクチャ

### 新規モジュール: `functions/src/ai/usageQuota.ts`

`functions/src/organizations/planLimits.ts`と同じ依存注入パターンで実装する。

```ts
interface AiUsageQuotaDeps {
  isKillSwitchEnabled: () => Promise<boolean>
  getMonthlyLimit: (orgId: string) => Promise<number>
  getDailyLimit: (orgId: string) => Promise<number>
  getDailyCount: (orgId: string) => Promise<number>
  getMonthlyCount: (orgId: string) => Promise<number>
  incrementUsage: (orgId: string) => Promise<void>
  nowMillis?: () => number
}

// 呼び出し前チェック: キルスイッチ・日次・月次の順に確認し、
// 超過があれば理由付きでエラーを投げる。超過が無ければ何もしない。
checkAiQuota(deps, { orgId }): Promise<void>

// LLM呼び出し成功後に呼ぶ。日次・月次カウンタを同時にインクリメントする。
consumeAiQuota(deps, { orgId }): Promise<void>
```

`generateLessonDraftCallable`/`generateTeacherGuidanceCallable`の処理順序を以下に変更する(既存の`aiEnabled`確認・PIIフィルタ・ログ記録は維持):

```
① キルスイッチ確認(config読み取り)
② 組織の aiEnabled 確認(既存)
③ checkAiQuota(日次・月次の事前チェック)
④ assertNoForbiddenFields(既存)
⑤ LLM呼び出し(既存)
⑥ 成功時: consumeAiQuota(カウンタ増分) + aiUsageLog記録(既存)
   失敗時: aiUsageLog記録のみ(既存、枠は消費しない)
```

### データモデル

- `organizations/{orgId}/aiUsageCounters/{YYYY-MM-DD}` = `{ count: number }` — JST日付キー。`FieldValue.increment(1)`で更新(未存在時は自動作成)。
- `organizations/{orgId}/aiUsageCounters/{YYYY-MM}` = `{ count: number }` — JST月キー。同様。
- 上限値: 月次上限は既存`PlanLimits.aiCredits`をそのまま流用。日次上限は`PlanLimits`に新規フィールド`aiCreditsPerDay`を追加する(`functions/src/organizations/planLimits.ts`・`src/lib/organizations/planLimits.ts`の両方を更新)。
- `systemConfig/aiKillSwitch` = `{ enabled: boolean }` — 新規のグローバル設定ドキュメント。読み取りのみを実装し、更新手段(Firestoreコンソールでの手動更新)は運用手順として別途ドキュメント化する。更新UIはスコープ外。

いずれも`orgId`と日付/月から直接ドキュメントIDを組み立てて`get()`する設計のため、新規のFirestore複合インデックスは不要。

### データフロー

```
[教師: AI下書き/AIガイダンスを要求] --generateLessonDraftCallable等-->
  --(新規)systemConfig/aiKillSwitch を読み、enabled なら即座に unavailable
  --(既存)organizations/{orgId}.aiEnabled を確認、false なら failed-precondition
  --(新規)aiUsageCounters/{今日} と aiUsageCounters/{今月} を読む
  --日次count >= aiCreditsPerDay または 月次count >= aiCredits
      --> resource-exhausted(どちらの上限かをメッセージで明示)
  --(既存)PIIフィルタ確認 --> LLM呼び出し
  --成功 --> (新規)日次・月次カウンタを increment(1)、(既存)aiUsageLog(succeeded:true)
  --失敗 --> (既存)aiUsageLog(succeeded:false)のみ、カウンタは増やさない
```

## エラー処理

- 上限到達時: `HttpsError('resource-exhausted', ...)`を投げる。このコードは`functions/src/organizations/onCall.ts`・`functions/src/lessonRuns/onCall.ts`が既に「利用枠系エラー」として使っている既存の規約であり、新規コードを増やさず踏襲する。メッセージは「本日のAI利用上限に達しました」/「今月のAI利用上限に達しました」で日次・月次を区別する。`checkAiQuota`は日次を先に確認し、日次が上限内であれば続けて月次を確認する(両方超過している場合は日次のメッセージを返す)。
- キルスイッチON時: `HttpsError('unavailable', 'AI機能は現在停止中です。')`(既存のプロバイダ障害時と同じコード、文言のみ変更)。
- フロント側: `src/lib/monitoring/describeError.ts`の`describeError`/`handleFailure`は既に`resource-exhausted`を「同時利用が上限に達しています。しばらく待つと復帰します。」という汎用メッセージに変換する仕組みを持つが、現状どのコンポーネントからも呼ばれていない(未使用のまま存在)。本設計でこれを`TeacherGuidanceDialog.tsx`・`TemplateOverviewPage.tsx`/`TemplateEditorPage.tsx`のAI呼び出し箇所(現在は`catch`節で固定文言を`setError`している)に配線し、上限到達時にプロバイダ障害時とは異なる文言が出るようにする。新しいUI概念は追加しない。

## 同時実行の整合性

事前チェック(`checkAiQuota`)とインクリメント(`consumeAiQuota`)の間にはレースが存在し、同時に複数リクエストが飛んだ場合は上限を数件超える可能性がある。個人組織・学校組織いずれも同時にAIを呼ぶ教師数は少数と想定されるため、フルトランザクション化(読み取り→書き込みを1トランザクションに束ねる)は行わない(YAGNI)。将来、学校組織規模で問題になった場合に`checkAndConsume`を1トランザクションへ統合する拡張とする。

## 移行・運用上の注意

- 既存の`planDefinitions/{planId}`ドキュメントに`limits.aiCreditsPerDay`を追加するデータ移行が必要。具体的な数値は本設計では決めず、roadmap-design.mdの方針通り「Phase 5の設計時に実際の利用実績を踏まえて決定する」(未設定時は`getOrgPlanLimits`と同じ方針でエラーとし、無制限扱いにはしない)。
- `systemConfig/aiKillSwitch`ドキュメントは初回デプロイ時に`{ enabled: false }`で作成しておく(未存在の場合の扱いも明記: ドキュメントが無い場合は`enabled: false`とみなし、AI機能は通常通り動作する)。

## テスト方針

- `usageQuota.ts`: フェイクdepsによる単体テスト。日次上限到達、月次上限到達、両方未到達、キルスイッチON時の即時拒否、日次のみ超過/月次のみ超過の切り分けメッセージを検証する。
- `functions/src/ai/onCall.ts`: 既存の統合テストに「上限到達時はLLMが呼ばれずに`resource-exhausted`を返す」「キルスイッチON時はLLMが呼ばれずに`unavailable`を返す」「成功呼び出し後にカウンタが1増える」「失敗呼び出し後はカウンタが増えない」ケースを追加する。
- フロント: `TeacherGuidanceDialog.test.tsx`等に「`resource-exhausted`エラー時は上限到達メッセージを表示する」ケースを追加する。
