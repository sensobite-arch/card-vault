// Estimates a card's condition from photos (centering, whitening) plus a few
// questions, and turns that into an estimated PSA grade and Cardmarket condition.
// This is an estimate to help you decide — not a professional grading.

import type { Condition } from './collection'
import { findCardBox, isBlue, isYellow, type Box } from './scanner'

// ---------- Types ----------

export interface Centering {
  left: number // border widths in pixels (of the analysed image)
  right: number
  top: number
  bottom: number
  lr: [number, number] // e.g. [58, 42]
  tb: [number, number]
  worst: number // 0.5 = perfect, 1 = completely off
}

export interface Whitening {
  level: 'none' | 'some' | 'clear'
  corners: string[] // corners with whitening, e.g. ["top left"]
  edges: string[]
}

export type QuestionId = 'corners' | 'edges' | 'surface' | 'creases' | 'damage'

export interface Grading {
  front: Centering | null
  back: Centering | null
  whitening: Whitening | null
  answers: Partial<Record<QuestionId, number>> // index of the chosen option
  grade: number | null // estimated PSA grade (upper end of the range)
  suggested: Condition | null
  checkedAt: string
}

// ---------- Questions ----------

export const QUESTIONS: { id: QuestionId; title: string; help: string; options: { label: string; cap: number }[] }[] = [
  {
    id: 'corners',
    title: 'Corners',
    help: 'Look at all four corners, front and back.',
    options: [
      { label: 'Sharp, no white', cap: 10 },
      { label: 'Tiny white spot on 1–2 corners', cap: 8 },
      { label: 'White on several corners', cap: 6 },
      { label: 'Rounded, soft or bent', cap: 4 },
    ],
  },
  {
    id: 'edges',
    title: 'Edges',
    help: 'White specks along the edges show best on the dark blue back.',
    options: [
      { label: 'Clean', cap: 10 },
      { label: 'A few small white specks', cap: 8 },
      { label: 'Clear white along the edges', cap: 6 },
      { label: 'Chipped or frayed', cap: 4 },
    ],
  },
  {
    id: 'surface',
    title: 'Surface',
    help: 'Tilt the card under a lamp to see scratches (especially on holo cards).',
    options: [
      { label: 'Clean and glossy', cap: 10 },
      { label: 'Light scratches, only visible at an angle', cap: 8 },
      { label: 'Visible scratches or scuffs', cap: 6 },
      { label: 'Heavy scratches or dull', cap: 4 },
    ],
  },
  {
    id: 'creases',
    title: 'Creases, bends, dents',
    help: 'Hold the card flat at eye level and against the light.',
    options: [
      { label: 'None', cap: 10 },
      { label: 'Small dent or light bend', cap: 6 },
      { label: 'A visible crease', cap: 4 },
      { label: 'Several or heavy creases', cap: 2 },
    ],
  },
  {
    id: 'damage',
    title: 'Other damage',
    help: 'Stains, writing, stickers, water damage, tears.',
    options: [
      { label: 'None', cap: 10 },
      { label: 'Yes', cap: 2 },
    ],
  },
]

// ---------- Loading photos ----------

/** Draws a photo onto a canvas, at most `max` pixels on its longest side. */
export async function photoToCanvas(blob: Blob, max = 1400): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob)
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  return c
}

// ---------- Centering ----------

type Pixels = { data: Uint8ClampedArray; w: number; h: number }

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}

/**
 * Walks along one line of pixels from outside the card inwards and returns
 * [outer edge, inner edge] of the coloured border, or null.
 */
function walk(px: Pixels, points: [number, number][], isBorder: (r: number, g: number, b: number) => boolean): [number, number] | null {
  const at = (i: number) => {
    const [x, y] = points[i]
    const k = (y * px.w + x) * 4
    return [px.data[k], px.data[k + 1], px.data[k + 2]] as const
  }
  // Outer edge: first of 3 border-coloured pixels in a row.
  let outer = -1
  for (let i = 0; i + 2 < points.length; i++) {
    if (isBorder(...at(i)) && isBorder(...at(i + 1)) && isBorder(...at(i + 2))) {
      outer = i
      break
    }
  }
  if (outer < 0) return null
  // The border's own colour, measured just inside the edge.
  const sample: number[][] = []
  for (let i = outer + 2; i < Math.min(points.length, outer + 6); i++) sample.push([...at(i)])
  if (!sample.length) return null
  const ref = [0, 1, 2].map((c) => median(sample.map((s) => s[c])))
  // Inner edge: colour clearly changes for 3 pixels in a row.
  const diff = (i: number) => {
    const [r, g, b] = at(i)
    return Math.abs(r - ref[0]) + Math.abs(g - ref[1]) + Math.abs(b - ref[2])
  }
  for (let i = outer + 3; i + 2 < points.length; i++) {
    if (diff(i) > 90 && diff(i + 1) > 90 && diff(i + 2) > 90) return [outer, i]
  }
  return null
}

/** Measures the four border widths. Works on the yellow front or the blue back. */
export function measureCentering(image: HTMLCanvasElement, side: 'front' | 'back'): (Centering & { box: Box }) | null {
  const isBorder = side === 'front' ? isYellow : isBlue
  const box = findCardBox(image, isBorder)
  if (!box) return null
  const ctx = image.getContext('2d', { willReadFrequently: true })!
  const px: Pixels = { data: ctx.getImageData(0, 0, image.width, image.height).data, w: image.width, h: image.height }
  const clampX = (x: number) => Math.max(0, Math.min(px.w - 1, Math.round(x)))
  const clampY = (y: number) => Math.max(0, Math.min(px.h - 1, Math.round(y)))
  const pad = 0.04 // start a little outside the card
  const reach = 0.25 // borders are never wider than this part of the card

  const side4 = { left: [] as number[], right: [] as number[], top: [] as number[], bottom: [] as number[] }
  const lines = 40
  for (let k = 0; k < lines; k++) {
    const t = 0.25 + (0.5 * k) / (lines - 1) // middle half of each side (away from corners)
    const y = clampY(box.y + box.h * t)
    const x = clampX(box.x + box.w * t)
    const horiz = (from: number, to: number): [number, number][] => {
      const pts: [number, number][] = []
      const step = from < to ? 1 : -1
      for (let i = clampX(from); step > 0 ? i <= clampX(to) : i >= clampX(to); i += step) pts.push([i, y])
      return pts
    }
    const vert = (from: number, to: number): [number, number][] => {
      const pts: [number, number][] = []
      const step = from < to ? 1 : -1
      for (let i = clampY(from); step > 0 ? i <= clampY(to) : i >= clampY(to); i += step) pts.push([x, i])
      return pts
    }
    const l = walk(px, horiz(box.x - box.w * pad, box.x + box.w * reach), isBorder)
    const r = walk(px, horiz(box.x + box.w * (1 + pad), box.x + box.w * (1 - reach)), isBorder)
    const tp = walk(px, vert(box.y - box.h * pad, box.y + box.h * reach), isBorder)
    const bt = walk(px, vert(box.y + box.h * (1 + pad), box.y + box.h * (1 - reach)), isBorder)
    if (l) side4.left.push(l[1] - l[0])
    if (r) side4.right.push(r[1] - r[0])
    if (tp) side4.top.push(tp[1] - tp[0])
    if (bt) side4.bottom.push(bt[1] - bt[0])
  }
  // Need enough good measurements on every side.
  if (Object.values(side4).some((a) => a.length < lines * 0.4)) return null
  const left = median(side4.left)
  const right = median(side4.right)
  const top = median(side4.top)
  const bottom = median(side4.bottom)
  // Sanity check: borders between 1% and 15% of the card.
  const okW = (v: number) => v >= box.w * 0.01 && v <= box.w * 0.15
  const okH = (v: number) => v >= box.h * 0.008 && v <= box.h * 0.12
  if (!okW(left) || !okW(right) || !okH(top) || !okH(bottom)) return null
  const pct = (a: number, b: number): [number, number] => {
    const p = Math.round((100 * a) / (a + b))
    return [p, 100 - p]
  }
  const worst = Math.max(left, right) / (left + right) > Math.max(top, bottom) / (top + bottom) ? Math.max(left, right) / (left + right) : Math.max(top, bottom) / (top + bottom)
  return { left, right, top, bottom, lr: pct(left, right), tb: pct(top, bottom), worst, box }
}

/** "58/42" with the bigger number first, like graders write it. */
export const ratioText = (r: [number, number]) => `${Math.max(...r)}/${Math.min(...r)}`

// ---------- Whitening (back) ----------

/** Looks for light specks on the outer part of the blue border on the back. */
export function detectWhitening(image: HTMLCanvasElement, c: Centering & { box: Box }): Whitening {
  const ctx = image.getContext('2d', { willReadFrequently: true })!
  const { data } = ctx.getImageData(0, 0, image.width, image.height)
  const W = image.width
  const { box } = c
  const bw = (c.left + c.right) / 2
  const bh = (c.top + c.bottom) / 2
  // Only the outer 60% of the border, skipping the very outermost pixels (photo blur).
  const isWhite = (x: number, y: number) => {
    const k = (Math.round(y) * W + Math.round(x)) * 4
    const r = data[k], g = data[k + 1], b = data[k + 2]
    return r > 150 && g > 150 && b > 150 && Math.max(r, g, b) - Math.min(r, g, b) < 70
  }
  const regions: Record<string, { white: number; total: number }> = {}
  const add = (name: string, x: number, y: number) => {
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return
    const reg = (regions[name] ??= { white: 0, total: 0 })
    reg.total++
    if (isWhite(x, y)) reg.white++
  }
  const inset = 2
  for (let y = box.y; y < box.y + box.h; y += 1) {
    const zone = y < box.y + box.h * 0.12 ? 'top' : y > box.y + box.h * 0.88 ? 'bottom' : 'mid'
    for (let d = inset; d < inset + bw * 0.6; d++) {
      add(zone === 'mid' ? 'left edge' : `${zone} left`, box.x + d, y)
      add(zone === 'mid' ? 'right edge' : `${zone} right`, box.x + box.w - 1 - d, y)
    }
  }
  for (let x = box.x + box.w * 0.12; x < box.x + box.w * 0.88; x += 1) {
    for (let d = inset; d < inset + bh * 0.6; d++) {
      add('top edge', x, box.y + d)
      add('bottom edge', x, box.y + box.h - 1 - d)
    }
  }
  const share = (n: string) => (regions[n] ? regions[n].white / Math.max(1, regions[n].total) : 0)
  const corners = ['top left', 'top right', 'bottom left', 'bottom right'].filter((n) => share(n) > 0.02)
  const edges = ['left edge', 'right edge', 'top edge', 'bottom edge'].filter((n) => share(n) > 0.01)
  const worst = Math.max(...Object.keys(regions).map(share))
  const level: Whitening['level'] = worst > 0.06 ? 'clear' : corners.length || edges.length ? 'some' : 'none'
  return { level, corners, edges }
}

// ---------- Grade ----------

export function centeringCap(c: Centering | null, side: 'front' | 'back'): number {
  if (!c) return 10
  const w = c.worst
  if (side === 'back') return w <= 0.75 ? 10 : w <= 0.9 ? 9 : w <= 0.95 ? 7 : 5
  return w <= 0.55 ? 10 : w <= 0.6 ? 9 : w <= 0.65 ? 8 : w <= 0.7 ? 7 : w <= 0.8 ? 6 : w <= 0.85 ? 5 : w <= 0.9 ? 3 : 2
}

export function estimateGrade(g: Pick<Grading, 'front' | 'back' | 'answers'>): { grade: number | null; complete: boolean } {
  let grade = Math.min(centeringCap(g.front, 'front'), centeringCap(g.back, 'back'))
  let answered = 0
  for (const q of QUESTIONS) {
    const a = g.answers[q.id]
    if (a === undefined) continue
    answered++
    grade = Math.min(grade, q.options[a].cap)
  }
  return { grade: answered || g.front ? grade : null, complete: answered === QUESTIONS.length }
}

export function gradeRange(grade: number) {
  return grade >= 10 ? 'PSA 9–10' : grade <= 1 ? 'PSA 1' : `PSA ${grade - 1}–${grade}`
}

export function suggestedCondition(grade: number): Condition {
  if (grade >= 10) return 'MT'
  if (grade >= 8) return 'NM'
  if (grade >= 6) return 'EX'
  if (grade >= 5) return 'GD'
  if (grade >= 3) return 'LP'
  if (grade >= 2) return 'PL'
  return 'PO'
}

/** Pre-fills the corner/edge answers from the whitening found on the back photo. */
export function answersFromWhitening(w: Whitening): Partial<Record<QuestionId, number>> {
  const level = w.level === 'none' ? 0 : w.level === 'some' ? 1 : 2
  return {
    corners: w.corners.length === 0 ? 0 : w.corners.length <= 2 && level < 2 ? 1 : 2,
    edges: w.edges.length === 0 ? 0 : level,
  }
}

// ---------- Drawing ----------

/** Draws the photo with the measured borders marked, for showing on screen. */
export function drawOverlay(image: HTMLCanvasElement, c: (Centering & { box: Box }) | null, maxH = 520): HTMLCanvasElement {
  const crop = c ? { x: c.box.x - c.box.w * 0.05, y: c.box.y - c.box.h * 0.05, w: c.box.w * 1.1, h: c.box.h * 1.1 } : { x: 0, y: 0, w: image.width, h: image.height }
  const s = Math.min(1, maxH / crop.h) * (window.devicePixelRatio || 1)
  const out = document.createElement('canvas')
  out.width = Math.round(crop.w * s)
  out.height = Math.round(crop.h * s)
  const ctx = out.getContext('2d')!
  ctx.drawImage(image, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height)
  if (!c) return out
  const X = (x: number) => (x - crop.x) * s
  const Y = (y: number) => (y - crop.y) * s
  const { box } = c
  ctx.lineWidth = Math.max(2, out.width / 250)
  ctx.setLineDash([out.width / 60, out.width / 90])
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.strokeRect(X(box.x), Y(box.y), box.w * s, box.h * s)
  ctx.setLineDash([])
  ctx.strokeStyle = '#2ee66b'
  ctx.strokeRect(X(box.x + c.left), Y(box.y + c.top), (box.w - c.left - c.right) * s, (box.h - c.top - c.bottom) * s)
  return out
}
