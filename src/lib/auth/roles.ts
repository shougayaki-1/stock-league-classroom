export type ClassroomRole = 'teacher' | 'student'
export interface TeacherIdentity { uid: string; email: string; role: 'teacher' }
export interface StudentIdentity { uid: string; role: 'student'; isAnonymous: true }
export const isTeacherIdentity = (user: { uid: string; email: string | null; isAnonymous: boolean }): user is { uid: string; email: string; isAnonymous: false } => !user.isAnonymous && Boolean(user.email)
