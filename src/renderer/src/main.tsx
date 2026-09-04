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
// The .catch is defence in depth, not decoration: this chain is never awaited, so
// any rejection here would otherwise be an invisible unhandled rejection. The CSS
// var() fallbacks are the original dark colors, so an unthemed render still looks
// right — there is nothing to recover, only something to not crash on.
window.nyx.settings
  .get()
  .then(applyTheme)
  .catch((err) => console.warn('Failed to apply the saved theme; using defaults:', err))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
