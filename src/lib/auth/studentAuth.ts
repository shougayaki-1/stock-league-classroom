import { signInAnonymously as firebaseSignInAnonymously, type Auth, type UserCredential } from 'firebase/auth'
export const signInStudentAnonymously = (auth: Auth): Promise<UserCredential> => firebaseSignInAnonymously(auth)
type SignInAnonymous = (auth: Auth) => Promise<UserCredential>
export const getOrCreateStudentUid = async (auth: Auth, signInAnonymous: SignInAnonymous = signInStudentAnonymously): Promise<string> => auth.currentUser?.uid ?? (await signInAnonymous(auth)).user.uid
