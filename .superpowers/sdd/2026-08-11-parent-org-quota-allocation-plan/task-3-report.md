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
