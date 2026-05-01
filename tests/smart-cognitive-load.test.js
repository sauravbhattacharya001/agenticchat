/**
 * SmartCognitiveLoad — Test Suite
 * Tests for autonomous cognitive load monitoring, signal detection, and recommendations.
 */

/* ── minimal stubs ── */
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="chat-output"></div><div class="toolbar"></div><textarea id="user-input"></textarea></body></html>');
global.document = dom.window.document;
global.window = dom.window;
global.MutationObserver = class { observe() {} disconnect() {} };
global.localStorage = (() => {
  let store = {};
  return { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; }, clear: () => { store = {}; } };
})();
global.SafeStorage = {
  get: k => localStorage.getItem(k),
  set: (k, v) => localStorage.setItem(k, v),
  getJSON: (k, fallback = null) => { const raw = localStorage.getItem(k); if (raw == null) return fallback; try { return JSON.parse(raw); } catch (_) { return fallback; } },
  setJSON: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  trySetJSON: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  trySet: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} }
};
global.setTimeout = (fn) => fn();
global.clearTimeout = () => {};

// Mock KeyboardShortcuts
global.KeyboardShortcuts = { register: jest.fn() };
global.CommandPalette = { register: jest.fn() };

/* Load module */
const fs = require('fs');
const path = require('path');
const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// Extract SmartCognitiveLoad module
const moduleStart = appCode.lastIndexOf('const SmartCognitiveLoad');
const moduleCode = appCode.slice(moduleStart).replace('const SmartCognitiveLoad', 'global.SmartCognitiveLoad');
eval(moduleCode);

describe('SmartCognitiveLoad', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('Module Structure', () => {
    test('exports required public methods', () => {
      expect(typeof SmartCognitiveLoad.toggle).toBe('function');
      expect(typeof SmartCognitiveLoad.show).toBe('function');
      expect(typeof SmartCognitiveLoad.hide).toBe('function');
      expect(typeof SmartCognitiveLoad.processMessage).toBe('function');
      expect(typeof SmartCognitiveLoad.analyzeDimensions).toBe('function');
      expect(typeof SmartCognitiveLoad.computeLoadScore).toBe('function');
      expect(typeof SmartCognitiveLoad.classifyZone).toBe('function');
    });

    test('exports constants', () => {
      expect(SmartCognitiveLoad.DIMENSIONS).toBeDefined();
      expect(SmartCognitiveLoad.ZONES).toBeDefined();
      expect(SmartCognitiveLoad.SIGNAL_TYPES).toBeDefined();
      expect(SmartCognitiveLoad.RECOMMENDATION_TYPES).toBeDefined();
    });

    test('_defaultState returns fresh state', () => {
      const s = SmartCognitiveLoad._defaultState();
      expect(s.loadScore).toBe(0);
      expect(s.zone).toBe('FLOW');
      expect(s.signals).toEqual([]);
      expect(s.history).toEqual([]);
    });

    test('_defaultConfig returns correct defaults', () => {
      const c = SmartCognitiveLoad._defaultConfig();
      expect(c.enabled).toBe(true);
      expect(c.showBadge).toBe(true);
      expect(c.toastAlerts).toBe(true);
      expect(c.autoRecommend).toBe(true);
      expect(c.sensitivityMultiplier).toBe(1.0);
    });
  });

  describe('Text Analysis Utilities', () => {
    test('_tokenize splits text into lowercase words', () => {
      const tokens = SmartCognitiveLoad._tokenize('Hello World! This is a Test.');
      expect(tokens).toContain('hello');
      expect(tokens).toContain('world');
      expect(tokens).toContain('test');
    });

    test('_tokenize handles empty input', () => {
      expect(SmartCognitiveLoad._tokenize('')).toEqual([]);
      expect(SmartCognitiveLoad._tokenize(null)).toEqual([]);
    });

    test('_sentences splits on sentence boundaries', () => {
      const s = SmartCognitiveLoad._sentences('First sentence. Second one! Third?');
      expect(s.length).toBe(3);
    });

    test('_sentences handles empty input', () => {
      expect(SmartCognitiveLoad._sentences('')).toEqual([]);
    });

    test('_countFacts counts numbers, URLs, code blocks, list items', () => {
      const text = 'There are 42 items at https://example.com\n- item one\n- item two\n```code```';
      const count = SmartCognitiveLoad._countFacts(text);
      expect(count).toBeGreaterThan(3);
    });

    test('_extractTopics returns meaningful words', () => {
      const topics = SmartCognitiveLoad._extractTopics('The algorithm processes neural network layers through backpropagation');
      expect(topics.length).toBeGreaterThan(0);
      expect(topics.some(t => t.length > 4)).toBe(true);
    });

    test('_extractTopics handles empty text', () => {
      expect(SmartCognitiveLoad._extractTopics('')).toEqual([]);
    });
  });

  describe('Dimension Analysis', () => {
    test('analyzeInfoDensity returns 0 for simple text', () => {
      const score = SmartCognitiveLoad.analyzeInfoDensity('Hello there.');
      expect(score).toBeLessThan(0.3);
    });

    test('analyzeInfoDensity returns high for data-rich text', () => {
      const text = '42 users, 15.5% growth at https://api.com and https://docs.com. Revenue is $1.2M with 300 customers. The 500 items cost 79.99 each.';
      const score = SmartCognitiveLoad.analyzeInfoDensity(text);
      expect(score).toBeGreaterThan(0.1);
    });

    test('analyzeConceptDepth scores abstract text higher', () => {
      const abstract = 'The paradigm of encapsulation within polymorphism creates an abstraction layer for the ontology framework.';
      const simple = 'I want to make a button that changes color when you click it.';
      const absScore = SmartCognitiveLoad.analyzeConceptDepth(abstract);
      const simScore = SmartCognitiveLoad.analyzeConceptDepth(simple);
      expect(absScore).toBeGreaterThan(simScore);
    });

    test('analyzeConceptDepth accounts for nesting', () => {
      const nested = 'The function (which takes (a callback (that returns (a promise)))) is complex.';
      const flat = 'The function takes a callback.';
      expect(SmartCognitiveLoad.analyzeConceptDepth(nested)).toBeGreaterThan(SmartCognitiveLoad.analyzeConceptDepth(flat));
    });

    test('analyzeVocabComplexity scores rare vocabulary higher', () => {
      const complex = 'Epistemological metacognition facilitates hermeneutic disambiguation of phenomenological constructs.';
      const simple = 'I like to go to the store and get some food.';
      expect(SmartCognitiveLoad.analyzeVocabComplexity(complex)).toBeGreaterThan(SmartCognitiveLoad.analyzeVocabComplexity(simple));
    });

    test('analyzeVocabComplexity returns 0 for empty', () => {
      expect(SmartCognitiveLoad.analyzeVocabComplexity('')).toBe(0);
    });

    test('analyzeContextSwitches returns 0 for first message', () => {
      const state = SmartCognitiveLoad._defaultState();
      const score = SmartCognitiveLoad.analyzeContextSwitches('Hello world testing', state);
      expect(score).toBe(0);
    });

    test('analyzeContextSwitches detects topic change', () => {
      const state = SmartCognitiveLoad._defaultState();
      state.previousTopics = ['algorithm', 'database', 'server', 'backend'];
      const score = SmartCognitiveLoad.analyzeContextSwitches('The painting gallery exhibition features Renaissance artwork masterpieces', state);
      expect(score).toBeGreaterThan(0.5);
    });

    test('analyzeWorkingMemory increases with questions', () => {
      const state = SmartCognitiveLoad._defaultState();
      state.openQuestions = [1, 2, 3, 4, 5];
      state.topics = ['a', 'b', 'c', 'd', 'e'];
      const score = SmartCognitiveLoad.analyzeWorkingMemory('What about this? And that?', state);
      expect(score).toBeGreaterThan(0.5);
    });

    test('analyzeDimensions returns all 6 dimensions', () => {
      const dims = SmartCognitiveLoad.analyzeDimensions('Test message about algorithms and paradigms.');
      expect(Object.keys(dims).length).toBe(6);
      Object.values(dims).forEach(v => {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('Load Score Computation', () => {
    test('computeLoadScore returns 0 for all-zero dimensions', () => {
      const dims = { topicCount: 0, infoDensity: 0, conceptDepth: 0, vocabComplexity: 0, contextSwitches: 0, workingMemory: 0 };
      expect(SmartCognitiveLoad.computeLoadScore(dims)).toBe(0);
    });

    test('computeLoadScore returns 100 for all-max dimensions', () => {
      const dims = { topicCount: 1, infoDensity: 1, conceptDepth: 1, vocabComplexity: 1, contextSwitches: 1, workingMemory: 1 };
      expect(SmartCognitiveLoad.computeLoadScore(dims)).toBe(100);
    });

    test('computeLoadScore weights info density and concept depth higher', () => {
      const dimsA = { topicCount: 0, infoDensity: 1, conceptDepth: 0, vocabComplexity: 0, contextSwitches: 0, workingMemory: 0 };
      const dimsB = { topicCount: 1, infoDensity: 0, conceptDepth: 0, vocabComplexity: 0, contextSwitches: 0, workingMemory: 0 };
      expect(SmartCognitiveLoad.computeLoadScore(dimsA)).toBeGreaterThan(SmartCognitiveLoad.computeLoadScore(dimsB));
    });
  });

  describe('Zone Classification', () => {
    test('classifies 0-30 as FLOW', () => {
      expect(SmartCognitiveLoad.classifyZone(0)).toBe('FLOW');
      expect(SmartCognitiveLoad.classifyZone(15)).toBe('FLOW');
      expect(SmartCognitiveLoad.classifyZone(30)).toBe('FLOW');
    });

    test('classifies 31-60 as LEARNING', () => {
      expect(SmartCognitiveLoad.classifyZone(31)).toBe('LEARNING');
      expect(SmartCognitiveLoad.classifyZone(45)).toBe('LEARNING');
      expect(SmartCognitiveLoad.classifyZone(60)).toBe('LEARNING');
    });

    test('classifies 61-80 as STRAIN', () => {
      expect(SmartCognitiveLoad.classifyZone(61)).toBe('STRAIN');
      expect(SmartCognitiveLoad.classifyZone(70)).toBe('STRAIN');
      expect(SmartCognitiveLoad.classifyZone(80)).toBe('STRAIN');
    });

    test('classifies 81-100 as OVERLOAD', () => {
      expect(SmartCognitiveLoad.classifyZone(81)).toBe('OVERLOAD');
      expect(SmartCognitiveLoad.classifyZone(90)).toBe('OVERLOAD');
      expect(SmartCognitiveLoad.classifyZone(100)).toBe('OVERLOAD');
    });
  });

  describe('Signal Detection', () => {
    test('detects compression signal', () => {
      const signals = SmartCognitiveLoad.detectSignals('ok', 'A'.repeat(600));
      expect(signals.some(s => s.type === 'compression')).toBe(true);
    });

    test('no compression for proportional response', () => {
      const signals = SmartCognitiveLoad.detectSignals('A'.repeat(200), 'B'.repeat(400));
      expect(signals.some(s => s.type === 'compression')).toBe(false);
    });

    test('detects explicit overwhelm phrases', () => {
      const signals = SmartCognitiveLoad.detectSignals('wait what do you mean by that', '');
      expect(signals.some(s => s.type === 'explicit')).toBe(true);
    });

    test('detects confusion from short question', () => {
      const signals = SmartCognitiveLoad.detectSignals('what?', '');
      expect(signals.some(s => s.type === 'confusion')).toBe(true);
    });

    test('no signals for normal message', () => {
      const signals = SmartCognitiveLoad.detectSignals('That makes sense, thanks for the explanation about databases.', 'You are welcome!');
      expect(signals.filter(s => s.type === 'compression' || s.type === 'explicit' || s.type === 'confusion').length).toBe(0);
    });

    test('signals have timestamp', () => {
      const signals = SmartCognitiveLoad.detectSignals('huh?', 'complex explanation');
      signals.forEach(s => {
        expect(s.ts).toBeDefined();
        expect(typeof s.ts).toBe('number');
      });
    });
  });

  describe('Recommendation Generation', () => {
    test('generates RECAP when working memory high', () => {
      const dims = { topicCount: 0.3, infoDensity: 0.3, conceptDepth: 0.3, vocabComplexity: 0.3, contextSwitches: 0.3, workingMemory: 0.8 };
      const recs = SmartCognitiveLoad.generateRecommendations(dims, 50, []);
      expect(recs.some(r => r.id === 'recap')).toBe(true);
    });

    test('generates CHUNK when info density high', () => {
      const dims = { topicCount: 0.3, infoDensity: 0.8, conceptDepth: 0.3, vocabComplexity: 0.3, contextSwitches: 0.3, workingMemory: 0.3 };
      const recs = SmartCognitiveLoad.generateRecommendations(dims, 50, []);
      expect(recs.some(r => r.id === 'chunk')).toBe(true);
    });

    test('generates SIMPLIFY when vocab complexity high', () => {
      const dims = { topicCount: 0.3, infoDensity: 0.3, conceptDepth: 0.3, vocabComplexity: 0.8, contextSwitches: 0.3, workingMemory: 0.3 };
      const recs = SmartCognitiveLoad.generateRecommendations(dims, 50, []);
      expect(recs.some(r => r.id === 'simplify')).toBe(true);
    });

    test('generates VISUAL_AID for abstract + complex vocab', () => {
      const dims = { topicCount: 0.3, infoDensity: 0.3, conceptDepth: 0.7, vocabComplexity: 0.6, contextSwitches: 0.3, workingMemory: 0.3 };
      const recs = SmartCognitiveLoad.generateRecommendations(dims, 50, []);
      expect(recs.some(r => r.id === 'visualAid')).toBe(true);
    });

    test('generates PAUSE on multiple high-severity signals', () => {
      const dims = { topicCount: 0.3, infoDensity: 0.3, conceptDepth: 0.3, vocabComplexity: 0.3, contextSwitches: 0.3, workingMemory: 0.3 };
      const signals = [
        { type: 'explicit', severity: 'high', ts: Date.now() },
        { type: 'confusion', severity: 'high', ts: Date.now() }
      ];
      const recs = SmartCognitiveLoad.generateRecommendations(dims, 50, signals);
      expect(recs.some(r => r.id === 'pause')).toBe(true);
    });

    test('generates CLOSE_TOPIC when topics accumulate with abandonment', () => {
      const dims = { topicCount: 0.7, infoDensity: 0.3, conceptDepth: 0.3, vocabComplexity: 0.3, contextSwitches: 0.3, workingMemory: 0.3 };
      const signals = [{ type: 'abandonment', severity: 'medium', ts: Date.now() }];
      const recs = SmartCognitiveLoad.generateRecommendations(dims, 50, signals);
      expect(recs.some(r => r.id === 'closeTopic')).toBe(true);
    });

    test('no recommendations when all dimensions low', () => {
      const dims = { topicCount: 0.1, infoDensity: 0.1, conceptDepth: 0.1, vocabComplexity: 0.1, contextSwitches: 0.1, workingMemory: 0.1 };
      const recs = SmartCognitiveLoad.generateRecommendations(dims, 10, []);
      expect(recs.length).toBe(0);
    });
  });

  describe('processMessage Integration', () => {
    test('returns analysis result', () => {
      const result = SmartCognitiveLoad.processMessage('How does recursion work?', 'Recursion is when a function calls itself.');
      expect(result).toBeDefined();
      expect(result.dims).toBeDefined();
      expect(typeof result.score).toBe('number');
      expect(result.zone).toBeDefined();
    });

    test('updates state after processing', () => {
      SmartCognitiveLoad.processMessage('Test message', 'Response message');
      const state = SmartCognitiveLoad.getState();
      expect(state.messageCount).toBeGreaterThan(0);
      expect(state.history.length).toBeGreaterThan(0);
    });

    test('accumulates history entries', () => {
      SmartCognitiveLoad.processMessage('msg1', 'resp1');
      SmartCognitiveLoad.processMessage('msg2', 'resp2');
      const history = SmartCognitiveLoad.getHistory();
      expect(history.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Edge Cases', () => {
    test('handles very long messages without error', () => {
      const longText = 'word '.repeat(5000);
      expect(() => SmartCognitiveLoad.processMessage(longText, longText)).not.toThrow();
    });

    test('handles single-word messages', () => {
      const result = SmartCognitiveLoad.processMessage('yes', 'ok');
      expect(result).toBeDefined();
      expect(result.score).toBeGreaterThanOrEqual(0);
    });

    test('handles empty messages gracefully', () => {
      const result = SmartCognitiveLoad.processMessage('', '');
      expect(result).toBeDefined();
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    test('handles null messages', () => {
      const result = SmartCognitiveLoad.processMessage(null, null);
      expect(result).toBeDefined();
    });

    test('handles unicode and emoji text', () => {
      const result = SmartCognitiveLoad.processMessage('Hello 🌍 世界!', 'Response with émojis 🎉');
      expect(result).toBeDefined();
    });
  });
});
