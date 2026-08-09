import { describe, expect, it, vi } from 'vitest'
import { uploadMaterial } from './materialsRepository'
import { extractTextFromFile } from './extractPdfText'

vi.mock('./extractPdfText', () => ({ extractTextFromFile: vi.fn() }))
vi.mock('firebase/storage', () => ({ ref: vi.fn(), uploadBytes: vi.fn().mockResolvedValue({}) }))
vi.mock('firebase/firestore', () => ({ collection: vi.fn(() => ({})), addDoc: vi.fn().mockResolvedValue({ id: 'material-1' }), getDocs: vi.fn(), serverTimestamp: vi.fn() }))

describe('uploadMaterial', () => {
  it('rejects an oversized file before storage I/O', async () => {
    const { uploadBytes } = await import('firebase/storage')
    await expect(uploadMaterial({} as never, {} as never, 'org-1', 'template-1', new File([new Uint8Array(11 * 1024 * 1024)], 'big.pdf', { type: 'application/pdf' }))).rejects.toThrow('サイズ')
    expect(uploadBytes).not.toHaveBeenCalled()
  })
  it('uploads raw material but stores extracted text only in Firestore', async () => {
    vi.mocked(extractTextFromFile).mockResolvedValueOnce({ text: '抽出テキスト', pageCount: 3 })
    const { addDoc } = await import('firebase/firestore')
    const result = await uploadMaterial({} as never, {} as never, 'org-1', 'template-1', new File(['raw'], 'material.pdf', { type: 'application/pdf' }))
    expect(addDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ fileName: 'material.pdf', text: '抽出テキスト', pageCount: 3 }))
    expect(result.text).toBe('抽出テキスト')
  })
})
