import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Bundled fonts (no CDN), Latin subset, only the weights the UI uses.
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/barlow-condensed/latin-600.css'
import '@fontsource/barlow-condensed/latin-700.css'

import { App } from './App'
import { AppProvider } from './state'
import { applyTheme } from './theme'
import './styles.css'

applyTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>
)
