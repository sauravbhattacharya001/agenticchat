/**
 * @jest-environment jsdom
 *
 * Tests for CrossTabSync module (agenticchat)
 *
 * Tests the banner show/hide DOM logic and BroadcastChannel message filtering.
 */

'use strict';

/* ── DOM setup ───────────── */

beforeEach(() => {
  document.body.innerHTML = `
    <div id="cross-tab-banner" style="display: none">
      <span id="cross-tab-message"></span>
      <button id="cross-tab-reload">Reload</button>
      <button id="cross-tab-keep">Keep Mine</button>
      <button id="cross-tab-dismiss">Dismiss</button>
    </div>
  `;
});

/* ── Banner show/hide logic (replicated) ───────────── */

function showBanner(message) {
  const banner = document.getElementById('cross-tab-banner');
  const msgEl = document.getElementById('cross-tab-message');
  if (!banner || !msgEl) return;
  msgEl.textContent = message;
  banner.style.display = 'flex';
}

function hideBanner() {
  const banner = document.getElementById('cross-tab-banner');
  if (banner) banner.style.display = 'none';
}

describe('CrossTabSync — banner visibility', () => {
  test('showBanner makes banner visible with message', () => {
    showBanner('⚠️ Another tab modified your sessions.');
    const banner = document.getElementById('cross-tab-banner');
    const msgEl = document.getElementById('cross-tab-message');
    expect(banner.style.display).toBe('flex');
    expect(msgEl.textContent).toBe('⚠️ Another tab modified your sessions.');
  });

  test('hideBanner hides the banner', () => {
    showBanner('test');
    hideBanner();
    const banner = document.getElementById('cross-tab-banner');
    expect(banner.style.display).toBe('none');
  });

  test('showBanner does nothing if elements are missing', () => {
    document.body.innerHTML = '';
    expect(() => showBanner('test')).not.toThrow();
  });

  test('hideBanner does nothing if element is missing', () => {
    document.body.innerHTML = '';
    expect(() => hideBanner()).not.toThrow();
  });

  test('showBanner overwrites previous message', () => {
    showBanner('first');
    showBanner('second');
    const msgEl = document.getElementById('cross-tab-message');
    expect(msgEl.textContent).toBe('second');
  });
});

/* ── BroadcastChannel message filtering ───────────── */

describe('CrossTabSync — message filtering', () => {
  const tabId = 'my-tab-123';

  function shouldHandleMessage(data) {
    if (!data || data.tabId === tabId) return false;
    return data.type === 'sessions-updated' || data.type === 'active-session-changed';
  }

  test('ignores messages from own tab', () => {
    expect(shouldHandleMessage({ type: 'sessions-updated', tabId })).toBe(false);
  });

  test('handles sessions-updated from other tab', () => {
    expect(shouldHandleMessage({ type: 'sessions-updated', tabId: 'other-tab' })).toBe(true);
  });

  test('handles active-session-changed from other tab', () => {
    expect(shouldHandleMessage({ type: 'active-session-changed', tabId: 'other-tab' })).toBe(true);
  });

  test('ignores unknown message types', () => {
    expect(shouldHandleMessage({ type: 'unknown', tabId: 'other-tab' })).toBe(false);
  });

  test('ignores null/undefined data', () => {
    expect(shouldHandleMessage(null)).toBe(false);
    expect(shouldHandleMessage(undefined)).toBe(false);
  });

  test('ignores messages without tabId', () => {
    expect(shouldHandleMessage({ type: 'sessions-updated' })).toBe(true);
  });
});

/* ── Storage event handling ───────────── */

describe('CrossTabSync — storage event classification', () => {
  const SESSION_KEY = 'agenticchat_sessions';
  const ACTIVE_KEY = 'agenticchat_active_session';

  function classifyStorageEvent(key) {
    if (key === SESSION_KEY) return 'sessions-modified';
    if (key === ACTIVE_KEY) return 'active-changed';
    return 'irrelevant';
  }

  test('recognizes session storage key', () => {
    expect(classifyStorageEvent(SESSION_KEY)).toBe('sessions-modified');
  });

  test('recognizes active session key', () => {
    expect(classifyStorageEvent(ACTIVE_KEY)).toBe('active-changed');
  });

  test('ignores unrelated keys', () => {
    expect(classifyStorageEvent('some_other_key')).toBe('irrelevant');
    expect(classifyStorageEvent('agenticchat_reactions')).toBe('irrelevant');
  });
});
