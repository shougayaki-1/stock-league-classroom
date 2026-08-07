"use strict";
/**
 * §10 共通入力コンポーネント: 授業で使う「回答方式」の型とバリデーション。
 *
 * 表示 widget の種類 (`LessonInputConfig['type']`) と、誰が/どう答えるか
 * (`responseScope` = 個人/チーム、`interactionMode` = 直接/提案・承認/確定) は
 * 直交する軸として設計している。widget 種類ごとに個人版・チーム版…と型を
 * 増やすと 9 * 2 * 3 の直積になってしまうため、`LessonInputField` がその2軸を
 * `config` の外側に持たせることで直積爆発を避けている。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateLessonInput = validateLessonInput;
const DEFAULT_AGREE_DISAGREE_OPTIONS = ['賛成', '反対'];
const DEFAULT_REASON_MAX_LENGTH = 200;
function validateSingleChoice(config, value) {
    if (typeof value !== 'string' || value === '')
        return ['選択してください。'];
    if (!config.options.includes(value))
        return ['選択肢から選んでください。'];
    return [];
}
function validateMultipleChoice(config, value) {
    if (!Array.isArray(value))
        return ['1つ以上選択してください。'];
    const min = config.min ?? 1;
    const max = config.max ?? config.options.length;
    const invalid = value.some((v) => typeof v !== 'string' || !config.options.includes(v));
    if (invalid)
        return ['選択肢から選んでください。'];
    if (value.length < min)
        return min <= 1 ? ['1つ以上選択してください。'] : [`${min}個以上選択してください。`];
    if (value.length > max)
        return [`${max}個以下で選択してください。`];
    return [];
}
function validateNumber(config, value) {
    if (typeof value !== 'number' || Number.isNaN(value))
        return ['数値を入力してください。'];
    if (config.min !== undefined && value < config.min)
        return [`${config.min}以上で入力してください。`];
    if (config.max !== undefined && value > config.max)
        return [`${config.max}以下で入力してください。`];
    return [];
}
function validateQuantity(config, value) {
    if (typeof value !== 'number' || Number.isNaN(value))
        return ['数値を入力してください。'];
    if (!Number.isInteger(value))
        return ['整数で入力してください。'];
    const min = config.min ?? 0;
    if (value < min)
        return [`${min}以上で入力してください。`];
    if (config.max !== undefined && value > config.max)
        return [`${config.max}以下で入力してください。`];
    return [];
}
function validateAllocation(config, value) {
    if (typeof value !== 'object' || value === null)
        return [`合計を${config.total}にしてください。`];
    const record = value;
    let sum = 0;
    for (const item of config.items) {
        const amount = record[item];
        if (typeof amount !== 'number' || Number.isNaN(amount))
            return [`合計を${config.total}にしてください。`];
        if (amount < 0)
            return ['マイナスの値は入力できません。'];
        sum += amount;
    }
    if (sum !== config.total)
        return [`合計を${config.total}にしてください。`];
    return [];
}
function validateRanking(config, value) {
    const message = 'すべての項目に順位をつけてください。';
    if (!Array.isArray(value))
        return [message];
    if (value.length !== config.items.length)
        return [message];
    const uniqueValues = new Set(value);
    if (uniqueValues.size !== config.items.length)
        return [message];
    const uniqueItems = new Set(config.items);
    const sameSet = value.every((v) => uniqueItems.has(v));
    if (!sameSet)
        return [message];
    return [];
}
function validateAgreeDisagree(config, value) {
    const options = config.options ?? DEFAULT_AGREE_DISAGREE_OPTIONS;
    if (typeof value !== 'string' || value === '')
        return ['選択してください。'];
    if (!options.includes(value))
        return ['選択肢から選んでください。'];
    return [];
}
function validateReasonChoice(config, value) {
    if (typeof value !== 'object' || value === null)
        return ['選択してください。'];
    const { choice, reason } = value;
    if (typeof choice !== 'string' || choice === '')
        return ['選択してください。'];
    if (!config.options.includes(choice))
        return ['選択肢から選んでください。'];
    if (typeof reason !== 'string' || reason.trim() === '')
        return ['理由を入力してください。'];
    const maxLength = config.reasonMaxLength ?? DEFAULT_REASON_MAX_LENGTH;
    if (reason.length > maxLength)
        return [`理由は${maxLength}文字以内で入力してください。`];
    return [];
}
function validateShortText(config, value) {
    if (typeof value !== 'string' || value === '')
        return ['入力してください。'];
    if (value.length > config.maxLength)
        return [`${config.maxLength}文字以内で入力してください。`];
    return [];
}
/** widget 種類ごとにバリデーションを分岐する純粋関数。エラーメッセージは日本語。 */
function validateLessonInput(config, value) {
    switch (config.type) {
        case 'SINGLE_CHOICE':
            return validateSingleChoice(config, value);
        case 'MULTIPLE_CHOICE':
            return validateMultipleChoice(config, value);
        case 'NUMBER':
            return validateNumber(config, value);
        case 'QUANTITY':
            return validateQuantity(config, value);
        case 'ALLOCATION':
            return validateAllocation(config, value);
        case 'RANKING':
            return validateRanking(config, value);
        case 'AGREE_DISAGREE':
            return validateAgreeDisagree(config, value);
        case 'REASON_CHOICE':
            return validateReasonChoice(config, value);
        case 'SHORT_TEXT':
            return validateShortText(config, value);
    }
}
