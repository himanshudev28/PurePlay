import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerServiceWorker } from '@/lib/pwa'
import { initTheme } from '@/lib/theme'

initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// The callback was previously omitted, which made the whole update-detection
// path dead code. Surface it as a dismissible bar the user can act on.
registerServiceWorker(() => {
  const bar = document.createElement('div')
  bar.setAttribute('role', 'status')
  bar.style.cssText =
    'position:fixed;left:50%;transform:translateX(-50%);bottom:96px;z-index:60;' +
    'display:flex;gap:12px;align-items:center;background:#17171b;color:#c6c6d2;' +
    'border:1px solid #34343d;border-radius:999px;padding:10px 16px;font:500 13px Inter,system-ui,sans-serif;' +
    'box-shadow:0 8px 30px rgba(0,0,0,.5)'
  // follow the user's chosen accent rather than hard-coding the default orange
  bar.innerHTML =
    '<span>A new version is ready.</span>' +
    '<button style="background:var(--color-accent,#ff6b4a);color:#fff;border:0;border-radius:999px;padding:6px 14px;font:inherit;cursor:pointer">Reload</button>' +
    '<button aria-label="Dismiss" style="background:none;border:0;color:#82828f;font:inherit;cursor:pointer;padding:4px 8px">✕</button>'
  const [reload, dismiss] = bar.querySelectorAll('button')
  reload.addEventListener('click', () => location.reload())
  dismiss.addEventListener('click', () => bar.remove())
  document.body.appendChild(bar)
})
