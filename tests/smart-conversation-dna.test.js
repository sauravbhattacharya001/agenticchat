/**
 * @jest-environment jsdom
 */
/* eslint-disable no-undef */

// Mock localStorage
const localStore = {};
const localStorageMock = {
  getItem: jest.fn((k) => localStore[k] || null),
  setItem: jest.fn((k, v) => { localStore[k] = String(v); }),
  removeItem: jest.fn((k) => { delete localStore[k]; }),
  clear: jest.fn(() => { for (const k in localStore) delete localStore[k]; })
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Minimal SafeStorage mock
global.SafeStorage = {
  get: (k) => localStore[k] || null,
  set: (k, v) => { localStore[k] = String(v); },
  setJSON: (k, v) => { localStore[k] = JSON.stringify(v); }
};

// Load module
const fs = require('fs');
const path = require('path');
const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// Extract just the SmartConversationDNA IIFE
const startMarker = 'const SmartConversationDNA = (function ()';
const startIdx = appCode.indexOf(startMarker);
if (startIdx === -1) throw new Error('SmartConversationDNA not found in app.js');

// Find the matching end
let depth = 0;
let endIdx = -1;
for (let i = startIdx; i < appCode.length; i++) {
  if (appCode[i] === '(') depth++;
  if (appCode[i] === ')') {
    depth--;
    if (depth === 0) {
      // Find the semicolon
      endIdx = appCode.indexOf(';', i) + 1;
      break;
    }
  }
}
if (endIdx === -1) throw new Error('Could not find end of SmartConversationDNA module');

const moduleCode = appCode.substring(startIdx, endIdx);
const wrappedCode = moduleCode.replace('const SmartConversationDNA =', 'global.SmartConversationDNA =');
eval(wrappedCode);

const DNA = global.SmartConversationDNA;

beforeEach(() => {
  localStorageMock.clear();
  for (const k in localStore) delete localStore[k];
  DNA.reset();
});

/* ══════════════════════════════════════════════
   MODULE STRUCTURE
   ══════════════════════════════════════════════ */
describe('SmartConversationDNA – Module Structure', () => {
  test('module is defined', () => {
    expect(DNA).toBeDefined();
    expect(typeof DNA).toBe('object');
  });

  test('exposes all public API methods', () => {
    const methods = ['toggle', 'show', 'hide', 'reset', 'init', 'analyzeMessage',
      'getState', 'getConfig', 'getScore', 'getTier', 'getDNA', 'getInsights',
      'isEnabled', 'setEnabled', 'setSensitivity', 'computeScore', 'classifyTier',
      'generateInsights'];
    methods.forEach((m) => {
      expect(typeof DNA[m]).toBe('function');
    });
  });

  test('exposes engine methods', () => {
    expect(typeof DNA.analyzeRhythm).toBe('function');
    expect(typeof DNA.classifyQuestion).toBe('function');
    expect(typeof DNA.analyzeVocabulary).toBe('function');
    expect(typeof DNA.detectEngagement).toBe('function');
    expect(typeof DNA.measureStyle).toBe('function');
    expect(typeof DNA.extractTopicKeywords).toBe('function');
    expect(typeof DNA.detectTopicTransition).toBe('function');
  });

  test('exposes constants', () => {
    expect(DNA.QUESTION_TYPES).toBeDefined();
    expect(DNA.ENGAGEMENT_SIGNALS).toBeDefined();
    expect(DNA.STYLE_DIMENSIONS).toBeDefined();
    expect(DNA.TIERS).toBeDefined();
    expect(DNA.SENSITIVITIES).toBeDefined();
  });
});

/* ══════════════════════════════════════════════
   ENGINE 1: Message Rhythm Analyzer
   ══════════════════════════════════════════════ */
describe('Engine 1 – Message Rhythm', () => {
  test('classifies short messages', () => {
    const r = DNA.analyzeRhythm('hello');
    expect(r.category).toBe('short');
    expect(r.wordCount).toBe(1);
  });

  test('classifies medium messages', () => {
    const r = DNA.analyzeRhythm('This is a medium length message with several words in it to test the classification');
    expect(r.category).toBe('medium');
  });

  test('classifies long messages', () => {
    const words = new Array(50).fill('word').join(' ');
    const r = DNA.analyzeRhythm(words);
    expect(r.category).toBe('long');
    expect(r.wordCount).toBe(50);
  });

  test('rhythm profile starts empty', () => {
    const p = DNA.getRhythmProfile();
    expect(p.avgLength).toBe(0);
    expect(p.cadence).toBe('unknown');
  });

  test('rhythm profile updates after analysis', () => {
    DNA.analyzeMessage('short msg', 'user');
    DNA.analyzeMessage('another short one', 'user');
    const p = DNA.getRhythmProfile();
    expect(p.avgLength).toBeGreaterThan(0);
    expect(p.cadence).toBe('rapid-fire');
  });

  test('consistency score is 0-100', () => {
    for (let i = 0; i < 5; i++) DNA.analyzeMessage('similar length message here', 'user');
    const p = DNA.getRhythmProfile();
    expect(p.consistency).toBeGreaterThanOrEqual(0);
    expect(p.consistency).toBeLessThanOrEqual(100);
  });
});

/* ══════════════════════════════════════════════
   ENGINE 2: Question Taxonomy Classifier
   ══════════════════════════════════════════════ */
describe('Engine 2 – Question Taxonomy', () => {
  test('classifies open-ended questions', () => {
    expect(DNA.classifyQuestion('What do you think about this?')).toBe('open');
    expect(DNA.classifyQuestion('How would you approach this problem?')).toBe('open');
  });

  test('classifies closed questions', () => {
    expect(DNA.classifyQuestion('Is this correct?')).toBe('closed');
    expect(DNA.classifyQuestion('Can you do this?')).toBe('closed');
  });

  test('classifies clarifying questions', () => {
    expect(DNA.classifyQuestion('What do you mean by this concept?')).toBe('clarifying');
  });

  test('classifies debugging questions', () => {
    expect(DNA.classifyQuestion('There is an error in the code, not working?')).toBe('debugging');
  });

  test('classifies how-to questions', () => {
    expect(DNA.classifyQuestion('I need a step by step walkthrough?')).toBe('howto');
  });

  test('returns null for non-questions', () => {
    expect(DNA.classifyQuestion('This is a statement.')).toBeNull();
  });

  test('question profile tracks distribution', () => {
    DNA.analyzeMessage('What do you think about AI?', 'user');
    DNA.analyzeMessage('Is this correct?', 'user');
    const p = DNA.getQuestionProfile();
    expect(p.total).toBeGreaterThan(0);
  });

  test('question diversity ranges 0-1', () => {
    DNA.analyzeMessage('How do I fix this?', 'user');
    DNA.analyzeMessage('What is the difference?', 'user');
    DNA.analyzeMessage('Is this right?', 'user');
    const p = DNA.getQuestionProfile();
    expect(p.diversity).toBeGreaterThan(0);
    expect(p.diversity).toBeLessThanOrEqual(1);
  });
});

/* ══════════════════════════════════════════════
   ENGINE 3: Vocabulary Complexity Tracker
   ══════════════════════════════════════════════ */
describe('Engine 3 – Vocabulary Complexity', () => {
  test('computes average word length', () => {
    const v = DNA.analyzeVocabulary('hello world test');
    expect(v.avgWordLength).toBeGreaterThan(0);
  });

  test('computes type-token ratio', () => {
    const v = DNA.analyzeVocabulary('the the the same same word');
    expect(v.ttr).toBeLessThan(1);
    const v2 = DNA.analyzeVocabulary('each word unique different');
    expect(v2.ttr).toBe(1);
  });

  test('detects technical density', () => {
    const v = DNA.analyzeVocabulary('The API endpoint uses async await with JSON response from the server');
    expect(v.technicalDensity).toBeGreaterThan(0);
  });

  test('handles empty text', () => {
    const v = DNA.analyzeVocabulary('');
    expect(v.avgWordLength).toBe(0);
    expect(v.ttr).toBe(0);
  });

  test('vocabulary profile tracks evolution', () => {
    // Feed many messages to test evolution
    for (let i = 0; i < 10; i++) DNA.analyzeMessage('simple short message', 'user');
    const p = DNA.getVocabularyProfile();
    expect(p.uniqueWords).toBeGreaterThan(0);
    expect(['stable', 'expanding', 'simplifying']).toContain(p.evolution);
  });
});

/* ══════════════════════════════════════════════
   ENGINE 4: Topic Transition Mapper
   ══════════════════════════════════════════════ */
describe('Engine 4 – Topic Transitions', () => {
  test('extracts topic keywords', () => {
    const kw = DNA.extractTopicKeywords('The algorithm uses recursion for sorting data efficiently');
    expect(kw.length).toBeGreaterThan(0);
    expect(kw.every((k) => k.length > 3)).toBe(true);
  });

  test('filters stopwords', () => {
    const kw = DNA.extractTopicKeywords('this that with from have been');
    expect(kw.length).toBe(0);
  });

  test('detects deepening transition', () => {
    const t = DNA.detectTopicTransition(['algorithm', 'sorting'], ['algorithm', 'sorting', 'quicksort']);
    expect(t).toBe('deepening');
  });

  test('detects pivot transition', () => {
    const t = DNA.detectTopicTransition(['algorithm', 'sorting'], ['cooking', 'recipe']);
    expect(t).toBe('pivot');
  });

  test('detects start for no previous keywords', () => {
    const t = DNA.detectTopicTransition(null, ['hello']);
    expect(t).toBe('start');
  });

  test('topic profile tracks counts', () => {
    DNA.analyzeMessage('Tell me about machine learning algorithms', 'user');
    DNA.analyzeMessage('What about deep learning neural networks?', 'user');
    const p = DNA.getTopicProfile();
    expect(p.totalTopics).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════
   ENGINE 5: Engagement Signal Detector
   ══════════════════════════════════════════════ */
describe('Engine 5 – Engagement Signals', () => {
  test('detects satisfaction', () => {
    const s = DNA.detectEngagement('Thanks, that was perfect!');
    expect(s).toContain('satisfaction');
  });

  test('detects frustration', () => {
    const s = DNA.detectEngagement("No, that's wrong. You're wrong about this.");
    expect(s).toContain('frustration');
  });

  test('detects confusion', () => {
    const s = DNA.detectEngagement("I don't understand what you mean");
    expect(s).toContain('confusion');
  });

  test('detects curiosity', () => {
    const s = DNA.detectEngagement('Interesting! Tell me more about that.');
    expect(s).toContain('curiosity');
  });

  test('returns empty for neutral text', () => {
    const s = DNA.detectEngagement('The sky is blue.');
    expect(s.length).toBe(0);
  });

  test('engagement profile tracks balance', () => {
    DNA.analyzeMessage('Thanks, perfect!', 'user');
    DNA.analyzeMessage("That's not what I asked", 'user');
    DNA.analyzeMessage('Tell me more about this', 'user');
    const p = DNA.getEngagementProfile();
    expect(p.total).toBeGreaterThan(0);
    expect(p.balance).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════
   ENGINE 6: Communication Style Mutator
   ══════════════════════════════════════════════ */
describe('Engine 6 – Style Measurement', () => {
  test('measures brevity - short message', () => {
    const s = DNA.measureStyle('hi');
    expect(s.brevity).toBeGreaterThan(50);
  });

  test('measures brevity - long message', () => {
    const long = new Array(100).fill('word').join(' ');
    const s = DNA.measureStyle(long);
    expect(s.brevity).toBeLessThanOrEqual(50);
  });

  test('measures technicality', () => {
    const s = DNA.measureStyle('The API endpoint uses async callbacks with JSON response');
    expect(s.technicality).toBeGreaterThan(0);
  });

  test('measures formality - informal', () => {
    const s = DNA.measureStyle('lol gonna wanna kinda do this btw');
    expect(s.formality).toBeLessThan(50);
  });

  test('measures directness - imperative', () => {
    const s = DNA.measureStyle('Show me the code');
    expect(s.directness).toBeGreaterThan(50);
  });

  test('measures emotionality', () => {
    const s = DNA.measureStyle('I love this! Amazing! Wonderful!');
    expect(s.emotionality).toBeGreaterThan(0);
  });

  test('measures interactivity', () => {
    const s = DNA.measureStyle('What do you think? Can you help? Is this right?');
    expect(s.interactivity).toBeGreaterThan(0);
  });

  test('all dimensions are 0-100', () => {
    const s = DNA.measureStyle('A normal everyday message about various things');
    Object.values(s).forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    });
  });
});

/* ══════════════════════════════════════════════
   ENGINE 7: DNA Scorer & Insights
   ══════════════════════════════════════════════ */
describe('Engine 7 – DNA Scorer & Insights', () => {
  test('initial score is 0', () => {
    expect(DNA.getScore()).toBe(0);
  });

  test('score increases with messages', () => {
    DNA.analyzeMessage('How do I build a machine learning model?', 'user');
    DNA.analyzeMessage('Thanks, that was helpful!', 'user');
    DNA.analyzeMessage('What about deep learning vs traditional ML?', 'user');
    DNA.analyzeMessage('Can you show me some Python code examples?', 'user');
    DNA.analyzeMessage("I don't understand the gradient descent part", 'user');
    expect(DNA.getScore()).toBeGreaterThan(0);
  });

  test('score is 0-100', () => {
    for (let i = 0; i < 20; i++) DNA.analyzeMessage('Message number ' + i + ' with some varied content and questions?', 'user');
    const s = DNA.getScore();
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });

  test('tier classification works', () => {
    expect(DNA.classifyTier(0).id).toBe('generic');
    expect(DNA.classifyTier(10).id).toBe('generic');
    expect(DNA.classifyTier(30).id).toBe('developing');
    expect(DNA.classifyTier(50).id).toBe('distinctive');
    expect(DNA.classifyTier(70).id).toBe('unique');
    expect(DNA.classifyTier(90).id).toBe('singular');
    expect(DNA.classifyTier(100).id).toBe('singular');
  });

  test('generateInsights returns array', () => {
    const ins = DNA.generateInsights();
    expect(Array.isArray(ins)).toBe(true);
  });

  test('insights generated after messages', () => {
    for (let i = 0; i < 15; i++) DNA.analyzeMessage('Varied message ' + i + ' with questions? And exclamations!', 'user');
    const ins = DNA.generateInsights();
    expect(ins.length).toBeGreaterThan(0);
    ins.forEach((i) => {
      expect(i.type).toBeDefined();
      expect(i.text).toBeDefined();
      expect(i.ts).toBeDefined();
    });
  });
});

/* ══════════════════════════════════════════════
   MESSAGE ANALYSIS PIPELINE
   ══════════════════════════════════════════════ */
describe('Message Analysis Pipeline', () => {
  test('analyzeMessage returns full result', () => {
    const r = DNA.analyzeMessage('How do I deploy this API to production?', 'user');
    expect(r).toBeDefined();
    expect(r.rhythm).toBeDefined();
    expect(r.vocabulary).toBeDefined();
    expect(r.style).toBeDefined();
    expect(r.score).toBeDefined();
    expect(r.tier).toBeDefined();
  });

  test('analyzeMessage ignores assistant messages', () => {
    const r = DNA.analyzeMessage('Here is the answer...', 'assistant');
    expect(r).toBeNull();
  });

  test('analyzeMessage ignores empty text', () => {
    const r = DNA.analyzeMessage('', 'user');
    expect(r).toBeNull();
  });

  test('analyzeMessage ignores null text', () => {
    const r = DNA.analyzeMessage(null, 'user');
    expect(r).toBeNull();
  });

  test('state updates after analysis', () => {
    DNA.analyzeMessage('Test message for analysis', 'user');
    const state = DNA.getState();
    expect(state.totalMessages).toBe(1);
    expect(state.messages.length).toBe(1);
  });

  test('multiple messages accumulate', () => {
    DNA.analyzeMessage('First message', 'user');
    DNA.analyzeMessage('Second message', 'user');
    DNA.analyzeMessage('Third message', 'user');
    expect(DNA.getState().totalMessages).toBe(3);
  });
});

/* ══════════════════════════════════════════════
   CONFIGURATION
   ══════════════════════════════════════════════ */
describe('Configuration', () => {
  test('default config', () => {
    const c = DNA.getConfig();
    expect(c.enabled).toBe(true);
    expect(c.sensitivity).toBe('medium');
  });

  test('setEnabled toggles', () => {
    DNA.setEnabled(false);
    expect(DNA.isEnabled()).toBe(false);
    DNA.setEnabled(true);
    expect(DNA.isEnabled()).toBe(true);
  });

  test('disabled module skips analysis', () => {
    DNA.setEnabled(false);
    const r = DNA.analyzeMessage('This should be ignored', 'user');
    expect(r).toBeNull();
    expect(DNA.getState().totalMessages).toBe(0);
  });

  test('setSensitivity changes config', () => {
    DNA.setSensitivity('high');
    expect(DNA.getConfig().sensitivity).toBe('high');
    DNA.setSensitivity('low');
    expect(DNA.getConfig().sensitivity).toBe('low');
  });

  test('sensitivity affects score', () => {
    for (let i = 0; i < 10; i++) DNA.analyzeMessage('Varied message number ' + i + '?', 'user');
    DNA.setSensitivity('low');
    const lowScore = DNA.getScore();
    DNA.setSensitivity('high');
    const highScore = DNA.getScore();
    // High sensitivity should give >= low sensitivity score (multiplier is higher)
    expect(highScore).toBeGreaterThanOrEqual(lowScore);
  });
});

/* ══════════════════════════════════════════════
   STATE PERSISTENCE
   ══════════════════════════════════════════════ */
describe('State Persistence', () => {
  test('reset clears state', () => {
    DNA.analyzeMessage('some message', 'user');
    expect(DNA.getState().totalMessages).toBe(1);
    DNA.reset();
    expect(DNA.getState().totalMessages).toBe(0);
    expect(DNA.getScore()).toBe(0);
  });

  test('getDNA returns complete profile', () => {
    DNA.analyzeMessage('How does machine learning work?', 'user');
    const dna = DNA.getDNA();
    expect(dna.score).toBeDefined();
    expect(dna.tier).toBeDefined();
    expect(dna.rhythm).toBeDefined();
    expect(dna.vocabulary).toBeDefined();
    expect(dna.questions).toBeDefined();
    expect(dna.engagement).toBeDefined();
    expect(dna.style).toBeDefined();
    expect(dna.topics).toBeDefined();
    expect(dna.totalMessages).toBe(1);
  });
});

/* ══════════════════════════════════════════════
   EDGE CASES
   ══════════════════════════════════════════════ */
describe('Edge Cases', () => {
  test('handles very long messages', () => {
    const long = new Array(500).fill('word').join(' ');
    const r = DNA.analyzeMessage(long, 'user');
    expect(r).toBeDefined();
    expect(r.rhythm.wordCount).toBe(500);
  });

  test('handles single character', () => {
    const r = DNA.analyzeMessage('x', 'user');
    expect(r).toBeDefined();
    expect(r.rhythm.category).toBe('short');
  });

  test('handles special characters', () => {
    const r = DNA.analyzeMessage('!@#$%^&*(){}[]<>?', 'user');
    expect(r).toBeDefined();
  });

  test('handles numbers only', () => {
    const r = DNA.analyzeMessage('12345 67890', 'user');
    expect(r).toBeDefined();
  });

  test('handles unicode/emoji text', () => {
    const r = DNA.analyzeMessage('Hello 🌍 world 🎉 testing 🧬', 'user');
    expect(r).toBeDefined();
    expect(r.rhythm.wordCount).toBeGreaterThan(0);
  });

  test('handles mixed language', () => {
    const r = DNA.analyzeMessage('Bonjour hello こんにちは testing mixed 语言', 'user');
    expect(r).toBeDefined();
  });

  test('handles repeated analysis without crash', () => {
    for (let i = 0; i < 100; i++) {
      DNA.analyzeMessage('Message iteration ' + i + ' with variable content and questions?', 'user');
    }
    expect(DNA.getState().totalMessages).toBe(100);
    expect(DNA.getScore()).toBeGreaterThanOrEqual(0);
  });
});

/* ══════════════════════════════════════════════
   SPARKLINE & PANEL HELPERS
   ══════════════════════════════════════════════ */
describe('Helpers', () => {
  test('_sparkline generates chart', () => {
    const s = DNA._sparkline([1, 5, 3, 8, 2, 7, 4], 7);
    expect(s.length).toBeGreaterThan(0);
  });

  test('_sparkline handles empty array', () => {
    expect(DNA._sparkline([])).toBe('');
  });

  test('_sparkline handles single value', () => {
    const s = DNA._sparkline([5]);
    expect(s.length).toBe(1);
  });

  test('_defaultState returns fresh state', () => {
    const s = DNA._defaultState();
    expect(s.totalMessages).toBe(0);
    expect(s.messages).toEqual([]);
  });

  test('_defaultConfig returns defaults', () => {
    const c = DNA._defaultConfig();
    expect(c.enabled).toBe(true);
    expect(c.sensitivity).toBe('medium');
  });

  test('_switchTab does not throw without panel', () => {
    expect(() => DNA._switchTab(null, 'overview')).not.toThrow();
  });
});

/* ══════════════════════════════════════════════
   PANEL RENDERING
   ══════════════════════════════════════════════ */
describe('Panel Rendering', () => {
  test('show creates panel element', () => {
    DNA.show();
    const panel = document.getElementById('smart-conversation-dna-panel');
    expect(panel).toBeTruthy();
    DNA.hide();
  });

  test('hide makes panel invisible', () => {
    DNA.show();
    DNA.hide();
    const panel = document.getElementById('smart-conversation-dna-panel');
    expect(panel.style.display).toBe('none');
  });

  test('panel renders after analysis', () => {
    DNA.analyzeMessage('How do I build APIs?', 'user');
    DNA.show();
    const panel = document.getElementById('smart-conversation-dna-panel');
    expect(panel.innerHTML).toContain('Conversation DNA');
    DNA.hide();
  });

  test('_renderPanel does not throw', () => {
    DNA.show();
    expect(() => DNA._renderPanel()).not.toThrow();
    DNA.hide();
  });
});
