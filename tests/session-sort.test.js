/**
 * Session Sort & Search — Unit Tests
 */

const { setupDOM, loadApp } = require('./setup');

beforeEach(() => {
  setupDOM();
  loadApp();
});

describe('SessionManager sort and search', () => {
  function createSessions() {
    // Create sessions with different names, times, and message counts
    const base = Date.now();
    const sessions = [
      { id: 'a', name: 'Alpha chat', messages: [{ role: 'user', content: 'hi' }], messageCount: 1, preview: 'hi', createdAt: new Date(base - 3000).toISOString(), updatedAt: new Date(base - 3000).toISOString() },
      { id: 'b', name: 'Beta discussion', messages: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hey' }, { role: 'user', content: 'more' }], messageCount: 3, preview: 'hello', createdAt: new Date(base - 2000).toISOString(), updatedAt: new Date(base - 2000).toISOString() },
      { id: 'c', name: 'Charlie session', messages: [{ role: 'user', content: 'test' }, { role: 'assistant', content: 'ok' }], messageCount: 2, preview: 'test', createdAt: new Date(base - 1000).toISOString(), updatedAt: new Date(base - 1000).toISOString() },
    ];
    localStorage.setItem('agenticchat_sessions', JSON.stringify(sessions));
    SessionManager.invalidateCache();
  }

  test('default sort is newest first', () => {
    createSessions();
    localStorage.removeItem('agenticchat_session_sort');
    SessionManager.invalidateCache();
    const all = SessionManager.getAll();
    expect(all[0].id).toBe('c');
    expect(all[2].id).toBe('a');
  });

  test('sort by oldest', () => {
    createSessions();
    localStorage.setItem('agenticchat_session_sort', 'oldest');
    SessionManager.invalidateCache();
    const all = SessionManager.getAll();
    expect(all[0].id).toBe('a');
    expect(all[2].id).toBe('c');
  });

  test('sort by name A-Z', () => {
    createSessions();
    localStorage.setItem('agenticchat_session_sort', 'name-az');
    SessionManager.invalidateCache();
    const all = SessionManager.getAll();
    expect(all[0].name).toBe('Alpha chat');
    expect(all[1].name).toBe('Beta discussion');
    expect(all[2].name).toBe('Charlie session');
  });

  test('sort by name Z-A', () => {
    createSessions();
    localStorage.setItem('agenticchat_session_sort', 'name-za');
    SessionManager.invalidateCache();
    const all = SessionManager.getAll();
    expect(all[0].name).toBe('Charlie session');
    expect(all[2].name).toBe('Alpha chat');
  });

  test('sort by most messages', () => {
    createSessions();
    localStorage.setItem('agenticchat_session_sort', 'most-msgs');
    SessionManager.invalidateCache();
    const all = SessionManager.getAll();
    expect(all[0].id).toBe('b'); // 3 msgs
    expect(all[1].id).toBe('c'); // 2 msgs
    expect(all[2].id).toBe('a'); // 1 msg
  });

  test('sort by fewest messages', () => {
    createSessions();
    localStorage.setItem('agenticchat_session_sort', 'least-msgs');
    SessionManager.invalidateCache();
    const all = SessionManager.getAll();
    expect(all[0].id).toBe('a'); // 1 msg
    expect(all[2].id).toBe('b'); // 3 msgs
  });

  test('pinned sessions always float to top', () => {
    createSessions();
    localStorage.setItem('agenticchat_session_sort', 'name-az');
    localStorage.setItem('agenticchat_pinned_sessions', JSON.stringify(['c']));
    SessionManager.invalidateCache();
    const all = SessionManager.getAll();
    expect(all[0].id).toBe('c'); // pinned, even though Charlie > Alpha
  });

  test('search filters by name', () => {
    createSessions();
    localStorage.removeItem('agenticchat_session_sort');
    SessionManager.setSearchQuery('beta');
    const all = SessionManager.getAll();
    expect(all.length).toBe(1);
    expect(all[0].id).toBe('b');
    // Clean up
    SessionManager.setSearchQuery('');
  });

  test('search filters by preview', () => {
    createSessions();
    SessionManager.setSearchQuery('test');
    const all = SessionManager.getAll();
    expect(all.length).toBe(1);
    expect(all[0].id).toBe('c');
    SessionManager.setSearchQuery('');
  });

  test('setSortMode persists preference', () => {
    SessionManager.setSortMode('name-az');
    expect(localStorage.getItem('agenticchat_session_sort')).toBe('name-az');
  });
});
