// Backup (everything, including photos, in one file), restore, and a
// spreadsheet export of the collection.

import { allItems, conditionInfo, getBackPhoto, getPhoto, importItems, itemValue, languageInfo, unitValue, type CollectionItem } from './collection'
import { gradeRange } from './condition'
import { adviseGrading, saveSettings, VERDICT_TEXT, type GradingSettings } from './grading'

const LAST_BACKUP_KEY = 'card-vault-last-backup'

interface BackupFile {
  app: 'card-vault'
  version: 1
  exportedAt: string
  items: CollectionItem[]
  photos: Record<string, string> // item id -> data URL
  backPhotos: Record<string, string>
  settings?: GradingSettings
}

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(b)
  })

const dataUrlToBlob = async (d: string) => (await fetch(d)).blob()

const today = () => new Date().toISOString().slice(0, 10)

export async function makeBackup(includePhotos: boolean, onProgress?: (done: number, total: number) => void): Promise<File> {
  const items = allItems()
  const photos: Record<string, string> = {}
  const backPhotos: Record<string, string> = {}
  if (includePhotos) {
    let done = 0
    for (const it of items) {
      if (it.hasPhoto) {
        const b = await getPhoto(it.id)
        if (b) photos[it.id] = await blobToDataUrl(b)
      }
      if (it.hasBackPhoto) {
        const b = await getBackPhoto(it.id)
        if (b) backPhotos[it.id] = await blobToDataUrl(b)
      }
      onProgress?.(++done, items.length)
    }
  }
  let settings: GradingSettings | undefined
  try {
    const raw = localStorage.getItem('card-vault-grading-settings')
    settings = raw ? JSON.parse(raw) : undefined
  } catch {
    /* ignore */
  }
  const data: BackupFile = {
    app: 'card-vault',
    version: 1,
    exportedAt: new Date().toISOString(),
    items: includePhotos ? items : items.map((i) => ({ ...i, hasPhoto: false, hasBackPhoto: false })),
    photos,
    backPhotos,
    settings,
  }
  return new File([JSON.stringify(data)], `card-vault-backup-${today()}.json`, { type: 'application/json' })
}

export function markBackedUp() {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString())
  } catch {
    /* ignore */
  }
}

export function lastBackup(): Date | null {
  try {
    const v = localStorage.getItem(LAST_BACKUP_KEY)
    return v ? new Date(v) : null
  } catch {
    return null
  }
}

/** Reads a backup file and returns what's in it, without changing anything yet. */
export async function readBackup(file: File): Promise<BackupFile> {
  let data: BackupFile
  try {
    data = JSON.parse(await file.text())
  } catch {
    throw new Error('This file is not a Card Vault backup.')
  }
  if (data?.app !== 'card-vault' || !Array.isArray(data.items)) throw new Error('This file is not a Card Vault backup.')
  return data
}

export async function restoreBackup(data: BackupFile, mode: 'merge' | 'replace') {
  const toBlobs = async (m: Record<string, string> = {}) => {
    const out: Record<string, Blob> = {}
    for (const [id, d] of Object.entries(m)) out[id] = await dataUrlToBlob(d)
    return out
  }
  const result = await importItems(data.items, await toBlobs(data.photos), await toBlobs(data.backPhotos), mode)
  if (data.settings && mode === 'replace') saveSettings(data.settings)
  return result
}

// ---------- Spreadsheet ----------

/** A CSV file that opens in Excel / Google Sheets (semicolons and decimal commas, as Dutch Excel expects). */
export function makeSpreadsheet(): File {
  const num = (n: number | null | undefined) => (n == null ? '' : n.toFixed(2).replace('.', ','))
  const cell = (v: string | number) => {
    const s = String(v)
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = ['Name', 'Set', 'Number', 'Version', 'Condition', 'Language', 'Quantity', 'Cardmarket average (€)', 'Value per card (€)', 'Total value (€)', 'Estimated grade', 'Grading advice', 'Expected gain from grading (€)', 'Notes', 'Added']
  const rows = allItems().map((it) => {
    const a = adviseGrading(it)
    return [
      it.name,
      it.setName,
      it.number,
      it.versionLabel,
      conditionInfo(it.condition).name,
      languageInfo(it.language).name,
      it.quantity,
      num(it.basePrice),
      num(unitValue(it)),
      num(itemValue(it)),
      it.grading?.grade ? gradeRange(it.grading.grade) : '',
      VERDICT_TEXT[a.verdict],
      num(a.gain),
      it.notes,
      it.addedAt.slice(0, 10),
    ]
  })
  const csv = '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n')
  return new File([csv], `card-vault-collection-${today()}.csv`, { type: 'text/csv' })
}

// ---------- Saving / sharing files ----------

export const canShareFiles = (f: File) => {
  try {
    return !!navigator.canShare?.({ files: [f] })
  } catch {
    return false
  }
}

/** Opens the phone's share menu (Google Drive, email, WhatsApp…). */
export async function shareFile(f: File): Promise<boolean> {
  try {
    await navigator.share({ files: [f], title: f.name })
    return true
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return false // you closed the share menu
    throw e
  }
}

/** Saves the file to the phone's Downloads folder. */
export function downloadFile(f: File) {
  const url = URL.createObjectURL(f)
  const a = document.createElement('a')
  a.href = url
  a.download = f.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
