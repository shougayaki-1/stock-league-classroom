import { useCallback, useEffect, useState } from 'react'
import type { Firestore } from 'firebase/firestore'
import { Alert, Box, Button, Card, CardContent, Chip, Container, Divider, MobileStepper, Paper, Stack, TextField, Typography } from '@mui/material'
import type { PersonalTemplate, TemplateCompany, TemplateSpec } from '../lib/templates/types'
import { createPersonalTemplate, createTemplateShare, deletePersonalTemplate, listOfficialTemplates, listPersonalTemplates, updatePersonalTemplate } from '../lib/templates/templateRepository'
import { officialTemplateSeeds } from '../lib/templates/officialSeeds'
import { TemplateValidationError, normalizeTemplate, validateTemplate } from '../lib/templates/templateValidation'
import { handleFailure } from '../lib/monitoring/describeError'
import { TeacherShell } from './teacher/TeacherShell'
import { PricePhaseEditor } from './teacher/PricePhaseEditor'

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

const editorFieldSx = { '& .MuiInputBase-root': { bgcolor: 'background.paper' } }
const EditorNumberField = ({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) => <TextField sx={editorFieldSx} label={label} type="number" slotProps={{ htmlInput: { min, max } }} value={value} onChange={(event) => onChange(Number(event.target.value))} />

export const TemplateWorkspace = ({ db, ownerUid }: TemplateWorkspaceProps) => {
  const [personal, setPersonal] = useState<PersonalTemplate[]>([])
  const [official, setOfficial] = useState(officialTemplateSeeds)
  const [editingId, setEditingId] = useState<string>()
  const [draft, setDraft] = useState<TemplateSpec>(() => blank())
  const [notice, setNotice] = useState('')
  const [shareUrl, setShareUrl] = useState('')
  const [editorStep, setEditorStep] = useState(0)
  const refresh = useCallback(async () => {
    if (!db || !ownerUid) return
    const [mine, published] = await Promise.all([listPersonalTemplates(db, ownerUid), listOfficialTemplates(db)])
    setPersonal(mine)
    if (published.length) setOfficial(published.map(({ id, title, description, startingCash, teams, companies }) => ({ id, spec: { title, description, startingCash, teams, companies } })))
  }, [db, ownerUid])
  useEffect(() => { void refresh().catch((error) => setNotice(handleFailure(error, 'テンプレートを読み込めませんでした。'))) }, [refresh])
  if (!db || !ownerUid) return <Container component="main" maxWidth="sm" sx={{ py: { xs: 4, md: 8 } }}><Card variant="outlined"><CardContent><Stack spacing={2}><Typography variant="overline" color="text.secondary">テンプレート管理</Typography><Typography component="h1" variant="h1">テンプレートを管理する</Typography><Typography color="text.secondary">Googleアカウントでログインすると、授業用の市場シナリオを作成・共有できます。</Typography><Button component="a" href="/teacher/markets" variant="contained" sx={{ alignSelf: 'flex-start' }}>教師としてログイン</Button></Stack></CardContent></Card></Container>

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
  const edit = (item: PersonalTemplate) => { setEditingId(item.id); setDraft(specOf(item)); setEditorStep(0); setNotice('') }
  const createNew = () => { setEditingId(undefined); setDraft(blank()); setEditorStep(0); setNotice('') }
  const loadOfficial = (spec: TemplateSpec) => {
    setEditingId(undefined)
    setDraft(structuredClone(spec))
    setEditorStep(0)
    setNotice('公式テンプレートを読み込みました。内容を確認して保存してください。')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
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

  const steps = [{ label: '基本情報', detail: '名前と初期資金' }, { label: 'チーム', detail: '参加グループ' }, { label: '銘柄・価格', detail: '市場の動き' }, { label: '確認・保存', detail: '内容を確定' }]
  const nextStep = () => {
    if (editorStep === 0 && (!draft.title.trim() || !draft.description.trim() || draft.startingCash < 1)) return setNotice('テンプレート名、説明、初期資金を入力してください。')
    if (editorStep === 1 && (draft.teams.length < 2 || draft.teams.some((team) => !team.name.trim()))) return setNotice('2つ以上のチーム名を入力してください。')
    if (editorStep === 2) { const errors = validateTemplate(draft); if (errors.length) return setNotice(errors[0]) }
    setNotice(''); setEditorStep((current) => Math.min(current + 1, 3))
  }

  return <TeacherShell active="templates">
    <main className="template-page" aria-labelledby="templates-heading">
      <section className="template-explainer" aria-labelledby="template-explainer-heading"><Box><Typography className="section-kicker" variant="overline" color="primary">WHAT IS A TEMPLATE?</Typography><Typography id="template-explainer-heading" component="h2" variant="h4">テンプレートとは、授業用の市場設計図です。</Typography><Typography color="text.secondary">チーム、初期資金、会社（銘柄）、価格の動きをひとまとめにして保存できます。テンプレートがあれば、同じ授業をもう一度開いたり、学年ごとに市場を作り分けたりできます。</Typography></Box><Box component="ul"><li><strong>チーム編成</strong><span>クラスで使うチーム名と人数の単位を決める</span></li><li><strong>投資体験</strong><span>初期資金・銘柄・価格フェーズを設定する</span></li><li><strong>授業の再利用</strong><span>公式テンプレートを調整して保存・共有する</span></li></Box></section>
      <header className="teacher-header"><div><span className="mobile-page-title">テンプレート</span></div><Button component="a" href="/teacher/markets" variant="text">市場の管理へ</Button></header>
      <section className="template-hero"><div><p className="portal-eyebrow">TEMPLATE STUDIO</p><h1 id="templates-heading">授業に合わせて、<br /><em>市場を設計。</em></h1><p>用意済みのシナリオから始めることも、授業に合わせて細かく設計することもできます。</p></div><div className="template-count"><span>MY TEMPLATES</span><strong>{personal.length}</strong><small>いつでも編集・共有できます</small></div></section>
      <section className="template-workspace">
        <Paper component="section" className="template-section official-section official-picker" variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}><Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', justifyContent: 'space-between', mb: 2 }}><Box><Typography variant="overline" color="text.secondary">用意済みテンプレート</Typography><Typography component="h2" variant="h2">まずは用意済みテンプレートから</Typography><Typography color="text.secondary">選んだあとに、内容を自由に調整できます。</Typography></Box><Chip label={`${official.length} 種類`} color="primary" variant="outlined" /></Stack><Box component="ul" sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 2, p: 0, m: 0, listStyle: 'none' }}>{official.map((item, index) => <Card component="li" key={item.id} variant="outlined"><CardContent><Typography variant="overline" color="primary">テンプレート {String(index + 1).padStart(2, '0')}</Typography><Typography component="h3" variant="h3">{item.spec.title}</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{item.spec.description}</Typography><Typography variant="caption" color="text.secondary" sx={{ display: 'block', my: 2 }}>{item.spec.teams.length} チーム ・ {item.spec.companies.length} 銘柄 ・ ¥{item.spec.startingCash.toLocaleString()}</Typography><Button fullWidth variant="outlined" onClick={() => loadOfficial(item.spec)}>このテンプレートを使う</Button></CardContent></Card>)}</Box></Paper>

        <Paper component="section" className="new-template-card template-editor" id="template-editor" variant="outlined" sx={{ p: { xs: 2.5, sm: 3.5 } }}>
          <div className="card-heading"><div><p className="section-kicker">{editingId ? 'EDIT TEMPLATE' : 'TEMPLATE SETUP'}</p><h2>{editingId ? 'テンプレートを編集' : 'テンプレートを作成'}</h2></div><Button variant="outlined" type="button" onClick={createNew}>新規作成</Button></div>
          <Box><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1, alignItems: { sm: 'center' } }}><Typography variant="subtitle2">テンプレート設定</Typography><Typography variant="body2" color="text.secondary">{editorStep + 1} / {steps.length} — {steps[editorStep].label}</Typography></Stack><MobileStepper variant="progress" steps={steps.length} position="static" activeStep={editorStep} nextButton={<Box />} backButton={<Box />} sx={{ bgcolor: 'transparent', px: 0, '& .MuiLinearProgress-root': { width: '100%' } }} /></Box>
          {notice && <Alert severity={notice.includes('できません') || notice.includes('入力してください') ? 'error' : 'success'} role="status">{notice}</Alert>}

          {editorStep === 0 && <Paper component="section" variant="outlined" sx={{ p: { xs: 2, sm: 3 }, bgcolor: 'action.hover' }} aria-labelledby="basic-heading"><Stack spacing={2.5}><Box><Typography id="basic-heading" component="h3" variant="h3">基本情報</Typography><Typography color="text.secondary">授業で見分けやすい名前と、生徒が投資に使う初期資金を設定します。</Typography></Box><Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}><TextField sx={editorFieldSx} fullWidth label="テンプレート名" slotProps={{ htmlInput: { maxLength: 80 } }} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /><EditorNumberField label="初期資金（円）" min={1} max={1_000_000_000} value={draft.startingCash} onChange={(value) => setDraft({ ...draft, startingCash: value })} /></Stack><TextField sx={editorFieldSx} fullWidth multiline minRows={4} label="授業の説明" slotProps={{ htmlInput: { maxLength: 500 } }} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></Stack></Paper>}

          {editorStep === 1 && <Paper component="section" variant="outlined" sx={{ p: { xs: 2, sm: 3 }, bgcolor: 'action.hover' }} aria-labelledby="teams-heading"><Stack spacing={2}><Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'flex-start' }, justifyContent: 'space-between' }}><Box><Typography id="teams-heading" component="h3" variant="h3">チームを設定</Typography><Typography color="text.secondary">2〜8チームで進められます。クラスで使う呼び名に変更してください。</Typography></Box><Button variant="outlined" disabled={draft.teams.length >= 8} onClick={() => setDraft({ ...draft, teams: [...draft.teams, { id: newId('team'), name: `チーム${draft.teams.length + 1}` }] })}>チームを追加</Button></Stack><Stack spacing={1.5}>{draft.teams.map((team, index) => <Card key={team.id} variant="outlined"><CardContent><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}><Chip label={index + 1} color="primary" size="small" /><TextField sx={{ ...editorFieldSx, flex: 1 }} fullWidth label="チーム名" slotProps={{ htmlInput: { maxLength: 30 } }} value={team.name} onChange={(event) => setDraft({ ...draft, teams: draft.teams.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} /><Button color="error" variant="outlined" disabled={draft.teams.length <= 2} onClick={() => setDraft({ ...draft, teams: draft.teams.filter((_, itemIndex) => itemIndex !== index) })}>削除</Button></Stack></CardContent></Card>)}</Stack></Stack></Paper>}

          {editorStep === 2 && <Paper component="section" variant="outlined" sx={{ p: { xs: 2, sm: 3 }, bgcolor: 'action.hover' }} aria-labelledby="stocks-heading"><Stack spacing={2}><Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'flex-start' }, justifyContent: 'space-between' }}><Box><Typography id="stocks-heading" component="h3" variant="h3">銘柄と価格の動き</Typography><Typography color="text.secondary">会社情報と、授業時間内の価格変化を設定します。</Typography></Box><Button variant="outlined" disabled={draft.companies.length >= 20} onClick={() => setDraft({ ...draft, companies: [...draft.companies, { id: newId('stock'), name: '新しい会社', symbol: `STK${draft.companies.length + 1}`, initialPrice: 500, pricePhases: [{ id: newId('phase'), startMinute: 0, endMinute: 60, direction: 'FLAT', changePercent: 0 }] }] })}>銘柄を追加</Button></Stack>{draft.companies.map((company, companyIndex) => <Card component="article" key={company.id} variant="outlined"><CardContent><Stack spacing={2}><Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Chip label={companyIndex + 1} size="small" color="primary" /><Typography component="h4" variant="h3">{company.name || '名称未設定'}</Typography></Stack><Button color="error" variant="outlined" size="small" disabled={draft.companies.length <= 1} onClick={() => setDraft({ ...draft, companies: draft.companies.filter((_, itemIndex) => itemIndex !== companyIndex) })}>銘柄を削除</Button></Stack><Stack direction={{ xs: 'column', md: 'row' }} spacing={2}><TextField sx={{ ...editorFieldSx, flex: 1.5 }} fullWidth label="会社名" slotProps={{ htmlInput: { maxLength: 80 } }} value={company.name} onChange={(event) => updateCompany(companyIndex, { name: event.target.value })} /><TextField sx={{ ...editorFieldSx, flex: 1 }} fullWidth label="銘柄コード" slotProps={{ htmlInput: { maxLength: 10 } }} value={company.symbol} onChange={(event) => updateCompany(companyIndex, { symbol: event.target.value.toUpperCase() })} /><EditorNumberField label="初期価格（円）" min={1} max={10_000_000} value={company.initialPrice} onChange={(value) => updateCompany(companyIndex, { initialPrice: value })} /></Stack><Divider /><PricePhaseEditor
  phases={company.pricePhases ?? []}
  onAddPhase={() => updateCompany(companyIndex, { pricePhases: [...(company.pricePhases ?? []), { id: newId('phase'), startMinute: 0, endMinute: 60, direction: 'FLAT', changePercent: 0 }] })}
  onUpdatePhase={(phaseIndex, patch) => updateCompany(companyIndex, { pricePhases: company.pricePhases?.map((item, itemIndex) => itemIndex === phaseIndex ? { ...item, ...patch } : item) })}
  onRemovePhase={(phaseIndex) => updateCompany(companyIndex, { pricePhases: company.pricePhases?.filter((_, itemIndex) => itemIndex !== phaseIndex) })}
/></Stack></CardContent></Card>)}</Stack></Paper>}

          {editorStep === 3 && <section className="editor-step review-step" aria-labelledby="review-heading"><div className="editor-step-head"><span>STEP 4</span><div><h3 id="review-heading">内容を確認</h3><p>保存後も、いつでも編集できます。</p></div></div><div className="template-review"><div><span>テンプレート名</span><strong>{draft.title}</strong><small>{draft.description}</small></div><div><span>初期資金</span><strong>¥{draft.startingCash.toLocaleString()}</strong></div><div><span>チーム</span><strong>{draft.teams.length}</strong><small>{draft.teams.map((team) => team.name).join('、')}</small></div><div><span>銘柄</span><strong>{draft.companies.length}</strong><small>{draft.companies.map((company) => company.name).join('、')}</small></div></div></section>}

          <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}><Button variant="outlined" type="button" disabled={editorStep === 0} onClick={() => { setNotice(''); setEditorStep((current) => Math.max(current - 1, 0)) }}>戻る</Button>{editorStep < 3 ? <Button variant="contained" type="button" onClick={nextStep}>次へ</Button> : <Button variant="contained" type="button" onClick={() => void save().catch((error: unknown) => setNotice(error instanceof TemplateValidationError ? error.message : handleFailure(error, '保存できませんでした。')))}>この内容で保存</Button>}</Stack>
          {shareUrl && <Alert severity="info" className="share-url" role="status" action={<Button color="inherit" size="small" onClick={() => void navigator.clipboard.writeText(shareUrl).then(() => setNotice('共有URLをコピーしました。'))}>コピー</Button>}><Typography component="code" variant="body2" sx={{ overflowWrap: 'anywhere' }}>{shareUrl}</Typography><Typography variant="caption" sx={{ display: 'block' }}>この URL はあとから一覧できません。いま控えてください。</Typography></Alert>}
        </Paper>

        <Paper component="section" className="template-section" variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}><Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2 }}><Box><Typography variant="overline" color="text.secondary">自分のライブラリ</Typography><Typography component="h2" variant="h2">自分のテンプレート</Typography></Box><Chip label={`${personal.length} 件`} color="primary" variant="outlined" /></Stack>{personal.length ? <Stack component="ul" spacing={1.5} sx={{ p: 0, m: 0, listStyle: 'none' }}>{personal.map((item) => <Card component="li" key={item.id} variant="outlined"><CardContent><Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}><Box sx={{ flex: 1 }}><Typography component="h3" variant="h3">{item.title}</Typography><Typography variant="body2" color="text.secondary">{item.description}</Typography><Typography variant="caption" color="text.secondary">初期資金 ¥{item.startingCash.toLocaleString()} ・ {item.teams.length} チーム ・ {item.companies.length} 社</Typography></Box><Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}><Button variant="outlined" onClick={() => edit(item)}>編集</Button><Button variant="outlined" onClick={() => void share(item)}>共有</Button><Button color="error" variant="outlined" onClick={() => void removeTemplate(item)}>削除</Button></Stack></Stack></CardContent></Card>)}</Stack> : <Alert severity="info">保存したテンプレートはここに並びます。用意済みテンプレートを選ぶか、上のエディタから作成してください。</Alert>}</Paper>
      </section>
    </main>
  </TeacherShell>
}
