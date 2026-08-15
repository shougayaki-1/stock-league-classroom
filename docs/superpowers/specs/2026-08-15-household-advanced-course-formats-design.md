# 家庭科モード発展形式（ROLE_VARIANT / STAGE_SPLIT / MULTI_PERSON_PER_TEAM）設計

**日付:** 2026-08-15  
**対象ブランチ:** `codex/classroom`  
**正本:** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md` §13.3  
**スコープ台帳:** `docs/superpowers/scope-backlog.md`

## 1. 目的とスコープ

Phase 4 家庭科モードで未対応として残る次の3形式を、既存 `COMMON_CONDITIONS` を壊さずに追加する。

- `ROLE_VARIANT`
- `STAGE_SPLIT`
- `MULTI_PERSON_PER_TEAM`

今回の対象は、開始前assignment、発展形式の生徒操作、同期一括決算、checkpoint/restore、教師ダッシュボード、最終クラス比較までとする。

対象外:

- 高度な分析グラフ・統計ダッシュボード
- 新しいLessonPhase
- 発表順・タイマー・段階的reveal
- 生徒間コメント
- participantごとの人物担当分離

## 2. 現行実装から維持する前提

現行家庭科runtimeは `HouseholdState` を `lessonRuns/{lessonRunId}/households/{householdId}` に保持し、意思決定・決算・冪等性も `householdId` 単位で処理する。`HouseholdState` には `teamId` があり、学生認可も保存済みteam ownershipから導出する。

一方、現在の `COMMON_CONDITIONS` は実質的に `householdId === teamId` を前提としている。生徒RTDBは `lessonRunTeamState/{lessonRunId}/{teamId}.household` の単数形で、bulk/checkpoint/teacher dashboardも「1 team = 1 household」前提である。

この設計では **household中心simulation engineを維持し、その手前にRun-scoped assignment層を追加する**。team中心runtimeへの全面移行は行わない。

## 3. 授業形式の意味

### 3.1 COMMON_CONDITIONS

既存挙動を維持する。

- 全チームが同一プロフィール条件を使う。
- 1 team = 1 runtime household。
- 既存runでは `householdId === teamId` を維持する。
- 現行の個別決算を維持する。
- RTDB `.household` 単数形を維持する。
- checkpoint v2を維持する。

内部コードはassignment abstractionを利用可能にするが、既存クライアント契約は変更しない。

### 3.2 ROLE_VARIANT

- 1 team = 1 runtime household。
- チームごとに担当プロフィールを変える。
- profile数 < team数なら、決定論的・均等にprofileを再利用する。
- profile数 > team数なら、未使用profileを許可して開始前WARNINGを出す。
- 同一profileを複数teamが担当してよい。
- PRIMARY教師は開始前のみ手動変更できる。

profileが1件しかなくても教材保存・公開・LessonRun開始は許可する。発展形式として差が生まれないことはWARNINGに留める。

### 3.3 STAGE_SPLIT

- 1 team = 1 runtime household。
- 各teamは教材内の1profileを担当する。
- profileの `lifeStage` を担当人生段階とする。
- 担当 `lifeStage` は授業中固定する。
- `roundIndex` は人生段階遷移ではなく、固定stage内の意思決定・決算サイクル数である。
- snapshot内に存在する **distinct `lifeStage`** は、LessonRun開始時に最低1teamずつ担当していなければならない。
- extra teamはstage別担当数が可能な限り均等になるよう重複配分する。

異なるlifeStageが1種類しかない教材も保存・公開できる。これはWARNINGのみ。開始時に要求するのは「教材に存在するdistinct stageのcoverage」であり、LifeStage enum上の全stageではない。

### 3.4 MULTI_PERSON_PER_TEAM

- 1 team = N runtime households。
- 全teamが **教材に設定された完全profile set** を担当する。
- 同じteamの全memberが、そのteamに属する全householdを共同操作する。
- participant -> profile の担当mappingは作らない。
- teamごとに人物を外す・差し替える操作は許可しない。
- PRIMARYが開始前に変更できるのは表示順など、完全setを壊さない範囲だけである。

profile 1件でも教材保存・公開は許可してWARNINGにするが、LessonRun開始時は **2件以上必須** とし、1件なら開始拒否する。

## 4. 採用アーキテクチャとID

Run-scoped Assignment Map + household中心runtimeを採用する。

```text
LessonVersion snapshot
  homeEconomics.households[]
        │
        │ profileId
        ▼
LessonRun assignment
  runtimeHouseholdId -> teamId + profileId
        │
        ▼
LessonRun HouseholdState
  householdId + teamId + profileId + simulation state
```

3つのIDを分離する。

- `profileId`: 教材上の人物。既存 `HouseholdProfile.householdId` を論理的にprofileIdとして扱う。authoring schema自体はリネームしない。
- `householdId`: LessonRun内のsimulation実体。
- `teamId`: 操作権限と教師UI上のグループ。

同じprofileを複数teamで利用してもruntime householdは別物である。

```text
team-1 -> h_1 -> profile-a
team-2 -> h_2 -> profile-a
```

MULTIでは:

```text
team-1
  h_1_a -> profile-a
  h_1_b -> profile-b
  h_1_c -> profile-c

team-2
  h_2_a -> profile-a
  h_2_b -> profile-b
  h_2_c -> profile-c
```

## 5. Assignmentデータモデル

### 5.1 Config

新規server-owned領域:

```text
lessonRuns/{lessonRunId}/householdAssignment/config
```

概念型:

```ts
interface HouseholdAssignmentConfig {
  courseFormat: CourseFormat
  state: 'DRAFT' | 'STALE' | 'FROZEN'
  validationStatus: 'READY' | 'INVALID'
  assignmentRevision: number
  teamSetFingerprint: string
  entryIds: string[]
  entriesDigest: string
  lastEditedByUid: string
  lastEditedAtServerMillis: number
  frozenByUid?: string
  frozenAtServerMillis?: number
}
```

`validationStatus` は教師UI用の保存値であり、開始可否の正本ではない。LessonRun開始時は現在のteam集合とentryを再取得して再検証する。

### 5.2 Entries

```text
lessonRuns/{lessonRunId}/householdAssignment/config/entries/{runtimeHouseholdId}
```

```ts
interface HouseholdAssignmentEntry {
  householdId: string
  teamId: string
  profileId: string
  slotKey: string
  displayOrder: number
  assignmentSource: 'AUTO' | 'MANUAL'
}
```

FROZEN後は `teamId` / `profileId` / `slotKey` を変更不可とする。

### 5.3 runtime householdId

クライアントに組み立てさせない。サーバーが `(lessonRunId, teamId, slotKey)` から安定したopaque IDを生成する。

概念slot:

```text
COMMON_CONDITIONS     PRIMARY
ROLE_VARIANT          PRIMARY
STAGE_SPLIT           PRIMARY
MULTI_PERSON_PER_TEAM PROFILE:{profileId}
```

ROLE/STAGEで開始前にprofileがAからBへ変わってもPRIMARY slotは変わらないため、runtime householdIdは安定する。

COMMONの既存runは互換上 `householdId = teamId` を認める。

### 5.4 assignmentRevision

次の変更で単調増加する。

- 初回自動生成
- entry内容を変えるmanual edit
- STALEからのreconciliationでentry set/contentが変わる場合
- MULTIのdisplay order変更

team変更で単に `state = STALE` と印を付けるだけではrevisionを上げなくてよい。reconciliation結果を保存した時点でrevisionを上げる。

## 6. HouseholdStateと既存COMMON互換

現行 `HouseholdState` にimmutableな `profileId: string` を追加する。

```ts
interface HouseholdState {
  householdId: string
  lessonRunId: string
  teamId: string
  profileId: string
  // existing simulation fields...
}
```

`processRound` はruntime `householdId` とtemplate profile IDを同一視せず、`HouseholdState.profileId` からsnapshot profileを解決する。

ただし、既存COMMON runのHouseholdStateやcheckpoint v2には `profileId` が存在しない可能性がある。**一括migrationは必須にしない。**

legacy COMMONだけは:

- `courseFormat === COMMON_CONDITIONS`
- snapshot profileがちょうど1件
- state.profileIdが欠落

のとき、その唯一profileを論理的 `profileId` として解決する。次にstateを書き戻す機会があればserver側でprofileIdをbackfillしてよい。

advanced形式で `profileId` が欠落しているstateはfail closedとする。checkpoint v2 restoreもlegacy COMMONのprofileId欠落を許容する。

## 7. Assignmentライフサイクル

```text
LessonRun作成
  ↓
team編成
  ↓
自動assignment生成
  ↓
DRAFT + READY/INVALID
  ↓
PRIMARYが確認・manual edit
  ↓
team増減
  ↓
STALE
  ↓
manual assignmentを可能な限り保持して再同期
  ↓
開始要求
  ↓
server再検証
  ↓
RUNNINGと同一transactionでFROZEN
```

権限:

- PRIMARY: 生成、再同期、手動変更、freeze。
- ASSISTANT: 閲覧のみ。
- VIEWER: 閲覧のみ。

編集途中の不整合は保存可能とする。例: STAGE_SPLITで一時的に退職期0teamでも保存できる。ただし `validationStatus = INVALID` と具体的warningを表示し、LessonRun開始時にハードブロックする。

## 8. DRAFT中のteam変更と再同期

team追加・削除でassignmentをSTALEにする。

再同期時:

- 既存teamかつprofileがまだ存在するmanual assignmentは保持。
- 削除teamのentryは除去。
- 新規teamは決定論的algorithmで補完。
- AUTO entryは必要に応じて再均衡。
- manual entryを教師の明示操作なしに上書きしない。

FROZEN後は新規team作成・team削除を拒否する。

late joinerは既存teamへ加入させる。既存teamへのmember追加はassignment変更ではない。MULTIではlate joinerも、そのteamの全assigned householdsを共同操作する。

## 9. 決定論的自動割り当て

安定順:

- teams: `teamId` 昇順。
- profiles: template snapshot配列順。

### ROLE_VARIANT

```text
team[i] -> profile[i % profileCount]
```

担当数差は最大1。profileCount > teamCountの余りはWARNINGのみ。

### STAGE_SPLIT

profilesをlifeStageごとに、template出現順を保ってgroup化する。

- team数 >= distinct stage数: まず各stageへ最低1team。その後extra teamをstage別担当数の差が最大1になるよう配る。
- 同stageに複数profile: stage担当teamへprofileをround-robin。
- team数 < distinct stage数: preview assignmentは作成可だがcoverage不足でINVALID、開始拒否。

### MULTI_PERSON_PER_TEAM

全team × 全profilesをtemplate順で作る。

```text
for each team:
  for each profile:
    slot = PROFILE:{profileId}
```

全teamで完全profile setが一致しなければ開始不可。

## 10. DRAFT中にsimulation stateを作らない

DRAFT assignmentのprofileは変更可能なので、この段階では原則HouseholdStateを作らない。

runtime stateはFROZEN assignmentからのみ初期化可能にする。

共通initializer（概念上 `ensureAssignedHouseholdState`）:

1. FROZEN assignment entry取得。
2. `profileId` をsnapshotから解決。
3. existing stateがあれば `state.teamId === assignment.teamId` と `state.profileId === assignment.profileId` を検証。
4. 未作成ならprofileのstarting cash / lifeStage等から冪等生成。
5. 不一致はデータ破損としてfail closed。

全householdが必要なbulk/checkpointはFROZEN entriesを列挙して全件ensureする。

## 11. LessonRun開始validationとatomic freeze

`targetStatus === RUNNING` を発展形式の最終ハードゲートとする。

開始transactionではwrite前に少なくとも:

1. transition idempotency
2. LessonRun
3. `meta/teamsIndex`
4. assignment config
5. config.entryIdsに含まれる全entry
6. 既存start validation依存データ

を読む。

形式別条件:

**ROLE_VARIANT**

- 全teamにちょうど1entry。
- 全profileIdがsnapshotに存在。
- profile重複利用可。
- unused profile可。

**STAGE_SPLIT**

- 全teamにちょうど1entry。
- 全profileIdがsnapshotに存在。
- snapshot内の全distinct lifeStageが最低1teamでcoverされる。

**MULTI_PERSON_PER_TEAM**

- snapshot profile数 >= 2。
- 全teamがsnapshotの完全profile setを持つ。
- 欠落・余分なprofileなし。

成功した場合だけ同じtransactionで:

```text
LessonRun.status = RUNNING
assignment.state = FROZEN
assignment.frozenByUid = PRIMARY uid
assignment.frozenAtServerMillis = now
householdRuntime/control = initial control
```

を確定する。RUNNING遷移とFROZENを別操作にしない。

## 12. team変更とのrace

team集合を変えるserver mutationは `meta/teamsIndex` とassignment stateを確認する。

- FROZEN前: team集合変更と同時にassignmentをSTALE化。
- FROZEN後: 新team作成・team削除を拒否。

RUNNING開始transactionも同じteamsIndexを読むため、同時team変更とはFirestore transaction contentionで直列化される。

## 13. Advanced synchronized runtime control

発展3形式用server-owned control:

```text
lessonRuns/{lessonRunId}/householdRuntime/control
```

```ts
interface HouseholdRuntimeControl {
  assignmentRevision: number
  synchronizedRoundIndex: number
  roundStatus: 'OPEN' | 'SETTLING'
  activeOperationId: string | null
  updatedAtServerMillis: number
}
```

FROZEN時:

```text
synchronizedRoundIndex = 0
roundStatus = OPEN
activeOperationId = null
```

これは個別stateの物理roundとは別の「クラスとして意思決定可能なround」である。COMMONの個別決算互換を維持するため、このbarrier強制は発展3形式だけに適用する。

## 14. 生徒decisionの同期とrace防止

advanced decision保存transaction:

1. runtime controlを読む。
2. HouseholdStateまたはFROZEN assignmentを読む。
3. decision idempotencyを読む。
4. `roundStatus === OPEN` 確認。
5. `household.roundIndex === synchronizedRoundIndex` 確認。
6. decisionを書き込む。

bulk開始側も同じcontrol docをtransactionで `OPEN -> SETTLING` に更新する。

これにより、bulkが提出状況を確認した直後にdecisionが差し替わるraceを防ぐ。`SETTLING` 中の新規提出・変更は拒否する。

## 15. 生徒のhousehold認可

client-supplied `teamId` / `profileId` を認可根拠にしない。

existing stateがある場合:

```text
request.auth
 -> HouseholdStateをhouseholdIdで取得
 -> state.teamId
 -> server-side team membership確認
```

state未作成の場合:

```text
request.auth
 -> FROZEN assignment entryをhouseholdIdで取得
 -> assignment.teamId
 -> team membership確認
 -> 認可成功後にstate ensure
```

他team householdIdを指定しても、保存済みowner fieldで拒否される。

MULTIではteam member全員が、そのteamの全assigned householdsを操作できる。

## 16. Advanced一括決算

発展3形式では通常の個別決算を禁止し、class-wide bulkだけでroundを進める。

`processRound` は単一household primitiveとして内部利用を維持するが、既存 `processRoundCallable` はadvanced courseFormatをserver-sideで拒否する。bulk orchestratorだけが内部primitiveを呼ぶ。

基本順序:

1. auth / PRIMARY確認。
2. LessonRun RUNNING確認。
3. FROZEN assignment確認。
4. assignmentRevision確認。
5. runtime control `OPEN` 確認。
6. unresolved operation確認。
7. FROZEN entriesを全件snapshot。
8. operation作成と `OPEN -> SETTLING` を整合させる。
9. 全runtime household ensure。
10. identity / expected round検証。
11. decision提出状況検証。
12. PRE_SETTLEMENT checkpoint。
13. household単位でprocessRound。
14. 全item成功時だけbarrier進行。

対象はteam IDsではなくruntime household IDsである。

## 17. Bulk operation / idempotency

operation itemはruntime household単位。

```ts
interface HouseholdBulkSettlementOperation {
  lessonRunId: string
  operationId: string
  actorUid: string
  assignmentRevision: number
  expectedRoundIndex: number
  restoreGeneration: number
  forceUnsubmitted: boolean
  items: Record<string, {
    householdId: string
    teamId: string
    profileId: string
    status: HouseholdBulkItemStatus
    errorCode?: string
    errorMessage?: string
  }>
}
```

operation作成後のretryではassignmentを再列挙せず、最初にsnapshotしたitemsを使う。

request digestに最低限含める:

- lessonRunId
- expectedRoundIndex
- assignmentRevision
- restoreGeneration
- forceUnsubmitted
- sorted runtimeHouseholdIds
- actorUid

同一idempotency keyを異なるassignment集合へ再利用できないようにする。

## 18. 未提出household

`forceUnsubmitted = false` では1件でも未提出ならbulk開始前に拒否する。

MULTIのteam提出完了は、そのteamの全assigned householdsが提出済みのときだけtrue。

`forceUnsubmitted = true` はPRIMARYの明示確認が必要で、未提出householdだけ `forceSettle` する。提出済みhouseholdのdecisionはそのまま利用する。

## 19. Partial failureとbarrier

一括決算全体を巨大transactionにはしない。household単位commitを維持する。

一時的に:

```text
h_a N+1 SUCCEEDED
h_b N+1 SUCCEEDED
h_c N   FAILED
```

が起こり得るが、この間:

```text
roundStatus = SETTLING
synchronizedRoundIndex = N
bulk = unresolved / FAILED
```

のままにする。

禁止:

- 次round decision
- decision更新
- 新規bulk
- advanced個別決算
- manual checkpoint

許可:

- unresolved bulk retry
- active lease失効後のcheckpoint restore

retryはSUCCEEDED itemを再settleしない。stateがすでに `expectedRoundIndex + 1` なら成功へ回収する。

全item成功時だけ、operation完了とcontrol更新を同一transactionで行う。

```text
operation = COMPLETED
roundStatus = OPEN
activeOperationId = null
synchronizedRoundIndex = N + 1
```

`householdsAligned` はadvancedではhealth indicatorとする。`SETTLING + misaligned` は既知の回復可能状態、`OPEN + misaligned` はACTION_REQUIREDな異常状態。

## 20. STAGE_SPLITのlifeStage不変条件

STAGE_SPLITではsettlement前後で:

```text
before.lifeStage === after.lifeStage
```

を不変条件としてtestで固定する。round経過で別stageへ進むモデルにはしない。

## 21. Checkpoint v3

COMMONの既存v2は維持する。

advanced用 `HouseholdCheckpointSnapshotV3`:

```ts
interface HouseholdCheckpointSnapshotV3 {
  schemaVersion: 3
  scope: 'ALL_HOUSEHOLDS'
  courseFormat: 'ROLE_VARIANT' | 'STAGE_SPLIT' | 'MULTI_PERSON_PER_TEAM'
  assignmentRevision: number
  expectedRoundIndex: number
  restoreGeneration: number
  householdIds: string[]
  households: HouseholdState[]
  teamViews: Record<string, {
    households: Record<string, HouseholdStateTeamView>
    householdOrder: string[]
  }>
}
```

v2の `teamId -> 単一HouseholdStateTeamView` ではMULTIで上書きされるため、v3ではteam内に複数householdを保持する。

checkpoint digestに `assignmentRevision / expectedRoundIndex / sorted householdIds / restoreGeneration` を含める。

## 22. Restore

現行の「Firestore stateを先にatomic restoreし、RTDBを後で同期し、projection失敗は再試行可能」というcrash-safe構造を維持する。

v3 restore:

- `checkpoint.assignmentRevision === current frozen assignmentRevision` 必須。
- 異なるrevisionは拒否。
- Firestore restore transactionで全HouseholdState、`restoreGeneration + 1`、`synchronizedRoundIndex = checkpoint.expectedRoundIndex`、`roundStatus = OPEN` を整合させる。
- restore後にteam別複数household RTDB projectionを再生成。
- restoreGeneration変更後は古いbulk retryを拒否。
- active lease中はrestore拒否。lease失効後のfailed operationからはrestore可能。

COMMON v2 restoreはlegacy profileId欠落を許容する。

## 23. Teacher dashboard projection

現行フラット `households[]` をteam-primaryへ一般化する。

```ts
interface HouseholdTeacherDashboard {
  lessonRunId: string
  subject: 'HOME_ECONOMICS'
  courseFormat: CourseFormat
  assignmentState: 'UNPREPARED' | 'DRAFT' | 'STALE' | 'FROZEN'
  assignmentRevision: number | null
  validationStatus: 'READY' | 'INVALID' | null
  synchronizedRoundIndex: number | null
  roundStatus: 'OPEN' | 'SETTLING' | null
  restoreGeneration: number
  teamCount: number
  householdCount: number
  submittedHouseholdCount: number
  teams: HouseholdTeacherTeam[]
  checkpoints: HouseholdCheckpointManifest[]
  activeBulkOperation: HouseholdBulkSettlementOperationView | null
  finalComparisonAvailable: boolean
}
```

teamは:

```ts
interface HouseholdTeacherTeam {
  teamId: string
  teamDisplayName: string
  submittedCount: number
  totalHouseholds: number
  allSubmitted: boolean
  warnings: HouseholdWarning[]
  households: HouseholdTeacherRow[]
}
```

各rowには `profileId` とteacher-safe profile summaryを追加する。

## 24. 教師UI

HOME_ECONOMICSなら全4形式で家庭科管理を表示し、現在の「COMMON以外は未対応」表示を廃止する。

```text
開始前      -> Assignment Panel
RUNNING     -> Household Teacher Dashboard
REFLECTION  -> Dashboard + Class Comparison
```

Assignment Panel状態:

- 未作成
- 要再確認（STALE）
- 開始可能（READY）
- 要修正（INVALID）
- 確定済み（FROZEN）

PRIMARYだけ編集controlを持つ。

ROLE:

- teamごとにprofile dropdown。
- 同profile重複可。
- unused profile warning。

STAGE:

- teamごとにprofile / lifeStage表示。
- stage coverage summary。
- coverage不足でも保存可、開始不可。

MULTI:

- 全team × 全profilesを表示。
- teamごとの人物削除・差し替え不可。
- display orderのみ変更可。
- profile < 2なら開始不可warning。

RUNNING後はassignmentをread-only表示する。

advanced進捗ではteam数とhousehold数を分ける。

```text
第3ラウンド
チーム提出完了 4 / 6
ケース提出 15 / 18
対象 6チーム / 18ケース
```

advancedには個別決算buttonを出さず、PRIMARYの「クラス全体を一括決算」だけを表示する。

partial failureでは成功/失敗件数と失敗team/profileを表示し、「未完了分を再試行」を出す。

## 25. 生徒RTDB projection

visibility classは変えない。

- `lessonRunPublic`: class-wide。
- `lessonRunTeamState/{runId}/{teamId}`: own team。
- `lessonRunPrivate`: teachers。
- `lessonRunDisplay`: projector。

COMMONは既存:

```text
lessonRunTeamState/{runId}/{teamId}
  household: HouseholdStateTeamView
```

advancedは複数形:

```text
lessonRunTeamState/{runId}/{teamId}
  orgId
  courseFormat
  synchronizedRoundIndex
  roundStatus
  households:
    {runtimeHouseholdId}:
      householdId
      profile
      state
      submittedRoundIndex
  householdOrder: string[]
```

`profile` は既存 `toHouseholdProfilePublicView` と同じ明示allow-listを使う。

学生へ出さない:

- `eventProbabilityOverrides`
- `internalRiskFactors`
- raw trigger probability
- internal claim probability
- randomSeed
- その他内部係数

## 26. 生徒UI

ROLE/STAGEは1team=1householdなので、現行表示を再利用しつつ担当ケース・担当人生段階を明示する。

MULTIはtabs/cardsでhouseholdを切り替える。

```text
人物1  人物2  人物3
```

新しいprofile displayName必須schemaは追加しない。`householdOrder` と安全なprofile情報から `人物1 / 35歳・子育て期` のようなlabelを構成する。

各人物の提出済み/未提出を表示する。`roundStatus === SETTLING` 中はread-onlyにし「先生が決算処理中です」と表示する。

submit時は選択中runtime `householdId` を送る。advancedで `householdId = teamId` を前提にしない。

## 27. Template validationとWARNING

既存構造ERRORは維持する。

- profile 0件 -> ERROR
- COMMONでprofile 2件以上 -> ERROR
- profile ID重複 -> ERROR
- assetType重複 -> ERROR
- evaluation weight不正 -> ERROR
- event probability不正 -> ERROR

発展形式の意味的最低条件は別のadvisory WARNINGとして扱う。

- ROLE profile 1件 -> WARNINGのみ。開始可。
- STAGE distinct lifeStage 1種類 -> WARNINGのみ。開始可。
- MULTI profile 1件 -> WARNING。publish可、開始不可。

既存 `validateHomeEconomicsContent()` のERROR契約を不必要に壊さず、概念上 `getHomeEconomicsContentWarnings()` のようなseparate advisory validationを追加する。

ROLEの「profile余り」はteam数が必要なのでLessonRun assignment previewで判定する。

## 28. Final class comparison

### 28.1 公開タイミング

`HomeEconomicsContent` には総ラウンド数がないため、通常bulk成功だけでは「最終bulk」をserverが判定できない。

「最終決算後に自動公開」は次の意味に固定する。

```text
最後のbulk COMPLETED
  ↓
全household aligned
  ↓
PRIMARYが RUNNING -> REFLECTION
  ↓
advanced precondition成功
  ↓
status transition commit
  ↓
final comparison snapshot生成
  ↓
全生徒へ自動公開・自動表示
```

別の「公開」buttonは設けない。

REFLECTION条件:

- assignment FROZEN。
- unresolved bulkなし。
- `roundStatus === OPEN`。
- 全state `roundIndex === synchronizedRoundIndex`。
- `synchronizedRoundIndex > 0`、つまり最低1回のbulk完全成功済み。

### 28.2 永続化と公開

Firestore server-owned正本:

```text
lessonRuns/{lessonRunId}/householdFinalComparison/result
```

同じsanitized dataを:

```text
lessonRunPublic/{lessonRunId}/householdClassComparison
```

へ投影する。

student public viewの基本値:

- team display name
- safe profile conditions
- final cash
- total assets
- total liabilities
- goal delayed rounds
- existing `computeLifeGoalAchievementScore()` によるgoal achievement score

含めない:

- student name
- UID
- participantId
- runtime householdId
- internal risk/probability/random coefficients

チームlabelは匿名化せず既存 `teamDisplayName` を使う。

### 28.3 比較軸

- ROLE_VARIANT: profile別に比較。
- STAGE_SPLIT: lifeStage別に比較。
- MULTI_PERSON_PER_TEAM: profileごとにteam結果を比較。

順位表を主目的にせず、条件と意思決定結果の違いを比較する授業画面とする。

### 28.4 生徒への自動表示

`LessonRun.status === REFLECTION` かつ `lessonRunPublic.householdClassComparison` が存在したら、HOME_ECONOMICS advanced student UIは比較画面を自動的に主表示へ切り替える。教師publish flagや生徒側の手動「公開を見る」操作を前提にしない。

### 28.5 公開失敗の回復

status transition commit前にRTDB公開しない。

REFLECTION commit後のFirestore comparison persistence / RTDB projectionは冪等にする。同じtransition idempotency keyのretry、またはteacher dashboard再取得時に、Firestore snapshotが存在してRTDBだけ欠けていれば再投影できる構造にする。

未公開/投影失敗は教師UIでACTION_REQUIREDとして表示し、simulation stateを変更せず再投影可能にする。

## 29. Projector

新しいLessonPhaseは追加しない。

`LessonRunDisplayMode` に:

```text
HOUSEHOLD_COMPARISON
```

を追加する。

REFLECTION中、教師が「教室画面に表示」を選ぶと、既にsanitizedされたfinal comparison snapshotだけをprojectorへ渡す。

## 30. Firestore / RTDB Security

新規server-owned領域はクライアント直接read/write不可。

```text
lessonRuns/{runId}/householdAssignment/...
lessonRuns/{runId}/householdRuntime/...
lessonRuns/{runId}/householdFinalComparison/...
lessonRuns/{runId}/households/...
```

学生・教師とも必要情報はCallableまたはRTDB projection経由。

Assignment mutation Callableの認可順序:

```text
request.auth確認
 -> LessonRun取得
 -> active org membership確認
 -> LessonRun role確認
 -> PRIMARY / CHANGE_SETTINGS相当確認
 -> LessonRun status確認
 -> assignment/team/profile依存read
 -> mutation
```

認可前にassignment詳細や他team情報を返さない。

assignment閲覧は `VIEW_PROGRESS` 相当としてPRIMARY / ASSISTANT / VIEWERへteacher projection経由で許可する。

RTDB visibility boundaryは既存のまま。class comparisonは `lessonRunPublic`、own-team householdsは `lessonRunTeamState`。

新しいcomparison producerは明示allow-listで構築し、internal object spread + deny-list除去は禁止する。

## 31. COMMON_CONDITIONS互換

既存COMMON runへの一括migrationを必須にしない。

persisted assignmentがないCOMMON runではresolverがimplicit assignmentを構築する。

```text
householdId = teamId
teamId      = teamId
profileId   = sole profile id
slotKey     = PRIMARY
```

維持する契約:

- RTDB `.household` 単数形。
- `householdId === teamId`。
- 個別決算。
- checkpoint v2。
- 既存bulk / restore。
- legacy state/checkpointのprofileId欠落をCOMMONだけ許容。

新assignment abstractionのために現行COMMON生徒UIを一括変更してはならない。

## 32. エラーと回復方針

- assignment INVALID: 編集可、開始不可。
- assignment STALE: 再同期・再確認が必要、開始不可。
- FROZEN identity mismatch: fail closed。
- advanced stateのprofileId欠落: fail closed。
- `SETTLING`: decision変更、新bulk、manual checkpoint拒否。
- bulk partial failure: unresolved operation保持、失敗itemだけretry。
- restoreGeneration mismatch: 古いbulk retry拒否。
- checkpoint assignmentRevision mismatch: restore拒否。
- `OPEN + households misaligned`: ACTION_REQUIRED。
- comparison RTDB publish failure: Firestore final snapshotから再投影。

## 33. 主要受け入れテスト

### ROLE_VARIANT

- profile < teamで決定論的・均等再利用。
- 同一team集合/snapshotならdefault assignmentが安定。
- profile > teamの余りはWARNINGのみ。
- PRIMARY manual変更が保存される。
- profile 1件でも開始可能。

### STAGE_SPLIT

- distinct stageを全coverできないassignmentは開始拒否。
- coverage不足をDRAFT保存可能。
- 修正後は開始可能。
- 複数round後もlifeStage不変。

### MULTI_PERSON_PER_TEAM

- profile 1件教材はpublish可、開始拒否。
- profile >= 2なら全teamが完全profile setを持つ。
- 同じprofileでもteamごとにruntime householdIdが異なる。
- team member全員が全assigned householdsを操作可能。

### STALE / FROZEN

- team追加/削除でSTALE。
- reconciliationで有効manual assignment保持。
- RUNNING遷移とFROZENがatomic。
- FROZEN後の新team作成/削除拒否。
- late joinerの既存team加入は可能。

### 認可

- 自teamの全assigned householdを操作可能。
- 他team householdId指定は拒否。
- client-supplied teamId/profileIdに依存しない。
- assignment mutationはPRIMARYのみ。
- ASSISTANT/VIEWERは閲覧のみ。

### Decision / settlement race

- OPEN中だけdecision保存可能。
- bulk開始との競合でdecisionが不定にならない。
- SETTLING中の提出/変更拒否。

### Bulk

- advancedで `processRoundCallable` 個別決算拒否。
- partial failureでbarrier不進行。
- retryはSUCCEEDED itemを再settleしない。
- 全item成功時だけoperation COMPLETED + synchronizedRoundIndex increment。
- MULTI team submissionはN/Nでのみcomplete。

### Checkpoint / restore

- MULTIの全runtime householdをv3保存。
- teamViewsで複数householdを上書きしない。
- v3 restore後にRTDB複数household projection復元。
- assignmentRevision mismatch拒否。
- restoreGeneration変更後の古いbulk retry拒否。
- COMMON v2 / legacy profileId欠落に回帰なし。

### Teacher UI

- ROLE/STAGEはteam -> 1 household。
- MULTIはteam -> N household。
- team x/y、class submission数が正しい。
- ASSISTANT/VIEWERにassignment変更controlなし。
- advancedに個別決算controlなし。
- partial failure対象team/profileを識別可能。

### Final comparison

- unresolved bulk中はREFLECTION不可。
- `synchronizedRoundIndex === 0` ではREFLECTION不可。
- 最後のbulk完了後、RUNNING -> REFLECTION成功時に自動生成。
- 全生徒端末へ自動公開・自動表示。
- team display name使用。
- student name / UID / participantId / runtime householdId / hidden coefficientなし。
- ROLEはprofile別、STAGEはlifeStage別、MULTIはprofileごとにteam比較。
- projectorも同じsanitized snapshotだけを利用。
- RTDB publish失敗後にFirestore snapshotから再投影可能。

### COMMON regression

- 現行student UIが `.household` を読める。
- `householdId === teamId` 維持。
- 個別決算維持。
- v2 checkpoint/restore維持。
- legacy stateでprofileIdが無くてもsole profileへ解決可能。
- 現行bulk regression testが通る。

## 34. 実装時の責務分割

implementation planでは、現行コードを再確認した上で少なくとも次を独立責務として分ける。

- assignment domain / repository / callable
- start transition integration
- assigned household initializer
- `HouseholdState.profileId` + legacy COMMON compatibility
- advanced submit authorization + synchronized runtime control
- bulk operation generalization
- checkpoint v3 + restore v3
- teacher dashboard projection generalization
- advanced RTDB projection
- student multi-household UI
- assignment teacher UI
- final comparison persistence/public projection/student auto-display
- projector comparison mode
- Firestore / RTDB rules
- template advisory warning
- regression / integration tests

具体的なファイル単位、function signature、TDD順序はimplementation planで固定する。

## 35. 不変条件

1. `profileId`, runtime `householdId`, `teamId` を混同しない。
2. student authorizationは保存済みownershipから導出し、client team claimを信頼しない。
3. DRAFT assignmentからsimulation stateを作らない。
4. RUNNING遷移とassignment FROZENをatomicにする。
5. FROZEN後にteam集合を変えない。late joinerは既存teamへ入れる。
6. advancedはclass-wide synchronized round barrierを持つ。
7. advancedの通常個別決算は禁止する。
8. partial failureでclass barrierを進めない。
9. retryはruntime household単位で冪等に行う。
10. STAGE_SPLITのlifeStageは授業中固定する。
11. MULTIは全teamが完全profile setを持つ。
12. checkpoint/restoreはassignmentRevisionとrestoreGenerationを検証する。
13. COMMONの既存RTDB/個別決算/checkpoint契約を壊さない。
14. legacy COMMONのprofileId欠落はsole profile fallbackで無移行互換とする。
15. student/public projectionは明示allow-listだけで生成する。
16. final comparisonはREFLECTIONへ正常遷移した後だけ全生徒へ自動公開・自動表示する。
17. 生徒氏名・UID・participantId・runtime householdId・内部係数をclass comparisonへ出さない。
