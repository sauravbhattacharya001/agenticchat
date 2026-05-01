/**
 * @jest-environment jsdom
 */
'use strict';

/* ── Mock SafeStorage ── */
const _store = new Map();
global.SafeStorage = {
  get: (k) => _store.get(k) || null,
  set: (k, v) => _store.set(k, v),
  remove: (k) => _store.delete(k),
  getJSON: (k, fb = null) => { const r = _store.get(k); if (!r) return fb; try { return JSON.parse(r); } catch (_) { return fb; } },
  isAvailable: () => true,
  enableIncognito: () => {},
  disableIncognito: () => {},
  isIncognito: () => false
};

/* ── Minimal DOM ── */
document.body.innerHTML = '<div id="chat-output"></div><div class="toolbar"></div><textarea id="chat-input"></textarea>';

/* ── Load module ── */
const fs = require('fs');
const path = require('path');
const appCode = fs.readFileSync(path.resolve(__dirname, '..', 'app.js'), 'utf8');

// Extract just the SmartIntentAligner IIFE
const startMarker = '/* ============================================================\n * SmartIntentAligner';
const startIdx = appCode.indexOf(startMarker);
let moduleCode = appCode.substring(startIdx);
// Make it assign to global
moduleCode = moduleCode.replace('const SmartIntentAligner', 'global.SmartIntentAligner');
// Remove DOMContentLoaded listener call that fires immediately in jsdom
moduleCode = moduleCode.replace("document.addEventListener('DOMContentLoaded', init);", 'init();');

eval(moduleCode);

/* ════════════════════════════════════════════════════════════
 * Tests
 * ════════════════════════════════════════════════════════════ */

describe('SmartIntentAligner', () => {
  beforeEach(() => {
    _store.clear();
  });

  describe('Module Structure', () => {
    test('exposes public API', () => {
      expect(SmartIntentAligner.toggle).toBeDefined();
      expect(SmartIntentAligner.show).toBeDefined();
      expect(SmartIntentAligner.hide).toBeDefined();
      expect(SmartIntentAligner.analyzeExchange).toBeDefined();
      expect(SmartIntentAligner.analyzeTopicDrift).toBeDefined();
      expect(SmartIntentAligner.computeComposite).toBeDefined();
      expect(SmartIntentAligner.classifyTier).toBeDefined();
    });

    test('TIERS defined correctly', () => {
      expect(SmartIntentAligner.TIERS.PERFECT.min).toBe(90);
      expect(SmartIntentAligner.TIERS.MISALIGNED.max).toBe(49);
    });

    test('DIMENSIONS defined', () => {
      expect(SmartIntentAligner.DIMENSIONS.TOPIC_DRIFT).toBe('topicDrift');
      expect(SmartIntentAligner.DIMENSIONS.FORMAT_MATCH).toBe('formatMatch');
    });

    test('DIM_WEIGHTS sum to ~1', () => {
      const weights = SmartIntentAligner.DIM_WEIGHTS;
      const sum = Object.values(weights).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 1);
    });
  });

  describe('Topic Drift Detector', () => {
    test('high overlap = high score', () => {
      const score = SmartIntentAligner.analyzeTopicDrift(
        'How do I sort an array in JavaScript?',
        'To sort an array in JavaScript, you can use the Array.prototype.sort() method.'
      );
      expect(score).toBeGreaterThanOrEqual(70);
    });

    test('no overlap = low score', () => {
      const score = SmartIntentAligner.analyzeTopicDrift(
        'How do I sort an array in JavaScript?',
        'The weather today is sunny with temperatures reaching 75 degrees Fahrenheit.'
      );
      expect(score).toBeLessThan(60);
    });

    test('empty user message = 100', () => {
      expect(SmartIntentAligner.analyzeTopicDrift('', 'anything')).toBe(100);
    });

    test('partial overlap = medium score', () => {
      const score = SmartIntentAligner.analyzeTopicDrift(
        'How do I handle errors in Python?',
        'In Python, you can use try-except blocks. Also, logging is important for debugging and monitoring your application health.'
      );
      expect(score).toBeGreaterThan(40);
      expect(score).toBeLessThan(100);
    });
  });

  describe('Scope Match Detector', () => {
    test('specific question with short answer = good', () => {
      const score = SmartIntentAligner.analyzeScopeMatch(
        'What is the capital of France?',
        'The capital of France is Paris.'
      );
      expect(score).toBeGreaterThanOrEqual(80);
    });

    test('specific question with very long answer = penalized', () => {
      const longAnswer = Array(20).fill('This is a very detailed paragraph about the history and geography of France.').join(' ');
      const score = SmartIntentAligner.analyzeScopeMatch(
        'What is the capital of France?',
        longAnswer
      );
      expect(score).toBeLessThan(85);
    });

    test('broad question with short answer = penalized', () => {
      const score = SmartIntentAligner.analyzeScopeMatch(
        'Explain everything about machine learning algorithms',
        'ML is cool.'
      );
      expect(score).toBeLessThan(70);
    });

    test('neutral message = good default', () => {
      const score = SmartIntentAligner.analyzeScopeMatch(
        'Hello there',
        'Hi! How can I help you today?'
      );
      expect(score).toBeGreaterThanOrEqual(80);
    });
  });

  describe('Constraint Adherence Detector', () => {
    test('no constraints = 100', () => {
      const score = SmartIntentAligner.analyzeConstraintAdherence(
        'Tell me about dogs',
        'Dogs are wonderful pets.'
      );
      expect(score).toBe(100);
    });

    test('word limit violated = penalty', () => {
      const longResponse = Array(100).fill('word').join(' ');
      const score = SmartIntentAligner.analyzeConstraintAdherence(
        'Explain this under 10 words',
        longResponse
      );
      expect(score).toBeLessThan(100);
    });

    test('exclusion constraint violated', () => {
      const score = SmartIntentAligner.analyzeConstraintAdherence(
        "Don't include JavaScript",
        'Here is a JavaScript example: console.log("hello")'
      );
      expect(score).toBeLessThan(100);
    });

    test('style constraint brief but long response', () => {
      const longResponse = Array(200).fill('word').join(' ');
      const score = SmartIntentAligner.analyzeConstraintAdherence(
        'Keep it short please',
        longResponse
      );
      expect(score).toBeLessThan(100);
    });

    test('extractConstraints finds patterns', () => {
      const constraints = SmartIntentAligner.extractConstraints('Write in Python without using loops, under 50 words');
      expect(constraints.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Format Match Detector', () => {
    test('no format request = high score', () => {
      const score = SmartIntentAligner.analyzeFormatMatch(
        'Tell me about dogs',
        'Dogs are domesticated mammals.'
      );
      expect(score).toBe(90);
    });

    test('list requested but paragraph given = low', () => {
      const score = SmartIntentAligner.analyzeFormatMatch(
        'Give me a list of programming languages',
        'Programming languages have evolved over many decades. There are many different paradigms including object-oriented, functional, and procedural programming.'
      );
      expect(score).toBeLessThan(50);
    });

    test('list requested and list given = high', () => {
      const score = SmartIntentAligner.analyzeFormatMatch(
        'List the top programming languages',
        '- Python\n- JavaScript\n- TypeScript\n- Java\n- Go'
      );
      expect(score).toBeGreaterThanOrEqual(85);
    });

    test('code requested but no code = low', () => {
      const score = SmartIntentAligner.analyzeFormatMatch(
        'Write a function to sort an array',
        'Sorting an array involves comparing elements and rearranging them. You should consider the time complexity of your approach.'
      );
      expect(score).toBeLessThan(50);
    });

    test('code requested and code given = high', () => {
      const score = SmartIntentAligner.analyzeFormatMatch(
        'Write a function to sort an array',
        'Here is the function:\n```javascript\nfunction sort(arr) { return arr.sort(); }\n```'
      );
      expect(score).toBeGreaterThanOrEqual(85);
    });

    test('brief requested but long response = penalized', () => {
      const longResponse = Array(150).fill('word').join(' ');
      const score = SmartIntentAligner.analyzeFormatMatch(
        'Give me a brief summary',
        longResponse
      );
      expect(score).toBeLessThan(80);
    });

    test('detectRequestedFormat identifies list', () => {
      expect(SmartIntentAligner.detectRequestedFormat('Give me a list of items')).toBe('list');
    });

    test('detectRequestedFormat identifies code', () => {
      expect(SmartIntentAligner.detectRequestedFormat('Write a function for this')).toBe('code');
    });

    test('detectRequestedFormat returns null for no format', () => {
      expect(SmartIntentAligner.detectRequestedFormat('hello')).toBeNull();
    });
  });

  describe('Depth Match Detector', () => {
    test('neutral request = good default', () => {
      const score = SmartIntentAligner.analyzeDepthMatch(
        'What is recursion?',
        'Recursion is when a function calls itself.'
      );
      expect(score).toBe(85);
    });

    test('simple requested but complex given = penalized', () => {
      const complexResponse = Array(300).fill('metamorphosis').join(' ');
      const score = SmartIntentAligner.analyzeDepthMatch(
        'Explain like I\'m 5 what a computer is',
        complexResponse
      );
      expect(score).toBeLessThan(60);
    });

    test('detailed requested but short given = penalized', () => {
      const score = SmartIntentAligner.analyzeDepthMatch(
        'Give me a detailed analysis of sorting algorithms',
        'Sort things fast.'
      );
      expect(score).toBeLessThan(70);
    });

    test('simple requested with short simple answer = good', () => {
      const score = SmartIntentAligner.analyzeDepthMatch(
        'Explain in simple terms what an API is',
        'An API is like a waiter in a restaurant. You tell the waiter what you want, and it brings it from the kitchen.'
      );
      expect(score).toBeGreaterThanOrEqual(70);
    });
  });

  describe('Hallucination Risk Detector', () => {
    test('confident response = high score', () => {
      const score = SmartIntentAligner.analyzeHallucinationRisk(
        'What is 2+2?',
        'The answer is 4. Two plus two equals four in standard arithmetic.'
      );
      expect(score).toBeGreaterThanOrEqual(90);
    });

    test('heavily hedged response = lower score', () => {
      const score = SmartIntentAligner.analyzeHallucinationRisk(
        'What year was Python created?',
        'I think it might be 1991. I believe it could be around that time. Perhaps Guido van Rossum possibly started it then. It seems like it was maybe in the early 90s.'
      );
      expect(score).toBeLessThan(70);
    });

    test('contradictions detected', () => {
      const score = SmartIntentAligner.analyzeHallucinationRisk(
        'What is the speed of light?',
        'The speed of light is 300,000 km/s. Actually, let me correct that. However, on second thought, the answer is different. Actually it depends.'
      );
      expect(score).toBeLessThanOrEqual(80);
    });
  });

  describe('Relevance Decay Tracker', () => {
    test('too few exchanges = 90', () => {
      expect(SmartIntentAligner.analyzeRelevanceDecay([])).toBe(90);
      expect(SmartIntentAligner.analyzeRelevanceDecay([{}, {}])).toBe(90);
    });

    test('declining scores = lower result', () => {
      const exchanges = [
        { composite: 95 },
        { composite: 85 },
        { composite: 70 },
        { composite: 55 },
        { composite: 40 }
      ];
      const score = SmartIntentAligner.analyzeRelevanceDecay(exchanges);
      expect(score).toBeLessThan(70);
    });

    test('stable high scores = high result', () => {
      const exchanges = [
        { composite: 90 },
        { composite: 92 },
        { composite: 88 },
        { composite: 91 },
        { composite: 90 }
      ];
      const score = SmartIntentAligner.analyzeRelevanceDecay(exchanges);
      expect(score).toBeGreaterThanOrEqual(85);
    });
  });

  describe('Composite Scoring', () => {
    test('all 100 = 100', () => {
      const scores = {};
      Object.values(SmartIntentAligner.DIMENSIONS).forEach(d => { scores[d] = 100; });
      expect(SmartIntentAligner.computeComposite(scores)).toBe(100);
    });

    test('all 0 = 0', () => {
      const scores = {};
      Object.values(SmartIntentAligner.DIMENSIONS).forEach(d => { scores[d] = 0; });
      expect(SmartIntentAligner.computeComposite(scores)).toBe(0);
    });

    test('mixed scores = weighted average', () => {
      const scores = {};
      Object.values(SmartIntentAligner.DIMENSIONS).forEach(d => { scores[d] = 50; });
      expect(SmartIntentAligner.computeComposite(scores)).toBe(50);
    });
  });

  describe('Tier Classification', () => {
    test('classifyTier for each tier', () => {
      expect(SmartIntentAligner.classifyTier(95)).toBe('PERFECT');
      expect(SmartIntentAligner.classifyTier(90)).toBe('PERFECT');
      expect(SmartIntentAligner.classifyTier(75)).toBe('GOOD');
      expect(SmartIntentAligner.classifyTier(55)).toBe('DRIFTING');
      expect(SmartIntentAligner.classifyTier(30)).toBe('MISALIGNED');
      expect(SmartIntentAligner.classifyTier(0)).toBe('MISALIGNED');
    });
  });

  describe('Corrective Prompt Generation', () => {
    test('generates corrections for low topic drift', () => {
      const scores = { topicDrift: 40, scopeMatch: 90, constraintAdherence: 90, formatMatch: 90, depthMatch: 90, hallucinationRisk: 90, relevanceDecay: 90 };
      const corrections = SmartIntentAligner.generateCorrections(scores, 'How to sort arrays?', 'The weather is nice.');
      expect(corrections.length).toBeGreaterThanOrEqual(1);
      expect(corrections[0].dimension).toBe('topicDrift');
      expect(corrections[0].prompt).toContain('original question');
    });

    test('generates format correction', () => {
      const scores = { topicDrift: 90, scopeMatch: 90, constraintAdherence: 90, formatMatch: 40, depthMatch: 90, hallucinationRisk: 90, relevanceDecay: 90 };
      const corrections = SmartIntentAligner.generateCorrections(scores, 'Give me a list of languages', 'Languages are great.');
      const fmtCorr = corrections.find(c => c.dimension === 'formatMatch');
      expect(fmtCorr).toBeDefined();
      expect(fmtCorr.prompt).toContain('format');
    });

    test('no corrections when all scores are high', () => {
      const scores = { topicDrift: 95, scopeMatch: 95, constraintAdherence: 95, formatMatch: 95, depthMatch: 95, hallucinationRisk: 95, relevanceDecay: 95 };
      const corrections = SmartIntentAligner.generateCorrections(scores, 'hello', 'hi there');
      expect(corrections.length).toBe(0);
    });
  });

  describe('Insight Generation', () => {
    test('too few exchanges = no insights', () => {
      const insights = SmartIntentAligner.generateInsights([{}, {}]);
      expect(insights.length).toBe(0);
    });

    test('many exchanges with weak dimension = weakness insight', () => {
      const exchanges = Array(10).fill(null).map(() => ({
        userMsg: 'test',
        scores: { topicDrift: 40, scopeMatch: 90, constraintAdherence: 90, formatMatch: 90, depthMatch: 90, hallucinationRisk: 90, relevanceDecay: 90 }
      }));
      const insights = SmartIntentAligner.generateInsights(exchanges);
      const weakness = insights.find(i => i.type === 'weakness');
      expect(weakness).toBeDefined();
      expect(weakness.dimension).toBe('topicDrift');
    });
  });

  describe('Full Exchange Analysis', () => {
    test('analyzeExchange returns complete result', () => {
      const result = SmartIntentAligner.analyzeExchange(
        'How do I sort an array in Python?',
        'You can use the sorted() function or list.sort() method in Python.'
      );
      expect(result.scores).toBeDefined();
      expect(result.composite).toBeGreaterThanOrEqual(0);
      expect(result.composite).toBeLessThanOrEqual(100);
      expect(result.tier).toBeDefined();
      expect(result.timestamp).toBeGreaterThan(0);
    });

    test('misaligned exchange gets corrections', () => {
      const result = SmartIntentAligner.analyzeExchange(
        'Give me a brief list of the top 3 Python frameworks',
        'The history of programming languages dates back to the 1950s when FORTRAN was first developed. Computer science has evolved significantly since then, with many paradigms emerging over the decades including structured programming, object-oriented programming, and functional programming. The evolution of software engineering practices has been remarkable.'
      );
      expect(result.composite).toBeLessThan(80);
      expect(result.corrections.length).toBeGreaterThan(0);
    });
  });

  describe('Helper Functions', () => {
    test('_tokenize removes stopwords', () => {
      const tokens = SmartIntentAligner._tokenize('The quick brown fox jumps over the lazy dog');
      expect(tokens).not.toContain('the');
      expect(tokens).toContain('quick');
      expect(tokens).toContain('brown');
    });

    test('_wordCount counts words', () => {
      expect(SmartIntentAligner._wordCount('hello world foo')).toBe(3);
      expect(SmartIntentAligner._wordCount('')).toBe(0);
    });

    test('_hasCodeBlock detects code', () => {
      expect(SmartIntentAligner._hasCodeBlock('```js\nconsole.log("hi")\n```')).toBe(true);
      expect(SmartIntentAligner._hasCodeBlock('no code here')).toBe(false);
    });

    test('_hasList detects bullet lists', () => {
      expect(SmartIntentAligner._hasList('- item 1\n- item 2\n- item 3')).toBe(true);
      expect(SmartIntentAligner._hasList('just a paragraph')).toBe(false);
    });

    test('_hasTable detects markdown tables', () => {
      expect(SmartIntentAligner._hasTable('| a | b |\n|---|---|\n| 1 | 2 |')).toBe(true);
      expect(SmartIntentAligner._hasTable('no table')).toBe(false);
    });

    test('_keywordOverlap computes jaccard', () => {
      const overlap = SmartIntentAligner._keywordOverlap(['hello', 'world'], ['hello', 'world']);
      expect(overlap).toBe(1);
      const noOverlap = SmartIntentAligner._keywordOverlap(['hello'], ['world']);
      expect(noOverlap).toBe(0);
    });
  });
});
