import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { exchangeDisplaySessionToken, generateDisplaySessionToken, issueDisplaySessionToken } from './displaySession'

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

const makeFakeFirestore = () => {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    runTransaction: async <T>(fn: (tx: {
      get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      set: (path: string, data: Record<string, unknown>) => void
    }) => Promise<T>) => {
      let written = false
      return fn({
        get: async (path: string) => {
          if (written) throw new Error('Firestore transactions require all reads to be executed before all writes.')
          return { exists: docs.has(path), data: () => docs.get(path) }
        },
        set: (path: string, data: Record<string, unknown>) => { written = true; docs.set(path, data) },
      })
    },
  }
}

describe('generateDisplaySessionToken', () => {
  it('generates a long, high-entropy token using crypto.randomBytes (never a fixed/predictable value)', () => {
    const a = generateDisplaySessionToken()
    const b = generateDisplaySessionToken()
    expect(a).not.toBe(b)
    // 32 bytes of randomness hex-encoded == 64 characters; long enough that
    // a session URL embedding it cannot be brute-forced or guessed the way
    // a 6-character join code (meant to be read off a projector) can.
    expect(a.length).toBeGreaterThanOrEqual(48)
    expect(/^[0-9a-f]+$/.test(a)).toBe(true)
  })
})

describe('issueDisplaySessionToken', () => {
  it('returns the plaintext token once and stores only its hash, expiry, and unused state', async () => {
    const fake = makeFakeFirestore()
    const result = await issueDisplaySessionToken({
      firestore: fake as never, generateToken: () => 'PLAINTEXT-DISPLAY-TOKEN', hashToken: sha256,
      now: () => 'fixed-now', nowMillis: () => 1_000_000, expiresInMillis: 7_200_000,
    }, { lessonRunId: 'run-1', orgId: 'org-1' })

    expect(result.token).toBe('PLAINTEXT-DISPLAY-TOKEN')
    const stored = fake.docs.get(`lessonRuns/run-1/displaySessions/${sha256('PLAINTEXT-DISPLAY-TOKEN')}`) as Record<string, unknown>
    expect(stored).toBeDefined()
    expect(stored.lessonRunId).toBe('run-1')
    expect(stored.orgId).toBe('org-1')
    expect(stored.status).toBe('ACTIVE')
    expect(stored.exchangedAt).toBeNull()
    expect(stored.expiresAtMillis).toBe(8_200_000)
    // Plaintext must never be persisted anywhere (same discipline as recovery.ts's issueRecoveryCode).
    for (const doc of fake.docs.values()) {
      expect(JSON.stringify(doc)).not.toContain('PLAINTEXT-DISPLAY-TOKEN')
    }
  })

  it('defaults expiresInMillis to a documented tentative value when not supplied', async () => {
    const fake = makeFakeFirestore()
    const result = await issueDisplaySessionToken({
      firestore: fake as never, generateToken: () => 'TOKEN', hashToken: sha256,
      now: () => 'fixed-now', nowMillis: () => 0,
    }, { lessonRunId: 'run-1', orgId: 'org-1' })
    const stored = fake.docs.get(`lessonRuns/run-1/displaySessions/${sha256('TOKEN')}`) as Record<string, unknown>
    expect(result.token).toBe('TOKEN')
    expect(stored.expiresAtMillis).toBeGreaterThan(0)
  })
})

describe('exchangeDisplaySessionToken', () => {
  const seedSession = (docs: Map<string, Record<string, unknown>>, overrides: Record<string, unknown> = {}) => {
    docs.set(`lessonRuns/run-1/displaySessions/${sha256('VALID-TOKEN')}`, {
      lessonRunId: 'run-1', orgId: 'org-1', status: 'ACTIVE',
      expiresAtMillis: 2_000_000, exchangedAt: null, issuedAt: 'issued',
      ...overrides,
    })
  }

  it('exchanges a valid, unused, unexpired token exactly once and marks it USED', async () => {
    const fake = makeFakeFirestore()
    seedSession(fake.docs)
    const result = await exchangeDisplaySessionToken({
      firestore: fake as never, hashToken: sha256, now: () => 'fixed-now', nowMillis: () => 1_500_000,
    }, { lessonRunId: 'run-1', token: 'VALID-TOKEN' })

    expect(result.lessonRunId).toBe('run-1')
    expect(result.uid).toContain('run-1')
    expect(result.claims).toEqual({ displayRunId: 'run-1' })
    const stored = fake.docs.get(`lessonRuns/run-1/displaySessions/${sha256('VALID-TOKEN')}`) as Record<string, unknown>
    expect(stored.status).toBe('USED')
  })

  it('rejects a second exchange attempt of the same token (one-time use)', async () => {
    const fake = makeFakeFirestore()
    seedSession(fake.docs, { status: 'USED', exchangedAt: 'already-used' })
    await expect(exchangeDisplaySessionToken({
      firestore: fake as never, hashToken: sha256, now: () => 'fixed-now', nowMillis: () => 1_500_000,
    }, { lessonRunId: 'run-1', token: 'VALID-TOKEN' })).rejects.toThrow('Display session token has already been used')
  })

  it('rejects an expired token', async () => {
    const fake = makeFakeFirestore()
    seedSession(fake.docs, { expiresAtMillis: 100 })
    await expect(exchangeDisplaySessionToken({
      firestore: fake as never, hashToken: sha256, now: () => 'fixed-now', nowMillis: () => 1_500_000,
    }, { lessonRunId: 'run-1', token: 'VALID-TOKEN' })).rejects.toThrow('Display session token has expired')
  })

  it('rejects an unknown token', async () => {
    const fake = makeFakeFirestore()
    await expect(exchangeDisplaySessionToken({
      firestore: fake as never, hashToken: sha256, now: () => 'fixed-now', nowMillis: () => 1_500_000,
    }, { lessonRunId: 'run-1', token: 'BOGUS' })).rejects.toThrow('Display session token not found')
  })

  it('rejects a token presented for a different lessonRunId than it was issued for', async () => {
    const fake = makeFakeFirestore()
    seedSession(fake.docs)
    await expect(exchangeDisplaySessionToken({
      firestore: fake as never, hashToken: sha256, now: () => 'fixed-now', nowMillis: () => 1_500_000,
    }, { lessonRunId: 'run-2', token: 'VALID-TOKEN' })).rejects.toThrow('Display session token not found')
  })
})
