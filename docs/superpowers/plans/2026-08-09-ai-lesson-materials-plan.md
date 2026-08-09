# AI Lesson Materials (File Upload) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**正本:** `docs/superpowers/specs/2026-08-09-ai-lesson-materials-design.md`（設計仕様）。矛盾する場合は仕様書を優先する。

**Goal:** 教師がテキスト型PDF/プレーンテキストの参考資料をアップロードし、その内容を「授業案作成」AIへ反映できるようにする。

**Architecture:** Firebase Storage（このプロジェクトで新規導入）へファイルを保存し、`pdfjs-dist`でクライアント側テキスト抽出、`lessonTemplates/{templateId}/materials/{materialId}`へ抽出テキストを保存する。資料はテンプレート作成後にのみ存在しうるため、資料を使ったAI再提案は`TemplateEditorPage`（フルエディタ）内の独立したアクションとして実装し、既存の下書き保存/版発行フローが人手確認を兼ねる。

**Tech Stack:** TypeScript, React, Firebase Storage, `pdfjs-dist`, Firebase Cloud Functions v2 (`onCall`), Vitest, React Testing Library, `@firebase/rules-unit-testing`。

## Global Constraints

- 対応ファイル形式はテキスト型PDFとプレーンテキストのみ。画像OCRは対象外（設計仕様に明記、別スコープ）。
- `materialsUploadEnabled`トグルを**設定するUI**は本計画のスコープ外。v1では`organizations/{orgId}`ドキュメントのフィールドを直接（Firebaseコンソール等で）設定する運用とする（AI Lesson Studioコア計画の`aiEnabled`と同じ扱い）。
- Storageの生ファイルは**AI呼び出し経路に一切渡さない**。渡すのは抽出済みテキストのみ。
- AIの出力は資料アップロードとは独立して、既存のフルエディタのタイトル・説明入力欄へ反映するのみで、Firestoreへの書き込みは既存の「下書き保存」「版を発行する」操作を経由する（新しい確認ゲートを作らない）。
- 新規Callableの拡張（`generateLessonDraftCallable`への資料テキスト追加）は既存のCallableを変更し、後方互換を保つ（資料なしの既存呼び出し方も引き続き動作する）。
- 日本語UI文言を用いる（既存コンポーネントの慣例）。

---

## File Structure

| File | Change |
| --- | --- |
| `firebase.json` | Modify（Task 1。`storage`設定・emulatorポート追加） |
| `storage.rules` | Create（Task 1。org単位のアクセス制御） |
| `package.json` | Modify（Task 1。`test:rules`へstorageエミュレータ追加、`pdfjs-dist`依存追加） |
| `test/storage.rules.test.ts` | Create（Task 1） |
| `src/lib/ai/materialLimits.ts`, `.test.ts` | Create（Task 2。サイズ・ページ数上限の定数と検証関数） |
| `src/lib/ai/extractPdfText.ts`, `.test.ts` | Create（Task 3。`pdfjs-dist`によるテキスト抽出） |
| `src/lib/ai/materialsRepository.ts`, `.test.ts` | Create（Task 4。Storageアップロード＋Firestore保存） |
| `firestore.rules` | Modify（Task 4。`materials`サブコレクションのルール） |
| `functions/src/ai/lessonDraftPrompt.ts`, `.test.ts` | Modify（Task 5。資料テキストをプロンプトへ追加） |
| `functions/src/ai/onCall.ts`, `.test.ts` | Modify（Task 5。`generateLessonDraftCallable`の入力拡張） |
| `src/lib/ai/generateLessonDraft.ts`, `.test.ts` | Modify（Task 6。クライアントラッパーの入力拡張） |
| `src/components/teacher/templates/materials/MaterialUploadPanel.tsx`, `.test.tsx` | Create（Task 7） |
| `src/components/teacher/templates/TemplateEditorPage.tsx`, `.test.tsx` | Modify（Task 8。資料タブ・AI再提案ボタンの統合） |

---

## タスク一覧

1. Firebase Storage導入・ルール・エミュレータ設定
2. ファイルサイズ・ページ数の検証関数
3. PDFテキスト抽出（クライアント側）
4. 資料のStorageアップロード＋Firestore保存
5. `generateLessonDraftCallable`の資料テキスト対応拡張
6. クライアント側Callableラッパーの拡張
7. 資料アップロードパネル（一覧・選択・アップロードUI）
8. `TemplateEditorPage`への統合

---

### Task 1: Firebase Storage導入・ルール・エミュレータ設定

このプロジェクトで初めてFirebase Storageを導入する。`firebase.json`へStorage設定とエミュレータポートを追加し、org単位のアクセス制御を行う`storage.rules`を新規作成する。

**Files:**
- Modify: `firebase.json`
- Create: `storage.rules`
- Modify: `package.json`（`test:rules`スクリプト、`pdfjs-dist`依存追加）
- Create: `test/storage.rules.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: なし（インフラ設定のみ）

- [ ] **Step 1: `firebase.json`へStorage設定を追加する**

`firebase.json`の`"database": { "rules": "database.rules.json" },`の直後へ追加する:

```json
  "storage": { "rules": "storage.rules" },
```

`"emulators"`ブロックへ`storage`ポートを追加する（既存の`"database": { "port": 9000 },`の直後）:

```json
    "storage": { "port": 9199 },
```

- [ ] **Step 2: `storage.rules`を作成する**

`storage.rules`（新規、リポジトリルート）:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    function activeMember(orgId) {
      return firestore.get(/databases/(default)/documents/organizations/$(orgId)/members/$(request.auth.uid)).data.status == 'active';
    }
    match /orgs/{orgId}/materials/{materialId}/{fileName} {
      allow read, write: if request.auth != null
        && request.auth.token.email_verified == true
        && request.auth.token.firebase.sign_in_provider == 'google.com'
        && activeMember(orgId);
    }
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

（`firestore.get`によるクロスサービス参照は`firebase-storage-security-rules`の標準機能。既存の`firestore.rules`の`teacher()`/`activeMember()`関数と同じ判定条件をStorage側でも表現している。）

- [ ] **Step 3: `pdfjs-dist`を依存に追加する**

```bash
npm install pdfjs-dist
```

- [ ] **Step 4: `test:rules`スクリプトへstorageエミュレータを追加する**

`package.json`の`"test:rules"`スクリプトを次のように変更する（`--only firestore,database`へ`storage`を追加）:

```json
    "test:rules": "firebase emulators:exec --project demo-stock-league-classroom --only firestore,database,storage \"vitest --config vite.rules.config.ts run\"",
```

- [ ] **Step 5: 失敗するルールテストを書く**

`test/storage.rules.test.ts`。`@firebase/rules-unit-testing`の`initializeTestEnvironment`は`storage`オプション（ルールテキスト）を受け付け、`context.storage()`は`firebase/compat/storage`のインスタンスを返す（`test/database.rules.test.ts`と同じセットアップ構造、`storage`の型だけがcompat SDKになる点に注意）:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

const projectId = 'demo-stock-league-classroom-storage'
let environment: RulesTestEnvironment

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8') },
    storage: { rules: readFileSync(join(process.cwd(), 'storage.rules'), 'utf8') },
  })
})

beforeEach(async () => {
  await environment.clearFirestore()
  await environment.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc('organizations/org-1/members/teacher-a').set({ status: 'active', role: 'owner', membershipVersion: 1 })
  })
})

afterAll(async () => { await environment.cleanup() })

const teacherToken = { email_verified: true, firebase: { sign_in_provider: 'google.com' as const } }
const bytes = new Uint8Array([1, 2, 3])

describe('storage.rules', () => {
  it('allows an active org member to upload to their own org\'s materials path', async () => {
    const asTeacherA = environment.authenticatedContext('teacher-a', teacherToken)
    await assertSucceeds(asTeacherA.storage().ref('orgs/org-1/materials/mat-1/file.pdf').put(bytes))
  })

  it('denies uploading to a different org\'s materials path', async () => {
    const asTeacherA = environment.authenticatedContext('teacher-a', teacherToken)
    await assertFails(asTeacherA.storage().ref('orgs/org-2/materials/mat-1/file.pdf').put(bytes))
  })

  it('denies an unauthenticated request', async () => {
    const asAnonymous = environment.unauthenticatedContext()
    await assertFails(asAnonymous.storage().ref('orgs/org-1/materials/mat-1/file.pdf').put(bytes))
  })
})
```

- [ ] **Step 6: 失敗を確認する**

Run: `npm run test:rules`
Expected: FAIL（`storage.rules`が存在しない、またはテストが期待通り失敗する）

- [ ] **Step 7: テストを通す**

Run: `npm run test:rules`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add firebase.json storage.rules package.json package-lock.json test/storage.rules.test.ts
git commit -m "feat: introduce Firebase Storage with org-scoped access rules for AI lesson materials"
```

（**注記**: 実際にStorageへ書き込みが発生する本番動作確認には、Firebase ConsoleでのStorage有効化という外部作業が別途必要——設計仕様に明記済み。本タスクのコード・エミュレータテストはその外部作業と独立して完結する。）

---

### Task 2: ファイルサイズ・ページ数の検証関数

統合仕様書§15.5「資料ページ数・容量上限」を実装する。アップロード前にクライアント側でハード制約として検証する純粋関数。

**Files:**
- Create: `src/lib/ai/materialLimits.ts`, `.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `MAX_MATERIAL_FILE_SIZE_BYTES`定数、`MAX_MATERIAL_PAGE_COUNT`定数、`validateMaterialFile(input: { sizeBytes: number; pageCount?: number }): { valid: true } | { valid: false; error: string }`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/ai/materialLimits.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { MAX_MATERIAL_FILE_SIZE_BYTES, MAX_MATERIAL_PAGE_COUNT, validateMaterialFile } from './materialLimits'

describe('validateMaterialFile', () => {
  it('accepts a file within both size and page limits', () => {
    expect(validateMaterialFile({ sizeBytes: 1_000_000, pageCount: 10 })).toEqual({ valid: true })
  })

  it('rejects a file exceeding the size limit', () => {
    const result = validateMaterialFile({ sizeBytes: MAX_MATERIAL_FILE_SIZE_BYTES + 1, pageCount: 1 })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error).toContain('サイズ')
  })

  it('rejects a file exceeding the page-count limit', () => {
    const result = validateMaterialFile({ sizeBytes: 1000, pageCount: MAX_MATERIAL_PAGE_COUNT + 1 })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error).toContain('ページ数')
  })

  it('accepts a file with no pageCount (plain text has no page concept)', () => {
    expect(validateMaterialFile({ sizeBytes: 1000 })).toEqual({ valid: true })
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/ai/materialLimits.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`src/lib/ai/materialLimits.ts`:

```ts
/** §15.5「資料ページ数・容量上限」— PROVISIONAL、試運転で調整する暫定値。 */
export const MAX_MATERIAL_FILE_SIZE_BYTES = 10 * 1024 * 1024
export const MAX_MATERIAL_PAGE_COUNT = 50

export interface MaterialFileInput {
  sizeBytes: number
  pageCount?: number
}

export type MaterialValidationResult = { valid: true } | { valid: false; error: string }

export const validateMaterialFile = (input: MaterialFileInput): MaterialValidationResult => {
  if (input.sizeBytes > MAX_MATERIAL_FILE_SIZE_BYTES) {
    return { valid: false, error: `ファイルサイズが上限（${MAX_MATERIAL_FILE_SIZE_BYTES / (1024 * 1024)}MB）を超えています。` }
  }
  if (input.pageCount !== undefined && input.pageCount > MAX_MATERIAL_PAGE_COUNT) {
    return { valid: false, error: `ページ数が上限（${MAX_MATERIAL_PAGE_COUNT}ページ）を超えています。` }
  }
  return { valid: true }
}
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/lib/ai/materialLimits.test.ts`
Expected: PASS

- [ ] **Step 5: `npm run typecheck`**

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/materialLimits.ts src/lib/ai/materialLimits.test.ts
git commit -m "feat: add material file size/page-count limit validation (spec §15.5)"
```

---

### Task 3: PDFテキスト抽出（クライアント側）

`pdfjs-dist`を使い、PDFファイルからテキストとページ数を抽出する。プレーンテキストファイルはそのまま読み込む。

**Files:**
- Create: `src/lib/ai/extractPdfText.ts`, `.test.ts`

**Interfaces:**
- Consumes: `pdfjs-dist`（新規依存、Task 1）
- Produces: `ExtractedMaterialText`型、`extractTextFromFile(file: File): Promise<ExtractedMaterialText>`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/ai/extractPdfText.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { extractTextFromFile } from './extractPdfText'

vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(() => ({
    promise: Promise.resolve({
      numPages: 2,
      getPage: (pageNum: number) => Promise.resolve({
        getTextContent: () => Promise.resolve({ items: [{ str: `ページ${pageNum}の内容` }] }),
      }),
    }),
  })),
}))

describe('extractTextFromFile', () => {
  it('extracts text and page count from a PDF file', async () => {
    const file = new File(['dummy'], 'material.pdf', { type: 'application/pdf' })
    const result = await extractTextFromFile(file)
    expect(result.pageCount).toBe(2)
    expect(result.text).toContain('ページ1の内容')
    expect(result.text).toContain('ページ2の内容')
  })

  it('reads a plain text file directly, with no page count', async () => {
    const file = new File(['プレーンテキストの内容'], 'material.txt', { type: 'text/plain' })
    const result = await extractTextFromFile(file)
    expect(result.text).toBe('プレーンテキストの内容')
    expect(result.pageCount).toBeUndefined()
  })

  it('throws a clear error for an unsupported file type', async () => {
    const file = new File(['dummy'], 'material.png', { type: 'image/png' })
    await expect(extractTextFromFile(file)).rejects.toThrow('対応していないファイル形式です')
  })

  it('throws a clear error when a PDF yields no extractable text', async () => {
    const file = new File(['dummy'], 'empty.pdf', { type: 'application/pdf' })
    const { getDocument } = await import('pdfjs-dist')
    vi.mocked(getDocument).mockReturnValueOnce({
      promise: Promise.resolve({
        numPages: 1,
        getPage: () => Promise.resolve({ getTextContent: () => Promise.resolve({ items: [] }) }),
      }),
    } as never)
    await expect(extractTextFromFile(file)).rejects.toThrow('このファイルからテキストを抽出できませんでした')
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/ai/extractPdfText.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`src/lib/ai/extractPdfText.ts`:

```ts
import { getDocument } from 'pdfjs-dist'

export interface ExtractedMaterialText {
  text: string
  pageCount?: number
}

const extractFromPdf = async (file: File): Promise<ExtractedMaterialText> => {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await getDocument({ data: arrayBuffer }).promise
  const pageTexts: string[] = []
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()
    const pageText = content.items.map((item) => ('str' in item ? item.str : '')).join('')
    pageTexts.push(pageText)
  }
  const text = pageTexts.join('\n').trim()
  if (!text) throw new Error('このファイルからテキストを抽出できませんでした（スキャン画像のみのPDFの可能性があります）。')
  return { text, pageCount: pdf.numPages }
}

const extractFromPlainText = async (file: File): Promise<ExtractedMaterialText> => ({ text: await file.text() })

export const extractTextFromFile = (file: File): Promise<ExtractedMaterialText> => {
  if (file.type === 'application/pdf') return extractFromPdf(file)
  if (file.type === 'text/plain') return extractFromPlainText(file)
  return Promise.reject(new Error('対応していないファイル形式です（PDFまたはプレーンテキストのみ）。'))
}
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/lib/ai/extractPdfText.test.ts`
Expected: PASS

- [ ] **Step 5: `npm run typecheck`**

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/extractPdfText.ts src/lib/ai/extractPdfText.test.ts
git commit -m "feat: add client-side PDF/plain-text extraction for AI lesson materials"
```

---

### Task 4: 資料のStorageアップロード＋Firestore保存

Task 2・3を組み合わせ、Storageへのアップロードと`lessonTemplates/{templateId}/materials/{materialId}`への抽出テキスト保存を行う。Storageの生ファイルはこの関数の外へは一切渡さない。

**Files:**
- Create: `src/lib/ai/materialsRepository.ts`, `.test.ts`
- Modify: `firestore.rules`

**Interfaces:**
- Consumes: `validateMaterialFile`（Task 2）、`extractTextFromFile`（Task 3）
- Produces: `MaterialDocument`型、`uploadMaterial(storage: FirebaseStorage, firestore: Firestore, orgId: string, templateId: string, file: File): Promise<MaterialDocument>`、`listMaterials(firestore: Firestore, templateId: string): Promise<MaterialDocument[]>`

- [ ] **Step 1: `firestore.rules`へ`materials`サブコレクションのルールを追加する**

`firestore.rules`の`match /lessonTemplates/{templateId} { ... }`ブロック内、既存の`match /versions/{versionId} { ... }`の直後へ追加する（既存の`versions`と同じ`activeMember`判定パターン、ただし`materials`はCallable経由ではなくクライアント直接書き込みのため`create`/`get`/`list`/`delete`を許可する）:

```
      match /materials/{materialId} {
        allow get, list, create, delete: if teacher()
          && activeMember(get(/databases/$(database)/documents/lessonTemplates/$(templateId)).data.orgId);
        allow update: if false;
      }
```

- [ ] **Step 2: 失敗するテストを書く**

`src/lib/ai/materialsRepository.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { uploadMaterial } from './materialsRepository'
import { extractTextFromFile } from './extractPdfText'

vi.mock('./extractPdfText', () => ({ extractTextFromFile: vi.fn() }))
vi.mock('firebase/storage', () => ({ ref: vi.fn(), uploadBytes: vi.fn().mockResolvedValue({}) }))
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), addDoc: vi.fn().mockResolvedValue({ id: 'material-1' }), serverTimestamp: vi.fn(),
}))

describe('uploadMaterial', () => {
  it('rejects a file that fails size/page validation before touching Storage', async () => {
    const { uploadBytes } = await import('firebase/storage')
    const oversizedFile = new File([new Uint8Array(20 * 1024 * 1024)], 'big.pdf', { type: 'application/pdf' })
    await expect(uploadMaterial({} as never, {} as never, 'org-1', 'template-1', oversizedFile)).rejects.toThrow('サイズ')
    expect(uploadBytes).not.toHaveBeenCalled()
  })

  it('uploads to Storage and saves the extracted text to Firestore, never the raw file bytes', async () => {
    vi.mocked(extractTextFromFile).mockResolvedValueOnce({ text: '抽出されたテキスト', pageCount: 3 })
    const { addDoc } = await import('firebase/firestore')
    const file = new File(['x'], 'material.pdf', { type: 'application/pdf' })
    const result = await uploadMaterial({} as never, {} as never, 'org-1', 'template-1', file)
    expect(addDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ text: '抽出されたテキスト', fileName: 'material.pdf' }))
    expect(result.text).toBe('抽出されたテキスト')
  })
})
```

- [ ] **Step 3: 失敗を確認する**

Run: `npx vitest run src/lib/ai/materialsRepository.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: 実装する**

`src/lib/ai/materialsRepository.ts`:

```ts
import { addDoc, collection, getDocs, serverTimestamp, type Firestore } from 'firebase/firestore'
import { ref, uploadBytes, type FirebaseStorage } from 'firebase/storage'
import { validateMaterialFile } from './materialLimits'
import { extractTextFromFile } from './extractPdfText'

export interface MaterialDocument {
  id: string
  fileName: string
  text: string
  pageCount?: number
}

/**
 * Uploads the raw file to Storage for archival, but only ever persists
 * the EXTRACTED TEXT to Firestore — the AI-facing read path
 * (generateLessonDraftCallable) reads only this Firestore document, never
 * the Storage object (design spec: docs/superpowers/specs/2026-08-09-ai-lesson-materials-design.md).
 */
export const uploadMaterial = async (
  storage: FirebaseStorage, firestore: Firestore, orgId: string, templateId: string, file: File,
): Promise<MaterialDocument> => {
  // Size is known synchronously from `file.size` — reject before any I/O
  // (extraction, Storage) whenever possible. Page count is only known
  // after extraction, so it gets a second check below.
  const sizeCheck = validateMaterialFile({ sizeBytes: file.size })
  if (!sizeCheck.valid) throw new Error(sizeCheck.error)

  const extracted = await extractTextFromFile(file)
  const fullCheck = validateMaterialFile({ sizeBytes: file.size, pageCount: extracted.pageCount })
  if (!fullCheck.valid) throw new Error(fullCheck.error)

  const materialId = crypto.randomUUID()
  await uploadBytes(ref(storage, `orgs/${orgId}/materials/${materialId}/${file.name}`), file)
  await addDoc(collection(firestore, `lessonTemplates/${templateId}/materials`), {
    fileName: file.name, text: extracted.text, pageCount: extracted.pageCount ?? null, createdAt: serverTimestamp(),
  })
  return { id: materialId, fileName: file.name, text: extracted.text, pageCount: extracted.pageCount }
}

export const listMaterials = async (firestore: Firestore, templateId: string): Promise<MaterialDocument[]> => {
  const snapshot = await getDocs(collection(firestore, `lessonTemplates/${templateId}/materials`))
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as MaterialDocument)
}
```

- [ ] **Step 5: テストを通す**

Run: `npx vitest run src/lib/ai/materialsRepository.test.ts`
Expected: PASS

- [ ] **Step 6: `npm run typecheck` および `npm run test:rules`**

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/materialsRepository.ts src/lib/ai/materialsRepository.test.ts firestore.rules
git commit -m "feat: add material upload/list repository, extracted text only reaches Firestore"
```

---

### Task 5: `generateLessonDraftCallable`の資料テキスト対応拡張

既存の`generateLessonDraftCallable`（AI Lesson Studioコア計画で実装済み）を拡張し、教師が選択した資料の抽出テキストをプロンプトへ追加できるようにする。既存の呼び出し方（資料なし）との後方互換を保つ。

**Files:**
- Modify: `functions/src/ai/lessonDraftPrompt.ts`, `.test.ts`
- Modify: `functions/src/ai/onCall.ts`, `.test.ts`

**Interfaces:**
- Consumes: 既存の`LessonDraftPromptInput`・`buildLessonDraftPrompt`（`functions/src/ai/lessonDraftPrompt.ts`）
- Produces: `LessonDraftPromptInput`へ`materialTexts?: string[]`フィールドを追加、`buildLessonDraftPrompt`が`materialTexts`をプロンプトへ追記する

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/ai/lessonDraftPrompt.test.ts`へ追記する（既存のテストファイルを先に読み、既存のimport・フィクスチャに合わせること）:

```ts
describe('buildLessonDraftPrompt with materials', () => {
  it('includes provided material texts in the prompt when present', () => {
    const prompt = buildLessonDraftPrompt({ theme: 'x', mainObjective: 'y', subject: 'SOCIAL_STUDIES', difficulty: 'STANDARD', materialTexts: ['資料Aの内容', '資料Bの内容'] })
    expect(prompt).toContain('資料Aの内容')
    expect(prompt).toContain('資料Bの内容')
  })

  it('omits the materials section entirely when materialTexts is absent (backward compatible)', () => {
    const prompt = buildLessonDraftPrompt({ theme: 'x', mainObjective: 'y', subject: 'SOCIAL_STUDIES', difficulty: 'STANDARD' })
    expect(prompt).not.toContain('参考資料')
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/ai/lessonDraftPrompt.test.ts`
Expected: FAIL

- [ ] **Step 3: `lessonDraftPrompt.ts`を拡張する**

`functions/src/ai/lessonDraftPrompt.ts`の`LessonDraftPromptInput`と`buildLessonDraftPrompt`を次のように変更する（既存の`title`/`description`パース部分は変更しない）:

```ts
export interface LessonDraftPromptInput {
  theme: string
  mainObjective: string
  subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS'
  difficulty: 'BASIC' | 'STANDARD' | 'ADVANCED'
  /** Extracted text from teacher-selected materials (design spec: docs/superpowers/specs/2026-08-09-ai-lesson-materials-design.md). Absent = no materials attached, prompt is unchanged from before this field existed. */
  materialTexts?: string[]
}

export const buildLessonDraftPrompt = (input: LessonDraftPromptInput): string => {
  const materialsSection = input.materialTexts && input.materialTexts.length > 0
    ? `\n\n参考資料:\n${input.materialTexts.map((text, i) => `[資料${i + 1}]\n${text}`).join('\n\n')}`
    : ''
  return `
あなたは学校教員向けの授業設計アシスタントです。以下の条件に基づいて、授業教材の案を1つ、JSON形式で提案してください。

科目: ${input.subject === 'SOCIAL_STUDIES' ? '社会科（市場シミュレーション）' : '家庭科（生活設計シミュレーション）'}
テーマ: ${input.theme}
主な学習目標: ${input.mainObjective}
難易度: ${input.difficulty}${materialsSection}

必ず次の形式のJSONのみを出力してください（他のテキストを含めないこと）:
{"title": "教材のタイトル", "description": "教材の概要説明"}
`.trim()
}
```

- [ ] **Step 4: テストを通す**

Run: `cd functions && npx vitest run src/ai/lessonDraftPrompt.test.ts`
Expected: PASS

- [ ] **Step 5: 失敗するテストを書く（`onCall.ts`）**

`functions/src/ai/onCall.test.ts`へ追記する（既存のテストファイルを先に読み、既存のモック・フィクスチャに合わせること）:

```ts
it('accepts an optional materialTexts array and forwards it into the prompt', async () => {
  orgGetMock.mockResolvedValueOnce({ exists: true, get: (key: string) => (key === 'aiEnabled' ? true : undefined) })
  const request = authenticatedRequest({ materialTexts: ['資料の内容'] })
  await expect(generateLessonDraftCallable.run(request)).rejects.toMatchObject({ code: 'unavailable' })
  // unconfiguredLlmProvider は常に失敗するため、ここでは「materialTextsを含むリクエストが
  // invalid-argument にならず、既存のプロバイダ未設定エラー(unavailable)まで到達すること」を
  // もって、拡張フィールドの受理を検証する。
})
```

- [ ] **Step 6: 失敗を確認する**

Run: `cd functions && npx vitest run src/ai/onCall.test.ts`
Expected: FAIL（`materialTexts`が`isValidRequest`に認識されない場合、現状の実装でも`invalid-argument`にはならない可能性がある——実装を読み、`isValidRequest`が未知の追加フィールドを拒否しない構造であることを先に確認し、そうでなければStep 7で対応する）

- [ ] **Step 7: `onCall.ts`を拡張する**

`functions/src/ai/onCall.ts`の`GenerateLessonDraftRequest`・`isValidRequest`へ`materialTexts`を追加する:

```ts
interface GenerateLessonDraftRequest { theme?: unknown; mainObjective?: unknown; subject?: unknown; difficulty?: unknown; materialTexts?: unknown }

const isValidRequest = (data: GenerateLessonDraftRequest): data is LessonDraftPromptInput =>
  typeof data.theme === 'string' && typeof data.mainObjective === 'string'
  && (data.subject === 'SOCIAL_STUDIES' || data.subject === 'HOME_ECONOMICS')
  && (data.difficulty === 'BASIC' || data.difficulty === 'STANDARD' || data.difficulty === 'ADVANCED')
  && (data.materialTexts === undefined || (Array.isArray(data.materialTexts) && data.materialTexts.every((t) => typeof t === 'string')))
```

`buildLessonDraftPrompt(data)`の呼び出しは既存のまま（`data`が`LessonDraftPromptInput`型ガードを通れば`materialTexts`込みでそのまま渡る）で変更不要。

- [ ] **Step 8: テストを通す**

Run: `cd functions && npx vitest run src/ai/onCall.test.ts`
Expected: PASS

- [ ] **Step 9: `npm run verify --workspace=functions`**

- [ ] **Step 10: Commit**

```bash
git add functions/src/ai/lessonDraftPrompt.ts functions/src/ai/lessonDraftPrompt.test.ts functions/src/ai/onCall.ts functions/src/ai/onCall.test.ts
git commit -m "feat: extend generateLessonDraftCallable to accept optional material texts, backward-compatible"
```

---

### Task 6: クライアント側Callableラッパーの拡張

既存の`generateLessonDraft`クライアント関数（AI Lesson Studioコア計画で実装済み）へ`materialTexts`を追加する。

**Files:**
- Modify: `src/lib/ai/generateLessonDraft.ts`, `.test.ts`

**Interfaces:**
- Consumes: 既存の`GenerateLessonDraftInput`・`generateLessonDraft`
- Produces: `GenerateLessonDraftInput`へ`materialTexts?: string[]`追加

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/ai/generateLessonDraft.test.ts`へ追記する（既存のテストファイルを先に読み、既存のモックパターンに合わせること）:

```ts
it('forwards materialTexts to the Callable when provided', async () => {
  const callMock = vi.fn().mockResolvedValue({ data: { title: 'x', description: 'y' } })
  vi.mocked(httpsCallable).mockReturnValue(callMock as never)
  const input = { theme: 't', mainObjective: 'm', subject: 'SOCIAL_STUDIES' as const, difficulty: 'STANDARD' as const, materialTexts: ['資料テキスト'] }
  await generateLessonDraft({} as never, input)
  expect(callMock).toHaveBeenCalledWith(input)
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/ai/generateLessonDraft.test.ts`
Expected: FAIL（型エラー——`materialTexts`が`GenerateLessonDraftInput`に存在しない）

- [ ] **Step 3: `generateLessonDraft.ts`を拡張する**

`src/lib/ai/generateLessonDraft.ts`の`GenerateLessonDraftInput`へフィールドを追加する:

```ts
export interface GenerateLessonDraftInput {
  theme: string
  mainObjective: string
  subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS'
  difficulty: 'BASIC' | 'STANDARD' | 'ADVANCED'
  materialTexts?: string[]
}
```

（関数本体は変更不要——`call(input)`はそのまま新フィールドを含めて渡す。）

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/lib/ai/generateLessonDraft.test.ts`
Expected: PASS

- [ ] **Step 5: `npm run typecheck`**

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/generateLessonDraft.ts src/lib/ai/generateLessonDraft.test.ts
git commit -m "feat: extend client generateLessonDraft wrapper with optional materialTexts"
```

---

### Task 7: 資料アップロードパネル（一覧・選択・アップロードUI）

アップロード済み資料の一覧表示・新規アップロード・AI再提案に使う資料のチェックボックス選択を行うコンポーネントを実装する。

**Files:**
- Create: `src/components/teacher/templates/materials/MaterialUploadPanel.tsx`, `.test.tsx`

**Interfaces:**
- Consumes: `MaterialDocument`・`uploadMaterial`・`listMaterials`（Task 4）
- Produces: `MaterialUploadPanelProps`型、`MaterialUploadPanel`コンポーネント

- [ ] **Step 1: 失敗するテストを書く**

`src/components/teacher/templates/materials/MaterialUploadPanel.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MaterialUploadPanel } from './MaterialUploadPanel'
import type { MaterialDocument } from '../../../../lib/ai/materialsRepository'

const materials: MaterialDocument[] = [{ id: 'mat-1', fileName: '教科書.pdf', text: '内容', pageCount: 5 }]

describe('MaterialUploadPanel', () => {
  it('renders each uploaded material\'s file name', () => {
    render(<MaterialUploadPanel materials={materials} uploading={false} onUpload={vi.fn()} selectedIds={[]} onSelectionChange={vi.fn()} />)
    expect(screen.getByText('教科書.pdf')).toBeInTheDocument()
  })

  it('calls onSelectionChange with the toggled material id when its checkbox is clicked', () => {
    const onSelectionChange = vi.fn()
    render(<MaterialUploadPanel materials={materials} uploading={false} onUpload={vi.fn()} selectedIds={[]} onSelectionChange={onSelectionChange} />)
    fireEvent.click(screen.getByRole('checkbox', { name: '教科書.pdf' }))
    expect(onSelectionChange).toHaveBeenCalledWith(['mat-1'])
  })

  it('calls onUpload with the selected file', () => {
    const onUpload = vi.fn()
    render(<MaterialUploadPanel materials={[]} uploading={false} onUpload={onUpload} selectedIds={[]} onSelectionChange={vi.fn()} />)
    const file = new File(['x'], 'new.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('資料をアップロード'), { target: { files: [file] } })
    expect(onUpload).toHaveBeenCalledWith(file)
  })

  it('shows an empty-state message when there are no materials yet', () => {
    render(<MaterialUploadPanel materials={[]} uploading={false} onUpload={vi.fn()} selectedIds={[]} onSelectionChange={vi.fn()} />)
    expect(screen.getByText('まだ資料がアップロードされていません。')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/components/teacher/templates/materials/MaterialUploadPanel.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`src/components/teacher/templates/materials/MaterialUploadPanel.tsx`:

```tsx
import { Button, Checkbox, CircularProgress, FormControlLabel, Stack, Typography } from '@mui/material'
import type { MaterialDocument } from '../../../../lib/ai/materialsRepository'

export interface MaterialUploadPanelProps {
  materials: MaterialDocument[]
  uploading: boolean
  onUpload: (file: File) => void
  selectedIds: string[]
  onSelectionChange: (ids: string[]) => void
}

export function MaterialUploadPanel({ materials, uploading, onUpload, selectedIds, onSelectionChange }: MaterialUploadPanelProps) {
  const toggle = (id: string) =>
    onSelectionChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id])

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle1">参考資料</Typography>
      {materials.length === 0 && <Typography variant="body2" color="text.secondary">まだ資料がアップロードされていません。</Typography>}
      {materials.map((material) => (
        <FormControlLabel
          key={material.id}
          control={<Checkbox checked={selectedIds.includes(material.id)} onChange={() => toggle(material.id)} />}
          label={material.fileName}
        />
      ))}
      <Button component="label" variant="outlined" disabled={uploading} sx={{ alignSelf: 'flex-start' }}>
        資料をアップロード
        {uploading && <CircularProgress size={16} sx={{ ml: 1 }} />}
        <input
          type="file" hidden aria-label="資料をアップロード" accept=".pdf,.txt,text/plain,application/pdf"
          onChange={(e) => { const file = e.target.files?.[0]; if (file) onUpload(file) }}
        />
      </Button>
    </Stack>
  )
}
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/components/teacher/templates/materials/MaterialUploadPanel.test.tsx`
Expected: PASS

- [ ] **Step 5: `npm run typecheck`**

- [ ] **Step 6: Commit**

```bash
git add src/components/teacher/templates/materials/MaterialUploadPanel.tsx src/components/teacher/templates/materials/MaterialUploadPanel.test.tsx
git commit -m "feat: add material upload/selection panel"
```

---

### Task 8: `TemplateEditorPage`への統合

フルエディタへ資料タブと「資料を使ってAI提案を更新」アクションを追加する。結果は既存のタイトル・説明欄へ反映し、新しい確認ゲートは作らない。

**Files:**
- Modify: `src/components/teacher/templates/TemplateEditorPage.tsx`, `.test.tsx`
- Modify: `src/App.tsx`, `.test.tsx`

**Interfaces:**
- Consumes: `MaterialUploadPanel`（Task 7）、`uploadMaterial`・`listMaterials`（Task 4）、`generateLessonDraft`（Task 6、`materialTexts`込み）
- Produces: `TemplateEditorPageProps`への`templateId: string`・`orgId: string`・`storage: FirebaseStorage`・`firestore: Firestore`・`functions: Functions`・`aiEnabled: boolean`プロパティ追加（既存コンポーネントの拡張）

- [ ] **Step 1: 失敗するテストを書く**

`src/components/teacher/templates/TemplateEditorPage.test.tsx`に追記する（既存のテストファイル・フィクスチャ・モックパターンを先に読み、それに揃えること）:

```tsx
it('shows the materials tab and lets a teacher upload a file', async () => {
  // 既存の draft フィクスチャ・onSaveDraft/onPublish モックに、
  // templateId・orgId・storage・firestore・functions・aiEnabled の
  // 新規propsを追加してレンダリングする。
  // 「資料」タブへ切り替え、MaterialUploadPanel が表示されることを確認する。
})

it('applies the AI-regenerated title/description to the editable fields when materials-based regeneration succeeds', async () => {
  // generateLessonDraft をモックし、「資料を使ってAI提案を更新」ボタンを押した後、
  // タイトル・説明の入力欄の値が更新されることを確認する。
  // Firestoreへの書き込み（onSaveDraft）はこの時点では呼ばれないこと（教師が
  // 明示的に「下書き保存」を押すまで書き込まれない）も確認する。
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/components/teacher/templates/TemplateEditorPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: `TemplateEditorPage.tsx`を実装する**

既存の`TemplateEditorPage.tsx`を読み、以下を反映する形で変更する（既存の構造・タブ切り替え・保存/発行ボタンは維持し、資料関連の状態とUIのみ追加すること）:

1. Propsへ`templateId: string`・`orgId: string`・`storage: FirebaseStorage`・`firestore: Firestore`・`functions: Functions`・`aiEnabled: boolean`を追加する。
2. `materials`（`MaterialDocument[]`）・`selectedMaterialIds`（`string[]`）・`uploadingMaterial`（`boolean`）・`regeneratingWithAi`（`boolean`）を`useState`で保持する。マウント時に`listMaterials(firestore, templateId)`を呼び`materials`へセットする。
3. タブ構成へ「資料」タブを追加し（`aiEnabled`が`true`の場合のみ表示）、`MaterialUploadPanel`（Task 7）を描画する。アップロード時は`uploadMaterial(storage, firestore, orgId, templateId, file)`を呼び、成功したら`materials`を再取得する。
4. 「資料」タブに「資料を使ってAI提案を更新」ボタンを追加する（`selectedMaterialIds.length > 0`のときのみ有効化）。クリック時に`generateLessonDraft(functions, { theme: content.title, mainObjective: content.description, subject: content.subject, difficulty: 'STANDARD', materialTexts: materials.filter((m) => selectedMaterialIds.includes(m.id)).map((m) => m.text) })`を呼び、成功したら既存の`content`（`title`/`description`）を更新する（`setContent(...)`、Firestoreへは書き込まない）。失敗時はエラーメッセージを表示する。

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/components/teacher/templates/TemplateEditorPage.test.tsx`
Expected: PASS（既存テストも含め全件PASSすることを確認する）

- [ ] **Step 5: `App.tsx`の`TemplateEditRoute`へ新しいpropsを配線する**

`src/App.tsx`の`TemplateEditRoute`内の`<TemplateEditorPage .../>`呼び出しへ、`templateId`（既存の`useParams`から取得済み）・`orgId={personalOrgId(uid)}`・`storage={services.storage}`（`FirebaseServices`型に`storage`が含まれていない場合は追加が必要——既存の`services`構築箇所を確認し、`getStorage(app)`を含める）・`firestore={services.firestore}`・`functions={services.functions}`・`aiEnabled`（`TemplateNewRoute`と同様に組織の`aiEnabled`を読む処理を追加、または共通化する）を渡す。

- [ ] **Step 6: `npm run verify`（全ワークスペース）**

- [ ] **Step 7: Commit**

```bash
git add src/components/teacher/templates/TemplateEditorPage.tsx src/components/teacher/templates/TemplateEditorPage.test.tsx src/App.tsx src/App.test.tsx
git commit -m "feat: integrate material upload and AI regeneration into the full editor"
```
