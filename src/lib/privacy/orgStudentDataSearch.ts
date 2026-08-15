import { httpsCallable, type Functions } from 'firebase/functions'

export type OrgStudentSearchField = 'displayName' | 'externalIdentifier'

export interface SearchOrgStudentDataInput {
  orgId: string
  field: OrgStudentSearchField
  query: string
  reason: string
}

export interface OrgStudentSearchMatch {
  lessonRunId: string
  participantId: string
  authUid?: string
  identityMode?: string
  displayName?: string
  externalIdentifier?: string
  teamId?: string
  status?: string
}

export interface OrgStudentDataSearchResult {
  expiresAt: string
  truncated: boolean
  matches: OrgStudentSearchMatch[]
}

export const searchOrgStudentData = async (
  functions: Functions,
  input: SearchOrgStudentDataInput,
): Promise<OrgStudentDataSearchResult> =>
  (
    await httpsCallable<SearchOrgStudentDataInput, OrgStudentDataSearchResult>(
      functions,
      'searchOrgStudentDataCallable',
    )(input)
  ).data
