import { httpsCallable, type Functions } from 'firebase/functions'
import type { LessonInputValue } from '@stock-league/lesson-inputs'

export type LessonResponseStatus = 'DRAFT' | 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'CONFIRMED'

export interface LessonResponseScopeInput {
  lessonRunId: string
  participantId?: string
  teamId?: string
  phaseId: string
  inputId: string
}

export interface SaveResponseDraftInput extends LessonResponseScopeInput {
  value: LessonInputValue
  rationaleInformationIds?: string[]
  expectedRevision?: number
  idempotencyKey: string
}
export interface SaveResponseDraftResult {
  responseId: string
  revision: number
  status: LessonResponseStatus
  deduplicated: boolean
}

/** Client wrapper for saveResponseDraftCallable — the DRAFT-state autosave. `actorId`/`actorParticipantId` are resolved server-side, matching transitionPhase.ts's wrapper. */
export const saveResponseDraft = async (functions: Functions, input: SaveResponseDraftInput): Promise<SaveResponseDraftResult> => {
  const callable = httpsCallable<SaveResponseDraftInput, SaveResponseDraftResult>(functions, 'saveResponseDraftCallable')
  const result = await callable(input)
  return result.data
}

export interface SubmitProposalInput extends LessonResponseScopeInput {
  expectedRevision: number
  idempotencyKey: string
}
export interface SubmitProposalResult {
  responseId: string
  revision: number
  status: LessonResponseStatus
  deduplicated: boolean
}

/** Client wrapper for submitProposalCallable — DRAFT -> PROPOSED. */
export const submitProposal = async (functions: Functions, input: SubmitProposalInput): Promise<SubmitProposalResult> => {
  const callable = httpsCallable<SubmitProposalInput, SubmitProposalResult>(functions, 'submitProposalCallable')
  const result = await callable(input)
  return result.data
}

export interface DecideProposalInput extends LessonResponseScopeInput {
  decision: 'APPROVE' | 'REJECT'
  idempotencyKey: string
}
export interface DecideProposalResult {
  responseId: string
  status: LessonResponseStatus
  approvals: string[]
  deduplicated: boolean
}

/** Client wrapper for decideProposalCallable — PROPOSED -> APPROVED/REJECTED (one approve/reject vote). */
export const decideProposal = async (functions: Functions, input: DecideProposalInput): Promise<DecideProposalResult> => {
  const callable = httpsCallable<DecideProposalInput, DecideProposalResult>(functions, 'decideProposalCallable')
  const result = await callable(input)
  return result.data
}

export interface ConfirmResponseInput extends LessonResponseScopeInput {
  idempotencyKey: string
}
export interface ConfirmResponseResult {
  responseId: string
  status: LessonResponseStatus
  confirmedAt: unknown
  deduplicated: boolean
}

/** Client wrapper for confirmResponseCallable — the final APPROVED -> CONFIRMED step. */
export const confirmResponse = async (functions: Functions, input: ConfirmResponseInput): Promise<ConfirmResponseResult> => {
  const callable = httpsCallable<ConfirmResponseInput, ConfirmResponseResult>(functions, 'confirmResponseCallable')
  const result = await callable(input)
  return result.data
}
