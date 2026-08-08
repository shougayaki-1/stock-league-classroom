/**
 * Teacher-authoring / server-internal types. This package IS imported by
 * `src/` (the teacher's own authoring UI legitimately edits
 * impactSensitivities, InformationImpact, etc. — the teacher is the
 * author of these values). What must never happen is a STUDENT receiving
 * this data — that is enforced by Firestore rules on
 * `lessonRuns`/`lessonTemplates` (teacher read-only) and by
 * `functions/src/market/toPublicView.ts` being the only producer of what
 * lands in the student-readable RTDB `lessonRunPublic` path, not by
 * restricting who may import this type. This file depends on
 * `@stock-league/market-public-content` for shared enum types
 * (`CompanySizeClass` etc.) — the dependency points one way: this package
 * may reference that one, never the reverse.
 */
import type { CompanySizeClass, InformationCategory, InformationConfidence, InformationNature } from '@stock-league/market-public-content';
export type PriceGuard = {
    type: 'ABSOLUTE';
    minimumPrice: number;
} | {
    type: 'PERCENT_OF_INITIAL';
    minimumPercent: number;
};
export interface SimulatedCompany {
    id: string;
    name: string;
    symbol: string;
    industry: string;
    description: string;
    productsAndServices: string[];
    domesticRevenueRatio?: number;
    overseasRevenueRatio?: number;
    costDrivers: string[];
    sizeClass: CompanySizeClass;
    financialStrength: 'WEAK' | 'STANDARD' | 'STRONG';
    growthProfile: 'STABLE' | 'GROWTH' | 'CYCLICAL';
    riskFactors: string[];
    initialPrice: number;
    minimumPriceGuard: PriceGuard;
    /** Hidden. Never sent to students. Keyed by InformationCategory. */
    impactSensitivities: Record<string, number>;
}
export interface InformationImpact {
    baseDirection: 'POSITIVE' | 'NEGATIVE' | 'MIXED' | 'NEUTRAL';
    strength: number;
    marketExpectation?: number;
    interactions?: string[];
    shortTermImpact?: number;
    longTermImpact?: number;
}
export interface InformationItem {
    id: string;
    category: InformationCategory;
    source: string;
    publishedAtMillis: number;
    natureType: InformationNature;
    confidenceLevel: InformationConfidence;
    targetCompanyIds: string[];
    /** Student-visible body. Everything else on this type is teacher-only. */
    body: string;
    /** Hidden. Drives priceCalculation.ts (Task 3). Never sent to students. */
    impact: InformationImpact;
}
export interface EconomicIndicatorAuthoring {
    id: string;
    kind: 'ECONOMY' | 'PRICE' | 'INTEREST_RATE' | 'FX' | 'POLICY';
    publishedAtMillis: number;
    label: string;
    value?: number;
    changeFromPrevious?: number;
    /** Hidden. Per-company multiplier — spec §12.8 "企業特性と結び付ける". */
    companyImpactMultipliers: Record<string, number>;
}
