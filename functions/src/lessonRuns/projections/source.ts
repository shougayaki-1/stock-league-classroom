import type { LessonRunDisplayMode } from './displayProjection'

/**
 * The full/internal shape of a lessonRun's live state as it exists
 * server-side (a composite of the `lessonRuns/{lessonRunId}` Firestore doc,
 * its current phase, its teams, and its recent event log) — i.e. everything
 * `toLessonRunPublicState`/`toLessonRunDisplayState` are handed as input and
 * must project down from, never pass through unfiltered.
 *
 * `functions` and the client app (`src/lib`) do not share a types module
 * (see functions/src/lessonRuns/phases/stateMachine.ts's `LessonRunStatus`
 * JSDoc for the established precedent) — `rootDir: "src"` in
 * functions/tsconfig.json makes importing anything under the repo's
 * top-level `src/` a compile error. This type is therefore a
 * duplicated-by-necessity server-side counterpart to the client's
 * `LessonRunPublicState`/`LessonRunDisplayState` (src/lib/lessonRuns/
 * liveTypes.ts) — the two are kept in sync by convention/review, not by the
 * type system, exactly like `LessonRunStatus` already is.
 *
 * FORBIDDEN FIELDS — the entire reason this type is split from the public/
 * display projections: `randomSeed`, `restoreGeneration`, and `future` must
 * never appear in any value returned by `toLessonRunPublicState` or
 * `toLessonRunDisplayState` (spec §26-1; see liveTypes.ts's
 * LessonRunPrivateState). `teams[].individualResponses` and
 * `teams[].unsubmittedParticipantIds` must never appear either — the first
 * is each member's raw response body (Firestore system of record only), the
 * second would let the classroom-wide public/display feed be used to single
 * out which specific students haven't answered yet, which is exactly the
 * kind of participant-identifying signal §26-1's public/private split
 * exists to keep off any broadly-readable node.
 */
export interface LessonRunProjectionSource {
  orgId: string
  status: string
  title: string
  goal: string | null
  currentPhaseId: string | null
  /** The current phase's teacher-authored, already-public prompt/task text (safe for LessonRunPublicState.publicTask). */
  currentPhasePublicTask: string | null
  /**
   * 現在フェーズの教師・生徒向け日本語名（`displayConfig.label`）。
   * 内部IDそのものを画面に出さないために projection へ載せる。フェーズ名は
   * 価格・係数・シードを何も含まず、教室に投影してよい情報である。
   * ラベルが設定されていないフェーズでは `null`。
   */
  currentPhaseLabel: string | null
  /**
   * 現在フェーズの終了時刻（エポックミリ秒）。制限時間の無いフェーズでは null。
   * public/display の両 projection にそのまま載る。フェーズの終了時刻は未来の
   * 価格・係数・乱数シードを何も明かさないため §26-1 の禁止対象には当たらず、
   * 同じ理由で `nextBatchAtMillis` が既に公開されている。残り秒数を
   * サーバ側で計算して渡すと publish 時点で固定されて古くなるため、時刻を
   * 渡してクライアントが描き直す（`nextBatchAtMillis` と同じ規約）。
   */
  currentPhaseEndsAtMillis: number | null
  updatedAtMillis: number
  /** Teacher-authored guidance meant for the whole class (projector display). */
  teacherGuidance: string | null
  /** 参加コード (6文字)。StartScreen の QR/コード描画用。 */
  joinCode: string | null
  /**
   * 教師が `SWITCH_DISPLAY_MODE` 介入で明示的に選んだ教室表示のモード。
   * `null` のとき `deriveDisplayMode(status)` の自動導出に従う。表示モード
   * そのものであり禁止フィールドには当たらない（価格・係数・シードを何も
   * 含まない）。
   */
  displayModeOverride: LessonRunDisplayMode | null
  teams: LessonRunProjectionTeamSource[]
  /** Recent lesson-event-log entries eligible for broadcast — see notifications.ts's `classifyNotification`. */
  recentNotifications: LessonRunProjectionNotificationSource[]

  /** FORBIDDEN — see this interface's JSDoc. Never read by any projection function. */
  randomSeed: string
  /** FORBIDDEN — see this interface's JSDoc. Never read by any projection function. */
  restoreGeneration: number
  /** FORBIDDEN — the private future-price/coefficient plan itself (spec §26-1). Never read by any projection function. */
  future?: unknown
}

export interface LessonRunProjectionTeamSource {
  id: string
  displayName: string
  /** Already-public aggregate figure/label (e.g. rank), safe for LessonRunDisplayState. Null when nothing is publishable yet. */
  publicAggregateLabel: string | null
  /** FORBIDDEN — raw per-member response bodies. Never read by any projection function. */
  individualResponses?: Record<string, unknown>
  /** FORBIDDEN — reveals which specific participants have not yet submitted. Never read by any projection function. */
  unsubmittedParticipantIds?: string[]
}

export interface LessonRunProjectionNotificationSource {
  id: string
  /** The underlying lesson-event `type` string (appendLessonEventInTransaction's `input.type`) — fed to `classifyNotification`. */
  type: string
  occurredAtMillis: number
  /** FORBIDDEN — internal-only actor identity. Never read by any projection function. */
  actorId?: string | null
  /** FORBIDDEN — the raw event payload. Never read by any projection function. */
  payload?: unknown
}
