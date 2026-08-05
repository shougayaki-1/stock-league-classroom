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

export const TermsPage = () => <DocLayout title="利用規約" lead="本サービスをご利用いただく際の条件です。ご利用をもって本規約に同意したものとみなします。">
  <Disclaimer />
  <h2>第1条（対象）</h2>
  <p>本サービスは、学校その他の教育機関における授業での利用を想定しています。市場を作成する先生（以下「教師」）は、所属機関の規程に従い、本サービスの利用について必要な承認を得たうえでご利用ください。</p>
  <h2>第2条（生徒の参加）</h2>
  <p>生徒はアカウント登録を行わず、参加コードと表示名のみで参加します。<strong>表示名には本名を入力しないでください。</strong>教師は、生徒に対しこの点を事前に指導する責任を負うものとします。</p>
  <h2>第3条（禁止事項）</h2>
  <ul>
    <li>他者を誹謗中傷する、差別的である、その他公序良俗に反する表示名やニュース本文を入力すること</li>
    <li>本サービスに過大な負荷をかける行為、自動化された手段による大量アクセス</li>
    <li>他の教室のデータへ不正にアクセスしようとする行為、セキュリティ機構を回避しようとする行為</li>
    <li>本サービスを投資の助言・勧誘、その他教育目的以外に利用すること</li>
    <li>法令または所属機関の規程に違反する行為</li>
  </ul>
  <h2>第4条（データの取り扱い）</h2>
  <p>本サービスが取得する情報とその取り扱いについては<DocLink href="/privacy">プライバシーポリシー</DocLink>をご確認ください。</p>
  <h2>第5条（サービスの変更・中断・終了）</h2>
  <p>運営者は、保守、障害対応、その他運営上必要と判断した場合、事前の通知なく本サービスの全部または一部を変更、中断または終了することがあります。授業中に市場が停止する可能性があるため、本サービスの動作に依存しない授業計画の準備をお願いします。</p>
  <h2>第6条（利用の制限）</h2>
  <p>運営者は、本規約に違反する行為が認められた場合、または運営の継続に支障があると判断した場合、事前の通知なく特定の利用者による利用を制限し、市場やテンプレートを削除することがあります。</p>
  <h2>第7条（免責）</h2>
  <p>本サービスは無償で現状有姿にて提供され、特定の目的への適合性、正確性、可用性、データが失われないことについて、いかなる保証も行いません。運営者は、本サービスの利用または利用不能によって生じた損害について、法令上免れることのできない場合を除き、責任を負いません。</p>
  <h2>第8条（規約の変更）</h2>
  <p>運営者は本規約を変更することがあります。変更後の規約は本ページに掲載した時点から効力を生じます。</p>
  <h2>第9条（お問い合わせ）</h2>
  <p>本規約に関するお問い合わせは <DocLink href="/contact">問い合わせ窓口</DocLink> までご連絡ください。</p>
</DocLayout>

export const PrivacyPage = () => <DocLayout title="プライバシーポリシー" lead="本サービスが取得する情報と、その利用・保存・削除の方法を説明します。">
  <aside className="doc-callout" role="note">
    <strong>生徒の個人情報は取得しない設計です。</strong>
    <p>生徒はアカウント登録を行いません。氏名、メールアドレス、生年月日、学校名、住所、電話番号を入力する項目は本サービスに存在しません。</p>
  </aside>

  <h2>1. 取得する情報</h2>
  <h3>生徒</h3>
  <ul>
    <li><strong>表示名</strong> — 生徒自身が入力する20文字以内の文字列。本名を入力しないよう案内しています</li>
    <li><strong>匿名ID</strong> — Firebase Authentication が発行する識別子。氏名等とは結び付きません</li>
    <li><strong>セッションID</strong> — 同一端末からの再接続を識別するためにブラウザ内に保存する値</li>
    <li><strong>参加・取引の記録</strong> — 所属チーム、売買の内容と時刻、結果</li>
  </ul>
  <h3>教師</h3>
  <ul>
    <li><strong>Google アカウントの情報</strong> — メールアドレス、および Google Authentication が提供する識別子。ログインと本人確認のためにのみ利用します</li>
    <li><strong>作成したテンプレート・市場の内容</strong></li>
  </ul>
  <h3>共通</h3>
  <ul>
    <li><strong>エラー情報</strong> — 不具合が発生した際の技術情報（エラー内容、発生箇所、ブラウザの種類）。詳細は「4. 外部サービスへの送信」をご覧ください</li>
  </ul>
  <p>本サービスは、広告目的の追跡や、行動履歴に基づくプロファイリングを行いません。</p>

  <h2>2. 利用目的</h2>
  <p>取得した情報は、授業の進行（参加の承認、売買の処理、順位の表示、結果の提示）、不具合の調査と改善、および不正利用への対応にのみ利用します。これらの目的以外に利用することはありません。</p>

  <h2>3. 第三者提供</h2>
  <p>法令に基づく場合を除き、取得した情報を第三者へ提供・販売することはありません。</p>

  <h2>4. 外部サービスへの送信</h2>
  <p>本サービスは以下の外部サービスを利用しています。</p>
  <ul>
    <li><strong>Google Firebase</strong>（Google LLC） — 認証、データの保存、配信基盤として利用します</li>
    <li><strong>Sentry</strong>（Functional Software, Inc.） — 不具合の検知に利用します。<strong>表示名、メールアドレス、匿名ID、IPアドレス等の個人を識別しうる情報は送信しない設定にしています。</strong>送信されるのはエラーの内容と発生箇所、ブラウザの種類に限られます</li>
  </ul>
  <p>これらのサービスでは、情報が日本国外のサーバーで処理される場合があります。</p>

  <h2>5. 保存期間と削除</h2>
  <aside className="doc-callout warning" role="note">
    <strong>現時点では自動削除の仕組みは実装されていません。</strong>
    <p>下記の期間は運営者が手動で削除を行う際の目安です。自動削除の実装後、本ページを更新します。実装前に確実な削除をご希望の場合は、問い合わせ窓口からご連絡ください。</p>
  </aside>
  <ul>
    <li>参加コード — 市場の終了後24時間を目安に無効化</li>
    <li>取引の記録・結果 — 90日を目安に削除</li>
    <li>使用されていない共有リンク — 90日を目安に削除</li>
    <li>生徒の匿名ID — 30日を目安に削除</li>
  </ul>
  <p>教師は、自身が作成した市場・テンプレート・結果を管理画面からいつでも削除できます。</p>

  <h2>6. 開示・削除の請求</h2>
  <p>ご本人または保護者、および学校の担当者からの、取得情報の開示・訂正・削除のご請求に対応します。<DocLink href="/contact">問い合わせ窓口</DocLink> よりご連絡ください。生徒については氏名等を取得していないため、ご請求の際は市場の参加コードと表示名をお知らせください。</p>

  <h2>7. 未成年の利用について</h2>
  <p>本サービスは、学校の授業において教師の管理のもとで利用されることを前提としています。生徒の個人情報を取得しない設計とし、入力項目を表示名のみに限定しているのはこのためです。保護者の方からのお問い合わせにも対応します。</p>

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

export const ContactPage = () => <DocLayout title="お問い合わせ・通報" lead="不具合のご報告、不適切な内容の通報、データの削除請求を受け付けます。">
  <h2>不具合・障害のご報告</h2>
  <p>動作しない、エラーが表示される等の場合はご連絡ください。お手数ですが、次の情報を添えていただけると調査が早くなります。</p>
  <ul>
    <li>発生した日時</li>
    <li>お使いのブラウザと端末（例: Chromebook の Chrome）</li>
    <li>操作の手順と、表示されたメッセージ</li>
    <li>市場の参加コード（分かる場合）</li>
  </ul>

  <h2>不適切な表示名・ニュースの通報</h2>
  <p>誹謗中傷、差別的な内容、その他公序良俗に反する表示名やニュースを見つけた場合はご連絡ください。確認のうえ、該当する市場やテンプレートの停止・削除、利用者の利用制限を行うことがあります。</p>
  <p>通報の際は、市場の参加コードと、対象となる表示名または本文をお知らせください。</p>

  <h2>データの開示・削除のご請求</h2>
  <p>生徒本人、保護者、学校の担当者からのご請求に対応します。生徒については氏名等を取得していないため、市場の参加コードと表示名をお知らせください。詳細は<DocLink href="/privacy">プライバシーポリシー</DocLink>をご覧ください。</p>

  <h2>連絡先</h2>
  <p>メール: <DocLink href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</DocLink><br />フォーム: <DocLink href={CONTACT_FORM} target="_blank" rel="noopener noreferrer">問い合わせフォームを開く</DocLink></p>
  <p className="doc-note">無償で運営しているため、返信までにお時間をいただく場合があります。新しい授業機能の提供前に緊急のご相談がある場合も、問い合わせ窓口からご連絡ください。</p>
</DocLayout>
