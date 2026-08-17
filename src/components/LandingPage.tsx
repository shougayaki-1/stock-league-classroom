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
    <p className="landing-hero-subtitle">生徒が情報を読み、個人で考え、チームで話し合い、判断し、その結果から「なぜ」を考える。クラス全員の判断が、そのまま結果に反映されます。</p>
    <Alert severity="info" className="landing-hero-notice">授業機能はベータ公開中です。教材作成から結果確認まで、実際にお試しいただけます。</Alert>
    <Stack direction="row" spacing={2} className="landing-hero-ctas">
      <Button href="#landing-journey-title" variant="contained" size="large" sx={landingCtaSx}>授業の流れを見る</Button>
      <Button component={RouterLink} to="/join" variant="outlined" size="large">生徒はこちら（授業に参加）</Button>
    </Stack>
  </section>

  <section className="landing-journey" aria-labelledby="landing-journey-title">
    <div className="landing-section-heading">
      <p className="landing-section-kicker">1回の授業の流れ</p>
      <h2 id="landing-journey-title">8つの学習活動で、判断から振り返りまでつなげます</h2>
      <p>タイマーで自動的に進むのではなく、クラスの様子を見ながら先生が次のステップに進めます。目安は1コマ（45〜50分）です。※画面はイメージで、実際のデザインとは異なる場合があります。</p>
    </div>
    <ol className="journey-steps">
      <li className="journey-step">
        <div className="journey-step-num-col"><span className="journey-step-dot">01</span><span className="journey-step-line" aria-hidden="true" /></div>
        <div className="journey-step-body">
          <p className="journey-step-kicker">導入</p>
          <h3>今日の問いを確認する</h3>
          <p>先生が授業の目標を教室画面に表示。生徒は参加コードから授業に入ります。</p>
        </div>
        <div className="journey-step-visual" aria-hidden="true"><span className="journey-visual-tag">教室表示</span><p>参加コード：123456</p></div>
      </li>
      <li className="journey-step">
        <div className="journey-step-num-col"><span className="journey-step-dot">02</span><span className="journey-step-line" aria-hidden="true" /></div>
        <div className="journey-step-body">
          <p className="journey-step-kicker">情報収集</p>
          <h3>まず、判断するための材料を集める</h3>
          <p>企業情報・ニュース・統計資料を読み、「何が影響しそうか」を考えます。</p>
        </div>
        <div className="journey-step-visual" aria-hidden="true"><span className="journey-visual-tag">Research Desk</span><p>企業情報・ニュース・統計資料</p></div>
      </li>
      <li className="journey-step">
        <div className="journey-step-num-col"><span className="journey-step-dot">03</span><span className="journey-step-line" aria-hidden="true" /></div>
        <div className="journey-step-body">
          <p className="journey-step-kicker">個人で予想</p>
          <h3>話し合う前に、自分の考えを持つ</h3>
          <p>「どの会社が上がりそうか」「どの情報を重視するか」などを個人で回答します。</p>
        </div>
        <div className="journey-step-visual" aria-hidden="true"><span className="journey-visual-tag">個人回答</span><p>順位づけ／理由つき選択</p></div>
      </li>
      <li className="journey-step">
        <div className="journey-step-num-col"><span className="journey-step-dot">04</span><span className="journey-step-line" aria-hidden="true" /></div>
        <div className="journey-step-body">
          <p className="journey-step-kicker">チームで相談</p>
          <h3>違う予想と根拠を持ち寄る</h3>
          <p>チームノートを使いながら、なぜその判断になったかを比較。必要に応じてチームとして1つの回答をまとめます。</p>
        </div>
        <div className="journey-step-visual" aria-hidden="true"><span className="journey-visual-tag">チームノート</span><p>チームメンバー：4人</p></div>
      </li>
      <li className="journey-step">
        <div className="journey-step-num-col"><span className="journey-step-dot">05</span><span className="journey-step-line" aria-hidden="true" /></div>
        <div className="journey-step-body">
          <p className="journey-step-kicker">意思決定</p>
          <h3>考えたことを実際の選択に変える</h3>
          <p>社会科なら買う・売る、家庭科なら資産・保険・生活上の選択を行います。</p>
        </div>
        <div className="journey-step-visual" aria-hidden="true"><span className="journey-visual-tag">注文</span><p>A社を10株　買う</p></div>
      </li>
      <li className="journey-step">
        <div className="journey-step-num-col"><span className="journey-step-dot">06</span><span className="journey-step-line" aria-hidden="true" /></div>
        <div className="journey-step-body">
          <p className="journey-step-kicker">結果が起こる</p>
          <h3>クラスの判断や設定された情報によって、結果が変わる</h3>
          <p>市場なら価格が動き、家庭科なら時間が進み、イベントや家計の変化が起こります。</p>
        </div>
        <div className="journey-step-visual" aria-hidden="true"><span className="journey-visual-tag">結果画面</span><p>A社 ¥1,240 ▲3.2%</p></div>
      </li>
      <li className="journey-step">
        <div className="journey-step-num-col"><span className="journey-step-dot">07</span><span className="journey-step-line" aria-hidden="true" /></div>
        <div className="journey-step-body">
          <p className="journey-step-kicker">解説</p>
          <h3>結果だけを見て終わらない</h3>
          <p>先生が教室画面を使って、「何が影響したのか」を整理します。</p>
        </div>
        <div className="journey-step-visual" aria-hidden="true"><span className="journey-visual-tag">説明スライド</span><p>先生が要因を解説</p></div>
      </li>
      <li className="journey-step">
        <div className="journey-step-num-col"><span className="journey-step-dot">08</span></div>
        <div className="journey-step-body">
          <p className="journey-step-kicker">振り返り</p>
          <h3>予想・判断・結果をつなぎ直す</h3>
          <p>クラス・チーム・個人の違いを見ながら、「なぜそうなったか」「次ならどうするか」を考えます。</p>
        </div>
        <div className="journey-step-visual" aria-hidden="true"><span className="journey-visual-tag">分析画面</span><p>クラス → チーム → 個人</p></div>
      </li>
    </ol>
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

  <section className="landing-prep" aria-labelledby="landing-prep-title">
    <div className="landing-section-heading">
      <p className="landing-section-kicker">授業準備</p>
      <h2 id="landing-prep-title">教材はゼロから作らなくていい</h2>
      <p>他の先生の教材を土台にする方法と、質問に答えながら自分で作る方法、どちらからでも始められます。</p>
    </div>
    <div className="prep-paths">
      <article className="prep-path-card">
        <p className="prep-path-label">他の先生の教材から始める</p>
        <p>教材マーケットプレイスで公開教材（通常公開・認証済み・公式）を探し、複製して自分のクラスで使えます。「分かりやすさ」「実施のしやすさ」「生徒の反応」のレビューも参考にできます。</p>
      </article>
      <article className="prep-path-card">
        <p className="prep-path-label">質問に答えながら作る</p>
        <p>学習目標や授業時間を選ぶだけで授業の土台ができます。企業やニュース、家庭のプロフィールなど、必要な部分だけあとから編集できます。</p>
      </article>
    </div>
    <p className="prep-flow"><strong>教材を選ぶ</strong><span aria-hidden="true"> → </span><strong>授業条件を決める</strong><span aria-hidden="true"> → </span><strong>必要なところだけ直す</strong><span aria-hidden="true"> → </span><strong>開始する</strong></p>
    <div className="prep-chip-groups">
      <div className="prep-chip-group">
        <span className="prep-chip-group-label">社会科の設定例</span>
        <div className="prep-chips"><span>授業時間 50分</span><span>企業 5社</span><span>難易度 標準</span><span>情報と需給 バランス</span></div>
      </div>
      <div className="prep-chip-group">
        <span className="prep-chip-group-label">家庭科の設定例</span>
        <div className="prep-chips"><span>人物比較</span><span>1ラウンド 5年</span><span>イベント 一部公開</span></div>
      </div>
    </div>
  </section>

  <section className="landing-develop" aria-labelledby="landing-develop-title">
    <div className="landing-section-heading">
      <p className="landing-section-kicker">同じ教材から</p>
      <h2 id="landing-develop-title">問いの深さを、授業に合わせて変えられる</h2>
      <p>同じニュースや家庭の状況でも、聞き方を変えるだけで活動の難易度を調整できます。</p>
    </div>
    <p className="develop-flow"><strong>上がると思う？</strong><span aria-hidden="true"> → </span><strong>どの会社が最も影響を受ける？</strong><span aria-hidden="true"> → </span><strong>100万円をどう配分する？</strong><span aria-hidden="true"> → </span><strong>賛成か反対か？</strong><span aria-hidden="true"> → </span><strong>そう判断した理由は？</strong></p>
    <p className="develop-note">選ぶだけの問いから、比較する・配分する・順位をつける・根拠を説明する問いまで、同じ教材のまま発展させられます。</p>
  </section>

  <section className="landing-team" aria-labelledby="landing-team-title">
    <div className="landing-section-heading">
      <p className="landing-section-kicker">個人 → チーム → クラス</p>
      <h2 id="landing-team-title">ひとりで考えてから、チームで決める</h2>
      <p>1人1台の生徒環境が前提ではありません。チームで1台の端末を共有して参加することもできます。</p>
    </div>
    <p className="team-flow"><strong>個人で考える</strong><span aria-hidden="true"> → </span><strong>チームノートに持ち寄る</strong><span aria-hidden="true"> → </span><strong>チームとして判断する</strong><span aria-hidden="true"> → </span><strong>クラスで比較する</strong></p>
    <p className="team-note">チームの回答は、誰かが提案し、チームで承認し、最終的に確定する形にできます。個人の考えを持ち寄り、チームとして1つの判断をつくるプロセスです。</p>
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
      <li><strong>授業を開始して進行する</strong><span>導入から振り返りまでの学習活動を、クラスの状況を見ながら先生が進めます。</span></li>
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
      <article className="results-card"><strong>クラス→チーム→個人</strong><p>クラス全体から、気になるチームや生徒だけを選んで詳しく確認できます。</p></article>
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
