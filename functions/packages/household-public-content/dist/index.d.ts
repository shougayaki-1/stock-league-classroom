export type LifeStage = 'STUDENT' | 'INDEPENDENT' | 'FAMILY_FORMATION' | 'CHILD_REARING' | 'PRE_RETIREMENT' | 'RETIRED';
/**
 * Student-facing profile view (spec §13.4's 7 core fields). `isFictional`
 * must always be `true` and is rendered in the UI as "これは授業用の架空
 * プロフィールです" (spec §13.4) — never a real student's own data.
 */
export interface HouseholdProfilePublicView {
    householdId: string;
    age: number;
    householdIncomeYen: number;
    annualLivingExpensesYen: number;
    cashSavingsYen: number;
    family: string;
    housing: string;
    lifeGoal: string;
    lifeStage: LifeStage;
    isFictional: true;
}
export type AssetType = 'CASH' | 'SAVINGS_DEPOSIT' | 'BOND' | 'DOMESTIC_STOCK' | 'FOREIGN_STOCK' | 'INVESTMENT_TRUST';
/** Never carries expected-return/volatility coefficients — those are authoring-only (spec §13.15 "教師には計算式より影響の強さを見せる"). */
export interface AssetPositionPublicView {
    assetType: AssetType;
    valueYen: number;
}
/**
 * Spec §13.6: insurance is deliberately NOT part of the asset-allocation
 * pie chart — kept as a fully separate type from AssetPositionPublicView,
 * never merged into the same array or UI component.
 */
export interface InsuranceContractPublicView {
    id: string;
    productName: string;
    premiumYenPerYear: number;
    coveredRisk: string;
    benefitDescription: string;
    contractYearsRemaining: number;
}
export interface LiabilityPublicView {
    id: string;
    kind: 'MORTGAGE' | 'OTHER_LOAN';
    remainingPrincipalYen: number;
    annualInterestRatePercent: number;
    remainingYears: number;
}
