import { TemplateRoutes } from './components/TemplateRoutes'
import { StudentMarketJoin, TeacherMarketDashboard } from './components/MarketDashboard'
import { HostConsole } from './components/HostConsole'
import { StudentMarketPage } from './components/student/StudentMarketPage'
import { SignagePage } from './components/signage/SignagePage'
import { AboutPage, ContactPage, GuidePage, PrivacyPage, TermsPage } from './components/PublicDocs'

/** Static public documents, keyed by path. */
const docPages: Record<string, () => React.JSX.Element> = {
  '/about': AboutPage,
  '/guide': GuidePage,
  '/terms': TermsPage,
  '/privacy': PrivacyPage,
  '/contact': ContactPage,
}

const LandingPage = () => <main className="landing-page">
  <header className="landing-nav">
    <a className="brand" href="/" aria-label="Stock League Classroom ホーム">Stock League <span>Classroom</span></a>
    <nav aria-label="主要ナビゲーション"><a href="#how-it-works">使い方</a><a href="#features">特徴</a><a className="nav-cta" href="/teacher/markets">先生はこちら</a></nav>
  </header>

  <section className="landing-hero" aria-labelledby="hero-title">
    <div className="hero-copy">
      <p className="eyebrow">金融教育を、教室でリアルタイムに。</p>
      <h1 id="hero-title">株式市場を、<br /><em>自分たちの教室に。</em></h1>
      <p className="hero-lede">Stock League Classroom は、チームで考え、ニュースに反応し、投資の仕組みを体験できる授業用シミュレーターです。</p>
      <div className="hero-actions"><a className="button primary" href="/teacher/markets">授業をはじめる <span aria-hidden="true">→</span></a><a className="button secondary" href="/join">生徒として参加</a></div>
      <p className="hero-note">アカウント不要で、生徒は参加コードからすぐに参加できます。</p>
    </div>
    <div className="market-card" aria-label="市場のライブ表示イメージ">
      <div className="market-card-head"><span className="live-dot" />LIVE MARKET <span className="round">ROUND 2</span></div>
      <div className="market-value"><span>教室総資産</span><strong>¥ 1,284,500</strong><b>+ 8.4%</b></div>
      <div className="market-chart" aria-hidden="true"><svg viewBox="0 0 360 130" preserveAspectRatio="none"><path d="M0,100 C25,106 40,74 62,86 S90,48 116,67 S145,78 164,48 S203,59 226,30 S251,52 274,34 S311,40 360,6" /><path className="area" d="M0,100 C25,106 40,74 62,86 S90,48 116,67 S145,78 164,48 S203,59 226,30 S251,52 274,34 S311,40 360,6 V130 H0Z" /></svg></div>
      <div className="market-row"><span>東都テクノロジー</span><strong>1,240</strong><b>+4.2%</b></div>
      <div className="market-row"><span>みらい食品</span><strong>860</strong><b>+1.8%</b></div>
      <div className="news-pill">速報　新製品の発表で期待が高まる</div>
    </div>
  </section>

  <section className="steps" id="how-it-works" aria-labelledby="steps-title">
    <div><p className="section-kicker">HOW IT WORKS</p><h2 id="steps-title">考える。選ぶ。<br />振り返る。</h2></div>
    <ol><li><span>01</span><h3>先生が市場をつくる</h3><p>テンプレートを選び、授業に合わせた市場と参加コードを発行します。</p></li><li><span>02</span><h3>生徒がチームで参加</h3><p>参加コードを入力して、個人またはチームで投資戦略を考えます。</p></li><li><span>03</span><h3>ニュースと価格が動く</h3><p>教室のスクリーンを見ながら、変化の理由を読み解きます。</p></li></ol>
  </section>

  <section className="feature-section" id="features" aria-labelledby="features-title"><div className="feature-intro"><p className="section-kicker">BUILT FOR THE CLASSROOM</p><h2 id="features-title">知識だけで終わらない、<br />判断する金融教育へ。</h2></div><div className="feature-grid"><article><span>◎</span><h3>リアルタイムの市場体験</h3><p>価格、ニュース、ランキングが同時に動き、意思決定の結果がすぐに見えます。</p></article><article><span>◫</span><h3>授業に合わせた設計</h3><p>学年やテーマに合うテンプレートから、市場シナリオを組み立てられます。</p></article><article><span>↗</span><h3>振り返りまで一つに</h3><p>終了後も結果と取引履歴を確認し、なぜそう判断したかを言語化できます。</p></article></div></section>

  <section className="landing-closing"><p>今日のニュースが、明日の判断を変える。</p><h2>さあ、教室に市場をひらこう。</h2><a className="button light" href="/teacher/markets">先生として市場を作成 <span aria-hidden="true">→</span></a></section>
  <footer><span>© 2026 Stock League Classroom</span><nav aria-label="サービス情報"><a href="/about">サービス概要</a><a href="/guide">操作マニュアル</a><a href="/terms">利用規約</a><a href="/privacy">プライバシーポリシー</a><a href="/contact">問い合わせ</a><a href="/join">生徒の参加はこちら</a></nav></footer>
</main>

export default function App() {
  const DocPage = docPages[window.location.pathname]
  if (DocPage) return <DocPage />
  const shareMatch = window.location.pathname.match(/^\/templates\/share\/([^/]+)$/)
  if (shareMatch) return <TemplateRoutes shareId={decodeURIComponent(shareMatch[1])} />
  if (window.location.pathname === '/templates') return <TemplateRoutes />
  if (window.location.pathname === '/teacher/markets') return <TeacherMarketDashboard />
  if (window.location.pathname === '/join') return <StudentMarketJoin />
  const playMatch = window.location.pathname.match(/^\/markets\/([^/]+)\/play$/)
  if (playMatch) return <StudentMarketPage marketId={decodeURIComponent(playMatch[1])} />
  const signageMatch = window.location.pathname.match(/^\/markets\/([^/]+)\/signage$/)
  if (signageMatch) return <SignagePage marketId={decodeURIComponent(signageMatch[1])} />
  const hostMatch = window.location.pathname.match(/^\/teacher\/markets\/([^/]+)\/host$/)
  if (hostMatch) return <HostConsole marketId={decodeURIComponent(hostMatch[1])} />
  return <LandingPage />
}
