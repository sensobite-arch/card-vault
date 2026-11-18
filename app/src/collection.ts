// Your saved cards. Everything is stored on the device itself (IndexedDB),
// so it works offline and nothing is sent anywhere.

import { useSyncExternalStore } from 'react'
import { createStore, del, get, set } from 'idb-keyval'
import { getCard, mainPrice, type CardDetail } from './api'
import type { Grading } from './condition'

const db = createStore('card-vault', 'data')

// ---------- Conditions (Cardmarket's scale) ----------

export type Condition = 'MT' | 'NM' | 'EX' | 'GD' | 'LP' | 'PL' | 'PO'

export const CONDITIONS: { code: Condition; name: string; help: string; factor: number }[] = [
  { code: 'MT', name: 'Mint', help: 'Perfect. No flaws at all, even up close.', factor: 1.25 },
  { code: 'NM', name: 'Near Mint', help: 'Looks new. At most a tiny flaw.', factor: 1.0 },
  { code: 'EX', name: 'Excellent', help: 'Light wear on edges or corners, a few small marks.', factor: 0.75 },
  { code: 'GD', name: 'Good', help: 'Clear wear: whitened edges, scratches, maybe a small crease.', factor: 0.55 },
  { code: 'LP', name: 'Light Played', help: 'Visible wear all over, small creases.', factor: 0.4 },
  { code: 'PL', name: 'Played', help: 'Heavy wear, creases, bends.', factor: 0.25 },
  { code: 'PO', name: 'Poor', help: 'Damaged: tears, water damage, writing.', factor: 0.12 },
]

export const conditionInfo = (c: Condition) => CONDITIONS.find((x) => x.code === c) ?? CONDITIONS[1]

// ---------- Languages ----------

export type Language = 'en' | 'nl' | 'ja' | 'de' | 'fr' | 'other'

export const LANGUAGES: { code: Language; name: string; flag: string }[] = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'nl', name: 'Dutch', flag: '🇳🇱' },
  { code: 'ja', name: 'Japanese', flag: '🇯🇵' },
  { code: 'de', name: 'German', flag: '🇩🇪' },
  { code: 'fr', name: 'French', flag: '🇫🇷' },
  { code: 'other', name: 'Other', flag: '🏳️' },
]

export const languageInfo = (l: Language) => LANGUAGES.find((x) => x.code === l) ?? LANGUAGES[0]

// ---------- Items ----------

export interface CollectionItem {
  id: string
  cardId: string
  name: string
  setName: string
  number: string // e.g. "4/102"
  image?: string // official picture (TCGdex)
  versionKey: string
  versionLabel: string
  condition: Condition
  language: Language
  quantity: number
  notes: string
  hasPhoto: boolean
  hasBackPhoto?: boolean
  grading?: Grading // result of the condition check, if done
  gradedPrices?: Partial<Record<number, number>> // real PSA prices you looked up (€), by grade
  addedAt: string
  basePrice: number | null // Cardmarket 30-day average for this version (all conditions)
  priceUpdated?: string // when we last fetched it
}

/** Estimated value of ONE copy, adjusted for condition. */
export const unitValue = (it: CollectionItem) =>
  it.basePrice == null ? null : Math.round(it.basePrice * conditionInfo(it.condition).factor * 100) / 100

/** Estimated value of all copies in this entry. */
export const itemValue = (it: CollectionItem) => {
  const u = unitValue(it)
  return u == null ? null : u * it.quantity
}

export const numberOf = (card: Pick<CardDetail, 'localId' | 'set'>) =>
  card.localId + (card.set.cardCount?.official ? `/${card.set.cardCount.official}` : '')

// ---------- Store ----------

let items: CollectionItem[] = []
let loaded = false
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

async function persist() {
  await set('collection', items, db)
}

export async function loadCollection() {
  if (loaded) return
  items = (await get<CollectionItem[]>('collection', db)) ?? []
  loaded = true
  emit()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useCollection(): CollectionItem[] {
  return useSyncExternalStore(subscribe, () => items)
}

export const getItem = (id: string) => items.find((i) => i.id === id)

export async function saveItem(item: CollectionItem, photo?: Blob | null) {
  if (photo) {
    await set(`photo:${item.id}`, photo, db)
    item = { ...item, hasPhoto: true }
  } else if (photo === null) {
    await del(`photo:${item.id}`, db)
    item = { ...item, hasPhoto: false }
  }
  const i = items.findIndex((x) => x.id === item.id)
  items = i >= 0 ? items.map((x) => (x.id === item.id ? item : x)) : [item, ...items]
  emit()
  await persist()
}

export async function deleteItem(id: string) {
  items = items.filter((x) => x.id !== id)
  emit()
  await Promise.all([persist(), del(`photo:${id}`, db), del(`photoBack:${id}`, db)])
}

export const getPhoto = (id: string) => get<Blob>(`photo:${id}`, db)
export const getBackPhoto = (id: string) => get<Blob>(`photoBack:${id}`, db)

/** Saves (blob) or removes (null) the photo of the back of a card. */
export async function setBackPhoto(id: string, blob: Blob | null) {
  if (blob) await set(`photoBack:${id}`, blob, db)
  else await del(`photoBack:${id}`, db)
}

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`

// ---------- Prices ----------

export function priceForVersion(card: CardDetail, versionKey: string, versionLabel?: string) {
  const v = card.versions.find((x) => x.key === versionKey) ?? card.versions.find((x) => x.label === versionLabel)
  return mainPrice(v?.price)
}

/** Fetches fresh prices for every saved card. Calls onProgress(done, total). */
export async function refreshAllPrices(onProgress?: (done: number, total: number) => void) {
  const list = [...items]
  let done = 0
  let failed = 0
  const queue = [...list]
  const worker = async () => {
    for (let it = queue.shift(); it; it = queue.shift()) {
      try {
        const card = await getCard(it.cardId)
        const price = priceForVersion(card, it.versionKey, it.versionLabel)
        const current = getItem(it.id)
        if (current) {
          items = items.map((x) => (x.id === it.id ? { ...current, basePrice: price, priceUpdated: new Date().toISOString() } : x))
          emit()
        }
      } catch {
        failed++
      }
      onProgress?.(++done, list.length)
    }
  }
  await Promise.all([worker(), worker(), worker()])
  await persist()
  return { total: list.length, failed }
}

// ---------- Photos ----------

/** Shrinks a camera photo so it doesn't fill up the phone (max 1600 px, JPEG). */
export async function compressPhoto(file: Blob, maxSize = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process the photo.'))), 'image/jpeg', 0.85),
  )
}
