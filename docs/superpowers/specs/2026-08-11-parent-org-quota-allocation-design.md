# 上位組織の枠配分・共有プール 設計仕様

**日付:** 2026-08-11  
**対象:** Phase F（組織・契約）のサブプロジェクト10 — §19.3 枠配分  
**正本:** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md` §19.2・§19.3。本仕様は §19.3 の共有プール・学校ごとの最低保証・追加配分・利用状況を実装可能な形に具体化し、上位組織の `planId` を持たないとする `2026-08-09-parent-org-hierarchy-design.md` をこの機能の範囲で上書きする。

## スコープ

上位組織の `PARENT_ORG` 契約枠を、子学校へ最低保証と共有余剰として配分する。完全対応は `concurrentLessonsAndMarkets` と `teacherSeats` の2軸だけとし、他5軸は将来同じ予約形式へ接続する。

学校は保証までは独立して使い、保証超過分だけ上位組織の共有プールを予約する。既存授業・教師・データは、保証変更・契約縮小・共有枯渇によって停止または削除しない。

対象外は、他5軸の計測、上位契約終了後の学校単独契約移行（§19.4）、アプリ内のStripe契約変更画面である。

## データモデル

`organizations/{parentOrgId}` は `planId: 'PARENT_ORG'` を持つ。`organizations/{parentOrgId}/schoolAllocations/{schoolOrgId}` は次を持つ。

```ts
{ guaranteedConcurrentLessonsAndMarkets: number; guaranteedTeacherSeats: number; updatedAt: Timestamp }
```

`organizations/{parentOrgId}/quotaReservations/{reservationId}` は共有枠の消費を表す。

```ts
{ resourceKey: 'concurrentLessonsAndMarkets' | 'teacherSeats'; schoolOrgId: string; targetId: string; createdAt: Timestamp }
```

`reservationId` は `resourceKey:schoolOrgId:targetId` の決定的IDとする。LessonRunではtargetIdをlessonRunId、教師席ではuidにする。同一対象の重複予約は禁止する。

共有余剰は、上位契約の上限から全子学校の最低保証合計を引いた値である。各軸について保証合計と予約数は上位契約上限を超えてはならない。

## 予約フロー

```text
学校のLessonRun作成 / 教師招待受諾
  -> 学校の現在使用量 < 最低保証: 予約なしで許可
  -> それ以外: 親の配分・全予約をトランザクションで読み、共有余剰があれば決定的予約を作成
  -> 余剰なし: resource-exhausted

LessonRunがterminal状態へ遷移 / 教師を解除
  -> 対応する予約をトランザクションで削除
```

LessonRun作成、教師招待受諾、返却、最低保証更新は全読み取り後に書き込むFirestoreトランザクションを使う。既存のダウングレード制限と併用する場合は、どちらか一方でも新規増加を拒否すれば拒否する。

## 管理・認可

- `setSchoolQuotaAllocationCallable`: 親組織のowner/adminだけが直下の学校の2軸最低保証を変更できる。保証合計が親上限を超える、または既存予約数より共有余剰を小さくする更新は`failed-precondition`。
- `getParentOrgQuotaUsageCallable`: 親組織のactive memberにのみ総枠、保証合計、共有余剰、予約済み数、学校別の集約利用量を返す。生徒個票、LessonRun内容、教師の個人情報は返さない。
- `getSchoolEffectiveQuotaCallable`: 学校のactive memberに自校の保証、共有予約、使用量、実効利用可能量だけを返す。他校の値は返さない。
- 学校を親へ紐付ける時は保証0で配分ドキュメントを作成する。予約が残る学校の解除は`failed-precondition`で拒否する。

親契約または最低保証が縮小されても既存予約を削除しない。新規共有予約だけを拒否し、上位管理者へ利用整理を促す。

## UI

`ParentOrgSettingsPage` は親契約総枠、保証合計、共有余剰、予約済み数を表示し、子学校ごとに2軸の保証・使用量・共有予約数を表示する。owner/adminだけが保証を編集でき、予約が残る学校の解除不能理由を表示する。

学校の利用枠画面は、自校の保証、共有プールを使っているか、実効利用可能量を表示する。Customer Portalや上位組織以外の契約情報は表示しない。

## エラー・テスト

- 共有プール不足時のLessonRun作成と教師招待受諾は`resource-exhausted`。
- 親権限不足は`permission-denied`、他親配下または子学校でない対象は`failed-precondition`。
- 純粋関数とFirestoreトランザクションで、保証内利用、共有予約、枯渇、決定的IDによる重複防止、返却、保証縮小、契約縮小を検証する。
- Callableで認可と個票非漏えいを検証し、UIで総枠・保証・共有利用・解除不能理由を検証する。
- `functions/src/index.ts`から全新規Callableをexportし、`npm run verify`で全体を検証する。
