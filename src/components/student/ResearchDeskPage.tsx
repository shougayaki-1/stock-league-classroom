import { useState } from 'react'
import {
  Alert,
  Box,
  Paper,
  Stack,
  Tab,
  Tabs,
} from '@mui/material'
import type {
  ResearchDeskPanelId,
  ResearchDeskPublicView,
} from '@stock-league/market-public-content'
import type {
  LessonRunTeamState,
  StockPublicState,
} from '../../lib/lessonRuns/liveTypes'
import { CompanyResearchPage } from './CompanyResearchPage'
import { NewsListPage } from './NewsListPage'
import { StatisticsMaterialsPage } from './StatisticsMaterialsPage'
import { TeamNotesPage } from './TeamNotesPage'
import { OrderScreen } from './OrderScreen'

export interface ResearchDeskPageProps {
  publicView?: ResearchDeskPublicView | null
  teamState?: LessonRunTeamState | null
  stocks?: Record<string, StockPublicState>
  marketPaused?: boolean
  onSaveNote?: (text: string, expectedRevision: number) => Promise<void>
  onSubmitOrder?: (input: { stockId: string; side: 'BUY' | 'SELL'; quantity: number }) => Promise<void>
  activePanel?: ResearchDeskPanelId
  onSelectPanel?: (panel: ResearchDeskPanelId) => void
}

const PANEL_LABELS: Record<ResearchDeskPanelId, string> = {
  COMPANIES: '企業情報',
  NEWS: 'ニュース',
  STATISTICS: '統計資料',
  TEAM_NOTES: 'チームノート',
  ORDERS: '注文',
}

export function ResearchDeskPage({
  publicView,
  teamState,
  stocks = {},
  marketPaused = false,
  onSaveNote,
  onSubmitOrder,
  activePanel: controlledActivePanel,
  onSelectPanel,
}: ResearchDeskPageProps) {
  const availablePanels = publicView?.availablePanels ?? []

  const [internalActivePanel, setInternalActivePanel] = useState<ResearchDeskPanelId | null>(null)

  // Determine current active panel:
  // Prefer controlled or internal; ensure it is within availablePanels; otherwise fallback to first available
  const preferred = controlledActivePanel ?? internalActivePanel
  const activePanel: ResearchDeskPanelId | null =
    preferred && availablePanels.includes(preferred)
      ? preferred
      : availablePanels[0] ?? null

  const handlePanelChange = (_: React.SyntheticEvent, newValue: ResearchDeskPanelId) => {
    if (onSelectPanel) {
      onSelectPanel(newValue)
    } else {
      setInternalActivePanel(newValue)
    }
  }

  if (availablePanels.length === 0) {
    return (
      <Box sx={{ p: 4, width: '100%', maxWidth: 720, mx: 'auto' }}>
        <Alert severity="info">
          現在のフェーズではリサーチデスクは利用できません。
        </Alert>
      </Box>
    )
  }

  return (
    <Stack spacing={2} sx={{ width: '100%', maxWidth: 1000, mx: 'auto', p: { xs: 1, sm: 2 } }}>
      <Paper variant="outlined" sx={{ borderRadius: 1 }}>
        <Tabs
          value={activePanel}
          onChange={handlePanelChange}
          variant="scrollable"
          scrollButtons="auto"
          aria-label="リサーチデスク機能切替"
        >
          {availablePanels.map((panelId) => (
            <Tab
              key={panelId}
              value={panelId}
              label={PANEL_LABELS[panelId] ?? panelId}
              id={`research-desk-tab-${panelId}`}
              aria-controls={`research-desk-panel-${panelId}`}
            />
          ))}
        </Tabs>
      </Paper>

      <Box role="tabpanel" id={`research-desk-panel-${activePanel}`}>
        {activePanel === 'COMPANIES' && (
          <CompanyResearchPage companies={publicView?.companies ?? []} />
        )}

        {activePanel === 'NEWS' && (
          <NewsListPage
            informationItems={publicView?.informationItems ?? []}
            companies={publicView?.companies ?? []}
          />
        )}

        {activePanel === 'STATISTICS' && (
          <StatisticsMaterialsPage economicIndicators={publicView?.economicIndicators ?? []} />
        )}

        {activePanel === 'TEAM_NOTES' && (
          <TeamNotesPage
            note={teamState?.researchNote}
            onSaveNote={onSaveNote ?? (async () => {})}
            disabled={!onSaveNote || !teamState}
          />
        )}

        {activePanel === 'ORDERS' && (
          <OrderScreen
            companies={publicView?.companies ?? []}
            stocks={stocks}
            teamState={teamState}
            marketPaused={marketPaused}
            onSubmitOrder={onSubmitOrder ?? (async () => {})}
            disabled={!onSubmitOrder || !teamState}
          />
        )}
      </Box>
    </Stack>
  )
}
