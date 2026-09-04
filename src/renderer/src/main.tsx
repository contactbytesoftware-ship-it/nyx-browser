import React from 'react'
import ReactDOM from 'react-dom/client'
import './global.css'
import { CHROME_HEIGHT } from '../../shared/layout'
import { applyTheme } from './applyTheme'
import App from './App'

// Publish the shared chrome height to CSS so browser.css and the main process's
// WebContentsView bounds cannot drift apart.
document.documentElement.style.setProperty('--chrome-height', `${CHROME_HEIGHT}px`)

// Settings are plaintext (not behind the vault lock), so the theme can apply
// immediately — including on the auth screens, before any unlock happens.
window.nyx.settings.get().then(applyTheme)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
