import { describe, expect, it } from 'vitest'
import { describeError } from './describeError'

describe('describeError', () => {
  it('explains a permission failure in classroom terms', () => {
    expect(describeError({ code: 'permission-denied' }, '失敗しました。')).toContain('権限がありません')
    expect(describeError({ code: 'PERMISSION_DENIED' }, '失敗しました。')).toContain('権限がありません')
  })
  it('explains a connectivity failure', () => {
    expect(describeError({ code: 'unavailable' }, '失敗しました。')).toContain('通信')
  })
  it('explains a quota failure', () => {
    expect(describeError({ code: 'resource-exhausted' }, '失敗しました。')).toContain('上限')
  })
  it('falls back to the caller message for anything else', () => {
    expect(describeError(new Error('boom'), '失敗しました。')).toBe('失敗しました。')
    expect(describeError(undefined, '失敗しました。')).toBe('失敗しました。')
  })
})
