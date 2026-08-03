# 本格リリース対応 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 授業で毎回安心して使えるように、教師の運用導線（承認・却下・復帰・記録の持ち出し）と生徒の誤操作耐性を埋め、進行が止まったことを必ず気づける状態にする。

**Architecture:** 既存の「純粋関数を切り出して単体テスト、薄い async ラッパで `runTransaction` を呼ぶ」パターンを踏襲する。UI は「表示専用コンポーネント（テスト対象）＋ 親が Firebase を配線」に分ける。RTDB のセキュリティルールを触るタスクは必ず `test/database.rules.test.ts` にケースを足す。

**Tech Stack:** React 19 / TypeScript 6 / Vite 8 / Firebase 12 (Firestore + Realtime Database + Anonymous/Google Auth) / Vitest 4 / @firebase/rules-unit-testing 5 / oxlint

## Global Constraints

- 課金プランは **Spark のまま**。Cloud Functions・Cloud Scheduler・Blaze 前提の機能は追加しない。
- 市場の同時参加上限は `MARKET_CAPACITY = 80`（`src/lib/market/marketRepository.ts:6`）。変更しない。
- RTDB の書き込みはすべて `liveMarkets/{marketId}` ルートの `runTransaction` 経由。個別ノードへの直接 `set` を新規に増やさない（既存の `orders/{id}/pending` と presence を除く）。
- UI 文言はすべて日本語。生徒向けは中学生が読める語彙にする。
- 参加者キーは `participantId(uid, sessionId)` = `` `${uid}_${sessionId}` `` 形式を維持する（RTDB ルール `database.rules.json:41,50` がこの形式を検証している）。
- 各タスクの最後に必ず `npm run lint && npm run typecheck && npm test` が通ること。ルールを触ったタスクは加えて `npm run test:rules`。
- コミットメッセージは既存の慣習に合わせ、英語小文字の Conventional Commits（例: `feat: allow students to rejoin an open market`）。末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` を付ける。

---

## ファイル構成

**新規作成**

| パス | 責務 |
|---|---|
| `src/components/teacher/AdmissionPanel.tsx` | 参加承認・却下・退出・チーム変更の表示専用 UI |
| `src/components/teacher/AdmissionPanel.test.tsx` | 同上のテスト |
| `src/components/teacher/HostStatusPanel.tsx` | ホスト画面の進行状況表示（表示専用） |
| `src/components/teacher/HostStatusPanel.test.tsx` | 同上のテスト |
| `src/components/AppVersion.tsx` | ビルド識別子の表示 |
| `src/lib/teacher/resultsExport.ts` | 結果の CSV 生成とダウンロード |
| `src/lib/teacher/resultsExport.test.ts` | 同上のテスト |
| `src/lib/host/hostContinuity.ts` | 画面スリープ抑止・離脱警告・非表示検知のフック |
| `src/lib/host/hostContinuity.test.ts` | 同上のテスト |
| `src/lib/firebase/serverTime.ts` | RTDB サーバ時刻オフセットの同期と `serverNow()` |
| `src/lib/firebase/serverTime.test.ts` | 同上のテスト |
| `src/lib/monitoring/describeError.ts` | Firebase エラー → 日本語メッセージ変換 |
| `src/lib/monitoring/describeError.test.ts` | 同上のテスト |

**変更**

| パス | 変更内容 |
|---|---|
| `database.rules.json` | OPEN 中の参加申請許可、`recoveryCode` の保全と検証 |
| `test/database.rules.test.ts` | 上記のケース追加 |
| `src/lib/market/liveMarketTypes.ts` | `recoveryCode` / `recoveryCodes` / `RecoveryEntry` 追加 |
| `src/lib/market/marketRepository.ts` | 承認の純粋関数化、却下・退出・チーム変更、復帰コード |
| `src/lib/market/marketRepository.test.ts` | 上記の単体テスト |
| `src/lib/market/hostTrading.ts` | ニュースの価格インパクト、`serverNow()` 化、`displayName` 書き出し |
| `src/lib/market/hostTrading.test.ts` | 上記の単体テスト |
| `src/components/HostConsole.tsx` | 承認パネル・状況パネル・継続性警告・二段階終了・エラー可視化 |
| `src/components/MarketDashboard.tsx` | URL 復元、承認パネル差し替え、CSV、エラー可視化 |
| `src/components/student/StudentMarketPage.tsx` | 復帰コード表示、残高連携、aria |
| `src/components/student/TradePanel.tsx` | 数量クランプ・確認ステップ・送信中表示 |
| `src/components/student/TradePanel.test.tsx` | 上記のテスト |
| `src/components/student/ResultsView.tsx` | 保有・銘柄別損益・セッション解除 |
| `src/components/student/ResultsView.test.tsx` | 上記のテスト |
| `src/components/TemplateWorkspace.tsx` | 共有 URL のコピー、`initialShares` 除去 |
| `src/lib/templates/types.ts` / `templateValidation.ts` / `officialSeeds.ts` | `initialShares` 除去 |
| `src/components/PublicDocs.tsx` / `README.md` | 運用注意の追記 |

**削除**

- `src/components/student/JoinMarket.tsx` / `src/components/student/JoinMarket.test.tsx`（本番未接続の重複実装）

---

# フェーズ 1 — 授業が破綻する欠落を埋める

## Task 1: 授業中（OPEN）の参加申請を許可する

いまは `database.rules.json:49` が `meta/status === 'SETUP'` を要求しているため、市場を開始したあとは遅刻した生徒も、端末を替えた生徒も、一切参加申請を出せない。以降のすべての復帰機能の前提になる。

**Files:**
- Modify: `database.rules.json:49`
- Test: `test/database.rules.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `liveMarkets/{marketId}/joinRequests/{requestId}` への生徒の create が `meta/status` が `SETUP` または `OPEN` のとき成功する

- [ ] **Step 1: 失敗するルールテストを書く**

`test/database.rules.test.ts` の末尾に追加する。

```ts
describe('joining an already-open market', () => {
  it('accepts a join request while the market is OPEN but not after it ended', async () => {
    await environment.withSecurityRulesDisabled(async (context) =>
      context.database().ref(`liveMarkets/${market}/meta/status`).set('OPEN'))
    const student = environment.authenticatedContext('student-late').database()
    const request = { uid: 'student-late', sessionId: 'session', displayName: '遅刻', requestedTeamId: null, connected: true, requestedAtMillis: 5 }
    await assertSucceeds(student.ref(`liveMarkets/${market}/joinRequests/student-late_session`).set(request))

    await environment.withSecurityRulesDisabled(async (context) =>
      context.database().ref(`liveMarkets/${market}/meta/status`).set('ENDED'))
    const other = environment.authenticatedContext('student-too-late').database()
    await assertFails(other.ref(`liveMarkets/${market}/joinRequests/student-too-late_session`).set({ ...request, uid: 'student-too-late' }))
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npm run test:rules`
Expected: FAIL — 1つ目の `assertSucceeds` が `PERMISSION_DENIED` で落ちる。

- [ ] **Step 3: ルールを直す**

`database.rules.json` の `joinRequests/$requestId/.write`（49行目）のうち、新規作成を許す節だけを差し替える。変更前:

```
(!data.exists() && root.child('liveMarkets').child($marketId).child('meta/status').val() === 'SETUP' && newData.child('uid').val() === auth.uid && newData.child('connected').val() === true)
```

変更後:

```
(!data.exists() && (root.child('liveMarkets').child($marketId).child('meta/status').val() === 'SETUP' || root.child('liveMarkets').child($marketId).child('meta/status').val() === 'OPEN') && newData.child('uid').val() === auth.uid && newData.child('connected').val() === true)
```

- [ ] **Step 4: 通ることを確認する**

Run: `npm run test:rules`
Expected: PASS（既存ケースも含めて全緑）

- [ ] **Step 5: コミット**

```bash
git add database.rules.json test/database.rules.test.ts && git commit -m "feat: accept join requests while a market is open"
```

---

## Task 2: 却下・退出・チーム変更を純粋関数として実装する

承認しかないため、誤承認もいたずら参加も取り消せない。RTDB を触らずテストできるよう、状態遷移を純粋関数に切り出す。

**Files:**
- Modify: `src/lib/market/liveMarketTypes.ts`
- Modify: `src/lib/market/marketRepository.ts`
- Test: `src/lib/market/marketRepository.test.ts`

**Interfaces:**
- Consumes: `LiveMarketState`（`src/lib/market/liveMarketTypes.ts:51`）
- Produces:
  - `applyRemoveParticipant(raw: LiveMarketState | null, id: string): LiveMarketState | undefined`
  - `applyReassignTeam(raw: LiveMarketState | null, id: string, teamId: string, atMillis: number): LiveMarketState | undefined`
  - `rejectJoinRequest(database: Database, marketId: string, id: string): Promise<void>`
  - `removeParticipant(database: Database, marketId: string, id: string): Promise<boolean>`
  - `reassignParticipantTeam(database: Database, marketId: string, id: string, teamId: string): Promise<boolean>`

- [ ] **Step 1: 型に復帰用フィールドを足す**

`src/lib/market/liveMarketTypes.ts` の `JoinRequest`（18行目）を差し替える。

```ts
export interface JoinRequest {
  uid: string; sessionId: string; displayName: string; requestedTeamId: string | null
  connected: boolean; requestedAtMillis: number; approvedAtMillis?: number
  /** Issued on approval; lets the same student return from another device. */
  recoveryCode?: string
}
/** Reverse index from a student-facing recovery code to the live participant it restores. */
export interface RecoveryEntry { participantId: string; teamId: string; displayName: string }
```

同ファイルの `LiveMarketState`（51行目）に一行足す。`joinRequests` の直後に置く。

```ts
  recoveryCodes?: Record<string, RecoveryEntry>
```

- [ ] **Step 2: 失敗するテストを書く**

`src/lib/market/marketRepository.test.ts` の末尾に追加する。先頭の import に `applyRemoveParticipant, applyReassignTeam` を足し、`import type { LiveMarketState } from './liveMarketTypes'` を追加する。

```ts
const stateWithTwo = (): LiveMarketState => ({
  meta: { ownerUid: 'teacher', capacity: 80, visibility: 'private', status: 'OPEN', createdAtMillis: 1, startingCash: 10000, joinCode: 'ABC234' },
  teams: { red: { id: 'red', name: '赤' }, blue: { id: 'blue', name: '青' } },
  members: { u1: { teamId: 'red' }, u2: { teamId: 'red' } },
  participants: {
    u1_s: { uid: 'u1', sessionId: 's', displayName: 'A', teamId: 'red', connected: true, lastSeenAtMillis: 1 },
    u2_s: { uid: 'u2', sessionId: 's', displayName: 'B', teamId: 'red', connected: true, lastSeenAtMillis: 1 },
  },
  orders: { u1_s: { pending: { orderId: 'o1', stockId: 'acme', side: 'BUY', quantity: 1, submittedAtMillis: 1 } } },
  teamPortfolios: { red: { cash: 10000, holdings: {}, updatedAtMillis: 1 } },
  recoveryCodes: { AB23: { participantId: 'u1_s', teamId: 'red', displayName: 'A' } },
})

describe('participant removal', () => {
  it('drops the participant, their pending order, membership and recovery code', () => {
    const next = applyRemoveParticipant(stateWithTwo(), 'u1_s')!
    expect(next.participants!.u1_s).toBeUndefined()
    expect(next.participants!.u2_s).toBeDefined()
    expect(next.orders!.u1_s).toBeUndefined()
    expect(next.members!.u1).toBeUndefined()
    expect(next.recoveryCodes!.AB23).toBeUndefined()
    // Team assets are shared, so removing one member never touches the portfolio.
    expect(next.teamPortfolios!.red.cash).toBe(10000)
  })

  it('aborts when the participant does not exist', () => {
    expect(applyRemoveParticipant(stateWithTwo(), 'missing_s')).toBeUndefined()
  })
})

describe('team reassignment', () => {
  it('moves the participant, their membership and their recovery code to the new team', () => {
    const next = applyReassignTeam(stateWithTwo(), 'u1_s', 'blue', 99)!
    expect(next.participants!.u1_s.teamId).toBe('blue')
    expect(next.members!.u1.teamId).toBe('blue')
    expect(next.recoveryCodes!.AB23.teamId).toBe('blue')
    expect(next.teamPortfolios!.blue).toEqual({ cash: 10000, holdings: {}, updatedAtMillis: 99 })
  })

  it('aborts for an unknown team or a no-op move', () => {
    expect(applyReassignTeam(stateWithTwo(), 'u1_s', 'green', 99)).toBeUndefined()
    expect(applyReassignTeam(stateWithTwo(), 'u1_s', 'red', 99)).toBeUndefined()
  })
})
```

- [ ] **Step 3: 失敗を確認する**

Run: `npx vitest run src/lib/market/marketRepository.test.ts`
Expected: FAIL — `applyRemoveParticipant is not a function`

- [ ] **Step 4: 実装する**

`src/lib/market/marketRepository.ts` の末尾に追加する。import 行に `remove` を足す（`import { onDisconnect, ref, remove, runTransaction, set, update, type Database } from 'firebase/database'`）。

```ts
/**
 * Team portfolios are shared, so a removed member never takes assets with them.
 * Membership is dropped too: the student may rejoin and be assigned freshly.
 */
export const applyRemoveParticipant = (raw: LiveMarketState | null, id: string): LiveMarketState | undefined => {
  const participant = raw?.participants?.[id]
  if (!raw || !participant) return undefined
  delete raw.participants![id]
  if (raw.orders?.[id]) delete raw.orders[id]
  if (raw.joinRequests?.[id]) delete raw.joinRequests[id]
  if (raw.members?.[participant.uid]) delete raw.members[participant.uid]
  for (const [code, entry] of Object.entries(raw.recoveryCodes ?? {})) {
    if (entry.participantId === id) delete raw.recoveryCodes![code]
  }
  return raw
}

export const applyReassignTeam = (raw: LiveMarketState | null, id: string, teamId: string, atMillis: number): LiveMarketState | undefined => {
  const participant = raw?.participants?.[id]
  if (!raw || !participant || !raw.teams?.[teamId] || participant.teamId === teamId) return undefined
  participant.teamId = teamId
  raw.members ??= {}
  raw.members[participant.uid] = { teamId }
  raw.teamPortfolios ??= {}
  raw.teamPortfolios[teamId] ??= { cash: raw.meta.startingCash, holdings: {}, updatedAtMillis: atMillis }
  for (const entry of Object.values(raw.recoveryCodes ?? {})) {
    if (entry.participantId === id) entry.teamId = teamId
  }
  return raw
}

/** A rejected request is removed outright; the student sees the waiting screen time out. */
export const rejectJoinRequest = (database: Database, marketId: string, id: string) =>
  remove(ref(database, `${root(marketId)}/joinRequests/${id}`))

export const removeParticipant = async (database: Database, marketId: string, id: string) =>
  (await runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => applyRemoveParticipant(raw, id))).committed

export const reassignParticipantTeam = async (database: Database, marketId: string, id: string, teamId: string) =>
  (await runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => applyReassignTeam(raw, id, teamId, Date.now()))).committed
```

- [ ] **Step 5: 通ることを確認する**

Run: `npx vitest run src/lib/market/marketRepository.test.ts`
Expected: PASS（6件）

- [ ] **Step 6: コミット**

```bash
git add src/lib/market && git commit -m "feat: let teachers reject, remove and reassign participants"
```

---

## Task 3: 復帰コードを発行し、別端末からチームへ戻れるようにする

生徒の資産はチーム単位（`teamPortfolios`）なので、**同じチームに戻せれば資産は完全に復元される**。承認時に4文字の復帰コードを発行し、再参加時にそれを持ってきた生徒は必ず同じチームへ入れる。前の端末の取引履歴も新しいキーへ引き継ぐ。

**Files:**
- Modify: `src/lib/market/marketRepository.ts`
- Modify: `database.rules.json:49,50`
- Test: `src/lib/market/marketRepository.test.ts`
- Test: `test/database.rules.test.ts`

**Interfaces:**
- Consumes: `applyRemoveParticipant`（Task 2）、`RecoveryEntry` / `JoinRequest.recoveryCode`（Task 2 Step 1）
- Produces:
  - `RECOVERY_CODE_LENGTH: 4`
  - `generateRecoveryCode(randomValues?: Uint32Array): string`
  - `applyApproveJoinRequest(raw, id, mode, manualTeamId, atMillis, newCode): LiveMarketState | undefined`
  - `approveJoinRequest(database, marketId, id, mode, manualTeamId?): Promise<boolean>`（シグネチャは既存のまま）

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/market/marketRepository.test.ts` に追加。import に `applyApproveJoinRequest, generateRecoveryCode` を足す。

```ts
const pendingState = (recoveryCode?: string): LiveMarketState => ({
  meta: { ownerUid: 'teacher', capacity: 80, visibility: 'private', status: 'OPEN', createdAtMillis: 1, startingCash: 10000, joinCode: 'ABC234' },
  teams: { red: { id: 'red', name: '赤' }, blue: { id: 'blue', name: '青' } },
  joinRequests: { new_s2: { uid: 'new', sessionId: 's2', displayName: 'A', requestedTeamId: null, connected: true, requestedAtMillis: 5, ...(recoveryCode ? { recoveryCode } : {}) } },
  participants: { old_s1: { uid: 'old', sessionId: 's1', displayName: 'A', teamId: 'blue', connected: false, lastSeenAtMillis: 1 } },
  members: { old: { teamId: 'blue' } },
  transactions: { old_s1: { o1: { orderId: 'o1', participantId: 'old_s1', teamId: 'blue', stockId: 'acme', side: 'BUY', requestedQuantity: 2, filledQuantity: 2, price: 100, processedAtMillis: 6 } } },
  teamPortfolios: { blue: { cash: 9800, holdings: { acme: 2 }, updatedAtMillis: 6 } },
  recoveryCodes: { AB23: { participantId: 'old_s1', teamId: 'blue', displayName: 'A' } },
})

describe('recovery codes', () => {
  it('issues a code on a first approval and records the reverse index', () => {
    const state = pendingState()
    delete state.recoveryCodes
    delete state.participants
    const next = applyApproveJoinRequest(state, 'new_s2', 'random', undefined, 99, 'ZZ99')!
    expect(next.joinRequests!.new_s2.recoveryCode).toBe('ZZ99')
    expect(next.recoveryCodes!.ZZ99).toEqual({ participantId: 'new_s2', teamId: next.participants!.new_s2.teamId, displayName: 'A' })
  })

  it('restores the previous team and trade history when a code is presented', () => {
    const next = applyApproveJoinRequest(pendingState('AB23'), 'new_s2', 'random', undefined, 99, 'ZZ99')!
    expect(next.participants!.new_s2.teamId).toBe('blue')
    expect(next.participants!.old_s1).toBeUndefined()
    expect(next.transactions!.new_s2.o1.filledQuantity).toBe(2)
    expect(next.transactions!.old_s1).toBeUndefined()
    expect(next.recoveryCodes!.AB23.participantId).toBe('new_s2')
    expect(next.joinRequests!.new_s2.recoveryCode).toBe('AB23')
    // The team keeps every asset, so the student comes back to exactly what they left.
    expect(next.teamPortfolios!.blue).toEqual({ cash: 9800, holdings: { acme: 2 }, updatedAtMillis: 6 })
  })

  it('ignores an unknown code and assigns a team normally', () => {
    const next = applyApproveJoinRequest(pendingState('QQQQ'), 'new_s2', 'random', undefined, 99, 'ZZ99')!
    expect(next.joinRequests!.new_s2.recoveryCode).toBe('ZZ99')
    expect(next.participants!.old_s1).toBeDefined()
  })

  it('refuses a new participant once the capacity is reached', () => {
    const state = pendingState()
    state.meta.capacity = 1
    state.participants!.old_s1.connected = true
    expect(applyApproveJoinRequest(state, 'new_s2', 'random', undefined, 99, 'ZZ99')).toBeUndefined()
  })

  it('generates a four character code from the unambiguous alphabet', () => {
    expect(generateRecoveryCode(new Uint32Array([0, 1, 2, 3]))).toBe('2345')
    expect(generateRecoveryCode()).toHaveLength(4)
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/market/marketRepository.test.ts`
Expected: FAIL — `applyApproveJoinRequest is not a function`

- [ ] **Step 3: 実装する**

`src/lib/market/marketRepository.ts` の既存 `approveJoinRequest`（116〜138行目）を、以下でまるごと置き換える。

```ts
export const RECOVERY_CODE_LENGTH = 4
/** Short enough to read aloud, from the same unambiguous alphabet as join codes. */
export const generateRecoveryCode = (randomValues: Uint32Array = crypto.getRandomValues(new Uint32Array(RECOVERY_CODE_LENGTH))) =>
  Array.from(randomValues, (value) => JOIN_CODE_ALPHABET[value % JOIN_CODE_ALPHABET.length]).join('')

/**
 * Approval, capacity, team assignment and device recovery are one indivisible step.
 *
 * A returning student presents the code they were shown on their old device. Their
 * assets live on the team, so restoring the team restores everything; the personal
 * trade history is re-keyed onto the new participant id and the stale participant
 * is retired so the teacher's list never shows a ghost.
 */
export const applyApproveJoinRequest = (
  raw: LiveMarketState | null,
  id: string,
  mode: TeamAssignmentMode,
  manualTeamId: string | undefined,
  atMillis: number,
  newCode: string,
): LiveMarketState | undefined => {
  if (!raw?.meta || !raw.joinRequests?.[id]) return undefined
  const request = raw.joinRequests[id]
  if (!request.connected) return undefined
  raw.participants ??= {}
  if (raw.participants[id]) return raw
  const active = Object.values(raw.participants).filter((participant) => participant.connected).length
  if (active >= raw.meta.capacity) return undefined
  const recovery = request.recoveryCode ? raw.recoveryCodes?.[request.recoveryCode] : undefined
  const teamId = recovery?.teamId ?? raw.members?.[request.uid]?.teamId ?? chooseTeam(raw, request, mode, manualTeamId)
  if (!teamId || !raw.teams?.[teamId]) return undefined
  const participant: LiveMarketParticipant = { uid: request.uid, sessionId: request.sessionId, displayName: request.displayName, teamId, connected: true, lastSeenAtMillis: atMillis }
  raw.participants[id] = participant
  raw.members ??= {}
  raw.members[request.uid] = { teamId }
  raw.teamPortfolios ??= {}
  raw.teamPortfolios[teamId] ??= { cash: raw.meta.startingCash, holdings: {}, updatedAtMillis: atMillis }
  const code = recovery && request.recoveryCode ? request.recoveryCode : newCode
  if (recovery && recovery.participantId !== id) {
    const previous = raw.transactions?.[recovery.participantId]
    if (previous) {
      raw.transactions ??= {}
      raw.transactions[id] = { ...previous, ...(raw.transactions[id] ?? {}) }
      delete raw.transactions[recovery.participantId]
    }
    if (raw.participants[recovery.participantId]) delete raw.participants[recovery.participantId]
    if (raw.orders?.[recovery.participantId]) delete raw.orders[recovery.participantId]
  }
  raw.recoveryCodes ??= {}
  raw.recoveryCodes[code] = { participantId: id, teamId, displayName: request.displayName }
  raw.joinRequests[id] = { ...request, approvedAtMillis: atMillis, recoveryCode: code }
  return raw
}

/** Root transaction keeps the cap, request approval, team assignment and recovery indivisible. */
export const approveJoinRequest = async (database: Database, marketId: string, id: string, mode: TeamAssignmentMode, manualTeamId?: string) => {
  const newCode = generateRecoveryCode()
  const result = await runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) =>
    applyApproveJoinRequest(raw, id, mode, manualTeamId, Date.now(), newCode))
  return result.committed
}
```

`requestToJoinMarket`（86行目）が `recoveryCode` を運べるようにシグネチャを広げる。既存の定義を置き換える。

```ts
export const requestToJoinMarket = async (
  database: Database,
  marketId: string,
  request: Omit<JoinRequest, 'requestedAtMillis' | 'connected' | 'approvedAtMillis'>,
) => {
  const id = participantId(request.uid, request.sessionId)
  const payload = { ...request, connected: true, requestedAtMillis: Date.now() }
  if (!payload.recoveryCode) delete payload.recoveryCode
  await set(ref(database, `${root(marketId)}/joinRequests/${id}`), payload)
  await onDisconnect(ref(database, `${root(marketId)}/joinRequests/${id}/connected`)).set(false)
  return id
}
```

- [ ] **Step 4: 通ることを確認する**

Run: `npx vitest run src/lib/market/marketRepository.test.ts`
Expected: PASS（11件）

- [ ] **Step 5: 復帰コードを守るルールテストを書く**

`test/database.rules.test.ts` に追加。

```ts
describe('recovery codes', () => {
  it('lets a student read but never rewrite the code issued to them', async () => {
    const request = { uid: 'student-a', sessionId: 'session', displayName: '生徒', requestedTeamId: null, connected: true, requestedAtMillis: 1, recoveryCode: 'AB23' }
    await environment.withSecurityRulesDisabled(async (context) =>
      context.database().ref(`liveMarkets/${market}/joinRequests/student-a_session`).set(request))
    const student = environment.authenticatedContext('student-a').database()
    await assertSucceeds(student.ref(`liveMarkets/${market}/joinRequests/student-a_session/recoveryCode`).get())
    await assertFails(student.ref(`liveMarkets/${market}/joinRequests/student-a_session`).set({ ...request, recoveryCode: 'ZZ99' }))
  })

  it('never exposes the market-wide recovery index to a student', async () => {
    await approveStudent()
    await environment.withSecurityRulesDisabled(async (context) =>
      context.database().ref(`liveMarkets/${market}/recoveryCodes/AB23`).set({ participantId: 'student-a_session', teamId: 'red', displayName: '生徒' }))
    await assertFails(environment.authenticatedContext('student-a').database().ref(`liveMarkets/${market}/recoveryCodes`).get())
  })

  it('rejects a malformed recovery code on a join request', async () => {
    const student = environment.authenticatedContext('student-b').database()
    await assertFails(student.ref(`liveMarkets/${market}/joinRequests/student-b_session`).set({
      uid: 'student-b', sessionId: 'session', displayName: '生徒', requestedTeamId: null, connected: true, requestedAtMillis: 1, recoveryCode: 'TOOLONG',
    }))
  })
})
```

- [ ] **Step 6: 失敗を確認する**

Run: `npm run test:rules`
Expected: FAIL — 1件目の `assertFails`（書き換えが通ってしまう）と3件目の `assertFails`（長すぎるコードが通ってしまう）が落ちる。

- [ ] **Step 7: ルールを直す**

`database.rules.json` の `joinRequests/$requestId/.write`（49行目）の、生徒による更新を許す最後の節に `recoveryCode` の保全を足す。変更前の末尾:

```
newData.child('approvedAtMillis').val() === data.child('approvedAtMillis').val()))
```

変更後:

```
newData.child('approvedAtMillis').val() === data.child('approvedAtMillis').val() && newData.child('recoveryCode').val() === data.child('recoveryCode').val()))
```

さらに `joinRequests/$requestId` の子ルールとして、`connected`（51行目）の隣に追加する。

```json
            "recoveryCode": { ".validate": "!newData.exists() || (newData.isString() && newData.val().length === 4)" }
```

- [ ] **Step 8: 通ることを確認する**

Run: `npm run test:rules`
Expected: PASS

- [ ] **Step 9: コミット**

```bash
git add src/lib/market database.rules.json test/database.rules.test.ts && git commit -m "feat: issue recovery codes so students can rejoin from another device"
```

---

## Task 4: 承認パネルを表示専用コンポーネントとして切り出す

いまダッシュボードのローカル state にしか存在しない承認 UI を、props だけで動く部品にする。次のタスクでホスト画面とダッシュボードの両方に載せる。

**Files:**
- Create: `src/components/teacher/AdmissionPanel.tsx`
- Test: `src/components/teacher/AdmissionPanel.test.tsx`

**Interfaces:**
- Consumes: `TeamAssignmentMode`（`src/lib/market/liveMarketTypes.ts:4`）
- Produces: `AdmissionPanel`, `AdmissionRequest`, `AdmissionParticipant`, `AdmissionPanelProps`

- [ ] **Step 1: 失敗するテストを書く**

`src/components/teacher/AdmissionPanel.test.tsx` を新規作成する。

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AdmissionPanel } from './AdmissionPanel'

const baseProps = {
  joinCode: 'ABC234',
  capacity: 80,
  teams: [{ id: 'red', name: '赤' }, { id: 'blue', name: '青' }],
  requests: [{ id: 'u1_s', displayName: '山田', requestedTeamId: null }],
  participants: [{ id: 'u2_s', displayName: '鈴木', teamId: 'red', connected: true }],
  mode: 'random' as const,
  onModeChange: vi.fn(),
  onApprove: vi.fn(),
  onReject: vi.fn(),
  onRemove: vi.fn(),
  onReassign: vi.fn(),
}

describe('AdmissionPanel', () => {
  it('approves and rejects a waiting request', async () => {
    const onApprove = vi.fn(), onReject = vi.fn()
    render(<AdmissionPanel {...baseProps} onApprove={onApprove} onReject={onReject} />)
    await userEvent.click(screen.getByRole('button', { name: '山田 さんを承認' }))
    expect(onApprove).toHaveBeenCalledWith('u1_s', undefined)
    await userEvent.click(screen.getByRole('button', { name: '山田 さんの申請を却下' }))
    expect(onReject).toHaveBeenCalledWith('u1_s')
  })

  it('passes the chosen team when the mode is manual', async () => {
    const onApprove = vi.fn()
    render(<AdmissionPanel {...baseProps} mode="manual" onApprove={onApprove} />)
    await userEvent.selectOptions(screen.getByLabelText('山田 さんの割り当て先'), 'blue')
    await userEvent.click(screen.getByRole('button', { name: '山田 さんを承認' }))
    expect(onApprove).toHaveBeenCalledWith('u1_s', 'blue')
  })

  it('reassigns and removes an approved participant', async () => {
    const onReassign = vi.fn(), onRemove = vi.fn()
    render(<AdmissionPanel {...baseProps} onReassign={onReassign} onRemove={onRemove} />)
    await userEvent.selectOptions(screen.getByLabelText('鈴木 さんのチーム'), 'blue')
    expect(onReassign).toHaveBeenCalledWith('u2_s', 'blue')
    await userEvent.click(screen.getByRole('button', { name: '鈴木 さんを退出させる' }))
    expect(onRemove).toHaveBeenCalledWith('u2_s')
  })

  it('shows the participant count against the capacity', () => {
    render(<AdmissionPanel {...baseProps} />)
    expect(screen.getByText('1 / 80')).toBeInTheDocument()
  })

  it('explains the empty state when nobody is waiting', () => {
    render(<AdmissionPanel {...baseProps} requests={[]} />)
    expect(screen.getByText(/参加コードを生徒に共有/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/components/teacher/AdmissionPanel.test.tsx`
Expected: FAIL — `Failed to resolve import "./AdmissionPanel"`

- [ ] **Step 3: 実装する**

`src/components/teacher/AdmissionPanel.tsx` を新規作成する。

```tsx
import { useState } from 'react'
import type { TeamAssignmentMode } from '../../lib/market/liveMarketTypes'

export interface AdmissionRequest { id: string; displayName: string; requestedTeamId: string | null }
export interface AdmissionParticipant { id: string; displayName: string; teamId: string | null; connected: boolean }

export interface AdmissionPanelProps {
  joinCode: string
  capacity: number
  teams: { id: string; name: string }[]
  requests: AdmissionRequest[]
  participants: AdmissionParticipant[]
  mode: TeamAssignmentMode
  onModeChange: (mode: TeamAssignmentMode) => void
  onApprove: (id: string, manualTeamId?: string) => void
  onReject: (id: string) => void
  onRemove: (id: string) => void
  onReassign: (id: string, teamId: string) => void
  onCopyJoinCode?: () => void
}

export function AdmissionPanel({ joinCode, capacity, teams, requests, participants, mode, onModeChange, onApprove, onReject, onRemove, onReassign, onCopyJoinCode }: AdmissionPanelProps) {
  const [manualTeams, setManualTeams] = useState<Record<string, string>>({})
  const active = participants.filter((participant) => participant.connected).length
  const teamName = (id: string | null) => teams.find((team) => team.id === id)?.name ?? '未割当'
  return (
    <section className="admission-panel">
      <div className="join-code">
        <span>参加コード</span><strong>{joinCode}</strong>
        {onCopyJoinCode && <button type="button" onClick={onCopyJoinCode}>コピー</button>}
      </div>
      <div className="market-meta">
        <span>参加者 <b>{active} / {capacity}</b></span>
        <label>チーム編成
          <select value={mode} onChange={(event) => onModeChange(event.target.value as TeamAssignmentMode)}>
            <option value="random">人数が少ないチームへ自動割当</option>
            <option value="student_choice">生徒の希望を優先</option>
            <option value="manual">手動で割り当て</option>
          </select>
        </label>
      </div>

      <div className="request-list">
        <h3>参加承認待ち <span>{requests.length}</span></h3>
        {requests.length ? (
          <ul>{requests.map((request) => (
            <li key={request.id}>
              <div>
                <strong>{request.displayName}</strong>
                <small>{mode === 'student_choice' && request.requestedTeamId ? `希望: ${teamName(request.requestedTeamId)}` : '参加を待っています'}</small>
              </div>
              {mode === 'manual' && (
                <label>
                  <span className="visually-hidden">{request.displayName} さんの割り当て先</span>
                  <select
                    aria-label={`${request.displayName} さんの割り当て先`}
                    value={manualTeams[request.id] ?? teams[0]?.id ?? ''}
                    onChange={(event) => setManualTeams((current) => ({ ...current, [request.id]: event.target.value }))}
                  >{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select>
                </label>
              )}
              <button type="button" aria-label={`${request.displayName} さんを承認`} onClick={() => onApprove(request.id, mode === 'manual' ? manualTeams[request.id] ?? teams[0]?.id : undefined)}>承認</button>
              <button type="button" className="outline-button" aria-label={`${request.displayName} さんの申請を却下`} onClick={() => onReject(request.id)}>却下</button>
            </li>
          ))}</ul>
        ) : <p className="empty-copy">まだ参加申請はありません。参加コードを生徒に共有してください。</p>}
      </div>

      <div className="participant-list">
        <h3>参加中 <span>{participants.length}</span></h3>
        {participants.length ? (
          <ul>{participants.map((participant) => (
            <li key={participant.id} className={participant.connected ? '' : 'disconnected'}>
              <div>
                <strong>{participant.displayName}</strong>
                <small>{participant.connected ? teamName(participant.teamId) : `${teamName(participant.teamId)}・接続が切れています`}</small>
              </div>
              <label>
                <span className="visually-hidden">{participant.displayName} さんのチーム</span>
                <select
                  aria-label={`${participant.displayName} さんのチーム`}
                  value={participant.teamId ?? ''}
                  onChange={(event) => onReassign(participant.id, event.target.value)}
                >{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select>
              </label>
              <button type="button" className="danger-button" aria-label={`${participant.displayName} さんを退出させる`} onClick={() => onRemove(participant.id)}>退出</button>
            </li>
          ))}</ul>
        ) : <p className="empty-copy">まだ参加者はいません。</p>}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: 通ることを確認する**

Run: `npx vitest run src/components/teacher/AdmissionPanel.test.tsx`
Expected: PASS（5件）

- [ ] **Step 5: `.visually-hidden` のスタイルを足す**

`src/App.css` の末尾に追加する（既に同等の定義がある場合はこのステップを飛ばす）。

```css
.visually-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.admission-panel .participant-list li.disconnected { opacity: 0.55; }
```

- [ ] **Step 6: コミット**

```bash
git add src/components/teacher src/App.css && git commit -m "feat: add a reusable admission panel for teachers"
```

---

## Task 5: 承認パネルをホスト画面とダッシュボードの両方に載せ、URL で復元できるようにする

これが A-1 の本丸。リロードしても、別タブで開き直しても、承認画面に戻れるようにする。

**Files:**
- Modify: `src/components/HostConsole.tsx`
- Modify: `src/components/MarketDashboard.tsx:29,40,42,54`
- Test: 手動確認（下記 Step 6）

**Interfaces:**
- Consumes: `AdmissionPanel`（Task 4）、`rejectJoinRequest` / `removeParticipant` / `reassignParticipantTeam`（Task 2）
- Produces: `/teacher/markets/{id}/host` に承認 UI が常設される。`/teacher/markets?market={id}` で作成直後の状態が復元される。

- [ ] **Step 1: ダッシュボードの選択市場を URL に持たせる**

`src/components/MarketDashboard.tsx:29` の `marketId` の初期値を差し替える。

```tsx
  const [marketId, setMarketId] = useState(() => new URLSearchParams(window.location.search).get('market') ?? ''), [joinCode, setJoinCode] = useState(''), [state, setState] = useState<LiveMarketState | null>(null), [notice, setNotice] = useState(''), [mode, setMode] = useState<TeamAssignmentMode>('random'), [creating, setCreating] = useState(false)
```

`marketId` が変わったら URL と参加コードを同期する effect を、40行目の `onValue` の effect の直後に追加する。

```tsx
  // The active market must survive a reload: the teacher loses the ability to admit
  // latecomers otherwise, and there is no other way back to this panel.
  useEffect(() => {
    const url = new URL(window.location.href)
    if (marketId) url.searchParams.set('market', marketId)
    else url.searchParams.delete('market')
    window.history.replaceState(null, '', url)
  }, [marketId])
  useEffect(() => { if (state?.meta?.joinCode) setJoinCode(state.meta.joinCode) }, [state?.meta?.joinCode])
```

- [ ] **Step 2: ダッシュボードの承認 UI を `AdmissionPanel` に差し替える**

`src/components/MarketDashboard.tsx` の import に追加する。

```tsx
import { AdmissionPanel } from './teacher/AdmissionPanel'
import { approveJoinRequest, createMarket, listOwnedMarkets, reassignParticipantTeam, rejectJoinRequest, removeParticipant, requestToJoinMarket, resolveJoinCode, type MarketRecord } from '../lib/market/marketRepository'
```

42〜43行目の `requests` / `activeCount` を差し替え、パネルへ渡す形を作る。

```tsx
  const requests = Object.entries(state?.joinRequests ?? {})
    .filter(([id, request]) => request.connected && !state?.participants?.[id])
    .map(([id, request]) => ({ id, displayName: request.displayName, requestedTeamId: request.requestedTeamId }))
  const participants = Object.entries(state?.participants ?? {})
    .map(([id, participant]) => ({ id, displayName: participant.displayName, teamId: participant.teamId, connected: participant.connected }))
  const activeCount = participants.filter((participant) => participant.connected).length
  const teamOptions = Object.values(state?.teams ?? {}).map((team) => ({ id: team.id, name: team.name }))
```

54行目の `{marketId && <section className="active-market-card">…</section>}` のうち、`<div className="join-code">` から `</div>` で閉じる `request-list` までを、次で置き換える。`<div className="active-head">…</div>` はそのまま残す。

```tsx
        <AdmissionPanel
          joinCode={joinCode}
          capacity={state?.meta?.capacity ?? 80}
          teams={teamOptions}
          requests={requests}
          participants={participants}
          mode={mode}
          onModeChange={setMode}
          onCopyJoinCode={() => void navigator.clipboard.writeText(joinCode).then(() => setNotice('参加コードをコピーしました。'))}
          onApprove={(id, manualTeamId) => void approveJoinRequest(services.database, marketId, id, mode, manualTeamId).then((ok) => setNotice(ok ? '参加を承認しました。' : '承認できませんでした。定員か、生徒の接続を確認してください。'))}
          onReject={(id) => void rejectJoinRequest(services.database, marketId, id).then(() => setNotice('申請を却下しました。'))}
          onRemove={(id) => { if (window.confirm('この生徒を市場から退出させますか？チームの資産はそのまま残ります。')) void removeParticipant(services.database, marketId, id).then(() => setNotice('退出させました。')) }}
          onReassign={(id, teamId) => void reassignParticipantTeam(services.database, marketId, id, teamId).then((ok) => setNotice(ok ? 'チームを変更しました。' : 'チームを変更できませんでした。'))}
        />
```

- [ ] **Step 3: 市場一覧から承認画面へ戻れるようにする**

54行目の `template-list` 内、各 `<div className="template-actions">` の先頭に追加する。

```tsx
<button type="button" onClick={() => { setMarketId(market.id); setJoinCode(market.joinCode) }}>参加を承認</button>
```

- [ ] **Step 4: ホスト画面に同じパネルを載せる**

`src/components/HostConsole.tsx` の import に追加する。

```tsx
import { onValue, ref } from 'firebase/database'
import { AdmissionPanel } from './teacher/AdmissionPanel'
import { approveJoinRequest, reassignParticipantTeam, rejectJoinRequest, removeParticipant } from '../lib/market/marketRepository'
import type { LiveMarketState, TeamAssignmentMode } from '../lib/market/liveMarketTypes'
```

13行目の state 宣言の直後に追加する。

```tsx
  const [live, setLive] = useState<LiveMarketState | null>(null)
  const [mode, setMode] = useState<TeamAssignmentMode>('random')
  useEffect(() => onValue(ref(services.database, `liveMarkets/${marketId}`), (snapshot) => setLive(snapshot.val() as LiveMarketState | null)), [marketId, services.database])
```

25行目の `<section className="host-workspace">` の中、`</section>` の直前（`</aside>` の後ろ）に追加する。

```tsx
    <AdmissionPanel
      joinCode={live?.meta?.joinCode ?? ''}
      capacity={live?.meta?.capacity ?? 80}
      teams={Object.values(live?.teams ?? {}).map((team) => ({ id: team.id, name: team.name }))}
      requests={Object.entries(live?.joinRequests ?? {}).filter(([id, request]) => request.connected && !live?.participants?.[id]).map(([id, request]) => ({ id, displayName: request.displayName, requestedTeamId: request.requestedTeamId }))}
      participants={Object.entries(live?.participants ?? {}).map(([id, participant]) => ({ id, displayName: participant.displayName, teamId: participant.teamId, connected: participant.connected }))}
      mode={mode}
      onModeChange={setMode}
      onCopyJoinCode={() => void navigator.clipboard.writeText(live?.meta?.joinCode ?? '').then(() => setNotice('参加コードをコピーしました。'))}
      onApprove={(id, manualTeamId) => void approveJoinRequest(services.database, marketId, id, mode, manualTeamId).then((ok) => setNotice(ok ? '参加を承認しました。' : '承認できませんでした。'))}
      onReject={(id) => void rejectJoinRequest(services.database, marketId, id).then(() => setNotice('申請を却下しました。'))}
      onRemove={(id) => { if (window.confirm('この生徒を市場から退出させますか？チームの資産はそのまま残ります。')) void removeParticipant(services.database, marketId, id).then(() => setNotice('退出させました。')) }}
      onReassign={(id, teamId) => void reassignParticipantTeam(services.database, marketId, id, teamId).then((ok) => setNotice(ok ? 'チームを変更しました。' : 'チームを変更できませんでした。'))}
    />
```

- [ ] **Step 5: 自動検証を通す**

Run: `npm run lint && npm run typecheck && npm test`
Expected: すべて PASS

- [ ] **Step 6: エミュレータで手動確認する**

```bash
firebase emulators:start --only firestore,database,auth
```

別ターミナルで `npm run dev`。教師でログインし、市場を作成 → **ブラウザをリロード** → 参加承認パネルが残っていること、`/teacher/markets/{id}/host` にも同じパネルがあること、生徒を承認・却下・チーム変更・退出できることを確認する。

- [ ] **Step 7: コミット**

```bash
git add src/components && git commit -m "feat: keep the admission panel reachable after a reload and on the host console"
```

---

## Task 6: 生徒の復帰コード UI

**Files:**
- Modify: `src/components/MarketDashboard.tsx:57-65`（`StudentMarketJoin`）
- Modify: `src/components/student/StudentMarketPage.tsx`
- Test: 手動確認

**Interfaces:**
- Consumes: `requestToJoinMarket`（Task 3 で `recoveryCode` 対応済み）、`joinRequests/{id}/recoveryCode`
- Produces: 生徒画面に常時「復帰コード」が表示され、`/join` でそれを入力して再参加できる

- [ ] **Step 1: 参加フォームに復帰コード欄を足す**

`src/components/MarketDashboard.tsx:59` の state 宣言に追加する。

```tsx
  const [recoveryCode, setRecoveryCode] = useState('')
```

`join`（63行目）の `requestToJoinMarket` 呼び出しを差し替える。

```tsx
      const id = await requestToJoinMarket(services.database, resolved, { uid, sessionId: getStudentSessionId(), displayName: displayName.trim(), requestedTeamId: null, ...(recoveryCode.trim() ? { recoveryCode: recoveryCode.trim().toUpperCase() } : {}) })
```

64行目の `<label>表示名…</label>` の直後に追加する。

```tsx
<label>復帰コード（前に使っていた端末で見た4文字。初めての人は空のまま）<input value={recoveryCode} maxLength={4} placeholder="例: A1B2" onChange={(event) => setRecoveryCode(event.target.value.toUpperCase())} disabled={status === 'waiting' || status === 'requesting'} /></label>
```

- [ ] **Step 2: 生徒画面に復帰コードを常時表示する**

`src/components/student/StudentMarketPage.tsx` の state 群（29行目付近）に追加する。

```tsx
  const [recoveryCode, setRecoveryCode] = useState('')
```

`participantKey` を使う購読 effect（39〜55行目）の直後に追加する。

```tsx
  // Shown for the whole lesson: it is the only way back in from a different
  // device, and a student who has lost their tab cannot be told it afterwards.
  useEffect(() => {
    if (!sessionValid || !active?.requestId) return
    return onValue(ref(services.database, `liveMarkets/${marketId}/joinRequests/${active.requestId}/recoveryCode`), (snapshot) => setRecoveryCode(String(snapshot.val() ?? '')))
  }, [active?.requestId, marketId, services.database, sessionValid])
```

92行目の `student-market-summary` セクションに、現金表示の隣へ追加する。

```tsx
<div className="recovery-code"><span>復帰コード</span><strong>{recoveryCode || '—'}</strong><small>端末を替えるときに使います</small></div>
```

- [ ] **Step 3: スタイルを足す**

`src/App.css` の末尾に追加する。

```css
.recovery-code { display: flex; flex-direction: column; gap: 0.15rem; }
.recovery-code strong { font-size: 1.4rem; letter-spacing: 0.28em; font-variant-numeric: tabular-nums; }
.recovery-code small { opacity: 0.7; }
```

- [ ] **Step 4: 自動検証を通す**

Run: `npm run lint && npm run typecheck && npm test`
Expected: すべて PASS

- [ ] **Step 5: エミュレータで往復を確認する**

`npm run dev` で、生徒として参加 → 表示された復帰コードを控える → **localStorage を消して**（DevTools の Application → Local Storage → Clear）別のシークレットウィンドウで `/join` から参加コード＋復帰コードで再参加 → 教師が承認 → 同じチームに戻り、チームの現金・保有株がそのままであることを確認する。

- [ ] **Step 6: コミット**

```bash
git add src/components src/App.css && git commit -m "feat: show students their recovery code and accept it when rejoining"
```

---

## Task 7: 結果を CSV で持ち出せるようにする

削除が即完全消去なのに、成績データを取り出す手段が Firebase Console しかない。

**Files:**
- Create: `src/lib/teacher/resultsExport.ts`
- Test: `src/lib/teacher/resultsExport.test.ts`
- Modify: `src/lib/market/hostTrading.ts:173-178`（結果に `displayName` を残す）
- Modify: `src/components/MarketDashboard.tsx:54`

**Interfaces:**
- Consumes: `OrderResult`, `TeamLeaderboardEntry`（`src/lib/market/liveMarketTypes.ts`）、`marketResults/{marketId}/{teams,participants}`
- Produces:
  - `toCsv(rows: string[][]): string`
  - `buildTeamCsv(teams: ExportedTeamResult[], companyNames: Record<string, string>): string`
  - `buildTransactionCsv(participants: ExportedParticipantResult[], companyNames: Record<string, string>): string`
  - `fetchMarketResults(firestore, marketId): Promise<{ teams: ExportedTeamResult[]; participants: ExportedParticipantResult[] }>`
  - `downloadCsv(filename: string, csv: string): void`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/teacher/resultsExport.test.ts` を新規作成する。

```ts
import { describe, expect, it } from 'vitest'
import { buildTeamCsv, buildTransactionCsv, toCsv } from './resultsExport'

describe('csv encoding', () => {
  it('quotes fields containing separators, quotes or newlines', () => {
    expect(toCsv([['a', 'b,c', 'd"e', 'f\ng']])).toBe('a,"b,c","d""e","f\ng"')
  })
  it('joins rows with CRLF so Excel opens them cleanly', () => {
    expect(toCsv([['a'], ['b']])).toBe('a\r\nb')
  })
})

const teams = [
  { teamId: 'red', portfolio: { cash: 8000, holdings: { acme: 5 } }, leaderboard: { teamId: 'red', name: '赤', valuation: 8500, rank: 1 } },
  { teamId: 'blue', portfolio: { cash: 10000, holdings: {} }, leaderboard: null },
]

describe('team result csv', () => {
  it('lists rank, valuation, cash and each holding by company name', () => {
    expect(buildTeamCsv(teams, { acme: 'アクメ' })).toBe([
      '順位,チーム名,最終評価額,現金,アクメ',
      '1,赤,8500,8000,5',
      ',blue,,10000,0',
    ].join('\r\n'))
  })
})

const participants = [{
  participantId: 'u1_s', displayName: '山田', teamId: 'red',
  transactions: {
    o2: { orderId: 'o2', participantId: 'u1_s', teamId: 'red', stockId: 'acme', side: 'SELL' as const, requestedQuantity: 3, filledQuantity: 1, price: 120, processedAtMillis: 2_000 },
    o1: { orderId: 'o1', participantId: 'u1_s', teamId: 'red', stockId: 'acme', side: 'BUY' as const, requestedQuantity: 6, filledQuantity: 6, price: 100, processedAtMillis: 1_000 },
  },
}]

describe('transaction csv', () => {
  it('orders every trade by time and records both requested and filled quantities', () => {
    const rows = buildTransactionCsv(participants, { acme: 'アクメ' }).split('\r\n')
    expect(rows[0]).toBe('約定時刻,生徒名,チーム,銘柄,売買,注文数,約定数,約定価格,約定金額')
    expect(rows[1]).toContain('山田,red,アクメ,購入,6,6,100,600')
    expect(rows[2]).toContain('山田,red,アクメ,売却,3,1,120,120')
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/teacher/resultsExport.test.ts`
Expected: FAIL — `Failed to resolve import "./resultsExport"`

- [ ] **Step 3: 実装する**

`src/lib/teacher/resultsExport.ts` を新規作成する。

```ts
import { collection, getDocs, type Firestore } from 'firebase/firestore'
import type { OrderResult, TeamLeaderboardEntry } from '../market/liveMarketTypes'

export interface ExportedTeamResult {
  teamId: string
  portfolio: { cash: number; holdings?: Record<string, number> }
  leaderboard: TeamLeaderboardEntry | null
}
export interface ExportedParticipantResult {
  participantId: string
  displayName?: string
  teamId: string | null
  transactions?: Record<string, OrderResult>
}

const escapeField = (value: string) => /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
/** CRLF and RFC 4180 quoting: Excel is the only tool most teachers will open this in. */
export const toCsv = (rows: string[][]): string => rows.map((row) => row.map(escapeField).join(',')).join('\r\n')

export const buildTeamCsv = (teams: ExportedTeamResult[], companyNames: Record<string, string>): string => {
  const stockIds = Object.keys(companyNames)
  const header = ['順位', 'チーム名', '最終評価額', '現金', ...stockIds.map((id) => companyNames[id])]
  const rows = [...teams]
    .sort((a, b) => (a.leaderboard?.rank ?? Number.MAX_SAFE_INTEGER) - (b.leaderboard?.rank ?? Number.MAX_SAFE_INTEGER))
    .map((team) => [
      team.leaderboard ? String(team.leaderboard.rank) : '',
      team.leaderboard?.name ?? team.teamId,
      team.leaderboard ? String(team.leaderboard.valuation) : '',
      String(team.portfolio.cash),
      ...stockIds.map((id) => String(team.portfolio.holdings?.[id] ?? 0)),
    ])
  return toCsv([header, ...rows])
}

const formatTime = (millis: number) => new Date(millis).toLocaleString('ja-JP', { hour12: false })

export const buildTransactionCsv = (participants: ExportedParticipantResult[], companyNames: Record<string, string>): string => {
  const header = ['約定時刻', '生徒名', 'チーム', '銘柄', '売買', '注文数', '約定数', '約定価格', '約定金額']
  const rows = participants
    .flatMap((participant) => Object.values(participant.transactions ?? {}).map((transaction) => ({ participant, transaction })))
    .sort((a, b) => a.transaction.processedAtMillis - b.transaction.processedAtMillis)
    .map(({ participant, transaction }) => [
      formatTime(transaction.processedAtMillis),
      participant.displayName ?? participant.participantId,
      participant.teamId ?? '',
      companyNames[transaction.stockId] ?? transaction.stockId,
      transaction.side === 'BUY' ? '購入' : '売却',
      String(transaction.requestedQuantity),
      String(transaction.filledQuantity),
      String(transaction.price),
      String(transaction.filledQuantity * transaction.price),
    ])
  return toCsv([header, ...rows])
}

export const fetchMarketResults = async (firestore: Firestore, marketId: string) => {
  const [teamDocs, participantDocs] = await Promise.all([
    getDocs(collection(firestore, 'marketResults', marketId, 'teams')),
    getDocs(collection(firestore, 'marketResults', marketId, 'participants')),
  ])
  return {
    teams: teamDocs.docs.map((item) => item.data() as ExportedTeamResult),
    participants: participantDocs.docs.map((item) => item.data() as ExportedParticipantResult),
  }
}

/** The BOM is what makes Excel read the Japanese headers as UTF-8 rather than Shift_JIS. */
export const downloadCsv = (filename: string, csv: string) => {
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 4: 通ることを確認する**

Run: `npx vitest run src/lib/teacher/resultsExport.test.ts`
Expected: PASS（5件）

- [ ] **Step 5: 結果ドキュメントに生徒名を残す**

`src/lib/market/hostTrading.ts:173-178` の `participantWrites` を差し替える。CSV に名前を出せるようにするための一行追加。

```ts
  const participantWrites = Object.entries(snapshot.participants ?? {}).map(([participantId, participant]) =>
    setDoc(doc(firestore, 'marketResults', marketId, 'participants', participantId), {
      ownerUid, checkpointId: checkpoint, participantId, participantUid: participant.uid, teamId: participant.teamId,
      // Carried into the result so the teacher's CSV names a student, not a UID.
      displayName: participant.displayName,
      teamResult: participant.teamId ? leaderboard[participant.teamId] ?? null : null,
      transactions: snapshot.transactions?.[participantId] ?? {}, finalizedAtMillis: atMillis,
    }))
```

- [ ] **Step 6: ダッシュボードに保存ボタンを足す**

`src/components/MarketDashboard.tsx` の import に追加する。

```tsx
import { buildTeamCsv, buildTransactionCsv, downloadCsv, fetchMarketResults } from '../lib/teacher/resultsExport'
```

`removeMarket`（46行目）の直前に追加する。

```tsx
  const exportResults = async (market: MarketRecord) => {
    const companyNames = Object.fromEntries(market.templateSnapshot.companies.map((company) => [company.id, company.name]))
    const { teams, participants } = await fetchMarketResults(services.firestore, market.id)
    if (!teams.length && !participants.length) return setNotice('この市場にはまだ確定した結果がありません。市場を終了してからお試しください。')
    const stamp = market.templateSnapshot.title.replace(/[^\p{L}\p{N}]+/gu, '_')
    downloadCsv(`${stamp}_チーム結果.csv`, buildTeamCsv(teams, companyNames))
    downloadCsv(`${stamp}_取引履歴.csv`, buildTransactionCsv(participants, companyNames))
    setNotice('結果を CSV で保存しました。')
  }
```

`removeMarket` の確認文言を差し替える（47行目）。

```tsx
    if (!user || !window.confirm(`市場「${market.templateSnapshot.title}」を削除しますか？結果・取引履歴・参加コードがすべて消え、元に戻せません。必要なら先に「結果をCSVで保存」してください。`)) return
```

`template-actions`（54行目）に、`削除` ボタンの直前へ追加する。

```tsx
<button type="button" onClick={() => void exportResults(market).catch(() => setNotice('結果を読み込めませんでした。'))}>結果をCSVで保存</button>
```

- [ ] **Step 7: 自動検証を通す**

Run: `npm run lint && npm run typecheck && npm test && npm run test:rules`
Expected: すべて PASS

- [ ] **Step 8: コミット**

```bash
git add src/lib src/components && git commit -m "feat: export market results and trade history as csv"
```

---

## Task 8: ホストのタブが裏に回ったことを検知して警告する

進行は教師のタブの `setInterval` に完全依存している（`src/components/HostConsole.tsx:21`）。Spark のままでは根本解決できないので、**気づけない状態をなくす**。

**Files:**
- Create: `src/lib/host/hostContinuity.ts`
- Test: `src/lib/host/hostContinuity.test.ts`
- Modify: `src/components/HostConsole.tsx`

**Interfaces:**
- Consumes: なし
- Produces:
  - `useDocumentHidden(): boolean`
  - `useHiddenSince(active: boolean): number | null` — 非表示になった時刻。表示中は `null`
  - `useWakeLock(active: boolean): void`
  - `useUnloadWarning(active: boolean): void`
  - `describeInterruption(hiddenSinceMillis: number, nowMillis: number): string`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/host/hostContinuity.test.ts` を新規作成する。

```ts
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeInterruption, useDocumentHidden } from './hostContinuity'

const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' })
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  document.dispatchEvent(new Event('visibilitychange'))
}

afterEach(() => { setHidden(false); vi.restoreAllMocks() })

describe('useDocumentHidden', () => {
  it('tracks visibility changes', () => {
    const { result } = renderHook(() => useDocumentHidden())
    expect(result.current).toBe(false)
    act(() => setHidden(true))
    expect(result.current).toBe(true)
    act(() => setHidden(false))
    expect(result.current).toBe(false)
  })
})

describe('describeInterruption', () => {
  it('reports the interruption in whole seconds and minutes', () => {
    expect(describeInterruption(0, 8_000)).toBe('8秒')
    expect(describeInterruption(0, 95_000)).toBe('1分35秒')
    expect(describeInterruption(0, 600_000)).toBe('10分0秒')
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/host/hostContinuity.test.ts`
Expected: FAIL — `Failed to resolve import "./hostContinuity"`

- [ ] **Step 3: 実装する**

`src/lib/host/hostContinuity.ts` を新規作成する。

```ts
import { useEffect, useRef, useState } from 'react'

/**
 * The market only advances while the host tab is foregrounded: browsers throttle
 * setInterval to roughly once a minute in a background tab, and the lease expires
 * after 15 seconds. These hooks exist so the teacher can never be unaware of that.
 */
export const useDocumentHidden = (): boolean => {
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden')
  useEffect(() => {
    const update = () => setHidden(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return hidden
}

/** Timestamp the tab was last backgrounded while hosting, or null while it is visible. */
export const useHiddenSince = (active: boolean): number | null => {
  const hidden = useDocumentHidden()
  const [since, setSince] = useState<number | null>(null)
  const wasHidden = useRef(false)
  useEffect(() => {
    if (!active) { setSince(null); wasHidden.current = false; return }
    if (hidden && !wasHidden.current) { wasHidden.current = true; setSince(Date.now()) }
    if (!hidden) wasHidden.current = false
  }, [active, hidden])
  return hidden ? since : null
}

export const describeInterruption = (hiddenSinceMillis: number, nowMillis: number): string => {
  const seconds = Math.max(0, Math.round((nowMillis - hiddenSinceMillis) / 1000))
  return seconds < 60 ? `${seconds}秒` : `${Math.floor(seconds / 60)}分${seconds % 60}秒`
}

/** Keeps the laptop screen awake so the lesson does not stop when the teacher steps away. */
export const useWakeLock = (active: boolean) => {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return
    let sentinel: WakeLockSentinel | undefined
    let released = false
    const request = async () => {
      try { sentinel = await navigator.wakeLock.request('screen') } catch { /* denied or unsupported; the banner still warns */ }
    }
    const reacquire = () => { if (!released && document.visibilityState === 'visible') void request() }
    void request()
    document.addEventListener('visibilitychange', reacquire)
    return () => { released = true; document.removeEventListener('visibilitychange', reacquire); void sentinel?.release().catch(() => undefined) }
  }, [active])
}

export const useUnloadWarning = (active: boolean) => {
  useEffect(() => {
    if (!active) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [active])
}
```

- [ ] **Step 4: 通ることを確認する**

Run: `npx vitest run src/lib/host/hostContinuity.test.ts`
Expected: PASS（4件）

- [ ] **Step 5: ホスト画面に配線する**

`src/components/HostConsole.tsx` の import に追加する。

```tsx
import { describeInterruption, useHiddenSince, useUnloadWarning, useWakeLock } from '../lib/host/hostContinuity'
```

state 宣言の直後に追加する。

```tsx
  const [resumedAfter, setResumedAfter] = useState('')
  const hiddenSince = useHiddenSince(Boolean(lease))
  useWakeLock(Boolean(lease))
  useUnloadWarning(Boolean(lease))
  // Reported on return, because a backgrounded tab cannot show anything.
  useEffect(() => {
    if (hiddenSince === null) return
    return () => setResumedAfter(describeInterruption(hiddenSince, Date.now()))
  }, [hiddenSince])
```

`host-workspace` セクションの `{offline && …}` の直後に追加する。

```tsx
{lease && resumedAfter && <p className="form-notice stopped" role="alert"><strong>{resumedAfter}のあいだ、市場の進行が止まっていた可能性があります。</strong>このタブが裏に回っている間、価格の更新と生徒の売買は処理されません。授業中はこのタブを前面に置いたままにしてください。<button type="button" className="outline-button" onClick={() => setResumedAfter('')}>確認しました</button></p>}
{lease && <p className="form-notice" role="status">このタブを閉じたり、別のアプリで隠したり、パソコンをスリープさせると市場が止まります。授業のあいだは開いたままにしてください。</p>}
```

- [ ] **Step 6: 自動検証を通す**

Run: `npm run lint && npm run typecheck && npm test`
Expected: すべて PASS

- [ ] **Step 7: 手動確認**

`npm run dev` でホストを取得し、別タブに切り替えて 30 秒待ってから戻る。「30秒のあいだ、市場の進行が止まっていた可能性があります」が出ること、タブを閉じようとすると確認ダイアログが出ることを確認する。

- [ ] **Step 8: コミット**

```bash
git add src/lib/host src/components/HostConsole.tsx && git commit -m "feat: warn the host when the market stops advancing"
```

---

# フェーズ 2 — 運用の質を上げる

## Task 9: ホスト画面に進行状況を出す

いまは開始・終了ボタンとニュース欄だけで、価格も経過時間も参加者数も見えない。

**Files:**
- Create: `src/components/teacher/HostStatusPanel.tsx`
- Test: `src/components/teacher/HostStatusPanel.test.tsx`
- Modify: `src/components/HostConsole.tsx`

**Interfaces:**
- Consumes: `MarketStatus`（`src/lib/market/liveMarketTypes.ts:2`）、`describeInterruption` は使わない
- Produces: `HostStatusPanel`, `HostStatusPanelProps`, `describeElapsed(openedAtMillis: number | undefined, nowMillis: number): string`

- [ ] **Step 1: 失敗するテストを書く**

`src/components/teacher/HostStatusPanel.test.tsx` を新規作成する。

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HostStatusPanel, describeElapsed } from './HostStatusPanel'

describe('describeElapsed', () => {
  it('counts from the market opening in minutes and seconds', () => {
    expect(describeElapsed(undefined, 1_000)).toBe('未開始')
    expect(describeElapsed(0, 5_000)).toBe('0分05秒')
    expect(describeElapsed(0, 125_000)).toBe('2分05秒')
  })
})

describe('HostStatusPanel', () => {
  const props = {
    status: 'OPEN' as const,
    openedAtMillis: 0,
    nowMillis: 90_000,
    participantCount: 12,
    capacity: 80,
    pendingOrderCount: 3,
    prices: [{ stockId: 'acme', name: 'アクメ', symbol: 'ACME', price: 512, basePrice: 500 }],
    lastTickAtMillis: 89_000,
  }

  it('shows the elapsed time, participants and unprocessed orders', () => {
    render(<HostStatusPanel {...props} />)
    expect(screen.getByText('1分30秒')).toBeInTheDocument()
    expect(screen.getByText('12 / 80')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows each price with its change against the starting price', () => {
    render(<HostStatusPanel {...props} />)
    expect(screen.getByText('512')).toBeInTheDocument()
    expect(screen.getByText('+2.4%')).toBeInTheDocument()
  })

  it('warns when the last tick is stale', () => {
    render(<HostStatusPanel {...props} lastTickAtMillis={60_000} />)
    expect(screen.getByRole('alert')).toHaveTextContent('30秒間更新されていません')
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/components/teacher/HostStatusPanel.test.tsx`
Expected: FAIL — `Failed to resolve import "./HostStatusPanel"`

- [ ] **Step 3: 実装する**

`src/components/teacher/HostStatusPanel.tsx` を新規作成する。

```tsx
import type { MarketStatus } from '../../lib/market/liveMarketTypes'

export interface HostStatusPanelProps {
  status: MarketStatus
  openedAtMillis?: number
  nowMillis: number
  participantCount: number
  capacity: number
  pendingOrderCount: number
  prices: { stockId: string; name: string; symbol: string; price: number; basePrice: number }[]
  lastTickAtMillis?: number
}

const STATUS_LABEL: Record<MarketStatus, string> = { SETUP: '準備中', OPEN: '取引中', ENDING: '結果を確定中', ENDED: '終了' }
/** Anything beyond a few ticks means the host loop is not running. */
const STALE_TICK_MS = 10_000

export const describeElapsed = (openedAtMillis: number | undefined, nowMillis: number): string => {
  if (openedAtMillis === undefined) return '未開始'
  const seconds = Math.max(0, Math.floor((nowMillis - openedAtMillis) / 1000))
  return `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, '0')}秒`
}

const changeLabel = (price: number, basePrice: number) => {
  const percent = basePrice > 0 ? ((price - basePrice) / basePrice) * 100 : 0
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`
}

export function HostStatusPanel({ status, openedAtMillis, nowMillis, participantCount, capacity, pendingOrderCount, prices, lastTickAtMillis }: HostStatusPanelProps) {
  const staleFor = lastTickAtMillis === undefined ? 0 : nowMillis - lastTickAtMillis
  return (
    <section className="host-status-panel">
      <p className="section-kicker">MARKET STATUS</p>
      {staleFor > STALE_TICK_MS && <p className="form-notice stopped" role="alert">価格が{Math.floor(staleFor / 1000)}秒間更新されていません。ホスト権限が失効しているか、通信が切れています。</p>}
      <div className="host-status-grid">
        <div><span>状態</span><strong>{STATUS_LABEL[status]}</strong></div>
        <div><span>経過時間</span><strong>{describeElapsed(openedAtMillis, nowMillis)}</strong></div>
        <div><span>参加者</span><strong>{participantCount} / {capacity}</strong></div>
        <div><span>未処理の注文</span><strong>{pendingOrderCount}</strong></div>
      </div>
      <table className="host-price-table">
        <caption className="visually-hidden">現在の株価</caption>
        <thead><tr><th scope="col">銘柄</th><th scope="col">現在値</th><th scope="col">開始比</th></tr></thead>
        <tbody>{prices.map((entry) => (
          <tr key={entry.stockId}>
            <th scope="row">{entry.name} <small>{entry.symbol}</small></th>
            <td>{entry.price}</td>
            <td className={entry.price >= entry.basePrice ? 'up' : 'down'}>{changeLabel(entry.price, entry.basePrice)}</td>
          </tr>
        ))}</tbody>
      </table>
    </section>
  )
}
```

- [ ] **Step 4: 通ることを確認する**

Run: `npx vitest run src/components/teacher/HostStatusPanel.test.tsx`
Expected: PASS（5件）

- [ ] **Step 5: ホスト画面に配線する**

`src/components/HostConsole.tsx` の import に追加する。

```tsx
import { HostStatusPanel } from './teacher/HostStatusPanel'
```

state 宣言の直後に、毎秒進む時計と最終 tick 時刻を足す。

```tsx
  const [nowMillis, setNowMillis] = useState(() => Date.now())
  const [lastTickAtMillis, setLastTickAtMillis] = useState<number>()
  useEffect(() => { const timer = window.setInterval(() => setNowMillis(Date.now()), 1_000); return () => window.clearInterval(timer) }, [])
```

18〜22行目の tick effect のうち `tick` の定義を差し替え、成功した時刻を記録する。

```tsx
    const tick = () => void runHostTick(services.firestore, services.database, marketId, user.uid, lease, stocks)
      .then((ok) => { if (ok) setLastTickAtMillis(Date.now()); else { setLease(''); setNotice('ホストリースが失効しました。もう一度「ホストを取得する」を押してください。') } })
      .catch((error) => setNotice(handleFailure(error, 'ホスト処理を再試行しています。')))
```

（`handleFailure` は Task 14 で導入する。Task 14 より先にこのタスクを実施する場合は、いったん `.catch(() => setNotice('ホスト処理を再試行しています。'))` のままにしておく。）

`<section className="host-workspace">` の中、`host-main-card` の直前に追加する。

```tsx
<HostStatusPanel
  status={live?.meta?.status ?? 'SETUP'}
  openedAtMillis={live?.meta?.openedAtMillis}
  nowMillis={nowMillis}
  participantCount={Object.values(live?.participants ?? {}).filter((participant) => participant.connected).length}
  capacity={live?.meta?.capacity ?? 80}
  pendingOrderCount={Object.values(live?.orders ?? {}).filter((entry) => entry.pending).length}
  prices={(template?.companies ?? []).map((company) => ({ stockId: company.id, name: company.name, symbol: company.symbol, price: live?.prices?.[company.id]?.price ?? company.initialPrice, basePrice: company.initialPrice }))}
  lastTickAtMillis={lastTickAtMillis}
/>
```

- [ ] **Step 6: スタイルを足す**

`src/App.css` の末尾に追加する。

```css
.host-status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr)); gap: 0.75rem; }
.host-status-grid div { display: flex; flex-direction: column; }
.host-status-grid strong { font-size: 1.35rem; font-variant-numeric: tabular-nums; }
.host-price-table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
.host-price-table th, .host-price-table td { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid rgba(128, 128, 128, 0.25); font-variant-numeric: tabular-nums; }
.host-price-table .up { color: #0a7a3d; }
.host-price-table .down { color: #b3261e; }
```

- [ ] **Step 7: 自動検証を通す**

Run: `npm run lint && npm run typecheck && npm test`
Expected: すべて PASS

- [ ] **Step 8: コミット**

```bash
git add src/components src/App.css && git commit -m "feat: show market status, prices and tick health on the host console"
```

---

## Task 10: 注文の上限クランプ・確認ステップ・送信中表示

`src/components/student/TradePanel.tsx:17` は `qty > 0` しか見ておらず、残高も保有株も参照していない。桁を間違えると 100,000 株まで通る。

**Files:**
- Modify: `src/components/student/TradePanel.tsx`
- Test: `src/components/student/TradePanel.test.tsx`
- Modify: `src/components/student/StudentMarketPage.tsx:96`

**Interfaces:**
- Consumes: `OrderResult`
- Produces: `TradePanelProps` に `cash: number`, `holding: number`, `pending?: boolean` を追加

- [ ] **Step 1: 失敗するテストを書く**

`src/components/student/TradePanel.test.tsx` の末尾に追加する。既存テストの props に `cash={100000} holding={0}` を補う必要があるので、そこも合わせて直す。

```tsx
describe('order safety', () => {
  const base = { stockName: 'アクメ (ACME)', currentPrice: 100, latestResult: null, cash: 550, holding: 3 }

  it('shows how many shares are affordable and how many are held', () => {
    render(<TradePanel {...base} onSubmitOrder={vi.fn()} />)
    expect(screen.getByText('買える数 5株')).toBeInTheDocument()
    expect(screen.getByText('売れる数 3株')).toBeInTheDocument()
  })

  it('requires a confirmation before sending a buy order', async () => {
    const onSubmitOrder = vi.fn()
    render(<TradePanel {...base} onSubmitOrder={onSubmitOrder} />)
    await userEvent.type(screen.getByLabelText('数量'), '4')
    await userEvent.click(screen.getByRole('button', { name: '購入' }))
    expect(onSubmitOrder).not.toHaveBeenCalled()
    expect(screen.getByText('アクメ (ACME) を 4株、約 400円で購入します。よろしいですか？')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'この内容で注文する' }))
    expect(onSubmitOrder).toHaveBeenCalledWith('BUY', 4)
  })

  it('lets the student cancel before the order is sent', async () => {
    const onSubmitOrder = vi.fn()
    render(<TradePanel {...base} onSubmitOrder={onSubmitOrder} />)
    await userEvent.type(screen.getByLabelText('数量'), '2')
    await userEvent.click(screen.getByRole('button', { name: '売却' }))
    await userEvent.click(screen.getByRole('button', { name: 'やめる' }))
    expect(onSubmitOrder).not.toHaveBeenCalled()
    expect(screen.queryByText(/よろしいですか/)).not.toBeInTheDocument()
  })

  it('refuses a quantity beyond the affordable amount', async () => {
    const onSubmitOrder = vi.fn()
    render(<TradePanel {...base} onSubmitOrder={onSubmitOrder} />)
    await userEvent.type(screen.getByLabelText('数量'), '9')
    await userEvent.click(screen.getByRole('button', { name: '購入' }))
    expect(onSubmitOrder).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('いまの現金では5株までです。')
  })

  it('refuses selling more than the team holds', async () => {
    const onSubmitOrder = vi.fn()
    render(<TradePanel {...base} onSubmitOrder={onSubmitOrder} />)
    await userEvent.type(screen.getByLabelText('数量'), '5')
    await userEvent.click(screen.getByRole('button', { name: '売却' }))
    expect(onSubmitOrder).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('持っているのは3株です。')
  })

  it('reports that an order is in flight', () => {
    render(<TradePanel {...base} onSubmitOrder={vi.fn()} pending />)
    expect(screen.getByText('注文を送信中…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '購入' })).toBeDisabled()
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/components/student/TradePanel.test.tsx`
Expected: FAIL — 新規6件が「買える数」等を見つけられずに落ちる。

- [ ] **Step 3: 実装する**

`src/components/student/TradePanel.tsx` を全面的に差し替える。

```tsx
import { useState } from 'react'
import type { OrderResult } from '../../lib/market/liveMarketTypes'

interface TradePanelProps {
  stockName: string
  currentPrice: number
  onSubmitOrder: (side: 'BUY' | 'SELL', quantity: number) => void
  latestResult: OrderResult | null
  /** Team cash and holdings, so a mistyped digit is caught before it is sent. */
  cash: number
  holding: number
  disabled?: boolean
  pending?: boolean
}

export function TradePanel({ stockName, currentPrice, onSubmitOrder, latestResult, cash, holding, disabled = false, pending = false }: TradePanelProps) {
  const [quantity, setQuantity] = useState<number | string>('')
  const [confirming, setConfirming] = useState<'BUY' | 'SELL' | null>(null)
  const [error, setError] = useState('')
  const affordable = currentPrice > 0 ? Math.floor(cash / currentPrice) : 0
  const requested = Math.floor(Number(quantity))

  const review = (side: 'BUY' | 'SELL') => {
    setConfirming(null)
    if (!Number.isInteger(requested) || requested < 1) return setError('数量を1株以上の整数で入力してください。')
    if (side === 'BUY' && requested > affordable) return setError(`いまの現金では${affordable}株までです。`)
    if (side === 'SELL' && requested > holding) return setError(`持っているのは${holding}株です。`)
    setError('')
    setConfirming(side)
  }
  const send = () => {
    if (!confirming) return
    onSubmitOrder(confirming, requested)
    setConfirming(null)
    setQuantity('')
  }

  return (
    <div className="trade-panel">
      <div className="trade-head">
        <span>{stockName}</span>
        <span className="trade-price">{currentPrice}</span>
      </div>

      <div className="trade-limits">
        <span>買える数 {affordable}株</span>
        <span>売れる数 {holding}株</span>
      </div>

      <div>
        <label htmlFor="quantity">数量</label>
        <input
          id="quantity"
          type="number"
          inputMode="numeric"
          min={1}
          max={100000}
          step={1}
          value={quantity}
          onChange={(event) => { setQuantity(event.target.value); setConfirming(null); setError('') }}
        />
      </div>

      <div className="trade-actions">
        <button type="button" disabled={disabled || pending} onClick={() => review('BUY')}>購入</button>
        <button type="button" disabled={disabled || pending} onClick={() => review('SELL')}>売却</button>
      </div>

      {error && <p className="student-message error" role="alert">{error}</p>}
      {pending && <p className="student-message" role="status">注文を送信中…</p>}

      {confirming && (
        <div className="trade-confirm" role="dialog" aria-label="注文の確認">
          <p>{stockName} を {requested}株、約 {(requested * currentPrice).toLocaleString()}円で{confirming === 'BUY' ? '購入' : '売却'}します。よろしいですか？</p>
          <p className="trade-note">価格は毎秒動きます。実際の約定価格は少し変わることがあります。</p>
          <button type="button" onClick={send}>この内容で注文する</button>
          <button type="button" className="outline-button" onClick={() => setConfirming(null)}>やめる</button>
        </div>
      )}

      {latestResult && latestResult.filledQuantity > 0 && latestResult.filledQuantity < latestResult.requestedQuantity && (
        <p className="student-message" role="status">{latestResult.requestedQuantity}株のうち{latestResult.filledQuantity}株が{latestResult.price}円で約定しました。</p>
      )}
      {latestResult && latestResult.filledQuantity === latestResult.requestedQuantity && latestResult.filledQuantity > 0 && (
        <p className="student-message" role="status">{latestResult.filledQuantity}株を{latestResult.price}円で約定しました。</p>
      )}
      {latestResult && latestResult.filledQuantity === 0 && (
        <p className="student-message error" role="status">約定できませんでした。現金か保有株が足りません。</p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: 既存テストの props を補う**

`src/components/student/TradePanel.test.tsx` の既存 `render(<TradePanel … />)` すべてに `cash={100000} holding={100}` を足す。

- [ ] **Step 5: 通ることを確認する**

Run: `npx vitest run src/components/student/TradePanel.test.tsx`
Expected: PASS（既存＋新規6件）

- [ ] **Step 6: 生徒画面から残高を渡す**

`src/components/student/StudentMarketPage.tsx:96` の `<TradePanel …/>` を差し替える。

```tsx
        {selected && <TradePanel
          stockName={`${selected.name} (${selected.symbol})`}
          currentPrice={prices[selected.id]?.price ?? selected.basePrice}
          cash={portfolio?.cash ?? 0}
          holding={portfolio?.holdings?.[selected.id] ?? 0}
          onSubmitOrder={(side, quantity) => void placeOrder(side, quantity).catch(() => { setPendingOrderId(''); setNotice('注文処理でエラーが発生しました。') })}
          latestResult={latestResult}
          disabled={meta?.status !== 'OPEN'}
          pending={Boolean(pendingOrderId)}
        />}
```

- [ ] **Step 7: 自動検証を通す**

Run: `npm run lint && npm run typecheck && npm test`
Expected: すべて PASS

- [ ] **Step 8: コミット**

```bash
git add src/components/student && git commit -m "feat: confirm and bound student orders before sending them"
```

---

## Task 11: 死んだ `initialShares` フィールドを取り除く

UI にも約定ロジックにも一切参照がないのに型とバリデーションだけ残っている。中途半端な状態が誤解を生むので削除する。

**Files:**
- Modify: `src/lib/templates/types.ts:13`
- Modify: `src/lib/templates/templateValidation.ts:46`
- Modify: `src/lib/templates/officialSeeds.ts:7,8,9,15,16,17,23,24,25`
- Modify: `src/components/TemplateWorkspace.tsx:16,83`
- Modify: `src/lib/templates/templateRepository.test.ts:6`
- Modify: `src/lib/market/marketRepository.test.ts:12`
- Modify: `test/classroom-flow.rules.test.ts:17`

**Interfaces:**
- Consumes: `TemplateCompany`
- Produces: `TemplateCompany` から `initialShares` が消える

- [ ] **Step 1: 型から消して、コンパイラに参照箇所を挙げさせる**

`src/lib/templates/types.ts:13` の `initialShares: number` の行を削除する。

Run: `npm run typecheck`
Expected: FAIL — 上記の各ファイルで `Object literal may only specify known properties` / `Property 'initialShares' does not exist`

- [ ] **Step 2: 全参照を消す**

`src/lib/templates/templateValidation.ts:46` の行を削除する。

```ts
    initialShares: Math.max(1, Math.round(company.initialShares)),
```

`src/lib/templates/officialSeeds.ts` の 9 か所から `, initialShares: 100` / `, initialShares: 80` を削除する。

`src/components/TemplateWorkspace.tsx:16` と `:83` から `initialShares: 100,` / `initialShares: 100,` を削除する。

`src/lib/templates/templateRepository.test.ts:6`、`src/lib/market/marketRepository.test.ts:12`、`test/classroom-flow.rules.test.ts:17` からも同様に削除する。

- [ ] **Step 3: 通ることを確認する**

Run: `npm run lint && npm run typecheck && npm test && npm run test:rules`
Expected: すべて PASS

- [ ] **Step 4: コミット**

```bash
git add src test && git commit -m "refactor: drop the unused initialShares field from templates"
```

---

## Task 12: 市場の終了を二段階確認にする

`window.confirm` ひとつで `ENDING` に入り、そこから戻せない（`src/lib/market/hostTrading.ts:43-46`）。

**Files:**
- Modify: `src/components/HostConsole.tsx`

**Interfaces:**
- Consumes: `requestMarketEnding`
- Produces: なし（UI のみ）

- [ ] **Step 1: 確認状態を持つ**

`src/components/HostConsole.tsx` の state 宣言に追加する。

```tsx
  const [endingConfirm, setEndingConfirm] = useState(false)
```

- [ ] **Step 2: 終了ボタンを差し替える**

`host-controls` の中の「市場を終了」ボタン（25行目）を差し替える。

```tsx
{!endingConfirm ? (
  <button className="outline-button" type="button" onClick={() => setEndingConfirm(true)}>市場を終了</button>
) : (
  <div className="ending-confirm" role="group" aria-label="市場終了の確認">
    <p><strong>市場を終了すると、結果が確定して元に戻せません。</strong>生徒はこれ以上売買できなくなります。</p>
    <button className="danger-button" type="button" onClick={() => { setEndingConfirm(false); void requestMarketEnding(services.database, marketId, user.uid, lease).then((result) => setNotice(result.committed ? '終了処理を開始しました。完了まで再試行します。' : '終了処理を開始できません。市場が取引中で、この端末がホストであることを確認してください。')) }}>終了して結果を確定する</button>
    <button className="outline-button" type="button" onClick={() => setEndingConfirm(false)}>やめる</button>
  </div>
)}
```

- [ ] **Step 3: 自動検証を通す**

Run: `npm run lint && npm run typecheck && npm test`
Expected: すべて PASS

- [ ] **Step 4: コミット**

```bash
git add src/components/HostConsole.tsx && git commit -m "feat: require an explicit second step before ending a market"
```

---

## Task 13: ニュースに価格インパクトを持たせる

いまニュースは `raw.news` に文字列を書くだけで相場に何の影響もない（`src/lib/market/hostTrading.ts:153-159`）。授業の山場を作れるようにする。`publishPrices`（58〜73行目）は `runtime` から価格を再計算するので、価格を直接動かしても次の tick で消える。したがって **runtime の始点と終点ごと動かす**。

**Files:**
- Modify: `src/lib/market/hostTrading.ts:153-159`
- Test: `src/lib/market/hostTrading.test.ts`
- Modify: `src/components/HostConsole.tsx`

**Interfaces:**
- Consumes: `clampToBounds`（`src/lib/pricing/pricingCore.ts`）
- Produces:
  - `NEWS_IMPACT_LIMIT = 20`
  - `applyNewsImpact(state: Pick<LiveMarketState, 'prices' | 'companies'>, impactPercent: number, atMillis: number): void`
  - `publishManualNews(database, marketId, ownerUid, leaseId, message, impactPercent?, atMillis?)`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/market/hostTrading.test.ts` に追加する。import に `applyNewsImpact` を足す。

```ts
describe('news price impact', () => {
  const state = () => ({
    companies: { acme: { id: 'acme', name: 'Acme', symbol: 'AC', basePrice: 100 } },
    prices: { acme: { price: 110, updatedAtMillis: 1_000, runtime: { phaseId: 'p1', startPrice: 100, endPrice: 120, startAtMillis: 0, endAtMillis: 60_000 } } },
  })

  // Expectations go through clampToBounds because that is what bounds a price;
  // asserting bare arithmetic would silently disagree with pricingCore.
  it('shifts the whole phase runtime so the shock survives the next tick', () => {
    const next = state()
    applyNewsImpact(next, 10, 2_000)
    expect(next.prices.acme.price).toBe(clampToBounds(121, 100))
    expect(next.prices.acme.runtime!.startPrice).toBe(clampToBounds(110, 100))
    expect(next.prices.acme.runtime!.endPrice).toBe(clampToBounds(132, 100))
    expect(next.prices.acme.updatedAtMillis).toBe(2_000)
  })

  it('clamps the impact and keeps the price inside the base-price bounds', () => {
    const next = state()
    applyNewsImpact(next, -500, 2_000)
    expect(next.prices.acme.price).toBe(clampToBounds(110 * 0.8, 100))
  })

  it('does nothing at zero', () => {
    const next = state()
    applyNewsImpact(next, 0, 2_000)
    expect(next.prices.acme.price).toBe(110)
  })
})
```

同ファイル冒頭の import に `clampToBounds` を足す。

```ts
import { clampToBounds } from '../pricing/pricingCore'
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/market/hostTrading.test.ts`
Expected: FAIL — `applyNewsImpact is not a function`

- [ ] **Step 3: 実装する**

`src/lib/market/hostTrading.ts` の `publishManualNews`（153〜159行目）を差し替える。

```ts
export const NEWS_IMPACT_LIMIT = 20

/**
 * A shock has to move the phase runtime, not just the price: publishPrices
 * recomputes each price from its runtime every tick, so a bare price write
 * would be erased one second later.
 */
export const applyNewsImpact = (state: Pick<LiveMarketState, 'prices' | 'companies'>, impactPercent: number, atMillis: number) => {
  const bounded = Math.max(-NEWS_IMPACT_LIMIT, Math.min(NEWS_IMPACT_LIMIT, impactPercent))
  if (!bounded || !state.prices) return
  const multiplier = 1 + bounded / 100
  for (const [stockId, entry] of Object.entries(state.prices)) {
    const basePrice = state.companies?.[stockId]?.basePrice ?? entry.price
    entry.price = clampToBounds(entry.price * multiplier, basePrice)
    entry.updatedAtMillis = atMillis
    if (entry.runtime) {
      entry.runtime.startPrice = clampToBounds(entry.runtime.startPrice * multiplier, basePrice)
      entry.runtime.endPrice = clampToBounds(entry.runtime.endPrice * multiplier, basePrice)
    }
  }
}

export const publishManualNews = async (database: Database, marketId: string, ownerUid: string, leaseId: string, message: string, impactPercent = 0, atMillis = now()) => {
  const trimmed = message.trim().slice(0, 280); if (!trimmed) throw new Error('News must not be empty')
  return runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => {
    if (!raw || !ownsLiveLease(raw, ownerUid, leaseId, atMillis) || raw.meta.status !== 'OPEN') return
    raw.news ??= {}; raw.news[crypto.randomUUID()] = { message: trimmed, publishedAtMillis: atMillis, impactPercent }
    applyNewsImpact(raw, impactPercent, atMillis)
    return raw
  })
}
```

`src/lib/market/liveMarketTypes.ts:65` の `news` の型に一項目足す。

```ts
  news?: Record<string, { message: string; publishedAtMillis: number; impactPercent?: number }>
```

- [ ] **Step 4: 通ることを確認する**

Run: `npx vitest run src/lib/market/hostTrading.test.ts`
Expected: PASS

- [ ] **Step 5: ホスト画面に影響度を選ばせる**

`src/components/HostConsole.tsx` の state に追加する。

```tsx
  const [impact, setImpact] = useState(0)
```

`news-card` の textarea の直後に追加する。

```tsx
<label>相場への影響<select value={impact} onChange={(event) => setImpact(Number(event.target.value))} disabled={!lease}>
  <option value={0}>影響なし（お知らせだけ）</option>
  <option value={5}>やや上昇（+5%）</option>
  <option value={10}>大きく上昇（+10%）</option>
  <option value={-5}>やや下落（-5%）</option>
  <option value={-10}>大きく下落（-10%）</option>
</select></label>
```

配信ボタンの `onClick` を差し替える。

```tsx
onClick={() => void publishManualNews(services.database, marketId, user.uid, lease, news, impact).then(() => { setNews(''); setImpact(0); setNotice('ニュースを配信しました。') }).catch(() => setNotice('ニュースを配信できません。市場が取引中か確認してください。'))}
```

- [ ] **Step 6: 自動検証を通す**

Run: `npm run lint && npm run typecheck && npm test && npm run test:rules`
Expected: すべて PASS

- [ ] **Step 7: コミット**

```bash
git add src/lib src/components && git commit -m "feat: let a news item move the market"
```

---

## Task 14: 非同期エラーを Sentry へ送り、原因別の文言を出す

`reportError` の呼び出し元は `src/components/AppErrorBoundary.tsx:16` だけで、毎秒の tick を含むすべての非同期失敗が握りつぶされている。

**Files:**
- Create: `src/lib/monitoring/describeError.ts`
- Test: `src/lib/monitoring/describeError.test.ts`
- Modify: `src/components/HostConsole.tsx`, `src/components/MarketDashboard.tsx`, `src/components/TemplateWorkspace.tsx`, `src/components/student/StudentMarketPage.tsx`

**Interfaces:**
- Consumes: `reportError`（`src/lib/monitoring/errorReporting.ts:48`）
- Produces:
  - `describeError(error: unknown, fallback: string): string`
  - `handleFailure(error: unknown, fallback: string): string` — 報告してから文言を返す

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/monitoring/describeError.test.ts` を新規作成する。

```ts
import { describe, expect, it } from 'vitest'
import { describeError } from './describeError'

describe('describeError', () => {
  it('explains a permission failure in classroom terms', () => {
    expect(describeError({ code: 'permission-denied' }, '失敗しました。')).toContain('権限がありません')
    expect(describeError({ code: 'PERMISSION_DENIED' }, '失敗しました。')).toContain('権限がありません')
  })
  it('explains a connectivity failure', () => {
    expect(describeError({ code: 'unavailable' }, '失敗しました。')).toContain('通信')
  })
  it('explains a quota failure', () => {
    expect(describeError({ code: 'resource-exhausted' }, '失敗しました。')).toContain('上限')
  })
  it('falls back to the caller message for anything else', () => {
    expect(describeError(new Error('boom'), '失敗しました。')).toBe('失敗しました。')
    expect(describeError(undefined, '失敗しました。')).toBe('失敗しました。')
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/monitoring/describeError.test.ts`
Expected: FAIL — `Failed to resolve import "./describeError"`

- [ ] **Step 3: 実装する**

`src/lib/monitoring/describeError.ts` を新規作成する。

```ts
import { reportError } from './errorReporting'

const codeOf = (error: unknown): string =>
  typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code).toLowerCase() : ''

/**
 * A teacher standing in front of a class needs to know which of three things
 * went wrong — their permission, the network, or the free-tier ceiling —
 * because the response to each is different.
 */
export const describeError = (error: unknown, fallback: string): string => {
  const code = codeOf(error)
  if (code.includes('permission') || code.includes('unauthenticated')) return 'この操作の権限がありません。教師アカウントでログインしているか、この市場の作成者であるかを確認してください。'
  if (code.includes('unavailable') || code.includes('network') || code.includes('deadline')) return '通信が不安定です。ネットワークを確認して、もう一度お試しください。'
  if (code.includes('resource-exhausted') || code.includes('quota')) return '同時利用が上限に達しています。しばらく待つと復帰します。'
  return fallback
}

/** Report first, then explain: a swallowed error is one we can never fix. */
export const handleFailure = (error: unknown, fallback: string): string => {
  reportError(error)
  return describeError(error, fallback)
}
```

- [ ] **Step 4: 通ることを確認する**

Run: `npx vitest run src/lib/monitoring/describeError.test.ts`
Expected: PASS（4件）

- [ ] **Step 5: すべての catch を差し替える**

各ファイルの import に `import { handleFailure } from '../lib/monitoring/describeError'`（生徒画面は `'../../lib/monitoring/describeError'`）を足したうえで、以下をすべて置換する。

`src/components/HostConsole.tsx`
- 16行目 → `.catch((error) => setNotice(handleFailure(error, '市場設定を取得できません。')))`
- tick の catch → `.catch((error) => setNotice(handleFailure(error, 'ホスト処理を再試行しています。')))`
- `takeLease` の呼び出し側 → `.catch((error) => setNotice(handleFailure(error, 'ホストを取得できませんでした。')))`
- 「市場を開始」→ `.catch((error) => setNotice(handleFailure(error, '開始できません。準備中の市場か確認してください。')))`
- 「ニュース配信」→ `.catch((error) => setNotice(handleFailure(error, 'ニュースを配信できません。市場が取引中か確認してください。')))`

`src/components/MarketDashboard.tsx`
- 39行目 → `.catch((error) => setNotice(handleFailure(error, 'テンプレートまたは市場を読み込めませんでした。')))`
- 45行目 `create` の catch → `catch (error) { setNotice(error instanceof Error && error.message.startsWith('参加コード') ? error.message : handleFailure(error, '市場を作成できませんでした。')) }`
- `removeMarket` の呼び出し側 → `.catch((error) => setNotice(handleFailure(error, '市場を削除できませんでした。一部だけ削除された可能性があります。もう一度削除を実行してください。')))`
- `exportResults` の呼び出し側 → `.catch((error) => setNotice(handleFailure(error, '結果を読み込めませんでした。')))`

`src/components/TemplateWorkspace.tsx`
- 38行目 → `.catch((error) => setNotice(handleFailure(error, 'テンプレートを読み込めませんでした。')))`

`src/components/student/StudentMarketPage.tsx`
- 38行目 → `.catch((error) => setNotice(handleFailure(error, '匿名ログインを開始できませんでした。')))`
- 62行目 → `.catch((error) => setNotice(handleFailure(error, '参加状態を復元できませんでした。')))`

- [ ] **Step 6: 自動検証を通す**

Run: `npm run lint && npm run typecheck && npm test`
Expected: すべて PASS

- [ ] **Step 7: コミット**

```bash
git add src/lib/monitoring src/components && git commit -m "feat: report async failures and explain them by cause"
```

---

## Task 15: 画面内にビルド識別子を出す

いまは `curl` で `<meta name="version">` を見るしかない（`README.md:39-45`）。教師には使えない。

**Files:**
- Create: `src/components/AppVersion.tsx`
- Modify: `src/components/MarketDashboard.tsx:54`, `src/components/HostConsole.tsx:25`, `src/components/PublicDocs.tsx`

**Interfaces:**
- Consumes: `import.meta.env.VITE_COMMIT_SHA`（`vite.config.ts:19`）
- Produces: `AppVersion`

- [ ] **Step 1: 実装する**

`src/components/AppVersion.tsx` を新規作成する。

```tsx
/** Stamped by vite.config.ts; the only version a non-engineer can read out loud. */
const commitSha = import.meta.env.VITE_COMMIT_SHA ?? 'unknown'

export const AppVersion = () => <small className="app-version">バージョン {commitSha}</small>
```

- [ ] **Step 2: 型宣言を足す**

`src/vite-env.d.ts` に追加する。

```ts
interface ImportMetaEnv {
  readonly VITE_COMMIT_SHA?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

（既存の宣言がある場合はマージする。`npm run typecheck` が通る形にすること。）

- [ ] **Step 3: 各画面に置く**

`src/components/MarketDashboard.tsx:54` の `teacher-header` の `<div>` 末尾（アバターの直後）に `<AppVersion />` を追加。

`src/components/HostConsole.tsx:25` の `teacher-header` 末尾に `<AppVersion />` を追加。

`src/components/PublicDocs.tsx` のフッター（各ページ共通のフッター要素）に `<AppVersion />` を追加。

いずれも import を足す。

- [ ] **Step 4: スタイルを足す**

`src/App.css` の末尾に追加する。

```css
.app-version { opacity: 0.6; font-size: 0.75rem; margin-left: 0.75rem; }
```

- [ ] **Step 5: 自動検証を通す**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: すべて PASS。ビルド後 `grep -o 'バージョン' dist/assets/*.js` が一致すること。

- [ ] **Step 6: コミット**

```bash
git add src && git commit -m "feat: show the build identifier inside the app"
```

---

# フェーズ 3 — 負債と精度

## Task 16: 重複実装の削除とセッション解除の配線

**Files:**
- Delete: `src/components/student/JoinMarket.tsx`, `src/components/student/JoinMarket.test.tsx`
- Modify: `src/components/student/ResultsView.tsx`
- Modify: `src/components/student/StudentMarketPage.tsx:72`
- Modify: `src/components/TemplateWorkspace.tsx:56-59`

**Interfaces:**
- Consumes: `clearActiveStudentSession`（`src/lib/students/studentSession.ts:30`、現在どこからも呼ばれていない）
- Produces: `ResultsViewProps` に `onLeave?: () => void`

- [ ] **Step 1: デッドコードを消す**

```bash
git rm src/components/student/JoinMarket.tsx src/components/student/JoinMarket.test.tsx
```

Run: `npm run typecheck && npm test`
Expected: PASS（どこからも参照されていないので影響なし）

- [ ] **Step 2: 結果画面に「別の市場に参加」を足す**

`src/components/student/ResultsView.tsx:17` の `<a className="portal-button" href="/">トップへ戻る</a>` を差し替える。

```tsx
    <div className="results-actions">
      <a className="portal-button" href="/">トップへ戻る</a>
      <a className="outline-button" href="/join" onClick={() => onLeave?.()}>別の市場に参加する</a>
    </div>
```

`ResultsViewProps` に `onLeave?: () => void` を足し、関数の引数で受ける。

- [ ] **Step 3: 生徒画面から配線する**

`src/components/student/StudentMarketPage.tsx` の import に追加する。

```tsx
import { clearActiveStudentSession, readActiveStudentSession } from '../../lib/students/studentSession'
```

88行目の `<ResultsView …/>` に `onLeave={clearActiveStudentSession}` を足す。

72行目の「参加情報が見つかりません」画面のリンクにも足す。

```tsx
<a className="portal-button" href="/join" onClick={() => clearActiveStudentSession()}>参加画面へ</a>
```

- [ ] **Step 4: 共有 URL をコピーできるようにする**

`src/components/TemplateWorkspace.tsx` の state に追加する。

```tsx
  const [shareUrl, setShareUrl] = useState('')
```

`share`（56行目）を差し替える。

```tsx
  const share = async (item: PersonalTemplate) => {
    const id = await createTemplateShare(db, ownerUid, item)
    // A share link cannot be listed or re-fetched later, so it must be copyable now.
    const url = `${window.location.origin}/templates/share/${id}`
    setShareUrl(url)
    setNotice('共有URLを発行しました。下のボタンでコピーしてください。')
  }
```

`{notice && …}` の直後に追加する。

```tsx
{shareUrl && <p className="form-notice share-url" role="status"><code>{shareUrl}</code><button type="button" onClick={() => void navigator.clipboard.writeText(shareUrl).then(() => setNotice('共有URLをコピーしました。'))}>コピー</button><small>この URL はあとから一覧できません。いま控えてください。</small></p>}
```

- [ ] **Step 5: 自動検証を通す**

Run: `npm run lint && npm run typecheck && npm test`
Expected: すべて PASS

- [ ] **Step 6: コミット**

```bash
git add -A src/components && git commit -m "refactor: drop the duplicate join screen and wire session teardown"
```

---

## Task 17: 結果画面に保有と銘柄別損益を出す

いまは取引履歴の羅列だけで、`stockId` が生のまま出ている（`src/components/student/ResultsView.tsx:16`）。

**Files:**
- Modify: `src/components/student/ResultsView.tsx`
- Test: `src/components/student/ResultsView.test.tsx`
- Modify: `src/components/student/StudentMarketPage.tsx:88,95`

**Interfaces:**
- Consumes: `OrderResult`, `Portfolio`
- Produces: `summarizePositions(transactions: OrderResult[]): PositionSummary[]`, `ResultsViewProps` に `companyNames: Record<string, string>`, `holdings: Record<string, number>`, `prices: Record<string, number>`

- [ ] **Step 1: 失敗するテストを書く**

`src/components/student/ResultsView.test.tsx` に追加する。

```tsx
import { summarizePositions } from './ResultsView'

describe('summarizePositions', () => {
  const tx = (side: 'BUY' | 'SELL', filledQuantity: number, price: number, processedAtMillis: number) =>
    ({ orderId: `${side}${processedAtMillis}`, participantId: 'p', teamId: 't', stockId: 'acme', side, requestedQuantity: filledQuantity, filledQuantity, price, processedAtMillis })

  it('nets buys and sells into a realised amount per stock', () => {
    const [position] = summarizePositions([tx('BUY', 5, 100, 1), tx('SELL', 2, 130, 2)])
    expect(position).toEqual({ stockId: 'acme', bought: 5, sold: 2, spent: 500, received: 260 })
  })

  it('returns an empty list when nothing traded', () => {
    expect(summarizePositions([])).toEqual([])
  })
})

describe('ResultsView positions', () => {
  it('shows the company name, remaining holding and net result', () => {
    render(<ResultsView
      teamName="赤" finalValuation={8500} rank={1}
      transactions={[{ orderId: 'o1', participantId: 'p', teamId: 't', stockId: 'acme', side: 'BUY', requestedQuantity: 5, filledQuantity: 5, price: 100, processedAtMillis: 1 }]}
      companyNames={{ acme: 'アクメ' }} holdings={{ acme: 5 }} prices={{ acme: 120 }}
    />)
    expect(screen.getByText('アクメ')).toBeInTheDocument()
    expect(screen.getByText('5株')).toBeInTheDocument()
    expect(screen.getByText('+100円')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/components/student/ResultsView.test.tsx`
Expected: FAIL — `summarizePositions is not exported`

- [ ] **Step 3: 実装する**

`src/components/student/ResultsView.tsx` を差し替える。

```tsx
import type { OrderResult } from '../../lib/market/liveMarketTypes'

export interface PositionSummary { stockId: string; bought: number; sold: number; spent: number; received: number }

interface ResultsViewProps {
  teamName: string
  finalValuation: number
  rank: number | null
  transactions: OrderResult[]
  companyNames?: Record<string, string>
  holdings?: Record<string, number>
  prices?: Record<string, number>
  onLeave?: () => void
}

/** Per-stock cash in and out, so a student can see which decision paid off. */
export const summarizePositions = (transactions: OrderResult[]): PositionSummary[] => {
  const byStock = new Map<string, PositionSummary>()
  for (const transaction of transactions) {
    const entry = byStock.get(transaction.stockId) ?? { stockId: transaction.stockId, bought: 0, sold: 0, spent: 0, received: 0 }
    const amount = transaction.filledQuantity * transaction.price
    if (transaction.side === 'BUY') { entry.bought += transaction.filledQuantity; entry.spent += amount }
    else { entry.sold += transaction.filledQuantity; entry.received += amount }
    byStock.set(transaction.stockId, entry)
  }
  return [...byStock.values()]
}

export function ResultsView({ teamName, finalValuation, rank, transactions, companyNames = {}, holdings = {}, prices = {}, onLeave }: ResultsViewProps) {
  const positions = summarizePositions(transactions)
  const nameOf = (stockId: string) => companyNames[stockId] ?? stockId
  return <main className="student-page"><section className="student-card results-card">
    <p className="portal-eyebrow">MARKET RESULT</p><h1>{teamName}の結果</h1>
    <p className="result-value">{finalValuation.toLocaleString('ja-JP')}円</p>
    {rank !== null && <p className="result-rank">{rank}位</p>}

    <h2>銘柄ごとの結果</h2>
    {positions.length ? <table className="results-positions">
      <thead><tr><th scope="col">銘柄</th><th scope="col">残っている株</th><th scope="col">買った金額</th><th scope="col">売った金額</th><th scope="col">損益</th></tr></thead>
      <tbody>{positions.map((position) => {
        const remaining = holdings[position.stockId] ?? 0
        const net = position.received + remaining * (prices[position.stockId] ?? 0) - position.spent
        return <tr key={position.stockId}>
          <th scope="row">{nameOf(position.stockId)}</th>
          <td>{remaining}株</td>
          <td>{position.spent.toLocaleString()}円</td>
          <td>{position.received.toLocaleString()}円</td>
          <td className={net >= 0 ? 'up' : 'down'}>{net >= 0 ? '+' : ''}{net.toLocaleString()}円</td>
        </tr>
      })}</tbody>
    </table> : <p>取引はありませんでした。</p>}

    <h2>あなたの取引履歴</h2>
    {transactions.length ? <ul>{[...transactions].sort((a, b) => a.processedAtMillis - b.processedAtMillis).map((tx) => <li key={tx.orderId}>{nameOf(tx.stockId)} {tx.side === 'BUY' ? '購入' : '売却'} {tx.filledQuantity}株 @ {tx.price.toLocaleString()}円</li>)}</ul> : <p>取引履歴はありません。</p>}

    <div className="results-actions">
      <a className="portal-button" href="/">トップへ戻る</a>
      <a className="outline-button" href="/join" onClick={() => onLeave?.()}>別の市場に参加する</a>
    </div>
  </section></main>
}
```

- [ ] **Step 4: 呼び出し側から名前と価格を渡す**

`src/components/student/StudentMarketPage.tsx:88` を差し替える。

```tsx
  if (meta?.status === 'ENDED') return <ResultsView
    teamName={teams[participant.teamId ?? '']?.name ?? '所属チーム'}
    finalValuation={teamResult?.valuation ?? 0}
    rank={teamResult?.rank ?? null}
    transactions={Object.values(transactions)}
    companyNames={Object.fromEntries(Object.values(companies).map((company) => [company.id, company.name]))}
    holdings={portfolio?.holdings ?? {}}
    prices={Object.fromEntries(Object.entries(prices).map(([stockId, value]) => [stockId, value.price]))}
    onLeave={clearActiveStudentSession}
  />
```

- [ ] **Step 5: 銘柄タブに選択状態を伝える**

95行目の銘柄タブを差し替える（`aria-pressed` がないとスクリーンリーダーに現在の銘柄が伝わらない）。

```tsx
<div className="stock-tabs" role="group" aria-label="銘柄を選ぶ">{Object.values(companies).map((company) => <button type="button" aria-pressed={selectedStockId === company.id} className={selectedStockId === company.id ? 'active' : ''} key={company.id} onClick={() => setSelectedStockId(company.id)}>{company.symbol}<small>{prices[company.id]?.price ?? company.basePrice}円</small></button>)}</div>
```

- [ ] **Step 6: スタイルを足す**

`src/App.css` の末尾に追加する。

```css
.results-positions { width: 100%; border-collapse: collapse; margin: 0.5rem 0 1.25rem; }
.results-positions th, .results-positions td { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid rgba(128, 128, 128, 0.25); font-variant-numeric: tabular-nums; }
.results-positions .up { color: #0a7a3d; }
.results-positions .down { color: #b3261e; }
.results-actions { display: flex; gap: 0.75rem; flex-wrap: wrap; }
```

- [ ] **Step 7: 通ることを確認する**

Run: `npm run lint && npm run typecheck && npm test`
Expected: すべて PASS

- [ ] **Step 8: コミット**

```bash
git add src && git commit -m "feat: break the student result down by stock"
```

---

## Task 18: 時刻をサーバ基準に揃える

`src/lib/market/hostTrading.ts:8` の `now = () => Date.now()` が、リース失効判定・価格フェーズ計算・順位のタイムスタンプすべてを教師 PC のローカル時計に委ねている。RTDB の `.info/serverTimeOffset` を一度読んで補正する。

**Files:**
- Create: `src/lib/firebase/serverTime.ts`
- Test: `src/lib/firebase/serverTime.test.ts`
- Modify: `src/lib/market/hostTrading.ts:8`
- Modify: `src/components/HostConsole.tsx:24`

**Interfaces:**
- Consumes: RTDB の `.info/serverTimeOffset`
- Produces:
  - `startServerTimeSync(database: Database): () => void`
  - `setServerTimeOffset(offsetMillis: number): void`（テスト用）
  - `serverNow(): number`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/firebase/serverTime.test.ts` を新規作成する。

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { serverNow, setServerTimeOffset } from './serverTime'

afterEach(() => { setServerTimeOffset(0); vi.useRealTimers() })

describe('serverNow', () => {
  it('matches the local clock until an offset is published', () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000)
    expect(serverNow()).toBe(1_000)
  })
  it('applies the published offset', () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000)
    setServerTimeOffset(4_500)
    expect(serverNow()).toBe(5_500)
    setServerTimeOffset(-2_000)
    expect(serverNow()).toBe(-1_000)
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/firebase/serverTime.test.ts`
Expected: FAIL — `Failed to resolve import "./serverTime"`

- [ ] **Step 3: 実装する**

`src/lib/firebase/serverTime.ts` を新規作成する。

```ts
import { onValue, ref, type Database } from 'firebase/database'

/**
 * Every host decision — lease expiry, phase progress, finalization checkpoints —
 * is keyed on a millisecond timestamp. A teacher laptop whose clock is minutes
 * off would expire its own lease or jump the price schedule, so all of it runs
 * on the RTDB server clock instead.
 */
let offsetMillis = 0

export const setServerTimeOffset = (value: number) => { offsetMillis = value }
export const serverNow = () => Date.now() + offsetMillis

export const startServerTimeSync = (database: Database) =>
  onValue(ref(database, '.info/serverTimeOffset'), (snapshot) => setServerTimeOffset(Number(snapshot.val() ?? 0)))
```

- [ ] **Step 4: 通ることを確認する**

Run: `npx vitest run src/lib/firebase/serverTime.test.ts`
Expected: PASS（2件）

- [ ] **Step 5: 使用箇所を差し替える**

`src/lib/market/hostTrading.ts:8` を差し替える。

```ts
import { serverNow } from '../firebase/serverTime'
const now = () => serverNow()
```

同ファイル `openMarket`（39行目）と `armHostLeaseDisconnect`（50行目）と `finalizeEnding`（166行目）の直接 `now()` 呼び出しはそのままでよい（`now` の定義が変わるため自動的に補正される）。

`src/lib/market/marketRepository.ts` の `Date.now()` も同様に差し替える。import に `import { serverNow } from '../firebase/serverTime'` を足し、23〜27行目・88行目・94行目・100行目・128行目・133〜134行目・`removeParticipant`/`reassignParticipantTeam` の `Date.now()` を `serverNow()` に置換する。

`src/components/HostConsole.tsx:24` の `takeLease` を差し替える。

```tsx
  const takeLease = async () => { const next = leaseId(); const expiresAtMillis = serverNow() + 15_000; const ok = await acquireHostLease(services.database, marketId, user.uid, next); if (!ok) return setNotice('この市場のホストを取得できません。ほかの端末が操作中でないか確認してください。'); await armHostLeaseDisconnect(services.database, marketId, { ownerUid: user.uid, leaseId: next, expiresAtMillis, paused: false }); setLease(next); setNotice('ホストを取得しました。') }
```

- [ ] **Step 6: 同期を起動する**

`src/lib/firebase/bootstrap.ts` の `bootstrapFirebase` が services を返す直前に、一度だけ同期を開始する。既存の初期化ガード（一度きりの初期化）に合わせて追加する。

```ts
  startServerTimeSync(services.database)
```

import を足す。二重購読を避けるため、既存のシングルトン化された初期化パスの中に置くこと。

- [ ] **Step 7: 全体を通す**

Run: `npm run lint && npm run typecheck && npm test && npm run test:rules`
Expected: すべて PASS（`test/classroom-flow.rules.test.ts` のハッピーパスが通ることが特に重要）

- [ ] **Step 8: コミット**

```bash
git add src && git commit -m "fix: drive host timing from the server clock"
```

---

## Task 19: ドキュメントを実態に合わせる

**Files:**
- Modify: `README.md`
- Modify: `src/components/PublicDocs.tsx:143-175`

**Interfaces:**
- Consumes: これまでのタスクで実装した挙動
- Produces: なし

- [ ] **Step 1: README に運用上の注意を追記する**

`README.md` に「授業当日の運用」という節を追加し、以下を書く。

- ホスト画面のタブを**前面に置いたまま**にすること。裏に回すとブラウザがタイマーを抑制し、価格更新と約定が止まる。PC のスリープも同様。画面ロックは `WakeLock` で抑止しているが、OS 設定によっては効かない。
- 市場の結果は `marketResults/{marketId}` に保存され、市場を削除すると**復元不可能に消える**。削除前に「結果をCSVで保存」を実行すること。作成から 30 日で削除が推奨表示されるが、自動削除はされない。
- 生徒が端末を替えた・localStorage を消した場合は、生徒画面に表示されている**4文字の復帰コード**を参加時に入力させると、同じチーム・同じ資産に戻れる。授業開始時に控えさせておくとよい。
- テンプレートの共有 URL は一覧できない。発行時にコピーして保管すること。失効させる手段はない。
- 緊急停止（`serviceStatus/global`）と `operator` カスタムクレームの付与は Firebase コンソール / Admin SDK からの手動操作。誰がこの権限を持つかを運用側で管理すること。
- チーム資産は共有。生徒を退出させてもチームの現金・保有株は残る。

- [ ] **Step 2: 生徒・教師向けマニュアルを直す**

`src/components/PublicDocs.tsx:170` 付近の「参加は開始前のみ受け付けます」という記述を、実装に合わせて差し替える。

```tsx
<li>参加は授業の途中でも受け付けられます。先生の承認が必要です。</li>
<li>端末を替えるときは、画面に出ている4文字の「復帰コード」を控えてください。次に参加するときに入力すると、同じチームに戻れます。</li>
```

教師向け FAQ に追加する。

```tsx
<li><strong>市場が止まってしまった</strong> — ホスト画面のタブが裏に回っていませんか。授業のあいだは前面に置いたままにしてください。戻ると警告が表示されます。</li>
<li><strong>生徒が画面を閉じてしまった</strong> — 生徒に復帰コードを聞き、参加画面から参加コードと一緒に入力してもらってください。同じチームに戻れます。</li>
<li><strong>結果を保存したい</strong> — 市場の管理画面の「結果をCSVで保存」から、チーム結果と取引履歴をダウンロードできます。市場を削除すると復元できません。</li>
```

- [ ] **Step 3: 全体を通す**

Run: `npm run verify`
Expected: すべて PASS

- [ ] **Step 4: コミット**

```bash
git add README.md src/components/PublicDocs.tsx && git commit -m "docs: document classroom operation, recovery codes and result export"
```

---

## 最終確認

- [ ] `npm run verify` が全緑
- [ ] エミュレータで通し稽古: 教師ログイン → テンプレート作成 → 市場作成 → **リロード** → 生徒2名を承認 → 市場開始 → 生徒が売買（確認ステップを経る）→ 1名の localStorage を消して復帰コードで再参加 → 承認 → 資産が戻っている → ニュースを +10% で配信 → 価格が動いて次の tick でも維持される → 市場を終了（二段階）→ 生徒に銘柄別の結果が出る → 教師が CSV を2本ダウンロード → 市場を削除
- [ ] ホスト画面で別タブに切り替えて戻り、中断の警告が出ることを確認
- [ ] スマホ幅（375px）で生徒画面・参加画面が横スクロールしないことを確認
