import {
  type Firestore,
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore'
import type { OfficialTemplate, PersonalTemplate, TemplateShare, TemplateSpec } from './types'
import { officialTemplateSeeds } from './officialSeeds'

const personalTemplates = (db: Firestore) => collection(db, 'templates')
const officialTemplates = (db: Firestore) => collection(db, 'officialTemplates')

const asTemplateSpec = (template: TemplateSpec): TemplateSpec => structuredClone(template)

export const createPersonalTemplate = async (db: Firestore, ownerUid: string, spec: TemplateSpec) => {
  const ref = await addDoc(personalTemplates(db), {
    ...asTemplateSpec(spec), ownerUid, visibility: 'private', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  })
  return ref.id
}

export const listPersonalTemplates = async (db: Firestore, ownerUid: string): Promise<PersonalTemplate[]> => {
  const result = await getDocs(query(personalTemplates(db), where('ownerUid', '==', ownerUid)))
  return result.docs.map((item) => ({ id: item.id, ...item.data() }) as PersonalTemplate)
}

export const duplicatePersonalTemplate = async (db: Firestore, ownerUid: string, source: TemplateSpec) =>
  createPersonalTemplate(db, ownerUid, { ...asTemplateSpec(source), title: `${source.title} のコピー` })

/** Creates a capability URL document that contains no mutable reference to its source. */
export const createTemplateShare = async (db: Firestore, ownerUid: string, templateId: string, source: TemplateSpec) => {
  const ref = await addDoc(collection(db, 'templateShares'), {
    templateId, snapshot: asTemplateSpec(source), createdByUid: ownerUid, createdAt: serverTimestamp(),
  })
  return ref.id
}

/** Intentionally a direct document lookup: share IDs must never be queried or enumerated. */
export const getTemplateShare = async (db: Firestore, shareId: string): Promise<TemplateShare | undefined> => {
  const result = await getDoc(doc(db, 'templateShares', shareId))
  return result.exists() ? { id: result.id, ...result.data() } as TemplateShare : undefined
}

export const listOfficialTemplates = async (db: Firestore): Promise<OfficialTemplate[]> => {
  const result = await getDocs(officialTemplates(db))
  return result.docs.map((item) => ({ id: item.id, ...item.data() }) as OfficialTemplate)
}

export const saveOfficialTemplate = async (db: Firestore, id: string, spec: TemplateSpec) => {
  await setDoc(doc(db, 'officialTemplates', id), {
    ...asTemplateSpec(spec), visibility: 'official', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }, { merge: true })
}

/** Operator-only bootstrap action. Rules reject calls from ordinary teachers. */
export const seedOfficialTemplates = async (db: Firestore) => {
  await Promise.all(officialTemplateSeeds.map(({ id, spec }) => saveOfficialTemplate(db, id, spec)))
}
