import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { loadCollection } from './collection'

loadCollection()

createRoot(document.getElementById('root')!).render(<App />)

// Makes the app installable and usable offline (only in the published version).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}))
}
