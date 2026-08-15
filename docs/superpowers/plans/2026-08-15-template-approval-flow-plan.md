# 組織内教材承認フロー Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 組織のowner/adminが、教師が公開したテンプレートを承認/却下でき、未承認(PENDING/REJECTED)のテンプレートは作成者本人以外は授業実施(lessonRun作成)に使えないようにする。

**Architecture:** `lessonTemplates`に`approvalStatus`フィールドを追加し、`publishLessonVersion`が公開の都度`PENDING`に設定する。`createLessonRun`の既存テンプレートゲートに承認チェックを1つ追加する。承認/却下は新規Callable2本(owner/admin限定)で行う。既存データ(`approvalStatus`未設定)は`APPROVED`相当として扱われるため、マイグレーションは不要。

**Tech Stack:** TypeScript, Firebase Cloud Functions (Callable, region `asia-northeast1`), Firestore Admin SDK, Vitest, React, MUI, react-router。

## Global Constraints

- Callable region は必ず `asia-northeast1`。
- 承認/却下Callableの認可は `requireActiveOrgMember` + ローカル `requireManager` ヘルパー(owner/adminのみ)。
- `approvalStatus`未設定は`APPROVED`相当として扱う(既存データへの後方互換)。
- 密なシングルライン関数本体という既存のハウススタイルに従う。
- 新しいコメントは「なぜ」が非自明な場合のみ追加する。

---

### Task 1: `publishLessonVersion` が公開のたびに `approvalStatus: 'PENDING'` を設定する

**Files:**
- Modify: `functions/src/lessonTemplates/publishLessonVersion.ts:80-84`
- Test: `functions/src/lessonTemplates/publishLessonVersion.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `lessonTemplates/{id}`ドキュメントに`approvalStatus: 'PENDING'`が公開のたびに書き込まれる(Task 2・3が読む)。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonTemplates/publishLessonVersion.test.ts` の41行目のテスト(`'creates a version doc from the current draft and updates the template pointer/status in one transaction'`)内、53-56行目の`expect(fake.docs.get('lessonTemplates/t1')).toMatchObject({...})`を以下に置き換える:

```ts
    expect(fake.docs.get('lessonTemplates/t1')).toMatchObject({
      currentPublishedVersionId: 'version-1', status: 'READY', approvalStatus: 'PENDING',
      title: 'ドラフト', description: '', subject: 'SOCIAL_STUDIES',
    })
```

ファイル末尾(111行目、`describe`ブロックの直前の`})`の直後)に新しいテストを追加:

```ts

describe('publishLessonVersion approvalStatus', () => {
  it('resets an already-APPROVED template back to PENDING when republished', async () => {
    const fake = makeFakeFirestore([{
      path: 'lessonTemplates/t1',
      data: { ...baseTemplate, currentPublishedVersionId: 'version-0', status: 'READY', approvalStatus: 'APPROVED' },
    }])
    await publishLessonVersion(makeDeps(fake, ['version-1']), {
      templateId: 't1', orgId: 'personal_teacher-a', uid: 'teacher-a', changeSummary: '改訂', idempotencyKey: 'key-2',
    })
    expect(fake.docs.get('lessonTemplates/t1')).toMatchObject({ approvalStatus: 'PENDING' })
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/publishLessonVersion.test.ts`
Expected: FAIL — `approvalStatus`が`undefined`のためマッチしない

- [ ] **Step 3: 実装する**

`functions/src/lessonTemplates/publishLessonVersion.ts` の80-84行目を以下に置き換える:

```ts
    tx.set(templatePath, {
      currentPublishedVersionId: versionId, status: 'READY', approvalStatus: 'PENDING', updatedAt: now,
      title: publishedDraft.title, description: publishedDraft.description, subject: publishedDraft.subject,
    }, { merge: true })
```

- [ ] **Step 4: テストを実行してパスを確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/publishLessonVersion.test.ts`
Expected: 全テストPASS(9件)

- [ ] **Step 5: コミット**

```bash
git add functions/src/lessonTemplates/publishLessonVersion.ts functions/src/lessonTemplates/publishLessonVersion.test.ts
git commit -m "feat: テンプレート公開のたびにapprovalStatusをPENDINGにする"
```

---

### Task 2: `createLessonRun` で未承認テンプレートの他教師利用を拒否する

**Files:**
- Modify: `functions/src/lessonRuns/createLessonRun.ts:80-83`
- Modify: `functions/src/lessonRuns/onCall.ts:43-44`
- Test: `functions/src/lessonRuns/createLessonRun.test.ts`
- Test: `functions/src/lessonRuns/onCall.test.ts`

**Interfaces:**
- Consumes: `lessonTemplates/{id}`の`createdByUid`/`approvalStatus`フィールド(Task 1が書き込む)
- Produces: `createLessonRun`が`'Template is not approved for use by other teachers'`エラーを投げる新しいケース。`functions/src/lessonRuns/onCall.ts`がこれを`failed-precondition`に変換する。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonRuns/createLessonRun.test.ts` に以下の2つのテストを追加する(既存の`'rejects when the template does not belong to the expected organization'`相当のテストブロックの近くに追加。ファイル内で`fake.docs.set('lessonTemplates/tpl-1', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v-foreign' })`のテストを検索し、その直後に追加):

```ts
  it('allows the template creator to use their own PENDING template', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-pending', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1', createdByUid: 'teacher-a', approvalStatus: 'PENDING' })
    fake.docs.set('lessonTemplates/tpl-pending/versions/v1', { templateId: 'tpl-pending', orgId: 'personal_teacher-a', content: { subject: 'SOCIAL_STUDIES' } })
    const result = await createLessonRun({
      firestore: fake as never, generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-fixed',
      lessonRunIdempotencyKey: 'idem-own-pending', orgId: 'personal_teacher-a', templateId: 'tpl-pending', primaryTeacherUid: 'teacher-a',
    })
    expect(result.created).toBe(true)
  })

  it('rejects another teacher using a PENDING template', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-pending', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1', createdByUid: 'teacher-a', approvalStatus: 'PENDING' })
    fake.docs.set('lessonTemplates/tpl-pending/versions/v1', { templateId: 'tpl-pending', orgId: 'personal_teacher-a', content: { subject: 'SOCIAL_STUDIES' } })
    await expect(createLessonRun({
      firestore: fake as never, generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-fixed',
      lessonRunIdempotencyKey: 'idem-other-pending', orgId: 'personal_teacher-a', templateId: 'tpl-pending', primaryTeacherUid: 'teacher-b',
    })).rejects.toThrow('Template is not approved for use by other teachers')
  })

  it('rejects another teacher using a REJECTED template', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-rejected', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1', createdByUid: 'teacher-a', approvalStatus: 'REJECTED' })
    fake.docs.set('lessonTemplates/tpl-rejected/versions/v1', { templateId: 'tpl-rejected', orgId: 'personal_teacher-a', content: { subject: 'SOCIAL_STUDIES' } })
    await expect(createLessonRun({
      firestore: fake as never, generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-fixed',
      lessonRunIdempotencyKey: 'idem-other-rejected', orgId: 'personal_teacher-a', templateId: 'tpl-rejected', primaryTeacherUid: 'teacher-b',
    })).rejects.toThrow('Template is not approved for use by other teachers')
  })

  it('allows another teacher to use an APPROVED template', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-approved', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1', createdByUid: 'teacher-a', approvalStatus: 'APPROVED' })
    fake.docs.set('lessonTemplates/tpl-approved/versions/v1', { templateId: 'tpl-approved', orgId: 'personal_teacher-a', content: { subject: 'SOCIAL_STUDIES' } })
    const result = await createLessonRun({
      firestore: fake as never, generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-fixed',
      lessonRunIdempotencyKey: 'idem-other-approved', orgId: 'personal_teacher-a', templateId: 'tpl-approved', primaryTeacherUid: 'teacher-b',
    })
    expect(result.created).toBe(true)
  })

  it('allows another teacher to use a template with no approvalStatus set (pre-existing data)', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-legacy', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1', createdByUid: 'teacher-a' })
    fake.docs.set('lessonTemplates/tpl-legacy/versions/v1', { templateId: 'tpl-legacy', orgId: 'personal_teacher-a', content: { subject: 'SOCIAL_STUDIES' } })
    const result = await createLessonRun({
      firestore: fake as never, generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-fixed',
      lessonRunIdempotencyKey: 'idem-other-legacy', orgId: 'personal_teacher-a', templateId: 'tpl-legacy', primaryTeacherUid: 'teacher-b',
    })
    expect(result.created).toBe(true)
  })
```

`makeFakeFirestore`は`(options: { transactionAttempts?: number } = {})`というシグネチャで引数無しで呼べる(`functions/src/lessonRuns/createLessonRun.test.ts:4`)。上記のテストコードのまま追加してよい。

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/lessonRuns/createLessonRun.test.ts`
Expected: FAIL — 「他教師によるPENDING/REJECTED拒否」の2件が失敗(現状は拒否されず作成されてしまう)

- [ ] **Step 3: 実装する**

`functions/src/lessonRuns/createLessonRun.ts` の80-83行目を以下に置き換える:

```ts
    const template = templateSnap.data() as { orgId: string; currentPublishedVersionId: string | null; createdByUid: string; approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' }
    if (template.orgId !== deps.orgId) throw new Error('Template does not belong to this organization')
    if (!template.currentPublishedVersionId) throw new Error('Template has no published version to snapshot')
    if (template.createdByUid !== deps.primaryTeacherUid && (template.approvalStatus === 'PENDING' || template.approvalStatus === 'REJECTED')) {
      throw new Error('Template is not approved for use by other teachers')
    }
```

- [ ] **Step 4: テストを実行してパスを確認する**

Run: `cd functions && npx vitest run src/lessonRuns/createLessonRun.test.ts`
Expected: 全テストPASS

- [ ] **Step 5: Callable層のエラー変換テストを追加する**

`functions/src/lessonRuns/onCall.test.ts` の`it.each`テーブル(既存の6行、`['LessonTemplate not found', 'not-found'], ...`)に1行追加:

```ts
    ['Template is not approved for use by other teachers', 'failed-precondition'],
```

- [ ] **Step 6: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/lessonRuns/onCall.test.ts`
Expected: FAIL — このメッセージが未対応のエラーコードにマッピングされる

- [ ] **Step 7: `onCall.ts` にエラー変換を追加する**

`functions/src/lessonRuns/onCall.ts` の44行目の直後に追加:

```ts
    if (error.message === 'Template is not approved for use by other teachers') return new HttpsError('failed-precondition', error.message)
```

- [ ] **Step 8: テストを実行してパスを確認する**

Run: `cd functions && npx vitest run src/lessonRuns/onCall.test.ts src/lessonRuns/createLessonRun.test.ts`
Expected: 全テストPASS

- [ ] **Step 9: コミット**

```bash
git add functions/src/lessonRuns/createLessonRun.ts functions/src/lessonRuns/createLessonRun.test.ts functions/src/lessonRuns/onCall.ts functions/src/lessonRuns/onCall.test.ts
git commit -m "feat: 未承認テンプレートを作成者以外が授業実施に使えないようにする"
```

---

### Task 3: 承認Callable2本を追加する

**Files:**
- Modify: `functions/src/lessonTemplates/onCall.ts`
- Modify: `functions/src/index.ts`
- Modify: `firestore.indexes.json`
- Test: `functions/src/lessonTemplates/onCall.test.ts`

**Interfaces:**
- Consumes: `requireActiveOrgMember`(`../organizations/authorization`)
- Produces: `export const listPendingTemplateApprovalsCallable`、`export const reviewTemplateApprovalCallable` — Task 5のフロントエンドが呼ぶ。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonTemplates/onCall.test.ts` の4-22行目のimportブロックに以下の2つを追加:

```ts
  listPendingTemplateApprovalsCallable,
  reviewTemplateApprovalCallable,
```

45行目付近(`vi.mock('../organizations/authorization', () => ({ requireActiveOrgMember: vi.fn() }))`)の直後に、新しいFirestoreモック変数を1つ追加(37行目付近、`const reportsWhereGetMock = vi.fn()`の直後):

```ts
const templatesWhereGetMock = vi.fn()
```

60-70行目の`vi.mock('firebase-admin/firestore', ...)`ブロックを以下に置き換える(`collection`に`lessonTemplates`分岐を追加):

```ts
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
  getFirestore: () => ({
    doc: (path: string) => path.startsWith('templateReports/')
      ? { get: reportGetMock, update: reportUpdateMock }
      : { get: templateGetMock, update: templateUpdateMock },
    collection: (path: string) => {
      if (path === 'templateReports') return { add: reportAddMock, where: () => ({ get: reportsWhereGetMock }) }
      if (path === 'lessonTemplates') return { where: () => ({ where: () => ({ get: templatesWhereGetMock }) }) }
      return undefined
    },
  }),
}))
```

ファイル末尾に新しい`describe`ブロックを追加:

```ts

describe('listPendingTemplateApprovalsCallable', () => {
  beforeEach(() => vi.clearAllMocks())

  it('requires owner or admin', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    const request = { auth: { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }, data: { orgId: 'org-1' } } as unknown as CallableRequest
    await expect(listPendingTemplateApprovalsCallable.run(request)).rejects.toThrow('owner または admin')
  })

  it('returns PENDING templates for the org', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'admin', membershipVersion: 1 })
    templatesWhereGetMock.mockResolvedValueOnce({
      docs: [{ id: 'tpl-1', data: () => ({ title: '株式市場入門', createdByUid: 'teacher-a', updatedAt: 'ts-1' }) }],
    })
    const request = { auth: { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }, data: { orgId: 'org-1' } } as unknown as CallableRequest
    await expect(listPendingTemplateApprovalsCallable.run(request)).resolves.toEqual([
      { id: 'tpl-1', title: '株式市場入門', createdByUid: 'teacher-a', updatedAt: 'ts-1' },
    ])
  })
})

describe('reviewTemplateApprovalCallable', () => {
  beforeEach(() => vi.clearAllMocks())

  it('requires owner or admin', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    const request = { auth: { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }, data: { orgId: 'org-1', templateId: 'tpl-1', decision: 'APPROVED' } } as unknown as CallableRequest
    await expect(reviewTemplateApprovalCallable.run(request)).rejects.toThrow('owner または admin')
  })

  it('rejects when the template is not PENDING', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'admin', membershipVersion: 1 })
    templateGetMock.mockResolvedValueOnce({ exists: true, get: (field: string) => ({ orgId: 'org-1', approvalStatus: 'APPROVED' } as Record<string, unknown>)[field] })
    const request = { auth: { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }, data: { orgId: 'org-1', templateId: 'tpl-1', decision: 'APPROVED' } } as unknown as CallableRequest
    await expect(reviewTemplateApprovalCallable.run(request)).rejects.toMatchObject({ code: 'failed-precondition' })
  })

  it('approves a PENDING template and records the reviewer', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    templateGetMock.mockResolvedValueOnce({ exists: true, get: (field: string) => ({ orgId: 'org-1', approvalStatus: 'PENDING' } as Record<string, unknown>)[field] })
    const request = { auth: { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }, data: { orgId: 'org-1', templateId: 'tpl-1', decision: 'APPROVED' } } as unknown as CallableRequest
    await reviewTemplateApprovalCallable.run(request)
    expect(templateUpdateMock).toHaveBeenCalledWith({ approvalStatus: 'APPROVED', reviewedByUid: 'teacher-a', reviewedAt: 'SERVER_TIMESTAMP' })
  })

  it('rejects a PENDING template', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    templateGetMock.mockResolvedValueOnce({ exists: true, get: (field: string) => ({ orgId: 'org-1', approvalStatus: 'PENDING' } as Record<string, unknown>)[field] })
    const request = { auth: { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }, data: { orgId: 'org-1', templateId: 'tpl-1', decision: 'REJECTED' } } as unknown as CallableRequest
    await reviewTemplateApprovalCallable.run(request)
    expect(templateUpdateMock).toHaveBeenCalledWith({ approvalStatus: 'REJECTED', reviewedByUid: 'teacher-a', reviewedAt: 'SERVER_TIMESTAMP' })
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/onCall.test.ts`
Expected: FAIL — `listPendingTemplateApprovalsCallable`/`reviewTemplateApprovalCallable`が`./onCall`からexportされていない

- [ ] **Step 3: 実装する**

`functions/src/lessonTemplates/onCall.ts` のファイル末尾に追加:

```ts

const requireManager = (membership: { role: string }, message: string) => {
  if (membership.role !== 'owner' && membership.role !== 'admin') throw new HttpsError('permission-denied', message)
}

interface ListPendingTemplateApprovalsRequest { orgId?: unknown }

export const listPendingTemplateApprovalsCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as ListPendingTemplateApprovalsRequest
  if (typeof data.orgId !== 'string') throw new HttpsError('invalid-argument', 'orgId は必須です。')
  requireManager(await requireActiveOrgMember(getFirestore(), data.orgId, request.auth.uid), 'owner または admin のみ承認待ち一覧を確認できます。')

  const snapshot = await getFirestore().collection('lessonTemplates').where('orgId', '==', data.orgId).where('approvalStatus', '==', 'PENDING').get()
  return snapshot.docs.map((doc) => {
    const templateData = doc.data() as { title: string; createdByUid: string; updatedAt: unknown }
    return { id: doc.id, title: templateData.title, createdByUid: templateData.createdByUid, updatedAt: templateData.updatedAt }
  })
})

interface ReviewTemplateApprovalRequest { orgId?: unknown; templateId?: unknown; decision?: unknown }
const isValidApprovalDecision = (value: unknown): value is 'APPROVED' | 'REJECTED' => value === 'APPROVED' || value === 'REJECTED'

export const reviewTemplateApprovalCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as ReviewTemplateApprovalRequest
  if (typeof data.orgId !== 'string' || typeof data.templateId !== 'string' || !isValidApprovalDecision(data.decision)) {
    throw new HttpsError('invalid-argument', 'リクエストが不正です。')
  }
  requireManager(await requireActiveOrgMember(getFirestore(), data.orgId, request.auth.uid), 'owner または admin のみ承認・却下できます。')

  const templateRef = getFirestore().doc(`lessonTemplates/${data.templateId}`)
  const templateSnap = await templateRef.get()
  if (!templateSnap.exists) throw new HttpsError('not-found', 'レッスンテンプレートが見つかりません。')
  if (templateSnap.get('orgId') !== data.orgId) throw new HttpsError('failed-precondition', 'このテンプレートは対象組織のものではありません。')
  if (templateSnap.get('approvalStatus') !== 'PENDING') throw new HttpsError('failed-precondition', 'このテンプレートは承認待ちではありません。')

  await templateRef.update({ approvalStatus: data.decision, reviewedByUid: request.auth.uid, reviewedAt: FieldValue.serverTimestamp() })
  return { approvalStatus: data.decision }
})
```

- [ ] **Step 4: `index.ts` にexportを追加する**

`functions/src/index.ts` の該当箇所(`canReviewTemplateCallable, createTemplateShareCallable, duplicateLessonTemplateCallable, grantOperatorCallable,` の行)を以下に置き換える:

```ts
  canReviewTemplateCallable, createTemplateShareCallable, duplicateLessonTemplateCallable, grantOperatorCallable,
  listPendingTemplateApprovalsCallable, listPendingTemplateReportsCallable, listTemplateReviewsCallable,
  publishLessonVersionCallable, publishTemplateToCommunityCallable, reportTemplateCallable, resolveTemplateReportCallable,
  resolveTemplateShareCallable, reviewTemplateApprovalCallable, revokeTemplateShareCallable, submitTemplateReviewCallable,
  unpublishTemplateFromCommunityCallable,
```

- [ ] **Step 5: `firestore.indexes.json` に複合インデックスを追加する**

`firestore.indexes.json`の`lessonTemplates`の既存エントリのいずれかの直後に追加(配列の要素として):

```json
    {
      "collectionGroup": "lessonTemplates",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "orgId", "order": "ASCENDING" },
        { "fieldPath": "approvalStatus", "order": "ASCENDING" }
      ]
    },
```

- [ ] **Step 6: テストを実行してパスを確認する**

Run: `cd functions && npx tsc --noEmit && npx vitest run`
Expected: 全テストPASS、型エラーなし

- [ ] **Step 7: コミット**

```bash
git add functions/src/lessonTemplates/onCall.ts functions/src/lessonTemplates/onCall.test.ts functions/src/index.ts firestore.indexes.json
git commit -m "feat: listPendingTemplateApprovalsCallable/reviewTemplateApprovalCallableを追加する"
```

---

### Task 4: Firestoreルールの回帰テストを追加する

**Files:**
- Test: `test/firestore.rules.test.ts`

**Interfaces:**
- Consumes: 既存の`lessonTemplates`の`update`ルール(`firestore.rules:104-109`、`diff().affectedKeys().hasOnly(['draft', 'updatedAt'])`)。今回のCallableはAdmin SDK経由でルールをバイパスするため、ルール自体は変更しない。
- Produces: `approvalStatus`をクライアントから直接書き換えられないことを保証する回帰テスト。

- [ ] **Step 1: 失敗しない(既存ルールで既にブロックされる)ことを確認するテストを書く**

`test/firestore.rules.test.ts`の266-287行目の`describe('orgId/createdByUid immutability on lessonTemplates', ...)`ブロック内、`it('rejects changing orgId or createdByUid on update', ...)`(281-287行目)の直後に追加:

```ts
  it('rejects a client attempt to set approvalStatus directly', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    const valid = { orgId: 'personal_teacher-a', createdByUid: 'teacher-a', draft: { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES' }, currentPublishedVersionId: null, status: 'DRAFT', visibility: 'PRIVATE' }
    await setDoc(doc(owner, 'lessonTemplates', 'approval-immutable'), valid)
    await assertFails(updateDoc(doc(owner, 'lessonTemplates', 'approval-immutable'), { approvalStatus: 'APPROVED' }))
  })
```

- [ ] **Step 2: テストを実行してパスすることを確認する**

Run: `npm run test:rules`(リポジトリルートの`package.json`に定義済みのスクリプト、`firebase emulators:exec ... vitest --config vite.rules.config.ts run`)
Expected: 全テストPASS(ルール自体は既に`approvalStatus`を許可していないため、追加テストは変更なしでパスする)

- [ ] **Step 3: コミット**

```bash
git add test/firestore.rules.test.ts
git commit -m "test: approvalStatusを直接書き換えられないことを検証する回帰テストを追加する"
```

---

### Task 5: クライアントlib・承認ページ・ルーティング・バッジ表示を実装する

**Files:**
- Create: `src/lib/lessonTemplates/templateApprovals.ts`
- Create: `src/components/teacher/organizations/TemplateApprovalsPage.tsx`
- Create: `src/components/teacher/organizations/TemplateApprovalsPage.test.tsx`
- Modify: `src/lib/lessonTemplates/types.ts:33-45`
- Modify: `src/components/teacher/templates/TemplateListPage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`

**Interfaces:**
- Consumes: Callable `listPendingTemplateApprovalsCallable`/`reviewTemplateApprovalCallable`(Task 3)
- Produces: ルート`/teacher/organizations/:orgId/template-approvals`

- [ ] **Step 1: クライアントlibを書く**

`src/lib/lessonTemplates/templateApprovals.ts` を新規作成:

```ts
import { httpsCallable, type Functions } from 'firebase/functions'

export interface PendingTemplateApproval {
  id: string
  title: string
  createdByUid: string
  updatedAt: unknown
}

export interface ListPendingTemplateApprovalsInput { orgId: string }

export const listPendingTemplateApprovals = async (functions: Functions, input: ListPendingTemplateApprovalsInput): Promise<PendingTemplateApproval[]> =>
  (await httpsCallable<ListPendingTemplateApprovalsInput, PendingTemplateApproval[]>(functions, 'listPendingTemplateApprovalsCallable')(input)).data

export interface ReviewTemplateApprovalInput { orgId: string; templateId: string; decision: 'APPROVED' | 'REJECTED' }

export const reviewTemplateApproval = async (functions: Functions, input: ReviewTemplateApprovalInput): Promise<void> => {
  await httpsCallable<ReviewTemplateApprovalInput, { approvalStatus: string }>(functions, 'reviewTemplateApprovalCallable')(input)
}
```

- [ ] **Step 2: `LessonTemplate`型に`approvalStatus`を追加する**

`src/lib/lessonTemplates/types.ts` の33-45行目の`LessonTemplate`インターフェースに以下を追加(`visibility`フィールドの直後):

```ts
export interface LessonTemplate {
  id: string
  orgId: string
  createdByUid: string
  draft: LessonContent
  currentPublishedVersionId: string | null
  status: 'DRAFT' | 'READY' | 'ARCHIVED'
  visibility: 'PRIVATE' | 'LINK' | 'ORGANIZATION' | 'PUBLIC'
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED'
  createdAt: Timestamp
  updatedAt: Timestamp
  sourceTemplateId?: string
  sourceTemplateTitle?: string
}
```

- [ ] **Step 3: 承認ページの失敗するテストを書く**

`src/components/teacher/organizations/TemplateApprovalsPage.test.tsx` を新規作成:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TemplateApprovalsPage } from './TemplateApprovalsPage'
import type { PendingTemplateApproval } from '../../../lib/lessonTemplates/templateApprovals'

const items: PendingTemplateApproval[] = [{ id: 'tpl-1', title: '株式市場入門', createdByUid: 'teacher-a', updatedAt: null }]

describe('TemplateApprovalsPage', () => {
  it('shows a loading indicator when data is not yet loaded', () => {
    render(<TemplateApprovalsPage data={undefined} error={undefined} onApprove={vi.fn()} onReject={vi.fn()} />)
    expect(screen.getByLabelText('読み込み中')).toBeInTheDocument()
  })

  it('shows an empty message when there is nothing pending', () => {
    render(<TemplateApprovalsPage data={[]} error={undefined} onApprove={vi.fn()} onReject={vi.fn()} />)
    expect(screen.getByText('承認待ちのテンプレートはありません。')).toBeInTheDocument()
  })

  it('lists pending templates and calls onApprove/onReject', async () => {
    const onApprove = vi.fn()
    const onReject = vi.fn()
    render(<TemplateApprovalsPage data={items} error={undefined} onApprove={onApprove} onReject={onReject} />)
    expect(screen.getByText('株式市場入門')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '承認' }))
    expect(onApprove).toHaveBeenCalledWith('tpl-1')
    await userEvent.click(screen.getByRole('button', { name: '却下' }))
    expect(onReject).toHaveBeenCalledWith('tpl-1')
  })
})
```

- [ ] **Step 4: テストを実行して失敗を確認する**

Run: `npx vitest run src/components/teacher/organizations/TemplateApprovalsPage.test.tsx`
Expected: FAIL — `Cannot find module './TemplateApprovalsPage'`

- [ ] **Step 5: 承認ページを実装する**

`src/components/teacher/organizations/TemplateApprovalsPage.tsx` を新規作成:

```tsx
import { Alert, Button, CircularProgress, List, ListItem, ListItemText, Stack, Typography } from '@mui/material'
import type { PendingTemplateApproval } from '../../../lib/lessonTemplates/templateApprovals'

export interface TemplateApprovalsPageProps {
  data: PendingTemplateApproval[] | undefined
  error: string | undefined
  onApprove: (templateId: string) => void
  onReject: (templateId: string) => void
}

export function TemplateApprovalsPage({ data, error, onApprove, onReject }: TemplateApprovalsPageProps) {
  if (error) return <Alert severity="error">読み込みに失敗しました</Alert>
  if (!data) return <CircularProgress aria-label="読み込み中" />
  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography variant="h5">承認待ちテンプレート</Typography>
      {data.length === 0
        ? <Typography color="text.secondary">承認待ちのテンプレートはありません。</Typography>
        : <List>
            {data.map((item) => (
              <ListItem key={item.id} secondaryAction={
                <Stack direction="row" spacing={1}>
                  <Button variant="contained" onClick={() => onApprove(item.id)}>承認</Button>
                  <Button variant="outlined" color="error" onClick={() => onReject(item.id)}>却下</Button>
                </Stack>
              }>
                <ListItemText primary={item.title} secondary={`作成者: ${item.createdByUid}`} />
              </ListItem>
            ))}
          </List>}
    </Stack>
  )
}
```

- [ ] **Step 6: テストを実行してパスを確認する**

Run: `npx vitest run src/components/teacher/organizations/TemplateApprovalsPage.test.tsx`
Expected: 全テストPASS(3件)

- [ ] **Step 7: `App.tsx` にルートを追加する**

`src/App.tsx` の`import { UsageDashboardPage } from './components/teacher/organizations/UsageDashboardPage'`の直後に追加:

```ts
import { TemplateApprovalsPage } from './components/teacher/organizations/TemplateApprovalsPage'
import { listPendingTemplateApprovals, reviewTemplateApproval, type PendingTemplateApproval } from './lib/lessonTemplates/templateApprovals'
```

`function UsageDashboardRoute(...)`の定義の直後に、新しいRouteコンポーネントを追加:

```tsx
function TemplateApprovalsRoute({ services }: { services: FirebaseServices }) {
  const { orgId } = useParams<{ orgId: string }>()
  const [data, setData] = useState<PendingTemplateApproval[]>()
  const [error, setError] = useState<string>()
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let cancelled = false
    if (!orgId) return
    setError(undefined)
    listPendingTemplateApprovals(services.functions, { orgId })
      .then((result) => { if (!cancelled) setData(result) })
      .catch(() => { if (!cancelled) setError('failed') })
    return () => { cancelled = true }
  }, [services, orgId, reload])
  if (!orgId) return null
  const decide = (templateId: string, decision: 'APPROVED' | 'REJECTED') => {
    void reviewTemplateApproval(services.functions, { orgId, templateId, decision }).then(() => setReload((n) => n + 1))
  }
  return <TemplateApprovalsPage data={data} error={error} onApprove={(id) => decide(id, 'APPROVED')} onReject={(id) => decide(id, 'REJECTED')} />
}

```

`/teacher/organizations/:orgId/usage-dashboard`のRouteエントリの直後に追加:

```tsx
  <Route path="/teacher/organizations/:orgId/template-approvals" element={enabled && services ? <TemplateRouteGuard services={services}><TemplateApprovalsRoute services={services} /></TemplateRouteGuard> : <Navigate replace to="/about" />} />
```

- [ ] **Step 8: `SchoolOrgSettingsPage.tsx` にowner/admin限定リンクを追加する**

`src/components/teacher/organizations/SchoolOrgSettingsPage.tsx` の`<Link to={`/teacher/organizations/${orgId}/usage-dashboard`}>利用状況ダッシュボードを見る</Link>`の直後に追加:

```tsx
      {(viewerRole === 'owner' || viewerRole === 'admin') && <Link to={`/teacher/organizations/${orgId}/template-approvals`}>承認待ちテンプレートを確認</Link>}
```

`SchoolOrgSettingsPage.test.tsx`に以下の2つのテストを追加(`memberProps`を使う既存テストの近く):

```tsx
  it('shows the approvals link to an owner', () => {
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false} {...memberProps} viewerUid="uid-owner" members={members} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: '承認待ちテンプレートを確認' })).toHaveAttribute('href', '/teacher/organizations/org-1/template-approvals')
  })

  it('hides the approvals link from a teacher', () => {
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false} {...memberProps} viewerUid="uid-teacher" members={members} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('link', { name: '承認待ちテンプレートを確認' })).not.toBeInTheDocument()
  })
```

このファイル冒頭で定義済みの`members`(`uid-owner`/`uid-teacher`の2件、`email`/`membershipVersion`込みの`OrgMember`型)と`memberProps`(`members: []`をデフォルトで含む)をそのまま使う。上記2テストでは`members={members}`で明示的に上書きする。

- [ ] **Step 9: `TemplateListPage.tsx` に承認状態バッジを追加する**

`src/components/teacher/templates/TemplateListPage.tsx` の`secondary={template.status}`を以下に置き換える:

```tsx
secondary={`${template.status}${template.approvalStatus === 'PENDING' ? ' ・承認待ち' : template.approvalStatus === 'REJECTED' ? ' ・却下' : ''}`}
```

`src/components/teacher/templates/TemplateListPage.test.tsx`は現状`describe('TemplateListPage', () => it('opens existing templates and creates new ones', () => { ... }))`という単一テストの1行構成になっている。これを以下のファイル全体で置き換える(2件目のテストを追加するため`describe`をブロック形式に展開する):

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TemplateListPage } from './TemplateListPage'

describe('TemplateListPage', () => {
  it('opens existing templates and creates new ones', () => {
    const open = vi.fn(), create = vi.fn()
    render(<TemplateListPage loading={false} templates={[{ id: 'a', draft: { title: '既存教材' } } as never]} onOpen={open} onCreateNew={create} />)
    fireEvent.click(screen.getByText('既存教材'))
    fireEvent.click(screen.getByRole('button', { name: '新規作成' }))
    expect(open).toHaveBeenCalledWith('a')
    expect(create).toHaveBeenCalled()
  })

  it('shows a pending-approval badge when approvalStatus is PENDING', () => {
    render(<TemplateListPage loading={false} templates={[{ id: 'a', draft: { title: '既存教材' }, status: 'READY', approvalStatus: 'PENDING' } as never]} onOpen={vi.fn()} onCreateNew={vi.fn()} />)
    expect(screen.getByText(/・承認待ち/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 10: フロントエンド全体の型チェックとテストを実行する**

Run: `npx tsc -b && npx tsc -p tsconfig.rules.json && npx vitest run`
Expected: 全テストPASS、型エラーなし

- [ ] **Step 11: コミット**

```bash
git add src/lib/lessonTemplates/templateApprovals.ts src/lib/lessonTemplates/types.ts src/components/teacher/organizations/TemplateApprovalsPage.tsx src/components/teacher/organizations/TemplateApprovalsPage.test.tsx src/components/teacher/templates/TemplateListPage.tsx src/components/teacher/templates/TemplateListPage.test.tsx src/App.tsx src/components/teacher/organizations/SchoolOrgSettingsPage.tsx src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx
git commit -m "feat: 組織内教材承認フローのUIとルーティングを追加する"
```
