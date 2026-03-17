/**
 * CustomThemeCreator tests — interactive theme builder with presets,
 * save/load custom themes, import/export, live color pickers.
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

let dom, cleanup;

function setup() {
  dom = new JSDOM('<!DOCTYPE html><html data-theme="dark"><body></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.HTMLElement = dom.window.HTMLElement;
  global.navigator = dom.window.navigator;
  global.alert = () => {};
  global.confirm = () => true;
  global.prompt = () => 'Test Theme';
  global.getComputedStyle = dom.window.getComputedStyle;
  global.URL = { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} };
  global.Blob = dom.window.Blob || class Blob { constructor(p, o) { this.parts = p; this.type = o?.type; } };
  global.FileReader = dom.window.FileReader;
  global.crypto = {
    randomUUID: () => 'test-uuid',
    getRandomValues: (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256); return arr; },
  };
  global.BroadcastChannel = class { postMessage() {} close() {} addEventListener() {} };
  global.MediaQueryList = class { addEventListener() {} };
  global.matchMedia = () => ({ matches: true, addEventListener: () => {} });
  global.MutationObserver = class { observe() {} disconnect() {} };
  global.IntersectionObserver = class { observe() {} disconnect() {} };
  global.SpeechRecognition = undefined;
  global.webkitSpeechRecognition = undefined;

  const { setupDOM, loadApp } = require('./setup');
  setupDOM();
  loadApp();

  cleanup = () => {
    delete global.window; delete global.document; delete global.localStorage;
    delete global.HTMLElement; delete global.navigator; delete global.alert;
    delete global.confirm; delete global.prompt; delete global.getComputedStyle;
    delete global.URL; delete global.Blob; delete global.FileReader;
    delete global.crypto; delete global.BroadcastChannel;
    delete global.MediaQueryList; delete global.matchMedia;
    delete global.MutationObserver; delete global.IntersectionObserver;
    delete global.SpeechRecognition; delete global.webkitSpeechRecognition;
    Object.keys(require.cache).forEach(k => { if (k.includes('app.js') || k.includes('setup.js')) delete require.cache[k]; });
    if (dom) { dom.window.close(); dom = null; }
  };
}

function teardown() {
  if (cleanup) cleanup();
}

describe('CustomThemeCreator', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('should be defined after loading', () => {
    assert.ok(CustomThemeCreator);
  });

  it('should expose public API', () => {
    assert.equal(typeof CustomThemeCreator.toggle, 'function');
    assert.equal(typeof CustomThemeCreator.open, 'function');
    assert.equal(typeof CustomThemeCreator.close, 'function');
    assert.equal(typeof CustomThemeCreator.getAvailableThemes, 'function');
    assert.equal(typeof CustomThemeCreator.applyPreset, 'function');
    assert.equal(typeof CustomThemeCreator.applyCustom, 'function');
  });

  it('should have at least 5 preset themes', () => {
    const presets = Object.keys(CustomThemeCreator.PRESETS);
    assert.ok(presets.length >= 5, `Expected >=5 presets, got ${presets.length}`);
  });

  it('should include well-known presets', () => {
    const presets = Object.keys(CustomThemeCreator.PRESETS);
    assert.ok(presets.includes('Nord'));
    assert.ok(presets.includes('Dracula'));
    assert.ok(presets.includes('Monokai'));
    assert.ok(presets.includes('Catppuccin Mocha'));
  });

  it('should have theme variables defined', () => {
    assert.ok(CustomThemeCreator.THEME_VARS.length >= 10);
    const keys = CustomThemeCreator.THEME_VARS.map(v => v.key);
    assert.ok(keys.includes('--bg-primary'));
    assert.ok(keys.includes('--accent'));
    assert.ok(keys.includes('--text-primary'));
  });

  it('each theme var should have key, label, and group', () => {
    CustomThemeCreator.THEME_VARS.forEach(v => {
      assert.ok(v.key, 'Missing key');
      assert.ok(v.label, 'Missing label');
      assert.ok(v.group, 'Missing group');
    });
  });

  it('should toggle panel open and closed', () => {
    CustomThemeCreator.open();
    assert.ok(document.getElementById('theme-creator-panel'), 'Panel should exist after open');
    CustomThemeCreator.close();
    assert.ok(!document.getElementById('theme-creator-panel'), 'Panel should be gone after close');
  });

  it('toggle should open then close', () => {
    CustomThemeCreator.toggle();
    assert.ok(document.getElementById('theme-creator-panel'));
    CustomThemeCreator.toggle();
    assert.ok(!document.getElementById('theme-creator-panel'));
  });

  it('should apply preset theme values to document', () => {
    const result = CustomThemeCreator.applyPreset('Nord');
    assert.equal(result, true);
    const val = document.documentElement.style.getPropertyValue('--bg-primary');
    assert.equal(val, '#2e3440');
  });

  it('should return false for unknown preset', () => {
    assert.equal(CustomThemeCreator.applyPreset('NonExistent'), false);
  });

  it('should save and load custom themes', () => {
    const testTheme = { '--bg-primary': '#ff0000', '--accent': '#00ff00' };
    const themes = CustomThemeCreator._loadCustomThemes();
    themes['MyTheme'] = testTheme;
    CustomThemeCreator._saveCustomThemes(themes);
    const loaded = CustomThemeCreator._loadCustomThemes();
    assert.deepEqual(loaded['MyTheme'], testTheme);
  });

  it('should apply custom theme', () => {
    const testTheme = { '--bg-primary': '#abcdef', '--accent': '#fedcba' };
    CustomThemeCreator._saveCustomThemes({ 'Custom1': testTheme });
    const result = CustomThemeCreator.applyCustom('Custom1');
    assert.equal(result, true);
    assert.equal(document.documentElement.style.getPropertyValue('--bg-primary'), '#abcdef');
  });

  it('should return false for unknown custom theme', () => {
    assert.equal(CustomThemeCreator.applyCustom('NoSuchTheme'), false);
  });

  it('should track active custom theme', () => {
    CustomThemeCreator._setActiveCustomTheme('MyTheme');
    assert.equal(CustomThemeCreator._getActiveCustomTheme(), 'MyTheme');
    CustomThemeCreator._setActiveCustomTheme('');
    assert.equal(CustomThemeCreator._getActiveCustomTheme(), '');
  });

  it('getAvailableThemes should list presets and custom', () => {
    CustomThemeCreator._saveCustomThemes({ 'A': {}, 'B': {} });
    const avail = CustomThemeCreator.getAvailableThemes();
    assert.ok(avail.presets.length >= 5);
    assert.deepEqual(avail.custom, ['A', 'B']);
  });

  it('should convert 3-char hex to 6-char', () => {
    assert.equal(CustomThemeCreator._toHex('#abc'), '#aabbcc');
  });

  it('should pass through 6-char hex unchanged', () => {
    assert.equal(CustomThemeCreator._toHex('#112233'), '#112233');
  });

  it('panel should contain color pickers', () => {
    CustomThemeCreator.open();
    const pickers = document.querySelectorAll('.theme-creator-picker');
    assert.ok(pickers.length >= 10, `Expected >=10 pickers, got ${pickers.length}`);
    CustomThemeCreator.close();
  });

  it('panel should contain hex inputs for each variable', () => {
    CustomThemeCreator.open();
    const hexInputs = document.querySelectorAll('.theme-creator-hex');
    assert.equal(hexInputs.length, CustomThemeCreator.THEME_VARS.length);
    CustomThemeCreator.close();
  });

  it('each preset should have all theme vars', () => {
    const varKeys = CustomThemeCreator.THEME_VARS.map(v => v.key);
    Object.entries(CustomThemeCreator.PRESETS).forEach(([name, vals]) => {
      varKeys.forEach(key => {
        assert.ok(vals[key], `Preset "${name}" missing var "${key}"`);
      });
    });
  });

  it('should apply values via _applyThemeValues', () => {
    CustomThemeCreator._applyThemeValues({ '--bg-primary': '#00ff00' });
    assert.equal(document.documentElement.style.getPropertyValue('--bg-primary'), '#00ff00');
  });

  it('should handle empty custom themes storage', () => {
    localStorage.removeItem('agenticchat_custom_themes');
    assert.deepEqual(CustomThemeCreator._loadCustomThemes(), {});
  });

  it('should handle corrupt storage gracefully', () => {
    localStorage.setItem('agenticchat_custom_themes', 'not json');
    assert.deepEqual(CustomThemeCreator._loadCustomThemes(), {});
  });

  it('open twice should not create duplicate panels', () => {
    CustomThemeCreator.open();
    CustomThemeCreator.open();
    const panels = document.querySelectorAll('#theme-creator-panel');
    assert.equal(panels.length, 1);
    CustomThemeCreator.close();
  });

  it('close when not open should not throw', () => {
    assert.doesNotThrow(() => CustomThemeCreator.close());
  });

  it('panel close button should work', () => {
    CustomThemeCreator.open();
    // The close button is the last button in the header
    const panel = document.getElementById('theme-creator-panel');
    const buttons = panel.querySelectorAll('button');
    // First button in panel is the close button (✕)
    const closeBtn = buttons[0];
    assert.ok(closeBtn.textContent.includes('✕'));
    closeBtn.click();
    assert.ok(!document.getElementById('theme-creator-panel'));
  });

  it('should restore active theme on init', () => {
    const theme = { '--bg-primary': '#999999' };
    CustomThemeCreator._saveCustomThemes({ 'StartupTheme': theme });
    CustomThemeCreator._setActiveCustomTheme('StartupTheme');
    CustomThemeCreator.init();
    assert.equal(document.documentElement.style.getPropertyValue('--bg-primary'), '#999999');
  });
});
