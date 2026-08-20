import { describe, expect, it } from 'vitest'
import { buildDefaultPhases } from './defaultPhases'
import { validateLessonForStart } from './validation'

describe('buildDefaultPhases', () => {
  it('produces a graph that passes validateLessonForStart for SOCIAL_STUDIES', () => {
    const { phases, initialPhaseId } = buildDefaultPhases('SOCIAL_STUDIES')
    const errors = validateLessonForStart({ subject: 'SOCIAL_STUDIES', phases, initialPhaseId }).filter((p) => p.severity === 'ERROR')
    expect(errors).toEqual([])
    expect(initialPhaseId).toBe('intro')
  })

  it('produces a graph that passes validateLessonForStart for HOME_ECONOMICS', () => {
    const { phases, initialPhaseId } = buildDefaultPhases('HOME_ECONOMICS')
    const errors = validateLessonForStart({ subject: 'HOME_ECONOMICS', phases, initialPhaseId }).filter((p) => p.severity === 'ERROR')
    expect(errors).toEqual([])
  })

  it('never includes a MARKET-type phase for HOME_ECONOMICS (矛盾解消G)', () => {
    const { phases } = buildDefaultPhases('HOME_ECONOMICS')
    expect(phases.some((phase) => phase.type === 'MARKET')).toBe(false)
  })

  it('ends in a REFLECTION-type terminal phase with no further transitions', () => {
    const { phases } = buildDefaultPhases('SOCIAL_STUDIES')
    const reflection = phases.find((phase) => phase.id === 'reflection')
    expect(reflection?.type).toBe('REFLECTION')
    expect(reflection?.nextPhaseIds).toEqual([])
  })

  it('chains every phase to the next by id, forming a single linear path', () => {
    const { phases, initialPhaseId } = buildDefaultPhases('SOCIAL_STUDIES')
    expect(initialPhaseId).toBe('intro')
    expect(phases.find((phase) => phase.id === 'intro')?.nextPhaseIds).toEqual(['market'])
    expect(phases.find((phase) => phase.id === 'market')?.nextPhaseIds).toEqual(['result'])
    expect(phases.find((phase) => phase.id === 'result')?.nextPhaseIds).toEqual(['reflection'])
  })
})

describe('coreActivityMinutes', () => {
  it('社会科では取引フェーズだけが durationSeconds を持つ', () => {
    const { phases } = buildDefaultPhases('SOCIAL_STUDIES', 20)
    const withDuration = phases.filter((phase) => typeof phase.durationSeconds === 'number')

    expect(withDuration).toHaveLength(1)
    expect(withDuration[0].id).toBe('market')
    expect(withDuration[0].durationSeconds).toBe(20 * 60)
  })

  it('家庭科では意思決定フェーズだけが durationSeconds を持つ', () => {
    const { phases } = buildDefaultPhases('HOME_ECONOMICS', 35)
    const withDuration = phases.filter((phase) => typeof phase.durationSeconds === 'number')

    expect(withDuration).toHaveLength(1)
    expect(withDuration[0].id).toBe('decision')
    expect(withDuration[0].durationSeconds).toBe(35 * 60)
  })

  it('省略時はどのフェーズも durationSeconds を持たない', () => {
    const { phases } = buildDefaultPhases('SOCIAL_STUDIES')
    expect(phases.every((phase) => phase.durationSeconds === undefined)).toBe(true)
  })

  it('progression は TEACHER_CONTROLLED のまま変えない', () => {
    const { phases } = buildDefaultPhases('SOCIAL_STUDIES', 20)
    expect(phases.every((phase) => phase.progression === 'TEACHER_CONTROLLED')).toBe(true)
  })

  it('0以下の分数は無視する', () => {
    const { phases } = buildDefaultPhases('SOCIAL_STUDIES', 0)
    expect(phases.every((phase) => phase.durationSeconds === undefined)).toBe(true)
  })
})
