/**
 * MessageAnnotations — Unit Tests
 *
 * Tests for private notes/annotations on messages with labels,
 * search, filtering, export, persistence, and panel UI.
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

// ── Core API ──

describe('addAnnotation', () => {
  test('adds a note annotation', () => {
    const result = MessageAnnotations.addAnnotation(1, 'Test note', 'note');
    expect(result).not.toBeNull();
    expect(result.text).toBe('Test note');
    expect(result.label).toBe('note');
    expect(result.messageIndex).toBe(1);
  });

  test('trims whitespace from text', () => {
    const result = MessageAnnotations.addAnnotation(1, '  padded  ', 'note');
    expect(result.text).toBe('padded');
  });

  test('rejects empty text', () => {
    expect(MessageAnnotations.addAnnotation(1, '', 'note')).toBeNull();
    expect(MessageAnnotations.addAnnotation(1, '   ', 'note')).toBeNull();
  });

  test('rejects non-string text', () => {
    expect(MessageAnnotations.addAnnotation(1, null, 'note')).toBeNull();
    expect(MessageAnnotations.addAnnotation(1, 123, 'note')).toBeNull();
  });

  test('rejects text over MAX_NOTE_LENGTH (500)', () => {
    const long = 'x'.repeat(501);
    expect(MessageAnnotations.addAnnotation(1, long, 'note')).toBeNull();
  });

  test('accepts text at MAX_NOTE_LENGTH (500)', () => {
    const exact = 'x'.repeat(500);
    const result = MessageAnnotations.addAnnotation(1, exact, 'note');
    expect(result).not.toBeNull();
    expect(result.text.length).toBe(500);
  });

  test('rejects negative messageIndex', () => {
    expect(MessageAnnotations.addAnnotation(-1, 'Test', 'note')).toBeNull();
  });

  test('rejects non-number messageIndex', () => {
    expect(MessageAnnotations.addAnnotation('abc', 'Test', 'note')).toBeNull();
  });

  test('defaults to note label for unknown labelId', () => {
    const result = MessageAnnotations.addAnnotation(1, 'Test', 'unknown_label');
    expect(result).not.toBeNull();
    expect(result.label).toBe('note');
  });

  test('updates existing annotation text and label', () => {
    MessageAnnotations.addAnnotation(1, 'First', 'note');
    const updated = MessageAnnotations.addAnnotation(1, 'Second', 'important');
    expect(updated.text).toBe('Second');
    expect(updated.label).toBe('important');
    expect(MessageAnnotations.getCount()).toBe(1);
  });

  test('preserves createdAt on update', () => {
    const first = MessageAnnotations.addAnnotation(1, 'First', 'note');
    const second = MessageAnnotations.addAnnotation(1, 'Second', 'note');
    expect(second.createdAt).toBe(first.createdAt);
  });

  test('sets updatedAt on update', () => {
    MessageAnnotations.addAnnotation(1, 'First', 'note');
    const updated = MessageAnnotations.addAnnotation(1, 'Second', 'note');
    expect(updated.updatedAt).toBeDefined();
  });
});

describe('removeAnnotation', () => {
  test('removes existing annotation', () => {
    MessageAnnotations.addAnnotation(1, 'Test', 'note');
    expect(MessageAnnotations.removeAnnotation(1)).toBe(true);
    expect(MessageAnnotations.getAnnotation(1)).toBeNull();
  });

  test('returns false for non-existent annotation', () => {
    expect(MessageAnnotations.removeAnnotation(999)).toBe(false);
  });
});

describe('getAnnotation', () => {
  test('returns annotation with messageIndex', () => {
    MessageAnnotations.addAnnotation(5, 'Hello', 'question');
    const ann = MessageAnnotations.getAnnotation(5);
    expect(ann.messageIndex).toBe(5);
    expect(ann.text).toBe('Hello');
    expect(ann.label).toBe('question');
  });

  test('returns null for missing annotation', () => {
    expect(MessageAnnotations.getAnnotation(1)).toBeNull();
  });

  test('returns a copy (not same reference)', () => {
    MessageAnnotations.addAnnotation(1, 'Test', 'note');
    const a = MessageAnnotations.getAnnotation(1);
    const b = MessageAnnotations.getAnnotation(1);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('getAllAnnotations', () => {
  test('returns empty array when no annotations', () => {
    expect(MessageAnnotations.getAllAnnotations()).toEqual([]);
  });

  test('returns sorted by messageIndex', () => {
    MessageAnnotations.addAnnotation(5, 'Five', 'note');
    MessageAnnotations.addAnnotation(2, 'Two', 'note');
    MessageAnnotations.addAnnotation(8, 'Eight', 'note');
    const all = MessageAnnotations.getAllAnnotations();
    expect(all.map(a => a.messageIndex)).toEqual([2, 5, 8]);
  });

  test('includes all fields', () => {
    MessageAnnotations.addAnnotation(1, 'Test', 'important');
    const all = MessageAnnotations.getAllAnnotations();
    expect(all[0]).toHaveProperty('text', 'Test');
    expect(all[0]).toHaveProperty('label', 'important');
    expect(all[0]).toHaveProperty('messageIndex', 1);
    expect(all[0]).toHaveProperty('createdAt');
    expect(all[0]).toHaveProperty('updatedAt');
  });
});

describe('getCount', () => {
  test('starts at zero', () => {
    expect(MessageAnnotations.getCount()).toBe(0);
  });

  test('increments with additions', () => {
    MessageAnnotations.addAnnotation(1, 'A', 'note');
    MessageAnnotations.addAnnotation(2, 'B', 'note');
    expect(MessageAnnotations.getCount()).toBe(2);
  });

  test('decrements on removal', () => {
    MessageAnnotations.addAnnotation(1, 'A', 'note');
    MessageAnnotations.addAnnotation(2, 'B', 'note');
    MessageAnnotations.removeAnnotation(1);
    expect(MessageAnnotations.getCount()).toBe(1);
  });
});

describe('hasAnnotation', () => {
  test('returns false when not present', () => {
    expect(MessageAnnotations.hasAnnotation(1)).toBe(false);
  });

  test('returns true when present', () => {
    MessageAnnotations.addAnnotation(1, 'Test', 'note');
    expect(MessageAnnotations.hasAnnotation(1)).toBe(true);
  });

  test('returns false after removal', () => {
    MessageAnnotations.addAnnotation(1, 'Test', 'note');
    MessageAnnotations.removeAnnotation(1);
    expect(MessageAnnotations.hasAnnotation(1)).toBe(false);
  });
});

describe('clearAll', () => {
  test('clears all annotations and returns count', () => {
    MessageAnnotations.addAnnotation(1, 'A', 'note');
    MessageAnnotations.addAnnotation(2, 'B', 'note');
    MessageAnnotations.addAnnotation(3, 'C', 'note');
    expect(MessageAnnotations.clearAll()).toBe(3);
    expect(MessageAnnotations.getCount()).toBe(0);
  });

  test('returns 0 when already empty', () => {
    expect(MessageAnnotations.clearAll()).toBe(0);
  });
});

// ── Labels ──

describe('getLabels', () => {
  test('returns 6 label types', () => {
    const labels = MessageAnnotations.getLabels();
    expect(labels.length).toBe(6);
  });

  test('each label has id, name, color, icon', () => {
    const labels = MessageAnnotations.getLabels();
    labels.forEach(l => {
      expect(l).toHaveProperty('id');
      expect(l).toHaveProperty('name');
      expect(l).toHaveProperty('color');
      expect(l).toHaveProperty('icon');
    });
  });

  test('includes expected label ids', () => {
    const ids = MessageAnnotations.getLabels().map(l => l.id);
    expect(ids).toContain('note');
    expect(ids).toContain('important');
    expect(ids).toContain('correction');
    expect(ids).toContain('question');
    expect(ids).toContain('todo');
    expect(ids).toContain('reference');
  });

  test('returns copies', () => {
    const a = MessageAnnotations.getLabels();
    const b = MessageAnnotations.getLabels();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ── All label types ──

describe('label types', () => {
  test('note label', () => {
    const result = MessageAnnotations.addAnnotation(1, 'A note', 'note');
    expect(result.label).toBe('note');
  });

  test('important label', () => {
    const result = MessageAnnotations.addAnnotation(1, 'Important', 'important');
    expect(result.label).toBe('important');
  });

  test('correction label', () => {
    const result = MessageAnnotations.addAnnotation(1, 'Fix this', 'correction');
    expect(result.label).toBe('correction');
  });

  test('question label', () => {
    const result = MessageAnnotations.addAnnotation(1, 'Why?', 'question');
    expect(result.label).toBe('question');
  });

  test('todo label', () => {
    const result = MessageAnnotations.addAnnotation(1, 'Do this', 'todo');
    expect(result.label).toBe('todo');
  });

  test('reference label', () => {
    const result = MessageAnnotations.addAnnotation(1, 'See also', 'reference');
    expect(result.label).toBe('reference');
  });
});

// ── Filter & Search ──

describe('getByLabel', () => {
  test('filters by label', () => {
    MessageAnnotations.addAnnotation(1, 'Note 1', 'note');
    MessageAnnotations.addAnnotation(2, 'Important', 'important');
    MessageAnnotations.addAnnotation(3, 'Note 2', 'note');
    const notes = MessageAnnotations.getByLabel('note');
    expect(notes.length).toBe(2);
    expect(notes.every(a => a.label === 'note')).toBe(true);
  });

  test('returns empty for non-existent label', () => {
    MessageAnnotations.addAnnotation(1, 'Test', 'note');
    expect(MessageAnnotations.getByLabel('nonexistent')).toEqual([]);
  });
});

describe('search', () => {
  test('finds annotations by text', () => {
    MessageAnnotations.addAnnotation(1, 'Hello world', 'note');
    MessageAnnotations.addAnnotation(2, 'Goodbye', 'note');
    const results = MessageAnnotations.search('hello');
    expect(results.length).toBe(1);
    expect(results[0].text).toBe('Hello world');
  });

  test('case insensitive', () => {
    MessageAnnotations.addAnnotation(1, 'UPPERCASE', 'note');
    const results = MessageAnnotations.search('uppercase');
    expect(results.length).toBe(1);
  });

  test('returns empty for no match', () => {
    MessageAnnotations.addAnnotation(1, 'Test', 'note');
    expect(MessageAnnotations.search('xyz')).toEqual([]);
  });

  test('returns empty for null query', () => {
    expect(MessageAnnotations.search(null)).toEqual([]);
  });

  test('returns empty for empty query', () => {
    expect(MessageAnnotations.search('')).toEqual([]);
  });

  test('finds partial matches', () => {
    MessageAnnotations.addAnnotation(1, 'This is a longer note', 'note');
    const results = MessageAnnotations.search('longer');
    expect(results.length).toBe(1);
  });
});

// ── Export ──

describe('exportAnnotations', () => {
  test('exports all annotations with metadata', () => {
    MessageAnnotations.addAnnotation(1, 'Test note', 'important');
    const exported = MessageAnnotations.exportAnnotations();
    expect(exported.length).toBe(1);
    expect(exported[0]).toHaveProperty('messageIndex', 1);
    expect(exported[0]).toHaveProperty('note', 'Test note');
    expect(exported[0]).toHaveProperty('label', 'Important');
    expect(exported[0]).toHaveProperty('createdAt');
    expect(exported[0]).toHaveProperty('updatedAt');
  });

  test('exports empty array when no annotations', () => {
    expect(MessageAnnotations.exportAnnotations()).toEqual([]);
  });

  test('includes message preview when ConversationManager available', () => {
    ConversationManager.addMessage('system', 'System prompt');
    ConversationManager.addMessage('user', 'Hello there');
    MessageAnnotations.addAnnotation(1, 'About this', 'note');
    const exported = MessageAnnotations.exportAnnotations();
    expect(exported[0]).toHaveProperty('messagePreview');
    expect(exported[0]).toHaveProperty('messageRole');
  });
});

// ── Persistence ──

describe('persistence', () => {
  test('saves to localStorage on add', () => {
    MessageAnnotations.addAnnotation(1, 'Persisted', 'note');
    const stored = localStorage.getItem('agenticchat_annotations');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored);
    expect(parsed['1']).toBeDefined();
    expect(parsed['1'].text).toBe('Persisted');
  });

  test('saves to localStorage on remove', () => {
    MessageAnnotations.addAnnotation(1, 'To remove', 'note');
    MessageAnnotations.removeAnnotation(1);
    const stored = localStorage.getItem('agenticchat_annotations');
    const parsed = JSON.parse(stored);
    expect(parsed['1']).toBeUndefined();
  });

  test('saves to localStorage on clearAll', () => {
    MessageAnnotations.addAnnotation(1, 'A', 'note');
    MessageAnnotations.addAnnotation(2, 'B', 'note');
    MessageAnnotations.clearAll();
    const stored = localStorage.getItem('agenticchat_annotations');
    const parsed = JSON.parse(stored);
    expect(Object.keys(parsed).length).toBe(0);
  });
});

// ── UI: renderBadges ──

describe('renderBadges', () => {
  test('adds annotation badge to annotated message', () => {
    const output = document.getElementById('chat-output');
    output.innerHTML = '<div class="chat-msg">Message 1</div>';
    MessageAnnotations.addAnnotation(1, 'A note', 'note');
    MessageAnnotations.renderBadges();
    const badge = output.querySelector('.ann-badge');
    expect(badge).not.toBeNull();
  });

  test('does not add badge to unannotated message', () => {
    const output = document.getElementById('chat-output');
    output.innerHTML = '<div class="chat-msg">Message 1</div>';
    MessageAnnotations.renderBadges();
    const badge = output.querySelector('.ann-badge');
    expect(badge).toBeNull();
  });

  test('adds add-annotation button to every message', () => {
    const output = document.getElementById('chat-output');
    output.innerHTML = '<div class="chat-msg">Msg 1</div><div class="chat-msg">Msg 2</div>';
    MessageAnnotations.renderBadges();
    const addBtns = output.querySelectorAll('.ann-add-btn');
    expect(addBtns.length).toBe(2);
  });

  test('badge shows correct label icon for important', () => {
    const output = document.getElementById('chat-output');
    output.innerHTML = '<div class="chat-msg">Message</div>';
    MessageAnnotations.addAnnotation(1, 'Star this', 'important');
    MessageAnnotations.renderBadges();
    const badge = output.querySelector('.ann-badge');
    expect(badge.textContent).toBe('⭐');
  });

  test('badge shows correct label icon for correction', () => {
    const output = document.getElementById('chat-output');
    output.innerHTML = '<div class="chat-msg">Message</div>';
    MessageAnnotations.addAnnotation(1, 'Wrong answer', 'correction');
    MessageAnnotations.renderBadges();
    const badge = output.querySelector('.ann-badge');
    expect(badge.textContent).toBe('✏️');
  });
});

// ── UI: Panel ──

describe('panel', () => {
  test('openPanel creates panel element', () => {
    MessageAnnotations.openPanel();
    const panel = document.getElementById('ann-panel');
    expect(panel).not.toBeNull();
    expect(panel.classList.contains('ann-open')).toBe(true);
    MessageAnnotations.closePanel();
  });

  test('closePanel hides panel', () => {
    MessageAnnotations.openPanel();
    MessageAnnotations.closePanel();
    const panel = document.getElementById('ann-panel');
    expect(panel.classList.contains('ann-open')).toBe(false);
  });

  test('togglePanel opens when closed', () => {
    MessageAnnotations.togglePanel();
    const panel = document.getElementById('ann-panel');
    expect(panel.classList.contains('ann-open')).toBe(true);
    MessageAnnotations.closePanel();
  });

  test('togglePanel closes when open', () => {
    MessageAnnotations.openPanel();
    MessageAnnotations.togglePanel();
    const panel = document.getElementById('ann-panel');
    expect(panel.classList.contains('ann-open')).toBe(false);
  });

  test('panel shows empty state message when no annotations', () => {
    MessageAnnotations.openPanel();
    const body = document.getElementById('ann-panel-body');
    expect(body.textContent).toContain('No annotations yet');
    MessageAnnotations.closePanel();
  });

  test('panel shows annotation items when annotations exist', () => {
    MessageAnnotations.addAnnotation(1, 'Test note', 'note');
    MessageAnnotations.openPanel();
    const items = document.querySelectorAll('.ann-item');
    expect(items.length).toBe(1);
    MessageAnnotations.closePanel();
  });

  test('panel shows multiple items sorted', () => {
    MessageAnnotations.addAnnotation(3, 'Third', 'question');
    MessageAnnotations.addAnnotation(1, 'First', 'note');
    MessageAnnotations.addAnnotation(2, 'Second', 'important');
    MessageAnnotations.openPanel();
    const items = document.querySelectorAll('.ann-item');
    expect(items.length).toBe(3);
    MessageAnnotations.closePanel();
  });
});

// ── Edge cases ──

describe('edge cases', () => {
  test('multiple annotations on different messages', () => {
    MessageAnnotations.addAnnotation(1, 'First', 'note');
    MessageAnnotations.addAnnotation(2, 'Second', 'important');
    MessageAnnotations.addAnnotation(3, 'Third', 'question');
    expect(MessageAnnotations.getCount()).toBe(3);
    expect(MessageAnnotations.getAnnotation(1).label).toBe('note');
    expect(MessageAnnotations.getAnnotation(2).label).toBe('important');
    expect(MessageAnnotations.getAnnotation(3).label).toBe('question');
  });

  test('messageIndex 0 is valid', () => {
    const result = MessageAnnotations.addAnnotation(0, 'System note', 'note');
    expect(result).not.toBeNull();
  });

  test('large messageIndex works', () => {
    const result = MessageAnnotations.addAnnotation(9999, 'Far away', 'note');
    expect(result).not.toBeNull();
    expect(result.messageIndex).toBe(9999);
  });

  test('special characters in text', () => {
    const text = 'Note with <html> & "quotes" and \'apostrophes\'';
    const result = MessageAnnotations.addAnnotation(1, text, 'note');
    expect(result.text).toBe(text);
  });

  test('unicode in text', () => {
    const text = 'Emoji note 🎉 with 中文';
    const result = MessageAnnotations.addAnnotation(1, text, 'note');
    expect(result.text).toBe(text);
  });

  test('re-render badges does not duplicate', () => {
    const output = document.getElementById('chat-output');
    output.innerHTML = '<div class="chat-msg">Message</div>';
    MessageAnnotations.addAnnotation(1, 'Note', 'note');
    MessageAnnotations.renderBadges();
    MessageAnnotations.renderBadges();
    const badges = output.querySelectorAll('.ann-badge');
    expect(badges.length).toBe(1);
  });

  test('add button not duplicated on re-render', () => {
    const output = document.getElementById('chat-output');
    output.innerHTML = '<div class="chat-msg">Message</div>';
    MessageAnnotations.renderBadges();
    MessageAnnotations.renderBadges();
    const addBtns = output.querySelectorAll('.ann-add-btn');
    expect(addBtns.length).toBe(1);
  });
});
