/**
 * Agentic Chat — Unit Tests
 *
 * Tests for the core modules: ChatConfig, ConversationManager,
 * ApiKeyManager, UIController, and SandboxRunner.
 */

const { setupDOM, loadApp } = require('./setup');

beforeEach(() => {
  setupDOM();
  loadApp();
});

/* ================================================================
 * ChatConfig
 * ================================================================ */
describe('ChatConfig', () => {
  test('is frozen and cannot be mutated', () => {
    expect(Object.isFrozen(ChatConfig)).toBe(true);
    // In strict mode this throws; in sloppy mode the assignment silently fails
    ChatConfig.MODEL = 'gpt-3.5';
    expect(ChatConfig.MODEL).toBe('gpt-4o'); // still the original value
  });

  test('has required configuration values', () => {
    expect(ChatConfig.MODEL).toBe('gpt-4o');
    expect(ChatConfig.MAX_TOKENS_RESPONSE).toBe(4096);
    expect(ChatConfig.MAX_HISTORY_PAIRS).toBe(20);
    expect(ChatConfig.MAX_INPUT_CHARS).toBe(50000);
    expect(ChatConfig.MAX_TOTAL_TOKENS).toBe(100000);
    expect(ChatConfig.CHARS_PER_TOKEN).toBe(4);
    expect(ChatConfig.TOKEN_WARNING_THRESHOLD).toBe(80000);
    expect(ChatConfig.SANDBOX_TIMEOUT_MS).toBe(30000);
  });

  test('SYSTEM_PROMPT instructs autonomous agent behavior', () => {
    expect(ChatConfig.SYSTEM_PROMPT).toContain('autonomous agent');
    expect(ChatConfig.SYSTEM_PROMPT).toContain('JavaScript');
    expect(ChatConfig.SYSTEM_PROMPT).toContain('return');
  });
});

/* ================================================================
 * ConversationManager
 * ================================================================ */
describe('ConversationManager', () => {
  test('starts with system prompt only', () => {
    const history = ConversationManager.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].role).toBe('system');
    expect(history[0].content).toBe(ChatConfig.SYSTEM_PROMPT);
  });

  test('addMessage appends to history', () => {
    ConversationManager.addMessage('user', 'Hello');
    ConversationManager.addMessage('assistant', 'Hi there');

    const history = ConversationManager.getHistory();
    expect(history).toHaveLength(3);
    expect(history[1]).toEqual({ role: 'user', content: 'Hello' });
    expect(history[2]).toEqual({ role: 'assistant', content: 'Hi there' });
  });

  test('getMessages returns a copy, not a reference', () => {
    ConversationManager.addMessage('user', 'test');
    const copy = ConversationManager.getMessages();
    copy.push({ role: 'user', content: 'injected' });

    // Original should not be affected
    expect(ConversationManager.getHistory()).toHaveLength(2);
  });

  test('popLast removes the last message', () => {
    ConversationManager.addMessage('user', 'will be removed');
    expect(ConversationManager.getHistory()).toHaveLength(2);

    ConversationManager.popLast();
    expect(ConversationManager.getHistory()).toHaveLength(1);
    expect(ConversationManager.getHistory()[0].role).toBe('system');
  });

  test('popLast does not remove system prompt', () => {
    ConversationManager.popLast(); // try to pop system prompt
    expect(ConversationManager.getHistory()).toHaveLength(1);
    expect(ConversationManager.getHistory()[0].role).toBe('system');
  });

  test('trim keeps at most MAX_HISTORY_PAIRS exchanges', () => {
    const maxPairs = ChatConfig.MAX_HISTORY_PAIRS;

    // Add more than max pairs
    for (let i = 0; i < maxPairs + 5; i++) {
      ConversationManager.addMessage('user', `q${i}`);
      ConversationManager.addMessage('assistant', `a${i}`);
    }

    ConversationManager.trim();
    const history = ConversationManager.getHistory();

    // system + (maxPairs * 2) messages
    expect(history).toHaveLength(1 + maxPairs * 2);
    expect(history[0].role).toBe('system');

    // Should keep the most recent messages
    const lastUser = history[history.length - 2];
    const lastAssistant = history[history.length - 1];
    expect(lastUser.content).toBe(`q${maxPairs + 4}`);
    expect(lastAssistant.content).toBe(`a${maxPairs + 4}`);
  });

  test('trim is a no-op when under limit', () => {
    ConversationManager.addMessage('user', 'short');
    ConversationManager.addMessage('assistant', 'chat');
    ConversationManager.trim();

    expect(ConversationManager.getHistory()).toHaveLength(3);
  });

  test('clear resets to system prompt only', () => {
    ConversationManager.addMessage('user', 'stuff');
    ConversationManager.addMessage('assistant', 'more stuff');
    ConversationManager.clear();

    const history = ConversationManager.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].role).toBe('system');
  });

  test('estimateTokens returns reasonable values', () => {
    // System prompt only
    const baseTokens = ConversationManager.estimateTokens();
    expect(baseTokens).toBeGreaterThan(0);

    // Add a known-length message
    const msg = 'a'.repeat(400); // 400 chars / 4 = 100 tokens
    ConversationManager.addMessage('user', msg);

    const newTokens = ConversationManager.estimateTokens();
    expect(newTokens).toBe(baseTokens + 100);
  });
});

/* ================================================================
 * ApiKeyManager
 * ================================================================ */
describe('ApiKeyManager', () => {
  test('OpenAI key starts null', () => {
    expect(ApiKeyManager.getOpenAIKey()).toBeNull();
  });

  test('set and get OpenAI key', () => {
    ApiKeyManager.setOpenAIKey('sk-test123');
    expect(ApiKeyManager.getOpenAIKey()).toBe('sk-test123');
  });

  test('clearOpenAIKey resets to null', () => {
    ApiKeyManager.setOpenAIKey('sk-test123');
    ApiKeyManager.clearOpenAIKey();
    expect(ApiKeyManager.getOpenAIKey()).toBeNull();
  });

  test('substituteServiceKey returns code unchanged when no placeholder', () => {
    const code = 'console.log("hello")';
    expect(ApiKeyManager.substituteServiceKey(code)).toBe(code);
  });

  test('substituteServiceKey returns null when key needed (shows modal)', () => {
    const code = 'fetch("https://api.weather.com/v1?key=YOUR_API_KEY")';
    const result = ApiKeyManager.substituteServiceKey(code);
    expect(result).toBeNull();
    expect(ApiKeyManager.getPendingDomain()).toBe('api.weather.com');
  });

  test('submitServiceKey replaces placeholder and clears pending state', () => {
    const code = 'fetch("https://api.weather.com/v1?key=YOUR_API_KEY")';
    ApiKeyManager.substituteServiceKey(code);

    const result = ApiKeyManager.submitServiceKey('real-key-123');
    expect(result).toContain('real-key-123');
    expect(result).not.toContain('YOUR_API_KEY');
    expect(ApiKeyManager.getPendingDomain()).toBeNull();
  });

  test('substituteServiceKey uses cached key on second call', () => {
    const code1 = 'fetch("https://api.weather.com/v1?key=YOUR_API_KEY")';
    ApiKeyManager.substituteServiceKey(code1);
    ApiKeyManager.submitServiceKey('cached-key');

    // Second call with same domain should auto-substitute
    const code2 = 'fetch("https://api.weather.com/v2?key=YOUR_API_KEY")';
    const result = ApiKeyManager.substituteServiceKey(code2);
    expect(result).toContain('cached-key');
    expect(result).not.toContain('YOUR_API_KEY');
  });

  test('extractDomain handles various URL formats', () => {
    expect(ApiKeyManager.extractDomain('https://api.example.com/v1')).toBe('api.example.com');
    expect(ApiKeyManager.extractDomain('http://localhost:3000/test')).toBe('localhost:3000');
    expect(ApiKeyManager.extractDomain('no url here')).toBe('Unknown Service');
  });

  test('submitServiceKey returns null for empty key', () => {
    const code = 'fetch("https://api.test.com/YOUR_API_KEY")';
    ApiKeyManager.substituteServiceKey(code);
    expect(ApiKeyManager.submitServiceKey('')).toBeNull();
  });
});

/* ================================================================
 * UIController
 * ================================================================ */
describe('UIController', () => {
  test('setChatOutput updates text content', () => {
    UIController.setChatOutput('Hello World');
    expect(document.getElementById('chat-output').textContent).toBe('Hello World');
  });

  test('setConsoleOutput updates text and optional color', () => {
    UIController.setConsoleOutput('Running...', '#4ade80');
    const el = document.getElementById('console-output');
    expect(el.textContent).toBe('Running...');
    // JSDOM normalizes hex colors to rgb()
    expect(el.style.color).toBe('rgb(74, 222, 128)');
  });

  test('setLastPrompt updates last prompt display', () => {
    UIController.setLastPrompt('Last input: test');
    expect(document.getElementById('last-prompt').textContent).toBe('Last input: test');
  });

  test('setSendingState disables send button and input', () => {
    UIController.setSendingState(true);
    const btn = document.getElementById('send-btn');
    const input = document.getElementById('chat-input');
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('Sending…');
    expect(input.disabled).toBe(true);

    UIController.setSendingState(false);
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Send');
    expect(input.disabled).toBe(false);
  });

  test('setSandboxRunning shows/hides cancel button', () => {
    UIController.setSandboxRunning(true);
    expect(document.getElementById('cancel-btn').style.display).toBe('inline-block');
    expect(document.getElementById('send-btn').disabled).toBe(true);
    expect(document.getElementById('send-btn').textContent).toBe('Running…');
  });

  test('resetSandboxUI restores default button state', () => {
    UIController.setSandboxRunning(true);
    UIController.resetSandboxUI();
    expect(document.getElementById('cancel-btn').style.display).toBe('none');
    expect(document.getElementById('send-btn').disabled).toBe(false);
    expect(document.getElementById('send-btn').textContent).toBe('Send');
  });

  test('showTokenUsage displays formatted token info', () => {
    UIController.showTokenUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150
    });
    const text = document.getElementById('token-usage').textContent;
    expect(text).toContain('100');
    expect(text).toContain('50');
    expect(text).toContain('150');
    expect(text).toContain('$');
  });

  test('showTokenUsage handles missing usage gracefully', () => {
    UIController.showTokenUsage(null);
    // Should not throw
    expect(document.getElementById('token-usage').textContent).toBe('');
  });

  test('getChatInput and clearChatInput work correctly', () => {
    const input = document.getElementById('chat-input');
    input.value = '  hello world  ';
    expect(UIController.getChatInput()).toBe('hello world');

    UIController.clearChatInput();
    expect(document.getElementById('chat-input').value).toBe('');
  });

  test('displayCode creates a pre element inside chat output', () => {
    UIController.displayCode('console.log("test")');
    const pre = document.getElementById('chat-output').querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre.textContent).toBe('console.log("test")');
  });

  test('updateCharCount shows warning near limit', () => {
    const counter = document.getElementById('char-count');

    // Under threshold — should be empty
    UIController.updateCharCount(100);
    expect(counter.textContent).toBe('');

    // Over 80% of limit — show warning
    UIController.updateCharCount(41000);
    expect(counter.textContent).toContain('41,000');
    // JSDOM normalizes hex colors to rgb()
    expect(counter.style.color).toBe('rgb(245, 158, 11)');

    // Over limit — red
    UIController.updateCharCount(51000);
    expect(counter.style.color).toBe('rgb(239, 68, 68)');
  });

  test('showServiceKeyModal displays modal and sets domain', () => {
    UIController.showServiceKeyModal('api.example.com');
    const modal = document.getElementById('apikey-modal');
    expect(modal.style.display).toBe('flex');
    expect(document.getElementById('api-service-name').textContent).toBe('api.example.com');
  });

  test('hideServiceKeyModal hides modal and clears input', () => {
    UIController.showServiceKeyModal('api.example.com');
    document.getElementById('user-api-key').value = 'secret';

    UIController.hideServiceKeyModal();
    expect(document.getElementById('apikey-modal').style.display).toBe('none');
    expect(document.getElementById('user-api-key').value).toBe('');
  });

  test('showApiKeyInput creates password input in toolbar', () => {
    UIController.showApiKeyInput();
    const apiKeyInput = document.getElementById('api-key');
    expect(apiKeyInput).not.toBeNull();
    expect(apiKeyInput.type).toBe('password');
    expect(apiKeyInput.placeholder).toBe('OpenAI API Key');
  });

  test('showApiKeyInput is idempotent', () => {
    UIController.showApiKeyInput();
    UIController.showApiKeyInput();
    const inputs = document.querySelectorAll('#api-key');
    expect(inputs).toHaveLength(1);
  });

  test('removeApiKeyInput removes the input', () => {
    UIController.showApiKeyInput();
    UIController.removeApiKeyInput();
    expect(document.getElementById('api-key')).toBeNull();
  });
});

/* ================================================================
 * SandboxRunner
 * ================================================================ */
describe('SandboxRunner', () => {
  test('isRunning returns false initially', () => {
    expect(SandboxRunner.isRunning()).toBe(false);
  });

  test('cancel is safe to call when nothing is running', () => {
    expect(() => SandboxRunner.cancel()).not.toThrow();
  });
});

/* ================================================================
 * Integration: ConversationManager token estimation
 * ================================================================ */
describe('ConversationManager — token estimation accuracy', () => {
  test('large conversation produces proportional token count', () => {
    // Each message is 200 chars = 50 tokens
    for (let i = 0; i < 10; i++) {
      ConversationManager.addMessage('user', 'x'.repeat(200));
      ConversationManager.addMessage('assistant', 'y'.repeat(200));
    }

    const tokens = ConversationManager.estimateTokens();
    // System prompt + 20 messages of 200 chars each
    const expectedMessageTokens = 20 * 50; // 1000
    // Total should be > 1000 (system prompt adds more)
    expect(tokens).toBeGreaterThan(1000);
    expect(tokens).toBeLessThan(1200); // system prompt is ~40 tokens
  });
});

/* ================================================================
 * Integration: Cost calculation
 * ================================================================ */
describe('Token cost calculation', () => {
  test('cost is calculated using GPT-4o rates', () => {
    UIController.showTokenUsage({
      prompt_tokens: 1000,
      completion_tokens: 500,
      total_tokens: 1500
    });
    const text = document.getElementById('token-usage').textContent;
    // Cost = (1000 * 2.5 + 500 * 10) / 1_000_000 = 0.0075
    expect(text).toContain('$0.0075');
  });
});

/* ================================================================
 * PromptTemplates
 * ================================================================ */
describe('PromptTemplates', () => {
  test('getTemplates returns all categories', () => {
    const templates = PromptTemplates.getTemplates();
    expect(templates.length).toBe(4);
    expect(templates[0].category).toContain('Data');
    expect(templates[1].category).toContain('Web');
    expect(templates[2].category).toContain('Utilities');
    expect(templates[3].category).toContain('Fun');
  });

  test('each template has name, description, and prompt', () => {
    const templates = PromptTemplates.getTemplates();
    templates.forEach(cat => {
      expect(cat.items.length).toBeGreaterThan(0);
      cat.items.forEach(item => {
        expect(typeof item.name).toBe('string');
        expect(item.name.length).toBeGreaterThan(0);
        expect(typeof item.description).toBe('string');
        expect(item.description.length).toBeGreaterThan(0);
        expect(typeof item.prompt).toBe('string');
        expect(item.prompt.length).toBeGreaterThan(10);
      });
    });
  });

  test('search filters templates by name', () => {
    const results = PromptTemplates.search('bar chart');
    expect(results.length).toBeGreaterThan(0);
    const items = results.flatMap(c => c.items);
    expect(items.some(i => i.name === 'Bar Chart')).toBe(true);
  });

  test('search filters templates by description', () => {
    const results = PromptTemplates.search('password');
    const items = results.flatMap(c => c.items);
    expect(items.some(i => i.name === 'Password Generator')).toBe(true);
  });

  test('search returns empty array for no matches', () => {
    const results = PromptTemplates.search('xyznonexistent123');
    expect(results).toHaveLength(0);
  });

  test('search with empty string returns all templates', () => {
    const results = PromptTemplates.search('');
    expect(results.length).toBe(4);
  });

  test('toggle opens and closes the panel', () => {
    const panel = document.getElementById('templates-panel');
    const overlay = document.getElementById('templates-overlay');

    expect(panel.classList.contains('open')).toBe(false);

    PromptTemplates.toggle();
    expect(panel.classList.contains('open')).toBe(true);
    expect(overlay.classList.contains('visible')).toBe(true);

    PromptTemplates.toggle();
    expect(panel.classList.contains('open')).toBe(false);
    expect(overlay.classList.contains('visible')).toBe(false);
  });

  test('close always closes the panel', () => {
    PromptTemplates.toggle(); // open
    PromptTemplates.close();

    const panel = document.getElementById('templates-panel');
    expect(panel.classList.contains('open')).toBe(false);
  });

  test('render populates the templates list', () => {
    const data = PromptTemplates.getTemplates();
    PromptTemplates.render(data);

    const container = document.getElementById('templates-list');
    const categories = container.querySelectorAll('.template-category');
    expect(categories.length).toBe(4);

    const cards = container.querySelectorAll('.template-card');
    const totalItems = data.reduce((sum, c) => sum + c.items.length, 0);
    expect(cards.length).toBe(totalItems);
  });

  test('render shows empty state for no results', () => {
    PromptTemplates.render([]);
    const container = document.getElementById('templates-list');
    expect(container.querySelector('.templates-empty')).not.toBeNull();
    expect(container.textContent).toContain('No templates match');
  });

  test('selectTemplate inserts prompt into chat input and closes panel', () => {
    PromptTemplates.toggle(); // open

    const item = { name: 'Test', description: 'desc', prompt: 'Hello from template' };
    PromptTemplates.selectTemplate(item);

    const input = document.getElementById('chat-input');
    expect(input.value).toBe('Hello from template');

    const panel = document.getElementById('templates-panel');
    expect(panel.classList.contains('open')).toBe(false);
  });

  test('handleSearch filters rendered templates', () => {
    PromptTemplates.toggle(); // open and render

    const searchInput = document.getElementById('templates-search');
    searchInput.value = 'clock';
    PromptTemplates.handleSearch();

    const container = document.getElementById('templates-list');
    const cards = container.querySelectorAll('.template-card');
    expect(cards.length).toBe(1);
    expect(cards[0].querySelector('.template-name').textContent).toBe('Digital Clock');
  });

  test('template cards have correct accessibility attributes', () => {
    PromptTemplates.render(PromptTemplates.getTemplates());
    const cards = document.querySelectorAll('.template-card');
    cards.forEach(card => {
      expect(card.getAttribute('role')).toBe('button');
      expect(card.getAttribute('tabindex')).toBe('0');
    });
  });
});

/* ================================================================
 * HistoryPanel
 * ================================================================ */
describe('HistoryPanel', () => {
  test('toggle opens and closes the panel', () => {
    const panel = document.getElementById('history-panel');
    const overlay = document.getElementById('history-overlay');

    expect(panel.classList.contains('open')).toBe(false);

    HistoryPanel.toggle();
    expect(panel.classList.contains('open')).toBe(true);
    expect(overlay.classList.contains('visible')).toBe(true);

    HistoryPanel.toggle();
    expect(panel.classList.contains('open')).toBe(false);
    expect(overlay.classList.contains('visible')).toBe(false);
  });

  test('close always closes the panel', () => {
    HistoryPanel.toggle(); // open
    HistoryPanel.close();

    const panel = document.getElementById('history-panel');
    expect(panel.classList.contains('open')).toBe(false);
  });

  test('refresh shows empty state with no messages', () => {
    HistoryPanel.refresh();
    const container = document.getElementById('history-messages');
    expect(container.querySelector('.history-empty')).not.toBeNull();
    expect(container.textContent).toContain('No messages yet');
  });

  test('refresh renders user and assistant messages', () => {
    ConversationManager.addMessage('user', 'Hello world');
    ConversationManager.addMessage('assistant', 'Hi there');
    HistoryPanel.refresh();

    const container = document.getElementById('history-messages');
    const msgs = container.querySelectorAll('.history-msg');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].classList.contains('user')).toBe(true);
    expect(msgs[1].classList.contains('assistant')).toBe(true);
    expect(msgs[0].textContent).toContain('Hello world');
    expect(msgs[1].textContent).toContain('Hi there');
  });

  test('refresh renders code blocks in assistant messages', () => {
    ConversationManager.addMessage('user', 'Write code');
    ConversationManager.addMessage('assistant', '```js\nconsole.log("test")\n```');
    HistoryPanel.refresh();

    const container = document.getElementById('history-messages');
    const pre = container.querySelector('.history-msg.assistant pre');
    expect(pre).not.toBeNull();
    expect(pre.textContent).toBe('console.log("test")\n');
  });

  test('exportAsMarkdown alerts when no messages', () => {
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    HistoryPanel.exportAsMarkdown();
    expect(alertSpy).toHaveBeenCalledWith('No conversation to export.');
    alertSpy.mockRestore();
  });

  test('exportAsJSON alerts when no messages', () => {
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    HistoryPanel.exportAsJSON();
    expect(alertSpy).toHaveBeenCalledWith('No conversation to export.');
    alertSpy.mockRestore();
  });
});

/* ================================================================
 * SnippetLibrary
 * ================================================================ */
describe('SnippetLibrary', () => {
  beforeEach(() => {
    localStorage.clear();
    SnippetLibrary.setCurrentCode(null);
  });

  test('starts with no snippets', () => {
    expect(SnippetLibrary.getAll()).toEqual([]);
    expect(SnippetLibrary.getCount()).toBe(0);
  });

  test('add creates a snippet with correct fields', () => {
    const snippets = SnippetLibrary.add('Test Snippet', 'console.log("hi")', ['test', 'demo']);
    expect(snippets).toHaveLength(1);
    expect(snippets[0].name).toBe('Test Snippet');
    expect(snippets[0].code).toBe('console.log("hi")');
    expect(snippets[0].tags).toEqual(['test', 'demo']);
    expect(snippets[0].id).toBeDefined();
    expect(snippets[0].createdAt).toBeDefined();
  });

  test('add prepends new snippets (newest first)', () => {
    SnippetLibrary.add('First', 'code1', []);
    SnippetLibrary.add('Second', 'code2', []);
    const all = SnippetLibrary.getAll();
    expect(all[0].name).toBe('Second');
    expect(all[1].name).toBe('First');
  });

  test('add filters empty tags', () => {
    const snippets = SnippetLibrary.add('Test', 'code', ['valid', '', '  ', 'also-valid']);
    // Only non-empty after trim
    expect(snippets[0].tags).toEqual(['valid', 'also-valid']);
  });

  test('remove deletes snippet by ID', () => {
    SnippetLibrary.add('Keep', 'keep-code', []);
    SnippetLibrary.add('Delete', 'delete-code', []);
    const all = SnippetLibrary.getAll();
    const deleteId = all.find(s => s.name === 'Delete').id;

    const remaining = SnippetLibrary.remove(deleteId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].name).toBe('Keep');
  });

  test('remove with non-existent ID is safe', () => {
    SnippetLibrary.add('Test', 'code', []);
    const remaining = SnippetLibrary.remove('non-existent-id');
    expect(remaining).toHaveLength(1);
  });

  test('rename updates snippet name', () => {
    SnippetLibrary.add('Old Name', 'code', []);
    const id = SnippetLibrary.getAll()[0].id;

    SnippetLibrary.rename(id, 'New Name');
    expect(SnippetLibrary.getAll()[0].name).toBe('New Name');
  });

  test('rename trims whitespace', () => {
    SnippetLibrary.add('Test', 'code', []);
    const id = SnippetLibrary.getAll()[0].id;

    SnippetLibrary.rename(id, '  Trimmed  ');
    expect(SnippetLibrary.getAll()[0].name).toBe('Trimmed');
  });

  test('clearAll removes all snippets', () => {
    SnippetLibrary.add('One', 'code1', []);
    SnippetLibrary.add('Two', 'code2', []);
    SnippetLibrary.clearAll();
    expect(SnippetLibrary.getAll()).toEqual([]);
    expect(SnippetLibrary.getCount()).toBe(0);
  });

  test('search filters by name', () => {
    SnippetLibrary.add('Bar Chart', 'chart-code', []);
    SnippetLibrary.add('Password Gen', 'pass-code', []);
    const results = SnippetLibrary.search('bar');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Bar Chart');
  });

  test('search filters by tag', () => {
    SnippetLibrary.add('Chart', 'code', ['canvas', 'data']);
    SnippetLibrary.add('Form', 'code', ['html', 'input']);
    const results = SnippetLibrary.search('canvas');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Chart');
  });

  test('search filters by code content', () => {
    SnippetLibrary.add('Alpha', 'document.getElementById("x")', []);
    SnippetLibrary.add('Beta', 'fetch("https://api.com")', []);
    const results = SnippetLibrary.search('getElementById');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Alpha');
  });

  test('search with empty query returns all', () => {
    SnippetLibrary.add('One', 'code1', []);
    SnippetLibrary.add('Two', 'code2', []);
    expect(SnippetLibrary.search('')).toHaveLength(2);
  });

  test('search is case-insensitive', () => {
    SnippetLibrary.add('MY CHART', 'code', ['DATA']);
    expect(SnippetLibrary.search('my chart')).toHaveLength(1);
    expect(SnippetLibrary.search('data')).toHaveLength(1);
  });

  test('setCurrentCode shows/hides code-actions', () => {
    const actionsEl = document.getElementById('code-actions');

    SnippetLibrary.setCurrentCode('some code');
    expect(actionsEl.style.display).toBe('flex');
    expect(SnippetLibrary.getCurrentCode()).toBe('some code');

    SnippetLibrary.setCurrentCode(null);
    expect(actionsEl.style.display).toBe('none');
    expect(SnippetLibrary.getCurrentCode()).toBeNull();
  });

  test('openSaveDialog shows modal with code preview', () => {
    SnippetLibrary.setCurrentCode('line1\nline2\nline3\nline4\nline5\nline6\nline7');
    SnippetLibrary.openSaveDialog();

    const modal = document.getElementById('snippet-save-modal');
    expect(modal.style.display).toBe('flex');

    const preview = document.getElementById('snippet-code-preview');
    expect(preview.textContent).toContain('line1');
    expect(preview.textContent).toContain('line5');
    expect(preview.textContent).toContain('2 more lines');
  });

  test('openSaveDialog does nothing when no current code', () => {
    SnippetLibrary.setCurrentCode(null);
    SnippetLibrary.openSaveDialog();
    const modal = document.getElementById('snippet-save-modal');
    expect(modal.style.display).not.toBe('flex');
  });

  test('confirmSave saves snippet and closes dialog', () => {
    SnippetLibrary.setCurrentCode('test code');
    SnippetLibrary.openSaveDialog();

    document.getElementById('snippet-name-input').value = 'My Snippet';
    document.getElementById('snippet-tags-input').value = 'test, demo';
    SnippetLibrary.confirmSave();

    expect(SnippetLibrary.getCount()).toBe(1);
    const saved = SnippetLibrary.getAll()[0];
    expect(saved.name).toBe('My Snippet');
    expect(saved.code).toBe('test code');
    expect(saved.tags).toEqual(['test', 'demo']);

    const modal = document.getElementById('snippet-save-modal');
    expect(modal.style.display).toBe('none');
  });

  test('confirmSave does not save with empty name', () => {
    SnippetLibrary.setCurrentCode('test code');
    SnippetLibrary.openSaveDialog();

    document.getElementById('snippet-name-input').value = '';
    SnippetLibrary.confirmSave();

    expect(SnippetLibrary.getCount()).toBe(0);
  });

  test('closeSaveDialog hides modal', () => {
    SnippetLibrary.setCurrentCode('code');
    SnippetLibrary.openSaveDialog();
    SnippetLibrary.closeSaveDialog();

    const modal = document.getElementById('snippet-save-modal');
    expect(modal.style.display).toBe('none');
  });

  test('toggle opens and closes panel', () => {
    const panel = document.getElementById('snippets-panel');
    const overlay = document.getElementById('snippets-overlay');

    expect(panel.classList.contains('open')).toBe(false);

    SnippetLibrary.toggle();
    expect(panel.classList.contains('open')).toBe(true);
    expect(overlay.classList.contains('visible')).toBe(true);

    SnippetLibrary.toggle();
    expect(panel.classList.contains('open')).toBe(false);
    expect(overlay.classList.contains('visible')).toBe(false);
  });

  test('close always closes panel', () => {
    SnippetLibrary.toggle();
    SnippetLibrary.close();

    const panel = document.getElementById('snippets-panel');
    expect(panel.classList.contains('open')).toBe(false);
  });

  test('render shows empty state with no snippets', () => {
    SnippetLibrary.render([]);
    const container = document.getElementById('snippets-list');
    expect(container.querySelector('.snippets-empty')).not.toBeNull();
    expect(container.textContent).toContain('No saved snippets');
  });

  test('render shows snippet cards', () => {
    SnippetLibrary.add('Chart Code', 'canvas.draw()', ['chart']);
    SnippetLibrary.add('API Call', 'fetch("url")', ['api']);

    const snippets = SnippetLibrary.getAll();
    SnippetLibrary.render(snippets);

    const container = document.getElementById('snippets-list');
    const cards = container.querySelectorAll('.snippet-card');
    expect(cards).toHaveLength(2);

    // Check first card (newest = API Call)
    expect(cards[0].querySelector('.snippet-name').textContent).toBe('API Call');
    expect(cards[0].querySelector('.snippet-tag').textContent).toBe('api');
    expect(cards[0].querySelector('.snippet-code-preview').textContent).toContain('fetch');
  });

  test('render shows code preview truncated at 3 lines', () => {
    SnippetLibrary.add('Multi', 'line1\nline2\nline3\nline4\nline5', []);
    SnippetLibrary.render(SnippetLibrary.getAll());

    const preview = document.querySelector('.snippet-code-preview');
    expect(preview.textContent).toContain('line1');
    expect(preview.textContent).toContain('line3');
    expect(preview.textContent).toContain('…');
  });

  test('formatRelativeTime returns human-readable times', () => {
    const now = new Date();
    expect(SnippetLibrary.formatRelativeTime(now.toISOString())).toBe('just now');

    const fiveMin = new Date(now - 5 * 60000);
    expect(SnippetLibrary.formatRelativeTime(fiveMin.toISOString())).toBe('5m ago');

    const threeHours = new Date(now - 3 * 3600000);
    expect(SnippetLibrary.formatRelativeTime(threeHours.toISOString())).toBe('3h ago');

    const twoDays = new Date(now - 2 * 86400000);
    expect(SnippetLibrary.formatRelativeTime(twoDays.toISOString())).toBe('2d ago');
  });

  test('getCount returns correct count', () => {
    expect(SnippetLibrary.getCount()).toBe(0);
    SnippetLibrary.add('A', 'code', []);
    expect(SnippetLibrary.getCount()).toBe(1);
    SnippetLibrary.add('B', 'code', []);
    expect(SnippetLibrary.getCount()).toBe(2);
  });

  test('persists to localStorage', () => {
    SnippetLibrary.add('Persistent', 'my code', ['saved']);
    const raw = localStorage.getItem('agenticchat_snippets');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('Persistent');
  });

  test('handles corrupted localStorage gracefully', () => {
    localStorage.setItem('agenticchat_snippets', 'not valid json');
    expect(SnippetLibrary.getAll()).toEqual([]);
  });

  test('handleClearAll requires confirmation', () => {
    SnippetLibrary.add('Test', 'code', []);

    // Cancel confirmation
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
    SnippetLibrary.handleClearAll();
    expect(SnippetLibrary.getCount()).toBe(1);

    // Accept confirmation
    confirmSpy.mockReturnValue(true);
    SnippetLibrary.handleClearAll();
    expect(SnippetLibrary.getCount()).toBe(0);

    confirmSpy.mockRestore();
  });

  test('handleClearAll does nothing when no snippets', () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    SnippetLibrary.handleClearAll(); // should not call confirm
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
