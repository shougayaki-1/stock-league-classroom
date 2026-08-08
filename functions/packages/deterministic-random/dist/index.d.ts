/**
 * FNV-1a 32-bit hash. It has no crypto API dependency, so it produces the
 * same result in the browser and Cloud Functions runtimes. It is not
 * cryptographic and, as a 32-bit hash, collisions are unavoidable; use it
 * only for deterministic replay seeds within the fixed schema components
 * defined by the specification, never for identity, unique IDs, or security.
 */
export declare const fnv1aHash: (input: string) => number;
/**
 * Small deterministic PRNG for reproducible lesson replay. It is not
 * cryptographically secure and must never be used for tokens or join codes.
 */
export declare const mulberry32: (seed: number) => (() => number);
/**
 * Derives the canonical colon-delimited replay seed format defined by
 * resolution D. It is for fixed-schema internal components only; never use it
 * for identity, unique IDs, or security-sensitive inputs.
 */
export declare const deriveSeed: (parts: (string | number)[]) => number;
