# AI ベータ Legacy Migration 運用手順 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `functions/src/ai/migrateLegacyBetaAccess.ts`(既に実装・テスト済み)を実運用で安全に使えるようにする。npm script として呼び出し可能にし、`status === 'APPROVED'` のみで許可判定する現行コードのデプロイより前に migration を実行する運用順序を、デザイン仕様書に具体的なコマンドとして固定する。最後にリポジトリ全体の verify を通し、ブランチを完了状態に到達させる。

**Architecture:** 変更なし。既存の `migrateLegacyAiBetaAccess(deps, { dryRun })`(`functions/src/ai/migrateLegacyBetaAccess.ts:30`)をラップする npm script を追加するだけであり、ロジックの変更は行わない。

**Tech Stack:** npm scripts、Node.js CLI(`firebase-admin` の Application Default Credentials)、Markdown ドキュメント。

## 背景

`docs/superpowers/specs/2026-08-15-ai-lesson-studio-beta-access-design.md` §14 は「migration と status-only gate のデプロイ順序を計画で明確にすること」を要求しているが、現時点でこれを満たすものが存在しない。

`codex/classroom` には既に次の状態がある(2026-08-15 時点、コミット `499f494` まで確認済み)。

- `functions/src/ai/betaAccess.ts` の `getAiBetaAccessApproved`/`assertAiBetaApproved` は `status === 'APPROVED'` のみを許可条件とする(ドキュメント存在だけでは許可しない)。
- `functions/src/ai/migrateLegacyBetaAccess.ts` は legacy な `aiBetaAccess/{uid}`(`status` フィールドなし、`approvedByUid`/`approvedAt` のみ)を scan し、Auth user 存在・`emailVerified`・`google.com` provider を満たすものだけ `APPROVED` へ backfill する CLI スクリプトとして実装・テスト済み(`--dry-run`/`--apply`)。
- しかし `functions/package.json` にはこのスクリプトを起動する npm script が存在せず、デプロイ手順書にも migration 実行の言及がない。

対象環境(本番・ステージング)の Firestore に `status` フィールドを持たない legacy `aiBetaAccess` レコードが1件でも存在する状態で、上記の status-only gate を含む functions/rules を先にデプロイすると、その教師は次回の AI 操作から `permission-denied` になる。これは §14 が防ごうとしている事態そのものであり、正しい順序を確立してから初めて安全にデプロイできる。

## Global Constraints

- 正本は `docs/superpowers/specs/2026-08-15-ai-lesson-studio-beta-access-design.md` §14。
- `migrateLegacyBetaAccess.ts` のロジックは変更しない(既にテスト済み・仕様どおり)。本計画は「呼び出し可能にする」「順序を文書化する」ことのみを対象にする。
- 全教師を暗黙許可しない。migration が `APPROVED` にするのは、既存の明示 grant record(`aiBetaAccess/{uid}` が存在し、Auth user が存在し、`emailVerified === true` かつ `providerData` に `providerId === 'google.com'` があるもの)だけである。この条件は `functions/src/ai/migrateLegacyBetaAccess.ts:65-72` に既に実装されている。
- migration は「既存コードの deploy 順序」の運用手順であり、コード上の gate 自体を弱めたり status 判定前の分岐を追加したりしない。
- 本番/ステージングの実データ件数確認、および実際の `--apply` 実行はこの計画の実装担当(他 AI/エンジニア)が対象環境の Firebase Admin 資格情報を用いて行う。ローカルの `demo-*` エミュレータ環境に実データは存在しないため、Task 2 の動作確認は「コマンドが正しく起動しエラーメッセージを返すこと」までとし、実データに対する `--apply` はこの計画の対象外(運用担当が別途、対象環境で実行する)。
- 全検証(`npm run lint`、`npm run typecheck`、`npm test`、`npm run test:rules`、`npm run build`、`npm run verify --workspace=functions`、リポジトリの `npm run verify`)が PASS すること。
- 実装完了時は `git push origin codex/classroom` まで行う。

---

### Task 1: legacy migration の npm script を追加する

**Files:**
- Modify: `functions/package.json`
- Existing dependency: `functions/src/ai/migrateLegacyBetaAccess.ts`(変更しない)、`functions/src/ai/migrateLegacyBetaAccess.test.ts`(既存。green であることを確認するだけで新規テストは追加しない)

**Interfaces:**
- Consumes: `migrateLegacyAiBetaAccess(deps, { dryRun: boolean })`(`functions/src/ai/migrateLegacyBetaAccess.ts:30`)の CLI entrypoint(同ファイル182-206行目の `if (require.main === module)` ブロック)。シグネチャ変更なし。
- Produces: `functions/package.json` の `scripts` に `migrate:ai-beta-legacy:dry-run` / `migrate:ai-beta-legacy:apply` を追加する。Task 2 がこれらのコマンド名をそのまま消費する。

このタスクはロジック変更を伴わない運用整備のため、TDD(failing test → 実装 → pass)ではなく「既存テストの green 確認 → package.json 変更 → CLI 起動確認」の手順で進める。

- [ ] **Step 1: 既存の migration テストを実行し green であることを確認する**

Run: `npm test --workspace=functions -- migrateLegacyBetaAccess`
Expected: 4件の `it` がすべて PASS する。
- `scans legacy documents and counts eligible in dry-run without performing writes`
- `migrates eligible legacy document when apply is true`
- `skips already migrated records`
- `marks invalid auth user when user does not exist or lacks verified google provider`

- [ ] **Step 2: `functions/package.json` の `scripts` に migration 用コマンドを追加する**

`functions/package.json` の `"scripts"` オブジェクト内、既存の `"verify"` 行の直後に以下の2行を追加する:

```json
    "migrate:ai-beta-legacy:dry-run": "npm run build && node lib/ai/migrateLegacyBetaAccess.js --dry-run",
    "migrate:ai-beta-legacy:apply": "npm run build && node lib/ai/migrateLegacyBetaAccess.js --apply"
```

`"verify"` 行の末尾にカンマを追加し、JSON として妥当な形にすること。

- [ ] **Step 3: ビルドして CLI entrypoint が生成されることを確認する**

Run: `npm run build --workspace=functions`
Expected: エラーなく完了し、`functions/lib/ai/migrateLegacyBetaAccess.js` が生成される。

- [ ] **Step 4: 引数なし実行で usage エラーが正しく出ることを確認する**

Run: `node functions/lib/ai/migrateLegacyBetaAccess.js`
Expected: stderr に `Usage: node migrateLegacyBetaAccess.js [--dry-run | --apply]` が出力され、exit code が `1` になる。これは実データへアクセスしていない正常な usage エラーであり、失敗ではない。

- [ ] **Step 5: `--dry-run`/`--apply` の両方を同時指定した場合も正しく usage エラーになることを確認する**

Run: `node functions/lib/ai/migrateLegacyBetaAccess.js --dry-run --apply`
Expected: Step 4 と同じ usage エラーが出力される(`functions/src/ai/migrateLegacyBetaAccess.ts:187` の `(isDryRun && isApply)` 分岐)。

- [ ] **Step 6: 追加した npm script 自体が正しくラップされていることを確認する**

Run: `npm run migrate:ai-beta-legacy:dry-run --workspace=functions -- --help 2>&1 | tail -5` は実行しない(`--help` は未定義引数のため Step 4 と同じ usage エラーになるだけで無意味)。代わりに以下を実行する。

Run: `npm run migrate:ai-beta-legacy:dry-run --workspace=functions`
Expected: `npm run build` が実行された後、`node lib/ai/migrateLegacyBetaAccess.js --dry-run` が実行される。ローカル環境には `demo-*` の Firebase エミュレータ設定はあるが `GOOGLE_APPLICATION_CREDENTIALS` 等の実 Firebase Admin 資格情報は設定されていないため、Firestore への接続時にエラー(認証情報不足、または対象プロジェクトへの接続エラー)が出ることを確認する。これはコマンドの配線が正しく、実データに接続しようとしている証拠であり、ローカルでの想定挙動である。

- [ ] **Step 7: Commit**

```bash
git add functions/package.json
git commit -m "chore: add legacy AI beta access migration npm scripts"
```

---

### Task 2: デプロイ順序を設計仕様書に運用手順として明記する

**Files:**
- Modify: `docs/superpowers/specs/2026-08-15-ai-lesson-studio-beta-access-design.md`(§14 の末尾)

**Interfaces:**
- Consumes: Task 1 で追加した `migrate:ai-beta-legacy:dry-run` / `migrate:ai-beta-legacy:apply` コマンド名。
- Produces: なし(ドキュメントのみ)。

このタスクはコード変更を伴わないため、TDD ステップではなく確認・追記の手順とする。

- [ ] **Step 1: 現在の §14 の記述を確認する**

`docs/superpowers/specs/2026-08-15-ai-lesson-studio-beta-access-design.md` の「## 14. 既存 `aiBetaAccess` データの移行」セクション(526-539行目)を読み、末尾が次の一文で終わっていることを確認する:

```text
status-only gate を先に deploy して legacy explicit approval を意図せず失効させないよう、実装計画では migration/backfill と gate 切替の順序を明示する。
```

- [ ] **Step 2: 具体的な運用コマンド手順を §14 の末尾に追記する**

上記の一文の直後に、以下のサブセクションを追加する:

```markdown
### 14.1 運用手順(2026-08-15 追記)

`functions/src/ai/betaAccess.ts` の `assertAiBetaApproved`/`getAiBetaAccessApproved` は既に `status === 'APPROVED'` のみを許可条件として実装済みである(ドキュメント存在だけでは許可しない)。したがって、対象環境(本番・ステージング)へこの状態のコードを含む functions/Firestore Rules/Storage Rules をデプロイする前に、必ず次の順序を守る。

1. functions をビルドする。

   ```bash
   npm run build --workspace=functions
   ```

2. 対象環境の Firebase Admin 資格情報で dry-run を実行し、内容を確認する。

   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=<対象環境のサービスアカウントキー> \
     npm run migrate:ai-beta-legacy:dry-run --workspace=functions
   ```

   出力される `scanned`/`alreadyMigrated`/`eligible`/`invalidAuthUser` の件数を確認する。`eligible` が 0 件であれば、対象環境に status-only gate 切替前の legacy record は存在しないため、Step 3 の `--apply` は不要でそのまま Step 4 へ進んでよい。

3. `eligible` が 1 件以上あり、内容に問題がなければ apply を実行する。

   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=<対象環境のサービスアカウントキー> \
     npm run migrate:ai-beta-legacy:apply --workspace=functions
   ```

   出力される `migrated` 件数が Step 2 で確認した `eligible` 件数と一致することを確認する。

4. Step 2 または Step 3 が完了してから初めて、status 判定のみで許可する functions のデプロイを実行する。

   ```bash
   firebase deploy --only functions,firestore:rules,storage
   ```

この順序を逆にする(migration より先に status-only gate を含むコードをデプロイする)と、legacy record を持つ既存の明示許可教師が、migration 実行前の期間だけ `permission-denied` で AI 機能を拒否される。
```

- [ ] **Step 3: 追記内容が既存の設計判断(§2〜§13)と矛盾しないことを目視で確認する**

特に次の2点を確認する。
- §2.4(権限の正本は `aiBetaAccess/{uid}` の `status`)と矛盾しないこと。
- §14 本文(全教師を暗黙許可しない、eligible なものだけ backfill する)と、追記した運用手順が一致していること(手順自体は `migrateLegacyAiBetaAccess` の既存ロジックを呼び出すだけで、対象選定条件を変更していない)。

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-15-ai-lesson-studio-beta-access-design.md
git commit -m "docs: document the legacy AI beta access migration deploy order"
```

---

### Task 3: 対象環境の legacy record 件数確認を運用担当へ引き継ぐ

**Files:**
- No source files。運用引き継ぎのみ。

**Interfaces:**
- Consumes: Task 1 の npm script、Task 2 の運用手順書。
- Produces: なし。

このタスクはコードを書く担当(他 AI)の作業範囲外である。対象環境の Firebase Admin 資格情報や Firestore Console へのアクセスは、この計画を実装する AI/エンジニアの権限では行えないことが前提のため、次を明文化するだけに留める。

- [ ] **Step 1: 引き継ぎ事項を確認する**

以下を、この計画の実装完了報告に含める(コードや自動化は不要、報告に文章で記載する)。

```text
対象環境(本番/ステージング)の Firestore で `aiBetaAccess` コレクションの
ドキュメント件数、および `status` フィールドを持たないドキュメントの有無を
確認する必要がある。確認方法の例:

- Firebase Console の Firestore データビューアで `aiBetaAccess` コレクションを開き、
  `status` フィールドがないドキュメントを目視確認する。
- または `npm run migrate:ai-beta-legacy:dry-run --workspace=functions`
  (対象環境の資格情報付き)を実行し、`eligible` 件数を確認する。

`eligible` が1件でもあれば、Task 2 の手順に従い、functions/Rules デプロイの
前に `migrate:ai-beta-legacy:apply` を実行すること。
```

- [ ] **Step 2: 実装完了報告にこの引き継ぎ事項を明記する**

このタスクに「Commit」はない(コード変更なし)。Task 4(最終検証)の報告に、このテキストをそのまま含めること。

---

### Task 4: 最終検証とブランチの完了確認

**Files:**
- No new source files。
- No modify(Task 1/2 の変更に対する検証のみ)。

**Interfaces:**
- Consumes: Task 1〜3 の成果物すべて。
- Produces: なし(最終検証)。

このタスクはコード変更を伴わない検証タスクのため、TDD ステップではなく検証チェックリストとして進める。

- [ ] **Step 1: functions のユニットテストを実行する**

Run: `npm test --workspace=functions`
Expected: `functions/src/ai/migrateLegacyBetaAccess.test.ts` を含め全件 PASS(Task 1 では `migrateLegacyBetaAccess.ts` 自体を変更していないため、既存の PASS 状態が維持されていることの確認)。

- [ ] **Step 2: lint・typecheck・build を実行する**

```bash
npm run lint --workspace=functions
npm run typecheck --workspace=functions
npm run build --workspace=functions
```

Expected: いずれもエラーなし。`package.json` への2行追加のみのため、TypeScript のコンパイル対象に影響はないはずである。

- [ ] **Step 3: functions の verify を実行する**

Run: `npm run verify --workspace=functions`
Expected: lint・typecheck・test・build すべて PASS。

- [ ] **Step 4: リポジトリ全体の verify を実行する**

Run: `npm run verify`
Expected: ルートの `verify` スクリプト(lint → typecheck → test → test:rules → test:market-concurrency → build → 各 workspace の verify)がすべて PASS。

- [ ] **Step 5: 変更差分がドキュメントと `functions/package.json` のみであることを確認する**

Run: `git diff --stat HEAD~2` (Task 1・Task 2 の2コミット分)
Expected: `functions/package.json` と `docs/superpowers/specs/2026-08-15-ai-lesson-studio-beta-access-design.md` の2ファイルのみが変更されている。アプリケーションロジック(`functions/src/`、`src/`)への変更は含まれない。

- [ ] **Step 6: push する**

```bash
git push origin codex/classroom
```

- [ ] **Step 7: Task 3 の引き継ぎ事項を実装完了報告に含める**

Task 3 Step 1 のテキストをそのまま実装完了報告に記載し、対象環境での legacy record 確認と(必要な場合の)`--apply` 実行が運用担当側のタスクとして残っていることを明示する。

---

## Task 間の並列性

**並列実行可能:**
- Task 1(npm script 追加)と Task 2(ドキュメント追記)は異なるファイルを編集するため並列実行できるが、Task 2 の文中に Task 1 で追加したコマンド名(`migrate:ai-beta-legacy:dry-run`/`migrate:ai-beta-legacy:apply`)を正確に引用する必要があるため、Task 1 の Step 2 完了後に Task 2 の Step 2 を書き始めることを推奨する(厳密な直列は不要、コマンド名だけ先に確定させればよい)。

**直列実行が必要:**
- Task 3 はコード変更を伴わないため他タスクと独立しているが、内容は Task 1/2 の成果物を前提にした引き継ぎ文なので、Task 1・Task 2 完了後に書くこと。
- Task 4(最終検証)は Task 1〜3 すべて完了後にのみ実行する。

推奨実行順序: Task 1 → Task 2 → Task 3 → Task 4。
