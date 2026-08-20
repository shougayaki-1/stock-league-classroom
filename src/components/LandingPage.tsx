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
    <p className="landing-hero-subtitle">生徒が情報を読み、個人で考え、チームで話し合い、判断する。その判断がクラスの結果の一部となり、「なぜそうなったか」を振り返ります。</p>
    <Alert severity="info" className="landing-hero-notice">授業機能はベータ公開中です。教材作成から結果確認まで、実際にお試しいただけます。</Alert>
    <Stack direction="row" spacing={2} className="landing-hero-ctas">
      <Button href="#landing-journey-title" variant="contained" size="large" sx={landingCtaSx}>授業の流れを見る</Button>
      <Button component={RouterLink} to="/join" variant="outlined" size="large">生徒はこちら（授業に参加）</Button>
    </Stack>
  </section>

  <section className="landing-overview" aria-labelledby="landing-overview-title">
    <div className="landing-section-heading">
      <p className="landing-section-kicker">3つの画面で動きます</p>
      <h2 id="landing-overview-title">先生・生徒・教室のスクリーンで、ひとつの授業をつくる</h2>
    </div>
    <div className="overview-diagram">
      <div className="overview-node">
        <p className="overview-node-tag">先生の画面</p>
        <p className="overview-node-desc">教材を選び、クラスの様子を見ながら次のステップに進めます。</p>
      </div>
      <span className="overview-arrow" aria-hidden="true">→</span>
      <div className="overview-node overview-node-center">
        <p className="overview-node-tag">教室のスクリーン</p>
        <p className="overview-node-desc">プロジェクターや大型モニターに、問い・結果・解説を共有します。</p>
      </div>
      <span className="overview-arrow overview-arrow-reverse" aria-hidden="true">←</span>
      <div className="overview-node">
        <p className="overview-node-tag">生徒の端末</p>
        <p className="overview-node-desc">1人1台でも、チームで1台を共有しても参加できます。</p>
      </div>
    </div>
  </section>

  <section className="landing-journey" aria-labelledby="landing-journey-title">
    <div className="landing-section-heading">
      <p className="landing-section-kicker">1回の授業の流れ</p>
      <h2 id="landing-journey-title">8つの学習活動で、判断から振り返りまでつなげます</h2>
      <p>タイマーで自動的に進むのではなく、クラスの様子を見ながら先生が次のステップに進めます。たとえば、1コマ（45〜50分）ならこんな流れです。※画面はイメージで、実際のデザインとは異なる場合があります。</p>
    </div>

    <div className="journey-cluster">
      <p className="journey-cluster-label">考える</p>
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
          <div className="journey-step-visual journey-step-visual-rich" aria-hidden="true">
            <div className="mock-tabs"><span className="mock-tab-active">企業情報</span><span>ニュース</span><span>統計資料</span><span>チームノート</span><span>注文</span></div>
            <p className="mock-line-title">A社（再生可能エネルギー）</p>
            <p className="mock-line-sub">現在価格 ¥1,200　業界：エネルギー</p>
          </div>
        </li>
        <li className="journey-step">
          <div className="journey-step-num-col"><span className="journey-step-dot">03</span></div>
          <div className="journey-step-body">
            <p className="journey-step-kicker">個人で予想</p>
            <h3>話し合う前に、自分の考えを持つ</h3>
            <p>「どの会社が上がりそうか」「どの情報を重視するか」などを個人で回答します。</p>
          </div>
          <div className="journey-step-visual" aria-hidden="true"><span className="journey-visual-tag">個人回答</span><p>順位づけ／理由つき選択</p></div>
        </li>
      </ol>
    </div>

    <div className="journey-cluster">
      <p className="journey-cluster-label">決める</p>
      <ol className="journey-steps">
        <li className="journey-step">
          <div className="journey-step-num-col"><span className="journey-step-dot">04</span><span className="journey-step-line" aria-hidden="true" /></div>
          <div className="journey-step-body">
            <p className="journey-step-kicker">チームで相談</p>
            <h3>違う予想と根拠を持ち寄る</h3>
            <p>チームノートを使いながら、なぜその判断になったかを比較。必要に応じてチームとして1つの回答をまとめます。</p>
          </div>
          <div className="journey-step-visual journey-step-visual-rich" aria-hidden="true">
            <p className="mock-eyebrow">チーム3</p>
            <div className="mock-team-members"><span>あおい</span><span>ゆうと</span><span>みなみ</span><span>そうた</span></div>
            <p className="mock-note-title">チームノート</p>
            <p className="mock-note-body">「補助金のニュースはA社に有利そう」</p>
          </div>
        </li>
        <li className="journey-step">
          <div className="journey-step-num-col"><span className="journey-step-dot">05</span></div>
          <div className="journey-step-body">
            <p className="journey-step-kicker">意思決定</p>
            <h3>考えたことを実際の選択に変える</h3>
            <p>社会科なら買う・売る、家庭科なら資産・保険・生活上の選択を行います。</p>
          </div>
          <div className="journey-step-visual journey-step-visual-rich" aria-hidden="true">
            <div className="mock-order-row"><span>銘柄</span><strong>A社</strong></div>
            <div className="mock-order-row"><span>売買</span><strong>買う</strong></div>
            <div className="mock-order-row"><span>株数</span><strong>10株</strong></div>
            <div className="mock-order-row"><span>概算金額</span><strong>¥12,000</strong></div>
          </div>
        </li>
      </ol>
    </div>

    <div className="journey-cluster">
      <p className="journey-cluster-label">結果から考え直す</p>
      <ol className="journey-steps">
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
          <div className="journey-step-visual" aria-hidden="true"><span className="journey-visual-tag">解説画面</span><p>先生が要因を解説</p></div>
        </li>
        <li className="journey-step">
          <div className="journey-step-num-col"><span className="journey-step-dot">08</span></div>
          <div className="journey-step-body">
            <p className="journey-step-kicker">振り返り</p>
            <h3>予想・判断・結果をつなぎ直す</h3>
            <p>クラス・チーム・個人の違いを見ながら、「なぜそうなったか」「次ならどうするか」を考えます。</p>
          </div>
          <div className="journey-step-visual journey-step-visual-rich" aria-hidden="true">
            <div className="mock-analytics-row"><span>根拠を使った生徒</span><strong>78%</strong></div>
            <div className="mock-analytics-row"><span>判断を変更した生徒</span><strong>12人</strong></div>
            <div className="mock-analytics-row"><span>理解が難しかった生徒</span><strong>4人</strong></div>
            <p className="mock-drilldown">クラス → チーム → 個人</p>
          </div>
        </li>
      </ol>
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
      <h2 id="landing-develop-title">教材を、授業目的に合わせて発展させられる</h2>
      <p>1回作った教材を、50分の1コマにも、複数コマの発展授業にも使えます。</p>
    </div>
    <div className="develop-diagram">
      <p className="develop-root">教材</p>
      <div className="develop-stem" aria-hidden="true" />
      <div className="develop-branches">
        <div className="develop-branch">
          <p className="develop-branch-label">問いを深くする</p>
          <ul className="develop-branch-leaves">
            <li>選ぶ</li><li>比較する</li><li>順位をつける</li><li>配分する</li><li>根拠を説明する</li>
          </ul>
        </div>
        <div className="develop-branch">
          <p className="develop-branch-label">条件を変える</p>
          <ul className="develop-branch-leaves">
            <li>企業数</li><li>難易度</li><li>情報と需給のバランス</li><li>イベントの公開度</li>
          </ul>
        </div>
        <div className="develop-branch">
          <p className="develop-branch-label">学び方を変える</p>
          <ul className="develop-branch-leaves">
            <li>個人</li><li>チーム</li><li>クラス</li>
          </ul>
        </div>
        <div className="develop-branch">
          <p className="develop-branch-label">教材自体を変える</p>
          <ul className="develop-branch-leaves">
            <li>企業</li><li>ニュース</li><li>家庭のプロフィール</li><li>ライフイベント</li>
          </ul>
        </div>
      </div>
    </div>
    <p className="develop-example"><span className="develop-example-label">問いを深くする例：</span>「上がると思う？」<span aria-hidden="true"> → </span>「どの会社が最も影響を受ける？」<span aria-hidden="true"> → </span>「100万円をどう配分する？」<span aria-hidden="true"> → </span>「そう判断した理由は？」</p>
  </section>

  <section className="landing-team" aria-labelledby="landing-team-title">
    <div className="landing-section-heading">
      <p className="landing-section-kicker">個人 → チーム → クラス</p>
      <h2 id="landing-team-title">ひとりで考えてから、チームで決める</h2>
      <p>1人1台の生徒環境が前提ではありません。チームで1台の端末を共有して参加することもできます。</p>
    </div>
    <div className="team-layout">
      <div className="team-diagram">
        <div className="team-diagram-step"><p className="team-diagram-label">個人</p><p className="team-diagram-quote">「私はA社だと思う」</p></div>
        <span className="team-diagram-arrow" aria-hidden="true">↓</span>
        <div className="team-diagram-step"><p className="team-diagram-label">チーム</p><p className="team-diagram-quote">「なぜ？」「このニュースは？」</p></div>
        <span className="team-diagram-arrow" aria-hidden="true">↓</span>
        <div className="team-diagram-step"><p className="team-diagram-label">チームの判断</p><p className="team-diagram-quote">「A社を買う」</p></div>
        <span className="team-diagram-arrow" aria-hidden="true">↓</span>
        <div className="team-diagram-step"><p className="team-diagram-label">クラス</p><p className="team-diagram-quote">「他のチームはどう考えた？」</p></div>
      </div>
      <div className="team-mock" aria-hidden="true">
        <p className="mock-eyebrow">チームノート</p>
        <p className="mock-note-body">「補助金のニュースはA社に有利そう」</p>
        <p className="mock-eyebrow">チームの回答</p>
        <div className="mock-order-row"><span>状態</span><strong>承認待ち → 確定</strong></div>
      </div>
    </div>
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
      <li><strong>生徒に参加方法を案内する</strong><span>簡単参加なら、名前と出席番号などを入力するだけで参加できます。</span></li>
      <li><strong>授業を開始して進行する</strong><span>導入から振り返りまでの学習活動を、クラスの状況を見ながら先生が進めます。</span></li>
      <li><strong>結果をクラスで振り返る</strong><span>判断と結果を見比べ、「なぜ」を考える時間につなげます。</span></li>
    </ol>
  </section>

  <section className="landing-control" aria-labelledby="landing-control-title">
    <div className="landing-section-heading">
      <p className="landing-section-kicker">授業中</p>
      <h2 id="landing-control-title">先生は「次へ」を押すだけではありません</h2>
      <p>クラスの状態を見ながら、授業をコントロールできます。</p>
    </div>
    <div className="control-mock" aria-hidden="true">
      <div className="mock-chrome"><span /><span /><span /></div>
      <div className="control-mock-header"><span>現在：チーム相談</span><span className="control-mock-next">次へ進む</span></div>
      <div className="control-mock-stats">
        <div className="control-mock-callout"><strong>32人</strong><span>参加中</span></div>
        <div className="control-mock-callout"><strong>1人</strong><span>切断中</span></div>
        <div className="control-mock-callout"><strong>2チーム</strong><span>人数の偏りあり</span></div>
        <div className="control-mock-callout"><strong>1人</strong><span>困っている</span></div>
      </div>
      <div className="control-mock-footer">教室表示：チーム相談中</div>
    </div>
    <p className="control-note">接続トラブルや進行の遅れがあっても、時間延長・再接続・教室表示の切り替えなどで先生側から授業を立て直せます。</p>
  </section>

  <section className="landing-results" aria-labelledby="landing-results-title">
    <div className="landing-section-heading">
      <p className="landing-section-kicker">授業のあとにわかること</p>
      <h2 id="landing-results-title">生徒ごとの判断を、あとから確認できます</h2>
      <p>誰が何を選び、どんな根拠で判断したかを、先生の画面から振り返ることができます。</p>
    </div>
    <div className="analytics-mock" aria-hidden="true">
      <div className="mock-chrome"><span /><span /><span /></div>
      <div className="analytics-mock-stats">
        <div className="analytics-mock-stat"><strong>78%</strong><span>根拠を使った生徒</span></div>
        <div className="analytics-mock-stat"><strong>12人</strong><span>判断を変更した生徒</span></div>
        <div className="analytics-mock-stat"><strong>82%</strong><span>予測の的中度</span></div>
      </div>
      <div className="analytics-mock-breakdown">
        <p className="mock-eyebrow">生徒ごとの選択</p>
        <div className="mock-order-row"><span>A社を買った</span><strong>28人</strong></div>
        <div className="mock-order-row"><span>様子を見た</span><strong>7人</strong></div>
        <div className="mock-order-row"><span>売った</span><strong>5人</strong></div>
      </div>
      <p className="analytics-mock-drilldown">クラス → チーム → 個人</p>
    </div>
    <p className="analytics-note">クラス全体から、気になるチームや生徒だけを選んで詳しく確認できます。</p>
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
        <span>利用環境</span>
        <strong>ブラウザで使う教室向けサービス</strong>
        <p>インストール不要。先生と生徒が授業の中で使うことを想定しています。</p>
      </article>
      <article className="landing-fact-card">
        <span>生徒の参加</span>
        <strong>簡単参加なら、名前と出席番号などで参加できます。</strong>
      </article>
      <article className="landing-fact-card">
        <span>利用料金</span>
        <strong>ベータ期間中は無料でお試しいただけます。</strong>
        <p>正式版の料金体系は今後お知らせします。</p>
      </article>
    </div>
    <div className="landing-faq-accordion">
      <details className="landing-faq-item">
        <summary>実際のお金は動く？</summary>
        <p>動きません。実際のお金は使いません。授業のためのシミュレーションで、実際の金融商品の購入や投資助言を行うものではありません。</p>
      </details>
      <details className="landing-faq-item">
        <summary>実在企業の株価を扱う？</summary>
        <p>扱いません。会社・価格・ニュースは授業用に作成した架空の会社データです。</p>
      </details>
      <details className="landing-faq-item">
        <summary>生徒の個人情報はどう扱う？</summary>
        <p>生徒の個人情報を不要に取得しない方針で、表示名には本名を使わないよう案内します。取得項目と保存期間は<Link component={RouterLink} to="/privacy">プライバシーポリシー</Link>で公開しています。</p>
      </details>
      <details className="landing-faq-item">
        <summary>先生の端末が一時的に不安定になったら？</summary>
        <p>授業の進行を先生の1台の端末だけに依存させない設計です。授業中のトラブルで進行そのものが失われにくい構成を目指しています。</p>
      </details>
    </div>
  </section>

  <section className="landing-closing">
    <p>授業機能はベータ公開中です。</p>
    <h2>{onTeacherLogin ? 'まずは、最初の教材を作ってみましょう。' : 'まずは、学校で使うための条件をご確認ください。'}</h2>
    {onTeacherLogin
      ? <Button onClick={onTeacherLogin} variant="contained" size="large" sx={landingCtaSx}>教師として始める <span aria-hidden="true">→</span></Button>
      : <Button component={RouterLink} to="/about" variant="contained" size="large" sx={landingCtaSx}>サービス概要を見る <span aria-hidden="true">→</span></Button>}
  </section>

  <Box component="footer"><Typography component="span" variant="body2">© 2026 Stock League Classroom</Typography><Stack component="nav" direction="row" aria-label="サービス情報" sx={{ flexWrap: 'wrap', gap: { xs: 0.5, sm: 1.5 } }}>{[['/about', 'サービス概要'], ['/guide', '操作マニュアル'], ['/terms', '利用規約'], ['/privacy', 'プライバシーポリシー'], ['/contact', '問い合わせ']].map(([to, label]) => <Link component={RouterLink} to={to} color="inherit" key={to} sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', px: 0.5 }}>{label}</Link>)}</Stack></Box>
</main>
