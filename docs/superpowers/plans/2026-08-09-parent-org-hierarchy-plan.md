# 上位組織と学校の階層 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**正本:** `docs/superpowers/specs/2026-08-09-parent-org-hierarchy-design.md`(設計仕様)。矛盾する場合は仕様書を優先する。

**Goal:** 上位組織(自治体・学校法人)を作成でき、既存の学校組織を上位組織の配下として紐付け・解除・一覧できるようにする。

**Architecture:** `organizations/{orgId}`に`type: 'parentOrg'`という新しい組織種別と、学校組織向けの`parentOrgId`フィールドを追加する。紐付け・解除は、両組織のowner/admin権限をCallable境界で確認したうえで、既存の`createSchoolOrg`と同じ設計原則(認可はCallable層、業務ルールは純粋関数層)に従う。

**Tech Stack:** TypeScript, React, MUI, react-router, Firebase Cloud Functions v2 (`onCall`), Firebase Admin SDK (Firestore), Vitest, React Testing Library。

## Global Constraints

- 本計画は**Phase Fサブプロジェクト1(学校組織の作成・招待)の完了を前提とする**(`organizations/{orgId}.type: 'school'`・`SchoolOrgSettingsPage`が既に存在する、2026-08-09時点で実装済み)。
- 上位組織自体には`planId`を付与しない。
- 紐付け(`linkSchoolToParentOrgCallable`)は呼び出し元が**両方の組織**のowner/adminであることを要求する。解除(`unlinkSchoolFromParentOrgCallable`)は呼び出し元が**現在の上位組織**のowner/adminであることを要求する。
- `organizations/{orgId}`への直接クライアント書き込みは引き続き`allow write: if false`(既存のまま変更しない)。`parentOrgId`の変更もAdmin SDK専用のCallable経由のみ。
- 新規Callableは`functions/src/index.ts`からexportする。
- 日本語UI文言を用いる。
- 各タスクの実装後、そのタスクが変更したファイルのテストを実行してから次のタスクに進む。全タスク完了後、`npm run verify`を実行し、通過することを確認してからコミットする。

---

## File Structure

| File | Change |
| --- | --- |
| `functions/src/organizations/parentOrg.ts`, `.test.ts` | Create（Task 1） |
| `functions/src/organizations/schoolHierarchy.ts`, `.test.ts` | Create（Task 2） |
| `functions/src/organizations/onCall.ts`, `.test.ts` | Modify（Task 3。4つのCallable追加） |
| `functions/src/index.ts` | Modify（Task 3。export追加） |
| `src/lib/organizations/parentOrg.ts`, `.test.ts` | Create（Task 4） |
| `src/lib/organizations/schoolHierarchy.ts`, `.test.ts` | Create（Task 4） |
| `src/components/teacher/organizations/ParentOrgSettingsPage.tsx`, `.test.tsx` | Create（Task 5） |
| `src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`, `.test.tsx` | Modify（Task 6） |
| `src/App.tsx`, `.test.tsx` | Modify（Task 7） |

---

### Task 1: `createParentOrg`（純粋関数 — 上位組織の作成）

**Files:**
- Create: `functions/src/organizations/parentOrg.ts`
- Test: `functions/src/organizations/parentOrg.test.ts`

**Interfaces:**
- Consumes: なし。
- Produces: `CreateParentOrgInput { name: string; ownerUid: string }`、`CreateParentOrgResult { orgId: string }`、`createParentOrg(deps, input): Promise<CreateParentOrgResult>`、`createParentOrgWithAdminSdk(input): Promise<CreateParentOrgResult>`。Task 3で消費される。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// functions/src/organizations/parentOrg.test.ts
import { describe, expect, it } from 'vitest'
import { createParentOrg } from './parentOrg'

const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    runTransaction: async (fn: (tx: {
      set: (path: string, data: Record<string, unknown>) => void
    }) => Promise<void>) => fn({ set: (path, data) => { docs.set(path, data) } }),
  }
}

describe('createParentOrg', () => {
  it('creates a parent organization and its owner membership, without a planId', async () => {
    const fake = makeFakeFirestore()
    const rtdbWrites: unknown[] = []
    const result = await createParentOrg({
      firestore: fake as never,
      generateOrgId: () => 'parentOrg_fixed-id',
      writeOrgAccessMirror: async (payload) => { rtdbWrites.push(payload) },
    }, { name: '桜丘市教育委員会', ownerUid: 'uid-1' })

    expect(result).toEqual({ orgId: 'parentOrg_fixed-id' })
    const org = fake.docs.get('organizations/parentOrg_fixed-id')
    expect(org).toMatchObject({ type: 'parentOrg', name: '桜丘市教育委員会', ownerUid: 'uid-1' })
    expect(org).not.toHaveProperty('planId')
    expect(fake.docs.get('organizations/parentOrg_fixed-id/members/uid-1')).toMatchObject({ role: 'owner', status: 'active', membershipVersion: 1 })
    expect(rtdbWrites).toEqual([{ orgId: 'parentOrg_fixed-id', uid: 'uid-1', role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 }])
  })

  it('creates a new organization on every call', async () => {
    const fake = makeFakeFirestore()
    let counter = 0
    const generateOrgId = () => `parentOrg_${(counter += 1)}`
    await createParentOrg({ firestore: fake as never, generateOrgId, writeOrgAccessMirror: async () => {} }, { name: 'A', ownerUid: 'uid-1' })
    await createParentOrg({ firestore: fake as never, generateOrgId, writeOrgAccessMirror: async () => {} }, { name: 'B', ownerUid: 'uid-1' })
    expect(fake.docs.has('organizations/parentOrg_1')).toBe(true)
    expect(fake.docs.has('organizations/parentOrg_2')).toBe(true)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/organizations/parentOrg.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装する**

```ts
// functions/src/organizations/parentOrg.ts
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { getDatabase } from 'firebase-admin/database'
import { randomUUID } from 'node:crypto'
import type { OrgAccessMirrorPayload } from './personalOrg'

export interface CreateParentOrgInput { name: string; ownerUid: string }
export interface CreateParentOrgResult { orgId: string }

interface FirestoreTransaction { set: (path: string, data: Record<string, unknown>) => void }
export interface CreateParentOrgDeps {
  firestore: { runTransaction: (fn: (tx: FirestoreTransaction) => Promise<void>) => Promise<void> }
  generateOrgId: () => string
  writeOrgAccessMirror: (payload: OrgAccessMirrorPayload) => Promise<void>
  now?: () => unknown
}

/**
 * createSchoolOrgと同じ「1人1つ」制約なしのパターン。上位組織には
 * planId/verificationStatusを持たせない——上位組織自体のプラン・課金・
 * 認証状態は本サブプロジェクトの範囲外。
 */
export const createParentOrg = async (deps: CreateParentOrgDeps, input: CreateParentOrgInput): Promise<CreateParentOrgResult> => {
  const orgId = deps.generateOrgId()
  const nowValue = deps.now ? deps.now() : new Date().toISOString()
  const orgPath = `organizations/${orgId}`
  const memberPath = `organizations/${orgId}/members/${input.ownerUid}`

  await deps.firestore.runTransaction(async (tx) => {
    tx.set(orgPath, { type: 'parentOrg', name: input.name, ownerUid: input.ownerUid, createdAt: nowValue })
    tx.set(memberPath, { role: 'owner', status: 'active', membershipVersion: 1, joinedAt: nowValue })
  })

  await deps.writeOrgAccessMirror({ orgId, uid: input.ownerUid, role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 })

  return { orgId }
}

/** Production wiring: Firestore Admin SDK + RTDB Admin SDK. */
export const createParentOrgWithAdminSdk = (input: CreateParentOrgInput): Promise<CreateParentOrgResult> => {
  const db = getFirestore()
  return createParentOrg({
    firestore: {
      runTransaction: (fn) => db.runTransaction(async (tx) => fn({
        set: (path, data) => { tx.set(db.doc(path), { ...data, createdAt: FieldValue.serverTimestamp() }) },
      })),
    },
    generateOrgId: () => `parentOrg_${randomUUID()}`,
    writeOrgAccessMirror: async (payload) => {
      await getDatabase().ref().update({
        [`orgAccess/${payload.orgId}/${payload.uid}`]: {
          role: payload.role, status: payload.status, membershipVersion: payload.membershipVersion, revokedAtSeconds: payload.revokedAtSeconds,
        },
        [`orgAccessMeta/${payload.orgId}/${payload.uid}`]: { syncState: 'SYNCED' },
      })
    },
  }, input)
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/organizations/parentOrg.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add functions/src/organizations/parentOrg.ts functions/src/organizations/parentOrg.test.ts
git commit -m "feat: 上位組織の作成ロジック(createParentOrg)を追加"
```

---

### Task 2: `schoolHierarchy`（純粋関数 — 紐付け・解除・一覧）

**Files:**
- Create: `functions/src/organizations/schoolHierarchy.ts`
- Test: `functions/src/organizations/schoolHierarchy.test.ts`

**Interfaces:**
- Consumes: なし。
- Produces: `ChildSchool`型、`linkSchoolToParentOrg(deps, input): Promise<void>`、`unlinkSchoolFromParentOrg(deps, input): Promise<void>`、`listChildSchools(deps, input): Promise<ChildSchool[]>`、各`...WithAdminSdk`版。Task 3で消費される。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// functions/src/organizations/schoolHierarchy.test.ts
import { describe, expect, it, vi } from 'vitest'
import { linkSchoolToParentOrg, listChildSchools, unlinkSchoolFromParentOrg } from './schoolHierarchy'

describe('linkSchoolToParentOrg', () => {
  it('rejects a target that is not a school organization', async () => {
    await expect(linkSchoolToParentOrg({
      getOrg: async () => ({ type: 'personal', parentOrgId: null }), setParentOrgId: vi.fn(),
    }, { parentOrgId: 'parent-1', schoolOrgId: 'school-1' })).rejects.toThrow('対象は学校組織ではありません')
  })

  it('rejects a school that already has a parent organization', async () => {
    await expect(linkSchoolToParentOrg({
      getOrg: async () => ({ type: 'school', parentOrgId: 'parent-existing' }), setParentOrgId: vi.fn(),
    }, { parentOrgId: 'parent-1', schoolOrgId: 'school-1' })).rejects.toThrow('この学校は既に別の上位組織に所属しています')
  })

  it('links an unlinked school organization', async () => {
    const setParentOrgId = vi.fn()
    await linkSchoolToParentOrg({
      getOrg: async () => ({ type: 'school', parentOrgId: null }), setParentOrgId,
    }, { parentOrgId: 'parent-1', schoolOrgId: 'school-1' })
    expect(setParentOrgId).toHaveBeenCalledWith('school-1', 'parent-1')
  })
})

describe('unlinkSchoolFromParentOrg', () => {
  it('rejects a school with no parent organization', async () => {
    await expect(unlinkSchoolFromParentOrg({
      getOrg: async () => ({ parentOrgId: null }), clearParentOrgId: vi.fn(),
    }, { schoolOrgId: 'school-1' })).rejects.toThrow('この学校はどの上位組織にも所属していません')
  })

  it('clears the parentOrgId of a linked school', async () => {
    const clearParentOrgId = vi.fn()
    await unlinkSchoolFromParentOrg({
      getOrg: async () => ({ parentOrgId: 'parent-1' }), clearParentOrgId,
    }, { schoolOrgId: 'school-1' })
    expect(clearParentOrgId).toHaveBeenCalledWith('school-1')
  })
})

describe('listChildSchools', () => {
  it('delegates to the query function with the parent org id', async () => {
    const queryChildSchools = vi.fn(async () => [{ orgId: 'school-1', name: 'A高校', verificationStatus: 'PENDING' }])
    await expect(listChildSchools({ queryChildSchools }, { parentOrgId: 'parent-1' })).resolves.toHaveLength(1)
    expect(queryChildSchools).toHaveBeenCalledWith('parent-1')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/organizations/schoolHierarchy.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装する**

```ts
// functions/src/organizations/schoolHierarchy.ts
import { getFirestore } from 'firebase-admin/firestore'

export interface ChildSchool { orgId: string; name: string; verificationStatus: string }

// ---- linkSchoolToParentOrg ----

interface OrgSnapshot { type: string; parentOrgId: string | null }
export interface LinkSchoolToParentOrgDeps {
  getOrg: (orgId: string) => Promise<OrgSnapshot | null>
  setParentOrgId: (schoolOrgId: string, parentOrgId: string) => Promise<void>
}
export interface LinkSchoolToParentOrgInput { parentOrgId: string; schoolOrgId: string }

export const linkSchoolToParentOrg = async (deps: LinkSchoolToParentOrgDeps, input: LinkSchoolToParentOrgInput): Promise<void> => {
  const school = await deps.getOrg(input.schoolOrgId)
  if (!school || school.type !== 'school') throw new Error('対象は学校組織ではありません')
  if (school.parentOrgId) throw new Error('この学校は既に別の上位組織に所属しています')
  await deps.setParentOrgId(input.schoolOrgId, input.parentOrgId)
}

/** Production wiring: Firestore Admin SDK. */
export const linkSchoolToParentOrgWithAdminSdk = (input: LinkSchoolToParentOrgInput): Promise<void> => {
  const db = getFirestore()
  return linkSchoolToParentOrg({
    getOrg: async (orgId) => {
      const snap = await db.doc(`organizations/${orgId}`).get()
      return snap.exists ? { type: snap.get('type') as string, parentOrgId: (snap.get('parentOrgId') as string | undefined) ?? null } : null
    },
    setParentOrgId: async (schoolOrgId, parentOrgId) => {
      await db.doc(`organizations/${schoolOrgId}`).update({ parentOrgId })
    },
  }, input)
}

// ---- unlinkSchoolFromParentOrg ----

export interface UnlinkSchoolFromParentOrgDeps {
  getOrg: (orgId: string) => Promise<{ parentOrgId: string | null } | null>
  clearParentOrgId: (schoolOrgId: string) => Promise<void>
}
export interface UnlinkSchoolFromParentOrgInput { schoolOrgId: string }

export const unlinkSchoolFromParentOrg = async (deps: UnlinkSchoolFromParentOrgDeps, input: UnlinkSchoolFromParentOrgInput): Promise<void> => {
  const school = await deps.getOrg(input.schoolOrgId)
  if (!school?.parentOrgId) throw new Error('この学校はどの上位組織にも所属していません')
  await deps.clearParentOrgId(input.schoolOrgId)
}

/** Production wiring: Firestore Admin SDK. */
export const unlinkSchoolFromParentOrgWithAdminSdk = (input: UnlinkSchoolFromParentOrgInput): Promise<void> => {
  const db = getFirestore()
  return unlinkSchoolFromParentOrg({
    getOrg: async (orgId) => {
      const snap = await db.doc(`organizations/${orgId}`).get()
      return snap.exists ? { parentOrgId: (snap.get('parentOrgId') as string | undefined) ?? null } : null
    },
    clearParentOrgId: async (schoolOrgId) => { await db.doc(`organizations/${schoolOrgId}`).update({ parentOrgId: null }) },
  }, input)
}

// ---- listChildSchools ----

export interface ListChildSchoolsDeps { queryChildSchools: (parentOrgId: string) => Promise<ChildSchool[]> }
export interface ListChildSchoolsInput { parentOrgId: string }

export const listChildSchools = (deps: ListChildSchoolsDeps, input: ListChildSchoolsInput): Promise<ChildSchool[]> =>
  deps.queryChildSchools(input.parentOrgId)

/** Production wiring: Firestore Admin SDK. Never reads member/student data — only orgId/name/verificationStatus. */
export const listChildSchoolsWithAdminSdk = (input: ListChildSchoolsInput): Promise<ChildSchool[]> => {
  const db = getFirestore()
  return listChildSchools({
    queryChildSchools: async (parentOrgId) => {
      const snap = await db.collection('organizations').where('parentOrgId', '==', parentOrgId).get()
      return snap.docs.map((doc) => ({ orgId: doc.id, name: doc.get('name') as string, verificationStatus: doc.get('verificationStatus') as string }))
    },
  }, input)
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/organizations/schoolHierarchy.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add functions/src/organizations/schoolHierarchy.ts functions/src/organizations/schoolHierarchy.test.ts
git commit -m "feat: 学校の紐付け・解除・一覧ロジック(schoolHierarchy)を追加"
```

---

### Task 3: 4つのCallable

**Files:**
- Modify: `functions/src/organizations/onCall.ts`
- Modify: `functions/src/organizations/onCall.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: `createParentOrgWithAdminSdk`（Task 1）、`linkSchoolToParentOrgWithAdminSdk`/`unlinkSchoolFromParentOrgWithAdminSdk`/`listChildSchoolsWithAdminSdk`（Task 2）、`requireActiveOrgMember`（既存）。
- Produces: `createParentOrgCallable`・`linkSchoolToParentOrgCallable`・`unlinkSchoolFromParentOrgCallable`・`listChildSchoolsCallable`。Task 4で消費される。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/organizations/onCall.test.ts`の`import`・`vi.mock`群に追記する:

```ts
import { createParentOrgCallable, linkSchoolToParentOrgCallable, listChildSchoolsCallable, unlinkSchoolFromParentOrgCallable } from './onCall'
import { createParentOrgWithAdminSdk } from './parentOrg'
import { linkSchoolToParentOrgWithAdminSdk, listChildSchoolsWithAdminSdk, unlinkSchoolFromParentOrgWithAdminSdk } from './schoolHierarchy'

vi.mock('./parentOrg', () => ({ createParentOrgWithAdminSdk: vi.fn() }))
vi.mock('./schoolHierarchy', () => ({
  linkSchoolToParentOrgWithAdminSdk: vi.fn(), unlinkSchoolFromParentOrgWithAdminSdk: vi.fn(), listChildSchoolsWithAdminSdk: vi.fn(),
}))
```

ファイル末尾に追記する:

```ts
describe('createParentOrgCallable', () => {
  beforeEach(() => vi.clearAllMocks())
  it('rejects an empty name', async () => {
    const request = { auth: teacher, data: { name: '' } } as unknown as CallableRequest
    await expect(createParentOrgCallable.run(request)).rejects.toMatchObject({ code: 'invalid-argument' })
  })
  it('creates a parent org for an authenticated teacher', async () => {
    vi.mocked(createParentOrgWithAdminSdk).mockResolvedValueOnce({ orgId: 'parentOrg_1' })
    const request = { auth: teacher, data: { name: '桜丘市教育委員会' } } as unknown as CallableRequest
    await expect(createParentOrgCallable.run(request)).resolves.toEqual({ orgId: 'parentOrg_1' })
  })
})

describe('linkSchoolToParentOrgCallable', () => {
  beforeEach(() => vi.clearAllMocks())
  it('rejects a caller who is not owner/admin of the parent organization', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    const request = { auth: teacher, data: { parentOrgId: 'parent-1', schoolOrgId: 'school-1' } } as unknown as CallableRequest
    await expect(linkSchoolToParentOrgCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
  })
  it('rejects a caller who is not owner/admin of the school organization', async () => {
    vi.mocked(requireActiveOrgMember)
      .mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
      .mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    const request = { auth: teacher, data: { parentOrgId: 'parent-1', schoolOrgId: 'school-1' } } as unknown as CallableRequest
    await expect(linkSchoolToParentOrgCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
  })
  it('links when the caller manages both organizations', async () => {
    vi.mocked(requireActiveOrgMember)
      .mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
      .mockResolvedValueOnce({ role: 'admin', membershipVersion: 1 })
    vi.mocked(linkSchoolToParentOrgWithAdminSdk).mockResolvedValueOnce(undefined)
    const request = { auth: teacher, data: { parentOrgId: 'parent-1', schoolOrgId: 'school-1' } } as unknown as CallableRequest
    await expect(linkSchoolToParentOrgCallable.run(request)).resolves.toBeUndefined()
    expect(linkSchoolToParentOrgWithAdminSdk).toHaveBeenCalledWith({ parentOrgId: 'parent-1', schoolOrgId: 'school-1' })
  })
  it('translates a business-rule rejection into failed-precondition', async () => {
    vi.mocked(requireActiveOrgMember)
      .mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
      .mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    vi.mocked(linkSchoolToParentOrgWithAdminSdk).mockRejectedValueOnce(new Error('この学校は既に別の上位組織に所属しています'))
    const request = { auth: teacher, data: { parentOrgId: 'parent-1', schoolOrgId: 'school-1' } } as unknown as CallableRequest
    await expect(linkSchoolToParentOrgCallable.run(request)).rejects.toMatchObject({ code: 'failed-precondition' })
  })
})

describe('unlinkSchoolFromParentOrgCallable', () => {
  beforeEach(() => vi.clearAllMocks())
  it('reads the current parentOrgId and requires owner/admin on it', async () => {
    docGetMock.mockResolvedValueOnce({ exists: true, get: (field: string) => (field === 'parentOrgId' ? 'parent-1' : undefined) })
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    vi.mocked(unlinkSchoolFromParentOrgWithAdminSdk).mockResolvedValueOnce(undefined)
    const request = { auth: teacher, data: { schoolOrgId: 'school-1' } } as unknown as CallableRequest
    await expect(unlinkSchoolFromParentOrgCallable.run(request)).resolves.toBeUndefined()
    expect(requireActiveOrgMember).toHaveBeenCalledWith(expect.anything(), 'parent-1', 'teacher-1')
  })
  it('rejects a school with no current parent organization', async () => {
    docGetMock.mockResolvedValueOnce({ exists: true, get: () => undefined })
    const request = { auth: teacher, data: { schoolOrgId: 'school-1' } } as unknown as CallableRequest
    await expect(unlinkSchoolFromParentOrgCallable.run(request)).rejects.toMatchObject({ code: 'failed-precondition' })
  })
})

describe('listChildSchoolsCallable', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns the child school list for an active member', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(listChildSchoolsWithAdminSdk).mockResolvedValueOnce([{ orgId: 'school-1', name: 'A高校', verificationStatus: 'PENDING' }])
    const request = { auth: teacher, data: { parentOrgId: 'parent-1' } } as unknown as CallableRequest
    await expect(listChildSchoolsCallable.run(request)).resolves.toHaveLength(1)
  })
})
```

（`teacher`定数・`CallableRequest`型・`docGetMock`は既存のimport/宣言を再利用する。`docGetMock`は`vi.mock('firebase-admin/firestore', ...)`内の`doc().get`のモックとして既に定義されている前提——`unlinkSchoolFromParentOrgCallable`が`db.doc('organizations/{schoolOrgId}').get()`を呼ぶため、この既存モックがそのまま使える。）

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/organizations/onCall.test.ts`
Expected: FAIL（4つのCallableが存在しない）

- [ ] **Step 3: 実装する**

`functions/src/organizations/onCall.ts`の`import`群に追記する:

```ts
import { createParentOrgWithAdminSdk } from './parentOrg'
import { linkSchoolToParentOrgWithAdminSdk, listChildSchoolsWithAdminSdk, unlinkSchoolFromParentOrgWithAdminSdk } from './schoolHierarchy'
```

ファイル末尾に追記する:

```ts
interface CreateParentOrgRequest { name?: unknown }

export const createParentOrgCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as CreateParentOrgRequest
  if (typeof data.name !== 'string' || data.name.trim().length === 0) throw new HttpsError('invalid-argument', '組織名は必須です。')
  return createParentOrgWithAdminSdk({ name: data.name, ownerUid: request.auth.uid })
})

interface LinkSchoolToParentOrgRequest { parentOrgId?: unknown; schoolOrgId?: unknown }

export const linkSchoolToParentOrgCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as LinkSchoolToParentOrgRequest
  if (typeof data.parentOrgId !== 'string' || typeof data.schoolOrgId !== 'string') throw new HttpsError('invalid-argument', '入力内容が不正です。')
  const db = getFirestore()
  const parentMembership = await requireActiveOrgMember(db, data.parentOrgId, request.auth.uid)
  if (parentMembership.role !== 'owner' && parentMembership.role !== 'admin') {
    throw new HttpsError('permission-denied', '上位組織のowner または admin である必要があります。')
  }
  const schoolMembership = await requireActiveOrgMember(db, data.schoolOrgId, request.auth.uid)
  if (schoolMembership.role !== 'owner' && schoolMembership.role !== 'admin') {
    throw new HttpsError('permission-denied', '学校組織のowner または admin である必要があります。')
  }
  try {
    await linkSchoolToParentOrgWithAdminSdk({ parentOrgId: data.parentOrgId, schoolOrgId: data.schoolOrgId })
  } catch (error) {
    if (error instanceof Error && (error.message === '対象は学校組織ではありません' || error.message === 'この学校は既に別の上位組織に所属しています')) {
      throw new HttpsError('failed-precondition', error.message)
    }
    throw error
  }
})

interface UnlinkSchoolFromParentOrgRequest { schoolOrgId?: unknown }

export const unlinkSchoolFromParentOrgCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as UnlinkSchoolFromParentOrgRequest
  if (typeof data.schoolOrgId !== 'string') throw new HttpsError('invalid-argument', 'schoolOrgId は必須です。')
  const db = getFirestore()
  const schoolSnap = await db.doc(`organizations/${data.schoolOrgId}`).get()
  if (!schoolSnap.exists) throw new HttpsError('not-found', '学校組織が見つかりません。')
  const parentOrgId = schoolSnap.get('parentOrgId') as string | undefined
  if (!parentOrgId) throw new HttpsError('failed-precondition', 'この学校はどの上位組織にも所属していません。')
  const membership = await requireActiveOrgMember(db, parentOrgId, request.auth.uid)
  if (membership.role !== 'owner' && membership.role !== 'admin') {
    throw new HttpsError('permission-denied', '上位組織のowner または admin である必要があります。')
  }
  await unlinkSchoolFromParentOrgWithAdminSdk({ schoolOrgId: data.schoolOrgId })
})

interface ListChildSchoolsRequest { parentOrgId?: unknown }

export const listChildSchoolsCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as ListChildSchoolsRequest
  if (typeof data.parentOrgId !== 'string') throw new HttpsError('invalid-argument', 'parentOrgId は必須です。')
  await requireActiveOrgMember(getFirestore(), data.parentOrgId, request.auth.uid)
  return listChildSchoolsWithAdminSdk({ parentOrgId: data.parentOrgId })
})
```

`functions/src/index.ts`の`organizations/onCall`からのexportブロックに`createParentOrgCallable`・`linkSchoolToParentOrgCallable`・`unlinkSchoolFromParentOrgCallable`・`listChildSchoolsCallable`を追加する。

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/organizations/onCall.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add functions/src/organizations/onCall.ts functions/src/organizations/onCall.test.ts functions/src/index.ts
git commit -m "feat: 上位組織作成・学校の紐付け/解除/一覧の4つのCallableを追加"
```

---

### Task 4: クライアントラッパー

**Files:**
- Create: `src/lib/organizations/parentOrg.ts`, `.test.ts`
- Create: `src/lib/organizations/schoolHierarchy.ts`, `.test.ts`

**Interfaces:**
- Produces: `createParentOrg(functions, {name}): Promise<{orgId}>`、`linkSchoolToParentOrg(functions, {parentOrgId, schoolOrgId}): Promise<void>`、`unlinkSchoolFromParentOrg(functions, {schoolOrgId}): Promise<void>`、`listChildSchools(functions, {parentOrgId}): Promise<ChildSchool[]>`。Task 5・6で消費される。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/organizations/parentOrg.test.ts
import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { createParentOrg } from './parentOrg'
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))
describe('createParentOrg', () => it('calls createParentOrgCallable', async () => {
  const call = vi.fn().mockResolvedValue({ data: { orgId: 'parentOrg_1' } })
  vi.mocked(httpsCallable).mockReturnValue(call as never)
  await expect(createParentOrg({} as never, { name: '桜丘市教育委員会' })).resolves.toEqual({ orgId: 'parentOrg_1' })
  expect(httpsCallable).toHaveBeenCalledWith({}, 'createParentOrgCallable')
}))
```

```ts
// src/lib/organizations/schoolHierarchy.test.ts
import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { linkSchoolToParentOrg, listChildSchools, unlinkSchoolFromParentOrg } from './schoolHierarchy'
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

describe('schoolHierarchy client wrappers', () => {
  it('linkSchoolToParentOrg calls linkSchoolToParentOrgCallable', async () => {
    const call = vi.fn().mockResolvedValue({ data: undefined })
    vi.mocked(httpsCallable).mockReturnValue(call as never)
    await linkSchoolToParentOrg({} as never, { parentOrgId: 'parent-1', schoolOrgId: 'school-1' })
    expect(httpsCallable).toHaveBeenCalledWith({}, 'linkSchoolToParentOrgCallable')
    expect(call).toHaveBeenCalledWith({ parentOrgId: 'parent-1', schoolOrgId: 'school-1' })
  })
  it('unlinkSchoolFromParentOrg calls unlinkSchoolFromParentOrgCallable', async () => {
    const call = vi.fn().mockResolvedValue({ data: undefined })
    vi.mocked(httpsCallable).mockReturnValue(call as never)
    await unlinkSchoolFromParentOrg({} as never, { schoolOrgId: 'school-1' })
    expect(httpsCallable).toHaveBeenCalledWith({}, 'unlinkSchoolFromParentOrgCallable')
  })
  it('listChildSchools calls listChildSchoolsCallable', async () => {
    const call = vi.fn().mockResolvedValue({ data: [{ orgId: 'school-1', name: 'A高校', verificationStatus: 'PENDING' }] })
    vi.mocked(httpsCallable).mockReturnValue(call as never)
    await expect(listChildSchools({} as never, { parentOrgId: 'parent-1' })).resolves.toHaveLength(1)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/lib/organizations/parentOrg.test.ts src/lib/organizations/schoolHierarchy.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装する**

```ts
// src/lib/organizations/parentOrg.ts
import { httpsCallable, type Functions } from 'firebase/functions'
export interface CreateParentOrgInput { name: string }
export interface CreateParentOrgResult { orgId: string }
export const createParentOrg = async (functions: Functions, input: CreateParentOrgInput): Promise<CreateParentOrgResult> =>
  (await httpsCallable<CreateParentOrgInput, CreateParentOrgResult>(functions, 'createParentOrgCallable')(input)).data
```

```ts
// src/lib/organizations/schoolHierarchy.ts
import { httpsCallable, type Functions } from 'firebase/functions'

export interface ChildSchool { orgId: string; name: string; verificationStatus: string }

export const linkSchoolToParentOrg = async (functions: Functions, input: { parentOrgId: string; schoolOrgId: string }): Promise<void> => {
  await httpsCallable<typeof input, void>(functions, 'linkSchoolToParentOrgCallable')(input)
}

export const unlinkSchoolFromParentOrg = async (functions: Functions, input: { schoolOrgId: string }): Promise<void> => {
  await httpsCallable<typeof input, void>(functions, 'unlinkSchoolFromParentOrgCallable')(input)
}

export const listChildSchools = async (functions: Functions, input: { parentOrgId: string }): Promise<ChildSchool[]> =>
  (await httpsCallable<typeof input, ChildSchool[]>(functions, 'listChildSchoolsCallable')(input)).data
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/lib/organizations/parentOrg.test.ts src/lib/organizations/schoolHierarchy.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/organizations/parentOrg.ts src/lib/organizations/parentOrg.test.ts src/lib/organizations/schoolHierarchy.ts src/lib/organizations/schoolHierarchy.test.ts
git commit -m "feat: 上位組織・学校階層のクライアントラッパーを追加"
```

---

### Task 5: `ParentOrgSettingsPage`

**Files:**
- Create: `src/components/teacher/organizations/ParentOrgSettingsPage.tsx`
- Test: `src/components/teacher/organizations/ParentOrgSettingsPage.test.tsx`

**Interfaces:**
- Consumes: `ChildSchool`型（Task 4）。
- Produces: `ParentOrgSettingsPage`コンポーネント。Props: `{orgName: string; childSchools: ChildSchool[]; onLinkSchool: (schoolOrgId: string) => void; linking: boolean; onUnlinkSchool: (schoolOrgId: string) => void; unlinking: boolean}`。Task 7で消費される。

- [ ] **Step 1: 失敗するテストを書く**

```tsx
// src/components/teacher/organizations/ParentOrgSettingsPage.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ParentOrgSettingsPage } from './ParentOrgSettingsPage'

const childSchools = [{ orgId: 'school-1', name: 'A高校', verificationStatus: 'PENDING' }]

describe('ParentOrgSettingsPage', () => {
  it('shows the org name and child school list', () => {
    render(<ParentOrgSettingsPage orgName="桜丘市教育委員会" childSchools={childSchools} onLinkSchool={vi.fn()} linking={false} onUnlinkSchool={vi.fn()} unlinking={false} />)
    expect(screen.getByText('桜丘市教育委員会')).toBeInTheDocument()
    expect(screen.getByText('A高校')).toBeInTheDocument()
  })

  it('submits a school orgId to link', () => {
    const onLinkSchool = vi.fn()
    render(<ParentOrgSettingsPage orgName="桜丘市教育委員会" childSchools={[]} onLinkSchool={onLinkSchool} linking={false} onUnlinkSchool={vi.fn()} unlinking={false} />)
    fireEvent.change(screen.getByLabelText('学校の組織ID'), { target: { value: 'school-2' } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    expect(onLinkSchool).toHaveBeenCalledWith('school-2')
  })

  it('calls onUnlinkSchool with the target orgId', () => {
    const onUnlinkSchool = vi.fn()
    render(<ParentOrgSettingsPage orgName="桜丘市教育委員会" childSchools={childSchools} onLinkSchool={vi.fn()} linking={false} onUnlinkSchool={onUnlinkSchool} unlinking={false} />)
    fireEvent.click(screen.getByRole('button', { name: '解除' }))
    expect(onUnlinkSchool).toHaveBeenCalledWith('school-1')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/components/teacher/organizations/ParentOrgSettingsPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: 実装する**

```tsx
// src/components/teacher/organizations/ParentOrgSettingsPage.tsx
import { useState } from 'react'
import { Button, List, ListItem, ListItemText, Stack, TextField, Typography } from '@mui/material'
import type { ChildSchool } from '../../../lib/organizations/schoolHierarchy'

export interface ParentOrgSettingsPageProps {
  orgName: string
  childSchools: ChildSchool[]
  onLinkSchool: (schoolOrgId: string) => void
  linking: boolean
  onUnlinkSchool: (schoolOrgId: string) => void
  unlinking: boolean
}

export function ParentOrgSettingsPage({ orgName, childSchools, onLinkSchool, linking, onUnlinkSchool, unlinking }: ParentOrgSettingsPageProps) {
  const [schoolOrgId, setSchoolOrgId] = useState('')

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Typography variant="h5">{orgName}</Typography>
      <Stack spacing={2}>
        <Typography variant="subtitle1">学校を追加</Typography>
        <TextField label="学校の組織ID" value={schoolOrgId} onChange={(event) => setSchoolOrgId(event.target.value)} />
        <Button
          variant="contained"
          disabled={linking || !schoolOrgId}
          onClick={() => { onLinkSchool(schoolOrgId); setSchoolOrgId('') }}
          sx={{ alignSelf: 'flex-start' }}
        >
          追加
        </Button>
      </Stack>
      <Stack spacing={1}>
        <Typography variant="subtitle1">所属する学校</Typography>
        {childSchools.length === 0 ? (
          <Typography variant="body2" color="text.secondary">まだ学校が紐付けられていません。</Typography>
        ) : (
          <List>
            {childSchools.map((school) => (
              <ListItem
                key={school.orgId}
                secondaryAction={<Button size="small" disabled={unlinking} onClick={() => onUnlinkSchool(school.orgId)}>解除</Button>}
              >
                <ListItemText primary={school.name} secondary={school.verificationStatus} />
              </ListItem>
            ))}
          </List>
        )}
      </Stack>
    </Stack>
  )
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/components/teacher/organizations/ParentOrgSettingsPage.test.tsx`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/components/teacher/organizations/ParentOrgSettingsPage.tsx src/components/teacher/organizations/ParentOrgSettingsPage.test.tsx
git commit -m "feat: 上位組織設定画面(ParentOrgSettingsPage)を追加"
```

---

### Task 6: `SchoolOrgSettingsPage`への「所属する上位組織」表示追加

**Files:**
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`

**Interfaces:**
- Consumes: なし（`parentOrgName: string | null`をpropsで受け取るだけ）。

- [ ] **Step 1: 失敗するテストを書く**

`src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`に以下を追記する（既存のrenderパターンをそのまま使い、既存の必須propsに`parentOrgName={null}`を追加する）:

```tsx
it('shows "なし" when the school has no parent organization', () => {
  render(<SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false}
    members={[]} viewerUid="uid-1" canManageMembers suspending={false} onSuspendMember={vi.fn()} teacherSeatLimit={5}
    parentOrgName={null} />)
  expect(screen.getByText('所属する上位組織: なし')).toBeInTheDocument()
})

it('shows the parent organization name when linked', () => {
  render(<SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false}
    members={[]} viewerUid="uid-1" canManageMembers suspending={false} onSuspendMember={vi.fn()} teacherSeatLimit={5}
    parentOrgName="桜丘市教育委員会" />)
  expect(screen.getByText('所属する上位組織: 桜丘市教育委員会')).toBeInTheDocument()
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`
Expected: FAIL（`parentOrgName`未対応のため必須propsエラー、または表示なし）

- [ ] **Step 3: 実装する**

`src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`の`SchoolOrgSettingsPageProps`に`parentOrgName: string | null`を追加し、コンポーネント引数の分割代入にも追加する。組織名見出し・「利用枠を確認」リンクの直後に以下を追加する:

```tsx
      <Typography variant="body2">所属する上位組織: {parentOrgName ?? 'なし'}</Typography>
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/components/teacher/organizations/SchoolOrgSettingsPage.tsx src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx
git commit -m "feat: 学校組織設定画面に所属する上位組織の表示を追加"
```

---

### Task 7: `App.tsx`への統合

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: `createParentOrg`・`linkSchoolToParentOrg`・`unlinkSchoolFromParentOrg`・`listChildSchools`（Task 4）、`ParentOrgSettingsPage`（Task 5）。

- [ ] **Step 1: 失敗するテストを書く**

`src/App.test.tsx`に新しいdescribeブロックを追記する（既存の`window.history.pushState`/`getDocMock`/`httpsCallableMock`のセットアップをそのまま使う）:

```tsx
describe('Parent org hierarchy routes', () => {
  it('routes /teacher/organizations/new-parent to the parent org creation form', async () => {
    window.history.pushState({}, '', '/teacher/organizations/new-parent')
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ status: 'active' }) })
    render(<App isLessonPlatformV2Enabled getServices={getServices} />)
    authStateCallback?.({ uid: 'teacher-uid', emailVerified: true, providerData: [{ providerId: 'google.com' }] })
    expect(await screen.findByRole('heading', { name: '上位組織を作成' })).toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })

  it('shows the child school list on the parent org settings route', async () => {
    window.history.pushState({}, '', '/teacher/organizations/parent-1/parent-settings')
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ status: 'active' }) })
    httpsCallableMock.mockImplementation((_functions: unknown, name: string) => {
      if (name === 'listChildSchoolsCallable') return vi.fn().mockResolvedValue({ data: [{ orgId: 'school-1', name: 'A高校', verificationStatus: 'PENDING' }] })
      return callableMock
    })
    render(<App isLessonPlatformV2Enabled getServices={getServices} />)
    authStateCallback?.({ uid: 'teacher-uid', emailVerified: true, providerData: [{ providerId: 'google.com' }] })
    expect(await screen.findByText('A高校')).toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/App.test.tsx`
Expected: FAIL

- [ ] **Step 3: 実装する**

`src/App.tsx`に以下を追加する:

1. `import`に`ParentOrgSettingsPage`（`./components/teacher/organizations/ParentOrgSettingsPage`）・`createParentOrg`（`./lib/organizations/parentOrg`）・`linkSchoolToParentOrg`・`unlinkSchoolFromParentOrg`・`listChildSchools`・`type ChildSchool`（`./lib/organizations/schoolHierarchy`）を追加する。
2. `SchoolOrgSettingsRoute`の定義の直後に、以下の2つのルートコンポーネントを追加する:

```tsx
function ParentOrgNewRoute({ services }: { services: FirebaseServices }) {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()
  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography variant="h5" component="h1">上位組織を作成</Typography>
      <TextField label="組織名" value={name} onChange={(e) => setName(e.target.value)} />
      <Button
        variant="contained"
        disabled={creating || !name}
        sx={{ alignSelf: 'flex-start' }}
        onClick={async () => {
          setCreating(true)
          try {
            const { orgId } = await createParentOrg(services.functions, { name })
            navigate(`/teacher/organizations/${orgId}/parent-settings`)
          } finally {
            setCreating(false)
          }
        }}
      >
        作成する
      </Button>
    </Stack>
  )
}

function ParentOrgSettingsRoute({ services }: { services: FirebaseServices }) {
  const { orgId } = useParams<{ orgId: string }>()
  const [childSchools, setChildSchools] = useState<ChildSchool[]>([])
  const [linking, setLinking] = useState(false)
  const [unlinking, setUnlinking] = useState(false)

  const loadChildren = useCallback(() => {
    if (!orgId) return
    void listChildSchools(services.functions, { parentOrgId: orgId }).then(setChildSchools).catch(() => setChildSchools([]))
  }, [orgId, services.functions])

  useEffect(() => { loadChildren() }, [loadChildren])

  if (!orgId) return <GuardLoading />
  return (
    <ParentOrgSettingsPage
      orgName={orgId}
      childSchools={childSchools}
      linking={linking}
      unlinking={unlinking}
      onLinkSchool={(schoolOrgId) => {
        setLinking(true)
        void linkSchoolToParentOrg(services.functions, { parentOrgId: orgId, schoolOrgId }).then(loadChildren).finally(() => setLinking(false))
      }}
      onUnlinkSchool={(schoolOrgId) => {
        setUnlinking(true)
        void unlinkSchoolFromParentOrg(services.functions, { schoolOrgId }).then(loadChildren).finally(() => setUnlinking(false))
      }}
    />
  )
}
```

3. `<Routes>`内、`/teacher/organizations/:orgId/plan-limits`ルートの直後に以下を追加する:

```tsx
  <Route path="/teacher/organizations/new-parent" element={enabled && services ? <TemplateRouteGuard services={services}><ParentOrgNewRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
  <Route path="/teacher/organizations/:orgId/parent-settings" element={enabled && services ? <TemplateRouteGuard services={services}><ParentOrgSettingsRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
```

4. `SchoolOrgSettingsRoute`に、対象学校の`organizations/{orgId}`ドキュメントを直接Firestore読み取りして`parentOrgId`を解決するロジックを追加し、`parentOrgName`(このタスクの範囲では上位組織の`orgId`をそのまま名前として暫定表示——`getOrgPlanLimits`等と同様、上位組織自体のドキュメントを読んで実名を出す改善は本タスクでは必須としない)を`SchoolOrgSettingsPage`へ渡す:

```tsx
  const [parentOrgId, setParentOrgId] = useState<string | null>(null)
  useEffect(() => {
    if (!orgId) return
    void getDoc(doc(services.firestore, 'organizations', orgId)).then((snapshot) => {
      setParentOrgId(snapshot.exists() ? ((snapshot.data().parentOrgId as string | undefined) ?? null) : null)
    })
  }, [services, orgId])
```

`<SchoolOrgSettingsPage .../>`の呼び出しに`parentOrgName={parentOrgId}`を追加する。

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/App.test.tsx`
Expected: PASS

- [ ] **Step 5: モノレポ全体を検証する**

Run: `npm run verify`
Expected: 全ワークスペースのlint/typecheck/test/buildが通過する

- [ ] **Step 6: コミット**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: 上位組織作成・階層管理画面をルーティングに統合"
```
