import { describe, expect, it } from 'vitest'
import { validateLessonInput } from './index'

describe('validateLessonInput', () => {
  it('accepts a value present in SINGLE_CHOICE options', () => {
    expect(validateLessonInput({ type: 'SINGLE_CHOICE', options: ['a', 'b'] }, 'a')).toEqual([])
  })

  it('rejects a NUMBER value above max', () => {
    expect(validateLessonInput({ type: 'NUMBER', min: 0, max: 10 }, 11)).toEqual(['10以下で入力してください。'])
  })

  it('rejects an ALLOCATION whose total is wrong', () => {
    expect(
      validateLessonInput({ type: 'ALLOCATION', total: 100, items: ['a', 'b'] }, { a: 60, b: 30 }),
    ).toEqual(['合計を100にしてください。'])
  })

  it('rejects a SINGLE_CHOICE value not present in options', () => {
    expect(validateLessonInput({ type: 'SINGLE_CHOICE', options: ['a', 'b'] }, 'c')).toEqual(['選択肢から選んでください。'])
  })

  it('requires a SINGLE_CHOICE selection', () => {
    expect(validateLessonInput({ type: 'SINGLE_CHOICE', options: ['a', 'b'] }, '')).toEqual(['選択してください。'])
  })

  it('accepts a valid MULTIPLE_CHOICE selection', () => {
    expect(validateLessonInput({ type: 'MULTIPLE_CHOICE', options: ['a', 'b', 'c'] }, ['a', 'c'])).toEqual([])
  })

  it('requires at least one MULTIPLE_CHOICE selection', () => {
    expect(validateLessonInput({ type: 'MULTIPLE_CHOICE', options: ['a', 'b'] }, [])).toEqual(['1つ以上選択してください。'])
  })

  it('rejects a MULTIPLE_CHOICE selection over max', () => {
    expect(validateLessonInput({ type: 'MULTIPLE_CHOICE', options: ['a', 'b', 'c'], max: 1 }, ['a', 'b'])).toEqual([
      '1個以下で選択してください。',
    ])
  })

  it('accepts a NUMBER within bounds', () => {
    expect(validateLessonInput({ type: 'NUMBER', min: 0, max: 10 }, 5)).toEqual([])
  })

  it('rejects a NUMBER below min', () => {
    expect(validateLessonInput({ type: 'NUMBER', min: 0, max: 10 }, -1)).toEqual(['0以上で入力してください。'])
  })

  it('rejects a non-numeric NUMBER', () => {
    expect(validateLessonInput({ type: 'NUMBER', min: 0, max: 10 }, Number.NaN)).toEqual(['数値を入力してください。'])
  })

  it('accepts a valid QUANTITY', () => {
    expect(validateLessonInput({ type: 'QUANTITY' }, 3)).toEqual([])
  })

  it('rejects a negative QUANTITY', () => {
    expect(validateLessonInput({ type: 'QUANTITY' }, -1)).toEqual(['0以上で入力してください。'])
  })

  it('rejects a non-integer QUANTITY', () => {
    expect(validateLessonInput({ type: 'QUANTITY' }, 1.5)).toEqual(['整数で入力してください。'])
  })

  it('accepts an ALLOCATION whose total matches', () => {
    expect(validateLessonInput({ type: 'ALLOCATION', total: 100, items: ['a', 'b'] }, { a: 40, b: 60 })).toEqual([])
  })

  it('rejects an ALLOCATION with a negative item', () => {
    expect(
      validateLessonInput({ type: 'ALLOCATION', total: 100, items: ['a', 'b'] }, { a: -10, b: 110 }),
    ).toEqual(['マイナスの値は入力できません。'])
  })

  it('accepts a complete RANKING', () => {
    expect(validateLessonInput({ type: 'RANKING', items: ['a', 'b', 'c'] }, ['b', 'a', 'c'])).toEqual([])
  })

  it('rejects an incomplete RANKING', () => {
    expect(validateLessonInput({ type: 'RANKING', items: ['a', 'b', 'c'] }, ['b', 'a'])).toEqual([
      'すべての項目に順位をつけてください。',
    ])
  })

  it('rejects a RANKING with duplicate items', () => {
    expect(validateLessonInput({ type: 'RANKING', items: ['a', 'b', 'c'] }, ['a', 'a', 'c'])).toEqual([
      'すべての項目に順位をつけてください。',
    ])
  })

  it('accepts a valid AGREE_DISAGREE answer', () => {
    expect(validateLessonInput({ type: 'AGREE_DISAGREE' }, '賛成')).toEqual([])
  })

  it('requires an AGREE_DISAGREE answer', () => {
    expect(validateLessonInput({ type: 'AGREE_DISAGREE' }, '')).toEqual(['選択してください。'])
  })

  it('accepts a valid REASON_CHOICE answer', () => {
    expect(
      validateLessonInput({ type: 'REASON_CHOICE', options: ['a', 'b'] }, { choice: 'a', reason: 'なぜなら成長性が高いから' }),
    ).toEqual([])
  })

  it('requires a reason for REASON_CHOICE', () => {
    expect(validateLessonInput({ type: 'REASON_CHOICE', options: ['a', 'b'] }, { choice: 'a', reason: '' })).toEqual([
      '理由を入力してください。',
    ])
  })

  it('rejects a REASON_CHOICE reason over the max length', () => {
    expect(
      validateLessonInput({ type: 'REASON_CHOICE', options: ['a', 'b'], reasonMaxLength: 5 }, { choice: 'a', reason: '123456' }),
    ).toEqual(['理由は5文字以内で入力してください。'])
  })

  it('accepts SHORT_TEXT within the max length', () => {
    expect(validateLessonInput({ type: 'SHORT_TEXT', maxLength: 10 }, 'こんにちは')).toEqual([])
  })

  it('requires SHORT_TEXT to be non-empty', () => {
    expect(validateLessonInput({ type: 'SHORT_TEXT', maxLength: 10 }, '')).toEqual(['入力してください。'])
  })

  it('rejects SHORT_TEXT over the max length', () => {
    expect(validateLessonInput({ type: 'SHORT_TEXT', maxLength: 3 }, 'abcd')).toEqual(['3文字以内で入力してください。'])
  })
})
