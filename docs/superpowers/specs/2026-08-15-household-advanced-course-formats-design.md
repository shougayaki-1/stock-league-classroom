# 家庭科モード発展形式（ROLE_VARIANT / STAGE_SPLIT / MULTI_PERSON_PER_TEAM）設計

**日付:** 2026-08-15  
**対象ブランチ:** `codex/classroom`  
**正本:** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md` §13.3  
**スコープ台帳:** `docs/superpowers/scope-backlog.md`

## 1. 目的

Phase 4 家庭科モードで未対応として残っている次の3形式を、既存 `COMMON_CONDITIONS` を壊さずに実装可能な設計へ落とす。

- `ROLE_VARIANT`
- `STAGE_SPLIT`
- `MULTI_PERSON_PER_TEAM`

今回の対象は、開始前のケース割り当て、発展形式の生徒操作、同期一括決算、checkpoint/restore、教師ダッシュボード、最終クラス比較までとする。

発展形式向けの高度な分析グラフ、統計ダッシュボード、プレゼン順・タイマー、生徒間コメント、新しいLessonPhaseは対象外とする。

## 2. 現行実装から維持する前提

現行家庭科runtimeは `HouseholdState` を `lessonRuns/{lessonRunId}/households/{householdId}` に保持し、`HouseholdState` 自体に `teamId` がある。意思決定・決算・冪等性も `householdId` 単位で処理される。

一方、現在の `COMMON_CONDITIONS` は実質的に `householdId === teamId` を前提としている。生徒RTDBも `lessonRunTeamState/{lessonRunId}/{teamId}.household` の単数形で、bulk/checkpoint/teacher dashboardも「1 team = 1 household」を前提とする。

この設計では、既存の **household中心のsimulation engineを維持** し、その手前にRun-scoped assignment層を追加する。team中心の新runtimeへ全面移行は行わない。

## 3. 授業形式の意味

### 3.1 COMMON_CONDITIONS

既存挙動を維持する。

- 全チームが同じプロフィール条件を使う。
- 1 team = 1 runtime household。
- 既存runでは `householdId === teamId` を維持する。
- 既存の個別決算を維持する。
- 既存RTDBの `.household` 単数形を維持する。
- 既存checkpoint v2を維持する。

内部ではassignment abstractionを利用できるようにするが、外部契約は変更しない。

### 3.2 ROLE_VARIANT

- 1 team = 1 runtime household。
- チームごとに担当プロフィールを変える。
- プロフィール数 < チーム数の場合は、決定論的かつ均等にプロフィールを再利用する。
- プロフィール数 > チーム数の場合は、未使用プロフィールを許可し、開始前に警告する。
- 同じプロフィールを複数チームが担当してよい。
- 教師は開始前だけ手動変更できる。

プロフィールが1件しかなくても教材保存・公開・LessonRun開始は許可する。ただし発展形式として差が生まれないことをWARNING表示する。

### 3.3 STAGE_SPLIT

- 1 team = 1 runtime household。
- 各チームは教材内の1プロフィールを担当する。
- 各プロフィールの `lifeStage` を、そのチームの担当人生段階として扱う。
- 担当 `lifeStage` は授業中固定する。
- `roundIndex` は人生段階の遷移回数ではなく、その固定段階の中で繰り返す意思決定・決算サイクル数である。
- 教材に存在する **distinct `lifeStage`** は、LessonRun開始時に最低1チームずつ担当していなければならない。
- チーム数がdistinct lifeStage数を上回る場合は、段階ごとの担当チーム数が可能な限り均等になるよう重複割り当てする。

異なる `lifeStage` が1種類しかない教材も保存・公開できる。これはWARNINGに留める。LessonRun開始時に要求するのは「教材に存在する全distinct lifeStageがカバーされていること」であり、enum上の全lifeStageを要求しない。

### 3.4 MULTI_PERSON_PER_TEAM

- 1 team = N runtime households。
- 全チームが **教材に設定された完全なプロフィール集合** を担当する。
- 同じチームの全メンバーが、そのチームに属する全runtime householdを共同操作する。
- participantごとの担当人物分離はしない。
- 教師は人物セット自体をチームごとに減らしたり差し替えたりできない。
- 開始前の教師操作は自動生成、STALE再同期、表示順調整までとする。

プロフィール1件でも教材保存・公開は許可しWARNINGにするが、LessonRun開始時は **2件以上必須** とし、1件なら開始を拒否する。

## 4. 採用アーキテクチャ

Run-scoped Assignment Map + household中心runtimeを採用する。

```text
LessonTemplate / LessonVersion snapshot
  homeEconomics.households[]
        │
        │ profileId（既存 HouseholdProfile.householdId）
        ▼
LessonRun Assignment
  runtimeHouseholdId -> teamId + profileId
        │
        ▼
LessonRun HouseholdState
  householdId + teamId + profileId + simulation state
```

3つのIDの意味を分離する。

- `profileId`: 教材上の人物プロフィール識別子。既存 `HouseholdProfile.householdId` を論理的にprofileIdとして扱う。既存schemaはリネームしない。
- `householdId`: LessonRun内のsimulation実体。runtime household ID。
- `teamId`: 操作権限と教師画面上のグループ。

同じprofileを複数teamで利用しても、runtime householdは別物である。

```text
team-1 -> h_1 -> profile-a
team-2 -> h_2 -> profile-a
```

MULTIでは1teamに複数householdが属する。

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

### 5.1 Manifest

新規server-owned領域を設ける。

```text
lessonRuns/{lessonRunId}/householdAssignment/config
```

概念フィールド:

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

`validationStatus` は教師UIの高速表示用に保持してよいが、開始可否の正本にはしない。LessonRun開始時に現在のteam集合とassignment entryを再取得して再検証する。

### 5.2 Entries

```text
lessonRuns/{lessonRunId}/householdAssignment/config/entries/{runtimeHouseholdId}
```

概念フィールド:

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

runtime householdIdはクライアントに組み立てさせない。サーバーが `(lessonRunId, teamId, slotKey)` から安定して生成するopaque IDとする。

概念slot:

```text
COMMON_CONDITIONS     PRIMARY
ROLE_VARIANT          PRIMARY
STAGE_SPLIT           PRIMARY
MULTI_PERSON_PER_TEAM PROFILE:{profileId}
```

ROLE_VARIANT / STAGE_SPLITで開始前にprofileを変更しても、teamのPRIMARY slot自体は変わらないためruntime householdIdは安定する。

COMMON_CONDITIONSの既存runは互換上 `householdId = teamId` を認める。

### 5.4 HouseholdState

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

`processRound` は `input.householdId` とtemplate profile IDを同一視せず、`HouseholdState.profileId` から `templateSnapshot.homeEconomics.households` を解決する。

## 6. Assignmentライフサイクル

```text
LessonRun作成
  ↓
チーム編成
  ↓
自動assignment生成
  ↓
DRAFT + READY/INVALID
  ↓
PRIMARY教師が確認・手動編集
  ↓
チーム増減
  ↓
STALE
  ↓
既存manual assignmentを可能な限り保持して再同期
  ↓
開始要求
  ↓
サーバー再検証
  ↓
RUNNINGと同一transactionでFROZEN
```

### 6.1 編集権限

- PRIMARY: 自動生成、再同期、手動変更、開始時freeze。
- ASSISTANT: 閲覧のみ。
- VIEWER: 閲覧のみ。

### 6.2 編集中の不整合

編集途中の一時的不整合は保存可能とする。

例: STAGE_SPLITで一時的に「退職期」の担当が0になっても保存できる。

その場合は `validationStatus = INVALID` と具体的WARNINGを教師UIへ表示する。ハードブロックはLessonRun開始時だけ行う。

### 6.3 DRAFT中のteam変更

team追加・削除でassignmentをSTALEにする。

再同期時:

- 既存teamかつ参照profileがまだ存在するmanual assignmentは保持する。
- 削除teamのentryは除去する。
- 新規teamは決定論的アルゴリズムで補完する。
- 自動entryは必要に応じて再均衡する。
- manual entryを教師の明示操作なしに勝手に上書きしない。

### 6.4 RUNNING後

FROZEN後は新規team作成・team削除を拒否する。

途中参加者は既存teamへ加入させる。既存teamへのメンバー追加はassignmentを変更しない。

MULTIでは途中参加者も、そのteamに割り当て済みの全householdを共同操作できる。

## 7. 自動割り当てアルゴリズム

自動割り当ては決定論的でなければならない。同じteam集合・同じtemplate snapshot・manual overrideなしなら同じ結果を返す。

安定順:

- teams: `teamId` の昇順。
- profiles: template snapshot内の配列順を基本とする。

### 7.1 ROLE_VARIANT

profileが1件以上あることを前提に、sorted team indexをprofile配列へround-robin割り当てする。

```text
team[i] -> profile[i % profileCount]
```

これにより担当数差は最大1になる。

profileCount > teamCount の余りprofileはassignment previewにWARNINGとして出す。

### 7.2 STAGE_SPLIT

profilesを `lifeStage` ごとに、template出現順を保ってgroup化する。

- distinct stage数 <= team数なら、まず各stageへ最低1teamを配る。
- 残りteamはstage別担当数の差が最大1になるようround-robinで配る。
- 同一stage内に複数profileがある場合は、そのstage担当teamへprofileをround-robinする。
- team数 < distinct stage数の場合でもpreview assignmentは生成してよいが、coverage不足をINVALIDにし開始を拒否する。

### 7.3 MULTI_PERSON_PER_TEAM

各teamへ全profileをtemplate順で割り当てる。

```text
for each team:
  for each profile:
    create slot PROFILE:{profileId}
```

全teamでprofile setが完全一致しなければ開始不可である。

## 8. DRAFT中にHouseholdStateを作らない

DRAFT assignmentのprofileは変更可能なので、この段階では原則 `HouseholdState` を生成しない。

```text
profile-aでstate初期化
  ↓
教師がprofile-bへ変更
```

のようなorphan stateを防ぐためである。

runtime stateはFROZEN assignmentからだけ初期化可能とする。

共通initializer（概念上 `ensureAssignedHouseholdState`）は:

1. FROZEN assignment entryを取得する。
2. `profileId` をtemplate snapshotから解決する。
3. 既存stateがあれば `state.teamId === assignment.teamId` と `state.profileId === assignment.profileId` を検証する。
4. 未作成ならprofileのstarting cash / lifeStage等から冪等生成する。
5. 不一致はデータ破損としてfail closedにする。

全householdが必要なbulk/checkpointはFROZEN entriesを列挙して全件ensureする。

## 9. LessonRun開始時validationとatomic freeze

`targetStatus === RUNNING` を発展形式の最終ハードゲートとする。

開始transactionでは、write開始前に少なくとも以下を読む。

1. transition idempotency state
2. LessonRun
3. `meta/teamsIndex`
4. assignment config
5. config `entryIds` に含まれる全assignment entry
6. 既存start validationに必要な情報

形式別開始条件:

### ROLE_VARIANT

- 全teamにちょうど1entry。
- 全entryのprofileIdがsnapshot内に存在。
- profileの重複利用は可。
- unused profileは可。

### STAGE_SPLIT

- 全teamにちょうど1entry。
- 全entryのprofileIdがsnapshot内に存在。
- snapshot内に存在する全distinct lifeStageについて最低1teamが担当。

### MULTI_PERSON_PER_TEAM

- snapshot profile数 >= 2。
- 全teamがsnapshotの完全profile setを持つ。
- 余分なprofileや欠落profileは不可。

成功時だけ、同じtransactionで:

```text
LessonRun.status = RUNNING
assignment.state = FROZEN
assignment.frozenByUid = PRIMARY uid
assignment.frozenAtServerMillis = now
householdRuntime/control = initial control
```

を確定する。

RUNNING遷移とFROZENを別々の操作にしてTOCTOUを作らない。

## 10. Team変更との競合

team集合を変えるserver mutationは `meta/teamsIndex` とassignment stateを確認する。

- FROZEN前: team集合更新と同時にassignmentをSTALE化する。
- FROZEN後: 新規team作成・team削除を拒否する。

RUNNING開始transactionも同じ `meta/teamsIndex` を読むため、同時実行されたteam集合変更とはFirestore transaction contentionで直列化される。

既存teamへのmember追加はteam集合変更ではないためRUNNING後も許可する。

## 11. Advanced runtime同期control

発展3形式ではserver-owned controlを追加する。

```text
lessonRuns/{lessonRunId}/householdRuntime/control
```

概念型:

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

これは各HouseholdStateの物理的 `roundIndex` と別の「クラスとして意思決定を受け付けるround」を表す。

COMMON_CONDITIONSの個別決算互換を維持するため、この同期controlを強制するのは発展3形式だけとする。

## 12. 生徒decisionの同期とrace防止

advanced形式のdecision保存transactionでは:

1. runtime controlを読む。
2. HouseholdState（未作成なら認可後にensureできるassignment）を読む。
3. decision idempotency stateを読む。
4. `roundStatus === OPEN` を確認する。
5. `household.roundIndex === synchronizedRoundIndex` を確認する。
6. decisionを書く。

bulk開始側も同じcontrol docをtransactionで `OPEN -> SETTLING` に変更する。

これにより、bulkの提出確認後に生徒がdecisionを書き換え、決算が別decisionを読むraceを防ぐ。

`SETTLING` 中はdecision新規提出・変更を拒否する。

## 13. 生徒の操作認可

クライアントが送る `teamId` / `profileId` を認可根拠にしない。

既存stateがある場合:

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

他teamのruntime householdIdを指定しても、そのhousehold自身に保存されたteamIdで拒否される。

MULTIではteam member全員が、そのteamの全assigned householdsを操作できる。

## 14. Advanced一括決算

発展3形式では通常の個別決算UI/API利用を禁止し、クラス全体の一括決算だけでroundを進める。

`processRound` 自体は単一household処理primitiveとして内部利用を維持する。

一括決算の基本順序:

1. auth / PRIMARY権限確認
2. LessonRunがRUNNINGか確認
3. FROZEN assignment確認
4. assignmentRevision確認
5. runtime controlが `OPEN` か確認
6. unresolved bulk operation確認
7. FROZEN entriesを全件snapshot
8. runtime controlを `SETTLING` にしてoperation開始
9. 全runtime householdをensure
10. identity / expected roundを事前検証
11. decision提出状態を事前検証
12. PRE_SETTLEMENT checkpoint作成
13. household単位で `processRound` 実行
14. 全item成功時だけbarrierを進める

対象はteam IDsではなくruntime household IDsである。

MULTIで6team × 3profilesなら18householdがbulk targetになる。

## 15. Bulk operation model / idempotency

operation itemはruntime household単位にする。

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

operation作成後のretryではassignmentを再列挙せず、最初にsnapshotしたitemsを使用する。

request digestには最低限:

- lessonRunId
- expectedRoundIndex
- assignmentRevision
- restoreGeneration
- forceUnsubmitted
- sorted runtimeHouseholdIds
- actorUid

を含める。

同じidempotency keyを異なるassignment集合へ再利用できないようにする。

## 16. 未提出household

`forceUnsubmitted = false` では、1件でも未提出householdがあれば決算開始前に拒否する。

MULTIのteam提出完了は、そのteamの全assigned householdsが提出済みの場合だけtrueとする。

`forceUnsubmitted = true` はPRIMARYの明示確認が必要で、未提出householdだけを `forceSettle` する。提出済みhouseholdのdecisionはそのまま利用する。

## 17. Partial failureと同期barrier

一括決算全体を巨大な1transactionにはしない。household単位のcommitを維持する。

そのため一時的に:

```text
h_a round N+1 SUCCEEDED
h_b round N+1 SUCCEEDED
h_c round N   FAILED
```

が起こり得る。

この間:

```text
runtime control.roundStatus = SETTLING
runtime control.synchronizedRoundIndex = N
bulk operation = unresolved / FAILED
```

とする。

禁止操作:

- 次round decision
- decision更新
- 新規bulk
- advanced個別決算
- manual checkpoint

許可操作:

- unresolved bulkのretry
- active leaseが切れた後のcheckpoint restore

retryは `SUCCEEDED` itemを再settleしない。stateがすでに `expectedRoundIndex + 1` ならSUCCEEDEDへ回収する。

全item成功時だけ、operation完了とruntime control更新を同一transactionで行う。

```text
operation = COMPLETED
roundStatus = OPEN
activeOperationId = null
synchronizedRoundIndex = N + 1
```

`householdsAligned` はadvancedではhealth indicatorとし、`SETTLING + misaligned` は既知の回復可能状態、`OPEN + misaligned` はACTION_REQUIREDな異常状態とする。

## 18. STAGE_SPLITのlifeStage不変条件

STAGE_SPLITではsettlement前後で `HouseholdState.lifeStage` が変わってはならない。

```text
before.lifeStage === after.lifeStage
```

をengine / integration testで固定する。

人生段階の比較はチーム間で行い、同一householdがround経過で別stageへ進むモデルにはしない。

## 19. Checkpoint v3

COMMONの既存v2 checkpointはそのまま維持する。

advanced形式用に `HouseholdCheckpointSnapshotV3` を追加する。

概念型:

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

現行v2の `teamId -> 単一HouseholdStateTeamView` ではMULTIで上書きされるため、v3ではteam内に複数householdを保持する。

checkpoint digestには最低限:

- assignmentRevision
- expectedRoundIndex
- sorted householdIds
- restoreGeneration

を含める。

## 20. Restore

現行の「Firestore stateを先にatomic restoreし、RTDB projectionを後から同期し、projection失敗は再試行可能」というcrash-safe構造を維持する。

advanced v3 restoreでは:

- `checkpoint.assignmentRevision === current frozen assignmentRevision` を必須にする。
- 異なるassignment revisionのcheckpointはrestore拒否。
- Firestore restore transactionで全HouseholdState、`restoreGeneration + 1`、`synchronizedRoundIndex = checkpoint.expectedRoundIndex`、`roundStatus = OPEN` を整合させる。
- restore後にteam別複数household RTDB projectionを再生成する。
- restoreGenerationが変わった後は古いbulk operation retryを拒否する。

active lease中のrestoreは拒否する。lease失効後のfailed operationからはrestoreできる。

## 21. Teacher dashboard projection

現行のフラット `households[]` をteam-primary構造へ一般化する。

概念型:

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

team projection:

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

各HouseholdTeacherRowには `profileId` と安全なprofile summaryを追加する。

## 22. 教師UI

### 22.1 LessonControlRoom

HOME_ECONOMICSなら全4形式で家庭科管理を表示する。現在の「COMMON以外は未対応」Alertは廃止する。

```text
開始前      -> Assignment Panel
RUNNING     -> Household Teacher Dashboard
REFLECTION  -> Dashboard + Class Comparison
```

### 22.2 Assignment Panel

状態:

- 未作成
- 要再確認（STALE）
- 開始可能（READY）
- 要修正（INVALID）
- 確定済み（FROZEN）

PRIMARYだけに編集controlを表示する。

ROLE_VARIANT:

- teamごとにprofile dropdown。
- 同じprofileの重複選択可。
- unused profile warning。

STAGE_SPLIT:

- teamごとにprofile / lifeStage表示。
- lifeStage coverage summary表示。
- coverage不足でも保存可、開始不可。

MULTI_PERSON_PER_TEAM:

- 全team × 全profilesであることを表示。
- teamごとのprofile削除・差し替え不可。
- display order調整のみ可。
- profile < 2なら開始不可警告。

### 22.3 RUNNING後

assignmentはread-onlyで表示し続ける。教師は授業中も担当条件を確認できる。

### 22.4 進捗

advancedではチーム数とhousehold数を分ける。

例:

```text
第3ラウンド
チーム提出完了 4 / 6
ケース提出 15 / 18
対象 6チーム / 18ケース
```

### 22.5 一括決算

advancedではPRIMARYだけに「クラス全体を一括決算」を表示する。

各householdの個別決算buttonは出さない。

未提出がある場合は通常決算buttonをdisabledにし、PRIMARYが明示確認したときだけforce settlementを実行する。

### 22.6 Partial failure

成功件数・失敗件数と、失敗したteam/profileを表示する。

PRIMARYに「未完了分を再試行」を表示する。

## 23. 生徒RTDB projection

visibility class自体は変更しない。

- `lessonRunPublic`: クラス全員向け。
- `lessonRunTeamState/{runId}/{teamId}`: 自チーム向け。
- `lessonRunPrivate`: 教師向け。
- `lessonRunDisplay`: projector向け。

### 23.1 COMMON_CONDITIONS

既存契約を維持する。

```text
lessonRunTeamState/{runId}/{teamId}
  household: HouseholdStateTeamView
```

### 23.2 Advanced

複数形projectionを追加する。

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

`profile` は既存 `toHouseholdProfilePublicView` と同じserver-side allow-listだけを使用する。

禁止:

- `eventProbabilityOverrides`
- `internalRiskFactors`
- raw trigger probability
- internal claim probability
- randomSeed
- その他内部係数

## 24. 生徒UI

ROLE_VARIANT / STAGE_SPLITは1team=1householdなので、現行household表示を再利用し、担当ケース・担当人生段階を明示する。

MULTIではtabs/cardsでhouseholdを切り替える。

```text
人物1  人物2  人物3
```

教材schemaに新しい表示名必須fieldは追加しない。`householdOrder` と安全なprofile情報から `人物1 / 35歳・子育て期` のようなUI labelを構成する。

各人物ごとに提出済み/未提出を表示する。

`roundStatus === SETTLING` 中は入力をread-onlyにして「先生が決算処理中です」と表示する。

submit時は選択中のruntime `householdId` を送る。`householdId = teamId` をadvancedで前提にしない。

## 25. Template validationとWARNING

既存の構造的ERRORは維持する。

- profile 0件 -> ERROR
- COMMONでprofile 2件以上 -> ERROR
- profile ID重複 -> ERROR
- assetType重複 -> ERROR
- evaluation weight不正 -> ERROR
- event probability不正 -> ERROR

発展形式の意味的最低条件はadvisory WARNINGとして別API/関数で扱う。

- ROLE_VARIANT profile 1件 -> WARNINGのみ。
- STAGE_SPLIT distinct lifeStage 1種類 -> WARNINGのみ。
- MULTI profile 1件 -> WARNING。publish可能だがLessonRun開始不可。

既存 `validateHomeEconomicsContent()` のERROR契約を不必要に変更せず、概念上 `getHomeEconomicsContentWarnings()` のようなseparate advisory validationを追加する。

## 26. Final class comparison

### 26.1 公開タイミング

`HomeEconomicsContent` には総ラウンド数がないため、通常のbulk成功だけでは「最終bulk」をserverが判定できない。

そのため「最終決算後に自動公開」は次の意味に固定する。

```text
最後のbulk COMPLETED
  ↓
全household aligned
  ↓
PRIMARYが RUNNING -> REFLECTION
  ↓
subject-specific precondition成功
  ↓
status transition commit
  ↓
final comparison snapshot生成
  ↓
全生徒へ自動公開
```

新しい「公開」buttonは設けない。

advanced形式でREFLECTIONへ進む条件:

- assignment FROZEN。
- unresolved bulkなし。
- runtime control `roundStatus === OPEN`。
- 全state `roundIndex === synchronizedRoundIndex`。
- `synchronizedRoundIndex > 0`、つまり最低1回のbulkが完全成功済み。

満たさなければREFLECTION transitionを拒否する。

### 26.2 永続化

RTDBだけを正本にしない。

```text
lessonRuns/{lessonRunId}/householdFinalComparison/result
```

にserver-owned sanitized snapshotを保存し、同じsafe dataを:

```text
lessonRunPublic/{lessonRunId}/householdClassComparison
```

へ投影する。

概念フィールド:

```ts
interface HouseholdClassComparisonPublicView {
  courseFormat: 'ROLE_VARIANT' | 'STAGE_SPLIT' | 'MULTI_PERSON_PER_TEAM'
  finalRoundCount: number
  publishedAtMillis: number
  teams: Array<{
    teamDisplayName: string
    households: Array<{
      profile: HouseholdProfilePublicView
      result: {
        cashYen: number
        assetHoldingsTotalYen: number
        liabilitiesTotalYen: number
        goalDelayedRounds: number
        lifeGoalAchievementScore: number
      }
    }>
  }>
}
```

runtime householdIdはclass-wide comparisonに含めない。

チームlabelは匿名化せず既存 `teamDisplayName` を使う。

禁止:

- 生徒氏名
- UID
- participantId
- runtime householdId
- hidden risk / probability / random data

目標達成は比較専用の新式を作らず、既存 `computeLifeGoalAchievementScore()` を使う。

### 26.3 公開の失敗回復

status transitionのFirestore commit前にRTDBを公開しない。

REFLECTION commit後のcomparison persistence / RTDB projectionは冪等にする。同じtransition idempotency keyのretryやdashboard再取得時に、Firestore snapshotが存在してRTDB projectionだけ欠けていれば再投影できる構造にする。

教師UIでは未公開/投影失敗をACTION_REQUIREDとして表示し、状態を壊さず再投影可能にする。

## 27. Projector

新LessonPhaseは追加しない。

既存 `LessonRunDisplayMode` に:

```text
HOUSEHOLD_COMPARISON
```

を追加する。

REFLECTION中、教師が「教室画面に表示」を選ぶと、既にsanitizedされたfinal comparison snapshotだけをprojector projectionへ渡す。

発表順・タイマー・段階的reveal・peer commentは追加しない。

## 28. Firestore / RTDB Security

### 28.1 Firestore

次のserver-owned領域はクライアントから直接read/writeさせない。

```text
lessonRuns/{runId}/householdAssignment/...
lessonRuns/{runId}/householdRuntime/...
lessonRuns/{runId}/householdFinalComparison/...
lessonRuns/{runId}/households/...
```

学生・教師ともに必要なデータはCallableまたはRTDB projectionを経由する。

### 28.2 Assignment API認可順序

mutation Callable:

```text
request.auth確認
  ↓
LessonRun取得
  ↓
active org membership確認
  ↓
LessonRun role確認
  ↓
PRIMARY / CHANGE_SETTINGS相当を確認
  ↓
LessonRun status確認
  ↓
assignment / team / profile依存データ取得
  ↓
mutation
```

認可前にassignment詳細や他team情報を返さない。

assignment閲覧は `VIEW_PROGRESS` 相当としてPRIMARY / ASSISTANT / VIEWERへteacher projection経由で許可する。

### 28.3 RTDB

既存visibility boundaryを維持し、新しいfieldsを追加するために権限範囲を広げない。

class comparisonは `lessonRunPublic`、自team household群は `lessonRunTeamState` に置く。

### 28.4 allow-list producer

class comparison用に明示的server-side allow-list producerを作る。

概念上:

```text
toHouseholdClassComparisonPublicView(...)
```

内部objectをspreadしてdeny-list除去する方式は禁止する。

## 29. COMMON_CONDITIONS互換

既存COMMON runへの一括migrationを必須にしない。

persisted assignmentがないCOMMON runでは、resolverがimplicit assignmentを構築できる。

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
- 既存bulk / restore動作。

新しいassignment abstractionを使うために現行COMMON生徒UIを一括変更してはならない。

## 30. 主要エラー / 回復方針

- assignment INVALID: 編集は可能、開始不可。
- assignment STALE: 再同期・再確認が必要、開始不可。
- FROZEN identity mismatch: データ破損としてfail closed。
- roundStatus SETTLING: decision変更、新bulk、manual checkpointを拒否。
- bulk partial failure: unresolved operationを保持し、失敗itemだけretry。
- restoreGeneration mismatch: 古いbulk retry拒否。
- checkpoint assignmentRevision mismatch: restore拒否。
- OPENなのにhouseholds misaligned: ACTION_REQUIREDなruntime異常。
- comparison RTDB publish failure: Firestore final snapshotを正本として再投影。

## 31. 受け入れテスト

### 31.1 ROLE_VARIANT

- profile < teamで決定論的かつ均等に再利用される。
- 同一team集合・snapshotならdefault assignmentが安定する。
- profile > teamの余りはWARNINGのみ。
- PRIMARYのmanual変更が保存される。
- profile 1件でも開始可能。

### 31.2 STAGE_SPLIT

- distinct lifeStageを全てcoverできないassignmentは開始拒否。
- coverage不足状態をDRAFT保存できる。
- 修正後に開始可能。
- settlementを複数round実行しても各householdのlifeStageが変わらない。

### 31.3 MULTI_PERSON_PER_TEAM

- profile 1件教材はpublish可能だが開始拒否。
- profile >= 2なら全teamが完全profile setを持つ。
- 同じprofileでもteamごとにruntime householdIdが異なる。
- team内の全memberが全assigned householdsを操作できる。

### 31.4 STALE / FROZEN

- team追加/削除でSTALE。
- 再同期時に有効なmanual assignmentを保持。
- RUNNING遷移とFROZENがatomic。
- FROZEN後の新team作成/削除を拒否。
- late joinerの既存team加入は可能。

### 31.5 認可

- 自teamの全assigned householdを操作可能。
- 他team householdId指定は拒否。
- client-supplied teamId/profileIdに依存しない。
- assignment mutationはPRIMARYのみ。
- ASSISTANT/VIEWERはassignment閲覧のみ。

### 31.6 Decision / settlement race

- OPEN中だけdecision保存可能。
- bulk開始とdecision更新が競合しても処理対象decisionが不定にならない。
- SETTLING中の新規提出/変更を拒否。

### 31.7 Bulk

- advanced形式で個別決算不可。
- partial failureでsynchronizedRoundIndexが進まない。
- retryはSUCCEEDED itemを再settleしない。
- 全item成功時だけoperation COMPLETED + synchronizedRoundIndex increment。
- MULTIのteam submissionはN/Nでのみcomplete。

### 31.8 Checkpoint / restore

- MULTIの全runtime householdsをv3 snapshotへ保存。
- teamViewsで複数householdを上書きせず保持。
- v3 restore後にRTDB複数household projectionが復元される。
- assignmentRevision mismatchを拒否。
- restoreGeneration変更後の古いbulk retryを拒否。
- COMMON v2 checkpoint/restoreに回帰なし。

### 31.9 Teacher UI

- ROLE/STAGEはteam -> 1 household表示。
- MULTIはteam -> N household表示。
- team `x/y` とclass submission数が正しい。
- ASSISTANT/VIEWERにassignment変更controlがない。
- advancedには個別決算controlがない。
- partial failureの対象team/profileが識別できる。

### 31.10 Final comparison

- unresolved bulk中はREFLECTIONへ進めない。
- `synchronizedRoundIndex === 0` ではREFLECTIONへ進めない。
- 最後のbulk完了後、RUNNING -> REFLECTION成功時にcomparisonを自動生成する。
- 全生徒端末へ自動公開される。
- team display nameを使う。
- student name / UID / participantId / runtime householdId / hidden coefficientsが含まれない。
- projectorも同じsanitized snapshotだけを使う。
- RTDB publish失敗後に同じFirestore snapshotから再投影できる。

### 31.11 COMMON回帰

- 既存生徒画面が `.household` を読み続けられる。
- `householdId === teamId` が維持される。
- 個別決算が維持される。
- 既存bulk/checkpoint/restore testが通る。

## 32. 実装時の変更領域（設計上の見込み）

既存ファイルを確認した上で、実装計画では少なくとも次の責務を分離する。

- assignment domain / repository / callable
- start transition integration
- assigned household initializer
- `HouseholdState.profileId`
- advanced submit authorization + runtime barrier
- bulk operation generalization
- checkpoint v3 + restore v3
- teacher dashboard projection generalization
- advanced RTDB projection
- student multi-household UI
- assignment teacher UI
- final comparison persistence/public projection
- projector comparison mode
- Firestore / RTDB rules
- template advisory warnings
- comprehensive regression tests

具体的なファイル単位・関数signature・TDD順序は、設計承認後のimplementation planで固定する。

## 33. 不変条件まとめ

1. `profileId`, runtime `householdId`, `teamId` を混同しない。
2. student authorizationは保存済みteam ownershipから導出し、client team claimを信頼しない。
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
14. student/public projectionは明示的allow-listだけで生成する。
15. final comparisonはREFLECTIONへ正常遷移した後だけ全生徒へ自動公開する。
16. 生徒氏名・UID・participantId・内部係数をclass comparisonへ出さない。
