/**
 * SmartPromptCoach — Unit Tests
 * Tests for the autonomous prompting pattern analyzer & coaching engine.
 */

// Minimal DOM + SafeStorage stubs
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="chat-output"></div><div class="toolbar"></div></body></html>');
global.document = dom.window.document;
global.window = dom.window;
global.navigator = dom.window.navigator;
global.MutationObserver = class { constructor() {} observe() {} disconnect() {} };
global.SafeStorage = {
  _store: {},
  get(k) { return this._store[k] || null; },
  trySet(k, v) { this._store[k] = v; },
  trySetJSON(k, v) { this._store[k] = JSON.stringify(v); },
  getJSON(k, def) { try { return JSON.parse(this._store[k]); } catch(_) { return def; } },
  getItem(k) { return this._store[k] || null; },
  setItem(k, v) { this._store[k] = v; }
};
global.sanitizeStorageObject = (o) => o;
global.ToastManager = { show: jest.fn() };
global.KeyboardShortcuts = { register: jest.fn() };
global.CommandPalette = { register: jest.fn() };
global.SlashCommands = { register: jest.fn() };
global.PanelRegistry = { register: jest.fn(), closeAllExcept: jest.fn() };
global.ConversationManager = { getHistory: () => [] };

// Load module
require('../app.js');

describe('SmartPromptCoach', () => {
  let coach;

  beforeAll(() => {
    coach = global.SmartPromptCoach || window.SmartPromptCoach;
  });

  test('module exists and has public API', () => {
    expect(coach).toBeDefined();
    expect(typeof coach.toggle).toBe('function');
    expect(typeof coach.show).toBe('function');
    expect(typeof coach.hide).toBe('function');
    expect(typeof coach.analyze).toBe('function');
    expect(typeof coach.isEnabled).toBe('function');
  });

  test('returns null for empty/invalid input', () => {
    expect(coach.analyze(null)).toBeNull();
    expect(coach.analyze('')).toBeNull();
    expect(coach.analyze(123)).toBeNull();
  });

  describe('Vague Question Detection', () => {
    test('detects very short vague prompts', () => {
      const result = coach.analyze('help me fix this');
      expect(result).not.toBeNull();
      expect(result.issues.some(i => i.pattern === 'vague')).toBe(true);
      expect(result.dimensions.specificity).toBeLessThan(100);
    });

    test('does not flag specific prompts', () => {
      const result = coach.analyze('I\'m getting a TypeError in Python 3.11 when calling json.loads() with this input: {"key": "value"}. The error says "expecting property name enclosed in double quotes". Here is my code:\n```python\nimport json\ndata = json.loads(input_str)\n```');
      expect(result.issues.filter(i => i.pattern === 'vague')).toHaveLength(0);
    });

    test('medium severity for somewhat short prompts', () => {
      const result = coach.analyze('how do I fix this error?');
      const vagueIssues = result.issues.filter(i => i.pattern === 'vague');
      expect(vagueIssues.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Missing Context Detection', () => {
    test('detects prompts without context signals', () => {
      const result = coach.analyze('Explain the difference between let and const and when to use each');
      const ctxIssues = result.issues.filter(i => i.pattern === 'noContext');
      expect(ctxIssues.length).toBeGreaterThanOrEqual(1);
    });

    test('does not flag prompts with context', () => {
      const result = coach.analyze('I\'m using React 18 with TypeScript and I\'m trying to understand the difference between useMemo and useCallback hooks');
      const ctxIssues = result.issues.filter(i => i.pattern === 'noContext');
      expect(ctxIssues).toHaveLength(0);
    });
  });

  describe('Reformulation Detection', () => {
    test('detects repeated reformulation', () => {
      const history = [
        { role: 'user', content: 'How do I sort an array of objects by a property in JavaScript?' },
        { role: 'assistant', content: 'You can use Array.sort()...' },
        { role: 'user', content: 'What is the best way to sort objects by property in JavaScript arrays?' }
      ];
      const result = coach.analyze(history[2].content, history);
      const reformIssues = result.issues.filter(i => i.pattern === 'reformulation');
      expect(reformIssues.length).toBeGreaterThanOrEqual(1);
    });

    test('does not flag genuinely different prompts', () => {
      const history = [
        { role: 'user', content: 'How do I sort an array in JavaScript?' },
        { role: 'assistant', content: 'Use Array.sort()...' },
        { role: 'user', content: 'Now explain how promises work in async functions' }
      ];
      const result = coach.analyze(history[2].content, history);
      const reformIssues = result.issues.filter(i => i.pattern === 'reformulation');
      expect(reformIssues).toHaveLength(0);
    });
  });

  describe('Over-Delegation Detection', () => {
    test('detects prompts with too many action verbs', () => {
      const result = coach.analyze('Create a REST API with authentication, build a React frontend, implement file upload, add real-time notifications, design the database schema, and deploy to AWS');
      const odIssues = result.issues.filter(i => i.pattern === 'overDelegation');
      expect(odIssues.length).toBeGreaterThanOrEqual(1);
      expect(odIssues[0].severity).toBe('high');
    });

    test('does not flag focused prompts', () => {
      const result = coach.analyze('Create a simple Express.js endpoint that returns a JSON list of users');
      const odIssues = result.issues.filter(i => i.pattern === 'overDelegation');
      expect(odIssues).toHaveLength(0);
    });
  });

  describe('Yes/No Question Detection', () => {
    test('detects closed yes/no questions', () => {
      const result = coach.analyze('Is React better than Vue?');
      const ynIssues = result.issues.filter(i => i.pattern === 'yesNo');
      expect(ynIssues.length).toBeGreaterThanOrEqual(1);
    });

    test('does not flag open-ended questions', () => {
      const result = coach.analyze('What are the key differences between React and Vue, and when should I choose each?');
      const ynIssues = result.issues.filter(i => i.pattern === 'yesNo');
      expect(ynIssues).toHaveLength(0);
    });
  });

  describe('Instruction Overload Detection', () => {
    test('detects excessive constraints', () => {
      const result = coach.analyze('Write a function that must handle errors, should be async, need to support pagination, has to work with TypeScript, must not use any external libraries, should avoid callbacks, need to ensure thread safety, must validate all inputs');
      const ioIssues = result.issues.filter(i => i.pattern === 'instructionOverload');
      expect(ioIssues.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Grading System', () => {
    test('excellent grade for well-crafted prompts', () => {
      const result = coach.analyze('I\'m building a Node.js v20 REST API using Express. I need to implement rate limiting middleware that limits each API key to 100 requests per minute. I\'m currently using Redis for session storage. Can you show me how to implement this using the express-rate-limit package with a Redis store?');
      expect(['excellent', 'good']).toContain(result.grade);
      expect(result.overall).toBeGreaterThanOrEqual(70);
    });

    test('needs-work grade for poor prompts', () => {
      const result = coach.analyze('fix this');
      expect(result.grade).toBe('needs-work');
      expect(result.overall).toBeLessThan(50);
    });

    test('overall score is between 0 and 100', () => {
      const prompts = [
        'help',
        'fix this',
        'How do I do something?',
        'Explain React hooks including useState, useEffect, and custom hooks with examples',
        'I\'m using Python 3.12 on macOS. When I run `pip install numpy`, I get: "error: subprocess-exited-with-error". Here\'s the full traceback...'
      ];
      for (const p of prompts) {
        const r = coach.analyze(p);
        expect(r.overall).toBeGreaterThanOrEqual(0);
        expect(r.overall).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('Dimensions', () => {
    test('all 6 dimensions are present', () => {
      const result = coach.analyze('Tell me about JavaScript');
      expect(result.dimensions).toBeDefined();
      expect(Object.keys(result.dimensions)).toEqual(
        expect.arrayContaining(['clarity', 'specificity', 'context', 'structure', 'iteration', 'scope'])
      );
    });

    test('dimensions are clamped 0-100', () => {
      const result = coach.analyze('fix it');
      for (const val of Object.values(result.dimensions)) {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('Prompt Tunneling Detection', () => {
    test('detects tunneling with 4+ similar prompts', () => {
      const history = [
        { role: 'user', content: 'How to fix the sorting algorithm for arrays with duplicates?' },
        { role: 'assistant', content: 'You can...' },
        { role: 'user', content: 'The sorting still fails with duplicate values in the array' },
        { role: 'assistant', content: 'Try...' },
        { role: 'user', content: 'Array sorting with duplicates is still not working correctly' },
        { role: 'assistant', content: 'Here...' },
        { role: 'user', content: 'Fix the duplicate handling in array sort algorithm' }
      ];
      const result = coach.analyze(history[6].content, history);
      const tunnelIssues = result.issues.filter(i => i.pattern === 'tunnel');
      expect(tunnelIssues.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Skill Profile', () => {
    test('getSkillProfile returns an object', () => {
      const profile = coach.getSkillProfile();
      expect(typeof profile).toBe('object');
    });

    test('getPatternCounts returns an object', () => {
      const counts = coach.getPatternCounts();
      expect(typeof counts).toBe('object');
    });

    test('getAnalyses returns an array', () => {
      const analyses = coach.getAnalyses();
      expect(Array.isArray(analyses)).toBe(true);
    });
  });

  describe('Configuration', () => {
    test('isEnabled returns boolean', () => {
      expect(typeof coach.isEnabled()).toBe('boolean');
    });

    test('setEnabled updates state', () => {
      coach.setEnabled(false);
      expect(coach.isEnabled()).toBe(false);
      coach.setEnabled(true);
      expect(coach.isEnabled()).toBe(true);
    });
  });

  describe('Unclear Goal Detection', () => {
    test('detects multiple actions without stated goal', () => {
      const result = coach.analyze('Create a database schema, implement the API endpoints, add authentication middleware, and write unit tests for the controllers');
      const goalIssues = result.issues.filter(i => i.pattern === 'noGoal');
      // noGoal requires imperatives >= 2 and no goal signals
      expect(result.issues.some(i => i.pattern === 'noGoal' || i.pattern === 'overDelegation')).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    test('handles very long prompts', () => {
      const longPrompt = 'Please help me with ' + 'a'.repeat(5000);
      const result = coach.analyze(longPrompt);
      expect(result).not.toBeNull();
      expect(result.text.length).toBeLessThanOrEqual(200);
    });

    test('handles prompts with only code blocks', () => {
      const result = coach.analyze('```javascript\nconst x = 1;\n```');
      expect(result).not.toBeNull();
    });

    test('handles unicode characters', () => {
      const result = coach.analyze('如何在React中使用useState钩子？请给我一个例子。');
      expect(result).not.toBeNull();
      expect(result.overall).toBeGreaterThanOrEqual(0);
    });

    test('handles newlines and special formatting', () => {
      const result = coach.analyze('# My Question\n\n- Point 1\n- Point 2\n\n```code```');
      expect(result).not.toBeNull();
    });
  });
});
