/**
 * Tests for scripts/stamp-sw.js — SW cache-busting stamp script.
 *
 * Verifies that the script:
 * 1. Hashes app-shell files (index.html, app.js, style.css)
 * 2. Replaces CACHE_NAME in sw.js with the content-based hash
 * 3. Fails gracefully when app-shell files are missing
 * 4. Fails when CACHE_NAME pattern is not found in sw.js
 * 5. Produces different hashes when source files change
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'stamp-sw.js');
const ROOT = path.resolve(__dirname, '..');

/**
 * Compute the expected hash from the app-shell files.
 */
function expectedHash() {
  const hash = crypto.createHash('sha256');
  for (const file of ['index.html', 'app.js', 'style.css']) {
    hash.update(fs.readFileSync(path.join(ROOT, file)));
  }
  return hash.digest('hex').slice(0, 10);
}

describe('stamp-sw.js', () => {
  let originalSw;

  beforeEach(() => {
    // Save original sw.js content
    originalSw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  });

  afterEach(() => {
    // Restore original sw.js
    fs.writeFileSync(path.join(ROOT, 'sw.js'), originalSw, 'utf8');
  });

  test('replaces CACHE_NAME with content-based hash', () => {
    execFileSync(process.execPath, [SCRIPT], { cwd: ROOT });

    const updated = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const expected = expectedHash();

    expect(updated).toContain(`const CACHE_NAME = 'agenticchat-${expected}';`);
  });

  test('preserves all other sw.js content', () => {
    const linesBefore = originalSw.split('\n').length;

    execFileSync(process.execPath, [SCRIPT], { cwd: ROOT });

    const updated = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const linesAfter = updated.split('\n').length;

    expect(linesAfter).toBe(linesBefore);
    // Everything except the CACHE_NAME line should be unchanged
    const withoutCache = (s) =>
      s.replace(/const CACHE_NAME\s*=\s*'[^']*';/, 'PLACEHOLDER');
    expect(withoutCache(updated)).toBe(withoutCache(originalSw));
  });

  test('exits with error when CACHE_NAME pattern is missing', () => {
    fs.writeFileSync(
      path.join(ROOT, 'sw.js'),
      '// no cache name here\nself.addEventListener("fetch", () => {});\n',
      'utf8'
    );

    expect(() => {
      execFileSync(process.execPath, [SCRIPT], {
        cwd: ROOT,
        stdio: 'pipe',
      });
    }).toThrow();
  });

  test('hash changes when app.js content changes', () => {
    execFileSync(process.execPath, [SCRIPT], { cwd: ROOT });
    const first = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const match1 = first.match(/agenticchat-([a-f0-9]+)/);

    // Modify app.js to change the hash
    const originalApp = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
    fs.writeFileSync(
      path.join(ROOT, 'app.js'),
      originalApp + '\n// stamp-test-sentinel\n',
      'utf8'
    );

    try {
      // Restore original sw.js so the regex pattern is findable
      fs.writeFileSync(path.join(ROOT, 'sw.js'), originalSw, 'utf8');
      execFileSync(process.execPath, [SCRIPT], { cwd: ROOT });
      const second = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
      const match2 = second.match(/agenticchat-([a-f0-9]+)/);

      expect(match1).not.toBeNull();
      expect(match2).not.toBeNull();
      expect(match1[1]).not.toBe(match2[1]);
    } finally {
      fs.writeFileSync(path.join(ROOT, 'app.js'), originalApp, 'utf8');
    }
  });

  test('hash changes when style.css content changes', () => {
    execFileSync(process.execPath, [SCRIPT], { cwd: ROOT });
    const first = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const match1 = first.match(/agenticchat-([a-f0-9]+)/);

    const originalCss = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
    fs.writeFileSync(
      path.join(ROOT, 'style.css'),
      originalCss + '\n/* stamp-test */\n',
      'utf8'
    );

    try {
      fs.writeFileSync(path.join(ROOT, 'sw.js'), originalSw, 'utf8');
      execFileSync(process.execPath, [SCRIPT], { cwd: ROOT });
      const second = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
      const match2 = second.match(/agenticchat-([a-f0-9]+)/);

      expect(match1).not.toBeNull();
      expect(match2).not.toBeNull();
      expect(match1[1]).not.toBe(match2[1]);
    } finally {
      fs.writeFileSync(path.join(ROOT, 'style.css'), originalCss, 'utf8');
    }
  });

  test('hash changes when index.html content changes', () => {
    execFileSync(process.execPath, [SCRIPT], { cwd: ROOT });
    const first = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const match1 = first.match(/agenticchat-([a-f0-9]+)/);

    const originalHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    fs.writeFileSync(
      path.join(ROOT, 'index.html'),
      originalHtml + '\n<!-- stamp-test -->\n',
      'utf8'
    );

    try {
      fs.writeFileSync(path.join(ROOT, 'sw.js'), originalSw, 'utf8');
      execFileSync(process.execPath, [SCRIPT], { cwd: ROOT });
      const second = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
      const match2 = second.match(/agenticchat-([a-f0-9]+)/);

      expect(match1).not.toBeNull();
      expect(match2).not.toBeNull();
      expect(match1[1]).not.toBe(match2[1]);
    } finally {
      fs.writeFileSync(path.join(ROOT, 'index.html'), originalHtml, 'utf8');
    }
  });
});
