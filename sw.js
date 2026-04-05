/**
 * Service Worker for Agentic Chat — offline app shell caching.
 *
 * Strategy:
 *  - **Install:** pre-caches the minimal app shell (HTML, JS, CSS).
 *  - **Activate:** evicts stale caches from prior versions.
 *  - **Fetch:** cache-first for same-origin assets (with background refresh);
 *    network-only for cross-origin requests (e.g. OpenAI API).
 *
 * @module sw
 */
'use strict';

/** @const {string} Current cache version key. Bump to bust stale caches. */
const CACHE_NAME = 'agenticchat-cf172949b4';

/** @const {string[]} URLs pre-cached during the install phase. */
const APP_SHELL = [
  '/',
  '/index.html',
  '/app.js',
  '/style.css'
];

/* Install: pre-cache app shell */
self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(APP_SHELL);
      await self.skipWaiting();
    })()
  );
});

/* Activate: clean up old caches and notify clients of the update */
self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const stale = keys.filter(k => k !== CACHE_NAME);
      await Promise.all(stale.map(k => caches.delete(k)));
      if (stale.length > 0) {
        // A new version replaced an old one — tell every open tab.
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' }));
      }
      await self.clients.claim();
    })()
  );
});

/**
 * Minimum interval (ms) between background revalidation attempts for the
 * same URL.  Prevents redundant network fetches on rapid successive loads
 * (e.g. soft-reloads, SPA navigations).  The app shell is only ~1.2 MB
 * total — re-downloading it on every sub-resource request was wasteful.
 * With this throttle, each asset is revalidated at most once per interval.
 */
const REVALIDATE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** Tracks the last revalidation timestamp per URL path. */
const _lastRevalidated = new Map();

/* Fetch: cache-first for app shell, network-first for API calls */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  /* Network-only for OpenAI API and other external requests */
  if (url.origin !== self.location.origin) {
    return;
  }

  /* Only handle GET requests */
  if (event.request.method !== 'GET') {
    return;
  }

  /* Cache-first for app shell assets */
  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      if (cached) {
        /* Throttled background revalidation: only refetch if enough
           time has elapsed since the last revalidation for this URL.
           This avoids re-downloading app.js (1 MB) on every request
           while still picking up updates within a few minutes. */
        const path = url.pathname;
        const now = Date.now();
        const last = _lastRevalidated.get(path) || 0;
        if (now - last > REVALIDATE_INTERVAL_MS) {
          _lastRevalidated.set(path, now);
          fetch(event.request)
            .then(async response => {
              if (response.ok) {
                const cache = await caches.open(CACHE_NAME);
                await cache.put(event.request, response);
              }
            })
            .catch(() => { /* revalidation failed — stale cache is fine */ });
        }
        return cached;
      }
      /* Not cached — try network, cache the result */
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, response.clone());
      }
      return response;
    })()
  );
});
