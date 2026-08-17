import { useState } from 'react'
import { Box, Tab, Tabs } from '@mui/material'
import type { CompanyPublicView, InformationPublicView, ResearchDeskPanelId } from '@stock-league/market-public-content'
import type { LessonRunTeamState, StockPublicState } from '../../lib/lessonRuns/liveTypes'
import { OrderScreen } from './OrderScreen'
import { NewsListPage } from './NewsListPage'
import { CompanyResearchPage } from './CompanyResearchPage'

export interface MarketPlayScreenProps {
  companies: CompanyPublicView[]
  informationItems: InformationPublicView[]
  stocks: Record<string, StockPublicState>
  teamState: LessonRunTeamState | null
  marketPaused: boolean
  availablePanels: ResearchDeskPanelId[]
  onSubmitOrder: (input: { stockId: string; side: 'BUY' | 'SELL'; quantity: number }) => Promise<void>
}

const PANEL_TABS: { panel: ResearchDeskPanelId; label: string }[] = [
  { panel: 'ORDERS', label: '取引' },
  { panel: 'COMPANIES', label: '企業情報' },
  { panel: 'NEWS', label: 'ニュース' },
]

export function MarketPlayScreen({
  companies,
  informationItems,
  stocks,
  teamState,
  marketPaused,
  availablePanels,
  onSubmitOrder,
}: MarketPlayScreenProps) {
  const visibleTabs = PANEL_TABS.filter((tab) => availablePanels.includes(tab.panel))
  const [tab, setTab] = useState(0)
  const activePanel = visibleTabs[tab]?.panel

  return (
    <Box sx={{ width: '100%' }}>
      <Tabs value={tab} onChange={(_, value) => setTab(value)}>
        {visibleTabs.map((t) => (
          <Tab key={t.panel} label={t.label} />
        ))}
      </Tabs>
      {activePanel === 'ORDERS' && (
        <OrderScreen
          companies={companies}
          stocks={stocks}
          teamState={teamState}
          marketPaused={marketPaused}
          onSubmitOrder={onSubmitOrder}
          disabled={!teamState}
        />
      )}
      {activePanel === 'COMPANIES' && <CompanyResearchPage companies={companies} />}
      {activePanel === 'NEWS' && <NewsListPage informationItems={informationItems} companies={companies} />}
    </Box>
  )
}
