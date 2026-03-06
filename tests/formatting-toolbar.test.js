'use strict';

const { setupDOM, loadApp } = require('./setup');

beforeAll(() => {
  setupDOM();
  loadApp();
});

const FT = () => globalThis.FormattingToolbar;

afterEach(() => {
  const ft = FT();
  if (ft && ft.isVisible()) ft.hide();
  localStorage.clear();
});

// ── API existence ────────────────────────────────────────────

describe('FormattingToolbar API', () => {
  test('FormattingToolbar is defined', () => {
    expect(FT()).toBeDefined();
  });

  test('exposes required public methods', () => {
    const ft = FT();
    expect(typeof ft.toggle).toBe('function');
    expect(typeof ft.show).toBe('function');
    expect(typeof ft.hide).toBe('function');
    expect(typeof ft.applyFormat).toBe('function');
    expect(typeof ft.getFormat).toBe('function');
    expect(typeof ft.isVisible).toBe('function');
    expect(ft.FORMATS).toBeDefined();
  });
});

// ── Format definitions ───────────────────────────────────────

describe('Format definitions', () => {
  test('FORMATS array has 10 entries', () => {
    expect(FT().FORMATS.length).toBe(10);
  });

  test('getFormat returns correct format by id', () => {
    const bold = FT().getFormat('bold');
    expect(bold).not.toBeNull();
    expect(bold.prefix).toBe('**');
    expect(bold.suffix).toBe('**');
    expect(bold.placeholder).toBe('bold text');
  });

  test('getFormat returns null for unknown id', () => {
    expect(FT().getFormat('nonexistent')).toBeNull();
  });

  test('each format has required fields', () => {
    FT().FORMATS.forEach(fmt => {
      expect(fmt.id).toBeDefined();
      expect(fmt.icon).toBeDefined();
      expect(fmt.title).toBeDefined();
      expect(typeof fmt.prefix).toBe('string');
      expect(typeof fmt.suffix).toBe('string');
      expect(fmt.placeholder).toBeDefined();
    });
  });

  test('format ids are unique', () => {
    const ids = FT().FORMATS.map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('italic uses underscore markers', () => {
    const italic = FT().getFormat('italic');
    expect(italic.prefix).toBe('_');
    expect(italic.suffix).toBe('_');
  });

  test('code uses backtick markers', () => {
    const code = FT().getFormat('code');
    expect(code.prefix).toBe('`');
    expect(code.suffix).toBe('`');
  });

  test('codeblock uses triple backtick with newlines', () => {
    const cb = FT().getFormat('codeblock');
    expect(cb.prefix).toBe('```\n');
    expect(cb.suffix).toBe('\n```');
  });

  test('link has bracket/paren markers', () => {
    const link = FT().getFormat('link');
    expect(link.prefix).toBe('[');
    expect(link.suffix).toBe('](url)');
  });

  test('heading uses ## prefix', () => {
    const h = FT().getFormat('heading');
    expect(h.prefix).toBe('## ');
    expect(h.suffix).toBe('');
  });

  test('strikethrough uses ~~ markers', () => {
    const s = FT().getFormat('strike');
    expect(s.prefix).toBe('~~');
    expect(s.suffix).toBe('~~');
  });

  test('quote uses > prefix', () => {
    const q = FT().getFormat('quote');
    expect(q.prefix).toBe('> ');
  });
});

// ── Toggle visibility ────────────────────────────────────────

describe('Visibility toggle', () => {
  test('starts hidden', () => {
    expect(FT().isVisible()).toBe(false);
  });

  test('toggle makes toolbar visible', () => {
    FT().toggle();
    expect(FT().isVisible()).toBe(true);
  });

  test('toggle twice hides toolbar', () => {
    FT().toggle();
    FT().toggle();
    expect(FT().isVisible()).toBe(false);
  });

  test('show makes toolbar visible', () => {
    FT().show();
    expect(FT().isVisible()).toBe(true);
  });

  test('hide hides toolbar', () => {
    FT().show();
    FT().hide();
    expect(FT().isVisible()).toBe(false);
  });

  test('toggle saves visibility to localStorage', () => {
    FT().toggle();
    expect(localStorage.getItem('agentic_fmt_toolbar_visible')).toBe('1');
    FT().toggle();
    expect(localStorage.getItem('agentic_fmt_toolbar_visible')).toBe('0');
  });

  test('show saves 1 to localStorage', () => {
    FT().show();
    expect(localStorage.getItem('agentic_fmt_toolbar_visible')).toBe('1');
  });

  test('hide saves 0 to localStorage', () => {
    FT().show();
    FT().hide();
    expect(localStorage.getItem('agentic_fmt_toolbar_visible')).toBe('0');
  });
});

// ── DOM structure ────────────────────────────────────────────

describe('Toolbar DOM', () => {
  test('init creates toolbar element', () => {
    FT().init();
    const toolbar = document.getElementById('formatting-toolbar');
    expect(toolbar).not.toBeNull();
  });

  test('toolbar has role=toolbar', () => {
    FT().init();
    const toolbar = document.getElementById('formatting-toolbar');
    expect(toolbar.getAttribute('role')).toBe('toolbar');
  });

  test('toolbar has aria-label', () => {
    FT().init();
    const toolbar = document.getElementById('formatting-toolbar');
    expect(toolbar.getAttribute('aria-label')).toBe('Text formatting');
  });

  test('toolbar has 10 format buttons', () => {
    FT().init();
    const toolbar = document.getElementById('formatting-toolbar');
    const buttons = toolbar.querySelectorAll('button');
    expect(buttons.length).toBe(10);
  });

  test('each button has data-format attribute', () => {
    FT().init();
    const toolbar = document.getElementById('formatting-toolbar');
    const buttons = toolbar.querySelectorAll('button');
    const ids = Array.from(buttons).map(b => b.getAttribute('data-format'));
    expect(ids).toEqual([
      'bold', 'italic', 'code', 'codeblock', 'link',
      'heading', 'bullet', 'numbered', 'strike', 'quote'
    ]);
  });

  test('each button has aria-label', () => {
    FT().init();
    const toolbar = document.getElementById('formatting-toolbar');
    const buttons = toolbar.querySelectorAll('button');
    buttons.forEach(btn => {
      expect(btn.getAttribute('aria-label')).toBeTruthy();
    });
  });
});

// ── Apply formatting ─────────────────────────────────────────

describe('applyFormat', () => {
  test('wraps selected text with bold markers', () => {
    const input = document.getElementById('chat-input');
    input.value = 'hello world';
    input.setSelectionRange(6, 11);

    FT().applyFormat(FT().getFormat('bold'));
    expect(input.value).toBe('hello **world**');
  });

  test('wraps selected text with italic markers', () => {
    const input = document.getElementById('chat-input');
    input.value = 'hello world';
    input.setSelectionRange(0, 5);

    FT().applyFormat(FT().getFormat('italic'));
    expect(input.value).toBe('_hello_ world');
  });

  test('wraps selected text with inline code', () => {
    const input = document.getElementById('chat-input');
    input.value = 'use the forEach method';
    input.setSelectionRange(8, 15);

    FT().applyFormat(FT().getFormat('code'));
    expect(input.value).toBe('use the `forEach` method');
  });

  test('inserts placeholder when no selection', () => {
    const input = document.getElementById('chat-input');
    input.value = '';
    input.setSelectionRange(0, 0);

    FT().applyFormat(FT().getFormat('bold'));
    expect(input.value).toBe('**bold text**');
  });

  test('inserts code block placeholder', () => {
    const input = document.getElementById('chat-input');
    input.value = '';
    input.setSelectionRange(0, 0);

    FT().applyFormat(FT().getFormat('codeblock'));
    // Note: <input> elements don't preserve newlines visually, but
    // the value string contains them for copy/paste into textareas
    expect(input.value).toContain('```');
    expect(input.value).toContain('code here');
  });

  test('wraps text with link format', () => {
    const input = document.getElementById('chat-input');
    input.value = 'click here please';
    input.setSelectionRange(6, 10);

    FT().applyFormat(FT().getFormat('link'));
    expect(input.value).toBe('click [here](url) please');
  });

  test('adds heading prefix', () => {
    const input = document.getElementById('chat-input');
    input.value = '';
    input.setSelectionRange(0, 0);

    FT().applyFormat(FT().getFormat('heading'));
    expect(input.value).toBe('## heading');
  });

  test('adds bullet list prefix', () => {
    const input = document.getElementById('chat-input');
    input.value = '';
    input.setSelectionRange(0, 0);

    FT().applyFormat(FT().getFormat('bullet'));
    expect(input.value).toBe('- list item');
  });

  test('adds numbered list prefix', () => {
    const input = document.getElementById('chat-input');
    input.value = '';
    input.setSelectionRange(0, 0);

    FT().applyFormat(FT().getFormat('numbered'));
    expect(input.value).toBe('1. list item');
  });

  test('adds strikethrough markers', () => {
    const input = document.getElementById('chat-input');
    input.value = 'remove this';
    input.setSelectionRange(7, 11);

    FT().applyFormat(FT().getFormat('strike'));
    expect(input.value).toBe('remove ~~this~~');
  });

  test('adds quote prefix', () => {
    const input = document.getElementById('chat-input');
    input.value = '';
    input.setSelectionRange(0, 0);

    FT().applyFormat(FT().getFormat('quote'));
    expect(input.value).toBe('> quote');
  });

  test('inserts at cursor position in middle of text', () => {
    const input = document.getElementById('chat-input');
    input.value = 'before after';
    input.setSelectionRange(7, 7);

    FT().applyFormat(FT().getFormat('bold'));
    expect(input.value).toBe('before **bold text**after');
  });

  test('dispatches input event', () => {
    const input = document.getElementById('chat-input');
    input.value = 'test';
    input.setSelectionRange(0, 4);

    let eventFired = false;
    input.addEventListener('input', () => { eventFired = true; }, { once: true });

    FT().applyFormat(FT().getFormat('bold'));
    expect(eventFired).toBe(true);
  });

  test('handles empty string selection gracefully', () => {
    const input = document.getElementById('chat-input');
    input.value = 'abc';
    input.setSelectionRange(1, 1);

    FT().applyFormat(FT().getFormat('italic'));
    expect(input.value).toBe('a_italic text_bc');
  });

  test('wraps entire input when fully selected', () => {
    const input = document.getElementById('chat-input');
    input.value = 'entire text';
    input.setSelectionRange(0, 11);

    FT().applyFormat(FT().getFormat('bold'));
    expect(input.value).toBe('**entire text**');
  });

  test('multiple formats can be stacked', () => {
    const input = document.getElementById('chat-input');
    input.value = 'word';
    input.setSelectionRange(0, 4);

    FT().applyFormat(FT().getFormat('bold'));
    expect(input.value).toBe('**word**');

    // Now wrap the whole thing in italic
    input.setSelectionRange(0, 8);
    FT().applyFormat(FT().getFormat('italic'));
    expect(input.value).toBe('_**word**_');
  });
});

// ── Button click integration ─────────────────────────────────

describe('Button clicks', () => {
  test('clicking bold button applies bold formatting', () => {
    FT().init();
    FT().show();
    const input = document.getElementById('chat-input');
    input.value = 'hello';
    input.setSelectionRange(0, 5);

    const toolbar = document.getElementById('formatting-toolbar');
    const boldBtn = toolbar.querySelector('[data-format="bold"]');
    boldBtn.click();

    expect(input.value).toBe('**hello**');
  });

  test('clicking code button applies code formatting', () => {
    FT().init();
    FT().show();
    const input = document.getElementById('chat-input');
    input.value = 'func';
    input.setSelectionRange(0, 4);

    const toolbar = document.getElementById('formatting-toolbar');
    const codeBtn = toolbar.querySelector('[data-format="code"]');
    codeBtn.click();

    expect(input.value).toBe('`func`');
  });
});

// ── Edge cases ───────────────────────────────────────────────

describe('Edge cases', () => {
  test('applyFormat with completely empty input', () => {
    const input = document.getElementById('chat-input');
    input.value = '';

    FT().applyFormat(FT().getFormat('bold'));
    expect(input.value).toBe('**bold text**');
  });

  test('applyFormat on input with special characters', () => {
    const input = document.getElementById('chat-input');
    input.value = 'hello <world> & "friends"';
    input.setSelectionRange(6, 13);

    FT().applyFormat(FT().getFormat('code'));
    expect(input.value).toBe('hello `<world>` & "friends"');
  });

  test('preserves text before and after selection', () => {
    const input = document.getElementById('chat-input');
    input.value = 'aaa bbb ccc';
    input.setSelectionRange(4, 7);

    FT().applyFormat(FT().getFormat('italic'));
    expect(input.value).toBe('aaa _bbb_ ccc');
  });
});
