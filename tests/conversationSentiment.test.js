/**
 * ConversationSentiment - Unit Tests
 */

const { setupDOM, loadApp } = require('./setup');

beforeEach(() => {
  setupDOM();
  loadApp();
  localStorage.clear();
});

/* ================================================================
 * tokenize
 * ================================================================ */
describe('ConversationSentiment.tokenize', () => {
  test('splits text into lowercase words', () => {
    expect(ConversationSentiment.tokenize('Hello World')).toEqual(['hello', 'world']);
  });

  test('strips punctuation', () => {
    expect(ConversationSentiment.tokenize('Great! Amazing.')).toEqual(['great', 'amazing']);
  });

  test('filters single-char words', () => {
    expect(ConversationSentiment.tokenize('I a am')).toEqual(['am']);
  });

  test('handles empty string', () => {
    expect(ConversationSentiment.tokenize('')).toEqual([]);
  });

  test('preserves contractions', () => {
    const tokens = ConversationSentiment.tokenize("don't won't");
    expect(tokens).toContain("don't");
    expect(tokens).toContain("won't");
  });
});

/* ================================================================
 * scoreMessage
 * ================================================================ */
describe('ConversationSentiment.scoreMessage', () => {
  test('positive message scores > 0', () => {
    expect(ConversationSentiment.scoreMessage('This is great and amazing')).toBeGreaterThan(0);
  });

  test('negative message scores < 0', () => {
    expect(ConversationSentiment.scoreMessage('This is terrible and awful')).toBeLessThan(0);
  });

  test('neutral message scores near 0', () => {
    const score = ConversationSentiment.scoreMessage('The function takes two parameters');
    expect(Math.abs(score)).toBeLessThan(0.3);
  });

  test('empty message scores 0', () => {
    expect(ConversationSentiment.scoreMessage('')).toBe(0);
  });

  test('score is bounded between -1 and 1', () => {
    const positive = ConversationSentiment.scoreMessage('great amazing wonderful fantastic excellent brilliant superb');
    const negative = ConversationSentiment.scoreMessage('terrible awful horrible wrong broken crash fail error');
    expect(positive).toBeLessThanOrEqual(1);
    expect(positive).toBeGreaterThanOrEqual(-1);
    expect(negative).toBeLessThanOrEqual(1);
    expect(negative).toBeGreaterThanOrEqual(-1);
  });

  test('negation reduces positive sentiment', () => {
    const positive = ConversationSentiment.scoreMessage('This is good');
    const negated = ConversationSentiment.scoreMessage('This is not good');
    expect(negated).toBeLessThan(positive);
  });

  test('intensifier amplifies sentiment', () => {
    const normal = ConversationSentiment.scoreMessage('The code seems to be working and the result is good overall');
    const intensified = ConversationSentiment.scoreMessage('The code seems to be working and the result is very good overall');
    expect(intensified).toBeGreaterThan(normal);
  });
});

/* ================================================================
 * analyse
 * ================================================================ */
describe('ConversationSentiment.analyse', () => {
  test('returns expected shape', () => {
    const result = ConversationSentiment.analyse([]);
    expect(result).toHaveProperty('scores');
    expect(result).toHaveProperty('average');
    expect(result).toHaveProperty('mood');
    expect(result).toHaveProperty('trend');
    expect(result).toHaveProperty('messageCount');
  });

  test('empty messages returns neutral', () => {
    const result = ConversationSentiment.analyse([]);
    expect(result.average).toBe(0);
    expect(result.scores).toEqual([]);
    expect(result.messageCount).toBe(0);
  });

  test('positive conversation has positive average', () => {
    const msgs = [
      { role: 'user', content: 'This is great!' },
      { role: 'assistant', content: 'Wonderful, glad to help!' }
    ];
    const result = ConversationSentiment.analyse(msgs);
    expect(result.average).toBeGreaterThan(0);
  });

  test('negative conversation has negative average', () => {
    const msgs = [
      { role: 'user', content: 'This is terrible and broken' },
      { role: 'assistant', content: 'Sorry about the error and crash' }
    ];
    const result = ConversationSentiment.analyse(msgs);
    expect(result.average).toBeLessThan(0);
  });

  test('scores array length matches message count', () => {
    const msgs = [
      { role: 'user', content: 'Hello' },
      { role: 'user', content: 'World' },
      { role: 'user', content: 'Test' }
    ];
    const result = ConversationSentiment.analyse(msgs);
    expect(result.scores).toHaveLength(3);
    expect(result.messageCount).toBe(3);
  });

  test('detects improving trend', () => {
    const msgs = [
      { role: 'user', content: 'This is terrible' },
      { role: 'user', content: 'Still bad' },
      { role: 'user', content: 'Getting better now' },
      { role: 'user', content: 'This is great' },
      { role: 'user', content: 'Amazing work excellent' },
      { role: 'user', content: 'Wonderful and perfect' }
    ];
    const result = ConversationSentiment.analyse(msgs);
    expect(result.trend).toBe('improving');
  });

  test('detects declining trend', () => {
    const msgs = [
      { role: 'user', content: 'This is amazing and great' },
      { role: 'user', content: 'Wonderful excellent' },
      { role: 'user', content: 'Things are getting bad' },
      { role: 'user', content: 'Terrible awful broken' },
      { role: 'user', content: 'Horrible crash error fail' },
      { role: 'user', content: 'Worst nightmare ever' }
    ];
    const result = ConversationSentiment.analyse(msgs);
    expect(result.trend).toBe('declining');
  });
});

/* ================================================================
 * getMood
 * ================================================================ */
describe('ConversationSentiment.getMood', () => {
  test('very positive score returns happy mood', () => {
    const mood = ConversationSentiment.getMood(0.7);
    expect(mood.label).toBe('Very Positive');
    expect(mood.emoji).toBe('😄');
  });

  test('positive score returns positive mood', () => {
    const mood = ConversationSentiment.getMood(0.3);
    expect(mood.label).toBe('Positive');
  });

  test('zero returns neutral', () => {
    const mood = ConversationSentiment.getMood(0);
    expect(mood.label).toBe('Neutral');
  });

  test('negative score returns negative mood', () => {
    const mood = ConversationSentiment.getMood(-0.3);
    expect(mood.label).toBe('Negative');
  });

  test('very negative score', () => {
    const mood = ConversationSentiment.getMood(-0.8);
    expect(mood.label).toBe('Very Negative');
  });
});

/* ================================================================
 * MOODS
 * ================================================================ */
describe('ConversationSentiment.MOODS', () => {
  test('has 5 mood levels', () => {
    expect(ConversationSentiment.MOODS).toHaveLength(5);
  });

  test('each mood has emoji, label, color', () => {
    ConversationSentiment.MOODS.forEach(m => {
      expect(typeof m.emoji).toBe('string');
      expect(typeof m.label).toBe('string');
      expect(typeof m.color).toBe('string');
      expect(m.color).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  test('moods are ordered descending by min', () => {
    for (let i = 0; i < ConversationSentiment.MOODS.length - 1; i++) {
      expect(ConversationSentiment.MOODS[i].min).toBeGreaterThan(ConversationSentiment.MOODS[i + 1].min);
    }
  });
});

/* ================================================================
 * sparklineSVG
 * ================================================================ */
describe('ConversationSentiment.sparklineSVG', () => {
  test('returns SVG string', () => {
    const svg = ConversationSentiment.sparklineSVG([0.5, -0.2, 0.3]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  test('empty scores returns empty SVG', () => {
    const svg = ConversationSentiment.sparklineSVG([]);
    expect(svg).toContain('<svg');
    expect(svg).not.toContain('polyline');
  });

  test('single score produces SVG with polyline', () => {
    const svg = ConversationSentiment.sparklineSVG([0.5]);
    expect(svg).toContain('polyline');
  });

  test('respects custom dimensions', () => {
    const svg = ConversationSentiment.sparklineSVG([0.1, 0.2], 300, 50);
    expect(svg).toContain('width="300"');
    expect(svg).toContain('height="50"');
  });
});

/* ================================================================
 * toggle / isVisible
 * ================================================================ */
describe('ConversationSentiment.toggle', () => {
  test('toggles visibility', () => {
    const initial = ConversationSentiment.isVisible();
    const after = ConversationSentiment.toggle();
    expect(after).toBe(!initial);
    expect(ConversationSentiment.isVisible()).toBe(!initial);
  });

  test('double toggle restores', () => {
    const initial = ConversationSentiment.isVisible();
    ConversationSentiment.toggle();
    ConversationSentiment.toggle();
    expect(ConversationSentiment.isVisible()).toBe(initial);
  });

  test('persists to storage', () => {
    ConversationSentiment.toggle();
    const stored = SafeStorage.get('ac-sentiment-visible');
    expect(stored).toBeDefined();
  });
});

/* ================================================================
 * init / DOM
 * ================================================================ */
describe('ConversationSentiment.init', () => {
  test('creates panel in DOM', () => {
    ConversationSentiment.init();
    expect(document.getElementById('conversation-sentiment')).not.toBeNull();
  });

  test('panel is hidden by default', () => {
    ConversationSentiment.init();
    const el = document.getElementById('conversation-sentiment');
    expect(el.style.display).toBe('none');
  });
});
