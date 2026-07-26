import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { bootstrapFirebase } from './lib/firebase/bootstrap.ts'
import { AppErrorBoundary, ConfigurationError } from './components/AppErrorBoundary.tsx'
import './index.css'
import './App.css'

let configured = true
try {
  bootstrapFirebase()
} catch {
  configured = false
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>{configured ? <App /> : <ConfigurationError />}</AppErrorBoundary>
  </StrictMode>,
)
