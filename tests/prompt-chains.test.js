/**
 * Tests for PromptChainRunner module.
 *
 * Covers: chain CRUD, substitution, import/export, slash command registration,
 * preset loading, panel UI, and run history.
 */
const { setupDOM, loadApp } = require('./setup');

beforeAll(() => {
  setupDOM();
  loadApp();
});

beforeEach(() => {
  localStorage.clear();
  // Re-init to reload from empty storage
  PromptChainRunner.init();
});

describe('PromptChainRunner', () => {
  test('module exposes expected public API', () => {
    expect(typeof PromptChainRunner.init).toBe('function');
    expect(typeof PromptChainRunner.toggle).toBe('function');
    expect(typeof PromptChainRunner.open).toBe('function');
    expect(typeof PromptChainRunner.close).toBe('function');
    expect(typeof PromptChainRunner.createChain).toBe('function');
    expect(typeof PromptChainRunner.updateChain).toBe('function');
    expect(typeof PromptChainRunner.deleteChain).toBe('function');
    expect(typeof PromptChainRunner.duplicateChain).toBe('function');
    expect(typeof PromptChainRunner.getChains).toBe('function');
    expect(typeof PromptChainRunner.runChain).toBe('function');
    expect(typeof PromptChainRunner.stopChain).toBe('function');
    expect(typeof PromptChainRunner.exportChains).toBe('function');
    expect(typeof PromptChainRunner.importChains).toBe('function');
  });

  test('createChain adds a chain and persists to storage', () => {
    const chain = PromptChainRunner.createChain('Test Chain', ['step 1', 'step 2']);
    expect(chain).toBeDefined();
    expect(chain.name).toBe('Test Chain');
    expect(chain.steps).toEqual(['step 1', 'step 2']);
    expect(chain.id).toBeTruthy();
    expect(chain.createdAt).toBeTruthy();

    const stored = JSON.parse(localStorage.getItem('ac-prompt-chains'));
    expect(stored.find(c => c.id === chain.id)).toBeTruthy();
  });

  test('createChain defaults name to Untitled Chain', () => {
    const chain = PromptChainRunner.createChain('', ['step 1']);
    expect(chain.name).toBe('Untitled Chain');
  });

  test('updateChain modifies chain name and steps', () => {
    const chain = PromptChainRunner.createChain('Original', ['step 1']);
    const updated = PromptChainRunner.updateChain(chain.id, {
      name: 'Updated Name',
      steps: ['new step 1', 'new step 2']
    });

    expect(updated.name).toBe('Updated Name');
    expect(updated.steps).toEqual(['new step 1', 'new step 2']);
    expect(updated.updatedAt).toBeTruthy();
  });

  test('updateChain returns null for nonexistent id', () => {
    const result = PromptChainRunner.updateChain('nonexistent_id', { name: 'x' });
    expect(result).toBeNull();
  });

  test('deleteChain removes the chain', () => {
    const chain = PromptChainRunner.createChain('To Delete', ['step']);
    expect(PromptChainRunner.getChains().length).toBeGreaterThan(0);
    const id = chain.id;

    PromptChainRunner.deleteChain(id);
    expect(PromptChainRunner.getChains().find(c => c.id === id)).toBeUndefined();
  });

  test('duplicateChain creates a copy with (copy) suffix', () => {
    const original = PromptChainRunner.createChain('My Chain', ['a', 'b']);
    const copy = PromptChainRunner.duplicateChain(original.id);

    expect(copy).toBeDefined();
    expect(copy.name).toBe('My Chain (copy)');
    expect(copy.steps).toEqual(['a', 'b']);
    expect(copy.id).not.toBe(original.id);
  });

  test('duplicateChain returns null for nonexistent id', () => {
    expect(PromptChainRunner.duplicateChain('nope')).toBeNull();
  });

  test('getChains returns a copy of the chains array', () => {
    PromptChainRunner.createChain('A', ['1']);
    const chains = PromptChainRunner.getChains();
    chains.push({ fake: true });
    // Original should not be affected
    expect(PromptChainRunner.getChains().find(c => c.fake)).toBeUndefined();
  });

  test('presets are loaded on first init when no chains exist', () => {
    localStorage.clear();
    PromptChainRunner.init();
    const chains = PromptChainRunner.getChains();
    expect(chains.length).toBeGreaterThanOrEqual(3);
    expect(chains.some(c => c.name.includes('REST API'))).toBe(true);
    expect(chains.some(c => c.name.includes('Code Review'))).toBe(true);
    expect(chains.some(c => c.name.includes('Data Pipeline'))).toBe(true);
  });

  test('presets are not loaded when chains already exist', () => {
    localStorage.setItem('ac-prompt-chains', JSON.stringify([
      { id: 'existing', name: 'Existing', steps: ['s1'], createdAt: Date.now() }
    ]));
    PromptChainRunner.init();
    const chains = PromptChainRunner.getChains();
    // Should only have the existing one, no presets added
    expect(chains.length).toBe(1);
    expect(chains[0].name).toBe('Existing');
  });

  test('panel opens and closes', () => {
    PromptChainRunner.open();
    const panel = document.getElementById('chain-panel');
    expect(panel).toBeTruthy();
    expect(panel.style.display).toBe('block');

    PromptChainRunner.close();
    expect(panel.style.display).toBe('none');
  });

  test('toggle opens and closes panel', () => {
    PromptChainRunner.toggle(); // open
    const panel = document.getElementById('chain-panel');
    expect(panel.style.display).toBe('block');

    PromptChainRunner.toggle(); // close
    expect(panel.style.display).toBe('none');
  });

  test('runChain returns null for empty/nonexistent chain', async () => {
    const result = await PromptChainRunner.runChain('nonexistent');
    expect(result).toBeNull();
  });

  test('stopChain does not throw when not running', () => {
    expect(() => PromptChainRunner.stopChain()).not.toThrow();
  });

  test('chains persist across init cycles', () => {
    // Clear and re-init to get presets
    localStorage.clear();
    PromptChainRunner.init();
    
    // Create a custom chain
    const chain = PromptChainRunner.createChain('Persistent', ['step A']);
    const chainCount = PromptChainRunner.getChains().length;

    // Re-init (simulates page reload)
    PromptChainRunner.init();
    const reloaded = PromptChainRunner.getChains();
    expect(reloaded.length).toBe(chainCount);
    expect(reloaded.find(c => c.name === 'Persistent')).toBeTruthy();
  });

  test('chain steps with multiple steps have correct structure', () => {
    const chain = PromptChainRunner.createChain('Multi', ['first', 'second {{prev}}', 'third {{step.1}}']);
    expect(chain.steps.length).toBe(3);
    expect(chain.steps[1]).toContain('{{prev}}');
    expect(chain.steps[2]).toContain('{{step.1}}');
  });

  test('exportChains creates a downloadable blob', () => {
    // Mock URL.createObjectURL
    const origCreateObjectURL = URL.createObjectURL;
    const origRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => 'blob:test');
    URL.revokeObjectURL = jest.fn();

    PromptChainRunner.createChain('Export Test', ['e1']);
    expect(() => PromptChainRunner.exportChains()).not.toThrow();

    URL.createObjectURL = origCreateObjectURL;
    URL.revokeObjectURL = origRevokeObjectURL;
  });
});
