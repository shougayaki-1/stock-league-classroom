import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NewsListPage } from './NewsListPage'
import type { InformationPublicView } from '@stock-league/market-public-content'

describe('NewsListPage', () => {
  const news: InformationPublicView[] = [
    {
      id: 'news-1',
      source: '日本経済新聞',
      category: 'OFFICIAL_NEWS',
      natureType: 'FACT',
      confidenceLevel: 'HIGH',
      publishedAtMillis: 1700000000000,
      targetCompanyIds: ['comp-1'],
      body: '新製品の発表がありました。',
    },
    {
      id: 'news-2',
      source: 'アナリストレポート',
      category: 'ANALYSIS',
      natureType: 'FORECAST',
      confidenceLevel: 'MEDIUM',
      publishedAtMillis: 1700000010000,
      targetCompanyIds: [],
      body: '下期の業界成長率は好調を維持する見通し。',
    },
  ]

  it('renders empty message when there are no news items', () => {
    render(<NewsListPage informationItems={[]} />)
    expect(screen.getByText('公開されているニュースはありません。')).toBeInTheDocument()
  })

  it('renders list of news items with their metadata and body', () => {
    render(
      <NewsListPage
        informationItems={news}
        companies={[{ id: 'comp-1', name: 'Alpha Tech', symbol: '1001' } as never]}
      />,
    )

    expect(screen.getByText('日本経済新聞')).toBeInTheDocument()
    expect(screen.getByText('新製品の発表がありました。')).toBeInTheDocument()
    expect(screen.getByText('対象: Alpha Tech (1001)')).toBeInTheDocument()
    expect(screen.getByText('アナリストレポート')).toBeInTheDocument()
    expect(screen.getByText('下期の業界成長率は好調を維持する見通し。')).toBeInTheDocument()
    expect(screen.getByText('公式発表')).toBeInTheDocument()
    expect(screen.getByText('事実')).toBeInTheDocument()
    expect(screen.getByText('確度: 高')).toBeInTheDocument()
    expect(screen.queryByText('OFFICIAL_NEWS')).not.toBeInTheDocument()
    expect(screen.queryByText('FACT')).not.toBeInTheDocument()
    expect(screen.queryByText('HIGH')).not.toBeInTheDocument()
  })

  it('fails closed for unknown metadata and unresolved target-company ids', () => {
    const raw = 'UNKNOWN_INTERNAL_TOKEN'
    const opaqueCompanyId = 'opaque-company-id'
    const item: InformationPublicView = {
      ...news[0],
      id: 'news-unknown',
      category: raw as never,
      natureType: raw as never,
      confidenceLevel: raw as never,
      targetCompanyIds: [opaqueCompanyId],
    }

    render(<NewsListPage informationItems={[item]} companies={[]} />)

    expect(screen.getByText('ニュース種別を確認できません')).toBeInTheDocument()
    expect(screen.getByText('情報の性質を確認できません')).toBeInTheDocument()
    expect(screen.getByText('確度を確認できません')).toBeInTheDocument()
    expect(screen.queryByText(raw)).not.toBeInTheDocument()
    expect(screen.queryByText(opaqueCompanyId)).not.toBeInTheDocument()
  })
})
