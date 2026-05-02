/**
 * SmartQuestionTracker — Test Suite
 * Tests for unanswered-question detection, answer assessment,
 * deduplication, nudge logic, persistence, and tab filtering.
 */

/* ── minimal stubs ── */
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="chat-output"></div></body></html>');
global.document = dom.window.document;
global.window = dom.window;
global.MutationObserver = class { observe() {} disconnect() {} };
global.localStorage = (() => {
  let store = {};
  return {
    getItem: k => store[k] || null,
    setItem: (k, v) => { store[k] = v; },
    removeItem: k => { delete store[k]; },
    clear: () => { store = {}; }
  };
})();
global.SafeStorage = {
  get: k => localStorage.getItem(k),
  set: (k, v) => localStorage.setItem(k, v),
  getJSON: (k, fallback = null) => {
    const raw = localStorage.getItem(k);
    if (raw == null) return fallback;
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  },
  setJSON: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  trySetJSON: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  trySet: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} }
};
global.setTimeout = (fn, ms) => { if (!ms || ms < 100) fn(); return 1; };
global.clearTimeout = () => {};
global.KeyboardShortcuts = { register: jest.fn() };
global.CommandPalette = { register: jest.fn() };
global.SlashCommands = { register: jest.fn() };
global.PanelRegistry = { register: jest.fn() };
global.SessionManager = { current: () => 'test-session' };
global.sanitizeStorageObject = (o) => o;

/* Load module */
const fs = require('fs');
const path = require('path');
const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

const moduleStart = appCode.indexOf('var SmartQuestionTracker = (function');
const moduleEnd = appCode.indexOf('\n/* ==', moduleStart + 100);
const moduleCode = appCode.slice(moduleStart, moduleEnd > moduleStart ? moduleEnd : undefined);

// Expose internals for testing
const testableCode = moduleCode.replace(
  'return { toggle: toggle, show: show, hide: hide, markAnswered: markAnswered, copyQuestion: copyQuestion, dismiss: dismiss, switchTab: switchTab };',
  `return {
    toggle: toggle, show: show, hide: hide,
    markAnswered: markAnswered, copyQuestion: copyQuestion,
    dismiss: dismiss, switchTab: switchTab,
    _extractQuestions: _extractQuestions,
    _assessAnswer: _assessAnswer,
    _processNewMessage: _processNewMessage,
    _getQuestions: function() { return _questions; },
    _resetState: function() { _questions = []; _nextId = 1; },
    _checkNudge: _checkNudge,
    _save: _save, _load: _load
  };`
).replace('var SmartQuestionTracker', 'global.SmartQuestionTracker');

eval(testableCode);

const SQT = global.SmartQuestionTracker;

/* ── helpers ── */
function makeMessageEl(text, role) {
  const el = document.createElement('div');
  el.classList.add('message');
  el.classList.add(role === 'user' ? 'user-message' : 'assistant-message');
  el.textContent = text;
  return el;
}

beforeEach(() => {
  localStorage.clear();
  SQT._resetState();
  const nudge = document.getElementById('qt-nudge');
  if (nudge) nudge.remove();
});

/* ===== _extractQuestions ===== */

describe('_extractQuestions', () => {
  test('detects direct question marks', () => {
    const qs = SQT._extractQuestions('What is the meaning of life?');
    expect(qs.length).toBe(1);
    expect(qs[0]).toContain('What is the meaning of life');
  });

  test('detects wh-questions without trailing question mark', () => {
    const qs = SQT._extractQuestions('Could you explain how this function works in detail');
    expect(qs.length).toBe(1);
  });

  test('ignores short sentences', () => {
    const qs = SQT._extractQuestions('Why? Huh?');
    expect(qs.length).toBe(0);
  });

  test('ignores rhetorical questions', () => {
    const qs = SQT._extractQuestions("How about that, isn't it great, you know?");
    expect(qs.length).toBe(0);
  });

  test('extracts multiple questions from multi-sentence text', () => {
    const text = 'What is TypeScript? This is a statement. Where should I start learning?';
    const qs = SQT._extractQuestions(text);
    expect(qs.length).toBe(2);
  });

  test('strips leading bullet markers', () => {
    const qs = SQT._extractQuestions('- What is the best approach here?');
    expect(qs.length).toBe(1);
    expect(qs[0]).not.toMatch(/^[-*>]/);
  });

  test('truncates very long questions to 200 chars', () => {
    const longQ = 'What is ' + 'a'.repeat(250) + '?';
    const qs = SQT._extractQuestions(longQ);
    expect(qs.length).toBe(1);
    expect(qs[0].length).toBeLessThanOrEqual(200);
  });

  test('returns empty array for plain statements', () => {
    const qs = SQT._extractQuestions('The weather is nice today. I like coding in JavaScript.');
    expect(qs.length).toBe(0);
  });
});

/* ===== _assessAnswer ===== */

describe('_assessAnswer', () => {
  test('returns high score when response contains question keywords', () => {
    const q = { text: 'What is the deployment process for this application?', _words: null };
    const score = SQT._assessAnswer(q, 'The deployment process for the application involves Docker and Kubernetes');
    expect(score).toBeGreaterThan(0.4);
  });

  test('returns low score when response is unrelated', () => {
    const q = { text: 'What is the deployment process for this application?', _words: null };
    const score = SQT._assessAnswer(q, 'I like cats and dogs');
    expect(score).toBeLessThan(0.3);
  });

  test('boosts score for long responses', () => {
    const q = { text: 'What is the deployment workflow used here?', _words: null };
    const shortResponse = 'deployment workflow';
    const longResponse = 'The deployment workflow used here involves continuous integration. ' + 'x'.repeat(100);
    const shortScore = SQT._assessAnswer(q, shortResponse);
    const longScore = SQT._assessAnswer(q, longResponse);
    expect(longScore).toBeGreaterThanOrEqual(shortScore);
  });

  test('returns 0 when question has no significant words', () => {
    const q = { text: 'How do you do?', _words: null };
    // All words are <=3 chars except "how" which is 3
    const score = SQT._assessAnswer(q, 'This is a detailed response about everything');
    expect(score).toBe(0);
  });

  test('caches _words on the question object', () => {
    const q = { text: 'What about the database migration strategy?', _words: null };
    SQT._assessAnswer(q, 'database migration is easy');
    expect(q._words).toBeDefined();
    expect(Array.isArray(q._words)).toBe(true);
    expect(q._words.length).toBeGreaterThan(0);
  });
});

/* ===== _processNewMessage ===== */

describe('_processNewMessage', () => {
  test('extracts questions from user messages', () => {
    const el = makeMessageEl('What frameworks should I use for this project?', 'user');
    SQT._processNewMessage(el, 0);
    const questions = SQT._getQuestions();
    expect(questions.length).toBe(1);
    expect(questions[0].askedBy).toBe('user');
    expect(questions[0].answered).toBe(false);
  });

  test('extracts questions from assistant messages', () => {
    const el = makeMessageEl('Would you like me to explain how authentication works?', 'assistant');
    SQT._processNewMessage(el, 0);
    const questions = SQT._getQuestions();
    expect(questions.length).toBe(1);
    expect(questions[0].askedBy).toBe('assistant');
  });

  test('marks questions as answered when response covers them', () => {
    // First add a question
    const userEl = makeMessageEl('What is the best database to use for real-time applications?', 'user');
    SQT._processNewMessage(userEl, 0);
    expect(SQT._getQuestions()[0].answered).toBe(false);

    // Then add a response that answers it
    const assistantEl = makeMessageEl(
      'For real-time applications, the best database choices include PostgreSQL with LISTEN/NOTIFY, Redis for pub/sub, or MongoDB with change streams.',
      'assistant'
    );
    SQT._processNewMessage(assistantEl, 1);
    expect(SQT._getQuestions()[0].answered).toBe(true);
    expect(SQT._getQuestions()[0].confidence).toBeGreaterThan(0);
  });

  test('deduplicates identical questions', () => {
    const el1 = makeMessageEl('What is the best framework to use?', 'user');
    const el2 = makeMessageEl('What is the best framework to use?', 'user');
    SQT._processNewMessage(el1, 0);
    SQT._processNewMessage(el2, 1);
    expect(SQT._getQuestions().length).toBe(1);
  });

  test('deduplication is case-insensitive', () => {
    const el1 = makeMessageEl('What is Python?', 'user');
    const el2 = makeMessageEl('what is python?', 'user');
    SQT._processNewMessage(el1, 0);
    SQT._processNewMessage(el2, 1);
    expect(SQT._getQuestions().length).toBe(1);
  });

  test('ignores elements without user or assistant class', () => {
    const el = document.createElement('div');
    el.classList.add('message');
    el.textContent = 'What is the system prompt?';
    SQT._processNewMessage(el, 0);
    expect(SQT._getQuestions().length).toBe(0);
  });

  test('ignores very short text', () => {
    const el = makeMessageEl('Hi', 'user');
    SQT._processNewMessage(el, 0);
    expect(SQT._getQuestions().length).toBe(0);
  });

  test('assigns incremental IDs', () => {
    const el1 = makeMessageEl('What is TypeScript?', 'user');
    const el2 = makeMessageEl('Where can I learn Rust programming effectively?', 'user');
    SQT._processNewMessage(el1, 0);
    SQT._processNewMessage(el2, 1);
    const qs = SQT._getQuestions();
    expect(qs[0].id).toBe(1);
    expect(qs[1].id).toBe(2);
  });
});

/* ===== markAnswered ===== */

describe('markAnswered', () => {
  test('marks a specific question as answered by ID', () => {
    const el = makeMessageEl('How does garbage collection work in JavaScript?', 'user');
    SQT._processNewMessage(el, 0);
    const qId = SQT._getQuestions()[0].id;
    SQT.markAnswered(qId);
    expect(SQT._getQuestions()[0].answered).toBe(true);
  });
});

/* ===== dismiss ===== */

describe('dismiss', () => {
  test('removes a question by ID', () => {
    const el = makeMessageEl('What programming language should I learn?', 'user');
    SQT._processNewMessage(el, 0);
    const qId = SQT._getQuestions()[0].id;
    SQT.dismiss(qId);
    expect(SQT._getQuestions().length).toBe(0);
  });

  test('does not crash for non-existent ID', () => {
    expect(() => SQT.dismiss(9999)).not.toThrow();
  });
});

/* ===== persistence ===== */

describe('persistence', () => {
  test('save and load round-trips correctly', () => {
    const el = makeMessageEl('What is the recommended architecture for microservices?', 'user');
    SQT._processNewMessage(el, 0);
    SQT._save();

    // Reset and reload
    SQT._resetState();
    expect(SQT._getQuestions().length).toBe(0);

    SQT._load();
    expect(SQT._getQuestions().length).toBe(1);
    expect(SQT._getQuestions()[0].text).toContain('recommended architecture');
  });

  test('load handles missing storage gracefully', () => {
    localStorage.clear();
    expect(() => SQT._load()).not.toThrow();
    expect(SQT._getQuestions().length).toBe(0);
  });

  test('load handles corrupted storage gracefully', () => {
    localStorage.setItem('agenticchat_question_tracker', '{bad json');
    expect(() => SQT._load()).not.toThrow();
  });
});

/* ===== nudge logic ===== */

describe('nudge', () => {
  test('triggers nudge when 3+ unanswered questions accumulate', () => {
    // Add 3 questions to trigger nudge
    SQT._processNewMessage(makeMessageEl('What is the best database for real-time apps?', 'user'), 0);
    SQT._processNewMessage(makeMessageEl('How should I structure the API endpoints?', 'user'), 1);
    SQT._processNewMessage(makeMessageEl('Where should I deploy this application?', 'user'), 2);

    // Nudge should have been created in DOM
    const nudge = document.getElementById('qt-nudge');
    expect(nudge).not.toBeNull();
    expect(nudge.innerHTML).toContain('3 unanswered');
  });

  test('does not trigger nudge with fewer than 3 unanswered', () => {
    SQT._processNewMessage(makeMessageEl('What is TypeScript?', 'user'), 0);
    SQT._processNewMessage(makeMessageEl('Where can I learn it?', 'user'), 1);
    const nudge = document.getElementById('qt-nudge');
    expect(nudge).toBeNull();
  });
});

/* ===== answer detection accuracy ===== */

describe('answer detection with conversation flow', () => {
  test('does not mark question answered by unrelated response', () => {
    SQT._processNewMessage(
      makeMessageEl('What algorithms are used in the recommendation engine?', 'user'), 0
    );
    SQT._processNewMessage(
      makeMessageEl('The weather forecast shows sunny skies for tomorrow.', 'assistant'), 1
    );
    expect(SQT._getQuestions()[0].answered).toBe(false);
  });

  test('tracks multiple questions independently', () => {
    SQT._processNewMessage(
      makeMessageEl('What database should I use for this project?', 'user'), 0
    );
    SQT._processNewMessage(
      makeMessageEl('How should I handle authentication and session management?', 'user'), 1
    );

    // Answer only the first question
    SQT._processNewMessage(
      makeMessageEl('For this project, I recommend PostgreSQL as the database because it handles relational data well and supports JSON.', 'assistant'), 2
    );

    const qs = SQT._getQuestions();
    expect(qs[0].answered).toBe(true);  // database question answered
    expect(qs[1].answered).toBe(false); // auth question still open
  });
});
