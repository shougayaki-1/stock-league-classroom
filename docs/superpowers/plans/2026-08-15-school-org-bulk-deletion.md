# 学校組織の一括削除(§21.3 優先順位1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学校組織(school org、複数メンバー)のownerが組織全体を完全削除できるようにする。個人組織には既に`purgePersonalOrganizationCallable`が存在するが、学校組織には対応する削除経路が一切ない。

**Architecture:** 既存の`runDeletionSaga`(`functions/src/privacy/deletionSaga.ts`)をそのまま再利用し、`purgePersonalOrganizationWithAdminSdk`(`functions/src/privacy/deletePersonalData.ts`)と並ぶ新関数`purgeSchoolOrgWithAdminSdk`を同じファイルに追加する。個人組織版との違いは3点: (1) `users/{uid}`を削除しない(学校組織のメンバーは他組織にも所属しうる個人アカウント)、(2) RTDBの`orgAccess`/`orgAccessMeta`ミラーを**全メンバー分**null化する(個人組織は常に1メンバー)、(3) 削除前に組織階層の整合性ガード(上位組織にリンク済み・学校を配下に持つ)を追加でチェックする。監査ログは削除対象の組織自身の下ではなく、新設のトップレベルコレクション`orgDeletionAuditLog/{logId}`に記録する(理由はTask 2参照)。

**Tech Stack:** Firebase Cloud Functions (TypeScript, `onCall` v2)、Firestore Admin SDK (`recursiveDelete`)、Realtime Database Admin SDK、React + Vitest + Testing Library。

## Global Constraints

- **この機能は最も破壊的な操作である。** 復元期間なし(spec §21.3優先順位1)。実装中は既存の`purgePersonalOrganizationWithAdminSdk`・`purgePersonalOrganizationCallable`(`functions/src/privacy/deletePersonalData.ts`・`functions/src/privacy/onCall.ts`)を必ず読み、そのコメントに書かれている設計判断(冪等性、グループの実行順序、`organizations/{orgId}`を最後に消す理由)を理解してから実装すること。
- **削除対象は学校組織(`type === 'school'`)のみ。** 個人組織(`type === 'personal'`)は既存の`purgePersonalOrganizationCallable`を使う。新しいCallableで個人組織を渡された場合は`invalid-argument`で拒否する。
- **削除前提条件(いずれかに該当したら`failed-precondition`で拒否):**
  - この組織が上位組織にリンク済み(`organizations/{orgId}.parentOrgId`が非null) — 先に`unlinkSchoolFromParentOrgCallable`で解除させる。
  - この組織が上位組織として学校を1つ以上配下に持つ(`organizations/{orgId}/schoolAllocations`サブコレクションが空でない)。
- **認可: 組織のactiveなownerロールメンバーのみ。** `requireActiveOrgMember`(既存、`../organizations/authorization`)を使い、`role !== 'owner'`なら`permission-denied`。
- **確認・再認証: `exportOrgStudentDataCallable`/`purgePersonalOrganizationCallable`と同じ水準。** `isReauthFresh`(既存、`./onCall.ts`)、`confirm: true`、`confirmOrgId`(削除対象orgIdの再入力、`purgePersonalOrganizationCallable`の`confirmUid`と同じ役割)、`idempotencyKey`を必須にする。
- **監査ログは組織自身のサブコレクションに書かない。** `recordAuditLogEntry`(`functions/src/privacy/auditLog.ts`)は`organizations/{orgId}/auditLog`に書くため、この組織を削除すると監査証跡自体も一緒に消えてしまう。spec §21.6は監査ログの不変性を要求しているため、これは受け入れられない。代わりに新設のトップレベルコレクション`orgDeletionAuditLog/{logId}`に記録する専用ヘルパー`recordOrgDeletionAuditLogEntry`を`functions/src/privacy/auditLog.ts`に追加する。
- **明示的にスコープ外とする項目(コード中にコメントで明記すること):**
  - Stripeサブスクリプションの解約 — 既存のStripe連携コードとの整合は別スコープ。
  - COMMUNITY公開済みテンプレートの取り扱い(公開停止するか等) — 別スコープ。
  - `users/{uid}`ドキュメントの削除 — 上記の通り意図的に対象外。
- 命名・コーディングスタイルは`functions/src/privacy/deletePersonalData.ts`・`functions/src/privacy/onCall.ts`の既存コードに厳密に合わせる。

---

### Task 1: `purgeSchoolOrgWithAdminSdk`(削除ロジック本体)

**Files:**
- Modify: `functions/src/privacy/deletePersonalData.ts`(末尾に追加)
- Modify: `functions/src/privacy/deletePersonalDataAdminSdk.test.ts`

**Interfaces:**
- Consumes: `runDeletionSaga`・`DeletionSagaGroup`(既存、`./deletionSaga`)、`adminSagaStore`(同ファイル内の既存プライベート関数)
- Produces: `export const purgeSchoolOrgWithAdminSdk = async (input: { uid: string; orgId: string; idempotencyKey: string }): ReturnType<typeof runDeletionSaga<SchoolOrgEnumeration>>` — Task 2のCallableがこれを呼び出す。

- [x] **Step 1: 失敗するテストを書く**

まず `functions/src/privacy/deletePersonalDataAdminSdk.test.ts` を読み、`purgePersonalOrganizationWithAdminSdk`のテストが`collectionResults`(Map、コレクション名→idの配列)と`recursiveDeleteMock`・`rtdbUpdateMock`をどう使っているかを確認する。ファイル冒頭の`vi.mock('firebase-admin/firestore', ...)`では`db.collection(name).where().get()`しかモックされていない。学校組織版は`organizations/{orgId}/members`サブコレクションを`where`なしで全件取得する必要があるため、モックを以下のように拡張する必要がある(ファイル冒頭のモック定義を書き換える):

```typescript
const collectionResults = new Map<string, string[]>()
const subcollectionResults = new Map<string, string[]>() // key: full path e.g. "organizations/school-1/members"

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: (path: string) => ({
      path,
      get: async () => ({ exists: operationDocs.has(path), data: () => operationDocs.get(path) }),
      set: async (data: Record<string, unknown>) => { operationDocs.set(path, data) },
    }),
    recursiveDelete: (ref: { path: string }) => recursiveDeleteMock(ref),
    collection: (name: string) => ({
      where: () => ({
        get: async () => ({ docs: (collectionResults.get(name) ?? []).map((id) => ({ id })) }),
      }),
      get: async () => ({ docs: (subcollectionResults.get(name) ?? []).map((id) => ({ id })) }),
    }),
  }),
  FieldValue: { delete: () => 'FIELD_DELETE_SENTINEL' },
}))
```

`beforeEach`の`collectionResults.clear()`の直後に`subcollectionResults.clear()`を追加する。

`describe('purgePersonalOrganizationWithAdminSdk', ...)`ブロックの直後に新規`describe`を追加:

```typescript
describe('purgeSchoolOrgWithAdminSdk', () => {
  it('recursively deletes every enumerated template/run, does NOT touch users/{uid}, deletes organizations/{orgId} LAST, and nulls RTDB mirrors for every member', async () => {
    collectionResults.set('lessonTemplates', ['t1'])
    collectionResults.set('lessonRuns', ['r1'])
    subcollectionResults.set('organizations/school-1/members', ['owner-a', 'teacher-b'])

    const result = await purgeSchoolOrgWithAdminSdk({
      uid: 'owner-a',
      orgId: 'school-1',
      idempotencyKey: 'school-key-1',
    })

    expect(result.completed).toBe(true)

    const deletedPaths = recursiveDeleteMock.mock.calls.map((call) => call[0].path)
    expect(deletedPaths).toEqual([
      'lessonTemplates/t1',
      'lessonRuns/r1',
      'organizations/school-1',
    ])
    expect(deletedPaths).not.toContain('users/owner-a')
    expect(deletedPaths).not.toContain('users/teacher-b')
    expect(deletedPaths.at(-1)).toBe('organizations/school-1')

    expect(rtdbUpdateMock).toHaveBeenCalledWith({
      'orgAccess/school-1/owner-a': null,
      'orgAccessMeta/school-1/owner-a': null,
      'orgAccess/school-1/teacher-b': null,
      'orgAccessMeta/school-1/teacher-b': null,
    })
    expect(rtdbUpdateMock).toHaveBeenCalledWith({
      'lessonRunPublic/r1': null,
      'lessonRunPrivate/r1': null,
    })
  })

  it('is idempotent: a second call with the same idempotencyKey does not re-run any group', async () => {
    collectionResults.set('lessonTemplates', [])
    collectionResults.set('lessonRuns', [])
    subcollectionResults.set('organizations/school-2/members', ['owner-c'])

    await purgeSchoolOrgWithAdminSdk({ uid: 'owner-c', orgId: 'school-2', idempotencyKey: 'school-key-2' })
    recursiveDeleteMock.mockClear()
    rtdbUpdateMock.mockClear()

    const second = await purgeSchoolOrgWithAdminSdk({ uid: 'owner-c', orgId: 'school-2', idempotencyKey: 'school-key-2' })

    expect(second.alreadyCompleted).toBe(true)
    expect(recursiveDeleteMock).not.toHaveBeenCalled()
    expect(rtdbUpdateMock).not.toHaveBeenCalled()
  })
})
```

ファイル冒頭のimportに`purgeSchoolOrgWithAdminSdk`を追加する。

- [x] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/privacy/deletePersonalDataAdminSdk.test.ts -t "purgeSchoolOrgWithAdminSdk"`
Expected: FAIL(`purgeSchoolOrgWithAdminSdk`が存在しない)

- [x] **Step 3: 実装する**

`functions/src/privacy/deletePersonalData.ts`の末尾(`purgePersonalOrganizationWithAdminSdk`の後)に追加:

```typescript
interface SchoolOrgEnumeration {
  templateIds: string[]
  runIds: string[]
  memberUids: string[]
}

/**
 * Whole school-org hard delete (spec §21.3 priority 1), for multi-member
 * school organizations. Deliberately differs from
 * purgePersonalOrganizationWithAdminSdk in two ways:
 *
 *  - users/{uid} is NEVER deleted here — a school-org member's account may
 *    belong to other organizations (their own personal org, other schools),
 *    unlike a personal org's single owner.
 *  - Every active member's RTDB orgAccess/orgAccessMeta mirror is nulled,
 *    not just one uid's.
 *
 * Group ordering follows the same re-authorization reasoning as the
 * personal-org purge: `organizations/{orgId}` (re-read by the Callable on
 * every retry to verify the caller is still an active owner) is deleted
 * LAST.
 *
 * Deliberately out of scope (see plan's Global Constraints): Stripe
 * subscription cancellation, COMMUNITY-published template handling.
 */
export const purgeSchoolOrgWithAdminSdk = async (input: {
  uid: string
  orgId: string
  idempotencyKey: string
}): ReturnType<typeof runDeletionSaga<SchoolOrgEnumeration>> => {
  const db = getFirestore()
  const rtdb = getDatabase()
  const { uid, orgId } = input

  const enumerate = async (): Promise<SchoolOrgEnumeration> => {
    const [templatesSnap, runsSnap, membersSnap] = await Promise.all([
      db.collection('lessonTemplates').where('orgId', '==', orgId).get(),
      db.collection('lessonRuns').where('orgId', '==', orgId).get(),
      db.collection(`organizations/${orgId}/members`).get(),
    ])
    return {
      templateIds: templatesSnap.docs.map((doc) => doc.id),
      runIds: runsSnap.docs.map((doc) => doc.id),
      memberUids: membersSnap.docs.map((doc) => doc.id),
    }
  }

  const buildGroups = (enumeration: SchoolOrgEnumeration): DeletionSagaGroup[] => [
    {
      name: 'lessonTemplates',
      run: async () => { await Promise.all(enumeration.templateIds.map((id) => db.recursiveDelete(db.doc(`lessonTemplates/${id}`)))) },
    },
    {
      name: 'lessonRuns',
      run: async () => { await Promise.all(enumeration.runIds.map((id) => db.recursiveDelete(db.doc(`lessonRuns/${id}`)))) },
    },
    {
      name: 'rtdbOrgAccess',
      run: async () => {
        const updates: Record<string, null> = {}
        for (const memberUid of enumeration.memberUids) {
          updates[`orgAccess/${orgId}/${memberUid}`] = null
          updates[`orgAccessMeta/${orgId}/${memberUid}`] = null
        }
        if (Object.keys(updates).length > 0) await rtdb.ref().update(updates)
      },
    },
    {
      name: 'rtdbLessonRuns',
      run: async () => {
        if (enumeration.runIds.length === 0) return
        const updates: Record<string, null> = {}
        for (const id of enumeration.runIds) {
          updates[`lessonRunPublic/${id}`] = null
          updates[`lessonRunPrivate/${id}`] = null
        }
        await rtdb.ref().update(updates)
      },
    },
    {
      name: 'organization',
      run: async () => { await db.recursiveDelete(db.doc(`organizations/${orgId}`)) },
    },
  ]

  return runDeletionSaga<SchoolOrgEnumeration>({
    store: adminSagaStore(),
    uid,
    orgId,
    operationKind: 'SCHOOL_ORG_PURGE',
    target: orgId,
    confirmedIdentifier: orgId,
    idempotencyKey: input.idempotencyKey,
    enumerate,
    buildGroups,
  })
}
```

このコードは`adminSagaStore`・`getFirestore`・`getDatabase`・`runDeletionSaga`・`DeletionSagaGroup`をこのファイルの既存importからそのまま使う(新しいimportは不要なはず。既存のimport文を確認し、不足があれば追加する)。

- [x] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/privacy/deletePersonalDataAdminSdk.test.ts`
Expected: PASS(既存テスト全件 + 新規2件)

- [x] **Step 5: 型チェックを実行する**

Run: `cd functions && npx tsc --noEmit -p .`
Expected: エラーなし

- [x] **Step 6: コミット**

```bash
git add functions/src/privacy/deletePersonalData.ts functions/src/privacy/deletePersonalDataAdminSdk.test.ts
git commit -m "feat: 学校組織を一括削除するpurgeSchoolOrgWithAdminSdkを追加する"
```

---

### Task 2: 削除専用の監査ログヘルパーと`purgeSchoolOrgCallable`

**Files:**
- Modify: `functions/src/privacy/auditLog.ts`
- Modify: `functions/src/privacy/auditLog.test.ts`
- Modify: `firestore.rules`
- Modify: `test/firestore.rules.test.ts`
- Modify: `functions/src/privacy/onCall.ts`
- Modify: `functions/src/privacy/onCall.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: `purgeSchoolOrgWithAdminSdk`(Task 1)、`requireActiveOrgMember`(既存)、`isReauthFresh`(既存、同ファイル内)
- Produces: `export const recordOrgDeletionAuditLogEntry`(`./auditLog`)、`export const purgeSchoolOrgCallable`(Callable名`'purgeSchoolOrgCallable'`) — Task 3のクライアントlibがこの名前を呼び出す。

- [x] **Step 1a: 削除専用監査ログのテストを書く**

まず`functions/src/privacy/auditLog.ts`を読み、既存の`recordAuditLogEntry`・`AuditLogEntryInput`を確認する。`functions/src/privacy/auditLog.test.ts`の末尾に以下を追加:

```typescript
describe('recordOrgDeletionAuditLogEntry', () => {
  it('writes to the top-level orgDeletionAuditLog collection (NOT under organizations/{orgId}, which is about to be deleted)', async () => {
    addMock.mockResolvedValueOnce({ id: 'log-1' })
    const db = makeDb()
    await recordOrgDeletionAuditLogEntry(db, { orgId: 'school-1', actorUid: 'owner-a', result: 'SUCCESS' })
    expect(collectionPathSpy).toHaveBeenCalledWith('orgDeletionAuditLog')
    expect(addMock).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'school-1', actorUid: 'owner-a', result: 'SUCCESS', occurredAt: 'SERVER_TIMESTAMP' }))
  })
})
```

このテストは`makeDb()`の`collection`呼び出しの引数(コレクションパス)を検証する必要があるため、既存の`makeDb`定義を以下のように拡張する(ファイル冒頭の`makeDb`を書き換える):

```typescript
const addMock = vi.fn()
const collectionPathSpy = vi.fn()
const makeDb = () => ({ collection: (path: string) => { collectionPathSpy(path); return { add: addMock } } }) as unknown as FirebaseFirestore.Firestore
```

(既存の`recordAuditLogEntry`のテストは`organizations/${orgId}/auditLog`という動的パスを検証していないため、この変更で既存テストが壊れないことを確認すること。壊れる場合は既存テストの該当箇所に`collectionPathSpy`の期待値を追記する。)

- [x] **Step 1b: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/privacy/auditLog.test.ts -t "recordOrgDeletionAuditLogEntry"`
Expected: FAIL(`recordOrgDeletionAuditLogEntry`が存在しない)

- [x] **Step 1c: 実装する**

`functions/src/privacy/auditLog.ts`の末尾に追加:

```typescript
export interface OrgDeletionAuditLogEntryInput {
  orgId: string
  actorUid: string
  result: 'SUCCESS' | 'FAILURE'
  reason?: string
}

/**
 * organizations/{orgId}/auditLog とは別の、トップレベルの
 * orgDeletionAuditLog コレクションに記録する。理由: 組織削除そのものを
 * 記録する監査ログを削除対象の組織のサブコレクションに置くと、組織を
 * 削除した瞬間に監査証跡ごと消えてしまい、spec §21.6の「監査ログは
 * 改変不可」という要件を満たせない。
 */
export const recordOrgDeletionAuditLogEntry = async (db: FirebaseFirestore.Firestore, entry: OrgDeletionAuditLogEntryInput): Promise<void> => {
  const doc: Record<string, unknown> = { orgId: entry.orgId, actorUid: entry.actorUid, result: entry.result, occurredAt: FieldValue.serverTimestamp() }
  if (entry.reason !== undefined) doc.reason = entry.reason
  await db.collection('orgDeletionAuditLog').add(doc)
}
```

- [x] **Step 1d: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/privacy/auditLog.test.ts`
Expected: PASS(既存テスト全件 + 新規1件)

- [x] **Step 2a: Firestoreルールを追加する**

`firestore.rules`の`match /aiBetaAccess/{uid} { ... }`ブロックの直後(または`organizations/{orgId}/auditLog`ルールの近く)に追記:

```
    // 組織削除の監査ログ。actorUid本人または運営者のみ閲覧可能。
    // 書き込みはrecordOrgDeletionAuditLogEntry(Admin SDK)経由のみ。
    match /orgDeletionAuditLog/{logId} {
      allow read: if request.auth != null &&
        (resource.data.actorUid == request.auth.uid || (request.auth.token.email_verified == true && request.auth.token.firebase.sign_in_provider == 'google.com' && request.auth.token.operator == true));
      allow write: if false;
    }
```

(このリポジトリの`firestore.rules`に既にoperator判定用のヘルパー関数(例えば`operator()`)が定義されていれば、上記のインライン条件の代わりにそれを使うこと。ファイル冒頭を確認してから書くこと。)

- [x] **Step 2b: ルールテストを追加する**

`test/firestore.rules.test.ts`の`describe('aiBetaAccess/{uid}', ...)`ブロックの直後に追記:

```typescript
describe('orgDeletionAuditLog/{logId}', () => {
  it('lets the actor and an operator read an entry, but denies everyone else and all client writes', async () => {
    await environment.withSecurityRulesDisabled(async (context) =>
      setDoc(doc(context.firestore(), 'orgDeletionAuditLog/log-1'), { orgId: 'school-1', actorUid: 'owner-a', result: 'SUCCESS' }),
    )
    const actor = environment.authenticatedContext('owner-a', teacherToken)
    const operator = environment.authenticatedContext('operator-a', operatorToken)
    const other = environment.authenticatedContext('teacher-b', teacherToken)
    await assertSucceeds(getDoc(doc(actor.firestore(), 'orgDeletionAuditLog/log-1')))
    await assertSucceeds(getDoc(doc(operator.firestore(), 'orgDeletionAuditLog/log-1')))
    await assertFails(getDoc(doc(other.firestore(), 'orgDeletionAuditLog/log-1')))
    await assertFails(setDoc(doc(actor.firestore(), 'orgDeletionAuditLog/log-2'), { orgId: 'school-1', actorUid: 'owner-a', result: 'SUCCESS' }))
  })
})
```

- [x] **Step 2c: ルールテストを実行して通ることを確認する**

Run: `cd /Users/shoug/Documents/GitHub/stock-league-classroom && npm run test:rules`
Expected: 全テストPASS(既存件数 + 新規1件)

- [x] **Step 3a: `purgeSchoolOrgCallable`の失敗するテストを書く**

まず`functions/src/privacy/onCall.ts`と`onCall.test.ts`を読み、`purgePersonalOrganizationCallable`の実装とそのテストの書き方(特に`orgDocGetMock`・`requireActiveOrgMember`のモック方法)を確認する。`functions/src/privacy/onCall.test.ts`の末尾に以下を追加する(モックの詳細は既存コードに合わせて調整すること):

```typescript
describe('purgeSchoolOrgCallable', () => {
  beforeEach(() => { vi.clearAllMocks() })

  const validRequest = (overrides: Record<string, unknown> = {}) => makeRequest({
    uid: 'owner-a', authTime: NOW_SECONDS,
    data: { orgId: 'school-1', confirm: true, confirmOrgId: 'school-1', idempotencyKey: 'key-1', ...overrides },
  })

  it('rejects when confirmOrgId does not match orgId', async () => {
    await expect(purgeSchoolOrgCallable.run(validRequest({ confirmOrgId: 'wrong-id' }))).rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it('rejects a stale sign-in', async () => {
    await expect(purgeSchoolOrgCallable.run(makeRequest({ uid: 'owner-a', authTime: NOW_SECONDS - 3600, data: { orgId: 'school-1', confirm: true, confirmOrgId: 'school-1', idempotencyKey: 'key-1' } })))
      .rejects.toMatchObject({ code: 'failed-precondition' })
  })

  it('rejects a personal org', async () => {
    orgDocGetMock.mockResolvedValueOnce({ exists: true, get: (field: string) => (field === 'type' ? 'personal' : undefined) })
    await expect(purgeSchoolOrgCallable.run(validRequest())).rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it('rejects an org still linked to a parent org', async () => {
    orgDocGetMock.mockResolvedValueOnce({ exists: true, get: (field: string) => (field === 'type' ? 'school' : field === 'parentOrgId' ? 'parent-1' : undefined) })
    await expect(purgeSchoolOrgCallable.run(validRequest())).rejects.toMatchObject({ code: 'failed-precondition' })
  })

  it('rejects a non-owner', async () => {
    orgDocGetMock.mockResolvedValueOnce({ exists: true, get: (field: string) => (field === 'type' ? 'school' : undefined) })
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'admin', membershipVersion: 1 })
    await expect(purgeSchoolOrgCallable.run(validRequest())).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('purges the org and records a SUCCESS deletion audit log entry for a valid owner request', async () => {
    orgDocGetMock.mockResolvedValueOnce({ exists: true, get: (field: string) => (field === 'type' ? 'school' : undefined) })
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    vi.mocked(purgeSchoolOrgWithAdminSdk).mockResolvedValueOnce({ operationId: 'op-1', completed: true, alreadyCompleted: false })
    await purgeSchoolOrgCallable.run(validRequest())
    expect(recordOrgDeletionAuditLogEntry).toHaveBeenCalledWith(expect.anything(), { orgId: 'school-1', actorUid: 'owner-a', result: 'SUCCESS' })
  })
})
```

ファイル冒頭のimportに`purgeSchoolOrgCallable`を追加し、`vi.mock('./deletePersonalData', ...)`に`purgeSchoolOrgWithAdminSdk: vi.fn()`を、`vi.mock('./auditLog', ...)`(既にあれば)に`recordOrgDeletionAuditLogEntry: vi.fn()`を追加する。`vi.mock('./deletePersonalData', ...)`が既にこのファイルに存在するかどうかを先に確認すること(Task1で追加した関数と同じモジュールなので、既存のモックに1行追加するだけのはず)。

`getSchoolAllocations`(組織が学校を配下に持つかのチェック)用に、`getFirestore`モックの`collection`が`organizations/{orgId}/schoolAllocations`パスに対して空配列を返すデフォルト動作になっているか確認し、必要なら`orgDocGetMock`とは別に軽量なモックを追加する(このファイルの既存の`getFirestore`モック構造を見てから、最小限の拡張で対応すること)。

- [x] **Step 3b: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/privacy/onCall.test.ts -t "purgeSchoolOrgCallable"`
Expected: FAIL(`purgeSchoolOrgCallable`が存在しない)

- [x] **Step 3c: 実装する**

`functions/src/privacy/onCall.ts`の末尾に追加:

```typescript
interface PurgeSchoolOrgRequest { orgId?: unknown; confirm?: unknown; confirmOrgId?: unknown; idempotencyKey?: unknown }

/**
 * Whole school-org deletion (spec §21.3 priority 1). Sibling to
 * purgePersonalOrganizationCallable, but for multi-member school orgs:
 * authorization is "active owner-role member" (requireActiveOrgMember),
 * not a single ownerUid field, and confirmOrgId (not confirmUid) guards
 * against a caller accidentally deleting the wrong org.
 *
 * Deliberately out of scope: Stripe subscription cancellation,
 * COMMUNITY-published template handling (see plan's Global Constraints).
 */
export const purgeSchoolOrgCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isReauthFresh(request.auth.token.auth_time as number | undefined, Date.now())) {
    throw new HttpsError('failed-precondition', 'セキュリティのため、再度サインインしてからお試しください。')
  }
  const data = request.data as PurgeSchoolOrgRequest
  if (typeof data.orgId !== 'string' || data.confirm !== true || typeof data.confirmOrgId !== 'string' || typeof data.idempotencyKey !== 'string') {
    throw new HttpsError('invalid-argument', 'orgId、confirm、confirmOrgId、idempotencyKey は必須です。')
  }
  if (data.confirmOrgId !== data.orgId) throw new HttpsError('invalid-argument', 'confirmOrgId が orgId と一致しません。')

  const db = getFirestore()
  const orgId = data.orgId
  const actorUid = request.auth.uid

  const orgSnap = await db.doc(`organizations/${orgId}`).get()
  if (!orgSnap.exists || orgSnap.get('type') !== 'school') {
    throw new HttpsError('invalid-argument', '学校組織のみ削除できます(個人組織は purgePersonalOrganizationCallable を使用してください)。')
  }
  if (orgSnap.get('parentOrgId')) {
    throw new HttpsError('failed-precondition', '上位組織にリンクされたままでは削除できません。先に連携を解除してください。')
  }
  const allocationsSnap = await db.collection(`organizations/${orgId}/schoolAllocations`).limit(1).get()
  if (!allocationsSnap.empty) {
    throw new HttpsError('failed-precondition', 'この組織は配下に学校を持つため削除できません。先にすべての学校の連携を解除してください。')
  }

  const membership = await requireActiveOrgMember(db, orgId, actorUid)
  if (membership.role !== 'owner') {
    throw new HttpsError('permission-denied', '組織のownerのみ組織全体を削除できます。')
  }

  try {
    await purgeSchoolOrgWithAdminSdk({ uid: actorUid, orgId, idempotencyKey: data.idempotencyKey })
  } catch (error) {
    await recordOrgDeletionAuditLogEntry(db, { orgId, actorUid, result: 'FAILURE' })
    throw translateIdempotencyMismatchError(error)
  }
  await recordOrgDeletionAuditLogEntry(db, { orgId, actorUid, result: 'SUCCESS' })
})
```

ファイル冒頭のimportに`purgeSchoolOrgWithAdminSdk`(`./deletePersonalData`から)と`recordOrgDeletionAuditLogEntry`(`./auditLog`から)を追加する。`functions/src/index.ts`の`exportOrgStudentDataCallable`等がexportされている行(`./privacy/onCall`からのexport文)に`purgeSchoolOrgCallable`も追加する。

- [x] **Step 3d: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/privacy/onCall.test.ts`
Expected: PASS(既存テスト全件 + 新規6件)

- [x] **Step 4: 全functionsテストと型チェックを実行する**

Run: `cd functions && npx vitest run && npx tsc --noEmit -p .`
Expected: 全件PASS、型エラーなし

- [x] **Step 5: コミット**

```bash
git add functions/src/privacy/auditLog.ts functions/src/privacy/auditLog.test.ts firestore.rules test/firestore.rules.test.ts functions/src/privacy/onCall.ts functions/src/privacy/onCall.test.ts functions/src/index.ts
git commit -m "feat: 学校組織を一括削除するpurgeSchoolOrgCallableを追加する"
```

---

### Task 3: クライアントlibと組織設定画面の削除確認UI

**Files:**
- Create: `src/lib/privacy/purgeSchoolOrg.ts`
- Create: `src/lib/privacy/purgeSchoolOrg.test.ts`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: Callable名`'purgeSchoolOrgCallable'`(Task 2が定義)
- Produces: `SchoolOrgSettingsPage`の新規props`purgingOrg: boolean`・`onPurgeOrg: () => void`(このタスク内で閉じる)

- [x] **Step 1: 失敗するテストを書く**

`src/lib/privacy/purgeSchoolOrg.ts`用のテストを新規作成(`src/lib/privacy/orgAuditLog.ts`のテストと同じ形):

```typescript
import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { purgeSchoolOrg } from './purgeSchoolOrg'

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

describe('purgeSchoolOrg', () => {
  it('calls purgeSchoolOrgCallable with orgId, confirm, confirmOrgId, and a generated idempotencyKey', async () => {
    const callable = vi.fn().mockResolvedValue({ data: undefined })
    vi.mocked(httpsCallable).mockReturnValue(callable as never)
    await purgeSchoolOrg({} as never, { orgId: 'school-1' }, () => 'fixed-key')
    expect(httpsCallable).toHaveBeenCalledWith({}, 'purgeSchoolOrgCallable')
    expect(callable).toHaveBeenCalledWith({ orgId: 'school-1', confirm: true, confirmOrgId: 'school-1', idempotencyKey: 'fixed-key' })
  })
})
```

- [x] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/lib/privacy/purgeSchoolOrg.test.ts`
Expected: FAIL(`./purgeSchoolOrg`が存在しない)

- [x] **Step 3: 実装する**

`src/lib/privacy/purgeSchoolOrg.ts`を新規作成:

```typescript
import { httpsCallable, type Functions } from 'firebase/functions'

export interface PurgeSchoolOrgInput { orgId: string }

export const purgeSchoolOrg = async (
  functions: Functions,
  input: PurgeSchoolOrgInput,
  generateIdempotencyKey: () => string = () => crypto.randomUUID(),
): Promise<void> => {
  await httpsCallable<Record<string, unknown>, void>(functions, 'purgeSchoolOrgCallable')({
    orgId: input.orgId, confirm: true, confirmOrgId: input.orgId, idempotencyKey: generateIdempotencyKey(),
  })
}
```

- [x] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/lib/privacy/purgeSchoolOrg.test.ts`
Expected: PASS

- [x] **Step 5: `SchoolOrgSettingsPage`に「型して確認」の削除UIを追加する**

`src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`を読み、owner限定セクション(保持期間ポリシーのセクションがあればその直後)に以下のpropsを追加する:

```typescript
purgingOrg: boolean
onPurgeOrg: () => void
```

owner限定(`isOwner`、既存の判定式を使う)で、組織名またはorgIdを入力しないと削除ボタンが有効化されない確認UIを追加する:

```tsx
{isOwner && (
  <section>
    <h3>組織の完全削除</h3>
    <p>この操作は取り消せません。組織のすべてのデータ(授業・教材・メンバー)が完全に削除されます。</p>
    <ConfirmDeleteOrgForm orgId={orgId} purging={purgingOrg} onConfirm={onPurgeOrg} />
  </section>
)}
```

`ConfirmDeleteOrgForm`は同じファイル内に小さな内部コンポーネントとして定義する(入力値が`orgId`と完全一致した時だけボタンを有効化する):

```tsx
function ConfirmDeleteOrgForm({ orgId, purging, onConfirm }: { orgId: string; purging: boolean; onConfirm: () => void }) {
  const [typed, setTyped] = useState('')
  return (
    <div>
      <label>
        確認のため組織ID({orgId})を入力してください
        <input value={typed} onChange={(event) => setTyped(event.target.value)} disabled={purging} />
      </label>
      <button type="button" disabled={typed !== orgId || purging} onClick={onConfirm}>
        {purging ? '削除中…' : '完全に削除する'}
      </button>
    </div>
  )
}
```

`useState`がこのファイルで既にimportされていなければ`react`からimportを追加する。既存コンポーネントのJSX構造(見出しレベル)に厳密に合わせること。

- [x] **Step 6: コンポーネントテストを追加する**

`SchoolOrgSettingsPage.test.tsx`の`memberProps`に以下を追加:

```typescript
purgingOrg: false,
onPurgeOrg: vi.fn(),
```

新規テストを追加:

```typescript
it('only enables the delete button once the owner types the exact orgId', () => {
  const onPurgeOrg = vi.fn()
  render(
    <MemoryRouter>
      <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false} {...memberProps} viewerUid="uid-owner" members={members} onPurgeOrg={onPurgeOrg} />
    </MemoryRouter>,
  )
  const deleteButton = screen.getByRole('button', { name: '完全に削除する' })
  expect(deleteButton).toBeDisabled()
  fireEvent.change(screen.getByLabelText(/組織IDを入力/), { target: { value: 'wrong-id' } })
  expect(deleteButton).toBeDisabled()
  fireEvent.change(screen.getByLabelText(/組織IDを入力/), { target: { value: 'org-1' } })
  expect(deleteButton).toBeEnabled()
  fireEvent.click(deleteButton)
  expect(onPurgeOrg).toHaveBeenCalled()
})

it('hides the delete-org section from a non-owner', () => {
  render(
    <MemoryRouter>
      <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false} {...memberProps} viewerUid="uid-teacher" members={members} />
    </MemoryRouter>,
  )
  expect(screen.queryByText('組織の完全削除')).not.toBeInTheDocument()
})
```

- [x] **Step 7: テストを実行する**

Run: `npx vitest run src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`
Expected: PASS(既存テスト全件 + 新規2件)

- [x] **Step 8: `App.tsx`の`SchoolOrgSettingsRoute`に配線する**

`SchoolOrgSettingsRoute`内、他のハンドラの近くに以下を追加する:

```typescript
const [purgingOrg, setPurgingOrg] = useState(false)
const navigate = useNavigate() // 既にimport/使用されていなければ react-router-dom から追加する

const onPurgeOrg = () => {
  if (!orgId) return
  setPurgingOrg(true)
  void purgeSchoolOrg(services.functions, { orgId })
    .then(() => navigate('/teacher'))
    .finally(() => setPurgingOrg(false))
}
```

`useNavigate`が既にこのファイルの他の箇所でimportされていれば、そのimportをそのまま使う(二重importにしない)。削除成功後の遷移先(`/teacher`)は、このファイル内で他に使われているトップレベルの教師用ルートパスに合わせること(異なる場合はそちらに合わせる)。

`<SchoolOrgSettingsPage ...>`のJSXに`purgingOrg={purgingOrg} onPurgeOrg={onPurgeOrg}`を追加する。

ファイル冒頭のimportに追加:

```typescript
import { purgeSchoolOrg } from './lib/privacy/purgeSchoolOrg'
```

- [x] **Step 9: 全体テストと型チェックを実行する**

Run: `npx vitest run && npx tsc -b`
Expected: 全件PASS、型エラーなし

- [x] **Step 10: コミット**

```bash
git add src/lib/privacy/purgeSchoolOrg.ts src/lib/privacy/purgeSchoolOrg.test.ts src/components/teacher/organizations/SchoolOrgSettingsPage.tsx src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx src/App.tsx
git commit -m "feat: 組織設定画面に学校組織の完全削除UI(型して確認)を追加する"
```

---

### Task 4: scope-backlog.mdの更新

**Files:**
- Modify: `docs/superpowers/scope-backlog.md`

**Interfaces:**
- Consumes: なし
- Produces: なし(ドキュメントのみの変更)

- [x] **Step 1: Phase 7の該当行を更新する**

`docs/superpowers/scope-backlog.md`の「未着手項目(生徒データの組織単位の統制、残り○項目)」から「組織全体の一括削除」の行を削除し、既存の「実装済み(2026-08-15)」リストに追記する:

```
- 組織全体の一括削除 — `purgeSchoolOrgCallable`(owner限定、上位組織リンク・配下学校の有無を事前チェック)。監査ログは組織削除後も残るよう`orgDeletionAuditLog`(トップレベル)に記録。Stripeサブスクリプション解約・COMMUNITY公開テンプレートの取り扱いは別スコープのまま。
```

- [x] **Step 2: コミット**

```bash
git add docs/superpowers/scope-backlog.md
git commit -m "docs: 学校組織一括削除の実装をscope-backlogに反映する"
```
