import type { AssetType, LifeStage } from '@stock-league/household-public-content';
/**
 * Teacher-authoring / server-internal type. Imported by BOTH `src/`
 * (teacher's own material-authoring UI legitimately edits
 * eventProbabilityOverrides/internalRiskFactors — the teacher is the
 * author of these values) and `functions/` (the engine's input). What
 * must never happen is a STUDENT receiving this data — that is enforced
 * by Firestore rules (teacher read-only) and by
 * `functions/src/homeEconomics/toPublicView.ts` being the only producer
 * of what lands in the student-readable RTDB path, not by import
 * restrictions. See `functions/src/market/toPublicView.ts` (Phase C
 * Task1) for the identical architecture note.
 */
export interface HouseholdProfile {
    householdId: string;
    age: number;
    householdIncomeYen: number;
    annualLivingExpensesYen: number;
    cashSavingsYen: number;
    family: string;
    housing: string;
    lifeGoal: string;
    lifeStage: LifeStage;
    /** Hidden. Never sent to students. Keyed by life-event id. */
    eventProbabilityOverrides: Record<string, number>;
    /** Hidden. Never sent to students. */
    internalRiskFactors: Record<string, number>;
}
export interface AssetPosition {
    assetType: AssetType;
    valueYen: number;
    /** Hidden. Drives assetReturn.ts (Task 4). Never sent to students — spec §13.15 "教師には計算式より影響の強さを見せる". */
    expectedReturnPercent: number;
    /** Hidden. Drives the noise term in assetReturn.ts. Never sent to students. */
    volatilityPercent: number;
}
export interface InsuranceProduct {
    id: string;
    productName: string;
    premiumYenPerYear: number;
    coveredRisk: string;
    benefitDescription: string;
    benefitAmountYen: number;
    contractYears: number;
    /** Which LifeEventDefinition ids this product pays out on — links Task 6's insurance.ts to Task 7's lifeEvents.ts without a text-matching heuristic against `coveredRisk` (a display string, not an identifier). */
    coveredEventIds: string[];
    /** Hidden. Internal claim-probability model — used only for teacher-facing "influence strength" display (spec §13.15), never to gate whether a benefit pays out (that is driven by whether a covered event actually fired). Never sent to students. */
    internalClaimProbability: number;
}
export type LifeEventDisclosureMode = 'ANNOUNCED' | 'PARTIALLY_ANNOUNCED' | 'HIDDEN';
/**
 * Spec §13.12: `disclosureMode` controls what students see BEFORE the
 * event fires (full announcement / partial hint / nothing). It is
 * deliberately independent of whether the event is deterministic or
 * probabilistic — `triggerProbability` (hidden, spec §13.15's "influence
 * strength shown to teachers instead of raw coefficients") drives when it
 * fires, `disclosureMode` drives what students are told about it in
 * advance. These are never conflated into one field.
 */
export interface LifeEventDefinition {
    id: string;
    label: string;
    disclosureMode: LifeEventDisclosureMode;
    /** Hidden. Never sent to students in this raw form. */
    triggerProbability: number;
    effectDescription: string;
    /** One-time yen delta applied to the round's income when this event fires (e.g. 就職・昇進 positive, 失業 negative). 0 when the event has no direct income effect. */
    incomeEffectYen: number;
    /** One-time yen delta applied to the round's expenses when this event fires (e.g. 出産・災害 positive, a windfall discount negative). 0 when none. */
    expenseEffectYen: number;
    /** One-time yen delta applied directly to cash savings when this event fires (e.g. a lump-sum cost or gift, distinct from the recurring income/expense effects above). 0 when none. */
    cashEffectYen: number;
}
export interface Liability {
    id: string;
    kind: 'MORTGAGE' | 'OTHER_LOAN';
    principalYen: number;
    remainingPrincipalYen: number;
    annualInterestRatePercent: number;
    remainingYears: number;
}
