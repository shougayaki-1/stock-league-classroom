import { Chip, Stack, Typography } from '@mui/material'
import type { RankingConfig, SingleChoiceConfig } from '@stock-league/lesson-inputs'
import { StudentSurfaceCard } from '../ui/StudentUi'
import { RankingInput } from '../lessonInputs/RankingInput'
import { SingleChoiceInput } from '../lessonInputs/SingleChoiceInput'
import {
  formatHouseholdAssetType,
  formatHouseholdConcept,
  formatHouseholdLifeStage,
  HOUSEHOLD_ASSET_TYPE_LABELS,
} from '../../lib/presentation/householdLabels'

/** Fixed display order, independent of the (unordered) `visibleConcepts` array the caller passes in. */
const CONCEPT_ORDER = ['EMERGENCY_FUND', 'HOUSING', 'EDUCATION_FUND', 'RETIREMENT_PLANNING', 'ASSET_DIVERSIFICATION', 'INSURANCE', 'RISK_MANAGEMENT']

const isKnownAssetType = (value: string): value is keyof typeof HOUSEHOLD_ASSET_TYPE_LABELS =>
  Object.prototype.hasOwnProperty.call(HOUSEHOLD_ASSET_TYPE_LABELS, value)

export interface HouseholdEventDisclosureView {
  eventId: string
  label: string | null
  effectDescription: string | null
  revealed: boolean
}

export interface HouseholdShortfallOption {
  type: string
  description: string
  resolvesYen: number
}

export interface HouseholdSummaryCardProps {
  householdId: string
  /** Human-readable heading (e.g. `${lifeStage}・${family}`), built by the caller via `formatHouseholdProfileLabel`. The sole heading source — never falls back to the opaque `householdId`. */
  profileLabel: string
  cashYen: number
  lifeStage: string
  roundIndex: number
  /** `ConceptCategory[]` (spec §13.16) — a concept absent from this list is never rendered, not merely hidden by CSS. */
  visibleConcepts: string[]
  /** assetType → current value. Present only when `ASSET_DIVERSIFICATION` is visible does this render an allocation-priority `RankingInput`. */
  assetHoldingsYen?: Record<string, number>
  /** This round's already-disclosed life events (Task 7's `buildEventDisclosureView`) — undisclosed events never appear here at all. */
  eventDisclosures?: HouseholdEventDisclosureView[]
  /** This round's available shortfall-resolution choices (Task 8's `buildShortfallOptions`) — absent/empty when there is no shortfall to resolve. */
  shortfallOptions?: HouseholdShortfallOption[]
  shortfallResolutionValue?: string
  onShortfallResolutionChange?: (value: string) => void
  /**
   * Critical Fix #2 (final whole-branch review): required whenever
   * `shortfallResolutionValue === 'SELL_ASSETS'` — `onCall.ts`'s
   * `submitHouseholdDecisionCallable` rejects a SELL_ASSETS submission with
   * `invalid-argument` unless a non-empty `shortfallResolutionAssetType` is
   * also sent. Which asset to name is picked from this household's
   * currently-held asset types (`assetHoldingsYen`'s own keys), not from a
   * separate catalog.
   */
  shortfallResolutionAssetType?: string
  onShortfallResolutionAssetTypeChange?: (assetType: string) => void
  assetAllocationOrder?: string[]
  onAssetAllocationOrderChange?: (order: string[]) => void
}

const yenFormatter = new Intl.NumberFormat('ja-JP')

/**
 * Student-facing "この家庭の今の状態" card (Task 15) — a thin presentational
 * shell over Task 14's `visibleConcepts` filter and Task 7/8's disclosure/
 * shortfall views, consuming the allow-listed `HouseholdStateTeamView`
 * fields broadcast on `lessonRunTeamState/{lessonRunId}/{teamId}`
 * (`src/lib/lessonRuns/liveTypes.ts`). No new home-economics-specific input
 * widget is created here — asset-allocation priority reuses `RankingInput`
 * and the shortfall choice reuses `SingleChoiceInput`, both from the
 * existing `@stock-league/lesson-inputs`-typed widget set (Phase B Task 6),
 * per this task's Global Constraints.
 *
 * §13.4/§23.6: the "これは授業用の架空プロフィールです" notice is rendered
 * unconditionally — every household is a fictional teaching profile, and
 * this card must never display (or let a caller pass in) a real student's
 * name.
 */
export function HouseholdSummaryCard({
  householdId,
  profileLabel,
  cashYen,
  lifeStage,
  roundIndex,
  visibleConcepts,
  assetHoldingsYen,
  eventDisclosures,
  shortfallOptions,
  shortfallResolutionValue,
  onShortfallResolutionChange,
  shortfallResolutionAssetType,
  onShortfallResolutionAssetTypeChange,
  assetAllocationOrder,
  onAssetAllocationOrderChange,
}: HouseholdSummaryCardProps) {
  const visibleSet = new Set(visibleConcepts)
  const orderedVisibleConcepts = CONCEPT_ORDER.filter((concept) => visibleSet.has(concept))
  const hasUnknownVisibleConcept = visibleConcepts.some((concept) => !CONCEPT_ORDER.includes(concept))

  const rawAssetTypes = assetHoldingsYen ? Object.keys(assetHoldingsYen) : []
  const knownAssetTypes = rawAssetTypes.filter(isKnownAssetType)
  const hasUnknownAssetType = rawAssetTypes.some((value) => !isKnownAssetType(value))
  const assetLabelByValue = new Map<string, string>(
    knownAssetTypes.map((value) => [value, formatHouseholdAssetType(value)] as const),
  )
  const assetValueByLabel = new Map<string, string>(
    knownAssetTypes.map((value) => [formatHouseholdAssetType(value), value] as const),
  )
  const assetLabels = knownAssetTypes.map((value) => assetLabelByValue.get(value) as string)

  const showAssetAllocation = visibleSet.has('ASSET_DIVERSIFICATION') && knownAssetTypes.length > 0
  const rankingConfig: RankingConfig = { type: 'RANKING', items: assetLabels }
  const assetAllocationOrderLabels = (assetAllocationOrder ?? [])
    .filter(isKnownAssetType)
    .map((value) => assetLabelByValue.get(value) as string)
  const shortfallConfig: SingleChoiceConfig = { type: 'SINGLE_CHOICE', options: (shortfallOptions ?? []).map((option) => option.description) }
  const descriptionByChoice = new Map((shortfallOptions ?? []).map((option) => [option.description, option]))
  const selectedShortfallDescription = (shortfallOptions ?? []).find((option) => option.type === shortfallResolutionValue)?.description
  const revealedEvents = (eventDisclosures ?? []).filter((event) => event.revealed)
  // Critical Fix #2: which asset to sell is picked from this household's
  // currently-held asset types, revealed only once SELL_ASSETS is the
  // selected shortfall resolution — never shown for any other resolution
  // type, and never shown when there is nothing held to sell.
  const showAssetSalePicker = shortfallResolutionValue === 'SELL_ASSETS' && knownAssetTypes.length > 0
  const assetSaleConfig: SingleChoiceConfig = { type: 'SINGLE_CHOICE', options: assetLabels }
  const selectedAssetSaleLabel = shortfallResolutionAssetType
    ? assetLabelByValue.get(shortfallResolutionAssetType)
    : undefined

  return (
    <StudentSurfaceCard>
      <Stack spacing={1.5}>
        <Chip
          label="これは授業用の架空プロフィールです"
          color="info"
          variant="outlined"
          sx={{ alignSelf: 'flex-start', fontWeight: 700 }}
        />
        <Typography variant="h6" sx={{ fontWeight: 700 }}>{profileLabel}</Typography>
        <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
          <Typography variant="body2">現在の貯蓄: {yenFormatter.format(cashYen)}円</Typography>
          <Typography variant="body2">ライフステージ: {formatHouseholdLifeStage(lifeStage)}</Typography>
          <Typography variant="body2">第{roundIndex + 1}ラウンド</Typography>
        </Stack>

        {(orderedVisibleConcepts.length > 0 || hasUnknownVisibleConcept) && (
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            {orderedVisibleConcepts.map((concept) => (
              <Chip key={concept} label={formatHouseholdConcept(concept)} size="small" />
            ))}
            {hasUnknownVisibleConcept && (
              <Chip label="学習項目を確認できません" size="small" />
            )}
          </Stack>
        )}

        {hasUnknownAssetType && (
          <Typography variant="body2" color="text.secondary">一部の資産種別を確認できません。</Typography>
        )}

        {revealedEvents.length > 0 && (
          <Stack spacing={0.5}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>今回のできごと</Typography>
            {revealedEvents.map((event) => (
              <Typography key={event.eventId} variant="body2">
                {event.label}{event.effectDescription ? `: ${event.effectDescription}` : ''}
              </Typography>
            ))}
          </Stack>
        )}

        {showAssetAllocation && (
          <RankingInput
            id={`${householdId}-asset-allocation`}
            label="資産配分の優先順位"
            config={rankingConfig}
            value={assetAllocationOrderLabels}
            errors={[]}
            onChange={(labels) => onAssetAllocationOrderChange?.(
              labels.map((label) => assetValueByLabel.get(label)).filter((v): v is string => Boolean(v)),
            )}
          />
        )}

        {shortfallOptions && shortfallOptions.length > 0 && (
          <SingleChoiceInput
            id={`${householdId}-shortfall-resolution`}
            label="資金が不足しています。どう対応しますか？"
            config={shortfallConfig}
            value={selectedShortfallDescription}
            errors={[]}
            onChange={(description) => {
              const option = descriptionByChoice.get(description)
              if (option) onShortfallResolutionChange?.(option.type)
            }}
          />
        )}

        {showAssetSalePicker && (
          <SingleChoiceInput
            id={`${householdId}-shortfall-sell-asset`}
            label="売却する資産を選んでください"
            config={assetSaleConfig}
            value={selectedAssetSaleLabel}
            errors={[]}
            onChange={(label) => {
              const assetType = assetValueByLabel.get(label)
              if (assetType) onShortfallResolutionAssetTypeChange?.(assetType)
            }}
          />
        )}
      </Stack>
    </StudentSurfaceCard>
  )
}
