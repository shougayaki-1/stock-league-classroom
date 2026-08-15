import type { Functions } from 'firebase/functions'
import { useEffect, useState } from 'react'
import { getMyAiBetaAccess, type AiBetaUiState } from '../lib/ai/betaAccess'

export const useAiBetaAccess = (functions: Functions): AiBetaUiState => {
  const [state, setState] = useState<AiBetaUiState>('LOADING')

  useEffect(() => {
    let cancelled = false

    getMyAiBetaAccess(functions)
      .then((res) => {
        if (cancelled) return
        setState(res.approved ? 'APPROVED' : 'LOCKED')
      })
      .catch(() => {
        if (cancelled) return
        setState('ERROR')
      })

    return () => {
      cancelled = true
    }
  }, [functions])

  return state
}
