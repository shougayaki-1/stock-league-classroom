# Task 4 実装レポート — 利用状況UIと全体検証

## 対象範囲

上位組織の2軸枠配分・共有予約状況を教師向けUIへ接続した。Functions source、Functions tests、`.claude/` は変更していない。

## 変更ファイル

- `src/lib/organizations/parentOrgQuota.ts`
  - `getParentOrgQuotaUsageCallable` と `getSchoolEffectiveQuotaCallable` の入出力DTOをクライアント側へミラー。
  - 両Callableのwrapperと、owner/admin配分更新用の `setSchoolQuotaAllocationCallable` wrapperを追加。
- `src/lib/organizations/parentOrgQuota.test.ts`
  - 3 wrapperのCallable名・入力・返却DTOを検証。
- `src/lib/organizations/schoolHierarchy.ts`
  - `ChildSchool` に任意の予約数・解除理由フィールドを追加し、既存DTOとの互換性を維持。
- `src/components/teacher/organizations/ParentOrgSettingsPage.tsx`
  - 親の同時授業・市場数／教師席について上限、保証、共有残、予約を表示。
  - 学校ごとの保証、使用中、共有予約を表示。
  - `canEditAllocations` と callback props により owner/admin のみ配分編集可能。未指定の既存propsは従来どおり動作。
  - 共有予約が残る学校の解除ボタンを無効化し、「共有枠の予約が残っているため学校を解除できません」と表示。
- `src/components/teacher/organizations/ParentOrgSettingsPage.test.tsx`
  - 親 totals、学校別集約、read-only viewer、予約残存時の解除不能理由を追加検証。
- `src/components/teacher/organizations/PlanLimitsPage.tsx`
  - optionalな自校effective quotaを表示。保証、使用中、共有予約、実効利用可能のみを表示し、親全体・他校情報は出さない。
- `src/components/teacher/organizations/PlanLimitsPage.test.tsx`
  - 学校専用effective quota表示を追加検証。
- `src/App.tsx`
  - 親設定routeでusage/membershipをロードし、owner/admin権限と配分更新をprops経由で渡す。
  - 学校が親配下の場合だけeffective quotaをロード。
  - `parentOrg` ではStripe checkout/customer portalを表示しない。既存の学校route互換性は維持。

## TDD RED/GREEN

本番コードより先にfocused testsを追加し、次のREDを確認した。

```text
Test Files 3 failed (3)
Tests 4 failed | 10 passed (14)
```

失敗は未作成のDTO wrapper、未実装の親quota表示、read-only説明、予約残存時の解除不能理由、学校effective quota表示に対応していた。最小実装後、focused testsはGREENになった。

## Context7確認

実装前にContext7で `/firebase/firebase-functions` と `/vitest-dev/vitest` の現行ドキュメントを確認した。Callableの型付き入出力・`HttpsError`契約、およびVitestのTypeScriptテストとfocused runの形式を確認した。

## 検証

以下を実行し、すべてexit code 0だった。

```bash
npm test -- src/lib/organizations/parentOrgQuota.test.ts src/components/teacher/organizations/ParentOrgSettingsPage.test.tsx src/components/teacher/organizations/PlanLimitsPage.test.tsx
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

結果:

- focused UI/DTO tests: 3 files / 17 tests passed
- full UI tests: 96 files / 389 tests passed
- typecheck: passed
- lint: passed（既存の `functions/packages/household-authoring-content/src/index.test.ts` 未使用型warningあり）
- build: passed（既存のchunk size warningあり）
- diff check: passed
