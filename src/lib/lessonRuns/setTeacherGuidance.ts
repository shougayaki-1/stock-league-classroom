import { httpsCallable, type Functions } from 'firebase/functions'
export interface SetTeacherGuidanceInput { lessonRunId: string; teacherGuidance: string }
export interface SetTeacherGuidanceResult { teacherGuidance: string | null }
export const setTeacherGuidance = async (functions: Functions, input: SetTeacherGuidanceInput): Promise<SetTeacherGuidanceResult> => (await httpsCallable<SetTeacherGuidanceInput, SetTeacherGuidanceResult>(functions, 'setTeacherGuidanceCallable')(input)).data
