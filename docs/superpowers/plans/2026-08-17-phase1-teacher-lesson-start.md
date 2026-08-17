# Phase 1: 教師導線基盤（/teacher ホーム + 授業開始フロー） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 教師が「教材一覧から公開済みの教材を選ぶ→授業を開始する→Control Roomに入る」を実際のUIから完走できるようにする。あわせて、現在存在しない `/teacher` ホームルートを新設し、[src/App.tsx:823](../../../src/App.tsx:823) の壊れた `navigate('/teacher')` を機能させる。

**Architecture:** バックエンドの `createLessonRunCallable` とそのクライアントラッパー `createLessonRun`（[src/lib/lessonRuns/createLessonRun.ts](../../../src/lib/lessonRuns/createLessonRun.ts)）は既に完成しているため、このフェーズはフロントエンドのみ。既存コードベースの慣習（プレゼンテーション部品は純粋なprops駆動でMUI + 1行スタイルのJSX、コンテナ("Route")は `App.tsx` 内の関数として状態とFirebase呼び出しを持つ）に従う。新規コンポーネントは2つ: `TeacherHomePage`（`/teacher` の中身）と `StartLessonDialog`（教材編集画面から開く授業開始ダイアログ）。どちらも既存の `TemplateListPage`/`SchoolOrgNewRoute` と同じ設計パターンを踏襲する。

**Tech Stack:** React + TypeScript, MUI, React Router, Vitest + @testing-library/react, Firebase (Functions callable経由)

## Global Constraints

- 新規プレゼンテーション部品はFirebase SDKの型（`Functions`, `Firestore`等）を直接受け取らず、コールバック props（`onXxx`）と状態のprops駆動で作る — 既存の `TemplateListPage`/`StartLessonDialog` 系と同じ設計
- ルートコンテナは `App.tsx` に既存の他ルートコンテナと同じ場所・同じ命名規則（`XxxRoute`）で追加する
- 授業開始時の `expectedParticipants` はバックエンド（`createLessonRunCallable`）が 1〜80 の整数のみ許可するため、クライアント側でも同じ範囲をバリデーションする（サーバー側検証を信頼して省略しない — ユーザー体験として即座にエラーを出すため）
- エラーメッセージは既存の `describeError(error, fallback)`（[src/lib/monitoring/describeError.ts](../../../src/lib/monitoring/describeError.ts)）を使い、日本語の固定文言をフォールバックとして渡す
- 既存テストとlint/typecheckを壊さない: 各タスックの最後に `npm run lint`, `npm run typecheck`, `npm test -- <対象ファイル>` を通す

---

## Task 1: `TeacherHomePage` プレゼンテーション部品

**Files:**
- Create: `src/components/teacher/TeacherHomePage.tsx`
- Test: `src/components/teacher/TeacherHomePage.test.tsx`

**Interfaces:**
- Consumes: なし（純粋なpropsのみ）
- Produces: `TeacherHomePage` コンポーネントと `TeacherHomePageProps` 型。Task 2 の `TeacherHomeRoute` コンテナがこれを利用する。

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/teacher/TeacherHomePage.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TeacherHomePage } from './TeacherHomePage'

describe('TeacherHomePage', () => {
  it('navigates to templates and marketplace when the respective buttons are clicked', () => {
    const onOpenTemplates = vi.fn()
    const onOpenMarketplace = vi.fn()
    render(<TeacherHomePage onOpenTemplates={onOpenTemplates} onOpenMarketplace={onOpenMarketplace} />)
    fireEvent.click(screen.getByRole('button', { name: '教材を管理する' }))
    fireEvent.click(screen.getByRole('button', { name: 'コミュニティ教材を見る' }))
    expect(onOpenTemplates).toHaveBeenCalled()
    expect(onOpenMarketplace).toHaveBeenCalled()
  })

  it('renders a heading identifying the teacher home', () => {
    render(<TeacherHomePage onOpenTemplates={vi.fn()} onOpenMarketplace={vi.fn()} />)
    expect(screen.getByRole('heading', { name: '教師ホーム' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/teacher/TeacherHomePage.test.tsx`
Expected: FAIL — `Cannot find module './TeacherHomePage'` (file doesn't exist yet)

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/teacher/TeacherHomePage.tsx
import { Button, Card, CardActionArea, CardContent, Stack, Typography } from '@mui/material'

export interface TeacherHomePageProps {
  onOpenTemplates: () => void
  onOpenMarketplace: () => void
}

export function TeacherHomePage({ onOpenTemplates, onOpenMarketplace }: TeacherHomePageProps) {
  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography variant="h5" component="h1">教師ホーム</Typography>
      <Card variant="outlined">
        <CardActionArea onClick={onOpenTemplates} sx={{ p: 2 }}>
          <CardContent sx={{ p: 0 }}>
            <Typography variant="h6" component="h2">教材</Typography>
            <Typography color="text.secondary">教材を作成・編集し、授業を開始します。</Typography>
          </CardContent>
        </CardActionArea>
        <Stack sx={{ p: 2, pt: 0 }}>
          <Button variant="contained" onClick={onOpenTemplates} sx={{ alignSelf: 'flex-start' }}>教材を管理する</Button>
        </Stack>
      </Card>
      <Card variant="outlined">
        <CardActionArea onClick={onOpenMarketplace} sx={{ p: 2 }}>
          <CardContent sx={{ p: 0 }}>
            <Typography variant="h6" component="h2">コミュニティ教材</Typography>
            <Typography color="text.secondary">他の教師が公開した教材を探します。</Typography>
          </CardContent>
        </CardActionArea>
        <Stack sx={{ p: 2, pt: 0 }}>
          <Button variant="outlined" onClick={onOpenMarketplace} sx={{ alignSelf: 'flex-start' }}>コミュニティ教材を見る</Button>
        </Stack>
      </Card>
    </Stack>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/teacher/TeacherHomePage.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/teacher/TeacherHomePage.tsx src/components/teacher/TeacherHomePage.test.tsx
git commit -m "feat: add TeacherHomePage presentational component"
```

---

## Task 2: `/teacher` ルートの新設と壊れたナビゲーションの修正

**Files:**
- Modify: `src/App.tsx` (import追加、`TeacherHomeRoute` コンテナ関数追加、`AppRoutes` にルート追加)

**Interfaces:**
- Consumes: `TeacherHomePage`/`TeacherHomePageProps`（Task 1）, 既存の `TemplateRouteGuard`, `FirebaseServices` 型
- Produces: `/teacher` ルート。[src/App.tsx:823](../../../src/App.tsx:823) の `navigate('/teacher')`（`purgeSchoolOrg` 成功後の遷移）が実際に到達可能になる。

- [ ] **Step 1: Add the import**

`src/App.tsx` の他の `./components/teacher/...` インポート群（16行目付近、`import { LessonControlRoom } from './components/teacher/LessonControlRoom'` の近く）に1行追加:

```tsx
import { TeacherHomePage } from './components/teacher/TeacherHomePage'
```

- [ ] **Step 2: Add the `TeacherHomeRoute` container**

`TemplateRouteGuard` の直後（[src/App.tsx:284](../../../src/App.tsx:284) 付近、`TemplateListRoute` の直前）に追加:

```tsx
function TeacherHomeRoute({ services }: { services: FirebaseServices }) {
  const navigate = useNavigate()
  return <TeacherHomePage onOpenTemplates={() => navigate('/teacher/templates')} onOpenMarketplace={() => navigate('/teacher/marketplace')} />
}
```

（`services` は現時点では未使用だが、後続フェーズ(Phase 2以降で「最近の授業」などを表示する際)でFirestore読み取りに使うため、他の `XxxRoute` と同じ `{ services }: { services: FirebaseServices }` シグネチャに揃えておく。ESLintの未使用変数ルールに引っかかる場合は `_services` にリネームするのではなく、分割代入を `services: _services` にせず素直に受け取ったままにする — 他の `XxxRoute` 関数もpropsの分割代入自体はlintエラーにならない。)

- [ ] **Step 3: Add the route entry**

`AppRoutes` 内、`/teacher/templates` ルートの直前（[src/App.tsx:1298](../../../src/App.tsx:1298) の直前）に追加:

```tsx
  <Route path="/teacher" element={enabled && services ? <TemplateRouteGuard services={services}><TeacherHomeRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
```

- [ ] **Step 4: Verify typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: 両方とも0エラー

- [ ] **Step 5: Manual route smoke test**

Run: `npm test -- src/components/teacher/TeacherHomePage.test.tsx` (再確認のみ、`App.tsx` 自体には既存のルートレベルテストが無いため新規追加はしない — ルーティングの結線はTask 1のユニットテストと型チェックでカバーする)

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add /teacher home route, fixing broken navigate('/teacher') after org purge"
```

---

## Task 3: `StartLessonDialog` プレゼンテーション部品

**Files:**
- Create: `src/components/teacher/templates/StartLessonDialog.tsx`
- Test: `src/components/teacher/templates/StartLessonDialog.test.tsx`

**Interfaces:**
- Consumes: なし（純粋なpropsのみ）
- Produces: `StartLessonDialog` コンポーネントと `StartLessonDialogProps` 型。Task 4 の `TemplateEditRoute` がこれを利用する。`onStart` は `(expectedParticipants: number) => void` — 呼び出し元が非同期処理と失敗時の `error` prop 更新を担当する（`SchoolOrgNewRoute` の `onClick={async () => {...}}` パターンと同じ責務分担）。

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/teacher/templates/StartLessonDialog.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StartLessonDialog } from './StartLessonDialog'

describe('StartLessonDialog', () => {
  it('starts a lesson with the entered participant count', () => {
    const onStart = vi.fn()
    render(<StartLessonDialog open onClose={vi.fn()} onStart={onStart} starting={false} />)
    fireEvent.change(screen.getByLabelText('想定人数'), { target: { value: '35' } })
    fireEvent.click(screen.getByRole('button', { name: '開始する' }))
    expect(onStart).toHaveBeenCalledWith(35)
  })

  it('disables the start button when participant count is out of range', () => {
    render(<StartLessonDialog open onClose={vi.fn()} onStart={vi.fn()} starting={false} />)
    fireEvent.change(screen.getByLabelText('想定人数'), { target: { value: '0' } })
    expect(screen.getByRole('button', { name: '開始する' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('想定人数'), { target: { value: '81' } })
    expect(screen.getByRole('button', { name: '開始する' })).toBeDisabled()
  })

  it('disables the start button while starting', () => {
    render(<StartLessonDialog open onClose={vi.fn()} onStart={vi.fn()} starting />)
    expect(screen.getByRole('button', { name: '開始する' })).toBeDisabled()
  })

  it('shows the error message when provided', () => {
    render(<StartLessonDialog open onClose={vi.fn()} onStart={vi.fn()} starting={false} error="失敗しました" />)
    expect(screen.getByText('失敗しました')).toBeInTheDocument()
  })

  it('calls onClose when cancelled', () => {
    const onClose = vi.fn()
    render(<StartLessonDialog open onClose={onClose} onStart={vi.fn()} starting={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/teacher/templates/StartLessonDialog.test.tsx`
Expected: FAIL — `Cannot find module './StartLessonDialog'`

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/teacher/templates/StartLessonDialog.tsx
import { useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from '@mui/material'

export interface StartLessonDialogProps {
  open: boolean
  onClose: () => void
  onStart: (expectedParticipants: number) => void
  starting: boolean
  error?: string
}

const MIN_PARTICIPANTS = 1
const MAX_PARTICIPANTS = 80

export function StartLessonDialog({ open, onClose, onStart, starting, error }: StartLessonDialogProps) {
  const [expectedParticipants, setExpectedParticipants] = useState(30)
  const inRange = expectedParticipants >= MIN_PARTICIPANTS && expectedParticipants <= MAX_PARTICIPANTS

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>この教材で授業を開始</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField
          label="想定人数"
          type="number"
          value={expectedParticipants}
          onChange={(e) => setExpectedParticipants(Number(e.target.value))}
          slotProps={{ htmlInput: { min: MIN_PARTICIPANTS, max: MAX_PARTICIPANTS } }}
          helperText={`${MIN_PARTICIPANTS}〜${MAX_PARTICIPANTS}人`}
          fullWidth
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={starting}>キャンセル</Button>
        <Button
          variant="contained"
          disabled={starting || !inRange}
          onClick={() => onStart(expectedParticipants)}
        >
          開始する
        </Button>
      </DialogActions>
    </Dialog>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/teacher/templates/StartLessonDialog.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/teacher/templates/StartLessonDialog.tsx src/components/teacher/templates/StartLessonDialog.test.tsx
git commit -m "feat: add StartLessonDialog presentational component"
```

---

## Task 4: `TemplateEditRoute` に授業開始フローを配線

**Files:**
- Modify: `src/App.tsx` (import追加、`TemplateEditRoute` 内に状態とハンドラ追加、`TemplateEditorPage` の下に `StartLessonDialog` を配置)

**Interfaces:**
- Consumes: `StartLessonDialog`（Task 3）, `createLessonRun`（既存, [src/lib/lessonRuns/createLessonRun.ts](../../../src/lib/lessonRuns/createLessonRun.ts)）, `describeError`（既存, [src/lib/monitoring/describeError.ts](../../../src/lib/monitoring/describeError.ts)）
- Produces: 教材編集画面から実際に `lessonRuns` ドキュメントが作成され、教師が `/teacher/lessons/{runId}/control` に遷移できる。Phase 2 以降の生徒導線・Control Room作業はこの `runId` を使って手動/自動テストできるようになる。

- [ ] **Step 1: Add imports**

`src/App.tsx` の import群に追加（`TemplateEditorPage` の import行の近く、`./components/teacher/templates/TemplateEditorPage` の下）:

```tsx
import { StartLessonDialog } from './components/teacher/templates/StartLessonDialog'
import { createLessonRun } from './lib/lessonRuns/createLessonRun'
import { describeError } from './lib/monitoring/describeError'
```

（`createLessonRun`/`describeError` が既に他の場所でimportされていないか確認すること — 現状 `src/App.tsx` はどちらも未importなので新規追加でよい。）

- [ ] **Step 2: Add state and handler to `TemplateEditRoute`**

`TemplateEditRoute` 関数内、既存の `const [publishing, setPublishing] = useState(false)` の直後（[src/App.tsx:576](../../../src/App.tsx:576) 付近）に追加:

```tsx
  const [startDialogOpen, setStartDialogOpen] = useState(false)
  const [startingLesson, setStartingLesson] = useState(false)
  const [startLessonError, setStartLessonError] = useState<string>()
  const navigate = useNavigate()
```

（`useNavigate` は既に [src/App.tsx:2](../../../src/App.tsx:2) で `react-router` から import済みであることを確認済み — `SchoolOrgNewRoute` 等で既に使われているため追加importは不要。）

`onPublish` ハンドラの直後（[src/App.tsx:647](../../../src/App.tsx:647) の `}}` の後、`/>` の前）に、ハンドラ関数として以下を `TemplateEditRoute` 本体（return文の前）に追加:

```tsx
  const handleStartLesson = async (expectedParticipants: number) => {
    if (!templateId) return
    setStartingLesson(true)
    setStartLessonError(undefined)
    try {
      const { lessonRunId } = await createLessonRun(services.functions, {
        templateId,
        lessonRunIdempotencyKey: crypto.randomUUID(),
        expectedParticipants,
      })
      navigate(`/teacher/lessons/${lessonRunId}/control`)
    } catch (error) {
      setStartLessonError(describeError(error, '授業の開始に失敗しました。もう一度お試しください。'))
    } finally {
      setStartingLesson(false)
    }
  }
```

- [ ] **Step 3: Add the "start lesson" button and dialog to the render**

`TemplateEditorPage` は現在 `children` を受け取らない自己完結コンポーネント（自己閉じタグ）なので、`children` 経由でボタンを渡す方式は取らない。代わりに `TemplateEditorPage` の**外側**にボタンとダイアログを並置する、既存コードへの変更が最小の方式を採る。

`TemplateEditRoute` の `return (` の行（[src/App.tsx:610](../../../src/App.tsx:610) 付近、`if (!templateId || !draft || !template) return <GuardLoading />` の直後）から `onPublish` を含む `<TemplateEditorPage ... />` の閉じタグまでを、次のように変更する。

変更前:
```tsx
  if (!templateId || !draft || !template) return <GuardLoading />
  return (
    <TemplateEditorPage
      draft={draft}
      templateId={templateId}
      orgId={template.orgId}
      storage={services.storage}
      firestore={services.firestore}
      functions={services.functions}
      aiEnabled={aiEnabled}
      materialsUploadEnabled={materialsUploadEnabled}
      aiBetaState={aiBetaState}
      saving={saving}
      publishing={publishing}
      sourceTemplateTitle={sourceTemplateTitle}
      derivatives={derivatives}
      moveOperationId={template.moveOperationId}
      onReloadTemplate={loadTemplate}
      onSaveDraft={async (content) => {
        setSaving(true)
        try {
          await saveDraft(services.firestore, templateId, content)
          setDraft(content)
        } finally {
          setSaving(false)
        }
      }}
      onPublish={async () => {
        setPublishing(true)
        try {
          await publishLessonVersion(services.functions, { templateId, idempotencyKey: crypto.randomUUID() })
        } finally {
          setPublishing(false)
        }
      }}
    />
  )
}
```

変更後:
```tsx
  if (!templateId || !draft || !template) return <GuardLoading />
  return (
    <>
      <TemplateEditorPage
        draft={draft}
        templateId={templateId}
        orgId={template.orgId}
        storage={services.storage}
        firestore={services.firestore}
        functions={services.functions}
        aiEnabled={aiEnabled}
        materialsUploadEnabled={materialsUploadEnabled}
        aiBetaState={aiBetaState}
        saving={saving}
        publishing={publishing}
        sourceTemplateTitle={sourceTemplateTitle}
        derivatives={derivatives}
        moveOperationId={template.moveOperationId}
        onReloadTemplate={loadTemplate}
        onSaveDraft={async (content) => {
          setSaving(true)
          try {
            await saveDraft(services.firestore, templateId, content)
            setDraft(content)
          } finally {
            setSaving(false)
          }
        }}
        onPublish={async () => {
          setPublishing(true)
          try {
            await publishLessonVersion(services.functions, { templateId, idempotencyKey: crypto.randomUUID() })
            await loadTemplate()
          } finally {
            setPublishing(false)
          }
        }}
      />
      {template.currentPublishedVersionId && (
        <Button variant="contained" color="secondary" onClick={() => setStartDialogOpen(true)} sx={{ m: 2 }}>
          この教材で授業を開始
        </Button>
      )}
      <StartLessonDialog
        open={startDialogOpen}
        onClose={() => setStartDialogOpen(false)}
        onStart={(expectedParticipants) => { void handleStartLesson(expectedParticipants) }}
        starting={startingLesson}
        error={startLessonError}
      />
    </>
  )
}
```

**`await loadTemplate()` を `onPublish` に追加した理由:** 公開後に `template.currentPublishedVersionId` が更新されないと、公開直後に「この教材で授業を開始」ボタンが出現しない（`template` state が古いまま）。既存の `loadTemplate` コールバックを再利用する。これはバグ修正を兼ねるが、Phase 1のスコープに直結するため同タスクに含める。

- [ ] **Step 4: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: 0エラー。JSXフラグメント（`<>...</>`）の閉じ忘れに注意 — `<TemplateEditorPage ... />` の自己閉じタグと、後続の `<Button>`/`<StartLessonDialog>`/`</>` のネストを崩さないこと。

- [ ] **Step 5: Manual verification via dev server**

Run: `npm run dev` を起動し、ブラウザで公開済み教材の編集画面（`/teacher/templates/:templateId/edit`）を開く。「この教材で授業を開始」ボタンが表示され、クリックするとダイアログが開き、想定人数を入力して「開始する」を押すと `/teacher/lessons/{runId}/control` に遷移することを確認する。未公開教材（`currentPublishedVersionId` が `null`）ではボタンが表示されないことも確認する。

- [ ] **Step 6: Run full test suite for touched files**

Run: `npm test -- src/App.tsx src/components/teacher/templates/StartLessonDialog.test.tsx src/components/teacher/TeacherHomePage.test.tsx`
Expected: 既存のApp.tsx関連テスト（もしあれば）も含めてすべてPASS

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire StartLessonDialog into template editor, enabling teachers to start a lesson run from a published template"
```

---

## Task 5: Phase 1完了確認

- [ ] **Step 1: Run the full verification suite**

Run: `npm run verify`
Expected: lint, typecheck, tests, rules, build すべてPASS

- [ ] **Step 2: Manual end-to-end smoke test**

1. `npm run dev` でローカル起動（エミュレータ使用時は `VITE_USE_EMULATORS=true`）
2. 教師としてログインし `/teacher` にアクセス → `TeacherHomePage` が表示され、「教材を管理する」で `/teacher/templates` に遷移することを確認
3. 公開済み教材の編集画面で「この教材で授業を開始」→ 想定人数入力 → 開始 → `/teacher/lessons/{runId}/control` に遷移し `LessonControlRoom` が表示されることを確認
4. 未公開教材では開始ボタンが出ないことを確認
5. 学校組織のメンバー削除（`purgeSchoolOrg`）を実行し、成功後に `/teacher` へ遷移してエラーにならないことを確認（従来は存在しないルートに飛んでいた）

- [ ] **Step 3: Update the roadmap**

[docs/superpowers/plans/2026-08-17-production-readiness-roadmap.md](2026-08-17-production-readiness-roadmap.md) の "Phase 1" セクションに完了マーク（`（着手中）` → `（完了）`）を付け、Phase 2着手時にその詳細計画を新規作成する旨を記載する。

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-08-17-production-readiness-roadmap.md
git commit -m "docs: mark Phase 1 complete in production readiness roadmap"
```
