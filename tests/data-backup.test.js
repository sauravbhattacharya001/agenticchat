/**
 * DataBackup tests — backup/restore all user data
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

let dom, cleanup;

function setup() {
  dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.HTMLElement = dom.window.HTMLElement;
  global.navigator = dom.window.navigator;
  global.Event = dom.window.Event;
  global.alert = () => {};
  global.confirm = () => true;
  global.prompt = () => null;
  global.FileReader = dom.window.FileReader;
  global.crypto = {
    randomUUID: () =>
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      }),
    getRandomValues: (arr) => {
      for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
      return arr;
    },
  };
  global.MutationObserver = class { observe() {} disconnect() {} };
  global.IntersectionObserver = class { observe() {} disconnect() {} };
  global.matchMedia = () => ({ matches: false, addEventListener: () => {} });

  const { setupDOM, loadApp } = require('./setup');
  setupDOM();
  loadApp();

  cleanup = () => {
    delete global.window;
    delete global.document;
    delete global.localStorage;
    delete global.HTMLElement;
    delete global.navigator;
    delete global.Event;
    delete global.alert;
    delete global.confirm;
    delete global.prompt;
    delete global.FileReader;
    delete global.crypto;
    delete global.MutationObserver;
    delete global.IntersectionObserver;
    delete global.matchMedia;
    delete require.cache[require.resolve('./setup')];
  };
}

describe('DataBackup', () => {
  beforeEach(() => { setup(); });
  afterEach(() => { if (cleanup) cleanup(); });

  describe('createBackup', () => {
    it('returns backup with correct magic and version', () => {
      const backup = DataBackup.createBackup();
      assert.equal(backup.magic, 'agenticchat-backup');
      assert.equal(backup.version, DataBackup.FORMAT_VERSION);
      assert.equal(typeof backup.timestamp, 'string');
      assert.ok(backup.data);
      assert.ok(backup.stats);
    });

    it('captures data from localStorage', () => {
      localStorage.setItem('agenticchat_snippets', JSON.stringify([{ id: 1 }]));
      localStorage.setItem('agenticchat_theme', 'dark');
      const backup = DataBackup.createBackup();
      assert.equal(backup.data.snippets, JSON.stringify([{ id: 1 }]));
      assert.equal(backup.data.theme, 'dark');
    });

    it('omits keys with no data', () => {
      localStorage.removeItem('agenticchat_scratchpad');
      const backup = DataBackup.createBackup();
      assert.equal(backup.data.scratchpad, undefined);
    });

    it('counts snippets in stats', () => {
      localStorage.setItem('agenticchat_snippets', JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]));
      const backup = DataBackup.createBackup();
      assert.equal(backup.stats.snippetCount, 3);
    });

    it('counts bookmarks in stats', () => {
      localStorage.setItem('chatBookmarks', JSON.stringify([{ id: 'a' }, { id: 'b' }]));
      const backup = DataBackup.createBackup();
      assert.equal(backup.stats.bookmarkCount, 2);
    });

    it('counts pins as object keys', () => {
      localStorage.setItem('agenticchat_pins', JSON.stringify({ msg1: true, msg2: true }));
      const backup = DataBackup.createBackup();
      assert.equal(backup.stats.pinCount, 2);
    });

    it('handles malformed JSON gracefully', () => {
      localStorage.setItem('agenticchat_snippets', 'not-json');
      const backup = DataBackup.createBackup();
      assert.equal(backup.stats.snippetCount, 0);
    });

    it('records total bytes', () => {
      localStorage.setItem('agenticchat_theme', 'dark');
      const backup = DataBackup.createBackup();
      assert.ok(backup.stats.totalBytes > 0);
    });

    it('counts sessions from object storage', () => {
      localStorage.setItem('agenticchat_sessions', JSON.stringify({ s1: {}, s2: {}, s3: {} }));
      const backup = DataBackup.createBackup();
      assert.equal(backup.stats.sessionCount, 3);
    });

    it('counts sessions from array storage', () => {
      localStorage.setItem('agenticchat_sessions', JSON.stringify([{ id: 1 }, { id: 2 }]));
      const backup = DataBackup.createBackup();
      assert.equal(backup.stats.sessionCount, 2);
    });
  });

  describe('validateBackup', () => {
    it('accepts a valid backup', () => {
      const backup = DataBackup.createBackup();
      const result = DataBackup.validateBackup(backup);
      assert.equal(result.valid, true);
    });

    it('rejects null', () => {
      const result = DataBackup.validateBackup(null);
      assert.equal(result.valid, false);
      assert.ok(result.error.includes('not a valid object'));
    });

    it('rejects non-object', () => {
      assert.equal(DataBackup.validateBackup('string').valid, false);
    });

    it('rejects wrong magic', () => {
      const result = DataBackup.validateBackup({ magic: 'wrong', version: 1, data: {} });
      assert.equal(result.valid, false);
      assert.ok(result.error.includes('invalid magic'));
    });

    it('rejects missing version', () => {
      const result = DataBackup.validateBackup({ magic: 'agenticchat-backup', data: {} });
      assert.equal(result.valid, false);
    });

    it('rejects version 0', () => {
      assert.equal(DataBackup.validateBackup({ magic: 'agenticchat-backup', version: 0, data: {} }).valid, false);
    });

    it('rejects negative version', () => {
      assert.equal(DataBackup.validateBackup({ magic: 'agenticchat-backup', version: -1, data: {} }).valid, false);
    });

    it('rejects missing data section', () => {
      const result = DataBackup.validateBackup({ magic: 'agenticchat-backup', version: 1 });
      assert.equal(result.valid, false);
      assert.ok(result.error.includes('no data'));
    });

    it('warns on newer version', () => {
      const result = DataBackup.validateBackup({
        magic: 'agenticchat-backup', version: 999, data: {}, timestamp: new Date().toISOString()
      });
      assert.equal(result.valid, true);
      assert.ok(result.warnings.some(w => w.includes('newer')));
    });

    it('warns on missing timestamp', () => {
      const result = DataBackup.validateBackup({ magic: 'agenticchat-backup', version: 1, data: {} });
      assert.ok(result.warnings.some(w => w.includes('timestamp')));
    });

    it('warns on unknown data keys', () => {
      const result = DataBackup.validateBackup({
        magic: 'agenticchat-backup', version: 1,
        data: { unknownKey: 'val' }, timestamp: new Date().toISOString()
      });
      assert.ok(result.warnings.some(w => w.includes('unknownKey')));
    });

    it('rejects non-string data values', () => {
      const result = DataBackup.validateBackup({
        magic: 'agenticchat-backup', version: 1,
        data: { theme: 123 }, timestamp: new Date().toISOString()
      });
      assert.equal(result.valid, false);
      assert.ok(result.error.includes('not a string'));
    });
  });

  describe('restoreBackup', () => {
    it('restores all data', () => {
      const backup = {
        magic: 'agenticchat-backup', version: 1,
        timestamp: new Date().toISOString(),
        data: { theme: 'light', snippets: '[]' }
      };
      const result = DataBackup.restoreBackup(backup);
      assert.equal(result.success, true);
      assert.deepEqual(result.restored.sort(), ['snippets', 'theme']);
      assert.equal(localStorage.getItem('agenticchat_theme'), 'light');
      assert.equal(localStorage.getItem('agenticchat_snippets'), '[]');
    });

    it('clears existing keys by default', () => {
      localStorage.setItem('agenticchat_theme', 'dark');
      localStorage.setItem('agenticchat_scratchpad', 'old notes');
      const backup = {
        magic: 'agenticchat-backup', version: 1,
        timestamp: new Date().toISOString(),
        data: { theme: 'light' }
      };
      DataBackup.restoreBackup(backup);
      assert.equal(localStorage.getItem('agenticchat_theme'), 'light');
      assert.equal(localStorage.getItem('agenticchat_scratchpad'), null);
    });

    it('preserves existing keys in merge mode', () => {
      localStorage.setItem('agenticchat_scratchpad', 'keep me');
      const backup = {
        magic: 'agenticchat-backup', version: 1,
        timestamp: new Date().toISOString(),
        data: { theme: 'light' }
      };
      DataBackup.restoreBackup(backup, { merge: true });
      assert.equal(localStorage.getItem('agenticchat_theme'), 'light');
      assert.equal(localStorage.getItem('agenticchat_scratchpad'), 'keep me');
    });

    it('supports selective restore with only option', () => {
      const backup = {
        magic: 'agenticchat-backup', version: 1,
        timestamp: new Date().toISOString(),
        data: { theme: 'light', snippets: '[1]', scratchpad: 'text' }
      };
      const result = DataBackup.restoreBackup(backup, { only: ['theme', 'snippets'] });
      assert.equal(result.success, true);
      assert.ok(result.restored.includes('theme'));
      assert.ok(result.restored.includes('snippets'));
      assert.ok(result.skipped.includes('scratchpad'));
    });

    it('skips unknown keys', () => {
      const backup = {
        magic: 'agenticchat-backup', version: 1,
        timestamp: new Date().toISOString(),
        data: { theme: 'dark', weirdKey: 'val' }
      };
      const result = DataBackup.restoreBackup(backup);
      assert.ok(result.skipped.includes('weirdKey'));
      assert.ok(result.restored.includes('theme'));
    });

    it('returns error for invalid backup', () => {
      const result = DataBackup.restoreBackup({ magic: 'wrong' });
      assert.equal(result.success, false);
      assert.ok(result.error);
    });

    it('selective restore only clears targeted keys', () => {
      localStorage.setItem('agenticchat_theme', 'dark');
      localStorage.setItem('agenticchat_scratchpad', 'my notes');
      const backup = {
        magic: 'agenticchat-backup', version: 1,
        timestamp: new Date().toISOString(),
        data: { theme: 'light' }
      };
      DataBackup.restoreBackup(backup, { only: ['theme'] });
      assert.equal(localStorage.getItem('agenticchat_theme'), 'light');
      assert.equal(localStorage.getItem('agenticchat_scratchpad'), 'my notes');
    });
  });

  describe('exportBackup', () => {
    it('returns success with filename and size', () => {
      const result = DataBackup.exportBackup();
      assert.equal(result.success, true);
      assert.ok(result.filename.startsWith('agenticchat-backup-'));
      assert.ok(result.filename.endsWith('.json'));
      assert.ok(result.size > 0);
    });

    it('includes stats in result', () => {
      const result = DataBackup.exportBackup();
      assert.ok(result.stats);
      assert.equal(typeof result.stats.keyCount, 'number');
    });
  });

  describe('getDataSummary', () => {
    it('returns key count and total bytes', () => {
      localStorage.setItem('agenticchat_theme', 'dark');
      const summary = DataBackup.getDataSummary();
      assert.ok(summary.keyCount >= 1);
      assert.ok(summary.totalBytes > 0);
      assert.ok(summary.humanSize);
    });

    it('returns breakdown sorted by size descending', () => {
      localStorage.setItem('agenticchat_theme', 'x');
      localStorage.setItem('agenticchat_snippets', 'a very long string here for testing');
      const summary = DataBackup.getDataSummary();
      if (summary.breakdown.length >= 2) {
        assert.ok(summary.breakdown[0].bytes >= summary.breakdown[1].bytes);
      }
    });

    it('formats human size correctly', () => {
      DataBackup.clearAllData();
      localStorage.setItem('agenticchat_theme', 'a');
      const summary = DataBackup.getDataSummary();
      assert.ok(summary.humanSize.includes('B'));
    });
  });

  describe('clearAllData', () => {
    it('removes all known keys', () => {
      localStorage.setItem('agenticchat_theme', 'dark');
      localStorage.setItem('agenticchat_snippets', '[]');
      localStorage.setItem('agenticchat_scratchpad', 'notes');
      const result = DataBackup.clearAllData();
      assert.ok(result.cleared.includes('theme'));
      assert.ok(result.cleared.includes('snippets'));
      assert.ok(result.cleared.includes('scratchpad'));
      assert.equal(localStorage.getItem('agenticchat_theme'), null);
    });

    it('does not clear non-app keys', () => {
      localStorage.setItem('other_app_key', 'keep');
      DataBackup.clearAllData();
      assert.equal(localStorage.getItem('other_app_key'), 'keep');
    });

    it('returns empty array when nothing to clear', () => {
      DataBackup.clearAllData();
      const result = DataBackup.clearAllData();
      assert.equal(result.cleared.length, 0);
    });
  });

  describe('round-trip backup/restore', () => {
    it('preserves all data through backup and restore', () => {
      localStorage.setItem('agenticchat_theme', 'custom-dark');
      localStorage.setItem('agenticchat_snippets', JSON.stringify([{ id: 'test', code: 'console.log(1)' }]));
      localStorage.setItem('agenticchat_scratchpad', 'My important notes');
      localStorage.setItem('chatBookmarks', JSON.stringify([{ sid: 's1' }]));
      localStorage.setItem('agenticchat_pins', JSON.stringify({ m1: { text: 'pinned' } }));

      const backup = DataBackup.createBackup();

      DataBackup.clearAllData();
      assert.equal(localStorage.getItem('agenticchat_theme'), null);

      const result = DataBackup.restoreBackup(backup);
      assert.equal(result.success, true);
      assert.equal(localStorage.getItem('agenticchat_theme'), 'custom-dark');
      assert.equal(localStorage.getItem('agenticchat_scratchpad'), 'My important notes');
      const snippets = JSON.parse(localStorage.getItem('agenticchat_snippets'));
      assert.equal(snippets[0].id, 'test');
    });

    it('round-trips with merge mode', () => {
      localStorage.setItem('agenticchat_theme', 'dark');
      const backup = DataBackup.createBackup();

      localStorage.setItem('agenticchat_scratchpad', 'new notes');
      DataBackup.restoreBackup(backup, { merge: true });

      assert.equal(localStorage.getItem('agenticchat_theme'), 'dark');
      assert.equal(localStorage.getItem('agenticchat_scratchpad'), 'new notes');
    });
  });

  describe('STORAGE_KEYS', () => {
    it('contains all expected keys', () => {
      const expected = [
        'sessions', 'activeSession', 'snippets', 'bookmarks', 'reactions',
        'theme', 'costLog', 'persona', 'focusMode', 'inputHistory',
        'scratchpad', 'pins', 'readAloud', 'annotations', 'chapters',
        'sessionTags', 'fmtToolbar', 'selectedModel', 'streaming',
        'showTiming', 'voiceLang'
      ];
      for (const key of expected) {
        assert.ok(DataBackup.STORAGE_KEYS[key], 'Missing: ' + key);
      }
    });

    it('maps to correct localStorage keys', () => {
      assert.equal(DataBackup.STORAGE_KEYS.sessions, 'agenticchat_sessions');
      assert.equal(DataBackup.STORAGE_KEYS.theme, 'agenticchat_theme');
      assert.equal(DataBackup.STORAGE_KEYS.bookmarks, 'chatBookmarks');
      assert.equal(DataBackup.STORAGE_KEYS.selectedModel, 'ac-selected-model');
    });
  });

  describe('importFromFile', () => {
    it('rejects null file', async () => {
      const result = await DataBackup.importFromFile(null);
      assert.equal(result.success, false);
      assert.ok(result.error.includes('No file'));
    });
  });

  describe('showModal', () => {
    it('creates modal overlay in DOM', () => {
      DataBackup.showModal();
      const overlay = document.getElementById('backup-modal-overlay');
      assert.ok(overlay);
    });

    it('shows title text', () => {
      DataBackup.showModal();
      const overlay = document.getElementById('backup-modal-overlay');
      const h3 = overlay.querySelector('h3');
      assert.ok(h3.textContent.includes('Backup'));
    });

    it('removes existing modal before creating new one', () => {
      DataBackup.showModal();
      DataBackup.showModal();
      const overlays = document.querySelectorAll('#backup-modal-overlay');
      assert.equal(overlays.length, 1);
    });
  });
});
