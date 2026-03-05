/**
 * Tests for ConversationSummarizer module.
 */
const { setupDOM, loadApp } = require('./setup');

beforeAll(() => {
  setupDOM();
  loadApp();
});

/* ── Topic Extraction ── */

describe('ConversationSummarizer — Topic Extraction', () => {
  test('extracts frequent words as topics', () => {
    const topics = ConversationSummarizer._extractTopics(
      'javascript javascript python python python react react',
    );
    expect(topics.length).toBeGreaterThanOrEqual(2);
    expect(topics[0].word).toBe('python');
    expect(topics[0].count).toBe(3);
    expect(topics[1].word).toBe('javascript');
  });

  test('filters out stop words', () => {
    const topics = ConversationSummarizer._extractTopics(
      'the the the and and and react react',
    );
    const words = topics.map(t => t.word);
    expect(words).not.toContain('the');
    expect(words).not.toContain('and');
    expect(words).toContain('react');
  });

  test('filters out short words (< 3 chars)', () => {
    const topics = ConversationSummarizer._extractTopics('go go go api api api');
    const words = topics.map(t => t.word);
    expect(words).not.toContain('go');
    expect(words).toContain('api');
  });

  test('requires minimum frequency of 2', () => {
    const topics = ConversationSummarizer._extractTopics('unique rare singular');
    expect(topics.length).toBe(0);
  });

  test('respects maxTopics limit', () => {
    const text = Array.from({ length: 20 }, (_, i) => `topic${i} topic${i}`).join(' ');
    const topics = ConversationSummarizer._extractTopics(text, 5);
    expect(topics.length).toBe(5);
  });

  test('returns empty array for empty text', () => {
    expect(ConversationSummarizer._extractTopics('')).toEqual([]);
  });
});

/* ── Question Extraction ── */

describe('ConversationSummarizer — Question Extraction', () => {
  test('extracts lines ending with ?', () => {
    const messages = [
      { role: 'user', content: 'How does async/await work in JavaScript?' },
      { role: 'assistant', content: 'Async/await is syntactic sugar over promises.' },
    ];
    const questions = ConversationSummarizer._extractQuestions(messages);
    expect(questions.length).toBe(1);
    expect(questions[0].role).toBe('user');
    expect(questions[0].text).toContain('async/await');
  });

  test('extracts multiple questions from multiline content', () => {
    const messages = [
      { role: 'user', content: 'What is React?\nWhy should I use it?\nThanks.' },
    ];
    const questions = ConversationSummarizer._extractQuestions(messages);
    expect(questions.length).toBe(2);
  });

  test('ignores very short questions (<=5 chars)', () => {
    const messages = [{ role: 'user', content: 'Huh?\nOk?' }];
    const questions = ConversationSummarizer._extractQuestions(messages);
    expect(questions.length).toBe(0);
  });

  test('strips markdown formatting from questions', () => {
    const messages = [
      { role: 'user', content: '### What is **functional programming**?' },
    ];
    const questions = ConversationSummarizer._extractQuestions(messages);
    expect(questions[0].text).not.toContain('#');
    expect(questions[0].text).not.toContain('*');
  });

  test('limits to 20 questions', () => {
    const messages = [
      {
        role: 'user',
        content: Array.from({ length: 25 }, (_, i) => `What is concept number ${i}?`).join('\n'),
      },
    ];
    const questions = ConversationSummarizer._extractQuestions(messages);
    expect(questions.length).toBe(20);
  });
});

/* ── Code Block Extraction ── */

describe('ConversationSummarizer — Code Block Extraction', () => {
  test('extracts code blocks with language', () => {
    const messages = [
      {
        role: 'assistant',
        content: 'Here is code:\n```python\nprint("hello")\nprint("world")\n```',
      },
    ];
    const blocks = ConversationSummarizer._extractCodeBlocks(messages);
    expect(blocks.length).toBe(1);
    expect(blocks[0].language).toBe('python');
    expect(blocks[0].lines).toBe(2);
    expect(blocks[0].role).toBe('assistant');
    expect(blocks[0].preview).toContain('print');
  });

  test('defaults language to "text" when unspecified', () => {
    const messages = [
      { role: 'assistant', content: '```\nsome code\n```' },
    ];
    const blocks = ConversationSummarizer._extractCodeBlocks(messages);
    expect(blocks[0].language).toBe('text');
  });

  test('extracts multiple code blocks', () => {
    const messages = [
      {
        role: 'assistant',
        content: '```js\nconst x = 1;\n```\nAnd also:\n```css\n.foo { color: red; }\n```',
      },
    ];
    const blocks = ConversationSummarizer._extractCodeBlocks(messages);
    expect(blocks.length).toBe(2);
    expect(blocks[0].language).toBe('js');
    expect(blocks[1].language).toBe('css');
  });

  test('returns empty array when no code blocks', () => {
    const messages = [{ role: 'user', content: 'No code here.' }];
    expect(ConversationSummarizer._extractCodeBlocks(messages)).toEqual([]);
  });
});

/* ── Decision Extraction ── */

describe('ConversationSummarizer — Decision Extraction', () => {
  test('detects "let\'s use" pattern', () => {
    const messages = [
      { role: 'assistant', content: "Let's use React for the frontend. It has great ecosystem support." },
    ];
    const decisions = ConversationSummarizer._extractDecisions(messages);
    expect(decisions.length).toBeGreaterThanOrEqual(1);
    expect(decisions[0].text).toContain('React');
  });

  test('detects "decided" pattern', () => {
    const messages = [
      { role: 'user', content: 'We decided to go with PostgreSQL for the database.' },
    ];
    const decisions = ConversationSummarizer._extractDecisions(messages);
    expect(decisions.length).toBeGreaterThanOrEqual(1);
  });

  test('detects "best approach" pattern', () => {
    const messages = [
      { role: 'assistant', content: 'The best approach is to use a microservices architecture for scalability.' },
    ];
    const decisions = ConversationSummarizer._extractDecisions(messages);
    expect(decisions.length).toBeGreaterThanOrEqual(1);
  });

  test('ignores code blocks when extracting decisions', () => {
    const messages = [
      { role: 'assistant', content: '```\nlet\'s use something\n```\nPlain text here.' },
    ];
    const decisions = ConversationSummarizer._extractDecisions(messages);
    // Should not match the code block content
    const hasCodeMatch = decisions.some(d => d.text.includes('```'));
    expect(hasCodeMatch).toBe(false);
  });

  test('limits to 10 decisions', () => {
    const messages = [
      {
        role: 'assistant',
        content: Array.from({ length: 15 }, (_, i) =>
          `We decided to implement feature ${i} for better performance.`
        ).join('\n'),
      },
    ];
    const decisions = ConversationSummarizer._extractDecisions(messages);
    expect(decisions.length).toBeLessThanOrEqual(10);
  });
});

/* ── Action Item Extraction ── */

describe('ConversationSummarizer — Action Item Extraction', () => {
  test('detects "need to" pattern', () => {
    const messages = [
      { role: 'assistant', content: 'We need to update the dependencies before deploying.' },
    ];
    const items = ConversationSummarizer._extractActionItems(messages);
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].text).toContain('update');
  });

  test('detects "todo" pattern', () => {
    const messages = [
      { role: 'user', content: 'TODO: Add unit tests for the new module.' },
    ];
    const items = ConversationSummarizer._extractActionItems(messages);
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  test('detects "don\'t forget to" pattern', () => {
    const messages = [
      { role: 'assistant', content: "Don't forget to update the README with the new API endpoints." },
    ];
    const items = ConversationSummarizer._extractActionItems(messages);
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  test('deduplicates similar action items', () => {
    const messages = [
      { role: 'user', content: 'We need to update the tests.\nWe need to update the tests.' },
    ];
    const items = ConversationSummarizer._extractActionItems(messages);
    // Should deduplicate identical text
    expect(items.length).toBe(1);
  });

  test('limits to 15 action items', () => {
    const messages = [
      {
        role: 'assistant',
        content: Array.from({ length: 20 }, (_, i) =>
          `Step ${i + 1}: Do unique task number ${i} right now`
        ).join('\n'),
      },
    ];
    const items = ConversationSummarizer._extractActionItems(messages);
    expect(items.length).toBeLessThanOrEqual(15);
  });
});

/* ── Statistics ── */

describe('ConversationSummarizer — Statistics', () => {
  test('computes basic stats', () => {
    const messages = [
      { role: 'user', content: 'Hello world' },
      { role: 'assistant', content: 'Hi there how are you doing today' },
    ];
    const stats = ConversationSummarizer._computeStats(messages);
    expect(stats.totalMessages).toBe(2);
    expect(stats.userMessages).toBe(1);
    expect(stats.assistantMessages).toBe(1);
    expect(stats.userWords).toBe(2);
    expect(stats.assistantWords).toBe(7);
    expect(stats.totalWords).toBe(9);
    expect(stats.codeBlocks).toBe(0);
    expect(stats.readingTimeMin).toBeGreaterThanOrEqual(1);
  });

  test('counts code blocks', () => {
    const messages = [
      { role: 'assistant', content: '```js\ncode\n```\nAnd more:\n```python\ncode\n```' },
    ];
    const stats = ConversationSummarizer._computeStats(messages);
    expect(stats.codeBlocks).toBe(2);
  });

  test('handles empty messages', () => {
    const stats = ConversationSummarizer._computeStats([]);
    expect(stats.totalMessages).toBe(0);
    expect(stats.totalWords).toBe(0);
    expect(stats.avgWordsPerMessage).toBe(0);
  });

  test('calculates longest message', () => {
    const messages = [
      { role: 'user', content: 'short' },
      { role: 'assistant', content: 'this is a much longer message with more words in it' },
      { role: 'user', content: 'medium length message' },
    ];
    const stats = ConversationSummarizer._computeStats(messages);
    expect(stats.longestMessage).toBe(11); // the long message
  });
});

/* ── Full Summary Generation ── */

describe('ConversationSummarizer — Full Summary', () => {
  beforeEach(() => {
    // Clear conversation
    ConversationManager.clear();
  });

  test('returns null for empty conversation', () => {
    const summary = ConversationSummarizer.generateSummary();
    expect(summary).toBeNull();
  });

  test('generates summary with all sections', () => {
    ConversationManager.addMessage('user', 'How does React handle state management?');
    ConversationManager.addMessage('assistant',
      "React handles state through hooks like useState and useReducer. " +
      "Let's use Redux for complex state. " +
      "```javascript\nconst [count, setCount] = useState(0);\n```\n" +
      "Don't forget to install the redux package."
    );
    ConversationManager.addMessage('user', 'What about context API?');

    const summary = ConversationSummarizer.generateSummary();
    expect(summary).not.toBeNull();
    expect(summary.topics.length).toBeGreaterThan(0);
    expect(summary.questions.length).toBeGreaterThanOrEqual(2);
    expect(summary.codeBlocks.length).toBe(1);
    expect(summary.stats.totalMessages).toBe(3);
  });

  test('getSummaryText returns markdown', () => {
    ConversationManager.addMessage('user', 'What is TypeScript?');
    ConversationManager.addMessage('assistant', 'TypeScript is a typed superset of JavaScript.');
    ConversationSummarizer.generateSummary();

    const text = ConversationSummarizer.getSummaryText();
    expect(text).toContain('# Conversation Summary');
    expect(text).toContain('## Overview');
    expect(text).toContain('Messages');
  });

  test('exportSummary with json format', () => {
    ConversationManager.addMessage('user', 'Hello there');
    ConversationManager.addMessage('assistant', 'Hi! How can I help?');
    ConversationSummarizer.generateSummary();

    const json = ConversationSummarizer.exportSummary('json');
    const parsed = JSON.parse(json);
    expect(parsed.stats).toBeDefined();
    expect(parsed.topics).toBeDefined();
    expect(parsed.generatedAt).toBeDefined();
  });

  test('exportSummary with markdown format', () => {
    ConversationManager.addMessage('user', 'Hello there');
    ConversationSummarizer.generateSummary();

    const md = ConversationSummarizer.exportSummary('markdown');
    expect(md).toContain('# Conversation Summary');
  });
});

/* ── Getter Methods ── */

describe('ConversationSummarizer — Getters', () => {
  beforeEach(() => {
    ConversationManager.clear();
  });

  test('getTopics auto-generates summary if needed', () => {
    ConversationManager.addMessage('user', 'react react react');
    ConversationManager.addMessage('assistant', 'react react component component');
    // Force lastSummary to null via new generation
    const topics = ConversationSummarizer.getTopics();
    expect(Array.isArray(topics)).toBe(true);
  });

  test('getStats returns stats object', () => {
    ConversationManager.addMessage('user', 'Hello');
    const stats = ConversationSummarizer.getStats();
    expect(stats).toBeDefined();
    expect(stats.totalMessages).toBeGreaterThan(0);
  });

  test('getQuestions returns array', () => {
    ConversationManager.addMessage('user', 'What time is it right now?');
    ConversationSummarizer.generateSummary();
    const questions = ConversationSummarizer.getQuestions();
    expect(Array.isArray(questions)).toBe(true);
    expect(questions.length).toBeGreaterThan(0);
  });

  test('getDecisions returns array', () => {
    ConversationManager.addMessage('assistant', "The best solution is to use caching for performance.");
    ConversationSummarizer.generateSummary();
    const decisions = ConversationSummarizer.getDecisions();
    expect(Array.isArray(decisions)).toBe(true);
  });

  test('getActionItems returns array', () => {
    ConversationManager.addMessage('assistant', 'You need to update the config file first.');
    ConversationSummarizer.generateSummary();
    const items = ConversationSummarizer.getActionItems();
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
  });

  test('getCodeBlocks returns array', () => {
    ConversationManager.addMessage('assistant', '```python\nprint("hi")\n```');
    ConversationSummarizer.generateSummary();
    const blocks = ConversationSummarizer.getCodeBlocks();
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks.length).toBe(1);
  });
});

/* ── Panel UI ── */

describe('ConversationSummarizer — Panel UI', () => {
  beforeEach(() => {
    ConversationManager.clear();
    ConversationSummarizer.closePanel();
  });

  test('init does not throw', () => {
    expect(() => ConversationSummarizer.init()).not.toThrow();
  });

  test('openPanel creates panel DOM', () => {
    ConversationManager.addMessage('user', 'Test message');
    ConversationSummarizer.openPanel();
    expect(document.getElementById('summary-panel')).not.toBeNull();
    expect(document.getElementById('summary-overlay')).not.toBeNull();
    expect(document.getElementById('summary-panel').classList.contains('sum-open')).toBe(true);
  });

  test('closePanel hides panel', () => {
    ConversationSummarizer.openPanel();
    ConversationSummarizer.closePanel();
    const panel = document.getElementById('summary-panel');
    if (panel) {
      expect(panel.classList.contains('sum-open')).toBe(false);
    }
  });

  test('togglePanel opens and closes', () => {
    ConversationManager.addMessage('user', 'Test');
    ConversationSummarizer.togglePanel();
    expect(document.getElementById('summary-panel').classList.contains('sum-open')).toBe(true);
    ConversationSummarizer.togglePanel();
    expect(document.getElementById('summary-panel').classList.contains('sum-open')).toBe(false);
  });

  test('panel shows empty state for no conversation', () => {
    ConversationSummarizer.openPanel();
    const body = document.getElementById('summary-body');
    expect(body.textContent).toContain('Start a conversation');
  });
});
