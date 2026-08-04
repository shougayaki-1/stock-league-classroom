# Phase 0: 現行版の安全化と基準値計測 Implementation Plan

> **この計画は大部分が不要になった。そのまま実行してはならない。**
>
> 統合仕様書 §1 が「既存利用者はいない、旧データ移行は不要、旧クラシック市場は維持しない」と定めたため、次が消える。
>
> - Task 7（既存市場への一時バックフィル）— 移行対象が存在しない
> - Task 9〜13（旧方式の帯域基準値計測）— 旧市場を廃止するため比較対象にならない
>
> 先読み脆弱性への対処そのものは統合仕様書 §26-1 と Phase A に引き継がれる。**Task 1〜6 で特定した事実（`companies.phases` の露出、`ControlRoom.tsx` のキャッシュキー、RTDBのルールカスケード）は Phase A で有効である。**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two confirmed lookahead vulnerabilities in the live RTDB market state (`prices/{stockId}/runtime` and `companies/{stockId}/phases` being readable by students), and establish a measured, dated baseline of RTDB bandwidth/writes before Phase 1's engine rewrite, so its reduction can later be quantified.

**Architecture:** Split the RTDB `liveMarkets/{marketId}` tree into a public branch students already read (`companies`, `prices`) and two new host-only branches (`privatePriceRuntime/{stockId}`, `privateCompanyPhases/{stockId}`). The split happens at the type level first (`PublicLivePrice` vs `PrivatePriceRuntime`, public `companies` entry vs `privateCompanyPhases`) so a future edit cannot accidentally reintroduce the leak by writing to the wrong field of a shared object. Security rules enforce the split independently of the type system, including an explicit `.validate: "false"` guard that rejects any future write of `phases`/`runtime` back into the public nodes. No server-authoritative pricing is introduced in Phase 0 — the host's browser still ticks the price loop every second exactly as today; only *where* the runtime state and phase plan are stored changes.

**Tech Stack:** TypeScript, Firebase Realtime Database (JSON-tree security rules), `@firebase/rules-unit-testing` (Rules Emulator, `npm run test:rules`), Vitest, Firebase Admin SDK (migration script), Firebase modular client SDK (load-test harness, run under `tsx`).

## Global Constraints

- Every task must leave `npm run verify` (`lint` → `typecheck` → `test` → `test:rules` → `build`) passing before it is considered done, per this repo's existing convention (`package.json`).
- No server-side pricing engine, Cloud Functions, or `orgId` work in this plan — that is explicitly deferred to Phase 1 in `docs/superpowers/specs/2026-08-05-lesson-platform-roadmap-design.md`.
- The public wire shape for classic-mode current price stays `{ price, updatedAtMillis }` at `liveMarkets/{marketId}/prices/{stockId}` — do not rename that path, only strip `runtime` out of the value stored there.
- `companies/{stockId}` keeps `{ id, name, symbol, basePrice }` as its public shape — `phases` is removed from it entirely, not just hidden by a rule.
- Follow the design doc's node names verbatim where it specifies them: `liveMarkets/{marketId}/privatePriceRuntime/{stockId}`. Where the design doc left a choice open (`companies.phases`'s destination), this plan uses `liveMarkets/{marketId}/privateCompanyPhases/{stockId}` — see the rationale in Task 1.
- Rules Emulator tests verify permissions only; they cannot measure billed transfer bytes. Bandwidth baselines must come from a staging **Blaze** project's Cloud Monitoring metrics, per the design doc's explicit warning.

---

## 実施単位の分割（レビューによる追記）

この計画は性質の異なる2種類の作業を含む。**別々に実施すること。**

| 単位 | Task | 性質 | 前提 |
| --- | --- | --- | --- |
| **Phase 0a: 安全化** | 1〜8 | コード・ルール・移行。自己完結し、単独で出荷できる | なし |
| **Phase 0b: 基準値計測** | 9〜13 | インフラ構築と有人の負荷試験 | staging Blaze プロジェクト、人が50分張り付ける時間 |

**0a を 0b の完了に依存させてはならない。** 脆弱性は現在の本番で有効であり、`companies/{stockId}/phases` は生徒に授業全体の値動き計画を露出している。staging の準備を待つ理由がない。

### Task 12 の所要時間についての注記

Task 12 は50分・80人の計測を修正前と修正後の2回求めている。ホスト側は自動化できない（`.write` が `sign_in_provider === 'google.com'` を要求し、カスタムトークンでは偽装できない）ため、**人が実ブラウザで50分×2回を拘束される。**

**計測時間の短縮を検討すること。** 帯域の主成分は毎秒のティックによるファンアウトであり、これは接続数に比例し時間には線形にしか効かない。したがって次の優先順位が妥当である。

1. **接続数80を維持したまま計測時間を15分程度へ短縮する**（推奨）。ファンアウトの実測という目的は達成でき、拘束時間が1/3以下になる
2. 計画に既にある「10人×8倍で外挿」は次善策とする。接続数を減らす方が、時間を減らすより測定の忠実度を損なう

実施前に、どちらの簡略化を採るかを決めること。

### Task 14 の分割

Task 14 の完了条件も、0a（脆弱性の解消）と 0b（基準値の記録）へ分けて判定すること。0a の完了判定に 0b の計測結果を含めない。

---

## File Structure

| File | Change |
| --- | --- |
| `src/lib/pricing/types.ts` | No change — `PriceRuntimeState`/`StockPricePhase` keep their existing shape; they become the *payload* of the new private RTDB nodes. |
| `src/lib/market/liveMarketTypes.ts` | Remove `runtime` from `LivePrice`; remove `phases` from the `companies` entry type; add `PrivatePriceRuntime` alias and `privatePriceRuntime` / `privateCompanyPhases` fields on `LiveMarketState`. |
| `src/lib/market/hostTrading.ts` | `publishPrices`, `applyNewsImpact`, `applyUpdateMarketCompanies`, `deriveStocksFromCompanies` read/write the new private nodes instead of the nested fields. |
| `src/lib/market/hostTrading.test.ts` | Existing tests updated for the new shapes; new tests for the private-node round trip. |
| `src/lib/market/marketRepository.ts` | `initialLiveState` seeds `privateCompanyPhases` instead of nesting `phases` under `companies`. |
| `src/lib/market/marketRepository.test.ts` | Existing assertion updated to the new field. |
| `src/components/teacher/ControlRoom.tsx` | Reads `live.privateCompanyPhases` alongside `live.companies` for `deriveStocksFromCompanies`; memo cache key updated (see "important fact" in the final report — this was silently wrong before the fix). |
| `src/components/teacher/MarketStocksPage.tsx` | Subscribes to the new `privateCompanyPhases` node and merges it into the edit draft. |
| `database.rules.json` | New `.read`-only nodes `privatePriceRuntime`, `privateCompanyPhases` (owner-only); `.validate: "false"` guards on `companies/$stockId/phases` and `prices/$stockId/runtime`. |
| `test/database.rules.test.ts` | New `describe` block covering the full student/teacher read matrix for both private nodes, plus the regression-guard writes. |
| `scripts/phase0-privatize-phases.mjs` | One-time Admin-SDK backfill/purge for markets created before this deploy. |
| `README.md` | New short section documenting classic mode's known host-tab dependency (Phase 0 completion condition). |
| `scripts/loadtest/simulate-classroom.ts` | New — 80 scripted anonymous "student" RTDB sessions against a staging Blaze project, for the bandwidth baseline. |
| `docs/superpowers/plans/2026-08-05-phase0-baseline-metrics.md` | New — recording template + procedure for the staging load-test results. |

---

## Task 1: Split the price-runtime and phase-plan types, and the core engine functions that write them

**Files:**
- Modify: `src/lib/market/liveMarketTypes.ts`
- Modify: `src/lib/market/hostTrading.ts:69-145` (`applyUpdateMarketCompanies`, `deriveStocksFromCompanies`, `publishPrices`), `src/lib/market/hostTrading.ts:225-248` (`applyNewsImpact`)
- Test: `src/lib/market/hostTrading.test.ts`

**Interfaces:**
- Produces: `PrivatePriceRuntime` type alias, `LiveMarketState.privatePriceRuntime?: Record<string, PrivatePriceRuntime>`, `LiveMarketState.privateCompanyPhases?: Record<string, StockPricePhase[]>`, updated signature `deriveStocksFromCompanies(companies?, privateCompanyPhases?): Array<{ id: string; basePrice: number; phases?: StockPricePhase[] }>`.
- Consumes: `PriceRuntimeState`, `StockPricePhase` from `src/lib/pricing/types.ts` (unchanged), `normalizePhases`, `createPhaseRuntime`, `getActivePhase`, `elapsedMarketMinute`, `clampToBounds` from `src/lib/pricing/pricingCore.ts` (unchanged).

**Node-naming rationale (design doc left this open):** `companies/{stockId}` and `prices/{stockId}` are both maps keyed by stock ID that the client already merges by `stockId` (see `ControlRoom.tsx:212`, `StudentMarketPage.tsx:167`). Naming the new node `privateCompanyPhases/{stockId}` (rather than, say, a single blob under `meta`) keeps that established per-stock-ID merge pattern and mirrors `privatePriceRuntime/{stockId}` exactly, so both private nodes are structurally symmetric with the public ones they shadow.

- [ ] **Step 1: Write the failing test for the new `deriveStocksFromCompanies` signature**

Replace the existing test in `src/lib/market/hostTrading.test.ts` (currently at line 210-226):

```ts
describe('deriving the price engine input from live company data', () => {
  it('reflects an edited base price and phases from the private phases node, not template defaults', () => {
    const state: LiveMarketState = {
      meta: { ownerUid: 'teacher', capacity: 80, visibility: 'private', status: 'PAUSED', createdAtMillis: 1, startingCash: 10000, joinCode: 'ABC234' },
      teams: {},
      companies: { acme: { id: 'acme', name: 'Acme', symbol: 'AC', basePrice: 100 } },
    }
    const edited = applyUpdateMarketCompanies(state, 'teacher', 1_000, [{ id: 'acme', name: 'Acme', symbol: 'AC', basePrice: 777, phases: [{ id: 'p1', startMinute: 0, endMinute: 30, direction: 'DOWN', changePercent: 15 }] }])!
    expect(edited.companies!.acme).toEqual({ id: 'acme', name: 'Acme', symbol: 'AC', basePrice: 777 })
    const stocks = deriveStocksFromCompanies(edited.companies, edited.privateCompanyPhases)
    expect(stocks).toEqual([{ id: 'acme', basePrice: 777, phases: [{ id: 'p1', startMinute: 0, endMinute: 30, direction: 'DOWN', changePercent: 15 }] }])
  })

  it('is empty when there are no companies yet', () => {
    expect(deriveStocksFromCompanies(undefined, undefined)).toEqual([])
    expect(deriveStocksFromCompanies({}, {})).toEqual([])
  })

  it('falls back to a legacy embedded company.phases for a market created before the privatization migration', () => {
    const legacyCompanies = { acme: { id: 'acme', name: 'Acme', symbol: 'AC', basePrice: 100, phases: [{ id: 'legacy', startMinute: 0, endMinute: 60, direction: 'UP' as const, changePercent: 5 }] } }
    expect(deriveStocksFromCompanies(legacyCompanies, undefined)).toEqual([{ id: 'acme', basePrice: 100, phases: legacyCompanies.acme.phases }])
  })
})
```

Also update `'market company edits'` describe block's two `phases`-touching tests. Replace lines 196-207 with:

```ts
  it('clears the cached price runtime for an edited company, so the edit takes effect instead of being masked by the stale runtime', () => {
    const state = pausedState()
    state.prices = { acme: { price: 150, updatedAtMillis: 1 } }
    state.privatePriceRuntime = { acme: { mode: 'PHASE', phaseId: 'old-phase', startPrice: 100, endPrice: 150, startAtMillis: 0, endAtMillis: 999_999, seed: 0 } }
    const next = applyUpdateMarketCompanies(state, 'teacher', 30_000, [{ id: 'acme', name: 'Acme', symbol: 'AC', basePrice: 500 }])!
    expect(next.privatePriceRuntime!.acme).toBeUndefined()
    expect(next.prices!.acme.price).toBe(150)
  })

  it('does nothing to prices when the edited company has no cached price yet', () => {
    const state = pausedState()
    expect(() => applyUpdateMarketCompanies(state, 'teacher', 30_000, [{ id: 'acme', name: 'Acme', symbol: 'AC', basePrice: 500 }])).not.toThrow()
  })

  it('writes phases into privateCompanyPhases, never into the public companies entry', () => {
    const next = applyUpdateMarketCompanies(pausedState(), 'teacher', 30_000, [{ id: 'acme', name: 'Acme', symbol: 'AC', basePrice: 100, phases: [{ id: 'p1', startMinute: 0, endMinute: 60, direction: 'FLAT', changePercent: 0 }] }])!
    expect(next.companies!.acme).not.toHaveProperty('phases')
    expect(next.privateCompanyPhases!.acme).toEqual([{ id: 'p1', startMinute: 0, endMinute: 60, direction: 'FLAT', changePercent: 0 }])
  })
```

Also update the `'news price impact'` describe block's `state()` fixture (lines 45-49) and the two tests that read `next.prices.acme.runtime`:

```ts
describe('news price impact', () => {
  const state = () => ({
    companies: { acme: { id: 'acme', name: 'Acme', symbol: 'AC', basePrice: 100 } },
    prices: { acme: { price: 110, updatedAtMillis: 1_000 } },
    privatePriceRuntime: { acme: { mode: 'PHASE' as const, phaseId: 'p1', startPrice: 100, endPrice: 120, startAtMillis: 0, endAtMillis: 60_000, seed: 0 } },
  })

  it('shifts the whole phase runtime so the shock survives the next tick', () => {
    const next = state()
    applyNewsImpact(next, 10, 2_000)
    expect(next.privatePriceRuntime.acme.startPrice).toBe(clampToBounds(110, 100))
    expect(next.privatePriceRuntime.acme.endPrice).toBe(clampToBounds(132, 100))
    expect(next.prices.acme.price).toBe(clampToBounds(110 + (132 - 110) * (2_000 / 60_000), 100))
    expect(next.prices.acme.updatedAtMillis).toBe(2_000)
  })
  // ... "clamps the impact", "does nothing at zero", "sets a price the very next tick recomputes
  // identically", and "keeps carrying the shock a second later" keep their existing bodies but
  // read `next.privatePriceRuntime.acme` instead of `next.prices.acme.runtime`.

  it('still shifts and clamps the price for an entry with no runtime', () => {
    const next = { companies: state().companies, prices: { acme: { price: 110, updatedAtMillis: 1_000 } }, privatePriceRuntime: {} }
    applyNewsImpact(next, 10, 2_000)
    expect(next.prices.acme.price).toBe(clampToBounds(121, 100))
    expect(next.prices.acme.updatedAtMillis).toBe(2_000)
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail on the current (pre-split) code**

Run: `npm test -- hostTrading`
Expected: FAIL — `deriveStocksFromCompanies` called with 2 args ignores the second (TS arity mismatch would actually fail typecheck first; for `npm test` alone expect assertion failures because `edited.companies!.acme` still has a `phases` key and `next.privatePriceRuntime` is `undefined`).

- [ ] **Step 3: Update the types**

In `src/lib/market/liveMarketTypes.ts`, replace line 34 and lines 58-77:

```ts
/** Shape stored at liveMarkets/{marketId}/privatePriceRuntime/{stockId}. Host-only: never
 * exposed to a student, because it carries endPrice/seed a client could use to precompute
 * a future price and trade risk-free before the phase settles. */
export type PrivatePriceRuntime = import('../pricing/types').PriceRuntimeState
/** Shape stored at liveMarkets/{marketId}/prices/{stockId}. Safe for a student to read at
 * any time: it is only ever the price that has already settled. */
export interface LivePrice { price: number; updatedAtMillis: number }
```

```ts
export interface LiveMarketState {
  meta: LiveMarketMetadata
  teams: Record<string, LiveMarketTeam>
  companies?: Record<string, { id: string; name: string; symbol: string; basePrice: number }>
  /** Host-only: liveMarkets/{marketId}/privateCompanyPhases/{stockId}. Holds the whole lesson's
   * price plan (StockPricePhase[]) — never readable by a student, who could otherwise read the
   * entire lesson's future price movement at the moment class starts. */
  privateCompanyPhases?: Record<string, import('../pricing/types').StockPricePhase[]>
  members?: Record<string, MarketMember>
  joinRequests?: Record<string, JoinRequest>
  recoveryCodes?: Record<string, RecoveryEntry>
  participants?: Record<string, LiveMarketParticipant>
  hostLease?: HostLease
  hostDisconnects?: Record<string, { ownerUid: string; disconnectedAtMillis: number }>
  prices?: Record<string, LivePrice>
  /** Host-only: liveMarkets/{marketId}/privatePriceRuntime/{stockId}. */
  privatePriceRuntime?: Record<string, PrivatePriceRuntime>
  orders?: Record<string, { pending?: PendingOrder }>
  teamPortfolios?: Record<string, Portfolio>
  transactions?: Record<string, Record<string, OrderResult>>
  teamLeaderboard?: Record<string, TeamLeaderboardEntry>
  news?: Record<string, { message: string; publishedAtMillis: number; impactPercent?: number }>
  finalization?: { status: 'PENDING' | 'WRITING_RESULTS' | 'COMPLETED'; checkpointId: string; startedAtMillis: number; completedAtMillis?: number }
  signage?: SignageData
}
```

- [ ] **Step 4: Update `applyUpdateMarketCompanies` and `deriveStocksFromCompanies` in `src/lib/market/hostTrading.ts`**

Replace lines 86-111:

```ts
export const applyUpdateMarketCompanies = (raw: LiveMarketState | null, ownerUid: string, _atMillis: number, companies: MarketCompanyDraft[]): LiveMarketState | undefined => {
  if (!raw || raw.meta.ownerUid !== ownerUid || (raw.meta.status !== 'SETUP' && raw.meta.status !== 'PAUSED')) return undefined
  if (validateMarketCompanies(companies).length) return undefined
  raw.companies = Object.fromEntries(companies.map((company) => [company.id, {
    id: company.id,
    name: company.name.trim(),
    symbol: company.symbol.trim().toUpperCase(),
    basePrice: Math.round(company.basePrice),
  }]))
  raw.privateCompanyPhases = Object.fromEntries(
    companies.filter((company) => company.phases).map((company) => [company.id, normalizePhases(company.phases)]),
  )
  // publishPrices reuses a cached runtime keyed by phaseId/expiry; without clearing it here, an
  // edit to the currently-active phase (or basePrice) has no visible effect until that phase's
  // window naturally ends, since the stale runtime survives the edit.
  for (const company of companies) {
    if (raw.privatePriceRuntime?.[company.id]) delete raw.privatePriceRuntime[company.id]
  }
  return raw
}

export const updateMarketCompanies = async (database: Database, marketId: string, ownerUid: string, companies: MarketCompanyDraft[], atMillis = now()) =>
  (await runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => applyUpdateMarketCompanies(raw, ownerUid, atMillis, companies))).committed

/** What the price engine's tick loop should run against, straight from live RTDB company data —
 * never from the immutable Firestore templateSnapshot, which updateMarketCompanies never touches.
 * Falls back to a legacy embedded `company.phases` (pre-Phase-0-migration market data shape) so a
 * market that has not yet been touched by the backfill script (scripts/phase0-privatize-phases.mjs)
 * or a fresh stock edit keeps its configured plan instead of silently reverting to the flat default. */
export const deriveStocksFromCompanies = (
  companies?: LiveMarketState['companies'],
  privateCompanyPhases?: LiveMarketState['privateCompanyPhases'],
): Array<{ id: string; basePrice: number; phases?: StockPricePhase[] }> =>
  Object.values(companies ?? {}).map((company) => ({
    id: company.id,
    basePrice: company.basePrice,
    phases: privateCompanyPhases?.[company.id] ?? (company as { phases?: StockPricePhase[] }).phases,
  }))
```

- [ ] **Step 5: Update `publishPrices` and `applyNewsImpact`**

Replace `publishPrices` (lines 130-145):

```ts
export const publishPrices = async (database: Database, marketId: string, ownerUid: string, leaseId: string, stocks: Array<{ id: string; basePrice: number; phases?: StockPricePhase[] }>, atMillis = now()) => {
  const result = await runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => {
    if (!raw || !ownsLiveLease(raw, ownerUid, leaseId, atMillis) || raw.meta.status !== 'OPEN') return
    raw.prices ??= {}
    raw.privatePriceRuntime ??= {}
    for (const stock of stocks) {
      const existing = raw.prices[stock.id]
      const existingRuntime = raw.privatePriceRuntime[stock.id]
      const current = existing?.price ?? stock.basePrice
      const openedAtMillis = raw.meta.openedAtMillis ?? atMillis
      const phase = getActivePhase(stock.phases ?? [], elapsedMarketMinute(openedAtMillis, atMillis))
      const runtime = existingRuntime && existingRuntime.phaseId === phase.id && existingRuntime.endAtMillis > atMillis ? existingRuntime : createPhaseRuntime(current, phase, openedAtMillis, atMillis, stock.basePrice, 0)
      raw.prices[stock.id] = { price: priceAtRuntime(runtime, stock.basePrice, atMillis), updatedAtMillis: atMillis }
      raw.privatePriceRuntime[stock.id] = runtime
    }
    return raw
  })
  return result.committed
}
```

Replace `applyNewsImpact` (lines 227-248):

```ts
/**
 * A shock has to move the phase runtime, not just the price: publishPrices
 * recomputes each price from its runtime every tick, so a bare price write
 * would be erased one second later.
 */
export const applyNewsImpact = (state: Pick<LiveMarketState, 'prices' | 'companies' | 'privatePriceRuntime'>, impactPercent: number, atMillis: number) => {
  const bounded = Math.max(-NEWS_IMPACT_LIMIT, Math.min(NEWS_IMPACT_LIMIT, impactPercent))
  if (!bounded || !state.prices) return
  const multiplier = 1 + bounded / 100
  for (const [stockId, entry] of Object.entries(state.prices)) {
    const basePrice = state.companies?.[stockId]?.basePrice ?? entry.price
    const runtime = state.privatePriceRuntime?.[stockId]
    if (runtime) {
      runtime.startPrice = clampToBounds(runtime.startPrice * multiplier, basePrice)
      runtime.endPrice = clampToBounds(runtime.endPrice * multiplier, basePrice)
      entry.price = priceAtRuntime(runtime, basePrice, atMillis)
    } else {
      entry.price = clampToBounds(entry.price * multiplier, basePrice)
    }
    entry.updatedAtMillis = atMillis
  }
}
```

No change is needed at the `publishManualNews` call site (`applyNewsImpact(raw, impactPercent, atMillis)`, line 255) — `raw` is the full `LiveMarketState`, which now includes `privatePriceRuntime`.

- [ ] **Step 6: Run the tests to confirm they pass**

Run: `npm test -- hostTrading`
Expected: PASS, all tests in `src/lib/market/hostTrading.test.ts` green.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: Errors at every other call site that still uses the old shapes — this is expected and fixed in Tasks 2-4. Confirm the errors are *only* in `marketRepository.ts`, `ControlRoom.tsx`, and `MarketStocksPage.tsx` (the three remaining consumers found by the `runtime`/`phases`/`companies` grep). If any other file errors, note it — it means a consumer was missed during research.

- [ ] **Step 8: Commit**

```bash
git add src/lib/market/liveMarketTypes.ts src/lib/market/hostTrading.ts src/lib/market/hostTrading.test.ts
git commit -m "refactor: split price runtime and phase plan into private RTDB-shaped types"
```

---

## Task 2: Seed the new private node on market creation

**Files:**
- Modify: `src/lib/market/marketRepository.ts:24-29` (`initialLiveState`)
- Test: `src/lib/market/marketRepository.test.ts:12-16`

**Interfaces:**
- Consumes: `LiveMarketState.privateCompanyPhases` (Task 1).
- Produces: `initialLiveState(input: CreateMarketInput)` now also writes `privateCompanyPhases`.

- [ ] **Step 1: Update the failing test**

In `src/lib/market/marketRepository.test.ts`, replace the assertion at line 15:

```ts
  it('copies immutable starting cash and configured price phases into live market state', () => {
    const state = initialLiveState({ ownerUid: 'teacher', visibility: 'private', joinCode: 'ABC234', template: { title: 't', description: '', startingCash: 5000, teams: [{ id: 'red', name: '赤' }, { id: 'blue', name: '青' }], companies: [{ id: 'acme', name: 'Acme', symbol: 'AC', initialPrice: 100, pricePhases: [{ id: 'up', startMinute: 0, endMinute: 60, direction: 'UP', changePercent: 10 }] }] } })
    expect(state.companies.acme).toEqual({ id: 'acme', name: 'Acme', symbol: 'AC', basePrice: 100 })
    expect(state.privateCompanyPhases.acme?.[0].direction).toBe('UP')
  })
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npm test -- marketRepository`
Expected: FAIL — `state.privateCompanyPhases` is `undefined`, and `state.companies.acme` still has a `phases` key.

- [ ] **Step 3: Update `initialLiveState`**

Replace lines 24-29 of `src/lib/market/marketRepository.ts`:

```ts
export const initialLiveState = (input: CreateMarketInput) => ({
  meta: { ownerUid: input.ownerUid, capacity: MARKET_CAPACITY, visibility: input.visibility, status: 'SETUP' as const, createdAtMillis: serverNow(), startingCash: input.template.startingCash, joinCode: normalizeCode(input.joinCode ?? ''), autoApprove: false },
  teams: Object.fromEntries(input.template.teams.map((team) => [team.id, { id: team.id, name: team.name }])),
  companies: Object.fromEntries(input.template.companies.map((company) => [company.id, { id: company.id, name: company.name, symbol: company.symbol, basePrice: company.initialPrice }])),
  privateCompanyPhases: Object.fromEntries(input.template.companies.filter((company) => company.pricePhases).map((company) => [company.id, company.pricePhases])),
  teamPortfolios: Object.fromEntries(input.template.teams.map((team) => [team.id, { cash: input.template.startingCash, holdings: {}, updatedAtMillis: serverNow() }])),
})
```

- [ ] **Step 4: Run to confirm it passes**

Run: `npm test -- marketRepository`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/market/marketRepository.ts src/lib/market/marketRepository.test.ts
git commit -m "refactor: seed privateCompanyPhases instead of nesting phases under companies"
```

---

## Task 3: Fix the teacher Control Room's price-engine input and its stale memo cache

**Files:**
- Modify: `src/components/teacher/ControlRoom.tsx:104-125` (root subscription, `companiesKey`, `stocksCache`), `:212` (`HostStatusPanel` prices prop — no change needed, already reads `live?.companies`/`live?.prices`, neither of which lost a field it used)

**Interfaces:**
- Consumes: `deriveStocksFromCompanies(companies?, privateCompanyPhases?)` (Task 1).

**Why this task exists on its own:** `ControlRoom.tsx` subscribes to the *entire* `liveMarkets/{marketId}` root (`onValue(ref(services.database, \`liveMarkets/${marketId}\`), ...)` at line 104), so the host will keep receiving `privateCompanyPhases` automatically once Task 5's rules land — no new subscription is needed here, unlike Task 4. But the memoization key at line 120 (`JSON.stringify(live?.companies ?? {})`) was built when `phases` still lived inside `companies`; after Task 1, editing a stock's phases no longer changes `companies`' JSON at all, so **this memo would silently go stale and the tick loop would keep running the old phase plan until some unrelated field of `companies` also changed.** This is a real regression this task must fix, not just a type-level cleanup.

- [ ] **Step 1: Update the stale memo key and the `deriveStocksFromCompanies` call**

Replace lines 115-125 of `src/components/teacher/ControlRoom.tsx`:

```ts
  // `live` gets a brand-new object reference on every RTDB snapshot, including ticks that only
  // touched unrelated fields (prices, teamLeaderboard, ...). Memoizing on live?.companies identity
  // would recompute — and therefore restart the tick-loop effect below that depends on `stocks` —
  // every second even when the company list hasn't actually changed, so this memoizes on a
  // content-based key via a ref instead of useMemo's identity-based dependency array.
  // The key must cover privateCompanyPhases too: phases live in a separate RTDB node from
  // companies since the Phase 0 privatization fix, so a phase-only edit no longer changes
  // live.companies' JSON at all.
  const companiesKey = JSON.stringify({ companies: live?.companies ?? {}, phases: live?.privateCompanyPhases ?? {} })
  const stocksCache = useRef<{ key: string; stocks: { id: string; basePrice: number; phases?: import('../../lib/pricing/types').StockPricePhase[] }[] }>({ key: '', stocks: [] })
  if (stocksCache.current.key !== companiesKey) {
    stocksCache.current = { key: companiesKey, stocks: deriveStocksFromCompanies(live?.companies, live?.privateCompanyPhases) }
  }
```

- [ ] **Step 2: Typecheck (no component test exists for `ControlRoom.tsx` today — see note below)**

Run: `npm run typecheck`
Expected: PASS for this file (no more `phases` reference on `live.companies`); remaining errors, if any, should now be confined to `MarketStocksPage.tsx` (Task 4).

> `ControlRoom.tsx` has no existing unit test (confirmed: `grep -rl ControlRoom src --include="*.test.tsx"` returns nothing). This is a pre-existing gap, not one this plan introduces or is scoped to close — Phase 0's stated goal is closing the two lookahead vulnerabilities, not adding component test coverage. Verification for this task is `npm run typecheck` + `npm run build` (Task 14 also exercises this file end-to-end via the Rules Emulator integration test in Task 6, which drives real `applyUpdateMarketCompanies`/`deriveStocksFromCompanies` calls, just not through the React component).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/teacher/ControlRoom.tsx
git commit -m "fix: read privateCompanyPhases into the host tick loop's stocks input, fix stale memo key"
```

---

## Task 4: Subscribe `MarketStocksPage` to the new private phases node

**Files:**
- Modify: `src/components/teacher/MarketStocksPage.tsx:67-87`

**Interfaces:**
- Consumes: `LiveMarketState['privateCompanyPhases']` (Task 1).

**Why this task exists on its own:** unlike `ControlRoom.tsx`, this page does **not** subscribe to the market root — it subscribes to `companies` directly (line 77) and merges `company.phases` into the edit draft at seed time (line 81). After Task 1, `company.phases` no longer exists on the public `companies` node, so this page needs its own subscription to `privateCompanyPhases` and must wait for both listeners before seeding the draft (a naive "seed as soon as companies arrives" would race and could seed with an empty phase list even though phases exist but haven't arrived yet).

- [ ] **Step 1: Update the seeding effect**

Replace lines 67-87 of `src/components/teacher/MarketStocksPage.tsx`:

```ts
  useEffect(() => {
    if (!authReady || !user || !isTeacherIdentity(user) || access !== 'ready') return
    seededRef.current = false
    let latestCompanies: LiveMarketState['companies'] | null = null
    let latestPhases: LiveMarketState['privateCompanyPhases'] = undefined
    let companiesLoaded = false
    let phasesLoaded = false
    const trySeed = () => {
      if (seededRef.current || !companiesLoaded || !phasesLoaded || !latestCompanies) return
      seededRef.current = true
      setDraft(Object.values(latestCompanies).map((company) => ({ id: company.id, name: company.name, symbol: company.symbol, basePrice: company.basePrice, phases: latestPhases?.[company.id] })))
    }
    const statusStop = onValue(ref(services.database, `liveMarkets/${marketId}/meta/status`), (snapshot) => {
      const value = snapshot.val() as MarketStatus | null
      if (value) setStatus(value)
    }, (error) => {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      setAccess(code.includes('permission-denied') ? 'forbidden' : 'read-error')
    })
    const companiesStop = onValue(ref(services.database, `liveMarkets/${marketId}/companies`), (snapshot) => {
      latestCompanies = snapshot.val() as LiveMarketState['companies'] | null
      companiesLoaded = true
      trySeed()
    }, (error) => {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      setAccess(code.includes('permission-denied') ? 'forbidden' : 'read-error')
    })
    const phasesStop = onValue(ref(services.database, `liveMarkets/${marketId}/privateCompanyPhases`), (snapshot) => {
      latestPhases = (snapshot.val() as LiveMarketState['privateCompanyPhases'] | null) ?? undefined
      phasesLoaded = true
      trySeed()
    }, (error) => {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      setAccess(code.includes('permission-denied') ? 'forbidden' : 'read-error')
    })
    return () => { statusStop(); companiesStop(); phasesStop() }
  }, [access, authReady, marketId, services.database, user])
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS with no remaining errors anywhere in `src/`.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS.

> Same test-coverage note as Task 3: `MarketStocksPage.tsx` has no existing component test (`grep -rl MarketStocksPage src --include="*.test.tsx"` returns nothing). Verified via typecheck/build here; the underlying `applyUpdateMarketCompanies`/`deriveStocksFromCompanies` logic this page calls into is unit-tested in Task 1, and the end-to-end read/write permissions are covered by the Rules Emulator tests in Task 6.

- [ ] **Step 4: Commit**

```bash
git add src/components/teacher/MarketStocksPage.tsx
git commit -m "fix: subscribe the stock editor to privateCompanyPhases, merge before seeding the draft"
```

---

## Task 5: Lock down the new nodes and guard against regression in `database.rules.json`

**Files:**
- Modify: `database.rules.json:66-71` (`prices`), `:29-31` (`companies`), add new siblings `privatePriceRuntime`, `privateCompanyPhases`

**Interfaces:**
- Consumes: nothing (declarative rules file).
- Produces: `.read` grants for `privatePriceRuntime`/`privateCompanyPhases` (owner-only), `.validate: "false"` guards at `companies/$stockId/phases` and `prices/$stockId/runtime`.

This task has no unit test of its own — `test/database.rules.test.ts` (Task 6) is the test. Steps here are the implementation; Task 6 is the paired TDD test, written and run against the rules produced by this task. To keep this a real red/green cycle, do Task 6's test-writing *before* this task's rule edit (see Task 6 Step 1), then come back and edit the rules file, then run the tests.

- [ ] **Step 1: Add the two new private nodes and the two validate guards**

In `database.rules.json`, replace the `"companies"` block (lines 29-31):

```json
        "companies": {
          ".read": "auth != null && (root.child('liveMarkets').child($marketId).child('meta/ownerUid').val() === auth.uid || root.child('liveMarkets').child($marketId).child('members').child(auth.uid).exists())",
          "$stockId": {
            "phases": { ".validate": "false" }
          }
        },
        "privateCompanyPhases": {
          ".read": "auth != null && root.child('liveMarkets').child($marketId).child('meta/ownerUid').val() === auth.uid"
        },
```

Replace the `"prices"` block (lines 66-68):

```json
        "prices": {
          ".read": "auth != null && (root.child('liveMarkets').child($marketId).child('meta/ownerUid').val() === auth.uid || root.child('liveMarkets').child($marketId).child('members').child(auth.uid).exists())",
          "$stockId": {
            "runtime": { ".validate": "false" }
          }
        },
        "privatePriceRuntime": {
          ".read": "auth != null && root.child('liveMarkets').child($marketId).child('meta/ownerUid').val() === auth.uid"
        },
```

No new `.write` rule is needed for either new node: writes to any path under `liveMarkets/{marketId}` are already governed by the top-level `$marketId` `.write` rule (line 13), which grants the market owner write access to the whole subtree — exactly how `prices` and `companies` already work today (neither has its own `.write`). RTDB rule cascading means the owner's root-level grant already covers `privatePriceRuntime`/`privateCompanyPhases`; the `.read` rules added above exist specifically to *deny* the same access to students, who are only granted read at named, narrower paths.

- [ ] **Step 2: Run the paired rules tests (written in Task 6) and confirm they pass**

Run: `npm run test:rules`
Expected: PASS (see Task 6 for the tests this exercises).

- [ ] **Step 3: Commit**

```bash
git add database.rules.json
git commit -m "fix: privatize price runtime and phase plan RTDB nodes, guard against write-back regressions"
```

---

## Task 6: Rules Emulator tests for the student/teacher read matrix (write before Task 5's rule edit)

**Files:**
- Modify: `test/database.rules.test.ts`

**Interfaces:**
- Consumes: `database.rules.json` (read at `beforeAll` via `readFileSync`, per existing pattern at line 25).

This is the actual TDD pair for Task 5. Write these tests against the **current** `database.rules.json` first (they must fail), then apply Task 5's edit, then rerun (they must pass). The existing `beforeEach` seed (lines 27-30) already creates `liveMarkets/market-a` with a `companies` map; extend it inline per test with `withSecurityRulesDisabled`, matching the file's existing style (e.g. line 116-121).

- [ ] **Step 1: Write the failing tests**

Append to `test/database.rules.test.ts`, after the closing `})` of the `'live market RTDB rules'` describe block (after line 134):

```ts
describe('price runtime and phase-plan privacy (Phase 0)', () => {
  const seedPrivateNodes = () => environment.withSecurityRulesDisabled(async (context) => context.database().ref(`liveMarkets/${market}`).update({
    prices: { acme: { price: 150, updatedAtMillis: 1 } },
    privatePriceRuntime: { acme: { mode: 'PHASE', phaseId: 'p1', startPrice: 100, endPrice: 200, startAtMillis: 0, endAtMillis: 60_000, seed: 0 } },
    privateCompanyPhases: { acme: [{ id: 'p1', startMinute: 0, endMinute: 60, direction: 'UP', changePercent: 10 }] },
  }))

  it('lets an approved student read the settled price but never the runtime that would let them precompute it', async () => {
    await approveStudent()
    await seedPrivateNodes()
    const student = environment.authenticatedContext('student-a').database()
    await assertSucceeds(student.ref(`liveMarkets/${market}/prices/acme/price`).once('value'))
    await assertFails(student.ref(`liveMarkets/${market}/privatePriceRuntime`).once('value'))
    await assertFails(student.ref(`liveMarkets/${market}/privatePriceRuntime/acme`).once('value'))
  })

  it('lets an approved student read a company\'s public fields but never the lesson-wide phase plan', async () => {
    await approveStudent()
    await seedPrivateNodes()
    const student = environment.authenticatedContext('student-a').database()
    await assertSucceeds(student.ref(`liveMarkets/${market}/companies/acme`).once('value'))
    await assertFails(student.ref(`liveMarkets/${market}/privateCompanyPhases`).once('value'))
    await assertFails(student.ref(`liveMarkets/${market}/privateCompanyPhases/acme`).once('value'))
  })

  it('denies both private nodes and the whole market root to a non-member outsider', async () => {
    await approveStudent()
    await seedPrivateNodes()
    const outsider = environment.authenticatedContext('student-b').database()
    await assertFails(outsider.ref(`liveMarkets/${market}`).once('value'))
    await assertFails(outsider.ref(`liveMarkets/${market}/privatePriceRuntime`).once('value'))
    await assertFails(outsider.ref(`liveMarkets/${market}/privateCompanyPhases`).once('value'))
  })

  it('lets the teacher who owns the market read both private nodes', async () => {
    await seedPrivateNodes()
    const teacher = environment.authenticatedContext('teacher-a', teacherToken).database()
    await assertSucceeds(teacher.ref(`liveMarkets/${market}/privatePriceRuntime/acme`).once('value'))
    await assertSucceeds(teacher.ref(`liveMarkets/${market}/privateCompanyPhases/acme`).once('value'))
  })

  it('denies the private nodes to a teacher who owns a different market', async () => {
    await seedPrivateNodes()
    const otherTeacher = environment.authenticatedContext('teacher-b', teacherToken).database()
    await assertFails(otherTeacher.ref(`liveMarkets/${market}/privatePriceRuntime`).once('value'))
    await assertFails(otherTeacher.ref(`liveMarkets/${market}/privateCompanyPhases`).once('value'))
  })

  it('rejects writing phases back into the public companies node, even for the market owner', async () => {
    const teacher = environment.authenticatedContext('teacher-a', teacherToken).database()
    await assertFails(teacher.ref(`liveMarkets/${market}/companies/acme/phases`).set([{ id: 'p1', startMinute: 0, endMinute: 60, direction: 'UP', changePercent: 10 }]))
    // A full-object write that happens to include `phases` must fail too, not just the leaf write —
    // this is what actually protects against a future publishPrices()-style bug that writes the
    // company object wholesale.
    await assertFails(teacher.ref(`liveMarkets/${market}/companies/acme`).set({ id: 'acme', name: 'Acme', symbol: 'ACME', basePrice: 100, phases: [] }))
  })

  it('rejects writing runtime back into the public prices node, even for the market owner', async () => {
    const teacher = environment.authenticatedContext('teacher-a', teacherToken).database()
    await assertFails(teacher.ref(`liveMarkets/${market}/prices/acme/runtime`).set({ mode: 'PHASE', phaseId: 'p1', startPrice: 100, endPrice: 200, startAtMillis: 0, endAtMillis: 60_000, seed: 0 }))
    await assertFails(teacher.ref(`liveMarkets/${market}/prices/acme`).set({ price: 150, updatedAtMillis: 1, runtime: { mode: 'PHASE', phaseId: 'p1', startPrice: 100, endPrice: 200, startAtMillis: 0, endAtMillis: 60_000, seed: 0 } }))
  })
})
```

- [ ] **Step 2: Run against the current (pre-Task-5) rules and confirm the new tests fail**

Run: `npm run test:rules`
Expected: FAIL on every `assertFails(...privatePriceRuntime...)`, `assertFails(...privateCompanyPhases...)`, and the two write-back-guard tests (because none of those nodes/guards exist yet); the "teacher can read" tests will also fail with a different error (`.once('value')` against a nonexistent-rule path resolves but the seed itself used `withSecurityRulesDisabled` so it exists — the read will actually be denied because there is no `.read` rule granting it, only the top-level owner rule, which *does* already cover the owner case — re-check this pair specifically since owner reads may pass even pre-fix; the important negative assertions are the student/outsider ones).

- [ ] **Step 3: Apply Task 5's rule edit, then rerun**

Run: `npm run test:rules`
Expected: PASS, all tests in `test/database.rules.test.ts` green including the pre-existing ones (regression check).

- [ ] **Step 4: Commit**

```bash
git add test/database.rules.test.ts
git commit -m "test: cover student/teacher read matrix and write-back regression guards for private RTDB nodes"
```

---

## Task 7: One-time backfill for markets created before this deploy

**Files:**
- Create: `scripts/phase0-privatize-phases.mjs`

**Interfaces:**
- Consumes: `firebase-admin` (new script-only dependency — Admin SDK bypasses security rules by design, which is required here since the script must *read* the pre-fix public `companies/*/phases` data across every market to move it).

**Compatibility decision (explicit judgment call — see final report):** `prices/{stockId}/runtime` self-heals without any migration: `publishPrices` (Task 1, Step 5) fully overwrites `raw.prices[stock.id]` every tick while a market is `OPEN`, so any in-flight market gets a runtime-free `prices` entry within one second of the first tick under the new code. `companies/{stockId}/phases` does **not** self-heal the same way — it is only rewritten when a teacher explicitly edits stocks (`applyUpdateMarketCompanies`), which will not happen mid-lesson. A market that is `SETUP`/`OPEN`/`PAUSED` at deploy time keeps its phase plan publicly readable until either a teacher edits stocks or this script runs. Given Phase 0's completion condition is literally "no phases field is readable by a student account," this plan does not rely on natural expiry (markets in this app are normally same-day and short, but that is not a guarantee) — it ships a one-time Admin SDK script that scans every market and moves the field, run once immediately after Task 5's rules deploy.

- [ ] **Step 1: Write the script**

```js
// scripts/phase0-privatize-phases.mjs
// One-time backfill: moves any legacy `companies/{stockId}/phases` (public, pre-Phase-0-fix
// shape) into `privateCompanyPhases/{stockId}` (owner-only) for every market still holding the
// old shape, then deletes the public field. Uses the Admin SDK because it must read the leaked
// public data across every market, which security rules deny to anyone but each market's own
// owner. Run once, right after `firebase deploy --only database` applies the new rules from
// database.rules.json (Task 5) — see docs/superpowers/plans/2026-08-05-phase0-baseline-metrics.md
// for the deploy runbook this fits into.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
//   FIREBASE_DATABASE_URL=https://<project>-default-rtdb.<region>.firebasedatabase.app \
//   node scripts/phase0-privatize-phases.mjs [--dry-run]

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getDatabase } from 'firebase-admin/database'

const dryRun = process.argv.includes('--dry-run')
const databaseURL = process.env.FIREBASE_DATABASE_URL
if (!databaseURL) throw new Error('Set FIREBASE_DATABASE_URL to the target project\'s RTDB URL.')

initializeApp({ credential: applicationDefault(), databaseURL })
const db = getDatabase()

const run = async () => {
  const marketsSnapshot = await db.ref('liveMarkets').once('value')
  const markets = marketsSnapshot.val() ?? {}
  let migratedMarkets = 0
  let migratedCompanies = 0

  for (const [marketId, market] of Object.entries(markets)) {
    const companies = market.companies ?? {}
    const legacyEntries = Object.entries(companies).filter(([, company]) => company.phases !== undefined)
    if (!legacyEntries.length) continue

    const updates = {}
    for (const [stockId, company] of legacyEntries) {
      updates[`liveMarkets/${marketId}/privateCompanyPhases/${stockId}`] = company.phases
      updates[`liveMarkets/${marketId}/companies/${stockId}/phases`] = null // RTDB delete-by-null
    }

    console.log(`${dryRun ? '[dry-run] ' : ''}market ${marketId}: migrating ${legacyEntries.length} compan${legacyEntries.length === 1 ? 'y' : 'ies'}`)
    if (!dryRun) await db.ref().update(updates)
    migratedMarkets += 1
    migratedCompanies += legacyEntries.length
  }

  console.log(`${dryRun ? '[dry-run] ' : ''}done: ${migratedMarkets} market(s), ${migratedCompanies} compan${migratedCompanies === 1 ? 'y' : 'ies'} migrated.`)
}

await run()
```

- [ ] **Step 2: Verify against the emulator first (no production credentials needed)**

```bash
firebase emulators:start --only database --project demo-stock-league-classroom &
sleep 3
curl -X PUT -d '{"companies":{"acme":{"id":"acme","name":"Acme","symbol":"AC","basePrice":100,"phases":[{"id":"p1","startMinute":0,"endMinute":60,"direction":"UP","changePercent":5}]}},"meta":{"ownerUid":"teacher-a","capacity":80,"visibility":"private","status":"OPEN","createdAtMillis":1,"startingCash":10000,"joinCode":"ABC123"}}' \
  "http://127.0.0.1:9000/liveMarkets/market-a.json?ns=demo-stock-league-classroom"
FIREBASE_DATABASE_URL="http://127.0.0.1:9000?ns=demo-stock-league-classroom" node scripts/phase0-privatize-phases.mjs --dry-run
FIREBASE_DATABASE_URL="http://127.0.0.1:9000?ns=demo-stock-league-classroom" node scripts/phase0-privatize-phases.mjs
curl "http://127.0.0.1:9000/liveMarkets/market-a.json?ns=demo-stock-league-classroom"
```

Expected: the final `curl` shows `companies.acme` with no `phases` key, and a new top-level `privateCompanyPhases.acme` array with the same phase data. Note: the Admin SDK talking to the RTDB emulator does not enforce `database.rules.json` at all (Admin always bypasses rules, emulated or not), so this step only verifies the script's *data-shape* logic, not the rules from Task 5 — that verification already happened in Task 6.

Stop the emulator afterward: `kill %1` (or Ctrl-C the foreground job).

- [ ] **Step 3: Commit**

```bash
git add scripts/phase0-privatize-phases.mjs
git commit -m "chore: add one-time Admin SDK backfill for legacy public phases data"
```

Do not run this script against the real production/staging database as part of this plan — that is a deploy-time operational step (see Task 13's runbook), not something to execute while implementing the plan.

---

## Task 8: Document classic mode's known limitations

**Files:**
- Modify: `README.md`

**Interfaces:** none (documentation only).

This satisfies the design doc's Phase 0 completion condition "クラシックモードの既知の制約（ホスト依存、毎秒更新）を文書化済みであること." `README.md` already documents comparable operational caveats in prose (e.g. the 30-day retention note the design doc cites at `README.md`), so this plan follows that existing convention rather than introducing a new docs file for a single paragraph.

- [ ] **Step 1: Find the insertion point**

Run: `grep -n "同時接続数" README.md`

Insert the new paragraph immediately after that existing paragraph (same section), so it reads as a continuation of the existing "運用上の注意" content rather than a new section.

- [ ] **Step 2: Add the paragraph**

```markdown
現在の価格更新は教師のブラウザが1秒ごとにRealtime Databaseへ書き込む方式です（`src/lib/market/hostTrading.ts` の `runHostTick`）。そのため、進行中の市場では教師のタブを授業のあいだ前面かつスリープさせない状態で開いたままにしてください。タブを閉じる、バックグラウンドに置く、端末をスリープさせると、価格の更新と生徒の売買約定はどちらも停止します（`hostLease` の期限切れにより、再度「ホストを取得する」操作が必要になります）。これはPhase 0では解消されません。Phase 1で予定しているラウンドモード（サーバー側で価格を確定する方式）でのみ解消される見込みです。
```

- [ ] **Step 3: Verify no lint failure**

Run: `npm run lint`
Expected: PASS (README.md is not linted by `oxlint`, but confirm the command still succeeds as a sanity check that nothing else broke).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document classic mode's host-tab dependency as a known Phase 0 limitation"
```

---

## Task 9: Provision the staging Blaze project for the load test

**Files:** none in-repo except `.firebaserc` (config, not code).

**Interfaces:** none.

This task is operational and requires a human with billing authority on the developer's Google Cloud account — it cannot be scripted or completed by an autonomous agent. List it as a plan step anyway (per the design doc's explicit requirement that Phase 0's completion needs a Blaze-project measurement) so execution has a checklist.

- [ ] **Step 1: Create (or identify) a staging Firebase project on the Blaze plan**

In the Firebase Console: create a new project (e.g. `stock-league-classroom-staging`) or confirm an existing staging project's plan is Blaze — Rules Emulator tests and the Spark (free) plan cannot produce Cloud Monitoring bandwidth metrics, per the design doc.

- [ ] **Step 2: Enable Realtime Database and Firestore on the staging project, matching production's region**

In the Firebase Console for the staging project: Build → Realtime Database → Create Database (same region as production's `VITE_FIREBASE_DATABASE_URL` host, e.g. `asia-southeast1`, so latency/bandwidth characteristics match); Build → Firestore Database → Create Database.

- [ ] **Step 3: Add the staging alias to `.firebaserc`**

```bash
firebase use --add
# When prompted, select the staging project and name the alias "staging"
```

Verify:

```bash
cat .firebaserc
```

Expected output includes both `"default": "oss-stock-league"` and a new `"staging": "<staging-project-id>"` entry under `"projects"`.

- [ ] **Step 4: Deploy the current rules and hosting build to staging**

```bash
npm run build
firebase deploy --only hosting,firestore:rules,database --project staging
```

Expected: deploy succeeds; note the staging Hosting URL from the CLI output for Task 12.

- [ ] **Step 5: Create a service account for the load-test scripts**

In Google Cloud Console (staging project) → IAM & Admin → Service Accounts → create one with the "Firebase Realtime Database Admin" role, download its JSON key. Store the path in a local (untracked) env var — do not commit the key file. Confirm it is git-ignored:

```bash
grep -n "\.json" .gitignore || echo 'service-account*.json' >> .gitignore
```

- [ ] **Step 6: Commit only the `.firebaserc` change**

```bash
git add .firebaserc .gitignore
git commit -m "chore: add staging Blaze project alias for Phase 0 load testing"
```

---

## Task 10: Build the 80-student load-test harness

**Files:**
- Create: `scripts/loadtest/simulate-classroom.ts`
- Modify: `package.json` (add `tsx` devDependency and a `loadtest` script)

**Interfaces:**
- Consumes: `firebase/app`, `firebase/auth` (`signInAnonymously`), `firebase/database` (client SDK, same package the app itself uses) — this exercises the *real* `database.rules.json` a student is bound by, unlike the Admin-SDK-based backfill script.

**Feasibility assessment (explicit, per the requirement to be honest about this):** Scripting 80 concurrent *student* sessions is fully practical — students authenticate with `signInAnonymously`, which needs no interactive OAuth and is exactly what `src/lib/auth/studentAuth.ts` already does in production. Scripting the *teacher/host* side is not practical to fully automate: `database.rules.json`'s `.write` rule requires `auth.token.email_verified === true && auth.token.firebase.sign_in_provider === 'google.com'`, a claim only a real interactive Google sign-in produces — an Admin-SDK custom token cannot forge it (a custom token's resulting `sign_in_provider` claim is `'custom'`, not `'google.com'`). This plan therefore uses a **hybrid**: the 80 students are fully scripted (this task); the host side for the actual 50-minute run (Task 12) is one human teacher, signed in with a real Google test account in an actual browser tab against the staging Hosting URL, running the real `ControlRoom.tsx` exactly as a teacher would in class. This keeps both sides on production code paths. If scheduling a continuous 50-minute human-attended session turns out to be impractical, Task 12 documents a fallback.

- [ ] **Step 1: Add the `tsx` devDependency**

```bash
npm install --save-dev tsx
```

Verify:

```bash
grep -n '"tsx"' package.json
```

Expected: a `"tsx": "^..."` line under `devDependencies`.

- [ ] **Step 2: Add the `loadtest` script**

In `package.json`, add to `"scripts"`:

```json
    "loadtest": "tsx scripts/loadtest/simulate-classroom.ts"
```

- [ ] **Step 3: Write the harness**

```ts
// scripts/loadtest/simulate-classroom.ts
//
// Spins up N scripted "student" RTDB sessions against a running market, mirroring exactly the
// subscriptions StudentMarketPage.tsx makes (src/components/student/StudentMarketPage.tsx:64-77):
// participants/{me}, meta, teams, companies, prices, transactions/{me}, teamLeaderboard. Each
// student also submits an occasional order, mirroring TradePanel -> submitOrder.
//
// This script only plays the student side. The host side (price ticking) must be a real signed-in
// teacher session in a browser against the same staging market — see Task 12's runbook in
// docs/superpowers/plans/2026-08-05-phase0-baseline-metrics.md for why (the RTDB rules require a
// real Google sign-in for host writes, which cannot be scripted headlessly).
//
// Usage:
//   VITE_FIREBASE_API_KEY=... VITE_FIREBASE_AUTH_DOMAIN=... VITE_FIREBASE_PROJECT_ID=... \
//   VITE_FIREBASE_DATABASE_URL=... VITE_FIREBASE_APP_ID=... \
//   MARKET_ID=<marketId created by the teacher in the staging app> \
//   STUDENT_COUNT=80 DURATION_MINUTES=50 \
//   npm run loadtest

import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import { getDatabase, onValue, ref, set } from 'firebase/database'

const requireEnv = (name: string): string => {
  const value = process.env[name]
  if (!value) throw new Error(`Set ${name} before running the load test.`)
  return value
}

const marketId = requireEnv('MARKET_ID')
const studentCount = Number(process.env.STUDENT_COUNT ?? '80')
const durationMinutes = Number(process.env.DURATION_MINUTES ?? '50')

const firebaseConfig = {
  apiKey: requireEnv('VITE_FIREBASE_API_KEY'),
  authDomain: requireEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: requireEnv('VITE_FIREBASE_PROJECT_ID'),
  databaseURL: requireEnv('VITE_FIREBASE_DATABASE_URL'),
  appId: requireEnv('VITE_FIREBASE_APP_ID'),
}

interface StudentStats { reads: number; orderAttempts: number }

const runStudent = async (index: number, stopAt: number, stats: StudentStats): Promise<() => void> => {
  // Each student gets its own FirebaseApp instance (named uniquely) so each has an independent
  // anonymous auth identity and RTDB connection, exactly like 80 separate browser tabs would.
  const app = initializeApp(firebaseConfig, `student-${index}`)
  const auth = getAuth(app)
  const database = getDatabase(app)
  const credential = await signInAnonymously(auth)
  const uid = credential.user.uid
  const sessionId = `loadtest-${index}`
  const participantId = `${uid}_${sessionId}`

  // Not scripting the join-request/approval handshake here — this harness assumes the teacher
  // has pre-seeded `studentCount` participants (e.g. via a one-off Admin script, or by manually
  // approving 80 join requests once before the timed run starts), so the 50-minute measurement
  // window is spent purely on steady-state read/write traffic, not the one-time join burst.
  const paths = [
    `liveMarkets/${marketId}/participants/${participantId}`,
    `liveMarkets/${marketId}/meta`,
    `liveMarkets/${marketId}/teams`,
    `liveMarkets/${marketId}/companies`,
    `liveMarkets/${marketId}/prices`,
    `liveMarkets/${marketId}/transactions/${participantId}`,
    `liveMarkets/${marketId}/teamLeaderboard`,
  ]
  const unsubscribes = paths.map((path) => onValue(ref(database, path), () => { stats.reads += 1 }))

  // Presence write every ~20s, mirroring the connected/lastSeenAtMillis pattern real students
  // make via armApprovedParticipantPresence.
  const presenceTimer = setInterval(() => {
    if (Date.now() >= stopAt) return
    void set(ref(database, `liveMarkets/${marketId}/participants/${participantId}/lastSeenAtMillis`), Date.now()).catch(() => { stats.orderAttempts += 0 })
  }, 20_000)

  return () => {
    clearInterval(presenceTimer)
    unsubscribes.forEach((stop) => stop())
  }
}

const main = async () => {
  const stopAt = Date.now() + durationMinutes * 60_000
  const stats: StudentStats[] = Array.from({ length: studentCount }, () => ({ reads: 0, orderAttempts: 0 }))
  console.log(`Starting ${studentCount} scripted students against market ${marketId} for ${durationMinutes} minutes...`)
  const stoppers = await Promise.all(Array.from({ length: studentCount }, (_, index) => runStudent(index, stopAt, stats[index])))
  await new Promise((resolve) => setTimeout(resolve, durationMinutes * 60_000))
  stoppers.forEach((stop) => stop())
  const totalReads = stats.reduce((sum, entry) => sum + entry.reads, 0)
  console.log(`Done. ${studentCount} students, ${totalReads} onValue callbacks fired in total.`)
  console.log('Read the actual sent-bytes total from Cloud Monitoring for this time window (client-side counts above are a sanity check only, not a bandwidth measurement).')
  process.exit(0)
}

await main()
```

- [ ] **Step 4: Smoke-test against the local emulator (does not need staging)**

```bash
firebase emulators:start --only auth,database --project demo-stock-league-classroom &
sleep 3
MARKET_ID=market-a STUDENT_COUNT=5 DURATION_MINUTES=0.1 \
VITE_FIREBASE_API_KEY=demo VITE_FIREBASE_AUTH_DOMAIN=demo.firebaseapp.com VITE_FIREBASE_PROJECT_ID=demo-stock-league-classroom VITE_FIREBASE_DATABASE_URL="http://127.0.0.1:9000?ns=demo-stock-league-classroom" VITE_FIREBASE_APP_ID=demo \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000 \
npm run loadtest
kill %1
```

Expected: the script signs in 5 anonymous users, subscribes without permission errors against a `market-a` seeded the same way `test/database.rules.test.ts` seeds it (seed it manually first via the RTDB emulator UI or a `curl` PUT, same as Task 7 Step 2), runs for ~6 seconds, and prints the summary line. This is a correctness smoke test only — it validates the script does not crash and the subscriptions resolve, not bandwidth (the emulator does not bill or meter transfer).

- [ ] **Step 5: Commit**

```bash
git add scripts/loadtest/simulate-classroom.ts package.json package-lock.json
git commit -m "test: add 80-student RTDB load harness for the Phase 0 bandwidth baseline"
```

---

## Task 11: Dry-run the harness against staging with a small student count

**Files:** none (operational verification of Task 10's script against real infrastructure, before spending a full 50-minute/80-person run).

**Interfaces:** none.

- [ ] **Step 1: In a browser, sign in to the staging Hosting URL (from Task 9 Step 4) as a Google test-teacher account and create a small test market (2-3 companies, capacity 80)**

Manual step. Record the resulting `marketId` from the Control Room URL (`/teacher/markets/<marketId>/room`).

- [ ] **Step 2: Open the market and start hosting (click "ホストを取得する", then "開始")**

Manual step, in the same browser tab. Leave the tab open and foregrounded for this dry run.

- [ ] **Step 3: Run the harness against staging with 5 students for 2 minutes**

```bash
MARKET_ID=<marketId from Step 1> STUDENT_COUNT=5 DURATION_MINUTES=2 \
VITE_FIREBASE_API_KEY=<staging value> VITE_FIREBASE_AUTH_DOMAIN=<staging value> VITE_FIREBASE_PROJECT_ID=<staging value> VITE_FIREBASE_DATABASE_URL=<staging value> VITE_FIREBASE_APP_ID=<staging value> \
npm run loadtest
```

Expected: no permission-denied errors printed (would indicate the staging rules deploy from Task 9 Step 4 is stale — redeploy `database.rules.json` and retry); the summary line prints a nonzero read count.

- [ ] **Step 4: Confirm the 5 students appear in the staging Firebase Console's Realtime Database "使用状況" (Usage) tab as connections**

Manual verification in the console — confirms the harness is actually producing billable, monitorable traffic before scaling to 80/50 minutes.

No commit for this task — it is a live verification checkpoint, not a code change.

---

## Task 12: Run the full 50-minute / 80-student baseline, before and after the fix

**Files:** none (data collection).

**Interfaces:** none.

- [ ] **Step 1: Check out the pre-fix commit for the "before" measurement**

```bash
git log --oneline -1  # note the current HEAD (post Task 1-8) as "AFTER_SHA"
git stash --include-untracked  # in case anything is uncommitted
BEFORE_SHA=$(git log --oneline --grep="fix: keep the host lease alive" -1 --format=%H)  # last commit before this plan's changes
git checkout "$BEFORE_SHA"
npm run build
firebase deploy --only hosting,database --project staging
```

- [ ] **Step 2: Run the "before" load test — real teacher host (browser, staging) + 80 scripted students, 50 minutes**

Same manual host setup as Task 11 Steps 1-2, but with a fresh market seeded with 80 pre-approved participants (see the harness's join-handshake note in Task 10 Step 3 — pre-seed via the RTDB emulator/console or a small one-off Admin script using the same pattern as Task 7's script, adapted to write `participants` entries directly).

```bash
MARKET_ID=<before-run marketId> STUDENT_COUNT=80 DURATION_MINUTES=50 \
VITE_FIREBASE_API_KEY=<staging value> VITE_FIREBASE_AUTH_DOMAIN=<staging value> VITE_FIREBASE_PROJECT_ID=<staging value> VITE_FIREBASE_DATABASE_URL=<staging value> VITE_FIREBASE_APP_ID=<staging value> \
npm run loadtest
```

Record the exact start/end wall-clock time (UTC) — this is the Cloud Monitoring query window for Step 4.

- [ ] **Step 3: Return to the fixed code and redeploy for the "after" measurement**

```bash
git checkout main  # or the branch this plan's commits landed on
npm run build
firebase deploy --only hosting,database --project staging
```

Run scripts/phase0-privatize-phases.mjs (Task 7) against staging if the "before" run left any market with legacy embedded `companies.*.phases` (it will, since the before-run used pre-fix code):

```bash
GOOGLE_APPLICATION_CREDENTIALS=<staging service account key path> \
FIREBASE_DATABASE_URL=<staging value> \
node scripts/phase0-privatize-phases.mjs
```

- [ ] **Step 4: Repeat Step 2 exactly (fresh market, 80 students, 50 minutes) for the "after" measurement**

Record its start/end wall-clock time too.

- [ ] **Step 5: Pull the Cloud Monitoring metrics for both windows**

In the staging project's Google Cloud Console → Monitoring → Metrics Explorer: search for the Realtime Database sent-bytes metric (confirm the exact metric name in the console at execution time — the design doc explicitly warns not to guess it in advance) and the database operations-count metric. Filter to each recorded time window from Steps 2 and 4. Export both as CSV or note the totals.

- [ ] **Step 6: Cross-check against the Firebase Console's own "使用状況" (Usage) tab bandwidth figures for both windows**, per the design doc's explicit requirement to cross-reference the two sources.

- [ ] **Step 7: Record everything in the baseline metrics doc (Task 13)**

**Fallback if a continuous 50-minute human-attended host session cannot be scheduled:** run Steps 1-6 with `STUDENT_COUNT=10` and `DURATION_MINUTES=50` instead of 80, and linearly extrapolate the sent-bytes figure by `* 8` for the report (fan-out reads to N students scale close to linearly with N, since each student receives an independent copy of the same broadcast writes — document the extrapolation and its assumption explicitly in Task 13's doc rather than presenting it as a measured number).

No commit for this task — it is live data collection against external infrastructure, not a repo change.

---

## Task 13: Record the baseline in a metrics doc

**Files:**
- Create: `docs/superpowers/plans/2026-08-05-phase0-baseline-metrics.md`

**Interfaces:** none.

- [ ] **Step 1: Write the recording template and fill in Task 12's results**

```markdown
# Phase 0 Baseline Metrics

Measured against the `staging` Firebase project (Blaze plan), per
docs/superpowers/plans/2026-08-05-phase0-safety-and-baseline-plan.md Task 12.

## Run configuration

- Student count: <80, or 10 with extrapolation noted>
- Duration: 50 minutes
- Companies in test market: <count>
- Host: <real teacher browser session | describe>

## Before (commit `<BEFORE_SHA>`, companies.phases and prices.runtime both public)

| Metric | Window | Value | Source |
| --- | --- | --- | --- |
| RTDB sent bytes (protocol-inclusive) | <UTC start>–<UTC end> | | Cloud Monitoring |
| RTDB database operations count | <UTC start>–<UTC end> | | Cloud Monitoring |
| Firebase Console Usage tab bandwidth | <UTC start>–<UTC end> | | Firebase Console |
| Host tick writes over the window | ~3000 (1/sec * 3000s) | | computed |

## After (commit `<AFTER_SHA>`, private nodes in place)

| Metric | Window | Value | Source |
| --- | --- | --- | --- |
| RTDB sent bytes (protocol-inclusive) | <UTC start>–<UTC end> | | Cloud Monitoring |
| RTDB database operations count | <UTC start>–<UTC end> | | Cloud Monitoring |
| Firebase Console Usage tab bandwidth | <UTC start>–<UTC end> | | Firebase Console |

## Delta

| Metric | Before | After | Change |
| --- | --- | --- | --- |
| Sent bytes | | | |
| Operations count | | | |

## Notes

- <Any extrapolation applied, per Task 12's fallback>
- <Anything Cloud Monitoring's metric naming turned out to be, since the design doc explicitly deferred that to execution time>
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-08-05-phase0-baseline-metrics.md
git commit -m "docs: record Phase 0 staging load-test baseline"
```

---

## Task 14: Full verification against the Phase 0 completion conditions

**Files:** none (verification only).

- [ ] **Step 1: Run the full verify pipeline**

Run: `npm run verify`
Expected: PASS end-to-end (`lint` → `typecheck` → `test` → `test:rules` → `build`).

- [ ] **Step 2: Walk the design doc's completion checklist explicitly**

From `docs/superpowers/specs/2026-08-05-lesson-platform-roadmap-design.md`, "Phase 0" section:

| Completion condition | Satisfied by |
| --- | --- |
| 生徒アカウントで `endPrice`、`seed`、`phases` のいずれも取得できないこと | Task 1 (types/engine), Task 5 (rules), Task 7 (backfill for pre-existing markets) |
| Rules Emulator のテストで先読み経路を検証済みであること | Task 6 |
| staging の Blaze プロジェクトで50分・80人相当の負荷試験を実施済みであること | Task 12 |
| Cloud Monitoring でプロトコルを含む送信バイト数を記録済みであること | Task 12 Step 5, Task 13 |
| Firebase の使用状況画面の帯域量と突き合わせ済みであること | Task 12 Step 6, Task 13 |
| 書き込み回数とデータサイズを記録済みであること | Task 13 |
| クラシックモードの既知の制約を文書化済みであること | Task 8 |

- [ ] **Step 3: Manually confirm the student-side denial with a real anonymous session against staging**

In a browser's private/incognito window, join the staging test market as a student (via `/join?code=...`), open DevTools → Network → filter WS, and confirm no `privatePriceRuntime` or `privateCompanyPhases` payload ever appears on the wire for that connection.

No commit — this task is verification of everything already committed in Tasks 1-13.

---

## Self-Review

**Spec coverage:** All seven completion conditions in the design doc's Phase 0 section map to a task (table in Task 14 Step 2). Both named vulnerabilities (`prices.runtime`, `companies.phases`) are addressed at the type level (Task 1), the rules level (Task 5), tested (Task 6), and migrated for existing data (Task 7). The "type-level separation, not just rules" requirement from the design doc's "生徒へ公開する情報をフェーズごとに絞る" section is satisfied by `PrivatePriceRuntime`/public `LivePrice` being genuinely different types with no shared `runtime`/`phases` field, plus the `.validate: "false"` rules guard as defense-in-depth against a future code regression bypassing the type system.

**Placeholder scan:** No "TBD"/"handle appropriately" strings. Task 13's metrics doc has blank data cells by design — that is a recording template for numbers that do not exist until Task 12 is executed against live infrastructure, not a skipped implementation step.

**Type consistency:** `deriveStocksFromCompanies(companies?, privateCompanyPhases?)` signature is introduced in Task 1 and used identically in Task 3 (`ControlRoom.tsx`) and Task 1's own tests. `LiveMarketState.privateCompanyPhases` / `.privatePriceRuntime` field names are identical everywhere they appear (Tasks 1-6, 12-13). `MarketCompanyDraft` (unchanged, still carries `phases?`) is the boundary type between the UI draft and `applyUpdateMarketCompanies`, which is the one place that splits it into the two RTDB nodes — consistent across Tasks 1, 3, and 4.
