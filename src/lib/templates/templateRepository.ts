import {
  type Firestore,
  addDoc,
  collection,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Timestamp,
} from 'firebase/firestore'
import type { OfficialTemplate, PersonalTemplate, TemplateShare, TemplateSpec } from './types'
import { officialTemplateSeeds } from './officialSeeds'

const personalTemplates = (db: Firestore) => collection(db, 'templates')
const officialTemplates = (db: Firestore) => collection(db, 'officialTemplates')

const asTemplateSpec = (template: TemplateSpec): TemplateSpec => structuredClone(template)
export const toTimestampMillis = (value: unknown): number => {
  if (typeof value === 'number') return value
  if (value && typeof (value as Timestamp).toMillis === 'function') return (value as Timestamp).toMillis()
  throw new Error('Firestore timestamp is missing or invalid')
}
const personalFromData = (id: string, value: Record<string, unknown>): PersonalTemplate => ({
  ...(value as Omit<PersonalTemplate, 'id' | 'createdAt' | 'updatedAt'>), id,
  createdAt: toTimestampMillis(value.createdAt), updatedAt: toTimestampMillis(value.updatedAt),
})
const officialFromData = (id: string, value: Record<string, unknown>): OfficialTemplate => ({
  ...(value as Omit<OfficialTemplate, 'id' | 'createdAt' | 'updatedAt'>), id,
  createdAt: toTimestampMillis(value.createdAt), updatedAt: toTimestampMillis(value.updatedAt),
})

export const createPersonalTemplate = async (db: Firestore, ownerUid: string, spec: TemplateSpec) => {
  const ref = await addDoc(personalTemplates(db), {
    ...asTemplateSpec(spec), ownerUid, visibility: 'private', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  })
  return ref.id
}

export const listPersonalTemplates = async (db: Firestore, ownerUid: string): Promise<PersonalTemplate[]> => {
  const result = await getDocs(query(personalTemplates(db), where('ownerUid', '==', ownerUid)))
  return result.docs.map((item) => personalFromData(item.id, item.data()))
}

export const updatePersonalTemplate = async (db: Firestore, id: string, spec: TemplateSpec) => {
  await setDoc(doc(db, 'templates', id), { ...asTemplateSpec(spec), updatedAt: serverTimestamp() }, { merge: true })
}

export const deletePersonalTemplate = async (db: Firestore, id: string) => deleteDoc(doc(db, 'templates', id))

export const duplicatePersonalTemplate = async (db: Firestore, ownerUid: string, source: TemplateSpec) =>
  createPersonalTemplate(db, ownerUid, { ...asTemplateSpec(source), title: `${source.title} のコピー` })

/** Creates a capability URL document that contains no mutable reference to its source. */
export const createTemplateShare = async (db: Firestore, ownerUid: string, source: TemplateSpec) => {
  const ref = await addDoc(collection(db, 'templateShares'), {
    snapshot: asTemplateSpec(source), createdByUid: ownerUid, createdAt: serverTimestamp(),
  })
  return ref.id
}

/** Intentionally a direct document lookup: share IDs must never be queried or enumerated. */
export const getTemplateShare = async (db: Firestore, shareId: string): Promise<TemplateShare | undefined> => {
  const result = await getDoc(doc(db, 'templateShares', shareId))
  if (!result.exists()) return undefined
  const value = result.data()
  return { ...(value as Omit<TemplateShare, 'id' | 'createdAt'>), id: result.id, createdAt: toTimestampMillis(value.createdAt) }
}

export const listOfficialTemplates = async (db: Firestore): Promise<OfficialTemplate[]> => {
  const result = await getDocs(officialTemplates(db))
  return result.docs.map((item) => officialFromData(item.id, item.data()))
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
