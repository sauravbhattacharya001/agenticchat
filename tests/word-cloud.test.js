/**
 * @jest-environment jsdom
 */

describe('WordCloudGenerator', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="wordcloud-overlay" class="modal-overlay" style="display:none"></div>
      <div id="wordcloud-panel" style="display:none;">
        <select id="wordcloud-source"><option value="all">All</option></select>
        <canvas id="wordcloud-canvas" width="700" height="420"></canvas>
        <div id="wordcloud-empty" style="display:none;"></div>
        <button id="wordcloud-close"></button>
        <button id="wordcloud-refresh"></button>
        <button id="wordcloud-download"></button>
      </div>`;

    // Mock ConversationManager
    global.ConversationManager = {
      getHistory: () => [
        { role: 'user', content: 'Tell me about JavaScript programming language features' },
        { role: 'assistant', content: 'JavaScript programming language has many powerful features including closures and prototypes' },
        { role: 'user', content: 'What about TypeScript programming differences' },
      ]
    };

    // Reset module
    jest.resetModules();
    require('../app.js');
  });

  afterEach(() => {
    delete global.ConversationManager;
  });

  test('opens and closes panel', () => {
    const panel = document.getElementById('wordcloud-panel');
    const overlay = document.getElementById('wordcloud-overlay');
    WordCloudGenerator.open();
    expect(panel.style.display).not.toBe('none');
    expect(overlay.style.display).not.toBe('none');
    WordCloudGenerator.close();
    expect(panel.style.display).toBe('none');
    expect(overlay.style.display).toBe('none');
  });

  test('toggle switches state', () => {
    const panel = document.getElementById('wordcloud-panel');
    WordCloudGenerator.toggle();
    expect(panel.style.display).not.toBe('none');
    WordCloudGenerator.toggle();
    expect(panel.style.display).toBe('none');
  });

  test('shows empty state when no messages', () => {
    global.ConversationManager.getHistory = () => [];
    WordCloudGenerator.open();
    const empty = document.getElementById('wordcloud-empty');
    expect(empty.style.display).not.toBe('none');
  });

  test('Alt+W keyboard shortcut triggers toggle', () => {
    WordCloudGenerator.init();
    const event = new KeyboardEvent('keydown', { key: 'w', altKey: true });
    document.dispatchEvent(event);
    const panel = document.getElementById('wordcloud-panel');
    expect(panel.style.display).not.toBe('none');
  });
});
