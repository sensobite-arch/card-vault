import { useEffect, useState } from 'react'
import { cardImage, formatEur, getCard, mainPrice, type CardDetail } from './api'
import { useCollection } from './collection'
import Sheet from './Sheet'

export default function CardDetailView({ id, onClose, onAdd }: { id: string; onClose: () => void; onAdd: (card: CardDetail) => void }) {
  const [card, setCard] = useState<CardDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const owned = useCollection().filter((i) => i.cardId === id).reduce((n, i) => n + i.quantity, 0)

  useEffect(() => {
    let cancelled = false
    setCard(null)
    setError(null)
    getCard(id)
      .then((c) => !cancelled && setCard(c))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load this card.'))
    return () => {
      cancelled = true
    }
  }, [id])

  const updated = card?.versions.find((v) => v.price?.updated)?.price?.updated

  return (
    <Sheet onClose={onClose}>
      {error && <p className="error">{error}</p>}
      {!card && !error && <div className="loading"><span className="spinner" /> Loading card…</div>}

      {card && (
        <div className="detail">
          {card.image ? <img className="detail-img" src={cardImage(card.image, 'high')} alt={card.name} /> : <div className="noimg big">No picture</div>}

          <h2>{card.name}</h2>
          <p className="meta">
            {card.set.name} · {card.localId}
            {card.set.cardCount?.official ? `/${card.set.cardCount.official}` : ''}
            {card.rarity ? ` · ${card.rarity}` : ''}
          </p>

          <button className="btn primary big" onClick={() => onAdd(card)}>＋ Add to collection</button>
          {owned > 0 && <p className="small owned">✓ You have {owned} of this card in your collection</p>}

          <h3>Cardmarket prices</h3>
          <p className="small">Average sale price over the last 30 days, per version of the card. This is an average over all conditions: cards in better condition sell for more.</p>

          <ul className="versions">
            {card.versions.map((v) => (
              <li key={v.key} className="version">
                <div className="version-top">
                  <span className="version-label">{v.label}</span>
                  <span className="version-price">{v.price ? formatEur(mainPrice(v.price)) : 'No price'}</span>
                </div>
                {v.price && (
                  <div className="version-sub">
                    <span>Trend {formatEur(v.price.trend)}</span>
                    <span>7 days {formatEur(v.price.avg7)}</span>
                    <span>Lowest {formatEur(v.price.low)}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>

          {updated && <p className="small">Prices updated {new Date(updated).toLocaleDateString('nl-NL')}. Source: Cardmarket via TCGdex.</p>}
          {card.illustrator && <p className="small">Illustrated by {card.illustrator}</p>}
        </div>
      )}
    </Sheet>
  )
}
