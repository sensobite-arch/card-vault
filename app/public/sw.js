// Service worker: lets the app open without internet and load faster.
// - The app itself: tries the internet first, falls back to the saved copy.
// - Card pictures and the text reader: saved after first use.
// - Prices: always fetched fresh (your collection keeps its own copy).

const APP_CACHE = 'card-vault-app-v1'
const MEDIA_CACHE = 'card-vault-media-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest', './favicon.svg'])))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== APP_CACHE && k !== MEDIA_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})

async function networkFirst(request) {
  const cache = await caches.open(APP_CACHE)
  try {
    const res = await fetch(request)
    if (res.ok) cache.put(request, res.clone())
    return res
  } catch {
    return (await cache.match(request)) || (await cache.match('./index.html')) || Response.error()
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  if (hit) return hit
  const res = await fetch(request)
  if (res.ok || res.type === 'opaque') cache.put(request, res.clone())
  return res
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  if (url.origin === self.location.origin) {
    // Built files have a unique name per version, so they never change.
    if (url.pathname.includes('/assets/')) event.respondWith(cacheFirst(request, APP_CACHE))
    else event.respondWith(networkFirst(request))
    return
  }
  if (url.hostname === 'assets.tcgdex.net' || url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'tessdata.projectnaptha.com') {
    event.respondWith(cacheFirst(request, MEDIA_CACHE))
  }
})
