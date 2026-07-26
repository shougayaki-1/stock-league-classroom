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
  if (!db || !ownerUid) return <main className="workspace-gate"><a className="portal-brand" href="/teacher/markets">← Stock League Classroom</a><div><p className="portal-eyebrow">SHARED TEMPLATE</p><h1>共有テンプレートを<br />受け取る</h1><p>この共有リンクを開くには、Googleアカウントでログインしてください。</p><a className="portal-button" href="/teacher/markets">教師としてログイン <span>→</span></a></div></main>
  if (error) return <main className="share-page"><a className="portal-brand" href="/templates">← テンプレート一覧</a><section className="share-card"><p className="portal-eyebrow">SHARED TEMPLATE</p><h1>共有テンプレート</h1><p className="share-error" role="alert">{error}</p></section></main>
  if (!share) return <main className="share-page"><a className="portal-brand" href="/templates">← テンプレート一覧</a><section className="share-card"><p className="portal-eyebrow">SHARED TEMPLATE</p><h1>読み込んでいます…</h1><p>共有テンプレートを確認しています。</p></section></main>
  const duplicate = async () => { await duplicatePersonalTemplate(db, ownerUid, share.snapshot); setCopied(true) }
  return <main className="share-page"><a className="portal-brand" href="/templates">← テンプレート一覧</a><section className="share-card"><div className="share-symbol">◫</div><p className="portal-eyebrow">SHARED TEMPLATE</p><h1>{share.snapshot.title}</h1><p>{share.snapshot.description}</p><dl><div><dt>初期資金</dt><dd>¥{share.snapshot.startingCash.toLocaleString()}</dd></div><div><dt>会社数</dt><dd>{share.snapshot.companies.length} 社</dd></div></dl><button className="portal-button" type="button" onClick={() => void duplicate()} disabled={copied}>{copied ? '自分用に複製しました' : '自分用に複製する'} <span>→</span></button></section></main>
}
