/**
 * @jest-environment jsdom
 */
const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || function() {};

global.SafeStorage = {
  _data: {},
  get(k) { return this._data[k] || null; },
  set(k, v) { this._data[k] = v; },
  remove(k) { delete this._data[k]; },
  clear() { this._data = {}; }
};

global.SessionManager = {
  _sessions: [],
  getAll() { return this._sessions; }
};

function createStreakTracker() {
  const MILESTONES = [
    { days: 3, emoji: '🌱', label: 'Seedling', desc: 'Chat 3 days in a row' },
    { days: 7, emoji: '🔥', label: 'On Fire', desc: 'One week streak' },
    { days: 14, emoji: '⚡', label: 'Unstoppable', desc: 'Two week streak' },
    { days: 30, emoji: '🏆', label: 'Champion', desc: '30-day streak' },
    { days: 60, emoji: '💎', label: 'Diamond', desc: '60-day streak' },
    { days: 100, emoji: '👑', label: 'Legend', desc: '100-day streak' },
    { days: 365, emoji: '🌟', label: 'Eternal', desc: 'Full year streak' },
  ];

  function _getSessions() {
    try {
      const all = SessionManager.getAll();
      return Array.isArray(all) ? all : [];
    } catch { return []; }
  }

  function _getActiveDates() {
    const sessions = _getSessions();
    const dates = new Set();
    for (const s of sessions) {
      if (s.createdAt) dates.add(s.createdAt.substring(0, 10));
      if (s.updatedAt) dates.add(s.updatedAt.substring(0, 10));
      if (Array.isArray(s.messages)) {
        for (const m of s.messages) {
          if (m.timestamp) dates.add(new Date(m.timestamp).toISOString().substring(0, 10));
        }
      }
    }
    return dates;
  }

  function _calcStreaks(dateSet) {
    if (dateSet.size === 0) return { current: 0, longest: 0, totalDays: 0, streaks: [] };
    const sorted = [...dateSet].sort();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().substring(0, 10);
    const yesterdayDate = new Date(today);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = yesterdayDate.toISOString().substring(0, 10);

    let longest = 1;
    let currentStreak = 1;
    const streaks = [{ start: sorted[0], length: 1 }];
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1]);
      const curr = new Date(sorted[i]);
      const diffDays = Math.round((curr - prev) / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        currentStreak++;
        streaks[streaks.length - 1].length = currentStreak;
      } else {
        currentStreak = 1;
        streaks.push({ start: sorted[i], length: 1 });
      }
      if (currentStreak > longest) longest = currentStreak;
    }

    const lastDate = sorted[sorted.length - 1];
    let current = 0;
    if (lastDate === todayStr || lastDate === yesterdayStr) {
      current = streaks[streaks.length - 1].length;
    }

    return { current, longest, totalDays: dateSet.size, streaks };
  }

  function _buildCalendar(dateSet) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cells = [];
    for (let i = 89; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const ds = d.toISOString().substring(0, 10);
      const active = dateSet.has(ds);
      cells.push(`<div class="streak-cal-cell ${active ? 'streak-cal-active' : ''}"></div>`);
    }
    return cells.join('');
  }

  function _buildMilestones(longestStreak) {
    return MILESTONES.map(m => {
      const achieved = longestStreak >= m.days;
      return `<div class="streak-milestone ${achieved ? 'streak-milestone-achieved' : ''}">${m.emoji} ${m.label}</div>`;
    }).join('');
  }

  function _buildWeekdayStats(dateSet) {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (const ds of dateSet) {
      const d = new Date(ds + 'T00:00:00');
      counts[d.getDay()]++;
    }
    return counts;
  }

  let _overlay = null;
  let _isOpen = false;

  function open() {
    if (_overlay) _overlay.remove();
    _overlay = document.createElement('div');
    _overlay.id = 'streak-overlay';
    document.body.appendChild(_overlay);
    _isOpen = true;
  }

  function close() {
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _isOpen = false;
  }

  function toggle() { _isOpen ? close() : open(); }

  return {
    open, close, toggle, isOpen: () => _isOpen,
    _getActiveDates, _calcStreaks, _buildCalendar, _buildMilestones, _buildWeekdayStats,
    MILESTONES
  };
}

let tracker;
beforeEach(() => {
  SafeStorage.clear();
  SessionManager._sessions = [];
  tracker = createStreakTracker();
});

afterEach(() => {
  tracker.close();
});

describe('StreakTracker', () => {

  test('returns empty active dates when no sessions', () => {
    const dates = tracker._getActiveDates();
    expect(dates.size).toBe(0);
  });

  test('extracts dates from createdAt', () => {
    SessionManager._sessions = [
      { id: '1', createdAt: '2026-03-10T10:00:00Z', messages: [] }
    ];
    const dates = tracker._getActiveDates();
    expect(dates.has('2026-03-10')).toBe(true);
  });

  test('extracts dates from updatedAt', () => {
    SessionManager._sessions = [
      { id: '1', updatedAt: '2026-03-12T15:00:00Z', messages: [] }
    ];
    const dates = tracker._getActiveDates();
    expect(dates.has('2026-03-12')).toBe(true);
  });

  test('deduplicates dates', () => {
    SessionManager._sessions = [
      { id: '1', createdAt: '2026-03-10T10:00:00Z', updatedAt: '2026-03-10T20:00:00Z', messages: [] },
      { id: '2', createdAt: '2026-03-10T12:00:00Z', messages: [] }
    ];
    const dates = tracker._getActiveDates();
    expect(dates.size).toBe(1);
  });

  test('calcStreaks returns zeros for empty set', () => {
    const result = tracker._calcStreaks(new Set());
    expect(result.current).toBe(0);
    expect(result.longest).toBe(0);
    expect(result.totalDays).toBe(0);
  });

  test('calcStreaks finds single day', () => {
    const result = tracker._calcStreaks(new Set(['2026-01-15']));
    expect(result.totalDays).toBe(1);
    expect(result.longest).toBe(1);
  });

  test('calcStreaks finds consecutive streak', () => {
    const dates = new Set(['2026-03-10', '2026-03-11', '2026-03-12']);
    const result = tracker._calcStreaks(dates);
    expect(result.longest).toBe(3);
    expect(result.totalDays).toBe(3);
  });

  test('calcStreaks finds longest among multiple streaks', () => {
    const dates = new Set(['2026-01-01', '2026-01-02', '2026-02-10', '2026-02-11', '2026-02-12', '2026-02-13']);
    const result = tracker._calcStreaks(dates);
    expect(result.longest).toBe(4);
  });

  test('calcStreaks current streak includes today', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().substring(0, 10);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().substring(0, 10);
    const dates = new Set([yesterdayStr, todayStr]);
    const result = tracker._calcStreaks(dates);
    expect(result.current).toBe(2);
  });

  test('calcStreaks current streak includes yesterday', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const dates = new Set([twoDaysAgo.toISOString().substring(0, 10), yesterday.toISOString().substring(0, 10)]);
    const result = tracker._calcStreaks(dates);
    expect(result.current).toBe(2);
  });

  test('calcStreaks current is 0 when last date is old', () => {
    const dates = new Set(['2025-01-01', '2025-01-02', '2025-01-03']);
    const result = tracker._calcStreaks(dates);
    expect(result.current).toBe(0);
    expect(result.longest).toBe(3);
  });

  test('buildCalendar produces 90 cells', () => {
    const html = tracker._buildCalendar(new Set());
    const cellCount = (html.match(/streak-cal-cell/g) || []).length;
    expect(cellCount).toBe(90);
  });

  test('buildCalendar marks active dates', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().substring(0, 10);
    const html = tracker._buildCalendar(new Set([todayStr]));
    expect(html).toContain('streak-cal-active');
  });

  test('buildCalendar no active cells when empty', () => {
    const html = tracker._buildCalendar(new Set());
    expect(html).not.toContain('streak-cal-active');
  });

  test('buildMilestones marks achieved milestones', () => {
    const html = tracker._buildMilestones(7);
    expect(html).toContain('streak-milestone-achieved');
    expect(html.match(/streak-milestone-achieved/g).length).toBe(2); // 3-day and 7-day
  });

  test('buildMilestones none achieved at 0', () => {
    const html = tracker._buildMilestones(0);
    expect(html).not.toContain('streak-milestone-achieved');
  });

  test('buildMilestones all achieved at 365', () => {
    const html = tracker._buildMilestones(365);
    const count = (html.match(/streak-milestone-achieved/g) || []).length;
    expect(count).toBe(7);
  });

  test('buildWeekdayStats returns 7-element array', () => {
    const counts = tracker._buildWeekdayStats(new Set());
    expect(counts).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  test('buildWeekdayStats counts correctly', () => {
    // 2026-03-16 is a Monday
    const counts = tracker._buildWeekdayStats(new Set(['2026-03-16']));
    expect(counts[1]).toBe(1); // Monday
  });

  test('open creates overlay', () => {
    tracker.open();
    expect(document.getElementById('streak-overlay')).toBeTruthy();
    expect(tracker.isOpen()).toBe(true);
  });

  test('close removes overlay', () => {
    tracker.open();
    tracker.close();
    expect(document.getElementById('streak-overlay')).toBeNull();
    expect(tracker.isOpen()).toBe(false);
  });

  test('toggle opens when closed', () => {
    tracker.toggle();
    expect(tracker.isOpen()).toBe(true);
  });

  test('toggle closes when open', () => {
    tracker.open();
    tracker.toggle();
    expect(tracker.isOpen()).toBe(false);
  });

  test('handles sessions with message timestamps', () => {
    SessionManager._sessions = [
      { id: '1', messages: [{ role: 'user', content: 'hi', timestamp: '2026-03-15T10:00:00Z' }] }
    ];
    const dates = tracker._getActiveDates();
    expect(dates.has('2026-03-15')).toBe(true);
  });

  test('handles sessions with no messages array', () => {
    SessionManager._sessions = [{ id: '1', createdAt: '2026-03-10T10:00:00Z' }];
    const dates = tracker._getActiveDates();
    expect(dates.size).toBe(1);
  });

  test('MILESTONES has 7 entries', () => {
    expect(tracker.MILESTONES).toHaveLength(7);
  });

  test('gap in dates creates separate streaks', () => {
    const dates = new Set(['2026-03-01', '2026-03-02', '2026-03-05', '2026-03-06']);
    const result = tracker._calcStreaks(dates);
    expect(result.longest).toBe(2);
    expect(result.streaks.length).toBe(2);
  });

  test('single date streak has length 1', () => {
    const dates = new Set(['2026-03-01']);
    const result = tracker._calcStreaks(dates);
    expect(result.longest).toBe(1);
    expect(result.streaks.length).toBe(1);
    expect(result.streaks[0].length).toBe(1);
  });
});
