// Reads the name and number from a photo of a card (on the phone itself,
// with Tesseract.js) and finds the matching cards in TCGdex.

import { createWorker, PSM, type Worker } from 'tesseract.js'
import { getSets, type CardBrief } from './api'
import { getCatalog } from './catalog'

// ---------- Text recognition ----------

let workerPromise: Promise<Worker> | null = null
let statusListener: ((s: string) => void) | null = null

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') return
        statusListener?.(m.status.includes('load') || m.status.includes('init') ? 'Preparing the text reader (first time only)…' : 'Reading card…')
      },
    }).catch((e) => {
      workerPromise = null
      throw e
    })
  }
  return workerPromise
}

/** Start loading the text reader early so the first scan is quicker. */
export function warmUpScanner() {
  getWorker().catch(() => {})
}

/** Copies part of an image, made larger and black-and-white so text is easier to read. */
function strip(src: HTMLCanvasElement, x: number, y: number, w: number, h: number, targetHeight: number, filter = 'grayscale(1) contrast(1.4)'): HTMLCanvasElement {
  const scale = Math.max(1, targetHeight / h)
  const c = document.createElement('canvas')
  c.width = Math.round(w * scale)
  c.height = Math.round(h * scale)
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.filter = filter
  ctx.drawImage(src, x, y, w, h, 0, 0, c.width, c.height)
  return c
}

/**
 * Reads the name band. The Pokémon's name is the biggest text there, so words
 * are returned biggest first ("Evolves from Charmeleon" is small print).
 */
async function readNameWords(image: HTMLCanvasElement): Promise<string[]> {
  const worker = await getWorker()
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK })
  const { data } = await worker.recognize(image, {}, { text: true, blocks: true })
  const found: { text: string; height: number }[] = []
  for (const block of data.blocks ?? [])
    for (const para of block.paragraphs)
      for (const line of para.lines) {
        const clean = line.text.replace(/evolves\s+from\s+\S+/gi, ' ').replace(/put\s+\S+\s+on\s+the/gi, ' ')
        for (const word of line.words) {
          if (!clean.includes(word.text)) continue
          if (word.confidence < 40) continue
          found.push({ text: word.text, height: word.bbox.y1 - word.bbox.y0 })
        }
      }
  const maxH = Math.max(0, ...found.map((f) => f.height))
  const big = found.filter((f) => f.height >= maxH * 0.7).map((f) => f.text)
  const rest = found.filter((f) => f.height < maxH * 0.7).map((f) => f.text)
  const words = nameWords([...big, '|', ...rest].join(' '))
  return words.length ? words : nameWords(data.text)
}

async function read(image: HTMLCanvasElement, psm: PSM): Promise<string> {
  const worker = await getWorker()
  await worker.setParameters({ tessedit_pageseg_mode: psm })
  const { data } = await worker.recognize(image)
  return data.text
}

// ---------- Making sense of the text ----------

const fixDigits = (s: string) => s.replace(/[Oo]/g, '0').replace(/[lIi|]/g, '1').replace(/[Ss]/g, '5').replace(/B/g, '8')

/** Finds a card number like "4/102" in recognized text. */
export function findNumber(text: string): { number: number; total: number } | null {
  const re = /([0-9OoIl]{1,3})\s*[/\\|]\s*([0-9OoIl]{2,3})/g
  let best: { number: number; total: number } | null = null
  for (const m of text.matchAll(re)) {
    const number = parseInt(fixDigits(m[1]), 10)
    const total = parseInt(fixDigits(m[2]), 10)
    if (number > 0 && total >= 10 && number <= total + 60) {
      best = { number, total } // the last match is usually the card number at the bottom
    }
  }
  return best
}

const STOP = new Set(
  ('stage basic pokemon pokémon evolves from put on the this card trainer energy hp lv level power attack weakness resistance retreat cost illus nintendo creatures gamefreak game freak wizards ability rule when your turn with ' +
    'length weight species damage flip coin coins heads tails opponent opponents active bench benched discard attach attached does each more plus pokemons defending until next during cards hand deck edition').split(' '),
)

/** Words that might be (part of) the Pokémon's name. */
export function nameWords(text: string): string[] {
  const words = text
    .split(/[^A-Za-zÀ-ÿ'’.-]+/)
    .map((w) => w.replace(/^[^A-Za-zÀ-ÿ]+|[^A-Za-zÀ-ÿ]+$/g, ''))
    .filter((w) => w.length >= 3 && !STOP.has(w.toLowerCase()))
  return [...new Set(words)]
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')

function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]
    d[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j]
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return d[b.length]
}

/** 0..1: how well the recognized words match a card name. */
export function nameScore(words: string[], cardName: string): number {
  const parts = cardName.split(/\s+/).map(norm).filter((p) => p.length >= 2)
  let best = 0
  words.map(norm).forEach((w, i) => {
    if (w.length < 3) return
    for (const p of parts) {
      // Words read earlier (higher up on the card) count a little more.
      const s = (1 - levenshtein(w, p) / Math.max(w.length, p.length)) * (1 - Math.min(i, 10) * 0.02)
      if (s > best) best = s
    }
  })
  return best
}

// ---------- Finding the card in a photo ----------

export type Box = { x: number; y: number; w: number; h: number }

/** Looks for the yellow border most Pokémon cards have. Returns null if not found. */
export function findCardBox(image: HTMLCanvasElement): Box | null {
  const scale = Math.min(1, 320 / Math.max(image.width, image.height))
  const w = Math.round(image.width * scale)
  const h = Math.round(image.height * scale)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(image, 0, 0, w, h)
  const px = ctx.getImageData(0, 0, w, h).data
  const rows = new Array<number>(h).fill(0)
  const cols = new Array<number>(w).fill(0)
  let total = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const r = px[i], g = px[i + 1], b = px[i + 2]
      // "Yellow": red and green high, blue clearly lower.
      if (r > 140 && g > 110 && b < r * 0.6 && b < g * 0.7 && Math.abs(r - g) < 90) {
        rows[y]++
        cols[x]++
        total++
      }
    }
  }
  if (total < w * h * 0.03) return null
  const edge = (arr: number[], min: number) => {
    let a = arr.findIndex((v) => v >= min)
    let b = arr.length - 1 - [...arr].reverse().findIndex((v) => v >= min)
    return a < 0 ? null : [a, b]
  }
  const ys = edge(rows, Math.max(3, Math.max(...rows) * 0.25))
  const xs = edge(cols, Math.max(3, Math.max(...cols) * 0.25))
  if (!ys || !xs) return null
  const box = { x: xs[0] / scale, y: ys[0] / scale, w: (xs[1] - xs[0] + 1) / scale, h: (ys[1] - ys[0] + 1) / scale }
  const ratio = box.w / box.h
  if (ratio < 0.6 || ratio > 0.85 || box.h < image.height * 0.2) return null
  return box
}

// ---------- Comparing the artwork ----------

const SIG_W = 16
const SIG_H = 12

/** A tiny colour thumbnail of the artwork area, used to compare pictures. */
function artSignature(src: CanvasImageSource, box: Box): Float32Array {
  const c = document.createElement('canvas')
  c.width = SIG_W
  c.height = SIG_H
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  // The artwork sits roughly in this part of the card, for most eras.
  ctx.drawImage(src, box.x + box.w * 0.12, box.y + box.h * 0.14, box.w * 0.76, box.h * 0.36, 0, 0, SIG_W, SIG_H)
  const d = ctx.getImageData(0, 0, SIG_W, SIG_H).data
  const sig = new Float32Array(SIG_W * SIG_H * 3)
  for (let i = 0, j = 0; i < d.length; i += 4) {
    sig[j++] = d[i]
    sig[j++] = d[i + 1]
    sig[j++] = d[i + 2]
  }
  // Remove overall brightness/contrast differences (lighting, camera).
  let mean = 0
  for (const v of sig) mean += v
  mean /= sig.length
  let sd = 0
  for (const v of sig) sd += (v - mean) ** 2
  sd = Math.sqrt(sd / sig.length) || 1
  for (let i = 0; i < sig.length; i++) sig[i] = (sig[i] - mean) / sd
  return sig
}

/** -1..1, higher = pictures look more alike. */
function similarity(a: Float32Array, b: Float32Array) {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s / a.length
}

async function candidateSignature(image: string): Promise<Float32Array | null> {
  try {
    const res = await fetch(`${image}/low.webp`)
    if (!res.ok) return null
    const bmp = await createImageBitmap(await res.blob())
    const sig = artSignature(bmp, { x: 0, y: 0, w: bmp.width, h: bmp.height })
    bmp.close()
    return sig
  } catch {
    return null
  }
}

// ---------- Finding the card ----------

const BASE = 'https://api.tcgdex.net/v2/en'

/** Cards with this number in a set of this size (from the saved card list, or online). */
async function cardsWithNumber(number: number, total: number): Promise<CardBrief[]> {
  try {
    const all = await getCatalog()
    return all.filter((c) => c.set?.official === total && parseInt(c.localId, 10) === number)
  } catch {
    const sets = [...(await getSets()).values()].filter((s) => s.official === total)
    const found = await Promise.all(
      sets.map(async (s) => {
        const res = await fetch(`${BASE}/sets/${s.id}/${number}`).catch(() => null)
        if (!res?.ok) return null
        const c = (await res.json()) as { id: string; localId: string; name: string; image?: string }
        return { id: c.id, localId: c.localId, name: c.name, image: c.image, set: s } satisfies CardBrief
      }),
    )
    return found.filter((c): c is NonNullable<typeof c> => c !== null)
  }
}

/** Cards whose name is close to the words that were read, even when misspelled ("MNakazam" → Alakazam). */
async function cardsWithName(words: string[], number?: number): Promise<CardBrief[]> {
  if (!words.length) return []
  let all: CardBrief[]
  try {
    all = await getCatalog()
  } catch {
    return []
  }
  const byName = new Map<string, CardBrief[]>()
  for (const c of all) {
    const list = byName.get(c.name)
    if (list) list.push(c)
    else byName.set(c.name, [c])
  }
  const scored = [...byName.keys()].map((name) => ({ name, score: nameScore(words, name) }))
  const best = Math.max(0, ...scored.map((s) => s.score))
  if (best < 0.6) return []
  const names = scored.filter((s) => s.score >= Math.max(0.6, best - 0.08)).sort((a, b) => b.score - a.score).slice(0, 15)
  let cards = names.flatMap((n) => byName.get(n.name)!)
  if (number !== undefined) {
    const sameNumber = cards.filter((c) => parseInt(c.localId, 10) === number)
    if (sameNumber.length) cards = sameNumber
  }
  return cards
}

export interface ScanResult {
  number: { number: number; total: number } | null
  words: string[]
  candidates: (CardBrief & { score: number })[]
  confident: boolean // true when the first candidate is a clear winner
  box: Box | null // where the card is in the photo
}

export async function identify(words: string[], number: ScanResult['number'], scanSig?: Float32Array | null): Promise<Omit<ScanResult, 'box'>> {
  let candidates: CardBrief[] = []
  if (number) candidates = await cardsWithNumber(number.number, number.total)

  // Number found but the name doesn't fit any of those cards? Then also search by name.
  const fits = candidates.some((c) => nameScore(words, c.name) >= 0.7)
  if (!candidates.length || !fits) {
    const byName = await cardsWithName(words, number?.number)
    const ids = new Set(candidates.map((c) => c.id))
    candidates = [...candidates, ...byName.filter((c) => !ids.has(c.id))]
  }

  let scored = candidates.map((c) => {
    let score = nameScore(words, c.name)
    if (number && parseInt(c.localId, 10) === number.number) score += 0.5
    if (number && c.set?.official === number.total) score += 0.5
    return { ...c, score }
  })
  scored.sort((a, b) => b.score - a.score || (a.set?.order ?? 9999) - (b.set?.order ?? 9999))
  scored = scored.slice(0, 40)

  // Several possible cards? Compare the artwork with the photo to pick the right print.
  if (scanSig && scored.length > 1) {
    const sigs = await Promise.all(scored.map((c) => (c.image ? candidateSignature(c.image) : Promise.resolve(null))))
    scored = scored.map((c, i) => ({ ...c, score: c.score + (sigs[i] ? Math.max(0, similarity(scanSig, sigs[i]!)) * 1.2 : 0) }))
    scored.sort((a, b) => b.score - a.score || (a.set?.order ?? 9999) - (b.set?.order ?? 9999))
  }

  // Reprints with the same artwork score almost the same: then show the oldest print first.
  if (scored.length > 1) {
    const top = scored[0]
    const twins = scored.filter((c) => c.name === top.name && top.score - c.score < 0.2)
    if (twins.length > 1) {
      twins.sort((a, b) => (a.set?.order ?? 9999) - (b.set?.order ?? 9999))
      const ids = new Set(twins.map((c) => c.id))
      scored = [...twins.map((c) => ({ ...c, score: top.score })), ...scored.filter((c) => !ids.has(c.id))]
    }
  }

  const [first, second] = scored
  const confident = !!first && first.score >= 1.5 && (!second || first.score - second.score >= 0.15)
  return { number, words, candidates: scored.slice(0, 24), confident }
}

/**
 * Reads a card. `guideBox` is where the card should be if it was lined up with
 * the frame; the app first tries to find the card's actual border itself.
 */
export async function scanCard(image: HTMLCanvasElement, guideBox: Box | null, onStatus: (s: string) => void): Promise<ScanResult> {
  statusListener = onStatus
  getCatalog().catch(() => {}) // start loading the card list in parallel
  try {
    onStatus('Reading card…')
    let words: string[] = []
    let number: ScanResult['number'] = null
    const box = findCardBox(image) ?? guideBox

    if (box) {
      const { x, y, w, h } = box
      // Name: top band of the card. Number: bottom band (tried twice, the second time bigger).
      words = await readNameWords(strip(image, x + w * 0.04, y + h * 0.02, w * 0.8, h * 0.11, 120))
      number = findNumber(await read(strip(image, x, y + h * 0.86, w, h * 0.14, 160), PSM.SPARSE_TEXT))
      if (!number) number = findNumber(await read(strip(image, x, y + h * 0.92, w, h * 0.08, 280, 'grayscale(1) contrast(2)'), PSM.SPARSE_TEXT))
    }

    const sig = box ? artSignature(image, box) : null
    onStatus('Finding the card…')
    let result = box && words.length ? await identify(words, number, sig) : null

    if (!result?.confident) {
      // Not sure yet: read everything on the picture and try again with all the words.
      onStatus('Looking more closely…')
      const scale = Math.max(1, 1800 / Math.max(image.width, image.height))
      const text = await read(strip(image, 0, 0, image.width, image.height, image.height * scale), PSM.SPARSE_TEXT)
      const allWords = [...new Set([...words, ...nameWords(text).slice(0, 12)])]
      const second = await identify(allWords, number ?? findNumber(text), sig)
      if (!result || (second.candidates.length && (second.confident || !result.candidates.length || second.candidates[0].score > result.candidates[0].score)))
        result = second
    }

    return { ...result, box }
  } finally {
    statusListener = null
  }
}
