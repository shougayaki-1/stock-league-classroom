/** Provider-independent contract. A concrete provider is intentionally not selected in v1. */
export interface LlmProvider { generateText(prompt: string): Promise<string> }
export const unconfiguredLlmProvider: LlmProvider = { generateText: () => Promise.reject(new Error('AI provider is not configured.')) }
