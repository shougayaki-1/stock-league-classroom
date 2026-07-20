import { useCallback, useEffect, useState } from 'react'
import type { Firestore } from 'firebase/firestore'
import type { PersonalTemplate, TemplateSpec } from '../lib/templates/types'
import { createPersonalTemplate, createTemplateShare, deletePersonalTemplate, listOfficialTemplates, listPersonalTemplates, saveOfficialTemplate, updatePersonalTemplate } from '../lib/templates/templateRepository'
import { officialTemplateSeeds } from '../lib/templates/officialSeeds'

export interface TemplateWorkspaceProps { db?: Firestore; ownerUid?: string; isOperator?: boolean }
const blank: TemplateSpec = { title: '新しいテンプレート', description: '授業用の市場テンプレート', startingCash: 10000, companies: [] }

/** Teacher workspace backed by Firestore. The static seeds are only an operator bootstrap fallback. */
export const TemplateWorkspace = ({ db, ownerUid, isOperator = false }: TemplateWorkspaceProps) => {
  const [personal, setPersonal] = useState<PersonalTemplate[]>([])
  const [official, setOfficial] = useState(officialTemplateSeeds)
  const [title, setTitle] = useState(blank.title)
  const [notice, setNotice] = useState('')
  const refresh = useCallback(async () => {
    if (!db || !ownerUid) return
    const [mine, published] = await Promise.all([listPersonalTemplates(db, ownerUid), listOfficialTemplates(db)])
    setPersonal(mine)
    if (published.length) setOfficial(published.map(({ id, ...spec }) => ({ id, spec })))
  }, [db, ownerUid])
  useEffect(() => { void refresh().catch(() => setNotice('テンプレートを読み込めませんでした。')) }, [refresh])
  if (!db || !ownerUid) return <main><h1>テンプレート</h1><p>テンプレートを管理するには教師用メールリンクでログインしてください。</p></main>
  const create = async () => { await createPersonalTemplate(db, ownerUid, { ...blank, title }); await refresh() }
  const share = async (item: PersonalTemplate) => { const id = await createTemplateShare(db, ownerUid, item); setNotice(`${window.location.origin}/templates/share/${id}`) }
  return <section aria-labelledby="templates-heading">
    <h1 id="templates-heading">テンプレート</h1>{notice && <p role="status">{notice}</p>}
    <label>新規テンプレート名 <input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
    <button type="button" onClick={() => void create()}>個人テンプレートを作成</button>
    <h2>自分のテンプレート</h2>
    <ul>{personal.map((item) => <li key={item.id}>{item.title}
      <button type="button" onClick={() => void updatePersonalTemplate(db, item.id, { ...item, title: `${item.title}（編集済み）` }).then(refresh)}>編集</button>
      <button type="button" onClick={() => void share(item)}>共有</button>
      <button type="button" onClick={() => void deletePersonalTemplate(db, item.id).then(refresh)}>削除</button>
    </li>)}</ul>
    <h2>公式シナリオ</h2><ul>{official.map((item) => <li key={item.id}>{item.spec.title}</li>)}</ul>
    {isOperator && <fieldset><legend>運営者用: 公式テンプレートを編集</legend>
      <button type="button" onClick={() => void saveOfficialTemplate(db, official[0].id, { ...official[0].spec, title: `${official[0].spec.title}（編集済み）` }).then(refresh)}>公式テンプレートを保存</button>
    </fieldset>}
  </section>
}
