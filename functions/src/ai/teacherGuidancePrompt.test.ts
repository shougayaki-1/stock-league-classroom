import { describe, expect, it } from 'vitest'
import { buildTeacherGuidancePrompt, parseTeacherGuidanceResponse } from './teacherGuidancePrompt'
describe('teacher guidance prompt', () => it('builds and parses teacher guidance', () => { expect(buildTeacherGuidancePrompt({ topic: '株価' })).toContain('株価'); expect(parseTeacherGuidanceResponse('{"teacherGuidance":"説明"}')).toEqual({ teacherGuidance: '説明' }); expect(() => parseTeacherGuidanceResponse('bad')).toThrow('AI response was not valid JSON') }))
