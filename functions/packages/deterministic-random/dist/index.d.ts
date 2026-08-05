/**
 * FNV-1a 32-bit hash. It has no crypto API dependency, so it produces the
 * same result in the browser and Cloud Functions runtimes. It is not
 * cryptographic and, as a 32-bit hash, collisions are unavoidable; use it
 * only for deterministic replay seeds, never for identity or security.
 */
export declare const fnv1aHash: (input: string) => number;
/**
 * Small deterministic PRNG for reproducible lesson replay. It is not
 * cryptographically secure and must never be used for tokens or join codes.
 */
export declare const mulberry32: (seed: number) => (() => number);
/**
 * Encodes the ordered parts with both type and value, preventing delimiter and
 * string/number collisions before deriving a replay seed for mulberry32.
 */
export declare const deriveSeed: (parts: (string | number)[]) => number;
