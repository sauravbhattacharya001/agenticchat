/**
 * @jest-environment jsdom
 */
const { setupDOM, loadApp } = require('./setup');

beforeEach(() => {
  localStorage.clear();
  setupDOM();
  loadApp();
  if (typeof PromptLibrary !== 'undefined' && PromptLibrary.init) {
    PromptLibrary.init();
  }
});

afterEach(() => {
  localStorage.clear();
});

describe('PromptLibrary', () => {
  test('module exists with expected API', () => {
    expect(PromptLibrary).toBeDefined();
    expect(typeof PromptLibrary.addPrompt).toBe('function');
    expect(typeof PromptLibrary.deletePrompt).toBe('function');
    expect(typeof PromptLibrary.usePrompt).toBe('function');
    expect(typeof PromptLibrary.getAll).toBe('function');
    expect(typeof PromptLibrary.toggle).toBe('function');
    expect(typeof PromptLibrary.importPrompts).toBe('function');
    expect(typeof PromptLibrary.exportPrompts).toBe('function');
  });

  test('addPrompt creates a prompt with correct fields', () => {
    const p = PromptLibrary.addPrompt('Test Prompt', 'Hello world', 'Work');
    expect(p).not.toBeNull();
    expect(p.name).toBe('Test Prompt');
    expect(p.text).toBe('Hello world');
    expect(p.folder).toBe('Work');
    expect(p.id).toBeDefined();
    expect(p.createdAt).toBeGreaterThan(0);
    expect(p.useCount).toBe(0);
    expect(p.lastUsedAt).toBeNull();
  });

  test('addPrompt rejects empty name or text', () => {
    expect(PromptLibrary.addPrompt('', 'text')).toBeNull();
    expect(PromptLibrary.addPrompt('name', '')).toBeNull();
    expect(PromptLibrary.addPrompt('', '')).toBeNull();
  });

  test('addPrompt trims whitespace', () => {
    const p = PromptLibrary.addPrompt('  Trimmed  ', '  content  ', '  Folder  ');
    expect(p.name).toBe('Trimmed');
    expect(p.text).toBe('content');
    expect(p.folder).toBe('Folder');
  });

  test('addPrompt with empty folder sets null', () => {
    const p = PromptLibrary.addPrompt('Name', 'Text', '');
    expect(p.folder).toBeNull();
  });

  test('getAll returns all added prompts', () => {
    PromptLibrary.addPrompt('A', 'a text');
    PromptLibrary.addPrompt('B', 'b text', 'Work');
    PromptLibrary.addPrompt('C', 'c text', 'Personal');
    const all = PromptLibrary.getAll();
    expect(all).toHaveLength(3);
  });

  test('getById returns correct prompt', () => {
    const p = PromptLibrary.addPrompt('Find Me', 'findable');
    const found = PromptLibrary.getById(p.id);
    expect(found).not.toBeNull();
    expect(found.name).toBe('Find Me');
  });

  test('getById returns null for unknown id', () => {
    expect(PromptLibrary.getById('nonexistent')).toBeNull();
  });

  test('updatePrompt modifies fields', () => {
    const p = PromptLibrary.addPrompt('Original', 'original text', 'Old');
    const updated = PromptLibrary.updatePrompt(p.id, {
      name: 'Updated',
      text: 'new text',
      folder: 'New'
    });
    expect(updated.name).toBe('Updated');
    expect(updated.text).toBe('new text');
    expect(updated.folder).toBe('New');
  });

  test('updatePrompt returns null for unknown id', () => {
    expect(PromptLibrary.updatePrompt('nope', { name: 'x' })).toBeNull();
  });

  test('deletePrompt removes prompt', () => {
    const p = PromptLibrary.addPrompt('Delete Me', 'bye');
    expect(PromptLibrary.getAll()).toHaveLength(1);
    const result = PromptLibrary.deletePrompt(p.id);
    expect(result).toBe(true);
    expect(PromptLibrary.getAll()).toHaveLength(0);
  });

  test('deletePrompt returns false for unknown id', () => {
    PromptLibrary.addPrompt('Keep', 'stay');
    expect(PromptLibrary.deletePrompt('nope')).toBe(false);
    expect(PromptLibrary.getAll()).toHaveLength(1);
  });

  test('usePrompt increments count and sets lastUsedAt', () => {
    const p = PromptLibrary.addPrompt('Use Me', 'prompt text');
    expect(p.useCount).toBe(0);
    const used = PromptLibrary.usePrompt(p.id);
    expect(used.useCount).toBe(1);
    expect(used.lastUsedAt).toBeGreaterThan(0);
  });

  test('usePrompt inserts text into chat input', () => {
    const p = PromptLibrary.addPrompt('Insert', 'Hello AI!');
    PromptLibrary.open();
    PromptLibrary.usePrompt(p.id);
    const input = document.getElementById('chat-input');
    expect(input.value).toBe('Hello AI!');
  });

  test('usePrompt returns null for unknown id', () => {
    expect(PromptLibrary.usePrompt('nope')).toBeNull();
  });

  test('open and close toggle visibility', () => {
    expect(PromptLibrary.isOpen()).toBe(false);
    PromptLibrary.open();
    expect(PromptLibrary.isOpen()).toBe(true);
    PromptLibrary.close();
    expect(PromptLibrary.isOpen()).toBe(false);
  });

  test('toggle switches state', () => {
    PromptLibrary.toggle();
    expect(PromptLibrary.isOpen()).toBe(true);
    PromptLibrary.toggle();
    expect(PromptLibrary.isOpen()).toBe(false);
  });

  test('clearAll removes all prompts', () => {
    PromptLibrary.addPrompt('A', 'a');
    PromptLibrary.addPrompt('B', 'b');
    expect(PromptLibrary.getAll()).toHaveLength(2);
    PromptLibrary.clearAll();
    expect(PromptLibrary.getAll()).toHaveLength(0);
  });

  test('exportPrompts returns valid JSON', () => {
    // Mock URL.createObjectURL for jsdom
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');
    global.URL.revokeObjectURL = jest.fn();
    PromptLibrary.addPrompt('Export', 'export text', 'Work');
    const json = PromptLibrary.exportPrompts();
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('Export');
  });

  test('importPrompts adds new prompts', () => {
    const data = JSON.stringify([
      { id: 'imp1', name: 'Imported', text: 'imported text', folder: 'External' },
      { id: 'imp2', name: 'Imported 2', text: 'more text' }
    ]);
    const added = PromptLibrary.importPrompts(data);
    expect(added).toBe(2);
    expect(PromptLibrary.getAll()).toHaveLength(2);
  });

  test('importPrompts skips invalid entries', () => {
    const data = JSON.stringify([
      { id: 'ok', name: 'Valid', text: 'ok' },
      { id: 'bad', name: '', text: '' },
      { name: 'NoText' }
    ]);
    const added = PromptLibrary.importPrompts(data);
    expect(added).toBe(1);
  });

  test('importPrompts returns -1 for invalid JSON', () => {
    expect(PromptLibrary.importPrompts('not json')).toBe(-1);
  });

  test('importPrompts returns 0 for non-array JSON', () => {
    expect(PromptLibrary.importPrompts('{"a":1}')).toBe(0);
  });

  test('importPrompts updates existing prompts by id', () => {
    const p = PromptLibrary.addPrompt('Original', 'original');
    const data = JSON.stringify([
      { id: p.id, name: 'Updated via Import', text: 'updated text' }
    ]);
    const added = PromptLibrary.importPrompts(data);
    expect(added).toBe(0); // updated, not added
    const updated = PromptLibrary.getById(p.id);
    expect(updated.name).toBe('Updated via Import');
  });

  test('persistence across load cycles', () => {
    PromptLibrary.addPrompt('Persist', 'persisted');
    // Simulate reload
    setupDOM();
    loadApp();
    if (typeof PromptLibrary !== 'undefined' && PromptLibrary.init) {
      PromptLibrary.init();
    }
    const all = PromptLibrary.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Persist');
  });

  test('save modal opens and closes', () => {
    PromptLibrary.openSaveModal('prefilled text');
    const modal = document.getElementById('prompt-library-save-modal');
    expect(modal.style.display).not.toBe('none');
    const textInput = document.getElementById('prompt-library-text-input');
    expect(textInput.value).toBe('prefilled text');
    PromptLibrary.closeSaveModal();
    expect(modal.style.display).toBe('none');
  });

  test('confirmSave creates prompt from modal inputs', () => {
    PromptLibrary.openSaveModal();
    document.getElementById('prompt-library-name-input').value = 'From Modal';
    document.getElementById('prompt-library-text-input').value = 'modal text';
    document.getElementById('prompt-library-folder-input').value = 'Testing';
    const result = PromptLibrary.confirmSave();
    expect(result).not.toBeNull();
    expect(result.name).toBe('From Modal');
    expect(result.folder).toBe('Testing');
    expect(PromptLibrary.getAll()).toHaveLength(1);
  });

  test('confirmSave returns null if name or text empty', () => {
    PromptLibrary.openSaveModal();
    document.getElementById('prompt-library-name-input').value = '';
    document.getElementById('prompt-library-text-input').value = '';
    expect(PromptLibrary.confirmSave()).toBeNull();
  });

  test('edit modal populates with existing prompt data', () => {
    const p = PromptLibrary.addPrompt('Editable', 'edit me', 'Dev');
    PromptLibrary.openEditModal(p.id);
    expect(document.getElementById('prompt-library-name-input').value).toBe('Editable');
    expect(document.getElementById('prompt-library-text-input').value).toBe('edit me');
    expect(document.getElementById('prompt-library-folder-input').value).toBe('Dev');
    expect(document.getElementById('prompt-library-modal-title').textContent).toBe('Edit Prompt');
  });

  test('confirmSave in edit mode updates existing prompt', () => {
    const p = PromptLibrary.addPrompt('Before', 'before text');
    PromptLibrary.openEditModal(p.id);
    document.getElementById('prompt-library-name-input').value = 'After';
    document.getElementById('prompt-library-text-input').value = 'after text';
    PromptLibrary.confirmSave();
    const updated = PromptLibrary.getById(p.id);
    expect(updated.name).toBe('After');
    expect(updated.text).toBe('after text');
    expect(PromptLibrary.getAll()).toHaveLength(1);
  });

  test('saveCurrentInput prefills modal with chat input value', () => {
    document.getElementById('chat-input').value = 'My current prompt';
    PromptLibrary.saveCurrentInput();
    expect(document.getElementById('prompt-library-text-input').value).toBe('My current prompt');
  });

  test('multiple usePrompt calls accumulate count', () => {
    const p = PromptLibrary.addPrompt('Counter', 'count me');
    PromptLibrary.usePrompt(p.id);
    PromptLibrary.usePrompt(p.id);
    PromptLibrary.usePrompt(p.id);
    const result = PromptLibrary.getById(p.id);
    expect(result.useCount).toBe(3);
  });

  test('rendering shows correct count text', () => {
    PromptLibrary.addPrompt('A', 'a');
    PromptLibrary.addPrompt('B', 'b');
    PromptLibrary.open();
    const count = document.getElementById('prompt-library-count');
    expect(count.textContent).toBe('2 prompts');
  });

  test('rendering shows singular for 1 prompt', () => {
    PromptLibrary.addPrompt('Solo', 'solo');
    PromptLibrary.open();
    expect(document.getElementById('prompt-library-count').textContent).toBe('1 prompt');
  });

  test('rendering shows items in the list', () => {
    PromptLibrary.addPrompt('Visible', 'visible text', 'Work');
    PromptLibrary.open();
    const list = document.getElementById('prompt-library-list');
    expect(list.querySelectorAll('.prompt-library-item')).toHaveLength(1);
    expect(list.textContent).toContain('Visible');
    expect(list.textContent).toContain('Work');
  });

  test('search filters prompts', () => {
    PromptLibrary.addPrompt('Alpha', 'alpha text');
    PromptLibrary.addPrompt('Beta', 'beta text');
    PromptLibrary.open();
    const search = document.getElementById('prompt-library-search');
    search.value = 'alpha';
    search.dispatchEvent(new Event('input'));
    const list = document.getElementById('prompt-library-list');
    expect(list.querySelectorAll('.prompt-library-item')).toHaveLength(1);
  });

  test('folder filter works', () => {
    PromptLibrary.addPrompt('Work1', 'w1', 'Work');
    PromptLibrary.addPrompt('Fun1', 'f1', 'Fun');
    PromptLibrary.open();
    const filter = document.getElementById('prompt-library-folder-filter');
    filter.value = 'Work';
    filter.dispatchEvent(new Event('change'));
    const list = document.getElementById('prompt-library-list');
    expect(list.querySelectorAll('.prompt-library-item')).toHaveLength(1);
    expect(list.textContent).toContain('Work1');
  });

  test('empty state shows helpful message', () => {
    PromptLibrary.open();
    const list = document.getElementById('prompt-library-list');
    expect(list.textContent).toContain('No prompts yet');
  });
});
