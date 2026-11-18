import { useCallback, useEffect, useRef, useState } from 'react'
import { cardImage } from './api'
import { scanCard, warmUpScanner, type ScanResult } from './scanner'

type Box = { x: number; y: number; w: number; h: number }
type Stage = { kind: 'camera' } | { kind: 'working'; preview: string; status: string } | { kind: 'done'; preview: string; result: ScanResult } | { kind: 'error'; preview?: string; message: string }

const CARD_RATIO = 63 / 88 // width / height of a Pokémon card
const MARGIN = 0.05 // keep a little space around the card in the saved photo

export default function ScanPage({ onPick, onSearchByHand }: { onPick: (cardId: string, photo: Blob | null) => void; onSearchByHand: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const guideRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const photoRef = useRef<Blob | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [stage, setStage] = useState<Stage>({ kind: 'camera' })

  useEffect(() => warmUpScanner(), [])

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCameraReady(false)
  }, [])

  // Start the camera while on the camera screen.
  useEffect(() => {
    if (stage.kind !== 'camera') return
    let cancelled = false
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(window.isSecureContext ? 'This browser cannot use the camera.' : 'The camera only works once the app is installed from its web address (Phase 7). For now, choose a photo instead.')
      return
    }
    navigator.mediaDevices
      // Ask for a high resolution: the card number is tiny text.
      .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false })
      .then((stream) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop())
        streamRef.current = stream
        const v = videoRef.current
        if (v) {
          v.srcObject = stream
          v.play().catch(() => {})
        }
        setCameraError(null)
      })
      .catch((e: DOMException) => {
        if (cancelled) return
        setCameraError(
          e.name === 'NotAllowedError'
            ? 'Camera access was blocked. Allow the camera for this app in your browser settings, or choose a photo instead.'
            : 'No camera found. You can choose a photo instead.',
        )
      })
    return () => {
      cancelled = true
      stopCamera()
    }
  }, [stage.kind, stopCamera])

  async function run(canvas: HTMLCanvasElement, box: Box | null) {
    const preview = canvas.toDataURL('image/jpeg', 0.85)
    photoRef.current = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.88))
    setStage({ kind: 'working', preview, status: 'Reading card…' })
    try {
      const result = await scanCard(canvas, box, (status) => setStage((s) => (s.kind === 'working' ? { ...s, status } : s)))
      setStage({ kind: 'done', preview, result })
    } catch (e) {
      console.error(e)
      setStage({ kind: 'error', preview, message: 'Reading the card failed. Check your internet connection (needed the first time) and try again.' })
    }
  }

  /** Takes a picture of what's inside the guide (plus a small margin). */
  function capture() {
    const v = videoRef.current
    const g = guideRef.current
    if (!v || !g || !v.videoWidth) return
    const vr = v.getBoundingClientRect()
    const gr = g.getBoundingClientRect()
    // The video is shown with object-fit: cover, so work out how screen pixels map to camera pixels.
    const scale = Math.max(vr.width / v.videoWidth, vr.height / v.videoHeight)
    const offX = (vr.width - v.videoWidth * scale) / 2
    const offY = (vr.height - v.videoHeight * scale) / 2
    let gx = (gr.left - vr.left - offX) / scale
    let gy = (gr.top - vr.top - offY) / scale
    let gw = gr.width / scale
    let gh = gr.height / scale
    // Add margin, but stay inside the camera image.
    const mx = gw * MARGIN
    const my = gh * MARGIN
    const sx = Math.max(0, gx - mx)
    const sy = Math.max(0, gy - my)
    const sw = Math.min(v.videoWidth - sx, gw + 2 * mx)
    const sh = Math.min(v.videoHeight - sy, gh + 2 * my)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(sw)
    canvas.height = Math.round(sh)
    canvas.getContext('2d')!.drawImage(v, sx, sy, sw, sh, 0, 0, sw, sh)
    gx -= sx
    gy -= sy
    stopCamera()
    run(canvas, { x: gx, y: gy, w: gw, h: gh })
  }

  async function fromFile(file: File | undefined) {
    if (!file) return
    try {
      const bmp = await createImageBitmap(file)
      const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bmp.width * scale)
      canvas.height = Math.round(bmp.height * scale)
      canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
      bmp.close()
      stopCamera()
      run(canvas, null)
    } catch {
      setStage({ kind: 'error', message: 'Could not open that photo. Try another one.' })
    }
  }

  const again = () => {
    photoRef.current = null
    setStage({ kind: 'camera' })
  }

  const fileButton = (label: string, className = 'btn secondary') => (
    <label className={className}>
      {label}
      <input type="file" accept="image/*" hidden onChange={(e) => fromFile(e.target.files?.[0])} />
    </label>
  )

  if (stage.kind === 'camera') {
    return (
      <div className="scan">
        <div className="viewfinder">
          {!cameraError && (
            <video ref={videoRef} playsInline muted onLoadedMetadata={() => setCameraReady(true)} />
          )}
          <div className="guide" ref={guideRef} style={{ aspectRatio: CARD_RATIO }}>
            <span className="guide-tip">{cameraError ? '' : 'Fit the card inside the frame'}</span>
          </div>
          {cameraError && <p className="camera-error">{cameraError}</p>}
        </div>
        <div className="scan-actions">
          {fileButton('🖼️ Choose photo')}
          <button className="shutter" onClick={capture} disabled={!cameraReady} aria-label="Take picture" />
          <button className="btn ghost" onClick={onSearchByHand}>Type instead</button>
        </div>
        <p className="small center">Tip: lay the card flat on a plain, dark surface with good light and no glare.</p>
      </div>
    )
  }

  return (
    <div className="scan-result">
      {'preview' in stage && stage.preview && <img className="scan-preview" src={stage.preview} alt="Your scan" />}

      {stage.kind === 'working' && (
        <div className="loading">
          <span className="spinner" /> {stage.status}
        </div>
      )}

      {stage.kind === 'error' && (
        <>
          <p className="error">{stage.message}</p>
          <button className="btn primary big" onClick={again}>Try again</button>
        </>
      )}

      {stage.kind === 'done' && (
        <>
          <p className="read-out">
            {stage.result.number ? <>Card number <b>{stage.result.number.number}/{stage.result.number.total}</b></> : 'Card number not readable'}
            {!stage.result.confident && stage.result.candidates.length > 1 && ' · pick the card that matches yours'}
          </p>

          {stage.result.candidates.length > 0 ? (
            <>
              <h3>Which card is it?</h3>
              <ul className="grid">
                {stage.result.candidates.map((c, i) => (
                  <li key={c.id}>
                    <button className={`card-tile ${i === 0 && stage.result.confident ? 'best' : ''}`} onClick={() => onPick(c.id, photoRef.current)}>
                      {c.image ? <img src={cardImage(c.image)} alt={c.name} loading="lazy" /> : <div className="noimg">No picture</div>}
                      <span className="tile-name">{c.name}</span>
                      <span className="tile-set">
                        {c.set?.name ?? ''} · {c.localId}
                        {c.set?.official ? `/${c.set.official}` : ''}
                      </span>
                      {i === 0 && stage.result.confident && <span className="badge">Best match</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="hint">Couldn't recognise this card. Try again with better light, or search by hand.</p>
          )}

          <div className="scan-bottom">
            <button className="btn primary" onClick={again}>📷 Scan another</button>
            {fileButton('🖼️ Other photo')}
            <button className="btn ghost" onClick={onSearchByHand}>Search by hand</button>
          </div>
        </>
      )}
    </div>
  )
}
