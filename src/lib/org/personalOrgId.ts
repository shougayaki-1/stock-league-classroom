/**
 * The personal organization id is fully deterministic from the uid, matching
 * the Firestore and RTDB rules' `personal_` + uid checks.
 */
export const personalOrgId = (uid: string): string => `personal_${uid}`
