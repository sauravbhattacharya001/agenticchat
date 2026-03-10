/**
 * ContextWindowMeter - Unit Tests
 */

const { setupDOM, loadApp } = require('./setup');

beforeEach(() => {
  setupDOM();
  loadApp();
  localStorage.clear();
});

describe('ContextWindowMeter', () => {
  // ── _colorClass ─────────────────────────────────────────────────
  describe('_colorClass', () => {
    test('returns green for ratio < 0.60', () => {
      expect(ContextWindowMeter._colorClass(0)).toBe('context-meter__fill--green');
      expect(ContextWindowMeter._colorClass(0.3)).toBe('context-meter__fill--green');
      expect(ContextWindowMeter._colorClass(0.59)).toBe('context-meter__fill--green');
    });

    test('returns yellow for ratio 0.60-0.79', () => {
      expect(ContextWindowMeter._colorClass(0.60)).toBe('context-meter__fill--yellow');
      expect(ContextWindowMeter._colorClass(0.70)).toBe('context-meter__fill--yellow');
      expect(ContextWindowMeter._colorClass(0.79)).toBe('context-meter__fill--yellow');
    });

    test('returns red for ratio >= 0.80', () => {
      expect(ContextWindowMeter._colorClass(0.80)).toBe('context-meter__fill--red');
      expect(ContextWindowMeter._colorClass(0.95)).toBe('context-meter__fill--red');
      expect(ContextWindowMeter._colorClass(1.0)).toBe('context-meter__fill--red');
    });
  });

  // ── _fmtK ──────────────────────────────────────────────────────
  describe('_fmtK', () => {
    test('formats small numbers without suffix', () => {
      expect(ContextWindowMeter._fmtK(0)).toBe('0');
      expect(ContextWindowMeter._fmtK(500)).toBe('500');
      expect(ContextWindowMeter._fmtK(999)).toBe('999');
    });

    test('formats thousands with k suffix', () => {
      expect(ContextWindowMeter._fmtK(1000)).toBe('1.0k');
      expect(ContextWindowMeter._fmtK(2500)).toBe('2.5k');
      expect(ContextWindowMeter._fmtK(100000)).toBe('100.0k');
    });
  });

  // ── Thresholds ──────────────────────────────────────────────────
  describe('thresholds', () => {
    test('YELLOW_THRESHOLD is 0.60', () => {
      expect(ContextWindowMeter.YELLOW_THRESHOLD).toBe(0.60);
    });

    test('RED_THRESHOLD is 0.80', () => {
      expect(ContextWindowMeter.RED_THRESHOLD).toBe(0.80);
    });
  });

  // ── init ────────────────────────────────────────────────────────
  describe('init', () => {
    test('initializes without errors', () => {
      expect(() => ContextWindowMeter.init()).not.toThrow();
    });

    test('meter starts hidden when conversation is empty', () => {
      ContextWindowMeter.init();
      const container = document.getElementById('context-meter');
      expect(container.classList.contains('context-meter--hidden')).toBe(true);
    });
  });

  // ── refresh ─────────────────────────────────────────────────────
  describe('refresh', () => {
    test('updates fill width based on token usage', () => {
      // Add some messages to generate token count
      ConversationManager.addMessage('user', 'Hello world! '.repeat(100));
      ConversationManager.addMessage('assistant', 'Response text. '.repeat(100));
      ContextWindowMeter.refresh();

      const fill = document.getElementById('context-meter-fill');
      expect(fill.style.width).not.toBe('0%');
    });

    test('shows green color for low usage', () => {
      // Small message — well below 60%
      ConversationManager.addMessage('user', 'Hi');
      ContextWindowMeter.refresh();

      const fill = document.getElementById('context-meter-fill');
      expect(fill.className).toContain('context-meter__fill--green');
    });

    test('updates label with token count', () => {
      ConversationManager.addMessage('user', 'test message');
      ContextWindowMeter.refresh();

      const label = document.getElementById('context-meter-label');
      expect(label.textContent).toMatch(/tokens/);
      expect(label.textContent).toMatch(/\d+/);
      expect(label.textContent).toMatch(/%/);
    });

    test('updates ARIA valuenow', () => {
      ConversationManager.addMessage('user', 'test');
      ContextWindowMeter.refresh();

      const container = document.getElementById('context-meter');
      const val = parseInt(container.getAttribute('aria-valuenow'));
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(100);
    });

    test('makes meter visible when conversation has messages', () => {
      ContextWindowMeter.init(); // starts hidden
      const container = document.getElementById('context-meter');
      expect(container.classList.contains('context-meter--hidden')).toBe(true);

      ConversationManager.addMessage('user', 'Hello');
      ContextWindowMeter.refresh();
      expect(container.classList.contains('context-meter--hidden')).toBe(false);
    });

    test('hides meter when conversation is cleared', () => {
      ConversationManager.addMessage('user', 'Hello');
      ContextWindowMeter.refresh();
      const container = document.getElementById('context-meter');
      expect(container.classList.contains('context-meter--hidden')).toBe(false);

      ConversationManager.clear();
      ContextWindowMeter.refresh();
      expect(container.classList.contains('context-meter--hidden')).toBe(true);
    });

    test('handles missing DOM elements gracefully', () => {
      // Remove the meter from DOM
      const meter = document.getElementById('context-meter');
      if (meter) meter.remove();
      expect(() => ContextWindowMeter.refresh()).not.toThrow();
    });
  });

  // ── toggle ──────────────────────────────────────────────────────
  describe('toggle', () => {
    test('hides the meter on first toggle', () => {
      const visible = ContextWindowMeter.toggle();
      expect(visible).toBe(false);
      const container = document.getElementById('context-meter');
      expect(container.style.display).toBe('none');
    });

    test('shows the meter on second toggle', () => {
      ContextWindowMeter.toggle(); // hide
      const visible = ContextWindowMeter.toggle(); // show
      expect(visible).toBe(true);
      const container = document.getElementById('context-meter');
      expect(container.style.display).toBe('');
    });

    test('persists visibility preference', () => {
      ContextWindowMeter.toggle(); // hide
      expect(localStorage.getItem('ac-context-meter-visible')).toBe('false');
    });
  });

  // ── destroy ─────────────────────────────────────────────────────
  describe('destroy', () => {
    test('disconnects observer without errors', () => {
      ContextWindowMeter.init();
      expect(() => ContextWindowMeter.destroy()).not.toThrow();
    });

    test('can be called multiple times safely', () => {
      ContextWindowMeter.init();
      ContextWindowMeter.destroy();
      expect(() => ContextWindowMeter.destroy()).not.toThrow();
    });
  });

  // ── Integration ─────────────────────────────────────────────────
  describe('integration', () => {
    test('percentage increases as messages accumulate', () => {
      ContextWindowMeter.init();
      ConversationManager.addMessage('user', 'First message');
      ContextWindowMeter.refresh();
      const pct1 = parseInt(document.getElementById('context-meter').getAttribute('aria-valuenow'));

      ConversationManager.addMessage('assistant', 'A much longer response with lots of detail. '.repeat(50));
      ContextWindowMeter.refresh();
      const pct2 = parseInt(document.getElementById('context-meter').getAttribute('aria-valuenow'));

      expect(pct2).toBeGreaterThan(pct1);
    });

    test('label format matches expected pattern', () => {
      ConversationManager.addMessage('user', 'x'.repeat(4000));
      ContextWindowMeter.refresh();
      const label = document.getElementById('context-meter-label');
      // Should be something like "1.0k / 100.0k tokens (1%)"
      expect(label.textContent).toMatch(/^\d[\d.]*k?\s*\/\s*\d[\d.]*k?\s*tokens\s*\(\d+%\)$/);
    });
  });
});
