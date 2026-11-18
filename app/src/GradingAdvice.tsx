import { useState } from 'react'
import { formatEur } from './api'
import type { CollectionItem } from './collection'
import { gradeRange } from './condition'
import { VERDICT_TEXT, adviseGrading, ebaySoldLink, gradedValue, useGradingSettings } from './grading'

/** The "Should I grade this?" box in the card form. */
export default function GradingAdvice({ item, onPrices }: { item: CollectionItem; onPrices: (p: CollectionItem['gradedPrices']) => void }) {
  const settings = useGradingSettings()
  const a = adviseGrading(item, settings)
  const [open, setOpen] = useState(false)

  const priceInput = (grade: number) => (
    <label className="field" key={grade}>
      <span>PSA {grade} sold for</span>
      <div className="unit-input">
        <em>€</em>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          placeholder={String(gradedValue({ ...item, gradedPrices: {} }, grade).value ?? '')}
          value={item.gradedPrices?.[grade] ?? ''}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            const next = { ...(item.gradedPrices ?? {}) }
            if (v > 0) next[grade] = v
            else delete next[grade]
            onPrices(next)
          }}
        />
      </div>
      <a className="link small" href={ebaySoldLink(item, grade)} target="_blank" rel="noreferrer">
        See sold PSA {grade} copies on eBay ↗
      </a>
    </label>
  )

  const anyReal = a.low.real || a.high.real

  return (
    <div className={`advice advice-${a.verdict}`}>
      <div className="advice-head">
        <span className="advice-title">{a.verdict === 'worth' ? '🏅 ' : ''}{VERDICT_TEXT[a.verdict]}</span>
        {a.gain != null && <span className="advice-gain">{a.gain >= 0 ? '+' : '−'}{formatEur(Math.abs(a.gain))}</span>}
      </div>

      {a.verdict !== 'unknown' && a.expected != null && a.raw != null && (
        <p className="advice-text">
          As it is now ~<b>{formatEur(a.raw)}</b>. Graded {gradeRange(a.grade)} likely ~<b>{formatEur(a.expected)}</b>
          {!anyReal && ' (estimate)'}. Minus grading ~{formatEur(a.costs)} and selling fees ~{formatEur(a.sellCosts)}.
        </p>
      )}
      {!a.fromCheck && <p className="small">Based on the condition you picked. Do a condition check for better advice.</p>}

      <button className="link small" onClick={() => setOpen(!open)}>
        {open ? 'Hide graded prices ▲' : anyReal ? 'Your graded prices ▼' : 'Use real graded prices ▼'}
      </button>
      {open && (
        <div className="advice-prices">
          <p className="small">
            The graded prices above are rough estimates. For valuable cards, look up what graded copies actually sold for (prices on eBay.com are in dollars: roughly ×0.9 for euros) and fill them in.
          </p>
          <div className="row2">{[a.low.grade, a.high.grade].filter((g, i, arr) => arr.indexOf(g) === i).map(priceInput)}</div>
        </div>
      )}
    </div>
  )
}
