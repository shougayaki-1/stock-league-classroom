# 教師・生徒UX/ナビゲーション改善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the misleading teacher-side navigation (sidebar items that all point to one screen, duplicate admission UI, non-functional decorative buttons) and the missing student onboarding, per `docs/superpowers/specs/2026-08-04-teacher-student-ux-navigation-design.md`.

**Architecture:** Extract the Host Console's cards into small, independently-testable presentational components (`PhaseBand`, trimmed `HostStatusPanel`, `MarketControlPanel`, `NewsPublishPanel`, `SignageLinkPanel`), then reassemble them behind a tabbed `ControlRoom` page at a renamed `/room` route. The teacher sidebar and market dashboard are updated to point at this single destination instead of four fake ones. On the student side, add a status-label unification, a collapsible recovery-code disclosure, and an embedded onboarding card.

**Tech Stack:** React 19, TypeScript, MUI (`@mui/material`), `react-router` 7, Vitest + Testing Library, Firebase (Auth/Firestore/RTDB).

## Global Constraints

- Every task must leave `npm test` (168+ tests) and `npm run typecheck` passing before it is committed.
- `tsconfig.app.json` has `noUnusedLocals` and `noUnusedParameters` enabled — the compiler itself will catch stale imports/params after each extraction. Run `npm run typecheck` after every step that touches imports and delete whatever it flags.
- Firebase-coupled top-level pages (`TeacherMarketDashboard`, `HostConsole`/`ControlRoom`, `StudentMarketPage`) have no existing RTL test coverage in this codebase (confirmed: no `MarketDashboard.test.tsx`, `HostConsole.test.tsx`, or `StudentMarketPage.test.tsx` exist) because they call `bootstrapFirebase()` unconditionally, which is not safely mountable in jsdom without a real or emulated backend. Do not invent tests that render these components end-to-end; instead verify changes to them via `npm run typecheck`, the full test suite staying green, and the manual dev-server check listed in each such task. Pure presentational components extracted from them (e.g. `PhaseBand`, `MarketControlPanel`) get full RTL tests as usual.
- All UI copy is Japanese, matching the rest of the codebase.
- Keep using MUI components and the existing `appTheme` (`src/theme/theme.ts`); do not introduce another UI library.
- Old URLs are not required to keep working as-is, but must redirect (no dead links): `/teacher/markets/:id/host` → `/teacher/markets/:id/room`.

---

### Task 1: Shared market status labels + PhaseBand + trim HostStatusPanel

**Files:**
- Create: `src/lib/market/marketStatusLabels.ts`
- Create: `src/lib/market/marketStatusLabels.test.ts`
- Create: `src/components/teacher/PhaseBand.tsx`
- Create: `src/components/teacher/PhaseBand.test.tsx`
- Modify: `src/components/teacher/HostStatusPanel.tsx` (trim to price table only)
- Modify: `src/components/teacher/HostStatusPanel.test.tsx` (remove assertions for removed props/markup)
- Modify: `src/components/HostConsole.tsx:1-41` (imports), `:145-159` (render)

**Interfaces:**
- Produces: `MARKET_STATUS_LABEL: Record<MarketStatus, string>`, `MARKET_PHASE_ORDER: MarketStatus[]`, `describeStudentPhase(status: MarketStatus | undefined): string` from `src/lib/market/marketStatusLabels.ts`.
- Produces: `PhaseBand({ status: MarketStatus; openedAtMillis?: number; nowMillis: number; participantCount: number; capacity: number; pendingOrderCount: number })` and `describeElapsed(openedAtMillis: number | undefined, nowMillis: number): string`, both exported from `src/components/teacher/PhaseBand.tsx`.
- Produces: `HostStatusPanel({ prices: { stockId: string; name: string; symbol: string; price: number; basePrice: number }[]; lastTickAtMillis?: number; hostingSinceMillis?: number; nowMillis: number })` from `src/components/teacher/HostStatusPanel.tsx` (breaking change to this component's props — `status`, `openedAtMillis`, `participantCount`, `capacity`, `pendingOrderCount` are removed; `describeElapsed` is no longer exported from here).
- Consumes: `MarketStatus` from `src/lib/market/liveMarketTypes.ts` (already exists).

- [x] **Step 1: Write the failing test for the shared labels module**

```ts
// src/lib/market/marketStatusLabels.test.ts
import { describe, expect, it } from 'vitest'
import { describeStudentPhase, MARKET_PHASE_ORDER, MARKET_STATUS_LABEL } from './marketStatusLabels'

describe('marketStatusLabels', () => {
  it('labels every market status in Japanese', () => {
    expect(MARKET_STATUS_LABEL.SETUP).toBe('準備中')
    expect(MARKET_STATUS_LABEL.OPEN).toBe('取引中')
    expect(MARKET_STATUS_LABEL.ENDING).toBe('結果を確定中')
    expect(MARKET_STATUS_LABEL.ENDED).toBe('終了')
  })

  it('orders the phases from setup to ended', () => {
    expect(MARKET_PHASE_ORDER).toEqual(['SETUP', 'OPEN', 'ENDING', 'ENDED'])
  })

  it('falls back to a connecting label before the student has a status yet', () => {
    expect(describeStudentPhase(undefined)).toBe('接続中')
    expect(describeStudentPhase('OPEN')).toBe('取引中')
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/market/marketStatusLabels.test.ts`
Expected: FAIL with "Failed to resolve import" (the module does not exist yet).

- [x] **Step 3: Write the module**

```ts
// src/lib/market/marketStatusLabels.ts
import type { MarketStatus } from './liveMarketTypes'

/** Kept in one place so the teacher's phase band and the student's status chip never disagree. */
export const MARKET_STATUS_LABEL: Record<MarketStatus, string> = {
  SETUP: '準備中',
  OPEN: '取引中',
  ENDING: '結果を確定中',
  ENDED: '終了',
}

export const MARKET_PHASE_ORDER: MarketStatus[] = ['SETUP', 'OPEN', 'ENDING', 'ENDED']

/** The student market page has a brief window before `meta` loads where there is no status yet. */
export const describeStudentPhase = (status: MarketStatus | undefined): string =>
  status ? MARKET_STATUS_LABEL[status] : '接続中'
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/market/marketStatusLabels.test.ts`
Expected: PASS (3 tests)

- [x] **Step 5: Commit**

```bash
git add src/lib/market/marketStatusLabels.ts src/lib/market/marketStatusLabels.test.ts
git commit -m "feat: add a shared market status label map for teacher and student UI"
```

- [x] **Step 6: Write the failing test for PhaseBand**

```tsx
// src/components/teacher/PhaseBand.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { describeElapsed, PhaseBand } from './PhaseBand'

describe('describeElapsed', () => {
  it('counts from the market opening in minutes and seconds', () => {
    expect(describeElapsed(undefined, 1_000)).toBe('未開始')
    expect(describeElapsed(0, 5_000)).toBe('0分05秒')
    expect(describeElapsed(0, 125_000)).toBe('2分05秒')
  })
})

describe('PhaseBand', () => {
  it('highlights the current phase and shows elapsed time, participants and unprocessed orders', () => {
    render(<PhaseBand status="OPEN" openedAtMillis={0} nowMillis={90_000} participantCount={12} capacity={80} pendingOrderCount={3} />)
    expect(screen.getByText('取引中')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText('準備中')).not.toHaveAttribute('aria-current')
    expect(screen.getByText('1分30秒')).toBeInTheDocument()
    expect(screen.getByText('12 / 80')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('highlights setup when the market has not opened yet', () => {
    render(<PhaseBand status="SETUP" nowMillis={1_000} participantCount={0} capacity={80} pendingOrderCount={0} />)
    expect(screen.getByText('準備中')).toHaveAttribute('aria-current', 'step')
  })
})
```

- [x] **Step 7: Run test to verify it fails**

Run: `npx vitest run src/components/teacher/PhaseBand.test.tsx`
Expected: FAIL with "Failed to resolve import" (`./PhaseBand` does not exist yet).

- [x] **Step 8: Write PhaseBand**

```tsx
// src/components/teacher/PhaseBand.tsx
import { Stack, Typography } from '@mui/material'
import type { MarketStatus } from '../../lib/market/liveMarketTypes'
import { MARKET_PHASE_ORDER, MARKET_STATUS_LABEL } from '../../lib/market/marketStatusLabels'

export interface PhaseBandProps {
  status: MarketStatus
  openedAtMillis?: number
  nowMillis: number
  participantCount: number
  capacity: number
  pendingOrderCount: number
}

export const describeElapsed = (openedAtMillis: number | undefined, nowMillis: number): string => {
  if (openedAtMillis === undefined) return '未開始'
  const seconds = Math.max(0, Math.floor((nowMillis - openedAtMillis) / 1000))
  return `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, '0')}秒`
}

const Metric = ({ label, value }: { label: string; value: string }) => (
  <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline' }}>
    <Typography color="text.secondary">{label}</Typography>
    <Typography sx={{ fontWeight: 700 }}>{value}</Typography>
  </Stack>
)

export function PhaseBand({ status, openedAtMillis, nowMillis, participantCount, capacity, pendingOrderCount }: PhaseBandProps) {
  const currentIndex = MARKET_PHASE_ORDER.indexOf(status)
  return (
    <Stack component="section" aria-label="市場フェーズ" spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        {MARKET_PHASE_ORDER.map((phase, index) => (
          <Stack key={phase} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography
              component="span"
              aria-current={index === currentIndex ? 'step' : undefined}
              sx={{
                px: 1.5, py: 0.5, borderRadius: 999, fontWeight: 700, fontSize: 13,
                bgcolor: index === currentIndex ? 'primary.main' : 'action.hover',
                color: index === currentIndex ? 'primary.contrastText' : 'text.secondary',
              }}
            >
              {MARKET_STATUS_LABEL[phase]}
            </Typography>
            {index < MARKET_PHASE_ORDER.length - 1 && <Typography color="text.secondary" aria-hidden="true">→</Typography>}
          </Stack>
        ))}
      </Stack>
      <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap' }}>
        <Metric label="経過時間" value={describeElapsed(openedAtMillis, nowMillis)} />
        <Metric label="参加者" value={`${participantCount} / ${capacity}`} />
        <Metric label="未処理の注文" value={String(pendingOrderCount)} />
      </Stack>
    </Stack>
  )
}
```

- [x] **Step 9: Run test to verify it passes**

Run: `npx vitest run src/components/teacher/PhaseBand.test.tsx`
Expected: PASS (3 tests)

- [x] **Step 10: Write the failing/updated tests for the trimmed HostStatusPanel**

Replace the entire contents of `src/components/teacher/HostStatusPanel.test.tsx`:

```tsx
// src/components/teacher/HostStatusPanel.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HostStatusPanel } from './HostStatusPanel'

describe('HostStatusPanel', () => {
  const props = {
    nowMillis: 90_000,
    prices: [{ stockId: 'acme', name: 'アクメ', symbol: 'ACME', price: 512, basePrice: 500 }],
    lastTickAtMillis: 89_000,
  }

  it('shows each price with its change against the starting price', () => {
    render(<HostStatusPanel {...props} />)
    expect(screen.getByText('512')).toBeInTheDocument()
    expect(screen.getByText('+2.4%')).toBeInTheDocument()
  })

  it('shows no warning when not hosting yet, regardless of elapsed time', () => {
    render(<HostStatusPanel {...props} lastTickAtMillis={undefined} hostingSinceMillis={undefined} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows no warning while hosting and freshly ticked', () => {
    render(<HostStatusPanel {...props} hostingSinceMillis={0} lastTickAtMillis={89_000} nowMillis={90_000} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('warns with the reconnect message when a previously succeeding tick goes stale', () => {
    render(<HostStatusPanel {...props} hostingSinceMillis={0} lastTickAtMillis={60_000} nowMillis={90_000} />)
    expect(screen.getByRole('alert')).toHaveTextContent('価格が30秒間更新されていません。ホスト権限が失効しているか、通信が切れています。')
  })

  it('warns with the never-started message when hosting has begun but no tick has ever succeeded', () => {
    render(<HostStatusPanel {...props} hostingSinceMillis={0} lastTickAtMillis={undefined} nowMillis={15_000} />)
    expect(screen.getByRole('alert')).toHaveTextContent('ホスト取得から15秒経っても価格が一度も更新されていません。権限が不足しているか、別の端末がホストになっている可能性があります。')
  })
})
```

- [x] **Step 11: Run test to verify it fails**

Run: `npx vitest run src/components/teacher/HostStatusPanel.test.tsx`
Expected: FAIL — `HostStatusPanel` still requires `status`/`openedAtMillis`/`participantCount`/`capacity`/`pendingOrderCount` and renders the old markup, so the "no warning"/"warns" assertions about `role="alert"` still pass but this locks in the target shape ahead of the trim; the real signal is the next step's typecheck failing once props are narrowed. Proceed to Step 12 regardless — this is a case where the test file is updated before the implementation, per TDD, even though some assertions happen to still pass against the old implementation.

- [x] **Step 12: Trim HostStatusPanel to the price table**

Replace the entire contents of `src/components/teacher/HostStatusPanel.tsx`:

```tsx
// src/components/teacher/HostStatusPanel.tsx
export interface HostStatusPanelProps {
  prices: { stockId: string; name: string; symbol: string; price: number; basePrice: number }[]
  lastTickAtMillis?: number
  hostingSinceMillis?: number
  nowMillis: number
}

/** Anything beyond a few ticks means the host loop is not running. */
const STALE_TICK_MS = 10_000

const changeLabel = (price: number, basePrice: number) => {
  const percent = basePrice > 0 ? ((price - basePrice) / basePrice) * 100 : 0
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`
}

export function HostStatusPanel({ prices, lastTickAtMillis, hostingSinceMillis, nowMillis }: HostStatusPanelProps) {
  const hasTicked = lastTickAtMillis !== undefined
  const staleFor = hasTicked ? nowMillis - lastTickAtMillis : hostingSinceMillis === undefined ? 0 : nowMillis - hostingSinceMillis
  const isStale = hostingSinceMillis !== undefined && staleFor > STALE_TICK_MS
  return (
    <section className="host-status-panel">
      {isStale && (hasTicked
        ? <p className="form-notice stopped" role="alert">価格が{Math.floor(staleFor / 1000)}秒間更新されていません。ホスト権限が失効しているか、通信が切れています。</p>
        : <p className="form-notice stopped" role="alert">ホスト取得から{Math.floor(staleFor / 1000)}秒経っても価格が一度も更新されていません。権限が不足しているか、別の端末がホストになっている可能性があります。</p>)}
      <table className="host-price-table">
        <caption className="visually-hidden">現在の株価</caption>
        <thead><tr><th scope="col">銘柄</th><th scope="col">現在価格</th><th scope="col">開始価格</th><th scope="col">変化率</th></tr></thead>
        <tbody>{prices.map((entry) => (
          <tr key={entry.stockId}>
            <th scope="row">{entry.name} <small>{entry.symbol}</small></th>
            <td>{entry.price}</td>
            <td>{entry.basePrice}</td>
            <td className={entry.price >= entry.basePrice ? 'up' : 'down'}>{changeLabel(entry.price, entry.basePrice)}</td>
          </tr>
        ))}</tbody>
      </table>
    </section>
  )
}
```

Note what was deliberately dropped versus the previous version: the `describeElapsed` export (now in `PhaseBand`), the `status`/`openedAtMillis`/`participantCount`/`capacity`/`pendingOrderCount` props and their metric row (now in `PhaseBand`), the non-functional "緊急暴落"/"緊急急騰" pills, the dead "遅延" column (always rendered `—`), the redundant per-row "現在フェーズ" column, and the non-functional per-row "詳細" link.

- [x] **Step 13: Run test to verify it passes**

Run: `npx vitest run src/components/teacher/HostStatusPanel.test.tsx`
Expected: PASS (5 tests)

- [x] **Step 14: Wire PhaseBand and the trimmed HostStatusPanel into HostConsole**

In `src/components/HostConsole.tsx`, add the import (near the other local imports, e.g. after the `AdmissionPanel` import):

```tsx
import { PhaseBand } from './teacher/PhaseBand'
```

Replace the single `<HostStatusPanel ... />` call (the one currently passing `status`, `openedAtMillis`, `participantCount`, `capacity`, `pendingOrderCount`, `prices`, `lastTickAtMillis`, `hostingSinceMillis`) with:

```tsx
<PhaseBand
  status={live?.meta?.status ?? 'SETUP'}
  openedAtMillis={live?.meta?.openedAtMillis}
  nowMillis={nowMillis}
  participantCount={Object.values(live?.participants ?? {}).filter((participant) => participant.connected).length}
  capacity={live?.meta?.capacity ?? 80}
  pendingOrderCount={Object.values(live?.orders ?? {}).filter((entry) => entry.pending).length}
/>
<HostStatusPanel
  prices={(template?.companies ?? []).map((company) => ({ stockId: company.id, name: company.name, symbol: company.symbol, price: live?.prices?.[company.id]?.price ?? company.initialPrice, basePrice: company.initialPrice }))}
  lastTickAtMillis={lastTickAtMillis}
  hostingSinceMillis={hostingSinceMillis}
  nowMillis={nowMillis}
/>
```

- [x] **Step 15: Typecheck and run the full suite**

Run: `npm run typecheck && npm test`
Expected: both PASS. If typecheck flags an unused import in `HostConsole.tsx`, remove it.

- [x] **Step 16: Manual smoke check**

Run: `npm run dev`, sign in as a teacher, open a market's host console (`/teacher/markets/:id/host`), and confirm the phase band and price table both render with live data and no console errors.

- [x] **Step 17: Commit**

```bash
git add src/components/teacher/PhaseBand.tsx src/components/teacher/PhaseBand.test.tsx src/components/teacher/HostStatusPanel.tsx src/components/teacher/HostStatusPanel.test.tsx src/components/HostConsole.tsx
git commit -m "refactor: extract PhaseBand and trim HostStatusPanel to the price table"
```

---

### Task 2: Extract MarketControlPanel from HostConsole

**Files:**
- Create: `src/components/teacher/MarketControlPanel.tsx`
- Create: `src/components/teacher/MarketControlPanel.test.tsx`
- Modify: `src/components/HostConsole.tsx` (imports + the "MARKET CONTROL" card)

**Interfaces:**
- Produces: `MarketControlPanel({ lease: string; marketStatus: MarketStatus; endingConfirm: boolean; ending: boolean; onTakeLease: () => void; onOpenMarket: () => void; onRequestEnd: () => void; onCancelEnd: () => void; onConfirmEnd: () => void })` from `src/components/teacher/MarketControlPanel.tsx`.
- Consumes: `MarketStatus` from `src/lib/market/liveMarketTypes.ts`.

- [x] **Step 1: Write the failing test**

```tsx
// src/components/teacher/MarketControlPanel.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MarketControlPanel } from './MarketControlPanel'

const baseProps = {
  lease: '',
  marketStatus: 'SETUP' as const,
  endingConfirm: false,
  ending: false,
  onTakeLease: vi.fn(),
  onOpenMarket: vi.fn(),
  onRequestEnd: vi.fn(),
  onCancelEnd: vi.fn(),
  onConfirmEnd: vi.fn(),
}

describe('MarketControlPanel', () => {
  it('offers to take the lease when nobody is hosting yet', async () => {
    const onTakeLease = vi.fn()
    render(<MarketControlPanel {...baseProps} onTakeLease={onTakeLease} />)
    await userEvent.click(screen.getByRole('button', { name: 'ホストを取得する' }))
    expect(onTakeLease).toHaveBeenCalled()
  })

  it('offers to open and end the market once this device holds the lease', async () => {
    const onOpenMarket = vi.fn(), onRequestEnd = vi.fn()
    render(<MarketControlPanel {...baseProps} lease="lease-1" marketStatus="OPEN" onOpenMarket={onOpenMarket} onRequestEnd={onRequestEnd} />)
    await userEvent.click(screen.getByRole('button', { name: '市場を開始' }))
    expect(onOpenMarket).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '市場を終了' }))
    expect(onRequestEnd).toHaveBeenCalled()
  })

  it('asks for confirmation before ending the market', async () => {
    const onConfirmEnd = vi.fn(), onCancelEnd = vi.fn()
    render(<MarketControlPanel {...baseProps} lease="lease-1" marketStatus="OPEN" endingConfirm onConfirmEnd={onConfirmEnd} onCancelEnd={onCancelEnd} />)
    expect(screen.getByText(/結果が確定して元に戻せません/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '終了して結果を確定する' }))
    expect(onConfirmEnd).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'やめる' }))
    expect(onCancelEnd).toHaveBeenCalled()
  })

  it('does not offer to take the lease once the market has ended', () => {
    render(<MarketControlPanel {...baseProps} marketStatus="ENDED" />)
    expect(screen.queryByRole('button', { name: 'ホストを取得する' })).not.toBeInTheDocument()
    expect(screen.getByText('市場は終了しました')).toBeInTheDocument()
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/teacher/MarketControlPanel.test.tsx`
Expected: FAIL with "Failed to resolve import" (`./MarketControlPanel` does not exist yet).

- [x] **Step 3: Write MarketControlPanel**

```tsx
// src/components/teacher/MarketControlPanel.tsx
import { Box, Button, Card, CardContent, Divider, Paper, Stack, Typography } from '@mui/material'
import type { MarketStatus } from '../../lib/market/liveMarketTypes'

export interface MarketControlPanelProps {
  lease: string
  marketStatus: MarketStatus
  endingConfirm: boolean
  ending: boolean
  onTakeLease: () => void
  onOpenMarket: () => void
  onRequestEnd: () => void
  onCancelEnd: () => void
  onConfirmEnd: () => void
}

export function MarketControlPanel({ lease, marketStatus, endingConfirm, ending, onTakeLease, onOpenMarket, onRequestEnd, onCancelEnd, onConfirmEnd }: MarketControlPanelProps) {
  return (
    <Card component="section">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="overline" color="text.secondary">MARKET CONTROL</Typography>
          <Typography component="h2" variant="h4">{lease ? '市場を進行できます' : marketStatus === 'ENDED' ? '市場は終了しました' : 'この端末で市場を管理する'}</Typography>
          <Typography color="text.secondary">{lease ? '市場の開始・終了やニュース配信を行えます。画面を閉じるとホスト権限は自動的に解放されます。' : marketStatus === 'ENDED' ? '結果は確定しています。この画面でホストを再取得する必要はありません。' : '最初にホスト権限を取得してください。ほかの端末が操作中の場合は取得できません。'}</Typography>
          <Divider />
          {!lease
            ? (marketStatus === 'ENDED' ? null : <Button variant="contained" sx={{ alignSelf: 'flex-start' }} onClick={onTakeLease}>ホストを取得する</Button>)
            : <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
                <Button variant="contained" onClick={onOpenMarket}>市場を開始</Button>
                {!endingConfirm
                  ? <Button variant="outlined" color="error" onClick={onRequestEnd}>市場を終了</Button>
                  : <Paper variant="outlined" sx={{ p: 2, width: '100%' }}>
                      <Stack spacing={1.5}>
                        <Typography><Box component="strong">市場を終了すると、結果が確定して元に戻せません。</Box> 生徒はこれ以上売買できなくなります。</Typography>
                        <Stack direction="row" spacing={1}>
                          <Button color="error" variant="contained" disabled={ending} onClick={onConfirmEnd}>{ending ? '処理中…' : '終了して結果を確定する'}</Button>
                          <Button variant="outlined" disabled={ending} onClick={onCancelEnd}>やめる</Button>
                        </Stack>
                      </Stack>
                    </Paper>}
              </Stack>}
        </Stack>
      </CardContent>
    </Card>
  )
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/teacher/MarketControlPanel.test.tsx`
Expected: PASS (4 tests)

- [x] **Step 5: Wire it into HostConsole**

In `src/components/HostConsole.tsx`, add:

```tsx
import { MarketControlPanel } from './teacher/MarketControlPanel'
```

Replace the entire `<Card component="section" sx={{ flex: 1 }}><CardContent><Stack spacing={2}><Typography variant="overline" color="text.secondary">MARKET CONTROL</Typography>...</Stack></CardContent></Card>` block (the first of the two cards in the `Stack direction={{ xs: 'column', lg: 'row' }}` row) with:

```tsx
<Box sx={{ flex: 1 }}><MarketControlPanel
  lease={lease}
  marketStatus={live?.meta?.status ?? 'SETUP'}
  endingConfirm={endingConfirm}
  ending={ending}
  onTakeLease={() => void takeLease().catch((error) => setNotice(handleFailure(error, 'ホストを取得できませんでした。')))}
  onOpenMarket={() => void openMarket(services.database, marketId, user.uid, lease).then(() => setNotice('市場を開始しました。')).catch((error) => setNotice(handleFailure(error, '開始できません。準備中の市場か確認してください。')))}
  onRequestEnd={() => setEndingConfirm(true)}
  onCancelEnd={() => setEndingConfirm(false)}
  onConfirmEnd={() => { setEnding(true); void requestMarketEnding(services.database, marketId, user.uid, lease).then((result) => { setNotice(result.committed ? '終了処理を開始しました。完了まで再試行します。' : '終了処理を開始できません。市場が取引中で、この端末がホストであることを確認してください。'); setEnding(false); setEndingConfirm(!result.committed) }).catch((error) => { setNotice(handleFailure(error, '終了処理を開始できません。もう一度お試しください。')); setEnding(false) })}
/></Box>
```

- [x] **Step 6: Typecheck and run the full suite**

Run: `npm run typecheck && npm test`
Expected: both PASS. Remove any import `tsc` flags as now unused in `HostConsole.tsx` (e.g. `Divider`, `Paper` if nothing else in the file still needs them — check before deleting, since the "MANUAL NEWS" card touched in Task 3 also uses some of these).

- [x] **Step 7: Commit**

```bash
git add src/components/teacher/MarketControlPanel.tsx src/components/teacher/MarketControlPanel.test.tsx src/components/HostConsole.tsx
git commit -m "refactor: extract MarketControlPanel from HostConsole"
```

---

### Task 3: Extract NewsPublishPanel from HostConsole

**Files:**
- Create: `src/components/teacher/NewsPublishPanel.tsx`
- Create: `src/components/teacher/NewsPublishPanel.test.tsx`
- Modify: `src/components/HostConsole.tsx` (imports + the "MANUAL NEWS" card)

**Interfaces:**
- Produces: `NewsPublishPanel({ disabled: boolean; onPublish: (body: string, impactPercent: number) => Promise<void> })` from `src/components/teacher/NewsPublishPanel.tsx`.

- [x] **Step 1: Write the failing test**

```tsx
// src/components/teacher/NewsPublishPanel.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { NewsPublishPanel } from './NewsPublishPanel'

describe('NewsPublishPanel', () => {
  it('publishes the entered news and impact, then clears the form', async () => {
    const onPublish = vi.fn().mockResolvedValue(undefined)
    render(<NewsPublishPanel disabled={false} onPublish={onPublish} />)
    await userEvent.type(screen.getByLabelText('ニュース本文'), '新商品が発表された')
    await userEvent.click(screen.getByLabelText('相場への影響'))
    await userEvent.click(await screen.findByRole('option', { name: 'やや上昇（+5%）' }))
    await userEvent.click(screen.getByRole('button', { name: '配信する' }))
    expect(onPublish).toHaveBeenCalledWith('新商品が発表された', 5)
    expect(await screen.findByLabelText('ニュース本文')).toHaveValue('')
  })

  it('keeps the entered text when publishing fails', async () => {
    const onPublish = vi.fn().mockRejectedValue(new Error('boom'))
    render(<NewsPublishPanel disabled={false} onPublish={onPublish} />)
    await userEvent.type(screen.getByLabelText('ニュース本文'), '在庫切れが発生した')
    await userEvent.click(screen.getByRole('button', { name: '配信する' }))
    expect(await screen.findByLabelText('ニュース本文')).toHaveValue('在庫切れが発生した')
  })

  it('disables the form when there is no host lease', () => {
    render(<NewsPublishPanel disabled onPublish={vi.fn()} />)
    expect(screen.getByLabelText('ニュース本文')).toBeDisabled()
    expect(screen.getByRole('button', { name: '配信する' })).toBeDisabled()
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/teacher/NewsPublishPanel.test.tsx`
Expected: FAIL with "Failed to resolve import" (`./NewsPublishPanel` does not exist yet).

- [x] **Step 3: Write NewsPublishPanel**

```tsx
// src/components/teacher/NewsPublishPanel.tsx
import { useState } from 'react'
import { Button, Card, CardContent, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material'

export interface NewsPublishPanelProps {
  disabled: boolean
  onPublish: (body: string, impactPercent: number) => Promise<void>
}

const IMPACT_OPTIONS = [
  { value: 0, label: '影響なし（お知らせだけ）' },
  { value: 5, label: 'やや上昇（+5%）' },
  { value: 10, label: '大きく上昇（+10%）' },
  { value: -5, label: 'やや下落（-5%）' },
  { value: -10, label: '大きく下落（-10%）' },
]

export function NewsPublishPanel({ disabled, onPublish }: NewsPublishPanelProps) {
  const [news, setNews] = useState('')
  const [impact, setImpact] = useState(0)
  const send = () => { void onPublish(news, impact).then(() => { setNews(''); setImpact(0) }, () => {}) }
  return (
    <Card component="aside">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="overline" color="text.secondary">MANUAL NEWS</Typography>
          <Typography component="h2" variant="h4">ニュースを配信</Typography>
          <Typography color="text.secondary">授業中の出来事を市場へ届けます。</Typography>
          <TextField label="ニュース本文" value={news} multiline minRows={4} placeholder="例: 新商品の発表で期待が高まる" onChange={(event) => setNews(event.target.value)} disabled={disabled} fullWidth />
          <FormControl fullWidth disabled={disabled}>
            <InputLabel id="news-impact-label">相場への影響</InputLabel>
            <Select labelId="news-impact-label" label="相場への影響" value={impact} onChange={(event) => setImpact(Number(event.target.value))}>
              {IMPACT_OPTIONS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
            </Select>
          </FormControl>
          <Button variant="contained" disabled={disabled || !news.trim()} onClick={send}>配信する</Button>
        </Stack>
      </CardContent>
    </Card>
  )
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/teacher/NewsPublishPanel.test.tsx`
Expected: PASS (3 tests)

- [x] **Step 5: Wire it into HostConsole**

In `src/components/HostConsole.tsx`, add:

```tsx
import { NewsPublishPanel } from './teacher/NewsPublishPanel'
```

Replace the entire `<Card component="aside" sx={{ flex: 1 }}><CardContent><Stack spacing={2}><Typography variant="overline" color="text.secondary">MANUAL NEWS</Typography>...</Stack></CardContent></Card>` block with:

```tsx
<Box sx={{ flex: 1 }}><NewsPublishPanel
  disabled={!lease}
  onPublish={(body, impactPercent) => publishManualNews(services.database, marketId, user.uid, lease, body, impactPercent)
    .then(() => setNotice('ニュースを配信しました。'))
    .catch((error) => { setNotice(handleFailure(error, 'ニュースを配信できません。市場が取引中か確認してください。')); throw error })}
/></Box>
```

Remove the now-unused `news`/`impact` state declarations (`const [news, setNews] = useState('')`, `const [impact, setImpact] = useState(0)`) from `HostConsole`.

- [x] **Step 6: Typecheck and run the full suite**

Run: `npm run typecheck && npm test`
Expected: both PASS. Remove any imports `tsc` now flags as unused in `HostConsole.tsx` (likely `TextField`, `FormControl`, `InputLabel`, `MenuItem`, `Select` are fully moved out).

- [x] **Step 7: Manual smoke check**

Run: `npm run dev`, acquire the host lease on a test market, publish a news item from the extracted panel, and confirm the form clears and the notice appears.

- [x] **Step 8: Commit**

```bash
git add src/components/teacher/NewsPublishPanel.tsx src/components/teacher/NewsPublishPanel.test.tsx src/components/HostConsole.tsx
git commit -m "refactor: extract NewsPublishPanel from HostConsole"
```

---

### Task 4: Create SignageLinkPanel

**Files:**
- Create: `src/components/teacher/SignageLinkPanel.tsx`
- Create: `src/components/teacher/SignageLinkPanel.test.tsx`

**Interfaces:**
- Produces: `SignageLinkPanel({ marketId: string })` from `src/components/teacher/SignageLinkPanel.tsx`. Not wired into any page yet — Task 6 wires it into the new Control Room's "教室画面" tab.

- [x] **Step 1: Write the failing test**

```tsx
// src/components/teacher/SignageLinkPanel.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SignageLinkPanel } from './SignageLinkPanel'

describe('SignageLinkPanel', () => {
  it('links to the classroom screen for this market in a new tab', () => {
    render(<SignageLinkPanel marketId="market-123" />)
    const link = screen.getByRole('link', { name: '教室画面を別タブで開く' })
    expect(link).toHaveAttribute('href', '/markets/market-123/signage')
    expect(link).toHaveAttribute('target', '_blank')
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/teacher/SignageLinkPanel.test.tsx`
Expected: FAIL with "Failed to resolve import" (`./SignageLinkPanel` does not exist yet).

- [x] **Step 3: Write SignageLinkPanel**

```tsx
// src/components/teacher/SignageLinkPanel.tsx
import PresentToAllOutlined from '@mui/icons-material/PresentToAllOutlined'
import { Button, Card, CardContent, Stack, Typography } from '@mui/material'

export interface SignageLinkPanelProps { marketId: string }

export function SignageLinkPanel({ marketId }: SignageLinkPanelProps) {
  return (
    <Card component="section">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="overline" color="text.secondary">CLASSROOM SCREEN</Typography>
          <Typography component="h2" variant="h4">教室画面を表示する</Typography>
          <Typography color="text.secondary">プロジェクターやテレビにつないだ端末で開くと、価格・ニュース・順位が自動更新されます。この画面はコントロールルームとは別のタブで開いてください。</Typography>
          <Button component="a" href={`/markets/${marketId}/signage`} target="_blank" rel="noopener" variant="contained" startIcon={<PresentToAllOutlined />} sx={{ alignSelf: 'flex-start' }}>教室画面を別タブで開く</Button>
        </Stack>
      </CardContent>
    </Card>
  )
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/teacher/SignageLinkPanel.test.tsx`
Expected: PASS (1 test)

- [x] **Step 5: Commit**

```bash
git add src/components/teacher/SignageLinkPanel.tsx src/components/teacher/SignageLinkPanel.test.tsx
git commit -m "feat: add SignageLinkPanel for the control room's classroom-screen tab"
```

---

### Task 5: Rename the host route to /room and restructure the sidebar

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx` (add a redirect test)
- Modify: `src/components/teacher/TeacherShell.tsx`
- Modify: `src/components/teacher/TeacherShell.test.tsx`

**Interfaces:**
- Produces: route `/teacher/markets/:marketId/room` (renders the still-named `HostConsole`, unchanged this task); route `/teacher/markets/:marketId/host` now redirects to `/room` preserving query string and hash.
- Produces: `TeacherArea` type narrows from `'markets' | 'templates' | 'host'` to `'markets' | 'templates' | 'room'` — this is a breaking change to `TeacherShell`'s `active` prop that Task 6 must also account for (it currently isn't set anywhere else, so this task's own `App.tsx` edit is the only caller to update).

- [x] **Step 1: Write the failing TeacherShell tests**

Replace the entire contents of `src/components/teacher/TeacherShell.test.tsx`:

```tsx
// src/components/teacher/TeacherShell.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { TeacherShell } from './TeacherShell'

const renderShell = (marketId?: string) => render(
  <MemoryRouter>
    <TeacherShell active="markets" marketId={marketId}><main>内容</main></TeacherShell>
  </MemoryRouter>,
)

describe('TeacherShell market navigation', () => {
  it('disables the control room and classroom screen links until a market is selected', () => {
    renderShell()
    const controlRoom = screen.getByRole('button', { name: 'コントロールルーム' })
    expect(controlRoom).toBeDisabled()
    expect(controlRoom).toHaveAttribute('aria-describedby', 'room-navigation-help')
    expect(screen.queryByRole('link', { name: 'コントロールルーム' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '教室画面' })).toBeDisabled()
  })

  it('links to the selected market control room and classroom screen', () => {
    renderShell('market-123')
    expect(screen.getByRole('link', { name: 'コントロールルーム' })).toHaveAttribute('href', '/teacher/markets/market-123/room')
    expect(screen.getByRole('link', { name: '教室画面' })).toHaveAttribute('href', '/markets/market-123/signage')
  })

  it('no longer exposes the removed placeholder navigation items', () => {
    renderShell('market-123')
    expect(screen.queryByText('シナリオ・ニュース予約')).not.toBeInTheDocument()
    expect(screen.queryByText('MCコントロール')).not.toBeInTheDocument()
    expect(screen.queryByText('ID発行・ステータス')).not.toBeInTheDocument()
    expect(screen.queryByText('参加承認・参加者')).not.toBeInTheDocument()
    expect(screen.queryByText('情報照会端末')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/teacher/TeacherShell.test.tsx`
Expected: FAIL — no element with role `button`/`link` named `コントロールルーム` exists yet (the current sidebar has `シナリオ・ニュース予約`, `MCコントロール`, etc. instead).

- [x] **Step 3: Rewrite TeacherShell**

Replace the entire contents of `src/components/teacher/TeacherShell.tsx`:

```tsx
// src/components/teacher/TeacherShell.tsx
import type { ReactNode } from 'react'
import { Avatar, Box, ButtonBase, Divider, ListItemButton, ListItemIcon, ListItemText, Paper, Stack, Typography } from '@mui/material'
import { NavLink, Link as RouterLink } from 'react-router'

type TeacherArea = 'markets' | 'templates' | 'room'
type SidebarIcon = TeacherArea | 'guide' | 'home' | 'screen'

interface TeacherShellProps {
  active: TeacherArea
  children: ReactNode
  email?: string | null
  marketId?: string
  onShowGuide?: () => void
}

const Icon = ({ name }: { name: SidebarIcon }) => {
  const paths = {
    home: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v10h13V10M9 20v-6h6v6" /></>,
    markets: <><path d="M4 19V9m5 10V5m5 14v-7m5 7V3" /><path d="M2 19h20" /></>,
    templates: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    room: <><path d="M4 6h16v11H4z" /><path d="M8 21h8M12 17v4" /><path d="m8 12 2.5-2.5L13 12l3-3" /></>,
    guide: <><circle cx="12" cy="12" r="9" /><path d="M9.7 9a2.4 2.4 0 0 1 4.6 1c0 1.7-2.3 2-2.3 3.5M12 17h.01" /></>,
    screen: <><rect x="3" y="5" width="18" height="13" rx="2" /><path d="M8 21h8M12 18v3" /></>,
  }
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

export const TeacherShell = ({ active, children, email, marketId, onShowGuide }: TeacherShellProps) => {
  const itemSx = { minHeight: 44, px: 1.5, borderRadius: 2.5, gap: 1.5, color: 'text.secondary', '&.active, &.Mui-selected': { color: 'primary.dark', bgcolor: 'primary.light' }, '&:hover': { bgcolor: 'action.hover', color: 'text.primary' }, '&.Mui-disabled': { opacity: 0.46 } }
  const iconSx = { minWidth: 0, color: 'inherit', '& svg': { width: 20, height: 20 } }
  const item = (label: string, icon: SidebarIcon) => <><ListItemIcon sx={iconSx}><Icon name={icon} /></ListItemIcon><ListItemText primary={label} slotProps={{ primary: { sx: { fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' } } }} /></>
  const disabledItem = (label: string, icon: SidebarIcon) => <ListItemButton component="button" type="button" disabled title="市場を選択すると使えます" aria-describedby="room-navigation-help" sx={itemSx}>{item(label, icon)}</ListItemButton>
  return <Box className="teacher-shell">
    <Paper component="aside" className="teacher-sidebar" square elevation={0} sx={{ bgcolor: 'background.paper', color: 'text.primary', borderColor: 'divider' }}>
      <ButtonBase component={RouterLink} to="/" className="sidebar-brand" aria-label="Stock League Classroom ホーム" sx={{ justifyContent: 'flex-start', minHeight: 56 }}><Avatar variant="rounded" sx={{ width: 32, height: 32, bgcolor: 'transparent', color: 'primary.main', fontSize: 25, fontWeight: 800 }}>▦</Avatar><Box component="strong">株価にドキリ！<Box component="small" sx={{ display: 'block', color: 'text.secondary' }}>Stock League Classroom</Box></Box></ButtonBase>
      <Divider sx={{ my: 1.5 }} />
      <Box component="nav" aria-label="教師メニュー" sx={{ display: 'grid', gap: 0.5 }}>
        <Typography className="sidebar-group-label" variant="caption">市場を準備する</Typography>
        <ListItemButton component={NavLink} to="/teacher/markets" selected={active === 'markets'} className={active === 'markets' ? 'active' : ''} sx={itemSx}>{item('市場の管理', 'markets')}</ListItemButton>
        <ListItemButton component={NavLink} to="/templates" selected={active === 'templates'} className={active === 'templates' ? 'active' : ''} sx={itemSx}>{item('テンプレート', 'templates')}</ListItemButton>
        <Typography className="sidebar-group-label" variant="caption">この市場を進行する</Typography>
        {marketId
          ? <ListItemButton component={NavLink} to={`/teacher/markets/${marketId}/room`} selected={active === 'room'} className={active === 'room' ? 'active' : ''} sx={itemSx}>{item('コントロールルーム', 'room')}</ListItemButton>
          : disabledItem('コントロールルーム', 'room')}
        {marketId ? <ListItemButton component={NavLink} to={`/markets/${marketId}/signage`} sx={itemSx}>{item('教室画面', 'screen')}</ListItemButton> : disabledItem('教室画面', 'screen')}
        {!marketId && <span id="room-navigation-help" className="visually-hidden">先に作成済み市場を選択してください。</span>}
        <Typography className="sidebar-group-label" variant="caption">サポート</Typography>
        {onShowGuide ? <ListItemButton onClick={onShowGuide} sx={itemSx}>{item('使い方を見る', 'guide')}</ListItemButton> : <ListItemButton component={RouterLink} to="/guide" sx={itemSx}>{item('使い方を見る', 'guide')}</ListItemButton>}
      </Box>
      <Stack className="sidebar-bottom" spacing={0.5}>
        <Divider sx={{ mb: 1 }} />
        <ListItemButton component={RouterLink} to="/" sx={itemSx}>{item('トップへ戻る', 'home')}</ListItemButton>
        {email && <Stack className="sidebar-account" direction="row" spacing={1.25} sx={{ alignItems: 'center', mt: 1.5, px: 1 }}><Avatar sx={{ width: 32, height: 32, bgcolor: 'secondary.main', fontSize: 13 }}>{email.slice(0, 1).toUpperCase()}</Avatar><Box sx={{ minWidth: 0 }}><Typography variant="caption" sx={{ display: 'block', fontWeight: 700 }}>教師アカウント</Typography><Typography variant="caption" color="text.secondary" noWrap>{email}</Typography></Box></Stack>}
      </Stack>
    </Paper>
    <Box className="teacher-shell-content">{children}</Box>
  </Box>
}

export interface ProgressStep { label: string; detail?: string }
export const SetupProgress = ({ steps, current, label = '進行状況' }: { steps: ProgressStep[]; current: number; label?: string }) => <section className="setup-progress" aria-label={label}>
  <div className="progress-caption"><span>{label}</span><strong>{Math.min(current + 1, steps.length)} / {steps.length}</strong></div>
  <ol>{steps.map((step, index) => {
    const state = index < current ? 'complete' : index === current ? 'current' : ''
    return <li className={state} key={step.label} aria-current={index === current ? 'step' : undefined}>
      <span className="progress-dot">{index < current ? '✓' : index + 1}</span>
      <div><strong>{step.label}</strong>{step.detail && <small>{step.detail}</small>}</div>
    </li>
  })}</ol>
</section>

export const AuthLoadingScreen = () => <main className="auth-loading" aria-busy="true" aria-label="ログイン状態を確認しています">
  <div className="auth-loading-mark">SL</div><div className="auth-loading-line" /><p>教室を準備しています</p>
</main>
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/teacher/TeacherShell.test.tsx`
Expected: PASS (3 tests)

- [x] **Step 5: Write the failing App.tsx redirect test**

Add to `src/App.test.tsx`, inside the existing `describe('App', ...)` block:

```tsx
  it('redirects the legacy host console URL to the control room, keeping the query string', () => {
    window.history.pushState({}, '', '/teacher/markets/demo-market/host?tab=news')
    render(<App />)
    expect(window.location.pathname).toBe('/teacher/markets/demo-market/room')
    expect(window.location.search).toBe('?tab=news')
    window.history.pushState({}, '', '/')
  })
```

- [x] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/App.test.tsx`
Expected: FAIL — the route `/teacher/markets/:marketId/host` currently renders `HostRoute` directly instead of redirecting.

- [x] **Step 7: Update App.tsx**

In `src/App.tsx`, replace:

```tsx
const HostRoute = () => {
  const marketId = useParams().marketId ?? ''
  return <TeacherShell active="host" marketId={marketId}><HostConsole marketId={marketId} /></TeacherShell>
}
```

with:

```tsx
const RoomRoute = () => {
  const marketId = useParams().marketId ?? ''
  return <TeacherShell active="room" marketId={marketId}><HostConsole marketId={marketId} /></TeacherShell>
}
/** Keeps old links (bookmarks, printed handouts) working after the host console was renamed to the control room. */
const HostRouteRedirect = () => {
  const marketId = useParams().marketId ?? ''
  const { search, hash } = useLocation()
  return <Navigate replace to={`/teacher/markets/${marketId}/room${search}${hash}`} />
}
```

Replace:

```tsx
  <Route path="/teacher/markets/:marketId/host" element={<HostRoute />} />
```

with:

```tsx
  <Route path="/teacher/markets/:marketId/room" element={<RoomRoute />} />
  <Route path="/teacher/markets/:marketId/host" element={<HostRouteRedirect />} />
```

- [x] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/App.test.tsx`
Expected: PASS

- [x] **Step 9: Run the full suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: both PASS.

- [x] **Step 10: Commit**

```bash
git add src/App.tsx src/App.test.tsx src/components/teacher/TeacherShell.tsx src/components/teacher/TeacherShell.test.tsx
git commit -m "refactor: rename the host console route to /room and give it an honest sidebar"
```

---

### Task 6: Assemble the tabbed Control Room and retire HostConsole

**Files:**
- Create: `src/components/teacher/ControlRoom.tsx` (full replacement for `src/components/HostConsole.tsx`, moved into the `teacher/` folder)
- Delete: `src/components/HostConsole.tsx`
- Modify: `src/App.tsx` (import path + element)

**Interfaces:**
- Produces: `ControlRoom({ marketId: string })` — same public contract as the old `HostConsole`, now rendering four tabs (参加受付/進行操作/ニュース配信/教室画面) instead of one long scrolling page. The selected tab is persisted in the `?tab=` query parameter so a reload keeps the teacher's place.
- Consumes: `AdmissionPanel` (`./AdmissionPanel`), `PhaseBand` (`./PhaseBand`), `HostStatusPanel` (`./HostStatusPanel`), `MarketControlPanel` (`./MarketControlPanel`), `NewsPublishPanel` (`./NewsPublishPanel`), `SignageLinkPanel` (`./SignageLinkPanel`) — all already built in Tasks 1–4, all now siblings under `src/components/teacher/`.

This task has no new automated test (per the Global Constraints note — `ControlRoom` is Firebase-coupled the same way `HostConsole` always was, and none of the components it assembles change behavior here, only their container). Verification is the manual smoke check in Step 4.

- [ ] **Step 1: Create the new file**

```tsx
// src/components/teacher/ControlRoom.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { onValue, ref } from 'firebase/database'
import { useSearchParams } from 'react-router'
import { bootstrapFirebase } from '../../lib/firebase/bootstrap'
import { isTeacherIdentity } from '../../lib/auth/roles'
import { acquireHostLease, armHostLeaseDisconnect, openMarket, publishManualNews, requestMarketEnding, runHostTick } from '../../lib/market/hostTrading'
import { serverNow } from '../../lib/firebase/serverTime'
import { AdmissionPanel } from './AdmissionPanel'
import { PhaseBand } from './PhaseBand'
import { HostStatusPanel } from './HostStatusPanel'
import { MarketControlPanel } from './MarketControlPanel'
import { NewsPublishPanel } from './NewsPublishPanel'
import { SignageLinkPanel } from './SignageLinkPanel'
import { approveJoinRequest, reassignParticipantTeam, rejectJoinRequest, removeParticipant, resolveRecoveryTeamId, setAutoApprove } from '../../lib/market/marketRepository'
import type { LiveMarketState, TeamAssignmentMode } from '../../lib/market/liveMarketTypes'
import type { TemplateSpec } from '../../lib/templates/types'
import { useDatabaseOffline } from '../../lib/firebase/connectionState'
import { useHostInterruption, useUnloadWarning, useWakeLock } from '../../lib/host/hostContinuity'
import { handleFailure } from '../../lib/monitoring/describeError'
import { AppVersion } from '../AppVersion'
import { AuthLoadingScreen } from './TeacherShell'
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Link,
  Stack,
  Tab,
  Tabs,
  Toolbar,
  Typography,
} from '@mui/material'

type MarketAccess = 'loading' | 'ready' | 'not-found' | 'forbidden' | 'read-error'
type ControlRoomTab = 'admission' | 'control' | 'news' | 'signage'
const TAB_ORDER: ControlRoomTab[] = ['admission', 'control', 'news', 'signage']
const TAB_LABEL: Record<ControlRoomTab, string> = { admission: '参加受付', control: '進行操作', news: 'ニュース配信', signage: '教室画面' }
const isControlRoomTab = (value: string | null): value is ControlRoomTab => TAB_ORDER.includes(value as ControlRoomTab)

const MarketAccessState = ({ state }: { state: Exclude<MarketAccess, 'ready'> }) => {
  const content = state === 'loading'
    ? { title: '市場を確認しています', detail: '市場の設定とアクセス権を読み込んでいます。' }
    : state === 'not-found'
      ? { title: 'この市場は見つかりません', detail: '削除されたか、URLが正しくない可能性があります。' }
      : state === 'forbidden'
        ? { title: 'この市場を進行する権限がありません', detail: '市場を作成した教師アカウントでログインしているか確認してください。' }
        : { title: '市場を読み込めません', detail: '通信状態を確認してから、もう一度お試しください。' }
  return <Container component="main" maxWidth="md" sx={{ py: 8 }}><Stack spacing={2} sx={{ alignItems: 'flex-start', maxWidth: 520 }}>
    {state === 'loading' && <CircularProgress aria-label="市場を読み込んでいます" />}
    <Typography component="h1" variant="h2">{content.title}</Typography>
    <Typography color="text.secondary">{content.detail}</Typography>
    {state !== 'loading' && <Alert severity={state === 'read-error' ? 'warning' : 'info'}>{content.detail}</Alert>}
    {state !== 'loading' && <Button variant="contained" href="/teacher/markets">市場の管理へ戻る</Button>}
  </Stack></Container>
}

const leaseId = () => crypto.randomUUID()
export const ControlRoom = ({ marketId }: { marketId: string }) => {
  const services = bootstrapFirebase(); const [user, setUser] = useState<User | null>(services.auth.currentUser)
  const [authReady, setAuthReady] = useState(false)
  const [marketAccess, setMarketAccess] = useState<MarketAccess>('loading')
  const [lease, setLease] = useState(''); const [notice, setNotice] = useState(''); const [template, setTemplate] = useState<TemplateSpec | null>(null)
  const [live, setLive] = useState<LiveMarketState | null>(null)
  const [mode, setMode] = useState<TeamAssignmentMode>('random')
  const [nowMillis, setNowMillis] = useState(() => serverNow())
  const [lastTickAtMillis, setLastTickAtMillis] = useState<number>()
  const [hostingSinceMillis, setHostingSinceMillis] = useState<number>()
  const [endingConfirm, setEndingConfirm] = useState(false); const [ending, setEnding] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const liveRef = useRef<LiveMarketState | null>(null)
  const autoApproving = useRef(false)
  useEffect(() => { liveRef.current = live }, [live])
  useEffect(() => { const timer = window.setInterval(() => setNowMillis(serverNow()), 1_000); return () => window.clearInterval(timer) }, [])
  const interruption = useHostInterruption(Boolean(lease))
  useWakeLock(Boolean(lease))
  useUnloadWarning(Boolean(lease))
  const offline = useDatabaseOffline(services.database)
  useEffect(() => onAuthStateChanged(services.auth, (next) => { setUser(next); setAuthReady(true) }), [services.auth])
  useEffect(() => {
    if (!authReady || !user || !isTeacherIdentity(user)) return
    let active = true
    setMarketAccess('loading')
    void getDoc(doc(services.firestore, 'markets', marketId)).then((snapshot) => {
      if (!active) return
      if (!snapshot.exists()) { setMarketAccess('not-found'); return }
      const nextTemplate = snapshot.data()?.templateSnapshot as TemplateSpec | undefined
      if (!nextTemplate) { setMarketAccess('read-error'); return }
      setTemplate(nextTemplate)
      setMarketAccess('ready')
    }).catch((error: unknown) => {
      if (!active) return
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      setMarketAccess(code.includes('permission-denied') ? 'forbidden' : 'read-error')
    })
    return () => { active = false }
  }, [authReady, marketId, services.firestore, user])
  useEffect(() => {
    if (!authReady || !user || !isTeacherIdentity(user) || marketAccess !== 'ready') return
    return onValue(ref(services.database, `liveMarkets/${marketId}`),
      (snapshot) => {
        const value = snapshot.val() as LiveMarketState | null
        if (!value) { setMarketAccess('read-error'); return }
        setLive(value)
      },
      (error) => {
        const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
        setMarketAccess(code.includes('permission-denied') ? 'forbidden' : 'read-error')
      })
  }, [authReady, marketAccess, marketId, services.database, user])
  const stocks = useMemo(() => (template?.companies ?? []).map((company) => ({ id: company.id, basePrice: company.initialPrice, phases: company.pricePhases })), [template])
  const pendingRequests = useMemo(() => Object.entries(live?.joinRequests ?? {}).filter(([id, request]) => request.connected && !live?.participants?.[id]).map(([id, request]) => ({ id, displayName: request.displayName, requestedTeamId: request.requestedTeamId, recoveryTeamId: resolveRecoveryTeamId(live, request) })), [live])
  const autoApprove = Boolean(live?.meta?.autoApprove)
  useEffect(() => {
    if (!autoApprove || !pendingRequests.length || autoApproving.current || !user) return
    autoApproving.current = true
    void Promise.all(pendingRequests.map((request) => approveJoinRequest(services.database, marketId, request.id, mode)))
      .then((results) => setNotice(`${results.filter(Boolean).length}人を自動承認しました。`))
      .catch((error) => setNotice(handleFailure(error, '自動承認に失敗しました。')))
      .finally(() => { autoApproving.current = false })
  }, [autoApprove, marketId, mode, pendingRequests, services.database, user])
  useEffect(() => {
    if (!lease || !user || !template) return
    const tick = () => void runHostTick(services.firestore, services.database, marketId, user.uid, lease, stocks)
      .then((ok) => { if (ok) setLastTickAtMillis(serverNow()); else { setLease(''); setLastTickAtMillis(undefined); setHostingSinceMillis(undefined); setNotice(liveRef.current?.meta?.status === 'ENDED' ? '終了処理が完了しました。結果は確定しています。' : 'ホストの権限が外れました。もう一度「ホストを取得する」を押してください。') } })
      .catch((error) => setNotice(handleFailure(error, 'ホスト処理を再試行しています。')))
    tick(); const timer = window.setInterval(tick, 1_000); return () => window.clearInterval(timer)
  }, [lease, marketId, services.database, services.firestore, stocks, template, user])
  if (!authReady) return <AuthLoadingScreen />
  if (!user || !isTeacherIdentity(user)) return <Container component="main" maxWidth="md" sx={{ py: 8 }}><Stack spacing={3} sx={{ alignItems: 'flex-start', maxWidth: 600 }}><Link href="/teacher/markets" underline="hover">← Stock League Classroom</Link><Box><Typography variant="overline" color="text.secondary">CONTROL ROOM</Typography><Typography component="h1" variant="h2" sx={{ mt: 1 }}>市場を進行する</Typography><Typography color="text.secondary" sx={{ mt: 1 }}>市場を開始・終了したり、授業中のニュースを配信するには教師としてログインしてください。</Typography></Box><Button variant="contained" href="/teacher/markets">教師としてログイン</Button></Stack></Container>
  if (marketAccess !== 'ready') return <MarketAccessState state={marketAccess} />
  const takeLease = async () => { const next = leaseId(); const expiresAtMillis = serverNow() + 15_000; const ok = await acquireHostLease(services.database, marketId, user.uid, next); if (!ok) return setNotice('この市場のホストを取得できません。'); await armHostLeaseDisconnect(services.database, marketId, { ownerUid: user.uid, leaseId: next, expiresAtMillis, paused: false }); setLease(next); setLastTickAtMillis(undefined); setHostingSinceMillis(serverNow()); setNotice('ホストを取得しました。') }
  const participants = Object.entries(live?.participants ?? {}).map(([id, participant]) => ({ id, displayName: participant.displayName, teamId: participant.teamId, connected: participant.connected }))
  const marketStatus = live?.meta?.status ?? 'SETUP'
  const defaultTab: ControlRoomTab = marketStatus === 'SETUP' ? 'admission' : 'control'
  const requestedTab = searchParams.get('tab')
  const activeTab: ControlRoomTab = isControlRoomTab(requestedTab) ? requestedTab : defaultTab
  const selectTab = (tab: ControlRoomTab) => setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set('tab', tab); return next }, { replace: true })
  return <Box component="main" className="host-page" sx={{ pb: 6 }}>
    <AppBar component="header" position="static" color="transparent" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
      <Toolbar component={Container} maxWidth="xl" disableGutters sx={{ gap: 2, px: { xs: 2, sm: 3 } }}>
        <Link href="/teacher/markets" color="inherit" underline="none" variant="h6" sx={{ flexGrow: 1 }}>Stock League Classroom</Link>
        <Button href="/teacher/markets" variant="text">市場の管理へ</Button><AppVersion />
      </Toolbar>
    </AppBar>
    <Container maxWidth="xl" sx={{ pt: { xs: 4, md: 6 } }}>
      <Stack spacing={4}>
        <Stack component="section" direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
          <Box><Typography variant="overline" color="text.secondary">CONTROL ROOM</Typography><Typography component="h1" variant="h2">市場のコントロールルーム</Typography><Typography color="text.secondary">市場ID: <Box component="code">{marketId}</Box></Typography></Box>
          <Chip color={lease ? 'success' : 'default'} variant={lease ? 'filled' : 'outlined'} label={lease ? 'ホスト接続中' : 'ホスト未接続'} />
        </Stack>
        <PhaseBand
          status={marketStatus}
          openedAtMillis={live?.meta?.openedAtMillis}
          nowMillis={nowMillis}
          participantCount={participants.filter((participant) => participant.connected).length}
          capacity={live?.meta?.capacity ?? 80}
          pendingOrderCount={Object.values(live?.orders ?? {}).filter((entry) => entry.pending).length}
        />
        <Stack spacing={2} aria-live="polite">
          {offline && <Alert severity="error"><Typography component="strong" sx={{ fontWeight: 700 }}>サーバーに接続できていません。市場の進行が止まっています。</Typography><br />価格の更新と生徒の売買は処理されていません。通信を確認してください。</Alert>}
          {interruption.message && <Alert severity="warning" action={<Button color="inherit" size="small" onClick={interruption.dismiss}>確認しました</Button>}><Typography component="strong" sx={{ fontWeight: 700 }}>{interruption.message}のあいだ、市場の進行が止まっていた可能性があります。</Typography><br />授業中はこのタブを前面に置いたままにしてください。</Alert>}
          {lease && <Alert severity="info">このタブを閉じたり、別のアプリで隠したり、パソコンをスリープさせると市場が止まります。授業のあいだは開いたままにしてください。</Alert>}
          {notice && <Alert severity="info">{notice}</Alert>}
        </Stack>
        <Box>
          <Tabs value={activeTab} onChange={(_, value: ControlRoomTab) => selectTab(value)} aria-label="コントロールルームのタブ" sx={{ borderBottom: 1, borderColor: 'divider' }}>
            {TAB_ORDER.map((tab) => <Tab key={tab} value={tab} label={TAB_LABEL[tab]} id={`control-room-tab-${tab}`} aria-controls={`control-room-panel-${tab}`} />)}
          </Tabs>
          <Box role="tabpanel" id={`control-room-panel-${activeTab}`} aria-labelledby={`control-room-tab-${activeTab}`} sx={{ pt: 3 }}>
            {activeTab === 'admission' && <AdmissionPanel
              joinCode={live?.meta?.joinCode ?? ''}
              capacity={live?.meta?.capacity ?? 80}
              teams={Object.values(live?.teams ?? {}).map((team) => ({ id: team.id, name: team.name }))}
              requests={pendingRequests}
              participants={participants}
              mode={mode}
              autoApprove={autoApprove}
              onAutoApproveChange={(enabled) => void setAutoApprove(services.database, marketId, enabled).then(() => setNotice(enabled ? '参加申請の自動承認を有効にしました。' : '参加申請の自動承認を無効にしました。')).catch((error) => setNotice(handleFailure(error, '自動承認モードを変更できませんでした。')))}
              onModeChange={setMode}
              onApproveAll={() => void Promise.all(pendingRequests.map((request) => approveJoinRequest(services.database, marketId, request.id, mode))).then((results) => setNotice(`${results.filter(Boolean).length}人を一括承認しました。`)).catch((error) => setNotice(handleFailure(error, '一括承認に失敗しました。')))}
              onCopyJoinCode={() => void navigator.clipboard.writeText(live?.meta?.joinCode ?? '').then(() => setNotice('参加コードをコピーしました。'))}
              joinUrl={`${window.location.origin}/join?code=${encodeURIComponent(live?.meta?.joinCode ?? '')}`}
              onCopyJoinUrl={() => void navigator.clipboard.writeText(`${window.location.origin}/join?code=${encodeURIComponent(live?.meta?.joinCode ?? '')}`).then(() => setNotice('生徒用マジックリンクをコピーしました。'))}
              onApprove={(id, manualTeamId) => void approveJoinRequest(services.database, marketId, id, mode, manualTeamId).then((ok) => setNotice(ok ? '参加を承認しました。' : '承認できませんでした。')).catch((error) => setNotice(handleFailure(error, '参加を承認できませんでした。')))}
              onReject={(id) => void rejectJoinRequest(services.database, marketId, id).then(() => setNotice('申請を却下しました。')).catch((error) => setNotice(handleFailure(error, '申請を却下できませんでした。')))}
              onRemove={(id) => { if (window.confirm('この生徒を市場から退出させますか？チームの資産はそのまま残ります。')) void removeParticipant(services.database, marketId, id).then(() => setNotice('退出させました。')).catch((error) => setNotice(handleFailure(error, '退出させられませんでした。'))) }}
              onReassign={(id, teamId) => void reassignParticipantTeam(services.database, marketId, id, teamId).then((ok) => setNotice(ok ? 'チームを変更しました。' : 'チームを変更できませんでした。')).catch((error) => setNotice(handleFailure(error, 'チームを変更できませんでした。')))}
            />}
            {activeTab === 'control' && <Stack direction={{ xs: 'column', lg: 'row' }} spacing={3} sx={{ alignItems: 'stretch' }}>
              <Box sx={{ flex: 1 }}><MarketControlPanel
                lease={lease}
                marketStatus={marketStatus}
                endingConfirm={endingConfirm}
                ending={ending}
                onTakeLease={() => void takeLease().catch((error) => setNotice(handleFailure(error, 'ホストを取得できませんでした。')))}
                onOpenMarket={() => void openMarket(services.database, marketId, user.uid, lease).then(() => setNotice('市場を開始しました。')).catch((error) => setNotice(handleFailure(error, '開始できません。準備中の市場か確認してください。')))}
                onRequestEnd={() => setEndingConfirm(true)}
                onCancelEnd={() => setEndingConfirm(false)}
                onConfirmEnd={() => { setEnding(true); void requestMarketEnding(services.database, marketId, user.uid, lease).then((result) => { setNotice(result.committed ? '終了処理を開始しました。完了まで再試行します。' : '終了処理を開始できません。市場が取引中で、この端末がホストであることを確認してください。'); setEnding(false); setEndingConfirm(!result.committed) }).catch((error) => { setNotice(handleFailure(error, '終了処理を開始できません。もう一度お試しください。')); setEnding(false) })}
              /></Box>
              <Box sx={{ flex: 1 }}><HostStatusPanel
                prices={(template?.companies ?? []).map((company) => ({ stockId: company.id, name: company.name, symbol: company.symbol, price: live?.prices?.[company.id]?.price ?? company.initialPrice, basePrice: company.initialPrice }))}
                lastTickAtMillis={lastTickAtMillis}
                hostingSinceMillis={hostingSinceMillis}
                nowMillis={nowMillis}
              /></Box>
            </Stack>}
            {activeTab === 'news' && <NewsPublishPanel
              disabled={!lease}
              onPublish={(body, impactPercent) => publishManualNews(services.database, marketId, user.uid, lease, body, impactPercent)
                .then(() => setNotice('ニュースを配信しました。'))
                .catch((error) => { setNotice(handleFailure(error, 'ニュースを配信できません。市場が取引中か確認してください。')); throw error })}
            />}
            {activeTab === 'signage' && <SignageLinkPanel marketId={marketId} />}
          </Box>
        </Box>
      </Stack>
    </Container>
  </Box>
}
```

- [ ] **Step 2: Delete the old file**

```bash
git rm src/components/HostConsole.tsx
```

- [ ] **Step 3: Update App.tsx**

In `src/App.tsx`, replace:

```tsx
import { HostConsole } from './components/HostConsole'
```

with:

```tsx
import { ControlRoom } from './components/teacher/ControlRoom'
```

In `RoomRoute` (added in Task 5), replace `<HostConsole marketId={marketId} />` with `<ControlRoom marketId={marketId} />`.

- [ ] **Step 4: Typecheck, run the full suite, then manually verify the tabs**

Run: `npm run typecheck && npm test`
Expected: both PASS.

Run: `npm run dev`. As a teacher, create a test market, open its control room, and confirm:
- With no participants yet, the room opens on the "参加受付" tab.
- Approving a participant and clicking "市場を開始" from the "進行操作" tab actually opens the market (`live.meta.status` becomes `OPEN` in the Firebase console or emulator UI).
- Reloading the page while on the "ニュース配信" tab keeps that tab selected (because `?tab=news` is in the URL).
- The "教室画面" tab's button opens `/markets/:id/signage` in a new tab.

- [ ] **Step 5: Commit**

```bash
git add src/components/teacher/ControlRoom.tsx src/App.tsx
git commit -m "refactor: assemble the tabbed control room and retire HostConsole"
```

---

### Task 7: Remove the duplicate admission panel from the market dashboard

**Files:**
- Modify: `src/components/MarketDashboard.tsx`

**Interfaces:**
- No new exports. `TeacherMarketDashboard` keeps its existing signature (no props). Participant/join-request management is no longer reachable from this page — only from `ControlRoom`'s "参加受付" tab.

This task has no new automated test, per the Global Constraints note (no `MarketDashboard.test.tsx` exists, for the same Firebase-coupling reason `HostConsole`/`ControlRoom` have none). Verify with typecheck, the full suite, and the manual check in Step 4.

- [ ] **Step 1: Remove the AdmissionPanel-only state, effects and handlers**

In `src/components/MarketDashboard.tsx`, remove:
- The import `import { AdmissionPanel } from './teacher/AdmissionPanel'`.
- From the `approveJoinRequest, listOwnedMarkets, RECOVERY_CODE_LENGTH, reassignParticipantTeam, rejectJoinRequest, removeParticipant, requestToJoinMarket, resolveJoinCode, resolveRecoveryTeamId, setAutoApprove` import list, remove `approveJoinRequest`, `reassignParticipantTeam`, `rejectJoinRequest`, `removeParticipant`, `resolveRecoveryTeamId`, `setAutoApprove` (keep `listOwnedMarkets`, `RECOVERY_CODE_LENGTH`, `requestToJoinMarket`, `resolveJoinCode` — those are used by `StudentMarketJoin`, in the same file).
- The `TeamAssignmentMode` type import (only used by the removed `mode` state) — remove it from the `liveMarketTypes` import list, keeping `LiveMarketState` and `MarketVisibility`.
- `const [mode, setMode] = useState<TeamAssignmentMode>('random')`.
- `const autoApproving = useRef(false)`.
- The `requests`, `participants` (the join-request/participant-derived arrays — not the `markets` list), `teamOptions`, `autoApprove`, and `joinUrl` derived `const`s.
- The `approveAll` function.
- The auto-approve `useEffect` (the one starting `useEffect(() => { if (!autoApprove || !marketId || !requests.length || autoApproving.current) return ...`).

Replace `const activeCount = participants.filter((participant) => participant.connected).length` with:

```tsx
const activeCount = Object.values(state?.participants ?? {}).filter((participant) => participant.connected).length
```

- [ ] **Step 2: Replace the "ACTIVE MARKET" card's admission UI with a single Control Room CTA**

Replace the entire block starting at `{marketId && <Paper component="section" className="active-market-card" ...>` through its matching `</Paper>}` (which currently contains the "市場を進行"/"教室画面" buttons followed by the `<AdmissionPanel ... />` call) with:

```tsx
{marketId && <Paper component="section" className="active-market-card" elevation={0} sx={{ mt: 3, p: { xs: 2, sm: 3 } }}><Stack className="active-head" direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}><Box><Typography className="section-kicker" variant="overline" color="primary">ACTIVE MARKET</Typography><Typography variant="h5">2. 参加受付・進行はコントロールルームで</Typography><Typography color="text.secondary" sx={{ mt: 1 }}>参加コードの共有、参加申請の承認、市場の開始・終了、ニュース配信は、すべてコントロールルームにまとまっています。</Typography></Box><Button variant="contained" size="large" href={`/teacher/markets/${marketId}/room`} startIcon={<PlayCircleOutlined />}>コントロールルームを開く</Button></Stack></Paper>}
```

- [ ] **Step 3: Simplify the per-market history row actions**

Replace `<Button size="small" variant="outlined" type="button" onClick={() => { setMarketId(market.id); setJoinCode(market.joinCode); setState(null) }}>参加を承認</Button><Button size="small" variant="contained" href={`/teacher/markets/${market.id}/host`}>市場を進行</Button>` with:

```tsx
<Button size="small" variant="outlined" type="button" onClick={() => { setMarketId(market.id); setJoinCode(market.joinCode); setState(null) }}>選択</Button><Button size="small" variant="contained" href={`/teacher/markets/${market.id}/room`}>コントロールルームを開く</Button>
```

- [ ] **Step 4: Typecheck, run the full suite, then manually verify**

Run: `npm run typecheck && npm test`
Expected: both PASS. Remove any imports `tsc` flags as now unused.

Run: `npm run dev`, sign in as a teacher, confirm the dashboard's "ACTIVE MARKET" section no longer shows a duplicate participant list, and that "コントロールルームを開く" opens the control room at `/teacher/markets/:id/room?tab=admission`-equivalent behavior (opens on the participants tab while the market is still `SETUP`).

- [ ] **Step 5: Commit**

```bash
git add src/components/MarketDashboard.tsx
git commit -m "refactor: remove the duplicate admission panel from the market dashboard"
```

---

### Task 8: Unify the student-facing phase label

**Files:**
- Modify: `src/components/student/StudentMarketPage.tsx`

**Interfaces:**
- Consumes: `describeStudentPhase` from `src/lib/market/marketStatusLabels.ts` (built in Task 1).

No new automated test (no `StudentMarketPage.test.tsx` exists, for the same Firebase-coupling reason). Verify with typecheck, the full suite, and the manual check in Step 3.

- [ ] **Step 1: Import the shared label helper**

In `src/components/student/StudentMarketPage.tsx`, add:

```tsx
import { describeStudentPhase } from '../../lib/market/marketStatusLabels'
```

- [ ] **Step 2: Replace the raw status text**

Replace:

```tsx
<Chip label={`${teams[participant.teamId ?? '']?.name ?? 'チーム'} ・ ${meta?.status ?? 'CONNECTING'}`} variant="outlined" sx={{ alignSelf: { md: 'center' } }} />
```

with:

```tsx
<Chip label={`${teams[participant.teamId ?? '']?.name ?? 'チーム'} ・ ${describeStudentPhase(meta?.status)}`} variant="outlined" sx={{ alignSelf: { md: 'center' } }} />
```

- [ ] **Step 3: Typecheck, run the full suite, then manually verify**

Run: `npm run typecheck && npm test`
Expected: both PASS.

Run: `npm run dev`, join a test market as a student before the teacher opens it, and confirm the chip reads "接続中" instead of "CONNECTING"; then have the teacher open the market and confirm it updates to "取引中".

- [ ] **Step 4: Commit**

```bash
git add src/components/student/StudentMarketPage.tsx
git commit -m "fix: show the student's market phase in the same Japanese wording the teacher sees"
```

---

### Task 9: De-emphasize the recovery code

**Files:**
- Create: `src/components/student/RecoveryCodeDisclosure.tsx`
- Create: `src/components/student/RecoveryCodeDisclosure.test.tsx`
- Modify: `src/components/student/StudentMarketPage.tsx`

**Interfaces:**
- Produces: `RecoveryCodeDisclosure({ code: string })` from `src/components/student/RecoveryCodeDisclosure.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/student/RecoveryCodeDisclosure.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { RecoveryCodeDisclosure } from './RecoveryCodeDisclosure'

describe('RecoveryCodeDisclosure', () => {
  it('hides the recovery code until the student expands it', async () => {
    render(<RecoveryCodeDisclosure code="A1B2" />)
    expect(screen.queryByText('A1B2')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '別の端末で続きから参加したいときは' }))
    expect(screen.getByText('A1B2')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/student/RecoveryCodeDisclosure.test.tsx`
Expected: FAIL with "Failed to resolve import" (`./RecoveryCodeDisclosure` does not exist yet).

- [ ] **Step 3: Write RecoveryCodeDisclosure**

```tsx
// src/components/student/RecoveryCodeDisclosure.tsx
import { useState } from 'react'
import { Box, Button, Collapse, Typography } from '@mui/material'

export interface RecoveryCodeDisclosureProps { code: string }

export function RecoveryCodeDisclosure({ code }: RecoveryCodeDisclosureProps) {
  const [open, setOpen] = useState(false)
  return (
    <Box>
      <Button size="small" variant="text" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {open ? '閉じる' : '別の端末で続きから参加したいときは'}
      </Button>
      <Collapse in={open}>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          参加画面でこの復帰コードを入力すると、別の端末から同じチームで続きから参加できます。
        </Typography>
        <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: '.12em', mt: 0.5 }}>{code || '—'}</Typography>
      </Collapse>
    </Box>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/student/RecoveryCodeDisclosure.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 5: Wire it into StudentMarketPage**

In `src/components/student/StudentMarketPage.tsx`, add:

```tsx
import { RecoveryCodeDisclosure } from './RecoveryCodeDisclosure'
```

Replace the cash/recovery-code header block:

```tsx
<Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 3 }}><StudentSurfaceCard sx={{ flex: 1 }}><Stack direction="row" spacing={3} sx={{ p: 2.5, alignItems: 'center', justifyContent: 'space-between' }}><Box><Typography variant="caption" color="text.secondary">現金</Typography><Typography variant="h5" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>¥{(portfolio?.cash ?? 0).toLocaleString()}</Typography></Box><Box sx={{ textAlign: 'right' }}><Typography variant="caption" color="text.secondary">復帰コード</Typography><Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: '.12em' }}>{recoveryCode || '—'}</Typography></Box></Stack></StudentSurfaceCard><Chip label={`${teams[participant.teamId ?? '']?.name ?? 'チーム'} ・ ${describeStudentPhase(meta?.status)}`} variant="outlined" sx={{ alignSelf: { md: 'center' } }} /></Stack>
```

with:

```tsx
<Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 1 }}><StudentSurfaceCard sx={{ flex: 1 }}><Stack direction="row" spacing={3} sx={{ p: 2.5, alignItems: 'center' }}><Box><Typography variant="caption" color="text.secondary">現金</Typography><Typography variant="h5" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>¥{(portfolio?.cash ?? 0).toLocaleString()}</Typography></Box></Stack></StudentSurfaceCard><Chip label={`${teams[participant.teamId ?? '']?.name ?? 'チーム'} ・ ${describeStudentPhase(meta?.status)}`} variant="outlined" sx={{ alignSelf: { md: 'center' } }} /></Stack>
<Box sx={{ mb: 3 }}><RecoveryCodeDisclosure code={recoveryCode} /></Box>
```

(This step assumes Task 8 has already landed, so the chip already reads `describeStudentPhase(meta?.status)`; if executing this task before Task 8, keep the chip's existing `meta?.status ?? 'CONNECTING'` label unchanged and only remove the 復帰コード `Box`.)

- [ ] **Step 6: Typecheck, run the full suite, then manually verify**

Run: `npm run typecheck && npm test`
Expected: both PASS.

Run: `npm run dev`, join a market as a student, confirm the recovery code is not visible by default, and confirm clicking "別の端末で続きから参加したいときは" reveals it.

- [ ] **Step 7: Commit**

```bash
git add src/components/student/RecoveryCodeDisclosure.tsx src/components/student/RecoveryCodeDisclosure.test.tsx src/components/student/StudentMarketPage.tsx
git commit -m "fix: keep the recovery code out of the way until a student actually needs it"
```

---

### Task 10: Add the student onboarding card

**Files:**
- Create: `src/components/student/StudentOnboardingCard.tsx`
- Create: `src/components/student/StudentOnboardingCard.test.tsx`
- Modify: `src/components/student/StudentMarketPage.tsx`

**Interfaces:**
- Produces: `StudentOnboardingCard({ onDismiss: () => void })` from `src/components/student/StudentOnboardingCard.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/student/StudentOnboardingCard.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StudentOnboardingCard } from './StudentOnboardingCard'

describe('StudentOnboardingCard', () => {
  it('explains that the team shares cash and holdings before trading starts', () => {
    render(<StudentOnboardingCard onDismiss={vi.fn()} />)
    expect(screen.getByText(/チームで共有します/)).toBeInTheDocument()
  })

  it('calls onDismiss when the student is ready to trade', async () => {
    const onDismiss = vi.fn()
    render(<StudentOnboardingCard onDismiss={onDismiss} />)
    await userEvent.click(screen.getByRole('button', { name: 'わかった → 取引を始める' }))
    expect(onDismiss).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/student/StudentOnboardingCard.test.tsx`
Expected: FAIL with "Failed to resolve import" (`./StudentOnboardingCard` does not exist yet).

- [ ] **Step 3: Write StudentOnboardingCard**

```tsx
// src/components/student/StudentOnboardingCard.tsx
import { Button, Stack, Typography } from '@mui/material'
import { StudentSurfaceCard } from '../ui/StudentUi'

export interface StudentOnboardingCardProps { onDismiss: () => void }

export function StudentOnboardingCard({ onDismiss }: StudentOnboardingCardProps) {
  return (
    <StudentSurfaceCard sx={{ mb: 3 }}>
      <Stack spacing={1.5} sx={{ p: { xs: 2.5, sm: 3 } }}>
        <Typography variant="overline" color="text.secondary">はじめに</Typography>
        <Typography component="h2" variant="h6" sx={{ fontWeight: 800 }}>このチームでの投資について</Typography>
        <Stack component="ul" spacing={0.75} sx={{ pl: 2.5, m: 0 }}>
          <Typography component="li">現金と株は「チーム」で共有します（あなた一人の持ち物ではありません）</Typography>
          <Typography component="li">銘柄を選んで、買う/売るを選択します</Typography>
          <Typography component="li">価格は毎秒動きます。ニュースで大きく動くこともあります</Typography>
          <Typography component="li">終了後にチームの順位と結果が見られます</Typography>
        </Stack>
        <Button variant="contained" onClick={onDismiss} sx={{ alignSelf: 'flex-start' }}>わかった → 取引を始める</Button>
      </Stack>
    </StudentSurfaceCard>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/student/StudentOnboardingCard.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire it into StudentMarketPage, gated by localStorage**

In `src/components/student/StudentMarketPage.tsx`, add:

```tsx
import { StudentOnboardingCard } from './StudentOnboardingCard'
```

Add state and an effect, near the other `useState`/`useEffect` declarations for `uid`:

```tsx
const [showOnboarding, setShowOnboarding] = useState(false)
const onboardingKey = uid ? `stock-league:student-onboarding:${uid}` : ''
useEffect(() => {
  if (!onboardingKey) return
  setShowOnboarding(window.localStorage.getItem(onboardingKey) !== 'done')
}, [onboardingKey])
const dismissOnboarding = () => { if (onboardingKey) window.localStorage.setItem(onboardingKey, 'done'); setShowOnboarding(false) }
```

Render the card right before the market-board/portfolio row, i.e. immediately above `<Stack direction={{ xs: 'column', lg: 'row' }} spacing={3} sx={{ alignItems: 'flex-start' }}>` (the row containing the stock picker and the portfolio/leaderboard aside):

```tsx
{showOnboarding && <StudentOnboardingCard onDismiss={dismissOnboarding} />}
```

- [ ] **Step 6: Typecheck, run the full suite, then manually verify**

Run: `npm run typecheck && npm test`
Expected: both PASS.

Run: `npm run dev`, join a market as a new student (clear `localStorage` first, or use a private window), confirm the onboarding card appears above the trading board, and confirm clicking "わかった → 取引を始める" dismisses it and that reloading the page does not bring it back.

- [ ] **Step 7: Commit**

```bash
git add src/components/student/StudentOnboardingCard.tsx src/components/student/StudentOnboardingCard.test.tsx src/components/student/StudentMarketPage.tsx
git commit -m "feat: explain team-shared trading to students before they place their first order"
```
