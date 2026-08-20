import { getFirestore } from 'firebase-admin/firestore'
import type { LessonRunProjectionSource } from './source'
import type { LessonRunDisplayMode } from './displayProjection'
import { findPhaseLabel, type PhaseWithDisplayConfig } from '../phases/phaseLabel'

/**
 * `LessonRunProjectionSource` を組み立てる唯一の場所。
 *
 * `toLessonRunPublicState` / `toLessonRunDisplayState` は allow-list で
 * source から出力を絞るが、その source 自体を誰が組むかは Phase B 時点で
 * 決まっていなかった（publicProjection.ts の JSDoc「Callers ... are
 * responsible for assembling LessonRunProjectionSource from Firestore」）。
 * 結果として setTeacherGuidance.ts だけが自前の簡易版を持ち、他の呼び出し元が
 * 存在しなかった。このモジュールがその組み立てを引き受ける。
 *
 * `randomSeed` / `restoreGeneration` / `future` は `LessonRunProjectionSource`
 * の必須フィールドとして型に存在するが（禁止フィールドであることを型の上で
 * 明示するため）、ここでは lessonRun doc の実値を写さず固定のダミー値を入れる。
 * projection 関数はこれらを一切読まないので出力に影響せず、万一 projection 側で
 * 読んでしまった場合も本物の乱数シードや未来価格計画が漏れない。
 */
export interface BuildProjectionSourceDeps {
  getRun: (lessonRunId: string) => Promise<Record<string, unknown> | null>
  getTeams: (lessonRunId: string) => Promise<Array<Record<string, unknown>>>
  now?: () => number
}

interface PhaseSnapshot extends PhaseWithDisplayConfig {
  publicTask?: string | null
}

interface TemplateSnapshot {
  title?: string
  description?: string | null
  phases?: PhaseSnapshot[]
}

export const buildProjectionSource = async (
  deps: BuildProjectionSourceDeps,
  lessonRunId: string,
): Promise<LessonRunProjectionSource | null> => {
  const run = await deps.getRun(lessonRunId)
  if (!run) return null

  const templateSnapshot = (run.templateSnapshot ?? {}) as TemplateSnapshot
  const currentPhaseId = (run.currentPhaseId as string | null | undefined) ?? null
  const currentPhase = currentPhaseId
    ? templateSnapshot.phases?.find((phase) => phase.id === currentPhaseId)
    : undefined

  const teams = await deps.getTeams(lessonRunId)

  return {
    orgId: run.orgId as string,
    status: run.status as string,
    title: templateSnapshot.title ?? '',
    goal: templateSnapshot.description ?? null,
    currentPhaseId,
    currentPhasePublicTask: currentPhase?.publicTask ?? null,
    currentPhaseLabel: findPhaseLabel(templateSnapshot.phases, currentPhaseId),
    currentPhaseEndsAtMillis: (run.currentPhaseEndsAtMillis as number | null | undefined) ?? null,
    updatedAtMillis: deps.now ? deps.now() : Date.now(),
    teacherGuidance: (run.teacherGuidance as string | null | undefined) ?? null,
    joinCode: (run.joinCode as string | null | undefined) ?? null,
    displayModeOverride: (run.displayModeOverride as LessonRunDisplayMode | null | undefined) ?? null,
    teams: teams.map((team) => ({
      id: team.id as string,
      displayName: team.displayName as string,
      // 公開集計ラベルはまだどこも書いていない。値が生まれた時点でここに繋ぐ。
      publicAggregateLabel: null,
    })),
    // 通知の公開は本タスクの範囲外。lessonRunPublic の notifications を
    // 書く本番コードは現時点で存在しないため、空配列が実態と一致する。
    recentNotifications: [],
    // --- 以下は禁止フィールド。実値は決して写さない（モジュールJSDoc参照）。
    randomSeed: '',
    restoreGeneration: 0,
  }
}

/** 本番配線: Firestore Admin SDK。 */
export const buildProjectionSourceWithAdminSdk = (
  lessonRunId: string,
): Promise<LessonRunProjectionSource | null> => {
  const db = getFirestore()
  return buildProjectionSource({
    getRun: async (id) => {
      const snap = await db.doc(`lessonRuns/${id}`).get()
      return snap.exists ? (snap.data() as Record<string, unknown>) : null
    },
    getTeams: async (id) => {
      const snap = await db.collection(`lessonRuns/${id}/teams`).get()
      return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    },
  }, lessonRunId)
}
