# ランディングページ（root `/`）コンテンツ整備 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the nearly-empty root landing page (`LandingPage` in `src/App.tsx`) with a content-rich page that explains what Stock League Classroom is, honestly states the current Phase A status, and introduces the two supported subjects and the future lesson flow — without adding any new images or illustrations.

**Architecture:** Extract `LandingPage` out of the 1360-line `src/App.tsx` into its own file (`src/components/LandingPage.tsx`), matching the existing pattern already used for `PublicDocs.tsx`. Add five new sections (hero, features strip, subjects, lesson flow) between the existing header nav and the existing closing/footer, which are left unchanged. All new content uses plain semantic HTML (`<section>`, `<h1>`–`<h3>`, `<p>`, `<ul>`, `<ol>`) styled via new `landing-*` CSS classes in `src/App.css`, matching the codebase's existing convention of native tags for landing-page content and MUI components (`Button`, `Alert`, `Stack`) only for interactive elements — exactly as the current `landing-closing` section already does.

**Tech Stack:** React 19, TypeScript, MUI v6 (`@mui/material`), `react-router`, Vitest + Testing Library (existing test stack, no new dependencies).

## Global Constraints

- No new npm dependencies. No new image assets (the "実際の画面" screenshot section is deferred to a future spec — see `docs/superpowers/specs/2026-08-17-landing-page-content-design.md`).
- Copy text must match `docs/superpowers/specs/2026-08-17-landing-page-content-design.md` verbatim (Japanese strings below are copied from that spec).
- New sections use plain semantic HTML tags for headings/paragraphs/lists (not MUI `Typography`), matching the existing `landing-closing` section's pattern. MUI is used only for `Button`, `Alert`, and `Stack` (layout).
- All new CSS classes are prefixed `landing-` and added to `src/App.css`, reusing the existing CSS custom properties defined on `.landing-page` (`--landing-text`, `--landing-text-muted`, `--landing-accent`, `--landing-cta`, etc.) — no new custom properties unless a section needs a color not already defined.
- Existing routes, nav links (使い方→`/guide`, 特徴→`/about`, 詳しく見る→`/about`), and the closing section's CTA (`/about`) are unchanged.
- `src/assets/hero.png` (unused) is deleted.
- Every task must leave `npm test` (`vitest run`) green before its commit.

---

## File Structure

- **Create:** `src/components/LandingPage.tsx` — the extracted and expanded landing page component (moved out of `src/App.tsx`).
- **Create:** `src/components/LandingPage.test.tsx` — dedicated tests for the new landing-page content sections, following the pattern of `src/components/PublicDocs.test.tsx`.
- **Modify:** `src/App.tsx` — remove the inline `LandingPage` definition and `landingCtaSx` constant; import `LandingPage` from the new file instead.
- **Modify:** `src/App.css` — add CSS for the five new sections (hero, features, subjects, flow) plus their mobile breakpoint rules.
- **Modify:** `src/App.test.tsx` — the existing CTA test (`'keeps every landing-page CTA within the surviving public routes'`) currently expects exactly one link named `/サービス概要を見る/i`; the new hero section adds a second link with the same accessible name, so this assertion must switch from `getByRole` (single match) to `getAllByRole` (multiple matches, all pointing to `/about`).
- **Delete:** `src/assets/hero.png` (confirmed unused, per the design spec).

---

## Task 1: Extract `LandingPage` into its own file

**Files:**
- Create: `src/components/LandingPage.tsx`
- Modify: `src/App.tsx:94-115` (remove `landingCtaSx` and the inline `LandingPage` definition; add import)
- Test: `src/App.test.tsx` (existing tests only — no new tests in this task)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export const LandingPage: () => React.JSX.Element` from `src/components/LandingPage.tsx`, importable as `import { LandingPage } from './components/LandingPage'` from `src/App.tsx`.

This task is a pure refactor — no behavior change. The existing test suite is the safety net.

- [ ] **Step 1: Run the existing test suite to confirm the baseline is green**

Run: `npm test -- App.test.tsx`
Expected: All tests in `src/App.test.tsx` PASS (including `'keeps every landing-page CTA within the surviving public routes'`).

- [ ] **Step 2: Create `src/components/LandingPage.tsx` with the current landing page content, moved as-is**

```tsx
import { Link as RouterLink } from 'react-router'
import { Box, Button, Link, Stack, Typography } from '@mui/material'

const landingCtaSx = {
  backgroundColor: 'var(--landing-cta)',
  color: 'var(--landing-on-cta)',
  '&:hover': { backgroundColor: 'var(--landing-cta-hover)' },
}

/**
 * The lesson product is not wired up during Phase A. Every CTA stays within
 * the public surface until the new lesson routes arrive in later phases.
 */
export const LandingPage = () => <main className="landing-page">
  <Box component="header" className="landing-nav">
    <Link component={RouterLink} className="brand" to="/" underline="none" color="inherit" aria-label="Stock League Classroom ホーム" sx={{ minHeight: 48, display: 'inline-flex', alignItems: 'center' }}>Stock League <span>Classroom</span></Link>
    <Stack component="nav" direction="row" aria-label="主要ナビゲーション" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
      <Link component={RouterLink} to="/guide" color="inherit" sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', px: 1 }}>使い方</Link>
      <Link component={RouterLink} to="/about" color="inherit" sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', px: 1 }}>特徴</Link>
      <Button component={RouterLink} className="nav-cta" to="/about" variant="contained" sx={{ ...landingCtaSx, minHeight: 44 }}>詳しく見る</Button>
    </Stack>
  </Box>
  <section className="landing-closing"><p>準備を進めています。</p><h2>まもなく教室に市場をひらけます。</h2><Button component={RouterLink} to="/about" variant="contained" size="large" sx={{ backgroundColor: 'var(--landing-closing-cta)', color: 'var(--landing-closing-on-cta)', '&:hover': { backgroundColor: 'var(--landing-closing-cta-hover)' } }}>サービス概要を見る <span aria-hidden="true">→</span></Button></section>
  <Box component="footer"><Typography component="span" variant="body2">© 2026 Stock League Classroom</Typography><Stack component="nav" direction="row" aria-label="サービス情報" sx={{ flexWrap: 'wrap', gap: { xs: 0.5, sm: 1.5 } }}>{[['/about', 'サービス概要'], ['/guide', '操作マニュアル'], ['/terms', '利用規約'], ['/privacy', 'プライバシーポリシー'], ['/contact', '問い合わせ']].map(([to, label]) => <Link component={RouterLink} to={to} color="inherit" key={to} sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', px: 0.5 }}>{label}</Link>)}</Stack></Box>
</main>
```

- [ ] **Step 3: Remove the inline definition from `src/App.tsx` and import from the new file**

In `src/App.tsx`, delete lines 94-115 (the `landingCtaSx` constant and the `LandingPage` component, including its JSDoc comment). Add this import near the other component imports (next to the `PublicDocs` import, around line 8):

```tsx
import { LandingPage } from './components/LandingPage'
```

- [ ] **Step 4: Run the test suite to confirm nothing broke**

Run: `npm test -- App.test.tsx`
Expected: Same tests PASS as in Step 1 — no behavior change.

- [ ] **Step 5: Commit**

```bash
git add src/components/LandingPage.tsx src/App.tsx
git commit -m "refactor: extract LandingPage out of App.tsx"
```

---

## Task 2: Add the hero section

**Files:**
- Modify: `src/components/LandingPage.tsx`
- Modify: `src/App.css`
- Modify: `src/App.test.tsx:134-140` (the CTA test needs `getAllByRole` for the now-duplicated "サービス概要を見る" link name)
- Create: `src/components/LandingPage.test.tsx`

**Interfaces:**
- Consumes: `landingCtaSx` (defined in Task 1, same file).
- Produces: nothing new consumed by later tasks (each section task is independent).

- [ ] **Step 1: Write the failing test in the new `src/components/LandingPage.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BrowserRouter } from 'react-router'
import { LandingPage } from './LandingPage'

const renderLandingPage = () => render(<BrowserRouter><LandingPage /></BrowserRouter>)

describe('LandingPage', () => {
  it('shows the hero headline, subtitle, and Phase A notice', () => {
    renderLandingPage()
    expect(screen.getByRole('heading', { level: 1, name: '教室に、市場をひらこう。' })).toBeInTheDocument()
    expect(screen.getByText('生徒が情報を読み、判断し、結果から学ぶ。社会科・家庭科で使える、サーバーが進行を守る授業シミュレーターです。')).toBeInTheDocument()
    expect(screen.getByText('現在は公開ページのみ提供中です。授業機能は準備を進めています。')).toBeInTheDocument()
  })

  it('offers a secondary CTA to the guide page from the hero', () => {
    renderLandingPage()
    expect(screen.getByRole('link', { name: '操作マニュアル' })).toHaveAttribute('href', '/guide')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- LandingPage.test.tsx`
Expected: FAIL — `Unable to find role="heading" ... 教室に、市場をひらこう。` (the file doesn't exist yet as a test target with this content, or the heading is missing).

- [ ] **Step 3: Add the hero section markup to `src/components/LandingPage.tsx`**

Add the `Alert` import, and insert the hero `<section>` between the closing `</Box>` of the header and the existing `<section className="landing-closing">`:

```tsx
import { Link as RouterLink } from 'react-router'
import { Alert, Box, Button, Link, Stack, Typography } from '@mui/material'
```

```tsx
  <section className="landing-hero">
    <p className="landing-hero-badge">教室向け 投資・生活設計シミュレーター</p>
    <h1>教室に、市場をひらこう。</h1>
    <p className="landing-hero-subtitle">生徒が情報を読み、判断し、結果から学ぶ。社会科・家庭科で使える、サーバーが進行を守る授業シミュレーターです。</p>
    <Alert severity="info" className="landing-hero-notice">現在は公開ページのみ提供中です。授業機能は準備を進めています。</Alert>
    <Stack direction="row" spacing={2} className="landing-hero-ctas">
      <Button component={RouterLink} to="/about" variant="contained" size="large" sx={landingCtaSx}>サービス概要を見る</Button>
      <Button component={RouterLink} to="/guide" variant="outlined" size="large">操作マニュアル</Button>
    </Stack>
  </section>
```

- [ ] **Step 4: Add hero CSS to `src/App.css`**

Insert after the `.landing-nav` rule block (after line 33, before `.landing-closing`):

```css
.landing-hero { max-width: 900px; margin: 0 auto; padding: 60px 32px 40px; text-align: center; }
.landing-hero-badge { display: inline-block; margin-bottom: 20px; padding: 6px 14px; border-radius: 999px; background: var(--landing-closing-cta); color: var(--landing-closing-on-cta); font-size: 13px; font-weight: 700; letter-spacing: .3px; }
.landing-hero h1 { margin: 0 0 18px; color: var(--landing-text); font-size: clamp(32px, 5vw, 56px); line-height: 1.15; letter-spacing: -2px; }
.landing-hero-subtitle { max-width: 620px; margin: 0 auto 22px; color: var(--landing-text-muted); font-size: 17px; line-height: 1.7; }
.landing-hero-notice { max-width: 560px; margin: 0 auto 28px; text-align: left; }
.landing-hero-ctas { justify-content: center; flex-wrap: wrap; }
```

Add to the existing mobile media query block (inside `@media (max-width: 760px)`, after the `.landing-nav` rule):

```css
  .landing-hero { padding: 40px 20px 28px; }
  .landing-hero-ctas { flex-direction: column; align-items: stretch; }
```

- [ ] **Step 5: Fix the now-ambiguous CTA test in `src/App.test.tsx`**

The hero adds a second link named "サービス概要を見る" (the closing section already has one). Replace the single-match assertion at line 139 with a multi-match one:

```tsx
  it('keeps every landing-page CTA within the surviving public routes', () => {
    render(<App />)
    expect(screen.getByRole('link', { name: '使い方' })).toHaveAttribute('href', '/guide')
    expect(screen.getByRole('link', { name: '特徴' })).toHaveAttribute('href', '/about')
    expect(screen.getByRole('link', { name: /詳しく見る/i })).toHaveAttribute('href', '/about')
    for (const link of screen.getAllByRole('link', { name: /サービス概要を見る/i })) {
      expect(link).toHaveAttribute('href', '/about')
    }
    expect(screen.getByRole('link', { name: '操作マニュアル' })).toHaveAttribute('href', '/guide')
  })
```

- [ ] **Step 6: Run both test files to verify everything passes**

Run: `npm test -- LandingPage.test.tsx App.test.tsx`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/LandingPage.tsx src/components/LandingPage.test.tsx src/App.css src/App.test.tsx
git commit -m "feat: add hero section to landing page"
```

---

## Task 3: Add the features strip

**Files:**
- Modify: `src/components/LandingPage.tsx`
- Modify: `src/App.css`
- Modify: `src/components/LandingPage.test.tsx`

**Interfaces:**
- Consumes: nothing from Task 2.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Add to `src/components/LandingPage.test.tsx`:

```tsx
  it('lists the three product principles', () => {
    renderLandingPage()
    expect(screen.getByText('今、必要な判断だけ。')).toBeInTheDocument()
    expect(screen.getByText('なぜ起きたかまで扱う。')).toBeInTheDocument()
    expect(screen.getByText('サーバーが進行を守る。')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- LandingPage.test.tsx`
Expected: FAIL — `Unable to find an element with the text: 今、必要な判断だけ。`

- [ ] **Step 3: Add the features section markup**

Insert directly after the hero `</section>`, before `<section className="landing-closing">`:

```tsx
  <section className="landing-features" aria-label="特徴">
    <ul>
      <li><strong>今、必要な判断だけ。</strong>生徒の画面には今取るべき行動だけを表示。情報過多にしない。</li>
      <li><strong>なぜ起きたかまで扱う。</strong>結果だけでなく「何が起きたか→なぜ→次にどうするか」を振り返る設計。</li>
      <li><strong>サーバーが進行を守る。</strong>教師のブラウザに依存しない設計。スリープや通信断で授業が止まらない。</li>
    </ul>
  </section>
```

- [ ] **Step 4: Add features CSS to `src/App.css`**

Insert after the hero CSS block added in Task 2:

```css
.landing-features { max-width: 1112px; margin: 0 auto; padding: 12px 32px 56px; }
.landing-features ul { display: flex; flex-wrap: wrap; gap: 20px; margin: 0; padding: 0; list-style: none; }
.landing-features li { flex: 1 1 260px; padding: 18px 20px; border-radius: 16px; background: #fff; box-shadow: 0 6px 18px #164a8a0f; color: var(--landing-text-muted); font-size: 14px; line-height: 1.7; }
.landing-features li strong { display: block; margin-bottom: 6px; color: var(--landing-text); font-size: 15px; }
```

Add to the mobile media query block:

```css
  .landing-features { padding: 8px 20px 40px; }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- LandingPage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/LandingPage.tsx src/components/LandingPage.test.tsx src/App.css
git commit -m "feat: add features strip to landing page"
```

---

## Task 4: Add the subjects section

**Files:**
- Modify: `src/components/LandingPage.tsx`
- Modify: `src/App.css`
- Modify: `src/components/LandingPage.test.tsx`

**Interfaces:**
- Consumes: nothing from Task 3.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Add to `src/components/LandingPage.test.tsx`:

```tsx
  it('introduces both supported subjects', () => {
    renderLandingPage()
    expect(screen.getByRole('heading', { level: 3, name: '社会科｜市場経済シミュレーション' })).toBeInTheDocument()
    expect(screen.getByText('需要と供給、企業と産業のつながり、景気と政策。常時売買市場で、情報をもとに投資判断を積み重ねます。')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: '家庭科｜生活設計シミュレーション' })).toBeInTheDocument()
    expect(screen.getByText('学生から退職後まで、人生の各段階を疑似体験。1ラウンド＝5年（設定変更可）で、家計と資産形成を考えます。役割別・段階分担など、クラスの人数構成に合わせた進行形式にも対応予定。')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- LandingPage.test.tsx`
Expected: FAIL — `Unable to find role="heading" and level=3 with name "社会科｜市場経済シミュレーション"`

- [ ] **Step 3: Add the subjects section markup**

Insert directly after the features `</section>`, before `<section className="landing-closing">`:

```tsx
  <section className="landing-subjects">
    <h2>対象科目</h2>
    <div className="subject-card-list">
      <article className="subject-card">
        <h3>社会科｜市場経済シミュレーション</h3>
        <p>需要と供給、企業と産業のつながり、景気と政策。常時売買市場で、情報をもとに投資判断を積み重ねます。</p>
      </article>
      <article className="subject-card">
        <h3>家庭科｜生活設計シミュレーション</h3>
        <p>学生から退職後まで、人生の各段階を疑似体験。1ラウンド＝5年（設定変更可）で、家計と資産形成を考えます。役割別・段階分担など、クラスの人数構成に合わせた進行形式にも対応予定。</p>
      </article>
    </div>
  </section>
```

- [ ] **Step 4: Add subjects CSS to `src/App.css`**

Insert after the features CSS block added in Task 3:

```css
.landing-subjects { max-width: 1112px; margin: 0 auto; padding: 40px 32px; }
.landing-subjects h2 { margin: 0 0 24px; color: var(--landing-text); font-size: clamp(22px, 3vw, 28px); }
.subject-card-list { display: flex; flex-wrap: wrap; gap: 24px; }
.subject-card { flex: 1 1 320px; padding: 28px 26px; border-radius: 20px; background: #fff; box-shadow: 0 8px 24px #164a8a12; }
.subject-card h3 { margin: 0 0 10px; color: var(--landing-accent); font-size: 18px; }
.subject-card p { margin: 0; color: var(--landing-text-muted); font-size: 14px; line-height: 1.8; }
```

Add to the mobile media query block:

```css
  .landing-subjects { padding: 28px 20px; }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- LandingPage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/LandingPage.tsx src/components/LandingPage.test.tsx src/App.css
git commit -m "feat: add subjects section to landing page"
```

---

## Task 5: Add the lesson flow section

**Files:**
- Modify: `src/components/LandingPage.tsx`
- Modify: `src/App.css`
- Modify: `src/components/LandingPage.test.tsx`

**Interfaces:**
- Consumes: nothing from Task 4.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Add to `src/components/LandingPage.test.tsx`:

```tsx
  it('lays out the six-step lesson flow in order', () => {
    renderLandingPage()
    const steps = screen.getAllByRole('listitem').filter((item) => item.closest('.landing-flow-steps'))
    expect(steps.map((item) => item.querySelector('strong')?.textContent)).toEqual([
      '教材をつくる',
      '授業を実施する',
      '生徒が参加する',
      '教室に表示する',
      '売買する',
      '結果を振り返る',
    ])
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- LandingPage.test.tsx`
Expected: FAIL — `expected [] to equal ['教材をつくる', ...]` (no `.landing-flow-steps` list items exist yet).

- [ ] **Step 3: Add the lesson flow section markup**

Insert directly after the subjects `</section>`, before `<section className="landing-closing">`:

```tsx
  <section className="landing-flow">
    <h2>授業の流れ</h2>
    <ol className="landing-flow-steps">
      <li><strong>教材をつくる</strong><span>目標を選んで、授業の骨格を用意します</span></li>
      <li><strong>授業を実施する</strong><span>教師が進行を管理します</span></li>
      <li><strong>生徒が参加する</strong><span>端末から授業に加わります</span></li>
      <li><strong>教室に表示する</strong><span>クラス全体の状況を共有します</span></li>
      <li><strong>売買する</strong><span>情報をもとに判断し、取引します</span></li>
      <li><strong>結果を振り返る</strong><span>何が起きたか、なぜかを確認します</span></li>
    </ol>
  </section>
```

- [ ] **Step 4: Add lesson flow CSS to `src/App.css`**

Insert after the subjects CSS block added in Task 4:

```css
.landing-flow { max-width: 1112px; margin: 0 auto; padding: 16px 32px 56px; }
.landing-flow h2 { margin: 0 0 24px; color: var(--landing-text); font-size: clamp(22px, 3vw, 28px); }
.landing-flow-steps { display: flex; flex-wrap: wrap; gap: 16px; margin: 0; padding: 0; list-style: none; counter-reset: flow-step; }
.landing-flow-steps li { flex: 1 1 150px; padding: 16px 14px; border-radius: 14px; background: #fff; box-shadow: 0 4px 14px #164a8a0f; counter-increment: flow-step; }
.landing-flow-steps li::before { content: counter(flow-step); display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; margin-bottom: 8px; border-radius: 50%; background: var(--landing-accent); color: #fff; font-size: 12px; font-weight: 700; }
.landing-flow-steps li strong { display: block; margin: 2px 0 4px; color: var(--landing-text); font-size: 14px; }
.landing-flow-steps li span { color: var(--landing-text-muted); font-size: 12px; line-height: 1.6; }
```

Add to the mobile media query block:

```css
  .landing-flow { padding: 8px 20px 40px; }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- LandingPage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/LandingPage.tsx src/components/LandingPage.test.tsx src/App.css
git commit -m "feat: add lesson flow section to landing page"
```

---

## Task 6: Remove the unused hero.png and do final verification

**Files:**
- Delete: `src/assets/hero.png`
- Test: full suite + manual browser check

**Interfaces:**
- Consumes: the fully assembled `LandingPage` from Tasks 1-5.
- Produces: nothing (final task).

- [ ] **Step 1: Confirm `hero.png` really is unused**

Run: `grep -rn "hero.png" src`
Expected: no output (already confirmed during design; re-confirm before deleting).

- [ ] **Step 2: Delete the file**

```bash
git rm src/assets/hero.png
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: All tests PASS, including `src/App.test.tsx`, `src/components/LandingPage.test.tsx`, and `src/components/PublicDocs.test.tsx`.

- [ ] **Step 4: Run lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: Both exit 0 with no errors.

- [ ] **Step 5: Manually verify the page in a browser at desktop and mobile widths**

Start the dev server (e.g. via the project's preview tooling) and open `/`. Confirm:
- The hero, features strip, subjects section, and lesson flow section all render in order between the nav and the existing closing section.
- No horizontal scroll or overlapping text at a 375px-wide viewport.
- The `使い方` / `特徴` / `詳しく見る` nav links and the closing section's CTA still point to `/guide` / `/about` / `/about` / `/about` respectively (unchanged from before this plan).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove unused hero.png asset"
```
