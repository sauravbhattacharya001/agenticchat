/**
 * @jest-environment jsdom
 */
const { setupDOM, loadApp } = require('./setup');

beforeAll(() => { setupDOM(); loadApp(); });
beforeEach(() => {
  localStorage.clear();
  MessageEditor.clearEditHistory();
  ConversationManager.clear();
  ConversationManager.addMessage('user', 'Hello');
  ConversationManager.addMessage('assistant', 'Hi there! How can I help?');
  ConversationManager.addMessage('user', 'Explain closures');
  ConversationManager.addMessage('assistant', 'A closure captures variables from its enclosing scope.');
});

describe('MessageEditor', () => {
  test('module exists with expected API', () => {
    expect(MessageEditor).toBeDefined();
    expect(typeof MessageEditor.editAt).toBe('function');
    expect(typeof MessageEditor.decorateOne).toBe('function');
    expect(typeof MessageEditor.decorateMessages).toBe('function');
    expect(typeof MessageEditor.getEditHistory).toBe('function');
    expect(typeof MessageEditor.clearEditHistory).toBe('function');
  });

  // -- ConversationManager.truncateAt tests --

  test('truncateAt removes messages from given index onward', () => {
    const before = ConversationManager.getHistory().length;
    // history: [system, user, assistant, user, assistant] = 5 msgs
    expect(before).toBe(5);

    ConversationManager.truncateAt(3); // remove index 3 onward (2nd user + 2nd assistant)
    const after = ConversationManager.getHistory().length;
    expect(after).toBe(3); // system + 1st user + 1st assistant
  });

  test('truncateAt with index 1 keeps only system message', () => {
    ConversationManager.truncateAt(1);
    expect(ConversationManager.getHistory().length).toBe(1);
    expect(ConversationManager.getHistory()[0].role).toBe('system');
  });

  test('truncateAt with index 0 does nothing (protects system message)', () => {
    const before = ConversationManager.getHistory().length;
    ConversationManager.truncateAt(0);
    expect(ConversationManager.getHistory().length).toBe(before);
  });

  test('truncateAt with index beyond history length does nothing', () => {
    const before = ConversationManager.getHistory().length;
    ConversationManager.truncateAt(100);
    expect(ConversationManager.getHistory().length).toBe(before);
  });

  test('truncateAt updates token estimate', () => {
    const tokensBefore = ConversationManager.estimateTokens();
    ConversationManager.truncateAt(1); // keep only system
    const tokensAfter = ConversationManager.estimateTokens();
    expect(tokensAfter).toBeLessThan(tokensBefore);
  });

  // -- editAt tests --

  test('editAt does nothing for non-user message index', () => {
    // index 2 is assistant
    const before = ConversationManager.getHistory().length;
    MessageEditor.editAt(2);
    expect(ConversationManager.getHistory().length).toBe(before);
  });

  test('editAt does nothing for index 0 (system)', () => {
    const before = ConversationManager.getHistory().length;
    MessageEditor.editAt(0);
    expect(ConversationManager.getHistory().length).toBe(before);
  });

  test('editAt does nothing for negative index', () => {
    const before = ConversationManager.getHistory().length;
    MessageEditor.editAt(-1);
    expect(ConversationManager.getHistory().length).toBe(before);
  });

  test('editAt does nothing for out-of-bounds index', () => {
    const before = ConversationManager.getHistory().length;
    MessageEditor.editAt(99);
    expect(ConversationManager.getHistory().length).toBe(before);
  });

  // -- Edit history tests --

  test('getEditHistory returns empty array initially', () => {
    expect(MessageEditor.getEditHistory()).toEqual([]);
  });

  test('clearEditHistory empties stored edits', () => {
    // Manually store something
    localStorage.setItem('agenticchat_edit_history', JSON.stringify([
      { historyIndex: 1, originalText: 'test', timestamp: Date.now() }
    ]));
    expect(MessageEditor.getEditHistory().length).toBe(1);
    MessageEditor.clearEditHistory();
    expect(MessageEditor.getEditHistory()).toEqual([]);
  });

  // -- decorateOne tests --

  test('decorateOne adds edit button to user message element', () => {
    const div = document.createElement('div');
    div.className = 'history-msg user';

    // history index 1 is a user message
    MessageEditor.decorateOne(div, 1);

    const btn = div.querySelector('.msg-edit-btn');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain('Edit');
  });

  test('decorateOne does not add button to assistant message', () => {
    const div = document.createElement('div');
    div.className = 'history-msg assistant';

    // history index 2 is an assistant message
    MessageEditor.decorateOne(div, 2);

    expect(div.querySelector('.msg-edit-btn')).toBeNull();
  });

  test('decorateOne does not duplicate buttons', () => {
    const div = document.createElement('div');
    div.className = 'history-msg user';

    MessageEditor.decorateOne(div, 1);
    MessageEditor.decorateOne(div, 1);

    const btns = div.querySelectorAll('.msg-edit-btn');
    expect(btns.length).toBe(1);
  });

  test('decorateOne handles invalid index gracefully', () => {
    const div = document.createElement('div');
    div.className = 'history-msg user';

    MessageEditor.decorateOne(div, 99);
    expect(div.querySelector('.msg-edit-btn')).toBeNull();

    MessageEditor.decorateOne(div, -1);
    expect(div.querySelector('.msg-edit-btn')).toBeNull();
  });

  // -- decorateMessages tests --

  test('decorateMessages runs without error when no container exists', () => {
    // Remove history-messages container
    const container = document.getElementById('history-messages');
    if (container) container.remove();

    expect(() => MessageEditor.decorateMessages()).not.toThrow();
  });

  // -- UIController.setChatInput tests --

  test('UIController.setChatInput sets the input value', () => {
    expect(typeof UIController.setChatInput).toBe('function');
    UIController.setChatInput('test text');
    const input = document.getElementById('chat-input');
    expect(input.value).toBe('test text');
  });

  test('UIController.setChatInput gives focus to input', () => {
    UIController.setChatInput('focused');
    const input = document.getElementById('chat-input');
    expect(document.activeElement).toBe(input);
  });
});
