/**
 * WordCloud — Unit Tests
 */

const { setupDOM, loadApp } = require('./setup');

beforeEach(() => {
  setupDOM();
  loadApp();
});

/* ================================================================
 * WordCloud
 * ================================================================ */
describe('WordCloud', () => {
  test('module exists with expected API', () => {
    expect(WordCloud).toBeDefined();
    expect(typeof WordCloud.init).toBe('function');
    expect(typeof WordCloud.open).toBe('function');
    expect(typeof WordCloud.close).toBe('function');
    expect(typeof WordCloud.toggle).toBe('function');
    expect(typeof WordCloud.generate).toBe('function');
    expect(typeof WordCloud.getWords).toBe('function');
    expect(typeof WordCloud.getConfig).toBe('function');
    expect(typeof WordCloud.setConfig).toBe('function');
    expect(typeof WordCloud.exportData).toBe('function');
  });

  test('generate returns empty array with no conversation', () => {
    const words = WordCloud.generate();
    expect(Array.isArray(words)).toBe(true);
    expect(words.length).toBe(0);
  });

  test('generate extracts words from conversation', () => {
    ConversationManager.addMessage('user', 'javascript javascript javascript programming programming code');
    ConversationManager.addMessage('assistant', 'javascript programming example example');
    const words = WordCloud.generate();
    expect(words.length).toBeGreaterThan(0);
    expect(words[0].word).toBe('javascript');
    expect(words[0].count).toBe(4);
  });

  test('generate filters stop words', () => {
    ConversationManager.addMessage('user', 'the and but javascript javascript');
    const words = WordCloud.generate();
    const wordTexts = words.map(w => w.word);
    expect(wordTexts).not.toContain('the');
    expect(wordTexts).not.toContain('and');
    expect(wordTexts).not.toContain('but');
    expect(wordTexts).toContain('javascript');
  });

  test('generate respects minCount config', () => {
    WordCloud.setConfig({ minCount: 3 });
    ConversationManager.addMessage('user', 'alpha alpha beta beta beta gamma gamma gamma');
    const words = WordCloud.generate();
    const wordTexts = words.map(w => w.word);
    expect(wordTexts).toContain('beta');
    expect(wordTexts).toContain('gamma');
    expect(wordTexts).not.toContain('alpha');
    WordCloud.setConfig({ minCount: 2 }); // reset
  });

  test('generate respects maxWords config', () => {
    WordCloud.setConfig({ maxWords: 2, minCount: 1 });
    ConversationManager.addMessage('user', 'alpha alpha alpha beta beta gamma');
    const words = WordCloud.generate();
    expect(words.length).toBeLessThanOrEqual(2);
    WordCloud.setConfig({ maxWords: 80, minCount: 2 }); // reset
  });

  test('generate filters by user role', () => {
    ConversationManager.addMessage('user', 'frontend frontend frontend');
    ConversationManager.addMessage('assistant', 'backend backend backend');
    WordCloud.setConfig({ filterRoles: 'user', minCount: 1 });
    const words = WordCloud.generate();
    const wordTexts = words.map(w => w.word);
    expect(wordTexts).toContain('frontend');
    expect(wordTexts).not.toContain('backend');
    WordCloud.setConfig({ filterRoles: 'all', minCount: 2 }); // reset
  });

  test('generate filters by assistant role', () => {
    ConversationManager.addMessage('user', 'frontend frontend frontend');
    ConversationManager.addMessage('assistant', 'backend backend backend');
    WordCloud.setConfig({ filterRoles: 'assistant', minCount: 1 });
    const words = WordCloud.generate();
    const wordTexts = words.map(w => w.word);
    expect(wordTexts).toContain('backend');
    expect(wordTexts).not.toContain('frontend');
    WordCloud.setConfig({ filterRoles: 'all', minCount: 2 }); // reset
  });

  test('generate skips system messages', () => {
    ConversationManager.addMessage('system', 'secret secret secret');
    ConversationManager.addMessage('user', 'visible visible visible');
    WordCloud.setConfig({ minCount: 1 });
    const words = WordCloud.generate();
    const wordTexts = words.map(w => w.word);
    expect(wordTexts).not.toContain('secret');
    expect(wordTexts).toContain('visible');
    WordCloud.setConfig({ minCount: 2 });
  });

  test('generate strips code blocks', () => {
    ConversationManager.addMessage('user', 'test test test ```const hidden = true;``` test');
    WordCloud.setConfig({ minCount: 1 });
    const words = WordCloud.generate();
    const wordTexts = words.map(w => w.word);
    expect(wordTexts).not.toContain('hidden');
    expect(wordTexts).toContain('test');
    WordCloud.setConfig({ minCount: 2 });
  });

  test('generate strips URLs', () => {
    ConversationManager.addMessage('user', 'check check https://example.com/foo check');
    WordCloud.setConfig({ minCount: 1 });
    const words = WordCloud.generate();
    const wordTexts = words.map(w => w.word);
    expect(wordTexts).not.toContain('https');
    expect(wordTexts).not.toContain('example');
    expect(wordTexts).toContain('check');
    WordCloud.setConfig({ minCount: 2 });
  });

  test('generate includes percentage', () => {
    ConversationManager.addMessage('user', 'alpha alpha alpha beta beta');
    WordCloud.setConfig({ minCount: 1 });
    const words = WordCloud.generate();
    const alpha = words.find(w => w.word === 'alpha');
    expect(alpha).toBeDefined();
    expect(alpha.pct).toBeGreaterThan(0);
    expect(alpha.pct).toBeLessThanOrEqual(100);
    WordCloud.setConfig({ minCount: 2 });
  });

  test('generate sorts by count descending', () => {
    ConversationManager.addMessage('user', 'gamma gamma gamma alpha alpha beta beta beta beta');
    WordCloud.setConfig({ minCount: 1 });
    const words = WordCloud.generate();
    for (let i = 1; i < words.length; i++) {
      expect(words[i - 1].count).toBeGreaterThanOrEqual(words[i].count);
    }
    WordCloud.setConfig({ minCount: 2 });
  });

  test('getWords returns same as generate', () => {
    ConversationManager.addMessage('user', 'testing testing testing');
    const g = WordCloud.generate();
    const w = WordCloud.getWords();
    expect(g).toEqual(w);
  });

  test('getConfig returns current configuration', () => {
    const cfg = WordCloud.getConfig();
    expect(cfg).toHaveProperty('minCount');
    expect(cfg).toHaveProperty('maxWords');
    expect(cfg).toHaveProperty('filterRoles');
  });

  test('setConfig updates configuration', () => {
    WordCloud.setConfig({ minCount: 5, maxWords: 20, filterRoles: 'user' });
    const cfg = WordCloud.getConfig();
    expect(cfg.minCount).toBe(5);
    expect(cfg.maxWords).toBe(20);
    expect(cfg.filterRoles).toBe('user');
    WordCloud.setConfig({ minCount: 2, maxWords: 80, filterRoles: 'all' });
  });

  test('setConfig ignores invalid values', () => {
    const before = WordCloud.getConfig();
    WordCloud.setConfig({ minCount: -1, filterRoles: 'invalid' });
    const after = WordCloud.getConfig();
    expect(after.minCount).toBe(before.minCount);
    expect(after.filterRoles).toBe(before.filterRoles);
  });

  test('setConfig handles null/undefined gracefully', () => {
    expect(() => WordCloud.setConfig(null)).not.toThrow();
    expect(() => WordCloud.setConfig(undefined)).not.toThrow();
    expect(() => WordCloud.setConfig(42)).not.toThrow();
  });

  test('exportData returns JSON format', () => {
    ConversationManager.addMessage('user', 'export export export test test test');
    const json = WordCloud.exportData('json');
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
  });

  test('exportData returns CSV format', () => {
    ConversationManager.addMessage('user', 'csv csv csv data data data');
    const csv = WordCloud.exportData('csv');
    expect(csv).toContain('word,count,pct');
    expect(csv).toContain('csv');
  });

  test('exportData defaults to JSON', () => {
    ConversationManager.addMessage('user', 'default default default');
    const data = WordCloud.exportData();
    expect(() => JSON.parse(data)).not.toThrow();
  });

  test('open creates panel elements', () => {
    WordCloud.open();
    const panel = document.querySelector('.wc-panel');
    expect(panel).toBeTruthy();
    const overlay = document.querySelector('.wc-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay.classList.contains('open')).toBe(true);
    WordCloud.close();
  });

  test('close hides panel', () => {
    WordCloud.open();
    WordCloud.close();
    const panel = document.querySelector('.wc-panel');
    expect(panel.style.display).toBe('none');
    const overlay = document.querySelector('.wc-overlay');
    expect(overlay.classList.contains('open')).toBe(false);
  });

  test('toggle opens and closes', () => {
    WordCloud.toggle();
    const panel = document.querySelector('.wc-panel');
    expect(panel.style.display).toBe('flex');
    WordCloud.toggle();
    expect(panel.style.display).toBe('none');
  });

  test('open renders word cloud content', () => {
    ConversationManager.addMessage('user', 'render render render cloud cloud cloud');
    WordCloud.open();
    const container = document.querySelector('.wc-cloud');
    const wordEls = container.querySelectorAll('.wc-word');
    expect(wordEls.length).toBeGreaterThan(0);
    WordCloud.close();
  });

  test('open shows empty message when no words', () => {
    WordCloud.open();
    const empty = document.querySelector('.wc-empty');
    expect(empty).toBeTruthy();
    expect(empty.textContent).toContain('No words');
    WordCloud.close();
  });

  test('word elements have font size and color', () => {
    ConversationManager.addMessage('user', 'styled styled styled words words');
    WordCloud.open();
    const wordEls = document.querySelectorAll('.wc-word');
    if (wordEls.length > 0) {
      expect(wordEls[0].style.fontSize).toMatch(/\d+px/);
      expect(wordEls[0].style.color).toBeTruthy();
    }
    WordCloud.close();
  });

  test('word elements have title tooltip', () => {
    ConversationManager.addMessage('user', 'tooltip tooltip tooltip');
    WordCloud.open();
    const wordEl = document.querySelector('.wc-word');
    expect(wordEl.title).toContain('tooltip');
    expect(wordEl.title).toContain('3');
    WordCloud.close();
  });

  test('init does not throw', () => {
    expect(() => WordCloud.init()).not.toThrow();
  });

  test('panel has role dialog and aria-label', () => {
    WordCloud.open();
    const panel = document.querySelector('.wc-panel');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-label')).toBe('Word Cloud');
    WordCloud.close();
  });

  test('role filter select exists in panel', () => {
    WordCloud.open();
    const select = document.querySelector('.wc-role-filter');
    expect(select).toBeTruthy();
    expect(select.options.length).toBe(3);
    WordCloud.close();
  });

  test('filters short words (length <= 2)', () => {
    ConversationManager.addMessage('user', 'ab ab ab longword longword longword');
    WordCloud.setConfig({ minCount: 1 });
    const words = WordCloud.generate();
    const wordTexts = words.map(w => w.word);
    expect(wordTexts).not.toContain('ab');
    expect(wordTexts).toContain('longword');
    WordCloud.setConfig({ minCount: 2 });
  });

  test('strips inline code', () => {
    ConversationManager.addMessage('user', 'inline inline `hidden` inline');
    WordCloud.setConfig({ minCount: 1 });
    const words = WordCloud.generate();
    const wordTexts = words.map(w => w.word);
    expect(wordTexts).not.toContain('hidden');
    expect(wordTexts).toContain('inline');
    WordCloud.setConfig({ minCount: 2 });
  });

  test('handles empty messages gracefully', () => {
    ConversationManager.addMessage('user', '');
    ConversationManager.addMessage('assistant', '');
    expect(() => WordCloud.generate()).not.toThrow();
    expect(WordCloud.generate()).toEqual([]);
  });

  test('multiple opens reuse panel', () => {
    WordCloud.open();
    WordCloud.close();
    WordCloud.open();
    const panels = document.querySelectorAll('.wc-panel');
    expect(panels.length).toBe(1);
    WordCloud.close();
  });

  test('getConfig returns a copy, not reference', () => {
    const cfg1 = WordCloud.getConfig();
    cfg1.minCount = 999;
    const cfg2 = WordCloud.getConfig();
    expect(cfg2.minCount).not.toBe(999);
  });
});
