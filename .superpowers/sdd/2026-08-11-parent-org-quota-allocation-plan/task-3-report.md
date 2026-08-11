# Task 3A 実装レポート

## 対象範囲

- `functions/src/lessonRuns/createLessonRun.ts`
- `functions/src/lessonRuns/createLessonRun.test.ts`

Task 3AとしてLessonRun作成時の親共有枠予約だけを実装した。`lifecycle`、`invitations`、`suspendMember`は変更していない。未追跡の`.claude/`にも触れていない。

## 実装内容

- 組織が`type: 'school'`かつ`parentOrgId`を持つ場合だけ親共有枠の判定へ進む。
- 既存の学校プラン上限と`downgradeStatus`判定を維持し、対象resourceの`RESTRICTED`拒否を親allocation・reservation collectionのreadより先に評価する。
- `activeCount + 1`が学校保証以下なら親共有予約を作らず、親のallocation/reservation collectionも読まない。
- 保証超過時は同じFirestore transaction内で親組織、親プラン、全学校allocation、全quota reservationをreadし、Task 1の`reserveSharedQuota`へ渡す。
- 返されたdeterministicな予約IDでquota reservationを書き、LessonRunとidempotency文書も同じtransactionで書く。全readを終えてからwriteを開始する。
- 共有枯渇は純粋層から`Error('共有枠が不足しています')`をそのまま送出し、Callable境界で`resource-exhausted`へ変換できる契約にした。
- Firestore transaction retryでIDとseedが変わらないよう、`lessonRunId`と`randomSeed`は`runTransaction`呼び出し前に1回だけ生成する。APIのidempotent再呼び出しでは新しい値を生成しても既存idempotency文書のIDを返し、書き込まない。
- 抽象`FirestoreTx`にはcollection readだけを追加し、Admin SDK adapterは`transaction.get(collectionRef)`で同一transactionのsnapshotを返す。

## TDD RED

引き継いだテストfakeの`getCollection`内で外側`collectionReads`と衝突していたローカル変数を`collectionDocuments`へ変更した後、次を実行した。

```bash
cd functions && npx vitest run src/lessonRuns/createLessonRun.test.ts
```

exit code 1。`Test Files 1 failed`、`Tests 3 failed | 15 passed`。失敗は以下の未実装挙動に一致した。

- 保証超過時に親共有予約が作成されない。
- 共有余剰0でもLessonRun作成が成功してしまう。
- transaction retryごとに`lessonRunId`が再生成される。

## GREEN・検証

追加した境界テストでは、親なし学校が従来の自組織プラン上限を使うことと、保証内では親collection readを行わないことも固定した。

```bash
cd functions && npx vitest run src/lessonRuns/createLessonRun.test.ts
cd functions && npm run typecheck
cd functions && npm run lint
```

すべてexit code 0。対象テストは`Test Files 1 passed`、`Tests 19 passed`。typecheckとlintもエラーなし。

## Firestore仕様確認

実装前にcontext7で`/googleapis/nodejs-firestore`の現行ドキュメントを確認した。read-write transactionは全readをwriteより先に完了する必要があり、競合時はtransaction callback全体が再実行されること、`Transaction.get(Query)`でcollection queryを同一transaction内に含められることを確認した。

## 設計判断

- 予約判定はTask 1の純粋関数を再利用し、Firestore固有のcollection readとDTO変換だけを`createLessonRun`側に追加した。
- 保証判定に必要な自校allocation文書だけはlinked schoolでreadし、親全体のallocation/reservation collectionは保証超過時だけ読む。
- write-after-read guardを持つテストfakeで予約・run・idempotencyのwrite順を検証し、transaction retry fakeで生成値の安定性と予約の一意性を検証した。

## 懸念事項

Callable側で`共有枠が不足しています`を`resource-exhausted`へ実際に変換する変更は、今回指定されたwrite scopeに`onCall.ts`が含まれないためTask 3Aでは行っていない。純粋層のエラー型・文言は後続で変換可能な形に固定済み。

---

# Task 3B 実装レポート

## 対象範囲

- `functions/src/organizations/invitations.ts`
- `functions/src/organizations/invitations.test.ts`
- `functions/src/organizations/suspendMember.ts`
- `functions/src/organizations/suspendMember.test.ts`
- `functions/src/organizations/parentOrgQuotaFirestore.ts`

Task 3Bとして教師招待受諾時の親共有教師席予約と、教師suspend成功後の対応予約返却だけを実装した。Task 3Aの`createLessonRun`、lifecycle、UI、未追跡の`.claude/`には触れていない。

## 実装内容

- 新規教師の招待受諾では、既存の`teacherSeats` downgrade restrictionを共有枠判定より先に評価する。restrictionまたは共有枯渇で拒否された場合はmembership syncも招待の`ACCEPTED`更新も実行しない。
- 既にactiveなmemberはquota transactionを開始せず、招待だけを`ACCEPTED`にする。初回membership read後の競合にも備え、quota transaction内でも対象memberを再readし、activeなら予約を作らず`ALREADY_MEMBER`として収束する。
- `type: 'school'`かつ`parentOrgId`を持つ組織だけを親共有枠判定の対象とする。transaction内でactive teacher数と自校allocationを読み、`activeTeachers + 1`が`guaranteedTeacherSeats`以下なら予約せず、親組織・親plan・親collectionも読まない。
- 保証超過時だけ、同じFirestore transaction内で親組織、親planの`teacherSeats`上限、全`schoolAllocations`、全`quotaReservations`をreadし、Task 1の`reserveSharedQuota`へ渡す。全read完了後にdeterministicな`teacherSeats:schoolOrgId:uid`文書をwriteする。
- 同じ予約が既に存在するretry/idempotent再実行では再writeせず、元の`createdAt`を維持する。予約文書にはquota判定に必要なID・resource情報と`createdAt`だけを保存し、メールアドレス等を含めない。
- allocation/reservation変換とdeterministic reservation pathを`parentOrgQuotaFirestore.ts`へ集約し、招待予約とsuspend返却で共通のpath生成を使う。Task 3Aファイルを変更しない指定を守り、`createLessonRun`側は変更していない。
- 教師suspendではowner保護と既存のPENDING→Firestore membership→SYNCED mirror更新を維持し、そのsyncが成功した後だけ親共有教師席予約をdeleteする。owner/adminおよび親なし組織では教師席予約をdeleteしない。Firestoreのdocument deleteは対象がないretryでも安全に収束する。

## TDD RED

変更前のbaselineとして次を実行し、`Test Files 2 passed`、`Tests 16 passed`を確認した。

```bash
cd functions && npx vitest run src/organizations/invitations.test.ts src/organizations/suspendMember.test.ts
```

その後、production codeより先に招待quotaとsuspend返却のテストを追加して同じcommandを実行した。exit code 1、`Test Files 2 failed`、`Tests 8 failed | 16 passed`だった。失敗は以下の未実装挙動に一致した。

- 共有枯渇でも招待受諾がmembership syncして成功してしまう。
- 保証内・保証超過・共有枯渇・transaction内already-active判定用の`reserveTeacherSeatForInvitation`が未実装。
- 教師suspend成功後にrelease callbackが呼ばれない。
- deterministic reservation pathを削除する`releaseTeacherSeatReservation`が未実装。

## GREEN・検証

最小実装後、次を実行した。

```bash
cd functions && npx vitest run src/organizations/invitations.test.ts src/organizations/suspendMember.test.ts
cd functions && npm run typecheck
cd functions && npm run lint
```

対象テストは`Test Files 2 passed`、`Tests 24 passed`、typecheckとlintもexit code 0だった。最終commit直前のfresh runでも同じ結果を確認した。加えてFunctions全体の`npm test`も実行し、`Test Files 128 passed`、`Tests 1110 passed`、exit code 0だった。

## Firestore仕様確認

実装前にcontext7で`/googleapis/nodejs-firestore`の現行ドキュメントを確認した。read-write transactionではdocument/queryを含む全readをwriteより先に完了する必要があり、競合時はtransaction callback全体が再実行されることを確認した。テストfakeは最初のwrite後のreadを例外にし、保証超過経路のread-before-writeを固定した。

## 要件対応テスト

- 保証内: 親共有予約なし、親組織・親plan・親collection readなし。
- 保証超過: deterministic reservationを1件だけ作成し、再実行でも重複・再writeなし。
- 共有枯渇: 純粋な`Error('共有枠が不足しています')`、quota write・membership sync・招待更新なし。
- downgrade precedence: quota adapterを呼ばず、membership syncなし。
- already-active member: 事前readとtransaction内競合readの両方で予約なし。
- suspend release: 教師sync成功後だけmatching reservationをdeleteし、sole owner拒否またはsync失敗時はreleaseなし。

## 懸念事項

- `acceptInvitationCallable`で`共有枠が不足しています`を`resource-exhausted`へ変換する実変更は、指定write scopeで`organizations/onCall.ts`が除外されているためTask 3Bでも行っていない。今回の純粋`Error`は既存Callable境界で明示的に変換可能な契約になっている。
- membership sync成功後のreservation delete自体が失敗した場合、memberはsuspendedでもCallableは失敗する。現在の既存suspend契約はalready-suspended retryを拒否するため、その稀な部分失敗を自動修復するにはwrite scope外の再試行設計またはreconciliationが必要になる。

---

# Task 3C 実装レポート

## 対象範囲

- `functions/src/lessonRuns/phases/transitionPhase.ts`
- `functions/src/lessonRuns/phases/transitionPhase.test.ts`
- `functions/src/lessonRuns/appendLessonEvent.ts`
- `functions/src/lessonRuns/onCall.ts`
- `functions/src/lessonRuns/onCall.test.ts`
- `functions/src/organizations/onCall.ts`
- `functions/src/organizations/onCall.test.ts`

Task 3CとしてLessonRunのterminal遷移時の親共有枠返却と、Task 3A/3Bで保留されていたCallableの共有枯渇エラー変換を実装した。`createLessonRun`、招待受諾の純粋ロジック、`suspendMember`、UI、未追跡の`.claude/`には触れていない。

## 実装内容

- `targetStatus`が`ABORTED`または`COMPLETED`の非dedupe遷移だけで、LessonRunの`orgId`から組織文書をreadする。
- 組織が`type: 'school'`かつ空でない`parentOrgId`を持つ場合、Task 3Bで共通化された`quotaReservationDocumentPath`を使い、`concurrentLessonsAndMarkets:schoolOrgId:lessonRunId`のdeterministic reservation文書をreadする。
- reservationが存在する場合だけ、ステータスイベントに必要な全readが完了した後のwrite phaseで`tx.delete`する。run更新、イベント、transition idempotency文書と同じFirestore transactionに含めた。
- `FirestoreTx`にはoptionalな`delete`を追加し、`transitionPhaseWithAdminSdk`だけがAdmin SDKの`transaction.delete`を提供する。他の既存adapterの変更は不要にした。
- `REFLECTION`は`ACTIVE_LESSON_RUN_STATUSES`に残るため、組織・reservationをreadせず、予約も返却しない。
- transition idempotency文書が存在するreplayは従来どおり最初のreadでreturnし、組織・reservationの再read、再delete、イベント再追加を行わない。
- `createLessonRunCallable`と`acceptInvitationCallable`で`Error('共有枠が不足しています')`を`HttpsError('resource-exhausted', ...)`へ変換する。
- transitionテストfakeの`delete`もwriteとして記録し、最初のset/delete後にgetすると失敗するwrite-after-read guardを維持した。

## TDD RED

変更前baselineとして次を実行し、`Test Files 3 passed`、`Tests 63 passed`を確認した。

```bash
cd functions && npx vitest run src/lessonRuns/phases/transitionPhase.test.ts src/lessonRuns/onCall.test.ts src/organizations/onCall.test.ts
```

production codeより先にterminal返却、REFLECTION維持、reservation不在、terminal replay、2つのCallable mappingのテストを追加し、同じcommandを実行した。exit code 1、`Test Files 3 failed`、`Tests 6 failed | 64 passed`だった。失敗はreservationが未読・未削除であることと、共有枯渇Errorが生のまま返ることに一致した。

## GREEN・検証

最小実装後、対象テストは`Test Files 3 passed`、`Tests 70 passed`となった。続けて次を実行した。

```bash
cd functions && npm run typecheck
cd functions && npm run lint
cd functions && npm test
```

すべてexit code 0。Functions全体は`Test Files 128 passed`、`Tests 1117 passed`だった。`git diff --check`もexit code 0。

## Firestore・Callable仕様確認

実装前にcontext7で`/googleapis/nodejs-firestore`と`/firebase/firebase-functions`の現行ドキュメントを確認した。read-write transactionでは全readをwriteより先に完了し、競合時はtransaction callback全体が再実行されること、`Transaction.delete(DocumentReference)`を同じtransactionのwriteとして利用できることを確認した。またCallableでは`HttpsError('resource-exhausted', message)`が正式なエラーコードであることを確認した。

## 要件対応テスト

- `RUNNING -> ABORTED`: deterministicな親共有予約を同一transactionで返却する。
- `REFLECTION -> COMPLETED`: deterministicな親共有予約を同一transactionで返却する。
- `RUNNING -> REFLECTION`: 予約を維持し、quota用組織文書もreadしない。
- reservation不在: deterministic pathはreadするがdeleteをenqueueしない。
- terminal replay: transition idempotencyで収束し、組織・reservationを再readせず、再delete・再event追加もしない。
- Callable mapping: LessonRun作成と教師招待受諾の共有枯渇をどちらも`resource-exhausted`へ変換する。

## 懸念事項

Task 3Cの指定範囲に既知の未解決事項はない。reservation削除はLessonRunのterminal更新と同一transactionのため、Task 3Bの教師suspend返却で報告されたsync後deleteの部分失敗問題はこの経路には存在しない。

---

# Task 3 Fix Round

## 対象範囲

- `functions/src/organizations/invitations.ts`
- `functions/src/organizations/invitations.test.ts`
- `functions/src/organizations/suspendMember.ts`
- `functions/src/organizations/suspendMember.test.ts`

レビュー指摘のCritical/Importantの2点だけを修正した。LessonRun、UI、未追跡の`.claude/`には変更を加えていない。

## 修正内容

- parent-school pathの`reserveTeacherSeatForInvitation`で、学校memberを再readした後、保証内でも保証超過でも、quota判定に必要な全read完了後に同一Firestore transaction内で`organizations/{schoolOrgId}/members/{teacherUid}`を`role: teacher`・`status: active`・`membershipVersion: 1`へmerge setするようにした。共有枯渇や各種validation errorではこのwriteに到達しない。既存active memberはtransaction冒頭で`alreadyActive: true`として収束し、後段のRTDB mirror syncは従来どおり呼び出される。
- invitation quota fakeにread-before-write guardとoptimistic transaction retryを追加し、保証内のmembership write、保証超過のreservation+membership同時write、同時受諾の片方だけのadmission/もう片方の`alreadyActive`を検証した。
- teacher suspend cleanupをFirestore transaction化し、member status・membershipVersionを再readして期待versionのsuspended teacherである場合だけ学校→deterministic reservationをreadし、全read後にdeleteするようにした。active化・version変更との競合では削除しない。
- suspend成功時はsuspend後の期待versionをcleanupへ渡し、既にsuspendedのteacherの再試行もcleanupを先に試みてから既存の`このメンバーは既に解除されています`を返す。cleanup失敗時は失敗を返して次回再試行可能にした。

## TDD・検証

Context7で`/googleapis/nodejs-firestore`のread-before-write transaction、競合時callback retry、merge set、transaction deleteの現行仕様と、`/vitest-dev/vitest`のasync/concurrent assertion仕様を確認した。

失敗テスト追加後のREDでは、membership write不在、同時admissionの二重成功、already-suspended retry未実装、guarded cleanup未実装を確認した。修正後は次のすべてがexit code 0だった。

```bash
cd functions && npx vitest run src/organizations/invitations.test.ts src/organizations/suspendMember.test.ts
cd functions && npm run typecheck
cd functions && npm run lint
cd functions && npm test
cd .. && git diff --check
```

結果はfocused tests `2 files / 29 tests passed`、Functions全体 `128 files / 1122 tests passed`、typecheck/lint/diff checkはエラーなし。

---

# Task 3 Fix Round 2

## 対象範囲

- `functions/src/organizations/invitations.ts`
- `functions/src/organizations/invitations.test.ts`

レビュー指摘のうち、quota transaction 後の RTDB membership mirror 同期失敗で、PENDING 招待の再試行が同期を永続的に省略する問題だけを修正した。UI、LessonRun、`suspendMember`、未追跡の`.claude/`には変更を加えていない。

## 修正内容

- `reserveTeacherSeatForInvitation` が実際に teacher membership を active 化する transaction で、対象 invitation ID を `pendingMembershipSyncInvitationId` として同じ membership document に merge setするようにした。quota 枯渇、downgrade restriction、validation error、transaction 内の既存 active memberではこの admission markerを書かない。
- `acceptInvitation` は active membership の marker が現在の PENDING invitation IDと一致する場合だけ `syncMembership` を再実行し、同期成功後に招待を accepted として `ACCEPTED` で返す。markerのない genuinely pre-existing active memberは従来どおり `ALREADY_MEMBER` とし、quota exhaustion/downgrade の判定順序も維持した。
- Admin SDK adapter は markerを読み取り、teacher quota reservationへ invitation IDを渡すようにした。

## TDD・検証

production code変更前に再現テストを実行し、`Test Files 1 failed`、`Tests 1 failed | 18 passed`となった。失敗は2回目の受諾が`ALREADY_MEMBER`を返し、RTDB syncを省略するレビュー症状と一致した。

修正後、次を実行した。

```bash
cd functions && npm exec vitest run src/organizations/invitations.test.ts
cd functions && npm exec vitest run src/organizations/invitations.test.ts src/organizations/onCall.test.ts src/lessonRuns/onCall.test.ts
cd functions && npm run typecheck
cd functions && npm run lint
```

結果は invitation tests `1 file / 19 tests passed`、focused invitations/onCall tests `3 files / 72 tests passed`、Functions typecheck/lint はすべて exit code 0だった。

## Context7確認

実装前に Context7 で `/firebase/firebase-admin-node` の Firestore transaction API と `/vitest-dev/vitest` の async mock／`resolves`・`rejects`／focused test 実行仕様を確認した。
