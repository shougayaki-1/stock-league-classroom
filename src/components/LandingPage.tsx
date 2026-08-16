import { Link as RouterLink } from 'react-router'
import { Alert, Box, Button, Link, Stack, Typography } from '@mui/material'

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
  <section className="landing-features" aria-label="特徴">
    <ul>
      <li><strong>今、必要な判断だけ。</strong>生徒の画面には今取るべき行動だけを表示。情報過多にしない。</li>
      <li><strong>なぜ起きたかまで扱う。</strong>結果だけでなく「何が起きたか→なぜ→次にどうするか」を振り返る設計。</li>
      <li><strong>サーバーが進行を守る。</strong>教師のブラウザに依存しない設計。スリープや通信断で授業が止まらない。</li>
    </ul>
  </section>
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
  <section className="landing-closing"><p>準備を進めています。</p><h2>まもなく教室に市場をひらけます。</h2><Button component={RouterLink} to="/about" variant="contained" size="large" sx={{ backgroundColor: 'var(--landing-closing-cta)', color: 'var(--landing-closing-on-cta)', '&:hover': { backgroundColor: 'var(--landing-closing-cta-hover)' } }}>サービス概要を見る <span aria-hidden="true">→</span></Button></section>
  <Box component="footer"><Typography component="span" variant="body2">© 2026 Stock League Classroom</Typography><Stack component="nav" direction="row" aria-label="サービス情報" sx={{ flexWrap: 'wrap', gap: { xs: 0.5, sm: 1.5 } }}>{[['/about', 'サービス概要'], ['/guide', '操作マニュアル'], ['/terms', '利用規約'], ['/privacy', 'プライバシーポリシー'], ['/contact', '問い合わせ']].map(([to, label]) => <Link component={RouterLink} to={to} color="inherit" key={to} sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', px: 0.5 }}>{label}</Link>)}</Stack></Box>
</main>
