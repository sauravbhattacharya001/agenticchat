/**
 * @jest-environment jsdom
 */
const { setupDOM, loadApp } = require('./setup');

beforeAll(() => { setupDOM(); loadApp(); });
beforeEach(() => {
  localStorage.clear();
  ResponseRating.clearAll();
  // Seed conversation with system + user + assistant messages
  ConversationManager.clear();
  ConversationManager.addMessage('system', 'You are helpful.');
  ConversationManager.addMessage('user', 'Hello');
  ConversationManager.addMessage('assistant', 'Hi there! How can I help?');
  ConversationManager.addMessage('user', 'Explain closures');
  ConversationManager.addMessage('assistant', 'A closure is a function that captures variables from its enclosing scope.');
});

describe('ResponseRating', () => {
  test('module exists with expected API', () => {
    expect(ResponseRating).toBeDefined();
    expect(typeof ResponseRating.init).toBe('function');
    expect(typeof ResponseRating.rate).toBe('function');
    expect(typeof ResponseRating.unrate).toBe('function');
    expect(typeof ResponseRating.getRating).toBe('function');
    expect(typeof ResponseRating.getRatings).toBe('function');
    expect(typeof ResponseRating.getModelStats).toBe('function');
    expect(typeof ResponseRating.getOverallStats).toBe('function');
    expect(typeof ResponseRating.decorateMessages).toBe('function');
    expect(typeof ResponseRating.toggleDashboard).toBe('function');
    expect(typeof ResponseRating.exportRatings).toBe('function');
    expect(typeof ResponseRating.clearAll).toBe('function');
  });

  test('rate returns true for valid assistant message', () => {
    // Index 0 = first non-system assistant message (index 1 in display = assistant)
    expect(ResponseRating.rate(1, 'up')).toBe(true);
  });

  test('rate returns false for user message index', () => {
    // Index 0 is user message
    expect(ResponseRating.rate(0, 'up')).toBe(false);
  });

  test('rate returns false for invalid rating value', () => {
    expect(ResponseRating.rate(1, 'meh')).toBe(false);
  });

  test('rate returns false for negative index', () => {
    expect(ResponseRating.rate(-1, 'up')).toBe(false);
  });

  test('getRating returns null when unrated', () => {
    expect(ResponseRating.getRating(1)).toBeNull();
  });

  test('getRating returns rating after rate()', () => {
    ResponseRating.rate(1, 'down');
    expect(ResponseRating.getRating(1)).toBe('down');
  });

  test('rating replaces previous rating for same message', () => {
    ResponseRating.rate(1, 'up');
    ResponseRating.rate(1, 'down');
    expect(ResponseRating.getRating(1)).toBe('down');
    expect(ResponseRating.getRatings().length).toBe(1);
  });

  test('unrate removes rating', () => {
    ResponseRating.rate(1, 'up');
    expect(ResponseRating.unrate(1)).toBe(true);
    expect(ResponseRating.getRating(1)).toBeNull();
  });

  test('unrate returns false when no rating exists', () => {
    expect(ResponseRating.unrate(1)).toBe(false);
  });

  test('getRatings returns copy of all ratings', () => {
    ResponseRating.rate(1, 'up');
    ResponseRating.rate(3, 'down');
    const all = ResponseRating.getRatings();
    expect(all.length).toBe(2);
    expect(all[0].rating).toBe('up');
    expect(all[1].rating).toBe('down');
  });

  test('rating includes model, timestamp, and snippet', () => {
    ResponseRating.rate(1, 'up');
    const r = ResponseRating.getRatings()[0];
    expect(r.model).toBeDefined();
    expect(typeof r.timestamp).toBe('number');
    expect(typeof r.snippet).toBe('string');
    expect(r.snippet.length).toBeGreaterThan(0);
  });

  test('getOverallStats calculates correctly', () => {
    ResponseRating.rate(1, 'up');
    ResponseRating.rate(3, 'down');
    const stats = ResponseRating.getOverallStats();
    expect(stats.up).toBe(1);
    expect(stats.down).toBe(1);
    expect(stats.total).toBe(2);
    expect(stats.rate).toBe(50);
  });

  test('getOverallStats returns 0 rate when empty', () => {
    const stats = ResponseRating.getOverallStats();
    expect(stats.total).toBe(0);
    expect(stats.rate).toBe(0);
  });

  test('getModelStats groups by model', () => {
    ResponseRating.rate(1, 'up');
    ResponseRating.rate(3, 'up');
    const stats = ResponseRating.getModelStats();
    const models = Object.keys(stats);
    expect(models.length).toBeGreaterThan(0);
    const first = stats[models[0]];
    expect(first.up).toBe(2);
    expect(first.total).toBe(2);
  });

  test('clearAll removes all ratings', () => {
    ResponseRating.rate(1, 'up');
    ResponseRating.rate(3, 'down');
    ResponseRating.clearAll();
    expect(ResponseRating.getRatings().length).toBe(0);
    expect(ResponseRating.getOverallStats().total).toBe(0);
  });

  test('ratings persist to localStorage', () => {
    ResponseRating.rate(1, 'up');
    const raw = localStorage.getItem('agenticchat_ratings');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw);
    expect(parsed.length).toBe(1);
    expect(parsed[0].rating).toBe('up');
  });

  test('clearAll clears localStorage', () => {
    ResponseRating.rate(1, 'up');
    ResponseRating.clearAll();
    const raw = localStorage.getItem('agenticchat_ratings');
    expect(JSON.parse(raw).length).toBe(0);
  });

  test('decorateMessages runs without error', () => {
    expect(() => ResponseRating.decorateMessages()).not.toThrow();
  });

  test('toggleDashboard opens and closes', () => {
    ResponseRating.toggleDashboard();
    expect(document.querySelector('.rating-dashboard')).toBeTruthy();
    ResponseRating.toggleDashboard();
    expect(document.querySelector('.rating-dashboard')).toBeNull();
  });

  test('openDashboard shows stats', () => {
    ResponseRating.rate(1, 'up');
    ResponseRating.openDashboard();
    const dashboard = document.querySelector('.rating-dashboard');
    expect(dashboard).toBeTruthy();
    expect(dashboard.textContent).toContain('Response Ratings Dashboard');
    expect(dashboard.textContent).toContain('Satisfaction');
    ResponseRating.closeDashboard();
  });

  test('openDashboard shows empty state when no ratings', () => {
    ResponseRating.openDashboard();
    const dashboard = document.querySelector('.rating-dashboard');
    expect(dashboard.textContent).toContain('No ratings yet');
    ResponseRating.closeDashboard();
  });

  test('exportRatings alerts when empty', () => {
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    ResponseRating.exportRatings('json');
    expect(alertSpy).toHaveBeenCalledWith('No ratings to export.');
    alertSpy.mockRestore();
  });

  test('snippet is truncated to 80 chars', () => {
    ConversationManager.addMessage('assistant', 'A'.repeat(200));
    // New assistant at display index 4
    ResponseRating.rate(4, 'up');
    const r = ResponseRating.getRatings()[0];
    expect(r.snippet.length).toBeLessThanOrEqual(80);
  });

  test('multiple ratings for different messages', () => {
    ResponseRating.rate(1, 'up');
    ResponseRating.rate(3, 'down');
    expect(ResponseRating.getRating(1)).toBe('up');
    expect(ResponseRating.getRating(3)).toBe('down');
    expect(ResponseRating.getRatings().length).toBe(2);
  });
});
