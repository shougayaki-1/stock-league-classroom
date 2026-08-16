import { Link as RouterLink } from 'react-router'
import { Alert, Box, Button, Link, Stack, Typography } from '@mui/material'

const landingCtaSx = {
  backgroundColor: 'var(--landing-cta)',
  color: 'var(--landing-on-cta)',
  '&:hover': { backgroundColor: 'var(--landing-cta-hover)' },
}

/**
 * The lesson functions are still being prepared. Keep every CTA within the
 * public surface until teachers can actually start a lesson from the product.
 */
export const LandingPage = () => <main className="landing-page">
  <Box component="header" className="landing-nav">
    <Link component={RouterLink} className="brand" to="/" underline="none" color="inherit" aria-label="Stock League Classroom ホーム" sx={{ minHeight: 48, display: 'inline-flex', alignItems: 'center' }}>Stock League <span>Classroom</span></Link>
    <Stack component="nav" direction="row" aria-label="主要ナビゲーション" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
      <Link component={RouterLink} to="/guide" color="inherit" sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', px: 1 }}>使い方</Link>
      <Link component={RouterLink} to="/about" color="inherit" sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', px: 1 }}>サービス概要</Link>
      <Button component={RouterLink} className="nav-cta" to="/about" variant="contained" sx={{ ...landingCtaSx, minHeight: 44 }}>導入情報を見る</Button>
    </Stack>
  </Box>

  <section className="landing-hero">
    <p className="landing-hero-badge">教室向け 授業シミュレーター</p>
    <h1>社会科・家庭科に、<br className="landing-hero-break" />判断して振り返るシミュレーション授業を。</h1>
    <p className="landing-hero-subtitle">生徒が情報を読み、選び、結果を見て、「なぜそうなったか」を考える。そんな授業を教室で行えるよう、準備を進めています。</p>
    <Alert severity="info" className="landing-hero-notice">現在は公開ページを提供しています。授業機能の公開に向けて準備を進めています。</Alert>
    <Stack direction="row" spacing={2} className="landing-hero-ctas">
      <Button component={RouterLink} to="/about" variant="contained" size="large" sx={landingCtaSx}>詳しい利用条件を見る</Button>
      <Button component={RouterLink} to="/guide" variant="outlined" size="large">教師向け案内を見る</Button>
    </Stack>
  </section>

  <section className="landing-quick" aria-labelledby="landing-quick-title">
    <div className="landing-section-heading">
      <p className="landing-section-kicker">導入を検討する先生へ</p>
      <h2 id="landing-quick-title">導入前に、まず知っておきたいこと</h2>
      <p>授業で使えるかを判断するための基本情報を、先にまとめました。</p>
    </div>
    <div className="landing-fact-grid">
      <article className="landing-fact-card">
        <span>対象科目</span>
        <strong>社会科（公共・政治経済）<br />家庭科（家庭基礎・家庭総合）</strong>
      </article>
      <article className="landing-fact-card">
        <span>実際のお金</span>
        <strong>実際のお金は使いません。</strong>
        <p>授業用のシミュレーションです。</p>
      </article>
      <article className="landing-fact-card">
        <span>教材内のデータ</span>
        <strong>架空の会社・価格・ニュースを使用</strong>
        <p>実在する企業の売買や投資の勧誘を目的としません。</p>
      </article>
      <article className="landing-fact-card">
        <span>利用方法</span>
        <strong>ブラウザで使う教室向けサービス</strong>
        <p>先生と生徒が授業の中で使うことを想定しています。</p>
      </article>
      <article className="landing-fact-card landing-fact-card-status">
        <span>現在の提供状況</span>
        <strong>授業機能は準備中です。</strong>
        <p>現在は利用条件や情報の取り扱いなどの公開情報をご確認いただけます。</p>
      </article>
    </div>
  </section>

  <section className="landing-subjects" aria-labelledby="landing-subjects-title">
    <div className="landing-section-heading">
      <p className="landing-section-kicker">生徒が授業でやること</p>
      <h2 id="landing-subjects-title">どんな授業ができる？</h2>
      <p>知識を読むだけでなく、自分で判断し、その結果を材料に考える学習活動を想定しています。</p>
    </div>
    <div className="subject-card-list">
      <article className="subject-card">
        <p className="subject-card-label">市場経済シミュレーション</p>
        <h3>社会科・公共・政治経済</h3>
        <p className="subject-card-journey"><strong>情報やニュースを読む</strong><span aria-hidden="true"> → </span>投資判断をする<span aria-hidden="true"> → </span>市場の変化を見る<span aria-hidden="true"> → </span>価格が動いた理由を考える</p>
        <p>企業や産業、需要と供給、景気や政策などの情報を手がかりに、予想と結果の違いまで振り返ります。</p>
      </article>
      <article className="subject-card">
        <p className="subject-card-label">生活設計シミュレーション</p>
        <h3>家庭科・家庭基礎・家庭総合</h3>
        <p className="subject-card-journey"><strong>収入・支出・住宅・保険・資産形成</strong>などを選ぶ<span aria-hidden="true"> → </span>人生を進める<span aria-hidden="true"> → </span>選択の違いを比較して振り返る</p>
        <p>人生の各段階で起こる選択を疑似体験し、家計や生活目標との関係を考えます。</p>
      </article>
    </div>
  </section>

  <section className="landing-flow" aria-labelledby="landing-flow-title">
    <div className="landing-section-heading">
      <p className="landing-section-kicker">先生側の流れ</p>
      <h2 id="landing-flow-title">先生は何をすればいい？</h2>
      <p>授業前の準備から振り返りまで、先生が行うことを4段階に整理します。</p>
    </div>
    <ol className="landing-flow-steps">
      <li><strong>授業を選ぶ・つくる</strong><span>授業の目標や内容に合わせて教材を用意します。</span></li>
      <li><strong>生徒に参加方法を案内する</strong><span>授業への参加方法をクラスに共有します。</span></li>
      <li><strong>授業を開始して進行する</strong><span>クラスの状況を確認しながら授業を進めます。</span></li>
      <li><strong>結果をクラスで振り返る</strong><span>判断と結果を見比べ、「なぜ」を考える時間につなげます。</span></li>
    </ol>
  </section>

  <section className="landing-reassurance" aria-labelledby="landing-reassurance-title">
    <div className="landing-section-heading">
      <p className="landing-section-kicker">学校での導入に向けて</p>
      <h2 id="landing-reassurance-title">学校で使ううえで気になること</h2>
      <p>導入時に確認されやすい点を、技術用語ではなく授業での扱いに沿って説明します。</p>
    </div>
    <div className="landing-faq-list">
      <article className="landing-faq-item">
        <h3>実際のお金は動く？</h3>
        <p>動きません。授業のためのシミュレーションで、実際の金融商品の購入や投資助言を行うものではありません。</p>
      </article>
      <article className="landing-faq-item">
        <h3>実在企業の株価を扱う？</h3>
        <p>扱いません。会社・価格・ニュースは授業用に作成した架空データです。</p>
      </article>
      <article className="landing-faq-item">
        <h3>生徒の個人情報はどう扱う？</h3>
        <p>生徒の個人情報を不要に取得しない方針で、表示名には本名を使わないよう案内します。授業機能の提供開始前に、取得項目と保存期間を公開します。</p>
      </article>
      <article className="landing-faq-item">
        <h3>先生の端末が一時的に不安定になったら？</h3>
        <p>授業の進行を先生の1台の端末だけに依存させない設計です。授業中のトラブルで進行そのものが失われにくい構成を目指しています。</p>
      </article>
    </div>
  </section>

  <section className="landing-closing">
    <p>現在は授業機能の提供準備を進めています。</p>
    <h2>まずは、学校で使うための条件をご確認ください。</h2>
    <Button component={RouterLink} to="/about" variant="contained" size="large" sx={{ backgroundColor: 'var(--landing-closing-cta)', color: 'var(--landing-closing-on-cta)', '&:hover': { backgroundColor: 'var(--landing-closing-cta-hover)' } }}>詳しい利用条件を見る <span aria-hidden="true">→</span></Button>
  </section>

  <Box component="footer"><Typography component="span" variant="body2">© 2026 Stock League Classroom</Typography><Stack component="nav" direction="row" aria-label="サービス情報" sx={{ flexWrap: 'wrap', gap: { xs: 0.5, sm: 1.5 } }}>{[['/about', 'サービス概要'], ['/guide', '操作マニュアル'], ['/terms', '利用規約'], ['/privacy', 'プライバシーポリシー'], ['/contact', '問い合わせ']].map(([to, label]) => <Link component={RouterLink} to={to} color="inherit" key={to} sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', px: 0.5 }}>{label}</Link>)}</Stack></Box>
</main>
