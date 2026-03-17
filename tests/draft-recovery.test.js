/**
 * @jest-environment jsdom
 */
const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');

global.SafeStorage = {
  _data: {},
  get(k) { return this._data[k] || null; },
  set(k, v) { this._data[k] = String(v); },
  remove(k) { delete this._data[k]; },
  clear() { this._data = {}; }
};

function createDraftRecovery() {
  const STORAGE_KEY = 'agenticchat_drafts';
  const DEBOUNCE_MS = 500;
  let _timer = null;
  let _lastSavedText = '';
  let _toastEl = null;

  function _loadDrafts() {
    try {
      const raw = SafeStorage.get(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  function _saveDrafts(drafts) {
    try { SafeStorage.set(STORAGE_KEY, JSON.stringify(drafts)); } catch {}
  }

  function _sessionId() {
    try {
      const id = SafeStorage.get('agenticchat_active_session');
      return id || '__default__';
    } catch { return '__default__'; }
  }

  function saveDraft() {
    const input = document.getElementById('chat-input');
    if (!input) return;
    const text = input.value.trim();
    const sid = _sessionId();
    const drafts = _loadDrafts();
    if (text) {
      drafts[sid] = { text, ts: Date.now() };
    } else {
      delete drafts[sid];
    }
    _saveDrafts(drafts);
    _lastSavedText = text;
  }

  function restoreDraft() {
    const input = document.getElementById('chat-input');
    if (!input) return false;
    const sid = _sessionId();
    const drafts = _loadDrafts();
    const draft = drafts[sid];
    if (draft && draft.text) {
      if (input.value.trim()) return false;
      input.value = draft.text;
      _lastSavedText = draft.text;
      _showToast(draft.ts);
      return true;
    }
    return false;
  }

  function clearDraft() {
    const sid = _sessionId();
    const drafts = _loadDrafts();
    delete drafts[sid];
    _saveDrafts(drafts);
    _lastSavedText = '';
  }

  function discardDraft() {
    const input = document.getElementById('chat-input');
    if (input) input.value = '';
    clearDraft();
    _showDiscardToast();
  }

  function getDraft(sessionId) {
    const drafts = _loadDrafts();
    return drafts[sessionId || _sessionId()] || null;
  }

  function getDraftCount() {
    return Object.keys(_loadDrafts()).length;
  }

  function pruneOldDrafts(maxAgeDays) {
    const cutoff = Date.now() - (maxAgeDays || 30) * 86400000;
    const drafts = _loadDrafts();
    let pruned = 0;
    for (const sid of Object.keys(drafts)) {
      if (drafts[sid].ts < cutoff) {
        delete drafts[sid];
        pruned++;
      }
    }
    if (pruned > 0) _saveDrafts(drafts);
    return pruned;
  }

  function _showToast(ts) {
    _removeToast();
    const age = _formatAge(ts);
    _toastEl = document.createElement('div');
    _toastEl.className = 'draft-toast';
    _toastEl.setAttribute  ('role', 'status');
    _toastEl.innerHTML = `📝 Draft recovered <span class="draft-toast-age">${age}</span> <button class="draft-toast-discard" title="Discard draft">✕</button>`;
    _toastEl.querySelector('.draft-toast-discard').addEventListener('click', () => {
      discardDraft();
      _removeToast();
    });
    document.body.appendChild(_toastEl);
    setTimeout(() => _removeToast(), 4000);
  }

  function _showDiscardToast() {
    _removeToast();
    _toastEl = document.createElement('div');
    _toastEl.className = 'draft-toast draft-toast-discard-confirm';
    _toastEl.setAttribute('role', 'status');
    _toastEl.textContent = '🗑️ Draft discarded';
    document.body.appendChild(_toastEl);
    setTimeout(() => _removeToast(), 2000);
  }

  function _removeToast() {
    if (_toastEl) { _toastEl.remove(); _toastEl = null; }
  }

  function _formatAge(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }

  function _onInput() {
    if (_timer) clearTimeout(_timer);
    _timer = setTimeout(() => {
      const input = document.getElementById('chat-input');
      if (input && input.value.trim() !== _lastSavedText) {
        saveDraft();
      }
    }, DEBOUNCE_MS);
  }

  function load() {
    const input = document.getElementById('chat-input');
    if (input) input.addEventListener('input', _onInput);
    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) {
      sendBtn.addEventListener('click', () => {
        setTimeout(() => {
          const inp = document.getElementById('chat-input');
          if (inp && !inp.value.trim()) clearDraft();
        }, 100);
      });
    }
    pruneOldDrafts(30);
    restoreDraft();
  }

  return {
    load, saveDraft, restoreDraft, clearDraft, discardDraft,
    getDraft, getDraftCount, pruneOldDrafts,
    _loadDrafts, _saveDrafts, _sessionId, _formatAge, _onInput
  };
}

let DraftRecovery;

beforeEach(() => {
  SafeStorage.clear();
  document.body.innerHTML = `<input id="chat-input" /><button id="send-btn"></button>`;
  jest.useFakeTimers();
  DraftRecovery = createDraftRecovery();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('DraftRecovery', () => {
  test('saveDraft stores text for current session', () => {
    document.getElementById('chat-input').value = 'hello world';
    DraftRecovery.saveDraft();
    const draft = DraftRecovery.getDraft();
    expect(draft).toBeTruthy();
    expect(draft.text).toBe('hello world');
  });

  test('saveDraft removes entry when input is empty', () => {
    document.getElementById('chat-input').value = 'something';
    DraftRecovery.saveDraft();
    expect(DraftRecovery.getDraft()).toBeTruthy();
    document.getElementById('chat-input').value = '';
    DraftRecovery.saveDraft();
    expect(DraftRecovery.getDraft()).toBeNull();
  });

  test('restoreDraft populates input', () => {
    document.getElementById('chat-input').value = 'saved text';
    DraftRecovery.saveDraft();
    document.getElementById('chat-input').value = '';
    const recovered = DraftRecovery.restoreDraft();
    expect(recovered).toBe(true);
    expect(document.getElementById('chat-input').value).toBe('saved text');
  });

  test('restoreDraft does not overwrite existing input', () => {
    document.getElementById('chat-input').value = 'draft';
    DraftRecovery.saveDraft();
    document.getElementById('chat-input').value = 'new stuff';
    expect(DraftRecovery.restoreDraft()).toBe(false);
    expect(document.getElementById('chat-input').value).toBe('new stuff');
  });

  test('restoreDraft returns false when no draft exists', () => {
    expect(DraftRecovery.restoreDraft()).toBe(false);
  });

  test('clearDraft removes draft for current session', () => {
    document.getElementById('chat-input').value = 'text';
    DraftRecovery.saveDraft();
    DraftRecovery.clearDraft();
    expect(DraftRecovery.getDraft()).toBeNull();
  });

  test('discardDraft clears input and draft', () => {
    document.getElementById('chat-input').value = 'text';
    DraftRecovery.saveDraft();
    DraftRecovery.discardDraft();
    expect(document.getElementById('chat-input').value).toBe('');
    expect(DraftRecovery.getDraft()).toBeNull();
  });

  test('getDraftCount returns correct count', () => {
    expect(DraftRecovery.getDraftCount()).toBe(0);
    document.getElementById('chat-input').value = 'a';
    DraftRecovery.saveDraft();
    expect(DraftRecovery.getDraftCount()).toBe(1);
  });

  test('pruneOldDrafts removes stale entries', () => {
    document.getElementById('chat-input').value = 'old';
    DraftRecovery.saveDraft();
    const drafts = DraftRecovery._loadDrafts();
    const key = Object.keys(drafts)[0];
    drafts[key].ts = Date.now() - 40 * 86400000;
    DraftRecovery._saveDrafts(drafts);
    expect(DraftRecovery.pruneOldDrafts(30)).toBe(1);
    expect(DraftRecovery.getDraftCount()).toBe(0);
  });

  test('pruneOldDrafts keeps recent entries', () => {
    document.getElementById('chat-input').value = 'recent';
    DraftRecovery.saveDraft();
    expect(DraftRecovery.pruneOldDrafts(30)).toBe(0);
    expect(DraftRecovery.getDraftCount()).toBe(1);
  });

  test('_sessionId returns __default__ when no active session', () => {
    expect(DraftRecovery._sessionId()).toBe('__default__');
  });

  test('_sessionId returns active session id', () => {
    SafeStorage.set('agenticchat_active_session', 'session-123');
    expect(DraftRecovery._sessionId()).toBe('session-123');
  });

  test('drafts are isolated per session', () => {
    document.getElementById('chat-input').value = 'draft A';
    DraftRecovery.saveDraft();
    SafeStorage.set('agenticchat_active_session', 'session-B');
    document.getElementById('chat-input').value = 'draft B';
    DraftRecovery.saveDraft();
    expect(DraftRecovery.getDraft('__default__').text).toBe('draft A');
    expect(DraftRecovery.getDraft('session-B').text).toBe('draft B');
  });

  test('_formatAge returns human-readable times', () => {
    const now = Date.now();
    expect(DraftRecovery._formatAge(now - 5000)).toBe('just now');
    expect(DraftRecovery._formatAge(now - 120000)).toBe('2m ago');
    expect(DraftRecovery._formatAge(now - 7200000)).toBe('2h ago');
    expect(DraftRecovery._formatAge(now - 172800000)).toBe('2d ago');
  });

  test('load initializes without errors', () => {
    expect(() => DraftRecovery.load()).not.toThrow();
  });

  test('debounced input handler triggers save', () => {
    DraftRecovery.load();
    const input = document.getElementById('chat-input');
    input.value = 'typing...';
    input.dispatchEvent(new Event('input'));
    expect(DraftRecovery.getDraft()).toBeNull();
    jest.advanceTimersByTime(600);
    expect(DraftRecovery.getDraft()).toBeTruthy();
    expect(DraftRecovery.getDraft().text).toBe('typing...');
  });

  test('toast appears on draft recovery', () => {
    document.getElementById('chat-input').value = 'saved';
    DraftRecovery.saveDraft();
    document.getElementById('chat-input').value = '';
    DraftRecovery.restoreDraft();
    const toast = document.querySelector('.draft-toast');
    expect(toast).toBeTruthy();
    expect(toast.textContent).toContain('Draft recovered');
  });

  test('toast auto-dismisses after 4 seconds', () => {
    document.getElementById('chat-input').value = 'saved';
    DraftRecovery.saveDraft();
    document.getElementById('chat-input').value = '';
    DraftRecovery.restoreDraft();
    expect(document.querySelector('.draft-toast')).toBeTruthy();
    jest.advanceTimersByTime(4100);
    expect(document.querySelector('.draft-toast')).toBeNull();
  });

  test('discard toast appears on discardDraft', () => {
    document.getElementById('chat-input').value = 'text';
    DraftRecovery.saveDraft();
    DraftRecovery.discardDraft();
    const toast = document.querySelector('.draft-toast-discard-confirm');
    expect(toast).toBeTruthy();
    expect(toast.textContent).toContain('Draft discarded');
  });

  test('handles corrupted storage gracefully', () => {
    SafeStorage.set('agenticchat_drafts', '{invalid json');
    expect(DraftRecovery._loadDrafts()).toEqual({});
  });

  test('handles missing input element gracefully', () => {
    document.body.innerHTML = '';
    expect(() => DraftRecovery.saveDraft()).not.toThrow();
    expect(() => DraftRecovery.restoreDraft()).not.toThrow();
    expect(() => DraftRecovery.discardDraft()).not.toThrow();
  });
});
