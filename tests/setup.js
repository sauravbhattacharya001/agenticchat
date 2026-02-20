/**
 * Test setup: provides the full DOM that app.js expects,
 * then evaluates app.js so all modules are available globally.
 *
 * Since app.js uses `const`, eval'd code won't leak to global scope.
 * We wrap the eval to capture and expose the module names.
 */
const fs = require('fs');
const path = require('path');

function setupDOM() {
  document.body.innerHTML = `
    <h2>Agentic Chat</h2>
    <div class="toolbar" role="form" aria-label="API key entry"></div>
    <div class="toolbar" role="form" aria-label="Chat input">
      <input id="chat-input" placeholder="Ask anything…" autocomplete="off">
      <button id="send-btn">Send</button>
      <button id="cancel-btn" class="btn-danger" style="display:none;">Cancel</button>
      <button id="clear-btn" class="btn-secondary">Clear</button>
      <button id="templates-btn" class="btn-secondary">Templates</button>
      <button id="history-btn" class="btn-secondary">History</button>
      <button id="snippets-btn" class="btn-secondary">Snippets</button>
      <button id="shortcuts-btn" class="btn-secondary">⌨️</button>
      <button id="voice-btn" class="btn-secondary" aria-label="Toggle voice input">🎤</button>
    </div>
    <div id="char-count"></div>
    <div id="last-prompt">(no input yet)</div>
    <div id="blackbox">
      <div id="chat-output"></div>
      <div id="code-actions" style="display:none;">
        <button id="save-snippet-btn" class="btn-sm">💾 Save Snippet</button>
        <button id="copy-code-btn" class="btn-sm">📋 Copy</button>
        <button id="rerun-code-btn" class="btn-sm">▶️ Re-run</button>
      </div>
      <div id="console-output" aria-live="polite">(results appear here)</div>
      <div id="token-usage"></div>
    </div>
    <div id="history-overlay"></div>
    <div id="templates-overlay"></div>
    <div id="templates-panel" aria-label="Prompt templates">
      <div id="templates-header">
        <span>Prompt Templates</span>
        <div id="templates-actions">
          <button id="templates-close-btn" class="btn-sm">✕</button>
        </div>
      </div>
      <div id="templates-search-wrap">
        <input id="templates-search" type="text" placeholder="Search templates…" autocomplete="off">
      </div>
      <div id="templates-list"></div>
    </div>
    <div id="history-panel" aria-label="Conversation history">
      <div id="history-header">
        <span>Conversation History</span>
        <div id="history-actions">
          <button id="export-md-btn" class="btn-sm">MD</button>
          <button id="export-json-btn" class="btn-sm">JSON</button>
          <button id="history-close-btn" class="btn-sm">✕</button>
        </div>
      </div>
      <div id="history-messages"></div>
    </div>
    <div id="apikey-modal" role="dialog" aria-modal="true" style="display:none;">
      <div id="apikey-modal-content">
        <p id="api-modal-title">API key needed for<br><strong id="api-service-name"></strong></p>
        <input id="user-api-key" type="password" placeholder="Paste key" autocomplete="off">
        <br><br>
        <button id="apikey-submit-btn">OK</button>
      </div>
    </div>
    <div id="snippets-overlay"></div>
    <div id="snippets-panel" aria-label="Saved code snippets">
      <div id="snippets-header">
        <span>💾 Saved Snippets</span>
        <div id="snippets-actions">
          <button id="snippets-clear-btn" class="btn-sm btn-danger-sm">Clear All</button>
          <button id="snippets-close-btn" class="btn-sm">✕</button>
        </div>
      </div>
      <div id="snippets-search-wrap">
        <input id="snippets-search" type="text" placeholder="Search snippets…" autocomplete="off">
      </div>
      <div id="snippets-count"></div>
      <div id="snippets-list"></div>
    </div>
    <div id="snippet-save-modal" role="dialog" aria-modal="true" style="display:none;">
      <div id="snippet-save-content">
        <p id="snippet-modal-title"><strong>Save Code Snippet</strong></p>
        <label for="snippet-name-input">Name</label>
        <input id="snippet-name-input" type="text" placeholder="e.g. Bar Chart Generator" autocomplete="off">
        <label for="snippet-tags-input">Tags</label>
        <input id="snippet-tags-input" type="text" placeholder="e.g. chart, canvas, data" autocomplete="off">
        <div id="snippet-code-preview"></div>
        <div id="snippet-modal-buttons">
          <button id="snippet-cancel-btn" class="btn-secondary">Cancel</button>
          <button id="snippet-confirm-btn">Save</button>
        </div>
      </div>
    </div>
    <div id="shortcuts-modal" role="dialog" aria-modal="true" aria-labelledby="shortcuts-modal-title">
      <div id="shortcuts-modal-content">
        <div id="shortcuts-modal-header">
          <span id="shortcuts-modal-title">⌨️ Keyboard Shortcuts</span>
          <button id="shortcuts-modal-close" class="btn-sm">✕</button>
        </div>
        <div id="shortcuts-list"></div>
      </div>
    </div>
  `;
}

function loadApp() {
  // Polyfill crypto.randomUUID for jsdom
  if (!globalThis.crypto) {
    globalThis.crypto = {};
  }
  if (!globalThis.crypto.randomUUID) {
    globalThis.crypto.randomUUID = () =>
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
  }

  let appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf-8');

  // Replace `const` with `globalThis.X =` for the top-level module declarations
  // so they become accessible in test scope.
  const modules = [
    'ChatConfig',
    'ConversationManager',
    'SandboxRunner',
    'ApiKeyManager',
    'UIController',
    'PromptTemplates',
    'ChatController',
    'HistoryPanel',
    'SnippetLibrary',
    'KeyboardShortcuts',
    'VoiceInput'
  ];

  for (const mod of modules) {
    // Match: const ModName = ...
    appCode = appCode.replace(
      new RegExp(`^const ${mod} = `, 'm'),
      `globalThis.${mod} = `
    );
  }

  // Suppress DOMContentLoaded listener (tests call functions directly)
  appCode = appCode.replace(
    /document\.addEventListener\('DOMContentLoaded'/,
    "document.addEventListener('__test_skip_DOMContentLoaded__'"
  );

  // eslint-disable-next-line no-eval
  eval(appCode);
}

module.exports = { setupDOM, loadApp };
