/**
 * Tests for Scratchpad, PersonaPresets, QuickReplies, FocusMode,
 * ModelSelector, and FileDropZone — six modules with zero prior coverage.
 */
const { setupDOM, loadApp } = require('./setup');

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
  setupDOM();
  loadApp();
});

// ══════════════════════════════════════════════════════════════════════
// Scratchpad
// ══════════════════════════════════════════════════════════════════════
describe('Scratchpad', () => {
  describe('open / close / toggle', () => {
    test('open adds "open" class to panel and overlay', () => {
      Scratchpad.open();
      expect(document.getElementById('scratchpad-panel').classList.contains('open')).toBe(true);
      expect(document.getElementById('scratchpad-overlay').classList.contains('open')).toBe(true);
    });

    test('close removes "open" class', () => {
      Scratchpad.open();
      Scratchpad.close();
      expect(document.getElementById('scratchpad-panel').classList.contains('open')).toBe(false);
      expect(document.getElementById('scratchpad-overlay').classList.contains('open')).toBe(false);
    });

    test('toggle opens when closed', () => {
      expect(Scratchpad.isOpen()).toBe(false);
      Scratchpad.toggle();
      expect(Scratchpad.isOpen()).toBe(true);
    });

    test('toggle closes when open', () => {
      Scratchpad.open();
      expect(Scratchpad.isOpen()).toBe(true);
      Scratchpad.toggle();
      expect(Scratchpad.isOpen()).toBe(false);
    });

    test('isOpen reflects current state', () => {
      expect(Scratchpad.isOpen()).toBe(false);
      Scratchpad.open();
      expect(Scratchpad.isOpen()).toBe(true);
      Scratchpad.close();
      expect(Scratchpad.isOpen()).toBe(false);
    });
  });

  describe('persistence', () => {
    test('saves textarea content to localStorage on close', () => {
      Scratchpad.open();
      document.getElementById('scratchpad-textarea').value = 'some notes';
      Scratchpad.close();
      expect(localStorage.getItem('agenticchat_scratchpad')).toBe('some notes');
    });

    test('restores content from localStorage on open', () => {
      localStorage.setItem('agenticchat_scratchpad', 'saved stuff');
      Scratchpad.open();
      expect(document.getElementById('scratchpad-textarea').value).toBe('saved stuff');
    });

    test('handles missing localStorage gracefully', () => {
      Scratchpad.open();
      expect(document.getElementById('scratchpad-textarea').value).toBe('');
    });
  });

  describe('word count', () => {
    test('_onInput updates word and char count', () => {
      Scratchpad.open();
      const textarea = document.getElementById('scratchpad-textarea');
      const countEl = document.getElementById('scratchpad-wordcount');
      textarea.value = 'hello world';
      Scratchpad._onInput();
      expect(countEl.textContent).toBe('2 words · 11 chars');
    });

    test('empty text shows 0 words', () => {
      Scratchpad.open();
      document.getElementById('scratchpad-textarea').value = '';
      Scratchpad._onInput();
      expect(document.getElementById('scratchpad-wordcount').textContent).toBe('0 words · 0 chars');
    });

    test('single word shows singular form', () => {
      Scratchpad.open();
      document.getElementById('scratchpad-textarea').value = 'hello';
      Scratchpad._onInput();
      expect(document.getElementById('scratchpad-wordcount').textContent).toContain('1 word');
    });

    test('single char shows singular form', () => {
      Scratchpad.open();
      document.getElementById('scratchpad-textarea').value = 'x';
      Scratchpad._onInput();
      expect(document.getElementById('scratchpad-wordcount').textContent).toContain('1 char');
    });
  });

  describe('copy', () => {
    test('copies text to clipboard', async () => {
      Scratchpad.open();
      document.getElementById('scratchpad-textarea').value = 'copy me';
      const writeText = jest.fn().mockResolvedValue();
      Object.assign(navigator, { clipboard: { writeText } });
      Scratchpad.copy();
      expect(writeText).toHaveBeenCalledWith('copy me');
    });

    test('does nothing when textarea is empty', () => {
      Scratchpad.open();
      document.getElementById('scratchpad-textarea').value = '';
      const writeText = jest.fn().mockResolvedValue();
      Object.assign(navigator, { clipboard: { writeText } });
      Scratchpad.copy();
      expect(writeText).not.toHaveBeenCalled();
    });

    test('does nothing when textarea has only whitespace', () => {
      Scratchpad.open();
      document.getElementById('scratchpad-textarea').value = '   ';
      const writeText = jest.fn().mockResolvedValue();
      Object.assign(navigator, { clipboard: { writeText } });
      Scratchpad.copy();
      expect(writeText).not.toHaveBeenCalled();
    });
  });

  describe('insertToChat', () => {
    test('inserts scratchpad text into chat input', () => {
      Scratchpad.open();
      document.getElementById('scratchpad-textarea').value = 'notes here';
      document.getElementById('chat-input').value = '';
      Scratchpad.insertToChat();
      expect(document.getElementById('chat-input').value).toBe('notes here');
    });

    test('appends scratchpad text to existing chat input', () => {
      Scratchpad.open();
      const textarea = document.getElementById('scratchpad-textarea');
      const chatInput = document.getElementById('chat-input');
      textarea.value = 'more notes';
      chatInput.value = 'existing';
      Scratchpad.insertToChat();
      // <input type=text> sanitizes newlines per HTML spec, so the
      // separator '\n' is stripped. The content is still concatenated.
      const result = chatInput.value;
      expect(result).toContain('existing');
      expect(result).toContain('more notes');
    });

    test('does nothing when scratchpad is empty', () => {
      Scratchpad.open();
      document.getElementById('scratchpad-textarea').value = '';
      document.getElementById('chat-input').value = 'keep this';
      Scratchpad.insertToChat();
      expect(document.getElementById('chat-input').value).toBe('keep this');
    });

    test('shows status message after insertion', () => {
      Scratchpad.open();
      document.getElementById('scratchpad-textarea').value = 'insert me';
      document.getElementById('chat-input').value = '';
      Scratchpad.insertToChat();
      expect(document.getElementById('scratchpad-status').textContent).toBe('Inserted!');
    });
  });

  describe('clear', () => {
    test('clears textarea when user confirms', () => {
      Scratchpad.open();
      document.getElementById('scratchpad-textarea').value = 'some content';
      jest.spyOn(window, 'confirm').mockReturnValue(true);
      Scratchpad.clear();
      expect(document.getElementById('scratchpad-textarea').value).toBe('');
      expect(localStorage.getItem('agenticchat_scratchpad')).toBe('');
    });

    test('does not clear when user cancels', () => {
      Scratchpad.open();
      document.getElementById('scratchpad-textarea').value = 'keep me';
      jest.spyOn(window, 'confirm').mockReturnValue(false);
      Scratchpad.clear();
      expect(document.getElementById('scratchpad-textarea').value).toBe('keep me');
    });

    test('does nothing when textarea is already empty', () => {
      Scratchpad.open();
      document.getElementById('scratchpad-textarea').value = '';
      const confirmSpy = jest.spyOn(window, 'confirm');
      Scratchpad.clear();
      expect(confirmSpy).not.toHaveBeenCalled();
    });
  });

  describe('download', () => {
    test('creates and clicks download link', () => {
      Scratchpad.open();
      document.getElementById('scratchpad-textarea').value = 'download me';

      const revokeObjectURL = jest.fn();
      const createObjectURL = jest.fn().mockReturnValue('blob:test');
      globalThis.URL.createObjectURL = createObjectURL;
      globalThis.URL.revokeObjectURL = revokeObjectURL;

      const clickSpy = jest.fn();
      const origCreateElement = document.createElement.bind(document);
      jest.spyOn(document, 'createElement').mockImplementation((tag) => {
        const el = origCreateElement(tag);
        if (tag === 'a') el.click = clickSpy;
        return el;
      });

      Scratchpad.download();
      expect(createObjectURL).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
    });

    test('does nothing when textarea is empty', () => {
      Scratchpad.open();
      document.getElementById('scratchpad-textarea').value = '';
      const createObjectURL = jest.fn();
      globalThis.URL.createObjectURL = createObjectURL;
      Scratchpad.download();
      expect(createObjectURL).not.toHaveBeenCalled();
    });
  });

  describe('auto-save debounce', () => {
    test('_onInput triggers debounced save', () => {
      jest.useFakeTimers();
      Scratchpad.open();
      document.getElementById('scratchpad-textarea').value = 'auto saved';
      Scratchpad._onInput();
      // Not saved yet (debounced)
      expect(localStorage.getItem('agenticchat_scratchpad')).not.toBe('auto saved');
      jest.advanceTimersByTime(300);
      expect(localStorage.getItem('agenticchat_scratchpad')).toBe('auto saved');
      jest.useRealTimers();
    });

    test('multiple rapid inputs only save once', () => {
      jest.useFakeTimers();
      Scratchpad.open();
      const textarea = document.getElementById('scratchpad-textarea');
      textarea.value = 'first';
      Scratchpad._onInput();
      textarea.value = 'second';
      Scratchpad._onInput();
      textarea.value = 'third';
      Scratchpad._onInput();
      jest.advanceTimersByTime(300);
      expect(localStorage.getItem('agenticchat_scratchpad')).toBe('third');
      jest.useRealTimers();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════
// PersonaPresets
// ══════════════════════════════════════════════════════════════════════
describe('PersonaPresets', () => {
  describe('open / close / toggle', () => {
    test('open adds "open" class and renders presets', () => {
      PersonaPresets.open();
      expect(document.getElementById('persona-panel').classList.contains('open')).toBe(true);
      expect(document.getElementById('persona-overlay').classList.contains('open')).toBe(true);
      // Should render preset cards
      const list = document.getElementById('persona-list');
      expect(list.querySelectorAll('.persona-card').length).toBeGreaterThan(0);
    });

    test('close removes "open" class', () => {
      PersonaPresets.open();
      PersonaPresets.close();
      expect(document.getElementById('persona-panel').classList.contains('open')).toBe(false);
      expect(document.getElementById('persona-overlay').classList.contains('open')).toBe(false);
    });

    test('toggle opens when closed and vice versa', () => {
      expect(PersonaPresets.isOpen()).toBe(false);
      PersonaPresets.toggle();
      expect(PersonaPresets.isOpen()).toBe(true);
      PersonaPresets.toggle();
      expect(PersonaPresets.isOpen()).toBe(false);
    });
  });

  describe('preset selection', () => {
    test('default active preset is Code Generator', () => {
      PersonaPresets.open();
      const active = document.getElementById('persona-active');
      expect(active.textContent).toContain('Code Generator');
    });

    test('selecting a preset updates active display', () => {
      PersonaPresets.open();
      // Click the analyst card
      const cards = document.querySelectorAll('.persona-card');
      const analystCard = Array.from(cards).find(c => c.textContent.includes('Data Analyst'));
      expect(analystCard).toBeDefined();
      analystCard.click();
      expect(document.getElementById('persona-active').textContent).toContain('Data Analyst');
    });

    test('selected preset changes system prompt', () => {
      PersonaPresets.open();
      const cards = document.querySelectorAll('.persona-card');
      const gameCard = Array.from(cards).find(c => c.textContent.includes('Game Developer'));
      gameCard.click();
      const msgs = ConversationManager.getMessages();
      expect(msgs[0].content).toContain('game');
    });

    test('selected preset persists to localStorage', () => {
      PersonaPresets.open();
      const cards = document.querySelectorAll('.persona-card');
      const teacherCard = Array.from(cards).find(c => c.textContent.includes('Code Teacher'));
      teacherCard.click();
      const saved = JSON.parse(localStorage.getItem('agenticchat_persona'));
      expect(saved.id).toBe('teacher');
    });
  });

  describe('custom persona', () => {
    test('applyCustom with text saves custom persona', () => {
      PersonaPresets.open();
      document.getElementById('persona-custom-input').value = 'You are a pirate.';
      PersonaPresets.applyCustom();
      const saved = JSON.parse(localStorage.getItem('agenticchat_persona'));
      expect(saved.id).toBe('custom');
      expect(saved.prompt).toBe('You are a pirate.');
    });

    test('applyCustom with empty text does nothing', () => {
      PersonaPresets.open();
      document.getElementById('persona-custom-input').value = '';
      PersonaPresets.applyCustom();
      const saved = localStorage.getItem('agenticchat_persona');
      expect(saved).toBeNull();
    });

    test('custom persona shows "Custom Prompt" in active', () => {
      PersonaPresets.open();
      document.getElementById('persona-custom-input').value = 'Custom prompt';
      PersonaPresets.applyCustom();
      expect(document.getElementById('persona-active').textContent).toContain('Custom Prompt');
    });

    test('custom persona applies to system prompt', () => {
      PersonaPresets.open();
      document.getElementById('persona-custom-input').value = 'You are a poet.';
      PersonaPresets.applyCustom();
      const msgs = ConversationManager.getMessages();
      expect(msgs[0].content).toBe('You are a poet.');
    });
  });

  describe('init', () => {
    test('init restores saved persona on startup', () => {
      localStorage.setItem('agenticchat_persona', JSON.stringify({ id: 'minimal' }));
      // Re-init
      setupDOM();
      loadApp();
      PersonaPresets.init();
      const msgs = ConversationManager.getMessages();
      expect(msgs[0].content).toContain('minimalist');
    });

    test('init defaults to ChatConfig.SYSTEM_PROMPT when no saved persona', () => {
      PersonaPresets.init();
      const msgs = ConversationManager.getMessages();
      expect(msgs[0].content).toBe(ChatConfig.SYSTEM_PROMPT);
    });
  });

  describe('render', () => {
    test('renders all presets plus custom card', () => {
      PersonaPresets.open();
      const cards = document.querySelectorAll('.persona-card');
      // 7 presets + 1 custom = 8
      expect(cards.length).toBe(8);
    });

    test('active card has "active" class', () => {
      PersonaPresets.open();
      const activeCards = document.querySelectorAll('.persona-card.active');
      expect(activeCards.length).toBe(1);
    });

    test('active card shows checkmark', () => {
      PersonaPresets.open();
      const activeCard = document.querySelector('.persona-card.active');
      expect(activeCard.textContent).toContain('✓');
    });
  });
});

// ══════════════════════════════════════════════════════════════════════
// QuickReplies
// ══════════════════════════════════════════════════════════════════════
describe('QuickReplies', () => {
  describe('show', () => {
    test('shows error suggestions when hadError is true', () => {
      QuickReplies.show('some error', false, true);
      const container = document.getElementById('quick-replies');
      expect(container.style.display).toBe('flex');
      const chips = container.querySelectorAll('.quick-reply-chip');
      expect(chips.length).toBe(3); // 3 error suggestions
      // Should contain error-specific labels
      const labels = Array.from(chips).map(c => c.textContent);
      expect(labels.some(l => l.includes('Fix'))).toBe(true);
    });

    test('shows text suggestions for non-code replies', () => {
      QuickReplies.show('here is my explanation', false, false);
      const chips = document.querySelectorAll('.quick-reply-chip');
      expect(chips.length).toBe(4); // 4 text suggestions
      const labels = Array.from(chips).map(c => c.textContent);
      expect(labels.some(l => l.includes('deeper'))).toBe(true);
    });

    test('shows 4 random code suggestions for code replies', () => {
      QuickReplies.show('```js\nconsole.log("hello");\n```', true, false);
      const chips = document.querySelectorAll('.quick-reply-chip');
      expect(chips.length).toBe(4); // picks 4 from 8
    });

    test('chips have title with full prompt text', () => {
      QuickReplies.show('text reply', false, false);
      const chip = document.querySelector('.quick-reply-chip');
      expect(chip.title.length).toBeGreaterThan(0);
    });

    test('clicking a chip inserts prompt into chat input', () => {
      QuickReplies.show('text reply', false, false);
      const chip = document.querySelector('.quick-reply-chip');
      const expectedPrompt = chip.title;
      chip.click();
      expect(document.getElementById('chat-input').value).toBe(expectedPrompt);
    });

    test('clicking a chip hides the container', () => {
      QuickReplies.show('text reply', false, false);
      const chip = document.querySelector('.quick-reply-chip');
      chip.click();
      expect(document.getElementById('quick-replies').style.display).toBe('none');
    });
  });

  describe('hide', () => {
    test('hides the container and clears chips', () => {
      QuickReplies.show('hello', false, false);
      QuickReplies.hide();
      const container = document.getElementById('quick-replies');
      expect(container.style.display).toBe('none');
      expect(container.innerHTML).toBe('');
    });

    test('does not throw when container is missing', () => {
      document.getElementById('quick-replies').remove();
      expect(() => QuickReplies.hide()).not.toThrow();
    });
  });

  describe('error suggestions priority', () => {
    test('error suggestions take priority over code suggestions', () => {
      QuickReplies.show('code with error', true, true);
      const chips = document.querySelectorAll('.quick-reply-chip');
      expect(chips.length).toBe(3); // error suggestions, not code
      const labels = Array.from(chips).map(c => c.textContent);
      expect(labels.some(l => l.includes('Fix'))).toBe(true);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════
// FocusMode
// ══════════════════════════════════════════════════════════════════════
describe('FocusMode', () => {
  describe('toggle', () => {
    test('activates focus mode and adds zen-mode class', () => {
      FocusMode.toggle();
      expect(document.body.classList.contains('zen-mode')).toBe(true);
      expect(FocusMode.isActive()).toBe(true);
    });

    test('deactivates focus mode on second toggle', () => {
      FocusMode.toggle();
      FocusMode.toggle();
      expect(document.body.classList.contains('zen-mode')).toBe(false);
      expect(FocusMode.isActive()).toBe(false);
    });

    test('returns new state', () => {
      const state1 = FocusMode.toggle();
      expect(state1).toBe(true);
      const state2 = FocusMode.toggle();
      expect(state2).toBe(false);
    });
  });

  describe('persistence', () => {
    test('saves state to localStorage', () => {
      FocusMode.toggle();
      expect(localStorage.getItem('ac-focus-mode')).toBe('true');
      FocusMode.toggle();
      expect(localStorage.getItem('ac-focus-mode')).toBe('false');
    });

    test('restores from localStorage on load', () => {
      localStorage.setItem('ac-focus-mode', 'true');
      setupDOM();
      loadApp();
      expect(FocusMode.isActive()).toBe(true);
      // apply() is called during init(), which DOMContentLoaded triggers;
      // in tests DOMContentLoaded is suppressed, so call init() manually
      FocusMode.init();
      expect(document.body.classList.contains('zen-mode')).toBe(true);
    });
  });

  describe('zen button', () => {
    test('toggle updates button active class', () => {
      FocusMode.toggle();
      const btn = document.getElementById('zen-btn');
      expect(btn.classList.contains('active')).toBe(true);
    });

    test('toggle updates button title', () => {
      const btn = document.getElementById('zen-btn');
      FocusMode.toggle();
      expect(btn.title).toContain('Exit');
      FocusMode.toggle();
      expect(btn.title).toContain('hide distractions');
    });
  });

  describe('keyboard shortcut', () => {
    test('Ctrl+Shift+F toggles focus mode', () => {
      FocusMode.init();
      const event = new KeyboardEvent('keydown', {
        key: 'F', ctrlKey: true, shiftKey: true, bubbles: true
      });
      document.dispatchEvent(event);
      expect(FocusMode.isActive()).toBe(true);
    });

    test('Escape exits focus mode when active', () => {
      FocusMode.init();
      FocusMode.toggle(); // activate
      expect(FocusMode.isActive()).toBe(true);
      const event = new KeyboardEvent('keydown', {
        key: 'Escape', bubbles: true
      });
      document.dispatchEvent(event);
      expect(FocusMode.isActive()).toBe(false);
    });

    test('Escape does not toggle when focus mode is not active', () => {
      FocusMode.init();
      expect(FocusMode.isActive()).toBe(false);
      const event = new KeyboardEvent('keydown', {
        key: 'Escape', bubbles: true
      });
      document.dispatchEvent(event);
      expect(FocusMode.isActive()).toBe(false);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════
// ModelSelector
// ══════════════════════════════════════════════════════════════════════
describe('ModelSelector', () => {
  describe('toggle', () => {
    test('opens panel on first toggle', () => {
      ModelSelector.toggle();
      const panel = document.getElementById('model-panel');
      expect(panel.style.display).toBe('block');
    });

    test('closes panel on second toggle', () => {
      ModelSelector.toggle();
      ModelSelector.toggle();
      const panel = document.getElementById('model-panel');
      expect(panel.style.display).toBe('none');
    });
  });

  describe('close', () => {
    test('hides panel and overlay', () => {
      ModelSelector.toggle(); // open
      ModelSelector.close();
      expect(document.getElementById('model-panel').style.display).toBe('none');
      expect(document.getElementById('model-overlay').style.display).toBe('none');
    });
  });

  describe('model selection', () => {
    test('renders all available models', () => {
      ModelSelector.toggle();
      const buttons = document.querySelectorAll('.model-option');
      expect(buttons.length).toBe(ChatConfig.AVAILABLE_MODELS.length);
    });

    test('clicking a model updates ChatConfig.MODEL', () => {
      ModelSelector.toggle();
      const buttons = document.querySelectorAll('.model-option');
      const gpt35btn = Array.from(buttons).find(b => b.title === 'gpt-3.5-turbo');
      expect(gpt35btn).toBeDefined();
      gpt35btn.click();
      expect(ChatConfig.MODEL).toBe('gpt-3.5-turbo');
    });

    test('clicking a model updates label', () => {
      ModelSelector.toggle();
      const buttons = document.querySelectorAll('.model-option');
      const gpt4btn = Array.from(buttons).find(b => b.title === 'gpt-4');
      gpt4btn.click();
      expect(document.getElementById('model-label').textContent).toBe('GPT-4');
    });

    test('clicking a model closes the panel', () => {
      ModelSelector.toggle();
      const buttons = document.querySelectorAll('.model-option');
      buttons[0].click();
      expect(document.getElementById('model-panel').style.display).toBe('none');
    });

    test('active model has model-active class', () => {
      ModelSelector.toggle();
      const active = document.querySelector('.model-active');
      expect(active).not.toBeNull();
      expect(active.title).toBe(ChatConfig.MODEL);
    });
  });

  describe('init', () => {
    test('sets initial label from saved model', () => {
      ModelSelector.init();
      const label = document.getElementById('model-label');
      const model = ChatConfig.AVAILABLE_MODELS.find(m => m.id === ChatConfig.MODEL);
      expect(label.textContent).toBe(model.label);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════
// FileDropZone
// ══════════════════════════════════════════════════════════════════════
describe('FileDropZone', () => {
  describe('isTextFile', () => {
    test('accepts .js files', () => {
      expect(FileDropZone.isTextFile('main.js')).toBe(true);
    });

    test('accepts .py files', () => {
      expect(FileDropZone.isTextFile('script.py')).toBe(true);
    });

    test('accepts .ts files', () => {
      expect(FileDropZone.isTextFile('index.ts')).toBe(true);
    });

    test('accepts .md files', () => {
      expect(FileDropZone.isTextFile('README.md')).toBe(true);
    });

    test('accepts .json files', () => {
      expect(FileDropZone.isTextFile('package.json')).toBe(true);
    });

    test('accepts .srv (sauravcode) files', () => {
      expect(FileDropZone.isTextFile('hello.srv')).toBe(true);
    });

    test('rejects image files', () => {
      expect(FileDropZone.isTextFile('photo.png')).toBe(false);
    });

    test('rejects video files', () => {
      expect(FileDropZone.isTextFile('movie.mp4')).toBe(false);
    });

    test('rejects binary files', () => {
      expect(FileDropZone.isTextFile('app.exe')).toBe(false);
    });

    test('accepts Makefile (no extension)', () => {
      expect(FileDropZone.isTextFile('Makefile')).toBe(true);
    });

    test('accepts Dockerfile (no extension)', () => {
      expect(FileDropZone.isTextFile('Dockerfile')).toBe(true);
    });

    test('accepts README (no extension)', () => {
      expect(FileDropZone.isTextFile('README')).toBe(true);
    });

    test('rejects unknown extensionless file', () => {
      expect(FileDropZone.isTextFile('randomfile')).toBe(false);
    });

    test('handles null/empty filename', () => {
      expect(FileDropZone.isTextFile(null)).toBe(false);
      expect(FileDropZone.isTextFile('')).toBe(false);
    });

    test('accepts .ml (OCaml) files', () => {
      expect(FileDropZone.isTextFile('probability.ml')).toBe(true);
    });

    test('accepts .rs (Rust) files', () => {
      expect(FileDropZone.isTextFile('main.rs')).toBe(true);
    });

    test('accepts .hs (Haskell) files', () => {
      expect(FileDropZone.isTextFile('Main.hs')).toBe(true);
    });
  });

  describe('_langHint', () => {
    test('maps js to javascript', () => {
      expect(FileDropZone._langHint('js')).toBe('javascript');
    });

    test('maps py to python', () => {
      expect(FileDropZone._langHint('py')).toBe('python');
    });

    test('maps rs to rust', () => {
      expect(FileDropZone._langHint('rs')).toBe('rust');
    });

    test('maps srv to sauravcode', () => {
      expect(FileDropZone._langHint('srv')).toBe('sauravcode');
    });

    test('maps ml to ocaml', () => {
      expect(FileDropZone._langHint('ml')).toBe('ocaml');
    });

    test('returns empty string for unknown extensions', () => {
      expect(FileDropZone._langHint('xyz')).toBe('');
    });
  });

  describe('_getExt', () => {
    test('extracts extension from filename', () => {
      expect(FileDropZone._getExt('file.txt')).toBe('txt');
    });

    test('handles multiple dots', () => {
      expect(FileDropZone._getExt('my.file.js')).toBe('js');
    });

    test('handles no extension', () => {
      expect(FileDropZone._getExt('Makefile')).toBe('');
    });

    test('lowercases extension', () => {
      expect(FileDropZone._getExt('FILE.PY')).toBe('py');
    });
  });

  describe('constants', () => {
    test('MAX_FILE_SIZE is 100 KB', () => {
      expect(FileDropZone.MAX_FILE_SIZE).toBe(100 * 1024);
    });

    test('MAX_FILES is 5', () => {
      expect(FileDropZone.MAX_FILES).toBe(5);
    });
  });
});
