import { describe, expect, it } from 'vitest'
import { buildTuningConstantsResponse } from './tuningConstantsResponse'
import { DEFAULT_NOISE_MAGNITUDE_PERCENT, DEFAULT_SUDDEN_CHANGE_WARNING_THRESHOLD_PERCENT, PRICE_SENSITIVITY_PRESETS } from '../market/engine/priceCalculation'
import { SHORT_TERM_WINDOW_BATCHES } from '../market/engine/informationImpact'
import { FLAT_BAND_PERCENT } from '../market/predictionCheckpoint'
import { STALL_DETECTION_THRESHOLD_MILLIS } from '../market/chainWatchdog'
import { TAX_MODEL_V1_RATE_PERCENT } from '../homeEconomics/engine/taxAndSocialInsurance'
import { EMERGENCY_FUND_TARGET_MONTHS } from '../homeEconomics/evaluation'
import { PENSION_REPLACEMENT_RATE_PERCENT_PROVISIONAL_DEFAULT } from '../homeEconomics/engine/retirement'

describe('buildTuningConstantsResponse', () => {
  it('mirrors every current source constant without hardcoding a snapshot', () => {
    const response = buildTuningConstantsResponse()
    expect(response.socialStudies.priceSensitivityPresets).toEqual(PRICE_SENSITIVITY_PRESETS)
    expect(response.socialStudies.defaultNoiseMagnitudePercent).toBe(DEFAULT_NOISE_MAGNITUDE_PERCENT)
    expect(response.socialStudies.defaultSuddenChangeWarningThresholdPercent).toBe(DEFAULT_SUDDEN_CHANGE_WARNING_THRESHOLD_PERCENT)
    expect(response.socialStudies.shortTermWindowBatches).toBe(SHORT_TERM_WINDOW_BATCHES)
    expect(response.socialStudies.flatBandPercent).toBe(FLAT_BAND_PERCENT)
    expect(response.socialStudies.stallDetectionThresholdMillis).toBe(STALL_DETECTION_THRESHOLD_MILLIS)
    expect(response.homeEconomics.taxModelV1RatePercent).toBe(TAX_MODEL_V1_RATE_PERCENT)
    expect(response.homeEconomics.emergencyFundTargetMonths).toBe(EMERGENCY_FUND_TARGET_MONTHS)
    expect(response.homeEconomics.pensionReplacementRatePercentProvisionalDefault).toBe(PENSION_REPLACEMENT_RATE_PERCENT_PROVISIONAL_DEFAULT)
  })

  it('returns JSON-serializable data', () => {
    const response = buildTuningConstantsResponse()
    expect(JSON.parse(JSON.stringify(response))).toEqual(response)
  })
})
