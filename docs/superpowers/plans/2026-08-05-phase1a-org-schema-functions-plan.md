# Phase 1.1〜1.3: 組織の器・LessonTemplate v2・Cloud Functions基盤 Implementation Plan

> **この計画は Phase A の素材として大部分が有効。ただし単独で実行しない。**
>
> 統合仕様書の Phase A が後継であり、そちらの計画を参照すること。本計画のうち組織の器、`orgId` のルール強制、教材版の不変性、draft/version 分離、Functions 基盤、`pricingCore` の共有はそのまま引き継がれる。
>
> 一方、次は統合仕様書により不要または変更となる。
>
> - v1 → v2 変換関数（既存利用者がいないため不要）
> - v1/v2 を同一コレクションで扱う暫定策（新モデルでゼロから開始するため不要）
> - `LessonRun`、イベントログ、チェックポイントが Phase A の範囲に追加される

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** すべてのFirestore/RTDBドキュメントに `orgId`/`createdByUid` を導入してルールで強制し（1.1）、`schemaVersion` 付きの LessonTemplate v2 とバージョン管理構造を定義し（1.2）、Cloud Functions基盤とクライアント/サーバー共有の価格計算モジュールを整備する（1.3）。UIは一切変更しない。ラウンド進行・一括約定・需給連動・振り返り（1.4〜1.6）はこの計画の範囲外。

**Architecture:** 個人組織は決定的ID `organizations/personal_{uid}` を持ち、クライアントからは作成できない。IDがuidから純粋に導出できることを利用し、Firestore/RTDBのセキュリティルールは他コレクションを読まずに `orgId == 'personal_' + auth.uid` を直接検証する。組織作成自体は冪等な Cloud Functions Callable（Admin SDK、`functions/`パッケージ）に集約するが、`orgId`/`createdByUid` を**既存ドキュメントへスタンプする側**（`createPersonalTemplate` や `createMarket` など）は、org作成Callableの完了を待たずに `personalOrgId(uid)` を同じ決定的関数でその場計算する。これにより「1.1のorgIdスタンプ機能」と「1.1が要求するCallable基盤」を分離でき、1.3で新設予定だった `functions/` パッケージの最小部分（Blaze移行・パッケージ雛形・デプロイ配線）だけを1.1より前に前倒しする（詳細は「順序の矛盾の解決」を参照）。LessonTemplate v2は既存の `TemplateSpec`（v1）と共存し、`schemaVersion` で判別する。`pricingCore` の丸め・クランプ関数は `functions/` と `src/` の双方から同一の出力を返すことをテストで保証する。

**Tech Stack:** TypeScript, Firebase Firestore/RTDB（セキュリティルール）, Firebase Admin SDK (`firebase-admin`), Cloud Functions for Firebase v2 API (`firebase-functions/v2/https`), npm workspaces, `@firebase/rules-unit-testing`（Rules Emulator）, Vitest, Firebase modular client SDK.

## 順序の矛盾の解決（このドキュメントの前提）

設計（`docs/superpowers/specs/2026-08-05-lesson-platform-roadmap-design.md:99`）は「個人組織はクライアントから作らせない。…冪等な Callable Function またはAuth起点のサーバー処理で作成する」と明記する一方、`functions/` パッケージの新設は同ドキュメント1.3（`:623`）に置かれている。現状 `functions/` ディレクトリは存在せず、`firebase.json`（本リポジトリで確認済み）にも `functions` セクションがない。

**採用する選択肢: (a) Functions基盤の新設だけを1.1より前へ移す。**

理由:

- (b)（クライアントの決定的IDトランザクションで暫定作成し、後でFunctionsへ移行）は、設計が明確に「クライアントから作らせない」と否定している運用を、期間の定めなく本番で走らせることになる。多重ログイン・通信再試行による重複組織作成という、設計が名指しした失敗モードを1.1〜1.3の間ずっと許容するのは、後回しにする理由（実装の都合）に対してリスクが見合わない。
- (c)（1.1と1.3を丸ごと入れ替える）は不要に大きい。1.3の本体（`pricingCore` の共有、価格秘匿、丸め処理の固定）は `rounds`/`events` スキーマ（1.2）に依存する記述が設計にあり（`design.md:1.3の依存関係についてはmaster-roadmap-plan.md:66`「pricingCore共有もここで固定」は1.2のスキーマ確定後を前提）、1.2より前に持ってくる理由がない。一方、Functions基盤そのもの（Blazeプラン移行、`functions/`パッケージの雛形、デプロイ配線）は1.2のスキーマに一切依存しない、純粋なインフラ作業である。
- したがって、1.3の中身を「1.2に依存する部分（`pricingCore`共有・丸め処理固定）」と「依存しない部分（Blaze移行・`functions/`雛形・デプロイ配線）」に分割し、後者だけを本計画の Task 1 として1.1より前に置く。1.3という番号自体は据え置き、Task 15〜19で残りを実施する。

この結果、本計画のタスク順序は次のようになる。

```
Task 1   Functions基盤の最小ブートストラップ（1.3の一部を前倒し）
  ↓
Task 2〜8   1.1 組織の器（orgId/createdByUidの導入とルール強制）
  ↓
Task 9〜14  1.2 LessonTemplate v2 スキーマとバージョン管理
  ↓
Task 15〜19 1.3 の残り（pricingCore共有、丸め処理固定、Blaze本番移行、serverTimeOffset確認）
```

## Global Constraints

- 各タスクは完了時に `npm run verify`（`lint` → `typecheck` → `test` → `test:rules` → `build`、`package.json`）を通すこと。Task 1以降は `functions/` 独自の検証（`npm run verify --workspace=functions`）も `verify` に組み込む。
- **UIは変更しない。** `src/components/` 配下のコンポーネントへの変更はゼロ件であること（テストファイル・型・リポジトリ関数・ルールのみ変更する）。
- 1.4以降（ラウンド進行、`settleRound`、一括約定、需給連動、銘柄別ニュース、個人予想・振り返り）は本計画に含めない。
- 組織のUI（招待、メンバー管理画面）はPhase 5。本計画では実装しない。ただし個人組織作成Callableの**呼び出し配線**（教師サインイン時に裏で叩く処理）はUIではなく認証フローの一部として1.1に含む。
- `orgId` は作成時にそのユーザーの正しい個人組織IDでなければならず、通常の更新で変更できない。`createdByUid` は `request.auth.uid` でなければならず、変更できない（`design.md:482-485`）。対象は テンプレートとそのバージョン／市場（Firestore `markets` と RTDB `liveMarkets/{marketId}/meta`）／授業結果。対象外は `officialTemplates`／`serviceStatus`／`templateShares`／`marketJoinCodes`（`design.md:488-503`）。
- 決定的ID `organizations/personal_{uid}` はどの層（クライアント、Functions、Firestore/RTDBルール）でも同じ文字列連結 `'personal_' + uid` で計算する。フォーマットを変えるときは3箇所すべてを同時に直す。
- `revokeRefreshTokens` は組織削除で使わない。本計画は組織の停止・削除機能自体を実装しないため、この制約は将来のPhase 5実装者向けの申し送りとして明記するに留める。
- 個人組織は常にメンバー1名（owner）。本計画では `orgAccess/{orgId}/{uid}` RTDBミラーの**書き込み**（Callable内、Admin SDK）は設計のCallable疑似コードどおり実施するが、**このミラーを読むRTDBルールは1.1では追加しない**（個人組織の所属判定は `'personal_' + auth.uid` の文字列比較だけで完結し、`orgAccess` を読む必要がないため）。複数メンバー組織（学校組織）が現れるPhase 5で、初めてルールが `orgAccess` を参照するようになる。

---

## File Structure

| File | Change |
| --- | --- |
| `functions/package.json`, `functions/tsconfig.json`, `functions/src/index.ts` | 新規。Cloud Functionsパッケージの雛形。 |
| `functions/src/lib/personalOrgId.ts` | 新規。`personalOrgId(uid)` の純粋関数（`src/lib/org/personalOrgId.ts` と同じ実装を独立して保持）。 |
| `functions/src/organizations/personalOrg.ts` | 新規。`ensurePersonalOrg(uid)` — 個人組織・メンバー・`users/{uid}.personalOrgId` をFirestoreトランザクションで冪等作成し、RTDB `orgAccess` ミラーを書く。 |
| `functions/src/organizations/onCall.ts` | 新規。`ensurePersonalOrgCallable` — `ensurePersonalOrg` を呼ぶ `onCall` ハンドラ。教師判定を行う。 |
| `functions/src/pricing/` | 1.3で新設。`src/lib/pricing/pricingCore.ts` の丸め/クランプ関数を共有するための配置先（Task 15で確定）。 |
| `package.json` | `workspaces: ["functions"]` を追加。`verify` スクリプトが `functions` の検証を含むよう更新。 |
| `firebase.json` | `functions` セクション（`source: "functions"`）、`emulators.functions` を追加。 |
| `src/lib/org/personalOrgId.ts` | 新規。クライアント側の `personalOrgId(uid)`（`functions/src/lib/personalOrgId.ts` と同一実装）。 |
| `src/lib/org/ensurePersonalOrg.ts` | 新規。`httpsCallable(functions, 'ensurePersonalOrgCallable')` を呼ぶクライアントラッパー。 |
| `src/lib/firebase/firebaseConfig.ts` | `getFunctionsService()` を追加。 |
| `src/lib/firebase/useEmulators.ts` | Functionsエミュレータへの接続を追加。 |
| `src/lib/firebase/bootstrap.ts` | 教師サインイン確定後に `ensurePersonalOrg` を一度叩く配線を追加（UIなし）。 |
| `firestore.rules` | `users/{uid}`・`organizations/{orgId}`・`organizations/{orgId}/members/{uid}` を追加。`templates`・`markets`・`marketResults/*/participants`・`marketResults/*/teams` の create/update ルールへ `orgId`/`createdByUid` 検証を追加。テンプレートversionsのルールを追加（1.2）。 |
| `database.rules.json` | `liveMarkets/{marketId}/meta` に `orgId`/`createdByUid` の `.validate` を追加。トップレベルに `orgAccess/{orgId}/{uid}`（`.write: false`）を追加。 |
| `src/lib/templates/templateRepository.ts` | `createPersonalTemplate`・`duplicatePersonalTemplate` が `orgId`/`createdByUid` をスタンプするよう変更。 |
| `src/lib/market/marketRepository.ts` | `createMarket`（Firestore `markets` ドキュメント）と `initialLiveState`（RTDB `meta`）が `orgId`/`createdByUid` をスタンプするよう変更。`recoverMarketCreation` の整合性チェックへ `orgId` を追加。 |
| `src/lib/market/hostTrading.ts` | `finalizeEnding` が `marketResults` の `teams`/`participants` ドキュメントへ `orgId`/`createdByUid` をスタンプするよう変更。 |
| `src/lib/templates/v2/types.ts` | 新規。`LessonTemplateContentV2`、`TemplateVersionV2`、`TemplateV2Envelope` などv2型定義（1.2）。 |
| `src/lib/templates/v2/convertV1ToV2.ts` | 新規。v1 `TemplateSpec` → v2変換関数（1.2）。 |
| `src/lib/templates/v2/officialSeedsV2.ts` | 新規。既存3公式テンプレートのv2変換済みシード（1.2）。 |
| `src/lib/templates/v2/templateVersionRepository.ts` | 新規。draft保存・版作成・公開版切り替えのFirestore操作（1.2）。 |
| `test/database.rules.test.ts`、`test/firestore.rules.test.ts`、`test/classroom-flow.rules.test.ts` | 新規ケース追加。 |
| 各新規 `.ts` に対応する `.test.ts` | TDDで先に書く。 |

---

## Task 1: Functions基盤の最小ブートストラップ

**Files:**
- Create: `functions/package.json`, `functions/tsconfig.json`, `functions/.gitignore`, `functions/src/index.ts`, `functions/src/ping.ts`, `functions/src/ping.test.ts`
- Modify: `package.json`（`workspaces`、`verify`）, `firebase.json`（`functions`、`emulators.functions`）

**Interfaces:**
- Produces: `functions/src/index.ts` が `export * from './ping'` する形で、後続タスクが `export * from './organizations/onCall'` を追記できる構造にする。
- Produces: `functions/package.json` の `scripts.verify` = `"npm run lint && npm run typecheck && npm test && npm run build"`（`functions/` 単体で完結）。

- [ ] **Step 1: Blazeプランへの移行を実施する（手動、本番プロジェクト）**

これは `gcloud`/Firebaseコンソールでの手動操作であり、コードでは自動化できない。実施者は次を行い、実施日と担当者をこのチェックボックスの下にメモとして残すこと。

1. Firebaseコンソール → 対象プロジェクト（`.firebaserc` の `default: "oss-stock-league"`）→ 使用量と請求 → プランをBlazeへアップグレード
2. Google Cloud Console → 請求先アカウント → 予算とアラート → 新しい予算を作成し、しきい値（例: 50%/90%/100%）でメール通知を設定
3. 予算アラートの通知先メールアドレスと、しきい値の設定値をこのファイルまたはチームの運用メモに記録する

> 完了条件チェック用: `gcloud billing budgets list --billing-account=<ACCOUNT_ID>` で予算が1件以上表示されること。

- [ ] **Step 2: 既存の `test:rules` が今後もFunctionsを含まず実行できることを確認する**

Run: `npm run test:rules`
Expected: 既存どおり成功（`firebase emulators:exec --only firestore,database` が `functions` を含まないため、今の段階では無関係のまま）。

- [ ] **Step 3: `functions/package.json` を作成する**

```json
{
  "name": "functions",
  "private": true,
  "version": "0.0.0",
  "type": "commonjs",
  "engines": { "node": "20" },
  "main": "lib/index.js",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "lint": "oxlint src",
    "test": "vitest run",
    "verify": "npm run lint && npm run typecheck && npm test && npm run build"
  },
  "dependencies": {
    "firebase-admin": "^13.0.0",
    "firebase-functions": "^6.0.0"
  },
  "devDependencies": {
    "oxlint": "^1.71.0",
    "typescript": "~6.0.2",
    "vitest": "^4.1.10"
  }
}
```

- [ ] **Step 4: `functions/tsconfig.json` を作成する**

Cloud Functionsのデフォルトランタイム（Node 20, CommonJS）に合わせ、アプリ側（`tsconfig.app.json`、ESNext/bundler）とは独立させる。

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "outDir": "lib",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "sourceMap": true
  },
  "include": ["src"],
  "compileOnCommit": false
}
```

- [ ] **Step 5: `functions/.gitignore` を作成する**

```
lib/
node_modules/
*.local
```

- [ ] **Step 6: スモークテスト用の `ping` Callable を書く（動作確認のみが目的、TDD）**

`functions/src/ping.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { pingPayload } from './ping'

describe('pingPayload', () => {
  it('returns a fixed ok payload', () => {
    expect(pingPayload()).toEqual({ ok: true })
  })
})
```

- [ ] **Step 7: テストが失敗することを確認する**

Run: `cd functions && npx vitest run src/ping.test.ts`
Expected: FAIL — `pingPayload is not a function` もしくは `Cannot find module './ping'`

- [ ] **Step 8: `functions/src/ping.ts` を実装する**

```ts
import { onCall } from 'firebase-functions/v2/https'

export const pingPayload = (): { ok: true } => ({ ok: true })

export const ping = onCall({ region: 'asia-northeast1' }, () => pingPayload())
```

- [ ] **Step 9: `functions/src/index.ts` を作成する**

```ts
import { initializeApp } from 'firebase-admin/app'

initializeApp()

export { ping } from './ping'
```

- [ ] **Step 10: テストが通ることを確認する**

Run: `cd functions && npx vitest run src/ping.test.ts`
Expected: PASS

- [ ] **Step 11: `functions/` 単体のビルドを確認する**

Run: `cd functions && npm install && npm run build`
Expected: `functions/lib/index.js` と `functions/lib/ping.js` が生成される。

- [ ] **Step 12: ルートの `package.json` に `workspaces` を追加する**

```json
{
  "name": "stock-league-classroom",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "workspaces": ["functions"],
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "typecheck": "tsc -b && tsc -p tsconfig.rules.json",
    "lint": "oxlint",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:rules": "firebase emulators:exec --project demo-stock-league-classroom --only firestore,database \"vitest --config vite.rules.config.ts run\"",
    "verify": "npm run lint && npm run typecheck && npm test && npm run test:rules && npm run build && npm run verify --workspace=functions"
  }
}
```

（`dependencies`/`devDependencies` は既存のまま変更しない。）

- [ ] **Step 13: ルートから `npm install` を実行し、workspaceのシンボリックリンクが解決することを確認する**

Run: `npm install`
Expected: `node_modules/functions -> functions` のシンボリックリンクが作成され、エラーなく完了する。

- [ ] **Step 14: `firebase.json` に `functions` と `emulators.functions` を追加する**

```json
{
  "hosting": { "...": "変更なし" },
  "firestore": { "rules": "firestore.rules" },
  "database": { "rules": "database.rules.json" },
  "functions": [{ "source": "functions", "codebase": "default", "predeploy": ["npm --prefix \"$RESOURCE_DIR\" run build"] }],
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "database": { "port": 9000 },
    "functions": { "port": 5001 },
    "hosting": { "port": 5000 },
    "ui": { "enabled": true }
  }
}
```

（既存の `hosting` セクションはそのまま維持する。）

- [ ] **Step 15: Functionsエミュレータが `ping` を提供できることを確認する**

Run: `firebase emulators:start --only functions,firestore,auth`
その後、別ターミナルで Emulator UI（`http://localhost:4000/functions`）から `ping` が一覧に表示されることを目視確認する。

- [ ] **Step 16: `npm run verify` を通す**

Run: `npm run verify`
Expected: 既存の `lint`/`typecheck`/`test`/`test:rules`/`build` に加え、`functions` の `verify`（`lint`/`typecheck`/`test`/`build`）もすべて成功する。

- [ ] **Step 17: Commit**

```bash
git add functions package.json firebase.json
git commit -m "build: scaffold functions/ workspace with a smoke-test callable"
```

---

## Task 2: `personalOrgId` 純粋関数（クライアント・Functions両方）

**Files:**
- Create: `src/lib/org/personalOrgId.ts`, `src/lib/org/personalOrgId.test.ts`
- Create: `functions/src/lib/personalOrgId.ts`, `functions/src/lib/personalOrgId.test.ts`

**Interfaces:**
- Produces: `personalOrgId(uid: string): string` — 両ファイルで同一実装。以降のすべてのタスクがこの関数を使う。フォーマットは `personal_${uid}`（`design.md:102`）。

- [ ] **Step 1: クライアント側の失敗するテストを書く**

```ts
import { describe, expect, it } from 'vitest'
import { personalOrgId } from './personalOrgId'

describe('personalOrgId', () => {
  it('prefixes the uid with personal_', () => {
    expect(personalOrgId('abc123')).toBe('personal_abc123')
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/org/personalOrgId.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

```ts
/**
 * The personal organization id is fully deterministic from the uid, matching
 * firestore.rules and database.rules.json's `'personal_' + auth.uid` checks
 * and functions/src/lib/personalOrgId.ts. Change the format in all three
 * places at once.
 */
export const personalOrgId = (uid: string): string => `personal_${uid}`
```

- [ ] **Step 4: 通過を確認する**

Run: `npx vitest run src/lib/org/personalOrgId.test.ts`
Expected: PASS

- [ ] **Step 5: `functions/` 側にも同じテスト・実装を作る**

`functions/src/lib/personalOrgId.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { personalOrgId } from './personalOrgId'

describe('personalOrgId', () => {
  it('prefixes the uid with personal_', () => {
    expect(personalOrgId('abc123')).toBe('personal_abc123')
  })
})
```

`functions/src/lib/personalOrgId.ts`:

```ts
/** Mirrors src/lib/org/personalOrgId.ts and the rules' string-concat checks. */
export const personalOrgId = (uid: string): string => `personal_${uid}`
```

- [ ] **Step 6: 両方のテストを実行する**

Run: `npx vitest run src/lib/org/personalOrgId.test.ts && (cd functions && npx vitest run src/lib/personalOrgId.test.ts)`
Expected: 両方PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/org/personalOrgId.ts src/lib/org/personalOrgId.test.ts functions/src/lib/personalOrgId.ts functions/src/lib/personalOrgId.test.ts
git commit -m "feat: add deterministic personalOrgId helper (client + functions)"
```

---

## Task 3: 個人組織作成の冪等ロジック（`ensurePersonalOrg`）

**Files:**
- Create: `functions/src/organizations/personalOrg.ts`, `functions/src/organizations/personalOrg.test.ts`

**Interfaces:**
- Consumes: `personalOrgId` from Task 2 (`functions/src/lib/personalOrgId.ts`).
- Produces: `ensurePersonalOrg(uid: string): Promise<{ orgId: string; created: boolean }>` — Task 4 の `onCall` ハンドラから呼ばれる。

このロジックはFirestore Admin SDKの実インスタンスに依存するため、単体テストは `firebase-admin/firestore`/`firebase-admin/database` を薄いフェイクに差し替える形で書く（Rules Emulatorを介した結合確認はTask 4で行う）。

- [ ] **Step 1: 失敗するテストを書く（フェイクFirestore/RTDBで冪等性を検証）**

```ts
import { describe, expect, it, vi } from 'vitest'
import { ensurePersonalOrg } from './personalOrg'

const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    runTransaction: async (fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean }>
      set: (path: string, data: Record<string, unknown>) => void
    }) => Promise<boolean>) => fn({
      get: async (path: string) => ({ exists: docs.has(path) }),
      set: (path: string, data: Record<string, unknown>) => { docs.set(path, data) },
    }),
  }
}

describe('ensurePersonalOrg', () => {
  it('creates the org, membership, and users doc exactly once', async () => {
    const fake = makeFakeFirestore()
    const rtdbWrites: unknown[] = []
    const result = await ensurePersonalOrg('uid-1', {
      firestore: fake as never,
      writeOrgAccessMirror: async (payload) => { rtdbWrites.push(payload) },
    })
    expect(result).toEqual({ orgId: 'personal_uid-1', created: true })
    expect(fake.docs.get('organizations/personal_uid-1')).toMatchObject({ type: 'personal', ownerUid: 'uid-1' })
    expect(fake.docs.get('organizations/personal_uid-1/members/uid-1')).toMatchObject({ role: 'owner', status: 'active' })
    expect(fake.docs.get('users/uid-1')).toMatchObject({ personalOrgId: 'personal_uid-1' })
    expect(rtdbWrites).toEqual([{ orgId: 'personal_uid-1', uid: 'uid-1', role: 'owner', status: 'active', membershipVersion: 1 }])
  })

  it('is idempotent: a second call makes no further Firestore writes', async () => {
    const fake = makeFakeFirestore()
    const rtdbWrites: unknown[] = []
    const deps = { firestore: fake as never, writeOrgAccessMirror: async (payload: unknown) => { rtdbWrites.push(payload) } }
    await ensurePersonalOrg('uid-1', deps)
    const before = fake.docs.size
    const second = await ensurePersonalOrg('uid-1', deps)
    expect(second).toEqual({ orgId: 'personal_uid-1', created: false })
    expect(fake.docs.size).toBe(before)
    // The RTDB mirror is re-applied unconditionally on every call — that is
    // deliberately safe because it always writes the same values.
    expect(rtdbWrites).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/organizations/personalOrg.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

```ts
import { personalOrgId } from '../lib/personalOrgId'

export interface OrgAccessMirrorPayload {
  orgId: string
  uid: string
  role: 'owner'
  status: 'active'
  membershipVersion: number
}

interface FirestoreTransaction {
  get: (path: string) => Promise<{ exists: boolean }>
  set: (path: string, data: Record<string, unknown>) => void
}
export interface EnsurePersonalOrgDeps {
  firestore: { runTransaction: (fn: (tx: FirestoreTransaction) => Promise<boolean>) => Promise<boolean> }
  writeOrgAccessMirror: (payload: OrgAccessMirrorPayload) => Promise<void>
  now?: () => unknown
}
export interface EnsurePersonalOrgResult { orgId: string; created: boolean }

/**
 * Idempotent: Firestore is the system of record, so a retry after a partial
 * failure (e.g. the RTDB mirror write below fails) simply re-reads the
 * existing org and re-applies the same mirror values — never creates a
 * duplicate org, per design.md:99's "既に個人組織がある → 既存のorgIdを返す".
 */
export const ensurePersonalOrg = async (uid: string, deps: EnsurePersonalOrgDeps): Promise<EnsurePersonalOrgResult> => {
  const orgId = personalOrgId(uid)
  const orgPath = `organizations/${orgId}`
  const memberPath = `organizations/${orgId}/members/${uid}`
  const userPath = `users/${uid}`
  const nowValue = deps.now ? deps.now() : new Date().toISOString()

  const created = await deps.firestore.runTransaction(async (tx) => {
    const orgSnap = await tx.get(orgPath)
    if (orgSnap.exists) return false
    tx.set(orgPath, { type: 'personal', ownerUid: uid, createdAt: nowValue })
    tx.set(memberPath, { role: 'owner', status: 'active', joinedAt: nowValue })
    tx.set(userPath, { personalOrgId: orgId }, { merge: true } as never)
    return true
  })

  await deps.writeOrgAccessMirror({ orgId, uid, role: 'owner', status: 'active', membershipVersion: 1 })

  return { orgId, created }
}
```

（`tx.set(userPath, ..., { merge: true })` は上記フェイクのシグネチャと合わせるため3引数目を `as never` でスキップしているが、実装（Step 5）ではAdmin SDKの本来の型を使う。）

- [ ] **Step 4: テストを通す**

Run: `cd functions && npx vitest run src/organizations/personalOrg.test.ts`
Expected: PASS

- [ ] **Step 5: Admin SDKを使う本番用ラッパーを追加する**

同ファイルの末尾に追記する。

```ts
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { getDatabase } from 'firebase-admin/database'

/** Production wiring: Firestore Admin SDK + RTDB Admin SDK. */
export const ensurePersonalOrgWithAdminSdk = (uid: string): Promise<EnsurePersonalOrgResult> => {
  const db = getFirestore()
  return ensurePersonalOrg(uid, {
    firestore: {
      runTransaction: (fn) => db.runTransaction(async (tx) => fn({
        get: async (path) => ({ exists: (await tx.get(db.doc(path))).exists }),
        set: (path, data) => { tx.set(db.doc(path), path === `users/${uid}` ? data : { ...data, createdAt: FieldValue.serverTimestamp() }, { merge: true }) },
      })),
    },
    writeOrgAccessMirror: async (payload) => {
      await getDatabase().ref(`orgAccess/${payload.orgId}/${payload.uid}`).set({
        role: payload.role, status: payload.status, membershipVersion: payload.membershipVersion, revokedAtSeconds: 0,
      })
    },
    now: () => FieldValue.serverTimestamp(),
  })
}
```

- [ ] **Step 6: ビルドを確認する**

Run: `cd functions && npm run build`
Expected: 型エラーなくコンパイルされる。

- [ ] **Step 7: Commit**

```bash
git add functions/src/organizations
git commit -m "feat: add idempotent ensurePersonalOrg transaction logic"
```

---

## Task 4: `ensurePersonalOrgCallable` Callable と教師判定

**Files:**
- Create: `functions/src/organizations/onCall.ts`, `functions/src/organizations/onCall.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Consumes: `ensurePersonalOrgWithAdminSdk` from Task 3.
- Produces: `export const ensurePersonalOrgCallable` — an `onCall` handler, exported from `functions/src/index.ts`, callable from the client as `'ensurePersonalOrgCallable'`.

- [ ] **Step 1: 失敗するテストを書く（教師判定ロジックを純粋関数として分離してテストする）**

```ts
import { describe, expect, it } from 'vitest'
import { isCallerTeacher } from './onCall'

describe('isCallerTeacher', () => {
  it('accepts a verified google.com sign-in', () => {
    expect(isCallerTeacher({ email_verified: true, firebase: { sign_in_provider: 'google.com' } })).toBe(true)
  })
  it('rejects anonymous sign-in', () => {
    expect(isCallerTeacher({ firebase: { sign_in_provider: 'anonymous' } })).toBe(false)
  })
  it('rejects an unverified email', () => {
    expect(isCallerTeacher({ email_verified: false, firebase: { sign_in_provider: 'google.com' } })).toBe(false)
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/organizations/onCall.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

```ts
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { ensurePersonalOrgWithAdminSdk } from './personalOrg'

/** Mirrors src/lib/auth/roles.ts's isTeacherIdentity and firestore.rules' teacher(). */
export const isCallerTeacher = (token: { email_verified?: boolean; firebase?: { sign_in_provider?: string } }): boolean =>
  token.email_verified === true && token.firebase?.sign_in_provider === 'google.com'

export const ensurePersonalOrgCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  return ensurePersonalOrgWithAdminSdk(request.auth.uid)
})
```

- [ ] **Step 4: テストを通す**

Run: `cd functions && npx vitest run src/organizations/onCall.test.ts`
Expected: PASS

- [ ] **Step 5: `functions/src/index.ts` からエクスポートする**

```ts
import { initializeApp } from 'firebase-admin/app'

initializeApp()

export { ping } from './ping'
export { ensurePersonalOrgCallable } from './organizations/onCall'
```

- [ ] **Step 6: ビルドを確認する**

Run: `cd functions && npm run build`
Expected: 成功。

- [ ] **Step 7: Functionsエミュレータでエンドツーエンド確認する**

Run: `firebase emulators:start --only functions,firestore,database,auth`
別ターミナルから（Node REPLまたは一時スクリプトで）Auth Emulatorに教師トークン相当のユーザーを作り、`ensurePersonalOrgCallable` を叩き、Firestore/RTDB Emulator UIで `organizations/personal_<uid>`・`organizations/personal_<uid>/members/<uid>`・`users/<uid>`・`orgAccess/personal_<uid>/<uid>` が作成されることを目視確認する。

- [ ] **Step 8: Commit**

```bash
git add functions/src/organizations/onCall.ts functions/src/organizations/onCall.test.ts functions/src/index.ts
git commit -m "feat: expose ensurePersonalOrgCallable with teacher-only guard"
```

---

## Task 5: クライアント側のCallable呼び出し配線

**Files:**
- Create: `src/lib/org/ensurePersonalOrg.ts`, `src/lib/org/ensurePersonalOrg.test.ts`
- Modify: `src/lib/firebase/firebaseConfig.ts`, `src/lib/firebase/useEmulators.ts`, `src/lib/firebase/bootstrap.ts`, 対応する既存テスト

**Interfaces:**
- Produces: `getFunctionsService(): Functions`（`firebaseConfig.ts`）
- Produces: `ensurePersonalOrg(functions: Functions): Promise<{ orgId: string; created: boolean }>`（`src/lib/org/ensurePersonalOrg.ts`）
- Consumes: `bootstrap.ts` はサインイン確定後（teacher判定が真になった時点）にこれを一度呼ぶ。UIコンポーネントは変更しない。

- [ ] **Step 1: `firebaseConfig.ts` に `getFunctionsService` を追加する**

```ts
import { getFunctions, type Functions } from 'firebase/functions'
// 既存importに追記
export const getFunctionsService = (): Functions => getFunctions(getFirebaseApp(), 'asia-northeast1')
```

- [ ] **Step 2: `firebaseConfig.test.ts` の既存テストが壊れていないことを確認する**

Run: `npx vitest run src/lib/firebase/firebaseConfig.test.ts`
Expected: PASS（既存テストに変更なし、新規exportの追加のみ）

- [ ] **Step 3: `useEmulators.ts` にFunctionsエミュレータ接続を追加する**

```ts
import { connectFunctionsEmulator, type Functions } from 'firebase/functions'

export const connectToEmulators = (auth: Auth, firestore: Firestore, database: Database, functions: Functions): void => {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true })
  connectFirestoreEmulator(firestore, 'localhost', 8080)
  connectDatabaseEmulator(database, 'localhost', 9000)
  connectFunctionsEmulator(functions, 'localhost', 5001)
}
```

- [ ] **Step 4: `useEmulators.test.ts` を更新する**

既存テストが `connectToEmulators(auth, firestore, database)` を3引数で呼んでいる箇所を4引数（`functions` のフェイクを追加）に更新する。フェイクの型は既存の `auth`/`firestore`/`database` フェイクと同じパターンに揃える。

- [ ] **Step 5: テストを通す**

Run: `npx vitest run src/lib/firebase/useEmulators.test.ts`
Expected: PASS

- [ ] **Step 6: `src/lib/org/ensurePersonalOrg.ts` の失敗するテストを書く**

```ts
import { describe, expect, it, vi } from 'vitest'
import { ensurePersonalOrg } from './ensurePersonalOrg'

describe('ensurePersonalOrg', () => {
  it('calls the ensurePersonalOrgCallable callable and returns its result', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { orgId: 'personal_uid-1', created: true } })
    const result = await ensurePersonalOrg({ httpsCallable: () => callable } as never)
    expect(result).toEqual({ orgId: 'personal_uid-1', created: true })
    expect(callable).toHaveBeenCalledWith()
  })
})
```

- [ ] **Step 7: 失敗を確認する**

Run: `npx vitest run src/lib/org/ensurePersonalOrg.test.ts`
Expected: FAIL — module not found

- [ ] **Step 8: 実装する**

```ts
import { httpsCallable, type Functions } from 'firebase/functions'

export interface EnsurePersonalOrgResult { orgId: string; created: boolean }

export const ensurePersonalOrg = async (functions: Functions): Promise<EnsurePersonalOrgResult> => {
  const call = httpsCallable<void, EnsurePersonalOrgResult>(functions, 'ensurePersonalOrgCallable')
  const result = await call()
  return result.data
}
```

- [ ] **Step 9: テストを通す**

Run: `npx vitest run src/lib/org/ensurePersonalOrg.test.ts`
Expected: PASS

- [ ] **Step 10: `bootstrap.ts` に配線する（UIなし、サインイン確定後の裏処理として）**

`FirebaseServices` に `functions` を追加し、教師サインイン確定を検知するたびに冪等に呼べるようにする。呼び出し元のタイミング決定（`onAuthStateChanged` ハンドラ側）はこのタスクのスコープ外だが、呼び出せる関数自体は用意する。

```ts
import type { Functions } from 'firebase/functions'
import { getFunctionsService } from './firebaseConfig'
// ...
export interface FirebaseServices { app: FirebaseApp; auth: Auth; firestore: Firestore; database: Database; functions: Functions; appCheck?: AppCheck }
export interface FirebaseBootstrapDependencies {
  getServices: () => Omit<FirebaseServices, 'appCheck'>
  connectToEmulators: (auth: Auth, firestore: Firestore, database: Database, functions: Functions) => void
  initializeAppCheck: (app: FirebaseApp, env: Record<string, string | boolean | undefined>) => AppCheck | undefined
  startServerTimeSync?: (database: Database) => () => void
}
const defaultDependencies: FirebaseBootstrapDependencies = {
  getServices: () => ({ app: getFirebaseApp(), auth: getFirebaseAuth(), firestore: getFirestoreDb(), database: getRealtimeDb(), functions: getFunctionsService() }),
  connectToEmulators,
  initializeAppCheck,
  startServerTimeSync,
}

export const createFirebaseBootstrapper = (dependencies: FirebaseBootstrapDependencies = defaultDependencies) => {
  let initialized: FirebaseServices | undefined
  return (env: Record<string, string | boolean | undefined> = import.meta.env): FirebaseServices => {
    if (initialized) return initialized
    const services = dependencies.getServices()
    if (shouldUseEmulators(env)) dependencies.connectToEmulators(services.auth, services.firestore, services.database, services.functions)
    initialized = { ...services, appCheck: dependencies.initializeAppCheck(services.app, env) }
    dependencies.startServerTimeSync?.(initialized.database)
    return initialized
  }
}
export const bootstrapFirebase = createFirebaseBootstrapper()
```

- [ ] **Step 11: `bootstrap.test.ts` を更新する**

既存の `getServices`/`connectToEmulators` フェイクへ `functions` を追加する。`services.functions` が `connectToEmulators` に渡されることを検証するアサーションを1件追加する。

- [ ] **Step 12: テストを通す**

Run: `npx vitest run src/lib/firebase/bootstrap.test.ts`
Expected: PASS

- [ ] **Step 13: `npm run verify` を通す**

Run: `npm run verify`
Expected: 全体成功。

- [ ] **Step 14: Commit**

```bash
git add src/lib/firebase src/lib/org/ensurePersonalOrg.ts src/lib/org/ensurePersonalOrg.test.ts
git commit -m "feat: wire ensurePersonalOrg callable into the Firebase bootstrapper"
```

**Note:** 本タスクは「呼べる状態にする」までがスコープ。実際に `onAuthStateChanged` 相当のフローの**どこで**呼ぶか（サインイン成功直後、リダイレクト結果受信後など）は既存の `src/lib/auth/teacherAuth.ts` 呼び出し元（現状UIコンポーネント側）に依存し、UIを変更しない制約と衝突しない最小の1行追加であっても、呼び出し元の特定にはUIコンポーネントの調査が要る。次のタスクでルールを先に固め、呼び出し配線の最終接続はUI変更を伴わない箇所（例えば `teacherAuth.ts` の `getTeacherGoogleRedirectResult` 呼び出し直後、または既存の認証状態監視フック）を1.1完了条件の検証（Task 8）で確定する。

---

## Task 6: Firestoreルール — `users`・`organizations`・`organizations/{orgId}/members`

**Files:**
- Modify: `firestore.rules`, `test/firestore.rules.test.ts`

**Interfaces:**
- Consumes: `teacher()` 関数（既存）。
- Produces: 新しい `match` ブロック3つ。すべて `allow write: if false`（Admin SDKのみが書ける）。

- [ ] **Step 1: 失敗するルールテストを書く**

`test/firestore.rules.test.ts` に追記する。

```ts
describe('organization bootstrap Firestore rules', () => {
  it('lets a teacher read only their own personal org, member doc, and user doc', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'organizations', 'personal_teacher-a'), { type: 'personal', ownerUid: 'teacher-a' })
      await setDoc(doc(context.firestore(), 'organizations', 'personal_teacher-a', 'members', 'teacher-a'), { role: 'owner', status: 'active' })
      await setDoc(doc(context.firestore(), 'users', 'teacher-a'), { personalOrgId: 'personal_teacher-a' })
    })
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    const other = environment.authenticatedContext('teacher-b', teacherToken).firestore()
    await assertSucceeds(getDoc(doc(owner, 'organizations', 'personal_teacher-a')))
    await assertFails(getDoc(doc(other, 'organizations', 'personal_teacher-a')))
    await assertSucceeds(getDoc(doc(owner, 'organizations', 'personal_teacher-a', 'members', 'teacher-a')))
    await assertSucceeds(getDoc(doc(owner, 'users', 'teacher-a')))
    await assertFails(getDoc(doc(other, 'users', 'teacher-a')))
  })

  it('rejects any client write to organizations, members, or users', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await assertFails(setDoc(doc(owner, 'organizations', 'personal_teacher-a'), { type: 'personal', ownerUid: 'teacher-a' }))
    await assertFails(setDoc(doc(owner, 'organizations', 'personal_teacher-a', 'members', 'teacher-a'), { role: 'owner', status: 'active' }))
    await assertFails(setDoc(doc(owner, 'users', 'teacher-a'), { personalOrgId: 'personal_teacher-a' }))
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npm run test:rules`
Expected: FAIL — `organizations`/`users` に既存ルールがなく `{document=**} { allow read, write: if false }` にフォールバックするため、`get` も失敗する。

- [ ] **Step 3: `firestore.rules` に3ブロックを追加する**

`match /officialTemplates/{templateId} { ... }` の直前に挿入する。

```
    match /users/{uid} {
      // Set only by the ensurePersonalOrg Callable (Admin SDK). See design.md's
      // "個人組織はクライアントから作らせない".
      allow get: if teacher() && uid == request.auth.uid;
      allow list: if false;
      allow write: if false;
    }

    match /organizations/{orgId} {
      // Phase 1 scope is personal orgs only: membership is fully determined by
      // the deterministic id, so no get() against a members subcollection is
      // needed here. School orgs (Phase 5) will need a broader rule.
      allow get: if teacher() && orgId == 'personal_' + request.auth.uid;
      allow list: if false;
      allow write: if false;
    }

    match /organizations/{orgId}/members/{uid} {
      allow get: if teacher() && orgId == 'personal_' + request.auth.uid && uid == request.auth.uid;
      allow list: if false;
      allow write: if false;
    }
```

- [ ] **Step 4: テストを通す**

Run: `npm run test:rules`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add firestore.rules test/firestore.rules.test.ts
git commit -m "feat: add Firestore rules for personal org bootstrap collections"
```

---

## Task 7: 既存Firestoreドキュメントへの `orgId`/`createdByUid` 付与とルール強制

**Files:**
- Modify: `firestore.rules`, `test/firestore.rules.test.ts`, `src/lib/templates/templateRepository.ts`, `src/lib/templates/templateRepository.test.ts`, `src/lib/market/marketRepository.ts`, `src/lib/market/marketRepository.test.ts`, `src/lib/market/hostTrading.ts`, `src/lib/market/hostTrading.test.ts`

**Interfaces:**
- Consumes: `personalOrgId` from Task 2 (`src/lib/org/personalOrgId.ts`).

**重要な設計判断（本タスクのスコープを決める前提）:** 対象ドキュメントはすべて既に `ownerUid` フィールドを持ち、それは常に作成者のuidと一致する（Phase 1では組織間の教材共有・複製・移動が未実装のため）。したがって `orgId` は既存の `ownerUid` から `personalOrgId(ownerUid)` として純粋に導出でき、関数シグネチャへ新しい引数を追加する必要がない。**この導出は個人組織のみに成り立つ前提であり、Phase 5で学校組織が導入され「アクティブな組織」がuidから一意に決まらなくなった時点で、この導出はすべて崩れ、各呼び出し元に実際の `orgId` を明示的に渡す設計へ書き換える必要がある。** 本タスクではこの前提を各コード箇所にコメントで明記する。

- [ ] **Step 1: 失敗するルールテストを書く（`templates`）**

`test/firestore.rules.test.ts` の `describe('market Firestore rules', ...)` とは別に追記する。

```ts
describe('orgId/createdByUid enforcement on templates', () => {
  it('rejects template creation with a wrong orgId or createdByUid', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    const valid = { title: 't', description: '', startingCash: 10000, teams: [], companies: [], ownerUid: 'teacher-a', visibility: 'private', orgId: 'personal_teacher-a', createdByUid: 'teacher-a' }
    await assertSucceeds(setDoc(doc(owner, 'templates', 'ok'), valid))
    await assertFails(setDoc(doc(owner, 'templates', 'bad-org'), { ...valid, orgId: 'personal_teacher-b' }))
    await assertFails(setDoc(doc(owner, 'templates', 'bad-creator'), { ...valid, createdByUid: 'teacher-b' }))
  })

  it('rejects changing orgId or createdByUid on update', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    const valid = { title: 't', description: '', startingCash: 10000, teams: [], companies: [], ownerUid: 'teacher-a', visibility: 'private', orgId: 'personal_teacher-a', createdByUid: 'teacher-a' }
    await setDoc(doc(owner, 'templates', 'immutable'), valid)
    await assertFails(updateDoc(doc(owner, 'templates', 'immutable'), { orgId: 'personal_teacher-b' }))
    await assertFails(updateDoc(doc(owner, 'templates', 'immutable'), { createdByUid: 'teacher-b' }))
    await assertSucceeds(updateDoc(doc(owner, 'templates', 'immutable'), { title: 'renamed' }))
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npm run test:rules`
Expected: FAIL — 現行ルールは `orgId`/`createdByUid` を要求しないため `bad-org`/`bad-creator` の作成が成功してしまい、`assertFails` が失敗する。

- [ ] **Step 3: `firestore.rules` の `templates` マッチを更新する**

```
    match /templates/{templateId} {
      allow get: if teacher() && resource.data.ownerUid == request.auth.uid;
      allow list: if teacher() && resource.data.ownerUid == request.auth.uid;
      allow create: if teacher()
        && request.resource.data.ownerUid == request.auth.uid
        && request.resource.data.visibility == 'private'
        && request.resource.data.orgId == 'personal_' + request.auth.uid
        && request.resource.data.createdByUid == request.auth.uid;
      allow update: if teacher()
        && resource.data.ownerUid == request.auth.uid
        && request.resource.data.ownerUid == resource.data.ownerUid
        && request.resource.data.visibility == 'private'
        && request.resource.data.orgId == resource.data.orgId
        && request.resource.data.createdByUid == resource.data.createdByUid;
      allow delete: if teacher() && resource.data.ownerUid == request.auth.uid;
    }
```

- [ ] **Step 4: テストを通す**

Run: `npm run test:rules`
Expected: PASS（Step 1のテストのみ。既存のマーケット系テストは次のStepでまとめて直す。）

- [ ] **Step 5: `templateRepository.ts` を更新する**

```ts
import { personalOrgId } from '../org/personalOrgId'

export const createPersonalTemplate = async (db: Firestore, ownerUid: string, spec: TemplateSpec) => {
  const ref = await addDoc(personalTemplates(db), {
    ...asTemplateSpec(spec), ownerUid, visibility: 'private',
    orgId: personalOrgId(ownerUid), createdByUid: ownerUid,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  })
  return ref.id
}
```

（`duplicatePersonalTemplate` は `createPersonalTemplate` を呼ぶだけなので変更不要。`updatePersonalTemplate` はmerge更新で `orgId`/`createdByUid` に触れないため変更不要 — 既存の `ownerUid` 同様、ルールの `resource.data.orgId == resource.data.orgId` 比較は自動的に成立する。）

- [ ] **Step 6: `templateRepository.test.ts` の既存アサーションを更新する**

`createPersonalTemplate` の戻り値を検証している既存テストに、作成されたドキュメントが `orgId: 'personal_' + ownerUid` と `createdByUid: ownerUid` を持つことを確認するアサーションを追加する。

- [ ] **Step 7: テストを通す**

Run: `npx vitest run src/lib/templates/templateRepository.test.ts`
Expected: PASS

- [ ] **Step 8: `markets` コレクションの失敗するルールテストを書く**

```ts
describe('orgId/createdByUid enforcement on markets', () => {
  it('rejects market creation with a wrong orgId or createdByUid', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    const valid = { ownerUid: 'teacher-a', templateSnapshot: template, capacity: 80, visibility: 'private', joinCode: 'ZZZZZZ', creationStatus: 'CREATING', orgId: 'personal_teacher-a', createdByUid: 'teacher-a' }
    await assertSucceeds(setDoc(doc(owner, 'markets', 'ok'), valid))
    await assertFails(setDoc(doc(owner, 'markets', 'bad-org'), { ...valid, orgId: 'personal_teacher-b' }))
  })
})
```

- [ ] **Step 9: 失敗を確認し、`firestore.rules` の `markets` マッチを更新する**

```
    match /markets/{marketId} {
      allow get, list: if teacher() && resource.data.ownerUid == request.auth.uid;
      allow create: if teacher()
        && serviceOpen()
        && request.resource.data.ownerUid == request.auth.uid
        && request.resource.data.orgId == 'personal_' + request.auth.uid
        && request.resource.data.createdByUid == request.auth.uid
        && request.resource.data.capacity == 80
        && request.resource.data.joinCode is string
        && request.resource.data.joinCode.size() == 6
        && request.resource.data.creationStatus == 'CREATING';
      allow update: if teacher() && resource.data.ownerUid == request.auth.uid
        && request.resource.data.ownerUid == resource.data.ownerUid
        && request.resource.data.orgId == resource.data.orgId
        && request.resource.data.createdByUid == resource.data.createdByUid
        && request.resource.data.capacity == resource.data.capacity
        && request.resource.data.joinCode == resource.data.joinCode
        && request.resource.data.templateSnapshot == resource.data.templateSnapshot
        && request.resource.data.visibility == resource.data.visibility
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['creationStatus', 'initializedAt']);
      allow delete: if teacher() && resource.data.ownerUid == request.auth.uid;
    }
```

- [ ] **Step 10: 既存の `test/firestore.rules.test.ts` のマーケット作成テストを更新する**

既存テスト（例: 「lets a teacher create a code only for a market they own」内の `batch.set(doc(owner, 'markets', 'market-owned'), {...})`）に `orgId: 'personal_teacher-a'` と `createdByUid: 'teacher-a'` を追加する。同ファイル内の `beforeEach` でシードしている `market-a` のフィクスチャにも同フィールドを追加する。

- [ ] **Step 11: テストを通す**

Run: `npm run test:rules`
Expected: PASS

- [ ] **Step 12: `marketRepository.ts` を更新する**

```ts
import { personalOrgId } from '../org/personalOrgId'

export interface MarketRecord { id: string; ownerUid: string; orgId: string; createdByUid: string; templateSnapshot: TemplateSpec; capacity: number; visibility: MarketVisibility; joinCode: string; creationStatus: 'CREATING' | 'READY'; createdAt: unknown }

export const createMarket = async (firestore: Firestore, database: Database, input: CreateMarketInput): Promise<MarketCreationResult> => {
  const marketRef = doc(collection(firestore, 'markets'))
  let joinCode = ''
  let reserved = false
  for (let attempt = 0; attempt < 10 && !reserved; attempt += 1) {
    joinCode = normalizeCode(input.joinCode ?? generateJoinCode())
    const codeRef = doc(firestore, 'marketJoinCodes', joinCode)
    reserved = await runFirestoreTransaction(firestore, async (transaction) => {
      if ((await transaction.get(codeRef)).exists()) return false
      transaction.set(marketRef, {
        ownerUid: input.ownerUid, orgId: personalOrgId(input.ownerUid), createdByUid: input.ownerUid,
        templateSnapshot: structuredClone(input.template), capacity: MARKET_CAPACITY,
        visibility: input.visibility, joinCode, creationStatus: 'CREATING', createdAt: serverTimestamp(),
      })
      transaction.set(codeRef, { marketId: marketRef.id, ownerUid: input.ownerUid, createdAt: serverTimestamp() })
      return true
    })
    if (input.joinCode && !reserved) break
  }
  if (!reserved) throw new Error('参加コードを確保できませんでした。もう一度お試しください。')
  try { return await recoverMarketCreation(firestore, database, marketRef.id, { ...input, joinCode }) }
  catch (error) { throw new MarketCreationError(marketRef.id, joinCode, error) }
}
```

- [ ] **Step 13: `initialLiveState` を更新する（RTDB `meta` への `orgId`/`createdByUid` は次タスクで検証するが、生成はここで行う）**

```ts
export const initialLiveState = (input: CreateMarketInput) => ({
  meta: {
    ownerUid: input.ownerUid, orgId: personalOrgId(input.ownerUid), createdByUid: input.ownerUid,
    capacity: MARKET_CAPACITY, visibility: input.visibility, status: 'SETUP' as const,
    createdAtMillis: serverNow(), startingCash: input.template.startingCash,
    joinCode: normalizeCode(input.joinCode ?? ''), autoApprove: false,
  },
  teams: Object.fromEntries(input.template.teams.map((team) => [team.id, { id: team.id, name: team.name }])),
  companies: Object.fromEntries(input.template.companies.map((company) => [company.id, { id: company.id, name: company.name, symbol: company.symbol, basePrice: company.initialPrice, ...(company.pricePhases ? { phases: company.pricePhases } : {}) }])),
  teamPortfolios: Object.fromEntries(input.template.teams.map((team) => [team.id, { cash: input.template.startingCash, holdings: {}, updatedAtMillis: serverNow() }])),
})
```

- [ ] **Step 14: `recoverMarketCreation` の整合性チェックへ `orgId` を追加する**

```ts
export const recoverMarketCreation = async (firestore: Firestore, database: Database, marketId: string, input: CreateMarketInput): Promise<MarketCreationResult> => {
  const marketRef = doc(firestore, 'markets', marketId)
  const market = await getDoc(marketRef)
  if (!market.exists() || market.data().ownerUid !== input.ownerUid) throw new Error('Market recovery is not authorized')
  const joinCode = normalizeCode(String(market.data().joinCode ?? input.joinCode ?? ''))
  if (!joinCode) throw new Error('Market join code is missing')
  const codeRef = doc(firestore, 'marketJoinCodes', joinCode)
  const existingCode = await getDoc(codeRef)
  if (existingCode.exists() && existingCode.data().marketId !== marketId) throw new Error('Join code is already in use')
  if (!existingCode.exists()) await setDoc(codeRef, { marketId, ownerUid: input.ownerUid, createdAt: serverTimestamp() })
  const expected = initialLiveState(input)
  await runTransaction(ref(database, root(marketId)), (current: LiveMarketState | null) => {
    if (!current) return expected
    if (current.meta.ownerUid !== input.ownerUid || current.meta.orgId !== expected.meta.orgId || current.meta.capacity !== MARKET_CAPACITY || current.meta.visibility !== input.visibility) return
    return current
  })
  await updateDoc(marketRef, { creationStatus: 'READY', initializedAt: serverTimestamp() })
  return { marketId, joinCode }
}
```

- [ ] **Step 15: `marketRepository.test.ts` の既存アサーションを更新する**

`createMarket`/`initialLiveState` の戻り値を検証している既存テストへ、`orgId`/`createdByUid` を確認するアサーションを追加する。

- [ ] **Step 16: テストを通す**

Run: `npx vitest run src/lib/market/marketRepository.test.ts`
Expected: PASS

- [ ] **Step 17: `marketResults` の失敗するルールテストを書く**

```ts
describe('orgId/createdByUid enforcement on marketResults', () => {
  it('rejects a participant checkpoint whose orgId does not match the parent market', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await setDoc(doc(owner, 'markets', 'm-org'), { ownerUid: 'teacher-a', orgId: 'personal_teacher-a', createdByUid: 'teacher-a', templateSnapshot: template, capacity: 80, visibility: 'private', joinCode: 'ORGORG', creationStatus: 'READY' })
    const good = { ownerUid: 'teacher-a', orgId: 'personal_teacher-a', createdByUid: 'teacher-a', participantId: 'p1', checkpointId: 'c1' }
    await assertSucceeds(setDoc(doc(owner, 'marketResults', 'm-org', 'participants', 'p1'), good))
    await assertFails(setDoc(doc(owner, 'marketResults', 'm-org', 'participants', 'p2'), { ...good, orgId: 'personal_teacher-b' }))
  })
})
```

- [ ] **Step 18: 失敗を確認し、`firestore.rules` の `marketResults` マッチを更新する**

```
    match /marketResults/{marketId}/participants/{participantId} {
      allow get: if signedIn() && (resource.data.ownerUid == request.auth.uid || resource.data.participantUid == request.auth.uid);
      allow list: if teacher() && get(/databases/$(database)/documents/markets/$(marketId)).data.ownerUid == request.auth.uid;
      allow create: if teacher()
        && get(/databases/$(database)/documents/markets/$(marketId)).data.ownerUid == request.auth.uid
        && request.resource.data.ownerUid == request.auth.uid
        && request.resource.data.orgId == get(/databases/$(database)/documents/markets/$(marketId)).data.orgId
        && request.resource.data.createdByUid == request.auth.uid;
      allow update: if teacher()
        && get(/databases/$(database)/documents/markets/$(marketId)).data.ownerUid == request.auth.uid
        && request.resource.data.ownerUid == resource.data.ownerUid
        && request.resource.data.orgId == resource.data.orgId
        && request.resource.data.createdByUid == resource.data.createdByUid;
      allow delete: if teacher() && get(/databases/$(database)/documents/markets/$(marketId)).data.ownerUid == request.auth.uid;
    }

    match /marketResults/{marketId}/teams/{teamId} {
      allow get, list, update, delete: if teacher() && get(/databases/$(database)/documents/markets/$(marketId)).data.ownerUid == request.auth.uid;
      allow create: if teacher()
        && get(/databases/$(database)/documents/markets/$(marketId)).data.ownerUid == request.auth.uid
        && request.resource.data.orgId == get(/databases/$(database)/documents/markets/$(marketId)).data.orgId
        && request.resource.data.createdByUid == request.auth.uid;
    }
```

- [ ] **Step 19: テストを通す**

Run: `npm run test:rules`
Expected: PASS（本Stepと既存の `marketResults` テストの両方）

- [ ] **Step 20: `hostTrading.ts` の `finalizeEnding` を更新する**

```ts
import { personalOrgId } from '../org/personalOrgId'

export const finalizeEnding = async (firestore: Firestore, database: Database, marketId: string, ownerUid: string, leaseId: string, atMillis = now()) => {
  let checkpoint = ''
  const entered = await runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => {
    if (!raw || !ownsLiveLease(raw, ownerUid, leaseId, atMillis) || raw.meta.status === 'ENDED') return
    raw.meta.status = 'ENDING'; raw.finalization ??= { status: 'PENDING', checkpointId: `ending-${atMillis}`, startedAtMillis: atMillis }; checkpoint = raw.finalization.checkpointId; return raw
  })
  if (!entered.committed) return false
  const snapshot = entered.snapshot.val() as LiveMarketState
  const orgId = personalOrgId(ownerUid)
  const leaderboard = rankTeams(snapshot)
  const teamWrites = Object.entries(snapshot.teamPortfolios ?? {}).map(([teamId, portfolio]) =>
    setDoc(doc(firestore, 'marketResults', marketId, 'teams', teamId), { ownerUid, orgId, createdByUid: ownerUid, checkpointId: checkpoint, teamId, portfolio, leaderboard: leaderboard[teamId] ?? null, finalizedAtMillis: atMillis }))
  const participantWrites = Object.entries(snapshot.participants ?? {}).map(([participantId, participant]) =>
    setDoc(doc(firestore, 'marketResults', marketId, 'participants', participantId), {
      ownerUid, orgId, createdByUid: ownerUid, checkpointId: checkpoint, participantId, participantUid: participant.uid, teamId: participant.teamId,
      displayName: participant.displayName,
      teamResult: participant.teamId ? leaderboard[participant.teamId] ?? null : null,
      transactions: snapshot.transactions?.[participantId] ?? {}, finalizedAtMillis: atMillis,
    }))
  const writes = [...teamWrites, ...participantWrites]
  for (let index = 0; index < writes.length; index += 20) await Promise.all(writes.slice(index, index + 20))
  const complete = await runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => {
    if (!raw || !ownsLiveLease(raw, ownerUid, leaseId, atMillis) || raw.finalization?.checkpointId !== checkpoint) return
    raw.meta.status = 'ENDED'; raw.finalization.status = 'COMPLETED'; raw.finalization.completedAtMillis = atMillis
    return raw
  })
  return complete.committed
}
```

- [ ] **Step 21: `hostTrading.test.ts` の既存アサーションを更新する**

`finalizeEnding` を呼ぶ既存テストで、書き込まれた `marketResults` ドキュメントが `orgId`/`createdByUid` を持つことを確認するアサーションを追加する。

- [ ] **Step 22: テストを通す**

Run: `npx vitest run src/lib/market/hostTrading.test.ts`
Expected: PASS

- [ ] **Step 23: `npm run verify` を通す**

Run: `npm run verify`
Expected: 全体成功。

- [ ] **Step 24: Commit**

```bash
git add firestore.rules test/firestore.rules.test.ts src/lib/templates/templateRepository.ts src/lib/templates/templateRepository.test.ts src/lib/market/marketRepository.ts src/lib/market/marketRepository.test.ts src/lib/market/hostTrading.ts src/lib/market/hostTrading.test.ts
git commit -m "feat: stamp and enforce orgId/createdByUid on templates, markets, and marketResults"
```

---

## Task 8: RTDB `liveMarkets/{marketId}/meta` への `orgId`/`createdByUid` 強制

**Files:**
- Modify: `database.rules.json`, `test/database.rules.test.ts`

**Interfaces:**
- Consumes: `initialLiveState` から書き込まれる `meta.orgId`/`meta.createdByUid`（Task 7 Step 13で実装済み）。

- [ ] **Step 1: 失敗するルールテストを書く**

`test/database.rules.test.ts` の既存パターンに倣って追記する（実際のフィクスチャ変数名は既存ファイルの命名規則に合わせること）。

```ts
describe('liveMarkets meta orgId/createdByUid', () => {
  it('rejects creating a market whose meta.orgId does not match the deterministic personal org id', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).database()
    const badMeta = { ownerUid: 'teacher-a', orgId: 'personal_teacher-b', createdByUid: 'teacher-a', capacity: 80, startingCash: 10000, visibility: 'private', status: 'SETUP', createdAtMillis: 1, joinCode: 'ABCDEF' }
    await assertFails(set(ref(owner, 'liveMarkets/m1/meta'), badMeta))
  })

  it('rejects creating a market whose meta.createdByUid does not match the caller', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).database()
    const badMeta = { ownerUid: 'teacher-a', orgId: 'personal_teacher-a', createdByUid: 'teacher-b', capacity: 80, startingCash: 10000, visibility: 'private', status: 'SETUP', createdAtMillis: 1, joinCode: 'ABCDEF' }
    await assertFails(set(ref(owner, 'liveMarkets/m1/meta'), badMeta))
  })

  it('accepts a correctly-stamped meta and rejects changing orgId afterward', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).database()
    const goodMeta = { ownerUid: 'teacher-a', orgId: 'personal_teacher-a', createdByUid: 'teacher-a', capacity: 80, startingCash: 10000, visibility: 'private', status: 'SETUP', createdAtMillis: 1, joinCode: 'ABCDEF' }
    await assertSucceeds(set(ref(owner, 'liveMarkets/m1/meta'), goodMeta))
    await assertFails(update(ref(owner, 'liveMarkets/m1/meta'), { orgId: 'personal_teacher-b' }))
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npm run test:rules`
Expected: FAIL — 現行の `meta.validate` は `orgId`/`createdByUid` を要求せず、`badMeta` の作成が通ってしまう。

- [ ] **Step 3: `database.rules.json` の `meta` を更新する**

```json
"meta": {
  ".read": "auth != null && (data.child('ownerUid').val() === auth.uid || root.child('liveMarkets').child($marketId).child('members').child(auth.uid).exists())",
  ".validate": "newData.hasChildren(['ownerUid','orgId','createdByUid','capacity','startingCash','visibility','status','createdAtMillis','joinCode'])",
  "ownerUid": { ".validate": "(!data.exists() && newData.val() === auth.uid) || newData.val() === data.val()" },
  "orgId": { ".validate": "(!data.exists() && newData.val() === 'personal_' + auth.uid) || newData.val() === data.val()" },
  "createdByUid": { ".validate": "(!data.exists() && newData.val() === auth.uid) || newData.val() === data.val()" },
  "capacity": { ".validate": "(!data.exists() && newData.val() === 80) || newData.val() === data.val()" },
  "startingCash": { ".validate": "(!data.exists() && newData.isNumber() && newData.val() >= 1) || newData.val() === data.val()" },
  "joinCode": { ".validate": "(!data.exists() && newData.isString() && newData.val().length === 6) || newData.val() === data.val()" },
  "visibility": { ".validate": "(!data.exists() && (newData.val() === 'private' || newData.val() === 'ranking_only' || newData.val() === 'public')) || newData.val() === data.val()" },
  "status": { ".validate": "newData.val() === 'SETUP' || newData.val() === 'OPEN' || newData.val() === 'PAUSED' || newData.val() === 'ENDING' || newData.val() === 'ENDED'" },
  "openedAtMillis": { ".validate": "!newData.exists() || (newData.isNumber() && (!data.exists() || newData.val() === data.val() || (data.parent().child('status').val() === 'PAUSED' && newData.val() >= data.val()) || (newData.parent().child('status').val() === 'OPEN' && (data.parent().child('status').val() === 'ENDING' || data.parent().child('status').val() === 'ENDED'))))" },
  "pausedAtMillis": { ".validate": "!newData.exists() || (newData.isNumber() && newData.val() >= 0)" }
}
```

- [ ] **Step 4: テストを通す**

Run: `npm run test:rules`
Expected: PASS

- [ ] **Step 5: `orgAccess` トップレベルノードを追加する（書き込みはAdmin SDKのみ、Task 3が使う）**

`database.rules.json` の `"rules": { ... }` 直下、`"liveMarkets"` と同じ階層に追加する。

```json
"orgAccess": {
  "$orgId": {
    "$uid": {
      ".read": "auth != null && auth.uid === $uid",
      ".write": false
    }
  }
}
```

- [ ] **Step 6: `orgAccess` の失敗するルールテストを書き、通ることを確認する**

```ts
describe('orgAccess mirror', () => {
  it('rejects any client write, even by the member themself', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).database()
    await assertFails(set(ref(owner, 'orgAccess/personal_teacher-a/teacher-a'), { role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 }))
  })
  it('lets the member read their own mirrored entry once seeded by an Admin SDK write', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await set(ref(context.database(), 'orgAccess/personal_teacher-a/teacher-a'), { role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 })
    })
    const owner = environment.authenticatedContext('teacher-a', teacherToken).database()
    await assertSucceeds(get(ref(owner, 'orgAccess/personal_teacher-a/teacher-a')))
  })
})
```

Run: `npm run test:rules`
Expected: PASS

- [ ] **Step 7: `npm run verify` を通す**

Run: `npm run verify`
Expected: 全体成功。

- [ ] **Step 8: Commit**

```bash
git add database.rules.json test/database.rules.test.ts
git commit -m "feat: enforce orgId/createdByUid on liveMarkets meta and add orgAccess mirror node"
```

---

## Task 9: Phase 1.1 完了条件の検証

**Files:** なし（検証タスク）

- [ ] **Step 1: `npm run verify` が通ることを確認する**

Run: `npm run verify`
Expected: 成功。

- [ ] **Step 2: 1.1完了条件のチェックリストを満たすことを確認する**

以下は本計画がPhase 1.1の完了条件として定義するもの（design.mdには明示のチェックリストがないため、本計画で新規に定義する — `docs/superpowers/plans/2026-08-05-master-roadmap-plan.md:123-129` の指摘どおり）。

- [ ] 新規教師アカウントで `ensurePersonalOrgCallable` を呼ぶと、`organizations/personal_{uid}`・`organizations/personal_{uid}/members/{uid}`（`role: owner`, `status: active`）・`users/{uid}.personalOrgId === 'personal_{uid}'` が作成される（Task 3/4のユニットテスト・エミュレータ確認で担保）
- [ ] 同じuidで複数回呼んでも組織が重複作成されない（Task 3の冪等性テストで担保）
- [ ] `templates`・`markets`・`marketResults/*/participants`・`marketResults/*/teams` の作成時に、`orgId`が`'personal_' + auth.uid`と一致しない、または `createdByUid` が `auth.uid` と一致しない場合、Rules Emulatorで拒否される（Task 7で担保）
- [ ] 上記コレクションの更新で `orgId`/`createdByUid` を変更しようとするとRules Emulatorで拒否される（Task 7で担保）
- [ ] RTDB `liveMarkets/{marketId}/meta` の作成・更新でも同様に拒否される（Task 8で担保）
- [ ] `officialTemplates`・`serviceStatus`・`templateShares`・`marketJoinCodes` には `orgId`/`createdByUid` の要求を追加していない（対象外リストどおり。Task 6/7で新規ルールを追加していないことを確認する）
- [ ] `npm run verify` が通る

- [ ] **Step 3: 回帰がないことを確認する**

Run: `npm test && npm run test:rules`
Expected: 本計画で変更していない既存テスト（`classroom-flow.rules.test.ts` など）もすべて成功する。

---

## Task 10: LessonTemplate v2 型定義

**Files:**
- Create: `src/lib/templates/v2/types.ts`, `src/lib/templates/v2/types.test.ts`

**Interfaces:**
- Produces: `LessonTemplateContentV2`, `TemplateVersionV2`, `TemplateV2Envelope`, `TEMPLATE_SCHEMA_VERSION`

- [ ] **Step 1: 失敗するテストを書く（型はコンパイル時検証が主だが、`schemaVersion` の定数が壊れていないことをランタイムでも保証する）**

```ts
import { describe, expect, it } from 'vitest'
import { TEMPLATE_SCHEMA_VERSION } from './types'

describe('TEMPLATE_SCHEMA_VERSION', () => {
  it('is 2', () => {
    expect(TEMPLATE_SCHEMA_VERSION).toBe(2)
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/templates/v2/types.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 型定義を実装する**

```ts
import type { StockPricePhase } from '../../pricing/types'

export const TEMPLATE_SCHEMA_VERSION = 2 as const

export type TemplateDifficulty = 'introductory' | 'standard' | 'advanced'
export interface TemplateMetaV2 {
  subject: string
  gradeLevel: string
  estimatedMinutes: number
  difficulty: TemplateDifficulty
}
export interface TemplateObjectivesV2 {
  primaryObjective: string
  secondaryObjectives: string[]
  essentialQuestion: string
}
export interface TemplateClassroomV2 {
  recommendedHeadcount: number
  teamSize: number
  deviceEnvironment: string
  hasIndividualForecast: boolean
}
export type PriceMode = 'round' | 'continuous'
export interface TemplateAssetV2 {
  id: string
  name: string
  symbol: string
  initialPrice: number
  /** Only meaningful when priceMode is 'continuous' — the classic-mode intrahour schedule. */
  pricePhases?: StockPricePhase[]
}
export interface TemplateMarketV2 {
  priceMode: PriceMode
  supplyDemandLinked: boolean
  assets: TemplateAssetV2[]
}
export interface TemplateRoundV2 { id: string; label: string; phases: string[] }
/**
 * Explicit impact schedule, not a single delayRounds count — design.md:606
 * requires distinguishing "once after N rounds" from "every round from N on"
 * from "spread across a range", which a single delay count cannot express.
 */
export interface EventImpactV2 { assetId: string; roundOffset: number; percent: number }
export interface TemplateEventV2 { id: string; headline: string; body: string; roundIndex: number; impacts: EventImpactV2[] }
export type TemplateDocumentKind = 'profile' | 'statistics' | 'earnings'
export interface TemplateDocumentV2 { id: string; title: string; kind: TemplateDocumentKind; body: string }
export interface TemplateAssessmentV2 { metrics: string[]; reflectionQuestions: string[] }
export interface TemplateTeacherGuideV2 { facilitationNotes: string; explanations: string; commonMisconceptions: string[] }

export interface LessonTemplateContentV2 {
  schemaVersion: typeof TEMPLATE_SCHEMA_VERSION
  title: string
  description: string
  startingCash: number
  teams: Array<{ id: string; name: string }>
  meta: TemplateMetaV2
  objectives: TemplateObjectivesV2
  classroom: TemplateClassroomV2
  market: TemplateMarketV2
  rounds: TemplateRoundV2[]
  events: TemplateEventV2[]
  documents: TemplateDocumentV2[]
  assessment: TemplateAssessmentV2
  teacherGuide: TemplateTeacherGuideV2
}

export interface TemplateVersionV2 {
  id: string
  schemaVersion: typeof TEMPLATE_SCHEMA_VERSION
  content: LessonTemplateContentV2
  createdByUid: string
  createdAt: number
  changeSummary: string
  parentVersionId: string | null
}

export type TemplateV2Status = 'draft' | 'published' | 'archived'
export interface TemplateV2Envelope {
  id: string
  orgId: string
  createdByUid: string
  draft: LessonTemplateContentV2
  latestVersionId: string | null
  currentPublishedVersionId: string | null
  status: TemplateV2Status
  createdAt: number
  updatedAt: number
}
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/lib/templates/v2/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/templates/v2/types.ts src/lib/templates/v2/types.test.ts
git commit -m "feat: define LessonTemplate v2 schema types"
```

---

## Task 11: v1 → v2 変換関数

**Files:**
- Create: `src/lib/templates/v2/convertV1ToV2.ts`, `src/lib/templates/v2/convertV1ToV2.test.ts`

**Interfaces:**
- Consumes: `TemplateSpec` from `src/lib/templates/types.ts`. `LessonTemplateContentV2` from Task 10.
- Produces: `convertV1ToV2(spec: TemplateSpec): LessonTemplateContentV2`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, expect, it } from 'vitest'
import { convertV1ToV2 } from './convertV1ToV2'
import type { TemplateSpec } from '../types'

const v1: TemplateSpec = {
  title: '地域再生マーケット', description: '説明', startingCash: 10000,
  teams: [{ id: 'red', name: '赤チーム' }, { id: 'blue', name: '青チーム' }],
  companies: [{ id: 'rail', name: '地域交通', symbol: 'RAIL', initialPrice: 400, pricePhases: [{ id: 'p1', startMinute: 0, endMinute: 30, direction: 'UP', changePercent: 5 }] }],
}

describe('convertV1ToV2', () => {
  it('preserves title, teams, and asset identity', () => {
    const v2 = convertV1ToV2(v1)
    expect(v2.schemaVersion).toBe(2)
    expect(v2.title).toBe('地域再生マーケット')
    expect(v2.teams).toEqual([{ id: 'red', name: '赤チーム' }, { id: 'blue', name: '青チーム' }])
    expect(v2.market.assets).toEqual([{ id: 'rail', name: '地域交通', symbol: 'RAIL', initialPrice: 400, pricePhases: v1.companies[0].pricePhases }])
  })

  it('defaults to continuous price mode with no rounds or events, matching v1 behavior', () => {
    const v2 = convertV1ToV2(v1)
    expect(v2.market.priceMode).toBe('continuous')
    expect(v2.market.supplyDemandLinked).toBe(false)
    expect(v2.rounds).toEqual([])
    expect(v2.events).toEqual([])
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/templates/v2/convertV1ToV2.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

```ts
import type { TemplateSpec } from '../types'
import { TEMPLATE_SCHEMA_VERSION, type LessonTemplateContentV2 } from './types'

/**
 * v1 (classic/continuous mode only) has no notion of rounds, events, or
 * pedagogical metadata, so the converter fills those with empty/neutral
 * defaults. master-roadmap-plan.md's decision: markets already running on v1
 * finish on v1; only newly created templates become v2 — this converter is
 * for authoring a v2 copy, not for migrating a live market in place.
 */
export const convertV1ToV2 = (spec: TemplateSpec): LessonTemplateContentV2 => ({
  schemaVersion: TEMPLATE_SCHEMA_VERSION,
  title: spec.title,
  description: spec.description,
  startingCash: spec.startingCash,
  teams: spec.teams.map((team) => ({ id: team.id, name: team.name })),
  meta: { subject: 'unspecified', gradeLevel: 'unspecified', estimatedMinutes: 50, difficulty: 'standard' },
  objectives: { primaryObjective: '', secondaryObjectives: [], essentialQuestion: '' },
  classroom: { recommendedHeadcount: spec.teams.length * 4, teamSize: 4, deviceEnvironment: 'unspecified', hasIndividualForecast: false },
  market: {
    priceMode: 'continuous',
    supplyDemandLinked: false,
    assets: spec.companies.map((company) => ({
      id: company.id, name: company.name, symbol: company.symbol, initialPrice: company.initialPrice,
      ...(company.pricePhases ? { pricePhases: company.pricePhases } : {}),
    })),
  },
  rounds: [],
  events: [],
  documents: [],
  assessment: { metrics: [], reflectionQuestions: [] },
  teacherGuide: { facilitationNotes: '', explanations: '', commonMisconceptions: [] },
})
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/lib/templates/v2/convertV1ToV2.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/templates/v2/convertV1ToV2.ts src/lib/templates/v2/convertV1ToV2.test.ts
git commit -m "feat: add v1-to-v2 lesson template conversion"
```

---

## Task 12: 公式3テンプレートのv2変換

**Files:**
- Create: `src/lib/templates/v2/officialSeedsV2.ts`, `src/lib/templates/v2/officialSeedsV2.test.ts`

**Interfaces:**
- Consumes: `officialTemplateSeeds` from `src/lib/templates/officialSeeds.ts`, `convertV1ToV2` from Task 11.

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, expect, it } from 'vitest'
import { officialTemplateSeedsV2 } from './officialSeedsV2'

describe('officialTemplateSeedsV2', () => {
  it('converts all three official templates to schemaVersion 2', () => {
    expect(officialTemplateSeedsV2).toHaveLength(3)
    expect(officialTemplateSeedsV2.map((seed) => seed.id)).toEqual(['school-festival', 'space-colony', 'local-revival'])
    officialTemplateSeedsV2.forEach((seed) => expect(seed.content.schemaVersion).toBe(2))
  })

  it('gives local-revival a rail-price event matching the design doc example schedule', () => {
    const localRevival = officialTemplateSeedsV2.find((seed) => seed.id === 'local-revival')
    expect(localRevival?.content.events).toEqual([
      {
        id: 'rail-delay',
        headline: '地域交通の増便計画が遅延',
        body: '整備の遅れにより、地域交通の増便が2ラウンド後から段階的に反映される見込みです。',
        roundIndex: 0,
        impacts: [
          { assetId: 'rail', roundOffset: 2, percent: -3 },
          { assetId: 'rail', roundOffset: 3, percent: -2 },
        ],
      },
    ])
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/templates/v2/officialSeedsV2.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

```ts
import { officialTemplateSeeds } from '../officialSeeds'
import { convertV1ToV2 } from './convertV1ToV2'
import type { LessonTemplateContentV2 } from './types'

const localRevivalEvent = {
  id: 'rail-delay',
  headline: '地域交通の増便計画が遅延',
  body: '整備の遅れにより、地域交通の増便が2ラウンド後から段階的に反映される見込みです。',
  roundIndex: 0,
  impacts: [
    { assetId: 'rail', roundOffset: 2, percent: -3 },
    { assetId: 'rail', roundOffset: 3, percent: -2 },
  ],
}

export const officialTemplateSeedsV2: Array<{ id: string; content: LessonTemplateContentV2 }> =
  officialTemplateSeeds.map(({ id, spec }) => {
    const content = convertV1ToV2(spec)
    if (id === 'local-revival') content.events = [localRevivalEvent]
    return { id, content }
  })
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/lib/templates/v2/officialSeedsV2.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/templates/v2/officialSeedsV2.ts src/lib/templates/v2/officialSeedsV2.test.ts
git commit -m "feat: convert the three official templates to LessonTemplate v2"
```

---

## Task 13: draft/version分離のリポジトリ関数とFirestoreルール

**Files:**
- Create: `src/lib/templates/v2/templateVersionRepository.ts`, `src/lib/templates/v2/templateVersionRepository.test.ts`
- Modify: `firestore.rules`, `test/firestore.rules.test.ts`

**Interfaces:**
- Consumes: `TemplateV2Envelope`, `TemplateVersionV2`, `LessonTemplateContentV2` from Task 10. `personalOrgId` from Task 2.
- Produces: `createTemplateV2Envelope`, `saveDraft`, `publishVersion`, `setCurrentPublishedVersion`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTemplateV2Envelope, saveDraft, publishVersion, setCurrentPublishedVersion } from './templateVersionRepository'
import type { LessonTemplateContentV2 } from './types'

const draft: LessonTemplateContentV2 = {
  schemaVersion: 2, title: 't', description: '', startingCash: 10000, teams: [],
  meta: { subject: '', gradeLevel: '', estimatedMinutes: 50, difficulty: 'standard' },
  objectives: { primaryObjective: '', secondaryObjectives: [], essentialQuestion: '' },
  classroom: { recommendedHeadcount: 8, teamSize: 4, deviceEnvironment: '', hasIndividualForecast: false },
  market: { priceMode: 'continuous', supplyDemandLinked: false, assets: [] },
  rounds: [], events: [], documents: [], assessment: { metrics: [], reflectionQuestions: [] },
  teacherGuide: { facilitationNotes: '', explanations: '', commonMisconceptions: [] },
}

let environment: RulesTestEnvironment
beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-stock-league-classroom-v2',
    firestore: { rules: readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8') },
  })
})
beforeEach(async () => { await environment.clearFirestore() })
afterAll(async () => { await environment.cleanup() })

describe('templateVersionRepository', () => {
  it('creates an envelope with a draft and no published version, then publishes an immutable version', async () => {
    const firestore = environment.authenticatedContext('teacher-a', { email_verified: true, firebase: { sign_in_provider: 'google.com' } }).firestore()
    const templateId = await createTemplateV2Envelope(firestore, 'teacher-a', draft)
    const afterSave = await saveDraft(firestore, templateId, { ...draft, title: 'edited' })
    expect(afterSave.title).toBe('edited')
    const versionId = await publishVersion(firestore, templateId, 'teacher-a', '初版')
    await setCurrentPublishedVersion(firestore, templateId, versionId)
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/templates/v2/templateVersionRepository.test.ts`
Expected: FAIL — module not found、かつルールが `templates/{id}/versions/{versionId}` を許可しないため後で再度失敗しうる。

- [ ] **Step 3: `templateVersionRepository.ts` を実装する**

```ts
import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore'
import { personalOrgId } from '../../org/personalOrgId'
import type { LessonTemplateContentV2 } from './types'

const envelopes = (db: Firestore) => collection(db, 'templates')
const versions = (db: Firestore, templateId: string) => collection(db, 'templates', templateId, 'versions')

export const createTemplateV2Envelope = async (db: Firestore, createdByUid: string, draft: LessonTemplateContentV2): Promise<string> => {
  const ref = await addDoc(envelopes(db), {
    orgId: personalOrgId(createdByUid), createdByUid, draft,
    latestVersionId: null, currentPublishedVersionId: null, status: 'draft',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  })
  return ref.id
}

/** Autosave: overwrites `draft` only. Never touches the immutable versions subcollection. */
export const saveDraft = async (db: Firestore, templateId: string, draft: LessonTemplateContentV2): Promise<LessonTemplateContentV2> => {
  await setDoc(doc(db, 'templates', templateId), { draft, updatedAt: serverTimestamp() }, { merge: true })
  return draft
}

/** Creates an immutable version snapshot of the current draft and advances latestVersionId. */
export const publishVersion = async (db: Firestore, templateId: string, createdByUid: string, changeSummary: string): Promise<string> => {
  const envelopeSnap = await getDoc(doc(db, 'templates', templateId))
  if (!envelopeSnap.exists()) throw new Error('Template envelope not found')
  const envelope = envelopeSnap.data()
  const versionRef = await addDoc(versions(db, templateId), {
    schemaVersion: 2, content: envelope.draft, createdByUid, createdAt: serverTimestamp(),
    changeSummary, parentVersionId: envelope.latestVersionId ?? null,
  })
  await setDoc(doc(db, 'templates', templateId), { latestVersionId: versionRef.id, updatedAt: serverTimestamp() }, { merge: true })
  return versionRef.id
}

/** Marketplace/market-creation publishing: points at an already-immutable version. */
export const setCurrentPublishedVersion = async (db: Firestore, templateId: string, versionId: string): Promise<void> => {
  await setDoc(doc(db, 'templates', templateId), { currentPublishedVersionId: versionId, status: 'published', updatedAt: serverTimestamp() }, { merge: true })
}
```

- [ ] **Step 4: Firestoreルールを追加する（`templates/{templateId}/versions/{versionId}`）**

`match /templates/{templateId} { ... }` ブロック内、`allow delete` の直後に追加する。

```
      match /versions/{versionId} {
        allow get: if teacher() && get(/databases/$(database)/documents/templates/$(templateId)).data.ownerUid == request.auth.uid;
        allow list: if teacher() && get(/databases/$(database)/documents/templates/$(templateId)).data.ownerUid == request.auth.uid;
        allow create: if teacher()
          && get(/databases/$(database)/documents/templates/$(templateId)).data.ownerUid == request.auth.uid
          && request.resource.data.createdByUid == request.auth.uid;
        allow update, delete: if false;
      }
```

`templates` のenvelope自体にも `orgId`/`createdByUid` が既にTask 7で強制されているため、v2 envelope作成時（`createTemplateV2Envelope`）にもv1同様の検証が効く。ただし現行の `allow create` は `request.resource.data.visibility == 'private'` を要求しており、v2 envelopeは `visibility` フィールドを持たない設計（`status`を使う）。この不整合を解消するため、`allow create`/`allow update` の `visibility` 必須条件を「`visibility`フィールドが存在する場合のみ`'private'`を要求」する形に緩める。

```
      allow create: if teacher()
        && request.resource.data.ownerUid == request.auth.uid
        && (!('visibility' in request.resource.data) || request.resource.data.visibility == 'private')
        && request.resource.data.orgId == 'personal_' + request.auth.uid
        && request.resource.data.createdByUid == request.auth.uid;
```

**この分岐は暫定である。** v1テンプレート（`ownerUid`必須・`visibility`必須）とv2 envelope（`orgId`必須・`status`必須、`ownerUid`は持たない設計）は本来別のドキュメント形にすべきだが、design.mdは両者を同じ `templates/{templateId}` コレクションに置く前提（`design.md:510`は`orgId`/`createdByUid`のみを示し`ownerUid`を含まない）。本タスクではv1の `ownerUid` 必須要件をそのまま残し、v2 envelopeにも `ownerUid: createdByUid` を追加で書き込むことで、ルールを分岐させずに済ませる。

`createTemplateV2Envelope` を次のように修正する。

```ts
export const createTemplateV2Envelope = async (db: Firestore, createdByUid: string, draft: LessonTemplateContentV2): Promise<string> => {
  const ref = await addDoc(envelopes(db), {
    ownerUid: createdByUid, orgId: personalOrgId(createdByUid), createdByUid, draft,
    latestVersionId: null, currentPublishedVersionId: null, status: 'draft',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  })
  return ref.id
}
```

この場合、`visibility` の緩和は不要になる（ステップを1つ戻す）。**この判断（v1/v2を同一コレクション・同一ルールで扱い、`ownerUid`をv2にも複製する）を、`docs/superpowers/plans/2026-08-05-phase1a-org-schema-functions-plan.md`のリスクとして明記し、v1テンプレートの完全引退時（未定）に `templates` コレクションのルールをv2専用へ整理し直す必要がある。**

- [ ] **Step 5: テストを通す**

Run: `npx vitest run src/lib/templates/v2/templateVersionRepository.test.ts && npm run test:rules`
Expected: 両方PASS

- [ ] **Step 6: `npm run verify` を通す**

Run: `npm run verify`
Expected: 成功。

- [ ] **Step 7: Commit**

```bash
git add firestore.rules test/firestore.rules.test.ts src/lib/templates/v2/templateVersionRepository.ts src/lib/templates/v2/templateVersionRepository.test.ts
git commit -m "feat: add LessonTemplate v2 draft/version repository and rules"
```

---

## Task 14: Phase 1.2 完了条件の検証

**Files:** なし（検証タスク）

- [ ] **Step 1: `npm run verify` が通ることを確認する**

Run: `npm run verify`
Expected: 成功。

- [ ] **Step 2: 1.2完了条件のチェックリストを満たすことを確認する**

- [ ] `convertV1ToV2` が公式3テンプレート（学園祭・宇宙都市・地域再生）を型どおりのv2へ変換する（Task 11/12のテストで担保）
- [ ] 地域再生テンプレートのv2変換に、design.mdの`impacts`スケジュール例（`rail`銘柄、`roundOffset`2→-3%、3→-2%）を持つイベントが1件含まれる（Task 12で担保）
- [ ] `templates/{id}` envelope（`draft`/`latestVersionId`/`currentPublishedVersionId`/`status`）と `templates/{id}/versions/{versionId}`（不変`content`）がリポジトリ関数経由で作成・取得できる（Task 13で担保）
- [ ] 版ドキュメントの `content` を作成後に変更する更新がRules Emulatorで拒否される（`allow update, delete: if false` — Task 13で担保）
- [ ] 既存のv1テンプレート作成・一覧・複製・削除のUI/フローに変更がなく、既存テストがすべて成功する（`src/components/` への変更ゼロ件を`git diff --stat`で確認する）
- [ ] `npm run verify` が通る

- [ ] **Step 3: UIへの変更がないことを確認する**

Run: `git diff --stat main...HEAD -- src/components`
Expected: 出力が空であること。

---

## Task 15: `pricingCore` の共有パッケージ化と丸め処理の固定

**Files:**
- Create: `packages/pricing-core/package.json`, `packages/pricing-core/tsconfig.json`, `packages/pricing-core/src/index.ts`
- Modify: `src/lib/pricing/pricingCore.ts`（re-export化）, `functions/package.json`, `package.json`（`workspaces`）

**技術的決定（設計の未決事項「価格計算式の二重実装」「価格の丸め仕様」への回答）:**

`pricingCore.ts` は現在 `Math.random()` を既定シードに使う `createPhaseRuntime` を含む（`src/lib/pricing/pricingCore.ts:41`）。これはクラシックモードのホスト側ティックが非決定的であることを前提にした関数で、design.mdが「クラシックモードのサーバー化は行わない」と明記している範囲そのものである。したがって**共有すべきなのは純粋で決定的な部分（`clampToBounds`、`applyMeanReversion`、`normalizePhases`、`getPhaseEndPrice` の丸め・クランプ・適用順序）だけであり、`createPhaseRuntime`（`Math.random()` を呼ぶ）は共有パッケージへ含めない**。

npm workspaces内に `packages/pricing-core` を新設し、`src/lib/pricing/pricingCore.ts` と `functions/` の双方がそれを利用する形にする。Firebase Functionsのデプロイがnpmワークスペースのシンボリックリンクを正しく解決するかは、実際の `firebase deploy --only functions` でのみ最終確認できる（本計画のTask 18で本番Blaze移行と合わせて検証する）。ローカルでの検証はFunctionsエミュレータでの起動確認までとする。

- [ ] **Step 1: `packages/pricing-core/package.json` を作成する**

```json
{
  "name": "pricing-core",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

（ビルド不要のソース直参照とする。Vite側はTypeScriptソースを直接importでき、Functions側は自身の `tsc` コンパイル時に一緒にコンパイルされるよう `rootDir`/`include` で対応する — Step 5参照。）

- [ ] **Step 2: `packages/pricing-core/src/index.ts` へ既存の決定的関数を移す**

`src/lib/pricing/pricingCore.ts` の内容のうち `createPhaseRuntime` を除く全部をここへ移動する。

```ts
import type { PriceRuntimeState, StockPricePhase } from './types'

export const DEFAULT_PHASES: StockPricePhase[] = [{ id: 'default-flat', startMinute: 0, endMinute: 60, direction: 'FLAT', changePercent: 0 }]
export const MIN_PRICE_RATIO = 0.01
export const MAX_PRICE_RATIO = 100

/** The single rounding/floor/ceiling function shared by the browser host tick and
 * every Cloud Function that touches a price. Order matters: floor/ceiling are
 * derived from basePrice first, then the candidate price is rounded and clamped
 * into that range — never the other order, or the floor/ceiling themselves would
 * shift with the candidate. */
export const clampToBounds = (price: number, basePrice: number): number => {
  const safeBase = Number.isFinite(basePrice) && basePrice > 0 ? basePrice : price
  const floor = Math.max(1, Math.round(safeBase * MIN_PRICE_RATIO)), ceiling = Math.max(floor, Math.round(safeBase * MAX_PRICE_RATIO))
  return Math.min(ceiling, Math.max(floor, Math.max(1, Math.round(price))))
}
export const applyMeanReversion = (target: number, startPrice: number, basePrice: number): number => {
  if (!Number.isFinite(basePrice) || basePrice <= 0) return target
  const strength = Math.min(0.9, 0.1 + Math.abs(startPrice - basePrice) / basePrice * 0.5)
  return target + (basePrice - target) * strength
}
export const clampMinute = (value: number, fallback: number): number => Number.isFinite(value) ? Math.min(60, Math.max(0, Math.round(value))) : fallback
export const normalizePhases = (phases?: StockPricePhase[] | null): StockPricePhase[] => {
  if (!Array.isArray(phases) || phases.length === 0) return DEFAULT_PHASES
  return phases.map((phase, index) => {
    const direction = ['UP', 'DOWN', 'FLAT'].includes(phase.direction) ? phase.direction : 'FLAT'
    const percent = Number.isFinite(phase.changePercent) ? Math.max(0, Math.abs(phase.changePercent)) : 0
    const startMinute = clampMinute(phase.startMinute, 0)
    const endMinute = Math.max(startMinute + 1, clampMinute(phase.endMinute, 60))
    return { id: phase.id || `phase-${index + 1}`, startMinute, endMinute: Math.min(60, endMinute), direction, changePercent: direction === 'DOWN' ? Math.min(99, percent) : percent }
  }).sort((a, b) => a.startMinute - b.startMinute)
}
export const elapsedMarketMinute = (openedAtMillis: number, atMillis: number): number => Math.max(0, (atMillis - openedAtMillis) / 60000)
export const getActivePhase = (phases: StockPricePhase[], elapsedMinute: number): StockPricePhase => {
  const normalized = normalizePhases(phases)
  return normalized.find((phase) => elapsedMinute >= phase.startMinute && elapsedMinute < phase.endMinute) ?? DEFAULT_PHASES[0]
}
export const getPhaseWindow = (phase: StockPricePhase, openedAtMillis: number) => ({
  startMillis: openedAtMillis + clampMinute(phase.startMinute, 0) * 60000,
  endMillis: openedAtMillis + clampMinute(phase.endMinute, 60) * 60000,
})
export const getPhaseEndPrice = (startPrice: number, phase: StockPricePhase, basePrice = startPrice): number => {
  if (phase.direction === 'FLAT' || phase.changePercent === 0) return clampToBounds(startPrice, basePrice)
  return clampToBounds(applyMeanReversion(startPrice * (1 + (phase.direction === 'DOWN' ? -1 : 1) * phase.changePercent / 100), startPrice, basePrice), basePrice)
}
export type { PriceRuntimeState, StockPricePhase }
```

（`PriceRuntimeState`/`StockPricePhase` の実体定義は `src/lib/pricing/types.ts` に残し、ここでは re-export のみに留めるため、`packages/pricing-core` は `src/lib/pricing/types.ts` を相対importする。パッケージ間の依存方向を単純に保つため、`types.ts` 自体は移動しない。）

実際には `import type { PriceRuntimeState, StockPricePhase } from '../../../src/lib/pricing/types'` のような深い相対importになるため、Step 1で `packages/pricing-core` に型を複製せず参照する設計は壊れやすい。**より安全な代替として、`StockPricePhase`/`PriceRuntimeState` 型定義そのものも `packages/pricing-core/src/types.ts` へ移し、`src/lib/pricing/types.ts` はそこからre-exportする形にする。**

```ts
// packages/pricing-core/src/types.ts — 実体
export type PhaseDirection = 'UP' | 'DOWN' | 'FLAT'
export interface StockPricePhase { id: string; startMinute: number; endMinute: number; direction: PhaseDirection; changePercent: number }
export interface PriceRuntimeState { mode: 'PHASE'; phaseId: string; startPrice: number; endPrice: number; startAtMillis: number; endAtMillis: number; seed: number }
```

```ts
// src/lib/pricing/types.ts — re-export化
export type { PhaseDirection, StockPricePhase, PriceRuntimeState } from '../../../packages/pricing-core/src/types'
```

- [ ] **Step 3: `src/lib/pricing/pricingCore.ts` をre-export + `createPhaseRuntime` のみ残す形にする**

```ts
import type { PriceRuntimeState, StockPricePhase } from './types'
import { getPhaseEndPrice, getPhaseWindow } from '../../../packages/pricing-core/src/index'

export { DEFAULT_PHASES, MIN_PRICE_RATIO, MAX_PRICE_RATIO, clampToBounds, applyMeanReversion, clampMinute, normalizePhases, elapsedMarketMinute, getActivePhase, getPhaseWindow, getPhaseEndPrice } from '../../../packages/pricing-core/src/index'

const MINUTE_MS = 60 * 1000

/** Not shared: classic mode's host tick is deliberately non-deterministic
 * (design.md's "クラシックモードのサーバー化は行わない"). Only this seed
 * generator lives outside packages/pricing-core. */
export const createPhaseRuntime = (currentPrice: number, phase: StockPricePhase, openedAtMillis: number, nowMillis: number, basePrice = currentPrice, seed = Math.random() * 1000): PriceRuntimeState => {
  const window = getPhaseWindow(phase, openedAtMillis), startAtMillis = Math.max(nowMillis, window.startMillis)
  return { mode: 'PHASE', phaseId: phase.id, startPrice: currentPrice, endPrice: getPhaseEndPrice(currentPrice, phase, basePrice), startAtMillis, endAtMillis: Math.max(startAtMillis + MINUTE_MS, window.endMillis), seed }
}
```

- [ ] **Step 4: 既存の `pricingCore.test.ts`（存在すれば）とその他の呼び出し元が壊れていないことを確認する**

Run: `npx vitest run src/lib/pricing`
Expected: PASS（re-exportのため公開APIは不変）

- [ ] **Step 5: `functions/tsconfig.json` を更新し、`packages/pricing-core` を含めてコンパイルできるようにする**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "outDir": "lib",
    "rootDir": "..",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "sourceMap": true
  },
  "include": ["src", "../packages/pricing-core/src"],
  "compileOnCommit": false
}
```

`rootDir: ".."` により、出力は `functions/lib/functions/src/...` と `functions/lib/packages/pricing-core/src/...` に分かれる。`functions/package.json` の `main` をそれに合わせて更新する。

```json
{ "main": "lib/functions/src/index.js" }
```

- [ ] **Step 6: `functions/` からpricing-coreを使うテストを書く（TDD、丸め処理の一致を確認する最初のテスト）**

`functions/src/pricing/roundTrip.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { clampToBounds } from '../../../packages/pricing-core/src/index'

describe('clampToBounds via packages/pricing-core from functions/', () => {
  it('clamps a price into [1%, 100x] of basePrice', () => {
    expect(clampToBounds(0, 500)).toBe(5)
    expect(clampToBounds(999999, 500)).toBe(50000)
  })
})
```

- [ ] **Step 7: 失敗を確認する**

Run: `cd functions && npx vitest run src/pricing/roundTrip.test.ts`
Expected: FAIL（`packages/pricing-core` 未作成の間、またはパス解決の設定が済むまで）

- [ ] **Step 8: Step 1〜5を適用したうえでテストを通す**

Run: `cd functions && npx vitest run src/pricing/roundTrip.test.ts`
Expected: PASS

- [ ] **Step 9: Functionsエミュレータでビルド・起動を確認する（npm workspacesのシンボリックリンク越しにコンパイルできることの確認）**

Run: `cd functions && npm run build && cd .. && firebase emulators:start --only functions`
Expected: ビルド・起動ともにエラーなし。

- [ ] **Step 10: `npm run verify` を通す**

Run: `npm run verify`
Expected: 成功。

- [ ] **Step 11: Commit**

```bash
git add packages/pricing-core src/lib/pricing functions/tsconfig.json functions/package.json functions/src/pricing
git commit -m "refactor: share pricingCore's deterministic rounding/clamping between client and functions"
```

---

## Task 16: クライアント/サーバー価格計算の一致検証テスト

**Files:**
- Create: `test/pricingParity.test.ts`

**Interfaces:**
- Consumes: `clampToBounds`, `getPhaseEndPrice`, `normalizePhases` from `packages/pricing-core/src/index.ts`, imported once directly (not via `src/` or `functions/` re-exports) so both callers are proven to resolve to the exact same module.

- [ ] **Step 1: 失敗するテストを書く（実際にはテストは最初から通る内容だが、TDDとして先に書き、モジュール解決の失敗で赤くなることを確認する）**

```ts
import { describe, expect, it } from 'vitest'
import { clampToBounds as clientClamp, getPhaseEndPrice as clientEndPrice } from '../src/lib/pricing/pricingCore'
import { clampToBounds as coreClamp, getPhaseEndPrice as coreEndPrice } from '../packages/pricing-core/src/index'

describe('pricing parity between src/ re-exports and packages/pricing-core', () => {
  it('clampToBounds is literally the same function reference', () => {
    expect(clientClamp).toBe(coreClamp)
  })

  it('getPhaseEndPrice produces identical output for the same input', () => {
    const phase = { id: 'p', startMinute: 0, endMinute: 30, direction: 'UP' as const, changePercent: 12 }
    expect(clientEndPrice(500, phase, 500)).toBe(coreEndPrice(500, phase, 500))
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run test/pricingParity.test.ts`
Expected: Task 15完了前は FAIL（モジュールが存在しない）。Task 15完了後に実行する場合はこのタスク自体がStep 1のみで完結する（re-exportである以上、関数参照は同一になるため実装作業は不要）。

- [ ] **Step 3: テストを通す**

Run: `npx vitest run test/pricingParity.test.ts`
Expected: PASS

- [ ] **Step 4: `npm run verify` を通す**

Run: `npm run verify`
Expected: 成功。

- [ ] **Step 5: Commit**

```bash
git add test/pricingParity.test.ts
git commit -m "test: assert client and functions resolve the identical pricing-core module"
```

---

## Task 17: `.info/serverTimeOffset` 購読の確認

**Files:**
- Modify: なし（確認タスク）。不足があれば `src/lib/firebase/serverTime.ts` を修正。

design.mdの1.3は「クライアントは `.info/serverTimeOffset` を購読し、補正した時刻で表示価格を算出する」を実装項目として挙げているが、**この購読は既に実装済みである**（`src/lib/firebase/serverTime.ts:14-15` の `startServerTimeSync`、`src/lib/firebase/bootstrap.ts:34` で起動時に配線済み）。本タスクは新規実装ではなく、現状が要件を満たしているかの確認と、満たしていない場合の差分実装に限定する。

- [ ] **Step 1: 既存実装を読み、要件を満たしているか判定する**

`src/lib/firebase/serverTime.ts` の `serverNow()` が `Date.now() + offsetMillis` を返し、`offsetMillis` が `.info/serverTimeOffset` の `onValue` で更新されることを確認する（既存コードで確認済み）。表示価格算出（`getActivePhase`/`elapsedMarketMinute`/`getPhaseEndPrice` の呼び出し元）が `serverNow()` 由来の時刻を使っているかを `grep` で確認する。

Run: `grep -rn "elapsedMarketMinute\|getActivePhase" src/`

- [ ] **Step 2: 呼び出し元が `serverNow()` を使っていない箇所があれば、失敗するテストを書いて修正する**

（この計画の執筆時点でのコード調査では、価格表示ロジックの具体的な呼び出し元コンポーネントまでは確認していない。実施者は Step 1 の `grep` 結果を見て、`Date.now()` を直接使っている箇所があれば `serverNow()` に置き換え、対応するテストを追加すること。プレースホルダーを埋める作業ではなく、Step 1の調査結果に応じた具体的な修正になる。）

- [ ] **Step 3: `npm run verify` を通す**

Run: `npm run verify`
Expected: 成功。

- [ ] **Step 4: 確認結果を記録する**

このステップに、Step 1の`grep`結果と判定（「既存実装で要件を満たす」または「Nファイルを修正した」)をコメントとして残す。

- [ ] **Step 5: 変更があった場合のみCommit**

```bash
git add -A
git commit -m "fix: use serverNow() for display-price time calculations where missing"
```

---

## Task 18: Blazeプラン移行（本番）と予算アラートの確認

**Files:** なし（運用タスク）

- [ ] **Step 1: 本番プロジェクトのプランを確認する**

Run: `firebase projects:list`
対象プロジェクト（`.firebaserc` の `oss-stock-league`）がBlazeプランであることをコンソールで確認する。Task 1 Step 1で既に移行済みのはずだが、本タスクはFunctions基盤全体が組み上がった時点での最終確認として位置づける。

- [ ] **Step 2: 予算アラートが機能していることを確認する**

Run: `gcloud billing budgets list --billing-account=<ACCOUNT_ID>`
Expected: Task 1 Step 1で作成した予算が表示される。

- [ ] **Step 3: `firebase deploy --only functions` を一度実施し、npm workspacesの解決を本番デプロイで確認する**

これはTask 15で保留した「Firebase Functions デプロイがnpmワークスペースのシンボリックリンクを正しく解決するか」の最終確認である。ステージングまたは本番プロジェクトへの実デプロイでのみ確認できる。

Run: `firebase deploy --only functions --project oss-stock-league`
Expected: デプロイが成功し、`ensurePersonalOrgCallable` と `ping` がCloud Functionsコンソールに表示される。**失敗した場合、Task 15のnpm workspaces方式を再検討する必要がある**（代替: `functions/` 側のビルドスクリプトで `packages/pricing-core` の中身を `functions/src/pricing-core/` へ物理コピーしてからコンパイルする方式に切り替える）。

- [ ] **Step 4: デプロイ後、実際にCallableを呼び、予算アラートのしきい値が妥当か再確認する**

小規模な呼び出し（数回）でのコストを確認し、Task 1で設定したしきい値が明らかに低すぎる／高すぎる場合は調整する。

- [ ] **Step 5: 実施記録を残す**

実施日、担当者、デプロイ結果、予算アラートのしきい値を運用メモに記録する。

---

## Task 19: Phase 1.3 完了条件の検証

**Files:** なし（検証タスク）

- [ ] **Step 1: `npm run verify` が通ることを確認する**

Run: `npm run verify`
Expected: 成功。

- [ ] **Step 2: 1.3完了条件のチェックリストを満たすことを確認する**

- [ ] `functions/` パッケージが独立してビルド・型検査・テストに成功する（`npm run verify --workspace=functions`。Task 1で担保）
- [ ] Functionsエミュレータでスモークテスト用Callable（`ping`）と `ensurePersonalOrgCallable` が呼び出せる（Task 1/4で担保）
- [ ] 丸め・最低価格・上限・適用順序を担う関数（`clampToBounds`/`getPhaseEndPrice`等）が単一モジュール（`packages/pricing-core`）に定義され、`src/`側と`functions/`側が同一の関数参照・同一の出力を返す（Task 15/16で担保）
- [ ] 本番プロジェクトがBlazeプランへ移行済みで、予算アラートが1件以上設定されている（Task 1/18で担保、手動実施記録を残す）
- [ ] `.info/serverTimeOffset` 購読が機能しており、表示価格算出が `serverNow()` を経由している（Task 17で確認、必要なら修正）
- [ ] `firebase deploy --only functions` が実際に成功する（Task 18で担保。npm workspacesのFunctionsデプロイ互換性というリスクを本番相当の操作で解消する）
- [ ] `npm run verify` が通る

- [ ] **Step 3: Phase 1.1〜1.3全体の回帰確認**

Run: `npm run verify`
Expected: 成功。加えて `src/components/` への変更がないことを再確認する。

Run: `git diff --stat main...HEAD -- src/components`
Expected: 出力が空であること。

---

## Self-Review

**1. 仕様網羅性:**

- 基盤設計1（組織所有モデル、決定的ID、冪等Callable）→ Task 1〜5
- 基盤設計2（3層権限）→ Global Constraintsで明示的にスコープを絞り（個人組織のみ、`orgAccess`ミラーは書くが読むルールはPhase 5まで不要）、Task 3で実装
- 基盤設計5（`orgId`強制ルール、対象/対象外）→ Task 6〜8
- 基盤設計6（テンプレートバージョン管理）→ Task 10〜13
- Phase 1.1（個人組織自動生成、`orgId`/`createdByUid`付与、UIなし）→ Task 1〜9
- Phase 1.2（v2スキーマ、v1変換、公式テンプレート変換、UIなし）→ Task 10〜14
- Phase 1.3（Blaze移行、`functions/`新設、`pricingCore`共有、`.info/serverTimeOffset`）→ Task 1、15〜19
- リスクと未決事項の「価格の丸め仕様」「価格計算式の二重実装」「表示価格と約定価格の乖離」→ Task 15で回答（丸め処理の単一モジュール化）。「表示価格と約定価格の乖離」は1.4以降のラウンド約定実装で初めて意味を持つため、本計画では発生させないことのみを保証する（クラシックモードの挙動を変えていない）。
- 「v1からv2への移行」（稼働中市場の扱い）→ Task 11のコメントで明記（稼働中市場はv1のまま、変換は新規コピー作成のみ）
- 順序の矛盾の解決 → 冒頭セクションと選択理由

**2. プレースホルダー検査:** 全タスクに具体的なコード・コマンド・期待結果を記載した。唯一「プレースホルダー的」なのはTask 17 Step 2（既存コードの調査結果に依存するため事前に確定できない）だが、これは意図的なもので、調査手順（`grep`コマンド）と判定基準を明示し、「プレースホルダーを埋める作業ではなく調査結果に応じた具体的な修正」と明記した。

**3. 型・シグネチャの一貫性:** `personalOrgId(uid: string): string` はTask 2で定義後、Task 3〜4（Functions側）、Task 7（クライアント側）で一貫して同一シグネチャを使用。`LessonTemplateContentV2`/`TemplateVersionV2`/`TemplateV2Envelope`はTask 10で定義後、Task 11〜13で変更なく使用。`ensurePersonalOrg`の戻り値型 `{ orgId: string; created: boolean }` はTask 3(Functions内部ロジック)・Task 4(Callable)・Task 5(クライアントラッパー)で一貫。

**発見した追加の設計判断（Task 13）:** v1テンプレートとv2 envelopeが同一Firestoreコレクション（`templates/{templateId}`）を共有する設計上、`ownerUid`（v1由来）と`orgId`/`createdByUid`（v2由来）が同一ルールセットで共存する必要があることが判明した。v2 envelopeにも`ownerUid`を複製して書き込むことでルール分岐を避けたが、これは暫定策としてTask 13内に明記した。
