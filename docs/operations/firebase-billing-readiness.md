# Firebase 課金・予算アラート リリースゲート

Phase C（Cloud Tasks 常時バッチ駆動）着手前に、対象 Firebase プロジェクトが Blaze プランへ移行済みで、予算アラートが設定されていることを確認するための記録。**本番公開のリリースゲートであり、コード実装の完了条件ではない。** 実装者がここに記録できない場合（本番課金変更権限がない等）は `PENDING_EXTERNAL_APPROVAL` のまま残し、コード側の作業は妨げない。

機密値（billing account ID、認証情報、支払い方法の詳細等）はこの文書に記載しない。証跡はアクセス制限付き管理画面へのリンクのみとする。

## 確認項目

| 項目 | 状態 | 確認日 | 確認者 | 証跡URL |
| --- | --- | --- | --- | --- |
| Firebase project ID | `PENDING_EXTERNAL_APPROVAL` | — | — | — |
| Blaze プランへの移行 | `PENDING_EXTERNAL_APPROVAL` | — | — | — |
| 予算アラートの設定 | `PENDING_EXTERNAL_APPROVAL` | — | — | — |

## 記録時の手順

1. 上記表の各行を、実際に確認した担当者が更新する。状態は `PENDING_EXTERNAL_APPROVAL` / `CONFIRMED` / `NOT_APPLICABLE` のいずれか。
2. 証跡URLには、Firebase コンソールまたは Google Cloud コンソールの該当画面へのアクセス制限付きリンクのみを記載する。billing account ID そのものや認証情報は記載しない。
3. `gcloud billing budgets list --billing-account=<ACCOUNT_ID>` は、読み取り権限と billing account ID が確認者自身によって明示的に提供された場合にのみ実行する。`<ACCOUNT_ID>` を推測して実行してはならない。権限・値が提供されない限り、このコマンドは実行せず、上表の状態を `PENDING_EXTERNAL_APPROVAL` のまま残す。
4. すべての項目が `CONFIRMED` になるまで、Phase C の Cloud Tasks 自己連鎖バッチ駆動機構を本番へ公開しない。

## この文書の位置づけ

- 対応する計画: `docs/superpowers/plans/2026-08-05-phase-a-foundation-plan.md` Task 13
- 関連: `docs/superpowers/plans/2026-08-05-master-plan-phase-a-to-h.md` §5「外部依存とリードタイム」（Cloud Tasks の有効化・Firebase Blaze プラン移行）
- 現在の記録者はこの文書に記載された確認作業を実施する権限を持たないため、全項目 `PENDING_EXTERNAL_APPROVAL` のまま記録した。
