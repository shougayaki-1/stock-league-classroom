# 利用状況ダッシュボード 設計仕様

**日付:** 2026-08-15
**対象:** Phase 7(エンタープライズ管理者機能)サブプロジェクト2 — 利用状況ダッシュボード
**正本:** `docs/superpowers/specs/2026-08-05-lesson-platform-roadmap-design.md` Phase 7節。矛盾する場合は正本を優先し、本仕様側の誤りとして扱う。

## 背景・位置づけ

Phase 7の「利用状況ダッシュボード」は、組織のlessonRun実施件数・AI利用枠消費状況・同時実施数を教師が把握できるようにする機能。調査の結果、必要なデータソースは既存実装から直接導出可能であり、新しい集計基盤を作る必要はない。

- lessonRun件数: `lessonRuns`コレクションを`orgId`で問い合わせるだけで導出可能(`functions/src/organizations/planLimits.ts`の`countActiveLessonRuns`が既に同種のクエリパターンを持つ)。
- AI利用枠: `functions/src/ai/usageQuota.ts`の`organizations/{orgId}/aiUsageCounters/{dailyKey|monthlyKey}`カウンタードキュメントが既に日次/月次で運用されている(AI利用枠の本運用機能で実装済み)。読み取り専用の集計であり、新しい書き込みロジックは不要。
- 同時実施数: `ACTIVE_LESSON_RUN_STATUSES`によるアクティブlessonRunカウントクエリが`countActiveLessonRuns`として既に存在する。

したがって本サブプロジェクトは「新規のCallable 1本 + 新規UIページ1枚」で完結する。過去のピーク値(履歴)は追跡データが存在しないためスコープ外(ユーザー承認済み)。

## アーキテクチャ

### Callable: `getOrgUsageDashboardCallable`

- 入力: `{ orgId: string }`
- 認可: `getOrgPlanLimitsCallable`と同じパターン。署名済み教師であり、対象`orgId`のアクティブメンバーであること(`requireActiveOrgMember`)。owner/adminに限定しない(利用枠上限の閲覧と同様、非機微情報のため)。
- 返り値:

```ts
interface OrgUsageDashboard {
  lessonRunsThisMonth: number
  lessonRunsTotal: number
  concurrentActive: number
  concurrentLimit: number
  aiDailyUsed: number
  aiDailyLimit: number
  aiMonthlyUsed: number
  aiMonthlyLimit: number
}
```

### 純粋ロジック: `buildOrgUsageDashboard`(deps注入パターン)

```ts
interface OrgUsageDashboardDeps {
  countLessonRunsThisMonth: (orgId: string) => Promise<number>
  countLessonRunsTotal: (orgId: string) => Promise<number>
  countActiveLessonRuns: (orgId: string) => Promise<number>
  getLimits: (orgId: string) => Promise<{ concurrentLessonsAndMarkets: number; aiCreditsPerDay: number; aiCredits: number }>
  getAiDailyUsed: (orgId: string) => Promise<number>
  getAiMonthlyUsed: (orgId: string) => Promise<number>
}
```

- `getLimits`は既存`getOrgPlanLimitsWithAdminSdk`をそのまま呼ぶ(プラン未設定時は`この組織にはプランが設定されていません`をそのまま投げ、Callable側で`failed-precondition`に変換する。`getOrgPlanLimitsCallable`と同じ変換パターン)。
- `getAiDailyUsed`/`getAiMonthlyUsed`は`usageQuota.ts`の`readCount`と同一ロジック(`aiUsageCounters/{dailyKey(nowMillis())}` / `{monthlyKey(nowMillis())}`を読む)を関数として切り出し、`usageQuota.ts`側からエクスポートして再利用する(重複実装を避ける)。
- `countActiveLessonRuns`はAdmin SDK配線で`planLimits.ts`の同名内部実装と同一クエリ(`lessonRuns`を`orgId`+`status in ACTIVE_LESSON_RUN_STATUSES`)を新規に書く(`planLimits.ts`内の実装はモジュール非公開のため、同型のクエリをこのCallable用に新規作成する)。

### Admin SDK配線: `getOrgUsageDashboardWithAdminSdk`

- `countLessonRunsTotal`: `db.collection('lessonRuns').where('orgId', '==', orgId).get().then(s => s.size)`
- `countLessonRunsThisMonth`: 同クエリに`.where('createdAt', '>=', 今月初(JST) のTimestamp)`を追加。今月初(JST)は`usageQuota.ts`の`monthlyKey`が使うのと同じ`Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' })`ロジックで`YYYY-MM-01T00:00:00+09:00`を算出し`Timestamp.fromDate`に変換する。
- `countActiveLessonRuns`: 上記クエリ(`ACTIVE_LESSON_RUN_STATUSES`を`planLimits.ts`からimport)。
- `getLimits`: `getOrgPlanLimitsWithAdminSdk(orgId)`から`concurrentLessonsAndMarkets`/`aiCreditsPerDay`/`aiCredits`のみ抽出。
- `getAiDailyUsed`/`getAiMonthlyUsed`: `usageQuota.ts`からexportする`readAiUsageCount(orgId, key)`相当を`dailyKey(Date.now())`/`monthlyKey(Date.now())`で呼ぶ。

### UI

- 新規ルート`/teacher/organizations/:orgId/usage-dashboard`。`src/App.tsx`に`PlanLimitsPage`/`PlanLimitsRoute`と同型の`UsageDashboardPage`/`UsageDashboardRoute`(`TemplateRouteGuard`でラップ)を追加。
- `SchoolOrgSettingsPage.tsx`に「利用状況ダッシュボード」へのリンクを追加(既存の「利用枠」リンクの隣)。
- ページ構成: 3枚のカード。
  1. 授業実施件数: 「今月: N件」「累積: M件」
  2. 同時実施数: 「現在: X / 上限 Y」(X >= Yの場合は上限到達を示す強調表示)
  3. AI利用枠: 「本日: A / 上限 B」「今月: C / 上限 D」(各々上限到達時に強調表示)
- マウント時に`getOrgUsageDashboardCallable`を呼び出し、ローディング/エラー状態を表示する(既存`PlanLimitsPage`のデータ取得パターンを踏襲)。

## エラー処理

- 未サインイン: `unauthenticated`。
- 教師以外: `permission-denied`。
- 対象組織の非アクティブメンバー: `requireActiveOrgMember`が`permission-denied`。
- プラン未設定組織: `failed-precondition`(`この組織にはプランが設定されていません`)。

## テスト方針

- `buildOrgUsageDashboard`(純粋ロジック): 全フィールドが各depsの返り値から正しく組み立てられること、`getLimits`がエラーを投げた場合にそのまま伝播すること。
- `getOrgUsageDashboardWithAdminSdk`: `lessonRuns`クエリの`orgId`絞り込み・今月開始境界(JST)の正しさ、`aiUsageCounters`読み取りキーの正しさ、対象組織にプランが無い場合のエラー伝播。
- Callable: 未サインイン/非教師/非アクティブメンバーそれぞれで拒否されること、成功時に`OrgUsageDashboard`型の値を返すこと。
- UI: マウント時にCallableを呼び3カードが表示されること、上限到達時の強調表示、ローディング/エラー状態、`SchoolOrgSettingsPage`からのリンク遷移。
