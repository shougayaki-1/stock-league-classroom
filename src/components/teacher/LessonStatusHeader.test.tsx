import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LessonStatusHeader } from './LessonStatusHeader'

describe('LessonStatusHeader', () => {
  it('shows all 5 top-of-viewport items: next action, current phase, participation summary, open issues, and display preview', () => {
    render(
      <LessonStatusHeader
        phaseLabel="フェーズ2: 投資判断"
        nextAction={{ label: '次のフェーズへ進む', onActivate: vi.fn() }}
        participationSummary="参加 18人 / 未参加 2人 / 切断 1人"
        openIssues={['チームBが1名のみ参加しています']}
        displayPreview="教室表示: フェーズ2の説明スライド"
      />,
    )

    expect(screen.getByRole('heading', { name: '次にすること' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '次のフェーズへ進む' })).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: '現在のフェーズ' })).toBeInTheDocument()
    expect(screen.getByText('フェーズ2: 投資判断')).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: '参加・接続・提出状況' })).toBeInTheDocument()
    expect(screen.getByText('参加 18人 / 未参加 2人 / 切断 1人')).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: '未対応の問題' })).toBeInTheDocument()
    expect(screen.getByText('チームBが1名のみ参加しています')).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: '教室表示で現在見えている内容' })).toBeInTheDocument()
    expect(screen.getByText('教室表示: フェーズ2の説明スライド')).toBeInTheDocument()
  })

  it('renders exactly one primary CTA button — never multiple competing main actions', () => {
    render(
      <LessonStatusHeader
        phaseLabel="フェーズ1"
        nextAction={{ label: '授業を開始', onActivate: vi.fn() }}
        participationSummary="参加 0人"
        openIssues={[]}
        displayPreview="教室表示: 開始待機画面"
      />,
    )
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('shows "対応が必要な問題はありません" with a check icon when there are no open issues, not just a blank list', () => {
    render(
      <LessonStatusHeader
        phaseLabel="フェーズ1"
        nextAction={null}
        participationSummary="参加 0人"
        openIssues={[]}
        displayPreview="教室表示: 開始待機画面"
      />,
    )
    expect(screen.getByText('対応が必要な問題はありません')).toBeInTheDocument()
  })

  it('keeps the CTA visible but disabled with an adjacent reason when the action is temporarily blocked (not authorization) — aria-disabled + aria-describedby, not a hidden button', () => {
    const onActivate = vi.fn()
    render(
      <LessonStatusHeader
        phaseLabel="フェーズ1"
        nextAction={{ label: '次のフェーズへ進む', disabledReason: '全チームの提出が完了していません', onActivate }}
        participationSummary="参加 18人"
        openIssues={[]}
        displayPreview="教室表示: フェーズ1"
      />,
    )
    const button = screen.getByRole('button', { name: '次のフェーズへ進む' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText(/全チームの提出が完了していません/)).toBeInTheDocument()
    expect(button).toHaveAttribute('aria-describedby')
  })

  it('shows a no-action explanation instead of a button when the teacher role has no authority for any action here (authorization-driven, not temporary)', () => {
    render(
      <LessonStatusHeader
        phaseLabel="フェーズ1"
        nextAction={null}
        noActionReason="閲覧担当のため、この画面から操作はできません"
        participationSummary="参加 18人"
        openIssues={[]}
        displayPreview="教室表示: フェーズ1"
      />,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('閲覧担当のため、この画面から操作はできません')).toBeInTheDocument()
  })

  it('activates the CTA via keyboard alone (Tab + Enter)', async () => {
    const user = userEvent.setup()
    const onActivate = vi.fn()
    render(
      <LessonStatusHeader
        phaseLabel="フェーズ1"
        nextAction={{ label: '次のフェーズへ進む', onActivate }}
        participationSummary="参加 18人"
        openIssues={[]}
        displayPreview="教室表示: フェーズ1"
      />,
    )
    await user.tab()
    expect(screen.getByRole('button', { name: '次のフェーズへ進む' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('lists multiple open issues with an icon-plus-text pattern, not color alone', () => {
    render(
      <LessonStatusHeader
        phaseLabel="フェーズ1"
        nextAction={null}
        participationSummary="参加 18人"
        openIssues={['重複参加の疑いがあります', '1人が切断中です']}
        displayPreview="教室表示: フェーズ1"
      />,
    )
    const list = screen.getByRole('list', { name: '未対応の問題' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByText('重複参加の疑いがあります')).toBeInTheDocument()
  })
})
