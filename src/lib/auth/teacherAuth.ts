import { isSignInWithEmailLink, sendSignInLinkToEmail, signInWithEmailLink, type Auth, type UserCredential } from 'firebase/auth'
const PENDING_EMAIL_KEY = 'teacherPendingEmail'
export const storePendingEmail = (email: string): void => window.localStorage.setItem(PENDING_EMAIL_KEY, email)
export const readPendingEmail = (): string | null => window.localStorage.getItem(PENDING_EMAIL_KEY)
export const clearPendingEmail = (): void => window.localStorage.removeItem(PENDING_EMAIL_KEY)
export const sendTeacherSignInLink = async (auth: Auth, email: string, redirectUrl: string): Promise<void> => { await sendSignInLinkToEmail(auth, email, { url: redirectUrl, handleCodeInApp: true }); storePendingEmail(email) }
export const isTeacherSignInLink = (auth: Auth, url: string): boolean => isSignInWithEmailLink(auth, url)
export const completeTeacherSignIn = async (auth: Auth, email: string, url: string): Promise<UserCredential> => { const result = await signInWithEmailLink(auth, email, url); clearPendingEmail(); return result }
