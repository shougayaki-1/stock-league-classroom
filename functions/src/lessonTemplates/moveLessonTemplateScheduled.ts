import { onSchedule } from 'firebase-functions/v2/scheduler'
import { logger } from 'firebase-functions/v2'
import {
  createAdminSdkMoveDb,
  createAdminSdkMoveStorage,
  runLessonTemplateMoveOperation,
  type MoveDb,
  type MoveStorage,
} from './moveLessonTemplate'

export interface MoveScheduledDb extends MoveDb {
  collection: (path: string) => any
}

export interface MoveScheduledDeps {
  db: MoveScheduledDb
  storage?: MoveStorage
  nowDate?: () => Date
  now?: () => string
  workerId?: string
}

export const runDueLessonTemplateMoveOperations = async (
  deps: MoveScheduledDeps,
): Promise<{ processed: string[] }> => {
  const processed: string[] = []
  const statuses = ['PENDING', 'RUNNING', 'FAILED']

  for (const status of statuses) {
    const snap = await deps.db.collection('lessonTemplateMoveOperations')
      .where('status', '==', status)
      .get()

    for (const doc of snap.docs) {
      const opId = doc.id
      if (!processed.includes(opId)) {
        const result = await runLessonTemplateMoveOperation(
          {
            db: deps.db,
            storage: deps.storage,
            nowDate: deps.nowDate,
            now: deps.now,
          },
          opId,
          deps.workerId,
        )
        if (result.status === 'COMPLETED' || result.status === 'RUNNING' || result.status === 'FAILED') {
          processed.push(opId)
        }
      }
    }
  }

  return { processed }
}

/**
 * Production wiring: Cloud Scheduler run every 5 minutes
 */
export const lessonTemplateMoveScheduled = onSchedule(
  { schedule: 'every 5 minutes', timeZone: 'Asia/Tokyo', region: 'asia-northeast1' },
  async () => {
    try {
      const db = createAdminSdkMoveDb()
      const storage = createAdminSdkMoveStorage()
      await runDueLessonTemplateMoveOperations({
        db: db as MoveScheduledDb,
        storage,
      })
    } catch (error) {
      logger.error('lessonTemplateMoveScheduled failed', error)
    }
  },
)
