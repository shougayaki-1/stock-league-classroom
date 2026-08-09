import { describe, expect, it } from 'vitest'
import { unconfiguredLlmProvider } from './llmProvider'
describe('unconfiguredLlmProvider', () => it('rejects with an actionable configuration error', async () => { await expect(unconfiguredLlmProvider.generateText('prompt')).rejects.toThrow('AI provider is not configured.') }))
