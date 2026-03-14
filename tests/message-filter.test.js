/**
 * @jest-environment jsdom
 *
 * Tests for MessageFilter module (agenticchat)
 *
 * We test the detection functions and filter logic by recreating the
 * pure-logic parts of the module. The DOM interaction is tested via
 * integration-style tests.
 */

'use strict';

/* ── Replicate detection functions from app.js ───────────── */

function _hasCode(text) {
  return /```[\s\S]*?```/.test(text) || /`[^`]+`/.test(text);
}

function _hasQuestion(text) {
  return /\?\s*$/.test(text) || /\?[\s"')\]]/.test(text) ||
         /^(what|how|why|when|where|who|which|can|could|would|should|is|are|do|does|did|will|shall)\b/im.test(text);
}

function _hasLink(text) {
  return /https?:\/\/\S+/i.test(text) || /\[.*?\]\(.*?\)/.test(text);
}

function _hasError(text) {
  return /\b(error|exception|traceback|failed|failure|fatal|panic|segfault|ENOENT|EACCES|TypeError|ReferenceError|SyntaxError|ValueError|KeyError|NullPointerException|IndexOutOfBoundsException)\b/i.test(text);
}

function _hasList(text) {
  return /^[\s]*[-*•]\s+/m.test(text) || /^[\s]*\d+[.)]\s+/m.test(text);
}

function _matchesFilter(msg, filterType) {
  if (filterType === 'all') return true;
  if (filterType === 'user') return msg.role === 'user';
  if (filterType === 'assistant') return msg.role === 'assistant';
  const text = msg.content || '';
  switch (filterType) {
    case 'code':     return _hasCode(text);
    case 'question': return _hasQuestion(text);
    case 'link':     return _hasLink(text);
    case 'error':    return _hasError(text);
    case 'list':     return _hasList(text);
    default:         return true;
  }
}

const FILTER_TYPES = [
  { id: 'all',       label: 'All',       icon: '📋', desc: 'Show all messages' },
  { id: 'code',      label: 'Code',      icon: '💻', desc: 'Messages with code blocks' },
  { id: 'question',  label: 'Questions',  icon: '❓', desc: 'Messages containing questions' },
  { id: 'link',      label: 'Links',      icon: '🔗', desc: 'Messages with URLs' },
  { id: 'error',     label: 'Errors',     icon: '🔴', desc: 'Messages with error patterns' },
  { id: 'list',      label: 'Lists',      icon: '📝', desc: 'Messages with bullet/numbered lists' },
  { id: 'user',      label: 'You',        icon: '👤', desc: 'Your messages only' },
  { id: 'assistant', label: 'Assistant',   icon: '🤖', desc: 'Assistant messages only' }
];

function getFilterCounts(messages) {
  const counts = {};
  FILTER_TYPES.forEach(ft => {
    counts[ft.id] = ft.id === 'all'
      ? messages.length
      : messages.filter(m => _matchesFilter(m, ft.id)).length;
  });
  return counts;
}

/* ── FILTER_TYPES ────────────────────────────────────────── */

describe('FILTER_TYPES', () => {
  test('has 8 filter types', () => {
    expect(FILTER_TYPES).toHaveLength(8);
  });

  test('each type has id, label, icon, desc', () => {
    FILTER_TYPES.forEach(ft => {
      expect(ft).toHaveProperty('id');
      expect(ft).toHaveProperty('label');
      expect(ft).toHaveProperty('icon');
      expect(ft).toHaveProperty('desc');
    });
  });

  test('"all" is the first filter', () => {
    expect(FILTER_TYPES[0].id).toBe('all');
  });

  test('ids are unique', () => {
    const ids = FILTER_TYPES.map(ft => ft.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/* ── _hasCode() ──────────────────────────────────────────── */

describe('_hasCode()', () => {
  test('detects fenced code blocks', () => {
    expect(_hasCode('```js\nconsole.log("hi");\n```')).toBe(true);
  });

  test('detects inline code', () => {
    expect(_hasCode('Use `npm install` to set up')).toBe(true);
  });

  test('detects multi-line fenced block', () => {
    expect(_hasCode('Here:\n```python\ndef f():\n  pass\n```\nDone.')).toBe(true);
  });

  test('rejects plain text', () => {
    expect(_hasCode('No code here at all')).toBe(false);
  });

  test('rejects empty string', () => {
    expect(_hasCode('')).toBe(false);
  });
});

/* ── _hasQuestion() ──────────────────────────────────────── */

describe('_hasQuestion()', () => {
  test('detects trailing question mark', () => {
    expect(_hasQuestion('What is this?')).toBe(true);
  });

  test('detects "how" at start', () => {
    expect(_hasQuestion('How does this work')).toBe(true);
  });

  test('detects "why" at start', () => {
    expect(_hasQuestion('Why is the sky blue')).toBe(true);
  });

  test('detects "can" at start', () => {
    expect(_hasQuestion('Can you help me')).toBe(true);
  });

  test('detects "should" at start', () => {
    expect(_hasQuestion('Should I use React')).toBe(true);
  });

  test('detects "is" at start', () => {
    expect(_hasQuestion('Is this correct')).toBe(true);
  });

  test('detects mid-sentence question mark', () => {
    expect(_hasQuestion('Is this correct? I think so.')).toBe(true);
  });

  test('rejects simple statement', () => {
    expect(_hasQuestion('This is a statement.')).toBe(false);
  });

  test('rejects empty string', () => {
    expect(_hasQuestion('')).toBe(false);
  });
});

/* ── _hasLink() ──────────────────────────────────────────── */

describe('_hasLink()', () => {
  test('detects https URLs', () => {
    expect(_hasLink('Visit https://example.com')).toBe(true);
  });

  test('detects http URLs', () => {
    expect(_hasLink('See http://example.com/path')).toBe(true);
  });

  test('detects markdown links', () => {
    expect(_hasLink('Check [docs](https://docs.example.com)')).toBe(true);
  });

  test('rejects plain text', () => {
    expect(_hasLink('No links here')).toBe(false);
  });

  test('rejects protocol-less domain', () => {
    expect(_hasLink('example.com')).toBe(false);
  });
});

/* ── _hasError() ─────────────────────────────────────────── */

describe('_hasError()', () => {
  test('detects TypeError', () => {
    expect(_hasError('TypeError: x is not a function')).toBe(true);
  });

  test('detects ReferenceError', () => {
    expect(_hasError('ReferenceError: foo is not defined')).toBe(true);
  });

  test('detects SyntaxError', () => {
    expect(_hasError('SyntaxError: Unexpected token')).toBe(true);
  });

  test('detects Python traceback', () => {
    expect(_hasError('Traceback (most recent call last):')).toBe(true);
  });

  test('detects generic "failed"', () => {
    expect(_hasError('Build failed with 3 errors')).toBe(true);
  });

  test('detects ENOENT', () => {
    expect(_hasError('Error: ENOENT: no such file')).toBe(true);
  });

  test('detects NullPointerException', () => {
    expect(_hasError('java.lang.NullPointerException')).toBe(true);
  });

  test('detects "fatal"', () => {
    expect(_hasError('fatal: not a git repository')).toBe(true);
  });

  test('rejects normal text', () => {
    expect(_hasError('Everything works fine')).toBe(false);
  });

  test('rejects empty string', () => {
    expect(_hasError('')).toBe(false);
  });
});

/* ── _hasList() ──────────────────────────────────────────── */

describe('_hasList()', () => {
  test('detects dash bullet lists', () => {
    expect(_hasList('- item one\n- item two')).toBe(true);
  });

  test('detects asterisk bullet lists', () => {
    expect(_hasList('* first\n* second')).toBe(true);
  });

  test('detects bullet character', () => {
    expect(_hasList('• item one')).toBe(true);
  });

  test('detects numbered lists with dot', () => {
    expect(_hasList('1. First\n2. Second')).toBe(true);
  });

  test('detects numbered lists with paren', () => {
    expect(_hasList('1) First\n2) Second')).toBe(true);
  });

  test('detects indented lists', () => {
    expect(_hasList('  - nested item')).toBe(true);
  });

  test('rejects plain text', () => {
    expect(_hasList('No list here')).toBe(false);
  });

  test('rejects dash in normal text', () => {
    expect(_hasList('this is a well-formed sentence')).toBe(false);
  });
});

/* ── _matchesFilter() ───────────────────────────────────── */

describe('_matchesFilter()', () => {
  test('"all" matches everything', () => {
    expect(_matchesFilter({ role: 'user', content: 'hi' }, 'all')).toBe(true);
    expect(_matchesFilter({ role: 'assistant', content: '' }, 'all')).toBe(true);
  });

  test('"user" matches only user role', () => {
    expect(_matchesFilter({ role: 'user', content: 'hi' }, 'user')).toBe(true);
    expect(_matchesFilter({ role: 'assistant', content: 'hi' }, 'user')).toBe(false);
  });

  test('"assistant" matches only assistant role', () => {
    expect(_matchesFilter({ role: 'assistant', content: 'hi' }, 'assistant')).toBe(true);
    expect(_matchesFilter({ role: 'user', content: 'hi' }, 'assistant')).toBe(false);
  });

  test('"code" delegates to _hasCode', () => {
    expect(_matchesFilter({ role: 'user', content: '```x```' }, 'code')).toBe(true);
    expect(_matchesFilter({ role: 'user', content: 'no code' }, 'code')).toBe(false);
  });

  test('"question" delegates to _hasQuestion', () => {
    expect(_matchesFilter({ role: 'user', content: 'What?' }, 'question')).toBe(true);
    expect(_matchesFilter({ role: 'user', content: 'OK.' }, 'question')).toBe(false);
  });

  test('"link" delegates to _hasLink', () => {
    expect(_matchesFilter({ role: 'user', content: 'https://x.com' }, 'link')).toBe(true);
    expect(_matchesFilter({ role: 'user', content: 'no url' }, 'link')).toBe(false);
  });

  test('"error" delegates to _hasError', () => {
    expect(_matchesFilter({ role: 'assistant', content: 'TypeError: bad' }, 'error')).toBe(true);
    expect(_matchesFilter({ role: 'assistant', content: 'all good' }, 'error')).toBe(false);
  });

  test('"list" delegates to _hasList', () => {
    expect(_matchesFilter({ role: 'assistant', content: '- a\n- b' }, 'list')).toBe(true);
    expect(_matchesFilter({ role: 'assistant', content: 'no list' }, 'list')).toBe(false);
  });

  test('handles null content gracefully', () => {
    expect(_matchesFilter({ role: 'user', content: null }, 'code')).toBe(false);
    expect(_matchesFilter({ role: 'user' }, 'link')).toBe(false);
  });

  test('unknown filter defaults to true', () => {
    expect(_matchesFilter({ role: 'user', content: 'hi' }, 'xyz')).toBe(true);
  });
});

/* ── getFilterCounts() ───────────────────────────────────── */

describe('getFilterCounts()', () => {
  test('returns counts for all filter types', () => {
    const messages = [
      { role: 'user', content: 'What is JavaScript?' },
      { role: 'assistant', content: '```js\nconsole.log("hi");\n```' },
      { role: 'user', content: 'Visit https://mdn.io' },
      { role: 'assistant', content: 'TypeError: x is undefined' }
    ];

    const counts = getFilterCounts(messages);
    expect(counts.all).toBe(4);
    expect(counts.user).toBe(2);
    expect(counts.assistant).toBe(2);
    expect(counts.code).toBe(1);
    expect(counts.question).toBe(1);
    expect(counts.link).toBe(1);
    expect(counts.error).toBe(1);
  });

  test('handles empty history', () => {
    const counts = getFilterCounts([]);
    expect(counts.all).toBe(0);
    expect(counts.user).toBe(0);
    expect(counts.code).toBe(0);
  });

  test('message can match multiple filters', () => {
    const messages = [
      { role: 'user', content: 'What is `const`? See https://mdn.io' }
    ];

    const counts = getFilterCounts(messages);
    expect(counts.all).toBe(1);
    expect(counts.user).toBe(1);
    expect(counts.code).toBe(1);
    expect(counts.question).toBe(1);
    expect(counts.link).toBe(1);
  });

  test('list with mixed content', () => {
    const messages = [
      { role: 'assistant', content: '- Step 1\n- Step 2\n- Step 3' },
      { role: 'user', content: 'Thanks!' },
      { role: 'assistant', content: 'Here is the code:\n```py\nprint("hi")\n```\n\nError: ENOENT if file missing.' }
    ];

    const counts = getFilterCounts(messages);
    expect(counts.list).toBe(1);
    expect(counts.code).toBe(1);
    expect(counts.error).toBe(1);
    // The third message has both code AND error
    expect(counts.all).toBe(3);
  });
});

/* ── DOM integration (simplified) ────────────────────────── */

describe('DOM integration', () => {
  function setupDOM(messages) {
    document.body.innerHTML = `<div id="chat-output"></div>`;
    const container = document.getElementById('chat-output');
    messages.forEach(m => {
      const div = document.createElement('div');
      div.className = `history-msg ${m.role}`;
      div.textContent = m.content;
      container.appendChild(div);
    });
    return { container, messages };
  }

  function applyFilterDOM(container, messages, filterType) {
    const msgEls = container.querySelectorAll('.history-msg');
    let visibleCount = 0;
    msgEls.forEach((el, idx) => {
      const msg = messages[idx];
      if (!msg) return;
      const matches = _matchesFilter(msg, filterType);
      el.style.display = matches ? '' : 'none';
      if (matches) visibleCount++;
    });
    return visibleCount;
  }

  test('code filter hides non-code messages', () => {
    const msgs = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: '```code```' },
      { role: 'user', content: 'Bye' }
    ];
    const { container, messages } = setupDOM(msgs);
    applyFilterDOM(container, messages, 'code');

    const els = container.querySelectorAll('.history-msg');
    expect(els[0].style.display).toBe('none');
    expect(els[1].style.display).toBe('');
    expect(els[2].style.display).toBe('none');
  });

  test('"all" shows everything', () => {
    const msgs = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' }
    ];
    const { container, messages } = setupDOM(msgs);
    applyFilterDOM(container, messages, 'code');
    applyFilterDOM(container, messages, 'all');

    const els = container.querySelectorAll('.history-msg');
    els.forEach(el => expect(el.style.display).toBe(''));
  });

  test('returns visible count', () => {
    const msgs = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: '```code```' },
      { role: 'user', content: 'What?' }
    ];
    const { container, messages } = setupDOM(msgs);

    expect(applyFilterDOM(container, messages, 'code')).toBe(1);
    expect(applyFilterDOM(container, messages, 'user')).toBe(2);
    expect(applyFilterDOM(container, messages, 'all')).toBe(3);
    expect(applyFilterDOM(container, messages, 'error')).toBe(0);
  });

  test('question filter works on DOM', () => {
    const msgs = [
      { role: 'user', content: 'How does this work?' },
      { role: 'assistant', content: 'It works like this.' },
      { role: 'user', content: 'Can you explain more?' }
    ];
    const { container, messages } = setupDOM(msgs);

    expect(applyFilterDOM(container, messages, 'question')).toBe(2);
  });
});
