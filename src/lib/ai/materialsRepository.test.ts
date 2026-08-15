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
  it('uploads raw material with template-scoped path and persists storagePath in Firestore', async () => {
    vi.mocked(extractTextFromFile).mockResolvedValueOnce({ text: '抽出テキスト', pageCount: 3 })
    const { ref, uploadBytes } = await import('firebase/storage')
    const { addDoc } = await import('firebase/firestore')
    const result = await uploadMaterial({} as never, {} as never, 'org-1', 'template-1', new File(['raw'], 'material.pdf', { type: 'application/pdf' }))
    
    expect(ref).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/^orgs\/org-1\/materials\/template-1\/[a-f0-9-]+\/material\.pdf$/))
    expect(uploadBytes).toHaveBeenCalled()
    expect(addDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        fileName: 'material.pdf',
        text: '抽出テキスト',
        pageCount: 3,
        storagePath: expect.stringMatching(/^orgs\/org-1\/materials\/template-1\/[a-f0-9-]+\/material\.pdf$/),
      })
    )
    expect(result.text).toBe('抽出テキスト')
    expect(result.storagePath).toMatch(/^orgs\/org-1\/materials\/template-1\/[a-f0-9-]+\/material\.pdf$/)
  })
})

describe('listMaterials', () => {
  it('allows documents without storagePath for legacy compatibility', async () => {
    const { getDocs } = await import('firebase/firestore')
    const { listMaterials } = await import('./materialsRepository')
    vi.mocked(getDocs).mockResolvedValueOnce({
      docs: [
        {
          id: 'doc-legacy',
          data: () => ({ fileName: 'legacy.pdf', text: '旧データ' }),
        },
        {
          id: 'doc-new',
          data: () => ({ fileName: 'new.pdf', text: '新データ', storagePath: 'orgs/org-1/materials/t-1/s-1/new.pdf' }),
        },
      ],
    } as never)

    const list = await listMaterials({} as never, 'template-1')
    expect(list).toHaveLength(2)
    expect(list[0].storagePath).toBeUndefined()
    expect(list[1].storagePath).toBe('orgs/org-1/materials/t-1/s-1/new.pdf')
  })
})

