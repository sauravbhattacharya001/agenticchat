/**
 * SmartGoalTracker — unit tests (32 tests)
 * Autonomous goal extraction and progress tracking engine
 * @jest-environment jsdom
 */

const { setupDOM, loadApp } = require('./setup');

beforeEach(() => {
  setupDOM();
  loadApp();
  localStorage.clear();
});

describe('SmartGoalTracker', () => {
  describe('goal extraction', () => {
    test('extracts goal from "I want to" pattern', () => {
      const msgs = [{ role: 'user', content: 'I want to build a REST API for user management' }];
      const goals = SmartGoalTracker.extractGoals(msgs);
      expect(goals.length).toBe(1);
      expect(goals[0].text).toContain('build a REST API');
      expect(goals[0].category).toBe('build');
    });

    test('extracts goal from "help me" pattern', () => {
      const msgs = [{ role: 'user', content: 'Can you help me fix this authentication bug in the login flow' }];
      const goals = SmartGoalTracker.extractGoals(msgs);
      expect(goals.length).toBe(1);
      expect(goals[0].category).toBe('fix');
    });

    test('extracts goal from "how do I" pattern', () => {
      const msgs = [{ role: 'user', content: 'How can I understand the event loop in Node.js properly' }];
      const goals = SmartGoalTracker.extractGoals(msgs);
      expect(goals.length).toBe(1);
      expect(goals[0].text).toContain('event loop');
    });

    test('extracts goal from "implement" pattern', () => {
      const msgs = [{ role: 'user', content: 'Implement a binary search tree with auto-balancing capabilities' }];
      const goals = SmartGoalTracker.extractGoals(msgs);
      expect(goals.length).toBe(1);
      expect(goals[0].category).toBe('build');
    });

    test('extracts goal from "optimize" pattern', () => {
      const msgs = [{ role: 'user', content: 'Optimize the database queries for the reporting module' }];
      const goals = SmartGoalTracker.extractGoals(msgs);
      expect(goals.length).toBe(1);
      expect(goals[0].category).toBe('optimize');
    });

    test('does not extract from very short messages', () => {
      const msgs = [{ role: 'user', content: 'fix it' }];
      const goals = SmartGoalTracker.extractGoals(msgs);
      expect(goals.length).toBe(0);
    });

    test('does not extract from assistant messages', () => {
      const msgs = [{ role: 'assistant', content: 'I want to help you build something truly amazing and powerful' }];
      const goals = SmartGoalTracker.extractGoals(msgs);
      expect(goals.length).toBe(0);
    });

    test('respects disabled state', () => {
      SmartGoalTracker.setEnabled(false);
      const msgs = [{ role: 'user', content: 'I want to build a complete e-commerce platform from scratch' }];
      const goals = SmartGoalTracker.extractGoals(msgs);
      expect(goals.length).toBe(0);
      SmartGoalTracker.setEnabled(true);
    });
  });

  describe('categorization', () => {
    test('categorizes build tasks', () => {
      expect(SmartGoalTracker._categorize('create a new dashboard component')).toBe('build');
    });

    test('categorizes fix tasks', () => {
      expect(SmartGoalTracker._categorize('debug the memory leak in the worker')).toBe('fix');
    });

    test('categorizes learn tasks', () => {
      expect(SmartGoalTracker._categorize('understand how closures work in JS')).toBe('learn');
    });

    test('categorizes optimize tasks', () => {
      expect(SmartGoalTracker._categorize('improve the database query performance')).toBe('optimize');
    });

    test('categorizes setup tasks', () => {
      expect(SmartGoalTracker._categorize('configure the CI pipeline for deploy')).toBe('setup');
    });

    test('falls back to general', () => {
      expect(SmartGoalTracker._categorize('something random and unrelated')).toBe('general');
    });
  });

  describe('progress tracking', () => {
    test('increases progress on positive signals', () => {
      const msgs = [{ role: 'user', content: 'I want to build a login page with OAuth support integration' }];
      SmartGoalTracker.analyze(msgs);
      const goal = SmartGoalTracker.getState().goals[0];
      const initialProgress = goal.progress;
      const progressMsgs = [{ role: 'user', content: 'That works perfectly, thanks a lot!' }];
      SmartGoalTracker.updateProgress(progressMsgs);
      const updated = SmartGoalTracker.getGoals()[0];
      expect(updated.progress).toBeGreaterThan(initialProgress);
    });

    test('detects stuck state from frustration signals', () => {
      const msgs = [{ role: 'user', content: 'I want to fix this critical production bug in the authentication module' }];
      SmartGoalTracker.analyze(msgs);
      const stuckMsgs = [
        { role: 'user', content: 'Still not working after all those changes I made' },
        { role: 'user', content: "I'm stuck and confused, tried everything possible" },
        { role: 'user', content: 'Going in circles with this frustrating problem' }
      ];
      SmartGoalTracker.updateProgress(stuckMsgs);
      const goal = SmartGoalTracker.getGoals()[0];
      expect(goal.status).toBe('stuck');
    });

    test('detects completion from signals', () => {
      const msgs = [{ role: 'user', content: "Help me implement a caching layer for the API requests module" }];
      SmartGoalTracker.analyze(msgs);
      const doneMsgs = [{ role: 'user', content: 'All done, everything works perfectly now, thanks!' }];
      SmartGoalTracker.updateProgress(doneMsgs);
      const goal = SmartGoalTracker.getGoals()[0];
      expect(goal.status).toBe('completed');
      expect(goal.progress).toBe(100);
    });

    test('adds milestones on significant progress', () => {
      const msgs = [{ role: 'user', content: "I want to create a complete authentication system with JWT" }];
      SmartGoalTracker.analyze(msgs);
      const progressMsgs = [{ role: 'user', content: "Next step is to add the refresh token logic" }];
      SmartGoalTracker.updateProgress(progressMsgs);
      const goal = SmartGoalTracker.getGoals()[0];
      expect(goal.milestones.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('next step recommendations', () => {
    test('recommends breaking down for stuck goals', () => {
      const goal = SmartGoalTracker._createGoal('fix memory leak in the worker threads', 0.8);
      goal.status = 'stuck';
      const steps = SmartGoalTracker.recommendNextSteps(goal);
      expect(steps.length).toBeGreaterThan(0);
      expect(steps.some(s => s.text.includes('smaller sub-tasks'))).toBe(true);
    });

    test('recommends error sharing for stuck fix goals', () => {
      const goal = SmartGoalTracker._createGoal('fix the auth bug', 0.8);
      goal.status = 'stuck';
      goal.category = 'fix';
      const steps = SmartGoalTracker.recommendNextSteps(goal);
      expect(steps.some(s => s.text.includes('error message'))).toBe(true);
    });

    test('recommends success criteria for early-stage goals', () => {
      const goal = SmartGoalTracker._createGoal('build a dashboard', 0.8);
      goal.status = 'active';
      goal.progress = 10;
      const steps = SmartGoalTracker.recommendNextSteps(goal);
      expect(steps.some(s => s.text.includes('success criteria'))).toBe(true);
    });

    test('recommends testing for near-complete goals', () => {
      const goal = SmartGoalTracker._createGoal('build a dashboard', 0.8);
      goal.status = 'progressing';
      goal.progress = 80;
      const steps = SmartGoalTracker.recommendNextSteps(goal);
      expect(steps.some(s => s.text.includes('end-to-end'))).toBe(true);
    });

    test('recommends alternative approaches for stuck goals', () => {
      const goal = SmartGoalTracker._createGoal('solve algorithm challenge', 0.8);
      goal.status = 'stuck';
      const steps = SmartGoalTracker.recommendNextSteps(goal);
      expect(steps.some(s => s.text.includes('alternative approaches'))).toBe(true);
    });
  });

  describe('insights generation', () => {
    test('returns array even with no goals', () => {
      const insights = SmartGoalTracker.generateInsights();
      expect(Array.isArray(insights)).toBe(true);
    });

    test('generates warning when goals are stuck', () => {
      SmartGoalTracker.addGoal('Test goal for insight');
      // Force stuck status directly in state
      const state = SmartGoalTracker.getState();
      // We need to go through the public API
      const msgs = [{ role: 'user', content: 'I want to solve this impossible algorithm problem in recursion' }];
      SmartGoalTracker.analyze(msgs);
      const stuckMsgs = [
        { role: 'user', content: 'Still not working, same error over and over again' },
        { role: 'user', content: "I'm stuck and going in circles with this approach" },
        { role: 'user', content: "Tried everything and nothing helps at all" }
      ];
      SmartGoalTracker.updateProgress(stuckMsgs);
      const insights = SmartGoalTracker.generateInsights();
      expect(insights.some(i => i.type === 'warning')).toBe(true);
    });
  });

  describe('manual goal management', () => {
    test('adds a manual goal', () => {
      const goal = SmartGoalTracker.addGoal('Learn TypeScript generics');
      expect(goal.text).toBe('Learn TypeScript generics');
      expect(goal.confidence).toBe(1.0);
      expect(goal.status).toBe('active');
    });

    test('completes a goal', () => {
      const goal = SmartGoalTracker.addGoal('Write unit tests');
      SmartGoalTracker.completeGoal(goal.id);
      const found = SmartGoalTracker.getGoals().find(g => g.id === goal.id);
      expect(found.status).toBe('completed');
      expect(found.progress).toBe(100);
    });

    test('abandons a goal', () => {
      const goal = SmartGoalTracker.addGoal('Migrate to Deno');
      SmartGoalTracker.abandonGoal(goal.id);
      const found = SmartGoalTracker.getGoals().find(g => g.id === goal.id);
      expect(found.status).toBe('abandoned');
    });

    test('removes a goal entirely', () => {
      const goal = SmartGoalTracker.addGoal('Temporary goal');
      SmartGoalTracker.removeGoal(goal.id);
      expect(SmartGoalTracker.getGoals().find(g => g.id === goal.id)).toBeUndefined();
    });
  });

  describe('similarity detection', () => {
    test('detects similar texts (Jaccard)', () => {
      const sim = SmartGoalTracker._similarity('build a rest api for users', 'build a rest api for user management');
      expect(sim).toBeGreaterThan(0.5);
    });

    test('detects dissimilar texts', () => {
      const sim = SmartGoalTracker._similarity('build a rest api', 'learn about quantum physics');
      expect(sim).toBeLessThan(0.3);
    });
  });

  describe('configuration', () => {
    test('can be disabled and re-enabled', () => {
      SmartGoalTracker.setEnabled(false);
      expect(SmartGoalTracker.isEnabled()).toBe(false);
      SmartGoalTracker.setEnabled(true);
      expect(SmartGoalTracker.isEnabled()).toBe(true);
    });

    test('exposes STATUS constants', () => {
      expect(SmartGoalTracker.STATUS.ACTIVE).toBe('active');
      expect(SmartGoalTracker.STATUS.STUCK).toBe('stuck');
      expect(SmartGoalTracker.STATUS.COMPLETED).toBe('completed');
      expect(SmartGoalTracker.STATUS.ABANDONED).toBe('abandoned');
      expect(SmartGoalTracker.STATUS.PROGRESSING).toBe('progressing');
    });
  });

  describe('state management', () => {
    test('getGoals returns array', () => {
      expect(Array.isArray(SmartGoalTracker.getGoals())).toBe(true);
    });

    test('getActiveGoals filters correctly', () => {
      SmartGoalTracker.addGoal('Active goal one');
      const goal2 = SmartGoalTracker.addGoal('Will be completed');
      SmartGoalTracker.completeGoal(goal2.id);
      const active = SmartGoalTracker.getActiveGoals();
      expect(active.every(g => g.status === 'active' || g.status === 'progressing')).toBe(true);
    });

    test('getInsights returns array', () => {
      expect(Array.isArray(SmartGoalTracker.getInsights())).toBe(true);
    });

    test('getState returns deep copy', () => {
      SmartGoalTracker.addGoal('Test immutability');
      const state = SmartGoalTracker.getState();
      state.goals = [];
      expect(SmartGoalTracker.getGoals().length).toBeGreaterThan(0);
    });
  });
});
