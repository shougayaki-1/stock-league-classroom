import { useCallback, useEffect, useState } from 'react'
import type { Firestore } from 'firebase/firestore'
import type { PersonalTemplate, TemplateCompany, TemplateSpec } from '../lib/templates/types'
import { createPersonalTemplate, createTemplateShare, deletePersonalTemplate, listOfficialTemplates, listPersonalTemplates, updatePersonalTemplate } from '../lib/templates/templateRepository'
import { officialTemplateSeeds } from '../lib/templates/officialSeeds'
import { TemplateValidationError, normalizeTemplate, validateTemplate } from '../lib/templates/templateValidation'
import { handleFailure } from '../lib/monitoring/describeError'

export interface TemplateWorkspaceProps { db?: Firestore; ownerUid?: string; isOperator?: boolean }
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`
const blank = (): TemplateSpec => ({
  title: '新しいテンプレート',
  description: '授業用の市場テンプレート',
  startingCash: 10000,
  teams: [{ id: newId('team'), name: '赤チーム' }, { id: newId('team'), name: '青チーム' }],
  companies: [{
    id: newId('stock'), name: 'サンプル株式会社', symbol: 'SAMPLE', initialPrice: 500,
    pricePhases: [{ id: newId('phase'), startMinute: 0, endMinute: 60, direction: 'FLAT', changePercent: 0 }],
  }],
})

const specOf = (item: PersonalTemplate): TemplateSpec => ({
  title: item.title, description: item.description, startingCash: item.startingCash,
  teams: structuredClone(item.teams), companies: structuredClone(item.companies),
})

export const TemplateWorkspace = ({ db, ownerUid }: TemplateWorkspaceProps) => {
  const [personal, setPersonal] = useState<PersonalTemplate[]>([])
  const [official, setOfficial] = useState(officialTemplateSeeds)
  const [editingId, setEditingId] = useState<string>()
  const [draft, setDraft] = useState<TemplateSpec>(() => blank())
  const [notice, setNotice] = useState('')
  const [shareUrl, setShareUrl] = useState('')
  const refresh = useCallback(async () => {
    if (!db || !ownerUid) return
    const [mine, published] = await Promise.all([listPersonalTemplates(db, ownerUid), listOfficialTemplates(db)])
    setPersonal(mine)
    if (published.length) setOfficial(published.map(({ id, ...spec }) => ({ id, spec })))
  }, [db, ownerUid])
  useEffect(() => { void refresh().catch((error) => setNotice(handleFailure(error, 'テンプレートを読み込めませんでした。'))) }, [refresh])
  if (!db || !ownerUid) return <main className="workspace-gate"><a className="portal-brand" href="/teacher/markets">← Stock League Classroom</a><div><p className="portal-eyebrow">TEMPLATE STUDIO</p><h1>テンプレートを<br />管理する</h1><p>Googleアカウントでログインすると、授業用の市場シナリオを作成・共有できます。</p><a className="portal-button" href="/teacher/markets">教師としてログイン <span>→</span></a></div></main>

  const updateCompany = (index: number, patch: Partial<TemplateCompany>) => setDraft((current) => ({
    ...current, companies: current.companies.map((company, companyIndex) => companyIndex === index ? { ...company, ...patch } : company),
  }))
  const save = async () => {
    const errors = validateTemplate(draft)
    if (errors.length) return setNotice(errors[0])
    const normalized = normalizeTemplate(draft)
    if (editingId) await updatePersonalTemplate(db, editingId, normalized)
    else setEditingId(await createPersonalTemplate(db, ownerUid, normalized))
    setDraft(normalized)
    setNotice('テンプレートを保存しました。')
    await refresh()
  }
  const edit = (item: PersonalTemplate) => { setEditingId(item.id); setDraft(specOf(item)); setNotice('') }
  const createNew = () => { setEditingId(undefined); setDraft(blank()); setNotice('') }
  const share = async (item: PersonalTemplate) => {
    const id = await createTemplateShare(db, ownerUid, item)
    // A share link cannot be listed or re-fetched later, so it must be copyable now.
    const url = `${window.location.origin}/templates/share/${id}`
    setShareUrl(url)
    setNotice('共有URLを発行しました。下のボタンでコピーしてください。')
  }
  const removeTemplate = async (item: PersonalTemplate) => {
    if (!window.confirm(`「${item.title}」を削除しますか？`)) return
    await deletePersonalTemplate(db, item.id)
    if (editingId === item.id) createNew()
    await refresh()
  }

  return <main className="template-page" aria-labelledby="templates-heading">
    <header className="teacher-header"><a className="portal-brand" href="/teacher/markets">Stock League <span>Classroom</span></a><a href="/teacher/markets">市場の管理へ →</a></header>
    <section className="template-hero"><div><p className="portal-eyebrow">TEMPLATE STUDIO</p><h1 id="templates-heading">授業に合わせて、<br /><em>市場を設計。</em></h1><p>チーム、会社、初期資金、価格変動を組み合わせます。</p></div><div className="template-count"><span>MY TEMPLATES</span><strong>{personal.length}</strong><small>いつでも編集・共有できます</small></div></section>
    <section className="template-workspace">
      <div className="new-template-card template-editor">
        <div className="card-heading"><div><p className="section-kicker">{editingId ? 'EDIT TEMPLATE' : 'CREATE NEW'}</p><h2>{editingId ? 'テンプレートを編集' : '新しいテンプレート'}</h2></div><button className="outline-button" type="button" onClick={createNew}>新規作成</button></div>
        <div className="field-grid">
          <label>テンプレート名<input value={draft.title} maxLength={80} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
          <label>初期資金<input type="number" min={1} max={1_000_000_000} value={draft.startingCash} onChange={(event) => setDraft({ ...draft, startingCash: Number(event.target.value) })} /></label>
        </div>
        <label>説明<textarea rows={3} maxLength={500} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>

        <div className="editor-section"><div className="card-heading"><h3>チーム</h3><button type="button" disabled={draft.teams.length >= 8} onClick={() => setDraft({ ...draft, teams: [...draft.teams, { id: newId('team'), name: `チーム${draft.teams.length + 1}` }] })}>＋ チームを追加</button></div>
          {draft.teams.map((team, index) => <div className="editor-row" key={team.id}><label>チーム名<input value={team.name} maxLength={30} onChange={(event) => setDraft({ ...draft, teams: draft.teams.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} /></label><button className="danger-button" type="button" disabled={draft.teams.length <= 2} onClick={() => setDraft({ ...draft, teams: draft.teams.filter((_, itemIndex) => itemIndex !== index) })}>削除</button></div>)}
        </div>

        <div className="editor-section"><div className="card-heading"><h3>銘柄と価格フェーズ</h3><button type="button" disabled={draft.companies.length >= 20} onClick={() => setDraft({ ...draft, companies: [...draft.companies, { id: newId('stock'), name: '新しい会社', symbol: `STK${draft.companies.length + 1}`, initialPrice: 500, pricePhases: [{ id: newId('phase'), startMinute: 0, endMinute: 60, direction: 'FLAT', changePercent: 0 }] }] })}>＋ 銘柄を追加</button></div>
          {draft.companies.map((company, companyIndex) => <article className="company-editor" key={company.id}>
            <div className="field-grid"><label>会社名<input value={company.name} maxLength={80} onChange={(event) => updateCompany(companyIndex, { name: event.target.value })} /></label><label>銘柄コード<input value={company.symbol} maxLength={10} onChange={(event) => updateCompany(companyIndex, { symbol: event.target.value.toUpperCase() })} /></label><label>初期価格<input type="number" min={1} max={10_000_000} value={company.initialPrice} onChange={(event) => updateCompany(companyIndex, { initialPrice: Number(event.target.value) })} /></label></div>
            <div className="card-heading"><h4>開始からの価格フェーズ（分）</h4><button type="button" onClick={() => updateCompany(companyIndex, { pricePhases: [...(company.pricePhases ?? []), { id: newId('phase'), startMinute: 0, endMinute: 60, direction: 'FLAT', changePercent: 0 }] })}>＋ フェーズ</button></div>
            {(company.pricePhases ?? []).map((phase, phaseIndex) => <div className="phase-row" key={phase.id}>
              <label>開始<input type="number" min={0} max={59} value={phase.startMinute} onChange={(event) => updateCompany(companyIndex, { pricePhases: company.pricePhases?.map((item, itemIndex) => itemIndex === phaseIndex ? { ...item, startMinute: Number(event.target.value) } : item) })} /></label>
              <label>終了<input type="number" min={1} max={60} value={phase.endMinute} onChange={(event) => updateCompany(companyIndex, { pricePhases: company.pricePhases?.map((item, itemIndex) => itemIndex === phaseIndex ? { ...item, endMinute: Number(event.target.value) } : item) })} /></label>
              <label>方向<select value={phase.direction} onChange={(event) => updateCompany(companyIndex, { pricePhases: company.pricePhases?.map((item, itemIndex) => itemIndex === phaseIndex ? { ...item, direction: event.target.value as typeof phase.direction } : item) })}><option value="UP">上昇</option><option value="DOWN">下落</option><option value="FLAT">横ばい</option></select></label>
              <label>変化率<input type="number" min={0} max={99} value={phase.changePercent} onChange={(event) => updateCompany(companyIndex, { pricePhases: company.pricePhases?.map((item, itemIndex) => itemIndex === phaseIndex ? { ...item, changePercent: Number(event.target.value) } : item) })} /></label>
              <button className="danger-button" type="button" disabled={(company.pricePhases?.length ?? 0) <= 1} onClick={() => updateCompany(companyIndex, { pricePhases: company.pricePhases?.filter((_, itemIndex) => itemIndex !== phaseIndex) })}>削除</button>
            </div>)}
            <button className="danger-button" type="button" disabled={draft.companies.length <= 1} onClick={() => setDraft({ ...draft, companies: draft.companies.filter((_, itemIndex) => itemIndex !== companyIndex) })}>この銘柄を削除</button>
          </article>)}
        </div>
        <button className="portal-button" type="button" onClick={() => void save().catch((error: unknown) => setNotice(error instanceof TemplateValidationError ? error.message : handleFailure(error, '保存できませんでした。')))}>保存する <span>→</span></button>
        {notice && <p className="form-notice" role="status">{notice}</p>}
        {shareUrl && <p className="form-notice share-url" role="status"><code>{shareUrl}</code><button type="button" onClick={() => void navigator.clipboard.writeText(shareUrl).then(() => setNotice('共有URLをコピーしました。'))}>コピー</button><small>この URL はあとから一覧できません。いま控えてください。</small></p>}
      </div>

      <div className="template-section"><div className="template-section-head"><div><p className="section-kicker">YOUR LIBRARY</p><h2>自分のテンプレート</h2></div><span>{personal.length} 件</span></div>{personal.length ? <ul className="template-list">{personal.map((item) => <li key={item.id}><div className="template-mark">◫</div><div><strong>{item.title}</strong><p>{item.description}</p><small>初期資金 ¥{item.startingCash.toLocaleString()} ・ {item.teams.length} チーム ・ {item.companies.length} 社</small></div><div className="template-actions"><button type="button" onClick={() => edit(item)}>編集</button><button type="button" onClick={() => void share(item)}>共有</button><button className="danger-button" type="button" onClick={() => void removeTemplate(item)}>削除</button></div></li>)}</ul> : <div className="template-empty"><strong>まだテンプレートがありません。</strong><p>上のエディタで最初の市場を保存してください。</p></div>}</div>
      <div className="template-section official-section"><div className="template-section-head"><div><p className="section-kicker">OFFICIAL SCENARIOS</p><h2>公式シナリオ</h2></div><span>{official.length} 件</span></div><ul className="official-list">{official.map((item) => <li key={item.id}><span>◎</span><div><strong>{item.spec.title}</strong><p>{item.spec.description}</p></div></li>)}</ul></div>
    </section>
  </main>
}
