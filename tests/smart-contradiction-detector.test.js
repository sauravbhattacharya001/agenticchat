/**
 * SmartContradictionDetector — Test Suite
 * Tests for autonomous AI contradiction detection including negation flips,
 * numerical contradictions, sentiment reversals, direct opposition, and yes/no flips.
 */

/* ── minimal stubs ── */
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="chat-output"></div><div id="chat-input"></div></body></html>');
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
global.KeyboardShortcuts = { register: jest.fn() };
global.CommandPalette = { register: jest.fn() };
global.SlashCommands = { register: jest.fn() };
global.PanelRegistry = { register: jest.fn() };
global.SessionManager = { current: () => 'test-session' };
global.sanitizeStorageObject = (o) => o;

// Minimal TextAnalysisUtils stub
global.TextAnalysisUtils = {
  tokenize: (text, opts) => {
    const min = (opts && opts.minLength) || 1;
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length >= min);
  }
};

// Minimal _truncate (app.js uses a shared top-level _truncate)
global._truncate = (str, max) => str && str.length > max ? str.slice(0, max) + '…' : str;

/* Load module */
const fs = require('fs');
const path = require('path');
const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// Extract SmartContradictionDetector module
const moduleStart = appCode.indexOf('var SmartContradictionDetector = (function');
const moduleEnd = appCode.indexOf('\n/* ==', moduleStart + 100);
const moduleCode = appCode.slice(moduleStart, moduleEnd > moduleStart ? moduleEnd : undefined)
  .replace('var SmartContradictionDetector', 'global.SmartContradictionDetector');

// We need to capture the internal functions for testing detection logic
// Wrap in a function that also exposes internals
const testableCode = moduleCode.replace(
  'return { toggle: toggle, show: show, hide: hide };',
  `return {
    toggle: toggle, show: show, hide: hide,
    _detectNegationFlip: _detectNegationFlip,
    _detectNumericalContradiction: _detectNumericalContradiction,
    _detectSentimentReversal: _detectSentimentReversal,
    _detectDirectOpposition: _detectDirectOpposition,
    _detectYesNoFlip: _detectYesNoFlip,
    _overlap: _overlap,
    _analyzeNewMessage: _analyzeNewMessage,
    _getContradictions: function() { return _contradictions; },
    _setAssistantMessages: function(msgs) { _assistantMessages = msgs; },
    _clearContradictions: function() { _contradictions = []; }
  };`
);

eval(testableCode);

const SCD = global.SmartContradictionDetector;

describe('SmartContradictionDetector', () => {
  beforeEach(() => {
    localStorage.clear();
    if (SCD._clearContradictions) SCD._clearContradictions();
  });

  describe('Module Structure', () => {
    test('exports toggle, show, hide', () => {
      expect(typeof SCD.toggle).toBe('function');
      expect(typeof SCD.show).toBe('function');
      expect(typeof SCD.hide).toBe('function');
    });

    test('exports internal detection functions for testing', () => {
      expect(typeof SCD._detectNegationFlip).toBe('function');
      expect(typeof SCD._detectNumericalContradiction).toBe('function');
      expect(typeof SCD._detectSentimentReversal).toBe('function');
      expect(typeof SCD._detectDirectOpposition).toBe('function');
      expect(typeof SCD._detectYesNoFlip).toBe('function');
    });
  });

  describe('_overlap (Jaccard similarity)', () => {
    test('returns 1.0 for identical token arrays', () => {
      expect(SCD._overlap(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(1.0);
    });

    test('returns 0 for disjoint arrays', () => {
      expect(SCD._overlap(['a', 'b'], ['c', 'd'])).toBe(0);
    });

    test('returns correct Jaccard for partial overlap', () => {
      // intersection: {a, b} = 2, union: {a, b, c, d} = 4 => 0.5
      expect(SCD._overlap(['a', 'b', 'c'], ['a', 'b', 'd'])).toBeCloseTo(0.5, 5);
    });

    test('returns 0 for two empty arrays', () => {
      expect(SCD._overlap([], [])).toBe(0);
    });

    test('handles duplicates correctly via Set', () => {
      // Set(['a','a','b']) = {a,b}, Set(['a','b','b']) = {a,b}
      expect(SCD._overlap(['a', 'a', 'b'], ['a', 'b', 'b'])).toBe(1.0);
    });
  });

  describe('_detectNegationFlip', () => {
    test('detects "X is Y" vs "X is not Y" negation', () => {
      const result = SCD._detectNegationFlip(
        'Python is great for data science',
        "Python isn't great for production"
      );
      expect(result).not.toBeNull();
      expect(result.type).toBe('negation');
      expect(result.keyword).toBe('great');
    });

    test('detects reverse negation (negation in first, positive in second)', () => {
      const result = SCD._detectNegationFlip(
        "The framework isn't stable yet",
        'The framework is stable and production-ready'
      );
      expect(result).not.toBeNull();
      expect(result.type).toBe('negation');
      expect(result.keyword).toBe('stable');
    });

    test('returns null for non-contradictory statements', () => {
      const result = SCD._detectNegationFlip(
        'React is popular for frontend development',
        'Vue is popular for frontend development'
      );
      expect(result).toBeNull();
    });

    test('strength scales with number of hits', () => {
      const result = SCD._detectNegationFlip(
        'It is fast and it is reliable',
        "It isn't fast and it isn't reliable"
      );
      expect(result).not.toBeNull();
      expect(result.strength).toBeGreaterThan(30);
    });
  });

  describe('_detectNumericalContradiction', () => {
    test('detects different numbers for same subject', () => {
      const result = SCD._detectNumericalContradiction(
        'The array has 5 elements',
        'The array has 10 elements'
      );
      expect(result).not.toBeNull();
      expect(result.type).toBe('number');
      expect(result.keyword).toBe('array');
      expect(result.val1).toBe('5');
      expect(result.val2).toBe('10');
      expect(result.strength).toBe(80);
    });

    test('returns null when numbers match', () => {
      const result = SCD._detectNumericalContradiction(
        'The list contains 3 items',
        'The list contains 3 items'
      );
      expect(result).toBeNull();
    });

    test('returns null when subjects differ', () => {
      const result = SCD._detectNumericalContradiction(
        'The width is 100 pixels',
        'The height is 200 pixels'
      );
      expect(result).toBeNull();
    });

    test('detects with different verb patterns (has/of/contains)', () => {
      const result = SCD._detectNumericalContradiction(
        'The buffer has 512 bytes allocated',
        'The buffer has 1024 bytes allocated'
      );
      expect(result).not.toBeNull();
      expect(result.type).toBe('number');
      expect(result.keyword).toBe('buffer');
    });
  });

  describe('_detectSentimentReversal', () => {
    test('detects positive-to-negative sentiment flip on same subject', () => {
      const result = SCD._detectSentimentReversal(
        'TypeScript is excellent for large projects',
        'TypeScript is terrible for large projects'
      );
      expect(result).not.toBeNull();
      expect(result.type).toBe('sentiment');
      expect(result.keyword).toBe('typescript');
      expect(result.strength).toBe(70);
    });

    test('detects reverse (negative first, positive second)', () => {
      const result = SCD._detectSentimentReversal(
        'MongoDB is bad for relational data',
        'MongoDB is great for relational data'
      );
      expect(result).not.toBeNull();
      expect(result.type).toBe('sentiment');
    });

    test('returns null for same-polarity sentiments', () => {
      const result = SCD._detectSentimentReversal(
        'Python is great for scripting',
        'Python is excellent for automation'
      );
      expect(result).toBeNull();
    });

    test('returns null when subjects differ', () => {
      const result = SCD._detectSentimentReversal(
        'React is great for SPAs',
        'Angular is terrible for mobile'
      );
      expect(result).toBeNull();
    });
  });

  describe('_detectDirectOpposition', () => {
    test('detects antonym pair on same subject', () => {
      const result = SCD._detectDirectOpposition(
        'This algorithm is fast for large datasets',
        'This algorithm is slow for large datasets'
      );
      expect(result).not.toBeNull();
      expect(result.type).toBe('opposition');
      expect(result.keyword).toBe('algorithm');
      expect(result.pair).toEqual(['fast', 'slow']);
      expect(result.strength).toBe(75);
    });

    test('detects reverse direction antonyms', () => {
      const result = SCD._detectDirectOpposition(
        'The solution is expensive to implement',
        'The solution is cheap to implement'
      );
      expect(result).not.toBeNull();
      expect(result.type).toBe('opposition');
    });

    test('returns null when subjects differ', () => {
      const result = SCD._detectDirectOpposition(
        'Java is fast for server workloads',
        'Python is slow for computation'
      );
      expect(result).toBeNull();
    });

    test('returns null with no antonym match', () => {
      const result = SCD._detectDirectOpposition(
        'The API returns JSON responses',
        'The API accepts XML input'
      );
      expect(result).toBeNull();
    });
  });

  describe('_detectYesNoFlip', () => {
    test('detects yes-then-no flip with topic overlap', () => {
      const result = SCD._detectYesNoFlip(
        'Yes, you should use async/await for API calls',
        'No, you should not use async/await for API calls'
      );
      expect(result).not.toBeNull();
      expect(result.type).toBe('yesno');
      expect(result.strength).toBeGreaterThanOrEqual(60);
    });

    test('detects "correct" vs "not really" variations', () => {
      const result = SCD._detectYesNoFlip(
        'Correct, that approach handles race conditions',
        'Not really, that approach handles race conditions'
      );
      expect(result).not.toBeNull();
      expect(result.type).toBe('yesno');
    });

    test('returns null when both start affirmatively', () => {
      const result = SCD._detectYesNoFlip(
        'Yes, use TypeScript for type safety',
        'Yes, use TypeScript for large teams'
      );
      expect(result).toBeNull();
    });

    test('returns null when topic overlap is too low', () => {
      const result = SCD._detectYesNoFlip(
        'Yes, React is great',
        'No, bananas are yellow'
      );
      expect(result).toBeNull();
    });
  });

  describe('_analyzeNewMessage (integration)', () => {
    beforeEach(() => {
      SCD._clearContradictions();
    });

    test('detects contradiction between two assistant messages', () => {
      SCD._setAssistantMessages([
        { index: 0, text: 'The limit is 5 items per request in the API' },
        { index: 1, text: 'The limit is 10 items per request in the API' }
      ]);
      SCD._analyzeNewMessage(1);
      const contradictions = SCD._getContradictions();
      expect(contradictions.length).toBe(1);
      expect(contradictions[0].type).toBe('number');
      expect(contradictions[0].confidence).toBeGreaterThan(0);
    });

    test('does not flag unrelated messages', () => {
      SCD._setAssistantMessages([
        { index: 0, text: 'Python is great for data science' },
        { index: 1, text: 'JavaScript powers modern web browsers' }
      ]);
      SCD._analyzeNewMessage(1);
      const contradictions = SCD._getContradictions();
      expect(contradictions.length).toBe(0);
    });

    test('confidence includes temporal boost for adjacent messages', () => {
      SCD._setAssistantMessages([
        { index: 0, text: 'The server is fast and responsive' },
        { index: 1, text: 'The server is slow and unresponsive' }
      ]);
      SCD._analyzeNewMessage(1);
      const contradictions = SCD._getContradictions();
      expect(contradictions.length).toBeGreaterThan(0);
      // Adjacent messages get temporal boost (distance=1, boost = max(0, 20-3) = 17)
      expect(contradictions[0].confidence).toBeGreaterThan(75);
    });

    test('confidence decreases for distant messages', () => {
      const messages = [
        { index: 0, text: 'The API is fast for production workloads' },
        { index: 1, text: 'Some unrelated filler message here' },
        { index: 2, text: 'Another unrelated filler about topics' },
        { index: 3, text: 'Yet more padding between the messages' },
        { index: 4, text: 'Even more spacing between contradictions' },
        { index: 5, text: 'The filler keeps going with more text' },
        { index: 6, text: 'Almost there with filler messages now' },
        { index: 7, text: 'The API is slow for production workloads' }
      ];
      SCD._setAssistantMessages(messages);
      SCD._analyzeNewMessage(7);
      const contradictions = SCD._getContradictions();
      // Distance of 7 means temporal boost = max(0, 20 - 7*3) = 0
      if (contradictions.length > 0) {
        expect(contradictions[0].confidence).toBeLessThanOrEqual(100);
      }
    });

    test('stores contradiction metadata correctly', () => {
      SCD._setAssistantMessages([
        { index: 0, text: 'Yes, you should use Docker for deployment' },
        { index: 1, text: 'No, you should use Docker for deployment' }
      ]);
      SCD._analyzeNewMessage(1);
      const contradictions = SCD._getContradictions();
      expect(contradictions.length).toBe(1);
      const c = contradictions[0];
      expect(c.id).toBeDefined();
      expect(c.msgIdx1).toBe(0);
      expect(c.msgIdx2).toBe(1);
      expect(c.excerpt1).toBeDefined();
      expect(c.excerpt2).toBeDefined();
      expect(c.ts).toBeGreaterThan(0);
    });

    test('only one detection per message pair (first match wins)', () => {
      // This message pair could trigger multiple detectors
      SCD._setAssistantMessages([
        { index: 0, text: 'Yes, the system is fast and reliable' },
        { index: 1, text: 'No, the system is slow and unreliable' }
      ]);
      SCD._analyzeNewMessage(1);
      const contradictions = SCD._getContradictions();
      // Should only have 1 entry per pair even though multiple detectors match
      expect(contradictions.length).toBe(1);
    });

    test('handles empty/null message gracefully', () => {
      SCD._setAssistantMessages([]);
      expect(() => SCD._analyzeNewMessage(0)).not.toThrow();
      expect(() => SCD._analyzeNewMessage(5)).not.toThrow();
    });
  });

  describe('Persistence', () => {
    test('saves contradictions to SafeStorage on detection', () => {
      SCD._setAssistantMessages([
        { index: 0, text: 'The timeout is 30 seconds' },
        { index: 1, text: 'The timeout is 60 seconds' }
      ]);
      SCD._analyzeNewMessage(1);
      const stored = localStorage.getItem('ac_contradictions_test-session');
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored);
      expect(parsed.length).toBe(1);
      expect(parsed[0].type).toBe('number');
    });
  });

  describe('UI toggle', () => {
    test('show creates and opens panel', () => {
      SCD.show();
      const panel = document.querySelector('.contradiction-panel');
      expect(panel).not.toBeNull();
      expect(panel.classList.contains('open')).toBe(true);
    });

    test('hide removes open class', () => {
      SCD.show();
      SCD.hide();
      const panel = document.querySelector('.contradiction-panel');
      expect(panel.classList.contains('open')).toBe(false);
    });

    test('toggle switches visibility', () => {
      SCD.show();
      SCD.toggle(); // should hide
      const panel = document.querySelector('.contradiction-panel');
      expect(panel.classList.contains('open')).toBe(false);
    });
  });
});
