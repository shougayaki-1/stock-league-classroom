import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Firestore } from 'firebase/firestore'
import { createLessonTemplate, saveDraft } from './repository'
import type { LessonContent } from './types'

const draft: LessonContent = { schemaVersion: 1, title: '仮タイトル', description: '', subject: 'SOCIAL_STUDIES' }

let environment: RulesTestEnvironment
beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-stock-league-classroom-lesson-templates',
    firestore: { rules: readFileSync(join(process.cwd(), 'firestore.rules'), 'utf8') },
  })
})
beforeEach(async () => { await environment.clearFirestore() })
afterAll(async () => { await environment.cleanup() })

describe('lessonTemplates repository', () => {
  it('creates a draft-only template and autosaves only the draft', async () => {
    // rules-unit-testing's `.firestore()` is typed against the firebase compat
    // namespace even though it returns a modular-SDK-compatible instance at
    // runtime; the cast bridges that upstream typing gap (also needed by
    // test/firestore.rules.test.ts's equivalent calls, which sidestep it by
    // going straight into `doc()`/`setDoc()` instead of a locally-typed function).
    const firestore = environment.authenticatedContext('teacher-a', { email_verified: true, firebase: { sign_in_provider: 'google.com' } }).firestore() as unknown as Firestore
    await environment.withSecurityRulesDisabled(async (context) => {
      const { setDoc, doc } = await import('firebase/firestore')
      await setDoc(doc(context.firestore(), 'organizations', 'personal_teacher-a', 'members', 'teacher-a'), { role: 'owner', status: 'active', membershipVersion: 1 })
    })
    const templateId = await createLessonTemplate(firestore, 'teacher-a', draft)
    const edited = await saveDraft(firestore, templateId, { ...draft, title: '編集後' })
    expect(edited.title).toBe('編集後')
  })
})
