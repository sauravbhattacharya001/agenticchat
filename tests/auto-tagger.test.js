/**
 * AutoTagger tests — heuristic topic detection and tag suggestion
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

let dom, cleanup;

function setup() {
  dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.HTMLElement = dom.window.HTMLElement;
  global.navigator = dom.window.navigator;
  global.alert = () => {};
  global.confirm = () => true;
  global.prompt = () => null;
  global.crypto = {
    randomUUID: () =>
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      }),
    getRandomValues: (arr) => {
      for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
      return arr;
    },
  };
  global.MutationObserver = class { observe() {} disconnect() {} };
  global.IntersectionObserver = class { observe() {} disconnect() {} };
  global.matchMedia = () => ({ matches: false, addEventListener: () => {} });

  const { setupDOM, loadApp } = require('./setup');
  setupDOM();
  loadApp();

  cleanup = () => {
    delete global.window;
    delete global.document;
    delete global.localStorage;
    delete global.HTMLElement;
    delete global.navigator;
    delete global.alert;
    delete global.confirm;
    delete global.prompt;
    delete global.crypto;
    delete global.MutationObserver;
    delete global.IntersectionObserver;
    delete global.matchMedia;
    // Clear require cache so each top-level describe starts fresh
    delete require.cache[require.resolve('./setup')];
  };
}

// ── Tokenizer tests ────────────────────────────────────────────

describe('AutoTagger._tokenize', () => {
  beforeEach(() => setup());
  afterEach(() => cleanup());

  it('lowercases and splits words', () => {
    const tokens = AutoTagger._tokenize('Hello World Foo');
    assert.ok(tokens.includes('hello'));
    assert.ok(tokens.includes('world'));
    assert.ok(tokens.includes('foo'));
  });

  it('removes code blocks', () => {
    const tokens = AutoTagger._tokenize('Look at this:\n```javascript\nconst x = 1;\n```\nNeat!');
    assert.ok(!tokens.includes('const'));
    assert.ok(tokens.includes('look'));
    assert.ok(tokens.includes('neat'));
  });

  it('removes inline code', () => {
    const tokens = AutoTagger._tokenize('Use the `forEach` method');
    assert.ok(!tokens.includes('foreach'));
    assert.ok(tokens.includes('use'));
    assert.ok(tokens.includes('method'));
  });

  it('removes URLs', () => {
    const tokens = AutoTagger._tokenize('Check https://example.com/path for more info');
    assert.ok(!tokens.includes('example'));
    assert.ok(!tokens.includes('https'));
    assert.ok(tokens.includes('check'));
    assert.ok(tokens.includes('more'));
    assert.ok(tokens.includes('info'));
  });

  it('filters short words (length <= 2)', () => {
    const tokens = AutoTagger._tokenize('I am on it');
    assert.ok(!tokens.includes('i'));
    assert.ok(!tokens.includes('am'));
    assert.ok(!tokens.includes('on'));
    assert.ok(!tokens.includes('it'));
  });
});

// ── Frequency map tests ────────────────────────────────────────

describe('AutoTagger._buildFrequencyMap', () => {
  beforeEach(() => setup());
  afterEach(() => cleanup());

  it('counts word frequency across messages', () => {
    const messages = [
      { role: 'user', content: 'python python python' },
      { role: 'assistant', content: 'python code' },
    ];
    const { wordFreq } = AutoTagger._buildFrequencyMap(messages);
    assert.equal(wordFreq['python'], 4);
  });

  it('skips system messages', () => {
    const messages = [
      { role: 'system', content: 'python python python secret' },
      { role: 'user', content: 'hello there friend' },
    ];
    const { wordFreq, messageCount } = AutoTagger._buildFrequencyMap(messages);
    assert.equal(wordFreq['secret'], undefined);
    assert.equal(messageCount, 1);
  });

  it('filters stop words', () => {
    const messages = [
      { role: 'user', content: 'the quick brown fox' },
    ];
    const { wordFreq } = AutoTagger._buildFrequencyMap(messages);
    assert.equal(wordFreq['the'], undefined);
    assert.ok(wordFreq['quick'] >= 1);
    assert.ok(wordFreq['brown'] >= 1);
    assert.ok(wordFreq['fox'] >= 1);
  });

  it('handles empty messages', () => {
    const { wordFreq, totalWords, messageCount } = AutoTagger._buildFrequencyMap([]);
    assert.deepEqual(wordFreq, Object.create(null));
    assert.equal(totalWords, 0);
    assert.equal(messageCount, 0);
  });
});

// ── Category scoring tests ──────────────────────────────────────

describe('AutoTagger._scoreCategories', () => {
  beforeEach(() => setup());
  afterEach(() => cleanup());

  it('detects coding category from relevant keywords', () => {
    const messages = [
      { role: 'user', content: 'Write a function to parse JSON and handle the api endpoint' },
      { role: 'assistant', content: 'Here is a function that handles the api request and response with proper error handling and debugging' },
      { role: 'user', content: 'Can you refactor this to use async await with promise handling and fix the bug in the compile step' },
    ];
    const freqData = AutoTagger._buildFrequencyMap(messages);
    const combined = messages.map(m => m.content.toLowerCase()).join(' ');
    const results = AutoTagger._scoreCategories(freqData, combined);
    assert.ok(results.length > 0);
    assert.equal(results[0].tag, 'coding');
  });

  it('detects AI/ML category', () => {
    const messages = [
      { role: 'user', content: 'Explain how transformer neural network models work for deep learning' },
      { role: 'assistant', content: 'Transformers use attention mechanisms for training language models with embeddings and tokens' },
      { role: 'user', content: 'How do I fine-tune a GPT model with my dataset for better inference results' },
    ];
    const freqData = AutoTagger._buildFrequencyMap(messages);
    const combined = messages.map(m => m.content.toLowerCase()).join(' ');
    const results = AutoTagger._scoreCategories(freqData, combined);
    assert.ok(results.length > 0);
    const aiTag = results.find(r => r.tag === 'ai/ml');
    assert.ok(aiTag, 'Should detect AI/ML category');
  });

  it('detects writing category', () => {
    const messages = [
      { role: 'user', content: 'Help me write an essay with a strong thesis and introduction paragraph' },
      { role: 'assistant', content: 'Let me proofread your draft and suggest edits for the tone and grammar' },
      { role: 'user', content: 'Can you rewrite the conclusion to be more persuasive with better narrative style' },
    ];
    const freqData = AutoTagger._buildFrequencyMap(messages);
    const combined = messages.map(m => m.content.toLowerCase()).join(' ');
    const results = AutoTagger._scoreCategories(freqData, combined);
    assert.ok(results.length > 0);
    const writingTag = results.find(r => r.tag === 'writing');
    assert.ok(writingTag, 'Should detect writing category');
  });

  it('requires at least 2 indicator words', () => {
    const messages = [
      { role: 'user', content: 'function function function function function' },
    ];
    const freqData = AutoTagger._buildFrequencyMap(messages);
    const combined = messages.map(m => m.content.toLowerCase()).join(' ');
    const results = AutoTagger._scoreCategories(freqData, combined);
    // Only one unique keyword — should not match
    const coding = results.find(r => r.tag === 'coding');
    // `function` counts as 1 unique indicator, needs >= 2
    assert.ok(!coding || coding.matches >= 2, 'Should require 2+ unique indicators');
  });

  it('detects security category', () => {
    const messages = [
      { role: 'user', content: 'How do I prevent XSS and CSRF attacks on my authentication system' },
      { role: 'assistant', content: 'You need proper input sanitization, encryption, and JWT token security with HTTPS and CORS headers' },
    ];
    const freqData = AutoTagger._buildFrequencyMap(messages);
    const combined = messages.map(m => m.content.toLowerCase()).join(' ');
    const results = AutoTagger._scoreCategories(freqData, combined);
    const secTag = results.find(r => r.tag === 'security');
    assert.ok(secTag, 'Should detect security category');
  });
});

// ── Keyword extraction tests ──────────────────────────────────

describe('AutoTagger._extractKeywords', () => {
  beforeEach(() => setup());
  afterEach(() => cleanup());

  it('extracts frequent non-category words as keywords', () => {
    const wordFreq = {
      'kubernetes': 5,
      'deployment': 4,
      'microservices': 6,
      'obscureword': 8,
    };
    const totalWords = 50;
    const coveredWords = new Set(['kubernetes', 'deployment']); // from devops category
    const results = AutoTagger._extractKeywords(wordFreq, totalWords, coveredWords);
    // Should not include covered words
    assert.ok(!results.find(r => r.tag === 'kubernetes'));
    assert.ok(!results.find(r => r.tag === 'deployment'));
    // Should include uncovered frequent words
    const ms = results.find(r => r.tag === 'microservices');
    assert.ok(ms || results.find(r => r.tag === 'obscureword'), 'Should extract emergent keywords');
  });

  it('requires minimum count of 3', () => {
    const wordFreq = { 'rareword': 2 };
    const results = AutoTagger._extractKeywords(wordFreq, 10, new Set());
    assert.equal(results.length, 0);
  });

  it('requires minimum word length of 4', () => {
    const wordFreq = { 'abc': 10 };
    const results = AutoTagger._extractKeywords(wordFreq, 20, new Set());
    assert.equal(results.length, 0);
  });

  it('returns at most 3 keywords', () => {
    const wordFreq = {};
    for (let i = 0; i < 10; i++) {
      wordFreq['keyword' + i] = 10;
    }
    const results = AutoTagger._extractKeywords(wordFreq, 50, new Set());
    assert.ok(results.length <= 3);
  });
});

// ── analyze() integration tests ─────────────────────────────────

describe('AutoTagger.analyze', () => {
  beforeEach(() => setup());
  afterEach(() => cleanup());

  it('returns empty for too few messages', () => {
    const result = AutoTagger.analyze([{ role: 'user', content: 'hello' }]);
    assert.deepEqual(result, []);
  });

  it('returns empty for null/undefined', () => {
    assert.deepEqual(AutoTagger.analyze(null), []);
    assert.deepEqual(AutoTagger.analyze(undefined), []);
  });

  it('returns empty for very short messages', () => {
    const result = AutoTagger.analyze([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hey' },
    ]);
    assert.deepEqual(result, []);
  });

  it('returns at most MAX_SUGGESTIONS tags', () => {
    // Build a message with words from many categories
    const allWords = Object.values(AutoTagger._CATEGORIES)
      .flatMap(c => c.words.slice(0, 5));
    const msg = allWords.join(' ');
    const result = AutoTagger.analyze([
      { role: 'user', content: msg },
      { role: 'assistant', content: msg },
    ]);
    assert.ok(result.length <= 5);
  });

  it('detects math topics', () => {
    const messages = [
      { role: 'user', content: 'Solve this equation using calculus: find the derivative of the polynomial' },
      { role: 'assistant', content: 'Using algebra and the formula for derivatives, we can calculate the integral and apply the theorem' },
      { role: 'user', content: 'Now find the probability distribution and compute the standard deviation and mean' },
    ];
    const result = AutoTagger.analyze(messages);
    const mathTag = result.find(r => r.tag === 'math');
    assert.ok(mathTag, 'Should detect math category');
  });

  it('detects devops topics', () => {
    const messages = [
      { role: 'user', content: 'Help me write a Dockerfile for my kubernetes deployment' },
      { role: 'assistant', content: 'Here is a docker container config with CI/CD pipeline using github actions and terraform for AWS cloud infrastructure' },
      { role: 'user', content: 'How do I set up monitoring and logging with nginx load balancer scaling' },
    ];
    const result = AutoTagger.analyze(messages);
    const devopsTag = result.find(r => r.tag === 'devops');
    assert.ok(devopsTag, 'Should detect devops category');
  });

  it('includes source field in results', () => {
    const messages = [
      { role: 'user', content: 'Write a function to parse the api endpoint request' },
      { role: 'assistant', content: 'Here is a function for the api with error handling and debug output' },
      { role: 'user', content: 'Can you refactor this code and fix the compile bug in the response handling' },
    ];
    const result = AutoTagger.analyze(messages);
    for (const tag of result) {
      assert.ok(tag.source === 'category' || tag.source === 'keyword');
      assert.ok(typeof tag.score === 'number');
      assert.ok(typeof tag.tag === 'string');
    }
  });

  it('detects design topics', () => {
    const messages = [
      { role: 'user', content: 'Design a responsive layout with good typography and font choices for mobile' },
      { role: 'assistant', content: 'For better UX and user experience, use a component design system with proper accessibility and animation. Create a wireframe or mockup in figma' },
    ];
    const result = AutoTagger.analyze(messages);
    const designTag = result.find(r => r.tag === 'design');
    assert.ok(designTag, 'Should detect design category');
  });

  it('detects business topics', () => {
    const messages = [
      { role: 'user', content: 'Help me build a strategy for my startup MVP with pricing and subscription model' },
      { role: 'assistant', content: 'For your SaaS product roadmap, focus on customer acquisition and retention with good conversion funnel marketing. Consider revenue and ROI projections for the budget forecast' },
    ];
    const result = AutoTagger.analyze(messages);
    const bizTag = result.find(r => r.tag === 'business');
    assert.ok(bizTag, 'Should detect business category');
  });
});

// ── Session integration tests ────────────────────────────────

describe('AutoTagger.suggestForSession', () => {
  beforeEach(() => setup());
  afterEach(() => cleanup());

  it('returns empty when session not found', () => {
    const result = AutoTagger.suggestForSession('nonexistent-id-xyz');
    assert.deepEqual(result, []);
  });

  it('suggests tags for a saved session', () => {
    // Save a coding-heavy session
    ConversationManager.clear();
    ConversationManager.addMessage('user', 'Write a function to parse JSON data from the api endpoint');
    ConversationManager.addMessage('assistant', 'Here is a function that handles the request and response with async await and error handling for the api');
    ConversationManager.addMessage('user', 'Now refactor this code to use typescript with proper import and export modules');
    SessionManager.save();
    const sessions = SessionManager.getAll();
    assert.ok(sessions.length > 0);
    const result = AutoTagger.suggestForSession(sessions[0].id);
    assert.ok(result.length > 0);
  });
});

describe('AutoTagger.applyToSession', () => {
  beforeEach(() => setup());
  afterEach(() => cleanup());

  it('applies detected tags to a session', () => {
    ConversationManager.clear();
    ConversationManager.addMessage('user', 'Deploy the docker container to kubernetes with helm chart and nginx load balancer');
    ConversationManager.addMessage('assistant', 'Use terraform for the AWS cloud infrastructure with CI/CD pipeline and monitoring');
    ConversationManager.addMessage('user', 'Set up github actions for the deployment workflow with scaling and logging');
    SessionManager.save();
    const sessions = SessionManager.getAll();
    const applied = AutoTagger.applyToSession(sessions[0].id);
    assert.ok(applied > 0, 'Should apply at least one tag');
    const tags = ConversationTags.getTagsForSession(sessions[0].id);
    assert.ok(tags.length > 0, 'Session should have tags after auto-tagging');
  });

  it('does not duplicate existing tags', () => {
    ConversationManager.clear();
    ConversationManager.addMessage('user', 'Write a function to compile and debug the code with proper error handling');
    ConversationManager.addMessage('assistant', 'Here is the refactored function with async api request and response parsing');
    SessionManager.save();
    const sessions = SessionManager.getAll();
    // Manually add coding tag first
    ConversationTags.addTag(sessions[0].id, 'coding');
    const applied = AutoTagger.applyToSession(sessions[0].id);
    const tags = ConversationTags.getTagsForSession(sessions[0].id);
    // Should not have duplicate 'coding'
    const codingCount = tags.filter(t => t === 'coding').length;
    assert.equal(codingCount, 1);
  });
});

describe('AutoTagger.applyToAll', () => {
  beforeEach(() => setup());
  afterEach(() => cleanup());

  it('auto-tags untagged sessions only', () => {
    // Session 1: coding (already tagged)
    ConversationManager.clear();
    ConversationManager.addMessage('user', 'Write a function to parse the api with debugging');
    ConversationManager.addMessage('assistant', 'Function code with async request handling');
    SessionManager.save();
    const s1 = SessionManager.getAll()[0];
    ConversationTags.addTag(s1.id, 'manual-tag');

    // Session 2: math (untagged)
    SessionManager.newSession();
    ConversationManager.addMessage('user', 'Calculate the derivative of this polynomial equation using calculus');
    ConversationManager.addMessage('assistant', 'Apply the formula and theorem for the integral calculation with algebra');
    ConversationManager.addMessage('user', 'Now compute the probability and standard deviation of the distribution');
    SessionManager.save();

    const result = AutoTagger.applyToAll();
    // Should only tag session 2 (untagged)
    assert.ok(result.tagged <= 1, 'Should only tag untagged sessions');
  });

  it('returns zero counts when all sessions are tagged', () => {
    ConversationManager.clear();
    ConversationManager.addMessage('user', 'Test message with content here');
    ConversationManager.addMessage('assistant', 'Response with more content');
    SessionManager.save();
    const s = SessionManager.getAll()[0];
    ConversationTags.addTag(s.id, 'existing');

    const result = AutoTagger.applyToAll();
    assert.equal(result.tagged, 0);
    assert.equal(result.totalApplied, 0);
  });
});

// ── UI modal tests ──────────────────────────────────────────────

describe('AutoTagger.showSuggestionModal', () => {
  beforeEach(() => setup());
  afterEach(() => {
    // Clean up any modals
    const overlays = document.querySelectorAll('div[style*="z-index:10100"]');
    overlays.forEach(o => o.remove());
    cleanup();
  });

  it('creates a modal overlay', () => {
    AutoTagger.showSuggestionModal('fake-id');
    const overlays = document.querySelectorAll('div[style*="z-index"]');
    assert.ok(overlays.length > 0, 'Should create an overlay');
  });

  it('shows empty state for sessions with no detectable topics', () => {
    AutoTagger.showSuggestionModal('nonexistent-id');
    const modal = document.body.querySelector('div[style*="z-index"]');
    assert.ok(modal, 'Modal should exist');
    assert.ok(modal.textContent.includes('No strong topic'), 'Should show empty message');
  });

  it('shows checkboxes for detected tags', () => {
    ConversationManager.clear();
    ConversationManager.addMessage('user', 'Write a function to parse JSON data from the api endpoint');
    ConversationManager.addMessage('assistant', 'Here is a function that handles the request and response with async await');
    ConversationManager.addMessage('user', 'Refactor this code and fix the compile bug with proper debugging and error handling');
    SessionManager.save();
    const sessions = SessionManager.getAll();
    AutoTagger.showSuggestionModal(sessions[0].id);
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    // Should have at least one suggestion checkbox (plus the autosave checkbox in DOM)
    const tagCheckboxes = Array.from(checkboxes).filter(cb => cb.dataset.tag);
    assert.ok(tagCheckboxes.length > 0, 'Should show tag suggestion checkboxes');
  });

  it('closes on overlay click', () => {
    AutoTagger.showSuggestionModal('fake-id');
    const overlays = document.querySelectorAll('div[style*="z-index"]');
    const overlay = Array.from(overlays).find(el =>
      el.style.cssText.includes('10100')
    );
    assert.ok(overlay, 'Overlay should exist');
    // Simulate click on overlay itself
    const clickEvent = new dom.window.Event('click', { bubbles: true });
    Object.defineProperty(clickEvent, 'target', { value: overlay });
    overlay.dispatchEvent(clickEvent);
    // Overlay should be removed
    const remaining = document.querySelectorAll('div[style*="10100"]');
    assert.equal(remaining.length, 0, 'Overlay should be removed on click');
  });
});

// ── Constants and edge cases ──────────────────────────────────

describe('AutoTagger constants', () => {
  beforeEach(() => setup());
  afterEach(() => cleanup());

  it('has 10 category dictionaries', () => {
    const catCount = Object.keys(AutoTagger._CATEGORIES).length;
    assert.equal(catCount, 10);
  });

  it('all categories have tag and words fields', () => {
    for (const [key, cat] of Object.entries(AutoTagger._CATEGORIES)) {
      assert.ok(typeof cat.tag === 'string', key + ' should have a tag');
      assert.ok(Array.isArray(cat.words), key + ' should have words array');
      assert.ok(cat.words.length >= 10, key + ' should have at least 10 words');
    }
  });

  it('stop words set is populated', () => {
    assert.ok(AutoTagger._STOP_WORDS.size > 100);
    assert.ok(AutoTagger._STOP_WORDS.has('the'));
    assert.ok(AutoTagger._STOP_WORDS.has('and'));
    assert.ok(!AutoTagger._STOP_WORDS.has('python'));
  });

  it('MIN_SCORE is between 0 and 1', () => {
    assert.ok(AutoTagger._MIN_SCORE > 0);
    assert.ok(AutoTagger._MIN_SCORE < 1);
  });
});

describe('AutoTagger multi-word phrase detection', () => {
  beforeEach(() => setup());
  afterEach(() => cleanup());

  it('detects multi-word phrases like "machine learning"', () => {
    const messages = [
      { role: 'user', content: 'Tell me about machine learning and deep learning models for training' },
      { role: 'assistant', content: 'Machine learning uses neural network architectures with attention mechanisms for inference on datasets' },
      { role: 'user', content: 'How does reinforcement learning differ from the transformer approach to generative models with embeddings' },
    ];
    const result = AutoTagger.analyze(messages);
    const aiTag = result.find(r => r.tag === 'ai/ml');
    assert.ok(aiTag, 'Multi-word phrases like "machine learning" should boost AI/ML detection');
  });

  it('detects "pull request" and "github actions" in devops', () => {
    const messages = [
      { role: 'user', content: 'Set up a github actions CI/CD pipeline for the pull request workflow' },
      { role: 'assistant', content: 'Use docker container deployment with kubernetes and terraform for cloud infrastructure scaling' },
      { role: 'user', content: 'Add monitoring and logging to the microservice with nginx load balancer and helm orchestration' },
    ];
    const result = AutoTagger.analyze(messages);
    const devopsTag = result.find(r => r.tag === 'devops');
    assert.ok(devopsTag, 'Should detect multi-word devops phrases');
  });
});

describe('AutoTagger science category', () => {
  beforeEach(() => setup());
  afterEach(() => cleanup());

  it('detects science topics', () => {
    const messages = [
      { role: 'user', content: 'Explain the experiment and hypothesis about genetics and DNA evolution' },
      { role: 'assistant', content: 'The research theory involves biology and chemistry of protein molecules at the cell level with quantum physics observations' },
    ];
    const result = AutoTagger.analyze(messages);
    const sciTag = result.find(r => r.tag === 'science');
    assert.ok(sciTag, 'Should detect science category');
  });
});

