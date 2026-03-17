/**
 * Tests for sw.js — Service Worker caching strategies
 *
 * Verifies install (pre-caching), activate (stale cache eviction),
 * and fetch (cache-first for same-origin, network-only for cross-origin).
 */

// Mock service worker globals
let installHandler, activateHandler, fetchHandler;
const listeners = {};

const self = {
  addEventListener: (event, handler) => {
    listeners[event] = handler;
  },
  skipWaiting: jest.fn(() => Promise.resolve()),
  clients: { claim: jest.fn(() => Promise.resolve()) },
  location: { origin: 'https://agenticchat.app' },
};
global.self = self;

// Mock caches API
const cacheStore = {};
const mockCache = (name) => {
  if (!cacheStore[name]) {
    const store = new Map();
    cacheStore[name] = {
      addAll: jest.fn((urls) => {
        urls.forEach(u => store.set(u, `cached:${u}`));
        return Promise.resolve();
      }),
      put: jest.fn((req, resp) => {
        const key = typeof req === 'string' ? req : req.url;
        store.set(key, resp);
        return Promise.resolve();
      }),
      match: jest.fn((req) => {
        const key = typeof req === 'string' ? req : req.url;
        return Promise.resolve(store.get(key) || undefined);
      }),
      _store: store,
    };
  }
  return cacheStore[name];
};

global.caches = {
  open: jest.fn((name) => Promise.resolve(mockCache(name))),
  keys: jest.fn(() => Promise.resolve(Object.keys(cacheStore))),
  delete: jest.fn((name) => {
    delete cacheStore[name];
    return Promise.resolve(true);
  }),
  match: jest.fn((req) => {
    const key = typeof req === 'string' ? req : req.url;
    for (const name of Object.keys(cacheStore)) {
      const val = cacheStore[name]._store.get(key);
      if (val) return Promise.resolve(val);
    }
    return Promise.resolve(undefined);
  }),
};

// Mock fetch
global.fetch = jest.fn(() =>
  Promise.resolve({ ok: true, clone: () => ({ cloned: true }) })
);

// Helper: create a FetchEvent-like object
function makeFetchEvent(url, origin) {
  let respondWithCallback = null;
  return {
    request: { url, clone: () => ({ url }) },
    waitUntil: jest.fn((p) => p),
    respondWith: jest.fn((p) => { respondWithCallback = p; }),
    get _response() { return respondWithCallback; },
  };
}

// Load the service worker (registers listeners on `self`)
beforeAll(() => {
  // Provide a minimal ExtendableEvent
  jest.isolateModules(() => {
    require('../sw.js');
  });
  installHandler = listeners['install'];
  activateHandler = listeners['activate'];
  fetchHandler = listeners['fetch'];
});

beforeEach(() => {
  jest.clearAllMocks();
  // Clear cache store between tests
  Object.keys(cacheStore).forEach(k => delete cacheStore[k]);
});

describe('Service Worker - Install', () => {
  test('registers install, activate, and fetch handlers', () => {
    expect(installHandler).toBeDefined();
    expect(activateHandler).toBeDefined();
    expect(fetchHandler).toBeDefined();
  });

  test('install pre-caches app shell and calls skipWaiting', async () => {
    let captured;
    const event = { waitUntil: jest.fn(p => { captured = p; }) };
    installHandler(event);
    await captured;

    expect(event.waitUntil).toHaveBeenCalled();
    expect(caches.open).toHaveBeenCalledWith('agenticchat-v1');

    const cache = mockCache('agenticchat-v1');
    expect(cache.addAll).toHaveBeenCalledWith([
      '/', '/index.html', '/app.js', '/style.css'
    ]);
    expect(self.skipWaiting).toHaveBeenCalled();
  });
});

describe('Service Worker - Activate', () => {
  test('deletes old caches and claims clients', async () => {
    // Pre-populate with stale cache
    mockCache('agenticchat-v0');
    mockCache('agenticchat-v1');
    mockCache('other-old-cache');

    let captured;
    const event = { waitUntil: jest.fn(p => { captured = p; }) };
    activateHandler(event);
    await captured;

    expect(event.waitUntil).toHaveBeenCalled();
    // Should delete all caches except agenticchat-v1
    expect(caches.delete).toHaveBeenCalledWith('agenticchat-v0');
    expect(caches.delete).toHaveBeenCalledWith('other-old-cache');
    expect(caches.delete).not.toHaveBeenCalledWith('agenticchat-v1');
    expect(self.clients.claim).toHaveBeenCalled();
  });

  test('does nothing when only current cache exists', async () => {
    mockCache('agenticchat-v1');

    let captured;
    const event = { waitUntil: jest.fn(p => { captured = p; }) };
    activateHandler(event);
    await captured;

    expect(caches.delete).not.toHaveBeenCalled();
    expect(self.clients.claim).toHaveBeenCalled();
  });
});

describe('Service Worker - Fetch', () => {
  test('ignores cross-origin requests (network-only)', () => {
    const event = makeFetchEvent('https://api.openai.com/v1/chat', 'https://api.openai.com');
    fetchHandler(event);

    // Should not call respondWith for cross-origin
    expect(event.respondWith).not.toHaveBeenCalled();
  });

  test('returns cached response for same-origin cache hit', async () => {
    // Pre-populate cache
    const cache = mockCache('agenticchat-v1');
    cache._store.set('https://agenticchat.app/index.html', 'cached-response');

    const event = makeFetchEvent('https://agenticchat.app/index.html');
    fetchHandler(event);

    expect(event.respondWith).toHaveBeenCalled();
    const response = await event._response;
    expect(response).toBe('cached-response');
  });

  test('fetches from network on cache miss and caches result', async () => {
    const mockResponse = { ok: true, clone: () => 'cloned-response' };
    global.fetch.mockResolvedValueOnce(mockResponse);

    const event = makeFetchEvent('https://agenticchat.app/new-page.html');
    fetchHandler(event);

    expect(event.respondWith).toHaveBeenCalled();
    const response = await event._response;
    expect(response).toBe(mockResponse);
    expect(global.fetch).toHaveBeenCalled();
  });

  test('does not cache failed network responses', async () => {
    const mockResponse = { ok: false, clone: () => 'bad-clone' };
    global.fetch.mockResolvedValueOnce(mockResponse);

    const event = makeFetchEvent('https://agenticchat.app/missing.html');
    fetchHandler(event);

    const response = await event._response;
    expect(response).toBe(mockResponse);

    // cache.put should not have been called with a non-ok response
    const cache = mockCache('agenticchat-v1');
    const putCalls = cache.put.mock.calls.filter(
      ([req]) => (typeof req === 'string' ? req : req.url) === 'https://agenticchat.app/missing.html'
    );
    expect(putCalls).toHaveLength(0);
  });
});
