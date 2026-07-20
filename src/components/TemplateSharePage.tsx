import { useEffect, useState } from 'react'
import type { Firestore } from 'firebase/firestore'
import { duplicatePersonalTemplate, getTemplateShare } from '../lib/templates/templateRepository'
import type { TemplateShare } from '../lib/templates/types'

export const TemplateSharePage = ({ shareId, db, ownerUid }: { shareId: string; db?: Firestore; ownerUid?: string }) => {
  const [share, setShare] = useState<TemplateShare>()
  const [error, setError] = useState<string>()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!db || !ownerUid) return
    void getTemplateShare(db, shareId).then((value) => {
      if (!value) setError('共有テンプレートが見つかりません。リンクを確認してください。')
      else setShare(value)
    }).catch(() => setError('共有テンプレートを読み込めません。教師アカウントでログインしているか確認してください。'))
  }, [db, ownerUid, shareId])
  if (!db || !ownerUid) return <main><h1>共有テンプレート</h1><p>この共有リンクを開くには、教師用メールリンクでログインしてください。</p></main>
  if (error) return <main><h1>共有テンプレート</h1><p role="alert">{error}</p></main>
  if (!share) return <main><h1>共有テンプレート</h1><p>共有テンプレートを読み込んでいます…</p></main>
  const duplicate = async () => { await duplicatePersonalTemplate(db, ownerUid, share.snapshot); setCopied(true) }
  return <main>
    <h1>{share.snapshot.title}</h1><p>{share.snapshot.description}</p>
    <button type="button" onClick={() => void duplicate()} disabled={copied}>{copied ? '自分用に複製しました' : '自分用に複製'}</button>
  </main>
}
