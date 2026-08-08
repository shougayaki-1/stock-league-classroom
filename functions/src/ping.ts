import { onCall } from 'firebase-functions/v2/https'

export const pingPayload = (): { ok: true } => ({ ok: true })

export const ping = onCall({ region: 'asia-northeast1' }, () => pingPayload())
