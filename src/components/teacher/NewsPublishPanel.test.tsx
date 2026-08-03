import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { NewsPublishPanel } from './NewsPublishPanel'

describe('NewsPublishPanel', () => {
  it('publishes the entered news and impact, then clears the form', async () => {
    const onPublish = vi.fn().mockResolvedValue(undefined)
    render(<NewsPublishPanel disabled={false} onPublish={onPublish} />)
    await userEvent.type(screen.getByLabelText('ニュース本文'), '新商品が発表された')
    await userEvent.click(screen.getByLabelText('相場への影響'))
    await userEvent.click(await screen.findByRole('option', { name: 'やや上昇（+5%）' }))
    await userEvent.click(screen.getByRole('button', { name: '配信する' }))
    expect(onPublish).toHaveBeenCalledWith('新商品が発表された', 5)
    expect(await screen.findByLabelText('ニュース本文')).toHaveValue('')
  })

  it('keeps the entered text when publishing fails', async () => {
    const onPublish = vi.fn().mockRejectedValue(new Error('boom'))
    render(<NewsPublishPanel disabled={false} onPublish={onPublish} />)
    await userEvent.type(screen.getByLabelText('ニュース本文'), '在庫切れが発生した')
    await userEvent.click(screen.getByRole('button', { name: '配信する' }))
    expect(await screen.findByLabelText('ニュース本文')).toHaveValue('在庫切れが発生した')
  })

  it('disables the form when there is no host lease', () => {
    render(<NewsPublishPanel disabled onPublish={vi.fn()} />)
    expect(screen.getByLabelText('ニュース本文')).toBeDisabled()
    expect(screen.getByRole('button', { name: '配信する' })).toBeDisabled()
  })
})
