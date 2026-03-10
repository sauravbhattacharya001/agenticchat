/**
 * Tests for OfflineManager — offline detection, UI, and service worker registration
 */

const { setupDOM, loadApp } = require('./setup');

beforeAll(() => {
  setupDOM();
  loadApp();
});

describe('OfflineManager', () => {
  let banner, sendBtn;

  beforeEach(() => {
    banner = document.getElementById('offline-banner');
    sendBtn = document.getElementById('send-btn');
    // Reset state
    banner.style.display = 'none';
    sendBtn.disabled = false;
    sendBtn.title = '';
    // Default to online
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      writable: true,
      configurable: true
    });
  });

  test('OfflineManager is defined', () => {
    expect(typeof OfflineManager).toBe('object');
    expect(typeof OfflineManager.init).toBe('function');
    expect(typeof OfflineManager.isOffline).toBe('function');
  });

  test('isOffline returns false when online', () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    expect(OfflineManager.isOffline()).toBe(false);
  });

  test('isOffline returns true when offline', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    expect(OfflineManager.isOffline()).toBe(true);
  });

  test('offline event shows banner and disables send button', () => {
    OfflineManager.init();
    window.dispatchEvent(new Event('offline'));
    expect(banner.style.display).toBe('');
    expect(sendBtn.disabled).toBe(true);
    expect(sendBtn.title).toContain('offline');
  });

  test('online event hides banner and enables send button', () => {
    OfflineManager.init();
    // Go offline first
    window.dispatchEvent(new Event('offline'));
    expect(banner.style.display).toBe('');
    // Go back online
    window.dispatchEvent(new Event('online'));
    expect(banner.style.display).toBe('none');
    expect(sendBtn.disabled).toBe(false);
  });

  test('dismiss button hides banner', () => {
    OfflineManager.init();
    window.dispatchEvent(new Event('offline'));
    expect(banner.style.display).toBe('');
    const dismissBtn = document.getElementById('offline-dismiss');
    dismissBtn.click();
    expect(banner.style.display).toBe('none');
  });

  test('init shows banner when starting offline', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    OfflineManager.init();
    expect(banner.style.display).toBe('');
    expect(sendBtn.disabled).toBe(true);
  });

  test('init does not show banner when starting online', () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    OfflineManager.init();
    expect(banner.style.display).toBe('none');
  });
});
