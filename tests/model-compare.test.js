/**
 * @jest-environment jsdom
 */
const { setupDOM, loadApp } = require('./setup');

beforeAll(() => { setupDOM(); loadApp(); });
beforeEach(() => {
  localStorage.clear();
  ModelCompare.clearHistory();
});

describe('ModelCompare', () => {
  test('module exists with expected API', () => {
    expect(ModelCompare).toBeDefined();
    expect(typeof ModelCompare.compare).toBe('function');
    expect(typeof ModelCompare.setWinner).toBe('function');
    expect(typeof ModelCompare.getHistory).toBe('function');
    expect(typeof ModelCompare.getComparison).toBe('function');
    expect(typeof ModelCompare.buildComparisonView).toBe('function');
    expect(typeof ModelCompare.getModelStats).toBe('function');
    expect(typeof ModelCompare.clearHistory).toBe('function');
    expect(typeof ModelCompare.exportHistory).toBe('function');
  });

  test('compare rejects missing prompt', async () => {
    await expect(ModelCompare.compare('', ['gpt-4o', 'gpt-4']))
      .rejects.toThrow('prompt is required');
  });

  test('compare rejects non-string prompt', async () => {
    await expect(ModelCompare.compare(123, ['gpt-4o', 'gpt-4']))
      .rejects.toThrow('prompt is required');
  });

  test('compare rejects fewer than 2 models', async () => {
    await expect(ModelCompare.compare('test', ['gpt-4o']))
      .rejects.toThrow('at least 2 model IDs');
  });

  test('compare rejects non-array models', async () => {
    await expect(ModelCompare.compare('test', 'gpt-4o'))
      .rejects.toThrow('at least 2 model IDs');
  });

  test('getHistory returns empty array initially', () => {
    expect(ModelCompare.getHistory()).toEqual([]);
  });

  test('getHistory respects limit', () => {
    // Manually add items via localStorage
    const items = [];
    for (let i = 0; i < 5; i++) {
      items.push({
        id: 'cmp-test-' + i,
        prompt: 'test ' + i,
        responses: [],
        createdAt: new Date().toISOString(),
        winner: null
      });
    }
    localStorage.setItem('ac-model-compare-history', JSON.stringify(items));
    const result = ModelCompare.getHistory(3);
    expect(result.length).toBe(3);
  });

  test('clearHistory empties storage', () => {
    localStorage.setItem('ac-model-compare-history', JSON.stringify([{ id: 'x' }]));
    ModelCompare.clearHistory();
    expect(ModelCompare.getHistory()).toEqual([]);
    expect(localStorage.getItem('ac-model-compare-history')).toBe('[]');
  });

  test('setWinner returns false for non-existent comparison', () => {
    expect(ModelCompare.setWinner('nonexistent', 'gpt-4o')).toBe(false);
  });

  test('setWinner updates winner and persists', () => {
    const items = [{
      id: 'cmp-test-1',
      prompt: 'test',
      responses: [
        { modelId: 'gpt-4o', content: 'a', latencyMs: 100 },
        { modelId: 'gpt-4', content: 'b', latencyMs: 200 }
      ],
      createdAt: new Date().toISOString(),
      winner: null
    }];
    localStorage.setItem('ac-model-compare-history', JSON.stringify(items));
    // Force internal state to reload from localStorage
    const history = ModelCompare.getHistory();
    expect(history.length).toBe(1);

    expect(ModelCompare.setWinner('cmp-test-1', 'gpt-4o')).toBe(true);
    const updated = ModelCompare.getHistory();
    expect(updated[0].winner).toBe('gpt-4o');
  });

  test('getComparison returns null for unknown ID', () => {
    expect(ModelCompare.getComparison('nonexistent')).toBeNull();
  });

  test('exportHistory returns valid JSON', () => {
    const json = ModelCompare.exportHistory();
    expect(() => JSON.parse(json)).not.toThrow();
    expect(JSON.parse(json)).toEqual([]);
  });

  describe('buildComparisonView', () => {
    const mockComparison = {
      id: 'cmp-test-view',
      prompt: 'What is 2+2?',
      responses: [
        { modelId: 'gpt-4o', modelLabel: 'GPT-4o', content: 'The answer is 4.', latencyMs: 150, tokens: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, error: null },
        { modelId: 'gpt-4', modelLabel: 'GPT-4', content: '2+2 equals 4.', latencyMs: 300, tokens: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }, error: null }
      ],
      totalMs: 350,
      createdAt: new Date().toISOString(),
      winner: null
    };

    test('returns empty string for null', () => {
      expect(ModelCompare.buildComparisonView(null)).toBe('');
    });

    test('returns empty string for missing responses', () => {
      expect(ModelCompare.buildComparisonView({ id: 'x' })).toBe('');
    });

    test('includes prompt text', () => {
      const html = ModelCompare.buildComparisonView(mockComparison);
      expect(html).toContain('What is 2+2?');
    });

    test('includes both model names', () => {
      const html = ModelCompare.buildComparisonView(mockComparison);
      expect(html).toContain('GPT-4o');
      expect(html).toContain('GPT-4');
    });

    test('includes response content', () => {
      const html = ModelCompare.buildComparisonView(mockComparison);
      expect(html).toContain('The answer is 4.');
      expect(html).toContain('2+2 equals 4.');
    });

    test('includes latency metrics', () => {
      const html = ModelCompare.buildComparisonView(mockComparison);
      expect(html).toContain('150ms');
      expect(html).toContain('300ms');
    });

    test('includes token counts', () => {
      const html = ModelCompare.buildComparisonView(mockComparison);
      expect(html).toContain('📥 10');
      expect(html).toContain('📤 5');
      expect(html).toContain('Σ 15');
    });

    test('includes vote buttons when no winner', () => {
      const html = ModelCompare.buildComparisonView(mockComparison);
      expect(html).toContain('Pick as best');
      expect(html).toContain('mc-vote-btn');
    });

    test('shows crown for winner and hides vote buttons', () => {
      const withWinner = Object.assign({}, mockComparison, { winner: 'gpt-4o' });
      const html = ModelCompare.buildComparisonView(withWinner);
      expect(html).toContain('👑');
      expect(html).toContain('mc-winner');
      expect(html).not.toContain('mc-vote-btn');
    });

    test('shows error for failed model', () => {
      const withError = {
        id: 'cmp-err',
        prompt: 'test',
        responses: [
          { modelId: 'gpt-4o', modelLabel: 'GPT-4o', content: 'ok', latencyMs: 100, tokens: null, error: null },
          { modelId: 'bad', modelLabel: 'Bad Model', content: null, latencyMs: 50, tokens: null, error: 'Rate limited' }
        ],
        totalMs: 100,
        createdAt: new Date().toISOString(),
        winner: null
      };
      const html = ModelCompare.buildComparisonView(withError);
      expect(html).toContain('❌');
      expect(html).toContain('Rate limited');
    });

    test('escapes HTML in prompt', () => {
      const xss = Object.assign({}, mockComparison, { prompt: '<script>alert(1)</script>' });
      const html = ModelCompare.buildComparisonView(xss);
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    test('escapes HTML in response content', () => {
      const xss = {
        id: 'cmp-xss',
        prompt: 'test',
        responses: [
          { modelId: 'a', modelLabel: 'A', content: '<img onerror=alert(1)>', latencyMs: 0, tokens: null, error: null },
          { modelId: 'b', modelLabel: 'B', content: 'safe', latencyMs: 0, tokens: null, error: null }
        ],
        totalMs: 0, createdAt: new Date().toISOString(), winner: null
      };
      const html = ModelCompare.buildComparisonView(xss);
      expect(html).not.toContain('<img');
      expect(html).toContain('&lt;img');
    });

    test('includes total time in footer', () => {
      const html = ModelCompare.buildComparisonView(mockComparison);
      expect(html).toContain('Total: 350ms');
    });

    test('handles 3+ models', () => {
      const three = Object.assign({}, mockComparison, {
        responses: [
          ...mockComparison.responses,
          { modelId: 'gpt-4.1-nano', modelLabel: 'GPT-4.1 Nano', content: 'Four', latencyMs: 50, tokens: null, error: null }
        ]
      });
      const html = ModelCompare.buildComparisonView(three);
      expect(html).toContain('GPT-4.1 Nano');
      expect(html).toContain('Four');
      // Grid should have 3 columns
      expect(html).toContain('repeat(3,1fr)');
    });
  });

  describe('getModelStats', () => {
    test('returns empty object with no history', () => {
      expect(ModelCompare.getModelStats()).toEqual({});
    });

    test('computes stats from history', () => {
      const items = [
        {
          id: 'c1', prompt: 'test1',
          responses: [
            { modelId: 'gpt-4o', modelLabel: 'GPT-4o', latencyMs: 100 },
            { modelId: 'gpt-4', modelLabel: 'GPT-4', latencyMs: 200 }
          ],
          winner: 'gpt-4o', createdAt: new Date().toISOString()
        },
        {
          id: 'c2', prompt: 'test2',
          responses: [
            { modelId: 'gpt-4o', modelLabel: 'GPT-4o', latencyMs: 150 },
            { modelId: 'gpt-4', modelLabel: 'GPT-4', latencyMs: 250 }
          ],
          winner: 'gpt-4', createdAt: new Date().toISOString()
        }
      ];
      localStorage.setItem('ac-model-compare-history', JSON.stringify(items));

      const stats = ModelCompare.getModelStats();
      expect(stats['gpt-4o']).toBeDefined();
      expect(stats['gpt-4o'].wins).toBe(1);
      expect(stats['gpt-4o'].appearances).toBe(2);
      expect(stats['gpt-4o'].winRate).toBe(0.5);
      expect(stats['gpt-4o'].avgLatencyMs).toBe(125); // (100+150)/2
      expect(stats['gpt-4'].wins).toBe(1);
      expect(stats['gpt-4'].avgLatencyMs).toBe(225); // (200+250)/2
    });

    test('handles comparisons with no winner', () => {
      const items = [{
        id: 'c1', prompt: 'test',
        responses: [
          { modelId: 'a', modelLabel: 'A', latencyMs: 100 },
          { modelId: 'b', modelLabel: 'B', latencyMs: 200 }
        ],
        winner: null, createdAt: new Date().toISOString()
      }];
      localStorage.setItem('ac-model-compare-history', JSON.stringify(items));

      const stats = ModelCompare.getModelStats();
      expect(stats['a'].wins).toBe(0);
      expect(stats['a'].appearances).toBe(1);
      expect(stats['a'].winRate).toBe(0);
    });
  });
});
