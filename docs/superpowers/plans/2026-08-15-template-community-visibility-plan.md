# 公開範囲の拡張(COMMUNITY公開) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** テンプレート作成者が公開版テンプレートを`COMMUNITY`公開でき、組織を越えて他の教師が閲覧・複製できるようにする。

**Architecture:** `visibility`フィールドに`'COMMUNITY'`を追加し、2つの新規Callable(`publishTemplateToCommunityCallable`/`unpublishTemplateFromCommunityCallable`)で作成者本人のみが切り替えられるようにする。既存の`duplicateLessonTemplateCallable`の認可分岐(共有リンクv2で追加済みの`shareToken`分岐と並列)に`visibility === 'COMMUNITY'`条件を追加する。Firestoreルールを`planDefinitions`と同じ「広く読み取り可・書き込みはCallable限定」パターンで緩和する。

**Tech Stack:** Firebase Cloud Functions (TypeScript, `firebase-admin/firestore`)、Vitest、Firestore Rules (emulator)。

## Global Constraints

- 正本: `docs/superpowers/specs/2026-08-15-template-community-visibility-design.md`。矛盾があれば正本を優先する。
- 追加する`visibility`の値は`'COMMUNITY'`のみ(`VERIFIED`/`OFFICIAL`は対象外)。
- 公開・非公開操作はテンプレートの`createdByUid`本人のみ。
- `currentPublishedVersionId`が`null`のテンプレートは公開不可(`failed-precondition`)。
- コミュニティ公開でも、公開中の版(`currentPublishedVersionId`)以外(下書き・過去版)は非メンバーに読み取りを許可しない。
- 組織側の「外部派生禁止」トグルは対象外(全組織が公開可能)。

---

### Task 1: 公開・非公開Callableを追加する

**Files:**
- Modify: `functions/src/lessonTemplates/onCall.ts`
- Modify: `functions/src/index.ts`
- Test: `functions/src/lessonTemplates/onCall.test.ts`

**Interfaces:**
- Produces: `publishTemplateToCommunityCallable`/`unpublishTemplateFromCommunityCallable`(Task 3のFirestoreルールが読み取り判定に使う`visibility`フィールドをこれらが更新する)

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonTemplates/onCall.test.ts`の`import`に追記する。

```ts
import { publishTemplateToCommunityCallable, unpublishTemplateFromCommunityCallable } from './onCall'
```

このコードベースのAdmin SDK更新は`db.doc(path).update({...})`直呼び出しが規約(`functions/src/organizations/invitations.ts:410`等)。既存の共有モック`const templateGetMock = vi.fn()`の直後に、更新呼び出し用のモックを追加する。

```ts
const templateUpdateMock = vi.fn()
```

既存の`vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ doc: () => ({ get: templateGetMock }) }) }))`を以下に置き換える(`update`を追加するだけで、他の`describe`ブロックの挙動は変わらない)。

```ts
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ doc: () => ({ get: templateGetMock, update: templateUpdateMock }) }),
}))
```

ファイル末尾(`describe('revokeTemplateShareCallable', ...)`ブロックの後)に追記する。

```ts
describe('publishTemplateToCommunityCallable', () => {
  const auth = { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }
  const makeRequest = (data: Record<string, unknown>) => ({ auth, data, rawRequest: {} } as unknown as CallableRequest)

  beforeEach(() => { vi.clearAllMocks(); templateUpdateMock.mockResolvedValue(undefined) })

  it('rejects a caller who is not the template author', async () => {
    templateGetMock.mockResolvedValue({
      exists: true,
      get: (field: string) => (field === 'createdByUid' ? 'someone-else' : field === 'currentPublishedVersionId' ? 'v1' : undefined),
    })
    await expect(publishTemplateToCommunityCallable.run(makeRequest({ templateId: 't1' }))).rejects.toMatchObject({ code: 'permission-denied' })
    expect(templateUpdateMock).not.toHaveBeenCalled()
  })

  it('rejects a template with no published version', async () => {
    templateGetMock.mockResolvedValue({
      exists: true,
      get: (field: string) => (field === 'createdByUid' ? 'teacher-a' : field === 'currentPublishedVersionId' ? null : undefined),
    })
    await expect(publishTemplateToCommunityCallable.run(makeRequest({ templateId: 't1' }))).rejects.toMatchObject({ code: 'failed-precondition' })
    expect(templateUpdateMock).not.toHaveBeenCalled()
  })

  it('publishes for the template author when a published version exists', async () => {
    templateGetMock.mockResolvedValue({
      exists: true,
      get: (field: string) => (field === 'createdByUid' ? 'teacher-a' : field === 'currentPublishedVersionId' ? 'v1' : undefined),
    })
    await expect(publishTemplateToCommunityCallable.run(makeRequest({ templateId: 't1' }))).resolves.toEqual({ published: true })
    expect(templateUpdateMock).toHaveBeenCalledWith({ visibility: 'COMMUNITY' })
  })
})

describe('unpublishTemplateFromCommunityCallable', () => {
  const auth = { uid: 'teacher-a', token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } } }
  const makeRequest = (data: Record<string, unknown>) => ({ auth, data, rawRequest: {} } as unknown as CallableRequest)

  beforeEach(() => { vi.clearAllMocks(); templateUpdateMock.mockResolvedValue(undefined) })

  it('rejects a caller who is not the template author', async () => {
    templateGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'createdByUid' ? 'someone-else' : undefined) })
    await expect(unpublishTemplateFromCommunityCallable.run(makeRequest({ templateId: 't1' }))).rejects.toMatchObject({ code: 'permission-denied' })
    expect(templateUpdateMock).not.toHaveBeenCalled()
  })

  it('unpublishes for the template author', async () => {
    templateGetMock.mockResolvedValue({ exists: true, get: (field: string) => (field === 'createdByUid' ? 'teacher-a' : undefined) })
    await expect(unpublishTemplateFromCommunityCallable.run(makeRequest({ templateId: 't1' }))).resolves.toEqual({ published: false })
    expect(templateUpdateMock).toHaveBeenCalledWith({ visibility: 'PRIVATE' })
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/onCall.test.ts`
Expected: FAIL(`publishTemplateToCommunityCallable`/`unpublishTemplateFromCommunityCallable`が存在しない)。

- [ ] **Step 3: `onCall.ts`にCallableを追加する**

ファイル末尾に追記する。

```ts
interface CommunityVisibilityCallableInput { templateId?: unknown }
const isValidTemplateIdInput = (data: unknown): data is { templateId: string } =>
  typeof data === 'object' && data !== null && typeof (data as CommunityVisibilityCallableInput).templateId === 'string'

export const publishTemplateToCommunityCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  if (!isValidTemplateIdInput(request.data)) throw new HttpsError('invalid-argument', 'リクエストが不正です。')

  const templateSnap = await getFirestore().doc(`lessonTemplates/${request.data.templateId}`).get()
  if (!templateSnap.exists) throw new HttpsError('not-found', 'レッスンテンプレートが見つかりません。')
  if (templateSnap.get('createdByUid') !== request.auth.uid) throw new HttpsError('permission-denied', 'このテンプレートの作成者のみ公開できます。')
  if (!templateSnap.get('currentPublishedVersionId')) throw new HttpsError('failed-precondition', '公開済みの版がまだありません。')

  await getFirestore().doc(`lessonTemplates/${request.data.templateId}`).update({ visibility: 'COMMUNITY' })
  return { published: true }
})

export const unpublishTemplateFromCommunityCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  if (!isValidTemplateIdInput(request.data)) throw new HttpsError('invalid-argument', 'リクエストが不正です。')

  const templateSnap = await getFirestore().doc(`lessonTemplates/${request.data.templateId}`).get()
  if (!templateSnap.exists) throw new HttpsError('not-found', 'レッスンテンプレートが見つかりません。')
  if (templateSnap.get('createdByUid') !== request.auth.uid) throw new HttpsError('permission-denied', 'このテンプレートの作成者のみ非公開にできます。')

  await getFirestore().doc(`lessonTemplates/${request.data.templateId}`).update({ visibility: 'PRIVATE' })
  return { published: false }
})
```

- [ ] **Step 4: `functions/src/index.ts`にエクスポートを追加する**

既存の以下のブロックを:

```ts
export {
  createTemplateShareCallable, duplicateLessonTemplateCallable, publishLessonVersionCallable,
  resolveTemplateShareCallable, revokeTemplateShareCallable,
} from './lessonTemplates/onCall'
```

以下に置き換える。

```ts
export {
  createTemplateShareCallable, duplicateLessonTemplateCallable, publishLessonVersionCallable,
  publishTemplateToCommunityCallable, resolveTemplateShareCallable, revokeTemplateShareCallable,
  unpublishTemplateFromCommunityCallable,
} from './lessonTemplates/onCall'
```

- [ ] **Step 5: テストを実行して成功を確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/onCall.test.ts`
Expected: 全件PASS。

- [ ] **Step 6: 型チェックを実行する**

Run: `cd functions && npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 7: コミット**

```bash
git add functions/src/lessonTemplates/onCall.ts functions/src/lessonTemplates/onCall.test.ts functions/src/index.ts
git commit -m "feat: テンプレートのコミュニティ公開・非公開Callableを追加する"
```

---

### Task 2: `duplicateLessonTemplateCallable`にCOMMUNITY分岐を追加する

**Files:**
- Modify: `functions/src/lessonTemplates/onCall.ts`
- Test: `functions/src/lessonTemplates/onCall.test.ts`

**Interfaces:**
- Consumes: Task 1が更新する`lessonTemplates.visibility`フィールド
- Produces: 変更なし(`duplicateLessonTemplateCallable`のシグネチャは維持)

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonTemplates/onCall.test.ts`の`describe('duplicateLessonTemplateCallable', ...)`ブロック内、既存の`shareToken`関連テスト(Task 4で追加済みの3件)の直後に追記する。

```ts
  it('skips source-org membership and duplicates when the source template is COMMUNITY-visible', async () => {
    templateGetMock.mockResolvedValue({
      exists: true,
      get: (field: string) => (field === 'orgId' ? 'org-source' : field === 'visibility' ? 'COMMUNITY' : undefined),
    })
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 }) // target org only
    vi.mocked(duplicateLessonTemplateWithAdminSdk).mockResolvedValue({ templateId: 'template-copy-1', alreadyDuplicated: false })

    await expect(duplicateLessonTemplateCallable.run(makeRequest())).resolves.toEqual({ templateId: 'template-copy-1', alreadyDuplicated: false })

    expect(requireActiveOrgMember).toHaveBeenCalledTimes(1)
    expect(requireActiveOrgMember).toHaveBeenCalledWith(expect.anything(), 'org-target', 'teacher-target')
  })

  it('still requires source-org membership when the source template is PRIVATE and no shareToken is given', async () => {
    templateGetMock.mockResolvedValue({
      exists: true,
      get: (field: string) => (field === 'orgId' ? 'org-source' : field === 'visibility' ? 'PRIVATE' : undefined),
    })
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'teacher', membershipVersion: 1 })
    vi.mocked(duplicateLessonTemplateWithAdminSdk).mockResolvedValue({ templateId: 'template-copy-1', alreadyDuplicated: false })

    await expect(duplicateLessonTemplateCallable.run(makeRequest())).resolves.toEqual({ templateId: 'template-copy-1', alreadyDuplicated: false })

    expect(requireActiveOrgMember).toHaveBeenCalledTimes(2)
    expect(requireActiveOrgMember).toHaveBeenNthCalledWith(1, expect.anything(), 'org-source', 'teacher-target')
  })
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `cd functions && npx vitest run src/lessonTemplates/onCall.test.ts`
Expected: FAIL(現行実装は`visibility`を見ておらず、常に`shareToken`の有無だけで分岐する)。

- [ ] **Step 3: `onCall.ts`を修正する**

`duplicateLessonTemplateCallable`内の以下の箇所を:

```ts
  if (request.data.shareToken) {
    let share
    try {
      share = await resolveTemplateShareWithAdminSdk({ token: request.data.shareToken })
    } catch {
      throw new HttpsError('not-found', '共有リンクが無効です。')
    }
    if (share.templateId !== request.data.sourceTemplateId || share.versionId !== request.data.sourceVersionId) {
      throw new HttpsError('permission-denied', '共有リンクの対象と一致しません。')
    }
    // A valid, matching share token substitutes for source-org membership —
    // this is the one intentional way to read/duplicate another org's
    // template, mirroring the comment below for target-org membership.
  } else {
    // Mirrors firestore.rules' `allow get`/`allow list` gate on lessonTemplates
    // (activeMember(resource.data.orgId)): this Callable runs on the Admin SDK
    // and bypasses Rules, so it must re-enforce the same "must belong to the
    // source template's org to read it" boundary itself, or duplication would
    // become a way to exfiltrate another org's lesson content.
    await requireActiveOrgMember(firestore, sourceOrgId, request.auth.uid)
  }
```

以下に置き換える。

```ts
  if (request.data.shareToken) {
    let share
    try {
      share = await resolveTemplateShareWithAdminSdk({ token: request.data.shareToken })
    } catch {
      throw new HttpsError('not-found', '共有リンクが無効です。')
    }
    if (share.templateId !== request.data.sourceTemplateId || share.versionId !== request.data.sourceVersionId) {
      throw new HttpsError('permission-denied', '共有リンクの対象と一致しません。')
    }
    // A valid, matching share token substitutes for source-org membership —
    // this is the one intentional way to read/duplicate another org's
    // template, mirroring the comment below for target-org membership.
  } else if (sourceTemplateSnap.get('visibility') === 'COMMUNITY') {
    // A COMMUNITY-visible template is readable by any teacher (mirrors the
    // Firestore rule relaxation), so source-org membership is not required
    // either — the same intentional bypass as the shareToken branch above.
  } else {
    // Mirrors firestore.rules' `allow get`/`allow list` gate on lessonTemplates
    // (activeMember(resource.data.orgId)): this Callable runs on the Admin SDK
    // and bypasses Rules, so it must re-enforce the same "must belong to the
    // source template's org to read it" boundary itself, or duplication would
    // become a way to exfiltrate another org's lesson content.
    await requireActiveOrgMember(firestore, sourceOrgId, request.auth.uid)
  }
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
git commit -m "feat: duplicateLessonTemplateCallableでCOMMUNITY公開テンプレートの組織外複製を許可する"
```

---

### Task 3: Firestoreルールを緩和する

**Files:**
- Modify: `firestore.rules`
- Modify: `test/firestore.rules.test.ts`

**Interfaces:**
- Consumes: Task 1が更新する`lessonTemplates.visibility`フィールド
- Produces: `lessonTemplates`・`lessonTemplates/{templateId}/versions/{versionId}`の緩和された読み取りルール

- [ ] **Step 1: 失敗するテストを書く**

`test/firestore.rules.test.ts`の`describe('templateShares/{shareId}', ...)`ブロックの直後に追記する(ファイル内の既存`environment`/`teacherToken`/`doc`/`setDoc`/`getDoc`/`assertSucceeds`/`assertFails`を利用する)。

```ts
describe('lessonTemplates COMMUNITY visibility', () => {
  beforeEach(async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const firestore = context.firestore()
      await setDoc(doc(firestore, 'organizations/personal_teacher-a/members/teacher-a'), { role: 'owner', status: 'active', membershipVersion: 1 })
      await setDoc(doc(firestore, 'lessonTemplates/community-template'), {
        orgId: 'personal_teacher-a', createdByUid: 'teacher-a', currentPublishedVersionId: 'v-current',
        visibility: 'COMMUNITY', status: 'PUBLISHED', draft: {}, createdAt: 'now', updatedAt: 'now',
      })
      await setDoc(doc(firestore, 'lessonTemplates/private-template'), {
        orgId: 'personal_teacher-a', createdByUid: 'teacher-a', currentPublishedVersionId: 'v-current',
        visibility: 'PRIVATE', status: 'PUBLISHED', draft: {}, createdAt: 'now', updatedAt: 'now',
      })
      await setDoc(doc(firestore, 'lessonTemplates/community-template/versions/v-current'), { templateId: 'community-template', orgId: 'personal_teacher-a', content: {} })
      await setDoc(doc(firestore, 'lessonTemplates/community-template/versions/v-old'), { templateId: 'community-template', orgId: 'personal_teacher-a', content: {} })
    })
  })

  it('lets a non-member teacher read a COMMUNITY template but not a PRIVATE one', async () => {
    const outsider = environment.authenticatedContext('teacher-b', teacherToken).firestore()
    await assertSucceeds(getDoc(doc(outsider, 'lessonTemplates/community-template')))
    await assertFails(getDoc(doc(outsider, 'lessonTemplates/private-template')))
  })

  it('lets a non-member teacher read only the currently published version of a COMMUNITY template', async () => {
    const outsider = environment.authenticatedContext('teacher-b', teacherToken).firestore()
    await assertSucceeds(getDoc(doc(outsider, 'lessonTemplates/community-template/versions/v-current')))
    await assertFails(getDoc(doc(outsider, 'lessonTemplates/community-template/versions/v-old')))
  })
})
```

- [ ] **Step 2: ルールテストを実行して失敗を確認する**

Run: `npx firebase emulators:exec --project demo-stock-league-classroom --only firestore,database,storage "npx vitest --config vite.rules.config.ts run test/firestore.rules.test.ts"`
Expected: FAIL(現行ルールは`visibility`を見ておらず、`COMMUNITY`テンプレートも非メンバーには読めない)。

- [ ] **Step 3: `firestore.rules`を修正する**

`firestore.rules:91-93`の以下を:

```
    match /lessonTemplates/{templateId} {
      allow get: if teacher() && activeMember(resource.data.orgId);
      allow list: if teacher() && activeMember(resource.data.orgId);
```

以下に置き換える。

```
    match /lessonTemplates/{templateId} {
      allow get: if teacher() && (activeMember(resource.data.orgId) || resource.data.visibility == 'COMMUNITY');
      allow list: if teacher() && (activeMember(resource.data.orgId) || resource.data.visibility == 'COMMUNITY');
```

`firestore.rules:110-112`の以下を:

```
      match /versions/{versionId} {
        allow get, list: if teacher()
          && activeMember(get(/databases/$(database)/documents/lessonTemplates/$(templateId)).data.orgId);
```

以下に置き換える。

```
      match /versions/{versionId} {
        allow get, list: if teacher()
          && (
            activeMember(get(/databases/$(database)/documents/lessonTemplates/$(templateId)).data.orgId)
            || (
              get(/databases/$(database)/documents/lessonTemplates/$(templateId)).data.visibility == 'COMMUNITY'
              && versionId == get(/databases/$(database)/documents/lessonTemplates/$(templateId)).data.currentPublishedVersionId
            )
          );
```

- [ ] **Step 4: ルールテストを実行して成功を確認する**

Run: `npx firebase emulators:exec --project demo-stock-league-classroom --only firestore,database,storage "npx vitest --config vite.rules.config.ts run test/firestore.rules.test.ts"`
Expected: 全件PASS。

- [ ] **Step 5: コミット**

```bash
git add firestore.rules test/firestore.rules.test.ts
git commit -m "feat: COMMUNITY公開テンプレートのFirestore読み取りルールを緩和する"
```
