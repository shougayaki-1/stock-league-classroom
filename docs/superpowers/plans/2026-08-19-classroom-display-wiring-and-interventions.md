# 教室表示の配線と介入4種の実効化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 教室表示を授業の進行に自動追従させ、実効を持たなかった介入4種に実際の効果を与え、「スライド」という多義語をコードとUIから全廃する。

**Architecture:** サーバ側は既存の allow-list projection（`toLessonRunPublicState` / `toLessonRunDisplayState`）を変えず、その入力 `LessonRunProjectionSource` を組み立てる共通アセンブラを新設し、授業の状態を変える各所から `publishLessonProjectionWithAdminSdk` を呼ぶ。介入4種は `LessonRun` doc に新フィールド（`displayModeOverride` / `hiddenInformationIds` / `currentPhaseEndsAtMillis`）を持たせ、既存の delegate 注入パターンで実処理を追加する。クライアントは介入4種のフォームを専用化してID手入力を廃止する。

**Tech Stack:** TypeScript / React 19 / MUI 9 / Firebase Functions v2 (Node 20, CommonJS) / Firestore / Realtime Database / Vitest

**正本仕様:** `docs/superpowers/specs/2026-08-19-classroom-display-wiring-and-interventions-design.md`

## Global Constraints

- テストは Vitest。テストファイルは実装と同じディレクトリに `*.test.ts` / `*.test.tsx` で置く。
- `functions/src` から リポジトリ直下の `src/` を import してはならない（`functions/tsconfig.json` の `rootDir: "src"` によりコンパイルエラー）。両者に同じ型がある場合は手作業で同期する既存慣行に従う。
- projection 関数（`toLessonRunPublicState` / `toLessonRunDisplayState` / `buildResearchDeskPublicView`）は **allow-list 方式**を維持する。`source` をスプレッド（`{...source}`）してはならない。
- `LessonRunProjectionSource` の禁止フィールド `randomSeed` / `restoreGeneration` / `future` は、いかなる projection 出力にも現れてはならない（統合仕様書 §26-1）。
- Firestore トランザクションは **全ての read を全ての write より前に**行う（read-before-write）。
- 「スライド」という語を、新規に書くコード・UI文言・型名・ファイル名のいずれにも使わない。
- UI文言は日本語。用語は仕様書「用語の確定」表に従う（教材 / 版 / 授業 / 教室表示 / フェーズ / 解説画面 / 教室表示のメッセージ）。
- 各タスクの最後に `npm test`（クライアント）または `npm test --workspace=functions`（サーバ）を実行し、緑を確認してからコミットする。
- コミットメッセージ末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` を付ける。

## File Structure

**新規作成**

| ファイル | 責務 |
| --- | --- |
| `functions/src/lessonRuns/projections/buildProjectionSource.ts` | Firestore の `lessonRuns/{id}` doc と `teams` サブコレクションから `LessonRunProjectionSource` を組み立てる唯一の場所 |
| `functions/src/lessonRuns/projections/buildProjectionSource.test.ts` | 同上のテスト |
| `functions/src/lessonRuns/interventions/extendPhaseTimer.ts` | `EXTEND_TIME` の実処理（`currentPhaseEndsAtMillis` の加算） |
| `functions/src/lessonRuns/interventions/extendPhaseTimer.test.ts` | 同上のテスト |
| `functions/src/lessonRuns/interventions/setDisplayModeOverride.ts` | `SWITCH_DISPLAY_MODE` の実処理 |
| `functions/src/lessonRuns/interventions/setDisplayModeOverride.test.ts` | 同上のテスト |
| `functions/src/lessonRuns/interventions/setInformationHidden.ts` | `HIDE_INFORMATION` の実処理 |
| `functions/src/lessonRuns/interventions/setInformationHidden.test.ts` | 同上のテスト |
| `functions/src/lessonRuns/interventions/correctState.ts` | `CORRECT_STATE` の許可リストと実処理 |
| `functions/src/lessonRuns/interventions/correctState.test.ts` | 同上のテスト |
| `src/components/teacher/ClassroomMessageDialog.tsx` | 「教室表示のメッセージ」ダイアログ（`TeacherGuidanceDialog` の改名先） |
| `src/components/teacher/interventionForms/ExtendTimeForm.tsx` | 時間延長の専用フォーム |
| `src/components/teacher/interventionForms/DisplayModeForm.tsx` | 教室表示の画面切り替えの専用フォーム |
| `src/components/teacher/interventionForms/HideInformationForm.tsx` | 情報の非表示化の専用フォーム |
| `src/components/teacher/interventionForms/CorrectStateForm.tsx` | 状態の手動修正の専用フォーム |
| `src/components/teacher/interventionForms/interventionForms.test.tsx` | 上記4フォームのテスト |

**改名（`git mv` + 中身の識別子更新）**

| 現行 | 改名後 |
| --- | --- |
| `src/components/display/StartSlide.tsx` / `.test.tsx` | `StartScreen.tsx` / `.test.tsx` |
| `src/components/display/LiveSlide.tsx` / `.test.tsx` | `LiveScreen.tsx` / `.test.tsx` |
| `src/components/display/EndSlide.tsx` / `.test.tsx` | `EndScreen.tsx` / `.test.tsx` |
| `src/components/display/ExplanationSlide.tsx` / `.test.tsx` | `ExplanationScreen.tsx` / `.test.tsx` |
| `src/components/teacher/TeacherGuidanceDialog.tsx` | `src/components/teacher/ClassroomMessageDialog.tsx` |

**変更**

| ファイル | 変更内容 |
| --- | --- |
| `functions/src/lessonRuns/projections/source.ts` | `displayModeOverride` を `LessonRunProjectionSource` に追加 |
| `functions/src/lessonRuns/projections/displayProjection.ts` | `mode` を override 優先に変更 |
| `functions/src/lessonRuns/projections/setTeacherGuidance.ts` | 自前の source 組み立てを `buildProjectionSource` に置換 |
| `functions/src/lessonRuns/phases/transitionPhase.ts` | `currentPhaseEndsAtMillis` の書き込み、`publishLessonProjection` フックの追加 |
| `functions/src/lessonRuns/joinLessonRun.ts` | `publishLessonProjection` の呼び出し追加 |
| `functions/src/lessonRuns/teams/assignTeam.ts` | `publishLessonProjection` の呼び出し追加 |
| `functions/src/lessonRuns/interventions.ts` | 型名改名、`REQUIRED_DETAIL_KEYS` 更新、delegate 4種追加、`GENERIC_STATE_TYPES` 撤去 |
| `functions/src/lessonRuns/interventions/onCall.ts` | エラー写像の追加 |
| `functions/src/market/researchDeskProjection.ts` | `hiddenInformationIds` によるニュース除外 |
| `src/lib/lessonRuns/interventions.ts` | 型名改名（サーバと byte-for-byte 同期） |
| `src/lib/lessonRuns/liveTypes.ts` | 変更なし（`displayModeOverride` はサーバ内部のみ） |
| `src/components/display/ClassroomDisplayPage.tsx` | import と JSX の改名追従 |
| `src/components/teacher/LessonControlRoom.tsx` | ラベル更新、`InterventionPanel` への新規 props 受け渡し |
| `src/components/teacher/InterventionPanel.tsx` | カタログ更新、4種の専用フォーム差し込み |

---

### Task 1: 教室表示コンポーネントの改名（`*Slide` → `*Screen`）

挙動は一切変えない。純粋な改名とラベル更新。

**Files:**
- Rename: `src/components/display/StartSlide.tsx` → `src/components/display/StartScreen.tsx`
- Rename: `src/components/display/StartSlide.test.tsx` → `src/components/display/StartScreen.test.tsx`
- Rename: `src/components/display/LiveSlide.tsx` → `src/components/display/LiveScreen.tsx`
- Rename: `src/components/display/LiveSlide.test.tsx` → `src/components/display/LiveScreen.test.tsx`
- Rename: `src/components/display/EndSlide.tsx` → `src/components/display/EndScreen.tsx`
- Rename: `src/components/display/EndSlide.test.tsx` → `src/components/display/EndScreen.test.tsx`
- Rename: `src/components/display/ExplanationSlide.tsx` → `src/components/display/ExplanationScreen.tsx`
- Rename: `src/components/display/ExplanationSlide.test.tsx` → `src/components/display/ExplanationScreen.test.tsx`
- Modify: `src/components/display/ClassroomDisplayPage.tsx`
- Modify: `src/components/display/ClassroomDisplayPage.test.tsx`

**Interfaces:**
- Consumes: なし（最初のタスク）
- Produces: `StartScreen` / `LiveScreen` / `EndScreen` / `ExplanationScreen` コンポーネント、および `StartScreenProps` / `LiveScreenProps` / `EndScreenProps` / `ExplanationScreenProps` 型。props のフィールドは改名前と同一。

- [ ] **Step 1: ファイルを git mv で改名する**

```bash
cd src/components/display
git mv StartSlide.tsx StartScreen.tsx
git mv StartSlide.test.tsx StartScreen.test.tsx
git mv LiveSlide.tsx LiveScreen.tsx
git mv LiveSlide.test.tsx LiveScreen.test.tsx
git mv EndSlide.tsx EndScreen.tsx
git mv EndSlide.test.tsx EndScreen.test.tsx
git mv ExplanationSlide.tsx ExplanationScreen.tsx
git mv ExplanationSlide.test.tsx ExplanationScreen.test.tsx
```

- [ ] **Step 2: 各ファイル内の識別子を置換する**

`src/components/display/` 配下の8ファイルすべてに対して、次の置換を行う。

```bash
cd /Users/shoug/Documents/GitHub/stock-league-classroom
sed -i '' \
  -e 's/StartSlide/StartScreen/g' \
  -e 's/LiveSlide/LiveScreen/g' \
  -e 's/EndSlide/EndScreen/g' \
  -e 's/ExplanationSlide/ExplanationScreen/g' \
  src/components/display/StartScreen.tsx \
  src/components/display/StartScreen.test.tsx \
  src/components/display/LiveScreen.tsx \
  src/components/display/LiveScreen.test.tsx \
  src/components/display/EndScreen.tsx \
  src/components/display/EndScreen.test.tsx \
  src/components/display/ExplanationScreen.tsx \
  src/components/display/ExplanationScreen.test.tsx \
  src/components/display/ClassroomDisplayPage.tsx \
  src/components/display/ClassroomDisplayPage.test.tsx
```

- [ ] **Step 3: `ExplanationScreen.tsx` のJSDocから「スライド」語を除く**

`ExplanationScreen.tsx` の末尾近くにあるコンポーネントのJSDocを次に置き換える。

```tsx
/** 解説画面(EXPLANATION mode)。教師の補足説明・チームの匿名集計のみを表示し、直前mode(LIVE/END)への復帰見込みをテキストで示す。 */
```

- [ ] **Step 4: `ClassroomDisplayPage.tsx` のJSDoc内の「Slideコンポーネント」を直す**

`ClassroomDisplayPage.tsx` のコンポーネントJSDoc内の一文を次に置き換える。

置換前:
```
 * teacherGuidance のみで、各Slideコンポーネントへは明示的な分割代入で
```

置換後:
```
 * teacherGuidance のみで、各画面コンポーネントへは明示的な分割代入で
```

- [ ] **Step 5: テストを実行して緑を確認する**

Run: `npm test -- src/components/display`
Expected: PASS（改名のみのため既存アサーションはすべて通る）

- [ ] **Step 6: 「スライド」語が display 配下から消えたことを確認する**

Run: `grep -rin "slide\|スライド" src/components/display/`
Expected: 出力なし（該当なしで終了コード1）

- [ ] **Step 7: コミット**

```bash
git add -A src/components/display
git commit -m "$(cat <<'EOF'
refactor: rename display Slide components to Screen

The classroom display has no slide concept: the five modes are derived from
LessonRun.status by deriveDisplayMode, not flipped through by the teacher.
Naming them "Slide" invited users to look for next/previous/reorder controls
that do not exist.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 教師画面の文言を新用語に揃える

`TeacherGuidanceDialog` を `ClassroomMessageDialog` に改名し、`LessonControlRoom` の表示ラベルを新用語に更新する。挙動は変えない。

**Files:**
- Rename: `src/components/teacher/TeacherGuidanceDialog.tsx` → `src/components/teacher/ClassroomMessageDialog.tsx`
- Modify: `src/components/teacher/LessonControlRoom.tsx`
- Modify: `src/components/teacher/LessonControlRoom.test.tsx`

**Interfaces:**
- Consumes: なし
- Produces: `ClassroomMessageDialog` コンポーネントと `ClassroomMessageDialogProps` 型。props は改名前の `TeacherGuidanceDialogProps` と同一（`open` / `onClose` / `lessonRunId` / `initialGuidance` / `functions` / `aiEnabled`）。

- [ ] **Step 1: 失敗するテストを書く**

`src/components/teacher/LessonControlRoom.test.tsx` の末尾（最後の `})` の直前）に追加する。

```tsx
  it('教室表示のメッセージのボタンを新しい用語で表示する', () => {
    render(<LessonControlRoom lessonRunId="run-1" role="PRIMARY" functions={functions} firestore={firestore} database={database} />)
    emitPublic({ status: 'RUNNING', currentPhaseId: 'phase-1' })
    emitDisplay({ mode: 'LIVE', title: 'フェーズ1の説明' })
    emitParticipants([])

    expect(screen.getByRole('button', { name: '教室表示のメッセージ' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '説明スライドを編集' })).not.toBeInTheDocument()
  })
```

`emitPublic` / `emitDisplay` / `emitParticipants` と `functions` / `firestore` / `database` は同ファイル内の既存ヘルパー。

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test -- src/components/teacher/LessonControlRoom.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "button" and name "教室表示のメッセージ"`

- [ ] **Step 3: ダイアログを改名する**

```bash
cd /Users/shoug/Documents/GitHub/stock-league-classroom
git mv src/components/teacher/TeacherGuidanceDialog.tsx src/components/teacher/ClassroomMessageDialog.tsx
sed -i '' \
  -e 's/TeacherGuidanceDialogProps/ClassroomMessageDialogProps/g' \
  -e 's/TeacherGuidanceDialog/ClassroomMessageDialog/g' \
  src/components/teacher/ClassroomMessageDialog.tsx
```

- [ ] **Step 4: ダイアログ内の文言を更新する**

`src/components/teacher/ClassroomMessageDialog.tsx` の JSX 内で、次の2箇所を置き換える。

置換前:
```tsx
<DialogTitle>説明スライドを編集</DialogTitle>
```
置換後:
```tsx
<DialogTitle>教室表示のメッセージ</DialogTitle>
```

置換前:
```tsx
<TextField label="説明スライドの文言" value={guidance}
```
置換後:
```tsx
<TextField label="教室表示に出すメッセージ" value={guidance}
```

- [ ] **Step 5: `LessonControlRoom.tsx` の import とラベルを更新する**

import 文を置き換える。

置換前:
```tsx
import { TeacherGuidanceDialog } from './TeacherGuidanceDialog'
```
置換後:
```tsx
import { ClassroomMessageDialog } from './ClassroomMessageDialog'
```

`DISPLAY_MODE_LABEL` を置き換える。

```tsx
const DISPLAY_MODE_LABEL: Record<LessonRunDisplayState['mode'], string> = {
  START: '開始待機の画面',
  LIVE: '授業中の画面',
  END: '終了の画面',
  EXPLANATION: '解説の画面',
  HOUSEHOLD_COMPARISON: 'クラス比較の画面',
}
```

ボタンを置き換える。

置換前:
```tsx
{canEditGuidance && <Button variant="outlined" onClick={() => setGuidanceDialogOpen(true)} sx={{ minHeight: MIN_TOUCH_TARGET }}>説明スライドを編集</Button>}
```
置換後:
```tsx
{canEditGuidance && <Button variant="outlined" onClick={() => setGuidanceDialogOpen(true)} sx={{ minHeight: MIN_TOUCH_TARGET }}>教室表示のメッセージ</Button>}
```

末尾のダイアログ描画を置き換える。

置換前:
```tsx
{canEditGuidance && <TeacherGuidanceDialog open={guidanceDialogOpen} onClose={() => setGuidanceDialogOpen(false)} lessonRunId={lessonRunId} initialGuidance={displayState?.teacherGuidance ?? null} functions={functions} aiEnabled={aiEnabled} />}
```
置換後:
```tsx
{canEditGuidance && <ClassroomMessageDialog open={guidanceDialogOpen} onClose={() => setGuidanceDialogOpen(false)} lessonRunId={lessonRunId} initialGuidance={displayState?.teacherGuidance ?? null} functions={functions} aiEnabled={aiEnabled} />}
```

- [ ] **Step 6: 旧ラベルに依存する既存テストを直す**

`LessonControlRoom.test.tsx` に `DISPLAY_MODE_LABEL` の旧文言をアサートしている箇所がある。

Run: `grep -n "クラス比較画面\|進行中の画面\|開始待機画面\|終了画面\|説明スライド" src/components/teacher/LessonControlRoom.test.tsx`

見つかった行を新ラベルに置き換える。例:

置換前:
```tsx
    expect(screen.getByText(/クラス比較画面/)).toBeInTheDocument()
```
置換後:
```tsx
    expect(screen.getByText(/クラス比較の画面/)).toBeInTheDocument()
```

- [ ] **Step 7: テストを実行して緑を確認する**

Run: `npm test -- src/components/teacher/LessonControlRoom.test.tsx`
Expected: PASS

- [ ] **Step 8: コミット**

```bash
git add -A src/components/teacher
git commit -m "$(cat <<'EOF'
refactor: rename teacher guidance dialog to classroom message

teacherGuidance is rendered on every display mode as an overlay message, not
as a slide. The button is also the only switch that makes the classroom
display show anything today, so its name needs to say what it is.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 介入型 `SWITCH_DISPLAY_SLIDE` を `SWITCH_DISPLAY_MODE` に改名する

サーバとクライアントの型名・detail キーを同時に改名する。実効はまだ与えない（Task 10 で与える）。

**Files:**
- Modify: `functions/src/lessonRuns/interventions.ts`
- Modify: `functions/src/lessonRuns/interventions.test.ts`
- Modify: `src/lib/lessonRuns/interventions.ts`
- Modify: `src/components/teacher/InterventionPanel.tsx`
- Modify: `src/components/teacher/InterventionPanel.test.tsx`
- Modify: `src/components/teacher/LessonControlRoom.tsx`

**Interfaces:**
- Consumes: なし
- Produces: `LessonInterventionType` の値 `'SWITCH_DISPLAY_MODE'`（`'SWITCH_DISPLAY_SLIDE'` は消滅）。`REQUIRED_DETAIL_KEYS.SWITCH_DISPLAY_MODE = ['displayMode']`。サーバ側 `functions/src/lessonRuns/interventions.ts` とクライアント側 `src/lib/lessonRuns/interventions.ts` の両方で同一。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonRuns/interventions.test.ts` の末尾（最後の `})` の直前）に追加する。

```ts
describe('SWITCH_DISPLAY_MODE', () => {
  it('lessonInterventionTypes に SWITCH_DISPLAY_MODE を含み SWITCH_DISPLAY_SLIDE を含まない', () => {
    expect(lessonInterventionTypes as readonly string[]).toContain('SWITCH_DISPLAY_MODE')
    expect(lessonInterventionTypes as readonly string[]).not.toContain('SWITCH_DISPLAY_SLIDE')
  })

  it('detail に displayMode が無ければ拒否する', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs)

    await expect(applyTeacherIntervention({
      firestore: fake as never,
      actorId: 'teacher-primary',
      now: () => 'fixed-now',
      loadRunContext: async () => ({ orgId: 'org-1', status: 'RUNNING' }),
      delegates: makeDelegates(),
    }, { ...baseEnvelope, type: 'SWITCH_DISPLAY_MODE', detail: {} })).rejects.toThrow(/displayMode/)
  })
})
```

`makeFakeFirestore` / `setUpRun` / `baseEnvelope` / `makeDelegates` はすべて同ファイル内の既存ヘルパー。

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/interventions.test.ts`
Expected: FAIL — TypeScript が `'SWITCH_DISPLAY_MODE'` を `LessonInterventionType` に代入できないと報告する、または `toContain` が失敗する

- [ ] **Step 3: サーバ側を改名する**

```bash
cd /Users/shoug/Documents/GitHub/stock-league-classroom
sed -i '' \
  -e "s/SWITCH_DISPLAY_SLIDE/SWITCH_DISPLAY_MODE/g" \
  -e "s/'slideId'/'displayMode'/g" \
  functions/src/lessonRuns/interventions.ts \
  functions/src/lessonRuns/interventions.test.ts
```

`sed` は `functions/src/lessonRuns/interventions.test.ts` のテーブル `REQUIRED_DETAIL` も同時に書き換える。そのエントリが次になっていることを確認する。

```ts
  SWITCH_DISPLAY_MODE: { displayMode: 'EXPLANATION' },
```

`REQUIRED_DETAIL` は `lessonInterventionTypes` 全件を回す table-driven テスト（同ファイルの `it.each(lessonInterventionTypes)`）が使うため、キー名と型名が一致していないと全件が落ちる。

- [ ] **Step 4: クライアント側を改名する**

```bash
cd /Users/shoug/Documents/GitHub/stock-league-classroom
sed -i '' \
  -e "s/SWITCH_DISPLAY_SLIDE/SWITCH_DISPLAY_MODE/g" \
  src/lib/lessonRuns/interventions.ts \
  src/components/teacher/InterventionPanel.tsx \
  src/components/teacher/InterventionPanel.test.tsx \
  src/components/teacher/LessonControlRoom.tsx
```

`src/components/teacher/InterventionPanel.tsx` の `INTERVENTION_CATALOG` 内の該当エントリを手で置き換える。

置換前:
```tsx
  SWITCH_DISPLAY_MODE: {
    label: '教室表示の切り替え', description: '教室の投影表示のスライドを切り替えます',
    fields: [{ key: 'slideId', label: 'スライドID' }],
  },
```
置換後:
```tsx
  SWITCH_DISPLAY_MODE: {
    label: '教室表示の画面を切り替える', description: '教室に投影している画面を手動で切り替えます',
    fields: [{ key: 'displayMode', label: '表示する画面' }],
  },
```

- [ ] **Step 5: テストを実行して緑を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/interventions.test.ts && npm test -- src/components/teacher src/lib/lessonRuns`
Expected: PASS

- [ ] **Step 6: 「slide」語が介入まわりから消えたことを確認する**

Run: `grep -rin "slide" functions/src/lessonRuns src/lib/lessonRuns src/components/teacher`
Expected: 出力なし（該当なしで終了コード1）

- [ ] **Step 7: コミット**

```bash
git add -A functions/src/lessonRuns src/lib/lessonRuns src/components/teacher
git commit -m "$(cat <<'EOF'
refactor: rename SWITCH_DISPLAY_SLIDE to SWITCH_DISPLAY_MODE

The intervention switches the display mode, not a slide. detail.slideId
becomes detail.displayMode. No reader maps interventionType to a display
name today (buildAnalytics only counts PROXY_CONFIRM/RECONNECT_PARTICIPANT,
buildResults reads reason only), so no read-side compat shim is needed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `buildProjectionSource` を新設し `setTeacherGuidance` をそれに寄せる

`LessonRunProjectionSource` を組み立てる唯一の場所を作る。`setTeacherGuidance` が持つインライン版を置き換える。

**Files:**
- Create: `functions/src/lessonRuns/projections/buildProjectionSource.ts`
- Create: `functions/src/lessonRuns/projections/buildProjectionSource.test.ts`
- Modify: `functions/src/lessonRuns/projections/setTeacherGuidance.ts`
- Modify: `functions/src/lessonRuns/projections/setTeacherGuidance.test.ts`

**Interfaces:**
- Consumes: `LessonRunProjectionSource`（`functions/src/lessonRuns/projections/source.ts`）
- Produces:
  ```ts
  export interface BuildProjectionSourceDeps {
    getRun: (lessonRunId: string) => Promise<Record<string, unknown> | null>
    getTeams: (lessonRunId: string) => Promise<Array<Record<string, unknown>>>
    now?: () => number
  }
  export const buildProjectionSource: (
    deps: BuildProjectionSourceDeps,
    lessonRunId: string,
  ) => Promise<LessonRunProjectionSource | null>
  export const buildProjectionSourceWithAdminSdk: (
    lessonRunId: string,
  ) => Promise<LessonRunProjectionSource | null>
  ```

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonRuns/projections/buildProjectionSource.test.ts` を新規作成する。

```ts
import { describe, expect, it } from 'vitest'
import { buildProjectionSource } from './buildProjectionSource'

const run = {
  orgId: 'org1',
  status: 'RUNNING',
  currentPhaseId: 'phase-market',
  currentPhaseEndsAtMillis: 1_700_000_060_000,
  teacherGuidance: 'いまは値動きを見てください',
  templateSnapshot: {
    title: '市場のしくみを学ぶ',
    description: '需給と情報で価格が動くことを体験する',
    phases: [
      { id: 'phase-intro', publicTask: '説明を聞きます' },
      { id: 'phase-market', publicTask: '売買の判断をします' },
    ],
  },
  randomSeed: 'SECRET-SEED',
  restoreGeneration: 3,
  future: { prices: [1, 2, 3] },
}

const teams = [
  { id: 'team-a', displayName: 'Aチーム' },
  { id: 'team-b', displayName: 'Bチーム' },
]

const deps = {
  getRun: async () => run as Record<string, unknown>,
  getTeams: async () => teams as Array<Record<string, unknown>>,
  now: () => 1_700_000_000_000,
}

describe('buildProjectionSource', () => {
  it('lessonRun doc と teams から source を組み立てる', async () => {
    const source = await buildProjectionSource(deps, 'run1')

    expect(source).not.toBeNull()
    expect(source?.orgId).toBe('org1')
    expect(source?.status).toBe('RUNNING')
    expect(source?.title).toBe('市場のしくみを学ぶ')
    expect(source?.goal).toBe('需給と情報で価格が動くことを体験する')
    expect(source?.currentPhaseId).toBe('phase-market')
    expect(source?.currentPhaseEndsAtMillis).toBe(1_700_000_060_000)
    expect(source?.teacherGuidance).toBe('いまは値動きを見てください')
    expect(source?.updatedAtMillis).toBe(1_700_000_000_000)
  })

  it('現在フェーズの publicTask を引く', async () => {
    const source = await buildProjectionSource(deps, 'run1')
    expect(source?.currentPhasePublicTask).toBe('売買の判断をします')
  })

  it('teams を id と displayName に写す', async () => {
    const source = await buildProjectionSource(deps, 'run1')
    expect(source?.teams).toEqual([
      { id: 'team-a', displayName: 'Aチーム', publicAggregateLabel: null },
      { id: 'team-b', displayName: 'Bチーム', publicAggregateLabel: null },
    ])
  })

  it('禁止フィールドを source に載せない', async () => {
    const source = await buildProjectionSource(deps, 'run1')
    expect(source).not.toHaveProperty('randomSeed', 'SECRET-SEED')
    expect(source?.future).toBeUndefined()
  })

  it('lessonRun が無ければ null を返す', async () => {
    const source = await buildProjectionSource(
      { ...deps, getRun: async () => null },
      'missing',
    )
    expect(source).toBeNull()
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/projections/buildProjectionSource.test.ts`
Expected: FAIL — `Failed to resolve import "./buildProjectionSource"`

- [ ] **Step 3: 実装する**

`functions/src/lessonRuns/projections/buildProjectionSource.ts` を新規作成する。

```ts
import { getFirestore } from 'firebase-admin/firestore'
import type { LessonRunProjectionSource } from './source'

/**
 * `LessonRunProjectionSource` を組み立てる唯一の場所。
 *
 * `toLessonRunPublicState` / `toLessonRunDisplayState` は allow-list で
 * source から出力を絞るが、その source 自体を誰が組むかは Phase B 時点で
 * 決まっていなかった（publicProjection.ts の JSDoc「Callers ... are
 * responsible for assembling LessonRunProjectionSource from Firestore」）。
 * 結果として setTeacherGuidance.ts だけが自前の簡易版を持ち、他の呼び出し元が
 * 存在しなかった。このモジュールがその組み立てを引き受ける。
 *
 * `randomSeed` / `restoreGeneration` / `future` は `LessonRunProjectionSource`
 * の必須フィールドとして型に存在するが（禁止フィールドであることを型の上で
 * 明示するため）、ここでは lessonRun doc の実値を写さず固定のダミー値を入れる。
 * projection 関数はこれらを一切読まないので出力に影響せず、万一 projection 側で
 * 読んでしまった場合も本物の乱数シードや未来価格計画が漏れない。
 */
export interface BuildProjectionSourceDeps {
  getRun: (lessonRunId: string) => Promise<Record<string, unknown> | null>
  getTeams: (lessonRunId: string) => Promise<Array<Record<string, unknown>>>
  now?: () => number
}

interface PhaseSnapshot {
  id: string
  publicTask?: string | null
}

interface TemplateSnapshot {
  title?: string
  description?: string | null
  phases?: PhaseSnapshot[]
}

export const buildProjectionSource = async (
  deps: BuildProjectionSourceDeps,
  lessonRunId: string,
): Promise<LessonRunProjectionSource | null> => {
  const run = await deps.getRun(lessonRunId)
  if (!run) return null

  const templateSnapshot = (run.templateSnapshot ?? {}) as TemplateSnapshot
  const currentPhaseId = (run.currentPhaseId as string | null | undefined) ?? null
  const currentPhase = currentPhaseId
    ? templateSnapshot.phases?.find((phase) => phase.id === currentPhaseId)
    : undefined

  const teams = await deps.getTeams(lessonRunId)

  return {
    orgId: run.orgId as string,
    status: run.status as string,
    title: templateSnapshot.title ?? '',
    goal: templateSnapshot.description ?? null,
    currentPhaseId,
    currentPhasePublicTask: currentPhase?.publicTask ?? null,
    currentPhaseEndsAtMillis: (run.currentPhaseEndsAtMillis as number | null | undefined) ?? null,
    updatedAtMillis: deps.now ? deps.now() : Date.now(),
    teacherGuidance: (run.teacherGuidance as string | null | undefined) ?? null,
    teams: teams.map((team) => ({
      id: team.id as string,
      displayName: team.displayName as string,
      // 公開集計ラベルはまだどこも書いていない。値が生まれた時点でここに繋ぐ。
      publicAggregateLabel: null,
    })),
    // 通知の公開は本タスクの範囲外。lessonRunPublic の notifications を
    // 書く本番コードは現時点で存在しないため、空配列が実態と一致する。
    recentNotifications: [],
    // --- 以下は禁止フィールド。実値は決して写さない（モジュールJSDoc参照）。
    randomSeed: '',
    restoreGeneration: 0,
  }
}

/** 本番配線: Firestore Admin SDK。 */
export const buildProjectionSourceWithAdminSdk = (
  lessonRunId: string,
): Promise<LessonRunProjectionSource | null> => {
  const db = getFirestore()
  return buildProjectionSource({
    getRun: async (id) => {
      const snap = await db.doc(`lessonRuns/${id}`).get()
      return snap.exists ? (snap.data() as Record<string, unknown>) : null
    },
    getTeams: async (id) => {
      const snap = await db.collection(`lessonRuns/${id}/teams`).get()
      return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    },
  }, lessonRunId)
}
```

- [ ] **Step 4: テストを実行して緑を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/projections/buildProjectionSource.test.ts`
Expected: PASS（5件）

- [ ] **Step 5: `setTeacherGuidance` を `buildProjectionSource` に寄せる**

`functions/src/lessonRuns/projections/setTeacherGuidance.ts` の全体を次に置き換える。

```ts
import { getDatabase } from 'firebase-admin/database'
import { getFirestore } from 'firebase-admin/firestore'
import { deriveDisplayMode, toLessonRunDisplayState, type LessonRunDisplayState } from './displayProjection'
import { buildProjectionSource, type BuildProjectionSourceDeps } from './buildProjectionSource'

export interface SetTeacherGuidanceInput { lessonRunId: string; teacherGuidance: string }
export interface SetTeacherGuidanceResult { teacherGuidance: string | null }
export interface SetTeacherGuidanceDeps {
  updateRun: (lessonRunId: string, patch: { teacherGuidance: string | null }) => Promise<void>
  source: BuildProjectionSourceDeps
  setDisplayState: (id: string, state: LessonRunDisplayState) => Promise<void>
  now?: () => number
}

/**
 * 教室表示のメッセージを保存し、教室表示を発行し直す。
 *
 * source の組み立ては `buildProjectionSource` に一本化した（従来はこの関数が
 * title/teams/goal を自前で拾う簡易版を持っていた）。`deriveDisplayMode` は
 * `toLessonRunDisplayState` の内部で使われるため、ここでは直接呼ばない。
 */
export const setTeacherGuidance = async (
  { updateRun, source, setDisplayState, now }: SetTeacherGuidanceDeps,
  { lessonRunId, teacherGuidance }: SetTeacherGuidanceInput,
): Promise<SetTeacherGuidanceResult> => {
  const normalized = teacherGuidance === '' ? null : teacherGuidance
  await updateRun(lessonRunId, { teacherGuidance: normalized })

  const nowMillis = now ? now() : Date.now()
  const projectionSource = await buildProjectionSource({ ...source, now: () => nowMillis }, lessonRunId)
  if (!projectionSource) throw new Error('LessonRun not found')

  await setDisplayState(lessonRunId, toLessonRunDisplayState(projectionSource, nowMillis))
  return { teacherGuidance: normalized }
}

export const setTeacherGuidanceWithAdminSdk = (input: SetTeacherGuidanceInput): Promise<SetTeacherGuidanceResult> => {
  const db = getFirestore()
  return setTeacherGuidance({
    updateRun: async (id, patch) => { await db.doc(`lessonRuns/${id}`).update(patch) },
    source: {
      getRun: async (id) => {
        const snap = await db.doc(`lessonRuns/${id}`).get()
        return snap.exists ? (snap.data() as Record<string, unknown>) : null
      },
      getTeams: async (id) => {
        const snap = await db.collection(`lessonRuns/${id}/teams`).get()
        return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      },
    },
    setDisplayState: (id, state) => getDatabase().ref(`lessonRunDisplay/${id}`).set(state),
  }, input)
}

export { deriveDisplayMode }
```

- [ ] **Step 6: `setTeacherGuidance.test.ts` を新しい deps 形に合わせる**

既存テストの deps 構築を次の形に置き換える。アサーション（`teacherGuidance` の正規化、`setDisplayState` に渡る state の中身）は変えない。

```ts
const buildDeps = (overrides: Partial<Record<string, unknown>> = {}) => {
  const updated: Array<{ id: string; patch: unknown }> = []
  const published: Array<{ id: string; state: unknown }> = []
  return {
    deps: {
      updateRun: async (id: string, patch: unknown) => { updated.push({ id, patch }) },
      source: {
        getRun: async () => ({
          orgId: 'org1',
          status: 'RUNNING',
          currentPhaseId: null,
          templateSnapshot: { title: '授業タイトル' },
          ...overrides,
        }),
        getTeams: async () => [{ id: 'team-a', displayName: 'Aチーム' }],
      },
      setDisplayState: async (id: string, state: unknown) => { published.push({ id, state }) },
      now: () => 1_700_000_000_000,
    },
    updated,
    published,
  }
}
```

- [ ] **Step 7: テストを実行して緑を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/projections`
Expected: PASS

- [ ] **Step 8: コミット**

```bash
git add -A functions/src/lessonRuns/projections
git commit -m "$(cat <<'EOF'
feat: add buildProjectionSource as the single source assembler

publicProjection.ts left source assembly to its callers and no caller was
ever wired up, so setTeacherGuidance carried the only (simplified) copy.
This gives every future publisher one assembler to share.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 教室表示モードの手動上書き（`displayModeOverride`）を projection に通す

`LessonRun` の `displayModeOverride` を source に載せ、`toLessonRunDisplayState` が status 由来より優先して読むようにする。介入からの書き込みは Task 10。

**Files:**
- Modify: `functions/src/lessonRuns/projections/source.ts`
- Modify: `functions/src/lessonRuns/projections/displayProjection.ts`
- Modify: `functions/src/lessonRuns/projections/displayProjection.test.ts`
- Modify: `functions/src/lessonRuns/projections/buildProjectionSource.ts`
- Modify: `functions/src/lessonRuns/projections/buildProjectionSource.test.ts`

**Interfaces:**
- Consumes: Task 4 の `buildProjectionSource`
- Produces: `LessonRunProjectionSource.displayModeOverride: LessonRunDisplayMode | null`。`toLessonRunDisplayState` の `mode` は `source.displayModeOverride ?? deriveDisplayMode(source.status)`。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonRuns/projections/displayProjection.test.ts` の末尾（最後の `})` の直前）に追加する。`privateRunFixture` は同ファイル冒頭の既存 `LessonRunProjectionSource` フィクスチャ。

```ts
describe('displayModeOverride', () => {
  it('override があれば status 由来のモードより優先する', () => {
    const source = { ...privateRunFixture, status: 'RUNNING', displayModeOverride: 'EXPLANATION' as const }
    expect(toLessonRunDisplayState(source, 6_000).mode).toBe('EXPLANATION')
  })

  it('override が null なら status から導出する', () => {
    const source = { ...privateRunFixture, status: 'RUNNING', displayModeOverride: null }
    expect(toLessonRunDisplayState(source, 6_000).mode).toBe('LIVE')
  })

  it('override は出力に露出しない', () => {
    const source = { ...privateRunFixture, displayModeOverride: 'END' as const }
    expect(toLessonRunDisplayState(source, 6_000)).not.toHaveProperty('displayModeOverride')
  })
})
```

`displayModeOverride` は Step 3 で `LessonRunProjectionSource` の**必須**フィールドになるため、`privateRunFixture` 自体にも追加が必要になる。Step 3 で次の行を `teacherGuidance` の直後に足す。

```ts
  displayModeOverride: null,
```

`functions/src/lessonRuns/projections/buildProjectionSource.test.ts` の末尾に追加する。

```ts
it('lessonRun の displayModeOverride を source に載せる', async () => {
  const source = await buildProjectionSource(
    { ...deps, getRun: async () => ({ ...run, displayModeOverride: 'EXPLANATION' }) },
    'run1',
  )
  expect(source?.displayModeOverride).toBe('EXPLANATION')
})

it('displayModeOverride が無ければ null にする', async () => {
  const source = await buildProjectionSource(deps, 'run1')
  expect(source?.displayModeOverride).toBeNull()
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/projections`
Expected: FAIL — `displayModeOverride` が `LessonRunProjectionSource` に存在しない旨の型エラー、および `expect(received).toBe('EXPLANATION')` が `'LIVE'` で失敗

- [ ] **Step 3: `source.ts` に `displayModeOverride` を足す**

`functions/src/lessonRuns/projections/source.ts` の `LessonRunProjectionSource` 内、`teacherGuidance` の直後に追加する。

```ts
  /**
   * 教師が `SWITCH_DISPLAY_MODE` 介入で明示的に選んだ教室表示のモード。
   * `null` のとき `deriveDisplayMode(status)` の自動導出に従う。表示モード
   * そのものであり禁止フィールドには当たらない（価格・係数・シードを何も
   * 含まない）。
   */
  displayModeOverride: LessonRunDisplayMode | null
```

ファイル先頭に import を追加する。

```ts
import type { LessonRunDisplayMode } from './displayProjection'
```

- [ ] **Step 4: `displayProjection.ts` の `mode` を override 優先にする**

`toLessonRunDisplayState` の `mode` 行を置き換える。

置換前:
```ts
  mode: deriveDisplayMode(source.status),
```
置換後:
```ts
  // 教師の明示指定 (SWITCH_DISPLAY_MODE 介入) を status 由来の自動導出より
  // 優先する。HOUSEHOLD_COMPARISON が status 由来でないのと同じ扱い。
  mode: source.displayModeOverride ?? deriveDisplayMode(source.status),
```

- [ ] **Step 5: `buildProjectionSource.ts` に `displayModeOverride` を足す**

返り値オブジェクトの `teacherGuidance` の直後に追加する。

```ts
    displayModeOverride: (run.displayModeOverride as LessonRunDisplayMode | null | undefined) ?? null,
```

ファイル先頭の import を追加する。

```ts
import type { LessonRunDisplayMode } from './displayProjection'
```

- [ ] **Step 6: テストを実行して緑を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/projections`
Expected: PASS

- [ ] **Step 7: コミット**

```bash
git add -A functions/src/lessonRuns/projections
git commit -m "$(cat <<'EOF'
feat: honor displayModeOverride in the classroom display projection

Lets a teacher pin the projector to a specific screen instead of following
status. Null keeps the existing deriveDisplayMode behavior. The override
itself is never emitted in the projected output.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: フェーズの残り時間を書き込む（`currentPhaseEndsAtMillis`）

`transitionPhase` がフェーズを変えるときに、そのフェーズの `durationSeconds` から終了時刻を計算して `lessonRun` に書く。読み側（`remainingPhaseSeconds`）は既に実装済み。

**Files:**
- Modify: `functions/src/lessonRuns/phases/transitionPhase.ts`
- Modify: `functions/src/lessonRuns/phases/transitionPhase.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `TransitionPhaseDeps.nowMillis?: () => number`（未指定時は `Date.now`）。`lessonRuns/{id}.currentPhaseEndsAtMillis: number | null` が遷移のたびに書かれる。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonRuns/phases/transitionPhase.test.ts` の末尾（最後の `})` の直前）に追加する。`makeFakeFirestore` / `setUpRun` は同ファイル内の既存ヘルパー。run の id は `run-1`。

```ts
const timedTemplateSnapshot = {
  phases: [
    { id: 'phase-intro', type: 'INTRO', progression: 'TIMED', durationSeconds: 300, nextPhaseIds: ['phase-market'], displayConfig: {} },
    { id: 'phase-market', type: 'MARKET', progression: 'TIMED', durationSeconds: 600, nextPhaseIds: ['phase-discussion'], displayConfig: {} },
    { id: 'phase-discussion', type: 'DISCUSSION', progression: 'TEACHER_CONTROLLED', nextPhaseIds: [], displayConfig: {} },
  ],
}

describe('currentPhaseEndsAtMillis', () => {
  it('durationSeconds を持つフェーズへ移ると終了時刻を書く', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs, { status: 'RUNNING', currentPhaseId: 'phase-intro', templateSnapshot: timedTemplateSnapshot })

    await transitionPhase({
      firestore: fake as never, actorId: 'teacher-1', writeCheckpoint: vi.fn(),
      now: () => 'fixed-now', nowMillis: () => 1_700_000_000_000,
    }, { lessonRunId: 'run-1', targetPhaseId: 'phase-market', reason: '次へ', idempotencyKey: 'tx-ends-1' })

    const run = fake.docs.get('lessonRuns/run-1') as Record<string, unknown>
    expect(run.currentPhaseEndsAtMillis).toBe(1_700_000_000_000 + 600 * 1000)
  })

  it('durationSeconds を持たないフェーズへ移ると null を書く', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs, { status: 'RUNNING', currentPhaseId: 'phase-intro', templateSnapshot: timedTemplateSnapshot })

    await transitionPhase({
      firestore: fake as never, actorId: 'teacher-1', writeCheckpoint: vi.fn(),
      now: () => 'fixed-now', nowMillis: () => 1_700_000_000_000,
    }, { lessonRunId: 'run-1', targetPhaseId: 'phase-discussion', reason: '次へ', idempotencyKey: 'tx-ends-2' })

    const run = fake.docs.get('lessonRuns/run-1') as Record<string, unknown>
    expect(run.currentPhaseEndsAtMillis).toBeNull()
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/phases/transitionPhase.test.ts`
Expected: FAIL — `expected undefined to be 1700000600000`

- [ ] **Step 3: `TransitionPhaseDeps` に `nowMillis` を足す**

`functions/src/lessonRuns/phases/transitionPhase.ts` の `TransitionPhaseDeps` 内、`now?: () => unknown` の直後に追加する。

```ts
  /**
   * エポックミリ秒の時計。`now` は `serverOccurredAt` 用の ISO 文字列を返す
   * 別物なので、フェーズ終了時刻の計算にはこちらを使う。
   */
  nowMillis?: () => number
```

- [ ] **Step 4: 終了時刻を計算して書き込む**

`transitionPhase` 本体、`const nowValue = deps.now ? ... ` の直後に追加する。

```ts
  const nowMillisValue = deps.nowMillis ? deps.nowMillis() : Date.now()
```

トランザクション内、`const newPhaseId = input.targetPhaseId ?? run.currentPhaseId` の直後に追加する。

```ts
    // 新フェーズに制限時間があれば終了時刻を確定する。無ければ null。
    // 読み側 (publicProjection.ts の remainingPhaseSeconds) は既に実装済みで、
    // これまでこの値を書くコードが無かったため常にカウントダウンが出なかった。
    const newPhase = run.templateSnapshot?.phases?.find((phase) => phase.id === newPhaseId)
    const durationSeconds = newPhase?.durationSeconds
    const currentPhaseEndsAtMillis =
      typeof durationSeconds === 'number' && durationSeconds > 0
        ? nowMillisValue + durationSeconds * 1000
        : null
```

`tx.set(runPath, ...)` を置き換える。

置換前:
```ts
    tx.set(runPath, { ...run, status: newStatus, currentPhaseId: newPhaseId, startedAt, endedAt })
```
置換後:
```ts
    tx.set(runPath, { ...run, status: newStatus, currentPhaseId: newPhaseId, startedAt, endedAt, currentPhaseEndsAtMillis })
```

- [ ] **Step 5: テストを実行して緑を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/phases/transitionPhase.test.ts`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add -A functions/src/lessonRuns/phases
git commit -m "$(cat <<'EOF'
feat: write currentPhaseEndsAtMillis on phase transitions

publicProjection.ts already derived remainingPhaseSeconds from this field,
but nothing in production ever wrote it, so the countdown was always absent.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 教室表示の発行を授業の進行に配線する

`publishLessonProjectionWithAdminSdk` を `transitionPhase` から呼ぶ。これで教室表示がフェーズ・状態の変化に追従する。

**Files:**
- Modify: `functions/src/lessonRuns/projections/publicProjection.ts`
- Modify: `functions/src/lessonRuns/phases/transitionPhase.ts`
- Modify: `functions/src/lessonRuns/phases/transitionPhase.test.ts`

**Interfaces:**
- Consumes: Task 4 の `buildProjectionSourceWithAdminSdk`、Task 5 の `displayModeOverride`
- Produces:
  ```ts
  // functions/src/lessonRuns/projections/publicProjection.ts
  export const publishLessonProjectionForRunWithAdminSdk: (lessonRunId: string) => Promise<void>
  // functions/src/lessonRuns/phases/transitionPhase.ts
  // TransitionPhaseDeps.publishLessonProjection?: (lessonRunId: string) => Promise<void>
  ```

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonRuns/phases/transitionPhase.test.ts` の末尾（最後の `})` の直前）に追加する。

```ts
describe('publishLessonProjection', () => {
  it('遷移のコミット後に教室表示を発行する', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs, { status: 'RUNNING', currentPhaseId: 'phase-a' })
    const published: string[] = []

    await transitionPhase({
      firestore: fake as never, actorId: 'teacher-1', writeCheckpoint: vi.fn(),
      publishLessonProjection: async (id: string) => { published.push(id) },
    }, { lessonRunId: 'run-1', targetPhaseId: 'phase-b', reason: '次へ', idempotencyKey: 'tx-pub-1' })

    expect(published).toEqual(['run-1'])
  })

  it('publishLessonProjection 未設定でも遷移は成功する', async () => {
    const fake = makeFakeFirestore()
    setUpRun(fake.docs, { status: 'RUNNING', currentPhaseId: 'phase-a' })

    await expect(transitionPhase({
      firestore: fake as never, actorId: 'teacher-1', writeCheckpoint: vi.fn(),
    }, { lessonRunId: 'run-1', targetPhaseId: 'phase-b', reason: '次へ', idempotencyKey: 'tx-pub-2' }))
      .resolves.toBeDefined()
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/phases/transitionPhase.test.ts`
Expected: FAIL — `expected [] to deeply equal [ 'run1' ]`

- [ ] **Step 3: `publicProjection.ts` に run 単位の発行関数を足す**

`functions/src/lessonRuns/projections/publicProjection.ts` の末尾に追加する。

```ts
/**
 * lessonRunId だけを受け取って教室表示と公開状態を発行し直す本番用の入口。
 *
 * `publishLessonProjectionWithAdminSdk` は source を呼び出し側が用意する
 * 前提だったため誰も呼べていなかった。この関数が `buildProjectionSource` と
 * 繋いで「授業の状態が変わったらこれを呼ぶ」だけで済むようにする。
 * lessonRun が存在しない場合は何もしない（削除済み run に対する遅延呼び出しを
 * エラーにしない）。
 */
export const publishLessonProjectionForRunWithAdminSdk = async (lessonRunId: string): Promise<void> => {
  const { buildProjectionSourceWithAdminSdk } = await import('./buildProjectionSource')
  const source = await buildProjectionSourceWithAdminSdk(lessonRunId)
  if (!source) return
  await publishLessonProjectionWithAdminSdk({ lessonRunId, source })
}
```

- [ ] **Step 4: `transitionPhase` にフックを足す**

`TransitionPhaseDeps` の `publishResearchDeskProjection?: (lessonRunId: string) => Promise<void>` の直後に追加する。

```ts
  /**
   * トランザクションのコミット後に教室表示 (`lessonRunDisplay`) と公開状態
   * (`lessonRunPublic`) を発行し直すフック。`publishResearchDeskProjection`
   * と同じ「Firestore commit の後に副作用」順序に従う。
   */
  publishLessonProjection?: (lessonRunId: string) => Promise<void>
```

`if (deps.publishResearchDeskProjection) { ... }` ブロックの直後に追加する。

```ts
  if (deps.publishLessonProjection) {
    await deps.publishLessonProjection(input.lessonRunId)
  }
```

- [ ] **Step 5: 本番配線を足す**

`transitionPhaseWithAdminSdk` 内の dynamic import 行の直後に追加する。

```ts
  const { publishLessonProjectionForRunWithAdminSdk } = await import('../projections/publicProjection')
```

`transitionPhase({ ... })` に渡す deps に追加する。

```ts
    publishLessonProjection: publishLessonProjectionForRunWithAdminSdk,
```

- [ ] **Step 6: テストを実行して緑を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns`
Expected: PASS

- [ ] **Step 7: コミット**

```bash
git add -A functions/src/lessonRuns
git commit -m "$(cat <<'EOF'
feat: publish the classroom display on every phase transition

lessonRunDisplay was only ever written when a teacher saved a message, so the
projector stayed on whatever mode was current at that moment. It now follows
the lesson.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 参加・チーム編成の変更でも教室表示を発行する

教室表示には `teams` が出るため、参加成立とチーム割り当てでも発行し直す。

**Files:**
- Modify: `functions/src/lessonRuns/joinLessonRun.ts`
- Modify: `functions/src/lessonRuns/joinLessonRun.test.ts`
- Modify: `functions/src/lessonRuns/teams/assignTeam.ts`
- Modify: `functions/src/lessonRuns/teams/assignTeam.test.ts`

**Interfaces:**
- Consumes: Task 7 の `publishLessonProjectionForRunWithAdminSdk`
- Produces: `JoinLessonRunDeps.publishLessonProjection?: (lessonRunId: string) => Promise<void>`、`AssignParticipantToTeamDeps.publishLessonProjection?: (lessonRunId: string) => Promise<void>`。どちらも未設定なら何もしない。

- [ ] **Step 1: 実装ファイルの現行 deps 形を確認する**

Run: `sed -n '1,80p' functions/src/lessonRuns/joinLessonRun.ts`
Run: `sed -n '1,60p' functions/src/lessonRuns/teams/assignTeam.ts`

`Deps` インターフェースの定義位置と、トランザクション完了後の副作用（RTDBミラー同期など）を呼んでいる箇所を特定する。新しいフックはその副作用群の**最後**に置く。

- [ ] **Step 2: 失敗するテストを書く**

`functions/src/lessonRuns/joinLessonRun.test.ts` の `describe('joinLessonRun', ...)` 内の末尾に追加する。`makeFakeFirestore` / `setUpLessonRun` / `makeDeps` / `baseInput` は同ファイル内の既存ヘルパー。

```ts
  it('参加成立後に教室表示を発行する', async () => {
    const fake = makeFakeFirestore()
    setUpLessonRun(fake.docs)
    const published: string[] = []
    const deps = makeDeps(fake, {
      publishLessonProjection: async (id: string) => { published.push(id) },
    })

    await joinLessonRun(deps, baseInput())

    expect(published).toEqual(['run-1'])
  })
```

`functions/src/lessonRuns/teams/assignTeam.test.ts` の `describe('assignParticipantToTeam', ...)` 内の末尾に追加する。`makeFakeFirestore` / `setUpTeams` は同ファイル内の既存ヘルパー。

```ts
  it('チーム割り当て後に教室表示を発行する', async () => {
    const fake = makeFakeFirestore()
    setUpTeams(fake.docs)
    const published: string[] = []

    await assignParticipantToTeam({
      firestore: fake as never, actorId: 'teacher-1', now: () => 'fixed-now',
      publishLessonProjection: async (id: string) => { published.push(id) },
    }, { lessonRunId: 'run-1', participantId: 'p-new', idempotencyKey: 'assign-pub-1' })

    expect(published).toEqual(['run-1'])
  })
```

- [ ] **Step 3: テストを実行して失敗を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/joinLessonRun.test.ts src/lessonRuns/teams/assignTeam.test.ts`
Expected: FAIL — 両方で `expected [] to deeply equal [ 'run-1' ]`

- [ ] **Step 4: `joinLessonRun` にフックを足す**

`JoinLessonRunDeps` に追加する。

```ts
  /** トランザクションのコミット後に教室表示を発行し直すフック（teams が教室表示に出るため）。 */
  publishLessonProjection?: (lessonRunId: string) => Promise<void>
```

トランザクション完了後の副作用群の最後に追加する。

```ts
  if (deps.publishLessonProjection) {
    await deps.publishLessonProjection(input.lessonRunId)
  }
```

`joinLessonRunWithAdminSdk` の deps に追加する。

```ts
    publishLessonProjection: async (id) => {
      const { publishLessonProjectionForRunWithAdminSdk } = await import('./projections/publicProjection')
      await publishLessonProjectionForRunWithAdminSdk(id)
    },
```

- [ ] **Step 5: `assignParticipantToTeam` にフックを足す**

`AssignParticipantToTeamDeps` に追加する。

```ts
  /** トランザクションのコミット後に教室表示を発行し直すフック（teams が教室表示に出るため）。 */
  publishLessonProjection?: (lessonRunId: string) => Promise<void>
```

トランザクション完了後の副作用群の最後に追加する。

```ts
  if (deps.publishLessonProjection) {
    await deps.publishLessonProjection(input.lessonRunId)
  }
```

`assignParticipantToTeamWithAdminSdk` の deps に追加する。

```ts
    publishLessonProjection: async (id) => {
      const { publishLessonProjectionForRunWithAdminSdk } = await import('../projections/publicProjection')
      await publishLessonProjectionForRunWithAdminSdk(id)
    },
```

- [ ] **Step 6: テストを実行して緑を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns`
Expected: PASS

- [ ] **Step 7: コミット**

```bash
git add -A functions/src/lessonRuns
git commit -m "$(cat <<'EOF'
feat: republish the classroom display when teams change

Joining a run and team assignment both change LessonRunDisplayState.teams,
which the projector renders.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: `EXTEND_TIME` に実効を与える

**Files:**
- Create: `functions/src/lessonRuns/interventions/extendPhaseTimer.ts`
- Create: `functions/src/lessonRuns/interventions/extendPhaseTimer.test.ts`
- Modify: `functions/src/lessonRuns/interventions.ts`
- Modify: `functions/src/lessonRuns/interventions.test.ts`
- Modify: `functions/src/lessonRuns/interventions/onCall.ts`

**Interfaces:**
- Consumes: Task 6 の `currentPhaseEndsAtMillis`、Task 7 の `publishLessonProjectionForRunWithAdminSdk`
- Produces:
  ```ts
  export const MAX_EXTEND_SECONDS = 1800
  export interface ExtendPhaseTimerInput {
    lessonRunId: string
    phaseId: string
    additionalSeconds: number
  }
  export interface ExtendPhaseTimerResult { currentPhaseEndsAtMillis: number }
  export interface ExtendPhaseTimerDeps {
    firestore: { runTransaction: <T>(fn: (tx: FirestoreTx) => Promise<T>) => Promise<T> }
    publishLessonProjection?: (lessonRunId: string) => Promise<void>
  }
  export const extendPhaseTimer: (deps: ExtendPhaseTimerDeps, input: ExtendPhaseTimerInput) => Promise<ExtendPhaseTimerResult>
  export const extendPhaseTimerWithAdminSdk: (input: ExtendPhaseTimerInput) => Promise<ExtendPhaseTimerResult>
  ```
  `InterventionDelegates` に `extendPhaseTimer: (input: { lessonRunId: string; phaseId: string; additionalSeconds: number; idempotencyKey: string }) => Promise<unknown>` が加わる。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonRuns/interventions/extendPhaseTimer.test.ts` を新規作成する。

```ts
import { describe, expect, it } from 'vitest'
import { extendPhaseTimer } from './extendPhaseTimer'

const buildDeps = (run: Record<string, unknown>) => {
  const writes: Array<{ path: string; data: Record<string, unknown> }> = []
  const published: string[] = []
  return {
    writes,
    published,
    deps: {
      firestore: {
        runTransaction: async <T>(fn: (tx: {
          get: (path: string) => Promise<{ exists: boolean; data: () => unknown }>
          set: (path: string, data: Record<string, unknown>) => void
        }) => Promise<T>): Promise<T> => fn({
          get: async () => ({ exists: true, data: () => run }),
          set: (path, data) => { writes.push({ path, data }) },
        }),
      },
      publishLessonProjection: async (id: string) => { published.push(id) },
    },
  }
}

const run = {
  orgId: 'org1',
  status: 'RUNNING',
  currentPhaseId: 'phase-market',
  currentPhaseEndsAtMillis: 1_700_000_060_000,
}

describe('extendPhaseTimer', () => {
  it('現在フェーズの終了時刻に加算する', async () => {
    const { deps, writes } = buildDeps(run)

    const result = await extendPhaseTimer(deps, {
      lessonRunId: 'run1',
      phaseId: 'phase-market',
      additionalSeconds: 180,
    })

    expect(result.currentPhaseEndsAtMillis).toBe(1_700_000_060_000 + 180_000)
    expect(writes[0].path).toBe('lessonRuns/run1')
    expect(writes[0].data.currentPhaseEndsAtMillis).toBe(1_700_000_060_000 + 180_000)
  })

  it('加算後に教室表示を発行する', async () => {
    const { deps, published } = buildDeps(run)
    await extendPhaseTimer(deps, { lessonRunId: 'run1', phaseId: 'phase-market', additionalSeconds: 60 })
    expect(published).toEqual(['run1'])
  })

  it('現在フェーズと一致しない phaseId を拒否する', async () => {
    const { deps } = buildDeps(run)
    await expect(
      extendPhaseTimer(deps, { lessonRunId: 'run1', phaseId: 'phase-intro', additionalSeconds: 60 }),
    ).rejects.toThrow('Phase is no longer current')
  })

  it('制限時間の無いフェーズを拒否する', async () => {
    const { deps } = buildDeps({ ...run, currentPhaseEndsAtMillis: null })
    await expect(
      extendPhaseTimer(deps, { lessonRunId: 'run1', phaseId: 'phase-market', additionalSeconds: 60 }),
    ).rejects.toThrow('Phase has no timer')
  })

  it('0以下の秒数を拒否する', async () => {
    const { deps } = buildDeps(run)
    await expect(
      extendPhaseTimer(deps, { lessonRunId: 'run1', phaseId: 'phase-market', additionalSeconds: 0 }),
    ).rejects.toThrow('additionalSeconds must be between 1 and 1800')
  })

  it('上限を超える秒数を拒否する', async () => {
    const { deps } = buildDeps(run)
    await expect(
      extendPhaseTimer(deps, { lessonRunId: 'run1', phaseId: 'phase-market', additionalSeconds: 1801 }),
    ).rejects.toThrow('additionalSeconds must be between 1 and 1800')
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/interventions/extendPhaseTimer.test.ts`
Expected: FAIL — `Failed to resolve import "./extendPhaseTimer"`

- [ ] **Step 3: 実装する**

`functions/src/lessonRuns/interventions/extendPhaseTimer.ts` を新規作成する。

```ts
import { getFirestore } from 'firebase-admin/firestore'

/** 1回の介入で延ばせる上限。50分授業1コマを丸ごと超える延長は誤操作とみなす。 */
export const MAX_EXTEND_SECONDS = 1800

interface FirestoreTx {
  get: (path: string) => Promise<{ exists: boolean; data: () => unknown }>
  set: (path: string, data: Record<string, unknown>) => void
}

export interface ExtendPhaseTimerInput {
  lessonRunId: string
  phaseId: string
  additionalSeconds: number
}

export interface ExtendPhaseTimerResult {
  currentPhaseEndsAtMillis: number
}

export interface ExtendPhaseTimerDeps {
  firestore: { runTransaction: <T>(fn: (tx: FirestoreTx) => Promise<T>) => Promise<T> }
  publishLessonProjection?: (lessonRunId: string) => Promise<void>
}

/**
 * `EXTEND_TIME` 介入の実処理。現在フェーズの終了時刻を後ろへずらす。
 *
 * `phaseId` が現在のフェーズと一致するときだけ受理する。教師が延長ボタンを
 * 押すまでの間にフェーズが進んでいた場合、古いフェーズを延ばしても意味が
 * 無いどころか、進行中のフェーズの残り時間を誤って書き換えてしまうため。
 */
export const extendPhaseTimer = async (
  deps: ExtendPhaseTimerDeps,
  input: ExtendPhaseTimerInput,
): Promise<ExtendPhaseTimerResult> => {
  if (
    !Number.isInteger(input.additionalSeconds)
    || input.additionalSeconds < 1
    || input.additionalSeconds > MAX_EXTEND_SECONDS
  ) {
    throw new Error(`additionalSeconds must be between 1 and ${MAX_EXTEND_SECONDS}`)
  }

  const result = await deps.firestore.runTransaction(async (tx) => {
    const runPath = `lessonRuns/${input.lessonRunId}`
    const snap = await tx.get(runPath)
    if (!snap.exists) throw new Error('LessonRun not found')
    const run = snap.data() as Record<string, unknown>

    if (run.currentPhaseId !== input.phaseId) throw new Error('Phase is no longer current')

    const currentEnds = run.currentPhaseEndsAtMillis
    if (typeof currentEnds !== 'number') throw new Error('Phase has no timer')

    const next = currentEnds + input.additionalSeconds * 1000
    tx.set(runPath, { ...run, currentPhaseEndsAtMillis: next })
    return { currentPhaseEndsAtMillis: next }
  })

  if (deps.publishLessonProjection) {
    await deps.publishLessonProjection(input.lessonRunId)
  }
  return result
}

export const extendPhaseTimerWithAdminSdk = (input: ExtendPhaseTimerInput): Promise<ExtendPhaseTimerResult> => {
  const db = getFirestore()
  return extendPhaseTimer({
    firestore: {
      runTransaction: (fn) => db.runTransaction((tx) => fn({
        get: async (path) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: () => snap.data() } },
        set: (path, data) => { tx.set(db.doc(path), data) },
      })),
    },
    publishLessonProjection: async (id) => {
      const { publishLessonProjectionForRunWithAdminSdk } = await import('../projections/publicProjection')
      await publishLessonProjectionForRunWithAdminSdk(id)
    },
  }, input)
}
```

- [ ] **Step 4: テストを実行して緑を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/interventions/extendPhaseTimer.test.ts`
Expected: PASS（6件）

- [ ] **Step 5: `interventions.ts` に delegate を繋ぐ**

`InterventionDelegates` に追加する。

```ts
  extendPhaseTimer: (input: {
    lessonRunId: string; phaseId: string; additionalSeconds: number; idempotencyKey: string
  }) => Promise<unknown>
```

`applyTeacherIntervention` の `switch (input.type)` に case を追加する（`case 'EMERGENCY_STOP':` の直前）。

```ts
    case 'EXTEND_TIME':
      delegatedResult = await deps.delegates.extendPhaseTimer({
        lessonRunId: input.lessonRunId,
        phaseId: input.detail.phaseId as string,
        additionalSeconds: Number(input.detail.additionalSeconds),
        idempotencyKey: `intervention:${input.idempotencyKey}`,
      })
      break
```

`GENERIC_STATE_TYPES` から `'EXTEND_TIME'` を除く。

```ts
const GENERIC_STATE_TYPES = new Set<LessonInterventionType>(['SWITCH_DISPLAY_MODE', 'CORRECT_STATE', 'HIDE_INFORMATION'])
```

`applyTeacherInterventionWithAdminSdk` の `delegates` に追加する。

```ts
    extendPhaseTimer: async (i) => {
      const { extendPhaseTimerWithAdminSdk } = await import('./interventions/extendPhaseTimer')
      return extendPhaseTimerWithAdminSdk({
        lessonRunId: i.lessonRunId, phaseId: i.phaseId, additionalSeconds: i.additionalSeconds,
      })
    },
```

- [ ] **Step 6: `onCall.ts` にエラー写像を足す**

`translateInterventionError` 内、既存の `if` 群の末尾に追加する。

```ts
    if (error.message === 'Phase is no longer current') return new HttpsError('failed-precondition', 'フェーズが既に進んでいます。画面を更新してもう一度お試しください。')
    if (error.message === 'Phase has no timer') return new HttpsError('failed-precondition', 'このフェーズには制限時間がありません。')
    if (error.message.startsWith('additionalSeconds must be between')) return new HttpsError('invalid-argument', error.message)
```

- [ ] **Step 7: `interventions.test.ts` の `makeDelegates` に `extendPhaseTimer` を足す**

`makeDelegates` は `it.each(lessonInterventionTypes)` の table-driven テストが全型で使うため、delegate が欠けると `EXTEND_TIME` の「accepts ... with a fully-populated detail payload」が落ちる。

```ts
  extendPhaseTimer: vi.fn().mockResolvedValue({ currentPhaseEndsAtMillis: 1_700_000_240_000 }),
```

- [ ] **Step 8: テストを実行して緑を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/interventions`
Expected: PASS

- [ ] **Step 9: コミット**

```bash
git add -A functions/src/lessonRuns
git commit -m "$(cat <<'EOF'
feat: make EXTEND_TIME actually extend the phase timer

It was one of four interventions whose only effect was an audit event, so
pressing it changed nothing a teacher could observe.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: `SWITCH_DISPLAY_MODE` に実効を与える

**Files:**
- Create: `functions/src/lessonRuns/interventions/setDisplayModeOverride.ts`
- Create: `functions/src/lessonRuns/interventions/setDisplayModeOverride.test.ts`
- Modify: `functions/src/lessonRuns/interventions.ts`
- Modify: `functions/src/lessonRuns/interventions.test.ts`
- Modify: `functions/src/lessonRuns/interventions/onCall.ts`

**Interfaces:**
- Consumes: Task 5 の `displayModeOverride`、Task 7 の `publishLessonProjectionForRunWithAdminSdk`
- Produces:
  ```ts
  export const SWITCHABLE_DISPLAY_MODES: readonly LessonRunDisplayMode[]
  export interface SetDisplayModeOverrideInput {
    lessonRunId: string
    displayMode: LessonRunDisplayMode | null
  }
  export const setDisplayModeOverride: (deps: SetDisplayModeOverrideDeps, input: SetDisplayModeOverrideInput) => Promise<{ displayModeOverride: LessonRunDisplayMode | null }>
  export const setDisplayModeOverrideWithAdminSdk: (input: SetDisplayModeOverrideInput) => Promise<{ displayModeOverride: LessonRunDisplayMode | null }>
  ```
  `InterventionDelegates` に `setDisplayModeOverride: (input: { lessonRunId: string; displayMode: string | null }) => Promise<unknown>` が加わる。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonRuns/interventions/setDisplayModeOverride.test.ts` を新規作成する。

```ts
import { describe, expect, it } from 'vitest'
import { setDisplayModeOverride } from './setDisplayModeOverride'

const buildDeps = () => {
  const updates: Array<{ path: string; patch: Record<string, unknown> }> = []
  const published: string[] = []
  return {
    updates,
    published,
    deps: {
      updateRun: async (path: string, patch: Record<string, unknown>) => { updates.push({ path, patch }) },
      publishLessonProjection: async (id: string) => { published.push(id) },
    },
  }
}

describe('setDisplayModeOverride', () => {
  it('指定されたモードを lessonRun に書く', async () => {
    const { deps, updates } = buildDeps()

    const result = await setDisplayModeOverride(deps, { lessonRunId: 'run1', displayMode: 'EXPLANATION' })

    expect(result.displayModeOverride).toBe('EXPLANATION')
    expect(updates).toEqual([{ path: 'lessonRuns/run1', patch: { displayModeOverride: 'EXPLANATION' } }])
  })

  it('null で自動導出に戻す', async () => {
    const { deps, updates } = buildDeps()

    const result = await setDisplayModeOverride(deps, { lessonRunId: 'run1', displayMode: null })

    expect(result.displayModeOverride).toBeNull()
    expect(updates).toEqual([{ path: 'lessonRuns/run1', patch: { displayModeOverride: null } }])
  })

  it('書き込み後に教室表示を発行する', async () => {
    const { deps, published } = buildDeps()
    await setDisplayModeOverride(deps, { lessonRunId: 'run1', displayMode: 'END' })
    expect(published).toEqual(['run1'])
  })

  it('未知のモードを拒否する', async () => {
    const { deps } = buildDeps()
    await expect(
      setDisplayModeOverride(deps, { lessonRunId: 'run1', displayMode: 'NOPE' as never }),
    ).rejects.toThrow('Unknown display mode')
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/interventions/setDisplayModeOverride.test.ts`
Expected: FAIL — `Failed to resolve import "./setDisplayModeOverride"`

- [ ] **Step 3: 実装する**

`functions/src/lessonRuns/interventions/setDisplayModeOverride.ts` を新規作成する。

```ts
import { getFirestore } from 'firebase-admin/firestore'
import type { LessonRunDisplayMode } from '../projections/displayProjection'

/**
 * 教師が手動で指定できる教室表示のモード。`LessonRunDisplayMode` の全値を
 * そのまま採用する。`HOUSEHOLD_COMPARISON` を比較データが無い状態で選んだ
 * 場合は `ClassroomDisplayPage` が解説画面へフォールバックする（同ファイルの
 * HOUSEHOLD_COMPARISON case 参照）ので、ここで弾く必要はない。
 */
export const SWITCHABLE_DISPLAY_MODES: readonly LessonRunDisplayMode[] = [
  'START', 'LIVE', 'END', 'EXPLANATION', 'HOUSEHOLD_COMPARISON',
]

export interface SetDisplayModeOverrideInput {
  lessonRunId: string
  displayMode: LessonRunDisplayMode | null
}

export interface SetDisplayModeOverrideDeps {
  updateRun: (path: string, patch: Record<string, unknown>) => Promise<void>
  publishLessonProjection?: (lessonRunId: string) => Promise<void>
}

/**
 * `SWITCH_DISPLAY_MODE` 介入の実処理。`displayMode: null` は上書きの解除
 * （status からの自動導出に戻す）を意味する。
 */
export const setDisplayModeOverride = async (
  deps: SetDisplayModeOverrideDeps,
  input: SetDisplayModeOverrideInput,
): Promise<{ displayModeOverride: LessonRunDisplayMode | null }> => {
  if (input.displayMode !== null && !SWITCHABLE_DISPLAY_MODES.includes(input.displayMode)) {
    throw new Error('Unknown display mode')
  }

  await deps.updateRun(`lessonRuns/${input.lessonRunId}`, { displayModeOverride: input.displayMode })

  if (deps.publishLessonProjection) {
    await deps.publishLessonProjection(input.lessonRunId)
  }
  return { displayModeOverride: input.displayMode }
}

export const setDisplayModeOverrideWithAdminSdk = (
  input: SetDisplayModeOverrideInput,
): Promise<{ displayModeOverride: LessonRunDisplayMode | null }> => {
  const db = getFirestore()
  return setDisplayModeOverride({
    updateRun: async (path, patch) => { await db.doc(path).update(patch) },
    publishLessonProjection: async (id) => {
      const { publishLessonProjectionForRunWithAdminSdk } = await import('../projections/publicProjection')
      await publishLessonProjectionForRunWithAdminSdk(id)
    },
  }, input)
}
```

- [ ] **Step 4: テストを実行して緑を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/interventions/setDisplayModeOverride.test.ts`
Expected: PASS（4件）

- [ ] **Step 5: `interventions.ts` に delegate を繋ぐ**

`InterventionDelegates` に追加する。

```ts
  setDisplayModeOverride: (input: { lessonRunId: string; displayMode: string | null }) => Promise<unknown>
```

`switch (input.type)` に case を追加する。

```ts
    case 'SWITCH_DISPLAY_MODE':
      delegatedResult = await deps.delegates.setDisplayModeOverride({
        lessonRunId: input.lessonRunId,
        displayMode: (input.detail.displayMode as string | null) ?? null,
      })
      break
```

`GENERIC_STATE_TYPES` から `'SWITCH_DISPLAY_MODE'` を除く。

```ts
const GENERIC_STATE_TYPES = new Set<LessonInterventionType>(['CORRECT_STATE', 'HIDE_INFORMATION'])
```

`applyTeacherInterventionWithAdminSdk` の `delegates` に追加する。

```ts
    setDisplayModeOverride: async (i) => {
      const { setDisplayModeOverrideWithAdminSdk } = await import('./interventions/setDisplayModeOverride')
      return setDisplayModeOverrideWithAdminSdk({
        lessonRunId: i.lessonRunId,
        displayMode: i.displayMode as never,
      })
    },
```

- [ ] **Step 6: `onCall.ts` にエラー写像を足す**

`translateInterventionError` 内に追加する。

```ts
    if (error.message === 'Unknown display mode') return new HttpsError('invalid-argument', '指定された画面が存在しません。')
```

- [ ] **Step 7: `interventions.test.ts` の `makeDelegates` に `setDisplayModeOverride` を足す**

```ts
  setDisplayModeOverride: vi.fn().mockResolvedValue({ displayModeOverride: 'EXPLANATION' }),
```

- [ ] **Step 8: テストを実行して緑を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns`
Expected: PASS

- [ ] **Step 9: コミット**

```bash
git add -A functions/src/lessonRuns
git commit -m "$(cat <<'EOF'
feat: make SWITCH_DISPLAY_MODE actually switch the classroom screen

Writes lessonRun.displayModeOverride, which the display projection now reads
ahead of deriveDisplayMode. Passing null restores automatic behavior.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: `HIDE_INFORMATION` に実効を与える

**Files:**
- Create: `functions/src/lessonRuns/interventions/setInformationHidden.ts`
- Create: `functions/src/lessonRuns/interventions/setInformationHidden.test.ts`
- Modify: `functions/src/market/researchDeskProjection.ts`
- Modify: `functions/src/market/researchDeskProjection.test.ts`
- Modify: `functions/src/lessonRuns/interventions.ts`
- Modify: `functions/src/lessonRuns/interventions.test.ts`

**Interfaces:**
- Consumes: なし（research desk projection は既存）
- Produces:
  ```ts
  export interface SetInformationHiddenInput {
    lessonRunId: string
    informationId: string
    hidden: boolean
  }
  export const setInformationHidden: (deps: SetInformationHiddenDeps, input: SetInformationHiddenInput) => Promise<{ hiddenInformationIds: string[] }>
  export const setInformationHiddenWithAdminSdk: (input: SetInformationHiddenInput) => Promise<{ hiddenInformationIds: string[] }>
  ```
  `BuildResearchDeskPublicViewInput` に `hiddenInformationIds?: string[]` が加わる。
  `REQUIRED_DETAIL_KEYS.HIDE_INFORMATION` が `['informationId', 'hidden']` になる。

- [ ] **Step 1: 失敗するテストを書く（projection 側）**

`functions/src/market/researchDeskProjection.test.ts` の末尾（最後の `})` の直前）に追加する。`fixtureMarketContent` は同ファイル冒頭の既存 `SocialStudiesMarketContent` フィクスチャで、公開済み（`publishedAtMillis: 1_000`）のニュース `info-past` を含む。

```ts
const newsDeskInput = {
  phaseId: 'phase-news',
  phases: [{ id: 'phase-news', phaseType: 'INFORMATION' }],
  socialStudiesMarket: fixtureMarketContent,
  nowMillis: 100_000,
}

describe('hiddenInformationIds', () => {
  it('非表示指定のニュースを除外する', () => {
    const view = buildResearchDeskPublicView({ ...newsDeskInput, hiddenInformationIds: ['info-past'] })
    expect(view.informationItems.map((item) => item.id)).not.toContain('info-past')
  })

  it('未指定なら何も除外しない', () => {
    const withoutHidden = buildResearchDeskPublicView(newsDeskInput)
    const withEmpty = buildResearchDeskPublicView({ ...newsDeskInput, hiddenInformationIds: [] })

    expect(withoutHidden.informationItems.map((item) => item.id)).toContain('info-past')
    expect(withEmpty.informationItems).toEqual(withoutHidden.informationItems)
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test --workspace=functions -- src/market/researchDeskProjection.test.ts`
Expected: FAIL — `hiddenInformationIds` が `BuildResearchDeskPublicViewInput` に存在しない旨の型エラー

- [ ] **Step 3: projection にフィルタを足す**

`functions/src/market/researchDeskProjection.ts` の `BuildResearchDeskPublicViewInput` に追加する。

```ts
  /** 教師が `HIDE_INFORMATION` 介入で非表示にしたニュースの id。未指定は「非表示なし」。 */
  hiddenInformationIds?: string[]
```

`informationItems` の組み立てを置き換える。

置換前:
```ts
  const informationItems: InformationPublicView[] = (availablePanels.includes('NEWS') && market?.informationItems)
    ? market.informationItems
        .filter((item) => item.publishedAtMillis <= input.nowMillis)
        .map((item) => toInformationPublicView(item))
    : []
```
置換後:
```ts
  const hiddenInformationIds = input.hiddenInformationIds ?? []
  const informationItems: InformationPublicView[] = (availablePanels.includes('NEWS') && market?.informationItems)
    ? market.informationItems
        .filter((item) => item.publishedAtMillis <= input.nowMillis)
        .filter((item) => !hiddenInformationIds.includes(item.id))
        .map((item) => toInformationPublicView(item))
    : []
```

`PublishResearchDeskProjectionDeps.getLessonRun` の返り値型に `hiddenInformationIds?: string[]` を追加し、`publishResearchDeskProjection` の `buildResearchDeskPublicView` 呼び出しに渡す。

```ts
  const view = buildResearchDeskPublicView({
    phaseId: run.currentPhaseId ?? null,
    phases: run.templateSnapshot?.phases,
    socialStudiesMarket: run.templateSnapshot?.socialStudiesMarket,
    hiddenInformationIds: run.hiddenInformationIds,
    nowMillis,
  })
```

`publishResearchDeskProjectionWithAdminSdk` の `getLessonRun` のキャスト型にも `hiddenInformationIds?: string[]` を追加する。

- [ ] **Step 4: テストを実行して緑を確認する**

Run: `npm test --workspace=functions -- src/market/researchDeskProjection.test.ts`
Expected: PASS

- [ ] **Step 5: 失敗するテストを書く（介入側）**

`functions/src/lessonRuns/interventions/setInformationHidden.test.ts` を新規作成する。

```ts
import { describe, expect, it } from 'vitest'
import { setInformationHidden } from './setInformationHidden'

const buildDeps = (run: Record<string, unknown>) => {
  const writes: Array<{ path: string; data: Record<string, unknown> }> = []
  const published: string[] = []
  return {
    writes,
    published,
    deps: {
      firestore: {
        runTransaction: async <T>(fn: (tx: {
          get: (path: string) => Promise<{ exists: boolean; data: () => unknown }>
          set: (path: string, data: Record<string, unknown>) => void
        }) => Promise<T>): Promise<T> => fn({
          get: async () => ({ exists: true, data: () => run }),
          set: (path, data) => { writes.push({ path, data }) },
        }),
      },
      publishResearchDeskProjection: async (id: string) => { published.push(id) },
    },
  }
}

describe('setInformationHidden', () => {
  it('非表示リストに追加する', async () => {
    const { deps, writes } = buildDeps({ orgId: 'org1', hiddenInformationIds: ['info-1'] })

    const result = await setInformationHidden(deps, { lessonRunId: 'run1', informationId: 'info-2', hidden: true })

    expect(result.hiddenInformationIds).toEqual(['info-1', 'info-2'])
    expect(writes[0].data.hiddenInformationIds).toEqual(['info-1', 'info-2'])
  })

  it('同じ id を二重に追加しない', async () => {
    const { deps } = buildDeps({ orgId: 'org1', hiddenInformationIds: ['info-1'] })
    const result = await setInformationHidden(deps, { lessonRunId: 'run1', informationId: 'info-1', hidden: true })
    expect(result.hiddenInformationIds).toEqual(['info-1'])
  })

  it('非表示リストから除去して再表示する', async () => {
    const { deps } = buildDeps({ orgId: 'org1', hiddenInformationIds: ['info-1', 'info-2'] })
    const result = await setInformationHidden(deps, { lessonRunId: 'run1', informationId: 'info-1', hidden: false })
    expect(result.hiddenInformationIds).toEqual(['info-2'])
  })

  it('リストが未設定でも追加できる', async () => {
    const { deps } = buildDeps({ orgId: 'org1' })
    const result = await setInformationHidden(deps, { lessonRunId: 'run1', informationId: 'info-1', hidden: true })
    expect(result.hiddenInformationIds).toEqual(['info-1'])
  })

  it('書き込み後に research desk を発行する', async () => {
    const { deps, published } = buildDeps({ orgId: 'org1' })
    await setInformationHidden(deps, { lessonRunId: 'run1', informationId: 'info-1', hidden: true })
    expect(published).toEqual(['run1'])
  })
})
```

- [ ] **Step 6: テストを実行して失敗を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/interventions/setInformationHidden.test.ts`
Expected: FAIL — `Failed to resolve import "./setInformationHidden"`

- [ ] **Step 7: 実装する**

`functions/src/lessonRuns/interventions/setInformationHidden.ts` を新規作成する。

```ts
import { getFirestore } from 'firebase-admin/firestore'

interface FirestoreTx {
  get: (path: string) => Promise<{ exists: boolean; data: () => unknown }>
  set: (path: string, data: Record<string, unknown>) => void
}

export interface SetInformationHiddenInput {
  lessonRunId: string
  informationId: string
  hidden: boolean
}

export interface SetInformationHiddenDeps {
  firestore: { runTransaction: <T>(fn: (tx: FirestoreTx) => Promise<T>) => Promise<T> }
  publishResearchDeskProjection?: (lessonRunId: string) => Promise<void>
}

/**
 * `HIDE_INFORMATION` 介入の実処理。`lessonRun.hiddenInformationIds` を
 * 出し入れし、research desk projection を発行し直す。
 *
 * 対象はニュース項目 (`informationItems`) のみ。`economicIndicators` は
 * 介入名（情報の非表示化）が指す対象ではないため触らない。
 *
 * `hidden: false` で元に戻せる。戻せない一方向の操作は授業中の誤操作から
 * 復帰できず、教師が押すことをためらう操作になるため。
 */
export const setInformationHidden = async (
  deps: SetInformationHiddenDeps,
  input: SetInformationHiddenInput,
): Promise<{ hiddenInformationIds: string[] }> => {
  const result = await deps.firestore.runTransaction(async (tx) => {
    const runPath = `lessonRuns/${input.lessonRunId}`
    const snap = await tx.get(runPath)
    if (!snap.exists) throw new Error('LessonRun not found')
    const run = snap.data() as Record<string, unknown>

    const current = Array.isArray(run.hiddenInformationIds) ? (run.hiddenInformationIds as string[]) : []
    const next = input.hidden
      ? (current.includes(input.informationId) ? current : [...current, input.informationId])
      : current.filter((id) => id !== input.informationId)

    tx.set(runPath, { ...run, hiddenInformationIds: next })
    return { hiddenInformationIds: next }
  })

  if (deps.publishResearchDeskProjection) {
    await deps.publishResearchDeskProjection(input.lessonRunId)
  }
  return result
}

export const setInformationHiddenWithAdminSdk = (
  input: SetInformationHiddenInput,
): Promise<{ hiddenInformationIds: string[] }> => {
  const db = getFirestore()
  return setInformationHidden({
    firestore: {
      runTransaction: (fn) => db.runTransaction((tx) => fn({
        get: async (path) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: () => snap.data() } },
        set: (path, data) => { tx.set(db.doc(path), data) },
      })),
    },
    publishResearchDeskProjection: async (id) => {
      const { publishResearchDeskProjectionWithAdminSdk } = await import('../../market/researchDeskProjection')
      await publishResearchDeskProjectionWithAdminSdk(id)
    },
  }, input)
}
```

- [ ] **Step 8: テストを実行して緑を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/interventions/setInformationHidden.test.ts`
Expected: PASS（5件）

- [ ] **Step 9: `interventions.ts` に delegate を繋ぐ**

`REQUIRED_DETAIL_KEYS` を更新する。

置換前:
```ts
  HIDE_INFORMATION: ['informationId'],
```
置換後:
```ts
  HIDE_INFORMATION: ['informationId', 'hidden'],
```

`InterventionDelegates` に追加する。

```ts
  setInformationHidden: (input: { lessonRunId: string; informationId: string; hidden: boolean }) => Promise<unknown>
```

`switch (input.type)` に case を追加する。

```ts
    case 'HIDE_INFORMATION':
      delegatedResult = await deps.delegates.setInformationHidden({
        lessonRunId: input.lessonRunId,
        informationId: input.detail.informationId as string,
        hidden: input.detail.hidden === true,
      })
      break
```

`GENERIC_STATE_TYPES` から `'HIDE_INFORMATION'` を除く。

```ts
const GENERIC_STATE_TYPES = new Set<LessonInterventionType>(['CORRECT_STATE'])
```

`applyTeacherInterventionWithAdminSdk` の `delegates` に追加する。

```ts
    setInformationHidden: async (i) => {
      const { setInformationHiddenWithAdminSdk } = await import('./interventions/setInformationHidden')
      return setInformationHiddenWithAdminSdk(i)
    },
```

- [ ] **Step 10: `interventions.test.ts` の `makeDelegates` と `REQUIRED_DETAIL` を更新する**

`makeDelegates` に追加する。

```ts
  setInformationHidden: vi.fn().mockResolvedValue({ hiddenInformationIds: ['info-1'] }),
```

`REQUIRED_DETAIL` の `HIDE_INFORMATION` を置き換える。`REQUIRED_DETAIL` に列挙したキーが `REQUIRED_DETAIL_KEYS`（実装側）と一致していないと table-driven テストが落ちる。

置換前:
```ts
  HIDE_INFORMATION: { informationId: 'info-1' },
```
置換後:
```ts
  HIDE_INFORMATION: { informationId: 'info-1', hidden: true },
```

- [ ] **Step 11: テストを実行して緑を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns src/market`
Expected: PASS

- [ ] **Step 12: コミット**

```bash
git add -A functions/src
git commit -m "$(cat <<'EOF'
feat: make HIDE_INFORMATION actually hide a news item

Adds lessonRun.hiddenInformationIds, filtered out by the research desk
projection. detail gains a `hidden` flag so the teacher can undo it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: `CORRECT_STATE` を許可リスト式にする

任意パス書き込み（`targetPath`）を廃止し、サーバ側の固定リストに限定する。

**Files:**
- Create: `functions/src/lessonRuns/interventions/correctState.ts`
- Create: `functions/src/lessonRuns/interventions/correctState.test.ts`
- Modify: `functions/src/lessonRuns/interventions.ts`
- Modify: `functions/src/lessonRuns/interventions.test.ts`
- Modify: `functions/src/lessonRuns/interventions/onCall.ts`

**Interfaces:**
- Consumes: Task 7 の `publishLessonProjectionForRunWithAdminSdk`
- Produces:
  ```ts
  export type CorrectStateTarget = 'PARTICIPANT_DISPLAY_NAME' | 'TEAM_DISPLAY_NAME'
  export const CORRECT_STATE_TARGETS: readonly CorrectStateTarget[]
  export const MAX_DISPLAY_NAME_LENGTH = 50
  export interface CorrectStateInput {
    lessonRunId: string
    target: CorrectStateTarget
    targetId: string
    displayName: string
  }
  export const correctState: (deps: CorrectStateDeps, input: CorrectStateInput) => Promise<{ target: CorrectStateTarget; targetId: string; displayName: string }>
  export const correctStateWithAdminSdk: (input: CorrectStateInput) => Promise<{ target: CorrectStateTarget; targetId: string; displayName: string }>
  ```
  `REQUIRED_DETAIL_KEYS.CORRECT_STATE` が `['target', 'targetId', 'displayName']` になる（`targetPath` は消滅）。

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonRuns/interventions/correctState.test.ts` を新規作成する。

```ts
import { describe, expect, it } from 'vitest'
import { correctState } from './correctState'

const buildDeps = () => {
  const updates: Array<{ path: string; patch: Record<string, unknown> }> = []
  const published: string[] = []
  return {
    updates,
    published,
    deps: {
      updateDoc: async (path: string, patch: Record<string, unknown>) => { updates.push({ path, patch }) },
      publishLessonProjection: async (id: string) => { published.push(id) },
    },
  }
}

describe('correctState', () => {
  it('参加者の表示名を直す', async () => {
    const { deps, updates } = buildDeps()

    await correctState(deps, {
      lessonRunId: 'run1',
      target: 'PARTICIPANT_DISPLAY_NAME',
      targetId: 'p1',
      displayName: '山田 太郎',
    })

    expect(updates).toEqual([
      { path: 'lessonRuns/run1/participants/p1', patch: { displayName: '山田 太郎' } },
    ])
  })

  it('チーム名を直す', async () => {
    const { deps, updates } = buildDeps()

    await correctState(deps, {
      lessonRunId: 'run1',
      target: 'TEAM_DISPLAY_NAME',
      targetId: 'team-a',
      displayName: 'Aチーム',
    })

    expect(updates).toEqual([
      { path: 'lessonRuns/run1/teams/team-a', patch: { displayName: 'Aチーム' } },
    ])
  })

  it('チーム名の変更後に教室表示を発行する', async () => {
    const { deps, published } = buildDeps()
    await correctState(deps, { lessonRunId: 'run1', target: 'TEAM_DISPLAY_NAME', targetId: 'team-a', displayName: 'Aチーム' })
    expect(published).toEqual(['run1'])
  })

  it('参加者名の変更では教室表示を発行しない', async () => {
    const { deps, published } = buildDeps()
    await correctState(deps, { lessonRunId: 'run1', target: 'PARTICIPANT_DISPLAY_NAME', targetId: 'p1', displayName: '山田' })
    expect(published).toEqual([])
  })

  it('許可リストに無い target を拒否する', async () => {
    const { deps } = buildDeps()
    await expect(
      correctState(deps, { lessonRunId: 'run1', target: 'RANDOM_SEED' as never, targetId: 'x', displayName: 'y' }),
    ).rejects.toThrow('Unsupported correction target')
  })

  it('空の表示名を拒否する', async () => {
    const { deps } = buildDeps()
    await expect(
      correctState(deps, { lessonRunId: 'run1', target: 'TEAM_DISPLAY_NAME', targetId: 'team-a', displayName: '   ' }),
    ).rejects.toThrow('displayName must be 1 to 50 characters')
  })

  it('51文字以上の表示名を拒否する', async () => {
    const { deps } = buildDeps()
    await expect(
      correctState(deps, { lessonRunId: 'run1', target: 'TEAM_DISPLAY_NAME', targetId: 'team-a', displayName: 'あ'.repeat(51) }),
    ).rejects.toThrow('displayName must be 1 to 50 characters')
  })

  it('表示名の前後空白を除く', async () => {
    const { deps, updates } = buildDeps()
    await correctState(deps, { lessonRunId: 'run1', target: 'TEAM_DISPLAY_NAME', targetId: 'team-a', displayName: '  Aチーム  ' })
    expect(updates[0].patch.displayName).toBe('Aチーム')
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/interventions/correctState.test.ts`
Expected: FAIL — `Failed to resolve import "./correctState"`

- [ ] **Step 3: 実装する**

`functions/src/lessonRuns/interventions/correctState.ts` を新規作成する。

```ts
import { getFirestore } from 'firebase-admin/firestore'

/**
 * `CORRECT_STATE` 介入で直せる対象の許可リスト。
 *
 * 元の仕様は `targetPath`（任意の Firestore パス）だったが、それでは教師UIから
 * `randomSeed` / `future` / `restoreGeneration` といった統合仕様書 §26-1 の
 * 禁止フィールドへ到達できてしまう。このコードベースは projection を一貫して
 * allow-list で書いており（deny-list は明示的に却下されている）、書き込み側も
 * 同じ方針に揃える。
 *
 * この2つに絞った根拠:
 *  - 他の8つの介入でも既存 Callable でも直せない
 *  - 授業中に実際に起きる（打ち間違い）
 *  - 禁止フィールドから構造的に遠い（別ドキュメントの単一フィールド）
 *
 * 参加者の所属チーム変更は `assignParticipantToTeamCallable` が既にあるため
 * ここには含めない。
 */
export type CorrectStateTarget = 'PARTICIPANT_DISPLAY_NAME' | 'TEAM_DISPLAY_NAME'

export const CORRECT_STATE_TARGETS: readonly CorrectStateTarget[] = [
  'PARTICIPANT_DISPLAY_NAME',
  'TEAM_DISPLAY_NAME',
]

export const MAX_DISPLAY_NAME_LENGTH = 50

const COLLECTION_BY_TARGET: Record<CorrectStateTarget, string> = {
  PARTICIPANT_DISPLAY_NAME: 'participants',
  TEAM_DISPLAY_NAME: 'teams',
}

export interface CorrectStateInput {
  lessonRunId: string
  target: CorrectStateTarget
  targetId: string
  displayName: string
}

export interface CorrectStateDeps {
  updateDoc: (path: string, patch: Record<string, unknown>) => Promise<void>
  publishLessonProjection?: (lessonRunId: string) => Promise<void>
}

export const correctState = async (
  deps: CorrectStateDeps,
  input: CorrectStateInput,
): Promise<{ target: CorrectStateTarget; targetId: string; displayName: string }> => {
  if (!CORRECT_STATE_TARGETS.includes(input.target)) {
    throw new Error('Unsupported correction target')
  }
  if (!input.targetId) throw new Error('targetId is required')

  const displayName = (input.displayName ?? '').trim()
  if (displayName.length < 1 || displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    throw new Error(`displayName must be 1 to ${MAX_DISPLAY_NAME_LENGTH} characters`)
  }

  const collection = COLLECTION_BY_TARGET[input.target]
  await deps.updateDoc(`lessonRuns/${input.lessonRunId}/${collection}/${input.targetId}`, { displayName })

  // チーム名は教室表示の teams に出るので発行し直す。参加者名は
  // LessonRunDisplayState にも LessonRunPublicState にも載らない
  // （個人を特定しうる情報を全体ブロードキャストへ出さない §26-1）ため不要。
  if (input.target === 'TEAM_DISPLAY_NAME' && deps.publishLessonProjection) {
    await deps.publishLessonProjection(input.lessonRunId)
  }

  return { target: input.target, targetId: input.targetId, displayName }
}

export const correctStateWithAdminSdk = (
  input: CorrectStateInput,
): Promise<{ target: CorrectStateTarget; targetId: string; displayName: string }> => {
  const db = getFirestore()
  return correctState({
    updateDoc: async (path, patch) => { await db.doc(path).update(patch) },
    publishLessonProjection: async (id) => {
      const { publishLessonProjectionForRunWithAdminSdk } = await import('../projections/publicProjection')
      await publishLessonProjectionForRunWithAdminSdk(id)
    },
  }, input)
}
```

- [ ] **Step 4: テストを実行して緑を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/interventions/correctState.test.ts`
Expected: PASS（8件）

- [ ] **Step 5: `interventions.ts` に delegate を繋ぐ**

`REQUIRED_DETAIL_KEYS` を更新する。

置換前:
```ts
  CORRECT_STATE: ['targetPath'],
```
置換後:
```ts
  CORRECT_STATE: ['target', 'targetId', 'displayName'],
```

`InterventionDelegates` に追加する。

```ts
  correctState: (input: { lessonRunId: string; target: string; targetId: string; displayName: string }) => Promise<unknown>
```

`switch (input.type)` に case を追加する。

```ts
    case 'CORRECT_STATE':
      delegatedResult = await deps.delegates.correctState({
        lessonRunId: input.lessonRunId,
        target: input.detail.target as string,
        targetId: input.detail.targetId as string,
        displayName: input.detail.displayName as string,
      })
      break
```

`GENERIC_STATE_TYPES` の定義と、それを使う `tx.set(.../teacherInterventionState/...)` ブロックを削除する。9種すべてが delegate を持つようになったため、汎用の state 書き込みは不要になる。

削除するブロック:
```ts
    if (GENERIC_STATE_TYPES.has(input.type)) {
      tx.set(`lessonRuns/${input.lessonRunId}/teacherInterventionState/${input.type}`, {
        type: input.type, after: input.after, updatedAt: nowValue, updatedBy: deps.actorId,
      })
    }
```

`switch` 末尾の `default:` ブロックのコメントを更新する。

置換前:
```ts
    default:
      // EXTEND_TIME, SWITCH_DISPLAY_MODE, CORRECT_STATE, HIDE_INFORMATION:
      // no existing function to delegate to (see GENERIC_STATE_TYPES).
      break
```
置換後:
```ts
    default:
      // 到達しない: 9種すべてが上の case で delegate を持つ。
      break
```

`applyTeacherInterventionWithAdminSdk` の `delegates` に追加する。

```ts
    correctState: async (i) => {
      const { correctStateWithAdminSdk } = await import('./interventions/correctState')
      return correctStateWithAdminSdk({
        lessonRunId: i.lessonRunId, target: i.target as never, targetId: i.targetId, displayName: i.displayName,
      })
    },
```

- [ ] **Step 6: `onCall.ts` にエラー写像を足す**

`translateInterventionError` 内に追加する。

```ts
    if (error.message === 'Unsupported correction target') return new HttpsError('invalid-argument', 'この項目は修正できません。')
    if (error.message.startsWith('displayName must be')) return new HttpsError('invalid-argument', '名前は1〜50文字で入力してください。')
    if (error.message === 'targetId is required') return new HttpsError('invalid-argument', '修正の対象を選んでください。')
```

- [ ] **Step 7: `interventions.test.ts` の `REQUIRED_DETAIL` と `makeDelegates` を更新する**

`REQUIRED_DETAIL` の `CORRECT_STATE` を置き換える。

置換前:
```ts
  CORRECT_STATE: { targetPath: 'lessonRuns/run-1/teams/team-a' },
```
置換後:
```ts
  CORRECT_STATE: { target: 'TEAM_DISPLAY_NAME', targetId: 'team-a', displayName: 'Aチーム' },
```

`makeDelegates` に追加する。

```ts
  correctState: vi.fn().mockResolvedValue({ target: 'TEAM_DISPLAY_NAME', targetId: 'team-a', displayName: 'Aチーム' }),
```

`teacherInterventionState` への書き込みを検証していたテストがあれば削除する。

Run: `grep -n "teacherInterventionState" functions/src/lessonRuns/interventions.test.ts`

該当行を含む `it(...)` ブロックごと削除する（9種すべてが delegate を持つようになり、この書き込み自体が無くなるため）。

- [ ] **Step 8: テストを実行して緑を確認する**

Run: `npm test --workspace=functions -- src/lessonRuns`
Expected: PASS

- [ ] **Step 9: コミット**

```bash
git add -A functions/src/lessonRuns
git commit -m "$(cat <<'EOF'
feat: replace CORRECT_STATE's arbitrary path write with an allow-list

targetPath would have let the teacher UI reach randomSeed, future, and
restoreGeneration. The allow-list covers the two corrections nothing else
can make: a participant's display name and a team's display name.

All nine interventions now have a delegate, so GENERIC_STATE_TYPES and its
teacherInterventionState write are gone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: 介入4種の専用フォームを作る

ID手入力を廃止し、画面が既に購読しているデータから選ばせる。

**Files:**
- Create: `src/components/teacher/interventionForms/ExtendTimeForm.tsx`
- Create: `src/components/teacher/interventionForms/DisplayModeForm.tsx`
- Create: `src/components/teacher/interventionForms/HideInformationForm.tsx`
- Create: `src/components/teacher/interventionForms/CorrectStateForm.tsx`
- Create: `src/components/teacher/interventionForms/interventionForms.test.tsx`
- Modify: `src/components/teacher/InterventionPanel.tsx`
- Modify: `src/components/teacher/InterventionPanel.test.tsx`
- Modify: `src/components/teacher/LessonControlRoom.tsx`

**Interfaces:**
- Consumes: Task 3 の `SWITCH_DISPLAY_MODE`、Task 9-12 の detail 形
- Produces:
  ```ts
  // 4つのフォームに共通の props
  export interface InterventionFormProps {
    onSubmit: (detail: Record<string, unknown>) => void
  }
  export interface ExtendTimeFormProps extends InterventionFormProps {
    currentPhaseId: string | null
    hasTimer: boolean
  }
  export interface DisplayModeFormProps extends InterventionFormProps {
    currentOverride: string | null
  }
  export interface HideInformationFormProps extends InterventionFormProps {
    informationItems: Array<{ id: string; body: string }>
    hiddenInformationIds: string[]
  }
  export interface CorrectStateFormProps extends InterventionFormProps {
    participants: Array<{ id: string; displayName: string }>
    teams: Array<{ teamId: string; displayName: string }>
  }
  ```
  `InterventionPanelProps` に次が加わる。
  ```ts
    currentPhaseId: string | null
    phaseHasTimer: boolean
    displayModeOverride: string | null
    informationItems: Array<{ id: string; body: string }>
    hiddenInformationIds: string[]
    participants: Array<{ id: string; displayName: string }>
    teams: Array<{ teamId: string; displayName: string }>
  ```

- [ ] **Step 1: 失敗するテストを書く**

`src/components/teacher/interventionForms/interventionForms.test.tsx` を新規作成する。

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExtendTimeForm } from './ExtendTimeForm'
import { DisplayModeForm } from './DisplayModeForm'
import { HideInformationForm } from './HideInformationForm'
import { CorrectStateForm } from './CorrectStateForm'

describe('ExtendTimeForm', () => {
  it('+3分でフェーズIDと秒数を組み立てる', async () => {
    const onSubmit = vi.fn()
    render(<ExtendTimeForm currentPhaseId="phase-market" hasTimer onSubmit={onSubmit} />)

    await userEvent.click(screen.getByRole('button', { name: '+3分' }))

    expect(onSubmit).toHaveBeenCalledWith({ phaseId: 'phase-market', additionalSeconds: 180 })
  })

  it('制限時間の無いフェーズでは理由を示して操作を出さない', () => {
    render(<ExtendTimeForm currentPhaseId="phase-discussion" hasTimer={false} onSubmit={vi.fn()} />)

    expect(screen.getByText('このフェーズには制限時間がありません。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+3分' })).not.toBeInTheDocument()
  })

  it('フェーズIDの手入力欄を持たない', () => {
    render(<ExtendTimeForm currentPhaseId="phase-market" hasTimer onSubmit={vi.fn()} />)
    expect(screen.queryByLabelText('フェーズID')).not.toBeInTheDocument()
  })
})

describe('DisplayModeForm', () => {
  it('選んだ画面を displayMode として渡す', async () => {
    const onSubmit = vi.fn()
    render(<DisplayModeForm currentOverride={null} onSubmit={onSubmit} />)

    await userEvent.click(screen.getByRole('button', { name: '解説の画面' }))

    expect(onSubmit).toHaveBeenCalledWith({ displayMode: 'EXPLANATION' })
  })

  it('自動に戻すで null を渡す', async () => {
    const onSubmit = vi.fn()
    render(<DisplayModeForm currentOverride="EXPLANATION" onSubmit={onSubmit} />)

    await userEvent.click(screen.getByRole('button', { name: '自動に戻す' }))

    expect(onSubmit).toHaveBeenCalledWith({ displayMode: null })
  })

  it('上書きが無いときは自動に戻すを出さない', () => {
    render(<DisplayModeForm currentOverride={null} onSubmit={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '自動に戻す' })).not.toBeInTheDocument()
  })
})

describe('HideInformationForm', () => {
  const items = [
    { id: 'info-1', body: '新製品を発表' },
    { id: 'info-2', body: '工場が停止' },
  ]

  it('公開中のニュースを非表示にする', async () => {
    const onSubmit = vi.fn()
    render(<HideInformationForm informationItems={items} hiddenInformationIds={[]} onSubmit={onSubmit} />)

    await userEvent.click(screen.getByRole('button', { name: '「工場が停止」を非表示にする' }))

    expect(onSubmit).toHaveBeenCalledWith({ informationId: 'info-2', hidden: true })
  })

  it('非表示中のニュースを元に戻す', async () => {
    const onSubmit = vi.fn()
    render(<HideInformationForm informationItems={items} hiddenInformationIds={['info-1']} onSubmit={onSubmit} />)

    await userEvent.click(screen.getByRole('button', { name: '「新製品を発表」を元に戻す' }))

    expect(onSubmit).toHaveBeenCalledWith({ informationId: 'info-1', hidden: false })
  })

  it('情報IDの手入力欄を持たない', () => {
    render(<HideInformationForm informationItems={items} hiddenInformationIds={[]} onSubmit={vi.fn()} />)
    expect(screen.queryByLabelText('情報ID')).not.toBeInTheDocument()
  })
})

describe('CorrectStateForm', () => {
  const participants = [{ id: 'p1', displayName: 'やまだ' }]
  const teams = [{ teamId: 'team-a', displayName: 'Aチーム' }]

  it('チーム名の修正を組み立てる', async () => {
    const onSubmit = vi.fn()
    render(<CorrectStateForm participants={participants} teams={teams} onSubmit={onSubmit} />)

    await userEvent.click(screen.getByRole('button', { name: 'チーム名' }))
    await userEvent.click(screen.getByRole('button', { name: 'Aチーム' }))
    const field = screen.getByLabelText('新しい名前')
    await userEvent.clear(field)
    await userEvent.type(field, 'Bチーム')
    await userEvent.click(screen.getByRole('button', { name: 'この名前に直す' }))

    expect(onSubmit).toHaveBeenCalledWith({
      target: 'TEAM_DISPLAY_NAME', targetId: 'team-a', displayName: 'Bチーム',
    })
  })

  it('対象パスの手入力欄を持たない', () => {
    render(<CorrectStateForm participants={participants} teams={teams} onSubmit={vi.fn()} />)
    expect(screen.queryByLabelText('対象パス')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test -- src/components/teacher/interventionForms`
Expected: FAIL — `Failed to resolve import "./ExtendTimeForm"`

- [ ] **Step 3: `ExtendTimeForm` を実装する**

`src/components/teacher/interventionForms/ExtendTimeForm.tsx` を新規作成する。

```tsx
import { Button, Stack, Typography } from '@mui/material'
import { MIN_TOUCH_TARGET } from '../../lessonInputs/lessonInputA11y'

export interface ExtendTimeFormProps {
  currentPhaseId: string | null
  hasTimer: boolean
  onSubmit: (detail: Record<string, unknown>) => void
}

/**
 * 時間延長の専用フォーム。フェーズIDは画面が購読している現在フェーズを
 * そのまま使い、教師には見せない（教師が知り得ない内部IDのため）。
 */
const CHOICES: Array<{ label: string; seconds: number }> = [
  { label: '+1分', seconds: 60 },
  { label: '+3分', seconds: 180 },
  { label: '+5分', seconds: 300 },
]

export function ExtendTimeForm({ currentPhaseId, hasTimer, onSubmit }: ExtendTimeFormProps) {
  if (!hasTimer || !currentPhaseId) {
    return <Typography variant="body2" color="text.secondary">このフェーズには制限時間がありません。</Typography>
  }

  return (
    <Stack spacing={1}>
      <Typography variant="body2" color="text.secondary">いま進行中のフェーズの残り時間を延ばします。</Typography>
      <Stack direction="row" spacing={1}>
        {CHOICES.map((choice) => (
          <Button
            key={choice.seconds}
            variant="outlined"
            sx={{ minHeight: MIN_TOUCH_TARGET }}
            onClick={() => onSubmit({ phaseId: currentPhaseId, additionalSeconds: choice.seconds })}
          >
            {choice.label}
          </Button>
        ))}
      </Stack>
    </Stack>
  )
}
```

- [ ] **Step 4: `DisplayModeForm` を実装する**

`src/components/teacher/interventionForms/DisplayModeForm.tsx` を新規作成する。

```tsx
import { Button, Stack, Typography } from '@mui/material'
import { MIN_TOUCH_TARGET } from '../../lessonInputs/lessonInputA11y'

export interface DisplayModeFormProps {
  currentOverride: string | null
  onSubmit: (detail: Record<string, unknown>) => void
}

/** LessonControlRoom.tsx の DISPLAY_MODE_LABEL と同じ用語を使う。 */
const MODES: Array<{ mode: string; label: string }> = [
  { mode: 'START', label: '開始待機の画面' },
  { mode: 'LIVE', label: '授業中の画面' },
  { mode: 'EXPLANATION', label: '解説の画面' },
  { mode: 'END', label: '終了の画面' },
  { mode: 'HOUSEHOLD_COMPARISON', label: 'クラス比較の画面' },
]

export function DisplayModeForm({ currentOverride, onSubmit }: DisplayModeFormProps) {
  const currentLabel = MODES.find((entry) => entry.mode === currentOverride)?.label

  return (
    <Stack spacing={1}>
      <Typography variant="body2" color="text.secondary">
        {currentLabel
          ? `いま「${currentLabel}」に固定しています。`
          : '教室表示は授業の進行に合わせて自動で切り替わっています。'}
      </Typography>
      <Stack spacing={1}>
        {MODES.map((entry) => (
          <Button
            key={entry.mode}
            variant={entry.mode === currentOverride ? 'contained' : 'outlined'}
            sx={{ minHeight: MIN_TOUCH_TARGET }}
            onClick={() => onSubmit({ displayMode: entry.mode })}
          >
            {entry.label}
          </Button>
        ))}
      </Stack>
      {currentOverride && (
        <Button
          variant="text"
          sx={{ minHeight: MIN_TOUCH_TARGET }}
          onClick={() => onSubmit({ displayMode: null })}
        >
          自動に戻す
        </Button>
      )}
    </Stack>
  )
}
```

- [ ] **Step 5: `HideInformationForm` を実装する**

`src/components/teacher/interventionForms/HideInformationForm.tsx` を新規作成する。

```tsx
import { Button, List, ListItem, ListItemText, Stack, Typography } from '@mui/material'
import { MIN_TOUCH_TARGET } from '../../lessonInputs/lessonInputA11y'

export interface HideInformationFormProps {
  informationItems: Array<{ id: string; body: string }>
  hiddenInformationIds: string[]
  onSubmit: (detail: Record<string, unknown>) => void
}

/**
 * 情報の非表示化の専用フォーム。公開済みのニュースを一覧から選ばせるので、
 * 教師は情報IDを知る必要がない。非表示にしたものは同じ一覧から元に戻せる。
 */
export function HideInformationForm({ informationItems, hiddenInformationIds, onSubmit }: HideInformationFormProps) {
  if (informationItems.length === 0) {
    return <Typography variant="body2" color="text.secondary">まだ公開されたニュースがありません。</Typography>
  }

  return (
    <Stack spacing={1}>
      <Typography variant="body2" color="text.secondary">生徒に公開中のニュースを一時的に隠せます。</Typography>
      <List>
        {informationItems.map((item) => {
          const hidden = hiddenInformationIds.includes(item.id)
          return (
            <ListItem
              key={item.id}
              secondaryAction={
                <Button
                  variant="outlined"
                  sx={{ minHeight: MIN_TOUCH_TARGET }}
                  onClick={() => onSubmit({ informationId: item.id, hidden: !hidden })}
                >
                  {hidden ? `「${item.body}」を元に戻す` : `「${item.body}」を非表示にする`}
                </Button>
              }
            >
              <ListItemText primary={item.body} secondary={hidden ? '非表示中' : '公開中'} />
            </ListItem>
          )
        })}
      </List>
    </Stack>
  )
}
```

- [ ] **Step 6: `CorrectStateForm` を実装する**

`src/components/teacher/interventionForms/CorrectStateForm.tsx` を新規作成する。

```tsx
import { useState } from 'react'
import { Button, List, ListItemButton, ListItemText, Stack, TextField, Typography } from '@mui/material'
import { MIN_TOUCH_TARGET } from '../../lessonInputs/lessonInputA11y'

export interface CorrectStateFormProps {
  participants: Array<{ id: string; displayName: string }>
  teams: Array<{ teamId: string; displayName: string }>
  onSubmit: (detail: Record<string, unknown>) => void
}

type Target = 'PARTICIPANT_DISPLAY_NAME' | 'TEAM_DISPLAY_NAME'

/**
 * 状態の手動修正の専用フォーム。サーバの許可リスト
 * (interventions/correctState.ts の CORRECT_STATE_TARGETS) と同じ2種類だけを
 * 出す。対象パスの手入力は存在しない。
 */
export function CorrectStateForm({ participants, teams, onSubmit }: CorrectStateFormProps) {
  const [target, setTarget] = useState<Target | null>(null)
  const [targetId, setTargetId] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')

  if (!target) {
    return (
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">何を直しますか？</Typography>
        <Button variant="outlined" sx={{ minHeight: MIN_TOUCH_TARGET }} onClick={() => setTarget('PARTICIPANT_DISPLAY_NAME')}>生徒の表示名</Button>
        <Button variant="outlined" sx={{ minHeight: MIN_TOUCH_TARGET }} onClick={() => setTarget('TEAM_DISPLAY_NAME')}>チーム名</Button>
      </Stack>
    )
  }

  const options = target === 'PARTICIPANT_DISPLAY_NAME'
    ? participants.map((item) => ({ id: item.id, label: item.displayName }))
    : teams.map((item) => ({ id: item.teamId, label: item.displayName }))

  if (!targetId) {
    return (
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">どれを直しますか？</Typography>
        <List>
          {options.map((option) => (
            <ListItemButton
              key={option.id}
              sx={{ minHeight: MIN_TOUCH_TARGET }}
              onClick={() => { setTargetId(option.id); setDisplayName(option.label) }}
            >
              <ListItemText primary={option.label} />
            </ListItemButton>
          ))}
        </List>
        <Button variant="text" sx={{ minHeight: MIN_TOUCH_TARGET }} onClick={() => setTarget(null)}>戻る</Button>
      </Stack>
    )
  }

  return (
    <Stack spacing={1}>
      <TextField
        id="correct-state-display-name"
        label="新しい名前"
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
        helperText="1〜50文字"
      />
      <Button
        variant="contained"
        sx={{ minHeight: MIN_TOUCH_TARGET }}
        disabled={displayName.trim().length < 1 || displayName.trim().length > 50}
        onClick={() => onSubmit({ target, targetId, displayName: displayName.trim() })}
      >
        この名前に直す
      </Button>
      <Button variant="text" sx={{ minHeight: MIN_TOUCH_TARGET }} onClick={() => setTargetId(null)}>戻る</Button>
    </Stack>
  )
}
```

- [ ] **Step 7: テストを実行して緑を確認する**

Run: `npm test -- src/components/teacher/interventionForms`
Expected: PASS（11件）

- [ ] **Step 8: `InterventionPanel` に専用フォームを差し込む**

`src/components/teacher/InterventionPanel.tsx` の import に追加する。

```tsx
import { ExtendTimeForm } from './interventionForms/ExtendTimeForm'
import { DisplayModeForm } from './interventionForms/DisplayModeForm'
import { HideInformationForm } from './interventionForms/HideInformationForm'
import { CorrectStateForm } from './interventionForms/CorrectStateForm'
```

`InterventionPanelProps` に追加する。

```tsx
  currentPhaseId: string | null
  phaseHasTimer: boolean
  displayModeOverride: string | null
  informationItems: Array<{ id: string; body: string }>
  hiddenInformationIds: string[]
  participants: Array<{ id: string; displayName: string }>
  teams: Array<{ teamId: string; displayName: string }>
```

`INTERVENTION_CATALOG` の4エントリの `fields` を空配列にし、説明文を更新する。

```tsx
  EXTEND_TIME: {
    label: '時間を延ばす', description: 'いま進行中のフェーズの残り時間を延ばします',
    fields: [],
  },
  SWITCH_DISPLAY_MODE: {
    label: '教室表示の画面を切り替える', description: '教室に投影している画面を手動で切り替えます',
    fields: [],
  },
  CORRECT_STATE: {
    label: '名前を直す', description: '生徒の表示名やチーム名の打ち間違いを直します',
    fields: [],
  },
  HIDE_INFORMATION: {
    label: '情報を隠す', description: '公開済みのニュースを一時的に非表示にします',
    fields: [],
  },
```

選択後の描画部分、`{selectedEntry.fields.map(...)}` の直前に専用フォームの分岐を挿入する。

```tsx
            {selected === 'EXTEND_TIME' && (
              <ExtendTimeForm
                currentPhaseId={currentPhaseId}
                hasTimer={phaseHasTimer}
                onSubmit={(detail) => { onApply({ type: selected, reason, detail }); resetForm() }}
              />
            )}
            {selected === 'SWITCH_DISPLAY_MODE' && (
              <DisplayModeForm
                currentOverride={displayModeOverride}
                onSubmit={(detail) => { onApply({ type: selected, reason, detail }); resetForm() }}
              />
            )}
            {selected === 'HIDE_INFORMATION' && (
              <HideInformationForm
                informationItems={informationItems}
                hiddenInformationIds={hiddenInformationIds}
                onSubmit={(detail) => { onApply({ type: selected, reason, detail }); resetForm() }}
              />
            )}
            {selected === 'CORRECT_STATE' && (
              <CorrectStateForm
                participants={participants}
                teams={teams}
                onSubmit={(detail) => { onApply({ type: selected, reason, detail }); resetForm() }}
              />
            )}
```

`実行` ボタンと `fields.map` は、専用フォームを持たない5種のときだけ描画する。上記4種の分岐の外側を次で包む。

```tsx
            {selectedEntry.fields.length > 0 && (
              <>
                {selectedEntry.fields.map((field) => (
                  <TextField
                    key={field.key}
                    id={`intervention-detail-${field.key}`}
                    label={field.label}
                    value={detail[field.key] ?? ''}
                    onChange={(e) => setDetail((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  />
                ))}
                <Stack direction="row" spacing={1}>
                  <Button variant="contained" onClick={handleSubmit} sx={{ minHeight: MIN_TOUCH_TARGET }}>実行</Button>
                </Stack>
              </>
            )}
            <Button variant="text" onClick={resetForm} sx={{ minHeight: MIN_TOUCH_TARGET }}>戻る</Button>
```

`EMERGENCY_STOP` は `fields` が空だが専用フォームも持たないため、上記のままでは実行ボタンが出ない。`EMERGENCY_STOP` だけは専用の確認ボタンを出す分岐を追加する。

```tsx
            {selected === 'EMERGENCY_STOP' && (
              <Button
                variant="contained"
                color="error"
                sx={{ minHeight: MIN_TOUCH_TARGET }}
                onClick={handleSubmit}
              >
                授業を緊急停止する
              </Button>
            )}
```

- [ ] **Step 9: `LessonControlRoom` から新 props を渡す**

`LessonControlRoom.tsx` の `InterventionPanel` 描画を置き換える。

```tsx
      <InterventionPanel
        open={interventionOpen}
        onClose={() => setInterventionOpen(false)}
        role={role}
        currentPhaseId={publicState?.currentPhaseId ?? null}
        phaseHasTimer={publicState?.remainingPhaseSeconds != null}
        displayModeOverride={displayModeOverride}
        informationItems={(publicState?.researchDesk?.informationItems ?? []).map((item) => ({ id: item.id, body: item.body }))}
        hiddenInformationIds={hiddenInformationIds}
        participants={participants.map((p) => ({ id: p.id, displayName: p.displayName }))}
        teams={publicState?.teams ?? []}
        onApply={handleApplyIntervention}
      />
```

`displayModeOverride` と `hiddenInformationIds` は教師画面が直接購読していない。教室表示の実モード（`displayState?.mode`）と status 由来モードが食い違うかどうかからは判定できないため、この2つはローカル state として保持し、介入の適用時に楽観的に更新する。`LessonControlRoom` の state 宣言に追加する。

```tsx
  const [displayModeOverride, setDisplayModeOverride] = useState<string | null>(null)
  const [hiddenInformationIds, setHiddenInformationIds] = useState<string[]>([])
```

`handleApplyIntervention` の先頭に追加する。

```tsx
    if (input.type === 'SWITCH_DISPLAY_MODE') {
      setDisplayModeOverride((input.detail.displayMode as string | null) ?? null)
    }
    if (input.type === 'HIDE_INFORMATION') {
      const id = input.detail.informationId as string
      setHiddenInformationIds((prev) => input.detail.hidden === true
        ? (prev.includes(id) ? prev : [...prev, id])
        : prev.filter((item) => item !== id))
    }
```

`InformationPublicView` に見出し専用のフィールドは無い（`id` / `category` / `source` / `publishedAtMillis` / `natureType` / `confidenceLevel` / `targetCompanyIds` / `body`）。一覧の表示文字列には `body` を使う。

- [ ] **Step 10: `InterventionPanel.test.tsx` を新 props に合わせる**

既存の `render(<InterventionPanel ... />)` 呼び出しすべてに新規 props を追加する。

```tsx
  currentPhaseId="phase-market"
  phaseHasTimer
  displayModeOverride={null}
  informationItems={[]}
  hiddenInformationIds={[]}
  participants={[]}
  teams={[]}
```

- [ ] **Step 11: テストを実行して緑を確認する**

Run: `npm test -- src/components/teacher`
Expected: PASS

- [ ] **Step 12: コミット**

```bash
git add -A src/components/teacher
git commit -m "$(cat <<'EOF'
feat: give the four newly-working interventions purpose-built forms

The generic detail fields asked teachers for phaseId, slideId, informationId,
and targetPath, none of which a teacher can know. Each form now picks from
data the control room already subscribes to.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: 全体検証

**Files:**
- Modify: なし（不具合が出た場合のみ該当ファイル）

**Interfaces:**
- Consumes: Task 1-13 のすべて
- Produces: なし

- [ ] **Step 1: 「スライド」語が消えたことを確認する**

Run: `grep -rin "slide\|スライド" src functions/src --include="*.ts" --include="*.tsx"`
Expected: 出力なし（該当なしで終了コード1）

出力がある場合、その箇所を用語表に従って直してから次へ進む。

- [ ] **Step 2: 禁止フィールドが projection に漏れていないことを確認する**

Run: `npm test --workspace=functions -- src/lessonRuns/projections src/market`
Expected: PASS。特に既存の禁止情報 regression テストが緑であること。

- [ ] **Step 3: 全検証を実行する**

Run: `npm run verify`
Expected: lint・typecheck・テスト・Rules テスト・ビルドがすべて成功

失敗した場合は該当箇所を直し、この Step を再実行する。

- [ ] **Step 4: 仕様書のスコープ外項目が手つかずであることを確認する**

Run: `grep -n "PROXY_CONFIRM\|CHANGE_REPRESENTATIVE\|RECONNECT_PARTICIPANT\|RESTORE_PREVIOUS_PHASE" src/components/teacher/InterventionPanel.tsx`
Expected: この4種が `INTERVENTION_CATALOG` に汎用 `fields` を持ったまま残っていること（プロジェクトCで扱うため、本プロジェクトでは変更しない）。

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: verify classroom display wiring and intervention effects

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```
