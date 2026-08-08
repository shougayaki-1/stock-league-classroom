import { describe, expect, it } from 'vitest'
import type { LessonRunRole } from '@stock-league/lesson-runtime-types'
import { canControlLesson, lessonControlActions, lessonControlPermissions } from './authorization'

describe('canControlLesson', () => {
  it('lets the primary teacher transition lesson phases', () => {
    expect(canControlLesson('PRIMARY', 'TRANSITION_PHASE')).toBe(true)
  })

  it('lets an assistant extend the time limit', () => {
    expect(canControlLesson('ASSISTANT', 'EXTEND_TIME')).toBe(true)
  })

  it('denies an assistant from ending the lesson', () => {
    expect(canControlLesson('ASSISTANT', 'END_LESSON')).toBe(false)
  })

  it('denies a viewer from publishing a notice', () => {
    expect(canControlLesson('VIEWER', 'PUBLISH_NOTICE')).toBe(false)
  })

  // §6.5 主担当専属: 開始、終了、市場停止、設定変更、主担当移譲
  it.each([
    'START_LESSON', 'END_LESSON', 'STOP_MARKET', 'CHANGE_SETTINGS', 'TRANSFER_PRIMARY',
  ] as const)('%s is PRIMARY-only', (action) => {
    expect(canControlLesson('PRIMARY', action)).toBe(true)
    expect(canControlLesson('ASSISTANT', action)).toBe(false)
    expect(canControlLesson('VIEWER', action)).toBe(false)
  })

  // §6.5 主担当・補助担当ともに可: ニュース公開、時間延長、生徒支援、接続対応
  it.each([
    'PUBLISH_NOTICE', 'EXTEND_TIME', 'SUPPORT_STUDENT', 'HANDLE_CONNECTION',
  ] as const)('%s is allowed for PRIMARY and ASSISTANT but not VIEWER', (action) => {
    expect(canControlLesson('PRIMARY', action)).toBe(true)
    expect(canControlLesson('ASSISTANT', action)).toBe(true)
    expect(canControlLesson('VIEWER', action)).toBe(false)
  })

  // §6.5 閲覧担当: 進行状況と結果の閲覧のみ、ただし他ロールも閲覧できる
  it.each(['VIEW_PROGRESS', 'VIEW_RESULTS'] as const)('%s is allowed for every role', (action) => {
    expect(canControlLesson('PRIMARY', action)).toBe(true)
    expect(canControlLesson('ASSISTANT', action)).toBe(true)
    expect(canControlLesson('VIEWER', action)).toBe(true)
  })

  it('TRANSITION_PHASE is PRIMARY-only (independent judgment call, see comment in authorization.ts)', () => {
    expect(canControlLesson('PRIMARY', 'TRANSITION_PHASE')).toBe(true)
    expect(canControlLesson('ASSISTANT', 'TRANSITION_PHASE')).toBe(false)
    expect(canControlLesson('VIEWER', 'TRANSITION_PHASE')).toBe(false)
  })

  it('exhaustively covers every LessonControlAction with no gaps against the §6.5 table', () => {
    const allRoles: LessonRunRole[] = ['PRIMARY', 'ASSISTANT', 'VIEWER']
    for (const action of lessonControlActions) {
      const expectedRoles = lessonControlPermissions[action]
      for (const role of allRoles) {
        expect(canControlLesson(role, action)).toBe(expectedRoles.includes(role))
      }
    }
  })
})
