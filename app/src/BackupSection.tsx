import { useState } from 'react'
import { canShareFiles, downloadFile, lastBackup, makeBackup, makeSpreadsheet, markBackedUp, readBackup, restoreBackup, shareFile } from './backup'
import { useCollection } from './collection'

type Pending = Awaited<ReturnType<typeof readBackup>>

export default function BackupSection() {
  const items = useCollection()
  const [includePhotos, setIncludePhotos] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const last = lastBackup()
  const shareSupported = canShareFiles(new File(['x'], 'x.json', { type: 'application/json' }))

  async function backup(how: 'save' | 'share') {
    setMessage(null)
    setBusy('Preparing backup…')
    try {
      const file = await makeBackup(includePhotos, (d, t) => setBusy(`Preparing backup… ${d}/${t}`))
      if (how === 'share') {
        if (!(await shareFile(file))) return setBusy(null)
      } else downloadFile(file)
      markBackedUp()
      const mb = (file.size / 1024 / 1024).toFixed(1)
      setMessage({ text: how === 'share' ? `Backup shared (${mb} MB).` : `Backup saved to your Downloads folder: ${file.name} (${mb} MB).` })
    } catch {
      setMessage({ text: 'Making the backup failed. Try again, or without photos.', error: true })
    } finally {
      setBusy(null)
    }
  }

  async function spreadsheet(how: 'save' | 'share') {
    setMessage(null)
    const file = makeSpreadsheet()
    try {
      if (how === 'share') await shareFile(file)
      else {
        downloadFile(file)
        setMessage({ text: `Spreadsheet saved to your Downloads folder: ${file.name}` })
      }
    } catch {
      setMessage({ text: 'Sharing failed.', error: true })
    }
  }

  async function pick(file: File | undefined) {
    if (!file) return
    setMessage(null)
    try {
      setPending(await readBackup(file))
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Could not read that file.', error: true })
    }
  }

  async function restore(mode: 'merge' | 'replace') {
    if (!pending) return
    setBusy('Restoring…')
    try {
      const r = await restoreBackup(pending, mode)
      setMessage({
        text:
          mode === 'replace'
            ? `Collection restored: ${r.added} cards.`
            : `${r.added} card${r.added === 1 ? '' : 's'} added${r.skipped ? `, ${r.skipped} you already had were skipped` : ''}.`,
      })
      setPending(null)
      setConfirmReplace(false)
    } catch {
      setMessage({ text: 'Restoring failed. Your collection was not changed.', error: true })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="backup">
      <div>
        <h3>Backup</h3>
        <p className="small">
          Your collection is only stored on this phone. Make a backup now and then, and keep it somewhere safe (Google Drive, email to yourself).
          <br />
          Last backup: <b>{last ? last.toLocaleDateString('nl-NL') : 'never'}</b>
        </p>
      </div>

      <label className="check-row">
        <input type="checkbox" checked={includePhotos} onChange={(e) => setIncludePhotos(e.target.checked)} />
        Include photos (bigger file)
      </label>
      <div className="btn-row">
        {shareSupported && (
          <button className="btn primary" disabled={!!busy || !items.length} onClick={() => backup('share')}>📤 Share backup</button>
        )}
        <button className={`btn ${shareSupported ? 'secondary' : 'primary'}`} disabled={!!busy || !items.length} onClick={() => backup('save')}>💾 Save to phone</button>
      </div>

      <div>
        <h3>Restore</h3>
        <p className="small">Load a backup file, for example on a new phone.</p>
      </div>
      {!pending ? (
        <label className="btn secondary">
          📂 Choose backup file
          <input type="file" accept=".json,application/json" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
        </label>
      ) : (
        <div className="restore-box">
          <span>
            Backup from <b>{new Date(pending.exportedAt).toLocaleDateString('nl-NL')}</b> with <b>{pending.items.length} cards</b>.
          </span>
          <button className="btn primary" disabled={!!busy} onClick={() => restore('merge')}>Add to my collection</button>
          {confirmReplace ? (
            <div className="confirm">
              <span>This deletes your current {items.length} cards and replaces them with the backup. Sure?</span>
              <button className="btn danger" disabled={!!busy} onClick={() => restore('replace')}>Yes, replace</button>
              <button className="btn ghost" onClick={() => setConfirmReplace(false)}>Cancel</button>
            </div>
          ) : (
            <button className="btn secondary" disabled={!!busy} onClick={() => (items.length ? setConfirmReplace(true) : restore('replace'))}>Replace my collection</button>
          )}
          <button className="btn ghost" onClick={() => setPending(null)}>Cancel</button>
        </div>
      )}

      <div>
        <h3>Spreadsheet</h3>
        <p className="small">All your cards with prices and grading advice, to open in Excel or Google Sheets.</p>
      </div>
      <div className="btn-row">
        {shareSupported && <button className="btn secondary" disabled={!items.length} onClick={() => spreadsheet('share')}>📤 Share spreadsheet</button>}
        <button className="btn secondary" disabled={!items.length} onClick={() => spreadsheet('save')}>📊 Save spreadsheet</button>
      </div>

      {busy && <div className="loading"><span className="spinner" /> {busy}</div>}
      {message && <p className={message.error ? 'error' : 'ok-msg'}>{message.text}</p>}
    </div>
  )
}
