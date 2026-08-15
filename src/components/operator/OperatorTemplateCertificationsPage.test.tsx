import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  OperatorTemplateCertificationsPage,
} from './OperatorTemplateCertificationsPage'
import type { CertificationCandidate } from '../../lib/lessonTemplates/templateCertification'

const candidates: CertificationCandidate[] = [
  {
    templateId: 't1',
    title: '社会科教材',
    currentPublishedVersionId: 'v1',
    visibility: 'COMMUNITY',
    createdByUid: 'teacher-1',
  },
  {
    templateId: 't2',
    title: '家庭科教材',
    currentPublishedVersionId: 'v2',
    visibility: 'VERIFIED',
    createdByUid: 'teacher-2',
  },
]

describe('OperatorTemplateCertificationsPage', () => {
  it('shows an access-denied message when accessDenied is true', () => {
    render(
      <OperatorTemplateCertificationsPage
        candidates={[]}
        loading={false}
        accessDenied={true}
        onSetCertification={vi.fn()}
      />,
    )
    expect(screen.getByText('この画面は運営者のみ利用できます。')).toBeInTheDocument()
  })

  it('shows loading indicator when loading is true', () => {
    render(
      <OperatorTemplateCertificationsPage
        candidates={[]}
        loading={true}
        accessDenied={false}
        onSetCertification={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('読み込み中')).toBeInTheDocument()
  })

  it('shows empty state when no candidates are present', () => {
    render(
      <OperatorTemplateCertificationsPage
        candidates={[]}
        loading={false}
        accessDenied={false}
        onSetCertification={vi.fn()}
      />,
    )
    expect(screen.getByText('公開中の教材はありません。')).toBeInTheDocument()
  })

  it('lists candidates with visibility chips and keeps action buttons disabled when reason is empty', () => {
    render(
      <OperatorTemplateCertificationsPage
        candidates={candidates}
        loading={false}
        accessDenied={false}
        onSetCertification={vi.fn()}
      />,
    )

    expect(screen.getByText('社会科教材')).toBeInTheDocument()
    expect(screen.getByText('家庭科教材')).toBeInTheDocument()
    expect(screen.getByText('通常公開')).toBeInTheDocument()
    expect(screen.getByText('認証済み')).toBeInTheDocument()

    // Buttons should be disabled because reason is empty
    const verifiedButtons = screen.getAllByRole('button', { name: '認証済み (VERIFIED) にする' })
    expect(verifiedButtons[0]).toBeDisabled()
  })

  it('enables action buttons when reason is typed and triggers onSetCertification', async () => {
    const onSetCertification = vi.fn().mockResolvedValue(undefined)
    render(
      <OperatorTemplateCertificationsPage
        candidates={candidates}
        loading={false}
        accessDenied={false}
        onSetCertification={onSetCertification}
      />,
    )

    const reasonInputs = screen.getAllByLabelText('審査・変更理由')
    fireEvent.change(reasonInputs[0], { target: { value: '高品質な教材として認証' } })

    const verifiedButtons = screen.getAllByRole('button', { name: '認証済み (VERIFIED) にする' })
    expect(verifiedButtons[0]).not.toBeDisabled()

    fireEvent.click(verifiedButtons[0])

    await waitFor(() => {
      expect(onSetCertification).toHaveBeenCalledWith(
        candidates[0],
        'VERIFIED',
        '高品質な教材として認証',
      )
    })
  })

  it('displays row-level error message when certification action fails', async () => {
    const onSetCertification = vi.fn().mockRejectedValue(new Error('公式教材の認定は運営者が作成した教材のみ可能です。'))
    render(
      <OperatorTemplateCertificationsPage
        candidates={candidates}
        loading={false}
        accessDenied={false}
        onSetCertification={onSetCertification}
      />,
    )

    const reasonInputs = screen.getAllByLabelText('審査・変更理由')
    fireEvent.change(reasonInputs[0], { target: { value: '公式化リクエスト' } })

    const officialButtons = screen.getAllByRole('button', { name: '公式 (OFFICIAL) にする' })
    fireEvent.click(officialButtons[0])

    await waitFor(() => {
      expect(screen.getByText('公式教材の認定は運営者が作成した教材のみ可能です。')).toBeInTheDocument()
    })
  })

  it('navigates to reports page when navigation button is clicked', () => {
    const onNavigateToReports = vi.fn()
    render(
      <OperatorTemplateCertificationsPage
        candidates={candidates}
        loading={false}
        accessDenied={false}
        onSetCertification={vi.fn()}
        onNavigateToReports={onNavigateToReports}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '通報の審査へ' }))
    expect(onNavigateToReports).toHaveBeenCalled()
  })
})
