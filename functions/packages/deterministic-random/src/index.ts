/**
 * FNV-1a 32-bit hash. It has no crypto API dependency, so it produces the
 * same result in the browser and Cloud Functions runtimes. It is not
 * cryptographic and, as a 32-bit hash, collisions are unavoidable; use it
 * only for deterministic replay seeds within the fixed schema components
 * defined by the specification, never for identity, unique IDs, or security.
 */
export const fnv1aHash = (input: string): number => {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * Small deterministic PRNG for reproducible lesson replay. It is not
 * cryptographically secure and must never be used for tokens or join codes.
 */
export const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Derives the canonical colon-delimited replay seed format defined by
 * resolution D. It is for fixed-schema internal components only; never use it
 * for identity, unique IDs, or security-sensitive inputs.
 */
export const deriveSeed = (parts: (string | number)[]): number => fnv1aHash(parts.join(':'))
