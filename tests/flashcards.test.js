/**
 * @jest-environment jsdom
 */
const { setupDOM, loadApp } = require('./setup');

beforeAll(() => { setupDOM(); loadApp(); });
beforeEach(() => {
  localStorage.clear();
});

describe('ConversationFlashcards', () => {
  describe('API surface', () => {
    test('exposes expected public methods', () => {
      expect(typeof ConversationFlashcards.init).toBe('function');
      expect(typeof ConversationFlashcards.open).toBe('function');
      expect(typeof ConversationFlashcards.close).toBe('function');
      expect(typeof ConversationFlashcards.toggle).toBe('function');
      expect(typeof ConversationFlashcards.extractFromConversation).toBe('function');
      expect(typeof ConversationFlashcards.getDecks).toBe('function');
      expect(typeof ConversationFlashcards.getCurrentDeck).toBe('function');
      expect(typeof ConversationFlashcards.getCardCount).toBe('function');
    });
  });

  describe('extractFromConversation()', () => {
    test('returns empty array when no messages', () => {
      const cards = ConversationFlashcards.extractFromConversation();
      expect(Array.isArray(cards)).toBe(true);
      expect(cards.length).toBe(0);
    });

    test('extracts Q&A pairs from conversation', () => {
      // Seed conversation with a question and answer
      ConversationManager.addMessage('user', 'What is JavaScript?');
      ConversationManager.addMessage('assistant', 'JavaScript is a programming language.');
      const cards = ConversationFlashcards.extractFromConversation();
      expect(cards.length).toBe(1);
      expect(cards[0].front).toBe('What is JavaScript?');
      expect(cards[0].back).toBe('JavaScript is a programming language.');
    });

    test('skips non-question user messages', () => {
      ConversationManager.addMessage('user', 'Hello there');
      ConversationManager.addMessage('assistant', 'Hi!');
      const cards = ConversationFlashcards.extractFromConversation();
      expect(cards.length).toBe(0);
    });

    test('detects question-word patterns', () => {
      ConversationManager.addMessage('user', 'How does React work');
      ConversationManager.addMessage('assistant', 'React uses a virtual DOM.');
      // No '?' but starts with 'How'
      const cards = ConversationFlashcards.extractFromConversation();
      expect(cards.length).toBe(1);
    });
  });

  describe('deck persistence', () => {
    test('loadDecks returns empty array by default', () => {
      const decks = ConversationFlashcards._loadDecks();
      expect(Array.isArray(decks)).toBe(true);
      expect(decks.length).toBe(0);
    });

    test('saveDecks and loadDecks roundtrip', () => {
      const deck = [{ name: 'Test', cards: [{ front: 'Q', back: 'A' }], created: Date.now(), count: 1 }];
      ConversationFlashcards._saveDecks(deck);
      const loaded = ConversationFlashcards._loadDecks();
      expect(loaded.length).toBe(1);
      expect(loaded[0].name).toBe('Test');
    });
  });

  describe('panel UI', () => {
    test('open creates and shows panel', () => {
      ConversationFlashcards.open();
      const panel = document.getElementById('flashcard-panel');
      expect(panel).not.toBeNull();
      expect(panel.style.display).toBe('flex');
      ConversationFlashcards.close();
    });

    test('close hides panel', () => {
      ConversationFlashcards.open();
      ConversationFlashcards.close();
      const panel = document.getElementById('flashcard-panel');
      expect(panel.style.display).toBe('none');
    });

    test('toggle switches visibility', () => {
      ConversationFlashcards.toggle();
      expect(document.getElementById('flashcard-panel').style.display).toBe('flex');
      ConversationFlashcards.toggle();
      expect(document.getElementById('flashcard-panel').style.display).toBe('none');
    });
  });
});
