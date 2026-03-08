/**
 * @jest-environment jsdom
 */

/* ---- minimal stubs ---- */
const _store = {};
const localStorage = {
  getItem: (k) => _store[k] || null,
  setItem: (k, v) => { _store[k] = v; },
  removeItem: (k) => { delete _store[k]; },
};
Object.defineProperty(global, 'localStorage', { value: localStorage, writable: true });

/* stub modules the translator depends on */
global.SafeStorage = {
  get: (k) => localStorage.getItem(k),
  set: (k, v) => localStorage.setItem(k, v),
};

const _history = [];
global.ConversationManager = {
  getHistory: () => _history,
};

global.ChatConfig = { MODEL: 'gpt-4o-mini' };

global.ApiKeyManager = { getKey: () => 'test-key-123' };

global.CostDashboard = { trackUsage: jest.fn() };

/* mock fetch */
global.fetch = jest.fn();

/* load app (only need MessageTranslator at the end) */
const fs = require('fs');
const path = require('path');
const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// Extract just the MessageTranslator IIFE
const start = appCode.indexOf('const MessageTranslator = (() => {');
const moduleCode = appCode.slice(start).replace('const MessageTranslator =', 'global.MessageTranslator =');
eval(moduleCode);

/* ---- helpers ---- */
function setupDOM() {
  document.body.innerHTML = `
    <div id="chat-output">
      <div class="history-msg user"><div class="msg-role">👤 You</div><div>Hello</div></div>
      <div class="history-msg assistant"><div class="msg-role">🤖 Assistant</div><div>Hi there!</div></div>
      <div class="history-msg user"><div class="msg-role">👤 You</div><div>Translate test</div></div>
      <div class="history-msg assistant"><div class="msg-role">🤖 Assistant</div><div>Sure thing!</div></div>
    </div>
  `;
  _history.length = 0;
  _history.push(
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there!' },
    { role: 'user', content: 'Translate test' },
    { role: 'assistant', content: 'Sure thing!' },
  );
}

/* ---- tests ---- */
describe('MessageTranslator', () => {
  beforeEach(() => {
    setupDOM();
    Object.keys(_store).forEach(k => delete _store[k]);
    MessageTranslator.clearCache();
    fetch.mockReset();
  });

  test('decorateMessages adds translate buttons to all messages', () => {
    MessageTranslator.decorateMessages();
    const btns = document.querySelectorAll('.translate-btn');
    expect(btns.length).toBe(4);
  });

  test('decorateMessages is idempotent', () => {
    MessageTranslator.decorateMessages();
    MessageTranslator.decorateMessages();
    const btns = document.querySelectorAll('.translate-btn');
    expect(btns.length).toBe(4);
  });

  test('getLanguages returns 20 languages', () => {
    const langs = MessageTranslator.getLanguages();
    expect(langs.length).toBe(20);
    expect(langs.find(l => l.code === 'en')).toBeTruthy();
    expect(langs.find(l => l.code === 'ja')).toBeTruthy();
  });

  test('getPreferredLanguage defaults to es', () => {
    expect(MessageTranslator.getPreferredLanguage()).toBe('es');
  });

  test('clicking translate button opens dropdown', () => {
    MessageTranslator.decorateMessages();
    const btn = document.querySelector('.translate-btn');
    btn.click();
    const dropdown = document.querySelector('.translate-dropdown');
    expect(dropdown).toBeTruthy();
    expect(dropdown.querySelectorAll('.translate-dropdown-item').length).toBe(20);
  });

  test('dropdown has search input', () => {
    MessageTranslator.decorateMessages();
    document.querySelector('.translate-btn').click();
    const search = document.querySelector('.translate-dropdown-search');
    expect(search).toBeTruthy();
    expect(search.placeholder).toBe('Search language...');
  });

  test('translateMessage uses cache on second call', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Hola' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    });

    await MessageTranslator.translateMessage(0, 'es', 'Spanish');
    expect(fetch).toHaveBeenCalledTimes(1);

    // Second call should use cache
    fetch.mockClear();
    await MessageTranslator.translateMessage(0, 'es', 'Spanish');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('translateMessage shows translation result in DOM', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Bonjour' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    });

    MessageTranslator.decorateMessages();
    await MessageTranslator.translateMessage(0, 'fr', 'French');

    const result = document.querySelector('.translate-result');
    expect(result).toBeTruthy();
    expect(result.textContent).toContain('French');
    expect(result.textContent).toContain('Bonjour');
  });

  test('translateMessage handles API error', async () => {
    global.alert = jest.fn();
    fetch.mockResolvedValueOnce({
      ok: false,
      statusText: 'Bad Request',
      json: async () => ({ error: { message: 'Invalid key' } }),
    });

    MessageTranslator.decorateMessages();
    await MessageTranslator.translateMessage(0, 'de', 'German');
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('Invalid key'));
  });

  test('translateMessage sends correct API request', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Hallo' } }],
      }),
    });

    await MessageTranslator.translateMessage(0, 'de', 'German');

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages[0].content).toContain('German');
    expect(body.messages[1].content).toBe('Hello');
    expect(body.temperature).toBe(0.3);
  });

  test('clearCache empties the cache', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Hola' } }],
      }),
    });

    await MessageTranslator.translateMessage(0, 'es', 'Spanish');
    MessageTranslator.clearCache();

    // Should need to fetch again
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Hola' } }],
      }),
    });
    await MessageTranslator.translateMessage(0, 'es', 'Spanish');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('translation result has copy and close buttons', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Ciao' } }],
      }),
    });

    MessageTranslator.decorateMessages();
    await MessageTranslator.translateMessage(0, 'it', 'Italian');

    const actions = document.querySelector('.translate-result-actions');
    expect(actions).toBeTruthy();
    const buttons = actions.querySelectorAll('button');
    expect(buttons.length).toBe(2); // copy + close
  });

  test('close button removes translation', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Olá' } }],
      }),
    });

    MessageTranslator.decorateMessages();
    await MessageTranslator.translateMessage(0, 'pt', 'Portuguese');

    const closeBtn = document.querySelectorAll('.translate-result-actions button')[1];
    closeBtn.click();
    expect(document.querySelector('.translate-result')).toBeNull();
  });

  test('re-translating same message replaces previous translation', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Hola' } }] }),
    });
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Bonjour' } }] }),
    });

    MessageTranslator.decorateMessages();
    await MessageTranslator.translateMessage(0, 'es', 'Spanish');
    await MessageTranslator.translateMessage(0, 'fr', 'French');

    const results = document.querySelectorAll('.translate-result');
    expect(results.length).toBe(1);
    expect(results[0].textContent).toContain('French');
  });

  test('translateMessage with no API key shows alert', async () => {
    global.alert = jest.fn();
    const orig = ApiKeyManager.getKey;
    ApiKeyManager.getKey = () => null;

    MessageTranslator.decorateMessages();
    await MessageTranslator.translateMessage(0, 'es', 'Spanish');
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('API key'));

    ApiKeyManager.getKey = orig;
  });

  test('quickTranslate uses last preferred language', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Hola' } }] }),
    });

    MessageTranslator.decorateMessages();
    await MessageTranslator.quickTranslate(0, 'es');
    const result = document.querySelector('.translate-result');
    expect(result).toBeTruthy();
    expect(result.textContent).toContain('Spanish');
  });

  test('tracks cost via CostDashboard when usage is returned', async () => {
    const usage = { prompt_tokens: 50, completion_tokens: 20 };
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Hej' } }], usage }),
    });

    await MessageTranslator.translateMessage(0, 'sv', 'Swedish');
    expect(CostDashboard.trackUsage).toHaveBeenCalledWith(usage);
  });

  test('network error shows alert', async () => {
    global.alert = jest.fn();
    fetch.mockRejectedValueOnce(new Error('Network failed'));

    MessageTranslator.decorateMessages();
    await MessageTranslator.translateMessage(0, 'ja', 'Japanese');
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('Network failed'));
  });

  test('invalid message index returns without error', async () => {
    await expect(MessageTranslator.translateMessage(99, 'es', 'Spanish')).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});
