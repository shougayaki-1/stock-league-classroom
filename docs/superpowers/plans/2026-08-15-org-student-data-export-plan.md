# 組織一括エクスポート(生徒データ) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学校組織のownerが、組織内の全lessonRunにまたがる生徒データ(参加者記録・チーム口座・注文履歴・家計決定)を一括エクスポートできるようにする。

**Architecture:** `exportPersonalData.ts`と同型のdeps注入パターンで純粋ロジック`exportOrgStudentData`を実装し、Admin SDK配線でlessonRunごとに4種類のサブコレクション(participants/teamAccounts/orders/households+decisions)を並列取得する。Callableは`isCallerTeacher`+`requireActiveOrgMember`(owner限定)+`isReauthFresh`(直近再認証)の3重チェックで保護する(`purgeHardDeleteCallable`と`exportPersonalDataCallable`双方の防御パターンを合成)。

**Tech Stack:** TypeScript, Firebase Cloud Functions (Callable, region `asia-northeast1`), Firestore Admin SDK, Vitest, React, MUI。

## Global Constraints

- Callable region は必ず `asia-northeast1`。
- 認可は「教師アカウント」+「対象組織のアクティブメンバーでrole==='owner'」+「直近10分以内の再サインイン(`isReauthFresh`)」の3つすべてを満たす必要がある。
- テンプレート・events・checkpointsは対象外。生徒データ(participants/teamAccounts/orders/households)のみを対象とする。
- 密なシングルライン関数本体という既存のハウススタイルに従う。
- 新しいコメントは「なぜ」が非自明な場合のみ追加する。

---

### Task 1: 純粋ロジック `exportOrgStudentData` を実装する

**Files:**
- Create: `functions/src/privacy/exportOrgStudentData.ts`
- Test: `functions/src/privacy/exportOrgStudentData.test.ts`

**Interfaces:**
- Consumes: なし(deps経由ですべて注入)
- Produces:
  - `export interface ExportOrgStudentDataDeps { orgId: string; listLessonRuns: () => Promise<Record<string, unknown>[]>; listParticipants: (lessonRunId: string) => Promise<Record<string, unknown>[]>; listTeamAccounts: (lessonRunId: string) => Promise<Record<string, unknown>[]>; listOrders: (lessonRunId: string) => Promise<Record<string, unknown>[]>; listHouseholds: (lessonRunId: string) => Promise<Record<string, unknown>[]>; listHouseholdDecisions: (lessonRunId: string, householdId: string) => Promise<Record<string, unknown>[]>; now?: () => string }`
  - `export const exportOrgStudentData = async (deps: ExportOrgStudentDataDeps) => {...}` — Task 2が呼ぶ。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/privacy/exportOrgStudentData.test.ts` を新規作成:

```ts
import { describe, expect, it, vi } from 'vitest'
import { exportOrgStudentData, type ExportOrgStudentDataDeps } from './exportOrgStudentData'

const makeDeps = (overrides: Partial<ExportOrgStudentDataDeps> = {}): ExportOrgStudentDataDeps => ({
  orgId: 'school-1',
  listLessonRuns: vi.fn().mockResolvedValue([{ id: 'run-1', status: 'COMPLETED' }]),
  listParticipants: vi.fn().mockResolvedValue([{ id: 'p1', displayName: '生徒A' }]),
  listTeamAccounts: vi.fn().mockResolvedValue([{ id: 'team-1', cash: 10000 }]),
  listOrders: vi.fn().mockResolvedValue([{ id: 'o1', side: 'BUY' }]),
  listHouseholds: vi.fn().mockResolvedValue([{ id: 'h1', name: '家計1' }]),
  listHouseholdDecisions: vi.fn().mockResolvedValue([{ id: 'd1', choice: 'SAVE' }]),
  now: () => '2026-08-15T00:00:00.000Z',
  ...overrides,
})

describe('exportOrgStudentData', () => {
  it('assembles participants/teamAccounts/orders/households(+decisions) for every lesson run', async () => {
    const deps = makeDeps()
    await expect(exportOrgStudentData(deps)).resolves.toEqual({
      exportedAt: '2026-08-15T00:00:00.000Z',
      orgId: 'school-1',
      lessonRuns: [{
        id: 'run-1', status: 'COMPLETED',
        participants: [{ id: 'p1', displayName: '生徒A' }],
        teamAccounts: [{ id: 'team-1', cash: 10000 }],
        orders: [{ id: 'o1', side: 'BUY' }],
        households: [{ id: 'h1', name: '家計1', decisions: [{ id: 'd1', choice: 'SAVE' }] }],
      }],
    })
  })

  it('calls each sub-collection getter with the lesson run id', async () => {
    const deps = makeDeps()
    await exportOrgStudentData(deps)
    expect(deps.listParticipants).toHaveBeenCalledWith('run-1')
    expect(deps.listTeamAccounts).toHaveBeenCalledWith('run-1')
    expect(deps.listOrders).toHaveBeenCalledWith('run-1')
    expect(deps.listHouseholds).toHaveBeenCalledWith('run-1')
  })

  it('calls listHouseholdDecisions with both the lesson run id and the household id', async () => {
    const deps = makeDeps()
    await exportOrgStudentData(deps)
    expect(deps.listHouseholdDecisions).toHaveBeenCalledWith('run-1', 'h1')
  })

  it('returns an empty lessonRuns array when the org has no lesson runs', async () => {
    const deps = makeDeps({ listLessonRuns: vi.fn().mockResolvedValue([]) })
    await expect(exportOrgStudentData(deps)).resolves.toMatchObject({ lessonRuns: [] })
    expect(deps.listParticipants).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/privacy/exportOrgStudentData.test.ts`
Expected: FAIL — `Cannot find module './exportOrgStudentData'`

- [ ] **Step 3: 最小実装を書く**

`functions/src/privacy/exportOrgStudentData.ts` を新規作成:

```ts
import { getFirestore } from 'firebase-admin/firestore'

export interface ExportOrgStudentDataDeps {
  orgId: string
  listLessonRuns: () => Promise<Record<string, unknown>[]>
  listParticipants: (lessonRunId: string) => Promise<Record<string, unknown>[]>
  listTeamAccounts: (lessonRunId: string) => Promise<Record<string, unknown>[]>
  listOrders: (lessonRunId: string) => Promise<Record<string, unknown>[]>
  listHouseholds: (lessonRunId: string) => Promise<Record<string, unknown>[]>
  listHouseholdDecisions: (lessonRunId: string, householdId: string) => Promise<Record<string, unknown>[]>
  now?: () => string
}

/**
 * Spec §21.7: org-wide bulk export scope. Deliberately narrower than
 * exportPersonalData — only the sub-collections that hold student-generated
 * data (participants/teamAccounts/orders/households), not templates or
 * operational replay logs (events/checkpoints).
 */
export const exportOrgStudentData = async (deps: ExportOrgStudentDataDeps) => {
  const runs = await deps.listLessonRuns()
  const lessonRuns = await Promise.all(runs.map(async (run) => {
    const runId = run.id as string
    const [participants, teamAccounts, orders, households] = await Promise.all([
      deps.listParticipants(runId), deps.listTeamAccounts(runId), deps.listOrders(runId), deps.listHouseholds(runId),
    ])
    const householdsWithDecisions = await Promise.all(households.map(async (household) => ({
      ...household, decisions: await deps.listHouseholdDecisions(runId, household.id as string),
    })))
    return { ...run, participants, teamAccounts, orders, households: householdsWithDecisions }
  }))
  return {
    exportedAt: (deps.now ?? (() => new Date().toISOString()))(),
    orgId: deps.orgId,
    lessonRuns,
  }
}

/**
 * Production wiring: Firestore Admin SDK collection queries scoped by
 * orgId/lessonRunId. Callers MUST have already verified authorization
 * (owner role + fresh reauth — see onCall.ts) before invoking this.
 */
export const exportOrgStudentDataWithAdminSdk = (orgId: string): ReturnType<typeof exportOrgStudentData> => {
  const db = getFirestore()
  const listCollection = async (query: FirebaseFirestore.Query): Promise<Record<string, unknown>[]> => {
    const snap = await query.get()
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  }
  return exportOrgStudentData({
    orgId,
    listLessonRuns: () => listCollection(db.collection('lessonRuns').where('orgId', '==', orgId)),
    listParticipants: (lessonRunId) => listCollection(db.collection(`lessonRuns/${lessonRunId}/participants`)),
    listTeamAccounts: (lessonRunId) => listCollection(db.collection(`lessonRuns/${lessonRunId}/teamAccounts`)),
    listOrders: (lessonRunId) => listCollection(db.collection(`lessonRuns/${lessonRunId}/orders`)),
    listHouseholds: (lessonRunId) => listCollection(db.collection(`lessonRuns/${lessonRunId}/households`)),
    listHouseholdDecisions: (lessonRunId, householdId) => listCollection(db.collection(`lessonRuns/${lessonRunId}/households/${householdId}/decisions`)),
  })
}
```

- [ ] **Step 4: テストを実行してパスを確認する**

Run: `cd functions && npx vitest run src/privacy/exportOrgStudentData.test.ts`
Expected: 全テストPASS(4件)

- [ ] **Step 5: コミット**

```bash
git add functions/src/privacy/exportOrgStudentData.ts functions/src/privacy/exportOrgStudentData.test.ts
git commit -m "feat: 組織一括エクスポート(生徒データ)の純粋ロジックを追加する"
```

---

### Task 2: Admin SDK配線の単体テストを追加する

**Files:**
- Test: `functions/src/privacy/exportOrgStudentData.adminSdk.test.ts`

**Interfaces:**
- Consumes: `exportOrgStudentDataWithAdminSdk`(Task 1)
- Produces: なし(既存実装の検証のみ)

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/privacy/exportOrgStudentData.adminSdk.test.ts` を新規作成:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const queryResults = new Map<string, Record<string, unknown>[]>()
const queryCalls: string[] = []

const collection = (path: string) => ({
  where: () => ({ get: async () => { queryCalls.push(path); return { docs: (queryResults.get(path) ?? []).map((data, i) => ({ id: `${path}-${i}`, data: () => data })) } } }),
  get: async () => { queryCalls.push(path); return { docs: (queryResults.get(path) ?? []).map((data, i) => ({ id: `${path}-${i}`, data: () => data })) } },
})

vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ collection }) }))

import { exportOrgStudentDataWithAdminSdk } from './exportOrgStudentData'

describe('exportOrgStudentDataWithAdminSdk', () => {
  beforeEach(() => { queryResults.clear(); queryCalls.length = 0 })

  it('queries lessonRuns filtered by orgId and each sub-collection by lessonRunId', async () => {
    queryResults.set('lessonRuns', [{ id: 'run-1' }])
    queryResults.set('lessonRuns/lessonRuns-0/participants', [{ displayName: '生徒A' }])
    queryResults.set('lessonRuns/lessonRuns-0/households', [])

    const result = await exportOrgStudentDataWithAdminSdk('school-1')

    expect(queryCalls).toContain('lessonRuns')
    expect(result.orgId).toBe('school-1')
    expect(result.lessonRuns).toHaveLength(1)
  })

  it('returns an empty export when the org has no lesson runs', async () => {
    const result = await exportOrgStudentDataWithAdminSdk('school-empty')
    expect(result.lessonRuns).toEqual([])
  })
})
```

- [ ] **Step 2: テストを実行してパスを確認する**

Run: `cd functions && npx vitest run src/privacy/exportOrgStudentData.adminSdk.test.ts`
Expected: 全テストPASS(2件、Task 1で既に実装済みのため最初からパスする)

- [ ] **Step 3: コミット**

```bash
git add functions/src/privacy/exportOrgStudentData.adminSdk.test.ts
git commit -m "test: exportOrgStudentDataWithAdminSdkのクエリ経路を検証するテストを追加する"
```

---

### Task 3: Callable `exportOrgStudentDataCallable` を追加する

**Files:**
- Modify: `functions/src/privacy/onCall.ts`
- Modify: `functions/src/index.ts`
- Test: `functions/src/privacy/onCall.test.ts`

**Interfaces:**
- Consumes: `exportOrgStudentDataWithAdminSdk`(Task 1)、`isCallerTeacher`(`../organizations/onCall`)、`requireActiveOrgMember`(`../organizations/authorization`)、`isReauthFresh`(同ファイル内、27行目)
- Produces: `export const exportOrgStudentDataCallable` — Task 5のフロントエンドが呼ぶ。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/privacy/onCall.test.ts` の4-11行目のimportブロックに`exportOrgStudentDataCallable`を追加:

```ts
import {
  exportOrgStudentDataCallable,
  exportPersonalDataCallable,
  isReauthFresh,
  normalizeResourcePath,
  purgeHardDeleteCallable,
  purgePersonalOrganizationCallable,
  requestSoftDeleteCallable,
  restoreSoftDeletedCallable,
} from './onCall'
```

13行目の直後(`import { requireActiveOrgMember } from '../organizations/authorization'`の直後)に追加:

```ts
import { exportOrgStudentDataWithAdminSdk } from './exportOrgStudentData'
```

24行目付近の`vi.mock('./exportPersonalData', () => ({ exportPersonalDataWithAdminSdk: vi.fn() }))`の直後に追加:

```ts
vi.mock('./exportOrgStudentData', () => ({ exportOrgStudentDataWithAdminSdk: vi.fn() }))
```

ファイル末尾に新しい`describe`ブロックを追加:

```ts

describe('exportOrgStudentDataCallable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(NOW_MS)
  })
  afterEach(() => { vi.useRealTimers() })

  it('rejects an anonymous caller, never touching Firestore', async () => {
    await expect(exportOrgStudentDataCallable.run(makeRequest({ noAuth: true }))).rejects.toMatchObject({ code: 'unauthenticated' })
    expect(requireActiveOrgMember).not.toHaveBeenCalled()
    expect(exportOrgStudentDataWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects a stale auth_time before checking org membership', async () => {
    const request = makeRequest({ authTime: NOW_SECONDS - 601, data: { orgId: 'school-1' } })
    await expect(exportOrgStudentDataCallable.run(request)).rejects.toMatchObject({ code: 'failed-precondition' })
    expect(requireActiveOrgMember).not.toHaveBeenCalled()
  })

  it('rejects a non-owner (admin/teacher) member', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'admin', membershipVersion: 1 })
    const request = makeRequest({ data: { orgId: 'school-1' } })
    await expect(exportOrgStudentDataCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
    expect(exportOrgStudentDataWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects a caller who is not an active org member', async () => {
    vi.mocked(requireActiveOrgMember).mockRejectedValueOnce(new Error('permission-denied'))
    const request = makeRequest({ data: { orgId: 'school-1' } })
    await expect(exportOrgStudentDataCallable.run(request)).rejects.toThrow('permission-denied')
  })

  it('returns the export for an owner with a fresh reauth', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    vi.mocked(exportOrgStudentDataWithAdminSdk).mockResolvedValueOnce({ exportedAt: '2026-08-15T00:00:00.000Z', orgId: 'school-1', lessonRuns: [] })
    const request = makeRequest({ data: { orgId: 'school-1' } })
    await expect(exportOrgStudentDataCallable.run(request)).resolves.toMatchObject({ orgId: 'school-1' })
    expect(exportOrgStudentDataWithAdminSdk).toHaveBeenCalledWith('school-1')
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/privacy/onCall.test.ts`
Expected: FAIL — `exportOrgStudentDataCallable`が`./onCall`からexportされていない

- [ ] **Step 3: 実装する**

`functions/src/privacy/onCall.ts` のファイル末尾に追加:

```ts

interface ExportOrgStudentDataRequest { orgId?: unknown }

export const exportOrgStudentDataCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  if (!isReauthFresh(request.auth.token.auth_time as number | undefined, Date.now())) {
    throw new HttpsError('failed-precondition', 'セキュリティのため、再度サインインしてからお試しください。')
  }
  const data = request.data as ExportOrgStudentDataRequest
  if (typeof data.orgId !== 'string') throw new HttpsError('invalid-argument', 'orgId は必須です。')

  const membership = await requireActiveOrgMember(getFirestore(), data.orgId, request.auth.uid)
  if (membership.role !== 'owner') throw new HttpsError('permission-denied', '組織のownerのみ生徒データを一括エクスポートできます。')

  return exportOrgStudentDataWithAdminSdk(data.orgId)
})
```

- [ ] **Step 4: `index.ts` にexportを追加する**

`functions/src/index.ts` の98行目付近の`exportPersonalDataCallable,`の直前に追加:

```ts
  exportOrgStudentDataCallable,
```

- [ ] **Step 5: テストを実行してパスを確認する**

Run: `cd functions && npx tsc --noEmit && npx vitest run`
Expected: 全テストPASS、型エラーなし

- [ ] **Step 6: コミット**

```bash
git add functions/src/privacy/onCall.ts functions/src/privacy/onCall.test.ts functions/src/index.ts
git commit -m "feat: exportOrgStudentDataCallableを追加する"
```

---

### Task 4: クライアントlibとダウンロードヘルパーを実装する

**Files:**
- Create: `src/lib/privacy/orgStudentDataExport.ts`
- Create: `src/lib/privacy/orgStudentDataExport.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `export const exportOrgStudentData = async (functions: Functions, input: { orgId: string }): Promise<OrgStudentDataExport>` — Callableラッパー。
  - `export const downloadAsJsonFile = (data: unknown, filename: string): void` — ブラウザでJSONファイルをダウンロードさせる。Task 5が呼ぶ。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/privacy/orgStudentDataExport.test.ts` を新規作成:

```ts
import { describe, expect, it, vi, afterEach } from 'vitest'
import { downloadAsJsonFile } from './orgStudentDataExport'

describe('downloadAsJsonFile', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('creates an object URL for a JSON blob and triggers a click via a temporary anchor', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:mock-url')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const clickSpy = vi.fn()
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag)
      if (tag === 'a') el.click = clickSpy
      return el
    })

    downloadAsJsonFile({ hello: 'world' }, 'export.json')

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(clickSpy).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run src/lib/privacy/orgStudentDataExport.test.ts`
Expected: FAIL — `Cannot find module './orgStudentDataExport'`

- [ ] **Step 3: 実装する**

`src/lib/privacy/orgStudentDataExport.ts` を新規作成:

```ts
import { httpsCallable, type Functions } from 'firebase/functions'

export interface OrgStudentDataExport {
  exportedAt: string
  orgId: string
  lessonRuns: Array<Record<string, unknown>>
}

export interface ExportOrgStudentDataInput { orgId: string }

export const exportOrgStudentData = async (functions: Functions, input: ExportOrgStudentDataInput): Promise<OrgStudentDataExport> =>
  (await httpsCallable<ExportOrgStudentDataInput, OrgStudentDataExport>(functions, 'exportOrgStudentDataCallable')(input)).data

export const downloadAsJsonFile = (data: unknown, filename: string): void => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 4: テストを実行してパスを確認する**

Run: `npx vitest run src/lib/privacy/orgStudentDataExport.test.ts`
Expected: 全テストPASS(1件)

- [ ] **Step 5: コミット**

```bash
git add src/lib/privacy/orgStudentDataExport.ts src/lib/privacy/orgStudentDataExport.test.ts
git commit -m "feat: 組織一括エクスポートのクライアントlibとダウンロードヘルパーを追加する"
```

---

### Task 5: `SchoolOrgSettingsPage.tsx` にowner限定のエクスポートボタンを追加する

**Files:**
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `exportOrgStudentData`/`downloadAsJsonFile`(Task 4)
- Produces: なし(既存ページへのボタン追加のみ)

- [ ] **Step 1: 失敗するテストを書く**

`src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`は`fireEvent`/`vi`とも既にimport済み(ファイル冒頭の`import { fireEvent, render, screen } from '@testing-library/react'`と`import { describe, expect, it, vi } from 'vitest'`)。追加importは不要。

ファイル末尾に新しい`it`ブロックを2つ追加:

```tsx
  it('shows an export-student-data button to an owner and calls onExportStudentData on click', () => {
    const onExportStudentData = vi.fn()
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false} {...memberProps} viewerUid="uid-owner" members={members} onExportStudentData={onExportStudentData} exportingStudentData={false} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '生徒データを一括エクスポート' }))
    expect(onExportStudentData).toHaveBeenCalled()
  })

  it('hides the export-student-data button from a teacher', () => {
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false} {...memberProps} viewerUid="uid-teacher" members={members} onExportStudentData={vi.fn()} exportingStudentData={false} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button', { name: '生徒データを一括エクスポート' })).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`
Expected: FAIL — `onExportStudentData`が呼ばれない・ボタンが存在しない

- [ ] **Step 3: `SchoolOrgSettingsPage.tsx` にpropsとボタンを追加する**

`src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`の`SchoolOrgSettingsPageProps`インターフェース(11-26行目)の`onChangeRole`の行の直後に追加:

```ts
  onExportStudentData: () => void
  exportingStudentData: boolean
```

同ファイルの関数コンポーネントの分割代入引数リスト(28-30行目)に`onExportStudentData, exportingStudentData`を追加:

```tsx
export function SchoolOrgSettingsPage({
  orgName, orgId, invitations, onInvite, inviting, members, viewerUid, canManageMembers, onSuspendMember, suspending, teacherSeatLimit, parentOrgName, onRevokeInvitation, onChangeRole, onExportStudentData, exportingStudentData,
}: SchoolOrgSettingsPageProps) {
```

`{(viewerRole === 'owner' || viewerRole === 'admin') && <Link to={...}>承認待ちテンプレートを確認</Link>}`の直後に追加(`Button`は冒頭の`import { Button, List, ListItem, ListItemText, MenuItem, Stack, TextField, Typography } from '@mui/material'`に既に含まれているため追加import不要):

```tsx
      {viewerRole === 'owner' && <Button variant="outlined" disabled={exportingStudentData} onClick={onExportStudentData}>生徒データを一括エクスポート</Button>}
```

- [ ] **Step 4: テストを実行してパスを確認する**

Run: `npx vitest run src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`
Expected: 全テストPASS

- [ ] **Step 5: `App.tsx` の`SchoolOrgSettingsRoute`に配線する**

`src/App.tsx`の`import { UsageDashboardPage } from './components/teacher/organizations/UsageDashboardPage'`の直後に追加:

```ts
import { exportOrgStudentData, downloadAsJsonFile } from './lib/privacy/orgStudentDataExport'
```

`function SchoolOrgSettingsRoute({ services }: { services: FirebaseServices }) {`(462行目)の直後、`const [invitations, setInvitations] = useState<Invitation[]>([])`(464行目)の直前に追加:

```ts
  const [exportingStudentData, setExportingStudentData] = useState(false)
```

500-501行目の`const viewerMembership = members.find((member) => member.uid === uid)` / `const canManageMembers = ...`の直後、`return (`(503行目)の直前に追加:

```ts
  const onExportStudentData = () => {
    setExportingStudentData(true)
    void exportOrgStudentData(services.functions, { orgId })
      .then((data) => downloadAsJsonFile(data, `student-data-${orgId}.json`))
      .finally(() => setExportingStudentData(false))
  }
```

(499行目の`if (!orgId || !uid) return <GuardLoading />`より後なので、この時点で`orgId`は`string`に絞り込まれている。)

536行目の`onInvite={async (email, role) => {...}}`ブロック(527-536行目)の直後、`/>`(537行目)の直前に追加:

```ts
      onExportStudentData={onExportStudentData}
      exportingStudentData={exportingStudentData}
```

- [ ] **Step 6: フロントエンド全体の型チェックとテストを実行する**

Run: `npx tsc -b && npx tsc -p tsconfig.rules.json && npx vitest run`
Expected: 全テストPASS、型エラーなし

- [ ] **Step 7: コミット**

```bash
git add src/components/teacher/organizations/SchoolOrgSettingsPage.tsx src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx src/App.tsx
git commit -m "feat: 組織設定画面に生徒データ一括エクスポートボタンを追加する"
```
