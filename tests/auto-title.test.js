/**
 * @file tests/auto-title.test.js
 * Tests for the AutoTitle module — AI-generated session titles.
 */

const { setupDOM, loadApp } = require('./setup');

beforeEach(() => {
  setupDOM();
  loadApp();
  localStorage.clear();
});

describe('AutoTitle', () => {
  describe('isEnabled / setEnabled', () => {
    test('enabled by default when no storage key exists', () => {
      expect(AutoTitle.isEnabled()).toBe(true);
    });

    test('returns true when storage key is "true"', () => {
      localStorage.setItem('agenticchat_autotitle', 'true');
      expect(AutoTitle.isEnabled()).toBe(true);
    });

    test('returns false when storage key is "false"', () => {
      localStorage.setItem('agenticchat_autotitle', 'false');
      expect(AutoTitle.isEnabled()).toBe(false);
    });

    test('setEnabled(false) disables auto-title', () => {
      AutoTitle.setEnabled(false);
      expect(AutoTitle.isEnabled()).toBe(false);
      expect(localStorage.getItem('agenticchat_autotitle')).toBe('false');
    });

    test('setEnabled(true) enables auto-title', () => {
      AutoTitle.setEnabled(false);
      AutoTitle.setEnabled(true);
      expect(AutoTitle.isEnabled()).toBe(true);
    });
  });

  describe('_markTitled / _alreadyTitled', () => {
    test('session is not titled by default', () => {
      expect(AutoTitle._alreadyTitled('sess-1')).toBe(false);
    });

    test('marks a session as titled', () => {
      AutoTitle._markTitled('sess-1');
      expect(AutoTitle._alreadyTitled('sess-1')).toBe(true);
    });

    test('multiple sessions can be titled', () => {
      AutoTitle._markTitled('sess-1');
      AutoTitle._markTitled('sess-2');
      expect(AutoTitle._alreadyTitled('sess-1')).toBe(true);
      expect(AutoTitle._alreadyTitled('sess-2')).toBe(true);
    });

    test('titled set caps at 200 entries', () => {
      for (let i = 0; i < 210; i++) {
        AutoTitle._markTitled(`sess-${i}`);
      }
      const set = AutoTitle._getTitledSet();
      expect(set.size).toBeLessThanOrEqual(200);
      expect(set.has('sess-209')).toBe(true);
    });
  });

  describe('_applyTitle', () => {
    test('updates session name in storage', () => {
      const sessions = [{
        id: 'test-123', name: 'Old Name', messages: [],
        messageCount: 0, preview: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }];
      localStorage.setItem('agenticchat_sessions', JSON.stringify(sessions));

      AutoTitle._applyTitle('test-123', 'New AI Title');

      const updated = JSON.parse(localStorage.getItem('agenticchat_sessions'));
      expect(updated[0].name).toBe('New AI Title');
    });

    test('does nothing if session ID not found', () => {
      const sessions = [{
        id: 'test-123', name: 'Original', messages: [],
        messageCount: 0, preview: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }];
      localStorage.setItem('agenticchat_sessions', JSON.stringify(sessions));

      AutoTitle._applyTitle('nonexistent', 'Title');

      const updated = JSON.parse(localStorage.getItem('agenticchat_sessions'));
      expect(updated[0].name).toBe('Original');
    });

    test('does nothing if no sessions in storage', () => {
      expect(() => AutoTitle._applyTitle('any', 'Title')).not.toThrow();
    });
  });

  describe('generateTitle', () => {
    test('skips when disabled', async () => {
      AutoTitle.setEnabled(false);
      global.fetch = jest.fn();
      await AutoTitle.generateTitle('hello', 'world', 'sess-1');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('skips when no session ID', async () => {
      global.fetch = jest.fn();
      await AutoTitle.generateTitle('hello', 'world', null);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('skips when session already titled', async () => {
      AutoTitle._markTitled('sess-1');
      global.fetch = jest.fn();
      await AutoTitle.generateTitle('hello', 'world', 'sess-1');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('skips when no API key', async () => {
      global.fetch = jest.fn();
      await AutoTitle.generateTitle('hello', 'world', 'sess-new');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('calls API and applies title on success', async () => {
      ApiKeyManager.setOpenAIKey('sk-test-key-1234567890abcdefghijklmnopq');
      const sessions = [{
        id: 'sess-gen', name: 'hello', messages: [],
        messageCount: 1, preview: 'hello',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }];
      localStorage.setItem('agenticchat_sessions', JSON.stringify(sessions));

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Greeting the AI Assistant' } }]
        })
      });

      await AutoTitle.generateTitle('hello there', 'Hi! How can I help?', 'sess-gen');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const callBody = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(callBody.model).toBe('gpt-4o-mini');
      expect(callBody.max_tokens).toBe(20);

      const updated = JSON.parse(localStorage.getItem('agenticchat_sessions'));
      expect(updated[0].name).toBe('Greeting the AI Assistant');
    });

    test('strips surrounding quotes from title', async () => {
      ApiKeyManager.setOpenAIKey('sk-test-key-1234567890abcdefghijklmnopq');
      const sessions = [{
        id: 'sess-q', name: 'old', messages: [],
        messageCount: 1, preview: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }];
      localStorage.setItem('agenticchat_sessions', JSON.stringify(sessions));

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '"Python List Sorting"' } }]
        })
      });

      await AutoTitle.generateTitle('sort list', 'Use sorted()', 'sess-q');

      const updated = JSON.parse(localStorage.getItem('agenticchat_sessions'));
      expect(updated[0].name).toBe('Python List Sorting');
    });

    test('removes trailing periods from title', async () => {
      ApiKeyManager.setOpenAIKey('sk-test-key-1234567890abcdefghijklmnopq');
      const sessions = [{
        id: 'sess-p', name: 'old', messages: [],
        messageCount: 1, preview: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }];
      localStorage.setItem('agenticchat_sessions', JSON.stringify(sessions));

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'JavaScript Array Methods.' } }]
        })
      });

      await AutoTitle.generateTitle('arrays', 'Use map/filter', 'sess-p');

      const updated = JSON.parse(localStorage.getItem('agenticchat_sessions'));
      expect(updated[0].name).toBe('JavaScript Array Methods');
    });

    test('handles API failure gracefully', async () => {
      ApiKeyManager.setOpenAIKey('sk-test-key-1234567890abcdefghijklmnopq');
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });

      await expect(
        AutoTitle.generateTitle('hello', 'world', 'sess-fail')
      ).resolves.not.toThrow();
    });

    test('handles network error gracefully', async () => {
      ApiKeyManager.setOpenAIKey('sk-test-key-1234567890abcdefghijklmnopq');
      global.fetch = jest.fn().mockRejectedValue(new Error('Network failure'));

      await expect(
        AutoTitle.generateTitle('hello', 'world', 'sess-net')
      ).resolves.not.toThrow();
    });

    test('prevents duplicate calls for same session', async () => {
      ApiKeyManager.setOpenAIKey('sk-test-key-1234567890abcdefghijklmnopq');
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Title' } }]
        })
      });

      await AutoTitle.generateTitle('hello', 'world', 'sess-dup');
      await AutoTitle.generateTitle('hello', 'world', 'sess-dup');

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('rejects titles that are too short', async () => {
      ApiKeyManager.setOpenAIKey('sk-test-key-1234567890abcdefghijklmnopq');
      const sessions = [{
        id: 'sess-short', name: 'original', messages: [],
        messageCount: 1, preview: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }];
      localStorage.setItem('agenticchat_sessions', JSON.stringify(sessions));

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'X' } }]
        })
      });

      await AutoTitle.generateTitle('hello', 'world', 'sess-short');

      const updated = JSON.parse(localStorage.getItem('agenticchat_sessions'));
      expect(updated[0].name).toBe('original');
    });

    test('truncates long user messages for API call', async () => {
      ApiKeyManager.setOpenAIKey('sk-test-key-1234567890abcdefghijklmnopq');

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Long Message Discussion' } }]
        })
      });

      const longMsg = 'a'.repeat(1000);
      await AutoTitle.generateTitle(longMsg, 'reply', 'sess-long');

      const callBody = JSON.parse(global.fetch.mock.calls[0][1].body);
      const userContent = callBody.messages[1].content;
      expect(userContent.length).toBeLessThan(1020);
    });
  });

  describe('onMessageComplete', () => {
    test('does nothing when disabled', () => {
      AutoTitle.setEnabled(false);
      global.fetch = jest.fn();
      AutoTitle.onMessageComplete();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('does nothing when no messages', () => {
      global.fetch = jest.fn();
      AutoTitle.onMessageComplete();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('does nothing when more than one exchange', () => {
      ConversationManager.addMessage('user', 'first');
      ConversationManager.addMessage('assistant', 'reply 1');
      ConversationManager.addMessage('user', 'second');
      ConversationManager.addMessage('assistant', 'reply 2');
      global.fetch = jest.fn();
      AutoTitle.onMessageComplete();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('does nothing when no active session ID', () => {
      ConversationManager.addMessage('user', 'hello');
      ConversationManager.addMessage('assistant', 'hi');
      global.fetch = jest.fn();
      AutoTitle.onMessageComplete();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('triggers title generation on first exchange with active session', async () => {
      ApiKeyManager.setOpenAIKey('sk-test-key-1234567890abcdefghijklmnopq');
      const sessions = [{
        id: 'sess-hook', name: 'hello', messages: [],
        messageCount: 1, preview: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }];
      localStorage.setItem('agenticchat_sessions', JSON.stringify(sessions));
      localStorage.setItem('agenticchat_active_session', 'sess-hook');

      ConversationManager.addMessage('user', 'What is Python?');
      ConversationManager.addMessage('assistant', 'Python is a programming language.');

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Introduction to Python' } }]
        })
      });

      AutoTitle.onMessageComplete();

      await new Promise(r => setTimeout(r, 50));

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const updated = JSON.parse(localStorage.getItem('agenticchat_sessions'));
      expect(updated[0].name).toBe('Introduction to Python');
    });
  });
});
