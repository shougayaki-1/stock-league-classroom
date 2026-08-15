# 組織監査ログ(§21.6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 組織単位の高リスク操作(現時点では生徒データ一括エクスポート)を「誰が・いつ・何を・どの組織へ・結果」で記録し、組織のowner/adminが閲覧できるようにする。

**Architecture:** `functions/src/privacy/auditLog.ts` に改変不可・追記専用の書き込みヘルパー(`recordAuditLogEntry`)を新設し、`exportOrgStudentDataCallable` の成功・失敗の両方から呼び出す。読み取りは新規Callable `listOrgAuditLogCallable`(owner/admin限定)。クライアント側は `SchoolOrgSettingsPage` に直近ログを表示する最小限のセクションを追加する。

**Tech Stack:** Firebase Cloud Functions (TypeScript, `onCall` v2)、Firestore Admin SDK、Firestore Security Rules、React + Vitest + Testing Library。

## Global Constraints

- 監査ログのコレクションパスは `organizations/{orgId}/auditLog/{logId}`(`aiUsageLog` 等の既存サブコレクションと同じ配置パターンに合わせる)。
- 監査ログは追記専用(create-only)。update/delete用のAPIを一切実装しない。Firestoreルールもクライアントからの書き込みを一律拒否する(`allow write: if false`)。書き込みはCloud FunctionsのAdmin SDK経由のみ。
- 記録するフィールドは spec §21.6 の7項目: `actorUid`(誰が)・`occurredAt`(いつ、`FieldValue.serverTimestamp()`)・`action`(何を、文字列enum)・`orgId`(どの組織へ)・`before`/`after`(変更前後、任意・存在する場合のみ)・`reason`(理由、任意)・`result`(結果、`'SUCCESS' | 'FAILURE'`)。
- 個人情報を不要に複製しない: `before`/`after` には生徒の個人データそのものを入れず、件数などのメタデータのみを記録する。今回対象化する `exportOrgStudentDataCallable` には `before`/`after` の概念がないため省略してよい。
- 読み取り権限は spec §21.5 に従い owner/admin のみ(教師は不可)。owner/adminの区別を今回は設けず両方に全件読み取りを許可する(admin の「責任範囲」限定は将来の別スコープとし、コード中にコメントで明記する)。
- 認可チェックは既存の `requireActiveOrgMember`(`functions/src/organizations/authorization.ts`)を再利用する。新しい認可ヘルパーを作らない。
- 命名・コーディングスタイルは同ディレクトリの既存ファイル(`functions/src/privacy/exportOrgStudentData.ts`、`functions/src/privacy/onCall.ts`)に厳密に合わせる。1行にまとめられる短いガード節はこのコードベースの流儀通り1行で書く。

---

### Task 1: 監査ログの記録ヘルパーとFirestoreルール

**Files:**
- Create: `functions/src/privacy/auditLog.ts`
- Create: `functions/src/privacy/auditLog.test.ts`
- Modify: `firestore.rules` (74-77行目付近、`aiUsageCounters` の直後)
- Modify: `test/firestore.rules.test.ts` (`aiUsageCounters` の `describe` ブロックの直後)

**Interfaces:**
- Consumes: なし(Firestore Admin SDKの `Firestore` 型のみ)。
- Produces:
  - `export interface AuditLogEntryInput { orgId: string; actorUid: string; action: string; result: 'SUCCESS' | 'FAILURE'; reason?: string; before?: Record<string, unknown>; after?: Record<string, unknown> }`
  - `export const recordAuditLogEntry = async (db: FirebaseFirestore.Firestore, entry: AuditLogEntryInput): Promise<void>` — Task 2 がこれを呼び出す。
  - Firestoreコレクションパス `organizations/{orgId}/auditLog/{logId}` — Task 3 がこのパスを読み取りに使う。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/privacy/auditLog.test.ts` を新規作成:

```typescript
import { describe, expect, it, vi } from 'vitest'
import { recordAuditLogEntry } from './auditLog'

vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' } }))

const addMock = vi.fn()
const makeDb = () => ({ collection: (path: string) => ({ add: addMock }) }) as unknown as FirebaseFirestore.Firestore

describe('recordAuditLogEntry', () => {
  it('writes to organizations/{orgId}/auditLog with all provided fields plus a server timestamp', async () => {
    addMock.mockResolvedValueOnce({ id: 'log-1' })
    const db = makeDb()
    await recordAuditLogEntry(db, {
      orgId: 'org-1', actorUid: 'teacher-a', action: 'EXPORT_ORG_STUDENT_DATA', result: 'SUCCESS',
    })
    expect(addMock).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1', actorUid: 'teacher-a', action: 'EXPORT_ORG_STUDENT_DATA', result: 'SUCCESS',
      occurredAt: 'SERVER_TIMESTAMP',
    }))
  })

  it('omits reason/before/after from the written document when not provided', async () => {
    addMock.mockResolvedValueOnce({ id: 'log-2' })
    const db = makeDb()
    await recordAuditLogEntry(db, { orgId: 'org-1', actorUid: 'teacher-a', action: 'EXPORT_ORG_STUDENT_DATA', result: 'FAILURE' })
    const written = addMock.mock.calls[0][0]
    expect(written).not.toHaveProperty('reason')
    expect(written).not.toHaveProperty('before')
    expect(written).not.toHaveProperty('after')
  })

  it('includes reason/before/after when provided', async () => {
    addMock.mockResolvedValueOnce({ id: 'log-3' })
    const db = makeDb()
    await recordAuditLogEntry(db, {
      orgId: 'org-1', actorUid: 'teacher-a', action: 'EXPORT_ORG_STUDENT_DATA', result: 'SUCCESS',
      reason: '年度末の一括確認', before: { lessonRunCount: 3 }, after: { lessonRunCount: 3 },
    })
    expect(addMock).toHaveBeenCalledWith(expect.objectContaining({
      reason: '年度末の一括確認', before: { lessonRunCount: 3 }, after: { lessonRunCount: 3 },
    }))
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/privacy/auditLog.test.ts`
Expected: FAIL (`Cannot find module './auditLog'` または同等のエラー)

- [ ] **Step 3: 最小実装を書く**

`functions/src/privacy/auditLog.ts` を新規作成:

```typescript
import { FieldValue } from 'firebase-admin/firestore'

export interface AuditLogEntryInput {
  orgId: string
  actorUid: string
  action: string
  result: 'SUCCESS' | 'FAILURE'
  reason?: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}

/**
 * Spec §21.6: 誰が・いつ・何を・どの組織へ・変更前後・理由・結果を記録する
 * 追記専用の監査ログ。update/delete用のAPIは意図的に用意しない
 * (firestore.rules側でもクライアント直接書き込みを一律拒否する)。
 */
export const recordAuditLogEntry = async (db: FirebaseFirestore.Firestore, entry: AuditLogEntryInput): Promise<void> => {
  const { orgId, actorUid, action, result, reason, before, after } = entry
  const doc: Record<string, unknown> = { orgId, actorUid, action, result, occurredAt: FieldValue.serverTimestamp() }
  if (reason !== undefined) doc.reason = reason
  if (before !== undefined) doc.before = before
  if (after !== undefined) doc.after = after
  await db.collection(`organizations/${orgId}/auditLog`).add(doc)
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/privacy/auditLog.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Firestoreルールを追加する**

`firestore.rules` の74-77行目(`match /organizations/{orgId}/aiUsageCounters/{counterId} { allow read, write: if false; }` の直後)に追記:

```
    // Spec §21.6: 追記専用の監査ログ。書き込みはCloud FunctionsのAdmin SDK
    // 経由のみ(recordAuditLogEntry)。読み取りはlistOrgAuditLogCallable経由
    // が標準だが、将来の管理画面直接読み取りに備えowner/adminには開放する。
    match /organizations/{orgId}/auditLog/{logId} {
      allow read: if request.auth != null &&
        get(/databases/$(database)/documents/organizations/$(orgId)/members/$(request.auth.uid)).data.status == 'active' &&
        get(/databases/$(database)/documents/organizations/$(orgId)/members/$(request.auth.uid)).data.role in ['owner', 'admin'];
      allow write: if false;
    }
```

- [ ] **Step 6: ルールテストを追加する**

`test/firestore.rules.test.ts` の `describe('organizations/{orgId}/aiUsageCounters/{counterId}', ...)` ブロックの直後に追記:

```typescript
describe('organizations/{orgId}/auditLog/{logId}', () => {
  it('lets an active owner/admin read but denies a teacher and all client writes', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'organizations/org-1/members/owner-a'), { status: 'active', role: 'owner' })
      await setDoc(doc(context.firestore(), 'organizations/org-1/members/admin-a'), { status: 'active', role: 'admin' })
      await setDoc(doc(context.firestore(), 'organizations/org-1/members/teacher-a'), { status: 'active', role: 'teacher' })
      await setDoc(doc(context.firestore(), 'organizations/org-1/auditLog/log-1'), { orgId: 'org-1', actorUid: 'owner-a', action: 'EXPORT_ORG_STUDENT_DATA', result: 'SUCCESS' })
    })
    const owner = environment.authenticatedContext('owner-a', teacherToken)
    const admin = environment.authenticatedContext('admin-a', teacherToken)
    const teacher = environment.authenticatedContext('teacher-a', teacherToken)
    await assertSucceeds(getDoc(doc(owner.firestore(), 'organizations/org-1/auditLog/log-1')))
    await assertSucceeds(getDoc(doc(admin.firestore(), 'organizations/org-1/auditLog/log-1')))
    await assertFails(getDoc(doc(teacher.firestore(), 'organizations/org-1/auditLog/log-1')))
    await assertFails(setDoc(doc(owner.firestore(), 'organizations/org-1/auditLog/log-2'), { orgId: 'org-1', actorUid: 'owner-a', action: 'X', result: 'SUCCESS' }))
  })
})
```

- [ ] **Step 7: ルールテストを実行して通ることを確認する**

Run: `cd /Users/shoug/Documents/GitHub/stock-league-classroom && npm run test:rules`
Expected: 全テストPASS(既存133件 + 新規1件)

- [ ] **Step 8: コミット**

```bash
git add functions/src/privacy/auditLog.ts functions/src/privacy/auditLog.test.ts firestore.rules test/firestore.rules.test.ts
git commit -m "feat: 組織監査ログの記録ヘルパーとFirestoreルールを追加する"
```

---

### Task 2: `exportOrgStudentDataCallable` から監査ログを記録する

**Files:**
- Modify: `functions/src/privacy/onCall.ts:258-272`(`exportOrgStudentDataCallable` 定義)
- Modify: `functions/src/privacy/onCall.test.ts`

**Interfaces:**
- Consumes: `recordAuditLogEntry`・`AuditLogEntryInput`(Task 1、`./auditLog` からimport)
- Produces: なし(このCallableの戻り値・シグネチャは変更しない)

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/privacy/onCall.test.ts` の先頭付近、既存の `vi.mock('./exportOrgStudentData', ...)` の直後に以下を追加:

```typescript
vi.mock('./auditLog', () => ({ recordAuditLogEntry: vi.fn() }))
```

ファイル冒頭のimport群に以下を追加:

```typescript
import { recordAuditLogEntry } from './auditLog'
```

`exportOrgStudentDataCallable` のテストを探し(`describe('exportOrgStudentDataCallable'` または該当箇所)、その中に以下のテストを追加する:

```typescript
it('records a SUCCESS audit log entry after a successful export', async () => {
  vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
  vi.mocked(exportOrgStudentDataWithAdminSdk).mockResolvedValueOnce({ exportedAt: '2026-08-15T00:00:00.000Z', orgId: 'org-1', lessonRuns: [] })
  await exportOrgStudentDataCallable.run(makeRequest({ uid: 'owner-a', authTime: NOW_SECONDS, data: { orgId: 'org-1' } }))
  expect(recordAuditLogEntry).toHaveBeenCalledWith(expect.anything(), { orgId: 'org-1', actorUid: 'owner-a', action: 'EXPORT_ORG_STUDENT_DATA', result: 'SUCCESS' })
})

it('records a FAILURE audit log entry when the caller is not an owner', async () => {
  vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'admin', membershipVersion: 1 })
  await expect(exportOrgStudentDataCallable.run(makeRequest({ uid: 'admin-a', authTime: NOW_SECONDS, data: { orgId: 'org-1' } }))).rejects.toMatchObject({ code: 'permission-denied' })
  expect(recordAuditLogEntry).toHaveBeenCalledWith(expect.anything(), { orgId: 'org-1', actorUid: 'admin-a', action: 'EXPORT_ORG_STUDENT_DATA', result: 'FAILURE' })
})
```

`makeRequest` の実際のシグネチャ(uid/authTime/data)は既存のこのテストファイルの `makeRequest` 定義に合わせること(このファイル冒頭に既に定義されている)。

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/privacy/onCall.test.ts -t "audit log"`
Expected: FAIL(`recordAuditLogEntry` が呼ばれていない)

- [ ] **Step 3: 実装する**

`functions/src/privacy/onCall.ts` の先頭のimport群に追加:

```typescript
import { recordAuditLogEntry } from './auditLog'
```

`exportOrgStudentDataCallable` の本体を以下のように書き換える(既存の258-272行目付近):

```typescript
export const exportOrgStudentDataCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  if (!isReauthFresh(request.auth.token.auth_time as number | undefined, Date.now())) {
    throw new HttpsError('failed-precondition', 'セキュリティのため、再度サインインしてからお試しください。')
  }
  const data = request.data as ExportOrgStudentDataRequest
  if (typeof data.orgId !== 'string') throw new HttpsError('invalid-argument', 'orgId は必須です。')

  const db = getFirestore()
  const actorUid = request.auth.uid
  const orgId = data.orgId
  const logResult = (result: 'SUCCESS' | 'FAILURE') => recordAuditLogEntry(db, { orgId, actorUid, action: 'EXPORT_ORG_STUDENT_DATA', result })

  const membership = await requireActiveOrgMember(db, orgId, actorUid)
  if (membership.role !== 'owner') {
    await logResult('FAILURE')
    throw new HttpsError('permission-denied', '組織のownerのみ生徒データを一括エクスポートできます。')
  }

  const result = await exportOrgStudentDataWithAdminSdk(orgId)
  await logResult('SUCCESS')
  return result
})
```

既存コードは `getFirestore()` を `requireActiveOrgMember(getFirestore(), data.orgId, request.auth.uid)` のようにインラインで呼んでいたが、`db` を一度だけ変数に束縛して監査ログ書き込みと共有する形に変える。

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/privacy/onCall.test.ts`
Expected: PASS(既存テスト全件 + 新規2件)

- [ ] **Step 5: 型チェックを実行する**

Run: `cd functions && npx tsc --noEmit -p .`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add functions/src/privacy/onCall.ts functions/src/privacy/onCall.test.ts
git commit -m "feat: 生徒データ一括エクスポートの成否を監査ログに記録する"
```

---

### Task 3: 監査ログ閲覧Callable

**Files:**
- Modify: `functions/src/privacy/onCall.ts`(ファイル末尾に追加)
- Modify: `functions/src/privacy/onCall.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: `requireActiveOrgMember`(既存、`../organizations/authorization`)
- Produces:
  - `export const listOrgAuditLogCallable = onCall(...)` — Task 4のクライアントlibがこのCallable名(`'listOrgAuditLogCallable'`)を呼び出す。
  - レスポンス型: `{ entries: Array<{ id: string; actorUid: string; action: string; result: 'SUCCESS' | 'FAILURE'; occurredAt: string | null; reason?: string }> }`(`occurredAt` はISO文字列、Timestampが未反映な場合は`null`)。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/privacy/onCall.test.ts` の末尾に追加(既存の `getFirestore` モックが `.doc` のみを提供している場合は `.collection` も返すよう拡張する必要がある。ファイル冒頭の `vi.mock('firebase-admin/firestore', ...)` を以下のように書き換える):

```typescript
const auditLogDocs: Array<{ id: string; data: Record<string, unknown> }> = []
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: (path: string) => ({
      get: async () => {
        if (path.startsWith('organizations/')) return orgDocGetMock()
        const entry = resourceDocs.get(path)
        return { exists: entry?.exists ?? false, get: (field: string) => entry?.data?.[field] }
      },
    }),
    collection: (path: string) => ({
      orderBy: () => ({
        limit: () => ({
          get: async () => ({
            docs: path.includes('/auditLog')
              ? auditLogDocs.map((entry) => ({ id: entry.id, data: () => entry.data }))
              : [],
          }),
        }),
      }),
    }),
  }),
}))
```

ファイル末尾に新規 `describe` を追加:

```typescript
describe('listOrgAuditLogCallable', () => {
  beforeEach(() => { auditLogDocs.length = 0 })

  it('rejects a caller who is not an owner or admin of the org', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    await expect(listOrgAuditLogCallable.run(makeRequest({ uid: 'teacher-a', authTime: NOW_SECONDS, data: { orgId: 'org-1' } }))).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('returns recent entries for an owner', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    auditLogDocs.push({
      id: 'log-1',
      data: { orgId: 'org-1', actorUid: 'owner-a', action: 'EXPORT_ORG_STUDENT_DATA', result: 'SUCCESS', occurredAt: { toDate: () => new Date('2026-08-15T00:00:00.000Z') } },
    })
    const response = await listOrgAuditLogCallable.run(makeRequest({ uid: 'owner-a', authTime: NOW_SECONDS, data: { orgId: 'org-1' } }))
    expect(response).toEqual({ entries: [{ id: 'log-1', actorUid: 'owner-a', action: 'EXPORT_ORG_STUDENT_DATA', result: 'SUCCESS', occurredAt: '2026-08-15T00:00:00.000Z' }] })
  })
})
```

ファイル冒頭のimportに `listOrgAuditLogCallable` を追加。

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/privacy/onCall.test.ts -t "listOrgAuditLogCallable"`
Expected: FAIL(`listOrgAuditLogCallable` が存在しない)

- [ ] **Step 3: 実装する**

`functions/src/privacy/onCall.ts` の末尾に追加:

```typescript
interface ListOrgAuditLogRequest { orgId?: unknown }

export const listOrgAuditLogCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as ListOrgAuditLogRequest
  if (typeof data.orgId !== 'string') throw new HttpsError('invalid-argument', 'orgId は必須です。')

  const db = getFirestore()
  const membership = await requireActiveOrgMember(db, data.orgId, request.auth.uid)
  // §21.5: owner/adminのみ閲覧可。adminの責任範囲による絞り込みは別スコープとし、
  // 現時点ではowner/adminいずれも組織全体の監査ログを閲覧できる。
  if (membership.role !== 'owner' && membership.role !== 'admin') {
    throw new HttpsError('permission-denied', '組織のowner・adminのみ監査ログを閲覧できます。')
  }

  const snap = await db.collection(`organizations/${data.orgId}/auditLog`).orderBy('occurredAt', 'desc').limit(50).get()
  const entries = snap.docs.map((doc) => {
    const entryData = doc.data() as Record<string, unknown>
    const occurredAt = entryData.occurredAt as { toDate: () => Date } | undefined
    return {
      id: doc.id,
      actorUid: entryData.actorUid as string,
      action: entryData.action as string,
      result: entryData.result as 'SUCCESS' | 'FAILURE',
      occurredAt: occurredAt ? occurredAt.toDate().toISOString() : null,
      ...(entryData.reason !== undefined ? { reason: entryData.reason as string } : {}),
    }
  })
  return { entries }
})
```

`functions/src/index.ts` の `exportOrgStudentDataCallable` がexportされている行を探し、`listOrgAuditLogCallable` も同じ行または近くでexportに追加する(既存のexport文の形式に合わせる)。

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/privacy/onCall.test.ts`
Expected: PASS(既存テスト全件 + 新規4件)

- [ ] **Step 5: 全functionsテストと型チェックを実行する**

Run: `cd functions && npx vitest run && npx tsc --noEmit -p .`
Expected: 全件PASS、型エラーなし

- [ ] **Step 6: コミット**

```bash
git add functions/src/privacy/onCall.ts functions/src/privacy/onCall.test.ts functions/src/index.ts
git commit -m "feat: 組織監査ログ閲覧Callable(owner/admin限定)を追加する"
```

---

### Task 4: クライアントlibと管理画面への表示

**Files:**
- Create: `src/lib/privacy/orgAuditLog.ts`
- Create: `src/lib/privacy/orgAuditLog.test.ts`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: Callable名 `'listOrgAuditLogCallable'`(Task 3が定義)、レスポンス型 `{ entries: Array<{ id: string; actorUid: string; action: string; result: 'SUCCESS' | 'FAILURE'; occurredAt: string | null; reason?: string }> }`
- Produces: `SchoolOrgSettingsPage` の新規props `auditLogEntries: OrgAuditLogEntry[]`・`loadingAuditLog: boolean`(このタスク内で閉じる。他タスクからは参照されない)

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/privacy/orgAuditLog.test.ts` を新規作成(`src/lib/privacy/orgStudentDataExport.ts` に対応するテストがあればそのモック手法を踏襲。ない場合は以下のように直接書く):

```typescript
import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { listOrgAuditLog } from './orgAuditLog'

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

describe('listOrgAuditLog', () => {
  it('calls listOrgAuditLogCallable with the orgId and returns the entries', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { entries: [{ id: 'log-1', actorUid: 'owner-a', action: 'EXPORT_ORG_STUDENT_DATA', result: 'SUCCESS', occurredAt: '2026-08-15T00:00:00.000Z' }] } })
    vi.mocked(httpsCallable).mockReturnValue(callable as never)
    const result = await listOrgAuditLog({} as never, { orgId: 'org-1' })
    expect(httpsCallable).toHaveBeenCalledWith({}, 'listOrgAuditLogCallable')
    expect(callable).toHaveBeenCalledWith({ orgId: 'org-1' })
    expect(result).toEqual({ entries: [{ id: 'log-1', actorUid: 'owner-a', action: 'EXPORT_ORG_STUDENT_DATA', result: 'SUCCESS', occurredAt: '2026-08-15T00:00:00.000Z' }] })
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/lib/privacy/orgAuditLog.test.ts`
Expected: FAIL(`./orgAuditLog` が存在しない)

- [ ] **Step 3: 実装する**

`src/lib/privacy/orgAuditLog.ts` を新規作成(`src/lib/privacy/orgStudentDataExport.ts` と同じスタイル):

```typescript
import { httpsCallable, type Functions } from 'firebase/functions'

export interface OrgAuditLogEntry {
  id: string
  actorUid: string
  action: string
  result: 'SUCCESS' | 'FAILURE'
  occurredAt: string | null
  reason?: string
}

export interface ListOrgAuditLogInput { orgId: string }
export interface ListOrgAuditLogResult { entries: OrgAuditLogEntry[] }

export const listOrgAuditLog = async (functions: Functions, input: ListOrgAuditLogInput): Promise<ListOrgAuditLogResult> =>
  (await httpsCallable<ListOrgAuditLogInput, ListOrgAuditLogResult>(functions, 'listOrgAuditLogCallable')(input)).data
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/lib/privacy/orgAuditLog.test.ts`
Expected: PASS

- [ ] **Step 5: `SchoolOrgSettingsPage` に監査ログ表示を追加する**

まず `src/components/teacher/organizations/SchoolOrgSettingsPage.tsx` を読み、`onExportStudentData`/`exportingStudentData` props がどこに定義・使用されているかを確認する(直近コミット `42db5f2` を参照)。そのすぐ近くに以下のpropsを追加する:

```typescript
auditLogEntries?: OrgAuditLogEntry[]
loadingAuditLog?: boolean
```

(`OrgAuditLogEntry` は `../../../lib/privacy/orgAuditLog` からimportする。)

エクスポートボタンと同じ「owner/adminのみ表示」の条件(`canManageMembers`、既存コードで定義済み)を使い、以下のセクションをJSX内に追加する(生徒データエクスポートボタンの直後が自然な位置):

```tsx
{canManageMembers && (
  <section>
    <h3>監査ログ</h3>
    {loadingAuditLog ? (
      <p>読み込み中…</p>
    ) : (
      <ul>
        {(auditLogEntries ?? []).map((entry) => (
          <li key={entry.id}>
            {entry.occurredAt ?? '(日時不明)'} — {entry.actorUid} — {entry.action} — {entry.result === 'SUCCESS' ? '成功' : '失敗'}
          </li>
        ))}
      </ul>
    )}
  </section>
)}
```

既存コンポーネントのJSX構造(見出しレベル、セクション分けの仕方)に厳密に合わせること。既存の `<h3>` や `<section>` の使用パターンをファイル内で確認してから合わせる。

- [ ] **Step 6: コンポーネントテストを追加する**

`src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx` の `memberProps` に以下を追加:

```typescript
auditLogEntries: [],
loadingAuditLog: false,
```

新規テストを追加:

```typescript
it('shows audit log entries to an owner', () => {
  render(
    <MemoryRouter>
      <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false} {...memberProps} viewerUid="uid-owner" members={members}
        auditLogEntries={[{ id: 'log-1', actorUid: 'uid-owner', action: 'EXPORT_ORG_STUDENT_DATA', result: 'SUCCESS', occurredAt: '2026-08-15T00:00:00.000Z' }]} />
    </MemoryRouter>,
  )
  expect(screen.getByText(/EXPORT_ORG_STUDENT_DATA/)).toBeInTheDocument()
})

it('hides the audit log section from a teacher', () => {
  render(
    <MemoryRouter>
      <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false} {...memberProps} viewerUid="uid-teacher" members={members} />
    </MemoryRouter>,
  )
  expect(screen.queryByText('監査ログ')).not.toBeInTheDocument()
})
```

- [ ] **Step 7: テストを実行する**

Run: `npx vitest run src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`
Expected: PASS(既存テスト全件 + 新規2件)

- [ ] **Step 8: `App.tsx` の `SchoolOrgSettingsRoute` に配線する**

`git show 42db5f2 -- src/App.tsx` を参照し、同じ場所・同じスタイルで以下を追加する。`SchoolOrgSettingsRoute` 内、`onExportStudentData` の定義の近くに:

```typescript
const [auditLogEntries, setAuditLogEntries] = useState<OrgAuditLogEntry[]>([])
const [loadingAuditLog, setLoadingAuditLog] = useState(false)
```

`useEffect` で `orgId` が確定したタイミングで読み込む(既存の他の `useEffect` の書き方に合わせる):

```typescript
useEffect(() => {
  if (!orgId) return
  setLoadingAuditLog(true)
  void listOrgAuditLog(services.functions, { orgId }).then((result) => setAuditLogEntries(result.entries)).finally(() => setLoadingAuditLog(false))
}, [services, orgId])
```

`<SchoolOrgSettingsPage ...>` のJSXに `auditLogEntries={auditLogEntries} loadingAuditLog={loadingAuditLog}` を追加する。

ファイル冒頭のimportに追加:

```typescript
import { listOrgAuditLog, type OrgAuditLogEntry } from './lib/privacy/orgAuditLog'
```

- [ ] **Step 9: 全体テストと型チェックを実行する**

Run: `npx vitest run && npx tsc -b`
Expected: 全件PASS、型エラーなし

- [ ] **Step 10: コミット**

```bash
git add src/lib/privacy/orgAuditLog.ts src/lib/privacy/orgAuditLog.test.ts src/components/teacher/organizations/SchoolOrgSettingsPage.tsx src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx src/App.tsx
git commit -m "feat: 組織設定画面に監査ログの直近表示を追加する"
```

---

### Task 5: scope-backlog.mdの更新

**Files:**
- Modify: `docs/superpowers/scope-backlog.md`

**Interfaces:**
- Consumes: なし
- Produces: なし(ドキュメントのみの変更)

- [ ] **Step 1: Phase 7の該当行を更新する**

`docs/superpowers/scope-backlog.md` の「未着手項目(生徒データの組織単位の統制、残り4項目)」から「監査ログの実体(閲覧・実行ログの記録と表示)」の行を削除し、その直前または直後に以下を追記する:

```
**実装済み(2026-08-15):**

- 監査ログの実体 — `functions/src/privacy/auditLog.ts`(記録)・`listOrgAuditLogCallable`(閲覧、owner/admin限定)。現時点では`exportOrgStudentDataCallable`のみを記録対象とし、他の高リスク操作への拡張は追加のスコープとする。
```

- [ ] **Step 2: コミット**

```bash
git add docs/superpowers/scope-backlog.md
git commit -m "docs: 監査ログ実装をscope-backlogに反映する"
```
