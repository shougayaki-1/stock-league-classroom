import { describe, expect, it, vi } from 'vitest'
import { isValidPublishLessonVersionInput } from './onCall'

vi.mock('../organizations/authorization', () => ({ requireActiveOrgMember: vi.fn() }))
vi.mock('./publishLessonVersion', () => ({ publishLessonVersionWithAdminSdk: vi.fn() }))
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ doc: () => ({ get: vi.fn() }) }),
}))

describe('isValidPublishLessonVersionInput', () => {
  it('accepts a well-formed request payload', () => {
    expect(isValidPublishLessonVersionInput({ templateId: 't1', idempotencyKey: 'key-1' })).toBe(true)
    expect(isValidPublishLessonVersionInput({ templateId: 't1', changeSummary: '要約', idempotencyKey: 'key-1' })).toBe(true)
  })

  it('rejects missing or malformed fields', () => {
    expect(isValidPublishLessonVersionInput({})).toBe(false)
    expect(isValidPublishLessonVersionInput({ templateId: 't1' })).toBe(false)
    expect(isValidPublishLessonVersionInput({ idempotencyKey: 'key-1' })).toBe(false)
    expect(isValidPublishLessonVersionInput({ templateId: 1, idempotencyKey: 'key-1' })).toBe(false)
    expect(isValidPublishLessonVersionInput({ templateId: 't1', changeSummary: 5, idempotencyKey: 'key-1' })).toBe(false)
    expect(isValidPublishLessonVersionInput(null)).toBe(false)
  })
})
