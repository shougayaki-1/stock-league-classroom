/**
 * §10 共通入力コンポーネント: 授業で使う「回答方式」の型とバリデーション。
 *
 * 表示 widget の種類 (`LessonInputConfig['type']`) と、誰が/どう答えるか
 * (`responseScope` = 個人/チーム、`interactionMode` = 直接/提案・承認/確定) は
 * 直交する軸として設計している。widget 種類ごとに個人版・チーム版…と型を
 * 増やすと 9 * 2 * 3 の直積になってしまうため、`LessonInputField` がその2軸を
 * `config` の外側に持たせることで直積爆発を避けている。
 */

/** 単一選択: 選択肢から1つ選ぶ。 */
export interface SingleChoiceConfig {
  type: 'SINGLE_CHOICE'
  options: string[]
}

/** 複数選択: 選択肢から複数選ぶ。min/max で選択数を制約できる。 */
export interface MultipleChoiceConfig {
  type: 'MULTIPLE_CHOICE'
  options: string[]
  /** 既定 1。0 にすると「選ばない」を許容する設問にできる。 */
  min?: number
  /** 既定 options.length。 */
  max?: number
}

/** 数値入力: 任意の数値。min/max で範囲を制約する。 */
export interface NumberConfig {
  type: 'NUMBER'
  min?: number
  max?: number
}

/** 株数・個数入力: 0以上の整数。min/max で範囲を制約する（既定 min は 0）。 */
export interface QuantityConfig {
  type: 'QUANTITY'
  min?: number
  max?: number
}

/** 金額配分: items の合計が total になるように配分する。 */
export interface AllocationConfig {
  type: 'ALLOCATION'
  items: string[]
  total: number
}

/** 順位付け: items の全項目に過不足なく順位（並び順）をつける。 */
export interface RankingConfig {
  type: 'RANKING'
  items: string[]
}

/** 賛成・反対（または段階的な賛否）。既定は「賛成」「反対」の2択。 */
export interface AgreeDisagreeConfig {
  type: 'AGREE_DISAGREE'
  /** 既定 ['賛成', '反対']。3段階以上の賛否スケールにも対応できるよう可変にしている。 */
  options?: string[]
}

/** 理由選択: 選択肢から1つ選び、理由を自由記述する。 */
export interface ReasonChoiceConfig {
  type: 'REASON_CHOICE'
  options: string[]
  /** 理由欄の文字数上限。既定 200。 */
  reasonMaxLength?: number
}

/** 短い自由記述。 */
export interface ShortTextConfig {
  type: 'SHORT_TEXT'
  maxLength: number
}

export type LessonInputConfig =
  | SingleChoiceConfig
  | MultipleChoiceConfig
  | NumberConfig
  | QuantityConfig
  | AllocationConfig
  | RankingConfig
  | AgreeDisagreeConfig
  | ReasonChoiceConfig
  | ShortTextConfig

export type LessonInputType = LessonInputConfig['type']

/** REASON_CHOICE の回答値: 選んだ選択肢と理由の組。 */
export interface ReasonChoiceValue {
  choice: string
  reason: string
}

/** widget 種類ごとの回答値の形。 */
export interface LessonInputValueMap {
  SINGLE_CHOICE: string
  MULTIPLE_CHOICE: string[]
  NUMBER: number
  QUANTITY: number
  ALLOCATION: Record<string, number>
  RANKING: string[]
  AGREE_DISAGREE: string
  REASON_CHOICE: ReasonChoiceValue
  SHORT_TEXT: string
}

/** `config.type` に応じて回答値の型が決まる（`LessonInputValue<typeof config>`）。 */
export type LessonInputValue<T extends LessonInputConfig = LessonInputConfig> = LessonInputValueMap[T['type']]

/**
 * §10「個人回答」「チーム回答」「提案」「承認」「確定」は widget の種類とは独立な軸。
 * `LessonInputField` が config を包み、この2軸を表現する。
 */
export type LessonResponseScope = 'INDIVIDUAL' | 'TEAM'
export type LessonInteractionMode = 'DIRECT' | 'PROPOSAL_APPROVAL' | 'CONFIRMATION'

export interface LessonInputField<C extends LessonInputConfig = LessonInputConfig> {
  config: C
  responseScope: LessonResponseScope
  interactionMode: LessonInteractionMode
}

const DEFAULT_AGREE_DISAGREE_OPTIONS = ['賛成', '反対']
const DEFAULT_REASON_MAX_LENGTH = 200

function validateSingleChoice(config: SingleChoiceConfig, value: unknown): string[] {
  if (typeof value !== 'string' || value === '') return ['選択してください。']
  if (!config.options.includes(value)) return ['選択肢から選んでください。']
  return []
}

function validateMultipleChoice(config: MultipleChoiceConfig, value: unknown): string[] {
  if (!Array.isArray(value)) return ['1つ以上選択してください。']
  const min = config.min ?? 1
  const max = config.max ?? config.options.length
  const invalid = value.some((v) => typeof v !== 'string' || !config.options.includes(v))
  if (invalid) return ['選択肢から選んでください。']
  if (value.length < min) return min <= 1 ? ['1つ以上選択してください。'] : [`${min}個以上選択してください。`]
  if (value.length > max) return [`${max}個以下で選択してください。`]
  return []
}

function validateNumber(config: NumberConfig, value: unknown): string[] {
  if (typeof value !== 'number' || Number.isNaN(value)) return ['数値を入力してください。']
  if (config.min !== undefined && value < config.min) return [`${config.min}以上で入力してください。`]
  if (config.max !== undefined && value > config.max) return [`${config.max}以下で入力してください。`]
  return []
}

function validateQuantity(config: QuantityConfig, value: unknown): string[] {
  if (typeof value !== 'number' || Number.isNaN(value)) return ['数値を入力してください。']
  if (!Number.isInteger(value)) return ['整数で入力してください。']
  const min = config.min ?? 0
  if (value < min) return [`${min}以上で入力してください。`]
  if (config.max !== undefined && value > config.max) return [`${config.max}以下で入力してください。`]
  return []
}

function validateAllocation(config: AllocationConfig, value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return [`合計を${config.total}にしてください。`]
  const record = value as Record<string, unknown>
  let sum = 0
  for (const item of config.items) {
    const amount = record[item]
    if (typeof amount !== 'number' || Number.isNaN(amount)) return [`合計を${config.total}にしてください。`]
    if (amount < 0) return ['マイナスの値は入力できません。']
    sum += amount
  }
  if (sum !== config.total) return [`合計を${config.total}にしてください。`]
  return []
}

function validateRanking(config: RankingConfig, value: unknown): string[] {
  const message = 'すべての項目に順位をつけてください。'
  if (!Array.isArray(value)) return [message]
  if (value.length !== config.items.length) return [message]
  const uniqueValues = new Set(value)
  if (uniqueValues.size !== config.items.length) return [message]
  const uniqueItems = new Set(config.items)
  const sameSet = value.every((v) => uniqueItems.has(v))
  if (!sameSet) return [message]
  return []
}

function validateAgreeDisagree(config: AgreeDisagreeConfig, value: unknown): string[] {
  const options = config.options ?? DEFAULT_AGREE_DISAGREE_OPTIONS
  if (typeof value !== 'string' || value === '') return ['選択してください。']
  if (!options.includes(value)) return ['選択肢から選んでください。']
  return []
}

function validateReasonChoice(config: ReasonChoiceConfig, value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return ['選択してください。']
  const { choice, reason } = value as Partial<ReasonChoiceValue>
  if (typeof choice !== 'string' || choice === '') return ['選択してください。']
  if (!config.options.includes(choice)) return ['選択肢から選んでください。']
  if (typeof reason !== 'string' || reason.trim() === '') return ['理由を入力してください。']
  const maxLength = config.reasonMaxLength ?? DEFAULT_REASON_MAX_LENGTH
  if (reason.length > maxLength) return [`理由は${maxLength}文字以内で入力してください。`]
  return []
}

function validateShortText(config: ShortTextConfig, value: unknown): string[] {
  if (typeof value !== 'string' || value === '') return ['入力してください。']
  if (value.length > config.maxLength) return [`${config.maxLength}文字以内で入力してください。`]
  return []
}

/** widget 種類ごとにバリデーションを分岐する純粋関数。エラーメッセージは日本語。 */
export function validateLessonInput<C extends LessonInputConfig>(config: C, value: unknown): string[] {
  switch (config.type) {
    case 'SINGLE_CHOICE':
      return validateSingleChoice(config, value)
    case 'MULTIPLE_CHOICE':
      return validateMultipleChoice(config, value)
    case 'NUMBER':
      return validateNumber(config, value)
    case 'QUANTITY':
      return validateQuantity(config, value)
    case 'ALLOCATION':
      return validateAllocation(config, value)
    case 'RANKING':
      return validateRanking(config, value)
    case 'AGREE_DISAGREE':
      return validateAgreeDisagree(config, value)
    case 'REASON_CHOICE':
      return validateReasonChoice(config, value)
    case 'SHORT_TEXT':
      return validateShortText(config, value)
  }
}
