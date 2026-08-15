import { httpsCallable, type Functions } from 'firebase/functions'

export interface SetStudentDataRetentionDaysInput { orgId: string; retentionDays: number }

export const setStudentDataRetentionDays = async (functions: Functions, input: SetStudentDataRetentionDaysInput): Promise<void> => {
  await httpsCallable<SetStudentDataRetentionDaysInput, void>(functions, 'setStudentDataRetentionPolicyCallable')(input)
}
