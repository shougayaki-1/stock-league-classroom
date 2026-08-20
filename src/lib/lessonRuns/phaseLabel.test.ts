import { describe, expect, it } from 'vitest'
import { findPhaseLabel, readPhaseLabel } from './phaseLabel'

describe('readPhaseLabel', () => {
  it('displayConfig.label が文字列なら返す', () => {
    expect(readPhaseLabel({ id: 'market', displayConfig: { label: '取引' } })).toBe('取引')
  })

  it('空文字は null にする', () => {
    expect(readPhaseLabel({ id: 'market', displayConfig: { label: '   ' } })).toBeNull()
  })

  it('displayConfig が無ければ null', () => {
    expect(readPhaseLabel({ id: 'market' })).toBeNull()
  })

  it('displayConfig が想定外の形なら null', () => {
    expect(readPhaseLabel({ id: 'market', displayConfig: 'ラベル' })).toBeNull()
    expect(readPhaseLabel({ id: 'market', displayConfig: null })).toBeNull()
    expect(readPhaseLabel({ id: 'market', displayConfig: { label: 42 } })).toBeNull()
  })

  it('phase 自体が無ければ null', () => {
    expect(readPhaseLabel(undefined)).toBeNull()
    expect(readPhaseLabel(null)).toBeNull()
  })
})

describe('findPhaseLabel', () => {
  const phases = [
    { id: 'intro', displayConfig: { label: '導入' } },
    { id: 'market', displayConfig: { label: '取引' } },
  ]

  it('id が一致するフェーズのラベルを返す', () => {
    expect(findPhaseLabel(phases, 'market')).toBe('取引')
  })

  it('一致しない id は null', () => {
    expect(findPhaseLabel(phases, 'nope')).toBeNull()
  })

  it('phaseId が null なら null', () => {
    expect(findPhaseLabel(phases, null)).toBeNull()
  })

  it('phases が無ければ null', () => {
    expect(findPhaseLabel(undefined, 'market')).toBeNull()
  })
})
