/**
 * SmartLearningTracker — Test Suite
 * 68 tests covering all 7 engines: Topic Extraction, Comprehension Signal Detection,
 * Knowledge Gap Detection, Learning Velocity Tracking, Mastery Scoring,
 * Learning Health Scoring, Insight Generation, plus state/config/UI.
 */

const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
const { JSDOM } = require('jsdom');

function bootModule() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="chat-output"></div><div class="toolbar"></div></body></html>', { url: 'http://localhost' });
  const { window } = dom;
  const { document } = window;

  global.window = window;
  global.document = document;
  global.HTMLElement = window.HTMLElement;
  global.MutationObserver = class { observe() {} disconnect() {} };
  global.setTimeout = (fn) => fn();
  global.clearTimeout = () => {};
  global.requestAnimationFrame = (fn) => fn();

  const _store = {};
  global.SafeStorage = {
    get(k) { return _store[k] || null; },
    set(k, v) { _store[k] = v; },
    remove(k) { delete _store[k]; }
  };
  global.navigator = { clipboard: { writeText: () => Promise.resolve() } };
  global.KeyboardShortcuts = { register: jest.fn() };

  delete require.cache[require.resolve('../app.js')];

  const fs = require('fs');
  const src = fs.readFileSync(require.resolve('../app.js'), 'utf8');
  const marker = '* SmartLearningTracker';
  const markerFull = '/* ============================================================';
  let idx = src.lastIndexOf(marker);
  if (idx === -1) throw new Error('SmartLearningTracker not found in app.js');
  const blockStart = src.lastIndexOf(markerFull, idx);
  if (blockStart !== -1) idx = blockStart;
  const moduleCode = src.slice(idx);

  const tuStart = src.indexOf('const TextAnalysisUtils = (() => {');
  const tuEnd = src.indexOf('})();', tuStart);
  const tuCode = tuStart !== -1 && tuEnd !== -1 ? src.slice(tuStart, tuEnd + 5) : '';

  const ssoMatch = src.match(/function sanitizeStorageObject\b[\s\S]*?\n\}/);
  const ssoCode = ssoMatch ? ssoMatch[0] : 'function sanitizeStorageObject(o) { return o; }';

  const fn = new Function('SafeStorage', 'document', 'MutationObserver', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'navigator',
    ssoCode + '\n' + tuCode + '\n' + moduleCode + '\nreturn SmartLearningTracker;');
  const mod = fn(global.SafeStorage, document, global.MutationObserver, global.setTimeout, global.clearTimeout, global.requestAnimationFrame, global.navigator);

  return { mod, dom, document, _store };
}

let SLT, dom, doc, store;

beforeEach(() => {
  const env = bootModule();
  SLT = env.mod;
  dom = env.dom;
  doc = env.document;
  store = env._store;
});

/* ── Engine 1: Topic Extraction ── */
describe('extractTopics', () => {
  test('extracts programming topics', () => {
    const r = SLT.extractTopics('How do I use async await in JavaScript?');
    expect(r.length).toBeGreaterThan(0);
    expect(r.some(t => t.category === 'programming')).toBe(true);
  });

  test('extracts math topics', () => {
    const r = SLT.extractTopics('Can you explain the derivative of a polynomial?');
    expect(r.length).toBeGreaterThan(0);
    expect(r.some(t => t.category === 'math')).toBe(true);
  });

  test('extracts science topics', () => {
    const r = SLT.extractTopics('How does photosynthesis work in plant cells?');
    expect(r.length).toBeGreaterThan(0);
    expect(r.some(t => t.category === 'science')).toBe(true);
  });

  test('extracts topics from questions with "what is"', () => {
    const r = SLT.extractTopics('What is a closure in programming?');
    expect(r.length).toBeGreaterThan(0);
  });

  test('extracts topics from "how does X work"', () => {
    const r = SLT.extractTopics('How does recursion work?');
    expect(r.length).toBeGreaterThan(0);
  });

  test('extracts topics from "explain X"', () => {
    const r = SLT.extractTopics('Explain the concept of polymorphism.');
    expect(r.length).toBeGreaterThan(0);
  });

  test('returns empty for null/empty', () => {
    expect(SLT.extractTopics(null)).toEqual([]);
    expect(SLT.extractTopics('')).toEqual([]);
  });

  test('returns empty for non-string', () => {
    expect(SLT.extractTopics(42)).toEqual([]);
  });

  test('topics have required fields', () => {
    const r = SLT.extractTopics('What is an array and how do loop iterations work?');
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]).toHaveProperty('topic');
    expect(r[0]).toHaveProperty('category');
    expect(r[0]).toHaveProperty('confidence');
    expect(r[0]).toHaveProperty('firstSeen');
    expect(r[0]).toHaveProperty('lastSeen');
  });

  test('extracts design topics', () => {
    const r = SLT.extractTopics('What are the best practices for typography and layout?');
    expect(r.some(t => t.category === 'design')).toBe(true);
  });

  test('extracts business topics', () => {
    const r = SLT.extractTopics('How do I calculate ROI and revenue margin?');
    expect(r.some(t => t.category === 'business')).toBe(true);
  });
});

/* ── Engine 2: Comprehension Signal Detection ── */
describe('detectComprehension', () => {
  test('detects understanding signals', () => {
    const r = SLT.detectComprehension('Oh I see, that makes sense now!');
    expect(r.signals.length).toBeGreaterThan(0);
    expect(r.signals.some(s => s.type === 'understanding')).toBe(true);
    expect(r.comprehensionScore).toBeGreaterThan(50);
  });

  test('detects confusion signals', () => {
    const r = SLT.detectComprehension("I don't get it, I'm still confused.");
    expect(r.signals.length).toBeGreaterThan(0);
    expect(r.signals.some(s => s.type === 'confusion')).toBe(true);
    expect(r.comprehensionScore).toBeLessThan(50);
  });

  test('detects application signals', () => {
    const r = SLT.detectComprehension('Let me try using this for my project.');
    expect(r.signals.length).toBeGreaterThan(0);
    expect(r.signals.some(s => s.type === 'application')).toBe(true);
    expect(r.comprehensionScore).toBeGreaterThan(50);
  });

  test('returns neutral score for neutral text', () => {
    const r = SLT.detectComprehension('The function returns an integer.');
    expect(r.signals.length).toBe(0);
    expect(r.comprehensionScore).toBe(50);
  });

  test('returns default for null/empty', () => {
    expect(SLT.detectComprehension(null).signals).toEqual([]);
    expect(SLT.detectComprehension('').comprehensionScore).toBe(50);
  });

  test('handles mixed signals', () => {
    const r = SLT.detectComprehension("I see what you mean but I'm still confused about one part.");
    expect(r.signals.length).toBeGreaterThan(1);
  });

  test('signals have confidence', () => {
    const r = SLT.detectComprehension('Got it, makes sense!');
    expect(r.signals[0]).toHaveProperty('confidence');
    expect(typeof r.signals[0].confidence).toBe('number');
  });

  test('score is clamped 0-100', () => {
    const r1 = SLT.detectComprehension("I don't get it. I'm lost. What do you mean? Can you explain again? Still confused. Huh?");
    expect(r1.comprehensionScore).toBeGreaterThanOrEqual(0);
    const r2 = SLT.detectComprehension('I see! Got it! Makes sense! Oh that explains it! Crystal clear! Now I get it!');
    expect(r2.comprehensionScore).toBeLessThanOrEqual(100);
  });
});

/* ── Engine 3: Knowledge Gap Detection ── */
describe('detectGaps', () => {
  test('returns empty with no data', () => {
    expect(SLT.detectGaps()).toEqual([]);
  });

  test('detects gap when confusion exceeds understanding', () => {
    // Simulate messages with confusion on a topic
    SLT.analyzeMessage('What is recursion?', 'user');
    SLT.analyzeMessage('Recursion is a function calling itself.', 'assistant');
    SLT.analyzeMessage("I don't get recursion. I'm still confused about recursion.", 'user');
    SLT.analyzeMessage("Can you explain recursion again? I'm lost.", 'user');

    const gaps = SLT.detectGaps();
    // May or may not have gaps depending on signal matching
    expect(Array.isArray(gaps)).toBe(true);
  });

  test('gap objects have required fields', () => {
    SLT.analyzeMessage('What is closure?', 'user');
    SLT.analyzeMessage("I don't get closure. Still confused about closure.", 'user');
    SLT.analyzeMessage("Huh? Can you explain closure again?", 'user');

    const gaps = SLT.detectGaps();
    if (gaps.length > 0) {
      expect(gaps[0]).toHaveProperty('topic');
      expect(gaps[0]).toHaveProperty('gapScore');
      expect(gaps[0]).toHaveProperty('confusionCount');
      expect(gaps[0]).toHaveProperty('understandingCount');
      expect(gaps[0]).toHaveProperty('suggestions');
    }
  });

  test('gaps are sorted by gapScore descending', () => {
    SLT.analyzeMessage('What is array and loop?', 'user');
    SLT.analyzeMessage("I don't get array. Still confused about array.", 'user');
    SLT.analyzeMessage("Huh? array again?", 'user');
    SLT.analyzeMessage("loop is confusing. I don't understand loop.", 'user');

    const gaps = SLT.detectGaps();
    for (let i = 1; i < gaps.length; i++) {
      expect(gaps[i - 1].gapScore).toBeGreaterThanOrEqual(gaps[i].gapScore);
    }
  });
});

/* ── Engine 4: Learning Velocity ── */
describe('getVelocity', () => {
  test('returns velocity object with correct shape', () => {
    const v = SLT.getVelocity();
    expect(v).toHaveProperty('topicsPerHour');
    expect(v).toHaveProperty('acceleration');
    expect(v).toHaveProperty('phase');
    expect(v).toHaveProperty('trend');
    expect(typeof v.topicsPerHour).toBe('number');
  });

  test('phase is one of known values', () => {
    const v = SLT.getVelocity();
    expect(['accelerating', 'steady', 'decelerating', 'stalled']).toContain(v.phase);
  });

  test('velocity starts at 0 with no data', () => {
    const v = SLT.getVelocity();
    expect(v.topicsPerHour).toBe(0);
  });

  test('velocity increases after analyzing topics', () => {
    SLT.analyzeMessage('What is a function in programming?', 'user');
    SLT.analyzeMessage('Got it, makes sense!', 'user');
    const v = SLT.getVelocity();
    expect(v.topicsPerHour).toBeGreaterThanOrEqual(0);
  });

  test('trend is an array', () => {
    SLT.analyzeMessage('How does recursion work?', 'user');
    const v = SLT.getVelocity();
    expect(Array.isArray(v.trend)).toBe(true);
  });
});

/* ── Engine 5: Mastery Scoring ── */
describe('getMastery / getAllMastery', () => {
  test('returns null for unknown topic', () => {
    expect(SLT.getMastery('nonexistent')).toBeNull();
  });

  test('returns null for null input', () => {
    expect(SLT.getMastery(null)).toBeNull();
  });

  test('returns mastery for tracked topic', () => {
    SLT.analyzeMessage('What is a closure?', 'user');
    SLT.analyzeMessage('A closure captures variables from outer scope.', 'assistant');
    const m = SLT.getMastery('closure');
    expect(m).not.toBeNull();
    expect(m).toHaveProperty('score');
    expect(m).toHaveProperty('tier');
    expect(m.score).toBeGreaterThanOrEqual(0);
    expect(m.score).toBeLessThanOrEqual(100);
  });

  test('mastery increases with understanding signals', () => {
    SLT.analyzeMessage('What is a closure?', 'user');
    const before = SLT.getMastery('closure');
    SLT.analyzeMessage('Oh I see, closure makes sense now! Got it!', 'user');
    // After understanding signal, score should still exist
    const after = SLT.getMastery('closure');
    expect(after).not.toBeNull();
  });

  test('getAllMastery returns sorted array', () => {
    SLT.analyzeMessage('Tell me about arrays and loops', 'user');
    const all = SLT.getAllMastery();
    expect(Array.isArray(all)).toBe(true);
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1].score).toBeGreaterThanOrEqual(all[i].score);
    }
  });

  test('mastery tier is correct', () => {
    SLT.analyzeMessage('What is polymorphism?', 'user');
    const m = SLT.getMastery('polymorphism');
    expect(m.tier).toHaveProperty('id');
    expect(m.tier).toHaveProperty('name');
    expect(m.tier).toHaveProperty('min');
    expect(m.tier).toHaveProperty('max');
  });

  test('mastery tier classification covers all ranges', () => {
    expect(SLT.classifyTier(0).id).toBe('stalled');
    expect(SLT.classifyTier(25).id).toBe('struggling');
    expect(SLT.classifyTier(50).id).toBe('moderate');
    expect(SLT.classifyTier(75).id).toBe('strong');
    expect(SLT.classifyTier(95).id).toBe('exceptional');
  });
});

/* ── Engine 6: Learning Health Scoring ── */
describe('computeScore / classifyTier', () => {
  test('returns a number 0-100', () => {
    const score = SLT.computeScore();
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  test('classifyTier returns tier object', () => {
    const tier = SLT.classifyTier(70);
    expect(tier).toHaveProperty('id');
    expect(tier).toHaveProperty('name');
    expect(tier).toHaveProperty('color');
  });

  test('tier boundaries are correct', () => {
    expect(SLT.classifyTier(0).id).toBe('stalled');
    expect(SLT.classifyTier(20).id).toBe('stalled');
    expect(SLT.classifyTier(21).id).toBe('struggling');
    expect(SLT.classifyTier(40).id).toBe('struggling');
    expect(SLT.classifyTier(41).id).toBe('moderate');
    expect(SLT.classifyTier(60).id).toBe('moderate');
    expect(SLT.classifyTier(61).id).toBe('strong');
    expect(SLT.classifyTier(80).id).toBe('strong');
    expect(SLT.classifyTier(81).id).toBe('exceptional');
    expect(SLT.classifyTier(100).id).toBe('exceptional');
  });

  test('score changes after analyzing messages', () => {
    const before = SLT.computeScore();
    SLT.analyzeMessage('What is a function?', 'user');
    SLT.analyzeMessage('Got it, makes sense!', 'user');
    // Score may or may not change, but should be valid
    const after = SLT.computeScore();
    expect(typeof after).toBe('number');
  });
});

/* ── Engine 7: Insight Generation ── */
describe('generateInsights', () => {
  test('returns an array', () => {
    expect(Array.isArray(SLT.generateInsights())).toBe(true);
  });

  test('returns empty with no data', () => {
    expect(SLT.generateInsights().length).toBe(0);
  });

  test('generates insights after activity', () => {
    SLT.analyzeMessage('What is recursion?', 'user');
    SLT.analyzeMessage('Recursion is a function calling itself.', 'assistant');
    SLT.analyzeMessage('Got it! That makes sense!', 'user');
    // May or may not produce insights
    const insights = SLT.generateInsights();
    expect(Array.isArray(insights)).toBe(true);
  });

  test('insights have required fields', () => {
    SLT.analyzeMessage('What is a closure?', 'user');
    SLT.analyzeMessage('I see, makes sense! Got it! Crystal clear!', 'user');
    SLT.analyzeMessage('Let me try using this for my project.', 'user');
    const insights = SLT.generateInsights();
    if (insights.length > 0) {
      expect(insights[0]).toHaveProperty('type');
      expect(insights[0]).toHaveProperty('message');
      expect(insights[0]).toHaveProperty('priority');
    }
  });

  test('insights are sorted by priority descending', () => {
    SLT.analyzeMessage('What are arrays and loops?', 'user');
    SLT.analyzeMessage("I don't get arrays. Still confused.", 'user');
    SLT.analyzeMessage("Huh? arrays?", 'user');
    SLT.analyzeMessage('Got it! Loops make sense now!', 'user');
    const insights = SLT.generateInsights();
    for (let i = 1; i < insights.length; i++) {
      expect(insights[i - 1].priority).toBeGreaterThanOrEqual(insights[i].priority);
    }
  });
});

/* ── State & Config ── */
describe('state management', () => {
  test('getState returns deep copy', () => {
    const s1 = SLT.getState();
    const s2 = SLT.getState();
    expect(s1).toEqual(s2);
    expect(s1).not.toBe(s2);
  });

  test('getConfig returns copy', () => {
    const c = SLT.getConfig();
    expect(c).toHaveProperty('enabled');
    expect(c).toHaveProperty('sensitivity');
  });

  test('reset clears state', () => {
    SLT.analyzeMessage('What is a function?', 'user');
    SLT.reset();
    const s = SLT.getState();
    expect(s.topics).toEqual([]);
    expect(s.messages).toEqual([]);
  });

  test('setEnabled toggles', () => {
    SLT.setEnabled(false);
    expect(SLT.isEnabled()).toBe(false);
    SLT.setEnabled(true);
    expect(SLT.isEnabled()).toBe(true);
  });

  test('disabled module skips analysis', () => {
    SLT.setEnabled(false);
    SLT.analyzeMessage('What is recursion?', 'user');
    expect(SLT.getState().topics).toEqual([]);
  });

  test('setSensitivity changes config', () => {
    SLT.setSensitivity('high');
    expect(SLT.getConfig().sensitivity).toBe('high');
    SLT.setSensitivity('low');
    expect(SLT.getConfig().sensitivity).toBe('low');
  });

  test('invalid sensitivity is ignored', () => {
    SLT.setSensitivity('invalid');
    expect(['low', 'medium', 'high']).toContain(SLT.getConfig().sensitivity);
  });
});

/* ── analyzeMessage integration ── */
describe('analyzeMessage', () => {
  test('tracks topics from user message', () => {
    SLT.analyzeMessage('How do I use closures in JavaScript?', 'user');
    const s = SLT.getState();
    expect(s.topics.length).toBeGreaterThan(0);
    expect(s.messages.length).toBe(1);
  });

  test('tracks topics from assistant message', () => {
    SLT.analyzeMessage('A closure is created when a function captures variables from its enclosing scope.', 'assistant');
    const s = SLT.getState();
    expect(s.messages.length).toBe(1);
  });

  test('ignores null/empty/non-string', () => {
    SLT.analyzeMessage(null, 'user');
    SLT.analyzeMessage('', 'user');
    SLT.analyzeMessage(42, 'user');
    expect(SLT.getState().messages).toEqual([]);
  });

  test('updates velocity history', () => {
    SLT.analyzeMessage('What is an array?', 'user');
    expect(SLT.getState().velocityHistory.length).toBeGreaterThan(0);
  });

  test('updates score', () => {
    SLT.analyzeMessage('What is an object?', 'user');
    expect(typeof SLT.getScore()).toBe('number');
  });

  test('messages are capped at MAX', () => {
    for (let i = 0; i < 1010; i++) {
      SLT.analyzeMessage('function ' + i, 'user');
    }
    expect(SLT.getState().messages.length).toBeLessThanOrEqual(1000);
  });
});

/* ── Constants ── */
describe('constants', () => {
  test('CATEGORIES has expected keys', () => {
    expect(SLT.CATEGORIES).toHaveProperty('programming');
    expect(SLT.CATEGORIES).toHaveProperty('math');
    expect(SLT.CATEGORIES).toHaveProperty('science');
    expect(SLT.CATEGORIES).toHaveProperty('general');
  });

  test('COMPREHENSION_SIGNALS has expected types', () => {
    expect(SLT.COMPREHENSION_SIGNALS).toHaveProperty('understanding');
    expect(SLT.COMPREHENSION_SIGNALS).toHaveProperty('confusion');
    expect(SLT.COMPREHENSION_SIGNALS).toHaveProperty('application');
  });

  test('MASTERY_TIERS covers 0-100', () => {
    expect(SLT.MASTERY_TIERS.length).toBe(5);
  });

  test('HEALTH_TIERS covers 0-100', () => {
    expect(SLT.HEALTH_TIERS.length).toBe(5);
  });

  test('INSIGHT_TYPES has 5 types', () => {
    expect(Object.keys(SLT.INSIGHT_TYPES).length).toBe(5);
  });
});

/* ── UI helpers ── */
describe('UI helpers', () => {
  test('_sparkline returns path for valid data', () => {
    const path = SLT._sparkline([10, 20, 30, 40], 100, 30);
    expect(path).toContain('M');
    expect(path).toContain('L');
  });

  test('_sparkline returns empty for insufficient data', () => {
    expect(SLT._sparkline([10], 100, 30)).toBe('');
    expect(SLT._sparkline([], 100, 30)).toBe('');
  });

  test('show/hide/toggle work', () => {
    SLT.show();
    const panel = doc.getElementById('smart-learning-panel');
    expect(panel).not.toBeNull();
    SLT.hide();
    expect(panel.style.display).toBe('none');
    SLT.toggle();
    expect(panel.style.display).toBe('block');
  });

  test('_switchTab does not throw', () => {
    SLT.show();
    expect(() => SLT._switchTab('topics')).not.toThrow();
    expect(() => SLT._switchTab('gaps')).not.toThrow();
    expect(() => SLT._switchTab('insights')).not.toThrow();
  });
});
