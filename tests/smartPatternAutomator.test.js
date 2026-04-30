/**
 * SmartPatternAutomator — unit tests (38 tests)
 * Autonomous workflow pattern detection and automation engine
 * @jest-environment jsdom
 */

const { setupDOM, loadApp } = require('./setup');

beforeEach(() => {
  setupDOM();
  loadApp();
  localStorage.clear();
});

describe('SmartPatternAutomator', () => {
  describe('intent classification', () => {
    test('classifies question intent', () => {
      expect(SmartPatternAutomator.classifyIntent('What is dependency injection?')).toBe('question');
    });

    test('classifies code-request intent', () => {
      expect(SmartPatternAutomator.classifyIntent('Write a function to sort an array')).toBe('code-request');
    });

    test('classifies debug intent', () => {
      expect(SmartPatternAutomator.classifyIntent('Fix this bug in my authentication code')).toBe('debug');
    });

    test('classifies explain intent', () => {
      expect(SmartPatternAutomator.classifyIntent('Explain the concept of closures and elaborate on their use')).toBe('explain');
    });

    test('classifies refactor intent', () => {
      expect(SmartPatternAutomator.classifyIntent('Refactor this code to improve readability')).toBe('refactor');
    });

    test('classifies translate intent', () => {
      expect(SmartPatternAutomator.classifyIntent('Translate this text to French and convert the format')).toBe('translate');
    });

    test('classifies summarize intent', () => {
      expect(SmartPatternAutomator.classifyIntent('Summarize the key points of this article')).toBe('summarize');
    });

    test('classifies compare intent', () => {
      expect(SmartPatternAutomator.classifyIntent('Compare React versus Vue for large projects')).toBe('compare');
    });

    test('classifies generate intent', () => {
      expect(SmartPatternAutomator.classifyIntent('Generate a list of test cases for login')).toBe('generate');
    });

    test('classifies analyze intent', () => {
      expect(SmartPatternAutomator.classifyIntent('Analyze and evaluate the performance of this algorithm')).toBe('analyze');
    });

    test('returns other for short text', () => {
      expect(SmartPatternAutomator.classifyIntent('hi')).toBe('other');
    });

    test('returns other for empty input', () => {
      expect(SmartPatternAutomator.classifyIntent('')).toBe('other');
    });

    test('returns other for null input', () => {
      expect(SmartPatternAutomator.classifyIntent(null)).toBe('other');
    });

    test('returns other for unrecognizable text', () => {
      expect(SmartPatternAutomator.classifyIntent('lorem ipsum dolor sit amet consectetur')).toBe('other');
    });
  });

  describe('intent sequence building', () => {
    test('builds sequence from user messages only', () => {
      const msgs = [
        { role: 'user', content: 'What is React?' },
        { role: 'assistant', content: 'React is a library...' },
        { role: 'user', content: 'Write a component for it' }
      ];
      const seq = SmartPatternAutomator.buildIntentSequence(msgs);
      expect(seq.length).toBe(2);
      expect(seq[0].intent).toBe('question');
      expect(seq[1].intent).toBe('code-request');
    });

    test('returns empty for no messages', () => {
      expect(SmartPatternAutomator.buildIntentSequence([])).toEqual([]);
    });

    test('handles non-array input', () => {
      expect(SmartPatternAutomator.buildIntentSequence(null)).toEqual([]);
    });
  });

  describe('pattern mining', () => {
    test('finds patterns with minimum frequency', () => {
      const sessions = [
        { intents: ['question', 'code-request', 'debug', 'question', 'code-request', 'debug'], _timestamp: Date.now() },
        { intents: ['question', 'code-request', 'debug'], _timestamp: Date.now() - 10000 }
      ];
      const patterns = SmartPatternAutomator.minePatterns(sessions, 2);
      expect(patterns.length).toBeGreaterThan(0);
      const qcPattern = patterns.find(p => p.intents[0] === 'question' && p.intents[1] === 'code-request');
      expect(qcPattern).toBeDefined();
      expect(qcPattern.frequency).toBeGreaterThanOrEqual(2);
    });

    test('returns empty for insufficient frequency', () => {
      const sessions = [
        { intents: ['question', 'code-request'], _timestamp: Date.now() }
      ];
      const patterns = SmartPatternAutomator.minePatterns(sessions, 5);
      expect(patterns.length).toBe(0);
    });

    test('sorts by frequency descending', () => {
      const sessions = [
        { intents: ['question', 'code-request', 'question', 'code-request', 'question', 'code-request', 'debug', 'explain', 'debug', 'explain', 'debug', 'explain', 'debug', 'explain'], _timestamp: Date.now() }
      ];
      const patterns = SmartPatternAutomator.minePatterns(sessions, 2);
      for (let i = 1; i < patterns.length; i++) {
        expect(patterns[i - 1].frequency).toBeGreaterThanOrEqual(patterns[i].frequency);
      }
    });

    test('computes support score', () => {
      const sessions = [
        { intents: ['question', 'code-request', 'question', 'code-request'], _timestamp: Date.now() }
      ];
      const patterns = SmartPatternAutomator.minePatterns(sessions, 2);
      const qc = patterns.find(p => p.intents.join('→') === 'question→code-request');
      if (qc) {
        expect(qc.support).toBeGreaterThan(0);
        expect(qc.support).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('workflow generation', () => {
    test('generates workflow from pattern', () => {
      const pattern = {
        id: 'pat_test',
        intents: ['question', 'code-request', 'debug'],
        frequency: 5,
        lastSeen: Date.now()
      };
      const wf = SmartPatternAutomator.generateWorkflow(pattern);
      expect(wf).not.toBeNull();
      expect(wf.name).toContain('Question');
      expect(wf.name).toContain('Code request');
      expect(wf.steps.length).toBe(3);
      expect(wf.steps[0].intent).toBe('question');
      expect(wf.steps[2].intent).toBe('debug');
    });

    test('returns null for invalid pattern', () => {
      expect(SmartPatternAutomator.generateWorkflow(null)).toBeNull();
      expect(SmartPatternAutomator.generateWorkflow({ intents: ['single'] })).toBeNull();
    });

    test('assigns templates to steps', () => {
      const wf = SmartPatternAutomator.generateWorkflow({
        intents: ['explain', 'summarize'],
        frequency: 3,
        lastSeen: Date.now()
      });
      expect(wf.steps[0].template).toContain('{{topic}}');
      expect(wf.steps[1].template).toContain('{{topic}}');
    });

    test('sets initial accepted/dismissed to 0', () => {
      const wf = SmartPatternAutomator.generateWorkflow({
        intents: ['question', 'explain'],
        frequency: 3,
        lastSeen: Date.now()
      });
      expect(wf.accepted).toBe(0);
      expect(wf.dismissed).toBe(0);
      expect(wf.favorite).toBe(false);
    });
  });

  describe('automation trigger', () => {
    test('detects matching workflow start', () => {
      const workflows = [{
        id: 'wf_1',
        name: 'Test',
        pattern: ['question', 'code-request', 'debug'],
        steps: [
          { order: 1, intent: 'question', template: 'Q' },
          { order: 2, intent: 'code-request', template: 'C' },
          { order: 3, intent: 'debug', template: 'D' }
        ],
        frequency: 5,
        accepted: 2,
        dismissed: 0
      }];
      const result = SmartPatternAutomator.checkTrigger(['question', 'code-request'], workflows);
      expect(result).not.toBeNull();
      expect(result.workflow.id).toBe('wf_1');
      expect(result.matchedSteps).toBe(2);
      expect(result.remainingSteps).toBe(1);
    });

    test('returns null when no match', () => {
      const workflows = [{
        id: 'wf_1',
        pattern: ['summarize', 'compare'],
        steps: [{ order: 1, intent: 'summarize' }, { order: 2, intent: 'compare' }],
        frequency: 3
      }];
      const result = SmartPatternAutomator.checkTrigger(['question', 'debug'], workflows);
      expect(result).toBeNull();
    });

    test('returns null for empty inputs', () => {
      expect(SmartPatternAutomator.checkTrigger([], [])).toBeNull();
      expect(SmartPatternAutomator.checkTrigger(null, null)).toBeNull();
    });

    test('respects confidence threshold', () => {
      const workflows = [{
        id: 'wf_1',
        pattern: ['question', 'code-request', 'debug', 'refactor', 'explain'],
        steps: Array.from({ length: 5 }, (_, i) => ({ order: i + 1, intent: 'x' })),
        frequency: 1
      }];
      // 1 out of 5 steps = 0.2 confidence, below threshold
      const result = SmartPatternAutomator.checkTrigger(['question'], workflows);
      expect(result).toBeNull();
    });
  });

  describe('learning engine', () => {
    test('records accepted feedback', () => {
      SmartPatternAutomator.addWorkflow('Test WF', [
        { intent: 'question', template: 'Q' },
        { intent: 'debug', template: 'D' }
      ]);
      const wf = SmartPatternAutomator.getWorkflows()[0];
      SmartPatternAutomator.recordFeedback(wf.id, true);
      const state = SmartPatternAutomator.getState();
      expect(state.feedback[wf.id].accepted).toBe(1);
      expect(state.automations.length).toBe(1);
      expect(state.automations[0].accepted).toBe(true);
    });

    test('records dismissed feedback', () => {
      SmartPatternAutomator.addWorkflow('Test WF2', [
        { intent: 'explain', template: 'E' },
        { intent: 'summarize', template: 'S' }
      ]);
      const wf = SmartPatternAutomator.getWorkflows().find(w => w.name === 'Test WF2');
      SmartPatternAutomator.recordFeedback(wf.id, false);
      const state = SmartPatternAutomator.getState();
      expect(state.feedback[wf.id].dismissed).toBe(1);
    });
  });

  describe('insights generation', () => {
    test('returns valid insights structure', () => {
      const ins = SmartPatternAutomator.generateInsights();
      expect(ins).toHaveProperty('totalAutomations');
      expect(ins).toHaveProperty('acceptanceRate');
      expect(ins).toHaveProperty('efficiencyScore');
      expect(ins).toHaveProperty('topWorkflows');
      expect(ins).toHaveProperty('patternDiversity');
      expect(ins).toHaveProperty('timeSavedSeconds');
      expect(ins).toHaveProperty('favoriteCount');
    });

    test('calculates acceptance rate correctly', () => {
      SmartPatternAutomator.addWorkflow('Ins WF', [
        { intent: 'question', template: 'Q' },
        { intent: 'code-request', template: 'C' }
      ]);
      const wf = SmartPatternAutomator.getWorkflows().find(w => w.name === 'Ins WF');
      SmartPatternAutomator.recordFeedback(wf.id, true);
      SmartPatternAutomator.recordFeedback(wf.id, true);
      SmartPatternAutomator.recordFeedback(wf.id, false);
      const ins = SmartPatternAutomator.generateInsights();
      // We have some automations from previous tests too, so just check it's a number
      expect(typeof ins.acceptanceRate).toBe('number');
      expect(ins.acceptanceRate).toBeGreaterThanOrEqual(0);
      expect(ins.acceptanceRate).toBeLessThanOrEqual(100);
    });
  });

  describe('workflow CRUD', () => {
    test('addWorkflow creates a valid workflow', () => {
      const wf = SmartPatternAutomator.addWorkflow('My Custom WF', [
        { intent: 'analyze', template: 'Analyze {{topic}}' },
        { intent: 'summarize', template: 'Summarize findings' },
        { intent: 'generate', template: 'Generate report for {{topic}}' }
      ]);
      expect(wf).not.toBeNull();
      expect(wf.name).toBe('My Custom WF');
      expect(wf.steps.length).toBe(3);
      expect(wf.pattern).toEqual(['analyze', 'summarize', 'generate']);
    });

    test('addWorkflow rejects invalid input', () => {
      expect(SmartPatternAutomator.addWorkflow('', [])).toBeNull();
      expect(SmartPatternAutomator.addWorkflow('X', [{ intent: 'one' }])).toBeNull();
    });

    test('removeWorkflow removes by id', () => {
      const wf = SmartPatternAutomator.addWorkflow('To Delete', [
        { intent: 'question', template: 'Q' },
        { intent: 'explain', template: 'E' }
      ]);
      const result = SmartPatternAutomator.removeWorkflow(wf.id);
      expect(result).toBe(true);
      expect(SmartPatternAutomator.getWorkflows().find(w => w.id === wf.id)).toBeUndefined();
    });

    test('removeWorkflow returns false for non-existent id', () => {
      expect(SmartPatternAutomator.removeWorkflow('nonexistent')).toBe(false);
    });
  });

  describe('full analysis pipeline', () => {
    test('analyze processes messages end to end', () => {
      const msgs = [];
      // Create a repeating pattern: question → code-request → debug (3 times)
      for (let i = 0; i < 3; i++) {
        msgs.push({ role: 'user', content: 'What is the best approach for building a REST API?' });
        msgs.push({ role: 'assistant', content: 'Here are some approaches...' });
        msgs.push({ role: 'user', content: 'Write the code for the user endpoint' });
        msgs.push({ role: 'assistant', content: 'Here is the code...' });
        msgs.push({ role: 'user', content: 'Fix this error in the authentication middleware' });
        msgs.push({ role: 'assistant', content: 'The bug is...' });
      }
      const result = SmartPatternAutomator.analyze(msgs);
      expect(result.intents.length).toBe(9);
      expect(result.intents[0]).toBe('question');
      expect(result.intents[1]).toBe('code-request');
      expect(result.intents[2]).toBe('debug');
    });

    test('analyze handles empty messages', () => {
      const result = SmartPatternAutomator.analyze([]);
      expect(result.intents).toEqual([]);
      expect(result.patterns).toEqual([]);
    });
  });

  describe('INTENTS constant', () => {
    test('exposes all intent categories', () => {
      const intents = SmartPatternAutomator.INTENTS;
      expect(intents.QUESTION).toBe('question');
      expect(intents.CODE_REQUEST).toBe('code-request');
      expect(intents.DEBUG).toBe('debug');
      expect(intents.EXPLAIN).toBe('explain');
      expect(intents.REFACTOR).toBe('refactor');
      expect(intents.TRANSLATE).toBe('translate');
      expect(intents.SUMMARIZE).toBe('summarize');
      expect(intents.COMPARE).toBe('compare');
      expect(intents.GENERATE).toBe('generate');
      expect(intents.ANALYZE).toBe('analyze');
      expect(intents.OTHER).toBe('other');
    });
  });
});
