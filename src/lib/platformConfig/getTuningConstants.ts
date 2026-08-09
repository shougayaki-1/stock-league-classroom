import { httpsCallable, type Functions } from 'firebase/functions'

/** Client mirror of functions/src/platformConfig/tuningConstantsResponse.ts. */
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

export const getTuningConstants = async (functions: Functions): Promise<TuningConstantsResponse> => {
  const call = httpsCallable<void, TuningConstantsResponse>(functions, 'getTuningConstantsCallable')
  return (await call()).data
}
