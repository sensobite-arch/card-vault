import { useEffect, useState } from 'react'
import './App.css'
import type { CardDetail } from './api'
import CardDetailView from './CardDetailView'
import CollectionPage from './CollectionPage'
import { getItem, protectStorage, useCollection } from './collection'
import ItemForm from './ItemForm'
import ScanPage from './ScanPage'
import SearchPage from './SearchPage'
import SettingsSheet from './SettingsSheet'

type Tab = 'search' | 'scan' | 'collection'

export default function App() {
  const [tab, setTab] = useState<Tab>('search')
  const [openCardId, setOpenCardId] = useState<string | null>(null)
  const [addCard, setAddCard] = useState<CardDetail | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [scanPhoto, setScanPhoto] = useState<Blob | null>(null) // photo from the scanner, used when adding
  const collection = useCollection() // re-render when the collection changes
  const hasCards = collection.length > 0
  // Once you have cards, ask the browser to never clear the app's storage by itself.
  useEffect(() => {
    if (hasCards) protectStorage()
  }, [hasCards])
  const editItem = editId ? getItem(editId) : undefined

  function showToast(text: string) {
    setToast(text)
    setTimeout(() => setToast(null), 2500)
  }

  return (
    <div className="app">
      <header className="topbar">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="logo" />
        <h1>Card Vault</h1>
        <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings">⚙️</button>
      </header>

      <main className="content">
        {tab === 'search' && <SearchPage onOpen={setOpenCardId} />}
        {tab === 'scan' && (
          <ScanPage
            onPick={(cardId, photo) => {
              setScanPhoto(photo)
              setOpenCardId(cardId)
            }}
            onSearchByHand={() => setTab('search')}
          />
        )}
        {tab === 'collection' && <CollectionPage onEdit={setEditId} onGoSearch={() => setTab('search')} onOpenSettings={() => setSettingsOpen(true)} />}
      </main>

      <nav className="tabbar">
        <TabButton active={tab === 'search'} onClick={() => setTab('search')} icon="🔍" label="Search" />
        <TabButton active={tab === 'scan'} onClick={() => setTab('scan')} icon="📷" label="Scan" />
        <TabButton active={tab === 'collection'} onClick={() => setTab('collection')} icon="🗂️" label="Collection" />
      </nav>

      {openCardId && (
        <CardDetailView
          id={openCardId}
          onClose={() => {
            setOpenCardId(null)
            setScanPhoto(null)
          }}
          onAdd={setAddCard}
        />
      )}
      {addCard && (
        <ItemForm
          mode="new"
          card={addCard}
          initialPhoto={scanPhoto}
          onClose={() => setAddCard(null)}
          onSaved={() => showToast(`${addCard.name} added to your collection`)}
        />
      )}
      {editItem && (
        <ItemForm key={editItem.id} mode="edit" item={editItem} onClose={() => setEditId(null)} onViewCard={setOpenCardId} />
      )}

      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function TabButton(props: { active: boolean; onClick: () => void; icon: string; label: string }) {
  return (
    <button className={`tab ${props.active ? 'active' : ''}`} onClick={props.onClick}>
      <span className="tab-icon" aria-hidden>{props.icon}</span>
      <span>{props.label}</span>
    </button>
  )
}
