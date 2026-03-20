/**
 * @jest-environment jsdom
 *
 * Tests for PreferencesPanel module (agenticchat)
 *
 * Covers defaults, preference merging, and validation logic.
 */

'use strict';

/* ── Replicate defaults and logic from app.js ───────────── */

const DEFAULTS = Object.freeze({
  autoSave: true,
  maxHistoryPairs: 20,
  maxInputChars: 50000,
  streaming: true,
  sandboxTimeoutMs: 30000,
  fontSize: 14,
  messageSounds: false,
  compactMode: false,
  codeLineNumbers: false,
  timestampFormat: '12h'
});

function mergePrefs(saved) {
  const prefs = { ...DEFAULTS };
  if (saved && typeof saved === 'object') {
    Object.assign(prefs, saved);
  }
  return prefs;
}

/* ── Defaults ───────────── */

describe('PreferencesPanel — defaults', () => {
  test('has all expected keys', () => {
    const keys = ['autoSave', 'maxHistoryPairs', 'maxInputChars', 'streaming',
      'sandboxTimeoutMs', 'fontSize', 'messageSounds', 'compactMode',
      'codeLineNumbers', 'timestampFormat'];
    for (const key of keys) {
      expect(DEFAULTS).toHaveProperty(key);
    }
  });

  test('streaming is on by default', () => {
    expect(DEFAULTS.streaming).toBe(true);
  });

  test('autoSave is on by default', () => {
    expect(DEFAULTS.autoSave).toBe(true);
  });

  test('compactMode is off by default', () => {
    expect(DEFAULTS.compactMode).toBe(false);
  });

  test('fontSize defaults to 14', () => {
    expect(DEFAULTS.fontSize).toBe(14);
  });

  test('timestampFormat defaults to 12h', () => {
    expect(DEFAULTS.timestampFormat).toBe('12h');
  });

  test('sandboxTimeoutMs defaults to 30s', () => {
    expect(DEFAULTS.sandboxTimeoutMs).toBe(30000);
  });

  test('defaults are frozen', () => {
    expect(Object.isFrozen(DEFAULTS)).toBe(true);
  });
});

/* ── Preference merging ───────────── */

describe('PreferencesPanel — mergePrefs', () => {
  test('returns defaults when saved is null', () => {
    const prefs = mergePrefs(null);
    expect(prefs).toEqual({ ...DEFAULTS });
  });

  test('returns defaults when saved is undefined', () => {
    const prefs = mergePrefs(undefined);
    expect(prefs).toEqual({ ...DEFAULTS });
  });

  test('returns defaults when saved is not an object', () => {
    const prefs = mergePrefs('not an object');
    expect(prefs).toEqual({ ...DEFAULTS });
  });

  test('overrides individual keys from saved', () => {
    const prefs = mergePrefs({ fontSize: 18, streaming: false });
    expect(prefs.fontSize).toBe(18);
    expect(prefs.streaming).toBe(false);
    expect(prefs.autoSave).toBe(true); // default preserved
  });

  test('preserves unknown keys from saved', () => {
    const prefs = mergePrefs({ customKey: 'custom' });
    expect(prefs.customKey).toBe('custom');
  });

  test('does not mutate DEFAULTS', () => {
    mergePrefs({ fontSize: 20 });
    expect(DEFAULTS.fontSize).toBe(14);
  });

  test('empty object returns defaults', () => {
    const prefs = mergePrefs({});
    expect(prefs).toEqual({ ...DEFAULTS });
  });
});

/* ── Timeout conversion ───────────── */

describe('PreferencesPanel — timeout conversion', () => {
  test('seconds to milliseconds', () => {
    const seconds = 15;
    expect(seconds * 1000).toBe(15000);
  });

  test('milliseconds to seconds for display', () => {
    const ms = 30000;
    expect(Math.round(ms / 1000)).toBe(30);
  });
});

/* ── Value validation patterns ───────────── */

describe('PreferencesPanel — value bounds', () => {
  test('fontSize should be clamped 10-24', () => {
    const clamp = (v) => Math.max(10, Math.min(24, v));
    expect(clamp(8)).toBe(10);
    expect(clamp(14)).toBe(14);
    expect(clamp(30)).toBe(24);
  });

  test('maxHistoryPairs should be clamped 1-50', () => {
    const clamp = (v) => Math.max(1, Math.min(50, v));
    expect(clamp(0)).toBe(1);
    expect(clamp(20)).toBe(20);
    expect(clamp(100)).toBe(50);
  });

  test('sandboxTimeoutMs 5-120 seconds', () => {
    const clampSec = (v) => Math.max(5, Math.min(120, v));
    expect(clampSec(3)).toBe(5);
    expect(clampSec(30)).toBe(30);
    expect(clampSec(200)).toBe(120);
  });
});
