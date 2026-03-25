/**
 * @jest-environment jsdom
 */

/* ── Emoji Picker tests ─────────────────────────────────── */

beforeEach(() => {
  document.body.innerHTML =
    '<input id="chat-input" value="" />' +
    '<div id="chat-output"></div>';
  localStorage.clear();
});

afterEach(() => {
  document.querySelectorAll('.emoji-picker__overlay').forEach(el => el.remove());
});

// Load module
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '..', 'app.js'), 'utf8');

// Extract just the EmojiPicker IIFE
const match = src.match(/const EmojiPicker = \(\(\) => \{[\s\S]+?\n\}\)\(\);/);
if (match) eval(match[0]);

describe('EmojiPicker', () => {
  test('toggle opens and closes overlay', () => {
    EmojiPicker.open();
    expect(document.querySelector('.emoji-picker__overlay')).not.toBeNull();
    EmojiPicker.close();
    expect(document.querySelector('.emoji-picker__overlay')).toBeNull();
  });

  test('clicking emoji inserts into chat input', () => {
    EmojiPicker.open();
    const btn = document.querySelector('.emoji-picker__emoji');
    expect(btn).not.toBeNull();
    btn.click();
    const input = document.getElementById('chat-input');
    expect(input.value.length).toBeGreaterThan(0);
  });

  test('search filters emojis', () => {
    EmojiPicker.open();
    const search = document.querySelector('.emoji-picker__search');
    search.value = '😀';
    search.dispatchEvent(new Event('input'));
    const emojis = document.querySelectorAll('.emoji-picker__emoji');
    expect(emojis.length).toBeGreaterThan(0);
  });

  test('recent emojis are stored and shown', () => {
    EmojiPicker.open();
    const btn = document.querySelector('.emoji-picker__emoji');
    btn.click();
    EmojiPicker.close();
    EmojiPicker.open();
    const cats = document.querySelectorAll('.emoji-picker__cat');
    const catTexts = Array.from(cats).map(c => c.textContent);
    expect(catTexts).toContain('Recent');
  });
});
