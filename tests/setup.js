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
      <button id="history-btn" class="btn-secondary">History</button>
    </div>
    <div id="char-count"></div>
    <div id="last-prompt">(no input yet)</div>
    <div id="blackbox">
      <div id="chat-output"></div>
      <div id="console-output" aria-live="polite">(results appear here)</div>
      <div id="token-usage"></div>
    </div>
    <div id="history-overlay"></div>
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
    'ChatController',
    'HistoryPanel'
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
