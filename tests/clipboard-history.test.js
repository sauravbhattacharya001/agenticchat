/**
 * @jest-environment jsdom
 */
const { setupDOM, loadApp } = require('./setup');

beforeAll(() => { setupDOM(); loadApp(); });
beforeEach(() => {
  localStorage.clear();
  ClipboardHistory.clearAll();
});

describe('ClipboardHistory', () => {
  describe('API surface', () => {
    test('exposes expected public methods', () => {
      expect(typeof ClipboardHistory.init).toBe('function');
      expect(typeof ClipboardHistory.record).toBe('function');
      expect(typeof ClipboardHistory.getAll).toBe('function');
      expect(typeof ClipboardHistory.count).toBe('function');
      expect(typeof ClipboardHistory.remove).toBe('function');
      expect(typeof ClipboardHistory.clearAll).toBe('function');
      expect(typeof ClipboardHistory.toggle).toBe('function');
      expect(typeof ClipboardHistory.open).toBe('function');
      expect(typeof ClipboardHistory.close).toBe('function');
      expect(typeof ClipboardHistory.isOpen).toBe('function');
    });
  });

  describe('record()', () => {
    test('records a text snippet', () => {
      ClipboardHistory.record('hello world', 'message');
      expect(ClipboardHistory.count()).toBe(1);
      expect(ClipboardHistory.getAll()[0].text).toBe('hello world');
    });

    test('records source type', () => {
      ClipboardHistory.record('const x = 1;', 'code-block');
      expect(ClipboardHistory.getAll()[0].source).toBe('code-block');
    });

    test('defaults source to manual', () => {
      ClipboardHistory.record('some text');
      expect(ClipboardHistory.getAll()[0].source).toBe('manual');
    });

    test('trims whitespace', () => {
      ClipboardHistory.record('  hello  ');
      expect(ClipboardHistory.getAll()[0].text).toBe('hello');
    });

    test('ignores empty text', () => {
      ClipboardHistory.record('');
      ClipboardHistory.record(null);
      ClipboardHistory.record(undefined);
      ClipboardHistory.record('   ');
      expect(ClipboardHistory.count()).toBe(0);
    });

    test('deduplicates consecutive identical copies', () => {
      ClipboardHistory.record('same text');
      ClipboardHistory.record('same text');
      ClipboardHistory.record('same text');
      expect(ClipboardHistory.count()).toBe(1);
    });

    test('allows same text after different text', () => {
      ClipboardHistory.record('text A');
      ClipboardHistory.record('text B');
      ClipboardHistory.record('text A');
      expect(ClipboardHistory.count()).toBe(3);
    });

    test('newest entry is first', () => {
      ClipboardHistory.record('first');
      ClipboardHistory.record('second');
      const all = ClipboardHistory.getAll();
      expect(all[0].text).toBe('second');
      expect(all[1].text).toBe('first');
    });

    test('truncates text exceeding MAX_TEXT_LENGTH', () => {
      const longText = 'x'.repeat(ClipboardHistory.MAX_TEXT_LENGTH + 100);
      ClipboardHistory.record(longText);
      const stored = ClipboardHistory.getAll()[0].text;
      expect(stored.length).toBeLessThanOrEqual(ClipboardHistory.MAX_TEXT_LENGTH + 1);
      expect(stored.endsWith('…')).toBe(true);
    });

    test('enforces MAX_ENTRIES limit', () => {
      for (let i = 0; i < ClipboardHistory.MAX_ENTRIES + 10; i++) {
        ClipboardHistory.record(`entry ${i}`);
      }
      expect(ClipboardHistory.count()).toBe(ClipboardHistory.MAX_ENTRIES);
    });

    test('includes timestamp', () => {
      const before = Date.now();
      ClipboardHistory.record('timestamped');
      const after = Date.now();
      const entry = ClipboardHistory.getAll()[0];
      expect(entry.timestamp).toBeGreaterThanOrEqual(before);
      expect(entry.timestamp).toBeLessThanOrEqual(after);
    });

    test('ignores non-string types', () => {
      ClipboardHistory.record(42);
      ClipboardHistory.record({});
      ClipboardHistory.record([]);
      expect(ClipboardHistory.count()).toBe(0);
    });
  });

  describe('getAll()', () => {
    test('returns empty array initially', () => {
      expect(ClipboardHistory.getAll()).toEqual([]);
    });

    test('returns a copy (not the internal array)', () => {
      ClipboardHistory.record('test');
      const all = ClipboardHistory.getAll();
      all.push({ text: 'injected' });
      expect(ClipboardHistory.count()).toBe(1);
    });
  });

  describe('remove()', () => {
    test('removes entry by index', () => {
      ClipboardHistory.record('a');
      ClipboardHistory.record('b');
      ClipboardHistory.record('c');
      ClipboardHistory.remove(1); // Remove 'b' (index 1 of [c, b, a])
      expect(ClipboardHistory.count()).toBe(2);
      const texts = ClipboardHistory.getAll().map(e => e.text);
      expect(texts).not.toContain('b');
    });

    test('handles out-of-bounds gracefully', () => {
      ClipboardHistory.record('a');
      ClipboardHistory.remove(-1);
      ClipboardHistory.remove(99);
      expect(ClipboardHistory.count()).toBe(1);
    });
  });

  describe('clearAll()', () => {
    test('removes all entries', () => {
      ClipboardHistory.record('a');
      ClipboardHistory.record('b');
      ClipboardHistory.clearAll();
      expect(ClipboardHistory.count()).toBe(0);
      expect(ClipboardHistory.getAll()).toEqual([]);
    });
  });

  describe('persistence', () => {
    test('saves to localStorage on record', () => {
      ClipboardHistory.record('persisted');
      const stored = localStorage.getItem(ClipboardHistory.STORAGE_KEY);
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored);
      expect(parsed[0].text).toBe('persisted');
    });

    test('saves to localStorage on remove', () => {
      ClipboardHistory.record('a');
      ClipboardHistory.record('b');
      ClipboardHistory.remove(0);
      const parsed = JSON.parse(localStorage.getItem(ClipboardHistory.STORAGE_KEY));
      expect(parsed.length).toBe(1);
    });

    test('saves to localStorage on clearAll', () => {
      ClipboardHistory.record('a');
      ClipboardHistory.clearAll();
      const parsed = JSON.parse(localStorage.getItem(ClipboardHistory.STORAGE_KEY));
      expect(parsed).toEqual([]);
    });
  });

  describe('toggle/open/close', () => {
    test('isOpen returns false initially', () => {
      expect(ClipboardHistory.isOpen()).toBe(false);
    });

    test('toggle returns boolean state', () => {
      const result = ClipboardHistory.toggle();
      expect(typeof result).toBe('boolean');
    });

    test('open then close cycle', () => {
      ClipboardHistory.open();
      expect(ClipboardHistory.isOpen()).toBe(true);
      ClipboardHistory.close();
      expect(ClipboardHistory.isOpen()).toBe(false);
    });

    test('toggle flips state', () => {
      ClipboardHistory.toggle(); // open
      expect(ClipboardHistory.isOpen()).toBe(true);
      ClipboardHistory.toggle(); // close
      expect(ClipboardHistory.isOpen()).toBe(false);
    });
  });

  describe('constants', () => {
    test('STORAGE_KEY is defined', () => {
      expect(ClipboardHistory.STORAGE_KEY).toBe('ac_clipboard_history');
    });

    test('MAX_ENTRIES is reasonable', () => {
      expect(ClipboardHistory.MAX_ENTRIES).toBeGreaterThan(0);
      expect(ClipboardHistory.MAX_ENTRIES).toBeLessThanOrEqual(100);
    });

    test('MAX_TEXT_LENGTH is reasonable', () => {
      expect(ClipboardHistory.MAX_TEXT_LENGTH).toBeGreaterThan(100);
    });

    test('PREVIEW_LENGTH is reasonable', () => {
      expect(ClipboardHistory.PREVIEW_LENGTH).toBeGreaterThan(20);
      expect(ClipboardHistory.PREVIEW_LENGTH).toBeLessThan(ClipboardHistory.MAX_TEXT_LENGTH);
    });
  });

  describe('edge cases', () => {
    test('handles special characters in text', () => {
      ClipboardHistory.record('<script>alert("xss")</script>');
      expect(ClipboardHistory.count()).toBe(1);
      expect(ClipboardHistory.getAll()[0].text).toContain('<script>');
    });

    test('handles unicode text', () => {
      ClipboardHistory.record('こんにちは 🌍 مرحبا');
      expect(ClipboardHistory.count()).toBe(1);
      expect(ClipboardHistory.getAll()[0].text).toBe('こんにちは 🌍 مرحبا');
    });

    test('handles multiline text', () => {
      ClipboardHistory.record('line 1\nline 2\nline 3');
      expect(ClipboardHistory.count()).toBe(1);
      expect(ClipboardHistory.getAll()[0].text).toContain('\n');
    });

    test('preserves order after removal', () => {
      ClipboardHistory.record('first');
      ClipboardHistory.record('second');
      ClipboardHistory.record('third');
      ClipboardHistory.remove(1); // Remove 'second'
      const texts = ClipboardHistory.getAll().map(e => e.text);
      expect(texts).toEqual(['third', 'first']);
    });
  });
});
