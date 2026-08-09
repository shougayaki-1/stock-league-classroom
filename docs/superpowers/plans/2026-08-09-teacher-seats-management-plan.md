# 教師席の割当・解除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**正本:** `docs/superpowers/specs/2026-08-09-teacher-seats-management-design.md`(設計仕様)。矛盾する場合は仕様書を優先する。

**Goal:** 組織のメンバー一覧(メールアドレス込み)を取得でき、owner/adminがメンバーを解除(教師席を解放)できるようにする。

**Architecture:** 既存の`syncOrganizationMembershipChange`(メンバーの状態変更の唯一の書き込み経路)をそのまま再利用する。メンバー一覧はFirestoreの`members`サブコレクション+Firebase Admin Auth(`getAuth().getUsers`)によるメールアドレス解決を組み合わせる。

**Tech Stack:** TypeScript, React, MUI, Firebase Cloud Functions v2 (`onCall`), Firebase Admin SDK (Firestore + Auth), Vitest, React Testing Library。

## Global Constraints

- 本計画は**Phase Fサブプロジェクト1・2の完了を前提とする**(`organizations/{orgId}/members`・`organizations/{orgId}.planId`・`getOrgPlanLimits`が既に存在する、2026-08-09時点で実装済み)。
- メンバーの状態変更は必ず`syncOrganizationMembershipChange`(`functions/src/organizations/membershipSync.ts`)経由で行う。
- 教師席を消費するのはowner/admin/teacherロールを持つ**アクティブな**メンバー全員。
- `teacherSeats`上限の実強制(超過時に招待受諾を拒否する等)は本計画のスコープ外。表示のみ行う。
- 認可は既存の`isCallerTeacher`・`requireActiveOrgMember`をそのまま再利用する。
- 新規Callableは`functions/src/index.ts`からexportする。
- 日本語UI文言を用いる。
- 各タスクの実装後、そのタスクが変更したファイルのテストを実行してから次のタスクに進む。全タスク完了後、`npm run verify`を実行し、通過することを確認してからコミットする。

---

## File Structure

| File | Change |
| --- | --- |
| `functions/src/organizations/orgMembers.ts`, `.test.ts` | Create（Task 1） |
| `functions/src/organizations/suspendMember.ts`, `.test.ts` | Create（Task 2） |
| `functions/src/organizations/onCall.ts`, `.test.ts` | Modify（Task 3。2つのCallable追加） |
| `functions/src/index.ts` | Modify（Task 3。export追加） |
| `src/lib/organizations/orgMembers.ts`, `.test.ts` | Create（Task 4） |
| `src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`, `.test.tsx` | Modify（Task 5） |
| `src/App.tsx`, `.test.tsx` | Modify（Task 6） |

---

### Task 1: `listOrgMembers`（純粋関数 — メンバー一覧+メールアドレス解決）

**Files:**
- Create: `functions/src/organizations/orgMembers.ts`
- Test: `functions/src/organizations/orgMembers.test.ts`

**Interfaces:**
- Consumes: なし。
- Produces: `OrgMember`型、`listOrgMembers(deps, input): Promise<OrgMember[]>`、`listOrgMembersWithAdminSdk(orgId): Promise<OrgMember[]>`。Task 3で消費される。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// functions/src/organizations/orgMembers.test.ts
import { describe, expect, it } from 'vitest'
import { listOrgMembers } from './orgMembers'

describe('listOrgMembers', () => {
  it('resolves each member uid to an email address', async () => {
    const result = await listOrgMembers({
      getMemberDocs: async (orgId) => {
        expect(orgId).toBe('org-1')
        return [
          { uid: 'uid-owner', role: 'owner', status: 'active', membershipVersion: 1 },
          { uid: 'uid-teacher', role: 'teacher', status: 'suspended', membershipVersion: 2 },
        ]
      },
      resolveEmails: async (uids) => {
        expect(uids).toEqual(['uid-owner', 'uid-teacher'])
        return { 'uid-owner': 'owner@example.com', 'uid-teacher': null }
      },
    }, { orgId: 'org-1' })

    expect(result).toEqual([
      { uid: 'uid-owner', email: 'owner@example.com', role: 'owner', status: 'active', membershipVersion: 1 },
      { uid: 'uid-teacher', email: null, role: 'teacher', status: 'suspended', membershipVersion: 2 },
    ])
  })

  it('does not call resolveEmails for an empty member list', async () => {
    const result = await listOrgMembers({
      getMemberDocs: async () => [],
      resolveEmails: async () => { throw new Error('should not be called') },
    }, { orgId: 'org-1' })
    expect(result).toEqual([])
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/organizations/orgMembers.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装する**

```ts
// functions/src/organizations/orgMembers.ts
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

export interface OrgMember {
  uid: string
  email: string | null
  role: 'owner' | 'admin' | 'teacher'
  status: 'active' | 'suspended'
  membershipVersion: number
}
type MemberDoc = Omit<OrgMember, 'email'>

export interface ListOrgMembersDeps {
  getMemberDocs: (orgId: string) => Promise<MemberDoc[]>
  resolveEmails: (uids: string[]) => Promise<Record<string, string | null>>
}
export interface ListOrgMembersInput { orgId: string }

export const listOrgMembers = async (deps: ListOrgMembersDeps, input: ListOrgMembersInput): Promise<OrgMember[]> => {
  const docs = await deps.getMemberDocs(input.orgId)
  if (docs.length === 0) return []
  const emails = await deps.resolveEmails(docs.map((doc) => doc.uid))
  return docs.map((doc) => ({ ...doc, email: emails[doc.uid] ?? null }))
}

/** Production wiring: Firestore Admin SDK + Firebase Admin Auth batch lookup. */
export const listOrgMembersWithAdminSdk = (orgId: string): Promise<OrgMember[]> => {
  const db = getFirestore()
  return listOrgMembers({
    getMemberDocs: async (id) => {
      const snap = await db.collection(`organizations/${id}/members`).get()
      return snap.docs.map((doc) => ({
        uid: doc.id,
        role: doc.get('role') as MemberDoc['role'],
        status: doc.get('status') as MemberDoc['status'],
        membershipVersion: doc.get('membershipVersion') as number,
      }))
    },
    resolveEmails: async (uids) => {
      const result = await getAuth().getUsers(uids.map((uid) => ({ uid })))
      const emails: Record<string, string | null> = {}
      for (const uid of uids) emails[uid] = null
      for (const user of result.users) emails[user.uid] = user.email ?? null
      return emails
    },
  }, { orgId })
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/organizations/orgMembers.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add functions/src/organizations/orgMembers.ts functions/src/organizations/orgMembers.test.ts
git commit -m "feat: 組織のメンバー一覧+メールアドレス解決(listOrgMembers)を追加"
```

---

### Task 2: `suspendOrgMember`（純粋関数 — メンバーの解除）

**Files:**
- Create: `functions/src/organizations/suspendMember.ts`
- Test: `functions/src/organizations/suspendMember.test.ts`

**Interfaces:**
- Consumes: `syncOrganizationMembershipChange`（既存、`functions/src/organizations/membershipSync.ts`）。
- Produces: `suspendOrgMember(deps, input): Promise<void>`、`suspendOrgMemberWithAdminSdk(input): Promise<void>`。Task 3で消費される。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// functions/src/organizations/suspendMember.test.ts
import { describe, expect, it, vi } from 'vitest'
import { suspendOrgMember } from './suspendMember'

describe('suspendOrgMember', () => {
  it('throws when the target member does not exist', async () => {
    await expect(suspendOrgMember({
      getMember: async () => null, countActiveOwners: async () => 1, syncMembership: vi.fn(), nowSeconds: () => 0,
    }, { orgId: 'org-1', uid: 'uid-1' })).rejects.toThrow('このメンバーは既に解除されています')
  })

  it('throws when the target member is already suspended', async () => {
    await expect(suspendOrgMember({
      getMember: async () => ({ role: 'teacher', status: 'suspended', membershipVersion: 1 }),
      countActiveOwners: async () => 1, syncMembership: vi.fn(), nowSeconds: () => 0,
    }, { orgId: 'org-1', uid: 'uid-1' })).rejects.toThrow('このメンバーは既に解除されています')
  })

  it('throws when the target is the sole active owner', async () => {
    await expect(suspendOrgMember({
      getMember: async () => ({ role: 'owner', status: 'active', membershipVersion: 1 }),
      countActiveOwners: async () => 1, syncMembership: vi.fn(), nowSeconds: () => 0,
    }, { orgId: 'org-1', uid: 'uid-1' })).rejects.toThrow('組織には少なくとも1人のownerが必要です')
  })

  it('allows suspending an owner when another active owner exists', async () => {
    const syncMembership = vi.fn()
    await suspendOrgMember({
      getMember: async () => ({ role: 'owner', status: 'active', membershipVersion: 2 }),
      countActiveOwners: async () => 2, syncMembership, nowSeconds: () => 1000,
    }, { orgId: 'org-1', uid: 'uid-1' })
    expect(syncMembership).toHaveBeenCalledWith({ orgId: 'org-1', uid: 'uid-1', role: 'owner', status: 'suspended', membershipVersion: 3, revokedAtSeconds: 1000 })
  })

  it('suspends a non-owner member and advances membershipVersion', async () => {
    const syncMembership = vi.fn()
    await suspendOrgMember({
      getMember: async () => ({ role: 'teacher', status: 'active', membershipVersion: 4 }),
      countActiveOwners: async () => 1, syncMembership, nowSeconds: () => 2000,
    }, { orgId: 'org-1', uid: 'uid-2' })
    expect(syncMembership).toHaveBeenCalledWith({ orgId: 'org-1', uid: 'uid-2', role: 'teacher', status: 'suspended', membershipVersion: 5, revokedAtSeconds: 2000 })
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/organizations/suspendMember.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装する**

```ts
// functions/src/organizations/suspendMember.ts
import { getDatabase } from 'firebase-admin/database'
import { getFirestore } from 'firebase-admin/firestore'
import { syncOrganizationMembershipChange, type MembershipChange } from './membershipSync'

interface MemberSnapshot { role: 'owner' | 'admin' | 'teacher'; status: 'active' | 'suspended'; membershipVersion: number }

export interface SuspendOrgMemberDeps {
  getMember: (orgId: string, uid: string) => Promise<MemberSnapshot | null>
  countActiveOwners: (orgId: string) => Promise<number>
  syncMembership: (change: MembershipChange) => Promise<void>
  nowSeconds: () => number
}
export interface SuspendOrgMemberInput { orgId: string; uid: string }

/**
 * 唯一のアクティブownerを解除できないよう保護する——組織が誰にも
 * 管理されない状態を防ぐため(設計仕様の安全装置)。役割はそのまま、
 * statusのみsuspendedへ変更し、membershipVersionを1つ進める。
 */
export const suspendOrgMember = async (deps: SuspendOrgMemberDeps, input: SuspendOrgMemberInput): Promise<void> => {
  const member = await deps.getMember(input.orgId, input.uid)
  if (!member || member.status !== 'active') throw new Error('このメンバーは既に解除されています')
  if (member.role === 'owner') {
    const activeOwners = await deps.countActiveOwners(input.orgId)
    if (activeOwners <= 1) throw new Error('組織には少なくとも1人のownerが必要です')
  }
  await deps.syncMembership({
    orgId: input.orgId,
    uid: input.uid,
    role: member.role,
    status: 'suspended',
    membershipVersion: member.membershipVersion + 1,
    revokedAtSeconds: deps.nowSeconds(),
  })
}

/** Production wiring: Firestore Admin SDK + syncOrganizationMembershipChange's own RTDB mirror wiring. */
export const suspendOrgMemberWithAdminSdk = (input: SuspendOrgMemberInput): Promise<void> => {
  const db = getFirestore()
  return suspendOrgMember({
    getMember: async (orgId, uid) => {
      const snap = await db.doc(`organizations/${orgId}/members/${uid}`).get()
      return snap.exists ? (snap.data() as MemberSnapshot) : null
    },
    countActiveOwners: async (orgId) => {
      const snap = await db.collection(`organizations/${orgId}/members`).where('role', '==', 'owner').where('status', '==', 'active').get()
      return snap.size
    },
    syncMembership: (change) => syncOrganizationMembershipChange({
      markMirrorPending: async (orgId, membershipVersion) => {
        await getDatabase().ref(`orgAccessMeta/${orgId}/${change.uid}`).set({ syncState: 'PENDING', membershipVersion })
      },
      updateFirestoreMembership: async (membership) => {
        await db.doc(`organizations/${membership.orgId}/members/${membership.uid}`).set({
          role: membership.role, status: membership.status, membershipVersion: membership.membershipVersion,
        }, { merge: true })
      },
      commitMirrorSynced: async (membership) => {
        await getDatabase().ref().update({
          [`orgAccess/${membership.orgId}/${membership.uid}`]: {
            role: membership.role, status: membership.status, membershipVersion: membership.membershipVersion, revokedAtSeconds: membership.revokedAtSeconds,
          },
          [`orgAccessMeta/${membership.orgId}/${membership.uid}`]: { syncState: 'SYNCED' },
        })
      },
    }, change),
    nowSeconds: () => Math.floor(Date.now() / 1000),
  }, input)
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/organizations/suspendMember.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add functions/src/organizations/suspendMember.ts functions/src/organizations/suspendMember.test.ts
git commit -m "feat: メンバー解除ロジック(suspendOrgMember、唯一owner保護込み)を追加"
```

---

### Task 3: `listOrgMembersCallable`・`suspendOrgMemberCallable`

**Files:**
- Modify: `functions/src/organizations/onCall.ts`
- Modify: `functions/src/organizations/onCall.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: `listOrgMembersWithAdminSdk`（Task 1）、`suspendOrgMemberWithAdminSdk`（Task 2）、`requireActiveOrgMember`（既存）。
- Produces: `listOrgMembersCallable`（入力`{orgId}`、出力`OrgMember[]`）、`suspendOrgMemberCallable`（入力`{orgId, uid}`、出力`void`）。Task 4で消費される。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/organizations/onCall.test.ts`の`import`群・`vi.mock`群に以下を追加する:

```ts
import { listOrgMembersCallable, suspendOrgMemberCallable } from './onCall'
import { listOrgMembersWithAdminSdk } from './orgMembers'
import { suspendOrgMemberWithAdminSdk } from './suspendMember'

vi.mock('./orgMembers', () => ({ listOrgMembersWithAdminSdk: vi.fn() }))
vi.mock('./suspendMember', () => ({ suspendOrgMemberWithAdminSdk: vi.fn() }))
```

ファイル末尾に以下のテストを追記する:

```ts
describe('listOrgMembersCallable', () => {
  beforeEach(() => vi.clearAllMocks())
  it('requires an active org member', async () => {
    vi.mocked(requireActiveOrgMember).mockRejectedValueOnce(new Error('permission-denied'))
    const request = { auth: teacher, data: { orgId: 'org-1' } } as unknown as CallableRequest
    await expect(listOrgMembersCallable.run(request)).rejects.toThrow('permission-denied')
  })
  it('returns the member list for an active member', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(listOrgMembersWithAdminSdk).mockResolvedValueOnce([{ uid: 'uid-1', email: 'x@example.com', role: 'owner', status: 'active', membershipVersion: 1 }])
    const request = { auth: teacher, data: { orgId: 'org-1' } } as unknown as CallableRequest
    await expect(listOrgMembersCallable.run(request)).resolves.toMatchObject([{ uid: 'uid-1' }])
    expect(listOrgMembersWithAdminSdk).toHaveBeenCalledWith('org-1')
  })
})

describe('suspendOrgMemberCallable', () => {
  beforeEach(() => vi.clearAllMocks())
  it('rejects a caller whose role is not owner/admin', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    const request = { auth: teacher, data: { orgId: 'org-1', uid: 'uid-2' } } as unknown as CallableRequest
    await expect(suspendOrgMemberCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
  })
  it('suspends a member for an owner caller', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    vi.mocked(suspendOrgMemberWithAdminSdk).mockResolvedValueOnce(undefined)
    const request = { auth: teacher, data: { orgId: 'org-1', uid: 'uid-2' } } as unknown as CallableRequest
    await expect(suspendOrgMemberCallable.run(request)).resolves.toBeUndefined()
    expect(suspendOrgMemberWithAdminSdk).toHaveBeenCalledWith({ orgId: 'org-1', uid: 'uid-2' })
  })
  it('translates a sole-owner protection error into failed-precondition', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    vi.mocked(suspendOrgMemberWithAdminSdk).mockRejectedValueOnce(new Error('組織には少なくとも1人のownerが必要です'))
    const request = { auth: teacher, data: { orgId: 'org-1', uid: 'uid-2' } } as unknown as CallableRequest
    await expect(suspendOrgMemberCallable.run(request)).rejects.toMatchObject({ code: 'failed-precondition' })
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/organizations/onCall.test.ts`
Expected: FAIL（2つのCallableが存在しない）

- [ ] **Step 3: 実装する**

`functions/src/organizations/onCall.ts`の`import`群に追記する:

```ts
import { listOrgMembersWithAdminSdk } from './orgMembers'
import { suspendOrgMemberWithAdminSdk } from './suspendMember'
```

ファイル末尾に追記する:

```ts
interface ListOrgMembersRequest { orgId?: unknown }

export const listOrgMembersCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as ListOrgMembersRequest
  if (typeof data.orgId !== 'string') throw new HttpsError('invalid-argument', 'orgId は必須です。')
  await requireActiveOrgMember(getFirestore(), data.orgId, request.auth.uid)
  return listOrgMembersWithAdminSdk(data.orgId)
})

interface SuspendOrgMemberRequest { orgId?: unknown; uid?: unknown }

export const suspendOrgMemberCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as SuspendOrgMemberRequest
  if (typeof data.orgId !== 'string' || typeof data.uid !== 'string') throw new HttpsError('invalid-argument', '入力内容が不正です。')
  const membership = await requireActiveOrgMember(getFirestore(), data.orgId, request.auth.uid)
  if (membership.role !== 'owner' && membership.role !== 'admin') throw new HttpsError('permission-denied', 'owner または admin のみメンバーを解除できます。')
  try {
    await suspendOrgMemberWithAdminSdk({ orgId: data.orgId, uid: data.uid })
  } catch (error) {
    if (error instanceof Error && (error.message === 'このメンバーは既に解除されています' || error.message === '組織には少なくとも1人のownerが必要です')) {
      throw new HttpsError('failed-precondition', error.message)
    }
    throw error
  }
})
```

`functions/src/index.ts`の`organizations/onCall`からのexportブロックに`listOrgMembersCallable`・`suspendOrgMemberCallable`を追加する。

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/organizations/onCall.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add functions/src/organizations/onCall.ts functions/src/organizations/onCall.test.ts functions/src/index.ts
git commit -m "feat: メンバー一覧・解除の2つのCallableを追加"
```

---

### Task 4: クライアントラッパー

**Files:**
- Create: `src/lib/organizations/orgMembers.ts`
- Test: `src/lib/organizations/orgMembers.test.ts`

**Interfaces:**
- Produces: `OrgMember`型、`listOrgMembers(functions, {orgId}): Promise<OrgMember[]>`、`suspendOrgMember(functions, {orgId, uid}): Promise<void>`。Task 5で消費される。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/organizations/orgMembers.test.ts
import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { listOrgMembers, suspendOrgMember } from './orgMembers'
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

describe('orgMembers client wrappers', () => {
  it('listOrgMembers calls listOrgMembersCallable', async () => {
    const call = vi.fn().mockResolvedValue({ data: [{ uid: 'uid-1', email: 'x@example.com', role: 'owner', status: 'active', membershipVersion: 1 }] })
    vi.mocked(httpsCallable).mockReturnValue(call as never)
    await expect(listOrgMembers({} as never, { orgId: 'org-1' })).resolves.toHaveLength(1)
    expect(httpsCallable).toHaveBeenCalledWith({}, 'listOrgMembersCallable')
    expect(call).toHaveBeenCalledWith({ orgId: 'org-1' })
  })
  it('suspendOrgMember calls suspendOrgMemberCallable', async () => {
    const call = vi.fn().mockResolvedValue({ data: undefined })
    vi.mocked(httpsCallable).mockReturnValue(call as never)
    await suspendOrgMember({} as never, { orgId: 'org-1', uid: 'uid-2' })
    expect(httpsCallable).toHaveBeenCalledWith({}, 'suspendOrgMemberCallable')
    expect(call).toHaveBeenCalledWith({ orgId: 'org-1', uid: 'uid-2' })
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/lib/organizations/orgMembers.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装する**

```ts
// src/lib/organizations/orgMembers.ts
import { httpsCallable, type Functions } from 'firebase/functions'

export interface OrgMember {
  uid: string
  email: string | null
  role: 'owner' | 'admin' | 'teacher'
  status: 'active' | 'suspended'
  membershipVersion: number
}

export const listOrgMembers = async (functions: Functions, input: { orgId: string }): Promise<OrgMember[]> =>
  (await httpsCallable<{ orgId: string }, OrgMember[]>(functions, 'listOrgMembersCallable')(input)).data

export const suspendOrgMember = async (functions: Functions, input: { orgId: string; uid: string }): Promise<void> => {
  await httpsCallable<{ orgId: string; uid: string }, void>(functions, 'suspendOrgMemberCallable')(input)
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/lib/organizations/orgMembers.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/organizations/orgMembers.ts src/lib/organizations/orgMembers.test.ts
git commit -m "feat: メンバー一覧・解除のクライアントラッパーを追加"
```

---

### Task 5: `SchoolOrgSettingsPage`へのメンバー一覧・解除UI追加

**Files:**
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`

**Interfaces:**
- Consumes: `OrgMember`型（Task 4）。
- Produces: `SchoolOrgSettingsPageProps`に`members: OrgMember[]`・`viewerUid: string`・`canManageMembers: boolean`・`onSuspendMember: (uid: string) => void`・`suspending: boolean`・`teacherSeatLimit: number | undefined`を追加する。

**設計メモ:** `canManageMembers`（owner/admin判定）はこのコンポーネントの外（`App.tsx`側、呼び出し元が`listOrgMembers`の結果から自分のuidの`role`を調べて判定）で計算し、propsとして渡す——`SchoolOrgSettingsPage`自身は「自分が何のロールか」を知る手段を持たない(propsで渡されたmembersと`viewerUid`を突き合わせれば分かるが、判定ロジックの重複を避けるため呼び出し元に寄せる)。

- [ ] **Step 1: 失敗するテストを書く**

`src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`に以下を追記する（既存のimport・renderパターンをそのまま使う）:

```tsx
const members = [
  { uid: 'uid-owner', email: 'owner@example.com', role: 'owner' as const, status: 'active' as const, membershipVersion: 1 },
  { uid: 'uid-teacher', email: 'teacher@example.com', role: 'teacher' as const, status: 'active' as const, membershipVersion: 1 },
]

describe('member list', () => {
  it('shows the seat usage and member list', () => {
    render(<SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false}
      members={members} viewerUid="uid-owner" canManageMembers suspending={false} onSuspendMember={vi.fn()} teacherSeatLimit={5} />)
    expect(screen.getByText('教師席: 使用中 2 / 上限 5')).toBeInTheDocument()
    expect(screen.getByText('owner@example.com')).toBeInTheDocument()
    expect(screen.getByText('teacher@example.com')).toBeInTheDocument()
  })

  it('shows a suspend button for other members but not for the viewer, when the viewer can manage members', () => {
    render(<SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false}
      members={members} viewerUid="uid-owner" canManageMembers suspending={false} onSuspendMember={vi.fn()} teacherSeatLimit={5} />)
    expect(screen.getAllByRole('button', { name: '解除' })).toHaveLength(1)
  })

  it('hides suspend buttons entirely when the viewer cannot manage members', () => {
    render(<SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false}
      members={members} viewerUid="uid-teacher" canManageMembers={false} suspending={false} onSuspendMember={vi.fn()} teacherSeatLimit={5} />)
    expect(screen.queryByRole('button', { name: '解除' })).not.toBeInTheDocument()
  })

  it('calls onSuspendMember with the target uid', () => {
    const onSuspendMember = vi.fn()
    render(<SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false}
      members={members} viewerUid="uid-owner" canManageMembers suspending={false} onSuspendMember={onSuspendMember} teacherSeatLimit={5} />)
    fireEvent.click(screen.getByRole('button', { name: '解除' }))
    expect(onSuspendMember).toHaveBeenCalledWith('uid-teacher')
  })
})
```

（`fireEvent`は既存のimportに含まれていない場合、`@testing-library/react`から追加でimportする。）

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: 実装する**

`src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`を以下の内容に置き換える（既存の招待フォーム・招待一覧・`orgId`を使った「利用枠を確認」リンクは変更せず、メンバー一覧セクションを追加する）:

```tsx
import { useState } from 'react'
import { Link } from 'react-router'
import { Button, List, ListItem, ListItemText, MenuItem, Stack, TextField, Typography } from '@mui/material'
import type { Invitation } from '../../../lib/organizations/invitations'
import type { OrgMember } from '../../../lib/organizations/orgMembers'

const STATUS_LABEL: Record<Invitation['status'], string> = {
  PENDING: '招待中',
  ACCEPTED: '参加済み',
}
const ROLE_LABEL: Record<OrgMember['role'], string> = { owner: 'owner', admin: '管理者', teacher: '教師' }
const SEAT_ROLES: OrgMember['role'][] = ['owner', 'admin', 'teacher']

export interface SchoolOrgSettingsPageProps {
  orgName: string
  orgId: string
  invitations: Invitation[]
  onInvite: (email: string, role: 'admin' | 'teacher') => void
  inviting: boolean
  members: OrgMember[]
  viewerUid: string
  canManageMembers: boolean
  onSuspendMember: (uid: string) => void
  suspending: boolean
  teacherSeatLimit: number | undefined
}

export function SchoolOrgSettingsPage({
  orgName, orgId, invitations, onInvite, inviting, members, viewerUid, canManageMembers, onSuspendMember, suspending, teacherSeatLimit,
}: SchoolOrgSettingsPageProps) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'teacher'>('teacher')
  const activeSeatCount = members.filter((member) => member.status === 'active' && SEAT_ROLES.includes(member.role)).length

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Typography variant="h5">{orgName}</Typography>
      <Link to={`/teacher/organizations/${orgId}/plan-limits`}>利用枠を確認</Link>
      <Stack spacing={2}>
        <Typography variant="subtitle1">教師を招待</Typography>
        <TextField label="招待するメールアドレス" value={email} onChange={(event) => setEmail(event.target.value)} />
        <TextField select label="役割" value={role} onChange={(event) => setRole(event.target.value as 'admin' | 'teacher')} sx={{ maxWidth: 200 }}>
          <MenuItem value="teacher">教師</MenuItem>
          <MenuItem value="admin">管理者</MenuItem>
        </TextField>
        <Button variant="contained" disabled={inviting || !email} onClick={() => onInvite(email, role)} sx={{ alignSelf: 'flex-start' }}>
          招待を送る
        </Button>
      </Stack>
      <Stack spacing={1}>
        <Typography variant="subtitle1">招待一覧</Typography>
        {invitations.length === 0 ? (
          <Typography variant="body2" color="text.secondary">まだ招待がありません。</Typography>
        ) : (
          <List>
            {invitations.map((invitation) => (
              <ListItem key={invitation.id}>
                <ListItemText primary={invitation.email} secondary={STATUS_LABEL[invitation.status]} />
              </ListItem>
            ))}
          </List>
        )}
      </Stack>
      <Stack spacing={1}>
        <Typography variant="subtitle1">
          教師席: 使用中 {activeSeatCount} / 上限 {teacherSeatLimit ?? '?'}
        </Typography>
        <List>
          {members.map((member) => (
            <ListItem
              key={member.uid}
              secondaryAction={canManageMembers && member.uid !== viewerUid && member.status === 'active' ? (
                <Button size="small" disabled={suspending} onClick={() => onSuspendMember(member.uid)}>解除</Button>
              ) : undefined}
            >
              <ListItemText
                primary={member.email ?? member.uid}
                secondary={`${ROLE_LABEL[member.role]} / ${member.status === 'active' ? '有効' : '解除済み'}`}
              />
            </ListItem>
          ))}
        </List>
      </Stack>
    </Stack>
  )
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/components/teacher/organizations/SchoolOrgSettingsPage.tsx src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx
git commit -m "feat: 組織設定画面にメンバー一覧・教師席使用状況・解除操作を追加"
```

---

### Task 6: `App.tsx`への統合

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: `listOrgMembers`/`suspendOrgMember`（Task 4）、`getOrgPlanLimits`（既存、Phase Fサブプロジェクト2）。

- [ ] **Step 1: 失敗するテストを書く**

`src/App.test.tsx`の`describe('School org creation and invitation routes', ...)`ブロックの末尾に追記する（既存の`window.history.pushState`/`getDocMock`/`callableMock`のセットアップをそのまま使う）:

```tsx
it('shows the member list and seat usage on the school org settings route', async () => {
  window.history.pushState({}, '', '/teacher/organizations/org-1/settings')
  getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ status: 'active' }) })
  // SchoolOrgSettingsRoute no longer calls listMyInvitationsCallable (removed in
  // the school-org-creation-invitation plan's error-handling fix) — only
  // listOrgMembersCallable and getOrgPlanLimitsCallable are called on this route.
  httpsCallableMock.mockImplementation((_functions: unknown, name: string) => {
    if (name === 'listOrgMembersCallable') {
      return vi.fn().mockResolvedValue({ data: [{ uid: 'teacher-uid', email: 'teacher-uid@example.com', role: 'owner', status: 'active', membershipVersion: 1 }] })
    }
    if (name === 'getOrgPlanLimitsCallable') {
      return vi.fn().mockResolvedValue({ data: { concurrentLessonsAndMarkets: 1, participants: 40, teacherSeats: 5, aiCredits: 0, templateStorage: 5, resultRetentionDays: 30, eventExtraCapacity: 0 } })
    }
    return callableMock
  })
  render(<App isLessonPlatformV2Enabled getServices={getServices} />)
  authStateCallback?.({ uid: 'teacher-uid', emailVerified: true, providerData: [{ providerId: 'google.com' }] })
  expect(await screen.findByText('教師席: 使用中 1 / 上限 5')).toBeInTheDocument()
  window.history.pushState({}, '', '/')
})
```

（この検証は、Task 8(school-org-creation-invitation-plan)の`81bac2e`で`SchoolOrgSettingsRoute`から`listMyInvitationsCallable`呼び出しが削除済みという前提に立っている。実装時に`src/App.tsx`の現在の`SchoolOrgSettingsRoute`を確認し、もし何らかの理由で`listMyInvitationsCallable`が呼ばれるようになっていた場合は、上記モックの`callableMock`分岐にも空配列を返す処理を追加すること。）

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/App.test.tsx`
Expected: FAIL

- [ ] **Step 3: 実装する**

`src/App.tsx`に以下を追加する:

1. `import`に`listOrgMembers`・`suspendOrgMember`・`type OrgMember`（`./lib/organizations/orgMembers`）を追加する。
2. `SchoolOrgSettingsRoute`を以下のように書き換える（招待一覧の取得ロジックはそのまま残し、メンバー一覧・プラン限度値の取得と`onSuspendMember`ハンドラを追加する）:

```tsx
function SchoolOrgSettingsRoute({ services }: { services: FirebaseServices }) {
  const { orgId } = useParams<{ orgId: string }>()
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [inviting, setInviting] = useState(false)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [teacherSeatLimit, setTeacherSeatLimit] = useState<number>()
  const [suspending, setSuspending] = useState(false)
  const uid = services.auth.currentUser?.uid

  const loadMembers = useCallback(() => {
    if (!orgId) return
    void listOrgMembers(services.functions, { orgId }).then(setMembers).catch(() => setMembers([]))
  }, [services, orgId])

  useEffect(() => { loadMembers() }, [loadMembers])
  useEffect(() => {
    if (!orgId) return
    void getOrgPlanLimits(services.functions, { orgId }).then((limits) => setTeacherSeatLimit(limits.teacherSeats)).catch(() => setTeacherSeatLimit(undefined))
  }, [services, orgId])

  if (!orgId || !uid) return <GuardLoading />
  const viewerMembership = members.find((member) => member.uid === uid)
  const canManageMembers = viewerMembership?.role === 'owner' || viewerMembership?.role === 'admin'

  return (
    <SchoolOrgSettingsPage
      orgName={orgId}
      orgId={orgId}
      invitations={invitations}
      inviting={inviting}
      members={members}
      viewerUid={uid}
      canManageMembers={canManageMembers}
      suspending={suspending}
      teacherSeatLimit={teacherSeatLimit}
      onSuspendMember={(targetUid) => {
        setSuspending(true)
        void suspendOrgMember(services.functions, { orgId, uid: targetUid }).then(loadMembers).finally(() => setSuspending(false))
      }}
      onInvite={async (email, role) => {
        setInviting(true)
        try {
          const { invitationId } = await createInvitation(services.functions, { orgId, email, role })
          setInvitations((prev) => [...prev, { id: invitationId, orgId, email, role, status: 'PENDING', invitedByUid: '', createdAt: null }])
        } finally {
          setInviting(false)
        }
      }}
    />
  )
}
```

（`useCallback`は既に`TemplateListRoute`で使われている前提のimport済みフックであることを`src/App.tsx`の先頭importで確認する。含まれていなければ`react`のimportへ追加する。）

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/App.test.tsx`
Expected: PASS

- [ ] **Step 5: モノレポ全体を検証する**

Run: `npm run verify`
Expected: 全ワークスペースのlint/typecheck/test/buildが通過する

- [ ] **Step 6: コミット**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: 組織設定画面へメンバー一覧・教師席使用状況・解除操作を統合"
```
