/**
 * Service Worker — Release Radar Expander
 * Fase 1: cache-first per shell, network-first per API
 * Abilita installabilità PWA.
 */

const CACHE_NAME = 'rr-expander-v1';

// Asset dello shell da cachare all'install
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  console.log('[SW] Install');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activate');
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Richieste Spotify API → sempre network (no cache)
  if (url.hostname === 'api.spotify.com' || url.hostname === 'accounts.spotify.com') {
    return; // lascia passare al browser
  }

  // Navigazione (HTML) → network-first, fallback cache
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Asset statici → cache-first
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
