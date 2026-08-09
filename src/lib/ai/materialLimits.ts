/** §15.5 の暫定上限。運用開始後の利用実績に応じて見直す。 */
export const MAX_MATERIAL_FILE_SIZE_BYTES = 10 * 1024 * 1024
export const MAX_MATERIAL_PAGE_COUNT = 50

export type MaterialValidationResult = { valid: true } | { valid: false; error: string }

export const validateMaterialFile = ({ sizeBytes, pageCount }: { sizeBytes: number; pageCount?: number }): MaterialValidationResult => {
  if (sizeBytes > MAX_MATERIAL_FILE_SIZE_BYTES) return { valid: false, error: `ファイルサイズが上限（${MAX_MATERIAL_FILE_SIZE_BYTES / 1024 / 1024}MB）を超えています。` }
  if (pageCount !== undefined && pageCount > MAX_MATERIAL_PAGE_COUNT) return { valid: false, error: `ページ数が上限（${MAX_MATERIAL_PAGE_COUNT}ページ）を超えています。` }
  return { valid: true }
}
