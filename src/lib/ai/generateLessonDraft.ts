import { httpsCallable, type Functions } from 'firebase/functions'
export interface GenerateLessonDraftInput { theme: string; mainObjective: string; subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS'; difficulty: 'BASIC' | 'STANDARD' | 'ADVANCED' }
export interface GeneratedLessonDraft { title: string; description: string }
export const generateLessonDraft = async (functions: Functions, input: GenerateLessonDraftInput): Promise<GeneratedLessonDraft> => (await httpsCallable<GenerateLessonDraftInput, GeneratedLessonDraft>(functions, 'generateLessonDraftCallable')(input)).data
