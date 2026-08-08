import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { FirebaseApp } from 'firebase/app'
import type { Auth } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore'
import type { Database } from 'firebase/database'
import type { Functions } from 'firebase/functions'
import App from './App'

// Same module-boundary mock pattern as LessonControlRoom.test.tsx: App.tsx's
// route guards (and the Task 11/12/13 screens they wire up) call the real
// client wrappers, so only the underlying Firebase SDK calls are faked here.
let authStateCallback: ((user: { uid: string } | null) => void) | undefined
const onAuthStateChangedMock = vi.fn((_auth: unknown, callback: (user: { uid: string } | null) => void) => {
  authStateCallback = callback
  return () => {}
})
const signInAnonymouslyMock = vi.fn().mockResolvedValue({ user: { uid: 'student-uid' } })
const signInWithCustomTokenMock = vi.fn().mockResolvedValue({ user: { uid: 'display-uid' } })
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (...args: Parameters<typeof onAuthStateChangedMock>) => onAuthStateChangedMock(...args),
  signInAnonymously: () => signInAnonymouslyMock(),
  signInWithCustomToken: (...args: unknown[]) => signInWithCustomTokenMock(...args),
}))

const getDocMock = vi.fn()
const docMock = vi.fn((_firestore: unknown, ...segments: string[]) => ({ __path: segments.join('/') }))
const collectionMock = vi.fn((_firestore: unknown, path: string) => ({ __path: path }))
const onSnapshotMock = vi.fn((_ref: unknown, onNext: (s: { docs: unknown[] }) => void) => {
  onNext({ docs: [] })
  return () => {}
})
vi.mock('firebase/firestore', () => ({
  doc: (...args: Parameters<typeof docMock>) => docMock(...args),
  getDoc: (...args: unknown[]) => getDocMock(...args),
  collection: (...args: Parameters<typeof collectionMock>) => collectionMock(...args),
  onSnapshot: (...args: Parameters<typeof onSnapshotMock>) => onSnapshotMock(...args),
}))

let membershipListener: ((snapshot: { val: () => unknown }) => void) | undefined
const refMock = vi.fn((_database: unknown, path: string) => ({ __path: path }))
const onValueMock = vi.fn((nodeRef: { __path: string }, onNext: (s: { val: () => unknown }) => void) => {
  if (nodeRef.__path.startsWith('lessonRunMembership/')) membershipListener = onNext
  return () => {}
})
const offMock = vi.fn()
vi.mock('firebase/database', () => ({
  ref: (...args: Parameters<typeof refMock>) => refMock(...args),
  onValue: (...args: Parameters<typeof onValueMock>) => onValueMock(...args),
  off: (...args: unknown[]) => offMock(...args),
}))

const callableMock = vi.fn().mockResolvedValue({ data: {} })
const httpsCallableMock = vi.fn(() => callableMock)
vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: Parameters<typeof httpsCallableMock>) => httpsCallableMock(...args),
}))

const fakeServices = {
  app: {} as FirebaseApp,
  auth: {} as Auth,
  firestore: {} as Firestore,
  database: {} as Database,
  functions: {} as Functions,
}
const getServices = () => fakeServices

function emitMembership(value: { access: string; teamId?: string } | null) {
  membershipListener?.({ val: () => value })
}

beforeEach(() => {
  authStateCallback = undefined
  membershipListener = undefined
  onAuthStateChangedMock.mockClear()
  signInAnonymouslyMock.mockClear()
  signInWithCustomTokenMock.mockClear()
  getDocMock.mockReset()
  docMock.mockClear()
  collectionMock.mockClear()
  onSnapshotMock.mockClear()
  refMock.mockClear()
  onValueMock.mockClear()
  offMock.mockClear()
  callableMock.mockClear().mockResolvedValue({ data: {} })
  httpsCallableMock.mockClear()
})

describe('App', () => {
  it('keeps every landing-page CTA within the surviving public routes', () => {
    render(<App />)
    expect(screen.getByRole('link', { name: '使い方' })).toHaveAttribute('href', '/guide')
    expect(screen.getByRole('link', { name: '特徴' })).toHaveAttribute('href', '/about')
    expect(screen.getByRole('link', { name: /詳しく見る/i })).toHaveAttribute('href', '/about')
    expect(screen.getByRole('link', { name: /サービス概要を見る/i })).toHaveAttribute('href', '/about')
  })

  it.each([
    ['/about', /サービス概要/],
    ['/guide', /教師向け操作マニュアル/],
    ['/terms', /利用規約/],
    ['/privacy', /プライバシーポリシー/],
    ['/contact', /お問い合わせ/],
  ])('serves the public document at %s without Firebase', (path, heading) => {
    window.history.pushState({}, '', path)
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })

  it('states the current Phase A privacy posture', () => {
    window.history.pushState({}, '', '/privacy')
    render(<App />)
    expect(screen.getByText(/現在は、生徒の授業データを取得していません/)).toBeInTheDocument()
    expect(screen.getByText(/保存期間と自動削除は、授業機能の提供開始前に明示/)).toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })

  it('shows a not-found page for an unknown route instead of falling back to the landing page', () => {
    window.history.pushState({}, '', '/does-not-exist')
    render(<App />)
    expect(screen.getByRole('heading', { name: 'ページが見つかりません' })).toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })

  it('normalizes a trailing slash before matching a public route', async () => {
    window.history.pushState({}, '', '/terms/')
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: /利用規約/ })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/terms')
    window.history.pushState({}, '', '/')
  })

  it('does not leave the removed host console route reachable', () => {
    window.history.pushState({}, '', '/teacher/markets/demo-market/host?tab=news')
    render(<App />)
    expect(screen.getByRole('heading', { name: 'ページが見つかりません' })).toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })
})

describe('Phase B lesson platform routes (Task 17)', () => {
  const guardedPaths = [
    '/join',
    '/lessons/run-1/waiting',
    '/lessons/run-1/play',
    '/lessons/run-1/results',
    '/teacher/lessons/run-1/control',
    '/teacher/lessons/run-1/analytics',
    '/display/run-1',
  ]

  it.each(guardedPaths)('redirects %s to /about when the flag is off (default)', (path) => {
    window.history.pushState({}, '', path)
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: /サービス概要/ })).toBeInTheDocument()
    expect(getDocMock).not.toHaveBeenCalled()
    window.history.pushState({}, '', '/')
  })

  it('denies an unauthenticated teacher and redirects to /about', async () => {
    window.history.pushState({}, '', '/teacher/lessons/run-1/control')
    render(<App isLessonPlatformV2Enabled getServices={getServices} />)
    authStateCallback?.(null)
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: /サービス概要/ })).toBeInTheDocument())
    window.history.pushState({}, '', '/')
  })

  it('denies a signed-in teacher who has no role on this lessonRun and redirects to /about', async () => {
    window.history.pushState({}, '', '/teacher/lessons/run-1/control')
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ orgId: 'org-1', teacherRoles: {} }) })
    render(<App isLessonPlatformV2Enabled getServices={getServices} />)
    authStateCallback?.({ uid: 'teacher-uid' })
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: /サービス概要/ })).toBeInTheDocument())
    window.history.pushState({}, '', '/')
  })

  it('grants a teacher whose uid is in teacherRoles and renders the control room', async () => {
    window.history.pushState({}, '', '/teacher/lessons/run-1/control')
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ orgId: 'org-1', teacherRoles: { 'teacher-uid': 'PRIMARY' } }) })
    render(<App isLessonPlatformV2Enabled getServices={getServices} />)
    authStateCallback?.({ uid: 'teacher-uid' })
    expect(await screen.findByRole('heading', { name: '次にすること' })).toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })

  it('grants a teacher analytics route and shows the deferred-data notice (no analytics client wrapper exists yet)', async () => {
    window.history.pushState({}, '', '/teacher/lessons/run-1/analytics')
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ orgId: 'org-1', teacherRoles: { 'teacher-uid': 'ASSISTANT' } }) })
    render(<App isLessonPlatformV2Enabled getServices={getServices} />)
    authStateCallback?.({ uid: 'teacher-uid' })
    expect(await screen.findByRole('heading', { level: 1, name: '授業分析' })).toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })

  it('redirects a student without an ACTIVE lessonRunMembership entry to /join', async () => {
    window.history.pushState({}, '', '/lessons/run-1/waiting')
    render(<App isLessonPlatformV2Enabled getServices={getServices} />)
    await waitFor(() => expect(membershipListener).toBeDefined())
    emitMembership(null)
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: '授業に参加する' })).toBeInTheDocument())
    window.history.pushState({}, '', '/')
  })

  it('grants a student with an ACTIVE lessonRunMembership entry and shows the deferred-data notice', async () => {
    window.history.pushState({}, '', '/lessons/run-1/waiting')
    render(<App isLessonPlatformV2Enabled getServices={getServices} />)
    await waitFor(() => expect(membershipListener).toBeDefined())
    emitMembership({ access: 'ACTIVE', teamId: 'team-a' })
    expect(await screen.findByRole('heading', { level: 1, name: /開始をお待ちください/ })).toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })

  it('renders the join form once anonymous sign-in resolves', async () => {
    window.history.pushState({}, '', '/join')
    render(<App isLessonPlatformV2Enabled getServices={getServices} />)
    expect(await screen.findByRole('heading', { level: 1, name: '授業に参加する' })).toBeInTheDocument()
    expect(signInAnonymouslyMock).toHaveBeenCalled()
    window.history.pushState({}, '', '/')
  })

  it('mounts the classroom display page with the runId and token from the URL', async () => {
    window.history.pushState({}, '', '/display/run-1?token=plaintext-token')
    callableMock.mockRejectedValue(new Error('exchange failed'))
    render(<App isLessonPlatformV2Enabled getServices={getServices} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/この教室表示を表示できません/)
    window.history.pushState({}, '', '/')
  })
})
