# AI Lesson Studio Core + Lesson Draft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**正本:** `docs/superpowers/specs/2026-08-09-ai-lesson-studio-core-design.md`（設計仕様）。矛盾する場合は仕様書を優先する。

**Goal:** プロバイダ非依存のAI呼び出し基盤（未設定でも他機能に影響しない）と、Guided Builderウィザードへ統合した「AI提案」による授業案作成機能を実装する。

**Architecture:** `LlmProvider`インターフェース＋`UnconfiguredLlmProvider`（実プロバイダは別途選定）を土台に、組織単位の`aiEnabled`トグル確認・PIIフィルタ通過・利用ログ記録を経てAIを呼び、結果は既存の§14.4確認ページを必ず経由させてから教材として作成する。

**Tech Stack:** TypeScript, React, Firebase Cloud Functions v2 (`onCall`), Firebase Admin SDK (Firestore), Vitest, React Testing Library。

## Global Constraints

- **実AIプロバイダは選定されていない。** `LlmProvider`インターフェースと`UnconfiguredLlmProvider`（呼ぶと明確なエラーを返す）のみを実装する。実プロバイダの実装は本計画の対象外。
- 組織単位の`aiEnabled`トグルを**設定するUI**は本計画のスコープ外（設計仕様が明記）。v1では`organizations/{orgId}`ドキュメントの`aiEnabled`フィールドを直接（Firebaseコンソール等で）設定する運用とする。既定値は未設定＝`false`扱いとし、`organizations/`ドキュメント作成トランザクション（`ensurePersonalOrgWithAdminSdk`）は変更しない。
- AIの出力は**Firestoreへ一切書き込まない**。既存の§14.4確認ページ（`TemplateOverviewPage`）を必ず経由させ、教師が明示的に「この内容で作成」を押した時点で初めて`createLessonTemplate`が呼ばれる（既存の仕組みをそのまま使う——新しい確認ゲートは作らない）。
- 利用枠のハード上限・原価集計・緊急停止は本計画のスコープ外。`organizations/{orgId}/aiUsageLog/{logId}`への記録のみ行う。
- 新規Callableは`functions/src/index.ts`からexportする。
- 認可は`isCallerTeacher`（既存、`functions/src/organizations/onCall.ts`）を再利用する。新しい認可ロジックは書かない。
- 日本語UI文言を用いる（既存コンポーネントの慣例）。

---

## File Structure

| File | Change |
| --- | --- |
| `functions/src/ai/llmProvider.ts`, `.test.ts` | Create（Task 1） |
| `functions/src/ai/piiFilter.ts`, `.test.ts` | Create（Task 2） |
| `functions/src/ai/lessonDraftPrompt.ts`, `.test.ts` | Create（Task 3。プロンプト整形・AI応答パース） |
| `functions/src/ai/onCall.ts`, `.test.ts` | Create（Task 4。`generateLessonDraftCallable`） |
| `functions/src/index.ts` | Modify（Task 4。export追加） |
| `firestore.rules` | Modify（Task 4。`aiUsageLog`への明示的な拒否ルール） |
| `src/lib/ai/generateLessonDraft.ts`, `.test.ts` | Create（Task 5。クライアントラッパー） |
| `src/components/teacher/templates/TemplateOverviewPage.tsx`, `.test.tsx` | Modify（Task 6。「AI提案」カード追加） |

---

## タスク一覧

1. `LlmProvider`インターフェースと`UnconfiguredLlmProvider`
2. PII送信フィルタ
3. プロンプト整形・AI応答パース
4. `generateLessonDraftCallable`（Callable本体・認可・利用ログ・ルール・index.ts export）
5. クライアント側Callableラッパー
6. `TemplateOverviewPage`への「AI提案」統合

---

### Task 1: `LlmProvider`インターフェースと`UnconfiguredLlmProvider`

AI呼び出しのプロバイダ非依存インターフェースを定義する。実プロバイダは未選定のため、呼ぶと明確なエラーを返す実装のみを提供する。これにより「AI未設定でも他の全機能は無傷」という設計仕様の要件を満たす。

**Files:**
- Create: `functions/src/ai/llmProvider.ts`, `.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `LlmProvider`型、`unconfiguredLlmProvider: LlmProvider`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/ai/llmProvider.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { unconfiguredLlmProvider } from './llmProvider'

describe('unconfiguredLlmProvider', () => {
  it('rejects with a clear, actionable error rather than silently returning empty text', async () => {
    await expect(unconfiguredLlmProvider.generateText('any prompt')).rejects.toThrow('AI provider is not configured.')
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/ai/llmProvider.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`functions/src/ai/llmProvider.ts`:

```ts
/**
 * Provider-agnostic AI text-generation contract (design spec:
 * docs/superpowers/specs/2026-08-09-ai-lesson-studio-core-design.md).
 * No concrete provider (Anthropic, Vertex AI, ...) has been chosen yet —
 * callers depend only on this interface, never on a specific provider's
 * SDK, so swapping in a real implementation later touches only this file.
 */
export interface LlmProvider {
  generateText(prompt: string): Promise<string>
}

/**
 * Ships as the only implementation until a provider is chosen. Every
 * caller path (generateLessonDraftCallable, and any future AI feature)
 * must degrade gracefully when this throws — see the design spec's Error
 * Handling section — rather than assume AI is always available.
 */
export const unconfiguredLlmProvider: LlmProvider = {
  generateText: () => Promise.reject(new Error('AI provider is not configured.')),
}
```

- [ ] **Step 4: テストを通す**

Run: `cd functions && npx vitest run src/ai/llmProvider.test.ts`
Expected: PASS

- [ ] **Step 5: `npm run typecheck`（functionsワークスペース）**

- [ ] **Step 6: Commit**

```bash
git add functions/src/ai/llmProvider.ts functions/src/ai/llmProvider.test.ts
git commit -m "feat: add provider-agnostic LlmProvider interface and its unconfigured default"
```

---

### Task 2: PII送信フィルタ

統合仕様書§15.3の禁止フィールド一覧をコードで表現する。本計画の「授業案作成」機能自体は生徒個人情報を含まない入力しか扱わないが、将来の機能（ニュース案・振り返り要約等）が同じ関門を通ることを構造的に強制するため、汎用の許可/禁止フィールド検証関数として先に用意する。

**Files:**
- Create: `functions/src/ai/piiFilter.ts`, `.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `FORBIDDEN_AI_INPUT_KEYS`定数、`assertNoForbiddenFields(input: Record<string, unknown>): void`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/ai/piiFilter.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { assertNoForbiddenFields } from './piiFilter'

describe('assertNoForbiddenFields', () => {
  it('passes for an object containing only teacher-authored, non-personal fields', () => {
    expect(() => assertNoForbiddenFields({ theme: '身近な企業', mainObjective: '需給を学ぶ' })).not.toThrow()
  })

  it('rejects an object containing a forbidden key (studentName)', () => {
    expect(() => assertNoForbiddenFields({ theme: 'x', studentName: '山田太郎' })).toThrow('studentName')
  })

  it('rejects an object containing a forbidden key (email)', () => {
    expect(() => assertNoForbiddenFields({ email: 'student@example.com' })).toThrow('email')
  })

  it('rejects nested objects containing a forbidden key', () => {
    expect(() => assertNoForbiddenFields({ profile: { studentName: '山田太郎' } })).toThrow('studentName')
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/ai/piiFilter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`functions/src/ai/piiFilter.ts`:

```ts
/**
 * Spec §15.3's explicit forbidden-field list (生徒氏名・メール・個人回答・
 * 個人売買履歴・家庭科の個別状態・アクセスログ・端末情報), expressed as key
 * names an AI-bound payload must never contain. This is a defense-in-depth
 * check, not the only safeguard — the "授業案作成" feature's own input
 * (wizard answers) structurally never contains any of these, but future
 * features that DO touch student-adjacent data must pass through this
 * same function before reaching an LlmProvider.
 */
export const FORBIDDEN_AI_INPUT_KEYS = [
  'studentName', 'email', 'individualResponse', 'personalTradeHistory',
  'householdIndividualState', 'accessLog', 'deviceInfo',
] as const

/** Throws with the offending key name if `input` (recursively) contains any forbidden key. */
export const assertNoForbiddenFields = (input: Record<string, unknown>): void => {
  const walk = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if ((FORBIDDEN_AI_INPUT_KEYS as readonly string[]).includes(key)) {
        throw new Error(`AI input contains a forbidden field: ${key}`)
      }
      walk(nested)
    }
  }
  walk(input)
}
```

- [ ] **Step 4: テストを通す**

Run: `cd functions && npx vitest run src/ai/piiFilter.test.ts`
Expected: PASS

- [ ] **Step 5: `npm run typecheck`**

- [ ] **Step 6: Commit**

```bash
git add functions/src/ai/piiFilter.ts functions/src/ai/piiFilter.test.ts
git commit -m "feat: add PII forbidden-field guard for AI-bound payloads (spec §15.3)"
```

---

### Task 3: プロンプト整形・AI応答パース

Guided Builderウィザードの回答（`WizardAnswers`、既存）からプロンプト文字列を組み立てる関数と、AIのテキスト応答を`LessonContent`ドラフトへパースする関数を実装する。パース失敗時は明確なエラーを投げる（呼び出し側でフォールバックに使う）。

**Files:**
- Create: `functions/src/ai/lessonDraftPrompt.ts`, `.test.ts`

**Interfaces:**
- Consumes: なし（`WizardAnswers`の形は`src/lib/lessonTemplates/guidedBuilderTypes.ts`と同じだが、`functions/`→`src/`のimport境界制約により、このタスクでは`functions/`側に必要な最小限のフィールドだけを持つ独立した入力型を定義する——クライアント側の完全な型と重複させない）
- Produces: `LessonDraftPromptInput`型、`buildLessonDraftPrompt(input: LessonDraftPromptInput): string`、`ParsedLessonDraft`型、`parseLessonDraftResponse(text: string): ParsedLessonDraft`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/ai/lessonDraftPrompt.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildLessonDraftPrompt, parseLessonDraftResponse } from './lessonDraftPrompt'

describe('buildLessonDraftPrompt', () => {
  it('includes the teacher-authored theme and objective in the prompt text', () => {
    const prompt = buildLessonDraftPrompt({ theme: '身近な企業', mainObjective: '需給を学ぶ', subject: 'SOCIAL_STUDIES', difficulty: 'STANDARD' })
    expect(prompt).toContain('身近な企業')
    expect(prompt).toContain('需給を学ぶ')
  })

  it('instructs the model to respond with JSON matching the expected shape', () => {
    const prompt = buildLessonDraftPrompt({ theme: 'x', mainObjective: 'y', subject: 'HOME_ECONOMICS', difficulty: 'BASIC' })
    expect(prompt).toContain('JSON')
    expect(prompt).toContain('title')
    expect(prompt).toContain('description')
  })
})

describe('parseLessonDraftResponse', () => {
  it('parses a well-formed JSON response into a ParsedLessonDraft', () => {
    const result = parseLessonDraftResponse('{"title": "AIが作った教材", "description": "需給と価格の関係を学ぶ"}')
    expect(result).toEqual({ title: 'AIが作った教材', description: '需給と価格の関係を学ぶ' })
  })

  it('throws a clear error for non-JSON text', () => {
    expect(() => parseLessonDraftResponse('これはJSONではありません')).toThrow('AI response was not valid JSON')
  })

  it('throws a clear error when required fields are missing', () => {
    expect(() => parseLessonDraftResponse('{"title": "タイトルのみ"}')).toThrow('AI response is missing required field: description')
  })

  it('throws a clear error when a field has the wrong type', () => {
    expect(() => parseLessonDraftResponse('{"title": 123, "description": "x"}')).toThrow('AI response is missing required field: title')
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/ai/lessonDraftPrompt.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`functions/src/ai/lessonDraftPrompt.ts`:

```ts
export interface LessonDraftPromptInput {
  theme: string
  mainObjective: string
  subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS'
  difficulty: 'BASIC' | 'STANDARD' | 'ADVANCED'
}

/**
 * Input here is always teacher-authored wizard-answer text (theme,
 * objective, subject, difficulty) — never student data — so this function
 * does not itself call piiFilter.assertNoForbiddenFields; the Callable
 * boundary (Task 4) is where that check is centralized for every AI
 * feature uniformly, this function only formats already-cleared text.
 */
export const buildLessonDraftPrompt = (input: LessonDraftPromptInput): string => `
あなたは学校教員向けの授業設計アシスタントです。以下の条件に基づいて、授業教材の案を1つ、JSON形式で提案してください。

科目: ${input.subject === 'SOCIAL_STUDIES' ? '社会科（市場シミュレーション）' : '家庭科（生活設計シミュレーション）'}
テーマ: ${input.theme}
主な学習目標: ${input.mainObjective}
難易度: ${input.difficulty}

必ず次の形式のJSONのみを出力してください（他のテキストを含めないこと）:
{"title": "教材のタイトル", "description": "教材の概要説明"}
`.trim()

export interface ParsedLessonDraft {
  title: string
  description: string
}

/**
 * Deliberately minimal parse target (title/description only) for v1 — the
 * AI-suggested draft still flows through TemplateOverviewPage's existing
 * confirmation UI (Task 6), which is where a teacher fills in the rest via
 * the same fixed-preset machinery. A richer AI-generated LessonContent
 * (companies, households, etc.) is future scope, not this task's.
 */
export const parseLessonDraftResponse = (text: string): ParsedLessonDraft => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('AI response was not valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('AI response was not valid JSON')
  const record = parsed as Record<string, unknown>
  if (typeof record.title !== 'string') throw new Error('AI response is missing required field: title')
  if (typeof record.description !== 'string') throw new Error('AI response is missing required field: description')
  return { title: record.title, description: record.description }
}
```

- [ ] **Step 4: テストを通す**

Run: `cd functions && npx vitest run src/ai/lessonDraftPrompt.test.ts`
Expected: PASS

- [ ] **Step 5: `npm run typecheck`**

- [ ] **Step 6: Commit**

```bash
git add functions/src/ai/lessonDraftPrompt.ts functions/src/ai/lessonDraftPrompt.test.ts
git commit -m "feat: add lesson-draft prompt builder and response parser"
```

---

### Task 4: `generateLessonDraftCallable`（Callable本体・認可・利用ログ・ルール・index.ts export）

Task 1〜3を組み合わせ、教師のみ・組織の`aiEnabled`が真の場合のみ呼べるCallableとして公開する。呼び出しごとに`organizations/{orgId}/aiUsageLog`へ記録する。

**Files:**
- Create: `functions/src/ai/onCall.ts`, `.test.ts`
- Modify: `functions/src/index.ts`
- Modify: `firestore.rules`

**Interfaces:**
- Consumes: `unconfiguredLlmProvider`・`LlmProvider`（Task 1）、`assertNoForbiddenFields`（Task 2）、`buildLessonDraftPrompt`・`parseLessonDraftResponse`（Task 3）、`isCallerTeacher`（既存、`functions/src/organizations/onCall.ts`）、`personalOrgId`（既存、`functions/src/lib/personalOrgId.ts`）
- Produces: `generateLessonDraftCallable`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/ai/onCall.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { generateLessonDraftCallable } from './onCall'

const orgGetMock = vi.fn()
const usageLogAddMock = vi.fn()

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: (path: string) => {
      if (/^organizations\/[^/]+$/.test(path)) return { get: orgGetMock }
      return { get: vi.fn() }
    },
    collection: () => ({ add: usageLogAddMock }),
  }),
}))

const authenticatedRequest = (data: Record<string, unknown> = {}): CallableRequest => ({
  auth: { uid: 'teacher-1', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } },
  data: { theme: 'テストテーマ', mainObjective: '目標', subject: 'SOCIAL_STUDIES', difficulty: 'STANDARD', ...data },
} as CallableRequest)

describe('generateLessonDraftCallable', () => {
  it('rejects an unauthenticated caller', async () => {
    await expect(generateLessonDraftCallable.run({ auth: undefined, data: {} } as CallableRequest)).rejects.toMatchObject({ code: 'unauthenticated' })
  })

  it('rejects when the org has not enabled AI', async () => {
    orgGetMock.mockResolvedValueOnce({ exists: true, get: (key: string) => (key === 'aiEnabled' ? false : undefined) })
    await expect(generateLessonDraftCallable.run(authenticatedRequest())).rejects.toMatchObject({ code: 'failed-precondition' })
    expect(usageLogAddMock).not.toHaveBeenCalled()
  })

  it('returns a translated error and logs failure when the provider is unconfigured', async () => {
    orgGetMock.mockResolvedValueOnce({ exists: true, get: (key: string) => (key === 'aiEnabled' ? true : undefined) })
    await expect(generateLessonDraftCallable.run(authenticatedRequest())).rejects.toMatchObject({ code: 'unavailable' })
    expect(usageLogAddMock).toHaveBeenCalledWith(expect.objectContaining({ succeeded: false, feature: 'LESSON_DRAFT' }))
  })
})
```

（本テストの`orgGetMock`/`usageLogAddMock`のモック形は、実装時に`functions/src/homeEconomics/onCall.test.ts`の`firebase-admin/firestore`モックパターンを直接参照して実際のAdmin SDK呼び出し形（`doc().get()`・`collection().add()`か`doc().collection().add()`か等）に正確に合わせること——本タスクのStep 3で採用する実装の実際のAPI呼び出し方法を先に決め、それにテストを追従させる。）

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/ai/onCall.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`functions/src/ai/onCall.ts`:

```ts
import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { isCallerTeacher } from '../organizations/onCall'
import { personalOrgId } from '../lib/personalOrgId'
import { unconfiguredLlmProvider } from './llmProvider'
import { assertNoForbiddenFields } from './piiFilter'
import { buildLessonDraftPrompt, parseLessonDraftResponse, type LessonDraftPromptInput } from './lessonDraftPrompt'

interface GenerateLessonDraftRequest {
  theme?: unknown
  mainObjective?: unknown
  subject?: unknown
  difficulty?: unknown
}

const isValidRequest = (data: GenerateLessonDraftRequest): data is LessonDraftPromptInput =>
  typeof data.theme === 'string' && typeof data.mainObjective === 'string'
  && (data.subject === 'SOCIAL_STUDIES' || data.subject === 'HOME_ECONOMICS')
  && (data.difficulty === 'BASIC' || data.difficulty === 'STANDARD' || data.difficulty === 'ADVANCED')

/**
 * Teacher-only, org-aiEnabled-gated lesson-draft generation (design spec:
 * docs/superpowers/specs/2026-08-09-ai-lesson-studio-core-design.md).
 * Never writes a LessonContent to Firestore — only returns a suggestion
 * the client routes through TemplateOverviewPage's existing confirmation
 * step (Task 6), which is the actual write path.
 */
export const generateLessonDraftCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as GenerateLessonDraftRequest
  if (!isValidRequest(data)) throw new HttpsError('invalid-argument', '入力内容が不正です。')

  const db = getFirestore()
  const orgId = personalOrgId(request.auth.uid)
  const orgSnap = await db.doc(`organizations/${orgId}`).get()
  if (!orgSnap.exists || orgSnap.get('aiEnabled') !== true) {
    throw new HttpsError('failed-precondition', 'AI機能はこの組織では有効化されていません。')
  }

  const logUsage = (succeeded: boolean) =>
    db.collection(`organizations/${orgId}/aiUsageLog`).add({
      orgId, teacherUid: request.auth!.uid, feature: 'LESSON_DRAFT', succeeded, createdAt: new Date(),
    })

  try {
    assertNoForbiddenFields(data as Record<string, unknown>)
    const prompt = buildLessonDraftPrompt(data)
    const text = await unconfiguredLlmProvider.generateText(prompt)
    const draft = parseLessonDraftResponse(text)
    await logUsage(true)
    return draft
  } catch (error) {
    await logUsage(false)
    throw new HttpsError('unavailable', 'AI提案の生成に失敗しました。固定の案をご利用ください。')
  }
})
```

- [ ] **Step 4: テストを通す**

Run: `cd functions && npx vitest run src/ai/onCall.test.ts`
Expected: PASS

- [ ] **Step 5: `functions/src/index.ts`へexportを追加する**

```ts
export { generateLessonDraftCallable } from './ai/onCall'
```

- [ ] **Step 6: `firestore.rules`へ`aiUsageLog`の明示的な拒否ルールを追加する**

`firestore.rules`の`match /organizations/{orgId}/members/{uid} { ... }`ブロックの閉じ括弧の直後へ、**トップレベルの独立したmatch文として**（`lessonVersionPublishIdempotency`の既存の書き方——完全パスを持つ独立match、`organizations/{orgId}`ブロックの中へネストしない——と同じ形）追加する:

```
    match /organizations/{orgId}/aiUsageLog/{logId} { allow read, write: if false; }
```

（実装前に`firestore.rules`の`match /lessonVersionPublishIdempotency/{key} { allow read, write: if false; }`の実際の書かれ方——ネストか独立かインデント幅——を直接確認し、寸分違わず同じ構文パターンに揃えること。）

- [ ] **Step 7: `npm run verify --workspace=functions` および `npm run test:rules`**

- [ ] **Step 8: Commit**

```bash
git add functions/src/ai/onCall.ts functions/src/ai/onCall.test.ts functions/src/index.ts firestore.rules
git commit -m "feat: add generateLessonDraftCallable, gated by org aiEnabled toggle, logging every attempt"
```

---

### Task 5: クライアント側Callableラッパー

`src/lib/platformConfig/getTuningConstants.ts`と同じ薄いCallable呼び出しパターンで、`generateLessonDraftCallable`を呼ぶクライアント関数を実装する。

**Files:**
- Create: `src/lib/ai/generateLessonDraft.ts`, `.test.ts`

**Interfaces:**
- Consumes: なし（Firebase Functions SDKの`httpsCallable`のみ）
- Produces: `GenerateLessonDraftInput`型、`GeneratedLessonDraft`型、`generateLessonDraft(functions: Functions, input: GenerateLessonDraftInput): Promise<GeneratedLessonDraft>`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/ai/generateLessonDraft.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { generateLessonDraft } from './generateLessonDraft'

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

describe('generateLessonDraft', () => {
  it('calls the generateLessonDraftCallable Callable with the given input and returns its data', async () => {
    const callMock = vi.fn().mockResolvedValue({ data: { title: 'AI案', description: '説明' } })
    vi.mocked(httpsCallable).mockReturnValue(callMock as never)

    const input = { theme: 'テーマ', mainObjective: '目標', subject: 'SOCIAL_STUDIES' as const, difficulty: 'STANDARD' as const }
    const result = await generateLessonDraft({} as never, input)

    expect(httpsCallable).toHaveBeenCalledWith({}, 'generateLessonDraftCallable')
    expect(callMock).toHaveBeenCalledWith(input)
    expect(result).toEqual({ title: 'AI案', description: '説明' })
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/ai/generateLessonDraft.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`src/lib/ai/generateLessonDraft.ts`:

```ts
import { httpsCallable, type Functions } from 'firebase/functions'

export interface GenerateLessonDraftInput {
  theme: string
  mainObjective: string
  subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS'
  difficulty: 'BASIC' | 'STANDARD' | 'ADVANCED'
}

export interface GeneratedLessonDraft {
  title: string
  description: string
}

export const generateLessonDraft = async (functions: Functions, input: GenerateLessonDraftInput): Promise<GeneratedLessonDraft> => {
  const call = httpsCallable<GenerateLessonDraftInput, GeneratedLessonDraft>(functions, 'generateLessonDraftCallable')
  const result = await call(input)
  return result.data
}
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/lib/ai/generateLessonDraft.test.ts`
Expected: PASS

- [ ] **Step 5: `npm run typecheck`**

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/generateLessonDraft.ts src/lib/ai/generateLessonDraft.test.ts
git commit -m "feat: add client wrapper for generateLessonDraftCallable"
```

---

### Task 6: `TemplateOverviewPage`への「AI提案」統合

Guided Builderウィザードの3案比較ステップへ「AI提案」カードを追加する。選択するとローディング状態を経て`generateLessonDraft`を呼び、成功すればAI案を（固定3案と同じ`LessonContent`ドラフトの形へ変換して）§14.4確認ページへ渡す。失敗時は固定3案のみのフォールバック表示に戻る。

**Files:**
- Modify: `src/components/teacher/templates/TemplateOverviewPage.tsx`, `.test.tsx`

**Interfaces:**
- Consumes: `generateLessonDraft`（Task 5）、既存の`TemplateOverviewPageProps`・`buildDraftFromAnswers`（Guided Lesson Builder計画、既存）
- Produces: `TemplateOverviewPageProps`への`functions: Functions`・`aiEnabled: boolean`プロパティ追加（既存コンポーネントの拡張）

- [ ] **Step 1: 失敗するテストを書く**

`src/components/teacher/templates/TemplateOverviewPage.test.tsx`に追記する（既存のテストファイルを先に読み、既存のimport・`answers`フィクスチャをそのまま使うこと）:

```tsx
it('shows an "AI提案" card only when aiEnabled is true', () => {
  render(<TemplateOverviewPage answers={answers} onCreate={vi.fn()} creating={false} aiEnabled={false} functions={{} as never} />)
  expect(screen.queryByRole('button', { name: /AI提案/ })).not.toBeInTheDocument()
})

it('calls generateLessonDraft and shows the AI-suggested draft on the confirmation screen when selected', async () => {
  const { generateLessonDraft } = await import('../../../lib/ai/generateLessonDraft')
  vi.mocked(generateLessonDraft).mockResolvedValueOnce({ title: 'AIが作った教材', description: 'AIの説明' })
  render(<TemplateOverviewPage answers={answers} onCreate={vi.fn()} creating={false} aiEnabled={true} functions={{} as never} />)
  fireEvent.click(screen.getByRole('button', { name: /AI提案/ }))
  await screen.findByDisplayValue('AIが作った教材')
})

it('falls back to showing only the fixed tiers when generateLessonDraft rejects', async () => {
  const { generateLessonDraft } = await import('../../../lib/ai/generateLessonDraft')
  vi.mocked(generateLessonDraft).mockRejectedValueOnce(new Error('unavailable'))
  render(<TemplateOverviewPage answers={answers} onCreate={vi.fn()} creating={false} aiEnabled={true} functions={{} as never} />)
  fireEvent.click(screen.getByRole('button', { name: /AI提案/ }))
  await screen.findByText('AI提案の生成に失敗しました。固定の案をご利用ください。')
  expect(screen.getByRole('button', { name: /標準案/ })).toBeInTheDocument()
})
```

`src/components/teacher/templates/TemplateOverviewPage.test.tsx`の先頭へ、`generateLessonDraft`をモックするための宣言を追加する:

```tsx
vi.mock('../../../lib/ai/generateLessonDraft', () => ({ generateLessonDraft: vi.fn() }))
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/components/teacher/templates/TemplateOverviewPage.test.tsx`
Expected: FAIL — `aiEnabled`/`functions` props not accepted, or AI提案ボタンが存在しない

- [ ] **Step 3: `TemplateOverviewPage.tsx`を実装する**

既存の`TemplateOverviewPage.tsx`を読み、以下を反映する形で変更する（コンポーネントの既存構造・フックの使い方は維持し、AI関連の状態とUIのみ追加すること）:

1. Propsへ`aiEnabled: boolean`と`functions: Functions`（`firebase/functions`）を追加する。
2. AI提案の状態（`aiLoading`・`aiError`）を`useState`で保持する。
3. 3案比較の表示（`chosen`が`undefined`の分岐）に、`aiEnabled`が`true`の場合のみ「AI提案」カードを追加で描画する。クリック時に`generateLessonDraft(functions, { theme: answers.theme, mainObjective: answers.mainObjective, subject: answers.goal === 'MARKET_AND_INVESTING' ? 'SOCIAL_STUDIES' : 'HOME_ECONOMICS', difficulty: answers.difficulty })`を呼ぶ。
4. 成功時: 返ってきた`{ title, description }`を、`buildDraftFromAnswers(answers, 'STANDARD')`で作った土台の`title`/`description`だけ上書きした`LessonContent`として`setChosen(...)`し、既存の確認画面（`chosen`が設定された後の分岐）へ遷移させる（既存の確認画面コンポーネント自体は変更しない——固定案と全く同じ経路を通す）。
5. 失敗時: `aiError`へ「AI提案の生成に失敗しました。固定の案をご利用ください。」をセットし、3案比較の表示に留まる（例外を投げてコンポーネント全体をクラッシュさせない）。
6. `aiLoading`中はボタンを無効化する。

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/components/teacher/templates/TemplateOverviewPage.test.tsx`
Expected: PASS（Guided Lesson Builder計画由来の既存テストも含め全件PASSすることを確認する）

- [ ] **Step 5: `App.tsx`から`TemplateOverviewPage`を呼び出している箇所（`TemplateNewRoute`）へ新しいpropsを配線する**

`src/App.tsx`の`TemplateNewRoute`内の`<TemplateOverviewPage .../>`呼び出しへ`functions={services.functions}`と`aiEnabled={/* 組織のaiEnabledを読む処理、下記参照 */}`を追加する。`aiEnabled`は`TemplateNewRoute`内で`organizations/{personalOrgId(uid)}`ドキュメントを読み、`aiEnabled === true`かどうかを`useState`で保持して渡す（クライアント側は`firestore.rules`の既存の`get`許可の範囲で読める——新しいルールは不要）。

- [ ] **Step 6: `npm run verify`（全ワークスペース）**

- [ ] **Step 7: Commit**

```bash
git add src/components/teacher/templates/TemplateOverviewPage.tsx src/components/teacher/templates/TemplateOverviewPage.test.tsx src/App.tsx src/App.test.tsx
git commit -m "feat: add AI-suggested draft option to the Guided Builder tier-comparison step"
```
