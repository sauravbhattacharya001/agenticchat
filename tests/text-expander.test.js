/**
 * @jest-environment jsdom
 */
const { describe, test, expect, beforeEach } = require('@jest/globals');

// Mock SafeStorage
let safeSt = {};
global.SafeStorage = {
  get(k) { return safeSt[k] ?? null; },
  set(k, v) { safeSt[k] = v; },
  remove(k) { delete safeSt[k]; },
  isAvailable() { return true; },
  length: 0,
  key() { return null; }
};
global.UIController = { setChatOutput: jest.fn() };

// Inline TextExpander module
function createTextExpander() {
  const STORAGE_KEY = 'agenticchat_text_expander';
  const USAGE_KEY = 'agenticchat_text_expander_usage';
  let _overlay = null;
  let _panel = null;
  let _visible = false;

  const BUILTINS = {
    '/date': () => new Date().toLocaleDateString(),
    '/time': () => new Date().toLocaleTimeString(),
    '/now':  () => new Date().toLocaleString(),
    '/shrug': () => '¯\\_(ツ)_/¯',
    '/tableflip': () => '(╯°□°)╯︵ ┻━┻',
    '/lenny': () => '( ͡° ͜ʖ ͡°)',
  };

  function _load() {
    try { const raw = SafeStorage.get(STORAGE_KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
  }
  function _save(snippets) {
    try { SafeStorage.set(STORAGE_KEY, JSON.stringify(snippets)); } catch {}
  }
  function _loadUsage() {
    try { const raw = SafeStorage.get(USAGE_KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
  }
  function _saveUsage(usage) {
    try { SafeStorage.set(USAGE_KEY, JSON.stringify(usage)); } catch {}
  }
  function _trackUsage(trigger) {
    const usage = _loadUsage();
    usage[trigger] = (usage[trigger] || 0) + 1;
    _saveUsage(usage);
  }

  function getExpansion(trigger) {
    if (BUILTINS[trigger]) return BUILTINS[trigger]();
    const snippets = _load();
    return snippets[trigger] || null;
  }

  function getAllTriggers() {
    const snippets = _load();
    return [...new Set([...Object.keys(snippets), ...Object.keys(BUILTINS)])];
  }

  function set(trigger, expansion) {
    if (!trigger || !expansion) return false;
    const t = trigger.startsWith('/') ? trigger : '/' + trigger;
    if (BUILTINS[t]) return false;
    const snippets = _load();
    snippets[t] = expansion;
    _save(snippets);
    return true;
  }

  function remove(trigger) {
    const snippets = _load();
    if (!snippets[trigger]) return false;
    delete snippets[trigger];
    _save(snippets);
    return true;
  }

  function getUserSnippets() { return _load(); }
  function getUsage() { return _loadUsage(); }
  function clearUsage() { _saveUsage({}); }
  function clearAll() { _save({}); }

  function exportJSON() { return JSON.stringify(_load(), null, 2); }

  function importJSON(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);
      if (typeof data !== 'object' || Array.isArray(data)) return 0;
      const snippets = _load();
      let count = 0;
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === 'string' && v.trim()) {
          const t = k.startsWith('/') ? k : '/' + k;
          if (!BUILTINS[t]) { snippets[t] = v; count++; }
        }
      }
      _save(snippets);
      return count;
    } catch { return 0; }
  }

  function _handleInput(e) {
    if (e.key !== ' ' && e.key !== 'Tab') return;
    const input = e.target;
    if (input.id !== 'chat-input') return;
    const cursorPos = input.selectionStart;
    const text = input.value.substring(0, cursorPos);
    const match = text.match(/(\/\S+)$/);
    if (!match) return;
    const trigger = match[1];
    const expansion = getExpansion(trigger);
    if (!expansion) return;
    e.preventDefault();
    const before = text.substring(0, text.length - trigger.length);
    const after = input.value.substring(cursorPos);
    const suffix = e.key === ' ' ? ' ' : '';
    input.value = before + expansion + suffix + after;
    const newPos = before.length + expansion.length + suffix.length;
    input.selectionStart = input.selectionEnd = newPos;
    _trackUsage(trigger);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function _createOverlay() {
    _overlay = document.createElement('div');
    _overlay.className = 'te-overlay';
    _overlay.addEventListener('click', (e) => { if (e.target === _overlay) close(); });
    _panel = document.createElement('div');
    _panel.className = 'te-panel';
    _overlay.appendChild(_panel);
    document.body.appendChild(_overlay);
  }

  function toggle() { _visible ? close() : open(); }

  function open() {
    if (!_overlay) _createOverlay();
    _panel.innerHTML = '<div class="te-header"><h3>⚡ Text Expander</h3></div>';
    _overlay.classList.add('te-visible');
    _visible = true;
  }

  function close() {
    if (_overlay) _overlay.classList.remove('te-visible');
    _visible = false;
  }

  function init() {
    document.addEventListener('keydown', _handleInput, true);
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'X') { e.preventDefault(); toggle(); }
    });
  }

  return {
    init, toggle, open, close,
    getExpansion, getAllTriggers,
    set, remove, getUserSnippets,
    getUsage, clearUsage,
    exportJSON, importJSON, clearAll,
    BUILTINS, _trackUsage, _handleInput
  };
}

let TE;
beforeEach(() => {
  safeSt = {};
  document.body.innerHTML = '<textarea id="chat-input"></textarea>';
  TE = createTextExpander();
});

describe('TextExpander', () => {
  test('set and get user snippet', () => {
    expect(TE.set('/greet', 'Hello, world!')).toBe(true);
    expect(TE.getExpansion('/greet')).toBe('Hello, world!');
  });

  test('auto-prefixes slash if missing', () => {
    TE.set('hi', 'Hey there');
    expect(TE.getExpansion('/hi')).toBe('Hey there');
  });

  test('cannot override builtin triggers', () => {
    expect(TE.set('/date', 'custom')).toBe(false);
    expect(TE.set('/shrug', 'nope')).toBe(false);
  });

  test('remove user snippet', () => {
    TE.set('/bye', 'Goodbye');
    expect(TE.remove('/bye')).toBe(true);
    expect(TE.getExpansion('/bye')).toBeNull();
  });

  test('remove nonexistent returns false', () => {
    expect(TE.remove('/nope')).toBe(false);
  });

  test('set rejects empty trigger or expansion', () => {
    expect(TE.set('', 'test')).toBe(false);
    expect(TE.set('/x', '')).toBe(false);
  });

  test('getUserSnippets returns only user snippets', () => {
    TE.set('/a', 'alpha');
    TE.set('/b', 'beta');
    const s = TE.getUserSnippets();
    expect(s['/a']).toBe('alpha');
    expect(s['/b']).toBe('beta');
    expect(s['/date']).toBeUndefined();
  });

  test('clearAll removes all user snippets', () => {
    TE.set('/a', 'alpha');
    TE.clearAll();
    expect(Object.keys(TE.getUserSnippets()).length).toBe(0);
  });

  test('builtin /date returns date string', () => {
    const result = TE.getExpansion('/date');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('builtin /time returns time string', () => {
    expect(typeof TE.getExpansion('/time')).toBe('string');
  });

  test('builtin /now returns datetime string', () => {
    expect(typeof TE.getExpansion('/now')).toBe('string');
  });

  test('builtin /shrug returns kaomoji', () => {
    expect(TE.getExpansion('/shrug')).toBe('¯\\_(ツ)_/¯');
  });

  test('builtin /tableflip returns kaomoji', () => {
    expect(TE.getExpansion('/tableflip')).toBe('(╯°□°)╯︵ ┻━┻');
  });

  test('builtin /lenny returns face', () => {
    expect(TE.getExpansion('/lenny')).toBe('( ͡° ͜ʖ ͡°)');
  });

  test('getAllTriggers includes builtins and user', () => {
    TE.set('/sig', 'My Signature');
    const triggers = TE.getAllTriggers();
    expect(triggers).toContain('/sig');
    expect(triggers).toContain('/date');
    expect(triggers).toContain('/shrug');
  });

  test('trackUsage increments counter', () => {
    TE._trackUsage('/foo');
    TE._trackUsage('/foo');
    TE._trackUsage('/bar');
    const usage = TE.getUsage();
    expect(usage['/foo']).toBe(2);
    expect(usage['/bar']).toBe(1);
  });

  test('clearUsage resets all counters', () => {
    TE._trackUsage('/x');
    TE.clearUsage();
    expect(Object.keys(TE.getUsage()).length).toBe(0);
  });

  test('exportJSON returns valid JSON of user snippets', () => {
    TE.set('/a', 'alpha');
    const parsed = JSON.parse(TE.exportJSON());
    expect(parsed['/a']).toBe('alpha');
  });

  test('importJSON adds snippets and returns count', () => {
    const count = TE.importJSON('{ "/x": "ex", "/y": "why" }');
    expect(count).toBe(2);
    expect(TE.getExpansion('/x')).toBe('ex');
    expect(TE.getExpansion('/y')).toBe('why');
  });

  test('importJSON skips builtins', () => {
    const count = TE.importJSON('{ "/date": "nope", "/z": "zed" }');
    expect(count).toBe(1);
  });

  test('importJSON handles invalid JSON', () => {
    expect(TE.importJSON('not json')).toBe(0);
  });

  test('importJSON handles array input', () => {
    expect(TE.importJSON('[1,2,3]')).toBe(0);
  });

  test('importJSON auto-prefixes slash', () => {
    TE.importJSON('{ "hello": "world" }');
    expect(TE.getExpansion('/hello')).toBe('world');
  });

  test('expands trigger on Space key', () => {
    TE.set('/sig', 'Best regards, User');
    const input = document.getElementById('chat-input');
    input.value = 'Hello /sig';
    input.selectionStart = input.selectionEnd = 10;
    const ev = new KeyboardEvent('keydown', { key: ' ', cancelable: true, bubbles: true });
    Object.defineProperty(ev, 'target', { value: input });
    TE._handleInput(ev);
    expect(input.value).toBe('Hello Best regards, User ');
  });

  test('expands trigger on Tab key', () => {
    TE.set('/em', 'test@example.com');
    const input = document.getElementById('chat-input');
    input.value = '/em';
    input.selectionStart = input.selectionEnd = 3;
    const ev = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true, bubbles: true });
    Object.defineProperty(ev, 'target', { value: input });
    TE._handleInput(ev);
    expect(input.value).toBe('test@example.com');
  });

  test('does not expand unknown trigger', () => {
    const input = document.getElementById('chat-input');
    input.value = '/unknown';
    input.selectionStart = input.selectionEnd = 8;
    const ev = new KeyboardEvent('keydown', { key: ' ', cancelable: true, bubbles: true });
    Object.defineProperty(ev, 'target', { value: input });
    TE._handleInput(ev);
    expect(input.value).toBe('/unknown');
  });

  test('does not expand on non-chat-input elements', () => {
    TE.set('/x', 'expanded');
    const other = document.createElement('textarea');
    other.id = 'other-input';
    other.value = '/x';
    other.selectionStart = other.selectionEnd = 2;
    document.body.appendChild(other);
    const ev = new KeyboardEvent('keydown', { key: ' ', cancelable: true, bubbles: true });
    Object.defineProperty(ev, 'target', { value: other });
    TE._handleInput(ev);
    expect(other.value).toBe('/x');
  });

  test('tracks usage on successful expansion', () => {
    TE.set('/t', 'test');
    const input = document.getElementById('chat-input');
    input.value = '/t';
    input.selectionStart = input.selectionEnd = 2;
    const ev = new KeyboardEvent('keydown', { key: ' ', cancelable: true, bubbles: true });
    Object.defineProperty(ev, 'target', { value: input });
    TE._handleInput(ev);
    expect(TE.getUsage()['/t']).toBe(1);
  });

  test('open creates overlay and panel', () => {
    TE.open();
    expect(document.querySelector('.te-overlay')).toBeTruthy();
    expect(document.querySelector('.te-panel')).toBeTruthy();
    expect(document.querySelector('.te-overlay').classList.contains('te-visible')).toBe(true);
  });

  test('close hides overlay', () => {
    TE.open();
    TE.close();
    expect(document.querySelector('.te-overlay').classList.contains('te-visible')).toBe(false);
  });

  test('toggle opens then closes', () => {
    TE.toggle();
    expect(document.querySelector('.te-overlay').classList.contains('te-visible')).toBe(true);
    TE.toggle();
    expect(document.querySelector('.te-overlay').classList.contains('te-visible')).toBe(false);
  });

  test('BUILTINS is exposed and has expected keys', () => {
    expect(TE.BUILTINS).toBeDefined();
    expect(typeof TE.BUILTINS['/date']).toBe('function');
    expect(typeof TE.BUILTINS['/shrug']).toBe('function');
  });

  test('getExpansion returns null for unknown', () => {
    expect(TE.getExpansion('/nope')).toBeNull();
  });

  test('set overwrites existing snippet', () => {
    TE.set('/a', 'first');
    TE.set('/a', 'second');
    expect(TE.getExpansion('/a')).toBe('second');
  });

  test('expansion preserves text after cursor', () => {
    TE.set('/name', 'Alice');
    const input = document.getElementById('chat-input');
    input.value = 'Hi /name how are you?';
    input.selectionStart = input.selectionEnd = 8;
    const ev = new KeyboardEvent('keydown', { key: ' ', cancelable: true, bubbles: true });
    Object.defineProperty(ev, 'target', { value: input });
    TE._handleInput(ev);
    expect(input.value).toBe('Hi Alice  how are you?');
  });
});
