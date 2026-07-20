import { TemplateSharePage } from './components/TemplateSharePage'
import { TemplateWorkspace } from './components/TemplateWorkspace'

export default function App() {
  const shareMatch = window.location.pathname.match(/^\/templates\/share\/([^/]+)$/)
  if (shareMatch) return <TemplateSharePage shareId={decodeURIComponent(shareMatch[1])} />
  if (window.location.pathname === '/templates') return <TemplateWorkspace />
  return <main>Stock League Classroom</main>
}
