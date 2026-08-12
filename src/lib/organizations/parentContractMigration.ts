import { httpsCallable, type Functions } from 'firebase/functions'

export interface MigrateSchoolFromEndedParentInput { schoolOrgId: string }

export type ParentContractMigrationResult =
  | { status: 'MIGRATED'; parentOrgId: string }
  | { status: 'RETRY_REQUIRED'; deletedReservationCount: number }

export const migrateSchoolFromEndedParent = async (
  functions: Functions,
  input: MigrateSchoolFromEndedParentInput,
): Promise<ParentContractMigrationResult> => (
  await httpsCallable<MigrateSchoolFromEndedParentInput, ParentContractMigrationResult>(functions, 'migrateSchoolFromEndedParentCallable')(input)
).data
