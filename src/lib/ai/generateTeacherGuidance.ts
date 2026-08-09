import { httpsCallable, type Functions } from 'firebase/functions'
export interface GenerateTeacherGuidanceInput { topic: string }
export interface GeneratedTeacherGuidance { teacherGuidance: string }
export const generateTeacherGuidance = async (functions: Functions, input: GenerateTeacherGuidanceInput): Promise<GeneratedTeacherGuidance> => (await httpsCallable<GenerateTeacherGuidanceInput, GeneratedTeacherGuidance>(functions, 'generateTeacherGuidanceCallable')(input)).data
