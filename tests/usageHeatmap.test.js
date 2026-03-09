/**
 * UsageHeatmap - Unit Tests
 */

const { setupDOM, loadApp } = require('./setup');

function makeSession(name, msgs) {
  return {
    name,
    messages: msgs,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function injectSessions(sessions) {
  localStorage.setItem('agenticchat_sessions', JSON.stringify(sessions));
  // Force SessionManager cache invalidation by setting dirty flag
  if (typeof SessionManager !== 'undefined' && SessionManager._invalidateCache) {
    SessionManager._invalidateCache();
  }
}

beforeEach(() => {
  setupDOM();
  loadApp();
  localStorage.clear();
  UsageHeatmap.init();
});

/* ================================================================
 * Hour formatting
 * ================================================================ */
describe('UsageHeatmap._fmtHour', () => {
  test('formats midnight', () => {
    expect(UsageHeatmap._fmtHour(0)).toBe('12a');
  });
  test('formats morning hours', () => {
    expect(UsageHeatmap._fmtHour(1)).toBe('1a');
    expect(UsageHeatmap._fmtHour(11)).toBe('11a');
  });
  test('formats noon', () => {
    expect(UsageHeatmap._fmtHour(12)).toBe('12p');
  });
  test('formats afternoon hours', () => {
    expect(UsageHeatmap._fmtHour(13)).toBe('1p');
    expect(UsageHeatmap._fmtHour(23)).toBe('11p');
  });
});

/* ================================================================
 * Intensity class mapping
 * ================================================================ */
describe('UsageHeatmap._intensityClass', () => {
  test('returns level-0 for zero count', () => {
    expect(UsageHeatmap._intensityClass(0, 100)).toBe('heatmap-level-0');
  });
  test('returns level-0 for zero max', () => {
    expect(UsageHeatmap._intensityClass(5, 0)).toBe('heatmap-level-0');
  });
  test('returns level-1 for low ratio', () => {
    expect(UsageHeatmap._intensityClass(10, 100)).toBe('heatmap-level-1');
  });
  test('returns level-2 for mid-low ratio', () => {
    expect(UsageHeatmap._intensityClass(40, 100)).toBe('heatmap-level-2');
  });
  test('returns level-3 for mid-high ratio', () => {
    expect(UsageHeatmap._intensityClass(70, 100)).toBe('heatmap-level-3');
  });
  test('returns level-4 for high ratio', () => {
    expect(UsageHeatmap._intensityClass(90, 100)).toBe('heatmap-level-4');
  });
  test('returns level-4 for max count', () => {
    expect(UsageHeatmap._intensityClass(100, 100)).toBe('heatmap-level-4');
  });
});

/* ================================================================
 * Data collection
 * ================================================================ */
describe('UsageHeatmap._collectData', () => {
  test('returns empty grid with no sessions', () => {
    const { grid, total, sessionCount } = UsageHeatmap._collectData();
    expect(grid.length).toBe(7);
    expect(grid[0].length).toBe(24);
    expect(total).toBe(0);
    expect(sessionCount).toBe(0);
  });

  test('counts messages in the correct day/hour slots', () => {
    const monday2pm = new Date(2025, 0, 6, 14, 30, 0);
    injectSessions([makeSession('s1', [
      { role: 'user', content: 'x', timestamp: monday2pm.toISOString() }
    ])]);

    const { grid, total } = UsageHeatmap._collectData();
    const day = monday2pm.getDay();
    const hour = monday2pm.getHours();
    expect(grid[day][hour]).toBe(1);
    expect(total).toBe(1);
  });

  test('aggregates across multiple sessions', () => {
    const d1 = new Date(2025, 0, 6, 10, 0);
    const d2 = new Date(2025, 0, 6, 10, 30);
    const d3 = new Date(2025, 0, 7, 15, 0);
    injectSessions([
      makeSession('s1', [
        { role: 'user', content: 'a', timestamp: d1.toISOString() },
        { role: 'assistant', content: 'b', timestamp: d2.toISOString() },
      ]),
      makeSession('s2', [
        { role: 'user', content: 'c', timestamp: d3.toISOString() },
      ]),
    ]);

    const { grid, total, sessionCount } = UsageHeatmap._collectData();
    expect(sessionCount).toBe(2);
    expect(total).toBe(3);
    expect(grid[d1.getDay()][10]).toBe(2);
    expect(grid[d3.getDay()][15]).toBe(1);
  });

  test('skips messages without timestamps', () => {
    injectSessions([makeSession('s1', [
      { role: 'user', content: 'no ts' },
      { role: 'user', content: 'has ts', timestamp: new Date().toISOString() },
    ])]);

    const { total } = UsageHeatmap._collectData();
    expect(total).toBe(1);
  });

  test('skips messages with invalid timestamps', () => {
    injectSessions([makeSession('s1', [
      { role: 'user', content: 'bad', timestamp: 'not-a-date' },
    ])]);

    const { total } = UsageHeatmap._collectData();
    expect(total).toBe(0);
  });
});

/* ================================================================
 * Public API
 * ================================================================ */
describe('UsageHeatmap.getData', () => {
  test('returns a 7x24 grid', () => {
    const grid = UsageHeatmap.getData();
    expect(grid.length).toBe(7);
    for (const row of grid) {
      expect(row.length).toBe(24);
    }
  });
});

describe('UsageHeatmap.getTotalMessages', () => {
  test('returns 0 with no data', () => {
    expect(UsageHeatmap.getTotalMessages()).toBe(0);
  });
});

describe('UsageHeatmap.getPeakHour', () => {
  test('returns null when no messages', () => {
    expect(UsageHeatmap.getPeakHour()).toBeNull();
  });

  test('returns correct peak slot', () => {
    const d = new Date(2025, 0, 8, 9, 0); // Wednesday 9am
    const msgs = [];
    for (let i = 0; i < 5; i++) {
      msgs.push({ role: 'user', content: 'x', timestamp: new Date(d.getTime() + i * 60000).toISOString() });
    }
    injectSessions([makeSession('s1', msgs)]);

    const peak = UsageHeatmap.getPeakHour();
    expect(peak).not.toBeNull();
    expect(peak.day).toBe(d.getDay());
    expect(peak.hour).toBe(9);
    expect(peak.count).toBe(5);
    expect(peak.dayName).toBe('Wednesday');
  });
});

describe('UsageHeatmap.getActiveHours', () => {
  test('returns 0 with no data', () => {
    expect(UsageHeatmap.getActiveHours()).toBe(0);
  });

  test('counts distinct active slots', () => {
    const mon9 = new Date(2025, 0, 6, 9, 0);
    const tue14 = new Date(2025, 0, 7, 14, 0);
    injectSessions([makeSession('s1', [
      { role: 'user', content: 'a', timestamp: mon9.toISOString() },
      { role: 'user', content: 'b', timestamp: mon9.toISOString() },
      { role: 'user', content: 'c', timestamp: tue14.toISOString() },
    ])]);

    expect(UsageHeatmap.getActiveHours()).toBe(2);
  });
});

/* ================================================================
 * Panel management
 * ================================================================ */
describe('UsageHeatmap panel', () => {
  test('open shows panel and overlay', () => {
    UsageHeatmap.open();
    expect(document.getElementById('heatmap-panel').style.display).not.toBe('none');
    expect(document.getElementById('heatmap-overlay').style.display).not.toBe('none');
  });

  test('close hides panel and overlay', () => {
    UsageHeatmap.open();
    UsageHeatmap.close();
    expect(document.getElementById('heatmap-panel').style.display).toBe('none');
    expect(document.getElementById('heatmap-overlay').style.display).toBe('none');
  });

  test('toggle opens then closes', () => {
    UsageHeatmap.toggle();
    expect(document.getElementById('heatmap-panel').style.display).not.toBe('none');
    UsageHeatmap.toggle();
    expect(document.getElementById('heatmap-panel').style.display).toBe('none');
  });
});

/* ================================================================
 * Rendering
 * ================================================================ */
describe('UsageHeatmap._render', () => {
  test('renders grid with 7 day rows + 1 header + legend', () => {
    UsageHeatmap._render();
    const grid = document.getElementById('heatmap-grid');
    const rows = grid.querySelectorAll('.heatmap-row');
    expect(rows.length).toBe(8); // 1 header + 7 days
  });

  test('renders 24 cells per day row', () => {
    UsageHeatmap._render();
    const grid = document.getElementById('heatmap-grid');
    const dayRows = grid.querySelectorAll('.heatmap-row:not(.heatmap-header-row)');
    for (let i = 0; i < 7; i++) {
      const cells = dayRows[i].querySelectorAll('.heatmap-cell');
      expect(cells.length).toBe(24);
    }
  });

  test('renders stats section', () => {
    UsageHeatmap._render();
    const stats = document.getElementById('heatmap-stats');
    expect(stats.innerHTML).toContain('messages');
    expect(stats.innerHTML).toContain('sessions scanned');
  });

  test('cells have correct data-count attributes', () => {
    const d = new Date(2025, 0, 6, 10, 0);
    injectSessions([makeSession('s1', [
      { role: 'user', content: 'a', timestamp: d.toISOString() },
      { role: 'user', content: 'b', timestamp: d.toISOString() },
    ])]);

    UsageHeatmap._render();
    const grid = document.getElementById('heatmap-grid');
    const dayRows = grid.querySelectorAll('.heatmap-row:not(.heatmap-header-row)');
    const mondayRow = dayRows[d.getDay()];
    const cells = mondayRow.querySelectorAll('.heatmap-cell');
    expect(cells[10].getAttribute('data-count')).toBe('2');
  });
});

/* ================================================================
 * CSV export
 * ================================================================ */
describe('UsageHeatmap.exportCSV', () => {
  test('generates valid CSV content', () => {
    let capturedContent = '';
    const origBlob = global.Blob;
    global.Blob = jest.fn(([content]) => {
      capturedContent = content;
      return { size: content.length };
    });
    global.URL.createObjectURL = jest.fn(() => 'blob:test');
    global.URL.revokeObjectURL = jest.fn();

    const clickSpy = jest.fn();
    jest.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click: clickSpy,
    });
    jest.spyOn(document.body, 'appendChild').mockImplementation(() => {});
    jest.spyOn(document.body, 'removeChild').mockImplementation(() => {});

    UsageHeatmap.exportCSV();

    expect(capturedContent).toContain('Day,');
    expect(capturedContent).toContain('Sun,');
    expect(capturedContent).toContain('Mon,');
    expect(capturedContent).toContain('Sat,');
    const lines = capturedContent.trim().split('\n');
    expect(lines.length).toBe(8); // header + 7 days
    expect(lines[0].split(',').length).toBe(25); // Day + 24 hours

    global.Blob = origBlob;
  });
});

/* ================================================================
 * Init wiring
 * ================================================================ */
describe('UsageHeatmap.init', () => {
  test('wires close button', () => {
    UsageHeatmap.open();
    document.getElementById('heatmap-close-btn').click();
    expect(document.getElementById('heatmap-panel').style.display).toBe('none');
  });

  test('wires overlay click', () => {
    UsageHeatmap.open();
    document.getElementById('heatmap-overlay').click();
    expect(document.getElementById('heatmap-panel').style.display).toBe('none');
  });
});
