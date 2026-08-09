# プラン・利用枠の土台 設計仕様

**日付:** 2026-08-09
**対象:** Phase F(組織・契約)のサブプロジェクト2 — プラン・利用枠の土台
**正本:** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md` §18.3(プラン)。矛盾する場合は正本を優先し、本仕様側の誤りとして扱う。

## 背景・位置づけ

Phase Fサブプロジェクト1(学校組織の作成・招待、実装中)により、複数人が所属する組織の土台ができた。本サブプロジェクトはその上に、§18.3が定義する「プラン」(無料・個人有料・学校・上位組織・イベント)と、7つの制限軸(同時授業・市場数、参加人数、教師席、AIクレジット、テンプレート保存、結果保持、イベント追加枠)のデータモデルを作る。

**スコープ判断(ユーザー承認済み):**
- 本サブプロジェクトは**データモデルと読み取り専用の参照のみ**を扱う。以下は明示的にスコープ外:
  - §18.9「作成時の利用枠確保」(仮確保→作成→確定/返却)——この土台を使う次のサブプロジェクト。
  - プランのアップグレード/ダウングレード操作、支払い連携(§18.7・§18.8)。
  - 教師席の個別管理(誰が何席使っているか)・実際の消費量計測(§18.6)——本サブプロジェクトは「上限の数値」だけを扱う。
- 「具体的な数値はハードコードせず設定可能にする」という要件は、`planDefinitions/{planId}`をFirestoreドキュメントとして保存し、Firebase Console等でコード変更なしに調整できるようにすることで満たす(`organizations/{orgId}.aiEnabled`と同じ「手動運用」の割り切り)。

## アーキテクチャ

### プラン定義

新規Firestoreコレクション`planDefinitions/{planId}`(`FREE`/`PERSONAL_PAID`/`SCHOOL`/`PARENT_ORG`/`EVENT`の5ドキュメント、Firebase Console等で手動投入・編集する)。各ドキュメントは以下の形を持つ:

```ts
interface PlanDefinition {
  planId: string
  displayName: string
  limits: {
    concurrentLessonsAndMarkets: number
    participants: number
    teacherSeats: number
    aiCredits: number
    templateStorage: number
    resultRetentionDays: number
    eventExtraCapacity: number
  }
}
```

`firestore.rules`: `planDefinitions/{planId}`は認証済み教師なら`get`/`list`を許可する(既存の`organizations/{orgId}`の`allow get`と同じ粒度)。`allow write: if false`(Admin SDK専用)。

### 組織とプランの紐付け

`organizations/{orgId}`に`planId: string`フィールドを追加する。既存の`ensurePersonalOrgWithAdminSdk`(個人組織作成)・実装中の`createSchoolOrgWithAdminSdk`(学校組織作成)の両方を変更し、組織作成時に`planId: 'FREE'`を書き込む。新規作成される組織は常に`FREE`から始まる(アップグレード操作は別サブプロジェクト)。

既に`planId`を持たない既存組織への後方互換・マイグレーションは考えない(v1運用前のプロジェクトのため)。

### 利用枠の参照

新規Callable`getOrgPlanLimitsCallable`(`functions/src/organizations/onCall.ts`に追加)。`requireActiveOrgMember`で対象組織のアクティブメンバーであることを確認したうえで、対象組織の`planId`から`planDefinitions/{planId}`を読み、`PlanDefinition['limits']`を返す(既存の`getTuningConstantsCallable`と同じ「読み取り専用の薄いCallable」パターン)。

UI: 新規ページ`src/components/teacher/organizations/PlanLimitsPage.tsx`(既存の`TuningDashboardPage`と同じ構成——7つの制限軸を一覧表示するだけの読み取り専用画面)。実装中の`SchoolOrgSettingsPage`からリンクする。

## データフロー

```
[運用者: Firebase Console] --手動で投入/編集--> planDefinitions/{planId}(FREE/PERSONAL_PAID/SCHOOL/PARENT_ORG/EVENT)

[組織作成時(ensurePersonalOrgWithAdminSdk / createSchoolOrgWithAdminSdk)]
  --> organizations/{orgId} に planId: 'FREE' を含めて作成

[教師: 組織設定画面 / プラン確認画面] --画面表示時--> getOrgPlanLimitsCallable({orgId})
  --> requireActiveOrgMember確認 --> organizations/{orgId}.planId を読む
  --> planDefinitions/{planId} を読む --> limits を返す
  --> PlanLimitsPage が7つの制限軸を一覧表示
```

## エラー処理

- `getOrgPlanLimitsCallable`: 未認証は`unauthenticated`。対象組織のアクティブメンバーでない場合は`requireActiveOrgMember`が`permission-denied`。`organizations/{orgId}.planId`が未設定、または対応する`planDefinitions/{planId}`ドキュメントが存在しない場合は`failed-precondition`(「この組織にはプランが設定されていません」)——運用者がFirebase Console側の設定を忘れているケースを想定した、意図的に厳格なエラー(黙ってデフォルト値にフォールバックしない)。
- `ensurePersonalOrgWithAdminSdk`/`createSchoolOrgWithAdminSdk`への`planId: 'FREE'`追加は、既存の冪等性・トランザクション構造を変更しない(単に書き込むフィールドが1つ増えるだけ)。

## テスト方針

- `getOrgPlanLimitsCallable`: `getTuningConstantsCallable.test.ts`と同じモック構成で、未認証・非アクティブメンバー・`planId`未設定・`planDefinitions`ドキュメント不在・正常系(limitsを返す)を検証する。
- `ensurePersonalOrg`/`createSchoolOrg`: 既存テストに`planId: 'FREE'`が書き込まれることを検証するアサーションを追加する(新規テストファイルではなく、既存テストの拡張)。
- `firestore.rules`: `planDefinitions/{planId}`が認証済み教師に`get`/`list`許可され、`write`が拒否されることをルールテストで検証する。
- `PlanLimitsPage`: 7つの制限軸がラベル付きで表示されることを検証する(`TuningDashboardPage.test.tsx`と同じ形式)。
