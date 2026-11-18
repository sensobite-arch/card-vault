// "Is this card worth sending in for grading?"
// Compares the card's value now with its likely value once graded, minus costs.

import { useSyncExternalStore } from 'react'
import { conditionInfo, unitValue, type CollectionItem, type Condition } from './collection'

// ---------- Settings (stored on this device) ----------

export interface GradingSettings {
  fee: number // grading fee per card, cheapest service level (€)
  feeMid: number // fee when the graded card is worth more than midFrom
  midFrom: number
  feeHigh: number // fee when worth more than highFrom
  highFrom: number
  shipping: number // shipping + insurance for one submission, both ways (€)
  batch: number // how many cards you usually send at once
  sellFee: number // % lost when selling (platform fees)
  minGain: number // only say "worth it" above this expected profit (€)
}

export const DEFAULT_SETTINGS: GradingSettings = {
  fee: 25,
  feeMid: 75,
  midFrom: 450,
  feeHigh: 150,
  highFrom: 1400,
  shipping: 40,
  batch: 10,
  sellFee: 8,
  minGain: 25,
}

const KEY = 'card-vault-grading-settings'
let settings: GradingSettings = load()
const listeners = new Set<() => void>()

function load(): GradingSettings {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(s: GradingSettings) {
  settings = s
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable: keep for this session */
  }
  listeners.forEach((l) => l())
}

export function useGradingSettings(): GradingSettings {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => settings,
  )
}

// ---------- Graded value ----------

/**
 * Typical price of a graded copy compared with the Cardmarket average
 * (which mixes all conditions). Rough rules of thumb for older cards.
 */
const MULTIPLIER: Record<number, number> = { 10: 8, 9: 2.5, 8: 1.5, 7: 1.1, 6: 0.9, 5: 0.75, 4: 0.6, 3: 0.5, 2: 0.4, 1: 0.3 }
const MIN_SLAB = 15 // a graded card rarely sells for less than this

/** Expected grade (upper end of the range) when no condition check was done. */
const GRADE_FROM_CONDITION: Record<Condition, number> = { MT: 10, NM: 9, EX: 7, GD: 5, LP: 4, PL: 2, PO: 1 }

export function gradedValue(item: CollectionItem, grade: number): { value: number | null; real: boolean } {
  const g = Math.max(1, Math.min(10, grade))
  const manual = item.gradedPrices?.[g]
  if (manual != null && manual > 0) return { value: manual, real: true }
  if (item.basePrice == null) return { value: null, real: false }
  return { value: Math.max(MIN_SLAB, Math.round(item.basePrice * MULTIPLIER[g])), real: false }
}

// ---------- Advice ----------

export type Verdict = 'worth' | 'maybe' | 'no' | 'unknown'

export interface Advice {
  verdict: Verdict
  grade: number // upper end of the expected range
  fromCheck: boolean // true = based on the photo condition check
  raw: number | null // value of the card as it is now
  low: { grade: number; value: number | null; real: boolean }
  high: { grade: number; value: number | null; real: boolean }
  expected: number | null // likely graded price
  costs: number
  sellCosts: number
  gain: number | null // expected profit compared with selling it ungraded
}

export function adviseGrading(item: CollectionItem, s: GradingSettings = settings): Advice {
  const fromCheck = !!item.grading?.grade
  const grade = item.grading?.grade ?? GRADE_FROM_CONDITION[item.condition]
  const highG = grade
  const lowG = Math.max(1, grade - 1)
  const high = { grade: highG, ...gradedValue(item, highG) }
  const low = { grade: lowG, ...gradedValue(item, lowG) }
  const raw = unitValue(item)

  if (raw == null || high.value == null || low.value == null) {
    return { verdict: 'unknown', grade, fromCheck, raw, low, high, expected: null, costs: 0, sellCosts: 0, gain: null }
  }
  // A 10 is hard to get: lean towards the lower grade.
  const wHigh = highG >= 10 ? 0.35 : 0.5
  const expected = Math.round(high.value * wHigh + low.value * (1 - wHigh))
  const fee = expected >= s.highFrom ? s.feeHigh : expected >= s.midFrom ? s.feeMid : s.fee
  const costs = Math.round(fee + s.shipping / Math.max(1, s.batch))
  const sellCosts = Math.round((expected * s.sellFee) / 100)
  const gain = Math.round(expected - sellCosts - costs - raw)

  let verdict: Verdict = 'no'
  if (gain >= s.minGain && expected - sellCosts >= 1.25 * (raw + costs)) verdict = 'worth'
  else if (gain > 0) verdict = 'maybe'
  return { verdict, grade, fromCheck, raw, low, high, expected, costs, sellCosts, gain }
}

export const VERDICT_TEXT: Record<Verdict, string> = {
  worth: 'Worth grading',
  maybe: 'Maybe — small gain',
  no: 'Not worth grading',
  unknown: 'No price to compare',
}

/** Link to eBay's SOLD listings for this card at a given grade (real recent prices). */
export function ebaySoldLink(item: Pick<CollectionItem, 'name' | 'setName' | 'number'>, grade: number) {
  const q = `${item.name} ${item.setName} ${item.number.split('/')[0]} PSA ${grade}`
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_Sold=1&LH_Complete=1&_sop=13`
}

export const conditionLabel = (c: Condition) => conditionInfo(c).name
