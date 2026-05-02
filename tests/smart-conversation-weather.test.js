/**
 * SmartConversationWeather — tests
 * 45+ test cases covering all 6 dimension analyzers, weather classification,
 * phenomena detection, composite scoring, config, state, and insights.
 */

/* ── Minimal DOM + SafeStorage mock ── */
const { JSDOM } = require('jsdom');

function bootModule() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="chat-output"></div><div class="toolbar"></div></body></html>', { url: 'http://localhost' });
  const { window } = dom;
  const { document } = window;

  // Patch globals
  global.window = window;
  global.document = document;
  global.HTMLElement = window.HTMLElement;
  global.MutationObserver = class { observe() {} disconnect() {} };
  global.setTimeout = window.setTimeout;
  global.clearTimeout = window.clearTimeout;

  const _store = {};
  global.SafeStorage = {
    get(k) { return _store[k] || null; },
    set(k, v) { _store[k] = v; },
    remove(k) { delete _store[k]; }
  };

  // Load module
  delete require.cache[require.resolve('../app.js')];

  // We only need SmartConversationWeather — eval just that IIFE
  const fs = require('fs');
  const src = fs.readFileSync(require.resolve('../app.js'), 'utf8');
  const marker = '/* ============================================================\n * SmartConversationWeather';
  const idx = src.lastIndexOf(marker);
  if (idx === -1) throw new Error('SmartConversationWeather not found in app.js');
  const moduleCode = src.slice(idx);
  const fn = new Function('SafeStorage', 'document', 'MutationObserver', 'setTimeout', 'clearTimeout', moduleCode + '\nreturn SmartConversationWeather;');
  const mod = fn(global.SafeStorage, document, global.MutationObserver, global.setTimeout, global.clearTimeout);
  return { mod, dom, document, _store };
}

let SCW, dom, doc, store;

beforeEach(() => {
  const env = bootModule();
  SCW = env.mod;
  dom = env.dom;
  doc = env.document;
  store = env._store;
});

/* ═══════════════════════════════════════════════════════
 * 1. Clarity Analysis
 * ═══════════════════════════════════════════════════════ */
describe('analyzeClarity', () => {
  test('returns 50 for empty messages', () => {
    expect(SCW.analyzeClarity('', '')).toBe(50);
  });
  test('high clarity when AI echoes user keywords', () => {
    const score = SCW.analyzeClarity('How do I sort an array in JavaScript?', 'To sort an array in JavaScript, use the Array.sort() method.');
    expect(score).toBeGreaterThanOrEqual(60);
  });
  test('lower clarity when AI response is off-topic', () => {
    const score = SCW.analyzeClarity('How do I sort an array?', 'The weather today is sunny and warm.');
    expect(score).toBeLessThan(60);
  });
  test('question with substantial answer scores well', () => {
    const score = SCW.analyzeClarity('What is recursion?', 'Recursion is a technique where a function calls itself to solve subproblems until a base case is reached.');
    expect(score).toBeGreaterThanOrEqual(50);
  });
  test('score is clamped 0-100', () => {
    const score = SCW.analyzeClarity('a', 'b');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

/* ═══════════════════════════════════════════════════════
 * 2. Energy Analysis
 * ═══════════════════════════════════════════════════════ */
describe('analyzeEnergy', () => {
  test('short messages have low energy', () => {
    const score = SCW.analyzeEnergy('ok', 'sure');
    expect(score).toBeLessThan(30);
  });
  test('long messages have higher energy', () => {
    const longMsg = 'This is a very detailed and comprehensive message with lots of words and content that demonstrates high energy and engagement in the conversation';
    const score = SCW.analyzeEnergy(longMsg, longMsg);
    expect(score).toBeGreaterThan(40);
  });
  test('exclamations boost energy', () => {
    const base = SCW.analyzeEnergy('that is good', 'yes it is');
    const excited = SCW.analyzeEnergy('that is good!!!', 'yes it is!!!');
    expect(excited).toBeGreaterThan(base);
  });
  test('code blocks boost energy', () => {
    const withCode = SCW.analyzeEnergy('show me code', 'Here:\n```js\nconsole.log("hi");\n```');
    const without = SCW.analyzeEnergy('show me code', 'Here: console.log("hi");');
    expect(withCode).toBeGreaterThanOrEqual(without);
  });
});

/* ═══════════════════════════════════════════════════════
 * 3. Warmth Analysis
 * ═══════════════════════════════════════════════════════ */
describe('analyzeWarmth', () => {
  test('polite messages have high warmth', () => {
    const score = SCW.analyzeWarmth('Thank you so much, this is awesome!', 'You are welcome! Happy to help.');
    expect(score).toBeGreaterThanOrEqual(70);
  });
  test('frustrated messages have low warmth', () => {
    const score = SCW.analyzeWarmth('This is wrong and broken, fix it', 'I apologize for the error.');
    expect(score).toBeLessThan(60);
  });
  test('greetings boost warmth', () => {
    const base = SCW.analyzeWarmth('sort this list', 'Here is the sorted list.');
    const greeting = SCW.analyzeWarmth('Hello, sort this list', 'Here is the sorted list.');
    expect(greeting).toBeGreaterThan(base);
  });
  test('terse AI response to long user msg penalizes warmth', () => {
    const score = SCW.analyzeWarmth('I have this really detailed complex problem that needs your help with multiple aspects of the system', 'no');
    expect(score).toBeLessThan(60);
  });
  test('neutral messages return baseline warmth', () => {
    const score = SCW.analyzeWarmth('compute 2+2', 'The result is 4.');
    expect(score).toBeGreaterThanOrEqual(50);
    expect(score).toBeLessThanOrEqual(75);
  });
});

/* ═══════════════════════════════════════════════════════
 * 4. Turbulence Analysis
 * ═══════════════════════════════════════════════════════ */
describe('analyzeTurbulence', () => {
  test('first message without prev has low turbulence', () => {
    const score = SCW.analyzeTurbulence('How do I sort arrays?', 'Use sort method.', null);
    expect(score).toBeLessThan(30);
  });
  test('topic shift increases turbulence', () => {
    const score = SCW.analyzeTurbulence('What is the weather like?', 'It is sunny.',
      'How do I write a recursive function in Python?');
    expect(score).toBeGreaterThan(20);
  });
  test('correction language increases turbulence', () => {
    const score = SCW.analyzeTurbulence("Actually, that's wrong, I meant something different", 'I see, let me correct that.', 'How do I sort?');
    expect(score).toBeGreaterThan(15);
  });
  test('confusion phrases increase turbulence', () => {
    const score = SCW.analyzeTurbulence("I don't understand, what do you mean?", 'Let me explain again.', 'What is recursion?');
    expect(score).toBeGreaterThan(20);
  });
  test('consistent topic has low turbulence', () => {
    const score = SCW.analyzeTurbulence('How do I sort arrays in JavaScript?', 'Use Array.sort().', 'How do I filter arrays in JavaScript?');
    expect(score).toBeLessThan(40);
  });
});

/* ═══════════════════════════════════════════════════════
 * 5. Pressure Analysis
 * ═══════════════════════════════════════════════════════ */
describe('analyzePressure', () => {
  test('casual messages have low pressure', () => {
    const score = SCW.analyzePressure('hey what is up', 'Not much, how can I help?');
    expect(score).toBeLessThan(40);
  });
  test('urgency words increase pressure', () => {
    const score = SCW.analyzePressure('This is urgent, I need this fixed asap before the deadline!', 'I will prioritize this immediately.');
    expect(score).toBeGreaterThan(40);
  });
  test('code blocks increase pressure', () => {
    const withCode = SCW.analyzePressure('fix this', 'Here:\n```python\ndef f():\n  pass\n```');
    const without = SCW.analyzePressure('fix this', 'Here: def f pass');
    expect(withCode).toBeGreaterThanOrEqual(without);
  });
  test('technical density increases pressure', () => {
    const score = SCW.analyzePressure(
      'Implement polymorphism with encapsulation using metaclasses',
      'You can use metaclasses with inheritance and encapsulation patterns for polymorphism.'
    );
    expect(score).toBeGreaterThan(25);
  });
});

/* ═══════════════════════════════════════════════════════
 * 6. Visibility Analysis
 * ═══════════════════════════════════════════════════════ */
describe('analyzeVisibility', () => {
  test('goal-oriented language boosts visibility', () => {
    const score = SCW.analyzeVisibility('I want to build a REST API that handles 1000 requests per second');
    expect(score).toBeGreaterThanOrEqual(65);
  });
  test('vague language reduces visibility', () => {
    const score = SCW.analyzeVisibility('maybe somehow fix whatever is wrong, not sure');
    expect(score).toBeLessThan(50);
  });
  test('specific values boost visibility', () => {
    const vague = SCW.analyzeVisibility('make it faster');
    const specific = SCW.analyzeVisibility('reduce latency to under 50 milliseconds for server.js');
    expect(specific).toBeGreaterThan(vague);
  });
  test('question words boost visibility slightly', () => {
    const base = SCW.analyzeVisibility('sort arrays');
    const question = SCW.analyzeVisibility('How do I sort arrays?');
    expect(question).toBeGreaterThanOrEqual(base);
  });
});

/* ═══════════════════════════════════════════════════════
 * 7. Composite Scoring
 * ═══════════════════════════════════════════════════════ */
describe('computeComposite', () => {
  test('all-high positive dims + low negative dims → high score', () => {
    const score = SCW.computeComposite({ clarity: 90, energy: 80, warmth: 85, turbulence: 10, pressure: 15, visibility: 90 });
    expect(score).toBeGreaterThanOrEqual(75);
  });
  test('all-low positive dims + high negative dims → low score', () => {
    const score = SCW.computeComposite({ clarity: 10, energy: 10, warmth: 10, turbulence: 90, pressure: 90, visibility: 10 });
    expect(score).toBeLessThan(25);
  });
  test('middle values → moderate score', () => {
    const score = SCW.computeComposite({ clarity: 50, energy: 50, warmth: 50, turbulence: 50, pressure: 50, visibility: 50 });
    expect(score).toBeGreaterThanOrEqual(35);
    expect(score).toBeLessThanOrEqual(65);
  });
  test('score is always 0-100', () => {
    const s1 = SCW.computeComposite({ clarity: 0, energy: 0, warmth: 0, turbulence: 100, pressure: 100, visibility: 0 });
    const s2 = SCW.computeComposite({ clarity: 100, energy: 100, warmth: 100, turbulence: 0, pressure: 0, visibility: 100 });
    expect(s1).toBeGreaterThanOrEqual(0);
    expect(s2).toBeLessThanOrEqual(100);
  });
});

/* ═══════════════════════════════════════════════════════
 * 8. Weather Classification
 * ═══════════════════════════════════════════════════════ */
describe('classifyWeather', () => {
  test('80+ is SUNNY', () => { expect(SCW.classifyWeather(80)).toBe('SUNNY'); });
  test('95 is SUNNY', () => { expect(SCW.classifyWeather(95)).toBe('SUNNY'); });
  test('60 is PARTLY_CLOUDY', () => { expect(SCW.classifyWeather(60)).toBe('PARTLY_CLOUDY'); });
  test('79 is PARTLY_CLOUDY', () => { expect(SCW.classifyWeather(79)).toBe('PARTLY_CLOUDY'); });
  test('40 is OVERCAST', () => { expect(SCW.classifyWeather(40)).toBe('OVERCAST'); });
  test('20 is RAINY', () => { expect(SCW.classifyWeather(20)).toBe('RAINY'); });
  test('10 is STORMY', () => { expect(SCW.classifyWeather(10)).toBe('STORMY'); });
  test('0 is STORMY', () => { expect(SCW.classifyWeather(0)).toBe('STORMY'); });
});

/* ═══════════════════════════════════════════════════════
 * 9. Phenomena Detection
 * ═══════════════════════════════════════════════════════ */
describe('detectPhenomena', () => {
  test('rainbow detected on score recovery ≥20', () => {
    const prevDims = { clarity: 20, energy: 20, warmth: 20, turbulence: 80, pressure: 80, visibility: 20 };
    const currDims = { clarity: 80, energy: 70, warmth: 75, turbulence: 20, pressure: 20, visibility: 80 };
    const phenomena = SCW.detectPhenomena(currDims, prevDims, []);
    const rainbow = phenomena.find(p => p.type.id === 'rainbow');
    expect(rainbow).toBeDefined();
  });

  test('cold front detected on warmth drop ≥25', () => {
    const prevDims = { clarity: 70, energy: 50, warmth: 80, turbulence: 20, pressure: 30, visibility: 70 };
    const currDims = { clarity: 70, energy: 50, warmth: 50, turbulence: 20, pressure: 30, visibility: 70 };
    const phenomena = SCW.detectPhenomena(currDims, prevDims, []);
    const coldFront = phenomena.find(p => p.type.id === 'coldFront');
    expect(coldFront).toBeDefined();
  });

  test('wind shift detected on turbulence spike ≥30', () => {
    const prevDims = { clarity: 70, energy: 50, warmth: 70, turbulence: 10, pressure: 30, visibility: 70 };
    const currDims = { clarity: 70, energy: 50, warmth: 70, turbulence: 50, pressure: 30, visibility: 70 };
    const phenomena = SCW.detectPhenomena(currDims, prevDims, []);
    const windShift = phenomena.find(p => p.type.id === 'windShift');
    expect(windShift).toBeDefined();
  });

  test('heat wave detected when 3 exchanges have energy > 70', () => {
    const exchanges = [
      { dimensions: { energy: 75 } },
      { dimensions: { energy: 80 } },
      { dimensions: { energy: 85 } }
    ];
    const dims = { clarity: 70, energy: 80, warmth: 70, turbulence: 20, pressure: 30, visibility: 70 };
    const phenomena = SCW.detectPhenomena(dims, null, exchanges);
    const heatWave = phenomena.find(p => p.type.id === 'heatWave');
    expect(heatWave).toBeDefined();
  });

  test('fog bank detected when 3 exchanges have visibility < 40', () => {
    const exchanges = [
      { dimensions: { visibility: 30 } },
      { dimensions: { visibility: 25 } },
      { dimensions: { visibility: 35 } }
    ];
    const dims = { clarity: 70, energy: 50, warmth: 70, turbulence: 20, pressure: 30, visibility: 30 };
    const phenomena = SCW.detectPhenomena(dims, null, exchanges);
    const fogBank = phenomena.find(p => p.type.id === 'fogBank');
    expect(fogBank).toBeDefined();
  });

  test('no phenomena on stable conversation', () => {
    const prevDims = { clarity: 70, energy: 50, warmth: 70, turbulence: 20, pressure: 30, visibility: 70 };
    const currDims = { clarity: 72, energy: 52, warmth: 68, turbulence: 22, pressure: 28, visibility: 72 };
    const phenomena = SCW.detectPhenomena(currDims, prevDims, []);
    expect(phenomena.length).toBe(0);
  });
});

describe('detectLightning', () => {
  test('breakthrough words trigger lightning', () => {
    expect(SCW.detectLightning('I solved it!', 'Great job!')).toBe(true);
    expect(SCW.detectLightning('eureka', 'You found it!')).toBe(true);
  });
  test('normal messages do not trigger lightning', () => {
    expect(SCW.detectLightning('How do I sort?', 'Use sort method.')).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════
 * 10. Full Exchange Analysis
 * ═══════════════════════════════════════════════════════ */
describe('analyzeExchange', () => {
  test('returns all expected fields', () => {
    const result = SCW.analyzeExchange('How do I sort?', 'Use Array.sort().', null, null);
    expect(result).toHaveProperty('dimensions');
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('weather');
    expect(result).toHaveProperty('phenomena');
    expect(result).toHaveProperty('ts');
    expect(result.dimensions).toHaveProperty('clarity');
    expect(result.dimensions).toHaveProperty('energy');
    expect(result.dimensions).toHaveProperty('warmth');
    expect(result.dimensions).toHaveProperty('turbulence');
    expect(result.dimensions).toHaveProperty('pressure');
    expect(result.dimensions).toHaveProperty('visibility');
  });
  test('weather classification matches score', () => {
    const result = SCW.analyzeExchange('Thanks for the help!', 'You are welcome! Happy to assist.', null, null);
    expect(SCW.classifyWeather(result.score)).toBe(result.weather);
  });
});

/* ═══════════════════════════════════════════════════════
 * 11. Insights Generation
 * ═══════════════════════════════════════════════════════ */
describe('generateInsights', () => {
  test('returns array', () => {
    const insights = SCW.generateInsights();
    expect(Array.isArray(insights)).toBe(true);
  });
  test('each insight has id, icon, text, priority', () => {
    // Force low clarity state
    const state = SCW.getState();
    // Insights depend on current state — just validate shape
    const insights = SCW.generateInsights();
    if (insights.length > 0) {
      expect(insights[0]).toHaveProperty('id');
      expect(insights[0]).toHaveProperty('icon');
      expect(insights[0]).toHaveProperty('text');
      expect(insights[0]).toHaveProperty('priority');
    }
  });
});

/* ═══════════════════════════════════════════════════════
 * 12. State and Config
 * ═══════════════════════════════════════════════════════ */
describe('state and config', () => {
  test('getState returns state object', () => {
    const state = SCW.getState();
    expect(state).toHaveProperty('exchanges');
    expect(state).toHaveProperty('phenomena');
    expect(state).toHaveProperty('currentWeather');
    expect(state).toHaveProperty('currentScore');
    expect(state).toHaveProperty('dimensions');
    expect(state).toHaveProperty('history');
  });
  test('getConfig returns config object', () => {
    const config = SCW.getConfig();
    expect(config).toHaveProperty('enabled');
    expect(config).toHaveProperty('toastAlerts');
    expect(config).toHaveProperty('phenomenaDetection');
    expect(config).toHaveProperty('forecastWarnings');
  });
  test('getScore returns a number', () => {
    expect(typeof SCW.getScore()).toBe('number');
  });
  test('getWeather returns a string', () => {
    expect(typeof SCW.getWeather()).toBe('string');
  });
  test('getDimensions returns all 6 dims', () => {
    const dims = SCW.getDimensions();
    expect(Object.keys(dims).length).toBe(6);
  });
  test('setEnabled toggles config', () => {
    SCW.setEnabled(false);
    expect(SCW.isEnabled()).toBe(false);
    SCW.setEnabled(true);
    expect(SCW.isEnabled()).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════
 * 13. Utility Functions
 * ═══════════════════════════════════════════════════════ */
describe('utility functions', () => {
  test('_tokenize splits and lowercases', () => {
    const tokens = SCW._tokenize('Hello World Test');
    expect(tokens).toEqual(['hello', 'world', 'test']);
  });
  test('_tokenize handles empty string', () => {
    expect(SCW._tokenize('')).toEqual([]);
  });
  test('_wordCount counts words', () => {
    expect(SCW._wordCount('one two three')).toBe(3);
  });
  test('_sentences splits on punctuation', () => {
    const s = SCW._sentences('Hello. How are you? Fine!');
    expect(s.length).toBe(3);
  });
  test('_sparkline returns string', () => {
    const s = SCW._sparkline([10, 50, 90, 30, 70]);
    expect(typeof s).toBe('string');
    expect(s.length).toBe(5);
  });
  test('_sparkline handles empty array', () => {
    expect(SCW._sparkline([])).toBe('—');
  });
});

/* ═══════════════════════════════════════════════════════
 * 14. Constants Exposure
 * ═══════════════════════════════════════════════════════ */
describe('constants', () => {
  test('WEATHER_TYPES has 5 types', () => {
    expect(Object.keys(SCW.WEATHER_TYPES).length).toBe(5);
  });
  test('DIMS has 6 dimensions', () => {
    expect(Object.keys(SCW.DIMS).length).toBe(6);
  });
  test('DIM_META has weights summing to 1', () => {
    let sum = 0;
    Object.keys(SCW.DIMS).forEach(k => { sum += SCW.DIM_META[SCW.DIMS[k]].weight; });
    expect(Math.abs(sum - 1)).toBeLessThan(0.01);
  });
  test('PHENOMENA has 6 types', () => {
    expect(Object.keys(SCW.PHENOMENA).length).toBe(6);
  });
});
