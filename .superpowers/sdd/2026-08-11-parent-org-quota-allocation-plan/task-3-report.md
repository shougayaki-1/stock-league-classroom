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
