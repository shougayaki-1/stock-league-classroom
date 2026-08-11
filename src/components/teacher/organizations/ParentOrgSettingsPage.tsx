import { useEffect, useState } from 'react'
import { Button, List, ListItem, ListItemText, Stack, TextField, Typography } from '@mui/material'
import type { ChildSchool } from '../../../lib/organizations/schoolHierarchy'
import type { ParentOrgQuotaUsageResult, SetSchoolQuotaAllocationInput } from '../../../lib/organizations/parentOrgQuota'

export interface ParentOrgSettingsPageProps {
  orgName: string
  childSchools: ChildSchool[]
  onLinkSchool: (id: string) => void
  linking: boolean
  onUnlinkSchool: (id: string) => void
  unlinking: boolean
  quotaUsage?: ParentOrgQuotaUsageResult
  canEditAllocations?: boolean
  onSetSchoolQuotaAllocation?: (input: SetSchoolQuotaAllocationInput) => void
  settingAllocation?: boolean
}

type AllocationDraft = { concurrentLessonsAndMarkets: string; teacherSeats: string }

const reservationCountFor = (school: ChildSchool, usage: ParentOrgQuotaUsageResult['schools'][number] | undefined): number => (
  usage
    ? usage.concurrentLessonsAndMarkets.reserved + usage.teacherSeats.reserved
    : school.sharedReservationCount ?? 0
)

export function ParentOrgSettingsPage({
  orgName,
  childSchools,
  onLinkSchool,
  linking,
  onUnlinkSchool,
  unlinking,
  quotaUsage,
  canEditAllocations = false,
  onSetSchoolQuotaAllocation,
  settingAllocation = false,
}: ParentOrgSettingsPageProps) {
  const [schoolOrgId, setSchoolOrgId] = useState('')
  const [drafts, setDrafts] = useState<Record<string, AllocationDraft>>({})
  const canEdit = canEditAllocations && onSetSchoolQuotaAllocation !== undefined

  useEffect(() => {
    if (!quotaUsage) return
    setDrafts((current) => {
      const next = { ...current }
      for (const school of quotaUsage.schools) {
        if (!next[school.schoolOrgId]) {
          next[school.schoolOrgId] = {
            concurrentLessonsAndMarkets: String(school.concurrentLessonsAndMarkets.guaranteed),
            teacherSeats: String(school.teacherSeats.guaranteed),
          }
        }
      }
      return next
    })
  }, [quotaUsage])

  const updateDraft = (schoolOrgId: string, key: keyof AllocationDraft, value: string) => {
    setDrafts((current) => ({
      ...current,
      [schoolOrgId]: { ...(current[schoolOrgId] ?? { concurrentLessonsAndMarkets: '0', teacherSeats: '0' }), [key]: value },
    }))
  }

  const submitAllocation = (schoolOrgId: string) => {
    const draft = drafts[schoolOrgId]
    if (!draft || !onSetSchoolQuotaAllocation || !quotaUsage) return
    onSetSchoolQuotaAllocation({
      parentOrgId: quotaUsage.parentOrgId,
      schoolOrgId,
      guaranteedConcurrentLessonsAndMarkets: Math.max(0, Number.parseInt(draft.concurrentLessonsAndMarkets, 10) || 0),
      guaranteedTeacherSeats: Math.max(0, Number.parseInt(draft.teacherSeats, 10) || 0),
    })
  }

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Typography variant="h5">{orgName}</Typography>

      {quotaUsage && (
        <Stack spacing={1}>
          <Typography variant="subtitle1">上位組織の利用枠</Typography>
          <Typography variant="body2">
            同時授業・市場数: 上限 {quotaUsage.concurrentLessonsAndMarkets.limit} / 保証 {quotaUsage.concurrentLessonsAndMarkets.guaranteed} / 共有残 {quotaUsage.concurrentLessonsAndMarkets.sharedAvailable} / 予約 {quotaUsage.concurrentLessonsAndMarkets.reserved}
          </Typography>
          <Typography variant="body2">
            教師席: 上限 {quotaUsage.teacherSeats.limit} / 保証 {quotaUsage.teacherSeats.guaranteed} / 共有残 {quotaUsage.teacherSeats.sharedAvailable} / 予約 {quotaUsage.teacherSeats.reserved}
          </Typography>
          {!canEdit && <Typography variant="body2" color="text.secondary">配分の変更はownerまたはadminのみ可能です。</Typography>}
        </Stack>
      )}

      <Stack spacing={2}>
        <Typography variant="subtitle1">学校を追加</Typography>
        <TextField label="学校の組織ID" value={schoolOrgId} onChange={(e) => setSchoolOrgId(e.target.value)} />
        <Button variant="contained" disabled={linking || !schoolOrgId} onClick={() => { onLinkSchool(schoolOrgId); setSchoolOrgId('') }} sx={{ alignSelf: 'flex-start' }}>追加</Button>
      </Stack>

      <Stack spacing={1}>
        <Typography variant="subtitle1">所属する学校</Typography>
        {childSchools.length === 0 ? <Typography variant="body2" color="text.secondary">まだ学校が紐付けられていません。</Typography> : (
          <List>
            {childSchools.map((school) => {
              const usage = quotaUsage?.schools.find((item) => item.schoolOrgId === school.orgId)
              const reservationCount = reservationCountFor(school, usage)
              const unlinkReason = school.unlinkBlockedReason ?? (reservationCount > 0 ? '共有枠の予約が残っているため学校を解除できません' : undefined)
              const draft = drafts[school.orgId] ?? {
                concurrentLessonsAndMarkets: String(usage?.concurrentLessonsAndMarkets.guaranteed ?? 0),
                teacherSeats: String(usage?.teacherSeats.guaranteed ?? 0),
              }
              return (
                <ListItem key={school.orgId} sx={{ display: 'block' }}>
                  <Stack spacing={1}>
                    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 2 }}>
                      <ListItemText primary={school.name} secondary={school.verificationStatus} />
                      <Button size="small" disabled={unlinking || reservationCount > 0} onClick={() => onUnlinkSchool(school.orgId)}>解除</Button>
                    </Stack>
                    {unlinkReason && <Typography variant="body2" color="error">{unlinkReason}</Typography>}
                    {usage && (
                      <Stack spacing={0.5} sx={{ pl: 1 }}>
                        <Typography variant="body2">同時授業・市場数: 保証 {usage.concurrentLessonsAndMarkets.guaranteed} / 使用中 {usage.concurrentLessonsAndMarkets.usage} / 共有予約 {usage.concurrentLessonsAndMarkets.reserved}</Typography>
                        <Typography variant="body2">教師席: 保証 {usage.teacherSeats.guaranteed} / 使用中 {usage.teacherSeats.usage} / 共有予約 {usage.teacherSeats.reserved}</Typography>
                        {canEdit && (
                          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-end', flexDirection: { xs: 'column', sm: 'row' } }}>
                            <TextField
                              size="small"
                              type="number"
                              label="同時授業・市場数の保証"
                              value={draft.concurrentLessonsAndMarkets}
                              onChange={(event) => updateDraft(school.orgId, 'concurrentLessonsAndMarkets', event.target.value)}
                              slotProps={{ htmlInput: { min: 0, step: 1 } }}
                            />
                            <TextField
                              size="small"
                              type="number"
                              label="教師席の保証"
                              value={draft.teacherSeats}
                              onChange={(event) => updateDraft(school.orgId, 'teacherSeats', event.target.value)}
                              slotProps={{ htmlInput: { min: 0, step: 1 } }}
                            />
                            <Button size="small" variant="outlined" disabled={settingAllocation} onClick={() => submitAllocation(school.orgId)}>配分を保存</Button>
                          </Stack>
                        )}
                      </Stack>
                    )}
                  </Stack>
                </ListItem>
              )
            })}
          </List>
        )}
      </Stack>
    </Stack>
  )
}
