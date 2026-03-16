/**
 * @jest-environment jsdom
 */
require('./setup');

describe('TypingSpeedMonitor', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input id="chat-input" />
      <button id="send-btn">Send</button>
      <div id="wpm-indicator"><span id="wpm-value">0</span></div>
    `;
    localStorage.clear();
    jest.useFakeTimers();
    require('../app.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetModules();
  });

  test('module exposes public API', () => {
    expect(TypingSpeedMonitor).toBeDefined();
    expect(typeof TypingSpeedMonitor.open).toBe('function');
    expect(typeof TypingSpeedMonitor.close).toBe('function');
    expect(typeof TypingSpeedMonitor.toggle).toBe('function');
    expect(typeof TypingSpeedMonitor.reset).toBe('function');
    expect(typeof TypingSpeedMonitor.getCurrentWpm).toBe('function');
    expect(typeof TypingSpeedMonitor.getPeakWpm).toBe('function');
    expect(typeof TypingSpeedMonitor.getTotalWords).toBe('function');
    expect(typeof TypingSpeedMonitor.getTotalChars).toBe('function');
  });

  test('initial WPM is 0', () => {
    expect(TypingSpeedMonitor.getCurrentWpm()).toBe(0);
    expect(TypingSpeedMonitor.getPeakWpm()).toBe(0);
  });

  test('indicator element shows 0 initially', () => {
    const val = document.getElementById('wpm-value');
    expect(val.textContent).toBe('0');
  });

  test('dashboard overlay is created', () => {
    const overlay = document.getElementById('wpm-dashboard-overlay');
    expect(overlay).not.toBeNull();
  });

  test('dashboard is hidden by default', () => {
    const overlay = document.getElementById('wpm-dashboard-overlay');
    expect(overlay.style.display).not.toBe('flex');
  });

  test('open() shows dashboard', () => {
    TypingSpeedMonitor.open();
    const overlay = document.getElementById('wpm-dashboard-overlay');
    expect(overlay.style.display).toBe('flex');
  });

  test('close() hides dashboard', () => {
    TypingSpeedMonitor.open();
    TypingSpeedMonitor.close();
    const overlay = document.getElementById('wpm-dashboard-overlay');
    expect(overlay.style.display).toBe('none');
  });

  test('toggle() opens then closes', () => {
    TypingSpeedMonitor.toggle();
    expect(document.getElementById('wpm-dashboard-overlay').style.display).toBe('flex');
    TypingSpeedMonitor.toggle();
    expect(document.getElementById('wpm-dashboard-overlay').style.display).toBe('none');
  });

  test('reset() clears all stats', () => {
    TypingSpeedMonitor.reset();
    expect(TypingSpeedMonitor.getCurrentWpm()).toBe(0);
    expect(TypingSpeedMonitor.getPeakWpm()).toBe(0);
    expect(TypingSpeedMonitor.getTotalWords()).toBe(0);
    expect(TypingSpeedMonitor.getTotalChars()).toBe(0);
  });

  test('keystrokes increment char count', () => {
    const input = document.getElementById('chat-input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }));
    expect(TypingSpeedMonitor.getTotalChars()).toBe(3);
  });

  test('send button increments word count', () => {
    const input = document.getElementById('chat-input');
    input.value = 'hello world test';
    document.getElementById('send-btn').click();
    expect(TypingSpeedMonitor.getTotalWords()).toBe(3);
  });

  test('stats persist to localStorage', () => {
    const input = document.getElementById('chat-input');
    input.value = 'one two three four';
    document.getElementById('send-btn').click();
    const stored = JSON.parse(localStorage.getItem('ac_typing_speed'));
    expect(stored.totalWords).toBe(4);
  });

  test('dashboard has stat elements', () => {
    expect(document.getElementById('wpm-live')).not.toBeNull();
    expect(document.getElementById('wpm-peak')).not.toBeNull();
    expect(document.getElementById('wpm-words')).not.toBeNull();
    expect(document.getElementById('wpm-chars')).not.toBeNull();
    expect(document.getElementById('wpm-canvas')).not.toBeNull();
  });

  test('indicator gets wpm-active class when typing', () => {
    const input = document.getElementById('chat-input');
    // Simulate rapid typing
    for (let i = 0; i < 20; i++) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    }
    jest.advanceTimersByTime(500);
    const indicator = document.getElementById('wpm-indicator');
    const hasSpeedClass = indicator.classList.contains('wpm-active') ||
                          indicator.classList.contains('wpm-fast') ||
                          indicator.classList.contains('wpm-blazing');
    expect(hasSpeedClass).toBe(true);
  });

  test('Ctrl+Shift+T toggles dashboard', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'T', ctrlKey: true, shiftKey: true
    }));
    expect(document.getElementById('wpm-dashboard-overlay').style.display).toBe('flex');
  });

  test('close button closes dashboard', () => {
    TypingSpeedMonitor.open();
    document.getElementById('wpm-close').click();
    expect(document.getElementById('wpm-dashboard-overlay').style.display).toBe('none');
  });

  test('reset button clears stats and updates display', () => {
    const input = document.getElementById('chat-input');
    input.value = 'words here';
    document.getElementById('send-btn').click();
    expect(TypingSpeedMonitor.getTotalWords()).toBe(2);
    document.getElementById('wpm-reset').click();
    expect(TypingSpeedMonitor.getTotalWords()).toBe(0);
  });
});
