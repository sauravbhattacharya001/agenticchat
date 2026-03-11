/**
 * @jest-environment jsdom
 */
const { setupDOM, loadApp } = require('./setup');

beforeAll(() => { setupDOM(); loadApp(); });
beforeEach(() => {
  localStorage.clear();
  MessageReactions.reset();
});

describe('MessageReactions', () => {
  describe('API surface', () => {
    test('exposes expected public methods', () => {
      expect(typeof MessageReactions.init).toBe('function');
      expect(typeof MessageReactions.addReaction).toBe('function');
      expect(typeof MessageReactions.removeReaction).toBe('function');
      expect(typeof MessageReactions.toggleReaction).toBe('function');
      expect(typeof MessageReactions.getReactions).toBe('function');
      expect(typeof MessageReactions.getReactionCount).toBe('function');
      expect(typeof MessageReactions.getReactedMessages).toBe('function');
      expect(typeof MessageReactions.clearReactions).toBe('function');
      expect(typeof MessageReactions.clearAll).toBe('function');
      expect(typeof MessageReactions.getMostUsedEmoji).toBe('function');
      expect(typeof MessageReactions.getAvailableEmojis).toBe('function');
      expect(typeof MessageReactions.reset).toBe('function');
      expect(typeof MessageReactions._getState).toBe('function');
    });

    test('getAvailableEmojis returns non-empty array', () => {
      const emojis = MessageReactions.getAvailableEmojis();
      expect(Array.isArray(emojis)).toBe(true);
      expect(emojis.length).toBeGreaterThan(0);
    });

    test('getAvailableEmojis returns a copy', () => {
      const a = MessageReactions.getAvailableEmojis();
      const b = MessageReactions.getAvailableEmojis();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });

  describe('addReaction', () => {
    test('adds reaction to message index', () => {
      expect(MessageReactions.addReaction(0, '👍')).toBe(true);
      expect(MessageReactions.getReactions(0)).toEqual({ '👍': 1 });
    });

    test('increments count on repeated add', () => {
      MessageReactions.addReaction(0, '👍');
      MessageReactions.addReaction(0, '👍');
      expect(MessageReactions.getReactions(0)['👍']).toBe(2);
    });

    test('rejects invalid emoji', () => {
      expect(MessageReactions.addReaction(0, '🦄')).toBe(false);
      expect(MessageReactions.getReactions(0)).toEqual({});
    });

    test('rejects negative message index', () => {
      expect(MessageReactions.addReaction(-1, '👍')).toBe(false);
    });

    test('rejects non-number message index', () => {
      expect(MessageReactions.addReaction('abc', '👍')).toBe(false);
    });

    test('allows multiple different emojis on same message', () => {
      MessageReactions.addReaction(0, '👍');
      MessageReactions.addReaction(0, '❤️');
      const r = MessageReactions.getReactions(0);
      expect(r['👍']).toBe(1);
      expect(r['❤️']).toBe(1);
    });

    test('caps at MAX_REACTIONS_PER_MESSAGE', () => {
      for (let i = 0; i < 50; i++) {
        MessageReactions.addReaction(0, '👍');
      }
      expect(MessageReactions.addReaction(0, '👍')).toBe(false);
      expect(MessageReactions.getReactions(0)['👍']).toBe(50);
    });

    test('allows reactions on different messages', () => {
      MessageReactions.addReaction(0, '👍');
      MessageReactions.addReaction(5, '❤️');
      expect(MessageReactions.getReactions(0)['👍']).toBe(1);
      expect(MessageReactions.getReactions(5)['❤️']).toBe(1);
    });
  });

  describe('removeReaction', () => {
    test('decrements and removes at zero', () => {
      MessageReactions.addReaction(0, '👍');
      expect(MessageReactions.removeReaction(0, '👍')).toBe(true);
      expect(MessageReactions.getReactions(0)).toEqual({});
    });

    test('decrements count but keeps if > 1', () => {
      MessageReactions.addReaction(0, '👍');
      MessageReactions.addReaction(0, '👍');
      MessageReactions.removeReaction(0, '👍');
      expect(MessageReactions.getReactions(0)['👍']).toBe(1);
    });

    test('returns false for non-existent reaction', () => {
      expect(MessageReactions.removeReaction(0, '👍')).toBe(false);
    });

    test('returns false for non-existent message', () => {
      expect(MessageReactions.removeReaction(99, '👍')).toBe(false);
    });

    test('cleans up message entry when last reaction removed', () => {
      MessageReactions.addReaction(0, '👍');
      MessageReactions.removeReaction(0, '👍');
      expect(MessageReactions.getReactedMessages()).not.toContain(0);
    });
  });

  describe('toggleReaction', () => {
    test('adds if not present', () => {
      expect(MessageReactions.toggleReaction(0, '👍')).toBe(true);
      expect(MessageReactions.getReactions(0)['👍']).toBe(1);
    });

    test('removes if already present', () => {
      MessageReactions.addReaction(0, '👍');
      expect(MessageReactions.toggleReaction(0, '👍')).toBe(true);
      expect(MessageReactions.getReactions(0)).toEqual({});
    });

    test('rejects invalid emoji', () => {
      expect(MessageReactions.toggleReaction(0, '🦄')).toBe(false);
    });

    test('rejects negative index', () => {
      expect(MessageReactions.toggleReaction(-1, '👍')).toBe(false);
    });

    test('rejects non-number index', () => {
      expect(MessageReactions.toggleReaction(undefined, '👍')).toBe(false);
    });
  });

  describe('getReactions', () => {
    test('returns empty object for unreacted message', () => {
      expect(MessageReactions.getReactions(42)).toEqual({});
    });

    test('returns a copy not a reference', () => {
      MessageReactions.addReaction(0, '👍');
      const a = MessageReactions.getReactions(0);
      a['👍'] = 999;
      expect(MessageReactions.getReactions(0)['👍']).toBe(1);
    });
  });

  describe('getReactionCount', () => {
    test('returns 0 for unreacted message', () => {
      expect(MessageReactions.getReactionCount(42)).toBe(0);
    });

    test('sums all emoji counts', () => {
      MessageReactions.addReaction(0, '👍');
      MessageReactions.addReaction(0, '👍');
      MessageReactions.addReaction(0, '❤️');
      expect(MessageReactions.getReactionCount(0)).toBe(3);
    });
  });

  describe('getReactedMessages', () => {
    test('returns empty array when no reactions', () => {
      expect(MessageReactions.getReactedMessages()).toEqual([]);
    });

    test('returns sorted message indices', () => {
      MessageReactions.addReaction(5, '👍');
      MessageReactions.addReaction(2, '❤️');
      MessageReactions.addReaction(8, '😂');
      expect(MessageReactions.getReactedMessages()).toEqual([2, 5, 8]);
    });
  });

  describe('clearReactions', () => {
    test('removes all reactions for a message and returns count', () => {
      MessageReactions.addReaction(0, '👍');
      MessageReactions.addReaction(0, '❤️');
      MessageReactions.addReaction(0, '😂');
      expect(MessageReactions.clearReactions(0)).toBe(3);
      expect(MessageReactions.getReactions(0)).toEqual({});
    });

    test('returns 0 for unreacted message', () => {
      expect(MessageReactions.clearReactions(99)).toBe(0);
    });

    test('does not affect other messages', () => {
      MessageReactions.addReaction(0, '👍');
      MessageReactions.addReaction(1, '❤️');
      MessageReactions.clearReactions(0);
      expect(MessageReactions.getReactions(1)['❤️']).toBe(1);
    });
  });

  describe('clearAll', () => {
    test('removes all reactions and returns message count', () => {
      MessageReactions.addReaction(0, '👍');
      MessageReactions.addReaction(1, '❤️');
      MessageReactions.addReaction(2, '😂');
      expect(MessageReactions.clearAll()).toBe(3);
      expect(MessageReactions.getReactedMessages()).toEqual([]);
    });

    test('returns 0 when already empty', () => {
      expect(MessageReactions.clearAll()).toBe(0);
    });
  });

  describe('getMostUsedEmoji', () => {
    test('returns null when no reactions', () => {
      expect(MessageReactions.getMostUsedEmoji()).toBeNull();
    });

    test('returns the most-used emoji across all messages', () => {
      MessageReactions.addReaction(0, '👍');
      MessageReactions.addReaction(1, '👍');
      MessageReactions.addReaction(2, '❤️');
      expect(MessageReactions.getMostUsedEmoji()).toBe('👍');
    });

    test('returns single emoji when only one used', () => {
      MessageReactions.addReaction(0, '💡');
      expect(MessageReactions.getMostUsedEmoji()).toBe('💡');
    });
  });

  describe('_getState', () => {
    test('returns reactions and available emojis', () => {
      MessageReactions.addReaction(0, '👍');
      const state = MessageReactions._getState();
      expect(state.reactions).toEqual({ 0: { '👍': 1 } });
      expect(state.availableEmojis.length).toBeGreaterThan(0);
    });

    test('returns deep copy of reactions', () => {
      MessageReactions.addReaction(0, '👍');
      const state = MessageReactions._getState();
      state.reactions[0]['👍'] = 999;
      expect(MessageReactions.getReactions(0)['👍']).toBe(1);
    });
  });

  describe('reset', () => {
    test('clears all state', () => {
      MessageReactions.addReaction(0, '👍');
      MessageReactions.addReaction(1, '❤️');
      MessageReactions.reset();
      expect(MessageReactions.getReactedMessages()).toEqual([]);
    });

    test('clears localStorage entry', () => {
      MessageReactions.addReaction(0, '👍');
      MessageReactions.reset();
      expect(localStorage.getItem('agenticchat_reactions')).toBeNull();
    });
  });

  describe('persistence', () => {
    test('reactions survive init reload', () => {
      MessageReactions.addReaction(0, '👍');
      MessageReactions.addReaction(0, '❤️');
      MessageReactions.addReaction(3, '🤔');
      // Re-init (simulates reload)
      MessageReactions.init();
      expect(MessageReactions.getReactions(0)['👍']).toBe(1);
      expect(MessageReactions.getReactions(0)['❤️']).toBe(1);
      expect(MessageReactions.getReactions(3)['🤔']).toBe(1);
    });

    test('corrupted localStorage handled gracefully', () => {
      localStorage.setItem('agenticchat_reactions', 'not-json!!!');
      MessageReactions.init();
      expect(MessageReactions.getReactedMessages()).toEqual([]);
    });

    test('non-object localStorage handled gracefully', () => {
      localStorage.setItem('agenticchat_reactions', '"just a string"');
      MessageReactions.init();
      expect(MessageReactions.getReactedMessages()).toEqual([]);
    });

    test('array in localStorage handled gracefully', () => {
      localStorage.setItem('agenticchat_reactions', '[1,2,3]');
      MessageReactions.init();
      expect(MessageReactions.getReactedMessages()).toEqual([]);
    });
  });

  describe('all available emojis', () => {
    test('each available emoji can be added', () => {
      const emojis = MessageReactions.getAvailableEmojis();
      emojis.forEach((emoji, idx) => {
        expect(MessageReactions.addReaction(idx, emoji)).toBe(true);
      });
      expect(MessageReactions.getReactedMessages().length).toBe(emojis.length);
    });
  });

  describe('edge cases', () => {
    test('high message index works', () => {
      expect(MessageReactions.addReaction(100000, '👍')).toBe(true);
      expect(MessageReactions.getReactions(100000)['👍']).toBe(1);
    });

    test('zero index works', () => {
      expect(MessageReactions.addReaction(0, '👍')).toBe(true);
      expect(MessageReactions.getReactionCount(0)).toBe(1);
    });

    test('clearAll after clearReactions is safe', () => {
      MessageReactions.addReaction(0, '👍');
      MessageReactions.clearReactions(0);
      expect(MessageReactions.clearAll()).toBe(0);
    });

    test('toggle twice returns to original state', () => {
      MessageReactions.toggleReaction(0, '👍');
      MessageReactions.toggleReaction(0, '👍');
      expect(MessageReactions.getReactions(0)).toEqual({});
    });

    test('remove after toggle-off is false', () => {
      MessageReactions.toggleReaction(0, '👍');
      MessageReactions.toggleReaction(0, '👍');
      expect(MessageReactions.removeReaction(0, '👍')).toBe(false);
    });
  });
});
