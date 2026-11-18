import { useState } from 'react'
import { DEFAULT_SETTINGS, saveSettings, useGradingSettings, type GradingSettings } from './grading'
import Sheet from './Sheet'

const FIELDS: { key: keyof GradingSettings; label: string; help?: string; unit: '€' | '%' | 'cards' }[] = [
  { key: 'fee', label: 'Grading fee per card', help: 'Cheapest service level (e.g. PSA Value).', unit: '€' },
  { key: 'feeMid', label: 'Fee for more valuable cards', unit: '€' },
  { key: 'midFrom', label: '…when the graded card is worth more than', unit: '€' },
  { key: 'feeHigh', label: 'Fee for very valuable cards', unit: '€' },
  { key: 'highFrom', label: '…when worth more than', unit: '€' },
  { key: 'shipping', label: 'Shipping + insurance per submission', help: 'Both ways, plus any import costs.', unit: '€' },
  { key: 'batch', label: 'Cards you usually send at once', help: 'Shipping is shared between these cards.', unit: 'cards' },
  { key: 'sellFee', label: 'Selling fees', help: 'What eBay/Cardmarket keep when you sell.', unit: '%' },
  { key: 'minGain', label: 'Only advise grading above a profit of', unit: '€' },
]

export default function SettingsSheet({ onClose }: { onClose: () => void }) {
  const current = useGradingSettings()
  const [draft, setDraft] = useState<GradingSettings>(current)

  return (
    <Sheet onClose={onClose} title="Settings">
      <div className="form">
        <div>
          <h3>Grading costs</h3>
          <p className="small">Used for the "Worth grading" advice. Fees differ per grading company and change over time, so check their website and adjust these.</p>
        </div>
        {FIELDS.map((f) => (
          <label className="field" key={f.key}>
            <span>{f.label}</span>
            <div className="unit-input">
              {f.unit === '€' && <em>€</em>}
              <input
                type="number"
                inputMode="decimal"
                min={0}
                value={draft[f.key]}
                onChange={(e) => setDraft({ ...draft, [f.key]: Math.max(0, parseFloat(e.target.value) || 0) })}
              />
              {f.unit !== '€' && <em>{f.unit}</em>}
            </div>
            {f.help && <small>{f.help}</small>}
          </label>
        ))}
        <button
          className="btn primary big"
          onClick={() => {
            saveSettings(draft)
            onClose()
          }}
        >
          Save
        </button>
        <button className="btn ghost" onClick={() => setDraft(DEFAULT_SETTINGS)}>Reset to defaults</button>
      </div>
    </Sheet>
  )
}
