import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HouseholdAssignmentPanel } from './HouseholdAssignmentPanel'
import type { HouseholdAssignmentView } from '../../lib/homeEconomics/householdAssignment'

const baseAssignment = (overrides: Partial<HouseholdAssignmentView> = {}): HouseholdAssignmentView => ({
  lessonRunId: 'run-1',
  courseFormat: 'ROLE_VARIANT',
  state: 'DRAFT',
  validationStatus: 'READY',
  assignmentRevision: 1,
  warnings: [],
  teams: [
    { teamId: 'team-a', teamDisplayName: 'チーム A', entries: [
      { householdId: 'h-a', profileId: 'profile-1', profileSummary: { lifeStage: 'INDEPENDENT', family: '単身' }, displayOrder: 0, assignmentSource: 'AUTO' },
    ] },
    { teamId: 'team-b', teamDisplayName: 'チーム B', entries: [
      { householdId: 'h-b', profileId: 'profile-2', profileSummary: { lifeStage: 'CHILD_REARING', family: '配偶者・子1人' }, displayOrder: 0, assignmentSource: 'AUTO' },
    ] },
  ],
  ...overrides,
})

describe('HouseholdAssignmentPanel', () => {
  it('UNPREPARED: shows prepare button for primary teacher and calls onPrepare', async () => {
    const assignment = baseAssignment({ state: 'UNPREPARED', teams: [] })
    const onPrepare = vi.fn().mockResolvedValue(undefined)
    render(
      <HouseholdAssignmentPanel
        assignment={assignment}
        isPrimaryTeacher={true}
        isBusy={false}
        onPrepare={onPrepare}
        onUpdate={vi.fn()}
      />,
    )

    const btn = screen.getByRole('button', { name: '割り当てを準備する' })
    fireEvent.click(btn)
    expect(onPrepare).toHaveBeenCalledTimes(1)
  })

  it('UNPREPARED: non-primary teacher sees no prepare button', () => {
    const assignment = baseAssignment({ state: 'UNPREPARED', teams: [] })
    render(
      <HouseholdAssignmentPanel
        assignment={assignment}
        isPrimaryTeacher={false}
        isBusy={false}
        onPrepare={vi.fn()}
        onUpdate={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: '割り当てを準備する' })).not.toBeInTheDocument()
  })

  it('DRAFT + READY: shows editable profile selectors labeled with translated profile summaries and status indicator, saves via onUpdate with the raw profileId (Project C)', async () => {
    const assignment = baseAssignment({ state: 'DRAFT', validationStatus: 'READY' })
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    render(
      <HouseholdAssignmentPanel
        assignment={assignment}
        isPrimaryTeacher={true}
        isBusy={false}
        onPrepare={vi.fn()}
        onUpdate={onUpdate}
      />,
    )

    expect(screen.getByText('検証状況: 準備完了')).toBeInTheDocument()
    const select = screen.getByLabelText('チーム A のプロフィール')
    expect(screen.getAllByRole('option', { name: '独立期・単身' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('option', { name: '子育て期・配偶者・子1人' }).length).toBeGreaterThan(0)
    fireEvent.change(select, { target: { value: 'profile-2' } })

    const saveBtn = screen.getByRole('button', { name: '変更を保存' })
    fireEvent.click(saveBtn)

    expect(onUpdate).toHaveBeenCalledWith({
      expectedRevision: 1,
      changes: [{ householdId: 'h-a', profileId: 'profile-2' }],
    })
    expect(document.body.textContent).not.toContain('profile-1')
    expect(document.body.textContent).not.toContain('profile-2')
  })

  it('STALE + INVALID: shows stale notice, invalid status, and warnings', () => {
    const assignment = baseAssignment({
      state: 'STALE',
      validationStatus: 'INVALID',
      warnings: [{ code: 'ENTRY_COUNT_MISMATCH', message: '割り当て件数が一致しません。' }],
    })
    render(
      <HouseholdAssignmentPanel
        assignment={assignment}
        isPrimaryTeacher={true}
        isBusy={false}
        onPrepare={vi.fn()}
        onUpdate={vi.fn()}
      />,
    )

    expect(screen.getByText(/古くなっている可能性/)).toBeInTheDocument()
    expect(screen.getByText('検証状況: 要修正')).toBeInTheDocument()
    expect(screen.getByText('割り当て件数が一致しません。')).toBeInTheDocument()
  })

  it('FROZEN: read-only, no selectors or save button rendered, and shows a translated profile label instead of the raw profileId', () => {
    const assignment = baseAssignment({ state: 'FROZEN' })
    render(
      <HouseholdAssignmentPanel
        assignment={assignment}
        isPrimaryTeacher={true}
        isBusy={false}
        onPrepare={vi.fn()}
        onUpdate={vi.fn()}
      />,
    )

    expect(screen.getByText(/ロックされ/)).toBeInTheDocument()
    expect(screen.queryByLabelText('チーム A のプロフィール')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '変更を保存' })).not.toBeInTheDocument()
    expect(screen.getByText('独立期・単身')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('profile-1')
  })

  it('role-gated: non-primary teacher sees read-only view even while DRAFT', () => {
    const assignment = baseAssignment({ state: 'DRAFT' })
    render(
      <HouseholdAssignmentPanel
        assignment={assignment}
        isPrimaryTeacher={false}
        isBusy={false}
        onPrepare={vi.fn()}
        onUpdate={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText('チーム A のプロフィール')).not.toBeInTheDocument()
    expect(screen.getByText('独立期・単身')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('profile-1')
  })

  it('isBusy disables editing controls', () => {
    const assignment = baseAssignment({ state: 'DRAFT' })
    render(
      <HouseholdAssignmentPanel
        assignment={assignment}
        isPrimaryTeacher={true}
        isBusy={true}
        onPrepare={vi.fn()}
        onUpdate={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('チーム A のプロフィール')).toBeDisabled()
  })

  it('ROLE_VARIANT: shows an unused-profile warning with a translated label after editing removes the last reference to a profile', () => {
    const assignment = baseAssignment({ state: 'DRAFT' })
    render(
      <HouseholdAssignmentPanel
        assignment={assignment}
        isPrimaryTeacher={true}
        isBusy={false}
        onPrepare={vi.fn()}
        onUpdate={vi.fn()}
      />,
    )

    expect(screen.queryByText(/未使用のプロフィール/)).not.toBeInTheDocument()

    const selectB = screen.getByLabelText('チーム B のプロフィール')
    fireEvent.change(selectB, { target: { value: 'profile-1' } })

    expect(screen.getByText('未使用のプロフィール: 子育て期・配偶者・子1人')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('profile-2')
  })

  it('STAGE_SPLIT: shows a coverage warning when STAGE_SPLIT_INSUFFICIENT_TEAMS is present', () => {
    const assignment = baseAssignment({
      courseFormat: 'STAGE_SPLIT',
      warnings: [{ code: 'STAGE_SPLIT_INSUFFICIENT_TEAMS', message: 'ライフステージ数以上のチーム数が必要です。' }],
    })
    render(
      <HouseholdAssignmentPanel
        assignment={assignment}
        isPrimaryTeacher={true}
        isBusy={false}
        onPrepare={vi.fn()}
        onUpdate={vi.fn()}
      />,
    )
    expect(screen.getByTestId('stage-coverage-warning')).toBeInTheDocument()
  })

  it('MULTI_PERSON_PER_TEAM: allows reordering displayOrder via up/down controls (labeled with a translated profile, not the raw profileId) but offers no add/remove control', () => {
    const assignment: HouseholdAssignmentView = {
      lessonRunId: 'run-1',
      courseFormat: 'MULTI_PERSON_PER_TEAM',
      state: 'DRAFT',
      validationStatus: 'READY',
      assignmentRevision: 4,
      warnings: [],
      teams: [
        { teamId: 'team-a', teamDisplayName: 'チーム A', entries: [
          { householdId: 'h-a1', profileId: 'profile-1', profileSummary: { lifeStage: 'INDEPENDENT', family: '単身' }, displayOrder: 0, assignmentSource: 'AUTO' },
          { householdId: 'h-a2', profileId: 'profile-2', profileSummary: { lifeStage: 'CHILD_REARING', family: '配偶者・子1人' }, displayOrder: 1, assignmentSource: 'AUTO' },
        ] },
      ],
    }
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    render(
      <HouseholdAssignmentPanel
        assignment={assignment}
        isPrimaryTeacher={true}
        isBusy={false}
        onPrepare={vi.fn()}
        onUpdate={onUpdate}
      />,
    )

    expect(screen.queryByRole('button', { name: /削除/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /追加/ })).not.toBeInTheDocument()

    const downBtn = screen.getByRole('button', { name: 'チーム A 独立期・単身 を下に移動' })
    fireEvent.click(downBtn)

    const saveBtn = screen.getByRole('button', { name: '変更を保存' })
    fireEvent.click(saveBtn)

    expect(onUpdate).toHaveBeenCalledWith({
      expectedRevision: 4,
      changes: expect.arrayContaining([
        { householdId: 'h-a1', displayOrder: 1 },
        { householdId: 'h-a2', displayOrder: 0 },
      ]),
    })
    expect(document.body.textContent).not.toContain('profile-1')
    expect(document.body.textContent).not.toContain('profile-2')
  })

  it('shows the fixed fallback copy, never the raw profileId, when profileSummary is null (Project C fail-closed)', () => {
    const assignment = baseAssignment({
      state: 'FROZEN',
      teams: [
        { teamId: 'team-a', teamDisplayName: 'チーム A', entries: [
          { householdId: 'h-a', profileId: 'profile-unresolved', profileSummary: null, displayOrder: 0, assignmentSource: 'AUTO' },
        ] },
      ],
    })
    render(
      <HouseholdAssignmentPanel
        assignment={assignment}
        isPrimaryTeacher={true}
        isBusy={false}
        onPrepare={vi.fn()}
        onUpdate={vi.fn()}
      />,
    )
    expect(screen.getByText('家庭プロフィールを確認できません')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('profile-unresolved')
  })
})
