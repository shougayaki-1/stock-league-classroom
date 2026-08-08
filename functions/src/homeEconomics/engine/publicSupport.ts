import type { PublicSupportProgram } from '@stock-league/household-authoring-content'

/** Spec §13.10: "条件・効果を簡略表示" — a single income-threshold check, not a full eligibility engine. */
export const determineEligiblePrograms = (
  programs: PublicSupportProgram[],
  householdIncomeYen: number,
): PublicSupportProgram[] =>
  programs.filter((program) => program.maxHouseholdIncomeYen === null || householdIncomeYen < program.maxHouseholdIncomeYen)

/**
 * Spec §13.10: "自動適用か申請選択かを教材で設定" — AUTOMATIC programs
 * always count once eligible; APPLICATION_REQUIRED ones only count when
 * the student actually chose to apply for them this round (via Task 10's
 * DECISION submission, surfaced as one of Task 8's shortfall options or a
 * standalone application choice).
 */
export const computePublicSupportAvailableYen = (
  eligiblePrograms: PublicSupportProgram[],
  appliedProgramIds: string[],
): number =>
  eligiblePrograms.reduce((sum, program) => {
    if (program.applicationMode === 'AUTOMATIC') return sum + program.benefitAmountYen
    return appliedProgramIds.includes(program.id) ? sum + program.benefitAmountYen : sum
  }, 0)
