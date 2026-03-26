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
const CACHE_NAME = 'agenticchat-v1';

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
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

/* Activate: clean up old caches and notify clients of the update */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => {
        const stale = keys.filter(k => k !== CACHE_NAME);
        return Promise.all(stale.map(k => caches.delete(k)))
          .then(() => stale.length); // pass count of evicted caches
      })
      .then(evicted => {
        if (evicted > 0) {
          // A new version replaced an old one — tell every open tab.
          self.clients.matchAll({ type: 'window' }).then(clients => {
            clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' }));
          });
        }
        return self.clients.claim();
      })
  );
});

/* Fetch: cache-first for app shell, network-first for API calls */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  /* Network-only for OpenAI API and other external requests */
  if (url.origin !== self.location.origin) {
    return;
  }

  /* Cache-first for app shell assets */
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) {
          /* Return cached version, update cache in background (stale-while-revalidate) */
          fetch(event.request)
            .then(response => {
              if (response.ok) {
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
              }
            })
            .catch(() => { /* background refresh failed — stale cache is fine */ });
          return cached;
        }
        /* Not cached — try network, cache the result */
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      })
  );
});
