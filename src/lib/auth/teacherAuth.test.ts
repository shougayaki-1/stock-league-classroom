import { beforeEach, describe, expect, it } from 'vitest'
import { clearPendingEmail, readPendingEmail, storePendingEmail } from './teacherAuth'
describe('teacher pending email', () => { beforeEach(() => { clearPendingEmail() }); it('round-trips a saved email', () => { storePendingEmail('teacher@example.com'); expect(readPendingEmail()).toBe('teacher@example.com') }); it('returns null when absent', () => expect(readPendingEmail()).toBeNull()) })
