export type ClassroomRole = 'teacher' | 'student'
export interface TeacherIdentity { uid: string; email: string; role: 'teacher' }
export interface StudentIdentity { uid: string; role: 'student'; isAnonymous: true }
/** Firebase represents email-link accounts with the email/password provider ID.
 * This app's Auth configuration must enable Email Link and Anonymous only; do
 * not enable Email/Password sign-in, which shares this provider ID. */
export const isTeacherIdentity = (user: { uid: string; email: string | null; isAnonymous: boolean; emailVerified: boolean; providerData: Array<{ providerId: string }> }): user is { uid: string; email: string; isAnonymous: false; emailVerified: true; providerData: Array<{ providerId: string }> } =>
  !user.isAnonymous && user.emailVerified && Boolean(user.email) && user.providerData.some((provider) => provider.providerId === 'password')
