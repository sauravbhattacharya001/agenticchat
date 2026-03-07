/**
 * @jest-environment jsdom
 */

/* global ConversationMerge, SessionManager, ConversationManager, SafeStorage */

describe('ConversationMerge', () => {
  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';
    // Reset SafeStorage
    localStorage.clear();
  });

  afterEach(() => {
    // Clean up any open modals
    if (typeof ConversationMerge !== 'undefined') {
      try { ConversationMerge.close(); } catch {}
    }
  });

  test('open() alerts when fewer than 2 sessions', () => {
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    // No sessions saved
    ConversationMerge.open();
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('at least 2'));
    alertSpy.mockRestore();
  });

  test('open() renders modal with session list when 2+ sessions exist', () => {
    // Create two sessions
    ConversationManager.addMessage('user', 'Hello from session 1');
    ConversationManager.addMessage('assistant', 'Hi there!');
    SessionManager.save('Session One');
    ConversationManager.clearHistory();

    ConversationManager.addMessage('user', 'Hello from session 2');
    ConversationManager.addMessage('assistant', 'Hey!');
    SessionManager.save('Session Two');
    ConversationManager.clearHistory();

    ConversationMerge.open();

    // Modal should exist
    const modal = document.querySelector('[role="dialog"]');
    expect(modal).not.toBeNull();
    expect(modal.textContent).toContain('Merge Sessions');

    // Should list both sessions
    const checkboxes = modal.querySelectorAll('.merge-cb');
    expect(checkboxes.length).toBe(2);
  });

  test('close() removes modal and overlay', () => {
    ConversationManager.addMessage('user', 'A');
    SessionManager.save('S1');
    ConversationManager.clearHistory();
    ConversationManager.addMessage('user', 'B');
    SessionManager.save('S2');
    ConversationManager.clearHistory();

    ConversationMerge.open();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    ConversationMerge.close();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test('merge button is disabled until 2+ sessions selected', () => {
    ConversationManager.addMessage('user', 'A');
    SessionManager.save('S1');
    ConversationManager.clearHistory();
    ConversationManager.addMessage('user', 'B');
    SessionManager.save('S2');
    ConversationManager.clearHistory();

    ConversationMerge.open();
    const btn = document.getElementById('merge-go');
    expect(btn.disabled).toBe(true);

    // Select one checkbox
    const cbs = document.querySelectorAll('.merge-cb');
    cbs[0].checked = true;
    cbs[0].dispatchEvent(new Event('change'));
    expect(btn.disabled).toBe(true);

    // Select second
    cbs[1].checked = true;
    cbs[1].dispatchEvent(new Event('change'));
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain('2');
  });

  test('merge creates combined session with messages from both sources', () => {
    ConversationManager.addMessage('user', 'Alpha');
    ConversationManager.addMessage('assistant', 'Beta');
    SessionManager.save('First');
    ConversationManager.clearHistory();

    ConversationManager.addMessage('user', 'Gamma');
    ConversationManager.addMessage('assistant', 'Delta');
    SessionManager.save('Second');
    ConversationManager.clearHistory();

    const before = SessionManager.getAll();
    expect(before.length).toBe(2);

    ConversationMerge.open();
    const cbs = document.querySelectorAll('.merge-cb');
    cbs.forEach(cb => {
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));
    });

    document.getElementById('merge-go').click();

    // Should now have 3 sessions (2 originals + 1 merged)
    const after = SessionManager.getAll();
    expect(after.length).toBe(3);

    // Find the merged session
    const merged = after.find(s => s.name.includes('Merged'));
    expect(merged).toBeDefined();
    // Should have messages from both sessions (plus system separators)
    expect(merged.messages.length).toBeGreaterThanOrEqual(4);

    // Check that messages contain content from both
    const contents = merged.messages.map(m => m.content);
    expect(contents.some(c => c.includes('Alpha') || c === 'Alpha')).toBe(true);
    expect(contents.some(c => c.includes('Gamma') || c === 'Gamma')).toBe(true);
  });

  test('merge with delete originals removes source sessions', () => {
    ConversationManager.addMessage('user', 'One');
    SessionManager.save('S1');
    ConversationManager.clearHistory();

    ConversationManager.addMessage('user', 'Two');
    SessionManager.save('S2');
    ConversationManager.clearHistory();

    ConversationMerge.open();
    const cbs = document.querySelectorAll('.merge-cb');
    cbs.forEach(cb => {
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));
    });

    // Check delete originals
    document.getElementById('merge-delete-originals').checked = true;
    document.getElementById('merge-go').click();

    // Should only have 1 session (the merged one)
    const after = SessionManager.getAll();
    expect(after.length).toBe(1);
    expect(after[0].name).toContain('Merged');
  });

  test('merge with custom name uses provided name', () => {
    ConversationManager.addMessage('user', 'A');
    SessionManager.save('SA');
    ConversationManager.clearHistory();

    ConversationManager.addMessage('user', 'B');
    SessionManager.save('SB');
    ConversationManager.clearHistory();

    ConversationMerge.open();
    const cbs = document.querySelectorAll('.merge-cb');
    cbs.forEach(cb => {
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));
    });

    document.getElementById('merge-name').value = 'My Custom Merge';
    document.getElementById('merge-go').click();

    const merged = SessionManager.getAll().find(s => s.name === 'My Custom Merge');
    expect(merged).toBeDefined();
  });

  test('merged messages include separator markers between sources', () => {
    ConversationManager.addMessage('user', 'X');
    SessionManager.save('SX');
    ConversationManager.clearHistory();

    ConversationManager.addMessage('user', 'Y');
    SessionManager.save('SY');
    ConversationManager.clearHistory();

    ConversationMerge.open();
    const cbs = document.querySelectorAll('.merge-cb');
    cbs.forEach(cb => {
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));
    });
    document.getElementById('merge-go').click();

    const merged = SessionManager.getAll().find(s => s.name.includes('Merged'));
    const separators = merged.messages.filter(m => m.role === 'system' && m.content.includes('Merged from'));
    expect(separators.length).toBeGreaterThanOrEqual(2);
  });
});
