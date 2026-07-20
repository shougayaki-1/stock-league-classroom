import { useState } from 'react'

export interface JoinResult {
  accepted: boolean
  reason?: 'CAPACITY_FULL' | 'JOIN_CLOSED'
}

export interface JoinMarketProps {
  onJoin: (joinCode: string, displayName: string) => void
  joinResult: JoinResult | null
}

export function JoinMarket({ onJoin, joinResult }: JoinMarketProps) {
  const [joinCode, setJoinCode] = useState('')
  const [displayName, setDisplayName] = useState('')

  const handleJoin = () => {
    onJoin(joinCode, displayName)
  }

  return (
    <div>
      <div>
        <label htmlFor="joinCode">参加コード</label>
        <input
          id="joinCode"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="displayName">表示名</label>
        <input
          id="displayName"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </div>
      <button onClick={handleJoin}>参加する</button>

      {joinResult && !joinResult.accepted && (
        <>
          {joinResult.reason === 'CAPACITY_FULL' && (
            <div>定員に達しています</div>
          )}
          {joinResult.reason === 'JOIN_CLOSED' && (
            <div>参加受付を終了しています</div>
          )}
        </>
      )}
    </div>
  )
}
