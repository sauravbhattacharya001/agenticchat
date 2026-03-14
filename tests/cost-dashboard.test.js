/**
 * Tests for CostDashboard — persistent API spend tracker.
 * @jest-environment jsdom
 */

const { setupDOM, loadApp } = require('./setup');

beforeEach(() => {
  localStorage.clear();
  setupDOM();
  loadApp();
  CostDashboard.reset();
});

afterEach(() => {
  CostDashboard.close();
});

describe('CostDashboard', () => {
  // ── Recording ──

  test('recordUsage stores entry in log', () => {
    CostDashboard.recordUsage({ prompt_tokens: 100, completion_tokens: 50 }, 'gpt-4o');
    const log = CostDashboard.getLog();
    expect(log).toHaveLength(1);
    expect(log[0].model).toBe('gpt-4o');
    expect(log[0].pt).toBe(100);
    expect(log[0].ct).toBe(50);
    expect(log[0].cost).toBeGreaterThan(0);
    expect(log[0].ts).toBeDefined();
  });

  test('recordUsage computes cost correctly for gpt-4o', () => {
    // gpt-4o: $2.50 input, $10.00 output per 1M tokens
    CostDashboard.recordUsage({ prompt_tokens: 1000, completion_tokens: 500 }, 'gpt-4o');
    const log = CostDashboard.getLog();
    const expected = (1000 * 2.50 + 500 * 10.00) / 1_000_000;
    expect(log[0].cost).toBeCloseTo(expected, 6);
  });

  test('recordUsage computes cost correctly for gpt-4o-mini', () => {
    // gpt-4o-mini: $0.15 input, $0.60 output per 1M tokens
    CostDashboard.recordUsage({ prompt_tokens: 10000, completion_tokens: 5000 }, 'gpt-4o-mini');
    const log = CostDashboard.getLog();
    const expected = (10000 * 0.15 + 5000 * 0.60) / 1_000_000;
    expect(log[0].cost).toBeCloseTo(expected, 6);
  });

  test('recordUsage handles missing usage gracefully', () => {
    CostDashboard.recordUsage(null);
    CostDashboard.recordUsage(undefined);
    expect(CostDashboard.getLog()).toHaveLength(0);
  });

  test('recordUsage defaults model to ChatConfig.MODEL', () => {
    const originalModel = ChatConfig.MODEL;
    ChatConfig.MODEL = 'gpt-4.1-mini';
    CostDashboard.recordUsage({ prompt_tokens: 50, completion_tokens: 30 });
    const log = CostDashboard.getLog();
    expect(log[0].model).toBe('gpt-4.1-mini');
    ChatConfig.MODEL = originalModel;
  });

  test('recordUsage accumulates multiple entries', () => {
    CostDashboard.recordUsage({ prompt_tokens: 100, completion_tokens: 50 }, 'gpt-4o');
    CostDashboard.recordUsage({ prompt_tokens: 200, completion_tokens: 100 }, 'gpt-4o');
    CostDashboard.recordUsage({ prompt_tokens: 300, completion_tokens: 150 }, 'gpt-4o-mini');
    expect(CostDashboard.getLog()).toHaveLength(3);
  });

  test('recordUsage handles zero tokens', () => {
    CostDashboard.recordUsage({ prompt_tokens: 0, completion_tokens: 0 }, 'gpt-4o');
    const log = CostDashboard.getLog();
    expect(log).toHaveLength(1);
    expect(log[0].cost).toBe(0);
  });

  test('recordUsage handles missing token fields', () => {
    CostDashboard.recordUsage({}, 'gpt-4o');
    const log = CostDashboard.getLog();
    expect(log).toHaveLength(1);
    expect(log[0].pt).toBe(0);
    expect(log[0].ct).toBe(0);
  });

  test('recordUsage uses fallback pricing for unknown model', () => {
    CostDashboard.recordUsage({ prompt_tokens: 1000, completion_tokens: 500 }, 'unknown-model');
    const log = CostDashboard.getLog();
    const expected = (1000 * 2.50 + 500 * 10.00) / 1_000_000;
    expect(log[0].cost).toBeCloseTo(expected, 6);
  });

  // ── Totals ──

  test('getTotals computes cumulative cost', () => {
    CostDashboard.recordUsage({ prompt_tokens: 1000, completion_tokens: 500 }, 'gpt-4o');
    CostDashboard.recordUsage({ prompt_tokens: 2000, completion_tokens: 1000 }, 'gpt-4o');
    const totals = CostDashboard.getTotals();
    expect(totals.totalCalls).toBe(2);
    expect(totals.totalPrompt).toBe(3000);
    expect(totals.totalCompletion).toBe(1500);
    expect(totals.totalCost).toBeGreaterThan(0);
  });

  test('getTotals returns per-model breakdown', () => {
    CostDashboard.recordUsage({ prompt_tokens: 100, completion_tokens: 50 }, 'gpt-4o');
    CostDashboard.recordUsage({ prompt_tokens: 100, completion_tokens: 50 }, 'gpt-4o-mini');
    CostDashboard.recordUsage({ prompt_tokens: 100, completion_tokens: 50 }, 'gpt-4o');
    const totals = CostDashboard.getTotals();
    expect(Object.keys(totals.byModel)).toHaveLength(2);
    expect(totals.byModel['gpt-4o'].calls).toBe(2);
    expect(totals.byModel['gpt-4o-mini'].calls).toBe(1);
  });

  test('getTotals returns per-day breakdown', () => {
    CostDashboard.recordUsage({ prompt_tokens: 100, completion_tokens: 50 }, 'gpt-4o');
    const totals = CostDashboard.getTotals();
    const today = new Date().toISOString().slice(0, 10);
    expect(totals.byDay[today]).toBeDefined();
    expect(totals.byDay[today].calls).toBe(1);
  });

  test('getTotals returns zeros for empty log', () => {
    const totals = CostDashboard.getTotals();
    expect(totals.totalCost).toBe(0);
    expect(totals.totalCalls).toBe(0);
    expect(totals.totalPrompt).toBe(0);
    expect(totals.totalCompletion).toBe(0);
  });

  // ── Budget ──

  test('setBudget and getBudget round-trip', () => {
    expect(CostDashboard.getBudget()).toBeNull();
    CostDashboard.setBudget(10.50);
    expect(CostDashboard.getBudget()).toBe(10.50);
  });

  test('setBudget(null) clears budget', () => {
    CostDashboard.setBudget(5);
    CostDashboard.setBudget(null);
    expect(CostDashboard.getBudget()).toBeNull();
  });

  test('getBudget rejects non-positive values', () => {
    CostDashboard.setBudget(0);
    expect(CostDashboard.getBudget()).toBeNull();
    CostDashboard.setBudget(-5);
    expect(CostDashboard.getBudget()).toBeNull();
  });

  // ── Panel open/close ──

  test('panel opens and closes', () => {
    expect(CostDashboard.isOpen()).toBe(false);
    CostDashboard.open();
    expect(CostDashboard.isOpen()).toBe(true);
    expect(document.getElementById('cost-panel')).not.toBeNull();
    expect(document.getElementById('cost-overlay')).not.toBeNull();
    CostDashboard.close();
    expect(CostDashboard.isOpen()).toBe(false);
    expect(document.getElementById('cost-panel')).toBeNull();
    expect(document.getElementById('cost-overlay')).toBeNull();
  });

  test('toggle opens then closes', () => {
    CostDashboard.toggle();
    expect(CostDashboard.isOpen()).toBe(true);
    CostDashboard.toggle();
    expect(CostDashboard.isOpen()).toBe(false);
  });

  // ── Rendered content ──

  test('panel shows correct summary stats', () => {
    CostDashboard.recordUsage({ prompt_tokens: 1000, completion_tokens: 500 }, 'gpt-4o');
    CostDashboard.recordUsage({ prompt_tokens: 2000, completion_tokens: 1000 }, 'gpt-4o');
    CostDashboard.open();
    const panel = document.getElementById('cost-panel');
    expect(panel).not.toBeNull();
    // Check that call count is shown
    const html = panel.innerHTML;
    expect(html).toContain('2'); // 2 API calls
    expect(html).toContain('Total Spent');
    expect(html).toContain('API Calls');
    expect(html).toContain('Total Tokens');
    expect(html).toContain('Avg / Call');
  });

  test('panel shows model table', () => {
    CostDashboard.recordUsage({ prompt_tokens: 100, completion_tokens: 50 }, 'gpt-4o');
    CostDashboard.recordUsage({ prompt_tokens: 100, completion_tokens: 50 }, 'gpt-4o-mini');
    CostDashboard.open();
    const panel = document.getElementById('cost-panel');
    expect(panel.innerHTML).toContain('gpt-4o');
    expect(panel.innerHTML).toContain('gpt-4o-mini');
    expect(panel.innerHTML).toContain('By Model');
  });

  test('panel shows daily chart', () => {
    CostDashboard.recordUsage({ prompt_tokens: 100, completion_tokens: 50 }, 'gpt-4o');
    CostDashboard.open();
    const panel = document.getElementById('cost-panel');
    expect(panel.innerHTML).toContain('Daily Spending');
    expect(panel.querySelector('.cost-chart')).not.toBeNull();
    const bars = panel.querySelectorAll('.cost-bar-col');
    expect(bars.length).toBe(14); // 14-day window
  });

  test('panel shows budget bar when budget set', () => {
    CostDashboard.setBudget(1.00);
    CostDashboard.recordUsage({ prompt_tokens: 100, completion_tokens: 50 }, 'gpt-4o');
    CostDashboard.open();
    const panel = document.getElementById('cost-panel');
    expect(panel.querySelector('.cost-budget-bar')).not.toBeNull();
    expect(panel.querySelector('.cost-budget-fill')).not.toBeNull();
  });

  test('panel has no budget bar when no budget', () => {
    CostDashboard.recordUsage({ prompt_tokens: 100, completion_tokens: 50 }, 'gpt-4o');
    CostDashboard.open();
    const panel = document.getElementById('cost-panel');
    expect(panel.querySelector('.cost-budget-bar')).toBeNull();
  });

  test('panel shows "No data yet" when empty', () => {
    CostDashboard.open();
    const panel = document.getElementById('cost-panel');
    expect(panel.innerHTML).toContain('No data yet');
  });

  // ── Reset ──

  test('reset clears all data', () => {
    CostDashboard.recordUsage({ prompt_tokens: 100, completion_tokens: 50 }, 'gpt-4o');
    CostDashboard.recordUsage({ prompt_tokens: 200, completion_tokens: 100 }, 'gpt-4o');
    expect(CostDashboard.getLog()).toHaveLength(2);
    CostDashboard.reset();
    expect(CostDashboard.getLog()).toHaveLength(0);
    expect(CostDashboard.getTotals().totalCost).toBe(0);
  });

  // ── XSS prevention ──

  test('model names are escaped in panel', () => {
    CostDashboard.recordUsage(
      { prompt_tokens: 100, completion_tokens: 50 },
      '<script>alert(1)</script>'
    );
    CostDashboard.open();
    const panel = document.getElementById('cost-panel');
    expect(panel.innerHTML).not.toContain('<script>');
    expect(panel.innerHTML).toContain('&lt;script&gt;');
  });

  // ── Close via overlay click ──

  test('clicking overlay closes panel', () => {
    CostDashboard.open();
    expect(CostDashboard.isOpen()).toBe(true);
    const overlay = document.getElementById('cost-overlay');
    overlay.click();
    expect(CostDashboard.isOpen()).toBe(false);
  });

  // ── Close via button ──

  test('clicking close button closes panel', () => {
    CostDashboard.open();
    const closeBtn = document.querySelector('.cost-close');
    closeBtn.click();
    expect(CostDashboard.isOpen()).toBe(false);
  });

  // ── Budget percentage ──

  test('budget bar shows correct percentage', () => {
    CostDashboard.setBudget(1.00);
    // Record enough usage to be roughly 50% of budget
    // gpt-4: $30/$60 per 1M tokens
    // 10000 input + 5000 output = 10000*30/1M + 5000*60/1M = 0.3 + 0.3 = 0.6
    CostDashboard.recordUsage({ prompt_tokens: 10000, completion_tokens: 5000 }, 'gpt-4');
    CostDashboard.open();
    const fill = document.querySelector('.cost-budget-fill');
    expect(fill).not.toBeNull();
    // 60% of $1.00 budget
    expect(fill.style.width).toBe('60%');
  });
});
