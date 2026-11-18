// The "Check condition" screen: centering from the photos, whitening on the
// back, a few questions, and the resulting grade estimate.

import { useEffect, useRef, useState } from 'react'
import { conditionInfo, compressPhoto } from './collection'
import {
  QUESTIONS,
  answersFromWhitening,
  centeringCap,
  detectWhitening,
  drawOverlay,
  estimateGrade,
  gradeRange,
  measureCentering,
  photoToCanvas,
  ratioText,
  suggestedCondition,
  type Centering,
  type Grading,
  type Whitening,
} from './condition'
import Sheet from './Sheet'

type Measured = { canvas: HTMLCanvasElement; centering: (Centering & { box: { x: number; y: number; w: number; h: number } }) | null }

export default function ConditionCheck(props: {
  front: Blob | null
  back: Blob | null
  initial?: Grading
  onClose: () => void
  onDone: (grading: Grading, front: Blob | null, back: Blob | null) => void
}) {
  const [front, setFront] = useState<Blob | null>(props.front)
  const [back, setBack] = useState<Blob | null>(props.back)
  const [frontM, setFrontM] = useState<Measured | null>(null)
  const [backM, setBackM] = useState<Measured | null>(null)
  const [whitening, setWhitening] = useState<Whitening | null>(props.initial?.whitening ?? null)
  const [answers, setAnswers] = useState<Grading['answers']>(props.initial?.answers ?? {})
  const [suggestedKeys, setSuggestedKeys] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  // Measure the front photo.
  useEffect(() => {
    if (!front) return setFrontM(null)
    let cancelled = false
    setBusy(true)
    photoToCanvas(front).then((canvas) => {
      if (cancelled) return
      setFrontM({ canvas, centering: measureCentering(canvas, 'front') })
      setBusy(false)
    })
    return () => {
      cancelled = true
    }
  }, [front])

  // Measure the back photo and look for whitening.
  useEffect(() => {
    if (!back) return setBackM(null)
    let cancelled = false
    setBusy(true)
    photoToCanvas(back).then((canvas) => {
      if (cancelled) return
      const centering = measureCentering(canvas, 'back')
      setBackM({ canvas, centering })
      if (centering) {
        const w = detectWhitening(canvas, centering)
        setWhitening(w)
        // Suggest corner/edge answers from the photo, unless already answered.
        const sug = answersFromWhitening(w)
        setAnswers((a) => ({ corners: a.corners ?? sug.corners, edges: a.edges ?? sug.edges, ...a }))
        setSuggestedKeys((k) => [...k, ...(['corners', 'edges'] as const).filter((q) => answers[q] === undefined)])
      }
      setBusy(false)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [back])

  const est = estimateGrade({ front: frontM?.centering ?? null, back: backM?.centering ?? null, answers })
  const grade = est.grade

  function done() {
    const g: Grading = {
      front: frontM?.centering ? strip(frontM.centering) : null,
      back: backM?.centering ? strip(backM.centering) : null,
      whitening,
      answers,
      grade,
      suggested: grade ? suggestedCondition(grade) : null,
      checkedAt: new Date().toISOString(),
    }
    props.onDone(g, front, back)
  }

  return (
    <Sheet onClose={props.onClose} title="Condition check">
      <div className="check">
        <p className="small">An estimate to help you decide, not a professional grade. Take photos straight from above, on a plain dark surface, without glare.</p>

        <div className="check-photos">
          <PhotoSlot
            label="Front"
            measured={frontM}
            onPick={async (f) => setFront(await compressPhoto(f, 2400))}
            result={
              frontM?.centering ? (
                <>
                  Left–right <b>{ratioText(frontM.centering.lr)}</b> · top–bottom <b>{ratioText(frontM.centering.tb)}</b>
                  <br />
                  Centering allows up to <b>PSA {centeringCap(frontM.centering, 'front')}</b>
                </>
              ) : frontM ? (
                <span className="warn">Couldn't measure the borders. This works best for cards with a yellow border, photographed straight from above.</span>
              ) : null
            }
          />
          <PhotoSlot
            label="Back (optional)"
            measured={backM}
            onPick={async (f) => setBack(await compressPhoto(f, 2400))}
            result={
              backM?.centering ? (
                <>
                  Left–right <b>{ratioText(backM.centering.lr)}</b> · top–bottom <b>{ratioText(backM.centering.tb)}</b>
                  <br />
                  {whitening && (
                    <>
                      Whitening: <b>{whitening.level === 'none' ? 'none found' : whitening.level === 'some' ? 'a little' : 'clearly visible'}</b>
                      {[...whitening.corners, ...whitening.edges].length > 0 && <> ({[...whitening.corners, ...whitening.edges].join(', ')})</>}
                    </>
                  )}
                </>
              ) : backM ? (
                <span className="warn">Couldn't find the blue border. Try a darker surface and less glare.</span>
              ) : (
                <span className="small">The back shows whitening on the edges best.</span>
              )
            }
          />
        </div>
        {busy && <div className="loading"><span className="spinner" /> Measuring…</div>}

        <h3>Check by eye</h3>
        {QUESTIONS.map((q) => (
          <div className="field" key={q.id}>
            <span>
              {q.title}
              {suggestedKeys.includes(q.id) && <em className="suggested"> · suggested from your back photo</em>}
            </span>
            <small>{q.help}</small>
            <div className="chips">
              {q.options.map((o, i) => (
                <button
                  key={o.label}
                  className={`chip ${answers[q.id] === i ? 'on' : ''}`}
                  onClick={() => {
                    setAnswers((a) => ({ ...a, [q.id]: i }))
                    setSuggestedKeys((k) => k.filter((x) => x !== q.id))
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="grade-box">
          {grade ? (
            <>
              <span className="small">Estimated grade</span>
              <strong>{gradeRange(grade)}</strong>
              <span>
                Cardmarket condition: <b>{conditionInfo(suggestedCondition(grade)).name}</b>
              </span>
              {!est.complete && <span className="small warn">Answer all questions for a better estimate.</span>}
            </>
          ) : (
            <span className="small">Add a front photo or answer the questions to get an estimate.</span>
          )}
        </div>

        <button className="btn primary big" onClick={done} disabled={!grade || busy}>
          {grade ? `Use ${conditionInfo(suggestedCondition(grade)).name}` : 'Use this'}
        </button>
      </div>
    </Sheet>
  )
}

function strip(c: Centering & { box?: unknown }): Centering {
  const { left, right, top, bottom, lr, tb, worst } = c
  return { left, right, top, bottom, lr, tb, worst }
}

function PhotoSlot(props: { label: string; measured: Measured | null; onPick: (f: File) => void; result: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = ''
    if (props.measured) {
      const c = drawOverlay(props.measured.canvas, props.measured.centering, 360)
      c.className = 'overlay'
      el.appendChild(c)
    }
  }, [props.measured])
  return (
    <div className="slot">
      <span className="slot-label">{props.label}</span>
      <div className="slot-img">
        <div ref={ref} />
        {!props.measured && <span className="small">No photo yet</span>}
      </div>
      <label className="btn secondary">
        📷 {props.measured ? 'Retake' : 'Take photo'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) props.onPick(f)
            e.target.value = ''
          }}
        />
      </label>
      <div className="slot-result">{props.result}</div>
    </div>
  )
}
