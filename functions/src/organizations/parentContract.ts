export type ParentContractState = 'ACTIVE' | 'ENDED'

export const parentContractStateFrom = (data: Record<string, unknown> | undefined): ParentContractState =>
  data?.parentContractState === 'ENDED' ? 'ENDED' : 'ACTIVE'

export const assertParentContractAllowsSharedQuota = (state: ParentContractState): void => {
  if (state === 'ENDED') throw new Error('親組織の契約が終了しているため共有枠を利用できません')
}
