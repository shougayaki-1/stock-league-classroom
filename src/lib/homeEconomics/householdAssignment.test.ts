import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'

const callable = vi.fn()
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callable) }))

const { httpsCallable } = await import('firebase/functions')
const { getHouseholdAssignment, prepareHouseholdAssignment, updateHouseholdAssignment } = await import('./householdAssignment')

describe('householdAssignment (client)', () => {
  it('calls getHouseholdAssignmentCallable with params', async () => {
    const mockResult = {
      lessonRunId: 'run-1', courseFormat: 'ROLE_VARIANT', state: 'DRAFT', validationStatus: 'READY',
      assignmentRevision: 1, warnings: [], teams: [],
    }
    callable.mockResolvedValue({ data: mockResult })
    const functions = {} as Functions

    const input = { lessonRunId: 'run-1' }
    const result = await getHouseholdAssignment(functions, input)

    expect(httpsCallable).toHaveBeenCalledWith(functions, 'getHouseholdAssignmentCallable')
    expect(callable).toHaveBeenCalledWith(input)
    expect(result).toEqual(mockResult)
  })

  it('calls prepareHouseholdAssignmentCallable with params', async () => {
    const mockResult = {
      lessonRunId: 'run-1', courseFormat: 'ROLE_VARIANT', state: 'DRAFT', validationStatus: 'READY',
      assignmentRevision: 1, warnings: [], teams: [],
    }
    callable.mockResolvedValue({ data: mockResult })
    const functions = {} as Functions

    const input = { lessonRunId: 'run-1', idempotencyKey: 'key-1' }
    const result = await prepareHouseholdAssignment(functions, input)

    expect(httpsCallable).toHaveBeenCalledWith(functions, 'prepareHouseholdAssignmentCallable')
    expect(callable).toHaveBeenCalledWith(input)
    expect(result).toEqual(mockResult)
  })

  it('calls updateHouseholdAssignmentCallable with params', async () => {
    const mockResult = {
      lessonRunId: 'run-1', courseFormat: 'ROLE_VARIANT', state: 'DRAFT', validationStatus: 'READY',
      assignmentRevision: 2, warnings: [], teams: [],
    }
    callable.mockResolvedValue({ data: mockResult })
    const functions = {} as Functions

    const input = {
      lessonRunId: 'run-1',
      expectedRevision: 1,
      changes: [{ householdId: 'h-1', displayOrder: 3 }],
      idempotencyKey: 'key-2',
    }
    const result = await updateHouseholdAssignment(functions, input)

    expect(httpsCallable).toHaveBeenCalledWith(functions, 'updateHouseholdAssignmentCallable')
    expect(callable).toHaveBeenCalledWith(input)
    expect(result).toEqual(mockResult)
  })
})
