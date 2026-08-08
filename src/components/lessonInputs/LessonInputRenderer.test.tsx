import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LessonInputRenderer } from './LessonInputRenderer'

// Minimal local useState wrapper so test harness components stay in this file.
function useValueState<T>() {
  return useState<T | undefined>(undefined)
}

describe('LessonInputRenderer', () => {
  it('renders only the widget matching config.type and none of the others', () => {
    render(<LessonInputRenderer config={{ type: 'SINGLE_CHOICE', options: ['A社', 'B社'] }} value={undefined} onChange={vi.fn()} />)
    // SINGLE_CHOICE widget is present.
    expect(screen.getByRole('radiogroup')).toBeInTheDocument()
    // Widgets that belong to other types must not be rendered at all (not merely hidden).
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('associates the SINGLE_CHOICE legend with its radios and lets keyboard-only users select an option', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<LessonInputRenderer config={{ type: 'SINGLE_CHOICE', options: ['買う', '売る'] }} value={undefined} onChange={onChange} label="どうしますか" />)

    const group = screen.getByRole('group', { name: 'どうしますか' })
    const buy = within(group).getByRole('radio', { name: '買う' })
    expect(buy).not.toHaveAttribute('disabled')

    await user.tab()
    expect(buy).toHaveFocus()
    await user.keyboard(' ')
    expect(onChange).toHaveBeenCalledWith('買う')
  })

  it('ensures every radio has a 44px-or-larger tap target', () => {
    render(<LessonInputRenderer config={{ type: 'SINGLE_CHOICE', options: ['買う', '売る'] }} value={undefined} onChange={vi.fn()} label="どうしますか" />)
    for (const label of document.querySelectorAll('.MuiFormControlLabel-root')) {
      const style = getComputedStyle(label)
      expect(parseFloat(style.minHeight)).toBeGreaterThanOrEqual(44)
    }
  })

  it('announces a validation error via role="alert" after the value changes', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [value, setValue] = useValueState<number>()
      return <LessonInputRenderer config={{ type: 'NUMBER', min: 0, max: 10 }} value={value} onChange={setValue} label="株数" />
    }
    render(<Harness />)
    const input = screen.getByRole('spinbutton', { name: '株数' })
    await user.type(input, '11')
    expect(screen.getByRole('alert')).toHaveTextContent('10以下で入力してください。')
    expect(input).toHaveAttribute('aria-describedby', expect.stringContaining('error'))
  })

  it('shows the disabled reason as adjacent text and keeps the control keyboard-reachable', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <LessonInputRenderer
        config={{ type: 'NUMBER', min: 0, max: 10 }}
        value={5}
        onChange={onChange}
        label="株数"
        disabledReason="回答締切"
      />,
    )
    const input = screen.getByRole('spinbutton', { name: '株数' })
    expect(input).toBeInTheDocument()
    // Native `disabled` would remove the element from the tab order and silence
    // aria-describedby for most screen readers, so keyboard-only users could never
    // learn why the control is inert. aria-disabled keeps it focusable instead.
    expect(input).toHaveAttribute('aria-disabled', 'true')
    expect((input as HTMLInputElement).disabled).toBeFalsy()

    const reasonText = screen.getByText('回答締切のため操作できません。')
    expect(reasonText).toBeInTheDocument()
    expect(input.getAttribute('aria-describedby')).toContain(reasonText.id)

    await user.tab()
    expect(input).toHaveFocus()

    await user.keyboard('9')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps a disabled SINGLE_CHOICE radio focusable and wires aria-describedby to its native input, not the RadioGroup container', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <LessonInputRenderer
        config={{ type: 'SINGLE_CHOICE', options: ['買う', '売る'] }}
        value={undefined}
        onChange={onChange}
        label="どうしますか"
        disabledReason="回答締切"
      />,
    )
    const buy = screen.getByRole('radio', { name: '買う' })
    expect(buy).toHaveAttribute('aria-disabled', 'true')
    expect((buy as HTMLInputElement).disabled).toBeFalsy()

    const reasonText = screen.getByText('回答締切のため操作できません。')
    expect(buy.getAttribute('aria-describedby')).toContain(reasonText.id)

    await user.tab()
    expect(buy).toHaveFocus()
    await user.keyboard(' ')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('lets a RANKING widget be fully reordered with keyboard-operable buttons and no drag required', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [value, setValue] = useValueState<string[]>()
      return <LessonInputRenderer config={{ type: 'RANKING', items: ['りんご', 'みかん'] }} value={value} onChange={setValue} label="人気順" />
    }
    render(<Harness />)
    const moveDown = screen.getByRole('button', { name: 'りんごを下へ移動' })
    await user.click(moveDown)
    const items = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(items[0]).toContain('みかん')
    expect(items[1]).toContain('りんご')
  })

  it('marks a TEAM response with a visible badge', () => {
    render(
      <LessonInputRenderer
        config={{ type: 'SHORT_TEXT', maxLength: 20 }}
        value={undefined}
        onChange={vi.fn()}
        label="ひとこと"
        responseScope="TEAM"
      />,
    )
    expect(screen.getByText('チームの回答')).toBeInTheDocument()
  })
})
