# 授業の状態表示を読めるようにする 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 教師画面と教室表示に、フェーズの日本語名・次に進む先・動く残り時間を出す。

**Architecture:** フェーズの日本語名 (`displayConfig.label`) と終了時刻は既にサーバ側のデータに存在するか、存在させられる。両者を `LessonRunProjectionSource` 経由で public/display の両 projection に載せ、クライアントは購読済みの状態からそのまま読む。残り時間はスナップショットではなく終了時刻として渡し、クライアントが毎秒描き直す。次フェーズは `App.tsx` の手写し配列ではなく `templateSnapshot.phases` の graph から解決する。

**Tech Stack:** TypeScript / React 19 / MUI 9 / Firebase Functions v2 (Node 20, CommonJS) / Firestore / Realtime Database / Vitest

**正本仕様:** `docs/superpowers/specs/2026-08-20-lesson-status-readability-design.md`

## Global Constraints

- テストは Vitest。テストファイルは実装と同じディレクトリに `*.test.ts` / `*.test.tsx` で置く。
- `functions/src` から リポジトリ直下の `src/` を import してはならない（`functions/tsconfig.json` の `rootDir: "src"`）。同じ形の型・ロジックが両側に必要な場合は手作業で同期する既存慣行に従い、その旨を JSDoc に書く。
- projection 関数（`toLessonRunPublicState` / `toLessonRunDisplayState`）は **allow-list 方式**を維持する。`source` をスプレッド（`{...source}`）してはならない。
- `LessonRunProjectionSource` の禁止フィールド `randomSeed` / `restoreGeneration` / `future` は、いかなる projection 出力にも現れてはならない（統合仕様書 §26-1）。
- フェーズの `progression` を `TIMED` に変えてはならない。満了時に遷移させるスケジューラは存在しないため、起きない自動進行を約束することになる。
- UI文言は日本語。用語は第1弾の用語表（教材 / 版 / 授業 / 教室表示 / フェーズ / 解説画面 / 教室表示のメッセージ）に従う。
- 各タスクの最後に `npm test`（クライアント）または `npm test --workspace=functions`（サーバ）を実行し、緑を確認してからコミットする。
- **最終タスクでは必ず `npm run verify` を実行する。** `npm test` と `npm run build` だけでは Rules 用 tsconfig（`test/` 配下を含む）の型チェックが走らず、projection の型にフィールドを足したときの追従漏れを取り逃がす。第2弾で実際に取り逃がしている。
- コミットメッセージ末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` を付ける。

## File Structure

**新規作成**

| ファイル | 責務 |
| --- | --- |
| `functions/src/lessonRuns/phases/phaseLabel.ts` | サーバ側: `displayConfig`（型は `unknown`）から日本語ラベルを安全に読む |
| `functions/src/lessonRuns/phases/phaseLabel.test.ts` | 同上のテスト |
| `src/lib/lessonRuns/phaseLabel.ts` | クライアント側: 同じ判定の手動同期版 |
| `src/lib/lessonRuns/phaseLabel.test.ts` | 同上のテスト |
| `src/components/ui/PhaseCountdown.tsx` | 終了時刻を受け取り毎秒描き直す残り時間表示。教師画面と教室表示の双方が使うため `ui/` に置く（`display/` から `teacher/` を import しない） |
| `src/components/ui/PhaseCountdown.test.tsx` | 同上のテスト |

**変更**

| ファイル | 変更内容 |
| --- | --- |
| `functions/src/lessonRuns/projections/source.ts` | `currentPhaseLabel` 追加、`currentPhaseEndsAtMillis` の JSDoc 更新 |
| `functions/src/lessonRuns/projections/buildProjectionSource.ts` | `currentPhaseLabel` の解決 |
| `functions/src/lessonRuns/projections/publicProjection.ts` | `remainingPhaseSeconds` を廃し `currentPhaseEndsAtMillis` と `currentPhaseLabel` を載せる |
| `functions/src/lessonRuns/projections/displayProjection.ts` | `currentPhaseLabel` と `currentPhaseEndsAtMillis` を載せる |
| `src/lib/lessonRuns/liveTypes.ts` | 上記2型の手動同期 |
| `src/lib/lessonTemplates/types.ts` | `LessonContent.coreActivityMinutes?` 追加 |
| `src/lib/lessonTemplates/guidedBuilderPresets.ts` | ウィザードの回答から `coreActivityMinutes` を埋める |
| `functions/src/lessonRuns/phases/defaultPhases.ts` | `buildDefaultPhases(subject, coreActivityMinutes?)` |
| `functions/src/lessonRuns/createLessonRun.ts` | `templateSnapshot.coreActivityMinutes` を渡す |
| `src/components/display/LiveScreen.tsx` | `remainingSeconds` を `endsAtMillis` に変え `PhaseCountdown` を使う |
| `src/components/display/ClassroomDisplayPage.tsx` | `LiveScreen` にフェーズ名と終了時刻を渡す |
| `src/components/teacher/LessonControlRoom.tsx` | ラベル表示、カウントダウン、`phaseHasTimer` の判定元変更 |
| `src/App.tsx` | `defaultPhaseSequence` 撤去、`useTeacherLessonAccess` に `phases` 追加、CTA ラベルと遷移先の graph 解決 |
| `test/lesson-lifecycle.acceptance.test.ts` | `LessonRunProjectionSource` フィクスチャへの新フィールド追加 |

---

### Task 1: `displayConfig` からラベルを読むヘルパー（サーバ / クライアント）

`LessonPhase.displayConfig` の型は `unknown` である（`functions/src/lessonRuns/phases/validation.ts`）。Firestore から読んだ値も同様に信用できない。ラベルの取り出しを1箇所にまとめ、想定外の形では `null` を返す。

**Files:**
- Create: `functions/src/lessonRuns/phases/phaseLabel.ts`
- Create: `functions/src/lessonRuns/phases/phaseLabel.test.ts`
- Create: `src/lib/lessonRuns/phaseLabel.ts`
- Create: `src/lib/lessonRuns/phaseLabel.test.ts`

**Interfaces:**
- Consumes: なし（最初のタスク）
- Produces: サーバ・クライアント双方に同一シグネチャで次を提供する。
  ```ts
  export interface PhaseWithDisplayConfig {
    id: string
    type?: string
    nextPhaseIds?: string[]
    displayConfig?: unknown
  }
  export const readPhaseLabel: (phase: PhaseWithDisplayConfig | undefined | null) => string | null
  export const findPhaseLabel: (phases: PhaseWithDisplayConfig[] | undefined | null, phaseId: string | null) => string | null
  ```

- [ ] **Step 1: 失敗するテストを書く（サーバ側）**

`functions/src/lessonRuns/phases/phaseLabel.test.ts` を新規作成する。

```ts
import { describe, expect, it } from 'vitest'
import { findPhaseLabel, readPhaseLabel } from './phaseLabel'

describe('readPhaseLabel', () => {
  it('displayConfig.label が文字列なら返す', () => {
    expect(readPhaseLabel({ id: 'market', displayConfig: { label: '取引' } })).toBe('取引')
  })

  it('空文字は null にする', () => {
    expect(readPhaseLabel({ id: 'market', displayConfig: { label: '   ' } })).toBeNull()
  })

  it('displayConfig が無ければ null', () => {
    expect(readPhaseLabel({ id: 'market' })).toBeNull()
  })

  it('displayConfig が想定外の形なら null', () => {
    expect(readPhaseLabel({ id: 'market', displayConfig: 'ラベル' })).toBeNull()
    expect(readPhaseLabel({ id: 'market', displayConfig: null })).toBeNull()
    expect(readPhaseLabel({ id: 'market', displayConfig: { label: 42 } })).toBeNull()
  })

  it('phase 自体が無ければ null', () => {
    expect(readPhaseLabel(undefined)).toBeNull()
    expect(readPhaseLabel(null)).toBeNull()
  })
})

describe('findPhaseLabel', () => {
  const phases = [
    { id: 'intro', displayConfig: { label: '導入' } },
    { id: 'market', displayConfig: { label: '取引' } },
  ]

  it('id が一致するフェーズのラベルを返す', () => {
    expect(findPhaseLabel(phases, 'market')).toBe('取引')
  })

  it('一致しない id は null', () => {
    expect(findPhaseLabel(phases, 'nope')).toBeNull()
  })

  it('phaseId が null なら null', () => {
    expect(findPhaseLabel(phases, null)).toBeNull()
  })

  it('phases が無ければ null', () => {
    expect(findPhaseLabel(undefined, 'market')).toBeNull()
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/phases/phaseLabel.test.ts`
Expected: FAIL — `Failed to resolve import "./phaseLabel"`

- [ ] **Step 3: サーバ側を実装する**

`functions/src/lessonRuns/phases/phaseLabel.ts` を新規作成する。

```ts
/**
 * `LessonPhase.displayConfig` は §7.5 が「生徒公開情報」の入れ物として
 * 定めるだけで形を固定していないため、`validation.ts` では `unknown` 型で
 * ある。Firestore の `templateSnapshot.phases` から読んだ値も同様に信用
 * できない。ラベルの取り出しをここ1箇所に集め、想定外の形では例外を投げず
 * `null` を返す（教室に投影される画面が壊れるより、ラベルが出ない方が軽い）。
 *
 * クライアント側の `src/lib/lessonRuns/phaseLabel.ts` は本ファイルの手動
 * 同期版である。`functions/tsconfig.json` の `rootDir: "src"` により
 * `functions/src` からリポジトリ直下の `src/` を import できないため、
 * このコードベースの既存慣行（`LessonRunStatus` 等）に従って複製している。
 * 片方を変えたらもう片方も変えること。
 */
export interface PhaseWithDisplayConfig {
  id: string
  type?: string
  nextPhaseIds?: string[]
  displayConfig?: unknown
}

export const readPhaseLabel = (phase: PhaseWithDisplayConfig | undefined | null): string | null => {
  if (!phase) return null
  const displayConfig = phase.displayConfig
  if (typeof displayConfig !== 'object' || displayConfig === null) return null
  const label = (displayConfig as { label?: unknown }).label
  if (typeof label !== 'string') return null
  const trimmed = label.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const findPhaseLabel = (
  phases: PhaseWithDisplayConfig[] | undefined | null,
  phaseId: string | null,
): string | null => {
  if (!phases || !phaseId) return null
  return readPhaseLabel(phases.find((phase) => phase.id === phaseId))
}
```

- [ ] **Step 4: テストを実行して緑を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/phases/phaseLabel.test.ts`
Expected: PASS（9件）

- [ ] **Step 5: クライアント側を同じ内容で作る**

`src/lib/lessonRuns/phaseLabel.ts` を新規作成する。中身は Step 3 と**同一**（JSDoc の相互参照だけ向きを入れ替える）。

```ts
/**
 * `functions/src/lessonRuns/phases/phaseLabel.ts` の手動同期版。
 * `functions/` と `src/` は型モジュールを共有しないため（`LessonRunStatus`
 * 等と同じ「duplicated by necessity」の慣行）、同じ判定をこちらにも置く。
 * 片方を変えたらもう片方も変えること。
 *
 * `displayConfig` は形が固定されていない `unknown` であり、Firestore から
 * 読んだ値も信用できない。想定外の形では例外を投げず `null` を返す。
 */
export interface PhaseWithDisplayConfig {
  id: string
  type?: string
  nextPhaseIds?: string[]
  displayConfig?: unknown
}

export const readPhaseLabel = (phase: PhaseWithDisplayConfig | undefined | null): string | null => {
  if (!phase) return null
  const displayConfig = phase.displayConfig
  if (typeof displayConfig !== 'object' || displayConfig === null) return null
  const label = (displayConfig as { label?: unknown }).label
  if (typeof label !== 'string') return null
  const trimmed = label.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const findPhaseLabel = (
  phases: PhaseWithDisplayConfig[] | undefined | null,
  phaseId: string | null,
): string | null => {
  if (!phases || !phaseId) return null
  return readPhaseLabel(phases.find((phase) => phase.id === phaseId))
}
```

`src/lib/lessonRuns/phaseLabel.test.ts` は Step 1 のテストの import 元を `'./phaseLabel'` にしたものをそのまま使う（内容は同一）。

- [ ] **Step 6: テストを実行して緑を確認する**

Run: `npm test -- src/lib/lessonRuns/phaseLabel.test.ts`
Expected: PASS（9件）

- [ ] **Step 7: コミット**

```bash
git add functions/src/lessonRuns/phases/phaseLabel.ts functions/src/lessonRuns/phases/phaseLabel.test.ts src/lib/lessonRuns/phaseLabel.ts src/lib/lessonRuns/phaseLabel.test.ts
git commit -m "$(cat <<'EOF'
feat: add a safe reader for a phase's display label

displayConfig is typed unknown because §7.5 never fixes its shape, so both
sides need one place that reads the label defensively rather than each call
site casting.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `currentPhaseLabel` を projection source に載せる

**Files:**
- Modify: `functions/src/lessonRuns/projections/source.ts`
- Modify: `functions/src/lessonRuns/projections/buildProjectionSource.ts`
- Modify: `functions/src/lessonRuns/projections/buildProjectionSource.test.ts`
- Modify: `functions/src/lessonRuns/projections/displayProjection.test.ts`
- Modify: `functions/src/lessonRuns/projections/publicProjection.test.ts`
- Modify: `test/lesson-lifecycle.acceptance.test.ts`

**Interfaces:**
- Consumes: Task 1 の `findPhaseLabel`
- Produces: `LessonRunProjectionSource.currentPhaseLabel: string | null`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonRuns/projections/buildProjectionSource.test.ts` の末尾（最後の `})` の直前）に追加する。`deps` / `run` は同ファイル冒頭の既存フィクスチャ。

```ts
describe('currentPhaseLabel', () => {
  it('現在フェーズの displayConfig.label を解決する', async () => {
    const source = await buildProjectionSource({
      ...deps,
      getRun: async () => ({
        ...run,
        currentPhaseId: 'phase-market',
        templateSnapshot: {
          ...run.templateSnapshot,
          phases: [
            { id: 'phase-intro', displayConfig: { label: '導入' } },
            { id: 'phase-market', displayConfig: { label: '取引' } },
          ],
        },
      }),
    }, 'run1')

    expect(source?.currentPhaseLabel).toBe('取引')
  })

  it('displayConfig が無ければ null', async () => {
    const source = await buildProjectionSource({
      ...deps,
      getRun: async () => ({
        ...run,
        currentPhaseId: 'phase-market',
        templateSnapshot: { ...run.templateSnapshot, phases: [{ id: 'phase-market' }] },
      }),
    }, 'run1')

    expect(source?.currentPhaseLabel).toBeNull()
  })

  it('フェーズ未開始なら null', async () => {
    const source = await buildProjectionSource({
      ...deps,
      getRun: async () => ({ ...run, currentPhaseId: null }),
    }, 'run1')

    expect(source?.currentPhaseLabel).toBeNull()
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/projections/buildProjectionSource.test.ts`
Expected: FAIL — `currentPhaseLabel` が `LessonRunProjectionSource` に存在しない旨の型エラー

- [ ] **Step 3: `source.ts` に `currentPhaseLabel` を足す**

`LessonRunProjectionSource` の `currentPhasePublicTask` の直後に追加する。

```ts
  /**
   * 現在フェーズの教師・生徒向け日本語名（`displayConfig.label`）。
   * 内部IDそのものを画面に出さないために projection へ載せる。フェーズ名は
   * 価格・係数・シードを何も含まず、教室に投影してよい情報である。
   * ラベルが設定されていないフェーズでは `null`。
   */
  currentPhaseLabel: string | null
```

- [ ] **Step 4: `currentPhaseEndsAtMillis` の JSDoc を書き換える**

Task 4 で公開するため、先に説明を実態へ合わせる。

置換前:
```ts
  /** Epoch millis the current phase's timer ends, or null when no timer is running. Used only to derive a countdown (`remainingPhaseSeconds`) — never exposed itself. */
```
置換後:
```ts
  /**
   * 現在フェーズの終了時刻（エポックミリ秒）。制限時間の無いフェーズでは null。
   * public/display の両 projection にそのまま載る。フェーズの終了時刻は未来の
   * 価格・係数・乱数シードを何も明かさないため §26-1 の禁止対象には当たらず、
   * 同じ理由で `nextBatchAtMillis` が既に公開されている。残り秒数を
   * サーバ側で計算して渡すと publish 時点で固定されて古くなるため、時刻を
   * 渡してクライアントが描き直す（`nextBatchAtMillis` と同じ規約）。
   */
```

- [ ] **Step 5: `buildProjectionSource.ts` で解決する**

import を追加する。

```ts
import { findPhaseLabel, type PhaseWithDisplayConfig } from '../phases/phaseLabel'
```

`PhaseSnapshot` を `PhaseWithDisplayConfig` を含む形に変える。

置換前:
```ts
interface PhaseSnapshot {
  id: string
  publicTask?: string | null
}
```
置換後:
```ts
interface PhaseSnapshot extends PhaseWithDisplayConfig {
  publicTask?: string | null
}
```

返り値オブジェクトの `currentPhasePublicTask` の直後に追加する。

```ts
    currentPhaseLabel: findPhaseLabel(templateSnapshot.phases, currentPhaseId),
```

- [ ] **Step 6: 既存の `LessonRunProjectionSource` フィクスチャに追加する**

新しい必須フィールドのため、source を丸ごと構築している3箇所を直す。

Run: `grep -rn "currentPhasePublicTask" functions/src test --include="*.ts" | grep -v "source.ts\|buildProjectionSource.ts"`

見つかった各フィクスチャの `currentPhasePublicTask` の行の直後に次を足す。

```ts
  currentPhaseLabel: '取引',
```

`test/lesson-lifecycle.acceptance.test.ts` の禁止情報テストのフィクスチャにも同様に足す。

- [ ] **Step 7: テストを実行して緑を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/projections && npx tsc -p tsconfig.rules.json --noEmit`
Expected: 双方とも成功

- [ ] **Step 8: コミット**

```bash
git add -A functions/src/lessonRuns/projections test/lesson-lifecycle.acceptance.test.ts
git commit -m "$(cat <<'EOF'
feat: resolve the current phase's label into the projection source

buildDefaultPhases has carried Japanese labels in displayConfig since it was
written; nothing ever read them, so the control room showed the raw phase id.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `currentPhaseLabel` を public / display の allow-list に載せる

**Files:**
- Modify: `functions/src/lessonRuns/projections/publicProjection.ts`
- Modify: `functions/src/lessonRuns/projections/publicProjection.test.ts`
- Modify: `functions/src/lessonRuns/projections/displayProjection.ts`
- Modify: `functions/src/lessonRuns/projections/displayProjection.test.ts`
- Modify: `src/lib/lessonRuns/liveTypes.ts`

**Interfaces:**
- Consumes: Task 2 の `LessonRunProjectionSource.currentPhaseLabel`
- Produces: `LessonRunPublicState.currentPhaseLabel: string | null` と `LessonRunDisplayState.currentPhaseLabel: string | null`（サーバ・クライアント双方の型）

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonRuns/projections/publicProjection.test.ts` の末尾に追加する。フィクスチャ名は同ファイル冒頭のものに合わせる。

```ts
it('currentPhaseLabel を公開状態に含める', () => {
  const source = { ...privateRunFixture, currentPhaseLabel: '取引' }
  expect(toLessonRunPublicState(source, 6_000).currentPhaseLabel).toBe('取引')
})
```

`functions/src/lessonRuns/projections/displayProjection.test.ts` の末尾に追加する。

```ts
it('currentPhaseLabel を教室表示に含める', () => {
  const source = { ...privateRunFixture, currentPhaseLabel: '取引' }
  expect(toLessonRunDisplayState(source, 6_000).currentPhaseLabel).toBe('取引')
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/projections`
Expected: FAIL — `currentPhaseLabel` が出力型に存在しない旨の型エラー

- [ ] **Step 3: サーバ側の2つの projection に足す**

`publicProjection.ts` の `LessonRunPublicState` の `currentPhaseId` の直後に追加する。

```ts
  currentPhaseLabel: string | null
```

`toLessonRunPublicState` の返り値の `currentPhaseId` の直後に追加する。

```ts
  currentPhaseLabel: source.currentPhaseLabel,
```

`displayProjection.ts` の `LessonRunDisplayState` の `title` の直後に追加する。

```ts
  currentPhaseLabel: string | null
```

`toLessonRunDisplayState` の返り値の `title` の直後に追加する。

```ts
  currentPhaseLabel: source.currentPhaseLabel,
```

- [ ] **Step 4: クライアント側の型を手動同期する**

`src/lib/lessonRuns/liveTypes.ts` の `LessonRunPublicState` の `currentPhaseId` の直後に追加する。

```ts
  /** 現在フェーズの日本語名。内部IDを画面に出さないための表示用。ラベル未設定のフェーズでは null。 */
  currentPhaseLabel: string | null
```

同ファイルの `LessonRunDisplayState` の `title` の直後にも同じ行を追加する。

- [ ] **Step 5: テストを実行して緑を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/projections && npm test -- src/lib/lessonRuns`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add -A functions/src/lessonRuns/projections src/lib/lessonRuns/liveTypes.ts
git commit -m "$(cat <<'EOF'
feat: publish currentPhaseLabel on the public and display projections

A phase name carries no price, coefficient, or seed, and is meant to be
projected, so it belongs on both allow-lists.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `remainingPhaseSeconds` を `currentPhaseEndsAtMillis` に置き換える

publish 時点の残り秒数は次の publish まで固定されて古くなる。時刻を渡してクライアントが描き直す形（`nextBatchAtMillis` と同じ規約）に変える。

**Files:**
- Modify: `functions/src/lessonRuns/projections/publicProjection.ts`
- Modify: `functions/src/lessonRuns/projections/publicProjection.test.ts`
- Modify: `functions/src/lessonRuns/projections/displayProjection.ts`
- Modify: `functions/src/lessonRuns/projections/displayProjection.test.ts`
- Modify: `src/lib/lessonRuns/liveTypes.ts`
- Modify: `src/components/teacher/LessonControlRoom.tsx`
- Modify: `src/components/teacher/LessonControlRoom.test.tsx`

**Interfaces:**
- Consumes: Task 2 の `source.currentPhaseEndsAtMillis`
- Produces: `LessonRunPublicState.currentPhaseEndsAtMillis: number | null`（`remainingPhaseSeconds` は消滅）、`LessonRunDisplayState.currentPhaseEndsAtMillis: number | null`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonRuns/projections/publicProjection.test.ts` の `remainingPhaseSeconds` を検証している既存テストを次に置き換える。

Run: `grep -n "remainingPhaseSeconds" functions/src/lessonRuns/projections/publicProjection.test.ts`

該当するアサーションを次の形に直す。

```ts
it('currentPhaseEndsAtMillis をそのまま公開する', () => {
  const source = { ...privateRunFixture, currentPhaseEndsAtMillis: 10_000 }
  const state = toLessonRunPublicState(source, 6_000)
  expect(state.currentPhaseEndsAtMillis).toBe(10_000)
  expect(state).not.toHaveProperty('remainingPhaseSeconds')
})

it('制限時間の無いフェーズでは null', () => {
  const source = { ...privateRunFixture, currentPhaseEndsAtMillis: null }
  expect(toLessonRunPublicState(source, 6_000).currentPhaseEndsAtMillis).toBeNull()
})
```

`functions/src/lessonRuns/projections/displayProjection.test.ts` の末尾に追加する。

```ts
it('currentPhaseEndsAtMillis を教室表示に含める', () => {
  const source = { ...privateRunFixture, currentPhaseEndsAtMillis: 10_000 }
  expect(toLessonRunDisplayState(source, 6_000).currentPhaseEndsAtMillis).toBe(10_000)
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/projections`
Expected: FAIL — `currentPhaseEndsAtMillis` が出力型に存在しない旨の型エラー

- [ ] **Step 3: `publicProjection.ts` を置き換える**

`LessonRunPublicState` の該当行を置き換える。

置換前:
```ts
  remainingPhaseSeconds: number | null
```
置換後:
```ts
  currentPhaseEndsAtMillis: number | null
```

`toLessonRunPublicState` の該当行を置き換える。

置換前:
```ts
  remainingPhaseSeconds: remainingSeconds(source.currentPhaseEndsAtMillis, nowMillis),
```
置換後:
```ts
  currentPhaseEndsAtMillis: source.currentPhaseEndsAtMillis,
```

不要になった `remainingSeconds` ヘルパー関数を削除する。

削除するブロック:
```ts
/** Plain countdown, clamped so a phase whose end has already passed reports 0 rather than a negative number. */
const remainingSeconds = (endsAtMillis: number | null, nowMillis: number): number | null => {
  if (endsAtMillis === null) return null
  return Math.max(0, Math.round((endsAtMillis - nowMillis) / 1000))
}
```

`toLessonRunPublicState` の `nowMillis` 引数が未使用になる場合は `_nowMillis` に改名する（`toLessonRunDisplayState` が既にそうしている）。`publishLessonProjection` は両方に同じ `nowMillis` を渡し続けるため、シグネチャは変えない。

- [ ] **Step 4: `displayProjection.ts` に足す**

`LessonRunDisplayState` の `currentPhaseLabel` の直後に追加する。

```ts
  currentPhaseEndsAtMillis: number | null
```

`toLessonRunDisplayState` の `currentPhaseLabel` の直後に追加する。

```ts
  currentPhaseEndsAtMillis: source.currentPhaseEndsAtMillis,
```

- [ ] **Step 5: クライアント側の型を手動同期する**

`src/lib/lessonRuns/liveTypes.ts` の `LessonRunPublicState` の該当行を置き換える。

置換前:
```ts
  remainingPhaseSeconds: number | null
```
置換後:
```ts
  /**
   * 現在フェーズの終了時刻（エポックミリ秒）。制限時間の無いフェーズでは null。
   * サーバが書いた値であり、クライアントはこの時刻までのカウントダウンを描く
   * だけで、自分でタイマーを進めてはならない（`nextBatchAtMillis` と同じ規約）。
   */
  currentPhaseEndsAtMillis: number | null
```

`LessonRunDisplayState` の `currentPhaseLabel` の直後にも同じフィールドを追加する。

- [ ] **Step 6: `LessonControlRoom` の判定元を変える**

置換前:
```tsx
        phaseHasTimer={publicState?.remainingPhaseSeconds != null}
```
置換後:
```tsx
        phaseHasTimer={publicState?.currentPhaseEndsAtMillis != null}
```

`LessonControlRoom.test.tsx` で `remainingPhaseSeconds` を渡している `emitPublic` 呼び出しがあれば `currentPhaseEndsAtMillis` に直す。

Run: `grep -n "remainingPhaseSeconds" src/components/teacher/LessonControlRoom.test.tsx`

- [ ] **Step 7: テストを実行して緑を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/projections && npm test -- src/components/teacher src/lib/lessonRuns`
Expected: PASS

- [ ] **Step 8: 残存確認**

Run: `grep -rn "remainingPhaseSeconds" src functions/src test --include="*.ts" --include="*.tsx"`
Expected: 出力なし（該当なしで終了コード1）

- [ ] **Step 9: コミット**

```bash
git add -A functions/src src/lib src/components/teacher
git commit -m "$(cat <<'EOF'
feat: publish the phase end time instead of a stale remaining count

remainingPhaseSeconds was computed at publish time, and publishes only happen
on transitions, so it stayed frozen for the whole phase. nextBatchAtMillis
already established the right shape: send the timestamp, let the client tick.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: ウィザードの時間を `LessonContent` に保存する

**Files:**
- Modify: `src/lib/lessonTemplates/types.ts`
- Modify: `src/lib/lessonTemplates/guidedBuilderPresets.ts`
- Modify: `src/lib/lessonTemplates/guidedBuilderPresets.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  ```ts
  // src/lib/lessonTemplates/types.ts
  // LessonContent.coreActivityMinutes?: number
  // src/lib/lessonTemplates/guidedBuilderPresets.ts
  export const NON_CORE_PHASE_ALLOWANCE_MINUTES = 15
  export const MIN_CORE_ACTIVITY_MINUTES = 5
  ```

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/lessonTemplates/guidedBuilderPresets.test.ts` の末尾（最後の `})` の直前）に追加する。`answers` の組み立ては同ファイルの既存テストが使っている形をコピーして使う。

```ts
describe('coreActivityMinutes', () => {
  const socialAnswers = {
    goal: 'MARKET_AND_INVESTING',
    mainObjective: '市場のしくみ', lessonDurationMinutes: 50, studentCount: 30,
    deviceEnvironment: 'ONE_PER_STUDENT', teamMode: 'TEAM', readingDepth: 'STANDARD',
    theme: '需給と価格', difficulty: 'STANDARD',
    companyCount: 5, useEarnings: true, useUncertainty: false,
    infoVsDemandWeight: 'BALANCED', alwaysOnMarketMinutes: 20,
    predictionCheckpoints: 2, evaluationFocus: 'OPERATION_RESULT',
  } as const

  const homeAnswers = {
    goal: 'LIFE_PLANNING',
    mainObjective: '生活設計', lessonDurationMinutes: 50, studentCount: 30,
    deviceEnvironment: 'ONE_PER_STUDENT', teamMode: 'TEAM', readingDepth: 'STANDARD',
    theme: 'ライフプラン', difficulty: 'STANDARD',
    lifeStageFocus: 'FAMILY_FORMATION', courseFormat: 'COMMON_CONDITIONS', roundYears: 5,
    coveredConcepts: ['ASSETS'], eventDisclosure: 'ANNOUNCED', evaluationFocus: 'STABILITY',
  } as const

  it('社会科は alwaysOnMarketMinutes をそのまま使う', () => {
    expect(buildDraftFromAnswers(socialAnswers, 'STANDARD').coreActivityMinutes).toBe(20)
  })

  it('家庭科は授業時間から他フェーズ分を引く', () => {
    expect(buildDraftFromAnswers(homeAnswers, 'STANDARD').coreActivityMinutes).toBe(50 - 15)
  })

  it('短い授業時間でも下限を下回らない', () => {
    const short = { ...homeAnswers, lessonDurationMinutes: 10 }
    expect(buildDraftFromAnswers(short, 'STANDARD').coreActivityMinutes).toBe(5)
  })

  it('社会科の市場分数が0でも下限を下回らない', () => {
    const short = { ...socialAnswers, alwaysOnMarketMinutes: 0 }
    expect(buildDraftFromAnswers(short, 'STANDARD').coreActivityMinutes).toBe(5)
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test -- src/lib/lessonTemplates/guidedBuilderPresets.test.ts`
Expected: FAIL — `coreActivityMinutes` が `LessonContent` に存在しない旨の型エラー

- [ ] **Step 3: `LessonContent` にフィールドを足す**

`src/lib/lessonTemplates/types.ts` の `LessonContent` の `subject` の直後に追加する。

```ts
  /**
   * 中核フェーズ（社会科は取引、家庭科は意思決定）に充てる分数。
   * `buildDefaultPhases` がこの値を中核フェーズの `durationSeconds` にする。
   *
   * 任意フィールドである。この値が導入される前に作られた教材は持たず、その
   * 場合は従来どおり全フェーズが制限時間なしで動く。既存ドキュメントの読み
   * 取りが壊れる変更ではないため `schemaVersion` は上げない。
   */
  coreActivityMinutes?: number
```

- [ ] **Step 4: `buildDraftFromAnswers` で埋める**

`src/lib/lessonTemplates/guidedBuilderPresets.ts` のファイル先頭付近（既存の定数群の近く）に追加する。

```ts
/**
 * 中核フェーズ以外（導入・結果・振り返り）に見込む合計分数。各5分の想定。
 *
 * 暫定値である。このリポジトリの既存の扱い（validation.ts の
 * `PROVISIONAL_MAX_TOTAL_DURATION_SECONDS`）と同じく、試運転で実際の授業
 * 進行を見てから調整する前提で名前付き定数にしている。
 *
 * 社会科ではこの定数を使わない。ウィザードが `alwaysOnMarketMinutes`
 * （市場を動かす分数）を直接聞いており、教師の明示的な回答を捨てて導出値
 * に置き換えるのは改悪になるため。
 */
export const NON_CORE_PHASE_ALLOWANCE_MINUTES = 15

/** 中核フェーズの下限。教師が極端に短い授業時間を入れても0分や負にしない。 */
export const MIN_CORE_ACTIVITY_MINUTES = 5

const resolveCoreActivityMinutes = (answers: WizardAnswers): number => {
  const raw = answers.goal === 'MARKET_AND_INVESTING'
    ? answers.alwaysOnMarketMinutes
    : answers.lessonDurationMinutes - NON_CORE_PHASE_ALLOWANCE_MINUTES
  return Math.max(MIN_CORE_ACTIVITY_MINUTES, Math.round(raw))
}
```

`buildDraftFromAnswers` の本体先頭に追加する。

```ts
  const coreActivityMinutes = resolveCoreActivityMinutes(answers)
```

社会科の返り値オブジェクトの `subject: 'SOCIAL_STUDIES',` の直後に `coreActivityMinutes,` を挿入する。家庭科の返り値オブジェクトの `subject: 'HOME_ECONOMICS',` の直後にも同じく `coreActivityMinutes,` を挿入する。

- [ ] **Step 5: テストを実行して緑を確認する**

Run: `npm test -- src/lib/lessonTemplates`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add -A src/lib/lessonTemplates
git commit -m "$(cat <<'EOF'
feat: keep the wizard's lesson minutes in LessonContent

lessonDurationMinutes and alwaysOnMarketMinutes were collected and then
discarded by buildDraftFromAnswers, so nothing downstream could ever give a
phase a duration.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 中核フェーズだけに制限時間を与える

**Files:**
- Modify: `functions/src/lessonRuns/phases/defaultPhases.ts`
- Modify: `functions/src/lessonRuns/phases/defaultPhases.test.ts`
- Modify: `functions/src/lessonRuns/createLessonRun.ts`
- Modify: `functions/src/lessonRuns/createLessonRun.test.ts`

**Interfaces:**
- Consumes: Task 5 の `LessonContent.coreActivityMinutes`
- Produces: `buildDefaultPhases(subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS', coreActivityMinutes?: number): DefaultPhaseGraph`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonRuns/phases/defaultPhases.test.ts` の末尾（最後の `})` の直前）に追加する。

```ts
describe('coreActivityMinutes', () => {
  it('社会科では取引フェーズだけが durationSeconds を持つ', () => {
    const { phases } = buildDefaultPhases('SOCIAL_STUDIES', 20)
    const withDuration = phases.filter((phase) => typeof phase.durationSeconds === 'number')

    expect(withDuration).toHaveLength(1)
    expect(withDuration[0].id).toBe('market')
    expect(withDuration[0].durationSeconds).toBe(20 * 60)
  })

  it('家庭科では意思決定フェーズだけが durationSeconds を持つ', () => {
    const { phases } = buildDefaultPhases('HOME_ECONOMICS', 35)
    const withDuration = phases.filter((phase) => typeof phase.durationSeconds === 'number')

    expect(withDuration).toHaveLength(1)
    expect(withDuration[0].id).toBe('decision')
    expect(withDuration[0].durationSeconds).toBe(35 * 60)
  })

  it('省略時はどのフェーズも durationSeconds を持たない', () => {
    const { phases } = buildDefaultPhases('SOCIAL_STUDIES')
    expect(phases.every((phase) => phase.durationSeconds === undefined)).toBe(true)
  })

  it('progression は TEACHER_CONTROLLED のまま変えない', () => {
    const { phases } = buildDefaultPhases('SOCIAL_STUDIES', 20)
    expect(phases.every((phase) => phase.progression === 'TEACHER_CONTROLLED')).toBe(true)
  })

  it('0以下の分数は無視する', () => {
    const { phases } = buildDefaultPhases('SOCIAL_STUDIES', 0)
    expect(phases.every((phase) => phase.durationSeconds === undefined)).toBe(true)
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/phases/defaultPhases.test.ts`
Expected: FAIL — `buildDefaultPhases` が引数を1つしか受け取らない旨の型エラー

- [ ] **Step 3: `buildDefaultPhases` を実装する**

`functions/src/lessonRuns/phases/defaultPhases.ts` の JSDoc に段落を追加する。

```
 * `coreActivityMinutes` を渡すと、中核フェーズ（社会科は market、家庭科は
 * decision）だけに `durationSeconds` を設定する。progression は
 * `TEACHER_CONTROLLED` のまま変えない — `TIMED` は validation.ts が検証する
 * だけで、満了時にフェーズを進めるスケジューラはこのコードベースに存在
 * しないため、`TIMED` にすると起きない自動進行を約束することになる。設定
 * された時間はあくまで教師と生徒に見せる目安であり、超過しても何も起きない。
```

シグネチャと本体を置き換える。

```ts
export const buildDefaultPhases = (
  subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS',
  coreActivityMinutes?: number,
): DefaultPhaseGraph => {
  const coreDuration = typeof coreActivityMinutes === 'number' && coreActivityMinutes > 0
    ? { durationSeconds: coreActivityMinutes * 60 }
    : {}

  const middlePhase: LessonPhase = subject === 'SOCIAL_STUDIES'
    ? { id: 'market', type: 'MARKET', progression: 'TEACHER_CONTROLLED', nextPhaseIds: ['result'], displayConfig: { label: '取引' }, ...coreDuration }
    : { id: 'decision', type: 'DECISION', progression: 'TEACHER_CONTROLLED', nextPhaseIds: ['result'], displayConfig: { label: '意思決定' }, ...coreDuration }

  const phases: LessonPhase[] = [
    { id: 'intro', type: 'INTRO', progression: 'TEACHER_CONTROLLED', nextPhaseIds: [middlePhase.id], displayConfig: { label: '導入' } },
    middlePhase,
    { id: 'result', type: 'RESULT', progression: 'TEACHER_CONTROLLED', nextPhaseIds: ['reflection'], displayConfig: { label: '結果' } },
    { id: 'reflection', type: 'REFLECTION', progression: 'TEACHER_CONTROLLED', nextPhaseIds: [], displayConfig: { label: '振り返り' } },
  ]

  return { phases, initialPhaseId: 'intro' }
}
```

- [ ] **Step 4: テストを実行して緑を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/phases/defaultPhases.test.ts`
Expected: PASS

- [ ] **Step 5: `createLessonRun` から渡す**

`functions/src/lessonRuns/createLessonRun.ts` の該当行を置き換える。

置換前:
```ts
    const contentSubject = (version.content as { subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS' }).subject
    const defaultPhaseGraph = buildDefaultPhases(contentSubject)
```
置換後:
```ts
    const content = version.content as { subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS'; coreActivityMinutes?: number }
    const contentSubject = content.subject
    const defaultPhaseGraph = buildDefaultPhases(contentSubject, content.coreActivityMinutes)
```

- [ ] **Step 6: `createLessonRun` のテストを足す**

`functions/src/lessonRuns/createLessonRun.test.ts` の末尾（最後の `})` の直前）に追加する。既存テストが `version.content` を用意している箇所をコピーし、`coreActivityMinutes: 20` を足した版で呼ぶ。

```ts
it('教材の coreActivityMinutes を中核フェーズの制限時間にする', async () => {
  const fake = makeFakeFirestore()
  setUpTemplate(fake.docs, { content: { schemaVersion: 1, title: 'T', description: 'D', subject: 'SOCIAL_STUDIES', coreActivityMinutes: 20 } })

  const result = await createLessonRun(buildDeps(fake))

  const run = fake.docs.get(`lessonRuns/${result.lessonRunId}`) as { templateSnapshot: { phases: Array<{ id: string; durationSeconds?: number }> } }
  const market = run.templateSnapshot.phases.find((phase) => phase.id === 'market')
  expect(market?.durationSeconds).toBe(20 * 60)
})
```

ヘルパー名（`makeFakeFirestore` / `setUpTemplate` / `buildDeps`）は同ファイル内の既存のものに合わせる。

Run: `grep -n "^const \|^function " functions/src/lessonRuns/createLessonRun.test.ts`

- [ ] **Step 7: テストを実行して緑を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns`
Expected: PASS

- [ ] **Step 8: コミット**

```bash
git add -A functions/src/lessonRuns
git commit -m "$(cat <<'EOF'
feat: give the core phase a duration from the template

Only the core phase (market / decision) gets one, and progression stays
TEACHER_CONTROLLED: nothing in this codebase advances a phase when its timer
expires, so TIMED would promise automation that does not exist.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 残り時間を描く `PhaseCountdown`

**Files:**
- Create: `src/components/ui/PhaseCountdown.tsx`
- Create: `src/components/ui/PhaseCountdown.test.tsx`

**Interfaces:**
- Consumes: なし
- Produces:
  ```ts
  export interface PhaseCountdownProps {
    endsAtMillis: number | null | undefined
    /** テスト用に差し替え可能。既定は Date.now。 */
    now?: () => number
  }
  export function PhaseCountdown(props: PhaseCountdownProps): JSX.Element | null
  ```

- [ ] **Step 1: 失敗するテストを書く**

`src/components/ui/PhaseCountdown.test.tsx` を新規作成する。

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { PhaseCountdown } from './PhaseCountdown'

afterEach(() => { vi.useRealTimers() })

describe('PhaseCountdown', () => {
  it('残り時間を分と秒で表示する', () => {
    render(<PhaseCountdown endsAtMillis={1_000_000 + 125_000} now={() => 1_000_000} />)
    expect(screen.getByText('残り 2:05')).toBeInTheDocument()
  })

  it('1秒ごとに描き直す', () => {
    vi.useFakeTimers()
    let current = 1_000_000
    render(<PhaseCountdown endsAtMillis={1_000_000 + 125_000} now={() => current} />)

    expect(screen.getByText('残り 2:05')).toBeInTheDocument()
    act(() => { current = 1_003_000; vi.advanceTimersByTime(3_000) })

    expect(screen.getByText('残り 2:02')).toBeInTheDocument()
  })

  it('0以下では時間終了と表示し、負の数を出さない', () => {
    render(<PhaseCountdown endsAtMillis={1_000_000} now={() => 1_030_000} />)
    expect(screen.getByText('時間終了')).toBeInTheDocument()
  })

  it('endsAtMillis が null なら何も描かない', () => {
    const { container } = render(<PhaseCountdown endsAtMillis={null} now={() => 1_000_000} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('アンマウントでタイマーを解除する', () => {
    vi.useFakeTimers()
    const clearSpy = vi.spyOn(globalThis, 'clearInterval')
    const { unmount } = render(<PhaseCountdown endsAtMillis={1_000_000 + 60_000} now={() => 1_000_000} />)

    unmount()

    expect(clearSpy).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test -- src/components/ui/PhaseCountdown.test.tsx`
Expected: FAIL — `Failed to resolve import "./PhaseCountdown"`

- [ ] **Step 3: 実装する**

`src/components/ui/PhaseCountdown.tsx` を新規作成する。

```tsx
import { useEffect, useState } from 'react'
import { Chip } from '@mui/material'

export interface PhaseCountdownProps {
  /** 現在フェーズの終了時刻（エポックミリ秒）。制限時間の無いフェーズでは null。 */
  endsAtMillis: number | null | undefined
  /** テスト用に差し替え可能。既定は `Date.now`。 */
  now?: () => number
}

const formatRemaining = (remainingSeconds: number): string => {
  const minutes = Math.floor(remainingSeconds / 60)
  const seconds = remainingSeconds % 60
  return `残り ${minutes}:${String(seconds).padStart(2, '0')}`
}

/**
 * フェーズの残り時間。サーバは終了時刻だけを渡し、この部品が毎秒描き直す
 * （`LessonRunPublicState.currentPhaseEndsAtMillis` の規約 — publish は状態
 * 遷移のときにしか起きないため、サーバ側で残り秒数を計算して渡すとフェーズ
 * の間ずっと固定されて古くなる）。
 *
 * フェーズは満了しても自動では進まない（`defaultPhases.ts` 参照）ため、
 * 超過状態は異常ではなく正常に起こりうる。負の数を出さず「時間終了」と
 * 表示して、教師が進めるまでそのまま待つ。
 *
 * 端末の時計とサーバの時計のずれの分だけ誤差が出るが、授業運用上その精度で
 * 足りるため補正しない。
 */
export function PhaseCountdown({ endsAtMillis, now = Date.now }: PhaseCountdownProps) {
  // 値は使わない。1秒ごとに再描画を起こすためだけの state。
  const [, forceTick] = useState(0)

  useEffect(() => {
    if (endsAtMillis == null) return
    const timer = setInterval(() => forceTick((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [endsAtMillis])

  if (endsAtMillis == null) return null

  // `now` は描画時にだけ呼ぶ。effect の依存に入れないので、呼び出し側が
  // インラインの関数を渡しても effect が張り直されない。
  const remainingSeconds = Math.floor((endsAtMillis - now()) / 1000)

  return remainingSeconds > 0
    ? <Chip label={formatRemaining(remainingSeconds)} color={remainingSeconds <= 60 ? 'warning' : 'default'} />
    : <Chip label="時間終了" color="error" />
}
```

- [ ] **Step 4: テストを実行して緑を確認する**

Run: `npm test -- src/components/ui/PhaseCountdown.test.tsx`
Expected: PASS（5件）

- [ ] **Step 5: コミット**

```bash
git add src/components/ui/PhaseCountdown.tsx src/components/ui/PhaseCountdown.test.tsx
git commit -m "$(cat <<'EOF'
feat: add a ticking phase countdown

Renders against the server-sent end time rather than a precomputed remaining
count, and shows 時間終了 instead of a negative number because phases do not
auto-advance when their time is up.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 教師画面にフェーズ名と残り時間を出す

**Files:**
- Modify: `src/components/teacher/LessonStatusHeader.tsx`
- Modify: `src/components/teacher/LessonStatusHeader.test.tsx`
- Modify: `src/components/teacher/LessonControlRoom.tsx`
- Modify: `src/components/teacher/LessonControlRoom.test.tsx`

**Interfaces:**
- Consumes: Task 3 の `currentPhaseLabel`、Task 4 の `currentPhaseEndsAtMillis`、Task 7 の `PhaseCountdown`
- Produces: `LessonStatusHeaderProps.phaseEndsAtMillis?: number | null`

- [ ] **Step 1: 失敗するテストを書く**

`src/components/teacher/LessonControlRoom.test.tsx` の `describe` 内の末尾に追加する。`emitPublic` / `emitDisplay` / `emitParticipants` / `functions` / `firestore` / `database` は同ファイル内の既存ヘルパー。

```tsx
  it('フェーズの日本語名を表示する', () => {
    render(<LessonControlRoom lessonRunId="run-1" role="PRIMARY" functions={functions} firestore={firestore} database={database} />)
    emitPublic({ status: 'RUNNING', currentPhaseId: 'market', currentPhaseLabel: '取引' })
    emitDisplay({ mode: 'LIVE', title: 'テスト授業' })
    emitParticipants([])

    expect(screen.getByText('取引')).toBeInTheDocument()
    expect(screen.queryByText('market')).not.toBeInTheDocument()
  })

  it('ラベルが無ければフェーズIDにフォールバックする', () => {
    render(<LessonControlRoom lessonRunId="run-1" role="PRIMARY" functions={functions} firestore={firestore} database={database} />)
    emitPublic({ status: 'RUNNING', currentPhaseId: 'market', currentPhaseLabel: null })
    emitDisplay({ mode: 'LIVE', title: 'テスト授業' })
    emitParticipants([])

    expect(screen.getByText('market')).toBeInTheDocument()
  })

  it('制限時間のあるフェーズでは残り時間を表示する', () => {
    render(<LessonControlRoom lessonRunId="run-1" role="PRIMARY" functions={functions} firestore={firestore} database={database} />)
    emitPublic({
      status: 'RUNNING', currentPhaseId: 'market', currentPhaseLabel: '取引',
      currentPhaseEndsAtMillis: Date.now() + 120_000,
    })
    emitDisplay({ mode: 'LIVE', title: 'テスト授業' })
    emitParticipants([])

    expect(screen.getByText(/^残り /)).toBeInTheDocument()
  })
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test -- src/components/teacher/LessonControlRoom.test.tsx`
Expected: FAIL — `Unable to find an element with the text: 取引`

- [ ] **Step 3: `LessonStatusHeader` に終了時刻を受け取らせる**

`LessonStatusHeaderProps` の `phaseLabel` の直後に追加する。

```ts
  /** 現在フェーズの終了時刻（エポックミリ秒）。制限時間の無いフェーズでは null/未指定。 */
  phaseEndsAtMillis?: number | null
```

import を追加する。

```tsx
import { PhaseCountdown } from '../ui/PhaseCountdown'
```

引数の分割代入に `phaseEndsAtMillis` を足し、「現在のフェーズ」セクションの本文を置き換える。

置換前:
```tsx
        <Typography variant="body1">{phaseLabel}</Typography>
```
置換後:
```tsx
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="body1">{phaseLabel}</Typography>
          <PhaseCountdown endsAtMillis={phaseEndsAtMillis} />
        </Stack>
```

- [ ] **Step 4: `LessonControlRoom` から渡す**

`phaseLabel` の算出を置き換える。

置換前:
```tsx
  const phaseLabel = publicState?.currentPhaseId ?? (status === 'DRAFT' || status === 'READY' ? '未開始' : status)
```
置換後:
```tsx
  // 内部IDそのものは教師に読めないので、まず projection のラベルを使う。
  // ラベルを持たない古い run のために ID へフォールバックする。
  const phaseLabel = publicState?.currentPhaseLabel
    ?? publicState?.currentPhaseId
    ?? (status === 'DRAFT' || status === 'READY' ? '未開始' : status)
```

`LessonStatusHeader` の呼び出しに props を追加する。

```tsx
        phaseEndsAtMillis={publicState?.currentPhaseEndsAtMillis ?? null}
```

- [ ] **Step 5: テストを実行して緑を確認する**

Run: `npm test -- src/components/teacher`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add -A src/components/teacher
git commit -m "$(cat <<'EOF'
feat: show the phase name and countdown in the control room

The header showed currentPhaseId verbatim, which is a string no teacher can
read, and no remaining time at all.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: 次フェーズを graph から解決し、行き先を CTA に出す

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: Task 1 の `findPhaseLabel` / `readPhaseLabel`
- Produces: `TeacherAccess.phases?: PhaseWithDisplayConfig[]`（`defaultPhaseSequence` は消滅）

- [ ] **Step 1: 失敗するテストを書く**

`src/App.test.tsx` の末尾（最後の `})` の直前）に追加する。既存の Firestore モックが `lessonRuns/{id}` を返す仕組みに合わせて `templateSnapshot.phases` を含める。

Run: `grep -n "lessonRuns" src/App.test.tsx | head`

見つかったモックの run ドキュメントに次を含めた上で、テストを書く。

```tsx
it('次のフェーズの名前を CTA に出す', async () => {
  // run: status RUNNING / currentPhaseId 'market' /
  // templateSnapshot.phases = buildDefaultPhases 相当（market -> result）
  renderAppAt('/teacher/lessons/run-1/control')

  expect(await screen.findByRole('button', { name: '次へ：結果' })).toBeInTheDocument()
})

it('最終フェーズでは次フェーズの CTA を出さない', async () => {
  // run: status RUNNING / currentPhaseId 'reflection' / nextPhaseIds: []
  renderAppAt('/teacher/lessons/run-1/control')

  expect(await screen.findByRole('heading', { name: '次にすること' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^次へ：/ })).not.toBeInTheDocument()
})
```

`renderAppAt` は同ファイル内の既存レンダリングヘルパー名に合わせる。

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test -- src/App.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "button" and name "次へ：結果"`

- [ ] **Step 3: `useTeacherLessonAccess` に `phases` を足す**

`TeacherAccess` に追加する。

```ts
  phases?: PhaseWithDisplayConfig[]
```

import を追加する。

```ts
import { findPhaseLabel, readPhaseLabel, type PhaseWithDisplayConfig } from './lib/lessonRuns/phaseLabel'
```

`useTeacherLessonAccess` の中で run ドキュメントから読み出す。`data` の型注釈に `templateSnapshot?: { phases?: PhaseWithDisplayConfig[]; homeEconomics?: { courseFormat?: string } }` を足し、`setAccess` の `GRANTED` 分岐に `phases: data.templateSnapshot?.phases` を追加する。

- [ ] **Step 4: 手写し配列を削除する**

`src/App.tsx` の `defaultPhaseSequence` の定義と、その上の JSDoc ブロックを削除する。

削除するもの:
```ts
/**
 * Mirrors functions/src/lessonRuns/phases/defaultPhases.ts's fixed 4-phase
 * ...
 */
const defaultPhaseSequence = (subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS' | undefined): string[] =>
  subject === 'HOME_ECONOMICS' ? ['intro', 'decision', 'result', 'reflection'] : ['intro', 'market', 'result', 'reflection']
```

- [ ] **Step 5: `TeacherControlRoute` で graph から解決する**

`LessonControlRoom` を返す直前に次を追加する。

```tsx
  const phases = access.phases ?? []
  const resolveNextPhaseId = (currentPhaseId: string | null): string | null => {
    if (!currentPhaseId) return null
    const current = phases.find((phase) => phase.id === currentPhaseId)
    return current?.nextPhaseIds?.[0] ?? null
  }
```

`onAdvancePhase` を置き換える。

```tsx
    onAdvancePhase={async (currentPhaseId) => {
      if (!runId) return
      const nextPhaseId = resolveNextPhaseId(currentPhaseId)
      if (!nextPhaseId) return
      await transitionPhase(services.functions, {
        lessonRunId: runId, targetPhaseId: nextPhaseId, reason: '教師操作: 次のフェーズへ進む', idempotencyKey: crypto.randomUUID(),
      })
      // 振り返りフェーズに入ったら授業の status も REFLECTION へ移す。
      // フェーズIDの文字列ではなく graph の type で判定するので、教材が独自の
      // フェーズ構成を持つようになっても正しく動く。
      const nextPhase = phases.find((phase) => phase.id === nextPhaseId)
      if (nextPhase?.type === 'REFLECTION') {
        await transitionPhase(services.functions, {
          lessonRunId: runId, targetStatus: 'REFLECTION', reason: '教師操作: 次のフェーズへ進む', idempotencyKey: crypto.randomUUID(),
        })
      }
    }}
```

- [ ] **Step 6: CTA ラベルに行き先を出す**

現在フェーズを購読しているのは `LessonControlRoom` だけであり、ルート側はそれを知らない。したがって `advancePhaseLabel` を固定文字列ではなく、現在フェーズIDを受け取って行き先ラベルを返す関数に変える。

`LessonControlRoomProps` の `advancePhaseLabel` を置き換える。

置換前:
```ts
  advancePhaseLabel?: string
```
置換後:
```ts
  /**
   * 次フェーズの CTA ラベル。現在フェーズを購読しているのはこの画面だけな
   * ので、行き先の解決は呼び出し側の関数に現在フェーズIDを渡して行う。
   * `null` を返した場合は次フェーズへの CTA を出さない（最終フェーズ）。
   */
  advancePhaseLabel?: (currentPhaseId: string | null) => string | null
```

`LessonControlRoom` の既定値と `nextAction` の組み立てを置き換える。

置換前:
```tsx
  advancePhaseLabel = '次のフェーズへ進む',
```
置換後:
```tsx
  advancePhaseLabel = () => '次のフェーズへ進む',
```

置換前:
```tsx
    if (status === 'RUNNING' && onAdvancePhase) {
      if (!canControlLesson(role, 'TRANSITION_PHASE')) return null
      return { label: advancePhaseLabel, onActivate: () => onAdvancePhase(publicState?.currentPhaseId ?? null) }
    }
```
置換後:
```tsx
    if (status === 'RUNNING' && onAdvancePhase) {
      if (!canControlLesson(role, 'TRANSITION_PHASE')) return null
      const currentPhaseId = publicState?.currentPhaseId ?? null
      const label = advancePhaseLabel(currentPhaseId)
      // 最終フェーズでは進む先が無いので CTA 自体を出さない。
      if (!label) return null
      return { label, onActivate: () => onAdvancePhase(currentPhaseId) }
    }
```

`useMemo` の依存配列の `advancePhaseLabel` はそのままでよい。

`TeacherControlRoute` 側は次を渡す。

```tsx
    advancePhaseLabel={(currentPhaseId) => {
      const nextPhaseId = resolveNextPhaseId(currentPhaseId)
      if (!nextPhaseId) return null
      const nextLabel = findPhaseLabel(phases, nextPhaseId)
      return nextLabel ? `次へ：${nextLabel}` : '次のフェーズへ進む'
    }}
```

- [ ] **Step 7: `readPhaseLabel` の未使用 import を整理する**

Step 3 で `readPhaseLabel` も import したが、`findPhaseLabel` しか使っていない場合は import から外す。

Run: `npm run lint`
Expected: 新しい警告・エラーが出ないこと

- [ ] **Step 8: テストを実行して緑を確認する**

Run: `npm test -- src/App.test.tsx src/components/teacher`
Expected: PASS

- [ ] **Step 9: 手写し配列の残存確認**

Run: `grep -rn "defaultPhaseSequence" src --include="*.ts" --include="*.tsx"`
Expected: 出力なし（該当なしで終了コード1）

- [ ] **Step 10: コミット**

```bash
git add -A src
git commit -m "$(cat <<'EOF'
feat: resolve the next phase from the run's own phase graph

App.tsx carried a hand-copied duplicate of the server's fixed phase sequence,
which would silently advance to the wrong phase once a template defines its
own graph. The CTA now names where it goes, and disappears on the last phase.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: 教室表示にフェーズ名と残り時間を出す

**Files:**
- Modify: `src/components/display/LiveScreen.tsx`
- Modify: `src/components/display/LiveScreen.test.tsx`
- Modify: `src/components/display/ClassroomDisplayPage.tsx`
- Modify: `src/components/display/ClassroomDisplayPage.test.tsx`

**Interfaces:**
- Consumes: Task 3 の `currentPhaseLabel`、Task 4 の `currentPhaseEndsAtMillis`、Task 7 の `PhaseCountdown`
- Produces: `LiveScreenProps.endsAtMillis?: number | null`（`remainingSeconds` は消滅）

- [ ] **Step 1: 失敗するテストを書く**

`src/components/display/ClassroomDisplayPage.test.tsx` の末尾（最後の `})` の直前）に追加する。`renderPage` / `emitState` 相当のヘルパー名は同ファイル内の既存のものに合わせる。

Run: `grep -n "^const \|^function " src/components/display/ClassroomDisplayPage.test.tsx`

```tsx
it('LIVE 表示でフェーズ名と残り時間を出す', async () => {
  renderPage()
  emitState({
    mode: 'LIVE', title: 'テスト授業', goal: null, teams: [], teacherGuidance: null,
    joinCode: null, currentPhaseLabel: '取引',
    currentPhaseEndsAtMillis: Date.now() + 120_000,
    orgId: 'org-1', updatedAtMillis: 0,
  })

  expect(await screen.findByText('取引')).toBeInTheDocument()
  expect(screen.getByText(/^残り /)).toBeInTheDocument()
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test -- src/components/display/ClassroomDisplayPage.test.tsx`
Expected: FAIL — `Unable to find an element with the text: 取引`

- [ ] **Step 3: `LiveScreen` を終了時刻に切り替える**

import を追加する。

```tsx
import { PhaseCountdown } from '../ui/PhaseCountdown'
```

`LiveScreenProps` の `phaseName` / `remainingSeconds` とその上の長い JSDoc を置き換える。projection がフィールドを持つようになったため、但し書きは実態と合わなくなっている。

置換前（JSDoc ブロックごと）:
```tsx
  /**
   * フェーズ名・残り秒数: 現行の `LessonRunDisplayState`
   * ...
   */
  phaseName?: string
  remainingSeconds?: number | null
  /** 公開情報(ニュース等)。理由は phaseName と同様、現行projectionには未収録。 */
  publicInfo?: string[]
```
置換後:
```tsx
  /** 現在フェーズの日本語名。`LessonRunDisplayState.currentPhaseLabel` から渡る。 */
  phaseName?: string
  /** 現在フェーズの終了時刻（エポックミリ秒）。制限時間の無いフェーズでは null。 */
  endsAtMillis?: number | null
  /** 公開情報(ニュース等)。`LessonRunDisplayState` はまだこのフィールドを持たない。 */
  publicInfo?: string[]
```

引数の分割代入と Chip の描画を置き換える。

置換前:
```tsx
export function LiveScreen({ title, phaseName, remainingSeconds, publicInfo, teams, teacherGuidance }: LiveScreenProps) {
```
置換後:
```tsx
export function LiveScreen({ title, phaseName, endsAtMillis, publicInfo, teams, teacherGuidance }: LiveScreenProps) {
```

置換前:
```tsx
        {typeof remainingSeconds === 'number' && (
          <Chip label={`残り ${remainingSeconds} 秒`} color={remainingSeconds <= 10 ? 'error' : 'default'} />
        )}
```
置換後:
```tsx
        <PhaseCountdown endsAtMillis={endsAtMillis} />
```

- [ ] **Step 4: `ClassroomDisplayPage` から渡す**

分割代入に追加する。

置換前:
```tsx
  const { mode, title, goal, teams, teacherGuidance, householdClassComparison } = state
```
置換後:
```tsx
  const { mode, title, goal, teams, teacherGuidance, householdClassComparison, currentPhaseLabel, currentPhaseEndsAtMillis } = state
```

`LIVE` 分岐を置き換える。

置換前:
```tsx
      return <LiveScreen title={title} teams={teams} teacherGuidance={teacherGuidance} />
```
置換後:
```tsx
      return <LiveScreen
        title={title}
        phaseName={currentPhaseLabel ?? undefined}
        endsAtMillis={currentPhaseEndsAtMillis}
        teams={teams}
        teacherGuidance={teacherGuidance}
      />
```

- [ ] **Step 5: `LiveScreen.test.tsx` の `remainingSeconds` を直す**

Run: `grep -n "remainingSeconds" src/components/display/LiveScreen.test.tsx`

該当箇所を `endsAtMillis={Date.now() + 120_000}` の形に直し、アサーションを `screen.getByText(/^残り /)` に変える。

- [ ] **Step 6: テストを実行して緑を確認する**

Run: `npm test -- src/components/display`
Expected: PASS

- [ ] **Step 7: コミット**

```bash
git add -A src/components/display
git commit -m "$(cat <<'EOF'
feat: show the phase name and countdown on the classroom display

LiveScreen has accepted both since it was written, but ClassroomDisplayPage
passed neither because the display projection did not carry them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: 全体検証

**Files:**
- Modify: なし（不具合が出た場合のみ該当ファイル）

**Interfaces:**
- Consumes: Task 1-10 のすべて
- Produces: なし

- [ ] **Step 1: 置き換えたはずのものが残っていないか確認する**

Run: `grep -rn "remainingPhaseSeconds\|defaultPhaseSequence" src functions/src test --include="*.ts" --include="*.tsx"`
Expected: 出力なし（該当なしで終了コード1）

- [ ] **Step 2: フェーズが `TIMED` にされていないことを確認する**

Run: `grep -n "TIMED" functions/src/lessonRuns/phases/defaultPhases.ts`
Expected: 出力なし。既定フェーズは `TEACHER_CONTROLLED` のままであること。

- [ ] **Step 3: 全検証を実行する**

Run: `npm run verify`
Expected: exit 0。lint・typecheck（`tsc -b` と `tsc -p tsconfig.rules.json` の両方）・テスト・Rules テスト・ビルドがすべて成功。

`test/lesson-lifecycle.acceptance.test.ts` の `LessonRunProjectionSource` フィクスチャは `npm test` では検出されず `tsc -p tsconfig.rules.json` でのみ落ちる。Task 2 Step 6 で対応済みだが、ここで最終確認する。

失敗した場合は該当箇所を直し、この Step を再実行する。

- [ ] **Step 4: スコープ外項目が手つかずであることを確認する**

Run: `grep -n "openIssues" src/components/teacher/LessonControlRoom.tsx`
Expected: `openIssues` は文字列の配列のまま、対処操作への導線を持たないこと（プロジェクトCで扱うため本プロジェクトでは変更しない）。

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: verify readable lesson status

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```
