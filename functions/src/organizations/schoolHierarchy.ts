import { getFirestore } from 'firebase-admin/firestore'
export interface ChildSchool { orgId: string; name: string; verificationStatus: string }
export interface LinkSchoolToParentOrgDeps { getOrg: (orgId: string) => Promise<{ type: string; parentOrgId: string | null } | null>; setParentOrgId: (schoolOrgId: string, parentOrgId: string) => Promise<void> }
export interface LinkSchoolToParentOrgInput { parentOrgId: string; schoolOrgId: string }
export const linkSchoolToParentOrg = async (deps: LinkSchoolToParentOrgDeps, input: LinkSchoolToParentOrgInput): Promise<void> => {
  const school = await deps.getOrg(input.schoolOrgId)
  if (!school || school.type !== 'school') throw new Error('対象は学校組織ではありません')
  if (school.parentOrgId) throw new Error('この学校は既に別の上位組織に所属しています')
  await deps.setParentOrgId(input.schoolOrgId, input.parentOrgId)
}
export const linkSchoolToParentOrgWithAdminSdk = (input: LinkSchoolToParentOrgInput): Promise<void> => {
  const db = getFirestore()
  return linkSchoolToParentOrg({ getOrg: async (orgId) => { const snap = await db.doc(`organizations/${orgId}`).get(); return snap.exists ? { type: snap.get('type') as string, parentOrgId: (snap.get('parentOrgId') as string | undefined) ?? null } : null }, setParentOrgId: async (schoolOrgId, parentOrgId) => { await db.doc(`organizations/${schoolOrgId}`).update({ parentOrgId }) } }, input)
}
export interface UnlinkSchoolFromParentOrgDeps { getOrg: (orgId: string) => Promise<{ parentOrgId: string | null } | null>; clearParentOrgId: (schoolOrgId: string) => Promise<void> }
export const unlinkSchoolFromParentOrg = async (deps: UnlinkSchoolFromParentOrgDeps, input: { schoolOrgId: string }): Promise<void> => {
  const school = await deps.getOrg(input.schoolOrgId)
  if (!school?.parentOrgId) throw new Error('この学校はどの上位組織にも所属していません')
  await deps.clearParentOrgId(input.schoolOrgId)
}
export const unlinkSchoolFromParentOrgWithAdminSdk = (input: { schoolOrgId: string }): Promise<void> => {
  const db = getFirestore()
  return unlinkSchoolFromParentOrg({ getOrg: async (orgId) => { const snap = await db.doc(`organizations/${orgId}`).get(); return snap.exists ? { parentOrgId: (snap.get('parentOrgId') as string | undefined) ?? null } : null }, clearParentOrgId: async (schoolOrgId) => { await db.doc(`organizations/${schoolOrgId}`).update({ parentOrgId: null }) } }, input)
}
export const listChildSchools = (deps: { queryChildSchools: (parentOrgId: string) => Promise<ChildSchool[]> }, input: { parentOrgId: string }) => deps.queryChildSchools(input.parentOrgId)
export const listChildSchoolsWithAdminSdk = (input: { parentOrgId: string }): Promise<ChildSchool[]> => {
  const db = getFirestore()
  return listChildSchools({ queryChildSchools: async (parentOrgId) => { const snap = await db.collection('organizations').where('parentOrgId', '==', parentOrgId).get(); return snap.docs.map((doc) => ({ orgId: doc.id, name: doc.get('name') as string, verificationStatus: doc.get('verificationStatus') as string })) } }, input)
}
