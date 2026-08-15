# 組織一括エクスポート(生徒データ) 設計仕様

**日付:** 2026-08-15
**対象:** Phase 7(エンタープライズ管理者機能)サブプロジェクト4 — 生徒データの組織単位の統制(第一弾: 組織一括エクスポート)
**正本:** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md` §21.7(エクスポート範囲)、§21.1(基本機能としてのエクスポート)。矛盾する場合は正本を優先し、本仕様側の誤りとして扱う。

## 背景・位置づけ

調査の結果、生徒データの組織単位の統制は仕様書(§20-22)に詳細な要件があるが実装はほぼ皆無だった。今回は§21.7が挙げる3つのエクスポート範囲(個人・授業単位・組織一括)のうち唯一未実装の「組織一括」に絞る(保持期限管理ワークフロー・監査ログ・admin/owner別アクセス範囲制御は別サブプロジェクトとしてスコープ外、ユーザー承認済み)。

既存の`exportPersonalDataCallable`(`functions/src/privacy/exportPersonalData.ts`)は「個人組織の所有者が自分の所有物全部」をエクスポートする機能で、コード内コメントに「Phase B+で参加者データが実装されたら拡張予定」と明記されている通り、実は生徒の参加者データ(`participants`/`teamAccounts`/`orders`/`households`)を一切含んでいない。今回追加する組織一括エクスポートは、この既存機能とは別物として実装する: 学校組織のownerが、その組織に属する全lessonRunの生徒データ(参加者記録・チーム口座・注文履歴・家計決定)をエクスポートできるようにする。テンプレート・events・checkpointsなど生徒データそのものではない情報は対象外とする。

## アーキテクチャ

### Callable: `exportOrgStudentDataCallable`

- 入力: `{ orgId: string }`
- 認可:
  1. `isReauthFresh`(`functions/src/privacy/onCall.ts:27`、`REAUTH_MAX_AGE_SECONDS = 10分`)で直近再サインインを要求。`exportPersonalDataCallable`と同じ、大量PIIエクスポートに対する保護。
  2. `requireActiveOrgMember`で対象`orgId`のアクティブメンバーであることを確認し、`role === 'owner'`のみ(§21.7「大規模エクスポートはownerに限定するのが標準」。admin不可、adminへの拡張は将来必要になれば別途検討)。
- 処理: `lessonRuns`を`orgId`で全件取得し、各runについて以下のサブコレクションを取得して同梱する。
  - `lessonRuns/{id}/participants`
  - `lessonRuns/{id}/teamAccounts`
  - `lessonRuns/{id}/orders`
  - `lessonRuns/{id}/households`(各householdについてさらに`households/{id}/decisions`サブコレクションも取得)
- 返り値:

```ts
interface OrgStudentDataExport {
  exportedAt: string
  orgId: string
  lessonRuns: Array<{
    id: string
    [runField: string]: unknown
    participants: Record<string, unknown>[]
    teamAccounts: Record<string, unknown>[]
    orders: Record<string, unknown>[]
    households: Array<{ id: string; [field: string]: unknown; decisions: Record<string, unknown>[] }>
  }>
}
```

### 純粋ロジック: `exportOrgStudentData`(deps注入パターン、`exportPersonalData`と同型)

```ts
interface ExportOrgStudentDataDeps {
  orgId: string
  listLessonRuns: () => Promise<Record<string, unknown>[]>
  listParticipants: (lessonRunId: string) => Promise<Record<string, unknown>[]>
  listTeamAccounts: (lessonRunId: string) => Promise<Record<string, unknown>[]>
  listOrders: (lessonRunId: string) => Promise<Record<string, unknown>[]>
  listHouseholds: (lessonRunId: string) => Promise<Record<string, unknown>[]>
  listHouseholdDecisions: (lessonRunId: string, householdId: string) => Promise<Record<string, unknown>[]>
  now?: () => string
}
```

`exportPersonalData`(`functions/src/privacy/exportPersonalData.ts:29-46`)と同じ形で、各lessonRunについて4つのサブコレクションを`Promise.all`で並列取得し組み立てる。

### Admin SDK配線: `exportOrgStudentDataWithAdminSdk`

- `listLessonRuns`: `db.collection('lessonRuns').where('orgId', '==', orgId).get()`
- `listParticipants`/`listTeamAccounts`/`listOrders`/`listHouseholds`: それぞれ`lessonRuns/{lessonRunId}/{participants|teamAccounts|orders|households}`をそのまま取得(`exportPersonalData.ts`の`listCollection`ヘルパーを再利用)。
- `listHouseholdDecisions`: `lessonRuns/{lessonRunId}/households/{householdId}/decisions`を取得。

## エラー処理

- 未サインイン: `unauthenticated`。
- 再認証が古い(`auth_time`が10分超過): `failed-precondition`(`isReauthFresh`と同じメッセージ「セキュリティのため、再度サインインしてからお試しください。」)。
- 対象組織のアクティブメンバーでない、またはowner以外: `permission-denied`。

## UI

- `SchoolOrgSettingsPage.tsx`に「生徒データを一括エクスポート」ボタンを追加。閲覧者が`owner`のときのみ表示(既存の`viewerRole`導出ロジックを再利用)。押下すると`exportOrgStudentDataCallable`を呼び、結果をJSONファイルとしてブラウザでダウンロードさせる(`exportPersonalDataCallable`のクライアント側呼び出しパターンがあればそれに倣う。無ければ`Blob`+`URL.createObjectURL`による素朴なダウンロード実装)。
- ダウンロード中はボタンを無効化しローディング表示。

## テスト方針

- `exportOrgStudentData`(純粋ロジック): 複数lessonRunにまたがるparticipants/teamAccounts/orders/households(+decisions)が正しく組み立てられることを検証。
- `exportOrgStudentDataWithAdminSdk`: `orgId`絞り込みクエリと各サブコレクションパスの正しさを検証。
- Callable: 未サインイン拒否、再認証切れ拒否、owner以外(admin/teacher)拒否、非アクティブメンバー拒否、owner成功時の形状を検証。
- UI: owner以外へのボタン非表示、押下時のCallable呼び出しとダウンロード開始、ローディング状態。
