import { TemplateRoutes } from './components/TemplateRoutes'

export default function App() {
  const shareMatch = window.location.pathname.match(/^\/templates\/share\/([^/]+)$/)
  if (shareMatch) return <TemplateRoutes shareId={decodeURIComponent(shareMatch[1])} />
  if (window.location.pathname === '/templates') return <TemplateRoutes />
  return <main>Stock League Classroom</main>
}
