# 生徒データ保持期間ポリシー(§21.2 入口部分) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 組織のownerが「生徒データを何日保持するか」を設定・変更できるようにする。統合仕様書§21.2が定義する期限到来時の対応待ちキュー(匿名化/削除/延長の判断)は別スコープとし、本プランは「組織が保持期間を選べる」の入口部分のみを実装する。

**Architecture:** `organizations/{orgId}` ドキュメントに `studentDataRetentionPolicy` フィールドを追加し、既存の `changeOrgMemberRoleCallable` 等と同じ配置(`functions/src/organizations/onCall.ts`)にowner限定のCallable `setStudentDataRetentionPolicyCallable` を新設する。`organizations/{orgId}` は既に `allow write: if false` でクライアント直接書き込みを拒否しているため、Firestoreルールの変更は不要(読み取りは既存の `allow get: if teacher() && activeMember(orgId)` でカバー済み)。

**Tech Stack:** Firebase Cloud Functions (TypeScript, `onCall` v2)、Firestore Admin SDK、React + Vitest + Testing Library。

## Global Constraints

- フィールド名は `studentDataRetentionPolicy`。形は `{ retentionDays: number; setByUid: string; setAt: Timestamp }`。
- `retentionDays` は30〜3650(10年)の整数のみ許可する(spec §21.2に具体的な数値レンジの指定はないため、「無期限延長不可」という要件を満たす妥当な上限としてこの実装で定める。将来ロードマップで別の上限が定義されたら差し替える)。
- 保持期間の**設定・変更は owner のみ**行える(admin不可)。理由: このデータは生徒の個人情報の扱いに直結する組織全体の方針であり、`exportOrgStudentDataCallable`(生徒データ一括エクスポート)と同じくowner限定とする既存の判断(`functions/src/privacy/onCall.ts:270`のコメント参照)に倣う。
- 期限到来時の対応待ちキュー・匿名化・削除・延長・年1回再承認・単独/二者承認は本プランの範囲外。将来の別プランとする(このプランのコード中にコメントで明記する)。
- Firestoreルールの変更は不要(理由は上記Architecture参照)。ルール変更が不要であることを示すため、Task 1に「ルールが既にカバーしていることを確認するテスト」を1件だけ追加する(新しいルールを書くタスクではない)。
- 命名・コーディングスタイルは `functions/src/organizations/onCall.ts` の既存Callable(特に `changeOrgMemberRoleCallable`)に厳密に合わせる。

---

### Task 1: `setStudentDataRetentionPolicyCallable`

**Files:**
- Modify: `functions/src/organizations/onCall.ts`(末尾に追加)
- Modify: `functions/src/organizations/onCall.test.ts`
- Modify: `functions/src/index.ts`
- Modify: `test/firestore.rules.test.ts`

**Interfaces:**
- Consumes: `requireActiveOrgMember`(既存、`./authorization`)、`FieldValue`(`firebase-admin/firestore`)
- Produces: `export const setStudentDataRetentionPolicyCallable = onCall(...)` — Task 2のクライアントlibがこのCallable名(`'setStudentDataRetentionPolicyCallable'`)を呼び出す。Firestoreフィールド `organizations/{orgId}.studentDataRetentionPolicy: { retentionDays: number; setByUid: string; setAt: Timestamp }` — Task 2の読み取り側がこの形を前提にする。

- [ ] **Step 1: 失敗するテストを書く**

まず `functions/src/organizations/onCall.test.ts` を読み、`changeOrgMemberRoleCallable` のテストがどのように `requireActiveOrgMember` や `getFirestore().doc(...).update(...)` をモックしているかを確認する。それに合わせて以下のテストを同ファイル末尾に追加する(モックの具体的な書き方は既存のテストに合わせて調整すること):

```typescript
describe('setStudentDataRetentionPolicyCallable', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('rejects a non-owner', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'admin', membershipVersion: 1 })
    await expect(setStudentDataRetentionPolicyCallable.run(makeRequest({ uid: 'admin-a', data: { orgId: 'org-1', retentionDays: 365 } })))
      .rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('rejects a retentionDays value outside 30-3650', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    await expect(setStudentDataRetentionPolicyCallable.run(makeRequest({ uid: 'owner-a', data: { orgId: 'org-1', retentionDays: 29 } })))
      .rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it('rejects a non-integer retentionDays', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    await expect(setStudentDataRetentionPolicyCallable.run(makeRequest({ uid: 'owner-a', data: { orgId: 'org-1', retentionDays: 365.5 } })))
      .rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it('writes the policy for a valid owner request', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    await setStudentDataRetentionPolicyCallable.run(makeRequest({ uid: 'owner-a', data: { orgId: 'org-1', retentionDays: 365 } }))
    expect(orgDocUpdateMock).toHaveBeenCalledWith({
      studentDataRetentionPolicy: { retentionDays: 365, setByUid: 'owner-a', setAt: 'SERVER_TIMESTAMP' },
    })
  })
})
```

`makeRequest` ヘルパーが既にこのファイルに存在すればそれを使う。存在しない、またはシグネチャが異なる場合は既存の他のテスト(`changeOrgMemberRoleCallable`等)で使われているリクエスト生成方法に完全に合わせること。`orgDocUpdateMock` も同様に、既存の `getFirestore` モックに `organizations/{orgId}` への `.update()` 呼び出しを捕捉するモック関数を追加し、それを使う(既存モックの構造を先に読んでから、最小限の追加で対応すること)。

ファイル冒頭のimportに `setStudentDataRetentionPolicyCallable` を追加する。

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/organizations/onCall.test.ts -t "setStudentDataRetentionPolicyCallable"`
Expected: FAIL(`setStudentDataRetentionPolicyCallable` が存在しない)

- [ ] **Step 3: 実装する**

`functions/src/organizations/onCall.ts` の末尾に追加:

```typescript
interface SetStudentDataRetentionPolicyRequest { orgId?: unknown; retentionDays?: unknown }

const MIN_RETENTION_DAYS = 30
const MAX_RETENTION_DAYS = 3650

/**
 * Spec §21.2の入口部分のみ: 組織ownerが保持期間(日数)を設定する。
 * 期限到来時の対応待ちキュー・匿名化/削除/延長の判断・年1回再承認は
 * 別スコープ(このCallableは方針の保存のみを行う)。
 */
export const setStudentDataRetentionPolicyCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as SetStudentDataRetentionPolicyRequest
  if (typeof data.orgId !== 'string') throw new HttpsError('invalid-argument', '入力内容が不正です。')
  if (typeof data.retentionDays !== 'number' || !Number.isInteger(data.retentionDays) || data.retentionDays < MIN_RETENTION_DAYS || data.retentionDays > MAX_RETENTION_DAYS) {
    throw new HttpsError('invalid-argument', `保持期間は${MIN_RETENTION_DAYS}〜${MAX_RETENTION_DAYS}日の整数で指定してください。`)
  }

  const membership = await requireActiveOrgMember(getFirestore(), data.orgId, request.auth.uid)
  if (membership.role !== 'owner') throw new HttpsError('permission-denied', '組織のownerのみ保持期間を設定できます。')

  await getFirestore().doc(`organizations/${data.orgId}`).update({
    studentDataRetentionPolicy: { retentionDays: data.retentionDays, setByUid: request.auth.uid, setAt: FieldValue.serverTimestamp() },
  })
})
```

`FieldValue` が `functions/src/organizations/onCall.ts` の先頭で既にimportされていなければ、`import { FieldValue, getFirestore } from 'firebase-admin/firestore'` の形にimport文を更新する(既存の `getFirestore` importと統合する。二重importにしない)。

`functions/src/index.ts` の `changeOrgMemberRoleCallable` がexportされている行(または `./organizations/onCall` からのexport文)を探し、`setStudentDataRetentionPolicyCallable` も同じexport文に追加する。

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/organizations/onCall.test.ts`
Expected: PASS(既存テスト全件 + 新規4件)

- [ ] **Step 5: ルールが既にカバーしていることを確認するテストを追加する**

`test/firestore.rules.test.ts` の `describe('organization membership Firestore rules', ...)` ブロック内、`'rejects client writes to organizations, memberships, and user profiles'` テストの直後に以下を追加する(新しいルールではなく、既存の `allow write: if false` が新フィールドにも及ぶことを明示するための回帰テスト):

```typescript
it('rejects a client attempt to set studentDataRetentionPolicy directly (must go through setStudentDataRetentionPolicyCallable)', async () => {
  const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
  await assertFails(updateDoc(doc(owner, 'organizations', 'personal_teacher-a'), {
    studentDataRetentionPolicy: { retentionDays: 365, setByUid: 'teacher-a' },
  }))
})
```

- [ ] **Step 6: ルールテストを実行して通ることを確認する**

Run: `cd /Users/shoug/Documents/GitHub/stock-league-classroom && npm run test:rules`
Expected: 全テストPASS(既存件数 + 新規1件)

- [ ] **Step 7: 型チェックを実行する**

Run: `cd functions && npx tsc --noEmit -p .`
Expected: エラーなし

- [ ] **Step 8: コミット**

```bash
git add functions/src/organizations/onCall.ts functions/src/organizations/onCall.test.ts functions/src/index.ts test/firestore.rules.test.ts
git commit -m "feat: 組織ownerが生徒データ保持期間を設定できるCallableを追加する"
```

---

### Task 2: クライアントlibと組織設定画面への表示・変更UI

**Files:**
- Create: `src/lib/organizations/studentDataRetentionPolicy.ts`
- Create: `src/lib/organizations/studentDataRetentionPolicy.test.ts`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: Callable名 `'setStudentDataRetentionPolicyCallable'`(Task 1が定義)、`organizations/{orgId}.studentDataRetentionPolicy`フィールド(Task 1が書き込む形)
- Produces: `SchoolOrgSettingsPage` の新規props `studentDataRetentionDays: number | null`・`settingRetentionPolicy: boolean`・`onSetStudentDataRetentionDays: (days: number) => void`(このタスク内で閉じる)

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/organizations/studentDataRetentionPolicy.test.ts` を新規作成(`src/lib/privacy/orgStudentDataExport.ts` のテストがあればそのモック手法を踏襲。参考: 直近実装した `src/lib/privacy/orgAuditLog.ts` があればそれと同じ形):

```typescript
import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { setStudentDataRetentionDays } from './studentDataRetentionPolicy'

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

describe('setStudentDataRetentionDays', () => {
  it('calls setStudentDataRetentionPolicyCallable with orgId and retentionDays', async () => {
    const callable = vi.fn().mockResolvedValue({ data: undefined })
    vi.mocked(httpsCallable).mockReturnValue(callable as never)
    await setStudentDataRetentionDays({} as never, { orgId: 'org-1', retentionDays: 365 })
    expect(httpsCallable).toHaveBeenCalledWith({}, 'setStudentDataRetentionPolicyCallable')
    expect(callable).toHaveBeenCalledWith({ orgId: 'org-1', retentionDays: 365 })
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/lib/organizations/studentDataRetentionPolicy.test.ts`
Expected: FAIL(`./studentDataRetentionPolicy` が存在しない)

- [ ] **Step 3: 実装する**

`src/lib/organizations/studentDataRetentionPolicy.ts` を新規作成:

```typescript
import { httpsCallable, type Functions } from 'firebase/functions'

export interface SetStudentDataRetentionDaysInput { orgId: string; retentionDays: number }

export const setStudentDataRetentionDays = async (functions: Functions, input: SetStudentDataRetentionDaysInput): Promise<void> => {
  await httpsCallable<SetStudentDataRetentionDaysInput, void>(functions, 'setStudentDataRetentionPolicyCallable')(input)
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/lib/organizations/studentDataRetentionPolicy.test.ts`
Expected: PASS

- [ ] **Step 5: `SchoolOrgSettingsPage` にUIを追加する**

`src/components/teacher/organizations/SchoolOrgSettingsPage.tsx` を読み、`onExportStudentData`/`exportingStudentData` props(またはTask 3実行済みなら `auditLogEntries` 等)がどこに定義・使用されているかを確認する。同じ場所の近くに以下のpropsを追加する:

```typescript
studentDataRetentionDays: number | null
settingRetentionPolicy: boolean
onSetStudentDataRetentionDays: (days: number) => void
```

`canManageMembers`(owner/admin判定、既存)ではなく、**owner限定**の表示にする必要がある。ファイル内で `viewerUid` と `members` からownerかどうかを判定している箇所(`viewerMembership?.role === 'owner'`のような式)を探し、それに合わせて `isOwner` 相当の条件を使う。owner限定のセクションとして以下を追加する:

```tsx
{isOwner && (
  <section>
    <h3>生徒データの保持期間</h3>
    <p>現在の設定: {studentDataRetentionDays !== null ? `${studentDataRetentionDays}日` : '未設定'}</p>
    <form onSubmit={(event) => {
      event.preventDefault()
      const input = new FormData(event.currentTarget).get('retentionDays')
      const days = Number(input)
      if (Number.isInteger(days) && days >= 30 && days <= 3650) onSetStudentDataRetentionDays(days)
    }}>
      <label>
        保持日数(30〜3650)
        <input name="retentionDays" type="number" min={30} max={3650} defaultValue={studentDataRetentionDays ?? 365} disabled={settingRetentionPolicy} />
      </label>
      <button type="submit" disabled={settingRetentionPolicy}>{settingRetentionPolicy ? '保存中…' : '保存'}</button>
    </form>
  </section>
)}
```

既存コンポーネントのJSX構造(見出しレベル、フォームの書き方)に厳密に合わせること。ファイル内で他に `<form>` を使った箇所があれば、そのスタイル(制御コンポーネントかFormDataか)に統一する。

- [ ] **Step 6: コンポーネントテストを追加する**

`src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx` の `memberProps`(または相当するデフォルトprops定義)に以下を追加:

```typescript
studentDataRetentionDays: null,
settingRetentionPolicy: false,
onSetStudentDataRetentionDays: vi.fn(),
```

新規テストを追加:

```typescript
it('shows the retention policy form to an owner and submits the entered days', () => {
  const onSetStudentDataRetentionDays = vi.fn()
  render(
    <MemoryRouter>
      <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false} {...memberProps} viewerUid="uid-owner" members={members} onSetStudentDataRetentionDays={onSetStudentDataRetentionDays} />
    </MemoryRouter>,
  )
  fireEvent.change(screen.getByLabelText(/保持日数/), { target: { value: '400' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(onSetStudentDataRetentionDays).toHaveBeenCalledWith(400)
})

it('hides the retention policy form from a non-owner', () => {
  render(
    <MemoryRouter>
      <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false} {...memberProps} viewerUid="uid-teacher" members={members} />
    </MemoryRouter>,
  )
  expect(screen.queryByText('生徒データの保持期間')).not.toBeInTheDocument()
})
```

`members` 配列に `uid-teacher` がteacherロールで含まれていることを、このファイルの既存の `members` 定義で確認すること(既に他のテストで使われているはず)。

- [ ] **Step 7: テストを実行する**

Run: `npx vitest run src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`
Expected: PASS(既存テスト全件 + 新規2件)

- [ ] **Step 8: `App.tsx` の `SchoolOrgSettingsRoute` に配線する**

`SchoolOrgSettingsRoute` 内、`onExportStudentData` 定義の近くに以下を追加する(既存の `useState`/`useEffect` の書き方に合わせる):

```typescript
const [studentDataRetentionDays, setStudentDataRetentionDaysState] = useState<number | null>(null)
const [settingRetentionPolicy, setSettingRetentionPolicy] = useState(false)
```

組織ドキュメントを既に `useEffect` でFirestoreから読んでいる箇所(`aiEnabled`を読んでいる箇所と同じ`getDoc`呼び出し)があれば、そこに `studentDataRetentionPolicy?.retentionDays ?? null` を読み取る処理を追加する形にする。新たに `useEffect` を増やさず、既存の組織ドキュメント購読処理に相乗りさせること。

```typescript
const onSetStudentDataRetentionDays = (days: number) => {
  if (!orgId) return
  setSettingRetentionPolicy(true)
  void setStudentDataRetentionDays(services.functions, { orgId, retentionDays: days })
    .then(() => setStudentDataRetentionDaysState(days))
    .finally(() => setSettingRetentionPolicy(false))
}
```

`<SchoolOrgSettingsPage ...>` のJSXに `studentDataRetentionDays={studentDataRetentionDays} settingRetentionPolicy={settingRetentionPolicy} onSetStudentDataRetentionDays={onSetStudentDataRetentionDays}` を追加する。

ファイル冒頭のimportに追加:

```typescript
import { setStudentDataRetentionDays } from './lib/organizations/studentDataRetentionPolicy'
```

- [ ] **Step 9: 全体テストと型チェックを実行する**

Run: `npx vitest run && npx tsc -b`
Expected: 全件PASS、型エラーなし

- [ ] **Step 10: コミット**

```bash
git add src/lib/organizations/studentDataRetentionPolicy.ts src/lib/organizations/studentDataRetentionPolicy.test.ts src/components/teacher/organizations/SchoolOrgSettingsPage.tsx src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx src/App.tsx
git commit -m "feat: 組織設定画面に生徒データ保持期間の設定UIを追加する"
```

---

### Task 3: scope-backlog.mdの更新

**Files:**
- Modify: `docs/superpowers/scope-backlog.md`

**Interfaces:**
- Consumes: なし
- Produces: なし(ドキュメントのみの変更)

- [ ] **Step 1: Phase 7の該当行を更新する**

`docs/superpowers/scope-backlog.md` の「未着手項目(生徒データの組織単位の統制、残り4項目)」から「保持期間の組織ポリシー設定(§21.2の入口部分)」の行を削除し、直前または直後に以下を追記する:

```
**実装済み(2026-08-15):**

- 保持期間の組織ポリシー設定(入口部分) — `setStudentDataRetentionPolicyCallable`(owner限定)。期限到来時の対応待ちキュー・匿名化/削除/延長の判断ワークフローは別スコープのまま。
```

(監査ログの実装済みエントリが既に同じ場所にあれば、その直後に追記して1つの「実装済み(2026-08-15)」リストにまとめる。)

- [ ] **Step 2: コミット**

```bash
git add docs/superpowers/scope-backlog.md
git commit -m "docs: 保持期間ポリシー実装をscope-backlogに反映する"
```
