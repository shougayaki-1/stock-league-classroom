# 教室表示の配線と介入4種の実効化 設計仕様

**日付:** 2026-08-19
**対象:** 教師UX改善プロジェクト群のうち第1弾（用語統一A + 未配線パイプラインの実装）
**正本:** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md`

## 背景

「アプリの操作方法が見えてこない」という利用者の指摘を起点に教師導線を調査した結果、UIの表現の問題だけでなく、**機能そのものが未配線である**ことが判明した。

### 発見1: `teacherGuidance` は「スライド」ではない

`src/components/display/ClassroomDisplayPage.tsx` は `teacherGuidance` を `LiveSlide` / `EndSlide` / `ExplanationSlide` の3モードすべてに渡している。実体は「教室表示に常時重ねて出せる、教師からの短文メッセージ」であり、枚数・順番・投影単位を持たない。UIラベル「説明スライドを編集」は、それらを持たないものに持つ名前を与えている。

### 発見2: 教室表示に「スライド」という概念が存在しない

`START` / `LIVE` / `END` / `EXPLANATION` / `HOUSEHOLD_COMPARISON` は `functions/src/lessonRuns/projections/displayProjection.ts` の `deriveDisplayMode` が `LessonRun.status` から導出するモードであり、教師がめくるものではない。「スライド」と呼ぶことで、利用者は存在しない操作（次へ／前へ／並べ替え）を探すことになる。

### 発見3: 9つの介入のうち4つは実効を持たない

`functions/src/lessonRuns/interventions.ts` の `GENERIC_STATE_TYPES` に属する `EXTEND_TIME` / `SWITCH_DISPLAY_SLIDE` / `CORRECT_STATE` / `HIDE_INFORMATION` には delegate（実処理）が無く、効果は監査イベント1件と `lessonRuns/{id}/teacherInterventionState/{type}` への記録だけである。同ファイルの JSDoc も「Phase C/D are expected to give these concrete meaning」と明記している。

結果として、「時間延長」を実行しても時間は延びず、「教室表示の切り替え」を実行しても表示は切り替わらず、「情報の非表示化」を実行しても情報は消えない。

### 発見4: 教室表示は教師がメッセージを保存した瞬間しか更新されない

`lessonRunDisplay/{lessonRunId}`（教室表示のデータ源）に本番で書き込むコードは次の2箇所のみである。

1. `functions/src/lessonRuns/projections/setTeacherGuidance.ts` の `setTeacherGuidanceWithAdminSdk`
2. `functions/src/homeEconomics/onCall.ts` の `showHouseholdComparisonOnDisplayCallable`

汎用の発行関数 `publishLessonProjectionWithAdminSdk` には本番呼び出し元が存在しない（`functions/src/lessonRuns/projections/publicProjection.ts` の JSDoc が「this function has no production caller wired up yet」と自認）。`transitionPhase` も research desk projection しか発行していない。

したがって現状は次の挙動になる。

- 授業を開始しても教室表示は「未接続」のまま
- 教師が「説明スライドを編集」を保存して初めて投影画面に何かが出る
- その瞬間の `status` で `mode` が固定され、フェーズが進んでも投影画面は古いまま

利用者が報告した「急にスライドの編集の話が始まる」の原因はこれである。当該ボタンは実際には教室表示を動かす唯一のスイッチだが、名前も説明もその役割を示していない。

### 発見5: フェーズの残り時間が動いていない

`currentPhaseEndsAtMillis` を書く本番コードが存在しない（読み出しは `publicProjection.ts` の `remainingPhaseSeconds` 算出のみ）。常に `null` となり残り時間は表示されない。「時間延長」に実効を与えるには、まず時間そのものを動かす必要がある。

## スコープ判断（ユーザー承認済み）

本プロジェクトは次を含む。

1. 教室表示 projection パイプラインの配線
2. フェーズ残り時間の実装
3. 実効を持たない介入4種すべての実装
4. 「スライド」語の全廃を含む用語の一本化

本プロジェクトは次を**含まない**。

- 残り5つの介入（`PROXY_CONFIRM` / `CHANGE_REPRESENTATIVE` / `RECONNECT_PARTICIPANT` / `RESTORE_PREVIOUS_PHASE` / `EMERGENCY_STOP`）のフォーム改善。これらは実効を持っており壊れていないため、ID手入力の解消は後続プロジェクトC「介入操作のシナリオ化」で扱う。
- 教材作成ウィザード、教材編集画面、ナビゲーションの改善（後続プロジェクトE / F / G）。

## 用語の確定

「スライド」という語をコードとUIの双方から全廃する。

| 現行 | 実体 | 確定後 |
| --- | --- | --- |
| 説明スライド（ボタン） | 全モードに重ねて出る教師の短文 | 教室表示のメッセージ |
| 説明スライド（`EXPLANATION` モード） | `status = REFLECTION` 時の画面 | 解説画面 |
| `StartSlide` / `LiveSlide` / `EndSlide` / `ExplanationSlide` | status から導出される表示状態 | 教室表示の画面（モード＝画面） |
| スライドID（介入の入力欄） | 切り替え先モード | 表示する画面（選択式） |
| 教室表示の切り替え（介入） | モードの手動上書き | 教室表示の画面を切り替える |

上位概念の語も固定する。

| 語 | 意味 | 使わない語 |
| --- | --- | --- |
| 教材 | 授業の設計図（`LessonTemplate`） | テンプレート |
| 版 | 発行済みで変更できない教材のスナップショット | バージョン、リビジョン |
| 授業 | 1回の実施（`LessonRun`） | 授業実施、ラン、セッション |
| 教室表示 | 投影用の画面（`/display/:runId`） | 表示、ディスプレイ、スライド |
| フェーズ | 授業内の区切り | ステップ、段階 |

識別子の改名は次の通り。監査イベントに残る旧文字列は読み出し側で互換を取る。

| 現行 | 改名後 |
| --- | --- |
| `SWITCH_DISPLAY_SLIDE` | `SWITCH_DISPLAY_MODE` |
| `detail.slideId` | `detail.displayMode` |
| `src/components/display/StartSlide.tsx` ほか3件 | `StartScreen.tsx` ほか（`*Slide` → `*Screen`） |
| `TeacherGuidanceDialog` | `ClassroomMessageDialog` |

`LessonRunDisplayMode` の enum 値（`START` / `LIVE` / `END` / `EXPLANATION` / `HOUSEHOLD_COMPARISON`）は「スライド」語を含まないため変更しない。日本語ラベルのみ改める。

## 設計

### 1. 教室表示 projection パイプラインの配線

**新規モジュール:** `functions/src/lessonRuns/projections/buildProjectionSource.ts`

`lessonRuns/{lessonRunId}` doc、`lessonRuns/{lessonRunId}/teams` サブコレクション、`templateSnapshot.phases` から `LessonRunProjectionSource` を組み立てる唯一の場所とする。

現在 `setTeacherGuidance.ts` がインラインで持つ簡易版（`title` を `templateSnapshot?.title` から取り、`publicAggregateLabel` を常に `null` にし、`goal` を常に `null` にする）を、この共通アセンブラに置き換えて一本化する。

`LessonRunProjectionSource` の禁止フィールド（`randomSeed` / `restoreGeneration` / `future`）はアセンブラが読み出してよいが、projection 関数が allow-list 方式で除外する既存の構造は変更しない。

**配線先:** `publishLessonProjectionWithAdminSdk` を次の各所から呼ぶ。

- `functions/src/lessonRuns/phases/transitionPhase.ts` — 既存の `deps.publishResearchDeskProjection` と同じフック位置（トランザクション完了後）に `deps.publishLessonProjection` を追加する。両者は同じ「トランザクション後の副作用」順序に従う。
- `functions/src/lessonRuns/recoveryLifecycle.ts` — `interruptLesson` / `resumeLesson` / `completeLesson` の各完了後。いずれも `status` を変えるため教室表示のモードが変わる。
- `functions/src/lessonRuns/joinLessonRun.ts` の参加成立時、および `functions/src/lessonRuns/teams/assignTeam.ts` の `assignParticipantToTeam` — いずれも `teams` の構成を変え、`teams` は教室表示に出るため。

いずれも既存の delegate 注入パターン（テストで差し替え可能なオプショナル依存）に合わせる。

**RTDB 書き込み方式:** `publishLessonProjectionWithAdminSdk` は `lessonRunPublic` へ `.update()`、`lessonRunDisplay` へ `.set()` を行う既存実装をそのまま使う。`lessonRunDisplay` への `.set()` は `showHouseholdComparisonOnDisplayCallable` が `.update()` で書いた `householdClassComparison` と `mode` を消し得る。この競合は `displayProjection.ts` の既存 JSDoc が「a subsequent phase-lifecycle/teacher-guidance publish reverts the projector back to the status-derived mode」として許容済みの挙動であり、本設計でも維持する（家庭科の比較表示は教師が明示的に出し直せる）。

### 2. フェーズ残り時間

`transitionPhase.ts` の `tx.set(runPath, { ...run, status, currentPhaseId, startedAt, endedAt })` に `currentPhaseEndsAtMillis` を追加する。

- 遷移先フェーズの `durationSeconds`（`templateSnapshot.phases` から `id` で引く）が正の数なら `now + durationSeconds * 1000`
- `durationSeconds` が無い（`SUBMISSION_BASED` 等）なら `null`

`now` はトランザクション外で一度読み、`deps.now` 経由で注入できるようにする（既存の `deps.now` 慣行に従う）。読み出し側（`remainingPhaseSeconds`）は既に実装済みのため、書き込みのみでカウントダウンが動く。

### 3. 介入4種の実効

#### 3-1. `EXTEND_TIME`

**detail:** `{ phaseId: string, additionalSeconds: number }`（現行キーを維持）

**サーバ:** `InterventionDelegates` に `extendPhaseTimer` を追加する。

```
extendPhaseTimer: (input: {
  lessonRunId: string
  phaseId: string
  additionalSeconds: number
  idempotencyKey: string
}) => Promise<unknown>
```

`lessonRuns/{id}` をトランザクションで読み、`currentPhaseId === phaseId` かつ `currentPhaseEndsAtMillis !== null` の場合にのみ `currentPhaseEndsAtMillis += additionalSeconds * 1000` を適用する。不一致時はエラーを投げる（既にフェーズが進んだ後の延長は意味を持たないため）。完了後に projection を再発行する。

`additionalSeconds` は正の数かつ上限 1800 秒（30分）とする。

**UI:** `phaseId` の手入力を廃止し、画面が購読している `publicState.currentPhaseId` を自動で使う。延長量は「+1分 / +3分 / +5分」のボタンで選ぶ。`currentPhaseEndsAtMillis` が `null` のフェーズでは操作自体を出さず、理由（「このフェーズには制限時間がありません」）を示す。

#### 3-2. `SWITCH_DISPLAY_MODE`

**detail:** `{ displayMode: LessonRunDisplayMode | null }`

**サーバ:** `LessonRun` に `displayModeOverride: LessonRunDisplayMode | null` を追加する。`toLessonRunDisplayState` の `mode` を次に変える。

```
mode: source.displayModeOverride ?? deriveDisplayMode(source.status)
```

`LessonRunProjectionSource` に `displayModeOverride` を追加する。この値は表示モードそのものであり、禁止フィールドには当たらない。

介入は `displayModeOverride` を書いたのち projection を再発行する。`displayMode: null` は override の解除を意味する。

`HOUSEHOLD_COMPARISON` は override 先として指定できるが、`householdClassComparison` データが無い状態で指定すると空の比較画面になる。`ClassroomDisplayPage` は既に `householdClassComparison` 不在時に `ExplanationSlide`（改名後 `ExplanationScreen`）へフォールバックする実装を持つため、追加対応は不要。

**UI:** 画面名のセレクト（開始待機 / 授業中 / 解説 / 終了 / クラス比較）と「自動に戻す」ボタン。現在 override が効いているかを状態として表示する。

#### 3-3. `HIDE_INFORMATION`

**detail:** `{ informationId: string, hidden: boolean }`

現行の detail は `informationId` のみだが、再表示できないと運用上詰むため `hidden` を追加する。`REQUIRED_DETAIL_KEYS` も更新する。

**サーバ:** `LessonRun` に `hiddenInformationIds: string[]` を追加する。介入は当該 ID を配列へ追加／除去し、research desk projection を再発行する。

`functions/src/market/researchDeskProjection.ts` の `buildResearchDeskPublicView` に `hiddenInformationIds` を渡し、既存の `publishedAtMillis <= nowMillis` フィルタに並べて除外する。

```
.filter((item) => item.publishedAtMillis <= input.nowMillis)
.filter((item) => !input.hiddenInformationIds.includes(item.id))
```

`economicIndicators` は対象外とする（介入名が「情報の非表示化」であり、ニュース項目を指すため）。

**UI:** 手入力を廃止し、公開済みニュースの一覧をチェックボックスで示す。非表示中の項目は一覧上で区別し、同じ操作で戻せるようにする。ニュース一覧は教師画面が `lessonRunPublic` の `researchDesk.informationItems` を購読して得る。

#### 3-4. `CORRECT_STATE`

任意パス書き込み（現行の `targetPath`）は廃止する。`randomSeed` / `future` / `restoreGeneration` といった §26-1 の禁止フィールドへ教師UIから到達できる経路を作らないため、許可リスト式に置き換える。

**detail:** `{ target: CorrectStateTarget, ... target固有のフィールド }`

```
type CorrectStateTarget = 'PARTICIPANT_DISPLAY_NAME' | 'TEAM_DISPLAY_NAME'
```

| `target` | 追加フィールド | 書き込み先 |
| --- | --- | --- |
| `PARTICIPANT_DISPLAY_NAME` | `participantId`, `displayName` | `lessonRuns/{id}/participants/{participantId}.displayName` |
| `TEAM_DISPLAY_NAME` | `teamId`, `displayName` | `lessonRuns/{id}/teams/{teamId}.displayName` |

この2つに限定する根拠は、(a) 他の8つの介入でも既存 Callable でも直せない、(b) 授業中に実際に起きる（打ち間違い）、(c) 禁止フィールドから構造的に遠い、の3点である。

参加者の所属チーム変更は既存の `assignParticipantToTeamCallable` があるため許可リストに含めず、既存機能へ委譲する。

`displayName` は 1〜50 文字、前後空白を除去して保存する。`TEAM_DISPLAY_NAME` の更新後は teams が教室表示に載るため projection を再発行する。

**UI:** 「何を直すか」の選択式（生徒の表示名 / チーム名）→ 対象の選択（一覧から）→ 新しい名前の入力。`targetPath` の手入力欄は無くなる。

### 4. クライアント側の変更

- `src/components/display/{Start,Live,End,Explanation}Slide.tsx` → `*Screen.tsx` へ改名（テストファイルも同時）
- `src/components/teacher/TeacherGuidanceDialog.tsx` → `ClassroomMessageDialog.tsx`。ダイアログ見出しを「教室表示のメッセージ」に、本文ラベルを「教室表示に出すメッセージ」に変更
- `LessonControlRoom.tsx` の `DISPLAY_MODE_LABEL` を新用語に更新（`EXPLANATION: '解説画面'` 等）
- `LessonControlRoom.tsx` の「説明スライドを編集」ボタンを「教室表示のメッセージ」に変更
- `InterventionPanel.tsx` の `INTERVENTION_CATALOG` を更新し、対象4種に専用フォームを実装する。残り5種は現行の汎用テキストフィールドのまま据え置く
- `src/lib/lessonRuns/interventions.ts` の `LessonInterventionType` から `SWITCH_DISPLAY_SLIDE` を除き `SWITCH_DISPLAY_MODE` を加える

### 5. 監査ログの互換

既存の `TEACHER_INTERVENTION_APPLIED` イベントには `interventionType: 'SWITCH_DISPLAY_SLIDE'` と `detail.slideId` が残り得る。

コードベースを確認した結果、`interventionType` を読む箇所は次の2つのみで、いずれも旧文字列の影響を受けない。

- `functions/src/lessonRuns/analytics/buildAnalytics.ts` — `PROXY_CONFIRM` / `RECONNECT_PARTICIPANT` のみを数える
- `functions/src/lessonRuns/results/buildResults.ts` — `interventionType` を読まず `reason` のみ読む

イベントログを表示するUIは存在しない。したがって**読み出し互換の写像は実装しない**（使われないコードを作らない）。過去イベントのマイグレーションも行わない（監査記録は不変であるべきため）。将来イベントログ閲覧UIを作る際に、その時点で必要な写像を実装する。

### 6. 検証

TDD で進め、各層に単体テストを置く。

- `buildProjectionSource` — doc / teams / phases から source を組む
- `toLessonRunDisplayState` — `displayModeOverride` の有無による `mode` の分岐
- `buildResearchDeskPublicView` — `hiddenInformationIds` によるニュース除外
- `transitionPhase` — `durationSeconds` 有／無での `currentPhaseEndsAtMillis`、および projection 発行の呼び出し
- `applyTeacherIntervention` — 4種それぞれの delegate 呼び出しと冪等性、`CORRECT_STATE` の許可リスト外 `target` の拒否、`EXTEND_TIME` のフェーズ不一致時の拒否
- `InterventionPanel` — 4種の専用フォームがID手入力を持たないこと、role によるフィルタが維持されること
- 禁止情報の regression テスト — `displayModeOverride` / `hiddenInformationIds` 追加後も projection が禁止フィールドを出さないこと

最後に `npm run verify`（lint・typecheck・テスト・Rules テスト・ビルド）を実行する。

## 未解決事項

なし。
