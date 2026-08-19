import React, { useEffect, useMemo, useState } from 'react'
import { Box, Button, IconButton, Stack, Typography } from '@mui/material'
import type {
  HouseholdAssignmentView,
} from '../../lib/homeEconomics/householdAssignment'
import type { UpdateHouseholdAssignmentInput } from '../../lib/homeEconomics/householdAssignment'

export interface HouseholdAssignmentPanelProps {
  assignment: HouseholdAssignmentView
  isPrimaryTeacher: boolean
  isBusy: boolean
  onPrepare: () => Promise<void>
  onUpdate: (input: Omit<UpdateHouseholdAssignmentInput, 'lessonRunId' | 'idempotencyKey'>) => Promise<void>
}

interface LocalEntryState {
  profileId: string
  displayOrder: number
}

const STATE_LABEL: Record<HouseholdAssignmentView['state'], string> = {
  UNPREPARED: '未準備',
  DRAFT: '編集中',
  STALE: '要再確認',
  FROZEN: 'ロック済み',
}

const COURSE_FORMAT_LABEL: Record<HouseholdAssignmentView['courseFormat'], string> = {
  COMMON_CONDITIONS: '共通条件',
  ROLE_VARIANT: '役割バリエーション',
  STAGE_SPLIT: 'ライフステージ別',
  MULTI_PERSON_PER_TEAM: '複数人同時プレイ',
}

const buildLocalEntries = (assignment: HouseholdAssignmentView): Record<string, LocalEntryState> => {
  const map: Record<string, LocalEntryState> = {}
  for (const team of assignment.teams) {
    for (const entry of team.entries) {
      map[entry.householdId] = { profileId: entry.profileId, displayOrder: entry.displayOrder }
    }
  }
  return map
}

const StatusChip = ({ label, tone }: { label: string; tone: 'neutral' | 'success' | 'error' }) => (
  <Box
    component="span"
    sx={{
      px: 1, py: 0.25, borderRadius: 4, fontSize: '0.75rem', fontWeight: 600,
      bgcolor: tone === 'success' ? 'success.light' : tone === 'error' ? 'error.light' : 'grey.100',
      color: tone === 'success' ? 'success.dark' : tone === 'error' ? 'error.dark' : 'text.secondary',
    }}
  >
    {label}
  </Box>
)

const NoticeBanner = ({ tone, children, testId }: { tone: 'warning' | 'neutral'; children: React.ReactNode; testId?: string }) => (
  <Typography
    variant="caption"
    component="p"
    data-testid={testId}
    sx={{
      fontWeight: 600, px: 1, py: 0.5, borderRadius: 1.5, border: 1,
      bgcolor: tone === 'warning' ? 'warning.light' : 'grey.50',
      borderColor: tone === 'warning' ? 'warning.main' : 'grey.300',
      color: tone === 'warning' ? 'warning.dark' : 'text.secondary',
    }}
  >
    {children}
  </Typography>
)

export const HouseholdAssignmentPanel: React.FC<HouseholdAssignmentPanelProps> = ({
  assignment,
  isPrimaryTeacher,
  isBusy,
  onPrepare,
  onUpdate,
}) => {
  const [localEntries, setLocalEntries] = useState<Record<string, LocalEntryState>>(() => buildLocalEntries(assignment))
  const [isLocalSubmitting, setIsLocalSubmitting] = useState(false)

  // Reset local edit buffer whenever the server-side assignment changes
  // (a fresh prepare/update round-trip, or a poll picking up someone else's edit).
  useEffect(() => {
    setLocalEntries(buildLocalEntries(assignment))
  }, [assignment])

  const busy = isBusy || isLocalSubmitting

  const knownProfileIds = useMemo(() => {
    const set = new Set<string>()
    for (const team of assignment.teams) {
      for (const entry of team.entries) set.add(entry.profileId)
    }
    return [...set].sort()
  }, [assignment])

  const currentlyUsedProfileIds = useMemo(
    () => new Set(Object.values(localEntries).map((v) => v.profileId)),
    [localEntries],
  )

  const unusedProfileIds = assignment.courseFormat === 'ROLE_VARIANT'
    ? knownProfileIds.filter((id) => !currentlyUsedProfileIds.has(id))
    : []

  const stageSplitCoverageWarnings = assignment.courseFormat === 'STAGE_SPLIT'
    ? assignment.warnings.filter((w) => w.code === 'STAGE_SPLIT_INSUFFICIENT_TEAMS')
    : []

  const canEdit = isPrimaryTeacher && (assignment.state === 'DRAFT' || assignment.state === 'STALE')

  const dirtyChanges = useMemo(() => {
    const changes: UpdateHouseholdAssignmentInput['changes'] = []
    for (const team of assignment.teams) {
      for (const entry of team.entries) {
        const local = localEntries[entry.householdId]
        if (!local) continue
        const profileChanged = local.profileId !== entry.profileId
        const orderChanged = local.displayOrder !== entry.displayOrder
        if (!profileChanged && !orderChanged) continue
        changes.push({
          householdId: entry.householdId,
          ...(profileChanged ? { profileId: local.profileId } : {}),
          ...(orderChanged ? { displayOrder: local.displayOrder } : {}),
        })
      }
    }
    return changes
  }, [assignment, localEntries])

  const handlePrepare = async () => {
    if (!isPrimaryTeacher || busy) return
    setIsLocalSubmitting(true)
    try {
      await onPrepare()
    } finally {
      setIsLocalSubmitting(false)
    }
  }

  const handleSave = async () => {
    if (!canEdit || dirtyChanges.length === 0 || assignment.assignmentRevision === null) return
    setIsLocalSubmitting(true)
    try {
      await onUpdate({ expectedRevision: assignment.assignmentRevision, changes: dirtyChanges })
    } finally {
      setIsLocalSubmitting(false)
    }
  }

  const handleProfileChange = (householdId: string, profileId: string) => {
    setLocalEntries((prev) => ({ ...prev, [householdId]: { ...prev[householdId], profileId } }))
  }

  const handleMove = (teamId: string, householdId: string, direction: 'up' | 'down') => {
    const team = assignment.teams.find((t) => t.teamId === teamId)
    if (!team) return
    const sorted = [...team.entries].sort((a, b) => {
      const orderA = localEntries[a.householdId]?.displayOrder ?? a.displayOrder
      const orderB = localEntries[b.householdId]?.displayOrder ?? b.displayOrder
      return orderA - orderB
    })
    const index = sorted.findIndex((e) => e.householdId === householdId)
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    if (index < 0 || swapIndex < 0 || swapIndex >= sorted.length) return
    const current = sorted[index]
    const neighbor = sorted[swapIndex]
    const currentOrder = localEntries[current.householdId]?.displayOrder ?? current.displayOrder
    const neighborOrder = localEntries[neighbor.householdId]?.displayOrder ?? neighbor.displayOrder
    setLocalEntries((prev) => ({
      ...prev,
      [current.householdId]: { ...prev[current.householdId], displayOrder: neighborOrder },
      [neighbor.householdId]: { ...prev[neighbor.householdId], displayOrder: currentOrder },
    }))
  }

  if (assignment.state === 'UNPREPARED') {
    return (
      <Stack spacing={1.5} sx={{ bgcolor: 'background.paper', borderRadius: '12px', boxShadow: 1, border: 1, borderColor: 'grey.200', p: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>家庭の割り当て</Typography>
        <Typography variant="body2" color="text.secondary">
          このコース形式（{COURSE_FORMAT_LABEL[assignment.courseFormat]}）では、授業開始前にチームへの家庭プロフィール割り当てを準備する必要があります。
        </Typography>
        {isPrimaryTeacher ? (
          <Button
            variant="contained"
            onClick={() => { void handlePrepare() }}
            disabled={busy}
            sx={{ alignSelf: 'flex-start' }}
          >
            {busy ? '準備中...' : '割り当てを準備する'}
          </Button>
        ) : (
          <Typography variant="caption" color="text.disabled">主担当の教師が割り当てを準備するまでお待ちください。</Typography>
        )}
      </Stack>
    )
  }

  return (
    <Stack spacing={2} sx={{ bgcolor: 'background.paper', borderRadius: '12px', boxShadow: 1, border: 1, borderColor: 'grey.200', p: 3 }}>
      <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>家庭の割り当て</Typography>
          <StatusChip label={STATE_LABEL[assignment.state]} tone="neutral" />
          <StatusChip
            label={`検証状況: ${assignment.validationStatus === 'READY' ? '準備完了' : '要修正'}`}
            tone={assignment.validationStatus === 'READY' ? 'success' : 'error'}
          />
        </Stack>

        {canEdit && dirtyChanges.length > 0 && (
          <Button variant="contained" onClick={() => { void handleSave() }} disabled={busy}>
            {busy ? '保存中...' : '変更を保存'}
          </Button>
        )}
      </Stack>

      {assignment.state === 'STALE' && (
        <NoticeBanner tone="warning">この割り当てはチーム編成の変更により古くなっている可能性があります。内容を確認してください。</NoticeBanner>
      )}

      {assignment.state === 'FROZEN' && (
        <NoticeBanner tone="neutral">この割り当ては授業開始時にロックされ、変更できません。</NoticeBanner>
      )}

      {!isPrimaryTeacher && assignment.state !== 'FROZEN' && (
        <Typography variant="caption" color="text.disabled">閲覧のみ（編集は主担当の教師のみ可能です）。</Typography>
      )}

      {assignment.warnings.length > 0 && (
        <Stack spacing={0.5}>
          {assignment.warnings.map((w, idx) => (
            <Typography
              key={`${w.code}-${idx}`}
              variant="caption"
              sx={{ px: 1, py: 0.5, borderRadius: 1, border: 1, bgcolor: 'error.light', color: 'error.dark', borderColor: 'error.main' }}
            >
              {w.message}
            </Typography>
          ))}
        </Stack>
      )}

      {unusedProfileIds.length > 0 && (
        <NoticeBanner tone="warning">未使用のプロフィール: {unusedProfileIds.join(', ')}</NoticeBanner>
      )}

      {stageSplitCoverageWarnings.length > 0 && (
        <NoticeBanner tone="warning" testId="stage-coverage-warning">
          ライフステージの網羅状況に不足があります: {stageSplitCoverageWarnings.map((w) => w.message).join(' ')}
        </NoticeBanner>
      )}

      <Stack spacing={2}>
        {assignment.teams.map((team) => {
          const sortedEntries = [...team.entries].sort((a, b) => {
            const orderA = localEntries[a.householdId]?.displayOrder ?? a.displayOrder
            const orderB = localEntries[b.householdId]?.displayOrder ?? b.displayOrder
            return orderA - orderB
          })
          return (
            <Box key={team.teamId} sx={{ border: 1, borderColor: 'grey.200', borderRadius: 2, p: 1.5 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>{team.teamDisplayName}</Typography>
              <Stack component="ul" spacing={0.75} sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {sortedEntries.map((entry, index) => {
                  const local = localEntries[entry.householdId] ?? { profileId: entry.profileId, displayOrder: entry.displayOrder }
                  return (
                    <Stack
                      key={entry.householdId}
                      component="li"
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', fontSize: '0.875rem', color: 'text.secondary' }}
                    >
                      {assignment.courseFormat === 'MULTI_PERSON_PER_TEAM' ? (
                        <>
                          <Box component="span" sx={{ flex: 1 }}>{entry.profileId}</Box>
                          {canEdit && (
                            <Stack direction="row" spacing={0.5}>
                              <IconButton
                                size="small"
                                aria-label={`${team.teamDisplayName} ${entry.profileId} を上に移動`}
                                onClick={() => handleMove(team.teamId, entry.householdId, 'up')}
                                disabled={busy || index === 0}
                                sx={{ border: 1, borderColor: 'grey.300', borderRadius: 1, px: 0.75, fontSize: '0.75rem' }}
                              >
                                ↑
                              </IconButton>
                              <IconButton
                                size="small"
                                aria-label={`${team.teamDisplayName} ${entry.profileId} を下に移動`}
                                onClick={() => handleMove(team.teamId, entry.householdId, 'down')}
                                disabled={busy || index === sortedEntries.length - 1}
                                sx={{ border: 1, borderColor: 'grey.300', borderRadius: 1, px: 0.75, fontSize: '0.75rem' }}
                              >
                                ↓
                              </IconButton>
                            </Stack>
                          )}
                        </>
                      ) : canEdit ? (
                        <Stack component="label" direction="row" spacing={1} sx={{ alignItems: 'center', flex: 1 }}>
                          <Typography variant="caption" color="text.disabled">プロフィール</Typography>
                          <Box
                            component="select"
                            aria-label={`${team.teamDisplayName} のプロフィール`}
                            value={local.profileId}
                            disabled={busy}
                            onChange={(e) => handleProfileChange(entry.householdId, e.target.value)}
                            sx={{
                              flex: 1, borderRadius: 1, border: 1, borderColor: 'grey.300', px: 1, py: 0.5,
                              fontSize: '0.875rem', fontFamily: 'inherit', bgcolor: 'background.paper',
                            }}
                          >
                            {knownProfileIds.map((profileId) => (
                              <option key={profileId} value={profileId}>{profileId}</option>
                            ))}
                          </Box>
                        </Stack>
                      ) : (
                        <Box component="span" sx={{ flex: 1 }}>{entry.profileId}</Box>
                      )}
                    </Stack>
                  )
                })}
              </Stack>
            </Box>
          )
        })}
      </Stack>
    </Stack>
  )
}
