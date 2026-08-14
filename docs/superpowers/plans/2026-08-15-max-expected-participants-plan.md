# maxParticipants/expectedParticipants分離 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LessonRun作成時に、サービス全体で固定の`maxParticipants`(80)と教師が入力する`expectedParticipants`を分離して書き込み、既存の(これまで常に無効だった)`joinLessonRun.ts`の定員チェックを実際に機能させる。

**Architecture:** `createLessonRun`のトランザクションに`MAX_PARTICIPANTS`定数を追加し、LessonRunドキュメント作成時に`maxParticipants: 80`と`expectedParticipants`(deps経由)を書き込む。バリデーション(1〜80の整数)は`createLessonRunCallable`(Callable層)で行い、トランザクション本体には持ち込まない。クライアント側`createLessonRun`ラッパーにも入力を追加する。

**Tech Stack:** Firebase Cloud Functions (TypeScript)、Vitest。

## Global Constraints

- 正本: `docs/superpowers/specs/2026-08-15-max-expected-participants-design.md`。矛盾があれば正本を優先する。
- `MAX_PARTICIPANTS = 80`はプランに関係なく全組織共通(仕様上、変えるのは同時開催数であって定員ではない)。
- `expectedParticipants`が範囲外(1未満・80超・非整数・未指定)の場合は作成を`invalid-argument`で拒否する。クランプはしない。
- `functions/src/lessonRuns/createLessonRun.ts`の`CreateLessonRunDeps.expectedParticipants`は型としては**オプション**にする(既存の`createLessonRun.test.ts`内の約25箇所の呼び出しを一括変更しないため)。実際の必須チェックはCallable層(`onCall.ts`)が担う。

---

### Task 1: `createLessonRun`にmaxParticipants/expectedParticipantsの書き込みを追加する

**Files:**
- Modify: `functions/src/lessonRuns/createLessonRun.ts`
- Test: `functions/src/lessonRuns/createLessonRun.test.ts`

**Interfaces:**
- Produces: `export const MAX_PARTICIPANTS = 80`(Task 2が参照する)。`CreateLessonRunDeps.expectedParticipants?: number`(Task 2の`createLessonRunWithAdminSdk`呼び出しがこれを渡す)。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonRuns/createLessonRun.test.ts`の`describe('createLessonRun', ...)`ブロック内、既存の最初のテスト(`'fixes the template snapshot and generates a randomSeed the caller never supplies'`)の直後に追記する。

```ts
  it('writes the fixed service-wide maxParticipants alongside the caller-provided expectedParticipants', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-1', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1' })
    fake.docs.set('lessonTemplates/tpl-1/versions/v1', { templateId: 'tpl-1', orgId: 'personal_teacher-a', content: { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES' } })
    const result = await createLessonRun({
      firestore: fake as never,
      generateRandomSeed: () => 'fixed-test-seed',
      generateLessonRunId: () => 'run-fixed',
      lessonRunIdempotencyKey: 'idem-2',
      orgId: 'personal_teacher-a', templateId: 'tpl-1', primaryTeacherUid: 'teacher-a',
      expectedParticipants: 42,
    })
    const run = fake.docs.get(`lessonRuns/${result.lessonRunId}`)
    expect(run).toMatchObject({ maxParticipants: 80, expectedParticipants: 42 })
  })
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/lessonRuns/createLessonRun.test.ts`
Expected: FAIL(`expectedParticipants`が`CreateLessonRunDeps`型に存在しないため型エラー、または実行時に`run`が`{ maxParticipants: 80, expectedParticipants: 42 }`を含まない)。

- [ ] **Step 3: 実装を追加する**

`functions/src/lessonRuns/createLessonRun.ts`の`export interface CreateLessonRunResult { lessonRunId: string; created: boolean }`の直前に定数を追加する。

```ts
/** 全プラン共通のサービス上限。プランで変えるのは同時開催数(concurrentLessonsAndMarkets)であり、これではない。 */
export const MAX_PARTICIPANTS = 80
```

`CreateLessonRunDeps`インターフェースに1行追加する(`now?: () => unknown`の直後)。

```ts
export interface CreateLessonRunDeps {
  firestore: { runTransaction: (fn: (tx: FirestoreTx) => Promise<string>) => Promise<string> }
  generateRandomSeed: () => string
  generateLessonRunId: () => string
  lessonRunIdempotencyKey: string
  orgId: string
  templateId: string
  primaryTeacherUid: string
  getDowngradeStatus?: (orgId: string) => Promise<DowngradeStatus>
  now?: () => unknown
  expectedParticipants?: number
}
```

`tx.set(\`lessonRuns/${lessonRunId}\`, {...})`の書き込みフィールドに2行追加する(`startedAt: null, endedAt: null, createdAt: nowValue,`の直後)。

```ts
    tx.set(`lessonRuns/${lessonRunId}`, {
      orgId: deps.orgId, templateId: deps.templateId, templateVersionId: template.currentPublishedVersionId,
      templateSnapshot: version.content, subject: (version.content as { subject: string }).subject,
      status: 'DRAFT', primaryTeacherUid: deps.primaryTeacherUid, teacherRoles: { [deps.primaryTeacherUid]: 'PRIMARY' },
      currentPhaseId: null, randomSeed, restoreGeneration: 0,
      startedAt: null, endedAt: null, createdAt: nowValue,
      maxParticipants: MAX_PARTICIPANTS, expectedParticipants: deps.expectedParticipants ?? null,
    })
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `cd functions && npx vitest run src/lessonRuns/createLessonRun.test.ts`
Expected: 全件PASS(新規1件 + 既存の全ケース)。

- [ ] **Step 5: 型チェックを実行する**

Run: `cd functions && npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 6: コミット**

```bash
git add functions/src/lessonRuns/createLessonRun.ts functions/src/lessonRuns/createLessonRun.test.ts
git commit -m "feat: LessonRun作成時にmaxParticipants/expectedParticipantsを書き込む"
```

---

### Task 2: Callable層で`expectedParticipants`を検証し配線する

**Files:**
- Modify: `functions/src/lessonRuns/onCall.ts`
- Modify: `functions/src/lessonRuns/createLessonRun.ts`(`createLessonRunWithAdminSdk`の入力型のみ)
- Test: `functions/src/lessonRuns/onCall.test.ts`

**Interfaces:**
- Consumes: Task 1の`MAX_PARTICIPANTS`定数、`CreateLessonRunDeps.expectedParticipants`
- Produces: `CreateLessonRunRequest`に`expectedParticipants: unknown`を追加(既存のフロント連携で使う型はTask 3が更新する)

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonRuns/onCall.test.ts`の`makeRequest`を以下に置き換える(`expectedParticipants`を既定値として含める。これにより既存の全テストが型・実行の両面で壊れない)。

```ts
const makeRequest = (uid = 'teacher-a'): CallableRequest<CreateLessonRunRequest> => ({
  auth: {
    uid,
    token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } },
  },
  data: { templateId: 'template-1', lessonRunIdempotencyKey: 'key-1', expectedParticipants: 30 },
  rawRequest: {},
} as unknown as CallableRequest<CreateLessonRunRequest>)
```

75行目付近の`expect(createLessonRunWithAdminSdk).toHaveBeenCalledWith({...})`を以下に置き換える。

```ts
    expect(createLessonRunWithAdminSdk).toHaveBeenCalledWith({
      orgId: 'personal_teacher-a', templateId: 'template-1',
      primaryTeacherUid: 'teacher-a', lessonRunIdempotencyKey: 'key-1', expectedParticipants: 30,
    })
```

92行目付近の同様の箇所も同じ形で`expectedParticipants: 30`を追加する。

```ts
    expect(createLessonRunWithAdminSdk).toHaveBeenCalledWith({
      orgId: 'school-1', templateId: 'template-1',
      primaryTeacherUid: 'teacher-b', lessonRunIdempotencyKey: 'key-1', expectedParticipants: 30,
    })
```

`describe('createLessonRunCallable', ...)`ブロックの末尾(既存ケースの最後、次の`describe`の直前)に以下を追記する。

```ts
  it('rejects expectedParticipants that is missing, non-integer, below 1, or above the 80-seat service cap', async () => {
    templateGetMock.mockResolvedValue({
      exists: true,
      get: (field: string) => (field === 'orgId' ? 'personal_teacher-a' : undefined),
    })
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'owner', membershipVersion: 1 })

    const withParticipants = (expectedParticipants: unknown): CallableRequest<CreateLessonRunRequest> => ({
      auth: { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } },
      data: { templateId: 'template-1', lessonRunIdempotencyKey: 'key-1', expectedParticipants },
      rawRequest: {},
    } as unknown as CallableRequest<CreateLessonRunRequest>)

    await expect(createLessonRunCallable.run(withParticipants(undefined))).rejects.toMatchObject({ code: 'invalid-argument' })
    await expect(createLessonRunCallable.run(withParticipants(0))).rejects.toMatchObject({ code: 'invalid-argument' })
    await expect(createLessonRunCallable.run(withParticipants(81))).rejects.toMatchObject({ code: 'invalid-argument' })
    await expect(createLessonRunCallable.run(withParticipants(1.5))).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(createLessonRunWithAdminSdk).not.toHaveBeenCalled()
  })

  it('accepts boundary values 1 and 80 for expectedParticipants', async () => {
    templateGetMock.mockResolvedValue({
      exists: true,
      get: (field: string) => (field === 'orgId' ? 'personal_teacher-a' : undefined),
    })
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'owner', membershipVersion: 1 })
    vi.mocked(createLessonRunWithAdminSdk).mockResolvedValue({ lessonRunId: 'run-1', created: true })

    const withParticipants = (expectedParticipants: unknown): CallableRequest<CreateLessonRunRequest> => ({
      auth: { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } },
      data: { templateId: 'template-1', lessonRunIdempotencyKey: 'key-1', expectedParticipants },
      rawRequest: {},
    } as unknown as CallableRequest<CreateLessonRunRequest>)

    await expect(createLessonRunCallable.run(withParticipants(1))).resolves.toEqual({ lessonRunId: 'run-1', created: true })
    await expect(createLessonRunCallable.run(withParticipants(80))).resolves.toEqual({ lessonRunId: 'run-1', created: true })
  })
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/lessonRuns/onCall.test.ts`
Expected: FAIL(現行実装は`expectedParticipants`を検証せず、`createLessonRunWithAdminSdk`にも渡していないため、新規2件が失敗し、更新した2件のアサーションも実引数不一致で失敗する)。

- [ ] **Step 3: `onCall.ts`を修正する**

`functions/src/lessonRuns/onCall.ts`冒頭のimportに`MAX_PARTICIPANTS`を追加する。

```ts
import { createLessonRunWithAdminSdk, MAX_PARTICIPANTS } from './createLessonRun'
```

`interface CreateLessonRunRequest { templateId: string; lessonRunIdempotencyKey: string }`を以下に置き換える。

```ts
interface CreateLessonRunRequest { templateId: string; lessonRunIdempotencyKey: string; expectedParticipants?: unknown }
const isValidExpectedParticipants = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_PARTICIPANTS
```

`createLessonRunCallable`内、既存の`if (!data.templateId || !data.lessonRunIdempotencyKey) throw new HttpsError('invalid-argument', 'templateId と lessonRunIdempotencyKey は必須です。')`の直後に検証を追加する。

```ts
  if (!isValidExpectedParticipants(data.expectedParticipants)) throw new HttpsError('invalid-argument', '想定人数は1〜80の範囲で指定してください。')
```

`createLessonRunWithAdminSdk({...})`の呼び出しに`expectedParticipants`を追加する。

```ts
    return await createLessonRunWithAdminSdk({
      orgId, templateId: data.templateId,
      primaryTeacherUid: request.auth.uid, lessonRunIdempotencyKey: data.lessonRunIdempotencyKey,
      expectedParticipants: data.expectedParticipants,
    })
```

- [ ] **Step 4: `createLessonRunWithAdminSdk`の入力型を更新する**

`functions/src/lessonRuns/createLessonRun.ts`の`createLessonRunWithAdminSdk`シグネチャを以下に置き換える。

```ts
export const createLessonRunWithAdminSdk = (input: {
  orgId: string; templateId: string; primaryTeacherUid: string; lessonRunIdempotencyKey: string; expectedParticipants: number
}): Promise<CreateLessonRunResult> => {
```

同じ関数内の`createLessonRun({...})`呼び出しに`expectedParticipants: input.expectedParticipants`を追加する(既存の`lessonRunIdempotencyKey: input.lessonRunIdempotencyKey,`の直後)。

- [ ] **Step 5: テストを実行して成功を確認する**

Run: `cd functions && npx vitest run src/lessonRuns/onCall.test.ts`
Expected: 全件PASS。

- [ ] **Step 6: 回帰確認として関連テストを実行する**

Run: `cd functions && npx tsc --noEmit && npx vitest run src/lessonRuns`
Expected: `joinLessonRun.test.ts`を含む`lessonRuns`配下の全テストがPASS(既存の`maxParticipants`関連テストはフィクスチャで直接値を指定しているため無変更で通る)。

- [ ] **Step 7: コミット**

```bash
git add functions/src/lessonRuns/onCall.ts functions/src/lessonRuns/onCall.test.ts functions/src/lessonRuns/createLessonRun.ts
git commit -m "feat: createLessonRunCallableでexpectedParticipantsを検証し配線する"
```

---

### Task 3: クライアント側の`createLessonRun`に`expectedParticipants`を追加する

**Files:**
- Modify: `src/lib/lessonRuns/createLessonRun.ts`
- Test: `src/lib/lessonRuns/createLessonRun.test.ts`

**Interfaces:**
- Consumes: なし(Callable呼び出しのみ)
- Produces: `CreateLessonRunInput.expectedParticipants: number`(呼び出し元UIは現時点で存在しないため、他コンポーネントへの影響なし)

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/lessonRuns/createLessonRun.test.ts`を以下に置き換える。

```ts
import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'

// The literal SDK `httpsCallable(functions, name)` reaches into the real
// Functions instance's internals, so a plain fake `functions` object throws
// at runtime — this mocks the module boundary instead of the instance.
const callable = vi.fn().mockResolvedValue({ data: { lessonRunId: 'run-1', created: true } })
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callable) }))

const { httpsCallable } = await import('firebase/functions')
const { createLessonRun } = await import('./createLessonRun')

describe('createLessonRun (client)', () => {
  it('calls the createLessonRunCallable callable with templateId/lessonRunIdempotencyKey/expectedParticipants', async () => {
    const functions = {} as Functions
    const result = await createLessonRun(functions, { templateId: 't1', lessonRunIdempotencyKey: 'key-1', expectedParticipants: 30 })
    expect(result).toEqual({ lessonRunId: 'run-1', created: true })
    expect(httpsCallable).toHaveBeenCalledWith(functions, 'createLessonRunCallable')
    expect(callable).toHaveBeenCalledWith({ templateId: 't1', lessonRunIdempotencyKey: 'key-1', expectedParticipants: 30 })
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run src/lib/lessonRuns/createLessonRun.test.ts`
Expected: FAIL(型エラー: `CreateLessonRunInput`に`expectedParticipants`が存在しない)。

- [ ] **Step 3: 実装を追加する**

`src/lib/lessonRuns/createLessonRun.ts`の`CreateLessonRunInput`を以下に置き換える。

```ts
export interface CreateLessonRunInput {
  templateId: string
  lessonRunIdempotencyKey: string
  expectedParticipants: number
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `npx vitest run src/lib/lessonRuns/createLessonRun.test.ts`
Expected: PASS。

- [ ] **Step 5: プロジェクト全体の型チェックとテストを実行する**

Run: `npx tsc -b && npx tsc -p tsconfig.rules.json && npx vitest run`
Expected: エラーなし、全テストPASS。

- [ ] **Step 6: コミット**

```bash
git add src/lib/lessonRuns/createLessonRun.ts src/lib/lessonRuns/createLessonRun.test.ts
git commit -m "feat: クライアント側createLessonRunにexpectedParticipantsを追加する"
```
