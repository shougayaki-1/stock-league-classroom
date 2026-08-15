import { getFirestore } from 'firebase-admin/firestore'
import { getDatabase } from 'firebase-admin/database'
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'
import {
  saveTeamNote,
  type SaveTeamResearchNoteInput,
  type SaveTeamResearchNoteResult,
  type TeamResearchNoteView,
} from './saveTeamNote'

export interface SaveTeamNoteCallableDeps {
  resolveActorParticipantId: (lessonRunId: string, authUid: string) => Promise<string>
  requireTeamMembership: (lessonRunId: string, teamId: string, actorParticipantId: string) => Promise<void>
  saveTeamNoteFn: (input: SaveTeamResearchNoteInput) => Promise<SaveTeamResearchNoteResult>
}

const resolveActorParticipantIdWithAdminSdk = async (
  lessonRunId: string,
  authUid: string,
): Promise<string> => {
  const db = getFirestore()
  const indexSnap = await db.doc(`lessonRuns/${lessonRunId}/participantsByAuthUid/${authUid}`).get()
  if (!indexSnap.exists) throw new HttpsError('failed-precondition', 'このレッスンランに参加していません。')
  const { participantId } = indexSnap.data() as { participantId: string }
  return participantId
}

const requireTeamMembershipWithAdminSdk = async (
  lessonRunId: string,
  teamId: string,
  actorParticipantId: string,
): Promise<void> => {
  const db = getFirestore()
  const teamSnap = await db.doc(`lessonRuns/${lessonRunId}/teams/${teamId}`).get()
  if (!teamSnap.exists) throw new HttpsError('not-found', 'チームが見つかりません。')
  const team = teamSnap.data() as { memberParticipantIds?: string[] }
  if (!team.memberParticipantIds || !team.memberParticipantIds.includes(actorParticipantId)) {
    throw new HttpsError('permission-denied', 'このチームのメンバーではありません。')
  }
}

const translateSaveTeamNoteError = (error: unknown): unknown => {
  if (error instanceof HttpsError) return error
  if (error instanceof Error) {
    if (error.message === 'Revision mismatch') {
      return new HttpsError('failed-precondition', '他のメンバーがノートを更新しました。最新のノートを確認してください。')
    }
    if (error.message === 'Idempotency key payload mismatch') {
      return new HttpsError('failed-precondition', error.message)
    }
    if (error.message === 'ノートは1文字以上5000文字以内で入力してください。') {
      return new HttpsError('invalid-argument', error.message)
    }
    if (error.message === 'expectedRevision は0以上の整数である必要があります。') {
      return new HttpsError('invalid-argument', error.message)
    }
  }
  return error
}

export const handleSaveTeamResearchNote = async (
  request: { auth?: CallableRequest['auth'] | null; data: unknown },
  deps: SaveTeamNoteCallableDeps,
): Promise<SaveTeamResearchNoteResult> => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'サインインが必要です。')
  const data = request.data as SaveTeamResearchNoteInput
  if (
    !data ||
    !data.lessonRunId ||
    !data.teamId ||
    typeof data.text !== 'string' ||
    data.text.trim().length === 0 ||
    data.text.length > 5000 ||
    typeof data.expectedRevision !== 'number' ||
    !Number.isInteger(data.expectedRevision) ||
    data.expectedRevision < 0 ||
    !data.idempotencyKey
  ) {
    throw new HttpsError('invalid-argument', 'lessonRunId、teamId、text(1〜5000文字)、expectedRevision(0以上の整数)、idempotencyKey は必須です。')
  }

  const actorParticipantId = await deps.resolveActorParticipantId(data.lessonRunId, request.auth.uid)
  await deps.requireTeamMembership(data.lessonRunId, data.teamId, actorParticipantId)

  try {
    return await deps.saveTeamNoteFn({
      lessonRunId: data.lessonRunId,
      teamId: data.teamId,
      text: data.text,
      expectedRevision: data.expectedRevision,
      idempotencyKey: data.idempotencyKey,
    })
  } catch (error) {
    throw translateSaveTeamNoteError(error)
  }
}

export const saveTeamResearchNoteCallable = onCall(
  { region: 'asia-northeast1' },
  async (request) => {
    const db = getFirestore()
    const rtdb = getDatabase()

    const saveTeamNoteWithAdminSdk = (input: SaveTeamResearchNoteInput) =>
      saveTeamNote({
        firestore: {
          runTransaction: (fn) => db.runTransaction((tx) => fn({
            get: async (path) => {
              const snap = await tx.get(db.doc(path))
              return { exists: snap.exists, data: () => snap.data() }
            },
            set: (path, data) => { tx.set(db.doc(path), data) },
          })),
        },
        updateRealtimeNote: async (runId: string, teamId: string, note: TeamResearchNoteView) => {
          await rtdb.ref(`lessonRunTeamState/${runId}/${teamId}`).update({
            researchNote: note,
          })
        },
      }, input)

    return handleSaveTeamResearchNote(request, {
      resolveActorParticipantId: resolveActorParticipantIdWithAdminSdk,
      requireTeamMembership: requireTeamMembershipWithAdminSdk,
      saveTeamNoteFn: saveTeamNoteWithAdminSdk,
    })
  },
)
