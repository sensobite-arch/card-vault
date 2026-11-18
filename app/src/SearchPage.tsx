import { useEffect, useState } from 'react'
import { cardImage, searchCards, type CardBrief } from './api'

export default function SearchPage({ onOpen }: { onOpen: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CardBrief[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Search automatically shortly after you stop typing.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults(null)
      setError(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const r = await searchCards(q)
        if (!cancelled) setResults(r)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Something went wrong.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  return (
    <div className="search-page">
      <div className="searchbox">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Card name, e.g. Charizard 4/102"
          autoFocus
          enterKeyHint="search"
        />
        {loading && <span className="spinner" aria-label="Searching" />}
      </div>

      {error && <p className="error">{error}</p>}

      {!results && !error && (
        <div className="hint">
          <p>Type the name of a card. Add the number at the bottom of the card (like <b>4/102</b>) to find the exact one.</p>
        </div>
      )}

      {results && results.length === 0 && !loading && <p className="hint">No cards found. Check the spelling, or try just the name.</p>}

      {results && results.length > 0 && (
        <>
          <p className="count">{results.length} card{results.length === 1 ? '' : 's'} found · oldest sets first</p>
          <ul className="grid">
            {results.map((c) => (
              <li key={c.id}>
                <button className="card-tile" onClick={() => onOpen(c.id)}>
                  {c.image ? <img src={cardImage(c.image)} alt={c.name} loading="lazy" /> : <div className="noimg">No picture</div>}
                  <span className="tile-name">{c.name}</span>
                  <span className="tile-set">
                    {c.set?.name ?? 'Unknown set'} · {c.localId}
                    {c.set?.official ? `/${c.set.official}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
