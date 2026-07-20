import { useState } from 'react'
import type { TemplateSpec } from '../lib/templates/types'
import { officialTemplateSeeds } from '../lib/templates/officialSeeds'

export interface TemplateWorkspaceProps {
  isOperator?: boolean
  onSaveOfficial?: (id: string, spec: TemplateSpec) => Promise<void>
}

/** Small routed surface for template discovery and the operator-only seed editor. */
export const TemplateWorkspace = ({ isOperator = false, onSaveOfficial }: TemplateWorkspaceProps) => {
  const [selected, setSelected] = useState(officialTemplateSeeds[0])
  const [title, setTitle] = useState(selected.spec.title)
  const changeTemplate = (id: string) => {
    const next = officialTemplateSeeds.find((item) => item.id === id)!
    setSelected(next)
    setTitle(next.spec.title)
  }
  const save = async () => onSaveOfficial?.(selected.id, { ...selected.spec, title })

  return <section aria-labelledby="templates-heading">
    <h1 id="templates-heading">テンプレート</h1>
    <p>公式テンプレートを選ぶか、自分のテンプレートを作成して授業市場の準備に使えます。</p>
    <label>公式シナリオ
      <select aria-label="公式シナリオ" value={selected.id} onChange={(event) => changeTemplate(event.target.value)}>
        {officialTemplateSeeds.map((item) => <option key={item.id} value={item.id}>{item.spec.title}</option>)}
      </select>
    </label>
    <p>{selected.spec.description}</p>
    {isOperator && <fieldset>
      <legend>運営者用: 公式テンプレートを編集</legend>
      <label>タイトル <input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <button type="button" onClick={() => void save()}>公式テンプレートを保存</button>
    </fieldset>}
  </section>
}
