/**
 * Presentation-boundary lookup for runtime strings.
 * Unknown/missing values are deliberately fail-closed: the raw input is
 * never returned to the caller as display copy.
 */
export const safeLabel = <T extends Readonly<Record<string, string>>>(
  value: string | null | undefined,
  labels: T,
  fallback: string,
): string => {
  if (!value || !Object.prototype.hasOwnProperty.call(labels, value)) return fallback
  return labels[value as keyof T]
}
