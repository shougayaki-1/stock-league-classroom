import { DEFAULT_NOISE_MAGNITUDE_PERCENT, DEFAULT_SUDDEN_CHANGE_WARNING_THRESHOLD_PERCENT, PRICE_SENSITIVITY_PRESETS } from '../market/engine/priceCalculation'
import { SHORT_TERM_WINDOW_BATCHES } from '../market/engine/informationImpact'
import { FLAT_BAND_PERCENT } from '../market/predictionCheckpoint'
import { STALL_DETECTION_THRESHOLD_MILLIS } from '../market/chainWatchdog'
import { TAX_MODEL_V1_RATE_PERCENT } from '../homeEconomics/engine/taxAndSocialInsurance'
import { EMERGENCY_FUND_TARGET_MONTHS } from '../homeEconomics/evaluation'
import { PENSION_REPLACEMENT_RATE_PERCENT_PROVISIONAL_DEFAULT } from '../homeEconomics/engine/retirement'

export interface TuningConstantsResponse {
  socialStudies: {
    priceSensitivityPresets: Record<'INFO_FOCUSED' | 'BALANCED' | 'DEMAND_FOCUSED', { informationWeight: number; demandWeight: number }>
    defaultNoiseMagnitudePercent: number
    defaultSuddenChangeWarningThresholdPercent: number
    shortTermWindowBatches: number
    flatBandPercent: number
    stallDetectionThresholdMillis: number
  }
  homeEconomics: {
    taxModelV1RatePercent: number
    emergencyFundTargetMonths: number
    pensionReplacementRatePercentProvisionalDefault: number
  }
}

/** Read-only projection of the Phase C/D engine constants for teacher reference. */
export const buildTuningConstantsResponse = (): TuningConstantsResponse => ({
  socialStudies: {
    priceSensitivityPresets: PRICE_SENSITIVITY_PRESETS,
    defaultNoiseMagnitudePercent: DEFAULT_NOISE_MAGNITUDE_PERCENT,
    defaultSuddenChangeWarningThresholdPercent: DEFAULT_SUDDEN_CHANGE_WARNING_THRESHOLD_PERCENT,
    shortTermWindowBatches: SHORT_TERM_WINDOW_BATCHES,
    flatBandPercent: FLAT_BAND_PERCENT,
    stallDetectionThresholdMillis: STALL_DETECTION_THRESHOLD_MILLIS,
  },
  homeEconomics: {
    taxModelV1RatePercent: TAX_MODEL_V1_RATE_PERCENT,
    emergencyFundTargetMonths: EMERGENCY_FUND_TARGET_MONTHS,
    pensionReplacementRatePercentProvisionalDefault: PENSION_REPLACEMENT_RATE_PERCENT_PROVISIONAL_DEFAULT,
  },
})
