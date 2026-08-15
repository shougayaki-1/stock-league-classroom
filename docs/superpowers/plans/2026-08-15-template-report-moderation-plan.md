# 通報と審査(運営者向け) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 教師がCOMMUNITY公開教材を通報でき、`operator`クレーム保持者がその通報を確認して対象教材を非公開化できる、最低限の審査ワークフローを実装する。

**Architecture:** `publishTemplateToCommunityCallable`/`unpublishTemplateFromCommunityCallable`と同じ「トランザクションなしの単純なdoc読み書き」スタイルで、4つの新規Callable(`reportTemplateCallable`/`listPendingTemplateReportsCallable`/`resolveTemplateReportCallable`/`grantOperatorCallable`)を`functions/src/lessonTemplates/onCall.ts`に直接実装する(専用のpure logicモジュールは作らない、既存の直近サブプロジェクトの実装スタイルを踏襲)。`operator`カスタムクレームの検証は`firestore.rules`の`operator()`と同じロジックをCallable側にミラーする。

**Tech Stack:** Firebase Cloud Functions (TypeScript, `firebase-admin/firestore`, `firebase-admin/auth`)、React + MUI、Vitest、React Testing Library、Firestore Rules (emulator)。

## Global Constraints

- 正本: `docs/superpowers/specs/2026-08-15-template-report-moderation-design.md`。矛盾があれば正本を優先する。
- 通報対象は`visibility === 'COMMUNITY'`の教材のみ(非公開教材への通報は`not-found`)。
- 自作教材への通報は`permission-denied`。
- `reason`は`'PERSONAL_INFO' | 'COPYRIGHT' | 'INAPPROPRIATE' | 'MISINFORMATION' | 'OTHER'`の5値のみ。
- `operator`クレーム(`request.auth.token.operator === true`)保持者のみが審査系Callable(`listPendingTemplateReportsCallable`/`resolveTemplateReportCallable`/`grantOperatorCallable`)を呼べる。
- 最初の1人目の`operator`はFirebaseコンソール/Admin SDKスクリプトでの手動付与が前提(本計画のスコープ外)。
- `templateReports`コレクションはクライアントから直接読み書きできない(`allow read, write: if false`、すべてCallable経由)。

---

### Task 1: `reportTemplateCallable`を実装する

**Files:**
- Modify: `functions/src/lessonTemplates/onCall.ts`
- Modify: `functions/src/lessonTemplates/onCall.test.ts`

**Interfaces:**
- Produces: `reportTemplateCallable`。`templateReports/{reportId}`ドキュメントを新規作成する。Task 2の`listPendingTemplateReportsCallable`/`resolveTemplateReportCallable`がこのドキュメント形状を前提にする(`{ templateId, versionId, reportedByUid, reason, details, status: 'PENDING', resolution: null, resolvedByUid: null, resolvedAt: null, createdAt }`)。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonTemplates/onCall.test.ts`冒頭の以下のブロックを:

```ts
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
  getFirestore: () => ({ doc: () => ({ get: templateGetMock, update: templateUpdateMock }) }),
}))
```

以下に置き換える(`lessonTemplates/*`と`templateReports/*`をパスで振り分け、`collection('templateReports')`もモックする)。

```ts
const reportAddMock = vi.fn()
const reportGetMock = vi.fn()
const reportUpdateMock = vi.fn()
const reportsWhereGetMock = vi.fn()

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
  getFirestore: () => ({
    doc: (path: string) => path.startsWith('templateReports/')
      ? { get: reportGetMock, update: reportUpdateMock }
      : { get: templateGetMock, update: templateUpdateMock },
    collection: (path: string) => path === 'templateReports'
      ? { add: reportAddMock, where: () => ({ get: reportsWhereGetMock }) }
      : undefined,
  }),
}))
```

ファイル末尾に追記する。

```ts
describe('reportTemplateCallable', () => {
  const auth = { uid: 'teacher-b', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }
  const makeRequest = (data: Record<string, unknown>) => ({ auth, data, rawRequest: {} } as unknown as CallableRequest)

  beforeEach(() => { vi.clearAllMocks() })

  it('rejects an invalid reason without reading the template', async () => {
    await expect(reportTemplateCallable.run(makeRequest({ templateId: 't1', versionId: 'v1', reason: 'NOT_A_REAL_REASON' }))).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(templateGetMock).not.toHaveBeenCalled()
  })

  it('rejects a report on a template that does not exist', async () => {
    templateGetMock.mockResolvedValue({ exists: false })
    await expect(reportTemplateCallable.run(makeRequest({ templateId: 't1', versionId: 'v1', reason: 'OTHER' }))).rejects.toMatchObject({ code: 'not-found' })
    expect(reportAddMock).not.toHaveBeenCalled()
  })

  it('rejects a report on a template that is not COMMUNITY-visible', async () => {
    templateGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'visibility' ? 'PRIVATE' : field === 'createdByUid' ? 'teacher-a' : undefined) })
    await expect(reportTemplateCallable.run(makeRequest({ templateId: 't1', versionId: 'v1', reason: 'OTHER' }))).rejects.toMatchObject({ code: 'not-found' })
    expect(reportAddMock).not.toHaveBeenCalled()
  })

  it('rejects a caller reporting their own template', async () => {
    templateGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'visibility' ? 'COMMUNITY' : field === 'createdByUid' ? 'teacher-b' : undefined) })
    await expect(reportTemplateCallable.run(makeRequest({ templateId: 't1', versionId: 'v1', reason: 'OTHER' }))).rejects.toMatchObject({ code: 'permission-denied' })
    expect(reportAddMock).not.toHaveBeenCalled()
  })

  it('creates a PENDING report for a valid COMMUNITY template reported by someone else', async () => {
    templateGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'visibility' ? 'COMMUNITY' : field === 'createdByUid' ? 'teacher-a' : undefined) })
    reportAddMock.mockResolvedValue({ id: 'report-1' })
    await expect(reportTemplateCallable.run(makeRequest({ templateId: 't1', versionId: 'v1', reason: 'COPYRIGHT', details: '出典不明' }))).resolves.toEqual({ reportId: 'report-1' })
    expect(reportAddMock).toHaveBeenCalledWith({
      templateId: 't1', versionId: 'v1', reportedByUid: 'teacher-b', reason: 'COPYRIGHT', details: '出典不明',
      status: 'PENDING', resolution: null, resolvedByUid: null, resolvedAt: null, createdAt: 'SERVER_TIMESTAMP',
    })
  })

  it('defaults details to null when omitted', async () => {
    templateGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'visibility' ? 'COMMUNITY' : field === 'createdByUid' ? 'teacher-a' : undefined) })
    reportAddMock.mockResolvedValue({ id: 'report-1' })
    await reportTemplateCallable.run(makeRequest({ templateId: 't1', versionId: 'v1', reason: 'OTHER' }))
    expect(reportAddMock).toHaveBeenCalledWith(expect.objectContaining({ details: null }))
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/onCall.test.ts`
Expected: FAIL(`reportTemplateCallable`が存在せず、既存テストもモック形状変更の影響で確認が必要)。

- [ ] **Step 3: `onCall.ts`に実装を追加する**

ファイル末尾に追記する。

```ts
const TEMPLATE_REPORT_REASONS = ['PERSONAL_INFO', 'COPYRIGHT', 'INAPPROPRIATE', 'MISINFORMATION', 'OTHER'] as const
type TemplateReportReason = typeof TEMPLATE_REPORT_REASONS[number]

interface ReportTemplateCallableInput { templateId?: unknown; versionId?: unknown; reason?: unknown; details?: unknown }
const isValidReportReason = (value: unknown): value is TemplateReportReason => TEMPLATE_REPORT_REASONS.includes(value as TemplateReportReason)

export const reportTemplateCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as ReportTemplateCallableInput
  if (typeof data.templateId !== 'string' || typeof data.versionId !== 'string' || !isValidReportReason(data.reason)) {
    throw new HttpsError('invalid-argument', 'リクエストが不正です。')
  }
  if (data.details !== undefined && typeof data.details !== 'string') throw new HttpsError('invalid-argument', 'リクエストが不正です。')

  const templateSnap = await getFirestore().doc(`lessonTemplates/${data.templateId}`).get()
  if (!templateSnap.exists || templateSnap.get('visibility') !== 'COMMUNITY') throw new HttpsError('not-found', '通報対象の教材が見つかりません。')
  if (templateSnap.get('createdByUid') === request.auth.uid) throw new HttpsError('permission-denied', '自分が作成した教材は通報できません。')

  const added = await getFirestore().collection('templateReports').add({
    templateId: data.templateId, versionId: data.versionId, reportedByUid: request.auth.uid,
    reason: data.reason, details: data.details ?? null,
    status: 'PENDING', resolution: null, resolvedByUid: null, resolvedAt: null,
    createdAt: FieldValue.serverTimestamp(),
  })
  return { reportId: added.id }
})
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/onCall.test.ts`
Expected: 全件PASS(新規6件を含め既存すべて)。既存の`publishTemplateToCommunityCallable`等のテストは`doc()`モックのパス振り分けが`lessonTemplates/`以外を返さない設計のため、影響を受けない。

- [ ] **Step 5: 型チェックとfunctions全体のテストを実行する**

Run: `cd functions && npx tsc --noEmit && npx vitest run`
Expected: エラーなし、全テストPASS。

- [ ] **Step 6: コミット**

```bash
git add functions/src/lessonTemplates/onCall.ts functions/src/lessonTemplates/onCall.test.ts
git commit -m "feat: COMMUNITY公開教材の通報Callableを追加する"
```

---

### Task 2: 審査Callable(一覧・解決)を実装する

**Files:**
- Modify: `functions/src/lessonTemplates/onCall.ts`
- Modify: `functions/src/lessonTemplates/onCall.test.ts`

**Interfaces:**
- Consumes: Task 1が書き込む`templateReports`ドキュメント形状
- Produces: `listPendingTemplateReportsCallable`、`resolveTemplateReportCallable`、ローカルヘルパー`isCallerOperator(token)`(Task 3の`grantOperatorCallable`も同じ判定ロジックを必要とするため、この関数をそのまま再利用する)

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonTemplates/onCall.test.ts`のファイル末尾に追記する。

```ts
describe('listPendingTemplateReportsCallable', () => {
  const teacherAuth = { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }
  const operatorAuth = { uid: 'operator-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' }, operator: true } }
  const makeRequest = (auth: typeof teacherAuth) => ({ auth, data: {}, rawRequest: {} } as unknown as CallableRequest)

  beforeEach(() => { vi.clearAllMocks() })

  it('rejects a non-operator caller', async () => {
    await expect(listPendingTemplateReportsCallable.run(makeRequest(teacherAuth))).rejects.toMatchObject({ code: 'permission-denied' })
    expect(reportsWhereGetMock).not.toHaveBeenCalled()
  })

  it('returns PENDING reports enriched with the reported template title', async () => {
    reportsWhereGetMock.mockResolvedValue({
      docs: [{ id: 'report-1', data: () => ({ templateId: 't1', versionId: 'v1', reportedByUid: 'teacher-b', reason: 'COPYRIGHT', details: null, status: 'PENDING', createdAt: 'sometime' }) }],
    })
    templateGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'title' ? '通報された教材' : undefined) })

    await expect(listPendingTemplateReportsCallable.run(makeRequest(operatorAuth))).resolves.toEqual([
      { id: 'report-1', templateId: 't1', versionId: 'v1', reportedByUid: 'teacher-b', reason: 'COPYRIGHT', details: null, createdAt: 'sometime', templateTitle: '通報された教材' },
    ])
  })
})

describe('resolveTemplateReportCallable', () => {
  const teacherAuth = { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }
  const operatorAuth = { uid: 'operator-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' }, operator: true } }
  const makeRequest = (auth: typeof teacherAuth, data: Record<string, unknown>) => ({ auth, data, rawRequest: {} } as unknown as CallableRequest)

  beforeEach(() => { vi.clearAllMocks() })

  it('rejects a non-operator caller', async () => {
    await expect(resolveTemplateReportCallable.run(makeRequest(teacherAuth, { reportId: 'report-1', action: 'DISMISS' }))).rejects.toMatchObject({ code: 'permission-denied' })
    expect(reportGetMock).not.toHaveBeenCalled()
  })

  it('rejects a report that does not exist or is already resolved', async () => {
    reportGetMock.mockResolvedValue({ exists: false })
    await expect(resolveTemplateReportCallable.run(makeRequest(operatorAuth, { reportId: 'missing', action: 'DISMISS' }))).rejects.toMatchObject({ code: 'not-found' })

    reportGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'status' ? 'RESOLVED' : undefined) })
    await expect(resolveTemplateReportCallable.run(makeRequest(operatorAuth, { reportId: 'report-1', action: 'DISMISS' }))).rejects.toMatchObject({ code: 'not-found' })
  })

  it('DISMISS resolves the report without touching the template', async () => {
    reportGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'status' ? 'PENDING' : field === 'templateId' ? 't1' : undefined) })
    await resolveTemplateReportCallable.run(makeRequest(operatorAuth, { reportId: 'report-1', action: 'DISMISS' }))
    expect(templateUpdateMock).not.toHaveBeenCalled()
    expect(reportUpdateMock).toHaveBeenCalledWith({ status: 'RESOLVED', resolution: 'DISMISSED', resolvedByUid: 'operator-a', resolvedAt: 'SERVER_TIMESTAMP' })
  })

  it('UNPUBLISH sets the template back to PRIVATE and resolves the report', async () => {
    reportGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'status' ? 'PENDING' : field === 'templateId' ? 't1' : undefined) })
    await resolveTemplateReportCallable.run(makeRequest(operatorAuth, { reportId: 'report-1', action: 'UNPUBLISH' }))
    expect(templateUpdateMock).toHaveBeenCalledWith({ visibility: 'PRIVATE' })
    expect(reportUpdateMock).toHaveBeenCalledWith({ status: 'RESOLVED', resolution: 'UNPUBLISHED', resolvedByUid: 'operator-a', resolvedAt: 'SERVER_TIMESTAMP' })
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/onCall.test.ts`
Expected: FAIL(`listPendingTemplateReportsCallable`/`resolveTemplateReportCallable`が存在しない)。

- [ ] **Step 3: `onCall.ts`に実装を追加する**

ファイル末尾に追記する。

```ts
/** Mirrors firestore.rules' operator(): teacher() && request.auth.token.operator == true. */
const isCallerOperator = (token: { email_verified?: boolean; firebase?: { sign_in_provider?: string }; operator?: boolean }): boolean =>
  isCallerTeacher(token) && token.operator === true

export const listPendingTemplateReportsCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerOperator(request.auth.token)) throw new HttpsError('permission-denied', '運営者アカウントのみ利用できます。')

  const snapshot = await getFirestore().collection('templateReports').where('status', '==', 'PENDING').get()
  const reports = await Promise.all(snapshot.docs.map(async (reportDoc) => {
    const data = reportDoc.data() as { templateId: string; versionId: string; reportedByUid: string; reason: TemplateReportReason; details: string | null; createdAt: unknown }
    const templateSnap = await getFirestore().doc(`lessonTemplates/${data.templateId}`).get()
    return {
      id: reportDoc.id, templateId: data.templateId, versionId: data.versionId, reportedByUid: data.reportedByUid,
      reason: data.reason, details: data.details, createdAt: data.createdAt,
      templateTitle: templateSnap.exists ? (templateSnap.get('title') as string | undefined) ?? null : null,
    }
  }))
  return reports
})

interface ResolveTemplateReportCallableInput { reportId?: unknown; action?: unknown }
const isValidResolveAction = (value: unknown): value is 'UNPUBLISH' | 'DISMISS' => value === 'UNPUBLISH' || value === 'DISMISS'

export const resolveTemplateReportCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerOperator(request.auth.token)) throw new HttpsError('permission-denied', '運営者アカウントのみ利用できます。')
  const data = request.data as ResolveTemplateReportCallableInput
  if (typeof data.reportId !== 'string' || !isValidResolveAction(data.action)) throw new HttpsError('invalid-argument', 'リクエストが不正です。')

  const reportSnap = await getFirestore().doc(`templateReports/${data.reportId}`).get()
  if (!reportSnap.exists || reportSnap.get('status') !== 'PENDING') throw new HttpsError('not-found', '通報が見つからないか、既に解決済みです。')

  if (data.action === 'UNPUBLISH') {
    const templateId = reportSnap.get('templateId') as string
    await getFirestore().doc(`lessonTemplates/${templateId}`).update({ visibility: 'PRIVATE' })
  }
  await getFirestore().doc(`templateReports/${data.reportId}`).update({
    status: 'RESOLVED', resolution: data.action === 'UNPUBLISH' ? 'UNPUBLISHED' : 'DISMISSED',
    resolvedByUid: request.auth.uid, resolvedAt: FieldValue.serverTimestamp(),
  })
  return { resolved: true }
})
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/onCall.test.ts`
Expected: 全件PASS。

- [ ] **Step 5: 型チェックとfunctions全体のテストを実行する**

Run: `cd functions && npx tsc --noEmit && npx vitest run`
Expected: エラーなし、全テストPASS。

- [ ] **Step 6: コミット**

```bash
git add functions/src/lessonTemplates/onCall.ts functions/src/lessonTemplates/onCall.test.ts
git commit -m "feat: 運営者向けの通報一覧・解決Callableを追加する"
```

---

### Task 3: `grantOperatorCallable`を実装し、Callableをエクスポートする

**Files:**
- Modify: `functions/src/lessonTemplates/onCall.ts`
- Modify: `functions/src/lessonTemplates/onCall.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: Task 2の`isCallerOperator`
- Produces: `grantOperatorCallable`。すべて`functions/src/index.ts`からエクスポートされ、実際にデプロイされる。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonTemplates/onCall.test.ts`冒頭のimportに追記する。

```ts
import {
  grantOperatorCallable, listPendingTemplateReportsCallable, reportTemplateCallable, resolveTemplateReportCallable,
} from './onCall'
```

冒頭に`firebase-admin/auth`のモックを追加する(既存の`vi.mock('firebase-admin/firestore', ...)`の直後)。

```ts
const setCustomUserClaimsMock = vi.fn()
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ setCustomUserClaims: setCustomUserClaimsMock }) }))
```

ファイル末尾に追記する。

```ts
describe('grantOperatorCallable', () => {
  const teacherAuth = { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }
  const operatorAuth = { uid: 'operator-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' }, operator: true } }
  const makeRequest = (auth: typeof teacherAuth, data: Record<string, unknown>) => ({ auth, data, rawRequest: {} } as unknown as CallableRequest)

  beforeEach(() => { vi.clearAllMocks() })

  it('rejects a non-operator caller', async () => {
    await expect(grantOperatorCallable.run(makeRequest(teacherAuth, { targetUid: 'teacher-b' }))).rejects.toMatchObject({ code: 'permission-denied' })
    expect(setCustomUserClaimsMock).not.toHaveBeenCalled()
  })

  it('grants the operator claim to the target user', async () => {
    setCustomUserClaimsMock.mockResolvedValue(undefined)
    await expect(grantOperatorCallable.run(makeRequest(operatorAuth, { targetUid: 'teacher-b' }))).resolves.toEqual({ granted: true })
    expect(setCustomUserClaimsMock).toHaveBeenCalledWith('teacher-b', { operator: true })
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/onCall.test.ts`
Expected: FAIL(`grantOperatorCallable`が存在せず、`firebase-admin/auth`もimportされていない)。

- [ ] **Step 3: `onCall.ts`に実装を追加する**

冒頭のimportに追加する。

```ts
import { getAuth } from 'firebase-admin/auth'
```

ファイル末尾に追記する。

```ts
interface GrantOperatorCallableInput { targetUid?: unknown }

export const grantOperatorCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerOperator(request.auth.token)) throw new HttpsError('permission-denied', '運営者アカウントのみ利用できます。')
  const data = request.data as GrantOperatorCallableInput
  if (typeof data.targetUid !== 'string' || data.targetUid.length === 0) throw new HttpsError('invalid-argument', 'リクエストが不正です。')

  await getAuth().setCustomUserClaims(data.targetUid, { operator: true })
  return { granted: true }
})
```

- [ ] **Step 4: `functions/src/index.ts`にエクスポートを追加する**

既存の以下のブロックを:

```ts
export {
  createTemplateShareCallable, duplicateLessonTemplateCallable, publishLessonVersionCallable,
  publishTemplateToCommunityCallable, resolveTemplateShareCallable, revokeTemplateShareCallable,
  unpublishTemplateFromCommunityCallable,
} from './lessonTemplates/onCall'
```

以下に置き換える。

```ts
export {
  createTemplateShareCallable, duplicateLessonTemplateCallable, grantOperatorCallable, listPendingTemplateReportsCallable,
  publishLessonVersionCallable, publishTemplateToCommunityCallable, reportTemplateCallable, resolveTemplateReportCallable,
  resolveTemplateShareCallable, revokeTemplateShareCallable, unpublishTemplateFromCommunityCallable,
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
git commit -m "feat: operatorクレーム付与Callableを追加し新規Callableをエクスポートする"
```

---

### Task 4: Firestoreセキュリティルールを追加する

**Files:**
- Modify: `firestore.rules`
- Modify: `test/firestore.rules.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `templateReports/{reportId}`の読み書き制御(Functions Admin SDKはルールをバイパスするため、Task 1〜3の実装には影響しない)

- [ ] **Step 1: 失敗するテストを書く**

`test/firestore.rules.test.ts`の`describe('templateShares/{shareId}', ...)`ブロックの直後に追記する。

```ts
describe('templateReports/{reportId}', () => {
  it('declares an explicit deny rule for the template reports collection', () => {
    const rules = readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8')
    expect(rules).toMatch(
      /match \/templateReports\/\{reportId\} \{[\s\S]*?allow read, write: if false;[\s\S]*?\}/,
    )
  })

  it('denies all direct client reads and writes', async () => {
    const context = environment.authenticatedContext('teacher-a', teacherToken)
    const report = doc(context.firestore(), 'templateReports/report-1')
    await assertFails(getDoc(report))
    await assertFails(setDoc(report, { templateId: 't1' }))
  })
})
```

- [ ] **Step 2: ルールテストを実行して失敗を確認する**

Run: `npx firebase emulators:exec --project demo-stock-league-classroom --only firestore,database,storage "npx vitest --config vite.rules.config.ts run test/firestore.rules.test.ts"`
Expected: FAIL(`templateReports`にマッチする明示ルールがまだ存在しない)。

- [ ] **Step 3: `firestore.rules`にルールを追加する**

`firestore.rules`の`match /templateShares/{shareId} { allow read, write: if false; }`の直後に追記する。

```
    match /templateReports/{reportId} { allow read, write: if false; }
```

- [ ] **Step 4: ルールテストを実行して成功を確認する**

Run: `npx firebase emulators:exec --project demo-stock-league-classroom --only firestore,database,storage "npx vitest --config vite.rules.config.ts run test/firestore.rules.test.ts"`
Expected: 全件PASS。

- [ ] **Step 5: コミット**

```bash
git add firestore.rules test/firestore.rules.test.ts
git commit -m "feat: templateReportsのFirestoreルールを追加する"
```

---

### Task 5: `CommunityTemplatesPage`に通報ボタンを追加する

**Files:**
- Modify: `src/components/teacher/templates/CommunityTemplatesPage.tsx`
- Modify: `src/components/teacher/templates/CommunityTemplatesPage.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `CommunityTemplatesPageProps.onReport: (template: CommunityTemplate, reason: TemplateReportReason, details: string) => void`(`TemplateReportReason`はこのファイルでexportする)

- [ ] **Step 1: 失敗するテストを書く**

`src/components/teacher/templates/CommunityTemplatesPage.test.tsx`の既存3件のテストすべての`render(...)`呼び出しに`onReport={vi.fn()}`を追加する(`onDuplicate={onDuplicate}`等の直後)。ファイル末尾に新しいテストを追記する。

```ts
  it('opens a report dialog and submits the selected reason', () => {
    const onReport = vi.fn()
    render(<CommunityTemplatesPage templates={templates} loading={false} subject={undefined} onSubjectChange={vi.fn()} onDuplicate={vi.fn()} onReport={onReport} />)
    fireEvent.click(screen.getAllByRole('button', { name: '通報' })[0])
    fireEvent.click(screen.getByRole('button', { name: '著作権' }))
    fireEvent.click(screen.getByRole('button', { name: '送信' }))
    expect(onReport).toHaveBeenCalledWith(templates[0], 'COPYRIGHT', '')
  })
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run src/components/teacher/templates/CommunityTemplatesPage.test.tsx`
Expected: FAIL(型エラー: `onReport`が`CommunityTemplatesPageProps`に存在しない、「通報」ボタンが存在しない)。

- [ ] **Step 3: `CommunityTemplatesPage.tsx`を修正する**

ファイル全体を以下に置き換える。

```tsx
import { useState } from 'react'
import { Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, ListItemText, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import type { CommunityTemplate } from '../../../lib/lessonTemplates/communityTemplates'

export type TemplateReportReason = 'PERSONAL_INFO' | 'COPYRIGHT' | 'INAPPROPRIATE' | 'MISINFORMATION' | 'OTHER'
const REPORT_REASONS: Array<{ value: TemplateReportReason; label: string }> = [
  { value: 'PERSONAL_INFO', label: '個人情報' },
  { value: 'COPYRIGHT', label: '著作権' },
  { value: 'INAPPROPRIATE', label: '不適切な内容' },
  { value: 'MISINFORMATION', label: '誤った情報' },
  { value: 'OTHER', label: 'その他' },
]

export interface CommunityTemplatesPageProps {
  templates: CommunityTemplate[]
  loading: boolean
  subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS' | undefined
  onSubjectChange: (subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS' | undefined) => void
  onDuplicate: (template: CommunityTemplate) => void
  onReport: (template: CommunityTemplate, reason: TemplateReportReason, details: string) => void
}

export function CommunityTemplatesPage({ templates, loading, subject, onSubjectChange, onDuplicate, onReport }: CommunityTemplatesPageProps) {
  const [reportTarget, setReportTarget] = useState<CommunityTemplate>()
  const [reason, setReason] = useState<TemplateReportReason>()
  const [details, setDetails] = useState('')
  const closeDialog = () => { setReportTarget(undefined); setReason(undefined); setDetails('') }
  return <Stack spacing={2} sx={{ p: 2 }}>
    <Typography variant="h5">教材マーケットプレイス</Typography>
    <ToggleButtonGroup exclusive value={subject ?? null} onChange={(_event, value) => onSubjectChange(value ?? undefined)}>
      <ToggleButton value="SOCIAL_STUDIES">公民</ToggleButton>
      <ToggleButton value="HOME_ECONOMICS">家庭科</ToggleButton>
    </ToggleButtonGroup>
    {loading ? <CircularProgress aria-label="読み込み中" /> : templates.length
      ? <List>{templates.map((template) => <ListItem key={template.id} secondaryAction={<Stack direction="row" spacing={1}><Button variant="outlined" onClick={() => onDuplicate(template)}>自組織へ複製</Button><Button color="error" onClick={() => setReportTarget(template)}>通報</Button></Stack>}><ListItemText primary={template.title} secondary={template.description} /></ListItem>)}</List>
      : <Typography color="text.secondary">公開されている教材がまだありません。</Typography>}
    <Dialog open={!!reportTarget} onClose={closeDialog}>
      <DialogTitle>教材を通報</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            {REPORT_REASONS.map((item) => <ToggleButton key={item.value} value={item.value} selected={reason === item.value} onChange={() => setReason(item.value)}>{item.label}</ToggleButton>)}
          </Stack>
          <TextField label="詳細(任意)" value={details} onChange={(event) => setDetails(event.target.value)} multiline minRows={2} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={closeDialog}>キャンセル</Button>
        <Button variant="contained" disabled={!reason} onClick={() => { if (reportTarget && reason) { onReport(reportTarget, reason, details); closeDialog() } }}>送信</Button>
      </DialogActions>
    </Dialog>
  </Stack>
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `npx vitest run src/components/teacher/templates/CommunityTemplatesPage.test.tsx`
Expected: 全件PASS。

- [ ] **Step 5: `App.tsx`の`CommunityMarketplaceRoute`を修正する**

`import { duplicateLessonTemplate } from './lib/lessonTemplates/duplicateLessonTemplate'`の直後に追加する。

```ts
import { reportTemplate } from './lib/lessonTemplates/reportTemplate'
```

`CommunityMarketplaceRoute`関数内、`onDuplicate={...}`の`/>`直前(`CommunityTemplatesPage`の閉じタグ手前)に`onReport`propを追加する。

```tsx
    onReport={(template, reason, details) => {
      void reportTemplate(services.functions, { templateId: template.id, versionId: template.currentPublishedVersionId, reason, details: details || undefined })
    }}
```

`src/lib/lessonTemplates/reportTemplate.ts`を新規作成する。

```ts
import { httpsCallable, type Functions } from 'firebase/functions'

// Duplicated (not imported) from CommunityTemplatesPage.tsx's TemplateReportReason on purpose:
// a lib module should not depend on a component module's types. Both are the
// same 5-literal union, so values from either side remain structurally assignable.
export type TemplateReportReason = 'PERSONAL_INFO' | 'COPYRIGHT' | 'INAPPROPRIATE' | 'MISINFORMATION' | 'OTHER'

export interface ReportTemplateInput { templateId: string; versionId: string; reason: TemplateReportReason; details?: string }
export interface ReportTemplateResult { reportId: string }

export const reportTemplate = async (functions: Functions, input: ReportTemplateInput): Promise<ReportTemplateResult> => {
  const call = httpsCallable<ReportTemplateInput, ReportTemplateResult>(functions, 'reportTemplateCallable')
  const result = await call(input)
  return result.data
}
```

- [ ] **Step 6: プロジェクト全体の型チェックとテストを実行する**

Run: `npx tsc -b && npx tsc -p tsconfig.rules.json && npx vitest run`
Expected: エラーなし、全テストPASS。

- [ ] **Step 7: コミット**

```bash
git add src/components/teacher/templates/CommunityTemplatesPage.tsx src/components/teacher/templates/CommunityTemplatesPage.test.tsx src/App.tsx src/lib/lessonTemplates/reportTemplate.ts
git commit -m "feat: マーケットプレイス一覧に教材の通報ボタンを追加する"
```

---

### Task 6: 運営者向け審査画面とルートを追加する

**Files:**
- Create: `src/lib/lessonTemplates/moderationQueue.ts`
- Create: `src/components/operator/OperatorReportsPage.tsx`
- Test: `src/components/operator/OperatorReportsPage.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: Task 3の`listPendingTemplateReportsCallable`/`resolveTemplateReportCallable`(Callable名)
- Produces: `/operator/reports`ルート

- [ ] **Step 1: クライアントlibを実装する(テストなしの薄いラッパー、他のCallableラッパーと同じ形式)**

`src/lib/lessonTemplates/moderationQueue.ts`を新規作成する。

```ts
import { httpsCallable, type Functions } from 'firebase/functions'

export interface PendingTemplateReport {
  id: string
  templateId: string
  versionId: string
  reportedByUid: string
  reason: 'PERSONAL_INFO' | 'COPYRIGHT' | 'INAPPROPRIATE' | 'MISINFORMATION' | 'OTHER'
  details: string | null
  createdAt: unknown
  templateTitle: string | null
}

export const listPendingTemplateReports = async (functions: Functions): Promise<PendingTemplateReport[]> =>
  (await httpsCallable<Record<string, never>, PendingTemplateReport[]>(functions, 'listPendingTemplateReportsCallable')({})).data

export interface ResolveTemplateReportInput { reportId: string; action: 'UNPUBLISH' | 'DISMISS' }
export interface ResolveTemplateReportResult { resolved: true }

export const resolveTemplateReport = async (functions: Functions, input: ResolveTemplateReportInput): Promise<ResolveTemplateReportResult> =>
  (await httpsCallable<ResolveTemplateReportInput, ResolveTemplateReportResult>(functions, 'resolveTemplateReportCallable')(input)).data
```

- [ ] **Step 2: 失敗するコンポーネントテストを書く**

`src/components/operator/OperatorReportsPage.test.tsx`を新規作成する。

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OperatorReportsPage } from './OperatorReportsPage'

const reports = [
  { id: 'r1', templateId: 't1', versionId: 'v1', reportedByUid: 'teacher-b', reason: 'COPYRIGHT' as const, details: '出典不明', createdAt: 'sometime', templateTitle: '通報された教材' },
]

describe('OperatorReportsPage', () => {
  it('shows an access-denied message', () => {
    render(<OperatorReportsPage reports={[]} loading={false} accessDenied onUnpublish={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByText('この画面は運営者のみ利用できます。')).toBeInTheDocument()
  })

  it('lists pending reports and triggers unpublish/dismiss', () => {
    const onUnpublish = vi.fn(); const onDismiss = vi.fn()
    render(<OperatorReportsPage reports={reports} loading={false} accessDenied={false} onUnpublish={onUnpublish} onDismiss={onDismiss} />)
    expect(screen.getByText('通報された教材')).toBeInTheDocument()
    expect(screen.getByText('出典不明')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '非公開化' }))
    expect(onUnpublish).toHaveBeenCalledWith(reports[0])
    fireEvent.click(screen.getByRole('button', { name: '却下' }))
    expect(onDismiss).toHaveBeenCalledWith(reports[0])
  })

  it('shows an empty state with no pending reports', () => {
    render(<OperatorReportsPage reports={[]} loading={false} accessDenied={false} onUnpublish={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByText('未対応の通報はありません。')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: テストを実行して失敗を確認する**

Run: `npx vitest run src/components/operator/OperatorReportsPage.test.tsx`
Expected: FAIL(`./OperatorReportsPage`モジュールが存在しない)。

- [ ] **Step 4: コンポーネントを実装する**

`src/components/operator/OperatorReportsPage.tsx`を新規作成する。

```tsx
import { Button, CircularProgress, List, ListItem, ListItemText, Stack, Typography } from '@mui/material'
import type { PendingTemplateReport } from '../../lib/lessonTemplates/moderationQueue'

export interface OperatorReportsPageProps {
  reports: PendingTemplateReport[]
  loading: boolean
  accessDenied: boolean
  onUnpublish: (report: PendingTemplateReport) => void
  onDismiss: (report: PendingTemplateReport) => void
}

export function OperatorReportsPage({ reports, loading, accessDenied, onUnpublish, onDismiss }: OperatorReportsPageProps) {
  if (accessDenied) return <Stack sx={{ p: 2 }}><Typography color="error">この画面は運営者のみ利用できます。</Typography></Stack>
  return <Stack spacing={2} sx={{ p: 2 }}>
    <Typography variant="h5">通報の審査</Typography>
    {loading ? <CircularProgress aria-label="読み込み中" /> : reports.length
      ? <List>{reports.map((report) => <ListItem key={report.id} secondaryAction={<Stack direction="row" spacing={1}><Button color="error" onClick={() => onUnpublish(report)}>非公開化</Button><Button onClick={() => onDismiss(report)}>却下</Button></Stack>}><ListItemText primary={report.templateTitle ?? report.templateId} secondary={report.details ?? report.reason} /></ListItem>)}</List>
      : <Typography color="text.secondary">未対応の通報はありません。</Typography>}
  </Stack>
}
```

- [ ] **Step 5: テストを実行して成功を確認する**

Run: `npx vitest run src/components/operator/OperatorReportsPage.test.tsx`
Expected: 全件PASS。

- [ ] **Step 6: `App.tsx`にルートを追加する**

`import { CommunityTemplatesPage } from './components/teacher/templates/CommunityTemplatesPage'`の直後に追記する。

```ts
import { OperatorReportsPage } from './components/operator/OperatorReportsPage'
import { listPendingTemplateReports, resolveTemplateReport, type PendingTemplateReport } from './lib/lessonTemplates/moderationQueue'
```

`CommunityMarketplaceRoute`関数の直後に新しいRoute関数を追加する。

```tsx
function OperatorReportsRoute({ services }: { services: FirebaseServices }) {
  const [reports, setReports] = useState<PendingTemplateReport[]>([])
  const [loading, setLoading] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)
  const load = () => {
    setLoading(true)
    listPendingTemplateReports(services.functions)
      .then((result) => { setReports(result); setAccessDenied(false) })
      .catch(() => setAccessDenied(true))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [services])
  return <OperatorReportsPage
    reports={reports} loading={loading} accessDenied={accessDenied}
    onUnpublish={(report) => { void resolveTemplateReport(services.functions, { reportId: report.id, action: 'UNPUBLISH' }).then(load) }}
    onDismiss={(report) => { void resolveTemplateReport(services.functions, { reportId: report.id, action: 'DISMISS' }).then(load) }}
  />
}
```

`<Route path="/teacher/marketplace" .../>`の直後に追記する(`TemplateRouteGuard`は「署名済みの教師であること」のみを確認し、`operator`の判定自体はCallableが行う)。

```tsx
  <Route path="/operator/reports" element={enabled && services ? <TemplateRouteGuard services={services}><OperatorReportsRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
```

- [ ] **Step 7: プロジェクト全体の型チェックとテストを実行する**

Run: `npx tsc -b && npx tsc -p tsconfig.rules.json && npx vitest run`
Expected: エラーなし、全テストPASS。

- [ ] **Step 8: コミット**

```bash
git add src/lib/lessonTemplates/moderationQueue.ts src/components/operator/OperatorReportsPage.tsx src/components/operator/OperatorReportsPage.test.tsx src/App.tsx
git commit -m "feat: 運営者向けの通報審査画面とルートを追加する"
```
