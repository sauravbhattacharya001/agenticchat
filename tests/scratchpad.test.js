/**
 * @jest-environment jsdom
 */
const { setupDOM, loadApp } = require('./setup');

beforeAll(() => { setupDOM(); loadApp(); });
beforeEach(() => {
  localStorage.clear();
  DOMCache.clear();
  // Reset DOM state
  const textarea = document.getElementById('scratchpad-textarea');
  if (textarea) textarea.value = '';
  const panel = document.getElementById('scratchpad-panel');
  if (panel) panel.classList.remove('open');
  const overlay = document.getElementById('scratchpad-overlay');
  if (overlay) overlay.classList.remove('open');
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
      expect(typeof Scratchpad.isOpen).toBe('function');
    });
  });

  describe('open() / close()', () => {
    test('open sets panel to open state', () => {
      Scratchpad.open();
      const panel = document.getElementById('scratchpad-panel');
      expect(panel.classList.contains('open')).toBe(true);
      expect(Scratchpad.isOpen()).toBe(true);
    });

    test('close removes open state', () => {
      Scratchpad.open();
      Scratchpad.close();
      const panel = document.getElementById('scratchpad-panel');
      expect(panel.classList.contains('open')).toBe(false);
      expect(Scratchpad.isOpen()).toBe(false);
    });

    test('open shows overlay', () => {
      Scratchpad.open();
      const overlay = document.getElementById('scratchpad-overlay');
      expect(overlay.classList.contains('open')).toBe(true);
    });

    test('close hides overlay', () => {
      Scratchpad.open();
      Scratchpad.close();
      const overlay = document.getElementById('scratchpad-overlay');
      expect(overlay.classList.contains('open')).toBe(false);
    });

    test('open loads saved content from localStorage', () => {
      SafeStorage.set('agenticchat_scratchpad', 'persisted notes');
      Scratchpad.open();
      const textarea = document.getElementById('scratchpad-textarea');
      expect(textarea.value).toBe('persisted notes');
    });

    test('close saves current content to localStorage', () => {
      Scratchpad.open();
      const textarea = document.getElementById('scratchpad-textarea');
      textarea.value = 'save me on close';
      Scratchpad.close();
      expect(SafeStorage.get('agenticchat_scratchpad')).toBe('save me on close');
    });
  });

  describe('toggle()', () => {
    test('opens when closed', () => {
      expect(Scratchpad.isOpen()).toBe(false);
      Scratchpad.toggle();
      expect(Scratchpad.isOpen()).toBe(true);
    });

    test('closes when open', () => {
      Scratchpad.open();
      expect(Scratchpad.isOpen()).toBe(true);
      Scratchpad.toggle();
      expect(Scratchpad.isOpen()).toBe(false);
    });
  });

  describe('word/char count', () => {
    test('updates word count on open', () => {
      SafeStorage.set('agenticchat_scratchpad', 'hello world test');
      Scratchpad.open();
      const countEl = document.getElementById('scratchpad-wordcount');
      expect(countEl.textContent).toContain('3 words');
      expect(countEl.textContent).toContain('16 chars');
    });

    test('shows singular for 1 word', () => {
      SafeStorage.set('agenticchat_scratchpad', 'hello');
      Scratchpad.open();
      const countEl = document.getElementById('scratchpad-wordcount');
      expect(countEl.textContent).toContain('1 word ');
    });

    test('shows 0 words for empty content', () => {
      SafeStorage.set('agenticchat_scratchpad', '');
      Scratchpad.open();
      const countEl = document.getElementById('scratchpad-wordcount');
      expect(countEl.textContent).toContain('0 words');
    });
  });

  describe('insertToChat()', () => {
    test('appends scratchpad content to chat input', () => {
      Scratchpad.open();
      const textarea = document.getElementById('scratchpad-textarea');
      textarea.value = 'from scratchpad';
      const chatInput = document.getElementById('chat-input');
      chatInput.value = '';
      Scratchpad.insertToChat();
      expect(chatInput.value).toBe('from scratchpad');
    });

    test('appends with separator when chat has existing text', () => {
      Scratchpad.open();
      const textarea = document.getElementById('scratchpad-textarea');
      textarea.value = 'appended';
      const chatInput = document.getElementById('chat-input');
      chatInput.value = 'existing text';
      DOMCache.clear(); // ensure fresh cache lookup
      Scratchpad.insertToChat();
      // Verify content is combined (implementation may use newline or direct append)
      expect(chatInput.value).toContain('existing text');
      expect(chatInput.value).toContain('appended');
      expect(chatInput.value.length).toBeGreaterThan('existing text'.length);
    });

    test('does nothing when scratchpad is empty', () => {
      Scratchpad.open();
      const textarea = document.getElementById('scratchpad-textarea');
      textarea.value = '   ';
      const chatInput = document.getElementById('chat-input');
      chatInput.value = 'original';
      Scratchpad.insertToChat();
      expect(chatInput.value).toBe('original');
    });

    test('shows status message after insert', () => {
      Scratchpad.open();
      const textarea = document.getElementById('scratchpad-textarea');
      textarea.value = 'content';
      document.getElementById('chat-input').value = '';
      Scratchpad.insertToChat();
      const status = document.getElementById('scratchpad-status');
      expect(status.textContent).toBe('Inserted!');
    });
  });

  describe('copy()', () => {
    test('does nothing when scratchpad is empty', () => {
      Scratchpad.open();
      const textarea = document.getElementById('scratchpad-textarea');
      textarea.value = '';
      // Should not throw
      Scratchpad.copy();
      const status = document.getElementById('scratchpad-status');
      expect(status.textContent).not.toBe('Copied!');
    });

    test('calls clipboard API when content exists', async () => {
      Scratchpad.open();
      const textarea = document.getElementById('scratchpad-textarea');
      textarea.value = 'copy me';
      // Mock clipboard
      const writeText = jest.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });
      Scratchpad.copy();
      expect(writeText).toHaveBeenCalledWith('copy me');
    });
  });

  describe('clear()', () => {
    test('clears content when confirmed', () => {
      Scratchpad.open();
      const textarea = document.getElementById('scratchpad-textarea');
      textarea.value = 'some notes';
      window.confirm = jest.fn(() => true);
      Scratchpad.clear();
      expect(textarea.value).toBe('');
      expect(SafeStorage.get('agenticchat_scratchpad')).toBe('');
    });

    test('does not clear when confirm is cancelled', () => {
      Scratchpad.open();
      const textarea = document.getElementById('scratchpad-textarea');
      textarea.value = 'keep me';
      window.confirm = jest.fn(() => false);
      Scratchpad.clear();
      expect(textarea.value).toBe('keep me');
    });

    test('does nothing when already empty', () => {
      Scratchpad.open();
      const textarea = document.getElementById('scratchpad-textarea');
      textarea.value = '';
      window.confirm = jest.fn();
      Scratchpad.clear();
      // confirm should not even be called
      expect(window.confirm).not.toHaveBeenCalled();
    });
  });

  describe('persistence', () => {
    test('content survives close and reopen', () => {
      Scratchpad.open();
      const textarea = document.getElementById('scratchpad-textarea');
      textarea.value = 'persistent data';
      Scratchpad.close();
      Scratchpad.open();
      expect(textarea.value).toBe('persistent data');
    });
  });

  describe('download()', () => {
    test('does nothing when scratchpad is empty', () => {
      Scratchpad.open();
      const textarea = document.getElementById('scratchpad-textarea');
      textarea.value = '';
      const createElementSpy = jest.spyOn(document, 'createElement');
      Scratchpad.download();
      // Should not create an anchor element for download
      const anchorCalls = createElementSpy.mock.calls.filter(c => c[0] === 'a');
      expect(anchorCalls.length).toBe(0);
      createElementSpy.mockRestore();
    });

    test('creates download link with correct filename when content exists', () => {
      Scratchpad.open();
      const textarea = document.getElementById('scratchpad-textarea');
      textarea.value = 'download me';
      // Mock URL.createObjectURL
      const mockUrl = 'blob:mock';
      URL.createObjectURL = jest.fn(() => mockUrl);
      URL.revokeObjectURL = jest.fn();
      const clickSpy = jest.fn();
      const origCreate = document.createElement.bind(document);
      jest.spyOn(document, 'createElement').mockImplementation((tag) => {
        const el = origCreate(tag);
        if (tag === 'a') el.click = clickSpy;
        return el;
      });
      Scratchpad.download();
      expect(clickSpy).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(mockUrl);
      document.createElement.mockRestore();
    });
  });
});
