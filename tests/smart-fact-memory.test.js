/**
 * @jest-environment jsdom
 */

/* ── helpers ── */
const storage = {};
const SafeStorage = {
  getItem: (k) => storage[k] || null,
  setItem: (k, v) => { storage[k] = v; },
  removeItem: (k) => { delete storage[k]; }
};
globalThis.SafeStorage = SafeStorage;

const ToastManager = { show: jest.fn() };
globalThis.ToastManager = ToastManager;

const SessionManager = { currentId: () => 'test-session-1' };
globalThis.SessionManager = SessionManager;

const KeyboardShortcuts = { register: jest.fn() };
globalThis.KeyboardShortcuts = KeyboardShortcuts;

const CommandPalette = { register: jest.fn() };
globalThis.CommandPalette = CommandPalette;

const SlashCommands = { register: jest.fn() };
globalThis.SlashCommands = SlashCommands;

const PanelRegistry = { register: jest.fn() };
globalThis.PanelRegistry = PanelRegistry;

/* ── Load module under test ── */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// Extract just the SmartFactMemory IIFE from app.js and evaluate it
const startMarker = 'const SmartFactMemory = (() => {';
const startIdx = src.indexOf(startMarker);
// Find the matching closing pattern
const endMarker = '\n})();';
let searchFrom = startIdx + startMarker.length;
let endIdx = -1;
// Find last })(); which closes SmartFactMemory (it's the last module)
endIdx = src.lastIndexOf(endMarker);
const iifeBody = src.slice(startIdx + 'const SmartFactMemory = '.length, endIdx + endMarker.length);
globalThis.SmartFactMemory = eval(iifeBody);

/* ── Tests ── */
describe('SmartFactMemory', () => {
  beforeEach(() => {
    // Clear storage between tests
    for (const k of Object.keys(storage)) delete storage[k];
    ToastManager.show.mockClear();
  });

  test('module exists and has expected API', () => {
    expect(SmartFactMemory).toBeDefined();
    expect(typeof SmartFactMemory.toggle).toBe('function');
    expect(typeof SmartFactMemory.show).toBe('function');
    expect(typeof SmartFactMemory.hide).toBe('function');
    expect(typeof SmartFactMemory.extractFacts).toBe('function');
    expect(typeof SmartFactMemory.addFacts).toBe('function');
    expect(typeof SmartFactMemory.getRelevantFacts).toBe('function');
    expect(typeof SmartFactMemory.facts).toBe('function');
    expect(typeof SmartFactMemory.count).toBe('function');
    expect(typeof SmartFactMemory.isEnabled).toBe('function');
    expect(typeof SmartFactMemory.setEnabled).toBe('function');
  });

  test('extractFacts returns empty for null/empty input', () => {
    expect(SmartFactMemory.extractFacts(null)).toEqual([]);
    expect(SmartFactMemory.extractFacts('')).toEqual([]);
    expect(SmartFactMemory.extractFacts(123)).toEqual([]);
  });

  test('extracts action items', () => {
    const text = 'You should restart the server after updating the configuration file.';
    const facts = SmartFactMemory.extractFacts(text, 'test');
    expect(facts.length).toBeGreaterThanOrEqual(1);
    expect(facts[0].category).toBe('action');
    expect(facts[0].text).toContain('restart the server');
  });

  test('extracts decisions', () => {
    const text = "We'll go with PostgreSQL for the database layer since it supports JSON.";
    const facts = SmartFactMemory.extractFacts(text, 'test');
    expect(facts.length).toBeGreaterThanOrEqual(1);
    expect(facts[0].category).toBe('decision');
  });

  test('extracts preferences', () => {
    const text = 'I prefer using TypeScript over plain JavaScript for large projects.';
    const facts = SmartFactMemory.extractFacts(text, 'test');
    expect(facts.length).toBeGreaterThanOrEqual(1);
    expect(facts[0].category).toBe('preference');
  });

  test('extracts definitions with bold markers', () => {
    const text = '**TF-IDF** is a numerical statistic that reflects how important a word is to a document.';
    const facts = SmartFactMemory.extractFacts(text, 'test');
    expect(facts.length).toBeGreaterThanOrEqual(1);
    const def = facts.find(f => f.category === 'definition');
    expect(def).toBeDefined();
    expect(def.label).toBe('TF-IDF');
  });

  test('extracts facts with key phrases', () => {
    const text = 'Note that the default port is 8080 for the development server.';
    const facts = SmartFactMemory.extractFacts(text, 'test');
    expect(facts.length).toBeGreaterThanOrEqual(1);
    expect(facts.some(f => f.category === 'fact')).toBe(true);
  });

  test('deduplicates facts', () => {
    const text1 = 'You should restart the server after every deploy.';
    const facts1 = SmartFactMemory.extractFacts(text1, 'test');
    SmartFactMemory.addFacts(facts1);

    // Same text should not produce duplicates
    const facts2 = SmartFactMemory.extractFacts(text1, 'test');
    expect(facts2.length).toBe(0);
  });

  test('addFacts persists to storage', () => {
    const facts = SmartFactMemory.extractFacts(
      'Remember to update the changelog before each release cycle.',
      'test'
    );
    SmartFactMemory.addFacts(facts);
    const stored = JSON.parse(storage.sfm_facts);
    expect(stored.length).toBeGreaterThanOrEqual(1);
  });

  test('getRelevantFacts returns matching facts', () => {
    SmartFactMemory.addFacts([{
      id: 'test1',
      category: 'fact',
      text: 'PostgreSQL supports JSONB columns for document storage',
      label: null,
      source: 'test',
      sessionId: 'test',
      timestamp: Date.now(),
      pinned: false
    }]);

    const results = SmartFactMemory.getRelevantFacts('PostgreSQL document');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].text).toContain('PostgreSQL');
  });

  test('getRelevantFacts returns empty for no match', () => {
    expect(SmartFactMemory.getRelevantFacts('xyznonexistent')).toEqual([]);
  });

  test('getRelevantFacts returns empty for null query', () => {
    expect(SmartFactMemory.getRelevantFacts(null)).toEqual([]);
    expect(SmartFactMemory.getRelevantFacts('')).toEqual([]);
  });

  test('pinned facts get relevance boost', () => {
    SmartFactMemory.addFacts([
      { id: 'a', category: 'fact', text: 'Python is versatile', label: null, source: 'test', sessionId: 's1', timestamp: Date.now(), pinned: true },
      { id: 'b', category: 'fact', text: 'Python is popular', label: null, source: 'test', sessionId: 's1', timestamp: Date.now(), pinned: false }
    ]);
    const results = SmartFactMemory.getRelevantFacts('Python');
    // Pinned fact should come first (same keyword match + pin bonus)
    expect(results[0].id).toBe('a');
  });

  test('isEnabled and setEnabled work', () => {
    expect(SmartFactMemory.isEnabled()).toBe(true);
    SmartFactMemory.setEnabled(false);
    expect(SmartFactMemory.isEnabled()).toBe(false);
    SmartFactMemory.setEnabled(true);
  });

  test('extractFacts assigns session id from SessionManager', () => {
    const facts = SmartFactMemory.extractFacts(
      'You should always validate user input before processing it in the pipeline.',
      'assistant'
    );
    expect(facts.length).toBeGreaterThanOrEqual(1);
    expect(facts[0].sessionId).toBe('test-session-1');
  });

  test('extractFacts respects minimum text length', () => {
    const text = 'You should do x.'; // captured text "do x" is too short
    const facts = SmartFactMemory.extractFacts(text, 'test');
    expect(facts.length).toBe(0);
  });

  test('facts() returns a copy', () => {
    const f1 = SmartFactMemory.facts();
    const f2 = SmartFactMemory.facts();
    expect(f1).not.toBe(f2); // different array references
  });

  test('count() returns current fact count', () => {
    const before = SmartFactMemory.count();
    SmartFactMemory.addFacts([{
      id: 'cnt1',
      category: 'fact',
      text: 'Counting test fact entry here',
      label: null,
      source: 'test',
      sessionId: 'test',
      timestamp: Date.now(),
      pinned: false
    }]);
    expect(SmartFactMemory.count()).toBe(before + 1);
  });

  test('extracts checklist action items', () => {
    const text = '- [ ] Review the pull request for security issues\n- [ ] Update the documentation';
    const facts = SmartFactMemory.extractFacts(text, 'test');
    expect(facts.length).toBeGreaterThanOrEqual(1);
    expect(facts.every(f => f.category === 'action')).toBe(true);
  });

  test('extracts "stands for" definitions', () => {
    const text = 'CORS stands for Cross-Origin Resource Sharing which allows restricted resources.';
    const facts = SmartFactMemory.extractFacts(text, 'test');
    const def = facts.find(f => f.category === 'definition');
    expect(def).toBeDefined();
    expect(def.label).toBe('CORS');
  });

  test('extracts "the default is" facts', () => {
    const text = 'Please check because the limit is 100 connections per second for this endpoint.';
    const facts = SmartFactMemory.extractFacts(text, 'test');
    expect(facts.length).toBeGreaterThanOrEqual(1);
    expect(facts.some(f => f.category === 'fact')).toBe(true);
  });

  test('strips trailing punctuation from extracted text', () => {
    const text = 'Note that the maximum size is 10MB for uploaded files.';
    const facts = SmartFactMemory.extractFacts(text, 'test');
    if (facts.length > 0) {
      expect(facts[0].text).not.toMatch(/[.;,!]$/);
    }
  });
});
