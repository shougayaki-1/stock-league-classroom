import { GoogleAuthProvider, signInWithPopup, type Auth, type UserCredential } from 'firebase/auth'
export const signInTeacherWithGoogle = async (auth: Auth): Promise<UserCredential> => {
  const provider = new GoogleAuthProvider()
  provider.addScope('email')
  provider.setCustomParameters({ prompt: 'select_account' })
  return signInWithPopup(auth, provider)
}
