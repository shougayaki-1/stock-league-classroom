# 授業の準備画面 設計仕様

**日付:** 2026-08-20
**対象:** 教師UX改善プロジェクト群の第2弾（単位B: 教室表示の導線）
**正本:** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md`
**前段:** `docs/superpowers/specs/2026-08-19-classroom-display-wiring-and-interventions-design.md`

## 背景

第1弾で教室表示が授業の進行に自動追従するようになった。残る問題は「その画面の存在が教師に知らされず、開く導線もない」ことだったが、調査の結果、導線以前に**授業の開始経路そのものが未配線**であることが判明した。

### 発見1: 参加コードを発行する経路が存在しない

`functions/src/lessonRuns/joinCodes.ts` の `issueJoinCode` は実装・テスト・Admin SDK 配線 (`issueJoinCodeWithAdminSdk`) が揃っている。しかし Callable が無く（`functions/src/index.ts` に該当のエクスポートが無い）、UI からの呼び出しも無い。`createLessonRun` は参加コードを発行せず、戻り値 (`{ lessonRunId, created }`) にも含まない。

一方 `functions/src/lessonRuns/joinLessonRun.ts` は `lessonJoinCodes/{code}` を読む。誰も書かないドキュメントを読んでいる。生徒が `/join` でコードを入力しても、一致するコードは存在しない。

このギャップは `joinCodes.ts` 冒頭の JSDoc が「KNOWN GAP (Important #3, task-3-report.md)」として自認しており、必要な2つの後続作業（Callable の追加と、DRAFT から抜ける遷移の実装）を名指ししている。本設計はその2つを実施する。

### 発見2: `DRAFT → RUNNING` は不正な遷移であり、「授業を開始」は失敗する

`functions/src/lessonRuns/phases/stateMachine.ts` の `TRANSITIONS` は次の通り。

```
DRAFT:   ['READY']
READY:   ['WAITING']
WAITING: ['RUNNING', 'ABORTED']
```

`createLessonRun` は `status: 'DRAFT'` で作る。`src/App.tsx` の `TeacherControlRoute` の `onStartLesson` はいきなり `targetStatus: 'RUNNING'` を送るため、`Invalid status transition: DRAFT -> RUNNING` で失敗する。`DRAFT → READY` および `READY → WAITING` を起こす本番コードはどこにも存在しない。

つまり現状、授業は開始できず、生徒も参加できない。

### 発見3: 教室表示のURLを取得する経路が存在しない

`issueDisplaySessionTokenCallable` はサーバに存在し `index.ts` からエクスポートもされ、クライアント wrapper `src/lib/lessonRuns/displaySession.ts` の `issueDisplaySessionToken` もある。しかしこれを呼ぶ画面が無い。教師は投影URLを入手できない。

### 発見4: 投影画面のQRコードが描画されない

`src/App.tsx` の `DisplayRoute` は `ClassroomDisplayPage` に `joinUrl` / `joinCode` を渡していない。`StartScreen` はこの2つが無ければQRを描かない設計のため、開始画面は「① 先生の合図で参加コード（またはQRコード）を使って参加します」と指示しながら、コードもQRも表示しない。

### 発見5: 表示セッショントークンは1回限りで、リロードで壊れる

`exchangeDisplaySessionToken` は交換時に `status: 'USED'` を書く。`ClassroomDisplayPage` はマウントのたびに無条件で交換を試みるため、投影用ブラウザをリロードすると「既に使用済み」で表示できなくなる。50分の授業中に教室のPCが再起動した場合、復帰手段がない。

## スコープ判断（ユーザー承認済み）

本プロジェクトは「授業の準備」という1画面として、次を含む。

1. 参加コードの Callable 新設と、run ドキュメントへのコード保持
2. `DRAFT → READY → WAITING` を実際に進める導線
3. 参加コードを教室表示の projection に載せ、QRを実描画する
4. `/join` のクエリパラメータからのコード事前入力
5. 投影ブラウザのリロード耐性
6. 準備画面 `/teacher/lessons/:runId/prepare` の新設と導線の接続

本プロジェクトは次を**含まない**。

- 授業コントロール画面の状態表示改善（フェーズIDの人間可読化、次アクションの行き先明示）— 後続プロジェクトD
- 残り5種の介入のフォーム改善 — 後続プロジェクトC
- ナビゲーションへの「実施中の授業」追加、空状態、初回ガイド — 後続プロジェクトG

## 用語

第1弾の用語表（教材 / 版 / 授業 / 教室表示 / フェーズ）を引き継ぐ。本設計で追加する語は次の2つ。

| 語 | 意味 | 使わない語 |
| --- | --- | --- |
| 参加コード | 生徒が授業に入るための6文字のコード | 入室コード、ジョインコード、PIN |
| 表示用URL | 教室表示を開くための1回限りのURL | 投影URL、ディスプレイURL |

## 設計

### 1. 参加コードの Callable

**新規** `functions/src/lessonRuns/joinCodes/onCall.ts`

- `issueJoinCodeCallable` — `{ lessonRunId }` を受け、`{ code }` を返す
- `invalidateJoinCodeCallable` — `{ lessonRunId, code }` を受け、旧コードを失効させる

認可は `functions/src/lessonRuns/projections/onCall.ts` の `issueDisplaySessionTokenCallable` を踏襲する。すなわち、サインイン済み・教師アカウント・`lessonRuns/{id}.teacherRoles` が PRIMARY か ASSISTANT・`requireActiveOrgMember`。参加コードの発行は教室表示URLの発行と同じ「授業前の教室向け準備」であり、同じ権限段が適切である。

両 Callable を `functions/src/index.ts` からエクスポートする。

**クライアント wrapper** `src/lib/lessonRuns/joinCodes.ts` を新規作成し、`issueJoinCode` / `invalidateJoinCode` を薄いラッパとして置く（`displaySession.ts` と同じ形）。

### 2. 発行済みコードを run ドキュメントに持たせる

現在 `issueJoinCode` は `lessonJoinCodes/{code}` にしか書かない。コードがドキュメントIDになっているため、`lessonRunId` から現在有効なコードを引く手段が無い。発行レスポンスに含まれる平文は、その一度きりしかクライアントに存在しない。準備画面を開き直すとコードが分からなくなる。

そこで `issueJoinCode` のトランザクション内で `lessonRuns/{lessonRunId}` にも `joinCode` を書く。

参加コードは秘匿情報ではない。投影して生徒に読ませるために存在する値であり、`StartScreen` の `joinCode` prop の JSDoc も「参加コード自体は生徒に配布される前提の非秘匿情報」と明記している。平文で run に持たせることは既存の設計方針と矛盾しない。

トランザクションの read-before-write 規律は保たれる。`issueJoinCode` はループ内で `tx.get(lessonJoinCodes/{code})` を行い、衝突しなければその場で `tx.set` して即 `return` する。`lessonRuns/{id}` への `tx.set` を同じ成功枝に置くため、set のあとに get が走る経路は生じない。

`invalidateJoinCode` は `lessonJoinCodes/{code}.status` を失効させるが、`lessonRuns/{id}.joinCode` は**書き換えない**。準備画面の「作り直す」は失効と新規発行を続けて行い、新規発行側が `joinCode` を上書きする。失効だけを行って run 側を `null` にする経路は本設計では作らない（コードの無い授業という中間状態を増やさないため）。

### 3. 状態遷移を実際に動かす

サーバ側の新規実装は不要。準備画面が既存の `transitionPhaseCallable` を2回呼ぶ。

1. `targetStatus: 'READY'`（`DRAFT` から）
2. `targetStatus: 'WAITING'`（`READY` から）

`transitionPhase` は「`targetStatus` と `targetPhaseId` の同時指定は不可」「1回の呼び出しで1遷移」という制約を持つため、2回に分ける必要がある。それぞれ別の `idempotencyKey` を使う。

これにより `WAITING → RUNNING` が正当な遷移になり、`TeacherControlRoute` の既存の `onStartLesson`（`targetStatus: 'RUNNING'` → `targetPhaseId: 'intro'`）が初めて成功するようになる。`onStartLesson` 自体は変更しない。

`READY` と `WAITING` は教師にとって区別の意味が薄い（`joinLessonRun` はどちらでも参加を受け付ける）。準備画面は2段を1つのボタンでまとめて進め、教師には「授業の準備をする」という単一の操作として見せる。

### 4. 参加コードを教室表示に載せる

`LessonRunProjectionSource` に `joinCode: string | null` を追加し、`buildProjectionSource` が `lessonRuns/{id}.joinCode` から読む。`toLessonRunDisplayState` の allow-list に `joinCode` を追加する。

`LessonRunPublicState` には追加**しない**。参加コードは既に参加した生徒には不要であり、`lessonRunPublic` は参加者全員が読む共有ノードのため、必要のない値を置かない。

サーバ側 `functions/src/lessonRuns/projections/displayProjection.ts` の `LessonRunDisplayState` と、クライアント側 `src/lib/lessonRuns/liveTypes.ts` の同名型を手作業で同期する（既存の慣行どおり）。

`ClassroomDisplayPage` は受け取った `joinCode` と、そこから組み立てた `joinUrl`（`${window.location.origin}/join?code=${joinCode}`）を `StartScreen` に渡す。`joinCode` が `null` のときは両方とも渡さず、`StartScreen` は従来どおりQRを描かない。

クエリパラメータで `DisplayRoute` に渡す代替案は採らない。projection 経由なら、教師がコードを作り直したときに投影画面が自動で追従する。`lessonRunDisplay` は `displayRunId` クレームを持つセッションしか読めず、参加コードはそもそも投影して見せる値なので、allow-list への追加は §26-1 の趣旨に反しない。

### 5. `/join` のコード事前入力

`LessonJoinPage` は既に `initialJoinCode` プロパティを実装済み（`src/components/student/LessonJoinPage.tsx`）。`JoinRoute` がそれを渡していないだけである。`JoinRoute` に `useSearchParams` を足し、`searchParams.get('code')` を `initialJoinCode` として渡す。

### 6. 投影ブラウザのリロード耐性

`ClassroomDisplayPage` は現在マウント時に無条件で `signInForClassroomDisplay` を呼ぶ。これを次の順序に変える。

1. `auth.currentUser` が存在すれば `getIdTokenResult()` を取り、`claims.displayRunId === lessonRunId` なら交換をスキップして購読へ進む
2. そうでなければ従来どおりトークンを交換してサインインする

Firebase クライアント SDK のリフレッシュトークンが残っている限り、リロードしても表示が復帰する。トークンが失効している場合や別の run のクレームを持つ場合は従来の経路に落ちる。

この判定は `signInForClassroomDisplay` の中ではなく `ClassroomDisplayPage` 側に置く。前者は「トークンを交換してサインインする」という単一の責務を持つ純粋な手続きであり、呼ぶかどうかの判断は呼び出し側の関心事のため。

### 7. 準備画面 `/teacher/lessons/:runId/prepare`

**新規** `src/components/teacher/LessonPreparationPage.tsx`

状態によって見た目が変わる単一画面とする。

| status | 表示内容 |
| --- | --- |
| `DRAFT` | 「授業の準備をする」ボタン1つ。押すと ③の2遷移・参加コード発行・表示用URL発行をまとめて実行する |
| `READY` / `WAITING` | 参加コードの大表示、「教室表示を開く」（新しいタブ）、表示用URLのコピー、参加してきた生徒の一覧、「授業を開始」 |
| `RUNNING` 以降 | `/teacher/lessons/:runId/control` へリダイレクト |

**再発行の導線を2つ置く。**

- 「参加コードを作り直す」— `invalidateJoinCode`（旧コード）に続けて `issueJoinCode`。コードが他クラスに漏れた場合や、前の時間の板書が残っている場合に必要。
- 「教室表示のURLを再発行」— `issueDisplaySessionToken` をもう一度呼ぶ。授業中に教室のPCが落ちた場合に備え、**授業コントロール画面にも同じ操作を置く**。準備画面にしか無いと、授業が始まった後に復旧できない。

表示用URLは1回限りかつ2時間で失効するため、画面に貼り出して放置される値ではない。発行のたびに新しいURLを表示し、直前のURLは画面に残さない。

**参加者の一覧**は既存の `subscribeLessonParticipants`（Firestore 直読み）を使う。`ParticipantMonitor` はコントロール画面向けに切断・重複・チーム偏りまで扱う重い部品なので、準備画面では流用せず、名前と参加時刻だけの軽い一覧を新規に置く。準備段階で教師が知りたいのは「何人入ったか」だけである。

**status の取得**について。`lessonRunPublic` は `publishLessonProjection` が書くが、一度も遷移していない `DRAFT` の授業ではまだ空である。したがって準備画面は初期 status を Firestore の run ドキュメントから受け取り（`useTeacherLessonAccess` を拡張して `status` を返す）、以降は `subscribePublicRun` の値があればそちらを優先する。

### 8. 導線の接続

- `src/App.tsx` の `handleStartLesson`（教材編集画面から授業を作る箇所）の遷移先を `/teacher/lessons/${lessonRunId}/control` から `/teacher/lessons/${lessonRunId}/prepare` へ変更する
- `TeacherControlRoute` は status が `DRAFT` / `READY` / `WAITING` のとき `/prepare` へリダイレクトする。これにより、本設計より前に作られて `DRAFT` のまま残っている授業も準備画面へ導かれる
- `/teacher/lessons/:runId/prepare` を `TeacherShell` 配下のルートとして追加し、`navConfig.tsx` の `PAGE_TITLES` に「授業の準備」を追加する

### 9. 検証

TDD で進め、各層に単体テストを置く。

- `issueJoinCode` — `lessonRuns/{id}.joinCode` への書き込み、READY/WAITING 以外の status の拒否、衝突時の再試行
- `issueJoinCodeCallable` / `invalidateJoinCodeCallable` — 未サインイン・非教師・VIEWER ロールの拒否
- `buildProjectionSource` — `joinCode` の読み出しと不在時の `null`
- `toLessonRunDisplayState` — `joinCode` が出力に含まれること、および既存の禁止情報 regression が緑のままであること
- `ClassroomDisplayPage` — 既存クレームがあるとき交換を呼ばないこと、別 run のクレームでは交換すること、`joinCode` から `joinUrl` を組み立てて `StartScreen` に渡すこと
- `JoinRoute` — `?code=` を `initialJoinCode` として渡すこと
- `LessonPreparationPage` — status ごとの表示分岐、準備ボタンが2遷移と2発行を正しい順序で呼ぶこと、再発行の2導線、RUNNING でのリダイレクト
- `TeacherControlRoute` — DRAFT/READY/WAITING でのリダイレクト

最後に `npm run verify`（lint・typecheck・テスト・Rules テスト・ビルド）を実行する。

## 未解決事項

なし。
