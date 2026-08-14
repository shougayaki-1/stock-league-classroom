# 市場作成のFunctions集約 調査結果

**日付:** 2026-08-15
**対象:** Phase 5(組織・ライセンス・決済)の残項目 — 市場作成のFunctions集約(`creationStatus`/`recoverMarketCreation`)
**正本:** `docs/superpowers/specs/2026-08-05-lesson-platform-roadmap-design.md` Phase 5節。

## 結論

**実装不要。現行のアーキテクチャで既に要件を満たしている。**

ロードマップは「市場作成をFunctions経由へ集約し、`creationStatus`/`recoverMarketCreation`による部分失敗からの復旧(仮確保→作成→成功時に確定/失敗時に返却)を持つ」ことを求めているが、調査の結果、以下が既に成立している。

1. **クライアントから市場・Firestoreへ直接書き込むパスは存在しない。** `src/lib/market`・`src/lib/lessonRuns`配下に`setDoc`/`addDoc`/`updateDoc`/`runTransaction`の直接呼び出しはなく、すべてCallable(`createLessonRunCallable`等)経由。市場作成は既に「Functions経由へ集約」済み。
2. **`createLessonRun`(`functions/src/lessonRuns/createLessonRun.ts`)は単一のFirestoreトランザクションで完結する。** 失敗時はFirestoreが自動的に何も書き込まずロールバックするため、「仮確保→作成→失敗時に返却」と同等の効果が既に得られている。`lessonRunIdempotency/{hash}`ドキュメントによる冪等キーも既にある。
3. **RTDBへの反映はトリガー型の投影(projection)パターン。** `functions/src/lessonRuns/projections/publicProjection.ts`はFirestoreの状態から都度RTDB向けの表示状態を再構築する純粋関数であり、書き込みタイミングでの部分失敗を手動の状態機械(`creationStatus`)で追跡する必要がない(自己修復的)。

これは`docs/superpowers/specs/2026-08-09-concurrent-lesson-quota-design.md`(「同時授業・市場数」サブプロジェクト)が既に到達していた結論と同じである。ロードマップ文書が書かれた時点(2026-08-05)より実装が先に進んでおり、この項目の前提そのものが解消されている。

## 今後

新たな実装タスクは発生しない。将来、市場作成がFirestore単一トランザクションに収まらない処理(複数リージョンにまたがる、外部APIを呼ぶ等)を必要とするようになった場合にのみ、`creationStatus`型の明示的な状態機械の導入を再検討する。
