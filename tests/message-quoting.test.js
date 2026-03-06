'use strict';

const { setupDOM, loadApp } = require('./setup');

beforeAll(() => {
  setupDOM();
  loadApp();
});

const MQ = () => globalThis.MessageQuoting;

afterEach(() => {
  const mq = MQ();
  if (mq) mq.clearQuote();
  localStorage.clear();
});

// ── API existence ────────────────────────────────────────────

describe('MessageQuoting API', () => {
  test('MessageQuoting is defined', () => {
    expect(MQ()).toBeDefined();
  });

  test('exposes required public methods', () => {
    const mq = MQ();
    expect(typeof mq.init).toBe('function');
    expect(typeof mq.setQuote).toBe('function');
    expect(typeof mq.clearQuote).toBe('function');
    expect(typeof mq.getQuote).toBe('function');
    expect(typeof mq.hasQuote).toBe('function');
    expect(typeof mq.formatQuoteBlock).toBe('function');
    expect(typeof mq.consumeQuote).toBe('function');
    expect(typeof mq.decorateMessages).toBe('function');
  });

  test('exposes constants', () => {
    const mq = MQ();
    expect(typeof mq.MAX_PREVIEW_LENGTH).toBe('number');
    expect(typeof mq.MAX_QUOTE_LENGTH).toBe('number');
    expect(mq.MAX_PREVIEW_LENGTH).toBeGreaterThan(0);
    expect(mq.MAX_QUOTE_LENGTH).toBeGreaterThan(0);
  });
});

// ── setQuote / getQuote ──────────────────────────────────────

describe('setQuote and getQuote', () => {
  test('sets and retrieves a quote', () => {
    MQ().setQuote('user', 'Hello world', 0);
    const q = MQ().getQuote();
    expect(q).not.toBeNull();
    expect(q.role).toBe('user');
    expect(q.content).toBe('Hello world');
    expect(q.index).toBe(0);
  });

  test('sets assistant role', () => {
    MQ().setQuote('assistant', 'I can help', 1);
    expect(MQ().getQuote().role).toBe('assistant');
  });

  test('defaults role to user when not provided', () => {
    MQ().setQuote(null, 'test content', 0);
    expect(MQ().getQuote().role).toBe('user');
  });

  test('defaults index to -1 when not provided', () => {
    MQ().setQuote('user', 'test', undefined);
    expect(MQ().getQuote().index).toBe(-1);
  });

  test('trims content', () => {
    MQ().setQuote('user', '  trimmed  ', 0);
    expect(MQ().getQuote().content).toBe('trimmed');
  });

  test('truncates content exceeding MAX_QUOTE_LENGTH', () => {
    const long = 'a'.repeat(600);
    MQ().setQuote('user', long, 0);
    expect(MQ().getQuote().content.length).toBeLessThanOrEqual(MQ().MAX_QUOTE_LENGTH + 1);
    expect(MQ().getQuote().content.endsWith('…')).toBe(true);
  });

  test('ignores empty content', () => {
    MQ().setQuote('user', '', 0);
    expect(MQ().hasQuote()).toBe(false);
  });

  test('ignores whitespace-only content', () => {
    MQ().setQuote('user', '   ', 0);
    expect(MQ().hasQuote()).toBe(false);
  });

  test('ignores null content', () => {
    MQ().setQuote('user', null, 0);
    expect(MQ().hasQuote()).toBe(false);
  });

  test('ignores non-string content', () => {
    MQ().setQuote('user', 42, 0);
    expect(MQ().hasQuote()).toBe(false);
  });

  test('getQuote returns a copy, not the internal object', () => {
    MQ().setQuote('user', 'original', 0);
    const q1 = MQ().getQuote();
    q1.content = 'modified';
    expect(MQ().getQuote().content).toBe('original');
  });

  test('replaces existing quote', () => {
    MQ().setQuote('user', 'first', 0);
    MQ().setQuote('assistant', 'second', 1);
    expect(MQ().getQuote().content).toBe('second');
    expect(MQ().getQuote().role).toBe('assistant');
  });
});

// ── clearQuote ───────────────────────────────────────────────

describe('clearQuote', () => {
  test('clears active quote', () => {
    MQ().setQuote('user', 'test', 0);
    expect(MQ().hasQuote()).toBe(true);
    MQ().clearQuote();
    expect(MQ().hasQuote()).toBe(false);
    expect(MQ().getQuote()).toBeNull();
  });

  test('clearing when no quote is a no-op', () => {
    MQ().clearQuote();
    expect(MQ().hasQuote()).toBe(false);
  });
});

// ── hasQuote ─────────────────────────────────────────────────

describe('hasQuote', () => {
  test('returns false when no quote', () => {
    expect(MQ().hasQuote()).toBe(false);
  });

  test('returns true when quote is active', () => {
    MQ().setQuote('user', 'test', 0);
    expect(MQ().hasQuote()).toBe(true);
  });
});

// ── formatQuoteBlock ─────────────────────────────────────────

describe('formatQuoteBlock', () => {
  test('returns empty string when no quote', () => {
    expect(MQ().formatQuoteBlock()).toBe('');
  });

  test('formats user quote', () => {
    MQ().setQuote('user', 'Hello', 0);
    const block = MQ().formatQuoteBlock();
    expect(block).toContain('> **You:**');
    expect(block).toContain('> Hello');
    expect(block.endsWith('\n\n')).toBe(true);
  });

  test('formats assistant quote', () => {
    MQ().setQuote('assistant', 'Hi there', 1);
    const block = MQ().formatQuoteBlock();
    expect(block).toContain('> **Assistant:**');
    expect(block).toContain('> Hi there');
  });

  test('formats multi-line content', () => {
    MQ().setQuote('user', 'line1\nline2\nline3', 0);
    const block = MQ().formatQuoteBlock();
    expect(block).toContain('> line1');
    expect(block).toContain('> line2');
    expect(block).toContain('> line3');
  });

  test('does not modify the active quote', () => {
    MQ().setQuote('user', 'test', 0);
    MQ().formatQuoteBlock();
    expect(MQ().hasQuote()).toBe(true);
  });
});

// ── consumeQuote ─────────────────────────────────────────────

describe('consumeQuote', () => {
  test('returns formatted block and clears quote', () => {
    MQ().setQuote('user', 'test', 0);
    const block = MQ().consumeQuote();
    expect(block).toContain('> test');
    expect(MQ().hasQuote()).toBe(false);
  });

  test('returns empty string when no quote', () => {
    expect(MQ().consumeQuote()).toBe('');
    expect(MQ().hasQuote()).toBe(false);
  });
});

// ── localStorage persistence ─────────────────────────────────

describe('localStorage persistence', () => {
  test('saves quote to localStorage on set', () => {
    MQ().setQuote('user', 'saved', 2);
    const stored = localStorage.getItem('ac_message_quote');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored);
    expect(parsed.content).toBe('saved');
    expect(parsed.role).toBe('user');
    expect(parsed.index).toBe(2);
  });

  test('removes from localStorage on clear', () => {
    MQ().setQuote('user', 'test', 0);
    MQ().clearQuote();
    expect(localStorage.getItem('ac_message_quote')).toBeNull();
  });
});

// ── decorateMessages ─────────────────────────────────────────

describe('decorateMessages', () => {
  beforeEach(() => {
    const container = document.getElementById('history-messages');
    container.innerHTML = '';
  });

  test('adds quote buttons to history messages', () => {
    const container = document.getElementById('history-messages');
    const msg = document.createElement('div');
    msg.className = 'history-msg user';
    msg.textContent = 'Test message';
    container.appendChild(msg);

    // Need to set up ConversationManager history
    if (globalThis.ConversationManager) {
      globalThis.ConversationManager.clear();
      globalThis.ConversationManager.addMessage('user', 'Test message');
    }

    MQ().decorateMessages();

    const btn = msg.querySelector('.quote-btn');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain('Quote');
  });

  test('does not duplicate quote buttons on re-decorate', () => {
    const container = document.getElementById('history-messages');
    const msg = document.createElement('div');
    msg.className = 'history-msg user';
    container.appendChild(msg);

    if (globalThis.ConversationManager) {
      globalThis.ConversationManager.clear();
      globalThis.ConversationManager.addMessage('user', 'Test');
    }

    MQ().decorateMessages();
    MQ().decorateMessages();

    const buttons = msg.querySelectorAll('.quote-btn');
    expect(buttons.length).toBe(1);
  });

  test('clicking quote button sets the quote', () => {
    const container = document.getElementById('history-messages');
    const msg = document.createElement('div');
    msg.className = 'history-msg user';
    container.appendChild(msg);

    if (globalThis.ConversationManager) {
      globalThis.ConversationManager.clear();
      globalThis.ConversationManager.addMessage('user', 'Click me');
    }

    MQ().decorateMessages();

    const btn = msg.querySelector('.quote-btn');
    btn.click();

    expect(MQ().hasQuote()).toBe(true);
    expect(MQ().getQuote().content).toBe('Click me');
    expect(MQ().getQuote().role).toBe('user');
  });

  test('handles empty history container', () => {
    const container = document.getElementById('history-messages');
    container.innerHTML = '';
    expect(() => MQ().decorateMessages()).not.toThrow();
  });
});

// ── Preview bar ──────────────────────────────────────────────

describe('preview bar', () => {
  beforeAll(() => {
    // Remove any existing preview bars and re-init once
    const existing = document.querySelectorAll('#quote-preview-bar');
    existing.forEach(el => el.remove());
    MQ().init();
  });
  test('preview bar is created in DOM', () => {
    const bar = document.getElementById('quote-preview-bar');
    expect(bar).not.toBeNull();
  });

  test('preview bar is hidden by default', () => {
    const bar = document.getElementById('quote-preview-bar');
    expect(bar.style.display).toBe('none');
  });

  test('preview bar shows when quote is set', () => {
    MQ().setQuote('user', 'visible', 0);
    const bar = document.getElementById('quote-preview-bar');
    expect(bar.style.display).toBe('flex');
  });

  test('preview bar hides when quote is cleared', () => {
    MQ().setQuote('user', 'test', 0);
    MQ().clearQuote();
    const bar = document.getElementById('quote-preview-bar');
    expect(bar.style.display).toBe('none');
  });

  test('close button clears quote', () => {
    MQ().setQuote('user', 'test', 0);
    const closeBtn = document.getElementById('quote-clear-btn');
    closeBtn.click();
    expect(MQ().hasQuote()).toBe(false);
  });

  test('preview bar has ARIA attributes', () => {
    const bar = document.getElementById('quote-preview-bar');
    expect(bar.getAttribute('role')).toBe('status');
    expect(bar.getAttribute('aria-label')).toBe('Quoted message');
  });
});

// ── Keyboard shortcut ────────────────────────────────────────

describe('keyboard shortcut', () => {
  test('Alt+Q clears active quote', () => {
    MQ().setQuote('user', 'test', 0);
    const event = new KeyboardEvent('keydown', {
      key: 'q',
      altKey: true,
      bubbles: true
    });
    document.dispatchEvent(event);
    expect(MQ().hasQuote()).toBe(false);
  });

  test('Alt+Q is a no-op when no quote', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'q',
      altKey: true,
      bubbles: true
    });
    expect(() => document.dispatchEvent(event)).not.toThrow();
    expect(MQ().hasQuote()).toBe(false);
  });

  test('plain Q does not clear quote', () => {
    MQ().setQuote('user', 'test', 0);
    const event = new KeyboardEvent('keydown', {
      key: 'q',
      altKey: false,
      bubbles: true
    });
    document.dispatchEvent(event);
    expect(MQ().hasQuote()).toBe(true);
  });
});

// ── Edge cases ───────────────────────────────────────────────

describe('edge cases', () => {
  test('setQuote with very long content truncates', () => {
    const long = 'word '.repeat(200);
    MQ().setQuote('user', long, 0);
    expect(MQ().getQuote().content.length).toBeLessThanOrEqual(MQ().MAX_QUOTE_LENGTH + 1);
  });

  test('formatQuoteBlock handles content with special characters', () => {
    MQ().setQuote('user', 'line with > and **bold** and `code`', 0);
    const block = MQ().formatQuoteBlock();
    expect(block).toContain('> line with > and **bold** and `code`');
  });

  test('multiple set-clear cycles work correctly', () => {
    for (let i = 0; i < 5; i++) {
      MQ().setQuote('user', 'cycle ' + i, i);
      expect(MQ().hasQuote()).toBe(true);
      MQ().clearQuote();
      expect(MQ().hasQuote()).toBe(false);
    }
  });

  test('consumeQuote is idempotent', () => {
    MQ().setQuote('user', 'once', 0);
    const first = MQ().consumeQuote();
    const second = MQ().consumeQuote();
    expect(first).toContain('> once');
    expect(second).toBe('');
  });
});
