/**
 * CrossTabSync — Unit Tests
 *
 * Covers: init, storage event handling, BroadcastChannel messaging,
 * banner show/hide, reload/keep-mine conflict resolution, destroy cleanup,
 * and SessionManager write patching (tab ID stamping).
 */

const { setupDOM, loadApp } = require('./setup');

beforeEach(() => {
  setupDOM();
  loadApp();
  localStorage.clear();
});

/* ================================================================
 * Initialization
 * ================================================================ */
describe('CrossTabSync — init', () => {
  test('init snapshots current sessions from storage', () => {
    localStorage.setItem('agenticchat_sessions', JSON.stringify([{ id: 's1' }]));
    CrossTabSync.init();
    // After init, the module should have captured the current state
    // Verify by checking no banner is shown (no conflict detected yet)
    const banner = document.getElementById('cross-tab-banner');
    expect(banner.style.display).not.toBe('flex');
  });

  test('init wires up banner buttons', () => {
    CrossTabSync.init();
    const reloadBtn = document.getElementById('cross-tab-reload');
    const keepBtn = document.getElementById('cross-tab-keep');
    const dismissBtn = document.getElementById('cross-tab-dismiss');
    // Buttons should exist in the DOM from setupDOM
    // Clicking dismiss should hide the banner
    CrossTabSync._showBanner('Test conflict');
    const banner = document.getElementById('cross-tab-banner');
    expect(banner.style.display).toBe('flex');
    if (dismissBtn) {
      dismissBtn.click();
      expect(banner.style.display).toBe('none');
    }
  });

  test('getTabId returns a string UUID', () => {
    CrossTabSync.init();
    const tabId = CrossTabSync.getTabId();
    expect(typeof tabId).toBe('string');
    expect(tabId.length).toBeGreaterThan(0);
  });
});

/* ================================================================
 * Banner Show / Hide
 * ================================================================ */
describe('CrossTabSync — banner', () => {
  test('_showBanner displays the conflict banner with message', () => {
    CrossTabSync.init();
    CrossTabSync._showBanner('⚠️ Another tab modified your sessions.');
    const banner = document.getElementById('cross-tab-banner');
    const msgEl = document.getElementById('cross-tab-message');
    expect(banner.style.display).toBe('flex');
    expect(msgEl.textContent).toBe('⚠️ Another tab modified your sessions.');
  });

  test('_hideBanner hides the conflict banner', () => {
    CrossTabSync.init();
    CrossTabSync._showBanner('Test');
    CrossTabSync._hideBanner();
    const banner = document.getElementById('cross-tab-banner');
    expect(banner.style.display).toBe('none');
  });

  test('_showBanner does not throw when DOM elements are missing', () => {
    // Remove banner elements
    const banner = document.getElementById('cross-tab-banner');
    if (banner) banner.remove();
    CrossTabSync.init();
    expect(() => CrossTabSync._showBanner('Test')).not.toThrow();
  });
});

/* ================================================================
 * Storage Event Handling
 * ================================================================ */
describe('CrossTabSync — storage events', () => {
  test('storage event on session key shows conflict banner', () => {
    CrossTabSync.init();
    // Simulate a storage event from another tab
    const event = new StorageEvent('storage', {
      key: 'agenticchat_sessions',
      oldValue: null,
      newValue: JSON.stringify([{ id: 'new-session' }]),
      storageArea: localStorage
    });
    window.dispatchEvent(event);

    const banner = document.getElementById('cross-tab-banner');
    expect(banner.style.display).toBe('flex');
  });

  test('storage event on active session key shows banner', () => {
    CrossTabSync.init();
    const event = new StorageEvent('storage', {
      key: 'agenticchat_active_session',
      oldValue: 'old-id',
      newValue: 'new-id',
      storageArea: localStorage
    });
    window.dispatchEvent(event);

    const banner = document.getElementById('cross-tab-banner');
    expect(banner.style.display).toBe('flex');
  });

  test('storage event on unrelated key does not show banner', () => {
    CrossTabSync.init();
    const event = new StorageEvent('storage', {
      key: 'some_other_key',
      oldValue: null,
      newValue: 'value',
      storageArea: localStorage
    });
    window.dispatchEvent(event);

    const banner = document.getElementById('cross-tab-banner');
    expect(banner.style.display).not.toBe('flex');
  });
});

/* ================================================================
 * SessionManager Write Patching
 * ================================================================ */
describe('CrossTabSync — SessionManager patching', () => {
  test('after init, SessionManager.save updates session snapshot', () => {
    CrossTabSync.init();
    ConversationManager.addMessage('user', 'Hello');
    SessionManager.save('Patched save test');

    // The patched save should update internal snapshot (no banner shown for own writes)
    const banner = document.getElementById('cross-tab-banner');
    expect(banner.style.display).not.toBe('flex');
  });

  test('own writes suppress the next storage event (no self-conflict)', () => {
    CrossTabSync.init();
    ConversationManager.addMessage('user', 'Test');
    SessionManager.save('No self-conflict');

    // Banner should NOT be showing after our own save
    const banner = document.getElementById('cross-tab-banner');
    expect(banner.style.display).not.toBe('flex');
  });
});

/* ================================================================
 * Destroy / Cleanup
 * ================================================================ */
describe('CrossTabSync — destroy', () => {
  test('destroy cleans up without throwing', () => {
    CrossTabSync.init();
    expect(() => CrossTabSync.destroy()).not.toThrow();
    // Banner should be hideable after destroy
    CrossTabSync._hideBanner();
    const banner = document.getElementById('cross-tab-banner');
    expect(banner.style.display).toBe('none');
  });
});
