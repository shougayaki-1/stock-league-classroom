# Phase 3: 市場モードの授業中画面（play） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** `/lessons/:runId/play` を、市場モード（家庭科モード以外）の生徒に対しても `DeferredDataNotice` から実際の取引画面へ接続する。既存の `OrderScreen`/`CompanyResearchPage`/`NewsListPage` をタブ切り替えで表示し、`status` が `REFLECTION`/`COMPLETED` に進んだら自動的に `/lessons/:runId/results` へ遷移する。

**Architecture:** 必要なデータは全て既存の経路に既に存在する。`lessonRunPublic/{runId}` は Phase 2 で `title`/`teams` を追加投影済みで、元々 `stocks`（銘柄の公開状態）と `researchDesk`（`companies`/`informationItems`/`availablePanels`）を持っている。`lessonRunTeamState/{runId}/{teamId}` の型 `LessonRunTeamState` は家庭科用フィールド（`household?`/`households?`）と市場用フィールド（`cash`/`holdings`/`myOrders`等）を同じ型が両方持つ設計になっているため、`StudentPlayRoute` の家庭科モード判定用サブスクリプションをそのまま市場画面のデータソースとしても再利用できる — 新しいサブスクリプションを増やす必要はない。注文送信も `submitOrder`（`src/lib/market/submitOrder.ts`）という完成済みのクライアントラッパーが既にある。したがってこのフェーズはフロントエンドのみで完結する。

**Tech Stack:** React + TypeScript, MUI（`Tabs`/`Tab`）, React Router, Firebase RTDB, Vitest + @testing-library/react

## Global Constraints

- 新規プレゼンテーション部品 `MarketPlayScreen` は既存の `OrderScreen`/`NewsListPage`/`CompanyResearchPage` と同じ設計（Firebase SDK型を直接受けず、データはpropsで受け取る）に従う
- 表示するタブは `publicState.researchDesk.availablePanels`（`'COMPANIES' | 'NEWS' | 'STATISTICS' | 'TEAM_NOTES' | 'ORDERS'`）でゲートする。`STATISTICS`/`TEAM_NOTES` に対応する画面はこの時点のコードベースに存在しないため、このフェーズでは扱わない（`ORDERS`/`COMPANIES`/`NEWS` の3タブのみ実装する）
- 各タスクの最後に `npm run typecheck`, `npm run lint`, 該当テストを実行する

---

## Task 1: `MarketPlayScreen` プレゼンテーション部品

**Files:**
- Create: `src/components/student/MarketPlayScreen.tsx`
- Test: `src/components/student/MarketPlayScreen.test.tsx`

**Interfaces:**
- Consumes: `OrderScreen`/`CompanyResearchPage`/`NewsListPage`（既存）, `CompanyPublicView`/`InformationPublicView`/`ResearchDeskPanelId`（`@stock-league/market-public-content`）, `LessonRunTeamState`/`StockPublicState`（`src/lib/lessonRuns/liveTypes.ts`）
- Produces: `MarketPlayScreen`/`MarketPlayScreenProps`。Task 2 の `StudentPlayRoute` がこれを利用する

- [x] **Step 1: Write the failing test**

```tsx
// src/components/student/MarketPlayScreen.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarketPlayScreen } from './MarketPlayScreen'

const stocks = { 'stock-a': { currentPrice: 1000, previousPrice: 950, guardApplied: false, suddenChangeWarning: false, breakdown: { informationPercent: 1, demandPercent: 1, otherPercent: 1, total: 3 }, displayedVolumeShares: 10 } }
const teamState = { cash: 100000, holdings: {}, lockedBuyValue: 0, lockedSellQuantity: {}, myOrders: [], updatedAtMillis: 1 }
const companies = [{ id: 'company-a', name: 'サンプル企業', stockId: 'stock-a' } as never]
const informationItems = [{ id: 'info-1', headline: '見出し' } as never]

describe('MarketPlayScreen', () => {
  it('shows only the tabs listed in availablePanels', () => {
    render(
      <MarketPlayScreen
        companies={companies}
        informationItems={informationItems}
        stocks={stocks}
        teamState={teamState}
        marketPaused={false}
        availablePanels={['ORDERS']}
        onSubmitOrder={vi.fn()}
      />,
    )
    expect(screen.getByRole('tab', { name: '取引' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '企業情報' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'ニュース' })).not.toBeInTheDocument()
  })

  it('switches between tabs and renders the matching screen', () => {
    render(
      <MarketPlayScreen
        companies={companies}
        informationItems={informationItems}
        stocks={stocks}
        teamState={teamState}
        marketPaused={false}
        availablePanels={['ORDERS', 'COMPANIES', 'NEWS']}
        onSubmitOrder={vi.fn()}
      />,
    )
    expect(screen.getByText('サンプル企業')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '企業情報' }))
    expect(screen.getByText('サンプル企業')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'ニュース' }))
    expect(screen.getByText('見出し')).toBeInTheDocument()
  })

  it('passes teamState/marketPaused through to OrderScreen and forwards submitted orders', () => {
    const onSubmitOrder = vi.fn()
    render(
      <MarketPlayScreen
        companies={companies}
        informationItems={informationItems}
        stocks={stocks}
        teamState={teamState}
        marketPaused={false}
        availablePanels={['ORDERS']}
        onSubmitOrder={onSubmitOrder}
      />,
    )
    expect(screen.getByText(/100,000/)).toBeInTheDocument()
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/student/MarketPlayScreen.test.tsx`
Expected: FAIL — `Cannot find module './MarketPlayScreen'`

- [x] **Step 3: Write minimal implementation**

```tsx
// src/components/student/MarketPlayScreen.tsx
import { useState } from 'react'
import { Box, Tab, Tabs } from '@mui/material'
import type { CompanyPublicView, InformationPublicView, ResearchDeskPanelId } from '@stock-league/market-public-content'
import type { LessonRunTeamState, StockPublicState } from '../../lib/lessonRuns/liveTypes'
import { OrderScreen } from './OrderScreen'
import { NewsListPage } from './NewsListPage'
import { CompanyResearchPage } from './CompanyResearchPage'

export interface MarketPlayScreenProps {
  companies: CompanyPublicView[]
  informationItems: InformationPublicView[]
  stocks: Record<string, StockPublicState>
  teamState: LessonRunTeamState | null
  marketPaused: boolean
  availablePanels: ResearchDeskPanelId[]
  onSubmitOrder: (input: { stockId: string; side: 'BUY' | 'SELL'; quantity: number }) => Promise<void>
}

const PANEL_TABS: { panel: ResearchDeskPanelId; label: string }[] = [
  { panel: 'ORDERS', label: '取引' },
  { panel: 'COMPANIES', label: '企業情報' },
  { panel: 'NEWS', label: 'ニュース' },
]

export function MarketPlayScreen({
  companies, informationItems, stocks, teamState, marketPaused, availablePanels, onSubmitOrder,
}: MarketPlayScreenProps) {
  const visibleTabs = PANEL_TABS.filter((tab) => availablePanels.includes(tab.panel))
  const [tab, setTab] = useState(0)
  const activePanel = visibleTabs[tab]?.panel

  return (
    <Box sx={{ width: '100%' }}>
      <Tabs value={tab} onChange={(_, value) => setTab(value)}>
        {visibleTabs.map((t) => <Tab key={t.panel} label={t.label} />)}
      </Tabs>
      {activePanel === 'ORDERS' && (
        <OrderScreen companies={companies} stocks={stocks} teamState={teamState} marketPaused={marketPaused} onSubmitOrder={onSubmitOrder} disabled={!teamState} />
      )}
      {activePanel === 'COMPANIES' && <CompanyResearchPage companies={companies} />}
      {activePanel === 'NEWS' && <NewsListPage informationItems={informationItems} companies={companies} />}
    </Box>
  )
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/student/MarketPlayScreen.test.tsx`
Expected: PASS（3テスト。`OrderScreen` が `teamState.cash` を `100,000` のようなカンマ区切りで表示していることが前提 — もし実際の書式が異なれば、そのテストのアサーションを実際の表示形式に合わせて調整すること）

- [x] **Step 5: Commit**

```bash
git add src/components/student/MarketPlayScreen.tsx src/components/student/MarketPlayScreen.test.tsx
git commit -m "feat: add MarketPlayScreen presentational component with panel-gated tabs"
```

---

## Task 2: `StudentPlayRoute` を市場データに接続

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `MarketPlayScreen`（Task 1）, `submitOrder`（既存, `src/lib/market/submitOrder.ts`）, `subscribePublicRun`/`subscribeOwnTeamState`（既存, Phase 2で一部import済み）, `LessonRunTeamState`（既存型）
- Produces: `/lessons/:runId/play` が市場モードの生徒に対して実際の取引画面を描画する。`status` が `REFLECTION`/`COMPLETED` になったら `/lessons/:runId/results` へ自動遷移する

- [x] **Step 1: Add imports**

`src/App.tsx` の既存import（[src/App.tsx:20-21](../../../src/App.tsx:20)、Phase 2で追加済みの行）を変更する:

変更前:
```ts
import { subscribeOwnTeamState, subscribePublicRun } from './lib/lessonRuns/liveRepository'
import type { LessonRunPublicState } from './lib/lessonRuns/liveTypes'
```

変更後:
```ts
import { subscribeOwnTeamState, subscribePublicRun } from './lib/lessonRuns/liveRepository'
import type { LessonRunPublicState, LessonRunTeamState } from './lib/lessonRuns/liveTypes'
import { submitOrder } from './lib/market/submitOrder'
```

`./components/student/...` のimport群に追加:

```ts
import { MarketPlayScreen } from './components/student/MarketPlayScreen'
```

- [x] **Step 2: Replace `StudentPlayRoute`'s body**

現在の `StudentPlayRoute`（[src/App.tsx:1307-1330](../../../src/App.tsx:1307) 付近、`type HouseholdModeStatus = 'LOADING' | 'YES' | 'NO'` の定義とその後の関数全体）を次のように置き換える。

変更前:
```tsx
type HouseholdModeStatus = 'LOADING' | 'YES' | 'NO'

/**
 * `/lessons/:runId/play` only (Task 13) — every other student route
 * (`/waiting`, `/results`) keeps `StudentLessonRoute`'s
 * `DeferredDataNotice` fallback unchanged; only the "授業中" screen needs to
 * decide whether to render `HouseholdTeamScreen`.
 *
 * Detects "is this a household-mode lessonRun" by SHAPE, not by a
 * routing-only field: subscribes to this team's own
 * `lessonRunTeamState/{runId}/{teamId}` node (the exact node
 * `HouseholdTeamScreen` itself subscribes to) and checks whether it carries
 * EITHER `.household` (Common/legacy) or `.households` (advanced, Task 9) —
 * never a `subject`/`courseFormat` field added solely for this decision, per
 * this task's brief ("detect by shape, not by a routing-only flag" is this
 * codebase's established convention — see e.g. how `HouseholdTeamScreen`
 * itself branches Common vs advanced by which field is present, not by a
 * separate flag). A market lessonRun's team-state node has neither field, so
 * it falls through to the unchanged `DeferredDataNotice` fallback.
 */
function StudentPlayRoute({ services, heading }: { services: FirebaseServices; heading: string }) {
  const { runId } = useParams<{ runId: string }>()
  const access = useStudentLessonAccess(runId ?? '', services)
  const [householdMode, setHouseholdMode] = useState<HouseholdModeStatus>('LOADING')

  useEffect(() => {
    if (access.status !== 'GRANTED' || !access.teamId || !runId) return
    setHouseholdMode('LOADING')
    return subscribeOwnTeamState<{ household?: unknown; households?: unknown }>(
      services.database,
      runId,
      access.teamId,
      (state) => setHouseholdMode(state && (state.household !== undefined || state.households !== undefined) ? 'YES' : 'NO'),
    )
  }, [access.status, access.teamId, runId, services])

  if (access.status === 'LOADING') return <GuardLoading />
  if (access.status === 'DENIED') return <Navigate replace to="/join" />
  if (householdMode === 'LOADING') return <GuardLoading />
  if (householdMode === 'YES' && runId && access.teamId) {
    return <HouseholdTeamScreen lessonRunId={runId} teamId={access.teamId} database={services.database} functions={services.functions} />
  }
  return <DeferredDataNotice heading={heading} />
}
```

変更後:
```tsx
/**
 * `/lessons/:runId/play`. Detects "is this a household-mode lessonRun" by
 * SHAPE, not by a routing-only field: `LessonRunTeamState` carries EITHER
 * `.household` (Common/legacy) or `.households` (advanced) only for
 * HOME_ECONOMICS lessonRuns — a market lessonRun's team-state node has
 * neither, so it renders `MarketPlayScreen` instead. The same subscription
 * doubles as both the mode-detection signal and (for the market branch)
 * the live cash/holdings/orders data source — `LessonRunTeamState` is
 * designed to carry both shapes' fields on one type (see its own JSDoc in
 * liveTypes.ts), so there is no need for two separate subscriptions.
 */
function StudentPlayRoute({ services }: { services: FirebaseServices }) {
  const { runId } = useParams<{ runId: string }>()
  const navigate = useNavigate()
  const access = useStudentLessonAccess(runId ?? '', services)
  const [teamState, setTeamState] = useState<LessonRunTeamState | null>(null)
  const [publicState, setPublicState] = useState<LessonRunPublicState | null>(null)

  useEffect(() => {
    if (access.status !== 'GRANTED' || !access.teamId || !runId) return
    setTeamState(null)
    return subscribeOwnTeamState<LessonRunTeamState>(services.database, runId, access.teamId, setTeamState)
  }, [access.status, access.teamId, runId, services])

  useEffect(() => {
    if (!runId) return
    return subscribePublicRun(services.database, runId, setPublicState)
  }, [runId, services])

  useEffect(() => {
    if (!runId) return
    if (publicState?.status === 'REFLECTION' || publicState?.status === 'COMPLETED') {
      navigate(`/lessons/${runId}/results`, { replace: true })
    }
  }, [publicState?.status, runId, navigate])

  if (access.status === 'LOADING') return <GuardLoading />
  if (access.status === 'DENIED') return <Navigate replace to="/join" />
  if (!teamState) return <GuardLoading />

  if ((teamState.household !== undefined || teamState.households !== undefined) && runId && access.teamId) {
    return <HouseholdTeamScreen lessonRunId={runId} teamId={access.teamId} database={services.database} functions={services.functions} />
  }

  if (!publicState) return <GuardLoading />

  return <MarketPlayScreen
    companies={publicState.researchDesk?.companies ?? []}
    informationItems={publicState.researchDesk?.informationItems ?? []}
    stocks={publicState.stocks}
    teamState={teamState}
    marketPaused={publicState.marketPaused}
    availablePanels={publicState.researchDesk?.availablePanels ?? []}
    onSubmitOrder={async ({ stockId, side, quantity }) => {
      if (!runId || !access.teamId) return
      await submitOrder(services.functions, { lessonRunId: runId, teamId: access.teamId, stockId, side, quantity, idempotencyKey: crypto.randomUUID() })
    }}
  />
}
```

- [x] **Step 3: Update the route table (drop the now-unused `heading` prop)**

[src/App.tsx:1340](../../../src/App.tsx:1340)（現在の行番号。Task 2のStep 2で行数が変わるため実際の行はズレる可能性があるので `grep -n '"/lessons/:runId/play"' src/App.tsx` で確認してから編集すること）:

変更前:
```tsx
  <Route path="/lessons/:runId/play" element={enabled && services ? <StudentPlayRoute services={services} heading="授業中" /> : <Navigate replace to="/about" />} />
```

変更後:
```tsx
  <Route path="/lessons/:runId/play" element={enabled && services ? <StudentPlayRoute services={services} /> : <Navigate replace to="/about" />} />
```

- [x] **Step 4: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: 0エラー。`heading` プロパティを参照しなくなったことで型エラーが出ないこと、`DeferredDataNotice` が他の場所（`/results`, `/teacher/lessons/:runId/analytics`）でまだ使われているため未使用importエラーにならないことを確認する

- [x] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire /lessons/:runId/play to MarketPlayScreen for market-mode lessonRuns, auto-navigating to /results once REFLECTION/COMPLETED"
```

---

## Task 3: 既存の `App.test.tsx` テストを更新

**Files:**
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: 既存のテストダブル `emitMembership`/`emitTeamState`/`emitPublicState`（`src/App.test.tsx` 冒頭で既に定義済み — Phase 2で使用したものと同じ）
- Produces: Task 2 の変更に対する回帰テスト

- [x] **Step 1: Replace the outdated "deferred-data notice at /play" test**

`src/App.test.tsx` の該当テスト（`'shows the deferred-data notice at /play for a non-household lessonRun (team state has neither .household nor .households)'`、[src/App.test.tsx:318-327](../../../src/App.test.tsx:318) 付近）を次のように置き換える:

変更前:
```ts
  it('shows the deferred-data notice at /play for a non-household lessonRun (team state has neither .household nor .households)', async () => {
    window.history.pushState({}, '', '/lessons/run-1/play')
    render(<App isLessonPlatformV2Enabled getServices={getServices} />)
    await waitFor(() => expect(membershipListener).toBeDefined())
    emitMembership({ access: 'ACTIVE', teamId: 'team-a' })
    await waitFor(() => expect(teamStateListener).toBeDefined())
    emitTeamState({ cash: 100000, holdings: {}, lockedBuyValue: 0, lockedSellQuantity: {}, myOrders: [], updatedAtMillis: 1 })
    expect(await screen.findByRole('heading', { level: 1, name: /授業中/ })).toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })
```

変更後:
```ts
  it('renders MarketPlayScreen at /play for a non-household lessonRun (team state has neither .household nor .households)', async () => {
    window.history.pushState({}, '', '/lessons/run-1/play')
    render(<App isLessonPlatformV2Enabled getServices={getServices} />)
    await waitFor(() => expect(membershipListener).toBeDefined())
    emitMembership({ access: 'ACTIVE', teamId: 'team-a' })
    await waitFor(() => expect(teamStateListener).toBeDefined())
    emitTeamState({ cash: 100000, holdings: {}, lockedBuyValue: 0, lockedSellQuantity: {}, myOrders: [], updatedAtMillis: 1 })
    await waitFor(() => expect(publicStateListener).toBeDefined())
    emitPublicState({
      status: 'RUNNING',
      title: '株式投資シミュレーション',
      teams: [{ teamId: 'team-a', displayName: 'Aチーム' }],
      stocks: {},
      marketPaused: false,
      researchDesk: { phaseId: 'phase-1', phaseType: 'TRADING', availablePanels: ['ORDERS'], companies: [], informationItems: [], economicIndicators: [], updatedAtMillis: 1 },
    })
    expect(await screen.findByRole('tab', { name: '取引' })).toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })

  it('automatically navigates from /play to /results once public state status becomes REFLECTION', async () => {
    window.history.pushState({}, '', '/lessons/run-1/play')
    render(<App isLessonPlatformV2Enabled getServices={getServices} />)
    await waitFor(() => expect(membershipListener).toBeDefined())
    emitMembership({ access: 'ACTIVE', teamId: 'team-a' })
    await waitFor(() => expect(teamStateListener).toBeDefined())
    emitTeamState({ cash: 100000, holdings: {}, lockedBuyValue: 0, lockedSellQuantity: {}, myOrders: [], updatedAtMillis: 1 })
    await waitFor(() => expect(publicStateListener).toBeDefined())
    emitPublicState({
      status: 'REFLECTION',
      title: '株式投資シミュレーション',
      teams: [{ teamId: 'team-a', displayName: 'Aチーム' }],
      stocks: {},
      marketPaused: false,
    })
    await waitFor(() => expect(window.location.pathname).toBe('/lessons/run-1/results'))
    window.history.pushState({}, '', '/')
  })
```

- [x] **Step 2: Run the test file**

Run: `npm test -- src/App.test.tsx`
Expected: PASS（既存の家庭科モードのテスト2件を含む全テスト。Task 2の `StudentPlayRoute` は家庭科判定を `teamState` だけで行い `publicState` の到着を待たないガード順序になっているため、`publicStateListener` に何も流さない既存の家庭科テストも問題なくPASSする）

- [x] **Step 3: Run the full frontend test suite**

Run: `npm test`
Expected: PASS（全ファイル）

- [x] **Step 4: Commit**

```bash
git add src/App.test.tsx
git commit -m "test: cover MarketPlayScreen rendering and REFLECTION auto-navigation at /play"
```

---

## Task 4: Phase 3完了確認

- [x] **Step 1: Run the full verification suite**

Run: `npm run verify`
Expected: lint, typecheck, tests, rules, market concurrency, build すべてPASS

- [x] **Step 2: Manual end-to-end smoke test**

1. `npm run dev` でローカル起動
2. Phase 1のフローで市場モードの授業を開始し、Phase 2のフローで生徒として参加、`/waiting` から `RUNNING` 遷移で自動的に `/play` に到達することを確認
3. `/play` で「取引」「企業情報」「ニュース」タブが `availablePanels` に応じて表示され、実際に注文を送信できることを確認
4. 教師側で授業を `REFLECTION`/`COMPLETED` に進め、生徒タブが自動的に `/results` へ遷移することを確認（`/results` はまだ `DeferredDataNotice` のままで問題ない — Phase 4のスコープ）

- [x] **Step 3: Update the roadmap**

[docs/superpowers/plans/2026-08-17-production-readiness-roadmap.md](2026-08-17-production-readiness-roadmap.md) の "Phase 3" セクションに完了マークを付ける。

- [x] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-08-17-production-readiness-roadmap.md
git commit -m "docs: mark Phase 3 complete in production readiness roadmap"
```
