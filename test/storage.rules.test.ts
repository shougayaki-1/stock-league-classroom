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
  await environment.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc('organizations/org-1').set({ materialsUploadEnabled: true })
    await context.firestore().doc('organizations/org-1/members/teacher-a').set({ status: 'active' })
  })
})
afterAll(async () => environment.cleanup())

describe('storage.rules', () => {
  it('allows an active member to upload to their organization', async () => {
    await assertSucceeds(environment.authenticatedContext('teacher-a', token).storage().ref('orgs/org-1/materials/mat-1/file.pdf').put(new Uint8Array([1]), { contentType: 'application/pdf' }).then(() => undefined))
  })
  it('allows an active member to upload to template-scoped material path', async () => {
    await assertSucceeds(environment.authenticatedContext('teacher-a', token).storage().ref('orgs/org-1/materials/tmpl-1/mat-1/file.pdf').put(new Uint8Array([1]), { contentType: 'application/pdf' }).then(() => undefined))
  })
  it('denies another organization and unauthenticated writes', async () => {
    await assertFails(environment.authenticatedContext('teacher-a', token).storage().ref('orgs/org-2/materials/mat-1/file.pdf').put(new Uint8Array([1]), { contentType: 'application/pdf' }).then(() => undefined))
    await assertFails(environment.authenticatedContext('teacher-a', token).storage().ref('orgs/org-2/materials/tmpl-1/mat-1/file.pdf').put(new Uint8Array([1]), { contentType: 'application/pdf' }).then(() => undefined))
    await assertFails(environment.unauthenticatedContext().storage().ref('orgs/org-1/materials/mat-1/file.pdf').put(new Uint8Array([1]), { contentType: 'application/pdf' }).then(() => undefined))
    await assertFails(environment.unauthenticatedContext().storage().ref('orgs/org-1/materials/tmpl-1/mat-1/file.pdf').put(new Uint8Array([1]), { contentType: 'application/pdf' }).then(() => undefined))
  })
  it('denies client access to staging path', async () => {
    await assertFails(environment.authenticatedContext('teacher-a', token).storage().ref('templateMoveStaging/op-1/file.pdf').put(new Uint8Array([1]), { contentType: 'application/pdf' }).then(() => undefined))
    await assertFails(environment.authenticatedContext('teacher-a', token).storage().ref('templateMoveStaging/op-1/file.pdf').getDownloadURL())
  })
})
