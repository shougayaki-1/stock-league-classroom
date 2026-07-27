import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { bootstrapFirebase } from './lib/firebase/bootstrap.ts'
import { AppErrorBoundary, ConfigurationError } from './components/AppErrorBoundary.tsx'
import { initializeErrorReporting } from './lib/monitoring/errorReporting.ts'
import './index.css'
import './App.css'

// Before bootstrap, so a configuration failure is itself reportable.
initializeErrorReporting()

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
