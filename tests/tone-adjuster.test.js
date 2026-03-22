/**
 * @jest-environment jsdom
 */

/* global ToneAdjuster */

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('ToneAdjuster', () => {
  test('TONES array contains expected tone presets', () => {
    expect(ToneAdjuster.TONES).toBeDefined();
    expect(Array.isArray(ToneAdjuster.TONES)).toBe(true);
    expect(ToneAdjuster.TONES.length).toBeGreaterThanOrEqual(5);

    const ids = ToneAdjuster.TONES.map(t => t.id);
    expect(ids).toContain('formal');
    expect(ids).toContain('casual');
    expect(ids).toContain('concise');
    expect(ids).toContain('detailed');
    expect(ids).toContain('eli5');
  });

  test('each tone has id, label, and prompt', () => {
    for (const tone of ToneAdjuster.TONES) {
      expect(typeof tone.id).toBe('string');
      expect(typeof tone.label).toBe('string');
      expect(typeof tone.prompt).toBe('string');
      expect(tone.prompt.length).toBeGreaterThan(10);
    }
  });

  test('decorateOne adds tone button to assistant message element', () => {
    const msgEl = document.createElement('div');
    msgEl.className = 'history-msg assistant';
    const roleLabel = document.createElement('div');
    roleLabel.className = 'msg-role';
    roleLabel.textContent = '🤖 Assistant';
    msgEl.appendChild(roleLabel);

    ToneAdjuster.decorateOne(msgEl, 0);

    const btn = msgEl.querySelector('.tone-btn');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('🎭');
    expect(btn.title).toContain('tone');
  });

  test('decorateOne does not duplicate button on repeated calls', () => {
    const msgEl = document.createElement('div');
    msgEl.className = 'history-msg assistant';
    const roleLabel = document.createElement('div');
    roleLabel.className = 'msg-role';
    msgEl.appendChild(roleLabel);

    ToneAdjuster.decorateOne(msgEl, 0);
    ToneAdjuster.decorateOne(msgEl, 0);

    const buttons = msgEl.querySelectorAll('.tone-btn');
    expect(buttons.length).toBe(1);
  });

  test('decorateOne works without role label element', () => {
    const msgEl = document.createElement('div');
    msgEl.className = 'history-msg assistant';

    ToneAdjuster.decorateOne(msgEl, 0);

    const btn = msgEl.querySelector('.tone-btn');
    expect(btn).not.toBeNull();
  });
});
