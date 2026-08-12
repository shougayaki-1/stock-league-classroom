export type ParentContractState = 'ACTIVE' | 'ENDED'

export const parentContractStateFrom = (data: Record<string, unknown> | undefined): ParentContractState =>
  data?.parentContractState === 'ENDED' ? 'ENDED' : 'ACTIVE'
