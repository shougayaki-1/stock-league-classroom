import { reportError } from './errorReporting'

const codeOf = (error: unknown): string =>
  typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code).toLowerCase() : ''

/**
 * A teacher standing in front of a class needs to know which of three things
 * went wrong — their permission, the network, or the free-tier ceiling —
 * because the response to each is different.
 */
export const describeError = (error: unknown, fallback: string): string => {
  const code = codeOf(error)
  if (code.includes('permission') || code.includes('unauthenticated')) return 'この操作の権限がありません。教師アカウントでログインしているか、この市場の作成者であるかを確認してください。'
  if (code.includes('unavailable') || code.includes('network') || code.includes('deadline')) return '通信が不安定です。ネットワークを確認して、もう一度お試しください。'
  if (code.includes('resource-exhausted') || code.includes('quota')) return '同時利用が上限に達しています。しばらく待つと復帰します。'
  return fallback
}

/** Report first, then explain: a swallowed error is one we can never fix. */
export const handleFailure = (error: unknown, fallback: string): string => {
  reportError(error)
  return describeError(error, fallback)
}
