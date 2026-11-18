// A full-screen page that slides over the app. The phone's back button
// closes the top-most one, like a normal Android app.

import { useEffect, useRef, useState, type ReactNode } from 'react'

const stack: { close: () => void }[] = []
let ignorePops = 0

window.addEventListener('popstate', () => {
  if (ignorePops > 0) {
    ignorePops--
    return
  }
  stack.pop()?.close()
})

export default function Sheet({ onClose, title, children, actions }: { onClose: () => void; title?: string; children: ReactNode; actions?: ReactNode }) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const [depth] = useState(() => stack.length + 1) // newer sheets sit on top

  useEffect(() => {
    const entry = { close: () => closeRef.current() }
    stack.push(entry)
    window.history.pushState({ sheet: stack.length }, '')
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && stack[stack.length - 1] === entry && closeRef.current()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      const i = stack.indexOf(entry)
      if (i >= 0) {
        // Closed by a button rather than the back button: tidy up history.
        stack.splice(i, 1)
        ignorePops++
        window.history.back()
      }
    }
  }, [])

  return (
    <div className="sheet" role="dialog" aria-modal="true" style={{ zIndex: 10 + depth }}>
      <div className="sheet-head">
        <button className="back" onClick={() => closeRef.current()}>← Back</button>
        {title && <span className="sheet-title">{title}</span>}
        <span className="sheet-actions">{actions}</span>
      </div>
      <div className="sheet-body">{children}</div>
    </div>
  )
}
