/**
 * SmartReferenceTracker — tests
 * 50 test cases covering all 8 detector functions, scoring, insights,
 * state management, config, starring, export, and edge cases.
 */

const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
const { JSDOM } = require('jsdom');

function bootModule() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="chat-output"></div><div class="toolbar"></div></body></html>', { url: 'http://localhost' });
  const { window } = dom;
  const { document } = window;

  global.window = window;
  global.document = document;
  global.HTMLElement = window.HTMLElement;
  global.MutationObserver = class { observe() {} disconnect() {} };
  global.setTimeout = (fn) => fn();
  global.clearTimeout = () => {};
  global.requestAnimationFrame = (fn) => fn();

  const _store = {};
  global.SafeStorage = {
    get(k) { return _store[k] || null; },
    set(k, v) { _store[k] = v; },
    remove(k) { delete _store[k]; }
  };
  global.navigator = { clipboard: { writeText: () => Promise.resolve() } };

  delete require.cache[require.resolve('../app.js')];

  const fs = require('fs');
  const src = fs.readFileSync(require.resolve('../app.js'), 'utf8');
  const marker = '/* ============================================================\n * SmartReferenceTracker';
  const idx = src.lastIndexOf(marker);
  if (idx === -1) throw new Error('SmartReferenceTracker not found in app.js');
  const moduleCode = src.slice(idx);
  const fn = new Function('SafeStorage', 'document', 'MutationObserver', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'navigator',
    moduleCode + '\nreturn SmartReferenceTracker;');
  const mod = fn(global.SafeStorage, document, global.MutationObserver, global.setTimeout, global.clearTimeout, global.requestAnimationFrame, global.navigator);
  return { mod, dom, document, _store };
}

let SRT, dom, doc, store;

beforeEach(() => {
  const env = bootModule();
  SRT = env.mod;
  dom = env.dom;
  doc = env.document;
  store = env._store;
});

/* ── URL Detection ── */
describe('detectURLs', () => {
  test('finds http and https URLs', () => {
    const r = SRT.detectURLs('Visit https://example.com and http://test.org/page');
    expect(r.length).toBe(2);
    expect(r[0].value).toBe('https://example.com');
    expect(r[1].value).toBe('http://test.org/page');
  });

  test('strips trailing punctuation from URLs', () => {
    const r = SRT.detectURLs('See https://example.com).');
    expect(r[0].value).toBe('https://example.com');
  });

  test('returns empty for no URLs', () => {
    expect(SRT.detectURLs('No links here')).toEqual([]);
  });

  test('handles complex URLs with query params', () => {
    const r = SRT.detectURLs('Go to https://api.example.com/v2/users?id=123&format=json');
    expect(r.length).toBe(1);
    expect(r[0].value).toContain('id=123');
  });
});

/* ── Code Snippet Detection ── */
describe('detectCodeSnippets', () => {
  test('detects inline code', () => {
    const r = SRT.detectCodeSnippets('Use `console.log("hi")` for debugging');
    expect(r.length).toBe(1);
    expect(r[0].value).toBe('console.log("hi")');
  });

  test('detects code blocks', () => {
    const r = SRT.detectCodeSnippets('```js\nconst x = 42;\n```');
    expect(r.length).toBe(1);
    expect(r[0].value).toContain('const x = 42');
  });

  test('skips very short inline code', () => {
    const r = SRT.detectCodeSnippets('Use `x` for var');
    expect(r.length).toBe(0);
  });

  test('does not treat URLs in backticks as code', () => {
    const r = SRT.detectCodeSnippets('Visit `https://example.com` for docs');
    expect(r.length).toBe(0);
  });
});

/* ── File Path Detection ── */
describe('detectFilePaths', () => {
  test('detects Unix paths', () => {
    const r = SRT.detectFilePaths('Edit /usr/local/bin/script.sh');
    expect(r.length).toBe(1);
    expect(r[0].value).toContain('/usr/local');
  });

  test('detects Windows paths', () => {
    const r = SRT.detectFilePaths('Open C:\\Users\\admin\\file.txt');
    expect(r.length).toBe(1);
    expect(r[0].value).toContain('C:\\Users');
  });

  test('detects home-relative paths', () => {
    const r = SRT.detectFilePaths('Config at ~/config/settings.json');
    expect(r.length).toBe(1);
    expect(r[0].value).toContain('~/config');
  });

  test('returns empty for no paths', () => {
    expect(SRT.detectFilePaths('Just text')).toEqual([]);
  });
});

/* ── API Endpoint Detection ── */
describe('detectAPIEndpoints', () => {
  test('detects HTTP method + route', () => {
    const r = SRT.detectAPIEndpoints('Call GET /api/users/123');
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r[0].value).toContain('GET');
    expect(r[0].value).toContain('/api/users');
  });

  test('detects POST endpoints', () => {
    const r = SRT.detectAPIEndpoints('Send POST /api/items to create');
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r[0].value).toContain('POST');
  });

  test('detects /api/ routes without HTTP method', () => {
    const r = SRT.detectAPIEndpoints('The endpoint /api/v2/data returns JSON');
    expect(r.length).toBeGreaterThanOrEqual(1);
  });
});

/* ── Command Detection ── */
describe('detectCommands', () => {
  test('detects npm commands', () => {
    const r = SRT.detectCommands('Run npm install express');
    expect(r.length).toBe(1);
    expect(r[0].value).toContain('npm install');
  });

  test('detects git commands', () => {
    const r = SRT.detectCommands('Use git clone https://github.com/foo/bar');
    expect(r.length).toBe(1);
    expect(r[0].value).toContain('git clone');
  });

  test('detects docker commands', () => {
    const r = SRT.detectCommands('Run docker build -t myapp .');
    expect(r.length).toBe(1);
    expect(r[0].value).toContain('docker build');
  });

  test('detects pip commands', () => {
    const r = SRT.detectCommands('Install with pip install flask');
    expect(r.length).toBe(1);
    expect(r[0].value).toContain('pip install');
  });
});

/* ── Version Detection ── */
describe('detectVersions', () => {
  test('detects semver', () => {
    const r = SRT.detectVersions('Using v2.1.3 of the library');
    expect(r.length).toBe(1);
    expect(r[0].value).toBe('v2.1.3');
  });

  test('detects @latest', () => {
    const r = SRT.detectVersions('Install package@latest');
    expect(r.length).toBe(1);
    expect(r[0].value).toBe('@latest');
  });

  test('detects pre-release versions', () => {
    const r = SRT.detectVersions('Testing 3.0.0-beta.1');
    expect(r.length).toBe(1);
    expect(r[0].value).toBe('3.0.0-beta.1');
  });

  test('detects two-part versions', () => {
    const r = SRT.detectVersions('Node 22.18 is out');
    expect(r.length).toBe(1);
    expect(r[0].value).toBe('22.18');
  });
});

/* ── Data Value Detection ── */
describe('detectDataValues', () => {
  test('detects IP addresses', () => {
    const r = SRT.detectDataValues('Connect to 192.168.1.100');
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r.some(ref => ref.value === '192.168.1.100')).toBe(true);
  });

  test('detects port numbers', () => {
    const r = SRT.detectDataValues('Server runs on :3000');
    expect(r.length).toBe(1);
    expect(r[0].value).toContain('3000');
  });

  test('detects percentages', () => {
    const r = SRT.detectDataValues('Coverage is 85.5%');
    expect(r.length).toBe(1);
    expect(r[0].value).toBe('85.5%');
  });

  test('detects dates', () => {
    const r = SRT.detectDataValues('Released on 2024-01-15');
    expect(r.length).toBe(1);
    expect(r[0].value).toBe('2024-01-15');
  });

  test('detects hex colors', () => {
    const r = SRT.detectDataValues('Use color #ff5733');
    expect(r.length).toBe(1);
    expect(r[0].value).toBe('#ff5733');
  });
});

/* ── Key Term Detection ── */
describe('detectKeyTerms', () => {
  test('detects popular frameworks', () => {
    const r = SRT.detectKeyTerms('We use React and Django for this project');
    expect(r.length).toBe(2);
    const values = r.map(x => x.value.toLowerCase());
    expect(values).toContain('react');
    expect(values).toContain('django');
  });

  test('deduplicates same term', () => {
    const r = SRT.detectKeyTerms('React is great. I love React.');
    expect(r.length).toBe(1);
  });

  test('returns empty for no tech terms', () => {
    const r = SRT.detectKeyTerms('The weather is nice today');
    expect(r.length).toBe(0);
  });
});

/* ── Unified Extraction ── */
describe('extractAll', () => {
  test('extracts from mixed text', () => {
    const text = 'Check https://example.com, run npm install express v2.1.0 with React at /usr/local/bin';
    const r = SRT.extractAll(text);
    expect(r.length).toBeGreaterThanOrEqual(4);
    const cats = r.map(x => x.category);
    expect(cats).toContain('url');
    expect(cats).toContain('command');
    expect(cats).toContain('version');
  });

  test('returns empty for null/undefined', () => {
    expect(SRT.extractAll(null)).toEqual([]);
    expect(SRT.extractAll(undefined)).toEqual([]);
    expect(SRT.extractAll('')).toEqual([]);
  });

  test('returns empty for non-string', () => {
    expect(SRT.extractAll(42)).toEqual([]);
  });
});

/* ── Scoring ── */
describe('computeScore', () => {
  test('returns 50 for zero exchanges', () => {
    expect(SRT.computeScore([], 0)).toBe(50);
  });

  test('higher score for more refs per exchange', () => {
    const fewRefs = [{ category: 'url' }];
    const manyRefs = Array(20).fill(null).map((_, i) => ({ category: ['url', 'code', 'command', 'version', 'keyTerm'][i % 5] }));
    const scoreFew = SRT.computeScore(fewRefs, 5);
    const scoreMany = SRT.computeScore(manyRefs, 5);
    expect(scoreMany).toBeGreaterThan(scoreFew);
  });

  test('diversity bonus for multiple categories', () => {
    const singleCat = Array(10).fill({ category: 'url' });
    const multiCat = [
      { category: 'url' }, { category: 'code' }, { category: 'command' },
      { category: 'version' }, { category: 'keyTerm' }, { category: 'filePath' },
      { category: 'apiEndpoint' }, { category: 'dataValue' },
      { category: 'url' }, { category: 'code' }
    ];
    const s1 = SRT.computeScore(singleCat, 5);
    const s2 = SRT.computeScore(multiCat, 5);
    expect(s2).toBeGreaterThan(s1);
  });
});

/* ── Tier Classification ── */
describe('classifyTier', () => {
  test('90+ is Reference-Rich', () => {
    expect(SRT.classifyTier(95).name).toBe('Reference-Rich');
  });

  test('70-89 is Well-Referenced', () => {
    expect(SRT.classifyTier(75).name).toBe('Well-Referenced');
  });

  test('40-69 is Moderate', () => {
    expect(SRT.classifyTier(50).name).toBe('Moderate');
  });

  test('0-39 is Sparse', () => {
    expect(SRT.classifyTier(20).name).toBe('Sparse');
  });
});

/* ── Insights ── */
describe('generateInsights', () => {
  test('empty refs returns empty insights', () => {
    const state = { references: [], history: [] };
    expect(SRT.generateInsights(state)).toEqual([]);
  });

  test('identifies top category', () => {
    const refs = [
      { category: 'url', value: 'a', starred: false },
      { category: 'url', value: 'b', starred: false },
      { category: 'code', value: 'c', starred: false }
    ];
    const ins = SRT.generateInsights({ references: refs, history: [] });
    expect(ins.some(i => i.type === 'top_category')).toBe(true);
  });

  test('identifies repeated values', () => {
    const refs = [
      { category: 'url', value: 'https://same.com', starred: false },
      { category: 'url', value: 'https://same.com', starred: false }
    ];
    const ins = SRT.generateInsights({ references: refs, history: [] });
    expect(ins.some(i => i.type === 'repeated')).toBe(true);
  });

  test('identifies starred count', () => {
    const refs = [
      { category: 'url', value: 'a', starred: true },
      { category: 'url', value: 'b', starred: true }
    ];
    const ins = SRT.generateInsights({ references: refs, history: [] });
    expect(ins.some(i => i.type === 'starred')).toBe(true);
  });

  test('identifies URL-heavy conversations', () => {
    const refs = Array(7).fill(null).map((_, i) => ({ category: 'url', value: 'url' + i, starred: false }));
    const ins = SRT.generateInsights({ references: refs, history: [] });
    expect(ins.some(i => i.type === 'url_heavy')).toBe(true);
  });

  test('identifies code-heavy conversations', () => {
    const refs = Array(5).fill(null).map((_, i) => ({ category: 'code', value: 'code' + i, starred: false }));
    const ins = SRT.generateInsights({ references: refs, history: [] });
    expect(ins.some(i => i.type === 'code_heavy')).toBe(true);
  });

  test('identifies diverse references', () => {
    const cats = ['url', 'code', 'command', 'version', 'keyTerm'];
    const refs = cats.map(c => ({ category: c, value: 'x', starred: false }));
    const ins = SRT.generateInsights({ references: refs, history: [] });
    expect(ins.some(i => i.type === 'diverse')).toBe(true);
  });

  test('identifies narrow references', () => {
    const refs = [{ category: 'url', value: 'a', starred: false }];
    const ins = SRT.generateInsights({ references: refs, history: [] });
    expect(ins.some(i => i.type === 'narrow')).toBe(true);
  });

  test('detects growing trend', () => {
    const refs = [{ category: 'url', value: 'a', starred: false }];
    const ins = SRT.generateInsights({ references: refs, history: [20, 40, 60] });
    expect(ins.some(i => i.type === 'growing')).toBe(true);
  });
});

/* ── State Management ── */
describe('state management', () => {
  test('reset clears state', () => {
    SRT.reset();
    const s = SRT.getState();
    expect(s.references).toEqual([]);
    expect(s.totalExtracted).toBe(0);
  });

  test('getState returns a copy', () => {
    const s1 = SRT.getState();
    const s2 = SRT.getState();
    expect(s1).toEqual(s2);
    expect(s1).not.toBe(s2);
  });

  test('getScore returns currentScore', () => {
    expect(typeof SRT.getScore()).toBe('number');
  });
});

/* ── Config ── */
describe('config', () => {
  test('isEnabled returns true by default', () => {
    expect(SRT.isEnabled()).toBe(true);
  });

  test('setEnabled toggles state', () => {
    SRT.setEnabled(false);
    expect(SRT.isEnabled()).toBe(false);
    SRT.setEnabled(true);
    expect(SRT.isEnabled()).toBe(true);
  });

  test('getConfig returns copy', () => {
    const c = SRT.getConfig();
    expect(c.sensitivity).toBe('medium');
  });
});

/* ── Export ── */
describe('exportReferences', () => {
  test('returns valid JSON string', () => {
    const json = SRT.exportReferences();
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

/* ── Constants ── */
describe('constants', () => {
  test('has 8 categories', () => {
    expect(Object.keys(SRT.CATEGORIES).length).toBe(8);
  });

  test('has 4 tiers', () => {
    expect(Object.keys(SRT.TIERS).length).toBe(4);
  });

  test('has 3 sensitivities', () => {
    expect(Object.keys(SRT.SENSITIVITIES).length).toBe(3);
  });
});

/* ── Sparkline ── */
describe('sparkline', () => {
  test('generates SVG for valid data', () => {
    const svg = SRT._sparkline([10, 20, 30, 40], 100, 30);
    expect(svg).toContain('<svg');
    expect(svg).toContain('polyline');
  });

  test('returns empty for insufficient data', () => {
    expect(SRT._sparkline([42], 100, 30)).toBe('');
    expect(SRT._sparkline([], 100, 30)).toBe('');
    expect(SRT._sparkline(null, 100, 30)).toBe('');
  });
});
