import { describe, expect, it } from 'vitest'
import {
  classifyCommonUserFacingError,
  describeUserFacingError,
} from './userFacingError'

describe('common user-facing errors', () => {
  it('classifies stable error codes without reading the backend message', () => {
    expect(classifyCommonUserFacingError({ code: 'functions/unauthenticated' })).toBe('AUTHENTICATION')
    expect(classifyCommonUserFacingError({ code: 'permission-denied' })).toBe('PERMISSION')
    expect(classifyCommonUserFacingError({ code: 'functions/unavailable' })).toBe('NETWORK')
    expect(classifyCommonUserFacingError({ code: 'deadline-exceeded' })).toBe('NETWORK')
    expect(classifyCommonUserFacingError({ code: 'resource-exhausted' })).toBe('QUOTA')
    expect(classifyCommonUserFacingError(new Error('Revision mismatch'))).toBe('UNKNOWN')
  })

  it('returns action-oriented generic copy for known common categories', () => {
    expect(describeUserFacingError({ code: 'functions/unauthenticated' }, '失敗しました。')).toContain('ログイン状態')
    expect(describeUserFacingError({ code: 'permission-denied' }, '失敗しました。')).toContain('権限')
    expect(describeUserFacingError({ code: 'unavailable' }, '失敗しました。')).toContain('通信')
    expect(describeUserFacingError({ code: 'resource-exhausted' }, '失敗しました。')).toContain('利用上限')
  })

  it('uses only the caller fallback for unknown errors and never echoes Error.message', () => {
    const raw = 'Revision mismatch: internal revision=42'
    const result = describeUserFacingError(new Error(raw), '保存できませんでした。もう一度お試しください。')

    expect(result).toBe('保存できませんでした。もう一度お試しください。')
    expect(result).not.toContain(raw)
    expect(result).not.toContain('Revision mismatch')
  })
})
