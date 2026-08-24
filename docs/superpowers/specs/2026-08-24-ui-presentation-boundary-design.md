# UI Presentation Boundary 設計仕様

**日付:** 2026-08-24  
**対象ブランチ:** `codex/classroom`  
**対象:** 生徒・教師・学校管理者・運営者向けUI全体  
**関連仕様:**

- `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md`
- `docs/superpowers/specs/2026-08-19-classroom-display-wiring-and-interventions-design.md`
- `docs/superpowers/specs/2026-08-20-lesson-status-readability-design.md`
- `docs/superpowers/specs/2026-08-04-teacher-student-ux-navigation-design.md`

## 1. 背景

現行UIでは、内部データ構造・識別子・enum・backend error message が利用者向け画面へ直接現れる箇所が複数領域に存在する。

確認済みの代表例は次の通り。

- `LessonControlRoom` が `currentPhaseLabel` 欠落時に `currentPhaseId`、さらに状況によっては raw `status` を表示する。
- `InterventionPanel` の残る介入操作が `phaseId` / `inputId` / `participantId` / `teamId` / `authUid` の手入力を要求する。
- `HouseholdTeamScreen` / `HouseholdSummaryCard` / 家庭科教師ダッシュボードが runtime `householdId`、`lifeStage`、asset type 等を表示可能な値として扱う。
- 家庭科のサーバー側dashboard builder自身が `${lifeStage}・${family}` を `profileLabel` として組み立て、raw enum を表示文字列へ埋め込んでいる。
- `OrderScreen` / `NewsListPage` / `ResearchDeskPage` 等に `LABELS[value] ?? value` 型のfail-open fallbackが存在する。
- `TeamNotesPage` が `リビジョン` を生徒へ表示し、`Revision mismatch` というbackend messageを文字列照合して競合判定している。
- `TemplateEditorPage`、家庭科教師操作、operator画面等に `error instanceof Error ? error.message : ...` が残っている。
- `AppErrorBoundary` が一般利用者へ `CONNECTION ERROR` / `CONFIGURATION ERROR` / `Firebase` / `App Check` といった実装用語を表示する。
- 学校組織・上位組織・請求画面で `owner/admin/teacher`、verification/invoice status、orgId/uid 等がそのまま表示・入力される箇所がある。

この問題は個別コピーの不備ではない。根本原因は、現在のコードベースに次の2境界しか明確に存在しないことである。

1. **内部データ** — Firestore/RTDB/Callable 内部で使うdomain/runtime data
2. **公開可能データ** — projection allow-list等により秘密情報を除去したdata

しかし、UIに必要なのは第3の境界である。

3. **利用者向け表示データ / Presentation Boundary** — 公開可能であるだけでなく、対象利用者が理解でき、内部構造を知らなくても操作できるdata

「公開して安全」と「そのまま表示してよい」は同義ではない。本設計はこの第3境界を正式に定義する。

## 2. 既存設計との関係

本設計は既存方針を置き換えるものではなく、既に個別仕様で採られているUX原則を全UIへ昇格させる。

### 2-1. 2026-08-04 UX再設計との整合

既存UX設計は、`OPEN` / `CONNECTING` 等の英語system statusを日本語へ統一し、「ホストリース」等の内部実装語を利用者向け文言から除く方針を既に定めている。

本設計はその原則を授業プラットフォーム、家庭科、市場、教材管理、組織管理、operatorへ拡張する。

### 2-2. 2026-08-19 教室表示・介入設計との整合

同仕様は「スライド」等の誤った内部語を整理し、`フェーズ` / `教材` / `授業` / `教室表示` 等を正式な製品用語として確定している。

また、未改善の5介入についてID手入力解消を後続プロジェクトCへ明示的に先送りしている。本設計はその未実施範囲を包含する。

### 2-3. 2026-08-20 状態表示設計との整合・修正

同仕様は `currentPhaseLabel` を導入してphase ID露出を改善した一方、古いrun互換のため `currentPhaseLabel ?? currentPhaseId` を仕様化した。

現在の要件では「ラベルが無い場合も内部IDを表示しない」ことを優先するため、このfallback方針は本設計で更新する。

## 3. 目的

本プロジェクトの目的は、通常の利用者向けUIから次を排除し、今後も再発しない仕組みにすることである。

- opaque runtime/database identifiers
- UID / auth UID
- backend enum token
- backend operation/state token
- raw route/path/internal field name
- raw `Error.message`
- Firebase/Firestore/RTDB/App Check等、利用者の行動に不要な実装技術名
- revision/idempotency/operation phase等、利用者が理解する必要のない整合性制御用語

同時に、内部値そのものを消すことは目的としない。内部IDやenumはdomain logic、API、監査、ログ、React key等で引き続き使用してよい。

## 4. 非目標

本設計は次を目的としない。

- Firestore/RTDB schema全体の改名
- 内部enum文字列の全面改名
- 監査ログから技術情報を削除すること
- join code、株式コード等、利用者が意味を理解して使う公開識別子の排除
- 既に製品語として確定した `フェーズ` / `ラウンド` / `チェックポイント` / `教室表示` / `教材` / `版` の廃止
- operator向け調査機能から全IDを隠すこと
- 本プロジェクトと無関係な画面情報設計の全面刷新

## 5. 用語

### 5-1. Internal Value

domain/runtime/database処理に必要だが、通常の利用者が意味を理解する必要のない値。

例:

- `phaseId = "market"`
- `householdId = "case-a"` またはhash
- `participantId`
- `authUid`
- `profileId`
- `status = "SETTLING"`
- `lifeStage = "CHILD_REARING"`
- `assetType = "DOMESTIC_STOCK"`

### 5-2. Public/Safe Projection

秘密情報・将来情報・他チーム情報等を除去し、対象clientへ配送して安全なdata。

これはsecurity/privacy boundaryであり、presentation-readyであることを意味しない。

### 5-3. Presentation Value

対象利用者が意味を理解でき、内部値を知らなくても判断・操作できる表示値。

例:

- `market` → `取引`
- `CHILD_REARING` → `子育て期`
- `DOMESTIC_STOCK` → `国内株式`
- `PRIMARY` → `主担当`
- opaque household ID → `子育て期・配偶者・子1人`

### 5-4. Fail-closed Presentation

未知値や欠落値が発生してもinternal valueをechoせず、一般的な安全表示へ落とす方式。

例:

- `UNKNOWN_NEW_STATUS` → `状態を確認できません`
- unknown phaseId → `フェーズ名を確認できません`

## 6. 利用者別表示ポリシー

### 6-1. 生徒

生徒向け通常UIには内部ID・UID・backend enum・revision・raw backend errorを表示しない。

表示可能:

- 自分/チームの表示名
- 教材上の企業名・ニュース・家庭プロフィールの人間向け属性
- 教師が設定したラベル
- 日本語化された状態・種別・概念名
- join code等、利用者自身が操作に使用する公開コード

### 6-2. 教師

教師向け通常UIでは、操作対象はIDではなく人・チーム・フェーズ・設問等のentityとして選択できること。

内部IDの入力を要求しない。

### 6-3. 学校管理者

通常運用は学校名、氏名、メール、日本語権限名を中心とする。

orgId/UID等がどうしても必要な保守操作では、主要導線ではなく明示的な「技術情報」セクションへ分離する。

### 6-4. 運営者

operatorは調査・障害対応上IDが必要な場合があるため完全非表示にはしない。

ただし、通常操作の主要ラベルは人間向け名称を使い、ID/UID/version ID等は「技術情報」またはsecondary metadataとして分離する。raw `Error.message` はoperator画面でも通常表示しない。

## 7. アーキテクチャ方針

採用方式は **Presentation層 + 必要箇所だけDTO拡張** とする。

### 7-1. Security ProjectionとPresentationを分離する

Functions側のprojection allow-listは既存のsecurity/privacy責務を維持する。

UI表示のためだけにFunctions側ですべての日本語文字列を生成しない。

理由:

- security projectionとcopy policyを混ぜない
- client側の表示変更でserver contractを不要に変えない
- 多言語化・表現変更を阻害しない
- 同じsemantic valueを画面ごとに独自翻訳する問題を共通化できる

### 7-2. Presentation moduleをdomain単位で分ける

巨大な単一辞書を作らず、責務単位に分ける。

想定:

- `src/lib/presentation/lessonLabels.ts`
- `src/lib/presentation/marketLabels.ts`
- `src/lib/presentation/householdLabels.ts`
- `src/lib/presentation/organizationLabels.ts`

各moduleは次を提供する。

- union型に対するexhaustiveなlabel map
- API境界等で `string` しか保証できない値に対するsafe formatter
- raw inputをfallbackとして返さないこと

### 7-3. 禁止パターン

利用者向けrender pathで次を禁止する。

```ts
LABELS[value] ?? value
```

```ts
label ?? internalId
```

```ts
error instanceof Error ? error.message : fallback
```

```ts
if (error.message.includes('backend literal')) { ... }
```

これらはdomain logicやlogging内部で使用することまで禁止しない。禁止対象は「利用者表示」または「利用者表示のための制御フロー」である。

### 7-4. DTO拡張が必要な条件

client側にhuman-readable labelを構築する材料が存在しない場合のみ、server/API DTOを拡張する。

IDから名称をclient側で再問い合わせするためだけのN+1 fetchは導入しない。

DTOは可能な限り完成済みcopyではなくsemantic fieldsを渡す。

例:

- 悪い: serverが `profileLabel: "CHILD_REARING・配偶者・子1人"` を作る
- 良い: serverが `lifeStage` と `family` を返し、clientが `子育て期・配偶者・子1人` を作る

ただし、教材作者自身が入力した自由文label等はそのままpresentation valueとして返してよい。

## 8. エラー境界

### 8-1. 基本方針

raw `Error.message` を通常UIへ直接表示しない。

client wrapperまたはpresentation error mapperで、利用者が取れる行動に変換する。

既存の `src/lib/monitoring/describeError.ts` と `LessonJoinPage` のerror mappingを基準パターンとする。

### 8-2. Error codeとcopyを分離する

server側で意味のある失敗をclientが分岐する必要がある場合、文言ではなくstable error codeをcontractとする。

特に `TeamNotesPage` の `Revision mismatch` 文字列照合は廃止し、競合をsemantic codeとして扱う。

UIはbackend messageを解析せず、codeに対応する利用者向け説明だけを表示する。

### 8-3. App-wide fatal error

`AppErrorBoundary` / `ConfigurationError` は次を一般利用者へ表示しない。

- `CONNECTION ERROR`
- `CONFIGURATION ERROR`
- `Firebase`
- `App Check`

表示は「起きたこと」と「次にできること」に限定する。

技術詳細はlogging/reportingに残す。

## 9. 確定した領域別設計

### 9-1. 授業コントロール

#### Phase label

`LessonControlRoom` は `currentPhaseLabel` を最優先する。

ラベル欠落時に `currentPhaseId` またはraw `status` へfallbackしない。

表示規則:

- DRAFT/READY/WAITINGで未開始 → `未開始`
- currentPhaseLabelあり → そのlabel
- running/reflection等でlabel欠落 → `フェーズ名を確認できません`

古いrun互換は「内部IDを見せること」ではなく「safe fallbackで操作不能にならないこと」で担保する。

#### Next phase CTA

現在の `App.tsx` は `templateSnapshot.phases` を既に読み、`findPhaseLabel` で次フェーズ名を構築できる。この仕組みを維持し、IDを表示しない。

### 9-2. 介入操作

残る5介入のID手入力を廃止する。

#### `PROXY_CONFIRM`

教師は対象参加者と対象入力を人間向けラベルで選択する。

- current phaseは画面状態から自動解決
- participantはdisplayName中心の選択
- inputは教材のprompt/label中心の選択
- Callableへ渡すIDはUI内部で解決

#### `CHANGE_REPRESENTATIVE`

- teamId手入力 → チーム表示名選択
- participantId手入力 → そのチーム内の参加者名選択

#### `RECONNECT_PARTICIPANT`

- participantId手入力 → 参加者名選択
- 新しいauth UIDの教師手入力は廃止する

新UIDが本当にserver contract上必要なら、再接続フロー自身を見直し、教師がUIDを知る必要のないhandshake/token型の操作へ変更する。

#### `RESTORE_PREVIOUS_PHASE`

- phaseId手入力 → phase graphから日本語labelで選択

#### `EMERGENCY_STOP`

現行の理由入力+確認を維持する。追加IDは不要。

### 9-3. 家庭科 — 生徒

`HouseholdTeamScreen` / `HouseholdSummaryCard` はruntime `householdId` を表示名として使用しない。

#### Common format

1 household/teamのためIDで区別する必要がない。

見出しは `この家庭` またはhuman-readable profile情報を使う。

#### Advanced format

`profile.lifeStage` + `profile.family` をpresentation formatterへ通して表示名を作る。

例:

- `CHILD_REARING` + `配偶者・子1人`
- → `子育て期・配偶者・子1人`

#### lifeStage

raw enumを直接表示しない。

#### asset type

`assetHoldingsYen` のobject keyをそのままselect/ranking labelへ渡さない。

内部valueはkeyのまま保持し、表示labelだけpresentation formatterで変換する。

#### concept category

unknown categoryを `?? concept` でechoしない。

### 9-4. 家庭科 — teacher dashboard / projection

server-side `profileLabel` にraw `lifeStage` を埋め込む設計をやめる。

dashboard DTOは表示に必要なsemantic fieldsを持たせる。

想定:

- `lifeStage`
- `family` または同等のpublic profile情報

clientがpresentation formatterを使ってlabelを組み立てる。

### 9-5. 家庭科 — assignment

現在の `HouseholdAssignmentView` はentryに `profileId` しかなく、teacher UIがhuman-readable profileを構築できない。

serverは既にprofilesを入力に持っているため、assignment viewへ安全なprofile summaryを含める。

teacherはprofile IDを選択するのではなくprofile summaryを選択し、内部valueとしてprofileIdを保持する。

runtime `householdId` も通常表示しない。

### 9-6. 市場・Research Desk

次を共通presentation formatterへ移す。

- order status
- order side
- information category
- information nature
- confidence
- research panel type
- company size
- growth profile
- financial strength
- economic indicator
- その他authoring package由来enum

未知値はraw echoしない。

`BUY` / `SELL` を括弧内へ併記する等のbackend token表示も通常生徒UIから除く。

株式ticker等、授業上公開された銘柄コードはinternal IDとは扱わない。

### 9-7. Team Notes

生徒へrevision numberを表示しない。

`リビジョン` / `サーバー内容` 等の実装寄り文言は、利用者行動に合わせて次のようにする。

- `最新の内容に戻す`
- `他のメンバーが先に更新しました。最新の内容を確認してもう一度保存してください。`

競合判定はstable error codeで行う。

### 9-8. Lesson Preparation

participant statusは全値をpresentation formatterへ通す。

`ACTIVE` 以外だけraw statusを出す現行fallbackを廃止する。

画面説明中の `(WAITING)` 等backend enum併記も通常UIから除く。

### 9-9. Template Editor

教材移転操作で組織IDを教師へ手入力させない。

移転先はアクセス可能な組織一覧から名称で選択する設計を優先する。

move operationの `status` / `phase` / `lastError` をraw表示しない。

必要な進捗は人間向け段階へmapする。

### 9-10. 組織管理

#### role

`owner/admin/teacher` を通常UIでそのまま表示しない。

表示名を共通化する。

例:

- owner → 所有者
- admin → 管理者
- teacher → 教師

#### member identity

UIDをmemberの主要display nameまたはform labelに使わない。

優先順位は表示名/メール等。UIDが必要な保守情報ならsecondary technical metadataへ分離する。

#### org ID

削除確認等でorgIdの手入力を要求しない。

破壊操作の確認は組織名または固定確認語等、利用者が理解できる値を使う。

#### statuses

verification status、invoice status、archive job status、student membership status等をraw表示しない。

#### audit log

学校管理者向け監査ログでは `actorUid` / raw `action` を主要表示にしない。

actorのhuman-readable identity、actionの日本語descriptionを優先する。

技術調査が必要な場合のみ詳細欄へIDを出す。

### 9-11. Operator

operatorはID利用を全面禁止しない。

ただし次を守る。

- card/listのprimary textはhuman-readable name/title
- raw enumを操作ボタンに併記しない
- visibility/certification等はpresentation formatterを使う
- ID/UID/version IDはsecondary `技術情報` として分離
- raw `Error.message` は表示しない

## 10. Presentation formatterの契約

### 10-1. union型

known unionに対してはexhaustive `Record<Union, string>` を使い、enum追加時にcompile errorで未翻訳を検出する。

### 10-2. untrusted/string型

wire boundaryで `string` として受け取る場合はsafe formatterを提供する。

概念例:

```ts
function describeLessonStatus(value: string): string {
  return LESSON_STATUS_LABELS[value as KnownLessonStatus] ?? '状態を確認できません'
}
```

raw `value` は返さない。

### 10-3. value/label分離

select/tab/button等ではinternal valueをstate/API payloadに保持してよい。

表示labelのみpresentation valueへ変換する。

## 11. テスト方針

本プロジェクトはTDDで進める。

### 11-1. 既存の漏出仕様テストを反転する

現在、次のようなテストが漏出を正常動作として固定している。

- `LessonControlRoom.test.tsx`: ラベルが無ければphase IDへfallback
- `HouseholdTeamScreen.test.tsx`: `team-a` / `case-alpha` を表示
- `HouseholdTeamScreen.test.tsx`: `CHILD_REARING・...` 等をhuman-readableとして期待

これらは実装修正前にRED testへ変更する。

### 11-2. Negative assertionを必須にする

人間向けlabelが見えることだけでなく、raw internal valueがDOMに存在しないことを検証する。

例:

```ts
expect(screen.getByText('子育て期・配偶者・子1人')).toBeInTheDocument()
expect(screen.queryByText(/CHILD_REARING/)).not.toBeInTheDocument()
expect(screen.queryByText(/case-a/)).not.toBeInTheDocument()
```

### 11-3. Unknown value regression

各presentation formatterに未知値テストを入れる。

目的は新しいserver enumが追加された際に `NEW_INTERNAL_STATUS` が突然UIへ出ることを防ぐこと。

### 11-4. Error leak regression

component testで意図的に `Error('INTERNAL_BACKEND_DETAIL')` をthrowし、その文字列がDOMに現れないことを確認する。

semantic error codeを必要とする画面はcodeごとの利用者向けcopyを検証する。

### 11-5. ID-entry regression

介入・組織移転・assignment等では、教師がopaque IDを入力するTextFieldが存在しないことをrole/labelベースで検証する。

## 12. 実装プロジェクト分割

本仕様は複数の独立サブシステムにまたがるため、実装計画は1本にまとめない。

以下の順序・依存関係で個別planを作る。

### Project A — Presentation Foundation + Error Boundary

**依存:** なし  
**後続:** 全project

対象:

- `src/lib/presentation/*`
- `describeError`
- common error mapping方針
- `AppErrorBoundary`
- shared tests

### Project B — Student Market / Research UI

**依存:** A

対象:

- `OrderScreen`
- `NewsListPage`
- `ResearchDeskPage`
- `CompanyResearchPage`
- `StatisticsMaterialsPage`
- `TeamNotesPage`
- market/research error contract（必要箇所）

### Project C — Home Economics Presentation Contract

**依存:** A

対象:

- household presentation formatter
- realtime/team DTO
- teacher dashboard DTO
- assignment DTO
- `HouseholdTeamScreen`
- `HouseholdSummaryCard`
- class comparison
- teacher household dashboard/round controls
- assignment UI

### Project D — Teacher Lesson Runtime + Intervention Scenarios

**依存:** A  
**部分依存:** C（家庭科participant/entity selectorを共有する場合）

対象:

- `LessonControlRoom`
- `LessonPreparationPage`
- `InterventionPanel`
- 5介入のpurpose-built forms
- 必要なentity data取得/DTO/API contract

### Project E — Template / Organization Admin

**依存:** A

対象:

- `TemplateEditorPage`
- School/Parent org settings
- billing/plan limits
- member role/status UI
- org migration/move UI
- audit log presentation

### Project F — Operator + Whole-App Regression Audit

**依存:** A-E

対象:

- operator pages
- 技術情報の明示分離
- repo-wide forbidden pattern audit
- full test/typecheck/lint

## 13. 実装順

1. Project Aを先行し、presentation/error共通契約を固定する。
2. B/C/D/EはA完了後に並列実装可能とする。
3. CとDで共有entity selector/API変更が発生する場合のみ依存順を調整する。
4. Fを最後に実施し、横断回帰を検証する。

各projectは独立してreview可能・testableでなければならない。

## 14. Migration / Compatibility

### 14-1. 古いrun

古いrunで表示labelが欠落してもinternal IDへfallbackしない。

safe generic labelで表示し、主要操作が可能なら継続する。

### 14-2. API field追加

DTO拡張は可能な限りadditiveにする。

古いclientとの互換性が必要なserver projectionでは既存fieldを即削除せず、新fieldを追加してclient移行後に別projectで削除可能とする。

ただし本branchのみで一体リリースされるcontractについては、影響範囲をテストで完全に追える場合に限り同一projectで置換してよい。

### 14-3. Logging / audit

raw error、ID、enumをUIから隠してもlogging/monitoring/auditから削除しない。

障害調査可能性は維持する。

## 15. Review checklist

各実装PR/commitのreviewでは最低限次を確認する。

- `?? rawValue` が利用者向け表示へ残っていないか
- `error.message` がDOMへ流れていないか
- backend message文字列をcontrol flowに使っていないか
- ID/UIDを入力させるfieldが新設されていないか
- semantic valueとdisplay labelが分離されているか
- unknown enum testがあるか
- human-readable labelのpositive assertionだけでなくraw valueのnegative assertionがあるか
- server DTOで完成済み日本語copyを不必要に生成していないか
- operatorでIDが必要な場合、「技術情報」として意図的に分離されているか

## 16. Definition of Done

本プロジェクト全体の完了条件は次の通り。

1. student / teacher / school-admin の通常UIへopaque ID/UIDを表示しない。
2. student / teacher / school-admin の通常UIでopaque ID/UIDの手入力を要求しない。
3. known backend enum/statusは共通presentation mappingを通る。
4. unknown enum/statusはraw inputをechoしない。
5. raw `Error.message` が通常UIへ直接表示されない。
6. backend error message文字列をUI制御フローに利用しない。
7. 家庭科の `lifeStage` / asset type / household runtime IDがraw表示されない。
8. phase label欠落時にphase ID/statusへfallbackしない。
9. Team Notesでrevisionを生徒へ表示せず、競合をsemantic error codeで判定する。
10. 介入操作5種で教師がphase/input/participant/team/auth UIDを手入力しない。
11. 組織管理のrole/status/actionが人間向け表示に統一される。
12. operatorの技術IDは必要な場合のみ明示的なtechnical metadataとして分離される。
13. 各対象componentにraw value非表示のnegative regression testが存在する。
14. 新しい未知enum、不正status、欠落display label、backend error、opaque IDをfixtureとして注入しても、それ自体がstudent / teacher / school-admin UIの文字列として現れない。

## 17. 設計判断の要約

この問題を「全画面の文言修正」として扱わない。

**Security-safe DTOの上にPresentation Boundaryを置き、内部値をUIロジックでは使えても、利用者向け表示へ直接流さないことをコード・API・テストの契約として固定する。**

個別の翻訳漏れではなく、raw fallbackを許す設計そのものを修正対象とする。
