import { TemplateRoutes } from './components/TemplateRoutes'
import { StudentMarketJoin, TeacherMarketDashboard } from './components/MarketDashboard'
import { HostConsole } from './components/HostConsole'

export default function App() {
  const shareMatch = window.location.pathname.match(/^\/templates\/share\/([^/]+)$/)
  if (shareMatch) return <TemplateRoutes shareId={decodeURIComponent(shareMatch[1])} />
  if (window.location.pathname === '/templates') return <TemplateRoutes />
  if (window.location.pathname === '/teacher/markets') return <TeacherMarketDashboard />
  if (window.location.pathname === '/join') return <StudentMarketJoin />
  const hostMatch = window.location.pathname.match(/^\/teacher\/markets\/([^/]+)\/host$/)
  if (hostMatch) return <HostConsole marketId={decodeURIComponent(hostMatch[1])} />
  return <main>Stock League Classroom</main>
}
