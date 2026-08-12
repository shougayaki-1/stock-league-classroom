import { describe, expect, it, vi } from 'vitest'
import {
  MIGRATION_RESERVATION_PAGE_SIZE,
  migrateSchoolFromEndedParent,
  type ParentContractMigrationDeps,
  type ParentContractMigrationPreconditions,
  type ParentContractReservation,
} from './parentContractMigration'

const endedParent = { type: 'parentOrg', parentContractState: 'ENDED' }
const activeSchool = {
  type: 'school',
  parentOrgId: 'parent-1',
  stripeSubscriptionState: { subscriptionId: 'sub-school-1', status: 'active', eventCreatedAtMillis: 100 },
}

const makePreconditions = (overrides: Partial<ParentContractMigrationPreconditions> = {}): ParentContractMigrationPreconditions => ({
  parentOrgId: 'parent-1',
  parent: endedParent,
  school: activeSchool,
  ...overrides,
})

const makeDeps = (overrides: Partial<ParentContractMigrationDeps> = {}): ParentContractMigrationDeps => ({
  readMigrationPreconditions: vi.fn(async () => makePreconditions()),
  listReservationPage: vi.fn(async () => [] as ParentContractReservation[]),
  deleteReservationPage: vi.fn(async () => undefined),
  finalizeMigration: vi.fn(async () => undefined),
  ...overrides,
})

describe('migrateSchoolFromEndedParent', () => {
  it.each([
    ['not linked', makePreconditions({ parentOrgId: null }), 'この学校はどの上位組織にも所属していません'],
    ['parent not ended', makePreconditions({ parent: { type: 'parentOrg' } }), '親組織の契約が終了していないため移行できません'],
    ['school subscription is not latest active', makePreconditions({ school: { ...activeSchool, stripeSubscriptionState: { subscriptionId: 'sub-school-1', status: 'canceled' } } }), '学校の有効なStripe契約が確認できないため移行できません'],
    ['school subscription id is missing', makePreconditions({ school: { ...activeSchool, stripeSubscriptionState: { status: 'active' } } }), '学校の有効なStripe契約が確認できないため移行できません'],
    ['parent link changed before migration', makePreconditions({ school: { ...activeSchool, parentOrgId: 'parent-2' } }), '学校の所属先が変更されたため移行できません'],
  ] as const)('rejects %s before deleting reservations', async (_name, preconditions, message) => {
    const deps = makeDeps({ readMigrationPreconditions: vi.fn(async () => preconditions) })

    await expect(migrateSchoolFromEndedParent(deps, { schoolOrgId: 'school-1', actorUid: 'owner-1' }))
      .rejects.toThrow(message)
    expect(deps.listReservationPage).not.toHaveBeenCalled()
    expect(deps.deleteReservationPage).not.toHaveBeenCalled()
    expect(deps.finalizeMigration).not.toHaveBeenCalled()
  })

  it('leaves the school linked when a reservation page deletion fails', async () => {
    const reservations = [{ id: 'reservation-1' }]
    const deps = makeDeps({
      listReservationPage: vi.fn(async () => reservations),
      deleteReservationPage: vi.fn(async () => { throw new Error('batch failed') }),
    })

    await expect(migrateSchoolFromEndedParent(deps, { schoolOrgId: 'school-1', actorUid: 'owner-1' }))
      .rejects.toThrow('batch failed')
    expect(deps.finalizeMigration).not.toHaveBeenCalled()
  })

  it('deletes one full page and asks the caller to retry without finalizing', async () => {
    const reservations = Array.from({ length: MIGRATION_RESERVATION_PAGE_SIZE }, (_, index) => ({ id: `reservation-${index}` }))
    const deleteReservationPage = vi.fn(async () => undefined)
    const deps = makeDeps({
      listReservationPage: vi.fn(async (_parentOrgId, _schoolOrgId, limit) => {
        expect(limit).toBe(MIGRATION_RESERVATION_PAGE_SIZE)
        return reservations
      }),
      deleteReservationPage,
    })

    await expect(migrateSchoolFromEndedParent(deps, { schoolOrgId: 'school-1', actorUid: 'owner-1' }))
      .resolves.toEqual({ status: 'RETRY_REQUIRED', deletedReservationCount: MIGRATION_RESERVATION_PAGE_SIZE })
    expect(deleteReservationPage).toHaveBeenCalledWith('parent-1', 'school-1', reservations)
    expect(deps.finalizeMigration).not.toHaveBeenCalled()
  })

  it('retries from the first remaining page and finalizes after the last page is deleted', async () => {
    const firstPage = Array.from({ length: MIGRATION_RESERVATION_PAGE_SIZE }, (_, index) => ({ id: `first-${index}` }))
    const lastPage = [{ id: 'last-1' }]
    const listReservationPage = vi.fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(lastPage)
    const deleteReservationPage = vi.fn(async () => undefined)
    const finalizeMigration = vi.fn(async () => undefined)
    const deps = makeDeps({ listReservationPage, deleteReservationPage, finalizeMigration })

    await expect(migrateSchoolFromEndedParent(deps, { schoolOrgId: 'school-1', actorUid: 'owner-1' }))
      .resolves.toEqual({ status: 'RETRY_REQUIRED', deletedReservationCount: MIGRATION_RESERVATION_PAGE_SIZE })
    await expect(migrateSchoolFromEndedParent(deps, { schoolOrgId: 'school-1', actorUid: 'owner-1' }))
      .resolves.toEqual({ status: 'MIGRATED', parentOrgId: 'parent-1' })

    expect(listReservationPage).toHaveBeenCalledTimes(2)
    expect(deleteReservationPage).toHaveBeenNthCalledWith(1, 'parent-1', 'school-1', firstPage)
    expect(deleteReservationPage).toHaveBeenNthCalledWith(2, 'parent-1', 'school-1', lastPage)
    expect(finalizeMigration).toHaveBeenCalledWith({
      parentOrgId: 'parent-1',
      schoolOrgId: 'school-1',
      migratedByUid: 'owner-1',
      schoolSubscriptionId: 'sub-school-1',
    })
  })
})
