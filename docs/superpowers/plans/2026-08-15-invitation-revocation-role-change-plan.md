# 招待失効+ロール変更 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 組織のowner/adminが送信済み招待を失効でき、メンバーのロールを変更できるようにする。あわせて、現状存在しない「組織向けの招待一覧取得」を新設し、招待管理画面を実データで表示する。

**Architecture:** `functions/src/organizations/invitations.ts`に`revokeInvitation`/`listOrgInvitations`を、新規`functions/src/organizations/changeRole.ts`に`changeOrgMemberRole`を、既存の依存注入パターン(`listOrgMembers`/`suspendOrgMember`と同型)で実装する。ロール変更は`membershipSync.ts`の`syncOrganizationMembershipChange`(grant/suspend/role-change共通の同期関数として既に用意済み)をそのまま呼ぶ。

**Tech Stack:** Firebase Cloud Functions (TypeScript, `firebase-admin/firestore`)、React + MUI、Vitest、React Testing Library。

## Global Constraints

- 正本: `docs/superpowers/specs/2026-08-15-invitation-revocation-role-change-design.md`。矛盾があれば正本を優先する。
- 招待失効・招待一覧取得・ロール変更はいずれも`orgId`の`owner`または`admin`のみ(既存`suspendOrgMemberCallable`/`requireManager`と同じ認可レベル)。
- `owner`への昇格・`owner`からの降格は、呼び出し元が`owner`である場合のみ許可する。
- 最後の1人の`owner`をowner以外へ変更することはできない(既存`suspendOrgMember`の`countActiveOwners`チェックを再利用)。
- `suspended`のメンバーへのロール変更は不可。
- `PENDING`以外の招待は失効できない。

---

### Task 1: 招待失効(`revokeInvitation`)を実装する

**Files:**
- Modify: `functions/src/organizations/invitations.ts`
- Modify: `functions/src/organizations/invitations.test.ts`

**Interfaces:**
- Produces: `Invitation.status`に`'REVOKED'`を追加。`interface RevokeInvitationDeps { getInvitation: (orgId: string, invitationId: string) => Promise<Invitation | null>; markInvitationRevoked: (orgId: string, invitationId: string) => Promise<void> }`、`revokeInvitation(deps: RevokeInvitationDeps, input: { orgId: string; invitationId: string }): Promise<void>`(`PENDING`以外は`Error('この招待は失効できません')`)、`revokeInvitationWithAdminSdk(input: { orgId: string; invitationId: string }): Promise<void>`。Task 4のCallableが`revokeInvitationWithAdminSdk`を呼ぶ。

- [x] **Step 1: 失敗するテストを書く**

`functions/src/organizations/invitations.test.ts`の末尾に追記する(既存のimport・`describe`ブロック群の末尾)。

```ts
describe('revokeInvitation', () => {
  it('throws when the invitation does not exist', async () => {
    await expect(revokeInvitation({
      getInvitation: async () => null,
      markInvitationRevoked: vi.fn(),
    }, { orgId: 'org-1', invitationId: 'inv-1' })).rejects.toThrow('この招待は失効できません')
  })

  it('throws when the invitation is not PENDING', async () => {
    const markInvitationRevoked = vi.fn()
    await expect(revokeInvitation({
      getInvitation: async () => ({ id: 'inv-1', orgId: 'org-1', email: 'a@example.com', role: 'teacher', status: 'ACCEPTED', invitedByUid: 'u1', createdAt: null }),
      markInvitationRevoked,
    }, { orgId: 'org-1', invitationId: 'inv-1' })).rejects.toThrow('この招待は失効できません')
    expect(markInvitationRevoked).not.toHaveBeenCalled()
  })

  it('revokes a PENDING invitation', async () => {
    const markInvitationRevoked = vi.fn()
    await revokeInvitation({
      getInvitation: async () => ({ id: 'inv-1', orgId: 'org-1', email: 'a@example.com', role: 'teacher', status: 'PENDING', invitedByUid: 'u1', createdAt: null }),
      markInvitationRevoked,
    }, { orgId: 'org-1', invitationId: 'inv-1' })
    expect(markInvitationRevoked).toHaveBeenCalledWith('org-1', 'inv-1')
  })
})
```

このファイル13-19行目の以下のimportを:

```ts
import {
  acceptInvitation,
  createInvitation,
  createInvitationWithAdminSdk,
  listMyInvitations,
  reserveTeacherSeatForInvitation,
} from './invitations'
```

以下に置き換える。

```ts
import {
  acceptInvitation,
  createInvitation,
  createInvitationWithAdminSdk,
  listMyInvitations,
  reserveTeacherSeatForInvitation,
  revokeInvitation,
} from './invitations'
```

- [x] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/organizations/invitations.test.ts`
Expected: FAIL(`revokeInvitation`が存在しない)。

- [x] **Step 3: 実装を追加する**

`functions/src/organizations/invitations.ts`の`export interface Invitation { ... status: 'PENDING' | 'ACCEPTED' ... }`を以下に置き換える。

```ts
export interface Invitation {
  id: string
  orgId: string
  email: string
  role: 'admin' | 'teacher'
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED'
  invitedByUid: string
  createdAt: unknown
}
```

`listMyInvitationsWithAdminSdk`より前の適当な位置(例えば`acceptInvitationWithAdminSdk`の直後)に追記する。

```ts
export interface RevokeInvitationDeps {
  getInvitation: (orgId: string, invitationId: string) => Promise<Invitation | null>
  markInvitationRevoked: (orgId: string, invitationId: string) => Promise<void>
}

export interface RevokeInvitationInput { orgId: string; invitationId: string }

export const revokeInvitation = async (deps: RevokeInvitationDeps, input: RevokeInvitationInput): Promise<void> => {
  const invitation = await deps.getInvitation(input.orgId, input.invitationId)
  if (!invitation || invitation.status !== 'PENDING') throw new Error('この招待は失効できません')
  await deps.markInvitationRevoked(input.orgId, input.invitationId)
}

/** Production wiring: Firestore Admin SDK. */
export const revokeInvitationWithAdminSdk = (input: RevokeInvitationInput): Promise<void> => {
  const db = getFirestore()
  return revokeInvitation({
    getInvitation: async (orgId, invitationId) => {
      const snap = await db.doc(`organizations/${orgId}/invitations/${invitationId}`).get()
      if (!snap.exists) return null
      return { id: snap.id, orgId, ...(snap.data() as Omit<Invitation, 'id' | 'orgId'>) }
    },
    markInvitationRevoked: async (orgId, invitationId) => {
      await db.doc(`organizations/${orgId}/invitations/${invitationId}`).update({ status: 'REVOKED' })
    },
  }, input)
}
```

- [x] **Step 4: テストを実行して成功を確認する**

Run: `cd functions && npx vitest run src/organizations/invitations.test.ts`
Expected: 全件PASS。

- [x] **Step 5: 型チェックとfunctions全体のテストを実行する**

Run: `cd functions && npx tsc --noEmit && npx vitest run`
Expected: エラーなし、全テストPASS(`Invitation.status`にunion値を追加しただけなので既存の網羅的分岐があれば型エラーになるが、`STATUS_LABEL`のような網羅チェックはフロント側にありfunctions側には影響しない見込み)。

- [x] **Step 6: コミット**

```bash
git add functions/src/organizations/invitations.ts functions/src/organizations/invitations.test.ts
git commit -m "feat: 招待の失効(revokeInvitation)を実装する"
```

---

### Task 2: 組織向け招待一覧取得(`listOrgInvitations`)を実装する

**Files:**
- Modify: `functions/src/organizations/invitations.ts`
- Modify: `functions/src/organizations/invitations.test.ts`

**Interfaces:**
- Produces: `interface ListOrgInvitationsDeps { getInvitationDocs: (orgId: string) => Promise<Invitation[]> }`、`listOrgInvitations(deps: ListOrgInvitationsDeps, input: { orgId: string }): Promise<Invitation[]>`、`listOrgInvitationsWithAdminSdk(orgId: string): Promise<Invitation[]>`。Task 4のCallableが呼ぶ。

- [x] **Step 1: 失敗するテストを書く**

Task 1で更新した`functions/src/organizations/invitations.test.ts`のimportに`listOrgInvitations`を追加する。

```ts
import {
  acceptInvitation,
  createInvitation,
  createInvitationWithAdminSdk,
  listMyInvitations,
  listOrgInvitations,
  reserveTeacherSeatForInvitation,
  revokeInvitation,
} from './invitations'
```

ファイル末尾に追記する。

```ts
describe('listOrgInvitations', () => {
  it('returns all invitations for the organization regardless of status', async () => {
    const invitations = [
      { id: 'inv-1', orgId: 'org-1', email: 'a@example.com', role: 'teacher' as const, status: 'PENDING' as const, invitedByUid: 'u1', createdAt: null },
      { id: 'inv-2', orgId: 'org-1', email: 'b@example.com', role: 'admin' as const, status: 'REVOKED' as const, invitedByUid: 'u1', createdAt: null },
    ]
    await expect(listOrgInvitations({ getInvitationDocs: async () => invitations }, { orgId: 'org-1' })).resolves.toEqual(invitations)
  })
})
```

- [x] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/organizations/invitations.test.ts`
Expected: FAIL(`listOrgInvitations`が存在しない)。

- [x] **Step 3: 実装を追加する**

`functions/src/organizations/invitations.ts`の`RevokeInvitationInput`/`revokeInvitation`関連コードの直後に追記する。

```ts
export interface ListOrgInvitationsDeps {
  getInvitationDocs: (orgId: string) => Promise<Invitation[]>
}

export interface ListOrgInvitationsInput { orgId: string }

export const listOrgInvitations = (deps: ListOrgInvitationsDeps, input: ListOrgInvitationsInput): Promise<Invitation[]> =>
  deps.getInvitationDocs(input.orgId)

/** Production wiring: Firestore Admin SDK. */
export const listOrgInvitationsWithAdminSdk = (orgId: string): Promise<Invitation[]> => {
  const db = getFirestore()
  return listOrgInvitations({
    getInvitationDocs: async (id) => {
      const snap = await db.collection(`organizations/${id}/invitations`).get()
      return snap.docs.map((doc) => ({ id: doc.id, orgId: id, ...(doc.data() as Omit<Invitation, 'id' | 'orgId'>) }))
    },
  }, { orgId })
}
```

- [x] **Step 4: テストを実行して成功を確認する**

Run: `cd functions && npx vitest run src/organizations/invitations.test.ts`
Expected: 全件PASS。

- [x] **Step 5: 型チェックを実行する**

Run: `cd functions && npx tsc --noEmit`
Expected: エラーなし。

- [x] **Step 6: コミット**

```bash
git add functions/src/organizations/invitations.ts functions/src/organizations/invitations.test.ts
git commit -m "feat: 組織向けの招待一覧取得(listOrgInvitations)を実装する"
```

---

### Task 3: ロール変更(`changeOrgMemberRole`)を実装する

**Files:**
- Create: `functions/src/organizations/changeRole.ts`
- Test: `functions/src/organizations/changeRole.test.ts`

**Interfaces:**
- Consumes: `functions/src/organizations/membershipSync.ts`の`syncOrganizationMembershipChange`(既存)
- Produces: `interface ChangeOrgMemberRoleDeps { getMember: (orgId: string, uid: string) => Promise<{ role: 'owner' | 'admin' | 'teacher'; status: 'active' | 'suspended'; membershipVersion: number } | null>; countActiveOwners: (orgId: string) => Promise<number>; syncMembership: (change: MembershipChange) => Promise<void> }`、`changeOrgMemberRole(deps, input: { orgId: string; uid: string; newRole: 'owner' | 'admin' | 'teacher' }): Promise<void>`、`changeOrgMemberRoleWithAdminSdk(input): Promise<void>`。Task 4のCallableが呼ぶ。

- [x] **Step 1: 失敗するテストを書く**

`functions/src/organizations/changeRole.test.ts`を新規作成する。

```ts
import { describe, expect, it, vi } from 'vitest'
import { changeOrgMemberRole } from './changeRole'

describe('changeOrgMemberRole', () => {
  it('throws when the target member does not exist', async () => {
    await expect(changeOrgMemberRole({
      getMember: async () => null, countActiveOwners: async () => 1, syncMembership: vi.fn(),
    }, { orgId: 'org-1', uid: 'uid-1', newRole: 'admin' })).rejects.toThrow('このメンバーは見つかりません')
  })

  it('throws when the target member is suspended', async () => {
    await expect(changeOrgMemberRole({
      getMember: async () => ({ role: 'teacher', status: 'suspended', membershipVersion: 1 }),
      countActiveOwners: async () => 1, syncMembership: vi.fn(),
    }, { orgId: 'org-1', uid: 'uid-1', newRole: 'admin' })).rejects.toThrow('解除されたメンバーのロールは変更できません')
  })

  it('throws when demoting the sole active owner', async () => {
    const syncMembership = vi.fn()
    await expect(changeOrgMemberRole({
      getMember: async () => ({ role: 'owner', status: 'active', membershipVersion: 1 }),
      countActiveOwners: async () => 1, syncMembership,
    }, { orgId: 'org-1', uid: 'uid-1', newRole: 'admin' })).rejects.toThrow('組織には少なくとも1人のownerが必要です')
    expect(syncMembership).not.toHaveBeenCalled()
  })

  it('allows demoting an owner when another active owner exists', async () => {
    const syncMembership = vi.fn()
    await changeOrgMemberRole({
      getMember: async () => ({ role: 'owner', status: 'active', membershipVersion: 2 }),
      countActiveOwners: async () => 2, syncMembership,
    }, { orgId: 'org-1', uid: 'uid-1', newRole: 'admin' })
    expect(syncMembership).toHaveBeenCalledWith({ orgId: 'org-1', uid: 'uid-1', role: 'admin', status: 'active', membershipVersion: 3, revokedAtSeconds: 0 })
  })

  it('changes a non-owner role and advances membershipVersion', async () => {
    const syncMembership = vi.fn()
    await changeOrgMemberRole({
      getMember: async () => ({ role: 'teacher', status: 'active', membershipVersion: 4 }),
      countActiveOwners: async () => 1, syncMembership,
    }, { orgId: 'org-1', uid: 'uid-2', newRole: 'admin' })
    expect(syncMembership).toHaveBeenCalledWith({ orgId: 'org-1', uid: 'uid-2', role: 'admin', status: 'active', membershipVersion: 5, revokedAtSeconds: 0 })
  })

  it('is a no-op guard-wise when newRole equals the current role but still re-syncs', async () => {
    const syncMembership = vi.fn()
    await changeOrgMemberRole({
      getMember: async () => ({ role: 'teacher', status: 'active', membershipVersion: 1 }),
      countActiveOwners: async () => 1, syncMembership,
    }, { orgId: 'org-1', uid: 'uid-2', newRole: 'teacher' })
    expect(syncMembership).toHaveBeenCalledWith({ orgId: 'org-1', uid: 'uid-2', role: 'teacher', status: 'active', membershipVersion: 2, revokedAtSeconds: 0 })
  })
})
```

- [x] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/organizations/changeRole.test.ts`
Expected: FAIL(`./changeRole`モジュールが存在しない)。

- [x] **Step 3: 実装を追加する**

`functions/src/organizations/changeRole.ts`を新規作成する。

```ts
import { getFirestore } from 'firebase-admin/firestore'
import { getDatabase } from 'firebase-admin/database'
import { syncOrganizationMembershipChange, type MembershipChange } from './membershipSync'

interface MemberSnapshot {
  role: 'owner' | 'admin' | 'teacher'
  status: 'active' | 'suspended'
  membershipVersion: number
}

export interface ChangeOrgMemberRoleDeps {
  getMember: (orgId: string, uid: string) => Promise<MemberSnapshot | null>
  countActiveOwners: (orgId: string) => Promise<number>
  syncMembership: (change: MembershipChange) => Promise<void>
}

export interface ChangeOrgMemberRoleInput {
  orgId: string
  uid: string
  newRole: 'owner' | 'admin' | 'teacher'
}

/** Reuses syncOrganizationMembershipChange — the single function all grant/suspend/role-change flows go through. */
export const changeOrgMemberRole = async (deps: ChangeOrgMemberRoleDeps, input: ChangeOrgMemberRoleInput): Promise<void> => {
  const member = await deps.getMember(input.orgId, input.uid)
  if (!member) throw new Error('このメンバーは見つかりません')
  if (member.status !== 'active') throw new Error('解除されたメンバーのロールは変更できません')

  if (member.role === 'owner' && input.newRole !== 'owner' && await deps.countActiveOwners(input.orgId) <= 1) {
    throw new Error('組織には少なくとも1人のownerが必要です')
  }

  await deps.syncMembership({
    orgId: input.orgId,
    uid: input.uid,
    role: input.newRole,
    status: 'active',
    membershipVersion: member.membershipVersion + 1,
    revokedAtSeconds: 0,
  })
}

/** Production wiring: Firestore Admin SDK and the RTDB membership mirror (same shape as suspendOrgMemberWithAdminSdk). */
export const changeOrgMemberRoleWithAdminSdk = (input: ChangeOrgMemberRoleInput): Promise<void> => {
  const db = getFirestore()
  return changeOrgMemberRole({
    getMember: async (orgId, uid) => {
      const snap = await db.doc(`organizations/${orgId}/members/${uid}`).get()
      return snap.exists ? (snap.data() as MemberSnapshot) : null
    },
    countActiveOwners: async (orgId) => {
      const snap = await db.collection(`organizations/${orgId}/members`)
        .where('role', '==', 'owner').where('status', '==', 'active')
        .get()
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
  }, input)
}
```

- [x] **Step 4: テストを実行して成功を確認する**

Run: `cd functions && npx vitest run src/organizations/changeRole.test.ts`
Expected: 全件PASS。

- [x] **Step 5: 型チェックとfunctions全体のテストを実行する**

Run: `cd functions && npx tsc --noEmit && npx vitest run`
Expected: エラーなし、全テストPASS。

- [x] **Step 6: コミット**

```bash
git add functions/src/organizations/changeRole.ts functions/src/organizations/changeRole.test.ts
git commit -m "feat: メンバーのロール変更(changeOrgMemberRole)を実装する"
```

---

### Task 4: Callableを追加する

**Files:**
- Modify: `functions/src/organizations/onCall.ts`
- Modify: `functions/src/organizations/onCall.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: Task 1〜3の`revokeInvitationWithAdminSdk`/`listOrgInvitationsWithAdminSdk`/`changeOrgMemberRoleWithAdminSdk`
- Produces: `revokeInvitationCallable`/`listOrgInvitationsCallable`/`changeOrgMemberRoleCallable`

- [x] **Step 1: 失敗するテストを書く**

`functions/src/organizations/onCall.test.ts`のimportに追記する。

```ts
import {
  changeOrgMemberRoleCallable, listOrgInvitationsCallable, revokeInvitationCallable,
} from './onCall'
import { changeOrgMemberRoleWithAdminSdk } from './changeRole'
import { listOrgInvitationsWithAdminSdk, revokeInvitationWithAdminSdk } from './invitations'
```

既存の`vi.mock('./invitations', () => ({ ... }))`を以下に置き換える。

```ts
vi.mock('./invitations', () => ({
  acceptInvitationWithAdminSdk: vi.fn(),
  createInvitationWithAdminSdk: vi.fn(),
  listMyInvitationsWithAdminSdk: vi.fn(),
  listOrgInvitationsWithAdminSdk: vi.fn(),
  revokeInvitationWithAdminSdk: vi.fn(),
}))
```

既存の`vi.mock('./schoolHierarchy', ...)`の直後に追記する。

```ts
vi.mock('./changeRole', () => ({ changeOrgMemberRoleWithAdminSdk: vi.fn() }))
```

ファイル末尾に追記する(`teacher`定数は既存ファイル冒頭のものを使う)。

```ts
describe('listOrgInvitationsCallable', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('rejects a caller who is not owner/admin', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    const request = { auth: teacher, data: { orgId: 'org-1' }, rawRequest: {} } as unknown as CallableRequest
    await expect(listOrgInvitationsCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
    expect(listOrgInvitationsWithAdminSdk).not.toHaveBeenCalled()
  })

  it('returns invitations for an owner', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'owner', membershipVersion: 1 })
    vi.mocked(listOrgInvitationsWithAdminSdk).mockResolvedValue([])
    const request = { auth: teacher, data: { orgId: 'org-1' }, rawRequest: {} } as unknown as CallableRequest
    await expect(listOrgInvitationsCallable.run(request)).resolves.toEqual([])
    expect(listOrgInvitationsWithAdminSdk).toHaveBeenCalledWith('org-1')
  })
})

describe('revokeInvitationCallable', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('rejects a caller who is not owner/admin', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    const request = { auth: teacher, data: { orgId: 'org-1', invitationId: 'inv-1' }, rawRequest: {} } as unknown as CallableRequest
    await expect(revokeInvitationCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
    expect(revokeInvitationWithAdminSdk).not.toHaveBeenCalled()
  })

  it('translates a non-PENDING error into failed-precondition', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'admin', membershipVersion: 1 })
    vi.mocked(revokeInvitationWithAdminSdk).mockRejectedValue(new Error('この招待は失効できません'))
    const request = { auth: teacher, data: { orgId: 'org-1', invitationId: 'inv-1' }, rawRequest: {} } as unknown as CallableRequest
    await expect(revokeInvitationCallable.run(request)).rejects.toMatchObject({ code: 'failed-precondition' })
  })

  it('revokes for an admin caller', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'admin', membershipVersion: 1 })
    vi.mocked(revokeInvitationWithAdminSdk).mockResolvedValue(undefined)
    const request = { auth: teacher, data: { orgId: 'org-1', invitationId: 'inv-1' }, rawRequest: {} } as unknown as CallableRequest
    await expect(revokeInvitationCallable.run(request)).resolves.toBeUndefined()
    expect(revokeInvitationWithAdminSdk).toHaveBeenCalledWith({ orgId: 'org-1', invitationId: 'inv-1' })
  })
})

describe('changeOrgMemberRoleCallable', () => {
  // docGetMock is the existing shared `getFirestore().doc().get` mock at the
  // top of this file. changeOrgMemberRoleCallable reads the TARGET member's
  // current role with it (to decide whether an owner is involved on either
  // side of the change), separately from `requireActiveOrgMember`, which
  // authorizes the CALLER via the mocked `requireActiveOrgMember` itself.
  beforeEach(() => {
    vi.clearAllMocks()
    docGetMock.mockResolvedValue({ exists: true, get: () => 'teacher' }) // target's current role: non-owner by default
  })

  it('rejects a caller who is not owner/admin', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    const request = { auth: teacher, data: { orgId: 'org-1', uid: 'uid-2', newRole: 'admin' }, rawRequest: {} } as unknown as CallableRequest
    await expect(changeOrgMemberRoleCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
    expect(changeOrgMemberRoleWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects an admin caller promoting a member to owner', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'admin', membershipVersion: 1 })
    const request = { auth: teacher, data: { orgId: 'org-1', uid: 'uid-2', newRole: 'owner' }, rawRequest: {} } as unknown as CallableRequest
    await expect(changeOrgMemberRoleCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
    expect(changeOrgMemberRoleWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects an admin caller demoting an existing owner', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'admin', membershipVersion: 1 })
    docGetMock.mockResolvedValue({ exists: true, get: () => 'owner' }) // target is currently an owner
    const request = { auth: teacher, data: { orgId: 'org-1', uid: 'uid-2', newRole: 'admin' }, rawRequest: {} } as unknown as CallableRequest
    await expect(changeOrgMemberRoleCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
    expect(changeOrgMemberRoleWithAdminSdk).not.toHaveBeenCalled()
  })

  it('translates the sole-owner guard error into failed-precondition', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'owner', membershipVersion: 1 })
    vi.mocked(changeOrgMemberRoleWithAdminSdk).mockRejectedValue(new Error('組織には少なくとも1人のownerが必要です'))
    const request = { auth: teacher, data: { orgId: 'org-1', uid: 'uid-2', newRole: 'admin' }, rawRequest: {} } as unknown as CallableRequest
    await expect(changeOrgMemberRoleCallable.run(request)).rejects.toMatchObject({ code: 'failed-precondition' })
  })

  it('allows an owner to promote a member to owner', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'owner', membershipVersion: 1 })
    vi.mocked(changeOrgMemberRoleWithAdminSdk).mockResolvedValue(undefined)
    const request = { auth: teacher, data: { orgId: 'org-1', uid: 'uid-2', newRole: 'owner' }, rawRequest: {} } as unknown as CallableRequest
    await expect(changeOrgMemberRoleCallable.run(request)).resolves.toBeUndefined()
    expect(changeOrgMemberRoleWithAdminSdk).toHaveBeenCalledWith({ orgId: 'org-1', uid: 'uid-2', newRole: 'owner' })
  })

  it('allows an owner to demote an existing owner', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'owner', membershipVersion: 1 })
    docGetMock.mockResolvedValue({ exists: true, get: () => 'owner' })
    vi.mocked(changeOrgMemberRoleWithAdminSdk).mockResolvedValue(undefined)
    const request = { auth: teacher, data: { orgId: 'org-1', uid: 'uid-2', newRole: 'admin' }, rawRequest: {} } as unknown as CallableRequest
    await expect(changeOrgMemberRoleCallable.run(request)).resolves.toBeUndefined()
  })

  it('allows an admin to change a role between admin and teacher', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'admin', membershipVersion: 1 })
    vi.mocked(changeOrgMemberRoleWithAdminSdk).mockResolvedValue(undefined)
    const request = { auth: teacher, data: { orgId: 'org-1', uid: 'uid-2', newRole: 'teacher' }, rawRequest: {} } as unknown as CallableRequest
    await expect(changeOrgMemberRoleCallable.run(request)).resolves.toBeUndefined()
  })
})
```

- [x] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/organizations/onCall.test.ts`
Expected: FAIL(3つのCallableが存在しない)。

- [x] **Step 3: `onCall.ts`に実装を追加する**

冒頭のimportに追記する。

```ts
import { changeOrgMemberRoleWithAdminSdk } from './changeRole'
import { listOrgInvitationsWithAdminSdk, revokeInvitationWithAdminSdk } from './invitations'
```

(既存の`import { acceptInvitationWithAdminSdk, createInvitationWithAdminSdk, listMyInvitationsWithAdminSdk } from './invitations'`はそのまま残し、上記を別のimport文として追加する。)

ファイル末尾に追記する。`changeOrgMemberRoleCallable`は、呼び出し元の権限確認(`requireActiveOrgMember`)に加えて、**対象メンバーの現在のロール**を1回読み、`newRole`・現在ロールのどちらかが`owner`に関わる場合は呼び出し元が`owner`であることを要求する(admin経由でのowner昇格・owner降格の両方を防ぐため)。

```ts
interface ListOrgInvitationsRequest { orgId?: unknown }

export const listOrgInvitationsCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as ListOrgInvitationsRequest
  if (typeof data.orgId !== 'string') throw new HttpsError('invalid-argument', 'orgId は必須です。')
  const membership = await requireActiveOrgMember(getFirestore(), data.orgId, request.auth.uid)
  requireManager(membership, 'owner または admin のみ招待一覧を確認できます。')
  return listOrgInvitationsWithAdminSdk(data.orgId)
})

interface RevokeInvitationRequest { orgId?: unknown; invitationId?: unknown }

export const revokeInvitationCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as RevokeInvitationRequest
  if (typeof data.orgId !== 'string' || typeof data.invitationId !== 'string') throw new HttpsError('invalid-argument', '入力内容が不正です。')
  const membership = await requireActiveOrgMember(getFirestore(), data.orgId, request.auth.uid)
  requireManager(membership, 'owner または admin のみ招待を失効できます。')
  try {
    await revokeInvitationWithAdminSdk({ orgId: data.orgId, invitationId: data.invitationId })
  } catch (error) {
    if (error instanceof Error && error.message === 'この招待は失効できません') throw new HttpsError('failed-precondition', error.message)
    throw error
  }
})

interface ChangeOrgMemberRoleRequest { orgId?: unknown; uid?: unknown; newRole?: unknown }
const isValidRole = (value: unknown): value is 'owner' | 'admin' | 'teacher' => value === 'owner' || value === 'admin' || value === 'teacher'

export const changeOrgMemberRoleCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as ChangeOrgMemberRoleRequest
  if (typeof data.orgId !== 'string' || typeof data.uid !== 'string' || !isValidRole(data.newRole)) {
    throw new HttpsError('invalid-argument', '入力内容が不正です。')
  }
  const membership = await requireActiveOrgMember(getFirestore(), data.orgId, request.auth.uid)
  requireManager(membership, 'owner または admin のみロールを変更できます。')

  const targetSnap = await getFirestore().doc(`organizations/${data.orgId}/members/${data.uid}`).get()
  const targetCurrentRole = targetSnap.exists ? (targetSnap.get('role') as string | undefined) : undefined
  if ((data.newRole === 'owner' || targetCurrentRole === 'owner') && membership.role !== 'owner') {
    throw new HttpsError('permission-denied', 'owner に関わるロール変更は owner のみ行えます。')
  }

  try {
    await changeOrgMemberRoleWithAdminSdk({ orgId: data.orgId, uid: data.uid, newRole: data.newRole })
  } catch (error) {
    if (error instanceof Error && (error.message === '組織には少なくとも1人のownerが必要です' || error.message === '解除されたメンバーのロールは変更できません' || error.message === 'このメンバーは見つかりません')) {
      throw new HttpsError('failed-precondition', error.message)
    }
    throw error
  }
})
```

- [x] **Step 4: `functions/src/index.ts`にエクスポートを追加する**

既存の以下のブロックを:

```ts
export {
  ensurePersonalOrgCallable,
  createSchoolOrgCallable,
  createInvitationCallable,
  acceptInvitationCallable,
  listMyInvitationsCallable,
  getOrgPlanLimitsCallable,
  listOrgMembersCallable,
  suspendOrgMemberCallable,
  createParentOrgCallable,
  linkSchoolToParentOrgCallable,
  unlinkSchoolFromParentOrgCallable,
  listChildSchoolsCallable,
} from './organizations/onCall'
```

以下に置き換える。

```ts
export {
  ensurePersonalOrgCallable,
  createSchoolOrgCallable,
  createInvitationCallable,
  acceptInvitationCallable,
  listMyInvitationsCallable,
  listOrgInvitationsCallable,
  revokeInvitationCallable,
  changeOrgMemberRoleCallable,
  getOrgPlanLimitsCallable,
  listOrgMembersCallable,
  suspendOrgMemberCallable,
  createParentOrgCallable,
  linkSchoolToParentOrgCallable,
  unlinkSchoolFromParentOrgCallable,
  listChildSchoolsCallable,
} from './organizations/onCall'
```

- [x] **Step 5: テストを実行して成功を確認する**

Run: `cd functions && npx vitest run src/organizations/onCall.test.ts`
Expected: 全件PASS。

- [x] **Step 6: 型チェックとfunctions全体のテストを実行する**

Run: `cd functions && npx tsc --noEmit && npx vitest run`
Expected: エラーなし、全テストPASS。

- [x] **Step 7: コミット**

```bash
git add functions/src/organizations/onCall.ts functions/src/organizations/onCall.test.ts functions/src/index.ts
git commit -m "feat: 招待一覧取得・失効・ロール変更Callableを追加する"
```

---

### Task 5: クライアントlibとUIを実装する

**Files:**
- Modify: `src/lib/organizations/invitations.ts`
- Modify: `src/lib/organizations/orgMembers.ts`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: Task 4の`listOrgInvitationsCallable`/`revokeInvitationCallable`/`changeOrgMemberRoleCallable`(Callable名)

- [x] **Step 1: クライアントlibを実装する**

`src/lib/organizations/invitations.ts`の`export interface Invitation { ... status: 'PENDING' | 'ACCEPTED' ... }`を以下に置き換える。

```ts
export interface Invitation {
  id: string
  orgId: string
  email: string
  role: 'admin' | 'teacher'
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED'
  invitedByUid: string
  createdAt: unknown
}
```

同ファイル末尾に追記する。

```ts
export const listOrgInvitations = async (functions: Functions, orgId: string): Promise<Invitation[]> =>
  (await httpsCallable<{ orgId: string }, Invitation[]>(functions, 'listOrgInvitationsCallable')({ orgId })).data

export interface RevokeInvitationInput { orgId: string; invitationId: string }
export const revokeInvitation = async (functions: Functions, input: RevokeInvitationInput): Promise<void> => {
  await httpsCallable<RevokeInvitationInput, void>(functions, 'revokeInvitationCallable')(input)
}
```

`src/lib/organizations/orgMembers.ts`末尾に追記する。

```ts
export interface ChangeOrgMemberRoleInput { orgId: string; uid: string; newRole: 'owner' | 'admin' | 'teacher' }
export const changeOrgMemberRole = async (functions: Functions, input: ChangeOrgMemberRoleInput): Promise<void> => {
  await httpsCallable<ChangeOrgMemberRoleInput, void>(functions, 'changeOrgMemberRoleCallable')(input)
}
```

- [x] **Step 2: 失敗するコンポーネントテストを書く**

`src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`には単一の共有`props`フィクスチャは無く、`memberProps`(スプレッドで使われる部分フィクスチャ)と、各テストが個別に列挙する`<SchoolOrgSettingsPage ... />`呼び出しが混在している。`onRevokeInvitation`/`onChangeRole`を新たに必須propとして追加すると、これらすべての呼び出しに影響する。

まず11-18行目の`memberProps`を以下に置き換える。

```ts
const memberProps = {
  members: [],
  viewerUid: 'uid-owner',
  canManageMembers: false,
  onSuspendMember: vi.fn(),
  suspending: false,
  teacherSeatLimit: undefined,
  onRevokeInvitation: vi.fn(),
  onChangeRole: vi.fn(),
}
```

`memberProps`を`{...memberProps}`でスプレッドしているテスト(21-48行目・50-63行目・65-73行目・122-130行目)はこれだけで型・実行の両面で通る。

`memberProps`をスプレッドせず個別にpropを列挙している4箇所(77-87行目・89-97行目・99-107行目・109-119行目、`describe('member list', ...)`ブロック内)は、各`<SchoolOrgSettingsPage .../>`呼び出しに`onRevokeInvitation={vi.fn()} onChangeRole={vi.fn()}`を追加する。例えば77-87行目のテストを以下に置き換える。

```tsx
  it('shows the seat usage and member list', () => {
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false}
          members={members} viewerUid="uid-owner" canManageMembers suspending={false} onSuspendMember={vi.fn()} teacherSeatLimit={5}
          onRevokeInvitation={vi.fn()} onChangeRole={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByText('教師席: 使用中 2 / 上限 5')).toBeInTheDocument()
    expect(screen.getByText('owner@example.com')).toBeInTheDocument()
    expect(screen.getByText('teacher@example.com')).toBeInTheDocument()
  })
```

同様に89-97行目・99-107行目・109-119行目の残り3テストにも`onRevokeInvitation={vi.fn()} onChangeRole={vi.fn()}`を`<SchoolOrgSettingsPage .../>`の属性列へ追加する(既存の属性はすべてそのまま維持する)。

`describe('parent organization display', ...)`ブロック(124行目)は`memberProps`をスプレッドしているため変更不要。

続けて、`describe('member list', ...)`ブロックの末尾(119行目`})`の直前)に新しいテストを追記する。

```tsx
  it('shows an owner role option only when the viewer is an owner, and hides it otherwise', () => {
    const { rerender } = render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false}
          members={members} viewerUid="uid-owner" canManageMembers suspending={false} onSuspendMember={vi.fn()} teacherSeatLimit={5}
          onRevokeInvitation={vi.fn()} onChangeRole={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('option', { name: 'owner' })).toBeInTheDocument()

    rerender(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false}
          members={members} viewerUid="uid-teacher" canManageMembers={false} suspending={false} onSuspendMember={vi.fn()} teacherSeatLimit={5}
          onRevokeInvitation={vi.fn()} onChangeRole={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('option', { name: 'owner' })).not.toBeInTheDocument()
  })

  it('calls onChangeRole when a new role is selected', () => {
    const onChangeRole = vi.fn()
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false}
          members={members} viewerUid="uid-owner" canManageMembers suspending={false} onSuspendMember={vi.fn()} teacherSeatLimit={5}
          onRevokeInvitation={vi.fn()} onChangeRole={onChangeRole} />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByLabelText('uid-teacherのロール'), { target: { value: 'admin' } })
    expect(onChangeRole).toHaveBeenCalledWith('uid-teacher', 'admin')
  })
```

最後に、`describe('SchoolOrgSettingsPage', ...)`ブロック(20-48行目)の最初のテスト(`'shows the organization name and existing invitations'`)を以下に置き換え、失効ボタンの表示/非表示も検証する。

```tsx
  it('shows the organization name and existing invitations', () => {
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage
          orgName="桜丘高校"
          orgId="org-1"
          invitations={[
            { id: 'i1', orgId: 'org-1', email: 'x@example.com', role: 'teacher', status: 'PENDING', invitedByUid: 'u1', createdAt: null },
            { id: 'i2', orgId: 'org-1', email: 'y@example.com', role: 'teacher', status: 'REVOKED', invitedByUid: 'u1', createdAt: null },
          ]}
          onInvite={vi.fn()}
          inviting={false}
          {...memberProps}
          canManageMembers
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('桜丘高校')).toBeInTheDocument()
    expect(screen.getByText('x@example.com')).toBeInTheDocument()
    expect(screen.getByText('招待中')).toBeInTheDocument()
    expect(screen.getByText('y@example.com')).toBeInTheDocument()
    expect(screen.getByText('失効済み')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '失効' })).toHaveLength(1)
  })

  it('calls onRevokeInvitation with the invitation id', () => {
    const onRevokeInvitation = vi.fn()
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage
          orgName="桜丘高校"
          orgId="org-1"
          invitations={[{ id: 'i1', orgId: 'org-1', email: 'x@example.com', role: 'teacher', status: 'PENDING', invitedByUid: 'u1', createdAt: null }]}
          onInvite={vi.fn()}
          inviting={false}
          {...memberProps}
          canManageMembers
          onRevokeInvitation={onRevokeInvitation}
        />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '失効' }))
    expect(onRevokeInvitation).toHaveBeenCalledWith('i1')
  })
```

- [x] **Step 3: テストを実行して失敗を確認する**

Run: `npx vitest run src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`
Expected: FAIL(`onRevokeInvitation`/`onChangeRole`propsが存在しない、「失効」ボタン・ロールセレクトが無い)。

- [x] **Step 4: `SchoolOrgSettingsPage.tsx`を修正する**

`const STATUS_LABEL: Record<Invitation['status'], string> = { PENDING: '招待中', ACCEPTED: '参加済み' }`を以下に置き換える。

```ts
const STATUS_LABEL: Record<Invitation['status'], string> = { PENDING: '招待中', ACCEPTED: '参加済み', REVOKED: '失効済み' }
```

`export interface SchoolOrgSettingsPageProps { ... }`に2行追加する(`onSuspendMember`/`suspending`の並びに)。

```ts
  onRevokeInvitation: (invitationId: string) => void
  onChangeRole: (uid: string, newRole: 'owner' | 'admin' | 'teacher') => void
```

関数シグネチャの分割代入に`onRevokeInvitation, onChangeRole`を追加する。

```ts
export function SchoolOrgSettingsPage({
  orgName, orgId, invitations, onInvite, inviting, members, viewerUid, canManageMembers, onSuspendMember, suspending, teacherSeatLimit, parentOrgName, onRevokeInvitation, onChangeRole,
}: SchoolOrgSettingsPageProps) {
```

関数本体冒頭、`const activeSeatCount = ...`の直後に閲覧者ロールの導出を追加する。

```ts
  const viewerRole = members.find((member) => member.uid === viewerUid)?.role
```

招待一覧の`<ListItem key={invitation.id}>`ブロックを以下に置き換える(失効ボタンを追加)。

```tsx
              <ListItem
                key={invitation.id}
                secondaryAction={canManageMembers && invitation.status === 'PENDING' ? (
                  <Button size="small" onClick={() => onRevokeInvitation(invitation.id)}>失効</Button>
                ) : undefined}
              >
                <ListItemText primary={invitation.email} secondary={STATUS_LABEL[invitation.status]} />
              </ListItem>
```

メンバー一覧の`<ListItem ...>`ブロック(`secondaryAction`に解除ボタンがある部分)を以下に置き換える(ロール変更セレクトを追加)。

```tsx
            <ListItem
              key={member.uid}
              secondaryAction={canManageMembers && member.uid !== viewerUid && member.status === 'active' ? (
                <Stack direction="row" spacing={1} alignItems="center">
                  <TextField
                    select
                    size="small"
                    label={`${member.uid}のロール`}
                    value={member.role}
                    onChange={(event) => onChangeRole(member.uid, event.target.value as 'owner' | 'admin' | 'teacher')}
                    sx={{ minWidth: 120 }}
                  >
                    {(viewerRole === 'owner' ? (['owner', 'admin', 'teacher'] as const) : (['admin', 'teacher'] as const))
                      .filter((roleOption) => viewerRole === 'owner' || member.role !== 'owner')
                      .map((roleOption) => <MenuItem key={roleOption} value={roleOption}>{roleOption}</MenuItem>)}
                  </TextField>
                  <Button size="small" disabled={suspending} onClick={() => onSuspendMember(member.uid)}>解除</Button>
                </Stack>
              ) : undefined}
            >
              <ListItemText
                primary={member.email ?? member.uid}
                secondary={`${ROLE_LABEL[member.role]} / ${member.status === 'active' ? '有効' : '解除済み'}`}
              />
            </ListItem>
```

- [x] **Step 5: テストを実行して成功を確認する**

Run: `npx vitest run src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`
Expected: 全件PASS。

- [x] **Step 6: `App.tsx`の`SchoolOrgSettingsRoute`を修正する**

`src/App.tsx`44行目の以下を:

```ts
import { acceptInvitation, createInvitation, listMyInvitations, type Invitation } from './lib/organizations/invitations'
```

以下に置き換える。

```ts
import { acceptInvitation, createInvitation, listMyInvitations, listOrgInvitations, revokeInvitation, type Invitation } from './lib/organizations/invitations'
```

53行目の以下を:

```ts
import { listOrgMembers, suspendOrgMember, type OrgMember } from './lib/organizations/orgMembers'
```

以下に置き換える。

```ts
import { changeOrgMemberRole, listOrgMembers, suspendOrgMember, type OrgMember } from './lib/organizations/orgMembers'
```

`SchoolOrgSettingsRoute`関数内に`invitations`をサーバーから読み込む`useEffect`を追加する(現状`invitations`はローカル状態のみで初期読み込みが無いため)。

```ts
  const loadInvitations = useCallback(() => {
    if (!orgId) return
    void listOrgInvitations(services.functions, orgId).then(setInvitations).catch(() => setInvitations([]))
  }, [orgId, services.functions])
  useEffect(() => { loadInvitations() }, [loadInvitations])
```

`SchoolOrgSettingsPage`の呼び出しに`onRevokeInvitation`/`onChangeRole`propを追加する。

```tsx
      onRevokeInvitation={(invitationId) => {
        void revokeInvitation(services.functions, { orgId, invitationId }).then(loadInvitations)
      }}
      onChangeRole={(uid, newRole) => {
        void changeOrgMemberRole(services.functions, { orgId, uid, newRole }).then(loadMembers)
      }}
```

`onInvite`内で招待作成後にローカル状態へ楽観的追加している行(`setInvitations((prev) => [...prev, { ... }])`)を、追加のロード呼び出しに置き換える。

```ts
      onInvite={async (email, role) => {
        setInviting(true)
        try {
          await createInvitation(services.functions, { orgId, email, role })
          await loadInvitations()
        } finally {
          setInviting(false)
        }
      }}
```

- [x] **Step 7: プロジェクト全体の型チェックとテストを実行する**

Run: `npx tsc -b && npx tsc -p tsconfig.rules.json && npx vitest run`
Expected: エラーなし、全テストPASS。

- [x] **Step 8: コミット**

```bash
git add src/lib/organizations/invitations.ts src/lib/organizations/orgMembers.ts src/components/teacher/organizations/SchoolOrgSettingsPage.tsx src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx src/App.tsx
git commit -m "feat: 招待一覧・失効・ロール変更のUIを追加する"
```
