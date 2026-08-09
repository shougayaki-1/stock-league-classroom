export interface ExtractedMaterialText { text: string; pageCount?: number }

const extractPdf = async (file: File): Promise<ExtractedMaterialText> => {
  const { getDocument } = await import('pdfjs-dist')
  const pdf = await getDocument({ data: await file.arrayBuffer() }).promise
  const pages = await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => {
    const content = await (await pdf.getPage(index + 1)).getTextContent()
    return content.items.map((item) => ('str' in item ? item.str : '')).join('')
  }))
  const text = pages.join('\n').trim()
  if (!text) throw new Error('このファイルからテキストを抽出できませんでした（スキャン画像のみのPDFの可能性があります）。')
  return { text, pageCount: pdf.numPages }
}

export const extractTextFromFile = (file: File): Promise<ExtractedMaterialText> => {
  if (file.type === 'application/pdf') return extractPdf(file)
  if (file.type === 'text/plain') return file.text().then((text) => ({ text }))
  return Promise.reject(new Error('対応していないファイル形式です（PDFまたはプレーンテキストのみ）。'))
}
