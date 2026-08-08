import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import GroupsIcon from '@mui/icons-material/Groups'
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'
import WifiOffIcon from '@mui/icons-material/WifiOff'
import { List, ListItem, Stack, Typography } from '@mui/material'
import type { LessonParticipantView } from '../../lib/lessonRuns/participants'

export interface ParticipantMonitorProps {
  participants: LessonParticipantView[]
  /** 名簿上の想定参加者数。分かっている場合のみ「未参加」件数を計算する。 */
  expectedParticipantCount?: number
}

/** Statuses that read as "disconnected" to a teacher scanning the roster (§6.5's connection-handling scope). */
const DISCONNECTED_STATUSES: ReadonlySet<LessonParticipantView['status']> = new Set([
  'TEMPORARILY_DISCONNECTED',
  'MIGRATING_DEVICE',
  'ABSENT',
])

/**
 * A team is flagged as imbalanced when its size differs from another team's
 * size by 2 or more. This threshold is a design judgment (not specified in
 * the integration spec) — a difference of 1 is normal roster noise (odd
 * headcounts), while 2+ usually means a join/assignment problem worth a
 * teacher's attention.
 */
const IMBALANCE_THRESHOLD = 2

function teamSizeImbalance(participants: LessonParticipantView[]): boolean {
  const sizes = new Map<string, number>()
  for (const p of participants) {
    if (!p.teamId) continue
    sizes.set(p.teamId, (sizes.get(p.teamId) ?? 0) + 1)
  }
  const counts = [...sizes.values()]
  if (counts.length < 2) return false
  return Math.max(...counts) - Math.min(...counts) >= IMBALANCE_THRESHOLD
}

function duplicateIdentifierIds(participants: LessonParticipantView[]): Set<string> {
  const byIdentifier = new Map<string, string[]>()
  for (const p of participants) {
    if (!p.externalIdentifier) continue
    const list = byIdentifier.get(p.externalIdentifier) ?? []
    list.push(p.id)
    byIdentifier.set(p.externalIdentifier, list)
  }
  const flagged = new Set<string>()
  for (const ids of byIdentifier.values()) {
    if (ids.length > 1) for (const id of ids) flagged.add(id)
  }
  return flagged
}

/**
 * Teacher-only participant roster. Reads Firestore data via the parent
 * (Task 11's `LessonControlRoom`, using `subscribeLessonParticipants` from
 * lib/lessonRuns/participants.ts) — deliberately NOT the RTDB live
 * projections in lib/lessonRuns/liveRepository.ts (Task 10), which are
 * stripped of real names and per-participant status for the whole-class
 * broadcast. `participants[].displayName` is the real name (統合仕様書
 * §23.6) and is safe to render as-is because this component is teacher-only.
 *
 * Every status signal here pairs an icon with text — never color alone
 * (same accessibility principle as lessonInputs/, see e.g.
 * SingleChoiceInput.tsx's non-color selection state).
 */
export function ParticipantMonitor({ participants, expectedParticipantCount }: ParticipantMonitorProps) {
  const imbalanced = teamSizeImbalance(participants)
  const duplicates = duplicateIdentifierIds(participants)
  const notYetJoined = expectedParticipantCount !== undefined
    ? Math.max(expectedParticipantCount - participants.length, 0)
    : undefined

  return (
    <Stack spacing={1} sx={{ width: '100%' }}>
      {notYetJoined !== undefined && (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <HourglassEmptyIcon fontSize="small" aria-hidden="true" />
          <Typography variant="body2">未参加 {notYetJoined}人</Typography>
        </Stack>
      )}
      {imbalanced && (
        <Stack direction="row" spacing={0.5} role="status" sx={{ alignItems: 'center' }}>
          <GroupsIcon fontSize="small" color="warning" aria-hidden="true" />
          <Typography variant="body2" sx={{ fontWeight: 700 }}>チーム人数に偏りがあります</Typography>
        </Stack>
      )}
      <List aria-label="参加者一覧" dense sx={{ py: 0 }}>
        {participants.map((participant) => {
          const disconnected = DISCONNECTED_STATUSES.has(participant.status)
          const duplicate = duplicates.has(participant.id)
          return (
            <ListItem key={participant.id} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.5 }}>
              <Typography sx={{ fontWeight: 700 }}>{participant.displayName}</Typography>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                {disconnected ? (
                  <WifiOffIcon fontSize="small" color="error" aria-hidden="true" />
                ) : (
                  <CheckCircleIcon fontSize="small" color="success" aria-hidden="true" />
                )}
                <Typography variant="body2">{disconnected ? '切断中' : '参加済み'}</Typography>
              </Stack>
              {duplicate && (
                <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                  <ContentCopyIcon fontSize="small" color="warning" aria-hidden="true" />
                  <Typography variant="body2">出席番号の重複の疑いがあります</Typography>
                </Stack>
              )}
            </ListItem>
          )
        })}
      </List>
    </Stack>
  )
}
