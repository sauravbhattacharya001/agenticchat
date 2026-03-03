/**
 * @jest-environment jsdom
 */
const { setupDOM, loadApp } = require('./setup');

beforeAll(() => {
  // Mock SpeechSynthesisUtterance
  class MockUtterance {
    constructor(text) {
      this.text = text || '';
      this.voice = null;
      this.rate = 1;
      this.pitch = 1;
      this.onstart = null;
      this.onend = null;
      this.onerror = null;
    }
  }
  globalThis.SpeechSynthesisUtterance = MockUtterance;

  // Mock speechSynthesis
  globalThis._mockSpeechQueue = [];
  globalThis._mockSpeechState = { speaking: false, paused: false };
  window.speechSynthesis = {
    getVoices: function () {
      return [
        { voiceURI: 'Google US English', name: 'Google US English', lang: 'en-US', default: true },
        { voiceURI: 'Google UK English', name: 'Google UK English', lang: 'en-GB', default: false },
        { voiceURI: 'Google Fran\u00e7ais', name: 'Google Fran\u00e7ais', lang: 'fr-FR', default: false },
        { voiceURI: 'Google Deutsch', name: 'Google Deutsch', lang: 'de-DE', default: false }
      ];
    },
    speak: function (utterance) {
      globalThis._mockSpeechQueue.push(utterance);
      globalThis._mockSpeechState.speaking = true;
      if (utterance.onstart) utterance.onstart({});
    },
    pause: function () {
      globalThis._mockSpeechState.paused = true;
    },
    resume: function () {
      globalThis._mockSpeechState.paused = false;
    },
    cancel: function () {
      var queue = globalThis._mockSpeechQueue;
      for (var i = 0; i < queue.length; i++) {
        if (queue[i].onerror) queue[i].onerror({ error: 'canceled' });
      }
      globalThis._mockSpeechQueue = [];
      globalThis._mockSpeechState = { speaking: false, paused: false };
    },
    get speaking() { return globalThis._mockSpeechState.speaking; },
    get paused() { return globalThis._mockSpeechState.paused; }
  };

  setupDOM();
  loadApp();
});

beforeEach(() => {
  ReadAloud.reset();
  ConversationManager.clear();
  localStorage.clear();
  globalThis._mockSpeechQueue = [];
  globalThis._mockSpeechState = { speaking: false, paused: false };
});

// ── Support ────────────────────────────────────────────────

describe('ReadAloud', () => {
  describe('isSupported', () => {
    test('returns true when SpeechSynthesisUtterance and speechSynthesis exist', () => {
      expect(ReadAloud.isSupported()).toBe(true);
    });
  });

  describe('getVoices', () => {
    test('returns all voices when no filter', () => {
      var voices = ReadAloud.getVoices();
      expect(voices.length).toBe(4);
    });

    test('filters by language prefix', () => {
      var enVoices = ReadAloud.getVoices('en');
      expect(enVoices.length).toBe(2);
      enVoices.forEach(function (v) {
        expect(v.lang.indexOf('en')).toBe(0);
      });
    });

    test('filters by exact language', () => {
      var frVoices = ReadAloud.getVoices('fr');
      expect(frVoices.length).toBe(1);
      expect(frVoices[0].lang).toBe('fr-FR');
    });

    test('returns empty for non-matching prefix', () => {
      expect(ReadAloud.getVoices('zh').length).toBe(0);
    });
  });

  describe('resolveVoice', () => {
    test('returns preferred voice when set', () => {
      ReadAloud.setVoice('Google UK English');
      var voice = ReadAloud.resolveVoice();
      expect(voice.voiceURI).toBe('Google UK English');
    });

    test('falls back to first en- voice', () => {
      var voice = ReadAloud.resolveVoice();
      expect(voice.lang.indexOf('en')).toBe(0);
    });

    test('falls back to first voice if no en-', () => {
      var origGetVoices = window.speechSynthesis.getVoices;
      window.speechSynthesis.getVoices = function () {
        return [{ voiceURI: 'Chinese', lang: 'zh-CN' }];
      };
      var voice = ReadAloud.resolveVoice();
      expect(voice.voiceURI).toBe('Chinese');
      window.speechSynthesis.getVoices = origGetVoices;
    });
  });

  // ── Preferences ────────────────────────────────────────

  describe('preferences', () => {
    test('default rate is 1.0', () => {
      expect(ReadAloud.getPrefs().rate).toBe(1.0);
    });

    test('default pitch is 1.0', () => {
      expect(ReadAloud.getPrefs().pitch).toBe(1.0);
    });

    test('setRate clamps to valid range', () => {
      ReadAloud.setRate(0.1);
      expect(ReadAloud.getPrefs().rate).toBe(0.5);
      ReadAloud.setRate(5);
      expect(ReadAloud.getPrefs().rate).toBe(3.0);
      ReadAloud.setRate(1.5);
      expect(ReadAloud.getPrefs().rate).toBe(1.5);
    });

    test('setPitch clamps to valid range', () => {
      ReadAloud.setPitch(0.1);
      expect(ReadAloud.getPrefs().pitch).toBe(0.5);
      ReadAloud.setPitch(5);
      expect(ReadAloud.getPrefs().pitch).toBe(2.0);
      ReadAloud.setPitch(1.2);
      expect(ReadAloud.getPrefs().pitch).toBe(1.2);
    });

    test('setRate ignores NaN', () => {
      ReadAloud.setRate(2.0);
      ReadAloud.setRate('abc');
      expect(ReadAloud.getPrefs().rate).toBe(2.0);
    });

    test('setPitch ignores NaN', () => {
      ReadAloud.setPitch(1.5);
      ReadAloud.setPitch('xyz');
      expect(ReadAloud.getPrefs().pitch).toBe(1.5);
    });

    test('persists prefs to localStorage', () => {
      ReadAloud.setVoice('Google Deutsch');
      ReadAloud.setRate(2.0);
      ReadAloud.setPitch(1.3);
      var stored = JSON.parse(localStorage.getItem('agenticchat_readaloud'));
      expect(stored.voiceURI).toBe('Google Deutsch');
      expect(stored.rate).toBe(2.0);
      expect(stored.pitch).toBe(1.3);
    });

    test('loads prefs from localStorage on init', () => {
      ReadAloud.reset();
      localStorage.setItem('agenticchat_readaloud', JSON.stringify({
        voiceURI: 'Google UK English', rate: 1.8, pitch: 0.9
      }));
      ReadAloud.init();
      var p = ReadAloud.getPrefs();
      expect(p.voiceURI).toBe('Google UK English');
      expect(p.rate).toBe(1.8);
      expect(p.pitch).toBe(0.9);
    });

    test('handles corrupt localStorage gracefully', () => {
      localStorage.setItem('agenticchat_readaloud', 'not-json{{');
      ReadAloud.reset();
      ReadAloud.init();
      expect(ReadAloud.getPrefs().rate).toBe(1.0);
    });
  });

  // ── Text Cleaning ─────────────────────────────────────

  describe('cleanTextForSpeech', () => {
    test('removes code blocks', () => {
      var result = ReadAloud.cleanTextForSpeech('Hello ```js\nconsole.log("hi");\n``` world');
      expect(result).toBe('Hello code block omitted world');
    });

    test('removes inline code backticks but keeps text', () => {
      var result = ReadAloud.cleanTextForSpeech('Use `Array.map()` to transform');
      expect(result).toBe('Use Array.map() to transform');
    });

    test('removes bold markdown', () => {
      var result = ReadAloud.cleanTextForSpeech('This is **bold** text');
      expect(result).toBe('This is bold text');
    });

    test('removes italic markdown', () => {
      var result = ReadAloud.cleanTextForSpeech('This is *italic* text');
      expect(result).toBe('This is italic text');
    });

    test('removes underscore emphasis', () => {
      var result = ReadAloud.cleanTextForSpeech('This is __bold__ and _italic_');
      expect(result).toBe('This is bold and italic');
    });

    test('removes markdown headers', () => {
      var result = ReadAloud.cleanTextForSpeech('## Header\nSome text');
      expect(result).toBe('Header Some text');
    });

    test('converts links to text', () => {
      var result = ReadAloud.cleanTextForSpeech('Check [this link](https://example.com) out');
      expect(result).toBe('Check this link out');
    });

    test('collapses whitespace', () => {
      var result = ReadAloud.cleanTextForSpeech('Hello   \n\n  world');
      expect(result).toBe('Hello world');
    });

    test('handles empty input', () => {
      expect(ReadAloud.cleanTextForSpeech('')).toBe('');
      expect(ReadAloud.cleanTextForSpeech(null)).toBe('');
      expect(ReadAloud.cleanTextForSpeech(undefined)).toBe('');
    });

    test('handles text with multiple code blocks', () => {
      var text = 'First ```python\nprint("a")\n``` then ```js\nalert("b")\n``` end';
      var result = ReadAloud.cleanTextForSpeech(text);
      expect(result).toBe('First code block omitted then code block omitted end');
    });
  });

  // ── Speaking ──────────────────────────────────────────

  describe('speak', () => {
    test('speaks text and returns ok', () => {
      var result = ReadAloud.speak('Hello world');
      expect(result.ok).toBe(true);
      expect(globalThis._mockSpeechQueue.length).toBe(1);
    });

    test('cleans markdown before speaking', () => {
      ReadAloud.speak('**Bold** and `code`');
      expect(globalThis._mockSpeechQueue[0].text).toBe('Bold and code');
    });

    test('uses configured rate and pitch', () => {
      ReadAloud.setRate(2.0);
      ReadAloud.setPitch(1.5);
      ReadAloud.speak('Test');
      expect(globalThis._mockSpeechQueue[0].rate).toBe(2.0);
      expect(globalThis._mockSpeechQueue[0].pitch).toBe(1.5);
    });

    test('cancels previous speech before starting new', () => {
      ReadAloud.speak('First');
      ReadAloud.speak('Second');
      // Only 1 in queue (cancel cleared the first)
      expect(globalThis._mockSpeechQueue.length).toBe(1);
      expect(globalThis._mockSpeechQueue[0].text).toBe('Second');
    });

    test('returns error for empty text', () => {
      var result = ReadAloud.speak('');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('No text to speak');
    });

    test('returns error for null text', () => {
      var result = ReadAloud.speak(null);
      expect(result.ok).toBe(false);
    });

    test('speaks code-only text as "code block omitted"', () => {
      var result = ReadAloud.speak('```js\nconsole.log("hi");\n```');
      expect(result.ok).toBe(true);
      expect(globalThis._mockSpeechQueue[0].text).toBe('code block omitted');
    });

    test('sets speaking state', () => {
      expect(ReadAloud.isSpeaking()).toBe(false);
      ReadAloud.speak('Hello');
      expect(ReadAloud.isSpeaking()).toBe(true);
    });

    test('tracks current message index', () => {
      expect(ReadAloud.getCurrentIndex()).toBe(-1);
      ReadAloud.speak('Hello', 3);
      expect(ReadAloud.getCurrentIndex()).toBe(3);
    });

    test('assigns voice to utterance', () => {
      ReadAloud.setVoice('Google UK English');
      ReadAloud.speak('Test');
      expect(globalThis._mockSpeechQueue[0].voice.voiceURI).toBe('Google UK English');
    });
  });

  describe('speakMessage', () => {
    test('speaks message by index from conversation history', () => {
      // clear() auto-adds system prompt at index 0
      ConversationManager.addMessage('user', 'Hi');       // index 1
      ConversationManager.addMessage('assistant', 'Hello there!'); // index 2
      var result = ReadAloud.speakMessage(2);
      expect(result.ok).toBe(true);
      expect(globalThis._mockSpeechQueue[0].text).toBe('Hello there!');
    });

    test('returns error for invalid index', () => {
      expect(ReadAloud.speakMessage(-1).ok).toBe(false);
      expect(ReadAloud.speakMessage(999).ok).toBe(false);
    });
  });

  // ── Pause / Resume / Stop ─────────────────────────────

  describe('pause and resume', () => {
    test('pause returns true when speaking', () => {
      ReadAloud.speak('Test');
      expect(ReadAloud.pause()).toBe(true);
      expect(ReadAloud.isPaused()).toBe(true);
    });

    test('pause returns false when not speaking', () => {
      expect(ReadAloud.pause()).toBe(false);
    });

    test('resume returns true when paused', () => {
      ReadAloud.speak('Test');
      ReadAloud.pause();
      expect(ReadAloud.resume()).toBe(true);
      expect(ReadAloud.isPaused()).toBe(false);
    });

    test('resume returns false when not paused', () => {
      expect(ReadAloud.resume()).toBe(false);
    });

    test('togglePause pauses when speaking', () => {
      ReadAloud.speak('Test');
      ReadAloud.togglePause();
      expect(ReadAloud.isPaused()).toBe(true);
    });

    test('togglePause resumes when paused', () => {
      ReadAloud.speak('Test');
      ReadAloud.pause();
      ReadAloud.togglePause();
      expect(ReadAloud.isPaused()).toBe(false);
    });

    test('togglePause returns false when not speaking', () => {
      expect(ReadAloud.togglePause()).toBe(false);
    });
  });

  describe('stop', () => {
    test('cancels speech and resets state', () => {
      ReadAloud.speak('Test', 5);
      ReadAloud.stop();
      expect(ReadAloud.isSpeaking()).toBe(false);
      expect(ReadAloud.isPaused()).toBe(false);
      expect(ReadAloud.getCurrentIndex()).toBe(-1);
    });

    test('clears speech queue', () => {
      ReadAloud.speak('Test');
      ReadAloud.stop();
      expect(globalThis._mockSpeechQueue.length).toBe(0);
    });
  });

  // ── Utterance callbacks ───────────────────────────────

  describe('utterance callbacks', () => {
    test('onend resets speaking state', () => {
      ReadAloud.speak('Test', 2);
      var utterance = globalThis._mockSpeechQueue[0];
      // Simulate speech ending
      utterance.onend({});
      expect(ReadAloud.isSpeaking()).toBe(false);
      expect(ReadAloud.getCurrentIndex()).toBe(-1);
    });

    test('onerror resets state for non-canceled errors', () => {
      ReadAloud.speak('Test', 2);
      var utterance = globalThis._mockSpeechQueue[0];
      utterance.onerror({ error: 'network' });
      expect(ReadAloud.isSpeaking()).toBe(false);
    });

    test('onerror ignores canceled error', () => {
      ReadAloud.speak('Test', 2);
      var utterance = globalThis._mockSpeechQueue[0];
      // 'canceled' happens when user stops — not a real error
      utterance.onerror({ error: 'canceled' });
      // State should still be speaking (not reset by cancel handler)
      expect(ReadAloud.isSpeaking()).toBe(true);
    });
  });

  // ── Highlighting ──────────────────────────────────────

  describe('highlightMessage', () => {
    function setupHistoryDOM() {
      // clear() already adds system prompt at index 0
      ConversationManager.addMessage('user', 'q');       // index 1
      ConversationManager.addMessage('assistant', 'a');   // index 2
      // Create mock history-messages DOM (only non-system messages)
      var container = document.getElementById('history-messages');
      container.innerHTML = '';
      var msg1 = document.createElement('div');
      msg1.className = 'history-msg user';
      container.appendChild(msg1);
      var msg2 = document.createElement('div');
      msg2.className = 'history-msg assistant';
      container.appendChild(msg2);
    }

    test('adds readaloud-active class to correct message', () => {
      setupHistoryDOM();
      ReadAloud.highlightMessage(2, true); // index 2 = assistant
      var msgs = document.querySelectorAll('.history-msg');
      expect(msgs[1].classList.contains('readaloud-active')).toBe(true);
    });

    test('removes readaloud-active class', () => {
      setupHistoryDOM();
      ReadAloud.highlightMessage(2, true);
      ReadAloud.highlightMessage(2, false);
      var msgs = document.querySelectorAll('.history-msg');
      expect(msgs[1].classList.contains('readaloud-active')).toBe(false);
    });

    test('does nothing with no history-messages container', () => {
      var container = document.getElementById('history-messages');
      container.remove();
      // Should not throw
      ReadAloud.highlightMessage(1, true);
      // Restore
      var panel = document.getElementById('history-panel');
      var newContainer = document.createElement('div');
      newContainer.id = 'history-messages';
      panel.appendChild(newContainer);
    });
  });

  // ── Button rendering ──────────────────────────────────

  describe('renderSpeakButton', () => {
    test('adds speak button to message element', () => {
      var el = document.createElement('div');
      var role = document.createElement('div');
      role.className = 'msg-role';
      el.appendChild(role);
      ReadAloud.renderSpeakButton(el, 2);
      var btn = el.querySelector('.readaloud-btn');
      expect(btn).not.toBeNull();
      expect(btn.getAttribute('aria-label')).toBe('Read aloud');
    });

    test('shows pause/stop buttons when speaking this message', () => {
      ReadAloud.speak('Test', 2);
      var el = document.createElement('div');
      var role = document.createElement('div');
      role.className = 'msg-role';
      el.appendChild(role);
      ReadAloud.renderSpeakButton(el, 2);
      var btns = el.querySelectorAll('.readaloud-btn');
      expect(btns.length).toBe(2); // pause + stop
    });

    test('replaces existing button on re-render', () => {
      var el = document.createElement('div');
      var role = document.createElement('div');
      role.className = 'msg-role';
      el.appendChild(role);
      ReadAloud.renderSpeakButton(el, 2);
      ReadAloud.renderSpeakButton(el, 2);
      var btns = el.querySelectorAll('.readaloud-btn');
      expect(btns.length).toBe(1);
    });

    test('works without msg-role element', () => {
      var el = document.createElement('div');
      ReadAloud.renderSpeakButton(el, 2);
      var btn = el.querySelector('.readaloud-btn');
      expect(btn).not.toBeNull();
    });
  });

  // ── decorateMessages ──────────────────────────────────

  describe('decorateMessages', () => {
    test('adds buttons only to assistant messages', () => {
      // clear() already added system at index 0
      ConversationManager.addMessage('user', 'q');        // index 1
      ConversationManager.addMessage('assistant', 'a');    // index 2
      ConversationManager.addMessage('user', 'q2');       // index 3
      ConversationManager.addMessage('assistant', 'a2');   // index 4
      var container = document.getElementById('history-messages');
      container.innerHTML = '';
      var roles = ['user', 'assistant', 'user', 'assistant'];
      roles.forEach(function (r) {
        var d = document.createElement('div');
        d.className = 'history-msg ' + r;
        var role = document.createElement('div');
        role.className = 'msg-role';
        d.appendChild(role);
        container.appendChild(d);
      });
      ReadAloud.decorateMessages();
      var userMsgs = container.querySelectorAll('.history-msg.user');
      var assistMsgs = container.querySelectorAll('.history-msg.assistant');
      userMsgs.forEach(function (m) {
        expect(m.querySelector('.readaloud-btn')).toBeNull();
      });
      assistMsgs.forEach(function (m) {
        expect(m.querySelector('.readaloud-btn')).not.toBeNull();
      });
    });

    test('handles empty history gracefully', () => {
      ReadAloud.decorateMessages();
      // Should not throw
    });
  });

  // ── _getState ─────────────────────────────────────────

  describe('_getState', () => {
    test('returns current state', () => {
      var state = ReadAloud._getState();
      expect(state.speaking).toBe(false);
      expect(state.paused).toBe(false);
      expect(state.currentMsgIndex).toBe(-1);
      expect(state.prefs.rate).toBe(1.0);
    });

    test('reflects speaking state', () => {
      ReadAloud.speak('Hello', 3);
      var state = ReadAloud._getState();
      expect(state.speaking).toBe(true);
      expect(state.currentMsgIndex).toBe(3);
    });
  });

  // ── reset ─────────────────────────────────────────────

  describe('reset', () => {
    test('stops speech and clears prefs', () => {
      ReadAloud.setRate(2.5);
      ReadAloud.setVoice('Google Deutsch');
      ReadAloud.speak('Test', 1);
      ReadAloud.reset();
      expect(ReadAloud.isSpeaking()).toBe(false);
      expect(ReadAloud.getPrefs().rate).toBe(1.0);
      expect(ReadAloud.getPrefs().voiceURI).toBe('');
      expect(localStorage.getItem('agenticchat_readaloud')).toBeNull();
    });
  });

  // ── Controls panel ────────────────────────────────────

  describe('buildControls', () => {
    test('creates controls panel', () => {
      ReadAloud.buildControls();
      var panel = document.getElementById('readaloud-controls');
      expect(panel).not.toBeNull();
      expect(panel.style.display).toBe('none');
    });

    test('does not duplicate controls', () => {
      ReadAloud.buildControls();
      ReadAloud.buildControls();
      var panels = document.querySelectorAll('#readaloud-controls');
      expect(panels.length).toBe(1);
    });

    test('panel has pause and stop buttons', () => {
      ReadAloud.buildControls();
      var panel = document.getElementById('readaloud-controls');
      expect(panel.querySelector('.readaloud-ctrl-pause')).not.toBeNull();
      expect(panel.querySelector('.readaloud-ctrl-stop')).not.toBeNull();
    });

    test('panel has speed slider', () => {
      ReadAloud.buildControls();
      var panel = document.getElementById('readaloud-controls');
      var slider = panel.querySelector('.readaloud-speed');
      expect(slider).not.toBeNull();
      expect(slider.type).toBe('range');
    });
  });

  describe('updateControls', () => {
    test('hides controls when not speaking', () => {
      ReadAloud.buildControls();
      ReadAloud.updateControls();
      var panel = document.getElementById('readaloud-controls');
      expect(panel.style.display).toBe('none');
    });

    test('shows controls when speaking', () => {
      ReadAloud.buildControls();
      ReadAloud.speak('Hello');
      var panel = document.getElementById('readaloud-controls');
      expect(panel.style.display).toBe('');
    });

    test('shows paused state', () => {
      ReadAloud.buildControls();
      ReadAloud.speak('Hello');
      ReadAloud.pause();
      var state = document.querySelector('.readaloud-state');
      expect(state.textContent).toBe('Paused');
    });

    test('shows speaking state', () => {
      ReadAloud.buildControls();
      ReadAloud.speak('Hello');
      var state = document.querySelector('.readaloud-state');
      expect(state.textContent).toBe('Speaking\u2026');
    });
  });
});
