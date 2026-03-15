/**
 * @jest-environment jsdom
 */
const { setup, safeLs } = require('./setup');

describe('SessionManager — Session Pinning', () => {
  beforeEach(() => setup());

  test('isPinned returns false for unpinned session', () => {
    expect(SessionManager.isPinned('abc123')).toBe(false);
  });

  test('togglePin pins a session and returns true', () => {
    const result = SessionManager.togglePin('abc123');
    expect(result).toBe(true);
    expect(SessionManager.isPinned('abc123')).toBe(true);
  });

  test('togglePin unpins a pinned session and returns false', () => {
    SessionManager.togglePin('abc123'); // pin
    const result = SessionManager.togglePin('abc123'); // unpin
    expect(result).toBe(false);
    expect(SessionManager.isPinned('abc123')).toBe(false);
  });

  test('pinned sessions persist in localStorage', () => {
    SessionManager.togglePin('session1');
    const raw = safeLs.getItem('agenticchat_pinned_sessions');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw);
    expect(parsed).toContain('session1');
  });

  test('pinned sessions sort first in getAll', () => {
    // Create two sessions
    ConversationManager.addMessage('user', 'First message');
    const s1 = SessionManager.save('Session A');
    SessionManager.newSession();
    ConversationManager.addMessage('user', 'Second message');
    const s2 = SessionManager.save('Session B');

    // Session B is newest, should be first without pinning
    let all = SessionManager.getAll();
    expect(all[0].id).toBe(s2.id);

    // Pin Session A — it should now be first
    SessionManager.togglePin(s1.id);
    all = SessionManager.getAll();
    expect(all[0].id).toBe(s1.id);
  });

  test('removing a session cleans up pinned state', () => {
    ConversationManager.addMessage('user', 'Test');
    const s = SessionManager.save('Pinned Session');
    SessionManager.togglePin(s.id);
    expect(SessionManager.isPinned(s.id)).toBe(true);

    SessionManager.remove(s.id);
    expect(SessionManager.isPinned(s.id)).toBe(false);
  });
});
