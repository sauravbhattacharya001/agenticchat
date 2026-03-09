/**
 * @jest-environment jsdom
 */

const { setupDOM, loadApp } = require('./setup');

beforeEach(() => {
  setupDOM();
  localStorage.clear();
  loadApp();
});

describe('DraftManager', () => {
  test('module exists with expected API', () => {
    expect(DraftManager).toBeDefined();
    expect(typeof DraftManager.init).toBe('function');
    expect(typeof DraftManager.saveDraft).toBe('function');
    expect(typeof DraftManager.loadDraft).toBe('function');
    expect(typeof DraftManager.clearDraft).toBe('function');
    expect(typeof DraftManager.getDraft).toBe('function');
    expect(typeof DraftManager.hasDraft).toBe('function');
    expect(typeof DraftManager.getAllDrafts).toBe('function');
    expect(typeof DraftManager.clearAllDrafts).toBe('function');
    expect(typeof DraftManager.getStats).toBe('function');
  });

  test('saveDraft stores current input text', () => {
    const input = document.getElementById('chat-input');
    input.value = 'Hello, this is a draft';
    DraftManager.saveDraft();
    expect(DraftManager.hasDraft()).toBe(true);
    expect(DraftManager.getDraft()).toBe('Hello, this is a draft');
  });

  test('saveDraft clears draft when input is empty', () => {
    const input = document.getElementById('chat-input');
    input.value = 'Some text';
    DraftManager.saveDraft();
    expect(DraftManager.hasDraft()).toBe(true);

    input.value = '';
    DraftManager.saveDraft();
    expect(DraftManager.hasDraft()).toBe(false);
  });

  test('saveDraft clears draft when input is whitespace only', () => {
    const input = document.getElementById('chat-input');
    input.value = '   \n  ';
    DraftManager.saveDraft();
    expect(DraftManager.hasDraft()).toBe(false);
  });

  test('loadDraft restores text into input', () => {
    const input = document.getElementById('chat-input');
    input.value = 'My draft text';
    DraftManager.saveDraft();

    input.value = '';
    DraftManager.loadDraft();
    expect(input.value).toBe('My draft text');
  });

  test('loadDraft returns null when no draft exists', () => {
    const result = DraftManager.loadDraft();
    expect(result).toBeNull();
  });

  test('clearDraft removes the draft', () => {
    const input = document.getElementById('chat-input');
    input.value = 'Draft to clear';
    DraftManager.saveDraft();
    expect(DraftManager.hasDraft()).toBe(true);

    DraftManager.clearDraft();
    expect(DraftManager.hasDraft()).toBe(false);
    expect(DraftManager.getDraft()).toBeNull();
  });

  test('getDraft returns text without modifying input', () => {
    const input = document.getElementById('chat-input');
    input.value = 'Some draft';
    DraftManager.saveDraft();

    input.value = 'Different text';
    const draft = DraftManager.getDraft();
    expect(draft).toBe('Some draft');
    expect(input.value).toBe('Different text');
  });

  test('hasDraft returns false for non-existent session', () => {
    expect(DraftManager.hasDraft('non-existent-id')).toBe(false);
  });

  test('getAllDrafts returns all saved drafts', () => {
    const input = document.getElementById('chat-input');

    // Save draft for default session
    input.value = 'Draft 1';
    DraftManager.saveDraft();

    const all = DraftManager.getAllDrafts();
    const keys = Object.keys(all);
    expect(keys.length).toBe(1);
    expect(all[keys[0]].text).toBe('Draft 1');
  });

  test('clearAllDrafts removes everything', () => {
    const input = document.getElementById('chat-input');
    input.value = 'Draft';
    DraftManager.saveDraft();

    DraftManager.clearAllDrafts();
    const all = DraftManager.getAllDrafts();
    expect(Object.keys(all).length).toBe(0);
  });

  test('getStats returns count and total chars', () => {
    const input = document.getElementById('chat-input');
    input.value = 'Hello world';
    DraftManager.saveDraft();

    const stats = DraftManager.getStats();
    expect(stats.count).toBe(1);
    expect(stats.totalChars).toBe(11);
  });

  test('draft is tied to active session id', () => {
    const input = document.getElementById('chat-input');

    // Save draft in default session
    input.value = 'Default draft';
    DraftManager.saveDraft();

    // Switch to a different session
    localStorage.setItem('agenticchat_active_session', 'session-abc');
    input.value = 'Session ABC draft';
    DraftManager.saveDraft();

    // Check both exist
    expect(DraftManager.getDraft('session-abc')).toBe('Session ABC draft');
    expect(DraftManager.getDraft('__default__')).toBe('Default draft');
  });

  test('loadDraft for specific session id', () => {
    const input = document.getElementById('chat-input');
    input.value = 'Specific draft';
    localStorage.setItem('agenticchat_active_session', 'session-xyz');
    DraftManager.saveDraft();

    input.value = '';
    const result = DraftManager.loadDraft('session-xyz');
    expect(result).toBe('Specific draft');
    expect(input.value).toBe('Specific draft');
  });

  test('clearDraft for specific session id', () => {
    const input = document.getElementById('chat-input');
    input.value = 'To clear';
    localStorage.setItem('agenticchat_active_session', 'session-clear');
    DraftManager.saveDraft();

    DraftManager.clearDraft('session-clear');
    expect(DraftManager.hasDraft('session-clear')).toBe(false);
  });

  test('draft text is truncated at MAX_DRAFT_LENGTH', () => {
    const input = document.getElementById('chat-input');
    input.value = 'x'.repeat(60000);
    DraftManager.saveDraft();

    const draft = DraftManager.getDraft();
    expect(draft.length).toBe(50000);
  });

  test('draft savedAt timestamp is recorded', () => {
    const input = document.getElementById('chat-input');
    input.value = 'Timestamped';
    DraftManager.saveDraft();

    const all = DraftManager.getAllDrafts();
    const keys = Object.keys(all);
    expect(all[keys[0]].savedAt).toBeDefined();
    expect(typeof all[keys[0]].savedAt).toBe('number');
  });

  test('init injects styles', () => {
    DraftManager.init();
    const style = document.getElementById('draft-manager-styles');
    expect(style).not.toBeNull();
    expect(style.textContent).toContain('.draft-indicator');
  });

  test('init restores draft on page load if input is empty', () => {
    const input = document.getElementById('chat-input');
    input.value = 'Pre-existing draft';
    DraftManager.saveDraft();
    input.value = '';

    DraftManager.init();
    // getDraft should still return the saved draft
    expect(DraftManager.getDraft()).toBe('Pre-existing draft');
  });

  test('multiple sessions can have independent drafts', () => {
    const input = document.getElementById('chat-input');

    localStorage.setItem('agenticchat_active_session', 'sess-1');
    input.value = 'Draft for session 1';
    DraftManager.saveDraft();

    localStorage.setItem('agenticchat_active_session', 'sess-2');
    input.value = 'Draft for session 2';
    DraftManager.saveDraft();

    localStorage.setItem('agenticchat_active_session', 'sess-3');
    input.value = 'Draft for session 3';
    DraftManager.saveDraft();

    expect(DraftManager.getDraft('sess-1')).toBe('Draft for session 1');
    expect(DraftManager.getDraft('sess-2')).toBe('Draft for session 2');
    expect(DraftManager.getDraft('sess-3')).toBe('Draft for session 3');

    const stats = DraftManager.getStats();
    expect(stats.count).toBe(3);
  });

  test('clearAllDrafts then getStats returns zero', () => {
    const input = document.getElementById('chat-input');
    input.value = 'Some draft';
    DraftManager.saveDraft();
    DraftManager.clearAllDrafts();
    const stats = DraftManager.getStats();
    expect(stats.count).toBe(0);
    expect(stats.totalChars).toBe(0);
  });

  test('overwriting a draft updates savedAt', (done) => {
    const input = document.getElementById('chat-input');
    input.value = 'First version';
    DraftManager.saveDraft();
    const all1 = DraftManager.getAllDrafts();
    const firstTime = all1[Object.keys(all1)[0]].savedAt;

    setTimeout(() => {
      input.value = 'Second version';
      DraftManager.saveDraft();
      const all2 = DraftManager.getAllDrafts();
      const secondTime = all2[Object.keys(all2)[0]].savedAt;
      expect(secondTime).toBeGreaterThanOrEqual(firstTime);
      expect(DraftManager.getDraft()).toBe('Second version');
      done();
    }, 10);
  });
});
