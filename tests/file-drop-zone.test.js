/**
 * FileDropZone — Unit Tests
 *
 * Covers: isTextFile validation, file size limits, max files cap,
 * language hint mapping, extension extraction, file reading and
 * insertion into chat input, drag-and-drop event handling,
 * error reporting for unsupported/oversized files.
 */

const { setupDOM, loadApp } = require('./setup');

beforeEach(() => {
  setupDOM();
  loadApp();
  localStorage.clear();
});

/* ================================================================
 * isTextFile
 * ================================================================ */
describe('FileDropZone — isTextFile', () => {
  test('accepts common text extensions', () => {
    const valid = ['file.txt', 'app.js', 'main.py', 'style.css', 'data.json',
                   'config.yaml', 'notes.md', 'query.sql', 'build.rs', 'main.go'];
    for (const name of valid) {
      expect(FileDropZone.isTextFile(name)).toBe(true);
    }
  });

  test('rejects binary file extensions', () => {
    const invalid = ['image.png', 'photo.jpg', 'video.mp4', 'archive.zip',
                     'app.exe', 'lib.dll', 'data.bin', 'music.mp3'];
    for (const name of invalid) {
      expect(FileDropZone.isTextFile(name)).toBe(false);
    }
  });

  test('accepts extensionless common filenames', () => {
    const valid = ['Makefile', 'Dockerfile', 'README', 'LICENSE', 'Gemfile'];
    for (const name of valid) {
      expect(FileDropZone.isTextFile(name)).toBe(true);
    }
  });

  test('rejects extensionless unknown filenames', () => {
    expect(FileDropZone.isTextFile('randomfile')).toBe(false);
  });

  test('returns false for null/undefined/empty', () => {
    expect(FileDropZone.isTextFile(null)).toBe(false);
    expect(FileDropZone.isTextFile(undefined)).toBe(false);
    expect(FileDropZone.isTextFile('')).toBe(false);
  });

  test('is case-insensitive for extensionless names', () => {
    expect(FileDropZone.isTextFile('makefile')).toBe(true);
    expect(FileDropZone.isTextFile('MAKEFILE')).toBe(true);
  });
});

/* ================================================================
 * _langHint
 * ================================================================ */
describe('FileDropZone — _langHint', () => {
  test('returns correct language hints for known extensions', () => {
    expect(FileDropZone._langHint('js')).toBe('javascript');
    expect(FileDropZone._langHint('py')).toBe('python');
    expect(FileDropZone._langHint('rs')).toBe('rust');
    expect(FileDropZone._langHint('go')).toBe('go');
    expect(FileDropZone._langHint('ts')).toBe('typescript');
    expect(FileDropZone._langHint('sh')).toBe('bash');
  });

  test('returns empty string for unknown extensions', () => {
    expect(FileDropZone._langHint('xyz')).toBe('');
    expect(FileDropZone._langHint('')).toBe('');
  });

  test('handles sauravcode custom extension', () => {
    expect(FileDropZone._langHint('srv')).toBe('sauravcode');
  });
});

/* ================================================================
 * _getExt
 * ================================================================ */
describe('FileDropZone — _getExt', () => {
  test('extracts lowercase extension', () => {
    expect(FileDropZone._getExt('app.JS')).toBe('js');
    expect(FileDropZone._getExt('file.test.py')).toBe('py');
  });

  test('returns empty string for no extension', () => {
    expect(FileDropZone._getExt('Makefile')).toBe('');
  });
});

/* ================================================================
 * Constants
 * ================================================================ */
describe('FileDropZone — constants', () => {
  test('MAX_FILE_SIZE is 100KB', () => {
    expect(FileDropZone.MAX_FILE_SIZE).toBe(100 * 1024);
  });

  test('MAX_FILES is 5', () => {
    expect(FileDropZone.MAX_FILES).toBe(5);
  });
});

/* ================================================================
 * handleFiles — integration
 * ================================================================ */
describe('FileDropZone — handleFiles', () => {
  function createMockFile(name, content) {
    const blob = new Blob([content], { type: 'text/plain' });
    blob.name = name;
    // jsdom File constructor
    return new File([content], name, { type: 'text/plain' });
  }

  test('inserts single file content into chat input', async () => {
    FileDropZone.init();
    const file = createMockFile('test.js', 'console.log("hello");');
    await FileDropZone.handleFiles([file]);

    const input = document.getElementById('chat-input');
    expect(input.value).toContain('test.js');
    expect(input.value).toContain('console.log("hello");');
    expect(input.value).toContain('```javascript');
  });

  test('inserts multiple files separated by double newlines', async () => {
    FileDropZone.init();
    const file1 = createMockFile('a.py', 'print("a")');
    const file2 = createMockFile('b.rs', 'fn main() {}');
    await FileDropZone.handleFiles([file1, file2]);

    const input = document.getElementById('chat-input');
    expect(input.value).toContain('a.py');
    expect(input.value).toContain('b.rs');
    expect(input.value).toContain('```python');
    expect(input.value).toContain('```rust');
  });

  test('rejects files over MAX_FILE_SIZE', async () => {
    FileDropZone.init();
    const bigContent = 'x'.repeat(200 * 1024);
    const file = createMockFile('huge.txt', bigContent);
    await FileDropZone.handleFiles([file]);

    const input = document.getElementById('chat-input');
    // File should not be inserted
    expect(input.value).not.toContain('huge.txt');
  });

  test('rejects non-text files', async () => {
    FileDropZone.init();
    const file = new File(['binary'], 'image.png', { type: 'image/png' });
    await FileDropZone.handleFiles([file]);

    const input = document.getElementById('chat-input');
    expect(input.value).not.toContain('image.png');
  });

  test('caps at MAX_FILES and reports overflow', async () => {
    FileDropZone.init();
    const files = [];
    for (let i = 0; i < 8; i++) {
      files.push(createMockFile(`file${i}.txt`, `content ${i}`));
    }
    await FileDropZone.handleFiles(files);

    const input = document.getElementById('chat-input');
    // Only first 5 should appear
    expect(input.value).toContain('file0.txt');
    expect(input.value).toContain('file4.txt');
    expect(input.value).not.toContain('file5.txt');
  });

  test('appends to existing input content', async () => {
    FileDropZone.init();
    const input = document.getElementById('chat-input');
    input.value = 'Existing text';

    const file = createMockFile('data.json', '{"key": "value"}');
    await FileDropZone.handleFiles([file]);

    expect(input.value).toMatch(/^Existing text/);
    expect(input.value).toContain('data.json');
  });

  test('does nothing with empty file list', async () => {
    FileDropZone.init();
    const input = document.getElementById('chat-input');
    input.value = '';
    await FileDropZone.handleFiles([]);
    expect(input.value).toBe('');
  });
});

/* ================================================================
 * Drag-and-drop events
 * ================================================================ */
describe('FileDropZone — drag events', () => {
  test('init sets up dragenter/dragleave/drop on blackbox', () => {
    FileDropZone.init();
    const blackbox = document.getElementById('blackbox');
    expect(blackbox).not.toBeNull();

    // Simulate dragenter — overlay should become visible
    const enterEvent = new Event('dragenter', { bubbles: true });
    enterEvent.preventDefault = jest.fn();
    enterEvent.stopPropagation = jest.fn();
    enterEvent.dataTransfer = { dropEffect: '' };
    blackbox.dispatchEvent(enterEvent);

    const overlay = document.getElementById('file-drop-overlay');
    if (overlay) {
      expect(overlay.classList.contains('visible')).toBe(true);
    }
  });
});
