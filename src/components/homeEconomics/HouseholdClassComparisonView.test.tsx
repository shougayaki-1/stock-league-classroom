import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HouseholdClassComparisonView } from './HouseholdClassComparisonView'
import type { HouseholdClassComparisonPublicView } from '../../lib/lessonRuns/liveTypes'

const comparison: HouseholdClassComparisonPublicView = {
  courseFormat: 'ROLE_VARIANT',
  finalRoundCount: 4,
  publishedAtMillis: 9000,
  teams: [
    {
      teamDisplayName: 'チームA',
      households: [
        {
          profileId: 'profile-parent',
          profile: {
            householdId: 'profile-parent',
            age: 40,
            householdIncomeYen: 5000000,
            annualLivingExpensesYen: 3000000,
            cashSavingsYen: 1000000,
            family: '夫婦+子2人',
            housing: '賃貸',
            lifeGoal: '住宅購入',
            lifeStage: 'CHILD_REARING',
            isFictional: true,
          },
          cashYen: 1200000,
          totalAssetsYen: 3400000,
          totalLiabilitiesYen: 500000,
          goalDelayedRounds: 1,
          lifeGoalAchievementScore: 72,
        },
      ],
    },
  ],
}

describe('HouseholdClassComparisonView', () => {
  it('renders team display names and each household safe value, translating lifeStage・family into human-readable copy (rendering test)', () => {
    render(<HouseholdClassComparisonView comparison={comparison} />)

    expect(screen.getByText('チームA')).toBeInTheDocument()
    expect(screen.getByText('子育て期・夫婦+子2人')).toBeInTheDocument()
    expect(screen.getByText(/1,200,000円/)).toBeInTheDocument()
    expect(screen.getByText(/3,400,000円/)).toBeInTheDocument()
    expect(screen.getByText(/500,000円/)).toBeInTheDocument()
    expect(screen.getByText(/1回/)).toBeInTheDocument()
    expect(screen.getByText(/72/)).toBeInTheDocument()
    expect(screen.getByText(/全4ラウンド/)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('CHILD_REARING')
    expect(document.body.textContent).not.toContain('profile-parent')
  })

  it('never renders a member name or a runtime householdId (privacy test — this component only ever receives the already-safe server-projected view)', () => {
    // `profileId` ('profile-parent') is the logical TEMPLATE profile id, not
    // a runtime householdId — this test asserts no OTHER identity-shaped
    // value ever appears, i.e. this component renders nothing beyond the
    // named safe fields `HouseholdClassComparisonHouseholdView` allow-lists.
    const contaminated = {
      ...comparison,
      teams: [
        {
          ...comparison.teams[0]!,
          households: [
            {
              ...comparison.teams[0]!.households[0]!,
              // Simulates what would leak if this component ever spread an
              // unsanitized object instead of destructuring named fields.
              ...({ memberName: '山田太郎', runtimeHouseholdId: 'runtime-secret-id-123' } as unknown as Record<string, never>),
            },
          ],
        },
      ],
    } as unknown as HouseholdClassComparisonPublicView

    render(<HouseholdClassComparisonView comparison={contaminated} />)

    const dom = document.body.textContent ?? ''
    expect(dom).not.toContain('山田太郎')
    expect(dom).not.toContain('runtime-secret-id-123')
  })

  it('renders every team and every household within it', () => {
    const multi: HouseholdClassComparisonPublicView = {
      ...comparison,
      teams: [
        comparison.teams[0]!,
        {
          teamDisplayName: 'チームB',
          households: [
            {
              ...comparison.teams[0]!.households[0]!,
              profileId: 'profile-single',
              profile: { ...comparison.teams[0]!.households[0]!.profile, lifeStage: 'INDEPENDENT', family: '独身' },
            },
          ],
        },
      ],
    }
    render(<HouseholdClassComparisonView comparison={multi} />)
    expect(screen.getByText('チームA')).toBeInTheDocument()
    expect(screen.getByText('チームB')).toBeInTheDocument()
    expect(screen.getByText('独立期・独身')).toBeInTheDocument()
  })

  it('fails closed — and never echoes the raw sentinel token or the profileId — when a household carries an unknown backend lifeStage', () => {
    const unknownStage: HouseholdClassComparisonPublicView = {
      ...comparison,
      teams: [
        {
          teamDisplayName: 'チームC',
          households: [
            {
              ...comparison.teams[0]!.households[0]!,
              profileId: 'profile-unknown',
              profile: { ...comparison.teams[0]!.households[0]!.profile, lifeStage: 'UNKNOWN_COMPARISON_STAGE', family: '夫婦+子2人' },
            },
          ],
        },
      ],
    }
    render(<HouseholdClassComparisonView comparison={unknownStage} />)
    expect(screen.getByText('ライフステージを確認できません・夫婦+子2人')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('UNKNOWN_COMPARISON_STAGE')
    expect(document.body.textContent).not.toContain('profile-unknown')
  })
})
