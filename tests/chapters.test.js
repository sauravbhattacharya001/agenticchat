/**
 * ConversationChapters — Unit Tests
 *
 * Tests for named section dividers with TOC navigation,
 * CRUD, export/import, panel UI, and divider rendering.
 */

const { setupDOM, loadApp } = require('./setup');

beforeEach(() => {
  localStorage.clear();
  setupDOM();
  loadApp();
});

afterEach(() => {
  localStorage.clear();
});

// ── Core CRUD ──

describe('addChapter', () => {
  test('adds a chapter at a valid index', () => {
    const result = ConversationChapters.addChapter(1, 'Introduction');
    expect(result).not.toBeNull();
    expect(result.title).toBe('Introduction');
    expect(result.createdAt).toBeGreaterThan(0);
  });

  test('trims whitespace from title', () => {
    const result = ConversationChapters.addChapter(1, '  My Chapter  ');
    expect(result.title).toBe('My Chapter');
  });

  test('rejects empty title', () => {
    expect(ConversationChapters.addChapter(1, '')).toBeNull();
    expect(ConversationChapters.addChapter(1, '   ')).toBeNull();
  });

  test('rejects null title', () => {
    expect(ConversationChapters.addChapter(1, null)).toBeNull();
  });

  test('rejects negative index', () => {
    expect(ConversationChapters.addChapter(-1, 'Bad')).toBeNull();
  });

  test('rejects non-number index', () => {
    expect(ConversationChapters.addChapter('foo', 'Bad')).toBeNull();
  });

  test('truncates long titles', () => {
    const longTitle = 'A'.repeat(200);
    const result = ConversationChapters.addChapter(1, longTitle);
    expect(result.title.length).toBe(80);
  });

  test('overwrites chapter at same index', () => {
    ConversationChapters.addChapter(5, 'First');
    const result = ConversationChapters.addChapter(5, 'Second');
    expect(result.title).toBe('Second');
    expect(ConversationChapters.getCount()).toBe(1);
  });

  test('preserves createdAt when overwriting', () => {
    ConversationChapters.addChapter(5, 'First');
    const ch1 = ConversationChapters.getChapterAt(5);
    const origTime = ch1.createdAt;
    ConversationChapters.addChapter(5, 'Updated');
    const ch2 = ConversationChapters.getChapterAt(5);
    expect(ch2.createdAt).toBe(origTime);
  });
});

describe('removeChapter', () => {
  test('removes an existing chapter', () => {
    ConversationChapters.addChapter(3, 'Remove me');
    expect(ConversationChapters.removeChapter(3)).toBe(true);
    expect(ConversationChapters.getCount()).toBe(0);
  });

  test('returns false for non-existent chapter', () => {
    expect(ConversationChapters.removeChapter(99)).toBe(false);
  });
});

describe('renameChapter', () => {
  test('renames an existing chapter', () => {
    ConversationChapters.addChapter(2, 'Old Name');
    expect(ConversationChapters.renameChapter(2, 'New Name')).toBe(true);
    expect(ConversationChapters.getChapterAt(2).title).toBe('New Name');
  });

  test('returns false for non-existent chapter', () => {
    expect(ConversationChapters.renameChapter(99, 'Nope')).toBe(false);
  });

  test('rejects empty rename', () => {
    ConversationChapters.addChapter(2, 'Keep Me');
    expect(ConversationChapters.renameChapter(2, '')).toBe(false);
    expect(ConversationChapters.renameChapter(2, '   ')).toBe(false);
    expect(ConversationChapters.getChapterAt(2).title).toBe('Keep Me');
  });

  test('truncates long rename', () => {
    ConversationChapters.addChapter(2, 'Short');
    ConversationChapters.renameChapter(2, 'B'.repeat(120));
    expect(ConversationChapters.getChapterAt(2).title.length).toBe(80);
  });
});

// ── Queries ──

describe('getChapters', () => {
  test('returns sorted chapters by messageIndex', () => {
    ConversationChapters.addChapter(10, 'Third');
    ConversationChapters.addChapter(1, 'First');
    ConversationChapters.addChapter(5, 'Second');
    const chapters = ConversationChapters.getChapters();
    expect(chapters).toHaveLength(3);
    expect(chapters[0].messageIndex).toBe(1);
    expect(chapters[0].number).toBe(1);
    expect(chapters[1].messageIndex).toBe(5);
    expect(chapters[1].number).toBe(2);
    expect(chapters[2].messageIndex).toBe(10);
    expect(chapters[2].number).toBe(3);
  });

  test('returns empty array when no chapters', () => {
    expect(ConversationChapters.getChapters()).toEqual([]);
  });
});

describe('getChapterAt', () => {
  test('returns chapter at exact index', () => {
    ConversationChapters.addChapter(7, 'Exact');
    const ch = ConversationChapters.getChapterAt(7);
    expect(ch).not.toBeNull();
    expect(ch.title).toBe('Exact');
    expect(ch.number).toBe(1);
  });

  test('returns null for non-existent index', () => {
    expect(ConversationChapters.getChapterAt(99)).toBeNull();
  });
});

describe('getChapterFor', () => {
  test('returns the chapter whose range contains the index', () => {
    ConversationChapters.addChapter(1, 'Ch 1');
    ConversationChapters.addChapter(10, 'Ch 2');
    ConversationChapters.addChapter(20, 'Ch 3');

    // Index 5 falls in Ch 1's range (1-9)
    const ch = ConversationChapters.getChapterFor(5);
    expect(ch.title).toBe('Ch 1');
  });

  test('returns last chapter for index past all chapters', () => {
    ConversationChapters.addChapter(1, 'Ch 1');
    ConversationChapters.addChapter(10, 'Ch 2');
    const ch = ConversationChapters.getChapterFor(50);
    expect(ch.title).toBe('Ch 2');
  });

  test('returns exact chapter at boundary', () => {
    ConversationChapters.addChapter(1, 'Ch 1');
    ConversationChapters.addChapter(10, 'Ch 2');
    const ch = ConversationChapters.getChapterFor(10);
    expect(ch.title).toBe('Ch 2');
  });

  test('returns null for index before any chapter', () => {
    ConversationChapters.addChapter(5, 'Ch 1');
    const ch = ConversationChapters.getChapterFor(2);
    expect(ch).toBeNull();
  });
});

describe('getCount', () => {
  test('returns 0 when empty', () => {
    expect(ConversationChapters.getCount()).toBe(0);
  });

  test('tracks additions correctly', () => {
    ConversationChapters.addChapter(1, 'A');
    ConversationChapters.addChapter(2, 'B');
    expect(ConversationChapters.getCount()).toBe(2);
  });
});

// ── clearAll ──

describe('clearAll', () => {
  test('removes all chapters', () => {
    ConversationChapters.addChapter(1, 'A');
    ConversationChapters.addChapter(5, 'B');
    ConversationChapters.addChapter(10, 'C');
    ConversationChapters.clearAll();
    expect(ConversationChapters.getCount()).toBe(0);
    expect(ConversationChapters.getChapters()).toEqual([]);
  });
});

// ── Export/Import ──

describe('exportChapters', () => {
  test('exports as JSON string', () => {
    ConversationChapters.addChapter(1, 'First');
    ConversationChapters.addChapter(5, 'Second');
    const json = ConversationChapters.exportChapters();
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].title).toBe('First');
    expect(parsed[0].messageIndex).toBe(1);
    expect(parsed[1].title).toBe('Second');
    expect(parsed[1].messageIndex).toBe(5);
  });

  test('exports empty array when no chapters', () => {
    const json = ConversationChapters.exportChapters();
    expect(JSON.parse(json)).toEqual([]);
  });
});

describe('importChapters', () => {
  test('imports from JSON string', () => {
    const data = [
      { messageIndex: 3, title: 'Imported 1' },
      { messageIndex: 7, title: 'Imported 2' },
    ];
    const count = ConversationChapters.importChapters(JSON.stringify(data));
    expect(count).toBe(2);
    expect(ConversationChapters.getCount()).toBe(2);
  });

  test('imports from array directly', () => {
    const count = ConversationChapters.importChapters([
      { messageIndex: 1, title: 'Direct' },
    ]);
    expect(count).toBe(1);
  });

  test('returns 0 for invalid JSON', () => {
    expect(ConversationChapters.importChapters('not json')).toBe(0);
  });

  test('returns 0 for non-array', () => {
    expect(ConversationChapters.importChapters('{"a": 1}')).toBe(0);
  });

  test('skips entries without messageIndex or title', () => {
    const count = ConversationChapters.importChapters([
      { title: 'No index' },
      { messageIndex: 1 },
      { messageIndex: 2, title: 'Valid' },
    ]);
    expect(count).toBe(1);
    expect(ConversationChapters.getCount()).toBe(1);
  });

  test('merges with existing chapters', () => {
    ConversationChapters.addChapter(1, 'Existing');
    ConversationChapters.importChapters([
      { messageIndex: 5, title: 'New' },
    ]);
    expect(ConversationChapters.getCount()).toBe(2);
  });
});

// ── Persistence ──

describe('persistence', () => {
  test('saves and restores from localStorage', () => {
    ConversationChapters.addChapter(3, 'Persistent');
    ConversationChapters.addChapter(7, 'Also Persistent');

    // Reload
    setupDOM();
    loadApp();

    expect(ConversationChapters.getCount()).toBe(2);
    const chapters = ConversationChapters.getChapters();
    expect(chapters[0].title).toBe('Persistent');
    expect(chapters[1].title).toBe('Also Persistent');
  });

  test('clearAll persists empty state', () => {
    ConversationChapters.addChapter(1, 'Gone');
    ConversationChapters.clearAll();

    setupDOM();
    loadApp();
    expect(ConversationChapters.getCount()).toBe(0);
  });
});

// ── Max limits ──

describe('limits', () => {
  test('enforces MAX_CHAPTERS (100)', () => {
    for (let i = 0; i < 100; i++) {
      ConversationChapters.addChapter(i, 'Ch ' + i);
    }
    expect(ConversationChapters.getCount()).toBe(100);

    // 101st should fail
    const result = ConversationChapters.addChapter(200, 'Too Many');
    expect(result).toBeNull();
    expect(ConversationChapters.getCount()).toBe(100);
  });

  test('allows overwrite even at max capacity', () => {
    for (let i = 0; i < 100; i++) {
      ConversationChapters.addChapter(i, 'Ch ' + i);
    }
    // Overwrite existing
    const result = ConversationChapters.addChapter(50, 'Updated');
    expect(result).not.toBeNull();
    expect(result.title).toBe('Updated');
  });
});

// ── addChapterAtCurrent ──

describe('addChapterAtCurrent', () => {
  test('adds chapter at last history message', () => {
    ConversationManager.addMessage('user', 'Hello');
    ConversationManager.addMessage('assistant', 'Hi there');
    const result = ConversationChapters.addChapterAtCurrent('Current');
    expect(result).not.toBeNull();
    // Should be at history.length - 1 = index 2 (system + user + assistant)
    const chapters = ConversationChapters.getChapters();
    expect(chapters[0].messageIndex).toBe(2);
  });

  test('generates default title if none provided', () => {
    ConversationManager.addMessage('user', 'test');
    const result = ConversationChapters.addChapterAtCurrent();
    // suggestTitle detects 'test' keyword and suggests 'Testing'
    expect(result.title).toBe('Testing');
  });

  test('returns null when history is too short', () => {
    // Only system message present
    const result = ConversationChapters.addChapterAtCurrent('No');
    expect(result).toBeNull();
  });
});

// ── Panel UI ──

describe('panel', () => {
  test('openPanel creates panel DOM', () => {
    ConversationChapters.openPanel();
    const panel = document.getElementById('chapters-panel');
    expect(panel).not.toBeNull();
    expect(panel.classList.contains('ch-open')).toBe(true);
  });

  test('closePanel hides panel', () => {
    ConversationChapters.openPanel();
    ConversationChapters.closePanel();
    const panel = document.getElementById('chapters-panel');
    expect(panel.classList.contains('ch-open')).toBe(false);
  });

  test('togglePanel opens then closes', () => {
    ConversationChapters.togglePanel();
    const panel = document.getElementById('chapters-panel');
    expect(panel.classList.contains('ch-open')).toBe(true);

    ConversationChapters.togglePanel();
    expect(panel.classList.contains('ch-open')).toBe(false);
  });

  test('panel renders chapter items', () => {
    ConversationChapters.addChapter(1, 'Alpha');
    ConversationChapters.addChapter(5, 'Beta');
    ConversationChapters.openPanel();
    const items = document.querySelectorAll('.ch-item');
    expect(items.length).toBe(2);
    expect(items[0].querySelector('.ch-item-title').textContent).toBe('Alpha');
    expect(items[1].querySelector('.ch-item-title').textContent).toBe('Beta');
  });

  test('panel shows chapter numbers', () => {
    ConversationChapters.addChapter(1, 'One');
    ConversationChapters.addChapter(10, 'Two');
    ConversationChapters.openPanel();
    const nums = document.querySelectorAll('.ch-item-num');
    expect(nums[0].textContent).toBe('1');
    expect(nums[1].textContent).toBe('2');
  });

  test('panel is empty when no chapters', () => {
    ConversationChapters.openPanel();
    const body = document.getElementById('chapters-body');
    expect(body.children.length).toBe(0);
  });
});

// ── Dividers ──

describe('renderDividers', () => {
  function populateHistory(msgCount) {
    const container = document.getElementById('history-messages');
    container.innerHTML = '';
    for (let i = 0; i < msgCount; i++) {
      const div = document.createElement('div');
      div.className = 'history-msg user';
      div.textContent = 'Message ' + i;
      container.appendChild(div);
    }
    // Also add messages to ConversationManager
    for (let i = 0; i < msgCount; i++) {
      ConversationManager.addMessage(i % 2 === 0 ? 'user' : 'assistant', 'Message ' + i);
    }
  }

  test('injects divider elements before chapter messages', () => {
    populateHistory(10);
    ConversationChapters.addChapter(1, 'Start');
    ConversationChapters.addChapter(5, 'Middle');
    ConversationChapters.renderDividers();

    const dividers = document.querySelectorAll('.ch-divider');
    expect(dividers.length).toBe(2);
  });

  test('dividers have correct labels', () => {
    populateHistory(6);
    ConversationChapters.addChapter(1, 'Alpha');
    ConversationChapters.addChapter(3, 'Beta');
    ConversationChapters.renderDividers();

    const labels = document.querySelectorAll('.ch-divider-label');
    expect(labels[0].textContent).toContain('Alpha');
    expect(labels[1].textContent).toContain('Beta');
  });

  test('removes old dividers before re-rendering', () => {
    populateHistory(6);
    ConversationChapters.addChapter(1, 'One');
    ConversationChapters.renderDividers();
    expect(document.querySelectorAll('.ch-divider').length).toBe(1);

    // Re-render
    ConversationChapters.renderDividers();
    expect(document.querySelectorAll('.ch-divider').length).toBe(1);
  });

  test('handles no chapters gracefully', () => {
    populateHistory(5);
    ConversationChapters.renderDividers();
    expect(document.querySelectorAll('.ch-divider').length).toBe(0);
  });
});

// ── Add buttons ──

describe('renderAddButtons', () => {
  function populateHistory(msgCount) {
    const container = document.getElementById('history-messages');
    container.innerHTML = '';
    for (let i = 0; i < msgCount; i++) {
      const div = document.createElement('div');
      div.className = 'history-msg user';
      div.textContent = 'Message ' + i;
      container.appendChild(div);
    }
    for (let i = 0; i < msgCount; i++) {
      ConversationManager.addMessage('user', 'Message ' + i);
    }
  }

  test('adds section-add buttons to messages', () => {
    populateHistory(5);
    ConversationChapters.renderAddButtons();
    const buttons = document.querySelectorAll('.ch-add-btn');
    expect(buttons.length).toBe(5);
  });

  test('skips messages that already have chapters', () => {
    populateHistory(5);
    ConversationChapters.addChapter(1, 'Has Chapter');
    ConversationChapters.renderAddButtons();
    const buttons = document.querySelectorAll('.ch-add-btn');
    // Index 1 maps to DOM index 0 (since system message at 0 is skipped).
    // All others get buttons: indices 2,3,4,5 → DOM 1,2,3,4
    // Index 1 → DOM 0 is skipped because it has a chapter
    expect(buttons.length).toBe(4);
  });
});

// ── Edge cases ──

describe('edge cases', () => {
  test('index 0 works (system message index)', () => {
    const result = ConversationChapters.addChapter(0, 'Prologue');
    expect(result).not.toBeNull();
    expect(ConversationChapters.getChapterAt(0).title).toBe('Prologue');
  });

  test('very large index works', () => {
    const result = ConversationChapters.addChapter(999999, 'Far Future');
    expect(result).not.toBeNull();
    expect(ConversationChapters.getChapterAt(999999).title).toBe('Far Future');
  });

  test('multiple operations chain correctly', () => {
    ConversationChapters.addChapter(1, 'A');
    ConversationChapters.addChapter(5, 'B');
    ConversationChapters.addChapter(10, 'C');
    ConversationChapters.removeChapter(5);
    ConversationChapters.renameChapter(1, 'Alpha');

    const chapters = ConversationChapters.getChapters();
    expect(chapters).toHaveLength(2);
    expect(chapters[0].title).toBe('Alpha');
    expect(chapters[0].number).toBe(1);
    expect(chapters[1].title).toBe('C');
    expect(chapters[1].number).toBe(2);
  });

  test('round-trip export and import', () => {
    ConversationChapters.addChapter(1, 'First');
    ConversationChapters.addChapter(5, 'Second');
    const exported = ConversationChapters.exportChapters();

    ConversationChapters.clearAll();
    expect(ConversationChapters.getCount()).toBe(0);

    ConversationChapters.importChapters(exported);
    expect(ConversationChapters.getCount()).toBe(2);
    expect(ConversationChapters.getChapterAt(1).title).toBe('First');
    expect(ConversationChapters.getChapterAt(5).title).toBe('Second');
  });
});

describe('suggestTitle', () => {
  beforeEach(() => {
    ConversationChapters.clearAll();
    const h = ConversationManager.getHistory();
    h.length = 1;
  });

  test('detects code blocks with language', () => {
    ConversationManager.addMessage('user', 'Here is my code:\n```javascript\nconsole.log("hi");\n```');
    const title = ConversationChapters.suggestTitle(1);
    expect(title).toBe('Code: Here is my code:');
  });

  test('detects code blocks without language', () => {
    ConversationManager.addMessage('user', '```\nsome code\n```');
    const title = ConversationChapters.suggestTitle(1);
    expect(title).toBe('Code Discussion');
  });

  test('detects questions', () => {
    ConversationManager.addMessage('user', 'How do I set up a React project?');
    const title = ConversationChapters.suggestTitle(1);
    expect(title).toBe('How do I set up a React project?');
  });

  test('detects topic keywords', () => {
    ConversationManager.addMessage('user', 'I need to deploy this application to production');
    const title = ConversationChapters.suggestTitle(1);
    expect(title).toBe('Deployment');
  });

  test('detects multiple topic keywords', () => {
    ConversationManager.addMessage('user', 'Can you help debug the security issue');
    const title = ConversationChapters.suggestTitle(1);
    expect(title).toBe('Security & Debugging');
  });

  test('falls back to first line for no keywords', () => {
    ConversationManager.addMessage('user', 'Hello world, nice to meet you');
    const title = ConversationChapters.suggestTitle(1);
    expect(title).toBe('Hello world, nice to meet you');
  });

  test('returns fallback for out-of-range index', () => {
    const title = ConversationChapters.suggestTitle(999);
    expect(title).toMatch(/^Chapter \d+$/);
  });

  test('skips system messages', () => {
    ConversationManager.addMessage('user', 'Let me explain the setup process');
    const title = ConversationChapters.suggestTitle(0);
    expect(title).toBe('Setup Discussion & Explanation');
  });
});
