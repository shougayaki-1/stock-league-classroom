import { addDoc, collection, doc, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore'
import { personalOrgId } from '../org/personalOrgId'
import type { LessonContent } from './types'

const templates = (db: Firestore) => collection(db, 'lessonTemplates')
export const createLessonTemplate = async (db: Firestore, createdByUid: string, draft: LessonContent): Promise<string> => {
  const ref = await addDoc(templates(db), {
    orgId: personalOrgId(createdByUid), createdByUid, draft,
    currentPublishedVersionId: null, status: 'DRAFT', visibility: 'PRIVATE',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  })
  return ref.id
}

/** Autosave: overwrites `draft` only. Never touches the immutable versions subcollection. */
export const saveDraft = async (db: Firestore, templateId: string, draft: LessonContent): Promise<LessonContent> => {
  await setDoc(doc(db, 'lessonTemplates', templateId), { draft, updatedAt: serverTimestamp() }, { merge: true })
  return draft
}
