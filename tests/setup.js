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
    <div id="offline-banner" class="offline-banner" style="display:none" role="alert" aria-live="assertive">
      <span>📡 You are offline — browsing cached data. Sending messages requires connectivity.</span>
      <button id="offline-dismiss" class="btn-sm" title="Dismiss">✕</button>
    </div>
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
      <button id="stats-btn" class="btn-secondary" title="Chat statistics (Ctrl+I)">📊</button>
      <button id="cost-btn" class="btn-secondary" title="Cost dashboard">💰</button>
      <button id="heatmap-btn" class="btn-secondary" title="Usage heatmap">🗓️</button>
      <button id="bookmarks-btn" title="Bookmarks (Ctrl+B)">🔖</button>
      <button id="voice-btn" class="btn-secondary" aria-label="Toggle voice input">🎤</button>
      <button id="theme-btn" class="btn-secondary" aria-label="Toggle theme">☀️</button>
    </div>
    <div id="char-count"></div>
    <div id="context-meter" class="context-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Context window usage">
      <div class="context-meter__bar">
        <div class="context-meter__fill" id="context-meter-fill"></div>
      </div>
      <span class="context-meter__label" id="context-meter-label"></span>
    </div>
    <div id="last-prompt">(no input yet)</div>
    <div id="blackbox">
      <div id="search-bar" class="search-bar" role="search" aria-label="Search messages" style="display:none;">
        <input id="search-input" type="text" placeholder="Search messages…" autocomplete="off" aria-label="Search query">
        <span id="search-count" class="search-count" aria-live="polite"></span>
        <button id="search-prev" class="btn-sm search-nav" title="Previous match" aria-label="Previous match" disabled>▲</button>
        <button id="search-next" class="btn-sm search-nav" title="Next match" aria-label="Next match" disabled>▼</button>
        <button id="search-close" class="btn-sm search-nav" title="Close search" aria-label="Close search">✕</button>
      </div>
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
    <div id="sessions-overlay"></div>
    <div id="sessions-panel" aria-label="Chat sessions">
      <div id="sessions-header">
        <span>💬 Chat Sessions</span>
        <div id="sessions-actions">
          <button id="sessions-close-btn" class="btn-sm">✕</button>
        </div>
      </div>
      <div id="sessions-toolbar">
        <button id="sessions-new-btn" class="btn-sm">➕ New</button>
        <button id="sessions-save-btn" class="btn-sm">💾 Save</button>
        <button id="sessions-import-btn" class="btn-sm">📥 Import</button>
        <button id="sessions-tags-btn" class="btn-sm">🏷️ Tags</button>
        <button id="sessions-clear-btn" class="btn-sm btn-danger-sm">Clear All</button>
        <label class="sessions-autosave-label">
          <input type="checkbox" id="sessions-autosave">
          Auto-save
        </label>
      </div>
      <div id="sessions-count"></div>
      <div id="sessions-list"></div>
    </div>
    <div id="session-save-modal" role="dialog" aria-modal="true" style="display:none;">
      <div id="session-save-content">
        <p id="session-modal-title"><strong>Save Session</strong></p>
        <label for="session-name-input">Session Name</label>
        <input id="session-name-input" type="text" autocomplete="off">
        <div id="session-modal-buttons">
          <button id="session-save-cancel" class="btn-secondary">Cancel</button>
          <button id="session-save-confirm">Save</button>
        </div>
      </div>
    </div>
    <div id="bookmarks-panel" class="bookmarks-panel" style="display:none;">
      <div class="bookmarks-header">
        <h3>🔖 Bookmarks</h3>
        <div>
          <button id="bookmarks-clear" title="Clear all">🗑️</button>
          <button id="bookmarks-close" title="Close">✕</button>
        </div>
      </div>
      <div id="bookmarks-list" class="bookmarks-list"></div>
    </div>
    <div id="quick-replies" style="display:none;"></div>
    <div id="persona-overlay"></div>
    <div id="persona-panel">
      <div id="persona-active"></div>
      <div id="persona-list"></div>
      <textarea id="persona-custom-input"></textarea>
    </div>
    <div id="scratchpad-overlay"></div>
    <div id="scratchpad-panel">
      <textarea id="scratchpad-textarea"></textarea>
      <span id="scratchpad-wordcount"></span>
      <span id="scratchpad-status"></span>
    </div>
    <div id="model-overlay" style="display:none;"></div>
    <div id="model-panel" style="display:none;">
      <div id="model-list"></div>
    </div>
    <span id="model-label"></span>
    <button id="zen-btn"></button>
    <button id="fmt-btn"></button>
    <button id="rating-btn"></button>
    <button id="annotations-btn"></button>
    <button id="summary-btn"></button>
    <button id="chapters-btn"></button>
    <button id="prompt-library-btn"></button>
    <button id="agenda-btn"></button>
    <div id="prompt-library-overlay"></div>
    <div id="prompt-library-panel" style="display:none;">
      <div id="prompt-library-header">
        <span>📚 Prompt Library</span>
        <div id="prompt-library-actions">
          <button id="prompt-library-add-btn" class="btn-sm">➕ New</button>
          <button id="prompt-library-import-btn" class="btn-sm">📥 Import</button>
          <button id="prompt-library-export-btn" class="btn-sm">📤 Export</button>
          <button id="prompt-library-close-btn" class="btn-sm">✕</button>
        </div>
      </div>
      <div id="prompt-library-search-wrap">
        <input id="prompt-library-search" type="text" placeholder="Search your prompts…" autocomplete="off">
      </div>
      <div id="prompt-library-filters">
        <select id="prompt-library-folder-filter"><option value="">All Folders</option></select>
        <select id="prompt-library-sort">
          <option value="recent">Recently Used</option>
          <option value="alpha">A-Z</option>
          <option value="created">Newest</option>
          <option value="used">Most Used</option>
        </select>
      </div>
      <div id="prompt-library-count"></div>
      <div id="prompt-library-list"></div>
    </div>
    <div id="prompt-library-save-modal" style="display:none;">
      <div id="prompt-library-save-content">
        <p><strong id="prompt-library-modal-title">Save Prompt</strong></p>
        <input id="prompt-library-name-input" type="text">
        <input id="prompt-library-folder-input" type="text" list="prompt-library-folder-suggestions">
        <datalist id="prompt-library-folder-suggestions"></datalist>
        <textarea id="prompt-library-text-input" rows="5"></textarea>
        <div id="prompt-library-modal-buttons">
          <button id="prompt-library-cancel-btn">Cancel</button>
          <button id="prompt-library-confirm-btn">Save</button>
        </div>
      </div>
    </div>
    <div id="heatmap-overlay" style="display:none;"></div>
    <div id="heatmap-panel" style="display:none;">
      <div id="heatmap-stats"></div>
      <div id="heatmap-grid"></div>
      <button id="heatmap-close-btn"></button>
      <button id="heatmap-export-btn"></button>
      <button id="heatmap-refresh-btn"></button>
    </div>
    <div id="file-drop-overlay"></div>
    <div id="cross-tab-banner" style="display:none;">
      <span id="cross-tab-message"></span>
      <button id="cross-tab-reload">Reload</button>
      <button id="cross-tab-keep">Keep Mine</button>
      <button id="cross-tab-dismiss">Dismiss</button>
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
    'SafeStorage',
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
    'MessageSearch',
    'ChatBookmarks',
    'VoiceInput',
    'ThemeManager',
    'SessionManager',
    'ConversationSessions',
    'SlashCommands',
    'MessageReactions',
    'ChatStats',
    'CostDashboard',
    'PersonaPresets',
    'ModelSelector',
    'FileDropZone',
    'FocusMode',
    'InputHistory',
    'ResponseTimeBadge',
    'QuickReplies',
    'ConversationFork',
    'Scratchpad',
    'MessagePinning',
    'ReadAloud',
    'MessageDiff',
    'ConversationTimeline',
    'ConversationSummarizer',
    'MessageAnnotations',
    'ConversationChapters',
    'ConversationTags',
    'FormattingToolbar',
    'GlobalSessionSearch',
    'AutoTagger',
    'DataBackup',
    'ResponseRating',
    'ConversationMerge',
    'ConversationReplay',
    'PromptLibrary',
    'ModelCompare',
    'MessageTranslator',
    'MessageEditor',
    'MessageScheduler',
    'SmartRetry',
    'UsageHeatmap',
    'ContextWindowMeter',
    'ConversationAgenda',
    'ClipboardHistory',
    'OfflineManager',
    'MessageFilter',
    'ConversationSentiment',
    'QuickSwitcher',
    'ChatGPTImporter',
    'PromptChainRunner',
    'CustomThemeCreator',
    'CrossTabSync',
    'ConversationTimer',
    'COMMON_STOP_WORDS',
    'SmartSessionPrioritizer',
    'ConversationMemory',
    'SmartKnowledgeMap',
    'MoodTracker',
    'SmartModelAdvisor'
  ];

  for (const mod of modules) {
    // Match: const ModName = ...
    appCode = appCode.replace(
      new RegExp(`^const ${mod} = `, 'm'),
      `globalThis.${mod} = `
    );
  }

  // Expose top-level utility functions to globalThis for tests
  const utilFunctions = ['formatRelativeTime', 'downloadBlob'];
  for (const fn of utilFunctions) {
    appCode = appCode.replace(
      new RegExp(`^function ${fn}\\(`, 'm'),
      `globalThis.${fn} = function ${fn}(`
    );
  }

  // Suppress DOMContentLoaded listeners (tests call functions directly)
  appCode = appCode.replaceAll(
    "document.addEventListener('DOMContentLoaded'",
    "document.addEventListener('__test_skip_DOMContentLoaded__'"
  );

  // eslint-disable-next-line no-eval
  eval(appCode);
}

module.exports = { setupDOM, loadApp };
