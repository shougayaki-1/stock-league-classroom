import { describe, expect, it, vi } from 'vitest'
import { extractTextFromFile } from './extractPdfText'

vi.mock('pdfjs-dist', () => ({ getDocument: vi.fn(() => ({ promise: Promise.resolve({ numPages: 2, getPage: (page: number) => Promise.resolve({ getTextContent: () => Promise.resolve({ items: [{ str: `ページ${page}の内容` }] }) }) }) })) }))

describe('extractTextFromFile', () => {
  it('extracts text and page count from a PDF', async () => {
    const result = await extractTextFromFile(new File(['dummy'], 'material.pdf', { type: 'application/pdf' }))
    expect(result).toEqual({ text: 'ページ1の内容\nページ2の内容', pageCount: 2 })
  })
  it('reads a plain text file', async () => expect(await extractTextFromFile(new File(['内容'], 'material.txt', { type: 'text/plain' }))).toEqual({ text: '内容' }))
  it('rejects an unsupported type', async () => await expect(extractTextFromFile(new File(['x'], 'image.png', { type: 'image/png' }))).rejects.toThrow('対応していないファイル形式です'))
  it('rejects a PDF with no extractable text', async () => {
    const { getDocument } = await import('pdfjs-dist')
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve({ numPages: 1, getPage: () => Promise.resolve({ getTextContent: () => Promise.resolve({ items: [] }) }) }) } as never)
    await expect(extractTextFromFile(new File(['x'], 'empty.pdf', { type: 'application/pdf' }))).rejects.toThrow('このファイルからテキストを抽出できませんでした')
  })
})
