import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

export interface OrgMember {
  uid: string
  email: string | null
  role: 'owner' | 'admin' | 'teacher'
  status: 'active' | 'suspended'
  membershipVersion: number
}

type MemberDoc = Omit<OrgMember, 'email'>

export interface ListOrgMembersDeps {
  getMemberDocs: (orgId: string) => Promise<MemberDoc[]>
  resolveEmails: (uids: string[]) => Promise<Record<string, string | null>>
}

export interface ListOrgMembersInput { orgId: string }

export const listOrgMembers = async (
  deps: ListOrgMembersDeps,
  input: ListOrgMembersInput,
): Promise<OrgMember[]> => {
  const docs = await deps.getMemberDocs(input.orgId)
  if (docs.length === 0) return []
  const emails = await deps.resolveEmails(docs.map((doc) => doc.uid))
  return docs.map((doc) => ({ ...doc, email: emails[doc.uid] ?? null }))
}

/** Production wiring: Firestore Admin SDK + Firebase Admin Auth batch lookup. */
export const listOrgMembersWithAdminSdk = (orgId: string): Promise<OrgMember[]> => {
  const db = getFirestore()
  return listOrgMembers({
    getMemberDocs: async (id) => {
      const snap = await db.collection(`organizations/${id}/members`).get()
      return snap.docs.map((doc) => ({
        uid: doc.id,
        role: doc.get('role') as MemberDoc['role'],
        status: doc.get('status') as MemberDoc['status'],
        membershipVersion: doc.get('membershipVersion') as number,
      }))
    },
    resolveEmails: async (uids) => {
      const result = await getAuth().getUsers(uids.map((uid) => ({ uid })))
      const emails: Record<string, string | null> = {}
      for (const uid of uids) emails[uid] = null
      for (const user of result.users) emails[user.uid] = user.email ?? null
      return emails
    },
  }, { orgId })
}
