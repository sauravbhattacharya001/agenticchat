/**
 * @jest-environment jsdom
 */
const { describe, test, expect, beforeEach } = require('@jest/globals');

/* ---------- minimal DOM helpers ---------- */
beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

/* ---------- inline SafeStorage stub ---------- */
function makeSafeStorage() {
  let store = {};
  return {
    get(k) { return store[k] ?? null; },
    set(k, v) { store[k] = String(v); },
    remove(k) { delete store[k]; },
    clear() { store = {}; },
    isAvailable() { return true; },
    get length() { return Object.keys(store).length; },
    key(i) { return Object.keys(store)[i] ?? null; },
  };
}

/* ---------- inline FocusTimer (extracted logic) ---------- */
function createFocusTimer(SafeStorage) {
  const STORAGE_KEY = 'ac_focus_timer';
  const DEFAULTS = { work: 25, short: 5, long: 15, longAfter: 4 };

  let _state = 'idle';
  let _remaining = 0;
  let _interval = null;
  let _sessionsCompleted = 0;
  let _totalFocusSeconds = 0;
  let _todaySessions = 0;
  let _todayDate = '';
  let _settings = { ...DEFAULTS };
  let _history = [];
  let _completions = [];

  function _load() {
    try {
      const raw = SafeStorage.get(STORAGE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        _sessionsCompleted = d.sessionsCompleted || 0;
        _totalFocusSeconds = d.totalFocusSeconds || 0;
        _todaySessions = d.todaySessions || 0;
        _todayDate = d.todayDate || '';
        if (d.settings) Object.assign(_settings, d.settings);
        _history = d.history || [];
      }
    } catch (_) {}
    const today = new Date().toISOString().slice(0, 10);
    if (_todayDate !== today) {
      if (_todayDate && _todaySessions > 0) {
        _history.push({ date: _todayDate, sessions: _todaySessions, focusMinutes: Math.round(_todaySessions * _settings.work) });
        if (_history.length > 30) _history = _history.slice(-30);
      }
      _todaySessions = 0;
      _todayDate = today;
    }
  }

  function _save() {
    SafeStorage.set(STORAGE_KEY, JSON.stringify({
      sessionsCompleted: _sessionsCompleted,
      totalFocusSeconds: _totalFocusSeconds,
      todaySessions: _todaySessions,
      todayDate: _todayDate,
      settings: _settings,
      history: _history
    }));
  }

  function _formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  }

  function start() {
    if (_state === 'idle') {
      _state = 'work';
      _remaining = _settings.work * 60;
    }
    if (_interval) clearInterval(_interval);
    _interval = setInterval(() => {
      _remaining--;
      if (_state === 'work') _totalFocusSeconds++;
      if (_remaining <= 0) {
        clearInterval(_interval);
        _interval = null;
        if (_state === 'work') {
          _sessionsCompleted++;
          _todaySessions++;
          _completions.push('work');
          const isLong = _todaySessions % _settings.longAfter === 0;
          _state = isLong ? 'long-break' : 'short-break';
          _remaining = (isLong ? _settings.long : _settings.short) * 60;
          _interval = setInterval(arguments.callee, 1000);
        } else {
          _completions.push(_state);
          _state = 'idle';
        }
        _save();
      }
    }, 1000);
  }

  function pause() {
    if (_interval) { clearInterval(_interval); _interval = null; }
  }

  function skip() {
    if (_interval) { clearInterval(_interval); _interval = null; }
    if (_state === 'work') {
      const isLong = (_todaySessions + 1) % _settings.longAfter === 0;
      _state = isLong ? 'long-break' : 'short-break';
      _remaining = (isLong ? _settings.long : _settings.short) * 60;
    } else {
      _state = 'idle';
    }
  }

  function reset() {
    if (_interval) { clearInterval(_interval); _interval = null; }
    _state = 'idle';
    _remaining = 0;
  }

  function setSettings(s) {
    Object.assign(_settings, s);
    _save();
  }

  _load();

  return {
    start, pause, skip, reset, setSettings, _formatTime,
    getState: () => _state,
    getRemaining: () => _remaining,
    getTodaySessions: () => _todaySessions,
    getTotalSessions: () => _sessionsCompleted,
    getTotalFocusSeconds: () => _totalFocusSeconds,
    getSettings: () => ({ ..._settings }),
    getCompletions: () => _completions,
    getHistory: () => _history,
    _save,
  };
}

describe('FocusTimer', () => {
  let ss, timer;

  beforeEach(() => {
    ss = makeSafeStorage();
    timer = createFocusTimer(ss);
  });

  test('starts in idle state', () => {
    expect(timer.getState()).toBe('idle');
    expect(timer.getRemaining()).toBe(0);
  });

  test('start begins work session with default 25 min', () => {
    timer.start();
    expect(timer.getState()).toBe('work');
    expect(timer.getRemaining()).toBe(25 * 60);
  });

  test('pause stops countdown', () => {
    timer.start();
    jest.advanceTimersByTime(5000);
    timer.pause();
    const r = timer.getRemaining();
    jest.advanceTimersByTime(5000);
    expect(timer.getRemaining()).toBe(r);
  });

  test('resume after pause continues from same point', () => {
    timer.start();
    jest.advanceTimersByTime(10000);
    timer.pause();
    const r = timer.getRemaining();
    timer.start();
    jest.advanceTimersByTime(5000);
    expect(timer.getRemaining()).toBe(r - 5);
  });

  test('reset returns to idle', () => {
    timer.start();
    jest.advanceTimersByTime(5000);
    timer.reset();
    expect(timer.getState()).toBe('idle');
    expect(timer.getRemaining()).toBe(0);
  });

  test('completing work session increments counters', () => {
    timer.setSettings({ work: 1, short: 1, long: 1, longAfter: 4 }); // 1 min
    timer = createFocusTimer(ss);
    timer.setSettings({ work: 1, short: 1, long: 1, longAfter: 4 });
    timer.start();
    jest.advanceTimersByTime(61 * 1000); // just over 1 minute
    expect(timer.getTodaySessions()).toBe(1);
    expect(timer.getTotalSessions()).toBe(1);
  });

  test('tracks total focus seconds', () => {
    timer.start();
    jest.advanceTimersByTime(10000);
    expect(timer.getTotalFocusSeconds()).toBeGreaterThanOrEqual(9);
  });

  test('skip during work goes to break', () => {
    timer.start();
    timer.skip();
    expect(timer.getState()).toBe('short-break');
  });

  test('skip during break goes to idle', () => {
    timer.start();
    timer.skip(); // now in short-break
    timer.skip(); // should go idle
    expect(timer.getState()).toBe('idle');
  });

  test('custom settings are applied', () => {
    timer.setSettings({ work: 50 });
    timer = createFocusTimer(ss);
    timer.start();
    expect(timer.getRemaining()).toBe(50 * 60);
  });

  test('formatTime formats correctly', () => {
    expect(timer._formatTime(0)).toBe('00:00');
    expect(timer._formatTime(65)).toBe('01:05');
    expect(timer._formatTime(3600)).toBe('60:00');
  });

  test('settings have valid defaults', () => {
    const s = timer.getSettings();
    expect(s.work).toBe(25);
    expect(s.short).toBe(5);
    expect(s.long).toBe(15);
    expect(s.longAfter).toBe(4);
  });

  test('persists state to storage', () => {
    timer.start();
    jest.advanceTimersByTime(5000);
    timer._save();
    const raw = ss.get('ac_focus_timer');
    expect(raw).toBeTruthy();
    const d = JSON.parse(raw);
    expect(d.totalFocusSeconds).toBeGreaterThan(0);
  });

  test('loads state from storage', () => {
    ss.set('ac_focus_timer', JSON.stringify({
      sessionsCompleted: 10,
      totalFocusSeconds: 5000,
      todaySessions: 3,
      todayDate: new Date().toISOString().slice(0, 10),
      settings: { work: 30, short: 5, long: 15, longAfter: 4 },
      history: []
    }));
    const t2 = createFocusTimer(ss);
    expect(t2.getTotalSessions()).toBe(10);
    expect(t2.getTodaySessions()).toBe(3);
  });

  test('long break triggers after longAfter sessions', () => {
    timer.setSettings({ work: 1, short: 1, long: 2, longAfter: 2 });
    timer = createFocusTimer(ss);
    timer.setSettings({ work: 1, short: 1, long: 2, longAfter: 2 });
    // Session 1
    timer.start();
    jest.advanceTimersByTime(61000);
    // After session 1: short break
    expect(timer.getState()).toBe('short-break');
    // Complete short break
    jest.advanceTimersByTime(61000);
    expect(timer.getState()).toBe('idle');
    // Session 2
    timer.start();
    jest.advanceTimersByTime(61000);
    // After session 2 (longAfter=2): long break
    expect(timer.getState()).toBe('long-break');
  });

  test('day rollover archives old day to history', () => {
    ss.set('ac_focus_timer', JSON.stringify({
      sessionsCompleted: 5,
      totalFocusSeconds: 2000,
      todaySessions: 3,
      todayDate: '2025-01-01',
      settings: { work: 25, short: 5, long: 15, longAfter: 4 },
      history: []
    }));
    const t2 = createFocusTimer(ss);
    expect(t2.getTodaySessions()).toBe(0); // reset for new day
    expect(t2.getHistory().length).toBe(1);
    expect(t2.getHistory()[0].date).toBe('2025-01-01');
    expect(t2.getHistory()[0].sessions).toBe(3);
  });
});
