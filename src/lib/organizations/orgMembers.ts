import { httpsCallable, type Functions } from 'firebase/functions'

export interface OrgMember {
  uid: string
  email: string | null
  role: 'owner' | 'admin' | 'teacher'
  status: 'active' | 'suspended'
  membershipVersion: number
}

export interface ListOrgMembersInput {
  orgId: string
}

export interface SuspendOrgMemberInput {
  orgId: string
  uid: string
}

export const listOrgMembers = async (
  functions: Functions,
  input: ListOrgMembersInput,
): Promise<OrgMember[]> =>
  (await httpsCallable<ListOrgMembersInput, OrgMember[]>(functions, 'listOrgMembersCallable')(input)).data

export const suspendOrgMember = async (
  functions: Functions,
  input: SuspendOrgMemberInput,
): Promise<void> => {
  await httpsCallable<SuspendOrgMemberInput, void>(functions, 'suspendOrgMemberCallable')(input)
}
