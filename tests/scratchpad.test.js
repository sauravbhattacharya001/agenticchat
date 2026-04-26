/**
 * @jest-environment jsdom
 */
const { setupDOM, loadApp } = require('./setup');

beforeAll(() => { setupDOM(); loadApp(); });
beforeEach(() => {
  localStorage.clear();
  // Reset scratchpad state by closing if open
  if (Scratchpad.isOpen()) Scratchpad.close();
  // Create DOM elements Scratchpad depends on
  ['scratchpad-panel', 'scratchpad-overlay', 'scratchpad-textarea',
   'scratchpad-wordcount', 'scratchpad-status', 'chat-input'].forEach(id => {
    let el = document.getElementById(id);
    if (!el) {
      el = id.includes('textarea') || id === 'chat-input'
        ? document.createElement('textarea')
        : document.createElement('div');
      el.id = id;
      document.body.appendChild(el);
    }
    if (el.tagName === 'TEXTAREA') el.value = '';
    else el.textContent = '';
    el.classList.remove('open');
  });
});

describe('Scratchpad', () => {
  describe('API surface', () => {
    test('exposes expected public methods', () => {
      expect(typeof Scratchpad.open).toBe('function');
      expect(typeof Scratchpad.close).toBe('function');
      expect(typeof Scratchpad.toggle).toBe('function');
      expect(typeof Scratchpad.copy).toBe('function');
      expect(typeof Scratchpad.insertToChat).toBe('function');
      expect(typeof Scratchpad.download).toBe('function');
      expect(typeof Scratchpad.clear).toBe('function');
      expect(typeof Scratchpad._onInput).toBe('function');
      expect(typeof Scratchpad.isOpen).toBe('function');
    });
  });

  describe('open() / close() / toggle()', () => {
    test('open sets panel and overlay to open class', () => {
      Scratchpad.open();
      expect(document.getElementById('scratchpad-panel').classList.contains('open')).toBe(true);
      expect(document.getElementById('scratchpad-overlay').classList.contains('open')).toBe(true);
      expect(Scratchpad.isOpen()).toBe(true);
    });

    test('close removes open class', () => {
      Scratchpad.open();
      Scratchpad.close();
      expect(document.getElementById('scratchpad-panel').classList.contains('open')).toBe(false);
      expect(Scratchpad.isOpen()).toBe(false);
    });

    test('toggle opens when closed', () => {
      expect(Scratchpad.isOpen()).toBe(false);
      Scratchpad.toggle();
      expect(Scratchpad.isOpen()).toBe(true);
    });

    test('toggle closes when open', () => {
      Scratchpad.open();
      Scratchpad.toggle();
      expect(Scratchpad.isOpen()).toBe(false);
    });
  });

  describe('persistence', () => {
    test('save and load round-trip through localStorage', () => {
      Scratchpad.open();
      const textarea = document.getElementById('scratchpad-textarea');
      textarea.value = 'Hello from test';
      Scratchpad.close(); // triggers save
      // Reopen should restore
      Scratchpad.open();
      expect(textarea.value).toBe('Hello from test');
    });

    test('empty scratchpad loads empty string', () => {
      localStorage.clear();
      Scratchpad.open();
      expect(document.getElementById('scratchpad-textarea').value).toBe('');
    });
  });

  describe('_onInput()', () => {
    test('updates word and char count', () => {
      Scratchpad.open();
      const textarea = document.getElementById('scratchpad-textarea');
      const countEl = document.getElementById('scratchpad-wordcount');
      textarea.value = 'hello world test';
      Scratchpad._onInput();
      expect(countEl.textContent).toContain('3 words');
      expect(countEl.textContent).toContain('16 chars');
    });

    test('zero words for empty text', () => {
      Scratchpad.open();
      const textarea = document.getElementById('scratchpad-textarea');
      const countEl = document.getElementById('scratchpad-wordcount');
      textarea.value = '';
      Scratchpad._onInput();
      expect(countEl.textContent).toContain('0 words');
      expect(countEl.textContent).toContain('0 chars');
    });

    test('single word uses singular', () => {
      Scratchpad.open();
      const textarea = document.getElementById('scratchpad-textarea');
      const countEl = document.getElementById('scratchpad-wordcount');
      textarea.value = 'hello';
      Scratchpad._onInput();
      expect(countEl.textContent).toContain('1 word ');
    });

    test('single char uses singular', () => {
      Scratchpad.open();
      const textarea = document.getElementById('scratchpad-textarea');
      const countEl = document.getElementById('scratchpad-wordcount');
      textarea.value = 'x';
      Scratchpad._onInput();
      expect(countEl.textContent).toContain('1 char');
      expect(countEl.textContent).not.toContain('chars');
    });
  });

  describe('insertToChat()', () => {
    test('inserts scratchpad text into empty chat input', () => {
      Scratchpad.open();
      const textarea = document.getElementById('scratchpad-textarea');
      const chatInput = document.getElementById('chat-input');
      textarea.value = 'test prompt';
      chatInput.value = '';
      Scratchpad.insertToChat();
      expect(chatInput.value).toBe('test prompt');
    });

    test('appends to chat input with existing text', () => {
      Scratchpad.open();
      const textarea = document.getElementById('scratchpad-textarea');
      const chatInput = document.getElementById('chat-input');
      textarea.value = 'addition';
      chatInput.value = 'existing text';
      Scratchpad.insertToChat();
      // Should contain both existing text and the addition
      expect(chatInput.value).toContain('existing text');
      expect(chatInput.value).toContain('addition');
    });

    test('does nothing when scratchpad is empty', () => {
      Scratchpad.open();
      const textarea = document.getElementById('scratchpad-textarea');
      const chatInput = document.getElementById('chat-input');
      textarea.value = '   ';
      chatInput.value = 'keep';
      Scratchpad.insertToChat();
      expect(chatInput.value).toBe('keep');
    });
  });

  describe('clear()', () => {
    test('clears textarea when confirmed', () => {
      window.confirm = jest.fn(() => true);
      Scratchpad.open();
      const textarea = document.getElementById('scratchpad-textarea');
      textarea.value = 'some notes';
      Scratchpad.clear();
      expect(textarea.value).toBe('');
      expect(window.confirm).toHaveBeenCalled();
    });

    test('does not clear when user cancels', () => {
      window.confirm = jest.fn(() => false);
      Scratchpad.open();
      const textarea = document.getElementById('scratchpad-textarea');
      textarea.value = 'some notes';
      Scratchpad.clear();
      expect(textarea.value).toBe('some notes');
    });

    test('does nothing when already empty', () => {
      window.confirm = jest.fn();
      Scratchpad.open();
      const textarea = document.getElementById('scratchpad-textarea');
      textarea.value = '';
      Scratchpad.clear();
      // confirm should not even be called for empty pad
      expect(window.confirm).not.toHaveBeenCalled();
    });
  });

  describe('copy()', () => {
    test('copies text to clipboard', async () => {
      const writeText = jest.fn(() => Promise.resolve());
      Object.assign(navigator, { clipboard: { writeText } });
      Scratchpad.open();
      document.getElementById('scratchpad-textarea').value = 'copy me';
      Scratchpad.copy();
      expect(writeText).toHaveBeenCalledWith('copy me');
    });

    test('does nothing when empty', () => {
      const writeText = jest.fn(() => Promise.resolve());
      Object.assign(navigator, { clipboard: { writeText } });
      Scratchpad.open();
      document.getElementById('scratchpad-textarea').value = '  ';
      Scratchpad.copy();
      expect(writeText).not.toHaveBeenCalled();
    });
  });
});
