import { useCallback, useEffect, useRef, useState } from 'react'
import { cardImage } from './api'
import { scanCard, warmUpScanner, type ScanResult } from './scanner'

type Box = { x: number; y: number; w: number; h: number }
type Stage = { kind: 'camera' } | { kind: 'working'; preview: string; status: string } | { kind: 'done'; preview: string; result: ScanResult } | { kind: 'error'; preview?: string; message: string }

const CARD_RATIO = 63 / 88 // width / height of a Pokémon card
const MARGIN = 0.15 // extra space around the frame, in case the card isn't lined up exactly

/** Full-resolution photo with autofocus, where the phone supports it (Chrome on Android does). */
async function takePhoto(track: MediaStreamTrack): Promise<ImageBitmap | null> {
  const IC = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { takePhoto(): Promise<Blob> } }).ImageCapture
  if (!IC) return null
  try {
    const blob = await Promise.race([new IC(track).takePhoto(), new Promise<null>((r) => setTimeout(() => r(null), 6000))])
    return blob ? await createImageBitmap(blob) : null
  } catch {
    return null
  }
}

function cropTo(src: HTMLCanvasElement, box: Box, margin: number): HTMLCanvasElement {
  const x = Math.max(0, box.x - box.w * margin)
  const y = Math.max(0, box.y - box.h * margin)
  const w = Math.min(src.width - x, box.w * (1 + 2 * margin))
  const h = Math.min(src.height - y, box.h * (1 + 2 * margin))
  const c = document.createElement('canvas')
  c.width = Math.round(w)
  c.height = Math.round(h)
  c.getContext('2d')!.drawImage(src, x, y, w, h, 0, 0, c.width, c.height)
  return c
}

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
        // Keep refocusing while you move the phone, where supported.
        const track = stream.getVideoTracks()[0]
        track?.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {})
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
    setStage({ kind: 'working', preview: canvas.toDataURL('image/jpeg', 0.7), status: 'Reading card…' })
    try {
      const result = await scanCard(canvas, box, (status) => setStage((s) => (s.kind === 'working' ? { ...s, status } : s)))
      // Keep a photo of just the card (with a little space around it).
      const photo = result.box ? cropTo(canvas, result.box, 0.06) : canvas
      const preview = photo.toDataURL('image/jpeg', 0.85)
      photoRef.current = await new Promise<Blob | null>((r) => photo.toBlob(r, 'image/jpeg', 0.9))
      setStage({ kind: 'done', preview, result })
    } catch (e) {
      console.error(e)
      setStage({ kind: 'error', message: 'Reading the card failed. Check your internet connection (needed the first time) and try again.' })
    }
  }

  /** Takes a sharp photo and keeps the part in and around the frame. */
  async function capture() {
    const v = videoRef.current
    const g = guideRef.current
    if (!v || !g || !v.videoWidth) return
    // Where the frame is, as a fraction of the camera image (the video is shown with object-fit: cover).
    const vr = v.getBoundingClientRect()
    const gr = g.getBoundingClientRect()
    const scale = Math.max(vr.width / v.videoWidth, vr.height / v.videoHeight)
    const offX = (vr.width - v.videoWidth * scale) / 2
    const offY = (vr.height - v.videoHeight * scale) / 2
    const frac = {
      x: (gr.left - vr.left - offX) / scale / v.videoWidth,
      y: (gr.top - vr.top - offY) / scale / v.videoHeight,
      w: gr.width / scale / v.videoWidth,
      h: gr.height / scale / v.videoHeight,
    }
    setStage({ kind: 'working', preview: '', status: 'Taking photo…' })

    // A real photo (with autofocus, full resolution) is much sharper than a video frame.
    let source: CanvasImageSource = v
    let sw = v.videoWidth
    let sh = v.videoHeight
    let fx = 0
    let fy = 0
    const track = streamRef.current?.getVideoTracks()[0]
    const photo = track ? await takePhoto(track) : null
    if (photo && photo.width > sw && photo.width > photo.height === sw > sh) {
      // The photo may show a bit more than the video: the video is the centre part of it.
      const va = sw / sh
      const cropW = photo.width / photo.height > va ? photo.height * va : photo.width
      const cropH = cropW / va
      fx = (photo.width - cropW) / 2
      fy = (photo.height - cropH) / 2
      sw = cropW
      sh = cropH
      source = photo
    }
    const guide = { x: fx + frac.x * sw, y: fy + frac.y * sh, w: frac.w * sw, h: frac.h * sh }
    const full = { width: source === v ? v.videoWidth : (photo as ImageBitmap).width, height: source === v ? v.videoHeight : (photo as ImageBitmap).height }

    // Cut out the frame plus generous margin (the card may be smaller or a bit off).
    const mx = guide.w * MARGIN
    const my = guide.h * MARGIN
    const cx = Math.max(0, guide.x - mx)
    const cy = Math.max(0, guide.y - my)
    const cw = Math.min(full.width - cx, guide.w + 2 * mx)
    const ch = Math.min(full.height - cy, guide.h + 2 * my)
    const out = Math.min(1, 2200 / ch)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(cw * out)
    canvas.height = Math.round(ch * out)
    canvas.getContext('2d')!.drawImage(source, cx, cy, cw, ch, 0, 0, canvas.width, canvas.height)
    photo?.close()
    stopCamera()
    run(canvas, { x: (guide.x - cx) * out, y: (guide.y - cy) * out, w: guide.w * out, h: guide.h * out })
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
            <span className="guide-tip">{cameraError ? '' : 'Card inside the frame · hold ±20 cm away so it is sharp'}</span>
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
