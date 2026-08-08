import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ParticipantMonitor } from './ParticipantMonitor'
import type { LessonParticipantView } from '../../lib/lessonRuns/participants'

const base: LessonParticipantView = {
  id: 'p-1', lessonRunId: 'run-1', orgId: 'org-1', authUid: 'uid-1',
  identityMode: 'SCHOOL_ACCOUNT', displayName: '山田太郎', teamId: 'team-a',
  status: 'ACTIVE', sessionVersion: 1,
}

describe('ParticipantMonitor', () => {
  it('shows the teacher the participant\'s real display name (§23.6 教師画面は本名を表示)', () => {
    render(<ParticipantMonitor participants={[base]} />)
    expect(screen.getByText('山田太郎')).toBeInTheDocument()
  })

  it('marks an ACTIVE participant as joined with icon + text, not color alone', () => {
    render(<ParticipantMonitor participants={[base]} />)
    const row = screen.getByText('山田太郎').closest('li')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('参加済み')).toBeInTheDocument()
    // an icon element (svg) must accompany the text, not stand alone
    expect((row as HTMLElement).querySelector('svg')).not.toBeNull()
  })

  it('flags a TEMPORARILY_DISCONNECTED participant as disconnected with text', () => {
    render(<ParticipantMonitor participants={[{ ...base, id: 'p-2', displayName: '鈴木花子', status: 'TEMPORARILY_DISCONNECTED' }]} />)
    const row = screen.getByText('鈴木花子').closest('li')
    expect(within(row as HTMLElement).getByText('切断中')).toBeInTheDocument()
  })

  it('flags participants sharing the same externalIdentifier as a duplicate warning', () => {
    render(
      <ParticipantMonitor
        participants={[
          { ...base, id: 'p-1', displayName: '田中一郎', externalIdentifier: '15' },
          { ...base, id: 'p-2', displayName: '田中二郎', externalIdentifier: '15' },
        ]}
      />,
    )
    const row1 = screen.getByText('田中一郎').closest('li')
    const row2 = screen.getByText('田中二郎').closest('li')
    expect(within(row1 as HTMLElement).getByText(/出席番号の重複/)).toBeInTheDocument()
    expect(within(row2 as HTMLElement).getByText(/出席番号の重複/)).toBeInTheDocument()
  })

  it('shows the number of participants who have not yet joined when expectedParticipantCount is given', () => {
    render(<ParticipantMonitor participants={[base]} expectedParticipantCount={5} />)
    expect(screen.getByText(/未参加\s*4人/)).toBeInTheDocument()
  })

  it('flags a team-size imbalance across teams with text, not color alone', () => {
    const participants: LessonParticipantView[] = [
      { ...base, id: 'p-1', teamId: 'team-a', displayName: 'A1' },
      { ...base, id: 'p-2', teamId: 'team-a', displayName: 'A2' },
      { ...base, id: 'p-3', teamId: 'team-a', displayName: 'A3' },
      { ...base, id: 'p-4', teamId: 'team-b', displayName: 'B1' },
    ]
    render(<ParticipantMonitor participants={participants} />)
    expect(screen.getByText(/チーム人数に偏りがあります/)).toBeInTheDocument()
  })

  it('does not flag a team imbalance when team sizes are even', () => {
    const participants: LessonParticipantView[] = [
      { ...base, id: 'p-1', teamId: 'team-a', displayName: 'A1' },
      { ...base, id: 'p-2', teamId: 'team-a', displayName: 'A2' },
      { ...base, id: 'p-3', teamId: 'team-b', displayName: 'B1' },
      { ...base, id: 'p-4', teamId: 'team-b', displayName: 'B2' },
    ]
    render(<ParticipantMonitor participants={participants} />)
    expect(screen.queryByText(/チーム人数に偏りがあります/)).not.toBeInTheDocument()
  })
})
