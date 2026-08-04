import { getRedirectResult, GoogleAuthProvider, signInWithRedirect, type Auth, type UserCredential } from 'firebase/auth'

/**
 * Starts Google sign-in with a full-page redirect instead of opening a popup.
 * This is more reliable on iPad Safari and other browsers that block popups.
 */
export const signInTeacherWithGoogle = async (auth: Auth): Promise<never> => {
  const provider = new GoogleAuthProvider()
  provider.addScope('email')
  provider.setCustomParameters({ prompt: 'select_account' })
  return signInWithRedirect(auth, provider)
}

/** Reads the result after Google redirects back to the app. */
export const getTeacherGoogleRedirectResult = (auth: Auth): Promise<UserCredential | null> =>
  getRedirectResult(auth)
