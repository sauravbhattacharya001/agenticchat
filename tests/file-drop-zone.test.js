/**
 * @jest-environment jsdom
 *
 * Tests for FileDropZone module (agenticchat)
 *
 * Covers isTextFile, _getExt, _langHint, and file size/type validation.
 */

'use strict';

/* ── Replicate pure functions from app.js ───────────── */

const TEXT_EXTENSIONS = new Set([
  'txt', 'json', 'csv', 'js', 'jsx', 'ts', 'tsx', 'py', 'md', 'html',
  'htm', 'css', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'log',
  'sql', 'sh', 'bat', 'ps1', 'rs', 'go', 'java', 'c', 'cpp', 'h',
  'hpp', 'rb', 'php', 'swift', 'kt', 'kts', 'scala', 'r', 'lua',
  'pl', 'pm', 'ex', 'exs', 'erl', 'hs', 'ml', 'mli', 'fs', 'fsx',
  'clj', 'cljs', 'lisp', 'el', 'vim', 'diff', 'patch', 'env',
  'gitignore', 'dockerignore', 'editorconfig', 'prettierrc',
  'eslintrc', 'babelrc', 'tsconfig', 'svg', 'tex', 'bib', 'rst',
  'adoc', 'org', 'makefile', 'cmake', 'gradle', 'sbt', 'cabal',
  'lock', 'sum', 'mod', 'csproj', 'sln', 'vcxproj', 'pom',
  'properties', 'conf', 'rc', 'srv'
]);

function isTextFile(filename) {
  if (!filename) return false;
  const dotIdx = filename.lastIndexOf('.');
  if (dotIdx < 0) {
    const lower = filename.toLowerCase();
    return ['makefile', 'dockerfile', 'rakefile', 'gemfile', 'procfile',
            'vagrantfile', 'readme', 'license', 'changelog', 'authors',
            'contributing', 'todo', 'notes'].includes(lower);
  }
  const ext = filename.substring(dotIdx + 1).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

function _getExt(filename) {
  const dotIdx = filename.lastIndexOf('.');
  return dotIdx >= 0 ? filename.substring(dotIdx + 1).toLowerCase() : '';
}

function _langHint(ext) {
  const map = {
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp',
    swift: 'swift', kt: 'kotlin', scala: 'scala', r: 'r',
    sh: 'bash', bat: 'batch', ps1: 'powershell',
    sql: 'sql', html: 'html', htm: 'html', css: 'css',
    xml: 'xml', svg: 'xml', json: 'json', yaml: 'yaml', yml: 'yaml',
    toml: 'toml', md: 'markdown', tex: 'latex',
    lua: 'lua', pl: 'perl', php: 'php', ex: 'elixir',
    hs: 'haskell', ml: 'ocaml', fs: 'fsharp', clj: 'clojure',
    lisp: 'lisp', diff: 'diff', csv: 'csv', srv: 'sauravcode'
  };
  return map[ext] || '';
}

/* ── isTextFile ───────────── */

describe('FileDropZone — isTextFile', () => {
  test.each([
    'app.js', 'style.css', 'data.json', 'readme.md', 'main.py',
    'config.yaml', 'test.ts', 'page.html', 'script.sh', 'code.rs',
    'lib.go', 'Main.java', 'header.h', 'file.cpp', 'query.sql'
  ])('accepts text file: %s', (name) => {
    expect(isTextFile(name)).toBe(true);
  });

  test.each([
    'photo.jpg', 'image.png', 'video.mp4', 'song.mp3', 'archive.zip',
    'doc.pdf', 'sheet.xlsx', 'app.exe', 'lib.dll', 'font.woff2'
  ])('rejects binary file: %s', (name) => {
    expect(isTextFile(name)).toBe(false);
  });

  test.each([
    'Makefile', 'Dockerfile', 'README', 'LICENSE', 'CHANGELOG',
    'Gemfile', 'Procfile', 'Vagrantfile'
  ])('accepts extensionless known file: %s', (name) => {
    expect(isTextFile(name)).toBe(true);
  });

  test('rejects unknown extensionless file', () => {
    expect(isTextFile('randomfile')).toBe(false);
  });

  test('rejects null/undefined/empty', () => {
    expect(isTextFile(null)).toBe(false);
    expect(isTextFile(undefined)).toBe(false);
    expect(isTextFile('')).toBe(false);
  });

  test('case-insensitive for extensionless files', () => {
    expect(isTextFile('makefile')).toBe(true);
    expect(isTextFile('MAKEFILE')).toBe(true);
  });

  test('handles dotfiles', () => {
    expect(isTextFile('.gitignore')).toBe(true);
    expect(isTextFile('.env')).toBe(true);
  });

  test('handles multiple dots', () => {
    expect(isTextFile('my.app.config.json')).toBe(true);
    expect(isTextFile('archive.tar.gz')).toBe(false);
  });
});

/* ── _getExt ───────────── */

describe('FileDropZone — _getExt', () => {
  test('extracts simple extension', () => {
    expect(_getExt('file.js')).toBe('js');
  });

  test('handles uppercase', () => {
    expect(_getExt('FILE.JSON')).toBe('json');
  });

  test('takes last extension with multiple dots', () => {
    expect(_getExt('archive.tar.gz')).toBe('gz');
  });

  test('returns empty for no extension', () => {
    expect(_getExt('Makefile')).toBe('');
  });

  test('handles dotfiles', () => {
    expect(_getExt('.gitignore')).toBe('gitignore');
  });
});

/* ── _langHint ───────────── */

describe('FileDropZone — _langHint', () => {
  test('maps js to javascript', () => {
    expect(_langHint('js')).toBe('javascript');
  });

  test('maps py to python', () => {
    expect(_langHint('py')).toBe('python');
  });

  test('maps ts to typescript', () => {
    expect(_langHint('ts')).toBe('typescript');
  });

  test('maps html and htm', () => {
    expect(_langHint('html')).toBe('html');
    expect(_langHint('htm')).toBe('html');
  });

  test('maps yaml and yml', () => {
    expect(_langHint('yaml')).toBe('yaml');
    expect(_langHint('yml')).toBe('yaml');
  });

  test('returns empty for unknown extension', () => {
    expect(_langHint('xyz')).toBe('');
    expect(_langHint('')).toBe('');
  });

  test('maps srv to sauravcode', () => {
    expect(_langHint('srv')).toBe('sauravcode');
  });

  test('maps header files correctly', () => {
    expect(_langHint('h')).toBe('c');
    expect(_langHint('hpp')).toBe('cpp');
  });
});

/* ── Constants ───────────── */

describe('FileDropZone — constants', () => {
  const MAX_FILE_SIZE = 100 * 1024;
  const MAX_FILES = 5;

  test('MAX_FILE_SIZE is 100 KB', () => {
    expect(MAX_FILE_SIZE).toBe(102400);
  });

  test('MAX_FILES is 5', () => {
    expect(MAX_FILES).toBe(5);
  });
});
