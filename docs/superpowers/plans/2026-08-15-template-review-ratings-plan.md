# レビュー(評価・コメント) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 実際にテンプレートを授業で完了させた教師(直接実施・複製経由の両方)が3軸評価+コメントを投稿でき、テンプレート側に集計評価が反映される。

**Architecture:** `functions/src/lessonTemplates/templateReviews.ts`に、依存注入可能な純粋ロジック(`isEligibleToReviewTemplate`/`submitTemplateReview`/`listTemplateReviews`)を実装する(`templateShares.ts`/`usageQuota.ts`と同じdeps注入パターン)。3つのCallableをこれの上に薄く配線する。詳細ページ`/teacher/marketplace/:templateId`を新設し、`CommunityTemplatesPage`から遷移できるようにする。

**Tech Stack:** Firebase Cloud Functions (TypeScript, `firebase-admin/firestore`)、React + MUI、Vitest、React Testing Library、Firestore Rules (emulator)。

## Global Constraints

- 正本: `docs/superpowers/specs/2026-08-15-template-review-ratings-design.md`。矛盾があれば正本を優先する。
- レビュー資格: `primaryTeacherUid`が対象版で`status === 'COMPLETED'`のlessonRunを持つこと(直接実施)、または自分が複製したテンプレートで`status === 'COMPLETED'`のlessonRunを持つこと(複製経由)。共同教師(`teacherRoles`)は対象外。
- 評価軸は3つ: `clarityRating`/`easeOfImplementationRating`/`studentResponseRating`(いずれも1〜5の整数)。
- `templateReviews/{versionId}_{uid}`は決定的ID(1教師につき1版1レビュー、再送信は上書き)。
- `templateReviews`コレクションはクライアントから直接読み書きできない(すべてCallable経由)。
- クライアント側の資格事前チェックはUX目的のみ。書き込み時は必ずサーバー側で資格を再検証する。

---

### Task 1: 純粋ロジック(資格判定・レビュー投稿・一覧)を実装する

**Files:**
- Create: `functions/src/lessonTemplates/templateReviews.ts`
- Test: `functions/src/lessonTemplates/templateReviews.test.ts`

**Interfaces:**
- Produces:
  - `interface TemplateReviewDeps { getCompletedRunTemplateVersionIds: (templateId: string, uid: string) => Promise<string[]>; getOwnDuplicateTemplateIds: (sourceTemplateId: string, sourceVersionId: string, uid: string) => Promise<string[]>; getReview: (versionId: string, uid: string) => Promise<{ exists: boolean; data?: Record<string, unknown> }>; setReview: (versionId: string, uid: string, data: Record<string, unknown>) => Promise<void>; listReviewsForVersion: (versionId: string) => Promise<Array<Record<string, unknown>>>; updateTemplateAggregate: (templateId: string, aggregate: Record<string, unknown>) => Promise<void>; now?: () => unknown }`
  - `isEligibleToReviewTemplate(deps: Pick<TemplateReviewDeps, 'getCompletedRunTemplateVersionIds' | 'getOwnDuplicateTemplateIds'>, input: { templateId: string; versionId: string; uid: string }): Promise<boolean>`
  - `submitTemplateReview(deps: TemplateReviewDeps, input: { templateId: string; versionId: string; uid: string; clarityRating: number; easeOfImplementationRating: number; studentResponseRating: number; comment: string | null }): Promise<void>`(資格が無ければ`Error('Not eligible to review this template version')`をthrow)
  - `listTemplateReviews(deps: Pick<TemplateReviewDeps, 'listReviewsForVersion'>, versionId: string): Promise<Array<Record<string, unknown>>>`
  - Task 2がこれらをAdminSdkで配線し、Task 3が呼び出す。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonTemplates/templateReviews.test.ts`を新規作成する。

```ts
import { describe, expect, it, vi } from 'vitest'
import { isEligibleToReviewTemplate, listTemplateReviews, submitTemplateReview } from './templateReviews'

describe('isEligibleToReviewTemplate', () => {
  it('is eligible when the teacher directly completed a lessonRun for this exact template/version', async () => {
    const deps = {
      getCompletedRunTemplateVersionIds: vi.fn().mockResolvedValue(['v1', 'v2']),
      getOwnDuplicateTemplateIds: vi.fn(),
    }
    await expect(isEligibleToReviewTemplate(deps, { templateId: 't1', versionId: 'v1', uid: 'teacher-a' })).resolves.toBe(true)
    expect(deps.getOwnDuplicateTemplateIds).not.toHaveBeenCalled()
  })

  it('is eligible via a duplicate the teacher made and completed themselves', async () => {
    const deps = {
      getCompletedRunTemplateVersionIds: vi.fn()
        .mockResolvedValueOnce([]) // direct check on the original template: none
        .mockResolvedValueOnce(['copy-v1']), // check on the duplicate template: completed
      getOwnDuplicateTemplateIds: vi.fn().mockResolvedValue(['copy-1']),
    }
    await expect(isEligibleToReviewTemplate(deps, { templateId: 't1', versionId: 'v1', uid: 'teacher-b' })).resolves.toBe(true)
    expect(deps.getOwnDuplicateTemplateIds).toHaveBeenCalledWith('t1', 'v1', 'teacher-b')
  })

  it('is not eligible with no direct or duplicate-based completion', async () => {
    const deps = {
      getCompletedRunTemplateVersionIds: vi.fn().mockResolvedValue([]),
      getOwnDuplicateTemplateIds: vi.fn().mockResolvedValue([]),
    }
    await expect(isEligibleToReviewTemplate(deps, { templateId: 't1', versionId: 'v1', uid: 'teacher-c' })).resolves.toBe(false)
  })
})

const makeDeps = (overrides: Partial<Parameters<typeof submitTemplateReview>[0]> = {}) => ({
  getCompletedRunTemplateVersionIds: vi.fn().mockResolvedValue(['v1']),
  getOwnDuplicateTemplateIds: vi.fn().mockResolvedValue([]),
  getReview: vi.fn().mockResolvedValue({ exists: false }),
  setReview: vi.fn().mockResolvedValue(undefined),
  listReviewsForVersion: vi.fn().mockResolvedValue([{ clarityRating: 4, easeOfImplementationRating: 5, studentResponseRating: 3 }]),
  updateTemplateAggregate: vi.fn().mockResolvedValue(undefined),
  now: () => 'NOW',
  ...overrides,
})

describe('submitTemplateReview', () => {
  it('throws when the caller is not eligible', async () => {
    const deps = makeDeps({ getCompletedRunTemplateVersionIds: vi.fn().mockResolvedValue([]) })
    await expect(submitTemplateReview(deps, {
      templateId: 't1', versionId: 'v1', uid: 'teacher-a',
      clarityRating: 5, easeOfImplementationRating: 5, studentResponseRating: 5, comment: null,
    })).rejects.toThrow('Not eligible to review this template version')
    expect(deps.setReview).not.toHaveBeenCalled()
  })

  it('sets createdAt on first submission and preserves it on resubmission', async () => {
    const depsFirst = makeDeps()
    await submitTemplateReview(depsFirst, { templateId: 't1', versionId: 'v1', uid: 'teacher-a', clarityRating: 4, easeOfImplementationRating: 4, studentResponseRating: 4, comment: 'よかった' })
    expect(depsFirst.setReview).toHaveBeenCalledWith('v1', 'teacher-a', expect.objectContaining({ createdAt: 'NOW', updatedAt: 'NOW', comment: 'よかった' }))

    const depsResubmit = makeDeps({ getReview: vi.fn().mockResolvedValue({ exists: true, data: { createdAt: 'ORIGINAL' } }), now: () => 'LATER' })
    await submitTemplateReview(depsResubmit, { templateId: 't1', versionId: 'v1', uid: 'teacher-a', clarityRating: 5, easeOfImplementationRating: 5, studentResponseRating: 5, comment: null })
    expect(depsResubmit.setReview).toHaveBeenCalledWith('v1', 'teacher-a', expect.objectContaining({ createdAt: 'ORIGINAL', updatedAt: 'LATER' }))
  })

  it('recomputes the template aggregate from all reviews for the version', async () => {
    const deps = makeDeps({
      listReviewsForVersion: vi.fn().mockResolvedValue([
        { clarityRating: 4, easeOfImplementationRating: 2, studentResponseRating: 5 },
        { clarityRating: 2, easeOfImplementationRating: 4, studentResponseRating: 3 },
      ]),
    })
    await submitTemplateReview(deps, { templateId: 't1', versionId: 'v1', uid: 'teacher-a', clarityRating: 4, easeOfImplementationRating: 2, studentResponseRating: 5, comment: null })
    expect(deps.updateTemplateAggregate).toHaveBeenCalledWith('t1', {
      reviewCount: 2, averageClarityRating: 3, averageEaseOfImplementationRating: 3, averageStudentResponseRating: 4,
    })
  })
})

describe('listTemplateReviews', () => {
  it('delegates to listReviewsForVersion', async () => {
    const deps = { listReviewsForVersion: vi.fn().mockResolvedValue([{ comment: 'よい教材でした' }]) }
    await expect(listTemplateReviews(deps, 'v1')).resolves.toEqual([{ comment: 'よい教材でした' }])
    expect(deps.listReviewsForVersion).toHaveBeenCalledWith('v1')
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/templateReviews.test.ts`
Expected: FAIL(`./templateReviews`モジュールが存在しない)。

- [ ] **Step 3: 実装を追加する**

`functions/src/lessonTemplates/templateReviews.ts`を新規作成する。

```ts
export interface TemplateReviewDeps {
  getCompletedRunTemplateVersionIds: (templateId: string, uid: string) => Promise<string[]>
  getOwnDuplicateTemplateIds: (sourceTemplateId: string, sourceVersionId: string, uid: string) => Promise<string[]>
  getReview: (versionId: string, uid: string) => Promise<{ exists: boolean; data?: Record<string, unknown> }>
  setReview: (versionId: string, uid: string, data: Record<string, unknown>) => Promise<void>
  listReviewsForVersion: (versionId: string) => Promise<Array<Record<string, unknown>>>
  updateTemplateAggregate: (templateId: string, aggregate: Record<string, unknown>) => Promise<void>
  now?: () => unknown
}

export interface EligibilityCheckInput { templateId: string; versionId: string; uid: string }

/**
 * A teacher outside the source template's org can only run it after
 * duplicating it into their own org (createLessonRunCallable has no
 * COMMUNITY/share-token bypass, unlike duplicateLessonTemplateCallable) — so
 * their completed lessonRun carries the DUPLICATE's templateId, not the
 * original's. Eligibility therefore checks direct completion first, then
 * falls back to any of the caller's own duplicates of this exact version.
 */
export const isEligibleToReviewTemplate = async (
  deps: Pick<TemplateReviewDeps, 'getCompletedRunTemplateVersionIds' | 'getOwnDuplicateTemplateIds'>,
  input: EligibilityCheckInput,
): Promise<boolean> => {
  const directVersionIds = await deps.getCompletedRunTemplateVersionIds(input.templateId, input.uid)
  if (directVersionIds.includes(input.versionId)) return true

  const duplicateTemplateIds = await deps.getOwnDuplicateTemplateIds(input.templateId, input.versionId, input.uid)
  for (const duplicateTemplateId of duplicateTemplateIds) {
    const duplicateVersionIds = await deps.getCompletedRunTemplateVersionIds(duplicateTemplateId, input.uid)
    if (duplicateVersionIds.length > 0) return true
  }
  return false
}

export interface SubmitTemplateReviewInput {
  templateId: string; versionId: string; uid: string
  clarityRating: number; easeOfImplementationRating: number; studentResponseRating: number
  comment: string | null
}

const average = (reviews: Array<Record<string, unknown>>, key: string): number =>
  reviews.reduce((sum, review) => sum + (review[key] as number), 0) / reviews.length

export const submitTemplateReview = async (deps: TemplateReviewDeps, input: SubmitTemplateReviewInput): Promise<void> => {
  const eligible = await isEligibleToReviewTemplate(deps, { templateId: input.templateId, versionId: input.versionId, uid: input.uid })
  if (!eligible) throw new Error('Not eligible to review this template version')

  const now = deps.now ? deps.now() : new Date().toISOString()
  const existing = await deps.getReview(input.versionId, input.uid)
  await deps.setReview(input.versionId, input.uid, {
    templateId: input.templateId, versionId: input.versionId, reviewedByUid: input.uid,
    clarityRating: input.clarityRating, easeOfImplementationRating: input.easeOfImplementationRating, studentResponseRating: input.studentResponseRating,
    comment: input.comment,
    createdAt: existing.exists ? existing.data?.createdAt : now, updatedAt: now,
  })

  const reviews = await deps.listReviewsForVersion(input.versionId)
  await deps.updateTemplateAggregate(input.templateId, {
    reviewCount: reviews.length,
    averageClarityRating: average(reviews, 'clarityRating'),
    averageEaseOfImplementationRating: average(reviews, 'easeOfImplementationRating'),
    averageStudentResponseRating: average(reviews, 'studentResponseRating'),
  })
}

export const listTemplateReviews = (
  deps: Pick<TemplateReviewDeps, 'listReviewsForVersion'>,
  versionId: string,
): Promise<Array<Record<string, unknown>>> => deps.listReviewsForVersion(versionId)
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/templateReviews.test.ts`
Expected: 全件PASS。

- [ ] **Step 5: 型チェックを実行する**

Run: `cd functions && npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 6: コミット**

```bash
git add functions/src/lessonTemplates/templateReviews.ts functions/src/lessonTemplates/templateReviews.test.ts
git commit -m "feat: レビューの資格判定・投稿・一覧の純粋ロジックを実装する"
```

---

### Task 2: Firestore Admin SDK配線と複合インデックスを追加する

**Files:**
- Modify: `functions/src/lessonTemplates/templateReviews.ts`
- Test: `functions/src/lessonTemplates/templateReviews.adminSdk.test.ts`
- Modify: `firestore.indexes.json`

**Interfaces:**
- Consumes: Task 1の`TemplateReviewDeps`
- Produces: `getTemplateReviewDepsWithAdminSdk(nowFn?: () => unknown): TemplateReviewDeps`。Task 3がこれをCallableから呼ぶ。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonTemplates/templateReviews.adminSdk.test.ts`を新規作成する。

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

type DocumentData = Record<string, unknown>
const documents = new Map<string, DocumentData>()
const queryResults = new Map<string, DocumentData[]>()

const doc = (path: string) => ({
  get: async () => (documents.has(path) ? { exists: true, data: () => documents.get(path) } : { exists: false, data: () => undefined }),
  set: async (data: DocumentData) => { documents.set(path, data) },
  update: async (data: DocumentData) => { documents.set(path, { ...(documents.get(path) ?? {}), ...data }) },
})

const collection = (path: string) => ({
  where: () => ({
    where: () => ({
      where: () => ({ get: async () => ({ docs: (queryResults.get(path) ?? []).map((data, index) => ({ id: `${path}-${index}`, data: () => data })) }) }),
      get: async () => ({ docs: (queryResults.get(path) ?? []).map((data, index) => ({ id: `${path}-${index}`, data: () => data })) }),
    }),
    get: async () => ({ docs: (queryResults.get(path) ?? []).map((data, index) => ({ id: `${path}-${index}`, data: () => data })) }),
  }),
})

vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ doc, collection }) }))

import { getTemplateReviewDepsWithAdminSdk } from './templateReviews'

describe('getTemplateReviewDepsWithAdminSdk', () => {
  beforeEach(() => { documents.clear(); queryResults.clear() })

  it('getCompletedRunTemplateVersionIds queries lessonRuns by templateId/uid/COMPLETED and returns templateVersionIds', async () => {
    queryResults.set('lessonRuns', [{ templateVersionId: 'v1' }, { templateVersionId: 'v2' }])
    const deps = getTemplateReviewDepsWithAdminSdk()
    await expect(deps.getCompletedRunTemplateVersionIds('t1', 'teacher-a')).resolves.toEqual(['v1', 'v2'])
  })

  it('getOwnDuplicateTemplateIds queries lessonTemplates by sourceTemplateId/sourceVersionId/createdByUid and returns doc ids', async () => {
    queryResults.set('lessonTemplates', [{}, {}])
    const deps = getTemplateReviewDepsWithAdminSdk()
    await expect(deps.getOwnDuplicateTemplateIds('t1', 'v1', 'teacher-b')).resolves.toEqual(['lessonTemplates-0', 'lessonTemplates-1'])
  })

  it('getReview/setReview round-trip through templateReviews/{versionId}_{uid}', async () => {
    const deps = getTemplateReviewDepsWithAdminSdk()
    await expect(deps.getReview('v1', 'teacher-a')).resolves.toEqual({ exists: false, data: undefined })
    await deps.setReview('v1', 'teacher-a', { comment: 'よかった' })
    const result = await deps.getReview('v1', 'teacher-a')
    expect(result.exists).toBe(true)
    expect(result.data).toEqual({ comment: 'よかった' })
  })

  it('listReviewsForVersion queries templateReviews by versionId', async () => {
    queryResults.set('templateReviews', [{ comment: 'よい教材' }])
    const deps = getTemplateReviewDepsWithAdminSdk()
    await expect(deps.listReviewsForVersion('v1')).resolves.toEqual([{ comment: 'よい教材' }])
  })

  it('updateTemplateAggregate updates lessonTemplates/{templateId}', async () => {
    const deps = getTemplateReviewDepsWithAdminSdk()
    await deps.updateTemplateAggregate('t1', { reviewCount: 3 })
    const snap = await doc('lessonTemplates/t1').get()
    expect(snap.data()).toEqual({ reviewCount: 3 })
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/templateReviews.adminSdk.test.ts`
Expected: FAIL(`getTemplateReviewDepsWithAdminSdk`が存在しない)。

- [ ] **Step 3: 実装を追加する**

`functions/src/lessonTemplates/templateReviews.ts`の先頭に追加する。

```ts
import { getFirestore } from 'firebase-admin/firestore'
```

ファイル末尾に追記する。

```ts
const reviewDocId = (versionId: string, uid: string): string => `${versionId}_${uid}`

/** Production wiring: Firestore Admin SDK. */
export const getTemplateReviewDepsWithAdminSdk = (nowFn: () => unknown = () => new Date().toISOString()): TemplateReviewDeps => {
  const db = getFirestore()
  return {
    getCompletedRunTemplateVersionIds: async (templateId, uid) => {
      const snap = await db.collection('lessonRuns')
        .where('templateId', '==', templateId).where('primaryTeacherUid', '==', uid).where('status', '==', 'COMPLETED')
        .get()
      return snap.docs.map((document) => (document.data() as { templateVersionId: string }).templateVersionId)
    },
    getOwnDuplicateTemplateIds: async (sourceTemplateId, sourceVersionId, uid) => {
      const snap = await db.collection('lessonTemplates')
        .where('sourceTemplateId', '==', sourceTemplateId).where('sourceVersionId', '==', sourceVersionId).where('createdByUid', '==', uid)
        .get()
      return snap.docs.map((document) => document.id)
    },
    getReview: async (versionId, uid) => {
      const snap = await db.doc(`templateReviews/${reviewDocId(versionId, uid)}`).get()
      return { exists: snap.exists, data: snap.exists ? (snap.data() as Record<string, unknown>) : undefined }
    },
    setReview: async (versionId, uid, data) => { await db.doc(`templateReviews/${reviewDocId(versionId, uid)}`).set(data) },
    listReviewsForVersion: async (versionId) => {
      const snap = await db.collection('templateReviews').where('versionId', '==', versionId).get()
      return snap.docs.map((document) => document.data() as Record<string, unknown>)
    },
    updateTemplateAggregate: async (templateId, aggregate) => { await db.doc(`lessonTemplates/${templateId}`).update(aggregate) },
    now: nowFn,
  }
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/templateReviews.adminSdk.test.ts src/lessonTemplates/templateReviews.test.ts`
Expected: 全件PASS。

- [ ] **Step 5: `firestore.indexes.json`に複合インデックスを追加する**

`firestore.indexes.json`の`indexes`配列末尾に追加する。

```json
    {
      "collectionGroup": "lessonRuns",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "templateId", "order": "ASCENDING" },
        { "fieldPath": "primaryTeacherUid", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "lessonTemplates",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "sourceTemplateId", "order": "ASCENDING" },
        { "fieldPath": "sourceVersionId", "order": "ASCENDING" },
        { "fieldPath": "createdByUid", "order": "ASCENDING" }
      ]
    }
```

- [ ] **Step 6: 型チェックを実行する**

Run: `cd functions && npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 7: コミット**

```bash
git add functions/src/lessonTemplates/templateReviews.ts functions/src/lessonTemplates/templateReviews.adminSdk.test.ts firestore.indexes.json
git commit -m "feat: レビューのFirestore Admin SDK配線と複合インデックスを追加する"
```

---

### Task 3: レビューCallableを追加する

**Files:**
- Modify: `functions/src/lessonTemplates/onCall.ts`
- Modify: `functions/src/lessonTemplates/onCall.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: Task 2の`getTemplateReviewDepsWithAdminSdk`、Task 1の`isEligibleToReviewTemplate`/`submitTemplateReview`/`listTemplateReviews`
- Produces: `canReviewTemplateCallable`/`submitTemplateReviewCallable`/`listTemplateReviewsCallable`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonTemplates/onCall.test.ts`のimportに追記する。

```ts
import {
  canReviewTemplateCallable, listTemplateReviewsCallable, submitTemplateReviewCallable,
} from './onCall'
import { getTemplateReviewDepsWithAdminSdk, isEligibleToReviewTemplate, listTemplateReviews, submitTemplateReview } from './templateReviews'
```

冒頭に`templateReviews`のモックを追加する(既存の`vi.mock('./templateShares', ...)`の直後)。

```ts
vi.mock('./templateReviews', () => ({
  getTemplateReviewDepsWithAdminSdk: vi.fn(() => ({})),
  isEligibleToReviewTemplate: vi.fn(),
  submitTemplateReview: vi.fn(),
  listTemplateReviews: vi.fn(),
}))
```

ファイル末尾に追記する。

```ts
describe('canReviewTemplateCallable', () => {
  const auth = { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }
  const makeRequest = (data: Record<string, unknown>) => ({ auth, data, rawRequest: {} } as unknown as CallableRequest)

  beforeEach(() => { vi.clearAllMocks() })

  it('returns the eligibility check result', async () => {
    vi.mocked(isEligibleToReviewTemplate).mockResolvedValue(true)
    await expect(canReviewTemplateCallable.run(makeRequest({ templateId: 't1', versionId: 'v1' }))).resolves.toEqual({ eligible: true })
    expect(isEligibleToReviewTemplate).toHaveBeenCalledWith(expect.anything(), { templateId: 't1', versionId: 'v1', uid: 'teacher-a' })
  })
})

describe('submitTemplateReviewCallable', () => {
  const auth = { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }
  const makeRequest = (data: Record<string, unknown>) => ({ auth, data, rawRequest: {} } as unknown as CallableRequest)

  beforeEach(() => { vi.clearAllMocks() })

  it('rejects ratings outside 1-5', async () => {
    await expect(submitTemplateReviewCallable.run(makeRequest({
      templateId: 't1', versionId: 'v1', clarityRating: 0, easeOfImplementationRating: 3, studentResponseRating: 3,
    }))).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(submitTemplateReview).not.toHaveBeenCalled()
  })

  it('translates the pure layer\'s not-eligible error into permission-denied', async () => {
    vi.mocked(submitTemplateReview).mockRejectedValue(new Error('Not eligible to review this template version'))
    await expect(submitTemplateReviewCallable.run(makeRequest({
      templateId: 't1', versionId: 'v1', clarityRating: 3, easeOfImplementationRating: 3, studentResponseRating: 3,
    }))).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('submits a valid review, defaulting comment to null', async () => {
    vi.mocked(submitTemplateReview).mockResolvedValue(undefined)
    await expect(submitTemplateReviewCallable.run(makeRequest({
      templateId: 't1', versionId: 'v1', clarityRating: 5, easeOfImplementationRating: 4, studentResponseRating: 3,
    }))).resolves.toEqual({ submitted: true })
    expect(submitTemplateReview).toHaveBeenCalledWith(expect.anything(), {
      templateId: 't1', versionId: 'v1', uid: 'teacher-a',
      clarityRating: 5, easeOfImplementationRating: 4, studentResponseRating: 3, comment: null,
    })
  })
})

describe('listTemplateReviewsCallable', () => {
  const auth = { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }
  const makeRequest = (data: Record<string, unknown>) => ({ auth, data, rawRequest: {} } as unknown as CallableRequest)

  beforeEach(() => { vi.clearAllMocks() })

  it('returns the review list', async () => {
    vi.mocked(listTemplateReviews).mockResolvedValue([{ comment: 'よかった' }])
    await expect(listTemplateReviewsCallable.run(makeRequest({ templateId: 't1', versionId: 'v1' }))).resolves.toEqual([{ comment: 'よかった' }])
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/onCall.test.ts`
Expected: FAIL(3つのCallableが存在しない)。

- [ ] **Step 3: `onCall.ts`に実装を追加する**

冒頭のimportに追記する。

```ts
import { getTemplateReviewDepsWithAdminSdk, isEligibleToReviewTemplate, listTemplateReviews, submitTemplateReview } from './templateReviews'
```

ファイル末尾に追記する。

```ts
interface CanReviewTemplateCallableInput { templateId?: unknown; versionId?: unknown }

export const canReviewTemplateCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as CanReviewTemplateCallableInput
  if (typeof data.templateId !== 'string' || typeof data.versionId !== 'string') throw new HttpsError('invalid-argument', 'リクエストが不正です。')

  const eligible = await isEligibleToReviewTemplate(getTemplateReviewDepsWithAdminSdk(), { templateId: data.templateId, versionId: data.versionId, uid: request.auth.uid })
  return { eligible }
})

interface SubmitTemplateReviewCallableInput {
  templateId?: unknown; versionId?: unknown
  clarityRating?: unknown; easeOfImplementationRating?: unknown; studentResponseRating?: unknown
  comment?: unknown
}
const isValidRating = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5

export const submitTemplateReviewCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as SubmitTemplateReviewCallableInput
  if (
    typeof data.templateId !== 'string' || typeof data.versionId !== 'string'
    || !isValidRating(data.clarityRating) || !isValidRating(data.easeOfImplementationRating) || !isValidRating(data.studentResponseRating)
    || (data.comment !== undefined && typeof data.comment !== 'string')
  ) {
    throw new HttpsError('invalid-argument', 'リクエストが不正です。')
  }

  try {
    await submitTemplateReview(getTemplateReviewDepsWithAdminSdk(), {
      templateId: data.templateId, versionId: data.versionId, uid: request.auth.uid,
      clarityRating: data.clarityRating, easeOfImplementationRating: data.easeOfImplementationRating, studentResponseRating: data.studentResponseRating,
      comment: (data.comment as string | undefined) ?? null,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Not eligible to review this template version') {
      throw new HttpsError('permission-denied', 'この教材を実際に授業で使用した教師のみレビューできます。')
    }
    throw error
  }
  return { submitted: true }
})

interface ListTemplateReviewsCallableInput { templateId?: unknown; versionId?: unknown }

export const listTemplateReviewsCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as ListTemplateReviewsCallableInput
  if (typeof data.templateId !== 'string' || typeof data.versionId !== 'string') throw new HttpsError('invalid-argument', 'リクエストが不正です。')

  return listTemplateReviews(getTemplateReviewDepsWithAdminSdk(), data.versionId)
})
```

- [ ] **Step 4: `functions/src/index.ts`にエクスポートを追加する**

既存の以下のブロックを:

```ts
export {
  createTemplateShareCallable, duplicateLessonTemplateCallable, grantOperatorCallable, listPendingTemplateReportsCallable,
  publishLessonVersionCallable, publishTemplateToCommunityCallable, reportTemplateCallable, resolveTemplateReportCallable,
  resolveTemplateShareCallable, revokeTemplateShareCallable, unpublishTemplateFromCommunityCallable,
} from './lessonTemplates/onCall'
```

以下に置き換える。

```ts
export {
  canReviewTemplateCallable, createTemplateShareCallable, duplicateLessonTemplateCallable, grantOperatorCallable,
  listPendingTemplateReportsCallable, listTemplateReviewsCallable, publishLessonVersionCallable, publishTemplateToCommunityCallable,
  reportTemplateCallable, resolveTemplateReportCallable, resolveTemplateShareCallable, revokeTemplateShareCallable,
  submitTemplateReviewCallable, unpublishTemplateFromCommunityCallable,
} from './lessonTemplates/onCall'
```

- [ ] **Step 5: テストを実行して成功を確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/onCall.test.ts`
Expected: 全件PASS。

- [ ] **Step 6: 型チェックとfunctions全体のテストを実行する**

Run: `cd functions && npx tsc --noEmit && npx vitest run`
Expected: エラーなし、全テストPASS。

- [ ] **Step 7: コミット**

```bash
git add functions/src/lessonTemplates/onCall.ts functions/src/lessonTemplates/onCall.test.ts functions/src/index.ts
git commit -m "feat: レビューの資格確認・投稿・一覧Callableを追加する"
```

---

### Task 4: Firestoreセキュリティルールを追加する

**Files:**
- Modify: `firestore.rules`
- Modify: `test/firestore.rules.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `templateReviews/{reviewId}`の読み書き制御

- [ ] **Step 1: 失敗するテストを書く**

`test/firestore.rules.test.ts`の`describe('templateReports/{reportId}', ...)`ブロックの直後に追記する。

```ts
describe('templateReviews/{reviewId}', () => {
  it('declares an explicit deny rule for the template reviews collection', () => {
    const rules = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8')
    expect(rules).toMatch(
      /match \/templateReviews\/\{reviewId\} \{[\s\S]*?allow read, write: if false;[\s\S]*?\}/,
    )
  })

  it('denies all direct client reads and writes', async () => {
    const context = environment.authenticatedContext('teacher-a', teacherToken)
    const review = doc(context.firestore(), 'templateReviews/version-1_teacher-a')
    await assertFails(getDoc(review))
    await assertFails(setDoc(review, { clarityRating: 5 }))
  })
})
```

- [ ] **Step 2: ルールテストを実行して失敗を確認する**

Run: `npx firebase emulators:exec --project demo-stock-league-classroom --only firestore,database,storage "npx vitest --config vite.rules.config.ts run test/firestore.rules.test.ts"`
Expected: FAIL(`templateReviews`にマッチする明示ルールがまだ存在しない)。

- [ ] **Step 3: `firestore.rules`にルールを追加する**

`firestore.rules`の`match /templateReports/{reportId} { allow read, write: if false; }`の直後に追記する。

```
    match /templateReviews/{reviewId} { allow read, write: if false; }
```

- [ ] **Step 4: ルールテストを実行して成功を確認する**

Run: `npx firebase emulators:exec --project demo-stock-league-classroom --only firestore,database,storage "npx vitest --config vite.rules.config.ts run test/firestore.rules.test.ts"`
Expected: 全件PASS。

- [ ] **Step 5: コミット**

```bash
git add firestore.rules test/firestore.rules.test.ts
git commit -m "feat: templateReviewsのFirestoreルールを追加する"
```

---

### Task 5: 教材詳細ページとルートを追加する

**Files:**
- Create: `src/lib/lessonTemplates/templateReviews.ts`
- Create: `src/components/teacher/templates/CommunityTemplateDetailPage.tsx`
- Test: `src/components/teacher/templates/CommunityTemplateDetailPage.test.tsx`
- Modify: `src/components/teacher/templates/CommunityTemplatesPage.tsx`
- Modify: `src/components/teacher/templates/CommunityTemplatesPage.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: Task 3の`canReviewTemplateCallable`/`submitTemplateReviewCallable`/`listTemplateReviewsCallable`(Callable名)
- Produces: `/teacher/marketplace/:templateId`ルート

- [ ] **Step 1: クライアントlibを実装する(Callableの薄いラッパー)**

`src/lib/lessonTemplates/templateReviews.ts`を新規作成する。

```ts
import { httpsCallable, type Functions } from 'firebase/functions'

export interface CanReviewTemplateInput { templateId: string; versionId: string }
export const canReviewTemplate = async (functions: Functions, input: CanReviewTemplateInput): Promise<{ eligible: boolean }> =>
  (await httpsCallable<CanReviewTemplateInput, { eligible: boolean }>(functions, 'canReviewTemplateCallable')(input)).data

export interface SubmitTemplateReviewInput {
  templateId: string; versionId: string
  clarityRating: number; easeOfImplementationRating: number; studentResponseRating: number
  comment?: string
}
export const submitTemplateReview = async (functions: Functions, input: SubmitTemplateReviewInput): Promise<{ submitted: true }> =>
  (await httpsCallable<SubmitTemplateReviewInput, { submitted: true }>(functions, 'submitTemplateReviewCallable')(input)).data

export interface TemplateReview {
  templateId: string; versionId: string; reviewedByUid: string
  clarityRating: number; easeOfImplementationRating: number; studentResponseRating: number
  comment: string | null
}
export interface ListTemplateReviewsInput { templateId: string; versionId: string }
export const listTemplateReviews = async (functions: Functions, input: ListTemplateReviewsInput): Promise<TemplateReview[]> =>
  (await httpsCallable<ListTemplateReviewsInput, TemplateReview[]>(functions, 'listTemplateReviewsCallable')(input)).data
```

- [ ] **Step 2: 失敗するコンポーネントテストを書く**

`src/components/teacher/templates/CommunityTemplateDetailPage.test.tsx`を新規作成する。

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommunityTemplateDetailPage } from './CommunityTemplateDetailPage'

const template = {
  id: 't1', title: '公民の授業', description: '説明', subject: 'SOCIAL_STUDIES' as const, currentPublishedVersionId: 'v1',
  reviewCount: 2, averageClarityRating: 4, averageEaseOfImplementationRating: 3.5, averageStudentResponseRating: 5,
}
const reviews = [{ templateId: 't1', versionId: 'v1', reviewedByUid: 'teacher-x', clarityRating: 4, easeOfImplementationRating: 3, studentResponseRating: 5, comment: 'とても分かりやすかった' }]

describe('CommunityTemplateDetailPage', () => {
  it('shows aggregate ratings and review comments', () => {
    render(<CommunityTemplateDetailPage template={template} reviews={reviews} loading={false} eligible={false} onSubmitReview={vi.fn()} />)
    expect(screen.getByText('公民の授業')).toBeInTheDocument()
    expect(screen.getByText('とても分かりやすかった')).toBeInTheDocument()
  })

  it('hides the review form when not eligible', () => {
    render(<CommunityTemplateDetailPage template={template} reviews={reviews} loading={false} eligible={false} onSubmitReview={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'レビューを送信' })).not.toBeInTheDocument()
  })

  it('submits a review when eligible', () => {
    const onSubmitReview = vi.fn()
    render(<CommunityTemplateDetailPage template={template} reviews={reviews} loading={false} eligible onSubmitReview={onSubmitReview} />)
    fireEvent.click(screen.getByRole('button', { name: 'レビューを送信' }))
    expect(onSubmitReview).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: テストを実行して失敗を確認する**

Run: `npx vitest run src/components/teacher/templates/CommunityTemplateDetailPage.test.tsx`
Expected: FAIL(`./CommunityTemplateDetailPage`モジュールが存在しない)。

- [ ] **Step 4: コンポーネントを実装する**

`src/components/teacher/templates/CommunityTemplateDetailPage.tsx`を新規作成する。

```tsx
import { useState } from 'react'
import { Button, List, ListItem, ListItemText, Rating, Stack, TextField, Typography } from '@mui/material'
import type { CommunityTemplate } from '../../../lib/lessonTemplates/communityTemplates'
import type { TemplateReview } from '../../../lib/lessonTemplates/templateReviews'

export interface CommunityTemplateDetailPageProps {
  template: CommunityTemplate & { reviewCount: number; averageClarityRating: number; averageEaseOfImplementationRating: number; averageStudentResponseRating: number }
  reviews: TemplateReview[]
  loading: boolean
  eligible: boolean
  onSubmitReview: (input: { clarityRating: number; easeOfImplementationRating: number; studentResponseRating: number; comment: string }) => void
}

export function CommunityTemplateDetailPage({ template, reviews, eligible, onSubmitReview }: CommunityTemplateDetailPageProps) {
  const [clarityRating, setClarityRating] = useState(5)
  const [easeOfImplementationRating, setEaseOfImplementationRating] = useState(5)
  const [studentResponseRating, setStudentResponseRating] = useState(5)
  const [comment, setComment] = useState('')
  return <Stack spacing={2} sx={{ p: 2 }}>
    <Typography variant="h5">{template.title}</Typography>
    <Typography color="text.secondary">{template.description}</Typography>
    <Typography variant="body2">評価({template.reviewCount}件): 分かりやすさ {template.averageClarityRating.toFixed(1)} / 実施のしやすさ {template.averageEaseOfImplementationRating.toFixed(1)} / 生徒の反応 {template.averageStudentResponseRating.toFixed(1)}</Typography>
    {eligible && <Stack spacing={1}>
      <Typography variant="subtitle2">レビューを投稿</Typography>
      <Rating value={clarityRating} onChange={(_event, value) => setClarityRating(value ?? 5)} />
      <Rating value={easeOfImplementationRating} onChange={(_event, value) => setEaseOfImplementationRating(value ?? 5)} />
      <Rating value={studentResponseRating} onChange={(_event, value) => setStudentResponseRating(value ?? 5)} />
      <TextField label="コメント(任意)" value={comment} onChange={(event) => setComment(event.target.value)} multiline minRows={2} />
      <Button variant="contained" onClick={() => onSubmitReview({ clarityRating, easeOfImplementationRating, studentResponseRating, comment })} sx={{ alignSelf: 'flex-start' }}>レビューを送信</Button>
    </Stack>}
    <List>{reviews.map((review, index) => <ListItem key={index}><ListItemText primary={`分かりやすさ${review.clarityRating} / 実施のしやすさ${review.easeOfImplementationRating} / 生徒の反応${review.studentResponseRating}`} secondary={review.comment} /></ListItem>)}</List>
  </Stack>
}
```

- [ ] **Step 5: テストを実行して成功を確認する**

Run: `npx vitest run src/components/teacher/templates/CommunityTemplateDetailPage.test.tsx`
Expected: 全件PASS。

- [ ] **Step 6: `CommunityTemplatesPage`の各行タイトルを詳細ページへのリンクにする**

`src/components/teacher/templates/CommunityTemplatesPage.tsx`の`CommunityTemplatesPageProps`に1行追加する。

```ts
  onOpenDetail: (template: CommunityTemplate) => void
```

`export function CommunityTemplatesPage({ templates, loading, subject, onSubjectChange, onDuplicate, onReport }: CommunityTemplatesPageProps) {`を以下に置き換える。

```ts
export function CommunityTemplatesPage({ templates, loading, subject, onSubjectChange, onDuplicate, onReport, onOpenDetail }: CommunityTemplatesPageProps) {
```

`<ListItemText primary={template.title} secondary={template.description} />`を以下に置き換える(タイトルをリンクにする)。

```tsx
<ListItemText primary={<Button variant="text" onClick={() => onOpenDetail(template)} sx={{ p: 0, textTransform: 'none' }}>{template.title}</Button>} secondary={template.description} />
```

`src/components/teacher/templates/CommunityTemplatesPage.test.tsx`の既存4件のテストの`render(...)`呼び出しに`onOpenDetail={vi.fn()}`を追加する。

- [ ] **Step 7: `App.tsx`にルートを追加する**

`import { OperatorReportsPage } from './components/operator/OperatorReportsPage'`の直後に追記する。

```ts
import { CommunityTemplateDetailPage } from './components/teacher/templates/CommunityTemplateDetailPage'
import { canReviewTemplate, listTemplateReviews as listTemplateReviewsClient, submitTemplateReview as submitTemplateReviewClient, type TemplateReview } from './lib/lessonTemplates/templateReviews'
```

`CommunityMarketplaceRoute`関数を修正し`onOpenDetail`propを追加する(`onReport={...}`の直後)。

```tsx
    onOpenDetail={(template) => navigate(`/teacher/marketplace/${template.id}`)}
```

(`CommunityMarketplaceRoute`は現在`navigate`を使っていないため、関数冒頭に`const navigate = useNavigate()`を追加する。)

`CommunityMarketplaceRoute`関数の直後に新しいRoute関数を追加する。

```tsx
function CommunityTemplateDetailRoute({ services }: { services: FirebaseServices }) {
  const { templateId } = useParams<{ templateId: string }>()
  const [template, setTemplate] = useState<CommunityTemplateDetailPageProps['template']>()
  const [reviews, setReviews] = useState<TemplateReview[]>([])
  const [eligible, setEligible] = useState(false)
  const [loading, setLoading] = useState(true)
  const load = () => {
    if (!templateId) return
    setLoading(true)
    getDoc(doc(services.firestore, 'lessonTemplates', templateId)).then((snapshot) => {
      if (!snapshot.exists()) return
      const data = snapshot.data() as CommunityTemplateDetailPageProps['template']
      setTemplate(data)
      void listTemplateReviewsClient(services.functions, { templateId, versionId: data.currentPublishedVersionId }).then(setReviews)
      void canReviewTemplate(services.functions, { templateId, versionId: data.currentPublishedVersionId }).then((result) => setEligible(result.eligible))
    }).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [services, templateId])
  if (!template) return <GuardLoading />
  return <CommunityTemplateDetailPage
    template={template} reviews={reviews} loading={loading} eligible={eligible}
    onSubmitReview={(input) => {
      if (!templateId) return
      void submitTemplateReviewClient(services.functions, { templateId, versionId: template.currentPublishedVersionId, ...input }).then(load)
    }}
  />
}
```

(この関数が使う`CommunityTemplateDetailPageProps`型を`import type { CommunityTemplateDetailPageProps } from './components/teacher/templates/CommunityTemplateDetailPage'`として上記のimport群に追加する。)

`<Route path="/teacher/marketplace" .../>`の直後に追記する。

```tsx
  <Route path="/teacher/marketplace/:templateId" element={enabled && services ? <TemplateRouteGuard services={services}><CommunityTemplateDetailRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
```

- [ ] **Step 8: プロジェクト全体の型チェックとテストを実行する**

Run: `npx tsc -b && npx tsc -p tsconfig.rules.json && npx vitest run`
Expected: エラーなし、全テストPASS。

- [ ] **Step 9: コミット**

```bash
git add src/lib/lessonTemplates/templateReviews.ts src/components/teacher/templates/CommunityTemplateDetailPage.tsx src/components/teacher/templates/CommunityTemplateDetailPage.test.tsx src/components/teacher/templates/CommunityTemplatesPage.tsx src/components/teacher/templates/CommunityTemplatesPage.test.tsx src/App.tsx
git commit -m "feat: 教材詳細ページ(集計評価・レビュー一覧・投稿)とルートを追加する"
```
