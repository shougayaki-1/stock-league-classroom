import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { exportPersonalDataCallable, isReauthFresh } from './onCall'
import { exportPersonalDataWithAdminSdk } from './exportPersonalData'

const orgDocGetMock = vi.fn()

vi.mock('./exportPersonalData', () => ({ exportPersonalDataWithAdminSdk: vi.fn() }))
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ doc: () => ({ get: orgDocGetMock }) }),
}))

const NOW_MS = Date.parse('2026-08-07T12:00:00.000Z')
const NOW_SECONDS = NOW_MS / 1000

const makeRequest = (overrides: {
  uid?: string
  authTime?: number
  data?: unknown
  noAuth?: boolean
} = {}): CallableRequest<unknown> => {
  if (overrides.noAuth) {
    return { auth: undefined, data: overrides.data ?? {}, rawRequest: {} } as unknown as CallableRequest<unknown>
  }
  return {
    auth: {
      uid: overrides.uid ?? 'teacher-a',
      token: {
        email_verified: true,
        firebase: { sign_in_provider: 'google.com' },
        auth_time: overrides.authTime ?? NOW_SECONDS,
      },
    },
    data: overrides.data ?? {},
    rawRequest: {},
  } as unknown as CallableRequest<unknown>
}

const makeOrgSnap = (exists: boolean, ownerUid?: string) => ({
  exists,
  get: (field: string) => (field === 'ownerUid' ? ownerUid : undefined),
})

describe('isReauthFresh', () => {
  it('accepts an auth_time exactly at the 10 minute boundary', () => {
    expect(isReauthFresh(NOW_SECONDS - 600, NOW_MS)).toBe(true)
  })
  it('rejects an auth_time older than 10 minutes', () => {
    expect(isReauthFresh(NOW_SECONDS - 601, NOW_MS)).toBe(false)
  })
  it('rejects a missing auth_time', () => {
    expect(isReauthFresh(undefined, NOW_MS)).toBe(false)
  })
  it('accepts an auth_time exactly now', () => {
    expect(isReauthFresh(NOW_SECONDS, NOW_MS)).toBe(true)
  })
})

describe('exportPersonalDataCallable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(NOW_MS)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects an anonymous (unauthenticated) caller, never touching Firestore', async () => {
    await expect(exportPersonalDataCallable.run(makeRequest({ noAuth: true }))).rejects.toMatchObject({ code: 'unauthenticated' })
    expect(orgDocGetMock).not.toHaveBeenCalled()
    expect(exportPersonalDataWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects a stale auth_time (reauthentication required) before ever reading the organization', async () => {
    const request = makeRequest({ authTime: NOW_SECONDS - 601 })
    await expect(exportPersonalDataCallable.run(request)).rejects.toMatchObject({ code: 'failed-precondition' })
    expect(orgDocGetMock).not.toHaveBeenCalled()
    expect(exportPersonalDataWithAdminSdk).not.toHaveBeenCalled()
  })

  it('proceeds past the reauth check for a fresh auth_time', async () => {
    orgDocGetMock.mockResolvedValue(makeOrgSnap(true, 'teacher-a'))
    vi.mocked(exportPersonalDataWithAdminSdk).mockResolvedValue({ uid: 'teacher-a' } as never)
    const request = makeRequest({ authTime: NOW_SECONDS - 599 })
    await expect(exportPersonalDataCallable.run(request)).resolves.toBeDefined()
    expect(exportPersonalDataWithAdminSdk).toHaveBeenCalled()
  })

  it('never reads orgId from request.data, always deriving personal_<uid> server-side', async () => {
    orgDocGetMock.mockResolvedValue(makeOrgSnap(true, 'teacher-a'))
    vi.mocked(exportPersonalDataWithAdminSdk).mockResolvedValue({ uid: 'teacher-a' } as never)
    const request = makeRequest({ data: { orgId: 'attacker-supplied-org' } })
    await exportPersonalDataCallable.run(request)
    expect(exportPersonalDataWithAdminSdk).toHaveBeenCalledWith('teacher-a', 'personal_teacher-a')
  })

  it('rejects when the organization document does not exist', async () => {
    orgDocGetMock.mockResolvedValue(makeOrgSnap(false))
    await expect(exportPersonalDataCallable.run(makeRequest())).rejects.toMatchObject({ code: 'permission-denied' })
    expect(exportPersonalDataWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects another uid (ownerUid mismatch) even though orgId always resolves to their own personal org', async () => {
    // Simulates a tampered/corrupted org record where ownerUid no longer
    // matches the caller — the independent Admin SDK ownership check must
    // catch this even though personalOrgId(uid) always derives "their own" id.
    orgDocGetMock.mockResolvedValue(makeOrgSnap(true, 'someone-else'))
    await expect(exportPersonalDataCallable.run(makeRequest({ uid: 'teacher-a' }))).rejects.toMatchObject({ code: 'permission-denied' })
    expect(exportPersonalDataWithAdminSdk).not.toHaveBeenCalled()
  })

  it('rejects an ownerUid mismatch even when the caller is an active member by some other record', async () => {
    // Ownership (organizations/{orgId}.ownerUid), not membership status, is
    // the actual gate for this Callable. A caller must not be able to bypass
    // the ownership check by pointing to any membership doc showing active.
    orgDocGetMock.mockResolvedValue(makeOrgSnap(true, 'someone-else'))
    await expect(exportPersonalDataCallable.run(makeRequest({ uid: 'teacher-a' }))).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('allows self-export even when the caller\'s membership is suspended — the export path never gates on membership status', async () => {
    // This Callable must never call requireActiveOrgMember or otherwise
    // check membership status: ownerUid match alone authorizes self-export,
    // per this task's explicit carve-out for the owner's own privacy right.
    orgDocGetMock.mockResolvedValue(makeOrgSnap(true, 'teacher-a'))
    vi.mocked(exportPersonalDataWithAdminSdk).mockResolvedValue({
      uid: 'teacher-a',
      membership: { uid: 'teacher-a', role: 'owner', status: 'suspended' },
    } as never)
    const result = await exportPersonalDataCallable.run(makeRequest({ uid: 'teacher-a' }))
    expect(result).toMatchObject({ membership: { status: 'suspended' } })
    expect(exportPersonalDataWithAdminSdk).toHaveBeenCalledWith('teacher-a', 'personal_teacher-a')
  })

  it('returns the complete JSON export shape end-to-end for the caller\'s own personal org', async () => {
    orgDocGetMock.mockResolvedValue(makeOrgSnap(true, 'teacher-a'))
    const fullExport = {
      exportedAt: '2026-08-07T12:00:00.000Z',
      uid: 'teacher-a',
      orgId: 'personal_teacher-a',
      user: { id: 'teacher-a', displayName: 'Teacher A' },
      organization: { id: 'personal_teacher-a', type: 'personal', ownerUid: 'teacher-a' },
      membership: { uid: 'teacher-a', role: 'owner', status: 'active' },
      orgAccessMirror: { role: 'owner', status: 'active', membershipVersion: 1 },
      orgAccessMeta: { membershipVersion: 1, syncState: 'SYNCED' },
      lessonTemplates: [{ id: 't1', orgId: 'personal_teacher-a', createdByUid: 'teacher-a', draft: {}, versions: [{ id: 'v1', templateId: 't1' }] }],
      lessonRuns: [{ id: 'r1', orgId: 'personal_teacher-a', templateId: 't1', events: [{ id: 'e1', sequence: 0 }], checkpoints: [{ id: 'c1', sequence: 0 }] }],
    }
    vi.mocked(exportPersonalDataWithAdminSdk).mockResolvedValue(fullExport as never)

    const result = await exportPersonalDataCallable.run(makeRequest({ uid: 'teacher-a' }))

    expect(result).toEqual(fullExport)
  })
})
