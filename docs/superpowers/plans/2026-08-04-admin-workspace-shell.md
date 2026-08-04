# 管理画面ワークスペース化・第1弾 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/teacher/markets` into a Slack-workspace-style market picker, add a market-scoped `AdminShell` sidebar (銘柄／進行／教室画面), and let a teacher pause a running market, edit its stocks, and resume — filling in the dormant `PAUSED` status that already exists in the types but is never reached today.

**Architecture:** Two new pure, unit-tested host actions (`pauseMarket`, `updateMarketCompanies`) land in `hostTrading.ts` alongside the existing transaction-style actions. A new `AdminShell` component (MUI `sx` only, no legacy CSS classes) replaces `TeacherShell` for market-scoped pages (`ControlRoom`, the new `MarketStocksPage`). `MarketDashboard.tsx` — which currently mixes the teacher dashboard and the student join form in one file — is split into `WorkspacePicker.tsx` (teacher) and `StudentMarketJoin.tsx` (student), both cleaned of legacy `className` styling.

**Tech Stack:** React 19, MUI v9, react-router v7, Firebase (Auth/Firestore/Realtime Database), Vitest + React Testing Library.

## Deviations from the design doc

- The design doc called for extracting a generic `SectionCard` pattern. This plan does not add one: within this sub-project's actual scope, the only card-like sections (`WorkspacePicker`'s "新しい授業を作る" panel) are single occurrences, and `TemplateWorkspace`'s existing `Paper variant="outlined"` convention already serves the same purpose without a new abstraction. Introduce `SectionCard` in a later sub-project if a second and third real usage appear.
- `ControlRoom`'s internal `AppBar` (brand link + "市場の管理へ" button) is removed, not just left alongside `AdminShell` — the sidebar's "別の市場を選ぶ" link and market title already cover the same job, and keeping both would be exactly the doubled chrome the "AI臭さ" complaint was about.

## Global Constraints

- Keep `/teacher/markets` and `/teacher/markets/:marketId/room` URLs stable — no redirects needed for this plan.
- All new/rewritten components use MUI `sx` styling only. Do not introduce new `className` hooks into legacy CSS (`App.css`/`index.css`).
- `TeacherShell.tsx` and `TemplateWorkspace.tsx` are out of scope except for the one dead-code removal called out in Task 9 (`SetupProgress`) — do not otherwise restyle `TemplateWorkspace`.
- Follow the existing test convention: presentational components with plain props get a `.test.tsx` (RTL, `render`/`screen`, `MemoryRouter` when the component uses `react-router` links); pure transaction-body functions in `hostTrading.ts`/`marketRepository.ts` get direct unit tests; Firebase-auth-gated container components (`ControlRoom`, and now `MarketStocksPage`, `WorkspacePicker`, `StudentMarketJoin`) do not get automated tests, matching `ControlRoom`'s existing (test-less) precedent — verify those manually via the dev server instead.
- Run `npm run lint && npm run typecheck && npm test` after every task; run the full `npm run verify` (adds rules tests + build) at the end of the plan.

---

## File Structure

| File | Change |
|---|---|
| `src/lib/market/hostTrading.ts` | Add `applyPauseMarket`/`pauseMarket`, `MarketCompanyDraft`, `validateMarketCompanies`, `applyUpdateMarketCompanies`/`updateMarketCompanies` |
| `src/lib/market/hostTrading.test.ts` | Add tests for the four new exports |
| `src/components/teacher/AdminShell.tsx` | **New.** Sidebar shell for market-scoped pages |
| `src/components/teacher/AdminShell.test.tsx` | **New** |
| `src/components/teacher/MarketControlPanel.tsx` | Add "市場を一時停止" action |
| `src/components/teacher/MarketControlPanel.test.tsx` | Add test for the new action |
| `src/components/teacher/ControlRoom.tsx` | Wire `onPauseMarket`; wrap the ready-state render in `AdminShell`; drop the internal `AppBar` (now redundant with the shell) |
| `src/components/teacher/PricePhaseEditor.tsx` | **New.** Shared price-phase editor extracted from `TemplateWorkspace` |
| `src/components/teacher/PricePhaseEditor.test.tsx` | **New** |
| `src/components/TemplateWorkspace.tsx` | Use `PricePhaseEditor` instead of its inline phase block |
| `src/components/teacher/MarketStocksPage.tsx` | **New.** 銘柄 editor page |
| `src/components/student/StudentMarketJoin.tsx` | **New.** Moved out of `MarketDashboard.tsx`, legacy CSS classes removed |
| `src/components/teacher/WorkspacePicker.tsx` | **New.** Moved out of `MarketDashboard.tsx`, restyled as a workspace picker |
| `src/components/MarketDashboard.tsx` | **Deleted** (fully replaced by the two files above) |
| `src/components/teacher/TeacherShell.tsx` | Remove the now-unused `SetupProgress` export |
| `src/App.tsx` | New `/teacher/markets/:marketId/stocks` route; `WorkspacePicker`/`StudentMarketJoin` imports; `RoomRoute` no longer wraps in `TeacherShell` |
| `src/App.css` | Remove CSS rules confirmed unreferenced after the above (Task 11) |

---

### Task 1: `pauseMarket` — manually pause a running market

**Files:**
- Modify: `src/lib/market/hostTrading.ts:38-53` (insert after `openMarket`)
- Test: `src/lib/market/hostTrading.test.ts`

**Interfaces:**
- Produces: `applyPauseMarket(raw: LiveMarketState | null, ownerUid: string, leaseId: string, atMillis: number): LiveMarketState | undefined`, `pauseMarket(database: Database, marketId: string, ownerUid: string, leaseId: string, atMillis?: number): Promise<boolean>`

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/market/hostTrading.test.ts`, replacing the import on line 2:

```ts
import { applyNewsImpact, applyPauseMarket, calculateOrderFill, priceAtRuntime, rankTeams, shouldPauseLease } from './hostTrading'
```

Append at the end of the file:

```ts
describe('manual market pause', () => {
  const openState = (): LiveMarketState => ({
    meta: { ownerUid: 'teacher', capacity: 80, visibility: 'private', status: 'OPEN', createdAtMillis: 1, startingCash: 10000, joinCode: 'ABC234', openedAtMillis: 5_000 },
    teams: {},
    hostLease: { ownerUid: 'teacher', leaseId: 'L1', expiresAtMillis: 100_000, paused: false },
  })

  it('moves an open market to PAUSED and stamps pausedAtMillis', () => {
    const next = applyPauseMarket(openState(), 'teacher', 'L1', 20_000)!
    expect(next.meta.status).toBe('PAUSED')
    expect(next.meta.pausedAtMillis).toBe(20_000)
  })

  it('refuses when the market is not OPEN', () => {
    const state = openState()
    state.meta.status = 'SETUP'
    expect(applyPauseMarket(state, 'teacher', 'L1', 20_000)).toBeUndefined()
  })

  it('refuses without a valid lease', () => {
    expect(applyPauseMarket(openState(), 'teacher', 'WRONG', 20_000)).toBeUndefined()
  })

  it('refuses for a different owner', () => {
    expect(applyPauseMarket(openState(), 'someone-else', 'L1', 20_000)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/market/hostTrading.test.ts`
Expected: FAIL — `applyPauseMarket` is not exported.

- [ ] **Step 3: Implement `applyPauseMarket` / `pauseMarket`**

In `src/lib/market/hostTrading.ts`, insert immediately after the `openMarket` function (which currently ends at line 53, just before the `requestMarketEnding` comment):

```ts
/** Manual pause: distinct from the disconnect-driven pause in pauseDisconnectedLease, which only
 * flags the lease. This flips meta.status itself, reusing the PAUSED state and resume path
 * openMarket already handles. */
export const applyPauseMarket = (raw: LiveMarketState | null, ownerUid: string, leaseId: string, atMillis: number): LiveMarketState | undefined => {
  if (!raw || !ownsLiveLease(raw, ownerUid, leaseId, atMillis) || raw.meta.status !== 'OPEN') return undefined
  raw.meta.status = 'PAUSED'
  raw.meta.pausedAtMillis = atMillis
  return raw
}

export const pauseMarket = async (database: Database, marketId: string, ownerUid: string, leaseId: string, atMillis = now()) =>
  (await runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => applyPauseMarket(raw, ownerUid, leaseId, atMillis))).committed
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/market/hostTrading.test.ts`
Expected: PASS (all tests in the file, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/market/hostTrading.ts src/lib/market/hostTrading.test.ts
git commit -m "feat: let a teacher manually pause a running market"
```

---

### Task 2: `updateMarketCompanies` — edit a market's stocks while SETUP/PAUSED

**Files:**
- Modify: `src/lib/market/hostTrading.ts` (top imports + insert after Task 1's block)
- Test: `src/lib/market/hostTrading.test.ts`

**Interfaces:**
- Consumes: `TEMPLATE_LIMITS` from `../templates/templateValidation`; `normalizePhases` from `../pricing/pricingCore`; `StockPricePhase` from `../pricing/types`
- Produces: `MarketCompanyDraft = { id: string; name: string; symbol: string; basePrice: number; phases?: StockPricePhase[] }`, `validateMarketCompanies(companies: MarketCompanyDraft[]): string[]`, `applyUpdateMarketCompanies(raw: LiveMarketState | null, ownerUid: string, atMillis: number, companies: MarketCompanyDraft[]): LiveMarketState | undefined`, `updateMarketCompanies(database: Database, marketId: string, ownerUid: string, companies: MarketCompanyDraft[], atMillis?: number): Promise<boolean>`

- [ ] **Step 1: Write the failing tests**

Update the import at the top of `src/lib/market/hostTrading.test.ts` (from Task 1's version):

```ts
import { applyNewsImpact, applyPauseMarket, applyUpdateMarketCompanies, calculateOrderFill, priceAtRuntime, rankTeams, shouldPauseLease, validateMarketCompanies } from './hostTrading'
```

Append at the end of the file:

```ts
describe('market company validation', () => {
  const companies = () => [{ id: 'acme', name: 'Acme', symbol: 'AC', basePrice: 100 }]

  it('accepts a well-formed company list', () => {
    expect(validateMarketCompanies(companies())).toEqual([])
  })

  it('requires at least one company', () => {
    expect(validateMarketCompanies([])).toEqual(['銘柄は1件以上必要です。'])
  })

  it('rejects duplicate symbols', () => {
    const list = [...companies(), { id: 'acme2', name: 'Acme 2', symbol: 'ac', basePrice: 200 }]
    expect(validateMarketCompanies(list)).toContain('銘柄コードは重複できません。')
  })

  it('rejects a non-positive base price', () => {
    expect(validateMarketCompanies([{ id: 'acme', name: 'Acme', symbol: 'AC', basePrice: 0 }])).toContain('基準価格は1〜1,000万円の整数で入力してください。')
  })
})

describe('market company edits', () => {
  const pausedState = (): LiveMarketState => ({
    meta: { ownerUid: 'teacher', capacity: 80, visibility: 'private', status: 'PAUSED', createdAtMillis: 1, startingCash: 10000, joinCode: 'ABC234' },
    teams: {},
    companies: { acme: { id: 'acme', name: 'Acme', symbol: 'AC', basePrice: 100 } },
  })

  it('overwrites the companies map while the market is paused', () => {
    const next = applyUpdateMarketCompanies(pausedState(), 'teacher', 30_000, [{ id: 'acme', name: 'Updated Co', symbol: 'up', basePrice: 250 }])!
    expect(next.companies!.acme).toEqual({ id: 'acme', name: 'Updated Co', symbol: 'UP', basePrice: 250 })
  })

  it('refuses while the market is open', () => {
    const state = pausedState()
    state.meta.status = 'OPEN'
    expect(applyUpdateMarketCompanies(state, 'teacher', 30_000, [{ id: 'acme', name: 'Acme', symbol: 'AC', basePrice: 100 }])).toBeUndefined()
  })

  it('refuses invalid company data even while paused', () => {
    expect(applyUpdateMarketCompanies(pausedState(), 'teacher', 30_000, [])).toBeUndefined()
  })

  it('refuses for a different owner', () => {
    expect(applyUpdateMarketCompanies(pausedState(), 'someone-else', 30_000, [{ id: 'acme', name: 'Acme', symbol: 'AC', basePrice: 100 }])).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/market/hostTrading.test.ts`
Expected: FAIL — `applyUpdateMarketCompanies`/`validateMarketCompanies` are not exported.

- [ ] **Step 3: Implement the validator and the transaction**

In `src/lib/market/hostTrading.ts`, update the two top import lines (currently lines 3-5):

```ts
import { clampToBounds, createPhaseRuntime, elapsedMarketMinute, getActivePhase, normalizePhases } from '../pricing/pricingCore'
import type { StockPricePhase } from '../pricing/types'
import { TEMPLATE_LIMITS } from '../templates/templateValidation'
```

Insert immediately after Task 1's `pauseMarket` function:

```ts
export type MarketCompanyDraft = { id: string; name: string; symbol: string; basePrice: number; phases?: StockPricePhase[] }

export const validateMarketCompanies = (companies: MarketCompanyDraft[]): string[] => {
  const errors: string[] = []
  if (!companies.length) errors.push('銘柄は1件以上必要です。')
  const symbols = companies.map((company) => company.symbol.trim().toUpperCase())
  if (new Set(symbols).size !== symbols.length) errors.push('銘柄コードは重複できません。')
  if (companies.some((company) => !company.name.trim() || company.name.trim().length > TEMPLATE_LIMITS.maxCompanyName)) errors.push('会社名は1〜80文字で入力してください。')
  if (companies.some((company) => !company.symbol.trim() || company.symbol.trim().length > TEMPLATE_LIMITS.maxSymbol)) errors.push('銘柄コードは1〜10文字で入力してください。')
  if (companies.some((company) => !Number.isInteger(company.basePrice) || company.basePrice < 1 || company.basePrice > TEMPLATE_LIMITS.maxPrice)) errors.push('基準価格は1〜1,000万円の整数で入力してください。')
  return errors
}

/** Editing is only safe while nothing else is writing prices: SETUP (never opened) or PAUSED
 * (manually stopped for exactly this). Unlike the trading-engine actions above, this does not
 * require a live host lease — it is a static config change, not a step in the tick loop, and the
 * top-level liveMarkets .write rule already restricts any write here to the market's owner. */
export const applyUpdateMarketCompanies = (raw: LiveMarketState | null, ownerUid: string, atMillis: number, companies: MarketCompanyDraft[]): LiveMarketState | undefined => {
  if (!raw || raw.meta.ownerUid !== ownerUid || (raw.meta.status !== 'SETUP' && raw.meta.status !== 'PAUSED')) return undefined
  if (validateMarketCompanies(companies).length) return undefined
  raw.companies = Object.fromEntries(companies.map((company) => [company.id, {
    id: company.id,
    name: company.name.trim(),
    symbol: company.symbol.trim().toUpperCase(),
    basePrice: Math.round(company.basePrice),
    ...(company.phases ? { phases: normalizePhases(company.phases) } : {}),
  }]))
  return raw
}

export const updateMarketCompanies = async (database: Database, marketId: string, ownerUid: string, companies: MarketCompanyDraft[], atMillis = now()) =>
  (await runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => applyUpdateMarketCompanies(raw, ownerUid, atMillis, companies))).committed
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/market/hostTrading.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Run the typechecker** (new cross-file import)

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/market/hostTrading.ts src/lib/market/hostTrading.test.ts
git commit -m "feat: let a teacher edit a market's stocks while it is paused"
```

---

### Task 3: `AdminShell` — sidebar shell for market-scoped pages

**Files:**
- Create: `src/components/teacher/AdminShell.tsx`
- Test: `src/components/teacher/AdminShell.test.tsx`

**Interfaces:**
- Consumes: `MarketStatus` from `../../lib/market/liveMarketTypes`, `MARKET_STATUS_LABEL` from `../../lib/market/marketStatusLabels`
- Produces: `AdminShell({ active: 'stocks' | 'room', children: ReactNode, marketId: string, marketTitle?: string, marketStatus?: MarketStatus })`

- [ ] **Step 1: Write the failing test**

Create `src/components/teacher/AdminShell.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AdminShell } from './AdminShell'

const renderShell = (active: 'stocks' | 'room' = 'room') => render(
  <MemoryRouter>
    <AdminShell active={active} marketId="market-123" marketTitle="1組の市場" marketStatus="OPEN"><main>内容</main></AdminShell>
  </MemoryRouter>,
)

describe('AdminShell navigation', () => {
  it('links to the stocks page, control room and classroom screen for this market', () => {
    renderShell()
    expect(screen.getByRole('link', { name: /銘柄/ })).toHaveAttribute('href', '/teacher/markets/market-123/stocks')
    expect(screen.getByRole('link', { name: /進行/ })).toHaveAttribute('href', '/teacher/markets/market-123/room')
    const signage = screen.getByRole('link', { name: /教室画面/ })
    expect(signage).toHaveAttribute('href', '/markets/market-123/signage')
    expect(signage).toHaveAttribute('target', '_blank')
  })

  it('links back to the workspace picker', () => {
    renderShell()
    expect(screen.getByRole('link', { name: '別の市場を選ぶ' })).toHaveAttribute('href', '/teacher/markets')
  })

  it('shows the market title and status', () => {
    renderShell()
    expect(screen.getByText('1組の市場')).toBeInTheDocument()
    expect(screen.getByText('取引中')).toBeInTheDocument()
  })

  it('renders the page content', () => {
    renderShell()
    expect(screen.getByText('内容')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/teacher/AdminShell.test.tsx`
Expected: FAIL — `src/components/teacher/AdminShell.tsx` does not exist.

- [ ] **Step 3: Implement `AdminShell`**

Create `src/components/teacher/AdminShell.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Box, ButtonBase, Chip, Divider, ListItemButton, ListItemIcon, ListItemText, Paper, Stack, Typography } from '@mui/material'
import { NavLink, Link as RouterLink } from 'react-router'
import type { MarketStatus } from '../../lib/market/liveMarketTypes'
import { MARKET_STATUS_LABEL } from '../../lib/market/marketStatusLabels'

type AdminArea = 'stocks' | 'room'
type AdminIcon = 'stocks' | 'room' | 'screen' | 'switch'

interface AdminShellProps {
  active: AdminArea
  children: ReactNode
  marketId: string
  marketTitle?: string
  marketStatus?: MarketStatus
}

const Icon = ({ name }: { name: AdminIcon }) => {
  const paths = {
    stocks: <><path d="M4 19V9m5 10V5m5 14v-7m5 7V3" /><path d="M2 19h20" /></>,
    room: <><path d="M4 6h16v11H4z" /><path d="M8 21h8M12 17v4" /><path d="m8 12 2.5-2.5L13 12l3-3" /></>,
    screen: <><rect x="3" y="5" width="18" height="13" rx="2" /><path d="M8 21h8M12 18v3" /></>,
    switch: <><path d="M7 16l-4-4 4-4M3 12h18" /></>,
  }
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

const STATUS_COLOR: Record<MarketStatus, 'default' | 'success' | 'warning'> = { SETUP: 'default', OPEN: 'success', PAUSED: 'warning', ENDING: 'warning', ENDED: 'default' }

export const AdminShell = ({ active, children, marketId, marketTitle, marketStatus }: AdminShellProps) => {
  const itemSx = { minHeight: 44, px: 1.5, borderRadius: 2.5, gap: 1.5, color: 'text.secondary', flex: { xs: '1 1 auto', md: 'initial' }, '&.active, &.Mui-selected': { color: 'primary.dark', bgcolor: 'primary.light' }, '&:hover': { bgcolor: 'action.hover', color: 'text.primary' } }
  const iconSx = { minWidth: 0, color: 'inherit', '& svg': { width: 20, height: 20 } }
  const item = (label: string, icon: AdminIcon) => <><ListItemIcon sx={iconSx}><Icon name={icon} /></ListItemIcon><ListItemText primary={label} slotProps={{ primary: { sx: { fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' } } }} /></>
  return <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: { xs: 'column', md: 'row' } }}>
    <Paper component="aside" square elevation={0} sx={{ width: { md: 260 }, flexShrink: 0, p: 2, display: 'flex', flexDirection: { xs: 'row', md: 'column' }, flexWrap: 'wrap', alignItems: { xs: 'center', md: 'stretch' }, gap: 1, borderRight: { md: 1 }, borderBottom: { xs: 1, md: 0 }, borderColor: 'divider', position: { md: 'sticky' }, top: 0, height: { md: '100dvh' } }}>
      <Stack spacing={1.5} sx={{ width: '100%', display: { xs: 'none', md: 'flex' } }}>
        <ButtonBase component={RouterLink} to="/teacher/markets" sx={{ justifyContent: 'flex-start', gap: 1, borderRadius: 2, p: 1, color: 'text.secondary' }}>
          <Icon name="switch" /><Typography variant="body2" sx={{ fontWeight: 700 }}>別の市場を選ぶ</Typography>
        </ButtonBase>
        <Box sx={{ px: 1 }}>
          <Typography variant="subtitle2" noWrap>{marketTitle ?? '市場'}</Typography>
          {marketStatus && <Chip size="small" color={STATUS_COLOR[marketStatus]} label={MARKET_STATUS_LABEL[marketStatus]} sx={{ mt: 0.5 }} />}
        </Box>
        <Divider />
      </Stack>
      <Box component="nav" aria-label="市場メニュー" sx={{ display: 'flex', flexDirection: { xs: 'row', md: 'column' }, gap: 0.5, flexWrap: 'wrap', width: '100%' }}>
        <Typography variant="caption" sx={{ display: { xs: 'none', md: 'block' }, px: 1.5, color: 'text.secondary', fontWeight: 700, letterSpacing: '.02em' }}>市場設定</Typography>
        <ListItemButton component={NavLink} to={`/teacher/markets/${marketId}/stocks`} selected={active === 'stocks'} sx={itemSx}>{item('銘柄', 'stocks')}</ListItemButton>
        <Typography variant="caption" sx={{ display: { xs: 'none', md: 'block' }, px: 1.5, mt: 1, color: 'text.secondary', fontWeight: 700, letterSpacing: '.02em' }}>この市場を進行する</Typography>
        <ListItemButton component={NavLink} to={`/teacher/markets/${marketId}/room`} selected={active === 'room'} sx={itemSx}>{item('進行', 'room')}</ListItemButton>
        <ListItemButton component="a" href={`/markets/${marketId}/signage`} target="_blank" rel="noopener" sx={itemSx}>{item('教室画面', 'screen')}</ListItemButton>
      </Box>
      <Stack sx={{ display: { xs: 'none', md: 'flex' }, mt: 'auto', width: '100%' }} spacing={0.5}>
        <Divider sx={{ mb: 1 }} />
        <ListItemButton component={RouterLink} to="/guide" sx={itemSx}><ListItemText primary="使い方を見る" slotProps={{ primary: { sx: { fontSize: 13, fontWeight: 700 } } }} /></ListItemButton>
      </Stack>
    </Paper>
    <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
  </Box>
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/teacher/AdminShell.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/teacher/AdminShell.tsx src/components/teacher/AdminShell.test.tsx
git commit -m "feat: add AdminShell, the sidebar for market-scoped pages"
```

---

### Task 4: `MarketControlPanel` — add the "市場を一時停止" action

**Files:**
- Modify: `src/components/teacher/MarketControlPanel.tsx`
- Test: `src/components/teacher/MarketControlPanel.test.tsx`

**Interfaces:**
- Produces: `MarketControlPanelProps` gains `onPauseMarket: () => void`

- [ ] **Step 1: Write the failing test**

In `src/components/teacher/MarketControlPanel.test.tsx`, add `onPauseMarket: vi.fn()` to `baseProps` (after `onTakeLease: vi.fn(),`):

```ts
const baseProps = {
  lease: '',
  marketStatus: 'SETUP' as const,
  endingConfirm: false,
  ending: false,
  onTakeLease: vi.fn(),
  onPauseMarket: vi.fn(),
  onOpenMarket: vi.fn(),
  onRequestEnd: vi.fn(),
  onCancelEnd: vi.fn(),
  onConfirmEnd: vi.fn(),
}
```

Add a new test inside `describe('MarketControlPanel', ...)`, after the `'offers to end an open market...'` test:

```ts
  it('offers to pause an open market', async () => {
    const onPauseMarket = vi.fn()
    render(<MarketControlPanel {...baseProps} lease="lease-1" marketStatus="OPEN" onPauseMarket={onPauseMarket} />)
    await userEvent.click(screen.getByRole('button', { name: '市場を一時停止' }))
    expect(onPauseMarket).toHaveBeenCalled()
  })

  it('does not offer to pause once the market is already paused', () => {
    render(<MarketControlPanel {...baseProps} lease="lease-1" marketStatus="PAUSED" />)
    expect(screen.queryByRole('button', { name: '市場を一時停止' })).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/teacher/MarketControlPanel.test.tsx`
Expected: FAIL — `MarketControlPanel` does not accept `onPauseMarket`, and the button does not exist.

- [ ] **Step 3: Implement the button**

In `src/components/teacher/MarketControlPanel.tsx`, update the props interface (add after `onTakeLease: () => void`):

```ts
export interface MarketControlPanelProps {
  lease: string
  marketStatus: MarketStatus
  endingConfirm: boolean
  ending: boolean
  onTakeLease: () => void
  onPauseMarket: () => void
  onOpenMarket: () => void
  onRequestEnd: () => void
  onCancelEnd: () => void
  onConfirmEnd: () => void
}
```

Update the function signature and body:

```tsx
export function MarketControlPanel({ lease, marketStatus, endingConfirm, ending, onTakeLease, onPauseMarket, onOpenMarket, onRequestEnd, onCancelEnd, onConfirmEnd }: MarketControlPanelProps) {
  const canStart = marketStatus === 'SETUP'
  const canResume = marketStatus === 'PAUSED' || marketStatus === 'ENDING' || marketStatus === 'ENDED'
  const isPaused = marketStatus === 'PAUSED'
  return (
    <Card component="section">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="overline" color="text.secondary">MARKET CONTROL</Typography>
          <Typography component="h2" variant="h4">{lease ? '市場を進行できます' : marketStatus === 'ENDED' ? '市場は終了しています' : isPaused ? '市場は一時停止中です' : 'この端末で市場を管理する'}</Typography>
          <Typography color="text.secondary">{lease ? '市場の開始・終了やニュース配信を行えます。終了後も必要なら市場を再開できます。' : isPaused ? 'ホストを取得すると、市場を再開できます。一時停止中は「銘柄」メニューから内容を編集できます。' : canResume ? 'ホストを取得すると、市場を再開できます。チームの資産と取引履歴は保持されています。' : '最初にホスト権限を取得してください。ほかの端末が操作中の場合は取得できません。'}</Typography>
          <Divider />
          {!lease
            ? <Button variant="contained" sx={{ alignSelf: 'flex-start' }} onClick={onTakeLease}>ホストを取得する</Button>
            : <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' }, flexWrap: 'wrap' }}>
                {(canStart || canResume) && <Button variant="contained" onClick={onOpenMarket}>{canResume ? '市場を再開' : '市場を開始'}</Button>}
                {marketStatus === 'OPEN' && !endingConfirm && <Button variant="outlined" onClick={onPauseMarket}>市場を一時停止</Button>}
                {marketStatus === 'OPEN' && (!endingConfirm
                  ? <Button variant="outlined" color="error" onClick={onRequestEnd}>市場を終了</Button>
                  : <Paper variant="outlined" sx={{ p: 2, width: '100%' }}>
                      <Stack spacing={1.5}>
                        <Typography><Box component="strong">市場を終了すると、結果を確定します。</Box> 生徒は売買できなくなりますが、あとで市場を再開できます。</Typography>
                        <Stack direction="row" spacing={1}>
                          <Button color="error" variant="contained" disabled={ending} onClick={onConfirmEnd}>{ending ? '処理中…' : '終了して結果を確定する'}</Button>
                          <Button variant="outlined" disabled={ending} onClick={onCancelEnd}>やめる</Button>
                        </Stack>
                      </Stack>
                    </Paper>)}
              </Stack>}
        </Stack>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/teacher/MarketControlPanel.test.tsx`
Expected: PASS (all tests, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/components/teacher/MarketControlPanel.tsx src/components/teacher/MarketControlPanel.test.tsx
git commit -m "feat: add a manual pause action to the market control panel"
```

---

### Task 5: Wire pause into `ControlRoom`, switch it to `AdminShell`

**Files:**
- Modify: `src/components/teacher/ControlRoom.tsx`

**Interfaces:**
- Consumes: `pauseMarket` from `../../lib/market/hostTrading` (Task 1), `AdminShell` from `./AdminShell` (Task 3), `MarketControlPanelProps.onPauseMarket` (Task 4)

No new automated test for this file — it has none today (Firebase-auth-gated container, per the Global Constraints convention). Verify manually in Task 12.

- [ ] **Step 1: Add the `pauseMarket` import and `AdminShell` import**

In `src/components/teacher/ControlRoom.tsx`, update the import block (currently lines 1-23):

```ts
import { acquireHostLease, armHostLeaseDisconnect, openMarket, pauseMarket, publishManualNews, requestMarketEnding, runHostTick } from '../../lib/market/hostTrading'
```

(replaces the existing line that imports `acquireHostLease, armHostLeaseDisconnect, openMarket, publishManualNews, requestMarketEnding, runHostTick`)

Add, near the other local imports:

```ts
import { AdminShell } from './AdminShell'
```

- [ ] **Step 2: Remove the internal `AppBar` and wrap the ready-state render in `AdminShell`**

Replace the final `return` block of `ControlRoom` — currently:

```tsx
  return <Box component="main" className="host-page" sx={{ pb: 6 }}>
    <AppBar component="header" position="static" color="transparent" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
      <Toolbar component={Container} maxWidth="xl" disableGutters sx={{ gap: 2, px: { xs: 2, sm: 3 } }}>
        <Link href="/teacher/markets" color="inherit" underline="none" variant="h6" sx={{ flexGrow: 1 }}>Stock League Classroom</Link>
        <Button href="/teacher/markets" variant="text">市場の管理へ</Button><AppVersion />
      </Toolbar>
    </AppBar>
    <Container maxWidth="xl" sx={{ pt: { xs: 4, md: 6 } }}>
```

with:

```tsx
  return <AdminShell active="room" marketId={marketId} marketTitle={template?.title} marketStatus={marketStatus}>
    <Container maxWidth="xl" sx={{ py: { xs: 4, md: 6 } }}>
```

And change the closing tags at the very end of the component — currently:

```tsx
      </Stack>
    </Container>
  </Box>
}
```

to:

```tsx
      </Stack>
    </Container>
  </AdminShell>
}
```

- [ ] **Step 3: Remove the now-unused `AppBar`/`Toolbar`/`Link`/`AppVersion` imports**

`AppVersion` is only used in the removed header; `AppBar`, `Toolbar`, and `Link` are only used there too. In the MUI import list near the top of the file, remove `AppBar` and `Toolbar` from the destructured import, and remove `Link` if it is not used elsewhere in the file (check with `grep -n "Link" src/components/teacher/ControlRoom.tsx` — it is only used in the header being removed and in the `!user` early-return branch's `<Link href="/teacher/markets" ...>← Stock League Classroom</Link>`-style usage; keep `Link` since that branch still uses it, only drop `AppBar`/`Toolbar`). Remove the `import { AppVersion } from '../AppVersion'` line entirely (no remaining usage).

- [ ] **Step 4: Wire the pause button**

Inside the `activeTab === 'control'` block, find the `<MarketControlPanel ... />` call and add the `onPauseMarket` prop (alongside the existing `onTakeLease`/`onOpenMarket`/etc. props):

```tsx
                onPauseMarket={() => void pauseMarket(services.database, marketId, user.uid, lease).then((ok) => setNotice(ok ? '市場を一時停止しました。「銘柄」メニューから内容を編集できます。' : '一時停止できませんでした。')).catch((error) => setNotice(handleFailure(error, '一時停止できませんでした。')))}
```

- [ ] **Step 5: Run lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: no errors, no unused-import warnings.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS (no test exercises `ControlRoom` directly, so this mainly confirms nothing else broke).

- [ ] **Step 7: Commit**

```bash
git add src/components/teacher/ControlRoom.tsx
git commit -m "feat: wire manual pause into the control room and switch it to AdminShell"
```

---

### Task 6: Extract `PricePhaseEditor` and use it in `TemplateWorkspace`

**Files:**
- Create: `src/components/teacher/PricePhaseEditor.tsx`
- Test: `src/components/teacher/PricePhaseEditor.test.tsx`
- Modify: `src/components/TemplateWorkspace.tsx`

**Interfaces:**
- Consumes: `StockPricePhase` from `../../lib/pricing/types`
- Produces: `PricePhaseEditor({ phases: StockPricePhase[], disabled?: boolean, onAddPhase: () => void, onUpdatePhase: (index: number, patch: Partial<StockPricePhase>) => void, onRemovePhase: (index: number) => void })`

- [ ] **Step 1: Write the failing test**

Create `src/components/teacher/PricePhaseEditor.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PricePhaseEditor } from './PricePhaseEditor'

const phases = [{ id: 'p1', startMinute: 0, endMinute: 30, direction: 'UP' as const, changePercent: 5 }]

describe('PricePhaseEditor', () => {
  it('renders one row per phase and calls onAddPhase', async () => {
    const onAddPhase = vi.fn()
    render(<PricePhaseEditor phases={phases} onAddPhase={onAddPhase} onUpdatePhase={vi.fn()} onRemovePhase={vi.fn()} />)
    expect(screen.getByDisplayValue('0')).toBeInTheDocument()
    expect(screen.getByDisplayValue('30')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'フェーズを追加' }))
    expect(onAddPhase).toHaveBeenCalled()
  })

  it('reports the changed field on update', async () => {
    const onUpdatePhase = vi.fn()
    render(<PricePhaseEditor phases={phases} onAddPhase={vi.fn()} onUpdatePhase={onUpdatePhase} onRemovePhase={vi.fn()} />)
    const endField = screen.getByDisplayValue('30')
    await userEvent.clear(endField)
    await userEvent.type(endField, '45')
    expect(onUpdatePhase).toHaveBeenLastCalledWith(0, { endMinute: 45 })
  })

  it('disables every field and hides add/remove when disabled', () => {
    render(<PricePhaseEditor phases={phases} disabled onAddPhase={vi.fn()} onUpdatePhase={vi.fn()} onRemovePhase={vi.fn()} />)
    expect(screen.getByDisplayValue('0')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'フェーズを追加' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/teacher/PricePhaseEditor.test.tsx`
Expected: FAIL — the file does not exist.

- [ ] **Step 3: Implement `PricePhaseEditor`**

Create `src/components/teacher/PricePhaseEditor.tsx`:

```tsx
import { Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import type { StockPricePhase } from '../../lib/pricing/types'

export interface PricePhaseEditorProps {
  phases: StockPricePhase[]
  disabled?: boolean
  onAddPhase: () => void
  onUpdatePhase: (index: number, patch: Partial<StockPricePhase>) => void
  onRemovePhase: (index: number) => void
}

const editorFieldSx = { '& .MuiInputBase-root': { bgcolor: 'background.paper' } }
const PhaseNumberField = ({ label, value, min, max, disabled, onChange }: { label: string; value: number; min: number; max: number; disabled?: boolean; onChange: (value: number) => void }) =>
  <TextField sx={editorFieldSx} label={label} type="number" disabled={disabled} slotProps={{ htmlInput: { min, max } }} value={value} onChange={(event) => onChange(Number(event.target.value))} />

export const PricePhaseEditor = ({ phases, disabled, onAddPhase, onUpdatePhase, onRemovePhase }: PricePhaseEditorProps) => <Stack spacing={1.5}>
  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
    <Stack>
      <Typography component="h3" variant="subtitle1">価格フェーズ</Typography>
      <Typography variant="body2" color="text.secondary">開始から何分後に、何%動くかを設定します。</Typography>
    </Stack>
    {!disabled && <Button variant="outlined" size="small" onClick={onAddPhase}>フェーズを追加</Button>}
  </Stack>
  {phases.map((phase, index) => <Paper key={phase.id} variant="outlined" sx={{ p: 2 }}>
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' }, flexWrap: 'wrap' }}>
      <PhaseNumberField label="開始（分）" min={0} max={59} disabled={disabled} value={phase.startMinute} onChange={(value) => onUpdatePhase(index, { startMinute: value })} />
      <PhaseNumberField label="終了（分）" min={1} max={60} disabled={disabled} value={phase.endMinute} onChange={(value) => onUpdatePhase(index, { endMinute: value })} />
      <TextField select sx={{ ...editorFieldSx, minWidth: 130 }} label="方向" disabled={disabled} value={phase.direction} onChange={(event) => onUpdatePhase(index, { direction: event.target.value as StockPricePhase['direction'] })}>
        <MenuItem value="UP">上昇</MenuItem><MenuItem value="DOWN">下落</MenuItem><MenuItem value="FLAT">横ばい</MenuItem>
      </TextField>
      <PhaseNumberField label="変化率（%）" min={0} max={99} disabled={disabled} value={phase.changePercent} onChange={(value) => onUpdatePhase(index, { changePercent: value })} />
      {!disabled && <Button color="error" variant="text" disabled={phases.length <= 1} onClick={() => onRemovePhase(index)}>削除</Button>}
    </Stack>
  </Paper>)}
</Stack>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/teacher/PricePhaseEditor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Use `PricePhaseEditor` in `TemplateWorkspace`**

In `src/components/TemplateWorkspace.tsx`, add the import:

```ts
import { PricePhaseEditor } from './teacher/PricePhaseEditor'
```

Locate the price-phase block inside the `editorStep === 2` company card (the section starting `<Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}><Box><Typography component="h5" variant="subtitle1">価格フェーズ</Typography>...` and ending after the `.map` over `company.pricePhases` closes its `</Stack>`, i.e. everything between `<Divider />` and the company card's closing `</Stack></CardContent></Card>`). Replace that whole block with:

```tsx
<Divider /><PricePhaseEditor
  phases={company.pricePhases ?? []}
  onAddPhase={() => updateCompany(companyIndex, { pricePhases: [...(company.pricePhases ?? []), { id: newId('phase'), startMinute: 0, endMinute: 60, direction: 'FLAT', changePercent: 0 }] })}
  onUpdatePhase={(phaseIndex, patch) => updateCompany(companyIndex, { pricePhases: company.pricePhases?.map((item, itemIndex) => itemIndex === phaseIndex ? { ...item, ...patch } : item) })}
  onRemovePhase={(phaseIndex) => updateCompany(companyIndex, { pricePhases: company.pricePhases?.filter((_, itemIndex) => itemIndex !== phaseIndex) })}
/>
```

- [ ] **Step 6: Run the existing template tests**

Run: `npm test -- --run` (or `npx vitest run`)
Expected: PASS — no existing test file covers `TemplateWorkspace` directly (confirm with `ls src/components/TemplateWorkspace.test.tsx 2>/dev/null`; if it does not exist, this step only needs to confirm the rest of the suite still passes).

- [ ] **Step 7: Run lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/teacher/PricePhaseEditor.tsx src/components/teacher/PricePhaseEditor.test.tsx src/components/TemplateWorkspace.tsx
git commit -m "refactor: extract PricePhaseEditor and share it with TemplateWorkspace"
```

---

### Task 7: `MarketStocksPage` — the 銘柄 editor page

**Files:**
- Create: `src/components/teacher/MarketStocksPage.tsx`

**Interfaces:**
- Consumes: `AdminShell` (Task 3), `PricePhaseEditor` (Task 6), `updateMarketCompanies`/`validateMarketCompanies`/`MarketCompanyDraft` from `../../lib/market/hostTrading` (Task 2), `AuthLoadingScreen` from `./TeacherShell`, `TEMPLATE_LIMITS` from `../../lib/templates/templateValidation`
- Produces: `MarketStocksPage({ marketId: string })`

No automated test for this file (Firebase-auth-gated container, matching `ControlRoom`'s precedent). Verify manually in Task 12.

- [ ] **Step 1: Implement `MarketStocksPage`**

Create `src/components/teacher/MarketStocksPage.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { onValue, ref } from 'firebase/database'
import { Alert, Box, Button, Card, CardContent, Container, Divider, Stack, TextField, Typography } from '@mui/material'
import { bootstrapFirebase } from '../../lib/firebase/bootstrap'
import { isTeacherIdentity } from '../../lib/auth/roles'
import { updateMarketCompanies, validateMarketCompanies, type MarketCompanyDraft } from '../../lib/market/hostTrading'
import type { LiveMarketState, MarketStatus } from '../../lib/market/liveMarketTypes'
import type { TemplateSpec } from '../../lib/templates/types'
import { TEMPLATE_LIMITS } from '../../lib/templates/templateValidation'
import { handleFailure } from '../../lib/monitoring/describeError'
import { AdminShell } from './AdminShell'
import { AuthLoadingScreen } from './TeacherShell'
import { PricePhaseEditor } from './PricePhaseEditor'

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`
type Access = 'loading' | 'ready' | 'not-found' | 'forbidden' | 'read-error'

const AccessState = ({ state }: { state: Exclude<Access, 'ready'> }) => {
  const content = state === 'loading'
    ? { title: '市場を確認しています', detail: '市場の設定とアクセス権を読み込んでいます。' }
    : state === 'not-found'
      ? { title: 'この市場は見つかりません', detail: '削除されたか、URLが正しくない可能性があります。' }
      : state === 'forbidden'
        ? { title: 'この市場を編集する権限がありません', detail: '市場を作成した教師アカウントでログインしているか確認してください。' }
        : { title: '市場を読み込めません', detail: '通信状態を確認してから、もう一度お試しください。' }
  return <Container component="main" maxWidth="md" sx={{ py: 8 }}><Stack spacing={2} sx={{ alignItems: 'flex-start', maxWidth: 520 }}>
    <Typography component="h1" variant="h2">{content.title}</Typography>
    <Typography color="text.secondary">{content.detail}</Typography>
    <Button variant="contained" href="/teacher/markets">市場の管理へ戻る</Button>
  </Stack></Container>
}

export const MarketStocksPage = ({ marketId }: { marketId: string }) => {
  const services = bootstrapFirebase()
  const [user, setUser] = useState<User | null>(services.auth.currentUser)
  const [authReady, setAuthReady] = useState(false)
  const [access, setAccess] = useState<Access>('loading')
  const [title, setTitle] = useState('')
  const [status, setStatus] = useState<MarketStatus>('SETUP')
  const [draft, setDraft] = useState<MarketCompanyDraft[]>([])
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => onAuthStateChanged(services.auth, (next) => { setUser(next); setAuthReady(true) }), [services.auth])

  useEffect(() => {
    if (!authReady || !user || !isTeacherIdentity(user)) return
    let active = true
    setAccess('loading')
    void getDoc(doc(services.firestore, 'markets', marketId)).then((snapshot) => {
      if (!active) return
      if (!snapshot.exists()) { setAccess('not-found'); return }
      const template = snapshot.data()?.templateSnapshot as TemplateSpec | undefined
      setTitle(template?.title ?? '')
      setAccess('ready')
    }).catch((error: unknown) => {
      if (!active) return
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      setAccess(code.includes('permission-denied') ? 'forbidden' : 'read-error')
    })
    return () => { active = false }
  }, [authReady, marketId, services.firestore, user])

  useEffect(() => {
    if (!authReady || !user || !isTeacherIdentity(user) || access !== 'ready') return
    return onValue(ref(services.database, `liveMarkets/${marketId}`), (snapshot) => {
      const value = snapshot.val() as LiveMarketState | null
      if (!value) { setAccess('read-error'); return }
      setStatus(value.meta.status)
      setDraft(Object.values(value.companies ?? {}).map((company) => ({ id: company.id, name: company.name, symbol: company.symbol, basePrice: company.basePrice, phases: company.phases })))
    }, (error) => {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      setAccess(code.includes('permission-denied') ? 'forbidden' : 'read-error')
    })
  }, [access, authReady, marketId, services.database, user])

  if (!authReady) return <AuthLoadingScreen />
  if (!user || !isTeacherIdentity(user)) return <Container component="main" maxWidth="md" sx={{ py: 8 }}><Stack spacing={3} sx={{ alignItems: 'flex-start', maxWidth: 600 }}><Typography component="h1" variant="h2">銘柄を編集する</Typography><Typography color="text.secondary">市場の銘柄を編集するには教師としてログインしてください。</Typography><Button variant="contained" href="/teacher/markets">教師としてログイン</Button></Stack></Container>
  if (access !== 'ready') return <AccessState state={access} />

  const editable = status === 'SETUP' || status === 'PAUSED'
  const updateCompany = (index: number, patch: Partial<MarketCompanyDraft>) => setDraft((current) => current.map((company, companyIndex) => companyIndex === index ? { ...company, ...patch } : company))

  const save = async () => {
    const errors = validateMarketCompanies(draft)
    if (errors.length) return setNotice(errors[0])
    setSaving(true)
    try {
      const ok = await updateMarketCompanies(services.database, marketId, user.uid, draft)
      setNotice(ok ? '銘柄を保存しました。' : '保存できませんでした。市場が一時停止中か確認してください。')
    } catch (error) {
      setNotice(handleFailure(error, '保存できませんでした。'))
    } finally {
      setSaving(false)
    }
  }

  return <AdminShell active="stocks" marketId={marketId} marketTitle={title} marketStatus={status}>
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="overline" color="text.secondary">STOCKS</Typography>
          <Typography component="h1" variant="h2">銘柄を編集する</Typography>
          <Typography color="text.secondary">会社情報と、授業時間内の価格変化を設定します。</Typography>
        </Box>
        {!editable && <Alert severity="info" action={<Button color="inherit" size="small" href={`/teacher/markets/${marketId}/room`}>進行画面を開く</Button>}>編集するには、進行画面で市場を一時停止してください。</Alert>}
        {notice && <Alert severity={notice.includes('できません') ? 'error' : 'success'} role="status">{notice}</Alert>}
        <Stack spacing={2}>
          {draft.map((company, companyIndex) => <Card key={company.id} variant="outlined"><CardContent><Stack spacing={2}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField fullWidth label="会社名" disabled={!editable} slotProps={{ htmlInput: { maxLength: TEMPLATE_LIMITS.maxCompanyName } }} value={company.name} onChange={(event) => updateCompany(companyIndex, { name: event.target.value })} />
              <TextField fullWidth label="銘柄コード" disabled={!editable} slotProps={{ htmlInput: { maxLength: TEMPLATE_LIMITS.maxSymbol } }} value={company.symbol} onChange={(event) => updateCompany(companyIndex, { symbol: event.target.value.toUpperCase() })} />
              <TextField fullWidth type="number" label="基準価格（円）" disabled={!editable} slotProps={{ htmlInput: { min: 1, max: TEMPLATE_LIMITS.maxPrice } }} value={company.basePrice} onChange={(event) => updateCompany(companyIndex, { basePrice: Number(event.target.value) })} />
            </Stack>
            <Divider />
            <PricePhaseEditor
              phases={company.phases ?? []}
              disabled={!editable}
              onAddPhase={() => updateCompany(companyIndex, { phases: [...(company.phases ?? []), { id: newId('phase'), startMinute: 0, endMinute: 60, direction: 'FLAT', changePercent: 0 }] })}
              onUpdatePhase={(phaseIndex, patch) => updateCompany(companyIndex, { phases: company.phases?.map((phase, index) => index === phaseIndex ? { ...phase, ...patch } : phase) })}
              onRemovePhase={(phaseIndex) => updateCompany(companyIndex, { phases: company.phases?.filter((_, index) => index !== phaseIndex) })}
            />
          </Stack></CardContent></Card>)}
        </Stack>
        <Button variant="contained" size="large" disabled={!editable || saving} onClick={() => void save()} sx={{ alignSelf: 'flex-start' }}>{saving ? '保存中…' : 'この内容で保存'}</Button>
      </Stack>
    </Container>
  </AdminShell>
}
```

- [ ] **Step 2: Run lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/teacher/MarketStocksPage.tsx
git commit -m "feat: add the market stocks editor page"
```

---

### Task 8: Move `StudentMarketJoin` into its own file

**Files:**
- Create: `src/components/student/StudentMarketJoin.tsx`
- Modify: `src/components/MarketDashboard.tsx` (remove the `StudentMarketJoin` export; the file still holds `TeacherMarketDashboard` until Task 9)

**Interfaces:**
- Produces: `StudentMarketJoin()` (same behavior as today's export of the same name)

No automated test (none existed for this export before the move).

- [ ] **Step 1: Create the new file with the moved, CSS-cleaned component**

Create `src/components/student/StudentMarketJoin.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { onValue, ref } from 'firebase/database'
import { bootstrapFirebase } from '../../lib/firebase/bootstrap'
import { getOrCreateStudentUid } from '../../lib/auth/studentAuth'
import { armJoinRequestPresence, RECOVERY_CODE_LENGTH, requestToJoinMarket, resolveJoinCode } from '../../lib/market/marketRepository'
import { getStudentSessionId, readActiveStudentSession, saveActiveStudentSession } from '../../lib/students/studentSession'
import { useDatabaseConnected } from '../../lib/firebase/connectionState'
import { handleFailure } from '../../lib/monitoring/describeError'
import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import { StudentField, StudentPageSurface, StudentSurfaceCard } from '../ui/StudentUi'
import { studentPrimaryActionSx } from '../ui/studentUiStyles'

export const StudentMarketJoin = () => {
  const services = bootstrapFirebase()
  const [joinCode, setJoinCode] = useState(() => new URLSearchParams(window.location.search).get('code')?.toUpperCase() ?? ''), [displayName, setDisplayName] = useState(''), [recoveryCode, setRecoveryCode] = useState(''), [marketId, setMarketId] = useState(''), [requestId, setRequestId] = useState('')
  const [status, setStatus] = useState<'entry' | 'requesting' | 'waiting' | 'approved' | 'error'>('entry'), [message, setMessage] = useState('参加コードを入力して、先生の市場に参加しましょう。')
  const activeSession = readActiveStudentSession()
  const presentedRecoveryCodeRef = useRef('')
  const connected = useDatabaseConnected(services.database)
  useEffect(() => { if (!marketId || !requestId) return; const stop = onValue(ref(services.database, `liveMarkets/${marketId}/joinRequests/${requestId}`), (snapshot) => { if (snapshot.val()?.approvedAtMillis) { const active = { marketId, requestId, sessionId: getStudentSessionId(), ...(presentedRecoveryCodeRef.current ? { presentedRecoveryCode: presentedRecoveryCodeRef.current } : {}) }; saveActiveStudentSession(active); setStatus('approved'); setMessage('参加が承認されました。市場画面へ移動します。'); window.location.assign(`/markets/${marketId}/play`) } }); return () => stop() }, [marketId, requestId, services.database])
  // The onDisconnect handler armed at request time does not survive a reconnect, so a
  // waiting student whose screen locks twice would flip connected back to true once but
  // then never again — vanishing from the teacher's admission panel on the second drop.
  // Re-arming on every reconnection, exactly as StudentMarketPage's matching effect does
  // for approved participants via armApprovedParticipantPresence, closes that gap too.
  useEffect(() => { if (status !== 'waiting' || !marketId || !requestId || !connected) return; void armJoinRequestPresence(services.database, marketId, requestId).catch((error) => setMessage(handleFailure(error, '接続状態を更新できませんでした。'))) }, [connected, marketId, requestId, services.database, status])
  const join = async () => { if (!joinCode.trim() || !displayName.trim()) { setStatus('error'); return setMessage('参加コードと表示名を入力してください。') }; const normalizedRecoveryCode = recoveryCode.trim().toUpperCase(); if (normalizedRecoveryCode && normalizedRecoveryCode.length !== RECOVERY_CODE_LENGTH) { setStatus('error'); return setMessage(`復帰コードを確認してください。${RECOVERY_CODE_LENGTH}文字で入力してください。`) }; setStatus('requesting'); try { const uid = await getOrCreateStudentUid(services.auth); const resolved = await resolveJoinCode(services.firestore, joinCode); if (!resolved) throw new Error('NOT_FOUND'); presentedRecoveryCodeRef.current = normalizedRecoveryCode; const id = await requestToJoinMarket(services.database, resolved, { uid, sessionId: getStudentSessionId(), displayName: displayName.trim(), requestedTeamId: null, ...(normalizedRecoveryCode ? { recoveryCode: normalizedRecoveryCode } : {}) }); setMarketId(resolved); setRequestId(id); setStatus('waiting'); setMessage('参加を申請しました。先生の承認をお待ちください。') } catch (error) { setStatus('error'); setMessage(error instanceof Error && error.message === 'NOT_FOUND' ? '市場が見つかりません。参加コードを確認してください。' : handleFailure(error, 'この市場は参加受付を終了しているか、接続できません。')) } }
  const joining = status === 'waiting' || status === 'requesting'
  return <StudentPageSurface><Box sx={{ px: { xs: 2, sm: 4 }, py: 3 }}><Stack component="header" direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: { xs: 3, sm: 5 }, maxWidth: 1040, mx: 'auto' }}><Button component="a" href="/" color="inherit" sx={{ minHeight: 48, px: 1, fontWeight: 800 }}>Stock League Classroom</Button><Typography variant="overline" color="text.secondary">STUDENT ENTRY</Typography></Stack><Box sx={{ maxWidth: 460, mx: 'auto' }}><StudentSurfaceCard><Stack spacing={2.25} sx={{ p: { xs: 3, sm: 4 } }}><Typography variant="overline" color="text.secondary">JOIN A MARKET</Typography><Typography component="h1" variant="h4" sx={{ fontWeight: 800 }}>市場に参加</Typography><Typography color="text.secondary">先生から受け取った参加コードと、教室で使う表示名を入力してください。</Typography>{activeSession && <Button component="a" href={`/markets/${activeSession.marketId}/play`} color="inherit" variant="text" sx={{ alignSelf: 'flex-start', px: 0 }}>前回の市場へ戻る →</Button>}{status === 'approved' ? <Alert severity="success"><Typography variant="h6">参加準備ができました</Typography>{message}</Alert> : <><StudentField label="参加コード" value={joinCode} maxLength={6} placeholder="例: A1B2C3" onChange={(event) => setJoinCode(event.target.value.toUpperCase())} disabled={joining} /><StudentField label="表示名（本名は入力しないでください）" value={displayName} maxLength={20} placeholder="例: ナナシ" onChange={(event) => setDisplayName(event.target.value)} disabled={joining} /><StudentField label="復帰コード（任意）" value={recoveryCode} maxLength={4} placeholder="例: A1B2" helperText="前の端末に表示された4文字です。初参加なら空欄で構いません。使う場合は、表示名も前回と同じ文字で入力してください。" onChange={(event) => setRecoveryCode(event.target.value.toUpperCase())} disabled={joining} /><Button variant="contained" size="large" type="button" fullWidth onClick={() => void join()} disabled={joining} sx={studentPrimaryActionSx}>{status === 'requesting' ? '市場を確認中…' : status === 'waiting' ? '先生の承認を待っています' : '参加を申請する'}　→</Button><Alert severity={status === 'error' ? 'error' : 'info'} role="status">{message}</Alert></>}</Stack></StudentSurfaceCard><Typography component="footer" variant="body2" color="text.secondary" align="center" sx={{ display: 'block', mt: 3 }}>投資はシミュレーションです。実際のお金は使用しません。</Typography></Box></Box></StudentPageSurface>
}
```

- [ ] **Step 2: Remove `StudentMarketJoin` from `MarketDashboard.tsx`**

In `src/components/MarketDashboard.tsx`, delete the entire `export const StudentMarketJoin = () => { ... }` block (everything from that line to the end of the file). Leave `TeacherMarketDashboard` in place for now — it is removed in Task 9.

- [ ] **Step 3: Update the `App.tsx` import temporarily**

This is a mechanical rename only; the route wiring itself happens in Task 10. In `src/App.tsx`, change:

```ts
import { StudentMarketJoin, TeacherMarketDashboard } from './components/MarketDashboard'
```

to:

```ts
import { TeacherMarketDashboard } from './components/MarketDashboard'
import { StudentMarketJoin } from './components/student/StudentMarketJoin'
```

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Run lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/student/StudentMarketJoin.tsx src/components/MarketDashboard.tsx src/App.tsx
git commit -m "refactor: move StudentMarketJoin into its own file"
```

---

### Task 9: `WorkspacePicker` — the Slack-style market picker

**Files:**
- Create: `src/components/teacher/WorkspacePicker.tsx`
- Delete: `src/components/MarketDashboard.tsx`
- Modify: `src/components/teacher/TeacherShell.tsx` (remove the now-dead `SetupProgress` export)

**Interfaces:**
- Consumes: everything `TeacherMarketDashboard` consumed today (see imports below)
- Produces: `WorkspacePicker()`

No automated test (none existed for `TeacherMarketDashboard` before this move).

- [ ] **Step 1: Create `WorkspacePicker`**

Create `src/components/teacher/WorkspacePicker.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { onValue, ref, type Unsubscribe } from 'firebase/database'
import { useNavigate } from 'react-router'
import { bootstrapFirebase } from '../../lib/firebase/bootstrap'
import { getTeacherGoogleRedirectResult, signInTeacherWithGoogle } from '../../lib/auth/teacherAuth'
import { isTeacherIdentity } from '../../lib/auth/roles'
import { createMarket, listOwnedMarkets, type MarketRecord } from '../../lib/market/marketRepository'
import type { LiveMarketState, MarketVisibility } from '../../lib/market/liveMarketTypes'
import { MARKET_STATUS_LABEL } from '../../lib/market/marketStatusLabels'
import { listOfficialTemplates, listPersonalTemplates } from '../../lib/templates/templateRepository'
import { officialTemplateSeeds } from '../../lib/templates/officialSeeds'
import { readServiceStatus, type ServiceStatus } from '../../lib/service/serviceStatus'
import type { PersonalTemplate, TemplateSpec } from '../../lib/templates/types'
import { deleteMarketCompletely } from '../../lib/teacher/marketDeletion'
import { buildTeamCsv, buildTransactionCsv, downloadCsv, fetchMarketResults } from '../../lib/teacher/resultsExport'
import { handleFailure } from '../../lib/monitoring/describeError'
import { AppVersion } from '../AppVersion'
import { AuthLoadingScreen } from './TeacherShell'
import { OnboardingWizard } from './OnboardingWizard'
import { Alert, Box, Button, Card, CardActionArea, CardContent, Chip, FormControl, FormControlLabel, MenuItem, Paper, Radio, RadioGroup, Stack, TextField, Typography } from '@mui/material'
import Google from '@mui/icons-material/Google'
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded'

const googleSignInErrorMessage = (error: unknown): string => {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
  if (code === 'auth/operation-not-allowed') return 'Google ログインが有効ではありません。Firebase Authentication の Google プロバイダを有効にしてください。'
  if (code === 'auth/unauthorized-domain') return 'この公開URLが承認済みドメインに登録されていません。Authentication の設定を確認してください。'
  return `Google ログインを完了できませんでした${code ? `（${code}）` : ''}。もう一度お試しください。`
}

export const WorkspacePicker = () => {
  const services = bootstrapFirebase()
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(services.auth.currentUser), [authNotice, setAuthNotice] = useState('')
  const [authReady, setAuthReady] = useState(false)
  const [templates, setTemplates] = useState<PersonalTemplate[]>([]), [official, setOfficial] = useState(officialTemplateSeeds), [selectedId, setSelectedId] = useState('official:school-festival'), [visibility, setVisibility] = useState<MarketVisibility>('private')
  const [markets, setMarkets] = useState<MarketRecord[]>([])
  const [marketStates, setMarketStates] = useState<Record<string, LiveMarketState | null>>({})
  const [notice, setNotice] = useState(''), [creating, setCreating] = useState(false)
  const [status, setStatus] = useState<ServiceStatus>({ acceptingNewMarkets: true, message: '' })
  const [showOnboarding, setShowOnboarding] = useState(false)
  useEffect(() => onAuthStateChanged(services.auth, (next) => { setUser(next); setAuthReady(true) }), [services.auth])
  useEffect(() => {
    let cancelled = false
    void getTeacherGoogleRedirectResult(services.auth)
      .then((result) => { if (!cancelled && result) setAuthNotice('Google アカウントでログインしました。') })
      .catch((error) => { if (!cancelled) setAuthNotice(googleSignInErrorMessage(error)) })
    return () => { cancelled = true }
  }, [services.auth])
  useEffect(() => { void readServiceStatus(services.firestore).then(setStatus) }, [services.firestore])
  const teacher = Boolean(user && isTeacherIdentity(user))
  const refreshOwned = useCallback(async (uid: string) => {
    const [items, published, owned] = await Promise.all([listPersonalTemplates(services.firestore, uid), listOfficialTemplates(services.firestore), listOwnedMarkets(services.firestore, uid)])
    setTemplates(items)
    if (published.length) setOfficial(published.map(({ id, title, description, startingCash, teams, companies }) => ({ id, spec: { title, description, startingCash, teams, companies } })))
    setMarkets(owned)
  }, [services.firestore])
  useEffect(() => { if (!teacher || !user) return; void refreshOwned(user.uid).catch((error) => setNotice(handleFailure(error, 'テンプレートまたは市場を読み込めませんでした。'))) }, [refreshOwned, teacher, user])
  useEffect(() => {
    const stops: Unsubscribe[] = markets.map((market) => onValue(ref(services.database, `liveMarkets/${market.id}`), (snapshot) => {
      setMarketStates((current) => ({ ...current, [market.id]: snapshot.val() as LiveMarketState | null }))
    }))
    return () => stops.forEach((stop) => stop())
  }, [markets, services.database])
  useEffect(() => {
    if (!teacher || !user) return
    const key = `stock-league:onboarding:${user.uid}`
    if (window.localStorage.getItem(key) !== 'done') setShowOnboarding(true)
  }, [teacher, user])
  const closeOnboarding = () => { if (user) window.localStorage.setItem(`stock-league:onboarding:${user.uid}`, 'done'); setShowOnboarding(false) }
  const selected: TemplateSpec | undefined = useMemo(() => selectedId.startsWith('official:')
    ? official.find((item) => item.id === selectedId.slice(9))?.spec
    : templates.find((item) => item.id === selectedId.slice(9)), [official, selectedId, templates])
  const signInWithGoogle = async () => {
    setAuthNotice('Google ログイン画面へ移動します。選択後、この画面に戻ります。')
    try { await signInTeacherWithGoogle(services.auth) } catch (error) { setAuthNotice(googleSignInErrorMessage(error)) }
  }
  const create = async () => {
    if (!selected || !user) return setNotice('先にテンプレートを選んでください。')
    setCreating(true)
    try {
      const result = await createMarket(services.firestore, services.database, { ownerUid: user.uid, template: selected, visibility })
      navigate(`/teacher/markets/${result.marketId}/room`)
    } catch (error) {
      setNotice(error instanceof Error && error.message.startsWith('参加コード') ? error.message : handleFailure(error, '市場を作成できませんでした。接続と権限を確認してください。'))
    } finally {
      setCreating(false)
    }
  }
  const exportResults = async (market: MarketRecord) => {
    const companyNames = Object.fromEntries(market.templateSnapshot.companies.map((company) => [company.id, company.name]))
    const { teams, participants } = await fetchMarketResults(services.firestore, market.id)
    if (!teams.length && !participants.length) return setNotice('この市場にはまだ確定した結果がありません。市場を終了してからお試しください。')
    const stamp = market.templateSnapshot.title.replace(/[^\p{L}\p{N}]+/gu, '_')
    downloadCsv(`${stamp}_チーム結果.csv`, buildTeamCsv(teams, companyNames))
    downloadCsv(`${stamp}_取引履歴.csv`, buildTransactionCsv(participants, companyNames))
    setNotice('結果を CSV で保存しました。')
  }
  const removeMarket = async (market: MarketRecord) => {
    if (!user || !window.confirm(`市場「${market.templateSnapshot.title}」を削除しますか？結果・取引履歴・参加コードがすべて消え、元に戻せません。必要なら先に「結果をCSVで保存」してください。`)) return
    await deleteMarketCompletely(services.firestore, services.database, market.id)
    await refreshOwned(user.uid)
    setNotice('市場を削除しました。')
  }
  if (!authReady) return <AuthLoadingScreen />
  if (!teacher || !user) return <Box component="main" sx={{ display: 'grid', gridTemplateColumns: { md: 'minmax(0, 1fr) minmax(18rem, 0.75fr)' }, minHeight: '100dvh' }}>
    <Stack component="section" spacing={3} sx={{ justifyContent: 'center', px: { xs: 3, sm: 6 }, py: 6 }}>
      <Button component="a" href="/" variant="text" color="inherit" sx={{ alignSelf: 'flex-start' }}>← Stock League Classroom</Button>
      <Typography variant="overline" color="primary">TEACHER PORTAL</Typography>
      <Typography component="h1" variant="h2">授業の市場を、<br />ここから準備。</Typography>
      <Typography color="text.secondary">Google アカウントでログインすると、テンプレートの編集、市場の作成、参加状況の管理ができます。</Typography>
      <Button variant="contained" size="large" onClick={() => void signInWithGoogle()} startIcon={<Google />} endIcon={<ArrowForwardRounded />} sx={{ alignSelf: 'flex-start', gap: 0.5 }}>Googleでログイン</Button>
      {authNotice && <Alert severity="info" role="status">{authNotice}</Alert>}
    </Stack>
    <Stack component="aside" spacing={3} sx={{ justifyContent: 'center', px: { xs: 3, sm: 6 }, py: 6, color: 'primary.contrastText', bgcolor: 'primary.main', display: { xs: 'none', md: 'flex' } }}>
      <Typography variant="overline" sx={{ opacity: 0.85 }}>CLASSROOM MARKET</Typography>
      <Typography component="h2" variant="h4">準備から振り返りまで、<br />一つの教室で。</Typography>
      <Box component="ul" sx={{ display: 'grid', gap: 1, m: 0, pl: 3 }}><li>授業テーマに合うテンプレート</li><li>生徒の参加をその場で承認</li><li>市場の進行をリアルタイムで管理</li></Box>
    </Stack>
  </Box>
  const hasMarkets = markets.length > 0
  return <Box component="main" sx={{ minHeight: '100dvh', bgcolor: 'background.default' }}>
    <Stack component="header" direction="row" spacing={2} sx={{ justifyContent: 'space-between', alignItems: 'center', px: { xs: 2, sm: 4 }, py: 2, borderBottom: 1, borderColor: 'divider' }}>
      <Typography variant="h6" sx={{ fontWeight: 800 }}>Stock League Classroom</Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Button variant="text" onClick={() => setShowOnboarding(true)}>使い方</Button>
        <Chip label={(user.email ?? 'T').slice(0, 1).toUpperCase()} aria-label="教師アカウント" />
        <AppVersion />
      </Stack>
    </Stack>
    <Box sx={{ maxWidth: 1200, mx: 'auto', px: { xs: 2, sm: 4 }, py: { xs: 3, sm: 5 } }}>
      <Stack spacing={4}>
        {notice && <Alert severity="info" role="status" onClose={() => setNotice('')}>{notice}</Alert>}
        <Box>
          <Typography variant="overline" color="primary">WORKSPACES</Typography>
          <Typography component="h1" variant="h4" sx={{ fontWeight: 800 }}>{hasMarkets ? '授業を選ぶ' : '最初の授業を作りましょう'}</Typography>
          <Typography color="text.secondary">{hasMarkets ? '作成済みの市場をクリックすると、その市場のコントロールルームに入ります。' : 'テンプレートを選んで、最初の市場を作成してください。'}</Typography>
        </Box>
        {hasMarkets && <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' } }}>
          {markets.map((market) => {
            const state = marketStates[market.id]
            const activeCount = Object.values(state?.participants ?? {}).filter((participant) => participant.connected).length
            const marketStatus = state?.meta?.status ?? 'SETUP'
            return <Card key={market.id} variant="outlined">
              <CardActionArea component="a" href={`/teacher/markets/${market.id}/room`}>
                <CardContent>
                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Typography component="h2" variant="h6" sx={{ fontWeight: 800 }}>{market.templateSnapshot.title}</Typography>
                    <Chip size="small" label={MARKET_STATUS_LABEL[marketStatus]} color={marketStatus === 'OPEN' ? 'success' : marketStatus === 'PAUSED' ? 'warning' : 'default'} />
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>参加コード {market.joinCode} ・ 参加者 {activeCount} 人</Typography>
                </CardContent>
              </CardActionArea>
              <Stack direction="row" spacing={1} sx={{ px: 2, pb: 2, flexWrap: 'wrap' }}>
                <Button size="small" variant="outlined" href={`/markets/${market.id}/signage`} target="_blank" rel="noopener">教室画面</Button>
                <Button size="small" variant="outlined" type="button" onClick={() => void exportResults(market).catch((error) => setNotice(handleFailure(error, '結果を読み込めませんでした。')))}>結果をCSVで保存</Button>
                <Button size="small" color="error" variant="outlined" type="button" onClick={() => void removeMarket(market).catch((error) => setNotice(handleFailure(error, '市場を削除できませんでした。一部だけ削除された可能性があります。もう一度削除を実行してください。')))}>削除</Button>
              </Stack>
            </Card>
          })}
        </Box>}
        <Paper component="section" variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', mb: 2 }}>
            <Box>
              <Typography variant="overline" color="primary">NEW WORKSPACE</Typography>
              <Typography component="h2" variant="h5" sx={{ fontWeight: 800 }}>＋ 新しい授業を作る</Typography>
            </Box>
            <Button component="a" href="/templates" variant="text">自分で編集 →</Button>
          </Stack>
          {!status.acceptingNewMarkets && <Alert severity="warning" role="alert" sx={{ mb: 2 }}><strong>現在、新しい市場の作成を停止しています。</strong><br />{status.message || 'メンテナンスのため一時的に受付を止めています。進行中の市場はそのままご利用いただけます。'}</Alert>}
          <FormControl component="fieldset" fullWidth>
            <Typography component="legend" variant="subtitle1">使うテンプレート</Typography>
            <RadioGroup name="template" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { sm: 'repeat(2, minmax(0, 1fr))' }, mt: 1 }}>
                {official.map((item, index) => { const value = `official:${item.id}`; return <Card key={value} variant="outlined" sx={{ borderColor: selectedId === value ? 'primary.main' : 'divider' }}>
                  <CardActionArea component="label"><CardContent><FormControlLabel value={value} control={<Radio />} label={<Stack><Typography variant="subtitle1">{index + 1}. {item.spec.title}</Typography><Typography variant="body2" color="text.secondary">{item.spec.companies.length}銘柄 ・ ¥{item.spec.startingCash.toLocaleString()}</Typography></Stack>} sx={{ m: 0, width: '100%' }} /></CardContent></CardActionArea>
                </Card> })}
                {templates.map((item) => { const value = `personal:${item.id}`; return <Card key={value} variant="outlined" sx={{ borderColor: selectedId === value ? 'primary.main' : 'divider' }}>
                  <CardActionArea component="label"><CardContent><FormControlLabel value={value} control={<Radio />} label={<Stack><Typography variant="subtitle1">自分のテンプレート: {item.title}</Typography><Typography variant="body2" color="text.secondary">{item.companies.length}銘柄 ・ ¥{item.startingCash.toLocaleString()}</Typography></Stack>} sx={{ m: 0, width: '100%' }} /></CardContent></CardActionArea>
                </Card> })}
              </Box>
            </RadioGroup>
          </FormControl>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', mt: 3 }}>
            <Box><Typography variant="subtitle1">{selected?.title ?? 'テンプレートを選択してください'}</Typography><Typography variant="body2" color="text.secondary">{selected?.description}</Typography></Box>
            <TextField select label="公開範囲" value={visibility} onChange={(event) => setVisibility(event.target.value as MarketVisibility)} sx={{ minWidth: { sm: 220 } }}>
              <MenuItem value="private">参加者のみ</MenuItem><MenuItem value="ranking_only">順位のみ公開</MenuItem><MenuItem value="public">価格・ニュース・順位を公開</MenuItem>
            </TextField>
          </Stack>
          <Button variant="contained" size="large" type="button" disabled={!selected || creating || !status.acceptingNewMarkets} onClick={() => void create()} sx={{ mt: 3 }}>{creating ? '市場を準備中…' : !status.acceptingNewMarkets ? '受付を停止しています' : 'この内容で市場を作成'}　→</Button>
        </Paper>
      </Stack>
    </Box>
    <OnboardingWizard open={showOnboarding} onClose={closeOnboarding} />
  </Box>
}
```

- [ ] **Step 2: Delete `MarketDashboard.tsx`**

Run: `rm src/components/MarketDashboard.tsx`

- [ ] **Step 3: Update the `App.tsx` import and route element**

In `src/App.tsx`, replace:

```ts
import { TeacherMarketDashboard } from './components/MarketDashboard'
```

with:

```ts
import { WorkspacePicker } from './components/teacher/WorkspacePicker'
```

And replace the route element that still names the old symbol:

```tsx
  <Route path="/teacher/markets" element={<TeacherMarketDashboard />} />
```

with:

```tsx
  <Route path="/teacher/markets" element={<WorkspacePicker />} />
```

(This is the only route touched in this task. Task 10 wires the remaining new routes — `/teacher/markets/:marketId/stocks` and the simplified `/teacher/markets/:marketId/room` — which depend on `MarketStocksPage`, `ControlRoom`, and `StudentMarketJoin` all being in place first.)

- [ ] **Step 4: Remove the now-dead `SetupProgress` export from `TeacherShell.tsx`**

`SetupProgress` (and its `ProgressStep` interface) was only ever used by the old `TeacherMarketDashboard`, which no longer exists. Confirm no other usage first:

Run: `grep -rn "SetupProgress" src`
Expected: only the definition in `src/components/teacher/TeacherShell.tsx` remains (no more usages in `MarketDashboard.tsx`, since it was deleted in Step 2).

In `src/components/teacher/TeacherShell.tsx`, delete the `export interface ProgressStep { ... }` block and the `export const SetupProgress = ...` block (everything from `export interface ProgressStep` through the end of that function, just before `export const AuthLoadingScreen`).

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS, including `App.test.tsx`'s check that the landing page still links to `/teacher/markets`.

- [ ] **Step 6: Run lint, typecheck, and build**

Run: `npm run lint && npm run typecheck && npm run build`
Expected: no errors, build succeeds. `App.tsx` compiles cleanly at this point — only `/teacher/markets` was touched; `RoomRoute`/`StocksRoute` land in Task 10.

- [ ] **Step 7: Commit**

```bash
git add src/components/teacher/WorkspacePicker.tsx src/components/MarketDashboard.tsx src/components/teacher/TeacherShell.tsx src/App.tsx
git commit -m "refactor: replace the teacher dashboard with a workspace picker"
```

---

### Task 10: Wire the new routes into `App.tsx`

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `MarketStocksPage` (Task 7), `ControlRoom` (Task 5, now self-wrapping in `AdminShell`). `WorkspacePicker` and `StudentMarketJoin` are already wired into `App.tsx` by Tasks 8-9.

- [ ] **Step 1: Remove the `TeacherShell` import and add `MarketStocksPage`**

In `src/App.tsx`, remove:

```ts
import { TeacherShell } from './components/teacher/TeacherShell'
```

Add:

```ts
import { MarketStocksPage } from './components/teacher/MarketStocksPage'
```

(`TeacherShell` is still used by `TemplateWorkspace.tsx` internally, but `App.tsx` itself no longer needs to import it now that `RoomRoute` doesn't wrap `ControlRoom` in it.)

- [ ] **Step 2: Simplify `RoomRoute` and add `StocksRoute`**

Replace:

```tsx
const RoomRoute = () => {
  const marketId = useParams().marketId ?? ''
  return <TeacherShell active="room" marketId={marketId}><ControlRoom marketId={marketId} /></TeacherShell>
}
```

with:

```tsx
const RoomRoute = () => <ControlRoom marketId={useParams().marketId ?? ''} />
const StocksRoute = () => <MarketStocksPage marketId={useParams().marketId ?? ''} />
```

- [ ] **Step 3: Add the stocks route**

In the `AppRoutes` route list, add a new route immediately after the room route:

```tsx
  <Route path="/teacher/markets/:marketId/room" element={<RoomRoute />} />
  <Route path="/teacher/markets/:marketId/stocks" element={<StocksRoute />} />
```

(The `/teacher/markets` route element itself already points at `WorkspacePicker` — that was done in Task 9 Step 3, since `WorkspacePicker` had to exist and be imported before any route could reference it. This task only adds the two routes above.)

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS, including `App.test.tsx` (the landing page link to `/teacher/markets`, the public doc pages, the not-found page, and the legacy host-URL redirect all still work — none of them render `WorkspacePicker`, `ControlRoom`, or `MarketStocksPage`, which need Firebase and are not exercised by that suite).

- [ ] **Step 5: Run lint, typecheck, and build**

Run: `npm run lint && npm run typecheck && npm run build`
Expected: no errors, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire the workspace picker and stocks page into routing"
```

---

### Task 11: Manual verification in the browser

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (or use the project's preview tooling)

- [ ] **Step 2: Walk the teacher flow**

1. Open `/teacher/markets`, sign in, confirm the workspace picker shows existing markets as cards (or the empty-state copy if there are none) and the create-market panel below it.
2. Create a market from a template; confirm it navigates straight to `/teacher/markets/:id/room`.
3. In the control room, confirm the new `AdminShell` sidebar shows 銘柄／進行／教室画面 and a "別の市場を選ぶ" link back to `/teacher/markets`, and that the old top `AppBar` header is gone.
4. Click 銘柄 in the sidebar; confirm `/teacher/markets/:id/stocks` loads, shows the market's companies, and that all fields are disabled with the "一時停止してください" banner while the market is `SETUP` (before it has ever opened, editing should still be allowed — confirm fields are enabled in `SETUP`).
5. Take the host lease and open the market (status `OPEN`); revisit 銘柄 and confirm the fields are now disabled with the banner.
6. Back in 進行, click "市場を一時停止"; confirm the status chip in the sidebar flips to 一時停止中 and the notice banner mentions the 銘柄 menu.
7. Go to 銘柄, edit a company name and a price phase, save; confirm the notice says it saved and the change is reflected.
8. Return to 進行, click "市場を再開"; confirm trading resumes and prices for the edited company reflect the new values.
9. Resize the browser to a narrow (mobile) width at each of these screens; confirm no button overflows or wraps outside its container.

- [ ] **Step 3: Walk the student flow**

Confirm `/join` still renders the student entry form (`StudentMarketJoin`) and that joining a market with a valid code still works end-to-end.

- [ ] **Step 4: Record findings**

If any step fails, fix the underlying task's code and re-run this task from Step 1. Do not proceed to Task 12 until all steps pass.

---

### Task 12: CSS cleanup and final verification

**Files:**
- Modify: `src/App.css` (remove confirmed-unused rules)

- [ ] **Step 1: Identify candidate unused classes**

The following class names were used only by `MarketDashboard.tsx`/`TeacherShell.tsx`'s old rendering and are candidates for removal now that `WorkspacePicker.tsx`, `AdminShell.tsx`, and `MarketStocksPage.tsx` no longer reference them: `portal-page`, `portal-auth`, `portal-brand`, `portal-eyebrow`, `portal-help`, `portal-button`, `portal-aside`, `teacher-page`, `teacher-header`, `teacher-avatar`, `teacher-hero`, `teacher-stats`, `teacher-workspace`, `create-market-card`, `active-market-card`, `card-heading`, `active-head`, `field-grid`, `empty-panel`, `empty-copy`, `join-code`, `market-meta`, `request-list`, `market-picker-card`, `market-picker-list`, `teacher-shell`, `teacher-sidebar`, `sidebar-brand`, `sidebar-group-label`, `sidebar-bottom`, `sidebar-account`, `teacher-shell-content`, `mobile-page-title`, `header-help`, `teacher-progress-wrap`, `host-progress-wrap`, `setup-progress`, `progress-caption`, `progress-dot`, `host-page`, `auth-loading`, `auth-loading-mark`, `auth-loading-line`.

For each name, verify it is genuinely unused before deleting its rule:

Run: `for cls in portal-page portal-auth portal-brand portal-eyebrow portal-help portal-button portal-aside teacher-page teacher-header teacher-avatar teacher-hero teacher-stats teacher-workspace create-market-card active-market-card card-heading active-head field-grid empty-panel empty-copy join-code market-meta request-list market-picker-card market-picker-list teacher-shell teacher-sidebar sidebar-brand sidebar-group-label sidebar-bottom sidebar-account teacher-shell-content mobile-page-title header-help teacher-progress-wrap host-progress-wrap setup-progress progress-caption progress-dot host-page auth-loading auth-loading-mark auth-loading-line; do echo "== $cls =="; grep -rn "\"$cls\"\|'$cls'\|\`$cls\`\| $cls \|.$cls" src --include=*.tsx | grep -v "\.test\.tsx"; done`

Note: `teacher-page`, `teacher-header`, `mobile-page-title`, `header-help`, `card-heading`, `auth-loading`/`auth-loading-mark`/`auth-loading-line` are still used by `TemplateWorkspace.tsx` and/or `AuthLoadingScreen` in `TeacherShell.tsx` (both out of scope for this plan) — **do not remove their CSS rules** even though the grep above may show only one remaining hit; keep any class with at least one real `.tsx` usage.

- [ ] **Step 2: Remove the rules confirmed to have zero remaining `.tsx` usages**

For every class from Step 1 where the grep returned no matches, delete its CSS rule (and any now-empty media-query block) from `src/App.css`. Work rule-by-rule with the Edit tool, matching the exact selector text found via `grep -n "\.<class-name>" src/App.css` before removing it, so only the confirmed-dead selectors are touched.

- [ ] **Step 3: Run the full verification suite**

Run: `npm run verify`
Expected: PASS (lint, typecheck, unit tests, Firestore/RTDB rules tests, and the production build all succeed).

- [ ] **Step 4: Visually re-check the pages touched in Task 11**

Reload `/teacher/markets`, the control room, and the stocks page in the browser; confirm removing the CSS did not visually break anything (everything should already be MUI `sx`-styled, so this is a safety check, not an expected source of change).

- [ ] **Step 5: Commit**

```bash
git add src/App.css
git commit -m "chore: remove CSS rules made dead by the admin workspace shell rewrite"
```
