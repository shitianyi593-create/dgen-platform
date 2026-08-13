import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'react-hot-toast'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Toaster
      position="top-right"
      toastOptions={{
        style: {
          background: '#161b22',
          color: '#e6edf3',
          border: '1px solid #30363d',
          fontSize: '14px',
        },
      }}
    />
    <App />
  </StrictMode>,
)
