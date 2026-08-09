import { describe, expect, it } from 'vitest'
import { MAX_MATERIAL_FILE_SIZE_BYTES, MAX_MATERIAL_PAGE_COUNT, validateMaterialFile } from './materialLimits'

describe('validateMaterialFile', () => {
  it('accepts a file within both limits', () => expect(validateMaterialFile({ sizeBytes: 1_000_000, pageCount: 10 })).toEqual({ valid: true }))
  it('rejects a file exceeding the size limit', () => {
    const result = validateMaterialFile({ sizeBytes: MAX_MATERIAL_FILE_SIZE_BYTES + 1, pageCount: 1 })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error).toContain('サイズ')
  })
  it('rejects a file exceeding the page-count limit', () => {
    const result = validateMaterialFile({ sizeBytes: 1000, pageCount: MAX_MATERIAL_PAGE_COUNT + 1 })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error).toContain('ページ数')
  })
  it('accepts plain text without a page count', () => expect(validateMaterialFile({ sizeBytes: 1000 })).toEqual({ valid: true }))
})
