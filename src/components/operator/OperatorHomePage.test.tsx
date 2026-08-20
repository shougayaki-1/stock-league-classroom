import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OperatorHomePage, type OperatorHomePageProps } from './OperatorHomePage'

describe('OperatorHomePage', () => {
  const defaultProps: OperatorHomePageProps = {
    onNavigateToTuning: vi.fn(),
    onNavigateToReports: vi.fn(),
    onNavigateToCertifications: vi.fn(),
    onNavigateToAiBeta: vi.fn(),
  }

  it('renders links to every operator feature', () => {
    render(<OperatorHomePage {...defaultProps} />)
    expect(screen.getByText('パラメータ調整')).toBeInTheDocument()
    expect(screen.getByText('通報レポート')).toBeInTheDocument()
    expect(screen.getByText('教材認定')).toBeInTheDocument()
    expect(screen.getByText('AIベータ管理')).toBeInTheDocument()
  })

  it('navigates to each feature when its card is clicked', () => {
    render(<OperatorHomePage {...defaultProps} />)
    fireEvent.click(screen.getByText('通報レポート'))
    expect(defaultProps.onNavigateToReports).toHaveBeenCalled()

    fireEvent.click(screen.getByText('教材認定'))
    expect(defaultProps.onNavigateToCertifications).toHaveBeenCalled()

    fireEvent.click(screen.getByText('AIベータ管理'))
    expect(defaultProps.onNavigateToAiBeta).toHaveBeenCalled()

    fireEvent.click(screen.getByText('パラメータ調整'))
    expect(defaultProps.onNavigateToTuning).toHaveBeenCalled()
  })
})
