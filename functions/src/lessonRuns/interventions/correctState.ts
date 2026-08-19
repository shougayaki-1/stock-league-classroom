import { getFirestore } from 'firebase-admin/firestore'

/**
 * `CORRECT_STATE` 介入で直せる対象の許可リスト。
 *
 * 元の仕様は `targetPath`（任意の Firestore パス）だったが、それでは教師UIから
 * `randomSeed` / `future` / `restoreGeneration` といった統合仕様書 §26-1 の
 * 禁止フィールドへ到達できてしまう。このコードベースは projection を一貫して
 * allow-list で書いており（deny-list は明示的に却下されている）、書き込み側も
 * 同じ方針に揃える。
 *
 * この2つに絞った根拠:
 *  - 他の8つの介入でも既存 Callable でも直せない
 *  - 授業中に実際に起きる（打ち間違い）
 *  - 禁止フィールドから構造的に遠い（別ドキュメントの単一フィールド）
 *
 * 参加者の所属チーム変更は `assignParticipantToTeamCallable` が既にあるため
 * ここには含めない。
 */
export type CorrectStateTarget = 'PARTICIPANT_DISPLAY_NAME' | 'TEAM_DISPLAY_NAME'

export const CORRECT_STATE_TARGETS: readonly CorrectStateTarget[] = [
  'PARTICIPANT_DISPLAY_NAME',
  'TEAM_DISPLAY_NAME',
]

export const MAX_DISPLAY_NAME_LENGTH = 50

const COLLECTION_BY_TARGET: Record<CorrectStateTarget, string> = {
  PARTICIPANT_DISPLAY_NAME: 'participants',
  TEAM_DISPLAY_NAME: 'teams',
}

export interface CorrectStateInput {
  lessonRunId: string
  target: CorrectStateTarget
  targetId: string
  displayName: string
}

export interface CorrectStateDeps {
  updateDoc: (path: string, patch: Record<string, unknown>) => Promise<void>
  publishLessonProjection?: (lessonRunId: string) => Promise<void>
}

export const correctState = async (
  deps: CorrectStateDeps,
  input: CorrectStateInput,
): Promise<{ target: CorrectStateTarget; targetId: string; displayName: string }> => {
  if (!CORRECT_STATE_TARGETS.includes(input.target)) {
    throw new Error('Unsupported correction target')
  }
  if (!input.targetId) throw new Error('targetId is required')

  const displayName = (input.displayName ?? '').trim()
  if (displayName.length < 1 || displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    throw new Error(`displayName must be 1 to ${MAX_DISPLAY_NAME_LENGTH} characters`)
  }

  const collection = COLLECTION_BY_TARGET[input.target]
  await deps.updateDoc(`lessonRuns/${input.lessonRunId}/${collection}/${input.targetId}`, { displayName })

  // チーム名は教室表示の teams に出るので発行し直す。参加者名は
  // LessonRunDisplayState にも LessonRunPublicState にも載らない
  // （個人を特定しうる情報を全体ブロードキャストへ出さない §26-1）ため不要。
  if (input.target === 'TEAM_DISPLAY_NAME' && deps.publishLessonProjection) {
    await deps.publishLessonProjection(input.lessonRunId)
  }

  return { target: input.target, targetId: input.targetId, displayName }
}

export const correctStateWithAdminSdk = (
  input: CorrectStateInput,
): Promise<{ target: CorrectStateTarget; targetId: string; displayName: string }> => {
  const db = getFirestore()
  return correctState({
    updateDoc: async (path, patch) => { await db.doc(path).update(patch) },
    publishLessonProjection: async (id) => {
      const { publishLessonProjectionForRunWithAdminSdk } = await import('../projections/publicProjection')
      await publishLessonProjectionForRunWithAdminSdk(id)
    },
  }, input)
}
