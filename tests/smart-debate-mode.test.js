/**
 * SmartDebateMode — Test Suite
 * 55 tests covering all 7 engines: Claim Detector, Bias Spotter,
 * Counter-Argument Generator, Perspective Multiplier, Steel Man Builder,
 * Debate Health Scorer, Insight Generator, plus state/config/UI.
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
  const marker = '* SmartDebateMode';
  // Find the full comment block start
  const markerFull = '/* ============================================================';
  let idx = src.lastIndexOf(marker);
  if (idx === -1) throw new Error('SmartDebateMode not found in app.js');
  // Walk back to find the comment block start
  const blockStart = src.lastIndexOf(markerFull, idx);
  if (blockStart !== -1) idx = blockStart;
  const moduleCode = src.slice(idx);
  const fn = new Function('SafeStorage', 'document', 'MutationObserver', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'navigator',
    moduleCode + '\nreturn SmartDebateMode;');
  const mod = fn(global.SafeStorage, document, global.MutationObserver, global.setTimeout, global.clearTimeout, global.requestAnimationFrame, global.navigator);
  return { mod, dom, document, _store };
}

let SDM, dom, doc, store;

beforeEach(() => {
  const env = bootModule();
  SDM = env.mod;
  dom = env.dom;
  doc = env.document;
  store = env._store;
});

/* ── Engine 1: Claim Detector ── */
describe('detectClaims', () => {
  test('detects strong claims with "definitely"', () => {
    const r = SDM.detectClaims('This is definitely the right approach.');
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].category).toBe('strong');
  });

  test('detects strong claims with "only way"', () => {
    const r = SDM.detectClaims('The only way to solve this is with recursion.');
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].markers).toEqual(expect.arrayContaining([expect.stringMatching(/only way/i)]));
  });

  test('detects comparative claims', () => {
    const r = SDM.detectClaims('Python is better than Java for scripting.');
    expect(r.length).toBeGreaterThan(0);
    expect(r.some(c => c.category === 'comparative')).toBe(true);
  });

  test('detects prescriptive claims with "should"', () => {
    const r = SDM.detectClaims('You should always write tests before code.');
    expect(r.length).toBeGreaterThan(0);
    expect(r.some(c => c.category === 'prescriptive')).toBe(true);
  });

  test('detects predictive claims', () => {
    const r = SDM.detectClaims('AI will lead to mass unemployment, mark my words.');
    expect(r.length).toBeGreaterThan(0);
    expect(r.some(c => c.category === 'predictive')).toBe(true);
  });

  test('detects evaluative claims', () => {
    const r = SDM.detectClaims('The new framework is absolutely terrible.');
    expect(r.length).toBeGreaterThan(0);
    expect(r.some(c => c.category === 'evaluative' || c.category === 'strong')).toBe(true);
  });

  test('returns empty for neutral text', () => {
    const r = SDM.detectClaims('The function returns an integer.');
    expect(r.length).toBe(0);
  });

  test('returns empty for null/empty', () => {
    expect(SDM.detectClaims(null)).toEqual([]);
    expect(SDM.detectClaims('')).toEqual([]);
  });

  test('includes counter-argument for each claim', () => {
    const r = SDM.detectClaims('This is definitely the best solution.');
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].counterArgument).toBeTruthy();
    expect(typeof r[0].counterArgument).toBe('string');
  });

  test('assigns role to detected claims', () => {
    const r = SDM.detectClaims('Definitely the right choice.', 'user');
    expect(r[0].role).toBe('user');
  });

  test('claims have unique ids', () => {
    const r = SDM.detectClaims('Definitely the best and absolutely guaranteed to work.');
    const ids = r.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/* ── Engine 2: Bias Spotter ── */
describe('detectBiases', () => {
  test('detects confirmation bias', () => {
    const r = SDM.detectBiases('See? I was right all along. This confirms my theory.');
    expect(r.length).toBeGreaterThan(0);
    expect(r.some(b => b.biasType === 'confirmation')).toBe(true);
  });

  test('detects anchoring bias', () => {
    const r = SDM.detectBiases('My first impression was that this is wrong, and I still think so.');
    expect(r.length).toBeGreaterThan(0);
    expect(r.some(b => b.biasType === 'anchoring')).toBe(true);
  });

  test('detects recency bias', () => {
    const r = SDM.detectBiases('I just saw an article yesterday that proves this point.');
    expect(r.length).toBeGreaterThan(0);
    expect(r.some(b => b.biasType === 'recency')).toBe(true);
  });

  test('detects survivorship bias', () => {
    const r = SDM.detectBiases('Successful companies all use this approach.');
    expect(r.length).toBeGreaterThan(0);
    expect(r.some(b => b.biasType === 'survivorship')).toBe(true);
  });

  test('detects appeal to authority', () => {
    const r = SDM.detectBiases('According to experts, this is the way forward. Studies show improvement.');
    expect(r.length).toBeGreaterThan(0);
    expect(r.some(b => b.biasType === 'authority')).toBe(true);
  });

  test('detects hasty generalization', () => {
    const r = SDM.detectBiases('Everyone knows this is true. People always do it this way.');
    expect(r.length).toBeGreaterThan(0);
    expect(r.some(b => b.biasType === 'hasty_gen')).toBe(true);
  });

  test('detects sunk cost', () => {
    const r = SDM.detectBiases('We have already invested too much. We can\'t stop now.');
    expect(r.length).toBeGreaterThan(0);
    expect(r.some(b => b.biasType === 'sunk_cost')).toBe(true);
  });

  test('includes antidote for each bias', () => {
    const r = SDM.detectBiases('See? I was right about this.');
    if (r.length > 0) {
      expect(r[0].antidote).toBeTruthy();
    }
  });

  test('returns empty for bias-free text', () => {
    const r = SDM.detectBiases('The function accepts two parameters and returns a boolean.');
    expect(r.length).toBe(0);
  });
});

/* ── Engine 3: Counter-Argument Generator ── */
describe('generateCounterArguments', () => {
  test('generates counter-arguments for claims', () => {
    const claims = SDM.detectClaims('This is definitely the best approach.');
    const counters = SDM.generateCounterArguments(claims);
    expect(counters.length).toBe(claims.length);
    expect(counters[0].counterArguments.length).toBeGreaterThan(0);
  });

  test('returns empty for empty claims', () => {
    expect(SDM.generateCounterArguments([])).toEqual([]);
    expect(SDM.generateCounterArguments(null)).toEqual([]);
  });

  test('includes claim reference', () => {
    const claims = SDM.detectClaims('Absolutely the only way.');
    const counters = SDM.generateCounterArguments(claims);
    expect(counters[0].claimId).toBe(claims[0].id);
    expect(counters[0].claimText).toBe(claims[0].text);
  });

  test('classifies counter strength', () => {
    const claims = SDM.detectClaims('Definitely the best. Without a doubt correct.');
    const counters = SDM.generateCounterArguments(claims);
    counters.forEach(c => {
      expect(['strong', 'moderate']).toContain(c.strength);
    });
  });
});

/* ── Engine 4: Perspective Multiplier ── */
describe('suggestPerspectives', () => {
  test('returns perspectives for any text', () => {
    const p = SDM.suggestPerspectives('We should adopt microservices architecture.');
    expect(p.length).toBe(5); // one per perspective type
  });

  test('includes all 5 perspective types', () => {
    const p = SDM.suggestPerspectives('Let us move to the cloud.');
    const types = p.map(x => x.type);
    expect(types).toContain('stakeholder');
    expect(types).toContain('temporal');
    expect(types).toContain('scale');
    expect(types).toContain('cultural');
    expect(types).toContain('contrarian');
  });

  test('returns empty for null', () => {
    expect(SDM.suggestPerspectives(null)).toEqual([]);
    expect(SDM.suggestPerspectives('')).toEqual([]);
  });

  test('perspectives have suggestions', () => {
    const p = SDM.suggestPerspectives('We need to restructure.');
    p.forEach(x => {
      expect(x.suggestion).toBeTruthy();
      expect(typeof x.suggestion).toBe('string');
    });
  });
});

/* ── Engine 5: Steel Man Builder ── */
describe('buildSteelMan', () => {
  test('builds steel man for a claim', () => {
    const claims = SDM.detectClaims('This is definitely wrong.');
    if (claims.length > 0) {
      const sm = SDM.buildSteelMan(claims[0]);
      expect(sm).not.toBeNull();
      expect(sm.claimId).toBe(claims[0].id);
      expect(sm.steelManPrompt).toBeTruthy();
    }
  });

  test('returns null for null input', () => {
    expect(SDM.buildSteelMan(null)).toBeNull();
  });

  test('includes claim text reference', () => {
    const claim = { id: 'test1', text: 'Everything is perfect', category: 'evaluative' };
    const sm = SDM.buildSteelMan(claim);
    expect(sm.claimText).toBe('Everything is perfect');
  });
});

/* ── Engine 6: Debate Health Scorer ── */
describe('computeScore / classifyTier', () => {
  test('starts at 100', () => {
    expect(SDM.getScore()).toBe(100);
  });

  test('score decreases with many unchallenged claims', () => {
    for (let i = 0; i < 10; i++) {
      SDM.analyzeMessage('This is definitely the best and absolutely guaranteed. The only way.', 'user');
    }
    expect(SDM.getScore()).toBeLessThan(100);
  });

  test('score decreases with biases', () => {
    SDM.analyzeMessage('See? I was right. Just as I expected. Confirms my theory.');
    expect(SDM.getScore()).toBeLessThan(100);
  });

  test('classifyTier returns DIALECTICAL for 90+', () => {
    const tier = SDM.classifyTier(95);
    expect(tier.name).toBe('Dialectical');
  });

  test('classifyTier returns BALANCED for 70-89', () => {
    const tier = SDM.classifyTier(75);
    expect(tier.name).toBe('Balanced');
  });

  test('classifyTier returns ONE_SIDED for 50-69', () => {
    const tier = SDM.classifyTier(55);
    expect(tier.name).toBe('One-Sided');
  });

  test('classifyTier returns ECHO_CHAMBER for <50', () => {
    const tier = SDM.classifyTier(30);
    expect(tier.name).toBe('Echo Chamber');
  });

  test('challenging claims improves score', () => {
    SDM.analyzeMessage('Definitely the only way. Absolutely guaranteed.');
    const scoreBefore = SDM.getScore();
    const claims = SDM.getClaims();
    if (claims.length > 0) {
      SDM.challengeClaim(claims[0].id);
      expect(SDM.getScore()).toBeGreaterThanOrEqual(scoreBefore);
    }
  });
});

/* ── Engine 7: Insight Generator ── */
describe('generateInsights', () => {
  test('generates insight for many unchallenged claims', () => {
    // Pump in 5+ claims to trigger insight
    for (let i = 0; i < 6; i++) {
      SDM.analyzeMessage('This is definitely the best approach number ' + i + '.');
    }
    const insights = SDM.generateInsights();
    expect(insights.some(i => i.type === 'unchallenged_claims')).toBe(true);
  });

  test('generates low score insight when score is very low', () => {
    // Pump many claims + biases to drive score down
    for (let i = 0; i < 15; i++) {
      SDM.analyzeMessage('Definitely the only way. See I was right. Everyone knows. Already invested too much.');
    }
    const insights = SDM.generateInsights();
    expect(insights.some(i => i.type === 'low_score')).toBe(true);
  });

  test('no insights on clean state', () => {
    const insights = SDM.generateInsights();
    expect(insights.length).toBe(0);
  });
});

/* ── analyzeMessage integration ── */
describe('analyzeMessage', () => {
  test('returns claims, biases, perspectives', () => {
    const result = SDM.analyzeMessage('This is definitely better than everything. See I was right.', 'user');
    expect(result.claims.length).toBeGreaterThan(0);
    expect(result.biases.length).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.perspectives)).toBe(true);
  });

  test('updates state after analysis', () => {
    SDM.analyzeMessage('Absolutely the best choice.', 'user');
    expect(SDM.getState().totalClaimsDetected).toBeGreaterThan(0);
    expect(SDM.getState().exchanges.length).toBe(1);
  });

  test('skips when disabled', () => {
    SDM.setEnabled(false);
    const result = SDM.analyzeMessage('Definitely the best.');
    expect(result.claims.length).toBe(0);
    SDM.setEnabled(true);
  });

  test('returns empty for null text', () => {
    const result = SDM.analyzeMessage(null, 'user');
    expect(result.claims).toEqual([]);
  });
});

/* ── State Management ── */
describe('state management', () => {
  test('reset clears all state', () => {
    SDM.analyzeMessage('Definitely the best. See I was right.');
    SDM.reset();
    const state = SDM.getState();
    expect(state.claims).toEqual([]);
    expect(state.biases).toEqual([]);
    expect(state.totalClaimsDetected).toBe(0);
    expect(state.currentScore).toBe(100);
  });

  test('getState returns deep copy', () => {
    const s1 = SDM.getState();
    s1.claims.push({ fake: true });
    expect(SDM.getState().claims.length).toBe(0);
  });

  test('getClaims returns copy', () => {
    SDM.analyzeMessage('Definitely the best.');
    const c = SDM.getClaims();
    const len = c.length;
    c.push({ fake: true });
    expect(SDM.getClaims().length).toBe(len);
  });
});

/* ── Config ── */
describe('config', () => {
  test('default sensitivity is medium', () => {
    expect(SDM.getConfig().sensitivity).toBe('medium');
  });

  test('setSensitivity changes config', () => {
    SDM.setSensitivity('high');
    expect(SDM.getConfig().sensitivity).toBe('high');
  });

  test('setEnabled toggles', () => {
    SDM.setEnabled(false);
    expect(SDM.isEnabled()).toBe(false);
    SDM.setEnabled(true);
    expect(SDM.isEnabled()).toBe(true);
  });
});

/* ── Constants exposed ── */
describe('constants', () => {
  test('CLAIM_CATEGORIES has 5 categories', () => {
    expect(Object.keys(SDM.CLAIM_CATEGORIES).length).toBe(5);
  });

  test('BIAS_CATEGORIES has 7 categories', () => {
    expect(Object.keys(SDM.BIAS_CATEGORIES).length).toBe(7);
  });

  test('PERSPECTIVE_TYPES has 5 types', () => {
    expect(Object.keys(SDM.PERSPECTIVE_TYPES).length).toBe(5);
  });

  test('TIERS has 4 tiers', () => {
    expect(Object.keys(SDM.TIERS).length).toBe(4);
  });

  test('SENSITIVITIES has 3 levels', () => {
    expect(Object.keys(SDM.SENSITIVITIES).length).toBe(3);
  });
});

/* ── UI ── */
describe('UI', () => {
  test('toggle shows and hides panel', () => {
    SDM.show();
    const panel = doc.getElementById('smart-debate-mode-panel');
    expect(panel).not.toBeNull();
    expect(panel.style.display).toBe('block');
    SDM.hide();
    expect(panel.style.display).toBe('none');
  });

  test('badge is created on init', () => {
    const badge = doc.getElementById('smart-debate-mode-badge');
    expect(badge).not.toBeNull();
  });
});
