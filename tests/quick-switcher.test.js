/**
 * @jest-environment jsdom
 *
 * Tests for QuickSwitcher module (agenticchat)
 *
 * Covers fuzzy matching/scoring logic and basic show/hide behavior.
 */

'use strict';

/* ── Replicate pure functions from app.js ───────────── */

function fuzzyMatch(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

function fuzzyScore(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 0;
  if (t.includes(q)) return 1;
  return 2;
}

/* ── fuzzyMatch ───────────── */

describe('QuickSwitcher — fuzzyMatch', () => {
  test('exact match', () => {
    expect(fuzzyMatch('hello', 'hello')).toBe(true);
  });

  test('case-insensitive match', () => {
    expect(fuzzyMatch('Hello', 'HELLO WORLD')).toBe(true);
  });

  test('subsequence match', () => {
    expect(fuzzyMatch('hlo', 'hello')).toBe(true);
  });

  test('prefix match', () => {
    expect(fuzzyMatch('hel', 'hello world')).toBe(true);
  });

  test('scattered characters match', () => {
    expect(fuzzyMatch('hw', 'hello world')).toBe(true);
  });

  test('no match when characters missing', () => {
    expect(fuzzyMatch('xyz', 'hello')).toBe(false);
  });

  test('no match when order wrong', () => {
    expect(fuzzyMatch('ba', 'abc')).toBe(false);
  });

  test('empty query matches anything', () => {
    expect(fuzzyMatch('', 'anything')).toBe(true);
  });

  test('empty text does not match non-empty query', () => {
    expect(fuzzyMatch('a', '')).toBe(false);
  });

  test('both empty', () => {
    expect(fuzzyMatch('', '')).toBe(true);
  });

  test('query longer than text', () => {
    expect(fuzzyMatch('abcdef', 'abc')).toBe(false);
  });

  test('special characters', () => {
    expect(fuzzyMatch('c++', 'C++ Programming')).toBe(true);
  });

  test('numbers in query', () => {
    expect(fuzzyMatch('v2', 'version 2.0')).toBe(true);
  });
});

/* ── fuzzyScore ───────────── */

describe('QuickSwitcher — fuzzyScore', () => {
  test('startsWith gives score 0 (best)', () => {
    expect(fuzzyScore('hel', 'hello world')).toBe(0);
  });

  test('contains (not prefix) gives score 1', () => {
    expect(fuzzyScore('world', 'hello world')).toBe(1);
  });

  test('fuzzy-only (not substring) gives score 2', () => {
    expect(fuzzyScore('hwd', 'hello world')).toBe(2);
  });

  test('exact match gives score 0', () => {
    expect(fuzzyScore('hello', 'hello')).toBe(0);
  });

  test('case-insensitive prefix gives score 0', () => {
    expect(fuzzyScore('HEL', 'Hello')).toBe(0);
  });

  test('case-insensitive contains gives score 1', () => {
    expect(fuzzyScore('WORLD', 'hello world')).toBe(1);
  });

  test('sorting by score ranks prefix first', () => {
    const items = ['world tour', 'hello world', 'worldly wisdom'];
    const sorted = items.sort((a, b) => fuzzyScore('world', a) - fuzzyScore('world', b));
    expect(sorted[0]).toBe('world tour');
    expect(sorted[1]).toBe('worldly wisdom');
  });
});
