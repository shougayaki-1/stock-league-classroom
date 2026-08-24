export type CommonUserFacingErrorCode =
  | 'AUTHENTICATION'
  | 'PERMISSION'
  | 'NETWORK'
  | 'QUOTA'
  | 'UNKNOWN'

const errorCodeOf = (error: unknown): string =>
  typeof error === 'object' && error && 'code' in error
    ? String((error as { code: unknown }).code).toLowerCase()
    : ''

export const classifyCommonUserFacingError = (error: unknown): CommonUserFacingErrorCode => {
  const code = errorCodeOf(error)
  if (code.includes('unauthenticated')) return 'AUTHENTICATION'
  if (code.includes('permission')) return 'PERMISSION'
  if (code.includes('unavailable') || code.includes('network') || code.includes('deadline')) return 'NETWORK'
  if (code.includes('resource-exhausted') || code.includes('quota')) return 'QUOTA'
  return 'UNKNOWN'
}

const COMMON_ERROR_MESSAGES = {
  AUTHENTICATION: 'ログイン状態を確認して、もう一度お試しください。',
  PERMISSION: 'この操作を実行する権限がありません。必要な権限があるか確認してください。',
  NETWORK: '通信が不安定です。ネットワークを確認して、もう一度お試しください。',
  QUOTA: '現在、利用上限に達しています。時間をおいて、もう一度お試しください。',
} satisfies Record<Exclude<CommonUserFacingErrorCode, 'UNKNOWN'>, string>

export const describeUserFacingError = (error: unknown, fallback: string): string => {
  const code = classifyCommonUserFacingError(error)
  return code === 'UNKNOWN' ? fallback : COMMON_ERROR_MESSAGES[code]
}
