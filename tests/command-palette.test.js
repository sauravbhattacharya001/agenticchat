/**
 * @jest-environment jsdom
 */
const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');

// Polyfill scrollIntoView for jsdom
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || function() {};

// Mock SafeStorage globally
global.SafeStorage = {
  _data: {},
  getItem(k) { return this._data[k] || null; },
  setItem(k, v) { this._data[k] = v; },
  removeItem(k) { delete this._data[k]; },
  clear() { this._data = {}; }
};

// Inline CommandPalette module (extracted from app.js)
function createCommandPalette() {
  const _commands = [];
  let _overlay = null;
  let _input = null;
  let _list = null;
  let _filtered = [];
  let _selectedIndex = 0;
  let _isOpen = false;
  let _recentIds = [];
  const MAX_RECENT = 10;

  function register(cmd) {
    if (!cmd || !cmd.id || !cmd.label || typeof cmd.action !== 'function') return;
    const idx = _commands.findIndex(c => c.id === cmd.id);
    if (idx !== -1) { _commands[idx] = cmd; return; }
    _commands.push(cmd);
  }

  function registerMany(cmds) {
    if (!Array.isArray(cmds)) return;
    cmds.forEach(register);
  }

  function unregister(id) {
    const idx = _commands.findIndex(c => c.id === id);
    if (idx !== -1) _commands.splice(idx, 1);
  }

  function _fuzzyMatch(query, text) {
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    let qi = 0;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
      if (t[ti] === q[qi]) qi++;
    }
    return qi === q.length;
  }

  function _fuzzyScore(query, text) {
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    if (t.startsWith(q)) return 0;
    if (t.includes(q)) return 1;
    return 2;
  }

  function _loadRecent() {
    try {
      const raw = SafeStorage.getItem('cp_recent');
      if (raw) _recentIds = JSON.parse(raw);
    } catch (e) { _recentIds = []; }
  }

  function _saveRecent() {
    try {
      SafeStorage.setItem('cp_recent', JSON.stringify(_recentIds));
    } catch (e) { /* ignore */ }
  }

  function _addRecent(id) {
    _recentIds = _recentIds.filter(r => r !== id);
    _recentIds.unshift(id);
    if (_recentIds.length > MAX_RECENT) _recentIds.length = MAX_RECENT;
    _saveRecent();
  }

  function _filter(query) {
    if (!query) {
      const recent = _recentIds
        .map(id => _commands.find(c => c.id === id))
        .filter(Boolean)
        .map(c => ({ ...c, _recent: true }));
      const recentIds = new Set(_recentIds);
      const rest = _commands.filter(c => !recentIds.has(c.id));
      _filtered = [...recent, ...rest];
    } else {
      const searchText = (c) => `${c.category || ''} ${c.label}`;
      _filtered = _commands
        .filter(c => _fuzzyMatch(query, searchText(c)))
        .sort((a, b) => _fuzzyScore(query, searchText(a)) - _fuzzyScore(query, searchText(b)));
    }
    _selectedIndex = 0;
  }

  function _highlightMatch(text, query) {
    if (!query) return text;
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    let result = '';
    let qi = 0;
    for (let i = 0; i < text.length; i++) {
      if (qi < q.length && t[i] === q[qi]) {
        result += '<b>' + text[i] + '</b>';
        qi++;
      } else {
        result += text[i];
      }
    }
    return result;
  }

  function _render() {
    if (!_list) return;
    const query = _input ? _input.value : '';
    _list.innerHTML = '';
    if (_filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cp-empty';
      empty.textContent = 'No matching commands';
      _list.appendChild(empty);
      return;
    }
    let lastCategory = null;
    _filtered.forEach((cmd, i) => {
      const cat = cmd._recent ? 'Recent' : (cmd.category || 'General');
      if (cat !== lastCategory && !query) {
        const header = document.createElement('div');
        header.className = 'cp-category';
        header.textContent = cat;
        _list.appendChild(header);
        lastCategory = cat;
      }
      const item = document.createElement('div');
      item.className = 'cp-item' + (i === _selectedIndex ? ' cp-selected' : '');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', i === _selectedIndex ? 'true' : 'false');

      const icon = cmd.icon ? '<span class="cp-icon">' + cmd.icon + '</span>' : '';
      const label = _highlightMatch(cmd.label, query);
      const shortcut = cmd.shortcut ? '<span class="cp-shortcut">' + cmd.shortcut + '</span>' : '';
      item.innerHTML = icon + '<span class="cp-label">' + label + '</span>' + shortcut;

      item.addEventListener('click', () => _execute(i));
      item.addEventListener('mouseenter', () => {
        _selectedIndex = i;
        _render();
      });
      _list.appendChild(item);
    });
    const selected = _list.querySelector('.cp-selected');
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }

  function _execute(index) {
    const cmd = _filtered[index];
    if (!cmd) return;
    _addRecent(cmd.id);
    close();
    try { cmd.action(); } catch (e) { /* ignore */ }
  }

  function _createUI() {
    if (_overlay) return;
    _overlay = document.createElement('div');
    _overlay.id = 'command-palette-overlay';
    _overlay.className = 'cp-overlay';
    _overlay.setAttribute('role', 'dialog');
    _overlay.setAttribute('aria-label', 'Command Palette');
    _overlay.innerHTML =
      '<div class="cp-dialog">' +
        '<input class="cp-input" type="text" placeholder="Type a command…" aria-label="Search commands" autocomplete="off" />' +
        '<div class="cp-list" role="listbox"></div>' +
      '</div>';
    document.body.appendChild(_overlay);
    _input = _overlay.querySelector('.cp-input');
    _list = _overlay.querySelector('.cp-list');

    _input.addEventListener('input', () => {
      _filter(_input.value.trim());
      _render();
    });

    _input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        _selectedIndex = Math.min(_selectedIndex + 1, _filtered.length - 1);
        _render();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _selectedIndex = Math.max(_selectedIndex - 1, 0);
        _render();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        _execute(_selectedIndex);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });

    _overlay.addEventListener('click', (e) => {
      if (e.target === _overlay) close();
    });
  }

  function open() {
    _createUI();
    _loadRecent();
    _overlay.classList.add('cp-visible');
    _isOpen = true;
    _input.value = '';
    _filter('');
    _render();
    _input.focus();
  }

  function close() {
    if (_overlay) _overlay.classList.remove('cp-visible');
    _isOpen = false;
  }

  function toggle() { _isOpen ? close() : open(); }
  function getCommands() { return _commands.slice(); }
  function getFiltered() { return _filtered.slice(); }
  function isOpen() { return _isOpen; }

  function _registerBuiltInCommands() {
    registerMany([
      { id: 'cp:theme', label: 'Toggle Theme (Dark/Light)', icon: '☀️', shortcut: 'Ctrl+D', category: 'Appearance', action: () => {} },
      { id: 'cp:zen', label: 'Toggle Focus Mode', icon: '🧘', shortcut: 'Ctrl+Shift+F', category: 'Appearance', action: () => {} },
      { id: 'cp:new-session', label: 'New Session', icon: '➕', category: 'Sessions', action: () => {} },
      { id: 'cp:switch-session', label: 'Quick Switch Session', icon: '⚡', shortcut: 'Ctrl+K', category: 'Sessions', action: () => {} },
      { id: 'cp:search', label: 'Search Messages', icon: '🔍', shortcut: 'Ctrl+F', category: 'Search', action: () => {} },
      { id: 'cp:global-search', label: 'Search All Sessions', icon: '🔎', shortcut: 'Ctrl+Shift+S', category: 'Search', action: () => {} },
      { id: 'cp:history', label: 'Conversation History', icon: '📜', shortcut: 'Ctrl+H', category: 'Navigation', action: () => {} },
      { id: 'cp:bookmarks', label: 'View Bookmarks', icon: '🔖', shortcut: 'Ctrl+B', category: 'Navigation', action: () => {} },
      { id: 'cp:stats', label: 'Chat Statistics', icon: '📊', shortcut: 'Ctrl+I', category: 'Analytics', action: () => {} },
      { id: 'cp:cost', label: 'Cost Dashboard', icon: '💰', category: 'Analytics', action: () => {} },
      { id: 'cp:heatmap', label: 'Usage Heatmap', icon: '🗓️', category: 'Analytics', action: () => {} },
      { id: 'cp:summary', label: 'Conversation Summary', icon: '📋', shortcut: 'Alt+S', category: 'Tools', action: () => {} },
      { id: 'cp:scratchpad', label: 'Open Scratchpad', icon: '📝', shortcut: 'Ctrl+.', category: 'Tools', action: () => {} },
      { id: 'cp:snippets', label: 'Snippet Library', icon: '✂️', shortcut: 'Ctrl+Shift+L', category: 'Tools', action: () => {} },
      { id: 'cp:prompt-library', label: 'Prompt Library', icon: '📚', shortcut: 'Ctrl+L', category: 'Tools', action: () => {} },
      { id: 'cp:templates', label: 'Prompt Templates', icon: '📄', category: 'Tools', action: () => {} },
      { id: 'cp:chains', label: 'Prompt Chains', icon: '⛓️', category: 'Tools', action: () => {} },
      { id: 'cp:agenda', label: 'Conversation Agenda', icon: '🎯', shortcut: 'Alt+G', category: 'Tools', action: () => {} },
      { id: 'cp:chapters', label: 'Conversation Chapters', icon: '📑', shortcut: 'Alt+Shift+C', category: 'Tools', action: () => {} },
      { id: 'cp:annotations', label: 'Message Annotations', icon: '🏷️', category: 'Tools', action: () => {} },
      { id: 'cp:tags', label: 'Manage Tags', icon: '🏷️', category: 'Sessions', action: () => {} },
      { id: 'cp:wordcloud', label: 'Word Cloud', icon: '☁️', shortcut: 'Ctrl+Shift+W', category: 'Visualization', action: () => {} },
      { id: 'cp:mindmap', label: 'Mind Map', icon: '🧠', shortcut: 'Ctrl+Shift+G', category: 'Visualization', action: () => {} },
      { id: 'cp:timeline', label: 'Conversation Timeline', icon: '📈', category: 'Visualization', action: () => {} },
      { id: 'cp:sentiment', label: 'Sentiment Analysis', icon: '😊', shortcut: 'Ctrl+Shift+M', category: 'Analytics', action: () => {} },
      { id: 'cp:health', label: 'Conversation Health Check', icon: '🩺', shortcut: 'Ctrl+Shift+H', category: 'Analytics', action: () => {} },
      { id: 'cp:typing', label: 'Typing Speed Dashboard', icon: '⌨️', shortcut: 'Ctrl+Shift+T', category: 'Analytics', action: () => {} },
      { id: 'cp:pomodoro', label: 'Focus Timer (Pomodoro)', icon: '🍅', shortcut: 'Alt+P', category: 'Tools', action: () => {} },
      { id: 'cp:ratings', label: 'Response Ratings', icon: '⭐', category: 'Analytics', action: () => {} },
      { id: 'cp:clipboard', label: 'Clipboard History', icon: '📋', shortcut: 'Ctrl+Shift+V', category: 'Tools', action: () => {} },
      { id: 'cp:readaloud', label: 'Read Aloud', icon: '🔊', category: 'Tools', action: () => {} },
      { id: 'cp:replay', label: 'Conversation Replay', icon: '▶️', category: 'Tools', action: () => {} },
      { id: 'cp:import-chatgpt', label: 'Import ChatGPT Conversations', icon: '📥', category: 'Import/Export', action: () => {} },
      { id: 'cp:filter', label: 'Message Filters', icon: '🔽', category: 'Search', action: () => {} },
      { id: 'cp:clear', label: 'Clear Conversation', icon: '🗑️', category: 'Sessions', action: () => {} },
      { id: 'cp:shortcuts', label: 'Keyboard Shortcuts', icon: '⌨️', shortcut: '?', category: 'Help', action: () => {} },
    ]);
  }

  function init() {
    _registerBuiltInCommands();
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        toggle();
      }
    });
  }

  return { register, registerMany, unregister, open, close, toggle, getCommands, getFiltered, isOpen, init };
}

let CP;

beforeEach(() => {
  document.body.innerHTML = '<button id="command-palette-btn"></button>';
  SafeStorage.clear();
  CP = createCommandPalette();
  CP.init();
});

afterEach(() => {
  const overlay = document.getElementById('command-palette-overlay');
  if (overlay) overlay.remove();
});

describe('CommandPalette', () => {
  test('is defined', () => {
    expect(CP).toBeDefined();
  });

  test('has expected API methods', () => {
    expect(typeof CP.register).toBe('function');
    expect(typeof CP.registerMany).toBe('function');
    expect(typeof CP.unregister).toBe('function');
    expect(typeof CP.open).toBe('function');
    expect(typeof CP.close).toBe('function');
    expect(typeof CP.toggle).toBe('function');
    expect(typeof CP.getCommands).toBe('function');
    expect(typeof CP.getFiltered).toBe('function');
    expect(typeof CP.isOpen).toBe('function');
  });

  test('registers built-in commands on init', () => {
    expect(CP.getCommands().length).toBeGreaterThan(20);
  });

  test('register adds a custom command', () => {
    const before = CP.getCommands().length;
    CP.register({ id: 'test:hello', label: 'Say Hello', action: () => {} });
    expect(CP.getCommands().length).toBe(before + 1);
  });

  test('register rejects invalid commands', () => {
    const before = CP.getCommands().length;
    CP.register(null);
    CP.register({ id: 'x' });
    CP.register({ id: 'x', label: 'X' });
    expect(CP.getCommands().length).toBe(before);
  });

  test('register replaces duplicate id', () => {
    CP.register({ id: 'test:dup', label: 'V1', action: () => {} });
    const count = CP.getCommands().length;
    CP.register({ id: 'test:dup', label: 'V2', action: () => {} });
    expect(CP.getCommands().length).toBe(count);
    expect(CP.getCommands().find(c => c.id === 'test:dup').label).toBe('V2');
  });

  test('registerMany adds multiple commands', () => {
    const before = CP.getCommands().length;
    CP.registerMany([
      { id: 'test:a', label: 'A', action: () => {} },
      { id: 'test:b', label: 'B', action: () => {} },
    ]);
    expect(CP.getCommands().length).toBe(before + 2);
  });

  test('registerMany handles non-array gracefully', () => {
    expect(() => CP.registerMany('not array')).not.toThrow();
  });

  test('unregister removes a command', () => {
    CP.register({ id: 'test:remove', label: 'Remove Me', action: () => {} });
    const before = CP.getCommands().length;
    CP.unregister('test:remove');
    expect(CP.getCommands().length).toBe(before - 1);
  });

  test('unregister does nothing for unknown id', () => {
    const before = CP.getCommands().length;
    CP.unregister('nonexistent');
    expect(CP.getCommands().length).toBe(before);
  });

  test('open creates overlay and shows it', () => {
    CP.open();
    const overlay = document.getElementById('command-palette-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.classList.contains('cp-visible')).toBe(true);
    expect(CP.isOpen()).toBe(true);
  });

  test('close hides the overlay', () => {
    CP.open();
    CP.close();
    expect(CP.isOpen()).toBe(false);
  });

  test('toggle switches open/close state', () => {
    expect(CP.isOpen()).toBe(false);
    CP.toggle();
    expect(CP.isOpen()).toBe(true);
    CP.toggle();
    expect(CP.isOpen()).toBe(false);
  });

  test('getFiltered returns all commands when open with empty query', () => {
    CP.open();
    const filtered = CP.getFiltered();
    expect(filtered.length).toBe(CP.getCommands().length);
  });

  test('built-in commands have required fields', () => {
    CP.getCommands().forEach(cmd => {
      expect(cmd.id).toBeTruthy();
      expect(cmd.label).toBeTruthy();
      expect(typeof cmd.action).toBe('function');
    });
  });

  test('built-in commands include expected categories', () => {
    const categories = new Set(CP.getCommands().map(c => c.category).filter(Boolean));
    expect(categories.has('Appearance')).toBe(true);
    expect(categories.has('Sessions')).toBe(true);
    expect(categories.has('Tools')).toBe(true);
    expect(categories.has('Analytics')).toBe(true);
  });

  test('Ctrl+Shift+P keydown triggers toggle', () => {
    expect(CP.isOpen()).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true }));
    expect(CP.isOpen()).toBe(true);
  });

  test('overlay renders list items', () => {
    CP.open();
    const items = document.querySelectorAll('.cp-item');
    expect(items.length).toBeGreaterThan(0);
  });

  test('overlay renders category headers', () => {
    CP.open();
    const headers = document.querySelectorAll('.cp-category');
    expect(headers.length).toBeGreaterThan(0);
  });

  test('clicking overlay backdrop closes palette', () => {
    CP.open();
    const overlay = document.getElementById('command-palette-overlay');
    overlay.click();
    expect(CP.isOpen()).toBe(false);
  });

  test('command with shortcut displays shortcut badge', () => {
    CP.open();
    const shortcuts = document.querySelectorAll('.cp-shortcut');
    expect(shortcuts.length).toBeGreaterThan(0);
  });

  test('fuzzy filtering narrows results', () => {
    CP.open();
    const input = document.querySelector('.cp-input');
    input.value = 'theme';
    input.dispatchEvent(new Event('input'));
    const filtered = CP.getFiltered();
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.length).toBeLessThan(CP.getCommands().length);
    expect(filtered[0].label).toContain('Theme');
  });

  test('executing a command adds it to recent', () => {
    CP.open();
    // Click the first item
    const firstItem = document.querySelector('.cp-item');
    firstItem.click();
    expect(CP.isOpen()).toBe(false);
    // Reopen — recent should appear
    CP.open();
    const filtered = CP.getFiltered();
    expect(filtered[0]._recent).toBe(true);
  });

  test('ArrowDown/ArrowUp navigation changes selection', () => {
    CP.open();
    const input = document.querySelector('.cp-input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const items = document.querySelectorAll('.cp-item');
    expect(items[1].classList.contains('cp-selected')).toBe(true);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    const items2 = document.querySelectorAll('.cp-item');
    expect(items2[0].classList.contains('cp-selected')).toBe(true);
  });

  test('Escape key closes palette', () => {
    CP.open();
    const input = document.querySelector('.cp-input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(CP.isOpen()).toBe(false);
  });

  test('Enter key executes selected command', () => {
    let executed = false;
    CP.register({ id: 'test:exec', label: 'Execute Me', action: () => { executed = true; } });
    CP.open();
    // Type to filter to our command
    const input = document.querySelector('.cp-input');
    input.value = 'Execute Me';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(executed).toBe(true);
    expect(CP.isOpen()).toBe(false);
  });

  test('empty search shows "No matching commands"', () => {
    CP.open();
    const input = document.querySelector('.cp-input');
    input.value = 'xyznonexistent12345';
    input.dispatchEvent(new Event('input'));
    const empty = document.querySelector('.cp-empty');
    expect(empty).not.toBeNull();
    expect(empty.textContent).toBe('No matching commands');
  });
});
