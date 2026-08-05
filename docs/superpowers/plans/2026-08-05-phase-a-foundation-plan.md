# Phase A: 安全化と新基盤 Implementation Plan

> **正本は統合仕様書。** `docs/superpowers/specs/2026-08-05-integrated-platform-spec.md`（§1・§3・§6・§7・§21.1・§25・§26・§27.1・§30）と `docs/superpowers/specs/2026-08-05-integrated-spec-resolutions.md`（D・E）が優先する。本計画と両文書が矛盾する場合は両文書を優先し、本計画側の誤りとして扱う。
>
> **`docs/superpowers/plans/2026-08-05-phase1a-org-schema-functions-plan.md` を素材として流用している。** 個人組織の器（`organizations/personal_{uid}`）、`orgId` のルール強制パターン、Functions基盤の雛形、draft/version分離の考え方はそちらの実装をほぼそのまま踏襲する。ただし次の点で異なる。
>
> - v1→v2変換、v1/v2同一コレクション策は行わない。既存利用者がいないため（統合仕様書 §1）、新コレクションへゼロから書く。
> - `LessonRun`・`LessonEvent`・`LessonCheckpoint`（統合仕様書 §7.4〜§7.7）を本計画の範囲に含める。
> - 旧クラシック市場（`src/lib/market/`・`liveMarkets`・`markets`・`marketResults`）と旧テンプレートv1（`src/lib/templates/`・`templates`・`officialTemplates`・`templateShares`）を、修正ではなく削除する。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 旧クラシック市場（教師ブラウザが毎秒価格を刻む、`ownerUid`フラット所有、先読み可能な `prices/*/runtime` と `companies/*/phases`）と旧テンプレートv1を削除し、`orgId`所有・個人組織・権限3層・`LessonTemplate`/`LessonVersion`/`LessonRun`/`LessonEvent`/`LessonCheckpoint`・公開/非公開パス分離・冪等処理・個人データ削除/エクスポートという新基盤をゼロから構築する。授業UI・教室表示・参加/チーム（Phase B）、3秒バッチ市場・注文/約定（Phase C）は範囲外。

**Architecture:** 個人組織 `organizations/personal_{uid}` は決定的IDを持ち、クライアントからは作成できない冪等なCloud Functions Callableで作成する。権限は3層（Firestoreメンバーシップが正本、RTDB `orgAccess` がミラー、カスタムクレームは `operator` のみ）とし、ミラー不整合時は拒否側へ倒す。`LessonTemplate`（`draft` + 不変版へのポインタ）/`LessonVersion`（不変）/`LessonRun`（テンプレートスナップショットと `randomSeed` を開始時に固定）は新規Firestoreコレクション（`lessonTemplates`・`lessonRuns`）に置く。`LessonEvent`（追記専用、`sequence`、`idempotencyKey`）と `LessonCheckpoint`（`restoreGeneration`）はクライアントから直接書けない設計とし、Cloud Functions Callable経由でのみ追記される——これによりFirestoreトランザクションで `sequence` の単調増加と `idempotencyKey` の重複排除を保証できる。将来のライブ市場データ（教師ブラウザではなくサーバーが権威を持つ、Phase C以降で実装）のための公開/非公開RTDBパスは、**旧`liveMarkets`ツリーを修正するのではなく最初から独立した2つのトップレベルノード**（`lessonRunPublic/{runId}`・`lessonRunPrivate/{runId}`）として設計する——祖先が許可した読み取りを子孫の `.read: false` が取り消せないというRTDBのルールカスケードにより、両者を同じ祖先の下に置くこと自体が将来の先読み脆弱性の再発条件になるため。個人データの削除・エクスポートは、統合仕様書 §21.1 により有料機能ではなく基盤機能として、個人組織スコープのCallableで提供する。

**Tech Stack:** TypeScript, Firebase Firestore/RTDB（セキュリティルール）, Firebase Admin SDK (`firebase-admin`), Cloud Functions for Firebase v2 API (`firebase-functions/v2/https`), npm workspaces, `@firebase/rules-unit-testing`（Rules Emulator）, Vitest, Firebase modular client SDK, oxlint。

## Global Constraints

- 各タスクは完了時に `npm run verify`（`lint` → `typecheck` → `test` → `test:rules` → `build` → `functions`/`packages/*` の `verify`、`package.json`）を通すこと。
- **授業UI・教室表示・参加/チーム機能は実装しない（Phase B）。** 生徒参加フロー、教師の授業進行画面、教室表示は本計画に含めない。
- **3秒バッチ市場・注文/約定・需給・ノイズ・価格ガードは実装しない（Phase C）。** `pricingCore.ts` の丸め/クランプ数式そのものの移植も行わない——旧実装は削除し、Phase C担当者が `git log` で参照する。
- **家庭科（Phase D）、AI・Guided Builder（Phase E）、学校組織UI・招待・課金（Phase F）は実装しない。**
- 本計画では**学校組織のUIは作らないが、個人組織で権限3層・イベントログ・チェックポイントが実際に動く状態まで実装する**（統合仕様書の指示メモに明記）。`organizations/{orgId}/members/{uid}` の複数メンバー対応・招待は本計画に含めないが、ルール自体は「1メンバー」を前提にしない形で書く。
- 決定的ID `organizations/personal_{uid}` はどの層（クライアント、Functions、Firestore/RTDBルール）でも同じ文字列連結 `'personal_' + uid` で計算する。フォーマットを変えるときは3箇所すべてを同時に直す。
- 生徒へ将来価格・非公開係数・乱数シードを送らない（統合仕様書 §26-1）。同一冪等キーを複数回実行しない（§26-4）。組織アクセスミラーの不整合時は許可側へ倒さない（§26-18）。旧データ互換のために新モデルを複雑化しない（§26-10）。
- 冪等キーをFirestore/RTDB pathへ生で使わず、`sha256(scope + '\0' + key)`へ変換する。再試行の意味が同一であることは、オブジェクトキー順を正規化する`canonicalJson`のrequest digestで検証し、同じキー・異なる意味は拒否する。
- 乱数は `Math.random()` を使わない。決定的な文字列ハッシュ＋擬似乱数（FNV-1a・mulberry32等）で導出し、クライアント・サーバーで同一モジュールを共有する（統合仕様書矛盾解消D）。
- Rules Emulatorテストは権限のみを検証する。帯域測定は本計画に含めない（Phase 0bの既存知見のとおり）。

---

## 旧実装の廃止範囲（一覧）

統合仕様書 §1「旧実装は参照用に限り、不要なコードは削除する」と §26-10「旧データ互換のために新モデルを複雑化しない」に従い、次を**削除**する。削除後に必要になった場合は `git log` で参照する（コード上には残さない）。

### 削除するファイル

| ファイル | 削除理由 |
| --- | --- |
| `src/lib/market/hostTrading.ts`, `.test.ts` | 教師ブラウザが毎秒ティックする client-driven エンジン全体（`runHostTick`、`publishPrices`、`processPendingOrder`、`acquireHostLease`等）。サーバー権威の3秒バッチ（Phase C）に置き換わり、旧設計そのものが不変条件（§26-11「教師のブラウザ停止で市場処理が止まる設計にしない」）に反する。 |
| `src/lib/market/marketRepository.ts`, `.test.ts` | `ownerUid`フラット所有・`MARKET_CAPACITY = 80`固定・`markets`/`marketJoinCodes`コレクション操作。`orgId`所有・可変定員モデルに置き換わる。 |
| `src/lib/market/liveMarketTypes.ts` | 旧`LiveMarketState`一式（`LivePrice`に`runtime`同居、`companies`に`phases`同居)。公開/非公開分離の対象そのもの。 |
| `src/lib/market/signageData.ts`, `.test.ts` | 旧教室表示データ整形。教室表示はPhase B。 |
| `src/lib/market/marketStatusLabels.ts`, `.test.ts` | 旧5状態（SETUP/OPEN/PAUSED/ENDING/ENDED）の日本語ラベル。`LessonRun.status`（§8.2の10状態）に置き換わる。 |
| `src/lib/pricing/pricingCore.ts`, `.test.ts` | `createPhaseRuntime`が`seed = Math.random() * 1000`を既定引数に持つ（矛盾解消Dが名指しした非決定性の原因）。`clampToBounds`/`applyMeanReversion`/フェーズ窓計算などの純粋数式はPhase Cで**参照はするが移植はしない**——今削除せず残すと未使用コードとして基盤に残り続け、§26-10の精神に反する。 |
| `src/lib/pricing/types.ts` | `StockPricePhase`/`PriceRuntimeState`。旧`phases`/`runtime`の型そのもの。 |
| `src/lib/templates/templateRepository.ts`, `.test.ts` | `ownerUid`フラット所有の`templates`/`officialTemplates`/`templateShares`操作。 |
| `src/lib/templates/types.ts` | `TemplateSpec`/`PersonalTemplate`/`OfficialTemplate`/`TemplateShare`。`LessonTemplate`/`LessonVersion`に置き換わる。 |
| `src/lib/templates/templateValidation.ts`, 対応する `.test.ts`（存在すれば） | 旧`TemplateSpec`専用のバリデーション。 |
| `src/lib/templates/officialSeeds.ts`, `.test.ts` | 旧公式3テンプレート（学園祭・宇宙都市・地域再生）のv1シード。新シードはPhase B/Cで`LessonVersion`として作り直す。 |
| `src/lib/teacher/marketDeletion.ts`, `.test.ts` | `marketResults`/`liveMarkets`を対象にした旧削除ロジック。30日ヒューリスティックの**考え方**はTask 12で新モデルへ引き継ぐが、コードは削除。 |
| `src/lib/teacher/resultsExport.ts`, `.test.ts`（存在確認の上） | 旧`marketResults`のCSVエクスポート。CSVインジェクション対策（先頭`'`付与）の**考え方**はTask 11で引き継ぐが、コードは削除。 |
| `src/components/teacher/WorkspacePicker.tsx` | 旧市場一覧・作成UI。 |
| `src/components/teacher/ControlRoom.tsx` | 旧ホストコンソール（`window.setInterval(tick, 1_000)`で`runHostTick`を毎秒呼ぶ、client-drivenアーキテクチャの実体）。 |
| `src/components/teacher/MarketStocksPage.tsx` | 旧銘柄編集UI。 |
| `src/components/student/StudentMarketJoin.tsx` | 旧参加コード入力UI。 |
| `src/components/student/StudentMarketPage.tsx` | 旧生徒売買UI。 |
| `src/components/signage/SignagePage.tsx` | 旧教室表示。 |
| `src/components/TemplateRoutes.tsx` | 旧テンプレートCRUD UI。 |
| `test/classroom-flow.rules.test.ts` | 旧E2Eフロー（作成→参加→売買→確定）が`liveMarkets`/`markets`の形そのものに依存。 |

### 削除に伴う付随作業

- [ ] 上記コンポーネントが唯一の消費者である子コンポーネント・フックを`git grep -rl`で洗い出し、併せて削除する（例: `ControlRoom.tsx`専用の子コンポーネントがあれば連鎖削除）。**推測でパスを列挙しない。実施時に `git grep -l "from '.*ControlRoom'" -- src` 等で確認すること。**
- [ ] `src/App.tsx` から上記コンポーネントのimportと対応する`<Route>`（`/templates`、`/templates/share/:shareId`、`/teacher/markets`、`/teacher/markets/:marketId/room`、`/teacher/markets/:marketId/stocks`、`/teacher/markets/:marketId/host`、`/join`、`/markets/:marketId/play`、`/markets/:marketId/signage`）を削除する。
- [ ] `LandingPage`（`App.tsx`内）のCTA（「先生はこちら」「授業をはじめる」「生徒として参加」）とフッターリンクが削除したルート（`/teacher/markets`・`/join`）を指している。これらのリンク・ボタンを削除するか `/about` へ張り替え、壊れたリンクを残さない。
- [ ] `vite.rules.config.ts` の `include` から `'src/lib/teacher/marketDeletion.test.ts'` を除去する（ファイル自体を削除するため）。
- [ ] `firestore.rules` から `templates`・`officialTemplates`・`templateShares`・`markets`・`marketJoinCodes`・`marketResults/*/participants`・`marketResults/*/teams` の`match`ブロックをすべて削除する（Task 1で実施、新ブロックへの置き換えはTask 4・6・7）。
- [ ] `database.rules.json` から `liveMarkets` ツリー全体（`meta`・`teams`・`companies`・`members`・`participants`・`joinRequests`・`hostLease`・`hostDisconnects`・`prices`・`news`・`orders`・`teamPortfolios`・`teamLeaderboard`・`transactions`・`signage`）を削除する（Task 1）。`serviceStatus`は緊急停止スイッチとして存続する。

### 既存テストの扱い

| テストファイル | 扱い |
| --- | --- |
| `test/classroom-flow.rules.test.ts` | 削除（上記） |
| `test/database.rules.test.ts` | ファイルは残す。`liveMarkets`系の`describe`ブロックをすべて削除し、Task 4以降で`orgAccess`・`lessonRunPublic`・`lessonRunPrivate`向けの新規`describe`を追加する。 |
| `test/firestore.rules.test.ts` | ファイルは残す。`market Firestore rules`・`template Firestore rules`・`emergency stop`の3`describe`のうち、`markets`/`templates`/`officialTemplates`/`templateShares`に依存する部分を削除し、`serviceStatus`（emergency stop）関連は残す。Task 4以降で`organizations`・`lessonTemplates`・`lessonRuns`向けの新規`describe`を追加する。 |
| `src/lib/auth/roles.test.ts` | 変更なし（`isTeacherIdentity`はUI表示用の型ガードとして存続、認可の唯一の根拠ではなくなる——Task 4のコメントで明記） |
| `src/lib/auth/studentAuth.test.ts`, `teacherAuth.test.ts` | 変更なし（匿名/Google認証のメカニズム自体は存続） |
| `src/lib/firebase/*.test.ts`（`appCheck`・`bootstrap`・`connectionState`・`firebaseConfig`・`serverTime`・`useEmulators`） | 概ね変更なし。`firebaseConfig.test.ts`・`useEmulators.test.ts`はTask 2で`Functions`サービス追加に伴う軽微な更新のみ。 |

---

## File Structure

| File | Change |
| --- | --- |
| `functions/package.json`, `functions/tsconfig.json`, `functions/.gitignore`, `functions/src/index.ts`, `functions/src/ping.ts`, `.test.ts` | Create（Task 1、`phase1a`計画Task 1をそのまま流用） |
| `package.json` | Modify（`workspaces`追加、`verify`スクリプト拡張） |
| `firebase.json` | Modify（`functions`セクション、`emulators.functions`追加） |
| `packages/deterministic-random/package.json`, `tsconfig.json`, `src/index.ts`, `src/index.test.ts` | Create（Task 3、決定的PRNG共有パッケージ） |
| `src/lib/org/personalOrgId.ts`, `.test.ts` / `functions/src/lib/personalOrgId.ts`, `.test.ts` | Create（Task 3） |
| `functions/src/lib/idempotency.ts`, `.test.ts` | Create（Task 3、path-safe keyとcanonical request digest） |
| `firestore.rules` | Modify（Task 1で旧ブロック削除、Task 4/6/7/8/9で新ブロック追加） |
| `database.rules.json` | Modify（Task 1で`liveMarkets`削除、Task 4/10で`orgAccess`・`orgAccessMeta`・`lessonRunPublic`・`lessonRunPrivate`追加） |
| `functions/src/organizations/personalOrg.ts`, `.test.ts`, `onCall.ts`, `.test.ts` | Create（Task 5） |
| `src/lib/org/ensurePersonalOrg.ts`, `.test.ts` | Create（Task 5） |
| `src/lib/firebase/firebaseConfig.ts`, `useEmulators.ts`, `bootstrap.ts`（+対応test） | Modify（Task 2・5、`Functions`サービスと`ensurePersonalOrg`呼び出し配線） |
| `src/lib/lessonTemplates/types.ts`, `repository.ts`, `.test.ts` | Create（Task 6） |
| `functions/src/lessonRuns/createLessonRun.ts`, `.test.ts`, `onCall.ts` / `src/lib/lessonRuns/types.ts`, `createLessonRun.ts`（クライアントラッパー）, `.test.ts` | Create（Task 7） |
| `functions/src/lessonRuns/appendLessonEvent.ts`, `.test.ts`, `onCall.ts` / `src/lib/lessonRuns/appendLessonEvent.ts`, `.test.ts` | Create（Task 8） |
| `functions/src/lessonRuns/checkpoint.ts`, `.test.ts`, `onCall.ts` / `src/lib/lessonRuns/checkpoint.ts`, `.test.ts` | Create（Task 9） |
| `src/lib/lessonRuns/liveTypes.ts`, `.test.ts` | Create（Task 10） |
| `functions/src/privacy/exportPersonalData.ts`, `.test.ts`, `onCall.ts` / `src/lib/privacy/exportPersonalData.ts`, `.test.ts` | Create（Task 11） |
| `functions/src/privacy/deletePersonalData.ts`, `.test.ts`, `onCall.ts` / `src/lib/privacy/deletePersonalData.ts`, `.test.ts` | Create（Task 12） |
| `src/App.tsx` | Modify（Task 1、旧ルート削除） |
| `test/firestore.rules.test.ts`, `test/database.rules.test.ts` | Modify（Task 1で旧`describe`削除、以降のタスクで新規追加） |
| `vite.rules.config.ts` | Modify（Task 1） |

---

## Task 1: 旧実装の削除

**Files:**
- Delete: 「削除するファイル」表のすべて
- Modify: `src/App.tsx`, `firestore.rules`, `database.rules.json`, `vite.rules.config.ts`, `test/firestore.rules.test.ts`, `test/database.rules.test.ts`

- [ ] **Step 1: 削除対象の依存関係を洗い出す**

Run:
```bash
git grep -l "from '.*market" -- src | sort
git grep -l "from '.*templates" -- src | sort
git grep -l "from '.*pricing" -- src | sort
```
Expected: 上記ファイルと、それらに依存する追加のコンポーネント/フックが列挙される。列挙されたファイルのうち「削除するファイル」表に無いものは、削除するか残すかをこのステップで判断し、後続ステップの削除リストへ追記する。

- [ ] **Step 2: ファイルを削除する**

```bash
git rm src/lib/market/hostTrading.ts src/lib/market/hostTrading.test.ts \
  src/lib/market/marketRepository.ts src/lib/market/marketRepository.test.ts \
  src/lib/market/liveMarketTypes.ts \
  src/lib/market/signageData.ts src/lib/market/signageData.test.ts \
  src/lib/market/marketStatusLabels.ts src/lib/market/marketStatusLabels.test.ts \
  src/lib/pricing/pricingCore.ts src/lib/pricing/pricingCore.test.ts src/lib/pricing/types.ts \
  src/lib/templates/templateRepository.ts src/lib/templates/templateRepository.test.ts \
  src/lib/templates/types.ts src/lib/templates/officialSeeds.ts src/lib/templates/officialSeeds.test.ts \
  src/lib/teacher/marketDeletion.ts src/lib/teacher/marketDeletion.test.ts \
  src/components/teacher/WorkspacePicker.tsx src/components/teacher/ControlRoom.tsx \
  src/components/teacher/MarketStocksPage.tsx src/components/student/StudentMarketJoin.tsx \
  src/components/student/StudentMarketPage.tsx src/components/signage/SignagePage.tsx \
  src/components/TemplateRoutes.tsx test/classroom-flow.rules.test.ts
```
（`src/lib/templates/templateValidation.ts`・`src/lib/teacher/resultsExport.ts`はStep 1の`git grep`結果に応じて追加で`git rm`する。Step 1で追加発見したファイルも同様。）

- [ ] **Step 3: `src/App.tsx` から旧ルートを削除する**

削除後の`AppRoutes`は次の形になる（`docPages`・静的ページ・`NotFound`のみ残す）。

```tsx
import { BrowserRouter, Link as RouterLink, Navigate, Route, Routes, useLocation } from 'react-router'
import { Box, Button, CssBaseline, Link, Stack, ThemeProvider, Typography } from '@mui/material'
import { appTheme } from './theme/theme'
import { AboutPage, ContactPage, GuidePage, PrivacyPage, TermsPage } from './components/PublicDocs'
import { NotFoundPage } from './components/ui/NotFoundPage'

const docPages: Record<string, () => React.JSX.Element> = {
  '/about': AboutPage,
  '/guide': GuidePage,
  '/terms': TermsPage,
  '/privacy': PrivacyPage,
  '/contact': ContactPage,
}

const landingCtaSx = {
  backgroundColor: 'var(--landing-cta)',
  color: 'var(--landing-on-cta)',
  '&:hover': { backgroundColor: 'var(--landing-cta-hover)' },
}

/** Landing page during Phase A: the lesson product itself is not wired up yet
 * (Phase B/C). CTAs point at /about instead of the removed /teacher/markets
 * and /join routes so no link is left dangling. */
const LandingPage = () => <main className="landing-page">
  <Box component="header" className="landing-nav">
    <Link component={RouterLink} className="brand" to="/" underline="none" color="inherit" aria-label="Stock League Classroom ホーム" sx={{ minHeight: 48, display: 'inline-flex', alignItems: 'center' }}>Stock League <span>Classroom</span></Link>
    <Stack component="nav" direction="row" aria-label="主要ナビゲーション" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
      <Link href="#how-it-works" color="inherit" sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', px: 1 }}>使い方</Link>
      <Link href="#features" color="inherit" sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', px: 1 }}>特徴</Link>
      <Button component={RouterLink} className="nav-cta" to="/about" variant="contained" sx={{ ...landingCtaSx, minHeight: 44 }}>詳しく見る</Button>
    </Stack>
  </Box>
  <section className="landing-closing"><p>準備を進めています。</p><h2>まもなく教室に市場をひらけます。</h2><Button component={RouterLink} to="/about" variant="contained" size="large" sx={{ backgroundColor: 'var(--landing-closing-cta)', color: 'var(--landing-closing-on-cta)', '&:hover': { backgroundColor: 'var(--landing-closing-cta-hover)' } }}>サービス概要を見る <span aria-hidden="true">→</span></Button></section>
  <Box component="footer"><Typography component="span" variant="body2">© 2026 Stock League Classroom</Typography><Stack component="nav" direction="row" aria-label="サービス情報" sx={{ flexWrap: 'wrap', gap: { xs: 0.5, sm: 1.5 } }}>{[['/about', 'サービス概要'], ['/guide', '操作マニュアル'], ['/terms', '利用規約'], ['/privacy', 'プライバシーポリシー'], ['/contact', '問い合わせ']].map(([to, label]) => <Link component={RouterLink} to={to} color="inherit" key={to} sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', px: 0.5 }}>{label}</Link>)}</Stack></Box>
</main>

const TrailingSlashRedirect = () => {
  const { pathname, search, hash } = useLocation()
  if (pathname === '/' || !pathname.endsWith('/')) return null
  return <Navigate replace to={`${pathname.replace(/\/+$/, '')}${search}${hash}`} />
}

const AppRoutes = () => <><TrailingSlashRedirect /><Routes>
  <Route path="/" element={<LandingPage />} />
  {Object.entries(docPages).map(([path, Page]) => <Route path={path} element={<Page />} key={path} />)}
  <Route path="*" element={<NotFoundPage />} />
</Routes></>

export default function App() {
  return <ThemeProvider theme={appTheme}>
    <CssBaseline />
    <BrowserRouter><AppRoutes /></BrowserRouter>
  </ThemeProvider>
}
```

- [ ] **Step 4: `firestore.rules` から旧コレクションのブロックを削除する**

`templates`・`officialTemplates`・`templateShares`・`markets`・`marketJoinCodes`・`marketResults/*/participants`・`marketResults/*/teams`の7`match`ブロックを削除する。`serviceStatus`ブロックと`signedIn()`/`teacher()`/`operator()`/`serviceOpen()`関数、末尾の`match /{document=**} { allow read, write: if false; }`は残す。

- [ ] **Step 5: `database.rules.json` から `liveMarkets` ツリーを削除する**

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "serviceStatus": {
      ".read": "auth != null",
      ".write": "auth != null && auth.token.operator === true",
      ".validate": "newData.hasChild('acceptingNewMarkets') && newData.child('acceptingNewMarkets').isBoolean()"
    }
  }
}
```

- [ ] **Step 6: `vite.rules.config.ts` の`include`を更新する**

```ts
import { defineConfig } from 'vitest/config'

/** Rules tests run within firebase emulators:exec, not the normal browser suite. */
export default defineConfig({
  test: { environment: 'node', include: ['test/*.rules.test.ts'] },
})
```

- [ ] **Step 7: `test/firestore.rules.test.ts` から旧`describe`ブロックを削除する**

`market Firestore rules`・`template Firestore rules`の2ブロックと、`beforeEach`内の`templates`/`officialTemplates`/`templateShares`/`markets`/`marketJoinCodes`シードを削除する。`emergency stop`ブロックとその依存（`serviceStatus`）は残す。ファイル冒頭の`template`定数（旧`TemplateSpec`）はもう使われないため削除する。

- [ ] **Step 8: `test/database.rules.test.ts` から旧`describe`ブロックを削除する**

`liveMarkets`に依存するシード（`seed`定数、`approveStudent`ヘルパー）と全`describe`ブロックを削除する。ファイルは空の import 群だけが残る状態でよい（Task 4以降で新規`describe`を追加する）。

- [ ] **Step 9: 型チェックとテストで壊れた参照を洗い出す**

Run: `npm run typecheck`
Expected: 削除済みファイルへの残存import・未使用exportがコンパイルエラーとして列挙される。エラーが解消するまでStep 1〜8を繰り返す。

- [ ] **Step 10: `npm test` を実行し、残ったテストが通ることを確認する**

Run: `npm test`
Expected: 削除対象外のテスト（`src/lib/auth/*`、`src/lib/firebase/*`、`src/components/PublicDocs`等）がすべて成功する。

- [ ] **Step 11: `npm run test:rules` を実行する**

Run: `npm run test:rules`
Expected: 縮小した`firestore.rules.test.ts`・`database.rules.test.ts`（`emergency stop`のみ）が成功する。

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "chore: remove the classic client-driven market and v1 templates"
```

---

## Task 2: Functions workspace bootstrap

`docs/superpowers/plans/2026-08-05-phase1a-org-schema-functions-plan.md` の Task 1 をそのまま実施する。要旨のみ再掲する（詳細な手順・コード全文は元計画を参照すること——内容は同一で、本計画側で変更する箇所はない）。

**Files:**
- Create: `functions/package.json`, `functions/tsconfig.json`, `functions/.gitignore`, `functions/src/index.ts`, `functions/src/ping.ts`, `functions/src/ping.test.ts`
- Modify: `package.json`（`workspaces: ["functions"]`、`verify`スクリプトへ`npm run verify --workspace=functions`を追加）, `firebase.json`（`functions`セクション、`emulators.functions`）

- [ ] **Step 1: Blazeプランへの移行を実施する（手動、本番プロジェクト）** — `phase1a`計画 Task 1 Step 1と同一。実施日・担当者・予算アラート設定値をこのチェックボックス下にメモする。
- [ ] **Step 2〜16:** `phase1a`計画 Task 1 の Step 3〜16（`functions/package.json`・`tsconfig.json`・`.gitignore`・`ping.ts`のTDD・`index.ts`・ルート`package.json`の`workspaces`追加・`firebase.json`の`functions`/`emulators.functions`追加・エミュレータ動作確認）をそのまま実施する。**唯一の差分:** ルート`package.json`の`verify`スクリプトは、本計画がTask 1で`test:rules`の対象を縮小済みであるため、`npm run lint && npm run typecheck && npm test && npm run test:rules && npm run build && npm run verify --workspace=functions`のままでよい（`phase1a`計画と同一）。
- [ ] **Step 17: `npm run verify` を通す**

Run: `npm run verify`
Expected: Task 1で縮小した既存スイート一式に加え、`functions`の`verify`（`lint`/`typecheck`/`test`/`build`）も成功する。

- [ ] **Step 18: Commit**

```bash
git add functions package.json firebase.json
git commit -m "build: scaffold functions/ workspace with a smoke-test callable"
```

---

## Task 3: 共通ユーティリティ — `personalOrgId` と決定的PRNG

**Files:**
- Create: `src/lib/org/personalOrgId.ts`, `.test.ts` / `functions/src/lib/personalOrgId.ts`, `.test.ts`
- Create: `functions/src/lib/idempotency.ts`, `.test.ts`
- Create: `packages/deterministic-random/package.json`, `tsconfig.json`, `src/index.ts`, `src/index.test.ts`
- Modify: ルート`package.json`（`workspaces`に`packages/deterministic-random`を追加）, `functions/package.json`（依存に追加）

**Interfaces:**
- Produces: `personalOrgId(uid: string): string`（`docs/superpowers/plans/2026-08-05-phase1a-org-schema-functions-plan.md` Task 2と同一実装。以降すべてのタスクが使う）
- Produces: `idempotencyDocumentId(scope, key)`、`canonicalJson(value)`、`requestDigest(value)`（Task 6〜9・12で共用）
- Produces: `fnv1aHash(input: string): number`、`mulberry32(seed: number): () => number`、`deriveSeed(parts: (string | number)[]): number`（Task 8・9および将来のPhase C/Dが使う）

- [ ] **Step 1〜7: `personalOrgId`** — `phase1a`計画 Task 2 のStep 1〜7をそのまま実施する（クライアント側`src/lib/org/personalOrgId.ts`、Functions側`functions/src/lib/personalOrgId.ts`、同一実装・同一テスト）。

- [ ] **Step 8: 決定的PRNGパッケージの失敗するテストを書く**

その前に`functions/src/lib/idempotency.test.ts`で、slash/長大キーが常に64桁hex IDになること、scopeが違えばIDが違うこと、`{a:1,b:2}`と`{b:2,a:1}`のdigestが一致すること、配列順や値が違えばdigestが変わることを失敗テストとして追加する。`idempotency.ts`はSHA-256と、plain objectのキーを再帰的にソートする`canonicalJson`を実装する（`undefined`、循環参照、非JSON値は拒否）。後続タスクの生の`createHash`/`JSON.stringify`はこのhelperへ置き換える。Task 6/7/8/9/12の各テストにも、意味が同じでobject key順だけ異なる再試行がdeduplicateされるケースを最低1件ずつ入れる。

統合仕様書矛盾解消D「同一入力に対して同一出力になることをテストで保証する」に対応する。`packages/deterministic-random/src/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { deriveSeed, fnv1aHash, mulberry32 } from './index'

describe('fnv1aHash', () => {
  it('is deterministic for the same input', () => {
    expect(fnv1aHash('lesson-run-1:0:acme:3')).toBe(fnv1aHash('lesson-run-1:0:acme:3'))
  })
  it('differs for different inputs', () => {
    expect(fnv1aHash('a')).not.toBe(fnv1aHash('b'))
  })
})

describe('mulberry32', () => {
  it('produces the same sequence for the same seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })
  it('produces values in [0, 1)', () => {
    const rand = mulberry32(1)
    for (let i = 0; i < 100; i += 1) {
      const value = rand()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe('deriveSeed', () => {
  it('derives the same numeric seed from the same parts, per the D resolution format', () => {
    // seed = derive(`${randomSeed}:${restoreGeneration}:${stockId}:${batchIndex}`)
    const first = deriveSeed(['run-abc', 0, 'acme', 3])
    const second = deriveSeed(['run-abc', 0, 'acme', 3])
    expect(first).toBe(second)
  })
  it('derives a different seed when restoreGeneration changes, so a post-restore replay is not identical to the original', () => {
    const beforeRestore = deriveSeed(['run-abc', 0, 'acme', 51])
    const afterRestore = deriveSeed(['run-abc', 1, 'acme', 51])
    expect(beforeRestore).not.toBe(afterRestore)
  })
})
```

- [ ] **Step 9: 失敗を確認する**

Run: `cd packages/deterministic-random && npx vitest run src/index.test.ts`
Expected: FAIL — module not found

- [ ] **Step 10: 実装する**

```ts
// packages/deterministic-random/src/index.ts

/**
 * FNV-1a 32-bit hash. Deterministic across platforms and Node/browser — no
 * crypto API dependency, so it works identically in the Cloud Functions
 * runtime and the browser bundle.
 */
export const fnv1aHash = (input: string): number => {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * mulberry32: a small, fast, deterministic PRNG. Not cryptographically
 * secure — it must never be used for anything security-sensitive (tokens,
 * join codes). It exists solely so lesson replay can reproduce the exact
 * same sequence of "random" market noise / event outcomes from the same
 * seed, per spec resolution D.
 */
export const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Combines an ordered list of parts (LessonRun.randomSeed, restoreGeneration,
 * an entity id, a batch/round index — see resolutions.md section D) into a
 * single deterministic numeric seed via FNV-1a. Callers that need a stream of
 * random-looking values should feed the result into mulberry32.
 */
export const deriveSeed = (parts: (string | number)[]): number => fnv1aHash(parts.join(':'))
```

- [ ] **Step 11: `packages/deterministic-random/package.json`・`tsconfig.json`を作成する**

```json
{
  "name": "@stock-league/deterministic-random",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "lint": "oxlint src",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "verify": "npm run lint && npm run typecheck && npm test"
  },
  "devDependencies": { "oxlint": "^1.71.0", "typescript": "~6.0.2", "vitest": "^4.1.10" }
}
```

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "lib": ["ES2022"], "strict": true, "noUnusedLocals": true, "noUnusedParameters": true, "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 12: テストを通す**

Run: `cd packages/deterministic-random && npm install && npx vitest run src/index.test.ts`
Expected: PASS

- [ ] **Step 13: ルート`package.json`と`functions/package.json`に依存として組み込む**

ルート`package.json`の`workspaces`を`["functions", "packages/deterministic-random"]`にする。`functions/package.json`の`dependencies`に`"@stock-league/deterministic-random": "*"`を追加する。`src/`側（クライアント）でも同様にルートの依存関係経由で`import { deriveSeed, mulberry32 } from '@stock-league/deterministic-random'`が解決できることを、Task 8で実際に使う際に確認する。

- [ ] **Step 14: `npm install`をルートから実行し、両ワークスペースが解決することを確認する**

Run: `npm install`
Expected: `node_modules/@stock-league/deterministic-random`と`node_modules/functions`のシンボリックリンクが作成される。

- [ ] **Step 15: `npm run verify` を通す**

Run: `npm run verify`
Expected: 全ワークスペースの`verify`が成功する。

- [ ] **Step 16: Commit**

```bash
git add src/lib/org packages/deterministic-random functions/src/lib functions/package.json package.json
git commit -m "feat: add personalOrgId and a shared deterministic PRNG for replay"
```

---

## Task 4: 権限3層の基盤 — Firestoreメンバーシップとルール、RTDB `orgAccess` ミラー

統合仕様書 §6.3「カスタムクレームは`operator`等のみ、Firestoreが正本、RTDBがミラー」を実装する。`phase1a`計画Task 6・Task 8の`orgAccess`部分を土台にするが、**「不整合時は拒否」を明示的にテストする点が新規**（統合仕様書 §26-18）。

**Files:**
- Modify: `firestore.rules`, `database.rules.json`, `test/firestore.rules.test.ts`, `test/database.rules.test.ts`

**Interfaces:**
- Consumes: `personalOrgId` (Task 3)
- Produces: `organizations/{orgId}`・`organizations/{orgId}/members/{uid}`・`users/{uid}`（Firestore、Admin SDK専用書き込み）、`orgAccess/{orgId}/{uid}`と`orgAccessMeta/{orgId}/{uid}`（RTDB、Admin SDK専用書き込み、メンバー単位の版一致必須）

- [ ] **Step 1: Firestore側の失敗するルールテストを書く**

`test/firestore.rules.test.ts`に追記する。

```ts
describe('organization membership Firestore rules', () => {
  it('lets a member read only their own org, member doc, and user doc', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'organizations', 'personal_teacher-a'), { type: 'personal', ownerUid: 'teacher-a' })
      await setDoc(doc(context.firestore(), 'organizations', 'personal_teacher-a', 'members', 'teacher-a'), { role: 'owner', status: 'active', membershipVersion: 1 })
      await setDoc(doc(context.firestore(), 'users', 'teacher-a'), { personalOrgId: 'personal_teacher-a' })
    })
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    const other = environment.authenticatedContext('teacher-b', teacherToken).firestore()
    await assertSucceeds(getDoc(doc(owner, 'organizations', 'personal_teacher-a')))
    await assertFails(getDoc(doc(other, 'organizations', 'personal_teacher-a')))
    await assertSucceeds(getDoc(doc(owner, 'organizations', 'personal_teacher-a', 'members', 'teacher-a')))
    await assertSucceeds(getDoc(doc(owner, 'users', 'teacher-a')))
  })

  it('rejects any client write to organizations, members, or users', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await assertFails(setDoc(doc(owner, 'organizations', 'personal_teacher-a'), { type: 'personal', ownerUid: 'teacher-a' }))
    await assertFails(setDoc(doc(owner, 'organizations', 'personal_teacher-a', 'members', 'teacher-a'), { role: 'owner', status: 'active', membershipVersion: 1 }))
    await assertFails(setDoc(doc(owner, 'users', 'teacher-a'), { personalOrgId: 'personal_teacher-a' }))
  })

  it('denies a suspended member even though the membership doc still exists', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'organizations', 'personal_teacher-a', 'members', 'teacher-a'), { role: 'owner', status: 'suspended', membershipVersion: 2 })
    })
    // Suspension itself is enforced at the resource-rule level (Task 6/7's
    // lessonTemplates/lessonRuns rules re-check membership status), not by
    // blocking reads of the membership doc — a suspended member must still
    // be able to see that they are suspended.
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await assertSucceeds(getDoc(doc(owner, 'organizations', 'personal_teacher-a', 'members', 'teacher-a')))
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npm run test:rules`
Expected: FAIL — `organizations`/`users`に既存ルールがなく`{document=**}`のデフォルト拒否に落ちる。

- [ ] **Step 3: `firestore.rules`へ3ブロックを追加する**

`match /serviceStatus/{documentId} { ... }`の直後に挿入する。

```
    function activeMember(orgId) {
      return exists(/databases/$(database)/documents/organizations/$(orgId)/members/$(request.auth.uid))
        && get(/databases/$(database)/documents/organizations/$(orgId)/members/$(request.auth.uid)).data.status == 'active';
    }

    match /users/{uid} {
      // Set only by the ensurePersonalOrg Callable (Admin SDK).
      allow get: if teacher() && uid == request.auth.uid;
      allow list: if false;
      allow write: if false;
    }

    match /organizations/{orgId} {
      // Personal organizations are created first, but the authorization
      // rule is membership-based from day one so Phase F can add school
      // organizations without replacing the security model.
      allow get: if teacher() && activeMember(orgId);
      allow list: if false;
      allow write: if false;
    }

    match /organizations/{orgId}/members/{uid} {
      // A member may always read their own membership doc, even if suspended
      // — they must be able to see their own status. Resource rules (not
      // this one) are what actually gate access once status != 'active'.
      allow get: if teacher() && uid == request.auth.uid;
      allow list: if false;
      allow write: if false;
    }
```

- [ ] **Step 4: テストを通す**

Run: `npm run test:rules`
Expected: PASS

- [ ] **Step 5: RTDB `orgAccess` ミラーの失敗するルールテストを書く**

`test/database.rules.test.ts`に追記する。

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

  it('does not let another uid read a mirror entry that is not theirs', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await set(ref(context.database(), 'orgAccess/personal_teacher-a/teacher-a'), { role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 })
    })
    const other = environment.authenticatedContext('teacher-b', teacherToken).database()
    await assertFails(get(ref(other, 'orgAccess/personal_teacher-a/teacher-a')))
  })

})
```

- [ ] **Step 6: `database.rules.json` に `orgAccess` を追加する**

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "serviceStatus": { "...": "変更なし" },
    "orgAccess": {
      "$orgId": {
        "$uid": {
          ".read": "auth != null && auth.uid === $uid",
          ".write": false
        }
      }
    },
    "orgAccessMeta": {
      "$orgId": {
        "$uid": {
          ".read": false,
          ".write": false
        }
      }
    }
  }
}
```

- [ ] **Step 7: テストを通す**

Run: `npm run test:rules`
Expected: PASS

- [ ] **Step 8: 不整合時に各データストアが独立して拒否側へ倒る契約を記録する**

Firestore RulesからRTDBを参照することも、RTDB RulesからFirestoreを参照することもできないため、「単一Rules式で両者を比較する」とは書かない。Firestoreリソースは`activeMember(orgId)`を必須にし、RTDBリソースは`orgAccess` entryの`membershipVersion`が`orgAccessMeta/{orgId}/{auth.uid}/membershipVersion`と一致し、かつ`status == 'active'`であることを必須にする。metaをメンバー単位にすることで、学校組織で1人のrole/statusを変えても無関係なメンバーをdenyしない。ミラーentry欠落・meta欠落・版不一致・停止のすべてをRTDBで拒否する。Task 5のAdmin SDK同期は対象メンバーのentryとmetaをRTDB rootのmulti-location `update()`で原子的に書く。

- [ ] **Step 9: `npm run verify` を通す**

Run: `npm run verify`
Expected: 成功。

- [ ] **Step 10: Commit**

```bash
git add firestore.rules database.rules.json test/firestore.rules.test.ts test/database.rules.test.ts
git commit -m "feat: add Firestore membership rules and the read-only orgAccess RTDB mirror"
```

---

## Task 5: `ensurePersonalOrg` — 個人組織の冪等作成

`phase1a`計画 Task 3〜5をそのまま実施するが、`membershipVersion`をTask 4のルールに合わせて明示する。

**Files:**
- Create: `functions/src/organizations/personalOrg.ts`, `.test.ts`, `onCall.ts`, `.test.ts`
- Create: `functions/src/organizations/membershipSync.ts`, `.test.ts`
- Create: `functions/src/organizations/authorization.ts`, `.test.ts`
- Create: `src/lib/org/ensurePersonalOrg.ts`, `.test.ts`
- Modify: `src/lib/firebase/firebaseConfig.ts`, `useEmulators.ts`, `bootstrap.ts`（+対応テスト）

**Interfaces:**
- Consumes: `personalOrgId`（Task 3）
- Produces: `ensurePersonalOrg(uid, deps): Promise<{ orgId: string; created: boolean }>`（Functions内部）、`ensurePersonalOrgCallable`（`onCall`）、`ensurePersonalOrg(functions): Promise<{ orgId; created }>`（クライアントラッパー）
- Produces: `syncOrganizationMembershipChange(deps, change)`（RTDBを`PENDING`へ倒してからFirestore正本を更新し、最後にRTDB entry/metaを原子的に`SYNCED`へ確定する再試行可能な内部関数）
- Produces: `requireActiveOrgMember(firestore, orgId, uid): Promise<ActiveMembership>`（Admin SDK Callable共通guard）

- [ ] **Step 1〜7:** `phase1a`計画 Task 3 のStep 1〜7を実施する。ただし`personalOrg.ts`の`ensurePersonalOrg`実装内、`writeOrgAccessMirror`の呼び出し値に`revokedAtSeconds: 0`を含める（Task 4のRTDBルールがフィールド不足を拒否しないため必須ではないが、統合仕様書§6.6の`revokedAtSeconds`の存在を組織作成の時点から前提にするため）。

```ts
export interface OrgAccessMirrorPayload {
  orgId: string
  uid: string
  role: 'owner'
  status: 'active'
  membershipVersion: number
  revokedAtSeconds: number
}
```

`ensurePersonalOrgWithAdminSdk`内の`writeOrgAccessMirror`呼び出しへ`revokedAtSeconds: 0`を追加する。実RTDB adapterはrootのmulti-location updateを使う。

```ts
await getDatabase().ref().update({
  [`orgAccess/${payload.orgId}/${payload.uid}`]: {
    role: payload.role,
    status: payload.status,
    membershipVersion: payload.membershipVersion,
    revokedAtSeconds: payload.revokedAtSeconds,
  },
  [`orgAccessMeta/${payload.orgId}/${payload.uid}`]: {
    membershipVersion: payload.membershipVersion,
    syncState: 'SYNCED',
  },
})
```

- [ ] **Step 8: ミラー不整合を常に拒否側へ倒す同期関数の失敗するテストを書く**

`membershipSync.test.ts`で、(a)最初に`markMirrorPending`、(b)次に`updateFirestoreMembership`、(c)最後に`commitMirrorSynced`の順で呼ばれることを検証する。Firestore更新または最終RTDB更新が失敗した場合はmetaが`PENDING`のままで、再試行により同じ`membershipVersion`で`SYNCED`へ収束することを検証する。grant・suspend・role changeのすべてを同じ関数へ通し、RTDBを直接更新する別経路を作らない。

- [ ] **Step 9: `syncOrganizationMembershipChange`を実装する**

```ts
export interface MembershipChange {
  orgId: string
  uid: string
  role: 'owner' | 'admin' | 'teacher'
  status: 'active' | 'suspended'
  membershipVersion: number
  revokedAtSeconds: number
}

export const syncOrganizationMembershipChange = async (
  deps: {
    markMirrorPending: (orgId: string, membershipVersion: number) => Promise<void>
    updateFirestoreMembership: (change: MembershipChange) => Promise<void>
    commitMirrorSynced: (change: MembershipChange) => Promise<void>
  },
  change: MembershipChange,
): Promise<void> => {
  await deps.markMirrorPending(change.orgId, change.membershipVersion)
  await deps.updateFirestoreMembership(change)
  await deps.commitMirrorSynced(change)
}
```

Admin adapterの`markMirrorPending`は`orgAccessMeta/{orgId}/{uid}`を`{ membershipVersion, syncState: 'PENDING' }`へ更新し、`commitMirrorSynced`は同じuidのentryとmetaをroot multi-location updateで一度に確定する。このpreflight denyを統合仕様書§6.6の失効手順より前へ置くことで、Firestore/RTDBのどちらかだけが新状態になっている期間も対象メンバーのRTDB readを拒否し、他メンバーには影響させない。

- [ ] **Step 10: Callable共通active-member guardをTDDで実装する**

```ts
import { HttpsError } from 'firebase-functions/v2/https'

export interface ActiveMembership {
  role: 'owner' | 'admin' | 'teacher'
  membershipVersion: number
}

export const requireActiveOrgMember = async (
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  uid: string,
): Promise<ActiveMembership> => {
  const snap = await firestore.doc(`organizations/${orgId}/members/${uid}`).get()
  if (!snap.exists || snap.get('status') !== 'active') {
    throw new HttpsError('permission-denied', '有効な組織メンバーではありません。')
  }
  return { role: snap.get('role'), membershipVersion: snap.get('membershipVersion') }
}
```

テストはactiveを返し、missingと`suspended`を`permission-denied`にする。Task 7のrun作成、Task 9の復元、Task 11/12のprivacy CallableはAdmin SDK処理前にこのguardを必ず呼ぶ。

- [ ] **Step 11〜18: Callableとクライアント配線をTDDで実装する**

`onCall.test.ts`でverified Google教師を許可し、未認証・匿名・未確認emailを拒否する`isCallerTeacher`を先に固定する。`ensurePersonalOrgCallable`は認証と教師identityを検証して`ensurePersonalOrgWithAdminSdk(uid)`だけを呼び、`functions/src/index.ts`からexportする。クライアント側は`getFunctions(getFirebaseApp(), 'asia-northeast1')`を返す`getFunctionsService`、Functions Emulator (`localhost:5001`)を第4引数として接続する`connectToEmulators`、`httpsCallable<void, EnsurePersonalOrgResult>(functions, 'ensurePersonalOrgCallable')`ラッパーをそれぞれテストして実装する。`bootstrap.ts`の`FirebaseServices`へFunctionsを追加し、教師サインイン確定後に冪等なラッパーを1回呼ぶ。既存のfirebase config/emulator/bootstrapテストを引数追加に合わせ、UIコンポーネントは変更しない。

- [ ] **Step 19: `npm run verify` を通す**

Run: `npm run verify`
Expected: 成功。

- [ ] **Step 20: Commit**

```bash
git add functions/src/organizations src/lib/org src/lib/firebase
git commit -m "feat: add idempotent ensurePersonalOrg callable and client wiring"
```

---

## Task 6: `LessonTemplate` / `LessonVersion` — draft/version分離

`phase1a`計画Task 10・13の設計を踏襲するが、v1が存在しないため単一コレクション内でのv1/v2分岐は行わない。統合仕様書 §7.2・§7.3をそのまま実装する。

**Files:**
- Create: `src/lib/lessonTemplates/types.ts`, `repository.ts`, `.test.ts`
- Create: `functions/src/lessonTemplates/publishLessonVersion.ts`, `.test.ts`, `onCall.ts`, `.test.ts`
- Create: `src/lib/lessonTemplates/publishLessonVersion.ts`, `.test.ts`
- Modify: `firestore.rules`, `test/firestore.rules.test.ts`

**Interfaces:**
- Consumes: `personalOrgId`（Task 3）、`activeMember`関数（Task 4、`firestore.rules`内）
- Produces: Phase A最小`LessonContent` envelope、クライアント`createLessonTemplate`・`saveDraft`、サーバー`publishLessonVersion(deps, input)`、`publishLessonVersionCallable`

- [ ] **Step 1: `LessonTemplate`/`LessonVersion`の型を定義する**

`src/lib/lessonTemplates/types.ts`:

```ts
import type { Timestamp } from 'firebase/firestore'

/**
 * Minimum content envelope for Phase A. The full authoring content (rounds, market
 * config, assessment rubric, etc. — spec §12/§13) is Phase C/D's concern.
 * Phase A only needs a content envelope stable enough to version.
 */
export interface LessonContent {
  schemaVersion: 1
  title: string
  description: string
  subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS'
}

export interface LessonTemplate {
  id: string
  orgId: string
  createdByUid: string
  draft: LessonContent
  currentPublishedVersionId: string | null
  status: 'DRAFT' | 'READY' | 'ARCHIVED'
  visibility: 'PRIVATE' | 'LINK' | 'ORGANIZATION' | 'PUBLIC'
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface LessonVersion {
  id: string
  templateId: string
  orgId: string
  schemaVersion: number
  content: LessonContent
  createdByUid: string
  createdAt: Timestamp
  changeSummary?: string
  parentVersionId?: string
  immutable: true
}
```

- [ ] **Step 2: リポジトリ関数の失敗するテストを書く**

`src/lib/lessonTemplates/repository.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createLessonTemplate, saveDraft } from './repository'
import type { LessonContent } from './types'

const draft: LessonContent = { schemaVersion: 1, title: '仮タイトル', description: '', subject: 'SOCIAL_STUDIES' }

let environment: RulesTestEnvironment
beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-stock-league-classroom-lesson-templates',
    firestore: { rules: readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8') },
  })
})
beforeEach(async () => { await environment.clearFirestore() })
afterAll(async () => { await environment.cleanup() })

describe('lessonTemplates repository', () => {
  it('creates a draft-only template and autosaves only the draft', async () => {
    const firestore = environment.authenticatedContext('teacher-a', { email_verified: true, firebase: { sign_in_provider: 'google.com' } }).firestore()
    await environment.withSecurityRulesDisabled(async (context) => {
      const { setDoc, doc } = await import('firebase/firestore')
      await setDoc(doc(context.firestore(), 'organizations', 'personal_teacher-a', 'members', 'teacher-a'), { role: 'owner', status: 'active', membershipVersion: 1 })
    })
    const templateId = await createLessonTemplate(firestore, 'teacher-a', draft)
    const edited = await saveDraft(firestore, templateId, { ...draft, title: '編集後' })
    expect(edited.title).toBe('編集後')
  })
})
```

- [ ] **Step 3: 失敗を確認する**

Run: `npx vitest run src/lib/lessonTemplates/repository.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: リポジトリ関数を実装する**

`src/lib/lessonTemplates/repository.ts`:

```ts
import { addDoc, collection, doc, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore'
import { personalOrgId } from '../org/personalOrgId'
import type { LessonContent } from './types'

const templates = (db: Firestore) => collection(db, 'lessonTemplates')
export const createLessonTemplate = async (db: Firestore, createdByUid: string, draft: LessonContent): Promise<string> => {
  const ref = await addDoc(templates(db), {
    orgId: personalOrgId(createdByUid), createdByUid, draft,
    currentPublishedVersionId: null, status: 'DRAFT', visibility: 'PRIVATE',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  })
  return ref.id
}

/** Autosave: overwrites `draft` only. Never touches the immutable versions subcollection. */
export const saveDraft = async (db: Firestore, templateId: string, draft: LessonContent): Promise<LessonContent> => {
  await setDoc(doc(db, 'lessonTemplates', templateId), { draft, updatedAt: serverTimestamp() }, { merge: true })
  return draft
}

```

- [ ] **Step 5: 公開版作成の失敗するFunctionsテストを書く**

`publishLessonVersion.test.ts`で、単一transactionが現在draftを`versions/{versionId}`へ`templateId`・`orgId`付きで固定し、同時にtemplateの`currentPublishedVersionId`と`status: 'READY'`を更新することを検証する。同一`idempotencyKey`・同一request digestの再試行は同じversionIdを返してversionを増やさず、同一キーで`templateId`または`changeSummary`が異なる場合は`Idempotency key payload mismatch`を拒否する。親templateのorg不一致、active membership欠落も拒否する。

- [ ] **Step 6: `publishLessonVersion`とCallableを実装する**

idempotency docは`lessonVersionPublishIdempotency/{sha256(orgId + '\0' + idempotencyKey)}`、versionIdはサーバー`randomUUID()`とする。transaction内でidempotency、templateを読み、version作成、template pointer/status更新、idempotency書込みを一度に行う。idempotency docへ`requestDigest`を保存する。Callableは`requireActiveOrgMember`を通し、`orgId`をクライアント入力から受け取らず、template正本から取得する。クライアントラッパーの入力は`{ templateId, changeSummary, idempotencyKey }`だけとする。

- [ ] **Step 7: `firestore.rules`へ`lessonTemplates`とその`versions`サブコレクションを追加する**

`match /organizations/{orgId}/members/{uid} { ... }`の直後に挿入する。

```
    match /lessonTemplates/{templateId} {
      allow get: if teacher() && activeMember(resource.data.orgId);
      allow list: if teacher() && activeMember(resource.data.orgId);
      allow create: if teacher()
        && request.resource.data.createdByUid == request.auth.uid
        && request.resource.data.currentPublishedVersionId == null
        && request.resource.data.status == 'DRAFT'
        && request.resource.data.visibility == 'PRIVATE'
        && activeMember(request.resource.data.orgId);
      allow update: if teacher()
        && request.resource.data.orgId == resource.data.orgId
        && request.resource.data.createdByUid == resource.data.createdByUid
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['draft', 'updatedAt'])
        && activeMember(resource.data.orgId);
      // All deletion goes through Task 12 so recovery/audit semantics cannot
      // be bypassed by a direct client delete.
      allow delete: if false;

      match /versions/{versionId} {
        allow get, list: if teacher()
          && activeMember(get(/databases/$(database)/documents/lessonTemplates/$(templateId)).data.orgId);
        // Publish is a server transaction so version creation and pointer
        // update cannot split or duplicate. Clients never write versions.
        allow create, update, delete: if false;
      }
    }
    match /lessonVersionPublishIdempotency/{key} { allow read, write: if false; }
```

create時の`activeMember(request.resource.data.orgId)`は、指定されたorgのコミット済み`members/{request.auth.uid}`を`get()`し、`status == 'active'`を確認する。これにより個人組織と学校組織で同じ認可モデルを使える。`orgId`自体は作成後に変更できない。

- [ ] **Step 8: `orgId`/`createdByUid`の書き換え拒否テストを追加する**

```ts
describe('orgId/createdByUid immutability on lessonTemplates', () => {
  it('rejects a template whose orgId does not match the deterministic personal org id', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await assertFails(setDoc(doc(owner, 'lessonTemplates', 'bad'), {
      orgId: 'personal_teacher-b', createdByUid: 'teacher-a', draft: { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES' },
      currentPublishedVersionId: null, status: 'DRAFT', visibility: 'PRIVATE',
    }))
  })

  it('rejects changing orgId or createdByUid on update', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    const valid = { orgId: 'personal_teacher-a', createdByUid: 'teacher-a', draft: { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES' }, currentPublishedVersionId: null, status: 'DRAFT', visibility: 'PRIVATE' }
    await setDoc(doc(owner, 'lessonTemplates', 'immutable'), valid)
    await assertFails(updateDoc(doc(owner, 'lessonTemplates', 'immutable'), { orgId: 'personal_teacher-b' }))
    await assertFails(updateDoc(doc(owner, 'lessonTemplates', 'immutable'), { status: 'READY' }))
  })

  it('rejects updating an already-created version', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await setDoc(doc(owner, 'lessonTemplates', 't1'), { orgId: 'personal_teacher-a', createdByUid: 'teacher-a', draft: { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES' }, currentPublishedVersionId: null, status: 'DRAFT', visibility: 'PRIVATE' })
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'lessonTemplates', 't1', 'versions', 'v1'), { templateId: 't1', orgId: 'personal_teacher-a', schemaVersion: 1, content: { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES' }, createdByUid: 'teacher-a', changeSummary: '', immutable: true })
    })
    await assertFails(updateDoc(doc(owner, 'lessonTemplates', 't1', 'versions', 'v1'), { changeSummary: 'edited' }))
  })

  it('allows an active member of a non-personal organization without changing the rule model', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'organizations', 'school-1'), { type: 'school' })
      await setDoc(doc(context.firestore(), 'organizations', 'school-1', 'members', 'teacher-a'), { role: 'teacher', status: 'active', membershipVersion: 1 })
    })
    const teacher = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await assertSucceeds(setDoc(doc(teacher, 'lessonTemplates', 'school-template'), {
      orgId: 'school-1', createdByUid: 'teacher-a', draft: { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES' },
      currentPublishedVersionId: null, status: 'DRAFT', visibility: 'PRIVATE',
    }))
  })

  it('rejects a version whose templateId or orgId does not match its parent template', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await setDoc(doc(owner, 'lessonTemplates', 't1'), { orgId: 'personal_teacher-a', createdByUid: 'teacher-a', draft: { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES' }, currentPublishedVersionId: null, status: 'DRAFT', visibility: 'PRIVATE' })
    await assertFails(setDoc(doc(owner, 'lessonTemplates', 't1', 'versions', 'bad'), { templateId: 'other', orgId: 'personal_teacher-b', schemaVersion: 1, content: {}, createdByUid: 'teacher-a', immutable: true }))
  })
})
```

こちらのテストを実行する前に、Task 4の`beforeEach`（`test/firestore.rules.test.ts`）へ`organizations/personal_teacher-a/members/teacher-a`（`status: 'active'`）のシードを追加しておく（このテストが`activeMember`を通過するために必要）。

- [ ] **Step 9: テストを通す**

Run: `npx vitest run src/lib/lessonTemplates/repository.test.ts && npm run test:rules`
Expected: 両方PASS

- [ ] **Step 10: `npm run verify` を通す**

Run: `npm run verify`
Expected: 成功。

- [ ] **Step 11: Commit**

```bash
git add src/lib/lessonTemplates functions/src/lessonTemplates firestore.rules test/firestore.rules.test.ts functions/src/index.ts
git commit -m "feat: add LessonTemplate draft/version repository and org-scoped rules"
```

---

## Task 7: `LessonRun` — 作成・スナップショット固定・`randomSeed`

統合仕様書 §7.4を実装する。`randomSeed`はクライアントが選べてはならない（決定的リプレイの根拠であり、生徒は当然、教師にも改ざんされてはならない）ため、作成はCallable経由に限定する。

**Files:**
- Create: `functions/src/lessonRuns/createLessonRun.ts`, `.test.ts`, `onCall.ts`
- Create: `src/lib/lessonRuns/types.ts`, `createLessonRun.ts`（クライアントラッパー）, `.test.ts`
- Modify: `firestore.rules`, `test/firestore.rules.test.ts`, `functions/src/index.ts`

**Interfaces:**
- Consumes: `personalOrgId`（Task 3）
- Produces: `LessonRun`型、`createLessonRunWithAdminSdk(input): Promise<{ lessonRunId: string }>`、`createLessonRunCallable`（`onCall`）、クライアント`createLessonRun(functions, input)`

- [ ] **Step 1: `LessonRun`型を定義する**

`src/lib/lessonRuns/types.ts`:

```ts
import type { Timestamp } from 'firebase/firestore'
import type { LessonContent } from '../lessonTemplates/types'

export type LessonRunStatus =
  | 'DRAFT' | 'READY' | 'WAITING' | 'RUNNING' | 'PAUSED'
  | 'INTERRUPTED' | 'REFLECTION' | 'COMPLETED' | 'ABORTED' | 'ARCHIVED'

export interface LessonRun {
  id: string
  orgId: string
  templateId: string
  templateVersionId: string
  templateSnapshot: LessonContent
  subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS'
  status: LessonRunStatus
  primaryTeacherUid: string
  teacherRoles: Record<string, 'PRIMARY' | 'ASSISTANT' | 'VIEWER'>
  currentPhaseId: string | null
  randomSeed: string
  restoreGeneration: number
  startedAt: Timestamp | null
  endedAt: Timestamp | null
  createdAt: Timestamp
}
```

- [ ] **Step 2: Functions側の失敗するテストを書く（冪等性を検証する）**

`functions/src/lessonRuns/createLessonRun.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createLessonRun } from './createLessonRun'

const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    runTransaction: async (fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      set: (path: string, data: Record<string, unknown>) => void
    }) => Promise<string>) => fn({
      get: async (path: string) => ({ exists: docs.has(path), data: () => docs.get(path) }),
      set: (path: string, data: Record<string, unknown>) => { docs.set(path, data) },
    }),
  }
}

describe('createLessonRun', () => {
  it('fixes the template snapshot and generates a randomSeed the caller never supplies', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-1', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1' })
    fake.docs.set('lessonTemplates/tpl-1/versions/v1', { templateId: 'tpl-1', orgId: 'personal_teacher-a', content: { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES' } })
    const result = await createLessonRun({
      firestore: fake as never,
      generateRandomSeed: () => 'fixed-test-seed',
      generateLessonRunId: () => 'run-fixed',
      lessonRunIdempotencyKey: 'idem-1',
      orgId: 'personal_teacher-a', templateId: 'tpl-1', primaryTeacherUid: 'teacher-a',
    })
    expect(result.created).toBe(true)
    const run = fake.docs.get(`lessonRuns/${result.lessonRunId}`)
    expect(run).toMatchObject({
      orgId: 'personal_teacher-a', templateId: 'tpl-1', templateVersionId: 'v1',
      randomSeed: 'fixed-test-seed', restoreGeneration: 0, status: 'DRAFT',
      primaryTeacherUid: 'teacher-a', teacherRoles: { 'teacher-a': 'PRIMARY' },
    })
  })

  it('is idempotent per idempotencyKey: a retried call returns the same lessonRunId without creating a second run', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-1', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1' })
    fake.docs.set('lessonTemplates/tpl-1/versions/v1', { templateId: 'tpl-1', orgId: 'personal_teacher-a', content: { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES' } })
    const input = { firestore: fake as never, generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-fixed', lessonRunIdempotencyKey: 'idem/with unsafe chars', orgId: 'personal_teacher-a', templateId: 'tpl-1', primaryTeacherUid: 'teacher-a' }
    const first = await createLessonRun(input)
    const second = await createLessonRun(input)
    expect(second.lessonRunId).toBe(first.lessonRunId)
    expect(second.created).toBe(false)
  })

  it('rejects reusing the same idempotencyKey for a different template', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-1', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v1' })
    fake.docs.set('lessonTemplates/tpl-1/versions/v1', { templateId: 'tpl-1', orgId: 'personal_teacher-a', content: { subject: 'SOCIAL_STUDIES' } })
    const base = { firestore: fake as never, generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-fixed', lessonRunIdempotencyKey: 'same-key', orgId: 'personal_teacher-a', primaryTeacherUid: 'teacher-a' }
    await createLessonRun({ ...base, templateId: 'tpl-1' })
    await expect(createLessonRun({ ...base, templateId: 'tpl-2' })).rejects.toThrow('Idempotency key payload mismatch')
  })

  it('rejects a published-version pointer that crosses template or organization ownership', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonTemplates/tpl-1', { orgId: 'personal_teacher-a', currentPublishedVersionId: 'v-foreign' })
    fake.docs.set('lessonTemplates/tpl-1/versions/v-foreign', { templateId: 'tpl-2', orgId: 'personal_teacher-b', content: { subject: 'SOCIAL_STUDIES' } })
    await expect(createLessonRun({
      firestore: fake as never, generateRandomSeed: () => 'seed', generateLessonRunId: () => 'run-fixed',
      lessonRunIdempotencyKey: 'idem-foreign', orgId: 'personal_teacher-a', templateId: 'tpl-1', primaryTeacherUid: 'teacher-a',
    })).rejects.toThrow('Published version pointer mismatch')
  })
})
```

- [ ] **Step 3: 失敗を確認する**

Run: `cd functions && npx vitest run src/lessonRuns/createLessonRun.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: 実装する**

`functions/src/lessonRuns/createLessonRun.ts`:

```ts
import { randomBytes, randomUUID } from 'node:crypto'
import { idempotencyDocumentId, requestDigest as computeRequestDigest } from '../lib/idempotency'

export interface FirestoreTx {
  get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
  set: (path: string, data: Record<string, unknown>) => void
}
export interface CreateLessonRunDeps {
  firestore: { runTransaction: (fn: (tx: FirestoreTx) => Promise<string>) => Promise<string> }
  generateRandomSeed: () => string
  generateLessonRunId: () => string
  lessonRunIdempotencyKey: string
  orgId: string
  templateId: string
  primaryTeacherUid: string
  now?: () => unknown
}
export interface CreateLessonRunResult { lessonRunId: string; created: boolean }

/**
 * Idempotent per (orgId, lessonRunIdempotencyKey): a lookup document at
 * `lessonRunIdempotency/{sha256(orgId + '\0' + key)}` records which lessonRunId a
 * given client-supplied key already produced. Hashing prevents `/`, length,
 * and information-disclosure problems from using the raw key as a path.
 * §12.13's "同一キーは1回だけ処理する" applied to run creation (§18.9's
 * quota-reservation pattern generalizes the same way).
 */
export const createLessonRun = async (deps: CreateLessonRunDeps): Promise<CreateLessonRunResult> => {
  const idempotencyPath = `lessonRunIdempotency/${idempotencyDocumentId(deps.orgId, deps.lessonRunIdempotencyKey)}`
  const requestDigest = computeRequestDigest({
    orgId: deps.orgId,
    templateId: deps.templateId,
    primaryTeacherUid: deps.primaryTeacherUid,
  })
  const nowValue = deps.now ? deps.now() : new Date().toISOString()

  return deps.firestore.runTransaction(async (tx) => {
    const existing = await tx.get(idempotencyPath)
    if (existing.exists) {
      const prior = existing.data() as { lessonRunId: string; requestDigest: string }
      if (prior.requestDigest !== requestDigest) throw new Error('Idempotency key payload mismatch')
      return JSON.stringify({ lessonRunId: prior.lessonRunId, created: false })
    }
    const templateSnap = await tx.get(`lessonTemplates/${deps.templateId}`)
    if (!templateSnap.exists) throw new Error('LessonTemplate not found')
    const template = templateSnap.data() as { orgId: string; currentPublishedVersionId: string | null }
    if (template.orgId !== deps.orgId) throw new Error('Template does not belong to this organization')
    if (!template.currentPublishedVersionId) throw new Error('Template has no published version to snapshot')
    const versionSnap = await tx.get(`lessonTemplates/${deps.templateId}/versions/${template.currentPublishedVersionId}`)
    if (!versionSnap.exists) throw new Error('Published version not found')
    const version = versionSnap.data() as { templateId: string; orgId: string; content: unknown }
    if (version.templateId !== deps.templateId || version.orgId !== deps.orgId) {
      throw new Error('Published version pointer mismatch')
    }

    const lessonRunId = deps.generateLessonRunId()
    tx.set(`lessonRuns/${lessonRunId}`, {
      orgId: deps.orgId, templateId: deps.templateId, templateVersionId: template.currentPublishedVersionId,
      templateSnapshot: version.content, subject: (version.content as { subject: string }).subject,
      status: 'DRAFT', primaryTeacherUid: deps.primaryTeacherUid, teacherRoles: { [deps.primaryTeacherUid]: 'PRIMARY' },
      currentPhaseId: null, randomSeed: deps.generateRandomSeed(), restoreGeneration: 0,
      startedAt: null, endedAt: null, createdAt: nowValue,
    })
    tx.set(idempotencyPath, { lessonRunId, requestDigest, createdAt: nowValue })
    return JSON.stringify({ lessonRunId, created: true })
  }).then((raw) => JSON.parse(raw) as CreateLessonRunResult)
}
```

`lessonRunId`はサーバー生成UUIDとし、クライアントの生キーをIDへ使わない。リトライ時の同一ID返却は`lessonRunIdempotency/{sha256(...)}`の対応表が保証する。

- [ ] **Step 5: テストを通す**

Run: `cd functions && npx vitest run src/lessonRuns/createLessonRun.test.ts`
Expected: PASS

- [ ] **Step 6: 乱数シード生成をAdmin SDK用に実装する**

同ファイルへ追記する。

```ts
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

/** Cryptographically random, generated once server-side. Never Math.random(). */
export const generateRandomSeed = (): string => randomBytes(16).toString('hex')

export const createLessonRunWithAdminSdk = (input: {
  orgId: string; templateId: string; primaryTeacherUid: string; lessonRunIdempotencyKey: string
}): Promise<CreateLessonRunResult> => {
  const db = getFirestore()
  return createLessonRun({
    firestore: {
      runTransaction: (fn) => db.runTransaction((tx) => fn({
        get: async (path) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: () => snap.data() } },
        set: (path, data) => { tx.set(db.doc(path), { ...data, createdAt: FieldValue.serverTimestamp() }) },
      })),
    },
    generateRandomSeed, generateLessonRunId: randomUUID, ...input,
  })
}
```

- [ ] **Step 7: `onCall`ハンドラを実装する**

`functions/src/lessonRuns/onCall.ts`:

```ts
import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { isCallerTeacher } from '../organizations/onCall'
import { requireActiveOrgMember } from '../organizations/authorization'
import { createLessonRunWithAdminSdk } from './createLessonRun'

interface CreateLessonRunRequest { templateId: string; lessonRunIdempotencyKey: string }

export const createLessonRunCallable = onCall({ region: 'asia-northeast1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  if (!isCallerTeacher(request.auth.token)) throw new HttpsError('permission-denied', '教師アカウントのみ利用できます。')
  const data = request.data as CreateLessonRunRequest
  if (!data.templateId || !data.lessonRunIdempotencyKey) throw new HttpsError('invalid-argument', 'templateId と lessonRunIdempotencyKey は必須です。')
  const templateSnap = await getFirestore().doc(`lessonTemplates/${data.templateId}`).get()
  if (!templateSnap.exists) throw new HttpsError('not-found', '教材が見つかりません。')
  const orgId = templateSnap.get('orgId') as string
  await requireActiveOrgMember(getFirestore(), orgId, request.auth.uid)
  return createLessonRunWithAdminSdk({
    orgId, templateId: data.templateId,
    primaryTeacherUid: request.auth.uid, lessonRunIdempotencyKey: data.lessonRunIdempotencyKey,
  })
})
```

Callableテストは、template正本の`orgId`を使うため個人組織と学校組織のactive memberが作成でき、missingまたは`suspended`では`permission-denied`となり、Admin SDK側にrun/idempotencyドキュメントが一件も作られないことを検証する。クライアント入力から`orgId`は受け取らない。

`functions/src/index.ts`へ`export { createLessonRunCallable } from './lessonRuns/onCall'`を追記する。

- [ ] **Step 8: `firestore.rules`へ`lessonRuns`の読み取りルールを追加する（書き込みはCallable専用）**

```
    match /lessonRuns/{lessonRunId} {
      allow get: if teacher()
        && activeMember(resource.data.orgId);
      allow list: if teacher() && activeMember(resource.data.orgId);
      allow write: if false;
    }
    match /lessonRunIdempotency/{key} { allow read, write: if false; }
```

- [ ] **Step 9: クライアントラッパーを実装する**

`src/lib/lessonRuns/createLessonRun.ts`:

```ts
import { httpsCallable, type Functions } from 'firebase/functions'

export const createLessonRun = async (functions: Functions, input: { templateId: string; lessonRunIdempotencyKey: string }): Promise<{ lessonRunId: string; created: boolean }> => {
  const callable = httpsCallable<typeof input, { lessonRunId: string; created: boolean }>(functions, 'createLessonRunCallable')
  const result = await callable(input)
  return result.data
}
```

対応する`.test.ts`は`phase1a`計画Task 5 Step 6のパターン（`httpsCallable`のフェイク）を踏襲する。

- [ ] **Step 10: クロス組織拒否・orgId書き換え不能のルールテストを追加する**

```ts
describe('lessonRuns Firestore rules', () => {
  it('lets the owning teacher read their own lessonRun but not another teacher\'s', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'organizations', 'personal_teacher-a', 'members', 'teacher-a'), { role: 'owner', status: 'active', membershipVersion: 1 })
      await setDoc(doc(context.firestore(), 'lessonRuns', 'run-1'), { orgId: 'personal_teacher-a', templateId: 't1', primaryTeacherUid: 'teacher-a', status: 'DRAFT' })
    })
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    const other = environment.authenticatedContext('teacher-b', teacherToken).firestore()
    await assertSucceeds(getDoc(doc(owner, 'lessonRuns', 'run-1')))
    await assertFails(getDoc(doc(other, 'lessonRuns', 'run-1')))
  })

  it('rejects any client write to lessonRuns', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await assertFails(setDoc(doc(owner, 'lessonRuns', 'run-x'), { orgId: 'personal_teacher-a', templateId: 't1', primaryTeacherUid: 'teacher-a', status: 'DRAFT' }))
  })
})
```

- [ ] **Step 11: エミュレータでエンドツーエンド確認する**

Run: `firebase emulators:start --only functions,firestore,auth`
別ターミナルから`createLessonRunCallable`を呼び、`lessonRuns/{lessonRunId}`が`templateSnapshot`固定・`randomSeed`生成済みで作成されることを目視確認する。同じ`lessonRunIdempotencyKey`で再度呼び、ドキュメントが増えないことを確認する。

- [ ] **Step 12: `npm run verify` を通す**

Run: `npm run verify`

- [ ] **Step 13: Commit**

```bash
git add functions/src/lessonRuns src/lib/lessonRuns firestore.rules test/firestore.rules.test.ts functions/src/index.ts
git commit -m "feat: add idempotent LessonRun creation with a fixed template snapshot and server-generated randomSeed"
```

---

## Task 8: `LessonEvent` — 追記専用イベントログ

統合仕様書 §7.6を実装する。`sequence`の単調増加と`idempotencyKey`の重複排除をFirestoreトランザクションで保証するため、クライアントは直接書けず、Callable経由に限定する（`orgAccess`・`lessonRuns`と同じ「Admin SDK専用書き込み」パターン）。

**Files:**
- Create: `functions/src/lessonRuns/appendLessonEvent.ts`, `.test.ts`
- Modify: `firestore.rules`, `test/firestore.rules.test.ts`

**Interfaces:**
- Produces: `LessonEvent`型、`appendLessonEventInTransaction(tx, input, nowValue)`、サーバー内部専用の`appendLessonEvent(deps): Promise<{ eventId: string; sequence: number; deduplicated: boolean }>`と`appendLessonEventWithAdminSdk`

- [ ] **Step 1: 失敗するテストを書く（`sequence`の単調増加と`idempotencyKey`重複排除）**

`functions/src/lessonRuns/appendLessonEvent.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { appendLessonEvent } from './appendLessonEvent'

const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    runTransaction: async (fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      set: (path: string, data: Record<string, unknown>) => void
    }) => Promise<string>) => fn({
      get: async (path: string) => ({ exists: docs.has(path), data: () => docs.get(path) }),
      set: (path: string, data: Record<string, unknown>) => { docs.set(path, data) },
    }),
  }
}

describe('appendLessonEvent', () => {
  it('assigns sequence 0 to the first event and increments per lessonRunId', async () => {
    const fake = makeFakeFirestore()
    const deps = { firestore: fake as never, lessonRunId: 'run-1', orgId: 'org-1', type: 'PARTICIPANT_JOINED', actorType: 'STUDENT' as const, actorId: 'student-1', payload: {}, idempotencyKey: 'evt-1' }
    const first = await appendLessonEvent(deps)
    const second = await appendLessonEvent({ ...deps, idempotencyKey: 'evt-2', type: 'PARTICIPANT_LEFT' })
    expect(first.sequence).toBe(0)
    expect(second.sequence).toBe(1)
  })

  it('deduplicates a retried idempotencyKey without advancing sequence again', async () => {
    const fake = makeFakeFirestore()
    const deps = { firestore: fake as never, lessonRunId: 'run-1', orgId: 'org-1', type: 'PARTICIPANT_JOINED', actorType: 'STUDENT' as const, actorId: 'student-1', payload: {}, idempotencyKey: 'evt-1' }
    const first = await appendLessonEvent(deps)
    const retried = await appendLessonEvent(deps)
    expect(retried).toEqual({ ...first, deduplicated: true })
    const third = await appendLessonEvent({ ...deps, idempotencyKey: 'evt-2' })
    expect(third.sequence).toBe(1) // not 2 — the deduplicated retry did not consume a sequence number
  })

  it('hashes slash-containing keys and rejects the same key with a different payload', async () => {
    const fake = makeFakeFirestore()
    const base = { firestore: fake as never, lessonRunId: 'run-1', orgId: 'org-1', type: 'NOTE', actorType: 'TEACHER' as const, actorId: 'teacher-1', payload: { text: 'a' }, idempotencyKey: 'unsafe/key' }
    await appendLessonEvent(base)
    await expect(appendLessonEvent({ ...base, payload: { text: 'b' } })).rejects.toThrow('Idempotency key payload mismatch')
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/lessonRuns/appendLessonEvent.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`functions/src/lessonRuns/appendLessonEvent.ts`:

```ts
import { idempotencyDocumentId, requestDigest as computeRequestDigest } from '../lib/idempotency'

export interface AppendLessonEventDeps {
  firestore: { runTransaction: (fn: (tx: {
    get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
    set: (path: string, data: Record<string, unknown>) => void
  }) => Promise<string>) => Promise<string> }
  lessonRunId: string
  orgId: string
  type: string
  actorType: 'SYSTEM' | 'TEACHER' | 'STUDENT' | 'OPERATOR'
  actorId?: string
  payload: unknown
  idempotencyKey: string
  now?: () => unknown
}
export interface AppendLessonEventResult { eventId: string; sequence: number; deduplicated: boolean }

/**
 * sequence is a per-lessonRunId monotonically increasing counter stored on
 * `lessonRuns/{lessonRunId}/meta/eventCounter`. Both the counter read and the
 * idempotency dedup check happen inside the same transaction as the event
 * write, so a concurrent double-submit either both see the same counter
 * value and one aborts on retry (Firestore transaction contention), or the
 * second sees the first's idempotency doc and short-circuits — never both
 * incrementing from the same base.
 */
export const appendLessonEvent = async (deps: AppendLessonEventDeps): Promise<AppendLessonEventResult> => {
  const idempotencyId = idempotencyDocumentId(deps.lessonRunId, deps.idempotencyKey)
  const idempotencyPath = `lessonRuns/${deps.lessonRunId}/eventIdempotency/${idempotencyId}`
  const counterPath = `lessonRuns/${deps.lessonRunId}/meta/eventCounter`
  const nowValue = deps.now ? deps.now() : new Date().toISOString()
  const requestDigest = computeRequestDigest({
    orgId: deps.orgId, type: deps.type, actorType: deps.actorType,
    actorId: deps.actorId ?? null, payload: deps.payload,
  })

  const raw = await deps.firestore.runTransaction(async (tx) => {
    const existing = await tx.get(idempotencyPath)
    if (existing.exists) {
      const prior = existing.data() as { eventId: string; sequence: number; requestDigest: string }
      if (prior.requestDigest !== requestDigest) throw new Error('Idempotency key payload mismatch')
      return JSON.stringify({ eventId: prior.eventId, sequence: prior.sequence, deduplicated: true })
    }
    const counterSnap = await tx.get(counterPath)
    const nextSequence = counterSnap.exists ? (counterSnap.data() as { value: number }).value + 1 : 0
    const eventId = `${deps.lessonRunId}_${nextSequence}`
    tx.set(`lessonRuns/${deps.lessonRunId}/events/${eventId}`, {
      eventId, lessonRunId: deps.lessonRunId, orgId: deps.orgId, type: deps.type,
      actorType: deps.actorType, actorId: deps.actorId ?? null, idempotencyKey: deps.idempotencyKey,
      payload: deps.payload, serverOccurredAt: nowValue, sequence: nextSequence,
    })
    tx.set(counterPath, { value: nextSequence })
    tx.set(idempotencyPath, { eventId, sequence: nextSequence, requestDigest })
    return JSON.stringify({ eventId, sequence: nextSequence, deduplicated: false })
  })
  return JSON.parse(raw) as AppendLessonEventResult
}
```

上記のtransaction内部（idempotency read、counter read、event/counter/idempotency set）を、同ファイルの`appendLessonEventInTransaction(tx, input, nowValue)`へ抽出し、`appendLessonEvent`は`runTransaction(tx => appendLessonEventInTransaction(...))`だけを行う。Task 9の復元はこのhelperを同じFirestore transaction内で呼び、`restoreGeneration`更新と必須イベント追記を原子的に確定する。helperの`input`は`Omit<AppendLessonEventDeps, 'firestore' | 'now'>`、戻り値は`AppendLessonEventResult`とする。helper単体テストでもslash入りキーのhash化とsemantic digest不一致を検証する。

- [ ] **Step 4: テストを通す**

Run: `cd functions && npx vitest run src/lessonRuns/appendLessonEvent.test.ts`
Expected: PASS

- [ ] **Step 5: Admin SDK版を実装する**

同ファイル末尾に追記する。

```ts
import { getFirestore } from 'firebase-admin/firestore'

export const appendLessonEventWithAdminSdk = (input: Omit<AppendLessonEventDeps, 'firestore' | 'now'>): Promise<AppendLessonEventResult> => {
  const db = getFirestore()
  return appendLessonEvent({
    firestore: {
      runTransaction: (fn) => db.runTransaction((tx) => fn({
        get: async (path) => { const snap = await tx.get(db.doc(path)); return { exists: snap.exists, data: () => snap.data() } },
        set: (path, data) => { tx.set(db.doc(path), data) },
      })),
    },
    ...input,
  })
}
```

汎用`appendLessonEventCallable`は作らない。任意の`type`・`actorType`・`payload`をクライアントへ開放すると、教師クライアントが`SYSTEM`イベントや将来の約定イベントを偽造でき、監査ログの信頼性が失われるためである。Phase B/Cの各操作Callableが認可と業務処理を完了した後、サーバー内部から`appendLessonEventWithAdminSdk`を呼ぶ。

- [ ] **Step 6: `firestore.rules`へ`events`サブコレクションを追加する（読み取りのみ、書き込みはCallable専用）**

```
      match /events/{eventId} {
        allow get, list: if teacher()
          && activeMember(get(/databases/$(database)/documents/lessonRuns/$(lessonRunId)).data.orgId);
        allow write: if false;
      }
      match /eventIdempotency/{key} { allow read, write: if false; }
      match /meta/{docId} { allow read, write: if false; }
```

（`lessonRuns/{lessonRunId}`の`match`ブロック内、Task 7で追加した本体ルールの直後に挿入する。）

- [ ] **Step 7: サーバー内部専用であることを固定するテストを追加する**

`functions/src/index.ts`から`appendLessonEvent`系をexportせず、`functions/src/lessonRuns/onCall.ts`にも汎用Callableを定義しない。実際の防御境界はFirestore Rulesの`allow write: if false`とデプロイexport不在の組合せである。テストは`appendLessonEventWithAdminSdk`へ所有確認済みの`orgId`が渡されたときだけ追記できる内部APIの振る舞いを検証し、クライアント向けテストファイルは作らない。

- [ ] **Step 8: 追記専用性のルールテストを追加する**

```ts
describe('lessonRun events are append-only', () => {
  it('rejects any client write to the events subcollection', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await assertFails(setDoc(doc(owner, 'lessonRuns', 'run-1', 'events', 'evt-x'), { type: 'FAKE', sequence: 0 }))
  })
})
```

Task 9以降の各業務Callableテストでは、`teacher-a`が`personal_teacher-b`所有の`lessonRunId`を指定した場合に`permission-denied`となり、業務変更・イベント・counter・idempotencyドキュメントが一件も作られないことを個別に検証する。Admin SDKはRulesを迂回するため、所有権検証は各Callable境界の必須テストである。

- [ ] **Step 9: `npm run verify` を通す**

- [ ] **Step 10: Commit**

```bash
git add functions/src/lessonRuns/appendLessonEvent.ts functions/src/lessonRuns/appendLessonEvent.test.ts firestore.rules test/firestore.rules.test.ts
git commit -m "feat: add append-only LessonEvent log with sequence assignment and idempotency dedup"
```

---

## Task 9: `LessonCheckpoint` と `restoreGeneration`

統合仕様書 §7.7、矛盾解消Eを実装する。復元は「巻き戻し」ではなく「追記」——`restoreGeneration`をインクリメントし、`CHECKPOINT_RESTORED`イベントを追記する。約定レコード（Phase C以降）は削除しない前提を、Phase Aの時点でも「イベントは不変・チェックポイントは新しい世代の起点を示すだけ」という形で成立させる。

**Files:**
- Create: `functions/src/lessonRuns/checkpoint.ts`, `.test.ts`、`onCall.ts`への追記
- Create: `src/lib/lessonRuns/checkpoint.ts`, `.test.ts`
- Modify: `firestore.rules`, `test/firestore.rules.test.ts`

**Interfaces:**
- Consumes: `appendLessonEventInTransaction`（Task 8）、`requireActiveOrgMember`（Task 5）
- Produces: `LessonCheckpoint`型、`writeCheckpoint(deps)`、`restoreCheckpoint(deps)`、対応する`onCall`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/lessonRuns/checkpoint.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { restoreCheckpoint, writeCheckpoint } from './checkpoint'

const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    runTransaction: async (fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      set: (path: string, data: Record<string, unknown>) => void
      update: (path: string, data: Record<string, unknown>) => void
    }) => Promise<string>) => fn({
      get: async (path: string) => ({ exists: docs.has(path), data: () => docs.get(path) }),
      set: (path: string, data: Record<string, unknown>) => { docs.set(path, data) },
      update: (path: string, data: Record<string, unknown>) => { docs.set(path, { ...docs.get(path), ...data }) },
    }),
  }
}

describe('writeCheckpoint', () => {
  it('stores a checkpoint tagged with the current restoreGeneration', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1', { restoreGeneration: 0 })
    const result = await writeCheckpoint({ firestore: fake as never, lessonRunId: 'run-1', phaseId: 'phase-1', sequence: 5, snapshot: { cash: 1000 }, createdBy: 'TEACHER', idempotencyKey: 'cp/key' })
    expect(fake.docs.get(`lessonRuns/run-1/checkpoints/${result.checkpointId}`)).toMatchObject({ sequence: 5, phaseId: 'phase-1', restoreGeneration: 0 })
  })

  it('never overwrites a checkpoint when the same sequence occurs in another restoreGeneration', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1', { restoreGeneration: 0 })
    const first = await writeCheckpoint({ firestore: fake as never, lessonRunId: 'run-1', phaseId: 'p', sequence: 5, snapshot: { value: 1 }, createdBy: 'SYSTEM', idempotencyKey: 'cp-1' })
    fake.docs.set('lessonRuns/run-1', { restoreGeneration: 1 })
    const second = await writeCheckpoint({ firestore: fake as never, lessonRunId: 'run-1', phaseId: 'p', sequence: 5, snapshot: { value: 2 }, createdBy: 'SYSTEM', idempotencyKey: 'cp-2' })
    expect(second.checkpointId).not.toBe(first.checkpointId)
    expect(fake.docs.get(`lessonRuns/run-1/checkpoints/${first.checkpointId}`)).toMatchObject({ snapshot: { value: 1 } })
  })
})

describe('restoreCheckpoint', () => {
  it('increments restoreGeneration and appends a CHECKPOINT_RESTORED event instead of deleting anything', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1', { restoreGeneration: 0, orgId: 'org-1' })
    fake.docs.set('lessonRuns/run-1/checkpoints/cp-1', { id: 'cp-1', sequence: 5, restoreGeneration: 0 })
    const result = await restoreCheckpoint({ firestore: fake as never, lessonRunId: 'run-1', checkpointId: 'cp-1', reason: 'テスト復元', actorId: 'teacher-a', idempotencyKey: 'restore-1' })
    expect(result.newRestoreGeneration).toBe(1)
    expect(fake.docs.get('lessonRuns/run-1')).toMatchObject({ restoreGeneration: 1 })
    expect([...fake.docs.values()]).toContainEqual(expect.objectContaining({
      lessonRunId: 'run-1', type: 'CHECKPOINT_RESTORED',
      payload: { checkpointId: 'cp-1', reason: 'テスト復元', newRestoreGeneration: 1 },
    }))
  })

  it('does not increment restoreGeneration twice when the same idempotencyKey is retried', async () => {
    const fake = makeFakeFirestore()
    fake.docs.set('lessonRuns/run-1', { restoreGeneration: 0, orgId: 'org-1' })
    fake.docs.set('lessonRuns/run-1/checkpoints/cp-1', { id: 'cp-1', sequence: 5, restoreGeneration: 0 })
    const input = { firestore: fake as never, lessonRunId: 'run-1', checkpointId: 'cp-1', reason: '再試行', actorId: 'teacher-a', idempotencyKey: 'restore/unsafe-key' }
    const first = await restoreCheckpoint(input)
    const retry = await restoreCheckpoint(input)
    expect(first).toMatchObject({ newRestoreGeneration: 1, deduplicated: false, eventId: expect.any(String) })
    expect(retry).toMatchObject({ newRestoreGeneration: 1, deduplicated: true, eventId: first.eventId })
    expect(fake.docs.get('lessonRuns/run-1')).toMatchObject({ restoreGeneration: 1 })
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/lessonRuns/checkpoint.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`functions/src/lessonRuns/checkpoint.ts`:

```ts
import { idempotencyDocumentId, requestDigest as computeRequestDigest } from '../lib/idempotency'
import { appendLessonEventInTransaction } from './appendLessonEvent'

interface Tx {
  get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
  set: (path: string, data: Record<string, unknown>) => void
  update: (path: string, data: Record<string, unknown>) => void
}
export interface WriteCheckpointDeps {
  firestore: { runTransaction: (fn: (tx: Tx) => Promise<string>) => Promise<string> }
  lessonRunId: string; phaseId: string; sequence: number; snapshot: unknown; createdBy: 'SYSTEM' | 'TEACHER'; idempotencyKey: string
}
export interface WriteCheckpointResult { checkpointId: string; deduplicated: boolean }

export const writeCheckpoint = async (deps: WriteCheckpointDeps): Promise<WriteCheckpointResult> => {
  const raw = await deps.firestore.runTransaction(async (tx) => {
    const runSnap = await tx.get(`lessonRuns/${deps.lessonRunId}`)
    if (!runSnap.exists) throw new Error('LessonRun not found')
    const restoreGeneration = (runSnap.data() as { restoreGeneration: number }).restoreGeneration ?? 0
    const keyHash = idempotencyDocumentId(deps.lessonRunId, deps.idempotencyKey)
    const checkpointId = `cp_${restoreGeneration}_${deps.sequence}_${keyHash.slice(0, 16)}`
    const checkpointPath = `lessonRuns/${deps.lessonRunId}/checkpoints/${checkpointId}`
    const requestDigest = computeRequestDigest({
      phaseId: deps.phaseId, sequence: deps.sequence, snapshot: deps.snapshot,
      createdBy: deps.createdBy, restoreGeneration,
    })
    const existing = await tx.get(checkpointPath)
    if (existing.exists) {
      if ((existing.data() as { requestDigest: string }).requestDigest !== requestDigest) throw new Error('Idempotency key payload mismatch')
      return JSON.stringify({ checkpointId, deduplicated: true })
    }
    tx.set(checkpointPath, {
      id: checkpointId, lessonRunId: deps.lessonRunId, sequence: deps.sequence, phaseId: deps.phaseId,
      snapshot: deps.snapshot, createdBy: deps.createdBy, restoreGeneration, requestDigest,
    })
    return JSON.stringify({ checkpointId, deduplicated: false })
  })
  return JSON.parse(raw) as WriteCheckpointResult
}

export interface RestoreCheckpointDeps {
  firestore: { runTransaction: (fn: (tx: Tx) => Promise<string>) => Promise<string> }
  lessonRunId: string; checkpointId: string; reason: string; actorId: string; idempotencyKey: string
}
export interface RestoreCheckpointResult { newRestoreGeneration: number; eventId: string; deduplicated: boolean }

/**
 * "Restore" is append, not rewind (resolutions.md section E): nothing is
 * deleted. LessonRun.restoreGeneration is incremented, and the restore
 * itself is recorded as a CHECKPOINT_RESTORED LessonEvent. Downstream
 * replay logic (Phase C+) is responsible for treating events after the
 * checkpoint's sequence, tagged with the OLD restoreGeneration, as
 * superseded rather than deleting them.
 */
export const restoreCheckpoint = async (deps: RestoreCheckpointDeps): Promise<RestoreCheckpointResult> => {
  const restoreKey = idempotencyDocumentId(deps.lessonRunId, deps.idempotencyKey)
  const idempotencyPath = `lessonRuns/${deps.lessonRunId}/checkpointRestoreIdempotency/${restoreKey}`
  const requestDigest = computeRequestDigest({
    checkpointId: deps.checkpointId, reason: deps.reason, actorId: deps.actorId,
  })
  const raw = await deps.firestore.runTransaction(async (tx) => {
    const existing = await tx.get(idempotencyPath)
    if (existing.exists) {
      const prior = existing.data() as { newRestoreGeneration: number; eventId: string; requestDigest: string }
      if (prior.requestDigest !== requestDigest) throw new Error('Idempotency key payload mismatch')
      return JSON.stringify({ newRestoreGeneration: prior.newRestoreGeneration, eventId: prior.eventId, deduplicated: true })
    }
    const runSnap = await tx.get(`lessonRuns/${deps.lessonRunId}`)
    if (!runSnap.exists) throw new Error('LessonRun not found')
    const run = runSnap.data() as { restoreGeneration: number; orgId: string }
    const checkpointSnap = await tx.get(`lessonRuns/${deps.lessonRunId}/checkpoints/${deps.checkpointId}`)
    if (!checkpointSnap.exists) throw new Error('Checkpoint not found')
    const newRestoreGeneration = run.restoreGeneration + 1
    const event = await appendLessonEventInTransaction(tx, {
      lessonRunId: deps.lessonRunId, orgId: run.orgId, type: 'CHECKPOINT_RESTORED',
      actorType: 'TEACHER', actorId: deps.actorId,
      payload: { checkpointId: deps.checkpointId, reason: deps.reason, newRestoreGeneration },
      idempotencyKey: deps.idempotencyKey,
    }, new Date().toISOString())
    tx.update(`lessonRuns/${deps.lessonRunId}`, { restoreGeneration: newRestoreGeneration })
    tx.set(idempotencyPath, { newRestoreGeneration, eventId: event.eventId, checkpointId: deps.checkpointId, requestDigest })
    return JSON.stringify({ newRestoreGeneration, eventId: event.eventId, deduplicated: false })
  })
  return JSON.parse(raw) as RestoreCheckpointResult
}
```

`checkpointRestoreIdempotency`はクライアントからread/writeとも拒否する。復元のgeneration更新、復元idempotency、event counter、event、event-idempotencyはすべて同じFirestore transactionで確定し、必須イベントだけ欠落する状態を作らない。Callableは対象`LessonRun`をAdmin SDKで読み、`orgId`、`teacherRoles[request.auth.uid]`、Task 5の`requireActiveOrgMember`を確認してから実行する。他組織runと`suspended`メンバーの拒否テストを追加する。

- [ ] **Step 4: テストを通す**

Run: `cd functions && npx vitest run src/lessonRuns/checkpoint.test.ts`
Expected: PASS

- [ ] **Step 5: Admin SDK版と`onCall`ハンドラを実装する**

Admin SDK adapterは`getFirestore().runTransaction()`をTask 8の`Tx` adapterへ変換する。`restoreCheckpointCallable`は`lessonRunId`、`checkpointId`、空でない`reason`、`idempotencyKey`を必須にし、認証・教師identity確認後にrunを読み、`teacherRoles[uid]`が`PRIMARY`または`ASSISTANT`、`requireActiveOrgMember(db, run.orgId, uid)`成功を確認する。その後だけ`restoreCheckpoint`を呼ぶ。orgIdはrun正本から取得し、クライアント入力から受け取らない。VIEWER、別組織、suspended、存在しないrun/checkpointをそれぞれ拒否するCallableテストを書く。

- [ ] **Step 6: `firestore.rules`へ`checkpoints`サブコレクションを追加する**

```
      match /checkpoints/{checkpointId} {
        allow get, list: if teacher()
          && activeMember(get(/databases/$(database)/documents/lessonRuns/$(lessonRunId)).data.orgId);
        allow write: if false;
      }
      match /checkpointRestoreIdempotency/{key} {
        allow read, write: if false;
      }
```

- [ ] **Step 7: `restoreGeneration`が0未満に戻らないこと、チェックポイントが削除できないことのルールテストを追加する**

```ts
describe('checkpoints are append-only and restoreGeneration only moves forward', () => {
  it('rejects any client write to checkpoints', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await assertFails(setDoc(doc(owner, 'lessonRuns', 'run-1', 'checkpoints', 'cp-x'), { sequence: 0 }))
  })
  it('rejects a client attempt to edit lessonRuns.restoreGeneration directly', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).firestore()
    await assertFails(updateDoc(doc(owner, 'lessonRuns', 'run-1'), { restoreGeneration: 999 }))
  })
})
```

（2つ目のテストはTask 7 Step 8の`allow write: if false`により既に保証されているはずだが、`restoreGeneration`という統合仕様書固有の不変条件（矛盾解消E）として明示的に固定するために追加する。）

- [ ] **Step 8: `npm run verify` を通す**

- [ ] **Step 9: Commit**

```bash
git add functions/src/lessonRuns src/lib/lessonRuns firestore.rules test/firestore.rules.test.ts
git commit -m "feat: add LessonCheckpoint writes and append-only checkpoint restore with restoreGeneration"
```

---

## Task 10: 先読み遮断 — 公開/非公開RTDBパスの型とルール

統合仕様書 §26-1、Phase 0計画が特定した`prices/*/runtime`・`companies/*/phases`の教訓を、**旧ツリーの修正としてではなく、新ツリーの最初の設計として**実装する。RTDBのルールカスケード（祖先の`.read: true`は子孫の`.read: false`で取り消せない）により、公開データと非公開データは**別の祖先を持つトップレベルノード**として設計しなければならない。Phase Aの時点では実際のライブ市場エンジン（Phase C）は存在しないため、本タスクの成果物は型とルールの骨格、およびそれがカスケード安全であることを証明するテストである。

**Files:**
- Create: `src/lib/lessonRuns/liveTypes.ts`, `.test.ts`
- Modify: `database.rules.json`, `test/database.rules.test.ts`

**Interfaces:**
- Produces: `LessonRunPublicState`、`LessonRunPrivateState`型

- [ ] **Step 1: 型を定義する**

`src/lib/lessonRuns/liveTypes.ts`:

```ts
/**
 * Fields safe to send to every participant in a lessonRun. Phase A defines
 * only the envelope; Phase B/C will add phase-specific display fields.
 *
 * INVARIANT (spec §26-1): this type must never gain a field that reveals
 * future prices, non-public coefficients, or a random seed. If a field here
 * would let a participant compute or look up such a value, it belongs in
 * LessonRunPrivateState instead — never as an optional/hidden field on this
 * type, because RTDB has no field-level rules: the whole node's `.read`
 * grant applies to everything under it.
 */
export interface LessonRunPublicState {
  status: string
  currentPhaseId: string | null
  updatedAtMillis: number
}

/**
 * Fields that must never reach a participant: future price plans, seeds,
 * non-public coefficients (spec §26-1). This type's data must live at a
 * SEPARATE top-level RTDB path from LessonRunPublicState — see
 * database.rules.json's `lessonRunPrivate` node. Do not nest this under
 * `lessonRunPublic/{lessonRunId}`; RTDB's read cascade means a broad grant
 * on an ancestor cannot be revoked by a `.read: false` on a descendant, so
 * nesting private data under a publicly-readable node reintroduces exactly
 * the vulnerability this split exists to close (see the "旧実装の廃止範囲"
 * section of this plan and Phase 0's findings on `prices/*/runtime` and
 * `companies/*/phases`).
 */
export interface LessonRunPrivateState {
  randomSeed: string
  restoreGeneration: number
  updatedAtMillis: number
}
```

- [ ] **Step 2: RTDBルールの失敗するテストを書く（カスケード安全性を直接検証する）**

`test/database.rules.test.ts`に追記する。

```ts
describe('lessonRun public/private RTDB path split', () => {
  it('lets an org member read the public lessonRun state', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.database().ref('orgAccess/personal_teacher-a/teacher-a').set({ role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 })
      await context.database().ref('orgAccessMeta/personal_teacher-a/teacher-a').set({ membershipVersion: 1, syncState: 'SYNCED' })
      await context.database().ref('lessonRunPublic/run-1').set({ status: 'RUNNING', currentPhaseId: 'phase-1', updatedAtMillis: 1, orgId: 'personal_teacher-a' })
    })
    const owner = environment.authenticatedContext('teacher-a', teacherToken).database()
    await assertSucceeds(get(ref(owner, 'lessonRunPublic/run-1')))
  })

  it('never lets a non-owner read the private lessonRun state, even though they can read the public state at the same lessonRunId', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.database().ref('orgAccess/personal_teacher-b/teacher-b').set({ role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 })
      await context.database().ref('orgAccessMeta/personal_teacher-b/teacher-b').set({ membershipVersion: 1, syncState: 'SYNCED' })
      await context.database().ref('lessonRunPublic/run-2').set({ status: 'RUNNING', currentPhaseId: 'phase-1', updatedAtMillis: 1, orgId: 'personal_teacher-b' })
      await context.database().ref('lessonRunPrivate/run-2').set({ randomSeed: 'top-secret-seed', restoreGeneration: 0, updatedAtMillis: 1, orgId: 'personal_teacher-b' })
    })
    const other = environment.authenticatedContext('teacher-a', teacherToken).database()
    // The regression this test guards against: if lessonRunPrivate were ever
    // nested under lessonRunPublic instead of being a sibling top-level
    // node, a broad read grant on the public tree would leak this.
    await assertFails(get(ref(other, 'lessonRunPrivate/run-2')))
  })

  it('lets only the owning teacher read their own private lessonRun state', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.database().ref('orgAccess/personal_teacher-a/teacher-a').set({ role: 'owner', status: 'active', membershipVersion: 1, revokedAtSeconds: 0 })
      await context.database().ref('orgAccessMeta/personal_teacher-a/teacher-a').set({ membershipVersion: 1, syncState: 'SYNCED' })
      await context.database().ref('lessonRunPrivate/run-1').set({ randomSeed: 'seed', restoreGeneration: 0, updatedAtMillis: 1, orgId: 'personal_teacher-a' })
    })
    const owner = environment.authenticatedContext('teacher-a', teacherToken).database()
    await assertSucceeds(get(ref(owner, 'lessonRunPrivate/run-1')))
  })

  it('rejects any client write to either path — both are server/Functions-only', async () => {
    const owner = environment.authenticatedContext('teacher-a', teacherToken).database()
    await assertFails(set(ref(owner, 'lessonRunPublic/run-3'), { status: 'RUNNING', currentPhaseId: null, updatedAtMillis: 1, orgId: 'personal_teacher-a' }))
    await assertFails(set(ref(owner, 'lessonRunPrivate/run-3'), { randomSeed: 'x', restoreGeneration: 0, updatedAtMillis: 1, orgId: 'personal_teacher-a' }))
  })
})
```

- [ ] **Step 3: 失敗を確認する**

Run: `npm run test:rules`
Expected: FAIL — `lessonRunPublic`/`lessonRunPrivate`に既存ルールがなくルートの`.read: false`/`.write: false`に落ちる。

- [ ] **Step 4: `database.rules.json`へ2つのトップレベルノードを追加する**

`orgAccess`と**同じ階層**（`liveMarkets`のような入れ子ではなく、ルート直下の兄弟ノード）に追加する。

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "serviceStatus": { "...": "変更なし" },
    "orgAccess": { "...": "変更なし（Task 4）" },
    "lessonRunPublic": {
      "$lessonRunId": {
        ".read": "auth != null && data.child('orgId').exists() && root.child('orgAccessMeta').child(data.child('orgId').val()).child(auth.uid).child('syncState').val() === 'SYNCED' && root.child('orgAccess').child(data.child('orgId').val()).child(auth.uid).child('status').val() === 'active' && root.child('orgAccess').child(data.child('orgId').val()).child(auth.uid).child('membershipVersion').val() === root.child('orgAccessMeta').child(data.child('orgId').val()).child(auth.uid).child('membershipVersion').val() && auth.token.auth_time >= root.child('orgAccess').child(data.child('orgId').val()).child(auth.uid).child('revokedAtSeconds').val()",
        ".write": false
      }
    },
    "lessonRunPrivate": {
      "$lessonRunId": {
        ".read": "auth != null && data.child('orgId').exists() && root.child('orgAccessMeta').child(data.child('orgId').val()).child(auth.uid).child('syncState').val() === 'SYNCED' && root.child('orgAccess').child(data.child('orgId').val()).child(auth.uid).child('status').val() === 'active' && root.child('orgAccess').child(data.child('orgId').val()).child(auth.uid).child('role').val() === 'owner' && root.child('orgAccess').child(data.child('orgId').val()).child(auth.uid).child('membershipVersion').val() === root.child('orgAccessMeta').child(data.child('orgId').val()).child(auth.uid).child('membershipVersion').val() && auth.token.auth_time >= root.child('orgAccess').child(data.child('orgId').val()).child(auth.uid).child('revokedAtSeconds').val()",
        ".write": false
      }
    }
  }
}
```

`lessonRunPublic`と`lessonRunPrivate`はどちらも`orgAccess`ミラーを参照する点で対称だが、**祖先を共有しない別々のトップレベルノード**であることが本タスクの核心である——将来Phase Cで`lessonRunPublic/{lessonRunId}`配下にフェーズ表示用の新しいフィールドを追加しても、`lessonRunPrivate`のルールには一切影響しない。逆に`lessonRunPrivate`を`lessonRunPublic/{lessonRunId}/private`のような子ノードにした場合、`lessonRunPublic/{lessonRunId}`の`.read`が既に`true`を返す条件下では、子ノードにどんな`.read: false`を書いても上書きされてしまう（RTDBのルールカスケード）。**この理由により、`lessonRunPrivate`を`lessonRunPublic`の子として実装することを本計画では禁止する。**

Rulesテストの教師tokenには秒単位の`auth_time`を明示する。entry versionとmeta versionの不一致、`syncState: 'PENDING'`、`auth_time < revokedAtSeconds`、entry欠落、meta欠落をそれぞれ拒否し、`auth_time >= revokedAtSeconds`かつ版一致・`SYNCED`だけを許可する表駆動テストを追加する。

- [ ] **Step 5: テストを通す**

Run: `npm run test:rules`
Expected: PASS

- [ ] **Step 6: `LessonRunPublicState`/`LessonRunPrivateState`の単体テストを書く（型のみだが、コメントで示した不変条件を将来のレビューで検知できるよう、フィールド網羅テストとして残す）**

`src/lib/lessonRuns/liveTypes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { LessonRunPrivateState, LessonRunPublicState } from './liveTypes'

describe('LessonRunPublicState / LessonRunPrivateState field separation', () => {
  it('LessonRunPublicState has no field named randomSeed or containing "seed"', () => {
    const publicKeys: (keyof LessonRunPublicState)[] = ['status', 'currentPhaseId', 'updatedAtMillis']
    expect(publicKeys.some((key) => key.toLowerCase().includes('seed'))).toBe(false)
  })
  it('LessonRunPrivateState carries randomSeed', () => {
    const privateKeys: (keyof LessonRunPrivateState)[] = ['randomSeed', 'restoreGeneration', 'updatedAtMillis']
    expect(privateKeys).toContain('randomSeed')
  })
})
```

（このテストは型の取り違えを機械的には検知できないが、フィールド一覧を明示的にリストさせることで、レビュー時に「`randomSeed`を`LessonRunPublicState`へ追加しようとした差分」が`publicKeys`配列の変更として必ず目に見える形にする。）

- [ ] **Step 7: `npm run verify` を通す**

- [ ] **Step 8: Commit**

```bash
git add src/lib/lessonRuns/liveTypes.ts src/lib/lessonRuns/liveTypes.test.ts database.rules.json test/database.rules.test.ts
git commit -m "feat: split public/private lessonRun RTDB paths as cascade-safe sibling nodes"
```

---

## Task 11: 個人データのエクスポート

統合仕様書 §21.1「個人単位のエクスポートは基盤機能として提供する」、§21.7（形式: JSON/CSV等）を実装する。Phase Aでは生徒参加者データが存在しないため、対象は本人の`users/{uid}`、個人組織、membership、RTDB access mirror、および個人組織が所有する`LessonTemplate`/`LessonVersion`/`LessonRun`/`LessonEvent`/`LessonCheckpoint`とする。所有データだけでなく、本人と認可を表す基盤レコードも漏らさない。

**Files:**
- Create: `functions/src/privacy/exportPersonalData.ts`, `.test.ts`, `onCall.ts`
- Create: `src/lib/privacy/exportPersonalData.ts`, `.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Produces: `exportPersonalData(deps): Promise<PersonalDataExport>`、`exportPersonalDataCallable`

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/privacy/exportPersonalData.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { exportPersonalData } from './exportPersonalData'

describe('exportPersonalData', () => {
  it('collects every lessonTemplate, its versions, and every lessonRun owned by the org, keyed for a JSON download', async () => {
    const templates = [{ id: 't1', orgId: 'personal_teacher-a', createdByUid: 'teacher-a', draft: {} }]
    const versions = { t1: [{ id: 'v1', templateId: 't1' }] }
    const runs = [{ id: 'r1', orgId: 'personal_teacher-a', templateId: 't1' }]
    const events = { r1: [{ eventId: 'e1', sequence: 0 }] }
    const checkpoints = { r1: [{ id: 'c1', sequence: 0 }] }
    const result = await exportPersonalData({
      uid: 'teacher-a',
      orgId: 'personal_teacher-a',
      getUser: async () => ({ id: 'teacher-a', displayName: 'Teacher A' }),
      getOrganization: async () => ({ id: 'personal_teacher-a', type: 'personal' }),
      getMembership: async () => ({ uid: 'teacher-a', role: 'owner', status: 'active' }),
      getOrgAccessMirror: async () => ({ role: 'owner', status: 'active', membershipVersion: 1 }),
      getOrgAccessMeta: async () => ({ membershipVersion: 1, syncState: 'SYNCED' }),
      listLessonTemplates: async () => templates,
      listLessonVersions: async (templateId: string) => versions[templateId as keyof typeof versions] ?? [],
      listLessonRuns: async () => runs,
      listLessonEvents: async (lessonRunId: string) => events[lessonRunId as keyof typeof events] ?? [],
      listLessonCheckpoints: async (lessonRunId: string) => checkpoints[lessonRunId as keyof typeof checkpoints] ?? [],
    })
    expect(result).toEqual({
      exportedAt: expect.any(String),
      uid: 'teacher-a',
      orgId: 'personal_teacher-a',
      user: { id: 'teacher-a', displayName: 'Teacher A' },
      organization: { id: 'personal_teacher-a', type: 'personal' },
      membership: { uid: 'teacher-a', role: 'owner', status: 'active' },
      orgAccessMirror: { role: 'owner', status: 'active', membershipVersion: 1 },
      orgAccessMeta: { membershipVersion: 1, syncState: 'SYNCED' },
      lessonTemplates: [{ ...templates[0], versions: versions.t1 }],
      lessonRuns: [{ ...runs[0], events: events.r1, checkpoints: checkpoints.r1 }],
    })
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/privacy/exportPersonalData.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`functions/src/privacy/exportPersonalData.ts`:

```ts
export interface ExportPersonalDataDeps {
  uid: string
  orgId: string
  getUser: () => Promise<Record<string, unknown> | null>
  getOrganization: () => Promise<Record<string, unknown> | null>
  getMembership: () => Promise<Record<string, unknown> | null>
  getOrgAccessMirror: () => Promise<Record<string, unknown> | null>
  getOrgAccessMeta: () => Promise<Record<string, unknown> | null>
  listLessonTemplates: () => Promise<Record<string, unknown>[]>
  listLessonVersions: (templateId: string) => Promise<Record<string, unknown>[]>
  listLessonRuns: () => Promise<Record<string, unknown>[]>
  listLessonEvents: (lessonRunId: string) => Promise<Record<string, unknown>[]>
  listLessonCheckpoints: (lessonRunId: string) => Promise<Record<string, unknown>[]>
  now?: () => string
}

/**
 * Spec §21.1: personal export is a baseline feature, not paid/enterprise
 * only. Phase A's scope is everything a personal org owns directly —
 * identity, authorization records, templates, their versions, runs, and
 * runs' event/checkpoint history.
 * Phase B+ will extend this once participant-owned data (results,
 * transcripts) exists.
 */
export const exportPersonalData = async (deps: ExportPersonalDataDeps) => {
  const [user, organization, membership, orgAccessMirror, orgAccessMeta] = await Promise.all([
    deps.getUser(), deps.getOrganization(), deps.getMembership(),
    deps.getOrgAccessMirror(), deps.getOrgAccessMeta(),
  ])
  const templates = await deps.listLessonTemplates()
  const lessonTemplates = await Promise.all(templates.map(async (template) => ({
    ...template, versions: await deps.listLessonVersions(template.id as string),
  })))
  const runs = await deps.listLessonRuns()
  const lessonRuns = await Promise.all(runs.map(async (run) => ({
    ...run,
    events: await deps.listLessonEvents(run.id as string),
    checkpoints: await deps.listLessonCheckpoints(run.id as string),
  })))
  return {
    exportedAt: (deps.now ?? (() => new Date().toISOString()))(),
    uid: deps.uid, orgId: deps.orgId,
    user, organization, membership, orgAccessMirror, orgAccessMeta,
    lessonTemplates, lessonRuns,
  }
}
```

- [ ] **Step 4: テストを通す**

Run: `cd functions && npx vitest run src/privacy/exportPersonalData.test.ts`
Expected: PASS

- [ ] **Step 5: Admin SDK版と`onCall`ハンドラを実装する**

Admin SDKのFirestore queryとRTDB readで各adapterを実装する。`exportPersonalDataCallable`は本人のprivacy権を通常のresource認可から分離する。`orgId`をリクエストから受け取らず`personalOrgId(request.auth.uid)`で固定し、`organizations/{orgId}.ownerUid == request.auth.uid`をAdmin SDKで検証する。membershipが`suspended`でも本人exportは許可する一方、他人・別org・匿名は拒否する。高リスク操作と同様にrecent sign-in（`request.auth.token.auth_time`がサーバー現在時刻の10分以内）を要求する。operator代理経路を追加する場合は`operator == true`と正式request IDを別入力・別監査ログで必須にし、本人経路と混ぜない。上記の基盤レコードを含む完全なJSON shapeをテストし、`functions/src/index.ts`へ追記する。

- [ ] **Step 6: クライアントラッパーを実装する**

`src/lib/privacy/exportPersonalData.ts`（`httpsCallable`パターン、戻り値をブラウザで`Blob`化してダウンロードさせる部分はUIなのでPhase Aでは実装しない——関数は結果のJSONを返すところまでとする）。

- [ ] **Step 7: `npm run verify` を通す**

- [ ] **Step 8: Commit**

```bash
git add functions/src/privacy/exportPersonalData.ts functions/src/privacy/exportPersonalData.test.ts src/lib/privacy/exportPersonalData.ts src/lib/privacy/exportPersonalData.test.ts functions/src/index.ts
git commit -m "feat: add complete personal-organization data export"
```

---

## Task 12: 個人データの削除（ソフト削除30日・完全削除）

統合仕様書 §21.1・§21.3・§21.4を実装する。§21.3の優先順位「1. 本人・学校からの正式な完全削除要求（復元期間なし）」と「4. 教師の誤操作（30日復元）」に対応する2種類のCallableを用意する。旧`src/lib/teacher/marketDeletion.ts`の30日ヒューリスティックの考え方を踏襲するが、対象は`marketResults`/`liveMarkets`ではなく`lessonTemplates`/`lessonRuns`。

**Files:**
- Create: `functions/src/privacy/deletePersonalData.ts`, `.test.ts`、`onCall.ts`への追記
- Create: `functions/src/privacy/purgeExpiredSoftDeletes.ts`, `.test.ts`（daily scheduled Function）
- Create: `src/lib/privacy/deletePersonalData.ts`, `.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Produces: `requestSoftDelete(deps)`（30日後に完全削除対象としてマークするだけで即時削除しない）、`purgeHardDelete(deps)`（単一教材/授業の即時・復元不可削除）、`restoreSoftDeleted(deps)`（30日以内の取り消し）、`purgePersonalOrganization(deps)`（正式な本人要求で個人組織スコープ全体を即時・復元不可削除）

- [ ] **Step 1: 失敗するテストを書く**

`functions/src/privacy/deletePersonalData.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { purgeHardDelete, requestSoftDelete, restoreSoftDeleted } from './deletePersonalData'

const makeFakeStore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    get: async (path: string) => ({ exists: docs.has(path), data: () => docs.get(path) }),
    update: async (path: string, data: Record<string, unknown>) => { docs.set(path, { ...docs.get(path), ...data }) },
    clearPendingDeletion: async (path: string) => { const { pendingDeletion: _, ...rest } = docs.get(path) ?? {}; docs.set(path, rest) },
    recursiveDelete: async (path: string) => { for (const key of docs.keys()) if (key === path || key.startsWith(`${path}/`)) docs.delete(key) },
  }
}

describe('requestSoftDelete', () => {
  it('marks a lessonRun for deletion 30 days out instead of deleting it immediately', async () => {
    const store = makeFakeStore()
    store.docs.set('lessonRuns/run-1', { orgId: 'personal_teacher-a', status: 'COMPLETED' })
    const now = () => new Date('2026-08-05T00:00:00.000Z')
    await requestSoftDelete({ store, path: 'lessonRuns/run-1', now, reason: '誤操作' })
    const doc = store.docs.get('lessonRuns/run-1')
    expect(doc?.pendingDeletion).toMatchObject({ reason: '誤操作', purgeAfter: '2026-09-04T00:00:00.000Z' })
    expect(store.docs.has('lessonRuns/run-1')).toBe(true) // still present — not actually deleted yet
  })
})

describe('restoreSoftDeleted', () => {
  it('clears pendingDeletion within the 30-day window', async () => {
    const store = makeFakeStore()
    store.docs.set('lessonRuns/run-1', { orgId: 'personal_teacher-a', pendingDeletion: { reason: 'x', purgeAfter: '2026-09-04T00:00:00.000Z' } })
    await restoreSoftDeleted({ store, path: 'lessonRuns/run-1', now: () => new Date('2026-08-20T00:00:00.000Z') })
    expect(store.docs.get('lessonRuns/run-1')?.pendingDeletion).toBeUndefined()
  })

  it('rejects restore once the 30-day deadline has elapsed', async () => {
    const store = makeFakeStore()
    store.docs.set('lessonRuns/run-1', { pendingDeletion: { purgeAfter: '2026-09-04T00:00:00.000Z' } })
    await expect(restoreSoftDeleted({ store, path: 'lessonRuns/run-1', now: () => new Date('2026-09-05T00:00:00.000Z') }))
      .rejects.toThrow('Restore window expired')
  })
})

describe('purgeHardDelete', () => {
  it('deletes immediately with no restore path, for a formal complete-deletion request (spec §21.3 priority 1, §26-9)', async () => {
    const store = makeFakeStore()
    store.docs.set('lessonRuns/run-1', { orgId: 'personal_teacher-a' })
    store.docs.set('lessonRuns/run-1/events/e1', { orgId: 'personal_teacher-a' })
    store.docs.set('lessonRuns/run-1/checkpoints/c1', { orgId: 'personal_teacher-a' })
    await purgeHardDelete({ store, path: 'lessonRuns/run-1' })
    expect(store.docs.has('lessonRuns/run-1')).toBe(false)
    expect([...store.docs.keys()].some((key) => key.startsWith('lessonRuns/run-1/'))).toBe(false)
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `cd functions && npx vitest run src/privacy/deletePersonalData.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 実装する**

`functions/src/privacy/deletePersonalData.ts`:

```ts
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export interface Store {
  get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
  update: (path: string, data: Record<string, unknown>) => Promise<void>
  clearPendingDeletion: (path: string) => Promise<void>
  recursiveDelete: (path: string) => Promise<void>
}

/**
 * Normal (accidental-deletion-recovery) path: spec §21.4's "通常削除は30日間
 * 復元可能" and §21.3 priority 4 "教師の誤操作 → 30日復元". Marks the
 * document rather than deleting it. Task 12's scheduled purge reads
 * `pendingDeletion.purgeAfter` and permanently deletes it once due.
 */
export const requestSoftDelete = async (input: { store: Store; path: string; reason: string; now?: () => Date }): Promise<void> => {
  const now = (input.now ?? (() => new Date()))()
  await input.store.update(input.path, { pendingDeletion: { reason: input.reason, requestedAt: now.toISOString(), purgeAfter: new Date(now.getTime() + THIRTY_DAYS_MS).toISOString() } })
}

export const restoreSoftDeleted = async (input: { store: Store; path: string; now?: () => Date }): Promise<void> => {
  const snap = await input.store.get(input.path)
  if (!snap.exists) throw new Error('Document not found')
  const pendingDeletion = snap.data()?.pendingDeletion as { purgeAfter?: string } | undefined
  if (!pendingDeletion?.purgeAfter) throw new Error('Document is not pending deletion')
  const now = (input.now ?? (() => new Date()))()
  if (now.getTime() >= new Date(pendingDeletion.purgeAfter).getTime()) throw new Error('Restore window expired')
  await input.store.clearPendingDeletion(input.path)
}

/**
 * Formal complete-deletion path: spec §21.3 priority 1 "本人・学校からの
 * 正式な完全削除要求 → 復元期間なし" and §26-9 "正式な完全削除要求を
 * ソフト削除へ回さない" — this function must never be reached by the
 * teacher-misclick UI flow (Phase B), only by an explicit, confirmed
 * complete-deletion request.
 */
export const purgeHardDelete = async (input: { store: Store; path: string }): Promise<void> => {
  await input.store.recursiveDelete(input.path)
}
```

- [ ] **Step 4: テストを通す**

Run: `cd functions && npx vitest run src/privacy/deletePersonalData.test.ts`
Expected: PASS

- [ ] **Step 5: Admin SDK版と`onCall`ハンドラを実装する**

`requestSoftDeleteCallable`・`restoreSoftDeletedCallable`・`purgeHardDeleteCallable`・`purgePersonalOrganizationCallable`を追加する。resource操作の3 Callableは`isCallerTeacher`とTask 5の`requireActiveOrgMember`を必須にし、対象パスを`lessonTemplates/{id}`または`lessonRuns/{id}`の2セグメントだけに正規化して、対象ドキュメントの`orgId`とactive membershipを検証する（path traversal、他組織、`suspended`を拒否）。Admin SDK実装の`clearPendingDeletion`は`FieldValue.delete()`、`recursiveDelete`は`getFirestore().recursiveDelete(docRef)`を使い、subcollectionを残さない。`lessonRuns`のhard deleteではRTDBの`lessonRunPublic/{id}`・`lessonRunPrivate/{id}`もAdmin SDKのroot updateで`null`化する。

正式な本人要求を扱う`purgePersonalOrganizationCallable`はactive membershipを要求しない。Task 11と同じownerUid照合、recent sign-in、`confirm: true`、uid再入力で本人性を検証し、`suspended`本人も実行できる。個人org配下の全template/version/run/event/checkpoint、`organizations/{orgId}`とmembers、`users/{uid}`、RTDBの`orgAccess/{orgId}`・`orgAccessMeta/{orgId}`・全run public/private nodeを対象にする。operator代理経路は正式request IDと監査ログを必須にする。

すべてのhard delete（単一resourceと個人org全体）へ同じoperation-doc sagaを適用する。各Firestore/RTDB resource groupの削除完了状態を記録し、途中失敗後は未完了部分だけを再試行する。操作docは`privacyDeletionOperations/{idempotencyDocumentId(orgId, idempotencyKey)}`、digestは`requestDigest({ uid, orgId, operationKind, target, confirmedIdentifier })`とし、同じキーを別要求へ再利用した場合は拒否する。操作doc自身は全削除完了後に個人情報を含まないhash、完了時刻、結果だけを保持する。

hard-delete Callableは追加で`confirm: true`、対象ID（個人全体ならuid）の再入力、`idempotencyKey`を必須にし、誤操作でソフト削除の30日枠を飛び越えられないようにする。テストでは、resource削除でroot/subcollection/対応RTDBノードが消えること、個人全体削除でTask 11が列挙する全データと認可mirrorが消えること、Firestore成功/RTDB失敗および逆順失敗後の同一key再試行、semantic digest不一致、期限後restore、別組織・不正path、resource操作の`suspended`拒否、本人privacy操作の`suspended`許可を検証する。

- [ ] **Step 6: 期限到達したソフト削除をpurgeするscheduled FunctionをTDDで実装する**

`purgeExpiredSoftDeletes.ts`は`onSchedule({ schedule: 'every day 03:00', timeZone: 'Asia/Tokyo', region: 'asia-northeast1' })`を使う。`lessonTemplates`と`lessonRuns`を`pendingDeletion.purgeAfter <= now`でページングし、各docを上記と同じoperation-doc sagaへ渡す。未到来は削除しない、期限ちょうどは削除する、1件失敗しても他件を処理して失敗を記録する、同じdocの次回実行はdeduplicate/再開することをfake clock/storeでテストする。`functions/src/index.ts`からexportする。予定実行の本番有効化はTask 13のBlaze外部ゲートに従う。

- [ ] **Step 7: クライアントラッパーを実装する**

`src/lib/privacy/deletePersonalData.ts`に4つの`httpsCallable`ラッパーを実装する。

- [ ] **Step 8: `npm run verify` を通す**

- [ ] **Step 9: Commit**

```bash
git add functions/src/privacy/deletePersonalData.ts functions/src/privacy/deletePersonalData.test.ts functions/src/privacy/purgeExpiredSoftDeletes.ts functions/src/privacy/purgeExpiredSoftDeletes.test.ts src/lib/privacy/deletePersonalData.ts src/lib/privacy/deletePersonalData.test.ts functions/src/index.ts
git commit -m "feat: add recoverable resource deletion and complete personal purge"
```

---

## Task 13: Blazeプラン・予算アラートの外部リリースゲート

`phase1a`計画 Task 1 Step 1と同一内容。Task 2で暫定的に触れているが、本タスクで実施記録を確定する。

**Files:**
- Create: `docs/operations/firebase-billing-readiness.md`

- [ ] **Step 1: 機密値を含まない確認記録テンプレートを作る**

`docs/operations/firebase-billing-readiness.md`へ、Firebase project ID、Blaze移行状態、予算アラート設定状態、確認日、確認者、証跡URL（アクセス制限付き管理画面へのリンクのみ。billing account ID・認証情報は書かない）のチェック欄を作る。実装者に本番課金変更権限がない場合は`PENDING_EXTERNAL_APPROVAL`と記録し、コード完了を妨げない一方、本番公開は明確にブロックする。

- [ ] **Step 2: 読み取り権限とbilling account IDがユーザーから明示提供された場合だけ確認コマンドを実行する**

Run: `gcloud billing budgets list --billing-account=<ACCOUNT_ID>`
Expected: 予算が1件以上表示される。

`<ACCOUNT_ID>`を推測しない。権限・値が提供されていない場合はコマンドを実行せず、Step 1の状態を`PENDING_EXTERNAL_APPROVAL`にする。

- [ ] **Step 3: Commit**

```bash
git add docs/operations/firebase-billing-readiness.md
git commit -m "docs: Firebase課金のリリースゲートを記録"
```

---

## Task 14: Phase A 完了条件の検証

**Files:** なし（検証タスク）

- [ ] **Step 1: `npm run verify` が通ることを確認する**

Run: `npm run verify`
Expected: 全ワークスペース（ルート・`functions`・`packages/deterministic-random`）の`lint`/`typecheck`/`test`/`test:rules`/`build`が成功する。

- [ ] **Step 2: 統合仕様書 §31「基盤」チェックリストを、本計画のタスクへ対応づけて確認する**

- [ ] `orgId`所有 → Task 6・7（`lessonTemplates`・`lessonRuns`の`orgId`不変性ルールテスト）
- [ ] 個人組織 → Task 5（`ensurePersonalOrg`冪等性テスト）
- [ ] 権限ミラー → Task 4（`orgAccess`書き込み不能・本人のみ読み取り）
- [ ] 失効 → Task 4 Step 1の`suspended`テスト（本人はメンバーシップを読めるが、Task 6/7のリソースルールが`activeMember`を要求するため停止後はリソースへアクセスできない——この関連を検証するテストをTask 6 Step 6・Task 7 Step 10に追加済みであることを確認する）
- [ ] 教材版 → Task 6（`versions`サブコレクションの不変性）
- [ ] 授業実施 → Task 7（`LessonRun`のスナップショット固定・`randomSeed`生成）
- [ ] イベントログ → Task 8（`sequence`単調増加・`idempotencyKey`重複排除・追記専用）
- [ ] チェックポイント → Task 9（`writeCheckpoint`・追記専用ルール）
- [ ] リプレイ → Task 3（決定的PRNGの再現性テスト）・Task 9（`restoreGeneration`による世代分離）。**実際のイベント列再生ロジックはPhase C以降——Phase Aが保証するのは「再生に必要な決定性の土台」までである旨を明記する。**
- [ ] 冪等性 → Task 5（`ensurePersonalOrg`）・Task 7（`createLessonRun`）・Task 8（`appendLessonEvent`）・Task 9（`restoreCheckpoint`）
- [ ] 個人削除・エクスポート → Task 11・Task 12

- [ ] **Step 3: 統合仕様書 §27.1（受け入れテスト・セキュリティ）を測定可能な形で確認する**

| 受け入れ項目 | Phase Aでの検証方法 | 状態 |
| --- | --- | --- |
| 生徒が非公開価格情報を読めない | Task 10「never lets a non-owner read the private lessonRun state」テスト。実際の生徒参加・価格データはPhase C以降のため、本テストは`lessonRunPrivate`パス自体のカスケード安全性の代理検証である。 | Phase Aで検証済み（代理）、Phase Cで実データに対して再検証必須 |
| 別組織の教材・結果を読めない | Task 6「rejects a template whose orgId does not match」、Task 7「lets the owning teacher read their own lessonRun but not another teacher's」 | 検証済み |
| 停止済みメンバーが授業へアクセスできない | Task 4 Step 1 + Task 6/7の`activeMember`要求。個人組織は常時1メンバーのため「停止後に他人が入れ替わってアクセスする」ケースはPhase F（学校組織）まで意味を持たない——本Phaseでは「`status`が`suspended`のメンバーはリソースを読めない」ことだけを検証する。 | 部分的に検証済み。学校組織での複数メンバー間の失効はPhase F |
| 教室表示から個人データを取得できない | 対象外——教室表示はPhase B | Phase B以降で検証 |
| クライアントが`orgId`を書き換えられない | Task 6 Step 6、Task 7 Step 10 | 検証済み |
| AI送信前に禁止データが除外される | 対象外——AIはPhase E | Phase E以降で検証 |

- [ ] **Step 4: 回帰がないことを確認する**

Run: `npm test && npm run test:rules`
Expected: Task 1で意図的に削除した旧テスト以外、すべて成功する。

- [ ] **Step 5: UIに変更がないことを確認する（Task 1の意図的な削除を除く）**

Run: `git diff --stat "$(git merge-base docs/lesson-platform-roadmap HEAD)"...HEAD -- src/components`
Expected: Task 1で削除したファイル（`WorkspacePicker.tsx`等）以外の`src/components`への変更がないこと。

- [ ] **Step 6: 外部リリースゲートを判定する**

`docs/operations/firebase-billing-readiness.md`が`VERIFIED`なら本番公開準備済み、`PENDING_EXTERNAL_APPROVAL`ならPhase Aのコード実装は完了扱いにできるが、Functionsを必要とする本番公開は不可と記録する。外部権限不足をテスト成功で代替しない。

---

## Self-Review

**1. 仕様網羅性:**

- 統合仕様書 §25 Phase Aの10項目（旧市場・旧API廃止方針/先読み遮断/型・パス分離/個人組織/`orgId`/権限ミラー/共通イベントログ/冪等処理/教材・版・授業実施モデル/個人データ削除・エクスポート）→ 順にTask 1／Task 10／Task 10／Task 5／Task 6・7／Task 4／Task 8／Task 5・7・8・9／Task 6・7／Task 11・12 に対応。
- §26の18不変条件のうち本Phaseに関係するもの（1・3・4・5・9・10・17・18）→ Task 10（1）、Task 6/7の`allow write: if false`（3、正本はサーバー側）、Task 7/8/9のidempotencyKey（4）、Task 7のtemplateSnapshot固定（5）、Task 12のpurgeHardDelete（9）、Task 12（10、v1互換コードを一切残さない）、Task 6〜9のCallable専用書き込み（17）、Task 4 Step 8→Task 6/7の`activeMember`（18）でそれぞれ担保。
- §27.1受け入れテスト → Task 14 Step 3の表で個別対応・非対応を明記。
- ユーザー指示「必ず含めること」1〜9 → 1=「旧実装の廃止範囲」節、2=Task 1・10、3=Task 8・9、4=Task 5、5=Task 4、6=Task 11・12、7=各タスクのRun/Expected、8=Task 14。

**2. プレースホルダー検査:** 全タスクに具体的なコード・コマンド・期待結果を記載した。Task 1 Step 1の「削除対象の依存関係を洗い出す」はコード内容を事前確定できないが、実行するgrepコマンドと判定基準（表に無いものは削除するか残すかをこのステップで判断）を明示しており、調査手順の具体化であって空白ではない。

**3. 型・シグネチャの一貫性:** `personalOrgId(uid: string): string`はTask 3で定義後、Task 5〜9で一貫使用。`LessonContent`/`LessonTemplate`/`LessonVersion`はTask 6で定義後、Task 7の`createLessonRun`が`templateSnapshot: LessonContent`として消費する型と一致させた。`appendLessonEvent`の戻り値`{ eventId; sequence; deduplicated }`はTask 8で定義後、Task 9の`restoreCheckpoint`が`AppendLessonEventFn`として同一シグネチャで消費する。`LessonRunPublicState`/`LessonRunPrivateState`はTask 10で定義し、他タスクはまだ消費しない（Phase B/C側の消費はPhase Aの範囲外）。
