import { Link as RouterLink } from 'react-router'
import { Alert, Box, Button, Link, Stack, Typography } from '@mui/material'

const landingCtaSx = {
  backgroundColor: 'var(--landing-cta)',
  color: 'var(--landing-on-cta)',
  '&:hover': { backgroundColor: 'var(--landing-cta-hover)' },
}

export interface LandingPageProps {
  /** Present only once Firebase services are ready (feature flag on). Starts the Google sign-in redirect — see src/lib/auth/teacherAuth.ts. */
  onTeacherLogin?: () => void
}

/**
 * Beta launch: lesson features (material creation through results/analytics,
 * Phase 1-6) are now reachable, so the hero leads with the two real
 * entry points — teacher login and student join — instead of only linking
 * deeper into the public docs.
 */
export const LandingPage = ({ onTeacherLogin }: LandingPageProps = {}) => <main className="landing-page">
  <Box component="header" className="landing-nav">
    <Link component={RouterLink} className="brand" to="/" underline="none" color="inherit" aria-label="Stock League Classroom ホーム" sx={{ minHeight: 48, display: 'inline-flex', alignItems: 'center' }}>Stock League <span>Classroom</span></Link>
    <Stack component="nav" direction="row" aria-label="主要ナビゲーション" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
      <Link component={RouterLink} to="/guide" color="inherit" sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', px: 1 }}>使い方</Link>
      <Link component={RouterLink} to="/about" color="inherit" sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', px: 1 }}>特徴</Link>
      {onTeacherLogin
        ? <Button className="nav-cta" onClick={onTeacherLogin} variant="contained" sx={{ ...landingCtaSx, minHeight: 44 }}>教師としてログイン</Button>
        : <Button component={RouterLink} className="nav-cta" to="/about" variant="contained" sx={{ ...landingCtaSx, minHeight: 44 }}>詳しく見る</Button>}
    </Stack>
  </Box>

  <section className="landing-hero">
    <p className="landing-hero-badge">教室向け 授業シミュレーター</p>
    <h1>社会科・家庭科に、<br className="landing-hero-break" />判断して振り返るシミュレーション授業を。</h1>
    <p className="landing-hero-subtitle">生徒が情報を読み、選び、結果を見て、「なぜそうなったか」を考える。クラス全員の判断が、そのまま結果に反映されます。</p>
    <Alert severity="info" className="landing-hero-notice">授業機能はベータ公開中です。教材作成から結果確認まで、実際にお試しいただけます。</Alert>
    <Stack direction="row" spacing={2} className="landing-hero-ctas">
      <Button href="#landing-preview-title" variant="contained" size="large" sx={landingCtaSx}>授業の流れを見る</Button>
      <Button component={RouterLink} to="/join" variant="outlined" size="large">生徒はこちら（授業に参加）</Button>
    </Stack>
  </section>

  <section className="landing-preview" aria-labelledby="landing-preview-title">
    <div className="landing-section-heading">
      <p className="landing-section-kicker">授業のイメージ</p>
      <h2 id="landing-preview-title">実際の授業では、こう進みます</h2>
      <p>市場経済シミュレーションの例です。クラス全員が読んで判断したことが、そのままクラス全体の結果に反映されます。※画面はイメージで、実際のデザインとは異なる場合があります。</p>
    </div>
    <div className="preview-flow">
      <figure className="preview-card">
        <div className="preview-card-frame" aria-hidden="true">
          <p className="preview-card-tag">ニュース</p>
          <p className="preview-card-body">政府が再生可能エネルギーへの補助金を発表</p>
        </div>
        <figcaption><strong>①ニュースを読む</strong><span>生徒は教材の企業情報やニュースを確認します。</span></figcaption>
      </figure>
      <span className="preview-arrow" aria-hidden="true">→</span>
      <figure className="preview-card">
        <div className="preview-card-frame" aria-hidden="true">
          <p className="preview-card-tag">判断</p>
          <div className="preview-card-buttons"><span>買う</span><span>様子を見る</span><span>売る</span></div>
        </div>
        <figcaption><strong>②自分で判断する</strong><span>買う・売る・様子を見るを生徒それぞれが選びます。</span></figcaption>
      </figure>
      <span className="preview-arrow" aria-hidden="true">→</span>
      <figure className="preview-card">
        <div className="preview-card-frame" aria-hidden="true">
          <p className="preview-card-tag">価格変動</p>
          <p className="preview-card-price">A社 ¥1,240 <span className="up">▲3.2%</span></p>
        </div>
        <figcaption><strong>③クラス全体の判断で価格が動く</strong><span>買った生徒が多い会社ほど、価格が上がります。</span></figcaption>
      </figure>
      <span className="preview-arrow" aria-hidden="true">→</span>
      <figure className="preview-card">
        <div className="preview-card-frame" aria-hidden="true">
          <p className="preview-card-tag">先生の結果画面</p>
          <p className="preview-card-stat">A社を買った：28人</p>
          <p className="preview-card-stat">様子を見た：7人</p>
        </div>
        <figcaption><strong>④結果を見ながら振り返る</strong><span>「なぜこの結果になったか」をクラスで議論します。</span></figcaption>
      </figure>
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
        <p>クラス全員の売買が需要となって価格に反映されるため、同じニュースでもクラスごとに結果が変わります。企業や産業、景気や政策などの情報を手がかりに、予想と結果の違いまで振り返ります。</p>
      </article>
      <article className="subject-card">
        <p className="subject-card-label">生活設計シミュレーション</p>
        <h3>家庭科・家庭基礎・家庭総合</h3>
        <p className="subject-card-journey"><strong>収入・支出・住宅・保険・資産形成</strong>などを選ぶ<span aria-hidden="true"> → </span>人生を進める<span aria-hidden="true"> → </span>選択の違いを比較して振り返る</p>
        <p>結婚・子育て・病気などのライフイベントも起こります。人生の各段階で起こる選択を疑似体験し、家計や生活目標との関係を考えます。</p>
      </article>
    </div>
  </section>

  <section className="landing-timeline" aria-labelledby="landing-timeline-title">
    <div className="landing-section-heading">
      <p className="landing-section-kicker">1回の授業の流れ</p>
      <h2 id="landing-timeline-title">進行は8つのフェーズ。先生がその場で操作します</h2>
      <p>タイマーで自動的に進むのではなく、クラスの様子を見ながら「次へ」で先生が進行します。目安は1コマ（45〜50分）です。</p>
    </div>
    <ol className="timeline-steps">
      <li><span className="timeline-num">1</span><span>導入</span></li>
      <li><span className="timeline-num">2</span><span>情報収集</span></li>
      <li><span className="timeline-num">3</span><span>個人予想</span></li>
      <li><span className="timeline-num">4</span><span>チーム相談</span></li>
      <li><span className="timeline-num">5</span><span>売買</span></li>
      <li><span className="timeline-num">6</span><span>価格変動</span></li>
      <li><span className="timeline-num">7</span><span>解説</span></li>
      <li><span className="timeline-num">8</span><span>振り返り</span></li>
    </ol>
  </section>

  <section className="landing-flow" aria-labelledby="landing-flow-title">
    <div className="landing-section-heading">
      <p className="landing-section-kicker">先生側の流れ</p>
      <h2 id="landing-flow-title">先生は何をすればいい？</h2>
      <p>授業前の準備から振り返りまで、先生が行うことを4段階に整理します。</p>
    </div>
    <ol className="landing-flow-steps">
      <li><strong>授業を選ぶ・つくる</strong><span>プリセット教材を選べばすぐ使えます。会社名やニュース文章を自分で追加・編集することもできます。</span></li>
      <li><strong>生徒に参加方法を案内する</strong><span>生徒はアカウント登録不要。名前と出席番号を入力するだけで参加できます。</span></li>
      <li><strong>授業を開始して進行する</strong><span>8つのフェーズを、クラスの状況を見ながら「次へ」で進めます。</span></li>
      <li><strong>結果をクラスで振り返る</strong><span>判断と結果を見比べ、「なぜ」を考える時間につなげます。</span></li>
    </ol>
  </section>

  <section className="landing-results" aria-labelledby="landing-results-title">
    <div className="landing-section-heading">
      <p className="landing-section-kicker">授業のあとにわかること</p>
      <h2 id="landing-results-title">生徒ごとの判断を、あとから確認できます</h2>
      <p>誰が何を選び、どんな根拠で判断したかを、先生の画面から振り返ることができます。</p>
    </div>
    <div className="results-grid">
      <article className="results-card"><strong>生徒ごとの選択</strong><p>誰がどの会社を買った・売った・様子を見たかを確認できます。</p></article>
      <article className="results-card"><strong>判断の根拠</strong><p>ニュースや企業情報をどれだけ参考にしたかの目安を確認できます。</p></article>
      <article className="results-card"><strong>予測の的中度</strong><p>生徒の予想と実際の結果がどれだけ一致していたかを確認できます。</p></article>
      <article className="results-card"><strong>CSVで書き出し</strong><p>結果は表示名を匿名化した状態でCSV出力できます（実名表示は個別に選択可能）。</p></article>
    </div>
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
      <article className="landing-fact-card">
        <span>生徒の参加</span>
        <strong>アカウント登録は不要です。</strong>
        <p>名前と出席番号を入力するだけで参加できます。</p>
      </article>
      <article className="landing-fact-card">
        <span>利用料金</span>
        <strong>ベータ期間中は無料でお試しいただけます。</strong>
        <p>正式版の料金体系は今後お知らせします。</p>
      </article>
    </div>
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
        <p>生徒の個人情報を不要に取得しない方針で、表示名には本名を使わないよう案内します。取得項目と保存期間は<Link component={RouterLink} to="/privacy">プライバシーポリシー</Link>で公開しています。</p>
      </article>
      <article className="landing-faq-item">
        <h3>先生の端末が一時的に不安定になったら？</h3>
        <p>授業の進行を先生の1台の端末だけに依存させない設計です。授業中のトラブルで進行そのものが失われにくい構成を目指しています。</p>
      </article>
    </div>
  </section>

  <section className="landing-closing">
    <p>授業機能はベータ公開中です。</p>
    <h2>{onTeacherLogin ? 'まずは5分で、最初の教材を作ってみましょう。' : 'まずは、学校で使うための条件をご確認ください。'}</h2>
    {onTeacherLogin
      ? <Button onClick={onTeacherLogin} variant="contained" size="large" sx={{ backgroundColor: 'var(--landing-closing-cta)', color: 'var(--landing-closing-on-cta)', '&:hover': { backgroundColor: 'var(--landing-closing-cta-hover)' } }}>教師としてログイン <span aria-hidden="true">→</span></Button>
      : <Button component={RouterLink} to="/about" variant="contained" size="large" sx={{ backgroundColor: 'var(--landing-closing-cta)', color: 'var(--landing-closing-on-cta)', '&:hover': { backgroundColor: 'var(--landing-closing-cta-hover)' } }}>サービス概要を見る <span aria-hidden="true">→</span></Button>}
  </section>

  <Box component="footer"><Typography component="span" variant="body2">© 2026 Stock League Classroom</Typography><Stack component="nav" direction="row" aria-label="サービス情報" sx={{ flexWrap: 'wrap', gap: { xs: 0.5, sm: 1.5 } }}>{[['/about', 'サービス概要'], ['/guide', '操作マニュアル'], ['/terms', '利用規約'], ['/privacy', 'プライバシーポリシー'], ['/contact', '問い合わせ']].map(([to, label]) => <Link component={RouterLink} to={to} color="inherit" key={to} sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', px: 0.5 }}>{label}</Link>)}</Stack></Box>
</main>
