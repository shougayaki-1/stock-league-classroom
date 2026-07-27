import { describe, expect, it } from 'vitest'
import { initializeErrorReporting, scrubText } from './errorReporting'

describe('scrubText', () => {
  it('removes join codes so a report cannot unlock a classroom', () => {
    expect(scrubText('resolveJoinCode failed for K7M2PQ')).toBe('resolveJoinCode failed for [code]')
  })

  it('removes email addresses belonging to teachers', () => {
    expect(scrubText('permission denied for teacher@example.school.jp')).toBe('permission denied for [email]')
  })

  it('leaves ordinary diagnostic text intact', () => {
    const message = 'Missing or insufficient permissions at liveMarkets/prices'
    expect(scrubText(message)).toBe(message)
  })
})

describe('initializeErrorReporting', () => {
  it('stays off without a DSN so local runs send nothing', () => {
    expect(initializeErrorReporting({})).toBe(false)
  })

  it('stays off against the emulators even when a DSN is present', () => {
    expect(initializeErrorReporting({ VITE_SENTRY_DSN: 'https://key@example.ingest.sentry.io/1', VITE_USE_EMULATORS: 'true' })).toBe(false)
  })
})
