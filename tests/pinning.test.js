/**
 * MessagePinning — Unit Tests
 *
 * Tests for pinning messages to a floating bar with localStorage persistence.
 */

const { setupDOM, loadApp } = require('./setup');

beforeEach(() => {
  localStorage.clear();
  setupDOM();
  loadApp();
  // Add some messages so pin can reference them
  ConversationManager.addMessage('user', 'What is recursion?');
  ConversationManager.addMessage('assistant', 'Recursion is when a function calls itself to solve smaller subproblems.');
  ConversationManager.addMessage('user', 'Can you show me an example?');
  ConversationManager.addMessage('assistant', 'Sure! Here is a factorial function: function factorial(n) { return n <= 1 ? 1 : n * factorial(n - 1); }');
});

afterEach(() => {
  if (typeof MessagePinning !== 'undefined' && MessagePinning.reset) {
    MessagePinning.reset();
  }
});

describe('MessagePinning', () => {

  /* ── Basic Operations ── */

  test('module is defined with expected interface', () => {
    expect(MessagePinning).toBeDefined();
    expect(typeof MessagePinning.pin).toBe('function');
    expect(typeof MessagePinning.unpin).toBe('function');
    expect(typeof MessagePinning.togglePin).toBe('function');
    expect(typeof MessagePinning.isPinned).toBe('function');
    expect(typeof MessagePinning.getPins).toBe('function');
    expect(typeof MessagePinning.getCount).toBe('function');
    expect(typeof MessagePinning.clearAll).toBe('function');
    expect(typeof MessagePinning.jumpTo).toBe('function');
    expect(typeof MessagePinning.init).toBe('function');
    expect(typeof MessagePinning.reset).toBe('function');
  });

  test('pin adds a message to pinned list', () => {
    expect(MessagePinning.pin(1)).toBe(true);
    expect(MessagePinning.getCount()).toBe(1);
    expect(MessagePinning.isPinned(1)).toBe(true);
  });

  test('pin stores message preview', () => {
    MessagePinning.pin(1);
    const pins = MessagePinning.getPins();
    expect(pins).toHaveLength(1);
    expect(pins[0].messageIndex).toBe(1);
    expect(pins[0].role).toBe('user');
    expect(pins[0].preview).toContain('What is recursion');
    expect(pins[0].pinnedAt).toBeGreaterThan(0);
  });

  test('pin allows multiple messages', () => {
    MessagePinning.pin(1);
    MessagePinning.pin(2);
    MessagePinning.pin(3);
    expect(MessagePinning.getCount()).toBe(3);
  });

  test('pin rejects duplicate pin', () => {
    MessagePinning.pin(1);
    expect(MessagePinning.pin(1)).toBe(false);
    expect(MessagePinning.getCount()).toBe(1);
  });

  test('pin rejects invalid index', () => {
    expect(MessagePinning.pin(-1)).toBe(false);
    expect(MessagePinning.pin('abc')).toBe(false);
    expect(MessagePinning.getCount()).toBe(0);
  });

  test('pin rejects out-of-range index', () => {
    expect(MessagePinning.pin(999)).toBe(false);
  });

  test('pin rejects system messages (index 0)', () => {
    expect(MessagePinning.pin(0)).toBe(false);
  });

  test('unpin removes a pinned message', () => {
    MessagePinning.pin(1);
    expect(MessagePinning.unpin(1)).toBe(true);
    expect(MessagePinning.isPinned(1)).toBe(false);
    expect(MessagePinning.getCount()).toBe(0);
  });

  test('unpin returns false for non-pinned message', () => {
    expect(MessagePinning.unpin(1)).toBe(false);
  });

  test('togglePin pins then unpins', () => {
    MessagePinning.togglePin(1);
    expect(MessagePinning.isPinned(1)).toBe(true);

    MessagePinning.togglePin(1);
    expect(MessagePinning.isPinned(1)).toBe(false);
  });

  test('isPinned returns false for never-pinned', () => {
    expect(MessagePinning.isPinned(2)).toBe(false);
  });

  /* ── getPins returns copies ── */

  test('getPins returns a copy, not the internal array', () => {
    MessagePinning.pin(1);
    const pins1 = MessagePinning.getPins();
    const pins2 = MessagePinning.getPins();
    expect(pins1).not.toBe(pins2);
    expect(pins1).toEqual(pins2);
  });

  /* ── clearAll ── */

  test('clearAll removes all pins', () => {
    MessagePinning.pin(1);
    MessagePinning.pin(2);
    MessagePinning.pin(3);
    const count = MessagePinning.clearAll();
    expect(count).toBe(3);
    expect(MessagePinning.getCount()).toBe(0);
  });

  test('clearAll returns 0 when empty', () => {
    expect(MessagePinning.clearAll()).toBe(0);
  });

  /* ── Max Pins ── */

  test('pin enforces max limit (20)', () => {
    // Add enough messages to the conversation
    for (let i = 0; i < 20; i++) {
      ConversationManager.addMessage('user', 'Message ' + i);
    }
    // Pin 20 messages (indices 1-20, since 0 is system)
    for (let i = 1; i <= 20; i++) {
      expect(MessagePinning.pin(i)).toBe(true);
    }
    // 21st should fail
    ConversationManager.addMessage('user', 'One more');
    expect(MessagePinning.pin(21)).toBe(false);
    expect(MessagePinning.getCount()).toBe(20);
  });

  /* ── Preview truncation ── */

  test('preview is truncated to 100 chars', () => {
    const longMsg = 'A'.repeat(200);
    ConversationManager.addMessage('user', longMsg);
    const idx = ConversationManager.getMessages().length - 1;
    MessagePinning.pin(idx);
    const pins = MessagePinning.getPins();
    expect(pins[0].preview.length).toBeLessThanOrEqual(100);
  });

  /* ── Persistence ── */

  test('pins persist to localStorage', () => {
    MessagePinning.pin(1);
    const stored = JSON.parse(localStorage.getItem('agenticchat_pins'));
    expect(stored).toHaveLength(1);
    expect(stored[0].messageIndex).toBe(1);
  });

  test('pins load from localStorage on init', () => {
    const data = [{ messageIndex: 2, preview: 'test', role: 'assistant', pinnedAt: 1000 }];
    MessagePinning.reset();
    // Set localStorage AFTER reset (reset clears it)
    localStorage.setItem('agenticchat_pins', JSON.stringify(data));
    MessagePinning.init();
    expect(MessagePinning.isPinned(2)).toBe(true);
    expect(MessagePinning.getCount()).toBe(1);
  });

  test('corrupted localStorage data is handled gracefully', () => {
    localStorage.setItem('agenticchat_pins', 'not valid json!!!');
    MessagePinning.reset();
    MessagePinning.init();
    expect(MessagePinning.getCount()).toBe(0);
  });

  test('invalid items in localStorage are filtered out', () => {
    const data = [
      { messageIndex: 1, preview: 'valid', role: 'user', pinnedAt: 1000 },
      { bad: 'data' },
      { messageIndex: 'nope', preview: 123, role: null }
    ];
    MessagePinning.reset();
    // Set localStorage AFTER reset
    localStorage.setItem('agenticchat_pins', JSON.stringify(data));
    MessagePinning.init();
    expect(MessagePinning.getCount()).toBe(1);
  });

  /* ── reset ── */

  test('reset clears state and removes localStorage', () => {
    MessagePinning.pin(1);
    MessagePinning.reset();
    expect(MessagePinning.getCount()).toBe(0);
    expect(localStorage.getItem('agenticchat_pins')).toBeNull();
  });

  /* ── jumpTo does not throw when chat-output is empty ── */

  test('jumpTo does not throw for valid index', () => {
    MessagePinning.pin(1);
    expect(() => MessagePinning.jumpTo(1)).not.toThrow();
  });

  test('jumpTo does not throw for missing output element', () => {
    const output = document.getElementById('chat-output');
    if (output) output.remove();
    expect(() => MessagePinning.jumpTo(1)).not.toThrow();
  });

  /* ── toggleCollapse ── */

  test('toggleCollapse does not throw without DOM', () => {
    expect(() => MessagePinning.toggleCollapse()).not.toThrow();
  });

  /* ── renderBar ── */

  test('renderBar does not throw without init', () => {
    MessagePinning.reset();
    expect(() => MessagePinning.renderBar()).not.toThrow();
  });

  /* ── Pin bar DOM (when init is called) ── */

  test('init creates pin-bar element', () => {
    MessagePinning.init();
    const bar = document.getElementById('pin-bar');
    expect(bar).not.toBeNull();
    expect(bar.getAttribute('role')).toBe('region');
    expect(bar.getAttribute('aria-label')).toBe('Pinned messages');
  });

  test('pin-bar is hidden when no pins', () => {
    MessagePinning.init();
    const bar = document.getElementById('pin-bar');
    expect(bar.style.display).toBe('none');
  });

  test('pin-bar shows when messages are pinned', () => {
    MessagePinning.init();
    MessagePinning.pin(1);
    const bar = document.getElementById('pin-bar');
    expect(bar.style.display).not.toBe('none');
  });

  test('pin-bar title shows count', () => {
    MessagePinning.init();
    MessagePinning.pin(1);
    MessagePinning.pin(2);
    const title = document.getElementById('pin-bar-title');
    expect(title.textContent).toContain('2');
  });

  test('pin-bar has unpin buttons for each pin', () => {
    MessagePinning.init();
    MessagePinning.pin(1);
    MessagePinning.pin(2);
    const list = document.getElementById('pin-list');
    const items = list.querySelectorAll('li');
    expect(items).toHaveLength(2);
    // Each should have an unpin button
    items.forEach(item => {
      const btn = item.querySelector('button[aria-label="Unpin message"]');
      expect(btn).not.toBeNull();
    });
  });

  test('clear all button removes all pins', () => {
    MessagePinning.init();
    MessagePinning.pin(1);
    MessagePinning.pin(2);
    MessagePinning.clearAll();
    expect(MessagePinning.getCount()).toBe(0);
    const bar = document.getElementById('pin-bar');
    expect(bar.style.display).toBe('none');
  });

  test('unpin button in DOM removes the pin', () => {
    MessagePinning.init();
    MessagePinning.pin(1);
    const list = document.getElementById('pin-list');
    const unpinBtn = list.querySelector('button[aria-label="Unpin message"]');
    unpinBtn.click();
    expect(MessagePinning.isPinned(1)).toBe(false);
    expect(MessagePinning.getCount()).toBe(0);
  });

  test('init does not double-create pin-bar', () => {
    MessagePinning.init();
    MessagePinning.init();
    const bars = document.querySelectorAll('#pin-bar');
    expect(bars).toHaveLength(1);
  });

  /* ── Role icons ── */

  test('user pin shows user icon', () => {
    MessagePinning.init();
    MessagePinning.pin(1); // user message
    const list = document.getElementById('pin-list');
    const icon = list.querySelector('li span');
    expect(icon.textContent).toBe('\uD83D\uDC64'); // 👤
  });

  test('assistant pin shows robot icon', () => {
    MessagePinning.init();
    MessagePinning.pin(2); // assistant message
    const list = document.getElementById('pin-list');
    const icon = list.querySelector('li span');
    expect(icon.textContent).toBe('\uD83E\uDD16'); // 🤖
  });
});
