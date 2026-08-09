# スライド自動生成（説明スライドの手動入力+AI下書き）設計仕様

**日付:** 2026-08-09
**対象:** Phase E(AI・教材作成強化)のサブプロジェクト5(最終) — スライド自動生成
**正本:** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md` §5.4(教室表示)・§15.1(説明文・スライドの案)・§16.2(説明スライド)。矛盾する場合は正本を優先し、本仕様側の誤りとして扱う。

## 背景・位置づけ

「スライド自動生成」は、新しいスライドUIやPPTX/Google Slidesエクスポート機能を作ることではない。既存の教室投影コンポーネント`ExplanationSlide`（`src/components/display/ExplanationSlide.tsx`）が表示する`teacherGuidance: string | null`フィールドに、AIが下書きした説明文を反映できるようにする機能である。

**この判断の前提となる事実（調査で判明）:**
- `StartSlide`/`EndSlide`/`LiveSlide`/`ExplanationSlide`/`ClassroomDisplayPage`はPhase Eより前にすべて実装済みで、変更しない。
- `deriveDisplayMode`（`functions/src/lessonRuns/projections/displayProjection.ts`）は`status === 'REFLECTION'`のとき自動的に`EXPLANATION`モード（説明スライド）を返す。「説明スライドへの切り替え」は既存のステータス遷移の結果として自動的に起きており、本サブプロジェクトが新たに作る必要はない。
- `teacherGuidance`フィールドには、コードベース全体を調査した結果、**書き込み元がどこにも存在しない**（読み取り側の投影関数のみ存在）。本サブプロジェクトはまずこの手動入力の土台（Callable+UI）を作り、その上にAI下書き機能を載せる。
- さらに調査で、教室投影RTDBノード`lessonRunDisplay/{lessonRunId}`（`ClassroomDisplayPage`が購読する経路）への書き込み自体が、コードベース全体でどこからも呼ばれていないことが判明した。書き込み関数`publishLessonProjectionWithAdminSdk`（`functions/src/lessonRuns/projections/publicProjection.ts`）は実装済みだが呼び出し元が存在しない。これはフェーズ遷移・市場ティック・家庭科ラウンド確定等、教室投影全体に関わる本サブプロジェクトのスコープを超える既存のギャップであり、別タスクとして切り出し済み。本サブプロジェクトは**この機能専用に**RTDBへの書き込みを配線し、一般的な教室投影ライブ更新パイプラインの配線には踏み込まない。

## アーキテクチャ

### 手動入力の土台

新規Callable `setTeacherGuidanceCallable`（`functions/src/lessonRuns/projections/onCall.ts`に追加。同ファイルに既にある`issueDisplaySessionTokenCallable`と同じ教室投影領域のファイルであり、認可ロジックも流用できる）。

- **認可:** `issueDisplaySessionTokenCallable`と同一パターン。`request.auth`必須 → `isCallerTeacher(request.auth.token)` → 対象`lessonRuns/{lessonRunId}`の`teacherRoles[uid]`が`'PRIMARY'`または`'ASSISTANT'`（`'VIEWER'`または未登録は拒否）→ `requireActiveOrgMember(db, orgId, uid)`（`orgId`はレッスンラン自身の保存値から取得、クライアント入力は信用しない）。
- **入力:** `{lessonRunId: string, teacherGuidance: string}`（空文字列は「クリア」を意味する）。
- **処理:**
  1. `lessonRuns/{lessonRunId}`ドキュメントの`teacherGuidance`フィールドを書き込む（空文字列は`null`として保存）。これがシステムの正本（Firestore）。
  2. 書き込み直後に同じドキュメントと`teams`サブコレクションを読み直し、`LessonRunProjectionSource`相当の最小構成（`orgId`/`status`/`title`/`goal`/`teacherGuidance`/`teams`/`updatedAtMillis`）を組み立て、既存の`toLessonRunDisplayState`（`displayProjection.ts`）へ渡す。
  3. 結果を`getDatabase().ref(\`lessonRunDisplay/${lessonRunId}\`).set(...)`でRTDBへ書き込む（`publicProjection.ts`の`setDisplayState`と同じ書き込み経路・同じ関数シグネチャを直接使う）。`lessonRunPublic`側は`teacherGuidance`を含まない（`toLessonRunPublicState`の出力フィールドに存在しない）ため触らない。
- **冪等性キーは不要**と判断する。単純なテキストフィールドの上書きであり、既存の「1回きりの介入操作」（`applyTeacherIntervention`）とは性質が異なり、テンプレートのタイトル・説明を編集する既存の他フィールドと同様、再送しても実害のない操作のため。

### UI（手動入力）

`LessonControlRoom.tsx`に「説明スライドを編集」ボタンを追加する。

- 表示可否は`role === 'PRIMARY' || role === 'ASSISTANT'`で判定する（既存の`canHandleConnection`等と同じ、クライアント側は表示ガードのみ担い、実際の認可はサーバー側の`teacherRoles`チェックが正）。
- ボタンから編集ダイアログを開く。複数行テキスト欄に現在の`displayState.teacherGuidance`（購読済み）を初期値として表示。「保存」ボタンで`setTeacherGuidanceCallable`を呼ぶ。
- 保存後、既存の`displayState`購読（`subscribeDisplayRun`）が自動的に更新されるため、画面上部の`displayPreview`（例:「教室表示: 説明スライド」）にも反映され、教師はこの画面だけで効果を確認できる。

### AI下書き

- 新規プロンプトビルダー`functions/src/ai/teacherGuidancePrompt.ts`。`lessonDraftPrompt.ts`と同じ構造で`buildTeacherGuidancePrompt`/`parseTeacherGuidanceResponse`を提供する。
- 新規Callable`generateTeacherGuidanceCallable`（`functions/src/ai/onCall.ts`に追加）。`generateLessonDraftCallable`と同じ骨格：認証・教師確認 → `organizations/{orgId}.aiEnabled`確認 → `unconfiguredLlmProvider.generateText(...)` → 使用ログ`organizations/{orgId}/aiUsageLog`に`feature: 'TEACHER_GUIDANCE'`で記録。**Firestoreへの直接書き込みは行わない**（既存の「AIは即時公開しない」原則を、既存の`generateLessonDraftCallable`と全く同じ形で満たす）。
- 入力: `{topic: string}`（教師が「何について説明したいか」を一言入力する。例:「今日の株価変動の背景」）。出力: `{teacherGuidance: string}`。
- UI: 編集ダイアログ内に「AIで下書き」ボタンを追加する（`organizations/{orgId}.aiEnabled`が`true`の場合のみ表示。既存の`TemplateOverviewPage`と同じ`aiEnabled`プロパティ受け渡しパターン）。トピック入力 → `generateTeacherGuidanceCallable`呼び出し → 結果をテキスト欄へ反映（未保存） → 教師が確認・編集 → 「保存」ボタンで`setTeacherGuidanceCallable`を呼ぶ、という2段階を踏む。

## データフロー

```
[教師: LessonControlRoom「説明スライドを編集」ボタン] --ダイアログを開く--> 現在のteacherGuidance(displayState経由)を初期値表示
  --(任意)「AIで下書き」--> トピック入力 --> generateTeacherGuidanceCallable --> テキスト欄へ反映(未保存)
  --教師が確認・編集--> 「保存」ボタン --> setTeacherGuidanceCallable
    --> lessonRuns/{id}.teacherGuidance へ書き込み(Firestore)
    --> 直後に再読込 + teams取得 --> toLessonRunDisplayState --> lessonRunDisplay/{id} へ set(RTDB)
  --> 教室投影画面(ExplanationSlide、REFLECTIONステータス時)・LessonControlRoomのdisplayPreview の両方が更新される
```

`ExplanationSlide`自体・`REFLECTION`ステータスへの遷移ロジック（`deriveDisplayMode`）は既存のまま変更しない。本サブプロジェクトが追加するのは「教室投影に表示される`teacherGuidance`の中身を設定する経路」のみ。

## エラー処理

- `setTeacherGuidanceCallable`: 認可失敗は`HttpsError('permission-denied', ...)`、対象レッスンラン不在は`HttpsError('not-found', ...)`を返す。RTDB書き込みが失敗した場合（Firestore書き込みは成功済み）、次にこのCallableが呼ばれた時点、または将来配線される他の経路の`publishLessonProjection`呼び出しで自然に追いつく。Firestoreが正本であるため、データの不整合ではなく表示の一時的な遅延にとどまる——このサブプロジェクトのスコープではこれ以上のリトライ機構は設けない。
- `generateTeacherGuidanceCallable`: `generateLessonDraftCallable`と同じく、失敗時は`HttpsError('unavailable', ...)`を返し、UI側は「AI下書きに失敗しました。手動で入力してください」を表示する。手動入力の土台は独立して機能するため、AI機能の障害が説明スライド編集全体をブロックしない。
- ダイアログの保存ボタンは空文字列の保存を許可する（説明スライドの文言を空に戻す=クリアする操作として扱う。クライアントは空文字列をCallableへ渡し、サーバー側で空文字列は`teacherGuidance: null`として保存する）。

## テスト方針

- `setTeacherGuidanceCallable`: 認可（PRIMARY/ASSISTANT許可、VIEWER拒否、非アクティブorgメンバー拒否）、Firestore書き込み、RTDB `lessonRunDisplay`への反映を、`functions/src/homeEconomics/onCall.test.ts`と同じモック構成（`vi.mock('firebase-admin/firestore', ...)`、`vi.mock('firebase-admin/database', ...)`、`vi.mock('../../organizations/authorization', ...)`）で検証する。
- `toLessonRunDisplayState`は既存の純粋関数のテストがあるため本サブプロジェクトでは変更しない。
- `teacherGuidancePrompt.ts`: `buildTeacherGuidancePrompt`/`parseTeacherGuidanceResponse`を純粋関数テストで検証する（`lessonDraftPrompt.test.ts`と同じ形式）。
- `generateTeacherGuidanceCallable`: `generateLessonDraftCallable.test.ts`と同じ形式（未認証/非教師/aiEnabled=false/成功/失敗時ログ）で検証する。
- UI: `LessonControlRoom`で編集ダイアログを開く→テキスト入力→保存で`setTeacherGuidanceCallable`が正しい引数で呼ばれることを検証する。AI下書きボタンはトピック入力→`generateTeacherGuidanceCallable`呼び出し→結果がテキスト欄に反映されることを検証する。
