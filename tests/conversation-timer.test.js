/**
 * Tests for ConversationTimer module.
 * @jest-environment jsdom
 */
const { setupDOM, loadApp } = require('./setup');

beforeAll(() => { setupDOM(); loadApp(); });

describe('ConversationTimer', () => {
  test('module exists with expected API', () => {
    expect(ConversationTimer).toBeDefined();
    expect(typeof ConversationTimer.start).toBe('function');
    expect(typeof ConversationTimer.pause).toBe('function');
    expect(typeof ConversationTimer.reset).toBe('function');
    expect(typeof ConversationTimer.toggle).toBe('function');
  });

  test('init creates timer element and inserts after setup', () => {
    ConversationTimer.init();
    const el = document.querySelector('.conv-timer');
    expect(el).not.toBeNull();
    expect(el.textContent).toContain('0:00');
  });

  test('start sets running class', () => {
    ConversationTimer.init();
    ConversationTimer.start();
    const el = document.querySelector('.conv-timer');
    expect(el.classList.contains('running')).toBe(true);
  });

  test('pause sets paused class', () => {
    ConversationTimer.start();
    ConversationTimer.pause();
    const el = document.querySelector('.conv-timer');
    expect(el.classList.contains('paused')).toBe(true);
  });

  test('reset brings time back to 0:00', () => {
    ConversationTimer.start();
    ConversationTimer.reset();
    const el = document.querySelector('.conv-timer .timer-time');
    expect(el.textContent).toBe('0:00');
  });

  test('toggle opens and closes dashboard panel', () => {
    ConversationTimer.toggle();
    const panel = document.querySelector('.conv-timer-panel');
    expect(panel).not.toBeNull();
    expect(panel.classList.contains('open')).toBe(true);
    ConversationTimer.toggle();
    expect(panel.classList.contains('open')).toBe(false);
  });

  test('localStorage key is set after start/pause cycle', () => {
    ConversationTimer.start();
    ConversationTimer.pause();
    const raw = localStorage.getItem('ac_conversation_timer');
    expect(raw).not.toBeNull();
    const data = JSON.parse(raw);
    expect(typeof data).toBe('object');
  });
});
