# 派生関係の記録(表示+逆引き) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** テンプレート複製時に複製元のタイトルを記録し、編集画面で「派生元」と「この教材から派生した公開教材一覧(COMMUNITY公開分のみ)」を表示できるようにする。

**Architecture:** `duplicateLessonTemplate`のトランザクションに複製元テンプレート本体の読み取りを1件追加し、`sourceTemplateTitle`として複製先へスナップショット保存する。新規`listTemplateDerivatives`クライアント関数が`sourceTemplateId`+`visibility=='COMMUNITY'`でFirestoreを検索する(既存のCOMMUNITY読み取りルールをそのまま利用、ルール変更不要)。`TemplateEditorPage`に表示専用の2セクションを追加し、`TemplateEditRoute`(`src/App.tsx`)がデータを取得して渡す。

**Tech Stack:** Firebase Cloud Functions (TypeScript)、React + MUI、`firebase/firestore`クライアントSDK、Vitest、React Testing Library。

## Global Constraints

- 正本: `docs/superpowers/specs/2026-08-15-template-derivative-lineage-design.md`。矛盾があれば正本を優先する。
- 逆引き一覧は`visibility=='COMMUNITY'`の派生教材のみ対象(非公開の複製先は表示しない、プライバシー配慮)。
- Firestoreルールの変更は不要(既存のCOMMUNITY読み取りルールをそのまま使う)。
- `sourceTemplateTitle`は複製時点のスナップショットであり、複製元が後で改題・非公開化・削除されても変化しない。

---

### Task 1: 複製時に`sourceTemplateTitle`を記録する

**Files:**
- Modify: `functions/src/lessonTemplates/duplicateLessonTemplate.ts`
- Modify: `functions/src/lessonTemplates/duplicateLessonTemplate.test.ts`

**Interfaces:**
- Produces: `lessonTemplates`ドキュメントに`sourceTemplateTitle: string | null`フィールドが追加される(複製元テンプレート本体に`title`が無い、またはドキュメント自体が存在しない場合は`null`)。Task 3のUIがこのフィールドを表示する。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonTemplates/duplicateLessonTemplate.test.ts`の最初のテスト(`'carries over title/description/subject from the source version...'`)内、`const fake = makeFakeFirestore([{ path: 'lessonTemplates/source-template-1/versions/version-1', data: sourceVersion }])`を以下に置き換える。

```ts
    const fake = makeFakeFirestore([
      { path: 'lessonTemplates/source-template-1/versions/version-1', data: sourceVersion },
      { path: 'lessonTemplates/source-template-1', data: { title: '元の授業', orgId: 'org-source' } },
    ])
```

同じテスト内、`expect(newTemplate).toMatchObject({...})`の中身に`sourceTemplateTitle: '元の授業',`を追加する。

```ts
    expect(newTemplate).toMatchObject({
      orgId: 'org-target',
      createdByUid: 'teacher-target',
      status: 'DRAFT',
      visibility: 'PRIVATE',
      currentPublishedVersionId: null,
      sourceTemplateId: 'source-template-1',
      sourceVersionId: 'version-1',
      sourceTemplateTitle: '元の授業',
      draft: sourceContent,
    })
```

ファイル末尾(最後の`it(...)`ブロックの後、`describe`を閉じる`})`の直前)に新しいテストを追記する。

```ts
  it('records sourceTemplateTitle as null when the source template document itself is missing', async () => {
    const fake = makeFakeFirestore([{ path: 'lessonTemplates/source-template-1/versions/version-1', data: sourceVersion }])
    await duplicateLessonTemplate(makeDeps(fake), {
      sourceTemplateId: 'source-template-1', sourceVersionId: 'version-1', targetOrgId: 'org-target',
      uid: 'teacher-target', confirmedOverrides: {}, idempotencyKey: 'key-1',
    })
    const newTemplate = fake.docs.get('lessonTemplates/template-copy-1')
    expect(newTemplate?.sourceTemplateTitle).toBeNull()
  })
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/duplicateLessonTemplate.test.ts`
Expected: FAIL(現行実装は複製元テンプレート本体を読まず、`sourceTemplateTitle`を書き込まない)。

- [ ] **Step 3: 実装を追加する**

`functions/src/lessonTemplates/duplicateLessonTemplate.ts`の以下の箇所を:

```ts
    const sourceVersionSnap = await tx.get(sourceVersionPath)
    if (!sourceVersionSnap.exists || !sourceVersionSnap.data) {
      throw new Error('Source lesson version not found')
    }
    if (sourceVersionSnap.data.templateId !== input.sourceTemplateId) {
      throw new Error('Source lesson version does not belong to the expected template')
    }
```

以下に置き換える。

```ts
    const sourceVersionSnap = await tx.get(sourceVersionPath)
    if (!sourceVersionSnap.exists || !sourceVersionSnap.data) {
      throw new Error('Source lesson version not found')
    }
    if (sourceVersionSnap.data.templateId !== input.sourceTemplateId) {
      throw new Error('Source lesson version does not belong to the expected template')
    }

    // Snapshotted at copy time so display never depends on being able to
    // read the source template later — it may since become unpublished,
    // deleted, or renamed.
    const sourceTemplateSnap = await tx.get(`lessonTemplates/${input.sourceTemplateId}`)
    const sourceTemplateTitle = sourceTemplateSnap.exists ? ((sourceTemplateSnap.data?.title as string | undefined) ?? null) : null
```

`tx.set(templatePath, {...})`内の`sourceVersionId: input.sourceVersionId,`の直後に1行追加する。

```ts
      sourceTemplateId: input.sourceTemplateId,
      sourceVersionId: input.sourceVersionId,
      sourceTemplateTitle,
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/duplicateLessonTemplate.test.ts`
Expected: 全件PASS(新規2件 + 既存6件)。

- [ ] **Step 5: 型チェックとfunctions全体のテストを実行する**

Run: `cd functions && npx tsc --noEmit && npx vitest run`
Expected: エラーなし、全テストPASS。

- [ ] **Step 6: コミット**

```bash
git add functions/src/lessonTemplates/duplicateLessonTemplate.ts functions/src/lessonTemplates/duplicateLessonTemplate.test.ts
git commit -m "feat: テンプレート複製時にsourceTemplateTitleを記録する"
```

---

### Task 2: 派生教材の逆引きクエリと複合インデックスを追加する

**Files:**
- Create: `src/lib/lessonTemplates/templateDerivatives.ts`
- Test: `src/lib/lessonTemplates/templateDerivatives.test.ts`
- Modify: `firestore.indexes.json`

**Interfaces:**
- Consumes: `src/lib/lessonTemplates/communityTemplates.ts`の`CommunityTemplate`型(既存、サブプロジェクト2で実装済み)
- Produces: `listTemplateDerivatives(firestore: Firestore, sourceTemplateId: string): Promise<CommunityTemplate[]>`。Task 3がこれを呼ぶ。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/lessonTemplates/templateDerivatives.test.ts`を新規作成する。

```ts
import { describe, expect, it, vi } from 'vitest'

const collectionMock = vi.fn(() => ({ __kind: 'collection' }))
const whereMock = vi.fn((...args: unknown[]) => ({ __kind: 'where', args }))
const queryMock = vi.fn((...args: unknown[]) => ({ __kind: 'query', args }))
const getDocsMock = vi.fn()

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => collectionMock(...args),
  where: (...args: unknown[]) => whereMock(...args),
  query: (...args: unknown[]) => queryMock(...args),
  getDocs: (...args: unknown[]) => getDocsMock(...args),
}))

const { listTemplateDerivatives } = await import('./templateDerivatives')

describe('listTemplateDerivatives', () => {
  it('queries by sourceTemplateId and visibility together', async () => {
    getDocsMock.mockResolvedValue({ docs: [] })
    await listTemplateDerivatives({} as never, 'source-1')
    expect(whereMock).toHaveBeenCalledWith('sourceTemplateId', '==', 'source-1')
    expect(whereMock).toHaveBeenCalledWith('visibility', '==', 'COMMUNITY')
  })

  it('maps Firestore docs into CommunityTemplate objects', async () => {
    getDocsMock.mockResolvedValue({
      docs: [{ id: 't2', data: () => ({ title: '派生教材', description: '説明', subject: 'HOME_ECONOMICS', currentPublishedVersionId: 'v2' }) }],
    })
    const result = await listTemplateDerivatives({} as never, 'source-1')
    expect(result).toEqual([{ id: 't2', title: '派生教材', description: '説明', subject: 'HOME_ECONOMICS', currentPublishedVersionId: 'v2' }])
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run src/lib/lessonTemplates/templateDerivatives.test.ts`
Expected: FAIL(`./templateDerivatives`モジュールが存在しない)。

- [ ] **Step 3: 実装を追加する**

`src/lib/lessonTemplates/templateDerivatives.ts`を新規作成する。

```ts
import { collection, getDocs, query, where, type Firestore } from 'firebase/firestore'
import type { CommunityTemplate } from './communityTemplates'

/** COMMUNITY公開済みの派生教材のみを対象とする(非公開の複製先は他組織のプライバシーに配慮して表示しない)。 */
export const listTemplateDerivatives = async (firestore: Firestore, sourceTemplateId: string): Promise<CommunityTemplate[]> => {
  const snapshot = await getDocs(query(
    collection(firestore, 'lessonTemplates'),
    where('sourceTemplateId', '==', sourceTemplateId),
    where('visibility', '==', 'COMMUNITY'),
  ))
  return snapshot.docs.map((docSnap) => {
    const data = docSnap.data() as { title: string; description: string; subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS'; currentPublishedVersionId: string }
    return { id: docSnap.id, title: data.title, description: data.description, subject: data.subject, currentPublishedVersionId: data.currentPublishedVersionId }
  })
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `npx vitest run src/lib/lessonTemplates/templateDerivatives.test.ts`
Expected: 全件PASS。

- [ ] **Step 5: `firestore.indexes.json`に複合インデックスを追加する**

`firestore.indexes.json`の`indexes`配列末尾(既存の最後の`lessonTemplates`インデックスの後)に追加する。

```json
    {
      "collectionGroup": "lessonTemplates",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "sourceTemplateId", "order": "ASCENDING" },
        { "fieldPath": "visibility", "order": "ASCENDING" }
      ]
    }
```

- [ ] **Step 6: 型チェックを実行する**

Run: `npx tsc -b`
Expected: エラーなし。

- [ ] **Step 7: コミット**

```bash
git add src/lib/lessonTemplates/templateDerivatives.ts src/lib/lessonTemplates/templateDerivatives.test.ts firestore.indexes.json
git commit -m "feat: 派生教材の逆引きクエリと複合インデックスを追加する"
```

---

### Task 3: 編集画面に派生元表示・派生教材一覧を追加する

**Files:**
- Modify: `src/lib/lessonTemplates/types.ts`
- Modify: `src/components/teacher/templates/TemplateEditorPage.tsx`
- Modify: `src/components/teacher/templates/TemplateEditorPage.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: Task 2の`listTemplateDerivatives`
- Produces: `TemplateEditorPageProps`に`sourceTemplateId?: string`、`sourceTemplateTitle?: string`、`derivatives: CommunityTemplate[]`を追加(既存の呼び出し元は`derivatives`を渡す必要があるため、テストの共有`props`フィクスチャを1箇所更新する)

- [ ] **Step 1: `LessonTemplate`型に新フィールドを追加する**

`src/lib/lessonTemplates/types.ts`の`LessonTemplate`インターフェースに2行追加する(`updatedAt: Timestamp`の直後)。

```ts
export interface LessonTemplate {
  id: string
  orgId: string
  createdByUid: string
  draft: LessonContent
  currentPublishedVersionId: string | null
  status: 'DRAFT' | 'READY' | 'ARCHIVED'
  visibility: 'PRIVATE' | 'LINK' | 'ORGANIZATION' | 'PUBLIC'
  createdAt: Timestamp
  updatedAt: Timestamp
  sourceTemplateId?: string
  sourceTemplateTitle?: string
}
```

- [ ] **Step 2: 失敗するコンポーネントテストを書く**

`src/components/teacher/templates/TemplateEditorPage.test.tsx`の共有`props`定義を以下に置き換える(`derivatives: []`を追加するだけで、既存の全テストはそのまま通る)。

```ts
  const props = { draft, templateId: 't1', orgId: 'org-1', storage: {} as never, firestore: {} as never, functions: {} as never, onPublish: vi.fn(), saving: false, publishing: false, materialsUploadEnabled: false, derivatives: [] }
```

同じ`describe`ブロックの末尾に新しいテストを追記する。

```ts
  it('shows the source template attribution when sourceTemplateTitle is set', () => {
    render(<TemplateEditorPage {...props} aiEnabled={false} onSaveDraft={vi.fn()} sourceTemplateTitle="元の授業" />)
    expect(screen.getByText(/元の授業/)).toBeInTheDocument()
  })

  it('hides the derivatives section when there are none', () => {
    render(<TemplateEditorPage {...props} aiEnabled={false} onSaveDraft={vi.fn()} />)
    expect(screen.queryByText('この教材から派生した公開教材')).not.toBeInTheDocument()
  })

  it('lists derivative templates when present', () => {
    render(<TemplateEditorPage {...props} aiEnabled={false} onSaveDraft={vi.fn()} derivatives={[
      { id: 'd1', title: '派生教材A', description: '説明A', subject: 'SOCIAL_STUDIES', currentPublishedVersionId: 'v1' },
    ]} />)
    expect(screen.getByText('この教材から派生した公開教材')).toBeInTheDocument()
    expect(screen.getByText('派生教材A')).toBeInTheDocument()
  })
```

- [ ] **Step 3: テストを実行して失敗を確認する**

Run: `npx vitest run src/components/teacher/templates/TemplateEditorPage.test.tsx`
Expected: FAIL(型エラー: `derivatives`が`TemplateEditorPageProps`に存在しない)。

- [ ] **Step 4: `TemplateEditorPage.tsx`を修正する**

`import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Stack, Tab, Tabs, TextField, Typography } from '@mui/material'`を以下に置き換える。

```ts
import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, List, ListItem, ListItemText, Stack, Tab, Tabs, TextField, Typography } from '@mui/material'
```

`import type { LessonContent } from '../../../lib/lessonTemplates/types'`の直後に追加する。

```ts
import type { CommunityTemplate } from '../../../lib/lessonTemplates/communityTemplates'
```

`export interface TemplateEditorPageProps { ... }`を以下に置き換える。

```ts
export interface TemplateEditorPageProps { draft: LessonContent; templateId: string; orgId: string; storage: FirebaseStorage; firestore: Firestore; functions: Functions; aiEnabled: boolean; materialsUploadEnabled: boolean; onSaveDraft: (content: LessonContent) => void; onPublish: () => void; saving: boolean; publishing: boolean; sourceTemplateId?: string; sourceTemplateTitle?: string; derivatives: CommunityTemplate[] }
```

`export function TemplateEditorPage({ draft, templateId, orgId, storage, firestore, functions, aiEnabled, materialsUploadEnabled, onSaveDraft, onPublish, saving, publishing }: TemplateEditorPageProps) {`を以下に置き換える。

```ts
export function TemplateEditorPage({ draft, templateId, orgId, storage, firestore, functions, aiEnabled, materialsUploadEnabled, onSaveDraft, onPublish, saving, publishing, sourceTemplateTitle, derivatives }: TemplateEditorPageProps) {
```

`return`文冒頭の`<Stack spacing={2} sx={{ p: 2 }}><TextField label="タイトル" ...`の直後(`<TextField label="タイトル" value={content.title} onChange={(e) => setContent({ ...content, title: e.target.value })} />`の直後)に、以下を挿入する。

```tsx
{sourceTemplateTitle && <Typography variant="body2" color="text.secondary">この教材は「{sourceTemplateTitle}」から派生しています。</Typography>}
```

`return`文の末尾、`</Dialog></Stack>`の直前(`onPublish() }}>発行する</Button></DialogActions></Dialog>`の直後)に以下を挿入する。

```tsx
{derivatives.length > 0 && <Stack spacing={1}><Typography variant="subtitle2">この教材から派生した公開教材</Typography><List>{derivatives.map((item) => <ListItem key={item.id}><ListItemText primary={item.title} secondary={item.description} /></ListItem>)}</List></Stack>}
```

- [ ] **Step 5: テストを実行して成功を確認する**

Run: `npx vitest run src/components/teacher/templates/TemplateEditorPage.test.tsx`
Expected: 全件PASS。

- [ ] **Step 6: `App.tsx`の`TemplateEditRoute`を修正する**

`import { CommunityTemplatesPage } from './components/teacher/templates/CommunityTemplatesPage'`の直後に追加する。

```ts
import { listTemplateDerivatives } from './lib/lessonTemplates/templateDerivatives'
```

`TemplateEditRoute`関数を以下に置き換える。

```ts
function TemplateEditRoute({ services }: { services: FirebaseServices }) {
  const { templateId } = useParams<{ templateId: string }>()
  const [draft, setDraft] = useState<LessonContent>()
  const [sourceTemplateTitle, setSourceTemplateTitle] = useState<string>()
  const [derivatives, setDerivatives] = useState<CommunityTemplate[]>([])
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(false)
  const [materialsUploadEnabled, setMaterialsUploadEnabled] = useState(false)
  const uid = services.auth.currentUser?.uid
  useEffect(() => { if (templateId) getDoc(doc(services.firestore, 'lessonTemplates', templateId)).then((snapshot) => { if (snapshot.exists()) { const data = snapshot.data() as LessonTemplate; setDraft(data.draft); setSourceTemplateTitle(data.sourceTemplateTitle) } }) }, [services, templateId])
  useEffect(() => { if (templateId) listTemplateDerivatives(services.firestore, templateId).then(setDerivatives).catch(() => setDerivatives([])) }, [services, templateId])
  useEffect(() => { if (uid) getDoc(doc(services.firestore, 'organizations', personalOrgId(uid))).then((snapshot) => { setAiEnabled(snapshot.exists() && snapshot.data()?.aiEnabled === true); setMaterialsUploadEnabled(snapshot.exists() && snapshot.data()?.materialsUploadEnabled === true) }).catch(() => { setAiEnabled(false); setMaterialsUploadEnabled(false) }) }, [services, uid])
  if (!templateId || !draft) return <GuardLoading />
  return <TemplateEditorPage draft={draft} templateId={templateId} orgId={personalOrgId(uid ?? '')} storage={services.storage} firestore={services.firestore} functions={services.functions} aiEnabled={aiEnabled} materialsUploadEnabled={materialsUploadEnabled} saving={saving} publishing={publishing} sourceTemplateTitle={sourceTemplateTitle} derivatives={derivatives} onSaveDraft={async (content) => { setSaving(true); try { await saveDraft(services.firestore, templateId, content); setDraft(content) } finally { setSaving(false) } }} onPublish={async () => { setPublishing(true); try { await publishLessonVersion(services.functions, { templateId, idempotencyKey: crypto.randomUUID() }) } finally { setPublishing(false) } }} />
}
```

- [ ] **Step 7: プロジェクト全体の型チェックとテストを実行する**

Run: `npx tsc -b && npx tsc -p tsconfig.rules.json && npx vitest run`
Expected: エラーなし、全テストPASS。

- [ ] **Step 8: コミット**

```bash
git add src/lib/lessonTemplates/types.ts src/components/teacher/templates/TemplateEditorPage.tsx src/components/teacher/templates/TemplateEditorPage.test.tsx src/App.tsx
git commit -m "feat: 編集画面に派生元表示と派生教材一覧を追加する"
```
