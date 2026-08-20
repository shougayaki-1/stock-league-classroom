# 授業の状態表示を読めるようにする 設計仕様

**日付:** 2026-08-20
**対象:** 教師UX改善プロジェクト群の第3弾（単位D: 授業コントロールの状態表示）
**正本:** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md`
**前段:** `docs/superpowers/specs/2026-08-19-classroom-display-wiring-and-interventions-design.md` / `docs/superpowers/specs/2026-08-20-lesson-preparation-screen-design.md`

## 背景

第2弾で `DRAFT → READY → WAITING → RUNNING` が繋がり、教師が初めて授業コントロール画面に到達できるようになった。そこで教師が見るのは次の3つである。

- 現在のフェーズ: `market`（内部ID文字列そのもの）
- 次にすること: 「次のフェーズへ進む」（どこへ進むのか書かれていない）
- 残り時間: 表示なし

### 発見1: フェーズの日本語名はすでにコード内に存在する

`functions/src/lessonRuns/phases/defaultPhases.ts` の `buildDefaultPhases` は各フェーズに `displayConfig: { label: ... }` を持たせている（`導入` / `取引` / `意思決定` / `結果` / `振り返り`）。この graph は `createLessonRun` が `templateSnapshot.phases` として run ドキュメントに保存する。

つまり日本語名は最初から存在し、UI が参照していないだけである。`LessonControlRoom` が生の `currentPhaseId` を出しているのは、`LessonRunPublicState` に ID しか載っていないためである。

### 発見2: 投影画面もフェーズ名と残り時間を出していない

`src/components/display/LiveScreen.tsx` は `phaseName` と `remainingSeconds` を props で受け取れる。しかし `ClassroomDisplayPage` はどちらも渡していない。生徒側の投影画面にも「今どのフェーズか」「あと何分か」が出ない。同ファイルの JSDoc は理由を「現行projectionには未収録」と記している。

### 発見3: 残り時間は既定の授業では構造的に `null` になる

第1弾で `transitionPhase` が `currentPhaseEndsAtMillis` を書くようにしたが、`buildDefaultPhases` が作る4フェーズは**すべて `TEACHER_CONTROLLED` で `durationSeconds` を持たない**。したがって終了時刻は常に `null` になり、カウントダウンは表示されない。

さらに上流を追うと、ウィザードが収集する `lessonDurationMinutes`（授業時間・分）と `alwaysOnMarketMinutes`（市場を動かす分数）は、`buildDraftFromAnswers`（`src/lib/lessonTemplates/guidedBuilderPresets.ts`）で**一切参照されていない**。`LessonContent` にも該当フィールドが無い。教師が入力した時間はその場で捨てられている。

第1弾の実装は正しいが、それを活かすデータが上流に存在しない状態である。

### 発見4: フェーズの並びがクライアントに手写しされている

`src/App.tsx` に次の定義がある。

```ts
const defaultPhaseSequence = (subject) =>
  subject === 'HOME_ECONOMICS' ? ['intro', 'decision', 'result', 'reflection'] : ['intro', 'market', 'result', 'reflection']
```

サーバの phase graph をクライアントに複製した配列で、JSDoc 自身が placeholder と認めている。しかし `templateSnapshot.phases` は run ドキュメントに保存されており、教師クライアントはそれを読める（`useTeacherLessonAccess` が既に run ドキュメントを取得している）。手写しは不要である。

### 発見5: `remainingPhaseSeconds` は発行時点のスナップショットで、すぐ古くなる

`toLessonRunPublicState` は `remainingPhaseSeconds` を publish 時点の残り秒数として計算する。しかし publish は状態遷移のときにしか起きないため、フェーズの途中では値が固定されたまま古くなる。この形のままでは動くカウントダウンにならない。

同じ問題に対する正しい形は既にこのコードベースにある。`LessonRunPublicState.nextBatchAtMillis` は**サーバが書いた未来の時刻**であり、その JSDoc は「クライアントはこの時刻までのカウントダウンを描くだけで、自分でタイマーを進めてはならない」と定めている。

### 発見6: `TIMED` 進行は検証されるだけで、自動遷移は起きない

`progression: 'TIMED'` は `validation.ts` が「正の `durationSeconds` が必要」と検証するのみで、満了時にフェーズを進めるスケジューラはどこにも存在しない（`functions/src` のスケジュール関数は privacy purge / annual archive / market chain watchdog のみ）。フェーズを `TIMED` にすると、起きない自動進行を約束することになる。

## スコープ判断（ユーザー承認済み）

本プロジェクトは「今なにが起きていて、次になにが起きるか」を読めるようにすることに絞る。含むのは次の5点。

1. フェーズの日本語名を projection に載せ、教師画面と投影画面の双方に出す
2. 「次のフェーズへ進む」に行き先を明示し、クライアント側の手写し配列を撤去する
3. ウィザードの時間を `LessonContent` に保存し、中核フェーズの `durationSeconds` にする
4. `remainingPhaseSeconds` を `currentPhaseEndsAtMillis` に置き換え、カウントダウンを動かす
5. 投影画面にフェーズ名と残り時間を出す

本プロジェクトは次を**含まない**。

- 「未対応の問題」から対処操作への導線 — 後続プロジェクトCで扱う。現在の openIssues が挙げる3件（切断中・チーム人数の偏り・重複参加）のうち、対応する介入があるのは切断のみで、そのフォームはまだ参加者IDの手入力である。問題と対処を繋ぐには先にCが要る。
- 教材ごとのフェーズ編集UI（固定4フェーズの placeholder 解消そのもの）
- 作成ウィザードの説明性の改善 — 後続プロジェクトE。本プロジェクトはウィザードの既存の回答値を使うだけで、質問文や選択肢の表示は変更しない。

## 設計

### 1. フェーズを `TIMED` にはしない

既定フェーズの `progression` は `TEACHER_CONTROLLED` のまま据え置き、`durationSeconds` を「目安」として持たせる。

`validation.ts` は `durationSeconds` を progression によらず受け付け、合計時間の上限検証にのみ使う（`progression === 'TIMED'` のときだけ「必須」になる）。したがって `TEACHER_CONTROLLED` に `durationSeconds` を足しても検証は通る。

満了しても何も起きない。教師が手で進める運用は変わらず、配分の目安だけが教師と生徒の双方に見えるようになる。発見6のとおり `TIMED` にすると存在しない自動進行を約束することになるため、採らない。

### 2. 中核フェーズだけが時間を持つ

**`LessonContent` に `coreActivityMinutes?: number` を追加する。** 中核フェーズ（社会科は `market`、家庭科は `decision`）に充てる分数を表す、科目非依存の値とする。既存の教材はこの値を持たないため任意フィールドとする（詳細は本節末尾）。

`buildDraftFromAnswers` がウィザードの回答から埋める。

| 科目 | 値の出どころ |
| --- | --- |
| 社会科 | `answers.alwaysOnMarketMinutes` をそのまま使う。ウィザードが「市場を動かす分数」として明示的に聞いている値であり、中核フェーズの長さそのものである |
| 家庭科 | `answers.lessonDurationMinutes - NON_CORE_PHASE_ALLOWANCE_MINUTES`。家庭科のウィザードには中核フェーズの長さを直接聞く質問が無いため、授業時間から導入・結果・振り返りの分を引く |

`NON_CORE_PHASE_ALLOWANCE_MINUTES = 15`（導入・結果・振り返りに各5分）とする。これは暫定値であり、このリポジトリの既存の慣行（`PROVISIONAL_MAX_TOTAL_DURATION_SECONDS` と同じ扱い）に従って、試運転後に調整する前提の名前付き定数として置く。

結果が `MIN_CORE_ACTIVITY_MINUTES = 5` を下回る場合は 5 に切り上げる。教師が短い授業時間を入れても中核フェーズが 0 分や負にならないようにする。

**`buildDefaultPhases` のシグネチャを `(subject, coreActivityMinutes?)` に変える。** `coreActivityMinutes` が与えられたときだけ中核フェーズに `durationSeconds: coreActivityMinutes * 60` を設定する。他の3フェーズには設定しない。省略時は現行どおり全フェーズが `durationSeconds` を持たない（既存の run と既存テストが壊れない）。

`createLessonRun` は `templateSnapshot`（= `LessonContent`）の `coreActivityMinutes` を `buildDefaultPhases` に渡す。

既存の教材には `coreActivityMinutes` が無い。`LessonContent` では**任意フィールド**（`coreActivityMinutes?: number`）とし、無ければ従来どおり時間なしで動く。スキーマバージョンは上げない（既存ドキュメントの読み取りが壊れる変更ではないため）。

### 3. フェーズの日本語名を projection に載せる

`LessonRunProjectionSource` に `currentPhaseLabel: string | null` を追加し、`buildProjectionSource` が `templateSnapshot.phases` から現在フェーズを引いて `displayConfig.label` を読む。`displayConfig` が想定の形でない場合は `null` にする（`displayConfig` は `unknown` 型のため、実行時に形を確かめてから読む）。

`LessonRunPublicState` と `LessonRunDisplayState` の双方の allow-list に `currentPhaseLabel` を追加する。フェーズ名は生徒にも投影画面にも見せてよい情報であり、価格・係数・シードを何も含まない。

- 教師画面（`LessonControlRoom`）は既に `lessonRunPublic` を購読しているため、追加の取得なしにラベルを得る
- 投影画面（`ClassroomDisplayPage`）は `lessonRunDisplay` から得て `LiveScreen` の `phaseName` に渡す

`LessonControlRoom` の `phaseLabel` は `currentPhaseLabel ?? currentPhaseId ?? '未開始'` とする。ラベルが取れない古い run でも ID にフォールバックし、画面が空にならないようにする。

### 4. `remainingPhaseSeconds` を `currentPhaseEndsAtMillis` に置き換える

`LessonRunPublicState` の `remainingPhaseSeconds: number | null` を廃し、`currentPhaseEndsAtMillis: number | null` を載せる。`LessonRunDisplayState` にも同じフィールドを追加する。

理由は発見5のとおり。publish 時点の残り秒数は、次の publish まで固定されたまま古くなる。未来の時刻を渡してクライアントが毎秒描き直す形が正しく、`nextBatchAtMillis` が既にその形の前例である。

`source.ts` の `currentPhaseEndsAtMillis` の JSDoc（「Used only to derive a countdown — never exposed itself」）を書き換える。フェーズの終了時刻は未来の価格・係数・乱数シードを何も明かさないため、§26-1 の禁止対象には当たらない。同じ理由で `nextBatchAtMillis` が既に公開されている。

置き換えの影響は1箇所のみである。`LessonControlRoom.tsx` の `phaseHasTimer={publicState?.remainingPhaseSeconds != null}` を `currentPhaseEndsAtMillis != null` に変える。判定の意味は変わらない。

**新規** `src/components/teacher/PhaseCountdown.tsx` — 終了時刻を受け取り毎秒描き直す表示部品。教師画面と投影画面の双方で使う。

- `endsAtMillis` が `null` のときは何も描かない
- 残りが 0 以下になったら「時間終了」と表示し、負の数を出さない（フェーズは自動で進まないため、超過状態は正常に起こりうる）
- `setInterval` はアンマウント時に必ず解除する
- サーバの時刻をクライアントの時計と比較するため、端末の時計ずれの分だけ誤差が出る。授業運用上その精度で足りるため補正は行わない

### 5. 「次のフェーズへ進む」に行き先を出す

`src/App.tsx` の `defaultPhaseSequence`（手写し配列）を削除し、`useTeacherLessonAccess` が返す run ドキュメントの `templateSnapshot.phases` から次フェーズを解決する。

`useTeacherLessonAccess` の返り値に `phases: Array<{ id: string; label: string | null; nextPhaseIds: string[] }>` を追加する。`displayConfig.label` の読み取りは §3 と同じ判定を使うため、共有のヘルパー `src/lib/lessonRuns/phaseLabel.ts` に切り出して両方から使う。

`LessonControlRoom` の `advancePhaseLabel` を `次へ：{次フェーズのラベル}` の形にする。次フェーズが解決できない場合（`nextPhaseIds` が空、または未知のID）は、現行の「次のフェーズへ進む」にフォールバックする。最終フェーズ（`reflection`）では `nextPhaseIds` が空なので、そこでは次フェーズのCTAを出さない。

`onAdvancePhase` の遷移先も同じ解決結果を使う。現在は手写し配列の添字で次を決めており、教材が独自の `phases` を持つようになったときに無言で誤ったフェーズへ進む。graph を読めばその危険が消える。

### 6. 投影画面にフェーズ名と残り時間を出す

`ClassroomDisplayPage` の `LIVE` 分岐を次に変える。

```tsx
<LiveScreen
  title={title}
  phaseName={currentPhaseLabel ?? undefined}
  remainingSeconds={...}
  teams={teams}
  teacherGuidance={teacherGuidance}
/>
```

`LiveScreen` の `remainingSeconds?: number | null` を `endsAtMillis?: number | null` に変え、内部で `PhaseCountdown` を使う。現行は `Chip label={残り ${remainingSeconds} 秒}` を静的に描くだけで、値が更新されない。

`LiveScreen` の props 変更に伴い、同ファイルの「現行projectionには未収録」という JSDoc の但し書きを削除する。

### 7. 検証

TDD で進め、各層に単体テストを置く。

- `buildDraftFromAnswers` — 社会科は `alwaysOnMarketMinutes` を、家庭科は `lessonDurationMinutes - 15` を `coreActivityMinutes` にすること、下限 5 でのクランプ
- `buildDefaultPhases` — `coreActivityMinutes` 指定時に中核フェーズだけが `durationSeconds` を持つこと、省略時は全フェーズが持たないこと
- `createLessonRun` — `templateSnapshot.coreActivityMinutes` が phase graph に伝わること
- `phaseLabel.ts` — `displayConfig` が想定形のとき label を返し、想定外のとき `null` を返すこと
- `buildProjectionSource` — `currentPhaseLabel` の解決、フェーズ未設定時の `null`
- `toLessonRunPublicState` / `toLessonRunDisplayState` — `currentPhaseLabel` と `currentPhaseEndsAtMillis` が出力に含まれること、既存の禁止情報 regression が緑のままであること
- `PhaseCountdown` — 毎秒の再描画、`null` で何も描かないこと、0 以下で「時間終了」、アンマウントで `setInterval` が解除されること
- `LessonControlRoom` — ラベル表示と ID へのフォールバック、`次へ：結果` の CTA、最終フェーズで次フェーズCTAを出さないこと
- `ClassroomDisplayPage` — `LiveScreen` にフェーズ名と終了時刻を渡すこと
- `TeacherControlRoute` — `templateSnapshot.phases` から次フェーズを解決すること、手写し配列に依存しないこと

最後に `npm run verify`（lint・typecheck・テスト・Rules テスト・ビルド）を実行する。`npm test` と `npm run build` だけでは Rules 用 tsconfig（`test/` 配下を含む）の型チェックが走らず、projection の型にフィールドを足したときの追従漏れを取り逃がす。第2弾で実際に取り逃がしたため、必ず `verify` で確認する。

## 未解決事項

なし。
