// A list of every English card (id, name, number, picture), downloaded once
// and kept on the phone. Used by the scanner to match slightly misread names.

import { createStore, get, set } from 'idb-keyval'
import { getSets, type CardBrief } from './api'

const db = createStore('card-vault-catalog', 'data')
const MAX_AGE = 7 * 24 * 3600 * 1000 // refresh weekly (new sets come out)

interface Saved {
  savedAt: number
  cards: { id: string; localId: string; name: string; image?: string }[]
}

let catalogPromise: Promise<CardBrief[]> | null = null

async function download(): Promise<Saved> {
  const res = await fetch('https://api.tcgdex.net/v2/en/cards')
  if (!res.ok) throw new Error(`Card list download failed (${res.status})`)
  const cards = (await res.json()) as Saved['cards']
  const saved = { savedAt: Date.now(), cards: cards.map((c) => ({ id: c.id, localId: c.localId, name: c.name, image: c.image })) }
  await set('catalog', saved, db).catch(() => {})
  return saved
}

export function getCatalog(): Promise<CardBrief[]> {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      let saved = await get<Saved>('catalog', db).catch(() => undefined)
      if (!saved) saved = await download()
      else if (Date.now() - saved.savedAt > MAX_AGE) download().catch(() => {}) // update quietly for next time
      const sets = await getSets()
      return saved.cards.map((c) => ({ ...c, set: sets.get(c.id.slice(0, c.id.length - c.localId.length - 1)) }))
    })().catch((e) => {
      catalogPromise = null
      throw e
    })
  }
  return catalogPromise
}
