# 作成時の利用枠確保(同時授業・市場数) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**正本:** `docs/superpowers/specs/2026-08-09-concurrent-lesson-quota-design.md`(設計仕様)。矛盾する場合は仕様書を優先する。

**Goal:** 授業・市場作成時に、組織のプランが定める`concurrentLessonsAndMarkets`上限を実際に強制する。

**Architecture:** `createLessonRun`(`functions/src/lessonRuns/createLessonRun.ts`)の既存トランザクション内に、新規`lessonRuns`ドキュメント作成の直前でカウント確認を追加する。別段階の仮確保/返却処理は導入しない——トランザクションの原子性がその役割を代替する。

**Tech Stack:** TypeScript, Firebase Cloud Functions v2 (`onCall`), Firebase Admin SDK (Firestore Transaction + Query)、Vitest。

## Global Constraints

- 本計画は**Phase Fサブプロジェクト2(プラン・利用枠の土台)の完了を前提とする**(`organizations/{orgId}.planId`・`planDefinitions/{planId}.limits`が既に存在する、2026-08-09時点で実装済み)。
- 強制するのは`concurrentLessonsAndMarkets`の1軸のみ。他の制限軸は対象外。
- `planId`未設定・`planDefinitions`不在の組織は明示的にエラーとする(無制限扱いにしない)。
- 既存の`createLessonRun`のトランザクション内「すべての読み取りの後にすべての書き込み」という順序規律を維持する。新しい読み取り(組織・プラン定義・件数クエリ)は既存の`tx.set()`呼び出しより前に置く。
- 各タスクの実装後、そのタスクが変更したファイルのテストを実行してから次のタスクに進む。全タスク完了後、`npm run verify`を実行し、通過することを確認してからコミットする。

---

## File Structure

| File | Change |
| --- | --- |
| `functions/src/lessonRuns/createLessonRun.ts`, `.test.ts` | Modify（Task 1） |
| `firestore.indexes.json`（新規）、`firebase.json` | Modify（Task 2） |
| `functions/src/lessonRuns/onCall.ts`, `.test.ts` | Modify（Task 3） |

---

### Task 1: `createLessonRun`にプラン上限の確認を追加する

**Files:**
- Modify: `functions/src/lessonRuns/createLessonRun.ts`
- Modify: `functions/src/lessonRuns/createLessonRun.test.ts`

**Interfaces:**
- Consumes: なし（`organizations/{orgId}`・`planDefinitions/{planId}`ドキュメントを直接読む）。
- Produces: `createLessonRun`が上限到達時に`Error('この組織の同時授業・市場数の上限に達しています')`を、プラン未設定時に`Error('この組織にはプランが設定されていません')`をthrowするようになる。Task 3で消費される。

**設計メモ:** `FirestoreTx`インターフェースに`countActiveLessonRuns: (orgId: string) => Promise<number>`を追加する。既存の`get`/`set`と並ぶ、トランザクション内の第3の読み取り手段——`get`は単一ドキュメント読み取り専用のため、`orgId`+`status in [...]`のクエリ結果件数を返す専用メソッドとして分離する。既存テストの`makeFakeFirestore`は`organizations/personal_teacher-a`と`planDefinitions/FREE`(上限100=既存テストが決して到達しない値)をあらかじめ`docs`へ投入し、`countActiveLessonRuns`はテストごとに設定可能な`Map`から返す——こうすることで既存の全テストケースを変更せずに済む。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonRuns/createLessonRun.test.ts`の`makeFakeFirestore`を以下に置き換える:

```ts
const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  const activeLessonRunCounts = new Map<string, number>()
  docs.set('organizations/personal_teacher-a', { planId: 'FREE' })
  docs.set('planDefinitions/FREE', { limits: { concurrentLessonsAndMarkets: 100 } })
  return {
    docs,
    activeLessonRunCounts,
    runTransaction: async (fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      countActiveLessonRuns: (orgId: string) => Promise<number>
      set: (path: string, data: Record<string, unknown>) => void
    }) => Promise<string>) => fn({
      get: async (path: string) => ({ exists: docs.has(path), data: () => docs.get(path) }),
      countActiveLessonRuns: async (orgId: string) => activeLessonRunCounts.get(orgId) ?? 0,
      set: (path: string, data: Record<string, unknown>) => { docs.set(path, data) },
    }),
  }
}
```

ファイル末尾に以下のテストを追記する:

```ts
describe('createLessonRun quota enforcement', () => {
  it('rejects creation when the active lessonRun count has reached the plan limit', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-1', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1' })
    fake.docs.set('lessonTemplates/tpl-1/versions/v1', { templateId: 'tpl-1', orgId: 'personal_teacher-a', content: { subject: 'SOCIAL_STUDIES' } })
    fake.docs.set('planDefinitions/FREE', { limits: { concurrentLessonsAndMarkets: 2 } })
    fake.activeLessonRunCounts.set('personal_teacher-a', 2)
    await expect(createLessonRun({
      firestore: fake as never, generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-x',
      lessonRunIdempotencyKey: 'idem-quota', orgId: 'personal_teacher-a', templateId: 'tpl-1', primaryTeacherUid: 'teacher-a',
    })).rejects.toThrow('この組織の同時授業・市場数の上限に達しています')
    expect(fake.docs.has('lessonRuns/run-x')).toBe(false)
  })

  it('allows creation when the active count is below the plan limit', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-1', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1' })
    fake.docs.set('lessonTemplates/tpl-1/versions/v1', { templateId: 'tpl-1', orgId: 'personal_teacher-a', content: { subject: 'SOCIAL_STUDIES' } })
    fake.docs.set('planDefinitions/FREE', { limits: { concurrentLessonsAndMarkets: 2 } })
    fake.activeLessonRunCounts.set('personal_teacher-a', 1)
    const result = await createLessonRun({
      firestore: fake as never, generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-y',
      lessonRunIdempotencyKey: 'idem-quota-2', orgId: 'personal_teacher-a', templateId: 'tpl-1', primaryTeacherUid: 'teacher-a',
    })
    expect(result.created).toBe(true)
  })

  it('rejects when the organization has no planId', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('organizations/personal_teacher-a', {})
    fake.docs.set('lessonTemplates/tpl-1', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1' })
    fake.docs.set('lessonTemplates/tpl-1/versions/v1', { templateId: 'tpl-1', orgId: 'personal_teacher-a', content: { subject: 'SOCIAL_STUDIES' } })
    await expect(createLessonRun({
      firestore: fake as never, generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-z',
      lessonRunIdempotencyKey: 'idem-quota-3', orgId: 'personal_teacher-a', templateId: 'tpl-1', primaryTeacherUid: 'teacher-a',
    })).rejects.toThrow('この組織にはプランが設定されていません')
  })

  it('rejects when planDefinitions does not have a matching document', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('organizations/personal_teacher-a', { planId: 'NONEXISTENT' })
    fake.docs.set('lessonTemplates/tpl-1', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1' })
    fake.docs.set('lessonTemplates/tpl-1/versions/v1', { templateId: 'tpl-1', orgId: 'personal_teacher-a', content: { subject: 'SOCIAL_STUDIES' } })
    await expect(createLessonRun({
      firestore: fake as never, generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-w',
      lessonRunIdempotencyKey: 'idem-quota-4', orgId: 'personal_teacher-a', templateId: 'tpl-1', primaryTeacherUid: 'teacher-a',
    })).rejects.toThrow('この組織にはプランが設定されていません')
  })

  it('does not check the quota again for an idempotent retry', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-1', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1' })
    fake.docs.set('lessonTemplates/tpl-1/versions/v1', { templateId: 'tpl-1', orgId: 'personal_teacher-a', content: { subject: 'SOCIAL_STUDIES' } })
    const input = {
      firestore: fake as never, generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-retry',
      lessonRunIdempotencyKey: 'idem-quota-retry', orgId: 'personal_teacher-a', templateId: 'tpl-1', primaryTeacherUid: 'teacher-a',
    }
    const first = await createLessonRun(input)
    fake.docs.set('planDefinitions/FREE', { limits: { concurrentLessonsAndMarkets: 0 } })
    fake.activeLessonRunCounts.set('personal_teacher-a', 1)
    const second = await createLessonRun(input)
    expect(second.lessonRunId).toBe(first.lessonRunId)
    expect(second.created).toBe(false)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/lessonRuns/createLessonRun.test.ts`
Expected: FAIL（新しい`countActiveLessonRuns`が`createLessonRun`から呼ばれておらず、上限確認ロジック自体が存在しない）

- [ ] **Step 3: 実装する**

`functions/src/lessonRuns/createLessonRun.ts`の`FirestoreTx`インターフェースを以下に置き換える:

```ts
export interface FirestoreTx {
  get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
  countActiveLessonRuns: (orgId: string) => Promise<number>
  set: (path: string, data: Record<string, unknown>) => void
}

/** lessonRunsの`status`のうち、まだ市場・教室資源を使用中とみなす値。COMPLETED/ABORTED/ARCHIVEDのみ枠を解放する。 */
export const ACTIVE_LESSON_RUN_STATUSES = ['DRAFT', 'READY', 'WAITING', 'RUNNING', 'PAUSED', 'INTERRUPTED', 'REFLECTION'] as const
```

`createLessonRun`関数内、`const lessonRunId = deps.generateLessonRunId()`の直前に以下を挿入する:

```ts
    const orgSnap = await tx.get(`organizations/${deps.orgId}`)
    const org = orgSnap.exists ? (orgSnap.data() as { planId?: string }) : undefined
    if (!org?.planId) throw new Error('この組織にはプランが設定されていません')
    const planSnap = await tx.get(`planDefinitions/${org.planId}`)
    if (!planSnap.exists) throw new Error('この組織にはプランが設定されていません')
    const plan = planSnap.data() as { limits: { concurrentLessonsAndMarkets: number } }
    const activeCount = await tx.countActiveLessonRuns(deps.orgId)
    if (activeCount >= plan.limits.concurrentLessonsAndMarkets) {
      throw new Error('この組織の同時授業・市場数の上限に達しています')
    }
```

`createLessonRunWithAdminSdk`の`runTransaction`呼び出し内、`get`の直後に以下を追加する:

```ts
        countActiveLessonRuns: async (orgId) => {
          const snap = await tx.get(
            db.collection('lessonRuns').where('orgId', '==', orgId).where('status', 'in', ACTIVE_LESSON_RUN_STATUSES),
          )
          return snap.size
        },
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/lessonRuns/createLessonRun.test.ts`
Expected: PASS（新しいテストも、既存のテストも全て通過する——既存テストは`makeFakeFirestore`が自動的に上限100のプランを投入するため、変更なしで通過し続ける）

- [ ] **Step 5: コミット**

```bash
git add functions/src/lessonRuns/createLessonRun.ts functions/src/lessonRuns/createLessonRun.test.ts
git commit -m "feat: 授業・市場作成時に同時授業・市場数のプラン上限を強制する"
```

---

### Task 2: Firestore複合インデックスの定義

**Files:**
- Create: `firestore.indexes.json`
- Modify: `firebase.json`

**Interfaces:**
- Consumes: なし。
- Produces: `lessonRuns`コレクションの`orgId` ASC + `status` ASC複合インデックス定義。Task 1の`countActiveLessonRuns`クエリが本番で正しく動作するために必要(エミュレータでは未定義でも動作するため、この不足はローカルテストでは検出できない)。

- [ ] **Step 1: (このタスクにはテストがない)**

複合インデックス定義はFirebase CLIのデプロイ時に読み込まれる設定ファイルであり、Vitestで検証できるロジックを持たない。Step 2で内容を直接記述する。

- [ ] **Step 2: 実装する**

```json
// firestore.indexes.json
{
  "indexes": [
    {
      "collectionGroup": "lessonRuns",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "orgId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

`firebase.json`の`"firestore": { "rules": "firestore.rules" }`を以下に置き換える:

```json
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
```

- [ ] **Step 3: JSONとして妥当であることを確認する**

Run: `node -e "JSON.parse(require('fs').readFileSync('firestore.indexes.json', 'utf8')); JSON.parse(require('fs').readFileSync('firebase.json', 'utf8'))"`
Expected: エラーなく終了する(パースエラーが出ないことのみ確認する)

- [ ] **Step 4: コミット**

```bash
git add firestore.indexes.json firebase.json
git commit -m "feat: lessonRunsのorgId+status複合インデックスを追加"
```

---

### Task 3: `createLessonRunCallable`のエラー変換を追加する

**Files:**
- Modify: `functions/src/lessonRuns/onCall.ts`
- Modify: `functions/src/lessonRuns/onCall.test.ts`

**Interfaces:**
- Consumes: `createLessonRun`（Task 1）が投げる新しい2種類のエラーメッセージ。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonRuns/onCall.test.ts`の`describe('createLessonRunCallable', ...)`ブロック内に以下を追記する（既存の`templateGetMock`/`requireActiveOrgMember`のモックをそのまま使う）:

```ts
  it('translates a quota-exceeded error into resource-exhausted', async () => {
    templateGetMock.mockResolvedValueOnce({ exists: true, get: () => 'org-1' })
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(createLessonRunWithAdminSdk).mockRejectedValueOnce(new Error('この組織の同時授業・市場数の上限に達しています'))
    await expect(createLessonRunCallable.run(makeRequest())).rejects.toMatchObject({ code: 'resource-exhausted' })
  })

  it('translates a missing-plan error into failed-precondition', async () => {
    templateGetMock.mockResolvedValueOnce({ exists: true, get: () => 'org-1' })
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(createLessonRunWithAdminSdk).mockRejectedValueOnce(new Error('この組織にはプランが設定されていません'))
    await expect(createLessonRunCallable.run(makeRequest())).rejects.toMatchObject({ code: 'failed-precondition' })
  })
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/lessonRuns/onCall.test.ts`
Expected: FAIL（`translateCreateLessonRunError`がこの2つのメッセージを認識せず、エラーがそのまま素通りする）

- [ ] **Step 3: 実装する**

`functions/src/lessonRuns/onCall.ts`の`translateCreateLessonRunError`関数内、既存の`if`群の末尾に追記する:

```ts
    if (error.message === 'この組織の同時授業・市場数の上限に達しています') return new HttpsError('resource-exhausted', error.message)
    if (error.message === 'この組織にはプランが設定されていません') return new HttpsError('failed-precondition', error.message)
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/lessonRuns/onCall.test.ts`
Expected: PASS

- [ ] **Step 5: モノレポ全体を検証する**

Run: `npm run verify`
Expected: 全ワークスペースのlint/typecheck/test/buildが通過する

- [ ] **Step 6: コミット**

```bash
git add functions/src/lessonRuns/onCall.ts functions/src/lessonRuns/onCall.test.ts
git commit -m "feat: createLessonRunCallableに利用枠関連エラーの変換を追加"
```
