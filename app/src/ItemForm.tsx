// Add a card to the collection, or edit/delete a saved one.

import { useEffect, useMemo, useRef, useState } from 'react'
import { cardImage, formatEur, getCard, type CardDetail } from './api'
import {
  CONDITIONS,
  LANGUAGES,
  compressPhoto,
  conditionInfo,
  deleteItem,
  getBackPhoto,
  getPhoto,
  newId,
  numberOf,
  priceForVersion,
  saveItem,
  setBackPhoto,
  type CollectionItem,
  type Condition,
  type Language,
} from './collection'
import Sheet from './Sheet'
import ConditionCheck from './ConditionCheck'
import { gradeRange, ratioText, type Grading } from './condition'

type Props =
  | { mode: 'new'; card: CardDetail; initialPhoto?: Blob | null; onClose: () => void; onSaved?: () => void }
  | { mode: 'edit'; item: CollectionItem; onClose: () => void; onViewCard?: (cardId: string) => void }

export default function ItemForm(props: Props) {
  const existing = props.mode === 'edit' ? props.item : null
  const [card, setCard] = useState<CardDetail | null>(props.mode === 'new' ? props.card : null)

  const [versionKey, setVersionKey] = useState(() => existing?.versionKey ?? bestVersion(props.mode === 'new' ? props.card : null))
  const [condition, setCondition] = useState<Condition>(existing?.condition ?? 'NM')
  const [language, setLanguage] = useState<Language>(existing?.language ?? 'en')
  const [quantity, setQuantity] = useState(existing?.quantity ?? 1)
  const [notes, setNotes] = useState(existing?.notes ?? '')
  // undefined = unchanged. A new card from the scanner starts with the scan photo.
  const [photo, setPhoto] = useState<Blob | null | undefined>(props.mode === 'new' ? props.initialPhoto ?? undefined : undefined)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [grading, setGrading] = useState<Grading | undefined>(existing?.grading)
  const [backPhoto, setBackPhotoState] = useState<Blob | null | undefined>(undefined) // undefined = unchanged
  const [checking, setChecking] = useState<{ front: Blob | null; back: Blob | null } | null>(null)
  const photoBlobRef = useRef<Blob | null>(null) // the photo currently shown

  async function openCheck() {
    const back = backPhoto !== undefined ? backPhoto : existing?.hasBackPhoto ? (await getBackPhoto(existing.id)) ?? null : null
    setChecking({ front: photoBlobRef.current, back })
  }

  // When editing, load the card's versions and today's prices.
  useEffect(() => {
    if (!existing) return
    getCard(existing.cardId).then(setCard).catch(() => {})
  }, [existing])

  // Show the saved photo (edit) or the newly taken one.
  useEffect(() => {
    let url: string | null = null
    let cancelled = false
    const show = (b: Blob | undefined | null) => {
      if (cancelled) return
      photoBlobRef.current = b ?? null
      url = b ? URL.createObjectURL(b) : null
      setPhotoUrl(url)
    }
    if (photo !== undefined) show(photo)
    else if (existing?.hasPhoto) getPhoto(existing.id).then(show)
    else show(null)
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [photo, existing])

  const versions = card?.versions ?? (existing ? [{ key: existing.versionKey, label: existing.versionLabel, price: null }] : [])
  const version = versions.find((v) => v.key === versionKey) ?? versions[0]
  const basePrice = useMemo(() => {
    if (card && version) return priceForVersion(card, version.key, version.label)
    return existing?.basePrice ?? null
  }, [card, version, existing])
  const unit = basePrice == null ? null : basePrice * conditionInfo(condition).factor

  const name = card?.name ?? existing?.name ?? ''
  const setName = card?.set.name ?? existing?.setName ?? ''
  const number = card ? numberOf(card) : existing?.number ?? ''
  const image = card?.image ?? existing?.image

  async function onPhotoPicked(file: File | undefined) {
    if (!file) return
    try {
      setPhoto(await compressPhoto(file))
    } catch {
      setError('Could not read that photo. Try another one.')
    }
  }

  async function save() {
    if (!version) return
    setSaving(true)
    setError(null)
    try {
      const item: CollectionItem = {
        id: existing?.id ?? newId(),
        cardId: card?.id ?? existing!.cardId,
        name,
        setName,
        number,
        image,
        versionKey: version.key,
        versionLabel: version.label,
        condition,
        language,
        quantity: Math.max(1, quantity || 1),
        notes: notes.trim(),
        hasPhoto: existing?.hasPhoto ?? false,
        hasBackPhoto: backPhoto !== undefined ? !!backPhoto : existing?.hasBackPhoto,
        grading,
        addedAt: existing?.addedAt ?? new Date().toISOString(),
        basePrice,
        priceUpdated: card ? new Date().toISOString() : existing?.priceUpdated,
      }
      if (backPhoto !== undefined) await setBackPhoto(item.id, backPhoto)
      await saveItem(item, photo)
      props.onClose()
      if (props.mode === 'new') props.onSaved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Saving failed.')
      setSaving(false)
    }
  }

  async function remove() {
    if (!existing) return
    await deleteItem(existing.id)
    props.onClose()
  }

  return (
    <>
    <Sheet onClose={props.onClose} title={existing ? 'Edit card' : 'Add to collection'}>
      <div className="form">
        <div className="form-card">
          {photoUrl || image ? <img src={photoUrl ?? cardImage(image)} alt={name} /> : <div className="noimg">No picture</div>}
          <div>
            <h2>{name}</h2>
            <p className="meta">{setName} · {number}</p>
            {props.mode === 'edit' && props.onViewCard && (
              <button className="link" onClick={() => props.onViewCard!(existing!.cardId)}>View all prices →</button>
            )}
          </div>
        </div>

        <label className="field">
          <span>Version</span>
          <select value={version?.key} onChange={(e) => setVersionKey(e.target.value)}>
            {versions.map((v) => (
              <option key={v.key} value={v.key}>{v.label}</option>
            ))}
          </select>
          <small>Check your card: a "1st Edition" stamp left of the picture, or no shadow along the right edge of the picture frame (Shadowless).</small>
        </label>

        <div className="field">
          <span>Condition</span>
          <div className="chips">
            {CONDITIONS.map((c) => (
              <button key={c.code} className={`chip ${condition === c.code ? 'on' : ''}`} onClick={() => setCondition(c.code)}>
                {c.name}
              </button>
            ))}
          </div>
          <small>{conditionInfo(condition).help}</small>
          <div className="check-summary">
            {grading?.grade ? (
              <span>
                Estimate: <b>{gradeRange(grading.grade)}</b>
                {grading.front && <> · centering {ratioText(grading.front.lr)}</>}
              </span>
            ) : (
              <span className="small">Not sure? Let the app check centering and wear from photos.</span>
            )}
            <button className="btn secondary" onClick={openCheck}>🔍 {grading ? 'Check again' : 'Check condition'}</button>
          </div>
        </div>

        <div className="field">
          <span>Language</span>
          <div className="chips">
            {LANGUAGES.map((l) => (
              <button key={l.code} className={`chip ${language === l.code ? 'on' : ''}`} onClick={() => setLanguage(l.code)}>
                {l.flag} {l.name}
              </button>
            ))}
          </div>
          {language === 'ja' && <small className="warn">Japanese cards are sold separately on Cardmarket and can be worth quite a bit more or less. The price shown is for the English card.</small>}
        </div>

        <div className="row2">
          <label className="field">
            <span>How many</span>
            <div className="stepper">
              <button onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="One less">−</button>
              <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 1)} />
              <button onClick={() => setQuantity((q) => q + 1)} aria-label="One more">+</button>
            </div>
          </label>

          <div className="field">
            <span>Your photo</span>
            <div className="photo-buttons">
              <label className="btn secondary">
                📷 {photoUrl ? 'Retake' : 'Take photo'}
                <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => onPhotoPicked(e.target.files?.[0])} />
              </label>
              {photoUrl && <button className="btn ghost" onClick={() => setPhoto(null)}>Remove</button>}
            </div>
          </div>
        </div>

        <label className="field">
          <span>Notes</span>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. small crease top-left, bought in 1999" />
        </label>

        <div className="value-box">
          <div>
            <span className="small">Estimated value{quantity > 1 ? ` (${quantity}×)` : ''}</span>
            <strong>{unit == null ? 'No price' : formatEur(unit * quantity)}</strong>
          </div>
          {basePrice != null && (
            <span className="small">
              Cardmarket average {formatEur(basePrice)} × {Math.round(conditionInfo(condition).factor * 100)}% for {conditionInfo(condition).name}
            </span>
          )}
        </div>

        {error && <p className="error">{error}</p>}

        <button className="btn primary big" onClick={save} disabled={saving || !version}>
          {saving ? 'Saving…' : existing ? 'Save changes' : 'Add to collection'}
        </button>

        {existing &&
          (confirmDelete ? (
            <div className="confirm">
              <span>Remove this card from your collection?</span>
              <button className="btn danger" onClick={remove}>Yes, remove</button>
              <button className="btn ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </div>
          ) : (
            <button className="btn ghost danger-text" onClick={() => setConfirmDelete(true)}>Remove from collection</button>
          ))}
      </div>
    </Sheet>
    {checking && (
      <ConditionCheck
        front={checking.front}
        back={checking.back}
        initial={grading}
        onClose={() => setChecking(null)}
        onDone={(g, f, b) => {
          setGrading(g)
          if (g.suggested) setCondition(g.suggested)
          if (f !== checking.front) setPhoto(f)
          if (b !== checking.back) setBackPhotoState(b)
          setChecking(null)
        }}
      />
    )}
    </>
  )
}

/** Pick the version most people own: unlimited, priced, not 1st edition. */
function bestVersion(card: CardDetail | null): string {
  if (!card) return ''
  const priced = card.versions.filter((v) => v.price)
  const pick = priced.find((v) => /unlimited/i.test(v.label)) ?? priced.find((v) => !/1st/i.test(v.label)) ?? priced[0] ?? card.versions[0]
  return pick?.key ?? ''
}
