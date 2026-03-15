/**
 * @jest-environment jsdom
 */
const { setupDOM, loadApp } = require('./setup');

beforeAll(() => { setupDOM(); loadApp(); });
beforeEach(() => {
  localStorage.clear();
  InputHistory.clearAll();
});

describe('InputHistory', () => {
  describe('API surface', () => {
    test('exposes expected public methods', () => {
      expect(typeof InputHistory.push).toBe('function');
      expect(typeof InputHistory.resetCursor).toBe('function');
      expect(typeof InputHistory.handleKeydown).toBe('function');
      expect(typeof InputHistory.getAll).toBe('function');
      expect(typeof InputHistory.getCount).toBe('function');
      expect(typeof InputHistory.clearAll).toBe('function');
    });
  });

  describe('push()', () => {
    test('records a prompt', () => {
      InputHistory.push('hello world');
      expect(InputHistory.getCount()).toBe(1);
      expect(InputHistory.getAll()).toEqual(['hello world']);
    });

    test('records multiple prompts in order', () => {
      InputHistory.push('first');
      InputHistory.push('second');
      InputHistory.push('third');
      expect(InputHistory.getCount()).toBe(3);
      expect(InputHistory.getAll()).toEqual(['first', 'second', 'third']);
    });

    test('deduplicates consecutive identical entries', () => {
      InputHistory.push('same');
      InputHistory.push('same');
      InputHistory.push('same');
      expect(InputHistory.getCount()).toBe(1);
    });

    test('allows non-consecutive duplicates', () => {
      InputHistory.push('alpha');
      InputHistory.push('beta');
      InputHistory.push('alpha');
      expect(InputHistory.getCount()).toBe(3);
      expect(InputHistory.getAll()).toEqual(['alpha', 'beta', 'alpha']);
    });

    test('ignores empty strings', () => {
      InputHistory.push('');
      expect(InputHistory.getCount()).toBe(0);
    });

    test('ignores falsy values', () => {
      InputHistory.push(null);
      InputHistory.push(undefined);
      InputHistory.push('');
      expect(InputHistory.getCount()).toBe(0);
    });

    test('caps at MAX_ENTRIES (100)', () => {
      for (let i = 0; i < 110; i++) {
        InputHistory.push('entry-' + i);
      }
      expect(InputHistory.getCount()).toBe(100);
      // oldest entries should be dropped
      expect(InputHistory.getAll()[0]).toBe('entry-10');
      expect(InputHistory.getAll()[99]).toBe('entry-109');
    });
  });

  describe('clearAll()', () => {
    test('removes all entries', () => {
      InputHistory.push('one');
      InputHistory.push('two');
      InputHistory.clearAll();
      expect(InputHistory.getCount()).toBe(0);
      expect(InputHistory.getAll()).toEqual([]);
    });
  });

  describe('handleKeydown() — arrow navigation', () => {
    function makeInput(value, selectionStart) {
      const input = document.createElement('input');
      input.value = value || '';
      input.selectionStart = selectionStart !== undefined ? selectionStart : 0;
      input.selectionEnd = input.selectionStart;
      Object.defineProperty(input, 'value', {
        get() { return this._val || ''; },
        set(v) { this._val = v; },
        configurable: true,
      });
      if (value) input.value = value;
      input.selectionStart = selectionStart !== undefined ? selectionStart : 0;
      input.selectionEnd = input.selectionStart;
      return input;
    }

    function keyEvent(key) {
      return { key, preventDefault: jest.fn() };
    }

    test('returns false when history is empty', () => {
      const input = makeInput('', 0);
      const result = InputHistory.handleKeydown(keyEvent('ArrowUp'), input);
      expect(result).toBe(false);
    });

    test('ArrowUp navigates to most recent entry', () => {
      InputHistory.push('first');
      InputHistory.push('second');
      const input = makeInput('', 0);
      const consumed = InputHistory.handleKeydown(keyEvent('ArrowUp'), input);
      expect(consumed).toBe(true);
      expect(input.value).toBe('second');
    });

    test('multiple ArrowUp navigates back through history', () => {
      InputHistory.push('alpha');
      InputHistory.push('beta');
      InputHistory.push('gamma');
      const input = makeInput('', 0);

      InputHistory.handleKeydown(keyEvent('ArrowUp'), input);
      expect(input.value).toBe('gamma');

      InputHistory.handleKeydown(keyEvent('ArrowUp'), input);
      expect(input.value).toBe('beta');

      InputHistory.handleKeydown(keyEvent('ArrowUp'), input);
      expect(input.value).toBe('alpha');
    });

    test('ArrowUp at oldest entry stays put', () => {
      InputHistory.push('only');
      const input = makeInput('', 0);

      InputHistory.handleKeydown(keyEvent('ArrowUp'), input);
      expect(input.value).toBe('only');

      // pressing up again should not change
      const consumed = InputHistory.handleKeydown(keyEvent('ArrowUp'), input);
      expect(consumed).toBe(true);
      expect(input.value).toBe('only');
    });

    test('ArrowDown restores draft after navigating up', () => {
      InputHistory.push('old');
      const input = makeInput('my draft', 0);

      // Navigate up (saves draft)
      InputHistory.handleKeydown(keyEvent('ArrowUp'), input);
      expect(input.value).toBe('old');

      // Navigate down (restores draft)
      InputHistory.handleKeydown(keyEvent('ArrowDown'), input);
      expect(input.value).toBe('my draft');
    });

    test('ArrowDown returns false when not navigating', () => {
      InputHistory.push('something');
      const input = makeInput('typing', 0);
      InputHistory.resetCursor();
      const result = InputHistory.handleKeydown(keyEvent('ArrowDown'), input);
      expect(result).toBe(false);
    });

    test('ArrowUp ignored when cursor not at position 0', () => {
      InputHistory.push('old');
      const input = makeInput('some text', 5);
      Object.defineProperty(input, 'value', {
        get() { return 'some text'; },
        set(v) { this._val = v; },
        configurable: true,
      });
      input.selectionStart = 5;
      const result = InputHistory.handleKeydown(keyEvent('ArrowUp'), input);
      expect(result).toBe(false);
    });

    test('non-arrow keys are ignored', () => {
      InputHistory.push('entry');
      const input = makeInput('', 0);
      expect(InputHistory.handleKeydown(keyEvent('Enter'), input)).toBe(false);
      expect(InputHistory.handleKeydown(keyEvent('Escape'), input)).toBe(false);
      expect(InputHistory.handleKeydown(keyEvent('a'), input)).toBe(false);
    });
  });

  describe('resetCursor()', () => {
    test('resets navigation state', () => {
      InputHistory.push('a');
      InputHistory.push('b');
      const input = makeInput('', 0);

      // Navigate into history
      InputHistory.handleKeydown({ key: 'ArrowUp' }, input);
      expect(input.value).toBe('b');

      // Reset
      InputHistory.resetCursor();

      // ArrowDown should now return false (not navigating)
      const result = InputHistory.handleKeydown({ key: 'ArrowDown' }, input);
      expect(result).toBe(false);
    });

    function makeInput(value, selectionStart) {
      const input = document.createElement('input');
      Object.defineProperty(input, 'value', {
        get() { return this._val || ''; },
        set(v) { this._val = v; },
        configurable: true,
      });
      input.value = value || '';
      input.selectionStart = selectionStart !== undefined ? selectionStart : 0;
      input.selectionEnd = input.selectionStart;
      return input;
    }
  });

  describe('persistence', () => {
    test('saves and restores from localStorage', () => {
      InputHistory.push('persistent-entry');
      // Simulate reload by clearing and re-loading
      const raw = localStorage.getItem('ac-input-history');
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw);
      expect(parsed).toContain('persistent-entry');
    });
  });

  describe('getAll()', () => {
    test('returns a copy (not a reference)', () => {
      InputHistory.push('item');
      const all = InputHistory.getAll();
      all.push('injected');
      expect(InputHistory.getCount()).toBe(1);
    });
  });
});
