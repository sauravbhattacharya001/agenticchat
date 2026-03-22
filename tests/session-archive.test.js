/**
 * @jest-environment jsdom
 */

// Minimal localStorage mock
const store = {};
const localStorageMock = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  get length() { return Object.keys(store).length; },
  key: (i) => Object.keys(store)[i] ?? null,
  clear: () => { for (const k of Object.keys(store)) delete store[k]; },
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Load app
const fs = require('fs');
const path = require('path');
const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// Provide crypto.randomUUID
if (!globalThis.crypto) globalThis.crypto = {};
if (!globalThis.crypto.randomUUID) {
  let counter = 0;
  globalThis.crypto.randomUUID = () => `test-uuid-${++counter}`;
}

// Provide minimal DOM elements the modules expect
document.body.innerHTML = `
  <div id="chat-output"></div>
  <div id="console-output"></div>
  <div id="last-prompt"></div>
  <div id="char-count"></div>
  <div id="sessions-list"></div>
  <div id="sessions-count"></div>
  <div id="sessions-panel"></div>
  <div id="sessions-overlay"></div>
  <input id="api-key" type="password">
  <input id="chat-input">
  <button id="send-btn"></button>
  <div id="token-usage"></div>
  <div id="code-actions"></div>
`;

// Suppress errors from modules that do complex DOM init
const origConsoleError = console.error;
console.error = () => {};

try {
  eval(appCode);
} catch (e) {
  // Some modules may fail init in test env - that's OK
}

console.error = origConsoleError;

describe('SessionArchive', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  test('isArchived returns false for unknown session', () => {
    expect(SessionArchive.isArchived('nonexistent')).toBe(false);
  });

  test('archive and unarchive a session', () => {
    SessionArchive.archive('sess-1');
    expect(SessionArchive.isArchived('sess-1')).toBe(true);

    SessionArchive.unarchive('sess-1');
    expect(SessionArchive.isArchived('sess-1')).toBe(false);
  });

  test('toggle flips archive state', () => {
    expect(SessionArchive.toggle('sess-2')).toBe(true);
    expect(SessionArchive.isArchived('sess-2')).toBe(true);

    expect(SessionArchive.toggle('sess-2')).toBe(false);
    expect(SessionArchive.isArchived('sess-2')).toBe(false);
  });

  test('getArchivedCount returns correct count', () => {
    SessionArchive.archive('a');
    SessionArchive.archive('b');
    SessionArchive.archive('c');
    expect(SessionArchive.getArchivedCount()).toBe(3);
  });

  test('filterSessions hides archived by default', () => {
    SessionArchive.setShowArchived(false);
    SessionArchive.archive('s2');

    const sessions = [
      { id: 's1', name: 'Active' },
      { id: 's2', name: 'Archived' },
      { id: 's3', name: 'Also Active' },
    ];

    const filtered = SessionArchive.filterSessions(sessions);
    expect(filtered.map(s => s.id)).toEqual(['s1', 's3']);
  });

  test('filterSessions shows only archived when toggled', () => {
    SessionArchive.archive('s2');
    SessionArchive.setShowArchived(true);

    const sessions = [
      { id: 's1', name: 'Active' },
      { id: 's2', name: 'Archived' },
    ];

    const filtered = SessionArchive.filterSessions(sessions);
    expect(filtered.map(s => s.id)).toEqual(['s2']);
  });

  test('cleanup removes stale archived IDs', () => {
    SessionArchive.archive('exists');
    SessionArchive.archive('gone');

    SessionArchive.cleanup(['exists', 'other']);
    expect(SessionArchive.isArchived('exists')).toBe(true);
    expect(SessionArchive.isArchived('gone')).toBe(false);
  });

  test('toggleShowArchived flips visibility', () => {
    SessionArchive.setShowArchived(false);
    expect(SessionArchive.toggleShowArchived()).toBe(true);
    expect(SessionArchive.isShowingArchived()).toBe(true);
    expect(SessionArchive.toggleShowArchived()).toBe(false);
  });
});
