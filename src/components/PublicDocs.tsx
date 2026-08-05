import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { AppVersion } from './AppVersion'
import { Box, Container, Link, Stack, Typography } from '@mui/material'

/** Static public documents. */
const OPERATOR = 'しょうが焼き'
const CONTACT_EMAIL = 'stock-league@shoug.org'
const CONTACT_FORM = 'https://forms.gle/YQW6VwwgsRYxdfKJ9'
const UPDATED_AT = '2026年8月1日'
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

export const AboutPage = () => <DocLayout title="サービス概要" lead="Stock League Classroom は、教室で使う授業シミュレーターを準備しているサービスです。">
  <Disclaimer />
  <h2>提供状況</h2>
  <p><strong>新しい授業機能は準備中です。</strong>現在はサービス概要、操作方針、利用規約、プライバシーポリシー、お問い合わせの公開ページをご覧いただけます。市場の作成、参加、教室表示、売買はまだ提供していません。</p>
  <p>今後の授業機能は、教師のブラウザではなく<strong>サーバーが権威を持つ仕組み</strong>として提供します。授業の進行が特定の端末のスリープや通信断に依存しない、安全で再現可能な基盤を整備しています。</p>
  <h2>公開ページの推奨環境</h2>
  <ul>
    <li>Google Chrome、Microsoft Edge、Safari の最新版</li>
    <li>Chromebook、iPad、Windows PC、Mac、スマートフォン</li>
    <li>JavaScript と Cookie が有効であること</li>
  </ul>
  <h2>費用</h2>
  <p>本サービスは無償で提供しています。料金の請求や支払い情報の入力を求めることはありません。</p>
  <h2>運営者</h2>
  <p>運営者: {OPERATOR}<br />連絡先: {CONTACT_EMAIL}</p>
</DocLayout>

export const TermsPage = () => <DocLayout title="利用規約" lead="現在提供している公開ページと、今後提供する授業機能の利用条件です。ご利用をもって本規約に同意したものとみなします。">
  <Disclaimer />
  <h2>第1条（対象）</h2>
  <p>現在は公開ページのみを提供しています。学校その他の教育機関で利用する授業機能は準備中であり、<strong>授業機能の提供開始後に適用する条件</strong>も本規約に定めます。教師は、所属機関の規程に従い、必要な承認を得たうえでご利用ください。</p>
  <h2>第2条（生徒の参加）</h2>
  <p>授業機能の提供開始後、生徒の参加方法と必要な入力項目を明示します。生徒の個人情報を不要に取得しないことを原則とし、表示名を扱う場合は本名を入力しないよう案内します。教師は、生徒に対しこの点を事前に指導する責任を負うものとします。</p>
  <h2>第3条（禁止事項）</h2>
  <ul>
    <li>他者を誹謗中傷する、差別的である、その他公序良俗に反する内容を入力または送信すること</li>
    <li>本サービスに過大な負荷をかける行為、自動化された手段による大量アクセス</li>
    <li>他の利用者または将来提供する授業機能のデータへ不正にアクセスしようとする行為、セキュリティ機構を回避しようとする行為</li>
    <li>本サービスを投資の助言・勧誘、その他教育目的以外に利用すること</li>
    <li>法令または所属機関の規程に違反する行為</li>
  </ul>
  <h2>第4条（データの取り扱い）</h2>
  <p>本サービスが取得する情報とその取り扱いについては<DocLink href="/privacy">プライバシーポリシー</DocLink>をご確認ください。</p>
  <h2>第5条（サービスの変更・中断・終了）</h2>
  <p>運営者は、保守、障害対応、その他運営上必要と判断した場合、事前の通知なく本サービスの全部または一部を変更、中断または終了することがあります。授業機能の提供開始後も、サービスの可用性に依存しない授業計画の準備をお願いします。</p>
  <h2>第6条（利用の制限）</h2>
  <p>運営者は、本規約に違反する行為が認められた場合、または運営の継続に支障があると判断した場合、事前の通知なく特定の利用者による利用を制限し、公開ページ上の投稿または授業機能のデータを削除することがあります。</p>
  <h2>第7条（免責）</h2>
  <p>本サービスは無償で現状有姿にて提供され、特定の目的への適合性、正確性、可用性、データが失われないことについて、いかなる保証も行いません。運営者は、本サービスの利用または利用不能によって生じた損害について、法令上免れることのできない場合を除き、責任を負いません。</p>
  <h2>第8条（規約の変更）</h2>
  <p>運営者は本規約を変更することがあります。変更後の規約は本ページに掲載した時点から効力を生じます。</p>
  <h2>第9条（お問い合わせ）</h2>
  <p>本規約に関するお問い合わせは <DocLink href="/contact">問い合わせ窓口</DocLink> までご連絡ください。</p>
</DocLayout>

export const PrivacyPage = () => <DocLayout title="プライバシーポリシー" lead="現在の公開ページと、今後提供する授業機能における情報の取り扱いを説明します。">
  <aside className="doc-callout" role="note">
    <strong>現在は、生徒の授業データを取得していません。</strong>
    <p>Phase Aでは公開ページのみを提供しており、参加、売買、結果のような授業機能は利用できません。生徒の氏名、メールアドレス、生年月日、学校名、住所、電話番号を入力する項目もありません。</p>
  </aside>

  <h2>1. 取得する情報</h2>
  <h3>現在の公開ページ</h3>
  <p>公開ページの閲覧にあたり、生徒または教師の授業データを取得しません。問い合わせを行う場合は、利用者がメールまたはフォームに自ら入力した情報を受け取ります。</p>
  <h3>授業機能の提供開始後</h3>
  <p>以下は、授業機能を提供開始する場合に取得する予定の情報です。提供開始前に本ポリシーを更新し、取得項目と保存期間を明示します。</p>
  <ul>
    <li><strong>生徒の表示名、匿名ID、セッション情報</strong> — 授業への参加と再接続のため。表示名に本名を入力しないよう案内します</li>
    <li><strong>授業内の操作・結果の記録</strong> — 授業の進行、振り返り、不正利用への対応のため</li>
    <li><strong>教師の認証情報と作成した授業教材・授業実施データ</strong> — ログイン、本人確認、授業の準備と運営のため</li>
  </ul>
  <h3>共通</h3>
  <ul>
    <li><strong>エラー情報</strong> — 不具合が発生した際の技術情報（エラー内容、発生箇所、ブラウザの種類）。詳細は「4. 外部サービスへの送信」をご覧ください</li>
  </ul>
  <p>本サービスは、広告目的の追跡や、行動履歴に基づくプロファイリングを行いません。</p>

  <h2>2. 利用目的</h2>
  <p>現在は問い合わせへの対応、公開ページの保守、不具合の調査と改善のために必要な情報のみを利用します。授業機能の提供開始後は、授業の進行、振り返り、不正利用への対応にも利用します。これらの目的以外に利用することはありません。</p>

  <h2>3. 第三者提供</h2>
  <p>法令に基づく場合を除き、取得した情報を第三者へ提供・販売することはありません。</p>

  <h2>4. 外部サービスへの送信</h2>
  <p>本サービスは以下の外部サービスを利用しています。授業機能の提供開始後に認証や授業データを扱う場合も、利用目的を本ポリシーで更新します。</p>
  <ul>
    <li><strong>Google Firebase</strong>（Google LLC） — 現在は配信基盤として利用します。認証とデータ保存は授業機能の提供開始後に利用する予定です</li>
    <li><strong>Sentry</strong>（Functional Software, Inc.） — 不具合の検知に利用します。<span>アプリケーションは氏名、表示名、メールアドレス、匿名IDを event payloadへ意図的に添付しません。</span> <span>接続時に外部事業者が処理する技術情報は、各社のプライバシーポリシーに従います。</span></li>
  </ul>
  <p>これらのサービスでは、情報が日本国外のサーバーで処理される場合があります。</p>

  <h2>5. 保存期間と削除</h2>
  <aside className="doc-callout warning" role="note">
    <strong>授業データの保存期間と自動削除は、授業機能の提供開始前に明示します。</strong>
    <p>現在は生徒の授業データを取得していません。問い合わせで受け取った情報については、対応に必要な期間に限って保持します。</p>
  </aside>

  <h2>6. 開示・削除の請求</h2>
  <p><strong>正式な開示・訂正・削除のご請求は、問い合わせ窓口で受け付けます。</strong><br /><DocLink href="/contact">問い合わせ窓口</DocLink>から、ご本人、保護者、学校の担当者が連絡可能な情報と対象を特定するために必要な情報をお知らせください。授業機能の提供開始後は、請求方法と本人確認の手順を更新します。</p>

  <h2>7. 未成年の利用について</h2>
  <p>授業機能は、学校の授業において教師の管理のもとで利用されることを想定しています。生徒の個人情報を不要に取得しない設計とし、保護者の方からのお問い合わせにも対応します。</p>

  <h2>8. 本ポリシーの変更</h2>
  <p>本ポリシーを変更した場合、本ページに掲載します。取得する情報や利用目的に重要な変更がある場合は、変更点を明示します。</p>

  <h2>9. お問い合わせ</h2>
  <p>運営者: {OPERATOR}<br />連絡先: {CONTACT_EMAIL}</p>
</DocLayout>

export const GuidePage = () => <DocLayout title="教師向け操作マニュアル" lead="新しい授業機能の提供に向けた準備状況と、現在ご覧いただける情報を案内します。">
  <h2>現在利用できること</h2>
  <ul>
    <li><DocLink href="/about">サービス概要</DocLink> — 授業機能の提供状況と設計方針</li>
    <li><DocLink href="/terms">利用規約</DocLink> と <DocLink href="/privacy">プライバシーポリシー</DocLink> — 利用条件と情報の取り扱い</li>
    <li><DocLink href="/contact">問い合わせ窓口</DocLink> — 不具合の報告、通報、データに関するご相談</li>
  </ul>
  <h2>新しい授業機能について</h2>
  <p><strong>新しい授業機能は準備中です。</strong>市場の作成、参加、教室表示、売買、結果の振り返りを段階的に提供します。</p>
  <p>授業の進行と記録はサーバーが権威を持つ仕組みで扱います。特定の教師端末を開き続けることを前提としないため、端末の状態によって授業処理が止まる旧方式は採用しません。</p>
  <h2>お問い合わせ</h2>
  <p>提供開始時期や教育利用に関するご相談は <DocLink href="/contact">問い合わせ窓口</DocLink> へご連絡ください。</p>
</DocLayout>

export const ContactPage = () => <DocLayout title="お問い合わせ・通報" lead="現在提供している公開ページと、今後の授業機能に関するお問い合わせを受け付けます。">
  <p><strong>現在は公開ページのみを提供しています。</strong>授業機能は準備中です。</p>
  <h2>不具合・障害のご報告</h2>
  <p>動作しない、エラーが表示される等の場合はご連絡ください。お手数ですが、次の情報を添えていただけると調査が早くなります。</p>
  <ul>
    <li>発生した日時</li>
    <li>お使いのブラウザと端末（例: Chromebook の Chrome）</li>
    <li>操作の手順と、表示されたメッセージ</li>
    <li>該当する公開ページのURL（分かる場合）</li>
  </ul>

  <h2>不適切な内容の通報</h2>
  <p>誹謗中傷、差別的な内容、その他公序良俗に反する公開ページ上の内容を見つけた場合はご連絡ください。授業機能の提供開始後は、授業内で扱う内容の通報も受け付けます。確認のうえ、該当する内容の削除または利用制限を行うことがあります。</p>
  <p>通報の際は、対象となるページのURL、本文、または画面の状況をお知らせください。</p>

  <h2>データの開示・削除のご請求</h2>
  <p>正式な開示・訂正・削除のご請求は、本人、保護者、学校の担当者から受け付けます。現在は生徒の授業データを取得していません。詳細は<DocLink href="/privacy">プライバシーポリシー</DocLink>をご覧ください。</p>

  <h2>連絡先</h2>
  <p>メール: <DocLink href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</DocLink><br />フォーム: <DocLink href={CONTACT_FORM} target="_blank" rel="noopener noreferrer">問い合わせフォームを開く</DocLink></p>
  <p className="doc-note">無償で運営しているため、返信までにお時間をいただく場合があります。新しい授業機能の提供前に緊急のご相談がある場合も、問い合わせ窓口からご連絡ください。</p>
</DocLayout>
