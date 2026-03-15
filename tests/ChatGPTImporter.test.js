/**
 * @jest-environment jsdom
 */

// --- Minimal stubs for dependencies ---
const SafeStorage = { get: () => null, set: () => {} };
const SessionManager = {
  importSession: jest.fn((jsonStr) => {
    try {
      const data = JSON.parse(jsonStr);
      if (data.session && data.session.messages && data.session.messages.length > 0) {
        return { id: 'test-id', name: data.session.name, messages: data.session.messages };
      }
    } catch (_) {}
    return null;
  })
};
const HistoryPanel = { refresh: jest.fn() };

// Load the module — extract ChatGPTImporter IIFE from app.js and run it
const fs = require('fs');
const appCode = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf-8');
const start = appCode.indexOf('const ChatGPTImporter = (() => {');
const end = appCode.indexOf('})();', start) + 5;
const moduleCode = appCode.substring(start, end);
// Use Function constructor to execute in global-ish scope
const fn = new Function('SessionManager', 'HistoryPanel', moduleCode + '\nreturn ChatGPTImporter;');
const ChatGPTImporter = fn(SessionManager, HistoryPanel);

describe('ChatGPTImporter', () => {
  beforeEach(() => {
    SessionManager.importSession.mockClear();
    HistoryPanel.refresh.mockClear();
  });

  describe('_extractMessages', () => {
    test('extracts user and assistant messages from mapping tree', () => {
      const conv = {
        mapping: {
          'root': { parent: null, children: ['msg1'], message: null },
          'msg1': { parent: 'root', children: ['msg2'], message: {
            author: { role: 'user' },
            content: { parts: ['Hello, how are you?'] }
          }},
          'msg2': { parent: 'msg1', children: [], message: {
            author: { role: 'assistant' },
            content: { parts: ['I am doing well, thanks!'] }
          }}
        }
      };
      const messages = ChatGPTImporter._extractMessages(conv);
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ role: 'user', content: 'Hello, how are you?' });
      expect(messages[1]).toEqual({ role: 'assistant', content: 'I am doing well, thanks!' });
    });

    test('skips system messages', () => {
      const conv = {
        mapping: {
          'root': { parent: null, children: ['sys'], message: null },
          'sys': { parent: 'root', children: ['msg1'], message: {
            author: { role: 'system' },
            content: { parts: ['You are a helpful assistant.'] }
          }},
          'msg1': { parent: 'sys', children: [], message: {
            author: { role: 'user' },
            content: { parts: ['Hi'] }
          }}
        }
      };
      const messages = ChatGPTImporter._extractMessages(conv);
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('user');
    });

    test('handles content as string (legacy format)', () => {
      const conv = {
        mapping: {
          'root': { parent: null, children: ['msg1'], message: null },
          'msg1': { parent: 'root', children: [], message: {
            author: { role: 'user' },
            content: 'Direct string content'
          }}
        }
      };
      const messages = ChatGPTImporter._extractMessages(conv);
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Direct string content');
    });

    test('handles content.text format', () => {
      const conv = {
        mapping: {
          'root': { parent: null, children: ['msg1'], message: null },
          'msg1': { parent: 'root', children: [], message: {
            author: { role: 'assistant' },
            content: { text: 'Text field content' }
          }}
        }
      };
      const messages = ChatGPTImporter._extractMessages(conv);
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Text field content');
    });

    test('joins multiple parts with newline', () => {
      const conv = {
        mapping: {
          'root': { parent: null, children: ['msg1'], message: null },
          'msg1': { parent: 'root', children: [], message: {
            author: { role: 'user' },
            content: { parts: ['Part 1', 'Part 2', 'Part 3'] }
          }}
        }
      };
      const messages = ChatGPTImporter._extractMessages(conv);
      expect(messages[0].content).toBe('Part 1\nPart 2\nPart 3');
    });

    test('skips messages with empty content', () => {
      const conv = {
        mapping: {
          'root': { parent: null, children: ['msg1'], message: null },
          'msg1': { parent: 'root', children: ['msg2'], message: {
            author: { role: 'user' },
            content: { parts: ['  '] }
          }},
          'msg2': { parent: 'msg1', children: [], message: {
            author: { role: 'assistant' },
            content: { parts: ['Real response'] }
          }}
        }
      };
      const messages = ChatGPTImporter._extractMessages(conv);
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Real response');
    });

    test('returns empty array for missing mapping', () => {
      expect(ChatGPTImporter._extractMessages({})).toEqual([]);
      expect(ChatGPTImporter._extractMessages({ mapping: null })).toEqual([]);
    });

    test('filters non-string parts from content.parts', () => {
      const conv = {
        mapping: {
          'root': { parent: null, children: ['msg1'], message: null },
          'msg1': { parent: 'root', children: [], message: {
            author: { role: 'user' },
            content: { parts: ['Text', { type: 'image' }, 'More text'] }
          }}
        }
      };
      const messages = ChatGPTImporter._extractMessages(conv);
      expect(messages[0].content).toBe('Text\nMore text');
    });

    test('follows first child in branching conversations', () => {
      const conv = {
        mapping: {
          'root': { parent: null, children: ['a', 'b'], message: null },
          'a': { parent: 'root', children: ['c'], message: {
            author: { role: 'user' }, content: { parts: ['Branch A'] }
          }},
          'b': { parent: 'root', children: [], message: {
            author: { role: 'user' }, content: { parts: ['Branch B'] }
          }},
          'c': { parent: 'a', children: [], message: {
            author: { role: 'assistant' }, content: { parts: ['Reply to A'] }
          }}
        }
      };
      const messages = ChatGPTImporter._extractMessages(conv);
      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe('Branch A');
      expect(messages[1].content).toBe('Reply to A');
    });
  });

  describe('importFromJSON', () => {
    test('imports array of conversations', () => {
      const data = [
        {
          title: 'Chat 1',
          mapping: {
            'r': { parent: null, children: ['m1'], message: null },
            'm1': { parent: 'r', children: [], message: {
              author: { role: 'user' }, content: { parts: ['Hello'] }
            }}
          }
        },
        {
          title: 'Chat 2',
          mapping: {
            'r': { parent: null, children: ['m1'], message: null },
            'm1': { parent: 'r', children: [], message: {
              author: { role: 'user' }, content: { parts: ['World'] }
            }}
          }
        }
      ];
      const result = ChatGPTImporter.importFromJSON(JSON.stringify(data));
      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.names).toEqual(['Chat 1', 'Chat 2']);
      expect(SessionManager.importSession).toHaveBeenCalledTimes(2);
    });

    test('imports single conversation object', () => {
      const data = {
        title: 'Solo Chat',
        mapping: {
          'r': { parent: null, children: ['m1'], message: null },
          'm1': { parent: 'r', children: [], message: {
            author: { role: 'user' }, content: { parts: ['Hi'] }
          }}
        }
      };
      const result = ChatGPTImporter.importFromJSON(JSON.stringify(data));
      expect(result.imported).toBe(1);
      expect(result.names).toEqual(['Solo Chat']);
    });

    test('appends (ChatGPT) suffix to session name', () => {
      const data = [{
        title: 'My Chat',
        mapping: {
          'r': { parent: null, children: ['m1'], message: null },
          'm1': { parent: 'r', children: [], message: {
            author: { role: 'user' }, content: { parts: ['Hi'] }
          }}
        }
      }];
      ChatGPTImporter.importFromJSON(JSON.stringify(data));
      const call = SessionManager.importSession.mock.calls[0][0];
      const parsed = JSON.parse(call);
      expect(parsed.session.name).toBe('My Chat (ChatGPT)');
    });

    test('uses fallback name for untitled conversations', () => {
      const data = [{
        mapping: {
          'r': { parent: null, children: ['m1'], message: null },
          'm1': { parent: 'r', children: [], message: {
            author: { role: 'user' }, content: { parts: ['Hi'] }
          }}
        }
      }];
      ChatGPTImporter.importFromJSON(JSON.stringify(data));
      const parsed = JSON.parse(SessionManager.importSession.mock.calls[0][0]);
      expect(parsed.session.name).toBe('ChatGPT Import (ChatGPT)');
    });

    test('skips conversations with no valid messages', () => {
      const data = [
        { title: 'Empty', mapping: {} },
        {
          title: 'Has messages',
          mapping: {
            'r': { parent: null, children: ['m1'], message: null },
            'm1': { parent: 'r', children: [], message: {
              author: { role: 'user' }, content: { parts: ['Hi'] }
            }}
          }
        }
      ];
      const result = ChatGPTImporter.importFromJSON(JSON.stringify(data));
      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);
    });

    test('throws on invalid JSON', () => {
      expect(() => ChatGPTImporter.importFromJSON('not json'))
        .toThrow('Invalid JSON file');
    });

    test('throws on empty array', () => {
      expect(() => ChatGPTImporter.importFromJSON('[]'))
        .toThrow('No conversations found');
    });

    test('skips null entries in array', () => {
      const data = [null, {
        title: 'Valid',
        mapping: {
          'r': { parent: null, children: ['m1'], message: null },
          'm1': { parent: 'r', children: [], message: {
            author: { role: 'user' }, content: { parts: ['Hi'] }
          }}
        }
      }];
      const result = ChatGPTImporter.importFromJSON(JSON.stringify(data));
      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);
    });
  });
});
