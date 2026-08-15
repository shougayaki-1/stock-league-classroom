import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  List,
  ListItem,
  ListItemText,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import type { Firestore } from 'firebase/firestore'
import type { Functions } from 'firebase/functions'
import type { FirebaseStorage } from 'firebase/storage'
import type { LessonContent } from '../../../lib/lessonTemplates/types'
import type { CommunityTemplate } from '../../../lib/lessonTemplates/communityTemplates'
import { generateLessonDraft } from '../../../lib/ai/generateLessonDraft'
import { describeError } from '../../../lib/monitoring/describeError'
import { listMaterials, uploadMaterial, type MaterialDocument } from '../../../lib/ai/materialsRepository'
import {
  getLessonTemplateMoveOperation,
  moveLessonTemplate,
  previewLessonTemplateMove,
  type LessonTemplateMoveOperationStatus,
  type LessonTemplateMovePreview,
} from '../../../lib/lessonTemplates/moveLessonTemplate'
import type { AiBetaUiState } from '../../../lib/ai/betaAccess'
import { MaterialUploadPanel } from './materials/MaterialUploadPanel'
import { ArrayFieldEditor } from './editors/ArrayFieldEditor'
import { companyFields, createEmptyCompany, createEmptyInformationItem, informationItemFields } from './editors/socialStudies/fieldConfigs'
import { assetFields, createEmptyAsset, createEmptyHouseholdProfile, createEmptyInsuranceProduct, createEmptyLifeEvent, householdProfileFields, insuranceProductFields, lifeEventFields } from './editors/homeEconomics/fieldConfigs'

export interface TemplateEditorPageProps {
  draft: LessonContent
  templateId: string
  orgId: string
  storage: FirebaseStorage
  firestore: Firestore
  functions: Functions
  aiEnabled: boolean
  materialsUploadEnabled: boolean
  aiBetaState: AiBetaUiState
  onSaveDraft: (content: LessonContent) => void
  onPublish: () => void
  saving: boolean
  publishing: boolean
  sourceTemplateId?: string
  sourceTemplateTitle?: string
  derivatives?: CommunityTemplate[]
  moveOperationId?: string
  onReloadTemplate?: () => void
}

export function TemplateEditorPage({
  draft,
  templateId,
  orgId,
  storage,
  firestore,
  functions,
  aiEnabled,
  materialsUploadEnabled,
  aiBetaState,
  onSaveDraft,
  onPublish,
  saving,
  publishing,
  sourceTemplateTitle,
  derivatives = [],
  moveOperationId,
  onReloadTemplate,
}: TemplateEditorPageProps) {
  const [content, setContent] = useState(draft)
  const [tab, setTab] = useState(0)
  const [confirm, setConfirm] = useState(false)
  const [materials, setMaterials] = useState<MaterialDocument[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [aiError, setAiError] = useState('')

  // Move workflow state
  const [moveDialogOpen, setMoveDialogOpen] = useState(false)
  const [targetOrgId, setTargetOrgId] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [preview, setPreview] = useState<LessonTemplateMovePreview | null>(null)
  const [moveReason, setMoveReason] = useState('')
  const [confirmationText, setConfirmationText] = useState('')
  const [moving, setMoving] = useState(false)
  const [moveError, setMoveError] = useState('')
  const [activeMoveOpId, setActiveMoveOpId] = useState<string | undefined>(moveOperationId)
  const [moveOpStatus, setMoveOpStatus] = useState<LessonTemplateMoveOperationStatus | null>(null)

  useEffect(() => {
    setActiveMoveOpId(moveOperationId)
  }, [moveOperationId])

  useEffect(() => {
    if (!activeMoveOpId) {
      setMoveOpStatus(null)
      return
    }
    let cancelled = false
    const poll = async () => {
      try {
        const status = await getLessonTemplateMoveOperation(functions, {
          operationId: activeMoveOpId,
          sourceOrgId: orgId,
          targetOrgId: preview?.targetOrgId || orgId,
        })
        if (!cancelled) {
          setMoveOpStatus(status)
          if (status.status === 'COMPLETED') {
            onReloadTemplate?.()
          }
        }
      } catch {
        // ignore polling transient errors
      }
    }
    void poll()
    const timer = setInterval(() => { void poll() }, 3000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [activeMoveOpId, functions, onReloadTemplate, orgId, preview?.targetOrgId])

  const refresh = () => listMaterials(firestore, templateId).then(setMaterials).catch(() => setMaterials([]))
  useEffect(() => { if (aiEnabled && materialsUploadEnabled) void listMaterials(firestore, templateId).then(setMaterials).catch(() => setMaterials([])) }, [aiEnabled, firestore, materialsUploadEnabled, templateId])

  const isApproved = aiBetaState === 'APPROVED'

  const upload = async (file: File) => {
    if (!isApproved) return
    setUploading(true)
    setAiError('')
    try {
      await uploadMaterial(storage, firestore, orgId, templateId, file)
      await refresh()
    } catch (error) {
      setAiError(error instanceof Error ? error.message : '資料のアップロードに失敗しました。')
    } finally {
      setUploading(false)
    }
  }

  const regenerate = async () => {
    if (!isApproved) return
    setRegenerating(true)
    setAiError('')
    try {
      const result = await generateLessonDraft(functions, {
        theme: content.title,
        mainObjective: content.description,
        subject: content.subject,
        difficulty: 'STANDARD',
        materialTexts: materials.filter((material) => selected.includes(material.id)).map((material) => material.text),
      })
      setContent({ ...content, ...result })
    } catch (error) {
      setAiError(describeError(error, 'AI提案の生成に失敗しました。'))
    } finally {
      setRegenerating(false)
    }
  }

  const handleFetchPreview = async () => {
    if (!targetOrgId.trim() || targetOrgId === orgId) return
    setPreviewLoading(true)
    setPreviewError('')
    setPreview(null)
    try {
      const res = await previewLessonTemplateMove(functions, {
        templateId,
        sourceOrgId: orgId,
        targetOrgId: targetOrgId.trim(),
      })
      setPreview(res)
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : '移転プレビューの取得に失敗しました。')
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleExecuteMove = async () => {
    if (!preview || !preview.canMove || moveReason.trim().length === 0 || confirmationText !== targetOrgId.trim()) return
    setMoving(true)
    setMoveError('')
    try {
      const res = await moveLessonTemplate(functions, {
        templateId,
        sourceOrgId: orgId,
        targetOrgId: targetOrgId.trim(),
        reason: moveReason.trim(),
        confirmationText: confirmationText.trim(),
        idempotencyKey: crypto.randomUUID(),
      })
      setActiveMoveOpId(res.operationId)
      setMoveDialogOpen(false)
    } catch (error) {
      setMoveError(error instanceof Error ? error.message : '教材の移動に失敗しました。')
    } finally {
      setMoving(false)
    }
  }

  const isMoving = Boolean(activeMoveOpId)
  const social = content.socialStudiesMarket
  const home = content.homeEconomics
  const materialsTab = aiEnabled && materialsUploadEnabled ? 3 : -1

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      {isMoving && (
        <Alert severity="info" icon={<CircularProgress size={20} />}>
          別の組織へ移動処理中です。完了するまで教材の変更は制限されます。
          {moveOpStatus && (
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              状態: {moveOpStatus.status} (フェーズ: {moveOpStatus.phase})
              {moveOpStatus.lastError && ` - エラー: ${moveOpStatus.lastError}`}
            </Typography>
          )}
        </Alert>
      )}

      <TextField label="タイトル" value={content.title} onChange={(e) => setContent({ ...content, title: e.target.value })} disabled={isMoving} />
      {sourceTemplateTitle && <Typography variant="body2" color="text.secondary">この教材は「{sourceTemplateTitle}」から派生しています。</Typography>}

      <Tabs value={tab} onChange={(_, value) => setTab(value)}>
        <Tab label="基本情報" />
        <Tab label="主要な一覧" />
        <Tab label="評価の重み" />
        {materialsTab >= 0 && <Tab label="資料" />}
      </Tabs>

      {tab === 0 && <TextField label="説明" value={content.description} onChange={(e) => setContent({ ...content, description: e.target.value })} multiline minRows={2} disabled={isMoving} />}

      {tab === 1 && social && (
        <Stack spacing={3}>
          <Typography variant="h6">企業</Typography>
          <ArrayFieldEditor items={social.companies} fields={companyFields} itemLabel="企業" createEmptyItem={createEmptyCompany} onChange={(companies) => setContent({ ...content, socialStudiesMarket: { ...social, companies } })} />
          <Typography variant="h6">ニュース項目</Typography>
          <ArrayFieldEditor items={social.informationItems} fields={informationItemFields} itemLabel="ニュース項目" createEmptyItem={createEmptyInformationItem} onChange={(informationItems) => setContent({ ...content, socialStudiesMarket: { ...social, informationItems } })} />
        </Stack>
      )}

      {tab === 1 && home && (
        <Stack spacing={3}>
          <ArrayFieldEditor items={home.households} fields={householdProfileFields} itemLabel="担当プロフィール" getItemKey={(item) => item.householdId} createEmptyItem={createEmptyHouseholdProfile} onChange={(households) => setContent({ ...content, homeEconomics: { ...home, households } })} />
          <ArrayFieldEditor items={home.assets} fields={assetFields} itemLabel="資産" createEmptyItem={createEmptyAsset} onChange={(assets) => setContent({ ...content, homeEconomics: { ...home, assets } })} />
          <ArrayFieldEditor items={home.insuranceProducts} fields={insuranceProductFields} itemLabel="保険商品" createEmptyItem={createEmptyInsuranceProduct} onChange={(insuranceProducts) => setContent({ ...content, homeEconomics: { ...home, insuranceProducts } })} />
          <ArrayFieldEditor items={home.lifeEvents} fields={lifeEventFields} itemLabel="ライフイベント" createEmptyItem={createEmptyLifeEvent} onChange={(lifeEvents) => setContent({ ...content, homeEconomics: { ...home, lifeEvents } })} />
        </Stack>
      )}

      {tab === 2 && <Typography color="text.secondary">評価の重みはプリセットの配分で作成されます。</Typography>}

      {tab === materialsTab && (
        <Stack spacing={2}>
          {aiBetaState === 'LOCKED' && (
            <Alert severity="info">
              <Typography sx={{ fontWeight: 700 }}>AI提案（限定ベータ）</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                現在この機能は限定公開です。{'\n'}利用には運営者による許可が必要です。
              </Typography>
            </Alert>
          )}
          {aiBetaState === 'ERROR' && (
            <Alert severity="warning">
              AIベータの利用状態を確認できません。再読み込みしてもう一度お試しください。
            </Alert>
          )}
          <MaterialUploadPanel
            materials={materials}
            uploading={uploading}
            disabled={!isApproved}
            onUpload={(file) => void upload(file)}
            selectedIds={selected}
            onSelectionChange={setSelected}
          />
          {aiError && <Typography role="alert" color="error">{aiError}</Typography>}
          <Button
            variant="contained"
            disabled={!selected.length || regenerating || isMoving || !isApproved}
            onClick={() => void regenerate()}
          >
            資料を使ってAI提案を更新
          </Button>
        </Stack>
      )}

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button variant="outlined" disabled={saving || isMoving} onClick={() => onSaveDraft(content)}>下書き保存</Button>
        <Button variant="contained" disabled={publishing || isMoving} onClick={() => setConfirm(true)}>この内容で版を発行する</Button>
        <Button variant="outlined" color="warning" disabled={isMoving} onClick={() => setMoveDialogOpen(true)}>別の組織へ移動</Button>
      </Box>

      {/* Publish Dialog */}
      <Dialog open={confirm} onClose={() => setConfirm(false)}>
        <DialogTitle>版を発行しますか？</DialogTitle>
        <DialogContent><DialogContentText>版を発行すると、その内容は不変になります。</DialogContentText></DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(false)}>キャンセル</Button>
          <Button onClick={() => { setConfirm(false); onPublish() }}>発行する</Button>
        </DialogActions>
      </Dialog>

      {/* Move Dialog */}
      <Dialog open={moveDialogOpen} onClose={() => !moving && setMoveDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>教材を別の組織へ移動</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <DialogContentText>
              この教材の所有権を別の組織へ移動します。移動を行うには、移転元と移転先の両方の組織で所有者 (owner) 権限が必要です。
            </DialogContentText>

            <TextField
              label="移転先組織ID"
              value={targetOrgId}
              onChange={(e) => { setTargetOrgId(e.target.value); setPreview(null) }}
              disabled={previewLoading || moving}
              placeholder="例: school_abc123"
            />
            <Button
              variant="outlined"
              onClick={() => void handleFetchPreview()}
              disabled={previewLoading || !targetOrgId.trim() || targetOrgId.trim() === orgId || moving}
              sx={{ alignSelf: 'flex-start' }}
            >
              {previewLoading ? <CircularProgress size={20} /> : '影響を確認'}
            </Button>

            {previewError && <Alert severity="error">{previewError}</Alert>}

            {preview && (
              <Stack spacing={1.5} sx={{ p: 1.5, bgcolor: 'background.default', borderRadius: 1 }}>
                <Typography variant="subtitle2">移動による影響と内容:</Typography>
                <Typography variant="body2">• {preview.versionCount} 件の版と {preview.materialCount} 件の資料が移動します。</Typography>
                {preview.willUnpublishCommunity && <Typography variant="body2" color="warning.main">• COMMUNITY 公開は解除されます。</Typography>}
                <Typography variant="body2">• 組織内承認はリセットされます。</Typography>
                <Typography variant="body2">• 過去の授業実施履歴は移動しません（移転元組織に残ります）。</Typography>
                <Typography variant="body2">• レビューや通報の履歴は維持されます。</Typography>

                {preview.legacyMaterialCount > 0 && (
                  <Alert severity="error" sx={{ mt: 1 }}>
                    移行できない形式の資料が {preview.legacyMaterialCount} 件あります。安全のため所有権を移転できません。
                  </Alert>
                )}

                <Divider sx={{ my: 1 }} />

                <TextField
                  label="移転理由"
                  value={moveReason}
                  onChange={(e) => setMoveReason(e.target.value)}
                  multiline
                  minRows={2}
                  helperText="監査ログに記録されます (1〜500文字)"
                  disabled={moving}
                />

                <TextField
                  label={`確認のため移転先組織ID (${targetOrgId.trim()}) を入力`}
                  value={confirmationText}
                  onChange={(e) => setConfirmationText(e.target.value)}
                  disabled={moving}
                />

                {moveError && <Alert severity="error">{moveError}</Alert>}
              </Stack>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMoveDialogOpen(false)} disabled={moving}>キャンセル</Button>
          <Button
            variant="contained"
            color="warning"
            disabled={
              !preview
              || !preview.canMove
              || moving
              || moveReason.trim().length === 0
              || moveReason.trim().length > 500
              || confirmationText !== targetOrgId.trim()
            }
            onClick={() => void handleExecuteMove()}
          >
            {moving ? <CircularProgress size={20} /> : '教材を移動する'}
          </Button>
        </DialogActions>
      </Dialog>

      {derivatives.length > 0 && (
        <Stack spacing={1}>
          <Typography variant="subtitle2">この教材から派生した公開教材</Typography>
          <List>
            {derivatives.map((item) => (
              <ListItem key={item.id}>
                <ListItemText primary={item.title} secondary={item.description} />
              </ListItem>
            ))}
          </List>
        </Stack>
      )}
    </Stack>
  )
}

