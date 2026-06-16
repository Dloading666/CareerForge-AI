import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fix Arco Design React 19 compatibility: Message/Modal/Notification use internal render()
import { setCreateRoot } from '@arco-design/web-react/es/_util/react-dom'
import { BrowserRouter } from 'react-router-dom'
import '@arco-design/web-react/dist/css/arco.css'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './shared/AuthProvider'
import { ErrorBoundary } from './shared/ErrorBoundary'

// Arco Design internally detects React >= 18, but createRoot moved to react-dom/client in React 19
setCreateRoot(createRoot)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)