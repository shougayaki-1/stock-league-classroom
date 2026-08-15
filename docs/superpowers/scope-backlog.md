# スコープ台帳

**日付:** 2026-08-15
**目的:** これまでに書いた33件の設計仕様書(`docs/superpowers/specs/`)すべてから「今回は扱わない」と明記された項目を抜き出し、ロードマップ本体(`docs/superpowers/specs/2026-08-05-lesson-platform-roadmap-design.md`、Phase 0〜7)と突き合わせた棚卸し。新規チャットでこのうちどれか1つのスコープを把握させるための参照資料として使う。

正本は`docs/superpowers/specs/2026-08-05-integrated-platform-spec.md`(統合仕様書)。ロードマップ文書自体は統合仕様書に差し替え済みの位置づけだが、フェーズ構造の参照元としてはこちらを使う。

---

## Phase 0: 現行版の安全化と基準値計測 — 実装済み(2026-08-15訂正)

> **訂正:** 「対応する日付付きスペックが1件も存在しない」ことを根拠に未着手と判定していたが誤り。旧RTDB直接公開モデル(`prices`/`companies`ノード)自体が現行アーキテクチャに存在せず、`database.rules.json`は`lessonRunPublic`/`lessonRunPrivate`/`lessonRunTeamState`等の権限分離ノードに置き換わっている。`functions/src/market/toPublicView.ts`が生徒向け公開ビューをサーバー側で一元生成し、`endPrice`/`seed`等のruntime内部値はクライアントに一切渡らない設計になっている。先読み脆弱性は個別修正ではなく、統合仕様書ベースの再設計によって構造的に解消済み。

## Phase 1: 授業エンジンv2 — 実装済み(6項目すべて、2026-08-15訂正)

> **訂正:** 「対応する日付付きスペックが1件も存在しない」ことを根拠に未着手と判定していたが誤り。スペック文書を経由せず`functions/src/market/`・`functions/src/lessonRuns/`・`functions/src/organizations/`配下に直接実装されていた。

- 1.1 組織の器 — 実装済み。`functions/src/organizations/personalOrg.ts`の`ensurePersonalOrg`(冪等な個人組織自動生成)、`firestore.rules`の`createdByUid`/`orgId`強制ルール
- 1.2 LessonTemplate v2スキーマとバージョン管理 — 実装済み。`functions/src/lessonTemplates/publishLessonVersion.ts`(不変LessonVersion、`currentPublishedVersionId`ポインタ管理)
- 1.3 Cloud Functions基盤 — 実装済み。`functions/src/market/taskHandler.ts`(Cloud Tasks = Blaze機能)、`functions/packages/market-public-content`等の共有パッケージ切り出し
- 1.4 ラウンド進行と一括約定 — 実装済み。`functions/src/market/engine/settleBatch.ts`、`submitOrder.ts`、`batchScheduler.ts`
- 1.5 銘柄別ニュースと需給連動 — 実装済み。`functions/src/market/engine/informationImpact.ts`
- 1.6 予想・判断理由の記録と振り返り — 実装済み。`functions/src/market/predictionCheckpoint.ts`、`functions/src/lessonRuns/responses/`・`surveys/`

## Phase 2: 授業運用の質 — 一部未着手

コントロールルーム(08-04系2件)・Guided Builder・試運転モードは実装済み。

- 未着手: Research Desk(生徒側、授業フェーズに応じた画面出し分け)

## Phase 3: AI Lesson Studio ベータ — 一部未着手

コアインフラ・授業案作成・資料アップロード・スライド生成・利用枠は実装済み。

**実装済みサブプロジェクトのスコープ外項目:**

- AI Lesson Studio コアインフラ＋授業案作成(08-09)
  - ニュース・決算・企業設定案/説明文・スライド案/振り返り設問/授業後要約の4機能 — 別仕様として後日
  - §15.4の7トグルのうちAI以外の6項目 — Phase 5寄りの別スコープ
  - §15.5の利用枠ハード上限・原価ログ集計・組織共通クレジット・教師ごと上限・緊急停止 — v1は利用ログ記録のみ
  - 実際のAIプロバイダ実装(Claude API・Vertex AI等) — プロバイダ未選定
- 資料/AIへのファイルアップロード(08-09)
  - スキャン画像・写真・図表画像の対応 — 画像OCRに外部プロバイダ選定が必要
- AI授業スライド生成(08-09)
  - RTDB書き込み失敗時の明示的な追加リトライ機構
- AI利用枠の本運用(08-14)
  - LLMプロバイダ接続自体 — `unconfiguredLlmProvider`のまま
  - 教師ごとの個別上限 — 学校組織向けは将来拡張
  - 緊急停止(キルスイッチ)の更新UI — Firestoreコンソール手動操作のまま

**未着手項目:**

- 利用者を運営者許可アカウントに限定するアクセス制御(ベータの「限定公開」そのもの)

## Phase 4: 家庭科モード — 実装済み(バックエンド・基本UI)、教師UI作り込みは要拡充(2026-08-15訂正)

> **訂正:** 「別スペックが必要」の初期メモ(旧ロードマップ文書)を根拠に丸ごと未着手と判定していたが誤り。統合仕様書§13(家庭科・生活設計シミュレーション)・§25「Phase D: 家庭科完成」・§26不変条件15項・§27.4受け入れテストに正式な仕様が存在し、`functions/src/homeEconomics/`配下にエンジン一式(`annualCashFlow.ts`・`assetReturn.ts`・`mortgage.ts`・`insurance.ts`・`lifeEvents.ts`・`publicSupport.ts`・`retirement.ts`・`shortfallOptions.ts`・`settleRound.ts`)、`goalPackage.ts`(目標達成型評価)、`checkpointRestore.ts`(人生段階をまたぐ保存・復元)が実装済み(テスト20件)。コミット履歴に「confirm Phase D completion conditions」「close the §27.4 acceptance-test gap」など仕様準拠検証コミットあり。

**未着手として残る点:**

- 教師用UI — `HouseholdRoundControlPanel.tsx`は直近コミットで追加された「最小限のコントロールパネル」にとどまり、作り込みが薄い
- §13.3の役割・人物別/クラス段階分担など発展的な授業形式のUI対応 — コアプロフィール中心の実装で未確認
- `src/lib/homeEconomics/`のクライアント側表示ロジック(engine群の可視化)が薄い可能性 — 要詳細確認

## Phase 5: 組織・ライセンス・決済 — 実装済み(2026-08-15更新)

最もスペック数が多いフェーズ(13件)。決済まわり、組織階層、教材の移動まですべて実装済み。

> **注記(2026-08-15):** 以下の「スコープ外項目」欄はサブプロジェクト単位のスナップショットであり、後続サブプロジェクト(08-11・08-12等)が先行サブプロジェクトのスコープ外項目を実質的に埋めているケースがある(3件を下記で訂正済み)。この欄全体を「現在も未実装」と読まないよう注意。

**実装済みサブプロジェクトのスコープ外項目:**

- 上位組織階層(08-09)
  - §19.3 枠配分(共有プール・学校ごとの最低保証) — 別サブプロジェクトへ
  - 学校紐付けの相互合意の仕組み — 両組織管理者のみ紐付け可能という単純な制約に簡略化
  - 組織名検索機能(学校追加フォーム)
- プラン・利用枠の土台(08-09)
  - §18.9 作成時の利用枠確保(仮確保→作成→確定/返却) — 次のサブプロジェクトへ
  - プランのアップグレード/ダウングレード操作・支払い連携(§18.7・§18.8)
  - 教師席の個別管理・実際の消費量計測(§18.6) — 上限の数値のみ扱う
- 学校組織作成・招待(08-09)
  - 共通リンク・コードによる招待方式
  - ドメイン認証、ドメインなし利用者の管理者確認
- Stripe Checkout決済(08-09)
  - ~~`INVOICE`/`BANK_TRANSFER`/`MANUAL`の支払い方法対応~~ → **2026-08-15訂正: 実装済み**。`src/lib/billing/invoiceSubscription.ts`の`BillingOverview.paymentMethod`型に4種、`BillingSection.tsx`に表示あり(08-12で実装)
  - 自動更新・解約・支払い失敗リトライ等(`checkout.session.completed`以外のWebhook)
  - 契約期間(§18.5、月額/年額/イベント短期等)のデータモデル
  - ~~教師向けの請求履歴閲覧UI — 申し込みボタンとリダイレクトのみ~~ → **2026-08-15訂正: 実装済み**。`BillingSection.tsx`に請求書一覧(状態・支払期限・Hosted Invoice Pageリンク)あり(08-12で実装)
- Stripeサブスクリプションライフサイクル(08-09)
  - Invoicing製品(請求書払い・Hosted Invoice Page)の導入 — 将来の別サブプロジェクトへ(後に08-12で実装済み)
- 教師席管理(08-09)
  - ~~招待受諾時の`teacherSeats`上限の実際の強制(超過時拒否) — 他の制限軸とまとめて§18.9へ~~ → **2026-08-15訂正: 実装済み**。`functions/src/organizations/invitations.ts:166-169`で`canIncreaseLimitedResource`チェック+`reserveTeacherSeat`予約(08-11で実装)
- 上位組織の枠配分・共有プール(08-11)
  - concurrentLessonsAndMarkets・teacherSeats以外の5軸の計測
  - 上位契約終了後の学校単独契約移行(§19.4) — 後に08-12で実装
  - アプリ内のStripe契約変更画面
- Stripeダウングレード・整理猶予(08-11)
  - アプリ内の独自プラン変更UI・Stripe Subscription Scheduleの直接操作
  - 超過データ・メンバー・LessonRunの自動削除または自動停止
  - 未実装5軸(participants/aiCredits/templateStorage/resultRetentionDays/eventExtraCapacity)の記録・強制
- 上位契約終了時のデータ保持・学校単独契約移行(08-12)
  - 親組織・学校組織・LessonRun・メンバー・教材・生徒データの削除
  - 上位組織契約をアプリ内で新規購入・変更する画面 — 既存Stripe Dashboard運用を維持
  - 請求書払い・振込・手動請求への移行フロー
- 年額請求書サブスクリプション・請求先プロフィール(08-12)
  - 個別見積・値引き・営業承認フロー(Stripe Quotes)
  - 税計算の有効化、税率・適格請求書制度
  - 返金・Credit Note・複数通貨・独自督促メール・会計ソフト連携
  - 子学校の請求情報を上位組織へ共有する機能
- 作成時の利用枠確保(同時授業・市場数)(08-09)
  - 他の6制限軸(参加人数・教師席・AIクレジット・テンプレート保存・結果保持・イベント追加枠)の強制 — 各々別サブプロジェクトへ
- maxParticipants/expectedParticipants分離(08-15)
  - 上限(80)超過時のクランプ(自動切り下げ) — 作成拒否のみ実装
  - `studentCount`の永続化・テンプレートスキーマ変更

**実装済み(2026-08-15):**

- 教材の「移動」(所有権が移動先組織へ完全に移る操作) — `functions/src/lessonTemplates/moveLessonTemplate.ts`, `moveLessonTemplateScheduled.ts`, `previewLessonTemplateMoveCallable`, `moveLessonTemplateCallable`, `getLessonTemplateMoveOperationCallable`, `lessonTemplateMoveScheduled`(移転元・移転先の双方owner限定、Cloud Storageのtemplate-scoped化、不変版・最新資料・派生関係の維持、COMMUNITY公開自動解除、組織内承認リセット、過去LessonRun移転元保持、監査ログ記録、Scheduled Reconciler)。

**未着手項目:**

- なし

## Phase 6: テンプレートマーケットプレイス — 一部未着手

6サブプロジェクト全て実装済み。

**実装済みサブプロジェクトのスコープ外項目:**

- マーケットプレイス検索・閲覧(08-15)
  - カーソルページネーション — v1では実装せず
  - 全文検索(Algolia等) — 必要になれば外部検索サービス追加を別サブプロジェクトで検討
- 公開範囲の拡張(COMMUNITY公開)(08-15)
  - `VERIFIED`/`OFFICIAL`区分 — 人手審査・運営側作成前提のため通報と審査の別サブプロジェクトへ
  - 外部派生禁止の学校トグル(§17.3) — 対応する`organizations`フィールドが未存在
- 派生関係の記録(08-15)
  - 非公開(PRIVATE)のままの複製先の逆引き表示 — プライバシー上の懸念、COMMUNITY公開済みの派生のみ表示
- 通報と審査(運営者向け)(08-15)
  - 公式認証(VERIFIED)の付与
  - 投稿者の利用停止
  - 審査履歴の高度な検索
  - §17.7の10項目チェックリストの構造化 — 簡易enum+自由記述に簡略化
- レビュー(評価・コメント)(08-15)
  - 共同教師(`teacherRoles`)によるレビュー資格
  - コメント・Q&Aの独立スレッド機能 — レビュー内の自由記述欄1件のみ

**未着手項目:**

- 公開区分のうち「認証済み(VERIFIED)」「公式(OFFICIAL)」の実装本体

## Phase 7: エンタープライズ管理者機能 — 一部未着手

4サブプロジェクト実装済み。

**実装済みサブプロジェクトのスコープ外項目:**

- 招待失効+ロール変更(08-15)
  - `suspended`メンバーの復帰機能自体
- 利用状況ダッシュボード(08-15)
  - 過去のピーク値(履歴)の追跡・表示 — 追跡データが存在しない
- 組織内教材承認フロー(08-15)
  - 「組織テンプレートライブラリ」専用の一覧・管理UI — 承認ステータス管理のみ実装
- 組織一括エクスポート(生徒データ)(08-15)
  - 保持期限管理ワークフロー(§21.2、判断待ちキュー)
  - 監査ログ(§21.6)
  - admin/owner別アクセス範囲制御(§21.5)
  - テンプレート・events・checkpoints — 生徒データそのものではないため対象外

**実装済み(2026-08-15):**

- 監査ログの実体 — `functions/src/privacy/auditLog.ts`(記録)・`listOrgAuditLogCallable`(閲覧、owner/admin限定)。現時点では`exportOrgStudentDataCallable`のみを記録対象とし、他の高リスク操作への拡張は追加のスコープとする。
- 保持期間の組織ポリシー設定(入口部分) — `setStudentDataRetentionPolicyCallable`(owner限定)。期限到来時の対応待ちキュー・匿名化/削除/延長の判断ワークフローは別スコープのまま。
- 組織全体の一括削除 — `purgeSchoolOrgCallable`(owner限定、上位組織リンク・配下学校の有無を事前チェック)。監査ログは組織削除後も残るよう`orgDeletionAuditLog`(トップレベル)に記録。Stripeサブスクリプション解約・COMMUNITY公開テンプレートの取り扱いは別スコープのまま。
- 管理者向けの生徒データ検索 — `functions/src/privacy/searchOrgStudentData.ts` / `searchOrgStudentDataCallable`(ownerは組織全体、adminは自身がteacherRolesに含まれる授業のみ、閲覧理由入力・完全一致検索・監査ログ記録・10分自動破棄)。
- 年度単位のアーカイブ — `functions/src/privacy/annualArchive.ts`, `annualArchiveScheduled.ts`, `previewAnnualArchiveCallable`, `scheduleAnnualArchiveCallable`, `cancelAnnualArchiveCallable`, `listAnnualArchiveJobsCallable`(owner限定、事前プレビュー、予約・取消・ロールバック・監査ログ、Cloud Scheduler連携)。

**未着手項目(生徒データの組織単位の統制):**

- なし（Phase 7の生徒データ組織単位統制の全主要項目が実装完了）

## UI刷新トラック(フェーズ番号外)

ロードマップの番号付きフェーズとは別に走っているUI刷新の系列。

- 管理画面ワークスペース化・第1弾(08-04)
  - ニュースプリセット管理(サブプロジェクト2)
  - シナリオ予約(サブプロジェクト3)
  - 教室サイネージのkaiseiからの移植(サブプロジェクト5)
  - 生徒側画面の全面刷新 — 旧CSS除去のみ実施
  - 「ホストの取得ができません」不具合 — 別トラックの不具合調査として分離
- 教師・生徒UX/ナビゲーション再設計(08-04)
  - 「緊急暴落」「緊急急騰」機能の実装 — 仕様未定のため今回は削除のみ
  - 「情報照会端末」機能の実装 — 今回は非表示化のみ
  - サイネージ画面の埋め込み表示化 — 別タブで開く現行運用を維持
  - 生徒画面のビジュアルデザイン全面刷新 — オンボーディングカードと表記統一のみ
- Guided Lesson Builder(08-09)
  - 試運転モード(PROVISIONAL定数の設定画面) — 別仕様として後日(後に08-09 tuning-modeで実装)
  - 保険の内部リスク係数・イベント発生確率・需給感度などの内部パラメータ調整 — JSONインポート/エクスポート等の別手段へ
  - 複数教師によるリアルタイム共同編集 — §16.3で「初期は必須にしない」と明記
- 試運転モード参照ダッシュボード(08-09)
  - 値のライブ編集・Firestore設定ドキュメントへの動的上書き — レビューサイクルを要する別スコープ
  - 授業実施中の実測値の可視化 — 第2段階として構想しうるがv1には含めない
  - 教材(LessonContent)単位でのオーバーライド機能

---

設計仕様33件のうち`2026-08-15-template-share-links-v2`・`market-creation-functions-consolidation`・`stripe-webhook-ordering-and-customer-reuse`の3件は明示的な対象外記載なし(範囲内で完結)。
