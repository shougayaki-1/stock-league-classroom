/** §23.5「十分大きな操作領域」— タップ可能領域の最小サイズ(px)。 */
export const MIN_TOUCH_TARGET = 44

/** disabledReason / errors のメッセージ要素の id を集めて aria-describedby 用の文字列にする。 */
export function messageIds(id: string, errors: string[], disabledReason?: string): string | undefined {
  const ids = [errors.length > 0 ? `${id}-error` : undefined, disabledReason ? `${id}-disabled-reason` : undefined]
    .filter((value): value is string => Boolean(value))
  return ids.length > 0 ? ids.join(' ') : undefined
}
