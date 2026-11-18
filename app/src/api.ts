// Talks to TCGdex (https://tcgdex.dev): a free Pokémon card database
// that includes Cardmarket prices in euros.

const BASE = 'https://api.tcgdex.net/v2/en'

export interface SetInfo {
  id: string
  name: string
  official: number
  order: number // position in TCGdex's set list (roughly oldest → newest)
}

export interface CardBrief {
  id: string
  localId: string
  name: string
  image?: string
  set?: SetInfo
}

export interface CardmarketPrice {
  avg30: number | null // average sale price, last 30 days
  avg7: number | null
  trend: number | null
  low: number | null
  updated?: string
}

export interface PriceVersion {
  key: string
  label: string
  price: CardmarketPrice | null
}

export interface CardDetail {
  id: string
  localId: string
  name: string
  image?: string
  rarity?: string
  illustrator?: string
  set: { id: string; name: string; cardCount?: { official?: number; total?: number } }
  versions: PriceVersion[]
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`The card database answered with an error (${res.status}).`)
  return res.json() as Promise<T>
}

// ---------- Sets (cached) ----------

let setsPromise: Promise<Map<string, SetInfo>> | null = null

export function getSets(): Promise<Map<string, SetInfo>> {
  if (!setsPromise) {
    setsPromise = getJson<{ id: string; name: string; cardCount: { official: number } }[]>(`${BASE}/sets`)
      .then((list) => new Map(list.map((s, i) => [s.id, { id: s.id, name: s.name, official: s.cardCount?.official ?? 0, order: i }])))
      .catch((e) => {
        setsPromise = null
        throw e
      })
  }
  return setsPromise
}

function setIdOf(card: { id: string; localId: string }): string {
  const suffix = '-' + card.localId
  return card.id.endsWith(suffix) ? card.id.slice(0, -suffix.length) : card.id.split('-')[0]
}

// ---------- Search ----------

/** Splits "charizard 4/102" into a name part and an optional number part. */
export function parseQuery(q: string): { name: string; number?: number; total?: number } {
  const m = q.trim().match(/^(?:(.*?)\s+)?#?(\d{1,3})(?:\s*\/\s*(\d{1,3}))?$/)
  if (m && (m[1] || m[3])) {
    return { name: (m[1] ?? '').trim(), number: parseInt(m[2], 10), total: m[3] ? parseInt(m[3], 10) : undefined }
  }
  return { name: q.trim() }
}

export async function searchCards(query: string): Promise<CardBrief[]> {
  const { name, number, total } = parseQuery(query)
  if (!name && number === undefined) return []

  const params = new URLSearchParams()
  if (name) params.set('name', name)
  else params.set('localId', String(number)) // number only: broad "contains" match, narrowed below
  params.set('pagination:itemsPerPage', '500')

  const [raw, sets] = await Promise.all([getJson<CardBrief[]>(`${BASE}/cards?${params}`), getSets()])

  let cards = raw.map((c) => ({ ...c, set: sets.get(setIdOf(c)) }))

  // Match the card number exactly ("4" also matches "004" in newer sets).
  if (number !== undefined) cards = cards.filter((c) => parseInt(c.localId, 10) === number)

  if (total !== undefined) {
    const matching = cards.filter((c) => c.set?.official === total)
    if (matching.length) cards = matching
  }

  // Oldest sets first — handy for a collection of old cards.
  cards.sort((a, b) => (a.set?.order ?? 9999) - (b.set?.order ?? 9999))
  return cards
}

// ---------- Card detail + prices ----------

interface RawCardmarket {
  updated?: string
  avg?: number | null
  low?: number | null
  trend?: number | null
  avg7?: number | null
  avg30?: number | null
  'low-holo'?: number | null
  'trend-holo'?: number | null
  'avg7-holo'?: number | null
  'avg30-holo'?: number | null
}

interface RawVariant {
  type?: string
  subtype?: string
  stamp?: string[]
  variantId?: string
  pricing?: { cardmarket?: RawCardmarket | null } | null
}

interface RawCard {
  id: string
  localId: string
  name: string
  image?: string
  rarity?: string
  illustrator?: string
  set: CardDetail['set']
  variants_detailed?: RawVariant[]
  pricing?: { cardmarket?: RawCardmarket | null } | null
}

const pos = (n: number | null | undefined) => (typeof n === 'number' && n > 0 ? n : null)

function toPrice(cm: RawCardmarket | null | undefined, reverse: boolean): CardmarketPrice | null {
  if (!cm) return null
  const p: CardmarketPrice = reverse
    ? { avg30: pos(cm['avg30-holo']), avg7: pos(cm['avg7-holo']), trend: pos(cm['trend-holo']), low: pos(cm['low-holo']), updated: cm.updated }
    : { avg30: pos(cm.avg30), avg7: pos(cm.avg7), trend: pos(cm.trend), low: pos(cm.low), updated: cm.updated }
  return p.avg30 || p.trend || p.low || p.avg7 ? p : null
}

const titleCase = (s: string) => s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

function variantLabel(v: RawVariant): string {
  const parts: string[] = []
  for (const s of v.stamp ?? []) parts.push(s === '1st-edition' ? '1st Edition' : titleCase(s))
  if (v.subtype && v.subtype !== 'unlimited') parts.push(titleCase(v.subtype))
  else if (v.subtype === 'unlimited') parts.push('Unlimited')
  const type = v.type === 'reverse' ? 'Reverse Holo' : v.type === 'holo' ? 'Holo' : v.type === 'normal' ? 'Non-holo' : v.type ? titleCase(v.type) : ''
  if (type) parts.push(type)
  return parts.join(' · ') || 'Standard'
}

const detailCache = new Map<string, Promise<CardDetail>>()

export function getCard(id: string): Promise<CardDetail> {
  let p = detailCache.get(id)
  if (!p) {
    p = getJson<RawCard>(`${BASE}/cards/${encodeURIComponent(id)}`).then((c) => {
      const versions: PriceVersion[] = (c.variants_detailed ?? []).map((v, i) => ({
        key: v.variantId ?? String(i),
        label: variantLabel(v),
        price: toPrice(v.pricing?.cardmarket, v.type === 'reverse'),
      }))
      if (!versions.some((v) => v.price) && c.pricing?.cardmarket) {
        // No per-version prices: fall back to the card's general price.
        versions.unshift({ key: 'card', label: 'Standard', price: toPrice(c.pricing.cardmarket, false) })
      }
      if (!versions.length) versions.push({ key: 'card', label: 'Standard', price: null })
      return { id: c.id, localId: c.localId, name: c.name, image: c.image, rarity: c.rarity, illustrator: c.illustrator, set: c.set, versions }
    })
    p.catch(() => detailCache.delete(id))
    detailCache.set(id, p)
  }
  return p
}

// ---------- Helpers ----------

export const cardImage = (image: string | undefined, quality: 'low' | 'high' = 'low') =>
  image ? `${image}/${quality}.webp` : undefined

const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
export const formatEur = (n: number | null | undefined) => (typeof n === 'number' ? eur.format(n) : '—')

/** The single number we treat as "the average price". */
export const mainPrice = (p: CardmarketPrice | null | undefined) => p?.avg30 ?? p?.trend ?? p?.avg7 ?? p?.low ?? null
