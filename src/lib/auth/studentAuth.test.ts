import { describe, expect, it, vi } from 'vitest'
import { getOrCreateStudentUid } from './studentAuth'
describe('getOrCreateStudentUid', () => { it('reuses an authenticated user', async () => { const signIn = vi.fn(); expect(await getOrCreateStudentUid({ currentUser: { uid: 'existing' } } as never, signIn)).toBe('existing'); expect(signIn).not.toHaveBeenCalled() }); it('creates anonymous user when needed', async () => { const signIn = vi.fn().mockResolvedValue({ user: { uid: 'new' } }); expect(await getOrCreateStudentUid({ currentUser: null } as never, signIn)).toBe('new') }) })
