import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { AppVersion } from './AppVersion'
import { Box, Container, Link, Stack, Typography } from '@mui/material'

/** Static public documents. */
const OPERATOR = 'しょうが焼き'
const CONTACT_EMAIL = 'stock-league@shoug.org'
const CONTACT_FORM = 'https://forms.gle/YQW6VwwgsRYxdfKJ9'
const UPDATED_AT = '2026年8月17日'
const DocLink = (props: ComponentPropsWithoutRef<'a'>) => <Link {...props} color="primary" />

const DocLayout = ({ title, lead, children }: { title: string; lead: string; children: ReactNode }) => <Box component="main" className="doc-page" sx={{ minHeight: '100svh' }}>
  <Box component="header" className="doc-nav" sx={{ borderBottom: 1, borderColor: 'divider' }}><Container maxWidth="md"><Stack component="nav" direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ py: 2, justifyContent: 'space-between', alignItems: { sm: 'center' }, '& a': { display: 'inline-flex', alignItems: 'center', minHeight: 44 } }} aria-label="公開文書"><Link href="/" underline="none" color="primary.dark" sx={{ fontWeight: 800 }}>Stock League Classroom</Link><Stack direction="row" useFlexGap spacing={2} sx={{ flexWrap: 'wrap' }}><DocLink href="/about">サービス概要</DocLink><DocLink href="/guide">操作マニュアル</DocLink><DocLink href="/terms">利用規約</DocLink><DocLink href="/privacy">プライバシーポリシー</DocLink><DocLink href="/contact">問い合わせ</DocLink></Stack></Stack></Container></Box>
  <Container component="article" className="doc-body" maxWidth="md" sx={{ py: { xs: 4, md: 7 }, '& p, & li': { lineHeight: 1.9 }, '& h2': { mt: 5 }, '& h3': { mt: 3 } }}>
    <Typography variant="h1">{title}</Typography>
    <Typography color="text.secondary" sx={{ mt: 1, fontSize: '1.125rem', lineHeight: 1.8 }}>{lead}</Typography>
    {children}
    <Typography variant="body2" color="text.secondary" sx={{ mt: 5, pt: 2, borderTop: 1, borderColor: 'divider' }}>最終更新: {UPDATED_AT}</Typography>
  </Container>
  <Box component="footer" className="doc-footer" sx={{ borderTop: 1, borderColor: 'divider', py: 3 }}><Container maxWidth="md"><Typography variant="body2" color="text.secondary">© 2026 Stock League Classroom　運営: {OPERATOR}　<Link href="/" color="primary" sx={{ display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>トップへ</Link> <AppVersion /></Typography></Container></Box>
</Box>

const Disclaimer = () => <aside className="doc-callout" role="note">
  <strong>これは投資のシミュレーションです。</strong>
  <p>本サービスで扱う会社、価格、ニュースはすべて授業のために作られた架空のものです。実際のお金は一切動きません。実在の株式市場の値動きとは無関係であり、投資の助言・勧誘を目的とするものではありません。</p>
</aside>

const BetaNotice = () => <aside className="doc-callout" role="note">
  <strong>授業機能はベータ公開中です。</strong>
  <p>教材作成から授業実施、結果確認までの一連の流れはご利用いただけますが、まだ本格運用に向けた検証段階です。仕様や画面は今後変更される可能性があります。不具合や使いにくい点を見つけた場合は<DocLink href="/contact">問い合わせ窓口</DocLink>までご連絡ください。</p>
</aside>

export const AboutPage = () => <DocLayout title="サービス概要" lead="Stock League Classroom は、教室で使う社会科・家庭科の授業シミュレーターです。">
  <Disclaimer />
  <BetaNotice />
  <h2>提供状況</h2>
  <p><strong>授業機能はベータ公開中です。</strong>教師が教材を作成し、参加コードで生徒を集めて授業を開始、社会科では株式市場シミュレーションでの売買、家庭科では家計シミュレーションを実施し、終了後は生徒本人の結果と教師向けの分析を確認できます。</p>
  <p>授業の進行と記録は、教師のブラウザではなく<strong>サーバーが権威を持つ仕組み</strong>で扱います。授業の進行が特定の端末のスリープや通信断に依存しない、安全で再現可能な基盤を整備しています。</p>
  <h2>できること</h2>
  <ul>
    <li>教師: Googleアカウントでログインし、教材（社会科の市場シナリオ、家庭科の家計シナリオ）を作成・公開</li>
    <li>教師: 公開済みの教材から授業を開始し、参加コードを生徒に共有</li>
    <li>生徒: 参加コードと表示名で授業に参加し、チームで市場の売買判断または家計の意思決定を行う</li>
    <li>教師: 授業の進行状況の確認、介入操作、結果の生成</li>
    <li>生徒: 自分（または自チーム）の結果の確認</li>
    <li>教師: 授業ごとの分析（根拠情報の利用率、判断変更、理解度などの集計）の確認</li>
  </ul>
  <h2>まだ提供していないこと</h2>
  <p>教材のAI生成機能は準備中です（下記「AI機能について」を参照）。また、授業の進行は現時点で固定パターンのフェーズ構成（導入→本編→結果→振り返り）に基づいており、教材ごとに自由にフェーズを設計する機能はまだありません。</p>
  <h2>AI機能について</h2>
  <p>教材のたたき台をAIが生成する機能は準備中です。現在AIによる生成を実行すると失敗し、代わりに定型の案が表示されます。利用可能になり次第、本ページでお知らせします。</p>
  <h2>公開ページの推奨環境</h2>
  <ul>
    <li>Google Chrome、Microsoft Edge、Safari の最新版</li>
    <li>Chromebook、iPad、Windows PC、Mac、スマートフォン</li>
    <li>JavaScript と Cookie が有効であること</li>
  </ul>
  <h2>費用</h2>
  <p>個人の教師が利用する場合は無償です。学校・教育委員会単位でご利用いただく場合は有償プランをご用意しています（教師の同時利用人数や同時開催できる授業数などに応じたプラン）。具体的な金額は<DocLink href="/contact">問い合わせ窓口</DocLink>までお問い合わせください。有償プランへのお申し込みの際は、料金の請求や支払い情報の入力をお願いする場合があります。</p>
  <h2>運営者</h2>
  <p>運営者: {OPERATOR}<br />連絡先: {CONTACT_EMAIL}</p>
</DocLayout>

export const TermsPage = () => <DocLayout title="利用規約" lead="公開ページと授業機能（ベータ公開中）の利用条件です。ご利用をもって本規約に同意したものとみなします。">
  <Disclaimer />
  <BetaNotice />
  <h2>第1条（対象）</h2>
  <p>本規約は、公開ページと授業機能（教材作成、授業実施、生徒参加、結果閲覧、分析閲覧を含む、現在ベータ公開中の機能）のすべてに適用されます。教師は、所属機関の規程に従い、必要な承認を得たうえでご利用ください。</p>
  <h2>第2条（アカウントと本人確認）</h2>
  <p>教師はGoogleアカウントでログインします。生徒は参加コードと、自ら入力した表示名で授業に参加します。生徒の個人情報を不要に取得しないことを原則とし、表示名には本名を入力しないよう案内します。教師は、生徒に対しこの点を事前に指導する責任を負うものとします。</p>
  <h2>第3条（禁止事項）</h2>
  <ul>
    <li>他者を誹謗中傷する、差別的である、その他公序良俗に反する内容を入力または送信すること</li>
    <li>本サービスに過大な負荷をかける行為、自動化された手段による大量アクセス</li>
    <li>他の利用者のデータへ不正にアクセスしようとする行為、セキュリティ機構を回避しようとする行為</li>
    <li>本サービスを投資の助言・勧誘、その他教育目的以外に利用すること</li>
    <li>法令または所属機関の規程に違反する行為</li>
  </ul>
  <h2>第4条（データの取り扱い）</h2>
  <p>本サービスが取得する情報とその取り扱いについては<DocLink href="/privacy">プライバシーポリシー</DocLink>をご確認ください。</p>
  <h2>第5条（費用・お支払い）</h2>
  <p>個人の教師によるご利用は無償です。学校・教育委員会単位の有償プランをお申し込みの場合、金額・支払い方法は個別にご案内し、決済にはStripe（Stripe, Inc.）を利用します。有償プランの詳細は<DocLink href="/about">サービス概要</DocLink>および<DocLink href="/contact">問い合わせ窓口</DocLink>をご確認ください。</p>
  <h2>第6条（サービスの変更・中断・終了）</h2>
  <p>本サービスはベータ公開中であり、運営者は、機能の追加・変更、保守、障害対応、その他運営上必要と判断した場合、事前の通知なく本サービスの全部または一部を変更、中断または終了することがあります。授業計画は、サービスの可用性に依存しない形でご準備ください。</p>
  <h2>第7条（利用の制限）</h2>
  <p>運営者は、本規約に違反する行為が認められた場合、または運営の継続に支障があると判断した場合、事前の通知なく特定の利用者による利用を制限し、公開ページの投稿または授業機能のデータを削除することがあります。</p>
  <h2>第8条（免責）</h2>
  <p>本サービスはベータ公開中の機能を含め現状有姿にて提供され、特定の目的への適合性、正確性、可用性、データが失われないことについて、いかなる保証も行いません。運営者は、本サービスの利用または利用不能によって生じた損害について、法令上免れることのできない場合を除き、責任を負いません。</p>
  <h2>第9条（規約の変更）</h2>
  <p>運営者は本規約を変更することがあります。変更後の規約は本ページに掲載した時点から効力を生じます。</p>
  <h2>第10条（お問い合わせ）</h2>
  <p>本規約に関するお問い合わせは <DocLink href="/contact">問い合わせ窓口</DocLink> までご連絡ください。</p>
</DocLayout>

export const PrivacyPage = () => <DocLayout title="プライバシーポリシー" lead="公開ページと授業機能（ベータ公開中）における情報の取り扱いを説明します。">
  <BetaNotice />

  <h2>1. 取得する情報</h2>
  <h3>公開ページ</h3>
  <p>公開ページの閲覧にあたり、生徒または教師の授業データを取得しません。問い合わせを行う場合は、利用者がメールまたはフォームに自ら入力した情報を受け取ります。</p>
  <h3>授業機能（教師）</h3>
  <ul>
    <li><strong>Googleアカウントの認証情報</strong>（メールアドレスを含む） — ログインと本人確認のため</li>
    <li><strong>作成した教材と授業実施データ</strong>（教材の内容、授業の進行状況、参加者名簿、介入操作の記録など） — 授業の準備と運営のため</li>
    <li><strong>組織・学校情報</strong>（所属組織、権限、招待の記録） — 学校単位でのご利用の管理のため</li>
    <li><strong>操作の監査ログ</strong>（誰がいつどの操作を行ったか） — 不正利用の防止と原因調査のため</li>
  </ul>
  <h3>授業機能（生徒）</h3>
  <ul>
    <li><strong>匿名のFirebase UID、表示名、チーム所属、セッション情報</strong> — 授業への参加と再接続のため。表示名に本名を入力しないよう案内します</li>
    <li><strong>授業内の操作・回答・売買/意思決定の記録</strong> — 授業の進行、結果の生成、振り返り、不正利用への対応のため</li>
    <li><strong>振り返りアンケートの回答</strong> — 授業の効果測定と教師向け分析のため</li>
  </ul>
  <h3>有償プランをご利用の場合</h3>
  <p>学校・教育委員会単位の有償プランのお申し込み時は、決済代行事業者Stripe（Stripe, Inc.）を通じて請求先情報・決済情報を取り扱います。カード番号等の決済情報そのものは本サービスのサーバーには保存されません。</p>
  <h3>共通</h3>
  <ul>
    <li><strong>エラー情報</strong> — 不具合が発生した際の技術情報（エラー内容、発生箇所、ブラウザの種類）。詳細は「4. 外部サービスへの送信」をご覧ください</li>
  </ul>
  <p>本サービスは、広告目的の追跡や、行動履歴に基づくプロファイリングを行いません。</p>

  <h2>2. 利用目的</h2>
  <p>取得した情報は、公開ページの保守、問い合わせへの対応、授業の準備・進行・結果生成・振り返り、教師向け分析の提供、有償プランの請求・契約管理、不正利用への対応、不具合の調査と改善のために利用します。これらの目的以外に利用することはありません。</p>

  <h2>3. 第三者提供</h2>
  <p>法令に基づく場合を除き、取得した情報を第三者へ提供・販売することはありません。決済代行（Stripe）等の委託先へは、その業務の遂行に必要な範囲でのみ情報を提供します。</p>

  <h2>4. 外部サービスへの送信</h2>
  <p>本サービスは以下の外部サービスを利用しています。</p>
  <ul>
    <li><strong>Google Firebase</strong>（Google LLC） — 配信基盤、認証、データ保存に利用します</li>
    <li><strong>Sentry</strong>（Functional Software, Inc.） — 不具合の検知に利用します。<span>アプリケーションは氏名、表示名、メールアドレス、匿名IDを event payloadへ意図的に添付しません。</span> <span>接続時に外部事業者が処理する技術情報は、各社のプライバシーポリシーに従います。</span></li>
    <li><strong>Stripe</strong>（Stripe, Inc.） — 有償プランの決済処理に利用します。カード情報等の決済情報はStripeが直接取り扱い、本サービスのサーバーには保存されません</li>
  </ul>
  <p>これらのサービスでは、情報が日本国外のサーバーで処理される場合があります。</p>

  <h2>5. 保存期間と削除</h2>
  <p>生徒の授業データの保存期間は、学校単位で管理者（学校の組織管理者）が30日〜10年の範囲で設定します。設定が無い場合の既定の保存期間、および保存期間経過後の自動削除の仕組みについては、学校の管理者にご確認いただくか、<DocLink href="/contact">問い合わせ窓口</DocLink>までお問い合わせください。問い合わせで受け取った情報については、対応に必要な期間に限って保持します。</p>

  <h2>6. 開示・削除の請求</h2>
  <p><strong>正式な開示・訂正・削除のご請求は、問い合わせ窓口で受け付けます。</strong><br /><DocLink href="/contact">問い合わせ窓口</DocLink>から、ご本人、保護者、学校の担当者が連絡可能な情報と対象を特定するために必要な情報をお知らせください。生徒データの削除は、学校の組織管理者からもリクエストいただけます。</p>

  <h2>7. 未成年の利用について</h2>
  <p>授業機能は、学校の授業において教師の管理のもとで利用されることを想定しています。生徒の個人情報を不要に取得しない設計とし、保護者の方からのお問い合わせにも対応します。</p>

  <h2>8. 本ポリシーの変更</h2>
  <p>本ポリシーを変更した場合、本ページに掲載します。取得する情報や利用目的に重要な変更がある場合は、変更点を明示します。</p>

  <h2>9. お問い合わせ</h2>
  <p>運営者: {OPERATOR}<br />連絡先: {CONTACT_EMAIL}</p>
</DocLayout>

export const GuidePage = () => <DocLayout title="教師向け操作マニュアル" lead="授業の準備から実施、結果確認までの手順を説明します。">
  <BetaNotice />
  <h2>1. ログイン</h2>
  <p>トップページから「Googleでログイン」を選び、学校または個人のGoogleアカウントでログインします。初回ログイン時は、個人用の作業スペースが自動的に用意されます。</p>
  <h2>2. 教材を作成する</h2>
  <p>教師ホームから「教材を管理する」を選び、新規作成します。社会科（株式市場シミュレーション）または家庭科（家計シミュレーション）を選び、内容を編集して保存します。編集中の教材は下書きのままで、生徒からは見えません。</p>
  <h2>3. 教材を公開する</h2>
  <p>内容が整ったら「この内容で版を発行する」から教材を公開します。公開済みの版を使ってのみ、授業を開始できます。</p>
  <h2>4. 授業を開始する</h2>
  <p>公開済みの教材の編集画面に表示される「この教材で授業を開始」から、想定人数を入力して授業を作成します。作成すると Control Room（授業運営画面）に移動します。</p>
  <h2>5. 生徒に参加コードを伝える</h2>
  <p>生徒は `/join` ページから参加コードと表示名を入力して参加します。表示名には本名を入力しないよう、事前に生徒へ案内してください。参加した生徒は「開始をお待ちください」画面で待機します。</p>
  <h2>6. 授業を進行する</h2>
  <p>Control Roomの「授業を開始」を押すと、生徒の画面が自動的に授業本編（社会科は取引・企業情報・ニュース、家庭科は家計の意思決定）に切り替わります。「次のフェーズへ進む」で結果・振り返りへと進めます。参加状況の確認や、生徒個別への介入操作（代理確定、再接続支援など）もこの画面から行えます。</p>
  <h2>7. 結果を生成する</h2>
  <p>振り返りフェーズに入ると「結果を生成する」ボタンが表示されます。押すと、生徒それぞれの画面に本人（またはチーム）の結果が表示されます。他の生徒・チームの結果は表示されません。</p>
  <h2>8. 授業分析を確認する</h2>
  <p>Control Roomから授業分析画面に移動すると、根拠情報の利用率、判断変更の状況、理解度などのクラス全体の集計と、チーム別・個人別の内訳を確認できます。</p>
  <h2>トラブル対応</h2>
  <ul>
    <li><strong>生徒の通信が切れた・端末を閉じてしまった</strong> — 生徒は同じ参加コードから再度参加してください。授業の進行状況はサーバー側で保持されているため、再接続すれば元のチーム・状態から再開できます。</li>
    <li><strong>誤って操作した</strong> — Control Roomの介入操作から、生徒個別またはチーム単位での訂正が行えます。</li>
    <li><strong>授業を安全に停止したい</strong> — Control Roomの「授業を安全停止」から、いつでも一時停止できます。</li>
  </ul>
  <h2>お問い合わせ</h2>
  <p>操作方法や教育利用に関するご相談は <DocLink href="/contact">問い合わせ窓口</DocLink> へご連絡ください。</p>
</DocLayout>

export const ContactPage = () => <DocLayout title="お問い合わせ・通報" lead="公開ページと授業機能に関するお問い合わせを受け付けます。">
  <h2>不具合・障害のご報告</h2>
  <p>動作しない、エラーが表示される等の場合はご連絡ください。お手数ですが、次の情報を添えていただけると調査が早くなります。</p>
  <ul>
    <li>発生した日時</li>
    <li>お使いのブラウザと端末（例: Chromebook の Chrome）</li>
    <li>操作の手順と、表示されたメッセージ</li>
    <li>該当するページのURL、または授業の参加コード（分かる場合）</li>
  </ul>

  <h2>不適切な内容の通報</h2>
  <p>誹謗中傷、差別的な内容、その他公序良俗に反する公開ページ・授業内の内容を見つけた場合はご連絡ください。確認のうえ、該当する内容の削除または利用制限を行うことがあります。</p>
  <p>通報の際は、対象となるページのURL、本文、または画面の状況をお知らせください。</p>

  <h2>データの開示・削除のご請求</h2>
  <p>正式な開示・訂正・削除のご請求は、本人、保護者、学校の担当者から受け付けます。詳細は<DocLink href="/privacy">プライバシーポリシー</DocLink>をご覧ください。</p>

  <h2>有償プラン・料金に関するお問い合わせ</h2>
  <p>学校・教育委員会単位の有償プランの金額・お申し込み方法については、こちらの窓口からご相談ください。</p>

  <h2>連絡先</h2>
  <p>メール: <DocLink href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</DocLink><br />フォーム: <DocLink href={CONTACT_FORM} target="_blank" rel="noopener noreferrer">問い合わせフォームを開く</DocLink></p>
  <p className="doc-note">授業機能はベータ公開中のため、返信までにお時間をいただく場合があります。緊急のご相談がある場合も、まずは問い合わせ窓口からご連絡ください。</p>
</DocLayout>
