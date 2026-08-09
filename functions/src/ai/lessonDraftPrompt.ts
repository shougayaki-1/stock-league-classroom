export interface LessonDraftPromptInput { theme: string; mainObjective: string; subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS'; difficulty: 'BASIC' | 'STANDARD' | 'ADVANCED' }
export interface ParsedLessonDraft { title: string; description: string }
export const buildLessonDraftPrompt = (input: LessonDraftPromptInput): string => `あなたは学校教員向けの授業設計アシスタントです。以下の条件に基づいて教材案を1つ提案してください。
科目: ${input.subject === 'SOCIAL_STUDIES' ? '社会科（市場シミュレーション）' : '家庭科（生活設計シミュレーション）'}
テーマ: ${input.theme}
主な学習目標: ${input.mainObjective}
難易度: ${input.difficulty}
必ず次のJSONのみを出力してください: {"title":"教材のタイトル","description":"教材の概要説明"}`
export const parseLessonDraftResponse = (text: string): ParsedLessonDraft => {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new Error('AI response was not valid JSON') }
  if (!parsed || typeof parsed !== 'object') throw new Error('AI response was not valid JSON')
  const record = parsed as Record<string, unknown>
  if (typeof record.title !== 'string') throw new Error('AI response is missing required field: title')
  if (typeof record.description !== 'string') throw new Error('AI response is missing required field: description')
  return { title: record.title, description: record.description }
}
