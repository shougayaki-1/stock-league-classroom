import { describe, expect, it, vi, afterEach } from 'vitest'
import { downloadAsJsonFile } from './orgStudentDataExport'

describe('downloadAsJsonFile', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('creates an object URL for a JSON blob and triggers a click via a temporary anchor', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:mock-url')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const clickSpy = vi.fn()
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag)
      if (tag === 'a') el.click = clickSpy
      return el
    })

    downloadAsJsonFile({ hello: 'world' }, 'export.json')

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(clickSpy).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })
})
