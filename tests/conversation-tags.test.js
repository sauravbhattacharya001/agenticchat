'use strict';

const { setupDOM, loadApp } = require('./setup');

beforeAll(() => {
  setupDOM();
  loadApp();
});

const CT = () => globalThis.ConversationTags;

afterEach(() => {
  const ct = CT();
  if (!ct) return;
  const allTags = ct.getAllTags();
  allTags.forEach(t => ct.deleteTag(t.tag));
  ct.clearFilter();
  localStorage.clear();
});

// ── API existence ────────────────────────────────────────────

describe('ConversationTags API', () => {
  test('exposes required public methods', () => {
    const ct = CT();
    expect(typeof ct.addTag).toBe('function');
    expect(typeof ct.removeTag).toBe('function');
    expect(typeof ct.getTagsForSession).toBe('function');
    expect(typeof ct.clearSession).toBe('function');
    expect(typeof ct.getAllTags).toBe('function');
    expect(typeof ct.renameTag).toBe('function');
    expect(typeof ct.deleteTag).toBe('function');
    expect(typeof ct.getActiveFilter).toBe('function');
    expect(typeof ct.setFilter).toBe('function');
    expect(typeof ct.clearFilter).toBe('function');
    expect(typeof ct.matchesFilter).toBe('function');
    expect(typeof ct.renderTagPills).toBe('function');
    expect(typeof ct.openManager).toBe('function');
    expect(typeof ct.colorForTag).toBe('function');
  });
});

// ── Add/Remove tags ──────────────────────────────────────────

describe('ConversationTags CRUD', () => {
  const SID = 'test-session-1';

  test('addTag adds a tag to a session', () => {
    const ct = CT();
    expect(ct.addTag(SID, 'research')).toBe(true);
    expect(ct.getTagsForSession(SID)).toEqual(['research']);
  });

  test('addTag normalizes to lowercase', () => {
    const ct = CT();
    ct.addTag(SID, 'WORK');
    expect(ct.getTagsForSession(SID)).toEqual(['work']);
  });

  test('addTag trims whitespace', () => {
    const ct = CT();
    ct.addTag(SID, '  coding  ');
    expect(ct.getTagsForSession(SID)).toEqual(['coding']);
  });

  test('addTag rejects empty tag', () => {
    const ct = CT();
    expect(ct.addTag(SID, '')).toBe(false);
    expect(ct.addTag(SID, '   ')).toBe(false);
  });

  test('addTag rejects duplicate', () => {
    const ct = CT();
    ct.addTag(SID, 'work');
    expect(ct.addTag(SID, 'work')).toBe(false);
    expect(ct.getTagsForSession(SID)).toEqual(['work']);
  });

  test('addTag rejects when at MAX_TAGS_PER_SESSION', () => {
    const ct = CT();
    for (let i = 0; i < ct.MAX_TAGS_PER_SESSION; i++) {
      ct.addTag(SID, 'tag' + i);
    }
    expect(ct.addTag(SID, 'overflow')).toBe(false);
    expect(ct.getTagsForSession(SID).length).toBe(ct.MAX_TAGS_PER_SESSION);
  });

  test('removeTag removes a tag', () => {
    const ct = CT();
    ct.addTag(SID, 'work');
    ct.addTag(SID, 'research');
    expect(ct.removeTag(SID, 'work')).toBe(true);
    expect(ct.getTagsForSession(SID)).toEqual(['research']);
  });

  test('removeTag returns false for missing tag', () => {
    const ct = CT();
    expect(ct.removeTag(SID, 'nonexistent')).toBe(false);
  });

  test('removeTag returns false for missing session', () => {
    const ct = CT();
    expect(ct.removeTag('no-such-session', 'work')).toBe(false);
  });

  test('clearSession removes all tags for a session', () => {
    const ct = CT();
    ct.addTag(SID, 'a');
    ct.addTag(SID, 'b');
    ct.clearSession(SID);
    expect(ct.getTagsForSession(SID)).toEqual([]);
  });

  test('getTagsForSession returns empty array for unknown session', () => {
    expect(CT().getTagsForSession('unknown')).toEqual([]);
  });

  test('getTagsForSession returns a copy (not reference)', () => {
    const ct = CT();
    ct.addTag(SID, 'work');
    const tags = ct.getTagsForSession(SID);
    tags.push('mutated');
    expect(ct.getTagsForSession(SID)).toEqual(['work']);
  });
});

// ── getAllTags ────────────────────────────────────────────────

describe('ConversationTags getAllTags', () => {
  test('returns all unique tags sorted by count', () => {
    const ct = CT();
    ct.addTag('s1', 'work');
    ct.addTag('s1', 'research');
    ct.addTag('s2', 'work');
    ct.addTag('s3', 'work');
    const all = ct.getAllTags();
    expect(all[0].tag).toBe('work');
    expect(all[0].count).toBe(3);
    expect(all[1].tag).toBe('research');
    expect(all[1].count).toBe(1);
  });

  test('returns empty array when no tags', () => {
    expect(CT().getAllTags()).toEqual([]);
  });

  test('each tag entry has tag, count, and color', () => {
    const ct = CT();
    ct.addTag('s1', 'test');
    const all = ct.getAllTags();
    expect(all[0]).toHaveProperty('tag', 'test');
    expect(all[0]).toHaveProperty('count', 1);
    expect(all[0]).toHaveProperty('color');
    expect(all[0].color).toMatch(/^#/);
  });
});

// ── Rename/Delete tag ────────────────────────────────────────

describe('ConversationTags rename/delete', () => {
  test('renameTag renames across all sessions', () => {
    const ct = CT();
    ct.addTag('s1', 'old');
    ct.addTag('s2', 'old');
    expect(ct.renameTag('old', 'new')).toBe(true);
    expect(ct.getTagsForSession('s1')).toEqual(['new']);
    expect(ct.getTagsForSession('s2')).toEqual(['new']);
  });

  test('renameTag avoids duplicates', () => {
    const ct = CT();
    ct.addTag('s1', 'old');
    ct.addTag('s1', 'new');
    ct.renameTag('old', 'new');
    expect(ct.getTagsForSession('s1')).toEqual(['new']);
  });

  test('renameTag returns false for same name', () => {
    const ct = CT();
    ct.addTag('s1', 'same');
    expect(ct.renameTag('same', 'same')).toBe(false);
  });

  test('renameTag returns false for empty names', () => {
    const ct = CT();
    expect(ct.renameTag('', 'new')).toBe(false);
    expect(ct.renameTag('old', '')).toBe(false);
  });

  test('deleteTag removes from all sessions', () => {
    const ct = CT();
    ct.addTag('s1', 'remove-me');
    ct.addTag('s2', 'remove-me');
    ct.addTag('s2', 'keep');
    expect(ct.deleteTag('remove-me')).toBe(true);
    expect(ct.getTagsForSession('s1')).toEqual([]);
    expect(ct.getTagsForSession('s2')).toEqual(['keep']);
  });

  test('deleteTag returns false for nonexistent tag', () => {
    expect(CT().deleteTag('nonexistent')).toBe(false);
  });
});

// ── Filtering ────────────────────────────────────────────────

describe('ConversationTags filtering', () => {
  test('starts with no filter', () => {
    expect(CT().getActiveFilter()).toBeNull();
  });

  test('setFilter sets active filter', () => {
    const ct = CT();
    ct.setFilter('work');
    expect(ct.getActiveFilter()).toBe('work');
  });

  test('clearFilter clears', () => {
    const ct = CT();
    ct.setFilter('work');
    ct.clearFilter();
    expect(ct.getActiveFilter()).toBeNull();
  });

  test('matchesFilter returns true when no filter', () => {
    expect(CT().matchesFilter('any-session')).toBe(true);
  });

  test('matchesFilter returns true for matching session', () => {
    const ct = CT();
    ct.addTag('s1', 'work');
    ct.setFilter('work');
    expect(ct.matchesFilter('s1')).toBe(true);
  });

  test('matchesFilter returns false for non-matching session', () => {
    const ct = CT();
    ct.addTag('s1', 'research');
    ct.setFilter('work');
    expect(ct.matchesFilter('s1')).toBe(false);
  });

  test('deleteTag clears filter if deleted tag was active', () => {
    const ct = CT();
    ct.addTag('s1', 'temp');
    ct.setFilter('temp');
    ct.deleteTag('temp');
    expect(ct.getActiveFilter()).toBeNull();
  });

  test('renameTag updates active filter', () => {
    const ct = CT();
    ct.addTag('s1', 'old');
    ct.setFilter('old');
    ct.renameTag('old', 'new');
    expect(ct.getActiveFilter()).toBe('new');
  });
});

// ── getSessionsWithTag ───────────────────────────────────────

describe('ConversationTags getSessionsWithTag', () => {
  test('returns session IDs with the tag', () => {
    const ct = CT();
    ct.addTag('s1', 'work');
    ct.addTag('s2', 'work');
    ct.addTag('s3', 'play');
    const result = ct.getSessionsWithTag('work');
    expect(result).toContain('s1');
    expect(result).toContain('s2');
    expect(result).not.toContain('s3');
  });

  test('returns empty array for unused tag', () => {
    expect(CT().getSessionsWithTag('nothing')).toEqual([]);
  });
});

// ── Color assignment ─────────────────────────────────────────

describe('ConversationTags colorForTag', () => {
  test('returns a hex color', () => {
    expect(CT().colorForTag('work')).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test('same tag always gets same color', () => {
    const ct = CT();
    const c1 = ct.colorForTag('research');
    const c2 = ct.colorForTag('research');
    expect(c1).toBe(c2);
  });
});

// ── renderTagPills ───────────────────────────────────────────

describe('ConversationTags renderTagPills', () => {
  test('returns a container div', () => {
    const el = CT().renderTagPills('s1');
    expect(el.tagName).toBe('DIV');
    expect(el.className).toBe('session-tags');
  });

  test('shows add button when no tags', () => {
    const el = CT().renderTagPills('s1');
    const addBtn = el.querySelector('.tag-add-btn');
    expect(addBtn).toBeTruthy();
    expect(addBtn.textContent).toContain('tag');
  });

  test('shows tag pills for tagged session', () => {
    const ct = CT();
    ct.addTag('s1', 'work');
    ct.addTag('s1', 'research');
    const el = ct.renderTagPills('s1');
    const pills = el.querySelectorAll('.tag-pill');
    expect(pills.length).toBe(2);
    expect(pills[0].textContent).toBe('work');
    expect(pills[1].textContent).toBe('research');
  });

  test('hides add button at max tags', () => {
    const ct = CT();
    for (let i = 0; i < ct.MAX_TAGS_PER_SESSION; i++) {
      ct.addTag('s1', 'tag' + i);
    }
    const el = ct.renderTagPills('s1');
    const addBtn = el.querySelector('.tag-add-btn');
    expect(addBtn).toBeNull();
  });

  test('tag pills have a background color set', () => {
    const ct = CT();
    ct.addTag('s1', 'work');
    const el = ct.renderTagPills('s1');
    const pill = el.querySelector('.tag-pill');
    // jsdom normalizes hex to rgb, so just check it's non-empty
    expect(pill.style.background).toBeTruthy();
  });
});

// ── Tag manager modal ────────────────────────────────────────

describe('ConversationTags openManager', () => {
  afterEach(() => {
    const overlay = document.getElementById('tag-manager-overlay');
    if (overlay) overlay.remove();
  });

  test('creates modal overlay', () => {
    CT().openManager();
    expect(document.getElementById('tag-manager-overlay')).toBeTruthy();
  });

  test('shows empty message when no tags', () => {
    CT().openManager();
    const overlay = document.getElementById('tag-manager-overlay');
    expect(overlay.textContent).toContain('No tags yet');
  });

  test('shows tags with counts', () => {
    const ct = CT();
    ct.addTag('s1', 'work');
    ct.addTag('s2', 'work');
    ct.addTag('s1', 'research');
    ct.openManager();
    const overlay = document.getElementById('tag-manager-overlay');
    expect(overlay.textContent).toContain('work');
    expect(overlay.textContent).toContain('2 sessions');
    expect(overlay.textContent).toContain('research');
    expect(overlay.textContent).toContain('1 session');
  });

  test('close button removes modal', () => {
    CT().openManager();
    const overlay = document.getElementById('tag-manager-overlay');
    const buttons = overlay.querySelectorAll('button');
    const close = Array.from(buttons).find(b => b.textContent === 'Close');
    expect(close).toBeTruthy();
    close.click();
    expect(document.getElementById('tag-manager-overlay')).toBeNull();
  });

  test('Escape key closes modal', () => {
    CT().openManager();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('tag-manager-overlay')).toBeNull();
  });
});
