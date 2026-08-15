import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

let environment: RulesTestEnvironment
const token = { email_verified: true, firebase: { sign_in_provider: 'google.com' as const } }

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-stock-league-classroom',
    firestore: { rules: readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8') },
    storage: { rules: readFileSync(join(process.cwd(), 'storage.rules'), 'utf8') },
  })
})
beforeEach(async () => {
  await environment.clearFirestore()
  await environment.clearStorage()
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await db.doc('organizations/org-1').set({ materialsUploadEnabled: true })
    await db.doc('organizations/org-1/members/teacher-approved').set({ status: 'active' })
    await db.doc('organizations/org-1/members/teacher-revoked').set({ status: 'active' })
    await db.doc('organizations/org-1/members/teacher-absent').set({ status: 'active' })
    await db.doc('aiBetaAccess/teacher-approved').set({ status: 'APPROVED' })
    await db.doc('aiBetaAccess/teacher-revoked').set({ status: 'REVOKED' })
  })
})
afterAll(async () => environment.cleanup())

describe('storage.rules', () => {
  it('allows an approved teacher to upload to both material paths', async () => {
    const approved = environment.authenticatedContext('teacher-approved', token)
    await assertSucceeds(
      approved
        .storage()
        .ref('orgs/org-1/materials/mat-1/file.pdf')
        .put(new Uint8Array([1]), { contentType: 'application/pdf' })
        .then(() => undefined),
    )
    await assertSucceeds(
      approved
        .storage()
        .ref('orgs/org-1/materials/tmpl-1/mat-1/file.pdf')
        .put(new Uint8Array([1]), { contentType: 'application/pdf' })
        .then(() => undefined),
    )
  })

  it('denies upload when user is absent from aiBetaAccess or REVOKED', async () => {
    const revoked = environment.authenticatedContext('teacher-revoked', token)
    const absent = environment.authenticatedContext('teacher-absent', token)

    await assertFails(
      revoked
        .storage()
        .ref('orgs/org-1/materials/mat-1/file.pdf')
        .put(new Uint8Array([1]), { contentType: 'application/pdf' })
        .then(() => undefined),
    )
    await assertFails(
      absent
        .storage()
        .ref('orgs/org-1/materials/mat-1/file.pdf')
        .put(new Uint8Array([1]), { contentType: 'application/pdf' })
        .then(() => undefined),
    )
  })

  it('allows read for active members regardless of beta approval', async () => {
    const approved = environment.authenticatedContext('teacher-approved', token)
    await approved
      .storage()
      .ref('orgs/org-1/materials/mat-1/file.pdf')
      .put(new Uint8Array([1]), { contentType: 'application/pdf' })

    const revoked = environment.authenticatedContext('teacher-revoked', token)
    await assertSucceeds(
      revoked.storage().ref('orgs/org-1/materials/mat-1/file.pdf').getDownloadURL(),
    )
  })

  it('denies another organization and unauthenticated writes even if approved', async () => {
    const approved = environment.authenticatedContext('teacher-approved', token)
    await assertFails(
      approved
        .storage()
        .ref('orgs/org-2/materials/mat-1/file.pdf')
        .put(new Uint8Array([1]), { contentType: 'application/pdf' })
        .then(() => undefined),
    )
    await assertFails(
      environment
        .unauthenticatedContext()
        .storage()
        .ref('orgs/org-1/materials/mat-1/file.pdf')
        .put(new Uint8Array([1]), { contentType: 'application/pdf' })
        .then(() => undefined),
    )
  })

  it('denies file size > 10MiB or unsupported contentType', async () => {
    const approved = environment.authenticatedContext('teacher-approved', token)
    const largeBuffer = new Uint8Array(10 * 1024 * 1024 + 1)
    await assertFails(
      approved
        .storage()
        .ref('orgs/org-1/materials/mat-1/file.pdf')
        .put(largeBuffer, { contentType: 'application/pdf' })
        .then(() => undefined),
    )
    await assertFails(
      approved
        .storage()
        .ref('orgs/org-1/materials/mat-1/file.exe')
        .put(new Uint8Array([1]), { contentType: 'application/x-msdownload' })
        .then(() => undefined),
    )
  })

  it('denies client access to staging path', async () => {
    const approved = environment.authenticatedContext('teacher-approved', token)
    await assertFails(
      approved
        .storage()
        .ref('templateMoveStaging/op-1/file.pdf')
        .put(new Uint8Array([1]), { contentType: 'application/pdf' })
        .then(() => undefined),
    )
    await assertFails(
      approved.storage().ref('templateMoveStaging/op-1/file.pdf').getDownloadURL(),
    )
  })
})
