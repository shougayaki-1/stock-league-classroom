# 管理者向け生徒データ検索 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学校組織の `owner` / `admin` が、閲覧理由を入力したうえで組織内の生徒参加者データを検索・閲覧できるようにする。`owner` は組織全体、`admin` は自分が `lessonRuns.teacherRoles` に含まれる授業だけを対象とし、検索結果は時間制限付き・監査記録付きで提供する。

**Architecture:** 既存 `exportOrgStudentData.ts` と同じ「純粋ロジック + Admin SDK wiring」パターンを使い、`searchOrgStudentData.ts` を追加する。Callable は認証・入力検証後、まず `requireActiveOrgMember` で `owner/admin` を確定し、それより前には `lessonRuns` や `participants` を一切読まない。認可済みの `owner` は対象組織の lessonRun 全体、`admin` は各 run の既存 `teacherRoles[actorUid]` が存在する run のみに検索範囲を狭め、その後で初めて各 run の `participants` を完全一致検索する。結果返却前に単一の監査ログを書き、監査ログ書き込み失敗時は検索結果を返さない。クライアントは結果を永続化せず、10分経過・組織変更・明示的な閉じる操作で破棄する。

**Tech Stack:** TypeScript, Firebase Cloud Functions v2 Callable, Firestore Admin SDK, React 19, Vite, Vitest, Testing Library, MUI.

## Global Constraints

- Callable region は既存 privacy Callable と同じ `asia-northeast1` とする。
- **認可を対象データ読み取りより必ず先に完了させる。** `requireActiveOrgMember(db, orgId, actorUid)` と role 判定より前に `lessonRuns` / `participants` を読んではならない。未認可利用者が「該当生徒あり/なし」「授業あり/なし」をエラー差分から推測できる実装は禁止する。
- 対象 role は `owner` と `admin` のみ。今回の backlog 項目は「管理者向け」なので、統合仕様 §21.5 にある「教師は自分の授業」の一般教師向け個票UIはスコープ外とする。
- `owner`: `orgId` が一致する全 lessonRun を責任範囲とする。
- `admin`: `orgId` が一致し、かつ `lessonRun.teacherRoles[actorUid]` が既存の `PRIMARY | ASSISTANT | VIEWER` のいずれかである lessonRun のみを責任範囲とする。新規の `responsibilityScope` 等のフィールドは追加しない。
- admin のスコープ判定は `lessonRuns` メタデータから先に行い、認可済み run の `participants` 以外を読まない。
- 検索対象フィールドは既存 participant の `displayName` と `externalIdentifier` の**完全一致**のみとする。部分一致・前方一致・全文検索・Algolia等の外部検索基盤・新規グローバル生徒インデックスはスコープ外。
- `authUid` は検索キーとしてUIに公開しない。ただし返却される個票の安定した本人識別子として既存値を返してよい。
- 検索結果は `participants` の個票に限定する。`teamAccounts` / `orders` / `households` / `decisions` は複数生徒で共有され得るため、このタスクで「個人データ」と推測して紐付けない。既存一括エクスポートがこれらを組織単位で扱うこととは分離する。
- 1回の検索結果は最大50件。上限到達時は `truncated: true` を返す。
- `reason` は trim 後1文字以上、500文字以下。空理由では Firestore を読まない。
- §21.5 の「時間制限」には統合仕様上具体的な分数が定義されていないため、この計画では privacy コードですでに採用されている10分のセキュリティ境界に揃え、検索結果に `expiresAt` を付与して10分でUIから破棄する。これは**再認証要件ではない**。個票閲覧に `isReauthFresh` を追加しない。
- 検索結果を `localStorage`、`sessionStorage`、URL query、Firestore 等へクライアント側で保存しない。
- 結果返却前に `organizations/{orgId}/auditLog` へ `SEARCH_ORG_STUDENT_DATA` を1件追記する。既存監査ログは append-only の組織サブコレクション方式なのでこれを再利用する。
- 監査ログには検索文字列、displayName、externalIdentifier を複製しない。`reason`、`field`、`matchCount`、対象の `{ lessonRunId, participantId }` のみを記録する。
- participant が後から削除されても監査ログは `participants` 配下ではなく `organizations/{orgId}/auditLog` に残る。**削除対象自身の配下へ監査ログを書かない。**
- 読み取り機能そのものは冪等とする。同一検索を再実行してデータ構造を壊してはならない。ただし監査ログは「実際の閲覧1回につき1件」が正しいため、同じ検索の再実行でも新しい監査記録を作る。監査ログを idempotency key でdedupeしない。
- 検索成功後の監査ログ書き込みに失敗した場合は検索結果をクライアントへ返さない。これにより「個票を開示したが監査証跡がない」状態を作らない。
- 年度アーカイブ、`ARCHIVED` 状態追加、scheduled function、年度切替、保持期限、削除処理はこの計画では一切変更しない。
- `exportOrgStudentDataCallable` の権限、fresh reauth 条件、一括エクスポート内容は変更しない。
- 過度な共通化を行わない。privacy Callable 全体のリファクタ、汎用検索フレームワーク、repository abstraction の追加は禁止する。
- 既存コードの日本語エラーメッセージ、密なCallable wiring、ファイル配置に合わせる。現在の一括エクスポートも `requireActiveOrgMember` 後に owner 判定しているため、このパターンを維持する。

---

### Task 1: 認可済み授業だけを検索する純粋ロジックを追加する

**Files:**
- Create: `functions/src/privacy/searchOrgStudentData.ts`
- Create: `functions/src/privacy/searchOrgStudentData.test.ts`

**Interfaces:**

- Consumes:
  - 既存 `lessonRuns.teacherRoles`
  - 既存 participant fields: `id`, `lessonRunId`, `orgId`, `authUid`, `identityMode`, `displayName`, `externalIdentifier`, `teamId`, `status`
- Produces:
  - `export type OrgStudentSearchField = 'displayName' | 'externalIdentifier'`
  - `export interface OrgStudentSearchMatch`
  - `export interface OrgStudentDataSearchResult`
  - `export interface SearchOrgStudentDataDeps`
  - `export const searchOrgStudentData = async (deps: SearchOrgStudentDataDeps): Promise<OrgStudentDataSearchResult>`
  - `export const searchOrgStudentDataWithAdminSdk = (...) => Promise<OrgStudentDataSearchResult>`

`SearchOrgStudentDataDeps` は少なくとも以下の契約に固定する:

- `orgId: string`
- `actorUid: string`
- `actorRole: 'owner' | 'admin'`
- `field: OrgStudentSearchField`
- `query: string`
- `listLessonRuns(): Promise<Array<Record<string, unknown>>>`
- `findParticipants(lessonRunId, field, query): Promise<Array<Record<string, unknown>>>`
- `now?: () => Date`

`OrgStudentDataSearchResult`:

- `expiresAt: string`
- `truncated: boolean`
- `matches: OrgStudentSearchMatch[]`

`OrgStudentSearchMatch` は既存 participant から `lessonRunId`, `participantId`, `authUid`, `identityMode`, `displayName`, `externalIdentifier?`, `teamId?`, `status` のみ返す。

- [ ] **Step 1: 失敗する純粋ロジックテストを書く。**

`searchOrgStudentData.test.ts` に最低限以下を固定する。

1. owner は org の全 lessonRun を検索する。
2. admin は `teacherRoles[actorUid]` が存在する run だけを `findParticipants` に渡す。
3. admin の担当外 run については `findParticipants` 自体が一度も呼ばれない。
4. `displayName` を指定した場合は `displayName` 完全一致検索として deps に渡る。
5. `externalIdentifier` も同様。
6. 50件で結果を打ち切り `truncated: true`。
7. 50件未満なら `truncated: false`。
8. `expiresAt` が `now + 10分`。
9. 生の lessonRun ドキュメントや不要な participant フィールドを返さない。

- [ ] **Step 2: テストが実際に失敗することを確認する。**

```bash
npm test --workspace=functions -- src/privacy/searchOrgStudentData.test.ts
```

期待結果: module not found または未実装 assertion failure。テストが最初からPASSする場合はテスト条件を見直す。

- [ ] **Step 3: `searchOrgStudentData.ts` の最小実装を書く。**

Admin SDK wiring は次の順序を守る。

1. `lessonRuns.where('orgId', '==', orgId)` で run のメタデータのみ取得。
2. owner は全runを対象にする。
3. admin は `teacherRoles?.[actorUid]` が存在するrunのみに絞る。
4. 認可済みrunごとに `lessonRuns/{runId}/participants` の `where(field, '==', query)` を実行。
5. 返却フィールドを allow-list で組み立てる。
6. 最大50件で切る。
7. `expiresAt` を10分後に設定。

Firestore query の結果をそのまま spread してクライアントへ返さない。

- [ ] **Step 4: Task 1テストを再実行してPASSを確認する。**

```bash
npm test --workspace=functions -- src/privacy/searchOrgStudentData.test.ts
npm run typecheck --workspace=functions
```

- [ ] **Step 5: Task 1だけをコミットする。**

```bash
git add functions/src/privacy/searchOrgStudentData.ts functions/src/privacy/searchOrgStudentData.test.ts
git commit -m "feat: add scoped organization student search"
```

---

### Task 2: Callable の認可順序・理由・監査ログを実装する

**Files:**
- Modify: `functions/src/privacy/onCall.ts`
- Modify: `functions/src/privacy/onCall.test.ts`
- Modify: `functions/src/index.ts`
- Test: `functions/src/privacy/onCall.test.ts`

**Interfaces:**

- Consumes:
  - `requireActiveOrgMember(db, orgId, actorUid)`
  - Task 1 `searchOrgStudentDataWithAdminSdk`
  - 既存 `recordAuditLogEntry`
- Produces:
  - `export const searchOrgStudentDataCallable`
  - Callable request:
    - `orgId: string`
    - `field: 'displayName' | 'externalIdentifier'`
    - `query: string`
    - `reason: string`
  - Callable response: `OrgStudentDataSearchResult`

- [ ] **Step 1: `onCall.test.ts` に認可順序を固定する失敗テストを書く。**

最低限以下を追加する。

1. 未認証なら `unauthenticated` で、`requireActiveOrgMember` も検索serviceも呼ばれない。
2. 教師アカウントでなければ `permission-denied` で、Firestore検索なし。
3. 不正な `orgId / field / query / reason` は `invalid-argument` で、組織・生徒データを読まない。
4. `requireActiveOrgMember` が失敗したら検索serviceを呼ばない。
5. active `teacher` role は `permission-denied` で検索serviceを呼ばない。
6. owner は `actorRole: 'owner'` で service へ渡る。
7. admin は `actorRole: 'admin'` で service へ渡る。
8. **`requireActiveOrgMember` が完了した後にのみ検索serviceが呼ばれることを invocation order で検証する。**
9. 検索文字列を監査ログへ保存しない。
10. 成功時、`SEARCH_ORG_STUDENT_DATA`、`reason`、`field`、`matchCount`、`lessonRunId/participantId` が監査される。
11. 監査ログ書き込みが reject した場合、Callable 自体も reject し、検索結果を返さない。
12. fresh reauth を要求していないことを確認する。古い `auth_time` でも、通常の認証・role条件を満たせばこのCallableは利用可能。

- [ ] **Step 2: 追加テストが失敗することを確認する。**

```bash
npm test --workspace=functions -- src/privacy/onCall.test.ts
```

- [ ] **Step 3: `searchOrgStudentDataCallable` を最小実装する。**

処理順序は固定する。

1. `request.auth` 確認。
2. `isCallerTeacher(request.auth.token)` 確認。
3. request shape と `reason` の構文検証。
4. `getFirestore()`。
5. `requireActiveOrgMember(db, orgId, actorUid)`。
6. membership role が owner/admin でなければ拒否。
7. `searchOrgStudentDataWithAdminSdk(...)`。
8. `recordAuditLogEntry(...)`。
9. 監査成功後のみ result を return。

ここで `searchOrgStudentDataWithAdminSdk` より前に participant、lessonRun、組織属性等を追加で読まない。

role不許可エラーは既存文言に合わせて `組織のowner・adminのみ生徒データを検索できます。` とする。

- [ ] **Step 4: `functions/src/index.ts` から Callable をexportする。**

既存 privacy export block に `searchOrgStudentDataCallable` を追加するだけとし、別export blockを増やさない。

- [ ] **Step 5: Functions のテスト・型チェックを通す。**

```bash
npm test --workspace=functions -- src/privacy/searchOrgStudentData.test.ts src/privacy/onCall.test.ts
npm run typecheck --workspace=functions
```

- [ ] **Step 6: Task 2だけをコミットする。**

```bash
git add functions/src/privacy/onCall.ts functions/src/privacy/onCall.test.ts functions/src/index.ts
git commit -m "feat: expose audited organization student search"
```

---

### Task 3: React 側の Callable client を追加する

**Files:**
- Create: `src/lib/privacy/orgStudentDataSearch.ts`
- Create: `src/lib/privacy/orgStudentDataSearch.test.ts`

**Interfaces:**

- Consumes:
  - Firebase `Functions`
  - Cloud Function `searchOrgStudentDataCallable`
- Produces:
  - `export type OrgStudentSearchField = 'displayName' | 'externalIdentifier'`
  - `export interface SearchOrgStudentDataInput`
  - `export interface OrgStudentSearchMatch`
  - `export interface OrgStudentDataSearchResult`
  - `export const searchOrgStudentData(functions: Functions, input: SearchOrgStudentDataInput): Promise<OrgStudentDataSearchResult>`

クライアント request は server と同じ `{ orgId, field, query, reason }` に固定する。

- [ ] **Step 1: 失敗するclient wrapperテストを書く。**

既存 `src/lib/privacy/orgStudentDataExport.ts` と同じ `httpsCallable` パターンを使う。

確認項目:

1. Function名が `searchOrgStudentDataCallable`。
2. request payload を変形せず渡す。
3. `.data` をそのまま型付きresponseとして返す。
4. ローカル永続化、副作用、キャッシュを行わない。

- [ ] **Step 2: テスト失敗を確認する。**

```bash
npm test -- src/lib/privacy/orgStudentDataSearch.test.ts
```

- [ ] **Step 3: thin wrapperだけを実装する。**

エラー翻訳、retry、キャッシュ層等は追加しない。

- [ ] **Step 4: テスト・型チェックを通す。**

```bash
npm test -- src/lib/privacy/orgStudentDataSearch.test.ts
npm run typecheck
```

- [ ] **Step 5: Task 3だけをコミットする。**

```bash
git add src/lib/privacy/orgStudentDataSearch.ts src/lib/privacy/orgStudentDataSearch.test.ts
git commit -m "feat: add organization student search client"
```

---

### Task 4: 学校組織設定画面に検索UIと10分自動破棄を配線する

**Files:**
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.tsx`
- Modify: `src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`
- Modify: `src/App.tsx`
- Modify: `docs/superpowers/scope-backlog.md`
- Test: `src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx`

**Interfaces:**

`SchoolOrgSettingsPageProps` に以下を追加する。

- `onSearchStudentData(input: { field: OrgStudentSearchField; query: string; reason: string }): void`
- `searchingStudentData: boolean`
- `studentDataSearchResult?: OrgStudentDataSearchResult`
- `onClearStudentDataSearch(): void`

`SchoolOrgSettingsRoute` が client API 呼び出し・result state・expiry timer を所有する。画面component自身に Firebase dependency を入れない。

現在の `SchoolOrgSettingsPage` はすでに `viewerRole` をメンバー一覧から算出し、owner限定一括エクスポート、owner/admin監査ログを条件表示しているので、この既存role分岐へ検索セクションを追加する。

現在の `SchoolOrgSettingsRoute` も privacy client 呼び出しとstateを担当しているため、同じ責務配置を維持する。

- [ ] **Step 1: `SchoolOrgSettingsPage.test.tsx` に失敗テストを書く。**

最低限以下を固定する。

1. owner に「生徒データ検索」が表示される。
2. admin にも表示される。
3. teacher には表示されない。
4. `query` が空なら検索不可。
5. `reason` が空なら検索不可。
6. 検索方式として「生徒名」「外部識別子」の2つだけ選択できる。
7. UI に「完全一致」であることを明示する。
8. submit時に `{ field, query, reason }` を正確に `onSearchStudentData` へ渡す。
9. `searchingStudentData` 中は二重submit不可。
10. result は `displayName / externalIdentifier / status / lessonRunId` を表示する。
11. result にない生の追加フィールドを表示しない。
12. `truncated` の場合は「先頭50件」相当の注意を表示する。
13. 「閉じる」で `onClearStudentDataSearch` を呼ぶ。
14. client側に検索値やresultを storage へ保存するコードを追加しない。

- [ ] **Step 2: componentテストの失敗を確認する。**

```bash
npm test -- src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx
```

- [ ] **Step 3: `SchoolOrgSettingsPage` に最小UIを追加する。**

既存 MUI `TextField`, `MenuItem`, `Button`, `Stack` を再利用する。

UIは以下のみとする。

- 見出し「生徒データ検索」
- 「生徒名 / 外部識別子」select
- 検索値入力
- 閲覧理由入力
- 「検索」button
- 結果一覧
- 「この個票は10分後に自動的に閉じられます」の説明
- 「閉じる」button

新しいModalライブラリ、DataGrid、検索補完、pagination componentは導入しない。

- [ ] **Step 4: `SchoolOrgSettingsRoute` に状態とCallableを配線する。**

追加state:

- `searchingStudentData`
- `studentDataSearchResult`

検索成功後はserverの `expiresAt` を使用してtimerを設定する。クライアント時計で独自に「検索時刻+10分」を計算し直さない。

以下の場合にresultを即座に破棄する。

- `expiresAt` 到達
- `orgId` 変更
- `onClearStudentDataSearch`
- 新しい検索開始時

component unmount 時にはtimerを必ずclearする。

- [ ] **Step 5: App配線を含む関連テストを実行する。**

```bash
npm test -- src/lib/privacy/orgStudentDataSearch.test.ts src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx
npm run typecheck
```

- [ ] **Step 6: Phase 7 backlogを更新する。**

全実装・テスト成功を確認した**後だけ**、`docs/superpowers/scope-backlog.md` の Phase 7 で「管理者向けの生徒データ検索」を完了扱いへ更新する。

「年度単位のアーカイブ」は未完了のまま残す。これにより次のPhase 7対象が年度アーカイブであることを曖昧にしない。

- [ ] **Step 7: Task 4をコミットする。**

```bash
git add src/components/teacher/organizations/SchoolOrgSettingsPage.tsx src/components/teacher/organizations/SchoolOrgSettingsPage.test.tsx src/App.tsx docs/superpowers/scope-backlog.md
git commit -m "feat: add audited student search UI"
```

---

## Task Assignment / Parallelization

- **Task 1 → Codex**
  - 純粋ロジックとAdmin SDK wiring。既存 `exportOrgStudentData.ts` のdeps注入パターンを踏襲する作業に向く。
- **Task 2 → Claude Code**
  - 認可順序・監査ログ・Callable境界を扱うため、最も厳格にレビューすべきTask。特に「target readより前にrole認可」がレビューの中心。
- **Task 3 → Antigravity**
  - 独立した薄いFirebase client wrapper。
- **Task 4 → Antigravity**
  - React / Testing Library中心。Task 3完了後に続けて担当する。

**並行実装:** Task 1 と Task 3 はインターフェースをこの計画どおり固定すれば並行実装可能。Task 2 は Task 1 に依存する。Task 4 は Task 2 と Task 3 の両方に依存する。

依存順:

`Task 1 ─→ Task 2 ─┐`  
`Task 3 ───────────┴→ Task 4`

## Final Verification and Push

全Taskのコミット後、ローカルコミットだけで作業終了してはならない。

まず `codex/classroom` 上で型チェックとテストを**再実行**する。

```bash
npm run typecheck
npm test
npm run verify
```

`npm run verify` は lint、typecheck、通常テスト、rules emulator tests、market concurrency tests、build、Functions/workspace群のverifyまで実行する構成である。

上記が**全件PASSしたことを確認してから**、作業ブランチをリモートへpushする。

```bash
git status --short
git branch --show-current
git push origin codex/classroom
```

`git branch --show-current` が `codex/classroom` でない場合はpushせず、ブランチ状態を修正する。

push後は GitHub 上の `codex/classroom` に最後のTaskコミットが存在することまで確認する。ローカルコミットのみでは完了扱いにしない。
