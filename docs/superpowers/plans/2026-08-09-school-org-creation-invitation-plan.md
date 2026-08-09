# 学校組織の作成・招待 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**正本:** `docs/superpowers/specs/2026-08-09-school-org-creation-invitation-design.md`(設計仕様)。矛盾する場合は仕様書を優先する。

**Goal:** 複数人が所属する「学校組織」を作成でき、owner/adminが個別のメールアドレス宛に教師を招待し、招待された教師がGoogle認証済みメールアドレスの一致だけで参加を確定できるようにする。

**Architecture:** 既存の`ensurePersonalOrg`(Firestore+RTDBミラーの二段書き込み)と`syncOrganizationMembershipChange`(メンバー追加・役割変更の唯一の書き込み経路、既存・未使用のまま用意されていた関数)をそのまま再利用する。招待には秘密トークン・リンクは発行せず、招待された本人のGoogle認証済みメールアドレス自体を受諾の資格情報とする。

**Tech Stack:** TypeScript, React, MUI, react-router, Firebase Cloud Functions v2 (`onCall`), Firebase Admin SDK (Firestore + Realtime Database, `collectionGroup`クエリ), Vitest, React Testing Library。

## Global Constraints

- 招待方式は個別招待のみ。共通リンク・コード、ドメイン認証は対象外。
- 学校組織の`verificationStatus`は常に`'PENDING'`で作成する。`'VERIFIED'`への遷移Callableは作らない。
- メンバー追加・役割変更は必ず`syncOrganizationMembershipChange`(`functions/src/organizations/membershipSync.ts`)経由で行う。他の場所でFirestoreのメンバードキュメントとRTDBミラーを直接書き分けない。
- 新規Callableは`functions/src/index.ts`からexportする。
- 認可は既存の`isCallerTeacher`・`requireActiveOrgMember`をそのまま再利用する。
- `organizations/{orgId}/invitations/{invitationId}`はクライアントから直接読み書きできない(Callable経由のみ)。
- 日本語UI文言を用いる。
- 各タスクの実装後、そのタスクが変更したファイルのテストを実行してから次のタスクに進む。全タスク完了後、`npm run verify`を実行し、通過することを確認してからコミットする。

---

## File Structure

| File | Change |
| --- | --- |
| `functions/src/organizations/schoolOrg.ts`, `.test.ts` | Create（Task 1） |
| `functions/src/organizations/invitations.ts`, `.test.ts` | Create（Task 2） |
| `functions/src/organizations/onCall.ts`, `.test.ts` | Modify（Task 3。4つのCallable追加） |
| `functions/src/index.ts` | Modify（Task 3。export追加） |
| `firestore.rules`, `test/firestore.rules.test.ts` | Modify（Task 4。invitationsの拒否ルール） |
| `src/lib/organizations/schoolOrg.ts`, `.test.ts` | Create（Task 5） |
| `src/lib/organizations/invitations.ts`, `.test.ts` | Create（Task 5） |
| `src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`, `.test.tsx` | Create（Task 6） |
| `src/components/teacher/organizations/PendingInvitationsBanner.tsx`, `.test.tsx` | Create（Task 7） |
| `src/App.tsx`, `.test.tsx` | Modify（Task 8。ルート追加・バナー統合） |

---

### Task 1: `createSchoolOrg`（純粋関数 — 学校組織の作成）

**Files:**
- Create: `functions/src/organizations/schoolOrg.ts`
- Test: `functions/src/organizations/schoolOrg.test.ts`

**Interfaces:**
- Consumes: なし（`ensurePersonalOrg`と同じFirestore+RTDBミラーの二段書き込みパターンを踏襲するが、コードの共有はしない——`ensurePersonalOrg`は「1人1つ」の冪等性ロジックを持ち、学校組織の「呼ぶたびに新規作成」とは性質が異なるため）。
- Produces: `CreateSchoolOrgInput { name: string; ownerUid: string }`、`CreateSchoolOrgResult { orgId: string }`、`createSchoolOrg(deps, input): Promise<CreateSchoolOrgResult>`、`createSchoolOrgWithAdminSdk(input): Promise<CreateSchoolOrgResult>`。Task 3で消費される。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// functions/src/organizations/schoolOrg.test.ts
import { describe, expect, it } from 'vitest'
import { createSchoolOrg } from './schoolOrg'

const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    runTransaction: async (fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean }>
      set: (path: string, data: Record<string, unknown>) => void
    }) => Promise<void>) => fn({
      get: async (path: string) => ({ exists: docs.has(path) }),
      set: (path: string, data: Record<string, unknown>) => { docs.set(path, data) },
    }),
  }
}

describe('createSchoolOrg', () => {
  it('creates a school organization and its owner membership', async () => {
    const fake = makeFakeFirestore()
    const rtdbWrites: unknown[] = []
    const result = await createSchoolOrg({
      firestore: fake as never,
      generateOrgId: () => 'school_fixed-id',
      writeOrgAccessMirror: async (payload) => { rtdbWrites.push(payload) },
    }, { name: '桜丘高校', ownerUid: 'uid-1' })

    expect(result).toEqual({ orgId: 'school_fixed-id' })
    expect(fake.docs.get('organizations/school_fixed-id')).toMatchObject({ type: 'school', name: '桜丘高校', verificationStatus: 'PENDING', ownerUid: 'uid-1' })
    expect(fake.docs.get('organizations/school_fixed-id/members/uid-1')).toMatchObject({ role: 'owner', status: 'active', membershipVersion: 1 })
    expect(rtdbWrites).toEqual([{ orgId: 'school_fixed-id', uid: 'uid-1', role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 }])
  })

  it('creates a new organization on every call, unlike ensurePersonalOrg', async () => {
    const fake = makeFakeFirestore()
    let counter = 0
    const generateOrgId = () => `school_${(counter += 1)}`
    await createSchoolOrg({ firestore: fake as never, generateOrgId, writeOrgAccessMirror: async () => {} }, { name: 'A高校', ownerUid: 'uid-1' })
    await createSchoolOrg({ firestore: fake as never, generateOrgId, writeOrgAccessMirror: async () => {} }, { name: 'B高校', ownerUid: 'uid-1' })
    expect(fake.docs.has('organizations/school_1')).toBe(true)
    expect(fake.docs.has('organizations/school_2')).toBe(true)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/organizations/schoolOrg.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装する**

```ts
// functions/src/organizations/schoolOrg.ts
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { getDatabase } from 'firebase-admin/database'
import { randomUUID } from 'node:crypto'
import type { OrgAccessMirrorPayload } from './personalOrg'

export interface CreateSchoolOrgInput { name: string; ownerUid: string }
export interface CreateSchoolOrgResult { orgId: string }

interface FirestoreTransaction {
  get: (path: string) => Promise<{ exists: boolean }>
  set: (path: string, data: Record<string, unknown>) => void
}
export interface CreateSchoolOrgDeps {
  firestore: { runTransaction: (fn: (tx: FirestoreTransaction) => Promise<void>) => Promise<void> }
  generateOrgId: () => string
  writeOrgAccessMirror: (payload: OrgAccessMirrorPayload) => Promise<void>
  now?: () => unknown
}

/**
 * 個人組織(ensurePersonalOrg)と異なり「1人1つ」の制約はなく、呼ぶたびに
 * 新しい学校組織を作成するのが正しい動作——冪等性チェックは行わない。
 * verificationStatusは常にPENDINGで作成し、VERIFIEDへの遷移はこの関数の
 * 責務外(手動運用、設計仕様参照)。
 */
export const createSchoolOrg = async (deps: CreateSchoolOrgDeps, input: CreateSchoolOrgInput): Promise<CreateSchoolOrgResult> => {
  const orgId = deps.generateOrgId()
  const nowValue = deps.now ? deps.now() : new Date().toISOString()
  const orgPath = `organizations/${orgId}`
  const memberPath = `organizations/${orgId}/members/${input.ownerUid}`

  await deps.firestore.runTransaction(async (tx) => {
    tx.set(orgPath, { type: 'school', name: input.name, verificationStatus: 'PENDING', ownerUid: input.ownerUid, createdAt: nowValue })
    tx.set(memberPath, { role: 'owner', status: 'active', membershipVersion: 1, joinedAt: nowValue })
  })

  await deps.writeOrgAccessMirror({ orgId, uid: input.ownerUid, role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 })

  return { orgId }
}

/** Production wiring: Firestore Admin SDK + RTDB Admin SDK, matching personalOrg.ts's ensurePersonalOrgWithAdminSdk. */
export const createSchoolOrgWithAdminSdk = (input: CreateSchoolOrgInput): Promise<CreateSchoolOrgResult> => {
  const db = getFirestore()
  return createSchoolOrg({
    firestore: {
      runTransaction: (fn) => db.runTransaction(async (tx) => fn({
        get: async (path) => ({ exists: (await tx.get(db.doc(path))).exists }),
        set: (path, data) => { tx.set(db.doc(path), { ...data, createdAt: FieldValue.serverTimestamp() }) },
      })),
    },
    generateOrgId: () => `school_${randomUUID()}`,
    writeOrgAccessMirror: async (payload) => {
      await getDatabase().ref().update({
        [`orgAccess/${payload.orgId}/${payload.uid}`]: { role: payload.role, status: payload.status, membershipVersion: payload.membershipVersion, revokedAtSeconds: payload.revokedAtSeconds },
        [`orgAccessMeta/${payload.orgId}/${payload.uid}`]: { syncState: 'SYNCED' },
      })
    },
  }, input)
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/organizations/schoolOrg.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add functions/src/organizations/schoolOrg.ts functions/src/organizations/schoolOrg.test.ts
git commit -m "feat: 学校組織の作成ロジック(createSchoolOrg)を追加"
```

---

### Task 2: `invitations`（純粋関数 — 招待の発行・受諾・一覧）

**Files:**
- Create: `functions/src/organizations/invitations.ts`
- Test: `functions/src/organizations/invitations.test.ts`

**Interfaces:**
- Consumes: `syncOrganizationMembershipChange`（既存、`functions/src/organizations/membershipSync.ts`）。
- Produces: `Invitation`型、`createInvitation(deps, input): Promise<{invitationId: string}>`、`acceptInvitation(deps, input): Promise<{status: 'ACCEPTED' | 'ALREADY_MEMBER'}>`、`listMyInvitations(deps, input): Promise<Invitation[]>`、各`...WithAdminSdk`版。Task 3で消費される。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// functions/src/organizations/invitations.test.ts
import { describe, expect, it, vi } from 'vitest'
import { acceptInvitation, createInvitation, listMyInvitations } from './invitations'

describe('createInvitation', () => {
  it('normalizes the email and creates a PENDING invitation', async () => {
    const created: Record<string, unknown>[] = []
    const result = await createInvitation({
      findPendingInvitation: async () => null,
      createInvitationDoc: async (orgId, data) => { created.push({ orgId, ...data }); return 'invitation-1' },
    }, { orgId: 'org-1', email: 'Teacher@Example.com', role: 'teacher', invitedByUid: 'owner-1' })

    expect(result).toEqual({ invitationId: 'invitation-1' })
    expect(created).toEqual([{ orgId: 'org-1', email: 'teacher@example.com', role: 'teacher', status: 'PENDING', invitedByUid: 'owner-1', createdAt: expect.anything() }])
  })

  it('returns the existing PENDING invitation instead of creating a duplicate', async () => {
    const createInvitationDoc = vi.fn()
    const existing = { id: 'invitation-1', orgId: 'org-1', email: 'teacher@example.com', role: 'teacher' as const, status: 'PENDING' as const, invitedByUid: 'owner-1', createdAt: 'x' }
    const result = await createInvitation({ findPendingInvitation: async () => existing, createInvitationDoc }, { orgId: 'org-1', email: 'teacher@example.com', role: 'teacher', invitedByUid: 'owner-1' })
    expect(result).toEqual({ invitationId: 'invitation-1' })
    expect(createInvitationDoc).not.toHaveBeenCalled()
  })
})

describe('acceptInvitation', () => {
  const pending = { id: 'invitation-1', orgId: 'org-1', email: 'teacher@example.com', role: 'teacher' as const, status: 'PENDING' as const, invitedByUid: 'owner-1', createdAt: 'x' }

  it('rejects when the caller email does not match the invitation', async () => {
    await expect(acceptInvitation({
      getInvitation: async () => pending, getMembership: async () => null, syncMembership: vi.fn(), markInvitationAccepted: vi.fn(),
    }, { orgId: 'org-1', invitationId: 'invitation-1', callerUid: 'uid-2', callerEmail: 'other@example.com' })).rejects.toThrow('あなた宛の招待ではありません')
  })

  it('rejects when the invitation is not PENDING', async () => {
    await expect(acceptInvitation({
      getInvitation: async () => ({ ...pending, status: 'ACCEPTED' }), getMembership: async () => null, syncMembership: vi.fn(), markInvitationAccepted: vi.fn(),
    }, { orgId: 'org-1', invitationId: 'invitation-1', callerUid: 'uid-2', callerEmail: 'teacher@example.com' })).rejects.toThrow('この招待は既に処理されています')
  })

  it('syncs membership and marks the invitation accepted for a new member', async () => {
    const syncMembership = vi.fn()
    const markInvitationAccepted = vi.fn()
    const result = await acceptInvitation({
      getInvitation: async () => pending, getMembership: async () => null, syncMembership, markInvitationAccepted,
    }, { orgId: 'org-1', invitationId: 'invitation-1', callerUid: 'uid-2', callerEmail: 'teacher@example.com' })

    expect(result).toEqual({ status: 'ACCEPTED' })
    expect(syncMembership).toHaveBeenCalledWith({ orgId: 'org-1', uid: 'uid-2', role: 'teacher', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 })
    expect(markInvitationAccepted).toHaveBeenCalledWith('org-1', 'invitation-1')
  })

  it('does not re-sync membership when the caller is already an active member', async () => {
    const syncMembership = vi.fn()
    const markInvitationAccepted = vi.fn()
    const result = await acceptInvitation({
      getInvitation: async () => pending, getMembership: async () => ({ status: 'active' }), syncMembership, markInvitationAccepted,
    }, { orgId: 'org-1', invitationId: 'invitation-1', callerUid: 'uid-2', callerEmail: 'teacher@example.com' })

    expect(result).toEqual({ status: 'ALREADY_MEMBER' })
    expect(syncMembership).not.toHaveBeenCalled()
    expect(markInvitationAccepted).toHaveBeenCalledWith('org-1', 'invitation-1')
  })
})

describe('listMyInvitations', () => {
  it('queries pending invitations by the normalized caller email', async () => {
    const queryPendingInvitationsByEmail = vi.fn(async () => [])
    await listMyInvitations({ queryPendingInvitationsByEmail }, { email: 'Teacher@Example.com' })
    expect(queryPendingInvitationsByEmail).toHaveBeenCalledWith('teacher@example.com')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/organizations/invitations.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装する**

```ts
// functions/src/organizations/invitations.ts
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { syncOrganizationMembershipChange, type MembershipChange } from './membershipSync'
import { getDatabase } from 'firebase-admin/database'

export interface Invitation {
  id: string
  orgId: string
  email: string
  role: 'admin' | 'teacher'
  status: 'PENDING' | 'ACCEPTED'
  invitedByUid: string
  createdAt: unknown
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase()

// ---- createInvitation ----

export interface CreateInvitationDeps {
  findPendingInvitation: (orgId: string, email: string) => Promise<Invitation | null>
  createInvitationDoc: (orgId: string, data: { email: string; role: 'admin' | 'teacher'; status: 'PENDING'; invitedByUid: string; createdAt: unknown }) => Promise<string>
  now?: () => unknown
}
export interface CreateInvitationInput { orgId: string; email: string; role: 'admin' | 'teacher'; invitedByUid: string }

export const createInvitation = async (deps: CreateInvitationDeps, input: CreateInvitationInput): Promise<{ invitationId: string }> => {
  const email = normalizeEmail(input.email)
  const existing = await deps.findPendingInvitation(input.orgId, email)
  if (existing) return { invitationId: existing.id }
  const invitationId = await deps.createInvitationDoc(input.orgId, {
    email, role: input.role, status: 'PENDING', invitedByUid: input.invitedByUid, createdAt: deps.now ? deps.now() : new Date().toISOString(),
  })
  return { invitationId }
}

/** Production wiring: Firestore Admin SDK. */
export const createInvitationWithAdminSdk = (input: CreateInvitationInput): Promise<{ invitationId: string }> => {
  const db = getFirestore()
  return createInvitation({
    findPendingInvitation: async (orgId, email) => {
      const snap = await db.collection(`organizations/${orgId}/invitations`).where('email', '==', email).where('status', '==', 'PENDING').limit(1).get()
      if (snap.empty) return null
      const doc = snap.docs[0]
      return { id: doc.id, orgId, ...(doc.data() as Omit<Invitation, 'id' | 'orgId'>) }
    },
    createInvitationDoc: async (orgId, data) => {
      const ref = await db.collection(`organizations/${orgId}/invitations`).add({ ...data, createdAt: FieldValue.serverTimestamp() })
      return ref.id
    },
  }, input)
}

// ---- acceptInvitation ----

export interface AcceptInvitationDeps {
  getInvitation: (orgId: string, invitationId: string) => Promise<Invitation | null>
  getMembership: (orgId: string, uid: string) => Promise<{ status: string } | null>
  syncMembership: (change: MembershipChange) => Promise<void>
  markInvitationAccepted: (orgId: string, invitationId: string) => Promise<void>
}
export interface AcceptInvitationInput { orgId: string; invitationId: string; callerUid: string; callerEmail: string }

/**
 * 既にアクティブなメンバーの場合はsyncMembershipを呼ばない——役割の
 * 意図しない上書き(格上げ/格下げ)を防ぐため。招待自体は常にACCEPTEDへ
 * 更新する(再送された古い招待を一覧に残さないため)。
 */
export const acceptInvitation = async (deps: AcceptInvitationDeps, input: AcceptInvitationInput): Promise<{ status: 'ACCEPTED' | 'ALREADY_MEMBER' }> => {
  const invitation = await deps.getInvitation(input.orgId, input.invitationId)
  if (!invitation || invitation.status !== 'PENDING') throw new Error('この招待は既に処理されています')
  if (normalizeEmail(invitation.email) !== normalizeEmail(input.callerEmail)) throw new Error('あなた宛の招待ではありません')

  const membership = await deps.getMembership(input.orgId, input.callerUid)
  const alreadyActive = membership?.status === 'active'
  if (!alreadyActive) {
    await deps.syncMembership({
      orgId: input.orgId, uid: input.callerUid, role: invitation.role, status: 'active', membershipVersion: 1, revokedAtSeconds: 0,
    })
  }
  await deps.markInvitationAccepted(input.orgId, input.invitationId)
  return { status: alreadyActive ? 'ALREADY_MEMBER' : 'ACCEPTED' }
}

/** Production wiring: Firestore Admin SDK + syncOrganizationMembershipChange's own RTDB mirror wiring. */
export const acceptInvitationWithAdminSdk = (input: AcceptInvitationInput): Promise<{ status: 'ACCEPTED' | 'ALREADY_MEMBER' }> => {
  const db = getFirestore()
  return acceptInvitation({
    getInvitation: async (orgId, invitationId) => {
      const snap = await db.doc(`organizations/${orgId}/invitations/${invitationId}`).get()
      if (!snap.exists) return null
      return { id: snap.id, orgId, ...(snap.data() as Omit<Invitation, 'id' | 'orgId'>) }
    },
    getMembership: async (orgId, uid) => {
      const snap = await db.doc(`organizations/${orgId}/members/${uid}`).get()
      return snap.exists ? { status: snap.get('status') as string } : null
    },
    syncMembership: (change) => syncOrganizationMembershipChange({
      markMirrorPending: async (orgId, membershipVersion) => { await getDatabase().ref(`orgAccessMeta/${orgId}/${change.uid}`).set({ syncState: 'PENDING', membershipVersion }) },
      updateFirestoreMembership: async (c) => { await db.doc(`organizations/${c.orgId}/members/${c.uid}`).set({ role: c.role, status: c.status, membershipVersion: c.membershipVersion, joinedAt: FieldValue.serverTimestamp() }, { merge: true }) },
      commitMirrorSynced: async (c) => {
        await getDatabase().ref().update({
          [`orgAccess/${c.orgId}/${c.uid}`]: { role: c.role, status: c.status, membershipVersion: c.membershipVersion, revokedAtSeconds: c.revokedAtSeconds },
          [`orgAccessMeta/${c.orgId}/${c.uid}`]: { syncState: 'SYNCED' },
        })
      },
    }, change),
    markInvitationAccepted: async (orgId, invitationId) => { await db.doc(`organizations/${orgId}/invitations/${invitationId}`).update({ status: 'ACCEPTED' }) },
  }, input)
}

// ---- listMyInvitations ----

export interface ListMyInvitationsDeps { queryPendingInvitationsByEmail: (email: string) => Promise<Invitation[]> }
export interface ListMyInvitationsInput { email: string }

export const listMyInvitations = (deps: ListMyInvitationsDeps, input: ListMyInvitationsInput): Promise<Invitation[]> =>
  deps.queryPendingInvitationsByEmail(normalizeEmail(input.email))

/** Production wiring: Firestore Admin SDK collectionGroup query across every org's invitations subcollection. */
export const listMyInvitationsWithAdminSdk = (input: ListMyInvitationsInput): Promise<Invitation[]> => {
  const db = getFirestore()
  return listMyInvitations({
    queryPendingInvitationsByEmail: async (email) => {
      const snap = await db.collectionGroup('invitations').where('email', '==', email).where('status', '==', 'PENDING').get()
      return snap.docs.map((doc) => ({ id: doc.id, orgId: doc.ref.parent.parent!.id, ...(doc.data() as Omit<Invitation, 'id' | 'orgId'>) }))
    },
  }, input)
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/organizations/invitations.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add functions/src/organizations/invitations.ts functions/src/organizations/invitations.test.ts
git commit -m "feat: 招待の発行・受諾・一覧取得ロジック(invitations)を追加"
```

---

### Task 3: 4つのCallable（`createSchoolOrgCallable`・`createInvitationCallable`・`acceptInvitationCallable`・`listMyInvitationsCallable`）

**Files:**
- Modify: `functions/src/organizations/onCall.ts`
- Modify: `functions/src/organizations/onCall.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: `createSchoolOrgWithAdminSdk`（Task 1）、`createInvitationWithAdminSdk`/`acceptInvitationWithAdminSdk`/`listMyInvitationsWithAdminSdk`（Task 2）、`requireActiveOrgMember`（既存）。
- Produces: 4つのCallable名。Task 5のクライアントラッパーで消費される。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/organizations/onCall.test.ts`に追記する:

```ts
import { acceptInvitationCallable, createInvitationCallable, createSchoolOrgCallable, isCallerTeacher, listMyInvitationsCallable } from './onCall'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { requireActiveOrgMember } from './authorization'
import { createSchoolOrgWithAdminSdk } from './schoolOrg'
import { acceptInvitationWithAdminSdk, createInvitationWithAdminSdk, listMyInvitationsWithAdminSdk } from './invitations'

vi.mock('./authorization', () => ({ requireActiveOrgMember: vi.fn() }))
vi.mock('./schoolOrg', () => ({ createSchoolOrgWithAdminSdk: vi.fn() }))
vi.mock('./invitations', () => ({ createInvitationWithAdminSdk: vi.fn(), acceptInvitationWithAdminSdk: vi.fn(), listMyInvitationsWithAdminSdk: vi.fn() }))
const docGetMock = vi.fn()
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ doc: () => ({ get: docGetMock }) }) }))

const teacher = { uid: 'teacher-1', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } } as unknown as CallableRequest['auth']

describe('createSchoolOrgCallable', () => {
  beforeEach(() => vi.clearAllMocks())
  it('rejects an empty name', async () => {
    const request = { auth: teacher, data: { name: '' } } as unknown as CallableRequest
    await expect(createSchoolOrgCallable.run(request)).rejects.toMatchObject({ code: 'invalid-argument' })
  })
  it('creates a school org for an authenticated teacher', async () => {
    vi.mocked(createSchoolOrgWithAdminSdk).mockResolvedValueOnce({ orgId: 'school_1' })
    const request = { auth: teacher, data: { name: '桜丘高校' } } as unknown as CallableRequest
    await expect(createSchoolOrgCallable.run(request)).resolves.toEqual({ orgId: 'school_1' })
    expect(createSchoolOrgWithAdminSdk).toHaveBeenCalledWith({ name: '桜丘高校', ownerUid: 'teacher-1' })
  })
})

describe('createInvitationCallable', () => {
  beforeEach(() => vi.clearAllMocks())
  it('rejects a caller whose role is not owner/admin', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    const request = { auth: teacher, data: { orgId: 'org-1', email: 'x@example.com', role: 'teacher' } } as unknown as CallableRequest
    await expect(createInvitationCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
  })
  it('creates an invitation for an owner', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    vi.mocked(createInvitationWithAdminSdk).mockResolvedValueOnce({ invitationId: 'invitation-1' })
    const request = { auth: teacher, data: { orgId: 'org-1', email: 'x@example.com', role: 'teacher' } } as unknown as CallableRequest
    await expect(createInvitationCallable.run(request)).resolves.toEqual({ invitationId: 'invitation-1' })
  })
})

describe('acceptInvitationCallable', () => {
  beforeEach(() => vi.clearAllMocks())
  it('passes the caller uid and verified email through to acceptInvitation', async () => {
    vi.mocked(acceptInvitationWithAdminSdk).mockResolvedValueOnce({ status: 'ACCEPTED' })
    const request = { auth: { uid: 'uid-2', token: { email_verified: true, email: 'x@example.com', firebase: { sign_in_provider: 'google.com' } } }, data: { orgId: 'org-1', invitationId: 'invitation-1' } } as unknown as CallableRequest
    await expect(acceptInvitationCallable.run(request)).resolves.toEqual({ status: 'ACCEPTED' })
    expect(acceptInvitationWithAdminSdk).toHaveBeenCalledWith({ orgId: 'org-1', invitationId: 'invitation-1', callerUid: 'uid-2', callerEmail: 'x@example.com' })
  })
})

describe('listMyInvitationsCallable', () => {
  beforeEach(() => vi.clearAllMocks())
  it('queries by the caller verified email', async () => {
    vi.mocked(listMyInvitationsWithAdminSdk).mockResolvedValueOnce([])
    const request = { auth: { uid: 'uid-2', token: { email_verified: true, email: 'x@example.com', firebase: { sign_in_provider: 'google.com' } } }, data: {} } as unknown as CallableRequest
    await expect(listMyInvitationsCallable.run(request)).resolves.toEqual([])
    expect(listMyInvitationsWithAdminSdk).toHaveBeenCalledWith({ email: 'x@example.com' })
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/organizations/onCall.test.ts`
Expected: FAIL（4つのCallableが存在しない）

- [ ] **Step 3: 実装する**

`functions/src/organizations/onCall.ts`の`import`群とファイル末尾を以下の内容に揃える（既存の`ensurePersonalOrgCallable`はそのまま残す）:

```ts
import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { ensurePersonalOrgWithAdminSdk } from './personalOrg'
import { createSchoolOrgWithAdminSdk } from './schoolOrg'
import { acceptInvitationWithAdminSdk, createInvitationWithAdminSdk, listMyInvitationsWithAdminSdk } from './invitations'
import { requireActiveOrgMember } from './authorization'

/** Mirrors src/lib/auth/roles.ts's isTeacherIdentity and firestore.rules' teacher(). */
export const isCallerTeacher = (token: { email_verified?: boolean; firebase?: { sign_in_provider?: string } }): boolean =>
  token.email_verified === true && token.firebase?.sign_in_provider === 'google.com'

export const ensurePersonalOrgCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  return ensurePersonalOrgWithAdminSdk(request.auth.uid)
})

interface CreateSchoolOrgRequest { name?: unknown }

export const createSchoolOrgCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as CreateSchoolOrgRequest
  if (typeof data.name !== 'string' || data.name.trim().length === 0) throw new HttpsError('invalid-argument', '組織名は必須です。')
  return createSchoolOrgWithAdminSdk({ name: data.name, ownerUid: request.auth.uid })
})

interface CreateInvitationRequest { orgId?: unknown; email?: unknown; role?: unknown }
const isValidInvitationRole = (role: unknown): role is 'admin' | 'teacher' => role === 'admin' || role === 'teacher'

export const createInvitationCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as CreateInvitationRequest
  if (typeof data.orgId !== 'string' || typeof data.email !== 'string' || !data.email.includes('@') || !isValidInvitationRole(data.role)) {
    throw new HttpsError('invalid-argument', '入力内容が不正です。')
  }
  const db = getFirestore()
  const membership = await requireActiveOrgMember(db, data.orgId, request.auth.uid)
  if (membership.role !== 'owner' && membership.role !== 'admin') throw new HttpsError('permission-denied', 'owner または admin のみ招待を作成できます。')
  return createInvitationWithAdminSdk({ orgId: data.orgId, email: data.email, role: data.role, invitedByUid: request.auth.uid })
})

interface AcceptInvitationRequest { orgId?: unknown; invitationId?: unknown }

export const acceptInvitationCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as AcceptInvitationRequest
  if (typeof data.orgId !== 'string' || typeof data.invitationId !== 'string') throw new HttpsError('invalid-argument', '入力内容が不正です。')
  const callerEmail = request.auth.token.email as string | undefined
  if (!callerEmail) throw new HttpsError('failed-precondition', 'メールアドレスを確認できません。')
  try {
    return await acceptInvitationWithAdminSdk({ orgId: data.orgId, invitationId: data.invitationId, callerUid: request.auth.uid, callerEmail })
  } catch (error) {
    if (error instanceof Error && error.message === 'あなた宛の招待ではありません') throw new HttpsError('permission-denied', error.message)
    if (error instanceof Error && error.message === 'この招待は既に処理されています') throw new HttpsError('failed-precondition', error.message)
    throw error
  }
})

export const listMyInvitationsCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const callerEmail = request.auth.token.email as string | undefined
  if (!callerEmail) return []
  return listMyInvitationsWithAdminSdk({ email: callerEmail })
})
```

`functions/src/index.ts`の`export { ensurePersonalOrgCallable } from './organizations/onCall'`を以下に置き換える:

```ts
export {
  ensurePersonalOrgCallable,
  createSchoolOrgCallable,
  createInvitationCallable,
  acceptInvitationCallable,
  listMyInvitationsCallable,
} from './organizations/onCall'
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/organizations/onCall.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add functions/src/organizations/onCall.ts functions/src/organizations/onCall.test.ts functions/src/index.ts
git commit -m "feat: 学校組織作成・招待の4つのCallableを追加"
```

---

### Task 4: `firestore.rules`（invitationsの直接アクセス拒否）

**Files:**
- Modify: `firestore.rules`
- Modify: `test/firestore.rules.test.ts`

**Interfaces:**
- Consumes: なし。
- Produces: `organizations/{orgId}/invitations/{invitationId}`への`allow read, write: if false`ルール。

- [ ] **Step 1: 失敗するテストを書く**

`test/firestore.rules.test.ts`の既存の`organizations/{orgId}/members/{uid}`のルールテストの近くに追記する（既存ファイルの`initializeTestEnvironment`/`assertFails`のimport・セットアップをそのまま使う）:

```ts
describe('organizations/{orgId}/invitations/{invitationId}', () => {
  it('denies all direct client reads and writes', async () => {
    const context = testEnv.authenticatedContext('teacher-a', teacherToken)
    await assertFails(getDoc(doc(context.firestore(), 'organizations/org-1/invitations/invitation-1')))
    await assertFails(setDoc(doc(context.firestore(), 'organizations/org-1/invitations/invitation-1'), { email: 'x@example.com' }))
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npm run test:rules`
Expected: FAIL（`invitations`に対する明示的な拒否ルールがなく、既存の`match /organizations/{orgId}/{document=**}`のようなワイルドカードも存在しないため、実際にはFirestoreのデフォルト拒否で既にFAILしない可能性がある——その場合はこのステップで「既存のデフォルト拒否で通っている」ことを確認し、Step 3で明示的なルールを追加して意図を文書化する）

- [ ] **Step 3: 実装する**

`firestore.rules`の`organizations/{orgId}/members/{uid}`のmatchブロックの直後に追記する:

```
    match /organizations/{orgId}/invitations/{invitationId} {
      // Callable経由のみ(createInvitationCallable/acceptInvitationCallable/
      // listMyInvitationsCallable)。招待には秘密トークンを持たせない設計
      // (メールアドレス一致が資格情報)のため、クライアントへの直接読み取り
      // を許可すると他人宛の招待の存在を推測されるリスクがある。
      allow read, write: if false;
    }
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm run test:rules`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add firestore.rules test/firestore.rules.test.ts
git commit -m "feat: invitationsサブコレクションへの直接クライアントアクセスを拒否するルールを追加"
```

---

### Task 5: クライアントラッパー

**Files:**
- Create: `src/lib/organizations/schoolOrg.ts`, `.test.ts`
- Create: `src/lib/organizations/invitations.ts`, `.test.ts`

**Interfaces:**
- Produces: `createSchoolOrg(functions, {name}): Promise<{orgId}>`、`createInvitation(functions, {orgId, email, role}): Promise<{invitationId}>`、`acceptInvitation(functions, {orgId, invitationId}): Promise<{status}>`、`listMyInvitations(functions): Promise<Invitation[]>`。Task 6・7で消費される。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/organizations/schoolOrg.test.ts
import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { createSchoolOrg } from './schoolOrg'
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))
describe('createSchoolOrg', () => it('calls createSchoolOrgCallable', async () => {
  const call = vi.fn().mockResolvedValue({ data: { orgId: 'school_1' } })
  vi.mocked(httpsCallable).mockReturnValue(call as never)
  await expect(createSchoolOrg({} as never, { name: '桜丘高校' })).resolves.toEqual({ orgId: 'school_1' })
  expect(httpsCallable).toHaveBeenCalledWith({}, 'createSchoolOrgCallable')
  expect(call).toHaveBeenCalledWith({ name: '桜丘高校' })
}))
```

```ts
// src/lib/organizations/invitations.test.ts
import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { acceptInvitation, createInvitation, listMyInvitations } from './invitations'
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

describe('invitations client wrappers', () => {
  it('createInvitation calls createInvitationCallable', async () => {
    const call = vi.fn().mockResolvedValue({ data: { invitationId: 'invitation-1' } })
    vi.mocked(httpsCallable).mockReturnValue(call as never)
    await expect(createInvitation({} as never, { orgId: 'org-1', email: 'x@example.com', role: 'teacher' })).resolves.toEqual({ invitationId: 'invitation-1' })
    expect(httpsCallable).toHaveBeenCalledWith({}, 'createInvitationCallable')
  })
  it('acceptInvitation calls acceptInvitationCallable', async () => {
    const call = vi.fn().mockResolvedValue({ data: { status: 'ACCEPTED' } })
    vi.mocked(httpsCallable).mockReturnValue(call as never)
    await expect(acceptInvitation({} as never, { orgId: 'org-1', invitationId: 'invitation-1' })).resolves.toEqual({ status: 'ACCEPTED' })
    expect(httpsCallable).toHaveBeenCalledWith({}, 'acceptInvitationCallable')
  })
  it('listMyInvitations calls listMyInvitationsCallable with no arguments', async () => {
    const call = vi.fn().mockResolvedValue({ data: [] })
    vi.mocked(httpsCallable).mockReturnValue(call as never)
    await expect(listMyInvitations({} as never)).resolves.toEqual([])
    expect(httpsCallable).toHaveBeenCalledWith({}, 'listMyInvitationsCallable')
    expect(call).toHaveBeenCalledWith()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/lib/organizations/schoolOrg.test.ts src/lib/organizations/invitations.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装する**

```ts
// src/lib/organizations/schoolOrg.ts
import { httpsCallable, type Functions } from 'firebase/functions'
export interface CreateSchoolOrgInput { name: string }
export interface CreateSchoolOrgResult { orgId: string }
export const createSchoolOrg = async (functions: Functions, input: CreateSchoolOrgInput): Promise<CreateSchoolOrgResult> =>
  (await httpsCallable<CreateSchoolOrgInput, CreateSchoolOrgResult>(functions, 'createSchoolOrgCallable')(input)).data
```

```ts
// src/lib/organizations/invitations.ts
import { httpsCallable, type Functions } from 'firebase/functions'

export interface Invitation { id: string; orgId: string; email: string; role: 'admin' | 'teacher'; status: 'PENDING' | 'ACCEPTED'; invitedByUid: string; createdAt: unknown }

export interface CreateInvitationInput { orgId: string; email: string; role: 'admin' | 'teacher' }
export const createInvitation = async (functions: Functions, input: CreateInvitationInput): Promise<{ invitationId: string }> =>
  (await httpsCallable<CreateInvitationInput, { invitationId: string }>(functions, 'createInvitationCallable')(input)).data

export interface AcceptInvitationInput { orgId: string; invitationId: string }
export const acceptInvitation = async (functions: Functions, input: AcceptInvitationInput): Promise<{ status: 'ACCEPTED' | 'ALREADY_MEMBER' }> =>
  (await httpsCallable<AcceptInvitationInput, { status: 'ACCEPTED' | 'ALREADY_MEMBER' }>(functions, 'acceptInvitationCallable')(input)).data

export const listMyInvitations = async (functions: Functions): Promise<Invitation[]> =>
  (await httpsCallable<void, Invitation[]>(functions, 'listMyInvitationsCallable')()).data
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/lib/organizations/schoolOrg.test.ts src/lib/organizations/invitations.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/organizations/schoolOrg.ts src/lib/organizations/schoolOrg.test.ts src/lib/organizations/invitations.ts src/lib/organizations/invitations.test.ts
git commit -m "feat: 学校組織作成・招待のクライアントラッパーを追加"
```

---

### Task 6: `SchoolOrgSettingsPage`（組織設定・招待管理画面）

**Files:**
- Create: `src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`
- Test: `src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`

**Interfaces:**
- Consumes: `createInvitation`（Task 5）。
- Produces: `SchoolOrgSettingsPage`コンポーネント。Props: `{orgName: string; invitations: Invitation[]; onInvite: (email: string, role: 'admin' | 'teacher') => void; inviting: boolean}`。Task 8で消費される。

- [ ] **Step 1: 失敗するテストを書く**

```tsx
// src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SchoolOrgSettingsPage } from './SchoolOrgSettingsPage'

describe('SchoolOrgSettingsPage', () => {
  it('shows the organization name and existing invitations', () => {
    render(<SchoolOrgSettingsPage orgName="桜丘高校" invitations={[{ id: 'i1', orgId: 'org-1', email: 'x@example.com', role: 'teacher', status: 'PENDING', invitedByUid: 'u1', createdAt: null }]} onInvite={vi.fn()} inviting={false} />)
    expect(screen.getByText('桜丘高校')).toBeInTheDocument()
    expect(screen.getByText('x@example.com')).toBeInTheDocument()
    expect(screen.getByText('招待中')).toBeInTheDocument()
  })

  it('submits the invitation form', () => {
    const onInvite = vi.fn()
    render(<SchoolOrgSettingsPage orgName="桜丘高校" invitations={[]} onInvite={onInvite} inviting={false} />)
    fireEvent.change(screen.getByLabelText('招待するメールアドレス'), { target: { value: 'new@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '招待を送る' }))
    expect(onInvite).toHaveBeenCalledWith('new@example.com', 'teacher')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: 実装する**

```tsx
// src/components/teacher/organizations/SchoolOrgSettingsPage.tsx
import { useState } from 'react'
import { Button, List, ListItem, ListItemText, MenuItem, Stack, TextField, Typography } from '@mui/material'
import type { Invitation } from '../../../lib/organizations/invitations'

const STATUS_LABEL: Record<Invitation['status'], string> = { PENDING: '招待中', ACCEPTED: '参加済み' }

export interface SchoolOrgSettingsPageProps {
  orgName: string
  invitations: Invitation[]
  onInvite: (email: string, role: 'admin' | 'teacher') => void
  inviting: boolean
}

export function SchoolOrgSettingsPage({ orgName, invitations, onInvite, inviting }: SchoolOrgSettingsPageProps) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'teacher'>('teacher')

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Typography variant="h5">{orgName}</Typography>
      <Stack spacing={2}>
        <Typography variant="subtitle1">教師を招待</Typography>
        <TextField label="招待するメールアドレス" value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField select label="役割" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'teacher')} sx={{ maxWidth: 200 }}>
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
git commit -m "feat: 学校組織設定・招待管理画面(SchoolOrgSettingsPage)を追加"
```

---

### Task 7: `PendingInvitationsBanner`（参加待ちの招待バナー）

**Files:**
- Create: `src/components/teacher/organizations/PendingInvitationsBanner.tsx`
- Test: `src/components/teacher/organizations/PendingInvitationsBanner.test.tsx`

**Interfaces:**
- Consumes: `acceptInvitation`（Task 5）。
- Produces: `PendingInvitationsBanner`コンポーネント。Props: `{invitations: Invitation[]; onAccept: (invitation: Invitation) => void; accepting: boolean}`。Task 8で消費される。

- [ ] **Step 1: 失敗するテストを書く**

```tsx
// src/components/teacher/organizations/PendingInvitationsBanner.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PendingInvitationsBanner } from './PendingInvitationsBanner'

const invitation = { id: 'i1', orgId: 'org-1', email: 'x@example.com', role: 'teacher' as const, status: 'PENDING' as const, invitedByUid: 'u1', createdAt: null }

describe('PendingInvitationsBanner', () => {
  it('renders nothing when there are no pending invitations', () => {
    const { container } = render(<PendingInvitationsBanner invitations={[]} onAccept={vi.fn()} accepting={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('accepts an invitation', () => {
    const onAccept = vi.fn()
    render(<PendingInvitationsBanner invitations={[invitation]} onAccept={onAccept} accepting={false} />)
    fireEvent.click(screen.getByRole('button', { name: '参加する' }))
    expect(onAccept).toHaveBeenCalledWith(invitation)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/components/teacher/organizations/PendingInvitationsBanner.test.tsx`
Expected: FAIL

- [ ] **Step 3: 実装する**

```tsx
// src/components/teacher/organizations/PendingInvitationsBanner.tsx
import { Alert, Button, Stack } from '@mui/material'
import type { Invitation } from '../../../lib/organizations/invitations'

export interface PendingInvitationsBannerProps {
  invitations: Invitation[]
  onAccept: (invitation: Invitation) => void
  accepting: boolean
}

export function PendingInvitationsBanner({ invitations, onAccept, accepting }: PendingInvitationsBannerProps) {
  if (invitations.length === 0) return null
  return (
    <Stack spacing={1}>
      {invitations.map((invitation) => (
        <Alert
          key={invitation.id}
          severity="info"
          action={<Button color="inherit" size="small" disabled={accepting} onClick={() => onAccept(invitation)}>参加する</Button>}
        >
          組織から招待されています。
        </Alert>
      ))}
    </Stack>
  )
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/components/teacher/organizations/PendingInvitationsBanner.test.tsx`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/components/teacher/organizations/PendingInvitationsBanner.tsx src/components/teacher/organizations/PendingInvitationsBanner.test.tsx
git commit -m "feat: 参加待ちの招待バナー(PendingInvitationsBanner)を追加"
```

---

### Task 8: `App.tsx`への統合（ルート追加・バナー統合）

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: `SchoolOrgSettingsPage`（Task 6）、`PendingInvitationsBanner`（Task 7）、`createSchoolOrg`/`createInvitation`/`acceptInvitation`/`listMyInvitations`（Task 5）。

**設計メモ（このタスクの実装判断）:** `/teacher/organizations/:orgId/settings`の実際の認可（招待を出せるのはowner/adminのみ）は`createInvitationCallable`（Task 3）がサーバー側で強制する——このプロジェクトの他の画面（例: 誰でも開ける`TemplateEditorPage`だが実際の書き込みは`firestore.rules`/Callableが認可する）と同じ「画面のガードは信号確認、実際の認可はサーバー側」という分担にならう。そのため`/teacher/organizations/new`・`/teacher/organizations/:orgId/settings`の両方とも、既存の`TemplateRouteGuard`（署名済み教師であることのみを確認する既存のガード）をそのまま再利用し、orgId固有の新しいガードコンポーネントは作らない。

- [ ] **Step 1: 失敗するテストを書く**

`src/App.test.tsx`の`describe('Guided Lesson Builder routes', ...)`ブロックの直後に、以下の新しいdescribeブロックを追記する（既存の`window.history.pushState`/`getDocMock`/`callableMock`のセットアップをそのまま使う）:

```tsx
describe('School org creation and invitation routes', () => {
  it('routes /teacher/organizations/new to the school org creation form', async () => {
    window.history.pushState({}, '', '/teacher/organizations/new')
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ status: 'active' }) })
    render(<App isLessonPlatformV2Enabled getServices={getServices} />)
    authStateCallback?.({ uid: 'teacher-uid', emailVerified: true, providerData: [{ providerId: 'google.com' }] })
    expect(await screen.findByRole('heading', { name: '学校組織を作成' })).toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })

  it('routes /teacher/organizations/:orgId/settings to the settings page for a signed-in teacher', async () => {
    window.history.pushState({}, '', '/teacher/organizations/org-1/settings')
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ status: 'active' }) })
    callableMock.mockResolvedValue({ data: [] })
    render(<App isLessonPlatformV2Enabled getServices={getServices} />)
    authStateCallback?.({ uid: 'teacher-uid', emailVerified: true, providerData: [{ providerId: 'google.com' }] })
    expect(await screen.findByRole('button', { name: '招待を送る' })).toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })

  it('shows the pending invitations banner on the template list route when invitations exist', async () => {
    window.history.pushState({}, '', '/teacher/templates')
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ status: 'active' }) })
    callableMock.mockResolvedValue({
      data: [{ id: 'invitation-1', orgId: 'org-1', email: 'teacher@example.com', role: 'teacher', status: 'PENDING', invitedByUid: 'owner-1', createdAt: null }],
    })
    render(<App isLessonPlatformV2Enabled getServices={getServices} />)
    authStateCallback?.({ uid: 'teacher-uid', emailVerified: true, providerData: [{ providerId: 'google.com' }] })
    expect(await screen.findByRole('button', { name: '参加する' })).toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/App.test.tsx`
Expected: FAIL

- [ ] **Step 3: 実装する**

`src/App.tsx`に以下を追加する:

1. `import`に`SchoolOrgSettingsPage`（`./components/teacher/organizations/SchoolOrgSettingsPage`）・`PendingInvitationsBanner`（`./components/teacher/organizations/PendingInvitationsBanner`）・`createSchoolOrg`・`createInvitation`・`acceptInvitation`・`listMyInvitations`（`./lib/organizations/schoolOrg`・`./lib/organizations/invitations`）・`type Invitation`を追加する。
2. `TemplateEditRoute`の定義の直後に、以下の2つのルートコンポーネントを追加する:

```tsx
function SchoolOrgNewRoute({ services }: { services: FirebaseServices }) {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()
  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography variant="h5" component="h1">学校組織を作成</Typography>
      <TextField label="組織名" value={name} onChange={(e) => setName(e.target.value)} />
      <Button
        variant="contained"
        disabled={creating || !name}
        sx={{ alignSelf: 'flex-start' }}
        onClick={async () => {
          setCreating(true)
          try {
            const { orgId } = await createSchoolOrg(services.functions, { name })
            navigate(`/teacher/organizations/${orgId}/settings`)
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

function SchoolOrgSettingsRoute({ services }: { services: FirebaseServices }) {
  const { orgId } = useParams<{ orgId: string }>()
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [inviting, setInviting] = useState(false)
  useEffect(() => { void listMyInvitations(services.functions) }, [services])
  if (!orgId) return <GuardLoading />
  return (
    <SchoolOrgSettingsPage
      orgName={orgId}
      invitations={invitations}
      inviting={inviting}
      onInvite={async (email, role) => {
        setInviting(true)
        try {
          await createInvitation(services.functions, { orgId, email, role })
          setInvitations((prev) => [...prev, { id: crypto.randomUUID(), orgId, email, role, status: 'PENDING', invitedByUid: '', createdAt: null }])
        } finally {
          setInviting(false)
        }
      }}
    />
  )
}
```

（`orgName`に組織名そのものではなく`orgId`を暫定表示しているのは、組織ドキュメント自体の取得が本サブプロジェクトの範囲外のため——`organizations/{orgId}`への`get`権限は`firestore.rules`で`activeMember(orgId)`に許可済みなので、`getDoc`で組織名を取得するのは軽微な追加改善として実装時に含めてよいが、必須ではない。）

3. `<Routes>`内、`/teacher/templates/:templateId/edit`ルートの直後に以下を追加する:

```tsx
  <Route path="/teacher/organizations/new" element={enabled && services ? <TemplateRouteGuard services={services}><SchoolOrgNewRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
  <Route path="/teacher/organizations/:orgId/settings" element={enabled && services ? <TemplateRouteGuard services={services}><SchoolOrgSettingsRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
```

4. `TemplateListRoute`に、招待一覧の取得とバナー表示を追加する。既存の`templates`読み込み`useEffect`はそのまま残し、`return`文の中身だけ`Stack`でラップして`PendingInvitationsBanner`を追加する:

```tsx
function TemplateListRoute({ services }: { services: FirebaseServices }) {
  const [templates, setTemplates] = useState<LessonTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [accepting, setAccepting] = useState(false)
  const navigate = useNavigate()
  useEffect(() => {
    void listMyInvitations(services.functions).then(setInvitations).catch(() => setInvitations([]))
  }, [services])
  // ...(既存のtemplates読み込みuseEffectはそのまま)
  return (
    <Stack spacing={2}>
      <PendingInvitationsBanner
        invitations={invitations}
        accepting={accepting}
        onAccept={(invitation) => {
          setAccepting(true)
          void acceptInvitation(services.functions, { orgId: invitation.orgId, invitationId: invitation.id })
            .then(() => setInvitations((prev) => prev.filter((item) => item.id !== invitation.id)))
            .finally(() => setAccepting(false))
        }}
      />
      <TemplateListPage templates={templates} loading={loading} onCreateNew={() => navigate('/teacher/templates/new')} onOpen={(id) => navigate(`/teacher/templates/${id}/edit`)} />
    </Stack>
  )
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/App.test.tsx`
Expected: PASS

- [ ] **Step 5: モノレポ全体を検証する**

Run: `npm run verify`
Expected: 全ワークスペースのlint/typecheck/test/buildが通過する

- [ ] **Step 6: コミット**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: 学校組織作成・招待管理画面をルーティングに統合し、参加待ちバナーを教材一覧画面に表示"
```
