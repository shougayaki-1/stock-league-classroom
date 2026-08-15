# 家庭科・教師用授業運用ダッシュボード設計

- 作成日: 2026-08-15
- 対象: Phase 4 家庭科モードの教師UI拡充
- 正本: `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md`
- スコープ台帳: `docs/superpowers/scope-backlog.md`
- 対象ブランチ: `codex/classroom`

## 1. 目的

家庭科の授業実施中に、教師が `LessonControlRoom` から離れずに次を行えるようにする。

- 全家庭の現在状態と提出状況を把握する
- どの家庭に対応が必要か判断する
- 個別または全家庭のラウンド決算を行う
- 未提出家庭を含む強制決算を、明示的な確認付きで行う
- ラウンド決算前や任意時点の状態を保存する
- 保存済み状態へ安全に復元する
- 復元後も Firestore と生徒向け RTDB 投影を一致させる

統合仕様書 §2.2 の「教師には次にすることを最優先で表示する」、§13.18 の保存・再開を、この教師運用画面で具体化する。

## 2. 今回のスコープ

### 2.1 対象

今回の実装対象は `HOME_ECONOMICS` かつ `COMMON_CONDITIONS` の授業実施である。

教師画面では以下を扱う。

- 家庭/チーム一覧
- 現在ラウンド・人生段階
- 意思決定の提出済み/未提出
- 現金
- 資産総額・資産構成
- 借入残高・残期間
- 保険契約状況
- 直近決算の収入・支出・収支・資金不足
- 目標延期回数
- 公開済みイベント
- 決算状況
- 授業運用上の警告
- 個別決算
- 全家庭一括決算
- 未提出を含む明示的な強制決算
- 手動チェックポイント
- 一括決算前の自動チェックポイント
- 復元前の自動チェックポイント
- チェックポイント履歴と復元

### 2.2 対象外

以下は今回扱わない。

- `ROLE_VARIANT`
- `STAGE_SPLIT`
- `MULTI_PERSON_PER_TEAM`
- 家庭プロフィールや教材設定の編集
- 教材Builderの再設計
- 教師向け内部計算ログ閲覧UI
- `internalRiskFactors`
- 保険の `internalClaimProbability`
- 乱数シード
- 内部計算係数
- 家庭の良し悪しを自動判定する独自スコア
- 「資産配分が悪い」「保険が不適切」等の主観的な自動警告

発展形式は統合仕様書 §13.3 に存在するが、現行の家庭遅延初期化が安全に扱えるのは `COMMON_CONDITIONS` のみであるため、今回の教師ダッシュボードでは拡張しない。

## 3. 既存実装との関係

### 3.1 既存UI

- 教師の授業運用入口は `/teacher/lessons/:runId/control`
- `LessonControlRoom` が進行、参加者監視、介入、安全停止等を担う
- `HouseholdRoundControlPanel` は現在1家庭単位の最小限UIで、家庭列挙機能は持たない

今回、家庭科専用の別ルートは作らない。`LessonControlRoom` 内に家庭科専用セクションを統合する。

### 3.2 既存状態

Firestore の `lessonRuns/{lessonRunId}/households/{householdId}` が家庭の現在状態の正本である。

`lessonRunTeamState/{lessonRunId}/{teamId}` には、生徒と教師が読める安全な `HouseholdStateTeamView` が allow-list で投影される。

`lessonRunPrivate/{lessonRunId}` には教師専用の内部計算ログが存在するが、現在の RTDB Rules では組織 `owner` のみ読める。通常の授業運用ダッシュボードはこのノードへ依存しない。

### 3.3 既存決算

`processRoundCallable` は1家庭単位で次を行う。

- PRIMARY 権限確認
- LessonRun が RUNNING か確認
- 現在ラウンドの意思決定確認
- `forceSettle` がない場合、未提出なら拒否
- HouseholdState 更新
- `ROUND_SETTLED` イベント追記
- RTDB への再投影

今回、この単体処理を再利用しつつ、一括処理に必要な冪等性・部分失敗・再試行を上位オーケストレーターで管理する。

## 4. 画面構成

`LessonControlRoom` は LessonRun の subject が `HOME_ECONOMICS` の場合だけ `HouseholdTeacherDashboard` を表示する。社会科ではレンダリングしない。

`HOME_ECONOMICS` でも `COMMON_CONDITIONS` 以外の場合は、未対応形式であることを明示し、家庭科の操作ボタンを表示しない。

### 4.1 ラウンド状況

画面上部に教師が最初に確認すべき情報を表示する。

- 現在ラウンド
- 提出済み家庭数 / 全家庭数
- 決算済み家庭数 / 全家庭数
- 未提出件数
- 処理失敗件数
- 資金不足等の要対応件数
- 最終更新時刻
- 「最新状態に更新」

家庭間の `roundIndex` がずれている場合、単一の現在ラウンドは表示せず「家庭ごとに進行位置が異なる」と表示する。

### 4.2 次の操作

- 全家庭が同一 `roundIndex` かつ全提出済みの場合: 「全家庭を決算」
- 未提出が1件以上ある場合: 通常の一括決算は無効
- PRIMARY のみ: 「未提出を含めて強制決算」
- PRIMARY / ASSISTANT: 「現在の状態を保存」
- PRIMARY / ASSISTANT: チェックポイント復元
- VIEWER: 閲覧のみ

強制決算は、未提出家庭一覧を教師へ見せた後に確認ダイアログを出す。通常の一括決算から暗黙に `forceSettle` へ切り替えない。

### 4.3 家庭一覧

通常表示は授業中に走査しやすい表形式とする。

`チーム | ラウンド | 提出 | 決算 | 現金 | 資産 | 借入 | 警告`

行を展開すると次を表示する。

- 人生段階
- 資産構成
- 保険契約と残期間
- 借入残高と残期間
- 直近決算の収入
- 支出
- 収支
- 資金不足額
- 目標延期回数
- 公開済みイベント
- 個別決算結果

### 4.4 チェックポイント履歴

家庭科用の安全な全家庭チェックポイントだけを表示する。

- ラベル
- 種別: `MANUAL | PRE_SETTLEMENT | PRE_RESTORE`
- ラウンド
- 作成日時
- 作成者
- 「この状態へ復元」

復元確認画面では、対象ラウンドと「復元前の現在状態も自動保存される」ことを明示する。

## 5. 教師用読み取り境界

### 5.1 方針

`lessonRunPrivate` のクライアント読取権限を広げない。

教師ダッシュボード用に、新しい server-side Callable を正規の読み取り境界として追加する。

推奨名:

```ts
getHouseholdTeacherDashboardCallable
```

### 5.2 認可順序

必ず次の順で処理する。

1. auth確認
2. scalar入力検証
3. LessonRun取得
4. `teacherRoles` 確認
5. active org membership確認
6. 家庭・意思決定・イベント・チェックポイント取得

権限確認前に家庭データ、意思決定、イベント等を読まない。

### 5.3 ロール

- `VIEWER`: ダッシュボード閲覧
- `ASSISTANT`: 閲覧 + checkpoint 保存/復元
- `PRIMARY`: 閲覧 + checkpoint 保存/復元 + 個別/一括/強制決算

既存の `PROCESS_ROUND` と checkpoint 権限モデルを変更しない。

### 5.4 レスポンス

Callable は教師運用に必要な allow-list のみ返す。

概念上のレスポンス:

```ts
interface HouseholdTeacherDashboard {
  lessonRunId: string
  subject: 'HOME_ECONOMICS'
  courseFormat: 'COMMON_CONDITIONS'
  restoreGeneration: number
  currentRoundIndex: number | null
  householdsAligned: boolean
  updatedAtServerMillis: number
  households: HouseholdTeacherRow[]
  checkpoints: HouseholdCheckpointManifest[]
  activeBulkOperation: HouseholdBulkSettlementOperationView | null
}
```

`currentRoundIndex` は全家庭の `roundIndex` が一致する場合だけその値を返し、不一致なら `null` とする。

`HouseholdTeacherRow` には次を含める。

- householdId
- teamId
- teamDisplayName
- lifeStage
- roundIndex
- submittedForRoundIndex: 当該 row の `roundIndex` に対する提出有無
- submittedAtServerMillis または null
- lastSettledRoundIndex または null
- cashYen
- assetHoldingsYen
- totalAssetsYen
- activeInsuranceContracts
- activeLiabilities
- lastSettlementSummary または null
- goalDelayedRounds
- revealedEvents
- warnings

画面上の「決算済み」は `lastSettledRoundIndex` と row の `roundIndex` から導出する。部分失敗等で家庭ごとの `roundIndex` が分かれた場合でも、単一の `currentRound` を仮定しない。

`lastSettlementSummary` は `ROUND_SETTLED` の公開可能な payload から構成する。

- roundIndex
- incomeYen
- expensesYen
- netCashFlowYen
- shortfallYen
- insuranceBenefitsYen

`revealedEvents` は raw `occurredEventIds` をそのまま教師UIへ出さず、生徒へ公開済みの disclosure だけから構成する。

返してはならないもの:

- randomSeed
- internalRiskFactors
- internalClaimProbability
- private coefficients
- unrevealed future events
- private computation log 全体

## 6. 警告モデル

警告は観測可能な授業状態から決定的に生成する。

例:

- `ACTION_REQUIRED`: 現在ラウンド未提出
- `ACTION_REQUIRED`: 前回の一括処理失敗
- `WARNING`: 直近決算 `shortfallYen > 0`
- `WARNING`: `goalDelayedRounds > 0`
- `WARNING`: 明確な状態不整合、例: `cashYen < 0`
- `INFO`: 家庭間で `roundIndex` が不一致
- `INFO`: checkpoint restore 後

資産額だけで良否を判定しない。統合仕様書 §13.17 に従い、目標、安定性、分散、借入、保険適合、意思決定理由等は将来の観点別評価UIで扱う。

## 7. 一括決算

### 7.1 方針

クライアントから `processRoundCallable` を N 回直接呼ぶ方式を正規実装にしない。

server-side の一括決算オーケストレーターを追加する。

推奨名:

```ts
processHouseholdRoundBatchCallable
```

入力:

```ts
interface ProcessHouseholdRoundBatchRequest {
  lessonRunId: string
  expectedRoundIndex: number
  forceUnsubmitted: boolean
  idempotencyKey: string
}
```

クライアントから householdId 一覧、submitted 状態、reference state を受け取らない。対象家庭と提出状況はサーバー側で解決する。

### 7.2 前提確認

処理開始前に次を検証する。

1. auth
2. scalar validation
3. LessonRun exists
4. caller is PRIMARY
5. caller is active org member
6. LessonRun.status === `RUNNING`
7. subject === `HOME_ECONOMICS`
8. courseFormat === `COMMON_CONDITIONS`
9. 現在の全家庭が同一 roundIndex
10. その roundIndex === expectedRoundIndex
11. 同一 LessonRun に有効な lease を持つ競合 bulk operation がない

### 7.3 未初期化家庭

現行の家庭遅延初期化は生徒の意思決定導線に依存するため、一度も提出していない家庭には `HouseholdState` が存在しない場合がある。

一括オーケストレーターは認可後、LessonRun のサーバー側チーム一覧から対象家庭を決定し、`COMMON_CONDITIONS` の既存初期化規則を再利用して未作成状態を初期化する。

発展形式の割当ロジックは今回作らない。

### 7.4 通常決算

`forceUnsubmitted === false` の場合、未提出家庭が1件でもあれば mutation を開始しない。

レスポンスには未提出家庭の識別子を含め、教師UIが明示できるようにする。

### 7.5 強制決算

`forceUnsubmitted === true` は教師が専用確認操作を行った場合だけ送る。

未提出家庭では既存の `forceSettle` セマンティクスを利用する。提出済み家庭まで強制モードで別挙動にしない。

`ROUND_SETTLED` event には、その家庭が通常決算か強制決算かを監査できる boolean を追加する。推奨名は `forcedSettlement`。既存の actorUid と合わせ、誰が未提出を含めて進めたかを Firestore event で追跡可能にする。

## 8. 一括決算 Operation

一括決算は server-managed operation record を持つ。

推奨コレクション:

```text
lessonRuns/{lessonRunId}/householdBulkSettlementOperations/{operationId}
```

クライアントから直接 read/write させず、教師用 Callable で投影する。

概念スキーマ:

```ts
type HouseholdBulkOperationStatus = 'PENDING' | 'RUNNING' | 'FAILED' | 'COMPLETED'
type HouseholdBulkItemStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED'

interface HouseholdBulkSettlementOperation {
  operationId: string
  lessonRunId: string
  actorUid: string
  expectedRoundIndex: number
  restoreGeneration: number
  forceUnsubmitted: boolean
  status: HouseholdBulkOperationStatus
  preSettlementCheckpointId: string | null
  requestDigest: string
  attempt: number
  leaseExpiresAtServerMillis: number | null
  lastHeartbeatAtServerMillis: number | null
  households: Record<string, {
    status: HouseholdBulkItemStatus
    errorCode?: string
    errorMessage?: string
  }>
  createdAtServerMillis: number
  updatedAtServerMillis: number
}
```

同一 `idempotencyKey` + 同一 payload は同じ operation を返す。同じ key で payload が異なる場合は `failed-precondition`。

### 8.1 Lease と異常終了

Callable の途中終了、ネットワーク切断、Functions timeout 等で operation が永続的に `RUNNING` へ滞留しないよう lease を持つ。

- operation 実行開始時に lease を取得する
- 処理継続中は heartbeat を更新する
- lease 未失効の `RUNNING` operation は他の一括・個別決算と競合する
- lease が失効していれば、同一 operation の retry が lease を再取得して継続できる
- lease 失効だけを理由に成功済み item を再処理しない

別 idempotencyKey の新規 operation が、失効済みの古い operation を暗黙に横取りして新しいラウンド処理を開始してはならない。まず古い operation を retry/解消するか、既に current round が変化して継続不能なら明示的に失敗状態へ確定させる。

## 9. 一括決算の実行順序

1. 前提確認
2. operation の冪等性確認/作成
3. lease 取得
4. 未作成 HouseholdState の初期化
5. 全家庭の roundIndex と提出状況を再確認
6. 通常決算で未提出があれば mutation 前に拒否
7. `PRE_SETTLEMENT` 全家庭 checkpoint を1回だけ作成
8. 各家庭を決算
9. 家庭単位に `SUCCEEDED | FAILED` を保存
10. 全成功なら `COMPLETED`
11. 1件以上失敗なら `FAILED`

家庭はサーバー側で決定した安定した順序で処理し、各 item の結果を逐次 operation record へ保存する。プロセスが途中で終了しても、再試行時に最後に確定した item status から再開できるようにする。

部分失敗時、成功済み家庭を再処理しない。

再試行では `FAILED` または `PENDING` の家庭だけを対象にする。

再試行前に `restoreGeneration` と対象 round を再確認する。checkpoint restore 等で generation が変わっていた場合、古い operation は継続しない。

## 10. 個別決算と既存単体決算の安全化

### 10.1 Bulk operation との競合

通常の `processRoundCallable` は、同一 LessonRun に lease 未失効の bulk operation がある場合は `failed-precondition` とする。

この競合チェックは client-facing Callable 境界に置く。bulk orchestrator 自身は lease を保有した状態で内部 `processRoundWithAdminSdk` を呼ぶため、自分自身をブロックしない。

同様に、教師による手動 checkpoint と restore は bulk operation の有効 lease 中に開始しない。`PRE_SETTLEMENT` checkpoint だけは bulk orchestrator の内部処理として許可する。

### 10.2 Duplicate settlement の RTDB 再投影防止

現行 `commitRoundSettlement` は、同一 round が既に決算済みの場合に transaction 内で no-op する。しかし上位の `processRound` は commit が実際に行われたかを認識せず、その後に計算結果を RTDB へ publish する。

一括再試行の安全性のため、この契約を修正する。

概念上:

```ts
type CommitRoundSettlementResult =
  | { status: 'COMMITTED' }
  | { status: 'ALREADY_SETTLED' }
```

- `COMMITTED`: RTDB publish を行う
- `ALREADY_SETTLED`: 古い計算結果を publish しない

`ROUND_SETTLED` イベントの決定的 idempotency key と roundIndex compare-and-set は維持する。

## 11. Checkpoint v2

### 11.1 目的

既存 v1 は `HouseholdState[]` のみで、復元後の生徒向け RTDB 投影を同じ時点へ確実に戻せない。

新UIで作る家庭科 checkpoint は v2 とする。

```ts
interface HouseholdCheckpointSnapshotV2 {
  schemaVersion: 2
  scope: 'ALL_HOUSEHOLDS'
  kind: 'MANUAL' | 'PRE_SETTLEMENT' | 'PRE_RESTORE'
  label: string
  createdAtServerMillis: number
  createdByUid: string
  expectedRoundIndex: number | null
  householdIds: string[]
  households: HouseholdState[]
  teamViews: Record<string, HouseholdStateTeamView>
}
```

### 11.2 teamViews を保存する理由

`HouseholdStateTeamView` には、生徒へ既に公開されたイベント disclosure、visible concepts、shortfall options 等の安全な派生情報が含まれる。

復元時に現在の教材から再計算すると、当時の生徒表示と一致しない可能性がある。このため checkpoint 時点で公開済みだった safe projection を保存する。

`teamViews` は checkpoint 作成時に server-side で現在の `lessonRunTeamState` から対象チーム分を取得し、既存の safe shape として保存する。クライアントから投影値を受け取らない。

private calculation log は snapshot に含めない。

### 11.3 v1

既存 v1 checkpoint は削除しない。

ただし新しい教師UIでは、v2 かつ `scope === 'ALL_HOUSEHOLDS'` の checkpoint だけを通常の復元候補として表示する。

## 12. Checkpoint 作成

### 12.1 手動保存

PRIMARY / ASSISTANT が任意時点で全家庭を保存できる。

有効な bulk operation lease 中は手動保存を拒否する。部分決算中の状態を「授業全体の安全な復元点」として保存しないためである。

### 12.2 一括決算前

一括 operation ごとに1つだけ `PRE_SETTLEMENT` checkpoint を作る。

再試行で checkpoint が増殖しないよう、operation に紐づく決定的な idempotency key を使用する。

### 12.3 復元前

復元開始前に、現在状態を `PRE_RESTORE` checkpoint として自動保存する。

`PRE_RESTORE` の idempotency key は restore request の idempotency key から決定的に導出し、同一 restore retry で退避 checkpoint を増殖させない。

これにより、教師は復元後に「復元直前の状態」へ再度戻せる。

## 13. Checkpoint 復元

### 13.1 必須条件

- PRIMARY または ASSISTANT
- active org member
- v2
- `scope === 'ALL_HOUSEHOLDS'`
- 現在の全家庭と snapshot.householdIds が一致
- 同一 LessonRun に有効な lease を持つ bulk settlement がない

### 13.2 Firestore の原子性

現行家庭科 restore は、generic restore の transaction 後に別処理で HouseholdState を書き戻す。この分割では後半失敗時に `restoreGeneration` と event だけ進む可能性がある。

新しい家庭科 restore では、次を同一 Firestore transaction に含める。

- restore idempotency 確認
- LessonRun 再読込
- checkpoint 再読込
- restoreGeneration 増加
- 全 HouseholdState 書き戻し
- `CHECKPOINT_RESTORED` event 追記
- restore idempotency result 保存

全 read を write より前に行う。

家庭科 restore の idempotency record には少なくとも次を保持する。

```ts
interface HouseholdRestoreIdempotencyRecord {
  checkpointId: string
  requestDigest: string
  newRestoreGeneration: number
  eventId: string
  preRestoreCheckpointId: string
  projectionStatus: 'PENDING' | 'SYNCED'
}
```

### 13.3 RTDB 再投影

Firestore commit 後、snapshot に保存した `teamViews` を `lessonRunTeamState/{lessonRunId}/{teamId}` へ再投影する。

同時に、復元対象家庭の `lessonRunPrivate/{lessonRunId}/householdComputationLog/{householdId}` は削除する。private calculation log は checkpoint に保存しておらず、復元前の将来ラウンドのログを「現在の計算ログ」として残すと誤解を生むためである。新しい決算が行われれば通常の settlement publish により再生成される。

`lessonRunPublic` の economic factors は教材版に固定された授業共通設定であり、家庭 checkpoint 復元では変更しない。

RTDB と Firestore は同一 transaction にできないため、team projection の復元と stale private log の削除を1つの再試行可能な projection sync として扱う。

同一 restore request の再送では HouseholdState を再度巻き戻さない。

- 既に同一 restore が commit 済み
- 現在の `restoreGeneration` がその restore result と一致
- `projectionStatus === 'PENDING'`

の場合のみ、RTDB projection sync を再試行する。成功後に `projectionStatus = 'SYNCED'` とする。

その後さらに授業が進み generation が変化していた場合は `failed-precondition` とする。

## 14. データ整合性ルール

通常の一括決算は全家庭が同じ `roundIndex` であることを要求する。

家庭間の `roundIndex` がずれている場合:

- 一括決算を無効化
- ずれている家庭を教師へ表示
- 暗黙に遅れている家庭だけ進めない
- 暗黙に進んでいる家庭へ追いつかせない

教師が状況を確認した上で個別操作または checkpoint restore を選ぶ。

次の操作同士は同一 LessonRun 上で同時実行しない。

- bulk settlement
- individual settlement
- manual checkpoint
- checkpoint restore

bulk settlement の lease が排他の基準となる。個別決算・手動checkpoint・restore は client-facing Callable 側で active lease を検査する。

## 15. エラー処理

### 15.1 Dashboard

- 未認証: `unauthenticated`
- runへの教師権限なし: `permission-denied`
- inactive org member: 既存 `requireActiveOrgMember` の規約
- HOME_ECONOMICS でない: `failed-precondition`
- 非対応 courseFormat: `failed-precondition`

### 15.2 一括決算

- expectedRoundIndex 不一致: `failed-precondition`
- 家庭間 round 不一致: `failed-precondition`
- 通常決算で未提出あり: `failed-precondition` + safe details
- 同じ idempotency key で payload mismatch: `failed-precondition`
- restoreGeneration mismatch: `failed-precondition`
- 有効な競合 lease: `failed-precondition`

家庭単位の失敗は operation record に保持し、全操作を「成功」として隠さない。

### 15.3 Restore

Firestore commit 後の RTDB projection sync failure は `projectionStatus = 'PENDING'` として扱う。Firestore の restore 自体をもう一度実行しない。

## 16. セキュリティと監査

今回の機能のために次を行わない。

- `lessonRunPrivate` の read grant 拡大
- HouseholdState の student direct read
- decision subcollection の student direct read
- internal coefficient の teacher dashboard projection
- client-supplied household list の信頼
- client-supplied submitted/settled 状態の信頼

Firestore/RTDB Rules は既存の deny-by-default と server-write-only の境界を維持する。

新しい operation record も client direct read/write を許可しない。教師画面へ必要な operation view は dashboard Callable から返す。

監査可能性は次で確保する。

- settlement: `ROUND_SETTLED` event の actorUid + `forcedSettlement`
- restore: `CHECKPOINT_RESTORED` event
- checkpoint: snapshot の `createdByUid` と checkpoint の `createdBy`
- bulk operation: operation record の `actorUid`

監査情報は削除対象 HouseholdState の中だけへ置かない。

## 17. テスト戦略

### 17.1 Dashboard projection

- PRIMARY/ASSISTANT/VIEWER が読める
- run teacher でない利用者を拒否
- inactive org member を拒否
- HOME_ECONOMICS 以外を拒否
- COMMON_CONDITIONS 以外を拒否
- aligned の場合だけ currentRoundIndex を返す
- misaligned の場合 currentRoundIndex が null
- row ごとの submittedForRoundIndex が正しい
- lastSettledRoundIndex が正しい
- latest `ROUND_SETTLED` summary が正しく投影される
- revealedEvents が公開済み disclosure だけ
- `internalRiskFactors` を返さない
- `internalClaimProbability` を返さない
- randomSeed を返さない
- unrevealed future event を返さない

### 17.2 Bulk orchestration

- 全提出で全件成功
- 未提出ありの通常決算は mutation 前に拒否
- 強制決算で未提出家庭を処理
- forcedSettlement が event に記録される
- 未初期化家庭を初期化
- round mismatch を拒否
- households round misalignment を拒否
- same key/same payload replay
- same key/different payload 拒否
- 部分失敗を記録
- 成功済み家庭を再試行しない
- failed households のみ再試行
- restoreGeneration mismatch で古い再試行を拒否
- PRE_SETTLEMENT checkpoint が operation ごとに1回だけ
- active lease 中の競合 operation を拒否
- stale lease を同一 operation retry が再取得できる
- process interruption 後も item status から再開できる

### 17.3 Single-round settlement

- active bulk lease 中の client-facing 個別決算を拒否
- duplicate settlement が `ALREADY_SETTLED`
- `ALREADY_SETTLED` では RTDB publish しない
- `COMMITTED` のみ RTDB publish
- existing deterministic event idempotency を維持

### 17.4 Checkpoint v2

- MANUAL
- PRE_SETTLEMENT
- PRE_RESTORE
- createdByUid
- householdIds 完全性
- teamViews を server-side RTDB safe projection から保存
- private data 非保存
- v1 は新UIの通常復元候補に出さない
- active bulk lease 中の manual checkpoint を拒否
- 同一 restore retry で PRE_RESTORE が増殖しない

### 17.5 Restore

- PRE_RESTORE を先に保存
- Firestore の restoreGeneration + states + event + idempotency が原子的
- transaction failure で一部 household だけ戻らない
- RTDB teamViews 再投影
- stale householdComputationLog 削除
- RTDB projection sync failure 後の安全な再試行
- projectionStatus PENDING → SYNCED
- 同一 restore で HouseholdState を二重上書きしない
- restore 後に授業が進んだ古い retry を拒否
- bulk operation active lease 中の restore を拒否

### 17.6 React

- HOME_ECONOMICS のみ dashboard 表示
- COMMON_CONDITIONS 以外では未対応表示 + 操作非表示
- SOCIAL_STUDIES では非表示
- PRIMARY の操作
- ASSISTANT の checkpoint 操作
- VIEWER の read-only
- 未提出時の通常一括決算 disabled
- 強制決算確認
- 家庭行展開
- warning 表示
- round misalignment 表示
- 部分失敗結果
- retry UI
- checkpoint restore 確認

### 17.7 Rules/regression

- 新機能のために client read grant が拡大していない
- `lessonRunPrivate` の既存境界を維持
- student が他チーム HouseholdState を読めない
- operation record へ client direct read/write できない

## 18. 受け入れ条件

実装完了とみなす条件:

1. 教師は既存 Control Room から全家庭の授業状態を確認できる
2. 未提出家庭を明示せずに強制決算できない
3. 通常一括決算は全提出・同一 roundIndex のときだけ動く
4. 一括処理の部分失敗を安全に再試行できる
5. 再試行で成功済み家庭を二重決算しない
6. Functions 異常終了後も stale lease から同一 operation を安全に再開できる
7. 個別決算・checkpoint・restore が active bulk operation と競合しない
8. 一括決算直前に全家庭 checkpoint が自動保存される
9. 教師は任意時点で全家庭 checkpoint を保存できる
10. 復元前に現在状態が自動保存される
11. 復元は全家庭 Firestore 状態を原子的に戻す
12. 復元後、生徒向け RTDB household view も同じ時点へ戻る
13. 復元後、古い private household computation log が現状態として残らない
14. 通常教師UIへ内部リスク係数・内部保険確率・seed を露出しない
15. 強制決算は actor と forced flag を監査できる
16. 社会科 Control Room の既存挙動を壊さない
17. `COMMON_CONDITIONS` 以外を未対応のまま明示的に拒否する

## 19. 実装時の境界

設計書の次の implementation plan では、最低限以下を別タスク境界として扱う。

- Dashboard server projection
- Bulk settlement operation + idempotency + lease
- Single settlement duplicate-publish/competition fix
- Checkpoint v2 + creation helpers
- Atomic household restore + RTDB projection sync retry
- Client wrappers
- HouseholdTeacherDashboard UI
- LessonControlRoom integration
- Rules/regression/backlog verification

各サーバータスクは auth ordering、idempotency、partial failure、audit/event location を明示してテストする。

## 20. 今回の最終決定

- 授業運用ダッシュボードまでを今回の範囲とする
- 一括決算は「事前確認 + 明示的な強制決算」
- checkpoint は「決算前自動保存 + 手動保存 + 復元前自動保存」
- 教師画面は現在までに確定した授業運用情報のみ表示する
- `lessonRunPrivate` の内部計算ログを通常ダッシュボードへ出さない
- 家庭科画面は既存 `LessonControlRoom` へ統合する
- 読み取りは教師専用 safe Callable を正規境界とする
- 一括決算は server-side operation とし、lease で途中終了からの安全な再開を可能にする
- checkpoint restore は Firestore の全家庭状態を原子的に戻し、RTDB safe projection も再同期する
- 復元後は stale private household computation log を削除する
- 今回は `COMMON_CONDITIONS` のみ対応する
