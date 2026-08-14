# 共有リンクv2(templateShares) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** テンプレート作成者が失効可能な共有リンク(トークン)を発行し、組織外の教師がそのリンク経由でテンプレートの特定版を閲覧・自組織へ複製できるようにする。

**Architecture:** `functions/src/lessonTemplates/templateShares.ts`に、`displaySession.ts`/`recovery.ts`と同じ「ランダムトークン生成→SHA-256ハッシュのみ永続化」パターンで`createTemplateShare`/`resolveTemplateShare`/`revokeTemplateShares`を実装する。3つの新規Callable(`createTemplateShareCallable`/`resolveTemplateShareCallable`/`revokeTemplateShareCallable`)を追加し、既存の`duplicateLessonTemplateCallable`に`shareToken`分岐を1つ追加する(認可判断はCallable層で完結させ、`duplicateLessonTemplate.ts`本体は変更しない)。

**Tech Stack:** Firebase Cloud Functions (TypeScript, `firebase-admin/firestore`, `node:crypto`)、Vitest。

## Global Constraints

- 正本: `docs/superpowers/specs/2026-08-15-template-share-links-v2-design.md`。矛盾があれば正本を優先する。
- 許可範囲は「閲覧+自組織への複製」のみ(編集・再共有・組織内メンバー招待は対象外)。
- 共有作成・失効はテンプレートの`createdByUid`本人のみ(組織メンバー全体には広げない)。
- 共有単位は特定の公開版(`versionId`固定)。
- トークンは`node:crypto`の`randomBytes(32)`で生成し、平文はレスポンスで一度だけ返す。永続化は常にSHA-256ハッシュのみ。
- `expiresInDays`は1〜90の整数。範囲外は`invalid-argument`。
- 無効・失効・期限切れトークンでの閲覧・複製は`not-found`。有効なトークンだが対象(templateId/versionId)が食い違う場合は`permission-denied`。
- `templateShares`コレクションはクライアントからの直接読み書きを一切許可しない(すべてCallable経由)。

---

### Task 1: `templateShares.ts`の純粋ロジックを実装する

**Files:**
- Create: `functions/src/lessonTemplates/templateShares.ts`
- Test: `functions/src/lessonTemplates/templateShares.test.ts`

**Interfaces:**
- Produces:
  - `generateTemplateShareToken(): string`
  - `sha256Hex(value: string): string`
  - `interface TemplateShareFirestoreDeps { firestore: { runTransaction: <T>(fn: (tx: TemplateShareTx) => Promise<T>) => Promise<T> }; hashToken: (token: string) => string; now?: () => unknown; nowMillis?: () => number }`
  - `createTemplateShare(deps: TemplateShareFirestoreDeps & { generateToken: () => string }, input: { templateId: string; versionId: string; sourceOrgId: string; createdByUid: string; expiresInDays: number }): Promise<{ token: string }>`
  - `resolveTemplateShare(deps: TemplateShareFirestoreDeps, input: { token: string }): Promise<{ templateId: string; versionId: string; sourceOrgId: string; createdByUid: string }>`(無効・失効・期限切れは`Error('Template share not found')`をthrow)
  - `revokeTemplateShares(deps: TemplateShareFirestoreDeps & { queryByCreator: (templateId: string, versionId: string, createdByUid: string) => Promise<string[]> }, input: { templateId: string; versionId: string; createdByUid: string }): Promise<void>`
  - Task 2がこれらをAdminSdkで配線し、Task 3・4が呼び出す。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonTemplates/templateShares.test.ts`を新規作成する。

```ts
import { describe, expect, it } from 'vitest'
import { createTemplateShare, resolveTemplateShare, revokeTemplateShares } from './templateShares'

interface FakeTx {
  get: (path: string) => Promise<{ exists: boolean; data?: Record<string, unknown> }>
  set: (path: string, data: Record<string, unknown>) => void
}

const makeFakeFirestore = (seed: Record<string, Record<string, unknown>> = {}) => {
  const docs = new Map<string, Record<string, unknown>>(Object.entries(seed))
  return {
    docs,
    runTransaction: async <T>(fn: (tx: FakeTx) => Promise<T>): Promise<T> => fn({
      get: async (path) => (docs.has(path) ? { exists: true, data: docs.get(path) } : { exists: false }),
      set: (path, data) => { docs.set(path, data) },
    }),
  }
}

const hashToken = (token: string): string => `hash-of-${token}`

describe('createTemplateShare', () => {
  it('stores the share keyed by the hashed token and returns the plaintext token once', async () => {
    const fake = makeFakeFirestore()
    const result = await createTemplateShare({
      firestore: fake, hashToken, generateToken: () => 'plain-token-1',
      nowMillis: () => 1_000_000,
    }, { templateId: 'tpl-1', versionId: 'v1', sourceOrgId: 'org-source', createdByUid: 'teacher-a', expiresInDays: 30 })

    expect(result).toEqual({ token: 'plain-token-1' })
    const stored = fake.docs.get('templateShares/hash-of-plain-token-1')
    expect(stored).toMatchObject({
      templateId: 'tpl-1', versionId: 'v1', sourceOrgId: 'org-source', createdByUid: 'teacher-a',
      expiresAtMillis: 1_000_000 + 30 * 24 * 60 * 60 * 1000, revokedAt: null,
    })
  })
})

describe('resolveTemplateShare', () => {
  it('returns share metadata for a valid, unexpired, unrevoked token', async () => {
    const fake = makeFakeFirestore({
      'templateShares/hash-of-tok': {
        templateId: 'tpl-1', versionId: 'v1', sourceOrgId: 'org-source', createdByUid: 'teacher-a',
        expiresAtMillis: 2_000_000, revokedAt: null,
      },
    })
    const result = await resolveTemplateShare({ firestore: fake, hashToken, nowMillis: () => 1_000_000 }, { token: 'tok' })
    expect(result).toEqual({ templateId: 'tpl-1', versionId: 'v1', sourceOrgId: 'org-source', createdByUid: 'teacher-a' })
  })

  it('rejects a token with no matching document', async () => {
    const fake = makeFakeFirestore()
    await expect(resolveTemplateShare({ firestore: fake, hashToken, nowMillis: () => 1_000_000 }, { token: 'missing' }))
      .rejects.toThrow('Template share not found')
  })

  it('rejects a revoked token', async () => {
    const fake = makeFakeFirestore({
      'templateShares/hash-of-tok': {
        templateId: 'tpl-1', versionId: 'v1', sourceOrgId: 'org-source', createdByUid: 'teacher-a',
        expiresAtMillis: 2_000_000, revokedAt: 'sometime',
      },
    })
    await expect(resolveTemplateShare({ firestore: fake, hashToken, nowMillis: () => 1_000_000 }, { token: 'tok' }))
      .rejects.toThrow('Template share not found')
  })

  it('rejects an expired token', async () => {
    const fake = makeFakeFirestore({
      'templateShares/hash-of-tok': {
        templateId: 'tpl-1', versionId: 'v1', sourceOrgId: 'org-source', createdByUid: 'teacher-a',
        expiresAtMillis: 1_000_000, revokedAt: null,
      },
    })
    await expect(resolveTemplateShare({ firestore: fake, hashToken, nowMillis: () => 1_000_001 }, { token: 'tok' }))
      .rejects.toThrow('Template share not found')
  })
})

describe('revokeTemplateShares', () => {
  it('sets revokedAt on every share matching templateId/versionId/createdByUid', async () => {
    const fake = makeFakeFirestore({
      'templateShares/hash-a': { templateId: 'tpl-1', versionId: 'v1', createdByUid: 'teacher-a', revokedAt: null },
      'templateShares/hash-b': { templateId: 'tpl-1', versionId: 'v1', createdByUid: 'teacher-a', revokedAt: null },
    })
    await revokeTemplateShares({
      firestore: fake, hashToken, now: () => 'revoked-at-value',
      queryByCreator: async () => ['templateShares/hash-a', 'templateShares/hash-b'],
    }, { templateId: 'tpl-1', versionId: 'v1', createdByUid: 'teacher-a' })

    expect(fake.docs.get('templateShares/hash-a')).toMatchObject({ revokedAt: 'revoked-at-value' })
    expect(fake.docs.get('templateShares/hash-b')).toMatchObject({ revokedAt: 'revoked-at-value' })
  })

  it('does nothing when the query finds no matching shares', async () => {
    const fake = makeFakeFirestore()
    await expect(revokeTemplateShares({
      firestore: fake, hashToken, queryByCreator: async () => [],
    }, { templateId: 'tpl-1', versionId: 'v1', createdByUid: 'teacher-b' })).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/templateShares.test.ts`
Expected: FAIL(`./templateShares`モジュールが存在しない)。

- [ ] **Step 3: 最小限の実装を書く**

`functions/src/lessonTemplates/templateShares.ts`を新規作成する。

```ts
import { createHash, randomBytes } from 'node:crypto'

/** displaySession.ts/recovery.ts と同じ設計: 32バイトのランダムトークン、平文は永続化しない。 */
export const generateTemplateShareToken = (): string => randomBytes(32).toString('hex')

export const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex')

interface TemplateShareTx {
  get: (path: string) => Promise<{ exists: boolean; data?: Record<string, unknown> }>
  set: (path: string, data: Record<string, unknown>) => void
}

export interface TemplateShareFirestoreDeps {
  firestore: { runTransaction: <T>(fn: (tx: TemplateShareTx) => Promise<T>) => Promise<T> }
  hashToken: (token: string) => string
  now?: () => unknown
  nowMillis?: () => number
}

export interface CreateTemplateShareDeps extends TemplateShareFirestoreDeps {
  generateToken: () => string
}
export interface CreateTemplateShareInput {
  templateId: string; versionId: string; sourceOrgId: string; createdByUid: string; expiresInDays: number
}
export interface CreateTemplateShareResult { token: string }

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000

export const createTemplateShare = async (
  deps: CreateTemplateShareDeps,
  input: CreateTemplateShareInput,
): Promise<CreateTemplateShareResult> => {
  const nowMillisValue = deps.nowMillis ? deps.nowMillis() : Date.now()
  return deps.firestore.runTransaction(async (tx) => {
    const token = deps.generateToken()
    const tokenHash = deps.hashToken(token)
    tx.set(`templateShares/${tokenHash}`, {
      templateId: input.templateId, versionId: input.versionId, sourceOrgId: input.sourceOrgId,
      createdByUid: input.createdByUid, createdAt: deps.now ? deps.now() : new Date().toISOString(),
      expiresAtMillis: nowMillisValue + input.expiresInDays * MILLIS_PER_DAY, revokedAt: null,
    })
    return { token }
  })
}

export interface ResolveTemplateShareInput { token: string }
export interface ResolveTemplateShareResult {
  templateId: string; versionId: string; sourceOrgId: string; createdByUid: string
}

export const resolveTemplateShare = async (
  deps: TemplateShareFirestoreDeps,
  input: ResolveTemplateShareInput,
): Promise<ResolveTemplateShareResult> => {
  const nowMillisValue = deps.nowMillis ? deps.nowMillis() : Date.now()
  const tokenHash = deps.hashToken(input.token)
  return deps.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(`templateShares/${tokenHash}`)
    if (!snap.exists || !snap.data) throw new Error('Template share not found')
    const share = snap.data as {
      templateId: string; versionId: string; sourceOrgId: string; createdByUid: string
      expiresAtMillis: number; revokedAt: unknown
    }
    if (share.revokedAt !== null) throw new Error('Template share not found')
    if (nowMillisValue > share.expiresAtMillis) throw new Error('Template share not found')
    return { templateId: share.templateId, versionId: share.versionId, sourceOrgId: share.sourceOrgId, createdByUid: share.createdByUid }
  })
}

export interface RevokeTemplateSharesDeps extends TemplateShareFirestoreDeps {
  queryByCreator: (templateId: string, versionId: string, createdByUid: string) => Promise<string[]>
}
export interface RevokeTemplateSharesInput { templateId: string; versionId: string; createdByUid: string }

export const revokeTemplateShares = async (deps: RevokeTemplateSharesDeps, input: RevokeTemplateSharesInput): Promise<void> => {
  const paths = await deps.queryByCreator(input.templateId, input.versionId, input.createdByUid)
  if (paths.length === 0) return
  const revokedAt = deps.now ? deps.now() : new Date().toISOString()
  await deps.firestore.runTransaction(async (tx) => {
    for (const path of paths) {
      const snap = await tx.get(path)
      if (snap.exists && snap.data) tx.set(path, { ...snap.data, revokedAt })
    }
  })
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/templateShares.test.ts`
Expected: 全件PASS。

- [ ] **Step 5: 型チェックを実行する**

Run: `cd functions && npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 6: コミット**

```bash
git add functions/src/lessonTemplates/templateShares.ts functions/src/lessonTemplates/templateShares.test.ts
git commit -m "feat: 共有リンクv2の純粋ロジック(templateShares)を実装する"
```

---

### Task 2: Firestore Admin SDK配線を実装する

**Files:**
- Modify: `functions/src/lessonTemplates/templateShares.ts`(追記)
- Test: `functions/src/lessonTemplates/templateShares.adminSdk.test.ts`(新規)

**Interfaces:**
- Consumes: Task 1の`createTemplateShare`/`resolveTemplateShare`/`revokeTemplateShares`
- Produces:
  - `createTemplateShareWithAdminSdk(input: CreateTemplateShareInput): Promise<CreateTemplateShareResult>`
  - `resolveTemplateShareWithAdminSdk(input: ResolveTemplateShareInput): Promise<ResolveTemplateShareResult>`
  - `revokeTemplateSharesWithAdminSdk(input: RevokeTemplateSharesInput): Promise<void>`
  - Task 3がこれらをCallableから呼ぶ。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonTemplates/templateShares.adminSdk.test.ts`を新規作成する。

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

type DocumentData = Record<string, unknown>
const documents = new Map<string, DocumentData>()
const queryResults = new Map<string, string[]>()

/** Identity ref carrying only its path — mirrors adminSdkFirestore()'s usage, where db.doc(path) is only ever passed straight into tx.get/tx.set, never called standalone. */
const doc = (path: string) => ({ path })

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc,
    collection: (path: string) => ({
      where: () => ({
        where: () => ({
          where: () => ({
            get: async () => {
              const paths = queryResults.get(path) ?? []
              return { docs: paths.map((p) => ({ ref: { path: p } })) }
            },
          }),
        }),
      }),
    }),
    runTransaction: async (fn: (tx: { get: (ref: { path: string } | string) => Promise<{ exists: boolean; data: () => DocumentData | undefined }>; set: (ref: { path: string } | string, data: DocumentData) => void }) => Promise<unknown>) => fn({
      get: async (ref) => {
        const path = typeof ref === 'string' ? ref : ref.path
        return documents.has(path) ? { exists: true, data: () => documents.get(path) } : { exists: false, data: () => undefined }
      },
      set: (ref, data) => { documents.set(typeof ref === 'string' ? ref : ref.path, data) },
    }),
  }),
}))

import { createTemplateShareWithAdminSdk, resolveTemplateShareWithAdminSdk, revokeTemplateSharesWithAdminSdk } from './templateShares'

describe('createTemplateShareWithAdminSdk / resolveTemplateShareWithAdminSdk', () => {
  beforeEach(() => { documents.clear(); queryResults.clear() })

  it('creates a share and resolves it back by the returned token', async () => {
    const { token } = await createTemplateShareWithAdminSdk({
      templateId: 'tpl-1', versionId: 'v1', sourceOrgId: 'org-source', createdByUid: 'teacher-a', expiresInDays: 30,
    })
    const resolved = await resolveTemplateShareWithAdminSdk({ token })
    expect(resolved).toEqual({ templateId: 'tpl-1', versionId: 'v1', sourceOrgId: 'org-source', createdByUid: 'teacher-a' })
  })

  it('fails to resolve an unknown token', async () => {
    await expect(resolveTemplateShareWithAdminSdk({ token: 'never-issued' })).rejects.toThrow('Template share not found')
  })
})

describe('revokeTemplateSharesWithAdminSdk', () => {
  beforeEach(() => { documents.clear(); queryResults.clear() })

  it('revokes every share document the creator-scoped query returns', async () => {
    documents.set('templateShares/hash-a', { templateId: 'tpl-1', versionId: 'v1', createdByUid: 'teacher-a', revokedAt: null })
    queryResults.set('templateShares', ['templateShares/hash-a'])

    await revokeTemplateSharesWithAdminSdk({ templateId: 'tpl-1', versionId: 'v1', createdByUid: 'teacher-a' })

    expect(documents.get('templateShares/hash-a')).toMatchObject({ revokedAt: expect.anything() })
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/templateShares.adminSdk.test.ts`
Expected: FAIL(`createTemplateShareWithAdminSdk`等が存在しない)。

- [ ] **Step 3: 実装を追加する**

`functions/src/lessonTemplates/templateShares.ts`の先頭に以下のimportを追加する。

```ts
import { getFirestore } from 'firebase-admin/firestore'
```

ファイル末尾に追記する。

```ts
const adminSdkFirestore = () => {
  const db = getFirestore()
  return {
    runTransaction: <T>(fn: (tx: TemplateShareTx) => Promise<T>) => db.runTransaction((tx) => fn({
      get: async (path: string) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: snap.data() } },
      set: (path: string, data: Record<string, unknown>) => { tx.set(db.doc(path), data) },
    })),
  }
}

/** Production wiring: Firestore Admin SDK + crypto. */
export const createTemplateShareWithAdminSdk = (input: CreateTemplateShareInput): Promise<CreateTemplateShareResult> =>
  createTemplateShare({
    firestore: adminSdkFirestore(), generateToken: generateTemplateShareToken, hashToken: sha256Hex,
    now: () => new Date().toISOString(), nowMillis: () => Date.now(),
  }, input)

export const resolveTemplateShareWithAdminSdk = (input: ResolveTemplateShareInput): Promise<ResolveTemplateShareResult> =>
  resolveTemplateShare({
    firestore: adminSdkFirestore(), hashToken: sha256Hex, nowMillis: () => Date.now(),
  }, input)

export const revokeTemplateSharesWithAdminSdk = (input: RevokeTemplateSharesInput): Promise<void> => {
  const db = getFirestore()
  return revokeTemplateShares({
    firestore: adminSdkFirestore(), hashToken: sha256Hex, now: () => new Date().toISOString(),
    queryByCreator: async (templateId, versionId, createdByUid) => {
      const snap = await db.collection('templateShares')
        .where('templateId', '==', templateId)
        .where('versionId', '==', versionId)
        .where('createdByUid', '==', createdByUid)
        .get()
      return snap.docs.map((document) => document.ref.path)
    },
  }, input)
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/templateShares.adminSdk.test.ts src/lessonTemplates/templateShares.test.ts`
Expected: 全件PASS。

- [ ] **Step 5: 型チェックを実行する**

Run: `cd functions && npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 6: コミット**

```bash
git add functions/src/lessonTemplates/templateShares.ts functions/src/lessonTemplates/templateShares.adminSdk.test.ts
git commit -m "feat: 共有リンクv2のFirestore Admin SDK配線を実装する"
```

---

### Task 3: 3つのCallableを追加する

**Files:**
- Modify: `functions/src/lessonTemplates/onCall.ts`
- Modify: `functions/src/index.ts`
- Test: `functions/src/lessonTemplates/onCall.test.ts`

**Interfaces:**
- Consumes: Task 2の`createTemplateShareWithAdminSdk`/`resolveTemplateShareWithAdminSdk`/`revokeTemplateSharesWithAdminSdk`
- Produces: `createTemplateShareCallable`/`resolveTemplateShareCallable`/`revokeTemplateShareCallable`(Task 4は変更しない。既存の`duplicateLessonTemplateCallable`とは独立)

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonTemplates/onCall.test.ts`の`import`群に以下を追加する。

```ts
import { createTemplateShareCallable, resolveTemplateShareCallable, revokeTemplateShareCallable } from './onCall'
import { createTemplateShareWithAdminSdk, resolveTemplateShareWithAdminSdk, revokeTemplateSharesWithAdminSdk } from './templateShares'
```

`vi.mock('./duplicateLessonTemplate', ...)`の直後に追記する。

```ts
vi.mock('./templateShares', () => ({
  createTemplateShareWithAdminSdk: vi.fn(),
  resolveTemplateShareWithAdminSdk: vi.fn(),
  revokeTemplateSharesWithAdminSdk: vi.fn(),
}))
```

ファイル末尾に追記する(`teacher`相当の`auth`を都度組み立てる、既存ファイルの`makeRequest`パターンを踏襲)。

```ts
describe('createTemplateShareCallable', () => {
  const auth = { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }
  const makeRequest = (data: Record<string, unknown>) => ({ auth, data, rawRequest: {} } as unknown as CallableRequest)

  beforeEach(() => { vi.clearAllMocks() })

  it('rejects expiresInDays outside 1-90 without reading the template', async () => {
    await expect(createTemplateShareCallable.run(makeRequest({ templateId: 't1', versionId: 'v1', expiresInDays: 0 }))).rejects.toMatchObject({ code: 'invalid-argument' })
    await expect(createTemplateShareCallable.run(makeRequest({ templateId: 't1', versionId: 'v1', expiresInDays: 91 }))).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(templateGetMock).not.toHaveBeenCalled()
  })

  it('rejects a caller who is not the template author', async () => {
    templateGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'orgId' ? 'org-source' : field === 'createdByUid' ? 'someone-else' : undefined) })
    await expect(createTemplateShareCallable.run(makeRequest({ templateId: 't1', versionId: 'v1', expiresInDays: 30 }))).rejects.toMatchObject({ code: 'permission-denied' })
    expect(createTemplateShareWithAdminSdk).not.toHaveBeenCalled()
  })

  it('creates a share for the template author and returns the token', async () => {
    templateGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'orgId' ? 'org-source' : field === 'createdByUid' ? 'teacher-a' : undefined) })
    vi.mocked(createTemplateShareWithAdminSdk).mockResolvedValue({ token: 'plain-token' })

    await expect(createTemplateShareCallable.run(makeRequest({ templateId: 't1', versionId: 'v1', expiresInDays: 30 }))).resolves.toEqual({ token: 'plain-token' })
    expect(createTemplateShareWithAdminSdk).toHaveBeenCalledWith({
      templateId: 't1', versionId: 'v1', sourceOrgId: 'org-source', createdByUid: 'teacher-a', expiresInDays: 30,
    })
  })
})

describe('resolveTemplateShareCallable', () => {
  const auth = { uid: 'teacher-b', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }
  const makeRequest = (data: Record<string, unknown>) => ({ auth, data, rawRequest: {} } as unknown as CallableRequest)

  beforeEach(() => { vi.clearAllMocks() })

  it('rejects an invalid/expired/revoked token with not-found', async () => {
    vi.mocked(resolveTemplateShareWithAdminSdk).mockRejectedValue(new Error('Template share not found'))
    await expect(resolveTemplateShareCallable.run(makeRequest({ token: 'bad' }))).rejects.toMatchObject({ code: 'not-found' })
  })

  it('returns the shared version content for a valid token', async () => {
    vi.mocked(resolveTemplateShareWithAdminSdk).mockResolvedValue({ templateId: 't1', versionId: 'v1', sourceOrgId: 'org-source', createdByUid: 'teacher-a' })
    templateGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'content' ? { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES' } : undefined) })

    await expect(resolveTemplateShareCallable.run(makeRequest({ token: 'good' }))).resolves.toEqual({
      templateId: 't1', versionId: 'v1', content: { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES' },
    })
  })
})

describe('revokeTemplateShareCallable', () => {
  const auth = { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }
  const makeRequest = (data: Record<string, unknown>) => ({ auth, data, rawRequest: {} } as unknown as CallableRequest)

  beforeEach(() => { vi.clearAllMocks() })

  it('always resolves, delegating creator-scoping to the query itself', async () => {
    vi.mocked(revokeTemplateSharesWithAdminSdk).mockResolvedValue(undefined)
    await expect(revokeTemplateShareCallable.run(makeRequest({ templateId: 't1', versionId: 'v1' }))).resolves.toEqual({ revoked: true })
    expect(revokeTemplateSharesWithAdminSdk).toHaveBeenCalledWith({ templateId: 't1', versionId: 'v1', createdByUid: 'teacher-a' })
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/onCall.test.ts`
Expected: FAIL(3つのCallableが存在しない)。

- [ ] **Step 3: `onCall.ts`にCallableを追加する**

`functions/src/lessonTemplates/onCall.ts`のimportに追記する。

```ts
import {
  createTemplateShareWithAdminSdk,
  resolveTemplateShareWithAdminSdk,
  revokeTemplateSharesWithAdminSdk,
} from './templateShares'
```

ファイル末尾に追記する。

```ts
interface CreateTemplateShareCallableInput { templateId?: unknown; versionId?: unknown; expiresInDays?: unknown }
const isValidExpiresInDays = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 90

export const createTemplateShareCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as CreateTemplateShareCallableInput
  if (typeof data.templateId !== 'string' || typeof data.versionId !== 'string' || !isValidExpiresInDays(data.expiresInDays)) {
    throw new HttpsError('invalid-argument', 'リクエストが不正です。')
  }
  const firestore = getFirestore()
  const templateSnap = await firestore.doc(`lessonTemplates/${data.templateId}`).get()
  if (!templateSnap.exists) throw new HttpsError('not-found', 'レッスンテンプレートが見つかりません。')
  const sourceOrgId = templateSnap.get('orgId') as string
  const createdByUid = templateSnap.get('createdByUid') as string
  if (createdByUid !== request.auth.uid) throw new HttpsError('permission-denied', 'このテンプレートの作成者のみ共有リンクを発行できます。')

  return createTemplateShareWithAdminSdk({
    templateId: data.templateId, versionId: data.versionId, sourceOrgId, createdByUid, expiresInDays: data.expiresInDays,
  })
})

interface ResolveTemplateShareCallableInput { token?: unknown }

export const resolveTemplateShareCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as ResolveTemplateShareCallableInput
  if (typeof data.token !== 'string' || data.token.length === 0) throw new HttpsError('invalid-argument', 'リクエストが不正です。')

  let share
  try {
    share = await resolveTemplateShareWithAdminSdk({ token: data.token })
  } catch {
    throw new HttpsError('not-found', '共有リンクが無効です。')
  }
  const versionSnap = await getFirestore().doc(`lessonTemplates/${share.templateId}/versions/${share.versionId}`).get()
  return { templateId: share.templateId, versionId: share.versionId, content: versionSnap.get('content') }
})

interface RevokeTemplateShareCallableInput { templateId?: unknown; versionId?: unknown }

export const revokeTemplateShareCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as RevokeTemplateShareCallableInput
  if (typeof data.templateId !== 'string' || typeof data.versionId !== 'string') throw new HttpsError('invalid-argument', 'リクエストが不正です。')

  await revokeTemplateSharesWithAdminSdk({ templateId: data.templateId, versionId: data.versionId, createdByUid: request.auth.uid })
  return { revoked: true }
})
```

- [ ] **Step 4: `functions/src/index.ts`にエクスポートを追加する**

既存の`export { duplicateLessonTemplateCallable, publishLessonVersionCallable } from './lessonTemplates/onCall'`を以下に置き換える。

```ts
export {
  createTemplateShareCallable, duplicateLessonTemplateCallable, publishLessonVersionCallable,
  resolveTemplateShareCallable, revokeTemplateShareCallable,
} from './lessonTemplates/onCall'
```

- [ ] **Step 5: テストを実行して成功を確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/onCall.test.ts`
Expected: 全件PASS。

- [ ] **Step 6: 型チェックを実行する**

Run: `cd functions && npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 7: コミット**

```bash
git add functions/src/lessonTemplates/onCall.ts functions/src/lessonTemplates/onCall.test.ts functions/src/index.ts
git commit -m "feat: 共有リンクv2の作成・解決・失効Callableを追加する"
```

---

### Task 4: `duplicateLessonTemplateCallable`に`shareToken`分岐を追加する

**Files:**
- Modify: `functions/src/lessonTemplates/onCall.ts`
- Test: `functions/src/lessonTemplates/onCall.test.ts`

**Interfaces:**
- Consumes: Task 2の`resolveTemplateShareWithAdminSdk`
- Produces: `DuplicateLessonTemplateCallableInput.shareToken?: string`(クライアント向け入力型のみ。`duplicateLessonTemplate.ts`本体・`DuplicateLessonTemplateInput`は無変更)

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonTemplates/onCall.test.ts`の`describe('duplicateLessonTemplateCallable', ...)`ブロック内、既存の最後のテストの直後に追記する。

```ts
  it('skips the source-org membership check and duplicates when a valid matching shareToken is provided', async () => {
    vi.mocked(resolveTemplateShareWithAdminSdk).mockResolvedValue({ templateId: 'source-template-1', versionId: 'version-1', sourceOrgId: 'org-source', createdByUid: 'teacher-other' })
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 }) // target org only
    vi.mocked(duplicateLessonTemplateWithAdminSdk).mockResolvedValue({ templateId: 'template-copy-1', alreadyDuplicated: false })

    const request = { ...makeRequest(), data: { ...makeRequest().data, shareToken: 'valid-token' } } as unknown as CallableRequest<DuplicateLessonTemplateCallableInput>
    await expect(duplicateLessonTemplateCallable.run(request)).resolves.toEqual({ templateId: 'template-copy-1', alreadyDuplicated: false })

    expect(requireActiveOrgMember).toHaveBeenCalledTimes(1)
    expect(requireActiveOrgMember).toHaveBeenCalledWith(expect.anything(), 'org-target', 'teacher-target')
  })

  it('rejects with not-found when shareToken is invalid, expired, or revoked', async () => {
    vi.mocked(resolveTemplateShareWithAdminSdk).mockRejectedValue(new Error('Template share not found'))
    const request = { ...makeRequest(), data: { ...makeRequest().data, shareToken: 'bad-token' } } as unknown as CallableRequest<DuplicateLessonTemplateCallableInput>
    await expect(duplicateLessonTemplateCallable.run(request)).rejects.toMatchObject({ code: 'not-found' })
    expect(duplicateLessonTemplateWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects with permission-denied when a valid shareToken targets a different template/version', async () => {
    vi.mocked(resolveTemplateShareWithAdminSdk).mockResolvedValue({ templateId: 'other-template', versionId: 'other-version', sourceOrgId: 'org-source', createdByUid: 'teacher-other' })
    const request = { ...makeRequest(), data: { ...makeRequest().data, shareToken: 'valid-but-mismatched' } } as unknown as CallableRequest<DuplicateLessonTemplateCallableInput>
    await expect(duplicateLessonTemplateCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
    expect(duplicateLessonTemplateWithAdminSdk).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/onCall.test.ts`
Expected: FAIL(現行実装は`shareToken`を認識せず、常に`requireActiveOrgMember(sourceOrgId, ...)`を呼ぶ)。

- [ ] **Step 3: `onCall.ts`を修正する**

`DuplicateLessonTemplateCallableInput`に1行追加する。

```ts
export interface DuplicateLessonTemplateCallableInput {
  sourceTemplateId: string
  sourceVersionId: string
  targetOrgId: string
  confirmedOverrides: Partial<ScheduleSensitiveSettings>
  idempotencyKey: string
  shareToken?: string
}
```

`isValidDuplicateLessonTemplateInput`に検証を1行追加する(既存の`idempotencyKey`チェックの直後)。

```ts
  if (record.shareToken !== undefined && (typeof record.shareToken !== 'string' || record.shareToken.length === 0)) return false
```

`duplicateLessonTemplateCallable`本体の以下の箇所を置き換える。

```ts
  const firestore = getFirestore()
  const sourceTemplateSnap = await firestore.doc(`lessonTemplates/${request.data.sourceTemplateId}`).get()
  if (!sourceTemplateSnap.exists) throw new HttpsError('not-found', '複製元のレッスンテンプレートが見つかりません。')
  // sourceOrgId always comes from the stored source template, never from client input.
  const sourceOrgId = sourceTemplateSnap.get('orgId') as string
  if (request.data.shareToken) {
    let share
    try {
      share = await resolveTemplateShareWithAdminSdk({ token: request.data.shareToken })
    } catch {
      throw new HttpsError('not-found', '共有リンクが無効です。')
    }
    if (share.templateId !== request.data.sourceTemplateId || share.versionId !== request.data.sourceVersionId) {
      throw new HttpsError('permission-denied', '共有リンクの対象と一致しません。')
    }
    // A valid, matching share token substitutes for source-org membership —
    // this is the one intentional way to read/duplicate another org's
    // template, mirroring the comment below for target-org membership.
  } else {
    // Mirrors firestore.rules' `allow get`/`allow list` gate on lessonTemplates
    // (activeMember(resource.data.orgId)): this Callable runs on the Admin SDK
    // and bypasses Rules, so it must re-enforce the same "must belong to the
    // source template's org to read it" boundary itself, or duplication would
    // become a way to exfiltrate another org's lesson content.
    await requireActiveOrgMember(firestore, sourceOrgId, request.auth.uid)
  }
  // targetOrgId is client-chosen (picking where the copy lands is a
  // legitimate use case), but the caller must actually have material
  // creation rights there.
  await requireActiveOrgMember(firestore, request.data.targetOrgId, request.auth.uid)
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/onCall.test.ts`
Expected: 全件PASS。

- [ ] **Step 5: 型チェックとfunctions全体のテストを実行する**

Run: `cd functions && npx tsc --noEmit && npx vitest run`
Expected: エラーなし、全テストPASS。

- [ ] **Step 6: コミット**

```bash
git add functions/src/lessonTemplates/onCall.ts functions/src/lessonTemplates/onCall.test.ts
git commit -m "feat: duplicateLessonTemplateCallableでshareTokenによる組織外複製を許可する"
```

---

### Task 5: Firestoreルールと複合インデックスを追加する

**Files:**
- Modify: `firestore.rules`
- Modify: `firestore.indexes.json`
- Modify: `test/firestore.rules.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `templateShares/{shareId}`の読み書き制御、`templateShares`の複合インデックス(Task 2の`queryByCreator`が本番で必要とする)

- [ ] **Step 1: 失敗するテストを書く**

`test/firestore.rules.test.ts`の`describe('organizations/{orgId}/aiUsageCounters/{counterId}', ...)`ブロックの直後に追記する。

```ts
describe('templateShares/{shareId}', () => {
  it('declares an explicit deny rule for the template shares collection', () => {
    const rules = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8')
    expect(rules).toMatch(
      /match \/templateShares\/\{shareId\} \{[\s\S]*?allow read, write: if false;[\s\S]*?\}/,
    )
  })

  it('denies all direct client reads and writes', async () => {
    const context = environment.authenticatedContext('teacher-a', teacherToken)
    const share = doc(context.firestore(), 'templateShares/some-hash')
    await assertFails(getDoc(share))
    await assertFails(setDoc(share, { templateId: 't1' }))
  })
})
```

- [ ] **Step 2: ルールテストを実行して失敗を確認する**

Run: `npx firebase emulators:exec --project demo-stock-league-classroom --only firestore,database,storage "npx vitest --config vite.rules.config.ts run test/firestore.rules.test.ts"`
Expected: FAIL(`templateShares`にマッチする明示ルールがまだ存在しない)。

- [ ] **Step 3: `firestore.rules`にルールを追加する**

`firestore.rules`の`match /organizations/{orgId}/aiUsageCounters/{counterId} { allow read, write: if false; }`の直後に追記する。

```
    match /templateShares/{shareId} { allow read, write: if false; }
```

- [ ] **Step 4: `firestore.indexes.json`に複合インデックスを追加する**

`firestore.indexes.json`の`indexes`配列に以下を追加する(既存の`lessonRuns`インデックスの後に追加、配列全体をカンマ区切りで維持)。

```json
    {
      "collectionGroup": "templateShares",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "templateId", "order": "ASCENDING" },
        { "fieldPath": "versionId", "order": "ASCENDING" },
        { "fieldPath": "createdByUid", "order": "ASCENDING" }
      ]
    }
```

- [ ] **Step 5: ルールテストを実行して成功を確認する**

Run: `npx firebase emulators:exec --project demo-stock-league-classroom --only firestore,database,storage "npx vitest --config vite.rules.config.ts run test/firestore.rules.test.ts"`
Expected: 全件PASS。

- [ ] **Step 6: コミット**

```bash
git add firestore.rules firestore.indexes.json test/firestore.rules.test.ts
git commit -m "feat: 共有リンクv2のFirestoreルールと複合インデックスを追加する"
```
