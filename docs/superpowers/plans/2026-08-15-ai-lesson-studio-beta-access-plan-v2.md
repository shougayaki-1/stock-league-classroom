# AI Lesson Studio 限定ベータアクセス Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI Lesson Studio を運営者が明示許可した教師 UID だけに限定するアクセス制御を完成させる。サーバー側の正本ゲート・Rules ゲートは既に実装済みであることを確認済みのため、本計画は残っているクライアント層(教師ロック UI・operator 管理画面)、legacy migration の運用手順、および全レイヤーの受け入れ検証に絞る。

**Architecture:** `aiBetaAccess/{uid}`(`status === 'APPROVED'` のみ許可)を正本とし、`aiBetaAccessEvents` を追記専用監査、`aiBetaAccessIdempotency` を冪等性ストアとする三層構成(`functions/src/ai/betaAccess.ts`)。Callable 層(`functions/src/ai/onCall.ts`)・Firestore/Storage Rules は既に本設計どおり実装済み。本計画では、教師本人用の `getMyAiBetaAccessCallable` と operator 用の `listAiBetaAccessCallable` / `grantAiBetaAccessCallable` / `revokeAiBetaAccessCallable` を呼び出すクライアント層を新設し、教師 UI をロック表示に対応させ、`/operator/ai-beta` 画面を追加し、legacy migration の実行手順を確立し、最後に全レイヤーを横断検証する。

**Tech Stack:** TypeScript 6, Firebase Cloud Functions v2 (Admin SDK), Firebase Firestore/Storage Security Rules, React 19, React Router 7, Material UI 9, Vitest 4 + Testing Library, `@firebase/rules-unit-testing`。

## 現在の実装状況(2026-08-15 時点で実コードを確認済み)

このタスクの実装計画作成にあたり、`codex/classroom` の実コードを確認した結果、サーバー側は既に本設計の契約で実装済みだった。

- `functions/src/ai/betaAccess.ts` — `AiBetaAccessStatus`、`grantAiBetaAccess`/`revokeAiBetaAccess`(transaction 内で idempotency read → 状態変更 → event → idempotency write を一体化)、`listApprovedAiBetaAccess`、`getAiBetaAccessApproved`(`status === 'APPROVED'` 判定)、`assertAiBetaApproved` を実装済み(`functions/src/ai/betaAccess.test.ts` で検証済み)。
- `functions/src/ai/onCall.ts` — `generateLessonDraftCallable`/`generateTeacherGuidanceCallable` は `assertAiBetaApproved` を dependent read より前に呼ぶ順序で実装済み。`getMyAiBetaAccessCallable`(`{ approved: boolean }` のみ返却)、`listAiBetaAccessCallable`(operator 限定)、`grantAiBetaAccessCallable`(`{ email, reason, idempotencyKey }` 契約、旧 `targetUid` 契約は撤去済み)、`revokeAiBetaAccessCallable`(`{ teacherUid, reason, idempotencyKey }`)を実装済み(`functions/src/ai/onCall.test.ts` で検証済み)。
- `functions/src/index.ts` — 上記5 Callable すべてを export 済み。
- `firestore.rules` — `aiBetaAccess`/`aiBetaAccessEvents`/`aiBetaAccessIdempotency` を教師・operator とも `allow read, write: if false` に変更済み。`aiBetaApproved()` helper を追加し、`lessonTemplates/{templateId}/materials/{materialId}` の `create`/`delete` に適用済み(`test/firestore.rules.test.ts` に該当 describe ブロックあり)。
- `storage.rules` — Firestore を参照する `aiBetaApproved()` helper を追加し、`orgs/{orgId}/materials/**` の両パターンの `write` に適用済み(read は既存条件を維持)。
- `functions/src/ai/migrateLegacyBetaAccess.ts` — legacy `aiBetaAccess/{uid}`(`status` フィールドなし)を scan し、Auth user 存在・`emailVerified`・`google.com` provider を満たすものだけ `APPROVED` へ backfill するスクリプトを実装済み(`--dry-run`/`--apply` CLI、テスト済み)。ただし **npm script 化・デプロイ手順への組み込みは未実施**。

**未着手として本計画がカバーする範囲:**

1. legacy migration の実行手順の確立(npm script 化・deploy 順序の明文化)
2. `src/lib/ai/` のクライアント status/管理 API ラッパー(現状 `src/` 配下に `aiBetaAccess` への参照が一切ない)
3. `/operator/ai-beta` operator UI
4. 教師 UI のロック表示(`TemplateOverviewPage.tsx` の AI 提案カード、`TemplateEditorPage.tsx` の AI 再生成ボタン・資料アップロードパネル)
5. 全レイヤー横断の受け入れ検証、`scope-backlog.md` 更新、コミット、push

サーバー・Rules 層は実装が先行しているため、各タスクの Step 1(failing test)を実行する前に必ず該当ファイルを再読し、本計画の記述と一致しているかを確認すること。もし既に一致しない差分がある場合は、その場で `git diff`/`git log` を確認し、実際のコードを正としてタスクの記述を読み替える。

## Global Constraints

- 正本は `docs/superpowers/specs/2026-08-15-ai-lesson-studio-beta-access-design.md` と `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md`。
- 許可単位は Firebase Auth UID。組織単位許可、学校単位許可、operator 自動許可は作らない。operator も自身の `aiBetaAccess/{uid}.status === 'APPROVED'` がなければ通常の AI 生成 Callable を利用できない(これは既にサーバー側で保証済み)。
- grant の対象指定はメールアドレス完全一致のみ。UID 直接指定 API は存在しない(既にサーバー側で撤去済み)。
- クライアント route guard(`TemplateRouteGuard` 等)や教師 UI のロック表示は UX 境界であり、セキュリティ境界にしない。実際の認可は Callable と Security Rules のみが担う。
- `getMyAiBetaAccessCallable` は本人へ `{ approved: boolean }` のみ返す。operator UID・監査情報は返さない。
- 教師 UI の AI 表示状態は `LOADING | APPROVED | LOCKED | ERROR` の4値。`LOADING`/`ERROR` を `APPROVED` 扱いしない。
- 既存の `aiEnabled`(組織全体の AI 無効化トグル)は本計画で変更しない。`aiEnabled=false` の組織では AI カード自体を非表示にする既存動作を維持し、`aiEnabled=true` の場合にのみベータ許可状態(ロック/承認済み)を追加で表示する。
- operator UI の grant/revoke には理由入力を必須とし、`crypto.randomUUID()` で `idempotencyKey` を生成してから Callable を呼ぶ(`moveLessonTemplate`/`setTemplateCertification` の既存クライアント慣習と同じ)。
- legacy migration は全教師を暗黙許可しない。既存の明示 grant record(Auth user 存在 + `emailVerified` + `google.com` provider を満たすもの)だけを `APPROVED` へ backfill する。migration は `assertAiBetaApproved` の `status` 判定が有効な状態で本番投入される前に実行し終える運用順序を守る(現在の `functions/src/ai/betaAccess.ts` は既に `status` 判定のみで許可しているため、本番 Firestore に legacy record が残っている場合は migration 未実行のままデプロイすると既存の明示許可教師が誤って締め出される)。
- 全検証(`npm run lint`、`npm run typecheck`、`npm test`、`npm run test:rules`、`npm run build`、`npm run verify --workspace=functions`、リポジトリの `npm run verify`)が PASS した後にのみ `docs/superpowers/scope-backlog.md` の Phase 3 限定公開項目を「実装済み」へ更新する。
- 実装完了時は `git push origin codex/classroom` まで行う。

---

### Task 1: Legacy migration の運用手順を確立する(npm script化・deploy順序の明文化)

**Files:**
- Modify: `functions/package.json`
- Modify: `functions/src/ai/migrateLegacyBetaAccess.ts:182-206`(CLI entrypoint の usage 文言確認・変更なしなら不要)
- Test: `functions/src/ai/migrateLegacyBetaAccess.test.ts`(既存。新規テストは追加しないが Step 2 で必ず実行して現状の green を確認する)

**Interfaces:**
- Consumes: `migrateLegacyAiBetaAccess(deps, { dryRun: boolean })`(`functions/src/ai/migrateLegacyBetaAccess.ts:30`)の既存シグネチャ。変更しない。
- Produces: `functions/package.json` の `scripts` に `migrate:ai-beta-legacy:dry-run` / `migrate:ai-beta-legacy:apply` を追加。他タスクはこれを消費しない(運用コマンドのみ)。

このタスクはロジック変更を伴わない運用整備のため、TDD ではなく「既存テストが green であることの確認 → package.json 変更 → 動作確認」の手順にする。

- [ ] **Step 1: 既存の migration テストを実行し green であることを確認する**

Run: `npm test --workspace=functions -- migrateLegacyBetaAccess`
Expected: 4件の `it` がすべて PASS(scan/dry-run 集計、apply 時の書き込み、already-migrated skip、invalid auth user 判定)。

- [ ] **Step 2: `functions/package.json` に migration 用 npm script を追加する**

`functions/package.json` の `"scripts"` オブジェクトに以下を追加する(既存の `"verify"` 行の直後、閉じ `}` の前):

```json
    "migrate:ai-beta-legacy:dry-run": "npm run build && node lib/ai/migrateLegacyBetaAccess.js --dry-run",
    "migrate:ai-beta-legacy:apply": "npm run build && node lib/ai/migrateLegacyBetaAccess.js --apply"
```

- [ ] **Step 3: ビルドして CLI entrypoint が動作することを確認する**

Run: `npm run build --workspace=functions`
Expected: `functions/lib/ai/migrateLegacyBetaAccess.js` が生成される(`require.main === module` ブロックにより CLI として実行可能)。

Run: `node functions/lib/ai/migrateLegacyBetaAccess.js`
Expected: `Usage: node migrateLegacyBetaAccess.js [--dry-run | --apply]` が stderr に出力され、exit code 1(引数なしのため)。これは正常な usage エラーであり、失敗ではない。

- [ ] **Step 4: デプロイ順序をこの計画のドキュメントとして明記する(実行はしない)**

このステップはコードではなく、後段の Task 7(受け入れ検証)で参照する運用手順の確定。本番/ステージング環境へ反映する際は必ず次の順序を守る。

```text
1. functions をビルドする: npm run build --workspace=functions
2. 対象環境の Firebase Admin 資格情報で dry-run を実行し内容を確認する:
   GOOGLE_APPLICATION_CREDENTIALS=<対象環境のサービスアカウントキー> \
     npm run migrate:ai-beta-legacy:dry-run --workspace=functions
   出力の eligible 件数・invalidAuthUser 件数を確認する。
3. 問題なければ apply を実行する:
   GOOGLE_APPLICATION_CREDENTIALS=<対象環境のサービスアカウントキー> \
     npm run migrate:ai-beta-legacy:apply --workspace=functions
4. migrated 件数が期待どおりであることを確認してから、
   status 判定のみで許可する functions のデプロイ(firebase deploy --only functions,firestore:rules,storage)を実行する。
```

`functions/src/ai/betaAccess.ts` の `assertAiBetaApproved` は既に `status === 'APPROVED'` のみを見る実装のため、この順序を逆にすると migration 未実施の legacy 明示許可教師が本番デプロイ直後に締め出される。

- [ ] **Step 5: Commit**

```bash
git add functions/package.json
git commit -m "chore: add legacy AI beta access migration npm scripts"
```

---

### Task 2: 教師本人向け AI ベータ状態のクライアント API を実装する

**Files:**
- Create: `src/lib/ai/aiBetaAccess.ts`
- Create: `src/lib/ai/aiBetaAccess.test.ts`
- Existing dependency: `functions/src/ai/onCall.ts` の `getMyAiBetaAccessCallable`(戻り値 `{ approved: boolean }`)、`listAiBetaAccessCallable`(戻り値 `AiBetaAccessListItem[]`)、`grantAiBetaAccessCallable`(入力 `{ email, reason, idempotencyKey }`、戻り値 `{ changed, teacherUid, deduplicated }`)、`revokeAiBetaAccessCallable`(入力 `{ teacherUid, reason, idempotencyKey }`、戻り値同上)

**Interfaces:**
- Consumes: なし(このタスクが基盤)。
- Produces:

```ts
export interface AiBetaAccessListItem {
  teacherUid: string
  email: string
  approvedByUid: string
  approvedAtMillis: number
}

export interface GrantAiBetaAccessInput { email: string; reason: string; idempotencyKey: string }
export interface RevokeAiBetaAccessInput { teacherUid: string; reason: string; idempotencyKey: string }
export interface AiBetaAccessMutationResult { changed: boolean; teacherUid: string; deduplicated: boolean }

export const getMyAiBetaAccess: (functions: Functions) => Promise<{ approved: boolean }>
export const listAiBetaAccess: (functions: Functions) => Promise<AiBetaAccessListItem[]>
export const grantAiBetaAccess: (functions: Functions, input: GrantAiBetaAccessInput) => Promise<AiBetaAccessMutationResult>
export const revokeAiBetaAccess: (functions: Functions, input: RevokeAiBetaAccessInput) => Promise<AiBetaAccessMutationResult>
```

Task 4(operator UI)と Task 5/6(教師ロック UI)はこれらの関数名・型をそのまま消費する。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/ai/aiBetaAccess.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import {
  getMyAiBetaAccess,
  listAiBetaAccess,
  grantAiBetaAccess,
  revokeAiBetaAccess,
} from './aiBetaAccess'

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

const functions = {} as unknown as import('firebase/functions').Functions

describe('getMyAiBetaAccess', () => {
  it('calls getMyAiBetaAccessCallable and returns the approved flag', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { approved: true } })
    vi.mocked(httpsCallable).mockReturnValue(callable as never)

    const result = await getMyAiBetaAccess(functions)

    expect(httpsCallable).toHaveBeenCalledWith(functions, 'getMyAiBetaAccessCallable')
    expect(result).toEqual({ approved: true })
  })
})

describe('listAiBetaAccess', () => {
  it('calls listAiBetaAccessCallable and returns the list', async () => {
    const items = [{ teacherUid: 't1', email: 'a@example.jp', approvedByUid: 'op-1', approvedAtMillis: 1000 }]
    const callable = vi.fn().mockResolvedValue({ data: items })
    vi.mocked(httpsCallable).mockReturnValue(callable as never)

    const result = await listAiBetaAccess(functions)

    expect(httpsCallable).toHaveBeenCalledWith(functions, 'listAiBetaAccessCallable')
    expect(result).toEqual(items)
  })
})

describe('grantAiBetaAccess', () => {
  it('calls grantAiBetaAccessCallable with the email/reason/idempotencyKey payload', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { changed: true, teacherUid: 't1', deduplicated: false } })
    vi.mocked(httpsCallable).mockReturnValue(callable as never)

    const result = await grantAiBetaAccess(functions, { email: 'a@example.jp', reason: '研修対象', idempotencyKey: 'key-1' })

    expect(httpsCallable).toHaveBeenCalledWith(functions, 'grantAiBetaAccessCallable')
    expect(callable).toHaveBeenCalledWith({ email: 'a@example.jp', reason: '研修対象', idempotencyKey: 'key-1' })
    expect(result).toEqual({ changed: true, teacherUid: 't1', deduplicated: false })
  })
})

describe('revokeAiBetaAccess', () => {
  it('calls revokeAiBetaAccessCallable with the teacherUid/reason/idempotencyKey payload', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { changed: true, teacherUid: 't1', deduplicated: false } })
    vi.mocked(httpsCallable).mockReturnValue(callable as never)

    const result = await revokeAiBetaAccess(functions, { teacherUid: 't1', reason: '利用終了', idempotencyKey: 'key-2' })

    expect(httpsCallable).toHaveBeenCalledWith(functions, 'revokeAiBetaAccessCallable')
    expect(callable).toHaveBeenCalledWith({ teacherUid: 't1', reason: '利用終了', idempotencyKey: 'key-2' })
    expect(result).toEqual({ changed: true, teacherUid: 't1', deduplicated: false })
  })
})
```

- [ ] **Step 2: テストを実行し FAIL することを確認する**

Run: `npx vitest run src/lib/ai/aiBetaAccess.test.ts`
Expected: FAIL — `Failed to resolve import "./aiBetaAccess"`(モジュール未作成)。

- [ ] **Step 3: 最小実装を書く**

`src/lib/ai/aiBetaAccess.ts`:

```ts
import { httpsCallable, type Functions } from 'firebase/functions'

export interface AiBetaAccessListItem {
  teacherUid: string
  email: string
  approvedByUid: string
  approvedAtMillis: number
}

export interface GrantAiBetaAccessInput { email: string; reason: string; idempotencyKey: string }
export interface RevokeAiBetaAccessInput { teacherUid: string; reason: string; idempotencyKey: string }
export interface AiBetaAccessMutationResult { changed: boolean; teacherUid: string; deduplicated: boolean }

export const getMyAiBetaAccess = async (functions: Functions): Promise<{ approved: boolean }> =>
  (await httpsCallable<Record<string, never>, { approved: boolean }>(functions, 'getMyAiBetaAccessCallable')({})).data

export const listAiBetaAccess = async (functions: Functions): Promise<AiBetaAccessListItem[]> =>
  (await httpsCallable<Record<string, never>, AiBetaAccessListItem[]>(functions, 'listAiBetaAccessCallable')({})).data

export const grantAiBetaAccess = async (
  functions: Functions,
  input: GrantAiBetaAccessInput,
): Promise<AiBetaAccessMutationResult> =>
  (await httpsCallable<GrantAiBetaAccessInput, AiBetaAccessMutationResult>(functions, 'grantAiBetaAccessCallable')(input)).data

export const revokeAiBetaAccess = async (
  functions: Functions,
  input: RevokeAiBetaAccessInput,
): Promise<AiBetaAccessMutationResult> =>
  (await httpsCallable<RevokeAiBetaAccessInput, AiBetaAccessMutationResult>(functions, 'revokeAiBetaAccessCallable')(input)).data
```

- [ ] **Step 4: テストを再実行し PASS することを確認する**

Run: `npx vitest run src/lib/ai/aiBetaAccess.test.ts`
Expected: 4件すべて PASS。

- [ ] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: エラーなし。

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/aiBetaAccess.ts src/lib/ai/aiBetaAccess.test.ts
git commit -m "feat: add client wrapper for AI beta access status and admin callables"
```

---

### Task 3: 教師 UI 用の AI ベータ状態フックを実装する

**Files:**
- Create: `src/lib/ai/useAiBetaAccessState.ts`
- Create: `src/lib/ai/useAiBetaAccessState.test.ts`

**Interfaces:**
- Consumes: `getMyAiBetaAccess`(Task 2 の `src/lib/ai/aiBetaAccess.ts`)
- Produces:

```ts
export type AiBetaUiState = 'LOADING' | 'APPROVED' | 'LOCKED' | 'ERROR'
export const useAiBetaAccessState: (functions: Functions) => AiBetaUiState
```

Task 5(`TemplateOverviewPage.tsx`)と Task 6(`TemplateEditorPage.tsx`)がこのフックをそのまま消費する。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/ai/useAiBetaAccessState.test.ts`:

```ts
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import * as aiBetaAccessModule from './aiBetaAccess'
import { useAiBetaAccessState } from './useAiBetaAccessState'

const functions = {} as unknown as import('firebase/functions').Functions

describe('useAiBetaAccessState', () => {
  it('starts as LOADING then becomes APPROVED when the callable resolves approved:true', async () => {
    vi.spyOn(aiBetaAccessModule, 'getMyAiBetaAccess').mockResolvedValue({ approved: true })
    const { result } = renderHook(() => useAiBetaAccessState(functions))
    expect(result.current).toBe('LOADING')
    await waitFor(() => expect(result.current).toBe('APPROVED'))
  })

  it('becomes LOCKED when the callable resolves approved:false', async () => {
    vi.spyOn(aiBetaAccessModule, 'getMyAiBetaAccess').mockResolvedValue({ approved: false })
    const { result } = renderHook(() => useAiBetaAccessState(functions))
    await waitFor(() => expect(result.current).toBe('LOCKED'))
  })

  it('becomes ERROR when the callable rejects, and does not treat that as approved', async () => {
    vi.spyOn(aiBetaAccessModule, 'getMyAiBetaAccess').mockRejectedValue(new Error('network'))
    const { result } = renderHook(() => useAiBetaAccessState(functions))
    await waitFor(() => expect(result.current).toBe('ERROR'))
  })
})
```

- [ ] **Step 2: テストを実行し FAIL することを確認する**

Run: `npx vitest run src/lib/ai/useAiBetaAccessState.test.ts`
Expected: FAIL — `Failed to resolve import "./useAiBetaAccessState"`。

- [ ] **Step 3: 最小実装を書く**

`src/lib/ai/useAiBetaAccessState.ts`:

```ts
import { useEffect, useState } from 'react'
import type { Functions } from 'firebase/functions'
import { getMyAiBetaAccess } from './aiBetaAccess'

export type AiBetaUiState = 'LOADING' | 'APPROVED' | 'LOCKED' | 'ERROR'

export const useAiBetaAccessState = (functions: Functions): AiBetaUiState => {
  const [state, setState] = useState<AiBetaUiState>('LOADING')

  useEffect(() => {
    let cancelled = false
    setState('LOADING')
    getMyAiBetaAccess(functions)
      .then((result) => { if (!cancelled) setState(result.approved ? 'APPROVED' : 'LOCKED') })
      .catch(() => { if (!cancelled) setState('ERROR') })
    return () => { cancelled = true }
  }, [functions])

  return state
}
```

- [ ] **Step 4: テストを再実行し PASS することを確認する**

Run: `npx vitest run src/lib/ai/useAiBetaAccessState.test.ts`
Expected: 3件すべて PASS。

- [ ] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: エラーなし。

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/useAiBetaAccessState.ts src/lib/ai/useAiBetaAccessState.test.ts
git commit -m "feat: add teacher-facing AI beta access UI state hook"
```

---

### Task 4: operator 用 AI ベータアクセス管理画面を実装する

**Files:**
- Create: `src/components/operator/OperatorAiBetaPage.tsx`
- Create: `src/components/operator/OperatorAiBetaPage.test.tsx`

**Interfaces:**
- Consumes: `AiBetaAccessListItem`(Task 2)
- Produces:

```ts
export interface OperatorAiBetaPageProps {
  approvedList: AiBetaAccessListItem[]
  loading: boolean
  accessDenied: boolean
  onGrant: (email: string, reason: string) => Promise<void>
  onRevoke: (teacherUid: string, reason: string) => Promise<void>
}
export function OperatorAiBetaPage(props: OperatorAiBetaPageProps): React.JSX.Element
```

Task 6(App.tsx ルーティング)がこのコンポーネントと props 契約を消費する。

- [ ] **Step 1: 失敗するテストを書く**

`src/components/operator/OperatorAiBetaPage.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { OperatorAiBetaPage } from './OperatorAiBetaPage'

const approvedList = [
  { teacherUid: 't1', email: 'teacher1@example.jp', approvedByUid: 'op-1', approvedAtMillis: 1700000000000 },
]

describe('OperatorAiBetaPage', () => {
  it('shows the access-denied message when accessDenied is true', () => {
    render(<OperatorAiBetaPage approvedList={[]} loading={false} accessDenied onGrant={vi.fn()} onRevoke={vi.fn()} />)
    expect(screen.getByText('この画面は運営者のみ利用できます。')).toBeInTheDocument()
  })

  it('lists approved teachers and lets the operator revoke with a reason', async () => {
    const onRevoke = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<OperatorAiBetaPage approvedList={approvedList} loading={false} accessDenied={false} onGrant={vi.fn()} onRevoke={onRevoke} />)

    expect(screen.getByText('teacher1@example.jp')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '利用許可を取り消す' }))
    await user.type(screen.getByLabelText('取消理由'), '規約違反のため')
    await user.click(screen.getByRole('button', { name: '取消を確定' }))

    await waitFor(() => expect(onRevoke).toHaveBeenCalledWith('t1', '規約違反のため'))
  })

  it('lets the operator grant access by exact email with a required reason', async () => {
    const onGrant = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<OperatorAiBetaPage approvedList={[]} loading={false} accessDenied={false} onGrant={onGrant} onRevoke={vi.fn()} />)

    const grantButton = screen.getByRole('button', { name: 'ベータ利用を許可' })
    expect(grantButton).toBeDisabled()

    await user.type(screen.getByLabelText('教師メールアドレス'), 'teacher2@example.jp')
    await user.type(screen.getByLabelText('許可理由'), '研修プログラム参加者')
    expect(grantButton).toBeEnabled()

    await user.click(grantButton)
    await waitFor(() => expect(onGrant).toHaveBeenCalledWith('teacher2@example.jp', '研修プログラム参加者'))
  })
})
```

- [ ] **Step 2: テストを実行し FAIL することを確認する**

Run: `npx vitest run src/components/operator/OperatorAiBetaPage.test.tsx`
Expected: FAIL — `Failed to resolve import "./OperatorAiBetaPage"`。

- [ ] **Step 3: 最小実装を書く**

`src/components/operator/OperatorAiBetaPage.tsx`:

```tsx
import { useState } from 'react'
import {
  Alert,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { AiBetaAccessListItem } from '../../lib/ai/aiBetaAccess'

export interface OperatorAiBetaPageProps {
  approvedList: AiBetaAccessListItem[]
  loading: boolean
  accessDenied: boolean
  onGrant: (email: string, reason: string) => Promise<void>
  onRevoke: (teacherUid: string, reason: string) => Promise<void>
}

export function OperatorAiBetaPage({ approvedList, loading, accessDenied, onGrant, onRevoke }: OperatorAiBetaPageProps) {
  const [email, setEmail] = useState('')
  const [grantReason, setGrantReason] = useState('')
  const [granting, setGranting] = useState(false)
  const [grantError, setGrantError] = useState('')

  const [revokeTarget, setRevokeTarget] = useState<AiBetaAccessListItem | null>(null)
  const [revokeReason, setRevokeReason] = useState('')
  const [revoking, setRevoking] = useState(false)
  const [revokeError, setRevokeError] = useState('')

  if (accessDenied) {
    return <Stack sx={{ p: 2 }}><Typography color="error">この画面は運営者のみ利用できます。</Typography></Stack>
  }

  const canGrant = email.trim().length > 0 && grantReason.trim().length > 0 && !granting

  const handleGrant = async () => {
    setGranting(true)
    setGrantError('')
    try {
      await onGrant(email.trim(), grantReason.trim())
      setEmail('')
      setGrantReason('')
    } catch (error) {
      setGrantError(error instanceof Error ? error.message : '許可の付与に失敗しました。')
    } finally {
      setGranting(false)
    }
  }

  const handleRevoke = async () => {
    if (!revokeTarget || revokeReason.trim().length === 0) return
    setRevoking(true)
    setRevokeError('')
    try {
      await onRevoke(revokeTarget.teacherUid, revokeReason.trim())
      setRevokeTarget(null)
      setRevokeReason('')
    } catch (error) {
      setRevokeError(error instanceof Error ? error.message : '取消に失敗しました。')
    } finally {
      setRevoking(false)
    }
  }

  return (
    <Stack spacing={2} sx={{ p: 2, maxWidth: 900 }}>
      <Typography variant="h5">AIベータアクセス管理</Typography>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={1.5}>
            <Typography variant="subtitle1">新規許可</Typography>
            {grantError && <Alert severity="error" onClose={() => setGrantError('')}>{grantError}</Alert>}
            <TextField label="教師メールアドレス" value={email} onChange={(e) => setEmail(e.target.value)} disabled={granting} size="small" />
            <TextField label="許可理由" value={grantReason} onChange={(e) => setGrantReason(e.target.value)} disabled={granting} size="small" multiline minRows={2} />
            <Button variant="contained" disabled={!canGrant} onClick={() => void handleGrant()} sx={{ alignSelf: 'flex-start' }}>
              {granting ? <CircularProgress size={20} /> : 'ベータ利用を許可'}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Divider />

      <Typography variant="subtitle1">許可済み教師</Typography>
      {loading ? (
        <CircularProgress aria-label="読み込み中" />
      ) : approvedList.length === 0 ? (
        <Typography color="text.secondary">許可済みの教師はいません。</Typography>
      ) : (
        <List>
          {approvedList.map((item) => (
            <ListItem
              key={item.teacherUid}
              secondaryAction={<Button color="error" onClick={() => setRevokeTarget(item)}>利用許可を取り消す</Button>}
            >
              <ListItemText
                primary={item.email}
                secondary={`許可日時: ${new Date(item.approvedAtMillis).toLocaleString('ja-JP')} / 許可者UID: ${item.approvedByUid}`}
              />
            </ListItem>
          ))}
        </List>
      )}

      <Dialog open={revokeTarget !== null} onClose={() => !revoking && setRevokeTarget(null)}>
        <DialogTitle>利用許可を取り消しますか？</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <DialogContentText>{revokeTarget?.email} のAIベータ利用を取り消します。次回のAI操作から拒否されます。既存の生成教材・資料は削除されません。</DialogContentText>
            {revokeError && <Alert severity="error">{revokeError}</Alert>}
            <TextField label="取消理由" value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} disabled={revoking} multiline minRows={2} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevokeTarget(null)} disabled={revoking}>キャンセル</Button>
          <Button color="error" disabled={revoking || revokeReason.trim().length === 0} onClick={() => void handleRevoke()}>
            {revoking ? <CircularProgress size={20} /> : '取消を確定'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
```

- [ ] **Step 4: テストを再実行し PASS することを確認する**

Run: `npx vitest run src/components/operator/OperatorAiBetaPage.test.tsx`
Expected: 3件すべて PASS。

- [ ] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: エラーなし。

- [ ] **Step 6: Commit**

```bash
git add src/components/operator/OperatorAiBetaPage.tsx src/components/operator/OperatorAiBetaPage.test.tsx
git commit -m "feat: add operator AI beta access management page"
```

---

### Task 5: `/operator/ai-beta` ルートを App.tsx に追加する

**Files:**
- Modify: `src/App.tsx`(import 追加、`OperatorAiBetaRoute` 関数追加、`<Route>` 追加)
- Test: `src/App.test.tsx`

**Interfaces:**
- Consumes: `OperatorAiBetaPage`(Task 4)、`listAiBetaAccess`/`grantAiBetaAccess`/`revokeAiBetaAccess`(Task 2)、既存 `TemplateRouteGuard`(`src/App.tsx:291`、ログイン済み教師かどうかだけを見る UX ガード)
- Produces: ルート `/operator/ai-beta`。他タスクはこれを消費しない。

- [ ] **Step 1: 失敗するテストを書く**

`src/App.test.tsx` の末尾、既存の `it('routes /operator/certifications ...')` ブロックの直後に追加する:

```tsx
  it('routes /operator/ai-beta to the operator AI beta access page and supports grant', async () => {
    window.history.pushState({}, '', '/operator/ai-beta')
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ status: 'active' }) })
    const grantCallable = vi.fn().mockResolvedValue({ data: { changed: true, teacherUid: 't-new', deduplicated: false } })
    httpsCallableMock.mockImplementation((_functions: unknown, name: string) => {
      if (name === 'listAiBetaAccessCallable') {
        return vi.fn().mockResolvedValue({
          data: [{ teacherUid: 't1', email: 'teacher1@example.jp', approvedByUid: 'op-1', approvedAtMillis: 1700000000000 }],
        })
      }
      if (name === 'grantAiBetaAccessCallable') return grantCallable
      return vi.fn().mockResolvedValue({ data: {} })
    })

    render(<App isLessonPlatformV2Enabled getServices={getServices} />)
    authStateCallback?.({ uid: 'operator-uid', emailVerified: true, providerData: [{ providerId: 'google.com' }] })

    expect(await screen.findByRole('heading', { name: 'AIベータアクセス管理' })).toBeInTheDocument()
    expect(await screen.findByText('teacher1@example.jp')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('教師メールアドレス'), 'teacher2@example.jp')
    await user.type(screen.getByLabelText('許可理由'), '研修参加者')
    await user.click(screen.getByRole('button', { name: 'ベータ利用を許可' }))

    await waitFor(() => expect(grantCallable).toHaveBeenCalledWith(expect.objectContaining({ email: 'teacher2@example.jp', reason: '研修参加者' })))
    window.history.pushState({}, '', '/')
  })
```

`userEvent` と `waitFor` が未 import なら `src/App.test.tsx` 冒頭の import に追加する(既存テストで `@testing-library/user-event` が使われていなければ追加、使われていれば流用)。

- [ ] **Step 2: テストを実行し FAIL することを確認する**

Run: `npx vitest run src/App.test.tsx -t "operator/ai-beta"`
Expected: FAIL — `/operator/ai-beta` が既存の `<Route>` 一覧にないため `Navigate replace to="/about"` へ遷移し、`AIベータアクセス管理` の heading が見つからない。

- [ ] **Step 3: 最小実装を書く**

`src/App.tsx` の import 群(`OperatorTemplateCertificationsPage` の import の直後)に追加:

```ts
import { OperatorAiBetaPage } from './components/operator/OperatorAiBetaPage'
import { getMyAiBetaAccess, grantAiBetaAccess, listAiBetaAccess, revokeAiBetaAccess, type AiBetaAccessListItem } from './lib/ai/aiBetaAccess'
```

`OperatorCertificationsRoute` 関数(`src/App.tsx:428` 付近)の直後に新しい route コンポーネントを追加:

```tsx
function OperatorAiBetaRoute({ services }: { services: FirebaseServices }) {
  const [approvedList, setApprovedList] = useState<AiBetaAccessListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)

  const load = () => {
    setLoading(true)
    listAiBetaAccess(services.functions)
      .then((result) => { setApprovedList(result); setAccessDenied(false) })
      .catch(() => setAccessDenied(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [services])

  return (
    <OperatorAiBetaPage
      approvedList={approvedList}
      loading={loading}
      accessDenied={accessDenied}
      onGrant={async (email, reason) => {
        await grantAiBetaAccess(services.functions, { email, reason, idempotencyKey: crypto.randomUUID() })
        load()
      }}
      onRevoke={async (teacherUid, reason) => {
        await revokeAiBetaAccess(services.functions, { teacherUid, reason, idempotencyKey: crypto.randomUUID() })
        load()
      }}
    />
  )
}
```

`AppRoutes` 内の `/operator/certifications` の `<Route>` 定義(`src/App.tsx:1188` 付近)の直後に追加:

```tsx
  <Route path="/operator/ai-beta" element={enabled && services ? <TemplateRouteGuard services={services}><OperatorAiBetaRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
```

`getMyAiBetaAccess` は本タスクではまだ未使用(Task 6/7 で消費する)。import した時点で未使用の lint エラーになるため、このタスクでは `getMyAiBetaAccess` の import を **追加しない**(必要なのは `OperatorAiBetaPage`、`grantAiBetaAccess`、`listAiBetaAccess`、`revokeAiBetaAccess`、`AiBetaAccessListItem` のみ)。上記の import ブロックから `getMyAiBetaAccess` を削除すること。

- [ ] **Step 4: テストを再実行し PASS することを確認する**

Run: `npx vitest run src/App.test.tsx -t "operator/ai-beta"`
Expected: PASS。

- [ ] **Step 5: 既存の App.test.tsx 全体が壊れていないことを確認する**

Run: `npx vitest run src/App.test.tsx`
Expected: 既存テストを含め全件 PASS。

- [ ] **Step 6: lint・typecheck**

Run: `npm run lint && npm run typecheck`
Expected: エラーなし。

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: route /operator/ai-beta to the AI beta access management page"
```

---

### Task 6: `TemplateOverviewPage.tsx` の AI 提案カードをロック表示対応にする

**Files:**
- Modify: `src/components/teacher/templates/TemplateOverviewPage.tsx`
- Test: `src/components/teacher/templates/TemplateOverviewPage.test.tsx`

**Interfaces:**
- Consumes: `AiBetaUiState`(Task 3 の `src/lib/ai/useAiBetaAccessState.ts`)
- Produces: `TemplateOverviewPageProps` に `aiBetaState: AiBetaUiState` を追加。Task 7 は影響しない(別ファイル)が、呼び出し元(`TemplateOverviewPage` を使うルート、既存の `TemplateNewRoute` 相当)は `useAiBetaAccessState(services.functions)` を渡すよう更新が必要。呼び出し元の更新は本タスクの Step 3 に含める。

- [ ] **Step 1: 失敗するテストを書く**

`src/components/teacher/templates/TemplateOverviewPage.test.tsx` の冒頭で全 `it` が共有している `const props = { answers, onCreate: vi.fn(), creating: false, functions: {} as never }`(ファイル9行目)に `aiBetaState: 'APPROVED' as const` を追加する。これにより既存の5件の `it`(`aiEnabled`/`aiEnabled={false}` を個別に上書きしているだけの箇所)は型エラーなく動き続ける。その上でファイル末尾に以下の `describe` ブロックを追加する:

```tsx
describe('AI beta lock state', () => {
  const baseAnswers = { theme: 'テーマ', mainObjective: '目標', goal: 'MARKET_AND_INVESTING', difficulty: 'STANDARD' } as const

  it('shows a locked AI card with the beta notice when aiBetaState is LOCKED, without calling generateLessonDraft', () => {
    render(
      <TemplateOverviewPage
        answers={baseAnswers as never}
        onCreate={vi.fn()}
        creating={false}
        functions={{} as never}
        aiEnabled
        aiBetaState="LOCKED"
      />,
    )
    expect(screen.getByText('現在この機能は限定公開です。')).toBeInTheDocument()
    expect(screen.getByText('利用には運営者による許可が必要です。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'AI提案を選ぶ' })).not.toBeInTheDocument()
  })

  it('shows a loading indicator and does not enable the AI card while aiBetaState is LOADING', () => {
    render(
      <TemplateOverviewPage
        answers={baseAnswers as never}
        onCreate={vi.fn()}
        creating={false}
        functions={{} as never}
        aiEnabled
        aiBetaState="LOADING"
      />,
    )
    expect(screen.queryByRole('button', { name: 'AI提案を選ぶ' })).not.toBeInTheDocument()
  })

  it('enables the AI card when aiBetaState is APPROVED', () => {
    render(
      <TemplateOverviewPage
        answers={baseAnswers as never}
        onCreate={vi.fn()}
        creating={false}
        functions={{} as never}
        aiEnabled
        aiBetaState="APPROVED"
      />,
    )
    expect(screen.getByRole('button', { name: 'AI提案を選ぶ' })).toBeInTheDocument()
  })

  it('does not show the AI card at all when aiEnabled is false, regardless of aiBetaState', () => {
    render(
      <TemplateOverviewPage
        answers={baseAnswers as never}
        onCreate={vi.fn()}
        creating={false}
        functions={{} as never}
        aiEnabled={false}
        aiBetaState="APPROVED"
      />,
    )
    expect(screen.queryByText('AI提案')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: テストを実行し FAIL することを確認する**

Run: `npx vitest run src/components/teacher/templates/TemplateOverviewPage.test.tsx -t "AI beta lock state"`
Expected: FAIL — `aiBetaState` prop が型に存在しない、またはロック文言が描画されない。

- [ ] **Step 3: 最小実装を書く**

`src/components/teacher/templates/TemplateOverviewPage.tsx` を次のとおり書き換える:

```tsx
import { useMemo, useState } from 'react'
import { Alert, Button, Card, CardActionArea, CardContent, CircularProgress, Stack, TextField, Typography } from '@mui/material'
import type { Functions } from 'firebase/functions'
import { generateLessonDraft } from '../../../lib/ai/generateLessonDraft'
import type { AiBetaUiState } from '../../../lib/ai/useAiBetaAccessState'
import { describeError } from '../../../lib/monitoring/describeError'
import { buildDraftFromAnswers } from '../../../lib/lessonTemplates/guidedBuilderPresets'
import type { GuidedBuilderTier, WizardAnswers } from '../../../lib/lessonTemplates/guidedBuilderTypes'
import type { LessonContent } from '../../../lib/lessonTemplates/types'
const labels: Record<GuidedBuilderTier, string> = { EASY: '簡易案', STANDARD: '標準案', ADVANCED: '発展案' }
export interface TemplateOverviewPageProps { answers: WizardAnswers; onCreate: (draft: LessonContent) => void; creating: boolean; functions: Functions; aiEnabled: boolean; aiBetaState: AiBetaUiState }
export function TemplateOverviewPage({ answers, onCreate, creating, functions, aiEnabled, aiBetaState }: TemplateOverviewPageProps) {
  const drafts = useMemo(() => (['EASY', 'STANDARD', 'ADVANCED'] as const).map((tier) => ({ tier, draft: buildDraftFromAnswers(answers, tier) })), [answers])
  const [chosen, setChosen] = useState<LessonContent>()
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string>()
  const chooseAi = async () => {
    setAiLoading(true); setAiError(undefined)
    try {
      const ai = await generateLessonDraft(functions, { theme: answers.theme, mainObjective: answers.mainObjective, subject: answers.goal === 'MARKET_AND_INVESTING' ? 'SOCIAL_STUDIES' : 'HOME_ECONOMICS', difficulty: answers.difficulty })
      setChosen({ ...buildDraftFromAnswers(answers, 'STANDARD'), ...ai })
    } catch (error) { setAiError(describeError(error, 'AI提案の生成に失敗しました。固定の案をご利用ください。')) } finally { setAiLoading(false) }
  }
  const renderAiCard = () => {
    if (!aiEnabled) return null
    if (aiBetaState === 'LOCKED' || aiBetaState === 'ERROR') return <Card sx={{ flex: 1 }}><CardContent><Typography sx={{ fontWeight: 700 }}>AI提案（限定ベータ）</Typography><Typography variant="body2">現在この機能は限定公開です。</Typography><Typography variant="body2">利用には運営者による許可が必要です。</Typography></CardContent></Card>
    if (aiBetaState === 'LOADING') return <Card sx={{ flex: 1 }}><CardContent><Typography sx={{ fontWeight: 700 }}>AI提案</Typography><CircularProgress size={20} aria-label="ベータ利用可否を確認中" /></CardContent></Card>
    return <Card sx={{ flex: 1 }}><CardActionArea aria-label="AI提案を選ぶ" onClick={chooseAi} disabled={aiLoading}><CardContent><Typography sx={{ fontWeight: 700 }}>AI提案</Typography><Typography variant="body2">条件に合わせたタイトルと説明を提案します。</Typography>{aiLoading && <CircularProgress size={20} aria-label="AI提案を生成中" />}</CardContent></CardActionArea></Card>
  }
  if (!chosen) return <Stack spacing={2}><Typography variant="h6">3つの案から選んでください</Typography>{aiError && <Alert severity="warning">{aiError}</Alert>}<Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>{drafts.map(({ tier, draft }) => <Card key={tier} sx={{ flex: 1 }}><CardActionArea aria-label={`${labels[tier]}を選ぶ`} onClick={() => setChosen(draft)}><CardContent><Typography sx={{ fontWeight: 700 }}>{labels[tier]}</Typography><Typography variant="body2">{draft.title}</Typography></CardContent></CardActionArea></Card>)}{renderAiCard()}</Stack></Stack>
  return <Stack spacing={2}><Typography variant="h6">授業概要</Typography><TextField label="タイトル" value={chosen.title} onChange={(e) => setChosen({ ...chosen, title: e.target.value })} /><TextField label="説明" value={chosen.description} onChange={(e) => setChosen({ ...chosen, description: e.target.value })} multiline minRows={2} /><Typography variant="body2">科目: {chosen.subject === 'SOCIAL_STUDIES' ? '社会科' : '家庭科'}</Typography><Button variant="contained" disabled={creating} onClick={() => onCreate(chosen)}>この内容で作成</Button><Button onClick={() => setChosen(undefined)}>案の選択に戻る</Button></Stack>
}
```

呼び出し元 `src/App.tsx` の `TemplateOverviewPage` 使用箇所(`TemplateNewRoute` 内、`grep -n "TemplateOverviewPage" src/App.tsx` で特定)に `aiBetaState={useAiBetaAccessState(services.functions)}` を追加し、`src/App.tsx` の import に `useAiBetaAccessState` を追加する。この呼び出し元コンポーネントは React コンポーネントとして既にトップレベル関数のため、フック呼び出しは規則に反しない。

- [ ] **Step 4: テストを再実行し PASS することを確認する**

Run: `npx vitest run src/components/teacher/templates/TemplateOverviewPage.test.tsx`
Expected: 追加した4件を含め全件 PASS(既存テストで `aiBetaState` を渡していないケースがあれば Step 1 で合わせて修正済みであること)。

- [ ] **Step 5: App.tsx 側のテストも壊れていないことを確認する**

Run: `npx vitest run src/App.test.tsx`
Expected: 全件 PASS。

- [ ] **Step 6: lint・typecheck**

Run: `npm run lint && npm run typecheck`
Expected: エラーなし。

- [ ] **Step 7: Commit**

```bash
git add src/components/teacher/templates/TemplateOverviewPage.tsx src/components/teacher/templates/TemplateOverviewPage.test.tsx src/App.tsx
git commit -m "feat: lock the AI draft card in TemplateOverviewPage until beta access is approved"
```

---

### Task 7: `TemplateEditorPage.tsx` の AI 再生成・資料アップロードをロック表示対応にする

**Files:**
- Modify: `src/components/teacher/templates/TemplateEditorPage.tsx`
- Test: `src/components/teacher/templates/TemplateEditorPage.test.tsx`

**Interfaces:**
- Consumes: `AiBetaUiState`(Task 3)
- Produces: `TemplateEditorPageProps` に `aiBetaState: AiBetaUiState` を追加。

- [ ] **Step 1: 失敗するテストを書く**

`src/components/teacher/templates/TemplateEditorPage.test.tsx` の冒頭で全 `it` が共有している `const props = { draft, templateId: 't1', orgId: 'org-1', storage: {} as never, firestore: {} as never, functions: {} as never, onPublish: vi.fn(), saving: false, publishing: false, materialsUploadEnabled: false, derivatives: [] }`(ファイル23行目)に `aiBetaState: 'APPROVED' as const` を追加する。これにより既存の `it` はすべて `{...props}` 経由で型エラーなく動き続ける(資料タブに関する既存の `it` は `aiEnabled materialsUploadEnabled` を個別に上書きしているだけで `aiBetaState` を上書きしないため、既定の `'APPROVED'` を引き継ぐ)。その上でファイル末尾に次の `describe` を追加する:

```tsx
describe('AI beta lock state', () => {
  it('shows the beta lock notice on the materials tab and hides the regenerate button when aiBetaState is LOCKED', () => {
    render(<TemplateEditorPage {...props} aiEnabled materialsUploadEnabled aiBetaState="LOCKED" />)
    fireEvent.click(screen.getByRole('tab', { name: '資料' }))
    expect(screen.getByText('現在この機能は限定公開です。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '資料を使ってAI提案を更新' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('資料をアップロード')).not.toBeInTheDocument()
  })

  it('shows the regenerate button and upload panel when aiBetaState is APPROVED', () => {
    render(<TemplateEditorPage {...props} aiEnabled materialsUploadEnabled aiBetaState="APPROVED" />)
    fireEvent.click(screen.getByRole('tab', { name: '資料' }))
    expect(screen.getByRole('button', { name: '資料を使ってAI提案を更新' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: テストを実行し FAIL することを確認する**

Run: `npx vitest run src/components/teacher/templates/TemplateEditorPage.test.tsx -t "AI beta lock state"`
Expected: FAIL — `aiBetaState` prop が型に存在しない、またはロック文言が描画されない。

- [ ] **Step 3: 最小実装を書く**

`TemplateEditorPageProps` に `aiBetaState: AiBetaUiState` を追加し、`import type { AiBetaUiState } from '../../../lib/ai/useAiBetaAccessState'` を追加する。

資料タブのレンダリング部分(`{tab === materialsTab && ( ... )}`、`TemplateEditorPage.tsx:264-269` 付近)を次のように置き換える:

```tsx
      {tab === materialsTab && (
        aiBetaState === 'LOCKED' || aiBetaState === 'ERROR' ? (
          <Stack spacing={1}>
            <Typography sx={{ fontWeight: 700 }}>AI資料アップロード（限定ベータ）</Typography>
            <Typography variant="body2">現在この機能は限定公開です。</Typography>
            <Typography variant="body2">利用には運営者による許可が必要です。</Typography>
          </Stack>
        ) : aiBetaState === 'LOADING' ? (
          <CircularProgress size={20} aria-label="ベータ利用可否を確認中" />
        ) : (
          <Stack spacing={2}>
            <MaterialUploadPanel materials={materials} uploading={uploading} onUpload={(file) => void upload(file)} selectedIds={selected} onSelectionChange={setSelected} />
            {aiError && <Typography role="alert" color="error">{aiError}</Typography>}
            <Button variant="contained" disabled={!selected.length || regenerating || isMoving} onClick={() => void regenerate()}>資料を使ってAI提案を更新</Button>
          </Stack>
        )
      )}
```

呼び出し元 `src/App.tsx` の `TemplateEditRoute`(`TemplateEditorPage` を描画する箇所)にも `aiBetaState={useAiBetaAccessState(services.functions)}` を追加する。

- [ ] **Step 4: テストを再実行し PASS することを確認する**

Run: `npx vitest run src/components/teacher/templates/TemplateEditorPage.test.tsx`
Expected: 追加分を含め全件 PASS。

- [ ] **Step 5: App.tsx 側のテストも壊れていないことを確認する**

Run: `npx vitest run src/App.test.tsx`
Expected: 全件 PASS。

- [ ] **Step 6: lint・typecheck**

Run: `npm run lint && npm run typecheck`
Expected: エラーなし。

- [ ] **Step 7: Commit**

```bash
git add src/components/teacher/templates/TemplateEditorPage.tsx src/components/teacher/templates/TemplateEditorPage.test.tsx src/App.tsx
git commit -m "feat: lock the AI regenerate button and materials panel until beta access is approved"
```

---

### Task 8: 全レイヤー横断の受け入れ検証と backlog 更新・push

**Files:**
- Modify: `docs/superpowers/scope-backlog.md`(Phase 3 の「未着手項目」を更新)
- No new source files。

**Interfaces:**
- Consumes: Task 1〜7 の成果物すべて。
- Produces: なし(最終検証と記録)。

このタスクはコード変更を伴わない検証タスクのため、TDD ステップではなく検証チェックリストとして進める。

- [ ] **Step 1: 保護対象 AI entrypoint と direct-write path を再列挙し、すべてゲート済みであることをコードで確認する**

以下を grep で確認し、いずれも `assertAiBetaApproved`(Callable)または `aiBetaApproved()`(Rules)を経由していることを目視確認する。

```bash
grep -n "onCall(" functions/src/ai/onCall.ts
grep -n "aiBetaApproved" firestore.rules storage.rules
grep -rn "uploadBytes\|addDoc" src/lib/ai/materialsRepository.ts
```

Expected: `generateLessonDraftCallable`/`generateTeacherGuidanceCallable` は `assertAiBetaApproved` 呼び出し済み、`firestore.rules` の `lessonTemplates/{templateId}/materials` の `create`/`delete` と `storage.rules` の `orgs/{orgId}/materials/**` の `write` はいずれも `aiBetaApproved()` を含む。`materialsRepository.ts` はクライアント直接 write のままだが、それを許可するのは Rules 側の条件のみである。

- [ ] **Step 2: functions のユニットテストを実行する**

Run: `npm test --workspace=functions`
Expected: `functions/src/ai/betaAccess.test.ts`、`functions/src/ai/onCall.test.ts`、`functions/src/ai/migrateLegacyBetaAccess.test.ts` を含め全件 PASS。

- [ ] **Step 3: フロントエンドのユニットテストを実行する**

Run: `npm test`
Expected: 本計画で追加・修正した `src/lib/ai/aiBetaAccess.test.ts`、`src/lib/ai/useAiBetaAccessState.test.ts`、`src/components/operator/OperatorAiBetaPage.test.tsx`、`src/App.test.tsx`、`src/components/teacher/templates/TemplateOverviewPage.test.tsx`、`src/components/teacher/templates/TemplateEditorPage.test.tsx` を含め全件 PASS。

- [ ] **Step 4: Rules テストを実行する**

Run: `npm run test:rules`
Expected: `test/firestore.rules.test.ts` の `aiBetaAccess/{uid}` describe ブロック(client direct read/write 全拒否)と `lessonTemplates/{templateId}/materials/{materialId}` describe ブロック(未許可教師の create/delete 拒否、既存 material の read は revoke 後も維持)、`test/storage.rules.test.ts` の materials write 拒否テストがすべて PASS。

- [ ] **Step 5: lint・typecheck・build を実行する**

```bash
npm run lint
npm run typecheck
npm run build
```

Expected: いずれもエラーなし。

- [ ] **Step 6: functions の verify を実行する**

Run: `npm run verify --workspace=functions`
Expected: lint・typecheck・test・build すべて PASS。

- [ ] **Step 7: リポジトリ全体の verify を実行する**

Run: `npm run verify`
Expected: ルートの `verify` スクリプト(lint → typecheck → test → test:rules → test:market-concurrency → build → 各 workspace の verify)がすべて PASS。

- [ ] **Step 8: 受け入れ条件を1件ずつ確認する**

設計書 §12 の17項目、および本タスク冒頭の指示にある19項目チェックリストを、Step 1〜7 で確認済みの内容と突き合わせて満たしていることを確認する。特に次の3点は実コードを再確認する。

- revoke 後も既存の LessonTemplate/LessonVersion/生成済み資料が削除されないこと: `functions/src/ai/betaAccess.ts` の `revokeAiBetaAccess` が `aiBetaAccess/{uid}` の `status` 更新と `aiBetaAccessEvents` 追記のみを行い、`lessonTemplates` 配下への書き込みを一切行わないことをコードで確認する。
- legacy migration が status-only gate のデプロイより前に実行される運用になっていること: Task 1 Step 4 の手順書を確認する。
- operator 以外が `/operator/ai-beta` を直打ちしても `listAiBetaAccessCallable` が `permission-denied` を返し、画面が「この画面は運営者のみ利用できます。」を表示すること: Task 5 の実装と `functions/src/ai/onCall.ts` の `listAiBetaAccessCallable` の `isCallerOperator` チェックを確認する。

- [ ] **Step 9: `docs/superpowers/scope-backlog.md` の Phase 3 未着手項目を更新する**

Step 1〜8 がすべて PASS した後にのみ、`docs/superpowers/scope-backlog.md` の「## Phase 3: AI Lesson Studio ベータ」セクションを編集する。

現在の記述:

```markdown
**未着手項目:**

- 利用者を運営者許可アカウントに限定するアクセス制御(ベータの「限定公開」そのもの)
```

これを次のとおり変更する:

```markdown
**未着手項目:**

- なし

**実装済み(2026-08-15):**

- 利用者を運営者許可アカウントに限定するアクセス制御(ベータの「限定公開」そのもの) — `functions/src/ai/betaAccess.ts`(`aiBetaAccess/{uid}.status === 'APPROVED'` を正本とする idempotent grant/revoke、`aiBetaAccessEvents` 追記専用監査)、`getMyAiBetaAccessCallable`/`listAiBetaAccessCallable`/`grantAiBetaAccessCallable`/`revokeAiBetaAccessCallable`(メール完全一致 grant、UID直接grant経路は撤去)、`firestore.rules`/`storage.rules` の `aiBetaApproved()` による AI資料direct-write gate、`/operator/ai-beta`(`OperatorAiBetaPage.tsx`)、教師UIのロック表示(`TemplateOverviewPage.tsx`/`TemplateEditorPage.tsx`)、`migrateLegacyBetaAccess.ts` による legacy grant backfill を実装。
```

- [ ] **Step 10: Commit**

```bash
git add docs/superpowers/scope-backlog.md
git commit -m "docs: mark AI Lesson Studio beta access control as implemented in scope backlog"
```

- [ ] **Step 11: push**

```bash
git push origin codex/classroom
```

---

## Task 間の並列性

**並列実行可能:**
- Task 1(legacy migration 運用整備)は他タスクと完全に独立して並列実行できる。
- Task 2(`src/lib/ai/aiBetaAccess.ts`)は他タスクの前提だが、Task 1 とは独立して並列実行できる。

**直列実行が必要:**
- Task 3 は Task 2 完了後(`getMyAiBetaAccess` を消費する)。
- Task 4 は Task 2 完了後(`AiBetaAccessListItem`・grant/revoke/list ラッパーを消費する)。
- Task 5 は Task 2・Task 4 完了後(`OperatorAiBetaPage` と client ラッパーを `src/App.tsx` に配線する)。
- Task 6・Task 7 は Task 3 完了後(`useAiBetaAccessState` を消費する)。Task 6 と Task 7 は互いに別ファイル(`TemplateOverviewPage.tsx` / `TemplateEditorPage.tsx`)を編集するため並列実行できるが、両者とも `src/App.tsx` に1行ずつ変更を加えるため、**Task 5・Task 6・Task 7 は `src/App.tsx` を共有して編集する関係上、直列実行するか、担当者間でマージ順序を事前調整すること。**
- Task 8(最終検証)はすべてのタスク完了後にのみ実行する。

推奨実行順序: Task 1 と Task 2 を並列 → Task 3 と Task 4 を並列(いずれも Task 2 完了後) → Task 5 → Task 6 → Task 7(`src/App.tsx` の競合を避けるため直列)→ Task 8。
