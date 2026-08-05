import { createHash } from 'node:crypto'

const rejectNonJson = (description: string): never => {
  throw new TypeError(`Cannot canonicalize non-JSON value: ${description}`)
}

const isPlainObject = (value: object): value is Record<string, unknown> => {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const canonicalize = (value: unknown, ancestors: Set<object>): string => {
  if (value === null) return 'null'

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'string':
      return JSON.stringify(value)
    case 'number':
      if (!Number.isFinite(value)) rejectNonJson('non-finite number')
      return JSON.stringify(value)
    case 'undefined':
      return rejectNonJson('undefined')
    case 'bigint':
      return rejectNonJson('bigint')
    case 'function':
      return rejectNonJson('function')
    case 'symbol':
      return rejectNonJson('symbol')
    case 'object':
      break
    default:
      return rejectNonJson(typeof value)
  }

  if (ancestors.has(value)) {
    throw new TypeError('Cannot canonicalize cyclic JSON value')
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return rejectNonJson('symbol property')
  }

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const ownNames = Object.getOwnPropertyNames(value)
      if (ownNames.length !== value.length + 1 || !ownNames.includes('length')) {
        return rejectNonJson('sparse array or array with extra properties')
      }

      const items: string[] = []
      for (let index = 0; index < value.length; index += 1) {
        const key = String(index)
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
          return rejectNonJson('sparse array or accessor array item')
        }
        items.push(canonicalize(descriptor.value, ancestors))
      }
      return `[${items.join(',')}]`
    }

    if (!isPlainObject(value)) return rejectNonJson('non-plain object')

    const entries = Object.getOwnPropertyNames(value)
      .map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
          return rejectNonJson('non-enumerable or accessor property')
        }
        return [key, descriptor.value] as const
      })
      .sort(([left], [right]) => left.localeCompare(right))

    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalize(entryValue, ancestors)}`).join(',')}}`
  } finally {
    ancestors.delete(value)
  }
}

/**
 * Serializes JSON data with recursively sorted object keys. Values that JSON
 * would otherwise omit or coerce are rejected so distinct requests cannot
 * share an idempotency digest accidentally.
 */
export const canonicalJson = (value: unknown): string => canonicalize(value, new Set())

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

export const requestDigest = (value: unknown): string => sha256(canonicalJson(value))

/** A Firestore-safe fixed-width id that keeps scope/key boundaries unambiguous. */
export const idempotencyDocumentId = (scope: string, key: string): string => requestDigest([scope, key])
