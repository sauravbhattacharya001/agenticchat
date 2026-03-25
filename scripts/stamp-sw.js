#!/usr/bin/env node
/**
 * stamp-sw.js — Inject a content-based cache key into sw.js.
 *
 * Hashes the app-shell files (index.html, app.js, style.css) and writes the
 * resulting short hash into sw.js's CACHE_NAME constant so every deploy
 * automatically busts stale service-worker caches.
 *
 * Usage:  node scripts/stamp-sw.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SW   = path.join(ROOT, 'sw.js');

const APP_SHELL_FILES = ['index.html', 'app.js', 'style.css'];

// Build a combined hash of all app-shell assets.
const hash = crypto.createHash('sha256');
for (const file of APP_SHELL_FILES) {
  const fp = path.join(ROOT, file);
  if (!fs.existsSync(fp)) {
    console.error(`stamp-sw: missing app-shell file ${file}`);
    process.exit(1);
  }
  hash.update(fs.readFileSync(fp));
}
const short = hash.digest('hex').slice(0, 10);

// Replace the CACHE_NAME line in sw.js.
let src = fs.readFileSync(SW, 'utf8');
const replaced = src.replace(
  /const CACHE_NAME\s*=\s*'[^']*';/,
  `const CACHE_NAME = 'agenticchat-${short}';`
);

if (replaced === src) {
  console.error('stamp-sw: could not find CACHE_NAME in sw.js');
  process.exit(1);
}

fs.writeFileSync(SW, replaced, 'utf8');
console.log(`stamp-sw: CACHE_NAME → agenticchat-${short}`);
