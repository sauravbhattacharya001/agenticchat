/**
 * SmartSessionPrioritizer — session priority scoring and triage tests
 */
const { setupDOM, loadApp } = require('./setup');

beforeAll(() => { setupDOM(); loadApp(); });

describe('SmartSessionPrioritizer', () => {
  let SSP;

  beforeEach(() => {
    SSP = globalThis.SmartSessionPrioritizer;
    localStorage.clear();
  });

  /* ── scan() with no sessions returns empty ── */
  test('scan returns empty array when no sessions exist', () => {
    const results = SSP.scan();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });

  /* ── scan scores sessions and sorts descending ── */
  test('scan scores and ranks sessions by priority', () => {
    const sessions = [
      {
        id: 'low',
        name: 'Idle Chat',
        updatedAt: Date.now() - 2 * 86400000, // 2 days ago
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' }
        ]
      },
      {
        id: 'high',
        name: 'Urgent Tasks',
        updatedAt: Date.now() - 3600000, // 1 hour ago
        messages: [
          { role: 'user', content: 'This is urgent — we need the deadline report ASAP?' },
          { role: 'user', content: 'Also a todo: follow up on the API integration?' },
          { role: 'user', content: 'Action item: deploy to staging immediately' }
        ]
      }
    ];
    localStorage.setItem('agenticchat_sessions', JSON.stringify(sessions));

    const results = SSP.scan();
    expect(results.length).toBe(2);
    // High-priority session should rank first
    expect(results[0].id).toBe('high');
    expect(results[0].score).toBeGreaterThan(results[1].score);
    expect(results[0].level).toBe('critical');
  });

  /* ── unresolved questions boost score ── */
  test('unresolved questions (no assistant follow-up) increase score', () => {
    const sessions = [
      {
        id: 'q1',
        name: 'Questions',
        updatedAt: Date.now(),
        messages: [
          { role: 'user', content: 'What is the status?' },
          // No assistant reply — unresolved
          { role: 'user', content: 'Any update on the bug?' }
          // No assistant reply — unresolved
        ]
      },
      {
        id: 'q2',
        name: 'Answered',
        updatedAt: Date.now(),
        messages: [
          { role: 'user', content: 'What is the status?' },
          { role: 'assistant', content: 'All good!' }
        ]
      }
    ];
    localStorage.setItem('agenticchat_sessions', JSON.stringify(sessions));

    const results = SSP.scan();
    const q1 = results.find(r => r.id === 'q1');
    const q2 = results.find(r => r.id === 'q2');
    expect(q1.score).toBeGreaterThan(q2.score);
    expect(q1.reasons.some(r => r.includes('unresolved question'))).toBe(true);
  });

  /* ── action items detected ── */
  test('action items in messages boost score', () => {
    const sessions = [
      {
        id: 'act',
        name: 'Action Items',
        updatedAt: Date.now(),
        messages: [
          { role: 'user', content: 'todo: finish the report' },
          { role: 'assistant', content: 'Next step: review the pull request' },
          { role: 'user', content: 'Don\'t forget to update the docs' }
        ]
      }
    ];
    localStorage.setItem('agenticchat_sessions', JSON.stringify(sessions));

    const results = SSP.scan();
    expect(results[0].reasons.some(r => r.includes('action item'))).toBe(true);
    expect(results[0].score).toBeGreaterThan(0);
  });

  /* ── urgency keywords detected ── */
  test('urgency keywords increase score and add reason', () => {
    const sessions = [
      {
        id: 'urg',
        name: 'Critical Issue',
        updatedAt: Date.now(),
        messages: [
          { role: 'user', content: 'This is critical and time-sensitive!' },
          { role: 'assistant', content: 'On it immediately.' }
        ]
      }
    ];
    localStorage.setItem('agenticchat_sessions', JSON.stringify(sessions));

    const results = SSP.scan();
    expect(results[0].reasons.some(r => r.includes('urgency'))).toBe(true);
  });

  /* ── stale sessions penalised ── */
  test('sessions older than 7 days are marked stale with penalty', () => {
    const sessions = [
      {
        id: 'stale',
        name: 'Old Chat',
        updatedAt: Date.now() - 14 * 86400000, // 14 days ago
        messages: [{ role: 'user', content: 'Hello' }]
      }
    ];
    localStorage.setItem('agenticchat_sessions', JSON.stringify(sessions));

    const results = SSP.scan();
    expect(results[0].reasons.some(r => r.includes('stale'))).toBe(true);
    expect(results[0].level).toBe('low');
  });

  /* ── level classification thresholds ── */
  test('level is critical >= 60, medium >= 25, low < 25', () => {
    // Build sessions with known scoring to test thresholds
    const sessions = [
      {
        id: 'crit',
        name: 'Many Issues',
        updatedAt: Date.now(),
        messages: [
          { role: 'user', content: 'Urgent question?' },
          { role: 'user', content: 'Another urgent todo action item?' },
          { role: 'user', content: 'Critical deadline asap important?' }
        ]
      },
      {
        id: 'med',
        name: 'Some Issues',
        updatedAt: Date.now(),
        messages: [
          { role: 'user', content: 'A question?' },
          { role: 'assistant', content: 'Answered.' },
          { role: 'user', content: 'todo: check later' }
        ]
      },
      {
        id: 'low',
        name: 'Clean',
        updatedAt: Date.now() - 3 * 86400000,
        messages: [
          { role: 'user', content: 'Just chatting' },
          { role: 'assistant', content: 'Sure thing!' }
        ]
      }
    ];
    localStorage.setItem('agenticchat_sessions', JSON.stringify(sessions));

    const results = SSP.scan();
    const crit = results.find(r => r.id === 'crit');
    const low = results.find(r => r.id === 'low');
    expect(crit.level).toBe('critical');
    expect(low.level).toBe('low');
  });

  /* ── empty messages handled gracefully ── */
  test('handles sessions with no messages', () => {
    const sessions = [
      { id: 'empty', name: 'Empty', updatedAt: Date.now(), messages: [] }
    ];
    localStorage.setItem('agenticchat_sessions', JSON.stringify(sessions));

    const results = SSP.scan();
    expect(results.length).toBe(1);
    expect(results[0].score).toBeGreaterThanOrEqual(0);
    expect(results[0].reasons).toContain('normal');
  });

  /* ── recency gives recent sessions higher score ── */
  test('recent sessions score higher than old ones (all else equal)', () => {
    const sessions = [
      {
        id: 'new',
        name: 'Recent',
        updatedAt: Date.now(),
        messages: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi' }]
      },
      {
        id: 'old',
        name: 'Old',
        updatedAt: Date.now() - 30 * 86400000,
        messages: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi' }]
      }
    ];
    localStorage.setItem('agenticchat_sessions', JSON.stringify(sessions));

    const results = SSP.scan();
    const recent = results.find(r => r.id === 'new');
    const old = results.find(r => r.id === 'old');
    expect(recent.score).toBeGreaterThanOrEqual(old.score);
  });

  /* ── longer conversations get length bonus ── */
  test('longer conversations get a length bonus', () => {
    const shortMsgs = [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }];
    const longMsgs = [];
    for (let i = 0; i < 50; i++) {
      longMsgs.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'Message ' + i });
    }
    const sessions = [
      { id: 'short', name: 'Short', updatedAt: Date.now(), messages: shortMsgs },
      { id: 'long', name: 'Long', updatedAt: Date.now(), messages: longMsgs }
    ];
    localStorage.setItem('agenticchat_sessions', JSON.stringify(sessions));

    const results = SSP.scan();
    const short = results.find(r => r.id === 'short');
    const long = results.find(r => r.id === 'long');
    expect(long.score).toBeGreaterThan(short.score);
  });

  /* ── toggle/show/hide work without errors ── */
  test('toggle, show, hide do not throw', () => {
    expect(() => SSP.show()).not.toThrow();
    expect(() => SSP.hide()).not.toThrow();
    expect(() => SSP.toggle()).not.toThrow();
    expect(() => SSP.toggle()).not.toThrow();
  });

  /* ── scan persists results to localStorage ── */
  test('scan persists scored results to storage', () => {
    const sessions = [
      { id: 's1', name: 'Test', updatedAt: Date.now(), messages: [{ role: 'user', content: 'urgent todo?' }] }
    ];
    localStorage.setItem('agenticchat_sessions', JSON.stringify(sessions));

    SSP.scan();
    const stored = JSON.parse(localStorage.getItem('agenticchat_session_priorities'));
    expect(stored).toBeDefined();
    expect(stored.s1).toBeDefined();
    expect(stored.s1.score).toBeGreaterThan(0);
  });

  /* ── multiple urgency keywords stack ── */
  test('multiple urgency keywords accumulate score', () => {
    const sessions = [
      {
        id: 'multi',
        name: 'Multi Urgent',
        updatedAt: Date.now(),
        messages: [
          { role: 'user', content: 'This is urgent!' },
          { role: 'user', content: 'Critical and important!' },
          { role: 'user', content: 'ASAP deadline!' }
        ]
      },
      {
        id: 'single',
        name: 'Single Urgent',
        updatedAt: Date.now(),
        messages: [
          { role: 'user', content: 'This is urgent!' }
        ]
      }
    ];
    localStorage.setItem('agenticchat_sessions', JSON.stringify(sessions));

    const results = SSP.scan();
    const multi = results.find(r => r.id === 'multi');
    const single = results.find(r => r.id === 'single');
    expect(multi.score).toBeGreaterThan(single.score);
  });

  /* ── result shape validation ── */
  test('scan results have expected shape', () => {
    const sessions = [
      { id: 'shaped', name: 'Test Shape', updatedAt: Date.now(), messages: [{ role: 'user', content: 'hello' }] }
    ];
    localStorage.setItem('agenticchat_sessions', JSON.stringify(sessions));

    const results = SSP.scan();
    const r = results[0];
    expect(r).toHaveProperty('id', 'shaped');
    expect(r).toHaveProperty('name', 'Test Shape');
    expect(r).toHaveProperty('score');
    expect(r).toHaveProperty('level');
    expect(r).toHaveProperty('reasons');
    expect(r).toHaveProperty('updatedAt');
    expect(['critical', 'medium', 'low']).toContain(r.level);
    expect(Array.isArray(r.reasons)).toBe(true);
  });
});
