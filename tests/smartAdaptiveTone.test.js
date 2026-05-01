/**
 * SmartAdaptiveTone — autonomous communication style profiler tests
 */

/* ── minimal stubs ── */
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="chat-output"></div><div class="toolbar"></div></body></html>');
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

/* Load module */
const fs = require('fs');
const path = require('path');
const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// Extract SmartAdaptiveTone module
const moduleStart = appCode.lastIndexOf('const SmartAdaptiveTone');
const moduleCode = appCode.slice(moduleStart).replace('const SmartAdaptiveTone', 'global.SmartAdaptiveTone');
eval(moduleCode);

describe('SmartAdaptiveTone', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('analyzeMessage', () => {
    test('returns null for empty or very short text', () => {
      expect(SmartAdaptiveTone.analyzeMessage('')).toBeNull();
      expect(SmartAdaptiveTone.analyzeMessage('hi')).toBeNull();
    });

    test('returns scores object for valid text', () => {
      const result = SmartAdaptiveTone.analyzeMessage('Please help me understand how this API endpoint works');
      expect(result).not.toBeNull();
      expect(result.formality).toBeGreaterThanOrEqual(0);
      expect(result.formality).toBeLessThanOrEqual(1);
      expect(result.verbosity).toBeGreaterThanOrEqual(0);
      expect(result.technicality).toBeGreaterThanOrEqual(0);
      expect(result.emotionality).toBeGreaterThanOrEqual(0);
      expect(result.directness).toBeGreaterThanOrEqual(0);
      expect(result.politeness).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeDefined();
      expect(result.wordCount).toBeGreaterThan(0);
    });

    test('detects high formality in academic text', () => {
      const result = SmartAdaptiveTone.analyzeMessage('Furthermore, the aforementioned methodology pertaining to the analysis consequently yields substantial results');
      expect(result.formality).toBeGreaterThan(0.6);
    });

    test('detects low formality in casual text', () => {
      const result = SmartAdaptiveTone.analyzeMessage("hey dude gonna wanna get some code done lol btw it's kinda broken");
      expect(result.formality).toBeLessThan(0.4);
    });

    test('detects high technicality', () => {
      const result = SmartAdaptiveTone.analyzeMessage('The async callback function handles the API endpoint response with proper middleware and caching');
      expect(result.technicality).toBeGreaterThan(0.4);
    });

    test('detects high emotionality', () => {
      const result = SmartAdaptiveTone.analyzeMessage('I absolutely LOVE this amazing feature!! So excited and thrilled about it!!!');
      expect(result.emotionality).toBeGreaterThan(0.4);
    });

    test('detects high directness', () => {
      const result = SmartAdaptiveTone.analyzeMessage('Fix the bug now. Show me the error. Just do it.');
      expect(result.directness).toBeGreaterThan(0.5);
    });

    test('detects high politeness', () => {
      const result = SmartAdaptiveTone.analyzeMessage('Hello, could you please kindly help me? I would appreciate it very much, thank you');
      expect(result.politeness).toBeGreaterThan(0.5);
    });

    test('detects low verbosity for short messages', () => {
      const result = SmartAdaptiveTone.analyzeMessage('Fix this bug');
      expect(result.verbosity).toBeLessThan(0.4);
    });

    test('detects high verbosity for long messages', () => {
      const longMsg = 'I have been working on this project for quite some time now and I have encountered a rather peculiar issue that I would like to discuss with you in detail because I think it might be related to the way we handle the database connections and the caching layer that sits between the API and the frontend application which is a really complex system with many moving parts';
      const result = SmartAdaptiveTone.analyzeMessage(longMsg);
      expect(result.verbosity).toBeGreaterThan(0.6);
    });
  });

  describe('classifyArchetype', () => {
    test('classifies academic profile', () => {
      const profile = { formality: 0.85, verbosity: 0.75, technicality: 0.7, emotionality: 0.15, directness: 0.4, politeness: 0.6 };
      const result = SmartAdaptiveTone.classifyArchetype(profile);
      expect(result.archetype.name).toBe('Academic');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    test('classifies casual profile', () => {
      const profile = { formality: 0.2, verbosity: 0.4, technicality: 0.3, emotionality: 0.6, directness: 0.7, politeness: 0.4 };
      const result = SmartAdaptiveTone.classifyArchetype(profile);
      expect(result.archetype.name).toBe('Casual');
    });

    test('classifies technical profile', () => {
      const profile = { formality: 0.6, verbosity: 0.5, technicality: 0.9, emotionality: 0.1, directness: 0.8, politeness: 0.3 };
      const result = SmartAdaptiveTone.classifyArchetype(profile);
      expect(result.archetype.name).toBe('Technical');
    });

    test('classifies executive profile', () => {
      const profile = { formality: 0.7, verbosity: 0.2, technicality: 0.4, emotionality: 0.2, directness: 0.9, politeness: 0.5 };
      const result = SmartAdaptiveTone.classifyArchetype(profile);
      expect(result.archetype.name).toBe('Executive');
    });

    test('classifies friendly profile', () => {
      const profile = { formality: 0.3, verbosity: 0.6, technicality: 0.2, emotionality: 0.7, directness: 0.5, politeness: 0.8 };
      const result = SmartAdaptiveTone.classifyArchetype(profile);
      expect(result.archetype.name).toBe('Friendly');
    });

    test('returns confidence score', () => {
      const profile = { formality: 0.5, verbosity: 0.5, technicality: 0.5, emotionality: 0.5, directness: 0.5, politeness: 0.5 };
      const result = SmartAdaptiveTone.classifyArchetype(profile);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('updateProfile', () => {
    test('updates profile with exponential decay', () => {
      const initialProfile = SmartAdaptiveTone.getProfile();
      const scores = { formality: 0.9, verbosity: 0.9, technicality: 0.9, emotionality: 0.9, directness: 0.9, politeness: 0.9, timestamp: Date.now(), wordCount: 50 };
      SmartAdaptiveTone.updateProfile(scores);
      const updatedProfile = SmartAdaptiveTone.getProfile();
      expect(updatedProfile.formality).toBeGreaterThan(initialProfile.formality);
      expect(updatedProfile.formality).toBeLessThan(0.9);
    });

    test('increments message count', () => {
      const before = SmartAdaptiveTone.getState().messageCount;
      SmartAdaptiveTone.updateProfile({ formality: 0.5, verbosity: 0.5, technicality: 0.5, emotionality: 0.5, directness: 0.5, politeness: 0.5, timestamp: Date.now(), wordCount: 10 });
      expect(SmartAdaptiveTone.getState().messageCount).toBe(before + 1);
    });

    test('adds to history', () => {
      const scores = { formality: 0.7, verbosity: 0.3, technicality: 0.8, emotionality: 0.2, directness: 0.6, politeness: 0.4, timestamp: Date.now(), wordCount: 20 };
      SmartAdaptiveTone.updateProfile(scores);
      const state = SmartAdaptiveTone.getState();
      expect(state.history.length).toBeGreaterThan(0);
    });

    test('ignores null scores', () => {
      const before = SmartAdaptiveTone.getState().messageCount;
      SmartAdaptiveTone.updateProfile(null);
      expect(SmartAdaptiveTone.getState().messageCount).toBe(before);
    });
  });

  describe('detectShift', () => {
    test('returns null when insufficient messages', () => {
      const scores = { formality: 0.9, verbosity: 0.1, technicality: 0.5, emotionality: 0.5, directness: 0.5, politeness: 0.5, timestamp: Date.now() };
      const result = SmartAdaptiveTone.detectShift(scores);
      expect(result).toBeNull();
    });

    test('detects shift after sufficient messages', () => {
      for (let i = 0; i < 6; i++) {
        SmartAdaptiveTone.updateProfile({ formality: 0.3, verbosity: 0.5, technicality: 0.5, emotionality: 0.5, directness: 0.5, politeness: 0.5, timestamp: Date.now(), wordCount: 20 });
      }
      const shift = SmartAdaptiveTone.detectShift({ formality: 0.95, verbosity: 0.5, technicality: 0.5, emotionality: 0.5, directness: 0.5, politeness: 0.5 });
      expect(shift).not.toBeNull();
      expect(shift.shifts.length).toBeGreaterThan(0);
      expect(shift.shifts[0].dimension).toBe('formality');
      expect(shift.shifts[0].direction).toBe('increased');
    });
  });

  describe('generateRecommendations', () => {
    test('generates recommendations for formal profile', () => {
      const recs = SmartAdaptiveTone.generateRecommendations({ formality: 0.85, verbosity: 0.5, technicality: 0.5, emotionality: 0.5, directness: 0.5, politeness: 0.5 });
      expect(recs.length).toBeGreaterThan(0);
      expect(recs[0].text).toContain('formal');
    });

    test('generates recommendations for casual profile', () => {
      const recs = SmartAdaptiveTone.generateRecommendations({ formality: 0.15, verbosity: 0.5, technicality: 0.5, emotionality: 0.5, directness: 0.5, politeness: 0.5 });
      expect(recs.length).toBeGreaterThan(0);
      expect(recs[0].text).toContain('casual');
    });

    test('generates length recommendation for verbose users', () => {
      const recs = SmartAdaptiveTone.generateRecommendations({ formality: 0.5, verbosity: 0.85, technicality: 0.5, emotionality: 0.5, directness: 0.5, politeness: 0.5 });
      const lengthRec = recs.find(r => r.type === 'length');
      expect(lengthRec).toBeDefined();
      expect(lengthRec.text).toContain('detailed');
    });

    test('generates brevity recommendation for concise users', () => {
      const recs = SmartAdaptiveTone.generateRecommendations({ formality: 0.5, verbosity: 0.15, technicality: 0.5, emotionality: 0.5, directness: 0.5, politeness: 0.5 });
      const lengthRec = recs.find(r => r.type === 'length');
      expect(lengthRec).toBeDefined();
      expect(lengthRec.text).toContain('brief');
    });

    test('generates tech recommendation for technical users', () => {
      const recs = SmartAdaptiveTone.generateRecommendations({ formality: 0.5, verbosity: 0.5, technicality: 0.85, emotionality: 0.5, directness: 0.5, politeness: 0.5 });
      const techRec = recs.find(r => r.type === 'content');
      expect(techRec).toBeDefined();
      expect(techRec.text).toContain('jargon');
    });

    test('generates simplicity recommendation for non-technical users', () => {
      const recs = SmartAdaptiveTone.generateRecommendations({ formality: 0.5, verbosity: 0.5, technicality: 0.15, emotionality: 0.5, directness: 0.5, politeness: 0.5 });
      const techRec = recs.find(r => r.type === 'content');
      expect(techRec).toBeDefined();
      expect(techRec.text).toContain('simply');
    });

    test('generates directness recommendation', () => {
      const recs = SmartAdaptiveTone.generateRecommendations({ formality: 0.5, verbosity: 0.5, technicality: 0.5, emotionality: 0.5, directness: 0.85, politeness: 0.5 });
      const structRec = recs.find(r => r.type === 'structure');
      expect(structRec).toBeDefined();
      expect(structRec.text).toContain('lead with answers');
    });
  });

  describe('getAlignmentScore', () => {
    test('returns null for empty text', () => {
      const result = SmartAdaptiveTone.getAlignmentScore('');
      expect(result).toBeNull();
    });

    test('computes alignment after profile built', () => {
      for (let i = 0; i < 5; i++) {
        SmartAdaptiveTone.updateProfile({ formality: 0.7, verbosity: 0.6, technicality: 0.8, emotionality: 0.2, directness: 0.6, politeness: 0.4, timestamp: Date.now(), wordCount: 30 });
      }
      const result = SmartAdaptiveTone.getAlignmentScore('The algorithm processes the API endpoint asynchronously through the middleware pipeline');
      expect(result).not.toBeNull();
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
      expect(result.label).toBeDefined();
    });
  });

  describe('getTrend', () => {
    test('returns trend object with slope', () => {
      const result = SmartAdaptiveTone.getTrend('formality');
      expect(result).toHaveProperty('trend');
      expect(result).toHaveProperty('slope');
    });

    test('detects increasing trend', () => {
      for (let i = 0; i < 10; i++) {
        SmartAdaptiveTone.updateProfile({ formality: 0.3 + i * 0.06, verbosity: 0.5, technicality: 0.5, emotionality: 0.5, directness: 0.5, politeness: 0.5, timestamp: Date.now() + i * 1000, wordCount: 20 });
      }
      const result = SmartAdaptiveTone.getTrend('formality');
      expect(result.trend).toBe('increasing');
      expect(result.slope).toBeGreaterThan(0);
    });
  });

  describe('generateInsights', () => {
    test('returns info message with insufficient data', () => {
      localStorage.clear();
      const insights = SmartAdaptiveTone.generateInsights();
      expect(insights.length).toBeGreaterThan(0);
    });

    test('includes archetype insight after enough messages', () => {
      for (let i = 0; i < 8; i++) {
        SmartAdaptiveTone.updateProfile({ formality: 0.8, verbosity: 0.7, technicality: 0.7, emotionality: 0.15, directness: 0.4, politeness: 0.6, timestamp: Date.now(), wordCount: 40 });
      }
      const insights = SmartAdaptiveTone.generateInsights();
      const archetypeInsight = insights.find(i => i.type === 'archetype');
      expect(archetypeInsight).toBeDefined();
      expect(archetypeInsight.text).toMatch(/Academic|Mentor/);
    });
  });

  describe('getProfileSummary', () => {
    test('returns complete summary object', () => {
      const summary = SmartAdaptiveTone.getProfileSummary();
      expect(summary.profile).toBeDefined();
      expect(summary.archetype).toBeDefined();
      expect(summary.messageCount).toBeDefined();
      expect(summary.recentShifts).toBeDefined();
      expect(summary.recommendations).toBeDefined();
    });
  });

  describe('configuration', () => {
    test('can enable/disable', () => {
      SmartAdaptiveTone.setEnabled(false);
      expect(SmartAdaptiveTone.isEnabled()).toBe(false);
      SmartAdaptiveTone.setEnabled(true);
      expect(SmartAdaptiveTone.isEnabled()).toBe(true);
    });
  });

  describe('DIMENSIONS constant', () => {
    test('has all 6 dimensions', () => {
      expect(Object.keys(SmartAdaptiveTone.DIMENSIONS).length).toBe(6);
      expect(SmartAdaptiveTone.DIMENSIONS.FORMALITY).toBe('formality');
      expect(SmartAdaptiveTone.DIMENSIONS.VERBOSITY).toBe('verbosity');
      expect(SmartAdaptiveTone.DIMENSIONS.TECHNICALITY).toBe('technicality');
      expect(SmartAdaptiveTone.DIMENSIONS.EMOTIONALITY).toBe('emotionality');
      expect(SmartAdaptiveTone.DIMENSIONS.DIRECTNESS).toBe('directness');
      expect(SmartAdaptiveTone.DIMENSIONS.POLITENESS).toBe('politeness');
    });
  });

  describe('ARCHETYPES constant', () => {
    test('has 6 archetypes with required fields', () => {
      const archetypes = SmartAdaptiveTone.ARCHETYPES;
      expect(Object.keys(archetypes).length).toBe(6);
      Object.values(archetypes).forEach(arch => {
        expect(arch.name).toBeDefined();
        expect(arch.emoji).toBeDefined();
        expect(arch.formality).toBeGreaterThanOrEqual(0);
        expect(arch.formality).toBeLessThanOrEqual(1);
      });
    });
  });
});
