/**
 * SmartConversationOracle — Unit Tests
 * Tests for the autonomous predictive conversation engine.
 */

const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="chat-output"></div><div class="toolbar"></div></body></html>');
global.document = dom.window.document;
global.window = dom.window;
global.navigator = dom.window.navigator;
global.MutationObserver = class { constructor() {} observe() {} disconnect() {} };
global.SafeStorage = {
  _store: {},
  get(k) { return this._store[k] || null; },
  trySet(k, v) { this._store[k] = v; },
  trySetJSON(k, v) { this._store[k] = JSON.stringify(v); },
  getJSON(k, def) { try { return JSON.parse(this._store[k]); } catch(_) { return def; } },
  getItem(k) { return this._store[k] || null; },
  setItem(k, v) { this._store[k] = v; }
};
global.sanitizeStorageObject = (o) => o;
global.ToastManager = { show: jest.fn() };
global.KeyboardShortcuts = { register: jest.fn() };
global.CommandPalette = { register: jest.fn() };
global.SlashCommands = { register: jest.fn() };
global.PanelRegistry = { register: jest.fn(), closeAllExcept: jest.fn() };
global.ConversationManager = { getHistory: () => [] };

require('../app.js');

describe('SmartConversationOracle', () => {
  let oracle;

  beforeAll(() => {
    oracle = global.SmartConversationOracle || window.SmartConversationOracle;
  });

  test('module exists and has public API', () => {
    expect(oracle).toBeDefined();
    expect(typeof oracle.toggle).toBe('function');
    expect(typeof oracle.show).toBe('function');
    expect(typeof oracle.hide).toBe('function');
    expect(typeof oracle.analyze).toBe('function');
    expect(typeof oracle.getState).toBe('function');
    expect(typeof oracle.getTopics).toBe('function');
    expect(typeof oracle.getDeadEnds).toBe('function');
    expect(typeof oracle.getPredictions).toBe('function');
    expect(typeof oracle.getTangents).toBe('function');
    expect(typeof oracle.getTrajectory).toBe('function');
    expect(typeof oracle.isEnabled).toBe('function');
    expect(typeof oracle.setEnabled).toBe('function');
  });

  test('enabled by default', () => {
    expect(oracle.isEnabled()).toBe(true);
  });

  test('setEnabled toggles state', () => {
    oracle.setEnabled(false);
    expect(oracle.isEnabled()).toBe(false);
    oracle.setEnabled(true);
    expect(oracle.isEnabled()).toBe(true);
  });

  test('getState returns deep copy', () => {
    const s1 = oracle.getState();
    const s2 = oracle.getState();
    expect(s1).toEqual(s2);
    s1.topics.push({ label: 'test' });
    expect(oracle.getState().topics).not.toContainEqual({ label: 'test' });
  });

  test('getTrajectory returns copy', () => {
    const t = oracle.getTrajectory();
    expect(t).toHaveProperty('direction');
    expect(t).toHaveProperty('velocity');
  });

  /* ── Tokenizer tests ── */
  describe('_tokenize', () => {
    test('removes stopwords', () => {
      const tokens = oracle._tokenize('the quick brown fox is very fast');
      expect(tokens).not.toContain('the');
      expect(tokens).not.toContain('is');
      expect(tokens).not.toContain('very');
      expect(tokens).toContain('quick');
      expect(tokens).toContain('brown');
      expect(tokens).toContain('fox');
      expect(tokens).toContain('fast');
    });

    test('lowercases and strips punctuation', () => {
      const tokens = oracle._tokenize('Hello, WORLD! Testing... 123');
      expect(tokens).toContain('hello');
      expect(tokens).toContain('world');
      expect(tokens).toContain('testing');
    });

    test('filters short tokens', () => {
      const tokens = oracle._tokenize('a to of me it is do');
      expect(tokens).toHaveLength(0);
    });

    test('handles empty input', () => {
      expect(oracle._tokenize('')).toEqual([]);
      expect(oracle._tokenize(null)).toEqual([]);
      expect(oracle._tokenize(undefined)).toEqual([]);
    });
  });

  /* ── Cosine similarity tests ── */
  describe('_cosineSimilarity', () => {
    test('identical strings have similarity 1', () => {
      const sim = oracle._cosineSimilarity('hello world testing', 'hello world testing');
      expect(sim).toBeCloseTo(1.0, 1);
    });

    test('completely different strings have low similarity', () => {
      const sim = oracle._cosineSimilarity('python programming language', 'cooking recipes italian food');
      expect(sim).toBeLessThan(0.3);
    });

    test('similar strings have moderate similarity', () => {
      const sim = oracle._cosineSimilarity(
        'javascript react framework frontend',
        'javascript angular framework frontend'
      );
      expect(sim).toBeGreaterThan(0.5);
    });

    test('handles empty inputs', () => {
      expect(oracle._cosineSimilarity('', '')).toBe(0);
    });
  });

  /* ── Frustration detection ── */
  describe('_detectFrustration', () => {
    test('detects frustration keywords', () => {
      expect(oracle._detectFrustration('I already said that')).toBeGreaterThan(0);
      expect(oracle._detectFrustration("that's not what I meant")).toBeGreaterThan(0);
      expect(oracle._detectFrustration("why can't you understand")).toBeGreaterThan(0);
    });

    test('returns 0 for neutral messages', () => {
      expect(oracle._detectFrustration('Can you help me with this?')).toBe(0);
      expect(oracle._detectFrustration('What is the best approach?')).toBe(0);
    });

    test('accumulates multiple signals', () => {
      const score = oracle._detectFrustration("I already said that again, that's not right");
      expect(score).toBeGreaterThan(1);
    });
  });

  /* ── Topic extraction ── */
  describe('_extractTopics', () => {
    test('extracts topics from messages', () => {
      const msgs = [
        { role: 'user', text: 'How do I set up Python virtual environments?' },
        { role: 'assistant', text: 'To set up Python virtual environments, use venv module' },
        { role: 'user', text: 'Can I use Python virtual environments with Flask?' },
        { role: 'assistant', text: 'Yes, Python virtual environments work great with Flask' }
      ];
      const topics = oracle._extractTopics(msgs);
      expect(topics.length).toBeGreaterThan(0);
      const labels = topics.map(t => t.label);
      expect(labels.some(l => l.includes('python') || l.includes('virtual'))).toBe(true);
    });

    test('returns empty for insufficient data', () => {
      expect(oracle._extractTopics([])).toEqual([]);
    });

    test('topics have required fields', () => {
      const msgs = [
        { role: 'user', text: 'Tell me about machine learning algorithms' },
        { role: 'assistant', text: 'Machine learning algorithms include supervised learning' },
        { role: 'user', text: 'What machine learning algorithms work for classification?' }
      ];
      const topics = oracle._extractTopics(msgs);
      if (topics.length > 0) {
        const t = topics[0];
        expect(t).toHaveProperty('label');
        expect(t).toHaveProperty('keywords');
        expect(t).toHaveProperty('firstSeen');
        expect(t).toHaveProperty('lastSeen');
        expect(t).toHaveProperty('messageCount');
        expect(t).toHaveProperty('depth');
        expect(Array.isArray(t.keywords)).toBe(true);
      }
    });
  });

  /* ── Direction analysis ── */
  describe('_analyzeDirection', () => {
    test('returns default for few messages', () => {
      const result = oracle._analyzeDirection([], [{ role: 'user', text: 'hi' }]);
      expect(result.direction).toBe('focused');
      expect(result.velocity).toBe(0);
    });

    test('returns valid direction values', () => {
      const msgs = [];
      for (let i = 0; i < 10; i++) {
        msgs.push({ role: 'user', text: 'testing message number ' + i + ' about react components' });
        msgs.push({ role: 'assistant', text: 'response about react components number ' + i });
      }
      const topics = oracle._extractTopics(msgs);
      const result = oracle._analyzeDirection(topics, msgs);
      expect(['deepening', 'broadening', 'circling', 'drifting', 'focused']).toContain(result.direction);
      expect(result.velocity).toBeGreaterThanOrEqual(0);
      expect(result.velocity).toBeLessThanOrEqual(10);
    });

    test('has pattern array', () => {
      const msgs = Array.from({ length: 8 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        text: 'discussion about topic number ' + i
      }));
      const topics = oracle._extractTopics(msgs);
      const result = oracle._analyzeDirection(topics, msgs);
      expect(Array.isArray(result.pattern)).toBe(true);
    });
  });

  /* ── Dead-end detection ── */
  describe('_detectDeadEnds', () => {
    test('detects rephrased questions', () => {
      const msgs = [
        { role: 'user', text: 'How do I configure the webpack bundler for production?' },
        { role: 'assistant', text: 'You can configure webpack for production builds...' },
        { role: 'user', text: 'How can I set up webpack bundler configuration for production?' }
      ];
      const topics = oracle._extractTopics(msgs);
      const deadEnds = oracle._detectDeadEnds(msgs, topics);
      expect(deadEnds.some(d => d.reason.includes('rephrasing'))).toBe(true);
    });

    test('dead ends have required fields', () => {
      const msgs = [
        { role: 'user', text: 'explain this concept again please I already asked' },
        { role: 'assistant', text: 'ok' },
        { role: 'user', text: "that's not what I meant, I already said this before again" }
      ];
      const topics = oracle._extractTopics(msgs);
      const deadEnds = oracle._detectDeadEnds(msgs, topics);
      deadEnds.forEach(d => {
        expect(d).toHaveProperty('topicLabel');
        expect(d).toHaveProperty('severity');
        expect(d).toHaveProperty('reason');
        expect(d).toHaveProperty('suggestedPivot');
        expect(d).toHaveProperty('detectedAt');
        expect(['high', 'medium', 'low']).toContain(d.severity);
      });
    });

    test('returns empty for healthy conversation', () => {
      const msgs = [
        { role: 'user', text: 'What is React?' },
        { role: 'assistant', text: 'React is a JavaScript library for building user interfaces. It was created by Facebook and is widely used for single-page applications.' },
        { role: 'user', text: 'How does Vue compare to React?' },
        { role: 'assistant', text: 'Vue and React have different approaches. Vue uses templates while React uses JSX. Both are excellent choices for modern web development.' }
      ];
      const topics = oracle._extractTopics(msgs);
      const deadEnds = oracle._detectDeadEnds(msgs, topics);
      // Healthy diversified conversation shouldn't trigger dead ends
      const highSeverity = deadEnds.filter(d => d.severity === 'high');
      expect(highSeverity.length).toBe(0);
    });
  });

  /* ── Question prediction ── */
  describe('_predictQuestions', () => {
    test('generates predictions from topics', () => {
      const msgs = [
        { role: 'user', text: 'How do I deploy a Docker container to production?' },
        { role: 'assistant', text: 'You can deploy Docker containers using various orchestration tools...' },
        { role: 'user', text: 'What about Docker container networking and volumes?' },
        { role: 'assistant', text: 'Docker networking allows containers to communicate...' }
      ];
      const topics = oracle._extractTopics(msgs);
      const predictions = oracle._predictQuestions(msgs, topics);
      expect(predictions.length).toBeGreaterThan(0);
      expect(predictions.length).toBeLessThanOrEqual(5);
    });

    test('predictions have required fields', () => {
      const msgs = [
        { role: 'user', text: 'Explain database indexing strategies' },
        { role: 'assistant', text: 'Database indexing uses B-tree and hash structures...' },
        { role: 'user', text: 'What about database indexing performance?' }
      ];
      const topics = oracle._extractTopics(msgs);
      const predictions = oracle._predictQuestions(msgs, topics);
      predictions.forEach(p => {
        expect(p).toHaveProperty('question');
        expect(p).toHaveProperty('confidence');
        expect(p).toHaveProperty('reasoning');
        expect(typeof p.question).toBe('string');
        expect(p.question.length).toBeGreaterThan(0);
        expect(p.confidence).toBeGreaterThanOrEqual(0);
        expect(p.confidence).toBeLessThanOrEqual(100);
      });
    });

    test('returns empty for insufficient data', () => {
      expect(oracle._predictQuestions([], [])).toEqual([]);
      expect(oracle._predictQuestions([{ role: 'user', text: 'hi' }], [])).toEqual([]);
    });

    test('predictions are sorted by confidence', () => {
      const msgs = Array.from({ length: 8 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        text: 'deep discussion about react hooks and state management patterns ' + i
      }));
      const topics = oracle._extractTopics(msgs);
      const predictions = oracle._predictQuestions(msgs, topics);
      for (let i = 1; i < predictions.length; i++) {
        expect(predictions[i].confidence).toBeLessThanOrEqual(predictions[i - 1].confidence);
      }
    });
  });

  /* ── Tangent spotting ── */
  describe('_spotTangents', () => {
    test('identifies unexplored terms', () => {
      const msgs = [
        { role: 'user', text: 'How do I configure authentication with OAuth and JWT tokens?' },
        { role: 'assistant', text: 'Authentication can be set up using OAuth providers...' },
        { role: 'user', text: 'I also need to handle authorization and rate limiting' },
        { role: 'assistant', text: 'For authorization you should implement role-based access control...' }
      ];
      const topics = oracle._extractTopics(msgs);
      const tangents = oracle._spotTangents(msgs, topics);
      expect(Array.isArray(tangents)).toBe(true);
    });

    test('tangents have required fields', () => {
      const msgs = [
        { role: 'user', text: 'Tell me about kubernetes deployment strategies and helm charts' },
        { role: 'assistant', text: 'Kubernetes offers several deployment strategies including rolling updates...' }
      ];
      const topics = oracle._extractTopics(msgs);
      const tangents = oracle._spotTangents(msgs, topics);
      tangents.forEach(t => {
        expect(t).toHaveProperty('label');
        expect(t).toHaveProperty('relevance');
        expect(t).toHaveProperty('source');
        expect(t).toHaveProperty('explored');
        expect(typeof t.relevance).toBe('number');
      });
    });

    test('returns empty for minimal input', () => {
      expect(oracle._spotTangents([], []).length).toBe(0);
    });
  });

  /* ── Default state ── */
  describe('_defaultState', () => {
    test('returns proper structure', () => {
      const state = oracle._defaultState();
      expect(state).toHaveProperty('topics');
      expect(state).toHaveProperty('trajectory');
      expect(state).toHaveProperty('deadEnds');
      expect(state).toHaveProperty('predictions');
      expect(state).toHaveProperty('tangents');
      expect(state).toHaveProperty('sessionHistory');
      expect(state).toHaveProperty('messageCache');
      expect(Array.isArray(state.topics)).toBe(true);
      expect(Array.isArray(state.deadEnds)).toBe(true);
      expect(state.trajectory.direction).toBe('focused');
    });
  });

  /* ── Panel UI ── */
  describe('Panel', () => {
    test('show creates panel element', () => {
      oracle.show();
      const panel = document.getElementById('oracle-panel');
      expect(panel).not.toBeNull();
    });

    test('hide removes visible class', () => {
      oracle.show();
      oracle.hide();
      const panel = document.getElementById('oracle-panel');
      expect(panel.classList.contains('sco-panel-visible')).toBe(false);
    });

    test('toggle switches visibility', () => {
      oracle.hide();
      oracle.toggle();
      const panel = document.getElementById('oracle-panel');
      expect(panel.classList.contains('sco-panel-visible')).toBe(true);
      oracle.toggle();
      expect(panel.classList.contains('sco-panel-visible')).toBe(false);
    });
  });

  /* ── Edge cases ── */
  describe('Edge cases', () => {
    test('analyze with empty chat output', () => {
      const state = oracle.analyze();
      expect(state).toBeDefined();
    });

    test('getTopics returns array', () => {
      expect(Array.isArray(oracle.getTopics())).toBe(true);
    });

    test('getDeadEnds returns array', () => {
      expect(Array.isArray(oracle.getDeadEnds())).toBe(true);
    });

    test('getPredictions returns array', () => {
      expect(Array.isArray(oracle.getPredictions())).toBe(true);
    });

    test('getTangents returns array', () => {
      expect(Array.isArray(oracle.getTangents())).toBe(true);
    });
  });
});
