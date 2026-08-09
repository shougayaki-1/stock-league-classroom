import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { getTuningConstants } from './getTuningConstants'

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

describe('getTuningConstants', () => {
  it('calls getTuningConstantsCallable and returns its response data', async () => {
    const data = { socialStudies: { priceSensitivityPresets: {}, defaultNoiseMagnitudePercent: .35, defaultSuddenChangeWarningThresholdPercent: 7, shortTermWindowBatches: 10, flatBandPercent: .5, stallDetectionThresholdMillis: 60000 }, homeEconomics: { taxModelV1RatePercent: 20, emergencyFundTargetMonths: 6, pensionReplacementRatePercentProvisionalDefault: 50 } }
    const call = vi.fn().mockResolvedValue({ data })
    vi.mocked(httpsCallable).mockReturnValue(call as never)
    await expect(getTuningConstants({} as never)).resolves.toEqual(data)
    expect(httpsCallable).toHaveBeenCalledWith({}, 'getTuningConstantsCallable')
  })
})
