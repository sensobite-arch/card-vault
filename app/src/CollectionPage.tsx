import { useEffect, useMemo, useState } from 'react'
import { cardImage, formatEur } from './api'
import { gradeRange } from './condition'
import {
  conditionInfo,
  getPhoto,
  itemValue,
  languageInfo,
  refreshAllPrices,
  useCollection,
  type CollectionItem,
} from './collection'

type Sort = 'value' | 'recent' | 'name'

export default function CollectionPage({ onEdit, onGoSearch }: { onEdit: (id: string) => void; onGoSearch: () => void }) {
  const items = useCollection()
  const [sort, setSort] = useState<Sort>('value')
  const [filter, setFilter] = useState('')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const totals = useMemo(() => {
    let value = 0
    let cards = 0
    let unpriced = 0
    for (const it of items) {
      cards += it.quantity
      const v = itemValue(it)
      if (v == null) unpriced += it.quantity
      else value += v
    }
    return { value, cards, unpriced }
  }, [items])

  const lastUpdate = useMemo(() => {
    const dates = items.map((i) => i.priceUpdated).filter(Boolean) as string[]
    return dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null // oldest = how fresh "all" prices are
  }, [items])

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase()
    const list = f ? items.filter((i) => `${i.name} ${i.setName} ${i.number} ${i.notes}`.toLowerCase().includes(f)) : [...items]
    if (sort === 'value') list.sort((a, b) => (itemValue(b) ?? -1) - (itemValue(a) ?? -1))
    if (sort === 'recent') list.sort((a, b) => b.addedAt.localeCompare(a.addedAt))
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name))
    return list
  }, [items, sort, filter])

  async function update() {
    setMessage(null)
    setProgress({ done: 0, total: items.length })
    const r = await refreshAllPrices((done, total) => setProgress({ done, total }))
    setProgress(null)
    setMessage(r.failed ? `Updated ${r.total - r.failed} of ${r.total}. ${r.failed} failed — check your internet and try again.` : `All ${r.total} prices updated.`)
  }

  if (items.length === 0) {
    return (
      <div className="empty">
        <h2>Your collection is empty</h2>
        <p>Find a card, then tap <b>Add to collection</b>.</p>
        <button className="btn primary" onClick={onGoSearch}>🔍 Find a card</button>
      </div>
    )
  }

  return (
    <div className="collection">
      <section className="total">
        <span className="small">Total estimated value</span>
        <strong>{formatEur(totals.value)}</strong>
        <span className="small">
          {totals.cards} card{totals.cards === 1 ? '' : 's'}
          {totals.unpriced ? ` · ${totals.unpriced} without price` : ''}
          {lastUpdate ? ` · prices from ${new Date(lastUpdate).toLocaleDateString('nl-NL')}` : ''}
        </span>
        <button className="btn secondary" onClick={update} disabled={!!progress}>
          {progress ? `Updating ${progress.done}/${progress.total}…` : '↻ Update prices'}
        </button>
        {message && <span className="small">{message}</span>}
      </section>

      <div className="toolbar">
        <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter your cards" />
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort by">
          <option value="value">Most valuable</option>
          <option value="recent">Recently added</option>
          <option value="name">Name A–Z</option>
        </select>
      </div>

      <ul className="items">
        {shown.map((it) => (
          <li key={it.id}>
            <button className="item" onClick={() => onEdit(it.id)}>
              <Thumb item={it} />
              <span className="item-main">
                <span className="item-name">
                  {it.name} {it.quantity > 1 && <span className="qty">×{it.quantity}</span>}
                </span>
                <span className="item-sub">{it.setName} · {it.number}</span>
                <span className="item-sub">
                  <span className={`cond cond-${it.condition}`}>{conditionInfo(it.condition).name}</span> {languageInfo(it.language).flag} {it.versionLabel}
                  {it.grading?.grade ? <> · est. {gradeRange(it.grading.grade)}</> : null}
                </span>
              </span>
              <span className="item-value">{formatEur(itemValue(it))}</span>
            </button>
          </li>
        ))}
      </ul>
      {shown.length === 0 && <p className="hint">No cards match "{filter}".</p>}
    </div>
  )
}

function Thumb({ item }: { item: CollectionItem }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!item.hasPhoto) return setUrl(null)
    let u: string | null = null
    let cancelled = false
    getPhoto(item.id).then((b) => {
      if (b && !cancelled) setUrl((u = URL.createObjectURL(b)))
    })
    return () => {
      cancelled = true
      if (u) URL.revokeObjectURL(u)
    }
  }, [item.id, item.hasPhoto])
  const src = url ?? cardImage(item.image)
  return src ? <img className="thumb" src={src} alt="" loading="lazy" /> : <span className="thumb noimg" />
}
