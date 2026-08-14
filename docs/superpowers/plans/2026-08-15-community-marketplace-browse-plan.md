# マーケットプレイス検索・閲覧 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `COMMUNITY`公開テンプレートを科目フィルタ+新着順で一覧・検索でき、他組織の教師がそこから自組織へ複製できるブラウジングUIを提供する。

**Architecture:** 公開時(`publishLessonVersion`)に`title`/`description`/`subject`を`lessonTemplates`直下へ非正規化し、コミュニティ公開時(`publishTemplateToCommunityCallable`)に専用の`publishedToCommunityAt`を記録する。クライアント側`listCommunityTemplates`がFirestoreクエリで一覧を取得し、`CommunityTemplatesPage`(表示専用コンポーネント)+`CommunityMarketplaceRoute`(`/teacher/marketplace`)で表示・複製操作を提供する。複製は既存の`duplicateLessonTemplate` client libをそのまま再利用する。

**Tech Stack:** Firebase Cloud Functions (TypeScript)、React + MUI、`firebase/firestore` クライアントSDK、Vitest、React Testing Library。

## Global Constraints

- 正本: `docs/superpowers/specs/2026-08-15-community-marketplace-browse-design.md`。矛盾があれば正本を優先する。
- 検索は科目フィルタ+`publishedToCommunityAt`降順ソートのみ。全文検索エンジンは導入しない。
- v1はカーソルページネーションなし(`limit(50)`固定)。
- `publishedToCommunityAt`は`publishTemplateToCommunityCallable`のみが更新する(`unpublishTemplateFromCommunityCallable`は触らない)。
- 複製ボタンは`targetOrgId: personalOrgId(uid)`固定(組織選択UIは対象外)。

---

### Task 1: 公開時の非正規化フィールドを追加する

**Files:**
- Modify: `functions/src/lessonTemplates/publishLessonVersion.ts`
- Modify: `functions/src/lessonTemplates/publishLessonVersion.test.ts`
- Modify: `functions/src/lessonTemplates/onCall.ts`
- Modify: `functions/src/lessonTemplates/onCall.test.ts`

**Interfaces:**
- Produces: `lessonTemplates`ドキュメントに`title`/`description`/`subject`(公開のたび更新)、`publishedToCommunityAt`(コミュニティ公開のたび更新)フィールドが追加される。Task 2の`listCommunityTemplates`クエリがこれらのフィールドに依存する。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonTemplates/publishLessonVersion.test.ts`の最初のテスト(`'creates a version doc from the current draft and updates the template pointer/status in one transaction'`)内、`expect(fake.docs.get('lessonTemplates/t1')).toMatchObject(...)`の行を以下に置き換える。

```ts
    expect(fake.docs.get('lessonTemplates/t1')).toMatchObject({
      currentPublishedVersionId: 'version-1', status: 'READY',
      title: 'ドラフト', description: '', subject: 'SOCIAL_STUDIES',
    })
```

`functions/src/lessonTemplates/onCall.test.ts`の`describe('publishTemplateToCommunityCallable', ...)`ブロック内、`'publishes for the template author when a published version exists'`テストの`expect(templateUpdateMock).toHaveBeenCalledWith({ visibility: 'COMMUNITY' })`を以下に置き換える。

```ts
    expect(templateUpdateMock).toHaveBeenCalledWith({ visibility: 'COMMUNITY', publishedToCommunityAt: 'SERVER_TIMESTAMP' })
```

同じファイルの以下のブロックを:

```ts
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ doc: () => ({ get: templateGetMock, update: templateUpdateMock }) }),
}))
```

以下に置き換える(既存の`vi.mock`呼び出しを1つ増やすのではなく、この1つのブロック自体を書き換える)。

```ts
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
  getFirestore: () => ({ doc: () => ({ get: templateGetMock, update: templateUpdateMock }) }),
}))
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/publishLessonVersion.test.ts src/lessonTemplates/onCall.test.ts`
Expected: FAIL(現行実装は`title`/`description`/`subject`/`publishedToCommunityAt`のいずれも書き込まない)。

- [ ] **Step 3: `publishLessonVersion.ts`を修正する**

`functions/src/lessonTemplates/publishLessonVersion.ts`の`tx.set(templatePath, { currentPublishedVersionId: versionId, status: 'READY', updatedAt: now }, { merge: true })`を以下に置き換える。

```ts
    const publishedDraft = templateSnap.data.draft as { title: string; description: string; subject: string }
    tx.set(templatePath, {
      currentPublishedVersionId: versionId, status: 'READY', updatedAt: now,
      title: publishedDraft.title, description: publishedDraft.description, subject: publishedDraft.subject,
    }, { merge: true })
```

- [ ] **Step 4: `onCall.ts`を修正する**

`functions/src/lessonTemplates/onCall.ts`の`import { getFirestore } from 'firebase-admin/firestore'`を以下に置き換える。

```ts
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
```

`publishTemplateToCommunityCallable`内の`await getFirestore().doc(\`lessonTemplates/${request.data.templateId}\`).update({ visibility: 'COMMUNITY' })`を以下に置き換える。

```ts
  await getFirestore().doc(`lessonTemplates/${request.data.templateId}`).update({ visibility: 'COMMUNITY', publishedToCommunityAt: FieldValue.serverTimestamp() })
```

- [ ] **Step 5: テストを実行して成功を確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/publishLessonVersion.test.ts src/lessonTemplates/onCall.test.ts`
Expected: 全件PASS。

- [ ] **Step 6: 型チェックとfunctions全体のテストを実行する**

Run: `cd functions && npx tsc --noEmit && npx vitest run`
Expected: エラーなし、全テストPASS。

- [ ] **Step 7: コミット**

```bash
git add functions/src/lessonTemplates/publishLessonVersion.ts functions/src/lessonTemplates/publishLessonVersion.test.ts functions/src/lessonTemplates/onCall.ts functions/src/lessonTemplates/onCall.test.ts
git commit -m "feat: 公開時にtitle/description/subject/publishedToCommunityAtを記録する"
```

---

### Task 2: `listCommunityTemplates`クエリとFirestore複合インデックスを追加する

**Files:**
- Create: `src/lib/lessonTemplates/communityTemplates.ts`
- Test: `src/lib/lessonTemplates/communityTemplates.test.ts`
- Modify: `firestore.indexes.json`

**Interfaces:**
- Consumes: Task 1が書き込む`lessonTemplates.visibility`/`subject`/`publishedToCommunityAt`/`title`/`description`フィールド
- Produces: `listCommunityTemplates(firestore: Firestore, input?: { subject?: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS' }): Promise<CommunityTemplate[]>`、`interface CommunityTemplate { id: string; title: string; description: string; subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS'; currentPublishedVersionId: string }`。Task 3がこれを呼ぶ。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/lessonTemplates/communityTemplates.test.ts`を新規作成する。

```ts
import { describe, expect, it, vi } from 'vitest'

const collectionMock = vi.fn(() => ({ __kind: 'collection' }))
const whereMock = vi.fn((...args: unknown[]) => ({ __kind: 'where', args }))
const orderByMock = vi.fn((...args: unknown[]) => ({ __kind: 'orderBy', args }))
const limitMock = vi.fn((...args: unknown[]) => ({ __kind: 'limit', args }))
const queryMock = vi.fn((...args: unknown[]) => ({ __kind: 'query', args }))
const getDocsMock = vi.fn()

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => collectionMock(...args),
  where: (...args: unknown[]) => whereMock(...args),
  orderBy: (...args: unknown[]) => orderByMock(...args),
  limit: (...args: unknown[]) => limitMock(...args),
  query: (...args: unknown[]) => queryMock(...args),
  getDocs: (...args: unknown[]) => getDocsMock(...args),
}))

const { listCommunityTemplates } = await import('./communityTemplates')

describe('listCommunityTemplates', () => {
  it('queries by visibility only and orders by publishedToCommunityAt when no subject filter is given', async () => {
    getDocsMock.mockResolvedValue({ docs: [] })
    await listCommunityTemplates({} as never)
    expect(whereMock).toHaveBeenCalledTimes(1)
    expect(whereMock).toHaveBeenCalledWith('visibility', '==', 'COMMUNITY')
    expect(orderByMock).toHaveBeenCalledWith('publishedToCommunityAt', 'desc')
    expect(limitMock).toHaveBeenCalledWith(50)
  })

  it('adds a subject filter when requested', async () => {
    getDocsMock.mockResolvedValue({ docs: [] })
    await listCommunityTemplates({} as never, { subject: 'HOME_ECONOMICS' })
    expect(whereMock).toHaveBeenCalledWith('visibility', '==', 'COMMUNITY')
    expect(whereMock).toHaveBeenCalledWith('subject', '==', 'HOME_ECONOMICS')
  })

  it('maps Firestore docs into CommunityTemplate objects', async () => {
    getDocsMock.mockResolvedValue({
      docs: [{ id: 't1', data: () => ({ title: 'タイトル', description: '説明', subject: 'SOCIAL_STUDIES', currentPublishedVersionId: 'v1' }) }],
    })
    const result = await listCommunityTemplates({} as never)
    expect(result).toEqual([{ id: 't1', title: 'タイトル', description: '説明', subject: 'SOCIAL_STUDIES', currentPublishedVersionId: 'v1' }])
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run src/lib/lessonTemplates/communityTemplates.test.ts`
Expected: FAIL(`./communityTemplates`モジュールが存在しない)。

- [ ] **Step 3: 実装を追加する**

`src/lib/lessonTemplates/communityTemplates.ts`を新規作成する。

```ts
import { collection, getDocs, limit, orderBy, query, where, type Firestore, type QueryConstraint } from 'firebase/firestore'

export interface CommunityTemplate {
  id: string
  title: string
  description: string
  subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS'
  currentPublishedVersionId: string
}

export interface ListCommunityTemplatesInput { subject?: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS' }

export const listCommunityTemplates = async (firestore: Firestore, input: ListCommunityTemplatesInput = {}): Promise<CommunityTemplate[]> => {
  const constraints: QueryConstraint[] = [where('visibility', '==', 'COMMUNITY')]
  if (input.subject) constraints.push(where('subject', '==', input.subject))
  constraints.push(orderBy('publishedToCommunityAt', 'desc'), limit(50))

  const snapshot = await getDocs(query(collection(firestore, 'lessonTemplates'), ...constraints))
  return snapshot.docs.map((docSnap) => {
    const data = docSnap.data() as { title: string; description: string; subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS'; currentPublishedVersionId: string }
    return { id: docSnap.id, title: data.title, description: data.description, subject: data.subject, currentPublishedVersionId: data.currentPublishedVersionId }
  })
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `npx vitest run src/lib/lessonTemplates/communityTemplates.test.ts`
Expected: 全件PASS。

- [ ] **Step 5: `firestore.indexes.json`に複合インデックスを追加する**

`firestore.indexes.json`の`indexes`配列に以下2件を追加する(既存の`templateShares`インデックスの後)。

```json
    {
      "collectionGroup": "lessonTemplates",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "visibility", "order": "ASCENDING" },
        { "fieldPath": "publishedToCommunityAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "lessonTemplates",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "visibility", "order": "ASCENDING" },
        { "fieldPath": "subject", "order": "ASCENDING" },
        { "fieldPath": "publishedToCommunityAt", "order": "DESCENDING" }
      ]
    }
```

- [ ] **Step 6: 型チェックを実行する**

Run: `npx tsc -b`
Expected: エラーなし。

- [ ] **Step 7: コミット**

```bash
git add src/lib/lessonTemplates/communityTemplates.ts src/lib/lessonTemplates/communityTemplates.test.ts firestore.indexes.json
git commit -m "feat: COMMUNITY公開テンプレートの一覧クエリと複合インデックスを追加する"
```

---

### Task 3: ブラウジングUIとルートを追加する

**Files:**
- Create: `src/components/teacher/templates/CommunityTemplatesPage.tsx`
- Test: `src/components/teacher/templates/CommunityTemplatesPage.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: Task 2の`listCommunityTemplates`/`CommunityTemplate`、既存の`src/lib/lessonTemplates/duplicateLessonTemplate.ts`の`duplicateLessonTemplate`、既存の`src/lib/org/personalOrgId.ts`の`personalOrgId`
- Produces: `CommunityTemplatesPage`コンポーネント、`/teacher/marketplace`ルート

- [ ] **Step 1: 失敗するコンポーネントテストを書く**

`src/components/teacher/templates/CommunityTemplatesPage.test.tsx`を新規作成する。

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommunityTemplatesPage } from './CommunityTemplatesPage'

const templates = [
  { id: 't1', title: '公民の授業', description: '説明1', subject: 'SOCIAL_STUDIES' as const, currentPublishedVersionId: 'v1' },
  { id: 't2', title: '家計管理の授業', description: '説明2', subject: 'HOME_ECONOMICS' as const, currentPublishedVersionId: 'v2' },
]

describe('CommunityTemplatesPage', () => {
  it('lists templates and duplicates the selected one on click', () => {
    const onDuplicate = vi.fn()
    render(<CommunityTemplatesPage templates={templates} loading={false} subject={undefined} onSubjectChange={vi.fn()} onDuplicate={onDuplicate} />)
    expect(screen.getByText('公民の授業')).toBeInTheDocument()
    expect(screen.getByText('家計管理の授業')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: '自組織へ複製' })[0])
    expect(onDuplicate).toHaveBeenCalledWith(templates[0])
  })

  it('shows an empty state with no templates', () => {
    render(<CommunityTemplatesPage templates={[]} loading={false} subject={undefined} onSubjectChange={vi.fn()} onDuplicate={vi.fn()} />)
    expect(screen.getByText('公開されている教材がまだありません。')).toBeInTheDocument()
  })

  it('calls onSubjectChange when a subject filter is selected', () => {
    const onSubjectChange = vi.fn()
    render(<CommunityTemplatesPage templates={templates} loading={false} subject={undefined} onSubjectChange={onSubjectChange} onDuplicate={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '公民' }))
    expect(onSubjectChange).toHaveBeenCalledWith('SOCIAL_STUDIES')
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run src/components/teacher/templates/CommunityTemplatesPage.test.tsx`
Expected: FAIL(`./CommunityTemplatesPage`モジュールが存在しない)。

- [ ] **Step 3: コンポーネントを実装する**

`src/components/teacher/templates/CommunityTemplatesPage.tsx`を新規作成する(`TemplateListPage.tsx`と同じ簡素な単一行スタイルを踏襲)。

```tsx
import { Button, CircularProgress, List, ListItem, ListItemText, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import type { CommunityTemplate } from '../../../lib/lessonTemplates/communityTemplates'

export interface CommunityTemplatesPageProps {
  templates: CommunityTemplate[]
  loading: boolean
  subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS' | undefined
  onSubjectChange: (subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS' | undefined) => void
  onDuplicate: (template: CommunityTemplate) => void
}

export function CommunityTemplatesPage({ templates, loading, subject, onSubjectChange, onDuplicate }: CommunityTemplatesPageProps) {
  return <Stack spacing={2} sx={{ p: 2 }}>
    <Typography variant="h5">教材マーケットプレイス</Typography>
    <ToggleButtonGroup exclusive value={subject ?? null} onChange={(_event, value) => onSubjectChange(value ?? undefined)}>
      <ToggleButton value="SOCIAL_STUDIES">公民</ToggleButton>
      <ToggleButton value="HOME_ECONOMICS">家庭科</ToggleButton>
    </ToggleButtonGroup>
    {loading ? <CircularProgress aria-label="読み込み中" /> : templates.length
      ? <List>{templates.map((template) => <ListItem key={template.id} secondaryAction={<Button variant="outlined" onClick={() => onDuplicate(template)}>自組織へ複製</Button>}><ListItemText primary={template.title} secondary={template.description} /></ListItem>)}</List>
      : <Typography color="text.secondary">公開されている教材がまだありません。</Typography>}
  </Stack>
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `npx vitest run src/components/teacher/templates/CommunityTemplatesPage.test.tsx`
Expected: 全件PASS。

- [ ] **Step 5: 失敗するApp.test.tsxテストを書く**

`src/App.test.tsx`冒頭(37-46行目付近)の以下のブロックを:

```ts
vi.mock('firebase/firestore', () => ({
  doc: (...args: Parameters<typeof docMock>) => docMock(...args),
  getDoc: (...args: unknown[]) => getDocMock(...args),
  collection: (...args: Parameters<typeof collectionMock>) => collectionMock(...args),
  getDocs: (...args: unknown[]) => getDocsMock(...args),
  query: (...args: unknown[]) => args[0],
  where: (...args: unknown[]) => args,
  onSnapshot: (...args: Parameters<typeof onSnapshotMock>) => onSnapshotMock(...args),
}))
```

以下に置き換える(`orderBy`/`limit`を追加するだけで、他のエントリは変更しない)。

```ts
vi.mock('firebase/firestore', () => ({
  doc: (...args: Parameters<typeof docMock>) => docMock(...args),
  getDoc: (...args: unknown[]) => getDocMock(...args),
  collection: (...args: Parameters<typeof collectionMock>) => collectionMock(...args),
  getDocs: (...args: unknown[]) => getDocsMock(...args),
  query: (...args: unknown[]) => args[0],
  where: (...args: unknown[]) => args,
  orderBy: (...args: unknown[]) => args,
  limit: (...args: unknown[]) => args,
  onSnapshot: (...args: Parameters<typeof onSnapshotMock>) => onSnapshotMock(...args),
}))
```

`describe('Guided Lesson Builder routes', ...)`ブロックの末尾に追記する。

```ts
  it('routes /teacher/marketplace to the community marketplace and duplicates a listed template', async () => {
    window.history.pushState({}, '', '/teacher/marketplace')
    getDocsMock.mockResolvedValue({
      docs: [{ id: 't1', data: () => ({ title: '公開教材', description: '説明', subject: 'SOCIAL_STUDIES', currentPublishedVersionId: 'v1' }) }],
    })
    callableMock.mockResolvedValue({ data: { templateId: 'copy-1', alreadyDuplicated: false } })
    render(<App isLessonPlatformV2Enabled getServices={getServices} />)
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ status: 'active' }) })
    authStateCallback?.({ uid: 'teacher-uid', emailVerified: true, providerData: [{ providerId: 'google.com' }] })
    expect(await screen.findByRole('heading', { name: '教材マーケットプレイス' })).toBeInTheDocument()
    expect(await screen.findByText('公開教材')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '自組織へ複製' }))
    await waitFor(() => expect(callableMock).toHaveBeenCalled())
    window.history.pushState({}, '', '/')
  })
```

- [ ] **Step 6: テストを実行して失敗を確認する**

Run: `npx vitest run src/App.test.tsx`
Expected: FAIL(`/teacher/marketplace`ルートが存在しない)。

- [ ] **Step 7: `App.tsx`にルートを追加する**

`import { TemplateEditorPage } from './components/teacher/templates/TemplateEditorPage'`の直後に追記する。

```ts
import { CommunityTemplatesPage } from './components/teacher/templates/CommunityTemplatesPage'
import { listCommunityTemplates, type CommunityTemplate } from './lib/lessonTemplates/communityTemplates'
import { duplicateLessonTemplate } from './lib/lessonTemplates/duplicateLessonTemplate'
```

`TemplateListRoute`関数の直後に新しいRoute関数を追加する。

```ts
function CommunityMarketplaceRoute({ services }: { services: FirebaseServices }) {
  const [templates, setTemplates] = useState<CommunityTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [subject, setSubject] = useState<'SOCIAL_STUDIES' | 'HOME_ECONOMICS' | undefined>(undefined)
  useEffect(() => {
    setLoading(true)
    listCommunityTemplates(services.firestore, { subject }).then(setTemplates).finally(() => setLoading(false))
  }, [services, subject])
  const uid = services.auth.currentUser?.uid
  return <CommunityTemplatesPage
    templates={templates} loading={loading} subject={subject} onSubjectChange={setSubject}
    onDuplicate={(template) => {
      if (!uid) return
      void duplicateLessonTemplate(services.functions, {
        sourceTemplateId: template.id, sourceVersionId: template.currentPublishedVersionId,
        targetOrgId: personalOrgId(uid), confirmedOverrides: {}, idempotencyKey: crypto.randomUUID(),
      })
    }}
  />
}
```

`<Route path="/teacher/templates/:templateId/edit" ... />`の直後に追記する。

```tsx
  <Route path="/teacher/marketplace" element={enabled && services ? <TemplateRouteGuard services={services}><CommunityMarketplaceRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
```

- [ ] **Step 8: テストを実行して成功を確認する**

Run: `npx vitest run src/App.test.tsx src/components/teacher/templates/CommunityTemplatesPage.test.tsx`
Expected: 全件PASS。

- [ ] **Step 9: プロジェクト全体の型チェックとテストを実行する**

Run: `npx tsc -b && npx tsc -p tsconfig.rules.json && npx vitest run`
Expected: エラーなし、全テストPASS。

- [ ] **Step 10: コミット**

```bash
git add src/components/teacher/templates/CommunityTemplatesPage.tsx src/components/teacher/templates/CommunityTemplatesPage.test.tsx src/App.tsx src/App.test.tsx
git commit -m "feat: マーケットプレイスのブラウジングUIとルートを追加する"
```
