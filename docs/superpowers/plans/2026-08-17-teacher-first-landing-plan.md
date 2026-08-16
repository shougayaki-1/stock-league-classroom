# Teacher-First Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the root landing page so a teacher can quickly judge whether Stock League Classroom fits a lesson, understand what students and teachers do, and find school-use reassurance without reading implementation details.

**Architecture:** Keep the existing public route and `LandingPage` component, but replace its information hierarchy and copy. Add focused component tests for the teacher-facing content, then update `LandingPage.tsx` and `App.css` without changing authenticated lesson routes or Firebase behavior.

**Tech Stack:** React 19, React Router 7, MUI 9, Vitest, Testing Library, CSS.

## Global Constraints

- The primary audience is a teacher considering first-time classroom adoption.
- Lead with lesson fit and classroom use, not server/API/implementation architecture.
- Do not claim unsupported target grades, lesson duration, student-account requirements, or formal pricing.
- State clearly that the lesson functions are still being prepared.
- State clearly that the simulation uses no real money and uses fictional companies/prices/news.
- Keep social studies/public/politics-and-economics and home economics/family-basics/family-studies as the supported subject framing.
- Preserve the existing public document routes and footer links.
- Keep tap targets and heading hierarchy accessible and preserve mobile responsiveness.

---

### Task 1: Lock the teacher-facing information hierarchy with tests

**Files:**
- Create: `src/components/LandingPage.test.tsx`

**Interfaces:**
- Consumes: `LandingPage` from `src/components/LandingPage.tsx` rendered inside `MemoryRouter`.
- Produces: Regression coverage for the teacher-first hero, quick-decision facts, lesson examples, teacher workflow, school-use reassurance, current availability, and absence of server-centric copy.

- [ ] **Step 1: Write the failing test**

Create tests that require:

```tsx
expect(screen.getByRole('heading', { level: 1, name: /社会科・家庭科/ })).toBeInTheDocument()
expect(screen.getByText(/実際のお金は使いません/)).toBeInTheDocument()
expect(screen.getByText(/架空の会社/)).toBeInTheDocument()
expect(screen.getByRole('heading', { name: 'どんな授業ができる？' })).toBeInTheDocument()
expect(screen.getByRole('heading', { name: '先生は何をすればいい？' })).toBeInTheDocument()
expect(screen.getByRole('heading', { name: '学校で使ううえで気になること' })).toBeInTheDocument()
expect(screen.getByText(/授業機能は準備中/)).toBeInTheDocument()
expect(screen.queryByText(/サーバーが進行を守る/)).not.toBeInTheDocument()
```

Also keep coverage that `/about`, `/guide`, `/privacy`, `/terms`, and `/contact` remain linked from the rendered landing page.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- src/components/LandingPage.test.tsx
```

Expected: FAIL because the current landing page still uses the old hero/feature hierarchy and lacks the new teacher-decision sections.

- [ ] **Step 3: Commit the failing test**

```bash
git add src/components/LandingPage.test.tsx
git commit -m "test: define teacher-first landing requirements"
```

---

### Task 2: Implement the teacher-first landing page

**Files:**
- Modify: `src/components/LandingPage.tsx`
- Modify: `src/App.css`

**Interfaces:**
- Consumes: Existing React Router public routes and MUI components.
- Produces: A root landing page organized around lesson fit, classroom activity, teacher workload, school-use reassurance, and transparent availability.

- [ ] **Step 1: Replace the hero copy**

Use a teacher-oriented hero such as:

```text
社会科・家庭科に、判断して振り返るシミュレーション授業を。
生徒が情報を読み、選び、結果を見て、「なぜそうなったか」を考える授業を教室で実施できます。
```

Keep a clear preparation-status notice. Do not mention server architecture in the hero.

- [ ] **Step 2: Add a quick-decision section**

Add a compact `導入前に、まず知っておきたいこと` section containing only verified facts:

```text
対象科目: 社会科・公共・政治経済 / 家庭科・家庭基礎・家庭総合
実際のお金: 使いません
教材内の会社・価格・ニュース: 授業用の架空データ
利用環境: ブラウザで利用する教室向けサービス
提供状況: 授業機能は準備中
```

Do not publish an unsupported grade range, fixed lesson duration, or final lesson-function pricing.

- [ ] **Step 3: Rewrite subject cards as lesson experiences**

Add `どんな授業ができる？` and describe what students actually do:

```text
社会科: 情報やニュースを読む → 投資判断をする → 市場の変化を見る → 価格が動いた理由を考える
家庭科: 収入・支出・住宅・保険・資産形成などを選ぶ → 人生を進める → 選択の違いを比較して振り返る
```

- [ ] **Step 4: Rewrite the flow around teacher workload**

Add `先生は何をすればいい？` with four concise steps:

```text
1. 授業を選ぶ・つくる
2. 生徒に参加方法を案内する
3. 授業を開始して進行する
4. 結果をクラスで振り返る
```

Avoid internal terms such as lessonRun, server authority, RTDB, Firestore, or batch execution.

- [ ] **Step 5: Add school-use reassurance**

Add `学校で使ううえで気になること` using short question/answer cards or rows. Include:

```text
実際のお金は動く？ → 動きません。授業用シミュレーションです。
実在企業の株価を扱う？ → 扱いません。会社・価格・ニュースは架空です。
個人情報は？ → 生徒の個人情報を不要に取得しない方針で、表示名には本名を使わないよう案内します。
先生の端末が一時的に不安定になったら？ → 授業の進行を先生の1台の端末だけに依存させない設計です。
```

Technical implementation details belong in secondary documentation, not the landing-page headline copy.

- [ ] **Step 6: Update CTAs and current-availability block**

Keep CTAs within existing public routes while lesson functions are not publicly available. Prefer labels that answer a teacher's next question, such as `詳しい利用条件を見る`, `教師向け案内を見る`, and `問い合わせる`.

- [ ] **Step 7: Style the new hierarchy**

Use the existing design tokens in `App.css`. Add responsive grids for quick facts, lesson examples, teacher steps, and reassurance rows. Keep the layout readable on mobile and avoid decorative complexity.

- [ ] **Step 8: Run focused tests and verify GREEN**

Run:

```bash
npm test -- src/components/LandingPage.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Run existing public-route regression tests**

Run:

```bash
npm test -- src/App.test.tsx
```

Expected: PASS; existing public documents and route behavior remain intact.

---

### Task 3: Verify the production surface

**Files:**
- No new files expected.

**Interfaces:**
- Consumes: Completed landing-page changes.
- Produces: Evidence that lint, typecheck, tests, and build still succeed.

- [ ] **Step 1: Run static checks**

```bash
npm run lint
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run the complete unit test suite**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run the production build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Review the diff**

Confirm that the change is limited to the landing-page content/styles/tests and this plan, with no Firebase, lesson runtime, billing, or authorization behavior changed.
