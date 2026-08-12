import { parentContractStateFrom } from './parentContract'

export const MIGRATION_RESERVATION_PAGE_SIZE = 400

export interface ParentContractReservation { id: string }
export interface ParentContractMigrationPreconditions {
  parentOrgId: string | null
  parent: Record<string, unknown> | null
  school: Record<string, unknown> | null
}
export interface ParentContractMigrationDeps {
  readMigrationPreconditions: (schoolOrgId: string) => Promise<ParentContractMigrationPreconditions>
  listReservationPage: (parentOrgId: string, schoolOrgId: string, limit: number) => Promise<ParentContractReservation[]>
  deleteReservationPage: (parentOrgId: string, schoolOrgId: string, reservations: ParentContractReservation[]) => Promise<void>
  finalizeMigration: (input: { parentOrgId: string; schoolOrgId: string; migratedByUid: string; schoolSubscriptionId: string }) => Promise<void>
}
export type ParentContractMigrationResult =
  | { status: 'MIGRATED'; parentOrgId: string }
  | { status: 'RETRY_REQUIRED'; deletedReservationCount: number }

export const migrateSchoolFromEndedParent = async (
  deps: ParentContractMigrationDeps,
  input: { schoolOrgId: string; actorUid: string },
): Promise<ParentContractMigrationResult> => {
  const { parentOrgId, parent, school } = await deps.readMigrationPreconditions(input.schoolOrgId)
  if (!parentOrgId || !school?.parentOrgId) throw new Error('この学校はどの上位組織にも所属していません')
  if (school.parentOrgId !== parentOrgId) throw new Error('学校の所属先が変更されたため移行できません')
  if (!parent || parentContractStateFrom(parent) !== 'ENDED') throw new Error('親組織の契約が終了していないため移行できません')
  const subscription = school.stripeSubscriptionState as { subscriptionId?: unknown; status?: unknown } | undefined
  if (subscription?.status !== 'active' || typeof subscription.subscriptionId !== 'string') {
    throw new Error('学校の有効なStripe契約が確認できないため移行できません')
  }
  const reservations = await deps.listReservationPage(parentOrgId, input.schoolOrgId, MIGRATION_RESERVATION_PAGE_SIZE)
  if (reservations.length > 0) await deps.deleteReservationPage(parentOrgId, input.schoolOrgId, reservations)
  if (reservations.length === MIGRATION_RESERVATION_PAGE_SIZE) {
    return { status: 'RETRY_REQUIRED', deletedReservationCount: reservations.length }
  }
  await deps.finalizeMigration({ parentOrgId, schoolOrgId: input.schoolOrgId, migratedByUid: input.actorUid, schoolSubscriptionId: subscription.subscriptionId })
  return { status: 'MIGRATED', parentOrgId }
}
