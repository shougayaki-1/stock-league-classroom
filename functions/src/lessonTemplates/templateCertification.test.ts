import { beforeEach, describe, expect, it } from 'vitest'
import {
  setTemplateCertification,
  type SetTemplateCertificationDeps,
  type SetTemplateCertificationInput,
} from './templateCertification'

describe('setTemplateCertification', () => {
  let store: Map<string, Record<string, unknown>>
  let writtenDocs: Map<string, { data: Record<string, unknown>; options?: { merge: boolean } }>
  let deps: SetTemplateCertificationDeps

  beforeEach(() => {
    store = new Map()
    writtenDocs = new Map()
    deps = {
      firestore: {
        runTransaction: async (fn) => {
          return fn({
            get: async (path: string) => {
              if (store.has(path)) {
                return { exists: true, data: store.get(path) }
              }
              return { exists: false }
            },
            set: (path: string, data: Record<string, unknown>, options?: { merge: boolean }) => {
              writtenDocs.set(path, { data, options })
              const existing = store.get(path) ?? {}
              if (options?.merge) {
                store.set(path, { ...existing, ...data })
              } else {
                store.set(path, data)
              }
            },
          })
        },
      },
      now: () => '2026-08-15T00:00:00.000Z',
    }

    // Seed default published template and version
    store.set('lessonTemplates/template-1', {
      title: 'テスト教材',
      visibility: 'COMMUNITY',
      currentPublishedVersionId: 'v1',
      orgId: 'org-1',
    })
    store.set('lessonTemplates/template-1/versions/v1', {
      templateId: 'template-1',
      schemaVersion: 1,
      immutable: true,
    })
  })

  const validInput: SetTemplateCertificationInput = {
    templateId: 'template-1',
    versionId: 'v1',
    level: 'VERIFIED',
    reason: '内容が優れているため認証します。',
    idempotencyKey: 'idemp-1',
    actorUid: 'operator-1',
  }

  it('successfully certifies COMMUNITY to VERIFIED and performs exactly 4 writes in transaction', async () => {
    const result = await setTemplateCertification(deps, validInput)

    expect(result).toEqual({
      visibility: 'VERIFIED',
      changed: true,
      deduplicated: false,
    })

    expect(writtenDocs.size).toBe(4)

    // 1. template doc updated
    const templateWrite = writtenDocs.get('lessonTemplates/template-1')
    expect(templateWrite?.data.visibility).toBe('VERIFIED')
    expect(templateWrite?.options?.merge).toBe(true)

    // 2. certification doc written
    const certWrite = writtenDocs.get('templateVersionCertifications/template-1__v1')
    expect(certWrite?.data).toEqual({
      templateId: 'template-1',
      versionId: 'v1',
      level: 'VERIFIED',
      grantedByUid: 'operator-1',
      grantedAt: '2026-08-15T00:00:00.000Z',
      revokedByUid: null,
      revokedAt: null,
      reason: '内容が優れているため認証します。',
      updatedAt: '2026-08-15T00:00:00.000Z',
    })

    // 3. certification event written
    const eventWrites = Array.from(writtenDocs.entries()).filter(([k]) =>
      k.startsWith('templateCertificationEvents/'),
    )
    expect(eventWrites.length).toBe(1)
    expect(eventWrites[0][1].data).toEqual({
      templateId: 'template-1',
      versionId: 'v1',
      previousVisibility: 'COMMUNITY',
      nextVisibility: 'VERIFIED',
      actorUid: 'operator-1',
      reason: '内容が優れているため認証します。',
      createdAt: '2026-08-15T00:00:00.000Z',
    })

    // 4. idempotency doc written
    const idempWrites = Array.from(writtenDocs.entries()).filter(([k]) =>
      k.startsWith('templateCertificationIdempotency/'),
    )
    expect(idempWrites.length).toBe(1)
    expect(idempWrites[0][1].data.result).toEqual({
      visibility: 'VERIFIED',
      changed: true,
    })

    // Never writes to version doc
    expect(writtenDocs.has('lessonTemplates/template-1/versions/v1')).toBe(false)
  })

  it('rejects certification when target versionId is not the currentPublishedVersionId', async () => {
    store.set('lessonTemplates/template-1/versions/v0', {
      templateId: 'template-1',
      immutable: true,
    })

    await expect(
      setTemplateCertification(deps, {
        ...validInput,
        versionId: 'v0',
      }),
    ).rejects.toThrow('Target version is not current published version')

    expect(writtenDocs.size).toBe(0)
  })

  it('rejects certification when template is not in marketplace (PRIVATE, LINK, ORGANIZATION)', async () => {
    store.set('lessonTemplates/template-1', {
      title: 'テスト教材',
      visibility: 'PRIVATE',
      currentPublishedVersionId: 'v1',
      orgId: 'org-1',
    })

    await expect(setTemplateCertification(deps, validInput)).rejects.toThrow(
      'Lesson template is not published to marketplace',
    )
    expect(writtenDocs.size).toBe(0)
  })

  it('correctly transitions VERIFIED -> OFFICIAL', async () => {
    store.set('lessonTemplates/template-1', {
      title: 'テスト教材',
      visibility: 'VERIFIED',
      currentPublishedVersionId: 'v1',
      orgId: 'org-1',
    })

    const result = await setTemplateCertification(deps, {
      ...validInput,
      level: 'OFFICIAL',
    })

    expect(result.visibility).toBe('OFFICIAL')
    expect(result.changed).toBe(true)

    const eventWrites = Array.from(writtenDocs.entries()).filter(([k]) =>
      k.startsWith('templateCertificationEvents/'),
    )
    expect(eventWrites[0][1].data.previousVisibility).toBe('VERIFIED')
    expect(eventWrites[0][1].data.nextVisibility).toBe('OFFICIAL')
  })

  it('correctly transitions VERIFIED/OFFICIAL -> COMMUNITY (revocation)', async () => {
    store.set('lessonTemplates/template-1', {
      title: 'テスト教材',
      visibility: 'OFFICIAL',
      currentPublishedVersionId: 'v1',
      orgId: 'org-1',
    })

    const result = await setTemplateCertification(deps, {
      ...validInput,
      level: 'COMMUNITY',
      reason: '公式から通常公開へ変更',
    })

    expect(result.visibility).toBe('COMMUNITY')
    expect(result.changed).toBe(true)

    const certWrite = writtenDocs.get('templateVersionCertifications/template-1__v1')
    expect(certWrite?.data).toEqual({
      templateId: 'template-1',
      versionId: 'v1',
      level: null,
      grantedByUid: null,
      grantedAt: null,
      revokedByUid: 'operator-1',
      revokedAt: '2026-08-15T00:00:00.000Z',
      reason: '公式から通常公開へ変更',
      updatedAt: '2026-08-15T00:00:00.000Z',
    })

    const eventWrites = Array.from(writtenDocs.entries()).filter(([k]) =>
      k.startsWith('templateCertificationEvents/'),
    )
    expect(eventWrites[0][1].data.previousVisibility).toBe('OFFICIAL')
    expect(eventWrites[0][1].data.nextVisibility).toBe('COMMUNITY')
  })

  it('returns changed: false and writes NO event when requested level equals current visibility', async () => {
    const result = await setTemplateCertification(deps, {
      ...validInput,
      level: 'COMMUNITY',
    })

    expect(result).toEqual({
      visibility: 'COMMUNITY',
      changed: false,
      deduplicated: false,
    })

    // Only idempotency doc should be written
    expect(writtenDocs.size).toBe(1)
    const idempWrites = Array.from(writtenDocs.entries()).filter(([k]) =>
      k.startsWith('templateCertificationIdempotency/'),
    )
    expect(idempWrites.length).toBe(1)
    expect(idempWrites[0][1].data.result).toEqual({
      visibility: 'COMMUNITY',
      changed: false,
    })

    const eventWrites = Array.from(writtenDocs.entries()).filter(([k]) =>
      k.startsWith('templateCertificationEvents/'),
    )
    expect(eventWrites.length).toBe(0)
  })

  it('returns deduplicated: true on replay with same payload, throws on same key different payload', async () => {
    const firstResult = await setTemplateCertification(deps, validInput)
    expect(firstResult.deduplicated).toBe(false)

    // Replay with exact same payload
    const replayResult = await setTemplateCertification(deps, validInput)
    expect(replayResult).toEqual({
      visibility: 'VERIFIED',
      changed: true,
      deduplicated: true,
    })

    // Replay under same key but different level
    await expect(
      setTemplateCertification(deps, {
        ...validInput,
        level: 'OFFICIAL',
      }),
    ).rejects.toThrow('Idempotency key payload mismatch')
  })

  it('validates reason string boundary (1 to 500 chars after trimming)', async () => {
    await expect(
      setTemplateCertification(deps, {
        ...validInput,
        reason: '   ',
      }),
    ).rejects.toThrow('reason must be between 1 and 500 characters')

    await expect(
      setTemplateCertification(deps, {
        ...validInput,
        reason: 'a'.repeat(501),
      }),
    ).rejects.toThrow('reason must be between 1 and 500 characters')
  })
})
