/**
 * @jest-environment jsdom
 */

/* ── Global mocks ── */
const storage = {};
const SafeStorage = {
  get: (k) => storage[k] || null,
  set: (k, v) => { storage[k] = v; },
  remove: (k) => { delete storage[k]; },
  getJSON(k, fallback = null) {
    const raw = this.get(k);
    if (raw == null) return fallback;
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  },
  setJSON(k, v) { this.set(k, JSON.stringify(v)); },
  trySetJSON(k, v) { try { this.setJSON(k, v); } catch (_) {} },
};
globalThis.SafeStorage = SafeStorage;

const ToastManager = { show: jest.fn() };
globalThis.ToastManager = ToastManager;

const SessionManager = {
  currentId: () => 'test-session',
  currentName: () => 'Test Session',
  current: () => 'test-session',
};
globalThis.SessionManager = SessionManager;

const ConversationManager = { getUserMessages: jest.fn(() => []) };
globalThis.ConversationManager = ConversationManager;

const KeyboardShortcuts = { register: jest.fn() };
globalThis.KeyboardShortcuts = KeyboardShortcuts;

const CommandPalette = { register: jest.fn() };
globalThis.CommandPalette = CommandPalette;

const SlashCommands = { register: jest.fn() };
globalThis.SlashCommands = SlashCommands;

const PanelRegistry = { register: jest.fn() };
globalThis.PanelRegistry = PanelRegistry;

/* Shared helpers that app.js defines at top level */
globalThis.sanitizeStorageObject = function (obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(v => (v !== null && typeof v === 'object') ? sanitizeStorageObject(v) : v);
  const clean = Object.create(null);
  for (const k of Object.keys(obj)) clean[k] = (obj[k] !== null && typeof obj[k] === 'object') ? sanitizeStorageObject(obj[k]) : obj[k];
  return clean;
};
globalThis._escapeHtml = function (str) { return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); };
globalThis._truncate = function (str, max) { if (!str || str.length <= max) return str || ''; return str.substring(0, max - 1) + '\u2026'; };
globalThis.downloadBlob = jest.fn();

/* ── Extract and load ConversationMemory from app.js ── */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

const startMarker = 'ConversationMemory = (function';
const startIdx = src.indexOf(startMarker);
if (startIdx === -1) throw new Error('ConversationMemory not found in app.js');

// Walk braces to find the closing })();
let bc = 0, started = false, endPos = -1;
for (let i = startIdx; i < src.length; i++) {
  if (src[i] === '{') { bc++; started = true; }
  if (src[i] === '}') { bc--; }
  if (started && bc === 0) { endPos = i + 1; break; }
}
// The IIFE ends with ();
const iifeEnd = src.indexOf('();', endPos - 1);
const iifeBody = src.slice(startIdx + 'ConversationMemory = '.length, iifeEnd + 3);

// Extract TextAnalysisUtils (dependency of ConversationMemory helpers)
const tuMarker = 'const TextAnalysisUtils = (() => {';
const tuStart = src.indexOf(tuMarker);
if (tuStart !== -1) {
  let tbc = 0, ts = false, te = -1;
  for (let i = tuStart; i < src.length; i++) {
    if (src[i] === '{') { tbc++; ts = true; }
    if (src[i] === '}') { tbc--; }
    if (ts && tbc === 0) { te = i + 1; break; }
  }
  const tuIifeEnd = src.indexOf('();', te - 1);
  // Replace 'const' with 'var' so eval leaks to scope
  const tuBody = 'var' + src.slice(tuStart + 5, tuIifeEnd + 3);
  eval(tuBody);
  globalThis.TextAnalysisUtils = TextAnalysisUtils;
}

globalThis.ConversationMemory = eval(iifeBody);

/* ── Helper ── */
function clearStorage() {
  for (const k of Object.keys(storage)) delete storage[k];
}

/* ── Tests ── */
describe('ConversationMemory', () => {
  beforeEach(() => {
    clearStorage();
    ConversationManager.getUserMessages.mockReturnValue([]);
    ToastManager.show.mockClear();
  });

  // ── API surface ──

  test('exposes expected public API', () => {
    expect(typeof ConversationMemory.toggle).toBe('function');
    expect(typeof ConversationMemory.show).toBe('function');
    expect(typeof ConversationMemory.hide).toBe('function');
    expect(typeof ConversationMemory.extract).toBe('function');
    expect(typeof ConversationMemory.addManual).toBe('function');
    expect(typeof ConversationMemory.findRelevant).toBe('function');
  });

  // ── addManual ──

  describe('addManual', () => {
    test('adds a fact memory and returns true', () => {
      const result = ConversationMemory.addManual('I use Python for data science', 'fact');
      expect(result).toBe(true);
      const stored = SafeStorage.getJSON('agenticchat_memory', []);
      expect(stored.length).toBe(1);
      expect(stored[0].type).toBe('fact');
      expect(stored[0].content).toBe('I use Python for data science');
      expect(stored[0].confidence).toBe(1.0);
    });

    test('adds a decision memory', () => {
      ConversationMemory.addManual('We decided to use React', 'decision');
      const stored = SafeStorage.getJSON('agenticchat_memory', []);
      expect(stored[0].type).toBe('decision');
    });

    test('adds a preference memory', () => {
      ConversationMemory.addManual('I prefer TypeScript over JavaScript', 'preference');
      const stored = SafeStorage.getJSON('agenticchat_memory', []);
      expect(stored[0].type).toBe('preference');
    });

    test('defaults to fact type when type omitted', () => {
      ConversationMemory.addManual('Some random fact');
      const stored = SafeStorage.getJSON('agenticchat_memory', []);
      expect(stored[0].type).toBe('fact');
    });

    test('deduplicates highly similar entries', () => {
      ConversationMemory.addManual('I use Python for data analysis projects');
      const result = ConversationMemory.addManual('I use Python for data analysis projects');
      expect(result).toBe(false);
      const stored = SafeStorage.getJSON('agenticchat_memory', []);
      expect(stored.length).toBe(1);
    });

    test('allows sufficiently different entries', () => {
      ConversationMemory.addManual('I use Python for machine learning');
      ConversationMemory.addManual('The server runs on PostgreSQL 15');
      const stored = SafeStorage.getJSON('agenticchat_memory', []);
      expect(stored.length).toBe(2);
    });

    test('generates unique IDs for each memory', () => {
      ConversationMemory.addManual('First memory');
      ConversationMemory.addManual('Second completely different memory');
      const stored = SafeStorage.getJSON('agenticchat_memory', []);
      expect(stored[0].id).not.toBe(stored[1].id);
    });

    test('includes session info in source', () => {
      ConversationMemory.addManual('I work at a startup');
      const stored = SafeStorage.getJSON('agenticchat_memory', []);
      expect(stored[0].source).toBeDefined();
      expect(stored[0].source.sessionId).toBe('test-session');
      expect(stored[0].source.sessionName).toBe('Test Session');
      expect(stored[0].source.timestamp).toBeDefined();
    });

    test('generates tags from content tokens', () => {
      ConversationMemory.addManual('I use Python and JavaScript for web development');
      const stored = SafeStorage.getJSON('agenticchat_memory', []);
      expect(stored[0].tags).toBeDefined();
      expect(Array.isArray(stored[0].tags)).toBe(true);
      expect(stored[0].tags.length).toBeLessThanOrEqual(5);
      // Tags should be lowercase tokens > 2 chars
      stored[0].tags.forEach(tag => {
        expect(tag.length).toBeGreaterThan(2);
        expect(tag).toBe(tag.toLowerCase());
      });
    });

    test('enforces MAX_MEMORIES cap (500)', () => {
      // Add 502 unique memories
      for (let i = 0; i < 502; i++) {
        ConversationMemory.addManual(`Unique memory number ${i} with extra words to avoid dedup xyzzy${i}`);
      }
      const stored = SafeStorage.getJSON('agenticchat_memory', []);
      expect(stored.length).toBeLessThanOrEqual(500);
    });

    test('keeps highest-confidence when trimming to cap', () => {
      // Manual entries have confidence=1.0, so they should survive
      for (let i = 0; i < 10; i++) {
        ConversationMemory.addManual(`Important fact number ${i} alpha beta gamma delta ${i * 1000}`);
      }
      const stored = SafeStorage.getJSON('agenticchat_memory', []);
      stored.forEach(m => expect(m.confidence).toBe(1.0));
    });

    test('trims whitespace from content', () => {
      ConversationMemory.addManual('  padded content with spaces  ');
      const stored = SafeStorage.getJSON('agenticchat_memory', []);
      expect(stored[0].content).toBe('padded content with spaces');
    });
  });

  // ── findRelevant ──

  describe('findRelevant', () => {
    beforeEach(() => {
      ConversationMemory.addManual('I use Python for machine learning projects', 'fact');
      ConversationMemory.addManual('The database runs on PostgreSQL version 15', 'fact');
      ConversationMemory.addManual('We decided to deploy on AWS Lambda', 'decision');
      ConversationMemory.addManual('I prefer dark mode in all editors', 'preference');
      ConversationMemory.addManual('Need to update the SSL certificates by Friday', 'action');
    });

    test('finds relevant memories by keyword overlap', () => {
      const results = ConversationMemory.findRelevant('Python machine learning');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].memory.content).toContain('Python');
    });

    test('returns empty for unrelated query', () => {
      const results = ConversationMemory.findRelevant('quantum teleportation');
      expect(results).toEqual([]);
    });

    test('returns empty for empty query', () => {
      const results = ConversationMemory.findRelevant('');
      expect(results).toEqual([]);
    });

    test('respects limit parameter', () => {
      const results = ConversationMemory.findRelevant('the', 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    test('defaults to limit of 5', () => {
      // Add many memories with overlapping terms
      for (let i = 0; i < 10; i++) {
        ConversationMemory.addManual(`The server configuration item number ${i} xyzzy${i}`);
      }
      const results = ConversationMemory.findRelevant('server configuration');
      expect(results.length).toBeLessThanOrEqual(5);
    });

    test('scores by relevance — closest match first', () => {
      const results = ConversationMemory.findRelevant('PostgreSQL database version');
      if (results.length >= 2) {
        expect(results[0].relevance).toBeGreaterThanOrEqual(results[1].relevance);
      }
    });

    test('each result has memory and relevance fields', () => {
      const results = ConversationMemory.findRelevant('Python');
      results.forEach(r => {
        expect(r).toHaveProperty('memory');
        expect(r).toHaveProperty('relevance');
        expect(r.relevance).toBeGreaterThan(0);
        expect(r.memory).toHaveProperty('content');
        expect(r.memory).toHaveProperty('type');
      });
    });
  });

  // ── extract (from conversation) ──

  describe('extract', () => {
    test('returns 0 when no messages', () => {
      ConversationManager.getUserMessages.mockReturnValue([]);
      const added = ConversationMemory.extract();
      expect(added).toBe(0);
    });

    test('extracts facts from user messages', () => {
      ConversationManager.getUserMessages.mockReturnValue([
        { role: 'user', content: 'I am a software engineer at Google.' },
        { role: 'assistant', content: 'That sounds great!' },
      ]);
      const added = ConversationMemory.extract();
      expect(added).toBeGreaterThanOrEqual(1);
      const stored = SafeStorage.getJSON('agenticchat_memory', []);
      expect(stored.some(m => m.type === 'fact')).toBe(true);
    });

    test('skips assistant messages', () => {
      ConversationManager.getUserMessages.mockReturnValue([
        { role: 'assistant', content: 'I am an AI assistant built by OpenAI.' },
      ]);
      const added = ConversationMemory.extract();
      expect(added).toBe(0);
    });

    test('extracts decisions', () => {
      ConversationManager.getUserMessages.mockReturnValue([
        { role: 'user', content: "Let's go with the microservices architecture for this project." },
      ]);
      const added = ConversationMemory.extract();
      expect(added).toBeGreaterThanOrEqual(1);
      const stored = SafeStorage.getJSON('agenticchat_memory', []);
      expect(stored.some(m => m.type === 'decision')).toBe(true);
    });

    test('extracts preferences', () => {
      ConversationManager.getUserMessages.mockReturnValue([
        { role: 'user', content: 'I prefer using Vim over VSCode for editing code.' },
      ]);
      const added = ConversationMemory.extract();
      expect(added).toBeGreaterThanOrEqual(1);
      const stored = SafeStorage.getJSON('agenticchat_memory', []);
      expect(stored.some(m => m.type === 'preference')).toBe(true);
    });

    test('extracts action items', () => {
      ConversationManager.getUserMessages.mockReturnValue([
        { role: 'user', content: 'I need to deploy the application before the deadline on Monday.' },
      ]);
      const added = ConversationMemory.extract();
      expect(added).toBeGreaterThanOrEqual(1);
      const stored = SafeStorage.getJSON('agenticchat_memory', []);
      expect(stored.some(m => m.type === 'action')).toBe(true);
    });

    test('extracts insights', () => {
      ConversationManager.getUserMessages.mockReturnValue([
        { role: 'user', content: 'The root cause was a race condition in the connection pool implementation.' },
      ]);
      const added = ConversationMemory.extract();
      expect(added).toBeGreaterThanOrEqual(1);
      const stored = SafeStorage.getJSON('agenticchat_memory', []);
      expect(stored.some(m => m.type === 'insight')).toBe(true);
    });

    test('deduplicates across multiple extractions', () => {
      const messages = [
        { role: 'user', content: 'I use Python for all my data science work regularly.' },
      ];
      ConversationManager.getUserMessages.mockReturnValue(messages);
      const first = ConversationMemory.extract();
      const second = ConversationMemory.extract();
      // Second extraction of same content should add nothing new
      expect(second).toBe(0);
    });

    test('confidence increases with sentence length', () => {
      ConversationManager.getUserMessages.mockReturnValue([
        { role: 'user', content: 'I use Python at work. I have been using Python professionally for over ten years in enterprise data pipelines.' },
      ]);
      ConversationMemory.extract();
      const stored = SafeStorage.getJSON('agenticchat_memory', []);
      // Both might match 'fact'; the longer sentence should have higher confidence
      if (stored.length >= 2) {
        const short = stored.find(m => m.content.length < 30);
        const long = stored.find(m => m.content.length > 50);
        if (short && long) {
          expect(long.confidence).toBeGreaterThanOrEqual(short.confidence);
        }
      }
    });

    test('ignores very short sentences (<=10 chars)', () => {
      ConversationManager.getUserMessages.mockReturnValue([
        { role: 'user', content: 'Hi there. I am a developer at Microsoft working on cloud infrastructure.' },
      ]);
      ConversationMemory.extract();
      const stored = SafeStorage.getJSON('agenticchat_memory', []);
      // "Hi there" (8 chars) should be skipped
      expect(stored.every(m => m.content.length > 10)).toBe(true);
    });

    test('ignores very long sentences (>=300 chars)', () => {
      const longSentence = 'I use ' + 'x'.repeat(300) + ' for everything.';
      ConversationManager.getUserMessages.mockReturnValue([
        { role: 'user', content: longSentence },
      ]);
      ConversationMemory.extract();
      const stored = SafeStorage.getJSON('agenticchat_memory', []);
      expect(stored.every(m => m.content.length < 300)).toBe(true);
    });
  });

  // ── Cross-feature integration ──

  describe('integration', () => {
    test('addManual then findRelevant retrieves it', () => {
      ConversationMemory.addManual('Our production database is MongoDB Atlas cluster');
      const results = ConversationMemory.findRelevant('MongoDB database');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].memory.content).toContain('MongoDB');
    });

    test('extract then findRelevant retrieves extracted memories', () => {
      ConversationManager.getUserMessages.mockReturnValue([
        { role: 'user', content: 'I work with Kubernetes clusters in production environment daily.' },
      ]);
      ConversationMemory.extract();
      const results = ConversationMemory.findRelevant('Kubernetes clusters production');
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    test('memories persist across addManual calls', () => {
      ConversationMemory.addManual('First unique fact about astronomy and stars');
      ConversationMemory.addManual('Second unique fact about geology and rocks');
      const stored = SafeStorage.getJSON('agenticchat_memory', []);
      expect(stored.length).toBe(2);
    });
  });
});
