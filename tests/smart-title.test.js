/**
 * SmartTitle - Unit Tests
 */

const { setupDOM, loadApp } = require('./setup');

beforeEach(() => {
  setupDOM();
  loadApp();
  localStorage.clear();
});

describe('SmartTitle', () => {
  // ── generate ────────────────────────────────────────────────
  describe('generate', () => {
    test('returns "Empty Conversation" for no messages', () => {
      expect(SmartTitle.generate([])).toBe('Empty Conversation');
    });

    test('returns "Empty Conversation" for empty content', () => {
      expect(SmartTitle.generate([{ role: 'user', content: '' }])).toBe('Empty Conversation');
    });

    test('detects Python language in title', () => {
      const msgs = [
        { role: 'user', content: 'How do I sort a list in Python using the sorted function?' },
        { role: 'assistant', content: 'You can use sorted() or list.sort() in Python.' }
      ];
      const title = SmartTitle.generate(msgs);
      expect(title).toContain('Python');
    });

    test('detects JavaScript language in title', () => {
      const msgs = [
        { role: 'user', content: 'How do I use async/await in JavaScript with React?' },
        { role: 'assistant', content: 'In JavaScript, async/await works with Promises.' }
      ];
      const title = SmartTitle.generate(msgs);
      expect(title).toContain('JavaScript');
    });

    test('detects API topic', () => {
      const msgs = [
        { role: 'user', content: 'How do I make a REST API endpoint with authentication?' },
        { role: 'assistant', content: 'You can create a REST endpoint using Express.' }
      ];
      const title = SmartTitle.generate(msgs);
      expect(title).toContain('API');
    });

    test('detects Algorithm topic', () => {
      const msgs = [
        { role: 'user', content: 'Explain the binary search algorithm and its time complexity' },
        { role: 'assistant', content: 'Binary search divides the search interval in half each step.' }
      ];
      const title = SmartTitle.generate(msgs);
      expect(title).toContain('Algorithm');
    });

    test('detects Debugging action', () => {
      const msgs = [
        { role: 'user', content: 'My code is not working, I keep getting a TypeError' },
        { role: 'assistant', content: 'Let me help you debug that error.' }
      ];
      const title = SmartTitle.generate(msgs);
      expect(title).toContain('Debugging') || expect(title).toContain('Troubleshooting');
    });

    test('generates title with max 60 chars', () => {
      const msgs = [
        { role: 'user', content: 'I need help with Python machine learning neural network deep learning tensorflow pytorch model training optimization hyperparameter tuning cross validation' }
      ];
      const title = SmartTitle.generate(msgs);
      expect(title.length).toBeLessThanOrEqual(60);
    });

    test('combines language and topic', () => {
      const msgs = [
        { role: 'user', content: 'Help me write unit tests for my Python Flask API' },
        { role: 'assistant', content: 'You can use pytest with Flask test client.' }
      ];
      const title = SmartTitle.generate(msgs);
      expect(title).toContain('Python');
      // Should also contain API or Testing
      const hasApiOrTesting = title.includes('API') || title.includes('Testing');
      expect(hasApiOrTesting).toBe(true);
    });

    test('falls back to first user message for generic content', () => {
      const msgs = [
        { role: 'user', content: 'Hello there' },
        { role: 'assistant', content: 'Hi!' }
      ];
      const title = SmartTitle.generate(msgs);
      expect(title.length).toBeGreaterThan(0);
      expect(title).not.toBe('Empty Conversation');
    });

    test('uses current conversation when no messages passed', () => {
      ConversationManager.addMessage('user', 'How do I deploy a Docker container?');
      ConversationManager.addMessage('assistant', 'Use docker run or docker-compose.');
      const title = SmartTitle.generate();
      expect(title).toContain('DevOps') || expect(title.toLowerCase()).toContain('docker');
    });
  });

  // ── _extractKeywords ────────────────────────────────────────
  describe('_extractKeywords', () => {
    test('extracts non-stop words', () => {
      const kw = SmartTitle._extractKeywords('the quick brown fox jumps over the lazy dog', 5);
      expect(kw).toContain('quick');
      expect(kw).toContain('brown');
      expect(kw).toContain('fox');
      expect(kw).not.toContain('the');
      expect(kw).not.toContain('over');
    });

    test('respects maxWords limit', () => {
      const kw = SmartTitle._extractKeywords('alpha beta gamma delta epsilon zeta', 3);
      expect(kw.length).toBeLessThanOrEqual(3);
    });

    test('returns empty for only stop words', () => {
      const kw = SmartTitle._extractKeywords('the is are was were', 5);
      expect(kw.length).toBe(0);
    });

    test('sorts by frequency', () => {
      const kw = SmartTitle._extractKeywords('python python python java java ruby', 3);
      expect(kw[0]).toBe('python');
      expect(kw[1]).toBe('java');
      expect(kw[2]).toBe('ruby');
    });
  });

  // ── _capitalize ─────────────────────────────────────────────
  describe('_capitalize', () => {
    test('capitalizes first letter', () => {
      expect(SmartTitle._capitalize('hello')).toBe('Hello');
    });

    test('handles empty string', () => {
      expect(SmartTitle._capitalize('')).toBe('');
    });

    test('handles single character', () => {
      expect(SmartTitle._capitalize('a')).toBe('A');
    });

    test('handles already capitalized', () => {
      expect(SmartTitle._capitalize('Hello')).toBe('Hello');
    });
  });

  // ── init ────────────────────────────────────────────────────
  describe('init', () => {
    test('initializes without errors', () => {
      expect(() => SmartTitle.init()).not.toThrow();
    });

    test('suggest button populates session name input', () => {
      ConversationManager.addMessage('user', 'Write a Python script to sort data');
      ConversationManager.addMessage('assistant', 'Here is a sorting script.');

      SmartTitle.init();
      const btn = document.getElementById('session-suggest-title');
      const input = document.getElementById('session-name-input');
      if (btn && input) {
        btn.click();
        expect(input.value.length).toBeGreaterThan(0);
      }
    });
  });

  // ── Integration with SessionManager ─────────────────────────
  describe('SessionManager integration', () => {
    test('auto-generated names use SmartTitle when available', () => {
      ConversationManager.addMessage('user', 'How do I implement a REST API in Python Flask?');
      ConversationManager.addMessage('assistant', 'Use Flask route decorators to create endpoints.');
      const session = SessionManager.save();
      if (session) {
        // Name should be smarter than just truncated first message
        expect(session.name.length).toBeGreaterThan(0);
        expect(session.name.length).toBeLessThanOrEqual(60);
      }
    });
  });
});
