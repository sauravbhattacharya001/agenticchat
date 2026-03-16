/**
 * @jest-environment jsdom
 */
const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');

// Polyfill scrollIntoView for jsdom
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || function() {};

// Mock SafeStorage
global.SafeStorage = {
  _data: {},
  get(k) { return this._data[k] || null; },
  set(k, v) { this._data[k] = v; },
  remove(k) { delete this._data[k]; },
  clear() { this._data = {}; }
};

// Mock SessionManager
global.SessionManager = {
  _sessions: [],
  getAll() { return this._sessions; }
};

// Inline SplitView module
function createSplitView() {
  const MAX_PREVIEW_CHARS = 300;
  let _overlay = null;
  let _isOpen = false;
  let _leftSession = null;
  let _rightSession = null;
  let _syncScroll = true;

  function _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function _truncate(text, max) {
    if (!text) return '';
    return text.length > max ? text.substring(0, max) + '…' : text;
  }

  function _getSessions() {
    if (typeof SessionManager === 'undefined') return [];
    try {
      const all = SessionManager.getAll();
      return Array.isArray(all) ? all : [];
    } catch { return []; }
  }

  function _createOverlay() {
    if (_overlay) { _overlay.remove(); }
    _overlay = document.createElement('div');
    _overlay.id = 'splitview-overlay';
    _overlay.className = 'modal-overlay splitview-overlay';
    _overlay.setAttribute('role', 'dialog');
    _overlay.setAttribute('aria-modal', 'true');
    _overlay.setAttribute('aria-label', 'Split View — Compare Sessions');

    const panel = document.createElement('div');
    panel.className = 'splitview-panel';

    const header = document.createElement('div');
    header.className = 'splitview-header';
    header.innerHTML = `
      <h3>📖 Split View — Compare Sessions</h3>
      <div class="splitview-controls">
        <label class="splitview-sync-label">
          <input type="checkbox" id="splitview-sync" ${_syncScroll ? 'checked' : ''}> Sync scroll
        </label>
        <button id="splitview-swap-btn" class="btn-sm">⇄ Swap</button>
        <button id="splitview-close-btn" class="btn-sm">✕</button>
      </div>
    `;
    panel.appendChild(header);

    const selectors = document.createElement('div');
    selectors.className = 'splitview-selectors';
    const sessions = _getSessions();
    const optionsHtml = sessions.map((s, i) => {
      const name = _escapeHtml(s.name || `Session ${i + 1}`);
      const count = Array.isArray(s.messages) ? s.messages.length : 0;
      return `<option value="${i}">${name} (${count} msgs)</option>`;
    }).join('');

    selectors.innerHTML = `
      <div class="splitview-selector">
        <label for="splitview-left-select">Left:</label>
        <select id="splitview-left-select">
          <option value="">— select session —</option>
          ${optionsHtml}
        </select>
      </div>
      <div class="splitview-selector">
        <label for="splitview-right-select">Right:</label>
        <select id="splitview-right-select">
          <option value="">— select session —</option>
          ${optionsHtml}
        </select>
      </div>
    `;
    panel.appendChild(selectors);

    const stats = document.createElement('div');
    stats.className = 'splitview-stats';
    stats.id = 'splitview-stats';
    panel.appendChild(stats);

    const panes = document.createElement('div');
    panes.className = 'splitview-panes';
    panes.innerHTML = `
      <div class="splitview-pane" id="splitview-left-pane">
        <div class="splitview-pane-empty">Select a session on the left</div>
      </div>
      <div class="splitview-divider"></div>
      <div class="splitview-pane" id="splitview-right-pane">
        <div class="splitview-pane-empty">Select a session on the right</div>
      </div>
    `;
    panel.appendChild(panes);

    _overlay.appendChild(panel);
    document.body.appendChild(_overlay);

    const closeBtn = _overlay.querySelector('#splitview-close-btn');
    closeBtn.addEventListener('click', close);

    const swapBtn = _overlay.querySelector('#splitview-swap-btn');
    swapBtn.addEventListener('click', _swap);

    const syncCheck = _overlay.querySelector('#splitview-sync');
    syncCheck.addEventListener('change', (e) => { _syncScroll = e.target.checked; });

    const leftSelect = _overlay.querySelector('#splitview-left-select');
    const rightSelect = _overlay.querySelector('#splitview-right-select');
    leftSelect.addEventListener('change', () => { _selectSession('left', leftSelect.value); });
    rightSelect.addEventListener('change', () => { _selectSession('right', rightSelect.value); });

    _overlay.addEventListener('click', (e) => { if (e.target === _overlay) close(); });
  }

  function _selectSession(side, indexStr) {
    const sessions = _getSessions();
    const idx = parseInt(indexStr, 10);
    const session = isNaN(idx) ? null : sessions[idx] || null;
    if (side === 'left') _leftSession = session;
    else _rightSession = session;
    _renderPane(side, session);
    _renderStats();
  }

  function _renderPane(side, session) {
    const paneId = side === 'left' ? 'splitview-left-pane' : 'splitview-right-pane';
    const pane = document.getElementById(paneId);
    if (!pane) return;
    pane.innerHTML = '';
    if (!session || !Array.isArray(session.messages) || session.messages.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'splitview-pane-empty';
      empty.textContent = session ? 'This session has no messages.' : `Select a session on the ${side}`;
      pane.appendChild(empty);
      return;
    }
    session.messages.forEach((msg, i) => {
      const el = document.createElement('div');
      const role = (msg.role || 'user').toLowerCase();
      el.className = `splitview-msg splitview-msg-${role}`;
      const badge = document.createElement('span');
      badge.className = 'splitview-msg-role';
      badge.textContent = role === 'user' ? '👤' : role === 'system' ? '⚙️' : '🤖';
      const num = document.createElement('span');
      num.className = 'splitview-msg-num';
      num.textContent = `#${i + 1}`;
      const content = document.createElement('div');
      content.className = 'splitview-msg-content';
      content.textContent = _truncate(msg.content || '', MAX_PREVIEW_CHARS);
      el.appendChild(badge);
      el.appendChild(num);
      el.appendChild(content);
      pane.appendChild(el);
    });
  }

  function _renderStats() {
    const el = document.getElementById('splitview-stats');
    if (!el) return;
    const leftMsgs = _leftSession && Array.isArray(_leftSession.messages) ? _leftSession.messages : [];
    const rightMsgs = _rightSession && Array.isArray(_rightSession.messages) ? _rightSession.messages : [];
    if (leftMsgs.length === 0 && rightMsgs.length === 0) { el.innerHTML = ''; return; }
    const leftWords = leftMsgs.reduce((sum, m) => sum + ((m.content || '').split(/\s+/).filter(Boolean).length), 0);
    const rightWords = rightMsgs.reduce((sum, m) => sum + ((m.content || '').split(/\s+/).filter(Boolean).length), 0);
    const leftUser = leftMsgs.filter(m => m.role === 'user').length;
    const rightUser = rightMsgs.filter(m => m.role === 'user').length;
    const leftAI = leftMsgs.filter(m => m.role === 'assistant').length;
    const rightAI = rightMsgs.filter(m => m.role === 'assistant').length;
    el.innerHTML = `
      <div class="splitview-stat-group">
        <span class="splitview-stat-label">Left:</span>
        <span>${leftMsgs.length} msgs (${leftUser} user, ${leftAI} AI) · ${leftWords.toLocaleString()} words</span>
      </div>
      <div class="splitview-stat-group">
        <span class="splitview-stat-label">Right:</span>
        <span>${rightMsgs.length} msgs (${rightUser} user, ${rightAI} AI) · ${rightWords.toLocaleString()} words</span>
      </div>
    `;
  }

  function _swap() {
    const leftSelect = document.getElementById('splitview-left-select');
    const rightSelect = document.getElementById('splitview-right-select');
    if (!leftSelect || !rightSelect) return;
    const temp = leftSelect.value;
    leftSelect.value = rightSelect.value;
    rightSelect.value = temp;
    const tempSession = _leftSession;
    _leftSession = _rightSession;
    _rightSession = tempSession;
    _renderPane('left', _leftSession);
    _renderPane('right', _rightSession);
    _renderStats();
  }

  function open() {
    _createOverlay();
    _overlay.style.display = '';
    _isOpen = true;
    _leftSession = null;
    _rightSession = null;
  }

  function close() {
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _isOpen = false;
    _leftSession = null;
    _rightSession = null;
  }

  function toggle() { _isOpen ? close() : open(); }
  function isOpen() { return _isOpen; }
  function getLeftSession() { return _leftSession; }
  function getRightSession() { return _rightSession; }
  function isSyncScrollEnabled() { return _syncScroll; }

  return {
    open, close, toggle, isOpen,
    getLeftSession, getRightSession, isSyncScrollEnabled,
    _escapeHtml, _truncate, _getSessions, _renderStats, _swap,
    _selectSession, _renderPane,
    MAX_PREVIEW_CHARS
  };
}

let SplitView;

beforeEach(() => {
  document.body.innerHTML = '<div id="chat-output"></div>';
  SafeStorage._data = {};
  SessionManager._sessions = [];
  SplitView = createSplitView();
});

afterEach(() => {
  if (SplitView && SplitView.isOpen()) SplitView.close();
});

describe('SplitView', () => {
  test('module has public API', () => {
    expect(typeof SplitView.open).toBe('function');
    expect(typeof SplitView.close).toBe('function');
    expect(typeof SplitView.toggle).toBe('function');
    expect(typeof SplitView.isOpen).toBe('function');
    expect(typeof SplitView.getLeftSession).toBe('function');
    expect(typeof SplitView.getRightSession).toBe('function');
    expect(typeof SplitView.isSyncScrollEnabled).toBe('function');
  });

  test('open creates overlay and sets isOpen', () => {
    SplitView.open();
    expect(SplitView.isOpen()).toBe(true);
    expect(document.getElementById('splitview-overlay')).not.toBeNull();
  });

  test('close removes overlay', () => {
    SplitView.open();
    SplitView.close();
    expect(SplitView.isOpen()).toBe(false);
    expect(SplitView.getLeftSession()).toBeNull();
  });

  test('toggle switches state', () => {
    expect(SplitView.isOpen()).toBe(false);
    SplitView.toggle();
    expect(SplitView.isOpen()).toBe(true);
    SplitView.toggle();
    expect(SplitView.isOpen()).toBe(false);
  });

  test('sync scroll enabled by default', () => {
    expect(SplitView.isSyncScrollEnabled()).toBe(true);
  });

  test('_escapeHtml escapes HTML', () => {
    expect(SplitView._escapeHtml('<b>hi</b>')).toBe('&lt;b&gt;hi&lt;/b&gt;');
  });

  test('_truncate shortens long text', () => {
    expect(SplitView._truncate('hello', 10)).toBe('hello');
    const long = 'x'.repeat(400);
    const result = SplitView._truncate(long, 300);
    expect(result.length).toBe(301);
    expect(result.endsWith('…')).toBe(true);
  });

  test('_truncate handles empty/null', () => {
    expect(SplitView._truncate('', 10)).toBe('');
    expect(SplitView._truncate(null, 10)).toBe('');
  });

  test('MAX_PREVIEW_CHARS is 300', () => {
    expect(SplitView.MAX_PREVIEW_CHARS).toBe(300);
  });

  test('_getSessions returns array', () => {
    expect(Array.isArray(SplitView._getSessions())).toBe(true);
  });

  test('_getSessions returns SessionManager sessions', () => {
    SessionManager._sessions = [{ name: 'A', messages: [] }];
    expect(SplitView._getSessions()).toEqual([{ name: 'A', messages: [] }]);
  });

  test('overlay has ARIA attributes', () => {
    SplitView.open();
    const overlay = document.getElementById('splitview-overlay');
    expect(overlay.getAttribute('role')).toBe('dialog');
    expect(overlay.getAttribute('aria-modal')).toBe('true');
  });

  test('selectors are present', () => {
    SplitView.open();
    expect(document.getElementById('splitview-left-select')).not.toBeNull();
    expect(document.getElementById('splitview-right-select')).not.toBeNull();
  });

  test('swap button exists', () => {
    SplitView.open();
    expect(document.getElementById('splitview-swap-btn')).not.toBeNull();
  });

  test('panes exist', () => {
    SplitView.open();
    expect(document.getElementById('splitview-left-pane')).not.toBeNull();
    expect(document.getElementById('splitview-right-pane')).not.toBeNull();
  });

  test('selecting a session renders messages', () => {
    SessionManager._sessions = [
      { name: 'Test', messages: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi there' }] }
    ];
    SplitView.open();
    SplitView._selectSession('left', '0');
    const pane = document.getElementById('splitview-left-pane');
    const msgs = pane.querySelectorAll('.splitview-msg');
    expect(msgs.length).toBe(2);
  });

  test('selecting invalid index shows empty', () => {
    SplitView.open();
    SplitView._selectSession('left', 'abc');
    expect(SplitView.getLeftSession()).toBeNull();
  });

  test('stats render with sessions selected', () => {
    SessionManager._sessions = [
      { name: 'A', messages: [{ role: 'user', content: 'one two three' }] },
      { name: 'B', messages: [{ role: 'assistant', content: 'four five' }] }
    ];
    SplitView.open();
    SplitView._selectSession('left', '0');
    SplitView._selectSession('right', '1');
    const stats = document.getElementById('splitview-stats');
    expect(stats.innerHTML).toContain('Left:');
    expect(stats.innerHTML).toContain('Right:');
  });

  test('swap exchanges sessions', () => {
    SessionManager._sessions = [
      { name: 'A', messages: [{ role: 'user', content: 'aaa' }] },
      { name: 'B', messages: [{ role: 'assistant', content: 'bbb' }] }
    ];
    SplitView.open();
    SplitView._selectSession('left', '0');
    SplitView._selectSession('right', '1');
    const leftBefore = SplitView.getLeftSession();
    const rightBefore = SplitView.getRightSession();
    SplitView._swap();
    expect(SplitView.getLeftSession()).toBe(rightBefore);
    expect(SplitView.getRightSession()).toBe(leftBefore);
  });

  test('message roles get correct CSS classes', () => {
    SessionManager._sessions = [
      { name: 'T', messages: [
        { role: 'user', content: 'u' },
        { role: 'assistant', content: 'a' },
        { role: 'system', content: 's' }
      ]}
    ];
    SplitView.open();
    SplitView._selectSession('left', '0');
    const pane = document.getElementById('splitview-left-pane');
    expect(pane.querySelector('.splitview-msg-user')).not.toBeNull();
    expect(pane.querySelector('.splitview-msg-assistant')).not.toBeNull();
    expect(pane.querySelector('.splitview-msg-system')).not.toBeNull();
  });

  test('message numbers are sequential', () => {
    SessionManager._sessions = [
      { name: 'T', messages: [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }] }
    ];
    SplitView.open();
    SplitView._selectSession('left', '0');
    const nums = document.getElementById('splitview-left-pane').querySelectorAll('.splitview-msg-num');
    expect(nums[0].textContent).toBe('#1');
    expect(nums[1].textContent).toBe('#2');
  });

  test('session with no messages shows empty message', () => {
    SessionManager._sessions = [{ name: 'Empty', messages: [] }];
    SplitView.open();
    SplitView._selectSession('left', '0');
    const pane = document.getElementById('splitview-left-pane');
    expect(pane.textContent).toContain('no messages');
  });

  test('close is idempotent', () => {
    SplitView.close();
    SplitView.close();
    expect(SplitView.isOpen()).toBe(false);
  });

  test('double open does not throw', () => {
    SplitView.open();
    expect(() => SplitView.open()).not.toThrow();
    SplitView.close();
  });

  test('session options include message count', () => {
    SessionManager._sessions = [{ name: 'Demo', messages: [{ role: 'user', content: 'hi' }] }];
    SplitView.open();
    const select = document.getElementById('splitview-left-select');
    expect(select.innerHTML).toContain('1 msgs');
  });
});
