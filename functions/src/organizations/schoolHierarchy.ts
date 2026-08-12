import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { assertParentContractAllowsSharedQuota, parentContractStateFrom } from './parentContract'

export interface ChildSchool {
  orgId: string
  name: string
  verificationStatus: string
}

export interface LinkSchoolToParentOrgDeps {
  getOrg: (orgId: string) => Promise<{ type: string; parentOrgId: string | null; parentContractState?: unknown } | null>
  setParentOrgId: (schoolOrgId: string, parentOrgId: string) => Promise<void>
  createZeroAllocation: (parentOrgId: string, schoolOrgId: string) => Promise<void>
}

export interface LinkSchoolToParentOrgInput {
  parentOrgId: string
  schoolOrgId: string
}

export const linkSchoolToParentOrg = async (
  deps: LinkSchoolToParentOrgDeps,
  input: LinkSchoolToParentOrgInput,
): Promise<void> => {
  const [parent, school] = await Promise.all([
    deps.getOrg(input.parentOrgId),
    deps.getOrg(input.schoolOrgId),
  ])
  if (!parent || parent.type !== 'parentOrg') throw new Error('対象は上位組織ではありません')
  assertParentContractAllowsSharedQuota(parentContractStateFrom(parent))
  if (!school || school.type !== 'school') throw new Error('対象は学校組織ではありません')
  if (school.parentOrgId) throw new Error('この学校は既に別の上位組織に所属しています')

  await deps.setParentOrgId(input.schoolOrgId, input.parentOrgId)
  await deps.createZeroAllocation(input.parentOrgId, input.schoolOrgId)
}

export const linkSchoolToParentOrgWithAdminSdk = async (input: LinkSchoolToParentOrgInput): Promise<void> => {
  const db = getFirestore()
  const schoolRef = db.doc(`organizations/${input.schoolOrgId}`)
  const allocationRef = db.doc(`organizations/${input.parentOrgId}/schoolAllocations/${input.schoolOrgId}`)

  await db.runTransaction(async (transaction) => linkSchoolToParentOrg({
    getOrg: async (orgId) => {
      const snapshot = await transaction.get(orgId === input.parentOrgId ? db.doc(`organizations/${orgId}`) : schoolRef)
      return snapshot.exists
        ? {
          type: snapshot.get('type') as string,
          parentOrgId: (snapshot.get('parentOrgId') as string | undefined) ?? null,
          parentContractState: snapshot.get('parentContractState'),
          }
        : null
    },
    setParentOrgId: async (schoolOrgId, parentOrgId) => {
      transaction.update(db.doc(`organizations/${schoolOrgId}`), { parentOrgId })
    },
    createZeroAllocation: async () => {
      transaction.set(allocationRef, {
        guaranteedConcurrentLessonsAndMarkets: 0,
        guaranteedTeacherSeats: 0,
        updatedAt: FieldValue.serverTimestamp(),
      })
    },
  }, input))
}

export interface UnlinkSchoolFromParentOrgDeps {
  getOrg: (orgId: string) => Promise<{ parentOrgId: string | null } | null>
  getReservationCount: (parentOrgId: string, schoolOrgId: string) => Promise<number>
  clearParentOrgId: (schoolOrgId: string) => Promise<void>
  deleteAllocation: (parentOrgId: string, schoolOrgId: string) => Promise<void>
}

export const unlinkSchoolFromParentOrg = async (
  deps: UnlinkSchoolFromParentOrgDeps,
  input: { schoolOrgId: string; expectedParentOrgId: string },
): Promise<void> => {
  const school = await deps.getOrg(input.schoolOrgId)
  if (!school?.parentOrgId) throw new Error('この学校はどの上位組織にも所属していません')
  if (school.parentOrgId !== input.expectedParentOrgId) throw new Error('学校の所属先が変更されたため解除できません')

  const reservationCount = await deps.getReservationCount(input.expectedParentOrgId, input.schoolOrgId)
  if (reservationCount > 0) throw new Error('共有枠の予約が残っているため学校を解除できません')

  await deps.clearParentOrgId(input.schoolOrgId)
  await deps.deleteAllocation(input.expectedParentOrgId, input.schoolOrgId)
}

export const unlinkSchoolFromParentOrgWithAdminSdk = async (
  input: { schoolOrgId: string; expectedParentOrgId: string },
): Promise<void> => {
  const db = getFirestore()
  const schoolRef = db.doc(`organizations/${input.schoolOrgId}`)

  await db.runTransaction(async (transaction) => unlinkSchoolFromParentOrg({
    getOrg: async () => {
      const snapshot = await transaction.get(schoolRef)
      return snapshot.exists
        ? { parentOrgId: (snapshot.get('parentOrgId') as string | undefined) ?? null }
        : null
    },
    getReservationCount: async (parentOrgId, schoolOrgId) => {
      const query = db.collection(`organizations/${parentOrgId}/quotaReservations`)
        .where('schoolOrgId', '==', schoolOrgId)
      return (await transaction.get(query)).size
    },
    clearParentOrgId: async () => {
      transaction.update(schoolRef, { parentOrgId: null })
    },
    deleteAllocation: async (parentOrgId, schoolOrgId) => {
      transaction.delete(db.doc(`organizations/${parentOrgId}/schoolAllocations/${schoolOrgId}`))
    },
  }, input))
}

export const listChildSchools = (
  deps: { queryChildSchools: (parentOrgId: string) => Promise<ChildSchool[]> },
  input: { parentOrgId: string },
): Promise<ChildSchool[]> => deps.queryChildSchools(input.parentOrgId)

export const listChildSchoolsWithAdminSdk = (input: { parentOrgId: string }): Promise<ChildSchool[]> => {
  const db = getFirestore()
  return listChildSchools({
    queryChildSchools: async (parentOrgId) => {
      const snapshot = await db.collection('organizations').where('parentOrgId', '==', parentOrgId).get()
      return snapshot.docs.map((document) => ({
        orgId: document.id,
        name: document.get('name') as string,
        verificationStatus: document.get('verificationStatus') as string,
      }))
    },
  }, input)
}
