import { useEffect, useState } from 'react'
import { onValue, ref } from 'firebase/database'
import { bootstrapFirebase } from '../../lib/firebase/bootstrap'
import { getOrCreateStudentUid } from '../../lib/auth/studentAuth'
import type { SignageData } from '../../lib/market/liveMarketTypes'
import { SignageScreen } from './SignageScreen'

export const SignagePage = ({ marketId }: { marketId: string }) => {
  const services = bootstrapFirebase()
  const [data, setData] = useState<SignageData>()
  const [error, setError] = useState('')
  useEffect(() => {
    let stop: (() => void) | undefined
    void getOrCreateStudentUid(services.auth).then(() => {
      stop = onValue(ref(services.database, `liveMarkets/${marketId}/signage`), (snapshot) => {
        setData(snapshot.val() as SignageData | undefined)
        setError('')
      }, () => setError('この市場の教室画面を表示する権限がありません。'))
    }).catch(() => setError('教室画面へ接続できませんでした。'))
    return () => stop?.()
  }, [marketId, services.auth, services.database])
  if (error) return <main className="signage-error"><h1>教室画面を表示できません</h1><p>{error}</p></main>
  if (!data) return <main className="signage-error"><h1>市場を準備しています…</h1><p>ホストが開始すると価格と順位が表示されます。</p></main>
  return <SignageScreen data={data} joinUrl={`${window.location.origin}/join?code=${encodeURIComponent(data.joinCode)}`} />
}
