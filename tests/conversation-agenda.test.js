/**
 * @jest-environment jsdom
 */

const { setupDOM, loadApp } = require('./setup');

beforeAll(() => {
  setupDOM();
  loadApp();
});

beforeEach(() => {
  localStorage.clear();
  ConversationAgenda._load();
  // Close panel if open
  ConversationAgenda.close();
});

describe('ConversationAgenda', () => {
  test('addGoal adds a goal and returns true', () => {
    expect(ConversationAgenda.addGoal('Understand hooks')).toBe(true);
    const goals = ConversationAgenda._goals();
    expect(goals).toHaveLength(1);
    expect(goals[0].text).toBe('Understand hooks');
    expect(goals[0].done).toBe(false);
    expect(goals[0].createdAt).toBeTruthy();
  });

  test('addGoal rejects empty text', () => {
    expect(ConversationAgenda.addGoal('')).toBe(false);
    expect(ConversationAgenda.addGoal('   ')).toBe(false);
    expect(ConversationAgenda._goals()).toHaveLength(0);
  });

  test('addGoal truncates text to MAX_GOAL_LENGTH', () => {
    const long = 'a'.repeat(300);
    ConversationAgenda.addGoal(long);
    expect(ConversationAgenda._goals()[0].text).toHaveLength(ConversationAgenda.MAX_GOAL_LENGTH);
  });

  test('addGoal respects MAX_GOALS limit', () => {
    for (let i = 0; i < ConversationAgenda.MAX_GOALS; i++) {
      ConversationAgenda.addGoal(`Goal ${i}`);
    }
    expect(ConversationAgenda.addGoal('One too many')).toBe(false);
    expect(ConversationAgenda._goals()).toHaveLength(ConversationAgenda.MAX_GOALS);
  });

  test('toggleGoal flips done state', () => {
    ConversationAgenda.addGoal('Test goal');
    expect(ConversationAgenda._goals()[0].done).toBe(false);
    ConversationAgenda.toggleGoal(0);
    expect(ConversationAgenda._goals()[0].done).toBe(true);
    ConversationAgenda.toggleGoal(0);
    expect(ConversationAgenda._goals()[0].done).toBe(false);
  });

  test('toggleGoal ignores invalid index', () => {
    ConversationAgenda.addGoal('Test');
    ConversationAgenda.toggleGoal(-1);
    ConversationAgenda.toggleGoal(5);
    expect(ConversationAgenda._goals()).toHaveLength(1);
  });

  test('removeGoal removes the correct goal', () => {
    ConversationAgenda.addGoal('A');
    ConversationAgenda.addGoal('B');
    ConversationAgenda.addGoal('C');
    ConversationAgenda.removeGoal(1);
    const texts = ConversationAgenda._goals().map(g => g.text);
    expect(texts).toEqual(['A', 'C']);
  });

  test('removeGoal ignores invalid index', () => {
    ConversationAgenda.addGoal('A');
    ConversationAgenda.removeGoal(10);
    expect(ConversationAgenda._goals()).toHaveLength(1);
  });

  test('clearDone removes only completed goals', () => {
    ConversationAgenda.addGoal('Done1');
    ConversationAgenda.addGoal('NotDone');
    ConversationAgenda.addGoal('Done2');
    ConversationAgenda.toggleGoal(0);
    ConversationAgenda.toggleGoal(2);
    ConversationAgenda.clearDone();
    const texts = ConversationAgenda._goals().map(g => g.text);
    expect(texts).toEqual(['NotDone']);
  });

  test('getProgress returns correct counts', () => {
    expect(ConversationAgenda.getProgress()).toEqual({ total: 0, done: 0, percent: 0 });
    ConversationAgenda.addGoal('A');
    ConversationAgenda.addGoal('B');
    ConversationAgenda.addGoal('C');
    ConversationAgenda.toggleGoal(0);
    const p = ConversationAgenda.getProgress();
    expect(p.total).toBe(3);
    expect(p.done).toBe(1);
    expect(p.percent).toBe(33);
  });

  test('getProgress 100% when all done', () => {
    ConversationAgenda.addGoal('A');
    ConversationAgenda.toggleGoal(0);
    expect(ConversationAgenda.getProgress().percent).toBe(100);
  });

  test('persists to localStorage', () => {
    ConversationAgenda.addGoal('Persist me');
    const raw = localStorage.getItem(ConversationAgenda.STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw);
    const sid = ConversationAgenda._sessionId();
    expect(parsed[sid]).toHaveLength(1);
    expect(parsed[sid][0].text).toBe('Persist me');
  });

  test('_load restores from localStorage', () => {
    ConversationAgenda.addGoal('Survive reload');
    ConversationAgenda._load();
    expect(ConversationAgenda._goals()[0].text).toBe('Survive reload');
  });

  test('open and close toggle panel visibility', () => {
    ConversationAgenda.open();
    const panel = document.getElementById('agenda-panel');
    expect(panel).toBeTruthy();
    expect(panel.classList.contains('agenda-open')).toBe(true);
    ConversationAgenda.close();
    expect(panel.classList.contains('agenda-open')).toBe(false);
  });

  test('toggle opens then closes', () => {
    ConversationAgenda.toggle();
    const panel = document.getElementById('agenda-panel');
    expect(panel.classList.contains('agenda-open')).toBe(true);
    ConversationAgenda.toggle();
    expect(panel.classList.contains('agenda-open')).toBe(false);
  });

  test('each goal gets a unique id', () => {
    ConversationAgenda.addGoal('A');
    ConversationAgenda.addGoal('B');
    const goals = ConversationAgenda._goals();
    expect(goals[0].id).not.toBe(goals[1].id);
  });

  test('STORAGE_KEY is ac-agenda', () => {
    expect(ConversationAgenda.STORAGE_KEY).toBe('ac-agenda');
  });

  test('MAX_GOALS is 50', () => {
    expect(ConversationAgenda.MAX_GOALS).toBe(50);
  });

  test('MAX_GOAL_LENGTH is 200', () => {
    expect(ConversationAgenda.MAX_GOAL_LENGTH).toBe(200);
  });

  test('panel renders goals correctly', () => {
    ConversationAgenda.addGoal('Goal 1');
    ConversationAgenda.addGoal('Goal 2');
    ConversationAgenda.open();
    const items = document.querySelectorAll('.agenda-item');
    expect(items).toHaveLength(2);
    expect(items[0].querySelector('.agenda-item-text').textContent).toBe('Goal 1');
  });

  test('panel shows empty message when no goals', () => {
    ConversationAgenda.open();
    const empty = document.querySelector('.agenda-empty');
    expect(empty).toBeTruthy();
    expect(empty.textContent).toContain('No goals');
  });

  test('progress bar updates on toggle', () => {
    ConversationAgenda.addGoal('A');
    ConversationAgenda.addGoal('B');
    ConversationAgenda.open();
    ConversationAgenda.toggleGoal(0);
    const fill = document.getElementById('agenda-fill');
    expect(fill.style.width).toBe('50%');
  });

  test('clearDone with no completed goals is a no-op', () => {
    ConversationAgenda.addGoal('A');
    ConversationAgenda.addGoal('B');
    ConversationAgenda.clearDone();
    expect(ConversationAgenda._goals()).toHaveLength(2);
  });

  test('escapes HTML in goal text', () => {
    ConversationAgenda.addGoal('<script>alert(1)</script>');
    ConversationAgenda.open();
    const text = document.querySelector('.agenda-item-text').innerHTML;
    expect(text).not.toContain('<script>');
    expect(text).toContain('&lt;script&gt;');
  });

  test('addGoal with null returns false', () => {
    expect(ConversationAgenda.addGoal(null)).toBe(false);
  });
});
