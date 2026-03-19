/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

describe('SmartPaste', () => {
  let SmartPaste;

  beforeAll(() => {
    // Minimal DOM setup
    document.body.innerHTML = '<input id="chat-input" />';
    // Stubs
    global.SafeStorage = { get: () => null, set: () => {} };
    global.DOMCache = { get: (id) => document.getElementById(id) };
    global.sanitizeStorageObject = (o) => o;
    global.SlashCommands = { register: jest.fn() };
    global.CommandPalette = { registerCommand: jest.fn() };
    global.PreferencesPanel = { registerPreference: jest.fn() };

    const code = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    eval(code);
    SmartPaste = global.SmartPaste;
  });

  test('detects single URL', () => {
    expect(SmartPaste.detectType('https://example.com/path?q=1')).toBe('URL');
  });

  test('detects JSON', () => {
    expect(SmartPaste.detectType('{"name":"test","value":42}')).toBe('JSON');
  });

  test('formats JSON with pretty print', () => {
    const result = SmartPaste.formatText('{"a":1}');
    expect(result).toContain('```json');
    expect(result).toContain('"a": 1');
  });

  test('detects CSV data', () => {
    const csv = 'name,age,city\nAlice,30,NYC\nBob,25,LA\nCharlie,35,SF';
    expect(SmartPaste.detectType(csv)).toBe('CSV data');
  });

  test('detects SQL', () => {
    expect(SmartPaste.detectType('SELECT id, name FROM users WHERE active = 1')).toBe('SQL');
  });

  test('detects stack trace', () => {
    const trace = `Error: something broke
    at Module._compile (node:internal/modules/cjs/loader:1376:14)
    at Module._extensions..js (node:internal/modules/cjs/loader:1435:10)
    at Module.load (node:internal/modules/cjs/loader:1207:32)`;
    expect(SmartPaste.detectType(trace)).toBe('Stack trace');
  });

  test('detects Python code', () => {
    const code = `import os\nimport sys\n\ndef main():\n    print("hello")\n    return 0`;
    const type = SmartPaste.detectType(code);
    expect(type).toContain('code');
  });

  test('detects key-value config', () => {
    const config = 'HOST=localhost\nPORT=3000\nDB_NAME=mydb\nDEBUG=true';
    expect(SmartPaste.detectType(config)).toBe('Config / key-value');
  });

  test('returns null for short plain text', () => {
    expect(SmartPaste.detectType('hello world')).toBeNull();
  });

  test('returns null for single short line', () => {
    expect(SmartPaste.detectType('just a note')).toBeNull();
  });

  test('formats multi-URL as list', () => {
    const urls = 'https://a.com\nhttps://b.com\nhttps://c.com';
    const result = SmartPaste.formatText(urls);
    expect(result).toContain('- https://a.com');
    expect(result).toContain('- https://b.com');
  });

  test('guesses JavaScript language', () => {
    expect(SmartPaste._guessLanguage("import React from 'react';\nconst App = () => {\n  return null;\n};")).toBe('javascript');
  });

  test('guesses Go language', () => {
    expect(SmartPaste._guessLanguage('package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hi")\n}')).toBe('go');
  });

  test('enable/disable works', () => {
    SmartPaste.disable();
    expect(SmartPaste.isEnabled()).toBe(false);
    SmartPaste.enable();
    expect(SmartPaste.isEnabled()).toBe(true);
  });
});
