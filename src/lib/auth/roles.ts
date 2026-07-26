export type ClassroomRole = 'teacher' | 'student'
export interface TeacherIdentity { uid: string; email: string; role: 'teacher' }
export interface StudentIdentity { uid: string; role: 'student'; isAnonymous: true }
/** Teachers sign in with a verified Google account; students use anonymous auth. */
export const isTeacherIdentity = (user: { uid: string; email: string | null; isAnonymous: boolean; emailVerified: boolean; providerData: Array<{ providerId: string }> }): user is { uid: string; email: string; isAnonymous: false; emailVerified: true; providerData: Array<{ providerId: string }> } =>
  !user.isAnonymous && user.emailVerified && Boolean(user.email) && user.providerData.some((provider) => provider.providerId === 'google.com')
