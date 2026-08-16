import React, { useEffect, useMemo, useState } from 'react'
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
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-3">
        <h3 className="text-lg font-bold text-gray-900">家庭の割り当て</h3>
        <p className="text-sm text-gray-600">
          このコース形式（{COURSE_FORMAT_LABEL[assignment.courseFormat]}）では、授業開始前にチームへの家庭プロフィール割り当てを準備する必要があります。
        </p>
        {isPrimaryTeacher ? (
          <button
            type="button"
            onClick={handlePrepare}
            disabled={busy}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition shadow-sm"
          >
            {busy ? '準備中...' : '割り当てを準備する'}
          </button>
        ) : (
          <p className="text-xs text-gray-400">主担当の教師が割り当てを準備するまでお待ちください。</p>
        )}
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-bold text-gray-900">家庭の割り当て</h3>
          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
            {STATE_LABEL[assignment.state]}
          </span>
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
              assignment.validationStatus === 'READY'
                ? 'bg-green-100 text-green-800'
                : 'bg-red-100 text-red-700'
            }`}
          >
            検証状況: {assignment.validationStatus === 'READY' ? '準備完了' : '要修正'}
          </span>
        </div>

        {canEdit && dirtyChanges.length > 0 && (
          <button
            type="button"
            onClick={handleSave}
            disabled={busy}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition shadow-sm"
          >
            {busy ? '保存中...' : '変更を保存'}
          </button>
        )}
      </div>

      {assignment.state === 'STALE' && (
        <p className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
          この割り当てはチーム編成の変更により古くなっている可能性があります。内容を確認してください。
        </p>
      )}

      {assignment.state === 'FROZEN' && (
        <p className="text-xs font-semibold text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2">
          この割り当ては授業開始時にロックされ、変更できません。
        </p>
      )}

      {!isPrimaryTeacher && assignment.state !== 'FROZEN' && (
        <p className="text-xs text-gray-400">閲覧のみ（編集は主担当の教師のみ可能です）。</p>
      )}

      {assignment.warnings.length > 0 && (
        <div className="space-y-1">
          {assignment.warnings.map((w, idx) => (
            <div
              key={`${w.code}-${idx}`}
              className="text-xs px-2 py-1 rounded border bg-red-50 text-red-700 border-red-200"
            >
              {w.message}
            </div>
          ))}
        </div>
      )}

      {unusedProfileIds.length > 0 && (
        <div className="text-xs px-2 py-1 rounded border bg-amber-50 text-amber-800 border-amber-200">
          未使用のプロフィール: {unusedProfileIds.join(', ')}
        </div>
      )}

      {stageSplitCoverageWarnings.length > 0 && (
        <div className="text-xs px-2 py-1 rounded border bg-amber-50 text-amber-800 border-amber-200" data-testid="stage-coverage-warning">
          ライフステージの網羅状況に不足があります: {stageSplitCoverageWarnings.map((w) => w.message).join(' ')}
        </div>
      )}

      <div className="space-y-4">
        {assignment.teams.map((team) => {
          const sortedEntries = [...team.entries].sort((a, b) => {
            const orderA = localEntries[a.householdId]?.displayOrder ?? a.displayOrder
            const orderB = localEntries[b.householdId]?.displayOrder ?? b.displayOrder
            return orderA - orderB
          })
          return (
            <div key={team.teamId} className="border border-gray-200 rounded-lg p-3 space-y-2">
              <div className="font-semibold text-gray-900 text-sm">{team.teamDisplayName}</div>
              <ul className="space-y-1.5">
                {sortedEntries.map((entry, index) => {
                  const local = localEntries[entry.householdId] ?? { profileId: entry.profileId, displayOrder: entry.displayOrder }
                  return (
                    <li key={entry.householdId} className="flex items-center gap-2 text-sm text-gray-700">
                      {assignment.courseFormat === 'MULTI_PERSON_PER_TEAM' ? (
                        <>
                          <span className="flex-1">{entry.profileId}</span>
                          {canEdit && (
                            <span className="flex items-center gap-1">
                              <button
                                type="button"
                                aria-label={`${team.teamDisplayName} ${entry.profileId} を上に移動`}
                                onClick={() => handleMove(team.teamId, entry.householdId, 'up')}
                                disabled={busy || index === 0}
                                className="px-1.5 py-0.5 text-xs rounded border border-gray-300 disabled:opacity-30 hover:bg-gray-50"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                aria-label={`${team.teamDisplayName} ${entry.profileId} を下に移動`}
                                onClick={() => handleMove(team.teamId, entry.householdId, 'down')}
                                disabled={busy || index === sortedEntries.length - 1}
                                className="px-1.5 py-0.5 text-xs rounded border border-gray-300 disabled:opacity-30 hover:bg-gray-50"
                              >
                                ↓
                              </button>
                            </span>
                          )}
                        </>
                      ) : canEdit ? (
                        <label className="flex items-center gap-2 flex-1">
                          <span className="text-xs text-gray-500">プロフィール</span>
                          <select
                            aria-label={`${team.teamDisplayName} のプロフィール`}
                            value={local.profileId}
                            disabled={busy}
                            onChange={(e) => handleProfileChange(entry.householdId, e.target.value)}
                            className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                          >
                            {knownProfileIds.map((profileId) => (
                              <option key={profileId} value={profileId}>{profileId}</option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <span className="flex-1">{entry.profileId}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}
