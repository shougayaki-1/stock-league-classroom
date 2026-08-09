import { httpsCallable, type Functions } from 'firebase/functions'

export interface Invitation {
  id: string
  orgId: string
  email: string
  role: 'admin' | 'teacher'
  status: 'PENDING' | 'ACCEPTED'
  invitedByUid: string
  createdAt: unknown
}

export interface CreateInvitationInput {
  orgId: string
  email: string
  role: 'admin' | 'teacher'
}

export const createInvitation = async (
  functions: Functions,
  input: CreateInvitationInput,
): Promise<{ invitationId: string }> =>
  (await httpsCallable<CreateInvitationInput, { invitationId: string }>(functions, 'createInvitationCallable')(input)).data

export interface AcceptInvitationInput {
  orgId: string
  invitationId: string
}

export const acceptInvitation = async (
  functions: Functions,
  input: AcceptInvitationInput,
): Promise<{ status: 'ACCEPTED' | 'ALREADY_MEMBER' }> =>
  (await httpsCallable<AcceptInvitationInput, { status: 'ACCEPTED' | 'ALREADY_MEMBER' }>(functions, 'acceptInvitationCallable')(input)).data

export const listMyInvitations = async (functions: Functions): Promise<Invitation[]> =>
  (await httpsCallable<void, Invitation[]>(functions, 'listMyInvitationsCallable')()).data
