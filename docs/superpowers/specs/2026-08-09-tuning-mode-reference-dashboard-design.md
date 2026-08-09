# 試運転モード（参照ダッシュボード）設計仕様

**日付:** 2026-08-09
**対象:** Phase E(AI・教材作成強化)のサブプロジェクト2 — 試運転モード
**正本:** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md` §25（実装順、Phase Eの「試運転」項目）。矛盾する場合は正本を優先し、本仕様側の誤りとして扱う。

## 背景・スコープ判断

Phase C・D実装中、統合仕様書・矛盾解消ドキュメントに数値が示されていない箇所（需給感度、市場ノイズ幅、税率、緊急予備資金の月数等）は「PROVISIONAL（試運転で調整する暫定値）」として`functions/src/market/engine/tuningConstants.ts`・`functions/src/homeEconomics/engine/tuningConstants.ts`の2ファイルに集約済みである（Phase C Task19・Phase D Task17の完了条件）。「試運転」はこれらの値を実際の授業運用を通じて調整するフェーズを指す。

**スコープ判断（ユーザー承認済み）:** 本サブプロジェクトのv1は**読み取り専用の参照ダッシュボード**とする。値のライブ編集（Firestore設定ドキュメント経由での動的上書き）は行わない — 既に安全性検証を済ませた計算エンジンファイル（Phase C/D計画で複数ラウンドのレビューを経た`priceCalculation.ts`・`settleRound.ts`関連ファイル等）へ設定読み込みの配線を加える変更は、それ自体が新たなレビューサイクルを要する別スコープの作業と判断したため。値を実際に変更するには引き続きソースコードの編集と再デプロイが必要であり、本ダッシュボードは「今何が設定されているか」「どこで定義されているか」を教師が確認できるようにするだけである。

**スコープに含める:**
- 9個の暫定値（社会科6個・家庭科3個）を一覧表示する読み取り専用ダッシュボード
- 値を返す新規Callable（`functions/`→`src/`のrootDir境界制約により、クライアントは`tuningConstants.ts`を直接importできないため）
- 全教師がアクセス可能な`/teacher/tuning`ルート

**スコープに含めない（明示的な将来課題）:**
- 値のライブ編集・Firestore設定ドキュメントへの動的上書き
- 授業実施中の実測値の可視化（例: 実際に何回「急変」警告が発火したか）— これは別途「試運転モード」の第2段階として構想しうるが、本v1には含めない
- 教材（`LessonContent`）単位でのオーバーライド機能

## アーキテクチャ

### Callable

`getTuningConstantsCallable`（新規、`functions/src/index.ts`からexportする新しいファイル`functions/src/platformConfig/onCall.ts`に配置 — 特定の科目に属さない横断的な参照情報のため、`functions/src/homeEconomics/`や`functions/src/market/`ではなく新規ディレクトリとする）。

認可は`requireActiveOrgMember`（既存、`functions/src/organizations/authorization.ts`）のみ — 特定の`lessonRunId`に紐付かない横断的な参照情報であるため、レッスン単位の`teacherRoles`確認は不要。

**レスポンス形状:**

```ts
export interface TuningConstantsResponse {
  socialStudies: {
    priceSensitivityPresets: Record<'INFO_FOCUSED' | 'BALANCED' | 'DEMAND_FOCUSED', { informationWeight: number; demandWeight: number }>
    defaultNoiseMagnitudePercent: number
    defaultSuddenChangeWarningThresholdPercent: number
    shortTermWindowBatches: number
    flatBandPercent: number
    stallDetectionThresholdMillis: number
  }
  homeEconomics: {
    taxModelV1RatePercent: number
    emergencyFundTargetMonths: number
    pensionReplacementRatePercentProvisionalDefault: number
  }
}
```

Callable本体は`functions/src/market/engine/tuningConstants.ts`・`functions/src/homeEconomics/engine/tuningConstants.ts`が既に再エクスポートしている9個の値をこの形状へ詰めるだけの薄い関数とする。新しい計算・変換ロジックは持たない。

### 画面

`src/components/teacher/tuning/TuningDashboardPage.tsx`（新規） — タブ「社会科」「家庭科」で切り替える読み取り専用テーブル。各行は「項目名（日本語）」「現在値」「意味」「定義場所（ファイルパス）」の4列。ページ上部に「これらの値はコードで固定されており、変更するにはソースコードの編集と再デプロイが必要です」という注記を常に表示する。

**ルート:** `/teacher/tuning`。Guided Lesson Builderで実装済みの`TemplateRouteGuard`（`src/App.tsx`、`teacher()`+`activeMember()`相当の認可）をそのまま再利用する — レッスン単位の権限を要しない点で`/teacher/templates`系ルートと同じ認可レベルであり、新しいガードコンポーネントを作らない。

**クライアント側Callableラッパー:** `src/lib/platformConfig/getTuningConstants.ts`（新規） — `src/lib/lessonTemplates/publishLessonVersion.ts`と同じ薄いCallable呼び出しパターンに倣う。

### データフロー

ページマウント時に`getTuningConstantsCallable`を1回呼ぶだけ。値はコードデプロイでしか変わらないため、ポーリング・リアルタイム購読は不要。

## エラー処理

- Callable呼び出し失敗時: ページ上に「読み込みに失敗しました」という簡潔なメッセージを表示する（再試行ボタンは設けない — v1のスコープでは再読み込みで十分と判断）。
- 認可エラー（非アクティブメンバー）: `TemplateRouteGuard`が既存の`/teacher/templates`系ルートと同様に`/about`へリダイレクトする。

## テスト方針

- Callable: `getTuningConstantsCallable`の返り値が`tuningConstants.ts`から実際にimportした値と一致することを検証する（期待値をハードコードせず、実定数をimportして比較することで、将来値が変わってもテストが自動的に追従する）。
- 認可: 非アクティブメンバーが呼んだ場合に拒否されることを検証する（`requireActiveOrgMember`の既存動作を信頼し、このCallable固有の呼び出し順序のみ検証する）。
- 画面: Callableから受け取った値がテーブルへ正しく表示されること、タブ切り替えが機能することを検証する。
- ルーティング: `/teacher/tuning`が`TemplateRouteGuard`で保護されていることを検証する（`/teacher/templates`系の既存ルートガードテストと同じパターン）。
