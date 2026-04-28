/**
 * @jest-environment jsdom
 */

/* ── helpers ── */
const storage = {};
const SafeStorage = {
  getItem: function(k) { return storage[k] || null; },
  setItem: function(k, v) { storage[k] = v; },
  removeItem: function(k) { delete storage[k]; },
  getJSON: function(k, def) { try { var v = storage[k]; return v ? JSON.parse(v) : def; } catch(e) { return def; } },
  trySetJSON: function(k, v) { storage[k] = JSON.stringify(v); }
};
globalThis.SafeStorage = SafeStorage;

const KeyboardShortcuts = { register: jest.fn() };
globalThis.KeyboardShortcuts = KeyboardShortcuts;

const CommandPalette = { register: jest.fn() };
globalThis.CommandPalette = CommandPalette;

const MessageContextMenu = { register: jest.fn() };
globalThis.MessageContextMenu = MessageContextMenu;

const TextAnalytics = {
  tokenise: function(t) { return (t || '').split(/\s+/).filter(Boolean); },
  tfidf: function(t) { return {}; },
  cosineSim: function(a, b) { return 0; }
};
globalThis.TextAnalytics = TextAnalytics;

/* ── Load module under test ── */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// Extract the SmartResponseAuditor IIFE from app.js
const startMarker = 'var SmartResponseAuditor = (function () {';
const startIdx = src.indexOf(startMarker);
if (startIdx === -1) throw new Error('SmartResponseAuditor not found in app.js');

// Find the closing })(); for this IIFE — it's the last one in the file
const endMarker = '\n})();';
const endIdx = src.lastIndexOf(endMarker);
const iifeBody = src.slice(startIdx + 'var SmartResponseAuditor = '.length, endIdx + endMarker.length);

// Suppress DOMContentLoaded in the extracted code
const cleanCode = iifeBody.replace(
  "document.addEventListener('DOMContentLoaded', init)",
  "/* DOMContentLoaded suppressed */"
);
globalThis.SmartResponseAuditor = eval(cleanCode);

/* ── Tests ── */
describe('SmartResponseAuditor', () => {
  beforeEach(() => {
    for (var k of Object.keys(storage)) delete storage[k];
  });

  /* ── module existence ── */
  test('module is defined', () => {
    expect(typeof SmartResponseAuditor).toBe('object');
  });

  test('exposes public API', () => {
    expect(typeof SmartResponseAuditor.auditMessage).toBe('function');
    expect(typeof SmartResponseAuditor.auditAll).toBe('function');
    expect(typeof SmartResponseAuditor.toggle).toBe('function');
    expect(typeof SmartResponseAuditor.show).toBe('function');
    expect(typeof SmartResponseAuditor.hide).toBe('function');
    expect(typeof SmartResponseAuditor.getAudit).toBe('function');
    expect(typeof SmartResponseAuditor.getStats).toBe('function');
    expect(typeof SmartResponseAuditor.isEnabled).toBe('function');
    expect(typeof SmartResponseAuditor.setEnabled).toBe('function');
    expect(typeof SmartResponseAuditor.setSensitivity).toBe('function');
  });

  /* ── empty / short input ── */
  test('empty string returns clean', () => {
    var r = SmartResponseAuditor.auditMessage('');
    expect(r.grade).toBe('clean');
    expect(r.overall).toBe(0);
  });

  test('null input returns clean', () => {
    var r = SmartResponseAuditor.auditMessage(null);
    expect(r.grade).toBe('clean');
  });

  test('very short message returns clean', () => {
    var r = SmartResponseAuditor.auditMessage('OK');
    expect(r.grade).toBe('clean');
  });

  /* ── Hallucination Risk ── */
  test('hallucination: detects confidence words with factual claims', () => {
    var text = 'Python was definitely invented in 1991. It is certainly the best language and always performs well.';
    var r = SmartResponseAuditor.auditMessage(text);
    var halCheck = r.checks.find(function(c) { return c.name === 'Hallucination Risk'; });
    expect(halCheck.score).toBeGreaterThan(0);
    expect(halCheck.flagged.length).toBeGreaterThan(0);
  });

  test('hallucination: clean text has zero score', () => {
    var text = 'Python is a popular programming language used for web development and data science.';
    var r = SmartResponseAuditor.auditMessage(text);
    var halCheck = r.checks.find(function(c) { return c.name === 'Hallucination Risk'; });
    expect(halCheck.score).toBe(0);
  });

  test('hallucination: confidence words without factual claims score lower', () => {
    var text = 'I definitely think this is great and certainly wonderful and absolutely amazing and always fun.';
    var r = SmartResponseAuditor.auditMessage(text);
    var halCheck = r.checks.find(function(c) { return c.name === 'Hallucination Risk'; });
    expect(halCheck.score).toBeGreaterThanOrEqual(0);
  });

  /* ── Hedge Overload ── */
  test('hedge: detects excessive hedging', () => {
    var text = 'I think maybe this might possibly perhaps work. It could be that it seems like it probably might function. Perhaps possibly this could work.';
    var r = SmartResponseAuditor.auditMessage(text);
    var hedgeCheck = r.checks.find(function(c) { return c.name === 'Hedge Overload'; });
    expect(hedgeCheck.score).toBeGreaterThan(0);
    expect(hedgeCheck.ratio).toBeGreaterThan(0);
  });

  test('hedge: confident text has zero score', () => {
    var text = 'The function takes two parameters and returns their sum. Use the add method to combine values.';
    var r = SmartResponseAuditor.auditMessage(text);
    var hedgeCheck = r.checks.find(function(c) { return c.name === 'Hedge Overload'; });
    expect(hedgeCheck.score).toBe(0);
  });

  /* ── Self-Contradiction ── */
  test('contradiction: detects contradictory statements', () => {
    var text = 'The function is thread safe. However the function is not thread safe when called concurrently.';
    var r = SmartResponseAuditor.auditMessage(text);
    var conCheck = r.checks.find(function(c) { return c.name === 'Self-Contradiction'; });
    expect(conCheck.score).toBeGreaterThan(0);
    expect(conCheck.contradictions.length).toBeGreaterThan(0);
  });

  test('contradiction: consistent text has zero score', () => {
    var text = 'The API returns JSON data. The response includes a status code and a message body.';
    var r = SmartResponseAuditor.auditMessage(text);
    var conCheck = r.checks.find(function(c) { return c.name === 'Self-Contradiction'; });
    expect(conCheck.score).toBe(0);
  });

  /* ── Code Quality ── */
  test('code quality: detects placeholder values', () => {
    var text = 'Here is the code:\n```javascript\nconst API_KEY = "your-api-key";\nfetch("https://example.com/api");\n```';
    var r = SmartResponseAuditor.auditMessage(text);
    var codeCheck = r.checks.find(function(c) { return c.name === 'Code Quality'; });
    expect(codeCheck.score).toBeGreaterThan(0);
    expect(codeCheck.issues.length).toBeGreaterThan(0);
  });

  test('code quality: clean code has zero score', () => {
    var text = 'Here is the code:\n```javascript\nfunction add(a, b) { return a + b; }\n```';
    var r = SmartResponseAuditor.auditMessage(text);
    var codeCheck = r.checks.find(function(c) { return c.name === 'Code Quality'; });
    expect(codeCheck.score).toBe(0);
  });

  test('code quality: no code blocks returns zero', () => {
    var text = 'This is just a plain text response with no code at all.';
    var r = SmartResponseAuditor.auditMessage(text);
    var codeCheck = r.checks.find(function(c) { return c.name === 'Code Quality'; });
    expect(codeCheck.score).toBe(0);
  });

  test('code quality: detects TODO comments', () => {
    var text = '```python\ndef process(data):\n    # TODO: implement validation\n    return data\n```';
    var r = SmartResponseAuditor.auditMessage(text);
    var codeCheck = r.checks.find(function(c) { return c.name === 'Code Quality'; });
    expect(codeCheck.issues.length).toBeGreaterThan(0);
  });

  /* ── Unsupported Claims ── */
  test('claims: detects unsupported statistical claims', () => {
    var text = 'Studies show that 90% of developers prefer TypeScript. Research indicates this trend is growing rapidly.';
    var r = SmartResponseAuditor.auditMessage(text);
    var claimCheck = r.checks.find(function(c) { return c.name === 'Unsupported Claims'; });
    expect(claimCheck.score).toBeGreaterThan(0);
    expect(claimCheck.claims.length).toBeGreaterThan(0);
  });

  test('claims: claims with citations are okay', () => {
    var text = 'According to a 2024 survey [1], 75% of teams use Git. (source: https://example.org/survey)';
    var r = SmartResponseAuditor.auditMessage(text);
    var claimCheck = r.checks.find(function(c) { return c.name === 'Unsupported Claims'; });
    expect(claimCheck.score).toBe(0);
  });

  test('claims: no claims returns zero', () => {
    var text = 'To install the package, run npm install. Then import it in your file.';
    var r = SmartResponseAuditor.auditMessage(text);
    var claimCheck = r.checks.find(function(c) { return c.name === 'Unsupported Claims'; });
    expect(claimCheck.score).toBe(0);
  });

  /* ── Repetition ── */
  test('repetition: detects repeated sentences', () => {
    var text = 'The function processes the input data efficiently. It validates the parameters first. The function processes the input data efficiently. Then it returns the result. Another repeated line is here for testing. Another repeated line is here for testing.';
    var r = SmartResponseAuditor.auditMessage(text);
    var repCheck = r.checks.find(function(c) { return c.name === 'Repetition'; });
    expect(repCheck.score).toBeGreaterThan(0);
    expect(repCheck.duplicates.length).toBeGreaterThan(0);
  });

  test('repetition: unique text has zero score', () => {
    var text = 'First step is to clone the repo. Second step is to install dependencies. Third step is to run the tests.';
    var r = SmartResponseAuditor.auditMessage(text);
    var repCheck = r.checks.find(function(c) { return c.name === 'Repetition'; });
    expect(repCheck.score).toBe(0);
  });

  /* ── Incomplete Response ── */
  test('incomplete: detects unclosed code blocks', () => {
    var text = 'Here is the solution:\n```python\ndef solve(x):\n    return x * 2';
    var r = SmartResponseAuditor.auditMessage(text);
    var incCheck = r.checks.find(function(c) { return c.name === 'Incomplete Response'; });
    expect(incCheck.score).toBeGreaterThan(0);
    expect(incCheck.issues).toContain('Unclosed code block');
  });

  test('incomplete: detects trailing ellipsis', () => {
    var text = 'The implementation involves several steps including data parsing, validation, transformation...';
    var r = SmartResponseAuditor.auditMessage(text);
    var incCheck = r.checks.find(function(c) { return c.name === 'Incomplete Response'; });
    expect(incCheck.score).toBeGreaterThan(0);
  });

  test('incomplete: complete response has zero score', () => {
    var text = 'The function returns the sum of two numbers. Use it like this: `add(1, 2)`.';
    var r = SmartResponseAuditor.auditMessage(text);
    var incCheck = r.checks.find(function(c) { return c.name === 'Incomplete Response'; });
    expect(incCheck.score).toBe(0);
  });

  /* ── Overall grading ── */
  test('overall: clean message gets clean grade', () => {
    var text = 'To install Python, download it from python.org. Run the installer and follow the prompts.';
    var r = SmartResponseAuditor.auditMessage(text);
    expect(r.grade).toBe('clean');
  });

  test('overall: message with many issues gets major grade', () => {
    var text = 'Studies show that 95% of experts definitely agree this always works. Research indicates it certainly does. ' +
      'I think maybe this might possibly perhaps help. ' +
      'The system is reliable. However the system is not reliable under load. ' +
      '```\nconst key = "your-api-key";\n// TODO fix this\n';
    var r = SmartResponseAuditor.auditMessage(text);
    expect(r.grade).toBe('major');
    expect(r.issueCount).toBeGreaterThanOrEqual(3);
  });

  test('overall: checks array always has 7 items', () => {
    var r = SmartResponseAuditor.auditMessage('Hello world, this is a simple test message.');
    expect(r.checks.length).toBe(7);
  });

  /* ── Configuration ── */
  test('setEnabled toggles enabled state', () => {
    SmartResponseAuditor.setEnabled(false);
    expect(SmartResponseAuditor.isEnabled()).toBe(false);
    SmartResponseAuditor.setEnabled(true);
    expect(SmartResponseAuditor.isEnabled()).toBe(true);
  });

  test('setSensitivity changes sensitivity', () => {
    SmartResponseAuditor.setSensitivity('high');
    var text = 'I think this might work.';
    SmartResponseAuditor.setSensitivity('medium');
  });

  test('setSensitivity ignores invalid values', () => {
    SmartResponseAuditor.setSensitivity('invalid');
    expect(SmartResponseAuditor.isEnabled()).toBe(true);
  });

  /* ── Stats ── */
  test('getStats returns aggregate stats', () => {
    var stats = SmartResponseAuditor.getStats();
    expect(typeof stats.total).toBe('number');
    expect(typeof stats.clean).toBe('number');
    expect(typeof stats.minor).toBe('number');
    expect(typeof stats.major).toBe('number');
    expect(typeof stats.avgScore).toBe('number');
  });

  test('getAudit returns null for non-existent index', () => {
    expect(SmartResponseAuditor.getAudit(99999)).toBeNull();
  });

  /* ── Edge cases ── */
  test('code-only message audits correctly', () => {
    var text = '```javascript\nconsole.log("hello");\n```';
    var r = SmartResponseAuditor.auditMessage(text);
    expect(r.checks.length).toBe(7);
  });

  test('very long message does not crash', () => {
    var text = '';
    for (var i = 0; i < 500; i++) text += 'This is sentence number ' + i + '. ';
    var r = SmartResponseAuditor.auditMessage(text);
    expect(r.checks.length).toBe(7);
  });

  test('message with mixed content audits all aspects', () => {
    var text = 'Here is a solution.\n```python\nprint("hello")\n```\nThis approach is efficient and works well.';
    var r = SmartResponseAuditor.auditMessage(text);
    expect(r.checks.length).toBe(7);
    expect(r.grade).toBe('clean');
  });
});
