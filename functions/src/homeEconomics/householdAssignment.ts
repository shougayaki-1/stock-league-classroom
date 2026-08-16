import type { CourseFormat, HouseholdProfile } from '@stock-league/household-authoring-content'
import { idempotencyDocumentId, requestDigest } from '../lib/idempotency'

/** Spec §13.3's three advanced formats — COMMON_CONDITIONS has no per-team assignment (every team shares the single profile), so it is intentionally excluded from this narrower union. */
export type AdvancedHouseholdCourseFormat =
  | 'ROLE_VARIANT'
  | 'STAGE_SPLIT'
  | 'MULTI_PERSON_PER_TEAM'

export interface HouseholdAssignmentEntry {
  /** Opaque runtime id — see `runtimeHouseholdId`. Distinct per (teamId, slotKey) even when multiple teams/slots share the same source `profileId`. */
  householdId: string
  teamId: string
  /** The source `HouseholdProfile.householdId` from the template snapshot this entry was assigned from. */
  profileId: string
  /** Uniquely identifies this profile's slot within the team (e.g. its position, or the source profileId, when a team can hold more than one profile). */
  slotKey: string
  displayOrder: number
  assignmentSource: 'AUTO' | 'MANUAL'
}

export interface HouseholdAssignmentWarning {
  code: string
  message: string
}

export interface HouseholdAssignmentValidation {
  status: 'READY' | 'INVALID'
  warnings: HouseholdAssignmentWarning[]
}

/** A Firestore-safe, stable, opaque id for a team's runtime household instance — never a bare profileId, so the same source profile assigned to multiple teams (ROLE_VARIANT wrap-around, MULTI_PERSON_PER_TEAM) never collides across teams. */
export const runtimeHouseholdId = (
  lessonRunId: string,
  teamId: string,
  slotKey: string,
): string => idempotencyDocumentId(lessonRunId, `household:${teamId}:${slotKey}`)

const sortedTeamIds = (teamIds: string[]): string[] => [...teamIds].sort()

/** Distinct `lifeStage` values from a profile snapshot, in order of first occurrence. Exported for reuse by `getHomeEconomicsContentWarnings()` in templateValidation.ts. */
export const distinctLifeStagesInOrder = (profiles: HouseholdProfile[]): string[] => {
  const seen = new Set<string>()
  const stages: string[] = []
  for (const profile of profiles) {
    if (!seen.has(profile.lifeStage)) {
      seen.add(profile.lifeStage)
      stages.push(profile.lifeStage)
    }
  }
  return stages
}

const profilesByLifeStage = (profiles: HouseholdProfile[]): Map<string, HouseholdProfile[]> => {
  const map = new Map<string, HouseholdProfile[]>()
  for (const profile of profiles) {
    const list = map.get(profile.lifeStage)
    if (list) list.push(profile)
    else map.set(profile.lifeStage, [profile])
  }
  return map
}

const makeEntry = (
  lessonRunId: string,
  teamId: string,
  profile: HouseholdProfile,
  slotKey: string,
  displayOrder: number,
): HouseholdAssignmentEntry => ({
  householdId: runtimeHouseholdId(lessonRunId, teamId, slotKey),
  teamId,
  profileId: profile.householdId,
  slotKey,
  displayOrder,
  assignmentSource: 'AUTO',
})

/** Round-robins the profile snapshot (in array order) across teams sorted by teamId ascending. Deterministic regardless of the caller's team array order. */
const buildRoleVariantEntries = (
  lessonRunId: string,
  teamIds: string[],
  profiles: HouseholdProfile[],
): HouseholdAssignmentEntry[] => {
  if (profiles.length === 0) return []
  return sortedTeamIds(teamIds).map((teamId, index) => {
    const profile = profiles[index % profiles.length]
    return makeEntry(lessonRunId, teamId, profile, profile.householdId, index)
  })
}

/**
 * Assigns each team (sorted ascending) to a distinct lifeStage in round-robin
 * order, so every distinct stage receives one team before any stage receives
 * a second (spec intent: no stage is left teamless while another stage has
 * two teams). Once every stage has had a turn, extra teams cycle back
 * through the stages, and within each stage the profile chosen also
 * round-robins so repeated visits to the same stage rotate through its
 * profiles instead of always picking the first one.
 */
const buildStageSplitEntries = (
  lessonRunId: string,
  teamIds: string[],
  profiles: HouseholdProfile[],
): HouseholdAssignmentEntry[] => {
  if (profiles.length === 0) return []
  const stages = distinctLifeStagesInOrder(profiles)
  if (stages.length === 0) return []
  const byStage = profilesByLifeStage(profiles)
  const stageOccurrence = new Map<string, number>()

  return sortedTeamIds(teamIds).map((teamId, index) => {
    const stage = stages[index % stages.length]
    const stageProfiles = byStage.get(stage) ?? []
    const occurrence = stageOccurrence.get(stage) ?? 0
    stageOccurrence.set(stage, occurrence + 1)
    const profile = stageProfiles[occurrence % stageProfiles.length]
    return makeEntry(lessonRunId, teamId, profile, profile.householdId, index)
  })
}

/** Every team gets the complete profile snapshot (in array order), each profile keyed by its index so a team can hold more than one profile without slotKey collisions. */
const buildMultiPersonEntries = (
  lessonRunId: string,
  teamIds: string[],
  profiles: HouseholdProfile[],
): HouseholdAssignmentEntry[] => {
  const entries: HouseholdAssignmentEntry[] = []
  let displayOrder = 0
  for (const teamId of sortedTeamIds(teamIds)) {
    for (const [profileIndex, profile] of profiles.entries()) {
      const slotKey = `${profileIndex}:${profile.householdId}`
      entries.push(makeEntry(lessonRunId, teamId, profile, slotKey, displayOrder))
      displayOrder += 1
    }
  }
  return entries
}

export const buildDefaultHouseholdAssignmentEntries = (input: {
  lessonRunId: string
  courseFormat: CourseFormat
  teamIds: string[]
  profiles: HouseholdProfile[]
}): HouseholdAssignmentEntry[] => {
  const { lessonRunId, courseFormat, teamIds, profiles } = input
  switch (courseFormat) {
    case 'ROLE_VARIANT':
      return buildRoleVariantEntries(lessonRunId, teamIds, profiles)
    case 'STAGE_SPLIT':
      return buildStageSplitEntries(lessonRunId, teamIds, profiles)
    case 'MULTI_PERSON_PER_TEAM':
      return buildMultiPersonEntries(lessonRunId, teamIds, profiles)
    case 'COMMON_CONDITIONS':
      // COMMON_CONDITIONS shares the single profile identically across all
      // teams outside this per-team assignment mechanism (see
      // commonConditionsHousehold.ts) — nothing to assign here.
      return []
    default:
      return []
  }
}

export const validateHouseholdAssignmentEntries = (input: {
  courseFormat: CourseFormat
  teamIds: string[]
  profiles: HouseholdProfile[]
  entries: HouseholdAssignmentEntry[]
}): HouseholdAssignmentValidation => {
  const { courseFormat, teamIds, profiles, entries } = input
  const warnings: HouseholdAssignmentWarning[] = []

  if (profiles.length === 0) {
    warnings.push({
      code: 'NO_HOUSEHOLD_PROFILES',
      message: '担当プロフィールが1件も設定されていません。',
    })
  }

  if (teamIds.length === 0) {
    warnings.push({
      code: 'NO_TEAMS',
      message: 'チームが1件も設定されていません。',
    })
  }

  if (courseFormat === 'MULTI_PERSON_PER_TEAM' && profiles.length < 2) {
    warnings.push({
      code: 'MULTI_PERSON_PER_TEAM_REQUIRES_MULTIPLE_PROFILES',
      message: '複数人同時プレイモードでは担当プロフィールを2件以上設定してください。',
    })
  }

  if (courseFormat === 'STAGE_SPLIT' && profiles.length > 0) {
    const stageCount = distinctLifeStagesInOrder(profiles).length
    if (teamIds.length < stageCount) {
      warnings.push({
        code: 'STAGE_SPLIT_INSUFFICIENT_TEAMS',
        message: `ライフステージ別モードには、ライフステージ数（${stageCount}）以上のチーム数が必要です（現在のチーム数: ${teamIds.length}）。`,
      })
    }
  }

  const expectedEntryCount = courseFormat === 'MULTI_PERSON_PER_TEAM'
    ? teamIds.length * profiles.length
    : teamIds.length
  if (profiles.length > 0 && teamIds.length > 0 && entries.length !== expectedEntryCount) {
    warnings.push({
      code: 'ENTRY_COUNT_MISMATCH',
      message: `割り当て件数（${entries.length}）が期待される件数（${expectedEntryCount}）と一致しません。`,
    })
  }

  return {
    status: warnings.length === 0 ? 'READY' : 'INVALID',
    warnings,
  }
}

export const teamSetFingerprint = (teamIds: string[]): string =>
  requestDigest([...teamIds].sort())
