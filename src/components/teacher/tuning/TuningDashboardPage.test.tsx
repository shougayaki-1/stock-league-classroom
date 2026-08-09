import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TuningDashboardPage } from './TuningDashboardPage'
import type { TuningConstantsResponse } from '../../../lib/platformConfig/getTuningConstants'

const data: TuningConstantsResponse = { socialStudies: { priceSensitivityPresets: { INFO_FOCUSED: { informationWeight: .7, demandWeight: .3 }, BALANCED: { informationWeight: .5, demandWeight: .5 }, DEMAND_FOCUSED: { informationWeight: .3, demandWeight: .7 } }, defaultNoiseMagnitudePercent: .35, defaultSuddenChangeWarningThresholdPercent: 7, shortTermWindowBatches: 10, flatBandPercent: .5, stallDetectionThresholdMillis: 60000 }, homeEconomics: { taxModelV1RatePercent: 20, emergencyFundTargetMonths: 6, pensionReplacementRatePercentProvisionalDefault: 50 } }

describe('TuningDashboardPage', () => {
  it('shows loading and error states', () => {
    const { rerender } = render(<TuningDashboardPage data={undefined} error={undefined} />)
    expect(screen.getByLabelText('読み込み中')).toBeInTheDocument()
    rerender(<TuningDashboardPage data={undefined} error="failed" />)
    expect(screen.getByText('読み込みに失敗しました')).toBeInTheDocument()
  })

  it('displays both subjects as read-only reference tables', () => {
    render(<TuningDashboardPage data={data} error={undefined} />)
    expect(screen.getByText('0.35')).toBeInTheDocument()
    expect(screen.getByText(/変更するにはソースコードの編集と再デプロイが必要です/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '家庭科' }))
    expect(screen.getByText('20')).toBeInTheDocument()
  })
})
