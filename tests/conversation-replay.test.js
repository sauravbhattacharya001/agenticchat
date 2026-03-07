/**
 * Tests for ConversationReplay module.
 *
 * Verifies: start, play/pause/stop, next/prev, speed cycling,
 * state reporting, edge cases (empty, single message), typing
 * indicator, message visibility, keyboard escape.
 */
const { setupDOM, loadApp } = require('./setup');

beforeAll(() => { setupDOM(); loadApp(); });

beforeEach(() => {
  jest.useFakeTimers();
  // Clear any existing conversation
  ConversationManager.clear();
  // Reset DOM output
  const output = document.getElementById('chat-output');
  if (output) output.innerHTML = '';
});

afterEach(() => {
  jest.useRealTimers();
  if (ConversationReplay.isActive()) ConversationReplay.stop();
});

function addMessages(roles) {
  roles.forEach(role => {
    var content = role + ' message ' + Math.random().toString(36).slice(2, 6);
    ConversationManager.addMessage(role, content);
  });
  // Render DOM elements in chat-output so replay can hide/show them
  var output = document.getElementById('chat-output');
  if (output) {
    output.innerHTML = '';
    var msgs = ConversationManager.getMessages().filter(m => m.role !== 'system');
    msgs.forEach(m => {
      var div = document.createElement('div');
      div.className = 'message ' + m.role;
      div.textContent = m.content;
      output.appendChild(div);
    });
  }
}

function chatOutputChildren() {
  const el = document.getElementById('chat-output');
  return el ? Array.from(el.children) : [];
}

describe('ConversationReplay', () => {
  describe('module structure', () => {
    test('exports required API methods', () => {
      expect(typeof ConversationReplay.start).toBe('function');
      expect(typeof ConversationReplay.play).toBe('function');
      expect(typeof ConversationReplay.pause).toBe('function');
      expect(typeof ConversationReplay.stop).toBe('function');
      expect(typeof ConversationReplay.next).toBe('function');
      expect(typeof ConversationReplay.prev).toBe('function');
      expect(typeof ConversationReplay.cycleSpeed).toBe('function');
      expect(typeof ConversationReplay.isActive).toBe('function');
      expect(typeof ConversationReplay.getState).toBe('function');
    });
  });

  describe('initial state', () => {
    test('isActive returns false when not started', () => {
      expect(ConversationReplay.isActive()).toBe(false);
    });

    test('getState returns stopped state', () => {
      const s = ConversationReplay.getState();
      expect(s.state).toBe('stopped');
      expect(s.speed).toBe(1);
    });
  });

  describe('empty conversation', () => {
    test('start with no messages does nothing', () => {
      ConversationReplay.start();
      expect(ConversationReplay.isActive()).toBe(false);
    });

    test('start with only system messages does nothing', () => {
      ConversationManager.addMessage('system', 'You are a helpful assistant.');
      if (UIController.renderMessages) UIController.renderMessages();
      ConversationReplay.start();
      expect(ConversationReplay.isActive()).toBe(false);
    });
  });

  describe('start and play', () => {
    test('start begins replay and shows first message', () => {
      addMessages(['user', 'assistant', 'user', 'assistant']);
      ConversationReplay.start();
      expect(ConversationReplay.isActive()).toBe(true);
      const s = ConversationReplay.getState();
      expect(s.state).toBe('playing');
      expect(s.currentIndex).toBe(0);
      expect(s.totalMessages).toBe(4);
    });

    test('replay bar appears in DOM', () => {
      addMessages(['user', 'assistant']);
      ConversationReplay.start();
      const bar = document.querySelector('.replay-bar');
      expect(bar).not.toBeNull();
      expect(bar.getAttribute('role')).toBe('toolbar');
    });

    test('first message is visible, rest are hidden', () => {
      addMessages(['user', 'assistant', 'user']);
      ConversationReplay.start();
      const children = chatOutputChildren();
      // Filter out typing indicator
      const msgEls = children.filter(c => !c.classList.contains('replay-typing-container'));
      expect(msgEls.length).toBeGreaterThanOrEqual(3);
      expect(msgEls[0].classList.contains('replay-hidden')).toBe(false);
      expect(msgEls[1].classList.contains('replay-hidden')).toBe(true);
      expect(msgEls[2].classList.contains('replay-hidden')).toBe(true);
    });
  });

  describe('playback progression', () => {
    test('advances to next message after delay', () => {
      addMessages(['user', 'assistant']);
      ConversationReplay.start();
      // Default: assistant delay = 3000ms at 1x
      jest.advanceTimersByTime(3100);
      const s = ConversationReplay.getState();
      expect(s.currentIndex).toBe(1);
    });

    test('pauses at end of conversation', () => {
      addMessages(['user', 'assistant']);
      ConversationReplay.start();
      jest.advanceTimersByTime(3100);
      // Should be at end now, auto-paused
      const s = ConversationReplay.getState();
      expect(s.currentIndex).toBe(1);
      expect(s.state).toBe('paused');
    });

    test('typing indicator appears during delay', () => {
      addMessages(['user', 'assistant']);
      ConversationReplay.start();
      // Typing indicator should be visible during play
      jest.advanceTimersByTime(500);
      const indicator = document.querySelector('.replay-typing-container');
      expect(indicator).not.toBeNull();
    });

    test('typing indicator removed after message reveals', () => {
      addMessages(['user', 'assistant']);
      ConversationReplay.start();
      jest.advanceTimersByTime(3100);
      const indicator = document.querySelector('.replay-typing-container');
      expect(indicator).toBeNull();
    });
  });

  describe('pause and resume', () => {
    test('pause stops progression', () => {
      addMessages(['user', 'assistant', 'user', 'assistant']);
      ConversationReplay.start();
      ConversationReplay.pause();
      const idx = ConversationReplay.getState().currentIndex;
      jest.advanceTimersByTime(10000);
      expect(ConversationReplay.getState().currentIndex).toBe(idx);
      expect(ConversationReplay.getState().state).toBe('paused');
    });

    test('play resumes from paused position', () => {
      addMessages(['user', 'assistant', 'user', 'assistant']);
      ConversationReplay.start();
      jest.advanceTimersByTime(3100); // advance to message 1
      ConversationReplay.pause();
      const before = ConversationReplay.getState().currentIndex;
      ConversationReplay.play();
      expect(ConversationReplay.getState().state).toBe('playing');
      jest.advanceTimersByTime(2100); // user delay ~2000ms
      expect(ConversationReplay.getState().currentIndex).toBeGreaterThan(before);
    });

    test('pause removes typing indicator', () => {
      addMessages(['user', 'assistant']);
      ConversationReplay.start();
      jest.advanceTimersByTime(500);
      ConversationReplay.pause();
      expect(document.querySelector('.replay-typing-container')).toBeNull();
    });
  });

  describe('stop', () => {
    test('stop restores all messages', () => {
      addMessages(['user', 'assistant', 'user']);
      ConversationReplay.start();
      ConversationReplay.stop();
      expect(ConversationReplay.isActive()).toBe(false);
      const children = chatOutputChildren();
      const hidden = children.filter(c => c.classList.contains('replay-hidden'));
      expect(hidden.length).toBe(0);
    });

    test('stop removes replay bar', () => {
      addMessages(['user', 'assistant']);
      ConversationReplay.start();
      ConversationReplay.stop();
      expect(document.querySelector('.replay-bar')).toBeNull();
    });

    test('stop when already stopped is no-op', () => {
      ConversationReplay.stop();
      expect(ConversationReplay.isActive()).toBe(false);
    });
  });

  describe('next / prev', () => {
    test('next advances one message when paused', () => {
      addMessages(['user', 'assistant', 'user']);
      ConversationReplay.start();
      ConversationReplay.pause();
      const before = ConversationReplay.getState().currentIndex;
      ConversationReplay.next();
      expect(ConversationReplay.getState().currentIndex).toBe(before + 1);
    });

    test('prev goes back one message when paused', () => {
      addMessages(['user', 'assistant', 'user']);
      ConversationReplay.start();
      ConversationReplay.pause();
      ConversationReplay.next();
      ConversationReplay.next();
      ConversationReplay.prev();
      expect(ConversationReplay.getState().currentIndex).toBe(1);
    });

    test('next does nothing at end', () => {
      addMessages(['user', 'assistant']);
      ConversationReplay.start();
      ConversationReplay.pause();
      ConversationReplay.next(); // now at 1 (last)
      ConversationReplay.next(); // should stay at 1
      expect(ConversationReplay.getState().currentIndex).toBe(1);
    });

    test('prev does nothing at start', () => {
      addMessages(['user', 'assistant']);
      ConversationReplay.start();
      ConversationReplay.pause();
      ConversationReplay.prev(); // already at 0
      expect(ConversationReplay.getState().currentIndex).toBe(0);
    });

    test('next/prev ignored while playing', () => {
      addMessages(['user', 'assistant', 'user']);
      ConversationReplay.start();
      const idx = ConversationReplay.getState().currentIndex;
      ConversationReplay.next();
      expect(ConversationReplay.getState().currentIndex).toBe(idx);
      ConversationReplay.prev();
      expect(ConversationReplay.getState().currentIndex).toBe(idx);
    });
  });

  describe('speed control', () => {
    test('default speed is 1x', () => {
      expect(ConversationReplay.getState().speed).toBe(1);
    });

    test('cycleSpeed cycles through speeds', () => {
      ConversationReplay.cycleSpeed(); // 1 -> 2
      expect(ConversationReplay.getState().speed).toBe(2);
      ConversationReplay.cycleSpeed(); // 2 -> 4
      expect(ConversationReplay.getState().speed).toBe(4);
      ConversationReplay.cycleSpeed(); // 4 -> 0.5
      expect(ConversationReplay.getState().speed).toBe(0.5);
      ConversationReplay.cycleSpeed(); // 0.5 -> 1
      expect(ConversationReplay.getState().speed).toBe(1);
    });

    test('higher speed means faster progression', () => {
      addMessages(['user', 'assistant', 'user', 'assistant']);
      ConversationReplay.start();
      ConversationReplay.pause();
      ConversationReplay.cycleSpeed(); // 2x
      ConversationReplay.cycleSpeed(); // 4x
      ConversationReplay.play();
      // At 4x, assistant delay = 3000/4 = 750ms
      jest.advanceTimersByTime(800);
      expect(ConversationReplay.getState().currentIndex).toBeGreaterThanOrEqual(1);
    });
  });

  describe('keyboard', () => {
    test('Escape stops active replay', () => {
      addMessages(['user', 'assistant']);
      ConversationReplay.start();
      expect(ConversationReplay.isActive()).toBe(true);
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      document.dispatchEvent(event);
      expect(ConversationReplay.isActive()).toBe(false);
    });

    test('Escape does nothing when replay not active', () => {
      // Should not throw
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      document.dispatchEvent(event);
      expect(ConversationReplay.isActive()).toBe(false);
    });
  });

  describe('single message', () => {
    test('replay with one message shows it and pauses', () => {
      addMessages(['user']);
      ConversationReplay.start();
      // Should show single message and auto-pause (no next to schedule)
      const s = ConversationReplay.getState();
      expect(s.currentIndex).toBe(0);
      expect(s.totalMessages).toBe(1);
      // Let timer try to advance
      jest.advanceTimersByTime(5000);
      expect(ConversationReplay.getState().state).toBe('paused');
    });
  });

  describe('getState', () => {
    test('returns accurate state during playback', () => {
      addMessages(['user', 'assistant', 'user']);
      ConversationReplay.start();
      jest.advanceTimersByTime(3100);
      const s = ConversationReplay.getState();
      expect(s.state).toBe('playing');
      expect(s.currentIndex).toBe(1);
      expect(s.totalMessages).toBe(3);
      expect(typeof s.speed).toBe('number');
    });
  });
});
