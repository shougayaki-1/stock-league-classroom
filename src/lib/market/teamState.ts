import type { LessonRunTeamState, MyOrderView } from '../lessonRuns/liveTypes'

export type { LessonRunTeamState, MyOrderView }

/**
 * Builds the initial `lessonRunTeamState/{lessonRunId}/{teamId}` payload for
 * a team that has not yet had an order or a batch settlement — see
 * `src/lib/lessonRuns/liveTypes.ts`'s `LessonRunTeamState` JSDoc for why
 * this is a distinct, team-scoped visibility class (never nested under
 * `lessonRunPublic`/`lessonRunPrivate`). Firestore's `TeamAccount` is the
 * system of record (spec §12.16); this RTDB node is a real-time mirror of
 * it, written only from trusted server code — this factory takes no
 * external input beyond the two values a caller must already know, so it
 * cannot leak another team's data by construction.
 */
export function createEmptyTeamState(input: { updatedAtMillis: number; cash: number }): LessonRunTeamState {
  return {
    cash: input.cash,
    holdings: {},
    lockedBuyValue: 0,
    lockedSellQuantity: {},
    myOrders: [],
    updatedAtMillis: input.updatedAtMillis,
  }
}
