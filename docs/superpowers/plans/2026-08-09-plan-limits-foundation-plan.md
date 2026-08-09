# プラン・利用枠の土台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**正本:** `docs/superpowers/specs/2026-08-09-plan-limits-foundation-design.md`(設計仕様)。矛盾する場合は仕様書を優先する。

**Goal:** §18.3の7つの制限軸を持つ「プラン」をFirestoreドキュメントとして定義し、すべての組織(個人組織・学校組織)を作成時に`FREE`プランへ紐付け、教師が自組織の利用枠を読み取り専用で確認できるようにする。

**Architecture:** `planDefinitions/{planId}`をFirestoreに保存し(Firebase Console等で手動運用)、`organizations/{orgId}.planId`で組織と紐付ける。読み取りは既存の`getTuningConstantsCallable`と同じ「読み取り専用の薄いCallable」パターンを踏襲する。

**Tech Stack:** TypeScript, React, MUI, Firebase Cloud Functions v2 (`onCall`), Firebase Admin SDK (Firestore), Vitest, React Testing Library。

## Global Constraints

- 本計画は**Phase Fサブプロジェクト1(学校組織の作成・招待)の完了を前提とする**。Task 1-6は`functions/src/organizations/schoolOrg.ts`の`createSchoolOrg`/`createSchoolOrgWithAdminSdk`が存在すれば着手できる(2026-08-09時点で実装済み)。Task 7は`docs/superpowers/plans/2026-08-09-school-org-creation-invitation-plan.md`のTask 6-8(`SchoolOrgSettingsPage`・`App.tsx`への学校組織ルート統合)が完了していることを前提とする——未完了の場合はTask 7のみ後回しにしてよい。
- `planDefinitions/{planId}`ドキュメントの投入・編集はFirebase Console等の手動運用とする。管理UI・管理者用Callableは作らない。
- `organizations/{orgId}.planId`が未設定、または対応する`planDefinitions`ドキュメントが存在しない場合、`getOrgPlanLimitsCallable`は黙ってデフォルト値へフォールバックせず`failed-precondition`を返す。
- 認可は既存の`isCallerTeacher`・`requireActiveOrgMember`をそのまま再利用する。
- 新規Callableは`functions/src/index.ts`からexportする。
- 日本語UI文言を用いる。
- 各タスクの実装後、そのタスクが変更したファイルのテストを実行してから次のタスクに進む。全タスク完了後、`npm run verify`を実行し、通過することを確認してからコミットする。

---

## File Structure

| File | Change |
| --- | --- |
| `functions/src/organizations/personalOrg.ts`, `.test.ts` | Modify（Task 1。`planId: 'FREE'`を追加） |
| `functions/src/organizations/schoolOrg.ts`, `.test.ts` | Modify（Task 1。`planId: 'FREE'`を追加） |
| `functions/src/organizations/planLimits.ts`, `.test.ts` | Create（Task 2） |
| `functions/src/organizations/onCall.ts`, `.test.ts` | Modify（Task 3。`getOrgPlanLimitsCallable`追加） |
| `functions/src/index.ts` | Modify（Task 3。export追加） |
| `firestore.rules`, `test/firestore.rules.test.ts` | Modify（Task 4。`planDefinitions`の読み取り許可） |
| `src/lib/organizations/planLimits.ts`, `.test.ts` | Create（Task 5） |
| `src/components/teacher/organizations/PlanLimitsPage.tsx`, `.test.tsx` | Create（Task 6） |
| `src/App.tsx`, `.test.tsx`、`src/components/teacher/organizations/SchoolOrgSettingsPage.tsx` | Modify（Task 7。ルート追加・リンク追加） |

---

### Task 1: 組織作成時に`planId: 'FREE'`を書き込む

**Files:**
- Modify: `functions/src/organizations/personalOrg.ts`
- Modify: `functions/src/organizations/personalOrg.test.ts`
- Modify: `functions/src/organizations/schoolOrg.ts`
- Modify: `functions/src/organizations/schoolOrg.test.ts`

**Interfaces:**
- Consumes: なし。
- Produces: `organizations/{orgId}`ドキュメントに`planId: 'FREE'`フィールドが常に含まれる、という不変条件。Task 2で消費される。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/organizations/personalOrg.test.ts`の既存の`'creates the org, membership, and users doc exactly once'`テストの`expect(fake.docs.get('organizations/personal_uid-1'))`行を以下に置き換える:

```ts
    expect(fake.docs.get('organizations/personal_uid-1')).toMatchObject({ type: 'personal', ownerUid: 'uid-1', planId: 'FREE' })
```

`functions/src/organizations/schoolOrg.test.ts`の既存の作成成功テストの`organizations/school_...`に対する`toMatchObject`アサーションに`planId: 'FREE'`を追加する（既存のテストファイルを読み、同じ形式で追記する）。

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/organizations/personalOrg.test.ts src/organizations/schoolOrg.test.ts`
Expected: FAIL（`planId`フィールドが存在しない）

- [ ] **Step 3: 実装する**

`functions/src/organizations/personalOrg.ts`の`tx.set(orgPath, { type: 'personal', ownerUid: uid, createdAt: nowValue })`を以下に置き換える:

```ts
    tx.set(orgPath, { type: 'personal', ownerUid: uid, planId: 'FREE', createdAt: nowValue })
```

`functions/src/organizations/schoolOrg.ts`の`tx.set(orgPath, { type: 'school', name: input.name, verificationStatus: 'PENDING', ownerUid: input.ownerUid, createdAt: nowValue })`を以下に置き換える:

```ts
    tx.set(orgPath, { type: 'school', name: input.name, verificationStatus: 'PENDING', ownerUid: input.ownerUid, planId: 'FREE', createdAt: nowValue })
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/organizations/personalOrg.test.ts src/organizations/schoolOrg.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add functions/src/organizations/personalOrg.ts functions/src/organizations/personalOrg.test.ts functions/src/organizations/schoolOrg.ts functions/src/organizations/schoolOrg.test.ts
git commit -m "feat: 組織作成時にplanId:'FREE'を書き込む"
```

---

### Task 2: `getOrgPlanLimits`（純粋関数 — プラン限度値の解決）

**Files:**
- Create: `functions/src/organizations/planLimits.ts`
- Test: `functions/src/organizations/planLimits.test.ts`

**Interfaces:**
- Consumes: なし。
- Produces: `PlanLimits`型、`PlanDefinition`型、`getOrgPlanLimits(deps, input): Promise<PlanLimits>`、`getOrgPlanLimitsWithAdminSdk(orgId): Promise<PlanLimits>`。Task 3で消費される。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// functions/src/organizations/planLimits.test.ts
import { describe, expect, it } from 'vitest'
import { getOrgPlanLimits } from './planLimits'

const limits = {
  concurrentLessonsAndMarkets: 1, participants: 40, teacherSeats: 1, aiCredits: 0,
  templateStorage: 5, resultRetentionDays: 30, eventExtraCapacity: 0,
}

describe('getOrgPlanLimits', () => {
  it('resolves the org plan and returns its limits', async () => {
    const result = await getOrgPlanLimits({
      getOrgPlanId: async (orgId) => { expect(orgId).toBe('org-1'); return 'FREE' },
      getPlanDefinition: async (planId) => { expect(planId).toBe('FREE'); return { planId: 'FREE', displayName: '無料', limits } },
    }, { orgId: 'org-1' })
    expect(result).toEqual(limits)
  })

  it('throws when the organization has no planId', async () => {
    await expect(getOrgPlanLimits({
      getOrgPlanId: async () => null,
      getPlanDefinition: async () => { throw new Error('should not be called') },
    }, { orgId: 'org-1' })).rejects.toThrow('この組織にはプランが設定されていません')
  })

  it('throws when the planDefinitions document does not exist', async () => {
    await expect(getOrgPlanLimits({
      getOrgPlanId: async () => 'FREE',
      getPlanDefinition: async () => null,
    }, { orgId: 'org-1' })).rejects.toThrow('この組織にはプランが設定されていません')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/organizations/planLimits.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装する**

```ts
// functions/src/organizations/planLimits.ts
import { getFirestore } from 'firebase-admin/firestore'

export interface PlanLimits {
  concurrentLessonsAndMarkets: number
  participants: number
  teacherSeats: number
  aiCredits: number
  templateStorage: number
  resultRetentionDays: number
  eventExtraCapacity: number
}
export interface PlanDefinition { planId: string; displayName: string; limits: PlanLimits }

export interface GetOrgPlanLimitsDeps {
  getOrgPlanId: (orgId: string) => Promise<string | null>
  getPlanDefinition: (planId: string) => Promise<PlanDefinition | null>
}
export interface GetOrgPlanLimitsInput { orgId: string }

/**
 * 未設定のplanId・存在しないplanDefinitionsドキュメントのどちらも同じ
 * エラーメッセージで扱う——運用者がFirebase Console側の設定を忘れている
 * ケースを想定した、意図的に厳格な失敗(黙ってデフォルト値にフォール
 * バックしない、設計仕様のエラー処理節を参照)。
 */
export const getOrgPlanLimits = async (deps: GetOrgPlanLimitsDeps, input: GetOrgPlanLimitsInput): Promise<PlanLimits> => {
  const planId = await deps.getOrgPlanId(input.orgId)
  if (!planId) throw new Error('この組織にはプランが設定されていません')
  const definition = await deps.getPlanDefinition(planId)
  if (!definition) throw new Error('この組織にはプランが設定されていません')
  return definition.limits
}

/** Production wiring: Firestore Admin SDK. */
export const getOrgPlanLimitsWithAdminSdk = (orgId: string): Promise<PlanLimits> => {
  const db = getFirestore()
  return getOrgPlanLimits({
    getOrgPlanId: async (id) => {
      const snap = await db.doc(`organizations/${id}`).get()
      return snap.exists ? (snap.get('planId') as string | undefined) ?? null : null
    },
    getPlanDefinition: async (planId) => {
      const snap = await db.doc(`planDefinitions/${planId}`).get()
      return snap.exists ? (snap.data() as PlanDefinition) : null
    },
  }, { orgId })
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/organizations/planLimits.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add functions/src/organizations/planLimits.ts functions/src/organizations/planLimits.test.ts
git commit -m "feat: 組織のプラン限度値を解決するgetOrgPlanLimitsを追加"
```

---

### Task 3: `getOrgPlanLimitsCallable`

**Files:**
- Modify: `functions/src/organizations/onCall.ts`
- Modify: `functions/src/organizations/onCall.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: `getOrgPlanLimitsWithAdminSdk`（Task 2）、`requireActiveOrgMember`（既存）。
- Produces: `getOrgPlanLimitsCallable`。入力`{orgId: string}`、出力`PlanLimits`。Task 5で消費される。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/organizations/onCall.test.ts`に追記する（既存の`vi.mock('./authorization', ...)`・`requireActiveOrgMember`のモックをそのまま使う）:

```ts
import { getOrgPlanLimitsCallable } from './onCall'
import { getOrgPlanLimitsWithAdminSdk } from './planLimits'

vi.mock('./planLimits', () => ({ getOrgPlanLimitsWithAdminSdk: vi.fn() }))

describe('getOrgPlanLimitsCallable', () => {
  beforeEach(() => vi.clearAllMocks())

  it('requires an active org member', async () => {
    vi.mocked(requireActiveOrgMember).mockRejectedValueOnce(new Error('permission-denied'))
    const request = { auth: teacher, data: { orgId: 'org-1' } } as unknown as CallableRequest
    await expect(getOrgPlanLimitsCallable.run(request)).rejects.toThrow('permission-denied')
  })

  it('returns the resolved plan limits for an active member', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(getOrgPlanLimitsWithAdminSdk).mockResolvedValueOnce({
      concurrentLessonsAndMarkets: 1, participants: 40, teacherSeats: 1, aiCredits: 0, templateStorage: 5, resultRetentionDays: 30, eventExtraCapacity: 0,
    })
    const request = { auth: teacher, data: { orgId: 'org-1' } } as unknown as CallableRequest
    await expect(getOrgPlanLimitsCallable.run(request)).resolves.toMatchObject({ participants: 40 })
    expect(getOrgPlanLimitsWithAdminSdk).toHaveBeenCalledWith('org-1')
  })

  it('translates a missing plan into a failed-precondition error', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(getOrgPlanLimitsWithAdminSdk).mockRejectedValueOnce(new Error('この組織にはプランが設定されていません'))
    const request = { auth: teacher, data: { orgId: 'org-1' } } as unknown as CallableRequest
    await expect(getOrgPlanLimitsCallable.run(request)).rejects.toMatchObject({ code: 'failed-precondition' })
  })
})
```

（このテストファイルには既に`teacher`定数と`CallableRequest`のimportが存在する——Task 3(招待Callable)で追加されたものをそのまま使う。存在しない場合は`functions/src/organizations/onCall.test.ts`の先頭を確認し、同じ形式で追加する。）

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/organizations/onCall.test.ts`
Expected: FAIL（`getOrgPlanLimitsCallable`が存在しない）

- [ ] **Step 3: 実装する**

`functions/src/organizations/onCall.ts`の`import`群に追記する:

```ts
import { getOrgPlanLimitsWithAdminSdk } from './planLimits'
```

ファイル末尾に追記する:

```ts
interface GetOrgPlanLimitsRequest { orgId?: unknown }

export const getOrgPlanLimitsCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as GetOrgPlanLimitsRequest
  if (typeof data.orgId !== 'string') throw new HttpsError('invalid-argument', 'orgId は必須です。')
  await requireActiveOrgMember(getFirestore(), data.orgId, request.auth.uid)
  try {
    return await getOrgPlanLimitsWithAdminSdk(data.orgId)
  } catch (error) {
    if (error instanceof Error && error.message === 'この組織にはプランが設定されていません') throw new HttpsError('failed-precondition', error.message)
    throw error
  }
})
```

`functions/src/index.ts`の`organizations/onCall`からのexportブロックに`getOrgPlanLimitsCallable`を追加する。

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/organizations/onCall.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add functions/src/organizations/onCall.ts functions/src/organizations/onCall.test.ts functions/src/index.ts
git commit -m "feat: 組織のプラン限度値を返すgetOrgPlanLimitsCallableを追加"
```

---

### Task 4: `firestore.rules`（`planDefinitions`の読み取り許可）

**Files:**
- Modify: `firestore.rules`
- Modify: `test/firestore.rules.test.ts`

**Interfaces:**
- Consumes: なし。
- Produces: `planDefinitions/{planId}`への`allow get, list: if teacher()`・`allow write: if false`ルール。

- [ ] **Step 1: 失敗するテストを書く**

`test/firestore.rules.test.ts`に追記する（既存の`initializeTestEnvironment`/`assertSucceeds`/`assertFails`のセットアップをそのまま使う）:

```ts
describe('planDefinitions/{planId}', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('planDefinitions/FREE').set({ planId: 'FREE', displayName: '無料', limits: {} })
    })
  })

  it('allows a signed-in teacher to read plan definitions', async () => {
    const context = testEnv.authenticatedContext('teacher-a', teacherToken)
    await assertSucceeds(getDoc(doc(context.firestore(), 'planDefinitions/FREE')))
  })

  it('denies writes from any client', async () => {
    const context = testEnv.authenticatedContext('teacher-a', teacherToken)
    await assertFails(setDoc(doc(context.firestore(), 'planDefinitions/FREE'), { displayName: '改ざん' }))
  })

  it('denies an unauthenticated read', async () => {
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'planDefinitions/FREE')))
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npm run test:rules`
Expected: FAIL（`planDefinitions`に対する明示的な許可ルールがなく、デフォルト拒否のため読み取りテストが失敗する）

- [ ] **Step 3: 実装する**

`firestore.rules`の`match /organizations/{orgId}/aiUsageLog/{logId} { allow read, write: if false; }`の直後に追記する:

```
    match /planDefinitions/{planId} {
      allow get, list: if teacher();
      allow write: if false;
    }
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm run test:rules`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add firestore.rules test/firestore.rules.test.ts
git commit -m "feat: planDefinitionsの読み取りを教師に許可するルールを追加"
```

---

### Task 5: クライアントラッパー

**Files:**
- Create: `src/lib/organizations/planLimits.ts`
- Test: `src/lib/organizations/planLimits.test.ts`

**Interfaces:**
- Produces: `PlanLimits`型、`getOrgPlanLimits(functions, {orgId}): Promise<PlanLimits>`。Task 6で消費される。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/organizations/planLimits.test.ts
import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { getOrgPlanLimits } from './planLimits'
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

describe('getOrgPlanLimits', () => {
  it('calls getOrgPlanLimitsCallable with the orgId', async () => {
    const limits = { concurrentLessonsAndMarkets: 1, participants: 40, teacherSeats: 1, aiCredits: 0, templateStorage: 5, resultRetentionDays: 30, eventExtraCapacity: 0 }
    const call = vi.fn().mockResolvedValue({ data: limits })
    vi.mocked(httpsCallable).mockReturnValue(call as never)
    await expect(getOrgPlanLimits({} as never, { orgId: 'org-1' })).resolves.toEqual(limits)
    expect(httpsCallable).toHaveBeenCalledWith({}, 'getOrgPlanLimitsCallable')
    expect(call).toHaveBeenCalledWith({ orgId: 'org-1' })
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/lib/organizations/planLimits.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装する**

```ts
// src/lib/organizations/planLimits.ts
import { httpsCallable, type Functions } from 'firebase/functions'

export interface PlanLimits {
  concurrentLessonsAndMarkets: number
  participants: number
  teacherSeats: number
  aiCredits: number
  templateStorage: number
  resultRetentionDays: number
  eventExtraCapacity: number
}
export interface GetOrgPlanLimitsInput { orgId: string }

export const getOrgPlanLimits = async (functions: Functions, input: GetOrgPlanLimitsInput): Promise<PlanLimits> =>
  (await httpsCallable<GetOrgPlanLimitsInput, PlanLimits>(functions, 'getOrgPlanLimitsCallable')(input)).data
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/lib/organizations/planLimits.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/organizations/planLimits.ts src/lib/organizations/planLimits.test.ts
git commit -m "feat: プラン限度値取得のクライアントラッパーを追加"
```

---

### Task 6: `PlanLimitsPage`（読み取り専用の利用枠表示）

**Files:**
- Create: `src/components/teacher/organizations/PlanLimitsPage.tsx`
- Test: `src/components/teacher/organizations/PlanLimitsPage.test.tsx`

**Interfaces:**
- Consumes: `PlanLimits`型（Task 5）。
- Produces: `PlanLimitsPage`コンポーネント。Props: `{data: PlanLimits | undefined; error: string | undefined}`（`TuningDashboardPage`と同じprops形状）。Task 7で消費される。

- [ ] **Step 1: 失敗するテストを書く**

```tsx
// src/components/teacher/organizations/PlanLimitsPage.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PlanLimitsPage } from './PlanLimitsPage'

const limits = { concurrentLessonsAndMarkets: 1, participants: 40, teacherSeats: 1, aiCredits: 0, templateStorage: 5, resultRetentionDays: 30, eventExtraCapacity: 0 }

describe('PlanLimitsPage', () => {
  it('shows a loading state when data is undefined', () => {
    render(<PlanLimitsPage data={undefined} error={undefined} />)
    expect(screen.getByLabelText('読み込み中')).toBeInTheDocument()
  })

  it('shows an error message', () => {
    render(<PlanLimitsPage data={undefined} error="failed" />)
    expect(screen.getByRole('alert')).toHaveTextContent('読み込みに失敗しました')
  })

  it('lists all seven limit axes', () => {
    render(<PlanLimitsPage data={limits} error={undefined} />)
    expect(screen.getByText('40')).toBeInTheDocument()
    expect(screen.getByText('同時授業・市場数')).toBeInTheDocument()
    expect(screen.getByText('参加人数')).toBeInTheDocument()
    expect(screen.getByText('教師席')).toBeInTheDocument()
    expect(screen.getByText('AIクレジット')).toBeInTheDocument()
    expect(screen.getByText('テンプレート保存')).toBeInTheDocument()
    expect(screen.getByText('結果保持（日数）')).toBeInTheDocument()
    expect(screen.getByText('イベント追加枠')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/components/teacher/organizations/PlanLimitsPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: 実装する**

```tsx
// src/components/teacher/organizations/PlanLimitsPage.tsx
import { Alert, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import type { PlanLimits } from '../../../lib/organizations/planLimits'

export interface PlanLimitsPageProps { data: PlanLimits | undefined; error: string | undefined }

const ROWS: { label: string; key: keyof PlanLimits }[] = [
  { label: '同時授業・市場数', key: 'concurrentLessonsAndMarkets' },
  { label: '参加人数', key: 'participants' },
  { label: '教師席', key: 'teacherSeats' },
  { label: 'AIクレジット', key: 'aiCredits' },
  { label: 'テンプレート保存', key: 'templateStorage' },
  { label: '結果保持（日数）', key: 'resultRetentionDays' },
  { label: 'イベント追加枠', key: 'eventExtraCapacity' },
]

export function PlanLimitsPage({ data, error }: PlanLimitsPageProps) {
  if (error) return <Alert severity="error">読み込みに失敗しました</Alert>
  if (!data) return <CircularProgress aria-label="読み込み中" />
  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography variant="h5">この組織の利用枠</Typography>
      <Table size="small">
        <TableHead><TableRow><TableCell>項目</TableCell><TableCell>上限</TableCell></TableRow></TableHead>
        <TableBody>
          {ROWS.map((row) => (
            <TableRow key={row.key}><TableCell>{row.label}</TableCell><TableCell>{data[row.key]}</TableCell></TableRow>
          ))}
        </TableBody>
      </Table>
    </Stack>
  )
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/components/teacher/organizations/PlanLimitsPage.test.tsx`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/components/teacher/organizations/PlanLimitsPage.tsx src/components/teacher/organizations/PlanLimitsPage.test.tsx
git commit -m "feat: 組織の利用枠を表示するPlanLimitsPageを追加"
```

---

### Task 7: `App.tsx`への統合（ルート追加・設定画面からのリンク）

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`

**Interfaces:**
- Consumes: `PlanLimitsPage`（Task 6）、`getOrgPlanLimits`（Task 5）。

- [ ] **Step 1: 失敗するテストを書く**

`src/App.test.tsx`の`describe('School org creation and invitation routes', ...)`ブロックの末尾に以下を追記する（既存の`window.history.pushState`/`getDocMock`/`callableMock`のセットアップをそのまま使う）:

```tsx
it('routes /teacher/organizations/:orgId/plan-limits to the plan limits page', async () => {
  window.history.pushState({}, '', '/teacher/organizations/org-1/plan-limits')
  getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ status: 'active' }) })
  callableMock.mockResolvedValue({
    data: { concurrentLessonsAndMarkets: 1, participants: 40, teacherSeats: 1, aiCredits: 0, templateStorage: 5, resultRetentionDays: 30, eventExtraCapacity: 0 },
  })
  render(<App isLessonPlatformV2Enabled getServices={getServices} />)
  authStateCallback?.({ uid: 'teacher-uid', emailVerified: true, providerData: [{ providerId: 'google.com' }] })
  expect(await screen.findByText('参加人数')).toBeInTheDocument()
  window.history.pushState({}, '', '/')
})
```

`src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`に以下を追記する:

```tsx
it('links to the plan limits page', () => {
  render(<SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false} />)
  expect(screen.getByRole('link', { name: '利用枠を確認' })).toHaveAttribute('href', '/teacher/organizations/org-1/plan-limits')
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/App.test.tsx src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: 実装する**

`src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`に`orgId: string`propを追加し、`import { Link } from 'react-router-dom'`を追加したうえで、組織名見出しの直後に`<Link to={`/teacher/organizations/${orgId}/plan-limits`}>利用枠を確認</Link>`を追加する。

`src/App.tsx`に以下を追加する:

1. `import`に`PlanLimitsPage`（`./components/teacher/organizations/PlanLimitsPage`）・`getOrgPlanLimits`（`./lib/organizations/planLimits`）・`type PlanLimits`を追加する。
2. `SchoolOrgSettingsRoute`の定義の直後に新規ルートコンポーネントを追加する:

```tsx
function PlanLimitsRoute({ services }: { services: FirebaseServices }) {
  const { orgId } = useParams<{ orgId: string }>()
  const [data, setData] = useState<PlanLimits>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (!orgId) return
    getOrgPlanLimits(services.functions, { orgId }).then(setData).catch(() => setError('failed'))
  }, [services, orgId])
  return <PlanLimitsPage data={data} error={error} />
}
```

3. `<Routes>`内、`/teacher/organizations/:orgId/settings`ルートの直後に以下を追加する:

```tsx
  <Route path="/teacher/organizations/:orgId/plan-limits" element={enabled && services ? <TemplateRouteGuard services={services}><PlanLimitsRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
```

4. `SchoolOrgSettingsRoute`内の`<SchoolOrgSettingsPage .../>`呼び出しに`orgId={orgId}`を追加する。

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/App.test.tsx src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`
Expected: PASS

- [ ] **Step 5: モノレポ全体を検証する**

Run: `npm run verify`
Expected: 全ワークスペースのlint/typecheck/test/buildが通過する

- [ ] **Step 6: コミット**

```bash
git add src/App.tsx src/App.test.tsx src/components/teacher/organizations/SchoolOrgSettingsPage.tsx src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx
git commit -m "feat: 利用枠確認画面をルーティングに統合し、組織設定画面からリンク"
```
