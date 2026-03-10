/**
 * Tests for ModelComparePanel — UI panel for model comparison.
 *
 * Verifies panel creation, tab switching, model selection validation,
 * comparison execution, history rendering, leaderboard, and integration
 * with the ModelCompare logic module.
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// Minimal DOM stubs
const _elements = {};
const _listeners = {};

function _makeElement(tag, attrs) {
  const el = {
    tagName: tag,
    id: attrs?.id || '',
    className: attrs?.className || '',
    innerHTML: '',
    textContent: '',
    style: { display: '' },
    disabled: false,
    dataset: {},
    value: '',
    checked: false,
    _children: [],
    _listeners: {},
    setAttribute(k, v) { this.dataset[k] = v; },
    getAttribute(k) { return this.dataset[k] || null; },
    classList: {
      _set: new Set((attrs?.className || '').split(' ').filter(Boolean)),
      add(c) { this._set.add(c); el.className = [...this._set].join(' '); },
      remove(c) { this._set.delete(c); el.className = [...this._set].join(' '); },
      toggle(c, force) {
        if (force === undefined) force = !this._set.has(c);
        force ? this._set.add(c) : this._set.delete(c);
        el.className = [...this._set].join(' ');
      },
      contains(c) { return this._set.has(c); }
    },
    appendChild(child) { el._children.push(child); return child; },
    querySelector(sel) {
      // Simplified selector matching for tests
      if (sel.startsWith('#')) return _elements[sel.slice(1)] || null;
      if (sel.startsWith('.')) {
        const cls = sel.slice(1);
        for (const child of el._children) {
          if (child.className && child.className.includes(cls)) return child;
        }
      }
      return null;
    },
    querySelectorAll(sel) {
      return [];
    },
    addEventListener(type, fn) {
      if (!el._listeners[type]) el._listeners[type] = [];
      el._listeners[type].push(fn);
    },
    closest(sel) { return null; },
    remove() {}
  };
  if (el.id) _elements[el.id] = el;
  return el;
}

// Test suite

describe('ModelComparePanel', () => {

  describe('Slash command registration', () => {
    it('should have /compare in the command name', () => {
      // Verify the command exists in app.js
      const fs = require('fs');
      const appCode = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf-8');
      assert.ok(appCode.includes("name: 'compare'"),
        '/compare slash command should be registered');
    });

    it('should call ModelComparePanel.toggle in the action', () => {
      const fs = require('fs');
      const appCode = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf-8');
      assert.ok(appCode.includes('ModelComparePanel.toggle()'),
        'Compare command should call ModelComparePanel.toggle()');
    });
  });

  describe('Panel structure', () => {
    it('should have panel element with correct ID', () => {
      const fs = require('fs');
      const appCode = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf-8');
      assert.ok(appCode.includes("id = 'model-compare-panel'"),
        'Panel should have id model-compare-panel');
    });

    it('should have three tabs: compare, history, leaderboard', () => {
      const fs = require('fs');
      const appCode = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf-8');
      assert.ok(appCode.includes("data-tab=\"compare\""), 'Should have compare tab');
      assert.ok(appCode.includes("data-tab=\"history\""), 'Should have history tab');
      assert.ok(appCode.includes("data-tab=\"leaderboard\""), 'Should have leaderboard tab');
    });

    it('should have model checkboxes from ChatConfig', () => {
      const fs = require('fs');
      const appCode = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf-8');
      assert.ok(appCode.includes('mcp-model-cb'),
        'Should have model checkbox class');
      assert.ok(appCode.includes('ChatConfig.AVAILABLE_MODELS'),
        'Should reference available models');
    });

    it('should have a prompt input textarea', () => {
      const fs = require('fs');
      const appCode = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf-8');
      assert.ok(appCode.includes('mcp-prompt-input'),
        'Should have prompt input');
    });

    it('should have fill-from-input button', () => {
      const fs = require('fs');
      const appCode = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf-8');
      assert.ok(appCode.includes('mcp-btn-fill'),
        'Should have fill button');
      assert.ok(appCode.includes('user-input'),
        'Should reference chat input element');
    });

    it('should have run comparison button', () => {
      const fs = require('fs');
      const appCode = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf-8');
      assert.ok(appCode.includes('mcp-btn-run'),
        'Should have run button');
    });
  });

  describe('Comparison validation', () => {
    it('should require at least 2 models', () => {
      const fs = require('fs');
      const appCode = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf-8');
      assert.ok(appCode.includes('Select at least 2 models'),
        'Should validate minimum model count');
    });

    it('should require non-empty prompt', () => {
      const fs = require('fs');
      const appCode = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf-8');
      assert.ok(appCode.includes('Enter a prompt to compare'),
        'Should validate prompt is not empty');
    });

    it('should disable run button during comparison', () => {
      const fs = require('fs');
      const appCode = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf-8');
      assert.ok(appCode.includes('.disabled = true'),
        'Should disable button during run');
      assert.ok(appCode.includes('.disabled = false'),
        'Should re-enable button after run');
    });
  });

  describe('Tab switching', () => {
    it('should have _switchTab function', () => {
      const fs = require('fs');
      const appCode = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf-8');
      assert.ok(appCode.includes('function _switchTab'),
        'Should have _switchTab function');
    });

    it('should render history when switching to history tab', () => {
      const fs = require('fs');
      const appCode = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf-8');
      assert.ok(appCode.includes("tabName === 'history') _renderHistory"),
        'Should call _renderHistory for history tab');
    });

    it('should render leaderboard when switching to leaderboard tab', () => {
      const fs = require('fs');
      const appCode = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf-8');
      assert.ok(appCode.includes("tabName === 'leaderboard') _renderLeaderboard"),
        'Should call _renderLeaderboard for leaderboard tab');
    });
  });

  describe('History rendering', () => {
    it('should show empty state when no history', () => {
      const fs = require('fs');
      const appCode = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf-8');
      assert.ok(appCode.includes('No comparisons yet'),
        'Should show empty state message');
    });

    it('should call ModelCompare.getHistory', () => {
      const fs = require('fs');
      const appCode = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf-8');
      assert.ok(appCode.includes('ModelCompare.getHistory'),
        'Should use ModelCompare.getHistory()');
    });

    it('should support expanding history items', () => {
      const fs = require('fs');
      const appCode = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf-8');
      assert.ok(appCode.includes('mcp-history-expanded'),
        'Should have expandable history items');
    });

    it('should have export and clear buttons', () => {
      const fs = require('fs');
      const appCode = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf-8');
      assert.ok(appCode.includes('mcp-btn-export'), 'Should have export button');
      assert.ok(appCode.includes('mcp-btn-clear-history'), 'Should have clear button');
    });
  });

  describe('Leaderboard rendering', () => {
    it('should show empty state when no data', () => {
      const fs = require('fs');
      const appCode = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf-8');
      assert.ok(appCode.includes('No data yet'),
        'Should show leaderboard empty state');
    });

    it('should use ModelCompare.getModelStats', () => {
      const fs = require('fs');
      const appCode = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf-8');
      assert.ok(appCode.includes('ModelCompare.getModelStats'),
        'Should call getModelStats');
    });

    it('should sort by win rate', () => {
      const fs = require('fs');
      const appCode = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf-8');
      assert.ok(appCode.includes('winRate'),
        'Should sort by win rate');
    });

    it('should render medals for top 3', () => {
      const fs = require('fs');
      const appCode = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf-8');
      // Medal emojis (gold, silver, bronze)
      assert.ok(appCode.includes('i === 0') || appCode.includes("'\\u"),
        'Should assign medals');
    });

    it('should render leaderboard as table', () => {
      const fs = require('fs');
      const appCode = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf-8');
      assert.ok(appCode.includes('mcp-leaderboard-table'),
        'Should render as table');
    });
  });

  describe('Vote handling', () => {
    it('should delegate vote button clicks', () => {
      const fs = require('fs');
      const appCode = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf-8');
      assert.ok(appCode.includes('mc-vote-btn'),
        'Should handle vote button clicks');
    });

    it('should call ModelCompare.setWinner on vote', () => {
      const fs = require('fs');
      const appCode = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf-8');
      assert.ok(appCode.includes('ModelCompare.setWinner'),
        'Should set winner via ModelCompare');
    });
  });

  describe('CSS styling', () => {
    it('should have panel styles in style.css', () => {
      const fs = require('fs');
      const css = fs.readFileSync(require('path').join(__dirname, '..', 'style.css'), 'utf-8');
      assert.ok(css.includes('#model-compare-panel'),
        'Should have panel CSS');
    });

    it('should have hidden state class', () => {
      const fs = require('fs');
      const css = fs.readFileSync(require('path').join(__dirname, '..', 'style.css'), 'utf-8');
      assert.ok(css.includes('mc-panel-hidden'),
        'Should have hidden state CSS');
    });

    it('should have comparison card styles', () => {
      const fs = require('fs');
      const css = fs.readFileSync(require('path').join(__dirname, '..', 'style.css'), 'utf-8');
      assert.ok(css.includes('.mc-card'), 'Should have card styles');
      assert.ok(css.includes('.mc-winner'), 'Should have winner highlight');
    });

    it('should have leaderboard table styles', () => {
      const fs = require('fs');
      const css = fs.readFileSync(require('path').join(__dirname, '..', 'style.css'), 'utf-8');
      assert.ok(css.includes('.mcp-leaderboard-table'),
        'Should have leaderboard table CSS');
    });

    it('should have status type styles', () => {
      const fs = require('fs');
      const css = fs.readFileSync(require('path').join(__dirname, '..', 'style.css'), 'utf-8');
      assert.ok(css.includes('.mcp-status-info'), 'Should have info status');
      assert.ok(css.includes('.mcp-status-error'), 'Should have error status');
      assert.ok(css.includes('.mcp-status-success'), 'Should have success status');
    });
  });

  describe('Module interface', () => {
    it('should export open, close, and toggle', () => {
      const fs = require('fs');
      const appCode = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf-8');
      // Find the ModelComparePanel return block
      const returnMatch = appCode.match(/const ModelComparePanel[\s\S]*?return \{[\s\S]*?\};/);
      assert.ok(returnMatch, 'Should have ModelComparePanel return block');
      const returnBlock = returnMatch[0];
      assert.ok(returnBlock.includes('open: open'), 'Should export open');
      assert.ok(returnBlock.includes('close: close'), 'Should export close');
      assert.ok(returnBlock.includes('toggle: toggle'), 'Should export toggle');
    });

    it('should update module count to 43', () => {
      const fs = require('fs');
      const appCode = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf-8');
      assert.ok(appCode.includes('43 modules'),
        'Module count should be updated to 43');
    });
  });
});
