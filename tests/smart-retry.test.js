/**
 * SmartRetry - Unit Tests
 */

const { setupDOM, loadApp } = require('./setup');

beforeEach(() => {
  setupDOM();
  loadApp();
  SmartRetry.init();
  SmartRetry.setEnabled(true);
  SmartRetry.resetStats();
});

/* ================================================================
 * Core retry logic
 * ================================================================ */
describe('SmartRetry', () => {

  test('returns successful result immediately without retry', async () => {
    const fn = jest.fn().mockResolvedValue({ ok: true, data: 'good' });
    const result = await SmartRetry.withRetry(fn, { showIndicator: false });
    expect(result.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries on 429 status', async () => {
    const fn = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, error: 'rate limited' })
      .mockResolvedValue({ ok: true, data: 'good' });
    const result = await SmartRetry.withRetry(fn, { showIndicator: false, maxRetries: 1 });
    expect(result.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('retries on 500 status', async () => {
    const fn = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, error: 'server error' })
      .mockResolvedValue({ ok: true, data: 'recovered' });
    const result = await SmartRetry.withRetry(fn, { showIndicator: false, maxRetries: 1 });
    expect(result.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('retries on 502 status', async () => {
    const fn = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 502, error: 'bad gateway' })
      .mockResolvedValue({ ok: true, data: 'ok' });
    const result = await SmartRetry.withRetry(fn, { showIndicator: false, maxRetries: 1 });
    expect(result.ok).toBe(true);
  });

  test('retries on 503 status', async () => {
    const fn = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, error: 'unavailable' })
      .mockResolvedValue({ ok: true, data: 'ok' });
    const result = await SmartRetry.withRetry(fn, { showIndicator: false, maxRetries: 1 });
    expect(result.ok).toBe(true);
  });

  test('retries on network error (thrown exception)', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValue({ ok: true, data: 'recovered' });
    const result = await SmartRetry.withRetry(fn, { showIndicator: false, maxRetries: 1 });
    expect(result.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('does NOT retry on 401 (not transient)', async () => {
    const fn = jest.fn()
      .mockResolvedValue({ ok: false, status: 401, error: 'unauthorized' });
    const result = await SmartRetry.withRetry(fn, { showIndicator: false });
    expect(result.ok).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('does NOT retry on 400 (not transient)', async () => {
    const fn = jest.fn()
      .mockResolvedValue({ ok: false, status: 400, error: 'bad request' });
    const result = await SmartRetry.withRetry(fn, { showIndicator: false });
    expect(result.ok).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('gives up after maxRetries', async () => {
    const fn = jest.fn()
      .mockResolvedValue({ ok: false, status: 429, error: 'rate limited' });
    const result = await SmartRetry.withRetry(fn, { showIndicator: false, maxRetries: 2 });
    expect(result.ok).toBe(false);
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  test('skips retry when disabled', async () => {
    SmartRetry.setEnabled(false);
    const fn = jest.fn()
      .mockResolvedValue({ ok: false, status: 429, error: 'rate limited' });
    const result = await SmartRetry.withRetry(fn, { showIndicator: false });
    expect(result.ok).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

/* ================================================================
 * isRetryable
 * ================================================================ */
describe('SmartRetry.isRetryable', () => {
  test('returns true for 429', () => {
    expect(SmartRetry.isRetryable({ status: 429 })).toBe(true);
  });

  test('returns true for 500', () => {
    expect(SmartRetry.isRetryable({ status: 500 })).toBe(true);
  });

  test('returns true for 502', () => {
    expect(SmartRetry.isRetryable({ status: 502 })).toBe(true);
  });

  test('returns true for 503', () => {
    expect(SmartRetry.isRetryable({ status: 503 })).toBe(true);
  });

  test('returns true for networkError', () => {
    expect(SmartRetry.isRetryable({ networkError: true })).toBe(true);
  });

  test('returns false for 401', () => {
    expect(SmartRetry.isRetryable({ status: 401 })).toBe(false);
  });

  test('returns false for 400', () => {
    expect(SmartRetry.isRetryable({ status: 400 })).toBe(false);
  });

  test('returns false for null', () => {
    expect(SmartRetry.isRetryable(null)).toBe(false);
  });

  test('returns false for successful result', () => {
    expect(SmartRetry.isRetryable({ ok: true })).toBe(false);
  });
});

/* ================================================================
 * getDelay (exponential backoff)
 * ================================================================ */
describe('SmartRetry.getDelay', () => {
  test('attempt 0 is ~1000ms', () => {
    const d = SmartRetry.getDelay(0);
    expect(d).toBeGreaterThanOrEqual(1000);
    expect(d).toBeLessThan(1400);
  });

  test('attempt 1 is ~2000ms', () => {
    const d = SmartRetry.getDelay(1);
    expect(d).toBeGreaterThanOrEqual(2000);
    expect(d).toBeLessThan(2400);
  });

  test('attempt 2 is ~4000ms', () => {
    const d = SmartRetry.getDelay(2);
    expect(d).toBeGreaterThanOrEqual(4000);
    expect(d).toBeLessThan(4400);
  });

  test('delays increase exponentially', () => {
    const d0 = SmartRetry.getDelay(0);
    const d1 = SmartRetry.getDelay(1);
    const d2 = SmartRetry.getDelay(2);
    expect(d1).toBeGreaterThan(d0);
    expect(d2).toBeGreaterThan(d1);
  });
});

/* ================================================================
 * Statistics
 * ================================================================ */
describe('SmartRetry statistics', () => {
  test('starts with zero stats', () => {
    const stats = SmartRetry.getStats();
    expect(stats.totalRetries).toBe(0);
    expect(stats.successfulRetries).toBe(0);
    expect(stats.failedRetries).toBe(0);
  });

  test('tracks successful retry', async () => {
    const fn = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, error: 'rl' })
      .mockResolvedValue({ ok: true, data: 'ok' });
    await SmartRetry.withRetry(fn, { showIndicator: false, maxRetries: 1 });
    const stats = SmartRetry.getStats();
    expect(stats.totalRetries).toBe(1);
    expect(stats.successfulRetries).toBe(1);
  });

  test('tracks failed retry (exhausted)', async () => {
    const fn = jest.fn()
      .mockResolvedValue({ ok: false, status: 500, error: 'err' });
    await SmartRetry.withRetry(fn, { showIndicator: false, maxRetries: 1 });
    const stats = SmartRetry.getStats();
    expect(stats.totalRetries).toBe(1);
    expect(stats.failedRetries).toBe(1);
  });

  test('resetStats clears all counters', async () => {
    const fn = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, error: 'rl' })
      .mockResolvedValue({ ok: true, data: 'ok' });
    await SmartRetry.withRetry(fn, { showIndicator: false, maxRetries: 1 });
    SmartRetry.resetStats();
    const stats = SmartRetry.getStats();
    expect(stats.totalRetries).toBe(0);
    expect(stats.successfulRetries).toBe(0);
    expect(stats.failedRetries).toBe(0);
  });
});

/* ================================================================
 * Enable/Disable
 * ================================================================ */
describe('SmartRetry enable/disable', () => {
  test('isEnabled defaults to true', () => {
    expect(SmartRetry.isEnabled()).toBe(true);
  });

  test('setEnabled(false) disables retry', () => {
    SmartRetry.setEnabled(false);
    expect(SmartRetry.isEnabled()).toBe(false);
  });

  test('setEnabled(true) re-enables retry', () => {
    SmartRetry.setEnabled(false);
    SmartRetry.setEnabled(true);
    expect(SmartRetry.isEnabled()).toBe(true);
  });
});

/* ================================================================
 * Retry indicator DOM
 * ================================================================ */
describe('SmartRetry indicator', () => {
  test('_showRetryIndicator creates DOM element', () => {
    SmartRetry._showRetryIndicator(0, 2000, 'test error');
    const el = document.getElementById('smart-retry-indicator');
    expect(el).not.toBeNull();
    expect(el.textContent).toContain('Retrying');
    expect(el.textContent).toContain('test error');
  });

  test('_clearIndicator removes DOM element', () => {
    SmartRetry._showRetryIndicator(0, 2000, 'test');
    SmartRetry._clearIndicator();
    const el = document.getElementById('smart-retry-indicator');
    expect(el).toBeNull();
  });

  test('showing new indicator replaces old one', () => {
    SmartRetry._showRetryIndicator(0, 1000, 'first');
    SmartRetry._showRetryIndicator(1, 2000, 'second');
    const els = document.querySelectorAll('#smart-retry-indicator');
    expect(els.length).toBe(1);
    expect(els[0].textContent).toContain('second');
  });
});

/* ================================================================
 * Constants
 * ================================================================ */
describe('SmartRetry constants', () => {
  test('MAX_RETRIES is 3', () => {
    expect(SmartRetry.MAX_RETRIES).toBe(3);
  });

  test('RETRYABLE_STATUSES includes 429, 500, 502, 503', () => {
    expect(SmartRetry.RETRYABLE_STATUSES.has(429)).toBe(true);
    expect(SmartRetry.RETRYABLE_STATUSES.has(500)).toBe(true);
    expect(SmartRetry.RETRYABLE_STATUSES.has(502)).toBe(true);
    expect(SmartRetry.RETRYABLE_STATUSES.has(503)).toBe(true);
  });

  test('RETRYABLE_STATUSES does NOT include 401 or 404', () => {
    expect(SmartRetry.RETRYABLE_STATUSES.has(401)).toBe(false);
    expect(SmartRetry.RETRYABLE_STATUSES.has(404)).toBe(false);
  });
});
