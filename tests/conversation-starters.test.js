/**
 * ConversationStarters — Unit Tests
 * @jest-environment jsdom
 */

const { setupDOM, loadApp } = require('./setup');

beforeEach(() => {
  localStorage.clear();
  setupDOM();
  loadApp();
  ConversationStarters.clearAll();
});

describe('ConversationStarters', () => {

  test('starts empty after clearAll', () => {
    expect(ConversationStarters.getAll()).toEqual([]);
    expect(ConversationStarters.getCount()).toBe(0);
  });

  test('createFromCurrent captures system prompt + messages', () => {
    ConversationManager.addMessage('user', 'Hello');
    ConversationManager.addMessage('assistant', 'Hi there');

    const starter = ConversationStarters.createFromCurrent('Test Starter', 'A test');
    expect(starter).not.toBeNull();
    expect(starter.name).toBe('Test Starter');
    expect(starter.description).toBe('A test');
    expect(starter.messages.length).toBe(3);
    expect(starter.messages[0].role).toBe('system');
    expect(starter.messages[1].content).toBe('Hello');
    expect(starter.usageCount).toBe(0);
  });

  test('createFromCurrent returns null for empty/invalid name', () => {
    expect(ConversationStarters.createFromCurrent('')).toBeNull();
    expect(ConversationStarters.createFromCurrent(null)).toBeNull();
    expect(ConversationStarters.createFromCurrent(123)).toBeNull();
    expect(ConversationStarters.createFromCurrent('   ')).toBeNull();
  });

  test('createFromCurrent truncates long names and descriptions', () => {
    ConversationManager.addMessage('user', 'test');
    const s = ConversationStarters.createFromCurrent('A'.repeat(200), 'D'.repeat(500));
    expect(s.name.length).toBe(ConversationStarters.MAX_NAME_LENGTH);
    expect(s.description.length).toBe(ConversationStarters.MAX_DESC_LENGTH);
  });

  test('createFromCurrent respects messageCount limit', () => {
    ConversationManager.addMessage('user', 'msg1');
    ConversationManager.addMessage('assistant', 'reply1');
    ConversationManager.addMessage('user', 'msg2');

    const s = ConversationStarters.createFromCurrent('Limited', '', 2);
    expect(s.messages.length).toBe(2);
  });

  test('createFromCurrent enforces MAX_STARTERS', () => {
    for (let i = 0; i < ConversationStarters.MAX_STARTERS; i++) {
      ConversationStarters.createFromCurrent('Starter ' + i);
    }
    expect(ConversationStarters.getCount()).toBe(ConversationStarters.MAX_STARTERS);
    expect(ConversationStarters.createFromCurrent('One More')).toBeNull();
  });

  test('createFromData creates from raw object', () => {
    const s = ConversationStarters.createFromData({
      name: 'Imported',
      description: 'From import',
      messages: [
        { role: 'system', content: 'Be helpful' },
        { role: 'user', content: 'Hi' }
      ],
      model: 'gpt-4'
    });
    expect(s).not.toBeNull();
    expect(s.name).toBe('Imported');
    expect(s.model).toBe('gpt-4');
    expect(s.messages.length).toBe(2);
  });

  test('createFromData rejects invalid input', () => {
    expect(ConversationStarters.createFromData(null)).toBeNull();
    expect(ConversationStarters.createFromData({})).toBeNull();
    expect(ConversationStarters.createFromData({ name: 'X' })).toBeNull();
    expect(ConversationStarters.createFromData({ name: 'X', messages: [] })).toBeNull();
    expect(ConversationStarters.createFromData({ name: 123, messages: [{ role: 'user', content: 'hi' }] })).toBeNull();
  });

  test('createFromData limits messages to MAX_MESSAGES', () => {
    const msgs = [];
    for (let i = 0; i < 60; i++) msgs.push({ role: 'user', content: 'msg ' + i });
    const s = ConversationStarters.createFromData({ name: 'Lots', messages: msgs });
    expect(s.messages.length).toBe(ConversationStarters.MAX_MESSAGES);
  });

  test('createFromData coerces non-string content', () => {
    const s = ConversationStarters.createFromData({
      name: 'Coerce', messages: [{ role: 'user', content: 42 }]
    });
    expect(s.messages[0].content).toBe('42');
  });

  test('remove deletes a starter by id', () => {
    const s = ConversationStarters.createFromData({
      name: 'ToDelete', messages: [{ role: 'user', content: 'x' }]
    });
    expect(ConversationStarters.remove(s.id)).toBe(true);
    expect(ConversationStarters.getCount()).toBe(0);
  });

  test('remove returns false for non-existent id', () => {
    expect(ConversationStarters.remove('nope')).toBe(false);
  });

  test('rename updates starter name', () => {
    const s = ConversationStarters.createFromData({
      name: 'Old', messages: [{ role: 'user', content: 'x' }]
    });
    expect(ConversationStarters.rename(s.id, 'New')).toBe(true);
    expect(ConversationStarters.getById(s.id).name).toBe('New');
  });

  test('rename returns false for invalid input', () => {
    expect(ConversationStarters.rename('nope', 'Name')).toBe(false);
    const s = ConversationStarters.createFromData({
      name: 'X', messages: [{ role: 'user', content: 'x' }]
    });
    expect(ConversationStarters.rename(s.id, '')).toBe(false);
    expect(ConversationStarters.rename(s.id, null)).toBe(false);
  });

  test('updateDescription updates and handles null', () => {
    const s = ConversationStarters.createFromData({
      name: 'X', description: 'old', messages: [{ role: 'user', content: 'x' }]
    });
    expect(ConversationStarters.updateDescription(s.id, 'New desc')).toBe(true);
    expect(ConversationStarters.getById(s.id).description).toBe('New desc');
    ConversationStarters.updateDescription(s.id, null);
    expect(ConversationStarters.getById(s.id).description).toBe('');
    expect(ConversationStarters.updateDescription('nope', 'desc')).toBe(false);
  });

  test('search filters by name and description', () => {
    ConversationStarters.createFromData({ name: 'Code Review', messages: [{ role: 'user', content: 'x' }] });
    ConversationStarters.createFromData({
      name: 'Alpha', description: 'For debugging', messages: [{ role: 'user', content: 'x' }]
    });

    expect(ConversationStarters.search('code').length).toBe(1);
    expect(ConversationStarters.search('debug').length).toBe(1);
    expect(ConversationStarters.search('').length).toBe(2);
    expect(ConversationStarters.search(null).length).toBe(2);
  });

  test('search is case-insensitive', () => {
    ConversationStarters.createFromData({ name: 'MyTemplate', messages: [{ role: 'user', content: 'x' }] });
    expect(ConversationStarters.search('MYTEMPLATE').length).toBe(1);
  });

  test('apply loads starter messages into conversation', () => {
    const s = ConversationStarters.createFromData({
      name: 'Test',
      messages: [
        { role: 'system', content: 'Be a pirate' },
        { role: 'user', content: 'Ahoy' },
        { role: 'assistant', content: 'Yarr!' }
      ]
    });

    expect(ConversationStarters.apply(s.id)).toBe(true);
    const history = ConversationManager.getHistory();
    expect(history[0].content).toBe('Be a pirate');
    expect(history[1].content).toBe('Ahoy');
    expect(history[2].content).toBe('Yarr!');
  });

  test('apply increments usage count and sets lastUsedAt', () => {
    const s = ConversationStarters.createFromData({
      name: 'Track', messages: [{ role: 'user', content: 'x' }]
    });
    expect(s.usageCount).toBe(0);
    expect(s.lastUsedAt).toBeNull();
    ConversationStarters.apply(s.id);
    const updated = ConversationStarters.getById(s.id);
    expect(updated.usageCount).toBe(1);
    expect(updated.lastUsedAt).not.toBeNull();
  });

  test('apply returns false for non-existent id', () => {
    expect(ConversationStarters.apply('nope')).toBe(false);
  });

  test('apply handles starters without system message', () => {
    const s = ConversationStarters.createFromData({
      name: 'NoSys',
      messages: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi' }]
    });
    expect(ConversationStarters.apply(s.id)).toBe(true);
    const history = ConversationManager.getHistory();
    expect(history[0].role).toBe('system');
    expect(history[1].content).toBe('Hello');
  });

  test('duplicate creates a copy with reset stats', () => {
    const s = ConversationStarters.createFromData({
      name: 'Original', messages: [{ role: 'user', content: 'x' }]
    });
    const copy = ConversationStarters.duplicate(s.id);
    expect(copy).not.toBeNull();
    expect(copy.id).not.toBe(s.id);
    expect(copy.name).toBe('Original (copy)');
    expect(copy.usageCount).toBe(0);
    expect(ConversationStarters.getCount()).toBe(2);
  });

  test('duplicate returns null for non-existent id or at limit', () => {
    expect(ConversationStarters.duplicate('nope')).toBeNull();
    for (let i = 0; i < ConversationStarters.MAX_STARTERS; i++) {
      ConversationStarters.createFromData({ name: 'S' + i, messages: [{ role: 'user', content: 'x' }] });
    }
    expect(ConversationStarters.duplicate(ConversationStarters.getAll()[0].id)).toBeNull();
  });

  test('duplicate preserves message content independently', () => {
    const s = ConversationStarters.createFromData({
      name: 'Orig', messages: [{ role: 'user', content: 'original' }]
    });
    const copy = ConversationStarters.duplicate(s.id);
    ConversationStarters.getById(s.id).messages[0].content = 'modified';
    expect(ConversationStarters.getById(copy.id).messages[0].content).toBe('original');
  });

  test('exportAll and exportOne return valid JSON', () => {
    ConversationStarters.createFromData({ name: 'A', messages: [{ role: 'user', content: 'x' }] });
    const s = ConversationStarters.createFromData({ name: 'B', messages: [{ role: 'user', content: 'y' }] });
    expect(JSON.parse(ConversationStarters.exportAll()).length).toBe(2);
    expect(JSON.parse(ConversationStarters.exportOne(s.id)).name).toBe('B');
    expect(ConversationStarters.exportOne('nope')).toBeNull();
  });

  test('importStarters imports array and single object', () => {
    expect(ConversationStarters.importStarters(JSON.stringify([
      { name: 'I1', messages: [{ role: 'user', content: 'a' }] },
      { name: 'I2', messages: [{ role: 'user', content: 'b' }] }
    ]))).toBe(2);
    expect(ConversationStarters.importStarters(JSON.stringify(
      { name: 'I3', messages: [{ role: 'user', content: 'c' }] }
    ))).toBe(1);
    expect(ConversationStarters.getCount()).toBe(3);
  });

  test('importStarters returns 0 for invalid JSON', () => {
    expect(ConversationStarters.importStarters('not json')).toBe(0);
  });

  test('importStarters respects MAX_STARTERS', () => {
    for (let i = 0; i < ConversationStarters.MAX_STARTERS - 1; i++) {
      ConversationStarters.createFromData({ name: 'S' + i, messages: [{ role: 'user', content: 'x' }] });
    }
    const count = ConversationStarters.importStarters(JSON.stringify([
      { name: 'N1', messages: [{ role: 'user', content: 'a' }] },
      { name: 'N2', messages: [{ role: 'user', content: 'b' }] }
    ]));
    expect(count).toBe(1);
  });

  test('starters persist to localStorage', () => {
    ConversationStarters.createFromData({ name: 'Persist', messages: [{ role: 'user', content: 'x' }] });
    const stored = JSON.parse(localStorage.getItem('ac-conversation-starters'));
    expect(stored.length).toBe(1);
    expect(stored[0].name).toBe('Persist');
  });

  test('clearAll empties starters and storage', () => {
    ConversationStarters.createFromData({ name: 'X', messages: [{ role: 'user', content: 'x' }] });
    ConversationStarters.clearAll();
    expect(ConversationStarters.getCount()).toBe(0);
    expect(JSON.parse(localStorage.getItem('ac-conversation-starters'))).toEqual([]);
  });

  test('BUILT_IN has 5 starters with required fields', () => {
    expect(ConversationStarters.BUILT_IN.length).toBe(5);
    for (const bi of ConversationStarters.BUILT_IN) {
      expect(typeof bi.name).toBe('string');
      expect(bi.messages.length).toBeGreaterThanOrEqual(2);
    }
  });

  test('loadBuiltIns populates when empty, skips when not', () => {
    expect(ConversationStarters.loadBuiltIns()).toBe(5);
    expect(ConversationStarters.getCount()).toBe(5);
    // Adding one more and calling again should skip
    ConversationStarters.createFromData({ name: 'Extra', messages: [{ role: 'user', content: 'x' }] });
    expect(ConversationStarters.loadBuiltIns()).toBe(0);
  });

  test('togglePanel shows and hides panel', () => {
    ConversationStarters.init();
    ConversationStarters.togglePanel();
    expect(document.getElementById('starters-panel').style.display).toBe('block');
    ConversationStarters.togglePanel();
    expect(document.getElementById('starters-panel').style.display).toBe('none');
  });

  test('closePanel hides panel', () => {
    ConversationStarters.init();
    ConversationStarters.togglePanel();
    ConversationStarters.closePanel();
    expect(document.getElementById('starters-panel').style.display).toBe('none');
  });

  test('save dialog open/close', () => {
    ConversationStarters.init();
    ConversationStarters.openSaveDialog();
    expect(document.getElementById('starters-save-dialog').style.display).toBe('flex');
    ConversationStarters.closeSaveDialog();
    expect(document.getElementById('starters-save-dialog').style.display).toBe('none');
  });

  test('handleSave creates starter from input fields', () => {
    ConversationStarters.init();
    ConversationManager.addMessage('user', 'Hello');
    document.getElementById('starter-save-name').value = 'My Starter';
    document.getElementById('starter-save-desc').value = 'Test desc';
    expect(ConversationStarters.handleSave()).toBe(true);
    const all = ConversationStarters.getAll();
    expect(all[all.length - 1].name).toBe('My Starter');
  });

  test('handleSave returns false for empty name', () => {
    ConversationStarters.init();
    document.getElementById('starter-save-name').value = '';
    expect(ConversationStarters.handleSave()).toBe(false);
  });

  test('getById returns starter or null', () => {
    const s = ConversationStarters.createFromData({
      name: 'Find Me', messages: [{ role: 'user', content: 'x' }]
    });
    expect(ConversationStarters.getById(s.id).name).toBe('Find Me');
    expect(ConversationStarters.getById('nonexistent')).toBeNull();
  });

  test('createFromData handles missing optional fields', () => {
    const s = ConversationStarters.createFromData({
      name: 'Minimal', messages: [{ role: 'user', content: 'hi' }]
    });
    expect(s).not.toBeNull();
    expect(s.description).toBe('');
  });
});
