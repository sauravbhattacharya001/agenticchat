/* Service Worker for Agentic Chat — offline app shell caching */
'use strict';

const CACHE_NAME = 'agenticchat-v1';
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

/* Activate: clean up old caches */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
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
          /* Return cached version, update cache in background */
          const fetchPromise = fetch(event.request)
            .then(response => {
              if (response.ok) {
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
              }
              return response;
            })
            .catch(() => cached);
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
